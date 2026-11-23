/**
 * components/icons.js
 * -----------------------------------------------------------------------------
 * Ícones em SVG inline.
 *
 * Por que SVG inline e não uma biblioteca de ícones?
 *   - Zero requisições extras e zero dependências externas.
 *   - `currentColor` faz o ícone herdar a cor do texto automaticamente.
 *   - Escalam sem perder nitidez em qualquer tela.
 *
 * Estas strings são HTML estático escrito por nós — nunca contêm dados do
 * usuário —, então é seguro usá-las com innerHTML.
 */

const svg = (conteudo, { preenchido = false, tamanho = 24 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" ` +
  (preenchido
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') +
  ` aria-hidden="true" focusable="false">${conteudo}</svg>`;

export const ICONES = {
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),

  fechar: svg('<path d="M18 6 6 18M6 6l12 12"/>'),

  busca: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>'),

  usuario: svg(
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  ),

  carrinho: svg(
    '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/>' +
      '<path d="M2 3h2.2l2.1 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 7H5.3"/>'
  ),

  whatsapp: svg(
    '<path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.86-.87 2.09 0 1.23.9 2.42 1.02 2.59.12.16 1.76 2.69 4.27 3.77.6.26 1.06.41 1.42.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.19.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z"/>',
    { preenchido: true }
  ),

  instagram: svg(
    '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>'
  ),

  telefone: svg(
    '<path d="M22 16.9v2.6a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.7 19.7 0 0 1 2.1 3.7 2 2 0 0 1 4.1 1.5h2.6a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.8 9.3a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'
  ),

  email: svg(
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 8.1 5.6a1.6 1.6 0 0 0 1.8 0L21 7"/>'
  ),

  local: svg(
    '<path d="M20 10.4c0 5.4-8 12.1-8 12.1s-8-6.7-8-12.1a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10.2" r="2.8"/>'
  ),

  caixa: svg(
    '<path d="m21 8-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9"/>'
  ),

  coracao: svg(
    '<path d="M20.3 5.3a5 5 0 0 0-7.1 0L12 6.5l-1.2-1.2a5 5 0 0 0-7.1 7.1l1.2 1.2L12 21l7.1-7.4 1.2-1.2a5 5 0 0 0 0-7.1Z"/>'
  ),
};

/**
 * Cria o elemento <svg> do ícone escolhido.
 *
 * Usa <template> para transformar a string em um nó real: diferente de
 * innerHTML direto, o conteúdo do template não é renderizado nem executado
 * até ser inserido no documento.
 *
 * @param {keyof ICONES} nome
 * @param {string} [classe]
 * @returns {SVGElement|null}
 */
export function icone(nome, classe = '') {
  const marcacao = ICONES[nome];
  if (!marcacao) {
    console.warn(`[icons] Ícone "${nome}" não existe.`);
    return null;
  }

  const modelo = document.createElement('template');
  modelo.innerHTML = marcacao;
  const el = modelo.content.firstElementChild;
  if (el && classe) el.setAttribute('class', classe);
  return el;
}
