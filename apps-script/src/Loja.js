/**
 * Loja online (site público na Cloudflare).
 *
 * O painel continua sendo a fonte da verdade (planilha). A cada venda, compra ou edição,
 * a tela chama publicarLojaAgora() em segundo plano, que envia para o Cloudflare KV:
 *   - "vitrine": produtos, preços e disponibilidade (sem custo e sem quantidade exata)
 *   - "foto-<id>-<versão>": as fotos (guardadas no Drive, pasta "JV Imports - Fotos da Loja")
 * O site lê só o KV, então abre na hora e nunca espera o Apps Script.
 * Um gatilho a cada 10 min republica se algo mudou direto na planilha.
 *
 * Mesmas regras de lib/loja.js e lib/publicador.js da versão Node (o site é o mesmo).
 */

const LOJA_CONFIG_PADRAO = {
  whatsapp: '',            // só números, com DDI: 5561999999999
  instagram: '',           // sem @
  aviso: '',               // faixa no topo do site
  pagamento: 'Pix, cartão de crédito ou dinheiro',
  entrega: 'Entrega combinada pelo WhatsApp ou retirada',
  mostrar_esgotados: 'sim',
};
const LOJA_CAMPOS = Object.keys(LOJA_CONFIG_PADRAO);
const PASTA_FOTOS = 'JV Imports - Fotos da Loja';
const FOTO_MAX_BYTES = 2 * 1024 * 1024;
const DIAS_MAIS_VENDIDO = 90;
const GUARDAR_FOTO_ANTIGA_MS = 5 * 60 * 1000; // a vitrine antiga pode ficar 60 s em cache na Cloudflare
const PROP_ESTADO_LOJA = 'LOJA_ESTADO';
const CF_API = 'https://api.cloudflare.com/client/v4';

/* ============================== Configuração da loja ============================== */

function lojaConfig_(tx) {
  const c = Object.assign({}, LOJA_CONFIG_PADRAO);
  tx.linhas('configuracoes').forEach(function (l) {
    const chave = String(l.chave || '');
    const campo = chave.replace(/^loja_/, '');
    if (chave.indexOf('loja_') === 0 && LOJA_CAMPOS.indexOf(campo) >= 0 && l.valor !== null) c[campo] = l.valor;
  });
  return c;
}

function lojaConfigLer_(tx) {
  return lojaConfig_(tx);
}

function lojaConfigSalvar_(tx, req) {
  const novos = normalizarConfigLoja_(req.body || {});
  const agora = agoraIso_();
  const linhas = tx.linhas('configuracoes');
  Object.keys(novos).forEach(function (campo) {
    const chave = 'loja_' + campo;
    const l = linhas.find(function (x) { return x.chave === chave; });
    if (l) { l.valor = novos[campo]; l.atualizado_em = agora; }
    else tx.inserir('configuracoes', { chave: chave, valor: novos[campo], atualizado_em: agora });
  });
  tx.alterou('configuracoes');
  return { ok: true, config: lojaConfig_(tx) };
}

