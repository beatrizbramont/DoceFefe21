/**
 * config.js
 * -----------------------------------------------------------------------------
 * Fonte única de verdade para dados da marca, rotas e configurações públicas.
 *
 * ATENÇÃO DE SEGURANÇA
 * Este arquivo é enviado ao navegador. NUNCA coloque aqui:
 *   - chave service_role do Supabase
 *   - access token do Mercado Pago
 *   - qualquer senha ou segredo
 * Só entram valores públicos (telefone comercial, redes sociais, anon key).
 */

/* -----------------------------------------------------------------------------
 * LEITURA DAS VARIÁVEIS PÚBLICAS
 *
 * Existem duas formas de rodar este site, e cada uma entrega as variáveis de
 * um jeito:
 *
 *   • npm run dev (Vite)   → substitui `import.meta.env.VITE_*` pelo valor
 *                            literal durante o build
 *   • npm run serve        → injeta `window.__ENV__` no <head> das páginas
 *                            (ver dev-server.mjs)
 *
 * Esta função tenta as duas, nessa ordem. Sem ela, rodar pelo servidor sem
 * dependências deixava todas as configurações vazias — e a área do cliente
 * acusava falta de chaves que estavam preenchidas no .env.
 *
 * @param {string} nome - ex.: 'VITE_SUPABASE_URL'
 * @returns {string}
 */
function variavel(nome) {
  // `import.meta.env` só existe quando o Vite processou o arquivo.
  const doVite = import.meta.env?.[nome];
  if (doVite) return doVite;

  // `globalThis` em vez de `window`: assim este módulo também carrega no
  // Node, onde os testes o importam.
  const doServidor = globalThis.__ENV__?.[nome];
  if (doServidor) return doServidor;

  return '';
}

/* -----------------------------------------------------------------------------
 * MARCA
 * -------------------------------------------------------------------------- */
export const MARCA = {
  nome: 'Doce Fefê.21',
  slogan: 'Doces Artesanais',
  frase: 'Muito mais que doces, uma história de amor em cada pedaço.',
  descricaoCurta:
    'Doces artesanais feitos à mão, com ingredientes selecionados e muito carinho.',
};

/* -----------------------------------------------------------------------------
 * CONTATO
 * Valores extraídos das artes oficiais da marca.
 * -------------------------------------------------------------------------- */
export const CONTATO = {
  /** Número no formato internacional, sem símbolos — exigido pela API do WhatsApp. */
  whatsapp: '5511979788231',
  /** Mesmo número, formatado para leitura humana. */
  whatsappExibicao: '(11) 97978-8231',
  instagram: 'docefefe.21',
  instagramUrl: 'https://instagram.com/docefefe.21',
  /** TODO: confirmar com a cliente antes de publicar. */
  email: '',
  cidade: '',
};

/** Mensagens pré-preenchidas ao abrir o WhatsApp a partir de cada contexto. */
export const MENSAGENS_WHATSAPP = {
  geral: 'Olá! Vim pelo site da Doce Fefê.21 e gostaria de mais informações.',
  encomenda: 'Olá! Gostaria de fazer uma encomenda de doces artesanais.',
  revendedor: 'Olá! Tenho interesse em revender os produtos da Doce Fefê.21.',
  duvidaProduto: (produto) =>
    `Olá! Tenho uma dúvida sobre o produto "${produto}".`,
  pedido: (codigo) => `Olá! Gostaria de falar sobre o meu pedido ${codigo}.`,
};

/* -----------------------------------------------------------------------------
 * CATEGORIAS DO CATÁLOGO
 * Usadas como fallback de navegação. A lista verdadeira vem do banco (Fase 3).
 * Observação: a linha de kits será adicionada numa etapa futura.
 * -------------------------------------------------------------------------- */
export const CATEGORIAS = [
  { slug: 'brownies', nome: 'Brownies', icone: '🍫' },
  { slug: 'paes-de-mel', nome: 'Pães de Mel', icone: '🍯' },
  { slug: 'alfajores', nome: 'Alfajores', icone: '🥮' },
  { slug: 'fit', nome: 'Doce Fefê Fit', icone: '🌿' },
  { slug: 'sazonais', nome: 'Sazonais', icone: '🎁' },
];

/* -----------------------------------------------------------------------------
 * ROTAS
 * Centralizar os caminhos evita links quebrados ao renomear uma página.
 * -------------------------------------------------------------------------- */
