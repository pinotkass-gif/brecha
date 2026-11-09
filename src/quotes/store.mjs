// Estado de cotizaciones: qué vino del proveedor, qué editaste a mano, y cuándo.
// Funciones puras (devuelven un estado nuevo) para poder testearlas sin navegador.
import { IDS_MERCADOS } from './markets.mjs';
import { esValido, UMBRAL_SALTO_PCT, PROBLEMAS } from './calidad.mjs';

/**
 * @typedef {object} CotizacionMercado
 * @property {string|null} compra   valor vigente en la calculadora (bid)
 * @property {string|null} venta    valor vigente en la calculadora (ask)
 * @property {'api'|'manual'|'ninguno'} origen
 * @property {string|null} fechaFuente   hora del precio según la fuente
 * @property {string|null} fetchedAt     hora en que lo recibimos
 * @property {string|null} editadoAt     hora de la edición manual
 * @property {string|null} fuente        proveedor ("DolarAPI") o "Manual"
 * @property {string|null} fuenteOriginal  de dónde lo toma el proveedor ("DolarHoy", "Ámbito Financiero")
 * @property {string} fuenteManual       de dónde sacaste el precio manual ("mi broker"), opcional
 * @property {boolean} valido
 * @property {string[]} problemas        códigos de src/quotes/calidad.mjs
 * @property {object|null} api           último dato del proveedor (aunque haya manual)
 */

const mercadoVacio = () => ({
  compra: null, venta: null, origen: 'ninguno', fechaFuente: null, fetchedAt: null, editadoAt: null,
  fuente: null, fuenteOriginal: null, fuenteManual: '', valido: false, problemas: [], api: null,
});

export function estadoInicial() {
  const mercados = {};
  for (const id of IDS_MERCADOS) mercados[id] = mercadoVacio();
  return { mercados, ultimaConsulta: null };
}

/** IDs de mercados con valores cargados a mano. */
export function manuales(state) {
  return IDS_MERCADOS.filter((id) => state.mercados[id].origen === 'manual');
}

function saltoBrusco(nuevo, anterior) {
  if (!nuevo || !anterior) return false;
  const a = Number(anterior);
  const n = Number(nuevo);
  return a > 0 && Math.abs(n / a - 1) * 100 > UMBRAL_SALTO_PCT;
}

/**
 * Aplica una respuesta del proveedor.
 * - Si falla: conserva todo, registra el error y, si el proveedor pidió esperar, hasta cuándo.
 * - Si anda: actualiza los mercados que vinieron. Los manuales NO se pisan salvo reemplazarManuales = true;
 *   igual se guarda el dato nuevo para mostrarlo al lado. Un cambio brusco contra el dato anterior se marca.
 */
export function aplicarRespuesta(state, resp, { reemplazarManuales = false } = {}) {
  const next = structuredClone(state);
  const prev = state.ultimaConsulta;
  const comun = { at: resp.fetchedAt, intentos: resp.intentos ?? 1, proveedor: resp.proveedor ?? null };
  if (!resp.ok) {
    const espera = resp.error?.reintentarDespuesMs;
    next.ultimaConsulta = {
      ...comun, ok: false, error: resp.error, faltantes: [], conservados: [],
      ultimoExitoAt: prev?.ultimoExitoAt ?? null,
      reintentarDespues: espera ? new Date(Date.parse(resp.fetchedAt) + espera).toISOString() : null,
    };
    return next;
  }
  const conservados = [];
  for (const id of IDS_MERCADOS) {
    const q = resp.cotizaciones[id];
    const m = next.mercados[id];
    if (!q) {
      if (!m.problemas.includes('sin_dato_en_ultima_consulta')) m.problemas.push('sin_dato_en_ultima_consulta');
      continue;
    }
    const problemas = [...q.problemas];
    const anterior = m.api;
    if (anterior && (saltoBrusco(q.venta, anterior.venta) || saltoBrusco(q.compra, anterior.compra)) && !problemas.includes('salto_brusco')) {
      problemas.push('salto_brusco');
    }
    m.api = {
      compra: q.compra, venta: q.venta, fechaFuente: q.fechaFuente, fetchedAt: resp.fetchedAt, fuente: q.fuente,
      fuenteOriginal: q.fuenteOriginal ?? null, valido: esValido(problemas), problemas,
    };
    if (m.origen === 'manual' && !reemplazarManuales) {
      conservados.push(id);
      continue;
    }
    Object.assign(m, {
      compra: q.compra, venta: q.venta, origen: 'api', fechaFuente: q.fechaFuente, fetchedAt: resp.fetchedAt,
      editadoAt: null, fuente: q.fuente, fuenteOriginal: q.fuenteOriginal ?? null, fuenteManual: '',
      valido: esValido(problemas), problemas: [...problemas],
    });
  }
  next.ultimaConsulta = {
    ...comun, ok: true, error: null, faltantes: resp.faltantes ?? [], conservados,
    ultimoExitoAt: resp.fetchedAt, reintentarDespues: null,
  };
  return next;
}

