/**
 * Rotas do sistema: as mesmas URLs da versão Express (/api/...), atendidas pela função
 * api() que o navegador chama com google.script.run. Assim as telas não mudaram.
 */

/** Ponto de entrada chamado pelas telas. Devolve JSON em texto (evita perdas na serialização). */
function api(metodo, url, corpo) {
  const req = interpretarUrl_(url);
  metodo = String(metodo || 'GET').toUpperCase();
  const rota = ROTAS.find(function (r) { return r[0] === metodo && r[1].test(req.caminho); });
  if (!rota) throw erro_('Rota não encontrada: ' + metodo + ' ' + req.caminho);
  const params = req.caminho.match(rota[1]).slice(1);
  const pedido = { params: params, query: req.query, body: corpo || {} };
  // SEM_TRANSACAO: a própria rota cuida da trava (ex.: publicar na Cloudflare, que
  // demora alguns segundos e não pode deixar a planilha travada enquanto isso).
  const resultado = rota[3] === SEM_TRANSACAO ? rota[2](pedido) : transacao_(function (tx) {
    return rota[2](tx, pedido);
  }, metodo === 'GET');
  return JSON.stringify(resultado === undefined ? null : resultado);
}

function interpretarUrl_(url) {
  const partes = String(url).split('?');
  const caminho = partes[0].replace(/^\/?api\//, '').replace(/\/+$/, '');
  const query = {};
  (partes[1] || '').split('&').forEach(function (par) {
    if (!par) return;
    const kv = par.split('=');
    query[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
  });
  return { caminho: caminho, query: query };
}

const SEM_TRANSACAO = 'sem-transacao';

function doArquivoLoja_(nome) {
  return function () { return globalThis[nome].apply(null, arguments); };
}

const ROTAS = [
  ['GET', /^dashboard$/, dashboardResumo_],
  ['GET', /^dashboard\/grafico$/, dashboardGrafico_],
  ['GET', /^dashboard\/top-produtos$/, dashboardTopProdutos_],
  ['GET', /^dashboard\/proximas-contas$/, dashboardProximasContas_],
  ['GET', /^dashboard\/canais$/, dashboardCanais_],
  ['GET', /^dashboard\/meta$/, dashboardMeta_],
  ['PUT', /^dashboard\/meta$/, dashboardMetaSalvar_],
  ['GET', /^config\/vendas$/, configVendasLer_],
  ['PUT', /^config\/vendas$/, configVendasSalvar_],

  ['GET', /^produtos$/, produtosListar_],
  ['POST', /^produtos$/, produtosCriar_],
  ['PUT', /^produtos\/(\d+)$/, produtosEditar_],
  ['DELETE', /^produtos\/(\d+)$/, produtosExcluir_],
  // Loja online (funções em Loja.js; doArquivoLoja_ busca na hora da chamada,
  // porque Loja.js pode carregar depois deste arquivo)
  ['PUT', /^produtos\/(\d+)\/foto$/, doArquivoLoja_('produtosFotoSalvar_')],
  ['DELETE', /^produtos\/(\d+)\/foto$/, doArquivoLoja_('produtosFotoRemover_')],
  ['GET', /^loja\/config$/, doArquivoLoja_('lojaConfigLer_')],
  ['PUT', /^loja\/config$/, doArquivoLoja_('lojaConfigSalvar_')],
  ['GET', /^publicacao$/, doArquivoLoja_('publicacaoSituacao_'), SEM_TRANSACAO],
  ['POST', /^publicacao\/agora$/, doArquivoLoja_('publicacaoAgora_'), SEM_TRANSACAO],
  ['PUT', /^publicacao\/config$/, doArquivoLoja_('publicacaoConfigSalvar_'), SEM_TRANSACAO],

  ['GET', /^vendas$/, vendasListar_],
  ['POST', /^vendas$/, vendasCriar_],
  ['PATCH', /^vendas\/(\d+)\/receber$/, vendasReceber_],
  ['PATCH', /^vendas\/(\d+)\/desfazer-recebimento$/, vendasDesfazerRecebimento_],
  ['DELETE', /^vendas\/(\d+)$/, vendasExcluir_],

  ['GET', /^compras$/, comprasListar_],
  ['GET', /^compras\/(\d+)$/, comprasDetalhe_],
  ['POST', /^compras$/, comprasCriar_],
  ['DELETE', /^compras\/(\d+)$/, comprasExcluir_],

  ['GET', /^contas-pagar$/, contasListar_],
  ['POST', /^contas-pagar$/, contasCriar_],
  ['PATCH', /^contas-pagar\/(\d+)\/pagar$/, contasPagar_],
  ['PATCH', /^contas-pagar\/(\d+)\/desfazer-pagamento$/, contasDesfazerPagamento_],
  ['DELETE', /^contas-pagar\/(\d+)$/, contasExcluir_],

  ['GET', /^estoque\/movimentos$/, estoqueMovimentos_],

  ['GET', /^caixa$/, caixaResumo_],
  ['PUT', /^caixa\/saldo$/, caixaSalvarSaldo_],

  ['GET', /^historico$/, historicoResumo_],
  ['POST', /^historico\/calcular$/, historicoCalcular_],
  ['POST', /^historico\/vendas-antigas$/, historicoVendasAntigas_],
];

/* ============================== Dashboard ============================== */

/** Início do período no fuso de Brasília (null = total, sem filtro). */
function intervaloPeriodo_(periodo) {
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dias = function (n) { const i = new Date(hoje); i.setDate(i.getDate() - n); return i.toISOString(); };
  if (periodo === 'hoje') return hoje.toISOString();
  if (periodo === '7d') return dias(6);
  if (periodo === '30d') return dias(29);
  if (periodo === 'mes') return new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  if (periodo === 'ano') return new Date(agora.getFullYear(), 0, 1).toISOString();
  return null;
}

/**
 * Período anterior do mesmo tamanho, para comparar ("vs período anterior").
 * Mês e ano comparam até o mesmo ponto: 1–29/10 contra 1–29/09.
 */
function intervaloAnterior_(periodo) {
  const agora = new Date();
  const inicio = intervaloPeriodo_(periodo);
  if (!inicio) return null;
  const ini = new Date(inicio);
  if (periodo === 'mes') {
    const a = new Date(ini.getFullYear(), ini.getMonth() - 1, 1);
    return { inicio: a.toISOString(), fim: new Date(a.getTime() + (agora - ini)).toISOString() };
  }
  if (periodo === 'ano') {
    const a = new Date(ini.getFullYear() - 1, 0, 1);
    return { inicio: a.toISOString(), fim: new Date(a.getTime() + (agora - ini)).toISOString() };
  }
  const dias = periodo === 'hoje' ? 1 : periodo === '7d' ? 7 : 30;
  const a = new Date(ini);
  a.setDate(a.getDate() - dias);
  return { inicio: a.toISOString(), fim: ini.toISOString() };
}

function resumoVendas_(vendas) {
  const total = soma_(vendas, 'valor');
  const custos = soma_(vendas, 'custo');
  const despesas = vendas.reduce(function (s, v) { return s + despesasVenda_(v); }, 0);
  const qtd = soma_(vendas, 'quantidade');
  const lucro = total - custos - despesas;
  return {
    total_vendas: total, custos: custos, despesas_venda: despesas, lucro_liquido: lucro, qtd_vendida: qtd,
    ticket_medio: qtd > 0 ? total / qtd : 0,
    margem: total > 0 ? ((lucro / total) * 100).toFixed(2) : 0,
  };
}

function desde_(linhas, campo, periodo) {
  const inicio = intervaloPeriodo_(periodo);
  if (!inicio) return linhas;
  return linhas.filter(function (l) { return l[campo] && l[campo] >= inicio; });
}

function dashboardResumo_(tx, req) {
  const periodo = req.query.periodo || 'total';
  const vendas = desde_(tx.linhas('vendas'), 'data', periodo);
  const pagas = desde_(tx.linhas('contas_pagar').filter(function (c) { return c.status === 'paga'; }), 'data_pagamento', periodo);
  const ant = intervaloAnterior_(periodo);
  const anteriores = ant ? tx.linhas('vendas').filter(function (v) { return v.data && v.data >= ant.inicio && v.data < ant.fim; }) : null;
  return Object.assign(resumoVendas_(vendas), {
    contas_pagas: soma_(pagas, 'valor'),
    periodo: periodo,
    anterior: anteriores ? resumoVendas_(anteriores) : null,
  });
}

const CANAIS_VENDA = ['OLX', 'Facebook', 'Instagram', 'WhatsApp', 'Loja online', 'Presencial', 'Indicação', 'Outro'];

/** Vendas por canal e por forma de pagamento no período. */
function dashboardCanais_(tx, req) {
  const vendas = desde_(tx.linhas('vendas'), 'data', req.query.periodo || 'total').filter(function (v) { return !v.historico; });
  const agrupar = function (campo, vazio) {
    const g = {};
    vendas.forEach(function (v) {
      const k = v[campo] || vazio;
      const x = g[k] || (g[k] = { nome: k, vendas: 0, qtd: 0, faturamento: 0, lucro: 0 });
      x.vendas += 1;
      x.qtd += Number(v.quantidade) || 0;
      x.faturamento += Number(v.valor) || 0;
      x.lucro += lucroVenda_(v);
    });
    return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.faturamento - a.faturamento; });
  };
  return { canais: agrupar('canal', 'Não informado'), pagamentos: agrupar('forma_pagamento', 'Não informado') };
}

