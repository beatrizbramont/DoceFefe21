-- =============================================================================
-- DOCE FEFÊ.21 — 10-ordem-produtos.sql
-- Ordem de exibição definida pela loja
-- =============================================================================
--
-- EXECUTE DEPOIS DE 09.
--
-- O PROBLEMA QUE ESTE ARQUIVO RESOLVE
--
--   Os Kits de Natal apareciam fora de ordem na vitrine:
--
--       Kit 1 ... R$ 12,90
--       Kit 2 ... R$ 26,00
--       Kit 4 ... R$ 34,00   ← fora de lugar
--       Kit 3 ... R$ 35,00
--
--   Não era bug de ordenação: a lista estava corretamente ordenada por PREÇO,
--   e o Kit 4 realmente custa menos que o Kit 3 (a diferença entre eles é a
--   embalagem). Só que, para o cliente, ler "1, 2, 4, 3" parece erro.
--
-- -----------------------------------------------------------------------------
-- POR QUE UMA COLUNA `ordem`, E NÃO ORDENAR PELO NOME
--
--   Ordenar por nome funcionaria HOJE, porque os kits se chamam "Kit 1",
--   "Kit 2"... Mas quebraria no primeiro produto que fugisse desse padrão —
--   e um "Kit 10" viria antes do "Kit 2", porque texto ordena como texto.
--
--   Uma coluna numérica diz explicitamente em que posição a loja quer cada
--   produto, independente de nome ou preço. É também o que o painel
--   administrativo vai manipular na Fase 9.
-- =============================================================================


-- =============================================================================
-- 1. COLUNA DE ORDEM
-- =============================================================================

alter table public.products
  add column if not exists ordem integer not null default 0;

comment on column public.products.ordem is
  'Posição na vitrine, definida pela loja. Menor aparece primeiro. '
  'Zero = sem posição definida (cai nos critérios seguintes de ordenação).';

create index if not exists products_ordem_idx on public.products (ordem)
  where publicado and arquivado_em is null;


-- =============================================================================
-- 2. ORDEM DOS KITS DE NATAL
-- =============================================================================

update public.products set ordem = 1 where slug = 'kit-natal-1-arvore';
update public.products set ordem = 2 where slug = 'kit-natal-2-cesta';
update public.products set ordem = 3 where slug = 'kit-natal-3-papai-noel';
update public.products set ordem = 4 where slug = 'kit-natal-4-papai-noel-especial';


-- =============================================================================
-- 3. A VISÃO PRECISA EXPOR `ordem`
--
-- `drop` + `create`, como nas migrações anteriores: `create or replace` só
-- permite acrescentar colunas no fim da lista.
-- =============================================================================

drop view if exists public.catalogo_publico;

create view public.catalogo_publico as
select
  p.id,
  p.slug,
  p.nome,
  p.descricao_curta,
  p.descricao,
  p.ingredientes,
  p.alergenicos,
  p.preco_varejo,

  case
    when p.preco_promocional is not null
     and (p.promocao_ate is null or p.promocao_ate > now())
    then p.preco_promocional
  end as preco_promocional,

  case
    when p.preco_promocional is not null
     and (p.promocao_ate is null or p.promocao_ate > now())
    then p.preco_promocional
    else p.preco_varejo
  end as preco_efetivo,

  (
    p.preco_promocional is not null
    and p.preco_promocional < p.preco_varejo
    and (p.promocao_ate is null or p.promocao_ate > now())
  ) as em_promocao,

  case
    when p.preco_promocional is not null and p.promocao_ate > now()
    then p.promocao_ate
  end as promocao_ate,

  p.ordem,
  p.peso_gramas,
  p.destaque,
  p.mais_vendido,
  p.novidade,
  p.sazonal,
  p.vendas_total,
  p.criado_em,
  c.slug      as categoria_slug,
  c.nome      as categoria_nome,
  c.icone     as categoria_icone,
  c.em_breve  as categoria_em_breve,
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
  'Catálogo visível ao público. NÃO contém preco_atacado — por segurança. '
  'Promoções expiram sozinhas (promocao_ate). A coluna ordem define a '
  'sequência de exibição escolhida pela loja.';

alter view public.catalogo_publico set (security_invoker = on);
grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 4. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_invocador text;
  r           record;
  v_esperado  integer := 1;
begin
  -- Segurança: a visão não pode expor atacado nem furar o RLS.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'catalogo_publico'
       and column_name = 'preco_atacado'
  ) then
    raise exception 'FALHA GRAVE: catalogo_publico expõe preco_atacado!';
  end if;

  select coalesce(
    (select option_value from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'),
    'off'
  ) into v_invocador
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'catalogo_publico';

  if v_invocador is distinct from 'on' then
    raise exception 'security_invoker não está ativo — a visão burlaria o RLS!';
  end if;

  -- A promoção precisa continuar valendo.
  if not exists (
    select 1 from public.catalogo_publico
     where slug = 'pao-de-mel-tradicional' and em_promocao
  ) then
    raise exception 'A promoção do pão de mel se perdeu na migração.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: preço de atacado protegido';
  raise notice '  OK: security_invoker ativo';
  raise notice '  OK: promoção preservada';
  raise notice '';
  raise notice '  Kits na ordem:';

  -- Confere que a sequência saiu 1, 2, 3, 4 — e não só que as posições
  -- existem.
  for r in
    select nome, ordem, preco_efetivo
      from public.catalogo_publico
     where slug like 'kit-natal-%'
     order by ordem asc
  loop
    if r.ordem <> v_esperado then
      raise exception 'Ordem fora de sequência: esperado %, veio % (%)',
        v_esperado, r.ordem, r.nome;
    end if;

    raise notice '    % — %  R$ %',
      r.ordem, rpad(r.nome, 34), to_char(r.preco_efetivo / 100.0, 'FM990.00');

    v_esperado := v_esperado + 1;
  end loop;

  raise notice '──────────────────────────────────────────────';
end $$;
