// routes/compras.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Soma N meses a uma data ISO. 1ª parcela = +30 dias, 2ª = +60... (padrão cartão).
  function calcularVencimento(dataBase, numMeses) {
    const d = new Date(dataBase);
    d.setMonth(d.getMonth() + numMeses);
    return d.toISOString().slice(0, 10);
  }

  function validarPayload(body) {
    if (!body) return 'Payload vazio';
    const { forma_pagamento, parcelas, itens } = body;

    if (!['dinheiro', 'pix', 'cartao'].includes(forma_pagamento)) {
      return 'Forma de pagamento inválida (use dinheiro, pix ou cartao)';
    }
    const p = parseInt(parcelas);
    if (forma_pagamento === 'cartao' && (!p || p < 1)) {
      return 'Para cartão, informe o número de parcelas (>= 1)';
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return 'A compra precisa ter ao menos 1 item';
    }
    for (const it of itens) {
      if (!it.produto_id && !it.produto_nome) return 'Cada item precisa de produto_id ou produto_nome';
      if (!it.quantidade || it.quantidade <= 0) return 'Quantidade deve ser maior que zero';
      if (it.custo_unitario === undefined || it.custo_unitario < 0) return 'Custo unitário inválido';
    }
    return null;
  }

  router.get('/', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM compras ORDER BY id DESC');
    res.json(rows);
  });

  router.get('/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM compras WHERE id = $1', [req.params.id]);
    const compra = rows[0];
    if (!compra) return res.status(404).json({ error: 'Compra não encontrada' });
    const itens = await pool.query('SELECT * FROM compra_itens WHERE compra_id = $1', [req.params.id]);
    compra.itens = itens.rows;
    res.json(compra);
  });

  // Criar compra: insere cabeçalho, cria/atualiza produtos, registra itens e
  // movimentos, e gera contas a pagar se for cartão parcelado. Tudo em transação.
  router.post('/', async (req, res) => {
    const erro = validarPayload(req.body);
    if (erro) return res.status(400).json({ error: erro });

    const descricao = req.body.descricao;
    const forma_pagamento = req.body.forma_pagamento;
    const parcelas = parseInt(req.body.parcelas) || 1;
    const itens = req.body.itens;
    const dataISO = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // valor total a partir dos itens (fonte única de verdade)
      const valor_total = itens.reduce(
        (acc, item) => acc + item.quantidade * item.custo_unitario, 0
      );

      const insCompra = await client.query(
        `INSERT INTO compras (descricao, valor_total, forma_pagamento, parcelas, data)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [descricao || null, valor_total, forma_pagamento, parcelas, dataISO]
      );
      const compraId = insCompra.rows[0].id;

      for (const item of itens) {
        let produtoId = item.produto_id;
        let produtoNome;

        if (produtoId) {
          const prod = await client.query('SELECT * FROM produtos WHERE id = $1', [produtoId]);
          if (!prod.rows[0]) throw new Error(`Produto #${produtoId} não encontrado`);
          produtoNome = prod.rows[0].nome;
          await client.query(
            'UPDATE produtos SET custo = $1, quantidade = quantidade + $2 WHERE id = $3',
            [item.custo_unitario, item.quantidade, produtoId]
          );
        } else {
          const insProd = await client.query(
            'INSERT INTO produtos (nome, custo, preco, quantidade) VALUES ($1, $2, $3, $4) RETURNING id',
            [item.produto_nome, item.custo_unitario, 0, item.quantidade]
          );
          produtoId = insProd.rows[0].id;
          produtoNome = item.produto_nome;
        }

        await client.query(
          `INSERT INTO compra_itens (compra_id, produto_id, produto_nome, quantidade, custo_unitario)
           VALUES ($1, $2, $3, $4, $5)`,
          [compraId, produtoId, produtoNome, item.quantidade, item.custo_unitario]
        );

        await client.query(
          `INSERT INTO estoque_movimentos
           (produto_id, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [produtoId, 'entrada', item.quantidade, item.custo_unitario, 'compra',
           compraId, `Compra #${compraId}`, dataISO]
        );
      }

      if (forma_pagamento === 'cartao' && parcelas > 1) {
        const valorParcela = Math.floor((valor_total / parcelas) * 100) / 100;
        const soma = valorParcela * (parcelas - 1);
        const valorUltima = Math.round((valor_total - soma) * 100) / 100;

        for (let i = 1; i <= parcelas; i++) {
          const valor = (i === parcelas) ? valorUltima : valorParcela;
          const vencimento = calcularVencimento(dataISO, i);
          await client.query(
            `INSERT INTO contas_pagar
             (descricao, valor, vencimento, status, compra_id, parcela_num, parcela_total)
             VALUES ($1, $2, $3, 'pendente', $4, $5, $6)`,
            [`${descricao || 'Compra'} — parcela ${i}/${parcelas}`, valor, vencimento,
             compraId, i, parcelas]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true, id: compraId });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // Excluir compra: bloqueia se houver parcela paga; senão devolve estoque e limpa tudo.
  router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const compra = await client.query('SELECT * FROM compras WHERE id = $1', [id]);
      if (!compra.rows[0]) throw new Error('Compra não encontrada');

      const pagas = await client.query(
        `SELECT COUNT(*)::int as total FROM contas_pagar WHERE compra_id = $1 AND status = 'paga'`,
        [id]
      );
      if (pagas.rows[0].total > 0) {
        throw new Error(
          'Esta compra tem parcelas já pagas e não pode ser excluída. ' +
          'Se precisar reverter, exclua as parcelas pagas primeiro.'
        );
      }

      const itens = await client.query('SELECT * FROM compra_itens WHERE compra_id = $1', [id]);
      for (const item of itens.rows) {
        await client.query(
          'UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2',
          [item.quantidade, item.produto_id]
        );
      }

      await client.query(`DELETE FROM estoque_movimentos WHERE origem_tipo = 'compra' AND origem_id = $1`, [id]);
      await client.query(`DELETE FROM contas_pagar WHERE compra_id = $1 AND status = 'pendente'`, [id]);
      await client.query('DELETE FROM compra_itens WHERE compra_id = $1', [id]);
      await client.query('DELETE FROM compras WHERE id = $1', [id]);

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
};
