// server.js
// Rotas de página:
//   /         → loja online (pública)
//   /p/:id    → loja já abrindo um produto (link para compartilhar)
//   /painel   → painel de gestão (pede a senha PAINEL_SENHA)
const express = require('express');
const path = require('path');
const { initDb } = require('./db/schema');
const auth = require('./lib/auth');
const loja = require('./routes/loja');
const { criarPublicador } = require('./lib/publicador');

function criarApp(pool) {
  const app = express();
  // Envia a vitrine para a Cloudflare (loja online). Desligado sem as variáveis CF_*.
  const publicador = criarPublicador(pool, loja.carregarVitrine);
  app.locals.publicador = publicador;
  app.set('trust proxy', 1); // Render fica atrás de proxy (https + IP do cliente)
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // API: tudo exige login, menos a vitrine (GET /api/loja/*) e /api/sessao
  app.use('/api', auth.protegerApi);
  // Qualquer alteração feita pelo painel (venda, compra, ajuste, foto...) zera
  // o cache da vitrine e manda a versão nova para a loja na Cloudflare.
  app.use('/api', (req, res, next) => {
    const alteracao = req.method !== 'GET' && req.method !== 'HEAD' && !req.path.startsWith('/sessao') &&
      !req.path.startsWith('/publicacao');
    if (alteracao) {
      res.on('finish', () => {
        loja.invalidarVitrine();
        if (res.statusCode < 400) publicador.agendar();
      });
    }
    next();
  });
  app.use('/api/produtos', express.json({ limit: '4mb' })); // fotos dos produtos
  app.use(express.json());

  app.use('/api/sessao',       auth.rotasSessao(express));
  app.use('/api/loja',         loja.rotasApi(pool));
  app.use('/api/dashboard',    require('./routes/dashboard')(pool));
  app.use('/api/produtos',     require('./routes/produtos')(pool));
  app.use('/api/vendas',       require('./routes/vendas')(pool));
  app.use('/api/compras',      require('./routes/compras')(pool));
  app.use('/api/contas-pagar', require('./routes/contas-pagar')(pool));
  app.use('/api/estoque',      require('./routes/estoque')(pool));
  app.use('/api/caixa',        require('./routes/caixa')(pool));
  app.use('/api/historico',    require('./routes/historico')(pool));

  // Situação da publicação na Cloudflare (tela "Loja Online" do painel)
  app.get('/api/publicacao', (req, res) => res.json(publicador.situacao()));
  app.post('/api/publicacao/agora', async (req, res) => {
    const r = await publicador.republicarTudo();
    res.status(r.ok ? 200 : 502).json({ ...r, ...publicador.situacao() });
  });

  app.get('/painel', (req, res) => {
    res.set('X-Frame-Options', 'DENY');
    res.set('Cache-Control', 'no-store');
    const pagina = auth.sessaoValida(req) ? 'painel.html' : 'entrar.html';
    res.sendFile(path.join(__dirname, 'views', pagina));
  });

  app.use(loja.rotasPaginas(pool));
  app.use(express.static(path.join(__dirname, 'public'), { index: false }));

  return app;
}

const app = criarApp(require('./db/pool'));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  if (!auth.senhaConfigurada()) {
    console.warn('ATENÇÃO: defina PAINEL_SENHA (mínimo 6 caracteres) para conseguir entrar no painel.');
  }
  initDb(require('./db/pool'))
    .then(() => app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      app.locals.publicador.publicar(); // garante a loja em dia após cada deploy
    }))
    .catch((err) => {
      console.error('Falha ao iniciar o banco de dados:', err);
      process.exit(1);
    });
}

module.exports = app;
module.exports.criarApp = criarApp;
