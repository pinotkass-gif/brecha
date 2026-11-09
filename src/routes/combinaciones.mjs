// Cada combinación de la matriz (comprar en un mercado, vender en otro) como ruta por pasos con los
// costos del perfil. Así la vista neta usa el mismo motor que el simulador.
// Una conversión que no cargaste NO se supone 1:1: la combinación queda en DATOS INSUFICIENTES (sin ROI).
import { simularRuta } from '../engine/route.mjs';
import { NO_APLICA } from '../engine/costos.mjs';
import { MERCADO_A_ACTIVO, IDS_ACTIVOS, ACTIVOS, corto } from './activos.mjs';
import { IDS_MERCADOS, mercadoPorId } from '../quotes/markets.mjs';
import { CAMPOS_MERCADO } from './perfil.mjs';

const nombre = (id) => mercadoPorId(id)?.nombre ?? id;
const DECIMALES = Object.fromEntries(ACTIVOS.map((a) => [a.id, a.precision]));
const NOMBRES = Object.fromEntries(ACTIVOS.map((a) => [a.id, a.corto]));
const etiquetaCampo = (k) => CAMPOS_MERCADO.find((c) => c.k === k)?.label.toLowerCase() ?? k;

/**
 * @param {string} compra  mercado donde comprás (se usa su precio de venta)
 * @param {string} venta   mercado donde vendés (se usa su precio de compra)
 * @param {Record<string, object>} mercados  cotizaciones (src/quotes/store.mjs)
 * @param {ReturnType<import('./perfil.mjs').normalizarPerfil>} perfil
 * @returns {{ok: false, motivo: 'sin_dato'|'sin_monto'|'sin_conversion', falta?: object} | {ok: true, entrada: object, parcial: string[], notas: Record<number, string>}}
 */
export function rutaDeCombinacion(compra, venta, mercados, perfil) {
  const usable = (m, punta) => (m && m.valido !== false && m[punta] ? m[punta] : null);
  const precioCompra = usable(mercados[compra], 'venta');
  const precioVenta = usable(mercados[venta], 'compra');
  if (!precioCompra || !precioVenta) return { ok: false, motivo: 'sin_dato' };
  if (perfil.monto === null) return { ok: false, motivo: 'sin_monto' };

  const A1 = MERCADO_A_ACTIVO[compra];
  const A2 = MERCADO_A_ACTIVO[venta];
  const pc = perfil.mercados[compra];
  const pv = perfil.mercados[venta];
  const conv = A1 !== A2 ? perfil.conversiones.get(`${A1}>${A2}`) : null;
  if (A1 !== A2 && !conv) {
    return {
      ok: false, motivo: 'sin_conversion',
      falta: { desde: A1, hacia: A2, texto: `Conversión ${corto(A1)} → ${corto(A2)}: cuántos ${corto(A2)} recibís por 1 ${corto(A1)} y con qué costos` },
    };
  }
  const parcial = [];
  const notas = {};
  const faltanCompra = pc.desconocidos.filter((k) => CAMPOS_MERCADO.find((c) => c.k === k)?.lado === 'compra');
  const faltanVenta = pv.desconocidos.filter((k) => CAMPOS_MERCADO.find((c) => c.k === k)?.lado === 'venta');
  if (faltanCompra.length) parcial.push(`${nombre(compra)}: no sabés ${faltanCompra.map(etiquetaCampo).join(', ')}`);

  const val = pc.valores;
  const pasos = [{
    desde: 'ARS', hacia: A1, cotizacion: precioCompra, base: 'origen_por_destino',
    slippagePct: NO_APLICA,
    costos: [
      { id: 'comision', concepto: `Comisión al comprar en ${nombre(compra)}`, clase: 'pct', valor: val.comisionCompraPct, lado: 'origen', base: 'neto', fiscal: 'no_fiscal' },
      { id: 'impuestos', concepto: `Impuestos al comprar en ${nombre(compra)}`, clase: 'pct', valor: val.impuestoCompraPct, lado: 'origen', base: 'neto', fiscal: pc.impuestoFiscal },
      { id: 'fijo', concepto: `Fijo al comprar en ${nombre(compra)}`, clase: 'fijo', valor: val.fijoCompraARS, lado: 'origen' },
    ],
  }];
  notas[0] = 'La matriz no modela slippage al comprar: cargalo acá si corresponde.';
  if (conv) {
    if (conv.desconocidos.length) parcial.push(`Conversión ${corto(A1)} → ${corto(A2)}: no sabés ${conv.desconocidos.join(', ')}`);
    notas[1] = conv.hipotesis ? 'Conversión cargada como hipótesis en los costos de la vista neta: confirmala.' : 'Conversión tomada de los costos de la vista neta.';
    pasos.push({
      desde: A1, hacia: A2, cotizacion: conv.relacion, cotizacionHipotesis: conv.hipotesis, base: 'destino_por_origen',
      slippagePct: NO_APLICA,
      costos: [
        { id: 'comision', concepto: `Comisión de la conversión ${corto(A1)} → ${corto(A2)}`, clase: 'pct', valor: conv.comisionPct, lado: 'destino', base: 'bruto', fiscal: 'no_fiscal' },
        { id: 'fijo', concepto: `Costo fijo de la conversión (en ${corto(A2)})`, clase: 'fijo', valor: conv.fijoDestino, lado: 'destino' },
      ],
    });
  }
  if (faltanVenta.length) parcial.push(`${nombre(venta)}: no sabés ${faltanVenta.map(etiquetaCampo).join(', ')}`);
  const vv = pv.valores;
  pasos.push({
    desde: A2, hacia: 'ARS', cotizacion: precioVenta, base: 'destino_por_origen',
    slippagePct: vv.slippageVentaPct,
    costos: [
      { id: 'comision', concepto: `Comisión al vender en ${nombre(venta)}`, clase: 'pct', valor: vv.comisionVentaPct, lado: 'destino', base: 'bruto', fiscal: 'no_fiscal' },
      { id: 'fijo', concepto: `Fijo al vender en ${nombre(venta)}`, clase: 'fijo', valor: vv.fijoVentaARS, lado: 'destino' },
    ],
  });
  return { ok: true, entrada: { activoInicial: 'ARS', montoInicial: perfil.monto, pasos }, parcial, notas };
}

