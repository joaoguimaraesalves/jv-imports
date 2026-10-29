/**
 * Cálculos de dinheiro compartilhados: saldo estimado da conta (Meta de Caixa) e o
 * resumo de longo prazo (Histórico da Loja). Mesma regra da versão Express (lib/financeiro.js).
 */

/**
 * Saldo informado manualmente + o que entrou/saiu depois dele:
 * + vendas recebidas (fiado só conta quando recebido)
 * − contas pagas
 * − compras à vista (dinheiro/pix) feitas no sistema
 * Registros históricos ficam de fora: esse dinheiro já entrou/saiu há tempo.
 */
function saldoConta_(tx) {
  const cfg = tx.linhas('configuracoes').find(function (c) { return c.chave === 'saldo_conta'; });
  const saldoInformado = cfg ? parseFloat(cfg.valor) : null;
  const desde = cfg ? cfg.atualizado_em : null;

  let vendasDesde = 0;
  let contasPagasDesde = 0;
  let comprasVistaDesde = 0;
  if (desde) {
    vendasDesde = soma_(tx.linhas('vendas').filter(function (v) {
      return v.recebido && !v.historico && (v.data_recebimento || v.data) > desde;
    }), 'valor');
    contasPagasDesde = soma_(tx.linhas('contas_pagar').filter(function (c) {
      return c.status === 'paga' && c.data_pagamento && c.data_pagamento > desde;
    }), 'valor');
    comprasVistaDesde = soma_(tx.linhas('compras').filter(function (c) {
      return !c.historico && (c.forma_pagamento === 'dinheiro' || c.forma_pagamento === 'pix') && c.data > desde;
    }), 'valor_total');
  }

  return {
    saldo_informado: saldoInformado,
    saldo_atualizado_em: desde,
    vendas_desde: vendasDesde,
    contas_pagas_desde: contasPagasDesde,
    compras_vista_desde: comprasVistaDesde,
    saldo_estimado: saldoInformado === null ? null : saldoInformado + vendasDesde - contasPagasDesde - comprasVistaDesde,
  };
}

/** Totais de todo o período (históricos + sistema). */
function totaisLongoPrazo_(tx) {
  const vendas = tx.linhas('vendas');
  const compras = tx.linhas('compras');
  const contas = tx.linhas('contas_pagar');
  const produtos = tx.linhas('produtos').filter(function (p) { return p.quantidade > 0; });
  const hist = vendas.filter(function (v) { return v.historico; });
  const menor = function (linhas) {
    return linhas.map(function (l) { return l.data; }).filter(Boolean).sort()[0] || null;
  };
  return {
    vendas: {
      faturamento: soma_(vendas, 'valor'),
      custo: soma_(vendas, 'custo'),
      qtd: soma_(vendas, 'quantidade'),
      faturamento_hist: soma_(hist, 'valor'),
      custo_hist: soma_(hist, 'custo'),
      recebido: soma_(vendas.filter(function (v) { return v.recebido; }), 'valor'),
      primeira_venda: menor(vendas),
    },
    compras: {
      investido: soma_(compras, 'valor_total'),
      pago_direto: soma_(compras.filter(function (c) {
        return c.historico || c.forma_pagamento === 'dinheiro' || c.forma_pagamento === 'pix';
      }), 'valor_total'),
      qtd: compras.length,
      primeira_compra: menor(compras),
    },
    contas: {
      pagas: soma_(contas.filter(function (c) { return c.status === 'paga'; }), 'valor'),
      pendentes: soma_(contas.filter(function (c) { return c.status === 'pendente'; }), 'valor'),
    },
    estoque: {
      valor_custo: produtos.reduce(function (s, p) { return s + (Number(p.custo) || 0) * p.quantidade; }, 0),
      unidades: soma_(produtos, 'quantidade'),
    },
  };
}

/** Monta o resumo a partir dos totais e do saldo. */
function montarResumo_(t, saldo) {
  const lucroTotal = t.vendas.faturamento - t.vendas.custo;
  const lucroHist = t.vendas.faturamento_hist - t.vendas.custo_hist;
  // Entrou (vendas recebidas) − saiu pela loja (compras pagas + contas pagas) − o que está
  // na conta = o que foi retirado ou usado fora da loja. É uma estimativa.
  const entrou = t.vendas.recebido;
  const saiu = t.compras.pago_direto + t.contas.pagas;
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
    retirado_estimado: saldo === null ? null : entrou - saiu - saldo,
    desde: [t.vendas.primeira_venda, t.compras.primeira_compra].filter(Boolean).sort()[0] || null,
  };
}

function resumoAtual_(tx) {
  return montarResumo_(totaisLongoPrazo_(tx), saldoConta_(tx).saldo_estimado);
}
