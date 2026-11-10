// Dólar oficial en bancos (pedido 10/11/2026: "la cotización del dólar de los tres bancos Galicia, BNA y Macro; si no
// se puede acceder, avisame y dejámelo aparte para subir a mano sólo la de Galicia, que es la importante").
// Fuente automática: CriptoYa GET /api/bancostodos ({ banco: { ask, totalAsk, bid, totalBid, time } }, CORS abierto).
// Revisado el 10/11/2026: Nación (bna) viene al día; Galicia y Macro traen un dato del 19/12/2025 (no se actualizan) y
// los bancos no publican su cotización de forma que el navegador la pueda leer → Galicia se carga a mano.
// Un dato viejo nunca se usa como si fuera de hoy: se muestra con su fecha y queda fuera de las cuentas.
import { validarCotizacionesExchanges } from '../exchanges/criptoya.mjs';
import { parseNumberAR } from '../engine/format.mjs';
import { toDec, plain, ONE, HUNDRED } from '../engine/decimal.mjs';

export const URL_BANCOS = 'https://criptoya.com/api/bancostodos';
export const BANCOS = { galicia: 'Banco Galicia', bna: 'Banco Nación', macro: 'Banco Macro' };
/** Bancos que se pueden cargar a mano (pedido: sólo Galicia). */
export const MANUALES = ['galicia'];
export const COPIA_MINUTOS = 15;
export const ESPERA_MANUAL_MS = 60_000;
/** Un dato automático de más de 4 días (fin de semana largo incluido) es viejo y no se usa. */
export const VIEJO_HORAS = 96;
/** Lo cargado a mano se usa siempre, pero pasadas 24 h se pide revisarlo. */
export const REVISAR_MANUAL_HORAS = 24;
/** Un precio que se aleja más de 15 % del oficial de referencia (DolarAPI) se marca raro y no se usa. */
export const RARO_PCT = 15;
const KEY_COPIA = 'brecha.bancos.copia.v1';
export const KEY_MANUAL = 'brecha.bancos.manual.v1';
const MAX_PRECIO = 1e9;

/** Respuesta de CriptoYa → sólo los bancos pedidos, validados. */
export function validarBancos(json) {
  const v = validarCotizacionesExchanges(json, 'ARS');
  if (!v.ok) return { ok: false, error: v.error.replace('exchanges', 'bancos') };
  const filas = v.filas.filter((f) => Object.hasOwn(BANCOS, f.id));
  if (!filas.length) return { ok: false, error: 'CriptoYa no trajo Galicia, Nación ni Macro.' };
  return { ok: true, filas };
}

/* ---------- Carga a mano ---------- */
/**
 * Lo que escribiste → precios validados. La venta (lo que pagás) es obligatoria; la compra (lo que te pagan), opcional.
 * @returns {{ok: true, compra: string|null, venta: string} | {ok: false, error: string}}
 */
export function validarManual({ compra, venta }) {
  const v = parseNumberAR(venta ?? '', { kind: 'money' });
  if (!v.ok) return { ok: false, error: `Venta: ${v.error}.` };
  if (v.empty) return { ok: false, error: 'Escribí al menos la venta (lo que pagás por cada dólar).' };
  const c = parseNumberAR(compra ?? '', { kind: 'money' });
  if (!c.ok) return { ok: false, error: `Compra: ${c.error}.` };
  for (const [x, n] of [[v.value, 'venta'], [c.value, 'compra']]) {
    if (x && (x.lte(0) || x.gt(MAX_PRECIO))) return { ok: false, error: `La ${n} tiene que ser un precio entre $ 0,01 y $ 1.000 millones.` };
  }
  if (c.value && c.value.gt(v.value)) return { ok: false, error: 'La compra (lo que te pagan) no puede ser mayor que la venta (lo que pagás): ¿los diste vuelta?' };
  return { ok: true, compra: c.value ? plain(c.value) : null, venta: plain(v.value) };
}

