-- =============================================================================
-- DOCE FEFÊ.21 — 18-restaura-ordem-na-visao.sql
-- Correção: a visão do catálogo perdeu a coluna `ordem`
-- =============================================================================
--
-- EXECUTE DEPOIS DE 17.
--
-- -----------------------------------------------------------------------------
-- O QUE QUEBROU
--
--   Depois do arquivo 17, o site inteiro parou de mostrar produtos:
--
--       column catalogo_publico.ordem does not exist
--
--   A home, o catálogo e as vitrines caíram juntos, para visitante logado ou
--   não.
--
-- -----------------------------------------------------------------------------
-- POR QUE ACONTECEU
--
--   `create or replace view` só aceita acrescentar colunas no fim da lista.
--   Para inserir `medida` no meio, o arquivo 17 fez `drop view` + `create
--   view` — e escreveu a visão nova copiando a do arquivo 09.
--
--   Só que a versão vigente era a do arquivo 10, que havia acrescentado a
--   coluna `ordem`. Copiar da versão errada apagou essa coluna sem aviso: o
--   banco aceitou de bom grado, porque uma visão pode ter as colunas que
--   quiser. O erro só apareceu quando o backend pediu `ordem`.
--
--   A lição é sobre `drop view`: ele não avisa o que você está perdendo.
--   Quem recria uma visão precisa partir da ÚLTIMA versão, não da que
--   lembrou. A conferência no fim deste arquivo passa a checar coluna por
--   coluna, para a próxima recriação não repetir isso em silêncio.
-- =============================================================================


-- =============================================================================
-- 1. A VISÃO COMPLETA: `ordem` E `medida`
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

  -- A coluna que o arquivo 17 derrubou. Define a sequência da vitrine.
  p.ordem,

  -- Medida substituiu o peso na tela (arquivo 17). `peso_gramas` continua
  -- aqui porque já estava na visão antes, e tirar coluna de visão pública é
  -- justamente o tipo de mudança silenciosa que causou este arquivo.
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
  'Promoções expiram sozinhas (promocao_ate). `ordem` define a sequência '
  'da vitrine; `medida` é o tamanho exibido no lugar do peso.';

alter view public.catalogo_publico set (security_invoker = on);
grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 2. CONFERÊNCIA — AGORA COLUNA POR COLUNA
--
-- A conferência do arquivo 17 só olhava se `medida` existia e se
-- `preco_atacado` estava fora. Passou verde com a visão quebrada.
--
-- Esta lista é o contrato da visão com o backend. Se uma recriação futura
-- esquecer qualquer uma, o arquivo falha na hora, em vez de o site cair.
-- =============================================================================

do $$
declare
  c_esperadas constant text[] := array[
    'id', 'slug', 'nome', 'descricao_curta', 'descricao', 'ingredientes',
    'alergenicos', 'preco_varejo', 'preco_promocional', 'preco_efetivo',
    'em_promocao', 'promocao_ate', 'ordem', 'medida', 'peso_gramas',
    'destaque', 'mais_vendido', 'novidade', 'sazonal', 'vendas_total',
    'criado_em', 'categoria_slug', 'categoria_nome', 'categoria_icone',
    'categoria_em_breve', 'disponivel', 'sob_encomenda', 'imagens'
  ];

  v_faltando text[];
  v_total    integer;
begin
  select array_agg(esperada)
    into v_faltando
    from unnest(c_esperadas) as esperada
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'catalogo_publico'
        and column_name = esperada
   );

  if v_faltando is not null then
    raise exception 'A visão ficou sem as colunas: %', array_to_string(v_faltando, ', ');
  end if;

  -- O preço de atacado nunca pode vazar para a visão pública.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'catalogo_publico'
       and column_name = 'preco_atacado'
  ) then
    raise exception 'FALHA GRAVE: catalogo_publico expõe preco_atacado!';
  end if;

  select count(*) into v_total from public.catalogo_publico;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: as % colunas esperadas estão na visão', array_length(c_esperadas, 1);
  raise notice '  OK: `ordem` restaurada';
  raise notice '  OK: preco_atacado continua fora';
  raise notice '  OK: % produto(s) no catálogo público', v_total;
  raise notice '──────────────────────────────────────────────';
end $$;
