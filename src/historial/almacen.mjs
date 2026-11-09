// Guardado del historial en el navegador (localStorage). Sin servidor, sin usuarios.
import { restaurarRegistro, MAX_SIMULACIONES } from './modelo.mjs';

export const KEY_HISTORIAL = 'brecha.historial.v1';

/**
 * @param {{get: (k: string) => any}} storage
 * @returns {import('./modelo.mjs').Simulacion[]}
 */
export function cargarHistorial(storage) {
  const g = storage.get(KEY_HISTORIAL);
  if (!Array.isArray(g)) return [];
  return g.map(restaurarRegistro).filter(Boolean).slice(0, MAX_SIMULACIONES);
}

/**
 * @param {{trySet: (k: string, v: any) => boolean}} storage
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function guardarHistorial(storage, lista) {
  if (lista.length > MAX_SIMULACIONES) return { ok: false, error: `El historial admite hasta ${MAX_SIMULACIONES} simulaciones: exportalo y borrá algunas.` };
  return storage.trySet(KEY_HISTORIAL, lista)
    ? { ok: true }
    : { ok: false, error: 'No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado. Exportá el historial y borrá algunas simulaciones.' };
}
