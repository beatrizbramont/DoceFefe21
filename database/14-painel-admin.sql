-- =============================================================================
-- DOCE FEFÊ.21 — 14-painel-admin.sql
-- Fase 9: o que o painel administrativo precisa do banco
-- =============================================================================
--
-- EXECUTE DEPOIS DE 13.
--
-- O QUE ESTE ARQUIVO CRIA
--
--   1. Bucket `produtos` no Storage — fotos do catálogo, enviadas pelo painel
--   2. Função `ajustar_estoque`   — muda o saldo E grava o histórico, junto
--   3. Função `resumo_admin`      — os números do dashboard em uma só consulta
--   4. Visão  `clientes_admin`    — clientes com total de compras
--
-- -----------------------------------------------------------------------------
-- POR QUE FUNÇÕES NO BANCO EM VEZ DE CÓDIGO NO SERVIDOR
--
--   Ajustar estoque são DUAS escritas que precisam acontecer juntas: mudar o
--   saldo em `inventory` e registrar o movimento em `inventory_movements`.
--   Feitas pelo backend, em duas chamadas HTTP, nada garante que a segunda
--   aconteça — uma queda de rede no meio deixaria o saldo alterado sem
--   nenhum registro de quem mexeu. Dentro de uma função, ou as duas
--   acontecem, ou nenhuma.
--
--   O dashboard é o oposto: uma consulta só, porém pesada. Calcular
--   faturamento, ticket médio e mais vendidos no servidor significaria baixar
--   todos os pedidos para somá-los em JavaScript. O banco soma onde os dados
--   estão.
-- =============================================================================


-- =============================================================================
-- 1. BUCKET DAS FOTOS DE PRODUTO
--
-- ⚠️ PÚBLICO — ao contrário do bucket `comprovantes`.
--
--   São duas naturezas opostas de arquivo:
--
--     comprovantes → dado pessoal de UMA cliente (nome, banco, valor).
--                    Bucket privado, link assinado que expira.
--
--     produtos     → foto de brownie, feita para ser vista por todo mundo.
--                    Bucket público, URL direta e cacheável pelo navegador.
--
--   Tornar as fotos privadas não protegeria nada e ainda obrigaria cada
--   visitante da loja a pedir um link assinado por imagem.
--
-- O que continua protegido é a ESCRITA: nenhuma política de insert, update ou
-- delete é criada. Sem política, o RLS do Storage nega essas operações para as
-- chaves pública e autenticada. Só a chave de serviço — exclusiva do backend,
-- atrás de `exigirAdmin` — consegue gravar.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'produtos',
  'produtos',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];


-- =============================================================================
-- 2. AJUSTE DE ESTOQUE
--
-- Os quatro tipos que o painel usa:
--
--   entrada  → chegou mercadoria        (soma)
--   saida    → saiu sem ser venda       (subtrai)
--   perda    → quebrou, venceu, caiu    (subtrai)
--   ajuste   → contagem física          (define o valor absoluto)
--
-- `venda` e `cancelamento` existem no enum, mas são gravados pela função de
-- criar pedido. O painel não os emite: estoque de venda muda pela venda.
-- =============================================================================

