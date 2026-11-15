// Operaciones hechas desde el chat (15/11/2026): «anotá: puse 1 palo, billete a 1470, USDT al 2 %, vendí a 1680»,
// «en realidad gané 95 mil» (corrige la última) y «¿cuánto gané hoy?». Lo que no dijo no se inventa: si falta un
// número, lo pide. La cuenta es la de src/operaciones/modelo.mjs (la misma que la calculadora).
import { normalizarEscenario } from './escenario.mjs';
import { encontrarExchanges, normalizarExchanges } from './exchanges.mjs';
import { nombreExchange } from '../exchanges/arbitraje.mjs';
import { parseNumberAR, formatARS, formatARSSigned, formatNumberAR, formatPct } from '../engine/format.mjs';
import { toDec } from '../engine/decimal.mjs';

const ANOTAR = /\b(anota\w*|registra\w*|guarda(me|la)? (la|esta|una) (operacion|vuelta)|hice (una|otra) (vuelta|operacion)|di (una|otra) vuelta)\b/;
const CORREGIR = /\b(en realidad|realmente|de verdad|al final|posta|corregi\w*|me quedo|me quedaron)\b/;
const RESULTADO = /\b(gane|ganamos|perdi|perdimos|me quedo|me quedaron|saque)\b/;
const VER = /\b(cuanto (gane|ganamos|llevo ganado)|mis operaciones|las operaciones|operaciones (de|del) (hoy|dia|ayer)|ganancia (de|del) (hoy|dia|ayer|la semana))\b/;
const NUMERO = /(-|menos\s)?\$?\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/g;

const money = (s) => { const p = parseNumberAR(s, { kind: 'money' }); return p.ok && !p.empty ? p.value : null; };
const ratio = (s) => { const p = parseNumberAR(s, { kind: 'ratio' }); return p.ok && !p.empty ? p.value : null; };

/** Números de la frase con su posición: montos (palo, mil, lucas, pesos), porcentajes y precios. */
function numeros(t) {
  const out = [];
  for (const m of t.matchAll(NUMERO)) {
    const crudo = m[2];
    const fin = m.index + m[0].length;
    const despues = t.slice(fin, fin + 14);
    const neg = Boolean(m[1]);
    if (/^\s*(%|por ciento)/.test(despues)) { const v = parseNumberAR(crudo, { kind: 'percent' }); if (v.ok && !v.empty) out.push({ tipo: 'pct', valor: v.value, pos: m.index }); continue; }
    if (/^\s*(palos?|millon(es)?|m\b)/.test(despues)) { const v = ratio(crudo); if (v) out.push({ tipo: 'monto', valor: v.times(1e6), pos: m.index, neg }); continue; }
    if (/^\s*(lucas?|mil|k\b)/.test(despues)) { const v = ratio(crudo); if (v) out.push({ tipo: 'monto', valor: v.times(1000), pos: m.index, neg }); continue; }
    const v = money(crudo);
    if (!v) continue;
    if (/^\s*(de )?(pesos|ars|mangos)\b/.test(despues) || v.gte(20000)) out.push({ tipo: 'monto', valor: v, pos: m.index, neg });
    else out.push({ tipo: 'precio', valor: v, pos: m.index, neg });
  }
  return out;
}

/** El precio que viene después de alguna de estas palabras (lo más cerca posible), o null. */
function precioDespuesDe(t, nums, re) {
  let mejor = null;
  for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
    const p = nums.find((n) => n.tipo === 'precio' && !n.usado && n.pos > m.index && n.pos - m.index < 30);
    if (p && (!mejor || p.pos - m.index < mejor.d)) mejor = { p, d: p.pos - m.index };
  }
  if (mejor) mejor.p.usado = true;
  return mejor?.p.valor ?? null;
}

/**
 * @returns {null | {tipo: 'anotar', datos: object, faltan: string[]} | {tipo: 'corregir', real: Dec|null, motivo: string} | {tipo: 'ver', cuando: 'hoy'|'ayer'|'todo'}}
 */
