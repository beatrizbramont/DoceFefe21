-- =============================================================================
-- DOCE FEFÊ.21 — 01-schema.sql
-- Estrutura do banco de dados (PostgreSQL / Supabase)
-- =============================================================================
--
-- COMO EXECUTAR
--   1. Abra o painel do Supabase
--   2. Menu lateral > SQL Editor > New query
--   3. Cole este arquivo inteiro e clique em "Run"
--   4. Depois execute, na ordem: 02-rls.sql e 03-seed.sql
--
-- DECISÕES IMPORTANTES
--
--   • DINHEIRO EM CENTAVOS (INTEGER)
--     Preços são números inteiros em centavos, nunca FLOAT. Ponto flutuante
--     acumula erro de arredondamento — num carrinho isso vira diferença de
--     centavos no total. R$ 12,50 é armazenado como 1250.
--
--   • UUID COMO CHAVE PRIMÁRIA
--     IDs sequenciais revelam o volume do negócio (quem recebe o pedido #7
--     sabe que a loja vendeu 7 vezes) e facilitam varrer dados alheios
--     trocando o número na URL.
--
--   • TIMESTAMPTZ, NUNCA TIMESTAMP
--     Guarda o fuso. Sem isso, um pedido feito 23h em São Paulo pode
--     aparecer no dia seguinte nos relatórios.
--
--   • SOFT DELETE EM PRODUTOS
--     Produto excluído de verdade quebraria o histórico de pedidos antigos.
--     Usamos a coluna `arquivado_em`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- EXTENSÕES
-- -----------------------------------------------------------------------------

-- Geração de UUID (gen_random_uuid) — já vem no PostgreSQL 13+.
create extension if not exists "pgcrypto";

-- Busca textual tolerante a erros de digitação ("brownie" acha "brownies").
create extension if not exists "pg_trgm";


-- =============================================================================
-- TIPOS ENUMERADOS
-- Restringem os valores possíveis no próprio banco. Um status inválido vira
-- erro de inserção, e não um dado sujo descoberto meses depois.
-- =============================================================================

