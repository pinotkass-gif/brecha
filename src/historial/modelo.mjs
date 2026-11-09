// Historial de simulaciones: formato de cada simulación guardada, duplicado, exportación e importación.
// Todo lo importado es dato no confiable: se valida campo por campo y nunca se ejecuta.
import { round, toDec, isDec } from '../engine/decimal.mjs';
import { restaurarBorrador } from '../routes/borrador.mjs';
import { NIVELES } from '../engine/costos.mjs';

export const FORMATO = 'brecha-historial';
/** Formato 2 (Brecha 3): cada simulación guarda la versión del motor y la traza de cómo se obtuvo el resultado. */
export const VERSION = 2;
export const MAX_SIMULACIONES = 100;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const TIPOS = ['simple', 'ruta'];
const ESTADOS_RUTA = ['incompleta', 'teorica', 'condicionada', 'verificada'];
const NUM = /^-?\d+(\.\d+)?$/;

let seq = 0;
export const nuevoIdSim = (ahora = new Date()) => `s${ahora.getTime().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Número guardable: hasta 40 decimales (la precisión de las divisiones del motor), sin notación científica. */
const DECIMALES_GUARDADOS = 40;
const LARGO_MAX_NUMERO = 200;
const dec = (d) => {
  if (d === null || d === undefined) return null;
  const v = round(toDec(d), DECIMALES_GUARDADOS);
  return v.eq(0) ? '0' : v.toFixed();
};
const texto = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');

/**
 * @typedef {object} CotizacionUsada
 * @property {string} etiqueta  "Oficial venta" o "Paso 1: ARS → USD banco"
 * @property {string|null} valor  número exacto ("1570")
 * @property {string} unidad      "ARS por 1 USD"
 * @property {string} fuente      "DolarAPI · origen: Ámbito Financiero", "Manual · mi broker", …
 * @property {string|null} fecha  ISO del dato según la fuente (o de la carga manual)
 * @property {string|null} estado actualizada | antigua | manual | no_disponible
 * @property {boolean|null} confirmada  sólo rutas: si la confirmaste en la plataforma
 *
 * @typedef {object} Simulacion
 * @property {string} id
 * @property {number} version
 * @property {'simple'|'ruta'} tipo
 * @property {string} nombre
 * @property {string} creadaAt
 * @property {string} actualizadaAt
 * @property {string} observaciones
 * @property {{simple?: object, ruta?: object}} entrada  lo necesario para volver a abrirla
 * @property {CotizacionUsada[]} cotizaciones
 * @property {object} resumen     resultado esperado (números como texto exacto)
 * @property {string[]} plataformas
 */

/** @returns {Simulacion} */
export function crearRegistro({ tipo, nombre, entrada, cotizaciones = [], resumen, plataformas = [], observaciones = '', motor = null, traza = null }, ahora = new Date()) {
  const at = ahora.toISOString();
  return {
    id: nuevoIdSim(ahora), version: VERSION, tipo, nombre: texto(nombre, 120) || 'Simulación', creadaAt: at, actualizadaAt: at,
    observaciones: texto(observaciones, 2000), entrada: structuredClone(entrada), cotizaciones: structuredClone(cotizaciones),
    resumen: structuredClone(resumen), plataformas: plataformas.map((x) => texto(x, 80)).filter(Boolean),
    motor: motorValido(motor), traza: limpiarTraza(traza),
  };
}

/* ---------- Traza: cómo se obtuvo el resultado (para reconstruirlo aunque el motor cambie) ---------- */
const MAX_TRAZA = 60000;
/** Versión del motor guardada ("3.0.0"); null = motor anterior a Brecha 3. */
const motorValido = (m) => (typeof m === 'string' && /^[\d.]{1,20}$/.test(m) ? m : null);
/** Deja sólo datos simples (textos cortos, números finitos, booleanos), con profundidad y tamaño acotados. */
export function limpiarTraza(x, prof = 0) {
  if (prof === 0) {
    if (x === null || x === undefined || typeof x !== 'object') return null;
    const limpia = limpiarTraza(x, 1);
    return JSON.stringify(limpia).length <= MAX_TRAZA ? limpia : null;
  }
  if (isDec(x)) return dec(x);
  if (typeof x === 'string') return x.slice(0, 300);
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'boolean' || x === null) return x;
  if (prof > 6 || typeof x !== 'object') return null;
  if (Array.isArray(x)) return x.slice(0, 60).map((v) => limpiarTraza(v, prof + 1));
  const out = {};
  for (const [k, v] of Object.entries(x).slice(0, 80)) {
    if (!/^[\w-]{1,40}$/.test(k) || v === undefined || typeof v === 'function') continue;
    out[k] = limpiarTraza(v, prof + 1);
  }
  return out;
}

/** Traza de la calculadora simple: valores usados, estado de cada costo, cobros, fiscal y cada importe. */
export function trazaDeSimple(r) {
  if (!r?.ok) return null;
  const v = r.values;
  const x = r.result;
  const valores = {};
  for (const k of ['monto', 'cotizacionBase', 'aumentoPct', 'precioVenta', 'relacionConversion', 'comisionCompraPct', 'comisionVentaPct', 'impuestoCompraPct', 'ivaComisionesPct', 'otrosCostos', 'costoTransferencia', 'slippageVentaPct']) valores[k] = v[k] === null || v[k] === undefined ? null : dec(v[k]);
  const importes = {};
  for (const [k, val] of Object.entries(x)) if (isDec(val)) importes[k] = dec(val);
  return {
    tipo: 'simple', motor: x.version, modoMonto: v.modoMonto, valores, estados: v.estados, cobroOtros: v.cobroOtros, cobroTransferencia: v.cobroTransferencia,
    impuestoFiscal: v.impuestoFiscal, ivaFiscal: v.ivaFiscal, requiereConversion: v.requiereConversion, relacionHipotesis: v.relacionHipotesis,
    importes, fijos: Object.fromEntries(Object.entries(x.fijos).map(([k, val]) => [k, dec(val)])),
    objetivos: x.objetivosPrecio.map((o) => ({ objetivoPct: o.objetivoPct, precio: dec(o.precio) })),
    calidad: { nivel: r.calidad.nivel, desconocidos: r.calidad.desconocidos.map((d) => d.etiqueta), hipotesis: r.calidad.hipotesis.map((h) => h.etiqueta) },
    redondeo: 'ninguno (precisión interna de 40 decimales en divisiones; se redondea sólo al mostrar)',
  };
}

/** Traza de una ruta: cada paso con lo entregado, operado, precio, cada costo (con su activo) y lo recibido. */
export function trazaDeRuta(sim) {
  if (!sim?.ok) return null;
  const x = sim.result;
  return {
    tipo: 'ruta', motor: x.version, redondeo: x.redondeo, activoInicial: x.activoInicial, activoFinal: x.activoFinal,
    montoInicial: dec(x.montoInicial), pagosAparte: dec(x.pagosAparte), capitalInvertido: dec(x.capitalInvertido), montoFinal: dec(x.montoFinal),
    brutoTeorico: dec(x.brutoTeorico), costosTotales: dec(x.costosTotales), resultadoNeto: dec(x.resultadoNeto), roiPct: dec(x.roiPct),
    resultadoEconomico: x.resultadoEconomico ? { min: dec(x.resultadoEconomico.min), max: dec(x.resultadoEconomico.max) } : null,
    pasos: x.pasos.map((p) => ({
      desde: p.desde, hacia: p.hacia, tipo: p.tipo, base: p.base, entregado: dec(p.entregado), operado: dec(p.operado), precio: dec(p.precio),
      precioEfectivo: dec(p.precioEfectivo), bruto: dec(p.bruto), recibido: dec(p.recibido), ajusteRedondeo: dec(p.ajusteRedondeo),
      costos: p.costos.map((c) => ({ concepto: c.concepto, clase: c.clase, lado: c.lado, base: c.base, activo: c.activo, monto: dec(c.monto), fiscal: c.fiscal, estado: c.estado, alMinimo: c.alMinimo })),
      violaciones: p.violaciones.map((v) => v.texto),
    })),
    calidad: { nivel: sim.calidad.nivel, desconocidos: sim.calidad.desconocidos.map((d) => d.texto), hipotesis: sim.calidad.hipotesis.map((h) => h.texto) },
  };
}

/** Copia con id y fechas nuevas, para comparar escenarios. */
export function duplicar(r, ahora = new Date()) {
  const at = ahora.toISOString();
  return { ...structuredClone(r), id: nuevoIdSim(ahora), nombre: `${r.nombre} (copia)`.slice(0, 120), creadaAt: at, actualizadaAt: at };
}

/** Resultado de la calculadora simple → resumen guardable. */
export function resumenDeSimple(r) {
  if (!r?.ok) return { ok: false, errores: (r?.errors ?? []).map((e) => texto(e.message, 300)), estado: null, nivel: r?.datosInsuficientes ? 'insuficiente' : null };
  const x = r.result;
  return {
    ok: true, moneda: 'ARS', monedaFinal: 'ARS', motor: x.version ?? null, nivel: r.calidad?.nivel ?? null,
    faltantes: r.calidad?.desconocidos?.length ?? 0, hipotesis: r.calidad?.hipotesis?.length ?? 0,
    economicoMin: dec(x.resultadoEconomico?.min), economicoMax: dec(x.resultadoEconomico?.max),
    capitalInicial: dec(x.capitalInicial), capitalFinal: dec(x.capitalFinal), ingresoBruto: dec(x.ingresoBruto),
    costosTotales: dec(x.costosTotales), resultadoNeto: dec(x.resultadoNeto), roiPct: dec(x.roiPct),
    equilibrio: dec(x.equilibrioVenta), equilibrioUnidad: 'ARS por unidad (precio de venta)',
    brechaNominalPct: dec(x.brechaNominalPct), brechaAjustadaPct: dec(x.brechaAjustadaPct),
    parcial: x.resultadoParcial, avisos: r.warnings.map((w) => texto(w.message, 300)), pasos: null, estado: null,
    pendientes: null, violaciones: null, tiempoTotalHoras: null,
  };
}

/** Resultado del simulador por pasos → resumen guardable. */
export function resumenDeRuta(sim, est, etiquetaEquilibrio = null) {
  if (!sim?.ok) return { ok: false, errores: (sim?.errors ?? []).map((e) => texto(e.message, 300)), estado: 'incompleta', nivel: sim?.datosInsuficientes ? 'insuficiente' : null };
  const x = sim.result;
  return {
    ok: true, moneda: x.activoInicial, monedaFinal: x.activoFinal, motor: x.version ?? null, nivel: sim.calidad?.nivel ?? null,
    faltantes: sim.calidad?.desconocidos?.length ?? 0, hipotesis: sim.calidad?.hipotesis?.length ?? 0,
    economicoMin: dec(x.resultadoEconomico?.min), economicoMax: dec(x.resultadoEconomico?.max),
    capitalInicial: dec(x.capitalInvertido ?? x.montoInicial), capitalFinal: dec(x.montoFinal), ingresoBruto: dec(x.brutoTeorico),
    costosTotales: dec(x.costosTotales), resultadoNeto: dec(x.resultadoNeto), roiPct: dec(x.roiPct),
    equilibrio: x.equilibrio ? dec(x.equilibrio.precio) : null, equilibrioUnidad: etiquetaEquilibrio,
    brechaNominalPct: null, brechaAjustadaPct: dec(x.brechaRutaPct),
    parcial: x.resultadoParcial, avisos: sim.warnings.map((w) => texto(w.message, 300)), pasos: x.pasos.length,
    estado: est?.estado ?? null, pendientes: est?.pendientes.length ?? null, violaciones: est?.violaciones.length ?? null,
    tiempoTotalHoras: dec(x.tiempoTotalHoras),
  };
}

/* ---------- Validación de lo guardado o importado ---------- */
const esFecha = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
const numONulo = (x) => (x === null || x === undefined ? null : typeof x === 'string' && x.length <= LARGO_MAX_NUMERO && NUM.test(x) ? x : undefined);

function validarResumen(s) {
  if (!s || typeof s !== 'object' || typeof s.ok !== 'boolean') return null;
  const nivel = NIVELES.includes(s.nivel) ? s.nivel : null;
  if (!s.ok) {
    const out = { ok: false, errores: Array.isArray(s.errores) ? s.errores.map((e) => texto(e, 300)).slice(0, 20) : [], estado: s.estado === 'incompleta' ? 'incompleta' : null };
    // Igual que con resultado: si el campo vino (aunque sea null), se conserva; la ida y vuelta no cambia nada.
    if (s.nivel !== undefined) out.nivel = nivel;
    return out;
  }
  const out = { ok: true };
  // Campos de Brecha 3 (opcionales: las simulaciones anteriores no los tienen y se muestran como "motor anterior")
  if (s.motor !== undefined) out.motor = typeof s.motor === 'string' && /^[\d.]{1,20}$/.test(s.motor) ? s.motor : null;
  if (s.nivel !== undefined) out.nivel = nivel;
  for (const k of ['faltantes', 'hipotesis']) if (s[k] !== undefined) out[k] = Number.isInteger(s[k]) && s[k] >= 0 && s[k] < 1000 ? s[k] : 0;
  for (const k of ['economicoMin', 'economicoMax']) {
    if (s[k] === undefined) continue;
    const v = numONulo(s[k]);
    if (v === undefined) return null;
    out[k] = v;
  }
  for (const k of ['capitalInicial', 'capitalFinal', 'ingresoBruto', 'costosTotales', 'resultadoNeto', 'roiPct', 'equilibrio', 'brechaNominalPct', 'brechaAjustadaPct', 'tiempoTotalHoras']) {
    const v = numONulo(s[k]);
    if (v === undefined) return null;
    out[k] = v;
  }
  out.moneda = texto(s.moneda, 20);
  out.monedaFinal = texto(s.monedaFinal, 20);
  out.equilibrioUnidad = s.equilibrioUnidad === null ? null : texto(s.equilibrioUnidad, 80);
  out.parcial = s.parcial === true;
  out.avisos = Array.isArray(s.avisos) ? s.avisos.map((a) => texto(a, 300)).slice(0, 20) : [];
  out.pasos = Number.isInteger(s.pasos) && s.pasos > 0 && s.pasos <= 20 ? s.pasos : null;
  out.estado = ESTADOS_RUTA.includes(s.estado) ? s.estado : null;
  out.pendientes = Number.isInteger(s.pendientes) && s.pendientes >= 0 ? s.pendientes : null;
  out.violaciones = Number.isInteger(s.violaciones) && s.violaciones >= 0 ? s.violaciones : null;
  return out;
}

function validarCotizacion(c) {
  if (!c || typeof c !== 'object') return null;
  const valor = numONulo(c.valor);
  if (valor === undefined) return null;
  return {
    etiqueta: texto(c.etiqueta, 120), valor, unidad: texto(c.unidad, 80), fuente: texto(c.fuente, 200),
    fecha: esFecha(c.fecha) ? c.fecha : null,
    estado: ['actualizada', 'antigua', 'manual', 'no_disponible'].includes(c.estado) ? c.estado : null,
    confirmada: typeof c.confirmada === 'boolean' ? c.confirmada : null,
  };
}

function validarEntradaSimple(s) {
  if (!s || typeof s !== 'object') return null;
  const strings = (o, max) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const r = {};
    for (const [k, v] of Object.entries(o).slice(0, 40)) if (/^[\w-]{1,40}$/.test(k) && typeof v === 'string') r[k] = v.slice(0, max);
    return r;
  };
  // 200 > largo máximo de un número (100): un valor demasiado largo sigue dando error al abrirlo, nunca cambia en silencio.
  const checks = {};
  if (s.checks && typeof s.checks === 'object' && !Array.isArray(s.checks)) {
    for (const [k, v] of Object.entries(s.checks).slice(0, 20)) if (/^[\w-]{1,40}$/.test(k) && typeof v === 'boolean') checks[k] = v;
  }
  const out = { campos: strings(s.campos, 200), selects: strings(s.selects, 40), overrideBase: s.overrideBase === true, overrideVenta: s.overrideVenta === true };
  if (s.checks !== undefined) out.checks = checks;
  if (s.version === 3) out.version = 3;
  return out;
}

/** @returns {Simulacion|null} */
export function restaurarRegistro(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !/^[\w-]{1,60}$/.test(r.id)) return null;
  if (!TIPOS.includes(r.tipo)) return null;
  if (!esFecha(r.creadaAt)) return null;
  const resumen = validarResumen(r.resumen);
  if (!resumen) return null;
  let entrada;
  if (r.tipo === 'simple') {
    const s = validarEntradaSimple(r.entrada?.simple);
    if (!s) return null;
    entrada = { simple: s };
  } else {
    const b = restaurarBorrador(r.entrada?.ruta);
    if (!b) return null;
    entrada = { ruta: b };
  }
  const cotizaciones = Array.isArray(r.cotizaciones) ? r.cotizaciones.slice(0, 20).map(validarCotizacion) : [];
  if (cotizaciones.includes(null)) return null;
  return {
    id: r.id, version: VERSION, tipo: r.tipo, nombre: texto(r.nombre, 120) || 'Simulación',
    creadaAt: r.creadaAt, actualizadaAt: esFecha(r.actualizadaAt) ? r.actualizadaAt : r.creadaAt,
    observaciones: texto(r.observaciones, 2000), entrada, cotizaciones, resumen,
    plataformas: Array.isArray(r.plataformas) ? r.plataformas.map((x) => texto(x, 80)).filter(Boolean).slice(0, 20) : [],
    motor: motorValido(r.motor), traza: limpiarTraza(r.traza),
  };
}

/* ---------- Exportar e importar ---------- */
export function exportarJSON(lista, ahora = new Date()) {
  return JSON.stringify({ formato: FORMATO, version: VERSION, exportadoAt: ahora.toISOString(), simulaciones: lista }, null, 2);
}

/**
 * @param {string} contenido  texto del archivo
 * @param {Simulacion[]} existentes
 * @returns {{ok: false, error: string} | {ok: true, nuevos: Simulacion[], repetidos: number, invalidos: number, sinLugar: number}}
 */
export function importarJSON(contenido, existentes = []) {
  if (typeof contenido !== 'string') return { ok: false, error: 'El archivo no se pudo leer.' };
  if (contenido.length > MAX_IMPORT_BYTES) return { ok: false, error: 'El archivo es demasiado grande (más de 5 MB).' };
  let data;
  try {
    data = JSON.parse(contenido);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  if (!data || data.formato !== FORMATO || !Array.isArray(data.simulaciones)) {
    return { ok: false, error: 'No es un archivo de historial de Brecha.' };
  }
  if (typeof data.version !== 'number' || data.version > VERSION) {
    return { ok: false, error: 'El archivo es de una versión más nueva de Brecha.' };
  }
  const ids = new Set(existentes.map((x) => x.id));
  const nuevos = [];
  let repetidos = 0;
  let invalidos = 0;
  let sinLugar = 0;
  for (const raw of data.simulaciones) {
    const r = restaurarRegistro(raw);
    if (!r) { invalidos++; continue; }
    if (ids.has(r.id)) { repetidos++; continue; }
    if (existentes.length + nuevos.length >= MAX_SIMULACIONES) { sinLugar++; continue; }
    ids.add(r.id);
    nuevos.push(r);
  }
  return { ok: true, nuevos, repetidos, invalidos, sinLugar };
}

/* ---------- CSV (para abrir en Excel en español) ---------- */
const SEP = ';';
/** Celda de texto: entre comillas, comillas dobladas y sin fórmulas (= + - @ al inicio). */
function celdaTexto(s) {
  let v = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}
/** Celda numérica: coma decimal, sin separador de miles, redondeada. */
function celdaNumero(s, dp = 2) {
  if (s === null || s === undefined || s === '') return '';
  return round(toDec(s), dp).toFixed(dp).replace('.', ',');
}
const fechaAR = (iso) => {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
};

export const COLUMNAS_CSV = [
  'ID', 'Nombre', 'Tipo', 'Guardada (ISO)', 'Guardada', 'Moneda', 'Capital inicial', 'Capital final', 'Moneda final',
  'Resultado neto', 'ROI %', 'Costos totales', 'Equilibrio', 'Unidad del equilibrio', 'Pasos', 'Estado de la ruta',
  'Parcial', 'Cotizaciones usadas', 'Plataformas', 'Observaciones',
];

/** @param {Simulacion[]} lista */
export function aCSV(lista) {
  const filas = [COLUMNAS_CSV.map(celdaTexto).join(SEP)];
  for (const r of lista) {
    const s = r.resumen;
    const cot = r.cotizaciones.map((c) => `${c.etiqueta}: ${c.valor ?? '—'} ${c.unidad} (${c.fuente}${c.fecha ? `, ${fechaAR(c.fecha)}` : ''}${c.estado ? `, ${c.estado}` : ''})`).join(' | ');
    filas.push([
      celdaTexto(r.id), celdaTexto(r.nombre), celdaTexto(r.tipo === 'simple' ? 'Calculadora simple' : 'Por pasos'),
      celdaTexto(r.creadaAt), celdaTexto(fechaAR(r.creadaAt)), celdaTexto(s.moneda ?? ''),
      celdaNumero(s.capitalInicial), celdaNumero(s.capitalFinal), celdaTexto(s.monedaFinal ?? ''),
      celdaNumero(s.resultadoNeto), celdaNumero(s.roiPct, 4), celdaNumero(s.costosTotales), celdaNumero(s.equilibrio, 4),
      celdaTexto(s.equilibrioUnidad ?? ''), s.pasos ?? '', celdaTexto(s.estado ?? ''), celdaTexto(s.ok ? (s.parcial ? 'Sí' : 'No') : 'Incompleta'),
      celdaTexto(cot), celdaTexto(r.plataformas.join(', ')), celdaTexto(r.observaciones),
    ].join(SEP));
  }
  return `﻿${filas.join('\r\n')}\r\n`;
}
