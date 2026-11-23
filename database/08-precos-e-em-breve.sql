-- =============================================================================
-- DOCE FEFÊ.21 — 08-precos-e-em-breve.sql
-- Preços reais dos produtos individuais + categorias "em breve"
-- =============================================================================
--
-- EXECUTE DEPOIS DE 07.
--
-- O QUE ESTE ARQUIVO FAZ
--
--   1. Aplica os PREÇOS REAIS informados pela cliente:
--        Pão de Mel Tradicional ....... R$ 10,00
--        Alfajor de Doce de Leite ..... R$  9,00
--        Brownie Tradicional .......... R$ 10,00
--
--   2. Remove o prefixo `demo-` dos slugs. Era ele que fazia o site exibir
--      o selo "Preço a confirmar" — com os valores reais, o aviso deixa de
--      fazer sentido e some sozinho.
--
--   3. Acrescenta a coluna `em_breve` às categorias, e marca a linha
--      Doce Fefê Fit como ainda não disponível.
--
-- -----------------------------------------------------------------------------
-- POR QUE UMA COLUNA `em_breve`, E NÃO SIMPLESMENTE `ativa = false`
--
--   `ativa = false` sumiria com a categoria. Mas a cliente quer o contrário:
--   quer que a linha Fit APAREÇA, anunciada como novidade futura — é uma
--   peça de marketing, não um item escondido.
--
--   São dois conceitos diferentes, e por isso duas colunas:
--     ativa     → aparece no site?
--     em_breve  → aparece, mas ainda não dá para comprar
-- =============================================================================


-- =============================================================================
-- 1. PREÇOS REAIS
-- =============================================================================

update public.products
   set preco_varejo = 1000,       -- R$ 10,00
       preco_promocional = null
 where slug = 'demo-pao-de-mel-tradicional';

update public.products
   set preco_varejo = 900,        -- R$ 9,00
       preco_promocional = null
 where slug = 'demo-alfajor-doce-de-leite';

update public.products
   set preco_varejo = 1000,       -- R$ 10,00
       preco_promocional = null
 where slug = 'demo-brownie-tradicional';


-- -----------------------------------------------------------------------------
-- O preço de atacado precisa continuar MENOR que o de varejo — existe uma
-- restrição no banco (`products_atacado_menor`) que rejeitaria o contrário.
-- Os valores de atacado antigos foram calculados sobre preços de referência,
-- então são zerados: a cliente ainda não informou tabela de atacado.
-- -----------------------------------------------------------------------------

update public.products
   set preco_atacado = null
 where slug in (
   'demo-pao-de-mel-tradicional',
   'demo-alfajor-doce-de-leite',
   'demo-brownie-tradicional'
 );


-- =============================================================================
-- 2. SLUGS DEFINITIVOS
--
-- O slug aparece na URL do produto. Com preços reais, não há mais motivo
-- para carregar "demo-" no endereço.
--
-- Nota: `order_items` guarda uma CÓPIA do slug, então pedidos antigos não são
-- afetados. Carrinhos salvos no navegador com o slug antigo perdem o item,
-- com aviso — o cart-service já trata produto inexistente.
-- =============================================================================

update public.products set slug = 'pao-de-mel-tradicional'
 where slug = 'demo-pao-de-mel-tradicional';

update public.products set slug = 'alfajor-doce-de-leite'
 where slug = 'demo-alfajor-doce-de-leite';

update public.products set slug = 'brownie-tradicional'
 where slug = 'demo-brownie-tradicional';


-- =============================================================================
-- 3. CATEGORIAS "EM BREVE"
-- =============================================================================

alter table public.categories
  add column if not exists em_breve boolean not null default false;

comment on column public.categories.em_breve is
  'Categoria visível no site, mas ainda sem produtos à venda. Exibe o selo '
  '"Em breve" e não leva ao catálogo.';

-- A linha fit ainda não está disponível.
update public.categories
   set em_breve = true,
       descricao = 'Opções mais leves, sem abrir mão do sabor. Em breve!'
 where slug = 'fit';

-- Garante que as demais estão liberadas.
update public.categories
   set em_breve = false
 where slug <> 'fit';


-- =============================================================================
-- 4. A VISÃO PRECISA EXPOR `em_breve`
--
-- `drop` + `create` em vez de `create or replace`: o PostgreSQL só permite
-- acrescentar colunas no FIM da lista com `replace`, e queremos a coluna
-- junto das outras de categoria. (Mesmo motivo explicado em 04.)
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
  p.preco_promocional,
  coalesce(p.preco_promocional, p.preco_varejo) as preco_efetivo,
  (p.preco_promocional is not null
    and p.preco_promocional < p.preco_varejo) as em_promocao,
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
  'Catálogo visível ao público. NÃO contém preco_atacado — por segurança.';

-- Permissões e RLS precisam ser reaplicados: o `drop` levou os dois junto.
alter view public.catalogo_publico set (security_invoker = on);
grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 5. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_demo       integer;
  v_em_breve   integer;
  v_invocador  text;
  r            record;
begin
  -- Nenhum produto pode ter sobrado com o prefixo de demonstração.
  select count(*) into v_demo from public.products where slug like 'demo-%';

  if v_demo > 0 then
    raise exception '% produto(s) ainda com slug "demo-".', v_demo;
  end if;

  -- A visão não pode expor o preço de atacado.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'catalogo_publico'
       and column_name = 'preco_atacado'
  ) then
    raise exception 'FALHA GRAVE: catalogo_publico expõe preco_atacado!';
  end if;

  -- O RLS precisa continuar valendo para quem consulta.
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

  select count(*) into v_em_breve from public.categories where em_breve;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: nenhum slug "demo-" restante';
  raise notice '  OK: preço de atacado protegido';
  raise notice '  OK: security_invoker ativo';
  raise notice '  Categorias "em breve": %', v_em_breve;
  raise notice '──────────────────────────────────────────────';

  for r in
    select nome, preco_varejo, slug
      from public.catalogo_publico
     order by preco_varejo asc
  loop
    raise notice '  % R$ %', rpad(r.nome, 36), to_char(r.preco_varejo / 100.0, 'FM990.00');
  end loop;

  raise notice '──────────────────────────────────────────────';
end $$;
