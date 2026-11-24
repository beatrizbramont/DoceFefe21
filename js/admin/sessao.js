/**
 * admin/sessao.js
 * -----------------------------------------------------------------------------
 * A casca do painel administrativo: tela de login, cabeçalho e menu.
 *
 * POR QUE LOGIN E MENU SÃO GERADOS POR JAVASCRIPT
 *   São cinco telas administrativas. Copiar o formulário de login e o menu em
 *   cada arquivo .html significaria cinco edições a cada mudança — e uma
 *   delas sempre ficaria para trás. É a mesma decisão já tomada para o
 *   cabeçalho do site público, em js/components/site-header.js.
 *
 *   Cada página do painel declara apenas os pontos de montagem:
 *
 *       <div data-admin-login></div>
 *       <div data-admin-painel hidden>
 *         <div data-admin-topo></div>
 *         <div class="admin-conteudo"> ... conteúdo da tela ... </div>
 *       </div>
 *
 * ⚠️ ESCONDER A TELA NÃO É A PROTEÇÃO
 *   Tudo neste arquivo é conveniência: mostrar o login para quem não entrou,
 *   esconder o painel de quem não é administrador. A barreira real está no
 *   servidor — toda rota /api/admin/* passa por `exigirAdmin`, que confere o
 *   perfil no banco. Chamar a API direto, sem passar por esta tela, não
 *   adianta nada.
 */

import {
  entrar,
  sair,
  estaLogado,
  iniciarAutenticacao,
  autenticacaoDisponivel,
  ErroAuth,
} from '../auth.js';
import { api, ErroApi } from '../lib/api.js';
import {
  $,
  $$,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  marcarErroCampo,
  limparErrosFormulario,
} from '../lib/ui.js';

/* =============================================================================
 * MENU
 *
 * Só entram as telas que existem. Cupons e relatórios (Fase 11) ficam de fora
 * até serem construídos: menu que leva a uma página "em construção" é
 * promessa quebrada a cada clique.
 * ========================================================================== */

const TELAS = [
  { arquivo: 'dashboard.html', rotulo: 'Visão geral', icone: '📊' },
  { arquivo: 'pedidos.html', rotulo: 'Pedidos', icone: '🧾' },
  { arquivo: 'produtos.html', rotulo: 'Produtos', icone: '🍫' },
  { arquivo: 'estoque.html', rotulo: 'Estoque', icone: '📦' },
  { arquivo: 'clientes.html', rotulo: 'Clientes', icone: '👥' },
  { arquivo: 'revendedores.html', rotulo: 'Parceiros', icone: '🤝' },
];

/** Nome do arquivo .html aberto agora. */
function paginaAtual() {
  const partes = window.location.pathname.split('/');
  return partes[partes.length - 1] || 'dashboard.html';
}

/* =============================================================================
 * TELA DE LOGIN
 * ========================================================================== */

