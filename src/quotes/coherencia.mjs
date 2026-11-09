// Control de coherencia entre mercados: oficial, blue, MEP, CCL y cripto.
// Una diferencia entre mercados NO es necesariamente un error (cada mercado tiene sus características):
// las alertas explican y sugieren revisar; NUNCA se modifica un precio.
// Veredicto por mercado: confiable · revisar · no_usar. Sólo "no_usar" deja de usarse sola (podés cargarla a mano).
import { IDS_MERCADOS, mercadoPorId } from './markets.mjs';
import { UMBRAL_SPREAD_PCT, UMBRAL_SALTO_PCT, textoProblema } from './calidad.mjs';

/** Umbrales (configurables desde la app). */
export const UMBRALES_COHERENCIA = {
  alejadoPct: 50, // más de este % arriba o abajo de la mediana de los otros mercados: revisar
  incompatibleVeces: 5, // 5 veces más o menos que la mediana: no usar
  fechasHoras: 24, // datos con más de esto de diferencia entre sí: no compararlos directamente
  contrastePct: 3, // diferencia con tu otra fuente que merece revisión
};

const NIVELES = { info: 0, revisar: 1, no_usar: 2 };
const VEREDICTO = ['confiable', 'revisar', 'no_usar'];

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const mediana = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const pct1 = (x) => (x >= 1e6 ? 'más de 1.000.000 %' : `${(Math.round(x * 10) / 10).toLocaleString('es-AR')} %`);
/** "12,3", "1.250": formato argentino y nunca notación científica (un precio absurdo cargado a mano puede dar 10⁹²). */
const vecesTxt = (x) => (x >= 1e6 ? 'más de un millón de' : (Math.round(x * 10) / 10).toLocaleString('es-AR'));
/** Porcentaje chico de la mediana: "20 %", "0,5 %", o "menos del 0,1 %". */
const pctDeMediana = (x) => (x < 0.1 ? 'menos del 0,1 %' : `el ${(Math.round(x * 10) / 10).toLocaleString('es-AR')} %`);

/**
 * @param {Record<string, {compra: string|null, venta: string|null, valido: boolean, problemas?: string[], fechaFuente?: string|null, origen?: string}>} mercados
 * @param {{contraste?: Record<string, {compra?: *, venta?: *, fuente?: string}>, umbrales?: typeof UMBRALES_COHERENCIA}} [opts]
 * @returns {{porMercado: Record<string, {veredicto: 'confiable'|'revisar'|'no_usar', alertas: Array<{codigo: string, nivel: 'info'|'revisar'|'no_usar', texto: string}>}>, generales: Array<{codigo: string, nivel: string, texto: string}>}}
 */
