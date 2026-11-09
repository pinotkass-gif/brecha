// Aritmética decimal exacta para todo el motor financiero.
// Nunca se hace una cuenta de plata con Number de JavaScript: 1570 * 1.1 da 1727.0000000000002.
import BigBase from '../vendor/big.mjs';

/** Constructor decimal propio (configuración aislada del Big global). */
export const Dec = BigBase();
Dec.DP = 40; // decimales en divisiones (ROI, equilibrio, cantidad en modo ARS)
Dec.RM = 1; // ROUND_HALF_UP: al medio, se aleja del cero (2,675 → 2,68)
Dec.NE = -60; // evita notación exponencial al convertir a texto
Dec.PE = 60;
// strict = false: big.js convierte un Number con su texto más corto (1.1 → "1.1"), que es exacto
// para literales. La regla es otra: ninguna cuenta se hace en Number antes de llegar acá.
Dec.strict = false;

export const ZERO = Dec('0');
export const ONE = Dec('1');
export const HUNDRED = Dec('100');

const PLAIN = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/** ¿Es un decimal del motor? */
export function isDec(x) {
  return x instanceof Dec;
}

/**
 * Convierte a decimal. Acepta Dec, number finito, bigint o texto en formato máquina ("1650.69").
 * El formato argentino ("1.650,69") se interpreta antes con parseNumberAR() de format.mjs.
 * @throws {TypeError|RangeError} si el valor no es un número válido.
 */
export function toDec(x) {
  if (x instanceof Dec) return x;
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new RangeError('El número no es finito');
    return Dec(String(x));
  }
  if (typeof x === 'bigint') return Dec(x);
  if (typeof x === 'string') {
    let s = x.trim();
    if (s.startsWith('+')) s = s.slice(1);
    if (!PLAIN.test(s)) throw new TypeError(`"${x}" no es un número`);
    return Dec(s);
  }
  throw new TypeError('Valor no numérico');
}

const CENTESIMO = Dec('0.01');

/** Largo máximo de un número escrito (sin espacios ni símbolos). Sobra para cualquier monto real. */
export const MAX_LARGO_NUMERO = 100;

/** Porcentaje → fracción (10 → 0,1). Multiplica por 0,01 (exacto) en vez de dividir por 100 (redondea a 40 decimales). */
export function pct(p) {
  return toDec(p).times(CENTESIMO);
}

/** Redondeo para mostrar (half-up). El motor guarda la precisión completa. */
export function round(d, dp = 2) {
  return toDec(d).round(dp, 1);
}

/** Texto plano para guardar o testear ("−0" se normaliza a "0"). Nunca usa notación científica. */
export function plain(d) {
  const v = toDec(d);
  return v.eq(0) ? '0' : v.toFixed();
}

/** Cantidad de decimales significativos (1727.50 → 1, 0.001 → 3). */
export function decimalPlaces(d) {
  const v = toDec(d);
  return Math.max(0, v.c.length - v.e - 1);
}

/** Signo: -1, 0 o 1. */
export function sign(d) {
  const v = toDec(d);
  return v.gt(0) ? 1 : v.lt(0) ? -1 : 0;
}
