/**
 * tests/separacao.test.mjs
 * -----------------------------------------------------------------------------
 * Fase 11 — a folha de separação do dia.
 *
 * O QUE PRECISA SER PROVADO
 *
 *   1. A data que filtra é a DESEJADA pelo cliente, não a do pedido. Confundir
 *      as duas faria a loja produzir no dia errado — é o erro mais caro que
 *      esta tela pode cometer.
 *   2. A produção SOMA o mesmo produto de pedidos diferentes. Seis pedidos
 *      com três brownies cada são dezoito brownies, não seis linhas.
 *   3. Pedido ainda não pago não entra na produção por padrão.
 *   4. Pedido sem dia combinado não desaparece.
 *
 * ⚠️ ESTA SUÍTE ESCREVE NO BANCO
 *   Usa uma data bem no futuro (2099) para não encostar em pedido real
 *   nenhum, e apaga tudo no `finally`.
 */

import { getSeparacao } from '../backend/controllers/admin-painel-controller.js';
import { postPedido } from '../backend/controllers/order-controller.js';
import { atualizarStatus } from '../services/order-service.js';
import {
  bancoConfigurado,
  verificarConexao,
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
  console.log('\n  ⊘ Banco não configurado — suíte de separação pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte de separação pulada.\n`);
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

const comToken = (t) => ({ headers: { authorization: `Bearer ${t}` } });

/**
 * Datas de teste, bem no futuro — mas DENTRO de um ano.
 *
 * A primeira versão usava 2099 e nenhum pedido era criado: `order-service`
 * recusa data a mais de um ano à frente, com o comentário "evita pedido para
 * 2099 por erro de digitação". O teste caiu na própria rede de proteção do
 * projeto, que é exatamente o que ela deveria fazer.
 *
 * Dez meses à frente resolve os dois lados: passa na validação e está longe
 * demais para esbarrar em pedido de verdade.
 */
function daquiA(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);

  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');

  return `${d.getFullYear()}-${mes}-${dia}`;
}

const DIA = daquiA(300);
const OUTRO_DIA = daquiA(301);

let admin = null;
let produtoId = null;
let produtoSlug = null;
const pedidosCriados = [];

async function criarPedido({ quantidade, dataDesejada, tipoEntrega = 'retirada' }) {
  const corpo = {
    nome: 'Cliente de Teste',
    whatsapp: '11977776666',
    tipoEntrega,
    consentimento: true,
    itens: [{ slug: produtoSlug, quantidade }],
  };

  if (dataDesejada) corpo.dataDesejada = dataDesejada;

  if (tipoEntrega === 'entrega') {
    corpo.endereco = {
      cep: '01310100',
      logradouro: 'Avenida Paulista',
      numero: '1000',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      estado: 'SP',
    };
  }

  const resposta = await postPedido({ req: { headers: {} }, corpo });
  const codigo = resposta.corpo.pedido?.codigo;

  if (codigo) pedidosCriados.push(codigo);

  return { resposta, codigo };
}

try {
  console.log('\n── Preparação ──\n');

  // Conta administradora: a rota exige perfil, e é isso que queremos exercitar.
  const criacao = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `admin.separacao.${process.pid}@docefefe-testes.com`,
      password: 'SenhaDeTeste#2026',
      email_confirm: true,
    }),
  });

  if (!criacao.ok) throw new Error(`Falha ao criar admin: ${criacao.status}`);

  admin = { id: (await criacao.json()).id };

  await atualizar('profiles', { id: `eq.${admin.id}` }, { perfil: 'admin' });

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `admin.separacao.${process.pid}@docefefe-testes.com`,
      password: 'SenhaDeTeste#2026',
    }),
  });

  admin.token = (await login.json()).access_token;

  verificar('conta administradora pronta', Boolean(admin.token));

  const categoria = await selecionarUm('categories', { colunas: 'id', ordenar: 'ordem.asc' });

  produtoSlug = `zzz-separacao-${process.pid}`;

  const [produto] = await inserir('products', {
    categoria_id: categoria.id,
    slug: produtoSlug,
    nome: `ZZZ Separação ${process.pid}`,
    preco_varejo: 1000,
    publicado: true,
  });

  produtoId = produto.id;

  await chamarFuncao('ajustar_estoque', {
    p_produto_id: produtoId,
    p_tipo: 'entrada',
    p_quantidade: 100,
    p_motivo: 'Suíte de testes',
    p_usuario_id: null,
  });

  verificar('produto de teste publicado e com estoque', Boolean(produtoId));

  /* ===========================================================================
   * 1. A DATA QUE FILTRA É A DESEJADA
   * ======================================================================== */

  console.log('\n── A data que manda ──\n');

  const { codigo: codigoA } = await criarPedido({ quantidade: 3, dataDesejada: DIA });
  const { codigo: codigoB } = await criarPedido({
    quantidade: 5,
    dataDesejada: DIA,
    tipoEntrega: 'entrega',
  });

  // Mesmo produto, outro dia: não pode aparecer na folha do DIA.
  await criarPedido({ quantidade: 7, dataDesejada: OUTRO_DIA });

  // Sem data combinada.
  await criarPedido({ quantidade: 2 });

  verificar('pedidos de teste criados', pedidosCriados.length === 4, `${pedidosCriados.length}`);

  const abertos = await getSeparacao({
    req: comToken(admin.token),
    query: { data: DIA, filtro: 'abertos' },
  });

  verificar('a rota responde', abertos.status === 200, `obtido: ${abertos.status}`);

  verificar(
    'só os pedidos DAQUELE dia entram',
    abertos.corpo.totais.pedidos === 2,
    `obtido: ${abertos.corpo.totais.pedidos}`
  );

  // O pedido de 7 unidades é do dia seguinte. Se a data estivesse sendo
  // ignorada — ou se o filtro usasse `criado_em`, que é HOJE para os quatro —
  // este total viria 15 ou 17 em vez de 8.
  verificar(
    'pedido marcado para outro dia fica de fora',
    abertos.corpo.totais.itens === 8,
    `unidades: ${abertos.corpo.totais.itens} (esperado 3 + 5)`
  );

  /* ===========================================================================
   * 2. A PRODUÇÃO SOMA
   * ======================================================================== */

  console.log('\n── Somatório da produção ──\n');

  verificar(
    'o mesmo produto em dois pedidos vira UMA linha',
    abertos.corpo.producao.length === 1,
    `linhas: ${abertos.corpo.producao.length}`
  );

  verificar(
    'a linha soma as quantidades (3 + 5 = 8)',
    abertos.corpo.producao[0]?.quantidade === 8,
    `obtido: ${abertos.corpo.producao[0]?.quantidade}`
  );

  /* ===========================================================================
   * 3. ENTREGA E RETIRADA SÃO LISTAS DIFERENTES
   * ======================================================================== */

  console.log('\n── Entregas e retiradas ──\n');

  verificar(
    'a retirada vai para a lista de retiradas',
    abertos.corpo.retiradas.some((p) => p.codigo === codigoA),
    JSON.stringify(abertos.corpo.retiradas.map((p) => p.codigo))
  );

  verificar(
    'a entrega vai para a lista de entregas',
    abertos.corpo.entregas.some((p) => p.codigo === codigoB)
  );

  verificar(
    'a entrega traz o endereço (é o que o entregador lê)',
    Boolean(abertos.corpo.entregas[0]?.endereco?.logradouro),
    JSON.stringify(abertos.corpo.entregas[0]?.endereco || null)
  );

  /* ===========================================================================
   * 4. NÃO PAGO NÃO ENTRA NA PRODUÇÃO
   * ======================================================================== */

  console.log('\n── O que entra na produção ──\n');

  const aProduzir = await getSeparacao({
    req: comToken(admin.token),
    query: { data: DIA },
  });

  verificar(
    'pedido aguardando pagamento NÃO entra na produção',
    aProduzir.corpo.totais.pedidos === 0,
    `obtido: ${aProduzir.corpo.totais.pedidos} — produzir antes de receber é decisão da dona`
  );

  // Aprova o pagamento de um deles e confere que ele aparece.
  await atualizarStatus(codigoA, 'pagamento_aprovado', {});

  const depoisDePagar = await getSeparacao({
    req: comToken(admin.token),
    query: { data: DIA },
  });

  verificar(
    'pedido pago aparece na produção',
    depoisDePagar.corpo.totais.pedidos === 1,
    `obtido: ${depoisDePagar.corpo.totais.pedidos}`
  );

  verificar(
    'e a produção reflete só o que foi pago (3 unidades)',
    depoisDePagar.corpo.producao[0]?.quantidade === 3,
    `obtido: ${depoisDePagar.corpo.producao[0]?.quantidade}`
  );

  /* ===========================================================================
   * 5. PEDIDO SEM DIA COMBINADO NÃO SOME
   * ======================================================================== */

  console.log('\n── Sem dia combinado ──\n');

  verificar(
    'a folha do dia avisa que existem pedidos sem data',
    abertos.corpo.totais.semData >= 1,
    `contados: ${abertos.corpo.totais.semData}`
  );

  const semData = await getSeparacao({
    req: comToken(admin.token),
    query: { data: '', filtro: 'abertos' },
  });

  verificar(
    'é possível listar justamente os sem data',
    semData.corpo.totais.pedidos >= 1,
    `obtido: ${semData.corpo.totais.pedidos}`
  );

  verificar(
    'nenhum deles tem data desejada',
    semData.corpo.retiradas.every((p) => p.dataDesejada === null)
  );

  /* ===========================================================================
   * 6. DATA MALFORMADA
   * ======================================================================== */

  console.log('\n── Entrada inválida ──\n');

  const dataInvalida = await getSeparacao({
    req: comToken(admin.token),
    query: { data: '14/03/2099' },
  });

  verificar(
    'data em formato errado devolve 422',
    dataInvalida.status === 422,
    `obtido: ${dataInvalida.status}`
  );
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  for (const codigo of pedidosCriados) {
    await remover('orders', { codigo: `eq.${codigo}` }).catch(() => {});
  }

  if (produtoId) {
    await remover('products', { id: `eq.${produtoId}` }).catch(() => {});

    const sobrou = await selecionarUm('products', {
      colunas: 'id',
      filtros: { id: `eq.${produtoId}` },
    }).catch(() => null);

    verificar('produto de teste removido', !sobrou);
  }

  if (admin?.id) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${admin.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});

    const contaSobrou = await selecionarUm('profiles', {
      colunas: 'id',
      filtros: { id: `eq.${admin.id}` },
    }).catch(() => null);

    verificar('conta administradora removida', !contaSobrou);
  }
}

encerrar();
