// tests/analise.test.js — Análise de Preços: contas (analise-calc.js) e rotas do Apps Script (Analise.js).
const { criarAmbiente } = require('./gas-falso');
const calc = require('../public/js/analise-calc');

describe('contas da análise', () => {
  test('custo máximo de compra e preço mínimo são inversos', () => {
    // vende a 200, taxa 5%, margem 35%, gasto 2 → pode pagar até 200*0,60 − 2 = 118
    expect(calc.custoMaximoCompra(200, 5, 35, 2)).toBe(118);
    expect(calc.precoMinimoParaMargem(118, 5, 35, 2)).toBe(200);
    expect(calc.precoMinimoParaMargem(10, 60, 40, 0)).toBeNull();
  });

  test('preço de vitrine termina em 9 e não passa do valor', () => {
    expect(calc.precoPsicologico(184.3)).toBe(179);
    expect(calc.precoPsicologico(189)).toBe(189);
    expect(calc.precoPsicologico(57)).toBe(54);
    expect(calc.precoPsicologicoAcima(181)).toBe(189);
  });

  test('produto abaixo do mercado ganha preço sugerido maior e diagnóstico de atenção', () => {
    const a = calc.analisarProduto(
      { custo: 20, preco: 35, mercado: { minimo: 40, medio: 60, maximo: 80 } },
      { margem_alvo: 35, taxa: 0, gastos: 0 },
    );
    expect(a.sugerido).toBe(54); // 60 × 0,97 = 58,2 → vitrine 54
    expect(a.diagnostico.nivel).toBe('atencao');
    expect(a.custoMaximo).toBe(39); // 60 × 0,65
  });

  test('preço já na faixa boa é mantido', () => {
    const a = calc.analisarProduto(
      { custo: 100, preco: 189, mercado: { minimo: 140, medio: 190, maximo: 233 } },
      { margem_alvo: 35, taxa: 3, gastos: 0 },
    );
    expect(a.sugerido).toBe(189);
    expect(a.diagnostico.nivel).toBe('ok');
  });

  test('custo alto demais para o mercado vira alerta vermelho', () => {
    const a = calc.analisarProduto(
      { custo: 200, preco: 230, mercado: { minimo: 199, medio: 210, maximo: 219 } },
      { margem_alvo: 35, taxa: 0, gastos: 0 },
    );
    expect(a.diagnostico.nivel).toBe('ruim');
  });
});

describe('rotas da análise', () => {
  function ambiente() {
    const g = criarAmbiente();
    g.api('POST', '/api/produtos', { nome: 'QCY T13 ANC', custo: 90, preco: 179, quantidade: 2 });
    g.api('POST', '/api/produtos', { nome: 'Produto sem pesquisa', custo: 10, preco: 30, quantidade: 1 });
    return g;
  }

  test('lista produtos com a pesquisa inicial e a configuração padrão', () => {
    const g = ambiente();
    const r = g.api('GET', '/api/analise');
    expect(r.config).toEqual({ margem_alvo: 35, taxa: 3, gastos: 0 });
    const t13 = r.produtos.find((p) => p.nome === 'QCY T13 ANC');
    expect(t13.mercado.pesquisa_inicial).toBe(true);
    expect(t13.mercado.medio).toBe(190);
    expect(r.produtos.find((p) => p.nome === 'Produto sem pesquisa').mercado).toBeNull();
  });

  test('salvar pesquisa substitui a inicial; tudo vazio apaga', () => {
    const g = ambiente();
    const id = g.api('GET', '/api/analise').produtos.find((p) => p.nome === 'QCY T13 ANC').id;
    g.api('PUT', `/api/analise/precos/${id}`, { minimo: 150, maximo: 210, fontes: 'OLX DF' });
    let t13 = g.api('GET', '/api/analise').produtos.find((p) => p.id === id);
    expect(t13.mercado).toMatchObject({ minimo: 150, medio: 180, maximo: 210, fontes: 'OLX DF', pesquisa_inicial: false });
    expect(() => g.api('PUT', `/api/analise/precos/${id}`, { minimo: 300, maximo: 200 })).toThrow(/mínimo está maior/);
    g.api('PUT', `/api/analise/precos/${id}`, { minimo: '', medio: '', maximo: '' });
    t13 = g.api('GET', '/api/analise').produtos.find((p) => p.id === id);
    expect(t13.mercado.pesquisa_inicial).toBe(true); // voltou para a pesquisa inicial
  });

  test('configuração valida os limites e soma as vendas do produto', () => {
    const g = ambiente();
    expect(() => g.api('PUT', '/api/analise/config', { margem_alvo: 120 })).toThrow(/Margem desejada/);
    expect(g.api('PUT', '/api/analise/config', { margem_alvo: 40, taxa: 4.5 })).toEqual({ margem_alvo: 40, taxa: 4.5, gastos: 0 });
    const id = g.api('GET', '/api/produtos').find((p) => p.nome === 'QCY T13 ANC').id;
    g.api('POST', '/api/vendas', { produto_id: id, produto_nome: 'QCY T13 ANC', quantidade: 1, valor: 179, custo: 90, forma_pagamento: 'pix' });
    const t13 = g.api('GET', '/api/analise').produtos.find((p) => p.id === id);
    expect(t13.vendas.qtd).toBe(1);
    expect(t13.vendas.faturamento).toBe(179);
    expect(t13.vendas.lucro).toBe(89);
  });
});

describe('scripts da tela', () => {
  test('nenhum nome global repetido entre os scripts do painel (quebraria o script inteiro)', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'painel.html'), 'utf8');
    const arquivos = [...html.matchAll(/<script src="\/js\/([\w-]+\.js)"><\/script>/g)].map((m) => m[1]);
    const vistos = {};
    const repetidos = [];
    arquivos.forEach((arq) => {
      const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', arq), 'utf8');
      for (const m of codigo.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        if (vistos[m[1]] && vistos[m[1]] !== arq) repetidos.push(`${m[1]} (${vistos[m[1]]} e ${arq})`);
        vistos[m[1]] = arq;
      }
    });
    expect(repetidos).toEqual([]);
  });
});
