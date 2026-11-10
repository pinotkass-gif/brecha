// Arbitraje teórico de USDT entre exchanges, con los precios de CriptoYa (src/exchanges/criptoya.mjs).
// Tres recorridos, siempre de pesos a pesos:
//   pesos    → comprás USDT con pesos en A, los pasás a B y los vendés por pesos en B.
//   dolares  → comprás dólares (oficial, MEP…), con ellos USDT en A, los pasás a B y los vendés por pesos.
//   adolares → comprás USDT con pesos en A, los pasás a B, los vendés por dólares en B y vendés esos dólares.
// Para comprar se usa el ask (lo que pagás) y para vender el bid (lo que te pagan). Pasar USDT de un exchange a otro
// cuesta la comisión de retiro de la red más barata que tengan en común; si no se sabe, el resultado es "como máximo".
// Cuentas exactas con Dec. Es una simulación: no verifica límites, medios de pago, liquidez ni plazos.
import { toDec, ZERO, ONE, HUNDRED, round, plain } from '../engine/decimal.mjs';

export const NOMBRES = {
  astropay: 'AstroPay', banexcoin: 'Banexcoin', belo: 'Belo', binance: 'Binance', binancep2p: 'Binance P2P',
  bingxp2p: 'BingX P2P', bitfinexp2p: 'Bitfinex P2P', bitget: 'Bitget', bitgetp2p: 'Bitget P2P', bitso: 'Bitso',
  bitsoalpha: 'Bitso Alpha', buenbit: 'Buenbit', bybit: 'Bybit', bybitp2p: 'Bybit P2P', cocoscrypto: 'Cocos Crypto',
  cryptomkt: 'CryptoMKT', cryptomktpro: 'CryptoMKT Pro', decrypto: 'Decrypto', eldoradop2p: 'El Dorado P2P',
  eluter: 'Eluter', fiwind: 'Fiwind', huobip2p: 'HTX P2P (Huobi)', kraken: 'Kraken', kucoin: 'KuCoin',
  kucoinp2p: 'KuCoin P2P', lemoncash: 'Lemon', lemoncashp2p: 'Lemon P2P', letsbit: "Let'sBit", mexc: 'MEXC',
  mexcp2p: 'MEXC P2P', nexo: 'Nexo', okexp2p: 'OKX P2P', peanut: 'Peanut', ripio: 'Ripio',
  ripioexchange: 'Ripio Trade', saldo: 'Saldo', satoshitango: 'SatoshiTango', takenos: 'Takenos',
  tiendacrypto: 'TiendaCrypto', universalcoins: 'Universal Coins', vitawallet: 'Vita Wallet', wallbit: 'Wallbit',
  weexp2p: 'WEEX P2P', x4t: 'X4T', xapo: 'Xapo',
};
export const nombreExchange = (id) => NOMBRES[id] ?? id;
/** P2P = avisos de particulares: el precio depende del anunciante, el medio de pago y los montos mínimos y máximos. */
export const esP2P = (id) => /p2p$/.test(id);
const REDES = {
  TRON: 'TRC20 (Tron)', BSC: 'BEP20 (BSC)', ETHEREUM: 'ERC20 (Ethereum)', POLYGON: 'Polygon', SOLANA: 'Solana',
  ARBITRUM: 'Arbitrum', OPTIMISM: 'Optimism', AVALANCHE: 'Avalanche C', TON: 'TON', APTOS: 'Aptos', PLASMA: 'Plasma',
  ALGORAND: 'Algorand',
};
export const nombreRed = (red) => REDES[red] ?? red;

export const FAMILIAS = {
  pesos: 'Pesos → USDT → pesos',
  dolares: 'Dólares → USDT → pesos',
  adolares: 'Pesos → USDT → dólares',
};
/** Un precio con más de 15 minutos (CriptoYa actualiza cada minuto) no se usa para calcular. */
export const VIEJO_MINUTOS = 15;
/** Un precio que se aleja más de 15 % de la mediana de los demás exchanges se marca raro y no se usa. */
export const RARO_PCT = 15;
/** Una comisión de retiro sin fecha o informada hace más de 30 días se usa, pero hay que verificarla. */
export const FEE_VIEJA_DIAS = 30;
export const LIMITE_POR_DEFECTO = 10;

function mediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a.cmp(b));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1].plus(s[m]).div(2);
}
const lejos = (x, med) => med && x.div(med).minus(ONE).abs().times(HUNDRED).gt(RARO_PCT);

