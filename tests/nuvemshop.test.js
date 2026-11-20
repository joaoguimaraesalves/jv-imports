// tests/nuvemshop.test.js — integração do painel (Apps Script) com a Nuvemshop.
// Roda o código real de apps-script/src com a API da Nuvemshop imitada (tests/gas-falso.js).
const { criarAmbiente } = require('./gas-falso');

const T0 = Date.parse('2026-11-20T15:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

// Painel com 3 produtos; a Nuvemshop com os 2 primeiros (mesmo nome) + 1 só de lá
function ambiente(opcoes = {}) {
  const g = criarAmbiente();
  g.estado.agora = T0;
  g.api('POST', '/api/produtos', { nome: 'QCY T13 ANC', custo: 80, preco: 179, quantidade: 4 });
  g.api('POST', '/api/produtos', { nome: 'Cabo Essager 60W', custo: 10, preco: 35, quantidade: 6 });
  g.api('POST', '/api/produtos', { nome: 'Parafusadeira 12v', custo: 90, preco: 199, quantidade: 1 });
  g.estado.ns.produtos = [
    { id: 501, name: { pt: 'QCY T13 ANC' }, variants: [{ id: 9001, stock: 4, sku: '', values: [] }] },
    { id: 502, name: { pt: 'Cabo  Esságer 60w' }, variants: [{ id: 9002, stock: 6, sku: '', values: [] }] },
    { id: 503, name: { pt: 'Parafusadeira 12V Bivolt' }, variants: [{ id: 9003, stock: 1, sku: '', values: [] }] },
  ];
  g.estado.ns.pedidos = opcoes.pedidos || [];
  return g;
}

function pedido(id, numero, itens, extra = {}) {
  const subtotal = itens.reduce((s, i) => s + i.price * i.quantity, 0);
  return Object.assign({
    id, number: numero, status: 'open', payment_status: 'paid',
    created_at: iso(T0 + 60e3), updated_at: iso(T0 + 60e3), paid_at: iso(T0 + 60e3),
    subtotal: String(subtotal), discount: '0', shipping_cost_customer: '0', total: String(subtotal),
    payment_details: { method: 'pix' }, customer: { name: 'Maria Souza' },
    products: itens.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: String(i.quantity), price: String(i.price), name: i.name })),
  }, extra);
}

const QCY = { product_id: 501, variant_id: 9001, price: 179, name: 'QCY T13 ANC' };
const CABO = { product_id: 502, variant_id: 9002, price: 35, name: 'Cabo Essager 60W' };

function conectar(g) {
  const s = g.api('PUT', '/api/nuvemshop/config', { app_id: '12345', client_secret: 'segredo' });
  const state = new URL(s.link_autorizar).searchParams.get('state');
  return g.ctx.doGet({ parameter: { code: 'codigo-ok', state } }).html;
}

const estoqueNs = (g, variante) => g.estado.ns.produtos.flatMap((p) => p.variants).find((v) => v.id === variante).stock;
const produto = (g, id) => g.api('GET', '/api/produtos').find((p) => p.id === id);
const vendasNs = (g) => g.api('GET', '/api/vendas').filter((v) => v.canal === 'Nuvemshop');
const avancar = (g, ms) => { g.estado.agora += ms; };

