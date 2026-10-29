// public/js/utils.js
const formatarMoeda = (valor) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

// Versão Apps Script: em vez de HTTP, chama a função api() do servidor com
// google.script.run. As telas continuam usando as mesmas URLs (/api/...).
// Enquanto houver chamada em andamento aparece uma barrinha no topo; enquanto algo
// estiver sendo gravado a tela fica bloqueada (evita salvar duas vezes com clique duplo).
const chamadas = { total: 0, gravando: 0 };

function atualizarIndicador() {
    document.body.classList.toggle('carregando', chamadas.total > 0);
    document.body.classList.toggle('gravando', chamadas.gravando > 0);
}

// Loja online: depois de cada gravação, manda o estoque novo para o site (Cloudflare).
// Roda em segundo plano no servidor; a tela não espera. Várias gravações seguidas
// viram uma publicação só (ver publicarLoja_ em Loja.js).
function publicarLojaEmSegundoPlano() {
    google.script.run
        .withSuccessHandler(() => {})
        .withFailureHandler(() => {}) // a tela "Loja Online" mostra se a última publicação falhou
        .publicarLojaAgora();
}

function fetchJSON(url, options = {}) {
    const metodo = (options.method || 'GET').toUpperCase();
    const corpo = options.body ? JSON.parse(options.body) : null;
    const grava = metodo !== 'GET';
    chamadas.total++;
    if (grava) chamadas.gravando++;
    atualizarIndicador();
    const fim = () => {
        chamadas.total--;
        if (grava) chamadas.gravando--;
        atualizarIndicador();
    };
    return new Promise((resolve, reject) => {
        google.script.run
            .withSuccessHandler(texto => {
                fim();
                if (grava && !url.startsWith('/api/publicacao')) publicarLojaEmSegundoPlano();
                resolve(JSON.parse(texto));
            })
            .withFailureHandler(e => {
                fim();
                // Mostra a mensagem do servidor (ex.: "só há 3 no estoque")
                const msg = (e && e.message ? e.message : String(e)).replace(/^Error:\s*/, '');
                const erro = new Error(msg);
                erro.doServidor = true;
                reject(erro);
            })
            .api(metodo, url, corpo);
    });
}

// Erro do servidor que a tela não tratou: mostra a mensagem em vez de falhar em silêncio.
window.addEventListener('unhandledrejection', (ev) => {
    if (ev.reason && ev.reason.doServidor) {
        ev.preventDefault();
        alert('Não foi possível concluir: ' + ev.reason.message);
    }
});

function abrirModal(id)  { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }

// Exclusão genérica compartilhada por produtos, vendas e saídas
async function excluirRegistro(tabela, id, callbackAtualizar) {
    if (!confirm('Tem certeza que deseja excluir? Se for uma venda, o produto voltará para o estoque.')) return;
    await fetchJSON(`/api/${tabela}/${id}`, { method: 'DELETE' });
    callbackAtualizar();
    carregarDashboard();
    desenharGrafico();
    if (typeof carregarParaDropdown === 'function') carregarParaDropdown();
}
