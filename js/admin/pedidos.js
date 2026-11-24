/**
 * admin/pedidos.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — conferência de pedidos e pagamentos.
 *
 * O QUE ESTA TELA RESOLVE
 *   O cliente paga o Pix e envia o comprovante. Alguém precisa abrir o
 *   arquivo — guardado em bucket privado —, comparar com o extrato e decidir.
 *   É a única ação do sistema que transforma "o cliente diz que pagou" em
 *   "a loja confirmou que recebeu".
 *
 * ⚠️ A INTERFACE NÃO É A PROTEÇÃO
 *   Esconder esta tela de quem não é administrador é conveniência. A barreira
 *   real está no servidor: toda rota /api/admin/* passa por `exigirAdmin`,
 *   que confere o perfil no banco. Chamar a API direto não adianta.
 *
 * Login, cabeçalho e menu ficam em admin/sessao.js, compartilhados com as
 * outras telas do painel.
 */

import { iniciarPainel, tratarErroDeSessao } from './sessao.js';
import { api } from '../lib/api.js';
import { icone } from '../components/icons.js';
import {
  $,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  renderizarEstadoVazio,
  confirmar,
} from '../lib/ui.js';
import { moeda, dataHora, telefone as formatarTelefone } from '../lib/format.js';
import { descreverStatus, ROTULOS_ETAPAS } from '../lib/status-pedido.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

let filtroAtual = 'comprovante_enviado';
let pedidos = [];

/** Próximos status possíveis, para os botões de avanço. */
const PROXIMOS_STATUS = {
  pagamento_aprovado: ['em_preparacao', 'cancelado'],
  em_preparacao: ['pronto_para_retirada', 'saiu_para_entrega', 'cancelado'],
  pronto_para_retirada: ['entregue', 'cancelado'],
  saiu_para_entrega: ['entregue', 'cancelado'],
};

/* =============================================================================
 * CARD DE PEDIDO
 * ========================================================================== */

function criarItens(pedido) {
  return criar(
    'ul',
    { class: 'admin-pedido__itens' },
    pedido.itens.map((item) =>
      criar('li', {}, [
        criar('span', { class: 'admin-pedido__qtd', texto: `${item.quantidade}×` }),
        criar('span', { texto: item.nome }),
        criar('strong', { texto: moeda(item.subtotal) }),
      ])
    )
  );
}

function criarDadosCliente(pedido) {
  const linhas = [
    criar('div', {}, [
      criar('span', { class: 'admin-dado__rotulo', texto: 'Cliente' }),
      criar('span', { texto: pedido.cliente.nome }),
    ]),
    criar('div', {}, [
      criar('span', { class: 'admin-dado__rotulo', texto: 'WhatsApp' }),
      criar('a', {
        href: `https://wa.me/55${pedido.cliente.whatsapp}`,
        target: '_blank',
        rel: 'noopener noreferrer',
        texto: formatarTelefone(pedido.cliente.whatsapp),
      }),
    ]),
    criar('div', {}, [
      criar('span', { class: 'admin-dado__rotulo', texto: 'Entrega' }),
      criar('span', {
        texto: pedido.tipoEntrega === 'entrega' ? 'Entrega' : 'Retirada',
      }),
    ]),
  ];

  if (pedido.endereco) {
    const e = pedido.endereco;
    linhas.push(
      criar('div', { class: 'admin-dado--largo' }, [
        criar('span', { class: 'admin-dado__rotulo', texto: 'Endereço' }),
        criar('span', {
          texto:
            `${e.logradouro}, ${e.numero}` +
            `${e.complemento ? ` — ${e.complemento}` : ''}` +
            ` · ${e.bairro}, ${e.cidade}/${e.estado} · CEP ${e.cep}` +
            `${e.referencia ? ` · Ref: ${e.referencia}` : ''}`,
        }),
      ])
    );
  }

  if (pedido.dataDesejada) {
    linhas.push(
      criar('div', {}, [
        criar('span', { class: 'admin-dado__rotulo', texto: 'Data desejada' }),
        criar('span', { texto: pedido.dataDesejada.split('-').reverse().join('/') }),
      ])
    );
  }

  if (pedido.observacoes) {
    linhas.push(
      criar('div', { class: 'admin-dado--largo' }, [
        criar('span', { class: 'admin-dado__rotulo', texto: 'Observações' }),
        criar('span', { texto: pedido.observacoes }),
      ])
    );
  }

  return criar('div', { class: 'admin-pedido__dados' }, linhas);
}