function configLer_(tx, chave) {
  const c = tx.linhas('configuracoes').find(function (l) { return l.chave === chave; });
  return c ? c.valor : null;
}

function configGravar_(tx, chave, valor) {
  const agora = agoraIso_();
  const c = tx.linhas('configuracoes').find(function (l) { return l.chave === chave; });
  if (c) { c.valor = valor; c.atualizado_em = agora; tx.alterou('configuracoes'); }
  else tx.inserir('configuracoes', { chave: chave, valor: valor, atualizado_em: agora });
}

/** Meta de faturamento do mês: quanto já vendeu, quanto falta e quanto vender por dia. */
function dashboardMeta_(tx) {
  const meta = num_(configLer_(tx, 'meta_faturamento_mes'));
  const agora = new Date();
  const doMes = desde_(tx.linhas('vendas'), 'data', 'mes').filter(function (v) { return !v.historico; });
  const r = resumoVendas_(doMes);
  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const diasRestantes = diasNoMes - agora.getDate() + 1; // conta hoje
  const temMeta = meta !== null && meta > 0;
  const falta = temMeta ? Math.max(0, meta - r.total_vendas) : null;
  return {
    meta: temMeta ? meta : null,
    mes: Utilities.formatDate(agora, FUSO, 'yyyy-MM'),
    faturamento: r.total_vendas,
    lucro: r.lucro_liquido,
    vendas: doMes.length,
    falta: falta,
    dias_restantes: diasRestantes,
    por_dia: falta !== null ? falta / diasRestantes : null,
    progresso: temMeta ? Math.min(100, (r.total_vendas / meta) * 100) : 0,
  };
}

