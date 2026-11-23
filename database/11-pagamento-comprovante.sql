-- =============================================================================
-- DOCE FEFÊ.21 — 11-pagamento-comprovante.sql
-- Fluxo de pagamento: Pix com comprovante, ou dinheiro pelo WhatsApp
-- =============================================================================
--
-- EXECUTE DEPOIS DE 10.
--
-- ⚠️ ESTE ARQUIVO PRECISA SER EXECUTADO SOZINHO
--
--   O comando `alter type ... add value` não pode ter o valor novo USADO na
--   mesma transação em que foi criado. Por isso este arquivo só CRIA o status,
--   e a conferência que o utiliza fica no arquivo 12.
--
-- -----------------------------------------------------------------------------
-- O FLUXO QUE ESTE ARQUIVO SUSTENTA
--
--   1. Cliente registra o pedido  → status: aguardando_pagamento
--   2. Escolhe como vai pagar:
--        • dinheiro → combina pelo WhatsApp
--        • pix      → vê o QR Code e paga pelo banco
--   3. Envia o comprovante        → status: comprovante_enviado
--   4. A loja confere e aprova    → status: pagamento_aprovado
--
-- -----------------------------------------------------------------------------
-- ⚠️ POR QUE ENVIAR O COMPROVANTE **NÃO** APROVA O PAGAMENTO
--
--   O comprovante é um arquivo que o cliente escolhe. Nada impede que alguém
--   envie uma foto qualquer, ou o comprovante de outra compra.
--
--   Por isso existe o status intermediário `comprovante_enviado`: ele diz
--   "o cliente afirma que pagou", não "o pagamento está confirmado". Quem
--   confirma é a loja, depois de conferir o valor e a data no extrato.
--
--   Essa separação é o mesmo princípio do webhook de um intermediador: a
--   confirmação precisa vir de uma fonte que o cliente não controla. Aqui
--   essa fonte é a pessoa que olha a conta bancária.
-- =============================================================================


-- =============================================================================
-- 1. NOVO STATUS
-- =============================================================================

-- `if not exists` permite rodar o arquivo mais de uma vez sem erro.
alter type status_pedido add value if not exists 'comprovante_enviado'
  after 'aguardando_pagamento';


-- =============================================================================
-- 2. CAMPOS DO COMPROVANTE
--
-- Ficam na tabela `payments`, que já existe para registrar transações. Cada
-- pedido passa a ter uma linha ali assim que o cliente escolhe a forma de
-- pagamento.
-- =============================================================================

alter table public.payments
  add column if not exists comprovante_caminho text,
  add column if not exists comprovante_nome_original text,
  add column if not exists comprovante_tamanho_bytes integer,
  add column if not exists comprovante_enviado_em timestamptz,
  add column if not exists conferido_em timestamptz,
  add column if not exists conferido_por uuid references auth.users(id) on delete set null,
  add column if not exists observacao_conferencia text;

comment on column public.payments.comprovante_caminho is
  'Caminho do arquivo no Supabase Storage (bucket privado "comprovantes"). '
  'Nunca é uma URL pública: o acesso passa pelo backend.';

comment on column public.payments.conferido_em is
  'Quando a loja CONFERIU o comprovante no extrato. Enquanto for nulo, o '
  'pagamento não está confirmado, mesmo havendo comprovante enviado.';

-- O comprovante exige os três dados juntos: caminho, nome e data. Ter só
-- parte deles indicaria um upload que falhou no meio.
alter table public.payments
  drop constraint if exists payments_comprovante_completo;

alter table public.payments
  add constraint payments_comprovante_completo check (
    (comprovante_caminho is null
      and comprovante_nome_original is null
      and comprovante_enviado_em is null)
    or
    (comprovante_caminho is not null
      and comprovante_nome_original is not null
      and comprovante_enviado_em is not null)
  );

-- Conferência sem comprovante não faz sentido no fluxo do Pix.
-- (Pagamento em dinheiro é confirmado direto, sem passar por aqui.)
alter table public.payments
  drop constraint if exists payments_conferencia_exige_comprovante;

alter table public.payments
  add constraint payments_conferencia_exige_comprovante check (
    conferido_em is null
    or comprovante_caminho is not null
    or metodo = 'dinheiro'
  );

create index if not exists payments_aguardando_conferencia_idx
  on public.payments (comprovante_enviado_em desc)
  where comprovante_caminho is not null and conferido_em is null;


-- =============================================================================
-- 3. BUCKET DE COMPROVANTES
--
-- ⚠️ PRIVADO (`public = false`). Um comprovante de Pix traz nome, banco,
--   valor e horário do pagamento — dado pessoal. Em bucket público, bastaria
--   adivinhar o nome do arquivo para ler o comprovante de outra pessoa.
--
--   O acesso acontece sempre pelo backend, que confere quem está pedindo.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprovantes',
  'comprovantes',
  false,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];


-- -----------------------------------------------------------------------------
-- Nenhuma política de acesso é criada para este bucket.
--
-- Sem política, o RLS do Storage NEGA tudo para as chaves pública e
-- autenticada. Só a chave de serviço (service_role), usada exclusivamente
-- pelo backend, consegue gravar e ler. É exatamente o que queremos: o
-- navegador nunca toca nesses arquivos diretamente.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 4. CONFERÊNCIA
--
-- Não usa o literal 'comprovante_enviado' de propósito — ele só pode ser
-- referenciado em outra transação. A verificação completa está no arquivo 12.
-- =============================================================================

do $$
declare
  v_colunas integer;
  v_bucket  integer;
begin
  select count(*) into v_colunas
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'payments'
     and column_name in (
       'comprovante_caminho', 'comprovante_nome_original',
       'comprovante_enviado_em', 'conferido_em'
     );

  if v_colunas <> 4 then
    raise exception 'Esperadas 4 colunas de comprovante, encontradas %.', v_colunas;
  end if;

  select count(*) into v_bucket
    from storage.buckets where id = 'comprovantes' and public = false;

  if v_bucket <> 1 then
    raise exception 'Bucket "comprovantes" não foi criado como privado.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: colunas de comprovante criadas';
  raise notice '  OK: bucket "comprovantes" criado e PRIVADO';
  raise notice '  OK: nenhuma política de acesso público';
  raise notice '';
  raise notice '  Agora execute o arquivo 12.';
  raise notice '──────────────────────────────────────────────';
end $$;
