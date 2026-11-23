/**
 * tests/api.test.mjs
 * -----------------------------------------------------------------------------
 * Testa os controladores do catálogo chamando-os DIRETAMENTE, sem subir
 * servidor HTTP.
 *
 * Isso é possível porque os controladores não conhecem Express: recebem
 * `{ query, params, usuarioId }` e devolvem `{ status, corpo }`. Testes
 * assim rodam em milissegundos e não dependem de porta livre.
 *
 * Requer o banco configurado. Sem credenciais, a suíte é pulada em vez de
 * falhar — o `npm test` continua útil para quem ainda não configurou o
 * Supabase.
 */

import {
  getProdutos,
  getProduto,
  getCategorias,
  getVitrines,
} from '../backend/controllers/products-controller.js';
import { bancoConfigurado, verificarConexao } from '../services/database.js';

let ok = 0;
let falhas = 0;

const verificar = (nome, condicao, detalhe = '') => {
  if (condicao) {
    console.log(`  ✓ ${nome}`);
    ok += 1;
  } else {
    console.log(`  ✗ ${nome}  ${detalhe}`);
    falhas += 1;
  }
};

/* -----------------------------------------------------------------------------
 * Pré-requisito
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte da API pulada.');
  console.log('    Preencha o .env e rode: npm run db:check\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}`);
  console.log('    Suíte da API pulada.\n');
  process.exit(0);
}

/* =============================================================================
 * LISTAGEM
 * ========================================================================== */

console.log('\n── Listagem de produtos ──\n');

const lista = await getProdutos({ query: {} });

verificar('status 200', lista.status === 200, `obtido: ${lista.status}`);
verificar('devolve array de produtos', Array.isArray(lista.corpo.produtos));
verificar('tem produtos cadastrados', lista.corpo.produtos.length > 0);
verificar('informa o total', typeof lista.corpo.total === 'number');
verificar('informa o total de páginas', lista.corpo.totalPaginas >= 1);

const amostra = lista.corpo.produtos[0];
if (amostra) {
  verificar('produto tem slug', typeof amostra.slug === 'string' && amostra.slug.length > 0);
  verificar('produto tem nome', typeof amostra.nome === 'string');
  verificar('preço é inteiro (centavos)', Number.isInteger(amostra.preco), `obtido: ${amostra.preco}`);
  verificar('preço é positivo', amostra.preco > 0);
  verificar('tem categoria', typeof amostra.categoria?.nome === 'string');
  verificar('informa disponibilidade', typeof amostra.emEstoque === 'boolean');
}

/* =============================================================================
 * SEGURANÇA — PREÇO DE ATACADO
 *
 * O teste mais importante desta suíte. Se qualquer um destes falhar, um
 * cliente comum pode estar vendo preço de revendedor.
 * ========================================================================== */

console.log('\n── Segurança: preço de atacado ──\n');

verificar(
  'visitante anônimo não recebe atacado',
  lista.corpo.atacado === false,
  `obtido: ${lista.corpo.atacado}`
);

const textoResposta = JSON.stringify(lista.corpo);
verificar(
  'resposta não contém o campo preco_atacado',
  !textoResposta.includes('preco_atacado')
);
verificar(
  'resposta não contém precoAtacado',
  !textoResposta.includes('precoAtacado')
);

// Tentativa de forjar: passar usuarioId inventado.
const forjado = await getProdutos({
  query: {},
  usuarioId: '00000000-0000-0000-0000-000000000000',
});
verificar(
  'usuarioId inventado não libera atacado',
  forjado.corpo.atacado === false,
  `obtido: ${forjado.corpo.atacado}`
);

// Tentativa de forjar via query string.
const forjadoQuery = await getProdutos({
  query: { atacado: '1', revendedor: 'true', perfil: 'admin' },
});
verificar(
  'parâmetros na URL não liberam atacado',
  forjadoQuery.corpo.atacado === false
);

verificar(
  'todos os produtos vêm com tipoPreco de varejo ou promocional',
  lista.corpo.produtos.every((p) => p.tipoPreco === 'varejo' || p.tipoPreco === 'promocional')
);

/* =============================================================================
 * BUSCA E FILTROS
 * ========================================================================== */

console.log('\n── Busca, filtros e ordenação ──\n');

const busca = await getProdutos({ query: { busca: 'brownie' } });
verificar('busca devolve resultados', busca.corpo.produtos.length > 0);
verificar(
  'resultados da busca contêm o termo',
  busca.corpo.produtos.every((p) => p.nome.toLowerCase().includes('brownie')),
  busca.corpo.produtos.map((p) => p.nome).join(', ')
);

const buscaVazia = await getProdutos({ query: { busca: 'xyzabc123naoexiste' } });
verificar('busca sem resultado devolve lista vazia', buscaVazia.corpo.produtos.length === 0);
verificar('busca sem resultado ainda responde 200', buscaVazia.status === 200);

const porCategoria = await getProdutos({ query: { categoria: 'brownies' } });
verificar('filtro por categoria funciona', porCategoria.corpo.produtos.length > 0);
verificar(
  'filtro só traz a categoria pedida',
  porCategoria.corpo.produtos.every((p) => p.categoria.slug === 'brownies')
);

const categoriaInvalida = await getProdutos({ query: { categoria: 'DROP TABLE products' } });
verificar(
  'categoria inválida é rejeitada com 400',
  categoriaInvalida.status === 400,
  `obtido: ${categoriaInvalida.status}`
);

const baratos = await getProdutos({ query: { ordenar: 'menor-preco' } });
const precos = baratos.corpo.produtos.map((p) => p.preco);
verificar(
  'ordenação por menor preço está correta',
  precos.every((p, i) => i === 0 || precos[i - 1] <= p),
  precos.join(', ')
);

