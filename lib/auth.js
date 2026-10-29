// lib/auth.js
// Login do painel com uma senha única (variável de ambiente PAINEL_SENHA).
// Sem dependências: a sessão é um cookie assinado com HMAC ("expira.assinatura").
// Trocar a senha no Render derruba todas as sessões abertas.
const crypto = require('crypto');

const COOKIE = 'jv_sessao';
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Rotas da API que não pedem login (a vitrine pública e o próprio login)
function rotaPublica(req) {
  const caminho = req.path; // relativo a /api
  if (caminho.startsWith('/sessao')) return true;
  if (caminho.startsWith('/loja/') && (req.method === 'GET' || req.method === 'HEAD')) return true;
  return false;
}

function senhaConfigurada() {
  return !!(process.env.PAINEL_SENHA && process.env.PAINEL_SENHA.length >= 6);
}

function segredo() {
  return process.env.SESSAO_SEGREDO ||
    crypto.createHash('sha256').update('jv-imports:' + (process.env.PAINEL_SENHA || '')).digest('hex');
}

function assinar(texto) {
  return crypto.createHmac('sha256', segredo()).update(texto).digest('base64url');
}

function iguais(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function sessaoValida(req) {
  if (!senhaConfigurada()) return false;
  const token = lerCookie(req, COOKIE);
  if (!token) return false;
  const [expira, assinatura] = token.split('.');
  if (!expira || !assinatura || !iguais(assinar(expira), assinatura)) return false;
  return Number(expira) > Date.now();
}

function gravarCookie(req, res, valor, maxAgeMs) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(valor)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

// Freio simples contra chute de senha: 8 tentativas erradas a cada 15 min por IP
const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;

function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t || t.ate < Date.now()) return false;
  return t.erros >= MAX_TENTATIVAS;
}

function registrarErro(ip) {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || t.ate < agora) tentativas.set(ip, { erros: 1, ate: agora + JANELA_MS });
  else t.erros++;
}

// Middleware: protege tudo em /api, menos as rotas públicas
function protegerApi(req, res, next) {
  if (rotaPublica(req) || sessaoValida(req)) return next();
  res.status(401).json({ error: 'Faça login no painel' });
}

// Rotas /api/sessao: status, entrar e sair
function rotasSessao(express) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ logado: sessaoValida(req), configurada: senhaConfigurada() });
  });

  router.post('/entrar', (req, res) => {
    if (!senhaConfigurada()) {
      return res.status(503).json({
        error: 'A senha do painel ainda não foi definida. Crie a variável PAINEL_SENHA (mínimo 6 caracteres) no Render.',
      });
    }
    const ip = req.ip || 'desconhecido';
    if (bloqueado(ip)) {
      return res.status(429).json({ error: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.' });
    }
    const senha = req.body && req.body.senha;
    if (!senha || !iguais(senha, process.env.PAINEL_SENHA)) {
      registrarErro(ip);
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    tentativas.delete(ip);
    const expira = String(Date.now() + DURACAO_MS);
    gravarCookie(req, res, `${expira}.${assinar(expira)}`, DURACAO_MS);
    res.json({ ok: true });
  });

  router.post('/sair', (req, res) => {
    gravarCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { protegerApi, rotasSessao, sessaoValida, senhaConfigurada, rotaPublica, _tentativas: tentativas };
