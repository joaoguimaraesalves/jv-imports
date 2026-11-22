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
    // Nuvemshop só existe no painel do Apps Script
    if (publicacao.permite_configurar) carregarNuvemshop();
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

/* ============================== Nuvemshop ============================== */

const quandoCurto = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

async function carregarNuvemshop() {
    let s;
    try {
        s = await fetchJSON('/api/nuvemshop');
        mostrarNuvemshop(s);
    } catch (e) {
        document.getElementById('loja-nuvemshop').hidden = true; // painel sem a integração
        return;
    }
    const form = document.getElementById('ns-taxas-form');
    form.hidden = !s.conectado;
    if (s.conectado) fetchJSON('/api/nuvemshop/taxas').then(r => mostrarTaxasNuvemshop(r.taxas)).catch(() => { form.hidden = true; });
}

// Taxas do Nuvem Pago: campos da tela ↔ chaves salvas no servidor
const CAMPOS_TAXAS_NS = { 'ns-tx-cartao-pct': 'cartao_pct', 'ns-tx-cartao-fixo': 'cartao_fixo', 'ns-tx-pix-pct': 'pix_pct', 'ns-tx-boleto-fixo': 'boleto_fixo' };

function mostrarTaxasNuvemshop(taxas) {
    Object.entries(CAMPOS_TAXAS_NS).forEach(([campo, chave]) => { document.getElementById(campo).value = taxas[chave]; });
    const cartao = 100 * taxas.cartao_pct / 100 + taxas.cartao_fixo;
    const pix = 100 * taxas.pix_pct / 100 + taxas.pix_fixo;
    document.getElementById('ns-taxas-exemplo').textContent =
        `Numa venda de R$ 100: cartão ${formatarMoeda(cartao)} · Pix ${formatarMoeda(pix)} · boleto ${formatarMoeda(taxas.boleto_fixo)}.`;
}

async function salvarTaxasNuvemshop(event) {
    event.preventDefault();
    const botao = document.getElementById('ns-taxas-salvar');
    const taxas = {};
    Object.entries(CAMPOS_TAXAS_NS).forEach(([campo, chave]) => { taxas[chave] = parseFloat(document.getElementById(campo).value) || 0; });
    taxas.debito_pct = taxas.cartao_pct; // débito segue o cartão
    taxas.debito_fixo = taxas.cartao_fixo;
    botao.disabled = true;
    try {
        const r = await fetchJSON('/api/nuvemshop/taxas', { method: 'PUT', body: JSON.stringify({ taxas }) });
        mostrarTaxasNuvemshop(r.taxas);
        document.getElementById('ns-taxas-exemplo').textContent = '✅ Salvo. Vale para os próximos pedidos. ' + document.getElementById('ns-taxas-exemplo').textContent;
    } catch (e) {
        document.getElementById('ns-taxas-exemplo').textContent = '⚠️ Não foi possível salvar: ' + e.message;
    } finally {
        botao.disabled = false;
    }
}

