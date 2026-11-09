// Costo de pasar de un instrumento a otro, como lo dice el usuario: "te cobran X %" (o, raro, "te dan X % de más").
// El motor trabaja con la relación R (unidades del instrumento que vendés por cada unidad del que comprás):
//   te cobran p % → R = 1 − p/100      te dan p % de más → R = 1 + p/100
// Exacto (decimales de big.js). Vacío = no sé: la conversión es indispensable, así que no hay resultado (nunca se supone gratis).
import { ONE, HUNDRED, pct, toDec } from './decimal.mjs';

export const SENTIDOS_CONVERSION = { cobran: 'Te cobran', dan: 'Te dan de más' };
/** Topes: si te cobran 100 % o más no recibís nada; "te dan de más" hasta el doble. */
export const MAX_COBRAN_PCT = 100;
export const MAX_DAN_PCT = 100;

/**
 * % que te cobran (o te dan) → relación R.
 * @param {*} p  porcentaje (≥ 0)  @param {'cobran'|'dan'} [sentido]
 * @returns {{ok: true, relacion: *} | {ok: false, error: string}}
 */
export function relacionDesdePct(p, sentido = 'cobran') {
  if (!Object.hasOwn(SENTIDOS_CONVERSION, sentido)) return { ok: false, error: 'Elegí si te cobran o te dan de más.' };
  const x = toDec(p);
  if (x.lt(0)) return { ok: false, error: 'El porcentaje no puede ser negativo: si te dan de más, elegí "Te dan de más".' };
  if (sentido === 'cobran' && x.gte(MAX_COBRAN_PCT)) return { ok: false, error: 'Si te cobran 100 % o más no recibís nada: revisá el dato.' };
  if (sentido === 'dan' && x.gt(MAX_DAN_PCT)) return { ok: false, error: 'Más del 100 % de más es inusual: revisá el dato.' };
  return { ok: true, relacion: sentido === 'dan' ? ONE.plus(pct(x)) : ONE.minus(pct(x)) };
}

/** Relación R (> 0) → { sentido, pct } (para pasar lo que estaba guardado con la relación). */
export function pctDesdeRelacion(R) {
  const r = toDec(R);
  return r.lte(1) ? { sentido: 'cobran', pct: ONE.minus(r).times(HUNDRED) } : { sentido: 'dan', pct: r.minus(ONE).times(HUNDRED) };
}
