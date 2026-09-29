// tests/planejamento.test.js
// Testes do cálculo da Meta de Caixa (função pura, não usa banco).
const { calcularPlanejamento, diasEntre } = require('../public/js/planejamento');

describe('diasEntre', () => {
  test('conta dias entre datas, inclusive virando o mês', () => {
    expect(diasEntre('2026-09-29', '2026-10-09')).toBe(10);
    expect(diasEntre('2026-09-29', '2026-09-29')).toBe(0);
    expect(diasEntre('2026-09-29', '2026-09-27')).toBe(-2);
  });
});

describe('calcularPlanejamento', () => {
  const hoje = '2026-09-29';

  test('fatura de 705 com saldo de 400: falta 305 em 10 dias', () => {
    const r = calcularPlanejamento({
      saldo: 400,
      contas: [{ id: 1, descricao: 'Fatura', valor: 705, vencimento: '2026-10-09' }],
      mediaDiaria: 50,
      hoje,
    });
    expect(r.faltaTotal).toBe(305);
    const [f] = r.itens;
    expect(f.falta).toBe(305);
    expect(f.dias).toBe(10);
    expect(f.porDia).toBeCloseTo(30.5);
    expect(f.diasNoRitmo).toBe(7); // 305 / 50 = 6,1 → 7 dias
    expect(f.status).toBe('no-ritmo');
    expect(r.proxima.id).toBe(1);
  });

  test('acumula as contas em ordem: saldo cobre a primeira, falta na segunda', () => {
    const r = calcularPlanejamento({
      saldo: 400,
      contas: [
        { id: 1, descricao: 'A', valor: 300, vencimento: '2026-10-01' },
        { id: 2, descricao: 'B', valor: 405, vencimento: '2026-10-09' },
      ],
      mediaDiaria: 10,
      hoje,
    });
    expect(r.itens[0]).toMatchObject({ falta: 0, status: 'coberta' });
    expect(r.itens[1]).toMatchObject({ acumulado: 705, falta: 305, status: 'abaixo' });
    expect(r.proxima.id).toBe(2);
  });

  test('conta vencida ou vencendo hoje pede o valor todo hoje', () => {
    const r = calcularPlanejamento({
      saldo: 0,
      contas: [
        { id: 1, descricao: 'Vencida', valor: 100, vencimento: '2026-09-27' },
        { id: 2, descricao: 'Hoje', valor: 50, vencimento: '2026-09-29' },
      ],
      mediaDiaria: 0,
      hoje,
    });
    expect(r.itens[0]).toMatchObject({ vencida: true, porDia: 100, status: 'vencida' });
    expect(r.itens[1]).toMatchObject({ vencida: false, diasParaVender: 1, porDia: 150, diasNoRitmo: null });
  });

  test('saldo maior que as contas: nada falta e mostra a sobra', () => {
    const r = calcularPlanejamento({
      saldo: 1000,
      contas: [{ id: 1, descricao: 'Fatura', valor: 705, vencimento: '2026-10-09' }],
      mediaDiaria: 0,
      hoje,
    });
    expect(r.faltaTotal).toBe(0);
    expect(r.sobra).toBe(295);
    expect(r.proxima).toBeNull();
  });
});
