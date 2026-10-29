// public/js/vendas.js
let produtosEmEstoque = [];
let vendasCache = [];

// Onde vende e quanto a maquininha cobra. Vem do servidor (/api/config/vendas);
// se a rota não existir (painel Node antigo), usa estes valores.
const CANAIS_PADRAO = ['OLX', 'Facebook', 'Instagram', 'WhatsApp', 'Loja online', 'Presencial', 'Indicação', 'Outro'];
let configVendas = { canais: CANAIS_PADRAO, taxas: { pix: 0, dinheiro: 0, cartao: 0, debito: 0 } };

const NOMES_PAGAMENTO = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão de crédito', debito: 'Cartão de débito' };
const nomePagamento = (f) => NOMES_PAGAMENTO[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : '—');
const pagaComCartao = (f) => f === 'cartao' || f === 'debito';
const arredondar = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Escapa texto vindo do banco antes de pôr no HTML
const esc = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Lucro de verdade: valor − custo do produto − taxa da maquininha − gastos extras. */
const lucroDaVenda = (v) => (Number(v.valor) || 0) - (Number(v.custo) || 0) - (Number(v.taxa) || 0) - (Number(v.gastos_extras) || 0);

async function carregarConfigVendas() {
    try {
        const c = await fetchJSON('/api/config/vendas');
        configVendas = { canais: c.canais || CANAIS_PADRAO, taxas: Object.assign({}, configVendas.taxas, c.taxas) };
    } catch (e) { /* mantém o padrão */ }
    const sel = document.getElementById('venda-canal');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
        configVendas.canais.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = atual;
}

async function carregarParaDropdown() {
    produtosEmEstoque = await fetchJSON('/api/produtos');
    const select = document.getElementById('venda-produto');
    const atual = select.value;
    // Só o que tem no estoque, em ordem alfabética
    const disponiveis = produtosEmEstoque.filter(p => p.quantidade > 0).sort((a, b) => a.nome.localeCompare(b.nome));
    select.innerHTML = '<option value="">Selecione um produto...</option>' + disponiveis.map(p =>
        `<option value="${p.id}">${esc(p.nome)} (Disponível: ${p.quantidade})</option>`).join('');
    select.value = atual;
}

function abrirModalVenda() {
    const data = document.getElementById('venda-data');
    data.value = dataLocalISO();
    data.max = dataLocalISO();
    carregarParaDropdown().then(atualizarResumoVenda);
    carregarConfigVendas();
    mudarPagamentoVenda();
    abrirModal('modal-venda');
}

// Fiado: pede cliente e a data combinada (padrão: último dia do mês)
function mudarQuandoPaga() {
    const fiado = document.getElementById('venda-quando').value === 'fiado';
    document.getElementById('grupo-fiado').style.display = fiado ? 'block' : 'none';
    document.getElementById('venda-cliente').required = fiado;
    document.getElementById('venda-receber-ate').required = fiado;
    const data = document.getElementById('venda-receber-ate');
    if (fiado && !data.value) {
        const hoje = new Date();
        data.value = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
    }
}

// Cartão: mostra a taxa da maquininha já preenchida com a última usada
function mudarPagamentoVenda() {
    const forma = document.getElementById('venda-pagamento').value;
    const cartao = pagaComCartao(forma);
    document.getElementById('grupo-taxa').style.display = cartao ? 'block' : 'none';
    document.getElementById('venda-taxa-pct').value = cartao ? (configVendas.taxas[forma] || 0) : '';
    atualizarResumoVenda();
}

function atualizarTotalVenda() {
    const produtoId = document.getElementById('venda-produto').value;
    const qtd = document.getElementById('venda-qtd').value;
    if (produtoId && qtd) {
        const prod = produtosEmEstoque.find(p => p.id == produtoId);
        if (prod) document.getElementById('venda-valor').value = (prod.preco * qtd).toFixed(2);
    }
    atualizarResumoVenda();
}

