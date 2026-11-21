// public/js/analise.js — tela "Análise de Preços": preço x mercado, margem e quanto pagar na compra.
// As contas estão em analise-calc.js.

let analiseDados = null;

async function carregarAnalise() {
    analiseDados = await fetchJSON('/api/analise');
    const cfg = analiseDados.config;
    document.getElementById('analise-margem').value = cfg.margem_alvo;
    document.getElementById('analise-taxa').value = cfg.taxa;
    document.getElementById('analise-gastos').value = cfg.gastos;
    const r = analiseDados.resumo;
    document.getElementById('analise-taxa-real').textContent = r.vendas
        ? `Nas suas ${r.vendas} vendas registradas, taxas comeram ${r.taxa_media_real.toFixed(1).replace('.', ',')}% do faturamento e o gasto extra médio foi ${formatarMoeda(r.gastos_medio_por_venda)} por venda.`
        : '';
    renderizarAnalise();
    simularCompra();
}

// Configuração em uso na tela (o que está digitado, mesmo antes de salvar)
function analiseConfigTela() {
    return {
        margem_alvo: Number(document.getElementById('analise-margem').value) || 0,
        taxa: Number(document.getElementById('analise-taxa').value) || 0,
        gastos: Number(document.getElementById('analise-gastos').value) || 0,
    };
}

async function salvarAnaliseConfig() {
    const cfg = await fetchJSON('/api/analise/config', { method: 'PUT', body: JSON.stringify(analiseConfigTela()) });
    analiseDados.config = cfg;
    renderizarAnalise();
    document.getElementById('analise-config-msg').textContent = 'Salvo.';
    setTimeout(() => { document.getElementById('analise-config-msg').textContent = ''; }, 2500);
}

const analisePct = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')}%`);
const analiseMoeda = (v) => (v === null || v === undefined ? '—' : formatarMoeda(v));

