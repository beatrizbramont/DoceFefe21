/**
 * tests/admin-catalogo.test.mjs
 * -----------------------------------------------------------------------------
 * Fase 9 — o caminho completo do catálogo pelo painel, com uma conta de
 * administradora de verdade.
 *
 * O QUE ESTA SUÍTE PROVA
 *   tests/admin.test.mjs prova que ninguém de fora entra. Esta prova o
 *   contrário: que quem TEM permissão consegue fazer o trabalho — cadastrar,
 *   publicar, mexer no estoque e arquivar — e que as regras continuam
 *   valendo mesmo para ela.
 *
 * ⚠️ ESTA SUÍTE ESCREVE NO BANCO
 *   Cria uma conta temporária, promove a administradora, cadastra um produto
 *   de teste e apaga tudo no fim. O produto chega a ser publicado por alguns
 *   segundos — é o único jeito de provar que publicar funciona. O nome deixa
 *   claro que não é para vender, e a limpeza roda em `finally`.
 */

import {
  getProdutosAdmin,
  postProduto,
  patchProduto,
  deleteProduto,
  getEstoque,
  postMovimentoEstoque,
  getMovimentosEstoque,
  patchConfiguracaoEstoque,
} from '../backend/controllers/admin-catalogo-controller.js';
import {
  getResumoAdmin,
  getClientesAdmin,
} from '../backend/controllers/admin-painel-controller.js';
import {
  bancoConfigurado,
  verificarConexao,
  selecionarUm,
  atualizar,
  remover,
  chamarFuncao,
} from '../services/database.js';
import { lerVariaveisDeAmbiente } from '../services/env.js';

const env = lerVariaveisDeAmbiente();

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

const encerrar = () => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(falhas > 0 ? 1 : 0);
};

/* -----------------------------------------------------------------------------
 * Pré-requisitos
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte do catálogo pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte do catálogo pulada.\n`);
  process.exit(0);
}

// A Fase 9 depende das funções criadas em database/14-painel-admin.sql. Se o
// arquivo ainda não foi executado, dizer isso é mais útil que falhar em
// quinze verificações seguidas.
try {
  await chamarFuncao('resumo_admin', { p_dias: 7 });
} catch {
  console.log(
    '\n  ⊘ A função resumo_admin não existe neste banco.' +
      '\n    Execute database/14-painel-admin.sql no SQL Editor do Supabase.' +
      '\n    Suíte do catálogo pulada.\n'
  );
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

const comToken = (t) => ({ headers: { authorization: `Bearer ${t}` } });

const EMAIL = `admin.catalogo.teste.${process.pid}@docefefe-testes.com`;
const SENHA = 'SenhaDeTeste#2026';
const NOME_PRODUTO = `ZZZ Produto de teste ${process.pid} — não vender`;

let usuarioId = null;
let token = null;
let produtoId = null;

/* =============================================================================
 * PREPARAÇÃO: uma administradora de verdade
 *
 * Promover acontece pelo banco, com a chave de serviço — exatamente como o
 * arquivo database/13-criar-admin.sql faz. Não existe rota que promova
 * ninguém, e é assim que tem que ser.
 * ========================================================================== */

