// tests/apps-script.test.js — painel do Apps Script (apps-script/src) com a loja online.
// Roda o código real do Apps Script num ambiente imitado (tests/gas-falso.js).
const { criarAmbiente } = require('./gas-falso');

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const CONTA = 'a'.repeat(32);
const NS = 'b'.repeat(32);

function vitrine(estado) {
  return JSON.parse(estado.kv.get('vitrine').toString('utf8'));
}

// Ambiente com 2 produtos, foto no primeiro e a Cloudflare conectada
function ambienteComLoja() {
  const g = criarAmbiente();
  g.api('POST', '/api/produtos', { nome: 'QCY T13 ANC', custo: 80, preco: 179, quantidade: 4, categoria: 'Fones', descricao: 'ANC', preco_antigo: 219 });
  g.api('POST', '/api/produtos', { nome: 'Cabo 60W', custo: 10, preco: 35, quantidade: 2 });
  g.api('PUT', '/api/produtos/1/foto', { foto: JPEG });
  g.api('PUT', '/api/loja/config', { whatsapp: '(61) 99999-0000' });
  const r = g.api('PUT', '/api/publicacao/config', { conta: CONTA, namespace: NS, token: 'tok', site: 'jv-imports.pages.dev' });
  return { g, r };
}

describe('cadastro de produto com os campos da loja', () => {
  test('cria, lista e edita mantendo os campos que não vieram', () => {
    const g = criarAmbiente();
    g.api('POST', '/api/produtos', { nome: 'Fone', custo: 10, preco: 50, quantidade: 3, categoria: 'Fones', na_loja: false });
    let [p] = g.api('GET', '/api/produtos');
    expect(p).toMatchObject({ nome: 'Fone', categoria: 'Fones', na_loja: false, destaque: false, foto_url: null });

    g.api('PUT', '/api/produtos/1', { nome: 'Fone X', custo: 10, preco: 55, quantidade: 3 });
    [p] = g.api('GET', '/api/produtos');
    expect(p).toMatchObject({ nome: 'Fone X', preco: 55, categoria: 'Fones', na_loja: false });
  });

  test('planilha antiga (só 5 colunas) continua funcionando e ganha as colunas novas', () => {
    const g = criarAmbiente();
    const aba = g.aba('produtos');
    aba.dados.length = 0;
    aba.dados.push(['id', 'nome', 'custo', 'preco', 'quantidade'], [1, 'Antigo', 10, 99, 2]);
    g.ctx.limparCache();
    let [p] = g.api('GET', '/api/produtos');
    expect(p.nome).toBe('Antigo');
    g.api('PUT', '/api/produtos/1', { nome: 'Antigo', custo: 10, preco: 99, quantidade: 2, descricao: 'Novo campo' });
    expect(aba.dados[0]).toEqual(expect.arrayContaining(['descricao', 'na_loja', 'foto_id']));
    [p] = g.api('GET', '/api/produtos');
    expect(p.descricao).toBe('Novo campo');
    expect(p.na_loja).toBe(true); // vazio na planilha antiga = aparece no site
  });

  test('foto vai para a pasta do Drive; trocar manda a antiga para a lixeira', () => {
    const g = criarAmbiente();
    g.api('POST', '/api/produtos', { nome: 'Fone', custo: 10, preco: 50, quantidade: 3 });
    g.api('PUT', '/api/produtos/1/foto', { foto: JPEG });
    let [p] = g.api('GET', '/api/produtos');
    const primeira = p.foto_id;
    expect(g.estado.drive.get(primeira).pasta).toBe('JV Imports - Fotos da Loja');
    expect(p.foto_url).toContain(primeira);

    g.api('PUT', '/api/produtos/1/foto', { foto: JPEG });
    [p] = g.api('GET', '/api/produtos');
    expect(p.foto_id).not.toBe(primeira);
    expect(g.estado.drive.get(primeira).lixeira).toBe(true);

    g.api('DELETE', '/api/produtos/1/foto');
    [p] = g.api('GET', '/api/produtos');
    expect(p.foto_id).toBeNull();
  });

  test('recusa arquivo que não é imagem', () => {
    const g = criarAmbiente();
    g.api('POST', '/api/produtos', { nome: 'Fone', custo: 10, preco: 50, quantidade: 3 });
    const falso = 'data:image/png;base64,' + Buffer.from('<script>').toString('base64');
    expect(() => g.api('PUT', '/api/produtos/1/foto', { foto: falso })).toThrow(/imagem válida/);
  });
});

