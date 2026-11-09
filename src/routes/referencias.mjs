// Cotización de referencia para un paso, tomada de las cotizaciones de la calculadora (DolarAPI o manuales).
// Es sólo un punto de partida: la cotización real la confirma el usuario en su plataforma.
import { mercadoPorId } from '../quotes/markets.mjs';

// par → [mercado, punta]. Comprar con ARS = punta "venta"; vender por ARS = punta "compra".
const REFERENCIAS = {
  'ARS>USD_BANCO': ['oficial', 'venta'],
  'USD_BANCO>ARS': ['oficial', 'compra'],
  'ARS>USD_BILLETE': ['blue', 'venta'],
  'USD_BILLETE>ARS': ['blue', 'compra'],
  'ARS>USD_MEP': ['mep', 'venta'],
  'USD_MEP>ARS': ['mep', 'compra'],
  'ARS>USD_CABLE': ['ccl', 'venta'],
  'USD_CABLE>ARS': ['ccl', 'compra'],
  'ARS>USDT': ['cripto', 'venta'],
  'USDT>ARS': ['cripto', 'compra'],
  'ARS>USDC': ['cripto', 'venta'],
  'USDC>ARS': ['cripto', 'compra'],
};

/**
 * @param {string} desde
 * @param {string} hacia
 * @param {Record<string, {compra: string|null, venta: string|null, origen: string, valido: boolean, fechaFuente: string|null, editadoAt: string|null, fuente: string|null}>} mercados
 * @returns {null | {valor: string, base: string, mercado: string, nombreMercado: string, punta: string, origen: string, fuente: string|null, fechaFuente: string|null, editadoAt: string|null, generica: boolean}}
 */
export function referenciaPaso(desde, hacia, mercados) {
  const ref = REFERENCIAS[`${desde}>${hacia}`];
  if (!ref || !mercados) return null;
  const [id, punta] = ref;
  const m = mercados[id];
  if (!m || m.valido === false || !m[punta]) return null;
  return {
    valor: m[punta],
    base: desde === 'ARS' ? 'origen_por_destino' : 'destino_por_origen',
    mercado: id,
    nombreMercado: mercadoPorId(id)?.nombre ?? id,
    punta,
    origen: m.origen,
    fuente: m.fuente ?? null,
    fechaFuente: m.fechaFuente ?? null,
    editadoAt: m.editadoAt ?? null,
    generica: id === 'cripto', // DolarAPI no dice qué stablecoin ni qué exchange
  };
}
