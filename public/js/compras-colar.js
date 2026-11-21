// public/js/compras-colar.js — "Colar compra": transforma um texto colado em compra (funções puras,
// testadas em tests/compras-colar.test.js). A tela (compras.js) usa o resultado para preencher o modal.
//
// Aceita, uma informação por linha (maiúsculas, acentos e "R$" não importam):
//   Descrição: 17º Importação - AliExpress
//   Pagamento: cartão            (dinheiro, pix ou cartão)
//   Parcelas: 2
//   1º vencimento: 20/12/2026    (ou 2026-12-20)
//   Total pago: 434              (opcional; corrige centavo de arredondamento)
//   3 | QCY HT05 ANC | 118       (itens: quantidade, nome e custo unitário em qualquer ordem,
//   QCY T13; 2; 113,50            separados por | ; ou tab — ou "3x QCY HT05 118")

function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

// "1.234,56" → 1234.56 · "17,78" → 17.78 · "17.78" → 17.78 · "R$ 118" → 118
function lerNumero(txt) {
    let s = String(txt || '').replace(/r\$|\s/gi, '');
    if (!/^\d[\d.,]*$/.test(s)) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = Number(s);
    return isFinite(n) ? n : null;
}

// "20/12/2026", "20/12" (ano atual ou o próximo) ou "2026-12-20" → "2026-12-20"
function lerData(txt, hoje = new Date()) {
    const s = String(txt || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    const dia = m[1].padStart(2, '0');
    const mes = m[2].padStart(2, '0');
    let ano = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : hoje.getFullYear();
    if (!m[3] && Number(mes) < hoje.getMonth() + 1) ano += 1; // "20/01" em dezembro = janeiro que vem
    return `${ano}-${mes}-${dia}`;
}

// Separa um item em quantidade, nome e custo.
function lerItem(linha) {
    const partes = linha.split(/\s*[|;\t]\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 3) {
        const numeros = partes.map((p) => ({ p, n: lerNumero(p.replace(/x$/i, '')) }));
        const nome = numeros.filter((x) => x.n === null).map((x) => x.p).join(' ');
        const nums = numeros.filter((x) => x.n !== null);
        if (!nome || nums.length < 2) return null;
        // Quantidade = o primeiro número inteiro escrito sem vírgula/ponto; custo = o outro.
        let iQtd = nums.findIndex((x) => /^\d+x?$/i.test(x.p));
        if (iQtd < 0) iQtd = 0;
        const qtd = nums[iQtd].n;
        const custo = nums.filter((_, i) => i !== iQtd)[0].n;
        return { quantidade: qtd, nome, custo_unitario: custo };
    }
    const s = linha.replace(/\s+/g, ' ').trim();
    // "3x QCY HT05 118" / "3 QCY HT05 R$ 118,00"
    let m = s.match(/^(\d+)\s*x?\s+(.+?)\s+(?:r\$\s*)?(\d[\d.,]*)$/i);
    if (m) return { quantidade: Number(m[1]), nome: m[2], custo_unitario: lerNumero(m[3]) };
    // "QCY HT05 3x 118" / "QCY HT05 3 R$ 118"
    m = s.match(/^(.+?)\s+(\d+)\s*x?\s+(?:r\$\s*)?(\d[\d.,]*)$/i);
    if (m) return { quantidade: Number(m[2]), nome: m[1], custo_unitario: lerNumero(m[3]) };
    return null;
}

// Produto do painel mais parecido com o nome colado (ou null se nenhum for parecido o bastante).
function acharProduto(nome, produtos) {
    const alvo = normalizarTexto(nome);
    if (!alvo) return null;
    const palavrasAlvo = alvo.split(' ');
    let melhor = null;
    let melhorNota = 0;
    produtos.forEach((p) => {
        const n = normalizarTexto(p.nome);
        let nota;
        const palavras = n.split(' ');
        // Códigos com número (20w, 30w, ht05, h3, 240w) precisam bater: "Fonte 20W" não é a "Fonte 30W".
        const codigosProduto = palavras.filter((w) => /\d/.test(w));
        const codigoDiferente = codigosProduto.length && palavrasAlvo.some((w) => /\d/.test(w) && !palavras.includes(w));
        if (n === alvo) nota = 100;
        else if (codigoDiferente) nota = 0;
        else {
            const comuns = palavrasAlvo.filter((w) => palavras.includes(w)).length;
            // Proporção de palavras em comum, pesando as do nome colado (o que a pessoa quis dizer).
            nota = (comuns / palavrasAlvo.length) * 70 + (comuns / palavras.length) * 30;
            if (n.includes(alvo) || alvo.includes(n)) nota = Math.max(nota, 80);
        }
        if (nota > melhorNota) { melhorNota = nota; melhor = p; }
    });
    return melhorNota >= 60 ? melhor : null;
}

const CHAVES_COMPRA = {
    descricao: ['descricao', 'desc'],
    pagamento: ['pagamento', 'forma de pagamento', 'forma pagamento'],
    parcelas: ['parcelas', 'n de parcelas', 'no de parcelas'],
    vencimento: ['1 vencimento', '1o vencimento', 'primeiro vencimento', 'vencimento', '1a parcela'],
    total: ['total pago', 'total'],
};

function interpretarCompraColada(texto, produtos, hoje = new Date()) {
    const resultado = { descricao: null, forma_pagamento: null, parcelas: null, primeiro_vencimento: null, total_pago: null, itens: [], ignoradas: [] };
    String(texto || '').split(/\r?\n/).forEach((bruta) => {
        const linha = bruta.replace(/^\s*[-•*]\s*/, '').trim();
        if (!linha) return;
        const kv = linha.match(/^([^:|;\t]{2,30}):\s*(.+)$/);
        if (kv) {
            const chave = normalizarTexto(kv[1]).replace(/^(\d)\s?[oa]?\s/, '$1 ');
            const valor = kv[2].trim();
            const tipo = Object.keys(CHAVES_COMPRA).find((k) => CHAVES_COMPRA[k].includes(chave) || CHAVES_COMPRA[k].includes(normalizarTexto(kv[1])));
            if (tipo === 'descricao') { resultado.descricao = valor; return; }
            if (tipo === 'pagamento') {
                const v = normalizarTexto(valor);
                resultado.forma_pagamento = v.includes('cart') || v.includes('credito') ? 'cartao' : v.includes('pix') ? 'pix' : 'dinheiro';
                const p = v.match(/(\d+)\s*x/);
                if (p) resultado.parcelas = Number(p[1]);
                return;
            }
            if (tipo === 'parcelas') { const n = parseInt(valor, 10); if (n > 0) resultado.parcelas = n; return; }
            if (tipo === 'vencimento') { resultado.primeiro_vencimento = lerData(valor, hoje); return; }
            if (tipo === 'total') { resultado.total_pago = lerNumero(valor); return; }
        }
        const item = lerItem(linha);
        if (!item || !item.quantidade || item.custo_unitario === null) { resultado.ignoradas.push(bruta); return; }
        const produto = acharProduto(item.nome, produtos || []);
        resultado.itens.push({
            produto_id: produto ? produto.id : '',
            produto_nome: produto ? produto.nome : item.nome,
            ehNovo: !produto,
            quantidade: item.quantidade,
            custo_unitario: item.custo_unitario,
        });
    });
    if (resultado.parcelas > 1 && !resultado.forma_pagamento) resultado.forma_pagamento = 'cartao';
    return resultado;
}

if (typeof module !== 'undefined') {
    module.exports = { interpretarCompraColada, acharProduto, lerItem, lerNumero, lerData, normalizarTexto };
}
