// Cuentas sobre el histórico diario (ArgentinaDatos) y la respuesta del chat, armada SÓLO con esos datos.
// Decimales exactos (big.js). La brecha compara precios de cierre: no es ganancia.
import { toDec, ZERO, ONE, HUNDRED } from '../engine/decimal.mjs';
import { formatARS, formatNumberAR, formatPct } from '../engine/format.mjs';
import { MERCADOS_HIST } from './preguntas.mjs';

const fmtFecha = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const fmtFechaCorta = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const nombre = (id) => MERCADOS_HIST[id]?.nombre ?? id;
const pct = (v) => formatPct(v, { decimals: 2 });
const pctSinSigno = (v) => formatPct(v, { decimals: 2, signed: false });
const puntos = (v) => `${formatNumberAR(toDec(v).abs(), { decimals: 2 })} puntos`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Precios de un mercado en el período: [{fecha, valor: Dec}]. */
export function seriePrecio(filas, punta, desde, hasta) {
  return filas.filter((f) => f.fecha >= desde && f.fecha <= hasta).map((f) => ({ fecha: f.fecha, valor: toDec(String(f[punta])) }));
}

/** Brecha de `otro` respecto de `base` cada día que hay dato de los dos: (otro / base − 1) × 100. */
export function serieBrecha(filasBase, filasOtro, punta, desde, hasta) {
  const base = new Map(filasBase.filter((f) => f.fecha >= desde && f.fecha <= hasta).map((f) => [f.fecha, toDec(String(f[punta]))]));
  const out = [];
  for (const f of filasOtro) {
    if (f.fecha < desde || f.fecha > hasta || !base.has(f.fecha)) continue;
    out.push({ fecha: f.fecha, valor: toDec(String(f[punta])).div(base.get(f.fecha)).minus(ONE).times(HUNDRED) });
  }
  return out;
}

/** Inicio, fin, máximo, mínimo (el primero que lo alcanza), promedio y variación. null si no hay datos. */
export function resumen(serie) {
  if (!serie.length) return null;
  let max = serie[0];
  let min = serie[0];
  let suma = ZERO;
  for (const p of serie) {
    if (p.valor.gt(max.valor)) max = p;
    if (p.valor.lt(min.valor)) min = p;
    suma = suma.plus(p.valor);
  }
  const inicio = serie[0];
  const fin = serie.at(-1);
  return {
    n: serie.length, inicio, fin, max, min, promedio: suma.div(serie.length),
    variacion: fin.valor.minus(inicio.valor),
    variacionPct: inicio.valor.eq(0) ? null : fin.valor.div(inicio.valor).minus(ONE).times(HUNDRED),
  };
}

