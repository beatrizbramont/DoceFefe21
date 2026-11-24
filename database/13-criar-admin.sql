-- =============================================================================
-- DOCE FEFÊ.21 — 13-criar-admin.sql
-- Promove uma conta a administradora
-- =============================================================================
--
-- ⚠️ ANTES DE EXECUTAR
--   1. Crie sua conta normalmente pelo site, em minha-conta.html
--   2. Troque o e-mail abaixo pelo que você usou
--   3. Execute este arquivo
--
-- -----------------------------------------------------------------------------
-- POR QUE ISTO É UM ARQUIVO SQL, E NÃO UMA TELA
--
--   Virar administrador é a permissão mais sensível do sistema: dá acesso a
--   todos os pedidos, dados de clientes e aprovação de pagamentos.
--
--   Se existisse uma tela para isso, ela seria o alvo número um de qualquer
--   ataque. Como a promoção exige acesso direto ao banco — que só quem tem a
--   senha do Supabase possui —, não há superfície pela internet para atacar.
--
--   É também por isso que a política RLS em 02-rls.sql impede que um usuário
--   altere o próprio campo `perfil`: nem o dono da conta consegue se promover.
-- =============================================================================


-- =============================================================================
-- TROQUE O E-MAIL AQUI
-- =============================================================================

do $$
declare
  -- ⚠️ SUBSTITUA pelo e-mail da conta que você criou no site.
  --
  -- Deixado em branco de propósito: este arquivo vai para o Git, e um
  -- e-mail escrito aqui diz a quem ler exatamente qual conta tem o poder
  -- de aprovar pagamento. É meio caminho andado para quem quiser tentar
  -- invadir — e é dado pessoal exposto sem necessidade.
  c_email constant text := '';

  v_usuario_id uuid;
  v_perfil     text;
begin
  -- Procura o usuário no Supabase Auth.
  select id into v_usuario_id
    from auth.users
   where lower(email) = lower(c_email);

  if c_email = '' then
    raise exception
      'Preencha c_email na linha 36 com o e-mail da conta que voce criou no site.';
  end if;

  if v_usuario_id is null then
    raise exception
      'Nenhuma conta encontrada com o e-mail "%". Crie a conta pelo site primeiro, em minha-conta.html',
      c_email;
  end if;

  -- O gatilho `ao_criar_usuario` deve ter criado o perfil. Se não existe,
  -- algo saiu do lugar no cadastro.
  select perfil::text into v_perfil
    from public.profiles
   where id = v_usuario_id;

  if v_perfil is null then
    raise exception
      'A conta existe em auth.users mas não tem perfil em public.profiles. Verifique o gatilho ao_criar_usuario.';
  end if;

  if v_perfil = 'admin' then
    raise notice '──────────────────────────────────────────────';
    raise notice '  A conta % JÁ é administradora.', c_email;
    raise notice '──────────────────────────────────────────────';
    return;
  end if;

  update public.profiles
     set perfil = 'admin'
   where id = v_usuario_id;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Conta promovida a ADMINISTRADORA';
  raise notice '    E-mail: %', c_email;
  raise notice '    Perfil anterior: %', v_perfil;
  raise notice '';
  raise notice '  Acesse: /admin/pedidos.html';
  raise notice '──────────────────────────────────────────────';
end $$;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_admins integer;
  r        record;
begin
  select count(*) into v_admins from public.profiles where perfil = 'admin';

  raise notice '';
  raise notice '  Administradores cadastrados: %', v_admins;

  for r in
    select p.nome, u.email
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.perfil = 'admin'
     order by p.criado_em
  loop
    raise notice '    • % (%)', r.nome, r.email;
  end loop;

  if v_admins = 0 then
    raise warning 'NENHUM administrador cadastrado — o painel ficará inacessível.';
  end if;

  raise notice '';
end $$;
