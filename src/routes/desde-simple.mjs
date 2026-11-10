// Convierte una operación de la calculadora simple en una ruta por pasos equivalente (mismo resultado,
// mismos costos, mismas faltas). Hace explícito lo que la simple resume: si comprás un dólar y vendés otro
// distinto, aparece un paso de conversión con su relación R (que hay que confirmar).
// Cada costo se pasa una sola vez y con su misma base: no se duplican comisiones.
import { calcularSimple } from '../engine/simple.mjs';
import { NO_APLICA } from '../engine/costos.mjs';
import { MERCADO_A_ACTIVO, corto } from './activos.mjs';
import { textoConversion } from '../engine/conversion.mjs';
import { formatNumberAR } from '../engine/format.mjs';

/**
 * @param {import('../engine/simple.mjs').EntradaSimple} entradaSimple
 * @param {string} mercadoCompra id de mercado (oficial, blue, mep, ccl, cripto)
 * @param {string} mercadoVenta
 * @returns {{ok: false, errors: Array} | {ok: true, entrada: object, notas: Record<number, string>, simple: object}}
 */
export function rutaDesdeSimple(entradaSimple, mercadoCompra, mercadoVenta) {
  const sim = calcularSimple(entradaSimple);
  if (!sim.ok) return { ok: false, errors: sim.errors, datosInsuficientes: sim.datosInsuficientes };
  const A1 = MERCADO_A_ACTIVO[mercadoCompra];
  const A2 = MERCADO_A_ACTIVO[mercadoVenta];
  if (!A1 || !A2) return { ok: false, errors: [{ field: 'mercado', code: 'invalido', message: 'Mercado desconocido.' }] };

  const v = sim.values;
  const r = sim.result;
  const est = v.estados;
  const R = v.relacionConversion;
  const notas = {};
  /** "te cobran 1,5 %" o "pagás 2 % arriba del precio": como se cargó en la calculadora. */
  const textoCosto = (rel) => textoConversion(entradaSimple.conversionDicha ?? null, rel);
  /** Valor para la ruta: lo que no sabés sigue sin saberse; "no aplica" sigue sin aplicar. */
  const m = (k) => (est[k] === 'desconocido' ? null : est[k] === 'no_aplica' ? NO_APLICA : v[k]);
  const sinComision = (k) => est[k] === 'cero' || est[k] === 'no_aplica';
  const iva = (kComision) => (sinComision(kComision) ? NO_APLICA : m('ivaComisionesPct'));
  const fijosDe = (cobro, lado, sufijo = '') => {
    const out = [];
    if (v.cobroOtros === cobro) out.push({ id: `otros${sufijo}`, concepto: 'Otros costos fijos', clase: 'fijo', valor: m('otrosCostos'), lado });
    if (v.cobroTransferencia === cobro) out.push({ id: `transferencia${sufijo}`, concepto: 'Costo de transferencia', clase: 'fijo', valor: m('costoTransferencia'), lado });
    return out;
  };

  const pasos = [{
    desde: 'ARS',
    hacia: A1,
    cotizacion: r.precioCompraFinal,
    base: 'origen_por_destino',
    slippagePct: NO_APLICA, // la calculadora simple no tiene slippage al comprar
    costos: [
      { id: 'comision_compra', concepto: 'Comisión de compra', clase: 'pct', valor: m('comisionCompraPct'), lado: 'origen', base: 'neto', fiscal: 'no_fiscal' },
      { id: 'impuestos', concepto: 'Impuestos sobre la compra', clase: 'pct', valor: m('impuestoCompraPct'), lado: 'origen', base: 'neto', fiscal: v.impuestoFiscal },
      { id: 'iva_compra', concepto: 'IVA sobre la comisión de compra', clase: 'pct', valor: iva('comisionCompraPct'), lado: 'origen', base: 'concepto', sobre: 'comision_compra', fiscal: v.ivaFiscal },
      ...fijosDe('suma_capital', 'aparte'),
    ],
  }];
  notas[0] = 'Desde la calculadora simple (que no considera slippage al comprar).';
  if (!v.aumentoPct.eq(0)) notas[0] += ' La cotización ya incluye el aumento %.';

  let precioVenta = v.precioVenta;
  const costosVenta = [
    { id: 'comision_venta', concepto: 'Comisión de venta', clase: 'pct', valor: m('comisionVentaPct'), lado: 'destino', base: 'bruto', fiscal: 'no_fiscal' },
    { id: 'iva_venta', concepto: 'IVA sobre la comisión de venta', clase: 'pct', valor: iva('comisionVentaPct'), lado: 'destino', base: 'concepto', sobre: 'comision_venta', fiscal: v.ivaFiscal },
    ...fijosDe('descuenta_recibido', 'destino', '_recibido'),
  ];
  if (A1 !== A2) {
    pasos.push({
      desde: A1,
      hacia: A2,
      cotizacion: R,
      cotizacionHipotesis: v.relacionHipotesis,
      base: 'destino_por_origen',
      slippagePct: NO_APLICA,
      costos: [...fijosDe('descuenta_origen', 'origen'), ...fijosDe('descuenta_destino', 'destino')],
    });
    notas[1] = v.relacionHipotesis
      ? `Conversión ${corto(A1)} → ${corto(A2)} cargada como hipótesis (${textoCosto(R)}): confirmala con tu plataforma.`
      : `Conversión tomada de la calculadora simple: ${textoCosto(R)} (por eso la cotización es ${formatNumberAR(R, { decimals: 8, minDecimals: 0 })}).`;
  } else {
    // Mismo activo: la relación R y los costos en unidades se aplican sobre el paso de venta.
    if (!R.eq(1)) {
      precioVenta = precioVenta.times(R);
      notas[1] = `La cotización incluye el costo de la conversión de la calculadora simple (${textoCosto(R)}).`;
    }
    for (const c of fijosDe('descuenta_origen', 'origen')) costosVenta.push(c);
    for (const c of fijosDe('descuenta_destino', 'origen')) {
      // Unidades de destino → unidades del activo que se vende (÷ R)
      costosVenta.push({ ...c, valor: c.valor === null || c.valor === NO_APLICA ? c.valor : c.valor.div(R) });
    }
  }
  pasos.push({
    desde: A2,
    hacia: 'ARS',
    cotizacion: precioVenta,
    base: 'destino_por_origen',
    slippagePct: m('slippageVentaPct'),
    costos: costosVenta,
  });

  const Fcap = r.fijos.suma_capital;
  const montoInicial = v.modoMonto === 'ars' ? v.monto.minus(Fcap) : r.inversionTotal.minus(Fcap);
  return { ok: true, entrada: { activoInicial: 'ARS', montoInicial, estresPct: null, pasos }, notas, simple: sim };
}
