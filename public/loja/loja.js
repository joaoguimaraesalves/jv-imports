// public/loja/loja.js — loja online da JV Imports
// Lê /api/loja/produtos (o mesmo estoque do painel) e atualiza sozinho a cada
// 20 s com a aba aberta. A sacola vira uma mensagem pronta no WhatsApp.
(function () {
    'use strict';

    const ATUALIZAR_MS = 20000;
    const CHAVE_SACOLA = 'jv-sacola';

    const estado = {
        loja: {},
        produtos: [],
        porId: new Map(),
        assinatura: '',
        categoria: 'todas',     // chave normalizada da categoria
        marca: 'todas',
        soDisponiveis: false,
        busca: '',
        sacola: lerSacola(),     // [{ id, qtd }]
        abertoId: null,
        qtdModal: 1,
        carregouUmaVez: false,
    };

    const $ = (id) => document.getElementById(id);
    const moeda = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    // ---------- Dados ----------
    async function carregar(silencioso) {
        try {
            const res = await fetch('/api/loja/produtos', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const dados = await res.json();
            aplicarDados(dados);
            $('erro').hidden = true;
        } catch (e) {
            if (!estado.carregouUmaVez && !silencioso) {
                $('grade').innerHTML = '';
                $('grade').setAttribute('aria-busy', 'false');
                $('erro').hidden = false;
            }
        }
    }

    function aplicarDados(dados) {
        const anteriores = estado.porId;
        estado.loja = dados.loja || {};
        estado.produtos = dados.produtos || [];
        estado.porId = new Map(estado.produtos.map((p) => [p.id, p]));
        aplicarLoja();

        const assinatura = JSON.stringify(estado.produtos);
        const mudouAlgo = assinatura !== estado.assinatura;
        estado.assinatura = assinatura;

        // Produtos cujo estoque mudou desde a última leitura (para destacar)
        const mudaram = new Set();
        if (estado.carregouUmaVez) {
            for (const p of estado.produtos) {
                const antes = anteriores.get(p.id);
                if (antes && (antes.disponivel !== p.disponivel || antes.ultimas !== p.ultimas || antes.preco !== p.preco)) mudaram.add(p.id);
            }
        }

        if (mudouAlgo) {
            desenharChips();
            desenharGrade(mudaram);
            ajustarSacolaAoEstoque();
            if (estado.abertoId) desenharModal();
        }
        if (mudaram.size) avisar('Estoque atualizado agora');

        $('atualizado').textContent = 'Atualizado às ' + new Date(dados.atualizado_em || Date.now())
            .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        if (!estado.carregouUmaVez) {
            estado.carregouUmaVez = true;
            const inicial = parseInt(document.body.dataset.produtoInicial, 10);
            if (inicial && estado.porId.has(inicial)) abrirProduto(inicial, false);
        }
    }

    function aplicarLoja() {
        const l = estado.loja;
        const aviso = $('aviso');
        aviso.textContent = l.aviso || '';
        aviso.hidden = !l.aviso;
        if (l.pagamento) $('txt-pagamento').textContent = l.pagamento;
        if (l.entrega) $('txt-entrega').textContent = l.entrega;
        const insta = $('link-instagram');
        if (l.instagram) { insta.href = 'https://instagram.com/' + encodeURIComponent(l.instagram); insta.hidden = false; }
        else insta.hidden = true;
    }

    // ---------- Vitrine ----------
    // Abas principais nesta ordem; categorias novas entram depois, em ordem alfabética.
    const ORDEM_CATEGORIAS = ['fones', 'carregadores e adaptadores', 'ferramentas'];
    // Marcas reconhecidas no nome do produto (a primeira que aparecer vale).
    const MARCAS = ['QCY', 'KZ', 'Redmi', 'Xiaomi', 'MCHOSE', 'Essager', 'Baseus', 'Ugreen', 'Anker', 'Soundcore',
        'JBL', 'Edifier', 'Haylou', 'Lenovo', 'Soundpeats', 'Samsung', 'Apple', 'Sony', 'Philips', 'Havit',
        'TRN', 'CCA', 'Moondrop', 'Tangzu', 'Truthear', 'Tranya', 'Awei', 'Lehmox', 'Kaidi'];
    const MARCA_POR_CHAVE = new Map(MARCAS.map((m) => [normalizar(m), m]));

    function marcaDe(p) {
        for (const palavra of String(p.nome || '').split(/[\s/()-]+/)) {
            const m = MARCA_POR_CHAVE.get(normalizar(palavra));
            if (m) return m;
        }
        return null;
    }
    const temMarcas = (cat) => cat.startsWith('fone');

    function categorias() {
        const mapa = new Map();
        for (const p of estado.produtos) {
            if (!p.categoria) continue;
            const k = normalizar(p.categoria);
            if (!mapa.has(k)) mapa.set(k, { chave: k, rotulo: p.categoria, total: 0 });
            mapa.get(k).total++;
        }
        const pos = (k) => { const i = ORDEM_CATEGORIAS.indexOf(k); return i < 0 ? 99 : i; };
        return [...mapa.values()].sort((a, b) => pos(a.chave) - pos(b.chave) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    }

    function marcasDaCategoria() {
        const mapa = new Map();
        for (const p of estado.produtos) {
            if (normalizar(p.categoria) !== estado.categoria) continue;
            const m = marcaDe(p) || 'Outras';
            mapa.set(m, (mapa.get(m) || 0) + 1);
        }
        return [...mapa.entries()].sort((a, b) => (a[0] === 'Outras') - (b[0] === 'Outras') || b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function desenharChips() {
        const cats = categorias();
        if (estado.categoria !== 'todas' && !cats.some((c) => c.chave === estado.categoria)) estado.categoria = 'todas';
        const chip = (attrs, rotulo, total, ativo) =>
            `<button type="button" class="chip" role="tab" ${attrs} aria-selected="${ativo}">${esc(rotulo)}${total != null ? ` <span class="chip-n">${total}</span>` : ''}</button>`;
        $('chips').innerHTML =
            chip('data-cat="todas"', 'Todos', estado.produtos.length, estado.categoria === 'todas') +
            cats.map((c) => chip(`data-cat="${esc(c.chave)}"`, c.rotulo, c.total, c.chave === estado.categoria)).join('') +
            `<button type="button" class="chip chip-toggle" data-pronta aria-pressed="${estado.soDisponiveis}">⚡ Pronta entrega</button>`;

        // Dentro de Fones: filtro por marca (só aparece se houver mais de uma)
        const marcas = estado.categoria !== 'todas' && temMarcas(estado.categoria) ? marcasDaCategoria() : [];
        if (estado.marca !== 'todas' && !marcas.some(([m]) => m === estado.marca)) estado.marca = 'todas';
        const sub = $('marcas');
        sub.hidden = marcas.length < 2;
        sub.innerHTML = sub.hidden ? '' :
            chip('data-marca="todas"', 'Todas as marcas', null, estado.marca === 'todas') +
            marcas.map(([m, n]) => chip(`data-marca="${esc(m)}"`, m, n, m === estado.marca)).join('');
    }

    function filtrados() {
        const termo = normalizar(estado.busca).trim();
        return estado.produtos.filter((p) => {
            if (estado.soDisponiveis && !p.disponivel) return false;
            if (estado.categoria !== 'todas' && normalizar(p.categoria) !== estado.categoria) return false;
            if (estado.marca !== 'todas' && (marcaDe(p) || 'Outras') !== estado.marca) return false;
            if (termo && !normalizar(p.nome + ' ' + p.categoria + ' ' + p.descricao).includes(termo)) return false;
            return true;
        });
    }

    function fotoHtml(p, classe) {
        if (p.foto) return `<img src="${esc(p.foto)}" alt="${esc(p.nome)}" loading="lazy" decoding="async"${classe ? ` class="${classe}"` : ''}>`;
        // Sem foto: mostra a primeira palavra do nome (geralmente a marca) em destaque
        const sigla = (p.nome || '').trim().split(/\s+/)[0].slice(0, 14);
        const tamanho = sigla.length <= 6 ? '' : sigla.length <= 9 ? ' media' : ' longa';
        return `<div class="sem-foto${tamanho}" role="img" aria-label="${esc(p.nome)}"><span>${esc(sigla)}</span></div>`;
    }

    function selosHtml(p) {
        const s = [];
        if (!p.disponivel) s.push('<span class="selo selo-esgotado">Esgotado</span>');
        if (p.desconto > 0) s.push(`<span class="selo selo-promo">-${p.desconto}%</span>`);
        if (p.mais_vendido) s.push('<span class="selo selo-top">Mais vendido</span>');
        else if (p.destaque) s.push('<span class="selo selo-destaque">Destaque</span>');
        return s.length ? `<div class="selos-card">${s.join('')}</div>` : '';
    }

    function precoHtml(p) {
        return `<div class="preco">${p.preco_antigo ? `<s>${moeda(p.preco_antigo)}</s>` : ''}<strong>${moeda(p.preco)}</strong></div>`;
    }

    function estoqueHtml(p) {
        if (!p.disponivel) return '<p class="estoque fora">Esgotado · sob encomenda</p>';
        if (p.ultimas) return `<p class="estoque ultimas">${p.ultimas === 1 ? 'Última unidade!' : `Últimas ${p.ultimas} unidades`}</p>`;
        return '<p class="estoque">Pronta entrega</p>';
    }

    function desenharGrade(mudaram = new Set()) {
        const lista = filtrados();
        const grade = $('grade');
        grade.setAttribute('aria-busy', 'false');
        $('vazio').hidden = lista.length > 0;
        grade.innerHTML = lista.map((p) => {
            const naSacola = estado.sacola.some((i) => i.id === p.id);
            const botao = p.disponivel
                ? `<button type="button" class="btn-add${naSacola ? ' ok' : ''}" data-add="${p.id}">${naSacola ? '✓ Na sacola' : 'Adicionar'}</button>`
                : `<button type="button" class="btn-add encomenda" data-encomendar="${p.id}">Encomendar</button>`;
            return `<article class="card${p.disponivel ? '' : ' esgotado'}${mudaram.has(p.id) ? ' mudou' : ''}" data-id="${p.id}">
                <button type="button" class="card-foto" data-abrir="${p.id}" aria-label="Ver ${esc(p.nome)}">${fotoHtml(p)}${selosHtml(p)}</button>
                <div class="card-corpo">
                    ${p.categoria || marcaDe(p) ? `<span class="card-cat">${esc([p.categoria, marcaDe(p)].filter(Boolean).join(' · '))}</span>` : ''}
                    <h3><button type="button" data-abrir="${p.id}">${esc(p.nome)}</button></h3>
                    ${precoHtml(p)}
                    ${estoqueHtml(p)}
                    ${botao}
                </div>
            </article>`;
        }).join('');
    }

    // ---------- Detalhe do produto ----------
    function abrirProduto(id, mexerUrl = true) {
        const p = estado.porId.get(id);
        if (!p) return;
        estado.abertoId = id;
        estado.qtdModal = 1;
        desenharModal();
        const dlg = $('dlg-produto');
        if (!dlg.open) dlg.showModal();
        if (mexerUrl) history.replaceState(null, '', '/p/' + id);
    }

    function desenharModal() {
        const p = estado.porId.get(estado.abertoId);
        if (!p) { $('dlg-produto').close(); return; }
        estado.qtdModal = Math.max(1, Math.min(estado.qtdModal, p.max_compra || 1));
        $('dp-foto').innerHTML = fotoHtml(p) + selosHtml(p);
        // Fundo desfocado com a própria foto: sem faixas vazias nas fotos em pé
        $('dp-foto').style.setProperty('--foto-fundo', p.foto ? `url("${p.foto.replace(/["\\]/g, '')}")` : 'none');
        $('dp-cat').textContent = [p.categoria, marcaDe(p)].filter(Boolean).join(' · ');
        $('dp-nome').textContent = p.nome;
        $('dp-preco').innerHTML = precoHtml(p).replace(/^<div class="preco">|<\/div>$/g, '');
        const est = $('dp-estoque');
        est.className = 'estoque' + (!p.disponivel ? ' fora' : p.ultimas ? ' ultimas' : '');
        est.textContent = !p.disponivel ? 'Esgotado · sob encomenda'
            : p.ultimas ? (p.ultimas === 1 ? 'Última unidade!' : `Últimas ${p.ultimas} unidades`) : 'Pronta entrega';
        $('dp-desc').textContent = p.descricao || '';
        $('dp-desc').hidden = !p.descricao;
        $('dp-compra').hidden = !p.disponivel;
        $('dp-qtd').textContent = estado.qtdModal;
        $('dp-menos').disabled = estado.qtdModal <= 1;
        $('dp-mais').disabled = estado.qtdModal >= p.max_compra;
        $('dp-whats').textContent = p.disponivel ? 'Comprar agora pelo WhatsApp' : 'Encomendar pelo WhatsApp';
    }

    function fecharProduto() {
        estado.abertoId = null;
        if (location.pathname !== '/') history.replaceState(null, '', '/');
    }

    // ---------- Sacola ----------
    function lerSacola() {
        try {
            const s = JSON.parse(localStorage.getItem(CHAVE_SACOLA) || '[]');
            return Array.isArray(s) ? s.filter((i) => Number.isInteger(i.id) && i.qtd > 0) : [];
        } catch (e) { return []; }
    }
    function salvarSacola() {
        try { localStorage.setItem(CHAVE_SACOLA, JSON.stringify(estado.sacola)); } catch (e) { /* sem storage */ }
    }

    function adicionar(id, qtd = 1) {
        const p = estado.porId.get(id);
        if (!p || !p.disponivel) return;
        const item = estado.sacola.find((i) => i.id === id);
        const atual = item ? item.qtd : 0;
        const nova = Math.min(atual + qtd, p.max_compra);
        if (nova === atual) { avisar(`Só temos ${p.max_compra} em estoque`); return; }
        if (item) item.qtd = nova; else estado.sacola.push({ id, qtd: nova });
        salvarSacola();
        desenharSacola(true);
        desenharGrade();
        avisar(`${p.nome} na sacola`);
    }

    function mudarQtd(id, delta) {
        const item = estado.sacola.find((i) => i.id === id);
        const p = estado.porId.get(id);
        if (!item) return;
        item.qtd = Math.max(1, Math.min(item.qtd + delta, p ? p.max_compra || 1 : item.qtd));
        salvarSacola();
        desenharSacola();
    }

    function remover(id) {
        estado.sacola = estado.sacola.filter((i) => i.id !== id);
        salvarSacola();
        desenharSacola();
        desenharGrade();
    }

    // Se algo esgotou ou diminuiu enquanto a pessoa navegava, corrige a sacola
    function ajustarSacolaAoEstoque() {
        let mexeu = false;
        for (const item of estado.sacola) {
            const p = estado.porId.get(item.id);
            if (p && p.disponivel && item.qtd > p.max_compra) { item.qtd = p.max_compra; mexeu = true; }
        }
        if (mexeu) salvarSacola();
        desenharSacola();
    }

    function itensValidos() {
        return estado.sacola
            .map((i) => ({ ...i, p: estado.porId.get(i.id) }))
            .filter((i) => i.p && i.p.disponivel);
    }

    function desenharSacola(pular) {
        const contador = $('sacola-contador');
        const total = estado.sacola.reduce((s, i) => s + i.qtd, 0);
        contador.textContent = total;
        contador.hidden = total === 0;
        if (pular) { contador.classList.remove('pulou'); void contador.offsetWidth; contador.classList.add('pulou'); }

        const lista = $('sacola-itens');
        lista.innerHTML = estado.sacola.map((i) => {
            const p = estado.porId.get(i.id);
            if (!p && estado.carregouUmaVez) return `<li class="item"><div class="item-foto"></div><div>
                <p class="item-nome">Produto indisponível</p>
                <div class="item-linha"><span></span><button type="button" class="item-remover" data-remover="${i.id}">Remover</button></div></div></li>`;
            if (!p) return '';
            const esgotou = !p.disponivel;
            return `<li class="item">
                <div class="item-foto">${fotoHtml(p)}</div>
                <div>
                    <p class="item-nome">${esc(p.nome)}</p>
                    <p class="item-preco">${moeda(p.preco)} cada</p>
                    ${esgotou ? '<p class="item-aviso">Acabou de esgotar — não entra no pedido</p>' : ''}
                    <div class="item-linha">
                        ${esgotou ? '<span></span>' : `<div class="qtd pequena" role="group" aria-label="Quantidade de ${esc(p.nome)}">
                            <button type="button" data-menos="${p.id}" aria-label="Diminuir" ${i.qtd <= 1 ? 'disabled' : ''}>−</button>
                            <output>${i.qtd}</output>
                            <button type="button" data-mais="${p.id}" aria-label="Aumentar" ${i.qtd >= p.max_compra ? 'disabled' : ''}>+</button>
                        </div>`}
                        <button type="button" class="item-remover" data-remover="${p.id}">Remover</button>
                    </div>
                </div>
            </li>`;
        }).join('');

        const validos = itensValidos();
        const soma = validos.reduce((s, i) => s + i.qtd * i.p.preco, 0);
        $('sacola-total').textContent = moeda(soma);
        $('sacola-vazia').hidden = estado.sacola.length > 0;
        $('sacola-rodape').hidden = estado.sacola.length === 0;
        $('sacola-finalizar').disabled = validos.length === 0;
    }

    // ---------- WhatsApp ----------
    function abrirWhats(texto) {
        const numero = estado.loja.whatsapp;
        if (!numero) { avisar('O WhatsApp da loja ainda não foi configurado.'); return false; }
        const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank', 'noopener');
        return true;
    }

    function linkProduto(p) { return `${location.origin}/p/${p.id}`; }

    function finalizarSacola() {
        const validos = itensValidos();
        if (!validos.length) return;
        const nome = $('sacola-nome').value.trim();
        const linhas = validos.map((i) => `• ${i.qtd}x ${i.p.nome} — ${moeda(i.qtd * i.p.preco)}`);
        const total = validos.reduce((s, i) => s + i.qtd * i.p.preco, 0);
        const texto = [
            `Olá, JV Imports!${nome ? ` Aqui é ${nome}.` : ''} Vi no site e quero fazer este pedido:`,
            '',
            ...linhas,
            '',
            `*Total: ${moeda(total)}*`,
            '',
            'Como fica o pagamento e a entrega?',
        ].join('\n');
        abrirWhats(texto);
    }

    function comprarAgora(p, qtd) {
        const texto = p.disponivel
            ? `Olá, JV Imports! Vi no site e quero comprar:\n\n• ${qtd}x ${p.nome} — ${moeda(qtd * p.preco)}\n\n${linkProduto(p)}\n\nComo fica o pagamento e a entrega?`
            : `Olá, JV Imports! Vi no site que o *${p.nome}* está esgotado. Quero encomendar — quando chega?\n\n${linkProduto(p)}`;
        abrirWhats(texto);
    }

    async function compartilhar(p) {
        const url = linkProduto(p);
        const dados = { title: p.nome + ' | JV Imports', text: `${p.nome} por ${moeda(p.preco)} na JV Imports`, url };
        try {
            if (navigator.share) { await navigator.share(dados); return; }
            await navigator.clipboard.writeText(url);
            avisar('Link copiado!');
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            prompt('Copie o link do produto:', url);
        }
    }

    // ---------- Aviso rápido ----------
    let timerAviso;
    function avisar(texto) {
        const t = $('toast');
        t.textContent = texto;
        t.classList.add('visivel');
        clearTimeout(timerAviso);
        timerAviso = setTimeout(() => t.classList.remove('visivel'), 2400);
    }

    // ---------- Eventos ----------
    document.addEventListener('click', (e) => {
        const alvo = e.target.closest('button, a');
        if (!alvo) return;
        const d = alvo.dataset;
        if (d.abrir) return abrirProduto(Number(d.abrir));
        if (d.add) return adicionar(Number(d.add));
        if (d.encomendar) { const p = estado.porId.get(Number(d.encomendar)); if (p) comprarAgora(p, 1); return; }
        if (d.cat) { estado.categoria = d.cat; estado.marca = 'todas'; desenharChips(); desenharGrade(); return; }
        if (d.marca) { estado.marca = d.marca; desenharChips(); desenharGrade(); return; }
        if (alvo.hasAttribute('data-pronta')) { estado.soDisponiveis = !estado.soDisponiveis; desenharChips(); desenharGrade(); return; }
        if (d.menos) return mudarQtd(Number(d.menos), -1);
        if (d.mais) return mudarQtd(Number(d.mais), +1);
        if (d.remover) return remover(Number(d.remover));
        if (alvo.hasAttribute('data-whats-geral')) return abrirWhats('Olá, JV Imports! Vim pelo site e queria tirar uma dúvida.');
        if (alvo.hasAttribute('data-fechar')) return alvo.closest('dialog').close();
    });

    $('btn-sacola').addEventListener('click', () => { desenharSacola(); $('dlg-sacola').showModal(); });
    $('sacola-finalizar').addEventListener('click', finalizarSacola);
    $('tentar-de-novo').addEventListener('click', () => { $('erro').hidden = true; carregar(); });

    $('dp-menos').addEventListener('click', () => { estado.qtdModal--; desenharModal(); });
    $('dp-mais').addEventListener('click', () => { estado.qtdModal++; desenharModal(); });
    $('dp-add').addEventListener('click', () => { adicionar(estado.abertoId, estado.qtdModal); $('dlg-produto').close(); });
    $('dp-whats').addEventListener('click', () => { const p = estado.porId.get(estado.abertoId); if (p) comprarAgora(p, estado.qtdModal); });
    $('dp-compartilhar').addEventListener('click', () => { const p = estado.porId.get(estado.abertoId); if (p) compartilhar(p); });
    $('dlg-produto').addEventListener('close', fecharProduto);

    // Clicar no fundo escuro fecha o diálogo
    for (const dlg of document.querySelectorAll('dialog')) {
        dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }

    let timerBusca;
    $('busca').addEventListener('input', (e) => {
        clearTimeout(timerBusca);
        timerBusca = setTimeout(() => { estado.busca = e.target.value; desenharGrade(); }, 120);
    });

    // Atualização automática: a cada 20 s com a aba visível, a cada 60 s em
    // segundo plano, e na hora em que a pessoa volta para a aba.
    let ultimaLeitura = Date.now();
    setInterval(() => {
        const intervalo = document.visibilityState === 'visible' ? ATUALIZAR_MS : ATUALIZAR_MS * 3;
        if (Date.now() - ultimaLeitura >= intervalo - 500) { ultimaLeitura = Date.now(); carregar(true); }
    }, 5000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { ultimaLeitura = Date.now(); carregar(true); }
    });

    $('ano').textContent = new Date().getFullYear();
    desenharSacola();
    carregar();
})();