export function controlarCoherencia(mercados, { contraste = {}, umbrales = UMBRALES_COHERENCIA } = {}) {
  const porMercado = {};
  const generales = [];
  const medio = {};
  for (const id of IDS_MERCADOS) {
    const m = mercados?.[id];
    const alertas = [];
    porMercado[id] = { alertas };
    if (!m || (!m.compra && !m.venta)) { alertas.push({ codigo: 'sin_dato', nivel: 'info', texto: 'Sin cotización.' }); continue; }
    if (m.valido === false) {
      const invalidan = (m.problemas ?? []).map(textoProblema).join('; ') || 'dato inválido';
      alertas.push({ codigo: 'invalido', nivel: 'no_usar', texto: `La fuente informó un dato que no se puede usar: ${invalidan}.` });
    }
    const c = num(m.compra);
    const v = num(m.venta);
    if (c && v && v < c) alertas.push({ codigo: 'puntas_invertidas', nivel: 'no_usar', texto: 'La venta es menor que la compra (puntas invertidas).' });
    if (c && v && v >= c && ((v / c - 1) * 100 > UMBRAL_SPREAD_PCT)) alertas.push({ codigo: 'spread', nivel: 'revisar', texto: `La diferencia entre compra y venta es de ${pct1((v / c - 1) * 100)}: inusualmente grande.` });
    if ((m.problemas ?? []).includes('salto_brusco')) alertas.push({ codigo: 'salto', nivel: 'revisar', texto: `Cambió más de ${UMBRAL_SALTO_PCT} % contra el dato anterior.` });
    if (m.valido !== false && (c || v)) medio[id] = c && v ? (c + v) / 2 : c ?? v;
  }

  // Comparación con los otros mercados (mediana de los demás: un solo dato raro no arrastra la referencia)
  const ids = Object.keys(medio);
  if (ids.length >= 3) {
    for (const id of ids) {
      const otros = ids.filter((x) => x !== id).map((x) => medio[x]);
      const ref = mediana(otros);
      const r = medio[id] / ref;
      const veces = r >= 1 ? r : 1 / r;
      const alertas = porMercado[id].alertas;
      if (veces >= umbrales.incompatibleVeces) {
        const exp = Math.log10(veces);
        const escala = Math.abs(exp - Math.round(exp)) < 0.06 && Math.round(exp) >= 1;
        alertas.push(escala
          ? { codigo: 'escala', nivel: 'no_usar', texto: `Parece un error de escala: es ${vecesTxt(Math.round(veces))} veces ${r >= 1 ? 'la mediana' : 'menor que la mediana'} de los otros mercados (¿falta o sobra un cero?).` }
          : { codigo: 'incompatible', nivel: 'no_usar', texto: `Es ${r >= 1 ? `${vecesTxt(veces)} veces la mediana` : `${pctDeMediana(100 / veces)} de la mediana`} de los otros mercados: incompatible con el resto.` });
      } else if (Math.abs(r - 1) * 100 > umbrales.alejadoPct) {
        alertas.push({ codigo: 'alejado', nivel: 'revisar', texto: `Está ${pct1(Math.abs(r - 1) * 100)} ${r > 1 ? 'arriba' : 'abajo'} de la mediana de los otros mercados. Puede ser real (cada mercado es distinto), pero revisalo.` });
      }
    }
  } else if (ids.length) {
    generales.push({ codigo: 'pocos_datos', nivel: 'info', texto: 'Hay menos de 3 mercados con datos: no se puede comparar cada uno contra el resto.' });
  }

  // Fechas muy distintas entre sí: no conviene compararlas directamente
  const fechas = IDS_MERCADOS.map((id) => [id, Date.parse(mercados?.[id]?.origen === 'manual' ? mercados[id].editadoAt ?? '' : mercados?.[id]?.fechaFuente ?? '')]).filter(([, t]) => !Number.isNaN(t));
  if (fechas.length >= 2) {
    const max = Math.max(...fechas.map(([, t]) => t));
    for (const [id, t] of fechas) {
      const h = (max - t) / 3600e3;
      if (h > umbrales.fechasHoras) porMercado[id].alertas.push({ codigo: 'otra_fecha', nivel: 'info', texto: `Su dato es ${Math.round(h)} h más viejo que el más nuevo: compararlo con los otros mercados mezcla momentos distintos.` });
    }
  }

  // Fuente independiente cargada por vos
  for (const id of IDS_MERCADOS) {
    const k = contraste?.[id];
    const m = mercados?.[id];
    if (!k || !m) continue;
    for (const punta of ['compra', 'venta']) {
      const a = num(m[punta]);
      const b = num(k[punta]);
      if (!a || !b) continue;
      const d = (a / b - 1) * 100;
      if (Math.abs(d) > umbrales.contrastePct) porMercado[id].alertas.push({ codigo: 'contraste', nivel: 'revisar', texto: `${punta === 'compra' ? 'Compra' : 'Venta'}: difiere ${pct1(Math.abs(d))} de tu otra fuente${k.fuente ? ` (${k.fuente})` : ''}.` });
    }
  }

  for (const id of IDS_MERCADOS) {
    const peor = Math.max(0, ...porMercado[id].alertas.map((a) => NIVELES[a.nivel] ?? 0));
    porMercado[id].veredicto = VEREDICTO[peor];
    porMercado[id].nombre = mercadoPorId(id).nombre;
  }
  return { porMercado, generales };
}

/** Valida las fuentes de contraste guardadas (precios de otra fuente que cargaste vos). */
export function restaurarContraste(g) {
  const out = {};
  if (!g || typeof g !== 'object') return out;
  for (const id of IDS_MERCADOS) {
    const k = g[id];
    if (!k || typeof k !== 'object') continue;
    const txt = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
    out[id] = { compra: txt(k.compra, 40), venta: txt(k.venta, 40), fuente: txt(k.fuente, 60) };
  }
  return out;
}
