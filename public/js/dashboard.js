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
                legend: { labels: { color: '#F8FAFC' } },
                tooltip: {
                    callbacks: {
                        // Formatar valor no tooltip como moeda BRL
                        label: (ctx) => `${ctx.dataset.label}: ${formatarMoeda(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#94A3B8' },
                    grid:  { color: 'rgba(148,163,184,0.1)' }
                },
                y: {
                    ticks: {
                        color: '#94A3B8',
                        // Mostrar valores do eixo como R$ abreviado (R$ 1.2k, R$ 3M)
                        callback: (v) => {
                            if (v >= 1000000) return 'R$ ' + (v/1000000).toFixed(1) + 'M';
                            if (v >= 1000)    return 'R$ ' + (v/1000).toFixed(1) + 'k';
                            return 'R$ ' + v;
                        }
                    },
                    grid: { color: 'rgba(148,163,184,0.1)' }
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

async function carregarCotacao() {
  const elUsd = document.getElementById('cotacao-usd');
  const elEur = document.getElementById('cotacao-eur');
  const elVarUsd = document.getElementById('variacao-usd');
  const elVarEur = document.getElementById('variacao-eur');
  const cardUsd = elUsd.closest('.cotacao-card');
  const cardEur = elEur.closest('.cotacao-card');

  // Estado de carregamento
  elUsd.textContent = '...';
  elEur.textContent = '...';
  elVarUsd.textContent = '';
  elVarEur.textContent = '';
  cardUsd.classList.remove('erro');
  cardEur.classList.remove('erro');

  try {
    console.log('[Cotação] Buscando /api/cotacao...');
    const res = await fetch('/api/cotacao');
    console.log('[Cotação] Status:', res.status);

    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }

    const data = await res.json();
    console.log('[Cotação] Dados recebidos:', data);

    // USD
    elUsd.textContent = 'R$ ' + data.usd.valor.toFixed(2);
    const sinalUsd = data.usd.variacao >= 0 ? '▲' : '▼';
    elVarUsd.textContent = sinalUsd + ' ' + Math.abs(data.usd.variacao).toFixed(2) + '%';

    // EUR
    elEur.textContent = 'R$ ' + data.eur.valor.toFixed(2);
    const sinalEur = data.eur.variacao >= 0 ? '▲' : '▼';
    elVarEur.textContent = sinalEur + ' ' + Math.abs(data.eur.variacao).toFixed(2) + '%';

  } catch (err) {
    console.error('[Cotação] Erro:', err);
    elUsd.textContent = 'indisponível';
    elEur.textContent = 'indisponível';
    elVarUsd.textContent = '';
    elVarEur.textContent = '';
    cardUsd.classList.add('erro');
    cardEur.classList.add('erro');
  }
}

// Carrega ao abrir + a cada 5 min
carregarCotacao();
setInterval(carregarCotacao, 5 * 60 * 1000);

// Botão de recarregar manual
document.getElementById('btn-recarregar-cotacao')
  ?.addEventListener('click', carregarCotacao);