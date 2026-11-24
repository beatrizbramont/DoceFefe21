/**
 * revendedor.js
 * -----------------------------------------------------------------------------
 * Página Seja Revendedor: candidatura e acompanhamento.
 *
 * ⚠️ ESTA PÁGINA NÃO CONCEDE DESCONTO NENHUM
 *   O formulário cria uma candidatura `pendente`. Quem aprova é a loja, pelo
 *   painel — e é só a aprovação que muda preço. Mesmo que alguém mande
 *   `status: "aprovado"` no corpo da requisição, o servidor não lê esse campo
 *   (ver services/reseller-service.js).
 *
 * POR QUE EXIGE CONTA
 *   A candidatura fica vinculada ao `usuario_id`, e é por ele que a pessoa
 *   consulta depois em que pé está o cadastro. Sem conta, a candidatura
 *   seria um formulário que a própria candidata não consegue acompanhar.
 *
 * SOBRE PREÇO
 *   Esta página não promete preço nenhum. A loja não trabalha com tabela de
 *   atacado automática: valores e quantidades são combinados por WhatsApp,
 *   caso a caso, depois da aprovação.
 */

import { api } from './lib/api.js';
import { iniciarAutenticacao, estaLogado } from './auth.js';
import {
  $,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  aplicarErrosServidor,
  limparErrosFormulario,
} from './lib/ui.js';
import { data, somenteDigitos } from './lib/format.js';
import { icone } from './components/icons.js';
import { montarLinkWhatsApp } from './whatsapp.js';

/* =============================================================================
 * ESTADOS DA CANDIDATURA
 * ========================================================================== */

const SITUACOES = {
  pendente: {
    classe: '',
    icone: 'relogio',
    titulo: 'Candidatura em análise',
    texto:
      'Recebemos seu cadastro. Vamos conferir os dados e chamar no seu ' +
      'WhatsApp para combinar as condições.',
  },
  aprovado: {
    classe: 'situacao-revenda--aprovado',
    icone: 'parceria',
    titulo: 'Você é nosso parceiro!',
    texto:
      'Seu cadastro está aprovado. Fale com a gente pelo WhatsApp para fazer ' +
      'seus pedidos e combinar as condições.',
  },
  recusado: {
    classe: 'situacao-revenda--recusado',
    icone: 'recusar',
    titulo: 'Candidatura não aprovada desta vez',
    texto: 'Você pode corrigir os dados e enviar de novo.',
  },
  suspenso: {
    classe: 'situacao-revenda--suspenso',
    icone: '!',
    titulo: 'Parceria suspensa',
    texto:
      'Seus pedidos voltaram ao preço de varejo. Fale com a gente pelo ' +
      'WhatsApp para entender o que houve.',
  },
};

/* =============================================================================
 * BLOCO DE SITUAÇÃO
 * ========================================================================== */

/*
  NÃO HÁ BLOCO DE CONDIÇÕES COMERCIAIS AQUI

  Existia um quadro mostrando "X% de desconto" e "pedido mínimo de R$ Y" para
  quem fosse aprovado. Saiu junto com a decisão da loja de não trabalhar com
  tabela de atacado automática: valores, quantidades e prazos são combinados
  por WhatsApp, caso a caso.

  Mostrar "0% de desconto · sem mínimo" seria pior que não mostrar nada —
  pareceria uma condição ruim em vez da ausência de uma regra fixa.
*/

function renderizarSituacao(candidatura) {
  const container = $('[data-situacao-revenda]');
  if (!container || !candidatura) return;

  const situacao = SITUACOES[candidatura.status] || SITUACOES.pendente;

  const filhos = [
    criar('div', { class: 'flex gap-3 itens-centro' }, [
      icone(situacao.icone, 'situacao-revenda__icone'),
      criar('h2', { class: 'situacao-revenda__titulo sem-margem', texto: situacao.titulo }),
    ]),
    criar('p', { class: 'mt-3', texto: situacao.texto }),
    criar('p', {
      class: 'texto-mini texto-suave',
      texto:
        `${candidatura.nomeEstabelecimento} · ${candidatura.cidade}` +
        `${candidatura.estado ? `/${candidatura.estado}` : ''}` +
        ` · enviada em ${data(candidatura.criadoEm)}`,
    }),
  ];

  // O motivo da recusa é dado da pessoa, não segredo da loja: quem foi
  // recusado precisa saber o que corrigir antes de tentar de novo.
  if (candidatura.status === 'recusado' && candidatura.motivoRecusa) {
    filhos.push(
      criar('div', { class: 'alerta alerta--aviso mt-4' }, [
        icone('alerta'),
        criar('p', { class: 'sem-margem', texto: candidatura.motivoRecusa }),
      ])
    );
  }

  if (candidatura.status === 'aprovado') {
    filhos.push(
      criar('a', {
        class: 'btn btn--whatsapp mt-5',
        href: montarLinkWhatsApp(
          `Olá! Sou parceiro da Doce Fefê.21 (${candidatura.nomeEstabelecimento}) ` +
            'e gostaria de fazer um pedido.'
        ),
        target: '_blank',
        rel: 'noopener noreferrer',
        texto: 'Fazer pedido pelo WhatsApp',
      })
    );
  }

  container.replaceChildren(
    criar('div', { class: `situacao-revenda ${situacao.classe}` }, filhos)
  );
}

