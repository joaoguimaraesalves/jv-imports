// routes/produtos.js
const express = require('express');
const { lerFoto } = require('../lib/loja');

// Campos de vitrine (site). Se não vierem no pedido, mantém o valor atual.
function camposLoja(body, atual = {}) {
  const texto = (v, max) => (v === undefined ? undefined : (String(v || '').trim().slice(0, max) || null));
  const bool = (v) => (v === undefined ? undefined : v === true || v === 'true' || v === 1 || v === '1');
  const promo = body.preco_antigo === undefined ? undefined
    : (Number(body.preco_antigo) > 0 ? Number(body.preco_antigo) : null);
  const c = {
    descricao: texto(body.descricao, 2000),
    categoria: texto(body.categoria, 60),
    na_loja: bool(body.na_loja),
    destaque: bool(body.destaque),
    preco_antigo: promo,
  };
  for (const k of Object.keys(c)) if (c[k] === undefined) c[k] = atual[k] ?? (k === 'na_loja' ? true : k === 'destaque' ? false : null);
  return c;
}

module.exports = (pool) => {
  const router = express.Router();

  // foto_em: data da foto (null = sem foto). Os bytes da foto não vêm aqui.
  router.get('/', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*, f.atualizado_em AS foto_em
       FROM produtos p
       LEFT JOIN produto_fotos f ON f.produto_id = p.id
       ORDER BY p.nome`);
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    const l = camposLoja(req.body);
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, custo, preco, quantidade, descricao, categoria, na_loja, destaque, preco_antigo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [nome, custo, preco, quantidade, l.descricao, l.categoria, l.na_loja, l.destaque, l.preco_antigo]
    );
    res.json({ ok: true, id: rows[0].id });
  });

  // Excluir produto: o histórico (movimentos e itens de compra) é mantido e
  // passa a aparecer como "(produto excluído)". Sem isso, as chaves
  // estrangeiras impediam excluir qualquer produto que já teve movimento.
  // A foto sai junto (ON DELETE CASCADE).
  router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE estoque_movimentos SET produto_id = NULL WHERE produto_id = $1', [req.params.id]);
      await client.query('UPDATE compra_itens SET produto_id = NULL WHERE produto_id = $1', [req.params.id]);
      await client.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });
  // Editar cadastro. Se a quantidade mudar, registra um movimento de "ajuste"
  // (auditoria: fica claro em Movimentos que o estoque foi corrigido à mão).
  router.put('/:id', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Informe o nome do produto' });
    if ([custo, preco, quantidade].some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: 'Custo, preço e quantidade devem ser números maiores ou iguais a zero' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const antes = (await client.query('SELECT * FROM produtos WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!antes) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      const l = camposLoja(req.body, antes);
      const { rows } = await client.query(
        `UPDATE produtos SET nome = $1, custo = $2, preco = $3, quantidade = $4,
                descricao = $5, categoria = $6, na_loja = $7, destaque = $8, preco_antigo = $9
         WHERE id = $10 RETURNING *`,
        [String(nome).trim(), custo, preco, parseInt(quantidade),
         l.descricao, l.categoria, l.na_loja, l.destaque, l.preco_antigo, req.params.id]
      );
      const diferenca = parseInt(quantidade) - antes.quantidade;
      if (diferenca !== 0) {
        await client.query(
          `INSERT INTO estoque_movimentos
           (produto_id, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, data)
           VALUES ($1, 'ajuste', $2, $3, 'ajuste', NULL, $4, $5)`,
          [antes.id, diferenca, custo, `Ajuste manual: ${antes.quantidade} → ${parseInt(quantidade)}`,
           new Date().toISOString()]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, produto: rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // Foto do produto para o site. Corpo: { foto: "data:image/jpeg;base64,..." }
  router.put('/:id/foto', async (req, res) => {
    const foto = lerFoto(req.body && req.body.foto);
    if (foto.erro) return res.status(400).json({ error: foto.erro });
    try {
      const existe = await pool.query('SELECT 1 FROM produtos WHERE id = $1', [req.params.id]);
      if (!existe.rowCount) return res.status(404).json({ error: 'Produto não encontrado' });
      const agora = new Date().toISOString();
      await pool.query(
        `INSERT INTO produto_fotos (produto_id, tipo, dados, atualizado_em) VALUES ($1, $2, $3, $4)
         ON CONFLICT (produto_id) DO UPDATE SET tipo = EXCLUDED.tipo, dados = EXCLUDED.dados,
                                               atualizado_em = EXCLUDED.atualizado_em`,
        [req.params.id, foto.tipo, foto.dados, agora]);
      res.json({ ok: true, foto_em: agora });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/:id/foto', async (req, res) => {
    try {
      await pool.query('DELETE FROM produto_fotos WHERE produto_id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
