// Capa de proveedores de cotizaciones. Para sumar una fuente nueva: un archivo que exporte un objeto
// con esta forma y agregarlo a PROVEEDORES. El motor financiero no cambia.
import { proveedorDolarAPI } from './dolarapi.mjs';

/**
 * @typedef {object} CotizacionFuente
 * @property {string|null} compra   ARS que te pagan por unidad (bid), texto exacto; null si la fuente no lo informa
 * @property {string|null} venta    ARS que pagás por unidad (ask), texto exacto
 * @property {string|null} fechaFuente  ISO: cuándo la fuente publicó el dato (no prueba que haya habido operaciones)
 * @property {string} fuente        nombre del proveedor
 * @property {string|null} fuenteOriginal  de dónde lo toma el proveedor (para citarlo)
 * @property {boolean} valido
 * @property {string[]} problemas   códigos de src/quotes/calidad.mjs
 *
 * @typedef {{ok: true, fetchedAt: string, cotizaciones: Record<string, CotizacionFuente>, faltantes: string[]}
 *   | {ok: false, fetchedAt: string, error: {tipo: 'timeout'|'red'|'http'|'formato', status?: number,
 *       reintentable: boolean, reintentarDespuesMs?: number, mensaje: string}}} RespuestaProveedor
 *
 * @typedef {object} ProveedorCotizaciones
 * @property {string} id
 * @property {string} nombre
 * @property {string} documentacion
 * @property {string[]} mercados  ids de src/quotes/markets.mjs que cubre
 * @property {Record<string, string>} fuentesOriginales
 * @property {(opts: {fetchImpl?: typeof fetch, timeoutMs?: number, ahora?: () => Date}) => Promise<RespuestaProveedor>} obtener
 */

export const PROVEEDORES = [proveedorDolarAPI];
export const proveedorPorDefecto = proveedorDolarAPI;
export const proveedorPorId = (id) => PROVEEDORES.find((p) => p.id === id) ?? null;

/** Verifica que un objeto cumpla la forma de proveedor. Devuelve la lista de faltantes. */
export function validarProveedor(p) {
  const faltan = [];
  if (!p || typeof p !== 'object') return ['proveedor'];
  for (const k of ['id', 'nombre', 'documentacion']) if (typeof p[k] !== 'string' || !p[k]) faltan.push(k);
  if (!Array.isArray(p.mercados) || !p.mercados.length) faltan.push('mercados');
  if (typeof p.obtener !== 'function') faltan.push('obtener');
  return faltan;
}
