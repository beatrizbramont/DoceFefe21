/**
 * produto.js
 * -----------------------------------------------------------------------------
 * Página de detalhes de um produto (produto.html).
 *
 * O produto é identificado pelo parâmetro `p` na URL:
 *     produto.html?p=brownie-tradicional
 *
 * Usamos o slug, e não o UUID, por três motivos:
 *   1. O endereço fica legível e compartilhável.
 *   2. É melhor para busca no Google.
 *   3. Não expõe identificadores internos do banco.
 */

import { api, ErroApi } from './lib/api.js';
import { $, criar, toastErro, toastSucesso, renderizarEstadoVazio } from './lib/ui.js';
import { adicionar, atualizarContador } from './cart.js';
import { moeda, peso } from './lib/format.js';
import { icone, iconeDaCategoria } from './components/icons.js';
import { renderizarProdutos } from './components/product-card.js';
import { montarLinkWhatsApp } from './whatsapp.js';
import { ROTAS, rota, urlMidia } from './config.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

let produtoAtual = null;
let quantidade = 1;

const QUANTIDADE_MAXIMA = 99;

/* =============================================================================
 * GALERIA
 * ========================================================================== */

function renderizarGaleria(produto) {
  const container = $('[data-galeria]');
  if (!container) return;

  // Sem fotos cadastradas: marcador com a identidade da marca.
  if (!produto.imagens || produto.imagens.length === 0) {
    container.replaceChildren(
      criar('div', { class: 'produto-galeria__principal' }, [
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
        ]),
      ])
    );
    return;
  }

  const principal = criar('div', { class: 'produto-galeria__principal' }, [
    criar('img', {
      src: urlMidia(produto.imagens[0].url),
      alt: produto.imagens[0].alt || produto.nome,
      id: 'imagem-principal',
    }),
  ]);

  const filhos = [principal];

  // Miniaturas só fazem sentido com mais de uma foto.
  if (produto.imagens.length > 1) {
    const miniaturas = produto.imagens.map((img, indice) =>
      criar(
        'button',
        {
          class: `produto-galeria__miniatura${indice === 0 ? ' produto-galeria__miniatura--ativa' : ''}`,
          type: 'button',
          'aria-label': `Ver foto ${indice + 1} de ${produto.imagens.length}`,
          on: {
            click: (evento) => {
              const alvo = $('#imagem-principal');
              if (alvo) {
                alvo.src = img.url;
                alvo.alt = img.alt || produto.nome;
              }

              container
                .querySelectorAll('.produto-galeria__miniatura')
                .forEach((m) => m.classList.remove('produto-galeria__miniatura--ativa'));
              evento.currentTarget.classList.add('produto-galeria__miniatura--ativa');
            },
          },
        },
        [criar('img', { src: urlMidia(img.url), alt: '', loading: 'lazy' })]
      )
    );

    filhos.push(criar('div', { class: 'produto-galeria__miniaturas' }, miniaturas));
  }

  container.replaceChildren(...filhos);
}

/* =============================================================================
 * SELETOR DE QUANTIDADE
 * ========================================================================== */

function renderizarSeletorQuantidade(produto) {
  const container = $('[data-seletor-quantidade]');
  if (!container) return;

  // Não dá para pedir mais do que existe — a menos que seja sob encomenda,
  // caso em que a loja produz conforme o pedido.
  const maximo = produto.sobEncomenda
    ? QUANTIDADE_MAXIMA
    : Math.min(produto.disponivel || 1, QUANTIDADE_MAXIMA);

  const campo = criar('input', {
    class: 'seletor-quantidade__valor',
    type: 'number',
    value: '1',
    min: '1',
    max: String(maximo),
    'aria-label': 'Quantidade',
    inputmode: 'numeric',
  });

  const botaoMenos = criar('button', {
    class: 'seletor-quantidade__botao',
    type: 'button',
    texto: '−',
    'aria-label': 'Diminuir quantidade',
  });

  const botaoMais = criar('button', {
    class: 'seletor-quantidade__botao',
    type: 'button',
    texto: '+',
    'aria-label': 'Aumentar quantidade',
  });

  function aplicar(novoValor) {
    // Garante um inteiro dentro dos limites, mesmo que a pessoa digite
    // letras ou cole um valor absurdo.
    quantidade = Math.min(Math.max(1, Number.parseInt(novoValor, 10) || 1), maximo);
    campo.value = String(quantidade);

    botaoMenos.disabled = quantidade <= 1;
    botaoMais.disabled = quantidade >= maximo;

    atualizarBotaoPedido();
  }

  botaoMenos.addEventListener('click', () => aplicar(quantidade - 1));
  botaoMais.addEventListener('click', () => aplicar(quantidade + 1));
  campo.addEventListener('change', () => aplicar(campo.value));
  campo.addEventListener('blur', () => aplicar(campo.value));

  container.replaceChildren(
    criar('div', { class: 'seletor-quantidade' }, [botaoMenos, campo, botaoMais])
  );

  aplicar(1);
}