/**
 * Todas las combinaciones compra × venta con su resultado neto (siempre teóricas: nadie las confirmó).
 * nivel: completo · estimado (usa una conversión hipotética) · incompleto (cota máxima) · insuficiente (sin resultado).
 */
export function evaluarCombinaciones(mercados, perfil, { ids = IDS_MERCADOS } = {}) {
  const out = [];
  for (const c of ids) {
    for (const v of ids) {
      const base = { id: `${c}>${v}`, compra: c, venta: v, mismoMercado: c === v, titulo: `${nombre(c)} → ${nombre(v)}` };
      const r = rutaDeCombinacion(c, v, mercados, perfil);
      if (!r.ok) {
        out.push({ ...base, disponible: false, motivo: r.motivo, nivel: 'insuficiente', faltan: r.falta ? [r.falta.texto] : [], falta: r.falta ?? null });
        continue;
      }
      const sim = simularRuta(r.entrada, { activosValidos: IDS_ACTIVOS, decimales: DECIMALES, nombres: NOMBRES, objetivos: 'equilibrio' });
      if (!sim.ok) {
        out.push({ ...base, disponible: false, motivo: 'costos_invalidos', nivel: 'insuficiente', errores: sim.errors.map((e) => e.message), faltan: [] });
        continue;
      }
      const x = sim.result;
      const eq = x.objetivosPrecio?.[0];
      out.push({
        ...base,
        disponible: true,
        estado: 'teorica',
        nivel: sim.calidad.nivel,
        calidad: sim.calidad,
        pasos: r.entrada.pasos.length,
        entrada: r.entrada,
        notas: r.notas,
        parcial: r.parcial,
        montoInicial: x.montoInicial,
        capitalInvertido: x.capitalInvertido,
        montoFinal: x.montoFinal,
        resultadoNeto: x.resultadoNeto,
        roiPct: x.roiPct,
        costosTotales: x.costosTotales,
        costoPct: x.costosTotales.div(x.capitalInvertido).times(100),
        brechaRutaPct: x.brechaRutaPct,
        margenSeguridadPct: eq?.precio ? eq.margenSeguridadPct : null,
        tiempoHoras: x.tiempoTotalHoras,
        faltantes: sim.calidad.desconocidos.length,
      });
    }
  }
  return out;
}
