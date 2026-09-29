// public/js/contas-pagar.js

async function carregarContasPagar() {
    const status = document.getElementById('filtro-contas').value;
    const contas = await fetchJSON(`/api/contas-pagar?status=${status}`);
    const tbody = document.getElementById('lista-contas-pagar');
    tbody.innerHTML = '';

    if (contas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhuma conta neste filtro.</td></tr>`;
        return;
    }

    const hoje = new Date().toISOString().slice(0, 10);

    contas.forEach(c => {
        const vencida = c.status === 'pendente' && c.vencimento < hoje;
        let badge, acoes;

        if (c.status === 'paga') {
            badge = `<span class="badge badge-paga">Paga em ${new Date(c.data_pagamento).toLocaleDateString('pt-BR')}</span>`;
            acoes = `<button class="btn-excluir" onclick="desfazerPagamento(${c.id})">Desfazer</button>`;
        } else {
            badge = vencida
                ? `<span class="badge badge-vencida">Vencida</span>`
                : `<span class="badge badge-pendente">Pendente</span>`;
            acoes = `
                <button class="btn-pagar" onclick="pagarConta(${c.id})">Marcar paga</button>
                <button class="btn-excluir" onclick="excluirContaPagar(${c.id})">Excluir</button>
            `;
        }

        tbody.innerHTML += `
            <tr>
                <td>${new Date(c.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td><strong>${c.descricao}</strong></td>
                <td style="color: var(--color-red);">${formatarMoeda(c.valor)}</td>
                <td>${badge}</td>
                <td>${acoes}</td>
            </tr>`;
    });
}

async function salvarConta(event) {
    event.preventDefault();
    const corpo = {
        descricao:  document.getElementById('conta-desc').value,
        valor:      parseFloat(document.getElementById('conta-valor').value),
        vencimento: document.getElementById('conta-vencimento').value,
        paga:       document.getElementById('conta-tipo').value === 'paga'
    };

    try {
        await fetchJSON('/api/contas-pagar', {
            method: 'POST',
            body: JSON.stringify(corpo)
        });
    } catch (e) {
        return alert('Erro: ' + e.message);
    }

    event.target.reset();
    mudarTipoConta();
    fecharModal('modal-conta');
    carregarContasPagar();
if (document.getElementById('tela-dashboard').classList.contains('active')) {
    atualizarDashboardCompleto();
}
}

// "Conta paga": registra direto como paga (desconta do saldo na hora)
function mudarTipoConta() {
    const paga = document.getElementById('conta-tipo').value === 'paga';
    const venc = document.getElementById('conta-vencimento');
    document.getElementById('conta-vencimento-label').innerText = paga ? 'Data' : 'Vencimento';
    if (paga && !venc.value) venc.value = dataLocalISO();
}

async function pagarConta(id) {
    if (!confirm('Marcar esta conta como paga?')) return;
    await fetchJSON(`/api/contas-pagar/${id}/pagar`, { method: 'PATCH' });
    carregarContasPagar();
if (document.getElementById('tela-dashboard').classList.contains('active')) {
    atualizarDashboardCompleto();
}
}

async function desfazerPagamento(id) {
    if (!confirm('Desfazer este pagamento? A conta voltará a ficar pendente.')) return;
    await fetchJSON(`/api/contas-pagar/${id}/desfazer-pagamento`, { method: 'PATCH' });
    carregarContasPagar();
if (document.getElementById('tela-dashboard').classList.contains('active')) {
    atualizarDashboardCompleto();
}
}

async function excluirContaPagar(id) {
    if (!confirm('Excluir esta conta a pagar?')) return;
    await fetchJSON(`/api/contas-pagar/${id}`, { method: 'DELETE' });
    carregarContasPagar();
if (document.getElementById('tela-dashboard').classList.contains('active')) {
    atualizarDashboardCompleto();
}
}