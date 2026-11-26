-- =============================================================================
-- DOCE FEFÊ.21 — LIMPEZA-dados-de-teste.sql
-- Apaga o movimento gerado durante os testes, antes da loja abrir de verdade
-- =============================================================================
--
-- ⚠️⚠️  ESTE ARQUIVO NÃO É UMA MIGRAÇÃO.  ⚠️⚠️
--
--   Ele não tem número de propósito. Os arquivos numerados (01, 02, …) são
--   feitos para rodar em ordem, uma vez cada. Este APAGA DADOS — rodá-lo de
--   novo, com a loja funcionando, destruiria vendas reais.
--
--   Depois de usar, não rode outra vez. Nunca.
--
-- -----------------------------------------------------------------------------
-- O QUE SERÁ APAGADO
--
--   • Pedidos — e, junto, os itens e os pagamentos de cada um
--   • Mensagens recebidas pelo formulário de contato
--   • Candidaturas a revendedor
--   • Histórico de movimentação de estoque
--
-- O QUE NÃO SERÁ TOCADO
--
--   • Logins e perfis — ninguém perde a conta
--   • Produtos, fotos e categorias — o catálogo fica intacto
--   • O SALDO do estoque — fica no número de hoje
--
-- -----------------------------------------------------------------------------
-- POR QUE O SALDO DO ESTOQUE FICA COMO ESTÁ
--
--   Os pedidos de teste baixaram unidades. Apagar o pedido não devolve o
--   doce à prateleira, e eu não tenho como saber quantos existem de verdade
--   na cozinha.
--
--   Então o número fica onde está, e a conferência é sua: abra o painel em
--   /admin/estoque.html, conte o que há na bancada e ajuste. É o único jeito
--   de o sistema começar dizendo a verdade.
--
--   O histórico some junto — faz sentido, porque ele registrava movimentos
--   de pedidos que não existem mais. O primeiro lançamento que você fizer no
--   painel vira o começo do livro-razão de verdade.
-- =============================================================================


-- =============================================================================
-- 1. O QUE EXISTE AGORA
--
-- Leia estes números ANTES de olhar o resultado. Se algum deles for maior do
-- que você esperava, pare e confira — pode haver venda real no meio.
-- =============================================================================

do $$
declare
  v_pedidos    integer;
  v_itens      integer;
  v_pagamentos integer;
  v_mensagens  integer;
  v_revend     integer;
  v_movimentos integer;
  v_contas     integer;
  v_produtos   integer;
begin
  select count(*) into v_pedidos    from public.orders;
  select count(*) into v_itens      from public.order_items;
  select count(*) into v_pagamentos from public.payments;
  select count(*) into v_mensagens  from public.contact_messages;
  select count(*) into v_revend     from public.resellers;
  select count(*) into v_movimentos from public.inventory_movements;
  select count(*) into v_contas     from public.profiles;
  select count(*) into v_produtos   from public.products;

  raise notice '──────────────────────────────────────────────';
  raise notice '  ANTES DA LIMPEZA';
  raise notice '';
  raise notice '  Será apagado:';
  raise notice '    % pedido(s)', v_pedidos;
  raise notice '    % item(ns) de pedido', v_itens;
  raise notice '    % pagamento(s)', v_pagamentos;
  raise notice '    % mensagem(ns) de contato', v_mensagens;
  raise notice '    % candidatura(s) de revendedor', v_revend;
  raise notice '    % movimento(s) de estoque', v_movimentos;
  raise notice '';
  raise notice '  Será preservado:';
  raise notice '    % conta(s) de usuário', v_contas;
  raise notice '    % produto(s) no catálogo', v_produtos;
  raise notice '──────────────────────────────────────────────';
end $$;


-- =============================================================================
-- 2. A LIMPEZA
--
-- `order_items` e `payments` têm `on delete cascade` apontando para `orders`:
-- somem junto, sem sobrar linha órfã. Apagamos só os pedidos.
-- =============================================================================

delete from public.inventory_movements;
delete from public.contact_messages;
delete from public.resellers;
delete from public.orders;


-- =============================================================================
-- 3. CONFERÊNCIA
--
-- Recusa se algo que deveria ser preservado tiver sumido. Perder pedido de
-- teste é o objetivo; perder conta de cliente seria um desastre silencioso.
-- =============================================================================

do $$
declare
  v_sobrou   integer;
  v_contas   integer;
  v_produtos integer;
  v_estoque  integer;
begin
  select (select count(*) from public.orders)
       + (select count(*) from public.order_items)
       + (select count(*) from public.payments)
       + (select count(*) from public.contact_messages)
       + (select count(*) from public.resellers)
       + (select count(*) from public.inventory_movements)
    into v_sobrou;

  select count(*) into v_contas   from public.profiles;
  select count(*) into v_produtos from public.products;
  select count(*) into v_estoque  from public.inventory;

  if v_sobrou > 0 then
    raise exception 'Sobraram % registro(s) que deveriam ter sido apagados.', v_sobrou;
  end if;

  if v_contas = 0 then
    raise exception 'NENHUMA conta restou. Algo apagou os perfis — não deveria.';
  end if;

  if v_produtos = 0 then
    raise exception 'NENHUM produto restou. O catálogo não deveria ter sido tocado.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  DEPOIS DA LIMPEZA';
  raise notice '';
  raise notice '    0 pedidos, mensagens, candidaturas e movimentos';
  raise notice '    % conta(s) preservada(s)', v_contas;
  raise notice '    % produto(s) preservado(s)', v_produtos;
  raise notice '    % ficha(s) de estoque preservada(s)', v_estoque;
  raise notice '';
  raise notice '  ⚠️  Agora confira o estoque em /admin/estoque.html:';
  raise notice '      conte a bancada e ajuste os números.';
  raise notice '';
  raise notice '  ⚠️  NÃO rode este arquivo de novo.';
  raise notice '──────────────────────────────────────────────';
end $$;
