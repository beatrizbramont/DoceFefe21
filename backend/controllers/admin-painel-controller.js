/**
 * backend/controllers/admin-painel-controller.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — visão geral: dashboard e clientes.
 *
 * ⚠️ AS DUAS ROTAS MAIS SENSÍVEIS DE LEITURA DO SISTEMA
 *   O dashboard mostra o faturamento da loja. A lista de clientes mostra
 *   nome, e-mail, telefone e quanto cada pessoa já gastou — dado pessoal sob
 *   a LGPD. Nada disso pode sair sem `exigirAdmin`, e é por isso que a
 *   checagem é a primeira linha das duas funções.
 */

import { exigirAdmin } from '../../services/auth-service.js';
import {
  obterResumo,
  listarClientes,
  obterSeparacao,
  PERIODOS,
  ErroAdmin,
} from '../../services/admin-service.js';

const negar = (auth) => ({
  status: auth.status,
  corpo: { erro: true, mensagem: auth.mensagem },
});

/**
 * GET /api/admin/resumo?dias=30
 *
 * ⚠️ Faturamento conta só pedido com pagamento JÁ CONFERIDO pela loja.
 *   Somar pedido criado daria um número bonito e falso: boa parte nunca é
 *   paga. Quem decide o que entra é a função `resumo_admin` no banco.
 */
export async function getResumoAdmin({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resumo = await obterResumo(Number.parseInt(query.dias, 10));

    return {
      status: 200,
      corpo: {
        resumo,
        periodos: PERIODOS,
        admin: { email: auth.usuario.email },
      },
    };
  } catch (erro) {
    console.error('[admin] Falha ao montar o resumo:', erro);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos carregar os números agora.' },
    };
  }
}

/**
 * GET /api/admin/clientes?busca=ana&perfil=cliente&ordem=compras
 */
export async function getClientesAdmin({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const clientes = await listarClientes({
      busca: query.busca,
      perfil: query.perfil,
      ordem: query.ordem,
      limite: query.limite,
    });

    return {
      status: 200,
      corpo: {
        clientes,
        resumo: {
          total: clientes.length,
          compradores: clientes.filter((c) => c.pedidos > 0).length,
          aceitamMarketing: clientes.filter((c) => c.aceitaMarketing).length,
        },
      },
    };
  } catch (erro) {
    console.error('[admin] Falha ao listar clientes:', erro);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos carregar os clientes agora.' },
    };
  }
}

/**
 * GET /api/admin/separacao?data=2026-11-25&filtro=a-produzir
 *
 * O que precisa sair da cozinha num dia. Sem `data`, devolve os pedidos que
 * ainda não têm dia combinado — que é uma pergunta legítima, não um filtro
 * esquecido.
 */
export async function getSeparacao({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const separacao = await obterSeparacao({
      data: query.data,
      filtro: query.filtro,
    });

    return { status: 200, corpo: separacao };
  } catch (erro) {
    if (erro instanceof ErroAdmin) {
      const resposta = { erro: true, mensagem: erro.message };
      if (erro.campo) resposta.erros = { [erro.campo]: erro.message };

      return { status: erro.status, corpo: resposta };
    }

    console.error('[admin] Falha ao montar a separação:', erro);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos carregar os pedidos do dia.' },
    };
  }
}

export default { getResumoAdmin, getClientesAdmin, getSeparacao };
