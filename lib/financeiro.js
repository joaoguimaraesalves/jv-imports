// lib/financeiro.js
// Cálculos de dinheiro compartilhados entre rotas: saldo estimado da conta
// (Meta de Caixa) e o resumo de longo prazo (Histórico da Loja).

// Saldo informado manualmente + o que entrou/saiu depois dele:
// + vendas recebidas (fiado só conta quando recebido)
// − contas pagas
// − compras à vista (dinheiro/pix) feitas no sistema
// Registros históricos ficam de fora: esse dinheiro já entrou/saiu há tempo.
async function saldoConta(pool) {
  const cfg = (await pool.query(
    `SELECT valor, atualizado_em FROM configuracoes WHERE chave = 'saldo_conta'`
  )).rows[0];

  const saldoInformado = cfg ? parseFloat(cfg.valor) : null;
  const desde = cfg ? cfg.atualizado_em : null;

  let vendasDesde = 0, contasPagasDesde = 0, comprasVistaDesde = 0;
  if (desde) {
    vendasDesde = (await pool.query(
      `SELECT COALESCE(SUM(valor),0) as total FROM vendas
       WHERE recebido AND NOT historico AND COALESCE(data_recebimento, data) > $1`, [desde]
    )).rows[0].total;
    contasPagasDesde = (await pool.query(
      `SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar
       WHERE status = 'paga' AND data_pagamento > $1`, [desde]
    )).rows[0].total;
    comprasVistaDesde = (await pool.query(
      `SELECT COALESCE(SUM(valor_total),0) as total FROM compras
       WHERE NOT historico AND forma_pagamento IN ('dinheiro', 'pix') AND data > $1`, [desde]
    )).rows[0].total;
  }

  return {
    saldo_informado: saldoInformado,
    saldo_atualizado_em: desde,
    vendas_desde: vendasDesde,
    contas_pagas_desde: contasPagasDesde,
    compras_vista_desde: comprasVistaDesde,
    saldo_estimado: saldoInformado === null
      ? null
      : saldoInformado + vendasDesde - contasPagasDesde - comprasVistaDesde,
  };
}

// Totais de todo o período (históricos + sistema), direto do banco
async function totaisLongoPrazo(pool) {
  const q = async (sql) => (await pool.query(sql)).rows[0];

  const vendas = await q(`
    SELECT COALESCE(SUM(valor),0) as faturamento,
           COALESCE(SUM(custo),0) as custo,
           COALESCE(SUM(quantidade),0) as qtd,
           COALESCE(SUM(valor) FILTER (WHERE historico),0) as faturamento_hist,
           COALESCE(SUM(custo) FILTER (WHERE historico),0) as custo_hist,
           COALESCE(SUM(valor) FILTER (WHERE recebido),0) as recebido,
           MIN(data) as primeira_venda
    FROM vendas`);
  const compras = await q(`
    SELECT COALESCE(SUM(valor_total),0) as investido,
           COALESCE(SUM(valor_total) FILTER (WHERE historico OR forma_pagamento IN ('dinheiro','pix')),0) as pago_direto,
           COUNT(*) as qtd,
           MIN(data) as primeira_compra
    FROM compras`);
  const contas = await q(`
    SELECT COALESCE(SUM(valor) FILTER (WHERE status = 'paga'),0) as pagas,
           COALESCE(SUM(valor) FILTER (WHERE status = 'pendente'),0) as pendentes
    FROM contas_pagar`);
  const estoque = await q(`
    SELECT COALESCE(SUM(custo * quantidade) FILTER (WHERE quantidade > 0),0) as valor_custo,
           COALESCE(SUM(quantidade) FILTER (WHERE quantidade > 0),0) as unidades
    FROM produtos`);

  return { vendas, compras, contas, estoque };
}

// Monta o resumo a partir dos totais e do saldo (função pura, testável)
function montarResumo(t, saldo) {
  const lucroTotal = t.vendas.faturamento - t.vendas.custo;
  const lucroHist = t.vendas.faturamento_hist - t.vendas.custo_hist;

  // Dinheiro que entrou (vendas recebidas) − o que saiu pela loja (compras
  // pagas + contas pagas) − o que ainda está na conta = o que foi retirado
  // ou usado fora da loja. É uma estimativa.
  const entrou = t.vendas.recebido;
  const saiu = t.compras.pago_direto + t.contas.pagas;
  const retirado = saldo === null ? null : entrou - saiu - saldo;

  return {
    faturamento_total: t.vendas.faturamento,
    custo_vendido: t.vendas.custo,
    lucro_total: lucroTotal,
    lucro_vendas_antigas: lucroHist,
    lucro_vendas_sistema: lucroTotal - lucroHist,
    margem: t.vendas.faturamento > 0 ? (lucroTotal / t.vendas.faturamento) * 100 : 0,
    unidades_vendidas: t.vendas.qtd,
    investido_total: t.compras.investido,
    compras_qtd: t.compras.qtd,
    estoque_valor_custo: t.estoque.valor_custo,
    estoque_unidades: t.estoque.unidades,
    contas_pendentes: t.contas.pendentes,
    dinheiro_entrou: entrou,
    dinheiro_saiu: saiu,
    saldo_conta: saldo,
    retirado_estimado: retirado,
    desde: [t.vendas.primeira_venda, t.compras.primeira_compra].filter(Boolean).sort()[0] || null,
  };
}

module.exports = { saldoConta, totaisLongoPrazo, montarResumo };
