// public/js/produtos.js
let produtosCadastro = [];
let produtoEditandoId = null;
// Foto escolhida no modal e ainda não enviada: data URL, "remover" ou null
let fotoPendente = null;

function situacaoNoSite(p) {
    if (p.na_loja === false) return '<span class="badge badge-oculto">Oculto</span>';
    if (!(p.preco > 0)) return '<span class="badge badge-pendente">Sem preço</span>';
    return '<span class="badge badge-site">No site</span>' +
        (p.foto_em ? '' : '<span class="sem-foto-aviso">📷 sem foto</span>');
}

async function carregarProdutos() {
    produtosCadastro = await fetchJSON('/api/produtos');
    renderizarProdutos();
}

// Resumo do estoque: quanto dinheiro está parado e quanto ele vira se vender tudo
function resumoEstoque(produtos) {
    const comEstoque = produtos.filter(p => p.quantidade > 0);
    const custo = comEstoque.reduce((s, p) => s + (Number(p.custo) || 0) * p.quantidade, 0);
    const venda = comEstoque.reduce((s, p) => s + (Number(p.preco) || 0) * p.quantidade, 0);
    const unidades = comEstoque.reduce((s, p) => s + p.quantidade, 0);
    return { custo, venda, unidades, produtos: comEstoque.length, lucro: venda - custo, margem: venda > 0 ? ((venda - custo) / venda) * 100 : 0 };
}

function renderizarProdutos() {
    const r = resumoEstoque(produtosCadastro);
    document.getElementById('resumo-estoque').innerHTML = `
        <div><span>Estoque a preço de custo</span><strong style="color: var(--color-red)">${formatarMoeda(r.custo)}</strong><small class="texto-suave">${r.produtos} produtos · ${r.unidades} unidades</small></div>
        <div><span>Se vender tudo</span><strong style="color: var(--color-blue)">${formatarMoeda(r.venda)}</strong><small class="texto-suave">pelo preço de venda</small></div>
        <div><span>Lucro possível</span><strong style="color: var(--color-green)">${formatarMoeda(r.lucro)}</strong><small class="texto-suave">venda − custo</small></div>
        <div><span>Margem média</span><strong>${r.margem.toFixed(1)}%</strong><small class="texto-suave">lucro sobre a venda</small></div>`;

    const busca = (document.getElementById('busca-produtos').value || '').trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const produtos = !busca ? produtosCadastro : produtosCadastro.filter(p =>
        `${p.nome} ${p.categoria || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(busca));
    const tbody = document.getElementById('lista-produtos');
    tbody.innerHTML = '';
    if (!produtos.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${busca ? 'Nenhum produto com esse nome.' : 'Nenhum produto cadastrado ainda.'}</td></tr>`;
        return;
    }

    produtos.forEach(p => {
        const estoqueBaixo = p.quantidade <= 2;
        tbody.innerHTML += `
            <tr>
                <td>#${p.id}</td>
                <td>${p.nome}${p.categoria ? `<small class="venda-cliente">${p.categoria}</small>` : ''}</td>
                <td>${formatarMoeda(p.custo)}</td>
                <td>${p.preco > 0 ? formatarMoeda(p.preco) : '<span class="badge badge-pendente">Sem preço</span>'}</td>
                <td style="${estoqueBaixo ? 'color: var(--color-red); font-weight: bold;' : ''}">${p.quantidade} un</td>
                <td>${situacaoNoSite(p)}</td>
                <td>
                    <button class="btn-pagar" onclick="editarProduto(${p.id})">Editar</button>
                    <button class="btn-excluir" onclick="excluirRegistro('produtos', ${p.id}, carregarProdutos)">Excluir</button>
                </td>
            </tr>`;
    });
}

function mostrarPreviewFoto(src) {
    const box = document.getElementById('prod-foto-preview');
    box.innerHTML = src ? `<img src="${src}" alt="">` : '<span>Sem foto</span>';
    document.getElementById('prod-foto-remover').hidden = !src;
}