/**
 * Mantém o link do WhatsApp e o botão do carrinho em sincronia com a
 * quantidade escolhida.
 */
function atualizarBotaoPedido() {
  if (!produtoAtual) return;

  const total = produtoAtual.preco * quantidade;

  const botaoWhats = $('[data-pedir-whatsapp]');
  if (botaoWhats) {
    const mensagem =
      `Olá! Gostaria de pedir pelo site da Doce Fefê.21:\n\n` +
      `*${produtoAtual.nome}*\n` +
      `Quantidade: ${quantidade}\n` +
      `Valor unitário: ${moeda(produtoAtual.preco)}\n` +
      `Total: ${moeda(total)}`;

    botaoWhats.href = montarLinkWhatsApp(mensagem);
  }

  // O botão do carrinho guarda a quantidade atual no próprio elemento.
  const botaoCarrinho = $('[data-adicionar-carrinho]');
  if (botaoCarrinho) botaoCarrinho.dataset.quantidade = String(quantidade);

  const rotulo = $('[data-total-pedido]');
  if (rotulo) rotulo.textContent = moeda(total);
}

/* =============================================================================
 * CARRINHO
 * ========================================================================== */

/** Liga o botão "Adicionar ao carrinho" ao produto carregado. */
function ativarBotaoCarrinho(produto) {
  const botao = $('[data-adicionar-carrinho]');
  if (!botao) return;

  botao.hidden = false;

  botao.addEventListener('click', (evento) => {
    evento.preventDefault();

    if (adicionar(produto, quantidade)) {
      atualizarContador();
      toastSucesso(
        quantidade > 1
          ? `${quantidade}× ${produto.nome} no carrinho!`
          : `${produto.nome} no carrinho!`
      );
    }
  });
}

/* =============================================================================
 * DISPONIBILIDADE
 * ========================================================================== */

function descreverDisponibilidade(produto) {
  if (produto.disponivel > 0) {
    return { classe: 'disponivel', texto: 'Disponível para entrega imediata' };
  }
  if (produto.sobEncomenda) {
    return { classe: 'encomenda', texto: 'Feito sob encomenda' };
  }
  return { classe: 'esgotado', texto: 'Temporariamente esgotado' };
}

/* =============================================================================
 * FICHA TÉCNICA
 * ========================================================================== */

function renderizarFicha(produto) {
  const container = $('[data-ficha]');
  if (!container) return;

  const linhas = [];

  const adicionar = (rotulo, valor) => {
    if (!valor) return;
    linhas.push(
      criar('div', { class: 'ficha__linha' }, [
        criar('span', { class: 'ficha__rotulo', texto: rotulo }),
        criar('span', { class: 'ficha__valor', texto: valor }),
      ])
    );
  };

  adicionar('Categoria', produto.categoria?.nome);
  if (produto.pesoGramas) adicionar('Peso', peso(produto.pesoGramas));
  adicionar('Ingredientes', produto.ingredientes);
  adicionar('Alérgenos', produto.alergenicos);

  if (linhas.length === 0) {
    container.replaceChildren();
    return;
  }

  container.replaceChildren(
    criar('h2', { class: 'mb-4', texto: 'Ficha técnica' }),
    ...linhas
  );
}

