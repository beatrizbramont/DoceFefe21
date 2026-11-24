/**
 * services/product-admin-service.js
 * -----------------------------------------------------------------------------
 * Catálogo pelo lado de dentro: cadastrar, editar, publicar e fotografar.
 *
 * COMO ESTE ARQUIVO SE DIFERENCIA DE product-service.js
 *   `product-service.js` responde à pergunta do visitante: "o que está à
 *   venda?". Ele lê a visão `catalogo_publico`, que já esconde produtos
 *   despublicados, preço de atacado e promoção vencida.
 *
 *   Este arquivo responde à pergunta da loja: "o que existe no catálogo?".
 *   Ele lê a tabela `products` inteira — rascunhos, arquivados e preço de
 *   atacado incluídos. Por isso tudo aqui passa por `exigirAdmin` no
 *   controlador.
 *
 * ⚠️ POR QUE VALIDAR AQUI SE O BANCO JÁ TEM RESTRIÇÕES
 *   O banco é a última linha: ele recusa `preco_promocional >= preco_varejo`
 *   com uma mensagem como "new row violates check constraint
 *   products_promocional_menor". Correto, e ilegível.
 *
 *   A validação daqui existe para a Fefê ler "a promoção precisa ser menor que
 *   o preço normal" e saber o que corrigir. As duas camadas são necessárias:
 *   esta para explicar, a do banco para garantir.
 */

import {
  selecionar,
  selecionarUm,
  inserir,
  atualizar,
  remover,
  chamarFuncao,
  ErroBanco,
} from './database.js';
import {
  validarUpload,
  enviarParaStorage,
  apagarDoStorage,
  urlPublica,
  TIPOS_IMAGEM,
  TAMANHO_MAXIMO_PADRAO,
  ErroUpload,
} from './upload.js';

const BUCKET_FOTOS = 'produtos';

/** Erro de catálogo com status HTTP e campo associado. */
export class ErroCatalogo extends Error {
  constructor(mensagem, status = 422, campo = null) {
    super(mensagem);
    this.name = 'ErroCatalogo';
    this.status = status;
    this.campo = campo;
  }
}

/* =============================================================================
 * COLUNAS
 *
 * O `select` do PostgREST permite trazer as tabelas relacionadas na mesma
 * consulta. Sem isso seriam quatro idas ao banco por tela: produtos,
 * categorias, estoque e fotos.
 * ========================================================================== */

const RELACIONADOS =
  'categoria:categories(id,slug,nome),' +
  'estoque:inventory(quantidade,reservado,alerta_minimo,sob_encomenda),' +
  'fotos:product_images(id,url,alt,ordem,principal)';

const COLUNAS_LISTA =
  'id,slug,nome,descricao_curta,preco_varejo,preco_atacado,preco_promocional,' +
  'promocao_ate,peso_gramas,minimo_atacado,destaque,mais_vendido,novidade,' +
  `sazonal,publicado,arquivado_em,vendas_total,criado_em,categoria_id,${RELACIONADOS}`;

const COLUNAS_DETALHE = `${COLUNAS_LISTA},descricao,ingredientes,alergenicos`;

/* =============================================================================
 * FORMATAÇÃO
 * ========================================================================== */

/**
 * O PostgREST devolve relação "para um" como objeto e "para muitos" como
 * lista — mas isso depende de ele reconhecer a chave estrangeira. Normalizar
 * aqui evita que a tela quebre se o formato vier diferente do esperado.
 */
const umSo = (valor) => (Array.isArray(valor) ? valor[0] || null : valor || null);
const varios = (valor) => (Array.isArray(valor) ? valor : valor ? [valor] : []);

