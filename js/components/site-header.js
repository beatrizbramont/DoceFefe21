/**
 * components/site-header.js
 * -----------------------------------------------------------------------------
 * Cabeçalho compartilhado por todas as páginas públicas.
 *
 * Por que gerar o cabeçalho por JavaScript em vez de copiar o HTML em cada
 * página? Porque com 11 páginas, qualquer mudança no menu exigiria 11 edições
 * — e uma delas sempre ficaria para trás. Aqui existe uma fonte única.
 *
 * Como usar: coloque `<div id="cabecalho"></div>` na página e chame
 * `montarCabecalho()` (já feito por js/main.js).
 *
 * A LOGOMARCA é carregada do arquivo original da marca, sem qualquer
 * alteração — apenas redimensionada proporcionalmente pelo CSS.
 */

import { MARCA, ROTAS, ATIVOS, rota } from '../config.js';
import { criar, $ } from '../lib/ui.js';
import { icone } from './icons.js';

/** Itens do menu principal, na ordem de exibição. */
const ITENS_MENU = [
  { rotulo: 'Início', rota: ROTAS.inicio },
  { rotulo: 'Produtos', rota: ROTAS.produtos },
  { rotulo: 'Nossa História', rota: ROTAS.nossaHistoria },
  { rotulo: 'Seja Revendedor', rota: ROTAS.sejaRevendedor },
  { rotulo: 'Contato', rota: ROTAS.contato },
];

/* -----------------------------------------------------------------------------
 * Blocos de construção
 * -------------------------------------------------------------------------- */

function criarLogo() {
  return criar(
    'a',
    {
      class: 'cabecalho__logo',
      href: rota(ROTAS.inicio),
      'aria-label': `${MARCA.nome} — página inicial`,
    },
    [
      criar('img', {
        src: ATIVOS.logo(),
        alt: `Logomarca da ${MARCA.nome}`,
        width: 56,
        height: 56,
        // O logo aparece imediatamente: carregá-lo com atraso causaria um
        // "pulo" visual no topo da página.
        loading: 'eager',
        decoding: 'async',
      }),
      criar('span', { class: 'cabecalho__logo-texto' }, [
        criar('span', { class: 'cabecalho__logo-nome', texto: MARCA.nome }),
        criar('span', { class: 'cabecalho__logo-slogan', texto: MARCA.slogan }),
      ]),
    ]
  );
}

function criarNavPrincipal() {
  return criar('nav', { class: 'nav-principal', 'aria-label': 'Navegação principal' }, [
    criar(
      'ul',
      { class: 'nav-principal__lista' },
      ITENS_MENU.map((item) =>
        criar('li', {}, [
          criar('a', {
            class: 'nav-principal__link',
            href: rota(item.rota),
            texto: item.rotulo,
            dataset: { rota: item.rota },
          }),
        ])
      )
    ),
  ]);
}

function criarAcoes() {
  const linkBusca = criar(
    'a',
    {
      class: 'botao-icone',
      href: `${rota(ROTAS.produtos)}#busca`,
      'aria-label': 'Buscar produtos',
      title: 'Buscar produtos',
    },
    [icone('busca')]
  );

  const linkConta = criar(
    'a',
    {
      class: 'botao-icone',
      href: rota(ROTAS.minhaConta),
      'aria-label': 'Minha conta',
      title: 'Minha conta',
    },
    [icone('usuario')]
  );

  // O contador começa oculto; js/cart.js o atualiza quando houver itens.
  const contador = criar('span', {
    class: 'botao-icone__contador',
    'data-contador-carrinho': '',
    hidden: true,
    texto: '0',
  });

  const linkCarrinho = criar(
    'a',
    {
      class: 'botao-icone',
      href: rota(ROTAS.carrinho),
      'aria-label': 'Carrinho de compras',
      title: 'Carrinho de compras',
    },
    [icone('carrinho'), contador]
  );

  const botaoMenu = criar(
    'button',
    {
      class: 'botao-icone botao-menu',
      type: 'button',
      'data-abrir-menu': '',
      'aria-label': 'Abrir menu de navegação',
      'aria-expanded': 'false',
      'aria-controls': 'menu-mobile',
    },
    [icone('menu')]
  );

  return criar('div', { class: 'cabecalho__acoes' }, [
    linkBusca,
    linkConta,
    linkCarrinho,
    botaoMenu,
  ]);
}

function criarMenuMobile() {
  const itens = ITENS_MENU.map((item) =>
    criar('li', {}, [
      criar('a', {
        class: 'menu-mobile__link',
        href: rota(item.rota),
        texto: item.rotulo,
        dataset: { rota: item.rota },
      }),
    ])
  );

  // Atalhos que no desktop ficam nos ícones do topo.
  const extras = [
    { rotulo: 'Minha Conta', rota: ROTAS.minhaConta },
    { rotulo: 'Carrinho', rota: ROTAS.carrinho },
  ].map((item) =>
    criar('li', {}, [
      criar('a', {
        class: 'menu-mobile__link',
        href: rota(item.rota),
        texto: item.rotulo,
        dataset: { rota: item.rota },
      }),
    ])
  );

  return criar(
    'div',
    {
      class: 'menu-mobile',
      id: 'menu-mobile',
      // `inert` impede que o menu fechado receba foco pelo teclado.
      inert: true,
    },
    [
      criar('div', { class: 'menu-mobile__topo' }, [
        criar('span', { class: 'menu-mobile__titulo', texto: 'Menu' }),
        criar(
          'button',
          {
            class: 'botao-icone',
            type: 'button',
            'data-fechar-menu': '',
            'aria-label': 'Fechar menu',
          },
          [icone('fechar')]
        ),
      ]),
      criar('nav', { 'aria-label': 'Navegação do menu lateral' }, [
        criar('ul', { class: 'menu-mobile__lista' }, [
          ...itens,
          criar('li', { class: 'menu-mobile__separador', 'aria-hidden': 'true' }),
          ...extras,
        ]),
      ]),
      criar('div', { class: 'menu-mobile__rodape' }, [
        criar('a', {
          class: 'btn btn--primario btn--bloco',
          href: rota(ROTAS.produtos),
          texto: 'Ver todos os doces',
        }),
      ]),
    ]
  );
}

/* -----------------------------------------------------------------------------
 * Montagem
 * -------------------------------------------------------------------------- */

/**
 * Renderiza o cabeçalho completo dentro de #cabecalho.
 */
export function montarCabecalho() {
  const alvo = $('#cabecalho');
  if (!alvo) return;

  const fragmento = document.createDocumentFragment();

  // Link de acessibilidade: primeiro item alcançado pelo Tab.
  fragmento.append(
    criar('a', {
      class: 'pular-conteudo',
      href: '#conteudo',
      texto: 'Pular para o conteúdo',
    })
  );

  fragmento.append(
    criar('header', { class: 'cabecalho', 'data-cabecalho': '' }, [
      criar('div', { class: 'container cabecalho__interno' }, [
        criarLogo(),
        criarNavPrincipal(),
        criarAcoes(),
      ]),
    ])
  );

  fragmento.append(
    criar('div', { class: 'menu-overlay', 'data-overlay-menu': '', hidden: false })
  );
  fragmento.append(criarMenuMobile());

  alvo.replaceChildren(fragmento);
}

export default montarCabecalho;
