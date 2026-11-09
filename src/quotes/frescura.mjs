// Política de vencimiento: cuándo una cotización se considera antigua. Configurable por mercado.
// Oficial, blue, MEP y CCL cuentan horas hábiles (lunes a viernes, hora de Buenos Aires, SIN los feriados del
// calendario). Cripto cuenta horas corridas porque opera todos los días.
// Además se informa la antigüedad en horario de mercado (sólo las horas en que el mercado opera), para distinguir
// "vieja en un día hábil" de "último dato del viernes, el mercado está cerrado".
// Ojo: la fecha que informa la fuente es cuándo publicó el dato, no prueba de que haya habido operaciones.
import { IDS_MERCADOS } from './markets.mjs';
import { TOLERANCIA_FUTURO_MS } from './calidad.mjs';
import { msHabiles as msHabilesCal, mercadoAbierto, HORARIOS_DEFECTO } from './calendario.mjs';

export const POLITICA_FRESCURA_DEFECTO = {
  oficial: { horas: 26, horario: 'habil' },
  blue: { horas: 26, horario: 'habil' },
  mep: { horas: 26, horario: 'habil' },
  ccl: { horas: 26, horario: 'habil' },
  cripto: { horas: 3, horario: 'continuo' },
};
export const HORAS_MAXIMAS = 720;

/** Milisegundos hábiles (lunes a viernes, hora argentina, sin feriados) entre dos instantes. */
export function msHabiles(desde, hasta, cal = {}) {
  return msHabilesCal(desde, hasta, { cal });
}

/**
 * Estado de una cotización.
 * @param {object} m  mercado del store (src/quotes/store.mjs)
 * @param {string} id
 * @param {{ahora?: Date, politica?: object, cal?: {extra?: string[], quitar?: string[]}, horarios?: object}} [opts]
 * @returns {{estado: 'actualizada'|'antigua'|'manual'|'no_disponible', antigua: boolean, edadMs: number|null,
 *   edadHoras: number|null, edadMercadoMs: number|null, mercadoAbierto: boolean, umbralHoras: number,
 *   horario: 'habil'|'continuo', motivo: string|null}}
 */
export function clasificar(m, id, { ahora = new Date(), politica = POLITICA_FRESCURA_DEFECTO, cal = {}, horarios = HORARIOS_DEFECTO } = {}) {
  const regla = politica[id] ?? POLITICA_FRESCURA_DEFECTO[id] ?? { horas: 24, horario: 'continuo' };
  const horarioMercado = horarios?.[id] ?? null;
  const abierto = mercadoAbierto(ahora.getTime(), horarioMercado, cal);
  const base = { umbralHoras: regla.horas, horario: regla.horario, edadMs: null, edadHoras: null, edadMercadoMs: null, mercadoAbierto: abierto, antigua: false, motivo: null };
  const sinPrecios = !m || (!m.compra && !m.venta);
  if (sinPrecios || (m.origen !== 'manual' && m.valido === false) || m.origen === 'ninguno') {
    return { ...base, estado: 'no_disponible', motivo: sinPrecios ? 'sin_precios' : 'dato_invalido' };
  }
  const ref = m.origen === 'manual' ? m.editadoAt : m.fechaFuente;
  const t = Date.parse(ref ?? '');
  if (Number.isNaN(t)) {
    return { ...base, estado: m.origen === 'manual' ? 'manual' : 'antigua', antigua: true, motivo: 'sin_fecha' };
  }
  // Fecha del futuro (reloj de la fuente o de la compu mal): no se sabe de cuándo es, se trata como antigua.
  if (t - ahora.getTime() > TOLERANCIA_FUTURO_MS) {
    return { ...base, estado: m.origen === 'manual' ? 'manual' : 'antigua', antigua: true, motivo: 'fecha_futura' };
  }
  const edadMs = Math.max(0, ahora.getTime() - t);
  const edadCuentaMs = regla.horario === 'habil' ? msHabiles(t, ahora.getTime(), cal) : edadMs;
  const edadMercadoMs = horarioMercado ? msHabilesCal(t, ahora.getTime(), { cal, horario: horarioMercado }) : edadMs;
  const edadHoras = edadCuentaMs / 3600e3;
  const antigua = edadHoras > regla.horas;
  const estado = m.origen === 'manual' ? 'manual' : antigua ? 'antigua' : 'actualizada';
  return { ...base, estado, antigua, edadMs, edadHoras, edadMercadoMs, motivo: antigua ? 'vencida' : null };
}

/** Valida una política guardada; lo que no sirve vuelve al valor por defecto. */
export function restaurarPolitica(g) {
  const out = structuredClone(POLITICA_FRESCURA_DEFECTO);
  if (!g || typeof g !== 'object') return out;
  for (const id of IDS_MERCADOS) {
    const h = Number(g[id]?.horas);
    if (Number.isFinite(h) && h > 0 && h <= HORAS_MAXIMAS) out[id].horas = h;
  }
  return out;
}
