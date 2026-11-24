/**
 * admin/produtos.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — catálogo: cadastrar, editar, publicar e fotografar.
 *
 * O QUE ESTA TELA SUBSTITUI
 *   Antes da Fase 9, cadastrar produto significava abrir o editor de tabelas
 *   do Supabase e saber, de cabeça, que preço é gravado em centavos, que o
 *   slug tem formato próprio e que a foto precisa de uma linha em outra
 *   tabela. Nada disso é conhecimento que a dona da loja deveria precisar ter.
 *
 * PREÇO: A TELA FALA REAIS, O SISTEMA GUARDA CENTAVOS
 *   O campo aceita "10,00" e converte com `paraCentavos` antes de enviar.
 *   Centavos inteiros eliminam o erro de ponto flutuante que, somado num
 *   carrinho, vira diferença de centavos no total.
 *
 * ⚠️ A VALIDAÇÃO DAQUI É CONFORTO, NÃO BARREIRA
 *   Tudo que este arquivo checa é checado de novo no servidor, em
 *   services/product-admin-service.js. O navegador só existe para avisar
 *   antes — quem decide o que entra no banco é o backend.
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
  aplicarErrosServidor,
  limparErrosFormulario,
} from '../lib/ui.js';
import { moeda, paraCentavos } from '../lib/format.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

let produtos = [];
let categorias = [];
let situacaoAtual = 'ativos';
let busca = '';
/** id do produto aberto no formulário, ou 'novo', ou null. */
let editando = null;

const SITUACOES = [
  { valor: 'ativos', rotulo: 'Todos ativos' },
  { valor: 'publicados', rotulo: 'No ar' },
  { valor: 'rascunhos', rotulo: 'Rascunhos' },
  { valor: 'arquivados', rotulo: 'Arquivados' },
];

/* =============================================================================
 * CARTÃO DO PRODUTO
 * ========================================================================== */

function selosDoProduto(produto) {
  const selos = [];

  if (produto.arquivado) {
    selos.push(['selo--neutro', 'Arquivado']);
  } else if (produto.publicado) {
    selos.push(['selo--sucesso', 'No ar']);
  } else {
    selos.push(['selo--aviso', 'Rascunho']);
  }

  if (produto.emPromocao) selos.push(['selo--destaque', 'Em promoção']);
  if (produto.destaque) selos.push(['selo--novo', 'Destaque']);
  if (produto.estoque?.sobEncomenda) selos.push(['selo--neutro', 'Sob encomenda']);

  return criar(
    'div',
    { class: 'flex gap-2 quebrar' },
    selos.map(([classe, texto]) => criar('span', { class: `selo ${classe}`, texto }))
  );
}

function miniatura(produto) {
  const principal = produto.fotos[0];

  // Produto sem foto não pode parecer erro de carregamento: o quadro fica,
  // com o ícone de câmera dizendo "falta foto aqui".
  if (!principal) {
    return criar('div', { class: 'admin-produto__foto admin-produto__foto--vazia' }, [
      icone('camera'),
    ]);
  }

  return criar('img', {
    class: 'admin-produto__foto',
    src: principal.url,
    alt: principal.alt,
    loading: 'lazy',
    width: '72',
    height: '72',
  });
}

function linhaDeEstoque(produto) {
  const estoque = produto.estoque;

  if (!estoque) return criar('span', { class: 'texto-mini texto-suave', texto: '—' });

  if (estoque.sobEncomenda) {
    return criar('span', { class: 'texto-mini texto-suave', texto: 'Sob encomenda' });
  }

  const critico = estoque.disponivel <= estoque.alertaMinimo;

  return criar('span', {
    class: `texto-mini ${critico ? 'texto-dourado negrito' : 'texto-suave'}`,
    texto: `${estoque.disponivel} disponível(is)`,
  });
}

