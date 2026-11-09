// Piezas de interfaz compartidas por la calculadora simple y el simulador por pasos.
// Regla: lo incompleto o insuficiente nunca se muestra como si fuera un resultado completo.
import { formatNumberAR, formatARS, formatARSSigned, formatPct } from '../engine/format.mjs';
import { toDec, round } from '../engine/decimal.mjs';
import { esNoAplica, ETIQUETAS_NIVEL, TRATAMIENTOS } from '../engine/costos.mjs';
import { activoPorId, corto } from '../routes/activos.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Importe en un activo ("$ 1.000,00", "978,04 USDT"). */
export function monto(v, id = 'ARS') {
  if (v === null || v === undefined) return '—';
  if (id === 'ARS') return formatARS(v);
  return `${formatNumberAR(v, { decimals: activoPorId(id)?.decimales ?? 4, minDecimals: 2 })} ${corto(id)}`;
}
export function montoConSigno(v, id = 'ARS') {
  if (id === 'ARS') return formatARSSigned(v);
  const r = round(v, activoPorId(id)?.decimales ?? 4);
  return (r.gt(0) ? '+' : '') + monto(r, id);
}
export const numeroPrecio = (v) => formatNumberAR(v, { decimals: 4, minDecimals: 2 });

/**
 * Texto de estado de un costo según lo escrito: nunca deja que un vacío parezca un 0.
 * @param {string} raw lo que está escrito  @param {{ok: boolean, empty: boolean, value: *, error?: string}} parsed
 * @param {(v: *) => string} formato cómo mostrar el valor
 */
export function estadoCostoTexto(raw, parsed, formato) {
  if (esNoAplica(raw)) return { texto: 'No aplica: este costo no existe en la operación', clase: 'na' };
  if (!parsed.ok) return { texto: parsed.error, clase: 'bad' };
  if (parsed.empty) return { texto: 'No sé: cuenta como costo faltante (el resultado queda incompleto)', clase: 'nose' };
  if (parsed.value.eq(0)) return { texto: 'Confirmado en 0', clase: 'cero' };
  return { texto: `= ${formato(parsed.value)}`, clase: '' };
}

