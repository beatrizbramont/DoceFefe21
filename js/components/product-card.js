/**
 * components/product-card.js
 * -----------------------------------------------------------------------------
 * Card de produto — usado no catálogo, nas vitrines da home e nos
 * relacionados da página de detalhes.
 *
 * SEGURANÇA
 *   Todo texto vindo do banco entra por `textContent` (via a função `criar`),
 *   nunca por innerHTML. Um produto chamado `<img onerror=alert(1)>` apareceria
 *   como texto na tela em vez de executar. Proteção por construção.
 */

import { criar } from '../lib/ui.js';
import { icone, iconeDaCategoria } from './icons.js';
import { moeda, resumir } from '../lib/format.js';
import { ROTAS, rota, urlMidia } from '../config.js';

/* -----------------------------------------------------------------------------
 * Partes do card
 * -------------------------------------------------------------------------- */

/** Selos no canto da imagem: promoção, novidade, mais vendido. */
function criarSelos(produto) {
  const selos = [];

  if (produto.tipoPreco === 'atacado') {
    selos.push(criar('span', { class: 'selo selo--sucesso', texto: 'Atacado' }));
  } else if (produto.tipoPreco === 'promocional') {
    const porcentagem = Math.round((produto.economia / produto.precoOriginal) * 100);
    selos.push(
      criar('span', { class: 'selo selo--destaque', texto: `-${porcentagem}%` })
    );
  }

  if (produto.novidade) {
    selos.push(criar('span', { class: 'selo selo--novo', texto: 'Novidade' }));
  }

  if (produto.sazonal) {
    selos.push(criar('span', { class: 'selo selo--aviso', texto: 'Natal' }));
  }

  // Marcação honesta: o preço deste item ainda não foi confirmado pela
  // cliente. Some sozinha quando o slug perder o prefixo `demo-`.
  if (produto.demonstracao) {
    selos.push(
      criar('span', {
        class: 'selo selo--neutro',
        texto: 'Preço a confirmar',
        title: 'Valor provisório, usado para montar o site.',
      })
    );
  }

  if (selos.length === 0) return null;

  return criar('div', { class: 'produto-card__selos' }, selos);
}

/**
 * Área da imagem.
 * Sem foto cadastrada, exibimos um marcador com a identidade da marca —
 * melhor que uma imagem genérica de banco de imagens, que destoaria.
 */
function criarMidia(produto) {
  const filhos = [];

  if (produto.imagem?.url) {
    filhos.push(
      criar('img', {
        src: urlMidia(produto.imagem.url),
        alt: produto.imagem.alt || produto.nome,
        loading: 'lazy',
        decoding: 'async',
      })
    );
  } else {
    filhos.push(
      criar('div', { class: 'produto-card__sem-foto' }, [
        icone(
          iconeDaCategoria(produto.categoria?.slug),
          'produto-card__sem-foto-icone',
          '1em'
        ),
        criar('span', {
          class: 'produto-card__sem-foto-texto',
          texto: 'Foto em breve',
        }),
      ])
    );
  }

  const selos = criarSelos(produto);
  if (selos) filhos.push(selos);

  if (!produto.emEstoque) {
    filhos.push(
      criar('div', { class: 'produto-card__esgotado' }, [
        criar('span', { texto: 'Esgotado' }),
      ])
    );
  }

  return criar('div', { class: 'produto-card__midia' }, filhos);
}

/** Bloco de preço, mostrando o valor cheio riscado quando há desconto. */
function criarPreco(produto) {
  const filhos = [];

  if (produto.precoOriginal && produto.precoOriginal > produto.preco) {
    filhos.push(
      criar('span', { class: 'preco--antigo', texto: moeda(produto.precoOriginal) })
    );
  }

  filhos.push(criar('span', { class: 'preco', texto: moeda(produto.preco) }));

  return criar('div', { class: 'produto-card__preco' }, filhos);
}

/* -----------------------------------------------------------------------------
 * Card completo
 * -------------------------------------------------------------------------- */

/**
 * @param {object} produto - já no formato devolvido pela API
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.mostrarCategoria]
 * @returns {HTMLElement}
 */
export function criarCardProduto(produto, opcoes = {}) {
  const { mostrarCategoria = true } = opcoes;

  const endereco = `${rota(ROTAS.produto)}?p=${encodeURIComponent(produto.slug)}`;

  const corpo = [];

  if (mostrarCategoria && produto.categoria?.nome) {
    corpo.push(
      criar('span', {
        class: 'produto-card__categoria',
        texto: produto.categoria.nome,
      })
    );
  }

  corpo.push(criar('h3', { class: 'produto-card__nome', texto: produto.nome }));

  if (produto.descricaoCurta) {
    corpo.push(
      criar('p', {
        class: 'produto-card__descricao',
        texto: resumir(produto.descricaoCurta, 90),
      })
    );
  }

  const rodape = [criarPreco(produto)];

  // Medida, e não peso: "5x5 cm" deixa a pessoa imaginar o doce na mão.
  // "90g" não diz nada a quem não tem balança na cabeça.
  if (produto.medida) {
    rodape.push(criar('span', { class: 'produto-card__medida', texto: produto.medida }));
  }

  corpo.push(criar('div', { class: 'produto-card__rodape' }, rodape));

  // O card inteiro é um link: área de clique generosa, especialmente no
  // celular, e navegação por teclado funciona sem JavaScript extra.
  const card = criar(
    'a',
    {
      class: `produto-card${produto.emEstoque ? '' : ' produto-card--esgotado'}`,
      href: endereco,
      dataset: { slug: produto.slug },
      'aria-label': `${produto.nome} — ${moeda(produto.preco)}`,
    },
    [criarMidia(produto), criar('div', { class: 'produto-card__corpo' }, corpo)]
  );

  return card;
}

/**
 * Renderiza uma lista de produtos dentro de um contêiner.
 * @param {HTMLElement} container
 * @param {Array} produtos
 * @param {object} [opcoes]
 */
export function renderizarProdutos(container, produtos, opcoes = {}) {
  if (!container) return;

  const fragmento = document.createDocumentFragment();
  produtos.forEach((p) => fragmento.append(criarCardProduto(p, opcoes)));

  container.replaceChildren(fragmento);
  container.removeAttribute('aria-busy');
}

export default criarCardProduto;
