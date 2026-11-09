// Calculadora simple: comprar en un mercado y vender en otro.
// Conserva las fórmulas de docs/calculadora-brecha.md cuando todos los costos son 0. Unidades y bases: docs/motor-financiero.md
// Regla: un costo vacío es "No sé" (el resultado queda INCOMPLETO, como cota máxima), nunca 0 en silencio.
// Si comprás un instrumento y vendés otro, la relación de conversión es obligatoria (nunca se supone 1:1).
import { ZERO, ONE, HUNDRED, pct, sign, decimalPlaces, toDec } from './decimal.mjs';
import { checkField } from './validate.mjs';
import { checkCosto, TRATAMIENTOS, esRecuperable, calidadDe } from './costos.mjs';
import { OBJETIVOS_PCT, VERSION_MOTOR } from './route.mjs';

export const MODOS_MONTO = ['unidades', 'ars'];
export const UNIDADES_TRANSFERENCIA = ['ARS', 'origen', 'destino'];
/** Cómo se cobra un costo fijo de la calculadora simple (cada uno define su moneda y su momento). */
export const COBROS_FIJOS = {
  suma_capital: { moneda: 'ARS', momento: 'al empezar', texto: 'Se suma a lo que pagás (ARS)' },
  descuenta_recibido: { moneda: 'ARS', momento: 'al vender', texto: 'Se descuenta de los pesos que cobrás (ARS)' },
  descuenta_origen: { moneda: 'origen', momento: 'después de comprar', texto: 'Se descuenta de las unidades compradas' },
  descuenta_destino: { moneda: 'destino', momento: 'antes de vender', texto: 'Se descuenta de las unidades recibidas' },
};
const COBRO_DE_UNIDAD = { ARS: 'suma_capital', origen: 'descuenta_origen', destino: 'descuenta_destino' };

/** Precio de compra final = cotización base × (1 + aumento / 100). Fórmula original. */
export function precioCompraFinal(cotizacionBase, aumentoPct = 0) {
  return toDec(cotizacionBase).times(ONE.plus(pct(aumentoPct ?? 0)));
}

/**
 * @typedef {object} EntradaSimple  Valores en formato máquina (Dec, number o "1650.69").
 * @property {'unidades'|'ars'} [modoMonto]
 * @property {*} monto                 Q (unidades de origen) o presupuesto ARS total
 * @property {*} cotizacionBase        B, ARS por unidad de origen (precio "venta" del mercado donde comprás)
 * @property {*} [aumentoPct]          A, % sobre B. 0 a 100. Vacío = 0 (es un ajuste opcional, no un costo)
 * @property {*} precioVenta           V, ARS por unidad de destino (precio "compra" del mercado donde vendés)
 * @property {*} [relacionConversion]  R, unidades de destino por unidad de origen
 * @property {boolean} [requiereConversion]  true si comprás un instrumento y vendés otro: R es obligatorio
 * @property {boolean} [relacionHipotesis]   R es una hipótesis tuya (resultado ESTIMADO)
 * @property {*} [comisionCompraPct]   Cc, % sobre la compra (Q × P). Vacío = no sé
 * @property {*} [comisionVentaPct]    Cv, % sobre el ingreso efectivo de la venta
 * @property {*} [impuestoCompraPct]   T, % sobre la compra (Q × P)
 * @property {keyof TRATAMIENTOS} [impuestoFiscal]  tratamiento del impuesto (por defecto: pendiente de determinar)
 * @property {*} [ivaComisionesPct]    % sobre las comisiones (p. ej. IVA)
 * @property {keyof TRATAMIENTOS} [ivaFiscal]
 * @property {{monto: *, cobro?: keyof COBROS_FIJOS}} [otrosCostos]  (formato anterior: otrosCostosARS = se suma a lo que pagás)
 * @property {{monto: *, cobro?: keyof COBROS_FIJOS, unidad?: 'ARS'|'origen'|'destino'}} [costoTransferencia]
 * @property {*} [slippageVentaPct]    s, % que se pierde sobre V al vender
 */

