// Orden de escenarios. Reglas:
// - Ninguna simulación se presenta como "oportunidad ejecutable".
// - Los escenarios se separan por calidad: confirmados por vos · datos completos · hipotéticos (estimados) ·
//   incompletos (cota máxima) · datos insuficientes (sin resultado). Un grupo nunca se mezcla con otro.
// - Dentro de cada grupo: primero el estado de confirmación (condicionada antes que teórica) y recién después
//   el criterio elegido.

export const CRITERIOS = {
  roi: 'Mayor rentabilidad neta',
  ganancia: 'Mayor ganancia absoluta',
  costo: 'Menor costo operativo',
  tiempo: 'Menor tiempo',
  completitud: 'Mayor completitud de datos',
  margen: 'Mayor margen de seguridad',
  pasos: 'Menor cantidad de pasos',
};

export const GRUPOS = {
  confirmadas: 'Rutas confirmadas por vos',
  completas: 'Datos completos',
  estimadas: 'Hipotéticos (usan supuestos tuyos)',
  incompletas: 'Incompletos (faltan costos: cota máxima)',
  insuficientes: 'Datos insuficientes (sin resultado)',
};

const RANGO_ESTADO = { verificada: 0, condicionada: 1, teorica: 2 };

/** Grupo de un escenario según su estado de confirmación y la calidad de sus datos. */
export function grupoDe(i) {
  if (i.nivel === 'insuficiente' || i.roiPct === null || i.roiPct === undefined) return 'insuficientes';
  if (i.estado === 'verificada' && (i.nivel ?? 'completo') === 'completo' && !i.parcial?.length) return 'confirmadas';
  if (i.nivel === 'incompleto' || (i.parcial?.length && !i.nivel)) return 'incompletas';
  if (i.nivel === 'estimado') return 'estimadas';
  return 'completas';
}

/** Compara dos Dec que pueden faltar (lo que falta va al final). */
const cmpNulos = (a, b, f) => (a === null || a === undefined ? (b === null || b === undefined ? 0 : 1) : b === null || b === undefined ? -1 : f(a, b));

/**
 * @param {Array<{id: string, estado: string, nivel?: string, parcial?: string[], pasos: number, roiPct: *, resultadoNeto: *, costoPct: *,
 *   tiempoHoras?: *, faltantes?: number, margenSeguridadPct?: *}>} items  (Dec del motor)
 * @param {keyof CRITERIOS} criterio
 * @returns {Record<keyof GRUPOS, Array> & {verificadas: Array, sinVerificar: Array}}
 */
export function ordenarOportunidades(items, criterio = 'roi') {
  const comparar = {
    roi: (a, b) => cmpNulos(a.roiPct, b.roiPct, (x, y) => y.cmp(x)),
    ganancia: (a, b) => cmpNulos(a.resultadoNeto, b.resultadoNeto, (x, y) => y.cmp(x)),
    costo: (a, b) => cmpNulos(a.costoPct, b.costoPct, (x, y) => x.cmp(y)),
    tiempo: (a, b) => cmpNulos(a.tiempoHoras, b.tiempoHoras, (x, y) => x.cmp(y)) || cmpNulos(a.roiPct, b.roiPct, (x, y) => y.cmp(x)),
    completitud: (a, b) => (a.faltantes ?? a.parcial?.length ?? 0) - (b.faltantes ?? b.parcial?.length ?? 0) || cmpNulos(a.roiPct, b.roiPct, (x, y) => y.cmp(x)),
    margen: (a, b) => cmpNulos(a.margenSeguridadPct, b.margenSeguridadPct, (x, y) => y.cmp(x)),
    pasos: (a, b) => a.pasos - b.pasos || cmpNulos(a.roiPct, b.roiPct, (x, y) => y.cmp(x)),
  }[criterio];
  if (!comparar) throw new Error(`Criterio desconocido: ${criterio}`);
  const rango = (i) => RANGO_ESTADO[i.estado] ?? 3;
  const grupos = Object.fromEntries(Object.keys(GRUPOS).map((g) => [g, []]));
  for (const i of items) grupos[grupoDe(i)].push(i);
  for (const [g, lista] of Object.entries(grupos)) {
    if (g === 'insuficientes') lista.sort((a, b) => String(a.titulo ?? a.id).localeCompare(String(b.titulo ?? b.id)));
    else lista.sort((a, b) => rango(a) - rango(b) || comparar(a, b) || a.id.localeCompare(b.id));
  }
  return {
    ...grupos,
    verificadas: grupos.confirmadas,
    sinVerificar: [...grupos.completas, ...grupos.estimadas, ...grupos.incompletas],
  };
}