function limparWhatsapp_(valor) {
  let n = String(valor || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n; // digitou só DDD + número
  return n;
}

function limparInstagram_(valor) {
  return String(valor || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .slice(0, 60);
}

function normalizarConfigLoja_(entrada) {
  const c = {};
  LOJA_CAMPOS.forEach(function (campo) {
    if (entrada[campo] === undefined) return;
    let v = String(entrada[campo] === null ? '' : entrada[campo]).trim().slice(0, 300);
    if (campo === 'whatsapp') v = limparWhatsapp_(v);
    if (campo === 'instagram') v = limparInstagram_(v);
    if (campo === 'mostrar_esgotados') v = v === 'nao' ? 'nao' : 'sim';
    c[campo] = v;
  });
  return c;
}

/* ============================== Vitrine ============================== */

function versaoFoto_(fotoEm) {
  const ms = Date.parse(fotoEm);
  return isFinite(ms) ? ms : 0;
}

function chaveFoto_(id, versao) {
  return 'foto-' + id + '-' + versao;
}

/** Lista pública. Nunca expõe custo nem a quantidade exata acima de 3. */
function montarVitrine_(produtos, vendidos, config) {
  const mostrarEsgotados = config.mostrar_esgotados !== 'nao';
  const top = vendidos
    .filter(function (v) { return Number(v.total) >= 2; })
    .sort(function (a, b) { return Number(b.total) - Number(a.total); })
    .slice(0, 3)
    .map(function (v) { return Number(v.produto_id); });

  const lista = produtos
    .filter(function (p) { return p.na_loja !== false && Number(p.preco) > 0; })
    .map(function (p) {
      const qtd = Math.max(0, Number(p.quantidade) || 0);
      const preco = Number(p.preco);
      const antigo = Number(p.preco_antigo);
      const temPromo = antigo > preco;
      return {
        id: p.id,
        nome: p.nome,
        descricao: p.descricao || '',
        categoria: String(p.categoria || '').trim(),
        preco: preco,
        preco_antigo: temPromo ? antigo : null,
        desconto: temPromo ? Math.round((1 - preco / antigo) * 100) : 0,
        disponivel: qtd > 0,
        ultimas: qtd > 0 && qtd <= 3 ? qtd : null,
        max_compra: Math.min(qtd, 10),
        destaque: !!p.destaque,
        mais_vendido: top.indexOf(Number(p.id)) >= 0,
        foto: p.foto_id && p.foto_em ? '/api/loja/foto/' + p.id + '?v=' + versaoFoto_(p.foto_em) : null,
      };
    })
    .filter(function (p) { return mostrarEsgotados || p.disponivel; });

  lista.sort(function (a, b) {
    return (b.disponivel - a.disponivel) || (b.destaque - a.destaque) ||
      (b.mais_vendido - a.mais_vendido) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
  return lista;
}

function dadosVitrine_(tx) {
  const config = lojaConfig_(tx);
  const corte = new Date(Date.now() - DIAS_MAIS_VENDIDO * 864e5).toISOString();
  const totais = {};
  tx.linhas('vendas').forEach(function (v) {
    if (!v.produto_id || !v.data || v.data < corte) return;
    totais[v.produto_id] = (totais[v.produto_id] || 0) + (Number(v.quantidade) || 0);
  });
  const vendidos = Object.keys(totais).map(function (id) { return { produto_id: Number(id), total: totais[id] }; });
  return {
    loja: {
      whatsapp: config.whatsapp, instagram: config.instagram, aviso: config.aviso,
      pagamento: config.pagamento, entrega: config.entrega,
    },
    produtos: montarVitrine_(tx.linhas('produtos'), vendidos, config),
    atualizado_em: agoraIso_(),
  };
}

/** Fotos que precisam estar na nuvem: só de produtos visíveis no site. */
function fotosDesejadas_(tx) {
  return tx.linhas('produtos')
    .filter(function (p) { return p.na_loja !== false && Number(p.preco) > 0 && p.foto_id && p.foto_em; })
    .map(function (p) { return { produto_id: p.id, foto_id: p.foto_id, chave: chaveFoto_(p.id, versaoFoto_(p.foto_em)) }; });
}

/* ============================== Fotos (Drive) ============================== */

const ASSINATURAS_FOTO_ = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

/** Foto enviada pelo painel como data URL (o navegador já reduz para ~1000 px). */
function lerFotoDataUrl_(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw erro_('Envie uma imagem JPG, PNG ou WEBP');
  const bytes = Utilities.base64Decode(m[2]);
  if (!bytes.length) throw erro_('Imagem vazia');
  if (bytes.length > FOTO_MAX_BYTES) throw erro_('Imagem muito grande (máximo 2 MB)');
  const ok = ASSINATURAS_FOTO_[m[1]].every(function (b, i) { return (bytes[i] & 0xff) === b; });
  if (!ok) throw erro_('O arquivo não parece ser uma imagem válida');
  return { tipo: m[1], bytes: bytes };
}

function pastaFotos_() {
  const pastas = DriveApp.getFoldersByName(PASTA_FOTOS);
  return pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_FOTOS);
}

function apagarFotoDrive_(fotoId) {
  if (!fotoId) return;
  try { DriveApp.getFileById(fotoId).setTrashed(true); } catch (e) { /* já não existe */ }
}

function produtosFotoSalvar_(tx, req) {
  const p = tx.porId('produtos', req.params[0]);
  if (!p) throw erro_('Produto não encontrado');
  const foto = lerFotoDataUrl_(req.body.foto);
  const extensao = foto.tipo.split('/')[1].replace('jpeg', 'jpg');
  const nome = 'produto-' + p.id + '-' + String(p.nome || '').replace(/[^\w-]+/g, '-').slice(0, 40) + '.' + extensao;
  const arquivo = pastaFotos_().createFile(Utilities.newBlob(foto.bytes, foto.tipo, nome));
  apagarFotoDrive_(p.foto_id);
  p.foto_id = arquivo.getId();
  p.foto_em = agoraIso_();
  tx.alterou('produtos');
  return { ok: true, foto_em: p.foto_em };
}

function produtosFotoRemover_(tx, req) {
  const p = tx.porId('produtos', req.params[0]);
  if (!p) throw erro_('Produto não encontrado');
  apagarFotoDrive_(p.foto_id);
  p.foto_id = null;
  p.foto_em = null;
  tx.alterou('produtos');
  return { ok: true };
}

/* ============================== Cloudflare KV ============================== */

function cfCredenciais_() {
  const p = PropertiesService.getScriptProperties();
  const cf = { conta: p.getProperty('CF_ACCOUNT_ID'), ns: p.getProperty('CF_KV_NAMESPACE_ID'), token: p.getProperty('CF_API_TOKEN') };
  return cf.conta && cf.ns && cf.token ? cf : null;
}

function kv_(cf, metodo, caminho, corpo, tipo) {
  const url = CF_API + '/accounts/' + encodeURIComponent(cf.conta) + '/storage/kv/namespaces/' +
    encodeURIComponent(cf.ns) + caminho;
  const opcoes = { method: metodo, headers: { Authorization: 'Bearer ' + cf.token }, muteHttpExceptions: true };
  if (corpo !== undefined) { opcoes.payload = corpo; opcoes.contentType = tipo; }
  const r = UrlFetchApp.fetch(url, opcoes);
  const codigo = r.getResponseCode();
  if (codigo >= 300) {
    let detalhe = '';
    try { detalhe = (JSON.parse(r.getContentText()).errors || []).map(function (e) { return e.message; }).join('; '); } catch (e) { /* sem JSON */ }
    throw new Error('Cloudflare respondeu ' + codigo + (detalhe ? ': ' + detalhe : ''));
  }
  return r;
}

function kvValor_(chave) {
  return '/values/' + encodeURIComponent(chave);
}

function kvListarFotos_(cf) {
  const chaves = [];
  let cursor = '';
  do {
    const r = kv_(cf, 'get', '/keys?prefix=foto-&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    const j = JSON.parse(r.getContentText());
    (j.result || []).forEach(function (k) { chaves.push(k.name); });
    cursor = (j.result_info && j.result_info.cursor) || '';
  } while (cursor);
  return chaves;
}

/* ============================== Publicação ============================== */

function estadoLoja_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(PROP_ESTADO_LOJA) || '{}'); }
  catch (e) { return {}; }
}

function salvarEstadoLoja_(estado) {
  PropertiesService.getScriptProperties().setProperty(PROP_ESTADO_LOJA, JSON.stringify(estado));
}

/** Chamada pela tela depois de cada gravação (em segundo plano, não trava o painel). */
function publicarLojaAgora() {
  return JSON.stringify(publicarLoja_({}));
}

/** Gatilho a cada 10 min: pega mudanças feitas direto na planilha. Só envia se mudou. */
function publicarLojaPeriodico() {
  publicarLoja_({ fresco: true, soSeMudou: true });
}

/**
 * Uma publicação por vez. Se chegar outra enquanto uma roda, ela marca "pendente" e a
 * que está rodando faz mais uma volta no fim (assim a última alteração sempre sai).
 */
function publicarLoja_(opcoes) {
  const cf = cfCredenciais_();
  if (!cf) return { ok: false, erro: 'Cloudflare não configurada' };
  const cache = CacheService.getScriptCache();
  const lock = LockService.getUserLock();
  if (!lock.tryLock(500)) {
    cache.put('jv:loja:pendente', '1', 600);
    return { ok: true, enfileirado: true };
  }
  try {
    let resultado;
    let voltas = 0;
    do {
      cache.remove('jv:loja:pendente');
      resultado = publicarUmaVez_(cf, voltas === 0 ? opcoes : {});
    } while (++voltas < 3 && cache.get('jv:loja:pendente'));
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

function publicarUmaVez_(cf, opcoes) {
  const estado = estadoLoja_();
  try {
    if (opcoes.fresco) limparCache(); // relê a planilha (pega edições feitas à mão)
    const d = transacao_(function (tx) { return { vitrine: dadosVitrine_(tx), fotos: fotosDesejadas_(tx) }; }, true);

    const assinatura = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify([d.vitrine.loja, d.vitrine.produtos]), Utilities.Charset.UTF_8));
    if (opcoes.soSeMudou && assinatura === estado.hash && !estado.erro) return { ok: true, semMudanca: true };

    // 1) Fotos que faltam (antes da vitrine, para o site nunca apontar para foto que não subiu)
    let naNuvem = !estado.fotos || opcoes.completo ? kvListarFotos_(cf) : estado.fotos.slice();
    const semFoto = {};
    d.fotos.forEach(function (f) {
      if (naNuvem.indexOf(f.chave) >= 0) return;
      try {
        kv_(cf, 'put', kvValor_(f.chave), DriveApp.getFileById(f.foto_id).getBlob().getBytes(), 'application/octet-stream');
        naNuvem.push(f.chave);
      } catch (e) {
        if (/Cloudflare/.test(e.message)) throw e;
        semFoto[f.produto_id] = true; // arquivo sumiu do Drive: o produto aparece sem foto
      }
    });
    d.vitrine.produtos.forEach(function (p) { if (semFoto[p.id]) p.foto = null; });

    // 2) Vitrine
    d.vitrine.publicado_em = agoraIso_();
    kv_(cf, 'put', kvValor_('vitrine'), JSON.stringify(d.vitrine), 'application/json');

    // 3) Fotos que deixaram de ser usadas: apaga depois de 5 min
    const desejadas = d.fotos.map(function (f) { return f.chave; });
    const antigas = estado.antigas || {};
    const agora = Date.now();
    naNuvem = naNuvem.filter(function (chave) {
      if (desejadas.indexOf(chave) >= 0) { delete antigas[chave]; return true; }
      if (!antigas[chave]) { antigas[chave] = agora; return true; }
      if (agora - antigas[chave] < GUARDAR_FOTO_ANTIGA_MS) return true;
      try { kv_(cf, 'delete', kvValor_(chave)); } catch (e) { return true; }
      delete antigas[chave];
      return false;
    });

    salvarEstadoLoja_({ ultima: agoraIso_(), erro: null, fotos: naNuvem, antigas: antigas, hash: assinatura });
    return { ok: true };
  } catch (e) {
    estado.erro = e.message;
    estado.fotos = null; // relê a lista da nuvem na próxima vez
    salvarEstadoLoja_(estado);
    console.error('Publicar loja: ' + e.message);
    return { ok: false, erro: e.message };
  }
}

/* ============================== Rotas (tela Loja Online) ============================== */

function publicacaoSituacao_() {
  const p = PropertiesService.getScriptProperties();
  const e = estadoLoja_();
  return {
    configurado: !!cfCredenciais_(),
    ultima: e.ultima || null,
    erro: e.erro || null,
    publicando: false,
    site: p.getProperty('SITE_URL') || null,
    // Só no Apps Script: os dados da Cloudflare são preenchidos pela própria tela
    permite_configurar: true,
    conta: p.getProperty('CF_ACCOUNT_ID') || '',
    namespace: p.getProperty('CF_KV_NAMESPACE_ID') || '',
    tem_token: !!p.getProperty('CF_API_TOKEN'),
  };
}

function publicacaoAgora_() {
  const r = publicarLoja_({ completo: true, fresco: true });
  return Object.assign({}, publicacaoSituacao_(), r);
}

/** Salva a conexão com a Cloudflare, liga o gatilho de 10 min e já publica. */
function publicacaoConfigSalvar_(req) {
  const b = req.body || {};
  const p = PropertiesService.getScriptProperties();
  const id32 = /^[a-f0-9]{32}$/i;
  const conta = String(b.conta || '').trim();
  const ns = String(b.namespace || '').trim();
  const token = String(b.token || '').trim();
  let site = String(b.site || '').trim().replace(/\/+$/, '');
  if (!id32.test(conta)) throw erro_('Account ID inválido: são 32 letras e números (Cloudflare → Workers & Pages → coluna da direita).');
  if (!id32.test(ns)) throw erro_('Namespace ID inválido: são 32 letras e números (Workers & Pages → KV).');
  if (!token && !p.getProperty('CF_API_TOKEN')) throw erro_('Cole o token da API da Cloudflare.');
  if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
  if (site && !/^https?:\/\/[\w.-]+(:\d+)?$/i.test(site)) throw erro_('Endereço da loja inválido. Ex.: https://jv-imports.pages.dev');

  p.setProperty('CF_ACCOUNT_ID', conta);
  p.setProperty('CF_KV_NAMESPACE_ID', ns);
  if (token) p.setProperty('CF_API_TOKEN', token);
  if (site) p.setProperty('SITE_URL', site); else p.deleteProperty('SITE_URL');
  p.deleteProperty(PROP_ESTADO_LOJA); // conexão nova: relê tudo da nuvem

  ativarPublicacaoPeriodica_();
  return publicacaoAgora_();
}

function ativarPublicacaoPeriodica_() {
  const existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'publicarLojaPeriodico'; });
  if (!existe) ScriptApp.newTrigger('publicarLojaPeriodico').timeBased().everyMinutes(10).create();
}
