// public/js/historico.js
// Tela "Histórico da Loja": números de longo prazo, acerto de estoque das
// vendas antigas, saldo atual e cálculos salvos (auditoria).

let produtosHistorico = [];
let entradasAcerto = {};

const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const moedaOuTraco = (v) => (v === null || v === undefined ? '—' : formatarMoeda(v));

async function carregarHistorico() {
    const [hist, caixa, produtos] = await Promise.all([
        fetchJSON('/api/historico'),
        fetchJSON('/api/caixa'),
        fetchJSON('/api/produtos')
    ]);

    renderResumoHistorico(hist);
    renderCalculosSalvos(hist.calculos);

    // Saldo atual
    const inputSaldo = document.getElementById('hist-saldo-input');
    if (document.activeElement !== inputSaldo && caixa.saldo_estimado !== null) {
        inputSaldo.value = caixa.saldo_estimado.toFixed(2);
    }
    document.getElementById('hist-saldo-info').innerText = caixa.saldo_informado === null
        ? 'Ainda não informado. Digite quanto tem hoje na conta da loja.'
        : `Saldo estimado agora: ${formatarMoeda(caixa.saldo_estimado)} (informado em ${fmtDataHora(caixa.saldo_atualizado_em)}). ` +
          'Vendas e compras antigas não mexem nesse valor.';

    // Acerto de estoque: só produtos que ainda têm estoque no sistema
    const corte = document.getElementById('hist-data-corte');
    if (!corte.value) corte.value = fimDoMesAnterior();
    corte.max = dataLocalISO();
    produtosHistorico = produtos.filter(p => p.quantidade > 0);
    entradasAcerto = {};
    renderAcerto();
}

function renderResumoHistorico({ atual, ultimo }) {
    const info = document.getElementById('hist-ultimo-info');
    const aviso = document.getElementById('hist-aviso');
    const d = ultimo ? ultimo.dados : null;

    if (!d) {
        info.innerText = 'Nenhum cálculo salvo ainda. Monte o histórico seguindo os passos abaixo e clique em "Calcular histórico".';
        aviso.innerHTML = '';
    } else {
        const desde = d.desde ? ` · Loja desde ${new Date(d.desde).toLocaleDateString('pt-BR')}` : '';
        info.innerText = `Último cálculo salvo em ${fmtDataHora(ultimo.data)}${desde}`;
        const mudou = ['lucro_total', 'investido_total', 'faturamento_total', 'estoque_valor_custo', 'saldo_conta']
            .some(k => Math.abs((atual[k] || 0) - (d[k] || 0)) > 0.005);
        aviso.className = 'caixa-destaque';
        aviso.innerHTML = mudou
            ? `Os números mudaram desde o último cálculo (lucro total agora: <strong>${formatarMoeda(atual.lucro_total)}</strong>). Clique em <strong>🧮 Calcular histórico</strong> para salvar.`
            : '';
    }

    // Os cards mostram o cálculo SALVO (valor fixo, não temporário)
    const set = (id, v) => document.getElementById(id).innerText = d ? moedaOuTraco(v) : '--';
    set('hist-lucro', d && d.lucro_total);
    set('hist-faturamento', d && d.faturamento_total);
    set('hist-investido', d && d.investido_total);
    set('hist-estoque', d && d.estoque_valor_custo);
    set('hist-saldo', d && d.saldo_conta);
    set('hist-retirado', d && d.retirado_estimado);

    document.getElementById('hist-detalhe').innerHTML = !d ? '' : `
        <span>Lucro das vendas antigas: <strong>${formatarMoeda(d.lucro_vendas_antigas)}</strong></span>
        <span>Lucro das vendas no sistema: <strong>${formatarMoeda(d.lucro_vendas_sistema)}</strong></span>
        <span>Margem: <strong>${d.margem.toFixed(1)}%</strong></span>
        <span>Unidades vendidas: <strong>${d.unidades_vendidas}</strong></span>
        <span>Em estoque: <strong>${d.estoque_unidades} un</strong></span>
        <span title="Vendas recebidas − compras pagas − contas pagas − saldo atual">
            Entrou ${formatarMoeda(d.dinheiro_entrou)} · saiu ${formatarMoeda(d.dinheiro_saiu)}</span>`;
}

