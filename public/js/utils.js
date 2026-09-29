// public/js/utils.js
const formatarMoeda = (valor) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

// Wrapper em torno do fetch para centralizar o tratamento de JSON e erros
async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!res.ok) {
        // Mostra a mensagem do servidor (ex.: "só há 3 no estoque") quando houver
        let msg = `HTTP ${res.status}`;
        try { const corpo = await res.json(); if (corpo.error) msg = corpo.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

function abrirModal(id)  { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }

// Exclusão genérica compartilhada por produtos, vendas e saídas
async function excluirRegistro(tabela, id, callbackAtualizar) {
    if (!confirm('Tem certeza que deseja excluir? Se for uma venda, o produto voltará para o estoque.')) return;
    await fetchJSON(`/api/${tabela}/${id}`, { method: 'DELETE' });
    callbackAtualizar();
    carregarDashboard();
    desenharGrafico();
    if (typeof carregarParaDropdown === 'function') carregarParaDropdown();
}