function botoesDoProduto(produto) {
  const botoes = [];

  if (!produto.arquivado) {
    botoes.push(
      criar('button', {
        class: 'btn btn--secundario btn--pequeno',
        type: 'button',
        texto: 'Editar',
        on: { click: () => abrirFormulario(produto.id) },
      }),

      criar('button', {
        class: 'btn btn--secundario btn--pequeno',
        type: 'button',
        texto: produto.publicado ? 'Tirar do ar' : 'Publicar',
        on: {
          click: (evento) =>
            salvarCampo(
              produto,
              { publicado: !produto.publicado },
              evento.currentTarget
            ),
        },
      }),

      criar('button', {
        class: 'btn btn--secundario btn--pequeno',
        type: 'button',
        texto: 'Arquivar',
        on: { click: (evento) => arquivar(produto, evento.currentTarget) },
      })
    );
  } else {
    botoes.push(
      criar('button', {
        class: 'btn btn--primario btn--pequeno',
        type: 'button',
        texto: 'Restaurar',
        on: { click: (evento) => restaurar(produto, evento.currentTarget) },
      })
    );
  }

  return criar('div', { class: 'flex gap-2 quebrar mt-4' }, botoes);
}

function criarCartao(produto) {
  const precos = [
    criar('strong', {
      class: 'preco',
      texto: moeda(produto.emPromocao ? produto.precoPromocional : produto.precoVarejo),
    }),
  ];

  if (produto.emPromocao) {
    precos.push(
      criar('span', { class: 'preco--antigo', texto: moeda(produto.precoVarejo) })
    );
  }

  if (produto.precoAtacado) {
    precos.push(
      criar('span', {
        class: 'texto-mini texto-suave',
        texto: `atacado ${moeda(produto.precoAtacado)}`,
      })
    );
  }

  return criar('article', { class: 'admin-produto', dataset: { id: produto.id } }, [
    criar('div', { class: 'admin-produto__topo' }, [
      miniatura(produto),

      criar('div', { class: 'admin-produto__info' }, [
        criar('h3', { class: 'admin-produto__nome', texto: produto.nome }),
        criar('span', {
          class: 'texto-mini texto-suave',
          texto: `${produto.categoria?.nome || 'Sem categoria'} · /${produto.slug}`,
        }),
        criar('div', { class: 'flex gap-3 quebrar itens-centro mt-2' }, precos),
        criar('div', { class: 'mt-1' }, [linhaDeEstoque(produto)]),
      ]),

      selosDoProduto(produto),
    ]),

    botoesDoProduto(produto),
  ]);
}

/* =============================================================================
 * FORMULÁRIO
 * ========================================================================== */

function campo({ nome, rotulo, tipo = 'text', valor = '', apoio, ...resto }) {
  const id = `produto-${nome}`;

  const controle =
    tipo === 'textarea'
      ? criar('textarea', { id, name: nome, class: 'campo__controle', rows: '3', ...resto })
      : criar('input', { id, name: nome, type: tipo, class: 'campo__controle', ...resto });

  // `value` como propriedade, não atributo: é o que o navegador lê de volta
  // quando o formulário é enviado, e funciona igual para input e textarea.
  controle.value = valor ?? '';

  return criar('div', { class: 'campo' }, [
    criar('label', { class: 'campo__rotulo', for: id, texto: rotulo }),
    controle,
    apoio ? criar('span', { class: 'campo__ajuda', texto: apoio }) : null,
    criar('span', { class: 'campo__erro' }),
  ]);
}

function caixa({ nome, rotulo, marcado }) {
  const id = `produto-${nome}`;

  return criar('label', { class: 'campo-marcavel', for: id }, [
    criar('input', { type: 'checkbox', id, name: nome, checked: Boolean(marcado) }),
    criar('span', { texto: rotulo }),
  ]);
}

function seletorCategoria(produto) {
  const select = criar('select', {
    id: 'produto-categoriaId',
    name: 'categoriaId',
    class: 'campo__controle',
    required: true,
  });

  select.append(
    criar('option', { value: '', texto: 'Escolha a categoria' }),
    ...categorias.map((c) =>
      criar('option', {
        value: c.id,
        texto: c.ativa ? c.nome : `${c.nome} (inativa)`,
      })
    )
  );

  select.value = produto?.categoriaId || '';

  return criar('div', { class: 'campo' }, [
    criar('label', {
      class: 'campo__rotulo',
      for: 'produto-categoriaId',
      texto: 'Categoria',
    }),
    select,
    criar('span', { class: 'campo__erro' }),
  ]);
}

