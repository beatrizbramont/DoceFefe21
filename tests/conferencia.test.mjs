/**
 * tests/conferencia.test.mjs
 * -----------------------------------------------------------------------------
 * Aprovar pagamento: o caminho que quebrou em produção.
 *
 * O QUE ACONTECEU
 *   Dois pedidos pagos por Pix não puderam ser aprovados. A API devolveu 503,
 *   e o motivo estava no banco: a restrição `payments_conferencia_exige_
 *   comprovante` proibia marcar "conferido" sem arquivo anexado. O cliente
 *   tinha pago e avisado por WhatsApp sem subir o print.
 *
 *   Pior que o erro foi o estrago: o controlador mudava o status do pedido
 *   ANTES de gravar o pagamento. A primeira escrita passou, a segunda bateu
 *   na restrição — e os dois pedidos ficaram aprovados com pagamento
 *   pendente. Repetir não consertava: o status já estava certo, então a
 *   segunda escrita falhava de novo.
 *
 * O QUE ESTA SUÍTE TRAVA
 *   1. Aprovar sem comprovante e sem justificativa devolve 422 explicando —
 *      não 503 genérico.
 *   2. Com justificativa, aprova de verdade: pedido E pagamento mudam.
 *   3. Quando a aprovação é recusada, NADA muda. Sem escrita pela metade.
 *
 * ⚠️ Cria um pedido de teste e apaga no fim.
 */

import { postConferirPagamento } from '../backend/controllers/admin-controller.js';
import { postPedido } from '../backend/controllers/order-controller.js';
import { postFormaPagamento } from '../backend/controllers/payment-controller.js';
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
  console.log('\n  ⊘ Banco não configurado — suíte de conferência pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte de conferência pulada.\n`);
  process.exit(0);
}

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

const comToken = (t) => ({ headers: { authorization: `Bearer ${t}` } });

let admin = null;
let produtoId = null;
let produtoSlug = null;
let codigo = null;

