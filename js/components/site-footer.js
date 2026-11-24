/**
 * components/site-footer.js
 * -----------------------------------------------------------------------------
 * Rodapé compartilhado por todas as páginas públicas.
 * Coloque `<div id="rodape"></div>` na página — js/main.js faz a montagem.
 */

import { MARCA, CONTATO, ROTAS, CATEGORIAS, ATIVOS, rota } from '../config.js';
import { criar, $ } from '../lib/ui.js';
import { icone } from './icons.js';
import { montarLinkWhatsApp } from '../whatsapp.js';

const ANO_ATUAL = new Date().getFullYear();

/* -----------------------------------------------------------------------------
 * Colunas
 * -------------------------------------------------------------------------- */

function colunaMarca() {
  return criar('div', { class: 'rodape__coluna' }, [
    criar('div', { class: 'rodape__marca' }, [
      criar('img', {
        src: ATIVOS.logo(),
        alt: `Logomarca da ${MARCA.nome}`,
        width: 62,
        height: 62,
        loading: 'lazy',
        decoding: 'async',
      }),
      criar('div', {}, [
        criar('div', { class: 'rodape__marca-nome', texto: MARCA.nome }),
        criar('div', { class: 'rodape__marca-slogan', texto: MARCA.slogan }),
      ]),
    ]),
    criar('p', { texto: MARCA.descricaoCurta }),
    criar('p', { class: 'rodape__frase', texto: MARCA.frase }),
    criar('div', { class: 'rodape__redes' }, [
      criar(
        'a',
        {
          class: 'rodape__rede',
          href: CONTATO.instagramUrl,
          target: '_blank',
          // noopener protege contra a página aberta manipular a nossa aba.
          rel: 'noopener noreferrer',
          'aria-label': `Instagram da ${MARCA.nome}`,
        },
        [icone('instagram')]
      ),
      criar(
        'a',
        {
          class: 'rodape__rede',
          href: montarLinkWhatsApp('geral'),
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': 'Falar no WhatsApp',
        },
        [icone('whatsapp')]
      ),
    ]),
  ]);
}

function colunaLista(titulo, itens) {
  return criar('div', { class: 'rodape__coluna' }, [
    criar('h2', { class: 'rodape__titulo', texto: titulo }),
    criar(
      'ul',
      { class: 'rodape__lista' },
      itens.map((item) =>
        criar('li', {}, [
          criar('a', {
            href: item.href,
            texto: item.rotulo,
            ...(item.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
          }),
        ])
      )
    ),
  ]);
}

function colunaContato() {
  const itens = [
    criar('li', {}, [
      icone('whatsapp'),
      criar('span', {}, [
        criar('strong', {
          texto: 'WhatsApp',
          estilo: { display: 'block', color: 'var(--cor-creme)' },
        }),
        criar('a', {
          href: montarLinkWhatsApp('geral'),
          target: '_blank',
          rel: 'noopener noreferrer',
          texto: CONTATO.whatsappExibicao,
        }),
      ]),
    ]),
    criar('li', {}, [
      icone('instagram'),
      criar('span', {}, [
        criar('strong', {
          texto: 'Instagram',
          estilo: { display: 'block', color: 'var(--cor-creme)' },
        }),
        criar('a', {
          href: CONTATO.instagramUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          texto: `@${CONTATO.instagram}`,
        }),
      ]),
    ]),
  ];

  // E-mail e endereço só aparecem depois de confirmados pela cliente
  // (ver CONTATO em js/config.js). Nada é inventado aqui.
  if (CONTATO.email) {
    itens.push(
      criar('li', {}, [
        icone('email'),
        criar('a', { href: `mailto:${CONTATO.email}`, texto: CONTATO.email }),
      ])
    );
  }

  if (CONTATO.cidade) {
    itens.push(
      criar('li', {}, [icone('local'), criar('span', { texto: CONTATO.cidade })])
    );
  }

  return criar('div', { class: 'rodape__coluna' }, [
    criar('h2', { class: 'rodape__titulo', texto: 'Fale com a gente' }),
    criar('ul', { class: 'rodape__lista rodape__contato' }, itens),
  ]);
}

/* -----------------------------------------------------------------------------
 * Montagem
 * -------------------------------------------------------------------------- */

export function montarRodape() {
  const alvo = $('#rodape');
  if (!alvo) return;

  const linksCategorias = CATEGORIAS.map((c) => ({
    rotulo: c.nome,
    href: `${rota(ROTAS.produtos)}?categoria=${encodeURIComponent(c.slug)}`,
  }));

  const linksInstitucionais = [
    { rotulo: 'Nossa História', href: rota(ROTAS.nossaHistoria) },
    { rotulo: 'Seja Revendedor', href: rota(ROTAS.sejaRevendedor) },
    { rotulo: 'Contato', href: rota(ROTAS.contato) },
    { rotulo: 'Minha Conta', href: rota(ROTAS.minhaConta) },
  ];

  const rodape = criar('footer', { class: 'rodape' }, [
    criar('div', { class: 'container' }, [
      criar('div', { class: 'rodape__grade' }, [
        colunaMarca(),
        colunaLista('Nossos Doces', linksCategorias),
        colunaLista('Institucional', linksInstitucionais),
        colunaContato(),
      ]),
    ]),
    criar('div', { class: 'rodape__base' }, [
      criar('div', { class: 'container rodape__base-interno' }, [
        criar('p', {
          class: 'rodape__copyright',
          texto: `© ${ANO_ATUAL} ${MARCA.nome} · Todos os direitos reservados.`,
        }),
        // Não há link de "Trocas e Devoluções": a loja não trabalha com
        // troca nem devolução, e um link para uma política que não existe é
        // promessa que ninguém fez.
        criar('ul', { class: 'rodape__legais' }, [
          criar('li', {}, [
            criar('a', {
              href: rota(ROTAS.politicaPrivacidade),
              texto: 'Política de Privacidade',
            }),
          ]),
        ]),
      ]),
    ]),
  ]);

  alvo.replaceChildren(rodape);
}

export default montarRodape;
