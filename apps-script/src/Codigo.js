/**
 * JV Imports — versão Google Apps Script.
 *
 * Mesmo sistema da versão Node/Express (github.com/joaoguimaraesalves/jv-imports), com a
 * planilha do Google no lugar do PostgreSQL. As telas são as mesmas; só o transporte
 * mudou (google.script.run em vez de fetch).
 *
 * Arquivos: Banco.js (planilha como banco), Rotas.js (as rotas /api), Financeiro.js
 * (saldo e histórico) e Index.html (gerado pelo build a partir da pasta public/).
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('JV Imports - Gestão')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/** Rode uma vez pelo editor: cria a planilha do banco e mostra o link no registro. */
function configurar() {
  const ss = planilha_();
  Object.keys(ESQUEMA).forEach(function (nome) { prepararAba_(ss, nome); });
  Logger.log('Banco de dados: ' + ss.getUrl());
}

/** Link da planilha do banco (para abrir e conferir os dados). */
function linkBanco() {
  return planilha_().getUrl();
}