/** Bloco de conferência do comprovante. */
function criarConferencia(pedido) {
  const pagamento = pedido.pagamento;

  if (!pagamento) {
    return criar('p', {
      class: 'texto-pequeno texto-suave',
      texto: 'O cliente ainda não escolheu a forma de pagamento.',
    });
  }

  const filhos = [
    criar('div', { class: 'admin-pagamento__topo' }, [
      criar('span', {
        class: 'selo selo--neutro',
        texto: pagamento.metodo === 'pix' ? 'Pix' : 'Dinheiro',
      }),
      pagamento.enviadoEm
        ? criar('span', {
            class: 'texto-mini texto-suave',
            texto: `Comprovante enviado em ${dataHora(pagamento.enviadoEm)}`,
          })
        : null,
    ]),
  ];

  // --- Dinheiro: não há comprovante para conferir ---
  if (pagamento.metodo === 'dinheiro') {
    filhos.push(
      criar('p', {
        class: 'texto-pequeno texto-suave mt-2',
        texto: 'Pagamento combinado pelo WhatsApp. Aprove quando receber.',
      })
    );
  }

  // --- Comprovante disponível ---
  if (pagamento.temComprovante) {
    const area = criar('div', { class: 'comprovante-area' });

    const botaoVer = criar(
      'button',
      {
        class: 'btn btn--secundario btn--pequeno',
        type: 'button',
        on: { click: (e) => abrirComprovante(pedido.codigo, area, e.currentTarget) },
      },
      [icone('busca'), 'Ver comprovante']
    );

    filhos.push(criar('div', { class: 'mt-3' }, [botaoVer]), area);
  }

  // --- Já conferido ---
  if (pagamento.conferidoEm) {
    filhos.push(
      criar('div', { class: 'alerta alerta--sucesso mt-3' }, [
        icone('verificado'),
        criar('p', {
          class: 'sem-margem',
          texto: `Conferido em ${dataHora(pagamento.conferidoEm)}`,
        }),
      ])
    );

    return criar('div', { class: 'admin-pagamento' }, filhos);
  }

  // --- Observação de recusa anterior ---
  if (pagamento.observacao && !pagamento.conferidoEm) {
    filhos.push(
      criar('div', { class: 'alerta alerta--aviso mt-3' }, [
        icone('alerta'),
        criar('p', {
          class: 'sem-margem',
          texto: `Recusado antes: ${pagamento.observacao}`,
        }),
      ])
    );
  }

  // --- Botões de decisão ---
  // Só aparecem para pedidos que ainda aguardam pagamento.
  if (['aguardando_pagamento', 'comprovante_enviado'].includes(pedido.status)) {
    filhos.push(criarBotoesConferencia(pedido));
  }

  return criar('div', { class: 'admin-pagamento' }, filhos);
}

function criarBotoesConferencia(pedido) {
  /*
    QUANDO NÃO HÁ COMPROVANTE, O MOTIVO VIRA OBRIGATÓRIO PARA APROVAR

    O cliente pode ter pago o Pix e avisado por fora, sem subir o print.
    Aprovar assim é legítimo — e é a palavra da loja sustentando a decisão,
    então precisa ficar escrito. O banco cobra o mesmo (ver o arquivo 16).

    Dinheiro fica de fora: nunca houve comprovante a enviar.
  */
  const semComprovante =
    pedido.pagamento && !pedido.pagamento.temComprovante;
  const exigeJustificativa = semComprovante && pedido.pagamento.metodo !== 'dinheiro';

  const observacao = criar('input', {
    class: 'campo__controle',
    type: 'text',
    placeholder: exigeJustificativa
      ? 'Como você confirmou? Ex.: "conferido no extrato" (obrigatório)'
      : 'Motivo da recusa (obrigatório ao recusar)',
    maxlength: '500',
    'aria-label': exigeJustificativa
      ? 'Como o pagamento foi confirmado, ou motivo da recusa'
      : 'Motivo da recusa',
  });

  const aprovar = criar(
    'button',
    { class: 'btn btn--primario btn--pequeno', type: 'button' },
    [icone('verificado'), 'Aprovar pagamento']
  );

  const recusar = criar(
    'button',
    { class: 'btn btn--secundario btn--pequeno', type: 'button' },
    [icone('recusar'), 'Recusar']
  );

  aprovar.addEventListener('click', async () => {
    if (exigeJustificativa && observacao.value.trim().length < 3) {
      observacao.focus();
      toastErro('Sem comprovante anexado, escreva como você confirmou o pagamento.');
      return;
    }

    const confirmado = await confirmar(
      `Confirmar que o pagamento de ${moeda(pedido.total)} do pedido ` +
        `${pedido.codigo} entrou na conta?`
    );
    if (!confirmado) return;

    conferir(pedido.codigo, true, observacao.value, aprovar);
  });

  recusar.addEventListener('click', () => {
    if (observacao.value.trim().length < 3) {
      observacao.focus();
      toastErro('Explique o motivo da recusa — o cliente precisa saber.');
      return;
    }

    conferir(pedido.codigo, false, observacao.value, recusar);
  });

  const filhos = [];

  if (exigeJustificativa) {
    filhos.push(
      criar('div', { class: 'alerta alerta--aviso' }, [
        icone('alerta'),
        criar('p', {
          class: 'sem-margem',
          texto:
            'O cliente não enviou comprovante. Para aprovar, escreva abaixo ' +
            'como você confirmou que o dinheiro entrou.',
        }),
      ])
    );
  } else {
    filhos.push(
      criar('p', {
        class: 'texto-mini negrito',
        texto: 'Confira o valor e a data no extrato antes de aprovar.',
      })
    );
  }

  filhos.push(observacao, criar('div', { class: 'flex gap-2 quebrar mt-3' }, [aprovar, recusar]));

  return criar('div', { class: 'admin-conferencia mt-4' }, filhos);
}

