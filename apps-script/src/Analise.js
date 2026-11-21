/**
 * Análise de preços: compara o preço de venda e o custo de cada produto com o preço
 * que o mercado pratica, e calcula o máximo que vale pagar na compra.
 *
 * As contas (margem, preço sugerido, custo máximo) ficam na tela (public/js/analise.js),
 * para atualizar na hora quando a pessoa muda a margem ou a taxa. Aqui ficam os dados:
 * produtos, vendas de cada um, preços de mercado e a configuração da análise.
 */

const ANALISE_CONFIG_PADRAO = { margem_alvo: 35, taxa: 3, gastos: 0 };

/**
 * Pesquisa de mercado feita em 21/11/2026 (Mercado Livre, Amazon, Kabum, Buscapé, lojas
 * oficiais da QCY e da Xiaomi). Vale só enquanto o produto não tiver pesquisa salva no
 * painel. "chave" é parte do nome do produto, para não aplicar no produto errado.
 */
const PESQUISA_INICIAL = [
  { chave: 't13', minimo: 140, medio: 190, maximo: 233, fontes: 'Mercado Livre (terceiros R$ 140–233; loja oficial QCY R$ 199–219)' },
  { chave: 't17', minimo: 125, medio: 145, maximo: 199, fontes: 'Mercado Livre (R$ 125–199, maioria R$ 139–150)' },
  { chave: 'c30', minimo: 219, medio: 245, maximo: 290, fontes: 'Amazon R$ 219–236, Mercado Livre R$ 220–290, Kabum R$ 275, JTG R$ 250' },
  { chave: 'buds 6 play', minimo: 85, medio: 110, maximo: 160, fontes: 'Mercado Livre terceiros R$ 82–114; loja oficial Xiaomi R$ 159,99' },
  { chave: '240w', minimo: 60, medio: 110, maximo: 160, fontes: 'Genéricos "240W" no Mercado Livre R$ 37–159 (6 portas a partir de ~R$ 117). De marca com 240W reais: R$ 380–550. Concorre com os genéricos' },
  { chave: 'fonte carregador essager', minimo: 40, medio: 60, maximo: 80, fontes: 'Plebeu Games R$ 40, Magalu R$ 69, DS Foto R$ 80, Mercado Livre R$ 37–79' },
  { chave: 'cabo essager', minimo: 19, medio: 25, maximo: 31, fontes: 'Amztech R$ 19–24, Plebeu Games R$ 31, Mercado Livre ~R$ 30' },
  { chave: 'parafusadeira', minimo: 45, medio: 60, maximo: 80, fontes: 'Mercado Livre R$ 43–60 (promoções), OLX R$ 80' },
  { chave: 'n50', minimo: 199, medio: 210, maximo: 219, fontes: 'Buscapé R$ 199, Mercado Livre R$ 219' },
  { chave: 'ht05', minimo: 219, medio: 235, maximo: 249, fontes: 'QCY Brasil R$ 219 (promo), QCY Mall R$ 249' },
  { chave: 'h3', minimo: 264, medio: 275, maximo: 294, fontes: 'Mercado Livre R$ 268 (jan/26), Magalu R$ 264, R$ 294 (dez/25)' },
  { chave: 'melobuds pro', minimo: 224, medio: 268, maximo: 299, fontes: 'Buscapé R$ 268, QCY Brasil R$ 299, Mercado Livre R$ 224+' },
];
const PESQUISA_INICIAL_DATA = '2026-11-21';

function normalizarNome_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

function pesquisaInicial_(produto) {
  const nome = normalizarNome_(produto.nome);
  const p = PESQUISA_INICIAL.find(function (x) { return nome.indexOf(x.chave) >= 0; });
  if (!p) return null;
  return {
    minimo: p.minimo, medio: p.medio, maximo: p.maximo, fontes: p.fontes, observacao: '',
    atualizado_em: PESQUISA_INICIAL_DATA, pesquisa_inicial: true,
  };
}

function analiseConfig_(tx) {
  let salvo = {};
  try { salvo = JSON.parse(configLer_(tx, 'analise_config') || '{}') || {}; } catch (e) { salvo = {}; }
  return Object.assign({}, ANALISE_CONFIG_PADRAO, salvo);
}