describe('conexão', () => {
  test('salvar o app gera o link de autorização; a volta com ?code conecta, liga pelo nome e agenda 5 min', () => {
    const g = ambiente();
    const s = g.api('PUT', '/api/nuvemshop/config', { app_id: '12345', client_secret: 'segredo' });
    expect(s.conectado).toBe(false);
    expect(s.redirecionamento).toBe('https://script.google.com/macros/s/PAINEL/exec');
    expect(s.link_autorizar).toMatch(/^https:\/\/www\.nuvemshop\.com\.br\/apps\/12345\/authorize\?state=/);
    expect(s).not.toHaveProperty('client_secret');

    const state = new URL(s.link_autorizar).searchParams.get('state');
    const html = g.ctx.doGet({ parameter: { code: 'codigo-ok', state } }).html;
    expect(html).toMatch(/Nuvemshop conectada \(JV Imports\)/);
    expect(html).toMatch(/2 produto\(s\) ligado\(s\)/);

    const depois = g.api('GET', '/api/nuvemshop');
    expect(depois).toMatchObject({ conectado: true, loja: 'JV Imports', ligados: 2, erro: null });
    expect(depois.sem_ligacao_painel).toEqual([{ id: 3, nome: 'Parafusadeira 12v' }]);
    expect(depois.sem_ligacao_ns.map((v) => v.variante)).toEqual(['9003']);
    expect(g.estado.gatilhos).toContainEqual(expect.objectContaining({ funcao: 'sincronizarNuvemshopPeriodico', minutos: 5 }));
    expect(g.estado.props.get('NS_TOKEN')).toBe('tok-ns');
    // O segredo foi para a troca do token; as chamadas da API usam o token
    expect(g.estado.ns.chamadas.find((c) => c.caminho === 'token').corpo).toMatchObject({ client_id: '12345', client_secret: 'segredo', grant_type: 'authorization_code' });
  });

  test('API só na versão v1: descobre sozinho e usa a v1', () => {
    const g = ambiente();
    g.estado.ns.versao = 'v1';
    expect(conectar(g)).toMatch(/conectada/);
    expect(g.estado.props.get('NS_VERSAO')).toBe('v1');
    expect(g.api('GET', '/api/nuvemshop').ligados).toBe(2);
  });

  test('state diferente ou código vencido: mostra o erro e não conecta', () => {
    const g = ambiente();
    g.api('PUT', '/api/nuvemshop/config', { app_id: '12345', client_secret: 'segredo' });
    expect(g.ctx.doGet({ parameter: { code: 'codigo-ok', state: 'forjado' } }).html).toMatch(/inválido/);
    const state = new URL(g.api('GET', '/api/nuvemshop').link_autorizar).searchParams.get('state');
    expect(g.ctx.doGet({ parameter: { code: 'velho', state } }).html).toMatch(/5 minutos/);
    expect(g.api('GET', '/api/nuvemshop').conectado).toBe(false);
  });

  test('App ID inválido e falta do segredo são recusados', () => {
    const g = ambiente();
    expect(() => g.api('PUT', '/api/nuvemshop/config', { app_id: 'abc', client_secret: 'x' })).toThrow(/App ID inválido/);
    expect(() => g.api('PUT', '/api/nuvemshop/config', { app_id: '123' })).toThrow(/Client Secret/);
  });

  test('sem conexão, sincronizar não faz nada e a página normal continua abrindo', () => {
    const g = ambiente();
    expect(JSON.parse(g.ctx.sincronizarNuvemshopAgora())).toEqual({ ok: false, erro: 'Nuvemshop não conectada' });
    expect(g.estado.ns.chamadas).toHaveLength(0);
  });

  test('desconectar apaga o token e o gatilho', () => {
    const g = ambiente();
    conectar(g);
    const s = g.api('DELETE', '/api/nuvemshop');
    expect(s.conectado).toBe(false);
    expect(g.estado.props.has('NS_TOKEN')).toBe(false);
    expect(g.estado.gatilhos.some((t) => t.funcao === 'sincronizarNuvemshopPeriodico')).toBe(false);
  });
});

describe('estoque do painel → Nuvemshop', () => {
  test('na conexão envia o estoque do painel; depois só envia o que mudou', () => {
    const g = ambiente();
    g.estado.ns.produtos[0].variants[0].stock = 10; // estava diferente lá
    conectar(g);
    expect(estoqueNs(g, 9001)).toBe(4);
    expect(estoqueNs(g, 9003)).toBe(1); // sem ligação: não mexe

    g.estado.ns.chamadas.length = 0;
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(g.estado.ns.chamadas.filter((c) => c.metodo === 'put')).toHaveLength(0);
  });

  test('venda no painel: a sincronização seguinte baixa o estoque na Nuvemshop', () => {
    const g = ambiente();
    conectar(g);
    g.api('POST', '/api/vendas', { produto_id: 2, produto_nome: 'Cabo Essager 60W', quantidade: 2, valor: 70, custo: 20, canal: 'WhatsApp' });
    const r = JSON.parse(g.ctx.sincronizarNuvemshopAgora());
    expect(r).toMatchObject({ ok: true, enviados: 1 });
    expect(estoqueNs(g, 9002)).toBe(4);
  });

  test('pedido aguardando pagamento: a Nuvemshop já separou, então envia painel − reservado', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(70, 101, [{ ...QCY, quantity: 1 }], { payment_status: 'pending', paid_at: null, created_at: iso(T0 + 120e3), updated_at: iso(T0 + 120e3) }));
    g.estado.ns.produtos[0].variants[0].stock = 3; // a Nuvemshop tirou ao criar o pedido
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(estoqueNs(g, 9001)).toBe(3);   // não devolve a unidade separada
    expect(produto(g, 1).quantidade).toBe(4); // painel só baixa quando pagar
    expect(vendasNs(g)).toHaveLength(0);

    // pagou: vira venda, painel 3, Nuvemshop continua 3
    Object.assign(g.estado.ns.pedidos[0], { payment_status: 'paid', paid_at: iso(T0 + 400e3), updated_at: iso(T0 + 400e3) });
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(vendasNs(g)).toHaveLength(1);
    expect(produto(g, 1).quantidade).toBe(3);
    expect(estoqueNs(g, 9001)).toBe(3);
  });

  test('ligar à mão um produto que o nome não achou', () => {
    const g = ambiente();
    conectar(g);
    const s = g.api('PUT', '/api/nuvemshop/ligar', { produto_id: 3, ns_variante_id: '9003' });
    expect(s.ligados).toBe(3);
    expect(s.sem_ligacao_painel).toEqual([]);
    expect(produto(g, 3)).toMatchObject({ ns_produto_id: '503', ns_variante_id: '9003' });
    expect(() => g.api('PUT', '/api/nuvemshop/ligar', { produto_id: 3, ns_variante_id: '123' })).toThrow(/não encontrado/);
  });

  test('SKU com o id do painel liga mesmo com nome diferente', () => {
    const g = ambiente();
    g.estado.ns.produtos[2].variants[0].sku = 'JV-3';
    conectar(g);
    expect(produto(g, 3).ns_variante_id).toBe('9003');
  });
});

