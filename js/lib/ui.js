/**
 * lib/ui.js
 * -----------------------------------------------------------------------------
 * Blocos de interface reutilizáveis: avisos flutuantes (toasts), estados de
 * carregamento, confirmações e criação segura de elementos.
 *
 * SEGURANÇA — PREVENÇÃO DE XSS
 * Nenhuma função aqui usa innerHTML com dados vindos do usuário ou do banco.
 * Texto sempre é inserido via `textContent`, que escapa qualquer HTML
 * automaticamente. Se um produto se chamasse `<img onerror=alert(1)>`, ele
 * apareceria como texto literal na tela, e não seria executado.
 */

/* =============================================================================
 * 1. SELETORES E CRIAÇÃO DE ELEMENTOS
 * ========================================================================== */

/** Atalho para document.querySelector. */
export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

/** Atalho para querySelectorAll, já convertido em array de verdade. */
export const $$ = (seletor, raiz = document) =>
  Array.from(raiz.querySelectorAll(seletor));

/**
 * Cria um elemento de forma declarativa e segura.
 *
 * @param {string} tag
 * @param {object} [props] - atributos. Chaves especiais:
 *    `class`    -> className
 *    `texto`    -> textContent (SEGURO, escapa HTML)
 *    `html`     -> innerHTML (use APENAS com HTML que você mesmo escreveu)
 *    `dataset`  -> objeto com data-attributes
 *    `on`       -> objeto { evento: funcao }
 * @param {Array<Node|string>} [filhos]
 * @returns {HTMLElement}
 *
 * @example
 *   criar('p', { class: 'preco', texto: 'R$ 12,50' })
 */
export function criar(tag, props = {}, filhos = []) {
  const el = document.createElement(tag);

  for (const [chave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;

    if (chave === 'class') {
      el.className = valor;
    } else if (chave === 'texto') {
      el.textContent = valor;
    } else if (chave === 'html') {
      el.innerHTML = valor;
    } else if (chave === 'dataset') {
      Object.assign(el.dataset, valor);
    } else if (chave === 'on') {
      for (const [evento, manipulador] of Object.entries(valor)) {
        el.addEventListener(evento, manipulador);
      }
    } else if (chave === 'estilo') {
      Object.assign(el.style, valor);
    } else if (valor === true) {
      el.setAttribute(chave, '');
    } else {
      el.setAttribute(chave, valor);
    }
  }

  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue;
    el.append(filho instanceof Node ? filho : document.createTextNode(filho));
  }

  return el;
}

/* =============================================================================
 * 2. TOASTS (avisos flutuantes)
 * ========================================================================== */

const ICONES_TOAST = {
  sucesso: '✓',
  erro: '✕',
  aviso: '!',
  info: 'i',
};

/** Cria (uma única vez) o contêiner onde os toasts são empilhados. */
function obterContainerToasts() {
  let container = $('.toasts');
  if (!container) {
    container = criar('div', {
      class: 'toasts',
      // Leitores de tela anunciam o conteúdo que aparece aqui.
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });
    document.body.append(container);
  }
  return container;
}

/**
 * Mostra um aviso flutuante temporário.
 * @param {string} mensagem
 * @param {'sucesso'|'erro'|'aviso'|'info'} [tipo]
 * @param {number} [duracao] - milissegundos. 0 = permanece até clicar em fechar.
 */
export function toast(mensagem, tipo = 'info', duracao = 4000) {
  const container = obterContainerToasts();

  const el = criar('div', { class: `toast toast--${tipo}` }, [
    criar('span', {
      class: 'toast__icone',
      texto: ICONES_TOAST[tipo] || ICONES_TOAST.info,
      'aria-hidden': 'true',
    }),
    criar('p', { class: 'toast__texto', texto: mensagem }),
    criar('button', {
      class: 'toast__fechar',
      type: 'button',
      'aria-label': 'Fechar aviso',
      texto: '×',
      on: { click: () => remover() },
    }),
  ]);

  let temporizador;

  function remover() {
    clearTimeout(temporizador);
    el.classList.add('toast--saindo');
    // Espera a animação de saída terminar antes de tirar do DOM.
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Rede de segurança: se a animação não disparar, remove mesmo assim.
    setTimeout(() => el.remove(), 400);
  }

  container.append(el);
  if (duracao > 0) temporizador = setTimeout(remover, duracao);

  return remover;
}

export const toastSucesso = (m, d) => toast(m, 'sucesso', d);
export const toastErro = (m, d) => toast(m, 'erro', d ?? 6000);
export const toastAviso = (m, d) => toast(m, 'aviso', d);

/* =============================================================================
 * 3. ESTADOS DE CARREGAMENTO
 * ========================================================================== */

