/**
 * services/cart-service.js
 * -----------------------------------------------------------------------------
 * Validação do carrinho e dos cupons — do lado do servidor.
 *
 * ⚠️ PRINCÍPIO CENTRAL DESTA CAMADA
 *
 *   O carrinho é guardado no navegador do cliente (localStorage). Isso é bom
 *   para a experiência — não perde itens ao navegar, funciona sem login —,
 *   mas significa que o cliente CONTROLA esses dados. Ele pode abrir o
 *   console e escrever:
 *
 *       localStorage.setItem('docefefe21:carrinho:v1',
 *         '[{"slug":"brownie","quantidade":1,"preco":1}]')
 *
 *   Por isso NADA que venha do carrinho é confiável. Desta camada, aceitamos
 *   apenas DUAS informações:
 *
 *       • qual produto (pelo slug)
 *       • quantas unidades
 *
 *   Preço, nome, peso, disponibilidade e desconto são SEMPRE buscados no
 *   banco, aqui. O preço enviado pelo navegador é ignorado por completo —
 *   serve no máximo para avisarmos "o preço mudou desde que você adicionou".
 */

import { selecionar, selecionarUm } from './database.js';
import { obterCondicoesRevendedor } from './product-service.js';

/* =============================================================================
 * LIMITES
 * ========================================================================== */

const QUANTIDADE_MINIMA = 1;

export const QUANTIDADE_MAXIMA = 99;

/** Teto de itens distintos. Impede um carrinho com 10 mil linhas. */
export const ITENS_MAXIMOS = 50;

/* =============================================================================
 * VALIDAÇÃO DO CARRINHO
 * ========================================================================== */

/**
 * Revalida o carrinho contra o banco.
 *
 * @param {Array<{slug: string, quantidade: number, preco?: number}>} itensEnviados
 * @param {object} [opcoes]
 * @param {string|null} [opcoes.usuarioId]
 * @returns {Promise<object>} carrinho autoritativo
 */