/** Lo guardado en el navegador, revalidado: { galicia: { compra, venta, at } }. */
export function restaurarManual(g) {
  const out = {};
  if (!g || typeof g !== 'object') return out;
  for (const id of MANUALES) {
    const x = g[id];
    if (!x || typeof x !== 'object' || typeof x.at !== 'string' || x.at.length > 40 || Number.isNaN(Date.parse(x.at))) continue;
    const num = (s) => (typeof s === 'string' && /^\d{1,10}(\.\d{1,12})?$/.test(s) ? s : null);
    const venta = num(x.venta);
    const compra = x.compra === null ? null : num(x.compra);
    if (!venta || (x.compra !== null && !compra) || (compra && toDec(compra).gt(toDec(venta))) || toDec(venta).lte(0)) continue;
    out[id] = { compra, venta, at: x.at };
  }
  return out;
}

/* ---------- Lo que se muestra y se usa ---------- */
/**
 * Junta lo automático y lo cargado a mano. Para comprar dólares se usa la venta del banco (lo que pagás) y para venderlos,
 * la compra (lo que te pagan), igual que en las cotizaciones.
 * @param {{api?: Array|null, apiAt?: string|null, manual?: object, ahora: Date, referencia?: {compra: *, venta: *}|null}} o
 * @returns {Array<{id, nombre, origen: 'api'|'manual'|'ninguno', compra, venta, fecha: string|null, edadMin: number|null,
 *   viejo: boolean, revisar: boolean, motivos: string[], usarCompra: boolean, usarVenta: boolean, apiViejo: object|null, apiAlDia: object|null}>}
 */
