/**
 * services/product-service.js
 * -----------------------------------------------------------------------------
 * Regras de negócio do catálogo.
 *
 * Esta camada não sabe nada sobre HTTP — não recebe `req`, não devolve `res`.
 * Ela recebe parâmetros simples e devolve dados. Isso a torna testável sem
 * subir servidor e reutilizável pelo painel administrativo depois.
 *
 * ⚠️ DECISÃO CENTRAL DE SEGURANÇA — O PREÇO DE ATACADO
 *
 *   O navegador NUNCA informa "sou revendedor". Quem decide é esta camada,
 *   consultando a tabela `resellers` no banco e exigindo status = 'aprovado'.
 *
 *   Um cliente comum que forjar qualquer cabeçalho, cookie ou corpo de
 *   requisição continuará recebendo preço de varejo, porque a verificação
 *   não olha para nada que ele controle.
 */

import { selecionar, selecionarUm } from './database.js';

/* =============================================================================
 * CONSTANTES
 * ========================================================================== */

/** Colunas devolvidas na listagem — não traz textos longos, que pesam. */
const COLUNAS_LISTA =
  'id,slug,nome,descricao_curta,preco_varejo,preco_promocional,preco_efetivo,' +
  'em_promocao,promocao_ate,medida,destaque,mais_vendido,novidade,sazonal,' +
  'vendas_total,criado_em,categoria_slug,categoria_nome,categoria_icone,' +
  'categoria_em_breve,disponivel,sob_encomenda,imagens';

/** Página de detalhes precisa de tudo. */
const COLUNAS_DETALHE = '*';

/**
 * Ordenações disponíveis.
 *
 * As de preço usam `preco_efetivo` (coluna calculada na visão, definida em
 * database/04-correcao-ordenacao.sql), e não `preco_varejo`. Motivo: a tela
 * mostra o preço promocional quando existe, então ordenar pelo preço cheio
 * produziria uma lista visivelmente fora de ordem.
 *
 * A ordenação precisa acontecer no banco, antes da paginação — reordenar os
 * 12 itens da página no navegador daria resultado errado.
 */
const ORDENACOES = {
  // `ordem` entra como critério de desempate: é a sequência que a loja
  // definiu (ver database/10-ordem-produtos.sql). Sem ela, os Kits de Natal
  // saíam na ordem 1, 2, 4, 3 — correta por preço, mas confusa para quem lê.
  relevancia: 'destaque.desc,ordem.asc,vendas_total.desc',
  'mais-vendidos': 'vendas_total.desc,ordem.asc',
  novidades: 'ordem.asc,criado_em.desc',
  'menor-preco': 'preco_efetivo.asc',
  'maior-preco': 'preco_efetivo.desc',
  'a-z': 'nome.asc',
  'z-a': 'nome.desc',
};

const LIMITE_PADRAO = 24;
const LIMITE_MAXIMO = 60;

/* =============================================================================
 * PERMISSÕES
 * ========================================================================== */

/**
 * Verifica no BANCO se o usuário é revendedor aprovado.
 *
 * @param {string|null} usuarioId - id vindo do token já validado
 * @returns {Promise<{aprovado: boolean, desconto: number, pedidoMinimo: number}>}
 */
export async function obterCondicoesRevendedor(usuarioId) {
  const negado = { aprovado: false, desconto: 0, pedidoMinimo: 0 };

  if (!usuarioId) return negado;

  try {
    const revendedor = await selecionarUm('resellers', {
      colunas: 'status,desconto_percentual,pedido_minimo_centavos',
      filtros: { usuario_id: usuarioId, status: 'aprovado' },
    });

    if (!revendedor) return negado;

    return {
      aprovado: true,
      desconto: Number(revendedor.desconto_percentual) || 0,
      pedidoMinimo: Number(revendedor.pedido_minimo_centavos) || 0,
    };
  } catch (erro) {
    // Em caso de falha, negamos o benefício. Errar para o lado seguro:
    // é melhor um revendedor ver preço de varejo por engano do que um
    // cliente comum conseguir preço de atacado.
    console.error('[product-service] Falha ao checar revendedor:', erro.message);
    return negado;
  }
}