try {
  console.log('\n── Preparação ──\n');

  const criacao = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: EMAIL,
      password: SENHA,
      email_confirm: true,
      user_metadata: { nome: 'Admin de Teste' },
    }),
  });

  if (!criacao.ok) throw new Error(`Falha ao criar usuário: ${criacao.status}`);

  usuarioId = (await criacao.json()).id;

  await atualizar('profiles', { id: `eq.${usuarioId}` }, { perfil: 'admin' });

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });

  token = (await login.json()).access_token;

  verificar('conta administradora criada e autenticada', Boolean(token));

  const perfil = await selecionarUm('profiles', {
    colunas: 'perfil',
    filtros: { id: `eq.${usuarioId}` },
  });

  verificar('perfil promovido a admin', perfil?.perfil === 'admin', perfil?.perfil);

  /* ===========================================================================
   * 1. CADASTRO
   * ======================================================================== */

  console.log('\n── Cadastro de produto ──\n');

  const categoria = await selecionarUm('categories', {
    colunas: 'id,slug',
    ordenar: 'ordem.asc',
  });

  if (!categoria) throw new Error('Nenhuma categoria cadastrada no banco.');

  const criado = await postProduto({
    req: comToken(token),
    corpo: {
      nome: NOME_PRODUTO,
      categoriaId: categoria.id,
      descricaoCurta: 'Produto criado por teste automatizado.',
      precoVarejo: 1000,
      estoqueInicial: 10,
    },
  });

  produtoId = criado.corpo.produto?.id || null;

  verificar('administradora cadastra produto', criado.status === 201, `obtido: ${criado.status}`);

  verificar(
    'produto nasce DESPUBLICADO',
    criado.corpo.produto?.publicado === false,
    'publicar precisa ser uma decisão consciente'
  );

  verificar(
    'slug é gerado a partir do nome',
    typeof criado.corpo.produto?.slug === 'string' &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(criado.corpo.produto.slug),
    criado.corpo.produto?.slug
  );

  verificar(
    'estoque inicial virou saldo',
    criado.corpo.produto?.estoque?.quantidade === 10,
    `saldo: ${criado.corpo.produto?.estoque?.quantidade}`
  );

  const movimentosIniciais = await getMovimentosEstoque({
    req: comToken(token),
    params: { id: produtoId },
  });

  verificar(
    'estoque inicial deixou rastro no histórico',
    movimentosIniciais.corpo.movimentos?.[0]?.tipo === 'entrada',
    JSON.stringify(movimentosIniciais.corpo.movimentos?.[0] || {})
  );

  /* ===========================================================================
   * 2. REGRAS CONTINUAM VALENDO PARA QUEM TEM PERMISSÃO
   * ======================================================================== */

  console.log('\n── Regras não cedem ao perfil ──\n');

  const duplicado = await postProduto({
    req: comToken(token),
    corpo: {
      nome: NOME_PRODUTO,
      categoriaId: categoria.id,
      precoVarejo: 1000,
    },
  });

  verificar(
    'endereço repetido devolve 409',
    duplicado.status === 409,
    `obtido: ${duplicado.status}`
  );

  const promocaoInvalida = await patchProduto({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { precoPromocional: 5000 },
  });

  verificar(
    'promoção maior que o varejo devolve 422',
    promocaoInvalida.status === 422,
    `obtido: ${promocaoInvalida.status}`
  );

  verificar(
    'o erro aponta o campo da promoção',
    Boolean(promocaoInvalida.corpo.erros?.precoPromocional),
    JSON.stringify(promocaoInvalida.corpo.erros || {})
  );

  const categoriaInventada = await patchProduto({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { categoriaId: '00000000-0000-0000-0000-000000000000' },
  });

  verificar(
    'categoria inexistente é recusada',
    categoriaInventada.status >= 400,
    `obtido: ${categoriaInventada.status}`
  );

  /* ===========================================================================
   * 3. PUBLICAR E DESPUBLICAR
   * ======================================================================== */

  console.log('\n── Publicação ──\n');

  const publicado = await patchProduto({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { publicado: true },
  });

  verificar('publicar funciona', publicado.corpo.produto?.publicado === true);

  const noCatalogoPublico = await selecionarUm('catalogo_publico', {
    colunas: 'slug',
    filtros: { id: `eq.${produtoId}` },
  });

  verificar(
    'produto publicado aparece no catálogo público',
    Boolean(noCatalogoPublico),
    'a visão catalogo_publico precisa enxergá-lo'
  );

  // Tira do ar imediatamente: é um produto de teste numa loja de verdade.
  const despublicado = await patchProduto({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { publicado: false },
  });

  verificar('despublicar funciona', despublicado.corpo.produto?.publicado === false);

  const sumiuDoPublico = await selecionarUm('catalogo_publico', {
    colunas: 'slug',
    filtros: { id: `eq.${produtoId}` },
  });

  verificar('produto fora do ar some do catálogo público', !sumiuDoPublico);

  /* ===========================================================================
   * 4. ESTOQUE
   * ======================================================================== */

  console.log('\n── Estoque ──\n');

  const entrada = await postMovimentoEstoque({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { tipo: 'entrada', quantidade: 5, motivo: 'Teste' },
  });

  verificar(
    'entrada soma ao saldo',
    entrada.corpo.saldoApos === 15,
    `saldo: ${entrada.corpo.saldoApos}`
  );

  const contagem = await postMovimentoEstoque({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { tipo: 'ajuste', quantidade: 4, motivo: 'Contagem física' },
  });

  verificar(
    'contagem define o saldo absoluto',
    contagem.corpo.saldoApos === 4,
    `saldo: ${contagem.corpo.saldoApos}`
  );

  verificar(
    'o histórico guarda a diferença, não o total digitado',
    contagem.corpo.movimento === -11,
    `movimento: ${contagem.corpo.movimento}`
  );

  const saidaDemais = await postMovimentoEstoque({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { tipo: 'saida', quantidade: 99 },
  });

  verificar(
    'saída maior que o saldo é recusada',
    saidaDemais.status === 409,
    `obtido: ${saidaDemais.status}`
  );

  const saldoIntacto = await selecionarUm('inventory', {
    colunas: 'quantidade',
    filtros: { produto_id: `eq.${produtoId}` },
  });

  verificar(
    'saldo permanece intacto após a recusa',
    saldoIntacto?.quantidade === 4,
    `saldo: ${saldoIntacto?.quantidade}`
  );

  const semMudanca = await postMovimentoEstoque({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { tipo: 'ajuste', quantidade: 4 },
  });

  verificar(
    'contagem igual ao saldo atual é recusada (não gera movimento vazio)',
    semMudanca.status === 422,
    `obtido: ${semMudanca.status}`
  );

  const config = await patchConfiguracaoEstoque({
    req: comToken(token),
    params: { id: produtoId },
    corpo: { alertaMinimo: 3, sobEncomenda: false },
  });

  verificar('alerta mínimo é salvo', config.corpo.alertaMinimo === 3);

  const estoque = await getEstoque({ req: comToken(token), query: { busca: 'ZZZ Produto' } });

  verificar(
    'produto aparece na tela de estoque',
    estoque.corpo.produtos?.some((p) => p.id === produtoId),
    `${estoque.corpo.produtos?.length} produto(s) encontrados`
  );

  /* ===========================================================================
   * 5. LISTAGENS DO PAINEL
   * ======================================================================== */

  console.log('\n── Listagens ──\n');

  const lista = await getProdutosAdmin({
    req: comToken(token),
    query: { busca: 'ZZZ Produto', situacao: 'rascunhos' },
  });

  verificar(
    'o filtro de rascunhos encontra o produto despublicado',
    lista.corpo.produtos?.some((p) => p.id === produtoId)
  );

  verificar(
    'a lista traz as categorias para o formulário',
    Array.isArray(lista.corpo.categorias) && lista.corpo.categorias.length > 0
  );

  verificar(
    'as categorias trazem o id (sem ele o formulário não grava)',
    Boolean(lista.corpo.categorias?.[0]?.id)
  );

  const resumo = await getResumoAdmin({ req: comToken(token), query: { dias: 30 } });

  verificar('resumo responde', resumo.status === 200, `obtido: ${resumo.status}`);

  verificar(
    'faturamento é um número',
    Number.isFinite(resumo.corpo.resumo?.faturamento),
    `${resumo.corpo.resumo?.faturamento}`
  );

  verificar(
    'o catálogo contabiliza o rascunho',
    resumo.corpo.resumo?.catalogo?.rascunhos >= 1,
    `rascunhos: ${resumo.corpo.resumo?.catalogo?.rascunhos}`
  );

  const clientes = await getClientesAdmin({
    req: comToken(token),
    query: { busca: 'admin.catalogo.teste' },
  });

  verificar(
    'a busca de clientes acha pelo e-mail',
    clientes.corpo.clientes?.some((c) => c.id === usuarioId),
    `${clientes.corpo.clientes?.length} cliente(s)`
  );

  /* ===========================================================================
   * 6. ARQUIVAR E RESTAURAR
   * ======================================================================== */

  console.log('\n── Arquivamento ──\n');

  const arquivado = await deleteProduto({
    req: comToken(token),
    params: { id: produtoId },
    query: {},
  });

  verificar('arquivar funciona', arquivado.corpo.produto?.arquivado === true);

  const aindaExiste = await selecionarUm('products', {
    colunas: 'id',
    filtros: { id: `eq.${produtoId}` },
  });

  verificar(
    'arquivar NÃO apaga a linha (o histórico de vendas aponta para ela)',
    Boolean(aindaExiste)
  );

  const restaurado = await deleteProduto({
    req: comToken(token),
    params: { id: produtoId },
    query: { restaurar: '1' },
  });

  verificar('restaurar funciona', restaurado.corpo.produto?.arquivado === false);

  verificar(
    'produto restaurado volta como rascunho, não no ar',
    restaurado.corpo.produto?.publicado === false
  );
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  // Apagar o produto de teste é seguro: nenhum pedido aponta para ele. O
  // cascade leva junto fotos, estoque e movimentos.
  if (produtoId) {
    await remover('products', { id: `eq.${produtoId}` }).catch(() => {});

    const sobrou = await selecionarUm('products', {
      colunas: 'id',
      filtros: { id: `eq.${produtoId}` },
    }).catch(() => null);

    verificar('produto de teste removido', !sobrou);
  }

  if (usuarioId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuarioId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});

    const perfilSobrou = await selecionarUm('profiles', {
      colunas: 'id',
      filtros: { id: `eq.${usuarioId}` },
    }).catch(() => null);

    verificar('conta administradora de teste removida', !perfilSobrou);
  }
}

encerrar();
