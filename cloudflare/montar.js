// cloudflare/montar.js — monta a loja para a Cloudflare Pages (comando de build).
// Usa os MESMOS arquivos da loja do Render (views/loja.html e public/loja/*),
// então qualquer ajuste visual vale para os dois lugares.
//
// Cloudflare Pages: diretório raiz "cloudflare", build "node montar.js", saída "dist".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');
const dist = path.join(__dirname, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'loja'), { recursive: true });

// Arquivos estáticos (css, js, imagens)
for (const arq of fs.readdirSync(path.join(raiz, 'public', 'loja'))) {
  fs.copyFileSync(path.join(raiz, 'public', 'loja', arq), path.join(dist, 'loja', arq));
}

// Modelo da página. CSS e JS ganham ?v=<hash> para o navegador pegar a versão
// nova logo após cada deploy, mesmo com cache longo.
const hash = (arq) => crypto.createHash('sha1').update(fs.readFileSync(path.join(dist, 'loja', arq))).digest('hex').slice(0, 10);
const modelo = fs.readFileSync(path.join(raiz, 'views', 'loja.html'), 'utf8')
  .replace('/loja/loja.css"', `/loja/loja.css?v=${hash('loja.css')}"`)
  .replace('/loja/loja.js"', `/loja/loja.js?v=${hash('loja.js')}"`);
fs.writeFileSync(path.join(dist, '_modelo.html'), modelo);

fs.writeFileSync(path.join(dist, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/loja/*
  Cache-Control: public, max-age=86400

/_modelo*
  X-Robots-Tag: noindex
`);

console.log('Loja montada em cloudflare/dist');
