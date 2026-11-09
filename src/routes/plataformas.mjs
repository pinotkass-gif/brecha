// Perfiles locales de bancos, brokers, exchanges y billeteras: costos, mínimos, límites, activos, redes y horarios
// para reutilizar en las rutas. Brecha NO trae tarifas de ninguna plataforma: los perfiles arrancan vacíos y los
// completás vos con la fecha en que los revisaste. Un perfil viejo se avisa.
import { CLASES, BASES_PCT } from '../engine/route.mjs';
import { TRATAMIENTOS } from '../engine/costos.mjs';
import { IDS_ACTIVOS } from './activos.mjs';
import { nuevoId } from './borrador.mjs';

export const TIPOS_PLATAFORMA = { banco: 'Banco', broker: 'Broker / ALyC', exchange: 'Exchange cripto', billetera: 'Billetera virtual', otro: 'Otro' };
/** Formas de cobro de un costo del perfil: "auto" = la que sugiere cada paso (encima si pagás con pesos). */
export const COBROS_PERFIL = { auto: 'Según el paso', origen: 'Sale de lo que entregás', destino: 'Se descuenta de lo que recibís', aparte: 'Aparte (se suma al capital)' };
export const DIAS_DESACTUALIZADO = 30;
export const MAX_PLATAFORMAS = 30;
const MAX_COSTOS = 12;
const MAX_REDES = 10;

const hoy = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);

export function nuevaPlataforma(ahora = new Date()) {
  return { id: nuevoId('pl'), nombre: '', tipo: 'exchange', costos: [], minimo: '', maximo: '', activos: [], redes: [], horarios: '', actualizado: hoy(ahora), observaciones: '' };
}
export function nuevoCostoPerfil(clase = 'pct') {
  return { id: nuevoId('pk'), concepto: clase === 'pct' ? 'Comisión' : 'Comisión fija', clase, valor: '', cobro: 'auto', base: 'auto', minimo: '', fiscal: 'no_fiscal' };
}
export function nuevaRed() {
  return { id: nuevoId('rd'), red: '', retiro: '', minimoRetiro: '', tiempo: '' };
}

/** Valida la lista guardada; lo que no sirve se descarta o vuelve al valor por defecto. */
export function restaurarPlataformas(g) {
  if (!Array.isArray(g)) return [];
  const t = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
  const fecha = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '');
  return g.filter((p) => p && typeof p === 'object').slice(0, MAX_PLATAFORMAS).map((p, i) => ({
    id: t(p.id, 40) || `pl${i}`,
    nombre: t(p.nombre, 80),
    tipo: Object.hasOwn(TIPOS_PLATAFORMA, p.tipo) ? p.tipo : 'otro',
    costos: Array.isArray(p.costos) ? p.costos.filter((c) => c && typeof c === 'object').slice(0, MAX_COSTOS).map((c, j) => ({
      id: t(c.id, 40) || `pk${i}_${j}`, concepto: t(c.concepto, 60) || 'Costo', clase: CLASES.includes(c.clase) ? c.clase : 'pct', valor: t(c.valor, 200),
      cobro: Object.hasOwn(COBROS_PERFIL, c.cobro) ? c.cobro : 'auto', base: c.base === 'auto' || (BASES_PCT.includes(c.base) && c.base !== 'concepto') ? c.base : 'auto',
      minimo: t(c.minimo, 200), fiscal: Object.hasOwn(TRATAMIENTOS, c.fiscal) ? c.fiscal : 'no_fiscal',
    })) : [],
    minimo: t(p.minimo, 200), maximo: t(p.maximo, 200),
    activos: Array.isArray(p.activos) ? p.activos.filter((a) => IDS_ACTIVOS.includes(a)) : [],
    redes: Array.isArray(p.redes) ? p.redes.filter((r) => r && typeof r === 'object').slice(0, MAX_REDES).map((r, j) => ({
      id: t(r.id, 40) || `rd${i}_${j}`, red: t(r.red, 40), retiro: t(r.retiro, 200), minimoRetiro: t(r.minimoRetiro, 200), tiempo: t(r.tiempo, 200),
    })) : [],
    horarios: t(p.horarios, 200), actualizado: fecha(p.actualizado), observaciones: t(p.observaciones, 1000),
  }));
}

