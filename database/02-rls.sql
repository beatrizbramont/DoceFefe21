-- =============================================================================
-- DOCE FEFÊ.21 — 02-rls.sql
-- Políticas de segurança em nível de linha (Row Level Security)
-- =============================================================================
--
-- EXECUTE DEPOIS DE 01-schema.sql
--
-- O QUE É RLS E POR QUE ELE IMPORTA AQUI
--
--   A chave `anon` do Supabase é pública — ela fica no JavaScript do
--   navegador, e qualquer pessoa pode lê-la. Isso é seguro POR DESIGN,
--   desde que o RLS esteja ativo.
--
--   Com RLS, o banco filtra cada consulta pela identidade de quem pergunta.
--   Um cliente que tentar listar `orders` recebe apenas os pedidos dele —
--   não porque o código pediu assim, mas porque o BANCO não entrega mais
--   que isso. Mesmo um erro de programação no frontend não vaza dados.
--
--   REGRA DE OURO: tabela sem RLS ativo é tabela pública.
--
-- SOBRE A CHAVE service_role
--
--   A `service_role` IGNORA todas as políticas abaixo. Ela existe só para o
--   backend, onde aplicamos nossas próprias regras de autorização. Nunca
--   deve chegar ao navegador.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- ATIVAR RLS EM TODAS AS TABELAS
-- Fazemos isso primeiro: até existir uma política, ninguém acessa nada.
-- O comportamento padrão do PostgreSQL é NEGAR.
-- -----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.product_images      enable row level security;
alter table public.inventory           enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.addresses           enable row level security;
alter table public.resellers           enable row level security;
alter table public.coupons             enable row level security;
alter table public.promotions          enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.payments            enable row level security;
alter table public.contact_messages    enable row level security;


-- =============================================================================
-- 1. PROFILES
-- =============================================================================

drop policy if exists "perfil: ler o próprio" on public.profiles;
create policy "perfil: ler o próprio"
  on public.profiles for select
  using (id = auth.uid() or public.eh_admin());

-- O usuário edita o próprio perfil, MAS não pode se promover.
-- A checagem `perfil = (select perfil from ...)` no WITH CHECK impede que
-- alguém envie {"perfil": "admin"} na atualização.
drop policy if exists "perfil: editar o próprio sem trocar de papel" on public.profiles;
create policy "perfil: editar o próprio sem trocar de papel"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and perfil = (select p.perfil from public.profiles p where p.id = auth.uid())
  );

-- Administradores podem tudo.
drop policy if exists "perfil: admin gerencia" on public.profiles;
create policy "perfil: admin gerencia"
  on public.profiles for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 2. CATEGORIAS — leitura pública
-- =============================================================================

drop policy if exists "categoria: qualquer um lê as ativas" on public.categories;
create policy "categoria: qualquer um lê as ativas"
  on public.categories for select
  using (ativa or public.eh_admin());

drop policy if exists "categoria: só admin modifica" on public.categories;
create policy "categoria: só admin modifica"
  on public.categories for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 3. PRODUTOS
--
-- ATENÇÃO AO PREÇO DE ATACADO
--   A coluna `preco_atacado` existe nesta tabela. O RLS controla QUAIS LINHAS
--   são visíveis, mas não quais COLUNAS. Por isso o frontend NUNCA consulta
--   `products` diretamente — ele usa a visão `catalogo_publico`, que não
--   contém essa coluna, ou pede ao backend.
-- =============================================================================

drop policy if exists "produto: qualquer um lê os publicados" on public.products;
create policy "produto: qualquer um lê os publicados"
  on public.products for select
  using (
    (publicado and arquivado_em is null)
    or public.eh_admin()
  );

drop policy if exists "produto: só admin modifica" on public.products;
create policy "produto: só admin modifica"
  on public.products for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 4. IMAGENS
-- =============================================================================

drop policy if exists "imagem: segue o produto" on public.product_images;
create policy "imagem: segue o produto"
  on public.product_images for select
  using (
    exists (
      select 1 from public.products p
      where p.id = produto_id
        and ((p.publicado and p.arquivado_em is null) or public.eh_admin())
    )
  );

