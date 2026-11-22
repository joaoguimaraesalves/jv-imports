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

// Vendas dos últimos 30 dias por produto (para "vendidos" e "dá para quantos dias")
let vendidos30Estoque = {};
let filtroEstoque = 'todos';

async function carregarProdutos() {
    const [produtos, vendas] = await Promise.all([
        fetchJSON('/api/produtos'),
        fetchJSON('/api/vendas').catch(() => [])
    ]);
    produtosCadastro = produtos;
    const limite = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    vendidos30Estoque = {};
    (vendas || []).forEach(v => {
        if (v.historico || !v.produto_id || String(v.data || '').slice(0, 10) < limite) return;
        vendidos30Estoque[v.produto_id] = (vendidos30Estoque[v.produto_id] || 0) + (Number(v.quantidade) || 0);
    });
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

function escEstoque(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Situação do estoque de um produto: esgotado, acabando (≤ 2) ou ok
function situacaoEstoque(p) {
    if (p.quantidade <= 0) return { classe: 'esgotado', texto: 'Esgotado' };
    if (p.quantidade <= 2) return { classe: 'baixo', texto: p.quantidade === 1 ? 'Última unidade' : `Últimas ${p.quantidade}` };
    return { classe: 'ok', texto: 'Em estoque' };
}

function fotoProdutoEstoque(p) {
    return p.foto_url || (p.foto_em ? `/api/loja/foto/${p.id}?v=${encodeURIComponent(p.foto_em)}` : null);
}

const FILTROS_ESTOQUE = [
    ['todos', 'Todos', () => true],
    ['estoque', 'Em estoque', p => p.quantidade > 2],
    ['baixo', 'Acabando', p => p.quantidade > 0 && p.quantidade <= 2],
    ['esgotado', 'Esgotados', p => p.quantidade <= 0],
    ['oculto', 'Fora do site', p => p.na_loja === false],
    ['semfoto', 'Sem foto', p => !fotoProdutoEstoque(p)]
];

function filtrarEstoque(id) {
    filtroEstoque = id;
    renderizarProdutos();
}

function mudarModoEstoque(modo) {
    try { localStorage.setItem('jv-estoque-modo', modo); } catch (e) { /* sem armazenamento: só não lembra */ }
    renderizarProdutos();
}

function modoEstoque() {
    try { return localStorage.getItem('jv-estoque-modo') === 'lista' ? 'lista' : 'grade'; } catch (e) { return 'grade'; }
}

function renderizarProdutos() {
    const r = resumoEstoque(produtosCadastro);
    document.getElementById('resumo-estoque').innerHTML = `
        <div><span>Estoque a preço de custo</span><strong style="color: var(--color-red)">${formatarMoeda(r.custo)}</strong><small class="texto-suave">${r.produtos} produtos · ${r.unidades} unidades</small></div>
        <div><span>Se vender tudo</span><strong style="color: var(--color-blue)">${formatarMoeda(r.venda)}</strong><small class="texto-suave">pelo preço de venda</small></div>
        <div><span>Lucro possível</span><strong style="color: var(--color-green)">${formatarMoeda(r.lucro)}</strong><small class="texto-suave">venda − custo</small></div>
        <div><span>Margem média</span><strong>${r.margem.toFixed(1)}%</strong><small class="texto-suave">lucro sobre a venda</small></div>`;

    // Chips de filtro com a contagem de cada um
    document.getElementById('est-filtros').innerHTML = FILTROS_ESTOQUE.map(([id, nome, teste]) => {
        const n = produtosCadastro.filter(teste).length;
        return `<button type="button" class="est-chip est-chip-${id}${filtroEstoque === id ? ' ativo' : ''}" aria-pressed="${filtroEstoque === id}" onclick="filtrarEstoque('${id}')">${nome} <span>${n}</span></button>`;
    }).join('');

    // Categorias existentes (mantém a escolhida)
    const selCat = document.getElementById('est-categoria');
    const catAtual = selCat.value;
    const categorias = [...new Set(produtosCadastro.map(p => (p.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    selCat.innerHTML = '<option value="">Todas as categorias</option>' + categorias.map(c => `<option value="${escEstoque(c)}">${escEstoque(c)}</option>`).join('');
    selCat.value = categorias.includes(catAtual) ? catAtual : '';

    const modo = modoEstoque();
    document.getElementById('est-modo-grade').classList.toggle('ativo', modo === 'grade');
    document.getElementById('est-modo-lista').classList.toggle('ativo', modo === 'lista');

    const normalizar = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const busca = normalizar((document.getElementById('busca-produtos').value || '').trim());
    const testeFiltro = (FILTROS_ESTOQUE.find(f => f[0] === filtroEstoque) || FILTROS_ESTOQUE[0])[2];
    const vendidos = p => vendidos30Estoque[p.id] || 0;
    const ordens = {
        'nome': (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
        'estoque-menor': (a, b) => a.quantidade - b.quantidade,
        'estoque-maior': (a, b) => b.quantidade - a.quantidade,
        'vendidos': (a, b) => vendidos(b) - vendidos(a),
        'parado': (a, b) => (b.custo * Math.max(b.quantidade, 0)) - (a.custo * Math.max(a.quantidade, 0)),
        'preco': (a, b) => (Number(b.preco) || 0) - (Number(a.preco) || 0)
    };
    const produtos = produtosCadastro
        .filter(p => testeFiltro(p))
        .filter(p => !selCat.value || (p.categoria || '').trim() === selCat.value)
        .filter(p => !busca || normalizar(`${p.nome} ${p.categoria || ''}`).includes(busca))
        .sort(ordens[document.getElementById('est-ordem').value] || ordens.nome);

    const grade = document.getElementById('lista-produtos');
    grade.className = 'est-grade' + (modo === 'lista' ? ' lista' : '');
    if (!produtos.length) {
        grade.innerHTML = `<div class="est-vazio">${produtosCadastro.length ? 'Nenhum produto com esse filtro.' : 'Nenhum produto cadastrado ainda.'}</div>`;
        return;
    }

    const maxQtd = Math.max(10, ...produtosCadastro.map(p => p.quantidade + vendidos(p)));
    grade.innerHTML = produtos.map(p => {
        const sit = situacaoEstoque(p);
        const foto = fotoProdutoEstoque(p);
        const preco = Number(p.preco) || 0;
        const custo = Number(p.custo) || 0;
        const margem = preco > 0 ? ((preco - custo) / preco) * 100 : null;
        const v30 = vendidos(p);
        const dias = v30 > 0 && p.quantidade > 0 ? Math.round(p.quantidade / (v30 / 30)) : null;
        const extras = Array.isArray(p.fotos_extras) ? p.fotos_extras.length : 0;
        const largura = Math.max(0, Math.min(100, (p.quantidade / maxQtd) * 100));
        const nome = escEstoque(p.nome);
        return `
        <article class="est-card est-${sit.classe}${p.na_loja === false ? ' est-fora' : ''}" tabindex="0" role="button"
                 aria-label="Editar ${nome}" onclick="editarProduto(${p.id})" onkeydown="if(event.key==='Enter'&&event.target===this)editarProduto(${p.id})">
            <div class="est-foto">
                ${foto ? `<img src="${escEstoque(foto)}" alt="" loading="lazy">` : '<div class="est-sem-foto"><span>📷</span>sem foto</div>'}
                <span class="est-selo est-selo-${sit.classe}">${sit.texto}</span>
                ${p.destaque ? '<span class="est-destaque" title="Destaque no site">★</span>' : ''}
                ${extras ? `<span class="est-mais-fotos">+${extras} foto${extras > 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="est-info">
                <small class="est-cat">${p.categoria ? escEstoque(p.categoria) + ' · ' : ''}#${p.id}</small>
                <h4 class="est-nome" title="${nome}">${nome}</h4>
                <div class="est-preco">
                    ${p.preco_antigo > preco && preco > 0 ? `<s>${formatarMoeda(p.preco_antigo)}</s>` : ''}
                    ${preco > 0 ? `<strong>${formatarMoeda(preco)}</strong>` : '<span class="badge badge-pendente">Sem preço</span>'}
                </div>
                <div class="est-custo">Custo ${formatarMoeda(custo)}${margem !== null ? ` · <b class="${margem >= 30 ? 'txt-verde' : margem >= 15 ? '' : 'txt-vermelho'}">margem ${margem.toFixed(0)}%</b>` : ''}</div>
                <div class="est-qtd">
                    <span class="est-qtd-num">${p.quantidade}<small> un</small></span>
                    <span class="est-qtd-info">${v30 ? `${v30} vendido${v30 > 1 ? 's' : ''} em 30 dias` : 'sem vendas em 30 dias'}${dias !== null ? `<br>dá para ~${dias} dia${dias === 1 ? '' : 's'}` : ''}</span>
                </div>
                <div class="est-nivel" aria-hidden="true"><div style="width:${largura}%"></div></div>
                <div class="est-rodape">
                    <div class="est-site">${situacaoNoSite(p)}</div>
                    <div class="est-acoes">
                        <button type="button" class="btn-pagar" onclick="event.stopPropagation(); editarProduto(${p.id})">Editar</button>
                        <button type="button" class="btn-excluir" title="Excluir" onclick="event.stopPropagation(); excluirRegistro('produtos', ${p.id}, carregarProdutos)">Excluir</button>
                    </div>
                </div>
            </div>
        </article>`;
    }).join('');
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
    mostrarFotosExtras(produto);

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

/* ---------- Galeria: fotos extras (só no painel do Apps Script, onde o produto traz fotos_extras) ---------- */
function mostrarFotosExtras(produto) {
    const bloco = document.getElementById('prod-fotos-extras');
    if (!bloco) return;
    const suportado = produto && Array.isArray(produto.fotos_extras);
    bloco.hidden = !suportado;
    if (!suportado) return;
    const extras = produto.fotos_extras;
    document.getElementById('prod-fotos-extras-grade').innerHTML = extras.map(f => `
        <div class="foto-extra"><img src="${f.url}" alt="" loading="lazy">
            <button type="button" class="foto-capa" title="Usar como capa (1ª foto do site)" onclick="usarFotoComoCapa(${Number(produto.id)}, '${String(f.id).replace(/[^\w-]/g, '')}')">★ Capa</button>
            <button type="button" title="Remover esta foto" onclick="removerFotoExtra(${Number(produto.id)}, '${String(f.id).replace(/[^\w-]/g, '')}')">×</button></div>`).join('')
        || '<span class="sem-extras">Nenhuma foto extra ainda.</span>';
    document.getElementById('prod-fotos-extras-input').value = '';
    document.getElementById('prod-fotos-extras-aviso').textContent = extras.length >= 8 ? 'Limite de 8 fotos extras atingido.' : '';
}

async function recarregarProdutoNoModal(id) {
    await carregarProdutos(); // atualiza a tabela e a lista produtosCadastro
    const p = produtosCadastro.find(x => x.id === id);
    if (!p) return;
    mostrarFotosExtras(p);
    // a capa pode ter mudado ("★ Capa"): atualiza a miniatura principal da janela
    mostrarPreviewFoto(p.foto_url || (p.foto_em ? `/api/loja/foto/${p.id}?v=${encodeURIComponent(p.foto_em)}` : null));
}

async function adicionarFotosExtras(event) {
    const id = produtoEditandoId;
    const arquivos = [...event.target.files];
    if (!id || !arquivos.length) return;
    const aviso = document.getElementById('prod-fotos-extras-aviso');
    try {
        for (let i = 0; i < arquivos.length; i++) {
            aviso.textContent = `Enviando foto ${i + 1} de ${arquivos.length}...`;
            const foto = await reduzirImagem(arquivos[i]);
            await fetchJSON(`/api/produtos/${id}/fotos`, { method: 'POST', body: JSON.stringify({ foto }) });
        }
        aviso.textContent = '';
    } catch (e) {
        alert('Não foi possível enviar a foto: ' + e.message);
    }
    recarregarProdutoNoModal(id);
}

// Troca a capa pela foto escolhida (a capa antiga vira a 1ª foto extra; nada é apagado).
async function usarFotoComoCapa(id, fotoId) {
    const aviso = document.getElementById('prod-fotos-extras-aviso');
    try {
        aviso.textContent = 'Trocando a capa...';
        await fetchJSON(`/api/produtos/${id}/fotos/${fotoId}/capa`, { method: 'POST' });
        aviso.textContent = '✅ Capa trocada. O site atualiza em 1 ou 2 minutos.';
    } catch (e) {
        aviso.textContent = '⚠️ Não foi possível trocar a capa: ' + e.message;
    }
    if (typeof publicarLojaEmSegundoPlano === 'function') publicarLojaEmSegundoPlano();
    recarregarProdutoNoModal(id);
}

async function removerFotoExtra(id, fotoId) {
    if (!confirm('Remover esta foto da galeria?')) return;
    try {
        await fetchJSON(`/api/produtos/${id}/fotos/${fotoId}`, { method: 'DELETE' });
    } catch (e) {
        return alert('Não foi possível remover: ' + e.message);
    }
    recarregarProdutoNoModal(id);
}
