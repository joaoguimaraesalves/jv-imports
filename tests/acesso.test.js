// tests/acesso.test.js — o que é público e o que pede senha (banco falso, sem Postgres)
const request = require('supertest');
const { criarApp } = require('../server');

// Banco falso: responde conforme o SQL pedido
const poolFalso = {
  query: async (sql) => {
    if (sql.includes('FROM configuracoes')) return { rows: [{ chave: 'loja_whatsapp', valor: '5561999998888' }] };
    if (sql.includes('FROM vendas')) return { rows: [] };
    if (sql.includes('FROM produtos p')) {
      return { rows: [{ id: 1, nome: 'QCY T13 ANC', custo: 77, preco: 179, quantidade: 4, na_loja: true, destaque: false, preco_antigo: null, descricao: 'Fone', categoria: 'Fones', foto_em: null }] };
    }
    return { rows: [], rowCount: 0 };
  },
  connect: async () => ({ query: poolFalso.query, release() {} }),
};

const SENHA = 'senha-de-teste-123';
let app;

beforeEach(() => {
  process.env.PAINEL_SENHA = SENHA;
  require('../lib/auth')._tentativas.clear();
  require('../routes/loja').invalidarVitrine();
  app = criarApp(poolFalso);
});

afterAll(() => { delete process.env.PAINEL_SENHA; });

async function logar() {
  const agente = request.agent(app);
  await agente.post('/api/sessao/entrar').send({ senha: SENHA }).expect(200);
  return agente;
}

describe('rotas públicas da loja', () => {
  test('vitrine responde sem login e não mostra custo', async () => {
    const res = await request(app).get('/api/loja/produtos').expect(200);
    expect(res.body.produtos).toHaveLength(1);
    expect(res.body.loja.whatsapp).toBe('5561999998888');
    expect(JSON.stringify(res.body)).not.toContain('"custo"');
    expect(JSON.stringify(res.body)).not.toContain('77');
  });

  test('página inicial é a loja, com as tags de prévia preenchidas', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('og:title');
    expect(res.text).not.toContain('__OG_');
  });

  test('link de produto monta a prévia com nome e preço', async () => {
    const res = await request(app).get('/p/1').expect(200);
    expect(res.text).toContain('QCY T13 ANC — R$');
    expect(res.text).toContain('data-produto-inicial="1"');
  });

  test('saúde (despertador) responde sem tocar no banco', async () => {
    await request(app).get('/api/loja/saude').expect(200, { ok: true });
  });
});

describe('painel protegido', () => {
  test('API do painel pede login', async () => {
    await request(app).get('/api/produtos').expect(401);
    await request(app).get('/api/dashboard').expect(401);
    await request(app).delete('/api/produtos/1').expect(401);
    await request(app).post('/api/vendas').send({}).expect(401);
  });

  test('salvar configuração da loja pede login', async () => {
    await request(app).put('/api/loja/config').send({ whatsapp: '61999990000' }).expect(401);
  });

  test('senha errada é recusada', async () => {
    await request(app).post('/api/sessao/entrar').send({ senha: 'errada' }).expect(401);
  });

  test('bloqueia depois de muitas tentativas erradas', async () => {
    for (let i = 0; i < 8; i++) await request(app).post('/api/sessao/entrar').send({ senha: 'x' });
    await request(app).post('/api/sessao/entrar').send({ senha: SENHA }).expect(429);
  });

  test('com login, a API e o painel abrem', async () => {
    const agente = await logar();
    await agente.get('/api/produtos').expect(200);
    const pagina = await agente.get('/painel').expect(200);
    expect(pagina.text).toContain('Dashboard JV Imports');
  });

  test('sem login, /painel mostra a tela de senha', async () => {
    const pagina = await request(app).get('/painel').expect(200);
    expect(pagina.text).toContain('Área restrita');
    expect(pagina.text).not.toContain('Dashboard JV Imports');
  });

  test('cookie adulterado não entra', async () => {
    await request(app).get('/api/produtos').set('Cookie', 'jv_sessao=99999999999999.assinatura-falsa').expect(401);
  });

  test('sair encerra a sessão', async () => {
    const agente = await logar();
    await agente.post('/api/sessao/sair').expect(200);
    await agente.get('/api/produtos').expect(401);
  });

  test('sem PAINEL_SENHA definida, ninguém entra', async () => {
    delete process.env.PAINEL_SENHA;
    const res = await request(app).post('/api/sessao/entrar').send({ senha: '' }).expect(503);
    expect(res.body.error).toMatch(/PAINEL_SENHA/);
    await request(app).get('/api/produtos').expect(401);
  });
});
