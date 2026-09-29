// public/js/movimentos.js

async function carregarMovimentos() {
    // Popula o filtro de produtos (só na primeira vez ou quando vazio)
    const select = document.getElementById('filtro-movimentos');
    if (select.options.length <= 1) {
        const produtos = await fetchJSON('/api/produtos');
        produtos.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.nome}</option>`;
        });
    }

    const produtoId = select.value;
    const url = produtoId
        ? `/api/estoque/movimentos?produto_id=${produtoId}`
        : '/api/estoque/movimentos';

    const movs = await fetchJSON(url);
    const tbody = document.getElementById('lista-movimentos');
    tbody.innerHTML = '';

    if (movs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhum movimento registrado.</td></tr>`;
        return;
    }

    movs.forEach(m => {
        const badge = `<span class="badge badge-${m.tipo}">${m.tipo}</span>`;
        // Ajuste manual guarda a diferença com sinal (+ ou −)
        const sinal = m.tipo === 'entrada' ? '+' : m.tipo === 'ajuste' ? (m.quantidade > 0 ? '+' : '') : '-';
        const cor = m.tipo === 'entrada' ? 'var(--color-green)' : m.tipo === 'ajuste' ? 'var(--color-purple)' : 'var(--color-red)';

        tbody.innerHTML += `
            <tr>
                <td>${new Date(m.data).toLocaleString('pt-BR')}</td>
                <td><strong>${m.produto_nome_atual || '(produto excluído)'}</strong></td>
                <td>${badge}</td>
                <td style="color: ${cor}; font-weight: bold;">${sinal}${m.quantidade}</td>
                <td>${formatarMoeda(m.custo_unitario)}</td>
                <td>${m.observacao || m.origem_tipo}</td>
            </tr>`;
    });
}