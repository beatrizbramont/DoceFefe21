-- =============================================================================
-- DOCE FEFÊ.21 — 06-correcao-codigo-ambiguo.sql
-- Correção: variável com o mesmo nome da coluna em gerar_codigo_pedido
-- =============================================================================
--
-- EXECUTE DEPOIS DE 05.
--
-- -----------------------------------------------------------------------------
-- O ERRO
--
--     ERROR: 42702: column reference "codigo" is ambiguous
--     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
--   A versão anterior declarava uma variável chamada `codigo` e consultava a
--   coluna `codigo` da tabela `orders` na mesma expressão:
--
--       exit when not exists (
--         select 1 from public.orders where orders.codigo = codigo
--       );
--
--   Qualificar só o lado esquerdo não resolve: o `codigo` da direita continua
--   ambíguo. O PostgreSQL não tem como saber se é a variável ou a coluna, e
--   recusa a função inteira.
--
--   Resultado prático: NENHUM pedido conseguia ser criado — a função falhava
--   já na geração do código, antes de qualquer validação.
--
-- -----------------------------------------------------------------------------
-- A CORREÇÃO
--
--   Prefixo `v_` nas variáveis locais, que é a convenção já usada em
--   criar_pedido. Com nomes distintos, não há ambiguidade possível.
--
--   O `#variable_conflict use_column` existiria como alternativa, mas resolver
--   o conflito renomeando é melhor: deixa a intenção explícita no código, em
--   vez de depender de uma diretiva no topo do arquivo que alguém pode não ver.
-- =============================================================================

create or replace function public.gerar_codigo_pedido()
returns text
language plpgsql
as $$
declare
  -- Letras I, O e números 0, 1 ficam de fora: são os caracteres que as
  -- pessoas confundem ao ditar um código por telefone.
  c_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_codigo   text;
  v_tentativa integer := 0;
  v_existe   boolean;
begin
  loop
    v_codigo := 'DF';

    for i in 1..8 loop
      v_codigo := v_codigo ||
        substr(c_alfabeto, floor(random() * length(c_alfabeto) + 1)::int, 1);
    end loop;

    -- Consulta separada, com a comparação em variáveis de nomes distintos.
    select exists (
      select 1 from public.orders o where o.codigo = v_codigo
    ) into v_existe;

    exit when not v_existe;

    v_tentativa := v_tentativa + 1;

    -- Em 32^8 combinações a colisão é improvável; o limite existe para o laço
    -- nunca virar infinito caso algo esteja muito errado.
    if v_tentativa > 20 then
      raise exception 'Não foi possível gerar um código de pedido único.';
    end if;
  end loop;

  return v_codigo;
end;
$$;

comment on function public.gerar_codigo_pedido is
  'Gera código DF + 8 caracteres, sem I, O, 0 e 1 (evita erro ao ditar).';


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_codigo1 text;
  v_codigo2 text;
begin
  -- Se a função ainda estivesse quebrada, estas chamadas lançariam o 42702.
  v_codigo1 := public.gerar_codigo_pedido();
  v_codigo2 := public.gerar_codigo_pedido();

  if v_codigo1 !~ '^DF[0-9A-Z]{8}$' then
    raise exception 'Formato inválido: %', v_codigo1;
  end if;

  -- Os caracteres ambíguos não podem aparecer.
  if v_codigo1 ~ '[IO01]' then
    raise exception 'Código contém caractere ambíguo: %', v_codigo1;
  end if;

  if v_codigo1 = v_codigo2 then
    raise exception 'Dois códigos seguidos saíram iguais — random() não variou.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: gerar_codigo_pedido corrigida';
  raise notice '  Exemplos: %  e  %', v_codigo1, v_codigo2;
  raise notice '──────────────────────────────────────────────';
end $$;
