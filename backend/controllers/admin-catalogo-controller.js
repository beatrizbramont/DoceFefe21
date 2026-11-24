/**
 * backend/controllers/admin-catalogo-controller.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — catálogo: produtos, fotos e estoque.
 *
 * ⚠️ TODAS as rotas deste arquivo exigem perfil de administrador, verificado
 *   no SERVIDOR por `exigirAdmin`. A primeira linha de cada função é a mesma
 *   por isso: esconder botões na interface não impede ninguém de chamar a API
 *   direto com um `curl`.
 *
 * O QUE ESTE ARQUIVO RESOLVE
 *   Até a Fase 9, cadastrar produto significava abrir o editor de tabelas do
 *   Supabase, saber que preço é em centavos, que slug tem formato próprio e
 *   que a foto precisa de uma linha em outra tabela. Agora é uma tela.
 */

import { exigirAdmin } from '../../services/auth-service.js';
import {
  listarProdutos,
  obterProduto,
  criarProduto,
  atualizarProduto,
  arquivarProduto,
  restaurarProduto,
  enviarFoto,
  definirFotoPrincipal,
  removerFoto,
  listarCategorias,
  ErroCatalogo,
  TAMANHO_MAXIMO_FOTO_BYTES,
  TIPOS_FOTO_PERMITIDOS,
} from '../../services/product-admin-service.js';
import {
  ajustarEstoque,
  configurarEstoque,
  listarMovimentos,
  TIPOS_MOVIMENTO,
  ErroAdmin,
} from '../../services/admin-service.js';

/** Resposta padrão quando falta permissão. */
const negar = (auth) => ({
  status: auth.status,
  corpo: { erro: true, mensagem: auth.mensagem },
});

/**
 * Converte o erro de domínio em resposta HTTP.
 *
 * `erro.erros` guarda a validação campo a campo — é o que faz o formulário
 * marcar o campo errado em vermelho, em vez de só mostrar um toast genérico.
 */
function responderErro(erro, contexto) {
  if (erro instanceof ErroCatalogo || erro instanceof ErroAdmin) {
    const corpo = { erro: true, mensagem: erro.message };

    if (erro.erros) corpo.erros = erro.erros;
    else if (erro.campo) corpo.erros = { [erro.campo]: erro.message };

    return { status: erro.status, corpo };
  }

  console.error(`[admin/${contexto}] Falha inesperada:`, erro);

  return {
    status: 503,
    corpo: { erro: true, mensagem: 'Não conseguimos concluir agora. Tente de novo.' },
  };
}

/* =============================================================================
 * PRODUTOS
 * ========================================================================== */

/**
 * GET /api/admin/produtos
 * Filtros: ?busca=brownie&categoria=brownies&situacao=rascunhos
 */
export async function getProdutosAdmin({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const [produtos, categorias] = await Promise.all([
      listarProdutos({
        busca: query.busca,
        categoria: query.categoria,
        situacao: query.situacao,
        limite: query.limite,
      }),
      // A tela precisa das categorias para o filtro e para o formulário. Vêm
      // juntas para a página abrir com uma requisição só.
      listarCategorias(),
    ]);

    return { status: 200, corpo: { produtos, categorias } };
  } catch (erro) {
    return responderErro(erro, 'produtos');
  }
}

/** GET /api/admin/produtos/:id */
export async function getProdutoAdmin({ req, params = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const produto = await obterProduto(params.id);

    if (!produto) {
      return { status: 404, corpo: { erro: true, mensagem: 'Produto não encontrado.' } };
    }

    return { status: 200, corpo: { produto } };
  } catch (erro) {
    return responderErro(erro, 'produto');
  }
}

/** POST /api/admin/produtos */
export async function postProduto({ req, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const produto = await criarProduto(corpo, { usuarioId: auth.usuario.id });

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem: produto.publicado
          ? 'Produto cadastrado e publicado!'
          : 'Produto cadastrado. Publique quando estiver pronto.',
        produto,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'criar-produto');
  }
}

/** PATCH /api/admin/produtos/:id */
export async function patchProduto({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const produto = await atualizarProduto(params.id, corpo);

    return {
      status: 200,
      corpo: { sucesso: true, mensagem: 'Alterações salvas.', produto },
    };
  } catch (erro) {
    return responderErro(erro, 'editar-produto');
  }
}

/**
 * DELETE /api/admin/produtos/:id
 *
 * ⚠️ Não apaga: ARQUIVA. Pedidos antigos apontam para o produto, e apagar a
 *   linha transformaria o histórico de vendas em "produto removido".
 *   `?restaurar=1` desfaz.
 */
export async function deleteProduto({ req, params = {}, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const restaurando = query.restaurar === '1' || query.restaurar === 'true';

    const produto = restaurando
      ? await restaurarProduto(params.id)
      : await arquivarProduto(params.id);

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: restaurando
          ? 'Produto restaurado como rascunho.'
          : 'Produto arquivado. O histórico de vendas continua intacto.',
        produto,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'arquivar-produto');
  }
}