/** Lê o formulário e calcula custo, taxa e lucro (usado no resumo e ao salvar). */
function contaDaVenda() {
    const prod = produtosEmEstoque.find(p => p.id == document.getElementById('venda-produto').value);
    const qtd = parseInt(document.getElementById('venda-qtd').value) || 0;
    const valor = parseFloat(document.getElementById('venda-valor').value) || 0;
    const forma = document.getElementById('venda-pagamento').value;
    const taxaPct = pagaComCartao(forma) ? (parseFloat(document.getElementById('venda-taxa-pct').value) || 0) : 0;
    const taxa = arredondar(valor * taxaPct / 100);
    const gastos = arredondar(document.getElementById('venda-gastos').value);
    const custo = prod ? arredondar(prod.custo * qtd) : 0;
    return { prod, qtd, valor, forma, taxaPct, taxa, gastos, custo, lucro: valor - custo - taxa - gastos };
}

function atualizarResumoVenda() {
    const c = contaDaVenda();
    const box = document.getElementById('venda-resumo');
    if (!c.prod || !c.valor) { box.innerHTML = ''; return; }
    const linha = (rotulo, valor, classe = '') => `<div class="${classe}"><span>${rotulo}</span><strong>${valor}</strong></div>`;
    const margem = c.valor > 0 ? (c.lucro / c.valor) * 100 : 0;
    box.innerHTML =
        linha('Cliente paga', formatarMoeda(c.valor)) +
        linha('Custo do produto', '− ' + formatarMoeda(c.custo)) +
        (c.taxa ? linha(`Taxa da maquininha (${c.taxaPct}%)`, '− ' + formatarMoeda(c.taxa)) : '') +
        (c.gastos ? linha('Gastos extras', '− ' + formatarMoeda(c.gastos)) : '') +
        linha(`Seu lucro (${margem.toFixed(0)}%)`, formatarMoeda(c.lucro), c.lucro >= 0 ? 'lucro-ok' : 'lucro-ruim');
}

async function salvarVenda(event) {
    event.preventDefault();
    const c = contaDaVenda();
    const fiado = document.getElementById('venda-quando').value === 'fiado';

    if (!c.prod) return alert('Por favor, selecione um produto.');
    if (c.qtd > c.prod.quantidade) return alert('Você não tem essa quantidade no estoque!');
    if (c.lucro < 0 && !confirm(`Com esse valor você fica no prejuízo (${formatarMoeda(c.lucro)}). Salvar mesmo assim?`)) return;

    await fetchJSON('/api/vendas', {
        method: 'POST',
        body: JSON.stringify({
            produto_id: c.prod.id,
            produto_nome: c.prod.nome,
            quantidade: c.qtd,
            valor: c.valor,
            custo: c.custo,
            forma_pagamento: c.forma,
            canal: document.getElementById('venda-canal').value,
            data: document.getElementById('venda-data').value,
            taxa: c.taxa,
            gastos_extras: c.gastos,
            recebido: !fiado,
            cliente: fiado ? document.getElementById('venda-cliente').value.trim() : null,
            receber_ate: fiado ? document.getElementById('venda-receber-ate').value : null
        })
    });

    // Taxa diferente da salva: vira a nova taxa padrão daquela forma de pagamento
    if (pagaComCartao(c.forma) && c.taxaPct !== (configVendas.taxas[c.forma] || 0)) {
        configVendas.taxas[c.forma] = c.taxaPct;
        fetchJSON('/api/config/vendas', { method: 'PUT', body: JSON.stringify({ taxas: { [c.forma]: c.taxaPct } }) }).catch(() => {});
    }

    event.target.reset();
    mudarQuandoPaga();
    document.getElementById('venda-resumo').innerHTML = '';
    fecharModal('modal-venda');
    if (document.getElementById('tela-dashboard').classList.contains('active')) atualizarDashboardCompleto();
    if (document.getElementById('tela-vendas').classList.contains('active'))   carregarVendas();
    if (document.getElementById('tela-produtos').classList.contains('active')) carregarProdutos();
}

async function carregarVendas() {
    // Mais recente primeiro pela data da venda (dá pra lançar venda de dias atrás)
    vendasCache = (await fetchJSON('/api/vendas')).sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.id - a.id);
    // Canais que aparecem no filtro: os da lista + os que já existem nas vendas
    const sel = document.getElementById('filtro-vendas-canal');
    const atual = sel.value;
    const canais = [...new Set([...configVendas.canais, ...vendasCache.map(v => v.canal).filter(Boolean)])];
    sel.innerHTML = '<option value="">Todos os canais</option>' +
        canais.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') +
        '<option value="-">Sem canal informado</option>';
    sel.value = atual;
    renderizarVendas();
}

