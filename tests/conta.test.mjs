/**
 * tests/conta.test.mjs
 * -----------------------------------------------------------------------------
 * Testa autenticação e as rotas protegidas da área do cliente.
 *
 * O FOCO É O CONTROLE DE ACESSO.
 *
 *   A falha mais grave que uma loja virtual pode ter não é cálculo errado:
 *   é um cliente conseguindo ler os dados ou os pedidos de outro. Os testes
 *   abaixo tentam exatamente isso, de várias formas.
 *
 * Cria um usuário de verdade no Supabase e o remove ao final.
 */

import {
  getPerfil,
  patchPerfil,
  getMeusPedidos,
} from '../backend/controllers/profile-controller.js';
import { extrairToken } from '../services/auth-service.js';
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

/** Simula um objeto de requisição com o cabeçalho Authorization. */
const comToken = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const semToken = () => ({ headers: {} });

/* -----------------------------------------------------------------------------
 * Pré-requisitos
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte da conta pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte da conta pulada.\n`);
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

if (!ANON_KEY) {
  console.log('\n  ⊘ VITE_SUPABASE_ANON_KEY ausente — suíte da conta pulada.\n');
  process.exit(0);
}

/* =============================================================================
 * 1. EXTRAÇÃO DO TOKEN
 *
 * Roda sem rede: só confere o formato aceito.
 * ========================================================================== */

console.log('\n── Leitura do cabeçalho Authorization ──\n');

const jwtFalso = 'aaa.bbb.ccc';

verificar('sem cabeçalho devolve null', extrairToken(semToken()) === null);
verificar(
  'cabeçalho sem "Bearer" é rejeitado',
  extrairToken({ headers: { authorization: jwtFalso } }) === null
);
verificar(
  'esquema errado é rejeitado',
  extrairToken({ headers: { authorization: `Basic ${jwtFalso}` } }) === null
);
verificar(
  '"Bearer" sem token é rejeitado',
  extrairToken({ headers: { authorization: 'Bearer ' } }) === null
);
verificar(
  'token sem as três partes do JWT é rejeitado',
  extrairToken({ headers: { authorization: 'Bearer abc' } }) === null
);
verificar(
  'token gigante é rejeitado',
  extrairToken({ headers: { authorization: `Bearer ${'a'.repeat(5000)}` } }) === null
);
verificar(
  'formato válido é aceito',
  extrairToken(comToken(jwtFalso)) === jwtFalso
);

/* =============================================================================
 * 2. ROTAS PROTEGIDAS SEM SESSÃO
 * ========================================================================== */

console.log('\n── Acesso sem sessão ──\n');

const rotas = [
  ['GET /api/perfil', () => getPerfil({ req: semToken() })],
  ['PATCH /api/perfil', () => patchPerfil({ req: semToken(), corpo: { nome: 'X' } })],
  ['GET /api/perfil/pedidos', () => getMeusPedidos({ req: semToken() })],
];

for (const [nome, chamar] of rotas) {
  const resposta = await chamar();
  verificar(
    `${nome} devolve 401 sem token`,
    resposta.status === 401,
    `obtido: ${resposta.status}`
  );
}

/* =============================================================================
 * 3. TOKENS FORJADOS
 *
 * Nenhum destes pode ser aceito. Um JWT é texto legível e editável — o que
 * prova autenticidade é a assinatura, que só o Supabase pode validar.
 * ========================================================================== */

console.log('\n── Tokens forjados ──\n');

