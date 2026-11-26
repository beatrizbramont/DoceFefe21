-- =============================================================================
-- DOCE FEFÊ.21 — 23-promocao-ate-10-12.sql
-- As três promoções passam a terminar no mesmo dia, o combinado
-- =============================================================================
--
-- EXECUTE DEPOIS DE 22.
--
-- -----------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
--
--   A loja combinou 10/12 para os três doces. O que estava gravado:
--
--     Pão de Mel   2026-12-12T23:59:59Z  →  12/12 às 20:59 no Brasil
--     Brownie      2026-12-13T02:59:59Z  →  12/12 às 23:59 no Brasil
--     Alfajor      2026-12-12T02:59:59Z  →  11/12 às 23:59 no Brasil
--
--   Três datas diferentes, nenhuma delas 10/12 — e uma terminando às 20:59,
--   que não é fim de dia nenhum.
--
-- -----------------------------------------------------------------------------
-- POR QUE AS DATAS ANDARAM
--
--   O painel gravava "2026-12-10T23:59:59" sem dizer o fuso. `timestamptz`
--   sem fuso explícito é lido como UTC: virava 20:59 do dia 10 no Brasil.
--   Na releitura, o formulário fatiava os 10 primeiros caracteres do ISO em
--   UTC e mostrava o dia seguinte. Quem abrisse e salvasse empurrava a data
--   em um dia. De novo, e de novo.
--
--   Corrigido no painel (js/admin/produtos.js): agora a data é montada no
--   fuso de quem salva e convertida para UTC explicitamente. Esta migração
--   conserta o que já estava gravado.
--
-- -----------------------------------------------------------------------------
-- POR QUE `-03` ESTÁ ESCRITO AQUI
--
--   Sem o fuso, este arquivo repetiria o mesmo defeito que está consertando.
--   `23:59:59-03` é o fim do dia 10 em Brasília, sem depender de como o
--   servidor do banco está configurado.
-- =============================================================================

update public.products
   set promocao_ate = '2026-12-10 23:59:59-03'::timestamptz
 where preco_promocional is not null
   and arquivado_em is null;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  r          record;
  v_distinto integer;
  v_fora     integer;
begin
  select count(distinct promocao_ate) into v_distinto
    from public.products
   where preco_promocional is not null and arquivado_em is null;

  select count(*) into v_fora
    from public.products
   where preco_promocional is not null
     and arquivado_em is null
     and (promocao_ate at time zone 'America/Sao_Paulo')::date <> date '2026-12-10';

  raise notice '──────────────────────────────────────────────';
  raise notice '  Promoções ativas';
  raise notice '';

  for r in
    select nome,
           preco_promocional,
           to_char(promocao_ate at time zone 'America/Sao_Paulo',
                   'DD/MM/YYYY HH24:MI') as termina
      from public.products
     where preco_promocional is not null and arquivado_em is null
     order by nome
  loop
    raise notice '    %  R$ %  até %',
      rpad(r.nome, 28), to_char(r.preco_promocional / 100.0, 'FM990.00'), r.termina;
  end loop;

  raise notice '';

  if v_fora > 0 then
    raise exception '% produto(s) não terminam em 10/12 no horário de Brasília.', v_fora;
  end if;

  if v_distinto > 1 then
    raise exception 'As promoções têm % prazos diferentes. Deveriam ter um só.', v_distinto;
  end if;

  raise notice '  Todas terminam em 10/12, às 23:59 de Brasília.';
  raise notice '──────────────────────────────────────────────';
end $$;
