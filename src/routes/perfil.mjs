// Perfil de costos para la vista de resultado neto: costos por mercado y conversiones entre instrumentos.
// Vacío = NO SÉ (el resultado queda incompleto, como cota máxima). "no aplica" = ese costo no existe.
// 0 = sin costo, confirmado. Una conversión que no cargaste NO se supone 1:1: la combinación queda en
// "datos insuficientes" hasta que la cargues (o la cargues como hipótesis, y entonces es un ESTIMADO).
import { parseNumberAR, formatNumberAR } from '../engine/format.mjs';
import { relacionDesdePct, pctDesdeRelacion, SENTIDOS_CONVERSION } from '../engine/conversion.mjs';
import { NO_APLICA, esNoAplica, TRATAMIENTOS } from '../engine/costos.mjs';
import { IDS_MERCADOS, mercadoPorId } from '../quotes/markets.mjs';
import { IDS_ACTIVOS, corto } from './activos.mjs';
import { nuevoId, INVALIDO } from './borrador.mjs';

export const CAMPOS_MERCADO = [
  { k: 'comisionCompraPct', label: 'Comisión al comprar', unidad: '%', kind: 'percent', lado: 'compra' },
  { k: 'impuestoCompraPct', label: 'Impuestos al comprar', unidad: '%', kind: 'percent', lado: 'compra' },
  { k: 'fijoCompraARS', label: 'Fijo al comprar', unidad: 'ARS', kind: 'money', lado: 'compra' },
  { k: 'comisionVentaPct', label: 'Comisión al vender', unidad: '%', kind: 'percent', lado: 'venta' },
  { k: 'fijoVentaARS', label: 'Fijo al vender', unidad: 'ARS', kind: 'money', lado: 'venta' },
  { k: 'slippageVentaPct', label: 'Slippage al vender', unidad: '%', kind: 'percent', lado: 'venta' },
];
// Una conversión se carga como el % que te cobran por pasar de un instrumento al otro (todo incluido).
// "comisionPct" queda sólo para las conversiones cargadas antes con una comisión aparte (no se esconde ese dato).
export const CAMPOS_CONVERSION = [
  { k: 'costoPct', label: 'Te cobran', kind: 'percent' },
  { k: 'comisionPct', label: 'Comisión aparte %', kind: 'percent' },
  { k: 'fijoDestino', label: 'Costo fijo (en destino)', kind: 'money' },
];
export const MONTO_REFERENCIA = '1.000.000';
export const MAX_CONVERSIONES = 20;

export function perfilVacio() {
  const mercados = {};
  for (const id of IDS_MERCADOS) mercados[id] = { ...Object.fromEntries(CAMPOS_MERCADO.map((c) => [c.k, ''])), impuestoFiscal: 'pendiente' };
  return { version: 2, montoARS: MONTO_REFERENCIA, mercados, conversiones: [] };
}

export function nuevaConversion(desde = 'USD_BANCO', hacia = 'USDT') {
  return { id: nuevoId('v'), desde, hacia, costoPct: '', sentido: 'cobran', hipotesis: false, comisionPct: 'no aplica', fijoDestino: '' };
}

/** Una conversión guardada con la relación (versión anterior) → el % exacto que te cobran. */
function costoDesdeRelacionVieja(raw) {
  const r = parseNumberAR(raw ?? '', { kind: 'ratio' });
  if (!r.ok || r.empty || r.value.lte(0)) return { costoPct: r.ok ? '' : String(raw ?? '').slice(0, 200), sentido: 'cobran' };
  const { sentido, pct } = pctDesdeRelacion(r.value);
  return { costoPct: formatNumberAR(pct, { decimals: 12, minDecimals: 0 }), sentido };
}

