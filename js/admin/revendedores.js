/**
 * admin/revendedores.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — aprovação de parceiros.
 *
 * ⚠️ APROVAR AQUI É A AÇÃO MAIS CARA DO SISTEMA
 *   Diferente de aprovar um pagamento, que vale para um pedido, aprovar um
 *   parceiro vale para SEMPRE: todos os pedidos futuros daquela conta passam
 *   a sair com preço de atacado menos o desconto definido aqui.
 *
 *   Por isso a tela pede confirmação explícita com os números na mensagem —
 *   e por isso o desconto e o pedido mínimo são obrigatórios na aprovação,
 *   em vez de assumirem um padrão silencioso.
 *
 * O desconto incide sobre o preço de ATACADO do produto, não sobre o varejo.
 * A conta final é feita no banco, por `preco_para_usuario`.
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
  debounce,
} from '../lib/ui.js';
import { moeda, paraCentavos, data, telefone as formatarTelefone, cnpj as formatarCnpj } from '../lib/format.js';

let parceiros = [];
let statusAtual = 'pendente';
let busca = '';

const FILTROS = [
  { valor: 'pendente', rotulo: 'A analisar' },
  { valor: 'aprovado', rotulo: 'Parceiros' },
  { valor: 'suspenso', rotulo: 'Suspensos' },
  { valor: 'recusado', rotulo: 'Recusados' },
  { valor: '', rotulo: 'Todos' },
];

const SELOS = {
  pendente: ['selo--aviso', 'Em análise'],
  aprovado: ['selo--sucesso', 'Parceiro'],
  recusado: ['selo--erro', 'Recusado'],
  suspenso: ['selo--neutro', 'Suspenso'],
};

const TIPOS = {
  cafeteria: 'Cafeteria',
  padaria: 'Padaria',
  mercado: 'Mercado',
  restaurante: 'Restaurante',
  loja: 'Loja',
  eventos: 'Eventos',
  'revenda-pessoal': 'Revenda pessoal',
  outro: 'Outro',
};

const VOLUMES = {
  'ate-50': 'Até 50/mês',
  '50-100': '50 a 100/mês',
  '100-300': '100 a 300/mês',
  'mais-de-300': 'Mais de 300/mês',
  'nao-sei': 'Não sabe estimar',
};

/* =============================================================================
 * DADOS DO CANDIDATO
 * ========================================================================== */

function dado(rotulo, conteudo, largo = false) {
  return criar('div', largo ? { class: 'admin-dado--largo' } : {}, [
    criar('span', { class: 'admin-dado__rotulo', texto: rotulo }),
    conteudo,
  ]);
}

function criarDados(parceiro) {
  const linhas = [
    dado('Responsável', criar('span', { texto: parceiro.nomeResponsavel })),

    dado(
      'WhatsApp',
      criar('a', {
        href: `https://wa.me/55${parceiro.whatsapp}`,
        target: '_blank',
        rel: 'noopener noreferrer',
        texto: formatarTelefone(parceiro.whatsapp),
      })
    ),

    dado(
      'Onde fica',
      criar('span', {
        texto: `${parceiro.cidade}${parceiro.estado ? `/${parceiro.estado}` : ''}`,
      })
    ),
  ];

  if (parceiro.email) {
    linhas.push(
      dado('E-mail', criar('a', { href: `mailto:${parceiro.email}`, texto: parceiro.email }))
    );
  }

  if (parceiro.cnpj) {
    linhas.push(dado('CNPJ', criar('span', { texto: formatarCnpj(parceiro.cnpj) })));
  }

  if (parceiro.tipoEstabelecimento) {
    linhas.push(
      dado(
        'Tipo',
        criar('span', {
          texto: TIPOS[parceiro.tipoEstabelecimento] || parceiro.tipoEstabelecimento,
        })
      )
    );
  }

  if (parceiro.quantidadeEstimada) {
    linhas.push(
      dado(
        'Volume estimado',
        criar('span', {
          texto: VOLUMES[parceiro.quantidadeEstimada] || parceiro.quantidadeEstimada,
        })
      )
    );
  }

  // O que já comprou pesa mais na decisão que o que estimou comprar.
  if (parceiro.pedidos > 0) {
    linhas.push(
      dado(
        'Já comprou',
        criar('span', {
          texto: `${parceiro.pedidos} pedido(s) · ${moeda(parceiro.gasto)}`,
        })
      )
    );
  }

  if (parceiro.mensagem) {
    linhas.push(dado('Sobre o negócio', criar('span', { texto: parceiro.mensagem }), true));
  }

  return criar('div', { class: 'admin-pedido__dados' }, linhas);
}

/* =============================================================================
 * FORMULÁRIO DE APROVAÇÃO
 * ========================================================================== */

