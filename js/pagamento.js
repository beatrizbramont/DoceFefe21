/**
 * pagamento.js
 * -----------------------------------------------------------------------------
 * Tela de pagamento, exibida logo depois de o pedido ser registrado.
 *
 * O FLUXO
 *
 *   1. Escolher a forma:
 *        • Dinheiro → abre o WhatsApp para combinar
 *        • Pix      → mostra o QR Code
 *   2. No Pix, depois de pagar, enviar o comprovante
 *   3. Pronto — a loja confere e confirma
 *
 * ⚠️ ENVIAR O COMPROVANTE NÃO CONFIRMA O PAGAMENTO
 *   A tela diz isso com todas as letras. Prometer "pagamento confirmado"
 *   quando ninguém conferiu o extrato seria mentir para o cliente — e
 *   geraria pedido entrando em produção sem o dinheiro ter entrado.
 */

import { api, ErroApi } from './lib/api.js';
import {
  $,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  confirmar,
} from './lib/ui.js';
import { moeda, dataHora } from './lib/format.js';
import { montarLinkWhatsApp } from './whatsapp.js';
import { ROTAS, rota, urlMidia } from './config.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

let pedido = null;
let situacao = null;
let arquivoEscolhido = null;

/* =============================================================================
 * MENSAGEM PARA O WHATSAPP
 * ========================================================================== */

function montarMensagem(formaPagamento) {
  const linhas = [
    `Olá! Fiz o pedido *${pedido.codigo}* pelo site da Doce Fefê.21.`,
    '',
    `*Nome:* ${pedido.cliente.nome}`,
    `*Total:* ${moeda(pedido.total)}`,
    `*${pedido.tipoEntrega === 'entrega' ? 'Entrega' : 'Retirada'}*`,
  ];

  if (pedido.dataDesejada) {
    linhas.push(`*Data desejada:* ${pedido.dataDesejada.split('-').reverse().join('/')}`);
  }

  linhas.push('', '*Itens:*');
  pedido.itens.forEach((i) => {
    linhas.push(`• ${i.quantidade}× ${i.nome}`);
  });

  linhas.push('');

  if (formaPagamento === 'dinheiro') {
    linhas.push('Gostaria de pagar em *dinheiro*. Podemos combinar?');
  } else {
    linhas.push('Vou pagar por *Pix*.');
  }

  return linhas.join('\n');
}

/* =============================================================================
 * PASSO 1 — ESCOLHA DA FORMA
 * ========================================================================== */

async function escolherForma(metodo, botao) {
  botaoCarregando(botao, true);

  try {
    await api.post(`/pedidos/${pedido.codigo}/pagamento`, { metodo });

    if (metodo === 'dinheiro') {
      mostrarDinheiro();
    } else {
      mostrarPix();
    }
  } catch (erro) {
    console.error('[pagamento] Falha ao registrar a forma:', erro);
    toastErro(erro.message || 'Não conseguimos registrar a forma de pagamento.');
  } finally {
    botaoCarregando(botao, false);
  }
}

function mostrarEscolha() {
  const container = $('[data-pagamento]');
  if (!container) return;

  const botaoDinheiro = criar(
    'button',
    { class: 'forma-pagamento', type: 'button' },
    [
      criar('span', { class: 'forma-pagamento__icone', texto: '💵', 'aria-hidden': 'true' }),
      criar('span', { class: 'forma-pagamento__info' }, [
        criar('strong', { texto: 'Dinheiro' }),
        criar('span', { texto: 'Combine com a gente pelo WhatsApp e pague na entrega ou retirada.' }),
      ]),
      criar('span', { class: 'forma-pagamento__seta', texto: '→', 'aria-hidden': 'true' }),
    ]
  );

  const botaoPix = criar(
    'button',
    { class: 'forma-pagamento forma-pagamento--destaque', type: 'button' },
    [
      criar('span', { class: 'forma-pagamento__icone', texto: '📱', 'aria-hidden': 'true' }),
      criar('span', { class: 'forma-pagamento__info' }, [
        criar('strong', { texto: 'Pix' }),
        criar('span', { texto: 'Pague agora pelo QR Code e envie o comprovante.' }),
      ]),
      criar('span', { class: 'forma-pagamento__seta', texto: '→', 'aria-hidden': 'true' }),
    ]
  );

  botaoDinheiro.addEventListener('click', () => escolherForma('dinheiro', botaoDinheiro));
  botaoPix.addEventListener('click', () => escolherForma('pix', botaoPix));

  container.replaceChildren(
    criar('div', { class: 'pagamento-passo' }, [
      criar('h2', { class: 'pagamento-passo__titulo', texto: 'Como você quer pagar?' }),
      criar('p', {
        class: 'pagamento-passo__texto',
        texto: `Total do pedido: ${moeda(pedido.total)}`,
      }),
      criar('div', { class: 'formas-pagamento' }, [botaoPix, botaoDinheiro]),
    ])
  );
}