describe('publicação na Cloudflare', () => {
  test('salvar a conexão liga o gatilho de 10 min e publica vitrine + foto', () => {
    const { g, r } = ambienteComLoja();
    expect(r.ok).toBe(true);
    expect(r.configurado).toBe(true);
    expect(r.site).toBe('https://jv-imports.pages.dev');
    expect(r).not.toHaveProperty('token');
    expect(g.estado.gatilhos).toEqual([expect.objectContaining({ funcao: 'publicarLojaPeriodico', minutos: 10 })]);

    const v = vitrine(g.estado);
    expect(v.loja.whatsapp).toBe('5561999990000');
    expect(v.produtos.map((p) => p.nome)).toEqual(['Cabo 60W', 'QCY T13 ANC']);
    const qcy = v.produtos.find((p) => p.id === 1);
    expect(qcy).toMatchObject({ preco: 179, preco_antigo: 219, desconto: 18, disponivel: true, categoria: 'Fones' });
    expect(JSON.stringify(v)).not.toMatch(/custo|"quantidade"/);

    const chaveFoto = qcy.foto.match(/foto\/1\?v=(\d+)/);
    expect(g.estado.kv.get(`foto-1-${chaveFoto[1]}`)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    expect(g.estado.chamadasKv.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  test('venda no painel: a publicação seguinte mostra o estoque novo', () => {
    const { g } = ambienteComLoja();
    g.api('POST', '/api/vendas', { produto_id: 2, produto_nome: 'Cabo 60W', quantidade: 2, valor: 70, custo: 20 });
    g.estado.chamadasKv.length = 0;
    const r = JSON.parse(g.ctx.publicarLojaAgora());
    expect(r.ok).toBe(true);
    const cabo = vitrine(g.estado).produtos.find((p) => p.id === 2);
    expect(cabo.disponivel).toBe(false);
    // Só a vitrine foi reenviada: a foto já estava lá e a nuvem não foi relistada
    expect(g.estado.chamadasKv.map((c) => c.metodo)).toEqual(['put']);
  });

  test('produto oculto e sem preço não vão para o site (nem a foto)', () => {
    const { g } = ambienteComLoja();
    g.api('PUT', '/api/produtos/1', { nome: 'QCY T13 ANC', custo: 80, preco: 179, quantidade: 4, na_loja: false });
    g.ctx.publicarLojaAgora();
    expect(vitrine(g.estado).produtos.map((p) => p.id)).toEqual([2]);
  });

  test('gatilho periódico: não envia nada se nada mudou; envia se mudaram a planilha à mão', () => {
    const { g } = ambienteComLoja();
    g.estado.chamadasKv.length = 0;
    g.ctx.publicarLojaPeriodico();
    expect(g.estado.chamadasKv).toHaveLength(0);

    // Edição direto na planilha: estoque do Cabo 2 → 0
    const aba = g.aba('produtos');
    const col = aba.dados[0].indexOf('quantidade');
    const linha = aba.dados.findIndex((l) => l[1] === 'Cabo 60W');
    aba.dados[linha][col] = 0;
    g.ctx.publicarLojaPeriodico();
    expect(vitrine(g.estado).produtos.find((p) => p.id === 2).disponivel).toBe(false);
  });

  test('foto trocada: a antiga sai da nuvem só depois de 5 minutos', () => {
    const { g } = ambienteComLoja();
    const antiga = [...g.estado.kv.keys()].find((k) => k.startsWith('foto-1-'));
    g.estado.agora = Date.now() + 1000;
    g.api('PUT', '/api/produtos/1/foto', { foto: JPEG });
    g.ctx.publicarLojaAgora();
    expect(g.estado.kv.has(antiga)).toBe(true);
    g.estado.agora += 60 * 1000;
    g.ctx.publicarLojaAgora();
    expect(g.estado.kv.has(antiga)).toBe(true);
    g.estado.agora += 5 * 60 * 1000;
    g.ctx.publicarLojaAgora();
    expect(g.estado.kv.has(antiga)).toBe(false);
    expect([...g.estado.kv.keys()].filter((k) => k.startsWith('foto-1-'))).toHaveLength(1);
  });

  test('erro da Cloudflare aparece na tela Loja Online', () => {
    const { g } = ambienteComLoja();
    g.estado.falharKv = { status: 403, mensagem: 'Authentication error' };
    const r = g.api('POST', '/api/publicacao/agora');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/403.*Authentication error/);
    expect(g.api('GET', '/api/publicacao').erro).toMatch(/Authentication error/);

    g.estado.falharKv = null; // voltou: o botão Republicar resolve
    expect(g.api('POST', '/api/publicacao/agora')).toMatchObject({ ok: true, erro: null });
  });

  test('foto apagada do Drive à mão: o produto aparece sem foto em vez de travar tudo', () => {
    const { g } = ambienteComLoja();
    const [p] = g.api('GET', '/api/produtos').filter((x) => x.id === 1);
    g.estado.drive.get(p.foto_id).lixeira = true;
    g.estado.kv.clear();
    const r = g.api('POST', '/api/publicacao/agora');
    expect(r.ok).toBe(true);
    expect(vitrine(g.estado).produtos.find((x) => x.id === 1).foto).toBeNull();
  });

  test('publicação em andamento: a próxima fica na fila em vez de rodar junto', () => {
    const { g } = ambienteComLoja();
    g.estado.travaOcupada = true;
    expect(JSON.parse(g.ctx.publicarLojaAgora())).toMatchObject({ ok: true, enfileirado: true });
    expect(g.estado.cache.get('jv:loja:pendente')).toBe('1');
  });

  test('IDs da Cloudflare inválidos são recusados com explicação', () => {
    const g = criarAmbiente();
    expect(() => g.api('PUT', '/api/publicacao/config', { conta: 'abc', namespace: NS, token: 't' })).toThrow(/Account ID inválido/);
  });

  test('sem conexão, publicar não faz nada', () => {
    const g = criarAmbiente();
    expect(JSON.parse(g.ctx.publicarLojaAgora())).toMatchObject({ ok: false });
    expect(g.estado.chamadasKv).toHaveLength(0);
    expect(g.api('GET', '/api/publicacao')).toMatchObject({ configurado: false, permite_configurar: true, tem_token: false });
  });
});

test('não depende da ordem em que o Google carrega os arquivos', () => {
  const g = criarAmbiente({ ordem: ['Loja.js', 'Rotas.js', 'Financeiro.js', 'Codigo.js', 'Banco.js', 'Backup.js'] });
  g.api('POST', '/api/produtos', { nome: 'Fone', custo: 10, preco: 50, quantidade: 3 });
  expect(g.api('GET', '/api/loja/config').pagamento).toMatch(/Pix/);
});
