// tests/publicador.test.js — envio da vitrine e das fotos para o Cloudflare KV (API falsa)
const request = require('supertest');
const { criarPublicador } = require('../lib/publicador');

const ENV = { CF_ACCOUNT_ID: 'conta', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'token-teste', CF_API_BASE: 'https://cf.falso/v4' };
const BASE = 'https://cf.falso/v4/accounts/conta/storage/kv/namespaces/ns';

// "Nuvem" falsa: guarda as chaves e registra cada chamada
function criarNuvem(chavesIniciais = []) {
  const kv = new Map(chavesIniciais.map((k) => [k, 'x']));
  const chamadas = [];
  const fetchFalso = jest.fn(async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    chamadas.push({ metodo, url, auth: opts.headers && opts.headers.Authorization });
    const caminho = url.replace(BASE, '');
    if (metodo === 'GET' && caminho.startsWith('/keys')) {
      return new Response(JSON.stringify({ result: [...kv.keys()].filter((k) => k.startsWith('foto-')).map((name) => ({ name })), result_info: { cursor: '' } }));
    }
    const chave = decodeURIComponent(caminho.replace('/values/', ''));
    if (metodo === 'PUT') kv.set(chave, opts.body);
    if (metodo === 'DELETE') kv.delete(chave);
    return new Response(JSON.stringify({ success: true }));
  });
  return { kv, chamadas, fetchFalso };
}

// Banco falso com fotos configuráveis
function criarPool(fotos) {
  return {
    query: async (sql, params) => {
      if (sql.includes('SELECT f.produto_id, f.atualizado_em')) return { rows: fotos.map(({ id, em }) => ({ produto_id: id, atualizado_em: em })) };
      if (sql.includes('SELECT dados FROM produto_fotos')) return { rows: [{ dados: Buffer.from('jpeg-' + params[0]) }] };
      return { rows: [] };
    },
  };
}

// Espera uma condição ficar verdadeira (até 5 s), sem depender de tempo fixo
async function esperar(condicao, limiteMs = 5000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return condicao();
}

const vitrineFalsa = async () => ({ loja: {}, produtos: [{ id: 1, nome: 'QCY' }], atualizado_em: 'agora' });

let original;
beforeEach(() => { original = { ...process.env }; Object.assign(process.env, ENV); });
afterEach(() => { process.env = original; jest.restoreAllMocks(); });

test('sem as variáveis CF_* fica desligado e não chama a Cloudflare', async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  const nuvem = criarNuvem();
  global.fetch = nuvem.fetchFalso;
  const pub = criarPublicador(criarPool([]), vitrineFalsa);
  const r = await pub.publicar();
  expect(r.ok).toBe(false);
  expect(nuvem.fetchFalso).not.toHaveBeenCalled();
  expect(pub.situacao().configurado).toBe(false);
});

test('publica a vitrine e sobe só as fotos que faltam', async () => {
  const em1 = '2026-10-29T10:00:00.000Z';
  const em2 = '2026-10-29T11:00:00.000Z';
  const chave1 = `foto-1-${Date.parse(em1)}`;
  const chave2 = `foto-2-${Date.parse(em2)}`;
  const nuvem = criarNuvem([chave1]); // a foto 1 já está lá
  global.fetch = nuvem.fetchFalso;
  const pub = criarPublicador(criarPool([{ id: 1, em: em1 }, { id: 2, em: em2 }]), vitrineFalsa);

  const r = await pub.publicar();
  expect(r.ok).toBe(true);
  const puts = nuvem.chamadas.filter((c) => c.metodo === 'PUT').map((c) => decodeURIComponent(c.url.split('/values/')[1]));
  expect(puts).toEqual([chave2, 'vitrine']); // foto nova antes da vitrine
  expect(JSON.parse(nuvem.kv.get('vitrine')).produtos[0].nome).toBe('QCY');
  expect(nuvem.chamadas.every((c) => c.auth === 'Bearer token-teste')).toBe(true);
  expect(pub.situacao().ultima).toBeTruthy();

  // Segunda publicação: não reenvia foto nem relista a nuvem
  nuvem.chamadas.length = 0;
  await pub.publicar();
  expect(nuvem.chamadas.map((c) => c.metodo)).toEqual(['PUT']);
});

test('foto trocada só é apagada da nuvem depois de 5 minutos', async () => {
  const antiga = 'foto-1-1000';
  const em = '2026-10-29T12:00:00.000Z';
  const nuvem = criarNuvem([antiga]);
  global.fetch = nuvem.fetchFalso;
  const pub = criarPublicador(criarPool([{ id: 1, em }]), vitrineFalsa);
  let agora = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => agora);

  await pub.publicar();
  expect(nuvem.kv.has(antiga)).toBe(true);       // acabou de ficar antiga: mantém
  agora += 60 * 1000;
  await pub.publicar();
  expect(nuvem.kv.has(antiga)).toBe(true);       // 1 min: ainda mantém
  agora += 5 * 60 * 1000;
  await pub.publicar();
  expect(nuvem.kv.has(antiga)).toBe(false);      // passou de 5 min: apaga
  expect(nuvem.kv.has(`foto-1-${Date.parse(em)}`)).toBe(true);
});

test('erro da Cloudflare fica registrado para aparecer no painel', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'Authentication error' }] }), { status: 403 }));
  const pub = criarPublicador(criarPool([]), vitrineFalsa);
  const r = await pub.publicar();
  expect(r.ok).toBe(false);
  expect(pub.situacao().erro).toMatch(/403.*Authentication error/);
});

test('alteração no painel dispara a publicação (e login não dispara)', async () => {
  jest.setTimeout(15000);
  const nuvem = criarNuvem();
  global.fetch = nuvem.fetchFalso;
  process.env.PAINEL_SENHA = 'senha-de-teste-123';
  require('../lib/auth')._tentativas.clear();
  const { criarApp } = require('../server');
  const app = criarApp({ query: async () => ({ rows: [], rowCount: 0 }) });

  const agente = request.agent(app);
  await agente.post('/api/sessao/entrar').send({ senha: 'senha-de-teste-123' }).expect(200);
  await new Promise((r) => setTimeout(r, 1800));
  expect(nuvem.chamadas.some((c) => c.url.endsWith('/values/vitrine'))).toBe(false);

  await agente.put('/api/loja/config').send({ aviso: 'Promoção' }).expect(200);
  expect(await esperar(() => nuvem.chamadas.some((c) => c.metodo === 'PUT' && c.url.endsWith('/values/vitrine')))).toBe(true);
  await esperar(() => false, 300); // deixa a publicação terminar de registrar a situação

  const sit = await agente.get('/api/publicacao').expect(200);
  expect(sit.body.configurado).toBe(true);
  expect(sit.body.ultima).toBeTruthy();
});

test('com SITE_URL, a loja antiga redireciona e o painel não', async () => {
  process.env.SITE_URL = 'https://jvimports.com.br';
  const { criarApp } = require('../server');
  const app = criarApp({ query: async () => ({ rows: [] }) });
  const r = await request(app).get('/p/13').set('Host', 'jv-imports-1.onrender.com').expect(301);
  expect(r.headers.location).toBe('https://jvimports.com.br/p/13');
  await request(app).get('/painel').set('Host', 'jv-imports-1.onrender.com').expect(200);
});
