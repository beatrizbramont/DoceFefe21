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
 * POR QUE NÃO EMOJI
 *   Emoji parece prático e é armadilha: cada sistema desenha o seu. O 🤝 do
 *   Windows não é o do iPhone, que não é o do Android. Um painel inteiro
 *   montado com emoji muda de cara conforme quem abre — e não há CSS que
 *   conserte, porque o desenho vem da fonte do sistema.
 *
 *   Estes ícones são desenhados uma vez e aparecem iguais em todo lugar, no
 *   traço da marca e na cor do texto ao redor.
 *
 * Estas strings são HTML estático escrito por nós — nunca contêm dados do
 * usuário —, então é seguro usá-las com innerHTML.
 */

/**
 * @param {string} conteudo - os elementos internos do SVG
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.preenchido] - true para marcas (WhatsApp, Instagram)
 * @param {number|string} [opcoes.tamanho] - número em px, ou '1em' para
 *   acompanhar o `font-size` de quem o contém
 */
const svg = (conteudo, { preenchido = false, tamanho = 24 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" ` +
  (preenchido
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') +
  ` aria-hidden="true" focusable="false">${conteudo}</svg>`;

/**
 * O conteúdo de cada ícone, sem o invólucro <svg>.
 *
 * Separado assim para que o mesmo desenho possa sair em tamanhos diferentes:
 * 24px no menu, 1em quando o CSS controla pelo `font-size`.
 */
const DESENHOS = {
  /* --- Navegação e estrutura ------------------------------------------- */
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',

  fechar: '<path d="M18 6 6 18M6 6l12 12"/>',

  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',

  usuario:
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',

  usuarios:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/>' +
    '<path d="M22 21v-2a4 4 0 0 0-3-3.8M16.5 3.7a4 4 0 0 1 0 7.5"/>',

  carrinho:
    '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/>' +
    '<path d="M2 3h2.2l2.1 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 7H5.3"/>',

  casa: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5"/>',

  /* --- Contato e marcas ------------------------------------------------ */
  whatsapp: null, // definido abaixo: é preenchido, não traçado

  instagram:
    '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/>' +
    '<circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>',

  telefone:
    '<path d="M22 16.9v2.6a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.7 19.7 0 0 1 2.1 3.7 2 2 0 0 1 4.1 1.5h2.6a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.8 9.3a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',

  email:
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 8.1 5.6a1.6 1.6 0 0 0 1.8 0L21 7"/>',

  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-5a8.1 8.1 0 0 1-.8-3.5A8.4 8.4 0 0 1 12 3.5h.5a8.4 8.4 0 0 1 8.5 8Z"/>',

  local:
    '<path d="M20 10.4c0 5.4-8 12.1-8 12.1s-8-6.7-8-12.1a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10.2" r="2.8"/>',

  /* --- Painel administrativo ------------------------------------------- */
  painel:
    '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7.5 16v-4M12 16V8m4.5 8v-6"/>',

  prancheta:
    '<path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z"/>' +
    '<path d="M16 5h1.5A1.5 1.5 0 0 1 19 6.5v13A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H8"/>' +
    '<path d="m9 13 2 2 4-4"/>',

  recibo:
    '<path d="M5 21V4.5a.5.5 0 0 1 .8-.4l2 1.4 2.2-1.5 2 1.5 2.2-1.5 2 1.5 2-1.4a.5.5 0 0 1 .8.4V21l-2.4-1.4-2 1.4-2.2-1.4-2 1.4-2.2-1.4-2 1.4Z"/>' +
    '<path d="M9 9h6M9 13h4"/>',

  caixa: '<path d="m21 8-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9"/>',

  parceria:
    '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2l-3.6-3.6"/>' +
    '<path d="M3 11.5 7 7.6a2 2 0 0 1 2.5-.2l2.5 1.7 2.4-1.8a2 2 0 0 1 2.5.1L21 11"/>' +
    '<path d="m6.5 14.5 2.6 2.6a1.4 1.4 0 0 0 2-2l-2.6-2.6"/><path d="M3 11.5 6 15m15-3.5-3 3.4"/>',

  etiqueta:
    '<path d="M3 12.6V4.5a1.5 1.5 0 0 1 1.5-1.5h8.1a2 2 0 0 1 1.4.6l6.3 6.3a1.6 1.6 0 0 1 0 2.3l-7.6 7.6a1.6 1.6 0 0 1-2.3 0L3.6 14a2 2 0 0 1-.6-1.4Z"/>' +
    '<circle cx="7.8" cy="7.8" r="1.4"/>',

  /* --- Ações ------------------------------------------------------------ */
  verificado: '<path d="m4.5 12.5 5 5L19.5 7"/>',

  lapis:
    '<path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L8.2 18.2 4 19.5l1.3-4.2Z"/><path d="m14.5 5.9 3 3"/>',

  camera:
    '<path d="M4.5 7.5h3l1.3-2a1 1 0 0 1 .8-.5h4.8a1 1 0 0 1 .8.5l1.3 2h3A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5Z"/>' +
    '<circle cx="12" cy="13" r="3.4"/>',

  impressora:
    '<path d="M7 9V3.5h10V9"/><path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>' +
    '<rect x="7" y="14.5" width="10" height="6" rx="1"/>',

  documento:
    '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z"/>' +
    '<path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',

  clipe:
    '<path d="M20 11.5 12.3 19.2a4.6 4.6 0 0 1-6.5-6.5l7.9-7.9a3 3 0 1 1 4.3 4.3l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7.2-7.2"/>',

  engrenagem:
    '<circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',

  /* --- Avisos e estados ------------------------------------------------- */
  alerta:
    '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
    '<path d="M12 9.5v4.2M12 17.5h.01"/>',

  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.2 1.9"/>',

  informacao: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',

  cadeado:
    '<rect x="3.8" y="10.5" width="16.4" height="10.5" rx="2"/>' +
    '<path d="M7.8 10.5V7.2a4.2 4.2 0 0 1 8.4 0v3.3"/>',

  estrela:
    '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1-5.3-3-5.3 3 1.1-6.1L3.4 9.4l6-.8Z"/>',

  coracao:
    '<path d="M20.3 5.3a5 5 0 0 0-7.1 0L12 6.5l-1.2-1.2a5 5 0 0 0-7.1 7.1l1.2 1.2L12 21l7.1-7.4 1.2-1.2a5 5 0 0 0 0-7.1Z"/>',

  mao: '<path d="M8 12.5V5.8a1.6 1.6 0 0 1 3.2 0v5.4"/><path d="M11.2 11V4.6a1.6 1.6 0 1 1 3.2 0V11"/>' +
    '<path d="M14.4 11.4V6.6a1.6 1.6 0 0 1 3.2 0v8.2a6 6 0 0 1-6 6h-.7a6 6 0 0 1-4.5-2l-2.6-3a1.6 1.6 0 0 1 2.3-2.2L8 15.4"/>',

  sol:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',

  /* --- Entrega e pagamento --------------------------------------------- */
  entrega:
    '<path d="M2.5 6.5h9.2a1 1 0 0 1 1 1V16H3.5a1 1 0 0 1-1-1Z"/>' +
    '<path d="M12.7 9.5H17l3.5 3.5V16h-7.8"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',

  dinheiro:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M6 10v4M18 10v4"/>',

  celular:
    '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.8 18.5h2.4"/>',

  /* --- Catálogo e datas ------------------------------------------------- */
  doce:
    '<path d="M6 10.5h12l-1.2 8a2 2 0 0 1-2 1.7H9.2a2 2 0 0 1-2-1.7Z"/>' +
    '<path d="M5 10.5a3.4 3.4 0 0 1 2.6-3.3 3.2 3.2 0 0 1 2.2-2.9A3.1 3.1 0 0 1 12 3a3.1 3.1 0 0 1 2.2.9 3.2 3.2 0 0 1 2.2 2.3A3.4 3.4 0 0 1 19 10.5Z"/>',

  biscoito:
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M9 9.5h.01M15 9.5h.01M8.5 14.5h.01M13.5 14h.01M16 13h.01"/>',

  bolo:
    '<path d="M4 20.5h16V13a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2Z"/>' +
    '<path d="M4 15.5c1.3 0 1.3 1.3 2.7 1.3s1.3-1.3 2.6-1.3 1.3 1.3 2.7 1.3 1.3-1.3 2.7-1.3 1.3 1.3 2.6 1.3 1.3-1.3 2.7-1.3"/>' +
    '<path d="M12 11V8M12 5.5V4"/>',

  bala:
    '<path d="M8.8 8.8a4.5 4.5 0 0 1 6.4 6.4 4.5 4.5 0 0 1-6.4-6.4Z"/>' +
    '<path d="m8.5 8.5-4-1.8a.6.6 0 0 0-.8.8l1.8 4M15.5 15.5l4 1.8a.6.6 0 0 0 .8-.8l-1.8-4"/>',

  presente:
    '<rect x="3" y="9.5" width="18" height="4" rx="1"/><path d="M4.5 13.5V20a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-6.5"/>' +
    '<path d="M12 9.5V21"/>' +
    '<path d="M12 9.5H8a2.3 2.3 0 0 1 0-4.6c2.3 0 4 4.6 4 4.6Zm0 0h4a2.3 2.3 0 0 0 0-4.6c-2.3 0-4 4.6-4 4.6Z"/>',

  folha:
    '<path d="M4.5 19.5C3 15 4.5 9 8.5 6.5c3-1.9 7-1.9 11-1.4.6 5-.5 9.6-3.4 12.1-2.8 2.4-7.4 2.6-11.6 2.3Z"/>' +
    '<path d="M4.5 19.5C7 15.5 10.5 12 15 9.5"/>',

  arvore:
    '<path d="M12 3 7 9.5h2.5L5.5 15h4L6 19.5h12L14.5 15h4l-4-5.5H17Z"/><path d="M12 19.5V22"/>',

  calendario:
    '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
};

/** O WhatsApp é a logomarca do serviço: desenho preenchido, não traçado. */
const WHATSAPP_PREENCHIDO =
  '<path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.86-.87 2.09 0 1.23.9 2.42 1.02 2.59.12.16 1.76 2.69 4.27 3.77.6.26 1.06.41 1.42.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.19.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z"/>';

/* =============================================================================
 * APELIDOS
 *
 * Nomes diferentes para o mesmo desenho, quando o sentido muda com o lugar.
 * Evita decorar que "recusar" e "fechar" são o mesmo X.
 * ========================================================================== */

const APELIDOS = {
  recusar: 'fechar',
  aprovar: 'verificado',
  check: 'verificado',
  editar: 'lapis',
  imprimir: 'impressora',
  foto: 'camera',
  anexo: 'clipe',
  aviso: 'alerta',
  pendente: 'relogio',
  seguro: 'cadeado',
  pix: 'celular',
  retirada: 'casa',
  produtos: 'doce',
  clientes: 'usuarios',
  estoque: 'caixa',
  pedidos: 'recibo',
  separacao: 'prancheta',
  parceiros: 'parceria',
  promocao: 'etiqueta',
  natal: 'arvore',
  vazio: 'doce',
};

/** Compatibilidade: o formato antigo, já montado em 24px. */
export const ICONES = Object.fromEntries(
  Object.entries(DESENHOS)
    .filter(([, desenho]) => desenho)
    .map(([nome, desenho]) => [nome, svg(desenho)])
);

ICONES.whatsapp = svg(WHATSAPP_PREENCHIDO, { preenchido: true });

/* =============================================================================
 * ÍCONE DE CATEGORIA
 *
 * A coluna `categories.icone` do banco guarda um emoji, escolhido antes de
 * existir este catálogo. Em vez de uma migração só para trocar figurinha —
 * e de depender de alguém colar o emoji certo ao cadastrar categoria nova —,
 * o desenho é resolvido aqui, pelo slug.
 *
 * Categoria desconhecida cai no ícone genérico de doce, nunca em branco.
 * ========================================================================== */

const ICONE_POR_CATEGORIA = {
  brownies: 'doce',
  'paes-de-mel': 'bolo',
  alfajores: 'biscoito',
  fit: 'folha',
  sazonais: 'presente',
};

export const iconeDaCategoria = (slug) => ICONE_POR_CATEGORIA[slug] || 'doce';

/** Todos os nomes aceitos por `icone()`, apelidos incluídos. */
export const NOMES_DE_ICONE = [...Object.keys(ICONES), ...Object.keys(APELIDOS)];

/** Resolve apelidos e devolve a marcação SVG, ou null se o nome não existe. */
export function marcacaoDoIcone(nome, tamanho = 24) {
  const real = APELIDOS[nome] || nome;

  if (real === 'whatsapp') {
    return svg(WHATSAPP_PREENCHIDO, { preenchido: true, tamanho });
  }

  const desenho = DESENHOS[real];
  if (!desenho) return null;

  return svg(desenho, { tamanho });
}

/**
 * Cria o elemento <svg> do ícone escolhido.
 *
 * Usa <template> para transformar a string em um nó real: diferente de
 * innerHTML direto, o conteúdo do template não é renderizado nem executado
 * até ser inserido no documento.
 *
 * @param {string} nome - nome do ícone ou apelido
 * @param {string} [classe]
 * @param {number|string} [tamanho] - '1em' faz o ícone seguir o font-size
 * @returns {SVGElement|null}
 */
export function icone(nome, classe = '', tamanho = 24) {
  const marcacao = marcacaoDoIcone(nome, tamanho);

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

/**
 * Preenche os marcadores declarados no HTML:
 *
 *     <span class="valor__icone" data-icone="coracao" aria-hidden="true"></span>
 *
 * Permite que a página peça um ícone sem repetir o SVG inteiro na marcação —
 * mesma ideia do cabeçalho e do rodapé montados por JavaScript.
 *
 * O SVG entra DENTRO do marcador, em vez de substituí-lo: é o contêiner que
 * carrega classe, tamanho e fundo (ver `.canal__icone` em institucional.css),
 * e quem manda no tamanho do desenho é o CSS.
 *
 * O desenho sai em `1em`. Assim o `font-size` que o CSS já usava para
 * dimensionar o emoji continua valendo, sem precisar reescrever as folhas de
 * estilo — e contêineres com tamanho fixo seguem mandando pela regra própria.
 *
 * Vivia em main.js, que só as páginas públicas carregam. Mudou para cá
 * quando o painel administrativo também passou a precisar — função duplicada
 * em dois arquivos é a que diverge primeiro.
 */
export function ativarIcones(raiz = document) {
  raiz.querySelectorAll('[data-icone]').forEach((el) => {
    // Não duplica se a função rodar mais de uma vez.
    if (el.querySelector('svg')) return;

    const svgEl = icone(el.dataset.icone, '', '1em');
    if (svgEl) el.append(svgEl);
  });
}

export default {
  ICONES,
  icone,
  ativarIcones,
  marcacaoDoIcone,
  iconeDaCategoria,
  NOMES_DE_ICONE,
};