function renderizarAnalise() {
    if (!analiseDados) return;
    const cfg = analiseConfigTela();
    const filtro = document.getElementById('analise-filtro').value;
    const tbody = document.getElementById('lista-analise');
    tbody.innerHTML = '';

    let somaLucro = 0, somaReceita = 0, abaixoMeta = 0, foraMercado = 0, ganhoPossivel = 0, comPesquisa = 0;
    const linhas = analiseDados.produtos.map((p) => ({ p, a: analisarProduto(p, cfg) }));

    linhas.forEach(({ p, a }) => {
        if (p.preco) { somaLucro += a.lucro; somaReceita += p.preco; }
        if (a.margem !== null && a.margem < cfg.margem_alvo) abaixoMeta++;
        if (p.mercado) comPesquisa++;
        if (p.mercado && (a.diagnostico.nivel === 'atencao' || a.diagnostico.nivel === 'ruim')) foraMercado++;
        if (a.sugerido > p.preco && p.quantidade > 0) ganhoPossivel += (a.sugerido - p.preco) * p.quantidade;
    });

    document.getElementById('analise-card-margem').textContent = somaReceita ? analisePct((somaLucro / somaReceita) * 100) : '—';
    document.getElementById('analise-card-abaixo').textContent = abaixoMeta;
    document.getElementById('analise-card-atencao').textContent = foraMercado;
    document.getElementById('analise-card-ganho').textContent = formatarMoeda(ganhoPossivel);
    document.getElementById('analise-card-pesquisa').textContent = `${comPesquisa} de ${linhas.length} produtos com pesquisa de mercado`;

    linhas
        .filter(({ p, a }) => {
            if (filtro === 'estoque') return p.quantidade > 0;
            if (filtro === 'atencao') return a.diagnostico.nivel === 'atencao' || a.diagnostico.nivel === 'ruim';
            return true;
        })
        .forEach(({ p, a }) => {
            const m = p.mercado;
            const faixa = m
                ? `${analiseMoeda(m.minimo)} – ${analiseMoeda(m.maximo)}<br><small>média ${analiseMoeda(a.ref)}${m.pesquisa_inicial ? ' · pesquisa 21/11' : ''}</small>`
                : '<small>sem pesquisa</small>';
            const posicao = a.posicao === null ? '—'
                : `<span class="${a.posicao > 3 ? 'txt-vermelho' : a.posicao < -10 ? 'txt-azul' : 'txt-verde'}">${a.posicao > 0 ? '+' : ''}${analisePct(a.posicao)}</span>`;
            const sugerido = a.sugerido !== p.preco
                ? `<strong>${formatarMoeda(a.sugerido)}</strong><br><small>lucro ${formatarMoeda(a.lucroSugerido)}/un</small>`
                : '<small>manter</small>';
            const vendas = p.vendas.qtd ? `${p.vendas.qtd_90d} / ${p.vendas.qtd}<br><small>lucro ${formatarMoeda(p.vendas.lucro)}</small>` : '<small>nenhuma</small>';
            const estoque = p.quantidade > 0 ? '' : ' <span class="badge badge-vencida">esgotado</span>';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${p.nome}</strong>${estoque}<br><small>${p.categoria || ''}</small></td>
                    <td>${formatarMoeda(p.custo)}</td>
                    <td>${formatarMoeda(p.preco)}</td>
                    <td class="${a.lucro < 0 ? 'txt-vermelho' : ''}">${formatarMoeda(a.lucro)}<br><small>${analisePct(a.margem)} · ${a.markup ? a.markup.toFixed(1).replace('.', ',') + 'x' : '—'}</small></td>
                    <td>${faixa}</td>
                    <td>${posicao}</td>
                    <td>${sugerido}</td>
                    <td>${analiseMoeda(a.custoMaximo)}${a.custoMaximoAgressivo !== null ? `<br><small>no mínimo do mercado: ${formatarMoeda(a.custoMaximoAgressivo)}</small>` : ''}</td>
                    <td>${vendas}</td>
                    <td><span class="diag diag-${a.diagnostico.nivel}">${a.diagnostico.texto}</span></td>
                    <td><button class="btn-pagar" onclick="abrirPesquisaMercado(${p.id})">Pesquisa</button></td>
                </tr>`;
        });

    if (!tbody.innerHTML) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);">Nenhum produto neste filtro.</td></tr>';
}

/* ---------- pesquisa de mercado de um produto ---------- */

function abrirPesquisaMercado(id) {
    const p = analiseDados.produtos.find((x) => x.id === id);
    const m = p.mercado || {};
    document.getElementById('pesquisa-produto-id').value = id;
    document.getElementById('pesquisa-titulo').textContent = p.nome;
    document.getElementById('pesquisa-minimo').value = m.minimo ?? '';
    document.getElementById('pesquisa-medio').value = m.medio ?? '';
    document.getElementById('pesquisa-maximo').value = m.maximo ?? '';
    document.getElementById('pesquisa-fontes').value = m.fontes || '';
    document.getElementById('pesquisa-obs').value = m.observacao || '';
    document.getElementById('pesquisa-aviso').textContent = m.pesquisa_inicial
        ? 'Valores da pesquisa de 21/11/2026. Ao salvar, passam a ser os seus.'
        : (m.atualizado_em ? `Atualizado em ${new Date(m.atualizado_em).toLocaleDateString('pt-BR')}.` : '');
    const busca = encodeURIComponent(p.nome);
    document.getElementById('pesquisa-links').innerHTML = `
        <a href="https://lista.mercadolivre.com.br/${encodeURIComponent(p.nome.replace(/\s+/g, '-'))}" target="_blank" rel="noopener">Mercado Livre</a>
        <a href="https://shopee.com.br/search?keyword=${busca}" target="_blank" rel="noopener">Shopee</a>
        <a href="https://www.amazon.com.br/s?k=${busca}" target="_blank" rel="noopener">Amazon</a>
        <a href="https://www.google.com/search?tbm=shop&q=${busca}" target="_blank" rel="noopener">Google Shopping</a>
        <a href="https://www.olx.com.br/estado-df?q=${busca}" target="_blank" rel="noopener">OLX DF</a>`;
    abrirModal('modal-pesquisa');
}

async function salvarPesquisaMercado(event) {
    event.preventDefault();
    const id = document.getElementById('pesquisa-produto-id').value;
    const corpo = {
        minimo: document.getElementById('pesquisa-minimo').value,
        medio: document.getElementById('pesquisa-medio').value,
        maximo: document.getElementById('pesquisa-maximo').value,
        fontes: document.getElementById('pesquisa-fontes').value,
        observacao: document.getElementById('pesquisa-obs').value,
    };
    await fetchJSON(`/api/analise/precos/${id}`, { method: 'PUT', body: JSON.stringify(corpo) });
    fecharModal('modal-pesquisa');
    carregarAnalise();
}

/* ---------- simulador: quanto posso pagar? ---------- */

function simularCompra() {
    const cfg = analiseConfigTela();
    const venda = Number(document.getElementById('sim-preco-venda').value) || 0;
    const custo = Number(document.getElementById('sim-custo').value) || 0;
    const margem = document.getElementById('sim-margem').value === '' ? cfg.margem_alvo : Number(document.getElementById('sim-margem').value);
    const saida = [];

    if (venda) {
        const max = custoMaximoCompra(venda, cfg.taxa, margem, cfg.gastos);
        saida.push(`Vendendo a <strong>${formatarMoeda(venda)}</strong>, pague no máximo <strong class="txt-verde">${formatarMoeda(max)}</strong> por unidade (frete e imposto da compra inclusos) para ficar com ${margem}% de margem.`);
        [20, 30, 40, 50].forEach((mg) => {
            if (mg !== margem) saida.push(`<small>Com ${mg}% de margem: até ${formatarMoeda(custoMaximoCompra(venda, cfg.taxa, mg, cfg.gastos))}</small>`);
        });
    }
    if (custo) {
        const minimo = precoMinimoParaMargem(custo, cfg.taxa, margem, cfg.gastos);
        saida.push(`Pagando <strong>${formatarMoeda(custo)}</strong>, venda por pelo menos <strong class="txt-azul">${analiseMoeda(minimo)}</strong> para ter ${margem}% de margem${minimo ? ` (vitrine: ${formatarMoeda(precoPsicologicoAcima(minimo))})` : ''}.`);
        if (venda) {
            const lucro = lucroUnitario(venda, custo, cfg.taxa, cfg.gastos);
            saida.push(`Comprando a ${formatarMoeda(custo)} e vendendo a ${formatarMoeda(venda)}: lucro de <strong class="${lucro < 0 ? 'txt-vermelho' : 'txt-verde'}">${formatarMoeda(lucro)}</strong> por unidade (${analisePct((lucro / venda) * 100)} de margem).`);
        }
    }
    document.getElementById('sim-resultado').innerHTML = saida.length
        ? saida.map((s) => `<p>${s}</p>`).join('')
        : '<p><small>Digite o preço que o produto vale no mercado (ou o seu preço de venda) e/ou quanto vai pagar.</small></p>';
}