/** Converte centavos para o texto que a pessoa espera digitar: "10,00". */
const emReais = (centavos) =>
  centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ',');

/** A validade da promoção é digitada como data; o banco guarda com hora. */
const emDataLocal = (iso) => (iso ? String(iso).slice(0, 10) : '');

function montarFormulario(produto) {
  const novo = !produto;

  const formulario = criar('form', { class: 'admin-formulario', novalidate: true }, [
    criar('h2', {
      class: 'admin-secao__titulo',
      texto: novo ? 'Novo produto' : `Editando: ${produto.nome}`,
    }),

    criar('div', { class: 'admin-grade' }, [
      campo({
        nome: 'nome',
        rotulo: 'Nome',
        valor: produto?.nome,
        required: true,
        maxlength: '160',
      }),
      seletorCategoria(produto),
    ]),

    campo({
      nome: 'descricaoCurta',
      rotulo: 'Descrição curta',
      valor: produto?.descricaoCurta,
      maxlength: '200',
      apoio: 'Uma linha. É o que aparece embaixo do nome no catálogo.',
    }),

    campo({
      nome: 'descricao',
      rotulo: 'Descrição completa',
      tipo: 'textarea',
      valor: produto?.descricao,
      maxlength: '4000',
    }),

    criar('div', { class: 'admin-grade' }, [
      campo({
        nome: 'ingredientes',
        rotulo: 'Ingredientes',
        tipo: 'textarea',
        valor: produto?.ingredientes,
        maxlength: '2000',
      }),
      campo({
        nome: 'alergenicos',
        rotulo: 'Alergênicos',
        tipo: 'textarea',
        valor: produto?.alergenicos,
        maxlength: '1000',
        apoio: 'Ex.: contém glúten, leite e amendoim.',
      }),
    ]),

    criar('div', { class: 'admin-grade' }, [
      campo({
        nome: 'precoVarejo',
        rotulo: 'Preço de venda (R$)',
        valor: emReais(produto?.precoVarejo),
        inputmode: 'decimal',
        required: true,
        placeholder: '10,00',
      }),
      campo({
        nome: 'precoPromocional',
        rotulo: 'Preço promocional (R$)',
        valor: emReais(produto?.precoPromocional),
        inputmode: 'decimal',
        apoio: 'Deixe vazio se não houver promoção.',
      }),
      campo({
        nome: 'promocaoAte',
        rotulo: 'Promoção até',
        tipo: 'date',
        valor: emDataLocal(produto?.promocaoAte),
        apoio: 'Depois dessa data o preço volta sozinho.',
      }),
    ]),

    criar('div', { class: 'admin-grade' }, [
      campo({
        nome: 'precoAtacado',
        rotulo: 'Preço de atacado (R$)',
        valor: emReais(produto?.precoAtacado),
        inputmode: 'decimal',
        apoio: 'Só revendedor aprovado enxerga.',
      }),
      campo({
        nome: 'minimoAtacado',
        rotulo: 'Mínimo de atacado',
        tipo: 'number',
        valor: produto?.minimoAtacado ?? 1,
        min: '1',
      }),
      campo({
        nome: 'pesoGramas',
        rotulo: 'Peso (gramas)',
        tipo: 'number',
        valor: produto?.pesoGramas ?? '',
        min: '1',
      }),
    ]),

    novo
      ? campo({
          nome: 'estoqueInicial',
          rotulo: 'Estoque inicial',
          tipo: 'number',
          valor: 0,
          min: '0',
          apoio: 'Entra como movimento de entrada, com histórico.',
        })
      : null,

    criar('div', { class: 'admin-caixas' }, [
      caixa({ nome: 'publicado', rotulo: 'Publicado no site', marcado: produto?.publicado }),
      caixa({ nome: 'destaque', rotulo: 'Destaque na home', marcado: produto?.destaque }),
      caixa({ nome: 'maisVendido', rotulo: 'Mais vendido', marcado: produto?.maisVendido }),
      caixa({ nome: 'novidade', rotulo: 'Novidade', marcado: produto?.novidade }),
      caixa({ nome: 'sazonal', rotulo: 'Sazonal', marcado: produto?.sazonal }),
    ]),

    criar('div', { class: 'flex gap-3 quebrar mt-6' }, [
      criar('button', {
        class: 'btn btn--primario',
        type: 'submit',
        texto: novo ? 'Cadastrar produto' : 'Salvar alterações',
      }),
      criar('button', {
        class: 'btn btn--secundario',
        type: 'button',
        texto: 'Cancelar',
        on: { click: fecharFormulario },
      }),
    ]),
  ]);

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviarFormulario(formulario, produto);
  });

  const area = criar('section', { class: 'admin-cartao mt-6' }, [formulario]);

  // As fotos só existem depois que o produto existe: elas precisam de um id
  // para serem vinculadas. Por isso aparecem apenas na edição.
  if (!novo) area.append(montarGaleria(produto));

  return area;
}