/* =============================================================================
 * PASSO 2A — DINHEIRO
 * ========================================================================== */

function mostrarDinheiro() {
  const container = $('[data-pagamento]');
  if (!container) return;

  const link = montarLinkWhatsApp(montarMensagem('dinheiro'));

  container.replaceChildren(
    criar('div', { class: 'pagamento-passo' }, [
      criar('div', {
        class: 'pagamento-passo__icone',
        texto: '💵',
        'aria-hidden': 'true',
      }),
      criar('h2', { class: 'pagamento-passo__titulo', texto: 'Combinar pagamento' }),
      criar('p', {
        class: 'pagamento-passo__texto',
        texto:
          'Fale com a gente pelo WhatsApp para combinar a entrega e o pagamento ' +
          'em dinheiro. Seu pedido já está registrado.',
      }),

      criar('div', { class: 'pagamento-total' }, [
        criar('span', { texto: 'Total a pagar' }),
        criar('strong', { class: 'preco preco--grande', texto: moeda(pedido.total) }),
      ]),

      criar('a', {
        class: 'btn btn--whatsapp btn--grande btn--bloco mt-6',
        href: link,
        target: '_blank',
        rel: 'noopener noreferrer',
        texto: 'Abrir WhatsApp',
      }),

      criar('button', {
        class: 'btn btn--secundario btn--bloco mt-3',
        type: 'button',
        texto: '← Escolher outra forma',
        on: { click: mostrarEscolha },
      }),
    ])
  );
}

/* =============================================================================
 * PASSO 2B — PIX
 * ========================================================================== */

function mostrarPix() {
  const container = $('[data-pagamento]');
  if (!container) return;

  container.replaceChildren(
    criar('div', { class: 'pagamento-passo' }, [
      criar('h2', { class: 'pagamento-passo__titulo', texto: 'Pagar com Pix' }),
      criar('p', {
        class: 'pagamento-passo__texto',
        texto: 'Abra o aplicativo do seu banco e leia o QR Code abaixo.',
      }),

      criar('div', { class: 'pagamento-total' }, [
        criar('span', { texto: 'Valor a pagar' }),
        criar('strong', { class: 'preco preco--grande', texto: moeda(pedido.total) }),
      ]),

      // O QR Code é a arte oficial da marca, com o código do Pix.
      criar('div', { class: 'pix-qrcode' }, [
        criar('img', {
          src: urlMidia('assets/images/pix-qrcode.jpeg'),
          alt:
            'QR Code do Pix da Doce Fefê.21. Leia com o aplicativo do seu banco ' +
            'para pagar.',
          loading: 'eager',
        }),
      ]),

      // Aviso honesto: o QR não traz o valor preenchido.
      criar('div', { class: 'alerta alerta--aviso mt-4' }, [
        criar('span', { texto: '⚠️', 'aria-hidden': 'true' }),
        criar('div', {}, [
          criar('p', {
            class: 'sem-margem negrito',
            texto: `Digite o valor manualmente: ${moeda(pedido.total)}`,
          }),
          criar('p', {
            class: 'texto-mini sem-margem mt-1',
            texto:
              'Este QR Code não vem com o valor preenchido — confira antes de confirmar.',
          }),
        ]),
      ]),

      criar('div', { class: 'pagamento-divisor' }, [
        criar('span', { texto: 'Depois de pagar' }),
      ]),

      criarEnvioComprovante(),

      criar('button', {
        class: 'btn btn--secundario btn--bloco mt-4',
        type: 'button',
        texto: '← Escolher outra forma',
        on: { click: mostrarEscolha },
      }),
    ])
  );
}

