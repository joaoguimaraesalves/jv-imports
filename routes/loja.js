// routes/loja.js
// Vitrine pública: lê direto da tabela de produtos, então toda venda,
// compra ou ajuste feito no painel aparece no site sozinho.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { montarVitrine, configDeLinhas, normalizarConfig, escaparHtml } = require('../lib/loja');
const { sessaoValida } = require('../lib/auth');

const CACHE_MS = 10 * 1000;     // segura picos de acesso sem martelar o banco
const DIAS_MAIS_VENDIDO = 90;

// Express 4 não captura erro de função async: sem isso o pedido ficaria pendurado
const seguro = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('Loja:', e);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
});

let cache = null; // { quando, dados }
function invalidarVitrine() { cache = null; }

async function lerConfig(pool) {
  const { rows } = await pool.query(`SELECT chave, valor FROM configuracoes WHERE chave LIKE 'loja_%'`);
  return configDeLinhas(rows);
}

// fresca = ignora o cache (usado ao publicar na Cloudflare)
async function carregarVitrine(pool, { fresca = false } = {}) {
  if (!fresca && cache && Date.now() - cache.quando < CACHE_MS) return cache.dados;
  const corte = new Date(Date.now() - DIAS_MAIS_VENDIDO * 864e5).toISOString();
  const [produtos, vendidos, config] = await Promise.all([
    pool.query(`
      SELECT p.id, p.nome, p.preco, p.preco_antigo, p.quantidade, p.descricao,
             p.categoria, p.na_loja, p.destaque, f.atualizado_em AS foto_em
      FROM produtos p
      LEFT JOIN produto_fotos f ON f.produto_id = p.id`),
    pool.query(`
      SELECT produto_id, SUM(quantidade) AS total
      FROM vendas
      WHERE produto_id IS NOT NULL AND data >= $1
      GROUP BY produto_id`, [corte]),
    lerConfig(pool),
  ]);
  const dados = {
    loja: {
      whatsapp: config.whatsapp,
      instagram: config.instagram,
      aviso: config.aviso,
      pagamento: config.pagamento,
      entrega: config.entrega,
    },
    produtos: montarVitrine(produtos.rows, vendidos.rows, config),
    atualizado_em: new Date().toISOString(),
  };
  cache = { quando: Date.now(), dados };
  return dados;
}

// API: /api/loja
function rotasApi(pool) {
  const router = express.Router();

  // Usado pelo "despertador" (GitHub Actions) para o Render não dormir.
  // Não toca no banco, para não gastar as horas grátis do Neon.
  router.get('/saude', (req, res) => res.json({ ok: true }));

  router.get('/produtos', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await carregarVitrine(pool));
    } catch (e) {
      console.error('Vitrine:', e);
      res.status(500).json({ error: 'Não foi possível carregar os produtos agora' });
    }
  });

  router.get('/foto/:id', seguro(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).end();
    const { rows } = await pool.query(
      `SELECT f.tipo, f.dados, p.na_loja FROM produto_fotos f
       JOIN produtos p ON p.id = f.produto_id
       WHERE f.produto_id = $1`, [id]);
    // Produto oculto: a foto só aparece para quem está logado no painel
    const publico = rows[0] && rows[0].na_loja;
    if (!rows[0] || (!publico && !sessaoValida(req))) return res.status(404).end();
    res.set('Content-Type', rows[0].tipo);
    res.set('Cache-Control', !publico ? 'private, no-store'
      : req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    res.send(rows[0].dados);
  }));

  // Configuração (o GET é público; salvar exige login — ver lib/auth.js)
  router.get('/config', seguro(async (req, res) => {
    res.json(await lerConfig(pool));
  }));

  router.put('/config', seguro(async (req, res) => {
    const novos = normalizarConfig(req.body || {});
    const agora = new Date().toISOString();
    for (const [campo, valor] of Object.entries(novos)) {
      await pool.query(
        `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ($1, $2, $3)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = EXCLUDED.atualizado_em`,
        ['loja_' + campo, valor, agora]);
    }
    invalidarVitrine();
    res.json({ ok: true, config: await lerConfig(pool) });
  }));

  return router;
}

// Páginas: "/" (vitrine) e "/p/:id" (mesma vitrine, já abrindo o produto).
// O /p/:id monta as tags de prévia (foto, nome e preço) para quando o link
// for compartilhado no WhatsApp/Instagram.
function rotasPaginas(pool) {
  const router = express.Router();
  const arquivo = path.join(__dirname, '..', 'views', 'loja.html');
  let modelo = null;
  const lerModelo = () => (modelo && process.env.NODE_ENV === 'production') ? modelo : (modelo = fs.readFileSync(arquivo, 'utf8'));

  const urlBase = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const moeda = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  function render(req, res, og) {
    const base = urlBase(req);
    const html = lerModelo()
      .replaceAll('__OG_TITULO__', escaparHtml(og.titulo))
      .replaceAll('__OG_DESCRICAO__', escaparHtml(og.descricao))
      .replaceAll('__OG_IMAGEM__', escaparHtml(base + og.imagem))
      .replaceAll('__OG_URL__', escaparHtml(base + og.caminho))
      .replaceAll('__PRODUTO_INICIAL__', og.produtoId ? String(og.produtoId) : '');
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }

  const OG_LOJA = {
    titulo: 'JV Imports — Tecnologia importada com preço justo',
    descricao: 'Fones, carregadores e acessórios importados. Estoque atualizado em tempo real — escolha e peça pelo WhatsApp.',
    imagem: '/loja/logo-600.jpg',
    caminho: '/',
  };

  // Com a loja na Cloudflare (SITE_URL), quem abrir o endereço antigo do
  // Render é levado para o endereço novo. O painel (/painel) continua aqui.
  router.use((req, res, next) => {
    const site = process.env.SITE_URL;
    if (!site || (req.path !== '/' && !req.path.startsWith('/p/'))) return next();
    try {
      if (new URL(site).host !== req.get('host')) return res.redirect(301, site.replace(/\/$/, '') + req.originalUrl);
    } catch (e) { /* SITE_URL inválida: segue servindo aqui */ }
    next();
  });

  router.get('/', (req, res) => render(req, res, OG_LOJA));

  router.get('/p/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const dados = Number.isInteger(id) ? await carregarVitrine(pool) : null;
      const p = dados && dados.produtos.find(x => x.id === id);
      if (!p) return render(req, res, OG_LOJA);
      render(req, res, {
        titulo: `${p.nome} — ${moeda(p.preco)} | JV Imports`,
        descricao: (p.disponivel ? 'Disponível agora. ' : 'Sob encomenda. ') +
          (p.descricao ? p.descricao.slice(0, 140) : 'Peça pelo WhatsApp na JV Imports.'),
        imagem: p.foto || OG_LOJA.imagem,
        caminho: `/p/${p.id}`,
        produtoId: p.id,
      });
    } catch (e) {
      console.error('Página do produto:', e);
      render(req, res, OG_LOJA);
    }
  });

  return router;
}

module.exports = { rotasApi, rotasPaginas, invalidarVitrine, carregarVitrine };
