// Escenarios adversos y análisis de sensibilidad sobre una ruta (la calculadora simple se analiza como su
// ruta equivalente). Nunca se modifica la simulación original: cada escenario trabaja sobre una copia.
// Pasos: el primero es "la compra", el último "la venta" y los del medio "las conversiones".
import { ONE, HUNDRED, ZERO, toDec, pct, plain, isDec } from './decimal.mjs';
import { simularRuta } from './route.mjs';
import { esNoAplica } from './costos.mjs';

export const ESCENARIOS = {
  compra_1: { texto: 'Cotización de compra 1 % peor', tipo: 'precio', pasos: 'primero', pct: '1' },
  venta_1: { texto: 'Cotización de venta 1 % peor', tipo: 'precio', pasos: 'ultimo', pct: '1' },
  conversion_05: { texto: 'Conversión 0,5 % peor', tipo: 'precio', pasos: 'intermedios', pct: '0.5' },
  comisiones_20: { texto: 'Comisiones 20 % más altas', tipo: 'comisiones', factor: '1.2' },
  liquidez_50: { texto: 'Liquidez 50 % menor', tipo: 'liquidez', factor: '0.5' },
  slippage_05: { texto: 'Slippage 0,5 puntos más', tipo: 'slippage', puntos: '0.5' },
  retraso_24: { texto: 'Retraso de 24 h', tipo: 'retraso', horas: 24 },
  retraso_48: { texto: 'Retraso de 48 h', tipo: 'retraso', horas: 48 },
};

/** Copia profunda que conserva los decimales exactos (structuredClone no los acepta). */
export function clonar(x) {
  if (isDec(x) || x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(clonar);
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clonar(v)]));
}

const numero = (x) => {
  if (x === null || x === undefined || x === '' || esNoAplica(x)) return null;
  try { return toDec(x); } catch { return null; }
};
/** Precio p % peor para quien opera: multiplicando se cobra menos; dividiendo se paga más. */
const peor = (P, base, p) => (base === 'origen_por_destino' ? P.times(ONE.plus(pct(p))) : P.times(ONE.minus(pct(p))));

function empeorarPaso(paso, p) {
  if ((paso.tipo ?? 'cambio') === 'transferencia') return false;
  const base = paso.base ?? 'destino_por_origen';
  if (Array.isArray(paso.libro) && paso.libro.length) {
    paso.libro = paso.libro.map((n) => {
      const precio = numero(n.precio);
      return precio ? { ...n, precio: peor(precio, base, p) } : n;
    });
    return true;
  }
  const P = numero(paso.cotizacion);
  if (!P) return false;
  paso.cotizacion = peor(P, base, p);
  return true;
}

/**
 * Aplica un escenario a una COPIA de la entrada.
 * @param {object} entrada  entrada del motor de rutas
 * @param {keyof ESCENARIOS} id
 * @param {{riesgoDiarioPct?: *}} [opts]  riesgo diario = cuánto puede empeorar el precio de salida por día de espera (lo cargás vos)
 * @returns {{ok: true, entrada: object} | {ok: false, motivo: string}}
 */
export function aplicarEscenario(entrada, id, { riesgoDiarioPct = null } = {}) {
  const def = ESCENARIOS[id];
  if (!def) return { ok: false, motivo: 'Escenario desconocido.' };
  const e = clonar(entrada);
  const pasos = e.pasos ?? [];
  const n = pasos.length;
  if (def.tipo === 'precio') {
    const indices = def.pasos === 'primero' ? [0] : def.pasos === 'ultimo' ? [n - 1] : pasos.map((_, i) => i).filter((i) => i > 0 && i < n - 1);
    if (def.pasos === 'intermedios' && !indices.length) return { ok: false, motivo: 'La ruta no tiene pasos de conversión entre la compra y la venta.' };
    const cambiados = indices.filter((i) => pasos[i] && empeorarPaso(pasos[i], def.pct)).length;
    if (!cambiados) return { ok: false, motivo: 'No hay una cotización cargada en ese paso.' };
  } else if (def.tipo === 'comisiones') {
    let cambiados = 0;
    for (const p of pasos) {
      if (Array.isArray(p.costos)) {
        p.costos = p.costos.map((c) => {
          if ((c.fiscal ?? 'no_fiscal') !== 'no_fiscal') return c;
          const v = numero(c.valor);
          if (!v || v.eq(0)) return c;
          cambiados++;
          const m = numero(c.minimo);
          return { ...c, valor: v.times(def.factor), ...(m ? { minimo: m.times(def.factor) } : {}) };
        });
      } else {
        for (const k of ['comisionPct']) { const v = numero(p[k]); if (v && !v.eq(0)) { p[k] = v.times(def.factor); cambiados++; } }
        for (const k of ['comisionFija', 'costoTransferencia']) { const v = numero(p[k]?.monto); if (v && !v.eq(0)) { p[k] = { ...p[k], monto: v.times(def.factor) }; cambiados++; } }
      }
    }
    if (!cambiados) return { ok: false, motivo: 'No hay comisiones cargadas (con valor) para subir.' };
  } else if (def.tipo === 'liquidez') {
    let cambiados = 0;
    for (const p of pasos) {
      const l = numero(p.liquidez);
      if (l) { p.liquidez = l.times(def.factor); cambiados++; }
      if (Array.isArray(p.libro) && p.libro.length) {
        p.libro = p.libro.map((nv) => { const q = numero(nv.cantidad); return q ? { ...nv, cantidad: q.times(def.factor) } : nv; });
        cambiados++;
      }
    }
    if (!cambiados) return { ok: false, motivo: 'No cargaste liquidez ni libro de órdenes: no hay qué reducir.' };
  } else if (def.tipo === 'slippage') {
    let cambiados = 0;
    for (const p of pasos) {
      if ((p.tipo ?? 'cambio') === 'transferencia' || (Array.isArray(p.libro) && p.libro.length)) continue;
      p.slippagePct = (numero(p.slippagePct) ?? ZERO).plus(def.puntos);
      cambiados++;
    }
    if (!cambiados) return { ok: false, motivo: 'No hay pasos con precio al que sumarle slippage.' };
  } else if (def.tipo === 'retraso') {
    const r = numero(riesgoDiarioPct);
    if (!r) return { ok: false, motivo: 'DATOS INSUFICIENTES: cargá cuánto puede empeorar el precio de salida por día de espera. Brecha no lo inventa.' };
    if (!empeorarPaso(pasos[n - 1] ?? {}, r.times(def.horas).div(24))) return { ok: false, motivo: 'No hay una cotización cargada en el último paso.' };
  }
  return { ok: true, entrada: e };
}