/* =============================================================================
 * MONTAGEM DO PREÇO
 * ========================================================================== */

/**
 * Define qual preço o usuário vai ver.
 *
 * @param {object} produto - linha do catálogo
 * @param {object} condicoes - resultado de obterCondicoesRevendedor
 * @param {number|null} precoAtacado - só é passado quando houver permissão
 */
function montarPreco(produto, condicoes, precoAtacado = null) {
  const varejo = produto.preco_varejo;
  const promocional = produto.preco_promocional;

  // Caminho do revendedor aprovado.
  if (condicoes.aprovado && precoAtacado) {
    return {
      preco: precoAtacado,
      precoOriginal: varejo,
      tipo: 'atacado',
      economia: varejo - precoAtacado,
    };
  }

  // Produto em promoção.
  if (promocional && promocional < varejo) {
    return {
      preco: promocional,
      precoOriginal: varejo,
      tipo: 'promocional',
      economia: varejo - promocional,
    };
  }

  return { preco: varejo, precoOriginal: null, tipo: 'varejo', economia: 0 };
}

/**
 * Converte a linha do banco no formato que o frontend consome.
 * Padronizar aqui evita que cada página do site invente o seu próprio.
 */
function formatarProduto(produto, condicoes, precoAtacado = null) {
  const preco = montarPreco(produto, condicoes, precoAtacado);

  const imagens = Array.isArray(produto.imagens) ? produto.imagens : [];
  const principal = imagens.find((i) => i.principal) || imagens[0] || null;

  const disponivel = Number(produto.disponivel) || 0;

  return {
    id: produto.id,
    slug: produto.slug,
    nome: produto.nome,
    descricaoCurta: produto.descricao_curta,
    descricao: produto.descricao,
    ingredientes: produto.ingredientes,
    alergenicos: produto.alergenicos,

    // Valores sempre em CENTAVOS.
    preco: preco.preco,
    precoOriginal: preco.precoOriginal,
    tipoPreco: preco.tipo,
    economia: preco.economia,

    medida: produto.medida,

    categoria: {
      slug: produto.categoria_slug,
      nome: produto.categoria_nome,
      icone: produto.categoria_icone,
      emBreve: produto.categoria_em_breve === true,
    },

    // Quando a promoção acaba. Nulo fora de promoção ou sem prazo definido.
    promocaoAte: produto.promocao_ate || null,

    // `sob_encomenda` significa que a loja produz mesmo sem estoque pronto.
    disponivel,
    emEstoque: disponivel > 0 || produto.sob_encomenda === true,
    sobEncomenda: produto.sob_encomenda === true,

    destaque: produto.destaque === true,
    maisVendido: produto.mais_vendido === true,
    novidade: produto.novidade === true,
    sazonal: produto.sazonal === true,

    imagem: principal ? { url: principal.url, alt: principal.alt } : null,
    imagens: imagens.map((i) => ({ url: i.url, alt: i.alt })),

    // Marcador honesto: estes vieram do seed de demonstração.
    demonstracao: String(produto.slug || '').startsWith('demo-'),
  };
}

/* =============================================================================
 * CONSULTAS
 * ========================================================================== */

/**
 * Busca os preços de atacado dos produtos informados.
 * Só é chamada quando o usuário é revendedor aprovado — o custo extra
 * de consulta só existe para quem tem direito.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, number>>}
 */
async function buscarPrecosAtacado(ids) {
  if (ids.length === 0) return new Map();

  // PostgREST aceita o operador `in.(a,b,c)`.
  const lista = await selecionar('products', {
    colunas: 'id,preco_atacado',
    filtros: { id: `in.(${ids.join(',')})` },
  });

  return new Map(
    lista.filter((p) => p.preco_atacado).map((p) => [p.id, p.preco_atacado])
  );
}