function criarAprovacao(parceiro) {
  const desconto = criar('input', {
    class: 'campo__controle campo__controle--curto',
    type: 'number',
    min: '0',
    max: '90',
    step: '1',
    value: String(parceiro.desconto || 0),
    'aria-label': `Desconto de ${parceiro.nomeEstabelecimento}`,
  });

  const minimo = criar('input', {
    class: 'campo__controle campo__controle--curto',
    type: 'text',
    inputmode: 'decimal',
    placeholder: '0,00',
    value: parceiro.pedidoMinimo ? (parceiro.pedidoMinimo / 100).toFixed(2).replace('.', ',') : '',
    'aria-label': `Pedido mínimo de ${parceiro.nomeEstabelecimento}`,
  });

  const aprovar = criar('button', {
    class: 'btn btn--primario btn--pequeno',
    type: 'button',
    texto: parceiro.status === 'aprovado' ? 'Salvar condições' : 'Aprovar parceiro',
  });

  aprovar.addEventListener('click', async () => {
    const pct = Number(desconto.value);
    const minimoCentavos = minimo.value.trim() ? paraCentavos(minimo.value) : 0;

    if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
      desconto.focus();
      toastErro('O desconto vai de 0 a 90%.');
      return;
    }

    // Os números entram na pergunta: confirmar "aprovar?" sem ver quanto é
    // seria confirmar no escuro justamente a decisão que vale para sempre.
    const confirmado = await confirmar(
      `Aprovar ${parceiro.nomeEstabelecimento} com ${pct}% de desconto sobre o ` +
        `preço de atacado` +
        (minimoCentavos > 0
          ? `, e pedido mínimo de ${moeda(minimoCentavos)}?`
          : ', sem pedido mínimo?') +
        '\n\nIsso vale para todos os pedidos futuros desta conta.'
    );

    if (!confirmado) return;

    decidir(
      parceiro,
      { status: 'aprovado', desconto: pct, pedidoMinimo: minimoCentavos },
      aprovar
    );
  });

  return criar('div', { class: 'admin-conferencia mt-4' }, [
    criar('p', {
      class: 'texto-mini negrito',
      texto: 'Condições comerciais',
    }),

    criar('div', { class: 'admin-config' }, [
      criar('label', { class: 'texto-mini', texto: 'Desconto sobre o atacado' }),
      desconto,
      criar('span', { class: 'texto-mini', texto: '%' }),

      criar('label', { class: 'texto-mini', texto: 'Pedido mínimo R$' }),
      minimo,

      aprovar,
    ]),

    criar('p', {
      class: 'campo__ajuda',
      texto:
        'O desconto incide sobre o preço de atacado de cada produto. ' +
        'Pedido mínimo vazio significa sem mínimo.',
    }),
  ]);
}

function criarRecusa(parceiro) {
  const motivo = criar('input', {
    class: 'campo__controle',
    type: 'text',
    maxlength: '500',
    placeholder: 'Motivo da recusa (a pessoa vai ler)',
    'aria-label': `Motivo da recusa de ${parceiro.nomeEstabelecimento}`,
  });

  const recusar = criar('button', {
    class: 'btn btn--secundario btn--pequeno',
    type: 'button',
    texto: 'Recusar',
    on: {
      click: () => {
        if (motivo.value.trim().length < 3) {
          motivo.focus();
          toastErro('Explique o motivo — a pessoa precisa saber o que corrigir.');
          return;
        }

        decidir(parceiro, { status: 'recusado', motivo: motivo.value }, recusar);
      },
    },
  });

  return criar('div', { class: 'mt-4' }, [motivo, criar('div', { class: 'mt-2' }, [recusar])]);
}

function criarAcoes(parceiro) {
  const filhos = [];

  // Pendente, recusado e suspenso podem virar parceiro. Aprovado também vê o
  // formulário — é como se ajustam as condições de quem já é parceiro.
  filhos.push(criarAprovacao(parceiro));

  if (parceiro.status === 'aprovado') {
    filhos.push(
      criar('div', { class: 'admin-avanco mt-4' }, [
        criar('p', { class: 'texto-mini negrito', texto: 'Encerrar a parceria' }),
        criar('div', { class: 'flex gap-2 quebrar mt-2' }, [
          criar('button', {
            class: 'btn btn--secundario btn--pequeno',
            type: 'button',
            texto: 'Suspender',
            on: {
              click: async (evento) => {
                const confirmado = await confirmar(
                  `Suspender ${parceiro.nomeEstabelecimento}? Os pedidos dele ` +
                    'voltam a sair pelo preço de varejo.'
                );
                if (!confirmado) return;

                decidir(parceiro, { status: 'suspenso' }, evento.currentTarget);
              },
            },
          }),
        ]),
      ])
    );
  }

  if (parceiro.status === 'pendente') {
    filhos.push(criarRecusa(parceiro));
  }

  return filhos;
}

