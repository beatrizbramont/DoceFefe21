-- =============================================================================
-- DOCE FEFÊ.21 — 09-promocoes-com-validade.sql
-- Promoções que expiram sozinhas na data
-- =============================================================================
--
-- EXECUTE DEPOIS DE 08.
--
-- O QUE ESTE ARQUIVO FAZ
--
--   1. Acrescenta a coluna `promocao_ate` aos produtos.
--   2. Coloca o Pão de Mel Tradicional em promoção: R$ 8,50 até 10/12.
--   3. Faz a visão do catálogo RESPEITAR essa data.
--
-- -----------------------------------------------------------------------------
-- POR QUE A DATA FICA NO BANCO, E NÃO NUM AVISO PARA LEMBRAR DE TIRAR
--
--   Sem data, alguém precisaria lembrar de remover a promoção no dia 10/12.
--   E ninguém lembra — o resultado seria o site vendendo por R$ 8,50 em
--   janeiro, com prejuízo, até alguém perceber.
--
--   Com `promocao_ate`, a visão simplesmente deixa de aplicar o desconto
--   quando a data passa. O preço volta a R$ 10,00 sozinho, e o produto some
--   da vitrine de promoções no mesmo instante. Zero intervenção.
--
--   A checagem acontece a cada consulta, usando `now()` do banco — que é a
--   mesma referência de tempo para todo mundo, independente do fuso do
--   navegador de quem acessa.
-- =============================================================================


-- =============================================================================
-- 1. COLUNA DE VALIDADE
-- =============================================================================

alter table public.products
  add column if not exists promocao_ate timestamptz;

comment on column public.products.promocao_ate is
  'Data e hora em que a promoção expira. Depois dela, preco_promocional deixa '
  'de ser aplicado automaticamente pela visão catalogo_publico. '
  'Nulo = promoção sem prazo (vale enquanto preco_promocional existir).';

-- Promoção com data, mas sem preço promocional, não faz sentido nenhum.
-- A restrição impede esse estado inconsistente.
alter table public.products
  drop constraint if exists products_promocao_coerente;

alter table public.products
  add constraint products_promocao_coerente check (
    promocao_ate is null or preco_promocional is not null
  );


-- =============================================================================
-- 2. PROMOÇÃO DO PÃO DE MEL
--
-- De R$ 10,00 por R$ 8,50, até o fim do dia 10/12.
--
-- O fuso -03 é o horário de Brasília: a promoção vale até as 23:59:59 do dia
-- 10 no horário local, e não às 21h (o que aconteceria se gravássemos em UTC
-- sem o deslocamento).
-- =============================================================================

update public.products
   set preco_promocional = 850,
       promocao_ate = '2026-12-10 23:59:59-03'::timestamptz
 where slug = 'pao-de-mel-tradicional';


-- =============================================================================
-- 3. A VISÃO PASSA A RESPEITAR A VALIDADE
--
-- `drop` + `create` pelo mesmo motivo de sempre: `create or replace` só
-- acrescenta colunas no fim da lista.
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

  -- O preço promocional só é EXPOSTO enquanto estiver valendo. Depois da
  -- data, some da resposta — o frontend não tem como exibi-lo por engano.
  case
    when p.preco_promocional is not null
     and (p.promocao_ate is null or p.promocao_ate > now())
    then p.preco_promocional
  end as preco_promocional,

  -- Preço que o cliente realmente paga.
  case
    when p.preco_promocional is not null
     and (p.promocao_ate is null or p.promocao_ate > now())
    then p.preco_promocional
    else p.preco_varejo
  end as preco_efetivo,

  -- Está em promoção AGORA?
  (
    p.preco_promocional is not null
    and p.preco_promocional < p.preco_varejo
    and (p.promocao_ate is null or p.promocao_ate > now())
  ) as em_promocao,

  -- Quando a promoção acaba — permite mostrar "só até 10/12" na tela.
  case
    when p.preco_promocional is not null and p.promocao_ate > now()
    then p.promocao_ate
  end as promocao_ate,

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
  'Promoções expiram sozinhas: preco_efetivo volta ao varejo quando '
  'promocao_ate passa.';

alter view public.catalogo_publico set (security_invoker = on);
grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 4. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_promo     record;
  v_em_promo  integer;
  v_invocador text;
begin
  -- Segurança: a visão não pode expor preço de atacado nem furar o RLS.
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

  -- A promoção precisa estar ativa agora.
  select nome, preco_varejo, preco_efetivo, em_promocao, promocao_ate
    into v_promo
    from public.catalogo_publico
   where slug = 'pao-de-mel-tradicional';

  if not v_promo.em_promocao then
    raise exception 'A promoção do pão de mel não está ativa.';
  end if;

  if v_promo.preco_efetivo <> 850 then
    raise exception 'Preço promocional errado: % (esperado 850).', v_promo.preco_efetivo;
  end if;

  select count(*) into v_em_promo
    from public.catalogo_publico where em_promocao;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: preço de atacado protegido';
  raise notice '  OK: security_invoker ativo';
  raise notice '';
  raise notice '  Promoção ativa:';
  raise notice '    %', v_promo.nome;
  raise notice '    De  R$ %', to_char(v_promo.preco_varejo / 100.0, 'FM990.00');
  raise notice '    Por R$ %', to_char(v_promo.preco_efetivo / 100.0, 'FM990.00');
  raise notice '    Até %', to_char(v_promo.promocao_ate, 'DD/MM/YYYY HH24:MI');
  raise notice '';
  raise notice '  Produtos em promoção: %', v_em_promo;
  raise notice '──────────────────────────────────────────────';
  raise notice '  Depois de 10/12 o preço volta a R$ 10,00';
  raise notice '  sozinho, e a vitrine fica vazia.';
  raise notice '──────────────────────────────────────────────';
end $$;
