// Activos del simulador por pasos. Son DISTINTOS entre sí: pasar de uno a otro siempre es un paso
// explícito, con su cotización, costos, plazos y condiciones.
// decimales = cómo se muestra; precision = decimales con que la plataforma liquida (redondeo de ejecución).
export const ACTIVOS = [
  { id: 'ARS', nombre: 'Pesos', corto: 'ARS', decimales: 2, precision: 2, familia: 'ars' },
  { id: 'USD_BANCO', nombre: 'USD bancario (cuenta local)', corto: 'USD banco', decimales: 2, precision: 2, familia: 'usd' },
  { id: 'USD_BILLETE', nombre: 'USD billete', corto: 'USD billete', decimales: 2, precision: 2, familia: 'usd' },
  { id: 'USD_MEP', nombre: 'USD MEP (cuenta comitente local)', corto: 'USD MEP', decimales: 2, precision: 2, familia: 'usd' },
  { id: 'USD_CABLE', nombre: 'USD cable (cuenta en el exterior)', corto: 'USD cable', decimales: 2, precision: 2, familia: 'usd' },
  { id: 'USDT', nombre: 'USDT (Tether)', corto: 'USDT', decimales: 4, precision: 6, familia: 'cripto' },
  { id: 'USDC', nombre: 'USDC (USD Coin)', corto: 'USDC', decimales: 4, precision: 6, familia: 'cripto' },
];

export const IDS_ACTIVOS = ACTIVOS.map((a) => a.id);
export const activoPorId = (id) => ACTIVOS.find((a) => a.id === id);
export const corto = (id) => activoPorId(id)?.corto ?? id;

/** Activo que representa cada mercado de la calculadora simple (cripto se toma como USDT). */
export const MERCADO_A_ACTIVO = {
  oficial: 'USD_BANCO',
  blue: 'USD_BILLETE',
  mep: 'USD_MEP',
  ccl: 'USD_CABLE',
  cripto: 'USDT',
};
