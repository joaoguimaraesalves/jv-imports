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

function doGet(e) {
  // Volta da autorização da Nuvemshop (URL de redirecionamento do app = este link /exec)
  if (e && e.parameter && e.parameter.code) {
    let msg;
    try { msg = '✅ ' + nsReceberCodigo_(e.parameter); } catch (err) { msg = '⚠️ ' + err.message; }
    const html = '<div style="font-family:sans-serif;max-width:560px;margin:40px auto;line-height:1.5">' +
      '<h2>Nuvemshop</h2><p>' + String(msg).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) +
      '</p><p>Pode fechar esta aba e voltar ao painel (tela Loja Online).</p></div>';
    return HtmlService.createHtmlOutput(html).setTitle('JV Imports - Nuvemshop');
  }
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