// Início do período escolhido (data local) — null = todo o período
function inicioDoPeriodo(periodo) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (periodo === 'hoje') return hoje;
    if (periodo === '7d')  { hoje.setDate(hoje.getDate() - 6);  return hoje; }
    if (periodo === '30d') { hoje.setDate(hoje.getDate() - 29); return hoje; }
    if (periodo === 'mes') return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return null;
}

function vendasFiltradas() {
    const status = document.getElementById('filtro-vendas').value;
    const inicio = inicioDoPeriodo(document.getElementById('filtro-vendas-periodo').value);
    const canal = document.getElementById('filtro-vendas-canal').value;
    const pagamento = document.getElementById('filtro-vendas-pagamento').value;
    const busca = document.getElementById('busca-vendas').value.trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    return vendasCache.filter(v => {
        if (status === 'a-receber' && v.recebido) return false;
        if (inicio && new Date(v.data) < inicio) return false;
        if (canal === '-' ? v.canal : canal && v.canal !== canal) return false;
        if (pagamento && v.forma_pagamento !== pagamento) return false;
        if (busca && !semAcento(`${v.produto_nome} ${v.cliente} ${v.canal}`).includes(busca)) return false;
        return true;
    });
}

function renderizarVendas() {
    const vendas = vendasFiltradas();
    const tbody = document.getElementById('lista-vendas');
    const resumo = document.getElementById('resumo-vendas');

    const faturamento = vendas.reduce((s, v) => s + (Number(v.valor) || 0), 0);
    const lucro = vendas.reduce((s, v) => s + lucroDaVenda(v), 0);
    const unidades = vendas.reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    resumo.innerHTML = vendas.length ? `
        <div><span>Vendas</span><strong>${vendas.length}</strong></div>
        <div><span>Unidades</span><strong>${unidades}</strong></div>
        <div><span>Faturamento</span><strong style="color: var(--color-blue)">${formatarMoeda(faturamento)}</strong></div>
        <div><span>Lucro</span><strong style="color: var(--color-green)">${formatarMoeda(lucro)}</strong></div>
        <div><span>Margem</span><strong>${faturamento > 0 ? ((lucro / faturamento) * 100).toFixed(1) : '0.0'}%</strong></div>` : '';

    if (vendas.length === 0) {
        const filtrando = vendasCache.length > 0;
        const msg = document.getElementById('filtro-vendas').value === 'a-receber' && !filtrando
            ? 'Nenhuma venda fiado a receber 🎉'
            : filtrando ? 'Nenhuma venda com esses filtros.' : 'Nenhuma venda registrada ainda.';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">${msg}</td></tr>`;
        return;
    }

    const hoje = dataLocalISO();
    tbody.innerHTML = vendas.map(v => {
        const lucroV = lucroDaVenda(v);
        const forma = esc(nomePagamento(v.forma_pagamento));
        const extras = [
            Number(v.taxa) ? `taxa ${formatarMoeda(v.taxa)}` : '',
            Number(v.gastos_extras) ? `extras ${formatarMoeda(v.gastos_extras)}` : ''
        ].filter(Boolean).join(' · ');
        let pagamento, acaoReceber = '';

        if (v.historico) {
            pagamento = `<span class="badge badge-ajuste">Venda antiga</span>`;
        } else if (!v.recebido) {
            const atrasado = v.receber_ate && v.receber_ate < hoje;
            const ate = v.receber_ate ? ` até ${new Date(v.receber_ate + 'T00:00:00').toLocaleDateString('pt-BR')}` : '';
            pagamento = `<span class="badge ${atrasado ? 'badge-vencida' : 'badge-pendente'}">${atrasado ? 'Atrasado' : 'A receber'}${ate}</span>
                <small class="venda-cliente">${esc(v.cliente)} · ${forma}</small>`;
            acaoReceber = `<button class="btn-pagar" onclick="receberVenda(${v.id})">Recebido</button>`;
        } else if (v.receber_ate) {
            const em = new Date(v.data_recebimento).toLocaleDateString('pt-BR');
            pagamento = `<span class="badge badge-paga">Fiado recebido ${em}</span>
                <small class="venda-cliente">${esc(v.cliente)} · ${forma}</small>`;
            acaoReceber = `<button class="btn-gray btn-mini" onclick="desfazerRecebimento(${v.id})">Desfazer</button>`;
        } else {
            pagamento = forma;
        }

        return `
            <tr>
                <td>${new Date(v.data).toLocaleDateString('pt-BR')}</td>
                <td><strong>${esc(v.produto_nome)}</strong></td>
                <td>${v.quantidade} un</td>
                <td style="color: var(--color-blue)">${formatarMoeda(v.valor)}</td>
                <td>${v.canal ? `<span class="badge badge-canal">${esc(v.canal)}</span>` : '<span class="texto-suave">—</span>'}</td>
                <td>${pagamento}</td>
                <td style="color: ${lucroV >= 0 ? 'var(--color-green)' : 'var(--color-red)'}">${formatarMoeda(lucroV)}${extras ? `<small class="venda-cliente">${extras}</small>` : ''}</td>
                <td class="acoes-venda">${acaoReceber}${v.historico ? '' : `<button class="btn-gray btn-mini" onclick="abrirRecibo(${v.id})" title="Recibo para o cliente">🧾 Recibo</button>`}<button class="btn-excluir" onclick="excluirRegistro('vendas', ${v.id}, carregarVendas)">Excluir</button></td>
            </tr>`;
    }).join('');
}