function dashboardMetaSalvar_(tx, req) {
  const valor = num_(req.body.valor);
  if (valor === null || valor < 0) throw erro_('Meta deve ser um valor em reais (0 para tirar a meta)');
  configGravar_(tx, 'meta_faturamento_mes', String(valor));
  return dashboardMeta_(tx);
}

/** Taxas da maquininha (%) por forma de pagamento. Pix e dinheiro: 0. */
const TAXAS_PADRAO = { pix: 0, dinheiro: 0, cartao: 0, debito: 0 };

function configVendasLer_(tx) {
  let taxas = {};
  try { taxas = JSON.parse(configLer_(tx, 'taxas_pagamento') || '{}') || {}; } catch (e) { taxas = {}; }
  return { taxas: Object.assign({}, TAXAS_PADRAO, taxas), canais: CANAIS_VENDA };
}

function configVendasSalvar_(tx, req) {
  const atual = configVendasLer_(tx).taxas;
  const novas = (req.body && req.body.taxas) || {};
  Object.keys(novas).forEach(function (k) {
    const n = num_(novas[k]);
    if (n === null || n < 0 || n > 30) throw erro_('Taxa inválida para ' + k + ' (use de 0 a 30%)');
    atual[k] = n;
  });
  configGravar_(tx, 'taxas_pagamento', JSON.stringify(atual));
  return configVendasLer_(tx);
}

function dashboardGrafico_(tx, req) {
  const periodo = req.query.periodo || 'total';
  const formato = req.query.agrupar === 'mes' ? 'yyyy-MM' : 'yyyy-MM-dd';
  const chave = function (iso) { return Utilities.formatDate(new Date(iso), FUSO, formato); };

  const vendas = {};
  desde_(tx.linhas('vendas'), 'data', periodo).forEach(function (v) {
    if (!v.data) return;
    const k = chave(v.data);
    const g = vendas[k] || (vendas[k] = { periodo: k, faturamento: 0, custo: 0 });
    g.faturamento += Number(v.valor) || 0;
    g.custo += (Number(v.custo) || 0) + despesasVenda_(v); // taxa e gastos extras também saem do lucro
  });
  const contas = {};
  desde_(tx.linhas('contas_pagar').filter(function (c) { return c.status === 'paga' && c.data_pagamento; }), 'data_pagamento', periodo)
    .forEach(function (c) {
      const k = chave(c.data_pagamento);
      const g = contas[k] || (contas[k] = { periodo: k, pagas: 0 });
      g.pagas += Number(c.valor) || 0;
    });
  const ordenar = function (o) { return Object.keys(o).sort().map(function (k) { return o[k]; }); };
  return { vendas: ordenar(vendas), contas: ordenar(contas) };
}