/** "3 min", "2 h", "9 días" (para decir cuán viejo es un dato). */
export function duracion(min) {
  if (min < 60) return `${Math.max(0, Math.round(min))} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} días`;
}

/**
 * Filas validadas de CriptoYa → precios para operar, con lo que impide usarlos.
 * @param {Array<{id, ask, totalAsk, bid, totalBid, time}>} filas
 * @param {{at: string, conComisiones?: boolean, incluirP2P?: boolean}} opts  at = cuándo se recibieron (ISO)
 */
export function prepararPrecios(filas, { at, conComisiones = true, incluirP2P = true }) {
  const tAt = Date.parse(at) / 1000;
  const base = (filas ?? []).map((f) => {
    const c = conComisiones ? f.totalAsk : f.ask;
    const v = conComisiones ? f.totalBid : f.bid;
    const edadMin = f.time === null ? null : (tAt - f.time) / 60;
    const motivos = [];
    let viejo = false;
    if (edadMin === null) { viejo = true; motivos.push('CriptoYa no informa la hora del dato'); }
    else if (edadMin < -5) { viejo = true; motivos.push('el dato tiene fecha del futuro'); }
    else if (edadMin > VIEJO_MINUTOS) { viejo = true; motivos.push(`el dato es de hace ${duracion(edadMin)}`); }
    return { id: f.id, nombre: nombreExchange(f.id), p2p: esP2P(f.id), compra: c ? toDec(c) : null, venta: v ? toDec(v) : null, edadMin, viejo, motivos, raroCompra: false, raroVenta: false };
  });
  const medC = mediana(base.filter((x) => !x.viejo && x.compra).map((x) => x.compra));
  const medV = mediana(base.filter((x) => !x.viejo && x.venta).map((x) => x.venta));
  for (const x of base) {
    if (x.compra && !x.viejo && lejos(x.compra, medC)) { x.raroCompra = true; x.motivos.push('el precio de compra se aleja mucho del resto'); }
    if (x.venta && !x.viejo && lejos(x.venta, medV)) { x.raroVenta = true; x.motivos.push('el precio de venta se aleja mucho del resto'); }
    const filtroP2P = incluirP2P || !x.p2p;
    x.usarCompra = !!x.compra && !x.viejo && !x.raroCompra && filtroP2P;
    x.usarVenta = !!x.venta && !x.viejo && !x.raroVenta && filtroP2P;
  }
  return base;
}

/**
 * Red más barata para pasar USDT de un exchange a otro (los dos tienen que figurar con esa red).
 * @returns {{mismo: true, conocida: true, retiro: *} | {mismo: false, conocida: true, red: string, retiro: *, vieja: boolean, verificarDestino: boolean} | {mismo: false, conocida: false, motivo: string}}
 */
export function redParaPasar(fees, desde, hacia, at) {
  if (desde === hacia) return { mismo: true, conocida: true, retiro: ZERO };
  const a = fees?.[desde];
  if (!a) return { mismo: false, conocida: false, motivo: `CriptoYa no informa cuánto cobra ${nombreExchange(desde)} por retirar USDT` };
  const b = fees?.[hacia];
  let redes = Object.keys(a);
  if (b) {
    redes = redes.filter((r) => Object.hasOwn(b, r));
    if (!redes.length) return { mismo: false, conocida: false, motivo: `${nombreExchange(desde)} y ${nombreExchange(hacia)} no tienen una red en común según CriptoYa` };
  }
  redes.sort((r1, r2) => toDec(a[r1].retiro).cmp(toDec(a[r2].retiro)) || (r1 < r2 ? -1 : 1));
  const red = redes[0];
  const d = a[red];
  const tAt = Date.parse(at) / 1000;
  return { mismo: false, conocida: true, red, retiro: toDec(d.retiro), vieja: d.time === null || tAt - d.time > FEE_VIEJA_DIAS * 86400, verificarDestino: !b };
}

/**
 * Todas las combinaciones de un recorrido, ordenadas: primero las completas (se sabe lo que cuesta pasar los USDT),
 * después por resultado. Devuelve las mejores `limite`.
 * @param {{ars: Array, usd?: Array|null, fees?: object|null, at: string, monto: *, familia?: keyof FAMILIAS,
 *   mercado?: {id: string, nombre: string, compra: *, venta: *} | null, conComisiones?: boolean, incluirP2P?: boolean, limite?: number}} o
 */
