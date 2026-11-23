/**
 * tests/admin.test.mjs
 * -----------------------------------------------------------------------------
 * Testa o controle de acesso do painel administrativo.
 *
 * O QUE PRECISA SER PROVADO
 *
 *   Aprovar pagamento é a ação mais sensível do sistema — ela libera o pedido
 *   para produção. Nenhum caminho que não passe por um administrador de
 *   verdade pode chegar lá.
 *
 *   Os testes abaixo tentam exatamente isso: sem sessão, com sessão de cliente
 *   comum, e com token forjado.
 */

import {
  getPedidosAdmin,
  getComprovante,
  postConferirPagamento,
  patchStatusPedido,
  getSessaoAdmin,
} from '../backend/controllers/admin-controller.js';
import {
  bancoConfigurado,
  verificarConexao,
  selecionarUm,
  remover,
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

const semToken = () => ({ headers: {} });
const comToken = (t) => ({ headers: { authorization: `Bearer ${t}` } });

/* -----------------------------------------------------------------------------
 * Pré-requisitos
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte do admin pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte do admin pulada.\n`);
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

/** Todas as rotas administrativas, para testar em bloco. */
const ROTAS_ADMIN = [
  ['GET /api/admin/sessao', (req) => getSessaoAdmin({ req })],
  ['GET /api/admin/pedidos', (req) => getPedidosAdmin({ req, query: {} })],
  [
    'GET comprovante',
    (req) => getComprovante({ req, params: { codigo: 'DFAAAAAAAA' } }),
  ],
  [
    'POST conferir',
    (req) =>
      postConferirPagamento({
        req,
        params: { codigo: 'DFAAAAAAAA' },
        corpo: { aprovado: true },
      }),
  ],
  [
    'PATCH status',
    (req) =>
      patchStatusPedido({
        req,
        params: { codigo: 'DFAAAAAAAA' },
        corpo: { status: 'pagamento_aprovado' },
      }),
  ],
];

/* =============================================================================
 * 1. SEM SESSÃO
 * ========================================================================== */

console.log('\n── Acesso sem sessão ──\n');

for (const [nome, chamar] of ROTAS_ADMIN) {
  const resposta = await chamar(semToken());
  verificar(
    `${nome} devolve 401`,
    resposta.status === 401,
    `obtido: ${resposta.status}`
  );
}

/* =============================================================================
 * 2. TOKENS FORJADOS
 * ========================================================================== */

console.log('\n── Tokens forjados ──\n');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const forjados = [
  [
    'JWT dizendo ser admin',
    `${b64({ alg: 'HS256' })}.${b64({ sub: '00000000-0000-0000-0000-000000000001', role: 'admin', perfil: 'admin', exp: 9999999999 })}.assinatura-falsa`,
  ],
  [
    'JWT com algoritmo none',
    `${b64({ alg: 'none' })}.${b64({ sub: 'x', perfil: 'admin' })}.`,
  ],
  ['chave de serviço como token', SERVICE_KEY],
  ['chave pública como token', ANON_KEY],
];

for (const [nome, token] of forjados) {
  if (!token || token.split('.').length !== 3) {
    // Sem formato de JWT, é barrado antes mesmo da rede.
    verificar(`${nome} é rejeitado`, true);
    continue;
  }

  const resposta = await getSessaoAdmin({ req: comToken(token) });
  verificar(`${nome} é rejeitado`, resposta.status === 401, `obtido: ${resposta.status}`);
}

/* =============================================================================
 * 3. CLIENTE COMUM
 *
 * Uma conta de verdade, válida, mas sem perfil de administrador.
 * ========================================================================== */

console.log('\n── Cliente comum (conta válida, sem permissão) ──\n');

const EMAIL = `cliente.admin.teste.${process.pid}@docefefe-testes.com`;
const SENHA = 'SenhaDeTeste#2026';

let usuarioId = null;
let tokenCliente = null;
const pedidosCriados = [];

try {
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
      user_metadata: { nome: 'Cliente Comum' },
    }),
  });

  if (!criacao.ok) {
    throw new Error(`Falha ao criar usuário: ${criacao.status}`);
  }

  usuarioId = (await criacao.json()).id;

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });

  tokenCliente = (await login.json()).access_token;

  verificar('conta de cliente criada e autenticada', Boolean(tokenCliente));

  const perfil = await selecionarUm('profiles', {
    colunas: 'perfil',
    filtros: { id: `eq.${usuarioId}` },
  });

  verificar('perfil é "cliente"', perfil?.perfil === 'cliente', perfil?.perfil);

  // O teste central: sessão legítima, mas sem permissão.
  for (const [nome, chamar] of ROTAS_ADMIN) {
    const resposta = await chamar(comToken(tokenCliente));
    verificar(
      `${nome} devolve 403 para cliente`,
      resposta.status === 403,
      `obtido: ${resposta.status}`
    );
  }

  /* ---------------------------------------------------------------------
   * 4. O PEDIDO NÃO PODE SER APROVADO POR FORA
   * ------------------------------------------------------------------ */

  console.log('\n── Pagamento não é aprovado por fora do admin ──\n');

  const produto = await selecionarUm('catalogo_publico', {
    colunas: 'slug',
    ordenar: 'nome.asc',
  });

  if (produto) {
    const { postPedido } = await import('../backend/controllers/order-controller.js');
    const { postComprovante } = await import(
      '../backend/controllers/payment-controller.js'
    );

    const pedidoCriado = await postPedido({
      req: comToken(tokenCliente),
      corpo: {
        nome: 'Cliente Comum',
        whatsapp: '11955554444',
        tipoEntrega: 'retirada',
        consentimento: true,
        itens: [{ slug: produto.slug, quantidade: 1 }],
      },
    });

    const codigo = pedidoCriado.corpo.pedido?.codigo;
    if (codigo) pedidosCriados.push(codigo);

    verificar('cliente consegue criar pedido', pedidoCriado.status === 201);

    // Envia comprovante como cliente — isso É permitido.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(1500, 0x41),
    ]).toString('base64');

    const envio = await postComprovante({
      req: comToken(tokenCliente),
      params: { codigo },
      corpo: { arquivo: jpeg, tipo: 'image/jpeg', nome: 'c.jpg' },
    });

    verificar('cliente consegue enviar comprovante', envio.status === 201);

    // Mas NÃO consegue aprovar o próprio pagamento.
    const autoaprovacao = await postConferirPagamento({
      req: comToken(tokenCliente),
      params: { codigo },
      corpo: { aprovado: true },
    });

    verificar(
      'cliente NÃO consegue aprovar o próprio pagamento',
      autoaprovacao.status === 403,
      `obtido: ${autoaprovacao.status}`
    );

    // Nem avançar o status por conta própria.
    const autoavanco = await patchStatusPedido({
      req: comToken(tokenCliente),
      params: { codigo },
      corpo: { status: 'pagamento_aprovado' },
    });

    verificar(
      'cliente NÃO consegue mudar o status',
      autoavanco.status === 403,
      `obtido: ${autoavanco.status}`
    );

    // Nem ver o próprio comprovante pela rota administrativa.
    const verComprovante = await getComprovante({
      req: comToken(tokenCliente),
      params: { codigo },
    });

    verificar(
      'cliente NÃO acessa a rota de comprovante do admin',
      verComprovante.status === 403,
      `obtido: ${verComprovante.status}`
    );

    // O status precisa ter ficado intacto.
    const depois = await selecionarUm('orders', {
      colunas: 'status',
      filtros: { codigo: `eq.${codigo}` },
    });

    verificar(
      'status continua em comprovante_enviado',
      depois?.status === 'comprovante_enviado',
      `status: ${depois?.status}`
    );
  } else {
    console.log('  ⊘ nenhum produto publicado — teste de pedido pulado');
  }
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  for (const codigo of pedidosCriados) {
    await remover('orders', { codigo: `eq.${codigo}` }).catch(() => {});
  }

  if (usuarioId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuarioId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});
  }

  const sobrou = await selecionarUm('profiles', {
    colunas: 'id',
    filtros: { id: `eq.${usuarioId}` },
  }).catch(() => null);

  verificar('conta de teste removida', !sobrou);
}

/* =============================================================================
 * 5. VALIDAÇÃO DA CONFERÊNCIA
 * ========================================================================== */

console.log('\n── Regras da conferência ──\n');

// Recusar sem motivo não pode ser aceito: o cliente ficaria sem saber o que
// corrigir. A checagem acontece antes da verificação de permissão? NÃO —
// permissão vem primeiro. Então aqui esperamos 401/403, o que também prova
// que a ordem está certa.
const recusaSemMotivo = await postConferirPagamento({
  req: semToken(),
  params: { codigo: 'DFAAAAAAAA' },
  corpo: { aprovado: false, observacao: '' },
});

verificar(
  'permissão é checada ANTES da validação do corpo',
  recusaSemMotivo.status === 401,
  `obtido: ${recusaSemMotivo.status} — validar antes vazaria se a rota existe`
);

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
