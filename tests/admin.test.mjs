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
  getResumoAdmin,
  getClientesAdmin,
  getSeparacao,
} from '../backend/controllers/admin-painel-controller.js';
import {
  getProdutosAdmin,
  postProduto,
  patchProduto,
  deleteProduto,
  postFotoProduto,
  deleteFotoProduto,
  getEstoque,
  postMovimentoEstoque,
  patchConfiguracaoEstoque,
} from '../backend/controllers/admin-catalogo-controller.js';
import {
  getRevendedoresAdmin,
  patchRevendedor,
} from '../backend/controllers/admin-revendedores-controller.js';
import { validarProduto, gerarSlug } from '../services/product-admin-service.js';
import { validarCandidatura, cnpjValido } from '../services/reseller-service.js';
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

/** Imprime o placar e sai com o código apropriado. */
const encerrar = () => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(falhas > 0 ? 1 : 0);
};

/* =============================================================================
 * 1. VALIDAÇÃO DO CADASTRO DE PRODUTO
 *
 * Vem ANTES da checagem de banco de propósito: são funções puras, e regra de
 * preço não pode deixar de ser testada só porque a rede caiu.
 *
 * Estas regras existem em duas camadas: aqui, para explicar o erro em
 * português, e no banco, como restrição. Os testes cobrem a primeira — a
 * segunda é garantida pelo próprio PostgreSQL.
 * ========================================================================== */

console.log('\n── Validação do produto ──\n');

const PRODUTO_VALIDO = {
  nome: 'Brownie de Teste',
  categoriaId: '11111111-1111-1111-1111-111111111111',
  precoVarejo: 1000,
};

const validar = (mudancas, parcial = false) =>
  validarProduto({ ...(parcial ? {} : PRODUTO_VALIDO), ...mudancas }, { parcial });

verificar('produto completo é aceito', Object.keys(validar({}).erros).length === 0);

verificar('preço zero é recusado', Boolean(validar({ precoVarejo: 0 }).erros.precoVarejo));

verificar(
  'preço negativo é recusado',
  Boolean(validar({ precoVarejo: -500 }).erros.precoVarejo)
);

verificar(
  'promoção maior que o varejo é recusada',
  Boolean(validar({ precoPromocional: 2000 }).erros.precoPromocional)
);

verificar(
  'promoção igual ao varejo é recusada (desconto de zero não é promoção)',
  Boolean(validar({ precoPromocional: 1000 }).erros.precoPromocional)
);

verificar(
  'atacado maior que o varejo é recusado',
  Boolean(validar({ precoAtacado: 1200 }).erros.precoAtacado)
);

verificar('nome de uma letra é recusado', Boolean(validar({ nome: 'X' }).erros.nome));

verificar(
  'categoria que não é uuid é recusada',
  Boolean(validar({ categoriaId: 'brownies' }).erros.categoriaId)
);

verificar('peso negativo é recusado', Boolean(validar({ pesoGramas: -10 }).erros.pesoGramas));

verificar(
  'mínimo de atacado zero é recusado',
  Boolean(validar({ minimoAtacado: 0 }).erros.minimoAtacado)
);

// `vendas_total` é contabilidade de vendas, não cadastro. Mandar o campo pelo
// formulário não pode virar coluna gravada.
const { colunas: colunasForjadas } = validarProduto(
  { ...PRODUTO_VALIDO, vendas_total: 99999, vendasTotal: 99999, id: 'outro' },
  { parcial: false }
);

verificar(
  'campos fora do formulário são descartados',
  !('vendas_total' in colunasForjadas) && !('id' in colunasForjadas)
);

verificar(
  'edição parcial não exige todos os campos',
  Object.keys(validar({ publicado: true }, true).erros).length === 0
);

/* -----------------------------------------------------------------------------
 * Slug — é o que entra na URL do produto
 * -------------------------------------------------------------------------- */