/**
 * Carga el perfil en un paso del borrador: plataforma, costos (copiados, editables), mínimo y máximo; en una
 * transferencia, la comisión de retiro y el mínimo de la red elegida. Devuelve el texto de lo que hizo.
 */
export function aplicarPerfil(paso, perfil, { desde, activoInicial, ahora = new Date() }) {
  const ladoAuto = desde === 'ARS' ? 'origen' : 'destino';
  paso.plataforma = perfil.nombre;
  const costos = perfil.costos.map((c) => {
    let lado = c.cobro === 'auto' ? ladoAuto : c.cobro;
    if (lado === 'aparte' && c.clase === 'pct' && desde !== activoInicial) lado = 'origen';
    const base = c.clase === 'pct' ? (c.base === 'auto' ? (lado === 'destino' ? 'bruto' : 'neto') : c.base) : null;
    return { id: nuevoId('k'), concepto: c.concepto, clase: c.clase, valor: c.valor, lado, base, sobre: null, minimo: c.clase === 'pct' ? c.minimo : '', fiscal: c.fiscal, hipotesis: false };
  });
  let red = null;
  if (paso.tipo === 'transferencia') {
    red = perfil.redes.find((r) => r.red && r.red.trim().toLowerCase() === String(paso.red ?? '').trim().toLowerCase()) ?? null;
    if (red) {
      costos.push({ id: nuevoId('k'), concepto: `Comisión de retiro (${red.red})`, clase: 'fijo', valor: red.retiro, lado: 'destino', base: null, sobre: null, minimo: '', fiscal: 'no_fiscal', hipotesis: false });
      if (red.minimoRetiro) paso.minimo = red.minimoRetiro;
      if (red.tiempo) { paso.tiempoValor = red.tiempo; paso.tiempoUnidad = 'h'; }
    }
  }
  if (costos.length) paso.costos = costos;
  if (perfil.minimo && paso.tipo !== 'transferencia') paso.minimo = perfil.minimo;
  if (perfil.maximo) paso.maximo = perfil.maximo;
  paso.perfil = { id: perfil.id, nombre: perfil.nombre, actualizado: perfil.actualizado, aplicadoAt: ahora.toISOString() };
  return `Cargué ${costos.length} costos de «${perfil.nombre || 'perfil sin nombre'}»${red ? ` (red ${red.red})` : paso.tipo === 'transferencia' && perfil.redes.length ? ' (elegí la red del paso para cargar su comisión de retiro)' : ''}. Revisalos: los podés editar.`;
}

/** Aviso sobre el perfil aplicado a un paso: desactualizado, cambiado después de aplicarlo o borrado. */
export function avisoPerfil(paso, plataformas, ahora = new Date()) {
  const ref = paso.perfil;
  if (!ref) return null;
  const p = plataformas.find((x) => x.id === ref.id);
  if (!p) return `El perfil «${ref.nombre}» ya no existe: los costos quedaron como estaban.`;
  if (p.actualizado && ref.actualizado && p.actualizado > ref.actualizado) return `El perfil «${p.nombre}» se actualizó el ${p.actualizado} después de cargarlo: volvé a cargarlo si cambiaron las tarifas.`;
  const dias = p.actualizado ? Math.floor((ahora.getTime() - Date.parse(`${p.actualizado}T12:00:00-03:00`)) / 86400e3) : null;
  if (dias === null) return `El perfil «${p.nombre}» no tiene fecha de revisión: confirmá que las tarifas estén vigentes.`;
  if (dias > DIAS_DESACTUALIZADO) return `El perfil «${p.nombre}» se revisó hace ${dias} días: las tarifas pueden haber cambiado.`;
  return null;
}

export { hoy };
