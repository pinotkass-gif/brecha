// Precios de USDT por exchange: CriptoYa (https://criptoya.com · docs: https://docs.criptoya.com/argentina).
//   GET /api/usdt/ars/{volumen} y /api/usdt/usd/{volumen} → { [exchange]: { ask, totalAsk, bid, totalBid, time } }
//     ask = lo que pagás por 1 USDT, bid = lo que te pagan; "total" = con las comisiones que informa CriptoYa;
//     time = segundos Unix del dato; volumen = cuántos USDT vas a operar (el precio depende del monto).
//   GET /api/fees → comisión de retiro por exchange, moneda y red (en unidades de la moneda).
// Según la documentación (revisada el 10/11/2026) CriptoYa actualiza cada 1 minuto y permite 120 consultas por minuto
// (CORS abierto). Brecha consulta sólo al mostrar la sección si la copia tiene más de 5 minutos, al cambiar el
// volumen o con el botón (como mucho una vez por minuto). Nunca en bucle. Todo se valida dato por dato.

export const URL_CRIPTOYA = 'https://criptoya.com/api';
export const VOLUMENES = ['100', '500', '1000', '5000'];
export const VOLUMEN_POR_DEFECTO = '500';
export const COPIA_MINUTOS = 5;
export const ESPERA_MANUAL_MS = 60_000;
export const FEES_HORAS = 6;
const MAX_EXCHANGES = 100;
const MAX_REDES = 30;
const ID = /^[a-z0-9]{1,30}$/;
const RED = /^[A-Z0-9_]{1,20}$/;
/** Rango de precios aceptado: en pesos, el mismo de las cotizaciones ($ 0,01 a $ 1.000 millones); en dólares por USDT, 0,01 a 10. */
const RANGO = { ARS: [0.01, 1e9], USD: [0.01, 10] };
const MAX_RETIRO = 1000; // USDT: una comisión de retiro mayor es un dato roto
const keyDatos = (vol) => `brecha.exchanges.datos.v1.${vol}`;
const KEY_FEES = 'brecha.exchanges.fees.v1';

/** Número de la fuente → texto sin notación científica (big.js y la copia local lo leen igual). */
const texto = (n) => { const s = String(n); return s.includes('e') ? n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') : s; };
/** Segundos Unix razonables (2001 a 2286) o null. */
const segundos = (t) => (typeof t === 'number' && Number.isInteger(t) && t > 1e9 && t < 1e10 ? t : null);

/**
 * Precio de la fuente → texto exacto, o null si no hay oferta (0 o negativo) o el dato es inválido.
 * @returns {{valor: string|null, roto: boolean}}
 */
function precio(x, fiat) {
  if (x === undefined || x === null || x === 0) return { valor: null, roto: false };
  if (typeof x !== 'number' || !Number.isFinite(x)) return { valor: null, roto: true };
  if (x < 0) return { valor: null, roto: false };
  const [min, max] = RANGO[fiat];
  if (x < min || x > max) return { valor: null, roto: true };
  return { valor: texto(x), roto: false };
}

/**
 * Valida la respuesta de /api/usdt/{fiat}/{volumen}.
 * @param {*} json  @param {'ARS'|'USD'} fiat
 * @returns {{ok: true, filas: Array<{id: string, ask: string|null, totalAsk: string|null, bid: string|null, totalBid: string|null, time: number|null}>, descartadas: number} | {ok: false, error: string}}
 */
export function validarCotizacionesExchanges(json, fiat = 'ARS') {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: 'CriptoYa no devolvió la lista de exchanges.' };
  const filas = [];
  let descartadas = 0;
  for (const [id, x] of Object.entries(json).slice(0, MAX_EXCHANGES)) {
    if (!ID.test(id) || !x || typeof x !== 'object') { descartadas++; continue; }
    const p = Object.fromEntries(['ask', 'totalAsk', 'bid', 'totalBid'].map((k) => [k, precio(x[k], fiat)]));
    const fila = { id, ask: p.ask.valor, totalAsk: p.totalAsk.valor, bid: p.bid.valor, totalBid: p.totalBid.valor, time: segundos(x.time) };
    if (Object.values(p).some((v) => v.roto)) descartadas++;
    if (fila.ask === null && fila.bid === null && fila.totalAsk === null && fila.totalBid === null) continue; // sin ninguna oferta
    filas.push(fila);
  }
  if (!filas.length) return { ok: false, error: 'CriptoYa no trajo precios válidos.' };
  filas.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { ok: true, filas, descartadas };
}

