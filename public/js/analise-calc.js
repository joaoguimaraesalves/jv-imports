// public/js/analise-calc.js — contas da Análise de Preços (funções puras, testadas em tests/analise.test.js)
//
// Convenções: taxa e margem em % (ex.: 35 = 35%). "gastos" = gasto extra por venda em R$
// (embalagem, motoboy...). Margem = lucro ÷ preço de venda (não é markup).

const arredondar2 = (v) => Math.round(v * 100) / 100;

// Lucro de uma unidade vendida a "preco": tira o custo, a taxa (% do preço) e o gasto extra.
function lucroUnitario(preco, custo, taxa, gastos) {
    return preco - custo - preco * (taxa / 100) - gastos;
}

// Menor preço de venda que ainda dá a margem desejada.
function precoMinimoParaMargem(custo, taxa, margem, gastos) {
    const sobra = 1 - taxa / 100 - margem / 100;
    if (sobra <= 0) return null; // taxa + margem ≥ 100%: impossível
    return arredondar2((custo + gastos) / sobra);
}

// Máximo que vale pagar na compra para, vendendo a "precoVenda", ficar com a margem desejada.
function custoMaximoCompra(precoVenda, taxa, margem, gastos) {
    if (!precoVenda) return null;
    return arredondar2(Math.max(0, precoVenda * (1 - taxa / 100 - margem / 100) - gastos));
}

// Preço "quebrado" de vitrine (R$ 179, R$ 54) que não passa de "valor".
function precoPsicologico(valor) {
    if (!valor || valor <= 0) return 0;
    const passo = valor >= 100 ? 10 : 5;
    const p = Math.floor((valor + 1) / passo) * passo - 1;
    return p > 0 ? p : Math.round(valor);
}

// Mesmo arredondamento, mas nunca abaixo de "valor" (usado quando o piso é a margem).
function precoPsicologicoAcima(valor) {
    const p = precoPsicologico(valor);
    if (p >= valor) return p;
    return precoPsicologico(valor + (valor >= 100 ? 10 : 5));
}

// Análise completa de um produto: margem atual, posição no mercado, preço sugerido e diagnóstico.
// p = { custo, preco, mercado: { minimo, medio, maximo } | null }; cfg = { margem_alvo, taxa, gastos }
function analisarProduto(p, cfg) {
    const taxa = Number(cfg.taxa) || 0;
    const meta = Number(cfg.margem_alvo) || 0;
    const gastos = Number(cfg.gastos) || 0;
    const custo = Number(p.custo) || 0;
    const preco = Number(p.preco) || 0;
    const m = p.mercado || {};
    const minimo = Number(m.minimo) || null;
    const maximo = Number(m.maximo) || null;
    const ref = Number(m.medio) || (minimo && maximo ? (minimo + maximo) / 2 : minimo || maximo || null);

    const lucro = arredondar2(lucroUnitario(preco, custo, taxa, gastos));
    const margem = preco ? arredondar2((lucro / preco) * 100) : null;
    const markup = custo ? arredondar2(preco / custo) : null;
    const precoMeta = precoMinimoParaMargem(custo, taxa, meta, gastos);
    const posicao = ref && preco ? arredondar2((preco / ref - 1) * 100) : null;

    // Preço sugerido: nunca passa do teto do mercado (acima disso o cliente compra em outro lugar).
    // - abaixo do competitivo (97% da média): sobe para o competitivo, ou até o preço da margem desejada se couber;
    // - dentro da faixa: mantém, a não ser que a margem desejada caiba subindo um pouco;
    // - acima do teto: desce para o teto.
    const custoMaximo = custoMaximoCompra(ref, taxa, meta, gastos);
    const custoMaximoAgressivo = custoMaximoCompra(minimo, taxa, meta, gastos);
    let sugerido = preco;
    let custoAlto = false;
    if (ref) {
        const competitivo = precoPsicologico(ref * 0.97);
        const teto = maximo || ref * 1.1;
        const tetoVitrine = precoPsicologico(teto);
        const precoMetaVitrine = precoMeta ? precoPsicologicoAcima(precoMeta) : 0;
        custoAlto = !!precoMeta && precoMeta > teto;
        if (preco > teto) sugerido = tetoVitrine;
        else if (preco < competitivo) sugerido = Math.min(Math.max(competitivo, precoMetaVitrine), tetoVitrine);
        // Para bater a margem, sobe no máximo até 10% acima da média; mais que isso o problema é o custo.
        else if (precoMeta && preco < precoMeta && precoMeta <= Math.min(teto, ref * 1.1)) sugerido = Math.min(precoMetaVitrine, tetoVitrine);
    } else if (precoMeta && preco < precoMeta) {
        sugerido = precoPsicologicoAcima(precoMeta);
    }
    const lucroSugerido = arredondar2(lucroUnitario(sugerido, custo, taxa, gastos));

    let diagnostico;
    if (preco && lucro < 0) diagnostico = { nivel: 'ruim', texto: 'Vendendo com prejuízo' };
    else if (custoAlto) {
        diagnostico = { nivel: 'ruim', texto: `Custo alto para este mercado: para ${meta}% de margem, pague até ${formatarReal(custoMaximo)}` };
    } else if (minimo && preco < minimo) {
        diagnostico = { nivel: 'atencao', texto: `Abaixo do menor preço do mercado: dá para cobrar ${formatarReal(sugerido)}` };
    } else if (maximo && preco > maximo) {
        diagnostico = { nivel: 'atencao', texto: `Acima de todo o mercado: pode travar a venda (sugestão ${formatarReal(sugerido)})` };
    } else if (margem !== null && margem < meta) {
        diagnostico = { nivel: 'atencao', texto: ref && precoMeta > ref * 1.1
            ? `Margem abaixo da meta: o custo está alto para a média do mercado (pague até ${formatarReal(custoMaximo)})`
            : `Margem abaixo da meta de ${meta}%` };
    } else if (ref && preco > ref * 1.1) {
        diagnostico = { nivel: 'info', texto: 'Acima da média, mas dentro da faixa do mercado' };
    } else if (ref && preco < ref * 0.9) {
        diagnostico = { nivel: 'info', texto: `Abaixo da média do mercado: espaço para ${formatarReal(sugerido)}` };
    } else if (!ref) {
        diagnostico = { nivel: 'info', texto: 'Sem pesquisa de mercado' };
    } else {
        diagnostico = { nivel: 'ok', texto: 'Preço bem posicionado' };
    }

    return {
        lucro, margem, markup, precoMeta, ref: ref ? arredondar2(ref) : null, posicao,
        sugerido, lucroSugerido, custoMaximo, custoMaximoAgressivo, diagnostico,
    };
}

function formatarReal(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

if (typeof module !== 'undefined') {
    module.exports = {
        lucroUnitario, precoMinimoParaMargem, custoMaximoCompra, precoPsicologico, precoPsicologicoAcima, analisarProduto,
    };
}
