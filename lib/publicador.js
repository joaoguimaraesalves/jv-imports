// lib/publicador.js
// Envia a vitrine (estoque, preços, config) e as fotos para o Cloudflare KV,
// de onde a loja online é servida. Assim o site abre na hora, sem depender do
// Render nem do banco acordarem.
//
// Fluxo: qualquer alteração no painel → espera 1,5 s (junta várias seguidas)
// → sobe fotos novas → grava a chave "vitrine" → apaga fotos antigas.
//
// Variáveis de ambiente (no Render):
//   CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN (permissão "Workers KV Storage: Edit")
// Sem elas o publicador fica desligado e nada muda no funcionamento do painel.
const { chaveFoto, versaoFoto } = require('./loja');

const ESPERA_MS = 1500;
const NOVA_TENTATIVA_MS = 2 * 60 * 1000;
const MAX_TENTATIVAS = 5;
// Foto trocada só é apagada da nuvem depois deste tempo: a vitrine antiga pode
// ficar até 60 s em cache nos servidores da Cloudflare apontando para ela.
const GUARDAR_FOTO_ANTIGA_MS = 5 * 60 * 1000;

function configurado() {
  return !!(process.env.CF_ACCOUNT_ID && process.env.CF_KV_NAMESPACE_ID && process.env.CF_API_TOKEN);
}

function baseKv() {
  const api = (process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
  return `${api}/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;
}

async function chamar(metodo, caminho, corpo, tipo) {
  const headers = { Authorization: `Bearer ${process.env.CF_API_TOKEN}` };
  if (tipo) headers['Content-Type'] = tipo;
  const res = await fetch(baseKv() + caminho, { method: metodo, headers, body: corpo });
  if (!res.ok) {
    let detalhe = '';
    try {
      const j = await res.json();
      detalhe = (j.errors || []).map((e) => e.message).join('; ');
    } catch (e) { /* resposta sem JSON */ }
    throw new Error(`Cloudflare respondeu ${res.status}${detalhe ? ': ' + detalhe : ''}`);
  }
  return res;
}

const valor = (chave) => `/values/${encodeURIComponent(chave)}`;

async function listarFotosNaNuvem() {
  const chaves = [];
  let cursor = '';
  do {
    const res = await chamar('GET', `/keys?prefix=foto-&limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    const j = await res.json();
    for (const k of j.result || []) chaves.push(k.name);
    cursor = (j.result_info && j.result_info.cursor) || '';
  } while (cursor);
  return chaves;
}

function criarPublicador(pool, carregarVitrine) {
  const estado = {
    ultima: null,         // ISO da última publicação bem-sucedida
    erro: null,           // mensagem do último erro
    emAndamento: false,
    pendente: false,      // chegou alteração durante uma publicação
    tentativas: 0,
  };
  let fotosNaNuvem = null;       // Set de chaves já enviadas (lido 1x por boot)
  const antigaDesde = new Map(); // chave da foto → quando deixou de ser usada
  let timer = null;
  let timerTentativa = null;

  async function sincronizarFotos() {
    if (!fotosNaNuvem) fotosNaNuvem = new Set(await listarFotosNaNuvem());
    const { rows } = await pool.query(
      `SELECT f.produto_id, f.atualizado_em
       FROM produto_fotos f JOIN produtos p ON p.id = f.produto_id
       WHERE p.na_loja = true AND p.preco > 0`);
    const desejadas = new Map(rows.map((r) => [chaveFoto(r.produto_id, versaoFoto(r.atualizado_em)), r.produto_id]));

    for (const [chave, id] of desejadas) {
      if (fotosNaNuvem.has(chave)) continue;
      const f = (await pool.query('SELECT dados FROM produto_fotos WHERE produto_id = $1', [id])).rows[0];
      if (!f) continue;
      await chamar('PUT', valor(chave), f.dados, 'application/octet-stream');
      fotosNaNuvem.add(chave);
    }
    return desejadas;
  }

  async function apagarFotosAntigas(desejadas) {
    const agora = Date.now();
    for (const chave of [...fotosNaNuvem]) {
      if (desejadas.has(chave)) { antigaDesde.delete(chave); continue; }
      if (!antigaDesde.has(chave)) { antigaDesde.set(chave, agora); continue; }
      if (agora - antigaDesde.get(chave) < GUARDAR_FOTO_ANTIGA_MS) continue;
      await chamar('DELETE', valor(chave));
      fotosNaNuvem.delete(chave);
      antigaDesde.delete(chave);
    }
  }

  async function publicar() {
    if (!configurado()) return { ok: false, erro: 'Cloudflare não configurada' };
    if (estado.emAndamento) { estado.pendente = true; return { ok: true, enfileirado: true }; }
    estado.emAndamento = true;
    clearTimeout(timerTentativa);
    try {
      // Fotos primeiro: a vitrine nova nunca aponta para foto que ainda não subiu
      const desejadas = await sincronizarFotos();
      const dados = await carregarVitrine(pool, { fresca: true });
      await chamar('PUT', valor('vitrine'), JSON.stringify({ ...dados, publicado_em: new Date().toISOString() }), 'application/json');
      await apagarFotosAntigas(desejadas);
      estado.ultima = new Date().toISOString();
      estado.erro = null;
      estado.tentativas = 0;
      return { ok: true };
    } catch (e) {
      estado.erro = e.message;
      fotosNaNuvem = null; // relê a lista da nuvem na próxima tentativa
      console.error('Publicar na Cloudflare:', e.message);
      if (++estado.tentativas <= MAX_TENTATIVAS) {
        timerTentativa = setTimeout(publicar, NOVA_TENTATIVA_MS);
        if (timerTentativa.unref) timerTentativa.unref();
      }
      return { ok: false, erro: e.message };
    } finally {
      estado.emAndamento = false;
      if (estado.pendente) { estado.pendente = false; agendar(); }
    }
  }

  // Chamado a cada alteração no painel. Várias alterações seguidas viram 1 envio.
  function agendar() {
    if (!configurado()) return;
    clearTimeout(timer);
    timer = setTimeout(publicar, ESPERA_MS);
    if (timer.unref) timer.unref();
  }

  // Botão "Republicar agora": relê tudo da nuvem e publica na hora
  async function republicarTudo() {
    fotosNaNuvem = null;
    estado.tentativas = 0;
    return publicar();
  }

  function situacao() {
    return {
      configurado: configurado(),
      ultima: estado.ultima,
      erro: estado.erro,
      publicando: estado.emAndamento,
      site: process.env.SITE_URL || null,
    };
  }

  return { publicar, agendar, republicarTudo, situacao };
}

module.exports = { criarPublicador, configurado };