function formatarProduto(linha) {
  if (!linha) return null;

  const estoque = umSo(linha.estoque);
  const categoria = umSo(linha.categoria);
  const fotos = varios(linha.fotos).sort(
    (a, b) => Number(b.principal) - Number(a.principal) || a.ordem - b.ordem
  );

  const emPromocao =
    linha.preco_promocional != null &&
    linha.preco_promocional < linha.preco_varejo &&
    (!linha.promocao_ate || new Date(linha.promocao_ate) > new Date());

  return {
    id: linha.id,
    slug: linha.slug,
    nome: linha.nome,
    descricaoCurta: linha.descricao_curta,
    descricao: linha.descricao,
    ingredientes: linha.ingredientes,
    alergenicos: linha.alergenicos,

    categoriaId: linha.categoria_id,
    categoria: categoria
      ? { id: categoria.id, slug: categoria.slug, nome: categoria.nome }
      : null,

    precoVarejo: linha.preco_varejo,
    precoAtacado: linha.preco_atacado,
    precoPromocional: linha.preco_promocional,
    promocaoAte: linha.promocao_ate,
    emPromocao,

    pesoGramas: linha.peso_gramas,
    minimoAtacado: linha.minimo_atacado,

    destaque: linha.destaque,
    maisVendido: linha.mais_vendido,
    novidade: linha.novidade,
    sazonal: linha.sazonal,

    publicado: linha.publicado,
    arquivado: Boolean(linha.arquivado_em),
    arquivadoEm: linha.arquivado_em,

    vendasTotal: linha.vendas_total,
    criadoEm: linha.criado_em,

    estoque: estoque
      ? {
          quantidade: estoque.quantidade,
          reservado: estoque.reservado,
          disponivel: estoque.quantidade - estoque.reservado,
          alertaMinimo: estoque.alerta_minimo,
          sobEncomenda: estoque.sob_encomenda,
        }
      : null,

    fotos: fotos.map((f) => ({
      id: f.id,
      url: f.url,
      alt: f.alt,
      ordem: f.ordem,
      principal: f.principal,
    })),
  };
}

/* =============================================================================
 * SLUG
 * ========================================================================== */

/**
 * Transforma o nome do produto no trecho que vai para a URL.
 *
 *   "Pão de Mel Tradicional"  →  "pao-de-mel-tradicional"
 *
 * `normalize('NFD')` separa a letra do acento em dois caracteres, e o
 * intervalo U+0300-U+036F apaga só a parte do acento — assim "ç" vira "c" e
 * "ã" vira "a" sem precisar de tabela de substituição.
 */
export function gerarSlug(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

const texto = (valor, limite) => {
  const limpo = String(valor ?? '').trim();
  return limpo ? limpo.slice(0, limite) : null;
};

/** Converte para inteiro, devolvendo null quando o campo veio vazio. */
function inteiroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero) : NaN;
}

/**
 * Valida os dados vindos do painel e devolve as colunas prontas para o banco.
 *
 * @param {object} dados - em camelCase, como o navegador envia
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.parcial] - true na edição: só valida o que veio
 * @returns {{colunas: object, erros: object}}
 */
