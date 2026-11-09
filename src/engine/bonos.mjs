// MEP y CCL con bonos: el tipo de cambio sale de dos operaciones de títulos (comprar el bono en una moneda y
// venderlo en la otra), cada una con sus puntas, comisiones (con mínimo), derechos de mercado, IVA e impuestos.
// No se inventan tarifas, plazos de parking ni reglas normativas: todo lo carga el usuario (vacío = no sé).
// Precios por cada 100 de valor nominal (VN), como cotizan los bonos.
import { Dec, ZERO, ONE, HUNDRED, pct } from './decimal.mjs';
import { checkField } from './validate.mjs';
import { checkCosto, calidadDe } from './costos.mjs';

export const SENTIDOS = {
  comprar_usd: 'Comprar dólares (pesos → bono → dólares)',
  vender_usd: 'Vender dólares (dólares → bono → pesos)',
};
const CAMPOS_PATA = [
  ['comisionPct', 'comisión %'], ['comisionMinimo', 'comisión mínima'], ['derechosPct', 'derechos de mercado %'],
  ['ivaPct', 'IVA sobre comisión y derechos %'], ['impuestosPct', 'impuestos %'],
];

/**
 * @param {{sentido: keyof SENTIDOS, monto: *, precioPesos: *, precioDolares: *, loteMinimo?: *,
 *   pesos?: object, dolares?: object, plazoPesos?: *, plazoDolares?: *, parkingDias?: *, liquidezVN?: *, referencia?: *}} e
 *   pesos / dolares: {comisionPct, comisionMinimo, derechosPct, ivaPct, impuestosPct} de cada pata (vacío = no sé)
 */