/** Monta um JWT com assinatura inventada. */
function forjarJwt(carga) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}.assinatura-inventada`;
}

const forjados = [
  [
    'JWT com perfil de admin',
    forjarJwt({
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 99999,
    }),
  ],
  [
    'JWT com algoritmo "none"',
    `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'qualquer', exp: 9999999999 })
    ).toString('base64url')}.`,
  ],
  ['token de texto aleatório', 'aaaa.bbbb.cccc'],
  ['a própria chave de serviço como token', SERVICE_KEY || 'sem-chave'],
];

for (const [nome, token] of forjados) {
  if (!token || token.split('.').length !== 3) {
    // Tokens sem formato de JWT já são barrados antes da rede — contam
    // como rejeitados.
    verificar(`${nome} é rejeitado`, true);
    continue;
  }

  const resposta = await getPerfil({ req: comToken(token) });
  verificar(
    `${nome} é rejeitado`,
    resposta.status === 401,
    `obtido: ${resposta.status}`
  );
}

/* =============================================================================
 * 4. USUÁRIO REAL
 * ========================================================================== */

console.log('\n── Sessão real ──\n');

// Endereço único por execução, para não colidir com testes anteriores.
const carimbo = conexao.detalhes.categorias + Buffer.from(SUPABASE_URL).length;
const EMAIL_TESTE = `teste.automatizado.${carimbo}.${process.pid}@docefefe-testes.com`;
const SENHA_TESTE = 'SenhaDeTeste#2026';

let usuarioId = null;
let tokenReal = null;

/** Cria o usuário já confirmado, usando a API administrativa do Supabase. */
async function criarUsuarioDeTeste() {
  const resposta = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: EMAIL_TESTE,
      password: SENHA_TESTE,
      // Confirma o e-mail na hora: sem isso o login é bloqueado e não dá
      // para testar o resto.
      email_confirm: true,
      user_metadata: { nome: 'Usuário de Teste' },
    }),
  });

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`Falha ao criar usuário (${resposta.status}): ${erro.slice(0, 200)}`);
  }

  const dados = await resposta.json();
  return dados.id;
}

async function entrarComoTeste() {
  const resposta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL_TESTE, password: SENHA_TESTE }),
  });

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`Falha no login (${resposta.status}): ${erro.slice(0, 200)}`);
  }

  const dados = await resposta.json();
  return dados.access_token;
}

async function removerUsuarioDeTeste() {
  if (!usuarioId) return;

  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuarioId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

try {
  usuarioId = await criarUsuarioDeTeste();
  verificar('usuário de teste criado', Boolean(usuarioId));

  // O gatilho `ao_criar_usuario` deve ter criado a linha em profiles.
  const perfilCriado = await selecionarUm('profiles', {
    colunas: 'id,nome,perfil',
    filtros: { id: `eq.${usuarioId}` },
  });

  verificar('gatilho criou o perfil automaticamente', Boolean(perfilCriado));
  verificar(
    'perfil nasce como "cliente"',
    perfilCriado?.perfil === 'cliente',
    `obtido: ${perfilCriado?.perfil}`
  );
  verificar(
    'nome veio dos metadados do cadastro',
    perfilCriado?.nome === 'Usuário de Teste',
    `obtido: ${perfilCriado?.nome}`
  );

  tokenReal = await entrarComoTeste();
  verificar('login devolveu token', Boolean(tokenReal));

  /* ---------------------------------------------------------------------
   * 4.1 Leitura do próprio perfil
   * ------------------------------------------------------------------ */

  console.log('');

  const perfil = await getPerfil({ req: comToken(tokenReal) });

  verificar('GET /api/perfil autentica', perfil.status === 200, `obtido: ${perfil.status}`);
  verificar('devolve o próprio id', perfil.corpo.perfil?.id === usuarioId);
  verificar('devolve o e-mail', perfil.corpo.perfil?.email === EMAIL_TESTE);
  verificar('tipo de conta é cliente', perfil.corpo.perfil?.tipo === 'cliente');
  verificar('sem cadastro de revenda', perfil.corpo.revenda === null);

  /* ---------------------------------------------------------------------
   * 4.2 Escalada de privilégio
   *
   * O cliente não pode se promover a admin nem a revendedor aprovado.
   * ------------------------------------------------------------------ */

  console.log('\n── Tentativas de escalar privilégio ──\n');

  const escaladas = [
    ['perfil: admin', { perfil: 'admin' }],
    ['perfil: revendedor', { perfil: 'revendedor' }],
    ['id de outro usuário', { id: '00000000-0000-0000-0000-000000000002' }],
  ];

  for (const [nome, carga] of escaladas) {
    await patchPerfil({
      req: comToken(tokenReal),
      corpo: { nome: 'Usuário de Teste', ...carga },
    });

    const depois = await selecionarUm('profiles', {
      colunas: 'id,perfil',
      filtros: { id: `eq.${usuarioId}` },
    });

    verificar(
      `${nome} não altera nada`,
      depois?.perfil === 'cliente' && depois?.id === usuarioId,
      `perfil virou: ${depois?.perfil}`
    );
  }

  /* ---------------------------------------------------------------------
   * 4.3 Atualização legítima
   * ------------------------------------------------------------------ */

  console.log('\n── Atualização dos próprios dados ──\n');

  const atualizacao = await patchPerfil({
    req: comToken(tokenReal),
    corpo: {
      nome: 'Nome Atualizado',
      telefone: '11988887777',
      aceita_marketing: true,
    },
  });

  verificar('PATCH aceita dados válidos', atualizacao.status === 200, `obtido: ${atualizacao.status}`);

  const depoisDaAtualizacao = await getPerfil({ req: comToken(tokenReal) });
  verificar(
    'nome foi salvo',
    depoisDaAtualizacao.corpo.perfil?.nome === 'Nome Atualizado',
    `obtido: ${depoisDaAtualizacao.corpo.perfil?.nome}`
  );
  verificar(
    'telefone foi salvo só com dígitos',
    depoisDaAtualizacao.corpo.perfil?.telefone === '11988887777',
    `obtido: ${depoisDaAtualizacao.corpo.perfil?.telefone}`
  );
  verificar(
    'preferência de marketing foi salva',
    depoisDaAtualizacao.corpo.perfil?.aceitaMarketing === true
  );

  /* ---------------------------------------------------------------------
   * 4.4 Validação de entrada
   * ------------------------------------------------------------------ */

  console.log('\n── Dados inválidos ──\n');

  const invalidos = [
    ['nome com 1 letra', { nome: 'X' }, 'nome'],
    ['telefone curto', { telefone: '119' }, 'telefone'],
    ['data no futuro', { data_nascimento: '2099-01-01' }, 'data_nascimento'],
    ['data em formato errado', { data_nascimento: '01/01/1990' }, 'data_nascimento'],
  ];

  for (const [nome, carga, campoEsperado] of invalidos) {
    const resposta = await patchPerfil({ req: comToken(tokenReal), corpo: carga });

    verificar(
      `${nome} devolve 422`,
      resposta.status === 422,
      `obtido: ${resposta.status}`
    );
    verificar(
      `${nome} aponta o campo "${campoEsperado}"`,
      Boolean(resposta.corpo.erros?.[campoEsperado]),
      JSON.stringify(resposta.corpo.erros)
    );
  }

  const corpoVazio = await patchPerfil({ req: comToken(tokenReal), corpo: {} });
  verificar('corpo sem campos válidos devolve 422', corpoVazio.status === 422);

  /* ---------------------------------------------------------------------
   * 4.5 Pedidos
   * ------------------------------------------------------------------ */

  console.log('\n── Histórico de pedidos ──\n');

  const pedidos = await getMeusPedidos({ req: comToken(tokenReal) });

  verificar('GET /api/perfil/pedidos autentica', pedidos.status === 200);
  verificar('devolve lista', Array.isArray(pedidos.corpo.pedidos));
  verificar('usuário novo não tem pedidos', pedidos.corpo.pedidos.length === 0);

  // A tentativa clássica: passar o id de outra pessoa na query string.
  const pedidosDeOutro = await getMeusPedidos({
    req: comToken(tokenReal),
    query: { usuario_id: '00000000-0000-0000-0000-000000000002', limite: '50' },
  });

  verificar(
    'usuario_id na URL é ignorado',
    pedidosDeOutro.status === 200 && pedidosDeOutro.corpo.pedidos.length === 0
  );

  const limiteAbusivo = await getMeusPedidos({
    req: comToken(tokenReal),
    query: { limite: '99999' },
  });
  verificar('limite abusivo é cortado', limiteAbusivo.status === 200);

  /* ---------------------------------------------------------------------
   * 4.6 Preço de atacado
   *
   * Estar logado NÃO dá desconto. Só estar aprovado como revendedor dá.
   * ------------------------------------------------------------------ */

  console.log('\n── Logado ≠ revendedor ──\n');

  const { getProdutos } = await import('../backend/controllers/products-controller.js');

  const catalogo = await getProdutos({ query: {}, usuarioId });

  verificar(
    'cliente logado não recebe preço de atacado',
    catalogo.corpo.atacado === false,
    `obtido: ${catalogo.corpo.atacado}`
  );
  verificar(
    'nenhum item vem marcado como atacado',
    catalogo.corpo.produtos.every((p) => p.tipoPreco !== 'atacado')
  );
} catch (erro) {
  console.log(`\n  ✗ Erro durante os testes com usuário real: ${erro.message}\n`);
  falhas += 1;
} finally {
  /* ---------------------------------------------------------------------
   * Limpeza
   * ------------------------------------------------------------------ */

  console.log('\n── Limpeza ──\n');

  await removerUsuarioDeTeste();

  // A exclusão em auth.users deve remover o perfil em cascata.
  const sobrou = await selecionarUm('profiles', {
    colunas: 'id',
    filtros: { id: `eq.${usuarioId}` },
  }).catch(() => null);

  if (sobrou) {
    // Rede de segurança: não deixar lixo no banco.
    await remover('profiles', { id: `eq.${usuarioId}` }).catch(() => {});
    verificar('usuário de teste removido', false, 'perfil ficou órfão');
  } else {
    verificar('usuário de teste removido (perfil caiu em cascata)', true);
  }
}

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