/** Lê o formulário e devolve o corpo da requisição, em camelCase. */
function lerFormulario(formulario, novo) {
  const campos = formulario.elements;
  const valor = (nome) => campos[nome]?.value?.trim() ?? '';
  const marcado = (nome) => Boolean(campos[nome]?.checked);

  // Campo de preço vazio significa "não tem" — e `paraCentavos('')` devolve
  // 0, que o banco recusaria. Por isso o vazio vira null explicitamente.
  const precoOuNulo = (nome) => (valor(nome) ? paraCentavos(valor(nome)) : null);

  const corpo = {
    nome: valor('nome'),
    categoriaId: valor('categoriaId'),
    descricaoCurta: valor('descricaoCurta'),
    descricao: valor('descricao'),
    ingredientes: valor('ingredientes'),
    alergenicos: valor('alergenicos'),

    precoVarejo: valor('precoVarejo') ? paraCentavos(valor('precoVarejo')) : null,
    precoPromocional: precoOuNulo('precoPromocional'),
    precoAtacado: precoOuNulo('precoAtacado'),

    // A data vem como "2026-12-10". O fim do dia é o que a pessoa espera:
    // uma promoção "até dia 10" vale o dia 10 inteiro.
    promocaoAte: valor('promocaoAte') ? `${valor('promocaoAte')}T23:59:59` : null,

    minimoAtacado: Number(valor('minimoAtacado')) || 1,
    pesoGramas: valor('pesoGramas') ? Number(valor('pesoGramas')) : null,

    publicado: marcado('publicado'),
    destaque: marcado('destaque'),
    maisVendido: marcado('maisVendido'),
    novidade: marcado('novidade'),
    sazonal: marcado('sazonal'),
  };

  if (novo) corpo.estoqueInicial = Number(valor('estoqueInicial')) || 0;

  return corpo;
}