export function validarProduto(dados = {}, { parcial = false } = {}) {
  const erros = {};
  const colunas = {};

  const veio = (campo) => dados[campo] !== undefined;
  const obrigatorio = (campo) => !parcial || veio(campo);

  /* --- Nome --- */
  if (obrigatorio('nome')) {
    const nome = texto(dados.nome, 160);
    if (!nome || nome.length < 2) {
      erros.nome = 'O nome precisa ter pelo menos 2 letras.';
    } else {
      colunas.nome = nome;
    }
  }

  /* --- Slug (endereço do produto) --- */
  if (veio('slug') || (!parcial && dados.nome)) {
    const slug = gerarSlug(dados.slug || dados.nome);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      erros.slug = 'O endereço do produto só aceita letras, números e hífen.';
    } else {
      colunas.slug = slug;
    }
  }

  /* --- Categoria --- */
  if (obrigatorio('categoriaId')) {
    const id = String(dados.categoriaId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      erros.categoriaId = 'Escolha a categoria.';
    } else {
      colunas.categoria_id = id;
    }
  }

  /* --- Textos livres --- */
  if (veio('descricaoCurta')) colunas.descricao_curta = texto(dados.descricaoCurta, 200);
  if (veio('descricao')) colunas.descricao = texto(dados.descricao, 4000);
  if (veio('ingredientes')) colunas.ingredientes = texto(dados.ingredientes, 2000);
  if (veio('alergenicos')) colunas.alergenicos = texto(dados.alergenicos, 1000);

  /* --- Preços (sempre em centavos) --- */
  if (obrigatorio('precoVarejo')) {
    const preco = inteiroOuNulo(dados.precoVarejo);
    if (!Number.isFinite(preco) || preco <= 0) {
      erros.precoVarejo = 'Informe o preço de venda.';
    } else if (preco > 1_000_000) {
      // R$ 10.000,00 em centavos. Não é limite de negócio, é rede contra
      // digitar o preço em reais onde se espera centavos.
      erros.precoVarejo = 'Esse preço parece alto demais. Confira o valor.';
    } else {
      colunas.preco_varejo = preco;
    }
  }

  for (const [campo, coluna, rotulo] of [
    ['precoAtacado', 'preco_atacado', 'atacado'],
    ['precoPromocional', 'preco_promocional', 'promocional'],
  ]) {
    if (!veio(campo)) continue;

    const preco = inteiroOuNulo(dados[campo]);

    if (preco === null) {
      colunas[coluna] = null;
    } else if (!Number.isFinite(preco) || preco <= 0) {
      erros[campo] = `O preço ${rotulo} precisa ser maior que zero.`;
    } else {
      colunas[coluna] = preco;
    }
  }

  // A comparação só é possível quando os dois preços estão em jogo. Numa
  // edição parcial que mexe só na promoção, o varejo vem do banco — por isso
  // `compararPrecos` é chamada de novo, com o produto atual em mãos.
  Object.assign(erros, compararPrecos(colunas));

  /* --- Validade da promoção --- */
  if (veio('promocaoAte')) {
    const valor = texto(dados.promocaoAte, 40);

    if (!valor) {
      colunas.promocao_ate = null;
    } else {
      const data = new Date(valor);
      if (Number.isNaN(data.getTime())) {
        erros.promocaoAte = 'Data inválida.';
      } else {
        colunas.promocao_ate = data.toISOString();
      }
    }
  }

  /* --- Peso e mínimo de atacado --- */
  if (veio('pesoGramas')) {
    const peso = inteiroOuNulo(dados.pesoGramas);
    if (peso === null) {
      colunas.peso_gramas = null;
    } else if (!Number.isFinite(peso) || peso <= 0) {
      erros.pesoGramas = 'O peso precisa ser maior que zero.';
    } else {
      colunas.peso_gramas = peso;
    }
  }

  if (veio('minimoAtacado')) {
    const minimo = inteiroOuNulo(dados.minimoAtacado);
    if (minimo === null) {
      colunas.minimo_atacado = 1;
    } else if (!Number.isFinite(minimo) || minimo < 1) {
      erros.minimoAtacado = 'O mínimo de atacado é 1.';
    } else {
      colunas.minimo_atacado = minimo;
    }
  }

  /* --- Selos e publicação --- */
  for (const [campo, coluna] of [
    ['destaque', 'destaque'],
    ['maisVendido', 'mais_vendido'],
    ['novidade', 'novidade'],
    ['sazonal', 'sazonal'],
    ['publicado', 'publicado'],
  ]) {
    if (veio(campo)) colunas[coluna] = Boolean(dados[campo]);
  }

  return { colunas, erros };
}

/** Regras que dependem de dois preços ao mesmo tempo. */
function compararPrecos({ preco_varejo, preco_atacado, preco_promocional }) {
  const erros = {};
  if (preco_varejo == null) return erros;

  if (preco_atacado != null && preco_atacado >= preco_varejo) {
    erros.precoAtacado = 'O preço de atacado precisa ser menor que o de varejo.';
  }

  if (preco_promocional != null && preco_promocional >= preco_varejo) {
    erros.precoPromocional = 'A promoção precisa ser menor que o preço normal.';
  }

  return erros;
}

