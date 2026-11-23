-- =============================================================================
-- DOCE FEFÊ.21 — 04-correcao-ordenacao.sql
-- Correção: ordenação por preço considerando promoções
-- =============================================================================
--
-- EXECUTE DEPOIS DE 01, 02 e 03.
--
-- O PROBLEMA QUE ESTA MIGRAÇÃO CORRIGE
--
--   A ordenação "menor preço" usava a coluna `preco_varejo`, mas a tela
--   exibe o preço promocional quando existe. O resultado era uma lista
--   visivelmente fora de ordem:
--
--       R$ 15,00   ← preço cheio
--       R$ 14,00   ← promocional (preço cheio era R$ 16,00)
--
--   O cliente via R$ 15,00 antes de R$ 14,00 e concluía, com razão, que a
--   ordenação estava quebrada.
--
--   A correção acrescenta a coluna calculada `preco_efetivo` à visão
--   pública: ela devolve o promocional quando houver, e o de varejo caso
--   contrário — exatamente o valor que aparece na tela.
--
--   Fazer esse cálculo no BANCO, e não no JavaScript, é essencial: a
--   ordenação precisa ocorrer antes da paginação. Reordenar apenas os 12
--   itens da página atual no navegador daria um resultado errado.
--
-- -----------------------------------------------------------------------------
-- POR QUE `DROP VIEW` E NÃO `CREATE OR REPLACE VIEW`
--
--   O PostgreSQL só permite que `create or replace view` ACRESCENTE colunas
--   no FIM da lista. Inserir `preco_efetivo` no meio provoca:
--
--       ERROR: 42P16: cannot change name of view column
--              "peso_gramas" to "preco_efetivo"
--
--   Como uma visão é apenas uma consulta salva — não guarda dados —,
--   removê-la e recriá-la é seguro. Nenhuma linha de produto, pedido ou
--   cliente é afetada.
--
--   `cascade` não é usado de propósito: se alguma outra visão passar a
--   depender desta no futuro, queremos que o erro apareça aqui, em vez de
--   remover objetos silenciosamente.
--
-- Este arquivo é seguro para rodar mais de uma vez.
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

  -- NOVO: o preço que o cliente realmente vê. Usado para ordenar e filtrar.
  coalesce(p.preco_promocional, p.preco_varejo) as preco_efetivo,

  -- NOVO: marca se o item está em promoção, evitando que o frontend
  -- precise deduzir isso comparando dois campos.
  (p.preco_promocional is not null
    and p.preco_promocional < p.preco_varejo) as em_promocao,

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
  'Catálogo visível ao público. NÃO contém preco_atacado — por segurança. '
  'A coluna preco_efetivo reflete o valor exibido ao cliente.';

-- -----------------------------------------------------------------------------
-- IMPORTANTE: ao remover a visão, as permissões e a configuração de segurança
-- vão junto. Precisam ser aplicadas de novo — senão a visão vira um buraco
-- no RLS ou fica inacessível ao site.
-- -----------------------------------------------------------------------------

-- `security_invoker` faz a visão respeitar as políticas RLS de quem consulta,
-- em vez de rodar com os poderes de quem a criou.
alter view public.catalogo_publico set (security_invoker = on);

grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  tem_atacado    integer;
  tem_efetivo    integer;
  fora_de_ordem  integer;
  invocador      text;
begin
  -- 1. A visão NUNCA pode expor o preço de atacado.
  select count(*) into tem_atacado
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'catalogo_publico'
    and column_name = 'preco_atacado';

  if tem_atacado > 0 then
    raise exception 'FALHA GRAVE: catalogo_publico expõe preco_atacado!';
  end if;

  -- 2. A coluna nova precisa existir.
  select count(*) into tem_efetivo
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'catalogo_publico'
    and column_name = 'preco_efetivo';

  if tem_efetivo = 0 then
    raise exception 'A coluna preco_efetivo não foi criada.';
  end if;

  -- 3. O preço efetivo nunca pode ser maior que o de varejo.
  select count(*) into fora_de_ordem
  from public.catalogo_publico
  where preco_efetivo > preco_varejo;

  if fora_de_ordem > 0 then
    raise exception '% produto(s) com preço efetivo maior que o de varejo.', fora_de_ordem;
  end if;

  -- 4. O RLS precisa continuar valendo para quem consulta.
  select coalesce(
    (select option_value
     from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'),
    'off'
  ) into invocador
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'catalogo_publico';

  if invocador is distinct from 'on' then
    raise exception 'security_invoker não está ativo — a visão burlaria o RLS!';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: visão recriada com preco_efetivo';
  raise notice '  OK: preço de atacado continua protegido';
  raise notice '  OK: security_invoker ativo (RLS respeitado)';
  raise notice '  OK: permissões reaplicadas';
  raise notice '──────────────────────────────────────────────';
end $$;
