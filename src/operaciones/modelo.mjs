// Operaciones hechas (pedido 15/11/2026: "una pestaña de operaciones realizadas… cuánto pusimos, qué vuelta le dimos y
// cuánta ganancia hubo por día… una opción chiquita para corregirte con lo que realmente gané y vemos qué costo no
// tuvimos en cuenta, y vamos enseñando al sistema").
// Cada operación es una vuelta de su operativa: pesos → dólar billete → USDT (pagando un % más por cada USDT) → pesos.
// La ganancia calculada sale de la misma cuenta que la calculadora; si él dice cuánto ganó de verdad, la diferencia es
// un costo que no tuvimos en cuenta, y el promedio de esas diferencias es "lo aprendido" (se aplica a las próximas).
// Puro y con Dec; vive en este navegador (localStorage) y todo lo guardado se revalida al leer.
import { toDec, ZERO, ONE, HUNDRED, round, plain } from '../engine/decimal.mjs';

export const KEY_OPERACIONES = 'brecha.operaciones.v1';
export const MAX_OPERACIONES = 2000;
const NUM = /^\d{1,13}(\.\d{1,12})?$/;
const NUM_SIGNO = /^-?\d{1,13}(\.\d{1,12})?$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]{6,40}$/;
const texto = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n) : '');
const fechaValida = (t) => typeof t === 'string' && t.length <= 40 && !Number.isNaN(Date.parse(t));
const OFFSET_AR = -3 * 3600 * 1000;
/** "AAAA-MM-DD" en Argentina. */
export const diaAR = (d) => new Date(d.getTime() + OFFSET_AR).toISOString().slice(0, 10);

/** Límites razonables (para no guardar un error de tipeo como si fuera una operación). */
const LIMITES = {
  pesos: [toDec(1000), toDec('100000000000')],
  billete: [toDec(1), toDec(100000)],
  pct: [ZERO, toDec(100)],
  venta: [toDec(1), toDec(100000)],
};
const NOMBRE = { pesos: 'los pesos que pusiste', billete: 'el precio del dólar billete', pct: 'el % de los USDT', venta: 'el precio al que vendiste cada USDT' };

function leerNumero(v, campo) {
  let d;
  try { d = toDec(typeof v === 'number' ? String(v) : v); } catch { return { error: `Falta ${NOMBRE[campo]}.` }; }
  const [min, max] = LIMITES[campo];
  if (d.lt(min) || d.gt(max)) return { error: `Revisá ${NOMBRE[campo]}: ${campo === 'pct' ? 'tiene que estar entre 0 y 100' : 'no parece un valor real'}.` };
  return { valor: d };
}

/** La cuenta de una vuelta (igual que la calculadora en «mi operativa»: sin otros costos). */
export function calcularOperacion(op) {
  const pesos = toDec(op.pesos);
  const usd = pesos.div(toDec(op.billete));
  const usdt = usd.div(ONE.plus(toDec(op.pct).div(HUNDRED)));
  const cobrado = usdt.times(toDec(op.venta));
  const ganancia = cobrado.minus(pesos);
  const real = op.real === null || op.real === undefined ? null : toDec(op.real);
  const dif = real === null ? null : ganancia.minus(real); // > 0: ganó menos de lo calculado (un costo que no contamos)
  return {
    usd, usdt, cobrado, ganancia, gananciaPct: ganancia.div(pesos).times(HUNDRED),
    real, realPct: real === null ? null : real.div(pesos).times(HUNDRED),
    dif, difPct: dif === null ? null : dif.div(pesos).times(HUNDRED),
    // La diferencia dicha de otras formas, para encontrar qué costo fue
    equivale: dif === null || dif.eq(0) ? null : {
      billeteMasCaro: dif.div(usd), // pesos de más por cada dólar billete
      ventaMenos: dif.div(usdt), // pesos de menos por cada USDT vendido
      comisionVentaPct: dif.div(cobrado).times(HUNDRED), // como una comisión sobre lo cobrado
      usdtMenos: dif.div(toDec(op.venta)), // USDT que faltaron
    },
  };
}