drop policy if exists "imagem: só admin modifica" on public.product_images;
create policy "imagem: só admin modifica"
  on public.product_images for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 5. ESTOQUE
--
-- O cliente precisa saber se o produto está disponível, mas não quantas
-- unidades existem — isso é informação estratégica do negócio.
-- A visão `catalogo_publico` entrega só o número disponível já calculado.
-- =============================================================================

drop policy if exists "estoque: leitura pública do disponível" on public.inventory;
create policy "estoque: leitura pública do disponível"
  on public.inventory for select
  using (true);

drop policy if exists "estoque: só admin modifica" on public.inventory;
create policy "estoque: só admin modifica"
  on public.inventory for all
  using (public.eh_admin())
  with check (public.eh_admin());

-- Histórico de movimentações é só para administradores.
drop policy if exists "movimento: só admin" on public.inventory_movements;
create policy "movimento: só admin"
  on public.inventory_movements for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 6. ENDEREÇOS — estritamente privados
-- =============================================================================

drop policy if exists "endereço: só o dono" on public.addresses;
create policy "endereço: só o dono"
  on public.addresses for all
  using (usuario_id = auth.uid() or public.eh_admin())
  with check (usuario_id = auth.uid() or public.eh_admin());


-- =============================================================================
-- 7. REVENDEDORES
--
-- O ponto mais sensível do sistema: é o status 'aprovado' aqui que libera
-- preços de atacado. Se o próprio revendedor pudesse editar o status, bastaria
-- uma requisição para conseguir desconto.
-- =============================================================================

drop policy if exists "revendedor: lê o próprio cadastro" on public.resellers;
create policy "revendedor: lê o próprio cadastro"
  on public.resellers for select
  using (usuario_id = auth.uid() or public.eh_admin());

-- Qualquer pessoa autenticada pode SOLICITAR cadastro...
drop policy if exists "revendedor: pode se candidatar" on public.resellers;
create policy "revendedor: pode se candidatar"
  on public.resellers for insert
  with check (
    usuario_id = auth.uid()
    -- ...mas a solicitação nasce obrigatoriamente como 'pendente'.
    and status = 'pendente'
    -- E sem condições comerciais autoconcedidas.
    and coalesce(desconto_percentual, 0) = 0
  );

-- O revendedor pode corrigir os próprios dados de contato, mas o status,
-- o desconto e o pedido mínimo precisam continuar iguais.
drop policy if exists "revendedor: edita dados sem mudar condições" on public.resellers;
create policy "revendedor: edita dados sem mudar condições"
  on public.resellers for update
  using (usuario_id = auth.uid())
  with check (
    usuario_id = auth.uid()
    and status = (select r.status from public.resellers r where r.usuario_id = auth.uid())
    and desconto_percentual = (select r.desconto_percentual from public.resellers r where r.usuario_id = auth.uid())
    and pedido_minimo_centavos = (select r.pedido_minimo_centavos from public.resellers r where r.usuario_id = auth.uid())
  );

drop policy if exists "revendedor: admin aprova e define condições" on public.resellers;
create policy "revendedor: admin aprova e define condições"
  on public.resellers for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 8. CUPONS
--
-- A lista de cupons NÃO é pública: expor todos os códigos ativos permitiria
-- a qualquer visitante usar um cupom destinado a uma campanha específica.
-- A validação de cupom acontece no backend, que consulta com service_role.
-- =============================================================================

drop policy if exists "cupom: só admin" on public.coupons;
create policy "cupom: só admin"
  on public.coupons for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 9. PROMOÇÕES — leitura pública (são anunciadas mesmo)
-- =============================================================================

drop policy if exists "promoção: qualquer um lê as vigentes" on public.promotions;
create policy "promoção: qualquer um lê as vigentes"
  on public.promotions for select
  using (
    (ativa and inicia_em <= now() and (termina_em is null or termina_em > now()))
    or public.eh_admin()
  );

drop policy if exists "promoção: só admin modifica" on public.promotions;
create policy "promoção: só admin modifica"
  on public.promotions for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 10. PEDIDOS