export function arbitrajes(o) {
  const familia = Object.hasOwn(FAMILIAS, o.familia) ? o.familia : 'pesos';
  let monto;
  try { monto = toDec(o.monto); } catch { return { ok: false, error: 'Escribí cuántos pesos querés usar.' }; }
  if (!monto.gt(0)) return { ok: false, error: 'Escribí cuántos pesos querés usar.' };
  const opts = { at: o.at, conComisiones: o.conComisiones !== false, incluirP2P: o.incluirP2P !== false };
  const ars = prepararPrecios(o.ars, opts);
  const usd = o.usd ? prepararPrecios(o.usd, opts) : null;
  const m = o.mercado ?? null;
  if (familia !== 'pesos') {
    if (!usd) return { ok: false, error: 'No tengo los precios de USDT en dólares de CriptoYa.', ars, usd };
    const punta = familia === 'dolares' ? 'venta' : 'compra';
    if (!m || !m[punta]) return { ok: false, error: `No tengo a cuánto ${familia === 'dolares' ? 'comprás' : 'vendés'} el ${m?.nombre ?? 'dólar'}: actualizá las cotizaciones o cargalo a mano.`, ars, usd };
  }
  const [listaA, listaB] = familia === 'pesos' ? [ars, ars] : familia === 'dolares' ? [usd, ars] : [ars, usd];
  const filas = [];
  for (const a of listaA) {
    if (!a.usarCompra) continue;
    for (const b of listaB) {
      if (!b.usarVenta) continue;
      const paso = redParaPasar(o.fees, a.id, b.id, o.at);
      const notas = [];
      let dolares = null;
      let usdt;
      if (familia === 'dolares') {
        dolares = monto.div(toDec(m.venta));
        usdt = dolares.div(a.compra);
      } else usdt = monto.div(a.compra);
      const retiro = paso.conocida ? paso.retiro : ZERO;
      const neto = usdt.minus(retiro);
      if (!neto.gt(0)) continue; // la comisión de retiro se come todo
      let pesos;
      if (familia === 'adolares') {
        dolares = neto.times(b.venta);
        pesos = dolares.times(toDec(m.compra));
      } else pesos = neto.times(b.venta);
      const resultado = pesos.minus(monto);
      if (!paso.conocida) notas.push(`No sé cuánto cuesta pasar los USDT (${paso.motivo}): el resultado es como máximo.`);
      else if (!paso.mismo) {
        if (paso.vieja) notas.push(`La comisión de retiro de ${a.nombre} por ${nombreRed(paso.red)} no tiene fecha o tiene más de ${FEE_VIEJA_DIAS} días: verificala.`);
        if (paso.verificarDestino) notas.push(`Verificá que ${b.nombre} acepte USDT por ${nombreRed(paso.red)}.`);
      }
      if (familia === 'dolares') notas.push(`Necesitás tener los dólares en ${a.nombre}: verificá cómo se depositan y si cobra por eso.`);
      if (familia === 'adolares') notas.push(`Verificá cómo sacás los dólares de ${b.nombre} y si los podés vender a ese precio.`);
      if (a.p2p || b.p2p) notas.push('P2P: es el precio de un aviso de un particular; tiene mínimos, máximos y medios de pago que hay que revisar.');
      if (a.id === b.id && familia === 'pesos') notas.push('Comprar y vender en el mismo exchange: sólo puede dar ganancia en P2P, con avisos distintos.');
      filas.push({ familia, desde: a.id, hacia: b.id, compra: a.compra, venta: b.venta, paso, usdt, neto, dolares, pesos, resultado, pct: resultado.div(monto).times(HUNDRED), completo: paso.conocida, notas });
    }
  }
  filas.sort((x, y) => (x.completo === y.completo ? 0 : x.completo ? -1 : 1) || y.resultado.cmp(x.resultado) || (x.desde + x.hacia < y.desde + y.hacia ? -1 : 1));
  const limite = Number.isInteger(o.limite) && o.limite > 0 ? o.limite : LIMITE_POR_DEFECTO;
  return {
    ok: true, familia, monto, ars, usd,
    filas: filas.slice(0, limite),
    total: filas.length,
    positivas: filas.filter((f) => f.resultado.gt(0)).length,
    sinPaso: filas.filter((f) => !f.completo).length,
  };
}

/**
 * Cuánto más te rinde un precio frente a otro, en %: comprando, cuántas unidades más recibís por la misma plata
 * (otro / precio − 1); vendiendo, cuánta plata más cobrás (precio / otro − 1). Positivo = mejor.
 * @param {'compra'|'venta'} lado
 */
