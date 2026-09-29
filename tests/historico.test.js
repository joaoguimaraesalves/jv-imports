// tests/historico.test.js
// Testes do Histórico da Loja: acerto de estoque e resumo de longo prazo
// (funções puras, não usam banco).
const { calcularAcertoEstoque, fimDoMesAnterior } = require('../public/js/historico-calc');
const { montarResumo } = require('../lib/financeiro');

describe('calcularAcertoEstoque', () => {
  const produtos = [
    { id: 1, nome: 'Fone', quantidade: 10, custo: 40, preco: 90 },
    { id: 2, nome: 'Relógio', quantidade: 5, custo: 100, preco: 200 },
    { id: 3, nome: 'Capinha', quantidade: 3, custo: 5, preco: 20 },
  ];

  test('diferença entre sistema e estoque real vira venda antiga', () => {
    const r = calcularAcertoEstoque(produtos, { 1: { real: '4' } });
    const fone = r.linhas.find(l => l.produto_id === 1);
    expect(fone).toMatchObject({ vendidas: 6, valor: 540, custo: 240, lucro: 300 });
    expect(r.itens).toEqual([{ produto_id: 1, quantidade: 6, valor: 540 }]);
    expect(r.totais).toEqual({ unidades: 6, valor: 540, custo: 240, lucro: 300, semValor: 0 });
  });

  test('valor recebido informado substitui a sugestão (preço × qtd)', () => {
    const r = calcularAcertoEstoque(produtos, { 2: { real: 0, valor: '750' } });
    expect(r.itens).toEqual([{ produto_id: 2, quantidade: 5, valor: 750 }]);
    expect(r.totais.lucro).toBe(250);
  });

  test('produto sem contagem ou com contagem maior que o sistema não vira venda', () => {
    const r = calcularAcertoEstoque(produtos, { 1: { real: '' }, 3: { real: '8' } });
    expect(r.itens).toEqual([]);
    expect(r.linhas.find(l => l.produto_id === 3).sobra).toBe(5);
    expect(r.totais.unidades).toBe(0);
  });
});

test('produto sem preço de venda exige valor informado', () => {
  const semPreco = [{ id: 9, nome: 'Novo', quantidade: 4, custo: 10, preco: 0 }];
  expect(calcularAcertoEstoque(semPreco, { 9: { real: 1 } }).totais.semValor).toBe(1);
  expect(calcularAcertoEstoque(semPreco, { 9: { real: 1, valor: '90' } }).totais.semValor).toBe(0);
});

describe('fimDoMesAnterior', () => {
  test('dia 29/09/2026 → 31/08/2026; janeiro vira dezembro do ano anterior', () => {
    expect(fimDoMesAnterior(new Date(2026, 8, 29))).toBe('2026-08-31');
    expect(fimDoMesAnterior(new Date(2026, 0, 15))).toBe('2025-12-31');
  });
});

describe('montarResumo', () => {
  const totais = {
    vendas: { faturamento: 5000, custo: 2000, qtd: 60, faturamento_hist: 4000, custo_hist: 1700,
              recebido: 4800, primeira_venda: '2025-03-10T12:00:00.000Z' },
    compras: { investido: 3500, pago_direto: 3000, qtd: 12, primeira_compra: '2025-02-01T12:00:00.000Z' },
    contas: { pagas: 300, pendentes: 200 },
    estoque: { valor_custo: 1500, unidades: 25 },
  };

  test('lucro total = faturamento − custo das vendas, separado em antigas e sistema', () => {
    const r = montarResumo(totais, 400);
    expect(r.lucro_total).toBe(3000);
    expect(r.lucro_vendas_antigas).toBe(2300);
    expect(r.lucro_vendas_sistema).toBe(700);
    expect(r.margem).toBeCloseTo(60);
    expect(r.desde).toBe('2025-02-01T12:00:00.000Z');
  });

  test('retirado = entrou − saiu (compras + contas pagas) − saldo atual', () => {
    const r = montarResumo(totais, 400);
    expect(r.dinheiro_entrou).toBe(4800);
    expect(r.dinheiro_saiu).toBe(3300);
    expect(r.retirado_estimado).toBe(1100);
  });

  test('sem saldo informado, não estima o retirado', () => {
    expect(montarResumo(totais, null).retirado_estimado).toBeNull();
  });
});
