// Explicación automática del resultado: frases armadas con los números de ESTA simulación, nunca texto genérico.
// Se apoya en una identidad que se prueba aparte (tests/engine/explicacion.test.mjs):
//   resultado neto = diferencia entre puntas (a cotización, antes de costos) − costos totales.
// Regla: lo incompleto o hipotético se dice como tal; nunca se presenta como ganancia firme.
import { ZERO, ONE, HUNDRED, toDec, round } from './decimal.mjs';
import { formatARS, formatARSSigned, formatNumberAR } from './format.mjs';

const pctDe = (parte, total) => (total.eq(0) ? ZERO : parte.div(total).times(HUNDRED));
/** "62 %", "1,5 %", "0,25 %": sin signo y con los decimales que hacen falta para no mostrar "0 %". */
function pctTxt(v) {
  const a = toDec(v).abs();
  const decimals = a.gte(10) ? 0 : a.gte(1) ? 1 : 2;
  return `${formatNumberAR(round(a, decimals), { decimals, minDecimals: 0 })} %`;
}
const lista = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`);

/** Costos de la calculadora simple, en pesos, del más grande al más chico (suman `costosTotales`). */
export function componentesSimple(x) {
  return [
    ['las comisiones', x.comisionCompra.plus(x.comisionVenta)],
    ['el IVA u otro % sobre las comisiones', x.ivaCompra.plus(x.ivaVenta)],
    ['los impuestos sobre la compra', x.impuestoCompra],
    ['los costos fijos en pesos', x.fijos.suma_capital.plus(x.fijos.descuenta_recibido)],
    ['los costos que se descuentan en unidades (transferencias)', x.costoTransferenciaUnidadesARS],
    ['el slippage', x.costoSlippage],
  ].map(([nombre, monto]) => ({ nombre, monto })).filter((c) => c.monto.gt(0)).sort((a, b) => b.monto.cmp(a.monto));
}

/**
 * Frase principal común a los dos simuladores.
 * @param {{D: *, C: *, N: *, nivel: string, fmt: (v: *) => string, fmtSigno: (v: *) => string, sujeto: string,
 *   diferencia: string, porQueNegativa: string, mayor: string}} p
 */
function principal({ D, C, N, nivel, fmt, fmtSigno, sujeto, diferencia, porQueNegativa, mayor }) {
  const incompleto = nivel === 'incompleto';
  const costos = incompleto ? 'los costos conocidos' : 'los costos';
  const pre = nivel === 'estimado' ? 'Con tus supuestos, ' : '';
  const may = (s) => (pre ? s : s[0].toUpperCase() + s.slice(1));
  if (D.eq(0) && C.eq(0)) return `${pre}${may(`${diferencia} es cero y no hay costos: no ganás ni perdés`)}.`;
  if (D.lte(0)) {
    return `${pre}${may(`${sujeto} pierde porque ${porQueNegativa}: ${fmtSigno(D)} antes de costos`)}${C.gt(0) ? `, y ${costos} (${fmt(C)}) agrandan la pérdida` : ''}.${mayor}`;
  }
  if (N.lt(0)) {
    return `${pre}${may(`${sujeto} genera una pérdida porque ${diferencia} (${fmtSigno(D)}) no alcanza para cubrir ${costos} (${fmt(C)}): faltan ${fmt(N.abs())}`)}.${mayor}`;
  }
  if (N.eq(0)) {
    return `${pre}${may(`${costos} (${fmt(C)}) se comen exactamente ${diferencia} (${fmtSigno(D)}): no ganás ni perdés`)}.${mayor}`;
  }
  const sin = incompleto ? 'sin contar los costos que faltan, ' : '';
  if (C.eq(0)) {
    return `${pre}${may(`${sin}${sujeto} gana porque ${diferencia} es ${fmtSigno(D)}${incompleto ? '' : ' y no hay costos (los declaraste en 0 o «no aplica»)'}`)}.`;
  }
  return `${pre}${may(`${sin}${sujeto} gana porque ${diferencia} (${fmtSigno(D)}) supera ${costos} (${fmt(C)}): los costos se llevan ${pctTxt(pctDe(C, D))} de esa diferencia`)}.${mayor}`;
}

/** Frase sobre los costos que faltan: con ellos el resultado sólo puede empeorar. */
function fraseIncompleto(calidad, N, fmt, sujeto = 'la operación') {
  const k = calidad.desconocidos?.length ?? 0;
  if (calidad.nivel !== 'incompleto' || !k) return null;
  const que = k === 1 ? `Falta 1 costo (${calidad.desconocidos[0].texto ?? calidad.desconocidos[0].etiqueta})` : `Faltan ${k} costos`;
  if (N.lt(0)) return `${que}: aun sin ${k === 1 ? 'él' : 'ellos'} ya pierde, así que con ${k === 1 ? 'él' : 'ellos'} la pérdida sólo puede ser mayor.`;
  return `${que}: si ${k === 1 ? 'ese costo suma' : 'esos costos suman'} más de ${fmt(N)}, ${sujeto} pierde.`;
}

/**
 * Explicación del resultado de la calculadora simple.
 * @param {object} r  salida de calcularSimple
 * @param {{mismoMercado?: boolean, unidadOrigen?: string, unidadDestino?: string}} [opts]
 * @returns {string[]|null} frases (null si no hay resultado: ahí manda el bloque de DATOS INSUFICIENTES)
 */
export function explicarSimple(r, { mismoMercado = false, unidadOrigen = 'USD', unidadDestino = 'USD' } = {}) {
  if (!r?.ok || !r.result) return null;
  const x = r.result;
  const v = r.values ?? {};
  const nivel = r.calidad.nivel;
  const D = x.ingresoBruto.minus(x.compra);
  const C = x.costosTotales;
  const N = x.resultadoNeto;
  const R = toDec(v.relacionConversion ?? 1);
  const V = toDec(v.precioVenta);
  const comps = componentesSimple(x);
  const mayor = comps.length && C.gt(0) ? ` Lo que más pesa: ${comps[0].nombre} (${formatARS(comps[0].monto)}, ${pctTxt(pctDe(comps[0].monto, C))} de los costos).` : '';
  const porQueNegativa = mismoMercado
    ? `comprás y vendés en el mismo mercado: pagás la punta de venta (${formatARS(x.precioCompraFinal)}) y cobrás la de compra (${formatARS(V)}), así que la diferencia entre puntas ya juega en contra`
    : `lo que cobrás al vender no supera lo que pagás al comprar${R.eq(1) ? '' : ' (con la conversión)'}`;
  const frases = [principal({ D, C, N, nivel, fmt: formatARS, fmtSigno: formatARSSigned, sujeto: 'la operación', diferencia: 'la diferencia entre puntas', porQueNegativa, mayor })];

  // Efecto de la conversión entre instrumentos (sólo si tiene costo o te dan de más). Se dice en %, como se carga.
  if (v.requiereConversion && !R.eq(1)) {
    const efecto = x.cantidadOrigen.times(R.minus(ONE)).times(V);
    const p = pctTxt(R.minus(ONE).times(HUNDRED));
    frases.push(R.lt(1)
      ? `Al pasar de ${unidadOrigen} a ${unidadDestino} te cobran ${p}: recibís ${p} menos, y eso resta ${formatARS(efecto.abs())} a la diferencia entre puntas.`
      : `Al pasar de ${unidadOrigen} a ${unidadDestino} te dan ${p} de más: eso suma ${formatARS(efecto)} a la diferencia entre puntas.`);
  }
  const inc = fraseIncompleto(r.calidad, N, formatARS);
  if (inc) frases.push(inc);

  // Hasta dónde puede moverse el precio de venta
  const eq = x.objetivosPrecio?.[0];
  if (eq?.precio && eq.margenSeguridadPct) {
    const conocidos = nivel === 'incompleto' ? ' (con los costos conocidos)' : '';
    if (N.gt(0)) frases.push(`El precio de venta puede bajar hasta ${formatARS(eq.precio)} por ${unidadDestino} (${pctTxt(eq.margenSeguridadPct)} menos que hoy) antes de perder${conocidos}.`);
    else if (N.lt(0)) frases.push(`Para no perder tendrías que vender a ${formatARS(eq.precio)} por ${unidadDestino} o más${conocidos}: un ${pctTxt(eq.margenSeguridadPct)} más que hoy (${formatARS(V)}).`);
  }
  // Una hipótesis se dice siempre, aunque además falten costos (incompleto).
  if (r.calidad.hipotesis?.length) {
    frases.push(fraseHipotesis(r.calidad.hipotesis));
  }
  const fis = fraseFiscal(x.fiscal, x.resultadoEconomico, N, formatARS, formatARSSigned);
  if (fis) frases.push(fis);
  return frases;
}

const fraseHipotesis = (hs) => (hs.length === 1
  ? `Usa un supuesto tuyo (${hs[0].texto}): confirmalo antes de usar este número.`
  : `Usa supuestos tuyos (${lista(hs.map((h) => h.texto))}): confirmalos antes de usar este número.`);

function fraseFiscal(fiscal, eco, N, fmt, fmtSigno) {
  if (!fiscal || !eco) return null;
  const rec = fiscal.recuperables ?? ZERO;
  const pend = fiscal.pendientes ?? ZERO;
  if (rec.gt(0)) {
    const valor = toDec(eco.min).eq(eco.max) ? fmtSigno(eco.min) : `entre ${fmtSigno(eco.min)} y ${fmtSigno(eco.max)}`;
    return `${fmt(rec)} de impuestos los marcaste como recuperables: salen de la caja, pero si los podés computar el resultado económico es ${valor}.`;
  }
  if (pend.gt(0)) return `Hay ${fmt(pend)} de impuestos con tratamiento pendiente: si resultaran recuperables, el resultado económico mejoraría hasta ${fmtSigno(N.plus(pend))}.`;
  return null;
}

/**
 * Explicación del resultado del simulador por pasos.
 * @param {object} sim salida de simularRuta
 * @param {{nombre?: (id: string) => string, monto?: (v: *, id: string) => string, montoConSigno?: (v: *, id: string) => string}} [fmt]
 */
export function explicarRuta(sim, { nombre = (id) => id, monto = (v, id) => `${formatNumberAR(v, { decimals: 2 })} ${id}`, montoConSigno = (v, id) => `${toDec(v).gt(0) ? '+' : ''}${formatNumberAR(v, { decimals: 2 })} ${id}` } = {}) {
  if (!sim?.ok || !sim.result) return null;
  const r = sim.result;
  const ini = r.activoInicial;
  const nivel = sim.calidad.nivel;
  const frases = [];

  // Pérdida de cada paso contra su cotización de referencia (costos, spread, slippage, libro y redondeo).
  const perdidas = r.pasos.map((p, i) => {
    if (!p.teoricoEntrada || p.teoricoEntrada.lte(0)) return { i, pct: ZERO };
    const teorico = p.teoricoSalida.div(p.teoricoEntrada).times(p.entregado);
    return { i, pct: teorico.lte(0) ? ZERO : ONE.minus(p.recibido.div(teorico)).times(HUNDRED), p };
  });
  const peor = perdidas.reduce((a, b) => (b.pct.gt(a.pct) ? b : a), perdidas[0]);
  let frasePaso = '';
  if (peor?.pct.gt(0)) {
    const p = r.pasos[peor.i];
    frasePaso = r.pasos.length > 1
      ? ` El paso más caro es el ${peor.i + 1} (${nombre(p.desde)} → ${nombre(p.hacia)}): entre costos, spread y slippage se pierde ${pctTxt(peor.pct)} de lo que entra en ese paso.`
      : ` Entre costos, spread y slippage se pierde ${pctTxt(peor.pct)} de lo que entra.`;
  }

  if (!r.mismoActivo) {
    frases.push(`La ruta termina en ${nombre(r.activoFinal)}, no en ${nombre(ini)}: sin un paso de vuelta no se puede decir si gana o pierde. Recibís ${monto(r.montoFinal, r.activoFinal)} a cambio de ${monto(r.capitalInvertido, ini)}.${frasePaso}`);
  } else {
    const D = r.brutoTeorico.minus(r.montoInicial);
    const C = r.costosTotales;
    const N = r.resultadoNeto;
    const fmt = (v) => monto(v, ini);
    const fmtSigno = (v) => montoConSigno(v, ini);
    frases.push(principal({
      D, C, N, nivel, fmt, fmtSigno, sujeto: 'la ruta', diferencia: 'la diferencia entre las cotizaciones de los pasos',
      porQueNegativa: `las cotizaciones de los pasos, aun sin costos, no devuelven lo que ponés`, mayor: frasePaso,
    }));
    if (r.pagosAparte?.gt(0)) frases.push(`Los costos incluyen ${fmt(r.pagosAparte)} que pagás aparte (se suman al capital).`);
    const inc = fraseIncompleto(sim.calidad, N, fmt, 'la ruta');
    if (inc) frases.push(inc);
    const m = r.equilibrio?.margenSeguridadPct;
    if (m) {
      const conocidos = nivel === 'incompleto' ? ' (con los costos conocidos)' : '';
      if (N.gt(0)) frases.push(`La cotización del último paso puede empeorar hasta ${pctTxt(m)} antes de perder${conocidos}.`);
      else if (N.lt(0)) frases.push(`Para no perder, la cotización del último paso tendría que mejorar ${pctTxt(m)}${conocidos}.`);
    }
    const fis = fraseFiscal(r.fiscal, r.resultadoEconomico, N, fmt, fmtSigno);
    if (fis) frases.push(fis);
  }
  const conViolacion = r.pasos.filter((p) => p.violaciones?.length).map((p) => r.pasos.indexOf(p) + 1);
  if (conViolacion.length) frases.push(`Con este monto, ${conViolacion.length === 1 ? `el paso ${conViolacion[0]} no entra` : `los pasos ${lista(conViolacion.map(String))} no entran`} en los límites o la liquidez que cargaste.`);
  if (sim.calidad.hipotesis?.length) {
    frases.push(fraseHipotesis(sim.calidad.hipotesis));
  }
  return frases;
}