/** Botões para avançar o pedido depois do pagamento aprovado. */
function criarAvancoStatus(pedido) {
  const proximos = PROXIMOS_STATUS[pedido.status];
  if (!proximos || proximos.length === 0) return null;

  // Retirada não passa por "saiu para entrega", e vice-versa.
  const filtrados = proximos.filter((s) => {
    if (s === 'pronto_para_retirada') return pedido.tipoEntrega === 'retirada';
    if (s === 'saiu_para_entrega') return pedido.tipoEntrega === 'entrega';
    return true;
  });

  return criar('div', { class: 'admin-avanco mt-4' }, [
    criar('p', { class: 'texto-mini negrito', texto: 'Avançar pedido' }),
    criar(
      'div',
      { class: 'flex gap-2 quebrar mt-2' },
      filtrados.map((status) =>
        criar('button', {
          class: `btn btn--pequeno ${
            status === 'cancelado' ? 'btn--secundario' : 'btn--primario'
          }`,
          type: 'button',
          texto: ROTULOS_ETAPAS[status],
          on: {
            click: async (evento) => {
              const confirmado = await confirmar(
                `Mudar o pedido ${pedido.codigo} para "${ROTULOS_ETAPAS[status]}"?`
              );
              if (!confirmado) return;

              mudarStatus(pedido.codigo, status, evento.currentTarget);
            },
          },
        })
      )
    ),
  ]);
}

function criarCardPedido(pedido) {
  const status = descreverStatus(pedido.status);

  const filhos = [
    criar('div', { class: 'admin-pedido__cabecalho' }, [
      criar('div', {}, [
        criar('span', { class: 'admin-pedido__codigo', texto: pedido.codigo }),
        criar('span', {
          class: 'admin-pedido__data',
          texto: dataHora(pedido.criadoEm),
        }),
      ]),
      criar('span', { class: `selo ${status.classe}`, texto: status.rotulo }),
    ]),

    criarDadosCliente(pedido),
    criarItens(pedido),

    criar('div', { class: 'admin-pedido__total' }, [
      criar('span', { texto: 'Total' }),
      criar('strong', { class: 'preco', texto: moeda(pedido.total) }),
    ]),

    criarConferencia(pedido),
  ];

  const avanco = criarAvancoStatus(pedido);
  if (avanco) filhos.push(avanco);

  return criar(
    'article',
    { class: 'admin-pedido', dataset: { codigo: pedido.codigo } },
    filhos
  );
}

/* =============================================================================
 * AÇÕES
 * ========================================================================== */

