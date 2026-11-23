/**
 * whatsapp.js
 * -----------------------------------------------------------------------------
 * Integração com o WhatsApp: montagem de links com mensagem pré-preenchida e
 * botão flutuante presente em todas as páginas públicas.
 *
 * O endereço `https://wa.me/<numero>?text=<mensagem>` é o formato oficial.
 * Ele funciona tanto no aplicativo do celular quanto no WhatsApp Web.
 */

import { CONTATO, MENSAGENS_WHATSAPP } from './config.js';
import { criar, $ } from './lib/ui.js';
import { icone } from './components/icons.js';

/**
 * Monta a URL do WhatsApp com uma mensagem pronta.
 *
 * @param {keyof MENSAGENS_WHATSAPP | string} contexto - chave de
 *        MENSAGENS_WHATSAPP ou um texto livre.
 * @param {...any} args - argumentos para as mensagens que são funções
 *        (ex.: nome do produto, código do pedido).
 * @returns {string}
 *
 * @example
 *   montarLinkWhatsApp('encomenda')
 *   montarLinkWhatsApp('duvidaProduto', 'Brownie de Nutella')
 */
export function montarLinkWhatsApp(contexto = 'geral', ...args) {
  const modelo = MENSAGENS_WHATSAPP[contexto];

  let mensagem;
  if (typeof modelo === 'function') {
    mensagem = modelo(...args);
  } else if (typeof modelo === 'string') {
    mensagem = modelo;
  } else {
    // Não é uma chave conhecida: trata como texto livre.
    mensagem = contexto;
  }

  return `https://wa.me/${CONTATO.whatsapp}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Cria o botão flutuante do WhatsApp no canto inferior direito.
 * Chamado por js/main.js em todas as páginas públicas.
 */
export function montarBotaoWhatsApp() {
  // Evita duplicar o botão se a função for chamada mais de uma vez.
  if ($('.whatsapp-flutuante')) return;

  const botao = criar(
    'a',
    {
      class: 'whatsapp-flutuante',
      href: montarLinkWhatsApp('geral'),
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': `Conversar no WhatsApp: ${CONTATO.whatsappExibicao}`,
      title: 'Fale conosco no WhatsApp',
    },
    [icone('whatsapp')]
  );

  document.body.append(botao);
}

/**
 * Aplica o link correto a todo elemento marcado com `data-whatsapp` no HTML.
 *
 * Assim o HTML das páginas não precisa repetir o número de telefone:
 *   <a data-whatsapp="encomenda" class="btn btn--whatsapp">Encomendar</a>
 */
export function ativarLinksWhatsApp(raiz = document) {
  raiz.querySelectorAll('[data-whatsapp]').forEach((el) => {
    const contexto = el.dataset.whatsapp || 'geral';
    const extra = el.dataset.whatsappArg;

    el.setAttribute('href', montarLinkWhatsApp(contexto, extra));
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  });
}
