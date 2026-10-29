// public/js/dashboard.js
let meuGrafico;
let estadoDashboard = {
    periodo: '30d',
    agrupar: 'dia',
    topPor:  'qtd'
};

async function atualizarDashboardCompleto() {
    estadoDashboard.periodo = document.getElementById('filtro-periodo').value;
    await Promise.all([
        carregarDashboard(),
        desenharGrafico(),
        carregarTopProdutos(),
        carregarProximasContas(),
        carregarMetaCaixa(),
        // Rotas novas: se não existirem (painel Node antigo), o resto do dashboard continua
        carregarCanais().catch(() => {}),
        carregarMetaMes().catch(() => {}),
        carregarEstoqueBaixo().catch(() => {})
    ]);
}

function mudarAgrupamento(agrupar) {
    estadoDashboard.agrupar = agrupar;
    document.querySelectorAll('[data-agrupar]').forEach(b => b.classList.toggle('active', b.dataset.agrupar === agrupar));
    desenharGrafico();
}

function mudarOrdemTop(por) {
    estadoDashboard.topPor = por;
    document.querySelectorAll('[data-por]').forEach(b => b.classList.toggle('active', b.dataset.por === por));
    carregarTopProdutos();
}

async function carregarDashboard() {
    const d = await fetchJSON(`/api/dashboard?periodo=${estadoDashboard.periodo}`);
    document.getElementById('val-lucro').innerText    = formatarMoeda(d.lucro_liquido);
    document.getElementById('val-despesas').innerText = formatarMoeda(d.contas_pagas);
    document.getElementById('val-vendas').innerText   = formatarMoeda(d.total_vendas);
    document.getElementById('val-qtd').innerText      = d.qtd_vendida;
    document.getElementById('val-ticket').innerText   = formatarMoeda(d.ticket_medio);
    const despesas = Number(d.despesas_venda) || 0;
    document.getElementById('val-custos').innerText   = formatarMoeda(d.custos + despesas);
    document.getElementById('det-custos').innerText   = despesas ? `produto ${formatarMoeda(d.custos)} · taxas/extras ${formatarMoeda(despesas)}` : '';
    document.getElementById('val-margem').innerText   = d.margem + '%';

    // "vs período anterior" (não existe em "Tudo")
    const a = d.anterior;
    mostrarVariacao('delta-lucro',  d.lucro_liquido, a && a.lucro_liquido);
    mostrarVariacao('delta-vendas', d.total_vendas,  a && a.total_vendas);
    mostrarVariacao('delta-qtd',    d.qtd_vendida,   a && a.qtd_vendida);
    mostrarVariacao('delta-ticket', d.ticket_medio,  a && a.ticket_medio);
    mostrarVariacao('delta-margem', Number(d.margem), a && Number(a.margem), true);
}

const NOME_PERIODO_ANTERIOR = { hoje: 'ontem', '7d': '7 dias antes', '30d': '30 dias antes', mes: 'mês passado', ano: 'ano passado' };