/**
 * @param {EntradaSimple} entrada
 * @returns {{ok: boolean, errors: Array, warnings: Array, values: object, calidad: object, datosInsuficientes?: boolean, result: object|null}}
 */
export function calcularSimple(entrada = {}) {
  if (!entrada || typeof entrada !== 'object') entrada = {};
  const ctx = { errors: [], values: {}, estados: {} };
  const modo = entrada.modoMonto ?? 'unidades';
  if (!MODOS_MONTO.includes(modo)) ctx.errors.push({ field: 'modoMonto', code: 'invalido', message: 'Modo de monto inválido.' });

  checkField(ctx, 'monto', modo === 'ars' ? 'Presupuesto en ARS' : 'Monto', entrada.monto, { required: true, min: 0, minExclusive: true });
  checkField(ctx, 'cotizacionBase', 'Cotización base de compra', entrada.cotizacionBase, { required: true, min: 0, minExclusive: true });
  checkField(ctx, 'aumentoPct', 'Aumento del precio de compra', entrada.aumentoPct, { default: 0, min: 0, max: 100 });
  checkField(ctx, 'precioVenta', 'Precio de venta', entrada.precioVenta, { required: true, min: 0, minExclusive: true });

  // Conversión: obligatoria si los instrumentos son distintos. Nunca se supone 1:1.
  const requiere = entrada.requiereConversion === true;
  const vacioR = entrada.relacionConversion === null || entrada.relacionConversion === undefined || (typeof entrada.relacionConversion === 'string' && entrada.relacionConversion.trim() === '');
  if (requiere && vacioR) {
    ctx.errors.push({
      field: 'relacionConversion', code: 'requerido',
      message: 'Falta la relación de conversión: cuántas unidades del instrumento que vendés recibís por cada unidad del que comprás (con sus costos). Sin ese dato no se puede calcular; si querés probar un supuesto, cargalo y marcalo como hipótesis.',
    });
    ctx.values.relacionConversion = null;
  } else {
    checkField(ctx, 'relacionConversion', 'Relación de conversión', entrada.relacionConversion, { default: 1, min: 0, minExclusive: true });
  }

  checkCosto(ctx, 'comisionCompraPct', 'Comisión de compra', entrada.comisionCompraPct, { min: 0, max: 100, maxExclusive: true });
  checkCosto(ctx, 'comisionVentaPct', 'Comisión de venta', entrada.comisionVentaPct, { min: 0, max: 100, maxExclusive: true });
  checkCosto(ctx, 'impuestoCompraPct', 'Impuestos sobre la compra', entrada.impuestoCompraPct, { min: 0 });
  checkCosto(ctx, 'ivaComisionesPct', 'IVA u otro % sobre las comisiones', entrada.ivaComisionesPct, { min: 0 });
  checkCosto(ctx, 'slippageVentaPct', 'Slippage de venta', entrada.slippageVentaPct, { min: 0, max: 100, maxExclusive: true });
  const impuestoFiscal = entrada.impuestoFiscal ?? 'pendiente';
  const ivaFiscal = entrada.ivaFiscal ?? 'pendiente';
  for (const [k, t] of [['impuestoFiscal', impuestoFiscal], ['ivaFiscal', ivaFiscal]]) {
    if (!Object.hasOwn(TRATAMIENTOS, t)) ctx.errors.push({ field: k, code: 'invalido', message: 'Tratamiento fiscal inválido.' });
  }

  // Costos fijos: importe + cómo se cobra (que define moneda y momento).
  const fijo = (campo, label, raw) => {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { monto: raw };
    const cobro = obj.cobro ?? COBRO_DE_UNIDAD[obj.unidad ?? 'ARS'];
    if (!Object.hasOwn(COBROS_FIJOS, cobro)) ctx.errors.push({ field: campo, code: 'invalido', message: `${label}: forma de cobro inválida.` });
    checkCosto(ctx, campo, label, obj.monto, { min: 0 });
    return cobro;
  };
  const otrosRaw = entrada.otrosCostos ?? (entrada.otrosCostosARS !== undefined ? { monto: entrada.otrosCostosARS, cobro: 'suma_capital' } : undefined);
  const cobroOtros = fijo('otrosCostos', 'Otros costos fijos', otrosRaw);
  const cobroT = fijo('costoTransferencia', 'Costo de transferencia', entrada.costoTransferencia);

  const warnings = [];
  const v = ctx.values;
  const est = ctx.estados;
  // Comisión de venta + IVA sobre ella tienen que dejar algo
  if (!ctx.errors.length && v.comisionVentaPct.times(ONE.plus(pct(v.ivaComisionesPct))).gte(HUNDRED)) {
    ctx.errors.push({ field: 'ivaComisionesPct', code: 'fuera_de_rango', message: 'La comisión de venta más su IVA no pueden llegar al 100 %.' });
  }
  if (ctx.errors.length) return fallo(ctx, warnings);

  const B = v.cotizacionBase, A = v.aumentoPct, V = v.precioVenta, R = v.relacionConversion;
  const Cc = v.comisionCompraPct, Cv = v.comisionVentaPct, T = v.impuestoCompraPct, I = v.ivaComisionesPct, s = v.slippageVentaPct;
  const fijos = { suma_capital: ZERO, descuenta_recibido: ZERO, descuenta_origen: ZERO, descuenta_destino: ZERO };
  fijos[cobroOtros] = fijos[cobroOtros].plus(v.otrosCostos);
  fijos[cobroT] = fijos[cobroT].plus(v.costoTransferencia);
  const Fcap = fijos.suma_capital, Frec = fijos.descuenta_recibido, Uo = fijos.descuenta_origen, Ud = fijos.descuenta_destino;

  const P = precioCompraFinal(B, A);

  // Cantidad de unidades de origen
  let Q;
  if (modo === 'ars') {
    const X = v.monto;
    if (X.lte(Fcap)) return bloqueado(ctx, warnings, 'monto', 'presupuesto_insuficiente', 'El presupuesto no alcanza para cubrir los costos fijos que se suman a lo que pagás.');
    Q = X.minus(Fcap).div(P.times(ONE.plus(pct(Cc)).plus(pct(T)).plus(pct(Cc).times(pct(I)))));
  } else {
    Q = v.monto;
  }

  const unidadesOrigenNetas = Q.minus(Uo);
  if (unidadesOrigenNetas.lte(0)) return bloqueado(ctx, warnings, 'costoTransferencia', 'transferencia_excede', 'Los costos que se descuentan de las unidades compradas son iguales o mayores a la cantidad comprada.');
  const unidadesRecibidas = unidadesOrigenNetas.times(R).minus(Ud);
  if (unidadesRecibidas.lte(0)) return bloqueado(ctx, warnings, 'costoTransferencia', 'transferencia_excede', 'Los costos que se descuentan de las unidades recibidas son iguales o mayores a lo que recibís.');

  const compra = Q.times(P);
  const comisionCompra = compra.times(pct(Cc));
  const impuestoCompra = compra.times(pct(T));
  const ivaCompra = comisionCompra.times(pct(I));
  const precioVentaEfectivo = V.times(ONE.minus(pct(s)));
  const ingresoBruto = Q.times(R).times(V); // "Ingreso por venta" original, a cotización
  const ingresoEfectivo = unidadesRecibidas.times(precioVentaEfectivo);
  const comisionVenta = ingresoEfectivo.times(pct(Cv));
  const ivaVenta = comisionVenta.times(pct(I));
  const costoTransferenciaUnidadesARS = Uo.times(R).plus(Ud).times(V); // valorizado a V
  const costoSlippage = unidadesRecibidas.times(V).times(pct(s));

  const inversionTotal = compra.plus(comisionCompra).plus(impuestoCompra).plus(ivaCompra).plus(Fcap);
  const capitalFinal = ingresoEfectivo.minus(comisionVenta).minus(ivaVenta).minus(Frec);
  if (capitalFinal.lte(0)) return bloqueado(ctx, warnings, 'otrosCostos', 'costos_exceden', 'Los costos que se descuentan de los pesos que cobrás son iguales o mayores a lo que cobrás.');
  const resultadoNeto = capitalFinal.minus(inversionTotal);
  const costosTotales = comisionCompra.plus(impuestoCompra).plus(ivaCompra).plus(comisionVenta).plus(ivaVenta).plus(Fcap).plus(Frec)
    .plus(costoTransferenciaUnidadesARS).plus(costoSlippage);

  const roiPct = resultadoNeto.div(inversionTotal).times(HUNDRED);
  const brechaNominalPct = V.div(P).minus(ONE).times(HUNDRED);
  const brechaAjustadaPct = R.times(V).div(P).minus(ONE).times(HUNDRED);

  // Precios de venta objetivo: el resultado es lineal en V → solución exacta con todos los costos.
  // El equilibrio sale de una sola división exacta; los demás objetivos, de A·(1+g) + B (A y B a 40 decimales).
  const K = unidadesRecibidas.times(ONE.minus(pct(s))).times(ONE.minus(pct(Cv).times(ONE.plus(pct(I)))));
  const eq0 = inversionTotal.plus(Frec).div(K);
  const Ainv = inversionTotal.div(K);
  const Bfrec = Frec.eq(0) ? ZERO : Frec.div(K);
  const invV = ONE.div(V);
  const objetivosPrecio = OBJETIVOS_PCT.map((g) => {
    const precio = g === '0' ? eq0 : Ainv.times(ONE.plus(pct(g))).plus(Bfrec);
    return {
      objetivoPct: g, precio, diferencia: V.minus(precio),
      margenSeguridadPct: ONE.minus(precio.times(invV)).times(HUNDRED),
      margenPct: g === '0' ? V.div(precio).minus(ONE).times(HUNDRED) : null,
    };
  });
  const equilibrioVenta = objetivosPrecio[0].precio;
  const margenHastaEquilibrioPct = objetivosPrecio[0].margenPct;

  const st = sign(resultadoNeto);
  const estado = st > 0 ? 'ganancia' : st < 0 ? 'perdida' : 'neutro';

  // Fiscal: caja vs económico
  const conceptos = [
    { concepto: 'Impuestos sobre la compra', fiscal: impuestoFiscal, monto: impuestoCompra },
    { concepto: 'IVA u otro % sobre las comisiones', fiscal: ivaFiscal, monto: ivaCompra.plus(ivaVenta) },
  ].filter((c) => c.monto.gt(0));
  const recuperables = conceptos.filter((c) => esRecuperable(c.fiscal)).reduce((a, c) => a.plus(c.monto), ZERO);
  const pendientes = conceptos.filter((c) => c.fiscal === 'pendiente').reduce((a, c) => a.plus(c.monto), ZERO);
  const min = resultadoNeto.plus(recuperables);
  const resultadoEconomico = { min, max: min.plus(pendientes), determinado: pendientes.eq(0) };

  // Calidad: costos que no conocés e hipótesis
  const desconocidos = [];
  const etiquetas = {
    comisionCompraPct: 'comisión de compra', comisionVentaPct: 'comisión de venta', impuestoCompraPct: 'impuestos sobre la compra',
    otrosCostos: 'otros costos fijos', costoTransferencia: 'costo de transferencia', slippageVentaPct: 'slippage en la venta',
    ivaComisionesPct: 'IVA u otro % sobre las comisiones',
  };
  for (const k of Object.keys(etiquetas)) {
    if (est[k] !== 'desconocido') continue;
    // El IVA sobre comisiones sólo importa si hay (o puede haber) comisiones.
    if (k === 'ivaComisionesPct' && ['no_aplica', 'cero'].includes(est.comisionCompraPct) && ['no_aplica', 'cero'].includes(est.comisionVentaPct)) continue;
    desconocidos.push({ campo: k, etiqueta: etiquetas[k], texto: etiquetas[k] });
  }
  const hipotesis = entrada.relacionHipotesis === true ? [{ campo: 'relacionConversion', etiqueta: 'la relación de conversión es una hipótesis', texto: 'la relación de conversión es una hipótesis' }] : [];
  const calidad = calidadDe({ desconocidos, hipotesis });

  // Advertencias
  if (desconocidos.length) warnings.push({ code: 'costos_desconocidos', message: `Faltan ${desconocidos.length} costos que no conocés (${desconocidos.map((d) => d.etiqueta).join(', ')}): el resultado es una cota máxima.` });
  if (!R.eq(1)) warnings.push({ code: 'r_distinto_de_1', message: 'Con relación de conversión distinta de 1, la brecha nominal no es comparable: mirá la brecha ajustada por conversión.' });
  if (R.lt('0.5') || R.gt(2)) warnings.push({ code: 'r_inusual', message: 'La relación de conversión es inusual: revisá que las unidades sean las correctas.' });
  if (brechaAjustadaPct.gt(0) && st <= 0) warnings.push({ code: 'costos_eliminan_brecha', message: 'Hay brecha positiva, pero los costos se comen la ganancia.' });
  if (Cc.gt(10) || Cv.gt(10)) warnings.push({ code: 'comision_alta', message: 'Hay una comisión mayor al 10 %: revisá que esté bien cargada.' });
  if (T.gt(100)) warnings.push({ code: 'impuesto_alto', message: 'Los impuestos superan el 100 % de la compra: revisá el dato.' });
  if (A.gt(50)) warnings.push({ code: 'aumento_alto', message: 'El aumento sobre el precio de compra supera el 50 %.' });
  if (modo === 'ars' && decimalPlaces(Q) > 2) {
    warnings.push({ code: 'cantidad_fraccionaria', message: 'La cantidad calculada tiene más de 2 decimales; en la práctica se redondea a centavos.' });
  }

  return {
    ok: true,
    errors: [],
    warnings,
    calidad,
    values: { ...v, modoMonto: modo, unidadTransferencia: cobroT === 'suma_capital' ? 'ARS' : cobroT === 'descuenta_origen' ? 'origen' : cobroT === 'descuenta_destino' ? 'destino' : 'ARS', cobroOtros, cobroTransferencia: cobroT, impuestoFiscal, ivaFiscal, estados: { ...est }, requiereConversion: requiere, relacionHipotesis: entrada.relacionHipotesis === true },
    result: {
      version: VERSION_MOTOR,
      estado,
      precioCompraFinal: P,
      cantidadOrigen: Q,
      unidadesOrigenNetas,
      unidadesRecibidas,
      precioVentaEfectivo,
      compra,
      comisionCompra,
      impuestoCompra,
      ivaCompra,
      ivaVenta,
      fijos,
      otrosCostosARS: Fcap, // compatibilidad: costos fijos que se suman a lo que pagás
      costoTransferenciaARS: cobroT === 'suma_capital' ? v.costoTransferencia : ZERO,
      costoTransferenciaUnidadesARS,
      costoSlippage,
      ingresoBruto,
      ingresoEfectivo,
      comisionVenta,
      costosTotales,
      inversionTotal,
      capitalInicial: inversionTotal,
      capitalFinal,
      resultadoNeto,
      resultadoCaja: resultadoNeto,
      resultadoEconomico,
      fiscal: { recuperables, pendientes, conceptos },
      roiPct,
      brechaNominalPct,
      brechaAjustadaPct,
      equilibrioVenta,
      margenHastaEquilibrioPct,
      objetivosPrecio,
      resultadoParcial: desconocidos.length > 0,
      calidad,
    },
  };
}

function fallo(ctx, warnings) {
  const insuf = ctx.errors.filter((e) => e.code === 'requerido');
  return {
    ok: false, errors: ctx.errors, warnings, values: ctx.values, result: null,
    datosInsuficientes: insuf.length > 0 && insuf.length === ctx.errors.length,
    calidad: { nivel: 'insuficiente', insuficientes: insuf.map((e) => e.message), desconocidos: [], hipotesis: [] },
  };
}

function bloqueado(ctx, warnings, field, code, message) {
  return { ok: false, errors: [{ field, code, message }], warnings, values: ctx.values, result: null, datosInsuficientes: false, calidad: { nivel: 'insuficiente', insuficientes: [], desconocidos: [], hipotesis: [] } };
}
