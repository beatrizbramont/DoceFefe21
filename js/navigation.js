/**
 * navigation.js
 * -----------------------------------------------------------------------------
 * Comportamento do cabeçalho: menu lateral do celular, marcação da página
 * atual e sombra ao rolar.
 *
 * ACESSIBILIDADE
 * O menu lateral é um diálogo modal. Isso significa três obrigações:
 *   1. Fechar com a tecla Esc.
 *   2. Prender o foco do teclado dentro dele enquanto estiver aberto.
 *   3. Devolver o foco ao botão que o abriu ao fechar.
 * Sem isso, quem usa teclado ou leitor de tela fica "perdido" atrás do menu.
 */

import { $, $$, throttle } from './lib/ui.js';

/* =============================================================================
 * 1. MENU LATERAL (DRAWER)
 * ========================================================================== */

/** Elementos que podem receber foco pelo teclado. */
const SELETOR_FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let menuAberto = false;
let elementoQueAbriu = null;

function obterElementosMenu() {
  return {
    menu: $('.menu-mobile'),
    overlay: $('[data-overlay-menu]'),
    botaoAbrir: $('[data-abrir-menu]'),
  };
}

export function abrirMenu() {
  const { menu, overlay, botaoAbrir } = obterElementosMenu();
  if (!menu || menuAberto) return;

  elementoQueAbriu = document.activeElement;
  menuAberto = true;

  menu.classList.add('menu-mobile--aberto');
  menu.removeAttribute('inert');
  overlay?.classList.add('menu-overlay--aberto');
  botaoAbrir?.setAttribute('aria-expanded', 'true');

  // Impede a rolagem da página atrás do menu.
  document.body.style.overflow = 'hidden';

  // Move o foco para o primeiro item do menu.
  const primeiroFocavel = menu.querySelector(SELETOR_FOCAVEIS);
  primeiroFocavel?.focus();
}

export function fecharMenu() {
  const { menu, overlay, botaoAbrir } = obterElementosMenu();
  if (!menu || !menuAberto) return;

  menuAberto = false;

  menu.classList.remove('menu-mobile--aberto');
  overlay?.classList.remove('menu-overlay--aberto');
  botaoAbrir?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';

  // `inert` só volta depois da animação, senão o foco salta antes da hora.
  setTimeout(() => {
    if (!menuAberto) menu.setAttribute('inert', '');
  }, 250);

  // Devolve o foco a quem abriu o menu.
  elementoQueAbriu?.focus?.();
  elementoQueAbriu = null;
}

/** Mantém o foco circulando dentro do menu aberto (foco preso). */
function prenderFoco(evento) {
  if (!menuAberto || evento.key !== 'Tab') return;

  const { menu } = obterElementosMenu();
  if (!menu) return;

  const focaveis = $$(SELETOR_FOCAVEIS, menu).filter(
    (el) => el.offsetParent !== null
  );
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];

  if (evento.shiftKey && document.activeElement === primeiro) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primeiro.focus();
  }
}

/* =============================================================================
 * 2. PÁGINA ATUAL
 * ========================================================================== */

/**
 * Marca no menu o link correspondente à página aberta.
 * `aria-current="page"` é o padrão de acessibilidade e também o gancho do CSS.
 */
export function marcarPaginaAtual() {
  // Ex.: "/produtos.html" -> "produtos.html"; "/" -> "index.html"
  const arquivo =
    window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';

  $$('[data-rota]').forEach((link) => {
    const destino = link.dataset.rota;
    const ehAtual =
      destino === arquivo ||
      // A raiz do site ("/") corresponde ao index.html.
      (destino === 'index.html' && (arquivo === '' || arquivo === 'index.html'));

    if (ehAtual) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/* =============================================================================
 * 3. SOMBRA DO CABEÇALHO AO ROLAR
 * ========================================================================== */

function observarRolagem() {
  const cabecalho = $('[data-cabecalho]');
  if (!cabecalho) return;

  // `throttle` limita o cálculo a ~10x por segundo em vez de centenas.
  const aoRolar = throttle(() => {
    cabecalho.classList.toggle('cabecalho--rolado', window.scrollY > 8);
  }, 100);

  window.addEventListener('scroll', aoRolar, { passive: true });
  aoRolar(); // aplica já no carregamento (ex.: página recarregada no meio)
}

/* =============================================================================
 * 4. INICIALIZAÇÃO
 * ========================================================================== */

/**
 * Liga todos os comportamentos do cabeçalho.
 * Deve ser chamada DEPOIS de montarCabecalho().
 */
export function iniciarNavegacao() {
  marcarPaginaAtual();
  observarRolagem();

  // Delegação de eventos: um único ouvinte no documento cobre os botões
  // de abrir/fechar, mesmo que o cabeçalho seja remontado.
  document.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-abrir-menu]')) {
      abrirMenu();
      return;
    }
    if (
      evento.target.closest('[data-fechar-menu]') ||
      evento.target.closest('[data-overlay-menu]')
    ) {
      fecharMenu();
      return;
    }
    // Clicar em um link do menu navega — fechamos para não "piscar" aberto.
    if (menuAberto && evento.target.closest('.menu-mobile a')) {
      fecharMenu();
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && menuAberto) {
      fecharMenu();
      return;
    }
    prenderFoco(evento);
  });

  // Ao passar para a largura de desktop, o menu lateral não deve ficar aberto.
  const consultaDesktop = window.matchMedia('(min-width: 1024px)');
  consultaDesktop.addEventListener('change', (e) => {
    if (e.matches && menuAberto) fecharMenu();
  });
}

export default iniciarNavegacao;