/* =============================================================================
 * RENDERIZAÇÃO PRINCIPAL
 * ========================================================================== */

function renderizarProduto(produto) {
  produtoAtual = produto;

  // --- Metadados da página ---
  document.title = `${produto.nome} | Doce Fefê.21`;

  const descricao = produto.descricaoCurta || produto.descricao || '';
  $('meta[name="description"]')?.setAttribute('content', descricao.slice(0, 160));

  // --- Migalhas ---
  const migalhaCategoria = $('[data-migalha-categoria]');
  if (migalhaCategoria && produto.categoria) {
    migalhaCategoria.textContent = produto.categoria.nome;
    migalhaCategoria.href = `${rota(ROTAS.produtos)}?categoria=${encodeURIComponent(produto.categoria.slug)}`;
  }

  const migalhaProduto = $('[data-migalha-produto]');
  if (migalhaProduto) migalhaProduto.textContent = produto.nome;

  // --- Galeria ---
  renderizarGaleria(produto);

  // --- Cabeçalho ---
  const categoria = $('[data-produto-categoria]');
  if (categoria) categoria.textContent = produto.categoria?.nome || '';

  const nome = $('[data-produto-nome]');
  if (nome) nome.textContent = produto.nome;

  // --- Selos ---
  const selos = $('[data-produto-selos]');
  if (selos) {
    const lista = [];
    if (produto.tipoPreco === 'atacado') {
      lista.push(criar('span', { class: 'selo selo--sucesso', texto: 'Preço de atacado' }));
    }
    if (produto.tipoPreco === 'promocional') {
      lista.push(criar('span', { class: 'selo selo--destaque', texto: 'Promoção' }));
    }
    if (produto.novidade) lista.push(criar('span', { class: 'selo selo--novo', texto: 'Novidade' }));
    if (produto.maisVendido) lista.push(criar('span', { class: 'selo selo--neutro', texto: 'Mais vendido' }));
    if (produto.sazonal) lista.push(criar('span', { class: 'selo selo--aviso', texto: 'Sazonal' }));
    selos.replaceChildren(...lista);
  }

  // --- Preço ---
  const precoContainer = $('[data-produto-preco]');
  if (precoContainer) {
    const partes = [criar('span', { class: 'preco', texto: moeda(produto.preco) })];

    if (produto.precoOriginal && produto.precoOriginal > produto.preco) {
      partes.push(
        criar('span', { class: 'preco--antigo', texto: moeda(produto.precoOriginal) }),
        criar('span', {
          class: 'produto-info__economia',
          texto: `Economize ${moeda(produto.economia)}`,
        })
      );
    }

    precoContainer.replaceChildren(...partes);
  }

  // --- Disponibilidade ---
  const disponibilidade = $('[data-produto-disponibilidade]');
  if (disponibilidade) {
    const info = descreverDisponibilidade(produto);
    disponibilidade.className = `disponibilidade disponibilidade--${info.classe}`;
    disponibilidade.textContent = info.texto;
  }

  // --- Descrição ---
  const descricaoEl = $('[data-produto-descricao]');
  if (descricaoEl) {
    descricaoEl.textContent = produto.descricao || produto.descricaoCurta || '';
  }

  // --- Ficha e quantidade ---
  renderizarFicha(produto);

  if (produto.emEstoque) {
    renderizarSeletorQuantidade(produto);
    ativarBotaoCarrinho(produto);
  } else {
    // Produto esgotado: em vez de um botão morto, oferecemos avisar quando
    // voltar — que também é uma ação real, pelo WhatsApp.
    const compra = $('[data-area-compra]');
    if (compra) {
      compra.replaceChildren(
        criar('p', {
          class: 'sem-margem',
          texto: 'Este doce está temporariamente esgotado.',
        }),
        criar('a', {
          class: 'btn btn--whatsapp',
          href: montarLinkWhatsApp(
            `Olá! Gostaria de saber quando o produto "${produto.nome}" estará disponível novamente.`
          ),
          target: '_blank',
          rel: 'noopener noreferrer',
          texto: 'Avisar quando chegar',
        })
      );
    }
  }

  atualizarBotaoPedido();

  // --- Aviso de demonstração ---
  const avisoDemo = $('[data-aviso-demonstracao]');
  if (avisoDemo) avisoDemo.hidden = !produto.demonstracao;

  // --- Dados estruturados para o Google ---
  injetarDadosEstruturados(produto);

  // Mostra o conteúdo, que ficava oculto durante o carregamento.
  $('[data-conteudo-produto]')?.removeAttribute('hidden');
  $('[data-carregando-produto]')?.setAttribute('hidden', '');
}