/** Una operación guardada → la misma validada, o null. */
function validar(o) {
  if (!o || typeof o !== 'object' || !ID.test(o.id ?? '') || !fechaValida(o.t) || !DIA.test(o.dia ?? '')) return null;
  for (const k of ['pesos', 'billete', 'pct', 'venta']) if (typeof o[k] !== 'string' || !NUM.test(o[k]) || leerNumero(o[k], k).error) return null;
  const real = typeof o.real === 'string' && NUM_SIGNO.test(o.real) ? o.real : null;
  return {
    id: o.id, t: new Date(Date.parse(o.t)).toISOString(), dia: o.dia, pesos: o.pesos, billete: o.billete, pct: o.pct, venta: o.venta,
    donde: texto(o.donde, 60), nota: texto(o.nota, 200), real, motivo: real === null ? '' : texto(o.motivo, 120),
    corregida: real !== null && fechaValida(o.corregida) ? new Date(Date.parse(o.corregida)).toISOString() : null,
    origen: ['calculadora', 'chat', 'claude', 'mano'].includes(o.origen) ? o.origen : 'mano',
  };
}

/** Lo guardado → operaciones válidas, de la más vieja a la más nueva. */
export function restaurarOperaciones(g) {
  if (!Array.isArray(g)) return [];
  const vistos = new Set();
  return g.slice(-MAX_OPERACIONES).map(validar).filter((o) => o && !vistos.has(o.id) && vistos.add(o.id))
    .sort((a, b) => a.dia.localeCompare(b.dia) || Date.parse(a.t) - Date.parse(b.t));
}

