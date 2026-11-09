// Calculadora inversa: cuánto capital inicial hace falta para llegar a un objetivo, con todos los costos de la
// ruta (fijos, %, mínimos, impuestos, conversiones, slippage, redondeos). Las restricciones de la ruta (mínimos,
// máximos, liquidez) no frenan la búsqueda: se informan sobre el monto encontrado.
// Se resuelve por bisección con decimales exactos sobre una función que crece con el monto.
import { Dec, ZERO, ONE, HUNDRED, pct } from './decimal.mjs';
import { simularRuta } from './route.mjs';

export const OBJETIVOS_INVERSA = {
  ganancia: 'Ganancia neta que querés conseguir',
  capital_final: 'Capital final que querés tener',
  recibir: 'Cantidad que querés recibir en un paso',
};

const ITERACIONES = 110;

/**
 * @param {object} entrada  entrada del motor de rutas (se cambia sólo el monto inicial, sobre copias)
 * @param {{tipo: keyof OBJETIVOS_INVERSA, valor: *, paso?: number}} objetivo
 * @param {object} [motor]  opciones de simularRuta
 */
export function calcularInversa(entrada, { tipo, valor, paso = null }, motor = {}) {
  let meta;
  try { meta = Dec(String(valor)); } catch { return { ok: false, motivo: 'El objetivo no es un número válido.' }; }
  if (!(tipo in OBJETIVOS_INVERSA)) return { ok: false, motivo: 'Objetivo desconocido.' };
  if (tipo !== 'ganancia' && meta.lte(0)) return { ok: false, motivo: 'El objetivo tiene que ser mayor que 0.' };
  const opciones = { ...motor, objetivos: false };
  const correr = (M) => simularRuta({ ...entrada, montoInicial: M }, opciones);
  const base = correr(entrada.montoInicial);
  if (!base.ok) return { ok: false, motivo: 'La simulación no se puede calcular: completá los datos primero.', datosInsuficientes: base.datosInsuficientes };
  if (tipo === 'ganancia' && !base.result.mismoActivo) return { ok: false, motivo: 'La ruta no vuelve al activo inicial: no hay ganancia comparable.' };
  if (tipo === 'recibir' && (paso === null || !base.result.pasos[paso])) return { ok: false, motivo: 'Elegí el paso.' };
  const medir = (M) => {
    const s = correr(M);
    if (!s.ok) return null;
    if (tipo === 'ganancia') return s.result.resultadoNeto;
    if (tipo === 'capital_final') return s.result.montoFinal;
    return s.result.pasos[paso].recibido;
  };
  const M0 = base.result.montoInicial;

  // ¿Crece con el monto? (en "ganancia" sólo si la operación gana en el margen)
  const lejos = M0.times('1e6');
  const y1 = medir(lejos);
  const y2 = medir(lejos.times(2));
  if (y1 === null || y2 === null || !y2.gt(y1)) {
    return { ok: false, motivo: tipo === 'ganancia' ? 'La operación pierde a cualquier escala: ningún monto llega a esa ganancia.' : 'Con estos datos el resultado no crece con el monto.' };
  }
  const M = buscar(medir, meta, M0);
  if (!M) return { ok: false, motivo: 'No se encontró un monto que llegue al objetivo.' };
  const s = correr(M);
  const r = s.result;
  return {
    ok: true, tipo, objetivo: meta,
    montoInicial: M, capitalInvertido: r.capitalInvertido, activo: r.activoInicial,
    montoFinal: r.montoFinal, resultadoNeto: r.resultadoNeto, roiPct: r.roiPct,
    violaciones: r.pasos.flatMap((p) => p.violaciones.map((v) => v.texto)),
    nivel: s.calidad.nivel,
  };
}

/** Menor monto M con f(M) ≥ meta (f crece con M a partir de algún punto). */
function buscar(f, meta, M0) {
  const llega = (M) => { const y = f(M); return y !== null && y.gte(meta); };
  let hi = M0;
  for (let k = 0; k < 200 && !llega(hi); k++) hi = hi.times(2);
  if (!llega(hi)) return null;
  let lo = hi.div(2);
  for (let k = 0; k < 200 && llega(lo); k++) lo = lo.div(2);
  if (llega(lo)) return lo; // ya llega con montos ínfimos
  for (let k = 0; k < ITERACIONES; k++) {
    const mid = lo.plus(hi).div(2);
    if (llega(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Escala de la operación: capital mínimo rentable y desde qué monto los costos fijos pesan poco.
 * @returns {{ok: boolean, motivo?: string, minimoRentable?: Dec|null, roiLimitePct?: Dec, umbrales?: Array<{pesoPct: number, monto: Dec}>}}
 */
export function escalaDeCostos(entrada, motor = {}) {
  const opciones = { ...motor, objetivos: false };
  const correr = (M) => simularRuta({ ...entrada, montoInicial: M }, opciones);
  const base = correr(entrada.montoInicial);
  if (!base.ok || !base.result.mismoActivo) return { ok: false, motivo: 'Hace falta una ruta calculable que vuelva al activo inicial.' };
  const M0 = base.result.montoInicial;
  const roi = (M) => { const s = correr(M); return s.ok ? s.result.roiPct : null; };
  // ROI con un monto enorme: los costos fijos ya no pesan (límite de la operación)
  const limite = roi(M0.times('1e9'));
  if (limite === null) return { ok: false, motivo: 'No se pudo calcular el límite.' };
  const ganancia = (M) => { const s = correr(M); return s.ok ? s.result.resultadoNeto : null; };
  const minimoRentable = limite.gt(0) ? buscar(ganancia, ZERO, M0) : null;
  const umbrales = [];
  if (limite.gt(0)) {
    for (const peso of [10, 1]) {
      // ROI(M) ≥ límite × (1 − peso %): los fijos se llevan como mucho ese % de la ganancia posible
      const meta = limite.times(ONE.minus(pct(peso)));
      const M = buscar((x) => roi(x), meta, M0);
      if (M) umbrales.push({ pesoPct: peso, monto: M });
    }
  }
  return { ok: true, roiLimitePct: limite, minimoRentable, umbrales, activo: base.result.activoInicial, sinGananciaPosible: !limite.gt(0) };
}

export { HUNDRED };
