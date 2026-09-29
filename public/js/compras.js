// public/js/compras.js

// Estado local da compra sendo criada.
// ehNovo é uma flag explícita pra diferenciar "produto novo" de "nenhum selecionado".
// Antes eu tentava inferir isso dos outros campos e caía num ovo-e-galinha.
let itensCompra = [];

async function abrirModalCompra() {
    await carregarParaDropdown();
    itensCompra = [];
    document.getElementById('compra-desc').value = '';
    document.getElementById('compra-pagamento').value = 'dinheiro';
    document.getElementById('compra-parcelas').value = 1;
    document.getElementById('compra-tipo').value = 'atual';
    document.getElementById('compra-data').value = '';
    mudarTipoCompra();
    toggleParcelas();
    adicionarItemCompra();
    abrirModal('modal-compra');
}

function toggleParcelas() {
    const pagamento = document.getElementById('compra-pagamento').value;
    const historico = document.getElementById('compra-tipo').value === 'historico';
    document.getElementById('grupo-parcelas').style.display = pagamento === 'cartao' && !historico ? 'block' : 'none';
}

// Compra antiga: pede a data real do pedido; não gera conta a pagar
function mudarTipoCompra() {
    const historico = document.getElementById('compra-tipo').value === 'historico';
    document.getElementById('grupo-compra-data').style.display = historico ? 'block' : 'none';
    document.getElementById('compra-tipo-info').style.display = historico ? 'block' : 'none';
    const data = document.getElementById('compra-data');
    data.required = historico;
    data.max = dataLocalISO();
    toggleParcelas();
}

function adicionarItemCompra() {
    itensCompra.push({ produto_id: '', produto_nome: '', quantidade: 1, custo_unitario: 0, ehNovo: false });
    renderizarItensCompra();
}

function removerItemCompra(index) {
    itensCompra.splice(index, 1);
    if (itensCompra.length === 0) adicionarItemCompra();
    renderizarItensCompra();
}

function atualizarItemCompra(index, campo, valor) {
    if (campo === 'produto_id') {
        if (valor === 'novo') {
            itensCompra[index].ehNovo = true;
            itensCompra[index].produto_id = '';
            itensCompra[index].produto_nome = '';
        } else if (valor === '') {
            itensCompra[index].ehNovo = false;
            itensCompra[index].produto_id = '';
            itensCompra[index].produto_nome = '';
        } else {
            itensCompra[index].ehNovo = false;
            const prod = produtosEmEstoque.find(p => p.id == valor);
            itensCompra[index].produto_id = parseInt(valor);
            itensCompra[index].produto_nome = prod ? prod.nome : '';
            if (prod && prod.custo) itensCompra[index].custo_unitario = prod.custo;
        }
        renderizarItensCompra();
    } else if (campo === 'produto_nome') {
        // Só salva no estado; não re-renderiza (evita perder o foco do input).
        itensCompra[index].produto_nome = valor;
    } else if (campo === 'quantidade') {
        itensCompra[index].quantidade = parseInt(valor) || 0;
        atualizarTotalCompra();
    } else if (campo === 'custo_unitario') {
        itensCompra[index].custo_unitario = parseFloat(valor) || 0;
        atualizarTotalCompra();
    }
}

function atualizarTotalCompra() {
    const total = itensCompra.reduce((acc, it) => acc + (it.quantidade * it.custo_unitario), 0);
    document.getElementById('compra-total-valor').innerText = formatarMoeda(total);
}

