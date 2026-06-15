// routes/estoque.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/movimentos', async (req, res) => {
    const { produto_id } = req.query;
    if (produto_id) {
      const { rows } = await pool.query(
        `SELECT m.*, p.nome as produto_nome_atual
         FROM estoque_movimentos m
         LEFT JOIN produtos p ON p.id = m.produto_id
         WHERE m.produto_id = $1
         ORDER BY m.data DESC`,
        [produto_id]
      );
      res.json(rows);
    } else {
      const { rows } = await pool.query(
        `SELECT m.*, p.nome as produto_nome_atual
         FROM estoque_movimentos m
         LEFT JOIN produtos p ON p.id = m.produto_id
         ORDER BY m.data DESC`
      );
      res.json(rows);
    }
  });

  return router;
};
