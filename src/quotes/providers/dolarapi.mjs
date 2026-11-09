// Proveedor DolarAPI (https://dolarapi.com/docs/argentina/), GET /v1/dolares.
// Son cotizaciones de REFERENCIA, no precios garantizados de ejecución.
// Según su OpenAPI (v1.1.0) "compra" puede faltar; "venta", "casa", "moneda" y "fechaActualizacion" son obligatorios.
// Uso de los datos: no hay límite numérico, pero piden guardar una copia local, no consultar en bucle
// y citar el servicio y la fuente original (https://dolarapi.com/docs/uso).
import { MERCADOS } from '../markets.mjs';
import { esValido, UMBRAL_SPREAD_PCT, PRECIO_MINIMO, PRECIO_MAXIMO, TOLERANCIA_FUTURO_MS } from '../calidad.mjs';
import { MAX_ESPERA_PEDIDA_MS } from '../cliente.mjs';

const URL_DOLARES = 'https://dolarapi.com/v1/dolares';

/** Fuente original de cada serie, según el OpenAPI de DolarAPI (x-data-source). */
const FUENTES_ORIGINALES = {
  oficial: 'Ámbito Financiero',
  blue: 'DolarHoy',
  mep: 'DolarHoy',
  ccl: 'DolarHoy',
  cripto: 'DolarHoy',
};

/** @type {import('./index.mjs').ProveedorCotizaciones} */
export const proveedorDolarAPI = {
  id: 'dolarapi',
  nombre: 'DolarAPI',
  documentacion: 'https://dolarapi.com/docs/argentina/',
  mercados: MERCADOS.map((m) => m.id),
  fuentesOriginales: FUENTES_ORIGINALES,
  obtener: (opts) => obtenerCotizacionesDolarAPI(opts),
};

/**
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, ahora?: () => Date, url?: string}} [opts]
 * @returns {Promise<import('./index.mjs').RespuestaProveedor>}
 */
export async function obtenerCotizacionesDolarAPI({ fetchImpl = globalThis.fetch, timeoutMs = 10000, ahora = () => new Date(), url = URL_DOLARES } = {}) {
  const fetchedAt = ahora().toISOString();
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(Object.assign(new Error('timeout'), { esTimeout: true }));
    }, timeoutMs);
  });

  let res;
  try {
    res = await Promise.race([fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }), timeout]);
  } catch (e) {
    clearTimeout(timer);
    if (e?.esTimeout || e?.name === 'AbortError') {
      return falla(fetchedAt, { tipo: 'timeout', reintentable: true, mensaje: `DolarAPI no respondió en ${Math.round(timeoutMs / 1000)} s.` });
    }
    return falla(fetchedAt, { tipo: 'red', reintentable: true, mensaje: 'No hay conexión con DolarAPI.' });
  }
  clearTimeout(timer);

  if (!res.ok) {
    if (res.status === 429) {
      const espera = retryAfterMs(res.headers?.get?.('Retry-After'), ahora()) ?? 60000;
      return falla(fetchedAt, {
        tipo: 'http', status: 429, reintentable: false, reintentarDespuesMs: espera,
        mensaje: `DolarAPI recibió demasiadas consultas (429) y pidió esperar ${Math.ceil(espera / 1000)} s.`,
      });
    }
    const reintentable = res.status >= 500 || res.status === 408;
    return falla(fetchedAt, { tipo: 'http', status: res.status, reintentable, mensaje: `DolarAPI respondió con error ${res.status}.` });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return falla(fetchedAt, { tipo: 'formato', reintentable: false, mensaje: 'DolarAPI devolvió una respuesta que no es JSON.' });
  }
  return interpretarRespuesta(data, fetchedAt);
}

function falla(fetchedAt, error) {
  return { ok: false, fetchedAt, error };
}

/** Retry-After puede venir en segundos o como fecha HTTP. */
export function retryAfterMs(valor, ahora = new Date()) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const s = String(valor).trim();
  // Se respeta, pero con tope: un pedido de esperar días o años es un error del servidor, no una pausa.
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, MAX_ESPERA_PEDIDA_MS);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.min(Math.max(0, t - ahora.getTime()), MAX_ESPERA_PEDIDA_MS);
}

/**
 * Valida y normaliza el JSON de /v1/dolares. Separado para testearlo sin red.
 * @returns {import('./index.mjs').RespuestaProveedor}
 */
export function interpretarRespuesta(data, fetchedAt) {
  if (!Array.isArray(data)) {
    return falla(fetchedAt, { tipo: 'formato', reintentable: false, mensaje: 'DolarAPI devolvió un formato inesperado.' });
  }
  const cotizaciones = {};
  const faltantes = [];
  for (const m of MERCADOS) {
    const item = data.find((x) => x && x.casa === m.casa);
    if (!item) {
      faltantes.push(m.id);
      continue;
    }
    const problemas = [];
    const ausente = (x) => x === null || x === undefined;
    let compra = precioValido(item.compra);
    let venta = precioValido(item.venta);
    if (ausente(item.compra)) problemas.push('compra_ausente');
    else if (compra === null) problemas.push('compra_invalida');
    if (ausente(item.venta)) problemas.push('venta_ausente');
    else if (venta === null) problemas.push('venta_invalida');
    // Un precio casi cero o astronómico es un dato roto: no se usa ni se muestra.
    const fueraDeRango = (x) => x !== null && (Number(x) < PRECIO_MINIMO || Number(x) > PRECIO_MAXIMO);
    if (fueraDeRango(compra) || fueraDeRango(venta)) {
      problemas.push('precio_fuera_de_rango');
      if (fueraDeRango(compra)) compra = null;
      if (fueraDeRango(venta)) venta = null;
    }
    if (item.moneda !== undefined && item.moneda !== 'USD') problemas.push('moneda_inesperada');
    if (compra !== null && venta !== null) {
      if (Number(venta) < Number(compra)) problemas.push('puntas_invertidas');
      else if ((Number(venta) / Number(compra) - 1) * 100 > UMBRAL_SPREAD_PCT) problemas.push('spread_inusual');
    }
    let fechaFuente = null;
    if (typeof item.fechaActualizacion === 'string' && item.fechaActualizacion.length <= 40 && !Number.isNaN(Date.parse(item.fechaActualizacion))) {
      fechaFuente = new Date(item.fechaActualizacion).toISOString();
      if (Date.parse(fechaFuente) - Date.parse(fetchedAt) > TOLERANCIA_FUTURO_MS) problemas.push('fecha_futura');
    } else {
      problemas.push('fecha_invalida');
    }
    cotizaciones[m.id] = {
      compra,
      venta,
      fechaFuente,
      fuente: proveedorDolarAPI.nombre,
      fuenteOriginal: FUENTES_ORIGINALES[m.id] ?? null,
      valido: esValido(problemas),
      problemas,
    };
  }
  if (Object.keys(cotizaciones).length === 0) {
    return falla(fetchedAt, { tipo: 'formato', reintentable: false, mensaje: 'DolarAPI no devolvió ninguno de los mercados esperados.' });
  }
  return { ok: true, fetchedAt, cotizaciones, faltantes };
}

/** Precio como texto exacto si es un número finito > 0; si no, null. */
function precioValido(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return String(x);
  if (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x.trim()) && Number(x) > 0) return x.trim();
  return null;
}
