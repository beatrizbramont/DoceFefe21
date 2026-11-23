/**
 * backend/controllers/products-controller.js
 * -----------------------------------------------------------------------------
 * Controladores do catálogo.
 *
 * ARQUITETURA: estes controladores NÃO conhecem Express.
 *   Cada função recebe um objeto simples `{ query, params, usuarioId }` e
 *   devolve `{ status, corpo }`. Quem adapta isso para o Express (ou para o
 *   servidor nativo) é a camada de rotas.
 *
 *   Vantagens: dá para testar sem subir servidor, e o mesmo controlador serve
 *   às duas formas de execução do backend.
 */

import {
  listarProdutos,
  obterProdutoPorSlug,
  listarRelacionados,
  listarCategorias,
  obterVitrines,
} from '../../services/product-service.js';

/* =============================================================================
 * VALIDAÇÃO DE ENTRADA
 *
 * Toda entrada vinda da rede é tratada como hostil. Nada é repassado ao banco
 * sem passar por aqui.
 * ========================================================================== */

const ORDENACOES_VALIDAS = [
  'relevancia',
  'mais-vendidos',
  'novidades',
  'menor-preco',
  'maior-preco',
  'a-z',
  'z-a',
];

/** Converte para inteiro dentro de uma faixa, com valor padrão seguro. */
function inteiro(valor, { padrao, minimo, maximo }) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, minimo), maximo);
}

/** Interpreta "1", "true", "sim" como verdadeiro. */
function booleano(valor) {
  return valor === '1' || valor === 'true' || valor === 'sim';
}

/**
 * Limpa o termo de busca.
 *
 * LISTA DE PERMITIDOS, NÃO DE PROIBIDOS.
 *   A primeira versão removia os caracteres perigosos conhecidos
 *   (`%,()*`). Isso é frágil: basta um caractere especial esquecido para
 *   abrir brecha — e foi o que aconteceu. Uma busca por
 *   `*%,()'; DROP TABLE products; --` passava o apóstrofo e o ponto-e-vírgula
 *   adiante, quebrando a sintaxe de filtro do PostgREST (HTTP 403).
 *
 *   Agora só passam os caracteres que fazem sentido no nome de um doce:
 *   letras (inclusive acentuadas), números, espaço e hífen. Qualquer outra
 *   coisa é descartada. Se amanhã surgir um metacaractere novo, ele já está
 *   bloqueado por padrão.
 */
function textoBusca(valor) {
  if (typeof valor !== 'string') return '';

  return valor
    .trim()
    // Limite de tamanho evita consultas absurdas.
    .slice(0, 80)
    // \p{L} = qualquer letra, incluindo á, ê, ç. A flag `u` é obrigatória.
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    // Espaços repetidos viram um só.
    .replace(/\s+/g, ' ')
    .trim();
}

/** Slugs só podem ter letras minúsculas, números e hífen. */
function slugValido(valor) {
  return typeof valor === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(valor);
}

/* =============================================================================
 * CONTROLADORES
 * ========================================================================== */

/**
 * GET /api/produtos
 * Busca, filtros, ordenação e paginação.
 */
export async function getProdutos({ query = {}, usuarioId = null } = {}) {
  const categoria = query.categoria || '';

  if (categoria && !slugValido(categoria)) {
    return {
      status: 400,
      corpo: { erro: true, mensagem: 'Categoria inválida.' },
    };
  }

  const ordenar = ORDENACOES_VALIDAS.includes(query.ordenar)
    ? query.ordenar
    : 'relevancia';

  const resultado = await listarProdutos({
    busca: textoBusca(query.busca),
    categoria,
    ordenar,
    somentePromocao: booleano(query.promocao),
    somenteDestaque: booleano(query.destaque),
    somenteNovidade: booleano(query.novidade),
    somenteMaisVendidos: booleano(query.maisVendidos),
    pagina: inteiro(query.pagina, { padrao: 1, minimo: 1, maximo: 500 }),
    porPagina: inteiro(query.porPagina, { padrao: 24, minimo: 1, maximo: 60 }),
    usuarioId,
  });

  return { status: 200, corpo: resultado };
}

/**
 * GET /api/produtos/:slug
 */
export async function getProduto({ params = {}, usuarioId = null } = {}) {
  const { slug } = params;

  if (!slugValido(slug)) {
    return { status: 400, corpo: { erro: true, mensagem: 'Endereço de produto inválido.' } };
  }

  const produto = await obterProdutoPorSlug(slug, { usuarioId });

  if (!produto) {
    return {
      status: 404,
      corpo: { erro: true, mensagem: 'Produto não encontrado.' },
    };
  }

  const relacionados = await listarRelacionados(slug, { limite: 4, usuarioId });

  return { status: 200, corpo: { produto, relacionados } };
}

/**
 * GET /api/categorias
 */
export async function getCategorias() {
  const categorias = await listarCategorias();
  return { status: 200, corpo: { categorias } };
}

/**
 * GET /api/vitrines
 * Destaques, mais vendidos e novidades em uma única chamada.
 */
export async function getVitrines({ query = {}, usuarioId = null } = {}) {
  const limite = inteiro(query.limite, { padrao: 4, minimo: 1, maximo: 12 });
  const vitrines = await obterVitrines({ usuarioId, limite });
  return { status: 200, corpo: vitrines };
}

export default { getProdutos, getProduto, getCategorias, getVitrines };
