// Registro propio de precios de USDT por exchange (pedido 15/11/2026: "en promedio cuánto es la diferencia de
// cotización del USDT entre Binance y Cocos"). CriptoYa sólo da el precio de AHORA, así que Brecha guarda una muestra
// cada vez que trae precios (al abrir la app), como mucho una por hora, y con eso calcula promedios entre dos exchanges.
// Sin servidor: el registro vive en este navegador (localStorage). Puro y con Dec; todo lo guardado se revalida al leer.
import { toDec, ZERO, HUNDRED, round } from '../engine/decimal.mjs';

export const KEY_REGISTRO = 'brecha.usdt.registro.v1';
export const MIN_MINUTOS = 60; // una muestra por hora como mucho
export const MAX_MUESTRAS = 3000; // ~ un año abriéndola varias veces por día (≈ 2 MB en el peor caso)
const MAX_EXCHANGES = 100;
const ID = /^[a-z0-9]{1,30}$/;
const NUM = /^\d{1,10}(\.\d{1,12})?$/;
const VOL = /^\d{1,6}$/;
const fechaValida = (t) => typeof t === 'string' && t.length <= 40 && !Number.isNaN(Date.parse(t));
const precioValido = (s) => s === null || (typeof s === 'string' && NUM.test(s) && Number(s) >= 0.01 && Number(s) <= 1e9);

/** Una muestra guardada → la misma validada, o null. Forma: { t: ISO, v: volumen, p: { id: [venta, compra] } }. */
function validarMuestra(m) {
  if (!m || typeof m !== 'object' || !fechaValida(m.t) || !m.p || typeof m.p !== 'object' || Array.isArray(m.p)) return null;
  const p = {};
  for (const [id, par] of Object.entries(m.p).slice(0, MAX_EXCHANGES)) {
    if (!ID.test(id) || !Array.isArray(par) || par.length !== 2 || !precioValido(par[0]) || !precioValido(par[1])) continue;
    if (par[0] === null && par[1] === null) continue;
    p[id] = [par[0], par[1]];
  }
  if (!Object.keys(p).length) return null;
  return { t: new Date(Date.parse(m.t)).toISOString(), v: typeof m.v === 'string' && VOL.test(m.v) ? m.v : null, p };
}

/** Lo guardado → lista de muestras válidas, ordenadas de la más vieja a la más nueva. */
export function restaurarRegistro(g) {
  if (!Array.isArray(g)) return [];
  const xs = g.slice(-MAX_MUESTRAS).map(validarMuestra).filter(Boolean);
  return xs.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

/**
 * Agrega la muestra de unos precios de CriptoYa (lo de crearFuenteExchanges().cargar(): at, volumen, ars) si la
 * última guardada tiene una hora o más. Usa los precios con las comisiones del exchange (totalBid / totalAsk).
 * @returns {{registro: Array, agregada: boolean}}
 */
export function agregarMuestra(registro, datos, { minMinutos = MIN_MINUTOS, max = MAX_MUESTRAS } = {}) {
  if (!datos || !fechaValida(datos.at) || !Array.isArray(datos.ars)) return { registro, agregada: false };
  const t = Date.parse(datos.at);
  const ultima = registro.length ? Date.parse(registro[registro.length - 1].t) : -Infinity;
  if (t - ultima < minMinutos * 60e3) return { registro, agregada: false }; // también descarta una copia ya guardada
  const p = {};
  for (const f of datos.ars.slice(0, MAX_EXCHANGES)) p[f.id] = [f.totalBid ?? null, f.totalAsk ?? null];
  const m = validarMuestra({ t: datos.at, v: String(datos.volumen ?? ''), p });
  if (!m) return { registro, agregada: false };
  return { registro: [...registro, m].slice(-max), agregada: true };
}

/** Exchanges que aparecen en el registro (para elegir), con cuántas muestras tiene cada uno. */
export function exchangesDelRegistro(registro) {
  const n = new Map();
  for (const m of registro) for (const id of Object.keys(m.p)) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()].map(([id, muestras]) => ({ id, muestras }));
}

const DIA_AR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });

function resumirLado(registro, a, b, i) {
  const difs = [];
  for (const m of registro) {
    const x = m.p[a]?.[i];
    const y = m.p[b]?.[i];
    if (!x || !y) continue;
    const da = toDec(x);
    const db = toDec(y);
    difs.push({ t: m.t, pesos: da.minus(db), pct: da.minus(db).div(db).times(HUNDRED), a: da, b: db });
  }
  if (!difs.length) return { n: 0 };
  const suma = (k) => difs.reduce((s, d) => s.plus(d[k]), ZERO);
  const porPct = [...difs].sort((p, q) => p.pct.cmp(q.pct));
  const dias = new Set(difs.map((d) => DIA_AR.format(new Date(d.t))));
  return {
    n: difs.length,
    dias: dias.size,
    desde: difs[0].t,
    hasta: difs[difs.length - 1].t,
    promedioPct: round(suma('pct').div(difs.length), 4),
    promedioPesos: round(suma('pesos').div(difs.length), 4),
    promedioA: round(suma('a').div(difs.length), 4),
    promedioB: round(suma('b').div(difs.length), 4),
    minPct: round(porPct[0].pct, 4),
    maxPct: round(porPct[porPct.length - 1].pct, 4),
    vecesAMas: difs.filter((d) => d.pct.gt(0)).length,
    ultimo: { t: difs[difs.length - 1].t, pct: round(difs[difs.length - 1].pct, 4), pesos: round(difs[difs.length - 1].pesos, 4) },
  };
}

/**
 * Diferencia promedio entre el exchange A y el B, sólo en los momentos en que los dos tienen precio.
 *   venta  = lo que te pagan por 1 USDT (A − B) / B: positivo = A paga más.
 *   compra = lo que pagás por 1 USDT (A − B) / B: positivo = A es más caro.
 * @param {{dias?: number, ahora?: Date}} [o]  dias = sólo los últimos N días (contados desde ahora)
 */
export function compararExchanges(registro, a, b, { dias = null, ahora = new Date() } = {}) {
  if (!ID.test(String(a)) || !ID.test(String(b)) || a === b) return { ok: false, error: 'Elegí dos exchanges distintos.' };
  let xs = registro;
  if (dias !== null && Number.isFinite(dias) && dias > 0) {
    const desde = ahora.getTime() - dias * 86400e3;
    xs = registro.filter((m) => Date.parse(m.t) >= desde);
  }
  const venta = resumirLado(xs, a, b, 0);
  const compra = resumirLado(xs, a, b, 1);
  if (!venta.n && !compra.n) {
    return { ok: false, error: registro.length ? 'Todavía no hay momentos guardados en los que los dos tengan precio.' : 'Todavía no hay precios guardados: se juntan solos cada vez que abrís Brecha (uno por hora como mucho).' };
  }
  return { ok: true, a, b, muestras: xs.length, venta, compra };
}