export async function validarCarrinho(itensEnviados, { usuarioId = null } = {}) {
  // ---------------------------------------------------------------------
  // 1. Saneamento da entrada
  // ---------------------------------------------------------------------
  if (!Array.isArray(itensEnviados)) {
    return carrinhoVazio();
  }

  const pedidos = new Map();

  for (const item of itensEnviados.slice(0, ITENS_MAXIMOS)) {
    if (!item || typeof item.slug !== 'string') continue;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug)) continue;

    // Validar ANTES de limitar.
    //
    // A primeira versão fazia `Math.max(1, parseInt(x) || 0)` e só depois
    // checava se era menor que 1 — guarda que nunca disparava, porque o
    // Math.max já havia transformado qualquer lixo em 1. Resultado:
    // `quantidade: "muitos"` virava silenciosamente 1 unidade.
    //
    // Entrada inválida precisa ser DESCARTADA, não adivinhada: um erro no
    // frontend não pode acabar virando item fantasma no pedido.
    const bruta = Number(item.quantidade);

    if (!Number.isInteger(bruta) || bruta < QUANTIDADE_MINIMA) continue;

    const quantidade = Math.min(bruta, QUANTIDADE_MAXIMA);

    // Slug repetido: soma as quantidades em vez de criar duas linhas.
    const existente = pedidos.get(item.slug);
    pedidos.set(item.slug, {
      slug: item.slug,
      quantidade: Math.min(
        (existente?.quantidade || 0) + quantidade,
        QUANTIDADE_MAXIMA
      ),
      // Guardado só para comparar e avisar sobre mudança de preço.
      precoInformado: Number.isInteger(item.preco) ? item.preco : null,
    });
  }

  if (pedidos.size === 0) return carrinhoVazio();

  // ---------------------------------------------------------------------
  // 2. Busca os dados reais no banco
  // ---------------------------------------------------------------------
  const slugs = [...pedidos.keys()];

  const produtos = await selecionar('catalogo_publico', {
    colunas:
      'id,slug,nome,preco_varejo,preco_promocional,preco_efetivo,em_promocao,' +
      'medida,disponivel,sob_encomenda,categoria_nome,imagens',
    // `in.(...)` é o operador de lista do PostgREST.
    filtros: { slug: `in.(${slugs.join(',')})` },
  });

  const porSlug = new Map(produtos.map((p) => [p.slug, p]));

  // ---------------------------------------------------------------------
  // 3. Preço de atacado, se houver direito
  // ---------------------------------------------------------------------
  const condicoes = await obterCondicoesRevendedor(usuarioId);

  let precosAtacado = new Map();
  if (condicoes.aprovado && produtos.length > 0) {
    const lista = await selecionar('products', {
      colunas: 'id,preco_atacado,minimo_atacado',
      filtros: { id: `in.(${produtos.map((p) => p.id).join(',')})` },
    });
    precosAtacado = new Map(lista.map((p) => [p.id, p]));
  }

  // ---------------------------------------------------------------------
  // 4. Monta o carrinho autoritativo
  // ---------------------------------------------------------------------
  const itens = [];
  const avisos = [];
  const removidos = [];

  for (const [slug, pedido] of pedidos) {
    const produto = porSlug.get(slug);

    // Produto saiu do catálogo (despublicado, arquivado ou slug inválido).
    if (!produto) {
      removidos.push({ slug, motivo: 'indisponivel' });
      avisos.push({
        tipo: 'removido',
        slug,
        mensagem: 'Um item saiu do catálogo e foi removido do seu carrinho.',
      });
      continue;
    }

    // --- Preço autoritativo ---
    const dadosAtacado = precosAtacado.get(produto.id);
    const podeAtacado = condicoes.aprovado && dadosAtacado?.preco_atacado;

    const precoUnitario = podeAtacado
      ? dadosAtacado.preco_atacado
      : produto.preco_efetivo;

    const tipoPreco = podeAtacado
      ? 'atacado'
      : produto.em_promocao
        ? 'promocional'
        : 'varejo';

    // --- Quantidade autoritativa ---
    let quantidade = pedido.quantidade;

    const disponivel = Number(produto.disponivel) || 0;
    const sobEncomenda = produto.sob_encomenda === true;

    if (!sobEncomenda && disponivel <= 0) {
      removidos.push({ slug, motivo: 'esgotado' });
      avisos.push({
        tipo: 'esgotado',
        slug,
        nome: produto.nome,
        mensagem: `"${produto.nome}" está esgotado e foi removido do carrinho.`,
      });
      continue;
    }

    if (!sobEncomenda && quantidade > disponivel) {
      avisos.push({
        tipo: 'quantidade_ajustada',
        slug,
        nome: produto.nome,
        de: quantidade,
        para: disponivel,
        mensagem: `Só temos ${disponivel} unidade(s) de "${produto.nome}". A quantidade foi ajustada.`,
      });
      quantidade = disponivel;
    }

    // Pedido mínimo de atacado.
    if (podeAtacado && dadosAtacado.minimo_atacado > quantidade) {
      avisos.push({
        tipo: 'minimo_atacado',
        slug,
        nome: produto.nome,
        minimo: dadosAtacado.minimo_atacado,
        mensagem:
          `O preço de atacado de "${produto.nome}" exige no mínimo ` +
          `${dadosAtacado.minimo_atacado} unidades.`,
      });
    }

    // --- Mudança de preço desde que o item foi adicionado ---
    if (pedido.precoInformado !== null && pedido.precoInformado !== precoUnitario) {
      avisos.push({
        tipo: 'preco_alterado',
        slug,
        nome: produto.nome,
        de: pedido.precoInformado,
        para: precoUnitario,
        mensagem: `O preço de "${produto.nome}" foi atualizado.`,
      });
    }

    const imagens = Array.isArray(produto.imagens) ? produto.imagens : [];
    const principal = imagens.find((i) => i.principal) || imagens[0] || null;

    itens.push({
      slug: produto.slug,
      nome: produto.nome,
      categoria: produto.categoria_nome,
      quantidade,
      precoUnitario,
      precoOriginal:
        precoUnitario < produto.preco_varejo ? produto.preco_varejo : null,
      tipoPreco,
      subtotal: precoUnitario * quantidade,
      medida: produto.medida,
      disponivel,
      sobEncomenda,
      imagem: principal ? { url: principal.url, alt: principal.alt } : null,
      demonstracao: produto.slug.startsWith('demo-'),
    });
  }

  const subtotal = itens.reduce((soma, i) => soma + i.subtotal, 0);

  return {
    itens,
    removidos,
    avisos,
    subtotal,
    desconto: 0,
    total: subtotal,
    cupom: null,
    quantidadeItens: itens.reduce((soma, i) => soma + i.quantidade, 0),
    atacado: condicoes.aprovado,
    pedidoMinimo: condicoes.pedidoMinimo,
  };
}

function carrinhoVazio() {
  return {
    itens: [],
    removidos: [],
    avisos: [],
    subtotal: 0,
    desconto: 0,
    total: 0,
    cupom: null,
    quantidadeItens: 0,
    atacado: false,
    pedidoMinimo: 0,
  };
}

/* =============================================================================
 * CUPONS
 * ========================================================================== */

