// cloudflare/compartilhado.js — utilitários das funções da loja na Cloudflare.
// Os dados vêm do Cloudflare KV (ligação "VITRINE"), que o painel no Render
// atualiza a cada alteração (lib/publicador.js). O cliente nunca espera o Render.

export async function lerVitrine(env) {
  if (!env.VITRINE) return null;
  return env.VITRINE.get('vitrine', { type: 'json' });
}

export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const moeda = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const OG_LOJA = {
  titulo: 'JV Imports — Tecnologia importada com preço justo',
  descricao: 'Fones, carregadores e acessórios importados. Estoque atualizado em tempo real — escolha e peça pelo WhatsApp.',
  imagem: '/loja/logo-600.jpg',
  caminho: '/',
};

// Preenche o modelo da página (dist/_modelo.html) com as tags de prévia
export async function renderPagina(context, og) {
  const { request, env } = context;
  const base = new URL(request.url).origin;
  const res = await env.ASSETS.fetch(new URL('/_modelo.html', request.url));
  if (!res.ok) return new Response('Loja indisponível', { status: 500 });
  const html = (await res.text())
    .replaceAll('__OG_TITULO__', escapar(og.titulo))
    .replaceAll('__OG_DESCRICAO__', escapar(og.descricao))
    .replaceAll('__OG_IMAGEM__', escapar(base + og.imagem))
    .replaceAll('__OG_URL__', escapar(base + og.caminho))
    .replaceAll('__PRODUTO_INICIAL__', og.produtoId ? String(og.produtoId) : '');
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
