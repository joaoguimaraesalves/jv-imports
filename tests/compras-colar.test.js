// tests/compras-colar.test.js — "Colar compra": leitura do texto colado e total pago / 1º vencimento no servidor.
const { criarAmbiente } = require('./gas-falso');
const { interpretarCompraColada, lerNumero, lerData, lerItem, acharProduto } = require('../public/js/compras-colar');

const PRODUTOS = [
  { id: 20, nome: 'FONTE CARREGADOR ESSAGER 30W' },
  { id: 21, nome: 'CABO ESSAGER 60W' },
  { id: 23, nome: 'QCY HT05 ANC' },
  { id: 26, nome: 'QCY H3 ANC' },
  { id: 27, nome: 'QCY C30 CROSSKY' },
];

describe('leitura do texto', () => {
  test('números e datas no formato brasileiro', () => {
    expect(lerNumero('17,78')).toBe(17.78);
    expect(lerNumero('R$ 1.234,56')).toBe(1234.56);
    expect(lerNumero('118')).toBe(118);
    expect(lerNumero('abc')).toBeNull();
    expect(lerData('20/12/2026')).toBe('2026-12-20');
    expect(lerData('2026-12-20')).toBe('2026-12-20');
    expect(lerData('20/01', new Date(2026, 11, 5))).toBe('2027-01-20');
  });

  test('itens em vários formatos', () => {
    expect(lerItem('3 | QCY HT05 ANC | 118')).toEqual({ quantidade: 3, nome: 'QCY HT05 ANC', custo_unitario: 118 });
    expect(lerItem('CABO ESSAGER 60W; 3; 8,89')).toEqual({ quantidade: 3, nome: 'CABO ESSAGER 60W', custo_unitario: 8.89 });
    expect(lerItem('3x Fonte Essager 30W R$ 17,78')).toEqual({ quantidade: 3, nome: 'Fonte Essager 30W', custo_unitario: 17.78 });
    expect(lerItem('QCY H3 2x 98')).toEqual({ quantidade: 2, nome: 'QCY H3', custo_unitario: 98 });
  });

  test('acha o produto parecido e não confunde H3 com HT05', () => {
    expect(acharProduto('ht05', PRODUTOS).id).toBe(23);
    expect(acharProduto('QCY H3', PRODUTOS).id).toBe(26);
    expect(acharProduto('fonte essager 30w', PRODUTOS).id).toBe(20);
    expect(acharProduto('Fone XYZ Pro Max', PRODUTOS)).toBeNull();
  });

  test('compra completa colada', () => {
    const texto = [
      'Descrição: 17º Importação - AliExpress',
      'Pagamento: cartão',
      'Parcelas: 2',
      '1º vencimento: 20/12/2026',
      'Total pago: 434',
      '3 | QCY HT05 ANC | 118',
      '3 | FONTE CARREGADOR ESSAGER 30W | 17,78',
      '3 | CABO ESSAGER 60W | 8,89',
      '2 | Fonte Essager 20W | 16',
      'linha sem sentido',
    ].join('\n');
    const r = interpretarCompraColada(texto, PRODUTOS);
    expect(r).toMatchObject({ descricao: '17º Importação - AliExpress', forma_pagamento: 'cartao', parcelas: 2, primeiro_vencimento: '2026-12-20', total_pago: 434 });
    expect(r.itens.map((i) => i.produto_id)).toEqual([23, 20, 21, '']);
    expect(r.itens[3]).toMatchObject({ ehNovo: true, produto_nome: 'Fonte Essager 20W', quantidade: 2, custo_unitario: 16 });
    expect(r.ignoradas).toEqual(['linha sem sentido']);
  });

  test('"cartão 3x" no pagamento já define as parcelas', () => {
    const r = interpretarCompraColada('Pagamento: cartão 3x\n1 | QCY C30 CROSSKY | 59', PRODUTOS);
    expect(r).toMatchObject({ forma_pagamento: 'cartao', parcelas: 3 });
  });
});

describe('servidor: total pago e 1º vencimento', () => {
  function ambiente() {
    const g = criarAmbiente();
    g.api('POST', '/api/produtos', { nome: 'QCY HT05 ANC', custo: 153, preco: 249, quantidade: 0 });
    g.api('POST', '/api/produtos', { nome: 'FONTE CARREGADOR ESSAGER 30W', custo: 20, preco: 45, quantidade: 0 });
    return g;
  }

  test('parcelas usam o total pago e vencem a partir do 1º vencimento', () => {
    const g = ambiente();
    g.api('POST', '/api/compras', {
      descricao: 'AliExpress', forma_pagamento: 'cartao', parcelas: 2, primeiro_vencimento: '2026-12-20', total_pago: 434,
      itens: [{ produto_id: 1, quantidade: 3, custo_unitario: 118 }, { produto_id: 2, quantidade: 3, custo_unitario: 26.67 }],
    });
    const contas = g.api('GET', '/api/contas-pagar').filter((c) => /AliExpress/.test(c.descricao));
    expect(contas.map((c) => [c.vencimento.slice(0, 10), c.valor])).toEqual([['2026-12-20', 217], ['2027-01-20', 217]]);
    expect(g.api('GET', '/api/compras')[0].valor_total).toBe(434);
  });

  test('total pago muito diferente da soma dos itens é recusado', () => {
    const g = ambiente();
    expect(() => g.api('POST', '/api/compras', {
      forma_pagamento: 'pix', total_pago: 300, itens: [{ produto_id: 1, quantidade: 3, custo_unitario: 118 }],
    })).toThrow(/não bate/);
  });
});