/* =============================================================================
 * ENVIO DO COMPROVANTE
 * ========================================================================== */

function criarEnvioComprovante() {
  // --- Comprovante já enviado ---
  if (situacao?.comprovanteEnviado) {
    return criarComprovanteEnviado();
  }

  const entrada = criar('input', {
    type: 'file',
    id: 'comprovante',
    class: 'apenas-leitor-tela',
    accept: 'image/jpeg,image/png,image/webp,application/pdf',
  });

  const rotulo = criar(
    'label',
    { class: 'escolher-arquivo', for: 'comprovante' },
    [
      criar('span', { class: 'escolher-arquivo__icone', texto: '📎', 'aria-hidden': 'true' }),
      criar('span', { class: 'escolher-arquivo__texto', texto: 'Escolher comprovante' }),
      criar('span', {
        class: 'escolher-arquivo__dica',
        texto: 'Foto ou PDF, até 5 MB',
      }),
    ]
  );

  const previa = criar('div', { class: 'comprovante-previa', hidden: true });

  const botao = criar('button', {
    class: 'btn btn--primario btn--grande btn--bloco mt-4',
    type: 'button',
    texto: 'Enviar comprovante',
    disabled: true,
  });

  const erro = criar('p', { class: 'campo__erro', estilo: { display: 'block' } });

  entrada.addEventListener('change', () => {
    const arquivo = entrada.files?.[0];
    erro.textContent = '';

    if (!arquivo) {
      arquivoEscolhido = null;
      previa.hidden = true;
      botao.disabled = true;
      return;
    }

    // Validação no navegador: retorno imediato. O servidor revalida tudo,
    // inclusive a assinatura binária do arquivo.
    if (arquivo.size > 5 * 1024 * 1024) {
      erro.textContent = 'O arquivo passa de 5 MB. Tente uma foto menor.';
      arquivoEscolhido = null;
      previa.hidden = true;
      botao.disabled = true;
      return;
    }

    arquivoEscolhido = arquivo;
    botao.disabled = false;

    mostrarPrevia(previa, arquivo);
  });

  botao.addEventListener('click', () => enviarComprovante(botao, erro));

  return criar('div', { class: 'envio-comprovante' }, [
    criar('h3', { class: 'envio-comprovante__titulo', texto: 'Envie o comprovante' }),
    criar('p', {
      class: 'envio-comprovante__texto',
      texto:
        'É assim que sabemos que o pagamento entrou. Depois de conferir, ' +
        'confirmamos seu pedido.',
    }),
    entrada,
    rotulo,
    previa,
    erro,
    botao,
  ]);
}

/** Mostra uma miniatura da imagem escolhida, ou o nome do PDF. */
function mostrarPrevia(container, arquivo) {
  container.hidden = false;

  if (arquivo.type === 'application/pdf') {
    container.replaceChildren(
      criar('div', { class: 'comprovante-previa__pdf' }, [
        criar('span', { texto: '📄', 'aria-hidden': 'true' }),
        criar('span', { class: 'texto-pequeno', texto: arquivo.name }),
      ])
    );
    return;
  }

  // `createObjectURL` evita carregar a imagem inteira na memória como base64
  // só para mostrar a prévia.
  const url = URL.createObjectURL(arquivo);

  const img = criar('img', {
    src: url,
    alt: 'Prévia do comprovante escolhido',
  });

  // Libera a memória assim que a imagem é desenhada.
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });

  container.replaceChildren(img);
}

/** Converte o arquivo em base64 para enviar no corpo JSON. */
function lerComoBase64(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result));
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