export const ROTAS = {
  inicio: 'index.html',
  produtos: 'produtos.html',
  produto: 'produto.html',
  nossaHistoria: 'nossa-historia.html',
  sejaRevendedor: 'seja-revendedor.html',
  contato: 'contato.html',
  carrinho: 'carrinho.html',
  checkout: 'checkout.html',
  pagamento: 'pagamento.html',
  minhaConta: 'minha-conta.html',
  politicaPrivacidade: 'politica-privacidade.html',
  admin: 'admin/index.html',
};

/**
 * O site tem páginas na raiz e no diretório /admin/. Um link escrito como
 * "produtos.html" funciona na raiz, mas quebra dentro de /admin/.
 * Esta função devolve o caminho correto a partir de onde a página está.
 */
export const estaNoAdmin = () => window.location.pathname.includes('/admin/');

/**
 * Monta o caminho de uma rota relativo à página atual.
 * @param {string} rota - caminho relativo à raiz do site (ex.: 'produtos.html')
 * @returns {string}
 */
export function rota(rota_) {
  return (estaNoAdmin() ? '../' : './') + rota_;
}

/* -----------------------------------------------------------------------------
 * ARQUIVOS DE MÍDIA
 *
 * Os caminhos são resolvidos em tempo de execução por `rota()`, e não
 * importados pelo empacotador. Isso mantém o site funcionando em qualquer
 * servidor de arquivos estáticos — com ou sem Vite.
 *
 * A LOGOMARCA é o arquivo original da marca. Nunca deve ser editada,
 * recortada ou ter filtros aplicados: apenas redimensionada pelo CSS.
 * -------------------------------------------------------------------------- */
export const ATIVOS = {
  logo: () => rota('assets/images/logo.jpeg'),
};

/**
 * Resolve o endereço de uma imagem vinda do banco.
 *
 * As fotos podem estar em dois lugares:
 *   • na pasta do projeto  → 'assets/images/paodemel.jpeg'
 *   • no Supabase Storage  → 'https://xxx.supabase.co/storage/v1/...'
 *
 * Caminhos locais são resolvidos conforme a pasta da página atual; URLs
 * completas passam intactas. Assim, migrar as fotos para o Storage depois é
 * só trocar o valor no banco — nenhuma linha de código muda.
 *
 * @param {string} caminho
 * @returns {string}
 */
export function urlMidia(caminho) {
  const valor = String(caminho || '').trim();
  if (!valor) return '';

  // URL completa ou data URI: usa como está.
  if (/^(https?:)?\/\//i.test(valor) || valor.startsWith('data:')) return valor;

  // Caminho local, com ou sem barra inicial.
  return rota(valor.replace(/^\/+/, ''));
}

/* -----------------------------------------------------------------------------
 * API
 * -------------------------------------------------------------------------- */
export const API = {
  /**
   * Em desenvolvimento, VITE_API_URL fica vazio e o servidor local encaminha
   * "/api" para o backend em localhost:3000.
   * Em produção, defina VITE_API_URL com o domínio público da API.
   */
  base: `${variavel('VITE_API_URL')}/api`,
};

/* -----------------------------------------------------------------------------
 * REGRAS DE NEGÓCIO (frontend)
 *
 * IMPORTANTE: estes valores servem apenas para exibir informação e validar
 * cedo, melhorando a experiência. TODA regra é revalidada no servidor antes
 * de confirmar um pedido. Nada aqui é considerado confiável.
 * -------------------------------------------------------------------------- */
export const REGRAS = {
  quantidadeMinimaItem: 1,
  quantidadeMaximaItem: 99,
  /** Chave usada para persistir o carrinho no navegador. */
  chaveCarrinho: 'docefefe21:carrinho:v1',
  /** Versão do consentimento de cookies/LGPD. Incrementar invalida o aceite. */
  chaveConsentimento: 'docefefe21:consentimento:v1',
};

/* -----------------------------------------------------------------------------
 * SUPABASE (chaves públicas)
 * A anon key é pública por design: o acesso é controlado pelas políticas RLS.
 * -------------------------------------------------------------------------- */
export const SUPABASE = {
  url: variavel('VITE_SUPABASE_URL'),
  anonKey: variavel('VITE_SUPABASE_ANON_KEY'),
};

/*
 * Não há rastreamento de visitantes neste site.
 *
 * Existia aqui um `ANALYTICS_ID` reservado para o Google Analytics, que
 * nunca foi usado por nenhuma página. A loja decidiu não medir visitas, e a
 * constante foi removida: configuração parada, esperando uma fase que não
 * vem, é a mesma armadilha do desconto que não descontava — alguém a
 * preenche um dia e supõe que ligou alguma coisa.
 *
 * Se um dia houver análise de audiência, ela vem junto com o aviso de
 * cookies que a LGPD exige. São duas construções, não uma.
 */
