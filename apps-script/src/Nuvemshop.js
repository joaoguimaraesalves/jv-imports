/**
 * Integração com a Nuvemshop (loja https://jvimportsdf.lojavirtualnuvem.com.br).
 *
 * O painel continua sendo a fonte da verdade do estoque. A cada 5 min (gatilho) e logo
 * depois de cada gravação no painel, sincronizarNuvemshop_() faz:
 *   1) Vendas: pedido PAGO na Nuvemshop vira venda no painel (canal "Nuvemshop"), uma linha
 *      por item, sem repetir (coluna vendas.origem = "ns:<pedido>:<variante>"), e baixa o
 *      estoque. Pedido cancelado ou estornado depois de importado: as vendas dele são
 *      excluídas (o estoque do painel volta; a Nuvemshop devolve o dela sozinha).
 *   2) Estoque: para cada produto ligado, envia para a Nuvemshop
 *      estoque do painel − itens de pedidos ainda não pagos (a Nuvemshop já separou esses).
 *
 * Ligação painel ↔ Nuvemshop: colunas produtos.ns_produto_id / ns_variante_id. Na conexão
 * liga sozinho pelo nome (a loja foi montada com os mesmos nomes) ou pelo SKU = id do
 * painel; o que sobrar é ligado na tela Loja Online.
 *
 * Conexão: o plano grátis não tem "Aplicativos sob medida", então é um app (grátis) no
 * Portal de Parceiros com a URL de redirecionamento = link /exec deste painel. A Nuvemshop
 * devolve ?code=... no doGet, que troca pelo token (não expira). Ver README "Ligar a Nuvemshop".
 */

const NS_API = 'https://api.nuvemshop.com.br/';
const NS_AUTORIZAR = 'https://www.nuvemshop.com.br/apps/';
const NS_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const NS_VERSOES = ['2025-03', 'v1'];
const NS_UA = 'JV Imports Painel (https://jvimportsdf.lojavirtualnuvem.com.br)';
const NS_CANAL = 'Nuvemshop';
const NS_PROP_ESTADO = 'NS_ESTADO';
const NS_FOLGA_MS = 2 * 3600 * 1000;       // relê 2 h para trás (pedido pago enquanto rodava)
const NS_JANELA_MS = 30 * 864e5;           // nunca busca mais de 30 dias
const NS_DESDE_ANTIGOS = '2026-11-09T00:00:00-03:00'; // loja montada em 09/11/2026

/* ============================== Credenciais e estado ============================== */

function nsProps_() {
  return PropertiesService.getScriptProperties();
}

function nsCred_() {
  const p = nsProps_();
  const c = { token: p.getProperty('NS_TOKEN'), loja: p.getProperty('NS_LOJA_ID'), versao: p.getProperty('NS_VERSAO') || NS_VERSOES[0] };
  return c.token && c.loja ? c : null;
}

function nsEstado_() {
  try { return JSON.parse(nsProps_().getProperty(NS_PROP_ESTADO) || '{}'); } catch (e) { return {}; }
}

function nsSalvarEstado_(estado) {
  nsProps_().setProperty(NS_PROP_ESTADO, JSON.stringify(estado));
}

/* ============================== API ============================== */

function nsCabecalhos_(token) {
  // "Authentication: bearer" é o da API v1; "Authorization: Bearer" o das versões novas.
  return { Authorization: 'Bearer ' + token, Authentication: 'bearer ' + token, 'User-Agent': NS_UA };
}

