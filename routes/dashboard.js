// routes/dashboard.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // --- Helper: intervalo do filtro de período ---
  function intervaloPeriodo(periodo) {
    const agora = new Date();
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    if (periodo === 'hoje') return { inicio: hoje.toISOString(), fim: null };
    if (periodo === '7d') { const i = new Date(hoje); i.setDate(i.getDate() - 6); return { inicio: i.toISOString(), fim: null }; }
    if (periodo === '30d') { const i = new Date(hoje); i.setDate(i.getDate() - 29); return { inicio: i.toISOString(), fim: null }; }
    if (periodo === 'mes') { const i = new Date(agora.getFullYear(), agora.getMonth(), 1); return { inicio: i.toISOString(), fim: null }; }
    if (periodo === 'ano') { const i = new Date(agora.getFullYear(), 0, 1); return { inicio: i.toISOString(), fim: null }; }
    return null; // "total" — sem filtro
  }

  // Monta cláusula WHERE com placeholder do Postgres ($1)
  function whereData(campo, periodo) {
    const intervalo = intervaloPeriodo(periodo);
    if (!intervalo) return { clausula: '', params: [] };
    return { clausula: `WHERE ${campo} >= $1`, params: [intervalo.inicio] };
  }

  // ---------- /api/dashboard ----------
  router.get('/', async (req, res) => {
    const periodo = req.query.periodo || 'total';
    const wVendas = whereData('data', periodo);
    const wSaidas = whereData('data', periodo);
    const wContas = whereData('data_pagamento', periodo);

    const rv = (await pool.query(
      `SELECT COALESCE(SUM(valor),0) as vendas,
              COALESCE(SUM(custo),0) as custos,
              COALESCE(SUM(quantidade),0) as qtd
       FROM vendas ${wVendas.clausula}`,
      wVendas.params
    )).rows[0];

    const rs = (await pool.query(
      `SELECT COALESCE(SUM(valor),0) as total_saidas
       FROM saidas ${wSaidas.clausula}`,
      wSaidas.params
    )).rows[0];

    // Contas a pagar efetivamente pagas entram como despesa do período.
    const rc = (await pool.query(
      `SELECT COALESCE(SUM(valor),0) as total_pago
       FROM contas_pagar
       WHERE status = 'paga'
       ${wContas.clausula ? 'AND ' + wContas.clausula.replace('WHERE ', '') : ''}`,
      wContas.params
    )).rows[0];

    const despesasTotais = rs.total_saidas + rc.total_pago;
    const lucroLiquido = rv.vendas - rv.custos - despesasTotais;

    res.json({
      total_vendas: rv.vendas,
      custos: rv.custos,
      saidas: rs.total_saidas,
      contas_pagas: rc.total_pago,
      despesas_totais: despesasTotais,
      lucro_liquido: lucroLiquido,
      qtd_vendida: rv.qtd,
      ticket_medio: rv.qtd > 0 ? rv.vendas / rv.qtd : 0,
      margem: rv.vendas > 0 ? ((lucroLiquido / rv.vendas) * 100).toFixed(2) : 0,
      periodo,
    });
  });

  // ---------- /api/dashboard/grafico ----------
  router.get('/grafico', async (req, res) => {
    const periodo = req.query.periodo || 'total';
    const agrupar = req.query.agrupar || 'dia'; // 'dia' ou 'mes'

    // to_char do Postgres: 'YYYY-MM-DD' para dia, 'YYYY-MM' para mês.
    // O campo "data" é TEXT (ISO), então fazemos cast pra timestamptz.
    const formato = agrupar === 'mes' ? 'YYYY-MM' : 'YYYY-MM-DD';

    const wv = whereData('data', periodo);
    const ws = whereData('data', periodo);
    const wc = whereData('data_pagamento', periodo);

    const vendas = (await pool.query(
      `SELECT to_char(data::timestamptz, '${formato}') as periodo,
              COALESCE(SUM(valor),0) as faturamento,
              COALESCE(SUM(custo),0) as custo
       FROM vendas ${wv.clausula}
       GROUP BY periodo ORDER BY periodo`,
      wv.params
    )).rows;

    const saidas = (await pool.query(
      `SELECT to_char(data::timestamptz, '${formato}') as periodo,
              COALESCE(SUM(valor),0) as gastos
       FROM saidas ${ws.clausula}
       GROUP BY periodo ORDER BY periodo`,
      ws.params
    )).rows;

    const contas = (await pool.query(
      `SELECT to_char(data_pagamento::timestamptz, '${formato}') as periodo,
              COALESCE(SUM(valor),0) as pagas
       FROM contas_pagar
       WHERE status = 'paga'
       ${wc.clausula ? 'AND ' + wc.clausula.replace('WHERE ', '') : ''}
       GROUP BY periodo ORDER BY periodo`,
      wc.params
    )).rows;

    res.json({ vendas, saidas, contas });
  });

  // ---------- /api/dashboard/top-produtos ----------
  router.get('/top-produtos', async (req, res) => {
    const por = req.query.por || 'qtd'; // qtd | faturamento | lucro
    const periodo = req.query.periodo || 'total';
    const w = whereData('data', periodo);

    let ordem;
    if (por === 'faturamento') ordem = 'faturamento DESC';
    else if (por === 'lucro') ordem = 'lucro DESC';
    else ordem = 'qtd DESC';

    const { rows } = await pool.query(
      `SELECT produto_nome,
              COALESCE(SUM(quantidade),0) as qtd,
              COALESCE(SUM(valor),0)      as faturamento,
              COALESCE(SUM(valor - custo),0) as lucro
       FROM vendas
       ${w.clausula}
       GROUP BY produto_nome
       ORDER BY ${ordem}
       LIMIT 10`,
      w.params
    );
    res.json(rows);
  });

  // ---------- /api/dashboard/proximas-contas ----------
  router.get('/proximas-contas', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM contas_pagar
       WHERE status = 'pendente'
       ORDER BY vencimento ASC
       LIMIT 5`
    );
    res.json(rows);
  });

  return router;
};
