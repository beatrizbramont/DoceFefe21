/**
 * backend/controllers/admin-revendedores-controller.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — aprovação de revendedores.
 *
 * ⚠️ A ROTA DE ESCRITA MAIS SENSÍVEL DO SISTEMA
 *   Aprovar uma candidatura libera preço de atacado para sempre, em todos os
 *   pedidos daquela conta. É a única rota que cria desconto permanente.
 *
 *   Por isso a checagem de permissão é a primeira linha das duas funções, e
 *   os testes em tests/admin.test.mjs provam que ela está lá — sem sessão e
 *   com conta de cliente comum.
 */

import { exigirAdmin } from '../../services/auth-service.js';
import {
  listarRevendedores,
  decidirCandidatura,
  DECISOES,
  ErroRevenda,
} from '../../services/reseller-service.js';

const negar = (auth) => ({
  status: auth.status,
  corpo: { erro: true, mensagem: auth.mensagem },
});

/**
 * GET /api/admin/revendedores?status=pendente&busca=cafe
 */
export async function getRevendedoresAdmin({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const revendedores = await listarRevendedores({
      status: query.status,
      busca: query.busca,
      limite: query.limite,
    });

    return {
      status: 200,
      corpo: {
        revendedores,
        resumo: {
          pendentes: revendedores.filter((r) => r.status === 'pendente').length,
          aprovados: revendedores.filter((r) => r.status === 'aprovado').length,
          total: revendedores.length,
        },
        decisoes: DECISOES,
      },
    };
  } catch (erro) {
    console.error('[admin] Falha ao listar revendedores:', erro);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos carregar os parceiros agora.' },
    };
  }
}

/**
 * PATCH /api/admin/revendedores/:id
 * Corpo: { status, desconto?, pedidoMinimo?, motivo?, observacoes? }
 *
 * ⚠️ É AQUI que alguém passa a comprar no atacado.
 */
export async function patchRevendedor({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resultado = await decidirCandidatura(params.id, corpo, auth.usuario.id);

    const MENSAGENS = {
      aprovado:
        `Parceiro aprovado com ${resultado.desconto}% de desconto sobre o atacado.`,
      recusado: 'Candidatura recusada. O motivo fica registrado.',
      suspenso: 'Parceiro suspenso. Ele volta a pagar preço de varejo.',
    };

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: MENSAGENS[resultado.status] || 'Situação atualizada.',
        ...resultado,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroRevenda) {
      const resposta = { erro: true, mensagem: erro.message };
      if (erro.campo) resposta.erros = { [erro.campo]: erro.message };

      return { status: erro.status, corpo: resposta };
    }

    console.error('[admin] Falha ao decidir candidatura:', erro);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos registrar a decisão.' },
    };
  }
}

export default { getRevendedoresAdmin, patchRevendedor };
