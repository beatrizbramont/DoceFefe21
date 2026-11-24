/**
 * backend/routes/index.js
 * -----------------------------------------------------------------------------
 * Tabela de rotas da API, declarada de forma independente de framework.
 *
 * Cada rota é um objeto simples. Tanto o servidor Express quanto o servidor
 * nativo leem esta mesma tabela — assim não existe risco de uma rota
 * funcionar num e faltar no outro.
 */

import {
  getProdutos,
  getProduto,
  getCategorias,
  getVitrines,
} from '../controllers/products-controller.js';
import { postValidarCarrinho } from '../controllers/cart-controller.js';
import { postContato } from '../controllers/contact-controller.js';
import {
  getPerfil,
  patchPerfil,
  getMeusPedidos,
} from '../controllers/profile-controller.js';
import { postPedido, getPedido } from '../controllers/order-controller.js';
import {
  postFormaPagamento,
  postComprovante,
  getSituacaoPagamento,
} from '../controllers/payment-controller.js';
import {
  getPedidosAdmin,
  getComprovante,
  postConferirPagamento,
  patchStatusPedido,
  getSessaoAdmin,
} from '../controllers/admin-controller.js';
import {
  getResumoAdmin,
  getClientesAdmin,
} from '../controllers/admin-painel-controller.js';
import {
  postCandidatura,
  getMinhaCandidatura,
} from '../controllers/reseller-controller.js';
import {
  getRevendedoresAdmin,
  patchRevendedor,
} from '../controllers/admin-revendedores-controller.js';
import {
  getProdutosAdmin,
  getProdutoAdmin,
  postProduto,
  patchProduto,
  deleteProduto,
  postFotoProduto,
  patchFotoProduto,
  deleteFotoProduto,
  getEstoque,
  getMovimentosEstoque,
  postMovimentoEstoque,
  patchConfiguracaoEstoque,
  getLimitesCatalogo,
} from '../controllers/admin-catalogo-controller.js';
import { verificarConexao } from '../../services/database.js';
import { limitadorLeitura, limitadorEscrita } from '../middleware/seguranca.js';

/**
 * GET /api/saude — diagnóstico.
 * Útil para monitoramento e para conferir rapidamente se o banco responde.
 */
async function getSaude() {
  const banco = await verificarConexao();

  return {
    status: banco.conectado ? 200 : 503,
    corpo: {
      servico: 'Doce Fefê.21 API',
      versao: '0.1.0',
      banco: {
        conectado: banco.conectado,
        esquemaAplicado: banco.esquemaAplicado,
        mensagem: banco.mensagem,
      },
    },
  };
}

/**
 * Lista de rotas.
 *
 * `padrao` usa :parametro para trechos variáveis.
 * `limitador` define a política de limitação de requisições.
 */
