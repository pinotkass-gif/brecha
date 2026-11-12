// Blue de la calle (pedido del propietario 12/11/2026: "dame una opción para cambiarte el blue a lo que consigo en la
// calle"). Es el precio que él paga por cada billete; queda guardado en su navegador y, cuando la calculadora compra
// blue, se usa en vez del blue de DolarAPI (que se sigue mostrando para comparar). Puro: sin DOM ni almacenamiento.
import { parseNumberAR } from '../engine/format.mjs';
import { toDec, plain } from '../engine/decimal.mjs';

export const KEY_CALLE = 'brecha.blue.calle.v1';
const MAXIMO = toDec('10000000');
const RARO_PCT = toDec(15);

/** Lo guardado → {venta: string, at: string} o null si no sirve (se revalida al leer). */
export function restaurarCalle(g, ahora = new Date()) {
  if (!g || typeof g !== 'object' || typeof g.venta !== 'string' || typeof g.at !== 'string') return null;
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(g.venta)) return null;
  const v = toDec(g.venta);
  if (!v.gt(0) || v.gt(MAXIMO)) return null;
  const t = Date.parse(g.at);
  if (!Number.isFinite(t) || t > ahora.getTime() + 24 * 3600e3) return null;
  return { venta: g.venta, at: new Date(t).toISOString() };
}

/** Texto que escribió («1.450», «1450,50») → {ok, calle} o {ok: false, error}. */
export function leerCalle(texto, ahora = new Date()) {
  const p = parseNumberAR(String(texto ?? ''), { kind: 'money' });
  if (!p.ok) return { ok: false, error: p.error };
  if (p.empty) return { ok: false, error: 'Escribí a cuánto conseguís cada billete, por ejemplo 1.450.' };
  if (!p.value.gt(0)) return { ok: false, error: 'Tiene que ser mayor que 0.' };
  if (p.value.gt(MAXIMO)) return { ok: false, error: 'Ese precio es demasiado grande.' };
  return { ok: true, calle: { venta: plain(p.value.round(4)), at: ahora.toISOString() } };
}

/** Si el de la calle se aleja más de 15 % del blue de DolarAPI, un aviso (se guarda igual: el precio es suyo). */
export function avisoCalle(calle, blueVenta) {
  if (!calle || blueVenta === null || blueVenta === undefined) return null;
  const b = toDec(blueVenta);
  if (!b.gt(0)) return null;
  const dif = toDec(calle.venta).minus(b).div(b).times(100);
  return dif.abs().gt(RARO_PCT) ? `Ojo: está ${plain(dif.abs().round(1)).replace('.', ',')} % ${dif.gt(0) ? 'arriba' : 'abajo'} del blue de DolarAPI. Revisá que esté bien escrito.` : null;
}
