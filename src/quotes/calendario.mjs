// Calendario argentino para el vencimiento de cotizaciones y los plazos de las rutas.
// Feriados: se cargan solos los INAMOVIBLES (Ley 27.399) y los que dependen de la Pascua (Carnaval y Viernes
// Santo), que se calculan. Los TRASLADABLES y los días no laborables con fines turísticos cambian por decreto
// cada año: NO se inventan, los cargás vos (fuente: argentina.gob.ar/interior/feriados).
// Horarios de mercado: valores por defecto a verificar, configurables. Cripto opera todos los días.

const OFFSET_AR = -3 * 3600e3; // Argentina no usa horario de verano desde 2009
const DIA = 86400e3;

/** Feriados nacionales inamovibles (mes-día). Carnaval y Viernes Santo se calculan con la Pascua. */
export const FERIADOS_INAMOVIBLES = ['01-01', '03-24', '04-02', '05-01', '05-25', '06-20', '07-09', '12-08', '12-25'];

/** Horarios por defecto (hora de Buenos Aires). Son una referencia para verificar, no un dato oficial. */
export const HORARIOS_DEFECTO = {
  oficial: { apertura: '10:00', cierre: '15:00' },
  blue: { apertura: '10:00', cierre: '18:00' },
  mep: { apertura: '11:00', cierre: '17:00' },
  ccl: { apertura: '11:00', cierre: '17:00' },
  cripto: null, // todos los días, todo el día
};

const pad = (n) => String(n).padStart(2, '0');
/** Fecha argentina "AAAA-MM-DD" de un instante (ms). */
export const fechaAR = (ms) => {
  const d = new Date(ms + OFFSET_AR);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** Inicio del día argentino (ms UTC) que contiene a `ms`. */
const inicioDiaAR = (ms) => Math.floor((ms + OFFSET_AR) / DIA) * DIA - OFFSET_AR;

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). Devuelve "AAAA-MM-DD". */
export function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${pad(mes)}-${pad(dia)}`;
}
const masDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);

/**
 * Feriados de un año. `extra` = fechas que cargaste vos (trasladables, puentes); `quitar` = las que sacaste.
 * @returns {Set<string>} fechas "AAAA-MM-DD"
 */
export function feriadosDelAnio(anio, { extra = [], quitar = [] } = {}) {
  const set = new Set(FERIADOS_INAMOVIBLES.map((md) => `${anio}-${md}`));
  const p = pascua(anio);
  set.add(masDias(p, -48)); // lunes de Carnaval
  set.add(masDias(p, -47)); // martes de Carnaval
  set.add(masDias(p, -2)); // Viernes Santo
  for (const f of extra) if (typeof f === 'string' && f.startsWith(`${anio}-`)) set.add(f);
  for (const f of quitar) set.delete(f);
  return set;
}

/** Valida la configuración guardada del calendario (fechas que cargó el usuario). */
export function restaurarCalendario(g) {
  const fechas = (x) => (Array.isArray(x) ? [...new Set(x.filter((f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`))))].sort().slice(0, 200) : []);
  return { extra: fechas(g?.extra), quitar: fechas(g?.quitar) };
}

const cache = new Map();
/** ¿El día (AAAA-MM-DD) es feriado según la configuración? */
export function esFeriado(fecha, cal = {}) {
  const anio = Number(fecha.slice(0, 4));
  const clave = `${anio}|${(cal.extra ?? []).join(',')}|${(cal.quitar ?? []).join(',')}`;
  if (!cache.has(clave)) {
    if (cache.size > 50) cache.clear();
    cache.set(clave, feriadosDelAnio(anio, cal));
  }
  return cache.get(clave).has(fecha);
}

/** ¿Es día hábil (lunes a viernes y no feriado)? */
export function esDiaHabil(ms, cal = {}) {
  const wd = new Date(ms + OFFSET_AR).getUTCDay();
  return wd !== 0 && wd !== 6 && !esFeriado(fechaAR(ms), cal);
}

const minutos = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Milisegundos dentro de días hábiles (y, si se da un horario, dentro del horario de mercado) entre dos instantes.
 * Sin horario cuenta las 24 h de cada día hábil (la política "horas hábiles" de antes, ahora sin feriados).
 */
export function msHabiles(desde, hasta, { cal = {}, horario = null } = {}) {
  if (!(hasta > desde)) return 0;
  if (hasta - desde > 3660 * DIA) return Math.round(((hasta - desde) * 5) / 7);
  const ap = horario ? minutos(horario.apertura) : 0;
  const ci = horario ? minutos(horario.cierre) : 24 * 60;
  if (ap === null || ci === null || ci <= ap) return 0;
  let total = 0;
  for (let dia = inicioDiaAR(desde); dia < hasta; dia += DIA) {
    if (!esDiaHabil(dia + 12 * 3600e3, cal)) continue;
    const a = Math.max(desde, dia + ap * 60e3);
    const b = Math.min(hasta, dia + ci * 60e3);
    if (b > a) total += b - a;
  }
  return total;
}

/** ¿El mercado está abierto en este instante? (cripto: siempre) */
export function mercadoAbierto(ms, horario, cal = {}) {
  if (!horario) return true;
  if (!esDiaHabil(ms, cal)) return false;
  const m = Math.floor(((ms + OFFSET_AR) % DIA) / 60e3);
  return m >= minutos(horario.apertura) && m < minutos(horario.cierre);
}

/** Suma días hábiles a un instante (mantiene la hora). */
export function sumarDiasHabiles(ms, dias, cal = {}) {
  let t = ms;
  let resto = Math.max(0, Math.round(dias));
  while (resto > 0) {
    t += DIA;
    if (esDiaHabil(t, cal)) resto--;
  }
  return t;
}