/** Chamada à API. Lista vazia na Nuvemshop volta 404 ("Last page is 0"): vira null. */
function nsApi_(metodo, caminho, corpo, cred) {
  const c = cred || nsCred_();
  if (!c) throw new Error('Nuvemshop não conectada');
  const url = NS_API + c.versao + '/' + encodeURIComponent(c.loja) + caminho;
  const opcoes = { method: metodo, headers: nsCabecalhos_(c.token), muteHttpExceptions: true };
  if (corpo !== undefined) { opcoes.payload = JSON.stringify(corpo); opcoes.contentType = 'application/json'; }
  let r;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    r = UrlFetchApp.fetch(url, opcoes);
    if (r.getResponseCode() !== 429) break;
    Utilities.sleep(1000 * (tentativa + 1)); // limite: 2 por segundo
  }
  const codigo = r.getResponseCode();
  const texto = r.getContentText();
  if (codigo === 404 && metodo === 'get') return null;
  if (codigo === 401 || codigo === 403) {
    throw new Error('A Nuvemshop recusou o acesso (app desinstalado ou token trocado). Conecte de novo na tela Loja Online.');
  }
  if (codigo >= 300) {
    let detalhe = '';
    try { const j = JSON.parse(texto); detalhe = j.description || j.message || j.error_description || ''; if (typeof detalhe !== 'string') detalhe = JSON.stringify(detalhe); } catch (e) { detalhe = String(texto).slice(0, 200); }
    throw new Error('Nuvemshop respondeu ' + codigo + (detalhe ? ': ' + detalhe : ''));
  }
  return texto ? JSON.parse(texto) : null;
}

/** Todas as páginas de uma lista (200 por página). */
function nsListar_(caminho, filtros) {
  const todos = [];
  for (let pagina = 1; pagina <= 25; pagina++) {
    const q = Object.assign({}, filtros || {}, { per_page: 200, page: pagina });
    const qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    const lote = nsApi_('get', caminho + '?' + qs);
    if (!lote || !lote.length) break;
    lote.forEach(function (x) { todos.push(x); });
    if (lote.length < 200) break;
  }
  return todos;
}

/* ============================== Conexão (OAuth) ============================== */

/** Link que o dono abre para instalar o app na loja (state evita link forjado). */
function nsLinkAutorizar_() {
  const p = nsProps_();
  const app = p.getProperty('NS_APP_ID');
  if (!app) return null;
  let state = p.getProperty('NS_STATE');
  if (!state) { state = Utilities.getUuid(); p.setProperty('NS_STATE', state); }
  return NS_AUTORIZAR + encodeURIComponent(app) + '/authorize?state=' + encodeURIComponent(state);
}

/** doGet com ?code=...: troca o código pelo token e testa a loja. Devolve a mensagem para a tela. */
function nsReceberCodigo_(parametros) {
  const p = nsProps_();
  const app = p.getProperty('NS_APP_ID');
  const segredo = p.getProperty('NS_CLIENT_SECRET');
  if (!app || !segredo) throw new Error('Preencha o App ID e o Client Secret na tela Loja Online antes de autorizar.');
  if (parametros.state && p.getProperty('NS_STATE') && parametros.state !== p.getProperty('NS_STATE')) {
    throw new Error('Link de autorização inválido. Abra de novo pelo botão da tela Loja Online.');
  }
  const r = UrlFetchApp.fetch(NS_TOKEN_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'User-Agent': NS_UA },
    payload: JSON.stringify({ client_id: app, client_secret: segredo, grant_type: 'authorization_code', code: String(parametros.code) }),
  });
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) { /* sem JSON */ }
  if (r.getResponseCode() >= 300 || !j.access_token) {
    throw new Error('A Nuvemshop não liberou o acesso' + (j.error_description || j.error ? ': ' + (j.error_description || j.error) : '') +
      '. O código vale só 5 minutos: autorize de novo pela tela Loja Online.');
  }
  const loja = String(j.user_id || j.store_id);

  // Descobre a versão da API que responde e o nome da loja
  let versao = null;
  let dadosLoja = null;
  for (let i = 0; i < NS_VERSOES.length && !versao; i++) {
    try {
      dadosLoja = nsApi_('get', '/store', undefined, { token: j.access_token, loja: loja, versao: NS_VERSOES[i] });
      if (dadosLoja) versao = NS_VERSOES[i];
    } catch (e) { if (i === NS_VERSOES.length - 1) throw e; }
  }
  if (!versao) throw new Error('A API da Nuvemshop não respondeu para a loja ' + loja);

  p.setProperty('NS_TOKEN', j.access_token);
  p.setProperty('NS_LOJA_ID', loja);
  p.setProperty('NS_VERSAO', versao);
  p.deleteProperty('NS_STATE');
  const nome = dadosLoja && dadosLoja.name ? (typeof dadosLoja.name === 'object' ? (dadosLoja.name.pt || Object.values(dadosLoja.name)[0]) : dadosLoja.name) : '';
  nsSalvarEstado_({ inicio: agoraIso_(), loja_nome: nome || ('Loja ' + loja) });

  ativarSincronizacaoNuvemshop_();
  const s = nsConectarPrimeiraVez_();
  return 'Nuvemshop conectada' + (nome ? ' (' + nome + ')' : '') + '. ' + s;
}