function recusar(erros) {
  const primeiro = Object.keys(erros)[0];
  const erro = new ErroCatalogo(erros[primeiro], 422, primeiro);
  erro.erros = erros;
  return erro;
}

/* =============================================================================
 * LEITURA
 * ========================================================================== */

/**
 * Lista o catálogo para o painel.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.busca]
 * @param {string} [opcoes.categoria] - slug
 * @param {'publicados'|'rascunhos'|'arquivados'|'todos'} [opcoes.situacao]
 */
export async function listarProdutos(opcoes = {}) {
  const { busca = '', categoria = '', situacao = 'ativos', limite = 100 } = opcoes;

  const filtros = {};

  // Arquivado é o padrão ESCONDIDO: quem arquivou não quer ver no dia a dia.
  if (situacao === 'arquivados') {
    filtros.arquivado_em = 'not.is.null';
  } else if (situacao !== 'todos') {
    filtros.arquivado_em = 'is.null';
    if (situacao === 'publicados') filtros.publicado = 'is.true';
    if (situacao === 'rascunhos') filtros.publicado = 'is.false';
  }

  if (busca.trim()) {
    // `*` é o curinga do PostgREST; `ilike` ignora maiúsculas e acentos não.
    filtros.nome = `ilike.*${busca.trim().replace(/[̀-ͯ]/g, '')}*`;
  }

  if (categoria) {
    const cat = await selecionarUm('categories', {
      colunas: 'id',
      filtros: { slug: `eq.${categoria}` },
    });
    // Categoria inexistente não pode devolver o catálogo inteiro.
    filtros.categoria_id = cat ? `eq.${cat.id}` : 'eq.00000000-0000-0000-0000-000000000000';
  }

  const linhas = await selecionar('products', {
    colunas: COLUNAS_LISTA,
    filtros,
    ordenar: 'nome.asc',
    limite: Math.min(Math.max(1, Number(limite) || 100), 200),
  });

  return linhas.map(formatarProduto);
}

/**
 * Categorias para o formulário e para o filtro.
 *
 * Difere da lista pública (`product-service.listarCategorias`) em dois
 * pontos que importam só aqui: devolve o `id` — que é o que o produto grava —
 * e inclui as categorias inativas, para não sumir com a categoria de um
 * produto que já existe.
 */
export async function listarCategorias() {
  const linhas = await selecionar('categories', {
    colunas: 'id,slug,nome,ativa,em_breve,ordem',
    ordenar: 'ordem.asc',
    limite: 50,
  });

  return linhas.map((c) => ({
    id: c.id,
    slug: c.slug,
    nome: c.nome,
    ativa: c.ativa,
    emBreve: c.em_breve,
  }));
}

/** Um produto, com os campos longos de descrição. */
export async function obterProduto(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;

  const linha = await selecionarUm('products', {
    colunas: COLUNAS_DETALHE,
    filtros: { id: `eq.${id}` },
  });

  return formatarProduto(linha);
}

/* =============================================================================
 * ESCRITA
 * ========================================================================== */

/** Impede dois produtos com o mesmo endereço. */
async function slugEmUso(slug, exceto = null) {
  const existente = await selecionarUm('products', {
    colunas: 'id',
    filtros: { slug: `eq.${slug}` },
  });

  return Boolean(existente) && existente.id !== exceto;
}

/**
 * Cadastra um produto.
 *
 * O produto nasce DESPUBLICADO quando nada é dito. Publicar é uma decisão
 * consciente — ninguém descobre um cadastro pela metade no ar porque esqueceu
 * de marcar uma caixa.
 */