/* =============================================================================
 * CARTÃO
 * ========================================================================== */

function criarCartao(parceiro) {
  const [classeSelo, rotuloSelo] = SELOS[parceiro.status] || SELOS.pendente;

  const filhos = [
    criar('div', { class: 'admin-pedido__cabecalho' }, [
      criar('div', {}, [
        criar('span', {
          class: 'admin-pedido__codigo',
          texto: parceiro.nomeEstabelecimento,
        }),
        criar('span', {
          class: 'admin-pedido__data',
          texto: `Candidatura em ${data(parceiro.criadoEm)}`,
        }),
      ]),
      criar('span', { class: `selo ${classeSelo}`, texto: rotuloSelo }),
    ]),

    criarDados(parceiro),
  ];

  if (parceiro.status === 'aprovado') {
    filhos.push(
      criar('div', { class: 'alerta alerta--sucesso' }, [
        icone('verificado'),
        criar('p', {
          class: 'sem-margem',
          texto:
            `${parceiro.desconto}% sobre o atacado` +
            (parceiro.pedidoMinimo > 0
              ? ` · mínimo de ${moeda(parceiro.pedidoMinimo)} por pedido`
              : ' · sem pedido mínimo') +
            (parceiro.aprovadoEm ? ` · desde ${data(parceiro.aprovadoEm)}` : ''),
        }),
      ])
    );
  }

  if (parceiro.status === 'recusado' && parceiro.motivoRecusa) {
    filhos.push(
      criar('div', { class: 'alerta alerta--aviso' }, [
        icone('alerta'),
        criar('p', { class: 'sem-margem', texto: `Recusado: ${parceiro.motivoRecusa}` }),
      ])
    );
  }

  filhos.push(...criarAcoes(parceiro));

  return criar('article', { class: 'admin-pedido', dataset: { id: parceiro.id } }, filhos);
}

/* =============================================================================
 * AÇÕES
 * ========================================================================== */

async function decidir(parceiro, decisao, botao) {
  botaoCarregando(botao, true);

  try {
    const resposta = await api.patch(`/admin/revendedores/${parceiro.id}`, decisao);

    toastSucesso(resposta.mensagem);
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos registrar a decisão.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * LISTA
 * ========================================================================== */

function renderizarFiltros() {
  const container = $('[data-filtros-status]');
  if (!container) return;

  container.replaceChildren(
    ...FILTROS.map((f) =>
      criar('button', {
        class: `filtro-chip${statusAtual === f.valor ? ' filtro-chip--ativo' : ''}`,
        type: 'button',
        texto: f.rotulo,
        on: {
          click: () => {
            statusAtual = f.valor;
            carregar();
          },
        },
      })
    )
  );
}

function renderizarResumo(resumo) {
  const container = $('[data-resumo-parceiros]');
  if (!container) return;

  const metrica = (rotulo, valor, destaque = false) =>
    criar('div', { class: `admin-metrica${destaque ? ' admin-metrica--destaque' : ''}` }, [
      criar('span', { class: 'admin-metrica__valor', texto: String(valor) }),
      criar('span', { class: 'admin-metrica__rotulo', texto: rotulo }),
    ]);

  container.replaceChildren(
    metrica('A analisar', resumo.pendentes, resumo.pendentes > 0),
    metrica('Parceiros ativos', resumo.aprovados),
    metrica('Nesta lista', resumo.total)
  );
}

function renderizarLista() {
  const lista = $('[data-lista-parceiros]');
  if (!lista) return;

  if (parceiros.length === 0) {
    renderizarEstadoVazio(lista, {
      icone: statusAtual === 'pendente' ? 'verificado' : 'parceiros',
      titulo:
        statusAtual === 'pendente'
          ? 'Nenhuma candidatura esperando'
          : 'Ninguém por aqui',
      texto:
        statusAtual === 'pendente'
          ? 'Tudo analisado. Novas candidaturas aparecem aqui.'
          : 'Experimente outro filtro.',
    });
    return;
  }

  lista.replaceChildren(...parceiros.map(criarCartao));
}

async function carregar() {
  const lista = $('[data-lista-parceiros]');

  lista?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const resposta = await api.get('/admin/revendedores', {
      status: statusAtual,
      busca,
    });

    parceiros = resposta.revendedores;

    renderizarFiltros();
    renderizarResumo(resposta.resumo);
    renderizarLista();
  } catch (erro) {
    console.error('[admin] Falha ao carregar parceiros:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(lista, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar os parceiros',
      texto: erro.message || 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregar },
    });
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarPainel({
    titulo: 'Parceiros de revenda',
    aoEntrar: () => {
      $('[data-busca]')?.addEventListener(
        'input',
        debounce((evento) => {
          busca = evento.target.value;
          carregar();
        }, 400)
      );

      carregar();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
