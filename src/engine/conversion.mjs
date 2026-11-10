// Costo de pasar de un instrumento a otro, como lo dice el usuario:
//   "te cobran X %" de lo que pasás, "pagás cada USDT X % más caro" (X % arriba del precio) o, raro, "te dan X % de más".
// El motor trabaja con la relación R (unidades del instrumento que vendés por cada unidad del que comprás):
//   te cobran p % → R = 1 − p/100      pagás p % arriba del precio → R = 1 / (1 + p/100)      te dan p % de más → R = 1 + p/100
// Ejemplo: oficial a 1535 y "compro USDT al 2 %" = cada USDT te sale 1535 × 1,02 = 1565,70 → por cada 100 USD recibís 98,04 USDT.
// Exacto (decimales de big.js). Vacío = no sé: la conversión es indispensable, así que no hay resultado (nunca se supone gratis).
import { ONE, HUNDRED, pct, toDec } from './decimal.mjs';
import { formatNumberAR } from './format.mjs';

export const SENTIDOS_CONVERSION = { cobran: 'Te cobran', sobreprecio: 'Pagás más caro', dan: 'Te dan de más' };
/** Qué significa el % en cada caso (va al lado del campo). */
export const UNIDAD_SENTIDO = { cobran: '% de lo que pasás', sobreprecio: '% arriba del precio', dan: '% de más' };
/** Topes: si te cobran 100 % o más no recibís nada; pagar más del doble o recibir más del doble es inusual. */
export const MAX_COBRAN_PCT = 100;
export const MAX_SOBREPRECIO_PCT = 100;
export const MAX_DAN_PCT = 100;

/**
 * % que te cobran (o pagás de más, o te dan) → relación R.
 * @param {*} p  porcentaje (≥ 0)  @param {'cobran'|'sobreprecio'|'dan'} [sentido]
 * @returns {{ok: true, relacion: *} | {ok: false, error: string}}
 */
export function relacionDesdePct(p, sentido = 'cobran') {
  if (!Object.hasOwn(SENTIDOS_CONVERSION, sentido)) return { ok: false, error: 'Elegí si te cobran, si pagás más caro o si te dan de más.' };
  const x = toDec(p);
  if (x.lt(0)) return { ok: false, error: 'El porcentaje no puede ser negativo: si te dan de más, elegí "Te dan de más".' };
  if (sentido === 'cobran' && x.gte(MAX_COBRAN_PCT)) return { ok: false, error: 'Si te cobran 100 % o más no recibís nada: revisá el dato.' };
  if (sentido === 'sobreprecio' && x.gt(MAX_SOBREPRECIO_PCT)) return { ok: false, error: 'Pagar más del doble es inusual: revisá el dato.' };
  if (sentido === 'dan' && x.gt(MAX_DAN_PCT)) return { ok: false, error: 'Más del 100 % de más es inusual: revisá el dato.' };
  if (sentido === 'sobreprecio') return { ok: true, relacion: HUNDRED.div(HUNDRED.plus(x)) };
  return { ok: true, relacion: sentido === 'dan' ? ONE.plus(pct(x)) : ONE.minus(pct(x)) };
}

/** Relación R (> 0) → { sentido, pct } (para pasar lo que estaba guardado con la relación). */
export function pctDesdeRelacion(R) {
  const r = toDec(R);
  return r.lte(1) ? { sentido: 'cobran', pct: ONE.minus(r).times(HUNDRED) } : { sentido: 'dan', pct: r.minus(ONE).times(HUNDRED) };
}

/**
 * Cómo se dice la conversión ("te cobran 1,5 %", "pagás 2 % arriba del precio", "sin costo (0 %)").
 * @param {{sentido: string, pct: *} | null} dicha  lo que cargó el usuario; si no está, se deduce de R
 * @param {*} [R]
 */
export function textoConversion(dicha, R = null) {
  const { sentido, pct: p } = dicha && Object.hasOwn(SENTIDOS_CONVERSION, dicha.sentido) ? { sentido: dicha.sentido, pct: toDec(dicha.pct) } : pctDesdeRelacion(R);
  const t = formatNumberAR(p, { decimals: 6, minDecimals: 0 });
  if (p.eq(0)) return 'sin costo (0 %)';
  if (sentido === 'dan') return `te dan ${t} % de más`;
  if (sentido === 'sobreprecio') return `pagás ${t} % arriba del precio`;
  return `te cobran ${t} %`;
}