export function interpretarOperacion(texto) {
  const t = normalizarEscenario(texto);
  if (!t) return null;
  if (ANOTAR.test(t)) {
    const nums = numeros(t);
    const pct = nums.find((n) => n.tipo === 'pct')?.valor ?? null;
    const pesos = nums.find((n) => n.tipo === 'monto')?.valor ?? null;
    let billete = precioDespuesDe(t, nums, /\b(billete|billetes|dolar|dolares|blue|verdes|compre|cambie|compramos)\b/);
    let venta = precioDespuesDe(t, nums, /\b(vendi|vendimos|vendo|vendidos|venta|los vendi|salio|sali)\b/);
    const libres = nums.filter((n) => n.tipo === 'precio' && !n.usado);
    if (billete === null && libres.length) billete = libres.shift().valor; // en orden: primero el billete, después la venta
    if (venta === null && libres.length) venta = libres.shift().valor;
    const ex = encontrarExchanges(normalizarExchanges(texto))[0];
    const datos = { pesos, billete, pct, venta, donde: ex ? nombreExchange(ex.id) : '' };
    const faltan = [['pesos', 'cuántos pesos pusiste'], ['billete', 'a cuánto compraste el dólar billete'], ['pct', 'a qué % conseguiste los USDT'], ['venta', 'a cuánto vendiste cada USDT']]
      .filter(([k]) => datos[k] === null).map(([, d]) => d);
    return { tipo: 'anotar', datos, faltan };
  }
  if (CORREGIR.test(t) && RESULTADO.test(t)) {
    const n = numeros(t).find((x) => x.tipo === 'monto' || x.tipo === 'precio');
    const perdi = /\b(perdi|perdimos)\b/.test(t);
    const quedo = /\b(me quedo|me quedaron|saque)\b/.test(t) && !/\b(gane|ganamos)\b/.test(t); // "me quedaron 1.090.000" = lo cobrado
    // "…, fue por la comisión del arbolito" / "… por la transferencia": el motivo es lo que viene después
    const resto = n ? t.slice(n.pos) : t;
    const m = /\b(?:fue por|por|fue)\s+(?:(?:la|el|los|las|un|una)\s+)?([a-z][a-z0-9 ]{2,80})$/.exec(resto);
    let real = n ? n.valor : null;
    if (real && (perdi || n.neg)) real = real.neg();
    return { tipo: 'corregir', real, cobrado: quedo, motivo: m ? m[1].trim().slice(0, 120) : '' };
  }
  if (VER.test(t)) return { tipo: 'ver', cuando: /\bayer\b/.test(t) ? 'ayer' : /\bhoy|del dia\b/.test(t) ? 'hoy' : 'todo' };
  return null;
}

const num = (v, d = 2) => formatNumberAR(v, { decimals: d, minDecimals: d });
const fecha = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** La vuelta en una línea: "$ 1.000.000 → 680,27 USD a $ 1.470 → 666,93 USDT al 2 % → vendidos a $ 1.680". */
export function lineaOperacion(op, x) {
  return `${formatARS(op.pesos, { decimals: 0 })} → ${num(x.usd)} USD a ${formatARS(op.billete)} → ${num(x.usdt)} USDT al ${formatNumberAR(op.pct, { decimals: 2, minDecimals: 0 })} % → vendidos a ${formatARS(op.venta)}${op.donde ? ` en ${op.donde}` : ''}`;
}