do $$ begin
  create type perfil_usuario as enum ('cliente', 'revendedor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_pedido as enum (
    'aguardando_pagamento',
    'pagamento_aprovado',
    'em_preparacao',
    'pronto_para_retirada',
    'saiu_para_entrega',
    'entregue',
    'cancelado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_pagamento as enum (
    'pendente',
    'aprovado',
    'recusado',
    'estornado',
    'cancelado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type metodo_pagamento as enum ('pix', 'cartao_credito', 'cartao_debito', 'dinheiro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_revendedor as enum ('pendente', 'aprovado', 'recusado', 'suspenso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_entrega as enum ('entrega', 'retirada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_desconto as enum ('percentual', 'valor_fixo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_movimento_estoque as enum ('entrada', 'saida', 'ajuste', 'perda', 'venda', 'cancelamento');
exception when duplicate_object then null; end $$;


-- =============================================================================
-- FUNÇÃO AUXILIAR: atualizar `atualizado_em` automaticamente
-- =============================================================================

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;


-- =============================================================================
-- 1. PERFIS DE USUÁRIO
--
-- O Supabase já mantém a tabela `auth.users` com e-mail e senha (com hash).
-- Nunca criamos nossa própria tabela de senhas — isso é trabalho do Supabase
-- Auth, que faz hash, confirmação de e-mail e recuperação de senha.
--
-- Esta tabela guarda só o que é NOSSO: perfil, nome, telefone.
-- =============================================================================

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  perfil        perfil_usuario not null default 'cliente',
  nome          text not null,
  telefone      text,
  cpf           text,
  data_nascimento date,
  aceita_marketing boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint profiles_nome_tamanho check (char_length(nome) between 2 and 120),
  constraint profiles_telefone_formato check (
    telefone is null or telefone ~ '^[0-9]{10,11}$'
  )
);

comment on table public.profiles is
  'Dados do usuário que não pertencem ao Supabase Auth. O perfil define as permissões.';
comment on column public.profiles.perfil is
  'ATENÇÃO: só o backend (service_role) pode alterar. Ver políticas em 02-rls.sql.';

drop trigger if exists profiles_atualizado_em on public.profiles;
create trigger profiles_atualizado_em
  before update on public.profiles
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 2. CATEGORIAS
-- =============================================================================

create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  nome          text not null,
  descricao     text,
  icone         text,
  ordem         integer not null default 0,
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Slug precisa ser seguro para URL: minúsculas, números e hífen.
  constraint categories_slug_formato check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.categories is 'Linhas de produto do catálogo.';

create index if not exists categories_ordem_idx on public.categories (ordem) where ativa;

drop trigger if exists categories_atualizado_em on public.categories;
create trigger categories_atualizado_em
  before update on public.categories
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 3. PRODUTOS
-- =============================================================================

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  categoria_id    uuid not null references public.categories(id) on delete restrict,

  slug            text not null unique,
  nome            text not null,
  descricao_curta text,
  descricao       text,
  ingredientes    text,
  alergenicos     text,

  -- Preços SEMPRE em centavos (integer). Ver nota no topo do arquivo.
  preco_varejo    integer not null,
  preco_atacado   integer,
  preco_promocional integer,

  peso_gramas     integer,

  -- Quantidade mínima que um revendedor precisa comprar deste item.
  minimo_atacado  integer not null default 1,

  destaque        boolean not null default false,
  mais_vendido    boolean not null default false,
  novidade        boolean not null default false,
  sazonal         boolean not null default false,

  -- publicado = visível no site. Separado de `arquivado_em`: permite tirar do
  -- ar temporariamente (sabor em falta) sem perder o histórico.
  publicado       boolean not null default false,
  arquivado_em    timestamptz,

  vendas_total    integer not null default 0,

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  constraint products_slug_formato check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_nome_tamanho check (char_length(nome) between 2 and 160),

  -- Preço nunca pode ser zero ou negativo.
  constraint products_preco_varejo_positivo check (preco_varejo > 0),
  constraint products_preco_atacado_positivo check (preco_atacado is null or preco_atacado > 0),
  constraint products_preco_promocional_positivo check (preco_promocional is null or preco_promocional > 0),

  -- O preço de atacado precisa ser menor que o de varejo — senão não é atacado.
  constraint products_atacado_menor check (
    preco_atacado is null or preco_atacado < preco_varejo
  ),

  -- Promoção que não desconta nada é erro de cadastro.
  constraint products_promocional_menor check (
    preco_promocional is null or preco_promocional < preco_varejo
  ),

  constraint products_peso_positivo check (peso_gramas is null or peso_gramas > 0),
  constraint products_minimo_atacado_positivo check (minimo_atacado >= 1)
);

comment on table public.products is 'Catálogo. Preços em CENTAVOS (inteiros).';
comment on column public.products.preco_atacado is
  'Só é exposto a revendedores APROVADOS. A decisão é do backend, nunca do navegador.';
comment on column public.products.arquivado_em is
  'Exclusão suave: preserva o histórico de pedidos que contêm este produto.';

create index if not exists products_categoria_idx on public.products (categoria_id);
create index if not exists products_publicado_idx on public.products (publicado)
  where arquivado_em is null;
create index if not exists products_destaque_idx on public.products (destaque)
  where publicado and arquivado_em is null;
create index if not exists products_mais_vendido_idx on public.products (vendas_total desc)
  where publicado and arquivado_em is null;
create index if not exists products_novidade_idx on public.products (criado_em desc)
  where publicado and arquivado_em is null;

-- Índice de busca textual: acelera a pesquisa por nome e descrição.
create index if not exists products_busca_idx on public.products
  using gin ((nome || ' ' || coalesce(descricao_curta, '')) gin_trgm_ops);

drop trigger if exists products_atualizado_em on public.products;
create trigger products_atualizado_em
  before update on public.products
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 4. IMAGENS DOS PRODUTOS
-- =============================================================================

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references public.products(id) on delete cascade,
  url         text not null,
  alt         text not null,
  ordem       integer not null default 0,
  principal   boolean not null default false,
  criado_em   timestamptz not null default now(),

  -- `alt` é obrigatório: acessibilidade e SEO dependem dele.
  constraint product_images_alt_preenchido check (char_length(trim(alt)) > 0)
);

comment on table public.product_images is 'Fotos. Arquivos ficam no Supabase Storage.';

