// Capturas históricas de cotizaciones: una foto de los 5 mercados que guardás vos (con un botón, o cada vez que
// actualizás si lo activaste). Nunca se consulta en bucle: no hay capturas automáticas por tiempo.
// Todo queda en este navegador; se puede exportar e importar.
import { IDS_MERCADOS } from '../quotes/markets.mjs';

export const MAX_CAPTURAS = 1000;
export const FORMATO_CAPTURAS = 'brecha-capturas';
const NUM = /^\d+(\.\d+)?$/;
const precio = (x) => (typeof x === 'string' && x.length <= 40 && NUM.test(x) && Number(x) > 0 ? x : null);
const fecha = (x) => (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? x : null);

/** Foto de las cotizaciones del store. */
export function crearCaptura(mercados, { ahora = new Date(), motivo = 'manual' } = {}) {
  const out = {};
  for (const id of IDS_MERCADOS) {
    const m = mercados?.[id];
    if (!m) continue;
    out[id] = { compra: precio(m.compra), venta: precio(m.venta), fecha: fecha(m.origen === 'manual' ? m.editadoAt : m.fechaFuente), tipo: m.origen === 'manual' ? 'manual' : 'api', valido: m.valido !== false };
  }
  return { at: ahora.toISOString(), motivo: motivo === 'actualizacion' ? 'actualizacion' : 'manual', mercados: out };
}

/** Valida capturas guardadas o importadas; quedan ordenadas por fecha y sin repetidas. */
export function restaurarCapturas(g) {
  if (!Array.isArray(g)) return [];
  const vistas = new Set();
  const out = [];
  for (const c of g) {
    if (!c || typeof c !== 'object' || !fecha(c.at) || vistas.has(c.at)) continue;
    const mercados = {};
    for (const id of IDS_MERCADOS) {
      const m = c.mercados?.[id];
      if (!m || typeof m !== 'object') continue;
      mercados[id] = { compra: precio(m.compra), venta: precio(m.venta), fecha: fecha(m.fecha), tipo: m.tipo === 'manual' ? 'manual' : 'api', valido: m.valido !== false };
    }
    vistas.add(c.at);
    out.push({ at: c.at, motivo: c.motivo === 'actualizacion' ? 'actualizacion' : 'manual', mercados });
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out.slice(-MAX_CAPTURAS);
}

/** Agrega una captura si cambió algo respecto de la última (precios o fechas). */
export function agregarCaptura(lista, captura) {
  const ultima = lista.at(-1);
  const clave = (c) => JSON.stringify(IDS_MERCADOS.map((id) => [c.mercados[id]?.compra, c.mercados[id]?.venta, c.mercados[id]?.fecha]));
  if (ultima && clave(ultima) === clave(captura)) return { lista, agregada: false };
  return { lista: [...lista, captura].slice(-MAX_CAPTURAS), agregada: true };
}

/** Serie de un mercado: venta, compra o brecha contra el oficial (venta / venta oficial − 1, en %). */
export function serie(lista, id, que = 'venta') {
  const out = [];
  for (const c of lista) {
    const m = c.mercados[id];
    if (!m || !m.valido) continue;
    let v = null;
    if (que === 'venta' || que === 'compra') v = m[que] ? Number(m[que]) : null;
    else if (que === 'brecha') {
      const o = c.mercados.oficial;
      if (m.venta && o?.venta && o.valido) v = (Number(m.venta) / Number(o.venta) - 1) * 100;
    }
    if (v !== null && Number.isFinite(v)) out.push({ at: c.at, valor: v });
  }
  return out;
}

/** Diferencia entre dos mercados en cada captura (venta de A / venta de B − 1, en %). */
export function diferencia(lista, a, b) {
  const out = [];
  for (const c of lista) {
    const x = c.mercados[a];
    const y = c.mercados[b];
    if (x?.valido && y?.valido && x.venta && y.venta) out.push({ at: c.at, valor: (Number(x.venta) / Number(y.venta) - 1) * 100 });
  }
  return out;
}

/** Máximo, mínimo, primero, último y variación de una serie. */
export function estadisticas(puntos) {
  if (!puntos.length) return null;
  let min = puntos[0];
  let max = puntos[0];
  for (const p of puntos) {
    if (p.valor < min.valor) min = p;
    if (p.valor > max.valor) max = p;
  }
  const primero = puntos[0];
  const ultimo = puntos.at(-1);
  return { n: puntos.length, min, max, primero, ultimo, variacionPct: primero.valor ? (ultimo.valor / primero.valor - 1) * 100 : null };
}

export function exportarCapturas(lista, ahora = new Date()) {
  return JSON.stringify({ formato: FORMATO_CAPTURAS, version: 1, exportadoAt: ahora.toISOString(), capturas: lista }, null, 2);
}

/** Importa y une con las que ya hay (por fecha). */
export function importarCapturas(texto, existentes = []) {
  if (typeof texto !== 'string' || texto.length > 5 * 1024 * 1024) return { ok: false, error: 'El archivo es demasiado grande o no se pudo leer.' };
  let d;
  try { d = JSON.parse(texto); } catch { return { ok: false, error: 'El archivo no es un JSON válido.' }; }
  if (!d || d.formato !== FORMATO_CAPTURAS || !Array.isArray(d.capturas)) return { ok: false, error: 'No es un archivo de capturas de Brecha.' };
  const nuevas = restaurarCapturas(d.capturas);
  const todas = restaurarCapturas([...existentes, ...nuevas]);
  return { ok: true, lista: todas, agregadas: todas.length - existentes.length };
}