/** Respuesta al anotar (r = lo que devolvió anotar: {ok, op, calc, ajustada, apr} o {ok:false, error}). */
export function responderAnotar(i, r) {
  if (i.faltan.length) {
    return { ok: false, frases: [`Para anotarla me falta ${i.faltan.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`, 'Decímelo todo junto, así: «anotá: puse 1 palo, billete a 1470, USDT al 2 %, vendí a 1680».'] };
  }
  if (!r.ok) return { ok: false, frases: [r.error] };
  const f = [`Anotada (${fecha(r.op.dia)}): ${lineaOperacion(r.op, r.calc)}.`, `Ganancia calculada: ${formatARSSigned(r.calc.ganancia)} (${formatPct(r.calc.gananciaPct)}).`];
  if (r.ajustada) f.push(`Con lo que aprendimos de ${r.apr.n} ${r.apr.n === 1 ? 'operación corregida' : 'operaciones corregidas'}, en la realidad te quedarían unos ${formatARSSigned(r.ajustada)}.`);
  f.push('Cuando sepas cuánto ganaste de verdad, decime «en realidad gané …» (y si sabés, por qué) o corregila en la pestaña Operaciones.');
  return { ok: true, frases: f, verOperaciones: true };
}

/** Respuesta al corregir la última. */
export function responderCorregir(i, r) {
  if (i.real === null) return { ok: false, frases: ['¿Cuánto ganaste de verdad? Decime el número, por ejemplo «en realidad gané 95 mil» (o «perdí 5 mil»).'] };
  if (!r.ok) return { ok: false, frases: [r.error] };
  const x = r.calc;
  const f = [`Corregida la del ${fecha(r.op.dia)} (${lineaOperacion(r.op, x)}): calculé ${formatARSSigned(x.ganancia)} y ganaste ${formatARSSigned(x.real)}.`];
  if (x.dif.abs().lt(1)) f.push('Dio igual que la cuenta: no se nos pasó ningún costo.');
  else if (x.dif.gt(0)) {
    f.push(`Se nos pasaron ${formatARS(x.dif)} (${formatPct(x.difPct, { signed: false })} de lo que pusiste). Equivale a que el billete te haya salido ${formatARS(x.equivale.billeteMasCaro)} más caro, a que te pagaran ${formatARS(x.equivale.ventaMenos)} menos por USDT, o a una comisión de ${formatPct(x.equivale.comisionVentaPct, { signed: false })} al vender.`);
    if (!r.op.motivo) f.push('Si sabés qué fue (comisión, transferencia, precio distinto), anotalo en la pestaña Operaciones: así lo voy aprendiendo.');
  } else f.push(`Ganaste ${formatARS(x.dif.neg())} más de lo calculado: puede que vendieras más caro o que el % de los USDT fuera menor.`);
  f.push(`Lo aprendido hasta ahora: en promedio ganás ${formatPct(r.apr.costoPct.neg())} de lo que ponés respecto de la cuenta (${r.apr.n} ${r.apr.n === 1 ? 'operación corregida' : 'operaciones corregidas'}).`);
  return { ok: true, frases: f, verOperaciones: true };
}

/** «¿Cuánto gané hoy?»: los días con sus totales. */
export function responderVer(i, dias, hoy, ayer) {
  const elegidos = i.cuando === 'hoy' ? dias.filter((d) => d.dia === hoy) : i.cuando === 'ayer' ? dias.filter((d) => d.dia === ayer) : dias.slice(0, 7);
  if (!elegidos.length) return { ok: false, frases: [i.cuando === 'todo' ? 'Todavía no anotaste ninguna operación. Decime «anotá: puse 1 palo, billete a 1470, USDT al 2 %, vendí a 1680» o tocá «Anotar como hecha» en la calculadora.' : `No tengo operaciones anotadas ${i.cuando === 'hoy' ? 'hoy' : 'ayer'}.`] };
  const f = elegidos.map((d) => `${fecha(d.dia)}: ${d.n} ${d.n === 1 ? 'vuelta' : 'vueltas'} con ${formatARS(d.pesos, { decimals: 0 })} en total, ganancia ${formatARSSigned(d.ganancia)} (${formatPct(d.gananciaPct)})${d.corregidas === d.n ? ', todas con lo real' : d.corregidas ? `, ${d.corregidas} con lo real y el resto calculado` : ', calculada'}.`);
  return { ok: true, frases: f, verOperaciones: true };
}

export const _test = { numeros, toDec };