describe('pedidos da Nuvemshop → vendas do painel', () => {
  test('pedido pago vira uma venda por item, com canal, cliente, desconto rateado e sem frete', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(71, 102, [{ ...QCY, quantity: 1 }, { ...CABO, quantity: 2 }], {
      // subtotal 249, cupom de 24,90 (10%), frete 20 → total 244,10
      discount: '24.90', shipping_cost_customer: '20', total: '244.10', payment_details: { method: 'credit_card' },
    }));
    avancar(g, 5 * 60e3);
    const r = JSON.parse(g.ctx.sincronizarNuvemshopAgora());
    expect(r).toMatchObject({ ok: true, importados: 1 });

    const vendas = vendasNs(g).sort((a, b) => a.id - b.id);
    expect(vendas).toHaveLength(2);
    expect(vendas[0]).toMatchObject({ produto_id: 1, quantidade: 1, valor: 161.1, custo: 80, forma_pagamento: 'cartao', recebido: true, cliente: 'Maria Souza · pedido #102', origem: 'ns:71:9001' });
    expect(vendas[1]).toMatchObject({ produto_id: 2, quantidade: 2, valor: 63, custo: 20, origem: 'ns:71:9002' });
    expect(produto(g, 1).quantidade).toBe(3);
    expect(produto(g, 2).quantidade).toBe(4);
    const mov = g.api('GET', '/api/estoque/movimentos');
    expect(JSON.stringify(mov)).toMatch(/Nuvemshop pedido #102/);
    expect(g.api('GET', '/api/nuvemshop').ultimos_importados[0]).toMatchObject({ numero: 102, total: 244.1 });

    // rodar de novo (inclusive com o pedido atualizado, ex.: marcado como enviado) não duplica
    g.estado.ns.pedidos[0].updated_at = iso(T0 + 600e3);
    avancar(g, 10 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(vendasNs(g)).toHaveLength(2);
    expect(produto(g, 1).quantidade).toBe(3);
  });

  test('pedido cancelado depois de importado: as vendas saem e o estoque do painel volta', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(72, 103, [{ ...CABO, quantity: 3 }]));
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(produto(g, 2).quantidade).toBe(3);

    Object.assign(g.estado.ns.pedidos[0], { status: 'cancelled', updated_at: iso(T0 + 700e3) });
    g.estado.ns.produtos[1].variants[0].stock = 6; // a Nuvemshop devolve sozinha
    avancar(g, 10 * 60e3);
    const r = JSON.parse(g.ctx.sincronizarNuvemshopAgora());
    expect(r.desfeitos).toBe(1);
    expect(vendasNs(g)).toHaveLength(0);
    expect(produto(g, 2).quantidade).toBe(6);
    expect(estoqueNs(g, 9002)).toBe(6);
  });

  test('pedido não pago ou cancelado antes de importar é ignorado', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(73, 104, [{ ...QCY, quantity: 1 }], { payment_status: 'pending' }));
    g.estado.ns.pedidos.push(pedido(74, 105, [{ ...QCY, quantity: 1 }], { status: 'cancelled', payment_status: 'voided' }));
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(vendasNs(g)).toHaveLength(0);
    expect(produto(g, 1).quantidade).toBe(4);
  });

  test('item sem ligação: lança a venda sem baixar estoque e avisa', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(75, 106, [{ product_id: 503, variant_id: 9003, quantity: 1, price: 199, name: 'Parafusadeira 12V Bivolt' }]));
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    const [v] = vendasNs(g);
    expect(v).toMatchObject({ produto_id: null, produto_nome: 'Parafusadeira 12V Bivolt', valor: 199, custo: 0 });
    expect(produto(g, 3).quantidade).toBe(1);
    expect(g.api('GET', '/api/nuvemshop').avisos.join(' ')).toMatch(/não está ligado/);
  });

  test('vendeu mais do que o painel tinha: lança mesmo assim e avisa do estoque negativo', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.pedidos.push(pedido(76, 107, [{ ...QCY, quantity: 5 }]));
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(produto(g, 1).quantidade).toBe(-1);
    expect(estoqueNs(g, 9001)).toBe(0);
    expect(g.api('GET', '/api/nuvemshop').avisos.join(' ')).toMatch(/estoque negativo/);
  });

  test('canal Nuvemshop aparece na lista de canais das vendas', () => {
    const g = ambiente();
    expect(g.api('GET', '/api/config/vendas').canais).toContain('Nuvemshop');
  });
});