/** Tudo o que a tela de análise precisa, de uma vez. */
function analiseListar_(tx) {
  const vendas = tx.linhas('vendas').filter(function (v) { return !v.historico; });
  const mercado = {};
  tx.linhas('precos_mercado').forEach(function (m) { mercado[m.produto_id] = m; });
  const limite90 = new Date(Date.now() - 90 * 86400000).toISOString();

  let faturamentoTotal = 0;
  let taxasTotal = 0;
  let gastosTotal = 0;
  vendas.forEach(function (v) {
    faturamentoTotal += Number(v.valor) || 0;
    taxasTotal += Number(v.taxa) || 0;
    gastosTotal += Number(v.gastos_extras) || 0;
  });

  const produtos = tx.linhas('produtos').map(function (p) {
    const suas = vendas.filter(function (v) { return Number(v.produto_id) === Number(p.id); });
    let qtd = 0, faturamento = 0, lucro = 0, qtd90 = 0, ultima = null;
    suas.forEach(function (v) {
      const q = Number(v.quantidade) || 0;
      qtd += q;
      faturamento += Number(v.valor) || 0;
      lucro += lucroVenda_(v);
      if (v.data && v.data >= limite90) qtd90 += q;
      if (v.data && (!ultima || v.data > ultima)) ultima = v.data;
    });
    const salvo = mercado[p.id];
    return {
      id: p.id, nome: p.nome, categoria: p.categoria || '', custo: Number(p.custo) || 0, preco: Number(p.preco) || 0,
      quantidade: Number(p.quantidade) || 0, na_loja: p.na_loja !== false,
      vendas: {
        qtd: qtd, faturamento: faturamento, lucro: lucro, qtd_90d: qtd90, ultima_venda: ultima,
        preco_medio: qtd ? faturamento / qtd : null,
      },
      mercado: salvo
        ? { minimo: salvo.minimo, medio: salvo.medio, maximo: salvo.maximo, fontes: salvo.fontes || '', observacao: salvo.observacao || '', atualizado_em: salvo.atualizado_em, pesquisa_inicial: false }
        : pesquisaInicial_(p),
    };
  }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });

  return {
    config: analiseConfig_(tx),
    resumo: {
      vendas: vendas.length,
      faturamento: faturamentoTotal,
      // Quanto as taxas (maquininha/plataforma) e os gastos extras comem, na média, das vendas registradas
      taxa_media_real: faturamentoTotal ? (taxasTotal / faturamentoTotal) * 100 : 0,
      gastos_medio_por_venda: vendas.length ? gastosTotal / vendas.length : 0,
    },
    produtos: produtos,
  };
}

function analiseConfigSalvar_(tx, req) {
  const b = req.body || {};
  const atual = analiseConfig_(tx);
  const conferir = function (campo, min, max, rotulo) {
    if (b[campo] === undefined) return;
    const n = num_(b[campo]);
    if (n === null || n < min || n > max) throw erro_(rotulo + ' inválido (use de ' + min + ' a ' + max + ')');
    atual[campo] = n;
  };
  conferir('margem_alvo', 0, 90, 'Margem desejada');
  conferir('taxa', 0, 40, 'Taxa');
  conferir('gastos', 0, 1000, 'Gasto extra por venda');
  configGravar_(tx, 'analise_config', JSON.stringify(atual));
  return atual;
}

/** Salva (ou apaga, se vier tudo vazio) a pesquisa de mercado de um produto. */
function analisePrecoSalvar_(tx, req) {
  const id = int_(req.params[0]);
  if (!tx.porId('produtos', id)) throw erro_('Produto não encontrado');
  const b = req.body || {};
  const valor = function (campo) {
    const n = num_(b[campo]);
    if (n !== null && n < 0) throw erro_('Preço de mercado não pode ser negativo');
    return n;
  };
  const dados = { minimo: valor('minimo'), medio: valor('medio'), maximo: valor('maximo') };
  if (dados.minimo !== null && dados.maximo !== null && dados.minimo > dados.maximo) throw erro_('O mínimo está maior que o máximo');
  if (dados.medio === null && dados.minimo !== null && dados.maximo !== null) dados.medio = Math.round((dados.minimo + dados.maximo) / 2);

  const linhas = tx.linhas('precos_mercado');
  const existente = linhas.find(function (m) { return Number(m.produto_id) === id; });
  const vazio = dados.minimo === null && dados.medio === null && dados.maximo === null && !b.fontes && !b.observacao;
  if (vazio) {
    if (existente) tx.excluir('precos_mercado', function (m) { return Number(m.produto_id) === id; });
    return { ok: true, removido: true };
  }
  const registro = Object.assign(dados, {
    fontes: String(b.fontes || '').slice(0, 500), observacao: String(b.observacao || '').slice(0, 500), atualizado_em: agoraIso_(),
  });
  if (existente) { Object.assign(existente, registro); tx.alterou('precos_mercado'); }
  else tx.inserir('precos_mercado', Object.assign({ produto_id: id }, registro));
  return Object.assign({ produto_id: id }, registro);
}
