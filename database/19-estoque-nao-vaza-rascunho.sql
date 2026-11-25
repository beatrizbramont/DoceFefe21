-- =============================================================================
-- DOCE FEFÊ.21 — 19-estoque-nao-vaza-rascunho.sql
-- A política de estoque passa a fazer o que o comentário dela já prometia
-- =============================================================================
--
-- EXECUTE DEPOIS DE 18.
--
-- -----------------------------------------------------------------------------
-- COMO APARECEU
--
--   Um teste de invasão: consultar o banco usando apenas o que fica público
--   quando o site vai ao ar — a chave `anon`, que todo navegador baixa.
--
--   Tudo que deveria estar trancado estava: profiles, orders, payments,
--   resellers, order_items, contact_messages e a visão clientes_admin. A
--   tentativa de gravar um produto falso foi recusada.
--
--   Só `inventory` respondeu, e devolveu as linhas.
--
-- -----------------------------------------------------------------------------
-- A REGRA CONTRADIZIA O PRÓPRIO COMENTÁRIO
--
--   O arquivo 02 diz, em cima da política:
--
--       "O cliente precisa saber se o produto está disponível, mas não
--        quantas unidades existem — isso é informação estratégica do
--        negócio."
--
--   E a regra abaixo era `using (true)` — a tabela inteira liberada.
--
--   O comentário descrevia a intenção; a regra, o oposto. Esse descompasso
--   é mais perigoso que uma regra abertamente frouxa: quem lê o arquivo vai
--   embora achando que o estoque está protegido.
--
-- -----------------------------------------------------------------------------
-- O QUE VAZAVA, DE FATO
--
--   Nada de cliente. Nenhum nome, pedido ou pagamento. O que escapava era
--   informação do NEGÓCIO:
--
--     • quantas unidades existem de cada doce
--     • o alerta mínimo configurado
--     • e o pior: o estoque de produtos NÃO PUBLICADOS — um concorrente
--       saberia do lançamento antes do anúncio
--
--   Esta correção fecha o terceiro item por inteiro e reduz os dois
--   primeiros ao que o site já mostra de qualquer forma.
--
-- ⚠️ O QUE ESTA CORREÇÃO NÃO RESOLVE
--   Para um produto JÁ PUBLICADO, quem consultar o banco direto ainda vê
--   `quantidade` e `reservado` separados, em vez do total disponível. Fechar
--   isso exigiria tirar o `security_invoker` da visão do catálogo — mudança
--   maior, que merece ser feita e testada com calma. Fica registrado aqui
--   para não se perder.
-- =============================================================================

drop policy if exists "estoque: leitura pública do disponível" on public.inventory;

create policy "estoque: leitura pública do disponível"
  on public.inventory for select
  using (
    -- A visão `catalogo_publico` roda com as permissões de quem chama
    -- (security_invoker), então o visitante precisa enxergar a linha de
    -- estoque para o catálogo funcionar. Mas só a dos produtos que já estão
    -- à venda: rascunho e arquivado não são da conta de ninguém.
    exists (
      select 1
        from public.products p
       where p.id = inventory.produto_id
         and p.publicado
         and p.arquivado_em is null
    )
    -- A loja continua vendo tudo, inclusive o estoque dos rascunhos.
    or public.eh_admin()
  );


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_rascunhos integer;
  v_publicados integer;
begin
  select count(*) into v_rascunhos
    from public.inventory e
    join public.products p on p.id = e.produto_id
   where not p.publicado or p.arquivado_em is not null;

  select count(*) into v_publicados
    from public.inventory e
    join public.products p on p.id = e.produto_id
   where p.publicado and p.arquivado_em is null;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Política de estoque corrigida.';
  raise notice '';
  raise notice '  % produto(s) publicados — estoque visível ao catálogo', v_publicados;
  raise notice '  % produto(s) em rascunho ou arquivados — agora invisíveis', v_rascunhos;
  raise notice '';
  raise notice '  Confira depois: o catálogo do site precisa continuar';
  raise notice '  mostrando "esgotado" e "sob encomenda" corretamente.';
  raise notice '──────────────────────────────────────────────';
end $$;
