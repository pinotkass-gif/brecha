// Simulación desde el chat: "consigo el oficial a 1535 y compro USDT al 2 %: ¿cómo salgo si vendo?".
// Entiende precio de compra, el % que te cobran al pasar de un dólar a otro, precio o mercado de venta y monto, y calcula
// con el MISMO motor que la calculadora (calcularSimple), así que los números dan igual. Lo que no dijiste no se inventa:
// los precios que faltan son los de hoy (y lo dice), y las comisiones que no nombraste quedan como "No sé" (cota máxima).
import { mercadosConPosicion } from '../historico/preguntas.mjs';
import { parseNumberAR, formatARS, formatARSSigned, formatNumberAR, formatPct } from '../engine/format.mjs';
import { toDec, ONE } from '../engine/decimal.mjs';
import { calcularSimple } from '../engine/simple.mjs';
import { relacionDesdePct } from '../engine/conversion.mjs';
import { explicarSimple } from '../engine/explicacion.mjs';

/** Mercados de la calculadora (los demás del histórico no se operan acá). */
export const MERCADOS_CALCULADORA = { oficial: 'Oficial', blue: 'Blue', mep: 'MEP', ccl: 'CCL', cripto: 'Cripto' };
const COMO_SE_DICE = { oficial: 'dólar oficial', blue: 'dólar blue', mep: 'dólar MEP', ccl: 'dólar CCL', cripto: 'USDT/USDC' };
const UNIDAD = { oficial: 'USD', blue: 'USD', mep: 'USD', ccl: 'USD', cripto: 'USDT/USDC' };

const VENDER = /\b(vendo|vender|vendiendo|vendes|vendemos|lo vendo|los vendo|salgo|salis|salir|gano|ganaria|gananc\w*|pierdo|perderia|me queda|me quedan|cuanto saco)\b/;
const NUMERO = /\$?\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/g;

/**
 * Minúsculas y sin tildes, pero conservando la coma y el punto DENTRO de los números ("1,5 %", "1.535,50"):
 * el normalizar del histórico borra las comas y "1,5 %" quedaría "1 5 %" (regresión encontrada en las pruebas).
 */