/** Promedio, máximo y mínimo de cada mes. */
export function porMes(serie) {
  const grupos = new Map();
  for (const p of serie) {
    const k = p.fecha.slice(0, 7);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  return [...grupos].map(([mes, ps]) => ({ mes, ...resumen(ps) }));
}

/** El dato de un día; si ese día no hay (fin de semana o feriado), el último anterior (hasta 7 días antes). */
export function datoDelDia(filas, fecha) {
  let mejor = null;
  for (const f of filas) {
    if (f.fecha > fecha) break;
    mejor = f;
  }
  if (!mejor) return null;
  const dias = (Date.parse(fecha) - Date.parse(mejor.fecha)) / 864e5;
  return dias > 7 ? null : { fila: mejor, exacto: mejor.fecha === fecha };
}

/** Hasta `max` puntos para el gráfico (siempre con el primero y el último). */
function reducir(serie, max = 240) {
  if (serie.length <= max) return serie;
  const paso = serie.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(serie[Math.floor(i * paso)]);
  out.push(serie.at(-1));
  return out;
}
const aPuntos = (serie) => reducir(serie).map((p) => ({ fecha: p.fecha, valor: Number(p.valor.round(4).toString()) }));

/**
 * Respuesta a una consulta (de interpretar()) con el histórico de cada mercado.
 * @param {object} c consulta  @param {Record<string, Array<{fecha: string, compra: number, venta: number}>>} datos filas por mercado (ordenadas)
 * @returns {{ok: true, frases: string[], tabla: {cabeza: string[], filas: string[][]}|null, series: Array, unidad: string, avisos: string[]} | {ok: false, frases: string[]}}
 */
export function responder(c, datos) {
  const avisos = [...c.supuestos];
  const p = c.periodo;
  const punta = c.punta;
  const deLaPunta = `precio de ${punta}`;
  // Disponibilidad: desde cuándo hay datos de cada mercado
  let desde = p.desde;
  for (const id of c.mercados) {
    const filas = datos[id] ?? [];
    if (!filas.length) return { ok: false, frases: [`No tengo el histórico de ${nombre(id)}.`] };
    if (filas[0].fecha > desde && !p.dia) {
      if (filas[0].fecha > p.hasta) return { ok: false, frases: [`Hay datos de ${nombre(id)} recién desde el ${fmtFecha(filas[0].fecha)}: no hay nada para ${p.texto}.`] };
      if (p.desde !== '2000-01-01') avisos.push(`Hay datos de ${nombre(id)} desde el ${fmtFecha(filas[0].fecha)}: tomé desde ahí.`);
      desde = filas[0].fecha;
    }
  }
  const ultimo = c.mercados.map((id) => datos[id].at(-1).fecha).sort()[0];
  if (p.hasta > ultimo && !p.dia) avisos.push(`El último dato es del ${fmtFecha(ultimo)} (es la cotización de cierre de cada día).`);

  return p.dia ? responderDia(c, datos, avisos) : c.dato === 'brecha' ? responderBrecha(c, datos, desde, avisos, deLaPunta) : responderPrecio(c, datos, desde, avisos);
}

function responderDia(c, datos, avisos) {
  const fecha = c.periodo.desde;
  const filas = {};
  for (const id of c.mercados) {
    const d = datoDelDia(datos[id], fecha);
    if (!d) return { ok: false, frases: [`No hay dato de ${nombre(id)} para el ${fmtFecha(fecha)} ni para los 7 días anteriores.`] };
    filas[id] = d;
    if (!d.exacto) avisos.push(`No hay dato de ${nombre(id)} del ${fmtFecha(fecha)} (fin de semana o feriado): uso el del ${fmtFecha(d.fila.fecha)}.`);
  }
  const frases = [];
  if (c.dato === 'brecha') {
    const b = filas[c.base].fila;
    for (const id of c.mercados.filter((x) => x !== c.base)) {
      const o = filas[id].fila;
      const v = toDec(String(o[c.punta])).div(toDec(String(b[c.punta]))).minus(ONE).times(HUNDRED);
      frases.push(`El ${fmtFecha(o.fecha)} la brecha de ${nombre(id)} contra ${nombre(c.base)} fue de ${pct(v)} (precio de ${c.punta}: ${nombre(id)} ${formatARS(o[c.punta])}, ${nombre(c.base)} ${formatARS(b[c.punta])}).`);
    }
  } else {
    for (const id of c.mercados) {
      const f = filas[id].fila;
      frases.push(`El ${fmtFecha(f.fecha)} el ${nombre(id)} cerró a ${formatARS(f.compra)} la compra y ${formatARS(f.venta)} la venta.`);
    }
  }
  return { ok: true, frases, tabla: null, series: [], unidad: '', avisos };
}

function responderBrecha(c, datos, desde, avisos, deLaPunta) {
  const otros = c.mercados.filter((x) => x !== c.base);
  const series = [];
  const frases = [];
  let tabla = null;
  for (const id of otros) {
    const s = serieBrecha(datos[c.base], datos[id], c.punta, desde, c.periodo.hasta);
    const r = resumen(s);
    const titulo = `${nombre(id)} contra ${nombre(c.base)}`;
    if (!r) { frases.push(`No hay días con datos de ${nombre(id)} y ${nombre(c.base)} a la vez ${c.periodo.texto}.`); continue; }
    series.push({ id, nombre: titulo, puntos: aPuntos(s) });
    const rango = `${fmtFecha(r.inicio.fecha)} al ${fmtFecha(r.fin.fecha)}`;
    const mov = r.variacion.gt(0) ? `subió ${puntos(r.variacion)}` : r.variacion.lt(0) ? `bajó ${puntos(r.variacion)}` : 'quedó igual';
    const linea = {
      resumen: `La brecha ${titulo} (${deLaPunta}) ${c.periodo.texto} fue en promedio de ${pct(r.promedio)}. Arrancó en ${pct(r.inicio.valor)} (${fmtFecha(r.inicio.fecha)}) y terminó en ${pct(r.fin.valor)} (${fmtFecha(r.fin.fecha)}): ${mov}.`,
      maximo: `La brecha ${titulo} más alta ${c.periodo.texto} fue de ${pct(r.max.valor)}, el ${fmtFecha(r.max.fecha)}.`,
      minimo: `La brecha ${titulo} más baja ${c.periodo.texto} fue de ${pct(r.min.valor)}, el ${fmtFecha(r.min.fecha)}.`,
      promedio: `La brecha ${titulo} promedió ${pct(r.promedio)} ${c.periodo.texto} (${r.n} días, ${rango}).`,
      variacion: `La brecha ${titulo} ${mov} ${c.periodo.texto}: de ${pct(r.inicio.valor)} (${fmtFecha(r.inicio.fecha)}) a ${pct(r.fin.valor)} (${fmtFecha(r.fin.fecha)}).`,
    }[c.enfoque];
    frases.push(linea);
    if (c.enfoque !== 'resumen') frases.push(`Promedio ${pct(r.promedio)} · inicio ${pct(r.inicio.valor)} · fin ${pct(r.fin.valor)}.`);
    frases.push(`Máximo ${pct(r.max.valor)} el ${fmtFecha(r.max.fecha)} · mínimo ${pct(r.min.valor)} el ${fmtFecha(r.min.fecha)} (${r.n} días con datos de los dos).`);
    if (otros.length === 1) tabla = tablaMensual(s, (v) => pct(v), 'Brecha');
  }
  if (!series.length) return { ok: false, frases };
  frases.push('La brecha compara precios de cierre: no es una ganancia que se pueda hacer (faltan costos, conversiones y si la operación se puede hacer).');
  return { ok: true, frases, tabla, series, unidad: '%', avisos };
}

function responderPrecio(c, datos, desde, avisos) {
  const series = [];
  const frases = [];
  let tabla = null;
  for (const id of c.mercados) {
    const s = seriePrecio(datos[id], c.punta, desde, c.periodo.hasta);
    const r = resumen(s);
    if (!r) { frases.push(`No hay datos de ${nombre(id)} ${c.periodo.texto}.`); continue; }
    series.push({ id, nombre: nombre(id), puntos: aPuntos(s) });
    const de = `del ${nombre(id)} (${c.punta})`;
    const mov = r.variacion.gt(0) ? `subió ${pctSinSigno(r.variacionPct)} (${formatARS(r.variacion)})` : r.variacion.lt(0) ? `bajó ${pctSinSigno(r.variacionPct.abs())} (${formatARS(r.variacion.abs())})` : 'quedó igual';
    const linea = {
      resumen: `El precio ${de} ${c.periodo.texto} ${mov}: de ${formatARS(r.inicio.valor)} (${fmtFecha(r.inicio.fecha)}) a ${formatARS(r.fin.valor)} (${fmtFecha(r.fin.fecha)}).`,
      maximo: `El máximo ${de} ${c.periodo.texto} fue ${formatARS(r.max.valor)}, el ${fmtFecha(r.max.fecha)}.`,
      minimo: `El mínimo ${de} ${c.periodo.texto} fue ${formatARS(r.min.valor)}, el ${fmtFecha(r.min.fecha)}.`,
      promedio: `El promedio ${de} ${c.periodo.texto} fue ${formatARS(r.promedio)} (${r.n} días).`,
      variacion: `El precio ${de} ${c.periodo.texto} ${mov}: de ${formatARS(r.inicio.valor)} (${fmtFecha(r.inicio.fecha)}) a ${formatARS(r.fin.valor)} (${fmtFecha(r.fin.fecha)}).`,
    }[c.enfoque];
    frases.push(linea);
    frases.push(`Máximo ${formatARS(r.max.valor)} el ${fmtFecha(r.max.fecha)} · mínimo ${formatARS(r.min.valor)} el ${fmtFecha(r.min.fecha)} · promedio ${formatARS(r.promedio)}.`);
    if (c.mercados.length === 1) tabla = tablaMensual(s, (v) => formatARS(v), 'Precio');
  }
  if (!series.length) return { ok: false, frases };
  return { ok: true, frases, tabla, series, unidad: 'ARS', avisos };
}

/** Resumen por mes (sólo si el período abarca más de un mes). */
function tablaMensual(serie, fmt, titulo) {
  const meses = porMes(serie);
  if (meses.length < 2) return null;
  return {
    cabeza: ['Mes', `${titulo} promedio`, 'Máximo', 'Mínimo', 'Al cierre del mes'],
    filas: meses.map((m) => [`${MESES[Number(m.mes.slice(5)) - 1]} ${m.mes.slice(0, 4)}`, fmt(m.promedio), `${fmt(m.max.valor)} (${fmtFechaCorta(m.max.fecha)})`, `${fmt(m.min.valor)} (${fmtFechaCorta(m.min.fecha)})`, fmt(m.fin.valor)]),
  };
}

/** Lo que el chat responde cuando no entiende: qué sabe hacer y ejemplos. */
export function ayuda(motivo) {
  const que = {
    vacia: 'Escribí una pregunta sobre el histórico de los dólares.',
    sin_mercado: 'No encontré qué dólar te interesa.',
    brecha_sola: 'La brecha se mide entre dos dólares: decime contra cuál (por ejemplo «brecha del blue» o «brecha oficial cripto»).',
    futuro: 'Esa fecha todavía no pasó: el histórico llega hasta hoy.',
  }[motivo] ?? 'No entendí la pregunta.';
  return [que, 'Puedo responder sobre oficial, blue, MEP, CCL, cripto, mayorista y tarjeta: brecha entre dos, precio, máximo, mínimo, promedio, cuánto subió o bajó, y cuánto estaba un día. El período lo podés decir como «los últimos 3 meses», «en octubre», «este año», «del 1/8 al 15/9» o «ayer».'];
}