export function calcularBonos(e = {}) {
  const ctx = { errors: [], values: {}, estados: {} };
  const sentido = e.sentido ?? 'comprar_usd';
  if (!(sentido in SENTIDOS)) ctx.errors.push({ field: 'sentido', code: 'invalido', message: 'Sentido inválido.' });
  const comprar = sentido === 'comprar_usd';
  checkField(ctx, 'monto', comprar ? 'Pesos que querés usar' : 'Dólares que querés vender', e.monto, { required: true, min: 0, minExclusive: true });
  checkField(ctx, 'precioPesos', 'Precio del bono en pesos (por 100 VN)', e.precioPesos, { required: true, min: 0, minExclusive: true });
  checkField(ctx, 'precioDolares', 'Precio del bono en dólares (por 100 VN)', e.precioDolares, { required: true, min: 0, minExclusive: true });
  checkField(ctx, 'loteMinimo', 'Lote mínimo (VN)', e.loteMinimo, { default: 1, min: 0, minExclusive: true });
  for (const k of ['plazoPesos', 'plazoDolares', 'parkingDias']) checkField(ctx, k, k, e[k], { min: 0 });
  checkField(ctx, 'liquidezVN', 'Liquidez (VN)', e.liquidezVN, { min: 0 });
  checkField(ctx, 'referencia', 'Cotización de referencia', e.referencia, { min: 0, minExclusive: true });
  const desconocidos = [];
  const pata = (nombre, crudo = {}) => {
    const out = {};
    for (const [k, etiqueta] of CAMPOS_PATA) {
      const r = checkCosto(ctx, `${nombre}.${k}`, `${nombre === 'pesos' ? 'Pata en pesos' : 'Pata en dólares'} · ${etiqueta}`, crudo[k], { min: 0, ...(k === 'comisionPct' ? { max: 100, maxExclusive: true } : {}) });
      out[k] = r.valor;
      if (r.estado === 'desconocido') desconocidos.push({ campo: `${nombre}.${k}`, etiqueta: `${nombre === 'pesos' ? 'pata en pesos' : 'pata en dólares'}: ${etiqueta}`, texto: `${nombre === 'pesos' ? 'Pata en pesos' : 'Pata en dólares'}: ${etiqueta}` });
    }
    return out;
  };
  const cp = pata('pesos', e.pesos);
  const cd = pata('dolares', e.dolares);
  if (ctx.errors.length) {
    const insuf = ctx.errors.filter((x) => x.code === 'requerido');
    return { ok: false, errors: ctx.errors, datosInsuficientes: insuf.length > 0 && insuf.length === ctx.errors.length, calidad: { nivel: 'insuficiente', insuficientes: insuf.map((x) => x.message), desconocidos: [], hipotesis: [] } };
  }
  const v = ctx.values;
  const lote = v.loteMinimo;
  const p = v.precioPesos.div(HUNDRED);
  const q = v.precioDolares.div(HUNDRED);
  // La primera pata compra el bono con lo que tenés; la segunda lo vende en la otra moneda.
  const [precioCompra, costosCompra, precioVenta, costosVenta] = comprar ? [p, cp, q, cd] : [q, cd, p, cp];

  const pataCompra = (vn) => costosDePata(vn.times(precioCompra), costosCompra, 'compra');
  // Máximo VN (múltiplo del lote) que se puede comprar con el monto
  const fProp = ONE.plus(pct(costosCompra.comisionPct)).plus(pct(costosCompra.derechosPct)).plus(pct(costosCompra.ivaPct).times(pct(costosCompra.comisionPct).plus(pct(costosCompra.derechosPct)))).plus(pct(costosCompra.impuestosPct));
  const aLote = (x) => x.div(lote).round(0, 0).times(lote);
  let vn = aLote(v.monto.div(precioCompra.times(fProp)));
  if (vn.gt(0) && pataCompra(vn).comisionAlMinimo) {
    const fMin = ONE.plus(pct(costosCompra.derechosPct)).plus(pct(costosCompra.ivaPct).times(pct(costosCompra.derechosPct))).plus(pct(costosCompra.impuestosPct));
    const fijo = costosCompra.comisionMinimo.times(ONE.plus(pct(costosCompra.ivaPct)));
    vn = v.monto.gt(fijo) ? aLote(v.monto.minus(fijo).div(precioCompra.times(fMin))) : ZERO;
  }
  for (let k = 0; k < 5 && vn.gt(0) && pataCompra(vn).total.gt(v.monto); k++) vn = vn.minus(lote);
  if (vn.lte(0)) return { ok: false, errors: [{ field: 'monto', code: 'insuficiente', message: 'El monto no alcanza para comprar el lote mínimo con sus costos.' }], datosInsuficientes: false, calidad: { nivel: 'insuficiente', insuficientes: [], desconocidos: [], hipotesis: [] } };

  const compra = pataCompra(vn);
  const venta = costosDePata(vn.times(precioVenta), costosVenta, 'venta');
  if (venta.neto.lte(0)) return { ok: false, errors: [{ field: 'dolares', code: 'sin_saldo', message: 'Los costos de la venta se comen todo lo que recibís.' }], datosInsuficientes: false, calidad: { nivel: 'insuficiente', insuficientes: [], desconocidos: [], hipotesis: [] } };
  const pesosGastadosORecibidos = comprar ? compra.total : venta.neto;
  const dolares = comprar ? venta.neto : compra.total;
  const tcEfectivo = pesosGastadosORecibidos.div(dolares);
  const tcSinCostos = p.div(q);
  const violaciones = [];
  if (v.liquidezVN !== null && v.liquidezVN !== undefined && vn.gt(v.liquidezVN)) violaciones.push(`Los ${vn.toFixed()} VN superan la liquidez informada (${v.liquidezVN.toFixed()} VN).`);
  const dias = [v.plazoPesos, v.plazoDolares, v.parkingDias].reduce((a, x) => (x ? a.plus(x) : a), ZERO);
  const calidad = calidadDe({ desconocidos });
  return {
    ok: true, errors: [], calidad, sentido,
    result: {
      vn, gastado: { monto: compra.total, moneda: comprar ? 'ARS' : 'USD' }, recibido: { monto: venta.neto, moneda: comprar ? 'USD' : 'ARS' },
      sobrante: v.monto.minus(compra.total), patas: { compra, venta },
      tcEfectivo, tcSinCostos, costoTcPct: (comprar ? tcEfectivo.div(tcSinCostos).minus(ONE) : ONE.minus(tcEfectivo.div(tcSinCostos))).times(HUNDRED),
      difReferenciaPct: v.referencia ? tcEfectivo.div(v.referencia).minus(ONE).times(HUNDRED) : null,
      diasHabiles: dias, parkingDias: v.parkingDias ?? null, violaciones,
    },
  };
}

/** Costos de una pata. Compra: se suman a lo que pagás. Venta: se descuentan de lo que cobrás. */
function costosDePata(bruto, c, lado) {
  const pc = bruto.times(pct(c.comisionPct));
  const comisionAlMinimo = c.comisionMinimo.gt(0) && pc.lt(c.comisionMinimo);
  const comision = comisionAlMinimo ? c.comisionMinimo : pc;
  const derechos = bruto.times(pct(c.derechosPct));
  const iva = comision.plus(derechos).times(pct(c.ivaPct));
  const impuestos = bruto.times(pct(c.impuestosPct));
  const costos = comision.plus(derechos).plus(iva).plus(impuestos);
  return lado === 'compra'
    ? { bruto, comision, comisionAlMinimo, derechos, iva, impuestos, costos, total: bruto.plus(costos) }
    : { bruto, comision, comisionAlMinimo, derechos, iva, impuestos, costos, neto: bruto.minus(costos) };
}

export { Dec };