create or replace function public.ajustar_estoque(
  p_produto_id uuid,
  p_tipo       text,
  p_quantidade integer,
  p_motivo     text default null,
  p_usuario_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo_antes integer;
  v_reservado   integer;
  v_saldo_apos  integer;
  v_delta       integer;
  v_nome        text;
begin
  if p_tipo not in ('entrada', 'saida', 'perda', 'ajuste') then
    raise exception 'TIPO_INVALIDO'
      using hint = 'O movimento precisa ser entrada, saída, perda ou ajuste.';
  end if;

  if p_quantidade is null or p_quantidade < 0 then
    raise exception 'QUANTIDADE_INVALIDA'
      using hint = 'Informe uma quantidade de zero para cima.';
  end if;

  -- `for update` segura a linha até o fim da função. Sem isso, dois ajustes
  -- simultâneos leriam o mesmo saldo e o segundo apagaria o primeiro.
  select e.quantidade, e.reservado, p.nome
    into v_saldo_antes, v_reservado, v_nome
    from public.inventory e
    join public.products p on p.id = e.produto_id
   where e.produto_id = p_produto_id
     for update of e;

  if not found then
    raise exception 'PRODUTO_NAO_ENCONTRADO'
      using hint = 'Este produto não existe ou não tem ficha de estoque.';
  end if;

  -- Saldo final conforme o tipo.
  v_saldo_apos := case p_tipo
    when 'entrada' then v_saldo_antes + p_quantidade
    when 'ajuste'  then p_quantidade
    else                v_saldo_antes - p_quantidade
  end;

  v_delta := v_saldo_apos - v_saldo_antes;

  if v_delta = 0 then
    raise exception 'SEM_ALTERACAO'
      using hint = 'O saldo informado é igual ao atual.';
  end if;

  if v_saldo_apos < 0 then
    raise exception 'SALDO_NEGATIVO'
      using hint = format('Há apenas %s em estoque.', v_saldo_antes);
  end if;

  -- Peças reservadas já pertencem a pedidos em andamento. Baixar o estoque
  -- abaixo delas significaria vender o que já foi vendido.
  if v_saldo_apos < v_reservado then
    raise exception 'ABAIXO_DO_RESERVADO'
      using hint = format(
        '%s unidade(s) estão reservadas para pedidos em andamento.', v_reservado
      );
  end if;

  update public.inventory
     set quantidade = v_saldo_apos
   where produto_id = p_produto_id;

  -- O histórico guarda o MOVIMENTO (delta), não o saldo pedido. Assim um
  -- ajuste de 12 para 8 aparece como "-4", comparável com uma perda de 4.
  insert into public.inventory_movements (
    produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id
  )
  values (
    p_produto_id,
    p_tipo::tipo_movimento_estoque,
    v_delta,
    v_saldo_apos,
    nullif(trim(coalesce(p_motivo, '')), ''),
    p_usuario_id
  );

  return jsonb_build_object(
    'produto_id',  p_produto_id,
    'produto',     v_nome,
    'saldo_antes', v_saldo_antes,
    'saldo_apos',  v_saldo_apos,
    'movimento',   v_delta
  );
end;
$$;

comment on function public.ajustar_estoque is
  'Muda o saldo e grava o movimento na mesma transação. Recusa saldo '
  'negativo ou abaixo do que já está reservado para pedidos.';

-- A função é `security definer` para gravar o histórico mesmo com o RLS de
-- `inventory_movements` restrito a admin. Quem pode CHAMÁ-LA continua sendo
-- decidido pelo backend (`exigirAdmin`): revogamos o acesso de todo o resto.
revoke all on function public.ajustar_estoque(uuid, text, integer, text, uuid)
  from public, anon, authenticated;

-- O backend fala com o banco usando a chave de serviço. O grant explícito
-- deixa claro que ela — e só ela — executa esta função.
grant execute on function public.ajustar_estoque(uuid, text, integer, text, uuid)
  to service_role;


-- =============================================================================
-- 3. RESUMO DO DASHBOARD
--
-- Um pedido só entra no faturamento depois de `pagamento_aprovado` — ou seja,
-- depois que alguém conferiu o dinheiro na conta. Pedido criado não é venda;
-- comprovante enviado também não.
-- =============================================================================

create or replace function public.resumo_admin(p_dias integer default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  periodo as (
    select now() - (greatest(coalesce(p_dias, 30), 1) || ' days')::interval as desde
  ),

  -- Pedidos que já viraram dinheiro: aprovados ou adiante no fluxo.
  pagos as (
    select o.*
      from public.orders o, periodo
     where o.criado_em >= periodo.desde
       and o.status in (
         'pagamento_aprovado', 'em_preparacao',
         'pronto_para_retirada', 'saiu_para_entrega', 'entregue'
       )
  ),

  faturamento as (
    select
      coalesce(sum(total_centavos), 0)::bigint as total,
      count(*)                                 as pedidos
      from pagos
  ),

  fila as (
    select
      count(*) filter (where status = 'aguardando_pagamento') as aguardando_pagamento,
      count(*) filter (where status = 'comprovante_enviado')  as a_conferir,
      count(*) filter (where status = 'em_preparacao')        as em_preparacao,
      count(*) filter (where status in ('pronto_para_retirada', 'saiu_para_entrega'))
        as a_entregar
      from public.orders
     where status not in ('entregue', 'cancelado')
  ),

  novos_clientes as (
    select count(*) as total
      from public.profiles, periodo
     where profiles.criado_em >= periodo.desde
  ),

  -- `ordem` existe para o jsonb_agg ordenar por NÚMERO. Ordenar pelo campo
  -- dentro do JSON compararia texto, onde "9" vem depois de "10".
  mais_vendidos as (
    select coalesce(jsonb_agg(linha order by ordem desc), '[]'::jsonb) as lista
    from (
      select
        sum(i.quantidade) as ordem,
        jsonb_build_object(
          'nome',       i.produto_nome,
          'slug',       i.produto_slug,
          'quantidade', sum(i.quantidade),
          'total',      sum(i.subtotal_centavos)
        ) as linha
        from public.order_items i
        join pagos o on o.id = i.pedido_id
       group by i.produto_nome, i.produto_slug
       order by sum(i.quantidade) desc
       limit 5
    ) t
  ),

  -- Produtos que vão faltar. `sob_encomenda` fica de fora: produzidos sob
  -- demanda, não têm saldo para acabar.
  estoque_baixo as (
    select coalesce(jsonb_agg(linha order by ordem), '[]'::jsonb) as lista
    from (
      select
        (e.quantidade - e.reservado) as ordem,
        jsonb_build_object(
          'nome',       p.nome,
          'slug',       p.slug,
          'disponivel', e.quantidade - e.reservado,
          'minimo',     e.alerta_minimo
        ) as linha
        from public.inventory e
        join public.products p on p.id = e.produto_id
       where p.arquivado_em is null
         and p.publicado
         and not e.sob_encomenda
         and (e.quantidade - e.reservado) <= e.alerta_minimo
       order by (e.quantidade - e.reservado)
       limit 8
    ) t
  ),

  catalogo as (
    select
      count(*) filter (where arquivado_em is null)                   as total,
      count(*) filter (where arquivado_em is null and publicado)     as publicados,
      count(*) filter (where arquivado_em is null and not publicado) as rascunhos
      from public.products
  )

select jsonb_build_object(
  'periodo_dias',      greatest(coalesce(p_dias, 30), 1),
  'faturamento',       (select total from faturamento),
  'pedidos_pagos',     (select pedidos from faturamento),
  'ticket_medio',      case
                         when (select pedidos from faturamento) > 0
                         then round(
                           (select total from faturamento)::numeric
                           / (select pedidos from faturamento)
                         )::bigint
                         else 0
                       end,
  'clientes_novos',    (select total from novos_clientes),
  'fila',              (select to_jsonb(fila) from fila),
  'catalogo',          (select to_jsonb(catalogo) from catalogo),
  'mais_vendidos',     (select lista from mais_vendidos),
  'estoque_baixo',     (select lista from estoque_baixo)
);
$$;

comment on function public.resumo_admin is
  'Números do dashboard. Faturamento conta apenas pedidos com pagamento já '
  'conferido pela loja.';

revoke all on function public.resumo_admin(integer) from public, anon, authenticated;
grant execute on function public.resumo_admin(integer) to service_role;


-- =============================================================================
-- 4. VISÃO DE CLIENTES
--
-- O e-mail mora em `auth.users`, que o PostgREST não expõe. Esta visão junta
-- o que o painel precisa mostrar numa linha só.
--
-- ⚠️ Sem `security_invoker`, de propósito: a visão precisa ler `auth.users`,
--   onde nem um usuário autenticado comum tem permissão. Por isso o acesso é
--   REVOGADO de anon e authenticated logo abaixo — só a chave de serviço, no
--   backend atrás de `exigirAdmin`, consegue ler.
-- =============================================================================

create or replace view public.clientes_admin as
select
  p.id,
  p.nome,
  p.perfil,
  p.telefone,
  p.aceita_marketing,
  p.criado_em,
  u.email,
  u.last_sign_in_at                       as ultimo_acesso,
  coalesce(c.pedidos, 0)                  as pedidos,
  coalesce(c.gasto_centavos, 0)::bigint   as gasto_centavos,
  c.ultimo_pedido_em
from public.profiles p
join auth.users u on u.id = p.id
left join (
  select
    usuario_id,
    count(*)                   as pedidos,
    sum(total_centavos)        as gasto_centavos,
    max(criado_em)             as ultimo_pedido_em
  from public.orders
  where usuario_id is not null
    and status in (
      'pagamento_aprovado', 'em_preparacao',
      'pronto_para_retirada', 'saiu_para_entrega', 'entregue'
    )
  group by usuario_id
) c on c.usuario_id = p.id;

comment on view public.clientes_admin is
  'Clientes com e-mail e histórico de compras, para o painel. Só a chave de '
  'serviço lê — o acesso de anon e authenticated é revogado.';

revoke all on public.clientes_admin from anon, authenticated;
grant select on public.clientes_admin to service_role;


-- =============================================================================
-- 5. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_bucket   integer;
  v_funcoes  integer;
  v_visao    integer;
  v_politica integer;
begin
  select count(*) into v_bucket
    from storage.buckets where id = 'produtos' and public;

  if v_bucket <> 1 then
    raise exception 'Bucket "produtos" não foi criado como público.';
  end if;

  -- Nenhuma política de escrita no bucket novo: só o backend grava.
  select count(*) into v_politica
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and qual ilike '%produtos%';

  select count(*) into v_funcoes
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'public'
     and pr.proname in ('ajustar_estoque', 'resumo_admin');

  if v_funcoes <> 2 then
    raise exception 'Esperadas 2 funções novas, encontradas %.', v_funcoes;
  end if;

  select count(*) into v_visao
    from information_schema.views
   where table_schema = 'public' and table_name = 'clientes_admin';

  if v_visao <> 1 then
    raise exception 'A visão clientes_admin não foi criada.';
  end if;

  -- A visão não pode vazar para quem não é administrador.
  if has_table_privilege('anon', 'public.clientes_admin', 'select') then
    raise exception 'FALHA GRAVE: clientes_admin está legível por anon!';
  end if;

  if has_table_privilege('authenticated', 'public.clientes_admin', 'select') then
    raise exception 'FALHA GRAVE: clientes_admin está legível por authenticated!';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: bucket "produtos" público para leitura';
  raise notice '  OK: % política(s) de escrita no bucket (0 = só o backend)', v_politica;
  raise notice '  OK: ajustar_estoque e resumo_admin criadas';
  raise notice '  OK: clientes_admin criada e fechada ao público';
  raise notice '';
  raise notice '  O painel completo está em /admin/dashboard.html';
  raise notice '──────────────────────────────────────────────';
end $$;
