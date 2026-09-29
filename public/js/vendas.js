// public/js/vendas.js
let produtosEmEstoque = [];

async function carregarParaDropdown() {
    produtosEmEstoque = await fetchJSON('/api/produtos');
    const select = document.getElementById('venda-produto');
    select.innerHTML = '<option value="">Selecione um produto...</option>';
    produtosEmEstoque.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.nome} (Disponível: ${p.quantidade})</option>`;
    });
}

function abrirModalVenda() {
    carregarParaDropdown();
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

function atualizarTotalVenda() {
    const produtoId = document.getElementById('venda-produto').value;
    const qtd = document.getElementById('venda-qtd').value;
    if (produtoId && qtd) {
        const prod = produtosEmEstoque.find(p => p.id == produtoId);
        if (prod) document.getElementById('venda-valor').value = (prod.preco * qtd).toFixed(2);
    }
}

async function salvarVenda(event) {
    event.preventDefault();
    const produtoId = document.getElementById('venda-produto').value;
    const qtd = parseInt(document.getElementById('venda-qtd').value);
    const valorRecebido = parseFloat(document.getElementById('venda-valor').value);
    const pagamento = document.getElementById('venda-pagamento').value;
    const fiado = document.getElementById('venda-quando').value === 'fiado';

    const prod = produtosEmEstoque.find(p => p.id == produtoId);
    if (!prod) return alert('Por favor, selecione um produto.');
    if (qtd > prod.quantidade) return alert('Você não tem essa quantidade no estoque!');

    const custoTotal = prod.custo * qtd;

    await fetchJSON('/api/vendas', {
        method: 'POST',
        body: JSON.stringify({
            produto_id: prod.id,
            produto_nome: prod.nome,
            quantidade: qtd,
            valor: valorRecebido,
            custo: custoTotal,
            forma_pagamento: pagamento,
            recebido: !fiado,
            cliente: fiado ? document.getElementById('venda-cliente').value.trim() : null,
            receber_ate: fiado ? document.getElementById('venda-receber-ate').value : null
        })
    });

    event.target.reset();
    mudarQuandoPaga();
    fecharModal('modal-venda');
        if (document.getElementById('tela-dashboard').classList.contains('active')) {
            atualizarDashboardCompleto();
        }
    if (document.getElementById('tela-vendas').classList.contains('active'))   carregarVendas();
    if (document.getElementById('tela-produtos').classList.contains('active')) carregarProdutos();
}

async function carregarVendas() {
    const filtro = document.getElementById('filtro-vendas').value;
    let vendas = await fetchJSON('/api/vendas');
    if (filtro === 'a-receber') vendas = vendas.filter(v => !v.recebido);
    const tbody = document.getElementById('lista-vendas');
    tbody.innerHTML = '';

    if (vendas.length === 0) {
        const msg = filtro === 'a-receber' ? 'Nenhuma venda fiado a receber 🎉' : 'Nenhuma venda registrada ainda.';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${msg}</td></tr>`;
        return;
    }

    const hoje = dataLocalISO();
    vendas.forEach(v => {
        const lucro = v.valor - v.custo;
        const forma = `<span style="text-transform: capitalize;">${v.forma_pagamento || '—'}</span>`;
        let pagamento, acaoReceber = '';

        if (v.historico) {
            pagamento = `<span class="badge badge-ajuste">Venda antiga</span>`;
        } else if (!v.recebido) {
            const atrasado = v.receber_ate && v.receber_ate < hoje;
            const ate = v.receber_ate ? ` até ${new Date(v.receber_ate + 'T00:00:00').toLocaleDateString('pt-BR')}` : '';
            pagamento = `<span class="badge ${atrasado ? 'badge-vencida' : 'badge-pendente'}">${atrasado ? 'Atrasado' : 'A receber'}${ate}</span>
                <small class="venda-cliente">${v.cliente || ''} · ${forma}</small>`;
            acaoReceber = `<button class="btn-pagar" onclick="receberVenda(${v.id})">Recebido</button>`;
        } else if (v.receber_ate) {
            const em = new Date(v.data_recebimento).toLocaleDateString('pt-BR');
            pagamento = `<span class="badge badge-paga">Fiado recebido ${em}</span>
                <small class="venda-cliente">${v.cliente || ''} · ${forma}</small>`;
            acaoReceber = `<button class="btn-gray btn-mini" onclick="desfazerRecebimento(${v.id})">Desfazer</button>`;
        } else {
            pagamento = forma;
        }

        tbody.innerHTML += `
            <tr>
                <td>${new Date(v.data).toLocaleDateString('pt-BR')}</td>
                <td><strong>${v.produto_nome}</strong></td>
                <td>${v.quantidade} un</td>
                <td style="color: var(--color-blue)">${formatarMoeda(v.valor)}</td>
                <td>${pagamento}</td>
                <td style="color: var(--color-green)">${formatarMoeda(lucro)}</td>
                <td>${acaoReceber} <button class="btn-excluir" onclick="excluirRegistro('vendas', ${v.id}, carregarVendas)">Excluir</button></td>
            </tr>`;
    });
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