// routes/caixa.js
// Saldo da conta de vendas + dados para o planejamento de caixa (Meta de Caixa).
// O saldo é informado manualmente; a partir daí o sistema estima o saldo atual
// somando as vendas recebidas e descontando as contas pagas registradas depois.
// Venda fiado só entra no saldo quando é marcada como recebida.
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const cfg = (await pool.query(
      `SELECT valor, atualizado_em FROM configuracoes WHERE chave = 'saldo_conta'`
    )).rows[0];

    const saldoInformado = cfg ? parseFloat(cfg.valor) : null;
    const desde = cfg ? cfg.atualizado_em : null;

    let vendasDesde = 0, contasPagasDesde = 0;
    if (desde) {
      vendasDesde = (await pool.query(
        `SELECT COALESCE(SUM(valor),0) as total FROM vendas
         WHERE recebido AND COALESCE(data_recebimento, data) > $1`, [desde]
      )).rows[0].total;
      contasPagasDesde = (await pool.query(
        `SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar
         WHERE status = 'paga' AND data_pagamento > $1`, [desde]
      )).rows[0].total;
    }

    // Ritmo de vendas: faturamento dos últimos 30 dias
    const inicio30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const faturamento30d = (await pool.query(
      'SELECT COALESCE(SUM(valor),0) as total FROM vendas WHERE data >= $1', [inicio30d]
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
      saldo_informado: saldoInformado,
      saldo_atualizado_em: desde,
      vendas_desde: vendasDesde,
      contas_pagas_desde: contasPagasDesde,
      saldo_estimado: saldoInformado === null
        ? null
        : saldoInformado + vendasDesde - contasPagasDesde,
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
