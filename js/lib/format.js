/**
 * lib/format.js
 * -----------------------------------------------------------------------------
 * Formatação de valores para exibição em português do Brasil.
 */

/* -----------------------------------------------------------------------------
 * DINHEIRO
 *
 * Decisão importante: todos os valores monetários trafegam e são armazenados
 * em CENTAVOS (números inteiros). Isso elimina erros de ponto flutuante —
 * o clássico 0.1 + 0.2 === 0.30000000000000004, que em um carrinho vira
 * diferença de centavos no total.
 * -------------------------------------------------------------------------- */

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Converte centavos em texto monetário.
 * @param {number} centavos - ex.: 1250
 * @returns {string} ex.: "R$ 12,50"
 */
export function moeda(centavos) {
  const valor = Number(centavos);
  if (!Number.isFinite(valor)) return 'R$ 0,00';
  return formatadorMoeda.format(valor / 100);
}

/**
 * Converte um texto digitado pelo usuário em centavos.
 * Aceita "12,50", "12.50", "R$ 12,50".
 * @param {string|number} texto
 * @returns {number} centavos (inteiro)
 */
export function paraCentavos(texto) {
  if (typeof texto === 'number') return Math.round(texto * 100);
  if (!texto) return 0;
  const limpo = String(texto)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '') // remove ponto de milhar
    .replace(',', '.');
  const numero = Number.parseFloat(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

/* -----------------------------------------------------------------------------
 * DATA E HORA
 * -------------------------------------------------------------------------- */

/**
 * @param {string|Date} valor
 * @returns {string} ex.: "22/11/2026"
 */
export function data(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

/**
 * Data sem o ano — para prazos curtos, onde o ano é óbvio.
 * @param {string|Date} valor
 * @returns {string} ex.: "10/12"
 */
export function dataCurta(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * @param {string|Date} valor
 * @returns {string} ex.: "22/11/2026 às 21:19"
 */
export function dataHora(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/* -----------------------------------------------------------------------------
 * PESO
 * -------------------------------------------------------------------------- */

/**
 * @param {number} gramas
 * @returns {string} ex.: "90 g" ou "1,2 kg"
 */
export function peso(gramas) {
  const g = Number(gramas);
  if (!Number.isFinite(g) || g <= 0) return '—';
  if (g >= 1000) {
    return `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
  }
  return `${g.toLocaleString('pt-BR')} g`;
}

/* -----------------------------------------------------------------------------
 * TELEFONE
 * -------------------------------------------------------------------------- */

/**
 * Formata um telefone brasileiro enquanto o usuário digita.
 * @param {string} valor
 * @returns {string} ex.: "(11) 97978-8231"
 */
export function telefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  if (digitos.length <= 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  }
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

/** Remove tudo que não é dígito. Útil antes de enviar ao servidor. */
export const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');

/* -----------------------------------------------------------------------------
 * CEP e CNPJ
 * -------------------------------------------------------------------------- */

/** @returns {string} ex.: "01310-100" */
export function cep(valor) {
  const d = somenteDigitos(valor).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** @returns {string} ex.: "12.345.678/0001-90" */
export function cnpj(valor) {
  const d = somenteDigitos(valor).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(
    8,
    12
  )}-${d.slice(12)}`;
}

/* -----------------------------------------------------------------------------
 * TEXTO
 * -------------------------------------------------------------------------- */

/**
 * Gera um identificador amigável para URL.
 * "Brownie de Nutella" -> "brownie-de-nutella"
 */
export function slug(texto) {
  return String(texto || '')
    .normalize('NFD')
    // Faixa U+0300-U+036F = marcas de acentuacao separadas pelo NFD.
    .replace(new RegExp('[̀-ͯ]', 'g'), '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Corta o texto sem partir palavras no meio. */
export function resumir(texto, limite = 120) {
  const t = String(texto || '').trim();
  if (t.length <= limite) return t;
  const corte = t.slice(0, limite);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return `${corte.slice(0, ultimoEspaco > 0 ? ultimoEspaco : limite)}…`;
}

/** Pluraliza de forma simples: plural(1,'item','itens') -> "1 item" */
export function plural(quantidade, singular, pluralForma) {
  return `${quantidade} ${quantidade === 1 ? singular : pluralForma}`;
}