/**
 * Coloca ou tira um botão no estado "carregando".
 * Desabilita o botão — evitando cliques duplos que gerariam pedidos repetidos.
 *
 * @param {HTMLButtonElement} botao
 * @param {boolean} carregando
 */
export function botaoCarregando(botao, carregando) {
  if (!botao) return;
  if (carregando) {
    botao.dataset.textoOriginal = botao.textContent;
    botao.classList.add('btn--carregando');
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
  } else {
    botao.classList.remove('btn--carregando');
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
}

/**
 * Preenche um contêiner com cards-esqueleto enquanto os dados carregam.
 * @param {HTMLElement} container
 * @param {number} quantidade
 */
export function mostrarEsqueletos(container, quantidade = 8) {
  if (!container) return;
  container.replaceChildren();

  for (let i = 0; i < quantidade; i += 1) {
    container.append(
      criar('div', { class: 'esqueleto-card', 'aria-hidden': 'true' }, [
        criar('div', { class: 'esqueleto esqueleto-card__midia' }),
        criar('div', { class: 'esqueleto-card__corpo' }, [
          criar('div', { class: 'esqueleto esqueleto-linha esqueleto-linha--titulo' }),
          criar('div', { class: 'esqueleto esqueleto-linha' }),
          criar('div', { class: 'esqueleto esqueleto-linha esqueleto-linha--curta' }),
        ]),
      ])
    );
  }
}

/** Barra fina de progresso no topo da página. */
export const barraProgresso = {
  _el: null,
  _obter() {
    if (!this._el) {
      this._el = criar('div', { class: 'barra-carregamento', 'aria-hidden': 'true' });
      document.body.append(this._el);
    }
    return this._el;
  },
  iniciar() {
    const el = this._obter();
    el.classList.add('barra-carregamento--ativa');
    el.style.width = '35%';
    // Avança até 80% e para: o salto para 100% acontece no concluir().
    setTimeout(() => {
      el.style.width = '80%';
    }, 220);
  },
  concluir() {
    const el = this._obter();
    el.style.width = '100%';
    setTimeout(() => {
      el.classList.remove('barra-carregamento--ativa');
      el.style.width = '0';
    }, 280);
  },
};

/* =============================================================================
 * 4. ESTADOS VAZIOS
 * ========================================================================== */

/**
 * Renderiza a mensagem de "nada aqui" dentro de um contêiner.
 * @param {HTMLElement} container
 * @param {{icone?:string, titulo:string, texto?:string, acao?:{texto:string, href?:string, onClick?:Function}}} opcoes
 */
export function renderizarEstadoVazio(container, opcoes) {
  if (!container) return;
  const { icone = '🍫', titulo, texto, acao } = opcoes;

  const filhos = [
    criar('div', { class: 'estado-vazio__icone', texto: icone, 'aria-hidden': 'true' }),
    criar('h3', { class: 'estado-vazio__titulo', texto: titulo }),
  ];

  if (texto) {
    filhos.push(criar('p', { class: 'estado-vazio__texto', texto }));
  }

  if (acao) {
    filhos.push(
      acao.href
        ? criar('a', { class: 'btn btn--primario', href: acao.href, texto: acao.texto })
        : criar('button', {
            class: 'btn btn--primario',
            type: 'button',
            texto: acao.texto,
            on: { click: acao.onClick },
          })
    );
  }

  container.replaceChildren(criar('div', { class: 'estado-vazio' }, filhos));
}

/* =============================================================================
 * 5. VALIDAÇÃO VISUAL DE FORMULÁRIOS
 *
 * Validação no navegador é SOMENTE conveniência — dá retorno rápido ao
 * usuário. O servidor revalida tudo, porque qualquer pessoa pode burlar o
 * JavaScript do navegador.
 * ========================================================================== */

/**
 * Marca um campo como inválido e exibe a mensagem.
 * @param {HTMLElement} campoOuInput - o elemento .campo ou o próprio input
 * @param {string} mensagem
 */
export function marcarErroCampo(campoOuInput, mensagem) {
  const campo = campoOuInput.classList?.contains('campo')
    ? campoOuInput
    : campoOuInput.closest('.campo');
  if (!campo) return;

  campo.classList.add('campo--invalido');

  let erro = $('.campo__erro', campo);
  if (!erro) {
    erro = criar('span', { class: 'campo__erro' });
    campo.append(erro);
  }
  erro.textContent = mensagem;

  const input = $('input, select, textarea', campo);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    if (!erro.id) erro.id = `erro-${input.name || input.id || Math.random().toString(36).slice(2)}`;
    input.setAttribute('aria-describedby', erro.id);
  }
}

