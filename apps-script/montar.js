// apps-script/montar.js — monta o painel do Google Apps Script a partir deste repositório.
//
// O painel do Apps Script usa as MESMAS telas do painel Node (views/painel.html +
// public/css + public/js), embutidas num único Index.html. Só muda o transporte:
// apps-script/utils-gas.js troca o fetch por google.script.run.
//
// Uso:  node apps-script/montar.js        → gera apps-script/dist/ (pasta do clasp)
//       cd apps-script && clasp -u pessoal push
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const dist = path.join(__dirname, 'dist');
const ler = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');

function montarIndex() {
  let html = ler(raiz, 'views', 'painel.html');

  // Comentário da 1ª linha, ícone e "Sair" só fazem sentido no painel Node
  // (o Apps Script já só abre para o dono da conta Google).
  html = html.replace(/^<!--[^\n]*-->\n/, '');
  html = html.replace(/\n\s*<link rel="icon"[^>]*>/, '');
  html = html.replace(/\n\s*<button class="btn-tema" onclick="sairDoPainel\(\)">[^\n]*<\/button>/, '');

  const css = ler(raiz, 'public', 'css', 'style.css').trimEnd() + '\n\n' + ler(__dirname, 'extra.css');
  html = html.replace('    <link rel="stylesheet" href="/css/style.css">', () => `    <style>\n${css}\n</style>`);
  html = html.replace('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>');

  html = html.replace(/<script src="\/js\/([\w-]+\.js)"><\/script>/g, (_, nome) => {
    // utils-gas.js termina com quebra de linha; os de public/js não (mantém o formato do build original)
    const codigo = nome === 'utils.js' ? ler(__dirname, 'utils-gas.js').replace(/\n$/, '') : ler(raiz, 'public', 'js', nome);
    return `<script>\n// ${nome}\n${codigo}\n</script>`;
  });

  const sobra = html.match(/<(link|script)[^>]+(href|src)="\/[^"]*"/);
  if (sobra) throw new Error('Referência local que o Apps Script não consegue carregar: ' + sobra[0]);
  return html;
}

function montar() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const arq of fs.readdirSync(path.join(__dirname, 'src'))) {
    let conteudo = ler(__dirname, 'src', arq);
    if (arq === 'Codigo.js') conteudo = conteudo.trimEnd() + `\n\n// build ${new Date().toISOString()}\n`;
    fs.writeFileSync(path.join(dist, arq), conteudo);
  }
  fs.writeFileSync(path.join(dist, 'Index.html'), montarIndex());
  console.log('Painel do Apps Script montado em apps-script/dist');
}

if (require.main === module) montar();
module.exports = { montarIndex, montar };
