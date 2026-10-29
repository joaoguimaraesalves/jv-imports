// GET /p/:id — loja já abrindo o produto, com prévia (foto, nome e preço)
// para quando o link for compartilhado no WhatsApp/Instagram.
import { renderPagina, lerVitrine, moeda, OG_LOJA } from '../../compartilhado.js';

export async function onRequestGet(context) {
  const id = parseInt(context.params.id, 10);
  let p = null;
  try {
    const vitrine = Number.isInteger(id) ? await lerVitrine(context.env) : null;
    p = vitrine && vitrine.produtos.find((x) => x.id === id);
  } catch (e) { /* sem vitrine: mostra a loja normal */ }
  if (!p) return renderPagina(context, OG_LOJA);
  return renderPagina(context, {
    titulo: `${p.nome} — ${moeda(p.preco)} | JV Imports`,
    descricao: (p.disponivel ? 'Disponível agora. ' : 'Sob encomenda. ') +
      (p.descricao ? p.descricao.slice(0, 140) : 'Peça pelo WhatsApp na JV Imports.'),
    imagem: p.foto || OG_LOJA.imagem,
    caminho: `/p/${p.id}`,
    produtoId: p.id,
  });
}