export function rinde(precio, otro, lado) {
  const p = toDec(precio);
  const o = toDec(otro);
  return (lado === 'compra' ? o.div(p) : p.div(o)).minus(ONE).times(HUNDRED);
}

/**
 * Opciones de un lado (las que se pueden usar), de la mejor a la peor, con cuánto rinden frente al promedio de todas.
 * @param {ReturnType<typeof prepararPrecios>} precios
 * @param {'compra'|'venta'} lado  compra = comprar USDT (más barato es mejor); venta = vender USDT (más caro es mejor)
 * @returns {{opciones: Array<{id, nombre, p2p, precio, edadMin, rinde}>, promedio: *|null}}
 */
export function opcionesLado(precios, lado) {
  const usar = lado === 'compra' ? 'usarCompra' : 'usarVenta';
  const xs = (precios ?? []).filter((x) => x[usar]);
  if (!xs.length) return { opciones: [], promedio: null };
  const promedio = xs.reduce((a, x) => a.plus(x[lado]), ZERO).div(xs.length);
  const opciones = xs.map((x) => ({ id: x.id, nombre: x.nombre, p2p: x.p2p, precio: x[lado], edadMin: x.edadMin, rinde: rinde(x[lado], promedio, lado) }))
    .sort((a, b) => b.rinde.cmp(a.rinde) || (a.id < b.id ? -1 : 1));
  return { opciones, promedio };
}

/** Exchange más barato para comprar y más caro para vender (entre los que se pueden usar). */
export function mejores(precios) {
  const c = precios.filter((x) => x.usarCompra).sort((a, b) => a.compra.cmp(b.compra));
  const v = precios.filter((x) => x.usarVenta).sort((a, b) => b.venta.cmp(a.venta));
  return { compra: c[0] ?? null, venta: v[0] ?? null };
}

/** Comprar cada USDT a `precio` dólares → como se carga en la calculadora (≥ 1: "pagás X % más caro", exacto; < 1: "te dan X % de más"). */
export function conversionComprando(precio) {
  return precio.gte(1)
    ? { sentido: 'sobreprecio', pct: plain(precio.minus(ONE).times(HUNDRED)) }
    : { sentido: 'dan', pct: plain(round(ONE.div(precio).minus(ONE).times(HUNDRED), 12)) };
}
/** Vender cada USDT a R dólares → como se carga en la calculadora (≤ 1: "te cobran X %"; > 1: "te dan X % de más"; exacto). */
export function conversionVendiendo(R) {
  return R.lte(1) ? { sentido: 'cobran', pct: plain(ONE.minus(R).times(HUNDRED)) } : { sentido: 'dan', pct: plain(R.minus(ONE).times(HUNDRED)) };
}

/**
 * Lo que hay que cargar en la calculadora simple para ver la misma combinación (mismo resultado si los demás costos
 * son 0). Con precios "con comisiones" las comisiones del exchange quedan como «no aplica» (ya están en el precio).
 * @returns {{tipo: 'calculadora', compra, venta, modo: 'ars', monto, base, precioVenta, conversionPct, sentido, costos}}
 */
export function accionCalculadora(fila, { monto, conComisiones = true, mercado = null }) {
  const enPrecio = conComisiones ? 'no aplica' : null;
  const transf = fila.paso.mismo ? 'no aplica' : fila.paso.conocida ? plain(fila.paso.retiro) : null;
  const comun = { tipo: 'calculadora', modo: 'ars', monto: plain(toDec(monto)) };
  if (fila.familia === 'dolares') {
    const c = conversionComprando(fila.compra);
    return { ...comun, compra: mercado.id, venta: 'cripto', base: plain(toDec(mercado.venta)), precioVenta: plain(fila.venta), conversionPct: c.pct, sentido: c.sentido,
      costos: { comVenta: enPrecio, transf, transfCobro: 'descuenta_destino' } };
  }
  if (fila.familia === 'adolares') {
    const c = conversionVendiendo(fila.venta);
    return { ...comun, compra: 'cripto', venta: mercado.id, base: plain(fila.compra), precioVenta: plain(toDec(mercado.compra)), conversionPct: c.pct, sentido: c.sentido,
      costos: { comCompra: enPrecio, transf, transfCobro: 'descuenta_origen' } };
  }
  return { ...comun, compra: 'cripto', venta: 'cripto', base: plain(fila.compra), precioVenta: plain(fila.venta), conversionPct: '', sentido: 'cobran',
    costos: { comCompra: enPrecio, comVenta: enPrecio, transf, transfCobro: 'descuenta_origen' } };
}