create index if not exists product_images_produto_idx on public.product_images (produto_id, ordem);

-- Garante no máximo UMA imagem principal por produto.
create unique index if not exists product_images_uma_principal
  on public.product_images (produto_id) where principal;


-- =============================================================================
-- 5. ESTOQUE
-- =============================================================================

create table if not exists public.inventory (
  produto_id      uuid primary key references public.products(id) on delete cascade,
  quantidade      integer not null default 0,

  -- Reservado = em carrinhos/pedidos aguardando pagamento.
  -- O disponível real é quantidade - reservado.
  reservado       integer not null default 0,

  alerta_minimo   integer not null default 5,

  -- Quando true, o produto pode ser vendido mesmo com estoque zero
  -- (feito sob encomenda).
  sob_encomenda   boolean not null default false,

  atualizado_em   timestamptz not null default now(),

  constraint inventory_quantidade_nao_negativa check (quantidade >= 0),
  constraint inventory_reservado_nao_negativo check (reservado >= 0),
  constraint inventory_reservado_coerente check (reservado <= quantidade)
);

comment on table public.inventory is 'Estoque atual. O histórico fica em inventory_movements.';

drop trigger if exists inventory_atualizado_em on public.inventory;
create trigger inventory_atualizado_em
  before update on public.inventory
  for each row execute function public.tocar_atualizado_em();


-- Histórico de movimentações: nunca se apaga, só se acrescenta.
create table if not exists public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  produto_id    uuid not null references public.products(id) on delete cascade,
  tipo          tipo_movimento_estoque not null,

  -- Positivo para entrada, negativo para saída.
  quantidade    integer not null,

  -- Fotografia do saldo após o movimento: permite auditar sem recalcular tudo.
  saldo_apos    integer not null,

  motivo        text,
  pedido_id     uuid,
  usuario_id    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),

  constraint inventory_movements_quantidade_nao_zero check (quantidade <> 0)
);

comment on table public.inventory_movements is
  'Livro-razão do estoque. Somente inserção — nunca atualizar nem excluir.';

create index if not exists inventory_movements_produto_idx
  on public.inventory_movements (produto_id, criado_em desc);


-- =============================================================================
-- 6. ENDEREÇOS
-- =============================================================================

create table if not exists public.addresses (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  apelido       text,
  cep           text not null,
  logradouro    text not null,
  numero        text not null,
  complemento   text,
  bairro        text not null,
  cidade        text not null,
  estado        char(2) not null,
  referencia    text,
  principal     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint addresses_cep_formato check (cep ~ '^[0-9]{8}$'),
  constraint addresses_estado_formato check (estado ~ '^[A-Z]{2}$')
);

create index if not exists addresses_usuario_idx on public.addresses (usuario_id);
create unique index if not exists addresses_um_principal
  on public.addresses (usuario_id) where principal;

drop trigger if exists addresses_atualizado_em on public.addresses;
create trigger addresses_atualizado_em
  before update on public.addresses
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 7. REVENDEDORES
-- =============================================================================

create table if not exists public.resellers (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid unique references auth.users(id) on delete cascade,

  nome_responsavel    text not null,
  nome_estabelecimento text not null,
  cnpj                text,
  tipo_estabelecimento text,
  cidade              text not null,
  estado              char(2),
  endereco            text,
  whatsapp            text not null,
  email               text,
  quantidade_estimada text,
  mensagem            text,

  status              status_revendedor not null default 'pendente',

  -- Condições comerciais definidas pelo administrador na aprovação.
  desconto_percentual numeric(5,2) default 0,
  pedido_minimo_centavos integer default 0,
  observacoes_internas text,

  aprovado_em         timestamptz,
  aprovado_por        uuid references auth.users(id) on delete set null,
  motivo_recusa       text,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  constraint resellers_cnpj_formato check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint resellers_whatsapp_formato check (whatsapp ~ '^[0-9]{10,11}$'),
  constraint resellers_desconto_faixa check (desconto_percentual between 0 and 100)
);

comment on table public.resellers is
  'Cadastro comercial. Só status = aprovado libera preço de atacado.';
comment on column public.resellers.status is
  'ATENÇÃO: alterável apenas pelo backend com service_role. Ver 02-rls.sql.';

create index if not exists resellers_status_idx on public.resellers (status);