/* =============================================================================
 * AVISO PARA QUEM NÃO ENTROU
 * ========================================================================== */

function pedirLogin() {
  const area = $('[data-area-formulario]');
  if (!area) return;

  area.replaceChildren(
    criar('div', { class: 'situacao-revenda' }, [
      criar('h2', {
        class: 'situacao-revenda__titulo',
        texto: 'Entre na sua conta para se candidatar',
      }),
      criar('p', {
        texto:
          'A candidatura fica vinculada à sua conta — é por ela que a gente ' +
          'acompanha sua parceria e você consulta a situação do cadastro. ' +
          'Criar leva um minuto.',
      }),
      criar('div', { class: 'flex gap-3 quebrar mt-5' }, [
        criar('a', {
          class: 'btn btn--primario',
          href: './minha-conta.html',
          texto: 'Entrar ou criar conta',
        }),
        criar('a', {
          class: 'btn btn--secundario',
          href: './contato.html',
          texto: 'Falar com a gente antes',
        }),
      ]),
    ])
  );
}

/* =============================================================================
 * ENVIO
 * ========================================================================== */

function lerFormulario(formulario) {
  const campos = formulario.elements;
  const valor = (nome) => campos[nome]?.value?.trim() ?? '';

  return {
    nomeResponsavel: valor('nomeResponsavel'),
    nomeEstabelecimento: valor('nomeEstabelecimento'),
    // A máscara deixa pontuação no campo; o servidor quer só os números.
    whatsapp: somenteDigitos(valor('whatsapp')),
    cnpj: somenteDigitos(valor('cnpj')),
    tipoEstabelecimento: valor('tipoEstabelecimento'),
    cidade: valor('cidade'),
    estado: valor('estado'),
    quantidadeEstimada: valor('quantidadeEstimada'),
    mensagem: valor('mensagem'),
    consentimento: Boolean(campos.consentimento?.checked),
  };
}

async function enviar(formulario) {
  const botao = $('[type="submit"]', formulario);

  limparErrosFormulario(formulario);
  botaoCarregando(botao, true);

  try {
    const resposta = await api.post('/revendedores', lerFormulario(formulario));

    toastSucesso(resposta.mensagem);

    renderizarSituacao(resposta.candidatura);
    $('[data-area-formulario]')?.replaceChildren();

    $('[data-situacao-revenda]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  } catch (erro) {
    if (erro.erros) aplicarErrosServidor(formulario, erro.erros);

    toastErro(erro.message || 'Não conseguimos enviar sua candidatura.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * ESTADOS DO BRASIL
 *
 * Preenchidos aqui em vez de 27 <option> no HTML: a lista é a mesma do
 * servidor, que é quem recusa um valor inventado.
 * ========================================================================== */

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
];

function preencherEstados() {
  const select = $('[data-ufs]');
  if (!select) return;

  select.replaceChildren(
    criar('option', { value: '', texto: 'UF' }),
    ...UFS.map((uf) => criar('option', { value: uf, texto: uf }))
  );
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

async function iniciar() {
  const formulario = $('[data-formulario-revenda]');
  if (!formulario) return;

  preencherEstados();

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviar(formulario);
  });

  // A sessão guardada precisa valer antes da primeira chamada à API. `main.js`
  // também faz isso; chamar de novo é barato e elimina a ordem de carga entre
  // os dois módulos como fonte de bug.
  await iniciarAutenticacao();

  if (!estaLogado()) {
    pedirLogin();
    return;
  }

  try {
    const { candidatura } = await api.get('/revendedores/eu');

    if (!candidatura) return;

    renderizarSituacao(candidatura);

    // Recusada: o formulário continua à mostra, já que reenviar reabre a
    // análise. Nos demais estados não há o que enviar de novo.
    if (candidatura.status !== 'recusado') {
      $('[data-area-formulario]')?.replaceChildren();
    }
  } catch (erro) {
    // Falha ao consultar não pode esconder o formulário: na dúvida, deixa a
    // pessoa se candidatar. O servidor recusa a duplicata com uma mensagem
    // clara se já houver cadastro.
    console.error('[revenda] Não foi possível consultar a candidatura:', erro);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