async function receberVenda(id) {
    if (!confirm('Confirmar que o cliente pagou esta venda?')) return;
    await fetchJSON(`/api/vendas/${id}/receber`, { method: 'PATCH' });
    carregarVendas();
    carregarMetaCaixa();
}

async function desfazerRecebimento(id) {
    if (!confirm('Desfazer o recebimento? A venda volta a ficar a receber.')) return;
    await fetchJSON(`/api/vendas/${id}/desfazer-recebimento`, { method: 'PATCH' });
    carregarVendas();
    carregarMetaCaixa();
}

// ---------- Recibo para mandar ao cliente (sem custo nem lucro) ----------
let lojaContato = null;

async function abrirRecibo(id) {
    const v = vendasCache.find(x => x.id === id);
    if (!v) return;
    if (!lojaContato) {
        try { lojaContato = await fetchJSON('/api/loja/config'); } catch (e) { lojaContato = {}; }
    }
    const unit = v.quantidade > 0 ? v.valor / v.quantidade : v.valor;
    const situacao = v.recebido
        ? 'Pago ✅'
        : `A receber${v.receber_ate ? ' até ' + new Date(v.receber_ate + 'T00:00:00').toLocaleDateString('pt-BR') : ''}`;
    const insta = lojaContato.instagram ? String(lojaContato.instagram).replace(/^@?/, '@') : '';
    const linhas = [
        '🧾 *Recibo de compra — JV Imports*',
        '',
        `Data: ${new Date(v.data).toLocaleDateString('pt-BR')}`,
        `Produto: ${v.produto_nome}`,
        `Quantidade: ${v.quantidade}` + (v.quantidade > 1 ? ` × ${formatarMoeda(unit)}` : ''),
        `Total: ${formatarMoeda(v.valor)}`,
        `Pagamento: ${nomePagamento(v.forma_pagamento)}`,
        `Situação: ${situacao}`,
        v.cliente ? `Cliente: ${v.cliente}` : null,
        '',
        'Obrigado pela compra! 🙌',
        insta ? `Instagram: ${insta}` : null,
        (lojaContato.site || window.siteDaLoja) ? `Loja: ${lojaContato.site || window.siteDaLoja}` : null
    ].filter(l => l !== null);
    const texto = linhas.join('\n').trim();
    document.getElementById('recibo-texto').textContent = texto;
    document.getElementById('recibo-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(texto);
    document.getElementById('recibo-copiar').textContent = 'Copiar';
    abrirModal('modal-recibo');
}

async function copiarRecibo() {
    const texto = document.getElementById('recibo-texto').textContent;
    const botao = document.getElementById('recibo-copiar');
    try {
        await navigator.clipboard.writeText(texto);
    } catch (e) {
        // Dentro do Apps Script a área de transferência pode ser bloqueada: seleciona o texto
        const faixa = document.createRange();
        faixa.selectNodeContents(document.getElementById('recibo-texto'));
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(faixa);
        try { document.execCommand('copy'); } catch (e2) { botao.textContent = 'Selecionado — Ctrl+C'; return; }
    }
    botao.textContent = 'Copiado ✓';
}
