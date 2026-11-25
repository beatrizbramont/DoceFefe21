-- =============================================================================
-- DOCE FEFÊ.21 — 22-sem-cor-na-descricao.sql
-- As descrições deixam de prometer a cor da embalagem
-- =============================================================================
--
-- EXECUTE DEPOIS DE 21.
--
-- -----------------------------------------------------------------------------
-- POR QUÊ
--
--   As descrições diziam "laço dourado", "laço verde", "caixa vermelha". A
--   embalagem é comprada em lote e a cor muda conforme o que o fornecedor
--   tem. Quando muda, a página passa a mentir — e a cliente que leu
--   "dourado" recebe verde e acha que veio o produto errado.
--
--   Cor de laço não é o que decide a compra; é detalhe que envelhece rápido
--   e gera conversa no WhatsApp. "Laço" sozinho continua verdadeiro em
--   qualquer lote.
--
-- -----------------------------------------------------------------------------
-- O QUE NÃO ENTRA AQUI
--
--   Cor que faz parte do DOCE continua escrita, porque aí é sabor e não
--   embalagem: "chocolate branco" num alfajor diz o que a pessoa vai comer.
--   A regra é: some a cor da caixa, fica a cor do doce.
-- =============================================================================

update public.products
   set descricao = 'Cesta decorada com tema de Natal, finalizada com laço. '
                   'Escolha entre 2 pães de mel ou 2 alfajores. '
                   'Quantidade limitada de embalagem.'
 where slug = 'kit-natal-2-cesta';

update public.products
   set descricao = 'Cesta especial com a estampa do Papai Noel e laço. '
                   'Escolha entre 3 pães de mel ou 3 alfajores. '
                   'Quantidade limitada de embalagem.'
 where slug = 'kit-natal-3-papai-noel';

update public.products
   set descricao = 'Caixa Feliz Natal, elegante e pronta para presentear. '
                   'Escolha entre 3 pães de mel ou 3 alfajores. '
                   'Quantidade limitada de embalagem.'
 where slug = 'kit-natal-4-papai-noel-especial';


-- -----------------------------------------------------------------------------
-- O TEXTO ALTERNATIVO DAS FOTOS
--
-- Ele é lido em voz alta por leitor de tela e aparece quando a imagem não
-- carrega. Deixá-lo com a cor antiga manteria a promessa viva num canto que
-- ninguém revisa.
-- -----------------------------------------------------------------------------

update public.product_images
   set alt = 'Kit 2 Cesta de Natal da Doce Fefê.21: cesta decorada com laço '
             'e dois pães de mel embalados'
 where alt like '%laço dourado%';

update public.product_images
   set alt = 'Kit 3 Cesta de Papai Noel da Doce Fefê.21: cesta com estampa '
             'de Papai Noel, laço e três pães de mel embalados'
 where alt like '%laço verde%';

update public.product_images
   set alt = 'Kit 4 Papai Noel Especial da Doce Fefê.21: caixa Feliz Natal '
             'com três pães de mel embalados'
 where alt like '%caixa vermelha%';


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  r        record;
  v_sobrou integer := 0;
begin
  -- Procuramos cor de EMBALAGEM. "Chocolate branco" é sabor e fica.
  for r in
    select slug, descricao
      from public.products
     where descricao ~* '(laço|caixa|cesta|embalagem|fita)[^.]{0,30}'
                        '(dourad|verde|vermelh|azul|pratead|rosa)'
        or descricao ~* '(dourad|verde|vermelh|azul|pratead|rosa)[a-z]*\s+'
                        '(laço|caixa|cesta|fita)'
  loop
    raise warning '  Ainda tem cor de embalagem: % → %', r.slug, r.descricao;
    v_sobrou := v_sobrou + 1;
  end loop;

  if v_sobrou > 0 then
    raise exception '% descrição(ões) ainda citam a cor da embalagem.', v_sobrou;
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Descrições dos kits';
  raise notice '';

  for r in
    select slug, descricao
      from public.products
     where slug like 'kit-natal-%'
     order by slug
  loop
    raise notice '    %', r.slug;
    raise notice '      %', r.descricao;
  end loop;

  raise notice '';
  raise notice '  Nenhuma cor de embalagem nas descrições.';
  raise notice '──────────────────────────────────────────────';
end $$;
