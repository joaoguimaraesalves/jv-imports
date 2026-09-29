// routes/historico.js
// Histórico da Loja: números de longo prazo (desde a primeira compra/venda),
// cálculos salvos para auditoria e o registro de vendas antigas (feitas antes
// de usar o sistema) para acertar o estoque.
const express = require('express');
const { saldoConta, totaisLongoPrazo, montarResumo } = require('../lib/financeiro');

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

module.exports = (pool) => {
  const router = express.Router();

  async function resumoAtual() {
    const [totais, saldo] = await Promise.all([totaisLongoPrazo(pool), saldoConta(pool)]);
    return montarResumo(totais, saldo.saldo_estimado);
  }

  // Resumo ao vivo + cálculos salvos (o mais recente primeiro)
  router.get('/', async (req, res) => {
    const atual = await resumoAtual();
    const { rows } = await pool.query(
      'SELECT id, data, dados FROM historico_calculos ORDER BY id DESC LIMIT 30'
    );
    res.json({ atual, ultimo: rows[0] || null, calculos: rows });
  });

  // "Calcular histórico": grava um retrato dos totais de hoje. Não é apagado.
  router.post('/calcular', async (req, res) => {
    const dados = await resumoAtual();
    const { rows } = await pool.query(
      'INSERT INTO historico_calculos (data, dados) VALUES ($1, $2) RETURNING id, data, dados',
      [new Date().toISOString(), JSON.stringify(dados)]
    );
    res.json(rows[0]);
  });

  // Vendas antigas: baixa do estoque o que foi vendido antes do sistema.
  // Não entram no saldo atual (o dinheiro já foi usado), mas entram no lucro total.
  router.post('/vendas-antigas', async (req, res) => {
    const { data, itens } = req.body || {};
    if (!DATA_VALIDA.test(data || '')) return res.status(400).json({ error: 'Informe a data das vendas antigas' });
    if (data > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'A data das vendas antigas não pode ser no futuro' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Nenhum produto com venda antiga informado' });
    }

    const dataISO = `${data}T12:00:00.000Z`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const criadas = [];

      for (const it of itens) {
        const qtd = parseInt(it.quantidade);
        const valor = parseFloat(it.valor);
        if (!qtd || qtd <= 0) throw new Error('Quantidade inválida');
        if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor recebido inválido');

        const prod = (await client.query(
          'SELECT * FROM produtos WHERE id = $1 FOR UPDATE', [it.produto_id]
        )).rows[0];
        if (!prod) throw new Error(`Produto #${it.produto_id} não encontrado`);
        if (qtd > prod.quantidade) {
          throw new Error(`"${prod.nome}": só há ${prod.quantidade} no estoque do sistema`);
        }

        const custo = prod.custo * qtd;
        const venda = (await client.query(
          `INSERT INTO vendas (produto_id, produto_nome, quantidade, valor, custo, forma_pagamento, data,
                               recebido, data_recebimento, historico)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, true, $6, true) RETURNING id`,
          [prod.id, prod.nome, qtd, valor, custo, dataISO]
        )).rows[0];

        // Produto ainda sem preço de venda: guarda o preço usado aqui no cadastro
        const preco = parseFloat(it.preco);
        await client.query(
          `UPDATE produtos SET quantidade = quantidade - $1,
                  preco = CASE WHEN preco = 0 AND $3::numeric > 0 THEN $3::numeric ELSE preco END
           WHERE id = $2`,
          [qtd, prod.id, Number.isFinite(preco) ? preco : 0]
        );
        await client.query(
          `INSERT INTO estoque_movimentos
           (produto_id, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, data)
           VALUES ($1, 'saida', $2, $3, 'venda', $4, $5, $6)`,
          [prod.id, qtd, prod.custo, venda.id, `Venda antiga #${venda.id}`, dataISO]
        );
        criadas.push(venda.id);
      }

      await client.query('COMMIT');
      res.json({ ok: true, vendas: criadas });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
};
