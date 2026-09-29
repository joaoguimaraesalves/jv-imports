// public/js/historico-calc.js
// Acerto de estoque das vendas antigas: compara o estoque do sistema com o
// estoque real contado hoje. A diferença é o que foi vendido antes do sistema.
// Função pura — usada na tela Histórico da Loja e nos testes (Jest).

// produtos: [{ id, nome, quantidade, custo, preco }]
// entradas: { [produtoId]: { real, preco } }  (preco vazio = preço de venda do banco)
function calcularAcertoEstoque(produtos, entradas) {
    const linhas = produtos.map(p => {
        const e = entradas[p.id] || {};
        const informado = e.real !== undefined && e.real !== '' && e.real !== null;
        const real = informado ? Math.max(0, parseInt(e.real) || 0) : null;
        const vendidas = informado ? Math.max(0, p.quantidade - real) : 0;
        const precoInformado = e.preco !== undefined && e.preco !== '' && e.preco !== null;
        const preco = precoInformado ? Math.max(0, parseFloat(e.preco) || 0) : (Number(p.preco) || 0);
        const valor = vendidas * preco;
        const custo = vendidas * (Number(p.custo) || 0);
        return {
            produto_id: p.id, nome: p.nome, sistema: p.quantidade, real,
            vendidas, sobra: informado && real > p.quantidade ? real - p.quantidade : 0,
            preco, valor, custo, lucro: valor - custo,
            // Sem preço de venda (nem no banco nem digitado): precisa informar
            semValor: vendidas > 0 && preco === 0
        };
    });

    const comVenda = linhas.filter(l => l.vendidas > 0);
    return {
        linhas,
        itens: comVenda.map(l => ({ produto_id: l.produto_id, quantidade: l.vendidas, preco: l.preco, valor: l.valor })),
        totais: {
            unidades: comVenda.reduce((a, l) => a + l.vendidas, 0),
            valor: comVenda.reduce((a, l) => a + l.valor, 0),
            custo: comVenda.reduce((a, l) => a + l.custo, 0),
            lucro: comVenda.reduce((a, l) => a + l.lucro, 0),
            semValor: comVenda.filter(l => l.semValor).length
        }
    };
}

// Último dia do mês anterior (padrão para "vendas antes de <mês atual>")
function fimDoMesAnterior(hoje = new Date()) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

if (typeof module !== 'undefined') module.exports = { calcularAcertoEstoque, fimDoMesAnterior };