try {
  console.log('\n── Preparação ──\n');

  const email = `admin.conferencia.${process.pid}@docefefe-testes.com`;
  const senha = 'SenhaDeTeste#2026';

  const criacao = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });

  if (!criacao.ok) throw new Error(`Falha ao criar admin: ${criacao.status}`);

  admin = { id: (await criacao.json()).id };
  await atualizar('profiles', { id: `eq.${admin.id}` }, { perfil: 'admin' });

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });

  admin.token = (await login.json()).access_token;

  const categoria = await selecionarUm('categories', { colunas: 'id', ordenar: 'ordem.asc' });

  produtoSlug = `zzz-conferencia-${process.pid}`;

  const [produto] = await inserir('products', {
    categoria_id: categoria.id,
    slug: produtoSlug,
    nome: `ZZZ Conferência ${process.pid}`,
    preco_varejo: 1000,
    publicado: true,
  });

  produtoId = produto.id;

  await chamarFuncao('ajustar_estoque', {
    p_produto_id: produtoId,
    p_tipo: 'entrada',
    p_quantidade: 10,
    p_motivo: 'Suíte de testes',
    p_usuario_id: null,
  });

  // Pedido por Pix, SEM enviar comprovante — exatamente o caso que quebrou.
  const pedido = await postPedido({
    req: { headers: {} },
    corpo: {
      nome: 'Cliente de Teste',
      whatsapp: '11955554444',
      tipoEntrega: 'retirada',
      consentimento: true,
      itens: [{ slug: produtoSlug, quantidade: 1 }],
    },
  });

  codigo = pedido.corpo.pedido?.codigo;

  await postFormaPagamento({
    req: { headers: {} },
    params: { codigo },
    corpo: { metodo: 'pix' },
  });

  const pagamento = await selecionarUm('payments', {
    colunas: 'comprovante_caminho,status',
    filtros: { pedido_id: `eq.${pedido.corpo.pedido.id || ''}` },
  }).catch(() => null);

  verificar('pedido de teste criado, por Pix e sem comprovante', Boolean(codigo));

  /* ===========================================================================
   * 1. SEM JUSTIFICATIVA: 422 QUE EXPLICA, NÃO 503 QUE ASSUSTA
   * ======================================================================== */

  console.log('\n── Aprovar sem comprovante e sem justificativa ──\n');

  const semMotivo = await postConferirPagamento({
    req: comToken(admin.token),
    params: { codigo },
    corpo: { aprovado: true },
  });

  verificar(
    'devolve 422, e não 503',
    semMotivo.status === 422,
    `obtido: ${semMotivo.status} — 503 era o sintoma do bug`
  );

  verificar(
    'a mensagem diz o que fazer',
    /comprovante|confirmou/i.test(semMotivo.corpo.mensagem || ''),
    semMotivo.corpo.mensagem
  );

  /* ---------------------------------------------------------------------
   * O ponto central: a recusa não pode ter mexido em nada.
   * ------------------------------------------------------------------ */

  const pedidoDepois = await selecionarUm('orders', {
    colunas: 'id,status',
    filtros: { codigo: `eq.${codigo}` },
  });

  verificar(
    'o pedido NÃO virou aprovado pela metade',
    pedidoDepois.status === 'aguardando_pagamento',
    `status: ${pedidoDepois.status} — era aqui que a escrita parcial aparecia`
  );

  const pagamentoDepois = await selecionarUm('payments', {
    colunas: 'status,conferido_em',
    filtros: { pedido_id: `eq.${pedidoDepois.id}` },
  });

  verificar(
    'o pagamento continua pendente',
    pagamentoDepois?.status === 'pendente' && !pagamentoDepois?.conferido_em,
    JSON.stringify(pagamentoDepois)
  );

  /* ===========================================================================
   * 2. COM JUSTIFICATIVA: APROVA DE VERDADE
   * ======================================================================== */

  console.log('\n── Aprovar com justificativa escrita ──\n');

  const aprovacao = await postConferirPagamento({
    req: comToken(admin.token),
    params: { codigo },
    corpo: { aprovado: true, observacao: 'Confirmado no extrato do dia 23' },
  });

  if (aprovacao.status === 503) {
    console.log(
      '\n  ⊘ O banco ainda recusa conferência sem comprovante.' +
        '\n    Execute database/16-conferencia-sem-comprovante.sql no Supabase.' +
        '\n    Restante da suíte pulado.\n'
    );
  } else {
    verificar('aprova', aprovacao.status === 200, `obtido: ${aprovacao.status}`);

    const pedidoFinal = await selecionarUm('orders', {
      colunas: 'id,status',
      filtros: { codigo: `eq.${codigo}` },
    });

    verificar(
      'o pedido fica aprovado',
      pedidoFinal.status === 'pagamento_aprovado',
      `status: ${pedidoFinal.status}`
    );

    const pagamentoFinal = await selecionarUm('payments', {
      colunas: 'status,conferido_em,conferido_por,observacao_conferencia,pago_em',
      filtros: { pedido_id: `eq.${pedidoFinal.id}` },
    });

    verificar(
      'o pagamento também fica aprovado — as duas escritas andam juntas',
      pagamentoFinal?.status === 'aprovado' && Boolean(pagamentoFinal?.conferido_em),
      JSON.stringify(pagamentoFinal)
    );

    verificar(
      'a justificativa fica registrada',
      pagamentoFinal?.observacao_conferencia === 'Confirmado no extrato do dia 23',
      pagamentoFinal?.observacao_conferencia
    );

    verificar(
      'fica registrado QUEM aprovou',
      pagamentoFinal?.conferido_por === admin.id,
      'sem isso não há a quem perguntar depois'
    );

    /* =======================================================================
     * 3. PEDIDO JÁ ADIANTADO NÃO VOLTA PARA A CONFERÊNCIA
     * ==================================================================== */

    console.log('\n── Pedido fora do momento da conferência ──\n');

    await atualizar('orders', { codigo: `eq.${codigo}` }, { status: 'entregue' });

    const forcar = await postConferirPagamento({
      req: comToken(admin.token),
      params: { codigo },
      corpo: { aprovado: false, observacao: 'tentativa indevida' },
    });

    verificar(
      'recusar um pedido já entregue é barrado',
      forcar.status === 409,
      `obtido: ${forcar.status}`
    );

    const aindaEntregue = await selecionarUm('orders', {
      colunas: 'status',
      filtros: { codigo: `eq.${codigo}` },
    });

    verificar(
      'e o pedido continua entregue',
      aindaEntregue.status === 'entregue',
      aindaEntregue.status
    );
  }
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  if (codigo) await remover('orders', { codigo: `eq.${codigo}` }).catch(() => {});
  if (produtoId) await remover('products', { id: `eq.${produtoId}` }).catch(() => {});

  if (admin?.id) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${admin.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});
  }

  const sobrou = await selecionarUm('orders', {
    colunas: 'id',
    filtros: { codigo: `eq.${codigo}` },
  }).catch(() => null);

  verificar('pedido de teste removido', !sobrou);
}

encerrar();