function dashboardTopProdutos_(tx, req) {
  const por = ['faturamento', 'lucro'].indexOf(req.query.por) >= 0 ? req.query.por : 'qtd';
  const grupos = {};
  desde_(tx.linhas('vendas'), 'data', req.query.periodo || 'total').forEach(function (v) {
    const k = v.produto_nome;
    const g = grupos[k] || (grupos[k] = { produto_nome: k, qtd: 0, faturamento: 0, lucro: 0 });
    g.qtd += Number(v.quantidade) || 0;
    g.faturamento += Number(v.valor) || 0;
    g.lucro += lucroVenda_(v);
  });
  return Object.keys(grupos).map(function (k) { return grupos[k]; })
    .sort(function (a, b) { return b[por] - a[por]; })
    .slice(0, 10);
}

function dashboardProximasContas_(tx) {
  return pendentesPorVencimento_(tx).slice(0, 5);
}

function pendentesPorVencimento_(tx) {
  return tx.linhas('contas_pagar').filter(function (c) { return c.status === 'pendente'; })
    .sort(function (a, b) { return cmp_(a.vencimento, b.vencimento) || a.id - b.id; });
}

/** Comparação de texto com nulos por último (como o ORDER BY do Postgres). */
function cmp_(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

/* ============================== Produtos ============================== */

function produtosListar_(tx) {
  return tx.linhas('produtos').slice().sort(function (a, b) {
    return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  }).map(function (p) {
    // Miniatura da foto (pasta do Drive) só para o painel; o site usa a cópia da Cloudflare
    return Object.assign({}, p, { foto_url: p.foto_id ? 'https://drive.google.com/thumbnail?id=' + p.foto_id + '&sz=w400' : null });
  });
}

function produtosCriar_(tx, req) {
  const b = req.body;
  const p = tx.inserir('produtos', Object.assign({
    nome: b.nome, custo: num_(b.custo), preco: num_(b.preco), quantidade: int_(b.quantidade),
  }, camposLoja_(b, {})));
  return { ok: true, id: p.id };
}

/** Editar cadastro. Se a quantidade mudar, registra um movimento de "ajuste" (auditoria). */
function produtosEditar_(tx, req) {
  const b = req.body;
  if (!b.nome || !String(b.nome).trim()) throw erro_('Informe o nome do produto');
  if ([b.custo, b.preco, b.quantidade].some(function (v) { return !isFinite(Number(v)) || v === '' || v === null || Number(v) < 0; })) {
    throw erro_('Custo, preço e quantidade devem ser números maiores ou iguais a zero');
  }
  const p = tx.porId('produtos', req.params[0]);
  if (!p) throw erro_('Produto não encontrado');
  const anterior = p.quantidade;
  const nova = parseInt(b.quantidade, 10);
  p.nome = String(b.nome).trim();
  p.custo = Number(b.custo);
  p.preco = Number(b.preco);
  p.quantidade = nova;
  Object.assign(p, camposLoja_(b, p));
  tx.alterou('produtos');
  if (nova !== anterior) {
    tx.inserir('estoque_movimentos', {
      produto_id: p.id, tipo: 'ajuste', quantidade: nova - anterior, custo_unitario: Number(b.custo),
      origem_tipo: 'ajuste', origem_id: null, observacao: 'Ajuste manual: ' + anterior + ' → ' + nova, data: agoraIso_(),
    });
  }
  return { ok: true, produto: p };
}

/** Excluir produto: o histórico fica, apontando para "(produto excluído)". */
function produtosExcluir_(tx, req) {
  const id = Number(req.params[0]);
  const produto = tx.porId('produtos', id);
  if (produto && produto.foto_id) apagarFotoDrive_(produto.foto_id); // Loja.js
  ['estoque_movimentos', 'compra_itens'].forEach(function (t) {
    tx.linhas(t).forEach(function (l) { if (l.produto_id === id) l.produto_id = null; });
    tx.alterou(t);
  });
  tx.excluir('produtos', function (p) { return p.id === id; });
  return { ok: true };
}

/* ============================== Vendas ============================== */

function vendasListar_(tx) {
  return tx.linhas('vendas').slice().sort(function (a, b) { return b.id - a.id; });
}

/** Venda: insere, baixa o estoque e registra o movimento. Fiado: recebido false + cliente. */
function vendasCriar_(tx, req) {
  const b = req.body;
  const agora = agoraIso_();
  const recebido = b.recebido !== false;
  const cliente = b.cliente || null;
  if (!recebido && !cliente) throw erro_('Informe o cliente da venda fiado');

  const quantidade = int_(b.quantidade);
  const custo = num_(b.custo);
  if (!quantidade || quantidade <= 0) throw erro_('Quantidade deve ser maior que zero');
  if (num_(b.valor) === null || num_(b.valor) < 0) throw erro_('Valor da venda inválido');
  // A tela também confere, mas com a lista que carregou; aqui vale o estoque de agora.
  const produto = tx.porId('produtos', b.produto_id);
  if (!produto) throw erro_('Produto não encontrado. Atualize a tela e tente de novo.');
  if (quantidade > produto.quantidade) throw erro_('"' + produto.nome + '": só há ' + produto.quantidade + ' no estoque');
  const taxa = num_(b.taxa) || 0;
  const gastos = num_(b.gastos_extras) || 0;
  if (taxa < 0 || gastos < 0) throw erro_('Taxa e gastos extras não podem ser negativos');
  const data = dataDaVenda_(b.data, agora);

  const venda = tx.inserir('vendas', {
    produto_id: int_(b.produto_id), produto_nome: b.produto_nome, quantidade: quantidade, valor: num_(b.valor),
    custo: custo, forma_pagamento: b.forma_pagamento || null, data: data, recebido: recebido, cliente: cliente,
    receber_ate: recebido ? null : (b.receber_ate || null), data_recebimento: recebido ? data : null, historico: false,
    canal: b.canal ? String(b.canal).slice(0, 40) : null, taxa: taxa, gastos_extras: gastos,
  });

  produto.quantidade -= quantidade;
  tx.alterou('produtos');

  tx.inserir('estoque_movimentos', {
    produto_id: venda.produto_id, tipo: 'saida', quantidade: quantidade, custo_unitario: quantidade ? custo / quantidade : 0,
    origem_tipo: 'venda', origem_id: venda.id, observacao: 'Venda #' + venda.id, data: agora,
  });
  return { ok: true, id: venda.id };
}

/**
 * Data escolhida na tela (AAAA-MM-DD). Hoje ou vazio = agora; dia passado = meio-dia
 * daquele dia (fuso de Brasília). Data no futuro é recusada.
 */
function dataDaVenda_(dia, agora) {
  if (!dia) return agora;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia))) throw erro_('Data da venda inválida');
  const hoje = Utilities.formatDate(new Date(agora), FUSO, 'yyyy-MM-dd');
  if (dia === hoje) return agora;
  if (dia > hoje) throw erro_('A data da venda não pode ser no futuro');
  const p = String(dia).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0).toISOString();
}

