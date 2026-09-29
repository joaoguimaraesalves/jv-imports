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
        carregarProximasContas()
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
    document.getElementById('val-despesas').innerText = formatarMoeda(d.despesas_totais);
    document.getElementById('val-vendas').innerText   = formatarMoeda(d.total_vendas);
    document.getElementById('val-qtd').innerText      = d.qtd_vendida;
    document.getElementById('val-ticket').innerText   = formatarMoeda(d.ticket_medio);
    document.getElementById('val-custos').innerText   = formatarMoeda(d.custos);
    document.getElementById('val-margem').innerText   = d.margem + '%';
}

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

async function desenharGrafico() {
    const { vendas, saidas, contas } = await fetchJSON(
        `/api/dashboard/grafico?periodo=${estadoDashboard.periodo}&agrupar=${estadoDashboard.agrupar}`
    );

    // Junta tudo num dicionário indexado por período (ex: "2026-04-22" ou "2026-04")
    const porPeriodo = {};
    const garantir = (p) => { if (!porPeriodo[p]) porPeriodo[p] = { faturamento: 0, custo: 0, gastos: 0 }; };

    vendas.forEach(v => { garantir(v.periodo); porPeriodo[v.periodo].faturamento += v.faturamento; porPeriodo[v.periodo].custo += v.custo; });
    saidas.forEach(s => { garantir(s.periodo); porPeriodo[s.periodo].gastos += s.gastos; });
    contas.forEach(c => { garantir(c.periodo); porPeriodo[c.periodo].gastos += c.pagas; });

    const periodos     = Object.keys(porPeriodo).sort();
    const faturamentos = periodos.map(p => porPeriodo[p].faturamento);
    const lucros       = periodos.map(p => porPeriodo[p].faturamento - porPeriodo[p].custo - porPeriodo[p].gastos);
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
                { label: 'Faturamento',   data: faturamentos, backgroundColor: '#3B82F6', borderRadius: 4 },
                { label: 'Lucro Líquido', data: lucros,       backgroundColor: '#10B981', borderRadius: 4 },
                { label: 'Despesas',      data: gastos,       backgroundColor: '#EF4444', borderRadius: 4 }
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
                    ticks: { color: cores.suave },
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
