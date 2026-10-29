// GET /api/loja/produtos — a vitrine publicada pelo painel
import { lerVitrine } from '../../../compartilhado.js';

const json = (dados, status = 200) => new Response(JSON.stringify(dados), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function onRequestGet({ env }) {
  try {
    const vitrine = await lerVitrine(env);
    if (!vitrine) return json({ error: 'A loja ainda não foi publicada pelo painel' }, 503);
    return json(vitrine);
  } catch (e) {
    return json({ error: 'Não foi possível carregar os produtos agora' }, 500);
  }
}
