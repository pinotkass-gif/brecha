// Borrador de ruta tal como lo edita el usuario (textos en formato argentino) y su conversión
// a la entrada del motor. También plantillas y pasos nuevos.
// Formato 2 (Brecha 3): cada paso tiene una lista de costos con su base, su forma de cobro y su tratamiento fiscal.
// Un costo vacío es "No sé" (nunca 0). Los borradores del formato 1 se convierten al abrirlos.
import { parseNumberAR, formatNumberAR } from '../engine/format.mjs';
import { plain, toDec } from '../engine/decimal.mjs';
import { NO_APLICA, esNoAplica, TRATAMIENTOS } from '../engine/costos.mjs';
import {
  MAX_PASOS, BASES, MODOS_PCT, UNIDADES_TIEMPO, LADOS, BASES_PCT, CLASES, TIPOS_PASO, TIPOS_COTIZACION, REDONDEOS,
  MAX_COSTOS, MAX_NIVELES_LIBRO, costosDesdeFormatoAnterior,
} from '../engine/route.mjs';
import { IDS_ACTIVOS, corto, activoPorId } from './activos.mjs';
import { condicionesSugeridas, TIPOS_CONDICION } from './condiciones.mjs';
import { referenciaPaso } from './referencias.mjs';
import { MONTO_PLANTILLA } from './config.mjs';

export { TIPOS_CONDICION, MAX_PASOS };
export const INVALIDO = '__invalido__';
export const VERSION_BORRADOR = 2;
/** Compatibilidad: unidades de los costos fijos del formato 1. */
export const UNIDADES_FIJAS = ['origen', 'destino'];

export const PLANTILLAS = [
  { id: 'oficial-usdt', nombre: 'ARS → USD bancario → USDT → ARS', activos: ['ARS', 'USD_BANCO', 'USDT', 'ARS'] },
  { id: 'mep', nombre: 'ARS → USD MEP → ARS', activos: ['ARS', 'USD_MEP', 'ARS'] },
  { id: 'cripto', nombre: 'ARS → USDT → ARS', activos: ['ARS', 'USDT', 'ARS'] },
  { id: 'cripto-transferencia', nombre: 'ARS → USDT → (retiro a otro exchange) → ARS', activos: ['ARS', 'USDT', 'USDT', 'ARS'] },
  { id: 'vacia', nombre: 'En blanco: ARS → USD bancario', activos: ['ARS', 'USD_BANCO'] },
];

/** Costos que se pueden agregar a un paso con un clic (todos arrancan en "No sé"). */
export const PRESETS_COSTO = {
  comision: { concepto: 'Comisión', clase: 'pct', fiscal: 'no_fiscal' },
  iva: { concepto: 'IVA sobre la comisión', clase: 'pct', base: 'concepto', fiscal: 'pendiente' },
  derechos: { concepto: 'Derechos de mercado', clase: 'pct', fiscal: 'no_fiscal' },
  impuesto: { concepto: 'Impuesto o percepción', clase: 'pct', fiscal: 'pendiente' },
  fijo: { concepto: 'Comisión fija', clase: 'fijo', fiscal: 'no_fiscal' },
  retiro: { concepto: 'Comisión de retiro', clase: 'fijo', lado: 'destino', fiscal: 'no_fiscal' },
  deposito: { concepto: 'Comisión de depósito', clase: 'fijo', lado: 'destino', fiscal: 'no_fiscal' },
  gas: { concepto: 'Gas / comisión de red', clase: 'fijo', lado: 'destino', fiscal: 'no_fiscal' },
  maker: { concepto: 'Comisión maker/taker', clase: 'pct', fiscal: 'no_fiscal' },
  aparte: { concepto: 'Costo pagado aparte', clase: 'fijo', lado: 'aparte', fiscal: 'no_fiscal' },
};

