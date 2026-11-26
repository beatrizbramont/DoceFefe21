-- =============================================================================
-- DOCE FEFÊ.21 — 24-perfil-guarda-o-telefone.sql
-- O telefone digitado no cadastro passa a chegar no perfil
-- =============================================================================
--
-- EXECUTE DEPOIS DE 23.
--
-- -----------------------------------------------------------------------------
-- O QUE ACONTECIA
--
--   A cliente digitava o telefone no cadastro, confirmava o código, entrava
--   na conta — e o campo aparecia vazio. Ela tinha que digitar de novo.
--
--   O dado não se perdia no caminho. O formulário mandava, o `auth.js`
--   colocava em `raw_user_meta_data`, e o Supabase guardava direitinho em
--   `auth.users`. Só que o gatilho que cria o perfil lia apenas o nome:
--
--       insert into public.profiles (id, nome, perfil)
--
--   O telefone ficava parado em `auth.users`, e a tela do perfil lê de
--   `public.profiles`. Dois lugares, e o dado no lugar errado.
--
-- -----------------------------------------------------------------------------
-- ⚠️ POR QUE A LIMPEZA DO NÚMERO NÃO É DETALHE
--
--   `profiles.telefone` tem restrição de formato: `^[0-9]{10,11}$`.
--
--   Se o gatilho tentasse gravar "(11) 98765-4321" ou um número incompleto,
--   a restrição recusaria — e como o gatilho roda DENTRO da inserção em
--   `auth.users`, a exceção derrubaria o cadastro inteiro. A pessoa veria um
--   erro genérico e não conseguiria criar conta.
--
--   Perder o telefone é um aborrecimento. Impedir alguém de se cadastrar é
--   perder a cliente. Então o número é limpo e, se ainda assim não couber no
--   formato, entra como nulo: o cadastro segue, e ela preenche depois.
-- =============================================================================

create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telefone text;
begin
  -- Tira tudo que não é dígito: a pessoa digita com parênteses e traço.
  v_telefone := regexp_replace(
    coalesce(new.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'
  );

  -- Fora do formato aceito, guarda nulo em vez de derrubar o cadastro.
  if v_telefone !~ '^[0-9]{10,11}$' then
    v_telefone := null;
  end if;

  insert into public.profiles (id, nome, telefone, perfil)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    v_telefone,
    -- Todo cadastro novo nasce como 'cliente'. Promoção a admin ou
    -- revendedor é sempre ação deliberada, feita pelo backend.
    'cliente'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


-- =============================================================================
-- QUEM JÁ SE CADASTROU
--
-- O telefone dessas pessoas está em `auth.users`, guardado, só não copiado.
-- Trazemos agora — ninguém precisa digitar de novo.
--
-- Só preenche quem está com o campo VAZIO. Quem já corrigiu à mão no perfil
-- tem o número mais recente, e sobrescrever seria desfazer uma correção.
-- =============================================================================

update public.profiles p
   set telefone = regexp_replace(u.raw_user_meta_data->>'telefone', '\D', '', 'g')
  from auth.users u
 where u.id = p.id
   and p.telefone is null
   and regexp_replace(
         coalesce(u.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'
       ) ~ '^[0-9]{10,11}$';


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_total      integer;
  v_com        integer;
  v_recuperado integer;
begin
  select count(*) into v_total from public.profiles;

  select count(*) into v_com
    from public.profiles where telefone is not null;

  -- Ainda sobrou alguém com telefone guardado no auth e vazio no perfil?
  select count(*) into v_recuperado
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.telefone is null
     and regexp_replace(
           coalesce(u.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'
         ) ~ '^[0-9]{10,11}$';

  raise notice '──────────────────────────────────────────────';
  raise notice '  Telefone no perfil';
  raise notice '';
  raise notice '    % conta(s) no total', v_total;
  raise notice '    % com telefone preenchido', v_com;
  raise notice '';

  if v_recuperado > 0 then
    raise exception
      '% perfil(is) ainda vazios com telefone disponível no cadastro.',
      v_recuperado;
  end if;

  raise notice '  Nenhum telefone ficou para trás.';
  raise notice '  Cadastros novos passam a trazer o número sozinhos.';
  raise notice '──────────────────────────────────────────────';
end $$;