function renderCalculosSalvos(calculos) {
    const tbody = document.getElementById('hist-calculos-lista');
    if (!calculos.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Nenhum cálculo salvo ainda.</td></tr>`;
        return;
    }
    tbody.innerHTML = calculos.map(c => `
        <tr>
            <td>${fmtDataHora(c.data)}</td>
            <td style="color: var(--color-green);"><strong>${formatarMoeda(c.dados.lucro_total)}</strong></td>
            <td>${formatarMoeda(c.dados.faturamento_total)}</td>
            <td>${formatarMoeda(c.dados.investido_total)}</td>
            <td>${formatarMoeda(c.dados.estoque_valor_custo)}</td>
            <td>${moedaOuTraco(c.dados.saldo_conta)}</td>
            <td>${moedaOuTraco(c.dados.retirado_estimado)}</td>
        </tr>`).join('');
}

async function calcularHistorico() {
    const calc = await fetchJSON('/api/historico/calcular', { method: 'POST' });
    await carregarHistorico();
    alert(`Histórico calculado e salvo em ${fmtDataHora(calc.data)}.\nLucro total da loja: ${formatarMoeda(calc.dados.lucro_total)}`);
}

// ---------- Acerto de estoque ----------
function renderAcerto() {
    const tbody = document.getElementById('hist-acerto-lista');
    if (!produtosHistorico.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Nenhum produto com estoque no sistema. Cadastre as compras antigas primeiro.</td></tr>`;
        atualizarAcerto();
        return;
    }
    tbody.innerHTML = produtosHistorico.map(p => `
        <tr>
            <td><strong>${p.nome}</strong></td>
            <td>${p.quantidade} un</td>
            <td><input type="number" min="0" step="1" class="input-tabela" placeholder="${p.quantidade}"
                       oninput="mudarAcerto(${p.id}, 'real', this.value)"></td>
            <td id="hist-vend-${p.id}">—</td>
            <td><input type="number" min="0" step="0.01" class="input-tabela" id="hist-preco-${p.id}"
                       value="${p.preco > 0 ? Number(p.preco).toFixed(2) : ''}" placeholder="sem preço"
                       oninput="mudarAcerto(${p.id}, 'preco', this.value)"></td>
            <td id="hist-total-${p.id}">—</td>
            <td id="hist-lucro-${p.id}">—</td>
        </tr>`).join('');
    atualizarAcerto();
}

function mudarAcerto(id, campo, valor) {
    entradasAcerto[id] = { ...(entradasAcerto[id] || {}), [campo]: valor };
    atualizarAcerto();
}

function atualizarAcerto() {
    const r = calcularAcertoEstoque(produtosHistorico, entradasAcerto);
    r.linhas.forEach(l => {
        const vend = document.getElementById(`hist-vend-${l.produto_id}`);
        if (!vend) return;
        const preco = document.getElementById(`hist-preco-${l.produto_id}`);
        const total = document.getElementById(`hist-total-${l.produto_id}`);
        const lucro = document.getElementById(`hist-lucro-${l.produto_id}`);
        vend.innerHTML = l.sobra > 0
            ? `<span style="color: var(--color-orange);">+${l.sobra} a mais que o sistema</span>`
            : l.vendidas > 0 ? `<strong>${l.vendidas} un</strong>` : '—';
        preco.classList.toggle('input-alerta', l.semValor);
        total.innerText = l.vendidas > 0 && !l.semValor ? formatarMoeda(l.valor) : '—';
        lucro.innerText = l.vendidas > 0 && !l.semValor ? formatarMoeda(l.lucro) : '—';
        lucro.style.color = l.lucro < 0 ? 'var(--color-red)' : 'var(--color-green)';
    });

    const t = r.totais;
    const totalEl = document.getElementById('hist-acerto-total');
    if (t.unidades === 0) {
        totalEl.innerHTML = 'Nenhuma venda antiga informada.';
    } else if (t.semValor > 0) {
        // Enquanto faltar preço, os totais ficariam errados: mostra só o aviso
        totalEl.innerHTML = `<strong>${t.unidades} un</strong> vendidas antes<br>` +
            `<span style="color: var(--color-orange);">⚠️ ${t.semValor} produto(s) sem preço de venda. Informe o preço aqui ou em Estoque da Loja → Editar.</span>`;
    } else {
        totalEl.innerHTML = `<strong>${t.unidades} un</strong> vendidas antes · recebido ${formatarMoeda(t.valor)} · lucro <strong>${formatarMoeda(t.lucro)}</strong>`;
    }
    document.getElementById('btn-vendas-antigas').disabled = t.unidades === 0 || t.semValor > 0;
}

async function registrarVendasAntigas() {
    const r = calcularAcertoEstoque(produtosHistorico, entradasAcerto);
    const data = document.getElementById('hist-data-corte').value;
    if (!data) return alert('Informe a data das vendas antigas.');
    if (!r.itens.length) return;

    const dataBR = new Date(data + 'T00:00:00').toLocaleDateString('pt-BR');
    if (!confirm(`Registrar ${r.totais.unidades} unidade(s) vendida(s) até ${dataBR}, ` +
                 `recebendo ${formatarMoeda(r.totais.valor)} (lucro ${formatarMoeda(r.totais.lucro)})?\n\n` +
                 'O estoque será baixado e as vendas vão para o histórico, sem mexer no saldo atual. ' +
                 'Produtos sem preço de venda cadastrado passam a usar o preço informado aqui.')) return;

    try {
        await fetchJSON('/api/historico/vendas-antigas', {
            method: 'POST',
            body: JSON.stringify({ data, itens: r.itens })
        });
    } catch (e) {
        return alert('Erro ao registrar vendas antigas: ' + e.message);
    }
    await carregarHistorico();
    alert('Vendas antigas registradas! Agora confira o saldo e clique em "Calcular histórico".');
}

async function salvarSaldoHistorico(e) {
    e.preventDefault();
    const saldo = parseFloat(document.getElementById('hist-saldo-input').value);
    if (!Number.isFinite(saldo)) return;
    await fetchJSON('/api/caixa/saldo', { method: 'PUT', body: JSON.stringify({ saldo }) });
    document.getElementById('hist-saldo-input').blur();
    carregarHistorico();
}