export const opcionesFiscal = (sel) => Object.entries(TRATAMIENTOS).map(([k, t]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');

/**
 * Bloque de calidad del resultado. Devuelve '' si los datos están completos.
 * @param {{nivel: string, insuficientes?: string[], desconocidos?: Array<{texto: string, campo: string}>, hipotesis?: Array<{texto: string}>}} calidad
 * @param {{botonNoAplica?: (d: object) => string, ayudaInsuficiente?: string, pie?: string}} [opts]  pie: HTML al final del bloque "incompleto"
 */
export function bloqueCalidad(calidad, { botonNoAplica = null, ayudaInsuficiente = '', pie = '' } = {}) {
  if (!calidad || calidad.nivel === 'completo') return '';
  if (calidad.nivel === 'insuficiente') {
    return `<div class="calidad insuf" role="alert" data-testid="calidad">
      <p class="res-title"><span aria-hidden="true">⛔</span> ${ETIQUETAS_NIVEL.insuficiente}</p>
      <p>No hay resultado: falta un dato indispensable. Brecha no inventa conversiones ni precios.</p>
      <ul>${(calidad.insuficientes ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${ayudaInsuficiente}</div>`;
  }
  if (calidad.nivel === 'incompleto') {
    const items = (calidad.desconocidos ?? []).map((d) => `<li><span>${esc(d.texto)}</span>${botonNoAplica ? botonNoAplica(d) : ''}</li>`).join('');
    return `<div class="calidad incompleto" data-testid="calidad">
      <p class="res-title"><span aria-hidden="true">◐</span> INCOMPLETO: faltan ${calidad.desconocidos.length} costos</p>
      <p>Los marcaste como "No sé" (o los dejaste vacíos): el resultado se calcula como si fueran 0, así que es <strong>como máximo</strong> lo que ves. Con esos costos va a ser menor.</p>
      <ul class="faltan-lista">${items}</ul>
      ${calidad.hipotesis?.length ? `<p>Además usa supuestos tuyos: ${calidad.hipotesis.map((h) => esc(h.texto)).join('; ')}.</p>` : ''}${pie}</div>`;
  }
  return `<div class="calidad estimado" data-testid="calidad">
    <p class="res-title"><span aria-hidden="true">≈</span> ${ETIQUETAS_NIVEL.estimado}</p>
    <p>El resultado depende de supuestos que cargaste vos:</p>
    <ul>${(calidad.hipotesis ?? []).map((h) => `<li>${esc(h.texto)}</li>`).join('')}</ul></div>`;
}

/** "Por qué da este resultado": frases armadas con los números de la simulación (src/engine/explicacion.mjs). */
export function bloqueExplicacion(frases) {
  if (!frases?.length) return '';
  return `<div class="explicacion" data-testid="explicacion"><p class="res-title">Por qué da este resultado</p>
    ${frases.map((f) => `<p>${esc(f)}</p>`).join('')}</div>`;
}

/** Prefijo del número principal según la calidad: "como máximo" o "estimado". */
export function prefijoResultado(nivel) {
  if (nivel === 'incompleto') return '<span class="pre">Como máximo</span> ';
  if (nivel === 'estimado') return '<span class="pre">Estimado</span> ';
  return '';
}

/**
 * Resultado económico (con créditos fiscales recuperables) al lado del de caja.
 * @param {{min: *, max: *, determinado: boolean}|null} eco  @param {*} caja  @param {object} fiscal
 */
export function bloqueEconomico(eco, caja, { activo = 'ARS', conceptos = [], noValuables = [] } = {}) {
  if (!eco) return '';
  const hayFiscal = conceptos.length || noValuables.length || !toDec(eco.min).eq(caja) || !toDec(eco.max).eq(caja);
  if (!hayFiscal) return '<p class="eco hint" data-desde="avanzado">Resultado económico = resultado de caja (no hay créditos fiscales que recuperar).</p>';
  const valor = toDec(eco.min).eq(eco.max) ? montoConSigno(eco.min, activo) : `entre ${montoConSigno(eco.min, activo)} y ${montoConSigno(eco.max, activo)}`;
  const det = eco.determinado ? '' : ' <span class="unit">(hay conceptos con tratamiento pendiente o sin valuar)</span>';
  const lista = conceptos.length ? `<ul class="fiscal">${conceptos.map((c) => `<li>${esc(c.concepto)}: ${monto(c.monto, c.activo ?? activo)} · ${esc(TRATAMIENTOS[c.fiscal] ?? c.fiscal)}</li>`).join('')}</ul>` : '';
  const nv = noValuables.length ? `<p class="hint">Sin valuar en ${esc(corto(activo))}: ${noValuables.map((c) => `${esc(c.concepto)} (${monto(c.monto, c.activo)})`).join(', ')}.</p>` : '';
  return `<div class="eco" data-testid="economico"><p>Resultado económico <strong>${valor}</strong>${det}</p>
    <p class="hint">Suma a la caja las percepciones, retenciones y pagos a cuenta que podrías computar. No es asesoramiento impositivo: depende de tu situación fiscal.</p>${lista}${nv}</div>`;
}

/**
 * Tabla de precios de salida necesarios (equilibrio, +1 %, +2 %, +5 %).
 * @param {Array<{objetivoPct: string, precio: *, diferencia?: *, margenSeguridadPct?: *}>} objetivos
 * @param {string} unidad "ARS por 1 USD"  @param {string} nivel calidad
 */
export function tablaObjetivos(objetivos, unidad, nivel = 'completo') {
  if (!objetivos?.length || !objetivos.some((o) => o.precio)) return '';
  const nombre = (g) => (g === '0' ? 'Para no perder (equilibrio)' : `Para ganar ${g} %`);
  const filas = objetivos.map((o) => `<tr><th scope="row">${nombre(o.objetivoPct)}</th>
    <td>${o.precio ? numeroPrecio(o.precio) : '—'}</td>
    <td>${o.diferencia ? formatNumberAR(o.diferencia, { decimals: 4, minDecimals: 2 }) : '—'}</td>
    <td>${o.margenSeguridadPct ? formatPct(o.margenSeguridadPct) : '—'}</td></tr>`).join('');
  const aviso = nivel === 'incompleto' ? '<p class="hint">Faltan costos: los precios reales necesarios son mayores que estos.</p>' : '';
  return `<details class="objetivos" data-testid="objetivos" data-desde="avanzado" open><summary>Precio de salida necesario <span class="unit">${esc(unidad)}</span></summary>
    <div class="table-wrap"><table class="breakdown"><thead><tr><th scope="col">Objetivo</th><th scope="col">Precio</th><th scope="col">Precio actual − necesario</th><th scope="col">Margen de seguridad</th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    <p class="hint">Con todos los costos cargados (fijos, %, mínimos y redondeos). Margen de seguridad: cuánto puede empeorar el precio de salida antes de no llegar al objetivo; si es negativo, hoy no llega.</p>${aviso}</details>`;
}

/** Clase de color de un número según la calidad: lo incompleto o estimado no se pinta como ganancia firme. */
export const tono = (v, nivel = 'completo') => {
  // Incompleto: el número es una cota máxima. Si aun así pierde, la pérdida es segura; si gana, no se sabe.
  if (nivel === 'incompleto') return v.lt(0) ? 'neg' : 'neu';
  if (nivel !== 'completo') return 'neu';
  return v.gt(0) ? 'pos' : v.lt(0) ? 'neg' : 'neu';
};

/** Título del resultado según el signo y la calidad de los datos. */
export function tituloResultado(estado, nivel) {
  if (nivel === 'incompleto') {
    return estado === 'perdida'
      ? { t: 'Pérdida segura (aunque los costos que faltan fueran 0)', i: '▼' }
      : { t: 'Resultado sin los costos que faltan', i: '◐' };
  }
  if (nivel === 'estimado') return { t: estado === 'ganancia' ? 'Ganancia estimada' : estado === 'perdida' ? 'Pérdida estimada' : 'Sin ganancia ni pérdida (estimado)', i: '≈' };
  return {
    ganancia: { t: 'Ganancia neta', i: '▲' },
    perdida: { t: 'Pérdida neta', i: '▼' },
    neutro: { t: 'Sin ganancia ni pérdida', i: '●' },
  }[estado];
}