/** Edición manual de una punta. valor = texto en formato máquina ("1590.5") o null si se borró. */
export function editarManual(state, id, punta, valor, ahora = new Date()) {
  if (punta !== 'compra' && punta !== 'venta') throw new Error('punta inválida');
  const next = structuredClone(state);
  const m = next.mercados[id];
  m[punta] = valor;
  m.origen = 'manual';
  m.editadoAt = ahora.toISOString();
  m.fuente = 'Manual';
  m.fuenteOriginal = null;
  m.problemas = m.compra !== null && m.venta !== null ? [] : ['incompleto'];
  if (m.compra !== null && m.venta !== null && Number(m.venta) < Number(m.compra)) m.problemas.push('puntas_invertidas');
  m.valido = esValido(m.problemas);
  return next;
}

/** De dónde sacaste un precio manual ("mi broker", "exchange X"). Sólo para cotizaciones manuales. */
export function editarFuenteManual(state, id, texto) {
  const next = structuredClone(state);
  const m = next.mercados[id];
  if (m.origen === 'manual') m.fuenteManual = String(texto ?? '').trim().slice(0, 60);
  return next;
}

/** Vuelve al último dato del proveedor (si existe). */
export function volverAAPI(state, id) {
  const next = structuredClone(state);
  const m = next.mercados[id];
  if (!m.api) return next;
  Object.assign(m, {
    compra: m.api.compra, venta: m.api.venta, origen: 'api', fechaFuente: m.api.fechaFuente, fetchedAt: m.api.fetchedAt,
    editadoAt: null, fuente: m.api.fuente, fuenteOriginal: m.api.fuenteOriginal ?? null, fuenteManual: '',
    valido: m.api.valido ?? true, problemas: [...(m.api.problemas ?? [])],
  });
  return next;
}

/** Antigüedad corrida del precio en milisegundos (null si no se sabe). */
export function antiguedadMs(m, ahora = new Date()) {
  const ref = m.origen === 'manual' ? m.editadoAt : m.fechaFuente;
  if (!ref) return null;
  return ahora.getTime() - Date.parse(ref);
}

/* ---------- Restaurar lo guardado en el navegador (dato no confiable: puede estar corrupto) ---------- */
const NUMERO = /^\d+(\.\d+)?(e[+-]?\d+)?$/i;
const esObjeto = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const precioG = (x) => (typeof x === 'string' && x.length <= 100 && NUMERO.test(x) && Number(x) > 0 ? x : null);
const fechaG = (x) => (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? x : null);
const textoG = (x, max) => (typeof x === 'string' ? x.slice(0, max) : null);
const problemasG = (x) => (Array.isArray(x) ? x.filter((p) => typeof p === 'string' && Object.hasOwn(PROBLEMAS, p)).slice(0, 20) : []);
const idsG = (x) => (Array.isArray(x) ? x.filter((id) => IDS_MERCADOS.includes(id)) : []);

function apiG(a) {
  if (!esObjeto(a)) return null;
  const venta = precioG(a.venta);
  return {
    compra: precioG(a.compra), venta, fechaFuente: fechaG(a.fechaFuente), fetchedAt: fechaG(a.fetchedAt),
    fuente: textoG(a.fuente, 60), fuenteOriginal: textoG(a.fuenteOriginal, 60), valido: a.valido === true && venta !== null, problemas: problemasG(a.problemas),
  };
}

function consultaG(u) {
  if (!esObjeto(u)) return null;
  const ok = u.ok === true;
  let error = null;
  if (!ok) {
    const e = esObjeto(u.error) ? u.error : {};
    error = { tipo: textoG(e.tipo, 20) ?? 'desconocido', reintentable: e.reintentable === true, mensaje: textoG(e.mensaje, 300) ?? 'Error desconocido.' };
    if (Number.isInteger(e.status)) error.status = e.status;
    if (Number.isFinite(e.reintentarDespuesMs)) error.reintentarDespuesMs = e.reintentarDespuesMs;
  }
  return {
    at: fechaG(u.at), intentos: Number.isInteger(u.intentos) && u.intentos > 0 && u.intentos < 10 ? u.intentos : 1, proveedor: textoG(u.proveedor, 40),
    ok, error, faltantes: idsG(u.faltantes), conservados: idsG(u.conservados), ultimoExitoAt: fechaG(u.ultimoExitoAt), reintentarDespues: fechaG(u.reintentarDespues),
  };
}

/** Restaura un estado guardado validando cada campo; lo que no sirve vuelve al valor vacío. */
export function restaurar(guardado) {
  const base = estadoInicial();
  if (!esObjeto(guardado) || !esObjeto(guardado.mercados)) return base;
  for (const id of IDS_MERCADOS) {
    const g = guardado.mercados[id];
    if (!esObjeto(g) || !['api', 'manual', 'ninguno'].includes(g.origen)) continue;
    const venta = precioG(g.venta);
    base.mercados[id] = {
      compra: precioG(g.compra), venta, origen: g.origen, fechaFuente: fechaG(g.fechaFuente), fetchedAt: fechaG(g.fetchedAt), editadoAt: fechaG(g.editadoAt),
      fuente: textoG(g.fuente, 60), fuenteOriginal: textoG(g.fuenteOriginal, 60), fuenteManual: textoG(g.fuenteManual, 60) ?? '',
      valido: g.valido === true && venta !== null, problemas: problemasG(g.problemas), api: apiG(g.api),
    };
  }
  base.ultimaConsulta = consultaG(guardado.ultimaConsulta);
  return base;
}