let seq = 0;
export const nuevoId = (prefijo) => `${prefijo}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const baseSugerida = (desde) => (desde === 'ARS' ? 'origen_por_destino' : 'destino_por_origen');
export const modoSugerido = (desde) => (desde === 'ARS' ? 'encima' : 'descontado');
/** Lado sugerido para los % de un paso nuevo: si pagás con pesos, encima; si no, descontados de lo que recibís. */
const ladoSugerido = (desde) => (desde === 'ARS' ? 'origen' : 'destino');
/** Unidad en la que se expresa la cotización ("ARS por 1 USD" → ARS). */
export const unidadPrecio = (desde, hacia, base) => (base === 'origen_por_destino' ? desde : hacia);
/** Cómo leer el número de la cotización: con punto de miles si es en pesos; si no, el punto es decimal. */
export const kindCotizacion = (desde, hacia, base) => (unidadPrecio(desde, hacia, base) === 'ARS' ? 'money' : 'ratio');
export const etiquetaBase = (desde, hacia, base) => (base === 'origen_por_destino' ? `${corto(desde)} por 1 ${corto(hacia)}` : `${corto(hacia)} por 1 ${corto(desde)}`);
/** Cómo leer un importe en un activo: pesos con punto de miles; el resto, punto decimal permitido. */
export const kindMonto = (activo) => (activo === 'ARS' ? 'money' : 'ratio');

/** Activo que entrega el paso i (el inicial o lo que recibe el paso anterior). */
export const desdeDe = (b, i) => (i === 0 ? b.activoInicial : b.pasos[i - 1]?.hacia);

/** Decimal → texto argentino editable. Las relaciones van sin punto de miles para no confundirse. */
export function mostrar(v, kind = 'money') {
  if (v === null || v === undefined) return '';
  if (v === NO_APLICA) return 'no aplica';
  const d = toDec(v);
  if (kind === 'money') return formatNumberAR(d, { decimals: 12, minDecimals: 0 });
  return plain(d).replace('.', ',');
}

export function nuevaCondicion(tipo = 'otro', texto = '', origen = 'usuario') {
  return { id: nuevoId('c'), tipo, texto, origen, confirmada: false, confirmadaAt: null, fechaReferencia: '' };
}

function condicionesPara(desde, hacia, tipo = 'cambio') {
  if (tipo === 'transferencia') {
    return [
      nuevaCondicion('plataforma', `Confirmar la red, la comisión de retiro, el mínimo de retiro y el tiempo de acreditación de ${corto(desde)}.`, 'sugerida'),
      nuevaCondicion('cuenta', `Confirmar que la dirección o cuenta de destino acepta ${corto(desde)} en esa red y está a tu nombre.`, 'sugerida'),
    ];
  }
  return condicionesSugeridas(desde, hacia).map((c) => nuevaCondicion(c.tipo, c.texto, 'sugerida'));
}

export function nuevoCosto(preset = 'comision', lado = 'destino') {
  const p = PRESETS_COSTO[preset] ?? PRESETS_COSTO.comision;
  const l = p.lado ?? lado;
  return {
    id: nuevoId('k'), concepto: p.concepto, clase: p.clase, valor: '', lado: l,
    base: p.clase === 'pct' ? (p.base ?? (l === 'destino' ? 'bruto' : 'neto')) : null,
    sobre: null, minimo: '', fiscal: p.fiscal, hipotesis: false,
  };
}

/** Costos de un paso nuevo: comisión e impuestos %, comisión fija y transferencia. Todos en "No sé". */
function costosIniciales(desde, tipo) {
  const lado = ladoSugerido(desde);
  if (tipo === 'transferencia') return [nuevoCosto('retiro'), nuevoCosto('gas')];
  return [
    { ...nuevoCosto('comision', lado), concepto: 'Comisión' },
    { ...nuevoCosto('impuesto', lado), concepto: 'Impuestos' },
    { ...nuevoCosto('fijo', 'origen'), lado: 'origen' },
    { ...nuevoCosto('fijo', 'destino'), concepto: 'Costo de transferencia', lado: 'destino' },
  ];
}

export function pasoNuevo(desde, hacia, mercados = null, tipo = 'cambio') {
  const p = {
    id: nuevoId('p'),
    tipo,
    hacia: tipo === 'transferencia' ? desde : hacia,
    plataforma: '',
    red: '',
    cotizacion: '',
    cotizacionTipo: 'ejecucion',
    cotizacionHipotesis: false,
    base: baseSugerida(desde),
    fuenteCotizacion: null,
    confirmacionCotizacion: null,
    fuenteConfirmacion: '',
    costos: costosIniciales(desde, tipo),
    slippagePct: '',
    spreadPct: '',
    libro: [],
    minimo: '',
    maximo: '',
    liquidez: '',
    liquidezConfirmada: null,
    fuenteLiquidez: '',
    tiempoValor: '',
    tiempoUnidad: 'h',
    redondeo: '',
    perfil: null,
    condiciones: condicionesPara(desde, tipo === 'transferencia' ? desde : hacia, tipo),
    nota: '',
  };
  if (tipo === 'cambio') aplicarReferencia(p, desde, mercados);
  return p;
}

/** Carga la cotización de referencia del par, si existe. Devuelve true si la aplicó. */
export function aplicarReferencia(paso, desde, mercados) {
  if (paso.tipo === 'transferencia') return false;
  const ref = referenciaPaso(desde, paso.hacia, mercados);
  if (!ref) return false;
  paso.base = ref.base;
  paso.cotizacion = mostrar(ref.valor, kindCotizacion(desde, paso.hacia, ref.base));
  paso.fuenteCotizacion = { tipo: 'referencia', ...ref };
  paso.cotizacionHipotesis = false;
  return true;
}

/** Al cambiar el par de un paso: cotización, confirmaciones y condiciones sugeridas vuelven a cero. */
export function reiniciarPar(b, i, mercados) {
  const p = b.pasos[i];
  if (!p) return;
  const desde = desdeDe(b, i);
  if (p.tipo === 'transferencia') p.hacia = desde;
  p.base = baseSugerida(desde);
  p.cotizacion = '';
  p.fuenteCotizacion = null;
  p.confirmacionCotizacion = null;
  p.liquidezConfirmada = null;
  p.libro = [];
  // Los costos se conservan, pero un % "aparte" sólo vale si se entrega el activo inicial.
  for (const c of p.costos) if (c.lado === 'aparte' && c.clase === 'pct' && desde !== b.activoInicial) c.lado = 'origen';
  const propias = p.condiciones.filter((c) => c.origen !== 'sugerida').map((c) => ({ ...c, confirmada: false, confirmadaAt: null }));
  p.condiciones = [...condicionesPara(desde, p.hacia, p.tipo), ...propias];
  aplicarReferencia(p, desde, mercados);
}

export function crearBorrador(plantillaId = 'oficial-usdt', mercados = null) {
  const pl = PLANTILLAS.find((x) => x.id === plantillaId) ?? PLANTILLAS[0];
  const b = { version: VERSION_BORRADOR, plantilla: pl.id, activoInicial: pl.activos[0], montoInicial: MONTO_PLANTILLA, estresPct: '', redondeo: 'ninguno', pasos: [] };
  for (let i = 1; i < pl.activos.length; i++) {
    const desde = pl.activos[i - 1];
    const tipo = pl.activos[i] === desde ? 'transferencia' : 'cambio';
    b.pasos.push(pasoNuevo(desde, pl.activos[i], mercados, tipo));
  }
  return b;
}

/** Texto de un costo → valor del motor. Vacío = no sé (null), "no aplica" = NO_APLICA. */
function leerTexto(raw, kind) {
  if (esNoAplica(raw)) return NO_APLICA;
  const p = parseNumberAR(raw, { kind });
  if (!p.ok) return INVALIDO;
  return p.empty ? null : p.value;
}

/** Borrador → entrada del motor + datos de verificación. Lo que no se puede leer va como INVALIDO. */
export function normalizar(b) {
  const num = (raw, kind) => {
    const p = parseNumberAR(raw, { kind });
    if (!p.ok) return INVALIDO;
    return p.empty ? null : p.value;
  };
  const pasos = [];
  const meta = { pasos: [] };
  b.pasos.forEach((p, i) => {
    const desde = desdeDe(b, i);
    const hacia = p.tipo === 'transferencia' ? desde : p.hacia;
    const activoDeLado = (lado) => (lado === 'destino' ? hacia : lado === 'aparte' ? b.activoInicial : desde);
    pasos.push({
      desde,
      hacia,
      tipo: p.tipo,
      base: p.base,
      cotizacion: p.tipo === 'transferencia' ? null : num(p.cotizacion, kindCotizacion(desde, hacia, p.base)),
      cotizacionTipo: p.cotizacionTipo,
      cotizacionHipotesis: p.cotizacionHipotesis === true,
      costos: p.costos.map((c) => ({
        id: c.id, concepto: c.concepto, clase: c.clase, lado: c.lado, base: c.base ?? undefined, sobre: c.sobre ?? undefined, fiscal: c.fiscal, hipotesis: c.hipotesis === true,
        valor: leerTexto(c.valor, c.clase === 'pct' ? 'percent' : kindMonto(activoDeLado(c.lado))),
        minimo: c.clase === 'pct' && String(c.minimo ?? '').trim() ? num(c.minimo, kindMonto(activoDeLado(c.lado))) : null,
      })),
      slippagePct: leerTexto(p.slippagePct, 'percent'),
      spreadPct: leerTexto(p.spreadPct, 'percent'),
      libro: p.tipo === 'transferencia' ? [] : (p.libro ?? []).filter((n) => String(n.precio ?? '').trim() || String(n.cantidad ?? '').trim()).map((n) => ({
        precio: num(n.precio, kindCotizacion(desde, hacia, p.base)),
        cantidad: num(n.cantidad, kindMonto(p.base === 'destino_por_origen' ? desde : hacia)),
      })),
      minimo: num(p.minimo, kindMonto(desde)),
      maximo: num(p.maximo, kindMonto(desde)),
      liquidez: num(p.liquidez, kindMonto(hacia)),
      tiempo: { valor: num(p.tiempoValor, 'ratio'), unidad: p.tiempoUnidad },
      redondeo: p.redondeo || undefined,
    });
    meta.pasos.push({
      plataforma: p.plataforma,
      confirmacionCotizacion: p.confirmacionCotizacion,
      liquidezConfirmada: p.liquidezConfirmada,
      condiciones: p.condiciones,
    });
  });
  return {
    entrada: { activoInicial: b.activoInicial, montoInicial: num(b.montoInicial, kindMonto(b.activoInicial)), estresPct: num(b.estresPct, 'percent'), redondeo: b.redondeo || 'ninguno', pasos },
    meta,
  };
}

/** Valor exacto del motor → texto del borrador. 0 se conserva como "0" (confirmado), nunca como vacío. */
function aTexto(v, kind) {
  if (v === null || v === undefined || v === INVALIDO) return '';
  if (v === NO_APLICA) return 'no aplica';
  return mostrar(v, kind);
}

/** Entrada del motor (valores exactos) → borrador editable. Se usa al pasar desde la calculadora simple o la matriz. */
export function borradorDesdeEntrada(entrada, { notas = {}, fuente = 'Desde la calculadora simple' } = {}) {
  const b = { version: VERSION_BORRADOR, plantilla: null, activoInicial: entrada.activoInicial, montoInicial: aTexto(entrada.montoInicial, kindMonto(entrada.activoInicial)), estresPct: '', redondeo: entrada.redondeo ?? 'ninguno', pasos: [] };
  entrada.pasos.forEach((e, i) => {
    const tipo = e.tipo ?? 'cambio';
    const p = pasoNuevo(e.desde, e.hacia, null, tipo);
    const activoDeLado = (lado) => (lado === 'destino' ? e.hacia : lado === 'aparte' ? entrada.activoInicial : e.desde);
    p.base = e.base ?? p.base;
    p.cotizacion = tipo === 'transferencia' ? '' : aTexto(e.cotizacion, kindCotizacion(e.desde, e.hacia, p.base));
    p.cotizacionHipotesis = e.cotizacionHipotesis === true;
    p.fuenteCotizacion = { tipo: 'simple', detalle: fuente };
    const costos = Array.isArray(e.costos) ? e.costos : costosDesdeFormatoAnterior(e);
    p.costos = costos.map((c) => ({
      id: c.id ?? nuevoId('k'), concepto: c.concepto ?? 'Costo', clase: c.clase ?? 'pct', lado: c.lado ?? 'destino',
      base: (c.clase ?? 'pct') === 'pct' ? (c.base ?? ((c.lado ?? 'destino') === 'destino' ? 'bruto' : 'neto')) : null,
      sobre: c.sobre ?? null, fiscal: c.fiscal ?? 'no_fiscal', hipotesis: c.hipotesis === true,
      valor: aTexto(c.valor, (c.clase ?? 'pct') === 'pct' ? 'percent' : kindMonto(activoDeLado(c.lado ?? 'destino'))),
      minimo: c.minimo ? aTexto(c.minimo, kindMonto(activoDeLado(c.lado))) : '',
    }));
    p.slippagePct = aTexto(e.slippagePct, 'percent');
    p.spreadPct = aTexto(e.spreadPct, 'percent');
    p.nota = notas[i] ?? '';
    b.pasos.push(p);
  });
  return b;
}

/** Topes de lo que se guarda por paso (lo que viene de un archivo o del navegador es dato no confiable). */
export const MAX_CONDICIONES = 30;
export const LARGOS = { numero: 200, plataforma: 80, nota: 2000, condicion: 500, corto: 60 };
const TIPOS_FUENTE = ['referencia', 'manual', 'simple', 'perfil', 'bonos', 'libro'];
const CLAVES_FUENTE = ['tipo', 'detalle', 'valor', 'base', 'mercado', 'nombreMercado', 'punta', 'origen', 'fuente', 'fechaFuente', 'editadoAt', 'generica'];

/**
 * Valida un borrador guardado (formato 1 o 2). Devuelve null si no sirve.
 * Los textos se recortan a un largo razonable. Los números se recortan a 200 caracteres, más que el máximo
 * que acepta la app (100): uno demasiado largo sigue dando error al abrirlo, nunca cambia de valor en silencio.
 * Un paso con más de MAX_CONDICIONES condiciones invalida el borrador (descartarlas podría hacer que una ruta
 * con condiciones sin confirmar figure como confirmada). Lo mismo con más de MAX_COSTOS costos.
 * Del formato 1 se convierten comisión, impuestos, comisión fija y transferencia a la lista de costos: lo que
 * estaba vacío queda vacío, que ahora significa "No sé" (antes contaba como 0). `migrado` lo avisa.
 */
export function restaurarBorrador(g) {
  if (!g || typeof g !== 'object' || !IDS_ACTIVOS.includes(g.activoInicial) || !Array.isArray(g.pasos) || g.pasos.length > MAX_PASOS) return null;
  const txt = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
  const num = (x) => txt(x, LARGOS.numero);
  const v1 = g.version !== VERSION_BORRADOR;
  const pasos = [];
  for (let i = 0; i < g.pasos.length; i++) {
    const s = g.pasos[i];
    if (!s || typeof s !== 'object') return null;
    const desde = i === 0 ? g.activoInicial : pasos[i - 1].hacia;
    const tipo = TIPOS_PASO.includes(s.tipo) ? s.tipo : 'cambio';
    const hacia = tipo === 'transferencia' ? desde : s.hacia;
    if (!IDS_ACTIVOS.includes(hacia)) return null;
    if (Array.isArray(s.condiciones) && s.condiciones.length > MAX_CONDICIONES) return null;
    if (Array.isArray(s.costos) && s.costos.length > MAX_COSTOS) return null;
    const base = pasoNuevo(desde, hacia, null, tipo);
    let costos;
    if (Array.isArray(s.costos)) {
      costos = s.costos.filter((c) => c && typeof c === 'object').map((c, j) => costoValido(c, txt, num, `k${i}x${j}`));
    } else {
      // Formato 1
      const modo = MODOS_PCT.includes(s.modoPct) ? s.modoPct : 'descontado';
      const lado = modo === 'encima' ? 'origen' : 'destino';
      const basePct = modo === 'encima' ? 'neto' : 'bruto';
      const uni = (u) => (UNIDADES_FIJAS.includes(u) ? u : 'origen');
      costos = [
        { id: `k${i}a`, concepto: 'Comisión', clase: 'pct', valor: num(s.comisionPct), lado, base: basePct, sobre: null, minimo: '', fiscal: 'no_fiscal', hipotesis: false },
        { id: `k${i}b`, concepto: 'Impuestos', clase: 'pct', valor: num(s.impuestoPct), lado, base: basePct, sobre: null, minimo: '', fiscal: 'pendiente', hipotesis: false },
        { id: `k${i}c`, concepto: 'Comisión fija', clase: 'fijo', valor: num(s.comisionFija), lado: uni(s.comisionFijaUnidad), base: null, sobre: null, minimo: '', fiscal: 'no_fiscal', hipotesis: false },
        { id: `k${i}d`, concepto: 'Costo de transferencia', clase: 'fijo', valor: num(s.costoTransferencia), lado: UNIDADES_FIJAS.includes(s.costoTransferenciaUnidad) ? s.costoTransferenciaUnidad : 'destino', base: null, sobre: null, minimo: '', fiscal: 'no_fiscal', hipotesis: false },
      ];
    }
    const libro = Array.isArray(s.libro) ? s.libro.slice(0, MAX_NIVELES_LIBRO).filter((n) => n && typeof n === 'object').map((n) => ({ precio: num(n.precio), cantidad: num(n.cantidad) })) : [];
    pasos.push({
      ...base,
      id: txt(s.id, LARGOS.corto) || `p${i}`,
      tipo,
      hacia,
      plataforma: txt(s.plataforma, LARGOS.plataforma),
      red: txt(s.red, LARGOS.corto),
      cotizacion: tipo === 'transferencia' ? '' : num(s.cotizacion),
      cotizacionTipo: TIPOS_COTIZACION.includes(s.cotizacionTipo) ? s.cotizacionTipo : 'ejecucion',
      cotizacionHipotesis: s.cotizacionHipotesis === true,
      base: BASES.includes(s.base) ? s.base : base.base,
      fuenteCotizacion: fuenteValida(s.fuenteCotizacion),
      confirmacionCotizacion: confirmacionValida(s.confirmacionCotizacion, 'valor'),
      fuenteConfirmacion: txt(s.fuenteConfirmacion, LARGOS.plataforma),
      costos,
      slippagePct: num(s.slippagePct),
      spreadPct: num(s.spreadPct),
      libro,
      minimo: num(s.minimo),
      maximo: num(s.maximo),
      liquidez: num(s.liquidez),
      liquidezConfirmada: confirmacionValida(s.liquidezConfirmada, 'hasta'),
      fuenteLiquidez: txt(s.fuenteLiquidez, LARGOS.plataforma),
      tiempoValor: num(s.tiempoValor),
      tiempoUnidad: UNIDADES_TIEMPO.includes(s.tiempoUnidad) ? s.tiempoUnidad : 'h',
      redondeo: REDONDEOS.includes(s.redondeo) ? s.redondeo : '',
      perfil: s.perfil && typeof s.perfil === 'object' && typeof s.perfil.id === 'string'
        ? { id: s.perfil.id.slice(0, LARGOS.corto), nombre: txt(s.perfil.nombre, LARGOS.plataforma), actualizado: txt(s.perfil.actualizado, 40), aplicadoAt: txt(s.perfil.aplicadoAt, 40) } : null,
      condiciones: Array.isArray(s.condiciones)
        ? s.condiciones.filter((c) => c && typeof c === 'object').map((c, j) => ({
          id: txt(c.id, LARGOS.corto) || `c${i}_${j}`,
          tipo: Object.hasOwn(TIPOS_CONDICION, c.tipo) ? c.tipo : 'otro',
          texto: txt(c.texto, LARGOS.condicion),
          origen: c.origen === 'sugerida' ? 'sugerida' : 'usuario',
          confirmada: c.confirmada === true,
          confirmadaAt: typeof c.confirmadaAt === 'string' ? c.confirmadaAt.slice(0, 40) : null,
          fechaReferencia: txt(c.fechaReferencia, 40),
        }))
        : base.condiciones,
      nota: txt(s.nota, LARGOS.nota),
    });
  }
  // Referencias "sobre otro costo" que apuntan a un costo que ya no existe quedan sin referencia (el motor lo informa).
  for (const p of pasos) for (const c of p.costos) if (c.sobre && !p.costos.some((x) => x.id === c.sobre)) c.sobre = null;
  return {
    version: VERSION_BORRADOR, plantilla: txt(g.plantilla, LARGOS.corto) || null, activoInicial: g.activoInicial, montoInicial: num(g.montoInicial),
    estresPct: num(g.estresPct), redondeo: REDONDEOS.includes(g.redondeo) ? g.redondeo : 'ninguno', pasos, ...(v1 || g.migrado === true ? { migrado: true } : {}),
  };
}

function costoValido(c, txt, num, idPorDefecto) {
  const clase = CLASES.includes(c.clase) ? c.clase : 'pct';
  const lado = LADOS.includes(c.lado) ? c.lado : clase === 'fijo' ? 'origen' : 'destino';
  return {
    id: txt(c.id, 40) || idPorDefecto,
    concepto: txt(c.concepto, LARGOS.corto) || 'Costo',
    clase,
    valor: num(c.valor),
    lado,
    base: clase === 'pct' ? (BASES_PCT.includes(c.base) ? c.base : lado === 'destino' ? 'bruto' : 'neto') : null,
    sobre: typeof c.sobre === 'string' ? c.sobre.slice(0, 40) : null,
    minimo: num(c.minimo),
    fiscal: Object.hasOwn(TRATAMIENTOS, c.fiscal) ? c.fiscal : 'no_fiscal',
    hipotesis: c.hipotesis === true,
  };
}

function confirmacionValida(c, campo) {
  if (!c || typeof c !== 'object' || typeof c[campo] !== 'string' || typeof c.at !== 'string') return null;
  const out = { [campo]: c[campo].slice(0, LARGOS.numero), at: c.at.slice(0, 40) };
  for (const k of ['fuente', 'plataforma']) if (typeof c[k] === 'string') out[k] = c[k].slice(0, LARGOS.plataforma);
  if (typeof c.importe === 'string' && /^\d+(\.\d+)?$/.test(c.importe) && c.importe.length <= LARGOS.numero) out.importe = c.importe;
  if (typeof c.activo === 'string' && IDS_ACTIVOS.includes(c.activo)) out.activo = c.activo;
  return out;
}

/** De dónde salió la cotización: sólo los campos conocidos y con valores simples. */
function fuenteValida(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f) || !TIPOS_FUENTE.includes(f.tipo)) return null;
  const out = {};
  for (const k of CLAVES_FUENTE) {
    const v = f[k];
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** Activos con su cantidad de decimales (para el redondeo de ejecución y para mostrar importes). */
export const DECIMALES = Object.fromEntries(IDS_ACTIVOS.map((id) => [id, activoPorId(id).precision]));
export const NOMBRES = Object.fromEntries(IDS_ACTIVOS.map((id) => [id, corto(id)]));
