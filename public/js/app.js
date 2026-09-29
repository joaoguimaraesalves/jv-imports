// public/js/app.js
function mudarTela(nomeTela) {
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.menu-list li').forEach(m => m.classList.remove('active'));
    document.getElementById(`tela-${nomeTela}`).classList.add('active');
    document.getElementById(`menu-${nomeTela}`).classList.add('active');

    fecharMenu();

    if (nomeTela === 'dashboard')    atualizarDashboardCompleto();
    if (nomeTela === 'produtos')     carregarProdutos();
    if (nomeTela === 'vendas')       carregarVendas();
    if (nomeTela === 'compras')      carregarCompras();
    if (nomeTela === 'contas-pagar') carregarContasPagar();
    if (nomeTela === 'movimentos')   carregarMovimentos();
    if (nomeTela === 'historico')    carregarHistorico();
}

// Menu lateral no celular (gaveta)
function abrirMenu()  { document.body.classList.add('menu-aberto'); }
function fecharMenu() { document.body.classList.remove('menu-aberto'); }

// Inicialização
atualizarDashboardCompleto();
carregarParaDropdown();