function renderizarItensCompra() {
    const container = document.getElementById('lista-itens-compra');
    container.innerHTML = '';

    itensCompra.forEach((item, i) => {
        const opcoesProdutos = produtosEmEstoque
            .map(p => `<option value="${p.id}" ${item.produto_id == p.id ? 'selected' : ''}>${p.nome}</option>`)
            .join('');

        const row = document.createElement('div');
        row.className = 'compra-item-row';
        row.innerHTML = `
            <div>
                <select onchange="atualizarItemCompra(${i}, 'produto_id', this.value)">
                    <option value="">Selecione...</option>
                    ${opcoesProdutos}
                    <option value="novo" ${item.ehNovo ? 'selected' : ''}>+ Cadastrar novo</option>
                </select>
                ${item.ehNovo ? `
                    <input type="text" placeholder="Nome do novo produto"
                           value="${item.produto_nome}"
                           oninput="atualizarItemCompra(${i}, 'produto_nome', this.value)"
                           style="margin-top: 5px;">
                ` : ''}
            </div>
            <input type="number" min="1" placeholder="Qtd"
                   value="${item.quantidade || ''}"
                   oninput="atualizarItemCompra(${i}, 'quantidade', this.value)">
            <input type="number" step="0.01" min="0" placeholder="Custo un."
                   value="${item.custo_unitario || ''}"
                   oninput="atualizarItemCompra(${i}, 'custo_unitario', this.value)">
            <button type="button" class="btn-remover-item" onclick="removerItemCompra(${i})" title="Remover item">×</button>
        `;
        container.appendChild(row);
    });

    atualizarTotalCompra();
}

async function salvarCompra(event) {
    event.preventDefault();

    const itensValidos = itensCompra.filter(it =>
        (it.produto_id || it.produto_nome) && it.quantidade > 0 && it.custo_unitario >= 0
    );
    if (itensValidos.length === 0) {
        return alert('Adicione ao menos 1 item válido na compra.');
    }

    const payload = {
        descricao:       document.getElementById('compra-desc').value,
        forma_pagamento: document.getElementById('compra-pagamento').value,
        parcelas:        parseInt(document.getElementById('compra-parcelas').value) || 1,
        historico:       document.getElementById('compra-tipo').value === 'historico',
        data:            document.getElementById('compra-data').value || null,
        itens:           itensValidos.map(it => ({
            produto_id:     it.produto_id || null,
            produto_nome:   it.produto_nome,
            quantidade:     it.quantidade,
            custo_unitario: it.custo_unitario
        }))
    };

    try {
        await fetchJSON('/api/compras', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch (e) {
        return alert('Erro ao salvar compra: ' + e.message);
    }

    fecharModal('modal-compra');
    if (document.getElementById('tela-historico').classList.contains('active')) carregarHistorico();
    carregarCompras();
    carregarDashboard();
    desenharGrafico();
    await carregarParaDropdown();
    if (document.getElementById('tela-produtos').classList.contains('active')) carregarProdutos();
}

async function carregarCompras() {
    const compras = await fetchJSON('/api/compras');
    const tbody = document.getElementById('lista-compras');
    tbody.innerHTML = '';

    if (compras.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhuma compra registrada ainda.</td></tr>`;
        return;
    }

    compras.forEach(c => {
        const parcelasTxt = c.historico ? '' : c.forma_pagamento === 'cartao' ? ` (${c.parcelas}x)` : ' (à vista)';
        const tag = c.historico ? ' <span class="badge badge-ajuste">Histórico</span>' : '';
        tbody.innerHTML += `
            <tr>
                <td>${new Date(c.data).toLocaleDateString('pt-BR')}</td>
                <td><strong>${c.descricao || '—'}</strong>${tag}</td>
                <td style="text-transform: capitalize;">${c.forma_pagamento}${parcelasTxt}</td>
                <td style="color: var(--color-blue);">${formatarMoeda(c.valor_total)}</td>
                <td><button class="btn-excluir" onclick="excluirCompra(${c.id})">Excluir</button></td>
            </tr>`;
    });
}

async function excluirCompra(id) {
    if (!confirm('Excluir esta compra? O estoque será revertido e as parcelas pendentes serão removidas.')) return;

    try {
        await fetchJSON(`/api/compras/${id}`, { method: 'DELETE' });
    } catch (e) {
        return alert('Não foi possível excluir: ' + e.message);
    }

    carregarCompras();
    if (document.getElementById('tela-dashboard').classList.contains('active')) {
        atualizarDashboardCompleto();
    }
    await carregarParaDropdown();
    if (document.getElementById('tela-contas-pagar').classList.contains('active')) carregarContasPagar();
    if (document.getElementById('tela-produtos').classList.contains('active'))     carregarProdutos();
}