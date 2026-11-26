/**
 * conta.js
 * -----------------------------------------------------------------------------
 * Tela de login, cadastro e área do cliente (minha-conta.html).
 *
 * A mesma página serve aos dois estados:
 *   • sem sessão  → caixa de acesso (entrar / criar conta)
 *   • com sessão  → painel do cliente (dados, pedidos)
 *
 * A troca é feita aqui, no JavaScript. Não existe redirecionamento: o
 * endereço `minha-conta.html` funciona nos dois casos, o que evita link
 * quebrado quando a sessão expira.
 */

import {
  cadastrar,
  confirmarCodigo,
  reenviarCodigo,
  entrar,
  sair,
  recuperarSenha,
  estaLogado,
  autenticacaoDisponivel,
  ErroAuth,
} from './auth.js';
import { api, ErroApi } from './lib/api.js';
import {
  $,
  $$,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  marcarErroCampo,
  limparErroCampo,
  limparErrosFormulario,
  renderizarEstadoVazio,
} from './lib/ui.js';
import { moeda, data as formatarData, telefone as formatarTelefone,
         somenteDigitos } from './lib/format.js';
import { descreverStatus } from './lib/status-pedido.js';
import { icone } from './components/icons.js';
import { ROTAS, rota } from './config.js';
import { montarLinkWhatsApp } from './whatsapp.js';

/* =============================================================================
 * VALIDAÇÃO
 *
 * Igual ao resto do projeto: validar aqui é conveniência. O Supabase valida
 * e-mail e senha do lado dele, e o nosso backend revalida o perfil.
 * ========================================================================== */

const SENHA_MINIMA = 8;

function validarEmail(valor) {
  const limpo = String(valor || '').trim();
  if (!limpo) return 'Informe seu e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) return 'Esse e-mail parece incompleto.';
  return null;
}