export async function criarProduto(dados = {}, { usuarioId = null } = {}) {
  const { colunas, erros } = validarProduto(dados, { parcial: false });

  if (Object.keys(erros).length > 0) throw recusar(erros);

  if (await slugEmUso(colunas.slug)) {
    throw new ErroCatalogo(
      'Já existe um produto com esse endereço. Mude o nome ou o endereço.',
      409,
      'slug'
    );
  }

  const categoria = await selecionarUm('categories', {
    colunas: 'id',
    filtros: { id: `eq.${colunas.categoria_id}` },
  });

  if (!categoria) {
    throw new ErroCatalogo('Categoria não encontrada.', 422, 'categoriaId');
  }

  if (colunas.publicado === undefined) colunas.publicado = false;

  let criado;
  try {
    [criado] = await inserir('products', colunas);
  } catch (erro) {
    throw traduzirErroBanco(erro);
  }

  // O gatilho `ao_criar_produto` já criou a ficha de estoque zerada. Se a
  // Fefê informou quantidade inicial, ela entra como movimento de entrada —
  // assim o histórico começa explicado, não do nada.
  const inicial = inteiroOuNulo(dados.estoqueInicial);

  if (Number.isFinite(inicial) && inicial > 0) {
    await chamarFuncao('ajustar_estoque', {
      p_produto_id: criado.id,
      p_tipo: 'entrada',
      p_quantidade: inicial,
      p_motivo: 'Estoque inicial do cadastro',
      p_usuario_id: usuarioId,
    }).catch((erro) => {
      // Produto cadastrado com estoque zero é recuperável pela tela de
      // estoque; derrubar o cadastro inteiro por causa disso, não.
      console.error('[catalogo] Estoque inicial não aplicado:', erro.message);
    });
  }

  return obterProduto(criado.id);
}

/** Edita um produto existente. */
export async function atualizarProduto(id, dados = {}) {
  const atual = await obterProduto(id);

  if (!atual) {
    throw new ErroCatalogo('Produto não encontrado.', 404);
  }

  const { colunas, erros } = validarProduto(dados, { parcial: true });

  if (Object.keys(erros).length > 0) throw recusar(erros);

  if (Object.keys(colunas).length === 0) {
    throw new ErroCatalogo('Nada para alterar.', 422);
  }

  // Mexer só na promoção ainda precisa ser comparado com o varejo que está
  // gravado. Sem isso, a validação passaria e o banco recusaria depois.
  const errosCruzados = compararPrecos({
    preco_varejo: colunas.preco_varejo ?? atual.precoVarejo,
    preco_atacado:
      colunas.preco_atacado !== undefined ? colunas.preco_atacado : atual.precoAtacado,
    preco_promocional:
      colunas.preco_promocional !== undefined
        ? colunas.preco_promocional
        : atual.precoPromocional,
  });

  if (Object.keys(errosCruzados).length > 0) throw recusar(errosCruzados);

  if (colunas.slug && (await slugEmUso(colunas.slug, id))) {
    throw new ErroCatalogo(
      'Já existe outro produto com esse endereço.',
      409,
      'slug'
    );
  }

  try {
    await atualizar('products', { id: `eq.${id}` }, colunas);
  } catch (erro) {
    throw traduzirErroBanco(erro);
  }

  return obterProduto(id);
}

/**
 * Arquiva um produto.
 *
 * ⚠️ POR QUE ARQUIVAR EM VEZ DE APAGAR
 *   `order_items` guarda o produto_id dos pedidos antigos. Apagar a linha
 *   transformaria o histórico de vendas em "produto removido" — e o
 *   faturamento por produto do dashboard perderia o passado.
 *
 *   Arquivar tira do site e do painel do dia a dia, mantendo o histórico
 *   inteiro. É reversível; apagar não é.
 */
export async function arquivarProduto(id) {
  const produto = await obterProduto(id);

  if (!produto) throw new ErroCatalogo('Produto não encontrado.', 404);

  if (produto.arquivado) {
    return { ...produto, mensagem: 'Este produto já estava arquivado.' };
  }

  await atualizar(
    'products',
    { id: `eq.${id}` },
    { arquivado_em: new Date().toISOString(), publicado: false }
  );

  return obterProduto(id);
}

