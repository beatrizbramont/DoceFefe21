-- =============================================================================
-- DOCE FEFÊ.21 — 21-categorias-no-singular.sql
-- O filtro deixa de prometer variedade que o catálogo ainda não tem
-- =============================================================================
--
-- EXECUTE DEPOIS DE 20.
--
-- -----------------------------------------------------------------------------
-- POR QUÊ
--
--   Hoje existe UM sabor de cada: um brownie, um pão de mel, um alfajor. O
--   filtro dizia "Brownies", "Pães de Mel", "Alfajores".
--
--   Plural promete escolha. Quem clica em "Alfajores" esperando comparar
--   sabores encontra um só — e a sensação não é de catálogo enxuto, é de
--   catálogo faltando. O singular descreve o que existe, sem desculpa.
--
--   Quando entrar o segundo sabor, é só rodar o inverso desta atualização.
--
-- -----------------------------------------------------------------------------
-- ⚠️ O SLUG NÃO MUDA
--
--   Só a coluna `nome`. O `slug` continua 'brownies', 'paes-de-mel' e
--   'alfajores' porque ele é ENDEREÇO, não vitrine:
--
--     • produtos.html?categoria=alfajores — links já compartilhados
--     • `iconeDaCategoria(slug)` em js/components/icons.js
--     • a lista de reserva em js/config.js
--
--   Nome muda quando o negócio muda. Endereço que muda quebra link de quem
--   já salvou. São coisas diferentes, e é por isso que são colunas separadas.
-- =============================================================================

update public.categories set nome = 'Brownie'    where slug = 'brownies';
update public.categories set nome = 'Pão de Mel' where slug = 'paes-de-mel';
update public.categories set nome = 'Alfajor'    where slug = 'alfajores';


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  r             record;
  v_plural      integer := 0;
  v_slug_errado integer;
begin
  -- O slug precisa ter sobrevivido intacto: é dele que dependem os links.
  select count(*) into v_slug_errado
    from public.categories
   where slug not in ('brownies', 'paes-de-mel', 'alfajores', 'fit', 'sazonais');

  if v_slug_errado > 0 then
    raise exception
      'Algum slug de categoria mudou. Nenhum slug deveria ter sido tocado.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Categorias do catálogo';
  raise notice '';

  for r in
    select slug, nome from public.categories order by ordem
  loop
    raise notice '    %  →  %', rpad(r.slug, 14), r.nome;

    if r.slug in ('brownies', 'paes-de-mel', 'alfajores')
       and r.nome in ('Brownies', 'Pães de Mel', 'Alfajores') then
      v_plural := v_plural + 1;
    end if;
  end loop;

  raise notice '';

  if v_plural > 0 then
    raise exception '% categoria(s) continuam no plural.', v_plural;
  end if;

  raise notice '  Nomes no singular. Slugs preservados.';
  raise notice '──────────────────────────────────────────────';
end $$;