export function prepararBancos({ api = null, apiAt = null, manual = {}, ahora, referencia = null }) {
  const t = ahora.getTime();
  const ref = referencia ?? {};
  const lejos = (x, r) => r && x.div(toDec(r)).minus(ONE).abs().times(HUNDRED).gt(RARO_PCT);
  return Object.entries(BANCOS).map(([id, nombre]) => {
    const a = api?.find((f) => f.id === id) ?? null;
    const aFecha = a?.time ? new Date(a.time * 1000).toISOString() : null;
    const aEdadH = aFecha ? (t - Date.parse(aFecha)) / 3600e3 : null;
    const aAlDia = a && a.ask && aEdadH !== null && aEdadH <= VIEJO_HORAS && aEdadH >= -0.1;
    const datoApi = a ? { compra: a.bid ? toDec(a.bid) : null, venta: a.ask ? toDec(a.ask) : null, fecha: aFecha } : null;
    const m = manual?.[id];
    const motivos = [];
    let fila;
    if (m) {
      const edadMin = (t - Date.parse(m.at)) / 60e3;
      fila = { id, nombre, origen: 'manual', compra: m.compra ? toDec(m.compra) : null, venta: toDec(m.venta), fecha: m.at, edadMin, viejo: false, revisar: edadMin > REVISAR_MANUAL_HORAS * 60 };
    } else if (aAlDia) {
      fila = { id, nombre, origen: 'api', ...datoApi, edadMin: aEdadH * 60, viejo: false, revisar: false };
    } else {
      fila = { id, nombre, origen: 'ninguno', compra: null, venta: null, fecha: null, edadMin: null, viejo: !!a, revisar: false };
      if (a && aEdadH !== null) motivos.push(aEdadH < 0 ? 'el dato automático tiene fecha del futuro' : `el último dato automático es del ${fechaCorta(aFecha)}`);
    }
    if (fila.venta && lejos(fila.venta, ref.venta)) motivos.push('la venta se aleja mucho del oficial: revisala');
    if (fila.compra && lejos(fila.compra, ref.compra)) motivos.push('la compra se aleja mucho del oficial: revisala');
    const raroV = fila.venta && lejos(fila.venta, ref.venta);
    const raroC = fila.compra && lejos(fila.compra, ref.compra);
    return {
      ...fila, p2p: false, motivos,
      usarCompra: !!fila.venta && !raroV, // comprar dólares en el banco = su venta
      usarVenta: !!fila.compra && !raroC, // vender dólares al banco = su compra
      apiViejo: a && !aAlDia ? datoApi : null,
      apiAlDia: m && aAlDia ? datoApi : null, // hay dato automático al día aunque usás el tuyo
    };
  });
}
function fechaCorta(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Para las opciones de la calculadora: comprar dólares → precio = venta del banco; venderlos → compra del banco.
 * Devuelve filas con la forma de los exchanges ({ compra, venta, usarCompra, usarVenta }) donde "compra" es lo que pagás.
 */
export function comoOpciones(filas) {
  return filas.map((f) => ({ ...f, compra: f.venta, venta: f.compra, usarCompra: f.usarCompra, usarVenta: f.usarVenta }));
}

/**
 * Cargador de CriptoYa para los bancos (copia de 15 min; el botón, como mucho una vez por minuto; nunca en bucle).
 * @param {{fetch?: typeof fetch, storage: {get: Function, trySet: Function}, ahora?: () => Date}} deps
 */
export function crearFuenteBancos({ fetch: f = globalThis.fetch?.bind(globalThis), storage, ahora = () => new Date() }) {
  let mem = null;
  let ultima = 0;
  const leer = () => {
    const g = storage.get(KEY_COPIA);
    if (!g || typeof g !== 'object' || typeof g.at !== 'string' || Number.isNaN(Date.parse(g.at)) || !g.json) return null;
    const v = validarBancos(g.json);
    return v.ok ? { at: g.at, filas: v.filas } : null;
  };
  /** @returns {Promise<{ok: true, at: string, filas: Array, origen: 'red'|'copia', aviso?: string, esperaMs?: number} | {ok: false, error: string, esperaMs?: number}>} */
  async function cargar({ forzar = false } = {}) {
    const t = ahora().getTime();
    mem = mem ?? leer();
    const edad = mem ? t - Date.parse(mem.at) : Infinity;
    if (mem && !forzar && edad >= 0 && edad < COPIA_MINUTOS * 60e3) return { ok: true, ...mem, origen: 'copia' };
    const desde = Math.max(ultima, mem ? Date.parse(mem.at) : 0);
    if (forzar && t >= desde && t - desde < ESPERA_MANUAL_MS) {
      const esperaMs = ESPERA_MANUAL_MS - (t - desde);
      return mem ? { ok: true, ...mem, origen: 'copia', esperaMs } : { ok: false, error: 'Esperá un momento antes de volver a consultar.', esperaMs };
    }
    ultima = t;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      const r = await f(URL_BANCOS, { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
      if (r.status === 429) throw new Error('CriptoYa pidió esperar');
      if (!r.ok) throw new Error(`CriptoYa respondió ${r.status}`);
      const json = await r.json();
      const v = validarBancos(json);
      if (!v.ok) throw new Error(v.error);
      const at = new Date(t).toISOString();
      mem = { at, filas: v.filas };
      // Se guarda sólo lo de los tres bancos, en el formato de CriptoYa (se revalida al leerlo)
      storage.trySet(KEY_COPIA, { at, json: Object.fromEntries(v.filas.map((x) => [x.id, { ask: num(x.ask), totalAsk: num(x.totalAsk), bid: num(x.bid), totalBid: num(x.totalBid), time: x.time }])) });
      return { ok: true, ...mem, origen: 'red' };
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'CriptoYa no respondió' : e instanceof TypeError ? 'sin conexión o CriptoYa cortó por demasiadas consultas seguidas' : e?.message || 'sin conexión';
      if (mem) return { ok: true, ...mem, origen: 'copia', aviso: `No pude actualizar los bancos (${msg}): muestro lo guardado.` };
      return { ok: false, error: `No pude traer las cotizaciones de los bancos (${msg}).` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { cargar };
}
const num = (s) => (s === null ? 0 : Number(s));
