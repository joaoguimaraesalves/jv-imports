// GET /painel — atalho para o painel de gestão (Apps Script), se configurado.
// Crie a variável PAINEL_URL no projeto da Cloudflare Pages com o link /exec do painel.
// Sem ela, a loja não mostra nem aponta para o painel.
export const onRequestGet = ({ env }) =>
  env.PAINEL_URL ? Response.redirect(env.PAINEL_URL, 302) : new Response('Não encontrado', { status: 404 });