async function enviarFormulario(formulario, produto) {
  const botao = $('[type="submit"]', formulario);

  limparErrosFormulario(formulario);
  botaoCarregando(botao, true);

  try {
    const corpo = lerFormulario(formulario, !produto);

    const resposta = produto
      ? await api.patch(`/admin/produtos/${produto.id}`, corpo)
      : await api.post('/admin/produtos', corpo);

    toastSucesso(resposta.mensagem);

    // Depois de cadastrar, o formulário segue aberto na edição — é onde as
    // fotos podem ser enviadas, e produto novo sem foto não vai para o ar.
    // O filtro volta para "ativos" porque um produto recém-criado nasce como
    // rascunho e sumiria da lista se o filtro fosse "no ar".
    editando = resposta.produto.id;
    if (!produto) situacaoAtual = 'ativos';

    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;

    if (erro.erros) aplicarErrosServidor(formulario, erro.erros);
    toastErro(erro.message || 'Não conseguimos salvar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * GALERIA DE FOTOS
 * ========================================================================== */

/**
 * Lê o arquivo escolhido e devolve o conteúdo em base64.
 *
 * O backend recebe o arquivo dentro do JSON, como já acontece com o
 * comprovante de pagamento: dispensa analisar multipart no servidor.
 */
function lerArquivo(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(',')[1]);
    leitor.onerror = () => rejeitar(new Error('Não conseguimos ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function montarGaleria(produto) {
  const entrada = criar('input', {
    type: 'file',
    id: 'produto-foto',
    class: 'campo__controle',
    accept: 'image/jpeg,image/png,image/webp',
  });

  entrada.addEventListener('change', async () => {
    const arquivo = entrada.files?.[0];
    if (!arquivo) return;

    await enviarFoto(produto.id, arquivo, entrada);
    entrada.value = '';
  });

  const fotos = produto.fotos.map((foto) =>
    criar('figure', { class: 'admin-foto' }, [
      criar('img', { src: foto.url, alt: foto.alt, loading: 'lazy' }),

      foto.principal
        ? criar('span', { class: 'selo selo--sucesso admin-foto__selo', texto: 'Principal' })
        : criar('button', {
            class: 'btn btn--secundario btn--pequeno admin-foto__acao',
            type: 'button',
            texto: 'Tornar principal',
            on: {
              click: (evento) => definirPrincipal(produto.id, foto.id, evento.currentTarget),
            },
          }),

      criar('button', {
        class: 'admin-foto__remover',
        type: 'button',
        'aria-label': `Remover foto: ${foto.alt}`,
        texto: '×',
        on: { click: (evento) => removerFoto(produto.id, foto.id, evento.currentTarget) },
      }),
    ])
  );

  return criar('div', { class: 'admin-galeria mt-8' }, [
    criar('h3', { class: 'admin-secao__titulo', texto: 'Fotos' }),

    produto.fotos.length === 0
      ? criar('p', {
          class: 'texto-pequeno texto-suave',
          texto: 'Nenhuma foto ainda. A primeira enviada vira a principal.',
        })
      : criar('div', { class: 'admin-galeria__grade' }, fotos),

    criar('div', { class: 'campo mt-4' }, [
      criar('label', {
        class: 'campo__rotulo',
        for: 'produto-foto',
        texto: 'Enviar foto (JPG, PNG ou WEBP, até 5 MB)',
      }),
      entrada,
      criar('span', {
        class: 'campo__ajuda',
        texto: 'Quadrada, no mínimo 1000×1000, fica melhor no catálogo.',
      }),
    ]),
  ]);
}

async function enviarFoto(produtoId, arquivo, entrada) {
  entrada.disabled = true;

  try {
    const base64 = await lerArquivo(arquivo);

    const resposta = await api.post(`/admin/produtos/${produtoId}/fotos`, {
      arquivo: base64,
      tipo: arquivo.type,
      nome: arquivo.name,
    });

    toastSucesso(resposta.mensagem);
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos enviar a foto.');
  } finally {
    entrada.disabled = false;
  }
}

async function definirPrincipal(produtoId, fotoId, botao) {
  botaoCarregando(botao, true);

  try {
    await api.patch(`/admin/produtos/${produtoId}/fotos/${fotoId}`, { principal: true });
    toastSucesso('Foto principal definida.');
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos alterar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function removerFoto(produtoId, fotoId, botao) {
  const confirmado = await confirmar('Remover esta foto? A ação não tem volta.');
  if (!confirmado) return;

  botaoCarregando(botao, true);

  try {
    await api.delete(`/admin/produtos/${produtoId}/fotos/${fotoId}`);
    toastSucesso('Foto removida.');
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos remover.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * AÇÕES RÁPIDAS
 * ========================================================================== */

/** Alterações de um campo só, feitas direto no cartão (publicar, por ex.). */
async function salvarCampo(produto, mudancas, botao) {
  botaoCarregando(botao, true);

  try {
    await api.patch(`/admin/produtos/${produto.id}`, mudancas);

    toastSucesso(
      mudancas.publicado === true
        ? `${produto.nome} está no ar.`
        : mudancas.publicado === false
          ? `${produto.nome} saiu do site.`
          : 'Alteração salva.'
    );

    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos salvar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function arquivar(produto, botao) {
  const confirmado = await confirmar(
    `Arquivar "${produto.nome}"? Ele sai do site, mas o histórico de vendas ` +
      'continua intacto — e dá para restaurar depois.'
  );
  if (!confirmado) return;

  botaoCarregando(botao, true);

  try {
    const resposta = await api.delete(`/admin/produtos/${produto.id}`);
    toastSucesso(resposta.mensagem);

    if (editando === produto.id) editando = null;
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos arquivar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function restaurar(produto, botao) {
  botaoCarregando(botao, true);

  try {
    const resposta = await api.delete(`/admin/produtos/${produto.id}?restaurar=1`);
    toastSucesso(resposta.mensagem);
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos restaurar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * FORMULÁRIO: ABRIR E FECHAR
 * ========================================================================== */

function abrirFormulario(id) {
  editando = id;
  renderizarFormulario();

  $('[data-area-formulario]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fecharFormulario() {
  editando = null;
  renderizarFormulario();
}

function renderizarFormulario() {
  const area = $('[data-area-formulario]');
  if (!area) return;

  if (!editando) {
    area.replaceChildren();
    return;
  }

  const produto = editando === 'novo' ? null : produtos.find((p) => p.id === editando);

  // O produto pode ter saído da lista por causa do filtro aplicado.
  if (editando !== 'novo' && !produto) {
    editando = null;
    area.replaceChildren();
    return;
  }

  area.replaceChildren(montarFormulario(produto));
}

/* =============================================================================
 * LISTA
 * ========================================================================== */

function renderizarFiltros() {
  const container = $('[data-filtros-situacao]');
  if (!container) return;

  container.replaceChildren(
    ...SITUACOES.map((s) =>
      criar('button', {
        class: `filtro-chip${situacaoAtual === s.valor ? ' filtro-chip--ativo' : ''}`,
        type: 'button',
        texto: s.rotulo,
        on: {
          click: () => {
            situacaoAtual = s.valor;
            carregar();
          },
        },
      })
    )
  );
}

function renderizarLista() {
  const lista = $('[data-lista-produtos]');
  if (!lista) return;

  if (produtos.length === 0) {
    renderizarEstadoVazio(lista, {
      icone: 'produtos',
      titulo: busca ? 'Nenhum produto com esse nome' : 'Nenhum produto por aqui',
      texto: busca
        ? 'Tente outro termo ou troque o filtro.'
        : 'Cadastre o primeiro produto no botão acima.',
    });
    return;
  }

  lista.replaceChildren(
    criar('p', {
      class: 'texto-mini texto-suave',
      texto: `${produtos.length} produto(s)`,
    }),
    ...produtos.map(criarCartao)
  );
}

async function carregar() {
  const lista = $('[data-lista-produtos]');

  lista?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const resposta = await api.get('/admin/produtos', {
      busca,
      situacao: situacaoAtual,
    });

    produtos = resposta.produtos;
    categorias = resposta.categorias;

    renderizarFiltros();
    renderizarLista();
    renderizarFormulario();
  } catch (erro) {
    console.error('[admin] Falha ao carregar produtos:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(lista, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar o catálogo',
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
    titulo: 'Catálogo',
    aoEntrar: () => {
      // `debounce` espera a pessoa parar de digitar: sem ele, "brownie"
      // dispararia sete consultas.
      $('[data-busca]')?.addEventListener(
        'input',
        debounce((evento) => {
          busca = evento.target.value;
          carregar();
        }, 400)
      );

      $('[data-novo-produto]')?.addEventListener('click', () => abrirFormulario('novo'));

      carregar();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
