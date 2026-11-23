/**
 * cart.js
 * -----------------------------------------------------------------------------
 * Estado do carrinho de compras.
 *
 * COMO O CARRINHO FUNCIONA
 *
 *   O carrinho fica no `localStorage`, então sobrevive a recarregar a página,
 *   fechar a aba e voltar depois — sem exigir login.
 *
 *   Guardamos duas coisas por item:
 *
 *     • slug e quantidade  → o que REALMENTE importa
 *     • nome, preço, foto  → cópia só para desenhar a tela na hora
 *
 *   A cópia existe para o carrinho aparecer instantaneamente, sem esperar a
 *   rede. Mas ela NUNCA é usada para fechar um pedido.
 *
 * ⚠️ POR QUE OS PREÇOS LOCAIS NÃO VALEM NADA
 *
 *   Qualquer pessoa pode abrir o console e escrever:
 *
 *       localStorage.setItem('docefefe21:carrinho:v1',
 *         '[{"slug":"brownie","quantidade":1,"precoUnitario":1}]')
 *
 *   Por isso, antes de mostrar a página do carrinho e antes de fechar
 *   qualquer pedido, enviamos só `{slug, quantidade}` ao servidor e
 *   SUBSTITUÍMOS tudo pelo que ele devolver. O servidor busca os preços no
 *   banco e manda a versão correta de volta.
 *
 *   Resultado: mexer no localStorage não muda o que o cliente paga — no
 *   máximo faz a própria tela dele mostrar um número errado por um instante,
 *   até a validação chegar.
 */

import { api } from './lib/api.js';
import { REGRAS, ROTAS, rota } from './config.js';
import { $$, toastSucesso, toastErro, toastAviso } from './lib/ui.js';

/* =============================================================================
 * ARMAZENAMENTO
 * ========================================================================== */

const CHAVE = REGRAS.chaveCarrinho;

/**
 * Lê o carrinho do navegador.
 *
 * Tolerante a dados corrompidos: se o conteúdo não for uma lista válida,
 * devolve carrinho vazio em vez de quebrar a página. O usuário pode ter
 * editado à mão, ou a estrutura pode ter mudado entre versões.
 */
function lerLocal() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return [];

    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];

    return dados.filter(
      (i) =>
        i &&
        typeof i.slug === 'string' &&
        Number.isInteger(i.quantidade) &&
        i.quantidade > 0
    );
  } catch {
    return [];
  }
}

function gravarLocal(itens) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch (erro) {
    // Pode falhar em aba anônima ou com o armazenamento cheio.
    console.warn('[cart] Não foi possível salvar o carrinho:', erro);
    toastAviso('Não conseguimos salvar seu carrinho neste navegador.');
  }
  avisarMudanca();
}

/* =============================================================================
 * EVENTOS
 *
 * Em vez de o carrinho conhecer cada pedaço da interface, ele avisa que
 * mudou e quem precisa se atualiza. O contador do cabeçalho e a página do
 * carrinho escutam o mesmo evento.
 * ========================================================================== */

const EVENTO_MUDANCA = 'carrinho:mudou';

function avisarMudanca() {
  document.dispatchEvent(
    new CustomEvent(EVENTO_MUDANCA, { detail: { itens: lerLocal() } })
  );
}

/** Registra um ouvinte para mudanças no carrinho. */
export function aoMudarCarrinho(callback) {
  document.addEventListener(EVENTO_MUDANCA, (evento) => callback(evento.detail));
}

/* =============================================================================
 * OPERAÇÕES
 * ========================================================================== */

/**
 * Adiciona um produto ao carrinho.
 *
 * @param {object} produto - no formato devolvido pela API
 * @param {number} [quantidade]
 * @returns {boolean} true se adicionou
 */
export function adicionar(produto, quantidade = 1) {
  if (!produto?.slug) {
    console.warn('[cart] Produto sem slug não pode ser adicionado.');
    return false;
  }

  if (!produto.emEstoque) {
    toastErro('Este produto está esgotado no momento.');
    return false;
  }

  const qtd = Math.min(
    Math.max(1, Number.parseInt(quantidade, 10) || 1),
    REGRAS.quantidadeMaximaItem
  );

  const itens = lerLocal();
  const existente = itens.find((i) => i.slug === produto.slug);

  if (existente) {
    const novaQuantidade = Math.min(
      existente.quantidade + qtd,
      REGRAS.quantidadeMaximaItem
    );

    if (novaQuantidade === existente.quantidade) {
      toastAviso(`Máximo de ${REGRAS.quantidadeMaximaItem} unidades por item.`);
      return false;
    }

    existente.quantidade = novaQuantidade;
  } else {
    if (itens.length >= 50) {
      toastErro('O carrinho aceita no máximo 50 produtos diferentes.');
      return false;
    }

    itens.push({
      slug: produto.slug,
      quantidade: qtd,
      // Cópia para desenho imediato. Revalidada pelo servidor.
      nome: produto.nome,
      precoUnitario: produto.preco,
      imagem: produto.imagem || null,
      categoria: produto.categoria?.nome || null,
    });
  }

  gravarLocal(itens);
  return true;
}

