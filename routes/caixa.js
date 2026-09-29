// routes/caixa.js
// Saldo da conta de vendas + dados para o planejamento de caixa (Meta de Caixa).
// O saldo é informado manualmente; o cálculo do saldo estimado está em
// lib/financeiro.js (saldoConta).
const express = require('express');
const { saldoConta } = require('../lib/financeiro');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const saldo = await saldoConta(pool);

    // Ritmo de vendas: faturamento dos últimos 30 dias
    const inicio30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const faturamento30d = (await pool.query(
      'SELECT COALESCE(SUM(valor),0) as total FROM vendas WHERE data >= $1 AND NOT historico', [inicio30d]
    )).rows[0].total;

    const aReceber = (await pool.query(
      'SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd FROM vendas WHERE NOT recebido'
    )).rows[0];

    const contasPendentes = (await pool.query(
      `SELECT id, descricao, valor, vencimento FROM contas_pagar
       WHERE status = 'pendente'
       ORDER BY vencimento ASC, id ASC`
    )).rows;

    res.json({
      ...saldo,
      faturamento_30d: faturamento30d,
      media_diaria_vendas: faturamento30d / 30,
      contas_pendentes: contasPendentes,
      a_receber: aReceber.total,
      a_receber_qtd: aReceber.qtd,
    });
  });

  router.put('/saldo', async (req, res) => {
    const saldo = parseFloat(req.body.saldo);
    if (!Number.isFinite(saldo)) {
      return res.status(400).json({ error: 'saldo deve ser um número' });
    }
    const agora = new Date().toISOString();
    await pool.query(
      `INSERT INTO configuracoes (chave, valor, atualizado_em)
       VALUES ('saldo_conta', $1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = EXCLUDED.atualizado_em`,
      [String(saldo), agora]
    );
    res.json({ ok: true, saldo, atualizado_em: agora });
  });

  return router;
};