/**
 * Valida um cupom e calcula o desconto.
 *
 * ⚠️ A tabela `coupons` NÃO é legível pela chave pública (ver 02-rls.sql).
 *   Só o backend, com a chave de serviço, consegue consultá-la. Isso impede
 *   que alguém liste todos os códigos ativos pelo navegador.
 *
 * @param {string} codigo
 * @param {number} subtotalCentavos
 * @returns {Promise<{valido: boolean, mensagem: string, cupom?: object, desconto?: number}>}
 */
export async function validarCupom(codigo, subtotalCentavos) {
  // --- Saneamento ---
  const limpo = String(codigo || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');

  if (!limpo || limpo.length < 3 || limpo.length > 30) {
    return { valido: false, mensagem: 'Código de cupom inválido.' };
  }

  const subtotal = Number.parseInt(subtotalCentavos, 10);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return { valido: false, mensagem: 'Adicione produtos antes de aplicar um cupom.' };
  }

  // --- Busca ---
  const cupom = await selecionarUm('coupons', {
    colunas:
      'id,codigo,descricao,tipo,valor,valor_minimo_pedido,desconto_maximo,' +
      'limite_usos,usos,valido_de,valido_ate,ativo',
    filtros: { codigo: `eq.${limpo}` },
  });

  // Mensagem genérica de propósito: distinguir "não existe" de "expirado"
  // permitiria descobrir quais códigos existem por tentativa e erro.
  if (!cupom || !cupom.ativo) {
    return { valido: false, mensagem: 'Cupom inválido ou expirado.' };
  }

  const agora = new Date();

  if (cupom.valido_de && new Date(cupom.valido_de) > agora) {
    return { valido: false, mensagem: 'Cupom inválido ou expirado.' };
  }

  if (cupom.valido_ate && new Date(cupom.valido_ate) < agora) {
    return { valido: false, mensagem: 'Este cupom já expirou.' };
  }

  if (cupom.limite_usos !== null && cupom.usos >= cupom.limite_usos) {
    return { valido: false, mensagem: 'Este cupom atingiu o limite de usos.' };
  }

  if (subtotal < cupom.valor_minimo_pedido) {
    const faltam = cupom.valor_minimo_pedido - subtotal;
    return {
      valido: false,
      mensagem:
        `Este cupom vale a partir de ${formatarReais(cupom.valor_minimo_pedido)}. ` +
        `Faltam ${formatarReais(faltam)}.`,
    };
  }

  // --- Cálculo do desconto ---
  let desconto;

  if (cupom.tipo === 'percentual') {
    // Math.floor para nunca arredondar o desconto para cima — o cliente
    // paga, no máximo, o centavo a menos.
    desconto = Math.floor((subtotal * cupom.valor) / 100);

    if (cupom.desconto_maximo) {
      desconto = Math.min(desconto, cupom.desconto_maximo);
    }
  } else {
    desconto = cupom.valor;
  }

  // O desconto nunca pode passar do subtotal — senão o total ficaria
  // negativo e a constraint do banco rejeitaria o pedido.
  desconto = Math.min(desconto, subtotal);

  return {
    valido: true,
    mensagem: 'Cupom aplicado!',
    cupom: {
      codigo: cupom.codigo,
      descricao: cupom.descricao,
      tipo: cupom.tipo,
      valor: cupom.valor,
    },
    desconto,
  };
}

/** Formatação simples de reais para as mensagens do servidor. */
function formatarReais(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}

/* =============================================================================
 * CARRINHO COMPLETO (itens + cupom)
 * ========================================================================== */

/**
 * Valida o carrinho inteiro, aplicando o cupom se houver.
 *
 * Esta é a função que o checkout usará na Fase 7: ela devolve os valores
 * definitivos, calculados no servidor, prontos para virar um pedido.
 *
 * @param {Array} itens
 * @param {object} [opcoes]
 * @param {string} [opcoes.cupom]
 * @param {string|null} [opcoes.usuarioId]
 */
export async function validarCarrinhoCompleto(itens, { cupom = '', usuarioId = null } = {}) {
  const carrinho = await validarCarrinho(itens, { usuarioId });

  if (!cupom || carrinho.subtotal === 0) {
    return carrinho;
  }

  const resultado = await validarCupom(cupom, carrinho.subtotal);

  if (!resultado.valido) {
    // Cupom deixou de valer (ex.: item removido baixou o subtotal).
    carrinho.avisos.push({
      tipo: 'cupom_invalido',
      mensagem: resultado.mensagem,
    });
    return carrinho;
  }

  carrinho.cupom = resultado.cupom;
  carrinho.desconto = resultado.desconto;
  carrinho.total = carrinho.subtotal - resultado.desconto;

  return carrinho;
}

export default {
  validarCarrinho,
  validarCarrinhoCompleto,
  validarCupom,
  QUANTIDADE_MAXIMA,
  ITENS_MAXIMOS,
};