/** Altera a quantidade de um item. Quantidade 0 remove. */
export function alterarQuantidade(slug, quantidade) {
  const qtd = Number.parseInt(quantidade, 10) || 0;

  if (qtd <= 0) {
    remover(slug);
    return;
  }

  const itens = lerLocal();
  const item = itens.find((i) => i.slug === slug);
  if (!item) return;

  item.quantidade = Math.min(qtd, REGRAS.quantidadeMaximaItem);
  gravarLocal(itens);
}

/** Remove um item do carrinho. */
export function remover(slug) {
  gravarLocal(lerLocal().filter((i) => i.slug !== slug));
}

/** Esvazia o carrinho. */
export function esvaziar() {
  gravarLocal([]);
}

/** Itens guardados localmente (sem validação). */
export function obterItens() {
  return lerLocal();
}

/** Total de unidades no carrinho — o número do contador no cabeçalho. */
export function contarItens() {
  return lerLocal().reduce((soma, i) => soma + i.quantidade, 0);
}

/** Subtotal estimado, apenas para exibição imediata. */
export function subtotalEstimado() {
  return lerLocal().reduce(
    (soma, i) => soma + (i.precoUnitario || 0) * i.quantidade,
    0
  );
}


/* =============================================================================
 * VALIDAÇÃO NO SERVIDOR
 * ========================================================================== */

/**
 * Envia o carrinho ao servidor e recebe a versão autoritativa.
 *
 * O carrinho local é SUBSTITUÍDO pelo resultado: itens esgotados somem,
 * quantidades são ajustadas ao estoque e os preços passam a ser os do banco.
 *
 * @returns {Promise<object>} o carrinho validado
 */
export async function validarNoServidor() {
  const itens = lerLocal();

  if (itens.length === 0) {
    return {
      itens: [],
      avisos: [],
      subtotal: 0,
      desconto: 0,
      total: 0,
      quantidadeItens: 0,
      atacado: false,
    };
  }

  const resposta = await api.post('/carrinho/validar', {
    // Enviamos SÓ o necessário. Nome e preço locais não vão — o servidor
    // não deve sequer ter a chance de considerá-los.
    itens: itens.map((i) => ({
      slug: i.slug,
      quantidade: i.quantidade,
      // O preço vai apenas para o servidor poder avisar "mudou de preço".
      preco: i.precoUnitario,
    })),
  });

  // Sincroniza o armazenamento local com a verdade do servidor.
  const atualizados = resposta.itens.map((i) => ({
    slug: i.slug,
    quantidade: i.quantidade,
    nome: i.nome,
    precoUnitario: i.precoUnitario,
    imagem: i.imagem,
    categoria: i.categoria,
  }));

  try {
    localStorage.setItem(CHAVE, JSON.stringify(atualizados));
  } catch {
    /* ignora falha de armazenamento */
  }

  avisarMudanca();
  return resposta;
}

/* =============================================================================
 * CONTADOR NO CABEÇALHO
 * ========================================================================== */

/** Atualiza a bolinha com o número de itens, em todas as instâncias. */
export function atualizarContador() {
  const total = contarItens();

  $$('[data-contador-carrinho]').forEach((el) => {
    el.textContent = total > 99 ? '99+' : String(total);
    el.hidden = total === 0;
  });
}

/* =============================================================================
 * BOTÕES "ADICIONAR AO CARRINHO" DECLARADOS NO HTML
 * ========================================================================== */

/**
 * Liga os botões marcados com `data-adicionar-carrinho`.
 *
 * O produto precisa estar em `window.__produtoAtual` (página de detalhes) ou
 * ser informado pelo próprio chamador.
 */
export function ativarBotoesAdicionar(raiz = document) {
  raiz.querySelectorAll('[data-adicionar-carrinho]').forEach((botao) => {
    if (botao.dataset.ligado === 'sim') return;
    botao.dataset.ligado = 'sim';

    botao.addEventListener('click', (evento) => {
      evento.preventDefault();

      const produto = botao.__produto;
      if (!produto) {
        console.warn('[cart] Botão sem produto associado.');
        return;
      }

      const quantidade = Number.parseInt(botao.dataset.quantidade, 10) || 1;

      if (adicionar(produto, quantidade)) {
        atualizarContador();
        toastSucesso(
          quantidade > 1
            ? `${quantidade}× ${produto.nome} no carrinho!`
            : `${produto.nome} no carrinho!`
        );
      }
    });
  });
}

/** Link para a página do carrinho, respeitando a pasta atual. */
export const urlCarrinho = () => rota(ROTAS.carrinho);

/* =============================================================================
 * INICIALIZAÇÃO
 * ========================================================================== */

function iniciar() {
  atualizarContador();

  // Mantém o contador em dia a cada mudança.
  aoMudarCarrinho(atualizarContador);

  // Carrinho aberto em duas abas: o evento `storage` dispara na OUTRA aba
  // quando esta grava algo. Assim as duas ficam sincronizadas.
  window.addEventListener('storage', (evento) => {
    if (evento.key === CHAVE) {
      atualizarContador();
      avisarMudanca();
    }
  });
}

// O cabeçalho é montado por main.js; esperamos o DOM para achar o contador.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}

export default {
  adicionar,
  remover,
  alterarQuantidade,
  esvaziar,
  obterItens,
  contarItens,
  subtotalEstimado,
  validarNoServidor,
  atualizarContador,
  aoMudarCarrinho,
};