/** Tira o produto do arquivo. Volta como rascunho, não publicado. */
export async function restaurarProduto(id) {
  const produto = await obterProduto(id);

  if (!produto) throw new ErroCatalogo('Produto não encontrado.', 404);

  await atualizar('products', { id: `eq.${id}` }, { arquivado_em: null });

  return obterProduto(id);
}

/* =============================================================================
 * FOTOS
 * ========================================================================== */

export const TAMANHO_MAXIMO_FOTO_BYTES = TAMANHO_MAXIMO_PADRAO;
export const TIPOS_FOTO_PERMITIDOS = TIPOS_IMAGEM;

/**
 * Recebe uma foto do painel e a vincula ao produto.
 *
 * A foto vai para um bucket PÚBLICO: é feita para aparecer na loja. O que
 * continua restrito é gravar — só a chave de serviço, usada por este código
 * atrás de `exigirAdmin`, consegue subir arquivo.
 */
export async function enviarFoto(produtoId, arquivo = {}) {
  const produto = await obterProduto(produtoId);

  if (!produto) throw new ErroCatalogo('Produto não encontrado.', 404);

  if (produto.fotos.length >= 8) {
    throw new ErroCatalogo('São no máximo 8 fotos por produto.', 422, 'arquivo');
  }

  let validado;
  try {
    validado = validarUpload(arquivo, {
      permitidos: TIPOS_FOTO_PERMITIDOS,
      maximoBytes: TAMANHO_MAXIMO_FOTO_BYTES,
      mensagemTipo: 'Envie uma imagem JPG, PNG ou WEBP.',
      nomePadrao: 'foto',
    });
  } catch (erro) {
    if (erro instanceof ErroUpload) {
      throw new ErroCatalogo(erro.message, erro.status, 'arquivo');
    }
    throw erro;
  }

  // O carimbo de tempo no nome evita que subir outra foto do mesmo produto
  // sobrescreva a anterior — e, de quebra, derruba o cache do navegador.
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const caminho = `${produto.slug}/${carimbo}.${validado.extensao}`;

  try {
    await enviarParaStorage(BUCKET_FOTOS, caminho, validado.conteudo, validado.tipo);
  } catch (erro) {
    if (erro instanceof ErroUpload) {
      throw new ErroCatalogo(erro.message, erro.status, 'arquivo');
    }
    throw erro;
  }

  // O texto alternativo é obrigatório no banco — é o que um leitor de tela
  // anuncia. Sem descrição informada, o nome do produto é melhor que nada.
  const alt = texto(arquivo.alt, 160) || produto.nome;
  const ordem = produto.fotos.reduce((maior, f) => Math.max(maior, f.ordem), -1) + 1;

  try {
    const [foto] = await inserir('product_images', {
      produto_id: produtoId,
      url: urlPublica(BUCKET_FOTOS, caminho),
      alt,
      ordem,
      // A primeira foto vira a principal sozinha: um produto sem foto
      // principal não aparece direito na vitrine.
      principal: produto.fotos.length === 0,
    });

    return { foto, produto: await obterProduto(produtoId) };
  } catch (erro) {
    // O arquivo já subiu, mas o registro falhou. Sem apagar, ele ficaria no
    // bucket para sempre, sem nada apontando para ele.
    await apagarDoStorage(BUCKET_FOTOS, caminho);
    throw traduzirErroBanco(erro);
  }
}

/** Define qual foto representa o produto na vitrine. */
export async function definirFotoPrincipal(produtoId, fotoId) {
  const produto = await obterProduto(produtoId);

  if (!produto) throw new ErroCatalogo('Produto não encontrado.', 404);

  if (!produto.fotos.some((f) => f.id === fotoId)) {
    throw new ErroCatalogo('Foto não encontrada neste produto.', 404);
  }

  // Existe um índice único que permite UMA principal por produto. Por isso a
  // ordem importa: primeiro desmarca todas, depois marca a escolhida.
  await atualizar('product_images', { produto_id: `eq.${produtoId}` }, { principal: false });
  await atualizar('product_images', { id: `eq.${fotoId}` }, { principal: true });

  return obterProduto(produtoId);
}