/**
 * Corre la ruta original y cada escenario (o una combinación) sobre copias.
 * @param {object} entrada
 * @param {Array<keyof ESCENARIOS | Array<keyof ESCENARIOS>>} lista  un id, o un array de ids para combinarlos
 * @returns {{base: object, escenarios: Array<{id: string, texto: string, ok: boolean, motivo?: string, resultadoNeto?, roiPct?, diferencia?, diferenciaPct?, diferenciaRoiPts?, equilibrio?, violaciones?: number}>}}
 */
export function evaluarEscenarios(entrada, lista, opts = {}) {
  const motor = { ...(opts.motor ?? {}), objetivos: 'equilibrio' };
  const base = simularRuta(entrada, motor);
  const escenarios = lista.map((item) => {
    const ids = Array.isArray(item) ? item : [item];
    const texto = ids.map((i) => ESCENARIOS[i]?.texto ?? i).join(' + ');
    const id = ids.join('+');
    if (!base.ok || !base.result.mismoActivo) return { id, texto, ok: false, motivo: 'La simulación original no tiene resultado comparable.' };
    let e = entrada;
    for (const i of ids) {
      const a = aplicarEscenario(e, i, opts);
      if (!a.ok) return { id, texto, ok: false, motivo: a.motivo };
      e = a.entrada;
    }
    const s = simularRuta(e, motor);
    if (!s.ok) return { id, texto, ok: false, motivo: s.errors[0]?.message ?? 'No se puede calcular con ese escenario.' };
    const r = s.result;
    const b = base.result;
    const diferencia = r.resultadoNeto.minus(b.resultadoNeto);
    return {
      id, texto, ok: true,
      resultadoNeto: r.resultadoNeto, roiPct: r.roiPct, diferencia,
      diferenciaPct: b.resultadoNeto.eq(0) ? null : diferencia.div(b.resultadoNeto.abs()).times(HUNDRED),
      diferenciaRoiPts: r.roiPct.minus(b.roiPct),
      equilibrio: r.equilibrio?.precio ?? null,
      violaciones: r.pasos.reduce((a, p) => a + p.violaciones.length, 0),
      nivel: base.calidad.nivel, // un escenario no agrega datos: conserva la calidad de la simulación original
    };
  });
  return { base, escenarios };
}

/**
 * Sensibilidad al precio de salida (último paso): el resultado para precios entre −rango % y +rango %.
 * @returns {{ok: boolean, puntos: Array<{variacionPct: number, precio: *, ok: boolean, resultadoNeto?: *, roiPct?: *}>, actual?: *, equilibrio?: *}}
 */
export function sensibilidad(entrada, { rango = 10, paso = 2, motor = {} } = {}) {
  const base = simularRuta(entrada, { ...motor, objetivos: 'equilibrio' });
  if (!base.ok || !base.result.mismoActivo) return { ok: false, puntos: [] };
  const n = entrada.pasos.length - 1;
  const ultimo = base.result.pasos[n];
  if (ultimo.tipo === 'transferencia' || (Array.isArray(entrada.pasos[n].libro) && entrada.pasos[n].libro.length)) return { ok: false, puntos: [] };
  const P = ultimo.precio;
  const puntos = [];
  for (let v = -rango; v <= rango + 1e-9; v += paso) {
    const variacion = Math.round(v * 1000) / 1000;
    const precio = P.times(ONE.plus(pct(String(variacion))));
    const e = clonar(entrada);
    e.pasos[n].cotizacion = precio;
    const s = simularRuta(e, { ...motor, objetivos: false });
    puntos.push(s.ok ? { variacionPct: variacion, precio, ok: true, resultadoNeto: s.result.resultadoNeto, roiPct: s.result.roiPct } : { variacionPct: variacion, precio, ok: false });
  }
  return { ok: true, puntos, actual: P, equilibrio: base.result.equilibrio?.precio ?? null, base: ultimo.base, nivel: base.calidad.nivel };
}

export { plain };