// ▲ 12% vs mês passado. Margem compara em pontos percentuais (p.p.).
function mostrarVariacao(id, atual, anterior, pontos = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'card-delta';
    if (anterior === null || anterior === undefined || isNaN(anterior)) { el.textContent = ''; return; }
    const quando = NOME_PERIODO_ANTERIOR[estadoDashboard.periodo] || 'período anterior';
    let texto;
    if (pontos) {
        const dif = atual - anterior;
        const seta = Math.abs(dif) < 0.05 ? '=' : dif > 0 ? '▲' : '▼';
        texto = `${seta} ${Math.abs(dif).toFixed(1)} p.p. vs ${quando}`;
        if (seta !== '=') el.classList.add(dif > 0 ? 'sobe' : 'desce');
    } else if (anterior === 0) {
        texto = atual > 0 ? `▲ novo · ${quando}: 0` : `= ${quando}: 0`;
        if (atual > 0) el.classList.add('sobe');
    } else {
        const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
        texto = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs ${quando}`;
        el.classList.add(pct >= 0 ? 'sobe' : 'desce');
    }
    el.textContent = texto;
}

// ---------- Vendas por canal e por pagamento (barras simples, boas no celular) ----------
function desenharRanking(id, itens, nomear = (n) => n) {
    const box = document.getElementById(id);
    if (!itens.length) {
        box.innerHTML = '<div class="ranking-vazio">Sem vendas no período.</div>';
        return;
    }
    const total = itens.reduce((s, x) => s + x.faturamento, 0) || 1;
    box.innerHTML = itens.map(x => {
        const pct = (x.faturamento / total) * 100;
        return `
            <div class="ranking-item">
                <div class="ranking-linha">
                    <span class="ranking-nome">${esc(nomear(x.nome))}</span>
                    <span class="ranking-valor">${formatarMoeda(x.faturamento)} <small>${pct.toFixed(0)}%</small></span>
                </div>
                <div class="ranking-barra"><div style="width: ${pct.toFixed(1)}%"></div></div>
                <small class="ranking-detalhe">${x.vendas} venda${x.vendas === 1 ? '' : 's'} · lucro ${formatarMoeda(x.lucro)}</small>
            </div>`;
    }).join('');
}

async function carregarCanais() {
    const d = await fetchJSON(`/api/dashboard/canais?periodo=${estadoDashboard.periodo}`);
    desenharRanking('lista-canais', d.canais);
    desenharRanking('lista-pagamentos', d.pagamentos, (n) => n === 'Não informado' ? n : nomePagamento(n));
}

// ---------- Meta de faturamento do mês ----------
async function carregarMetaMes(dados) {
    const m = dados || await fetchJSON('/api/dashboard/meta');
    const input = document.getElementById('meta-input');
    if (document.activeElement !== input) input.value = m.meta || '';
    const barra = document.getElementById('meta-progresso');
    const resumo = document.getElementById('meta-resumo');
    const dica = document.getElementById('meta-dica');
    const nomeMes = new Date(m.mes + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long' });

    if (!m.meta) {
        barra.style.width = '0%';
        resumo.innerHTML = `
            <div><span>Vendido em ${nomeMes}</span><strong>${formatarMoeda(m.faturamento)}</strong></div>
            <div><span>Lucro em ${nomeMes}</span><strong>${formatarMoeda(m.lucro)}</strong></div>`;
        dica.className = 'caixa-destaque';
        dica.innerHTML = 'Defina quanto quer faturar este mês e o painel mostra quanto falta vender por dia. 🎯';
        return;
    }
    barra.style.width = m.progresso.toFixed(1) + '%';
    barra.className = m.progresso >= 100 ? 'completa' : '';
    resumo.innerHTML = `
        <div><span>Vendido em ${nomeMes}</span><strong>${formatarMoeda(m.faturamento)}</strong></div>
        <div><span>Meta</span><strong>${formatarMoeda(m.meta)}</strong></div>
        <div><span>Falta</span><strong>${formatarMoeda(m.falta)}</strong></div>
        <div><span>Dias restantes</span><strong>${m.dias_restantes}</strong></div>
        <div><span>Vender por dia</span><strong>${formatarMoeda(m.por_dia)}</strong></div>`;
    if (m.falta <= 0) {
        dica.className = 'caixa-destaque ok';
        dica.innerHTML = `🎉 Meta de ${nomeMes} batida! Lucro do mês: <strong>${formatarMoeda(m.lucro)}</strong>.`;
    } else {
        dica.className = 'caixa-destaque';
        dica.innerHTML = `${m.progresso.toFixed(0)}% da meta. Faltam <strong>${formatarMoeda(m.falta)}</strong> em ${m.dias_restantes} dia${m.dias_restantes === 1 ? '' : 's'}: cerca de <strong>${formatarMoeda(m.por_dia)} por dia</strong>.`;
    }
}

async function salvarMetaMes(event) {
    event.preventDefault();
    const valor = parseFloat(document.getElementById('meta-input').value) || 0;
    const m = await fetchJSON('/api/dashboard/meta', { method: 'PUT', body: JSON.stringify({ valor }) });
    document.getElementById('meta-input').blur();
    carregarMetaMes(m);
}

// ---------- Estoque baixo ----------
async function carregarEstoqueBaixo() {
    const produtos = await fetchJSON('/api/produtos');
    const box = document.getElementById('lista-estoque-baixo');
    const acabando = produtos.filter(p => p.quantidade > 0 && p.quantidade <= 2).sort((a, b) => a.quantidade - b.quantidade);
    const esgotados = produtos.filter(p => p.quantidade <= 0);
    if (!acabando.length && !esgotados.length) {
        box.innerHTML = '<div class="ranking-vazio">Nenhum produto acabando. ✅</div>';
        return;
    }
    box.innerHTML = acabando.map(p => `
        <div class="proxima-conta">
            <div class="proxima-conta-info">
                <span class="proxima-conta-desc">${esc(p.nome)}</span>
                <span class="proxima-conta-data">${p.quantidade === 1 ? 'Última unidade' : 'Restam ' + p.quantidade}</span>
            </div>
            <span class="badge badge-pendente">${p.quantidade} un</span>
        </div>`).join('') + (esgotados.length ? `
        <details class="esgotados">
            <summary>${esgotados.length} esgotado${esgotados.length === 1 ? '' : 's'}</summary>
            <p>${esgotados.map(p => esc(p.nome)).join(' · ')}</p>
        </details>` : '');
}

// ---------- Esconder valores (para abrir o painel perto de outras pessoas) ----------
function alternarValores(forcar) {
    const ocultar = typeof forcar === 'boolean' ? forcar : !document.body.classList.contains('valores-ocultos');
    document.body.classList.toggle('valores-ocultos', ocultar);
    document.getElementById('btn-olho').textContent = ocultar ? '🙈' : '👁';
    try { localStorage.setItem('jv-ocultar-valores', ocultar ? '1' : '0'); } catch (e) {}
}
try { if (localStorage.getItem('jv-ocultar-valores') === '1') alternarValores(true); } catch (e) {}

// Lê as cores do tema atual (variáveis CSS do :root) para o Chart.js
function coresTema() {
    const estilo = getComputedStyle(document.documentElement);
    const escuro = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        texto: estilo.getPropertyValue('--text-main').trim() || '#F8FAFC',
        suave: estilo.getPropertyValue('--text-muted').trim() || '#94A3B8',
        grid:  escuro ? 'rgba(148,163,184,0.1)' : 'rgba(100,116,139,0.15)'
    };
}

// Lista todos os períodos (dias ou meses) do filtro atual, inclusive os sem
// movimento, para o eixo X mostrar a linha do tempo completa com zeros.
function periodosDoFiltro(periodo, agrupar, chavesComDados) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let inicio = new Date(hoje);
    if (periodo === '7d')  inicio.setDate(hoje.getDate() - 6);
    if (periodo === '30d') inicio.setDate(hoje.getDate() - 29);
    if (periodo === 'mes') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    if (periodo === 'ano') inicio = new Date(hoje.getFullYear(), 0, 1);
    if (periodo === 'total' && chavesComDados.length) {
        const [ano, mes, dia] = [...chavesComDados].sort()[0].split('-').map(Number);
        inicio = new Date(ano, mes - 1, dia || 1);
    }

    const chaves = new Set(chavesComDados);
    const cursor = new Date(inicio);
    if (agrupar === 'mes') {
        cursor.setDate(1);
        while (cursor <= hoje) {
            chaves.add(dataLocalISO(cursor).slice(0, 7));
            cursor.setMonth(cursor.getMonth() + 1);
        }
    } else {
        while (cursor <= hoje) {
            chaves.add(dataLocalISO(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
    }
    return [...chaves].sort();
}

async function desenharGrafico() {
    const { vendas, contas } = await fetchJSON(
        `/api/dashboard/grafico?periodo=${estadoDashboard.periodo}&agrupar=${estadoDashboard.agrupar}`
    );

    // Junta tudo num dicionário indexado por período (ex: "2026-04-22" ou "2026-04")
    const porPeriodo = {};
    const garantir = (p) => { if (!porPeriodo[p]) porPeriodo[p] = { faturamento: 0, custo: 0, gastos: 0 }; };

    vendas.forEach(v => { garantir(v.periodo); porPeriodo[v.periodo].faturamento += v.faturamento; porPeriodo[v.periodo].custo += v.custo; });
    contas.forEach(c => { garantir(c.periodo); porPeriodo[c.periodo].gastos += c.pagas; });

    const periodos     = periodosDoFiltro(estadoDashboard.periodo, estadoDashboard.agrupar, Object.keys(porPeriodo));
    periodos.forEach(garantir);
    const faturamentos = periodos.map(p => porPeriodo[p].faturamento);
    const lucros       = periodos.map(p => porPeriodo[p].faturamento - porPeriodo[p].custo);
    const gastos       = periodos.map(p => porPeriodo[p].gastos);

    // Formata rótulos do eixo X conforme o agrupamento (dia ou mês)
    const labels = periodos.map(p => {
        if (estadoDashboard.agrupar === 'mes') {
            // "2026-04" → "Abr/26"
            const [ano, mes] = p.split('-');
            const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
            return `${meses[parseInt(mes) - 1]}/${ano.slice(2)}`;
        }
        // "2026-04-22" → "22/04"
        const [, mes, dia] = p.split('-');
        return `${dia}/${mes}`;
    });

    const cores = coresTema();
    if (meuGrafico) meuGrafico.destroy();
    meuGrafico = new Chart(document.getElementById('graficoEvolucao').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Faturamento',   data: faturamentos, backgroundColor: '#3B82F6', borderRadius: 4, maxBarThickness: 36 },
                { label: 'Lucro Líquido', data: lucros,       backgroundColor: '#10B981', borderRadius: 4, maxBarThickness: 36 },
                { label: 'Contas pagas',  data: gastos,       backgroundColor: '#EF4444', borderRadius: 4, maxBarThickness: 36 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: cores.texto } },
                tooltip: {
                    callbacks: {
                        // Formatar valor no tooltip como moeda BRL
                        label: (ctx) => `${ctx.dataset.label}: ${formatarMoeda(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: cores.suave, maxRotation: 0, autoSkipPadding: 12 },
                    grid:  { color: cores.grid }
                },
                y: {
                    ticks: {
                        color: cores.suave,
                        // Mostrar valores do eixo como R$ abreviado (R$ 1.2k, R$ 3M)
                        callback: (v) => {
                            if (v >= 1000000) return 'R$ ' + (v/1000000).toFixed(1) + 'M';
                            if (v >= 1000)    return 'R$ ' + (v/1000).toFixed(1) + 'k';
                            return 'R$ ' + v;
                        }
                    },
                    grid: { color: cores.grid }
                }
            }
        }
    });
}

