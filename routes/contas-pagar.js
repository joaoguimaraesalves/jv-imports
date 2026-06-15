// routes/contas-pagar.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { status } = req.query;
    let sql;
    if (status === 'pendente') {
      sql = `SELECT * FROM contas_pagar WHERE status = 'pendente' ORDER BY vencimento ASC`;
    } else if (status === 'paga') {
      sql = `SELECT * FROM contas_pagar WHERE status = 'paga' ORDER BY data_pagamento DESC`;
    } else {
      sql = `SELECT * FROM contas_pagar ORDER BY vencimento ASC`;
    }
    const { rows } = await pool.query(sql);
    res.json(rows);
  });

  // Lançamento manual (fora de uma compra). Útil pra aluguel ou algo avulso.
  router.post('/', async (req, res) => {
    const { descricao, valor, vencimento } = req.body;
    if (!descricao || !valor || !vencimento) {
      return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios' });
    }
    const { rows } = await pool.query(
      `INSERT INTO contas_pagar (descricao, valor, vencimento, status)
       VALUES ($1, $2, $3, 'pendente') RETURNING id`,
      [descricao, parseFloat(valor), vencimento]
    );
    res.json({ ok: true, id: rows[0].id });
  });

  router.patch('/:id/pagar', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM contas_pagar WHERE id = $1', [req.params.id]);
    const conta = rows[0];
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    if (conta.status === 'paga') return res.status(400).json({ error: 'Conta já está paga' });
    await pool.query(
      `UPDATE contas_pagar SET status = 'paga', data_pagamento = $1 WHERE id = $2`,
      [new Date().toISOString(), req.params.id]
    );
    res.json({ ok: true });
  });

  // Útil se a pessoa marcar por engano
  router.patch('/:id/desfazer-pagamento', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM contas_pagar WHERE id = $1', [req.params.id]);
    const conta = rows[0];
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    await pool.query(
      `UPDATE contas_pagar SET status = 'pendente', data_pagamento = NULL WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    await pool.query('DELETE FROM contas_pagar WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