async function enviarComprovante(botao, erro) {
  if (!arquivoEscolhido) return;

  botaoCarregando(botao, true);
  erro.textContent = '';

  try {
    const base64 = await lerComoBase64(arquivoEscolhido);

    await api.post(
      `/pedidos/${pedido.codigo}/comprovante`,
      {
        arquivo: base64,
        tipo: arquivoEscolhido.type,
        nome: arquivoEscolhido.name,
      },
      // Upload é mais lento que uma consulta comum.
      { timeout: 60000 }
    );

    toastSucesso('Comprovante enviado!');

    situacao = await api
      .get(`/pedidos/${pedido.codigo}/pagamento`)
      .then((r) => r.pagamento)
      .catch(() => ({ comprovanteEnviado: true, enviadoEm: new Date().toISOString() }));

    mostrarPix();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (falha) {
    console.error('[pagamento] Falha ao enviar comprovante:', falha);

    erro.textContent =
      falha instanceof ErroApi
        ? falha.message
        : 'Não conseguimos enviar. Tente novamente ou mande pelo WhatsApp.';
  } finally {
    botaoCarregando(botao, false);
  }
}

/** Estado depois do envio: o que o cliente precisa saber agora. */
function criarComprovanteEnviado() {
  const filhos = [
    criar('div', {
      class: 'comprovante-enviado__icone',
      texto: '✓',
      'aria-hidden': 'true',
    }),
    criar('h3', {
      class: 'envio-comprovante__titulo',
      texto: 'Comprovante recebido',
    }),
  ];

  if (situacao?.enviadoEm) {
    filhos.push(
      criar('p', {
        class: 'texto-mini texto-suave',
        texto: `Enviado em ${dataHora(situacao.enviadoEm)}`,
      })
    );
  }

  // A parte mais importante da tela: deixar claro que ainda falta a
  // conferência. Dizer "pagamento confirmado" aqui seria falso.
  filhos.push(
    criar('div', { class: 'alerta alerta--info mt-4' }, [
      criar('span', { texto: '🔎', 'aria-hidden': 'true' }),
      criar('div', {}, [
        criar('p', { class: 'sem-margem negrito', texto: 'Estamos conferindo' }),
        criar('p', {
          class: 'sem-margem mt-1',
          texto:
            'Seu comprovante chegou. Assim que confirmarmos o pagamento na ' +
            'conta, avisamos pelo WhatsApp e começamos a preparar seu pedido.',
        }),
      ]),
    ])
  );

  filhos.push(
    criar('a', {
      class: 'btn btn--whatsapp btn--bloco mt-5',
      href: montarLinkWhatsApp(
        `Olá! Enviei o comprovante do pedido *${pedido.codigo}*. ` +
          'Gostaria de confirmar o recebimento.'
      ),
      target: '_blank',
      rel: 'noopener noreferrer',
      texto: 'Avisar no WhatsApp',
    })
  );

  filhos.push(
    criar('button', {
      class: 'btn btn--secundario btn--bloco mt-3',
      type: 'button',
      texto: 'Enviar outro comprovante',
      on: {
        click: async () => {
          const confirmado = await confirmar(
            'Enviar outro comprovante? O anterior continuará guardado.'
          );
          if (!confirmado) return;

          situacao = { ...situacao, comprovanteEnviado: false };
          arquivoEscolhido = null;
          mostrarPix();
        },
      },
    })
  );

  return criar('div', { class: 'envio-comprovante comprovante-enviado' }, filhos);
}

/* =============================================================================
 * CARREGAMENTO
 * ========================================================================== */

async function carregar() {
  const container = $('[data-pagamento]');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const codigo = params.get('pedido');

  if (!codigo) {
    mostrarErro(
      'Pedido não informado',
      'O endereço acessado não indica qual pedido você quer pagar.'
    );
    return;
  }

  try {
    const resposta = await api.get(`/pedidos/${encodeURIComponent(codigo)}`);
    pedido = resposta.pedido;

    // Mostra o resumo do pedido ao lado.
    renderizarResumo();

    // Se já houver forma escolhida ou comprovante enviado, retoma dali.
    try {
      situacao = (await api.get(`/pedidos/${pedido.codigo}/pagamento`)).pagamento;
    } catch {
      situacao = null;
    }

    // Pedido já pago não precisa de tela de pagamento.
    if (!['aguardando_pagamento', 'comprovante_enviado'].includes(pedido.status)) {
      mostrarJaPago();
      return;
    }

    if (situacao?.comprovanteEnviado) {
      mostrarPix();
    } else if (situacao?.metodo === 'dinheiro') {
      mostrarDinheiro();
    } else if (situacao?.metodo === 'pix') {
      mostrarPix();
    } else {
      mostrarEscolha();
    }
  } catch (erro) {
    console.error('[pagamento] Falha ao carregar:', erro);

    if (erro instanceof ErroApi && erro.status === 404) {
      mostrarErro(
        'Pedido não encontrado',
        'Confira o código do pedido ou entre na sua conta.'
      );
      return;
    }

    mostrarErro(
      'Não conseguimos carregar',
      erro.message || 'Tente novamente em instantes.'
    );
  }
}

function renderizarResumo() {
  const container = $('[data-resumo-pagamento]');
  if (!container || !pedido) return;

  container.replaceChildren(
    criar('h2', { class: 'resumo__titulo', texto: 'Pedido ' + pedido.codigo }),

    ...pedido.itens.map((item) =>
      criar('div', { class: 'resumo-item' }, [
        criar('span', { class: 'resumo-item__quantidade', texto: `${item.quantidade}×` }),
        criar('span', { class: 'resumo-item__nome', texto: item.nome }),
        criar('span', { class: 'resumo-item__valor', texto: moeda(item.subtotal) }),
      ])
    ),

    criar('div', { class: 'checkout-resumo__valores' }, [
      criar('div', { class: 'resumo__linha' }, [
        criar('span', { texto: 'Subtotal' }),
        criar('span', { texto: moeda(pedido.subtotal) }),
      ]),
      criar('div', { class: 'resumo__linha' }, [
        criar('span', {
          texto: pedido.tipoEntrega === 'entrega' ? 'Entrega' : 'Retirada',
        }),
        criar('span', {
          texto: pedido.tipoEntrega === 'entrega' ? 'A combinar' : 'Sem custo',
        }),
      ]),
      criar('div', { class: 'resumo__total' }, [
        criar('span', { texto: 'Total' }),
        criar('strong', { class: 'preco preco--grande', texto: moeda(pedido.total) }),
      ]),
    ])
  );
}

function mostrarJaPago() {
  const container = $('[data-pagamento]');
  if (!container) return;

  container.replaceChildren(
    criar('div', { class: 'pagamento-passo' }, [
      criar('div', {
        class: 'pagamento-passo__icone',
        texto: '✓',
        'aria-hidden': 'true',
      }),
      criar('h2', { class: 'pagamento-passo__titulo', texto: 'Pagamento confirmado' }),
      criar('p', {
        class: 'pagamento-passo__texto',
        texto: 'Seu pedido já está confirmado. Obrigada!',
      }),
      criar('a', {
        class: 'btn btn--primario btn--bloco mt-6',
        href: rota(ROTAS.produtos),
        texto: 'Continuar comprando',
      }),
    ])
  );
}

function mostrarErro(titulo, texto) {
  const container = $('[data-pagamento]');
  if (!container) return;

  container.replaceChildren(
    criar('div', { class: 'pagamento-passo' }, [
      criar('div', {
        class: 'pagamento-passo__icone',
        texto: '🍫',
        'aria-hidden': 'true',
      }),
      criar('h2', { class: 'pagamento-passo__titulo', texto: titulo }),
      criar('p', { class: 'pagamento-passo__texto', texto }),
      criar('a', {
        class: 'btn btn--whatsapp btn--bloco mt-6',
        href: montarLinkWhatsApp('Olá! Preciso de ajuda com o pagamento de um pedido.'),
        target: '_blank',
        rel: 'noopener noreferrer',
        texto: 'Falar no WhatsApp',
      }),
      criar('a', {
        class: 'btn btn--secundario btn--bloco mt-3',
        href: rota(ROTAS.produtos),
        texto: 'Voltar aos produtos',
      }),
    ])
  );

  $('[data-resumo-pagamento]')?.setAttribute('hidden', '');
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', carregar);
} else {
  carregar();
}