/* =============================================================================
 * FOTOS
 * ========================================================================== */

/**
 * POST /api/admin/produtos/:id/fotos
 * Corpo: { arquivo: base64, tipo: 'image/jpeg', nome: 'brownie.jpg', alt?: '' }
 *
 * O arquivo chega em base64 dentro do JSON, como o comprovante de pagamento.
 * Dispensa analisar multipart no servidor; o custo é ~33% de tráfego a mais,
 * irrelevante num arquivo de até 5 MB.
 */
export async function postFotoProduto({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const { produto } = await enviarFoto(params.id, {
      base64: corpo.arquivo,
      tipo: corpo.tipo,
      nome: corpo.nome,
      alt: corpo.alt,
    });

    return {
      status: 201,
      corpo: { sucesso: true, mensagem: 'Foto enviada!', produto },
    };
  } catch (erro) {
    return responderErro(erro, 'foto');
  }
}

/** PATCH /api/admin/produtos/:id/fotos/:fotoId — marca como principal. */
export async function patchFotoProduto({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  if (corpo.principal !== true) {
    return {
      status: 422,
      corpo: { erro: true, mensagem: 'A única alteração possível é definir a foto principal.' },
    };
  }

  try {
    const produto = await definirFotoPrincipal(params.id, params.fotoId);

    return {
      status: 200,
      corpo: { sucesso: true, mensagem: 'Foto principal definida.', produto },
    };
  } catch (erro) {
    return responderErro(erro, 'foto-principal');
  }
}

/** DELETE /api/admin/produtos/:id/fotos/:fotoId */
export async function deleteFotoProduto({ req, params = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const produto = await removerFoto(params.id, params.fotoId);

    return {
      status: 200,
      corpo: { sucesso: true, mensagem: 'Foto removida.', produto },
    };
  } catch (erro) {
    return responderErro(erro, 'remover-foto');
  }
}

/* =============================================================================
 * ESTOQUE
 * ========================================================================== */

/**
 * GET /api/admin/estoque
 *
 * Reaproveita a listagem de produtos: o saldo já vem junto de cada um, e a
 * tela de estoque é uma leitura diferente da mesma informação.
 */
export async function getEstoque({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const produtos = await listarProdutos({
      busca: query.busca,
      situacao: 'ativos',
      limite: 200,
    });

    // Quem abre a tela de estoque quer ver primeiro o que está acabando.
    const ordenados = [...produtos].sort((a, b) => {
      const faltaA = a.estoque?.sobEncomenda ? Infinity : a.estoque?.disponivel ?? 0;
      const faltaB = b.estoque?.sobEncomenda ? Infinity : b.estoque?.disponivel ?? 0;
      return faltaA - faltaB;
    });

    return {
      status: 200,
      corpo: { produtos: ordenados, tipos: TIPOS_MOVIMENTO },
    };
  } catch (erro) {
    return responderErro(erro, 'estoque');
  }
}

/** GET /api/admin/estoque/:id/movimentos */
export async function getMovimentosEstoque({ req, params = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const movimentos = await listarMovimentos(params.id);
    return { status: 200, corpo: { movimentos } };
  } catch (erro) {
    return responderErro(erro, 'movimentos');
  }
}

/**
 * POST /api/admin/estoque/:id
 * Corpo: { tipo: 'entrada'|'saida'|'perda'|'ajuste', quantidade, motivo? }
 */
export async function postMovimentoEstoque({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resultado = await ajustarEstoque(params.id, corpo, auth.usuario.id);

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem:
          `${resultado.produto}: ${resultado.saldoAntes} → ${resultado.saldoApos} ` +
          `(${resultado.movimento > 0 ? '+' : ''}${resultado.movimento})`,
        ...resultado,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'movimento');
  }
}

/**
 * PATCH /api/admin/estoque/:id
 * Corpo: { alertaMinimo?: number, sobEncomenda?: boolean }
 */
export async function patchConfiguracaoEstoque({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const config = await configurarEstoque(params.id, corpo);

    return {
      status: 200,
      corpo: { sucesso: true, mensagem: 'Configuração salva.', ...config },
    };
  } catch (erro) {
    return responderErro(erro, 'config-estoque');
  }
}

/* =============================================================================
 * LIMITES
 * ========================================================================== */

/**
 * GET /api/admin/catalogo/limites
 * O formulário de foto pergunta o que pode enviar antes de deixar escolher.
 */
export async function getLimitesCatalogo({ req } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  return {
    status: 200,
    corpo: {
      foto: {
        tamanhoMaximoBytes: TAMANHO_MAXIMO_FOTO_BYTES,
        tiposPermitidos: TIPOS_FOTO_PERMITIDOS,
      },
      movimentos: TIPOS_MOVIMENTO,
    },
  };
}

export default {
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
};