function mostrarNuvemshop(s) {
    const caixa = document.getElementById('loja-nuvemshop');
    caixa.hidden = false;
    const texto = document.getElementById('ns-texto');
    if (!s.conectado) {
        texto.textContent = s.app_id
            ? 'App salvo. Agora toque em "Autorizar na Nuvemshop", entre na loja e aceite. Você volta para uma página do painel confirmando a conexão.'
            : 'Não conectada: as vendas da Nuvemshop não entram aqui e o estoque de lá não acompanha o daqui.';
    } else if (s.erro) {
        texto.textContent = '⚠️ ' + (s.loja || 'Nuvemshop') + ': a última sincronização falhou: ' + s.erro + '. O painel tenta de novo a cada 5 minutos.';
    } else if (s.antigos.length) {
        texto.textContent = '⏸️ Conectada a ' + s.loja + '. O envio de estoque está parado até você decidir os pedidos abaixo.';
    } else {
        texto.textContent = '✅ Conectada a ' + s.loja + '. ' + s.ligados + ' produto(s) ligado(s). Última sincronização: ' +
            (quandoCurto(s.ultima) || 'ainda não') + '. Roda a cada 5 minutos e depois de cada venda, compra ou edição aqui.';
    }
    document.getElementById('ns-sincronizar').hidden = !s.conectado;
    document.getElementById('ns-desconectar').hidden = !s.conectado;
    document.getElementById('ns-fotos').hidden = !s.conectado;
    const capas = document.getElementById('ns-capas');
    if (capas) capas.hidden = !s.conectado;
    document.getElementById('ns-form').hidden = false;
    document.getElementById('ns-redirecionamento').value = s.redirecionamento || '';
    document.getElementById('ns-app').value = s.app_id || '';
    document.getElementById('ns-segredo').value = '';
    document.getElementById('ns-segredo').placeholder = s.tem_segredo ? '•••••• (salvo; deixe em branco para manter)' : 'Cole o Client Secret';
    document.getElementById('ns-segredo-label').textContent = s.tem_segredo ? 'Client Secret ✓' : 'Client Secret';
    const autorizar = document.getElementById('ns-autorizar');
    autorizar.hidden = !s.link_autorizar || s.conectado;
    if (s.link_autorizar) autorizar.href = s.link_autorizar;

    // Pedidos pagos antes da conexão
    document.getElementById('ns-antigos').innerHTML = s.antigos.length ? `
        <div class="caixa-saldo-info" style="margin-top:12px">
            <strong>${s.antigos.length} pedido(s) pago(s) na Nuvemshop antes da conexão.</strong> Se você ainda não lançou no painel, importe; se já lançou à mão, ignore (para não contar duas vezes).
            <ul style="margin:8px 0 8px 18px">${s.antigos.map(a => `<li>#${esc(a.numero)} · ${esc(quandoCurto(a.data))} · ${esc(a.cliente)} · ${esc(a.itens)} · ${formatarMoeda(a.total)}</li>`).join('')}</ul>
            <button class="btn-green" onclick="decidirAntigosNuvemshop('importar')">Importar no painel</button>
            <button class="btn-gray" onclick="decidirAntigosNuvemshop('ignorar')">Já lancei, ignorar</button>
        </div>` : '';

    // Produtos sem ligação
    const opcoes = '<option value="">Escolha o produto da Nuvemshop…</option>' +
        s.sem_ligacao_ns.map(v => `<option value="${esc(v.variante)}">${esc(v.nome)}</option>`).join('');
    const avisos = (s.avisos || []).map(a => `<li>${esc(a)}</li>`).join('');
    document.getElementById('ns-ligacoes').innerHTML = !s.conectado ? '' : `
        ${avisos ? `<ul class="caixa-saldo-info" style="margin:12px 0 0 18px">${avisos}</ul>` : ''}
        ${s.sem_ligacao_painel.length ? `<div style="margin-top:12px">
            <strong>Produtos do painel sem ligação com a Nuvemshop</strong>
            <p class="caixa-saldo-info">O estoque deles não vai para lá. Escolha o produto correspondente (ou deixe sem, se não vende na Nuvemshop).</p>
            ${s.sem_ligacao_painel.map(p => `<div class="form-row" style="align-items:center">
                <div class="form-group" style="margin:4px 0">${esc(p.nome)}</div>
                <div class="form-group" style="margin:4px 0"><select onchange="ligarProdutoNuvemshop(${Number(p.id)}, this.value)" ${s.sem_ligacao_ns.length ? '' : 'disabled'}>${opcoes}</select></div>
            </div>`).join('')}
        </div>` : ''}`;

    document.getElementById('ns-ultimos').innerHTML = s.conectado && s.ultimos_importados.length ? `
        <div style="margin-top:12px"><strong>Últimos pedidos importados</strong>
        <ul class="caixa-saldo-info" style="margin:6px 0 0 18px">${s.ultimos_importados.map(i => `<li>#${esc(i.numero)} · ${esc(quandoCurto(i.data))} · ${esc(i.cliente)} · ${formatarMoeda(i.total)}${i.taxa ? ` (taxa ${formatarMoeda(i.taxa)})` : ''}</li>`).join('')}</ul></div>` : '';
}

async function salvarConexaoNuvemshop(event) {
    event.preventDefault();
    const botao = document.getElementById('ns-salvar');
    botao.disabled = true;
    try {
        mostrarNuvemshop(await fetchJSON('/api/nuvemshop/config', {
            method: 'PUT',
            body: JSON.stringify({ app_id: document.getElementById('ns-app').value, client_secret: document.getElementById('ns-segredo').value })
        }));
    } catch (e) {
        alert('Não foi possível salvar: ' + e.message);
    } finally {
        botao.disabled = false;
    }
}

async function sincronizarNuvemshopTela() {
    const botao = document.getElementById('ns-sincronizar');
    botao.disabled = true;
    botao.textContent = 'Sincronizando...';
    try {
        const s = await fetchJSON('/api/nuvemshop/sincronizar', { method: 'POST' });
        mostrarNuvemshop(s);
        if (s.resultado && s.resultado.importados) carregarDashboard();
    } catch (e) {
        alert('Não foi possível sincronizar: ' + e.message);
    } finally {
        botao.disabled = false;
        botao.textContent = '↻ Sincronizar agora';
    }
}

async function ligarProdutoNuvemshop(produtoId, variante) {
    if (!variante) return;
    try {
        mostrarNuvemshop(await fetchJSON('/api/nuvemshop/ligar', { method: 'PUT', body: JSON.stringify({ produto_id: produtoId, ns_variante_id: variante }) }));
    } catch (e) {
        alert('Não foi possível ligar: ' + e.message);
    }
}

async function decidirAntigosNuvemshop(acao) {
    const pergunta = acao === 'importar'
        ? 'Importar esses pedidos como vendas no painel? O estoque daqui será baixado.'
        : 'Confirmar que esses pedidos já estão lançados no painel? Eles não serão importados.';
    if (!confirm(pergunta)) return;
    try {
        mostrarNuvemshop(await fetchJSON('/api/nuvemshop/antigos', { method: 'POST', body: JSON.stringify({ acao }) }));
        carregarDashboard();
    } catch (e) {
        alert('Não foi possível concluir: ' + e.message);
    }
}

async function desconectarNuvemshop() {
    if (!confirm('Desconectar a Nuvemshop? As vendas de lá param de entrar aqui e o estoque de lá para de ser atualizado.')) return;
    try {
        mostrarNuvemshop(await fetchJSON('/api/nuvemshop', { method: 'DELETE' }));
    } catch (e) {
        alert('Não foi possível desconectar: ' + e.message);
    }
}

async function igualarCapasNuvemshop() {
    const botao = document.getElementById('ns-capas');
    botao.disabled = true;
    botao.textContent = 'Igualando capas...';
    try {
        const s = await fetchJSON('/api/nuvemshop/capas', { method: 'POST' });
        if ((s.capas_trocadas || s.fotos_removidas) && typeof publicarLojaEmSegundoPlano === 'function') publicarLojaEmSegundoPlano();
        mostrarNuvemshop(s);
        const extra = (s.avisos_fotos || []).length ? ' ' + s.avisos_fotos.join(' ') : '';
        document.getElementById('ns-texto').textContent = (s.capas_trocadas || s.fotos_removidas
            ? `⭐ ${s.capas_trocadas} capa(s) igualada(s) e ${s.fotos_removidas} foto(s) repetida(s) removida(s). O site atualiza em 1 ou 2 minutos.`
            : '⭐ As capas do site já estão iguais às da Nuvemshop.') + extra;
    } catch (e) {
        document.getElementById('ns-texto').textContent = '⚠️ Não foi possível igualar as capas: ' + e.message;
    } finally {
        botao.disabled = false;
        botao.textContent = '⭐ Igualar capas com a Nuvemshop';
    }
}

async function importarFotosNuvemshop() {
    const botao = document.getElementById('ns-fotos');
    botao.disabled = true;
    botao.textContent = 'Trazendo fotos...';
    try {
        const s = await fetchJSON('/api/nuvemshop/fotos', { method: 'POST' });
        if (s.fotos_importadas && typeof publicarLojaEmSegundoPlano === 'function') publicarLojaEmSegundoPlano();
        mostrarNuvemshop(s);
        const extra = (s.avisos_fotos || []).length ? ' ' + s.avisos_fotos.join(' ') : '';
        document.getElementById('ns-texto').textContent = (s.fotos_importadas
            ? `🖼️ ${s.fotos_importadas} foto(s) trazida(s) da Nuvemshop. O site recebe a galeria em 1 ou 2 minutos.`
            : '🖼️ Nenhuma foto nova na Nuvemshop: as galerias já estão iguais.') + extra;
    } catch (e) {
        document.getElementById('ns-texto').textContent = '⚠️ Não foi possível trazer as fotos: ' + e.message;
    } finally {
        botao.disabled = false;
        botao.textContent = '🖼️ Trazer fotos da Nuvemshop';
    }
}