function montarLogin(aoEnviar) {
  const campo = (id, rotulo, tipo, autocomplete) =>
    criar('div', { class: 'campo' }, [
      criar('label', { class: 'campo__rotulo', for: id, texto: rotulo }),
      criar('input', {
        type: tipo,
        id,
        name: id.replace('admin-', ''),
        autocomplete,
        required: true,
        ...(tipo === 'email' ? { placeholder: 'seu@email.com' } : {}),
      }),
      criar('span', { class: 'campo__erro' }),
    ]);

  /*
    `method="post"` não é a forma de envio — o JavaScript intercepta o submit.
    Ele existe porque, se algo falhar antes da interceptação, o navegador
    envia o formulário sozinho. No método padrão (GET), e-mail e SENHA iriam
    parar na URL, e daí para o histórico do navegador e os logs do servidor.
    Com POST, vão no corpo da requisição, que não é registrado em lugar nenhum.
  */
  const formulario = criar('form', { method: 'post', novalidate: true }, [
    campo('admin-email', 'E-mail', 'email', 'email'),
    campo('admin-senha', 'Senha', 'password', 'current-password'),
    criar('button', {
      class: 'btn btn--primario btn--grande btn--bloco',
      type: 'submit',
      texto: 'Entrar',
    }),
  ]);

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    aoEnviar(formulario, $('[type="submit"]', formulario));
  });

  $$('input', formulario).forEach((input) => {
    input.addEventListener('input', () => limparErrosFormulario(formulario));
  });

  return criar('div', { class: 'admin-login' }, [
    criar('div', { class: 'admin-login__caixa' }, [
      criar('img', {
        src: '../assets/images/logo.jpeg',
        alt: 'Doce Fefê.21',
        class: 'admin-login__logo',
        width: '72',
        height: '72',
      }),
      criar('h1', { class: 'admin-login__titulo', texto: 'Painel Administrativo' }),
      criar('p', {
        class: 'admin-login__texto',
        texto: 'Entre com sua conta de administrador.',
      }),
      formulario,
      criar('a', {
        href: '../index.html',
        class: 'admin-login__voltar',
        texto: '← Voltar ao site',
      }),
    ]),
  ]);
}

/* =============================================================================
 * CABEÇALHO E MENU
 * ========================================================================== */

function montarTopo(titulo, aoSair) {
  const atual = paginaAtual();

  const navegacao = criar(
    'nav',
    { class: 'admin-nav', 'aria-label': 'Telas do painel' },
    TELAS.map((tela) => {
      const ehAtual = tela.arquivo === atual;

      return criar('a', {
        class: `admin-nav__item${ehAtual ? ' admin-nav__item--ativo' : ''}`,
        href: `./${tela.arquivo}`,
        // `aria-current` é o que um leitor de tela anuncia como "página atual".
        // A cor do item ativo sozinha não diz nada para quem não enxerga.
        ...(ehAtual ? { 'aria-current': 'page' } : {}),
        texto: `${tela.icone} ${tela.rotulo}`,
      });
    })
  );

  return criar('header', { class: 'admin-topo' }, [
    criar('div', { class: 'admin-topo__interno' }, [
      criar('div', { class: 'admin-topo__marca' }, [
        criar('img', {
          src: '../assets/images/logo.jpeg',
          alt: '',
          width: '40',
          height: '40',
        }),
        criar('div', {}, [
          criar('strong', { texto: 'Doce Fefê.21' }),
          criar('span', { texto: titulo }),
        ]),
      ]),
      criar('button', {
        class: 'btn btn--secundario btn--pequeno',
        type: 'button',
        texto: 'Sair',
        on: { click: aoSair },
      }),
    ]),
    navegacao,
  ]);
}

/* =============================================================================
 * TROCA DE TELA
 * ========================================================================== */

function mostrarLogin() {
  $('[data-admin-painel]')?.setAttribute('hidden', '');
  $('[data-admin-login]')?.removeAttribute('hidden');
}

function mostrarPainel() {
  $('[data-admin-login]')?.setAttribute('hidden', '');
  $('[data-admin-painel]')?.removeAttribute('hidden');
}

/* =============================================================================
 * SESSÃO EXPIRADA
 * ========================================================================== */

/**
 * Trata o erro de uma chamada administrativa.
 *
 * Toda tela do painel chama isto quando uma requisição falha. Se o motivo for
 * sessão vencida ou falta de permissão, o painel se fecha sozinho em vez de
 * ficar mostrando dados velhos e botões que não funcionam mais.
 *
 * @returns {boolean} true quando o erro era de sessão e já foi tratado
 */
