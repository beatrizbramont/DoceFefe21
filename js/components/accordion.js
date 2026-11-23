/**
 * components/accordion.js
 * -----------------------------------------------------------------------------
 * Sanfona acessível, usada nas perguntas frequentes.
 *
 * ACESSIBILIDADE
 * O padrão WAI-ARIA para sanfonas exige:
 *   - o gatilho é um <button> (recebe foco e responde a Enter/Espaço de graça)
 *   - `aria-expanded` informa se está aberto
 *   - `aria-controls` aponta para o painel da resposta
 *   - o painel tem `role="region"` e `aria-labelledby` apontando ao gatilho
 *
 * A animação de altura é feita em CSS com `grid-template-rows: 0fr -> 1fr`,
 * técnica que funciona sem precisar medir a altura do conteúdo em JavaScript.
 */

import { $$ } from '../lib/ui.js';

/**
 * Ativa todas as sanfonas dentro de uma raiz.
 *
 * Estrutura esperada no HTML:
 *   <div class="faq" data-acordeao>
 *     <div class="faq__item">
 *       <h3><button class="faq__gatilho">Pergunta<span class="faq__sinal">+</span></button></h3>
 *       <div class="faq__resposta"><div class="faq__resposta-interno">
 *         <p>Resposta</p>
 *       </div></div>
 *     </div>
 *   </div>
 *
 * @param {ParentNode} [raiz]
 * @param {{umPorVez?: boolean}} [opcoes] - fechar os demais ao abrir um
 */
export function ativarAcordeoes(raiz = document, opcoes = {}) {
  const { umPorVez = false } = opcoes;

  $$('[data-acordeao]', raiz).forEach((grupo, indiceGrupo) => {
    const itens = $$('.faq__item', grupo);

    itens.forEach((item, indice) => {
      const gatilho = item.querySelector('.faq__gatilho');
      const resposta = item.querySelector('.faq__resposta');
      if (!gatilho || !resposta) return;

      // Identificadores únicos para ligar gatilho e resposta via ARIA.
      const id = `acordeao-${indiceGrupo}-${indice}`;
      gatilho.id = `${id}-gatilho`;
      resposta.id = `${id}-resposta`;

      gatilho.setAttribute('type', 'button');
      gatilho.setAttribute('aria-expanded', 'false');
      gatilho.setAttribute('aria-controls', resposta.id);

      resposta.setAttribute('role', 'region');
      resposta.setAttribute('aria-labelledby', gatilho.id);

      item.dataset.aberto = 'false';

      gatilho.addEventListener('click', () => {
        const estavaAberto = item.dataset.aberto === 'true';

        if (umPorVez) {
          itens.forEach((outro) => {
            outro.dataset.aberto = 'false';
            outro.querySelector('.faq__gatilho')?.setAttribute('aria-expanded', 'false');
          });
        }

        const abrir = !estavaAberto;
        item.dataset.aberto = String(abrir);
        gatilho.setAttribute('aria-expanded', String(abrir));
      });
    });
  });
}

export default ativarAcordeoes;