/**
 * Valida /api/fees y se queda sólo con USDT: { [exchange]: { [red]: { retiro: string, time: number|null } } }.
 * @returns {{ok: true, fees: object} | {ok: false, error: string}}
 */
export function validarFees(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: 'CriptoYa no devolvió las comisiones de retiro.' };
  const fees = {};
  for (const [id, monedas] of Object.entries(json).slice(0, MAX_EXCHANGES)) {
    const usdt = monedas && typeof monedas === 'object' ? monedas.USDT : null;
    if (!ID.test(id) || !usdt || typeof usdt !== 'object' || Array.isArray(usdt)) continue;
    const redes = {};
    for (const [red, d] of Object.entries(usdt).slice(0, MAX_REDES)) {
      const w = d && typeof d === 'object' ? d.withdraw : undefined;
      if (!RED.test(red) || typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > MAX_RETIRO) continue;
      redes[red] = { retiro: texto(w), time: segundos(d.time) };
    }
    if (Object.keys(redes).length) fees[id] = redes;
  }
  if (!Object.keys(fees).length) return { ok: false, error: 'CriptoYa no trajo comisiones de retiro válidas.' };
  return { ok: true, fees };
}

/* ---------- Copia local (compacta, revalidada al leer) ---------- */
const aFilas = (lista, fiat) => {
  if (!Array.isArray(lista)) return null;
  const obj = {};
  for (const f of lista.slice(0, MAX_EXCHANGES)) {
    if (!Array.isArray(f) || typeof f[0] !== 'string') return null;
    obj[f[0]] = { ask: num(f[1]), totalAsk: num(f[2]), bid: num(f[3]), totalBid: num(f[4]), time: f[5] };
  }
  const v = validarCotizacionesExchanges(obj, fiat);
  return v.ok ? v.filas : null;
};
const num = (s) => (typeof s === 'string' && /^\d{1,10}(\.\d{1,12})?$/.test(s) ? Number(s) : s === null ? 0 : NaN);
const deFilas = (filas) => filas.map((f) => [f.id, f.ask, f.totalAsk, f.bid, f.totalBid, f.time]);
const fechaValida = (at) => typeof at === 'string' && at.length <= 40 && !Number.isNaN(Date.parse(at));

function leerDatos(storage, vol) {
  const g = storage.get(keyDatos(vol));
  if (!g || typeof g !== 'object' || !fechaValida(g.at)) return null;
  const ars = aFilas(g.ars, 'ARS');
  if (!ars) return null;
  return { at: g.at, ars, usd: g.usd === null ? null : aFilas(g.usd, 'USD') };
}
function leerFees(storage) {
  const g = storage.get(KEY_FEES);
  if (!g || typeof g !== 'object' || !fechaValida(g.at) || !g.fees || typeof g.fees !== 'object') return null;
  const crudo = {};
  for (const [id, redes] of Object.entries(g.fees).slice(0, MAX_EXCHANGES)) {
    if (!redes || typeof redes !== 'object') continue;
    crudo[id] = { USDT: Object.fromEntries(Object.entries(redes).slice(0, MAX_REDES).map(([red, d]) => [red, { withdraw: num(d?.retiro), time: d?.time }])) };
  }
  const v = validarFees(crudo);
  return v.ok ? { at: g.at, fees: v.fees } : null;
}

/**
 * Crea el cargador (con memoria de la sesión).
 * @param {{fetch?: typeof fetch, storage: {get: Function, trySet: Function}, ahora?: () => Date}} deps
 */