/**
 * Lista produtos do catálogo com busca, filtros, ordenação e paginação.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.busca]
 * @param {string} [opcoes.categoria] - slug
 * @param {string} [opcoes.ordenar] - chave de ORDENACOES
 * @param {boolean} [opcoes.somentePromocao]
 * @param {boolean} [opcoes.somenteDestaque]
 * @param {boolean} [opcoes.somenteNovidade]
 * @param {number} [opcoes.pagina] - começa em 1
 * @param {number} [opcoes.porPagina]
 * @param {string|null} [opcoes.usuarioId]
 * @returns {Promise<{produtos: Array, total: number, pagina: number, totalPaginas: number, atacado: boolean}>}
 */
export async function listarProdutos(opcoes = {}) {
  const {
    busca = '',
    categoria = '',
    ordenar = 'relevancia',
    somentePromocao = false,
    somenteDestaque = false,
    somenteNovidade = false,
    somenteMaisVendidos = false,
    pagina = 1,
    porPagina = LIMITE_PADRAO,
    usuarioId = null,
  } = opcoes;

  // Limites defensivos: impedem que alguém peça porPagina=100000 e derrube
  // o banco com uma única requisição.
  const limite = Math.min(Math.max(1, Number(porPagina) || LIMITE_PADRAO), LIMITE_MAXIMO);
  const paginaAtual = Math.max(1, Number(pagina) || 1);
  const deslocamento = (paginaAtual - 1) * limite;

  const filtros = {};

  if (categoria) filtros.categoria_slug = `eq.${categoria}`;
  if (somenteDestaque) filtros.destaque = 'is.true';
  if (somenteNovidade) filtros.novidade = 'is.true';
  if (somenteMaisVendidos) filtros.mais_vendido = 'is.true';
  // `em_promocao` já considera a validade: a visão o calcula comparando
  // `promocao_ate` com `now()`. Filtrar por `preco_promocional not.is.null`
  // traria de volta promoções vencidas.
  if (somentePromocao) filtros.em_promocao = 'is.true';

  if (busca && busca.trim()) {
    // Segunda barreira: o controlador já limpa a entrada, mas este serviço
    // também é chamado pelo painel administrativo. Validar nos dois pontos
    // evita depender de quem chama ter feito a parte dele.
    const termo = busca.trim().replace(/[^\p{L}\p{N}\s-]/gu, '').trim();

    // `ilike` compara sem diferenciar maiúsculas de minúsculas.
    // Os asteriscos são o curinga do PostgREST (equivalem a % no SQL).
    if (termo) filtros.nome = `ilike.*${termo}*`;
  }

  const ordem = ORDENACOES[ordenar] || ORDENACOES.relevancia;

  const { dados, total } = await selecionar('catalogo_publico', {
    colunas: COLUNAS_LISTA,
    filtros,
    ordenar: ordem,
    limite,
    deslocamento,
    contarTotal: true,
  });

  const condicoes = await obterCondicoesRevendedor(usuarioId);

  let precosAtacado = new Map();
  if (condicoes.aprovado) {
    precosAtacado = await buscarPrecosAtacado(dados.map((p) => p.id));
  }

  return {
    produtos: dados.map((p) =>
      formatarProduto(p, condicoes, precosAtacado.get(p.id) || null)
    ),
    total,
    pagina: paginaAtual,
    porPagina: limite,
    totalPaginas: Math.max(1, Math.ceil(total / limite)),
    atacado: condicoes.aprovado,
  };
}

/**
 * Busca um produto pelo slug.
 * @returns {Promise<object|null>}
 */