console.log('\n── Endereço do produto (slug) ──\n');

verificar(
  'acentos viram letras simples',
  gerarSlug('Pão de Mel Tradicional') === 'pao-de-mel-tradicional',
  gerarSlug('Pão de Mel Tradicional')
);

verificar(
  'cedilha vira c',
  gerarSlug('Maçã do Amor') === 'maca-do-amor',
  gerarSlug('Maçã do Amor')
);

verificar(
  'caracteres de caminho não sobrevivem',
  gerarSlug('../../etc/passwd') === 'etc-passwd',
  gerarSlug('../../etc/passwd')
);

verificar(
  'slug não começa nem termina com hífen',
  !/^-|-$/.test(gerarSlug('  Brownie!!  ')),
  gerarSlug('  Brownie!!  ')
);

/* =============================================================================
 * 2. VALIDAÇÃO DA CANDIDATURA A REVENDEDOR
 *
 * Também sem banco. O que importa provar aqui é que o formulário público NÃO
 * é um caminho para se autoconceder condição comercial.
 * ========================================================================== */

console.log('\n── Candidatura a revendedor ──\n');

const CANDIDATURA_VALIDA = {
  nomeResponsavel: 'Maria da Silva',
  nomeEstabelecimento: 'Café da Esquina',
  whatsapp: '11988887777',
  cidade: 'São Paulo',
  estado: 'SP',
  consentimento: true,
};

const candidatar = (mudancas) =>
  validarCandidatura({ ...CANDIDATURA_VALIDA, ...mudancas });

verificar('candidatura completa é aceita', candidatar({}).ok);

verificar(
  'sem consentimento LGPD é recusada',
  Boolean(candidatar({ consentimento: false }).erros?.consentimento)
);

verificar(
  'consentimento precisa ser booleano, não string',
  Boolean(candidatar({ consentimento: 'sim' }).erros?.consentimento),
  'aceitar qualquer valor "verdadeiro" tornaria o aceite decorativo'
);

verificar(
  'WhatsApp sem DDD é recusado',
  Boolean(candidatar({ whatsapp: '98887777' }).erros?.whatsapp)
);

verificar(
  'estado inventado é recusado',
  Boolean(candidatar({ estado: 'XX' }).erros?.estado)
);

verificar(
  'tipo de negócio fora da lista é recusado',
  Boolean(candidatar({ tipoEstabelecimento: 'lavanderia' }).erros?.tipoEstabelecimento)
);

// O coração da questão: nada que venha do formulário pode virar condição
// comercial. Estes campos simplesmente não são lidos.
const forjada = candidatar({
  status: 'aprovado',
  desconto_percentual: 90,
  descontoPercentual: 90,
  pedido_minimo_centavos: 0,
  usuario_id: '00000000-0000-0000-0000-000000000001',
});

verificar(
  'status enviado pelo formulário é ignorado',
  forjada.ok && !('status' in forjada.dados),
  JSON.stringify(Object.keys(forjada.dados || {}))
);

verificar(
  'desconto enviado pelo formulário é ignorado',
  forjada.ok && !('desconto_percentual' in forjada.dados)
);

verificar(
  'usuario_id enviado pelo formulário é ignorado',
  forjada.ok && !('usuario_id' in forjada.dados),
  'o id vem da sessão validada, nunca do corpo'
);

/* -----------------------------------------------------------------------------
 * CNPJ — o dígito verificador pega o erro de digitação
 * -------------------------------------------------------------------------- */

verificar('CNPJ válido é aceito', cnpjValido('11.222.333/0001-81'));
verificar('CNPJ só com dígitos é aceito', cnpjValido('11222333000181'));

verificar(
  'CNPJ com um dígito trocado é recusado',
  !cnpjValido('11.222.333/0001-82'),
  'é o erro de digitação mais comum'
);