describe('pedidos pagos antes da conexão', () => {
  function comAntigo() {
    const antigo = pedido(60, 100, [{ ...CABO, quantity: 2 }], { created_at: iso(T0 - 864e5), updated_at: iso(T0 - 864e5), paid_at: iso(T0 - 864e5) });
    const g = ambiente({ pedidos: [antigo] });
    g.estado.ns.produtos[1].variants[0].stock = 4; // a Nuvemshop já baixou
    const html = conectar(g);
    return { g, html };
  }

  test('ficam esperando decisão e o envio de estoque para (não sobe o estoque de lá)', () => {
    const { g, html } = comAntigo();
    expect(html).toMatch(/1 pedido\(s\) pago\(s\) antes da conexão/);
    const s = g.api('GET', '/api/nuvemshop');
    expect(s.antigos).toEqual([expect.objectContaining({ numero: 100, itens: '2× Cabo Essager 60W', cliente: 'Maria Souza' })]);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(estoqueNs(g, 9002)).toBe(4);
    expect(vendasNs(g)).toHaveLength(0);
  });

  test('importar: viram vendas e o estoque volta a ser enviado', () => {
    const { g } = comAntigo();
    const s = g.api('POST', '/api/nuvemshop/antigos', { acao: 'importar' });
    expect(s.antigos).toEqual([]);
    expect(vendasNs(g)).toHaveLength(1);
    expect(produto(g, 2).quantidade).toBe(4);
    expect(estoqueNs(g, 9002)).toBe(4);
  });

  test('ignorar (já lançados à mão): não importa e o estoque do painel manda', () => {
    const { g } = comAntigo();
    g.api('POST', '/api/nuvemshop/antigos', { acao: 'ignorar' });
    expect(vendasNs(g)).toHaveLength(0);
    expect(estoqueNs(g, 9002)).toBe(6);
    // e o pedido antigo não entra depois, mesmo se for atualizado na Nuvemshop
    g.estado.ns.pedidos[0].updated_at = iso(T0 + 60e3);
    avancar(g, 5 * 60e3);
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(vendasNs(g)).toHaveLength(0);
  });
});

describe('erros', () => {
  test('token recusado (app desinstalado): erro aparece na tela, nada muda no painel', () => {
    const g = ambiente();
    conectar(g);
    g.estado.props.set('NS_TOKEN', 'outro');
    const r = JSON.parse(g.ctx.sincronizarNuvemshopAgora());
    expect(r.ok).toBe(false);
    expect(g.api('GET', '/api/nuvemshop').erro).toMatch(/recusou o acesso/);
  });

  test('erro da Nuvemshop: guarda a mensagem e na próxima vez que der certo limpa', () => {
    const g = ambiente();
    conectar(g);
    g.estado.ns.falhar = { status: 500, mensagem: 'Internal error' };
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(g.api('GET', '/api/nuvemshop').erro).toBe('Nuvemshop respondeu 500: Internal error');
    g.estado.ns.falhar = null;
    g.ctx.sincronizarNuvemshopPeriodico();
    expect(g.api('GET', '/api/nuvemshop').erro).toBeNull();
  });

  test('sincronização em andamento: a próxima fica na fila em vez de rodar junto', () => {
    const g = ambiente();
    conectar(g);
    g.estado.cache.set('jv:ns:rodando', '1');
    expect(JSON.parse(g.ctx.sincronizarNuvemshopAgora())).toEqual({ ok: true, enfileirado: true });
    expect(g.estado.cache.get('jv:ns:pendente')).toBe('1');
  });
});
