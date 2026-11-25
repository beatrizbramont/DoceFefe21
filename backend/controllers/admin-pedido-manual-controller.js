/**
 * backend/controllers/admin-pedido-manual-controller.js
 * -----------------------------------------------------------------------------
 * A loja lançando pedido, e desfazendo pedido.
 *
 * ⚠️ As três rotas exigem perfil de administrador, verificado no SERVIDOR por
 *   `exigirAdmin`. Esconder o botão "Novo pedido" na interface não protegeria
 *   nada: qualquer pessoa pode chamar a API direto.
 *
 * O QUE ESTE ARQUIVO RESOLVE
 *   A maior parte da venda fecha no WhatsApp. Esse pedido precisa entrar no
 *   sistema para baixar estoque, contar no faturamento e aparecer na
 *   separação do dia — senão o painel mostra uma loja menor do que ela é.
 *
 * A REGRA DE NEGÓCIO NÃO ESTÁ AQUI
 *   Preço, estoque e validação vivem em `criar_pedido`, no banco. Este
 *   arquivo só recebe, chama e traduz — ver services/manual-order-service.js.
 */

import { exigirAdmin } from '../../services/auth-service.js';
import {
  criarPedidoManual,
  cancelarPedido,
  excluirPedido,
  ErroPedidoManual,
} from '../../services/manual-order-service.js';

/** Resposta padrão quando falta permissão. */
const negar = (auth) => ({
  status: auth.status,
  corpo: { erro: true, mensagem: auth.mensagem },
});

/**
 * Converte o erro de negócio em resposta.
 *
 * O `campo` volta junto para a tela saber qual caixa pintar de vermelho. Sem
 * isso, a loja lê "quantidade inválida" e precisa caçar qual das seis linhas
 * do pedido está errada.
 */
function responderErro(erro, contexto) {
  if (erro instanceof ErroPedidoManual) {
    return {
      status: erro.status,
      corpo: { erro: true, mensagem: erro.message, campo: erro.campo },
    };
  }

  console.error(`[admin] ${contexto}:`, erro);

  return {
    status: 503,
    corpo: { erro: true, mensagem: 'Não conseguimos concluir agora.' },
  };
}

/* =============================================================================
 * LANÇAR PEDIDO
 * ========================================================================== */

/**
 * POST /api/admin/pedidos
 *
 * Corpo: {
 *   clienteNome, clienteWhatsapp, itens: [{produtoId, quantidade}],
 *   origem?, jaPago?, metodo?, tipoEntrega?, dataDesejada?, observacoes?
 * }
 *
 * Repare que não existe campo de preço. Ele vem do banco, sempre.
 */
export async function postPedidoManual({ req, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    // O id da administradora vai para o HISTÓRICO de estoque, não para o
    // dono do pedido: a venda é da cliente, não de quem digitou.
    const pedido = await criarPedidoManual(corpo, auth.usuario?.id ?? null);

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem: pedido.jaPago
          ? `Pedido ${pedido.codigo} lançado e já marcado como pago.`
          : `Pedido ${pedido.codigo} lançado. Falta registrar o pagamento.`,
        pedido,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'Falha ao lançar pedido');
  }
}

/* =============================================================================
 * CANCELAR
 * ========================================================================== */

/**
 * POST /api/admin/pedidos/:codigo/cancelar
 * Corpo: { motivo?: string }
 *
 * Devolve as unidades ao estoque. O pedido continua no histórico — é o
 * caminho do dia a dia, e tem volta.
 */
export async function postCancelarPedido({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resultado = await cancelarPedido(
      params.codigo,
      corpo.motivo,
      auth.usuario?.id ?? null
    );

    const devolvidas = resultado.unidadesDevolvidas;

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: devolvidas > 0
          ? `Pedido cancelado. ${devolvidas} unidade(s) voltaram ao estoque.`
          : 'Pedido cancelado.',
        ...resultado,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'Falha ao cancelar pedido');
  }
}

/* =============================================================================
 * APAGAR DE VEZ
 * ========================================================================== */

/**
 * DELETE /api/admin/pedidos/:codigo
 *
 * Serve para limpar teste. O banco recusa se o pedido ainda não estiver
 * cancelado — é o cancelamento que devolve o estoque, e apagar direto
 * deixaria um buraco invisível na prateleira.
 *
 * Como esta é a única operação do sistema que destrói informação, ela fica
 * registrada no log mesmo quando dá certo.
 */
export async function deletePedido({ req, params = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resultado = await excluirPedido(params.codigo);

    console.warn(
      `[admin] Pedido ${resultado.codigo} APAGADO por ${auth.usuario?.email}`
    );

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: `Pedido ${resultado.codigo} apagado em definitivo.`,
        ...resultado,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'Falha ao apagar pedido');
  }
}

export default { postPedidoManual, postCancelarPedido, deletePedido };
