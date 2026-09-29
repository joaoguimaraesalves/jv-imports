// public/js/produtos.js
let produtosCadastro = [];
let produtoEditandoId = null;

async function carregarProdutos() {
    const produtos = await fetchJSON('/api/produtos');
    produtosCadastro = produtos;
    const tbody = document.getElementById('lista-produtos');
    tbody.innerHTML = '';

    produtos.forEach(p => {
        const estoqueBaixo = p.quantidade <= 2;
        tbody.innerHTML += `
            <tr>
                <td>#${p.id}</td>
                <td>${p.nome}</td>
                <td>${formatarMoeda(p.custo)}</td>
                <td>${p.preco > 0 ? formatarMoeda(p.preco) : '<span class="badge badge-pendente">Sem preço</span>'}</td>
                <td style="${estoqueBaixo ? 'color: var(--color-red); font-weight: bold;' : ''}">${p.quantidade} un</td>
                <td>
                    <button class="btn-pagar" onclick="editarProduto(${p.id})">Editar</button>
                    <button class="btn-excluir" onclick="excluirRegistro('produtos', ${p.id}, carregarProdutos)">Excluir</button>
                </td>
            </tr>`;
    });
}

// Mesmo modal para cadastrar e editar
function abrirModalProduto(produto = null) {
    produtoEditandoId = produto ? produto.id : null;
    document.getElementById('prod-titulo').innerText = produto ? 'Editar Produto' : 'Cadastrar Produto';
    document.getElementById('prod-qtd-label').innerText = produto ? 'Quantidade em Estoque' : 'Quantidade Inicial no Estoque';
    document.getElementById('prod-salvar').innerText = produto ? 'Salvar Alterações' : 'Salvar Produto';
    document.getElementById('prod-nome').value  = produto ? produto.nome : '';
    document.getElementById('prod-custo').value = produto ? produto.custo : '';
    document.getElementById('prod-preco').value = produto && produto.preco > 0 ? produto.preco : '';
    document.getElementById('prod-qtd').value   = produto ? produto.quantidade : '';
    abrirModal('modal-produto');
    if (produto && !(produto.preco > 0)) document.getElementById('prod-preco').focus();
}

function editarProduto(id) {
    const produto = produtosCadastro.find(p => p.id === id);
    if (produto) abrirModalProduto(produto);
}

async function salvarProduto(event) {
    event.preventDefault();
    const corpo = {
        nome:       document.getElementById('prod-nome').value,
        custo:      parseFloat(document.getElementById('prod-custo').value),
        preco:      parseFloat(document.getElementById('prod-preco').value),
        quantidade: parseInt(document.getElementById('prod-qtd').value)
    };

    if (produtoEditandoId) {
        const antes = produtosCadastro.find(p => p.id === produtoEditandoId);
        if (antes && antes.quantidade !== corpo.quantidade &&
            !confirm(`A quantidade vai mudar de ${antes.quantidade} para ${corpo.quantidade}. ` +
                     'Isso fica registrado em Movimentos como ajuste manual. Continuar?')) return;
    }

    try {
        await fetchJSON(produtoEditandoId ? `/api/produtos/${produtoEditandoId}` : '/api/produtos', {
            method: produtoEditandoId ? 'PUT' : 'POST',
            body: JSON.stringify(corpo)
        });
    } catch (e) {
        return alert('Erro ao salvar produto: ' + e.message);
    }

    event.target.reset();
    produtoEditandoId = null;
    fecharModal('modal-produto');
    carregarProdutos();
    carregarParaDropdown();
}
