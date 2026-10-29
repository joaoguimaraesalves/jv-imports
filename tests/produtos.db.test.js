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

  // O painel pede senha: o teste define uma e faz login com um "agente"
  // (guarda o cookie da sessão entre as requisições).
  const SENHA = 'senha-do-teste-ci';
  let api;

  beforeAll(async () => {
    process.env.PAINEL_SENHA = SENHA;
    await initDb(pool); // garante que as tabelas existem
    api = request.agent(app);
    await api.post('/api/sessao/entrar').send({ senha: SENHA }).expect(200);
  });

  // Remove o que o teste deixa no banco real: produtos "TESTECI..." (inclusive
  // de execuções antigas que falharam no meio) e os movimentos deles.
  async function limparProdutosDeTeste() {
    await pool.query(
      `DELETE FROM estoque_movimentos
       WHERE produto_id IN (SELECT id FROM produtos WHERE nome LIKE 'TESTECI%')`
    );
    await pool.query(`DELETE FROM produtos WHERE nome LIKE 'TESTECI%'`);
  }

  afterAll(async () => {
    try {
      await limparProdutosDeTeste();
    } finally {
      await pool.end(); // fecha a conexão pro Jest não travar
    }
  });

  test('cria, edita e exclui um produto no banco real', async () => {
    const nome = 'TESTECI' + Date.now();

    // CREATE
    // na_loja: false → o produto de teste nunca aparece no site de verdade
    const post = await api
      .post('/api/produtos')
      .send({ nome, custo: 10, preco: 25, quantidade: 5, na_loja: false });
    expect(post.status).toBe(200);
    criadoId = post.body.id;
    expect(criadoId).toBeGreaterThan(0);

    // READ — confirma que persistiu
    const get = await api.get('/api/produtos');
    const achou = get.body.find((p) => p.id === criadoId);
    expect(achou).toBeTruthy();
    expect(achou.nome).toBe(nome);
    expect(achou.na_loja).toBe(false);

    // Oculto não aparece na vitrine pública
    const vitrine = await request(app).get('/api/loja/produtos');
    expect(vitrine.status).toBe(200);
    expect(vitrine.body.produtos.some((p) => p.id === criadoId)).toBe(false);

    // Foto: envia, só o painel logado enxerga (produto oculto), depois remove
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString('base64');
    await api.put(`/api/produtos/${criadoId}/foto`).send({ foto: jpeg }).expect(200);
    await request(app).get(`/api/loja/foto/${criadoId}`).expect(404);
    await api.get(`/api/loja/foto/${criadoId}`).expect(200);
    await api.delete(`/api/produtos/${criadoId}/foto`).expect(200);

    // UPDATE (funcionalidade nova do PR 2)
    const put = await api
      .put(`/api/produtos/${criadoId}`)
      .send({ nome, custo: 12, preco: 30, quantidade: 8, descricao: 'Teste', categoria: 'Teste' });
    expect(put.status).toBe(200);
    expect(Number(put.body.produto.quantidade)).toBe(8);
    expect(put.body.produto.descricao).toBe('Teste');
    expect(put.body.produto.na_loja).toBe(false); // não veio no pedido: manteve oculto

    // A edição mudou a quantidade (5 → 8): fica registrado um movimento de ajuste
    const movs = await pool.query(
      `SELECT quantidade FROM estoque_movimentos WHERE produto_id = $1 AND tipo = 'ajuste'`, [criadoId]
    );
    expect(movs.rows.map((m) => m.quantidade)).toEqual([3]);
    // Apaga o movimento de teste antes de excluir, pra não deixar lixo no banco real
    await pool.query('DELETE FROM estoque_movimentos WHERE produto_id = $1', [criadoId]);

    // DELETE
    const del = await api.delete(`/api/produtos/${criadoId}`);
    expect(del.status).toBe(200);
    criadoId = null; // já limpou
  });
});
