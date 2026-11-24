-- =============================================================================
-- DOCE FEFÊ.21 — 16-conferencia-sem-comprovante.sql
-- Correção: aprovar Pix pago sem o cliente ter enviado comprovante
-- =============================================================================
--
-- EXECUTE DEPOIS DE 15.
--
-- -----------------------------------------------------------------------------
-- O QUE QUEBROU
--
--   Dois pedidos pagos por Pix não puderam ser aprovados no painel. A API
--   devolvia 503, e no log do banco estava o motivo:
--
--       new row for relation "payments" violates check constraint
--       "payments_conferencia_exige_comprovante"
--
--   A restrição veio do arquivo 11, com este comentário:
--
--       "Conferência sem comprovante não faz sentido no fluxo do Pix."
--
--   Faz. O cliente escolheu Pix, pagou pelo banco, avisou por WhatsApp e não
--   subiu o print. O dinheiro está na conta e a loja precisa liberar o
--   pedido. A regra descrevia o fluxo ideal, não o que acontece.
--
-- -----------------------------------------------------------------------------
-- O QUE A RESTRIÇÃO QUERIA PROTEGER — E CONTINUA PROTEGENDO
--
--   A intenção era impedir aprovação no escuro: ninguém deve marcar
--   "conferido" sem nada que sustente a decisão.
--
--   A correção mantém a intenção e troca a exigência. Sem comprovante, é
--   preciso ESCREVER como o pagamento foi confirmado:
--
--       "confirmado no extrato dia 23"   "pagou na entrega"
--
--   O texto vai para `observacao_conferencia`, junto de quem aprovou e
--   quando. O rastro continua existindo — deixa de ser um arquivo e passa a
--   ser uma frase.
--
-- ⚠️ O QUE NÃO MUDA
--   Aprovar continua sendo exclusividade de quem tem perfil de administrador,
--   por `exigirAdmin`. Esta migração não afrouxa permissão nenhuma: só
--   reconhece uma forma legítima de conferir que a regra anterior proibia.
-- =============================================================================


-- =============================================================================
-- 1. A RESTRIÇÃO PASSA A ACEITAR JUSTIFICATIVA ESCRITA
-- =============================================================================

alter table public.payments
  drop constraint if exists payments_conferencia_exige_comprovante;

alter table public.payments
  add constraint payments_conferencia_exige_comprovante check (
    conferido_em is null
    -- O caminho normal: o cliente mandou o print.
    or comprovante_caminho is not null
    -- Dinheiro nunca teve comprovante para enviar.
    or metodo = 'dinheiro'
    -- Pagou e não mandou print: a loja escreve como confirmou.
    or nullif(trim(coalesce(observacao_conferencia, '')), '') is not null
  );

comment on constraint payments_conferencia_exige_comprovante on public.payments is
  'Conferir exige lastro: comprovante enviado, pagamento em dinheiro, ou uma '
  'justificativa escrita de como a loja confirmou o recebimento.';


-- =============================================================================
-- 2. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_pedido_id uuid;
  v_pagamento_id uuid;
  v_erro text;
begin
  -- Cria um pagamento de teste, sem comprovante, para provar que a nova
  -- regra deixa aprovar com justificativa e continua barrando sem ela.
  insert into public.orders (
    codigo, cliente_nome, cliente_whatsapp, status, tipo_entrega,
    subtotal_centavos, desconto_centavos, frete_centavos, total_centavos
  ) values (
    'DFZZTEST99', 'Conferencia da migracao', '11900000000',
    'aguardando_pagamento', 'retirada', 100, 0, 0, 100
  )
  returning id into v_pedido_id;

  insert into public.payments (pedido_id, metodo, status, valor_centavos)
  values (v_pedido_id, 'pix', 'pendente', 100)
  returning id into v_pagamento_id;

  -- (a) Sem comprovante e SEM justificativa: precisa continuar barrado.
  begin
    update public.payments
       set conferido_em = now(), status = 'aprovado'
     where id = v_pagamento_id;

    raise exception
      'FALHA: aprovou Pix sem comprovante e sem justificativa — a regra ficou frouxa demais.';
  exception
    when check_violation then
      null;  -- esperado
  end;

  -- (b) Sem comprovante e COM justificativa: precisa passar.
  begin
    update public.payments
       set conferido_em = now(),
           status = 'aprovado',
           observacao_conferencia = 'Confirmado no extrato'
     where id = v_pagamento_id;
  exception
    when check_violation then
      raise exception
        'FALHA: a justificativa escrita não foi aceita — a correção não surtiu efeito.';
  end;

  -- Limpeza: o pedido de teste não pode sobrar no banco.
  delete from public.orders where id = v_pedido_id;

  select count(*) into v_erro from public.orders where codigo = 'DFZZTEST99';

  if v_erro::integer <> 0 then
    raise exception 'FALHA: o pedido de teste da migração não foi removido.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: sem comprovante e sem justificativa continua barrado';
  raise notice '  OK: sem comprovante e COM justificativa passa';
  raise notice '  OK: pedido de teste removido';
  raise notice '';
  raise notice '  O painel agora pede o motivo quando não há comprovante.';
  raise notice '──────────────────────────────────────────────';
end $$;
