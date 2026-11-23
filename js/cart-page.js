/**
 * cart-page.js
 * -----------------------------------------------------------------------------
 * Tela do carrinho (carrinho.html).
 *
 * Responsabilidades:
 *   1. Desenhar os itens imediatamente, com os dados guardados no navegador.
 *   2. Validar no servidor e REDESENHAR com os valores autoritativos.
 *   3. Alterar quantidades e remover itens.
 *
 * A ordem acima é deliberada: mostrar primeiro e corrigir depois faz a página
 * abrir instantaneamente, em vez de deixar o cliente olhando para um vazio
 * enquanto a rede responde.
 */

import {
  obterItens,
  alterarQuantidade,
  remover,
  esvaziar,
  validarNoServidor,
  atualizarContador,
  subtotalEstimado,
} from './cart.js';
import { ErroApi } from './lib/api.js';
import {
  $,
  criar,
  toastSucesso,
  toastErro,
  toastAviso,
  botaoCarregando,
  confirmar,
  renderizarEstadoVazio,
  debounce,
} from './lib/ui.js';
import { moeda, peso, plural } from './lib/format.js';
import { montarLinkWhatsApp } from './whatsapp.js';
import { ROTAS, rota, REGRAS, urlMidia } from './config.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

/** Último carrinho validado pelo servidor. É dele que saem os totais. */
let carrinhoValidado = null;
let validando = false;

/* =============================================================================
 * LINHA DE ITEM
 * ========================================================================== */

function criarImagem(item) {
  if (item.imagem?.url) {
    return criar('img', {
      src: urlMidia(item.imagem.url),
      alt: item.imagem.alt || item.nome,
      loading: 'lazy',
    });
  }

  return criar('div', { class: 'carrinho-item__sem-foto' }, [
    criar('span', { texto: '🍫', 'aria-hidden': 'true' }),
  ]);
}

function criarSeletorQuantidade(item) {
  // Sob encomenda a loja produz conforme o pedido; senão, o teto é o estoque.
  const maximo = item.sobEncomenda
    ? REGRAS.quantidadeMaximaItem
    : Math.min(item.disponivel ?? REGRAS.quantidadeMaximaItem, REGRAS.quantidadeMaximaItem);

  const campo = criar('input', {
    class: 'seletor-quantidade__valor',
    type: 'number',
    value: String(item.quantidade),
    min: '1',
    max: String(maximo),
    inputmode: 'numeric',
    'aria-label': `Quantidade de ${item.nome}`,
  });

  // `debounce` evita uma validação por tecla digitada.
  const aplicarDigitado = debounce((valor) => {
    alterarQuantidade(item.slug, valor);
    revalidar();
  }, 500);

  const mudar = (novo) => {
    const valor = Math.min(Math.max(1, novo), maximo);
    campo.value = String(valor);
    alterarQuantidade(item.slug, valor);
    revalidar();
  };

  campo.addEventListener('change', () => mudar(Number.parseInt(campo.value, 10) || 1));
  campo.addEventListener('input', () => aplicarDigitado(campo.value));

  return criar('div', { class: 'seletor-quantidade' }, [
    criar('button', {
      class: 'seletor-quantidade__botao',
      type: 'button',
      texto: '−',
      'aria-label': `Diminuir quantidade de ${item.nome}`,
      disabled: item.quantidade <= 1,
      on: { click: () => mudar(item.quantidade - 1) },
    }),
    campo,
    criar('button', {
      class: 'seletor-quantidade__botao',
      type: 'button',
      texto: '+',
      'aria-label': `Aumentar quantidade de ${item.nome}`,
      disabled: item.quantidade >= maximo,
      on: { click: () => mudar(item.quantidade + 1) },
    }),
  ]);
}