export function crearFuenteExchanges({ fetch: f = globalThis.fetch?.bind(globalThis), storage, ahora = () => new Date() }) {
  const memoria = new Map();
  let feesMem = null;
  let ultimaConsulta = 0;

  async function pedir(url, fiat) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      const r = await f(url, { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
      if (r.status === 429) throw new Error('CriptoYa pidió esperar (demasiadas consultas)');
      if (!r.ok) throw new Error(`CriptoYa respondió ${r.status}`);
      const json = await r.json();
      const v = fiat === 'fees' ? validarFees(json) : validarCotizacionesExchanges(json, fiat);
      if (!v.ok) throw new Error(v.error);
      return v;
    } catch (e) {
      // fetch rechaza con TypeError ("Failed to fetch") sin conexión o si CriptoYa corta por muchas consultas seguidas
      throw new Error(e?.name === 'AbortError' ? 'CriptoYa no respondió' : e instanceof TypeError ? 'sin conexión o CriptoYa cortó por demasiadas consultas seguidas' : e?.message || 'sin conexión');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * @param {{volumen?: string, forzar?: boolean}} [opts]  forzar = botón "Actualizar" (como mucho una vez por minuto)
   * @returns {Promise<{ok: true, at: string, volumen: string, ars: Array, usd: Array|null, fees: object|null, feesAt: string|null, origen: 'red'|'copia', avisos: string[], esperaMs?: number} | {ok: false, error: string, esperaMs?: number}>}
   */
  async function cargar({ volumen = VOLUMEN_POR_DEFECTO, forzar = false } = {}) {
    const vol = VOLUMENES.includes(String(volumen)) ? String(volumen) : VOLUMEN_POR_DEFECTO;
    const t = ahora().getTime();
    const copia = memoria.get(vol) ?? leerDatos(storage, vol);
    if (copia) memoria.set(vol, copia);
    feesMem = feesMem ?? leerFees(storage);
    const conFees = (d, origen, avisos = [], extra = {}) => ({ ok: true, ...d, volumen: vol, fees: feesMem?.fees ?? null, feesAt: feesMem?.at ?? null, origen, avisos, ...extra });
    const edad = copia ? t - Date.parse(copia.at) : Infinity;
    if (copia && !forzar && edad >= 0 && edad < COPIA_MINUTOS * 60e3) return conFees(copia, 'copia');
    // Botón: como mucho una consulta por minuto (cuenta la de esta sesión y la copia guardada, por si recargaste la página).
    const ultima = Math.max(ultimaConsulta, copia ? Date.parse(copia.at) : 0);
    if (forzar && t >= ultima && t - ultima < ESPERA_MANUAL_MS) {
      const esperaMs = ESPERA_MANUAL_MS - (t - ultima);
      return copia ? conFees(copia, 'copia', [], { esperaMs }) : { ok: false, error: 'Esperá un momento antes de volver a consultar.', esperaMs };
    }
    ultimaConsulta = t;
    const feesViejas = !feesMem || t - Date.parse(feesMem.at) >= FEES_HORAS * 3600e3 || t < Date.parse(feesMem.at);
    const [ars, usd, fees] = await Promise.allSettled([
      pedir(`${URL_CRIPTOYA}/usdt/ars/${vol}`, 'ARS'),
      pedir(`${URL_CRIPTOYA}/usdt/usd/${vol}`, 'USD'),
      feesViejas ? pedir(`${URL_CRIPTOYA}/fees`, 'fees') : Promise.resolve(null),
    ]);
    const avisos = [];
    const at = new Date(t).toISOString();
    if (fees.status === 'fulfilled' && fees.value) {
      feesMem = { at, fees: fees.value.fees };
      storage.trySet(KEY_FEES, { at, fees: feesMem.fees });
    } else if (fees.status === 'rejected') {
      avisos.push(feesMem
        ? `No pude actualizar las comisiones de retiro (${fees.reason.message}): uso las guardadas.`
        : `No pude traer las comisiones de retiro (${fees.reason.message}): pasar USDT de un exchange a otro queda en «No sé».`);
    }
    if (ars.status === 'rejected') {
      if (copia) return conFees(copia, 'copia', [`No pude actualizar los precios (${ars.reason.message}): muestro los guardados.`, ...avisos]);
      return { ok: false, error: `No pude traer los precios de los exchanges (${ars.reason.message}). Probá de nuevo en un rato.` };
    }
    let usdFilas = usd.status === 'fulfilled' ? usd.value.filas : null;
    if (!usdFilas) {
      avisos.push(`No pude traer los precios en dólares (${usd.reason.message})${copia?.usd ? ': uso los guardados' : ''}.`);
      usdFilas = copia?.usd ?? null;
    }
    const descartadas = ars.value.descartadas + (usd.status === 'fulfilled' ? usd.value.descartadas : 0);
    if (descartadas) avisos.push(`Descarté ${descartadas === 1 ? '1 precio inválido' : `${descartadas} precios inválidos`} de CriptoYa.`);
    const dato = { at, ars: ars.value.filas, usd: usdFilas };
    memoria.set(vol, dato);
    storage.trySet(keyDatos(vol), { at, ars: deFilas(dato.ars), usd: dato.usd ? deFilas(dato.usd) : null });
    return conFees(dato, 'red', avisos);
  }
  return { cargar };
}