export async function obterProdutoPorSlug(slug, { usuarioId = null } = {}) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;

  const produto = await selecionarUm('catalogo_publico', {
    colunas: COLUNAS_DETALHE,
    filtros: { slug: `eq.${slug}` },
  });

  if (!produto) return null;

  const condicoes = await obterCondicoesRevendedor(usuarioId);

  let precoAtacado = null;
  if (condicoes.aprovado) {
    const precos = await buscarPrecosAtacado([produto.id]);
    precoAtacado = precos.get(produto.id) || null;
  }

  return formatarProduto(produto, condicoes, precoAtacado);
}

/**
 * Produtos relacionados: outros itens da mesma categoria.
 */
export async function listarRelacionados(slug, { limite = 4, usuarioId = null } = {}) {
  const produto = await selecionarUm('catalogo_publico', {
    colunas: 'id,categoria_slug',
    filtros: { slug: `eq.${slug}` },
  });

  if (!produto) return [];

  const dados = await selecionar('catalogo_publico', {
    colunas: COLUNAS_LISTA,
    filtros: {
      categoria_slug: `eq.${produto.categoria_slug}`,
      // `neq` exclui o próprio produto da lista de relacionados.
      id: `neq.${produto.id}`,
    },
    ordenar: 'ordem.asc,vendas_total.desc',
    limite,
  });

  const condicoes = await obterCondicoesRevendedor(usuarioId);
  return dados.map((p) => formatarProduto(p, condicoes));
}

/**
 * Lista as categorias ativas, com a contagem de produtos publicados.
 */
export async function listarCategorias() {
  const categorias = await selecionar('categories', {
    colunas: 'slug,nome,descricao,icone,ordem,em_breve',
    filtros: { ativa: 'is.true' },
    ordenar: 'ordem.asc',
  });

  // Uma consulta só, contando no cliente. Para ~5 categorias isso é muito
  // mais barato que 5 consultas de contagem separadas.
  const produtos = await selecionar('catalogo_publico', {
    colunas: 'categoria_slug',
    limite: 1000,
  });

  const contagem = produtos.reduce((acc, p) => {
    acc[p.categoria_slug] = (acc[p.categoria_slug] || 0) + 1;
    return acc;
  }, {});

  return categorias.map((c) => ({
    slug: c.slug,
    nome: c.nome,
    descricao: c.descricao,
    icone: c.icone,
    quantidade: contagem[c.slug] || 0,
    // Categoria anunciada mas ainda sem produtos à venda.
    emBreve: c.em_breve === true,
  }));
}

/**
 * Vitrines da página inicial, em uma única chamada.
 * Evita que a home dispare três requisições separadas.
 */
export async function obterVitrines({ usuarioId = null, limite = 4 } = {}) {
  const [destaques, maisVendidos, novidades] = await Promise.all([
    listarProdutos({ somenteDestaque: true, porPagina: limite, usuarioId }),
    listarProdutos({ somenteMaisVendidos: true, porPagina: limite, usuarioId }),

    // `somenteNovidade` é obrigatório aqui, e não só a ordenação.
    //
    // A versão anterior apenas ORDENAVA por novidades — então a vitrine
    // trazia o catálogo inteiro, com os mais recentes na frente. Funcionava
    // por acidente, porque os kits eram os produtos mais novos. Quando a
    // ordenação passou a considerar a coluna `ordem`, os produtos
    // individuais (ordem = 0) subiram para o topo e tomaram o lugar dos
    // kits na seção de Natal.
    listarProdutos({
      somenteNovidade: true,
      ordenar: 'novidades',
      porPagina: limite,
      usuarioId,
    }),
  ]);

  return {
    destaques: destaques.produtos,
    maisVendidos: maisVendidos.produtos,
    novidades: novidades.produtos,
    atacado: destaques.atacado,
  };
}

export default {
  listarProdutos,
  obterProdutoPorSlug,
  listarRelacionados,
  listarCategorias,
  obterVitrines,
  obterCondicoesRevendedor,
};