function vendasReceber_(tx, req) {
  const v = tx.porId('vendas', req.params[0]);
  if (!v || v.recebido) throw erro_('Venda não encontrada ou já recebida');
  v.recebido = true;
  v.data_recebimento = agoraIso_();
  tx.alterou('vendas');
  return { ok: true };
}

function vendasDesfazerRecebimento_(tx, req) {
  const v = tx.porId('vendas', req.params[0]);
  if (!v || !v.receber_ate) throw erro_('Só dá pra desfazer o recebimento de venda fiado');
  v.recebido = false;
  v.data_recebimento = null;
  tx.alterou('vendas');
  return { ok: true };
}

/** Excluir venda: devolve o estoque e remove o movimento. */
function vendasExcluir_(tx, req) {
  const id = Number(req.params[0]);
  const v = tx.porId('vendas', id);
  if (v && v.produto_id) {
    const p = tx.porId('produtos', v.produto_id);
    if (p) { p.quantidade += v.quantidade; tx.alterou('produtos'); }
  }
  tx.excluir('estoque_movimentos', function (m) { return m.origem_tipo === 'venda' && m.origem_id === id; });
  tx.excluir('vendas', function (x) { return x.id === id; });
  return { ok: true };
}

/* ============================== Compras ============================== */

function comprasListar_(tx) {
  return tx.linhas('compras').slice().sort(function (a, b) { return b.id - a.id; });
}

function comprasDetalhe_(tx, req) {
  const id = Number(req.params[0]);
  const c = tx.porId('compras', id);
  if (!c) throw erro_('Compra não encontrada');
  return Object.assign({}, c, { itens: tx.linhas('compra_itens').filter(function (i) { return i.compra_id === id; }) });
}

