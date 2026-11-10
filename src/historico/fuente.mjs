// Histórico diario de los dólares: ArgentinaDatos (https://api.argentinadatos.com), del mismo autor que DolarAPI.
// Se baja un mercado sólo cuando una pregunta lo necesita, se valida dato por dato y se guarda una copia local.
// La copia se renueva como mucho cada 6 horas (los datos son de cierre diario): nunca hay consultas en bucle.
import { MERCADOS_HIST } from './preguntas.mjs';

export const URL_HISTORICO = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/';
export const RENOVAR_HORAS = 6;
const KEY = (id) => `brecha.historico.v1.${id}`;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PRECIO = 1e9;

/**
 * Valida la respuesta de ArgentinaDatos: sólo filas con fecha válida y precios positivos y razonables, ordenadas y sin repetir.
 * @returns {{ok: true, filas: Array<{fecha: string, compra: number, venta: number}>, descartadas: number} | {ok: false, error: string}}
 */
export function validarHistorico(json) {
  if (!Array.isArray(json)) return { ok: false, error: 'La fuente no devolvió una lista.' };
  const porFecha = new Map();
  let descartadas = 0;
  for (const x of json) {
    const ok = x && typeof x === 'object' && typeof x.fecha === 'string' && FECHA.test(x.fecha) && !Number.isNaN(Date.parse(x.fecha))
      && [x.compra, x.venta].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_PRECIO);
    if (!ok) { descartadas++; continue; }
    porFecha.set(x.fecha, { fecha: x.fecha, compra: x.compra, venta: x.venta });
  }
  const filas = [...porFecha.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  if (!filas.length) return { ok: false, error: 'La fuente no trajo datos válidos.' };
  return { ok: true, filas, descartadas };
}

/** Copia guardada: [[fecha, compra, venta], ...] para que ocupe poco. */
function leerCopia(storage, id) {
  const g = storage.get(KEY(id));
  if (!g || typeof g !== 'object' || typeof g.at !== 'string' || !Array.isArray(g.filas)) return null;
  const v = validarHistorico(g.filas.map((f) => (Array.isArray(f) ? { fecha: f[0], compra: f[1], venta: f[2] } : null)));
  return v.ok ? { at: g.at, filas: v.filas } : null;
}
function guardarCopia(storage, id, filas, at) {
  return storage.trySet(KEY(id), { at, filas: filas.map((f) => [f.fecha, f.compra, f.venta]) });
}

/**
 * Crea el cargador del histórico (con memoria de la sesión).
 * @param {{fetch?: typeof fetch, storage: {get: Function, trySet: Function}, ahora?: () => Date}} deps
 */
export function crearFuenteHistorico({ fetch: f = globalThis.fetch?.bind(globalThis), storage, ahora = () => new Date() }) {
  const memoria = new Map();
  /**
   * @param {string} id mercado (oficial, blue, mep, ccl, cripto, mayorista, tarjeta)
   * @returns {Promise<{ok: true, filas: Array, at: string, origen: 'red'|'copia', aviso?: string} | {ok: false, error: string}>}
   */
  async function cargar(id) {
    const def = MERCADOS_HIST[id];
    if (!def) return { ok: false, error: `Mercado desconocido: ${id}.` };
    const t = ahora();
    const fresca = (at) => t.getTime() - Date.parse(at) < RENOVAR_HORAS * 3600e3;
    if (memoria.has(id) && fresca(memoria.get(id).at)) return { ok: true, ...memoria.get(id), origen: 'copia' };
    const copia = leerCopia(storage, id);
    if (copia && fresca(copia.at)) { memoria.set(id, copia); return { ok: true, ...copia, origen: 'copia' }; }
    try {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
      const r = await f(`${URL_HISTORICO}${def.casa}`, { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error(`la fuente respondió ${r.status}`);
      const v = validarHistorico(await r.json());
      if (!v.ok) throw new Error(v.error);
      const dato = { at: t.toISOString(), filas: v.filas };
      memoria.set(id, dato);
      guardarCopia(storage, id, v.filas, dato.at); // si el navegador no tiene lugar, queda sólo en memoria
      return { ok: true, ...dato, origen: 'red' };
    } catch (e) {
      if (copia) {
        memoria.set(id, copia);
        return { ok: true, ...copia, origen: 'copia', aviso: `No pude actualizar el histórico de ${def.nombre} (${e?.message ?? 'sin conexión'}): uso la copia guardada el ${copia.at.slice(8, 10)}/${copia.at.slice(5, 7)}.` };
      }
      return { ok: false, error: `No pude traer el histórico de ${def.nombre} (${e?.name === 'AbortError' ? 'la fuente no respondió' : e?.message ?? 'sin conexión'}). Probá de nuevo en un rato.` };
    }
  }
  return { cargar };
}
