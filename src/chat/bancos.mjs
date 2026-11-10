// El chat carga y consulta la cotización de Galicia (pedido 10/11/2026: cargarla desde el chat escribiendo «galicia 1535»).
//   «galicia 1535»                         → venta 1.535 (lo que pagás por cada dólar)
//   «galicia 1485 1535» / «galicia compra 1485 venta 1535» → compra y venta
//   «galicia a cuánto está» / «galicia?»    → lo que tenés cargado (y Nación de referencia)
// Si la frase habla de otra cosa (USDT, MEP, vender, histórico…), no es para acá: sigue el resto del chat.
// No es una IA: reconoce estas formas y valida igual que la tarjeta (src/bancos/bancos.mjs).
import { formatNumberAR } from '../engine/format.mjs';
import { round } from '../engine/decimal.mjs';
import { rinde } from '../exchanges/arbitraje.mjs';

const OTROS = /\b(usdt|usdc|cripto|crypto|mep|ccl|blue|bolsa|contado|cable|exchanges?|p2p|binance|vendo|vender|venderlos|salgo|salir|gano|ganancia|pierdo|historico|brecha|promedio|maximo|minimo|subio|bajo|ayer|mes|meses|ano|semana)\b/;
const EJEMPLO = 'Probá así: «galicia 1535» (la venta: lo que pagás) o «galicia compra 1485 venta 1535».';
const min = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pesos = (v) => `$ ${formatNumberAR(v, { decimals: 2, minDecimals: 2 })}`;
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * @returns {null | {tipo: 'consulta'} | {tipo: 'cargar', compra: string, venta: string} | {tipo: 'error', motivo: string}}
 */
export function interpretarGalicia(texto) {
  const t = min(texto).slice(0, 300);
  if (!/\bgalicia\b/.test(t) || OTROS.test(t)) return null;
  const nums = [...t.matchAll(/\d[\d.,]*/g)].map((m) => ({ txt: m[0].replace(/[.,]+$/, ''), pos: m.index }));
  if (!nums.length) return { tipo: 'consulta' };
  if (nums.length > 2) return { tipo: 'error', motivo: 'Mandame uno o dos precios: la venta, o la compra y la venta.' };
  // Lo que dice antes de cada número: "compra" (te pagan) o "venta / compro / pago / sale" (pagás)
  const etiqueta = (n) => {
    const antes = t.slice(Math.max(0, n.pos - 16), n.pos);
    if (/\b(compra|me pagan|te pagan|pagan)\b[^\d]*$/.test(antes)) return 'compra';
    if (/\b(venta|vende|compro|comprar|pago|pagas|sale|cuesta)\b[^\d]*$/.test(antes)) return 'venta';
    return null;
  };
  let compra = null;
  let venta = null;
  const sueltos = [];
  for (const n of nums) {
    const e = etiqueta(n);
    if (e === 'compra' && compra === null) compra = n.txt;
    else if (e === 'venta' && venta === null) venta = n.txt;
    else sueltos.push(n.txt);
  }
  if (sueltos.length === 2) {
    // Sin decir cuál es cuál: la compra (lo que te pagan) es la más baja
    const [a, b] = sueltos;
    const va = Number(a.replace(/\./g, '').replace(',', '.'));
    const vb = Number(b.replace(/\./g, '').replace(',', '.'));
    [compra, venta] = va <= vb ? [a, b] : [b, a];
  } else if (sueltos.length === 1) {
    if (venta === null) venta = sueltos[0]; // uno solo: es lo que pagás
    else compra = sueltos[0];
  }
  return { tipo: 'cargar', compra: compra ?? '', venta: venta ?? '' };
}

/**
 * Responde con la tarjeta de bancos (crearBancos): guarda o consulta.
 * @param {ReturnType<typeof interpretarGalicia>} c
 * @param {{guardarManual: Function, fila: Function, referencia: Function}} bancos
 */
export function responderGalicia(c, bancos) {
  const base = { avisos: [], series: [], tabla: null, unidad: '', fuente: '' };
  const ref = bancos.referencia?.() ?? null;
  const frenteAlOficial = (fila) => {
    if (!fila?.venta || !ref?.venta) return null;
    const r = round(rinde(fila.venta, ref.venta, 'compra'), 2);
    if (r.eq(0)) return `Es el mismo precio que el oficial de referencia (${pesos(ref.venta)}).`;
    return `Frente al oficial de referencia (${pesos(ref.venta)}), comprando en Galicia recibís ${formatNumberAR(r.abs(), { decimals: 2, minDecimals: 2 })} % ${r.gt(0) ? 'más' : 'menos'} dólares por los mismos pesos.`;
  };
  if (c.tipo === 'error') return { ...base, ok: false, frases: [c.motivo, EJEMPLO] };
  if (c.tipo === 'consulta') {
    const g = bancos.fila('galicia');
    const bna = bancos.fila('bna');
    const frases = [];
    if (g?.origen === 'manual') {
      frases.push(`Galicia: venta ${pesos(g.venta)}${g.compra ? ` y compra ${pesos(g.compra)}` : ''}, la cargaste vos a las ${HORA.format(new Date(g.fecha))}${g.revisar ? ' (hace más de un día: revisala)' : ''}.`);
      const f = frenteAlOficial(g);
      if (f) frases.push(f);
    } else if (g?.origen === 'api') frases.push(`Galicia: venta ${pesos(g.venta)}${g.compra ? ` y compra ${pesos(g.compra)}` : ''} (CriptoYa).`);
    else frases.push(`Todavía no cargaste Galicia. Galicia sólo la muestra en el homebanking o en su app: mirala ahí y escribime, por ejemplo, «galicia 1535».`);
    if (bna?.origen === 'api') frases.push(`De referencia, Nación: compra ${pesos(bna.compra)} y venta ${pesos(bna.venta)} (CriptoYa).`);
    return { ...base, ok: true, frases, accion: g?.usarCompra ? { tipo: 'galicia' } : null };
  }
  const r = bancos.guardarManual('galicia', { compra: c.compra, venta: c.venta });
  if (!r.ok) return { ...base, ok: false, frases: [`No la guardé: ${r.error}`, EJEMPLO] };
  const g = r.fila;
  const frases = [`Listo, guardé Galicia: venta ${pesos(g.venta)} (lo que pagás)${g.compra ? ` y compra ${pesos(g.compra)} (lo que te pagan)` : ''}, a las ${HORA.format(new Date(g.fecha))}.`];
  if (!g.usarCompra) frases.push(`Ojo: ${g.motivos.join('; ')}. No la uso en las cuentas hasta que la corrijas (¿le sobra o le falta un dígito?).`);
  else {
    const f = frenteAlOficial(g);
    if (f) frases.push(f);
    frases.push('En la calculadora aparece cuando comprás el dólar oficial; con el botón la uso ya.');
  }
  if (!g.compra) frases.push('Si también querés la compra (lo que te paga Galicia), escribime «galicia compra 1485 venta 1535».');
  return { ...base, ok: true, frases, accion: g.usarCompra ? { tipo: 'galicia' } : null };
}

