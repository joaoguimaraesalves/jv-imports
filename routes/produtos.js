// routes/produtos.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY nome');
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO produtos (nome, custo, preco, quantidade) VALUES ($1, $2, $3, $4) RETURNING id',
      [nome, custo, preco, quantidade]
    );
    res.json({ ok: true, id: rows[0].id });
  });

  router.delete('/:id', async (req, res) => {
    await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });
   router.put('/:id', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    const { rows } = await pool.query(
      UPDATE produtos SET nome = $1, custo = $2, preco = $3, quantidade = $4
       WHERE id = $5 RETURNING *,
      [nome, custo, preco, quantidade, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ ok: true, produto: rows[0] });
  });

  return router;
};