// Mesmo modal para cadastrar e editar
function abrirModalProduto(produto = null) {
    produtoEditandoId = produto ? produto.id : null;
    fotoPendente = null;
    document.getElementById('prod-titulo').innerText = produto ? 'Editar Produto' : 'Cadastrar Produto';
    document.getElementById('prod-qtd-label').innerText = produto ? 'Quantidade em Estoque' : 'Quantidade Inicial no Estoque';
    document.getElementById('prod-salvar').innerText = produto ? 'Salvar Alterações' : 'Salvar Produto';
    document.getElementById('prod-nome').value  = produto ? produto.nome : '';
    document.getElementById('prod-custo').value = produto ? produto.custo : '';
    document.getElementById('prod-preco').value = produto && produto.preco > 0 ? produto.preco : '';
    document.getElementById('prod-qtd').value   = produto ? produto.quantidade : '';

    document.getElementById('prod-na-loja').checked      = produto ? produto.na_loja !== false : true;
    document.getElementById('prod-destaque').checked     = produto ? !!produto.destaque : false;
    document.getElementById('prod-categoria').value      = produto && produto.categoria ? produto.categoria : '';
    document.getElementById('prod-descricao').value      = produto && produto.descricao ? produto.descricao : '';
    document.getElementById('prod-preco-antigo').value   = produto && produto.preco_antigo > 0 ? produto.preco_antigo : '';
    document.getElementById('prod-foto').value = '';
    // foto_url: miniatura do Drive (painel do Apps Script); senão, a rota da versão Node
    mostrarPreviewFoto(!produto ? null : produto.foto_url || (produto.foto_em
        ? `/api/loja/foto/${produto.id}?v=${encodeURIComponent(produto.foto_em)}` : null));

    // Sugestões de categoria com as que já existem
    const categorias = [...new Set(produtosCadastro.map(p => (p.categoria || '').trim()).filter(Boolean))].sort();
    document.getElementById('lista-categorias').innerHTML = categorias.map(c => `<option value="${c.replace(/"/g, '&quot;')}">`).join('');

    abrirModal('modal-produto');
    if (produto && !(produto.preco > 0)) document.getElementById('prod-preco').focus();
}

function editarProduto(id) {
    const produto = produtosCadastro.find(p => p.id === id);
    if (produto) abrirModalProduto(produto);
}

// Reduz a foto no navegador (máx. 1000 px, JPEG) antes de enviar:
// fica leve para o banco e rápida para o cliente abrir no celular.
function reduzirImagem(arquivo, lado = 1000) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onerror = () => reject(new Error('Não foi possível ler a imagem'));
        leitor.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Formato de imagem não suportado. Use JPG ou PNG.'));
            img.onload = () => {
                const escala = Math.min(1, lado / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * escala);
                canvas.height = Math.round(img.height * escala);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff'; // PNG transparente vira fundo branco
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.src = leitor.result;
        };
        leitor.readAsDataURL(arquivo);
    });
}

async function escolherFotoProduto(event) {
    const arquivo = event.target.files && event.target.files[0];
    if (!arquivo) return;
    try {
        fotoPendente = await reduzirImagem(arquivo);
        mostrarPreviewFoto(fotoPendente);
    } catch (e) {
        alert(e.message);
        event.target.value = '';
    }
}

function removerFotoProduto() {
    fotoPendente = 'remover';
    document.getElementById('prod-foto').value = '';
    mostrarPreviewFoto(null);
}

async function salvarProduto(event) {
    event.preventDefault();
    const precoAntigo = parseFloat(document.getElementById('prod-preco-antigo').value);
    const corpo = {
        nome:       document.getElementById('prod-nome').value,
        custo:      parseFloat(document.getElementById('prod-custo').value),
        preco:      parseFloat(document.getElementById('prod-preco').value),
        quantidade: parseInt(document.getElementById('prod-qtd').value),
        na_loja:    document.getElementById('prod-na-loja').checked,
        destaque:   document.getElementById('prod-destaque').checked,
        categoria:  document.getElementById('prod-categoria').value,
        descricao:  document.getElementById('prod-descricao').value,
        preco_antigo: precoAntigo > 0 ? precoAntigo : null
    };

    if (corpo.preco_antigo && corpo.preco_antigo <= corpo.preco) {
        return alert('O preço "de" (promoção) precisa ser maior que o preço de venda. Deixe em branco se não houver promoção.');
    }

    if (produtoEditandoId) {
        const antes = produtosCadastro.find(p => p.id === produtoEditandoId);
        if (antes && antes.quantidade !== corpo.quantidade &&
            !confirm(`A quantidade vai mudar de ${antes.quantidade} para ${corpo.quantidade}. ` +
                     'Isso fica registrado em Movimentos como ajuste manual. Continuar?')) return;
    }

    const botao = document.getElementById('prod-salvar');
    const textoBotao = botao.innerText;
    botao.disabled = true;
    botao.innerText = 'Salvando...';
    try {
        const resp = await fetchJSON(produtoEditandoId ? `/api/produtos/${produtoEditandoId}` : '/api/produtos', {
            method: produtoEditandoId ? 'PUT' : 'POST',
            body: JSON.stringify(corpo)
        });
        const id = produtoEditandoId || resp.id;
        try {
            if (fotoPendente === 'remover') {
                await fetchJSON(`/api/produtos/${id}/foto`, { method: 'DELETE' });
            } else if (fotoPendente) {
                await fetchJSON(`/api/produtos/${id}/foto`, { method: 'PUT', body: JSON.stringify({ foto: fotoPendente }) });
            }
        } catch (e) {
            alert('O produto foi salvo, mas a foto não: ' + e.message);
        }
    } catch (e) {
        return alert('Erro ao salvar produto: ' + e.message);
    } finally {
        botao.disabled = false;
        botao.innerText = textoBotao;
    }

    event.target.reset();
    produtoEditandoId = null;
    fotoPendente = null;
    fecharModal('modal-produto');
    carregarProdutos();
    carregarParaDropdown();
}