const caros = await getProdutos({ query: { ordenar: 'maior-preco' } });
const precosDesc = caros.corpo.produtos.map((p) => p.preco);
verificar(
  'ordenação por maior preço está correta',
  precosDesc.every((p, i) => i === 0 || precosDesc[i - 1] >= p)
);

const ordenacaoInvalida = await getProdutos({ query: { ordenar: 'inventado' } });
verificar(
  'ordenação desconhecida cai no padrão sem quebrar',
  ordenacaoInvalida.status === 200
);

/* =============================================================================
 * PAGINAÇÃO
 * ========================================================================== */

console.log('\n── Paginação ──\n');

const pagina1 = await getProdutos({ query: { porPagina: '3', pagina: '1' } });
const pagina2 = await getProdutos({ query: { porPagina: '3', pagina: '2' } });

verificar('respeita porPagina', pagina1.corpo.produtos.length <= 3);
verificar(
  'página 2 traz produtos diferentes',
  pagina1.corpo.produtos[0]?.slug !== pagina2.corpo.produtos[0]?.slug
);

const exagerado = await getProdutos({ query: { porPagina: '99999' } });
verificar(
  'porPagina absurdo é limitado a 60',
  exagerado.corpo.porPagina <= 60,
  `obtido: ${exagerado.corpo.porPagina}`
);

const negativo = await getProdutos({ query: { pagina: '-5' } });
verificar('página negativa vira página 1', negativo.corpo.pagina === 1);

/* =============================================================================
 * DETALHE
 * ========================================================================== */

console.log('\n── Detalhe do produto ──\n');

const slugExistente = amostra?.slug;

if (slugExistente) {
  const detalhe = await getProduto({ params: { slug: slugExistente } });

  verificar('status 200 para slug existente', detalhe.status === 200);
  verificar('devolve o produto', detalhe.corpo.produto?.slug === slugExistente);
  verificar('devolve relacionados', Array.isArray(detalhe.corpo.relacionados));
  verificar(
    'relacionados não incluem o próprio produto',
    detalhe.corpo.relacionados.every((r) => r.slug !== slugExistente)
  );
  verificar(
    'detalhe não expõe preço de atacado',
    !JSON.stringify(detalhe.corpo).includes('preco_atacado')
  );
}

const inexistente = await getProduto({ params: { slug: 'produto-que-nao-existe-123' } });
verificar('slug inexistente devolve 404', inexistente.status === 404);

/* =============================================================================
 * VALIDAÇÃO DE ENTRADA
 * ========================================================================== */

console.log('\n── Entradas maliciosas ──\n');

const entradas = [
  ['SQL injection no slug', "'; DROP TABLE products; --"],
  ['path traversal', '../../etc/passwd'],
  ['XSS no slug', '<script>alert(1)</script>'],
  ['slug com maiúsculas', 'Brownie-Tradicional'],
  ['slug vazio', ''],
];

for (const [nome, valor] of entradas) {
  const resposta = await getProduto({ params: { slug: valor } });
  verificar(
    `${nome} é rejeitado com 400`,
    resposta.status === 400,
    `obtido: ${resposta.status}`
  );
}

// A busca aceita texto livre, mas precisa neutralizar os metacaracteres.
const buscaMaliciosa = await getProdutos({
  query: { busca: "*%,()'; DROP TABLE products; --" },
});
verificar(
  'busca com caracteres especiais não quebra a API',
  buscaMaliciosa.status === 200,
  `obtido: ${buscaMaliciosa.status}`
);

/* =============================================================================
 * CATEGORIAS E VITRINES
 * ========================================================================== */

console.log('\n── Categorias e vitrines ──\n');

const categorias = await getCategorias();
verificar('categorias respondem 200', categorias.status === 200);
verificar('há categorias cadastradas', categorias.corpo.categorias.length > 0);
verificar(
  'cada categoria tem slug, nome e contagem',
  categorias.corpo.categorias.every(
    (c) => c.slug && c.nome && typeof c.quantidade === 'number'
  )
);
verificar(
  'nenhuma categoria de kit nesta etapa',
  !categorias.corpo.categorias.some((c) => /kit/i.test(c.slug))
);

const vitrines = await getVitrines({ query: { limite: '4' } });
verificar('vitrines respondem 200', vitrines.status === 200);
verificar('vitrine de destaques existe', Array.isArray(vitrines.corpo.destaques));
verificar('vitrine de mais vendidos existe', Array.isArray(vitrines.corpo.maisVendidos));
verificar('vitrine de novidades existe', Array.isArray(vitrines.corpo.novidades));
verificar('vitrines respeitam o limite', vitrines.corpo.destaques.length <= 4);
verificar(
  'vitrines não expõem atacado a anônimo',
  vitrines.corpo.atacado === false
);

/* =============================================================================
 * CONSISTÊNCIA DOS VALORES
 * ========================================================================== */

console.log('\n── Consistência dos preços ──\n');

verificar(
  'todo preço é inteiro positivo',
  lista.corpo.produtos.every((p) => Number.isInteger(p.preco) && p.preco > 0)
);

verificar(
  'produto em promoção tem preço menor que o original',
  lista.corpo.produtos
    .filter((p) => p.precoOriginal)
    .every((p) => p.preco < p.precoOriginal)
);

verificar(
  'economia bate com a diferença de preços',
  lista.corpo.produtos
    .filter((p) => p.precoOriginal)
    .every((p) => p.economia === p.precoOriginal - p.preco)
);

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