const nuevoId = (ahora) => `${ahora.getTime().toString(36)}${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;

/**
 * Una operación nueva a partir de lo que dijo (números como Dec, string "1234.5" o number).
 * @returns {{ok: true, op: object} | {ok: false, error: string}}
 */
export function nuevaOperacion(d, { ahora = new Date(), origen = 'mano' } = {}) {
  const out = {};
  for (const k of ['pesos', 'billete', 'pct', 'venta']) {
    if (d?.[k] === null || d?.[k] === undefined || d[k] === '') return { ok: false, error: `Falta ${NOMBRE[k]}.` };
    const r = leerNumero(d[k], k);
    if (r.error) return { ok: false, error: r.error };
    out[k] = plain(round(r.valor, 10)); // lo que viene de la calculadora puede tener muchos decimales
  }
  const dia = DIA.test(d.dia ?? '') ? d.dia : diaAR(ahora);
  if (dia > diaAR(ahora)) return { ok: false, error: 'La fecha no puede ser después de hoy.' };
  const op = validar({ id: nuevoId(ahora), t: ahora.toISOString(), dia, ...out, donde: d.donde, nota: d.nota, origen, real: null });
  return op ? { ok: true, op } : { ok: false, error: 'No pude anotar la operación: revisá los números.' };
}

/** Lista nueva con la operación agregada (como mucho MAX_OPERACIONES; se descartan las más viejas). */
export function agregarOperacion(lista, op) {
  return restaurarOperaciones([...lista, op]);
}

/**
 * Corrige con lo que de verdad ganó (en pesos; negativo si perdió) y, si quiere, qué costo fue. real = null la deja
 * como calculada otra vez.
 */
export function corregirOperacion(lista, id, { real, motivo = '' }, { ahora = new Date() } = {}) {
  const i = lista.findIndex((o) => o.id === id);
  if (i < 0) return { ok: false, error: 'No encontré esa operación.' };
  let r = null;
  if (real !== null && real !== undefined && real !== '') {
    try { r = toDec(typeof real === 'number' ? String(real) : real); } catch { return { ok: false, error: 'Escribí cuánto ganaste en pesos (por ejemplo 95.000, o -5.000 si perdiste).' }; }
    if (r.abs().gt(toDec(lista[i].pesos).times(10))) return { ok: false, error: 'Eso es más de diez veces lo que pusiste: revisalo.' };
    r = round(r, 2);
  }
  const op = { ...lista[i], real: r === null ? null : plain(r), motivo: r === null ? '' : texto(motivo, 120), corregida: r === null ? null : ahora.toISOString() };
  const nueva = [...lista];
  nueva[i] = validar(op);
  return { ok: true, lista: nueva, op: nueva[i] };
}

export const borrarOperacion = (lista, id) => lista.filter((o) => o.id !== id);

/**
 * Lo aprendido de las operaciones corregidas: en promedio, cuánto menos ganó de lo calculado, como % de lo que puso.
 * Se promedia por operación (cada vuelta pesa igual). Con 0 corregidas, n = 0 y no hay ajuste.
 */
export function aprendizaje(lista) {
  const c = lista.map((o) => ({ o, x: calcularOperacion(o) })).filter(({ x }) => x.real !== null);
  if (!c.length) return { n: 0, costoPct: null, costoPesos: ZERO, motivos: [] };
  const costoPct = c.reduce((a, { x }) => a.plus(x.difPct), ZERO).div(c.length);
  const costoPesos = c.reduce((a, { x }) => a.plus(x.dif), ZERO);
  const motivos = new Map();
  for (const { o, x } of c) {
    const m = o.motivo.trim();
    if (!m) continue;
    const k = m.toLowerCase();
    const prev = motivos.get(k) ?? { motivo: m, veces: 0, pesos: ZERO };
    motivos.set(k, { ...prev, veces: prev.veces + 1, pesos: prev.pesos.plus(x.dif) });
  }
  return {
    n: c.length, costoPct, costoPesos, minPct: c.reduce((a, { x }) => (a === null || x.difPct.lt(a) ? x.difPct : a), null),
    maxPct: c.reduce((a, { x }) => (a === null || x.difPct.gt(a) ? x.difPct : a), null),
    motivos: [...motivos.values()].sort((a, b) => b.veces - a.veces),
  };
}

/** Ganancia calculada ajustada con lo aprendido (null si todavía no hay nada aprendido). */
export function ajustarConAprendido(ganancia, pesos, apr) {
  if (!apr || !apr.n) return null;
  return toDec(ganancia).minus(toDec(pesos).times(apr.costoPct).div(HUNDRED));
}

/**
 * Totales por día (el más nuevo primero). "ganancia" usa lo real de las corregidas y lo calculado de las demás.
 */
export function porDia(lista) {
  const dias = new Map();
  for (const o of lista) {
    const x = calcularOperacion(o);
    const d = dias.get(o.dia) ?? { dia: o.dia, ops: [], pesos: ZERO, calculada: ZERO, ganancia: ZERO, corregidas: 0 };
    d.ops.push({ op: o, calc: x });
    d.pesos = d.pesos.plus(toDec(o.pesos));
    d.calculada = d.calculada.plus(x.ganancia);
    d.ganancia = d.ganancia.plus(x.real ?? x.ganancia);
    if (x.real !== null) d.corregidas += 1;
    dias.set(o.dia, d);
  }
  return [...dias.values()].sort((a, b) => b.dia.localeCompare(a.dia))
    .map((d) => ({ ...d, n: d.ops.length, gananciaPct: d.ganancia.div(d.pesos).times(HUNDRED) }));
}

/** Totales de todo lo anotado. */
export function totales(lista) {
  const ds = porDia(lista);
  const ganancia = ds.reduce((a, d) => a.plus(d.ganancia), ZERO);
  return { n: lista.length, dias: ds.length, ganancia, calculada: ds.reduce((a, d) => a.plus(d.calculada), ZERO), corregidas: ds.reduce((a, d) => a + d.corregidas, 0) };
}
