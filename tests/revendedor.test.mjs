/**
 * tests/revendedor.test.mjs
 * -----------------------------------------------------------------------------
 * Fase 10 — o caminho do parceiro, do cadastro ao preço no pedido.
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR
 *
 *   1. Ninguém se aprova sozinho. O formulário público cria candidatura
 *      `pendente` e nada mais.
 *   2. O desconto do parceiro REALMENTE muda o preço gravado no pedido —
 *      até a Fase 10 a coluna existia e não fazia nada.
 *   3. O pedido mínimo é recusado pelo SERVIDOR. Antes disso ele só
 *      desabilitava um botão, e botão desabilitado não é regra.
 *   4. Suspender devolve a conta ao preço de varejo.
 *
 * ⚠️ ESTA SUÍTE ESCREVE NO BANCO
 *   Cria duas contas temporárias (uma admin, uma parceira) e um produto de
 *   teste publicado, porque só produto publicado entra em pedido. Tudo é
 *   apagado no `finally`.
 */

import { postCandidatura, getMinhaCandidatura } from '../backend/controllers/reseller-controller.js';
import {
  getRevendedoresAdmin,
  patchRevendedor,
} from '../backend/controllers/admin-revendedores-controller.js';
import { postPedido } from '../backend/controllers/order-controller.js';
import {
  bancoConfigurado,
  verificarConexao,
  selecionar,
  selecionarUm,
  inserir,
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
  console.log('\n  ⊘ Banco não configurado — suíte de revendedores pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte de revendedores pulada.\n`);
  process.exit(0);
}

// A visão só existe depois do arquivo 15. Dizer isso é mais útil do que
// falhar em doze verificações seguidas.
try {
  await selecionar('revendedores_admin', { colunas: 'id', limite: 1 });
} catch {
  console.log(
    '\n  ⊘ A visão revendedores_admin não existe neste banco.' +
      '\n    Execute database/15-revendedores.sql no SQL Editor do Supabase.' +
      '\n    Suíte de revendedores pulada.\n'
  );
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

const comToken = (t) => ({ headers: { authorization: `Bearer ${t}` } });

/** Cria uma conta confirmada e devolve { id, token }. */
async function criarConta(apelido) {
  const email = `${apelido}.${process.pid}@docefefe-testes.com`;
  const senha = 'SenhaDeTeste#2026';

  const criacao = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome: apelido },
    }),
  });

  if (!criacao.ok) throw new Error(`Falha ao criar ${apelido}: ${criacao.status}`);

  const id = (await criacao.json()).id;

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });

  return { id, token: (await login.json()).access_token, email };
}

