// lib/loja.js
// Regras da vitrine pública (site da loja). Funções puras, sem banco,
// para dar pra testar sem Postgres.

// Configurações da loja ficam na tabela "configuracoes" com o prefixo "loja_"
const CONFIG_PADRAO = {
  whatsapp: '',            // só números, com DDI: 5561999999999
  instagram: '',           // sem @
  aviso: '',               // faixa no topo do site (ex.: "Frete grátis em Taguatinga")
  pagamento: 'Pix, cartão de crédito ou dinheiro',
  entrega: 'Entrega combinada pelo WhatsApp ou retirada',
  mostrar_esgotados: 'sim', // "sim" mostra esgotados com botão de encomenda
};

const CAMPOS_CONFIG = Object.keys(CONFIG_PADRAO);

function limparWhatsapp(valor) {
  let n = String(valor || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.length === 10 || n.length === 11) n = '55' + n; // digitou só DDD + número
  return n;
}

function limparInstagram(valor) {
  return String(valor || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .slice(0, 60);
}

// Normaliza o que vem do formulário do painel
function normalizarConfig(entrada = {}) {
  const c = {};
  for (const campo of CAMPOS_CONFIG) {
    if (entrada[campo] === undefined) continue;
    let v = String(entrada[campo] ?? '').trim().slice(0, 300);
    if (campo === 'whatsapp') v = limparWhatsapp(v);
    if (campo === 'instagram') v = limparInstagram(v);
    if (campo === 'mostrar_esgotados') v = v === 'nao' ? 'nao' : 'sim';
    c[campo] = v;
  }
  return c;
}

// Linhas da tabela configuracoes → objeto de config da loja
function configDeLinhas(linhas = []) {
  const c = { ...CONFIG_PADRAO };
  for (const { chave, valor } of linhas) {
    const campo = String(chave).replace(/^loja_/, '');
    if (CAMPOS_CONFIG.includes(campo) && valor !== null) c[campo] = valor;
  }
  return c;
}

// Monta a lista pública. Nunca expõe custo nem a quantidade exata acima de 3.
// produtos: linhas de produtos (+ foto_em); vendidos: [{produto_id, total}]
function montarVitrine(produtos, vendidos = [], config = CONFIG_PADRAO) {
  const mostrarEsgotados = config.mostrar_esgotados !== 'nao';

  // "Mais vendido": os 3 que mais saíram no período (mínimo 2 unidades)
  const top = vendidos
    .filter(v => Number(v.total) >= 2)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, 3)
    .map(v => Number(v.produto_id));

  const lista = produtos
    .filter(p => p.na_loja !== false && Number(p.preco) > 0)
    .map(p => {
      const qtd = Math.max(0, Number(p.quantidade) || 0);
      const preco = Number(p.preco);
      const antigo = Number(p.preco_antigo);
      const temPromo = antigo > preco;
      return {
        id: p.id,
        nome: p.nome,
        descricao: p.descricao || '',
        categoria: (p.categoria || '').trim(),
        preco,
        preco_antigo: temPromo ? antigo : null,
        desconto: temPromo ? Math.round((1 - preco / antigo) * 100) : 0,
        disponivel: qtd > 0,
        ultimas: qtd > 0 && qtd <= 3 ? qtd : null,
        max_compra: Math.min(qtd, 10),
        destaque: !!p.destaque,
        mais_vendido: top.includes(Number(p.id)),
        foto: p.foto_em ? `/api/loja/foto/${p.id}?v=${versaoFoto(p.foto_em)}` : null,
      };
    })
    .filter(p => mostrarEsgotados || p.disponivel);

  // Ordem: disponíveis primeiro; dentro disso destaque, mais vendido, nome
  lista.sort((a, b) =>
    (b.disponivel - a.disponivel) ||
    (b.destaque - a.destaque) ||
    (b.mais_vendido - a.mais_vendido) ||
    a.nome.localeCompare(b.nome, 'pt-BR')
  );
  return lista;
}

// Versão da foto = data da última troca em milissegundos. Vai na URL (cache
// eterno no navegador) e no nome da chave da foto na Cloudflare.
function versaoFoto(fotoEm) {
  const ms = Date.parse(fotoEm);
  return Number.isFinite(ms) ? ms : 0;
}
const chaveFoto = (id, versao) => `foto-${id}-${versao}`;

// Foto enviada pelo painel como data URL (o navegador já reduz para ~1000px)
const TIPOS_FOTO = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};
const FOTO_MAX_BYTES = 2 * 1024 * 1024;

function lerFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { erro: 'Envie uma imagem JPG, PNG ou WEBP' };
  const dados = Buffer.from(m[2], 'base64');
  if (!dados.length) return { erro: 'Imagem vazia' };
  if (dados.length > FOTO_MAX_BYTES) return { erro: 'Imagem muito grande (máximo 2 MB)' };
  const assinatura = TIPOS_FOTO[m[1]];
  if (!assinatura.every((b, i) => dados[i] === b)) return { erro: 'O arquivo não parece ser uma imagem válida' };
  return { tipo: m[1], dados };
}

function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  CONFIG_PADRAO, CAMPOS_CONFIG,
  limparWhatsapp, limparInstagram, normalizarConfig, configDeLinhas,
  montarVitrine, lerFoto, escaparHtml, versaoFoto, chaveFoto,
};
