/**
 * main.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada de TODAS as páginas públicas.
 *
 * Responsabilidades:
 *   1. Montar o cabeçalho e o rodapé compartilhados.
 *   2. Ligar a navegação (menu do celular, página atual, sombra ao rolar).
 *   3. Criar o botão flutuante do WhatsApp.
 *   4. Pequenos comportamentos globais (máscaras, revelação ao rolar).
 *
 * Cada página carrega este arquivo e, quando necessário, o seu próprio script:
 *   <script type="module" src="./js/main.js"></script>
 *   <script type="module" src="./js/products.js"></script>
 */

import { montarCabecalho } from './components/site-header.js';
import { montarRodape } from './components/site-footer.js';
import { iniciarNavegacao } from './navigation.js';
import { montarBotaoWhatsApp, ativarLinksWhatsApp } from './whatsapp.js';
import { icone } from './components/icons.js';
// Importar o carrinho já liga o contador do cabeçalho em todas as páginas.
import { atualizarContador } from './cart.js';
import {
  iniciarAutenticacao,
  estaLogado,
  usuarioAtual,
  aoMudarAutenticacao,
} from './auth.js';
import { $$, toastErro } from './lib/ui.js';
import { telefone, cep, cnpj, somenteDigitos } from './lib/format.js';

/* =============================================================================
 * MÁSCARAS DE ENTRADA
 * Aplicadas automaticamente a inputs marcados com data-mascara no HTML:
 *   <input data-mascara="telefone">
 * ========================================================================== */

const MASCARAS = {
  telefone,
  cep,
  cnpj,
  numero: (v) => somenteDigitos(v),
};

function ativarMascaras(raiz = document) {
  $$('[data-mascara]', raiz).forEach((input) => {
    const formatador = MASCARAS[input.dataset.mascara];
    if (!formatador) return;

    input.addEventListener('input', () => {
      const posicao = input.selectionStart;
      const tamanhoAntes = input.value.length;

      input.value = formatador(input.value);

      // Reposiciona o cursor considerando os caracteres que a máscara inseriu.
      // Sem isso, o cursor pula para o fim a cada tecla digitada no meio.
      const diferenca = input.value.length - tamanhoAntes;
      const novaPosicao = Math.max(0, posicao + diferenca);
      input.setSelectionRange(novaPosicao, novaPosicao);
    });
  });
}

/* =============================================================================
 * ÍCONES DECLARADOS NO HTML
 *
 * Permite pedir um ícone direto da marcação, sem repetir SVG nas páginas:
 *   <span data-icone="whatsapp" aria-hidden="true"></span>
 * ========================================================================== */

function ativarIcones(raiz = document) {
  $$('[data-icone]', raiz).forEach((el) => {
    // Não duplica se a função rodar mais de uma vez.
    if (el.querySelector('svg')) return;

    const svg = icone(el.dataset.icone);
    if (svg) el.append(svg);
  });
}

/* =============================================================================
 * ESTADO DE LOGIN NO CABEÇALHO
 *
 * Mostra a inicial do nome no lugar do ícone genérico quando há sessão.
 * Fica aqui, e não em conta.js, porque precisa valer em TODAS as páginas —
 * conta.js só é carregado em minha-conta.html.
 * ========================================================================== */

function atualizarIndicadorDeLogin() {
  const link = document.querySelector('.cabecalho__acoes a[href*="minha-conta"]');
  if (!link) return;

  if (!estaLogado()) {
    link.setAttribute('title', 'Entrar na minha conta');
    return;
  }

  const usuario = usuarioAtual();
  const nome = usuario?.metadata?.nome || usuario?.email || '?';

  link.replaceChildren(
    criarInicial(nome.trim().charAt(0).toUpperCase())
  );
  link.setAttribute('title', nome);
  link.setAttribute('aria-label', 'Minha conta');
}

function criarInicial(letra) {
  const span = document.createElement('span');
  span.className = 'cabecalho__inicial';
  span.textContent = letra;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/* =============================================================================
 * REVELAÇÃO AO ROLAR
 * Elementos com data-revelar aparecem suavemente ao entrar na tela.
 * Usa IntersectionObserver (nativo, sem custo de rolagem).
 * ========================================================================== */

function ativarRevelacao() {
  const alvos = $$('[data-revelar]');
  if (alvos.length === 0) return;

  // Quem pediu menos animações recebe o conteúdo já visível.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    alvos.forEach((el) => el.classList.add('revelado'));
    return;
  }

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        entrada.target.classList.add('revelado');
        // Revela uma única vez: não desaparece ao rolar de volta.
        observador.unobserve(entrada.target);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  alvos.forEach((el) => observador.observe(el));
}

/* =============================================================================
 * ANO ATUAL
 * Preenche qualquer <span data-ano></span> presente no HTML.
 * ========================================================================== */

function preencherAno() {
  const ano = String(new Date().getFullYear());
  $$('[data-ano]').forEach((el) => {
    el.textContent = ano;
  });
}

/* =============================================================================
 * TRATAMENTO GLOBAL DE ERROS
 *
 * Em vez de o usuário encarar uma tela congelada quando algo quebra, ele
 * recebe um aviso claro — e o erro técnico vai para o console.
 * ========================================================================== */

function registrarTratamentoDeErros() {
  window.addEventListener('error', (evento) => {
    console.error('[Doce Fefê.21] Erro não tratado:', evento.error || evento.message);
  });

  window.addEventListener('unhandledrejection', (evento) => {
    console.error('[Doce Fefê.21] Promessa rejeitada:', evento.reason);
    // Só incomoda o usuário se for falha de rede — erros internos não ajudam.
    if (evento.reason?.status === 0) {
      toastErro('Sem conexão com o servidor. Verifique sua internet.');
    }
  });
}

/* =============================================================================
 * INICIALIZAÇÃO
 * ========================================================================== */

function iniciar() {
  registrarTratamentoDeErros();

  // Ordem importa: a navegação depende do cabeçalho já existir no DOM.
  montarCabecalho();
  montarRodape();
  iniciarNavegacao();
  montarBotaoWhatsApp();

  // O contador do carrinho só existe depois que o cabeçalho é montado.
  atualizarContador();

  // Restaura a sessão guardada e deixa o token pronto para a API.
  // Não usamos `await`: a página não precisa esperar a renovação do token
  // para aparecer. O indicador é atualizado quando a sessão resolver.
  iniciarAutenticacao().then(atualizarIndicadorDeLogin);
  atualizarIndicadorDeLogin();
  aoMudarAutenticacao(atualizarIndicadorDeLogin);

  ativarLinksWhatsApp();
  ativarIcones();
  ativarMascaras();
  ativarRevelacao();
  preencherAno();
}

// `type="module"` já adia a execução até o HTML estar pronto, mas a checagem
// mantém o arquivo seguro caso alguém o carregue de outra forma.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