async function abrirComprovante(codigo, area, botao) {
  botaoCarregando(botao, true);

  try {
    const { url, nomeArquivo } = await api.get(`/admin/pedidos/${codigo}/comprovante`);

    const ehPdf = String(nomeArquivo || '').toLowerCase().endsWith('.pdf');

    area.replaceChildren(
      criar('div', { class: 'comprovante-visor' }, [
        ehPdf
          ? criar(
              'a',
              {
                class: 'btn btn--primario btn--pequeno',
                href: url,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              [icone('documento'), 'Abrir PDF']
            )
          : criar('img', {
              src: url,
              alt: `Comprovante do pedido ${codigo}`,
              loading: 'lazy',
            }),
      ]),
      criar('p', {
        class: 'texto-mini texto-suave mt-2',
        texto: 'Este link expira em 5 minutos.',
      })
    );
  } catch (erro) {
    toastErro(erro.message || 'Não conseguimos abrir o comprovante.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function conferir(codigo, aprovado, observacao, botao) {
  botaoCarregando(botao, true);

  try {
    const resposta = await api.post(`/admin/pedidos/${codigo}/conferir`, {
      aprovado,
      observacao,
    });

    toastSucesso(resposta.mensagem);
    await carregarPedidos();
  } catch (erro) {
    toastErro(erro.message || 'Não conseguimos registrar a conferência.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function mudarStatus(codigo, status, botao) {
  botaoCarregando(botao, true);

  try {
    const resposta = await api.patch(`/admin/pedidos/${codigo}/status`, { status });
    toastSucesso(resposta.mensagem);
    await carregarPedidos();
  } catch (erro) {
    toastErro(erro.message || 'Não conseguimos alterar o status.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * LISTA
 * ========================================================================== */

const FILTROS = [
  { valor: 'comprovante_enviado', rotulo: 'A conferir' },
  { valor: 'aguardando_pagamento', rotulo: 'Aguardando pagamento' },
  { valor: 'pagamento_aprovado', rotulo: 'Pagos' },
  { valor: 'em_preparacao', rotulo: 'Em preparação' },
  { valor: '', rotulo: 'Todos' },
];

function montarFiltros() {
  const container = $('[data-filtros-admin]');
  if (!container) return;

  container.replaceChildren(
    ...FILTROS.map((f) =>
      criar('button', {
        class: `filtro-chip${filtroAtual === f.valor ? ' filtro-chip--ativo' : ''}`,
        type: 'button',
        texto: f.rotulo,
        dataset: { filtro: f.valor },
        on: {
          click: () => {
            filtroAtual = f.valor;
            montarFiltros();
            carregarPedidos();
          },
        },
      })
    )
  );
}

function renderizarResumo(resumo) {
  const container = $('[data-resumo-admin]');
  if (!container || !resumo) return;

  container.replaceChildren(
    ...[
      { rotulo: 'A conferir', valor: resumo.aguardandoConferencia, destaque: true },
      { rotulo: 'Aguardando pagamento', valor: resumo.aguardandoPagamento },
      { rotulo: 'Em preparação', valor: resumo.emPreparacao },
    ].map((item) =>
      criar(
        'div',
        { class: `admin-metrica${item.destaque ? ' admin-metrica--destaque' : ''}` },
        [
          criar('span', { class: 'admin-metrica__valor', texto: String(item.valor) }),
          criar('span', { class: 'admin-metrica__rotulo', texto: item.rotulo }),
        ]
      )
    )
  );
}

async function carregarPedidos() {
  const lista = $('[data-lista-admin]');
  if (!lista) return;

  lista.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const resposta = await api.get('/admin/pedidos', {
      status: filtroAtual,
      limite: 100,
    });

    pedidos = resposta.pedidos;
    renderizarResumo(resposta.resumo);

    if (pedidos.length === 0) {
      renderizarEstadoVazio(lista, {
        icone: filtroAtual === 'comprovante_enviado' ? 'verificado' : 'caixa',
        titulo:
          filtroAtual === 'comprovante_enviado'
            ? 'Nenhum comprovante para conferir'
            : 'Nenhum pedido aqui',
        texto:
          filtroAtual === 'comprovante_enviado'
            ? 'Tudo em dia! Quando um cliente enviar comprovante, ele aparece aqui.'
            : 'Experimente outro filtro.',
      });
      return;
    }

    lista.replaceChildren(...pedidos.map(criarCardPedido));
  } catch (erro) {
    console.error('[admin] Falha ao carregar pedidos:', erro);

    // Sessão vencida ou sem permissão: a casca fecha o painel sozinha.
    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(lista, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar os pedidos',
      texto: erro.message || 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregarPedidos },
    });
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarPainel({
    titulo: 'Pedidos e pagamentos',
    aoEntrar: () => {
      montarFiltros();
      carregarPedidos();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
