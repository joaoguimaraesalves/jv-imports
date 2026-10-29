// GET / — página da loja
import { renderPagina, OG_LOJA } from '../compartilhado.js';

export const onRequestGet = (context) => renderPagina(context, OG_LOJA);