/** Soma N meses a uma data ISO (1ª parcela = +1 mês, padrão cartão). */
function calcularVencimento_(dataBase, meses) {
  const d = new Date(dataBase);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function validarCompra_(b) {
  if (!b) return 'Payload vazio';
  if (['dinheiro', 'pix', 'cartao'].indexOf(b.forma_pagamento) === -1) return 'Forma de pagamento inválida (use dinheiro, pix ou cartao)';
  const p = parseInt(b.parcelas, 10);
  if (b.forma_pagamento === 'cartao' && (!p || p < 1)) return 'Para cartão, informe o número de parcelas (>= 1)';
  if (!Array.isArray(b.itens) || b.itens.length === 0) return 'A compra precisa ter ao menos 1 item';
  if (b.historico) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) return 'Informe a data da compra antiga';
    if (b.data > hojeIso_()) return 'A data da compra antiga não pode ser no futuro';
  }
  for (let i = 0; i < b.itens.length; i++) {
    const it = b.itens[i];
    if (!it.produto_id && !it.produto_nome) return 'Cada item precisa de produto_id ou produto_nome';
    if (!it.quantidade || it.quantidade <= 0) return 'Quantidade deve ser maior que zero';
    if (it.custo_unitario === undefined || it.custo_unitario === null || it.custo_unitario < 0) return 'Custo unitário inválido';
  }
  return null;
}

/**
 * Criar compra: cabeçalho, produtos (cria ou atualiza), itens, movimentos e, no cartão,
 * as parcelas em contas a pagar. Compra antiga (historico) usa a data informada e não
 * gera conta a pagar nem mexe no saldo.
 */
function comprasCriar_(tx, req) {
  const b = req.body;
  const erro = validarCompra_(b);
  if (erro) throw erro_(erro);

  const historico = b.historico === true;
  const parcelas = parseInt(b.parcelas, 10) || 1;
  const dataISO = historico ? b.data + 'T12:00:00.000Z' : agoraIso_();
  const itens = b.itens.map(function (it) {
    return { produto_id: it.produto_id ? int_(it.produto_id) : null, produto_nome: it.produto_nome,
      quantidade: int_(it.quantidade), custo_unitario: num_(it.custo_unitario) };
  });
  const valorTotal = itens.reduce(function (s, it) { return s + it.quantidade * it.custo_unitario; }, 0);

  const compra = tx.inserir('compras', {
    descricao: b.descricao || null, valor_total: valorTotal, forma_pagamento: b.forma_pagamento,
    parcelas: parcelas, data: dataISO, historico: historico,
  });

  itens.forEach(function (it) {
    let produto;
    if (it.produto_id) {
      produto = tx.porId('produtos', it.produto_id);
      if (!produto) throw erro_('Produto #' + it.produto_id + ' não encontrado');
      // Compra antiga não sobrescreve o custo atual (só preenche se estiver zerado).
      if (!historico || !produto.custo) produto.custo = it.custo_unitario;
      produto.quantidade += it.quantidade;
      tx.alterou('produtos');
    } else {
      produto = tx.inserir('produtos', { nome: it.produto_nome, custo: it.custo_unitario, preco: 0, quantidade: it.quantidade });
    }
    tx.inserir('compra_itens', {
      compra_id: compra.id, produto_id: produto.id, produto_nome: produto.nome,
      quantidade: it.quantidade, custo_unitario: it.custo_unitario,
    });
    tx.inserir('estoque_movimentos', {
      produto_id: produto.id, tipo: 'entrada', quantidade: it.quantidade, custo_unitario: it.custo_unitario,
      origem_tipo: 'compra', origem_id: compra.id,
      observacao: (historico ? 'Compra antiga' : 'Compra') + ' #' + compra.id, data: dataISO,
    });
  });

  // Cartão (inclusive 1x) vira conta(s) a pagar na fatura.
  if (!historico && b.forma_pagamento === 'cartao' && parcelas >= 1) {
    const valorParcela = Math.floor((valorTotal / parcelas) * 100) / 100;
    const valorUltima = Math.round((valorTotal - valorParcela * (parcelas - 1)) * 100) / 100;
    for (let i = 1; i <= parcelas; i++) {
      tx.inserir('contas_pagar', {
        descricao: (b.descricao || 'Compra') + ' — parcela ' + i + '/' + parcelas,
        valor: i === parcelas ? valorUltima : valorParcela, vencimento: calcularVencimento_(dataISO, i),
        status: 'pendente', compra_id: compra.id, parcela_num: i, parcela_total: parcelas,
      });
    }
  }
  return { ok: true, id: compra.id };
}

