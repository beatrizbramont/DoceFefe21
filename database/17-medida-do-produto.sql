-- =============================================================================
-- DOCE FEFÊ.21 — 17-medida-do-produto.sql
-- A vitrine passa a mostrar MEDIDA no lugar de peso
-- =============================================================================
--
-- EXECUTE DEPOIS DE 16.
--
-- POR QUE A TROCA
--
--   "90g" não ajuda ninguém a imaginar o doce. "5x5 cm" sim: a pessoa vê o
--   tamanho na cabeça, compara com a palma da mão e entende o que vai
--   receber. Para doce de corte — brownie, pão de mel, alfajor — a dimensão
--   comunica melhor que a balança.
--
-- POR QUE A COLUNA DE PESO CONTINUA NO BANCO
--
--   `peso_gramas` sai da tela e do cadastro, mas a coluna fica. Apagar
--   coluna é irreversível, e o peso tem um uso plausível à frente: cálculo
--   de frete por transportadora. Guardar um dado que já existe custa nada;
--   recuperá-lo depois de apagado custa remedir todos os produtos.
--
--   Ela fica marcada como não exibida, para ninguém preencher achando que
--   vai aparecer em algum lugar.
-- =============================================================================


-- =============================================================================
-- 1. A COLUNA
-- =============================================================================

alter table public.products
  add column if not exists medida text;

comment on column public.products.medida is
  'Dimensão do doce como texto livre, do jeito que vai para a tela: '
  '"5x5 cm", "6x6 cm", "300 ml". Substituiu peso_gramas na vitrine.';

comment on column public.products.peso_gramas is
  'NÃO é exibido no site desde a troca por `medida` (arquivo 17). Mantido '
  'para um eventual cálculo de frete por peso.';

-- Texto curto: o campo é um rótulo de vitrine, não descrição.
alter table public.products
  drop constraint if exists products_medida_tamanho;

alter table public.products
  add constraint products_medida_tamanho check (
    medida is null or char_length(trim(medida)) between 2 and 40
  );


-- =============================================================================
-- 2. AS MEDIDAS INFORMADAS PELA MARCA
-- =============================================================================

update public.products set medida = '5x5 cm' where slug = 'brownie-tradicional';
update public.products set medida = '6x6 cm' where slug = 'pao-de-mel-tradicional';
update public.products set medida = '6x6 cm' where slug = 'alfajor-doce-de-leite';


-- =============================================================================
-- 3. A VISÃO PÚBLICA PASSA A ENTREGAR A MEDIDA
--
-- `drop` + `create` pelo motivo de sempre: `create or replace` só acrescenta
-- coluna no fim da lista, e a medida deve ficar junto das outras
-- características do produto.
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

  -- Medida no lugar do peso. `peso_gramas` continua fora da visão pública:
  -- nunca esteve exposto como número bruto e segue assim.
  p.medida,
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
  'promocao_ate passa. Mostra `medida`, não peso.';

alter view public.catalogo_publico set (security_invoker = on);
grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 4. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_sem_medida integer;
  v_exposto    integer;
  r            record;
begin
  -- A visão não pode ter perdido a proteção do preço de atacado.
  select count(*) into v_exposto
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'catalogo_publico'
     and column_name = 'preco_atacado';

  if v_exposto > 0 then
    raise exception 'FALHA GRAVE: catalogo_publico expõe preco_atacado!';
  end if;

  -- Os três doces de corte precisam ter medida.
  select count(*) into v_sem_medida
    from public.catalogo_publico
   where medida is null
     and slug in ('brownie-tradicional', 'pao-de-mel-tradicional', 'alfajor-doce-de-leite');

  if v_sem_medida > 0 then
    raise exception '% produto(s) de corte ficaram sem medida.', v_sem_medida;
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: coluna `medida` criada';
  raise notice '  OK: catalogo_publico entrega a medida';
  raise notice '  OK: preco_atacado continua fora da visão pública';
  raise notice '';

  for r in
    select nome, medida from public.catalogo_publico
     where medida is not null order by nome
  loop
    raise notice '    % — %', r.nome, r.medida;
  end loop;

  raise notice '';
  raise notice '  Os Kits seguem sem medida: são cestas, não doces de corte.';
  raise notice '──────────────────────────────────────────────';
end $$;
