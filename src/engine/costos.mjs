// Estado de cada costo y su tratamiento fiscal. Regla: un costo que no conocés NUNCA vale 0 en silencio.
//   desconocido → el resultado se calcula con 0 pero queda INCOMPLETO y se muestra como cota máxima.
//   no_aplica   → ese costo no existe en esta operación (vale 0, conocido).
//   cero        → existe y es 0 (confirmado).
//   valor       → tiene un costo determinado.
import { toDec, MAX_LARGO_NUMERO, ZERO } from './decimal.mjs';

/** Valor que el usuario marcó como "no aplica" (en el motor y en los formularios). */
export const NO_APLICA = '__no_aplica__';
const TEXTO_NO_APLICA = /^\s*(no\s*aplica|n\s*\/\s*a)\s*$/i;

/** ¿El texto escrito significa "no aplica"? */
export const esNoAplica = (raw) => raw === NO_APLICA || (typeof raw === 'string' && TEXTO_NO_APLICA.test(raw));

export const ESTADOS_COSTO = {
  desconocido: 'No sé',
  no_aplica: 'No aplica',
  cero: 'Confirmado en 0',
  valor: 'Tiene un costo',
};

/** Tratamiento fiscal/económico de un concepto. No se asume que un impuesto sea costo definitivo. */
export const TRATAMIENTOS = {
  costo: 'Costo definitivo',
  percepcion: 'Percepción recuperable',
  retencion: 'Retención',
  pago_a_cuenta: 'Pago a cuenta',
  pendiente: 'Pendiente de determinar',
  no_fiscal: 'No es un concepto fiscal',
};
/** Se pueden recuperar (computar contra impuestos): suman en el resultado económico. */
export const RECUPERABLES = ['percepcion', 'retencion', 'pago_a_cuenta'];
export const esRecuperable = (t) => RECUPERABLES.includes(t);

/**
 * Lee un costo. Vacío = desconocido (NO es cero).
 * @returns {{estado: 'desconocido'|'no_aplica'|'cero'|'valor', valor: import('./decimal.mjs').Dec, error?: string}}
 *   valor es 0 cuando no se conoce o no aplica (para poder calcular la cota máxima).
 */
export function leerCosto(raw) {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { estado: 'desconocido', valor: ZERO };
  if (esNoAplica(raw)) return { estado: 'no_aplica', valor: ZERO };
  if (typeof raw === 'string' && raw.trim().length > MAX_LARGO_NUMERO) return { estado: 'valor', valor: ZERO, error: 'demasiado_largo' };
  try {
    const v = toDec(raw);
    return { estado: v.eq(0) ? 'cero' : 'valor', valor: v };
  } catch (e) {
    return { estado: 'valor', valor: ZERO, error: e instanceof RangeError ? 'no_finito' : 'no_numerico' };
  }
}

/**
 * Valida un costo y lo agrega a ctx.values (Dec, 0 si no se conoce) y ctx.estados.
 * @param {{errors: Array, values: object, estados?: object}} ctx
 * @param {{min?: number|string, max?: number|string, maxExclusive?: boolean}} rule
 */
export function checkCosto(ctx, field, label, raw, rule = {}) {
  ctx.estados ??= {};
  const r = leerCosto(raw);
  ctx.estados[field] = r.estado;
  if (r.error) {
    const motivo = r.error === 'demasiado_largo' ? `el número es demasiado largo (más de ${MAX_LARGO_NUMERO} caracteres)` : 'no es un número válido';
    ctx.errors.push({ field, code: r.error, message: `${label}: ${motivo}.` });
    ctx.values[field] = ZERO;
    return r;
  }
  const v = r.valor;
  const min = toDec(rule.min ?? 0);
  if (v.lt(min)) ctx.errors.push({ field, code: v.lt(0) ? 'negativo' : 'fuera_de_rango', message: `${label}: tiene que ser mayor o igual a ${rule.min ?? 0}.` });
  if (rule.max !== undefined) {
    const max = toDec(rule.max);
    if (rule.maxExclusive ? v.gte(max) : v.gt(max)) {
      ctx.errors.push({ field, code: 'fuera_de_rango', message: `${label}: tiene que ser ${rule.maxExclusive ? 'menor que' : 'menor o igual a'} ${rule.max}.` });
    }
  }
  ctx.values[field] = v;
  return r;
}

/** Nivel de calidad de un resultado, del peor al mejor. */
export const NIVELES = ['insuficiente', 'incompleto', 'estimado', 'completo'];
export const ETIQUETAS_NIVEL = {
  insuficiente: 'DATOS INSUFICIENTES',
  incompleto: 'INCOMPLETO: faltan costos',
  estimado: 'ESTIMADO: usa hipótesis',
  completo: 'Datos completos',
};

/** Calidad a partir de lo que falta y de las hipótesis declaradas. */
export function calidadDe({ insuficientes = [], desconocidos = [], hipotesis = [] }) {
  const nivel = insuficientes.length ? 'insuficiente' : desconocidos.length ? 'incompleto' : hipotesis.length ? 'estimado' : 'completo';
  return { nivel, insuficientes, desconocidos, hipotesis };
}