--
-- Sem RLS aqui, trocar um UUID na URL exibiria o pedido de outra pessoa —
-- com nome, telefone e endereço. É a falha mais comum em lojas virtuais.
-- =============================================================================

drop policy if exists "pedido: só o dono" on public.orders;
create policy "pedido: só o dono"
  on public.orders for select
  using (usuario_id = auth.uid() or public.eh_admin());

drop policy if exists "pedido: cliente cria o próprio" on public.orders;
create policy "pedido: cliente cria o próprio"
  on public.orders for insert
  with check (usuario_id = auth.uid());

-- O cliente NÃO atualiza pedidos. Mudança de status é decisão do negócio
-- (ou do webhook de pagamento), sempre pelo backend com service_role.
drop policy if exists "pedido: só admin atualiza" on public.orders;
create policy "pedido: só admin atualiza"
  on public.orders for update
  using (public.eh_admin())
  with check (public.eh_admin());

drop policy if exists "pedido: só admin exclui" on public.orders;
create policy "pedido: só admin exclui"
  on public.orders for delete
  using (public.eh_admin());


-- =============================================================================
-- 11. ITENS DO PEDIDO — seguem a visibilidade do pedido
-- =============================================================================

drop policy if exists "item: segue o pedido" on public.order_items;
create policy "item: segue o pedido"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = pedido_id
        and (o.usuario_id = auth.uid() or public.eh_admin())
    )
  );

drop policy if exists "item: só admin modifica" on public.order_items;
create policy "item: só admin modifica"
  on public.order_items for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 12. PAGAMENTOS
--
-- O cliente vê o status do próprio pagamento (para acompanhar o Pix), mas
-- nunca escreve nesta tabela. Status de pagamento só muda por webhook
-- validado no backend.
-- =============================================================================

drop policy if exists "pagamento: dono lê" on public.payments;
create policy "pagamento: dono lê"
  on public.payments for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = pedido_id
        and (o.usuario_id = auth.uid() or public.eh_admin())
    )
  );

drop policy if exists "pagamento: só admin modifica" on public.payments;
create policy "pagamento: só admin modifica"
  on public.payments for all
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 13. MENSAGENS DE CONTATO
--
-- Qualquer visitante pode enviar (inclusive sem conta), mas ninguém pode ler
-- as mensagens das outras pessoas.
-- =============================================================================

drop policy if exists "contato: qualquer um envia" on public.contact_messages;
create policy "contato: qualquer um envia"
  on public.contact_messages for insert
  with check (true);

drop policy if exists "contato: só admin lê" on public.contact_messages;
create policy "contato: só admin lê"
  on public.contact_messages for select
  using (public.eh_admin());

drop policy if exists "contato: só admin modifica" on public.contact_messages;
create policy "contato: só admin modifica"
  on public.contact_messages for update
  using (public.eh_admin())
  with check (public.eh_admin());


-- =============================================================================
-- 14. PERMISSÕES NA VISÃO PÚBLICA DO CATÁLOGO
-- =============================================================================

-- `security_invoker` faz a visão respeitar as políticas RLS de quem consulta,
-- em vez de rodar com os poderes de quem a criou. Sem isso, a visão seria
-- um buraco no RLS.
alter view public.catalogo_publico set (security_invoker = on);

grant select on public.catalogo_publico to anon, authenticated;


-- =============================================================================
-- 15. CONFERÊNCIA
-- Roda ao final e lista qualquer tabela que tenha ficado sem RLS.
-- O resultado esperado é NENHUMA linha.
-- =============================================================================

do $$
declare
  desprotegida record;
  total integer := 0;
begin
  for desprotegida in
    select c.relname as tabela
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    raise warning 'TABELA SEM RLS: %', desprotegida.tabela;
    total := total + 1;
  end loop;

  if total = 0 then
    raise notice 'OK: todas as tabelas de public estão com RLS ativo.';
  else
    raise exception '% tabela(s) sem RLS. Corrija antes de publicar.', total;
  end if;
end $$;