export function normalizarEscenario(texto) {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(?=\d)/g, '$1\u0001').replace(/(\d)\.(?=\d)/g, '$1\u0002') // protege los separadores entre dígitos
    .replace(/[¿?¡!,;:"'()]/g, ' ').replace(/\./g, ' ')
    .replace(/\u0001/g, ',').replace(/\u0002/g, '.')
    .replace(/\s+/g, ' ').trim();
}

/** ¿Es una pregunta de "qué pasa si opero así"? (las del histórico no dicen vendo / salgo / gano, ni compro). */
export const esEscenario = (texto) => {
  const t = normalizarEscenario(texto);
  return VENDER.test(t) && (/\d/.test(t) || /\b(compro|comprar|comprando|consigo|paso|pasar)\b/.test(t));
};

/**
 * @returns {{ok: true, esc: object} | {ok: false, motivo: string} | null}  null = no es una simulación
 */
export function interpretarEscenario(texto) {
  const t = normalizarEscenario(texto);
  if (!esEscenario(texto)) return null;
  const mercados = mercadosConPosicion(t).filter((m) => m.id in MERCADOS_CALCULADORA);
  const otros = mercadosConPosicion(t).filter((m) => !(m.id in MERCADOS_CALCULADORA));
  if (!mercados.length) return { ok: false, motivo: otros.length ? 'mercado_no_operable' : 'sin_mercado' };
  const posVenta = VENDER.exec(t).index;

  // Números: porcentajes, montos y precios (con su posición)
  const pcts = [];
  const precios = [];
  let monto = null;
  for (const m of t.matchAll(NUMERO)) {
    const crudo = m[1];
    const fin = m.index + m[0].length;
    const despues = t.slice(fin, fin + 16);
    const ini = fin - crudo.length; // donde empiezan los dígitos (el match puede incluir "$" y un espacio antes)
    const antes = t.slice(Math.max(0, ini - 6), ini);
    if (/^\s*(%|por ciento)/.test(despues)) {
      const p = parseNumberAR(crudo, { kind: 'percent' });
      if (p.ok && !p.empty) pcts.push({ valor: p.value, pos: m.index });
      continue;
    }
    // "a 1535" / "al 1535" es un precio aunque después venga "usdt" ("compro oficial a 1535, usdt al 2 %")
    const esPrecio = /(^|\s)(a|al)\s\$?\s?$/.test(antes);
    if (!esPrecio) {
      if (/^\s*(palos?|millon(es)?)\b/.test(despues)) { monto = { modo: 'ars', valor: toDec(parseNumberAR(crudo, { kind: 'ratio' }).value ?? 0).times(1e6) }; continue; }
      if (/^\s*lucas?\b/.test(despues)) { monto = { modo: 'ars', valor: toDec(parseNumberAR(crudo, { kind: 'ratio' }).value ?? 0).times(1000) }; continue; }
      if (/^\s*(de )?(pesos|ars|mangos)\b/.test(despues)) {
        const p = parseNumberAR(crudo, { kind: 'money' });
        if (p.ok && !p.empty) monto = { modo: 'ars', valor: p.value };
        continue;
      }
      if (/^\s*(usd|dolares|dolar|u\$s|verdes|usdt|usdc)\b/.test(despues)) {
        const p = parseNumberAR(crudo, { kind: 'money' });
        if (p.ok && !p.empty) monto = { modo: 'unidades', valor: p.value };
        continue;
      }
    }
    const p = parseNumberAR(crudo, { kind: 'money' });
    if (p.ok && !p.empty && p.value.gte(50) && p.value.lte(1e6)) precios.push({ valor: p.value, pos: m.index });
  }

  // Dónde comprás (el primer mercado), a qué pasás (otro mercado antes de vender) y dónde vendés
  const compra = mercados[0].id;
  const paso = mercados.find((m) => m.id !== compra && m.pos < posVenta);
  const vendeEn = mercados.find((m) => m.id !== compra && m.pos > posVenta);
  const venta = vendeEn?.id ?? paso?.id ?? compra;
  const precioCompra = precios.find((p) => p.pos < posVenta)?.valor ?? null;
  const precioVenta = precios.find((p) => p.pos > posVenta)?.valor ?? null;
  const conversion = venta !== compra ? (pcts.find((p) => p.pos < posVenta || !vendeEn) ?? null) : null;
  // Qué es el %: "me cobran / comisión" = % de lo que pasás; "me dan" = de más; si no (como lo dice él: "compro USDT al 2 %",
  // "+2 %", "2 % arriba"), es el precio del otro dólar más ese %: cada USDT te sale el oficial × 1,02 (pedido del 10/11/2026).
  const sentido = /\b(cobran|cobra|cobrar|comision|comisiones|fee)\b/.test(t) ? 'cobran'
    : /\b(me dan|te dan|dan de mas)\b/.test(t) ? 'dan' : 'sobreprecio';
  return {
    ok: true,
    esc: {
      compra, venta, precioCompra, precioVenta, monto: monto ?? { modo: 'unidades', valor: toDec(1000) }, montoPorDefecto: !monto,
      conversionPct: conversion?.valor ?? null, sentido, faltaConversion: venta !== compra && !conversion,
    },
  };
}

/**
 * Calcula la simulación con el motor de la calculadora.
 * @param {object} esc  de interpretarEscenario
 * @param {(id: string, punta: 'compra'|'venta') => {valor: *, texto: string} | null} precioDeHoy
 */
export function calcularEscenario(esc, precioDeHoy) {
  const nb = COMO_SE_DICE;
  if (esc.faltaConversion) {
    return { ok: false, frases: [`Me falta cuánto te sale pasar de ${nb[esc.compra]} a ${nb[esc.venta]} (en %). Decímelo así: «… y compro ${nb[esc.venta]} al 2 %» (cada uno te sale un 2 % más caro) o «… y me cobran 1,5 %» (de lo que pasás). Si no te cobran nada, poné 0 %. No lo supongo gratis.`] };
  }
  const usados = [];
  const precio = (id, punta, dado) => {
    if (dado) return { valor: dado, texto: null };
    const h = precioDeHoy(id, punta);
    if (h) usados.push(`No dijiste a cuánto ${punta === 'venta' ? 'comprás' : 'vendés'}: uso el precio de ${punta} de ${MERCADOS_CALCULADORA[id]} (${h.texto}).`);
    return h;
  };
  const pc = precio(esc.compra, 'venta', esc.precioCompra);
  const pv = precio(esc.venta, 'compra', esc.precioVenta);
  if (!pc || !pv) return { ok: false, frases: [`No tengo el precio de ${!pc ? MERCADOS_CALCULADORA[esc.compra] : MERCADOS_CALCULADORA[esc.venta]} de hoy: decime a cuánto ${!pc ? 'comprás' : 'vendés'} (por ejemplo «a 1550»).`] };
  let relacion = null;
  if (esc.venta !== esc.compra) {
    const r = relacionDesdePct(esc.conversionPct, esc.sentido ?? 'cobran');
    if (!r.ok) return { ok: false, frases: [r.error] };
    relacion = r.relacion;
  }
  const entrada = {
    modoMonto: esc.monto.modo, monto: esc.monto.valor, cotizacionBase: toDec(pc.valor), aumentoPct: 0, precioVenta: toDec(pv.valor),
    requiereConversion: esc.venta !== esc.compra, relacionConversion: relacion, relacionHipotesis: false,
    // Las comisiones que no dijiste: "No sé" (el resultado queda como cota máxima)
    comisionCompraPct: null, comisionVentaPct: null, impuestoCompraPct: null, ivaComisionesPct: null, slippageVentaPct: null,
    otrosCostos: { monto: null, cobro: 'suma_capital' }, costoTransferencia: { monto: null, cobro: 'suma_capital' },
  };
  const r = calcularSimple(entrada);
  if (!r.ok) return { ok: false, frases: r.errors.map((e) => e.message) };
  const x = r.result;
  const uo = UNIDAD[esc.compra];
  const ud = UNIDAD[esc.venta];
  const monto = esc.monto.modo === 'ars' ? `con ${formatARS(esc.monto.valor)}` : `${formatNumberAR(esc.monto.valor, { decimals: 2, minDecimals: 0 })} ${uo}`;
  const pctTxt = formatNumberAR(esc.conversionPct ?? 0, { decimals: 4, minDecimals: 0 });
  const recibis = relacion ? formatNumberAR(relacion.times(100), { decimals: 2, minDecimals: 0 }) : '';
  const paso = esc.venta === esc.compra ? ''
    : esc.sentido === 'sobreprecio'
      ? `, pasás a ${nb[esc.venta]} pagando ${pctTxt} % arriba (cada ${ud} te sale ${formatARS(toDec(pc.valor).times(ONE.plus(toDec(esc.conversionPct).div(100))))}: por cada 100 ${uo} recibís ${recibis} ${ud})`
      : esc.sentido === 'dan'
        ? `, pasás a ${nb[esc.venta]} y te dan ${pctTxt} % de más (recibís ${recibis} por cada 100)`
        : `, pasás a ${nb[esc.venta]} y te cobran ${pctTxt} % (recibís ${recibis} por cada 100)`;
  const frases = [
    `Así lo entendí: comprás ${monto} de ${nb[esc.compra]} a ${formatARS(pc.valor)}${paso}, y vendés a ${formatARS(pv.valor)} por ${ud}.${esc.montoPorDefecto ? ' (No dijiste monto: tomé 1.000 USD; decime «con 5.000 dólares» o «con 1 palo» para otro.)' : ''}`,
  ];
  const incompleto = r.calidad.nivel === 'incompleto';
  const titulo = x.resultadoNeto.gt(0) ? (incompleto ? 'Ganás como máximo' : 'Ganás') : x.resultadoNeto.lt(0) ? (incompleto ? 'Perdés (seguro, aun sin comisiones)' : 'Perdés') : 'Quedás igual';
  frases.push(`${titulo} ${formatARSSigned(x.resultadoNeto)} (${formatPct(x.roiPct)}) sobre ${formatARS(x.capitalInicial)} invertidos: recibís ${formatNumberAR(x.unidadesRecibidas, { decimals: 4, minDecimals: 0 })} ${ud} y cobrás ${formatARS(x.capitalFinal)}.`);
  const conversion = esc.venta !== esc.compra ? { sentido: esc.sentido ?? 'cobran', pct: esc.conversionPct } : null;
  frases.push(...(explicarSimple(r, { mismoMercado: esc.compra === esc.venta, unidadOrigen: uo, unidadDestino: ud, conversion }) ?? []).slice(1));
  if (conversion?.sentido === 'sobreprecio' && !toDec(esc.conversionPct).eq(0)) {
    frases.push(`Si en cambio el ${pctTxt} % es una comisión sobre lo que pasás, decime «me cobran ${pctTxt} %».`);
  }
  frases.push('Es una simulación con precios de referencia: no garantiza que puedas operar a esos precios. En la calculadora le podés sumar comisiones, impuestos y transferencias.');
  return {
    ok: true, frases, avisos: usados, series: [], tabla: null, unidad: '',
    accion: {
      tipo: 'calculadora', compra: esc.compra, venta: esc.venta, modo: esc.monto.modo,
      monto: formatNumberAR(esc.monto.valor, { decimals: 2, minDecimals: 0 }), base: formatNumberAR(toDec(pc.valor), { decimals: 4, minDecimals: 0 }),
      precioVenta: formatNumberAR(toDec(pv.valor), { decimals: 4, minDecimals: 0 }),
      conversionPct: esc.venta !== esc.compra ? formatNumberAR(esc.conversionPct, { decimals: 6, minDecimals: 0 }) : '',
      sentido: esc.sentido ?? 'cobran',
    },
  };
}