function validarSenha(valor) {
  const senha = String(valor || '');
  if (!senha) return 'Informe sua senha.';
  if (senha.length < SENHA_MINIMA) {
    return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  return null;
}

function validarNome(valor) {
  const nome = String(valor || '').trim();
  if (!nome) return 'Informe seu nome.';
  if (nome.length < 2) return 'O nome parece curto demais.';
  if (nome.length > 120) return 'O nome é longo demais.';
  return null;
}

/**
 * Avalia a força da senha.
 *
 * Critério simples e honesto: comprimento e variedade. Não exige símbolo
 * obrigatório — regras rígidas demais levam a senhas como "Senha@123", que
 * são piores que uma frase longa.
 */
function avaliarForcaSenha(senha) {
  if (!senha) return { nivel: '', rotulo: '' };

  let pontos = 0;
  if (senha.length >= SENHA_MINIMA) pontos += 1;
  if (senha.length >= 12) pontos += 1;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos += 1;
  if (/\d/.test(senha)) pontos += 1;
  if (/[^a-zA-Z0-9]/.test(senha)) pontos += 1;

  if (senha.length < SENHA_MINIMA) return { nivel: 'fraca', rotulo: 'Muito curta' };
  if (pontos <= 2) return { nivel: 'fraca', rotulo: 'Senha fraca' };
  if (pontos <= 3) return { nivel: 'media', rotulo: 'Senha razoável' };
  return { nivel: 'forte', rotulo: 'Senha forte' };
}

/* =============================================================================
 * CAIXA DE ACESSO
 * ========================================================================== */

/** Alterna entre as abas Entrar e Criar conta. */
function trocarAba(aba) {
  $$('[data-aba]').forEach((botao) => {
    botao.setAttribute('aria-selected', String(botao.dataset.aba === aba));
  });

  $$('[data-painel-aba]').forEach((painel) => {
    painel.hidden = painel.dataset.painelAba !== aba;
  });

  // Leva o foco ao primeiro campo da aba aberta.
  const painel = $(`[data-painel-aba="${aba}"]`);
  painel?.querySelector('input')?.focus();
}

/** Botão de mostrar/ocultar senha. */
function ativarAlternarSenha(raiz = document) {
  $$('.campo-senha', raiz).forEach((campo) => {
    if (campo.dataset.ligado === 'sim') return;
    campo.dataset.ligado = 'sim';

    const input = campo.querySelector('input');
    if (!input) return;

    const botao = criar('button', {
      class: 'campo-senha__alternar',
      type: 'button',
      texto: 'Ver',
      'aria-label': 'Mostrar senha',
    });

    botao.addEventListener('click', () => {
      const mostrando = input.type === 'text';
      input.type = mostrando ? 'password' : 'text';
      botao.textContent = mostrando ? 'Ver' : 'Ocultar';
      botao.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
      input.focus();
    });

    campo.append(botao);
  });
}

/* -----------------------------------------------------------------------------
 * Login
 * -------------------------------------------------------------------------- */

async function processarLogin(formulario, botao) {
  limparErrosFormulario(formulario);

  const email = formulario.elements.email;
  const senha = formulario.elements.senha;

  const erroEmail = validarEmail(email.value);
  const erroSenha = senha.value ? null : 'Informe sua senha.';

  if (erroEmail) marcarErroCampo(email, erroEmail);
  if (erroSenha) marcarErroCampo(senha, erroSenha);

  if (erroEmail || erroSenha) {
    (erroEmail ? email : senha).focus();
    return;
  }

  botaoCarregando(botao, true);

  try {
    await entrar({ email: email.value, senha: senha.value });
    toastSucesso('Bem-vinda de volta!');
    await mostrarPainelCliente();
  } catch (erro) {
    if (erro instanceof ErroAuth && erro.codigo === 'email_not_confirmed') {
      mostrarAvisoConfirmacao(formulario, email.value);
    }
    toastErro(erro.message);
  } finally {
    botaoCarregando(botao, false);
  }
}

/* -----------------------------------------------------------------------------
 * Cadastro
 * -------------------------------------------------------------------------- */

async function processarCadastro(formulario, botao) {
  limparErrosFormulario(formulario);

  const nome = formulario.elements.nome;
  const email = formulario.elements.email;
  const senha = formulario.elements.senha;
  const telefone = formulario.elements.telefone;
  const aceite = formulario.elements.aceite;

  const erros = [
    [nome, validarNome(nome.value)],
    [email, validarEmail(email.value)],
    [senha, validarSenha(senha.value)],
  ];

  // Telefone é opcional, mas se preenchido precisa estar completo.
  const digitos = somenteDigitos(telefone.value);
  if (digitos && (digitos.length < 10 || digitos.length > 11)) {
    erros.push([telefone, 'Informe o número completo, com DDD.']);
  }

  if (!aceite.checked) {
    erros.push([aceite, 'É preciso aceitar a política de privacidade.']);
  }

  const comErro = erros.filter(([, erro]) => erro);

  if (comErro.length > 0) {
    comErro.forEach(([campo, erro]) => marcarErroCampo(campo, erro));
    comErro[0][0].focus();
    return;
  }

  botaoCarregando(botao, true);

  try {
    const { precisaConfirmarEmail } = await cadastrar({
      nome: nome.value,
      email: email.value,
      senha: senha.value,
      telefone: telefone.value,
    });

    if (precisaConfirmarEmail) {
      mostrarFormularioCodigo(formulario, email.value.trim().toLowerCase());
      toastSucesso('Conta criada! Agora digite o código que enviamos.');
      return;
    }

    toastSucesso('Conta criada com sucesso!');
    await mostrarPainelCliente();
  } catch (erro) {
    if (erro instanceof ErroAuth && erro.codigo === 'user_already_exists') {
      marcarErroCampo(email, erro.message);
      email.focus();
    }
    toastErro(erro.message);
  } finally {
    botaoCarregando(botao, false);
  }
}

/**
 * Tela de confirmação por código.
 *
 * POR QUE CÓDIGO E NÃO LINK
 *   O link carrega dentro dele o endereço do site. O e-mail chega no
 *   celular, mas o link aponta para onde o site estava — e enquanto o
 *   projeto roda em `localhost`, "localhost" no celular é o próprio
 *   celular, onde não há nada. O código não aponta para lugar nenhum: a
 *   pessoa lê no celular e digita onde estiver.
 *
 *   De quebra, quem digitou o código provou que tem acesso à caixa de
 *   e-mail — então já entra logada, sem precisar repetir a senha.
 */
function mostrarFormularioCodigo(formularioCadastro, email) {
  const codigo = criar('input', {
    class: 'campo__controle',
    type: 'text',
    id: 'codigo-confirmacao',
    name: 'codigo',
    // `inputmode` abre o teclado numérico no celular, que é onde a pessoa
    // está lendo o e-mail. `autocomplete` deixa o próprio sistema oferecer
    // o código assim que ele chega.
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    // Teto generoso em vez do tamanho exato: o comprimento do código é
    // configurável no painel do Supabase, e já mudou uma vez. Fixar o
    // número aqui faria a tela recusar o código certo.
    maxlength: '10',
    'aria-label': 'Código recebido por e-mail',
  });

  const confirmar = criar('button', {
    class: 'btn btn--primario btn--grande btn--bloco',
    type: 'submit',
    texto: 'Confirmar meu e-mail',
  });

  const formulario = criar('form', { novalidate: true }, [
    criar('div', { class: 'campo' }, [
      criar('label', {
        class: 'campo__rotulo',
        for: 'codigo-confirmacao',
        texto: 'Código recebido por e-mail',
      }),
      codigo,
      criar('span', { class: 'campo__erro' }),
    ]),
    confirmar,
  ]);

  /*
    Só números. Sem confirmar sozinho ao atingir um tamanho: como o
    comprimento do código é configurável no Supabase, disparar o envio num
    número fixo erraria sempre que a configuração mudasse — e enviar cedo
    demais gasta uma tentativa à toa.
  */
  codigo.addEventListener('input', () => {
    codigo.value = codigo.value.replace(/\D/g, '').slice(0, 10);
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limparErrosFormulario(formulario);
    botaoCarregando(confirmar, true);

    try {
      await confirmarCodigo({ email, codigo: codigo.value });

      toastSucesso('E-mail confirmado! Bem-vinda.');
      await mostrarPainelCliente();
    } catch (erro) {
      marcarErroCampo(codigo, 'Código inválido ou vencido.');
      codigo.select();
      toastErro(erro.message || 'Não conseguimos confirmar esse código.');
    } finally {
      botaoCarregando(confirmar, false);
    }
  });

  const reenviar = criar('button', {
    class: 'btn btn--secundario btn--pequeno',
    type: 'button',
    texto: 'Enviar outro código',
    on: {
      click: async (evento) => {
        botaoCarregando(evento.currentTarget, true);

        try {
          await reenviarCodigo(email);
          toastSucesso('Código novo enviado.');
        } catch (erro) {
          toastErro(erro.message || 'Não conseguimos reenviar agora.');
        } finally {
          botaoCarregando(evento.currentTarget, false);
        }
      },
    },
  });

  const caixa = criar('div', { class: 'confirmacao-codigo', 'data-confirmacao-codigo': '' }, [
    icone('email', 'confirmacao-codigo__icone'),
    criar('h2', { class: 'confirmacao-codigo__titulo', texto: 'Confira seu e-mail' }),
    criar('p', {
      texto: `Enviamos um código para ${email}. Digite ele aqui embaixo.`,
    }),
    formulario,
    criar('p', {
      class: 'texto-mini texto-suave mt-6',
      texto: 'Não chegou? Veja a caixa de spam — ou peça outro:',
    }),
    reenviar,
  ]);

  // O formulário de cadastro sai de cena: deixar os dois à mostra sugeriria
  // que ainda falta preencher alguma coisa ali.
  formularioCadastro.hidden = true;
  formularioCadastro.after(caixa);

  codigo.focus();
}

/* -----------------------------------------------------------------------------
 * Recuperar senha
 * -------------------------------------------------------------------------- */

async function processarRecuperacao(formulario, botao) {
  limparErrosFormulario(formulario);

  const email = formulario.elements.email;
  const erro = validarEmail(email.value);

  if (erro) {
    marcarErroCampo(email, erro);
    email.focus();
    return;
  }

  botaoCarregando(botao, true);

  try {
    const { mensagem } = await recuperarSenha(email.value);
    toastSucesso(mensagem, 8000);
    trocarAba('entrar');
  } catch (erroReq) {
    toastErro(erroReq.message);
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * PAINEL DO CLIENTE
 * ========================================================================== */

/** Primeira letra do nome, para o avatar. */
function inicialDe(nome, email) {
  const base = (nome || email || '?').trim();
  return base.charAt(0).toUpperCase();
}

function renderizarPerfil(perfil, revenda) {
  const cartao = $('[data-cartao-perfil]');
  if (!cartao) return;

  const filhos = [
    criar('div', {
      class: 'conta-perfil__inicial',
      texto: inicialDe(perfil.nome, perfil.email),
      'aria-hidden': 'true',
    }),
    criar('p', { class: 'conta-perfil__nome', texto: perfil.nome }),
    criar('p', { class: 'conta-perfil__email', texto: perfil.email }),
  ];

  // Selo de revendedor, conforme o status do cadastro.
  if (revenda) {
    const selos = {
      aprovado: { classe: 'selo--sucesso', texto: 'Revendedor aprovado' },
      pendente: { classe: 'selo--aviso', texto: 'Revenda em análise' },
      recusado: { classe: 'selo--erro', texto: 'Revenda recusada' },
      suspenso: { classe: 'selo--erro', texto: 'Revenda suspensa' },
    };

    const selo = selos[revenda.status];
    if (selo) {
      filhos.push(
        criar('span', {
          class: `selo ${selo.classe} conta-perfil__selo`,
          texto: selo.texto,
        })
      );
    }
  }

  if (perfil.membroDesde) {
    filhos.push(
      criar('p', {
        class: 'conta-perfil__desde',
        texto: `Cliente desde ${formatarData(perfil.membroDesde)}`,
      })
    );
  }

  cartao.replaceChildren(...filhos);
}

function preencherFormularioDados(perfil) {
  const formulario = $('[data-formulario-dados]');
  if (!formulario) return;

  formulario.elements.nome.value = perfil.nome || '';
  formulario.elements.telefone.value = perfil.telefone
    ? formatarTelefone(perfil.telefone)
    : '';
  formulario.elements.data_nascimento.value = perfil.dataNascimento || '';
  formulario.elements.aceita_marketing.checked = Boolean(perfil.aceitaMarketing);

  // O e-mail é só leitura: alterá-lo exige reconfirmação, que é um fluxo
  // separado do Supabase Auth. Mostrar editável seria enganoso.
  const campoEmail = formulario.elements.email;
  if (campoEmail) campoEmail.value = perfil.email || '';
}

async function salvarDados(formulario, botao) {
  limparErrosFormulario(formulario);

  const nome = formulario.elements.nome;
  const erroNome = validarNome(nome.value);

  if (erroNome) {
    marcarErroCampo(nome, erroNome);
    nome.focus();
    return;
  }

  botaoCarregando(botao, true);

  try {
    await api.patch('/perfil', {
      nome: nome.value.trim(),
      telefone: somenteDigitos(formulario.elements.telefone.value),
      data_nascimento: formulario.elements.data_nascimento.value,
      aceita_marketing: formulario.elements.aceita_marketing.checked,
    });

    toastSucesso('Dados atualizados!');
    await carregarPerfil();
  } catch (erro) {
    if (erro instanceof ErroApi && erro.erros) {
      for (const [campo, mensagem] of Object.entries(erro.erros)) {
        const input = formulario.elements[campo];
        if (input) marcarErroCampo(input, mensagem);
      }
      toastErro('Confira os campos destacados.');
    } else {
      toastErro(erro.message || 'Não conseguimos salvar seus dados.');
    }
  } finally {
    botaoCarregando(botao, false);
  }
}

/* -----------------------------------------------------------------------------
 * Pedidos
 * -------------------------------------------------------------------------- */

/**
 * Leva o pedido de volta à tela de pagamento, quando ainda falta algo ali.
 *
 * O QUE ISTO RESOLVE
 *   A cliente fecha o pedido, sai da aba para abrir o aplicativo do banco e
 *   volta. O carrinho está vazio — correto, o pedido já nasceu — mas o Pix
 *   ficou para trás, e "Meus pedidos" só dizia "aguardando pagamento" sem
 *   oferecer caminho nenhum. O pedido existia e não havia como concluí-lo.
 *
 *   É o momento mais frágil da compra: a venda já foi decidida e se perde
 *   por falta de um link.
 *
 * Aparece em dois estados, com pesos diferentes:
 *   • aguardando_pagamento — botão cheio: falta uma ação dela
 *   • comprovante_enviado  — link discreto: já fez a parte dela, mas pode
 *     precisar reenviar se o comprovante vier recusado
 */
function criarAcaoPagamento(pedido) {
  const PRECISA = {
    aguardando_pagamento: {
      classe: 'btn btn--primario btn--bloco',
      rotulo: 'Pagar e enviar comprovante',
      icone: 'pix',
    },
    comprovante_enviado: {
      classe: 'btn btn--texto btn--pequeno',
      rotulo: 'Ver pagamento',
      icone: 'recibo',
    },
  };

  const acao = PRECISA[pedido.status];
  if (!acao) return null;

  return criar(
    'a',
    {
      class: `${acao.classe} pedido-card__acao`,
      href: `${rota(ROTAS.pagamento)}?pedido=${encodeURIComponent(pedido.codigo)}`,
    },
    [icone(acao.icone), criar('span', { texto: acao.rotulo })]
  );
}

function criarCardPedido(pedido) {
  const status = descreverStatus(pedido.status);

  const acao = criarAcaoPagamento(pedido);

  return criar('article', { class: 'pedido-card' }, [
    criar('div', { class: 'pedido-card__topo' }, [
      criar('div', {}, [
        criar('div', { class: 'pedido-card__codigo', texto: pedido.codigo }),
        criar('div', {
          class: 'pedido-card__data',
          texto: formatarData(pedido.criadoEm),
        }),
      ]),
      criar('span', { class: `selo ${status.classe}`, texto: status.rotulo }),
    ]),

    criar('div', { class: 'pedido-card__rodape' }, [
      criar('span', {
        class: 'texto-pequeno texto-suave',
        texto: pedido.tipoEntrega === 'entrega' ? 'Entrega' : 'Retirada',
      }),
      criar('strong', { class: 'preco', texto: moeda(pedido.total) }),
    ]),

    ...(acao ? [acao] : []),
  ]);
}

async function carregarPedidos() {
  const container = $('[data-lista-pedidos]');
  if (!container) return;

  container.replaceChildren(
    criar('p', { class: 'texto-suave texto-pequeno', texto: 'Carregando…' })
  );

  try {
    const { pedidos } = await api.get('/perfil/pedidos');

    if (!pedidos || pedidos.length === 0) {
      renderizarEstadoVazio(container, {
        icone: 'pedidos',
        titulo: 'Você ainda não fez pedidos',
        texto: 'Quando fizer sua primeira compra, ela aparece aqui.',
        acao: { texto: 'Ver nossos doces', href: rota(ROTAS.produtos) },
      });
      return;
    }

    container.replaceChildren(...pedidos.map(criarCardPedido));
  } catch (erro) {
    console.error('[conta] Falha ao carregar pedidos:', erro);

    renderizarEstadoVazio(container, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar seus pedidos',
      texto: 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregarPedidos },
    });
  }
}

/* -----------------------------------------------------------------------------
 * Menu lateral
 * -------------------------------------------------------------------------- */

function ativarMenuConta() {
  $$('[data-painel]').forEach((botao) => {
    if (botao.dataset.ligado === 'sim') return;
    botao.dataset.ligado = 'sim';

    botao.addEventListener('click', () => {
      const alvo = botao.dataset.painel;

      $$('[data-painel]').forEach((b) => {
        b.setAttribute('aria-current', String(b.dataset.painel === alvo));
      });

      $$('[data-conteudo-painel]').forEach((painel) => {
        painel.hidden = painel.dataset.conteudoPainel !== alvo;
      });

      // Carrega os pedidos só quando a aba é aberta — evita uma chamada
      // desnecessária para quem só quer editar os dados.
      if (alvo === 'pedidos') carregarPedidos();
    });
  });
}

/* =============================================================================
 * TROCA DE ESTADO
 * ========================================================================== */

let perfilCarregado = null;

async function carregarPerfil() {
  const { perfil, revenda } = await api.get('/perfil');
  perfilCarregado = perfil;

  renderizarPerfil(perfil, revenda);
  preencherFormularioDados(perfil);

  return perfil;
}

async function mostrarPainelCliente() {
  $('[data-area-acesso]')?.setAttribute('hidden', '');
  $('[data-area-cliente]')?.removeAttribute('hidden');

  ativarMenuConta();

  try {
    await carregarPerfil();
  } catch (erro) {
    console.error('[conta] Falha ao carregar perfil:', erro);

    // 401 significa sessão inválida: volta para a tela de acesso.
    if (erro instanceof ErroApi && erro.status === 401) {
      await sair();
      mostrarAreaAcesso();
      toastErro('Sua sessão expirou. Entre novamente.');
      return;
    }

    toastErro(erro.message || 'Não conseguimos carregar seus dados.');
  }
}

function mostrarAreaAcesso() {
  $('[data-area-cliente]')?.setAttribute('hidden', '');
  $('[data-area-acesso]')?.removeAttribute('hidden');
  perfilCarregado = null;
  trocarAba('entrar');
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

// O indicador de login no cabeçalho é responsabilidade de js/main.js, que
// roda em todas as páginas. Aqui cuidamos apenas desta tela.

function iniciar() {
  const areaAcesso = $('[data-area-acesso]');
  if (!areaAcesso) return; // não estamos na página da conta

  // --- Autenticação não configurada ---
  if (!autenticacaoDisponivel) {
    areaAcesso.replaceChildren(
      criar('div', { class: 'alerta alerta--aviso' }, [
        icone('engrenagem'),
        criar('div', {}, [
          criar('p', {
            class: 'sem-margem',
            texto: 'A área do cliente ainda não está configurada.',
          }),
          criar('p', {
            class: 'texto-mini sem-margem mt-2',
            texto:
              'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env',
          }),
        ]),
      ])
    );
    return;
  }

  ativarAlternarSenha();

  // --- Abas ---
  $$('[data-aba]').forEach((botao) => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  });

  $$('[data-ir-aba]').forEach((botao) => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.irAba));
  });

  // --- Formulários ---
  const formLogin = $('[data-formulario-login]');
  formLogin?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    processarLogin(formLogin, $('[type="submit"]', formLogin));
  });

  const formCadastro = $('[data-formulario-cadastro]');
  formCadastro?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    processarCadastro(formCadastro, $('[type="submit"]', formCadastro));
  });

  const formRecuperar = $('[data-formulario-recuperar]');
  formRecuperar?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    processarRecuperacao(formRecuperar, $('[type="submit"]', formRecuperar));
  });

  const formDados = $('[data-formulario-dados]');
  formDados?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    salvarDados(formDados, $('[type="submit"]', formDados));
  });

  // --- Limpa erro ao corrigir ---
  $$('input, select', areaAcesso).forEach((campo) => {
    const evento = campo.type === 'checkbox' ? 'change' : 'input';
    campo.addEventListener(evento, () => limparErroCampo(campo));
  });

  // --- Medidor de força da senha ---
  const senhaCadastro = formCadastro?.elements.senha;
  const medidor = $('[data-forca-senha]');

  senhaCadastro?.addEventListener('input', () => {
    if (!medidor) return;

    const { nivel, rotulo } = avaliarForcaSenha(senhaCadastro.value);

    medidor.className = `forca-senha${nivel ? ` forca-senha--${nivel}` : ''}`;
    const texto = $('[data-forca-rotulo]', medidor);
    if (texto) texto.textContent = rotulo;
  });

  // --- Sair ---
  $('[data-sair]')?.addEventListener('click', async () => {
    await sair();
    mostrarAreaAcesso();
    toastSucesso('Você saiu da sua conta.');
  });

  // --- Link do WhatsApp para dúvidas ---
  const ajuda = $('[data-ajuda-conta]');
  if (ajuda) {
    ajuda.href = montarLinkWhatsApp(
      'Olá! Preciso de ajuda com a minha conta no site da Doce Fefê.21.'
    );
  }

  // --- Estado inicial ---
  if (estaLogado()) {
    mostrarPainelCliente();
  } else {
    mostrarAreaAcesso();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