function ativarSincronizacaoNuvemshop_() {
  const existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sincronizarNuvemshopPeriodico'; });
  if (!existe) ScriptApp.newTrigger('sincronizarNuvemshopPeriodico').timeBased().everyMinutes(5).create();
}

/**
 * Logo depois de conectar: liga os produtos e procura pedidos pagos antes da conexão
 * (desde a montagem da loja). Se houver, o envio de estoque fica parado até o dono decidir
 * se importa esses pedidos ou se já lançou à mão — senão o painel subiria o estoque da
 * Nuvemshop com vendas que ele ainda não conhece.
 */
function nsConectarPrimeiraVez_() {
  const estado = nsEstado_();
  const produtosNs = nsListar_('/products', {});
  const ligados = transacao_(function (tx) { return nsLigarAutomatico_(tx, produtosNs); }, false);
  const antigos = nsListar_('/orders', { payment_status: 'paid', created_at_min: NS_DESDE_ANTIGOS, created_at_max: estado.inicio })
    .filter(function (o) { return o.status !== 'cancelled'; })
    .map(nsResumoPedido_);
  estado.antigos = antigos;
  estado.aguardando_antigos = antigos.length > 0;
  nsSalvarEstado_(estado);
  let msg = ligados + ' produto(s) ligado(s) pelo nome.';
  if (antigos.length) msg += ' Há ' + antigos.length + ' pedido(s) pago(s) antes da conexão: decida na tela Loja Online se importa.';
  else msg += ' ' + (sincronizarNuvemshop_({}).resumo || '');
  return msg;
}

function nsResumoPedido_(o) {
  return {
    id: String(o.id), numero: o.number, data: o.paid_at || o.created_at, total: Number(o.total) || 0,
    cliente: (o.customer && o.customer.name) || o.contact_name || '',
    itens: (o.products || []).map(function (i) { return Number(i.quantity) + '× ' + i.name; }).join(', '),
  };
}

/* ============================== Ligação dos produtos ============================== */