function criarLinhaItem(item) {
  const detalhes = [];

  if (item.categoria) {
    detalhes.push(
      criar('span', { class: 'carrinho-item__categoria', texto: item.categoria })
    );
  }

  const info = [
    criar('a', {
      class: 'carrinho-item__nome',
      href: `${rota(ROTAS.produto)}?p=${encodeURIComponent(item.slug)}`,
      texto: item.nome,
    }),
  ];

  const meta = [];
  if (item.pesoGramas) {
    meta.push(criar('span', { texto: peso(item.pesoGramas) }));
  }
  if (item.tipoPreco === 'atacado') {
    meta.push(criar('span', { class: 'selo selo--sucesso', texto: 'Atacado' }));
  } else if (item.tipoPreco === 'promocional') {
    meta.push(criar('span', { class: 'selo selo--destaque', texto: 'Promoção' }));
  }
  if (item.sobEncomenda && (item.disponivel ?? 0) <= 0) {
    meta.push(criar('span', { class: 'selo selo--novo', texto: 'Sob encomenda' }));
  }

  if (meta.length > 0) {
    info.push(criar('div', { class: 'carrinho-item__meta' }, meta));
  }

  // Preço unitário
  const precoUnitario = [];
  if (item.precoOriginal && item.precoOriginal > item.precoUnitario) {
    precoUnitario.push(
      criar('span', { class: 'preco--antigo', texto: moeda(item.precoOriginal) })
    );
  }
  precoUnitario.push(
    criar('span', {
      class: 'carrinho-item__unitario',
      texto: `${moeda(item.precoUnitario)} cada`,
    })
  );
  info.push(criar('div', { class: 'carrinho-item__precos' }, precoUnitario));

  return criar('article', { class: 'carrinho-item', dataset: { slug: item.slug } }, [
    criar(
      'a',
      {
        class: 'carrinho-item__midia',
        href: `${rota(ROTAS.produto)}?p=${encodeURIComponent(item.slug)}`,
        tabindex: '-1',
        'aria-hidden': 'true',
      },
      [criarImagem(item)]
    ),

    criar('div', { class: 'carrinho-item__info' }, [...detalhes, ...info]),

    criar('div', { class: 'carrinho-item__acoes' }, [
      criarSeletorQuantidade(item),
      criar('strong', {
        class: 'carrinho-item__subtotal preco',
        texto: moeda(item.subtotal ?? item.precoUnitario * item.quantidade),
      }),
      criar('button', {
        class: 'carrinho-item__remover',
        type: 'button',
        texto: 'Remover',
        'aria-label': `Remover ${item.nome} do carrinho`,
        on: {
          click: async () => {
            const confirmado = await confirmar(
              `Remover "${item.nome}" do carrinho?`
            );
            if (!confirmado) return;

            remover(item.slug);
            toastSucesso('Item removido.');
            revalidar();
          },
        },
      }),
    ]),
  ]);
}

/* =============================================================================
 * RESUMO
 * ========================================================================== */

function renderizarResumo(carrinho) {
  const container = $('[data-resumo]');
  if (!container) return;

  const linhas = [
    criar('div', { class: 'resumo__linha' }, [
      criar('span', {
        texto: plural(carrinho.quantidadeItens, 'item', 'itens'),
      }),
      criar('span', { texto: moeda(carrinho.subtotal) }),
    ]),
  ];

  if (carrinho.desconto > 0) {
    linhas.push(
      criar('div', { class: 'resumo__linha resumo__linha--desconto' }, [
        criar('span', { texto: 'Desconto' }),
        criar('span', { texto: `− ${moeda(carrinho.desconto)}` }),
      ])
    );
  }

  // O frete entra na Fase 7, quando o cliente escolher entrega ou retirada.
  linhas.push(
    criar('div', { class: 'resumo__linha resumo__linha--info' }, [
      criar('span', { texto: 'Entrega' }),
      criar('span', { texto: 'Calculada no checkout' }),
    ])
  );

  linhas.push(
    criar('div', { class: 'resumo__total' }, [
      criar('span', { texto: 'Total' }),
      criar('strong', { class: 'preco preco--grande', texto: moeda(carrinho.total) }),
    ])
  );

  container.replaceChildren(
    criar('h2', { class: 'resumo__titulo', texto: 'Resumo do pedido' }),
    ...linhas
  );
}

/* =============================================================================
 * AVISOS DO SERVIDOR
 * ========================================================================== */

function renderizarAvisos(avisos) {
  const container = $('[data-avisos]');
  if (!container) return;

  if (!avisos || avisos.length === 0) {
    container.replaceChildren();
    return;
  }

  const classePorTipo = {
    removido: 'alerta--aviso',
    esgotado: 'alerta--aviso',
    quantidade_ajustada: 'alerta--aviso',
    preco_alterado: 'alerta--info',
    minimo_atacado: 'alerta--info',
  };

  container.replaceChildren(
    ...avisos.map((aviso) =>
      criar(
        'div',
        {
          class: `alerta ${classePorTipo[aviso.tipo] || 'alerta--info'}`,
          role: 'status',
        },
        [
          criar('span', { texto: '•', 'aria-hidden': 'true' }),
          criar('p', { class: 'sem-margem', texto: aviso.mensagem }),
        ]
      )
    )
  );
}

/* =============================================================================
 * RENDERIZAÇÃO PRINCIPAL
 * ========================================================================== */

