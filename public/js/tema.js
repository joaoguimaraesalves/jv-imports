// public/js/tema.js
// Alternância entre tema escuro (padrão) e claro, salvo em localStorage.
// O tema inicial é aplicado por um script inline no <head> (evita "flash").

function temaAtual() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function atualizarBotaoTema() {
    const claro = temaAtual() === 'light';
    const icone = document.getElementById('tema-icone');
    const texto = document.getElementById('tema-texto');
    if (icone) icone.textContent = claro ? '☀️' : '🌙';
    if (texto) texto.textContent = claro ? 'Modo Claro' : 'Modo Escuro';
}

function alternarTema() {
    const novo = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    try { localStorage.setItem('jv-tema', novo); } catch (e) { /* storage indisponível */ }
    atualizarBotaoTema();

    // Redesenha o gráfico para aplicar as cores do novo tema
    const dashboardAtivo = document.getElementById('tela-dashboard')?.classList.contains('active');
    if (dashboardAtivo && typeof desenharGrafico === 'function') desenharGrafico();
}

atualizarBotaoTema();