/**
 * Publica os dados do produto em JSON-LD.
 * Permite que o Google exiba preço e disponibilidade direto nos resultados.
 */
function injetarDadosEstruturados(produto) {
  const dados = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: produto.nome,
    description: produto.descricaoCurta || produto.descricao || '',
    category: produto.categoria?.nome,
    brand: { '@type': 'Brand', name: 'Doce Fefê.21' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'BRL',
      // O schema.org espera o preço em reais, com ponto decimal.
      price: (produto.preco / 100).toFixed(2),
      availability: produto.emEstoque
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };

  if (produto.pesoGramas) {
    dados.weight = { '@type': 'QuantitativeValue', value: produto.pesoGramas, unitCode: 'GRM' };
  }

  if (produto.imagem?.url) dados.image = produto.imagem.url;

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  // Conteúdo montado por nós a partir de dados já validados; `textContent`
  // garante que nada seja interpretado como marcação.
  script.textContent = JSON.stringify(dados);
  document.head.append(script);
}

/* =============================================================================
 * RELACIONADOS
 * ========================================================================== */

function renderizarRelacionados(relacionados) {
  const secao = $('[data-secao-relacionados]');
  const grade = $('[data-relacionados]');
  if (!grade) return;

  if (!relacionados || relacionados.length === 0) {
    secao?.setAttribute('hidden', '');
    return;
  }

  secao?.removeAttribute('hidden');
  renderizarProdutos(grade, relacionados);
}

/* =============================================================================
 * CARREGAMENTO
 * ========================================================================== */

async function carregarProduto() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('p');

  const carregando = $('[data-carregando-produto]');
  const erroContainer = $('[data-erro-produto]');

  if (!slug) {
    mostrarErro(
      'Produto não informado',
      'O endereço acessado não indica qual doce você quer ver.'
    );
    return;
  }

  try {
    const resposta = await api.get(`/produtos/${encodeURIComponent(slug)}`);
    renderizarProduto(resposta.produto);
    renderizarRelacionados(resposta.relacionados);
  } catch (erro) {
    console.error('[produto] Falha ao carregar:', erro);

    if (erro instanceof ErroApi && erro.status === 404) {
      mostrarErro(
        'Produto não encontrado',
        'Este doce pode ter saído do catálogo. Veja os outros sabores disponíveis.'
      );
      return;
    }

    mostrarErro(
      'Não conseguimos carregar este produto',
      erro instanceof ErroApi && erro.status === 0
        ? 'Parece que a API não está no ar. Se você está desenvolvendo, rode: npm run server'
        : 'Tivemos um problema ao buscar as informações. Tente novamente em instantes.'
    );
    toastErro(erro.message || 'Falha ao carregar o produto.');
  } finally {
    carregando?.setAttribute('hidden', '');
  }
}

function mostrarErro(titulo, texto) {
  const container = $('[data-erro-produto]');
  if (!container) return;

  container.removeAttribute('hidden');
  renderizarEstadoVazio(container, {
    icone: 'doce',
    titulo,
    texto,
    acao: { texto: 'Ver todos os doces', href: rota(ROTAS.produtos) },
  });

  $('[data-carregando-produto]')?.setAttribute('hidden', '');
  $('[data-conteudo-produto]')?.setAttribute('hidden', '');
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  if (!$('[data-conteudo-produto]')) return;
  carregarProduto();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
