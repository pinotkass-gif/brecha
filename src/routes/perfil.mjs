// Perfil de costos para la vista de resultado neto: costos por mercado y conversiones entre instrumentos.
// Vacío = NO SÉ (el resultado queda incompleto, como cota máxima). "no aplica" = ese costo no existe.
// 0 = sin costo, confirmado. Una conversión que no cargaste NO se supone 1:1: la combinación queda en
// "datos insuficientes" hasta que la cargues (o la cargues como hipótesis, y entonces es un ESTIMADO).
import { parseNumberAR } from '../engine/format.mjs';
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
export const CAMPOS_CONVERSION = [
  { k: 'relacion', label: 'Relación', kind: 'ratio' },
  { k: 'comisionPct', label: 'Comisión %', kind: 'percent' },
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
  return { id: nuevoId('v'), desde, hacia, relacion: '', hipotesis: false, comisionPct: '', fijoDestino: '' };
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
        id: txt(v.id) || nuevoId('v'), desde: v.desde, hacia: v.hacia, relacion: txt(v.relacion), hipotesis: v.hipotesis === true,
        comisionPct: txt(v.comisionPct), fijoDestino: txt(v.fijoDestino),
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
    const relacion = leer(v.relacion, 'ratio', donde);
    const comisionPct = leer(v.comisionPct, 'percent', `${donde} · comisión`);
    const fijoDestino = leer(v.fijoDestino, 'money', `${donde} · costo fijo`);
    // Sin relación la conversión no está cargada: la combinación queda en datos insuficientes.
    if (relacion === null || relacion === NO_APLICA) continue;
    const desconocidos = [];
    if (comisionPct === null) desconocidos.push('comisión');
    if (fijoDestino === null) desconocidos.push('costo fijo');
    conversiones.set(`${v.desde}>${v.hacia}`, { relacion, hipotesis: v.hipotesis === true, comisionPct, fijoDestino, desconocidos });
  }
  return { monto: monto === NO_APLICA ? null : monto, mercados, conversiones, errores };
}