/** Excluir compra: bloqueia se houver parcela paga; senão devolve o estoque e limpa tudo. */
function comprasExcluir_(tx, req) {
  const id = Number(req.params[0]);
  if (!tx.porId('compras', id)) throw erro_('Compra não encontrada');
  const pagas = tx.linhas('contas_pagar').filter(function (c) { return c.compra_id === id && c.status === 'paga'; });
  if (pagas.length) {
    throw erro_('Esta compra tem parcelas já pagas e não pode ser excluída. Se precisar reverter, exclua as parcelas pagas primeiro.');
  }
  tx.linhas('compra_itens').filter(function (i) { return i.compra_id === id; }).forEach(function (i) {
    const p = tx.porId('produtos', i.produto_id);
    if (p) { p.quantidade -= i.quantidade; tx.alterou('produtos'); }
  });
  tx.excluir('estoque_movimentos', function (m) { return m.origem_tipo === 'compra' && m.origem_id === id; });
  tx.excluir('contas_pagar', function (c) { return c.compra_id === id && c.status === 'pendente'; });
  tx.excluir('compra_itens', function (i) { return i.compra_id === id; });
  tx.excluir('compras', function (c) { return c.id === id; });
  return { ok: true };
}

/* ============================== Contas a pagar ============================== */

function contasListar_(tx, req) {
  const status = req.query.status;
  if (status === 'pendente') return pendentesPorVencimento_(tx);
  const todas = tx.linhas('contas_pagar').slice();
  if (status === 'paga') {
    return todas.filter(function (c) { return c.status === 'paga'; })
      .sort(function (a, b) { return cmp_(b.data_pagamento, a.data_pagamento) || b.id - a.id; });
  }
  return todas.sort(function (a, b) { return cmp_(a.vencimento, b.vencimento) || a.id - b.id; });
}

/** Lançamento avulso. Com "paga: true" já entra como paga (desconta do saldo na hora). */
function contasCriar_(tx, req) {
  const b = req.body;
  if (!b.descricao || !b.valor || !b.vencimento) throw erro_('descricao, valor e vencimento são obrigatórios');
  const c = tx.inserir('contas_pagar', {
    descricao: b.descricao, valor: num_(b.valor), vencimento: b.vencimento,
    status: b.paga ? 'paga' : 'pendente', data_pagamento: b.paga ? agoraIso_() : null,
  });
  return { ok: true, id: c.id };
}

function contasPagar_(tx, req) {
  const c = tx.porId('contas_pagar', req.params[0]);
  if (!c) throw erro_('Conta não encontrada');
  if (c.status === 'paga') throw erro_('Conta já está paga');
  c.status = 'paga';
  c.data_pagamento = agoraIso_();
  tx.alterou('contas_pagar');
  return { ok: true };
}

function contasDesfazerPagamento_(tx, req) {
  const c = tx.porId('contas_pagar', req.params[0]);
  if (!c) throw erro_('Conta não encontrada');
  c.status = 'pendente';
  c.data_pagamento = null;
  tx.alterou('contas_pagar');
  return { ok: true };
}

function contasExcluir_(tx, req) {
  const id = Number(req.params[0]);
  tx.excluir('contas_pagar', function (c) { return c.id === id; });
  return { ok: true };
}

/* ============================== Estoque ============================== */

function estoqueMovimentos_(tx, req) {
  const nomes = {};
  tx.linhas('produtos').forEach(function (p) { nomes[p.id] = p.nome; });
  const filtro = req.query.produto_id ? Number(req.query.produto_id) : null;
  return tx.linhas('estoque_movimentos')
    .filter(function (m) { return filtro === null || m.produto_id === filtro; })
    .map(function (m) {
      return Object.assign({}, m, { produto_nome_atual: m.produto_id && nomes[m.produto_id] !== undefined ? nomes[m.produto_id] : null });
    })
    .sort(function (a, b) { return cmp_(b.data, a.data); });
}

/* ============================== Caixa ============================== */

function caixaResumo_(tx) {
  const saldo = saldoConta_(tx);
  const inicio30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const vendas = tx.linhas('vendas');
  const faturamento30d = soma_(vendas.filter(function (v) { return v.data >= inicio30d && !v.historico; }), 'valor');
  const aReceber = vendas.filter(function (v) { return !v.recebido; });
  return Object.assign({}, saldo, {
    faturamento_30d: faturamento30d,
    media_diaria_vendas: faturamento30d / 30,
    contas_pendentes: pendentesPorVencimento_(tx).map(function (c) {
      return { id: c.id, descricao: c.descricao, valor: c.valor, vencimento: c.vencimento };
    }),
    a_receber: soma_(aReceber, 'valor'),
    a_receber_qtd: aReceber.length,
  });
}

