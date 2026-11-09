// Matriz de brecha bruta (vista A): filas = mercado donde comprás, columnas = donde vendés.
// Usa las cotizaciones de referencia: compra al "venta" de la fila, venta al "compra" de la columna.
// No incluye aumento, comisiones, impuestos ni conversión (igual que la versión original).
import { ONE, HUNDRED, toDec } from './decimal.mjs';

/**
 * @param {Record<string, {compra: *, venta: *, valido?: boolean}>} cotizaciones ARS por unidad
 * @param {string[]} ids orden de mercados
 * @returns {Array<{compra: string, celdas: Array<{venta: string, brechaPct: import('./decimal.mjs').Dec|null, mismoMercado: boolean, motivo: string|null}>}>}
 */
export function calcularMatriz(cotizaciones, ids) {
  return ids.map((idCompra) => ({
    compra: idCompra,
    celdas: ids.map((idVenta) => {
      const mismoMercado = idCompra === idVenta;
      const ask = precio(cotizaciones[idCompra], 'venta');
      const bid = precio(cotizaciones[idVenta], 'compra');
      if (!ask || !bid) return { venta: idVenta, brechaPct: null, mismoMercado, motivo: 'sin_dato' };
      return { venta: idVenta, brechaPct: bid.div(ask).minus(ONE).times(HUNDRED), mismoMercado, motivo: null };
    }),
  }));
}

function precio(q, punta) {
  if (!q || q.valido === false) return null;
  const raw = q[punta];
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const d = toDec(raw);
    return d.gt(0) ? d : null;
  } catch {
    return null;
  }
}
