// tests/produtos.db.test.js
// Teste de integração com o banco REAL (Postgres/Neon).
// Roda quando DATABASE_URL está definida (no CI vem do secret).
// Sem DATABASE_URL, o bloco é pulado — assim "npm test" não quebra pra quem
// não tem a credencial do banco na máquina.
const request = require('supertest');
const app = require('../server');
const pool = require('../db/pool');
const { initDb } = require('../db/schema');

const TEM_BD = !!process.env.DATABASE_URL;
const bloco = TEM_BD ? describe : describe.skip;

bloco('Integração com Postgres — CRUD de produtos', () => {
  let criadoId = null;

  beforeAll(async () => {
    await initDb(pool); // garante que as tabelas existem
  });

  afterAll(async () => {
    if (criadoId) {
      await pool.query('DELETE FROM produtos WHERE id = $1', [criadoId]);
    }
    await pool.end(); // fecha a conexão pro Jest não travar
  });

  test('cria, edita e exclui um produto no banco real', async () => {
    const nome = 'TESTECI' + Date.now();

    // CREATE
    const post = await request(app)
      .post('/api/produtos')
      .send({ nome, custo: 10, preco: 25, quantidade: 5 });
    expect(post.status).toBe(200);
    criadoId = post.body.id;
    expect(criadoId).toBeGreaterThan(0);

    // READ — confirma que persistiu
    const get = await request(app).get('/api/produtos');
    const achou = get.body.find((p) => p.id === criadoId);
    expect(achou).toBeTruthy();
    expect(achou.nome).toBe(nome);

    // UPDATE (funcionalidade nova do PR 2)
    const put = await request(app)
      .put(/api/produtos/${criadoId})
      .send({ nome, custo: 12, preco: 30, quantidade: 8 });
    expect(put.status).toBe(200);
    expect(Number(put.body.produto.quantidade)).toBe(8);

    // DELETE
    const del = await request(app).delete(/api/produtos/${criadoId});
    expect(del.status).toBe(200);
    criadoId = null; // já limpou
  });
});