/** Remove a marcação de erro de um campo. */
export function limparErroCampo(campoOuInput) {
  const campo = campoOuInput.classList?.contains('campo')
    ? campoOuInput
    : campoOuInput.closest('.campo');
  if (!campo) return;

  campo.classList.remove('campo--invalido');
  const erro = $('.campo__erro', campo);
  if (erro) erro.textContent = '';

  const input = $('input, select, textarea', campo);
  if (input) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

/** Limpa todos os erros de um formulário. */
export function limparErrosFormulario(formulario) {
  $$('.campo--invalido', formulario).forEach(limparErroCampo);
}

/**
 * Aplica um conjunto de erros vindos do servidor.
 * @param {HTMLFormElement} formulario
 * @param {Record<string,string>} erros - { nomeDoCampo: 'mensagem' }
 */
export function aplicarErrosServidor(formulario, erros) {
  limparErrosFormulario(formulario);
  let primeiro = null;

  for (const [nome, mensagem] of Object.entries(erros || {})) {
    const input = formulario.elements[nome];
    if (!input) continue;
    marcarErroCampo(input, mensagem);
    if (!primeiro) primeiro = input;
  }

  // Leva o usuário até o primeiro problema, em vez de deixá-lo procurar.
  if (primeiro) {
    primeiro.focus();
    primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* =============================================================================
 * 6. CONFIRMAÇÃO
 * ========================================================================== */

/**
 * Pede confirmação antes de uma ação destrutiva (arquivar produto, recusar
 * comprovante, remover foto).
 *
 * POR QUE `<dialog>` NATIVO E NÃO UMA `<div>` COM POSITION FIXED
 *   O elemento `<dialog>` em modo modal entrega de graça aquilo que costuma
 *   ser esquecido numa implementação própria: o foco fica preso dentro da
 *   caixa, o resto da página sai da árvore de acessibilidade, Esc fecha, e o
 *   fundo escurecido é um pseudo-elemento em vez de mais um nó no DOM.
 *
 *   O `confirm` nativo também tinha essas qualidades — e nenhuma identidade
 *   visual. Esta versão mantém o comportamento e ganha a cara da marca.
 *
 * @param {string} mensagem
 * @param {{confirmar?: string, cancelar?: string}} [rotulos]
 * @returns {Promise<boolean>}
 */
export async function confirmar(mensagem, rotulos = {}) {
  const { confirmar: textoConfirmar = 'Confirmar', cancelar = 'Cancelar' } = rotulos;

  // Navegador sem suporte a <dialog> cai no diálogo do sistema. Perde o
  // visual, mantém a decisão — que é o que importa numa ação destrutiva.
  if (typeof HTMLDialogElement === 'undefined') {
    return window.confirm(mensagem);
  }

  return new Promise((resolver) => {
    const dialogo = criar('dialog', { class: 'dialogo' }, [
      criar('p', { class: 'dialogo__texto', texto: mensagem }),
      criar('div', { class: 'dialogo__acoes' }, [
        criar('button', {
          class: 'btn btn--secundario',
          type: 'button',
          texto: cancelar,
          on: { click: () => dialogo.close('cancelar') },
        }),
        criar('button', {
          class: 'btn btn--primario',
          type: 'button',
          texto: textoConfirmar,
          on: { click: () => dialogo.close('confirmar') },
        }),
      ]),
    ]);

    // Clicar fora da caixa equivale a cancelar — mas só quando o clique cai
    // no próprio <dialog>, que é a área do fundo escurecido.
    dialogo.addEventListener('click', (evento) => {
      if (evento.target === dialogo) dialogo.close('cancelar');
    });

    dialogo.addEventListener('close', () => {
      dialogo.remove();
      resolver(dialogo.returnValue === 'confirmar');
    });

    document.body.append(dialogo);
    dialogo.showModal();

    // O foco começa no "Cancelar": numa ação destrutiva, a tecla Enter
    // apertada por reflexo precisa cair na opção que não faz nada.
    $('.btn--secundario', dialogo)?.focus();
  });
}

/* =============================================================================
 * 7. UTILITÁRIOS DE EVENTO
 * ========================================================================== */

/**
 * Adia a execução até o usuário parar de digitar.
 * Essencial na busca de produtos: evita uma chamada à API por tecla.
 */
export function debounce(fn, espera = 300) {
  let temporizador;
  return function (...args) {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn.apply(this, args), espera);
  };
}

/** Limita a frequência de execução. Útil em eventos de rolagem. */
export function throttle(fn, intervalo = 150) {
  let aguardando = false;
  let ultimosArgs = null;

  return function (...args) {
    if (aguardando) {
      ultimosArgs = args;
      return;
    }
    fn.apply(this, args);
    aguardando = true;
    setTimeout(() => {
      aguardando = false;
      if (ultimosArgs) {
        fn.apply(this, ultimosArgs);
        ultimosArgs = null;
      }
    }, intervalo);
  };
}