function renderizar(carrinho) {
  const lista = $('[data-lista-itens]');
  const painel = $('[data-painel-carrinho]');
  const vazio = $('[data-carrinho-vazio]');

  if (!lista) return;

  // --- Carrinho vazio ---
  if (!carrinho.itens || carrinho.itens.length === 0) {
    painel?.setAttribute('hidden', '');
    vazio?.removeAttribute('hidden');

    if (vazio) {
      renderizarEstadoVazio(vazio, {
        icone: '🛒',
        titulo: 'Seu carrinho está vazio',
        texto: 'Que tal dar uma olhada nos nossos doces artesanais?',
        acao: { texto: 'Ver nossos doces', href: rota(ROTAS.produtos) },
      });
    }

    renderizarAvisos(carrinho.avisos);
    return;
  }

  vazio?.setAttribute('hidden', '');
  painel?.removeAttribute('hidden');

  lista.replaceChildren(...carrinho.itens.map(criarLinhaItem));

  renderizarResumo(carrinho);
  renderizarAvisos(carrinho.avisos);

  // --- Aviso de produtos de demonstração ---
  const avisoDemo = $('[data-aviso-demonstracao]');
  if (avisoDemo) {
    avisoDemo.hidden = !carrinho.itens.some((i) => i.demonstracao);
  }

  // --- Aviso de atacado ---
  const avisoAtacado = $('[data-aviso-atacado]');
  if (avisoAtacado) avisoAtacado.hidden = !carrinho.atacado;

  // --- Botão de finalizar ---
  const finalizar = $('[data-finalizar]');
  if (finalizar) {
    const abaixoDoMinimo =
      carrinho.pedidoMinimo > 0 && carrinho.total < carrinho.pedidoMinimo;

    if (abaixoDoMinimo) {
      finalizar.setAttribute('aria-disabled', 'true');
      finalizar.classList.add('btn--desabilitado');
      finalizar.title = `Pedido mínimo de ${moeda(carrinho.pedidoMinimo)} para revendedores.`;
    } else {
      finalizar.removeAttribute('aria-disabled');
      finalizar.classList.remove('btn--desabilitado');
      finalizar.removeAttribute('title');
    }
  }

  // --- Pedido pelo WhatsApp (alternativa ao checkout) ---
  const whatsapp = $('[data-pedido-whatsapp]');
  if (whatsapp) {
    whatsapp.href = montarLinkWhatsApp(montarMensagemPedido(carrinho));
  }
}

/** Monta a mensagem do pedido para o WhatsApp. */
function montarMensagemPedido(carrinho) {
  const linhas = ['Olá! Gostaria de fazer este pedido pelo site da Doce Fefê.21:', ''];

  for (const item of carrinho.itens) {
    linhas.push(
      `• ${item.quantidade}× ${item.nome} — ${moeda(item.subtotal)}`
    );
  }

  linhas.push('', `*Subtotal:* ${moeda(carrinho.subtotal)}`);

  if (carrinho.desconto > 0) {
    linhas.push(`*Desconto:* − ${moeda(carrinho.desconto)}`);
  }

  linhas.push(`*Total:* ${moeda(carrinho.total)}`);

  return linhas.join('\n');
}

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

/** Revalida no servidor e redesenha. */
async function revalidar() {
  // Evita chamadas em paralelo quando o usuário clica rápido no "+".
  if (validando) return;
  validando = true;

  const painel = $('[data-painel-carrinho]');
  painel?.setAttribute('aria-busy', 'true');

  try {
    carrinhoValidado = await validarNoServidor();
    renderizar(carrinhoValidado);
    atualizarContador();

    // Avisos importantes também viram toast, para quem já rolou a página.
    const criticos = (carrinhoValidado.avisos || []).filter((a) =>
      ['removido', 'esgotado', 'quantidade_ajustada'].includes(a.tipo)
    );
    if (criticos.length > 0) {
      toastAviso(criticos[0].mensagem);
    }
  } catch (erro) {
    console.error('[carrinho] Falha ao validar:', erro);

    toastErro(
      erro instanceof ErroApi && erro.status === 0
        ? 'Sem conexão com o servidor. Os valores podem estar desatualizados.'
        : erro.message || 'Não conseguimos validar seu carrinho.'
    );
  } finally {
    validando = false;
    painel?.removeAttribute('aria-busy');
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  const lista = $('[data-lista-itens]');
  if (!lista) return;

  // 1. Desenha já, com o que está guardado no navegador.
  const locais = obterItens();

  if (locais.length > 0) {
    renderizar({
      itens: locais.map((i) => ({
        ...i,
        subtotal: (i.precoUnitario || 0) * i.quantidade,
      })),
      avisos: [],
      subtotal: subtotalEstimado(),
      desconto: 0,
      total: subtotalEstimado(),
      quantidadeItens: locais.reduce((s, i) => s + i.quantidade, 0),
      atacado: false,
      pedidoMinimo: 0,
    });
  } else {
    renderizar({ itens: [], avisos: [] });
  }

  // 2. Corrige com os dados do servidor.
  revalidar();

  // 3. Botão de esvaziar.
  $('[data-esvaziar]')?.addEventListener('click', async () => {
    const confirmado = await confirmar('Remover todos os itens do carrinho?');
    if (!confirmado) return;

    esvaziar();
    atualizarContador();
    renderizar({ itens: [], avisos: [] });
    toastSucesso('Carrinho esvaziado.');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
