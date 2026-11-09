// Lectura y formato de números en formato argentino (es-AR): punto de miles, coma decimal.
// Todo trabaja sobre texto + decimales exactos; nunca pasa por Number.
import { Dec, toDec, round, MAX_LARGO_NUMERO } from './decimal.mjs';

const STRIP = /[\s  $%]|ARS|US\$|USD|USDT|USDC/gi;

/**
 * Interpreta lo que el usuario escribe.
 * - "1.570,50" → 1570.50   (coma = decimal, punto = miles)
 * - "1650.69"  → 1650.69   (un solo punto que no agrupa 3 dígitos = decimal)
 * - "1.570"    → 1570 si kind = 'money' (miles, uso argentino); 1.57 si kind = 'percent' o 'ratio'
 * - "86.350.000" → 86350000
 * @param {string|number|null|undefined} input
 * @param {{kind?: 'money'|'percent'|'ratio'}} [opts]
 * @returns {{ok: true, empty: boolean, value: Dec|null} | {ok: false, empty: false, value: null, error: string}}
 */
export function parseNumberAR(input, { kind = 'money' } = {}) {
  if (input === null || input === undefined) return { ok: true, empty: true, value: null };
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return fail('El número no es finito');
    return { ok: true, empty: false, value: toDec(input) };
  }
  if (typeof input !== 'string') return fail('No es un número válido');
  let s = input.replace(STRIP, '');
  if (s === '') return { ok: true, empty: true, value: null };
  if (s.length > MAX_LARGO_NUMERO) return fail(`El número es demasiado largo (más de ${MAX_LARGO_NUMERO} caracteres)`);

  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s === '') return fail('Falta el número');

  let intPart;
  let decPart = '';
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  if (commas > 1) return fail('Hay más de una coma decimal');
  if (commas === 1) {
    [intPart, decPart] = s.split(',');
    if (dots > 0) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(intPart)) return fail('Los puntos de miles están mal ubicados');
      intPart = intPart.replace(/\./g, '');
    }
    if (intPart === '') intPart = '0';
    if (!/^\d*$/.test(decPart)) return fail('Decimales inválidos');
  } else if (dots > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return fail('Los puntos de miles están mal ubicados');
    intPart = s.replace(/\./g, '');
  } else if (dots === 1) {
    const isThousands = kind === 'money' && /^[1-9]\d{0,2}\.\d{3}$/.test(s);
    if (isThousands) {
      intPart = s.replace('.', '');
    } else {
      [intPart, decPart] = s.split('.');
      if (intPart === '') intPart = '0';
    }
  } else {
    intPart = s;
  }

  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(decPart)) return fail('No es un número válido');
  const text = (negative ? '-' : '') + intPart + (decPart ? '.' + decPart : '');
  return { ok: true, empty: false, value: Dec(text) };
}

function fail(error) {
  return { ok: false, empty: false, value: null, error };
}

/**
 * Formatea con miles "." y decimales ",". Redondea half-up.
 * @param {Dec|number|string} value
 * @param {{decimals?: number, minDecimals?: number}} [opts] minDecimals < decimals recorta ceros finales.
 */
export function formatNumberAR(value, { decimals = 2, minDecimals = decimals } = {}) {
  const r = round(value, decimals);
  let [int, dec = ''] = r.abs().toFixed(decimals).split('.');
  while (dec.length > minDecimals && dec.endsWith('0')) dec = dec.slice(0, -1);
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const neg = r.lt(0) ? '-' : '';
  return neg + int + (dec ? ',' + dec : '');
}

/** "$ 1.727,00" / "-$ 3.815.500,00" */
export function formatARS(value, { decimals = 2 } = {}) {
  const r = round(value, decimals);
  const body = formatNumberAR(r.abs(), { decimals });
  return (r.lt(0) ? '-' : '') + '$ ' + body;
}

/** "+$ 1.000,00" con signo explícito (para resultados). */
export function formatARSSigned(value, { decimals = 2 } = {}) {
  const r = round(value, decimals);
  if (r.gt(0)) return '+' + formatARS(r, { decimals });
  return formatARS(r, { decimals });
}

/** "-4,42 %" / "+5,63 %" */
export function formatPct(value, { decimals = 2, signed = true } = {}) {
  const r = round(value, decimals);
  const s = formatNumberAR(r, { decimals });
  return (signed && r.gt(0) ? '+' : '') + s + ' %';
}

/** "50.000,00 USD" */
export function formatUnits(value, unit, { decimals = 2 } = {}) {
  return `${formatNumberAR(value, { decimals })} ${unit}`;
}

/** Cotización tal como viene, sin ceros de más: 1573.8 → "1.573,8". */
export function formatQuote(value) {
  return formatNumberAR(value, { decimals: 4, minDecimals: 0 });
}
