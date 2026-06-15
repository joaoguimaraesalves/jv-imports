// routes/saidas.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM saidas ORDER BY id DESC');
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { descricao, valor } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO saidas (descricao, valor, data) VALUES ($1, $2, $3) RETURNING id',
      [descricao, valor, new Date().toISOString()]
    );
    res.json({ ok: true, id: rows[0].id });
  });

  router.delete('/:id', async (req, res) => {
    await pool.query('DELETE FROM saidas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
