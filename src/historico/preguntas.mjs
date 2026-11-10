// Entiende preguntas en castellano sobre el histórico de los dólares: qué mercados, qué dato y qué período.
// No es una IA: reconoce palabras y formas de decir fechas. Si no entiende, lo dice y sugiere cómo preguntar
// (nunca adivina un mercado ni un período sin decirlo en la respuesta).

/** Mercados con histórico (ArgentinaDatos) y cómo se los nombra. El orden importa: primero las frases largas. */
export const MERCADOS_HIST = {
  oficial: { nombre: 'Oficial', casa: 'oficial', palabras: ['banco nacion', 'oficial', 'bna', 'minorista'] },
  blue: { nombre: 'Blue', casa: 'blue', palabras: ['blue', 'paralelo', 'informal', 'cueva', 'libre'] },
  mep: { nombre: 'MEP', casa: 'bolsa', palabras: ['dolar bolsa', 'mep', 'bolsa'] },
  ccl: { nombre: 'CCL', casa: 'contadoconliqui', palabras: ['contado con liquidacion', 'contado con liqui', 'contadoconliqui', 'ccl', 'cable'] },
  cripto: { nombre: 'Cripto', casa: 'cripto', palabras: ['stablecoins', 'stablecoin', 'cripto', 'crypto', 'usdt', 'usdc', 'tether'] },
  mayorista: { nombre: 'Mayorista', casa: 'mayorista', palabras: ['mayorista', 'a3500', 'a 3500'] },
  tarjeta: { nombre: 'Tarjeta', casa: 'tarjeta', palabras: ['tarjeta', 'turista'] },
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMEROS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
const UNIDADES = { dia: 'd', dias: 'd', semana: 's', semanas: 's', mes: 'm', meses: 'm', ano: 'a', anos: 'a', anio: 'a', anios: 'a', trimestre: 't', trimestres: 't', semestre: 'e', semestres: 'e', bimestre: 'b', bimestres: 'b' };

/** Minúsculas, sin tildes ni signos (la ñ pasa a n: "año" → "ano"). */
export function normalizar(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!,;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- Fechas (siempre 'AAAA-MM-DD', calendario de Buenos Aires) ---------- */
const d2 = (n) => String(n).padStart(2, '0');
const aTexto = (dt) => `${dt.getUTCFullYear()}-${d2(dt.getUTCMonth() + 1)}-${d2(dt.getUTCDate())}`;
const aFecha = (s) => new Date(`${s}T00:00:00Z`);
export function sumarDias(s, n) { const d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return aTexto(d); }
/** Resta meses de calendario (31/12 − 1 mes = 30/11). */
export function sumarMeses(s, n) {
  const [a, m, d] = s.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ult = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${d2(mes)}-${d2(Math.min(d, ult))}`;
}
const finDeMes = (ano, mes) => `${ano}-${d2(mes)}-${d2(new Date(Date.UTC(ano, mes, 0)).getUTCDate())}`;
const valida = (a, m, d) => { const s = `${a}-${d2(m)}-${d2(d)}`; return m >= 1 && m <= 12 && d >= 1 && aTexto(aFecha(s)) === s ? s : null; };
/** "Hoy" en Buenos Aires. */
export function hoyAR(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);
}
const anoDe = (txt, hoy) => { const a = Number(txt); return txt.length === 2 ? 2000 + a : a; };

/** Una fecha suelta: 15/8, 15/08/2026, 15-8-26, "15 de agosto", "15 de agosto de 2025". Sin año: la última ya pasada. */
function fechaDe(txt, hoy) {
  let m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(txt);
  let dia;
  let mes;
  let ano = null;
  if (m) { dia = Number(m[1]); mes = Number(m[2]); if (m[3]) ano = anoDe(m[3], hoy); } else {
    m = new RegExp(`^(\\d{1,2}) de (${MESES.join('|')})(?: (?:de |del )?(\\d{4}))?$`).exec(txt);
    if (!m) return null;
    dia = Number(m[1]); mes = MESES.indexOf(m[2]) + 1; if (m[3]) ano = Number(m[3]);
  }
  if (ano === null) {
    ano = Number(hoy.slice(0, 4));
    const s = valida(ano, mes, dia);
    if (s && s > hoy) ano--;
  }
  return valida(ano, mes, dia);
}
const PATRON_FECHA = `(\\d{1,2}[/-]\\d{1,2}(?:[/-](?:\\d{4}|\\d{2}))?|\\d{1,2} de (?:${MESES.join('|')})(?: (?:de |del )?\\d{4})?)`;

/** Un mes con año opcional ("octubre", "octubre 2025", "octubre de 2025"): sin año, el último ya empezado. */
function mesDe(nombre, anoTxt, hoy) {
  const mes = MESES.indexOf(nombre) + 1;
  let ano = anoTxt ? Number(anoTxt) : Number(hoy.slice(0, 4));
  if (!anoTxt && `${ano}-${d2(mes)}-01` > hoy) ano--;
  return { desde: `${ano}-${d2(mes)}-01`, hasta: finDeMes(ano, mes), ano, mes };
}
const nombreMes = (mes, ano) => `${MESES[mes - 1]} de ${ano}`;
const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Período de la pregunta.
 * @returns {{desde: string, hasta: string, texto: string, dia?: boolean, porDefecto?: boolean} | null}
 */
export function periodoDe(t, hoy) {
  const meses = MESES.join('|');
  let m;
  // Rango de fechas: "del 1/8 al 15/9", "desde 1/8 hasta 15/9", "entre el 1 de agosto y el 15 de septiembre"
  m = new RegExp(`(?:desde|del|entre)(?: el)? ${PATRON_FECHA} (?:hasta|al|y)(?: el)? ${PATRON_FECHA}`).exec(t);
  if (m) {
    const a = fechaDe(m[1], hoy);
    const b = fechaDe(m[2], hoy);
    if (a && b) { const [x, y] = a <= b ? [a, b] : [b, a]; return { desde: x, hasta: y, texto: `del ${fmt(x)} al ${fmt(y)}` }; }
  }
  // Rango de meses: "de agosto a octubre", "entre agosto y octubre de 2025"
  m = new RegExp(`(?:de|desde|entre) (${meses})(?: (?:de |del )?(\\d{4}))? (?:a|hasta|y) (${meses})(?: (?:de |del )?(\\d{4}))?`).exec(t);
  if (m) {
    const fin = mesDe(m[3], m[4], hoy);
    let ini = mesDe(m[1], m[2] ?? (m[4] ?? null), hoy);
    if (!m[2] && ini.desde > fin.desde) ini = mesDe(m[1], String(fin.ano - 1), hoy);
    return { desde: ini.desde, hasta: fin.hasta > hoy ? hoy : fin.hasta, texto: `de ${nombreMes(ini.mes, ini.ano)} a ${nombreMes(fin.mes, fin.ano)}` };
  }
  // "desde el 1/8", "desde agosto" (hasta hoy)
  m = new RegExp(`desde(?: el)? ${PATRON_FECHA}`).exec(t);
  if (m && fechaDe(m[1], hoy)) { const a = fechaDe(m[1], hoy); return { desde: a, hasta: hoy, texto: `desde el ${fmt(a)}` }; }
  m = new RegExp(`desde (${meses})(?: (?:de |del )?(\\d{4}))?`).exec(t);
  if (m) { const x = mesDe(m[1], m[2], hoy); return { desde: x.desde, hasta: hoy, texto: `desde ${nombreMes(x.mes, x.ano)}` }; }
  // Últimos N días / semanas / meses / años
  m = /(?:ultim[oa]s?|pasad[oa]s?) (\d+|[a-z]+) (dias?|semanas?|mes(?:es)?|anos?|anios?|trimestres?|semestres?|bimestres?)/.exec(t)
    ?? /(\d+|[a-z]+) (dias?|semanas?|mes(?:es)?|anos?|anios?|trimestres?|semestres?|bimestres?) (?:atras|para atras)/.exec(t);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
    if (n && n > 0) return ultimos(n, UNIDADES[m[2]], hoy);
  }
  if (/medio ano/.test(t)) return ultimos(6, 'm', hoy);
  m = /(?:el |la )?(?:ultim[oa]|pasad[oa]) (dia|semana|mes|ano|anio|trimestre|semestre|bimestre)\b/.exec(t)
    ?? /(?:el |la )?(dia|semana|mes|ano|anio|trimestre|semestre|bimestre) (?:pasad[oa]|anterior)\b/.exec(t);
  if (m) {
    // "el mes pasado" = el mes calendario anterior; "el último mes" = los últimos 30 días aprox (1 mes hacia atrás)
    const calendario = /pasad|anterior/.test(m[0]);
    if (calendario && m[1] === 'mes') { const x = mesDe(MESES[(Number(hoy.slice(5, 7)) + 10) % 12], String(Number(hoy.slice(5, 7)) === 1 ? Number(hoy.slice(0, 4)) - 1 : Number(hoy.slice(0, 4))), hoy); return { desde: x.desde, hasta: x.hasta, texto: `el mes pasado (${nombreMes(x.mes, x.ano)})` }; }
    if (calendario && (m[1] === 'ano' || m[1] === 'anio')) { const a = Number(hoy.slice(0, 4)) - 1; return { desde: `${a}-01-01`, hasta: `${a}-12-31`, texto: `el año pasado (${a})` }; }
    return ultimos(1, UNIDADES[m[1]] ?? 'd', hoy);
  }
  if (/\beste mes\b/.test(t)) return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy, texto: 'este mes' };
  if (/\beste ano\b|\beste anio\b|\ben lo que va del ano\b/.test(t)) return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy, texto: `este año (${hoy.slice(0, 4)})` };
  if (/\besta semana\b/.test(t)) return ultimos(7, 'd', hoy, 'esta semana');
  if (/\bdesde siempre\b|\btodo el historico\b|\bdesde que hay datos\b|\btoda la historia\b/.test(t)) return { desde: '2000-01-01', hasta: hoy, texto: 'todo el histórico' };
  // Un día (antes que el mes y el año: "el 15 de agosto de 2025" es un día, no todo 2025)
  if (/\banteayer\b|\bantes de ayer\b/.test(t)) { const d = sumarDias(hoy, -2); return { desde: d, hasta: d, texto: `anteayer (${fmt(d)})`, dia: true }; }
  if (/\bayer\b/.test(t)) { const d = sumarDias(hoy, -1); return { desde: d, hasta: d, texto: `ayer (${fmt(d)})`, dia: true }; }
  if (/\bhoy\b/.test(t)) return { desde: hoy, hasta: hoy, texto: `hoy (${fmt(hoy)})`, dia: true };
  m = new RegExp(PATRON_FECHA).exec(t);
  if (m && fechaDe(m[1], hoy)) { const d = fechaDe(m[1], hoy); return { desde: d, hasta: d, texto: `el ${fmt(d)}`, dia: true }; }
  // Un mes: "en octubre", "octubre 2025", "en octubre de 2025"
  m = new RegExp(`\\b(${meses})(?: (?:de |del )?(\\d{4}))?\\b`).exec(t);
  if (m && !new RegExp(`\\d{1,2} de ${m[1]}`).test(t)) { const x = mesDe(m[1], m[2], hoy); return { desde: x.desde, hasta: x.hasta > hoy ? hoy : x.hasta, texto: `en ${nombreMes(x.mes, x.ano)}` }; }
  // Un año: "en 2024", "del 2024", "año 2024"
  m = /\b(?:en|del|de|ano|anio) (20\d{2})\b/.exec(t) ?? /^(20\d{2})$/.exec(t);
  if (m) { const a = m[1]; return { desde: `${a}-01-01`, hasta: `${a}-12-31` > hoy ? hoy : `${a}-12-31`, texto: `en ${a}` }; }
  return null;
}

function ultimos(n, u, hoy, texto = null) {
  const desde = u === 'd' ? sumarDias(hoy, -n) : u === 's' ? sumarDias(hoy, -7 * n) : u === 'a' ? sumarMeses(hoy, -12 * n)
    : sumarMeses(hoy, -n * ({ m: 1, b: 2, t: 3, e: 6 }[u] ?? 1));
  const nombres = { d: ['día', 'días'], s: ['semana', 'semanas'], m: ['mes', 'meses'], a: ['año', 'años'], b: ['bimestre', 'bimestres'], t: ['trimestre', 'trimestres'], e: ['semestre', 'semestres'] }[u];
  const fem = u === 's';
  return { desde, hasta: hoy, texto: texto ?? (n === 1 ? `${fem ? 'la última' : 'el último'} ${nombres[0]}` : `${fem ? 'las últimas' : 'los últimos'} ${n} ${nombres[1]}`) };
}

/** Mercados nombrados, en el orden en que aparecen (sin repetir), con su posición en el texto. */
export function mercadosConPosicion(t) {
  const hallados = [];
  for (const [id, def] of Object.entries(MERCADOS_HIST)) {
    let pos = -1;
    for (const p of def.palabras) {
      const m = new RegExp(`(^|[^a-z0-9])${p.replace(/ /g, '\\s')}($|[^a-z0-9])`).exec(t);
      if (m && (pos < 0 || m.index < pos)) pos = m.index;
    }
    if (pos >= 0) hallados.push({ id, pos });
  }
  return hallados.sort((a, b) => a.pos - b.pos);
}
export const mercadosDe = (t) => mercadosConPosicion(t).map((h) => h.id);

/** Qué dato pide. 'resumen' = cómo estuvo (todo); el resto ordena qué se dice primero. */
export function datoDe(t) {
  if (/\bbrecha|\bdiferencia|\bspread\b|\bgap\b|\bdistancia|\bseparacion|\bvs\b|\bcontra\b|\bversus\b|\bcomparad|\bcompara/.test(t)) return 'brecha';
  return 'precio';
}
export function enfoqueDe(t) {
  if (/\bmaxim|\bmas alt|\bpico\b|\brecord\b|\btope\b|\bmas car/.test(t)) return 'maximo';
  if (/\bminim|\bmas baj|\bpiso\b|\bmas barat/.test(t)) return 'minimo';
  if (/\bpromedi|\bmedia\b/.test(t)) return 'promedio';
  if (/\bsubi|\bbaj[oó]\b|\bvari|\bcambi|\baument|\bsubida\b|\bbajada\b|\bcrecio\b|\bcayo\b/.test(t)) return 'variacion';
  return 'resumen';
}

/**
 * @param {string} texto la pregunta
 * @param {string} hoy 'AAAA-MM-DD'
 * @returns {{ok: true, consulta: {mercados: string[], base: string|null, dato: 'brecha'|'precio', enfoque: string, punta: 'venta'|'compra',
 *   periodo: {desde: string, hasta: string, texto: string, dia?: boolean, porDefecto?: boolean}, supuestos: string[]}} | {ok: false, motivo: string}}
 */
export function interpretar(texto, hoy) {
  const t = normalizar(texto);
  if (!t) return { ok: false, motivo: 'vacia' };
  const supuestos = [];
  let mercados = mercadosDe(t);
  let dato = datoDe(t);
  const enfoque = enfoqueDe(t);
  const punta = /\bcompra\b|\bcomprador|\bpunta compradora/.test(t) && !/\bventa\b/.test(t) ? 'compra' : 'venta';
  if (!mercados.length) return { ok: false, motivo: 'sin_mercado' };
  // Una brecha de un solo mercado es contra el oficial ("la brecha del blue").
  if (dato === 'brecha' && mercados.length === 1) {
    if (mercados[0] === 'oficial') return { ok: false, motivo: 'brecha_sola' };
    mercados = ['oficial', ...mercados];
    supuestos.push('Brecha contra el oficial (no nombraste otro mercado).');
  }
  // Dos mercados sin decir qué dato: se comparan (brecha entre los dos).
  if (dato === 'precio' && mercados.length === 2 && enfoque === 'resumen') dato = 'brecha';
  // Base de la brecha: la que va después de "contra / vs / respecto de / frente a"; si no, el oficial; si no, el
  // mayorista; si no, el primero que nombraste.
  let base = null;
  if (dato === 'brecha') {
    const k = /\b(?:contra|vs|versus|respecto (?:del|de|al|a)|frente (?:al|a))\b/.exec(t);
    const despues = k ? mercadosConPosicion(t).find((h) => h.pos > k.index && mercados.includes(h.id)) : null;
    base = despues?.id ?? (mercados.includes('oficial') ? 'oficial' : mercados.includes('mayorista') ? 'mayorista' : mercados[0]);
  }
  let periodo = periodoDe(t, hoy);
  if (!periodo) {
    periodo = { ...ultimos(30, 'd', hoy), porDefecto: true };
    supuestos.push('No dijiste período: tomé los últimos 30 días.');
  }
  if (periodo.desde > hoy) return { ok: false, motivo: 'futuro' };
  return { ok: true, consulta: { mercados, base, dato, enfoque, punta, periodo, supuestos } };
}

/** Ejemplos para mostrar (también son las sugerencias del chat). */
export const EJEMPLOS = [
  '¿Cómo estuvo la brecha oficial cripto los últimos 3 meses?',
  'Consigo el oficial a 1535 y compro USDT al 2 %: ¿cómo salgo si vendo?',
  '¿Hay arbitraje de USDT entre exchanges?',
  '¿Cuál fue el máximo del blue este año?',
  '¿Cuánto subió el MEP el último mes?',
  'Brecha del CCL contra el MEP en octubre',
  '¿A cuánto estaba el blue el 15 de agosto?',
  'Promedio del oficial desde junio',
];