async function carregarTopProdutos() {
    const top = await fetchJSON(`/api/dashboard/top-produtos?por=${estadoDashboard.topPor}&periodo=${estadoDashboard.periodo}`);
    const tbody = document.getElementById('lista-top-produtos');
    tbody.innerHTML = '';

    if (top.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Sem vendas no período.</td></tr>`;
        return;
    }

    top.forEach((p, i) => {
        tbody.innerHTML += `
            <tr>
                <td><strong>#${i + 1}</strong></td>
                <td>${p.produto_nome}</td>
                <td>${p.qtd} un</td>
                <td style="color: var(--color-blue);">${formatarMoeda(p.faturamento)}</td>
                <td style="color: var(--color-green);">${formatarMoeda(p.lucro)}</td>
            </tr>`;
    });
}

async function carregarProximasContas() {
    const contas = await fetchJSON('/api/dashboard/proximas-contas');
    const container = document.getElementById('lista-proximas-contas');
    container.innerHTML = '';

    if (contas.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">Nenhuma conta pendente 🎉</div>`;
        return;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    contas.forEach(c => {
        const vencida = c.vencimento < hoje;
        const dataLabel = new Date(c.vencimento + 'T00:00:00').toLocaleDateString('pt-BR');
        container.innerHTML += `
            <div class="proxima-conta">
                <div class="proxima-conta-info">
                    <span class="proxima-conta-desc">${c.descricao}</span>
                    <span class="proxima-conta-data" style="${vencida ? 'color: var(--color-red);' : ''}">
                        ${vencida ? '⚠️ Vencida em ' : 'Vence em '}${dataLabel}
                    </span>
                </div>
                <span class="proxima-conta-valor">${formatarMoeda(c.valor)}</span>
            </div>`;
    });
}

// ---------- Meta de Caixa ----------
function dataLocalISO(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const formatarDataBR = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');

function textoPrazo(item) {
    if (item.vencida)    return `venceu há ${-item.dias} dia(s)`;
    if (item.dias === 0) return 'vence hoje';
    if (item.dias === 1) return 'vence amanhã';
    return `faltam ${item.dias} dias`;
}

const SITUACOES = {
    'coberta':  { texto: '✅ Coberta',          classe: 'badge-paga' },
    'no-ritmo': { texto: '🟢 No ritmo',         classe: 'badge-paga' },
    'abaixo':   { texto: '🔴 Abaixo do ritmo',  classe: 'badge-vencida' },
    'vencida':  { texto: '⚠️ Vencida',          classe: 'badge-vencida' }
};

async function carregarMetaCaixa() {
    const d = await fetchJSON('/api/caixa');
    const info = document.getElementById('caixa-saldo-info');
    const destaque = document.getElementById('caixa-destaque');
    const tbody = document.getElementById('caixa-lista');
    const tabela = tbody.closest('table');

    document.getElementById('caixa-media').innerText = formatarMoeda(d.media_diaria_vendas);
    document.getElementById('caixa-a-receber').innerText = formatarMoeda(d.a_receber);

    if (d.saldo_informado === null) {
        info.innerHTML = 'Informe o saldo atual da conta de vendas para calcular quanto falta para pagar as contas.';
        ['caixa-saldo', 'caixa-pendente', 'caixa-falta'].forEach(id => document.getElementById(id).innerText = '--');
        destaque.innerHTML = '';
        tabela.style.display = 'none';
        return;
    }

    const input = document.getElementById('caixa-saldo-input');
    if (document.activeElement !== input) input.value = d.saldo_estimado.toFixed(2);

    const quando = new Date(d.saldo_atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const ajustes = [];
    if (d.vendas_desde)       ajustes.push(`+ ${formatarMoeda(d.vendas_desde)} em vendas`);
    if (d.contas_pagas_desde) ajustes.push(`− ${formatarMoeda(d.contas_pagas_desde)} em contas pagas`);
    if (d.compras_vista_desde) ajustes.push(`− ${formatarMoeda(d.compras_vista_desde)} em compras à vista`);
    info.innerHTML = `Saldo informado: ${formatarMoeda(d.saldo_informado)} em ${quando}`
        + (ajustes.length ? ` · desde então: ${ajustes.join(', ')}` : '');

    const plano = calcularPlanejamento({
        saldo: d.saldo_estimado,
        contas: d.contas_pendentes,
        mediaDiaria: d.media_diaria_vendas,
        hoje: dataLocalISO()
    });

    document.getElementById('caixa-saldo').innerText    = formatarMoeda(d.saldo_estimado);
    document.getElementById('caixa-pendente').innerText = formatarMoeda(plano.totalPendente);
    // Com as contas cobertas, o que sobra no saldo é lucro livre para retirar
    const faltando = plano.faltaTotal > 0;
    document.getElementById('caixa-falta-label').innerText = faltando ? 'Falta arrecadar' : 'Sobra (lucro livre)';
    document.getElementById('caixa-falta').innerText = formatarMoeda(faltando ? plano.faltaTotal : plano.sobra);
    document.getElementById('caixa-falta').style.color = faltando ? 'var(--color-red)' : 'var(--color-green)';

    const p = plano.proxima;
    if (plano.itens.length === 0) {
        destaque.className = 'caixa-destaque ok';
        destaque.innerHTML = 'Nenhuma conta pendente 🎉';
    } else if (!p) {
        destaque.className = 'caixa-destaque ok';
        destaque.innerHTML = `✅ O saldo cobre todas as contas pendentes. Sobram <strong>${formatarMoeda(plano.sobra)}</strong>.`;
    } else {
        const prazo = p.vencida || p.dias === 0
            ? 'esse valor <strong>hoje</strong>'
            : `cerca de <strong>${formatarMoeda(p.porDia)}/dia</strong> até <strong>${formatarDataBR(p.vencimento)}</strong>`;
        const ritmo = p.diasNoRitmo === null
            ? 'Sem vendas nos últimos 30 dias para estimar o ritmo.'
            : `No ritmo atual (${formatarMoeda(d.media_diaria_vendas)}/dia) você junta esse valor em ~${p.diasNoRitmo} dia(s)`
              + (p.status === 'no-ritmo' ? ' ✅ dá tempo.' : ' ⚠️ acima do prazo.');
        destaque.className = 'caixa-destaque ' + (p.status === 'no-ritmo' ? 'ok' : 'alerta');
        const fiado = d.a_receber > 0
            ? ` · Você também tem ${formatarMoeda(d.a_receber)} em fiado a receber (${d.a_receber_qtd} venda(s)).`
            : '';
        destaque.innerHTML = `Faltam <strong>${formatarMoeda(p.falta)}</strong> para pagar
            <strong>${p.descricao}</strong> (${formatarMoeda(p.valor)}, ${textoPrazo(p)}).
            Você precisa vender ${prazo}.<br><small>${ritmo}${fiado}</small>`;
    }

    tabela.style.display = plano.itens.length ? '' : 'none';
    tbody.innerHTML = plano.itens.slice(0, 8).map(i => {
        const s = SITUACOES[i.status];
        return `
            <tr>
                <td>${i.descricao}</td>
                <td>${formatarDataBR(i.vencimento)} <small class="caixa-prazo">${textoPrazo(i)}</small></td>
                <td>${formatarMoeda(i.valor)}</td>
                <td>${i.falta > 0 ? formatarMoeda(i.falta) : '—'}</td>
                <td>${i.falta > 0 ? formatarMoeda(i.porDia) : '—'}</td>
                <td><span class="badge ${s.classe}">${s.texto}</span></td>
            </tr>`;
    }).join('');
}

async function salvarSaldo(e) {
    e.preventDefault();
    const saldo = parseFloat(document.getElementById('caixa-saldo-input').value);
    if (!Number.isFinite(saldo)) return;
    await fetchJSON('/api/caixa/saldo', { method: 'PUT', body: JSON.stringify({ saldo }) });
    document.getElementById('caixa-saldo-input').blur();
    carregarMetaCaixa();
}