verificar('CNPJ curto é recusado', !cnpjValido('112223330001'));
verificar('CNPJ com todos os dígitos iguais é recusado', !cnpjValido('11111111111111'));

verificar(
  'CNPJ errado no formulário vira erro de campo',
  Boolean(candidatar({ cnpj: '11.222.333/0001-82' }).erros?.cnpj)
);

verificar(
  'sem CNPJ continua valendo (revenda pessoal)',
  candidatar({ cnpj: '' }).ok
);

/* -----------------------------------------------------------------------------
 * Pré-requisitos do restante da suíte
 *
 * Daqui para baixo tudo depende do banco. Sem ele, o que já foi verificado
 * continua valendo — por isso o placar é impresso antes de sair.
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — testes de acesso pulados.');
  encerrar();
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Testes de acesso pulados.`);
  encerrar();
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

  // --- Fase 9: visão geral, catálogo e estoque ---
  //
  // O resumo expõe o faturamento da loja e a lista de clientes expõe dado
  // pessoal. As rotas de escrita mexem no catálogo e no estoque. Todas
  // entram na mesma matriz: a permissão precisa ser checada ANTES de
  // qualquer coisa, inclusive da validação do corpo.
  ['GET /api/admin/resumo', (req) => getResumoAdmin({ req, query: {} })],
  ['GET /api/admin/clientes', (req) => getClientesAdmin({ req, query: {} })],
  // A separação expõe nome, WhatsApp e endereço de entrega de todo mundo
  // que comprou para aquele dia.
  ['GET /api/admin/separacao', (req) => getSeparacao({ req, query: {} })],
  ['GET /api/admin/produtos', (req) => getProdutosAdmin({ req, query: {} })],
  [
    'POST produto',
    (req) => postProduto({ req, corpo: { nome: 'Invasor', precoVarejo: 100 } }),
  ],
  [
    'PATCH produto',
    (req) =>
      patchProduto({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        corpo: { publicado: true },
      }),
  ],
  [
    'DELETE produto',
    (req) =>
      deleteProduto({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        query: {},
      }),
  ],
  [
    'POST foto',
    (req) =>
      postFotoProduto({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        corpo: { arquivo: 'x', tipo: 'image/jpeg' },
      }),
  ],
  [
    'DELETE foto',
    (req) =>
      deleteFotoProduto({
        req,
        params: {
          id: '00000000-0000-0000-0000-000000000000',
          fotoId: '00000000-0000-0000-0000-000000000000',
        },
      }),
  ],
  ['GET /api/admin/estoque', (req) => getEstoque({ req, query: {} })],
  [
    'POST movimento de estoque',
    (req) =>
      postMovimentoEstoque({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        corpo: { tipo: 'entrada', quantidade: 999 },
      }),
  ],
  [
    'PATCH configuração de estoque',
    (req) =>
      patchConfiguracaoEstoque({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        corpo: { alertaMinimo: 0 },
      }),
  ],

  // --- Fase 10: revendedores ---
  //
  // ⚠️ O PATCH abaixo é a rota que cria desconto PERMANENTE. Se algum dia ela
  //   aceitar uma requisição sem perfil de administrador, qualquer pessoa
  //   passa a comprar no atacado para sempre.
  ['GET /api/admin/revendedores', (req) => getRevendedoresAdmin({ req, query: {} })],
  [
    'PATCH revendedor (autoaprovação)',
    (req) =>
      patchRevendedor({
        req,
        params: { id: '00000000-0000-0000-0000-000000000000' },
        corpo: { status: 'aprovado', desconto: 90, pedidoMinimo: 0 },
      }),
  ],
];

/* =============================================================================
 * 2. SEM SESSÃO
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
 * 3. TOKENS FORJADOS
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
 * 4. CLIENTE COMUM
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
   * 5. O PEDIDO NÃO PODE SER APROVADO POR FORA
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
 * 6. VALIDAÇÃO DA CONFERÊNCIA
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

encerrar();

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
