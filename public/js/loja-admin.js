// public/js/loja-admin.js — tela "Loja Online" do painel
function formatarWhatsapp(n) {
    const d = String(n || '').replace(/\D/g, '');
    const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
    if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    return d;
}

// Endereço público da loja: SITE_URL (Cloudflare/domínio). No painel Node sem ele, a
// própria loja do Render. No Apps Script sem ele, vazio (a página roda num domínio do Google).
function enderecoLoja(s) {
    if (s.site) return s.site.replace(/\/$/, '') + '/';
    return s.permite_configurar ? '' : location.origin + '/';
}

function mostrarPublicacao(s) {
    const texto = document.getElementById('loja-publicacao-texto');
    const caixa = document.getElementById('loja-publicacao');
    caixa.classList.remove('ok', 'alerta');
    if (!s.configurado) {
        texto.textContent = s.permite_configurar
            ? 'Ainda não ligada: preencha a conexão com a Cloudflare logo abaixo.'
            : 'Ainda não ligada: a loja está sendo servida pelo próprio Render (mais lenta para abrir). Faltam as variáveis CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID e CF_API_TOKEN no Render.';
        caixa.classList.add('alerta');
    } else if (s.erro) {
        texto.textContent = '⚠️ A última publicação falhou: ' + s.erro + '. O painel tenta de novo sozinho; se continuar, toque em Republicar.';
        caixa.classList.add('alerta');
    } else if (s.publicando) {
        texto.textContent = 'Publicando...';
    } else {
        const quando = s.ultima ? new Date(s.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não';
        texto.textContent = '✅ Loja em dia. Última publicação: ' + quando + '. Toda venda, compra ou edição é enviada sozinha em segundos (o site mostra em até 1 minuto).';
        caixa.classList.add('ok');
    }
    document.getElementById('loja-republicar').hidden = !s.configurado;

    // Painel do Apps Script: a conexão com a Cloudflare é preenchida aqui mesmo.
    // O token nunca volta para a tela; em branco = manter o atual.
    const form = document.getElementById('loja-cloudflare');
    form.hidden = !s.permite_configurar;
    if (s.permite_configurar) {
        document.getElementById('cf-conta').value = s.conta || '';
        document.getElementById('cf-namespace').value = s.namespace || '';
        document.getElementById('cf-site').value = s.site || '';
        document.getElementById('cf-token').value = '';
        document.getElementById('cf-token').placeholder = s.tem_token ? '•••••• (salvo; deixe em branco para manter)' : 'Cole o token aqui';
        document.getElementById('cf-token-label').textContent = s.tem_token ? 'Token da API ✓' : 'Token da API';
    }
}

async function salvarConexaoCloudflare(event) {
    event.preventDefault();
    const botao = document.getElementById('cf-salvar');
    botao.disabled = true;
    botao.textContent = 'Conectando...';
    try {
        const s = await fetchJSON('/api/publicacao/config', {
            method: 'PUT',
            body: JSON.stringify({
                conta: document.getElementById('cf-conta').value,
                namespace: document.getElementById('cf-namespace').value,
                token: document.getElementById('cf-token').value,
                site: document.getElementById('cf-site').value
            })
        });
        mostrarPublicacao(s);
        const urlLoja = enderecoLoja(s);
        document.getElementById('loja-url').value = urlLoja;
        document.querySelectorAll('[data-link-loja]').forEach((a) => { if (urlLoja) { a.href = urlLoja; a.hidden = false; } });
    } catch (e) {
        alert('Não foi possível salvar: ' + e.message);
    } finally {
        botao.disabled = false;
        botao.textContent = 'Salvar e publicar';
    }
}

async function republicarLoja() {
    const botao = document.getElementById('loja-republicar');
    botao.disabled = true;
    botao.textContent = 'Publicando...';
    try {
        mostrarPublicacao(await fetchJSON('/api/publicacao/agora', { method: 'POST' }));
    } catch (e) {
        // Falha da publicação: mostra a situação com o erro
        mostrarPublicacao(await fetchJSON('/api/publicacao').catch(() => ({ configurado: true, erro: e.message })));
    } finally {
        botao.disabled = false;
        botao.textContent = '↻ Republicar agora';
    }
}

async function carregarLojaAdmin() {
    const [config, produtos, publicacao] = await Promise.all([
        fetchJSON('/api/loja/config'), fetchJSON('/api/produtos'), fetchJSON('/api/publicacao')
    ]);
    // Endereço público da loja: o da Cloudflare/domínio próprio (SITE_URL) ou este mesmo
    const urlLoja = enderecoLoja(publicacao);
    document.getElementById('loja-url').value = urlLoja;
    document.getElementById('loja-url').placeholder = 'Preencha o endereço da loja na conexão com a Cloudflare';
    document.querySelectorAll('[data-link-loja]').forEach((a) => { if (urlLoja) { a.href = urlLoja; a.hidden = false; } else if (publicacao.permite_configurar) a.hidden = true; });
    mostrarPublicacao(publicacao);
    produtosCadastro = produtos;

    document.getElementById('loja-whatsapp').value = formatarWhatsapp(config.whatsapp);
    document.getElementById('loja-instagram').value = config.instagram ? '@' + config.instagram : '';
    document.getElementById('loja-aviso').value = config.aviso || '';
    document.getElementById('loja-pagamento').value = config.pagamento || '';
    document.getElementById('loja-entrega').value = config.entrega || '';
    document.getElementById('loja-mostrar-esgotados').value = config.mostrar_esgotados || 'sim';
    document.getElementById('loja-salvo').textContent = config.whatsapp ? '' : '⚠️ Sem WhatsApp configurado, o cliente não consegue fazer pedido.';

    // Checklist do que falta para a vitrine vender melhor
    const noSite = produtos.filter(p => p.na_loja !== false && p.preco > 0);
    const semFoto = noSite.filter(p => !p.foto_em).length;
    const semDescricao = noSite.filter(p => !(p.descricao || '').trim()).length;
    const semCategoria = noSite.filter(p => !(p.categoria || '').trim()).length;
    const disponiveis = noSite.filter(p => p.quantidade > 0).length;
    const card = (titulo, valor, ok) => `
        <div class="card card-loja ${ok ? 'ok' : 'alerta'}" onclick="mudarTela('produtos')" title="Abrir Estoque da Loja">
            <div class="card-header"><span>${titulo}</span></div>
            <div class="card-value">${valor}</div>
        </div>`;
    document.getElementById('loja-saude').innerHTML =
        card('No site (com preço)', noSite.length, noSite.length > 0) +
        card('Disponíveis agora', disponiveis, disponiveis > 0) +
        card('Sem foto', semFoto, semFoto === 0) +
        card('Sem descrição', semDescricao, semDescricao === 0) +
        card('Sem categoria', semCategoria, semCategoria === 0);
}

async function salvarConfigLoja(event) {
    event.preventDefault();
    const botao = document.getElementById('loja-salvar');
    botao.disabled = true;
    try {
        await fetchJSON('/api/loja/config', {
            method: 'PUT',
            body: JSON.stringify({
                whatsapp: document.getElementById('loja-whatsapp').value,
                instagram: document.getElementById('loja-instagram').value,
                aviso: document.getElementById('loja-aviso').value,
                pagamento: document.getElementById('loja-pagamento').value,
                entrega: document.getElementById('loja-entrega').value,
                mostrar_esgotados: document.getElementById('loja-mostrar-esgotados').value
            })
        });
        await carregarLojaAdmin();
        document.getElementById('loja-salvo').textContent = '✅ Salvo. O site já está usando.';
    } catch (e) {
        alert('Erro ao salvar: ' + e.message);
    } finally {
        botao.disabled = false;
    }
}

async function copiarLinkLoja() {
    const campo = document.getElementById('loja-url');
    try {
        await navigator.clipboard.writeText(campo.value);
    } catch (e) {
        campo.select();
        document.execCommand('copy');
    }
    document.getElementById('loja-salvo').textContent = '🔗 Link copiado!';
}

async function sairDoPainel() {
    try { await fetch('/api/sessao/sair', { method: 'POST' }); } catch (e) { /* segue */ }
    location.href = '/painel';
}
