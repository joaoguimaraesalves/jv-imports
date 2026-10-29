// GET /api/loja/foto/:id?v=<versão> — foto do produto guardada no KV
// (chave "foto-<id>-<versão>"). Com versão, o navegador guarda para sempre.
import { lerVitrine } from '../../../../compartilhado.js';

function tipoDaImagem(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

export async function onRequestGet({ params, request, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || !env.VITRINE) return new Response(null, { status: 404 });

  let versao = new URL(request.url).searchParams.get('v');
  if (!versao) {
    // Sem versão: descobre a atual pela vitrine e redireciona para a URL versionada
    const vitrine = await lerVitrine(env);
    const p = vitrine && vitrine.produtos.find((x) => x.id === id);
    if (!p || !p.foto) return new Response(null, { status: 404 });
    return Response.redirect(new URL(p.foto, request.url).toString(), 302);
  }
  if (!/^\d+$/.test(versao)) return new Response(null, { status: 404 });

  const dados = await env.VITRINE.get(`foto-${id}-${versao}`, { type: 'arrayBuffer', cacheTtl: 86400 });
  if (!dados) return new Response(null, { status: 404 });
  return new Response(dados, {
    headers: {
      'Content-Type': tipoDaImagem(new Uint8Array(dados, 0, 4)),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