export const ROTAS = [
  {
    metodo: 'GET',
    padrao: '/api/saude',
    manipulador: getSaude,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/categorias',
    manipulador: getCategorias,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/vitrines',
    manipulador: getVitrines,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/produtos',
    manipulador: getProdutos,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/produtos/:slug',
    manipulador: getProduto,
    limitador: limitadorLeitura,
  },

  // --- Carrinho ---
  // Usam POST, e não GET, porque enviam a lista de itens no corpo.
  // O limitador de escrita é mais rígido: 20 por minuto em vez de 180.
  {
    metodo: 'POST',
    padrao: '/api/carrinho/validar',
    manipulador: postValidarCarrinho,
    limitador: limitadorEscrita,
  },
  // A rota de cupom foi removida: a loja ainda não trabalha com cupons.
  // A tabela `coupons` e a função SQL continuam no banco, prontas para a
  // Fase 11 (marketing) — só não há mais como aplicar cupom pelo site.

  // --- Contato ---
  // Rota pública sem login: é a mais exposta do sistema. O limitador de
  // escrita (20/min) é a barreira contra envio em massa.
  {
    metodo: 'POST',
    padrao: '/api/contato',
    manipulador: postContato,
    limitador: limitadorEscrita,
  },

  // --- Área do cliente (exigem sessão válida) ---
  // A proteção real está dentro de cada controlador, via `exigirAutenticacao`.
  // Não basta a rota "parecer" privada: sem a checagem, bastaria chamá-la.
  {
    metodo: 'GET',
    padrao: '/api/perfil',
    manipulador: getPerfil,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/perfil',
    manipulador: patchPerfil,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'GET',
    padrao: '/api/perfil/pedidos',
    manipulador: getMeusPedidos,
    limitador: limitadorLeitura,
  },

  // --- Revendedores (candidatura) ---
  // Exigem sessão: o preço de atacado é resolvido pelo usuario_id, então
  // candidatura sem conta vinculada não levaria a desconto nenhum.
  // Nenhuma delas aprova — aprovar é /api/admin/revendedores/:id.
  {
    metodo: 'GET',
    padrao: '/api/revendedores/eu',
    manipulador: getMinhaCandidatura,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'POST',
    padrao: '/api/revendedores',
    manipulador: postCandidatura,
    limitador: limitadorEscrita,
  },

  // --- Pedidos ---
  // Criar pedido NÃO exige login: a loja não deve perder venda por causa de
  // cadastro. Quem estiver logado tem o pedido vinculado à conta.
  {
    metodo: 'POST',
    padrao: '/api/pedidos',
    manipulador: postPedido,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'GET',
    padrao: '/api/pedidos/:codigo',
    manipulador: getPedido,
    limitador: limitadorLeitura,
  },

  // --- Pagamento ---
  // NENHUMA destas rotas aprova pagamento. O máximo que fazem é registrar
  // que o cliente afirma ter pago. A loja confere depois.
  {
    metodo: 'GET',
    padrao: '/api/pedidos/:codigo/pagamento',
    manipulador: getSituacaoPagamento,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'POST',
    padrao: '/api/pedidos/:codigo/pagamento',
    manipulador: postFormaPagamento,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'POST',
    padrao: '/api/pedidos/:codigo/comprovante',
    manipulador: postComprovante,
    limitador: limitadorEscrita,
  },

  // --- Painel administrativo ---
  // A proteção real está DENTRO de cada controlador, via `exigirAdmin`.
  // O prefixo /admin na URL é organização, não segurança: quem decide é a
  // verificação de perfil no servidor.
  {
    metodo: 'GET',
    padrao: '/api/admin/sessao',
    manipulador: getSessaoAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/pedidos',
    manipulador: getPedidosAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/pedidos/:codigo/comprovante',
    manipulador: getComprovante,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'POST',
    padrao: '/api/admin/pedidos/:codigo/conferir',
    manipulador: postConferirPagamento,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/admin/pedidos/:codigo/status',
    manipulador: patchStatusPedido,
    limitador: limitadorEscrita,
  },

  // --- Painel: visão geral ---
  // Faturamento e dados pessoais de clientes. As duas rotas de leitura mais
  // sensíveis do sistema — ver admin-painel-controller.js.
  {
    metodo: 'GET',
    padrao: '/api/admin/resumo',
    manipulador: getResumoAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/clientes',
    manipulador: getClientesAdmin,
    limitador: limitadorLeitura,
  },

  // --- Painel: revendedores ---
  // ⚠️ O PATCH é a única rota do sistema que cria desconto permanente.
  {
    metodo: 'GET',
    padrao: '/api/admin/revendedores',
    manipulador: getRevendedoresAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/admin/revendedores/:id',
    manipulador: patchRevendedor,
    limitador: limitadorEscrita,
  },

  // --- Painel: catálogo ---
  {
    metodo: 'GET',
    padrao: '/api/admin/catalogo/limites',
    manipulador: getLimitesCatalogo,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/produtos',
    manipulador: getProdutosAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'POST',
    padrao: '/api/admin/produtos',
    manipulador: postProduto,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/produtos/:id',
    manipulador: getProdutoAdmin,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/admin/produtos/:id',
    manipulador: patchProduto,
    limitador: limitadorEscrita,
  },
  // DELETE aqui significa ARQUIVAR. Apagar de verdade quebraria o histórico
  // de vendas, que aponta para o produto. Ver o controlador.
  {
    metodo: 'DELETE',
    padrao: '/api/admin/produtos/:id',
    manipulador: deleteProduto,
    limitador: limitadorEscrita,
  },

  // --- Painel: fotos dos produtos ---
  {
    metodo: 'POST',
    padrao: '/api/admin/produtos/:id/fotos',
    manipulador: postFotoProduto,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/admin/produtos/:id/fotos/:fotoId',
    manipulador: patchFotoProduto,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'DELETE',
    padrao: '/api/admin/produtos/:id/fotos/:fotoId',
    manipulador: deleteFotoProduto,
    limitador: limitadorEscrita,
  },

  // --- Painel: estoque ---
  {
    metodo: 'GET',
    padrao: '/api/admin/estoque',
    manipulador: getEstoque,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'GET',
    padrao: '/api/admin/estoque/:id/movimentos',
    manipulador: getMovimentosEstoque,
    limitador: limitadorLeitura,
  },
  {
    metodo: 'POST',
    padrao: '/api/admin/estoque/:id',
    manipulador: postMovimentoEstoque,
    limitador: limitadorEscrita,
  },
  {
    metodo: 'PATCH',
    padrao: '/api/admin/estoque/:id',
    manipulador: patchConfiguracaoEstoque,
    limitador: limitadorEscrita,
  },
];

/**
 * Compara um caminho com o padrão de uma rota.
 *
 * @returns {object|null} os parâmetros extraídos, ou null se não casar
 *
 * @example
 *   casar('/api/produtos/:slug', '/api/produtos/brownie')  // { slug: 'brownie' }
 */
export function casar(padrao, caminho) {
  const partesPadrao = padrao.split('/').filter(Boolean);
  const partesCaminho = caminho.split('/').filter(Boolean);

  if (partesPadrao.length !== partesCaminho.length) return null;

  const params = {};

  for (let i = 0; i < partesPadrao.length; i += 1) {
    const esperado = partesPadrao[i];
    const recebido = partesCaminho[i];

    if (esperado.startsWith(':')) {
      params[esperado.slice(1)] = decodeURIComponent(recebido);
    } else if (esperado !== recebido) {
      return null;
    }
  }

  return params;
}

/** Encontra a rota correspondente a um método e caminho. */
export function encontrarRota(metodo, caminho) {
  for (const rota of ROTAS) {
    if (rota.metodo !== metodo) continue;
    const params = casar(rota.padrao, caminho);
    if (params) return { rota, params };
  }
  return null;
}

export default ROTAS;