drop trigger if exists resellers_atualizado_em on public.resellers;
create trigger resellers_atualizado_em
  before update on public.resellers
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 8. CUPONS
-- =============================================================================

create table if not exists public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  descricao           text,

  tipo                tipo_desconto not null,
  valor               integer not null,

  valor_minimo_pedido integer not null default 0,
  desconto_maximo     integer,

  -- null = ilimitado
  limite_usos         integer,
  limite_por_cliente  integer default 1,
  usos                integer not null default 0,

  valido_de           timestamptz not null default now(),
  valido_ate          timestamptz,

  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  -- Código sempre em maiúsculas, sem espaço.
  constraint coupons_codigo_formato check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  constraint coupons_valor_positivo check (valor > 0),

  -- Percentual não pode passar de 100%.
  constraint coupons_percentual_valido check (
    tipo <> 'percentual' or valor <= 100
  ),

  constraint coupons_periodo_valido check (
    valido_ate is null or valido_ate > valido_de
  ),
  constraint coupons_usos_dentro_do_limite check (
    limite_usos is null or usos <= limite_usos
  )
);

comment on column public.coupons.valor is
  'Percentual (1-100) quando tipo = percentual; CENTAVOS quando tipo = valor_fixo.';

create index if not exists coupons_codigo_idx on public.coupons (codigo) where ativo;

drop trigger if exists coupons_atualizado_em on public.coupons;
create trigger coupons_atualizado_em
  before update on public.coupons
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 9. PROMOÇÕES
-- =============================================================================

create table if not exists public.promotions (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  descricao     text,
  tipo          tipo_desconto not null,
  valor         integer not null,

  -- null nos dois = vale para o catálogo inteiro.
  categoria_id  uuid references public.categories(id) on delete cascade,
  produto_id    uuid references public.products(id) on delete cascade,

  inicia_em     timestamptz not null default now(),
  termina_em    timestamptz,
  ativa         boolean not null default true,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint promotions_valor_positivo check (valor > 0),
  constraint promotions_percentual_valido check (tipo <> 'percentual' or valor <= 100),
  constraint promotions_periodo_valido check (termina_em is null or termina_em > inicia_em)
);

create index if not exists promotions_ativa_idx on public.promotions (ativa, inicia_em, termina_em);

drop trigger if exists promotions_atualizado_em on public.promotions;
create trigger promotions_atualizado_em
  before update on public.promotions
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 10. PEDIDOS
-- =============================================================================

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),

  -- Código curto e legível para o cliente informar no WhatsApp.
  codigo              text not null unique,

  usuario_id          uuid references auth.users(id) on delete set null,

  -- Dados de contato COPIADOS no momento do pedido.
  -- Se o cliente mudar o telefone depois, o pedido antigo preserva o que
  -- valia naquele dia. Isso é proposital.
  cliente_nome        text not null,
  cliente_email       text,
  cliente_whatsapp    text not null,

  status              status_pedido not null default 'aguardando_pagamento',

  tipo_entrega        tipo_entrega not null default 'retirada',
  endereco_entrega    jsonb,
  data_desejada       date,
  observacoes         text,

  -- Todos os valores em CENTAVOS.
  subtotal_centavos   integer not null default 0,
  desconto_centavos   integer not null default 0,
  frete_centavos      integer not null default 0,
  total_centavos      integer not null default 0,

  cupom_codigo        text,
  cupom_id            uuid references public.coupons(id) on delete set null,

  -- Marca se este pedido usou preço de atacado.
  eh_atacado          boolean not null default false,

  cancelado_em        timestamptz,
  motivo_cancelamento text,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  constraint orders_codigo_formato check (codigo ~ '^DF[0-9A-Z]{8}$'),
  constraint orders_whatsapp_formato check (cliente_whatsapp ~ '^[0-9]{10,11}$'),
  constraint orders_valores_nao_negativos check (
    subtotal_centavos >= 0 and desconto_centavos >= 0
    and frete_centavos >= 0 and total_centavos >= 0
  ),

  -- O total precisa fechar a conta. Esta checagem no BANCO impede que um
  -- erro de cálculo no código grave um pedido com valor inconsistente.
  constraint orders_total_confere check (
    total_centavos = subtotal_centavos - desconto_centavos + frete_centavos
  ),

  -- Entrega exige endereço.
  constraint orders_entrega_exige_endereco check (
    tipo_entrega <> 'entrega' or endereco_entrega is not null
  )
);