function caixaSalvarSaldo_(tx, req) {
  const saldo = parseFloat(req.body.saldo);
  if (!isFinite(saldo)) throw erro_('saldo deve ser um número');
  const agora = agoraIso_();
  const cfg = tx.linhas('configuracoes').find(function (c) { return c.chave === 'saldo_conta'; });
  if (cfg) {
    cfg.valor = String(saldo);
    cfg.atualizado_em = agora;
    tx.alterou('configuracoes');
  } else {
    tx.inserir('configuracoes', { chave: 'saldo_conta', valor: String(saldo), atualizado_em: agora });
  }
  return { ok: true, saldo: saldo, atualizado_em: agora };
}

/* ============================== Histórico da loja ============================== */

function historicoResumo_(tx) {
  const calculos = tx.linhas('historico_calculos').slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 30);
  return { atual: resumoAtual_(tx), ultimo: calculos[0] || null, calculos: calculos };
}

/** "Calcular histórico": grava um retrato dos totais de hoje (auditoria, nunca é apagado). */
function historicoCalcular_(tx) {
  return tx.inserir('historico_calculos', { data: agoraIso_(), dados: resumoAtual_(tx) });
}

/** Vendas antigas: baixa do estoque o que foi vendido antes do sistema (entram no lucro, não no saldo). */
function historicoVendasAntigas_(tx, req) {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw erro_('Informe a data das vendas antigas');
  if (b.data > hojeIso_()) throw erro_('A data das vendas antigas não pode ser no futuro');
  if (!Array.isArray(b.itens) || b.itens.length === 0) throw erro_('Nenhum produto com venda antiga informado');

  const dataISO = b.data + 'T12:00:00.000Z';
  const criadas = [];
  b.itens.forEach(function (it) {
    const qtd = parseInt(it.quantidade, 10);
    const valor = parseFloat(it.valor);
    if (!qtd || qtd <= 0) throw erro_('Quantidade inválida');
    if (!isFinite(valor) || valor < 0) throw erro_('Valor recebido inválido');
    const p = tx.porId('produtos', it.produto_id);
    if (!p) throw erro_('Produto #' + it.produto_id + ' não encontrado');
    if (qtd > p.quantidade) throw erro_('"' + p.nome + '": só há ' + p.quantidade + ' no estoque do sistema');

    const venda = tx.inserir('vendas', {
      produto_id: p.id, produto_nome: p.nome, quantidade: qtd, valor: valor, custo: p.custo * qtd,
      forma_pagamento: null, data: dataISO, recebido: true, data_recebimento: dataISO, historico: true,
    });
    const preco = parseFloat(it.preco);
    p.quantidade -= qtd;
    if (!p.preco && isFinite(preco) && preco > 0) p.preco = preco;
    tx.alterou('produtos');
    tx.inserir('estoque_movimentos', {
      produto_id: p.id, tipo: 'saida', quantidade: qtd, custo_unitario: p.custo, origem_tipo: 'venda',
      origem_id: venda.id, observacao: 'Venda antiga #' + venda.id, data: dataISO,
    });
    criadas.push(venda.id);
  });
  return { ok: true, vendas: criadas };
}

/**
 * Campos da loja online vindos do cadastro do produto. O que não vier no pedido
 * mantém o valor atual (mesma regra do routes/produtos.js da versão Node).
 */
function camposLoja_(b, atual) {
  const texto = function (v, max) { return v === undefined ? undefined : (String(v || '').trim().slice(0, max) || null); };
  const bool = function (v) { return v === undefined ? undefined : (v === true || v === 'true' || v === 1 || v === '1'); };
  const c = {
    descricao: texto(b.descricao, 2000),
    categoria: texto(b.categoria, 60),
    na_loja: bool(b.na_loja),
    destaque: bool(b.destaque),
    preco_antigo: b.preco_antigo === undefined ? undefined : (Number(b.preco_antigo) > 0 ? Number(b.preco_antigo) : null),
  };
  Object.keys(c).forEach(function (k) {
    if (c[k] !== undefined) return;
    const v = atual[k];
    c[k] = v !== undefined && v !== null ? v : (k === 'na_loja' ? true : k === 'destaque' ? false : null);
  });
  return c;
}

/* ============================== Utilidades ============================== */

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function int_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isFinite(n) ? n : null;
}
