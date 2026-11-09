// Mercados que compara Brecha. "casa" = identificador en DolarAPI.
// El instrumento se aclara porque NO son equivalentes ni transferibles 1:1 entre sí.
export const MERCADOS = [
  { id: 'oficial', nombre: 'Oficial', casa: 'oficial', unidad: 'USD', instrumento: 'USD oficial (cuenta bancaria)' },
  { id: 'blue', nombre: 'Blue', casa: 'blue', unidad: 'USD', instrumento: 'USD billete, mercado informal' },
  { id: 'mep', nombre: 'MEP', casa: 'bolsa', unidad: 'USD', instrumento: 'USD MEP (bolsa, cuenta local)' },
  { id: 'ccl', nombre: 'CCL', casa: 'contadoconliqui', unidad: 'USD', instrumento: 'USD cable (cuenta en el exterior)' },
  { id: 'cripto', nombre: 'Cripto', casa: 'cripto', unidad: 'USDT/USDC', instrumento: 'Stablecoins, referencia sin exchange informado' },
];

export const IDS_MERCADOS = MERCADOS.map((m) => m.id);
export const mercadoPorId = (id) => MERCADOS.find((m) => m.id === id);