comment on table public.orders is 'Pedidos. Valores em CENTAVOS, validados por constraint.';
comment on column public.orders.codigo is 'Formato DF + 8 caracteres. Ex.: DF7K2M9X4P';

create index if not exists orders_usuario_idx on public.orders (usuario_id, criado_em desc);
create index if not exists orders_status_idx on public.orders (status, criado_em desc);
create index if not exists orders_codigo_idx on public.orders (codigo);
create index if not exists orders_criado_idx on public.orders (criado_em desc);

drop trigger if exists orders_atualizado_em on public.orders;
create trigger orders_atualizado_em
  before update on public.orders
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 11. ITENS DO PEDIDO
-- =============================================================================

create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid not null references public.orders(id) on delete cascade,

  -- `set null` em vez de cascade: se o produto for excluído, o item do pedido
  -- permanece com o nome e o preço registrados.
  produto_id        uuid references public.products(id) on delete set null,

  -- Nome e preço COPIADOS. Se o preço mudar amanhã, o pedido de hoje continua
  -- mostrando o que o cliente realmente pagou.
  produto_nome      text not null,
  produto_slug      text,
  preco_unitario_centavos integer not null,
  quantidade        integer not null,
  subtotal_centavos integer not null,

  criado_em         timestamptz not null default now(),

  constraint order_items_quantidade_positiva check (quantidade > 0),
  constraint order_items_preco_positivo check (preco_unitario_centavos > 0),

  -- O subtotal da linha tem que bater com preço × quantidade.
  constraint order_items_subtotal_confere check (
    subtotal_centavos = preco_unitario_centavos * quantidade
  )
);

create index if not exists order_items_pedido_idx on public.order_items (pedido_id);
create index if not exists order_items_produto_idx on public.order_items (produto_id);


-- =============================================================================
-- 12. PAGAMENTOS
-- =============================================================================

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  pedido_id             uuid not null references public.orders(id) on delete cascade,

  metodo                metodo_pagamento not null,
  status                status_pagamento not null default 'pendente',
  valor_centavos        integer not null,

  -- Identificador da transação no Mercado Pago.
  gateway               text not null default 'mercadopago',
  gateway_payment_id    text,
  gateway_status        text,

  -- Chave de idempotência: impede cobrar duas vezes se o cliente clicar
  -- duas vezes em "pagar" ou se o webhook chegar repetido.
  idempotency_key       text unique,

  qr_code               text,
  qr_code_base64        text,
  link_pagamento        text,

  -- Resposta completa do gateway, para auditoria e depuração.
  payload_gateway       jsonb,

  pago_em               timestamptz,
  expira_em             timestamptz,

  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),

  constraint payments_valor_positivo check (valor_centavos > 0)
);

comment on table public.payments is
  'Transações. A confirmação vem SEMPRE do webhook validado, nunca do retorno do navegador.';
comment on column public.payments.idempotency_key is
  'Impede cobrança duplicada. O índice único é a garantia real.';

create index if not exists payments_pedido_idx on public.payments (pedido_id);
create index if not exists payments_gateway_idx on public.payments (gateway_payment_id);
create index if not exists payments_status_idx on public.payments (status);

drop trigger if exists payments_atualizado_em on public.payments;
create trigger payments_atualizado_em
  before update on public.payments
  for each row execute function public.tocar_atualizado_em();


-- =============================================================================
-- 13. MENSAGENS DE CONTATO
-- =============================================================================

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  whatsapp    text not null,
  email       text,
  assunto     text not null,
  mensagem    text not null,
  respondida  boolean not null default false,
  criado_em   timestamptz not null default now(),

  constraint contact_messages_mensagem_tamanho check (
    char_length(mensagem) between 10 and 1000
  )
);

create index if not exists contact_messages_criado_idx
  on public.contact_messages (criado_em desc) where not respondida;


-- =============================================================================
-- 14. FUNÇÕES DE APOIO
-- =============================================================================