function nsNormalizar_(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nsNomeProduto_(p) {
  const n = p.name;
  return n && typeof n === 'object' ? (n.pt || n.es || Object.values(n)[0] || '') : String(n || '');
}

/** Variantes da Nuvemshop: id → { produto, variante, nome, estoque, sku }. */
function nsVariantes_(produtosNs) {
  const mapa = {};
  produtosNs.forEach(function (p) {
    const nome = nsNomeProduto_(p);
    const variantes = p.variants || [];
    variantes.forEach(function (v) {
      const valores = (v.values || []).map(function (x) { return x && typeof x === 'object' ? (x.pt || Object.values(x)[0]) : x; }).filter(Boolean);
      mapa[String(v.id)] = {
        produto: String(p.id), variante: String(v.id), sku: v.sku ? String(v.sku) : '',
        nome: nome + (variantes.length > 1 && valores.length ? ' (' + valores.join(' / ') + ')' : ''),
        estoque: v.stock === null || v.stock === undefined || v.stock === '' ? null : Number(v.stock),
        unica: variantes.length === 1,
      };
    });
  });
  return mapa;
}

/** Liga pelo SKU (= id do painel) ou pelo nome igual. Só produtos de variante única. */
function nsLigarAutomatico_(tx, produtosNs) {
  const variantes = nsVariantes_(produtosNs);
  const produtos = tx.linhas('produtos');
  const usadas = {};
  produtos.forEach(function (p) { if (p.ns_variante_id) usadas[p.ns_variante_id] = true; });
  let ligados = 0;
  const livres = Object.keys(variantes).map(function (k) { return variantes[k]; }).filter(function (v) { return !usadas[v.variante]; });
  produtos.forEach(function (p) {
    if (p.ns_variante_id) return;
    const porSku = livres.filter(function (v) { return !usadas[v.variante] && v.sku && v.sku.replace(/^JV-?/i, '') === String(p.id); });
    const porNome = livres.filter(function (v) { return !usadas[v.variante] && v.unica && nsNormalizar_(v.nome) === nsNormalizar_(p.nome); });
    const achou = porSku.length === 1 ? porSku[0] : porNome.length === 1 ? porNome[0] : null;
    if (!achou) return;
    p.ns_produto_id = achou.produto;
    p.ns_variante_id = achou.variante;
    usadas[achou.variante] = true;
    ligados++;
  });
  if (ligados) tx.alterou('produtos');
  return ligados;
}

/* ============================== Pedidos → vendas ============================== */

function nsFormaPagamento_(pedido) {
  const m = String((pedido.payment_details && pedido.payment_details.method) || '').toLowerCase();
  if (m === 'credit_card') return 'cartao';
  if (m === 'debit_card') return 'debito';
  if (m === 'pix') return 'pix';
  if (m === 'cash') return 'dinheiro';
  return m || 'nuvemshop';
}

function nsPedidoDaOrigem_(origem) {
  const m = /^ns:([^:]+):/.exec(String(origem || ''));
  return m ? m[1] : null;
}

function nsArredondar_(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Importa os pedidos (já filtrados pelo período) dentro de uma transação.
 * Pago e ainda não importado → vendas. Cancelado/estornado e já importado → desfaz.
 */
function nsImportarPedidos_(tx, pedidos, inicio) {
  const res = { importados: [], desfeitos: [], avisos: [] };
  const jaImportado = {};
  tx.linhas('vendas').forEach(function (v) {
    const id = nsPedidoDaOrigem_(v.origem);
    if (id) (jaImportado[id] = jaImportado[id] || []).push(v.id);
  });
  const porVariante = {};
  tx.linhas('produtos').forEach(function (p) { if (p.ns_variante_id) porVariante[String(p.ns_variante_id)] = p; });

  pedidos.forEach(function (pedido) {
    const id = String(pedido.id);
    const cancelado = pedido.status === 'cancelled' || pedido.payment_status === 'refunded' || pedido.payment_status === 'voided';
    if (cancelado) {
      if (!jaImportado[id]) return;
      jaImportado[id].forEach(function (vendaId) { vendasExcluir_(tx, { params: [vendaId] }); });
      delete jaImportado[id];
      res.desfeitos.push(pedido.number);
      return;
    }
    if (pedido.payment_status !== 'paid' || jaImportado[id]) return;
    const quando = pedido.paid_at || pedido.created_at;
    if (inicio && quando && Date.parse(quando) < Date.parse(inicio)) return; // antes da conexão: só pela tela

    const data = quando && isFinite(Date.parse(quando)) ? new Date(quando).toISOString() : agoraIso_();
    const subtotal = Number(pedido.subtotal) || 0;
    const frete = Number(pedido.shipping_cost_customer) || 0;
    const semFrete = (Number(pedido.total) || 0) - frete;
    const fator = subtotal > 0 && semFrete > 0 ? Math.min(1, semFrete / subtotal) : 1; // descontos/cupom
    const cliente = ((pedido.customer && pedido.customer.name) || pedido.contact_name || 'Cliente') + ' · pedido #' + pedido.number;
    const forma = nsFormaPagamento_(pedido);
    jaImportado[id] = [];

    (pedido.products || []).forEach(function (item) {
      const qtd = parseInt(item.quantity, 10) || 0;
      if (qtd <= 0) return;
      const produto = porVariante[String(item.variant_id)] || null;
      const valor = nsArredondar_((Number(item.price) || 0) * qtd * fator);
      const custo = produto ? nsArredondar_((Number(produto.custo) || 0) * qtd) : 0;
      const venda = tx.inserir('vendas', {
        produto_id: produto ? produto.id : null, produto_nome: produto ? produto.nome : item.name,
        quantidade: qtd, valor: valor, custo: custo, forma_pagamento: forma, data: data, recebido: true,
        cliente: cliente.slice(0, 120), receber_ate: null, data_recebimento: data, historico: false,
        canal: NS_CANAL, taxa: 0, gastos_extras: 0, origem: 'ns:' + id + ':' + item.variant_id,
      });
      jaImportado[id].push(venda.id);
      if (!produto) {
        res.avisos.push('Pedido #' + pedido.number + ': "' + item.name + '" não está ligado a um produto do painel (venda lançada sem baixar estoque).');
        return;
      }
      produto.quantidade = (Number(produto.quantidade) || 0) - qtd;
      if (produto.quantidade < 0) res.avisos.push('"' + produto.nome + '" ficou com estoque negativo (' + produto.quantidade + ') depois do pedido #' + pedido.number + '.');
      tx.alterou('produtos');
      tx.inserir('estoque_movimentos', {
        produto_id: produto.id, tipo: 'saida', quantidade: qtd, custo_unitario: Number(produto.custo) || 0,
        origem_tipo: 'venda', origem_id: venda.id, observacao: 'Nuvemshop pedido #' + pedido.number, data: agoraIso_(),
      });
    });
    res.importados.push({ numero: pedido.number, cliente: cliente, total: Number(pedido.total) || 0, data: data });
  });
  return res;
}

/** Itens de pedidos abertos e não pagos: a Nuvemshop já tirou do estoque dela. */
function nsReservados_(pendentes) {
  const r = {};
  pendentes.forEach(function (o) {
    if (o.status === 'cancelled' || o.payment_status === 'paid') return;
    (o.products || []).forEach(function (i) {
      const k = String(i.variant_id);
      r[k] = (r[k] || 0) + (parseInt(i.quantity, 10) || 0);
    });
  });
  return r;
}

/* ============================== Estoque → Nuvemshop ============================== */

function nsEnviarEstoque_(v, alvo) {
  try {
    nsApi_('put', '/products/' + v.produto + '/variants/' + v.variante, { stock: alvo });
  } catch (e) {
    if (/Nuvemshop recusou/.test(e.message)) throw e;
    // Loja com vários depósitos não aceita "stock" no PUT: usa a rota própria de estoque
    nsApi_('post', '/products/' + v.produto + '/variants/stock', { action: 'replace', value: alvo, id: Number(v.variante) });
  }
}

/* ============================== Sincronização ============================== */

/** Gatilho de 5 min. */
function sincronizarNuvemshopPeriodico() {
  sincronizarNuvemshop_({ fresco: true });
}

/** Chamada pela tela depois de cada gravação (em segundo plano). */
function sincronizarNuvemshopAgora() {
  if (!nsCred_()) return JSON.stringify({ ok: false, erro: 'Nuvemshop não conectada' });
  return JSON.stringify(sincronizarNuvemshop_({}));
}

/**
 * Uma sincronização por vez (a trava do script é da planilha; aqui basta uma marca no
 * cache). Se chegar outra enquanto roda, a que está rodando dá mais uma volta no fim.
 */
function sincronizarNuvemshop_(opcoes) {
  if (!nsCred_()) return { ok: false, erro: 'Nuvemshop não conectada' };
  const cache = CacheService.getScriptCache();
  if (cache.get('jv:ns:rodando')) { cache.put('jv:ns:pendente', '1', 600); return { ok: true, enfileirado: true }; }
  cache.put('jv:ns:rodando', '1', 300);
  try {
    let r;
    let voltas = 0;
    do {
      cache.remove('jv:ns:pendente');
      r = nsSincronizarUmaVez_(voltas === 0 ? opcoes : {});
    } while (++voltas < 3 && cache.get('jv:ns:pendente'));
    return r;
  } finally {
    cache.remove('jv:ns:rodando');
  }
}

function nsSincronizarUmaVez_(opcoes) {
  const estado = nsEstado_();
  const comeco = Date.now();
  try {
    if (opcoes.fresco) limparCache(); // pega edições feitas direto na planilha

    // 1) Pedidos alterados desde a última vez → vendas
    const ultimo = Date.parse(estado.desde || estado.inicio || 0) || 0;
    const desde = new Date(Math.max(ultimo - NS_FOLGA_MS, comeco - NS_JANELA_MS)).toISOString();
    const pedidos = nsListar_('/orders', { updated_at_min: desde });
    const imp = pedidos.length
      ? transacao_(function (tx) { return nsImportarPedidos_(tx, pedidos, estado.inicio); }, false)
      : { importados: [], desfeitos: [], avisos: [] };

    // 2) Produtos da Nuvemshop (estoque atual de lá) e ligação automática de produtos novos
    const produtosNs = nsListar_('/products', {});
    const variantes = nsVariantes_(produtosNs);
    transacao_(function (tx) { return nsLigarAutomatico_(tx, produtosNs); }, false);

    // 3) Estoque do painel → Nuvemshop (parado enquanto o dono não decide os pedidos antigos)
    let enviados = 0;
    const avisos = imp.avisos.slice();
    const produtos = transacao_(function (tx) { return tx.linhas('produtos').map(function (p) { return Object.assign({}, p); }); }, true);
    const ligadasNoPainel = {};
    if (!estado.aguardando_antigos) {
      const pendentes = nsListar_('/orders', { status: 'open', payment_status: 'pending', created_at_min: new Date(comeco - NS_JANELA_MS).toISOString() })
        .concat(nsListar_('/orders', { status: 'open', payment_status: 'authorized', created_at_min: new Date(comeco - NS_JANELA_MS).toISOString() }));
      const reservados = nsReservados_(pendentes);
      produtos.forEach(function (p) {
        if (!p.ns_variante_id) return;
        ligadasNoPainel[p.ns_variante_id] = true;
        const v = variantes[String(p.ns_variante_id)];
        if (!v) { avisos.push('"' + p.nome + '" estava ligado a um produto que não existe mais na Nuvemshop.'); return; }
        const alvo = Math.max(0, (Number(p.quantidade) || 0) - (reservados[v.variante] || 0));
        if (v.estoque === alvo) return;
        nsEnviarEstoque_(v, alvo);
        enviados++;
      });
    } else {
      produtos.forEach(function (p) { if (p.ns_variante_id) ligadasNoPainel[p.ns_variante_id] = true; });
    }

    const historico = (imp.importados || []).concat(estado.ultimos_importados || []).slice(0, 10);
    const novo = Object.assign({}, estado, {
      desde: new Date(comeco).toISOString(), ultima: agoraIso_(), erro: null, avisos: avisos.slice(0, 20),
      ultimos_importados: historico,
      ligados: produtos.filter(function (p) { return p.ns_variante_id; }).length,
      sem_ligacao_painel: produtos.filter(function (p) { return !p.ns_variante_id && p.na_loja !== false; })
        .map(function (p) { return { id: p.id, nome: p.nome }; }),
      sem_ligacao_ns: Object.keys(variantes).filter(function (k) { return !ligadasNoPainel[k]; })
        .map(function (k) { return { variante: k, produto: variantes[k].produto, nome: variantes[k].nome }; }),
    });
    nsSalvarEstado_(novo);
    const partes = [];
    if (imp.importados.length) partes.push(imp.importados.length + ' pedido(s) importado(s)');
    if (imp.desfeitos.length) partes.push(imp.desfeitos.length + ' cancelado(s) desfeito(s)');
    partes.push(enviados + ' estoque(s) atualizado(s) na Nuvemshop');
    return { ok: true, importados: imp.importados.length, desfeitos: imp.desfeitos.length, enviados: enviados, resumo: partes.join(', ') + '.' };
  } catch (e) {
    estado.erro = e.message;
    estado.ultima_tentativa = agoraIso_();
    nsSalvarEstado_(estado);
    console.error('Sincronizar Nuvemshop: ' + e.message);
    return { ok: false, erro: e.message };
  }
}

/* ============================== Rotas (tela Loja Online) ============================== */

function nuvemshopSituacao_() {
  const p = nsProps_();
  const e = nsEstado_();
  let redirecionamento = '';
  try { redirecionamento = ScriptApp.getService().getUrl() || ''; } catch (err) { /* fora do web app */ }
  return {
    conectado: !!nsCred_(),
    app_id: p.getProperty('NS_APP_ID') || '',
    tem_segredo: !!p.getProperty('NS_CLIENT_SECRET'),
    link_autorizar: nsLinkAutorizar_(),
    redirecionamento: redirecionamento,
    loja: e.loja_nome || '',
    inicio: e.inicio || null,
    ultima: e.ultima || null,
    erro: e.erro || null,
    avisos: e.avisos || [],
    ligados: e.ligados || 0,
    sem_ligacao_painel: e.sem_ligacao_painel || [],
    sem_ligacao_ns: e.sem_ligacao_ns || [],
    ultimos_importados: e.ultimos_importados || [],
    antigos: e.aguardando_antigos ? (e.antigos || []) : [],
  };
}

/** Salva App ID e Client Secret do app do Portal de Parceiros. */
function nuvemshopConfigSalvar_(req) {
  const b = req.body || {};
  const p = nsProps_();
  const app = String(b.app_id || '').trim();
  const segredo = String(b.client_secret || '').trim();
  if (!/^\d{2,10}$/.test(app)) throw erro_('App ID inválido: é o número do app no Portal de Parceiros da Nuvemshop.');
  if (!segredo && !p.getProperty('NS_CLIENT_SECRET')) throw erro_('Cole o Client Secret do app.');
  if (p.getProperty('NS_APP_ID') !== app) p.deleteProperty('NS_STATE');
  p.setProperty('NS_APP_ID', app);
  if (segredo) p.setProperty('NS_CLIENT_SECRET', segredo);
  return nuvemshopSituacao_();
}

function nuvemshopSincronizar_() {
  const r = sincronizarNuvemshop_({ fresco: true });
  return Object.assign(nuvemshopSituacao_(), { resultado: r });
}

/** Liga (ou desliga, com ns_variante_id vazio) um produto do painel a um da Nuvemshop. */
function nuvemshopLigar_(req) {
  const b = req.body || {};
  const variante = String(b.ns_variante_id || '').trim();
  const estado = nsEstado_();
  const opcao = (estado.sem_ligacao_ns || []).find(function (v) { return v.variante === variante; });
  if (variante && !opcao) throw erro_('Produto da Nuvemshop não encontrado. Toque em Sincronizar agora e tente de novo.');
  transacao_(function (tx) {
    const p = tx.porId('produtos', b.produto_id);
    if (!p) throw erro_('Produto não encontrado');
    p.ns_variante_id = variante || null;
    p.ns_produto_id = opcao ? opcao.produto : null;
    tx.alterou('produtos');
  }, false);
  return nuvemshopSincronizar_();
}

/** Pedidos pagos antes da conexão: importar todos, ou marcar que já foram lançados à mão. */
function nuvemshopAntigos_(req) {
  const acao = req.body && req.body.acao;
  const estado = nsEstado_();
  if (!estado.aguardando_antigos) return nuvemshopSituacao_();
  if (acao === 'importar') {
    const pedidos = (estado.antigos || []).map(function (a) { return nsApi_('get', '/orders/' + encodeURIComponent(a.id)); }).filter(Boolean);
    transacao_(function (tx) { return nsImportarPedidos_(tx, pedidos, null); }, false);
  } else if (acao !== 'ignorar') {
    throw erro_('Escolha importar ou ignorar');
  }
  estado.aguardando_antigos = false;
  estado.antigos = [];
  nsSalvarEstado_(estado);
  return nuvemshopSincronizar_();
}

function nuvemshopDesconectar_() {
  const p = nsProps_();
  ['NS_TOKEN', 'NS_LOJA_ID', 'NS_VERSAO', 'NS_STATE', NS_PROP_ESTADO].forEach(function (k) { p.deleteProperty(k); });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarNuvemshopPeriodico') ScriptApp.deleteTrigger(t);
  });
  return nuvemshopSituacao_();
}

