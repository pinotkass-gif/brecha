// El chat contesta sobre USDT en los exchanges con los precios de CriptoYa (los mismos de la sección):
//   «¿a cuánto está el USDT en Binance?», «¿dónde está más barato el USDT?», «¿hay arbitraje de USDT?»,
//   «compro en Belo y vendo en Binance P2P». Reconocedor de castellano (no es una IA); las cuentas son las de
//   src/exchanges/arbitraje.mjs. Nunca inventa un precio: si un exchange no está o su dato es viejo, lo dice.
import { arbitrajes, prepararPrecios, mejores, accionCalculadora, nombreExchange, nombreRed, duracion } from '../exchanges/arbitraje.mjs';
import { formatNumberAR, formatARSSigned } from '../engine/format.mjs';
import { toDec, round, ONE, HUNDRED } from '../engine/decimal.mjs';

/** Minúsculas, sin acentos ni signos ("Let's Bit" → "lets bit"). */
export function normalizarExchanges(texto) {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

/** Cómo se nombra cada exchange en una frase (el P2P antes que el común: "binance p2p" no es "binance"). */
const ALIAS = [
  ['binancep2p', /\bbinance ?p2p\b/], ['binance', /\bbinance\b/],
  ['lemoncashp2p', /\blemon(?: ?cash)? ?p2p\b/], ['lemoncash', /\blemon(?: ?cash)?\b/],
  ['bybitp2p', /\bbybit ?p2p\b/], ['bybit', /\bbybit\b/],
  ['mexcp2p', /\bmexc ?p2p\b/], ['mexc', /\bmexc\b/],
  ['bitgetp2p', /\bbitget(?: ?p2p)?\b/], ['okexp2p', /\bok(?:x|ex)(?: ?p2p)?\b/], ['kucoinp2p', /\bkucoin(?: ?p2p)?\b/],
  ['huobip2p', /\b(?:huobi|htx)(?: ?p2p)?\b/], ['bingxp2p', /\bbingx(?: ?p2p)?\b/], ['weexp2p', /\bweex(?: ?p2p)?\b/],
  ['eldoradop2p', /\bel ?dorado(?: ?p2p)?\b/], ['ripioexchange', /\bripio ?(?:trade|exchange)\b/], ['ripio', /\bripio\b/],
  ['belo', /\bbelo\b/], ['fiwind', /\bfiwind\b/], ['letsbit', /\blets ?bit\b/], ['buenbit', /\bbuenbit\b/],
  ['bitsoalpha', /\bbitso(?: ?alpha)?\b/], ['cocoscrypto', /\bcocos(?: ?crypto)?\b/], ['astropay', /\bastro ?pay\b/],
  ['satoshitango', /\bsatoshi ?tango\b/], ['decrypto', /\bdecrypto\b/], ['tiendacrypto', /\btienda ?crypto\b/],
  ['universalcoins', /\buniversal ?coins?\b/], ['vitawallet', /\bvita ?wallet\b/], ['eluter', /\beluter\b/],
  ['takenos', /\btakenos\b/], ['wallbit', /\bwallbit\b/], ['peanut', /\bpeanut\b/], ['nexo', /\bnexo\b/],
  ['cryptomktpro', /\bcryptomkt(?: ?pro)?\b/], ['xapo', /\bxapo\b/], ['banexcoin', /\bbanexcoin\b/],
];

/** Exchanges nombrados, en el orden en que aparecen. */
export function encontrarExchanges(t) {
  let resto = t;
  const hallados = [];
  for (const [id, re] of ALIAS) {
    const m = re.exec(resto);
    if (!m) continue;
    hallados.push({ id, pos: m.index });
    resto = resto.slice(0, m.index) + ' '.repeat(m[0].length) + resto.slice(m.index + m[0].length); // no lo vuelve a encontrar otro alias
  }
  return hallados.sort((a, b) => a.pos - b.pos);
}

/**
 * ¿La pregunta es sobre USDT en los exchanges? Devuelve qué se pregunta, o null (sigue el resto del chat).
 * @returns {null | {tipo: 'arbitraje'} | {tipo: 'mejor', lado: 'compra'|'venta'|'ambos'} | {tipo: 'precio', ids: string[]} | {tipo: 'par', desde: string, hacia: string}}
 */
export function interpretarExchanges(texto) {
  const t = normalizarExchanges(texto);
  if (!t) return null;
  const hallados = encontrarExchanges(t);
  const ids = [...new Set(hallados.map((h) => h.id))];
  const contexto = /\b(usdt|usdc|tether|exchange|exchanges|p2p|cripto|crypto)\b/.test(t);
  const compra = /\bcompr\w*/.exec(t);
  const venta = /\bvend\w*/.exec(t);
  // «compro en Belo y vendo en Binance P2P»: esa combinación
  if (ids.length >= 2 && compra && venta) {
    const despues = (m) => hallados.find((h) => h.pos > m.index)?.id;
    let desde = despues(compra);
    let hacia = despues(venta);
    if (!desde || !hacia || desde === hacia) [desde, hacia] = [hallados[0].id, hallados.find((h) => h.id !== hallados[0].id).id];
    return { tipo: 'par', desde, hacia };
  }
  if (/\barbitra\w*/.test(t) && (contexto || ids.length)) return { tipo: 'arbitraje' };
  if (/\d/.test(t.replace(/\bp2p\b/g, ''))) return null; // con precios o montos es una simulación o una pregunta del histórico
  if (ids.length) return { tipo: 'precio', ids };
  if (!/\b(usdt|usdc|tether|exchange|exchanges|p2p)\b/.test(t)) return null; // "cripto" solo es del histórico
  const lado = compra && !venta ? 'compra' : venta && !compra ? 'venta' : 'ambos';
  if (/\b(barat\w*|car[oa]s?|conviene\w*|mejor\w*|donde|cual\w*|precios?|cotiza\w*|cuanto|esta|vale|paga\w*)\b/.test(t)) return { tipo: 'mejor', lado };
  return null;
}

const precioArs = (v) => `$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const precioUsd = (v) => `US$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const pctTxt = (v) => `${v.gt(0) ? '+' : ''}${formatNumberAR(round(v, 2), { decimals: 2, minDecimals: 2 })} %`;
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
const P2P = 'Los P2P son avisos de particulares: tienen mínimos, máximos y medios de pago que hay que revisar.';

function fuenteDe(datos, o) {
  return `Fuente: CriptoYa, precios para ${formatNumberAR(datos.volumen, { decimals: 0 })} USDT ${o.conComisiones ? 'con' : 'sin'} las comisiones del exchange, recibidos a las ${HORA.format(new Date(datos.at))}. Es una referencia: verificá el precio en el exchange antes de operar.`;
}
function lineaCombinacion(f) {
  const red = f.paso.mismo ? 'sin pasarlos a otro exchange' : f.paso.conocida ? `pasar los USDT por ${nombreRed(f.paso.red)} (${formatNumberAR(f.paso.retiro, { decimals: 8, minDecimals: 0 })} USDT)` : 'pasar los USDT (no sé cuánto cuesta)';
  return `comprar en ${nombreExchange(f.desde)} a ${precioArs(f.compra)}, ${red} y vender en ${nombreExchange(f.hacia)} a ${precioArs(f.venta)}: ${f.completo ? '' : 'como máximo '}${formatARSSigned(round(f.resultado, 2))} (${pctTxt(f.pct)})`;
}
/** Botón "Abrir en la calculadora" con los números en formato argentino (como los escribe la calculadora). */
function accion(f, monto, o) {
  const a = accionCalculadora(f, { monto, conComisiones: o.conComisiones });
  const campo = (x) => (typeof x === 'string' && x !== '' && x !== 'no aplica' ? formatNumberAR(toDec(x), { decimals: 12, minDecimals: 0 }) : x);
  return { ...a, monto: campo(a.monto), base: campo(a.base), precioVenta: campo(a.precioVenta), conversionPct: campo(a.conversionPct), costos: { ...a.costos, transf: campo(a.costos.transf) }, origen: 'exchanges' };
}

/**
 * Respuesta con los datos de CriptoYa (lo que devuelve crearFuenteExchanges().cargar()).
 * @param {ReturnType<typeof interpretarExchanges>} c
 * @param {{at: string, volumen: string, ars: Array, usd: Array|null, fees: object|null}} datos
 * @param {{monto?: *, conComisiones?: boolean, incluirP2P?: boolean}} [o]
 */
export function responderExchanges(c, datos, o = {}) {
  const opts = { conComisiones: o.conComisiones !== false, incluirP2P: o.incluirP2P !== false };
  let monto;
  try { monto = toDec(o.monto ?? '1000000'); } catch { monto = toDec('1000000'); }
  if (!monto.gt(0)) monto = toDec('1000000');
  const base = { ok: true, avisos: [...(datos.avisos ?? [])], series: [], tabla: null, unidad: '', fuente: fuenteDe(datos, opts), verExchanges: true };
  const ars = prepararPrecios(datos.ars, { at: datos.at, ...opts, incluirP2P: true });
  const usd = datos.usd ? prepararPrecios(datos.usd, { at: datos.at, ...opts, incluirP2P: true }) : [];
  const montoTxt = `$ ${formatNumberAR(monto, { decimals: 2, minDecimals: 0 })}`;

  if (c.tipo === 'precio') {
    const frases = [];
    const filas = [];
    for (const id of c.ids.slice(0, 6)) {
      const a = ars.find((x) => x.id === id);
      const u = usd.find((x) => x.id === id);
      const nombre = nombreExchange(id);
      if (!a && !u) { frases.push(`CriptoYa no trae precios de USDT de ${nombre} en este momento.`); continue; }
      if (a) {
        const partes = [a.compra ? `comprás USDT a ${precioArs(a.compra)}` : 'no hay quien venda USDT', a.venta ? `lo vendés a ${precioArs(a.venta)}` : 'no hay quien compre USDT'];
        frases.push(`En ${nombre} ${partes.join(' y ')}${a.motivos.length ? ` (ojo: ${a.motivos.join('; ')}: no lo uso para calcular)` : ''}.`);
        filas.push([nombre, 'Pesos', a.compra ? precioArs(a.compra) : 'sin oferta', a.venta ? precioArs(a.venta) : 'sin oferta', a.edadMin === null ? '—' : `hace ${duracion(a.edadMin)}`]);
      }
      if (u) {
        const arriba = u.compra ? u.compra.minus(ONE).times(HUNDRED) : null;
        frases.push(`Con dólares en ${nombre}: ${u.compra ? `cada USDT te sale ${precioUsd(u.compra)} (${arriba.gte(0) ? `${formatNumberAR(round(arriba, 2), { decimals: 2, minDecimals: 0 })} % arriba del dólar` : `${formatNumberAR(round(arriba.abs(), 2), { decimals: 2, minDecimals: 0 })} % abajo del dólar`})` : 'nadie vende USDT por dólares'}${u.venta ? ` y te pagan ${precioUsd(u.venta)} por cada uno` : ''}.`);
        filas.push([nombre, 'Dólares', u.compra ? precioUsd(u.compra) : 'sin oferta', u.venta ? precioUsd(u.venta) : 'sin oferta', u.edadMin === null ? '—' : `hace ${duracion(u.edadMin)}`]);
      }
    }
    if (c.ids.some((id) => id.endsWith('p2p'))) frases.push(P2P);
    return { ...base, ok: filas.length > 0, frases, tabla: filas.length ? { cabeza: ['Exchange', 'Con', 'Comprás a', 'Vendés a', 'Dato'], filas } : null };
  }

  if (c.tipo === 'mejor') {
    const usables = ars.filter((x) => (opts.incluirP2P || !x.p2p));
    const compran = usables.filter((x) => x.usarCompra).sort((a, b) => a.compra.cmp(b.compra)).slice(0, 3);
    const venden = usables.filter((x) => x.usarVenta).sort((a, b) => b.venta.cmp(a.venta)).slice(0, 3);
    const lista = (xs, k) => xs.map((x, i) => `${i + 1}) ${x.nombre} ${precioArs(x[k])}`).join(' · ');
    const frases = [];
    if (c.lado !== 'venta') frases.push(compran.length ? `Para comprar USDT, lo más barato ahora: ${lista(compran, 'compra')}.` : 'No tengo precios de compra usables ahora.');
    if (c.lado !== 'compra') frases.push(venden.length ? `Para vender USDT, lo que más paga: ${lista(venden, 'venta')}.` : 'No tengo precios de venta usables ahora.');
    const b = mejores(usables);
    if (c.lado === 'ambos' && b.compra && b.venta && b.venta.venta.gt(b.compra.compra)) frases.push(`Comprar en ${b.compra.nombre} y vender en ${b.venta.nombre} deja ${pctTxt(b.venta.venta.div(b.compra.compra).minus(ONE).times(HUNDRED))} antes de pasar los USDT de un exchange al otro. Preguntame «¿hay arbitraje de USDT?» para ver la cuenta completa.`);
    if ([...compran, ...venden].some((x) => x.p2p)) frases.push(P2P);
    return { ...base, ok: compran.length + venden.length > 0, frases };
  }

  const r = arbitrajes({ ars: datos.ars, usd: datos.usd, fees: datos.fees, at: datos.at, monto, ...opts, incluirP2P: c.tipo === 'par' ? true : opts.incluirP2P, limite: c.tipo === 'par' ? 100000 : 3 });
  if (!r.ok) return { ...base, ok: false, frases: [r.error] };
  if (c.tipo === 'par') {
    const f = r.filas.find((x) => x.desde === c.desde && x.hacia === c.hacia);
    if (!f) {
      const a = r.ars.find((x) => x.id === c.desde);
      const b = r.ars.find((x) => x.id === c.hacia);
      const motivo = !a ? `CriptoYa no trae precios de ${nombreExchange(c.desde)}` : !a.usarCompra ? `el precio de compra de ${a.nombre} no se puede usar (${a.motivos.join('; ') || 'no hay quien venda'})`
        : !b ? `CriptoYa no trae precios de ${nombreExchange(c.hacia)}` : !b.usarVenta ? `el precio de venta de ${b.nombre} no se puede usar (${b.motivos.join('; ') || 'no hay quien compre'})` : 'la comisión para pasar los USDT se come todo';
      return { ...base, ok: false, frases: [`No puedo calcular comprar en ${nombreExchange(c.desde)} y vender en ${nombreExchange(c.hacia)}: ${motivo}.`] };
    }
    const frases = [`Con ${montoTxt} (el monto de la sección «USDT en exchanges»): ${lineaCombinacion(f)}.`, ...f.notas];
    const pos = r.filas.indexOf(f) + 1;
    frases.push(`Es la combinación ${formatNumberAR(pos, { decimals: 0 })} de ${formatNumberAR(r.total, { decimals: 0 })}. Antes de impuestos y otros costos que no estén en el precio.`);
    return { ...base, frases, accion: accion(f, monto, opts) };
  }
  if (!r.filas.length) return { ...base, ok: false, frases: ['No hay combinaciones con precios usables ahora.'] };
  const [mejor, ...otras] = r.filas;
  const frases = [`Con ${montoTxt}, lo mejor ahora es ${lineaCombinacion(mejor)}.`];
  if (otras.length) frases.push(`Le siguen: ${otras.map((f) => `${nombreExchange(f.desde)} → ${nombreExchange(f.hacia)} ${formatARSSigned(round(f.resultado, 2))} (${pctTxt(f.pct)})`).join(' · ')}.`);
  frases.push(`De ${formatNumberAR(r.total, { decimals: 0 })} combinaciones, ${formatNumberAR(r.positivas, { decimals: 0 })} dan ganancia con estos precios (teórico: antes de impuestos y sin verificar límites, medios de pago ni plazos).`);
  if (r.filas.some((f) => f.desde.endsWith('p2p') || f.hacia.endsWith('p2p'))) frases.push(P2P);
  return { ...base, frases, accion: accion(mejor, monto, opts) };
}