export async function tratarErroDeSessao(erro) {
  if (!(erro instanceof ErroApi) || (erro.status !== 401 && erro.status !== 403)) {
    return false;
  }

  await sair();
  mostrarLogin();
  toastErro('Sua sessão expirou. Entre novamente.');

  return true;
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

/**
 * Monta a casca e entrega o controle para a tela.
 *
 * @param {object} opcoes
 * @param {string} opcoes.titulo - subtítulo do cabeçalho ("Pedidos e pagamentos")
 * @param {() => void} opcoes.aoEntrar - chamada quando o painel abre
 */
export async function iniciarPainel({ titulo, aoEntrar }) {
  const areaLogin = $('[data-admin-login]');
  const areaTopo = $('[data-admin-topo]');

  if (!areaLogin) return;

  // Sem credenciais do Supabase não há login possível. Melhor dizer o que
  // falta do que mostrar um formulário que nunca vai funcionar.
  if (!autenticacaoDisponivel) {
    areaLogin.replaceChildren(
      criar('div', { class: 'admin-login' }, [
        criar('div', { class: 'admin-login__caixa' }, [
          criar('div', { class: 'alerta alerta--aviso' }, [
            criar('span', { texto: '⚙️', 'aria-hidden': 'true' }),
            criar('p', {
              class: 'sem-margem',
              texto:
                'Autenticação não configurada. Faltam VITE_SUPABASE_URL e ' +
                'VITE_SUPABASE_ANON_KEY no arquivo .env',
            }),
          ]),
        ]),
      ])
    );
    return;
  }

  const abrir = () => {
    mostrarPainel();
    aoEntrar();
  };

  const encerrar = async () => {
    await sair();
    mostrarLogin();
    toastSucesso('Você saiu do painel.');
  };

  areaLogin.replaceChildren(
    montarLogin((formulario, botao) => processarLogin(formulario, botao, abrir))
  );
  areaTopo?.replaceChildren(montarTopo(titulo, encerrar));

  /*
    RESTAURAR A SESSÃO É A PRIMEIRA COISA

    O painel não carrega js/main.js — que é quem faz isso nas páginas
    públicas. Sem esta chamada, o token guardado nunca chegava ao cliente
    HTTP: a primeira requisição saía sem `Authorization`, levava 401, e só
    funcionava depois de uma renovação automática. Duas idas à rede antes de
    qualquer coisa aparecer na tela.
  */
  await iniciarAutenticacao();

  /*
    E O PAINEL ABRE DIRETO, SEM PERGUNTAR ANTES

    A versão anterior confirmava o perfil em /admin/sessao antes de abrir. A
    conta estava certa, a resposta também — mas a tela de login ficava à
    mostra durante a viagem até o servidor. Trocar de aba piscava o login
    toda vez.

    Agora quem confirma a permissão é a própria requisição de dados da tela:
    se a conta não for administradora, ela volta 403 e `tratarErroDeSessao`
    fecha o painel. O caminho feliz não paga mais o pedágio pelo caminho
    infeliz — e nenhum dado aparece antes do servidor autorizar, porque
    nenhum dado chega.
  */
  if (estaLogado()) {
    abrir();
    return;
  }

  mostrarLogin();
}

async function processarLogin(formulario, botao, aoEntrar) {
  limparErrosFormulario(formulario);

  const email = formulario.elements.email;
  const senha = formulario.elements.senha;

  if (!email.value.trim()) {
    marcarErroCampo(email, 'Informe seu e-mail.');
    email.focus();
    return;
  }

  if (!senha.value) {
    marcarErroCampo(senha, 'Informe sua senha.');
    senha.focus();
    return;
  }

  botaoCarregando(botao, true);

  try {
    await entrar({ email: email.value, senha: senha.value });

    // Entrar não basta: é preciso SER administrador. Quem decide é o
    // servidor — se a conta não tiver o perfil, a chamada devolve 403.
    await api.get('/admin/sessao');

    toastSucesso('Bem-vinda!');
    aoEntrar();
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 403) {
      // Conta válida, mas sem permissão. Encerramos a sessão para não deixar
      // um login pela metade.
      await sair();
      toastErro('Esta conta não tem acesso ao painel administrativo.');
      return;
    }

    toastErro(erro instanceof ErroAuth ? erro.message : 'Não foi possível entrar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

export default { iniciarPainel, tratarErroDeSessao };
