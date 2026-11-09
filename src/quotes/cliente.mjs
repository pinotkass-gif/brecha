// Cuándo y cómo consultar un proveedor: copia local, espera mínima entre consultas, reintentos con
// espera creciente ante errores transitorios y respeto del "esperá" (429 / Retry-After).
// No hay refresco automático periódico: se consulta al abrir (si la copia es vieja) o con el botón.

/** Tope de la espera que puede pedir un proveedor (429 / Retry-After). Más que esto es un error del servidor. */
export const MAX_ESPERA_PEDIDA_MS = 3600e3;

export const POLITICA_CONSULTA = {
  /** Al abrir la app no se consulta si el último dato bueno tiene menos de esto. */
  copiaLocalMinutos: 15,
  /** Espera mínima entre una consulta y la siguiente pedida con el botón. */
  esperaManualSegundos: 60,
  /** Reintentos ante errores de red, timeout o 5xx (no ante 4xx ni formato). */
  reintentos: 2,
  esperasMs: [1000, 3000],
  timeoutMs: 10000,
};

/**
 * ¿Corresponde consultar ahora?
 * @param {object|null} ultima  estado.ultimaConsulta del store
 * @param {{ahora?: Date, motivo?: 'auto'|'manual', politica?: typeof POLITICA_CONSULTA}} [opts]
 * @returns {{permitido: true} | {permitido: false, motivo: 'pedido_de_espera'|'copia_local'|'espera_manual', esperarMs: number}}
 */
export function puedeConsultar(ultima, { ahora = new Date(), motivo = 'auto', politica = POLITICA_CONSULTA } = {}) {
  const t = ahora.getTime();
  const ms = (iso) => {
    const v = Date.parse(iso ?? '');
    return Number.isNaN(v) ? null : v;
  };
  const espera = ms(ultima?.reintentarDespues);
  // Una espera guardada más larga que el tope es un dato roto: no puede bloquear el botón para siempre.
  if (espera !== null && espera > t && espera - t <= MAX_ESPERA_PEDIDA_MS) return { permitido: false, motivo: 'pedido_de_espera', esperarMs: espera - t };
  if (motivo === 'auto') {
    const exito = ms(ultima?.ultimoExitoAt);
    const limite = politica.copiaLocalMinutos * 60e3;
    if (exito !== null && t - exito >= 0 && t - exito < limite) return { permitido: false, motivo: 'copia_local', esperarMs: limite - (t - exito) };
  } else {
    const at = ms(ultima?.at);
    const limite = politica.esperaManualSegundos * 1e3;
    if (at !== null && t - at >= 0 && t - at < limite) return { permitido: false, motivo: 'espera_manual', esperarMs: limite - (t - at) };
  }
  return { permitido: true };
}

/**
 * Consulta un proveedor reintentando sólo errores transitorios.
 * @param {import('./providers/index.mjs').ProveedorCotizaciones} proveedor
 * @param {{fetchImpl?: typeof fetch, ahora?: () => Date, dormir?: (ms: number) => Promise<void>, politica?: typeof POLITICA_CONSULTA}} [opts]
 */
export async function consultarConReintentos(proveedor, {
  fetchImpl, ahora = () => new Date(), dormir = (ms) => new Promise((r) => setTimeout(r, ms)), politica = POLITICA_CONSULTA,
} = {}) {
  let resp;
  let intentos = 0;
  for (let k = 0; k <= politica.reintentos; k++) {
    intentos++;
    try {
      resp = await proveedor.obtener({ fetchImpl, timeoutMs: politica.timeoutMs, ahora });
    } catch {
      // Un error inesperado se informa como falla: nunca deja la consulta (ni el botón) colgada.
      resp = { ok: false, fetchedAt: ahora().toISOString(), error: { tipo: 'interno', reintentable: false, mensaje: `Error inesperado al leer ${proveedor.nombre ?? 'el proveedor'}.` } };
    }
    if (resp.ok || !resp.error?.reintentable) break;
    if (k < politica.reintentos) await dormir(politica.esperasMs[k] ?? politica.esperasMs[politica.esperasMs.length - 1]);
  }
  return { ...resp, intentos, proveedor: proveedor.id };
}
