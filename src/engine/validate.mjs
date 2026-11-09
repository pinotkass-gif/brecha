// Validaciones de entrada del motor. Un error bloquea el cálculo; una advertencia no.
import { toDec, MAX_LARGO_NUMERO } from './decimal.mjs';

/**
 * Normaliza un valor de entrada. Vacío (null, undefined, '') → valor por defecto.
 * Un texto de más de MAX_LARGO_NUMERO caracteres se rechaza antes de calcular: con números gigantes
 * las cuentas exactas se vuelven lentísimas y congelarían la pantalla.
 * @returns {{value: import('./decimal.mjs').Dec|null, error?: string}}
 */
export function readValue(raw, defaultValue = null) {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { value: defaultValue === null ? null : toDec(defaultValue) };
  }
  if (typeof raw === 'string' && raw.trim().length > MAX_LARGO_NUMERO) return { value: null, error: 'demasiado_largo' };
  try {
    return { value: toDec(raw) };
  } catch (e) {
    return { value: null, error: e instanceof RangeError ? 'no_finito' : 'no_numerico' };
  }
}

/**
 * Valida un campo numérico y lo agrega al objeto de salida.
 * @param {object} ctx {errors, values}
 * @param {string} field nombre interno
 * @param {string} label nombre para mostrar
 * @param {*} raw valor crudo
 * @param {{required?: boolean, default?: *, min?: number|string, minExclusive?: boolean, max?: number|string, maxExclusive?: boolean}} rule
 */
export function checkField(ctx, field, label, raw, rule) {
  const { value, error } = readValue(raw, rule.required ? null : rule.default ?? null);
  if (error) {
    const motivo = error === 'demasiado_largo' ? `el número es demasiado largo (más de ${MAX_LARGO_NUMERO} caracteres)` : 'no es un número válido';
    ctx.errors.push({ field, code: error, message: `${label}: ${motivo}.` });
    return;
  }
  if (value === null) {
    if (rule.required) ctx.errors.push({ field, code: 'requerido', message: `${label}: falta el dato.` });
    ctx.values[field] = null;
    return;
  }
  if (rule.min !== undefined) {
    const min = toDec(rule.min);
    const bad = rule.minExclusive ? value.lte(min) : value.lt(min);
    if (bad) {
      const code = value.lt(0) ? 'negativo' : value.eq(0) ? 'cero' : 'fuera_de_rango';
      const cond = rule.minExclusive ? `mayor que ${rule.min}` : `mayor o igual a ${rule.min}`;
      ctx.errors.push({ field, code, message: `${label}: tiene que ser ${cond}.` });
    }
  }
  if (rule.max !== undefined) {
    const max = toDec(rule.max);
    const bad = rule.maxExclusive ? value.gte(max) : value.gt(max);
    if (bad) {
      const cond = rule.maxExclusive ? `menor que ${rule.max}` : `menor o igual a ${rule.max}`;
      ctx.errors.push({ field, code: 'fuera_de_rango', message: `${label}: tiene que ser ${cond}.` });
    }
  }
  ctx.values[field] = value;
}