/* ============================== Fotos da Nuvemshop → galeria do site ============================== */

/** Versão reduzida da imagem no CDN da Nuvemshop (…-1024-1024.jpg); se não existir, a original. */
function nsBaixarImagem_(src) {
  const url = String(src || '').replace(/^\/\//, 'https://');
  const reduzida = url.replace(/(-\d+-\d+)?(\.(?:jpe?g|png|webp))(\?.*)?$/i, '-1024-1024$2');
  const tentativas = reduzida !== url ? [reduzida, url] : [url];
  for (let i = 0; i < tentativas.length; i++) {
    const r = UrlFetchApp.fetch(tentativas[i], { muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() === 200) {
      const blob = r.getBlob();
      const tipo = String(blob.getContentType() || '').toLowerCase();
      if (/^image\/(jpeg|png|webp)$/.test(tipo) && blob.getBytes().length <= 4 * 1024 * 1024) return blob;
    }
  }
  return null;
}

/**
 * Traz para o painel as fotos que estão na Nuvemshop e ainda não estão aqui: a 1ª vira a
 * principal só se o produto não tiver foto; as outras viram fotos extras (sem repetir:
 * cada extra guarda o id da imagem da Nuvemshop). Depois republica o site.
 */
function nuvemshopImportarFotos_() {
  if (!nsCred_()) throw erro_('Conecte a Nuvemshop primeiro.');
  const produtos = transacao_(function (tx) {
    return tx.linhas('produtos').filter(function (p) { return p.ns_produto_id; })
      .map(function (p) { return { id: p.id, nome: p.nome, ns: p.ns_produto_id, tem_principal: !!p.foto_id, ja: fotosExtras_(p).map(function (f) { return String(f.ns || ''); }), extras: fotosExtras_(p).length }; });
  }, true);

  const novos = {}; // produto → { principal, extras[] }
  let importadas = 0;
  const avisos = [];
  produtos.forEach(function (p) {
    const dados = nsApi_('get', '/products/' + encodeURIComponent(p.ns));
    const imagens = ((dados && dados.images) || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    imagens.forEach(function (img, i) {
      const nsId = String(img.id);
      const principal = i === 0;
      if (principal && p.tem_principal) return;
      if (!principal && p.ja.indexOf(nsId) >= 0) return;
      if (!principal && p.extras + ((novos[p.id] && novos[p.id].extras.length) || 0) >= FOTOS_EXTRAS_MAX) return;
      const blob = nsBaixarImagem_(img.src);
      if (!blob) { avisos.push('"' + p.nome + '": não consegui baixar uma foto da Nuvemshop.'); return; }
      const extensao = blob.getContentType().split('/')[1].replace('jpeg', 'jpg');
      const arquivo = pastaFotos_().createFile(blob.setName('produto-' + p.id + '-ns-' + nsId + '.' + extensao));
      novos[p.id] = novos[p.id] || { principal: null, extras: [] };
      if (principal) novos[p.id].principal = arquivo.getId();
      else novos[p.id].extras.push({ id: arquivo.getId(), ns: nsId });
      importadas++;
    });
  });

  if (importadas) {
    transacao_(function (tx) {
      Object.keys(novos).forEach(function (id) {
        const p = tx.porId('produtos', id);
        if (!p) return;
        const n = novos[id];
        if (n.principal && !p.foto_id) { p.foto_id = n.principal; p.foto_em = emUnico_(p); }
        const extras = fotosExtras_(p);
        n.extras.forEach(function (e) { p.fotos_extras = extras; extras.push({ id: e.id, em: emUnico_(p), ns: e.ns }); });
        p.fotos_extras = extras;
      });
      tx.alterou('produtos');
    }, false);
    publicarLoja_({});
  }
  return Object.assign(nuvemshopSituacao_(), { fotos_importadas: importadas, avisos_fotos: avisos });
}