-- Gera um código de pedido curto, legível e sem ambiguidade visual.
-- Removidas as letras I, O e os números 0, 1 — para ninguém errar ao ditar
-- o código por telefone.
-- ATENÇÃO AO PREFIXO `v_` NAS VARIÁVEIS:
--   Uma variável chamada `codigo` colidiria com a coluna `codigo` da tabela
--   `orders`, e o PostgreSQL recusaria a função com
--   "column reference codigo is ambiguous" (erro 42702). Qualificar apenas um
--   dos lados da comparação não resolve — os dois precisam ser inequívocos.
create or replace function public.gerar_codigo_pedido()
returns text
language plpgsql
as $$
declare
  c_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_codigo    text;
  v_tentativa integer := 0;
  v_existe    boolean;
begin
  loop
    v_codigo := 'DF';

    for i in 1..8 loop
      v_codigo := v_codigo ||
        substr(c_alfabeto, floor(random() * length(c_alfabeto) + 1)::int, 1);
    end loop;

    select exists (
      select 1 from public.orders o where o.codigo = v_codigo
    ) into v_existe;

    -- Em um universo de 32^8 combinações a colisão é improvável, mas o
    -- laço garante que nunca devolvemos um código repetido.
    exit when not v_existe;

    v_tentativa := v_tentativa + 1;
    if v_tentativa > 20 then
      raise exception 'Não foi possível gerar um código de pedido único.';
    end if;
  end loop;

  return v_codigo;
end;
$$;


-- Verifica se o usuário autenticado é administrador.
-- Usada pelas políticas RLS. `security definer` permite consultar a tabela
-- profiles sem cair na própria política que estamos avaliando.
create or replace function public.eh_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and perfil = 'admin'
  );
$$;


-- Verifica se o usuário autenticado é revendedor APROVADO.
create or replace function public.eh_revendedor_aprovado()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.resellers
    where usuario_id = auth.uid() and status = 'aprovado'
  );
$$;


-- Cria o perfil automaticamente quando um usuário se cadastra.
-- Sem isso, haveria um usuário em auth.users sem linha em profiles.
create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, perfil)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    -- Todo cadastro novo nasce como 'cliente'. Promoção a admin ou
    -- revendedor é sempre ação deliberada, feita pelo backend.
    'cliente'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_para_novo_usuario();


-- Cria a linha de estoque junto com o produto.
create or replace function public.criar_estoque_para_novo_produto()
returns trigger
language plpgsql
as $$
begin
  insert into public.inventory (produto_id, quantidade)
  values (new.id, 0)
  on conflict (produto_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_produto on public.products;
create trigger ao_criar_produto
  after insert on public.products
  for each row execute function public.criar_estoque_para_novo_produto();


-- =============================================================================
-- 15. VISÃO PÚBLICA DO CATÁLOGO
--
-- Esta visão NUNCA expõe `preco_atacado`. O preço de atacado só é entregue
-- pelo backend, depois de confirmar no banco que o usuário é revendedor
-- aprovado. É uma barreira estrutural: mesmo que um erro de programação
-- exponha esta visão ao público, o preço de atacado não vaza.
-- =============================================================================

create or replace view public.catalogo_publico as
select
  p.id,
  p.slug,
  p.nome,
  p.descricao_curta,
  p.descricao,
  p.ingredientes,
  p.alergenicos,
  p.preco_varejo,
  p.preco_promocional,
  p.peso_gramas,
  p.destaque,
  p.mais_vendido,
  p.novidade,
  p.sazonal,
  p.vendas_total,
  p.criado_em,
  c.slug  as categoria_slug,
  c.nome  as categoria_nome,
  c.icone as categoria_icone,
  coalesce(e.quantidade - e.reservado, 0) as disponivel,
  coalesce(e.sob_encomenda, false) as sob_encomenda,
  (
    select json_agg(json_build_object('url', i.url, 'alt', i.alt, 'principal', i.principal)
                    order by i.principal desc, i.ordem)
    from public.product_images i where i.produto_id = p.id
  ) as imagens
from public.products p
join public.categories c on c.id = p.categoria_id
left join public.inventory e on e.produto_id = p.id
where p.publicado
  and p.arquivado_em is null
  and c.ativa;

comment on view public.catalogo_publico is
  'Catálogo visível ao público. NÃO contém preco_atacado — por segurança.';