/** Valida un perfil guardado; lo que no sirve vuelve al valor por defecto. */
export function restaurarPerfil(g) {
  const p = perfilVacio();
  if (!g || typeof g !== 'object') return p;
  // 200 > largo máximo de un número (100): uno demasiado largo sigue dando error, nunca cambia en silencio.
  const txt = (x) => (typeof x === 'string' ? x.slice(0, 200) : '');
  if (typeof g.montoARS === 'string') p.montoARS = txt(g.montoARS);
  for (const id of IDS_MERCADOS) {
    for (const c of CAMPOS_MERCADO) p.mercados[id][c.k] = txt(g.mercados?.[id]?.[c.k]);
    const f = g.mercados?.[id]?.impuestoFiscal;
    if (Object.hasOwn(TRATAMIENTOS, f)) p.mercados[id].impuestoFiscal = f;
  }
  if (Array.isArray(g.conversiones)) {
    p.conversiones = g.conversiones
      .filter((v) => v && IDS_ACTIVOS.includes(v.desde) && IDS_ACTIVOS.includes(v.hacia) && v.desde !== v.hacia)
      .slice(0, MAX_CONVERSIONES)
      .map((v) => ({
        id: txt(v.id) || nuevoId('v'), desde: v.desde, hacia: v.hacia,
        ...(typeof v.costoPct === 'string'
          ? { costoPct: txt(v.costoPct), sentido: Object.hasOwn(SENTIDOS_CONVERSION, v.sentido) ? v.sentido : 'cobran' }
          : costoDesdeRelacionVieja(txt(v.relacion))),
        hipotesis: v.hipotesis === true, comisionPct: txt(v.comisionPct), fijoDestino: txt(v.fijoDestino),
      }));
  }
  return p;
}

/**
 * Perfil (textos) → valores exactos y qué falta. Lo ilegible va como INVALIDO (el motor lo informa).
 * Cada valor: null = no sé · NO_APLICA = no aplica · Dec = conocido (0 incluido).
 * @returns {{monto: *, mercados: Record<string, {valores: Record<string, *>, desconocidos: string[], impuestoFiscal: string}>,
 *   conversiones: Map<string, {relacion: *, hipotesis: boolean, comisionPct: *, fijoDestino: *, desconocidos: string[]}>, errores: string[]}}
 */
export function normalizarPerfil(p) {
  const errores = [];
  const leer = (raw, kind, donde) => {
    if (esNoAplica(raw)) return NO_APLICA;
    const r = parseNumberAR(raw, { kind });
    if (!r.ok) {
      errores.push(`${donde}: ${r.error}`);
      return INVALIDO;
    }
    return r.empty ? null : r.value;
  };
  const monto = leer(p.montoARS, 'money', 'Monto de referencia');
  if (monto === null || monto === NO_APLICA) errores.push('Monto de referencia: falta el dato');
  const mercados = {};
  for (const id of IDS_MERCADOS) {
    const valores = {};
    const desconocidos = [];
    for (const c of CAMPOS_MERCADO) {
      const v = leer(p.mercados[id]?.[c.k], c.kind, `${mercadoPorId(id).nombre} · ${c.label}`);
      valores[c.k] = v;
      if (v === null) desconocidos.push(c.k);
    }
    mercados[id] = { valores, desconocidos, impuestoFiscal: p.mercados[id]?.impuestoFiscal ?? 'pendiente' };
  }
  const conversiones = new Map();
  for (const v of p.conversiones) {
    const donde = `Conversión ${corto(v.desde)} → ${corto(v.hacia)}`;
    let relacion;
    if (typeof v.costoPct === 'string') {
      // % que te cobran (o te dan de más). "no aplica" = no te cobran nada (0 %).
      const c = leer(v.costoPct, 'percent', donde);
      if (c === null || c === INVALIDO) continue; // sin el % la conversión no está cargada: datos insuficientes
      const r = relacionDesdePct(c === NO_APLICA ? 0 : c, v.sentido ?? 'cobran');
      if (!r.ok) { errores.push(`${donde}: ${r.error}`); continue; }
      relacion = r.relacion;
    } else {
      relacion = leer(v.relacion, 'ratio', donde); // formato anterior (relación), por si llega sin pasar por restaurarPerfil
      if (relacion === null || relacion === NO_APLICA) continue;
    }
    const comisionPct = leer(v.comisionPct, 'percent', `${donde} · comisión`);
    const fijoDestino = leer(v.fijoDestino, 'money', `${donde} · costo fijo`);
    const desconocidos = [];
    if (comisionPct === null) desconocidos.push('comisión');
    if (fijoDestino === null) desconocidos.push('costo fijo');
    conversiones.set(`${v.desde}>${v.hacia}`, { relacion, hipotesis: v.hipotesis === true, comisionPct, fijoDestino, desconocidos });
  }
  return { monto: monto === NO_APLICA ? null : monto, mercados, conversiones, errores };
}
