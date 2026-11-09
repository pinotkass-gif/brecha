// Factor tiempo de una ruta: duración total, inmovilización del capital, fecha estimada de fin, rentabilidad
// diaria y anualizada. La anualización es una PROYECCIÓN MATEMÁTICA: no es una rentabilidad garantizada ni
// necesariamente repetible (se usa Number porque no es un importe de plata).
import { toDec } from '../engine/decimal.mjs';
import { sumarDiasHabiles } from '../quotes/calendario.mjs';

const DIA = 86400e3;

/**
 * @param {{horas: *, diasHabiles: *, roiPct?: *, margenSeguridadPct?: *, inicio?: Date, cal?: object}} p
 *   horas: tiempo en horas corridas (min, h, d) · diasHabiles: pasos que tardan días hábiles
 * @returns {null | {fin: Date, dias: number, diariaPct: number|null, anualizadaPct: number|null, motivoAnual: string|null, texto: string}}
 */
export function metricasTiempo({ horas, diasHabiles, roiPct = null, inicio = new Date(), cal = {} }) {
  if (horas === null || horas === undefined) return null;
  const h = Number(toDec(horas).toString());
  const dh = diasHabiles === null || diasHabiles === undefined ? 0 : Number(toDec(diasHabiles).toString());
  const t0 = inicio.getTime();
  const entero = Math.floor(dh);
  let fin = sumarDiasHabiles(t0, entero, cal) + (dh - entero) * DIA;
  fin += h * 3600e3;
  const dias = (fin - t0) / DIA;
  let diariaPct = null;
  let anualizadaPct = null;
  let motivoAnual = null;
  if (roiPct !== null && roiPct !== undefined && dias > 0) {
    const roi = Number(toDec(roiPct).toString()) / 100;
    diariaPct = (roi / dias) * 100;
    if (dias < 1) motivoAnual = 'plazo_corto';
    else if (roi <= -1) motivoAnual = 'perdida_total';
    else {
      const anual = (Math.pow(1 + roi, 365 / dias) - 1) * 100;
      if (Number.isFinite(anual) && Math.abs(anual) < 1e6) anualizadaPct = anual;
      else motivoAnual = 'fuera_de_escala';
    }
  } else if (dias <= 0) motivoAnual = 'sin_plazo';
  return { fin: new Date(fin), dias, diariaPct, anualizadaPct, motivoAnual };
}