/** Remove a foto do produto e o arquivo do Storage. */
export async function removerFoto(produtoId, fotoId) {
  const produto = await obterProduto(produtoId);

  if (!produto) throw new ErroCatalogo('Produto não encontrado.', 404);

  const foto = produto.fotos.find((f) => f.id === fotoId);

  if (!foto) throw new ErroCatalogo('Foto não encontrada neste produto.', 404);

  await remover('product_images', { id: `eq.${fotoId}` });

  // Se a principal saiu, a próxima da fila assume — senão o produto ficaria
  // com fotos e nenhuma delas marcada para a vitrine.
  const restantes = produto.fotos.filter((f) => f.id !== fotoId);

  if (foto.principal && restantes.length > 0) {
    await atualizar('product_images', { id: `eq.${restantes[0].id}` }, { principal: true });
  }

  await apagarArquivoDaFoto(foto.url);

  return obterProduto(produtoId);
}

/**
 * Apaga o arquivo correspondente à foto.
 *
 * Fotos cadastradas antes do painel podem apontar para endereços de fora
 * (a semente usa imagens de exemplo). Nesse caso não há o que apagar.
 */
async function apagarArquivoDaFoto(url) {
  const marcador = `/object/public/${BUCKET_FOTOS}/`;
  const posicao = String(url || '').indexOf(marcador);

  if (posicao === -1) return;

  await apagarDoStorage(BUCKET_FOTOS, url.slice(posicao + marcador.length));
}

/* =============================================================================
 * TRADUÇÃO DOS ERROS DO BANCO
 *
 * Rede de segurança: se uma validação daqui deixar passar algo, a restrição
 * do banco pega — e o usuário merece ler português, não o nome da constraint.
 * ========================================================================== */

const POR_RESTRICAO = {
  products_slug_formato: ['slug', 'O endereço só aceita letras minúsculas, números e hífen.'],
  products_nome_tamanho: ['nome', 'O nome precisa ter entre 2 e 160 letras.'],
  products_preco_varejo_positivo: ['precoVarejo', 'O preço precisa ser maior que zero.'],
  products_atacado_menor: ['precoAtacado', 'O preço de atacado precisa ser menor que o de varejo.'],
  products_promocional_menor: ['precoPromocional', 'A promoção precisa ser menor que o preço normal.'],
  products_peso_positivo: ['pesoGramas', 'O peso precisa ser maior que zero.'],
  products_minimo_atacado_positivo: ['minimoAtacado', 'O mínimo de atacado é 1.'],
  product_images_alt_preenchido: ['alt', 'Descreva a foto em poucas palavras.'],
};

function traduzirErroBanco(erro) {
  if (!(erro instanceof ErroBanco)) return erro;

  const mensagem = String(erro.detalhes?.message || erro.message || '');

  for (const [restricao, [campo, texto]] of Object.entries(POR_RESTRICAO)) {
    if (mensagem.includes(restricao)) return new ErroCatalogo(texto, 422, campo);
  }

  if (erro.status === 409 || mensagem.includes('duplicate key')) {
    return new ErroCatalogo('Já existe um produto com esse endereço.', 409, 'slug');
  }

  console.error('[catalogo] Erro não mapeado do banco:', mensagem);

  return new ErroCatalogo('Não conseguimos salvar agora. Tente de novo.', 503);
}

export default {
  listarProdutos,
  listarCategorias,
  obterProduto,
  criarProduto,
  atualizarProduto,
  arquivarProduto,
  restaurarProduto,
  enviarFoto,
  definirFotoPrincipal,
  removerFoto,
  validarProduto,
  gerarSlug,
  ErroCatalogo,
};