async function apagarConta(id) {
  if (!id) return;

  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

/* -----------------------------------------------------------------------------
 * Dados de teste
 * -------------------------------------------------------------------------- */

const PRECO_VAREJO = 1000;   // R$ 10,00
const PRECO_ATACADO = 700;   // R$  7,00
const DESCONTO = 10;         // 10% sobre o atacado
const PRECO_PARCEIRO = 630;  // 700 − floor(700 × 10 / 100)
const PEDIDO_MINIMO = 2000;  // R$ 20,00

let admin = null;
let parceira = null;
let produtoId = null;
let produtoSlug = null;
let candidaturaId = null;
const pedidosCriados = [];

try {
  console.log('\n── Preparação ──\n');

  admin = await criarConta('admin.revenda');
  await atualizar('profiles', { id: `eq.${admin.id}` }, { perfil: 'admin' });

  parceira = await criarConta('parceira');

  verificar('contas de teste criadas', Boolean(admin.token && parceira.token));

  const categoria = await selecionarUm('categories', {
    colunas: 'id',
    ordenar: 'ordem.asc',
  });

  produtoSlug = `zzz-teste-atacado-${process.pid}`;

  const [produto] = await inserir('products', {
    categoria_id: categoria.id,
    slug: produtoSlug,
    nome: `ZZZ Teste atacado ${process.pid}`,
    preco_varejo: PRECO_VAREJO,
    preco_atacado: PRECO_ATACADO,
    minimo_atacado: 1,
    publicado: true,
  });

  produtoId = produto.id;

  // O gatilho criou a ficha de estoque zerada; sem saldo nenhum pedido passa.
  await chamarFuncao('ajustar_estoque', {
    p_produto_id: produtoId,
    p_tipo: 'entrada',
    p_quantidade: 50,
    p_motivo: 'Suíte de testes',
    p_usuario_id: null,
  });

  verificar('produto de teste com preço de atacado criado', Boolean(produtoId));

  /* ===========================================================================
   * 1. SEM APROVAÇÃO NÃO HÁ ATACADO
   * ======================================================================== */

  console.log('\n── Antes da aprovação ──\n');

  const precoAntes = await chamarFuncao('preco_para_usuario', {
    p_produto_id: produtoId,
    p_usuario_id: parceira.id,
  });

  verificar(
    'conta sem candidatura paga o varejo',
    precoAntes === PRECO_VAREJO,
    `obtido: ${precoAntes}`
  );

  const precoVisitante = await chamarFuncao('preco_para_usuario', {
    p_produto_id: produtoId,
    p_usuario_id: null,
  });

  verificar(
    'visitante sem conta paga o varejo',
    precoVisitante === PRECO_VAREJO,
    `obtido: ${precoVisitante}`
  );

  /* ===========================================================================
   * 2. CANDIDATURA
   * ======================================================================== */

  console.log('\n── Candidatura ──\n');

  const semSessao = await postCandidatura({
    req: { headers: {} },
    corpo: {
      nomeResponsavel: 'Alguém',
      nomeEstabelecimento: 'Loja Fantasma',
      whatsapp: '11999998888',
      cidade: 'São Paulo',
      consentimento: true,
    },
  });

  verificar(
    'candidatura sem sessão devolve 401',
    semSessao.status === 401,
    `obtido: ${semSessao.status}`
  );

  const candidatura = await postCandidatura({
    req: comToken(parceira.token),
    corpo: {
      nomeResponsavel: 'Maria Parceira',
      nomeEstabelecimento: `ZZZ Café de Teste ${process.pid}`,
      whatsapp: '11988887777',
      cidade: 'São Paulo',
      estado: 'SP',
      tipoEstabelecimento: 'cafeteria',
      quantidadeEstimada: '50-100',
      // Tentativa de autoconcessão: estes campos não podem ser lidos.
      status: 'aprovado',
      desconto_percentual: 90,
      consentimento: true,
    },
  });

  verificar('candidatura é aceita', candidatura.status === 201, `obtido: ${candidatura.status}`);

  verificar(
    'candidatura nasce PENDENTE, mesmo pedindo "aprovado"',
    candidatura.corpo.candidatura?.status === 'pendente',
    `status: ${candidatura.corpo.candidatura?.status}`
  );

  const gravada = await selecionarUm('resellers', {
    colunas: 'id,status,desconto_percentual',
    filtros: { usuario_id: `eq.${parceira.id}` },
  });

  candidaturaId = gravada?.id;

  verificar(
    'o desconto gravado é ZERO, não o que foi enviado',
    Number(gravada?.desconto_percentual) === 0,
    `gravado: ${gravada?.desconto_percentual}`
  );

  const duplicada = await postCandidatura({
    req: comToken(parceira.token),
    corpo: {
      nomeResponsavel: 'Maria Parceira',
      nomeEstabelecimento: 'Outro nome',
      whatsapp: '11988887777',
      cidade: 'São Paulo',
      consentimento: true,
    },
  });

  verificar(
    'candidatura repetida devolve 409',
    duplicada.status === 409,
    `obtido: ${duplicada.status}`
  );

  const minha = await getMinhaCandidatura({ req: comToken(parceira.token) });

  verificar(
    'a pessoa consulta a própria situação',
    minha.corpo.candidatura?.status === 'pendente'
  );

  verificar(
    'pendente não mostra condições comerciais',
    minha.corpo.candidatura?.desconto === null,
    'prometer desconto antes da aprovação seria promessa de ninguém'
  );

  const precoPendente = await chamarFuncao('preco_para_usuario', {
    p_produto_id: produtoId,
    p_usuario_id: parceira.id,
  });

  verificar(
    'candidatura pendente NÃO baixa o preço',
    precoPendente === PRECO_VAREJO,
    `obtido: ${precoPendente}`
  );

  /* ===========================================================================
   * 3. APROVAÇÃO
   * ======================================================================== */

  console.log('\n── Aprovação ──\n');

  const semPermissao = await patchRevendedor({
    req: comToken(parceira.token),
    params: { id: candidaturaId },
    corpo: { status: 'aprovado', desconto: 90, pedidoMinimo: 0 },
  });

  verificar(
    'a própria candidata NÃO consegue se aprovar',
    semPermissao.status === 403,
    `obtido: ${semPermissao.status}`
  );

  const recusaSemMotivo = await patchRevendedor({
    req: comToken(admin.token),
    params: { id: candidaturaId },
    corpo: { status: 'recusado' },
  });

  verificar(
    'recusar sem motivo é recusado',
    recusaSemMotivo.status === 422,
    `obtido: ${recusaSemMotivo.status}`
  );

  const descontoAbsurdo = await patchRevendedor({
    req: comToken(admin.token),
    params: { id: candidaturaId },
    corpo: { status: 'aprovado', desconto: 99, pedidoMinimo: 0 },
  });

  verificar(
    'desconto acima de 90% é barrado',
    descontoAbsurdo.status === 422,
    `obtido: ${descontoAbsurdo.status}`
  );

  const aprovacao = await patchRevendedor({
    req: comToken(admin.token),
    params: { id: candidaturaId },
    corpo: { status: 'aprovado', desconto: DESCONTO, pedidoMinimo: PEDIDO_MINIMO },
  });

  verificar('administradora aprova', aprovacao.status === 200, `obtido: ${aprovacao.status}`);

  const precoAprovada = await chamarFuncao('preco_para_usuario', {
    p_produto_id: produtoId,
    p_usuario_id: parceira.id,
  });

  verificar(
    `o desconto de ${DESCONTO}% muda o preço: ${PRECO_ATACADO} → ${PRECO_PARCEIRO}`,
    precoAprovada === PRECO_PARCEIRO,
    `obtido: ${precoAprovada}`
  );

  /* ===========================================================================
   * 4. PEDIDO MÍNIMO — A REGRA QUE SÓ EXISTIA NO NAVEGADOR
   * ======================================================================== */

  console.log('\n── Pedido mínimo ──\n');

  const dadosPedido = (quantidade) => ({
    nome: 'Maria Parceira',
    whatsapp: '11988887777',
    tipoEntrega: 'retirada',
    consentimento: true,
    itens: [{ slug: produtoSlug, quantidade }],
  });

  // 2 × 630 = 1260, abaixo dos 2000 exigidos.
  const abaixoDoMinimo = await postPedido({
    req: comToken(parceira.token),
    corpo: dadosPedido(2),
  });

  if (abaixoDoMinimo.corpo.pedido?.codigo) {
    pedidosCriados.push(abaixoDoMinimo.corpo.pedido.codigo);
  }

  verificar(
    'pedido abaixo do mínimo é RECUSADO pelo servidor',
    abaixoDoMinimo.status >= 400,
    `obtido: ${abaixoDoMinimo.status} — o navegador não é a barreira`
  );

  verificar(
    'a mensagem diz quanto falta',
    /mínimo|minimo|R\$/i.test(abaixoDoMinimo.corpo.mensagem || ''),
    abaixoDoMinimo.corpo.mensagem
  );

  const estoqueIntacto = await selecionarUm('inventory', {
    colunas: 'quantidade',
    filtros: { produto_id: `eq.${produtoId}` },
  });

  verificar(
    'a recusa não consumiu estoque (transação revertida)',
    estoqueIntacto?.quantidade === 50,
    `saldo: ${estoqueIntacto?.quantidade}`
  );

  // 4 × 630 = 2520, acima do mínimo.
  const aceito = await postPedido({
    req: comToken(parceira.token),
    corpo: dadosPedido(4),
  });

  const codigo = aceito.corpo.pedido?.codigo;
  if (codigo) pedidosCriados.push(codigo);

  verificar('pedido acima do mínimo é aceito', aceito.status === 201, `obtido: ${aceito.status}`);

  verificar(
    'o pedido é marcado como atacado',
    aceito.corpo.pedido?.ehAtacado === true,
    JSON.stringify(aceito.corpo.pedido?.ehAtacado)
  );

  const itemGravado = await selecionarUm('order_items', {
    colunas: 'preco_unitario_centavos',
    filtros: { produto_slug: `eq.${produtoSlug}` },
    ordenar: 'criado_em.desc',
  });

  verificar(
    'o preço GRAVADO no pedido é o do parceiro',
    itemGravado?.preco_unitario_centavos === PRECO_PARCEIRO,
    `gravado: ${itemGravado?.preco_unitario_centavos}`
  );

  /* ===========================================================================
   * 5. SUSPENSÃO DEVOLVE AO VAREJO
   * ======================================================================== */

  console.log('\n── Suspensão ──\n');

  const suspensao = await patchRevendedor({
    req: comToken(admin.token),
    params: { id: candidaturaId },
    corpo: { status: 'suspenso' },
  });

  verificar('suspender funciona', suspensao.status === 200, `obtido: ${suspensao.status}`);

  const precoSuspensa = await chamarFuncao('preco_para_usuario', {
    p_produto_id: produtoId,
    p_usuario_id: parceira.id,
  });

  verificar(
    'parceira suspensa volta ao preço de varejo',
    precoSuspensa === PRECO_VAREJO,
    `obtido: ${precoSuspensa}`
  );

  const listagem = await getRevendedoresAdmin({
    req: comToken(admin.token),
    query: { status: 'suspenso' },
  });

  verificar(
    'a listagem do painel encontra a parceira suspensa',
    listagem.corpo.revendedores?.some((r) => r.id === candidaturaId)
  );
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  for (const codigo of pedidosCriados) {
    await remover('orders', { codigo: `eq.${codigo}` }).catch(() => {});
  }

  if (candidaturaId) {
    await remover('resellers', { id: `eq.${candidaturaId}` }).catch(() => {});
  }

  if (produtoId) {
    await remover('products', { id: `eq.${produtoId}` }).catch(() => {});

    const sobrou = await selecionarUm('products', {
      colunas: 'id',
      filtros: { id: `eq.${produtoId}` },
    }).catch(() => null);

    verificar('produto de teste removido', !sobrou);
  }

  await apagarConta(admin?.id);
  await apagarConta(parceira?.id);

  const contaSobrou = await selecionarUm('profiles', {
    colunas: 'id',
    filtros: { id: `eq.${parceira?.id}` },
  }).catch(() => null);

  verificar('contas de teste removidas', !contaSobrou);
}

encerrar();
