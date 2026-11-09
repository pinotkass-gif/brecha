// Simulador de rutas por pasos: la salida de un paso es la entrada del siguiente.
// No sabe de mercados ni de normativa: sólo números, unidades, costos y confirmaciones del usuario.
// Especificación: docs/rutas.md y docs/motor-financiero.md
import { Dec, ZERO, ONE, HUNDRED, pct, toDec, sign, plain } from './decimal.mjs';
import { checkField } from './validate.mjs';
import { checkCosto, TRATAMIENTOS, esRecuperable, calidadDe } from './costos.mjs';

/** Versión del motor financiero. Se guarda con cada simulación para poder reconstruirla. */
export const VERSION_MOTOR = '3.0.0';
export const MAX_PASOS = 8;
export const MAX_COSTOS = 12;
export const MAX_NIVELES_LIBRO = 30;
export const BASES = ['destino_por_origen', 'origen_por_destino'];
export const MODOS_PCT = ['encima', 'descontado'];
export const UNIDADES_FIJAS = ['origen', 'destino', 'aparte'];
export const LADOS = ['origen', 'destino', 'aparte'];
export const BASES_PCT = ['neto', 'bruto', 'concepto'];
export const CLASES = ['pct', 'fijo'];
export const TIPOS_PASO = ['cambio', 'transferencia'];
export const TIPOS_COTIZACION = ['ejecucion', 'medio'];
export const UNIDADES_TIEMPO = ['min', 'h', 'd', 'dh'];
export const REDONDEOS = ['ninguno', 'abajo', 'cercano'];
/** Objetivos de rentabilidad para los precios de salida (en % sobre el capital desembolsado). */
export const OBJETIVOS_PCT = ['0', '1', '2', '5'];

/**
 * @typedef {object} CostoEntrada
 * @property {string} [id]          identificador dentro del paso (para referenciarlo: "IVA sobre la comisión")
 * @property {string} [concepto]    "Comisión", "IVA", "Derechos de mercado", "Retiro"…
 * @property {'pct'|'fijo'} clase
 * @property {*} valor              % o importe. Vacío = NO SÉ (no es cero). NO_APLICA = no existe.
 * @property {'origen'|'destino'|'aparte'} lado
 *   origen: sale de lo que entregás (operás menos) · destino: se descuenta de lo que recibís
 *   aparte: lo pagás aparte en el activo inicial (se suma al capital desembolsado)
 * @property {'neto'|'bruto'|'concepto'} [base]  sólo %:
 *   origen/aparte: neto = sobre lo operado · bruto = sobre todo lo que entregás en el paso
 *   destino: bruto = sobre lo recibido antes de costos · neto = sobre lo recibido después de los % sobre el bruto
 *   concepto: sobre otro costo del mismo lado (id en `sobre`), p. ej. IVA sobre la comisión
 * @property {string} [sobre]
 * @property {*} [minimo]           mínimo del costo % (en el activo de su lado)
 * @property {keyof TRATAMIENTOS} [fiscal]  tratamiento económico (por defecto: no es un concepto fiscal)
 * @property {boolean} [hipotesis]  el valor es una hipótesis del usuario (el resultado queda ESTIMADO)
 *
 * @typedef {object} PasoEntrada  Valores en formato máquina (Dec, number o "1650.69").
 * @property {string} [desde]   activo que entregás (si falta, el que entrega el paso anterior)
 * @property {string} hacia     activo que recibís (en una transferencia, el mismo)
 * @property {'cambio'|'transferencia'} [tipo]  transferencia: mismo activo entre plataformas o redes (precio 1)
 * @property {*} cotizacion     precio (> 0). Vacío = DATOS INSUFICIENTES (nunca se supone 1)
 * @property {boolean} [cotizacionHipotesis]
 * @property {'ejecucion'|'medio'} [cotizacionTipo]  medio = precio medio: se aplica el spread
 * @property {'destino_por_origen'|'origen_por_destino'} [base]
 * @property {CostoEntrada[]} [costos]
 * @property {*} [slippagePct]  % de precio en contra. Vacío = no sé
 * @property {*} [spreadPct]    sólo si cotizacionTipo = medio
 * @property {Array<{precio: *, cantidad: *}>} [libro]  niveles del libro de órdenes: precio promedio para el monto
 * @property {*} [minimo] @property {*} [maximo]  por operación, en el activo de origen
 * @property {*} [liquidez]     disponible en el activo de destino
 * @property {{valor: *, unidad: 'min'|'h'|'d'|'dh'}} [tiempo]  dh = días hábiles
 * @property {'ninguno'|'abajo'|'cercano'} [redondeo]  redondeo de ejecución de lo recibido
 * (Formato anterior, se sigue aceptando: modoPct, comisionPct, impuestoPct, comisionFija, costoTransferencia.)
 */

/**
 * @param {{activoInicial: string, montoInicial: *, estresPct?: *, redondeo?: string, pasos: PasoEntrada[]}} entrada
 * @param {{activosValidos?: string[]|null, decimales?: Record<string, number>, nombres?: Record<string, string>, objetivos?: boolean|'equilibrio'}} [opts]
 *   objetivos: true = equilibrio y +1/+2/+5 % · 'equilibrio' = sólo el equilibrio (más rápido, para la matriz) · false = ninguno
 */
export function simularRuta(entrada = {}, opts = {}) {
  const { activosValidos = null, decimales = {}, nombres = {}, objetivos = true } = opts;
  if (!entrada || typeof entrada !== 'object') entrada = {};
  const nom = (id) => nombres[id] ?? nombreActivo(id);
  const errors = [];
  const warnings = [];
  const g = { errors, values: {} };
  const inicial = entrada.activoInicial;
  if (!inicial) errors.push({ field: 'activoInicial', code: 'requerido', message: 'Falta el activo inicial.' });
  else if (typeof inicial !== 'string' || (activosValidos && !activosValidos.includes(inicial))) {
    errors.push({ field: 'activoInicial', code: 'invalido', message: `Activo inicial desconocido: ${nombreActivo(inicial)}.` });
  }
  checkField(g, 'montoInicial', 'Monto inicial', entrada.montoInicial, { required: true, min: 0, minExclusive: true });
  checkField(g, 'estresPct', 'Estrés de precios', entrada.estresPct, { default: 0, min: 0, max: 100, maxExclusive: true });
  const estres = g.values.estresPct ?? ZERO;
  const redondeoRuta = entrada.redondeo ?? 'ninguno';
  if (!REDONDEOS.includes(redondeoRuta)) errors.push({ field: 'redondeo', code: 'invalido', message: 'Redondeo de ejecución inválido.' });

  const pasos = Array.isArray(entrada.pasos) ? entrada.pasos : [];
  if (!pasos.length) errors.push({ field: 'pasos', code: 'requerido', message: 'La ruta necesita al menos un paso.' });
  if (pasos.length > MAX_PASOS) errors.push({ field: 'pasos', code: 'demasiados_pasos', message: `La ruta admite hasta ${MAX_PASOS} pasos.` });

  const vals = [];
  let esperado = inicial;
  pasos.slice(0, MAX_PASOS).forEach((p, i) => {
    vals.push(validarPaso(p ?? {}, i, esperado, inicial, errors, activosValidos, estres, redondeoRuta, nom));
    esperado = vals[i].hacia;
  });
  if (errors.length) return fallo(errors, warnings);

  const montoInicial = g.values.montoInicial;
  const ctx = { estres, decimales, nom, inicial };
  let E = montoInicial;
  let teorico = montoInicial;
  const res = [];
  for (let i = 0; i < vals.length; i++) {
    const r = calcularPaso(vals[i], E, ctx);
    if (r.error) {
      errors.push({ field: `pasos.${i}${r.campo ? `.${r.campo}` : ''}`, paso: i, code: r.code, message: r.error });
      return fallo(errors, warnings);
    }
    const v = vals[i];
    const precioTeorico = v.tipo === 'transferencia' ? ONE : v.libro ? r.mejorPrecio : v.P;
    const teoricoSalida = v.mult ? teorico.times(precioTeorico) : teorico.div(precioTeorico);
    res.push({ ...r, indice: i, teoricoEntrada: teorico, teoricoSalida });
    E = r.recibido;
    teorico = teoricoSalida;
  }

  const ultimo = vals[vals.length - 1];
  const activoFinal = ultimo.hacia;
  const montoFinal = E;
  const brutoTeorico = teorico;
  const mismoActivo = activoFinal === inicial;
  const pagosAparte = res.reduce((a, r) => a.plus(r.aparte), ZERO);
  const capitalInvertido = montoInicial.plus(pagosAparte);
  const costosTotales = brutoTeorico.minus(montoFinal).plus(mismoActivo ? pagosAparte : ZERO);
  const tiempo = sumarTiempos(res);

  // Calidad: qué no se conoce y qué es hipótesis
  const desconocidos = [];
  const hipotesis = [];
  vals.forEach((v, i) => {
    for (const d of v.desconocidos) desconocidos.push({ paso: i, ...d, texto: `Paso ${i + 1}: ${d.etiqueta}` });
    for (const h of v.hipotesis) hipotesis.push({ paso: i, ...h, texto: `Paso ${i + 1}: ${h.etiqueta}` });
  });
  const calidad = calidadDe({ desconocidos, hipotesis });
  const resultadoParcial = desconocidos.length > 0;

  let resultadoNeto = null;
  let roiPct = null;
  let brechaRutaPct = null;
  let equilibrio = null;
  let objetivosPrecio = null;
  let estado = null;
  let fiscal = null;
  let resultadoEconomico = null;
  if (mismoActivo) {
    resultadoNeto = montoFinal.minus(capitalInvertido);
    roiPct = resultadoNeto.div(capitalInvertido).times(HUNDRED);
    brechaRutaPct = brutoTeorico.div(montoInicial).minus(ONE).times(HUNDRED);
    const st = sign(resultadoNeto);
    estado = st > 0 ? 'ganancia' : st < 0 ? 'perdida' : 'neutro';
    fiscal = resumenFiscal(res, inicial);
    const min = resultadoNeto.plus(fiscal.recuperables);
    resultadoEconomico = { min, max: min.plus(fiscal.pendientes), determinado: fiscal.pendientes.eq(0) && !fiscal.noValuables.length };
    if (objetivos) {
      objetivosPrecio = preciosObjetivo(vals[vals.length - 1], res[res.length - 1], ctx, capitalInvertido, objetivos === 'equilibrio' ? ['0'] : OBJETIVOS_PCT);
      equilibrio = objetivosPrecio.find((o) => o.objetivoPct === '0')?.precio ? objetivosPrecio[0] : null;
    }
  } else {
    warnings.push({ code: 'termina_en_otro_activo', message: `La ruta termina en ${nom(activoFinal)}, no en ${nom(inicial)}: no hay ganancia comparable sin un paso de vuelta a ${nom(inicial)}.` });
  }
  if (resultadoParcial) {
    warnings.push({ code: 'costos_desconocidos', message: `Faltan ${desconocidos.length} costos que marcaste como "No sé": el resultado es una cota máxima (con esos costos va a ser menor).` });
  }
  for (const r of res) if (r.libroExcedido === false && r.impactoPct?.gt(0)) {
    warnings.push({ code: 'impacto_libro', message: `Paso ${r.indice + 1}: el tamaño de la operación empeora el precio ${plain(r.impactoPct.round(4, 1))} % contra el mejor nivel del libro.` });
  }

  return {
    ok: true,
    errors: [],
    warnings,
    calidad,
    result: {
      version: VERSION_MOTOR,
      pasos: res, activoInicial: inicial, montoInicial, pagosAparte, capitalInvertido, activoFinal, montoFinal, brutoTeorico, costosTotales,
      mismoActivo, resultadoNeto, roiPct, brechaRutaPct, equilibrio, objetivosPrecio, estado,
      tiempoTotalHoras: tiempo.horas, tiempoDiasHabiles: tiempo.diasHabiles, tiempoCompleto: tiempo.completo,
      estresPct: estres, resultadoParcial, calidad, fiscal, resultadoEconomico, redondeo: redondeoRuta,
    },
  };
}

function fallo(errors, warnings) {
  const insuf = errors.filter((e) => e.code === 'requerido' || e.code === 'excede_libro');
  const datosInsuficientes = insuf.length > 0 && insuf.length === errors.length;
  return {
    ok: false, errors, warnings, result: null, datosInsuficientes,
    calidad: { nivel: 'insuficiente', insuficientes: insuf.map((e) => e.message), desconocidos: [], hipotesis: [] },
  };
}

/* ---------- Un paso ---------- */

/**
 * Calcula un paso a partir de lo que entregás. Pura: se reusa para resolver precios objetivo.
 * @param {*} v paso validado  @param {Dec} E entregado  @param {*} ctx  @param {Dec} [precioOverride]
 */
export function calcularPaso(v, E, ctx, precioOverride = null) {
  const n = v.indice + 1;
  // Al buscar precios objetivo, un precio que se redondea a 0 no es un precio: no se calcula.
  if (precioOverride !== null && precioOverride.lte(0)) return { error: `Paso ${n}: precio no positivo.`, code: 'precio_invalido' };
  const nom = ctx.nom;
  const fijo = (c) => c.clase === 'fijo';
  // 1) Origen: fijos que salen de lo que entregás, % sobre lo entregado (bruto) y % sobre lo operado (neto).
  const origen = v.costos.filter((c) => c.lado === 'origen' || c.lado === 'aparte');
  const reduce = (c) => c.lado === 'origen';
  const montoDe = new Map();
  const alMinimo = new Set();
  let O = null;
  for (let iter = 0; iter <= origen.length + 1; iter++) {
    let fijos = ZERO;
    let coef = ZERO;
    for (const c of origen) {
      if (!reduce(c)) continue;
      const k = coefOrigen(c, v, E, alMinimo);
      if (k.fijo !== null) fijos = fijos.plus(k.fijo);
      else coef = coef.plus(k.coef);
    }
    // Sin % sobre lo operado no se divide: dividir por 1 redondearía a 40 decimales antes de tiempo.
    O = coef.eq(0) ? E.minus(fijos) : E.minus(fijos).div(ONE.plus(coef));
    let cambio = false;
    for (const c of origen) {
      if (c.clase !== 'pct' || c.minimo === null || alMinimo.has(c.id)) continue;
      const m = montoOrigen(c, v, E, O, alMinimo, new Map());
      if (m.lt(c.minimo)) { alMinimo.add(c.id); cambio = true; }
    }
    if (!cambio) break;
  }
  if (O.lte(0)) return { error: `Paso ${n}: los costos que salen de lo que entregás (${nom(v.desde)}) son iguales o mayores a lo que entregás.`, code: 'paso_sin_saldo' };
  let fijosOrigen = ZERO;
  let comisionOrigen = ZERO;
  let impuestoOrigen = ZERO;
  let aparte = ZERO;
  const detalle = [];
  for (const c of origen) {
    const m = montoOrigen(c, v, E, O, alMinimo, montoDe);
    montoDe.set(c.id, m);
    if (c.lado === 'aparte') aparte = aparte.plus(m);
    else if (fijo(c)) fijosOrigen = fijosOrigen.plus(m);
    else if (c.fiscal === 'no_fiscal') comisionOrigen = comisionOrigen.plus(m);
    else impuestoOrigen = impuestoOrigen.plus(m);
    detalle.push(costoDetalle(c, m, c.lado === 'aparte' ? ctx.inicial : v.desde, alMinimo.has(c.id)));
  }

  // 2) Precio: transferencia (1), libro de órdenes (promedio para el monto) o cotización con spread y slippage.
  const sEff = pct(v.spread.plus(v.s).plus(ctx.estres));
  let P;
  let precioEfectivo;
  let bruto;
  let brutoSinSlippage;
  let mejorPrecio = null;
  let impactoPct = null;
  let libroExcedido = null;
  if (v.tipo === 'transferencia') {
    P = ONE;
    precioEfectivo = ONE;
    bruto = O;
    brutoSinSlippage = O;
  } else if (v.libro) {
    const escala = precioOverride ? precioOverride.div(v.libro[0].precio) : ONE;
    if (escala.lte(0)) return { error: `Paso ${n}: precio no positivo.`, code: 'precio_invalido' };
    const lleno = llenarLibro(v.libro, O, v.mult, escala);
    if (!lleno.ok) return { error: `Paso ${n}: el monto supera la profundidad del libro que cargaste (alcanza para ${plain(lleno.capacidad.round(8, 0))} ${nom(v.desde)}). No se inventa un precio para el resto: cargá más niveles o bajá el monto.`, code: 'excede_libro', libroExcedido: true };
    if (!lleno.promedio) return { error: `Paso ${n}: lo que operás es demasiado chico para el libro que cargaste: no recibirías nada.`, code: 'paso_sin_saldo' };
    mejorPrecio = v.libro[0].precio.times(escala);
    P = lleno.promedio; // precio promedio ponderado para este monto
    precioEfectivo = v.mult ? P.times(ONE.minus(sEff)) : P.times(ONE.plus(sEff));
    // Lo recibido sale exacto del libro (no de multiplicar por el promedio, que ya está redondeado).
    brutoSinSlippage = lleno.recibido;
    bruto = sEff.eq(0) ? lleno.recibido : v.mult ? lleno.recibido.times(ONE.minus(sEff)) : lleno.recibido.div(ONE.plus(sEff));
    impactoPct = (v.mult ? ONE.minus(P.div(mejorPrecio)) : P.div(mejorPrecio).minus(ONE)).times(HUNDRED);
    libroExcedido = false;
  } else {
    P = precioOverride ?? v.P;
    precioEfectivo = v.mult ? P.times(ONE.minus(sEff)) : P.times(ONE.plus(sEff));
    brutoSinSlippage = v.mult ? O.times(P) : O.div(P);
    bruto = v.mult ? O.times(precioEfectivo) : O.div(precioEfectivo);
  }
  const costoSlippage = brutoSinSlippage.minus(bruto);

  // 3) Destino: % sobre lo recibido bruto, % sobre lo recibido neto de esos, % sobre otro concepto y fijos.
  const destino = v.costos.filter((c) => c.lado === 'destino');
  const montoD = new Map();
  let fijosDestino = ZERO;
  let comisionDestino = ZERO;
  let impuestoDestino = ZERO;
  let sobreBruto = ZERO;
  const orden = [...destino.filter((c) => c.clase === 'fijo' || c.base === 'bruto'), ...destino.filter((c) => c.clase === 'pct' && c.base === 'neto'), ...destino.filter((c) => c.clase === 'pct' && c.base === 'concepto')];
  for (const c of orden) {
    let m;
    if (fijo(c)) m = c.valor;
    else {
      const baseMonto = c.base === 'bruto' ? bruto : c.base === 'neto' ? bruto.minus(sobreBruto) : (montoD.get(c.sobre) ?? ZERO);
      m = baseMonto.times(pct(c.valor));
      if (c.minimo !== null && m.lt(c.minimo)) { m = c.minimo; alMinimo.add(c.id); }
      if (c.base === 'bruto') sobreBruto = sobreBruto.plus(m);
    }
    montoD.set(c.id, m);
    if (fijo(c)) fijosDestino = fijosDestino.plus(m);
    else if (c.fiscal === 'no_fiscal') comisionDestino = comisionDestino.plus(m);
    else impuestoDestino = impuestoDestino.plus(m);
    detalle.push(costoDetalle(c, m, v.hacia, alMinimo.has(c.id)));
  }
  const recibidoSinRedondeo = bruto.minus(comisionDestino).minus(impuestoDestino).minus(fijosDestino);
  if (recibidoSinRedondeo.lte(0)) return { error: `Paso ${n}: los costos se comen todo lo que recibís en ${nom(v.hacia)}.`, code: 'paso_sin_saldo' };
  let recibido = recibidoSinRedondeo;
  if (v.redondeo !== 'ninguno') {
    const dp = ctx.decimales[v.hacia] ?? 2;
    recibido = recibidoSinRedondeo.round(dp, v.redondeo === 'abajo' ? 0 : 1);
    if (recibido.lte(0)) return { error: `Paso ${n}: con el redondeo de la plataforma no recibís nada en ${nom(v.hacia)}.`, code: 'paso_sin_saldo' };
  }
  const ajusteRedondeo = recibidoSinRedondeo.minus(recibido);

  // 4) Límites y liquidez: se informan como violaciones (el cálculo sigue, pero no se puede confirmar la ruta).
  const violaciones = [];
  if (v.minimo !== null && O.lt(v.minimo)) violaciones.push({ tipo: 'bajo_minimo', texto: `Paso ${n}: lo operado está por debajo del mínimo de la plataforma.` });
  if (v.maximo !== null && O.gt(v.maximo)) violaciones.push({ tipo: 'sobre_maximo', texto: `Paso ${n}: lo operado supera el máximo de la plataforma.` });
  if (v.liquidez !== null && bruto.gt(v.liquidez)) violaciones.push({ tipo: 'liquidez_insuficiente', texto: `Paso ${n}: la liquidez informada (${plain(v.liquidez)} ${nom(v.hacia)}) no alcanza para este monto.` });

  return {
    desde: v.desde, hacia: v.hacia, tipo: v.tipo, base: v.base, modoPct: v.modoLegacy,
    entregado: E, fijosOrigen, operado: O, comisionOrigen, impuestoOrigen, aparte,
    precio: P, precioEfectivo, mejorPrecio, impactoPct, libroExcedido, brutoSinSlippage, costoSlippage, bruto,
    comisionDestino, impuestoDestino, fijosDestino, recibidoSinRedondeo, ajusteRedondeo, recibido,
    costos: detalle, liquidez: v.liquidez, minimo: v.minimo, maximo: v.maximo,
    tiempoHoras: v.tiempoHoras, tiempoDiasHabiles: v.tiempoDiasHabiles, violaciones,
  };
}

/** Coeficiente de un costo de origen sobre lo operado (o su monto fijo). */
function coefOrigen(c, v, E, alMinimo) {
  if (c.clase === 'fijo') return { fijo: c.valor };
  if (alMinimo.has(c.id)) return { fijo: c.minimo };
  if (c.base === 'bruto') return { fijo: E.times(pct(c.valor)) };
  if (c.base === 'neto') return { fijo: null, coef: pct(c.valor) };
  const ref = v.costos.find((x) => x.id === c.sobre);
  const k = coefOrigen(ref, v, E, alMinimo);
  return k.fijo !== null ? { fijo: k.fijo.times(pct(c.valor)) } : { fijo: null, coef: k.coef.times(pct(c.valor)) };
}

function montoOrigen(c, v, E, O, alMinimo, cache) {
  if (cache.has(c.id)) return cache.get(c.id);
  let m;
  if (c.clase === 'fijo') m = c.valor;
  else if (alMinimo.has(c.id)) m = c.minimo;
  else if (c.base === 'bruto') m = E.times(pct(c.valor));
  else if (c.base === 'neto') m = O.times(pct(c.valor));
  else m = montoOrigen(v.costos.find((x) => x.id === c.sobre), v, E, O, alMinimo, cache).times(pct(c.valor));
  return m;
}

function costoDetalle(c, monto, activo, minimo) {
  return { id: c.id, concepto: c.concepto, clase: c.clase, lado: c.lado, base: c.base, sobre: c.sobre, valor: c.valor, estado: c.estado, fiscal: c.fiscal, hipotesis: c.hipotesis, activo, monto, alMinimo: minimo };
}

/**
 * Llena el libro de órdenes con lo operado. Niveles ya ordenados del mejor al peor.
 * mult (destino por 1 origen): cantidad en origen. div (origen por 1 destino): cantidad en destino.
 */
export function llenarLibro(niveles, operado, mult, escala = ONE) {
  let resto = operado;
  let recibido = ZERO;
  let capacidad = ZERO;
  for (const n of niveles) {
    const precio = n.precio.times(escala);
    // Capacidad del nivel medida en el activo de origen
    const cap = mult ? n.cantidad : n.cantidad.times(precio);
    capacidad = capacidad.plus(cap);
    if (resto.lte(0)) continue;
    const usa = resto.lt(cap) ? resto : cap;
    recibido = recibido.plus(mult ? usa.times(precio) : usa.div(precio));
    resto = resto.minus(usa);
  }
  if (resto.gt(0)) return { ok: false, capacidad };
  // Un monto tan chico que no alcanza para recibir nada (redondeo a 40 decimales): no hay precio que informar.
  if (recibido.lte(0)) return { ok: true, recibido, promedio: null, capacidad };
  return { ok: true, recibido, promedio: mult ? recibido.div(operado) : operado.div(recibido), capacidad };
}

/* ---------- Precios objetivo (equilibrio y ganancias de 1 %, 2 %, 5 %) ---------- */

/**
 * Precio del último paso con el que la ruta llega a cada objetivo (sobre el capital desembolsado).
 * Considera todos los costos (fijos, %, mínimos, redondeo de ejecución, libro). Exacto cuando el resultado
 * es lineal en el precio; si no (mínimos, redondeo o libro), por bisección con decimales exactos.
 */
function preciosObjetivo(v, r, ctx, capital, lista = OBJETIVOS_PCT) {
  if (v.tipo === 'transferencia') return lista.map((g) => ({ objetivoPct: g, precio: null, motivo: 'transferencia' }));
  const actual = v.libro ? r.precio : v.P;
  const ref = v.libro ? r.mejorPrecio : v.P;
  const final = (P) => {
    const x = calcularPaso(v, r.entregado, ctx, P);
    return x.error ? null : x.recibido;
  };
  // Los dos puntos de la recta (precio actual y el doble) sirven para los cuatro objetivos.
  // El segundo punto va en la dirección en que se recibe más (así no choca con costos fijos que se comen todo).
  // Sin libro, el resultado al precio actual ya está calculado (r.recibido): no se repite.
  const puntos = { P1: ref, y1: v.libro ? final(ref) : r.recibido, P2: v.mult ? ref.times(2) : ref.div(2) };
  puntos.y2 = final(puntos.P2);
  const invActual = ONE.div(actual);
  return lista.map((g) => {
    const objetivo = capital.times(ONE.plus(pct(g)));
    const P = resolverPrecio(final, objetivo, ref, v.mult, puntos);
    if (!P) return { objetivoPct: g, precio: null, motivo: 'sin_solucion' };
    // Con libro, el precio a mostrar es el promedio ponderado al que se llega.
    const mostrado = v.libro ? calcularPaso(v, r.entregado, ctx, P).precio : P;
    const relacion = mostrado.times(invActual);
    return {
      objetivoPct: g, precio: mostrado, base: v.base, paso: v.indice,
      diferencia: actual.minus(mostrado),
      margenSeguridadPct: (v.mult ? ONE.minus(relacion) : relacion.minus(ONE)).times(HUNDRED),
      // compatibilidad: margen "hasta el equilibrio" medido como antes (precio actual / objetivo − 1)
      margenPct: g === '0' ? (v.mult ? actual.div(mostrado) : relacion).minus(ONE).times(HUNDRED) : null,
    };
  });
}

/**
 * Precio que lleva f(P) a `objetivo`. f crece con P si mult, si no decrece. null si no hay precio posible.
 * Primero prueba la solución lineal exacta (dos puntos); si no verifica, bisección (120 iteraciones).
 */
/** Contadores del resolvedor de precios (para las pruebas de rendimiento: la bisección tiene que ser rara). */
export const diagnostico = { biseccion: 0, empujes: 0 };

export function resolverPrecio(f, objetivo, P0, mult, puntos = null) {
  const alcanza = (P) => {
    const y = f(P);
    return y !== null && y.gte(objetivo);
  };
  const okDir = alcanza; // "llega al objetivo"
  // Intento lineal: con mult, f es lineal en P; con div, en 1/P.
  const x = (P) => (mult ? P : ONE.div(P));
  const P1 = puntos?.P1 ?? P0;
  const P2 = puntos?.P2 ?? (mult ? P0.times(2) : P0.div(2));
  const y1 = puntos ? puntos.y1 : f(P1);
  const y2 = puntos ? puntos.y2 : f(P2);
  if (y1 !== null && y2 !== null && !y1.eq(y2)) {
    const x1 = x(P1);
    const x2 = x(P2);
    const xs = x1.plus(objetivo.minus(y1).times(x2.minus(x1)).div(y2.minus(y1)));
    if (xs.gt(0)) {
      let Ps = mult ? xs : ONE.div(xs);
      let ys = f(Ps);
      const tol = objetivo.abs().plus(ONE).times('1e-24');
      if (ys !== null && ys.minus(objetivo).abs().lte(tol)) {
        // La solución exacta puede quedar una fracción por debajo por el redondeo a 40 decimales:
        // se corre lo mínimo necesario para que llegue (nunca se informa un precio que no alcanza).
        for (let k = 0; k <= 15 && !(ys !== null && ys.gte(objetivo)); k++) {
          diagnostico.empujes++;
          const eps = Dec(`1e-${35 - k}`);
          Ps = mult ? Ps.times(ONE.plus(eps)) : Ps.times(ONE.minus(eps));
          ys = f(Ps);
        }
        if (ys !== null && ys.gte(objetivo)) return Ps;
      }
    }
  }
  diagnostico.biseccion++;
  // Bisección: buscar un precio que llegue y otro que no.
  let lo = P0;
  let hi = P0;
  // "bueno" = llega al objetivo. Con mult, subir el precio ayuda; con div, bajarlo.
  const mejorar = (P) => (mult ? P.times(2) : P.div(2));
  const empeorar = (P) => (mult ? P.div(2) : P.times(2));
  let bueno = null;
  let malo = null;
  if (okDir(P0)) {
    bueno = P0;
    let P = P0;
    for (let k = 0; k < 200; k++) { P = empeorar(P); if (!okDir(P)) { malo = P; break; } bueno = P; }
    if (!malo) return null;
  } else {
    malo = P0;
    let P = P0;
    for (let k = 0; k < 200; k++) { P = mejorar(P); if (okDir(P)) { bueno = P; break; } malo = P; }
    if (!bueno) return null;
  }
  lo = malo; hi = bueno;
  for (let k = 0; k < 120; k++) {
    const mid = lo.plus(hi).div(2);
    if (okDir(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/* ---------- Fiscal: caja y económico ---------- */
function resumenFiscal(res, inicial) {
  let recuperables = ZERO;
  let pendientes = ZERO;
  const noValuables = [];
  const detalle = [];
  for (const r of res) {
    for (const c of r.costos) {
      if (c.fiscal === 'no_fiscal' || c.fiscal === 'costo' || c.monto.eq(0)) continue;
      const item = { paso: r.indice, concepto: c.concepto, fiscal: c.fiscal, activo: c.activo, monto: c.monto };
      detalle.push(item);
      if (c.activo !== inicial) { noValuables.push(item); continue; }
      if (esRecuperable(c.fiscal)) recuperables = recuperables.plus(c.monto);
      else if (c.fiscal === 'pendiente') pendientes = pendientes.plus(c.monto);
    }
  }
  return { recuperables, pendientes, noValuables, detalle };
}

function sumarTiempos(res) {
  let horas = ZERO;
  let diasHabiles = ZERO;
  let completo = true;
  for (const r of res) {
    if (r.tiempoHoras === null && r.tiempoDiasHabiles === null) { completo = false; continue; }
    if (r.tiempoHoras !== null) horas = horas.plus(r.tiempoHoras);
    if (r.tiempoDiasHabiles !== null) diasHabiles = diasHabiles.plus(r.tiempoDiasHabiles);
  }
  return { horas: completo ? horas : null, diasHabiles: completo ? diasHabiles : null, completo };
}

/** Nombre de un activo para un mensaje, aunque venga cualquier cosa (nunca tira). */
function nombreActivo(x) {
  return typeof x === 'string' ? x.slice(0, 40) : '(dato inválido)';
}

/* ---------- Validación ---------- */

/** Costos en el formato anterior (comisión %, impuestos %, comisión fija, transferencia) → lista. */
export function costosDesdeFormatoAnterior(p) {
  const modo = p.modoPct ?? 'descontado';
  const lado = modo === 'encima' ? 'origen' : 'destino';
  const base = modo === 'encima' ? 'neto' : 'bruto';
  const unidad = (u) => (u === 'destino' ? 'destino' : u === 'aparte' ? 'aparte' : 'origen');
  return [
    { id: 'comision', concepto: 'Comisión', clase: 'pct', valor: p.comisionPct, lado, base, fiscal: 'no_fiscal' },
    { id: 'impuestos', concepto: 'Impuestos', clase: 'pct', valor: p.impuestoPct, lado, base, fiscal: p.impuestoFiscal ?? 'pendiente' },
    { id: 'comision_fija', concepto: 'Comisión fija', clase: 'fijo', valor: p.comisionFija?.monto, lado: unidad(p.comisionFija?.unidad) },
    { id: 'transferencia', concepto: 'Costo de transferencia', clase: 'fijo', valor: p.costoTransferencia?.monto, lado: unidad(p.costoTransferencia?.unidad) },
  ];
}

function validarPaso(p, i, esperado, inicial, errors, activosValidos, estres, redondeoRuta, nom) {
  const n = i + 1;
  const pre = `pasos.${i}`;
  const ctx = { errors, values: {}, estados: {} };
  const err = (campo, code, message) => errors.push({ field: `${pre}.${campo}`, paso: i, code, message: `Paso ${n}: ${message}` });
  const num = (campo, label, raw, rule) => {
    const antes = errors.length;
    checkField(ctx, `${pre}.${campo}`, `Paso ${n} · ${label}`, raw, rule);
    for (let k = antes; k < errors.length; k++) errors[k].paso = i;
    return ctx.values[`${pre}.${campo}`];
  };
  const costo = (campo, label, raw, rule) => {
    const antes = errors.length;
    const r = checkCosto(ctx, `${pre}.${campo}`, `Paso ${n} · ${label}`, raw, rule);
    for (let k = antes; k < errors.length; k++) errors[k].paso = i;
    return r;
  };

  const tipo = p.tipo ?? 'cambio';
  if (!TIPOS_PASO.includes(tipo)) err('tipo', 'invalido', 'tipo de paso inválido.');
  const desde = p.desde ?? esperado;
  if (p.desde && esperado && p.desde !== esperado) err('desde', 'cadena_rota', `sale de ${nom(p.desde)}, pero el paso anterior entrega ${nom(esperado)}.`);
  const hacia = tipo === 'transferencia' ? (p.hacia ?? desde) : p.hacia;
  if (!hacia) err('hacia', 'requerido', 'falta el activo de destino.');
  else if (typeof hacia !== 'string' || (activosValidos && !activosValidos.includes(hacia))) err('hacia', 'invalido', `activo desconocido: ${nombreActivo(hacia)}.`);
  else if (tipo === 'cambio' && hacia === desde) err('hacia', 'mismo_activo', 'el origen y el destino son el mismo activo (si movés el activo entre plataformas o redes, elegí el tipo "Transferencia").');
  else if (tipo === 'transferencia' && hacia !== desde) err('hacia', 'transferencia_otro_activo', 'una transferencia mueve el mismo activo; para cambiarlo, usá un paso de cambio.');

  const base = p.base ?? 'destino_por_origen';
  if (!BASES.includes(base)) err('base', 'invalido', 'forma de la cotización inválida.');
  const modoLegacy = p.modoPct ?? null;
  if (modoLegacy !== null && !MODOS_PCT.includes(modoLegacy)) err('modoPct', 'invalido', 'forma de cobro de los porcentajes inválida.');
  const cotizacionTipo = p.cotizacionTipo ?? 'ejecucion';
  if (!TIPOS_COTIZACION.includes(cotizacionTipo)) err('cotizacionTipo', 'invalido', 'tipo de cotización inválido.');
  const redondeo = p.redondeo ?? redondeoRuta;
  if (!REDONDEOS.includes(redondeo)) err('redondeo', 'invalido', 'redondeo de ejecución inválido.');

  // Libro de órdenes
  let libro = null;
  if (tipo === 'cambio' && Array.isArray(p.libro) && p.libro.length) {
    if (p.libro.length > MAX_NIVELES_LIBRO) err('libro', 'demasiados_niveles', `el libro admite hasta ${MAX_NIVELES_LIBRO} niveles.`);
    const niveles = [];
    p.libro.slice(0, MAX_NIVELES_LIBRO).forEach((nv, j) => {
      const precio = num(`libro.${j}.precio`, `Libro, nivel ${j + 1}: precio`, nv?.precio, { required: true, min: 0, minExclusive: true });
      const cantidad = num(`libro.${j}.cantidad`, `Libro, nivel ${j + 1}: cantidad`, nv?.cantidad, { required: true, min: 0, minExclusive: true });
      if (precio && cantidad) niveles.push({ precio, cantidad });
    });
    // Del mejor al peor: vendiendo (multiplica) el precio más alto; comprando (divide) el más bajo.
    niveles.sort((a, b) => (base === 'destino_por_origen' ? b.precio.cmp(a.precio) : a.precio.cmp(b.precio)));
    if (niveles.length) libro = niveles;
  }

  // Cotización: obligatoria en un cambio sin libro. Nunca se supone 1.
  let P = ONE;
  const hipotesis = [];
  const desconocidos = [];
  if (tipo === 'cambio' && !libro) {
    const vacio = p.cotizacion === null || p.cotizacion === undefined || (typeof p.cotizacion === 'string' && p.cotizacion.trim() === '');
    if (vacio) {
      err('cotizacion', 'requerido', `falta la cotización ${nom(desde)} → ${nom(hacia)}. Cargá el precio de tu plataforma (o marcalo como hipótesis si es un supuesto).`);
    } else P = num('cotizacion', 'Cotización', p.cotizacion, { required: true, min: 0, minExclusive: true });
    if (p.cotizacionHipotesis === true) hipotesis.push({ campo: 'cotizacion', etiqueta: 'la cotización es una hipótesis' });
  }

  // Slippage y spread
  let s = ZERO;
  let spread = ZERO;
  if (tipo === 'cambio' && !libro) {
    const rs = costo('slippagePct', 'Slippage', p.slippagePct, { min: 0, max: 100, maxExclusive: true });
    s = rs.valor;
    if (rs.estado === 'desconocido') desconocidos.push({ campo: 'slippagePct', etiqueta: 'slippage (cuánto peor que la cotización termina tu precio)' });
    if (cotizacionTipo === 'medio') {
      const rp = costo('spreadPct', 'Spread', p.spreadPct, { min: 0, max: 100, maxExclusive: true });
      spread = rp.valor;
      if (rp.estado === 'desconocido') desconocidos.push({ campo: 'spreadPct', etiqueta: 'spread (la cotización es un precio medio)' });
    }
  }
  if (s.plus(spread).plus(estres).gte(HUNDRED)) err('slippagePct', 'slippage_excesivo', 'spread + slippage + estrés tienen que sumar menos de 100 %.');

  // Costos
  const crudos = Array.isArray(p.costos) ? p.costos : costosDesdeFormatoAnterior(p);
  if (crudos.length > MAX_COSTOS) err('costos', 'demasiados_costos', `un paso admite hasta ${MAX_COSTOS} costos.`);
  const costos = [];
  const ids = new Set();
  crudos.slice(0, MAX_COSTOS).forEach((c, j) => {
    c = c && typeof c === 'object' ? c : {};
    const id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : `c${j}`;
    if (ids.has(id)) { err(`costos.${j}`, 'id_repetido', 'hay dos costos con el mismo identificador.'); return; }
    ids.add(id);
    const concepto = typeof c.concepto === 'string' && c.concepto.trim() ? c.concepto.trim().slice(0, 60) : `Costo ${j + 1}`;
    const clase = c.clase ?? 'pct';
    const lado = c.lado ?? (clase === 'fijo' ? 'origen' : 'destino');
    const fiscal = c.fiscal ?? 'no_fiscal';
    if (!CLASES.includes(clase)) { err(`costos.${j}`, 'invalido', `${concepto}: tipo de costo inválido.`); return; }
    if (!LADOS.includes(lado)) { err(`costos.${j}`, 'invalido', `${concepto}: forma de cobro inválida.`); return; }
    if (!Object.hasOwn(TRATAMIENTOS, fiscal)) { err(`costos.${j}`, 'invalido', `${concepto}: tratamiento fiscal inválido.`); return; }
    const baseC = clase === 'pct' ? (c.base ?? (lado === 'destino' ? 'bruto' : 'neto')) : null;
    if (clase === 'pct' && !BASES_PCT.includes(baseC)) { err(`costos.${j}`, 'invalido', `${concepto}: base de cálculo inválida.`); return; }
    if (lado === 'aparte' && clase === 'pct' && desde !== inicial) {
      err(`costos.${j}`, 'aparte_otro_activo', `${concepto}: un porcentaje pagado aparte tiene que calcularse sobre ${nom(inicial)} (el activo inicial); en este paso entregás ${nom(desde)}.`);
      return;
    }
    if (tipo === 'transferencia' && clase === 'pct' && lado === 'aparte') { err(`costos.${j}`, 'invalido', `${concepto}: en una transferencia no hay % aparte.`); return; }
    const esPct = clase === 'pct';
    // Lo que se descuenta de lo que recibís no puede ser el 100 % o más (no quedaría nada). Encima de lo operado
    // o como impuesto, un % puede superar el 100 % de su base (la suma se controla aparte).
    const rule = esPct && fiscal === 'no_fiscal' && lado === 'destino' ? { min: 0, max: 100, maxExclusive: true } : { min: 0 };
    const r = costo(`costos.${j}`, concepto, c.valor, rule);
    let minimo = null;
    if (esPct && c.minimo !== null && c.minimo !== undefined && c.minimo !== '') minimo = num(`costos.${j}.minimo`, `${concepto} · mínimo`, c.minimo, { min: 0 }) ?? null;
    if (r.estado === 'desconocido') desconocidos.push({ campo: `costos.${j}`, id, etiqueta: concepto.toLowerCase() === concepto ? concepto : concepto.charAt(0).toLowerCase() + concepto.slice(1) });
    const hip = c.hipotesis === true;
    if (hip) hipotesis.push({ campo: `costos.${j}`, etiqueta: `${concepto}: es una hipótesis` });
    costos.push({ id, concepto, clase, lado, base: baseC, sobre: typeof c.sobre === 'string' ? c.sobre : null, valor: r.valor, estado: r.estado, minimo, fiscal, hipotesis: hip });
  });
  // Referencias "sobre otro concepto": mismo lado, a un costo que no sea a su vez "sobre otro concepto".
  const ladoGrupo = (l) => (l === 'destino' ? 'destino' : 'origen');
  for (const c of costos) {
    if (c.base !== 'concepto') continue;
    const ref = costos.find((x) => x.id === c.sobre);
    if (!ref) err('costos', 'sin_referencia', `${c.concepto}: elegí sobre qué costo se calcula.`);
    else if (ref.base === 'concepto') err('costos', 'referencia_doble', `${c.concepto}: no puede calcularse sobre otro costo que a su vez es un porcentaje de otro.`);
    else if (ladoGrupo(ref.lado) !== ladoGrupo(c.lado)) err('costos', 'referencia_otro_lado', `${c.concepto}: tiene que cobrarse del mismo lado que ${ref.concepto}.`);
  }
  // Sumas de porcentajes que dejarían el paso sin saldo (si un costo ya tiene error, ese error alcanza)
  const suma = (f) => costos.filter((c) => c.clase === 'pct' && f(c)).reduce((a, c) => a.plus(c.valor), ZERO);
  const conErrorDeCosto = errors.some((e) => e.paso === i && /\.costos\.\d+/.test(e.field));
  if (!conErrorDeCosto) {
    if (suma((c) => c.lado === 'destino' && c.base === 'bruto').gte(HUNDRED)) err('costos', 'porcentajes_excesivos', 'los % que se descuentan de lo que recibís tienen que sumar menos de 100 %.');
    if (suma((c) => c.lado === 'destino' && c.base === 'neto').gte(HUNDRED)) err('costos', 'porcentajes_excesivos', 'los % sobre lo recibido neto tienen que sumar menos de 100 %.');
    if (suma((c) => c.lado === 'origen' && c.base === 'bruto').gte(HUNDRED)) err('costos', 'porcentajes_excesivos', 'los % sobre todo lo que entregás tienen que sumar menos de 100 %.');
  }

  const minimo = num('minimo', 'Mínimo', p.minimo, { min: 0 });
  const maximo = num('maximo', 'Máximo', p.maximo, { min: 0, minExclusive: true });
  const liquidez = num('liquidez', 'Liquidez disponible', p.liquidez, { min: 0 });
  const tIn = p.tiempo ?? {};
  const tiempo = num('tiempo', 'Tiempo estimado', tIn.valor, { min: 0 });
  const tUnidad = tIn.unidad ?? 'h';
  if (!UNIDADES_TIEMPO.includes(tUnidad)) err('tiempo', 'invalido', 'unidad de tiempo inválida.');
  if (minimo && maximo && minimo.gt(maximo)) err('minimo', 'min_mayor_que_max', 'el mínimo es mayor que el máximo.');

  let tiempoHoras = null;
  let tiempoDiasHabiles = null;
  if (tiempo !== null && tiempo !== undefined) {
    if (tUnidad === 'dh') { tiempoDiasHabiles = tiempo; tiempoHoras = ZERO; } else {
      tiempoHoras = tUnidad === 'min' ? tiempo.div(60) : tUnidad === 'd' ? tiempo.times(24) : tiempo;
      tiempoDiasHabiles = ZERO;
    }
  }
  return {
    indice: i, desde, hacia, tipo, base, mult: base === 'destino_por_origen', modoLegacy, P: P ?? ONE, s, spread, costos, libro, redondeo,
    minimo: minimo ?? null, maximo: maximo ?? null, liquidez: liquidez ?? null, tiempoHoras, tiempoDiasHabiles, desconocidos, hipotesis,
  };
}

/**
 * Estado de la ruta según lo que confirmaste.
 * - incompleta: no se puede calcular.
 * - teorica: se puede calcular, pero no confirmaste nada.
 * - condicionada: hay confirmaciones pendientes o vencidas, costos que no conocés, o límites/liquidez que no se cumplen.
 * - verificada ("confirmada por vos"): cada paso tiene plataforma, cotización confirmada (vigente, sin cambios, en esa
 *   plataforma y para un importe igual o mayor), liquidez confirmada para el monto, todos los costos conocidos, ninguna
 *   hipótesis, todas sus condiciones confirmadas y ningún límite violado.
 * Confirmada NO es garantía de ejecución ni certificación legal. Liquidez escrita ≠ liquidez confirmada.
 *
 * @param {ReturnType<typeof simularRuta>} sim
 * @param {{pasos?: Array<{plataforma?: string,
 *   confirmacionCotizacion?: {valor: string, at: string, fuente?: string, plataforma?: string, importe?: string}|null,
 *   liquidezConfirmada?: {hasta: string, at: string, fuente?: string, plataforma?: string}|null,
 *   condiciones?: Array<{texto: string, confirmada: boolean, confirmadaAt: string|null}>}>}} meta
 */
export function evaluarRuta(sim, meta = {}, { ahora = new Date(), vigenciaCotizacionHoras = 24, vigenciaCondicionDias = 30 } = {}) {
  if (!sim?.ok) return { estado: 'incompleta', pendientes: [], violaciones: [], confirmaciones: 0 };
  const pendientes = [];
  const violaciones = [];
  let confirmaciones = 0;
  const t0 = ahora.getTime();
  const vigente = (iso, horas) => {
    const t = Date.parse(iso ?? '');
    if (Number.isNaN(t)) return false;
    return t0 - t <= horas * 3600e3 && t - t0 <= 5 * 60e3;
  };
  const mismaPlataforma = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const desconocidosPorPaso = new Map();
  for (const d of sim.calidad?.desconocidos ?? []) desconocidosPorPaso.set(d.paso, [...(desconocidosPorPaso.get(d.paso) ?? []), d.etiqueta]);
  const hipotesisPorPaso = new Set((sim.calidad?.hipotesis ?? []).map((h) => h.paso));

  sim.result.pasos.forEach((r, i) => {
    const m = meta.pasos?.[i] ?? {};
    const n = i + 1;
    for (const v of r.violaciones) violaciones.push({ paso: i, ...v });
    const plataforma = String(m.plataforma ?? '').trim();
    if (!plataforma) pendientes.push({ paso: i, tipo: 'plataforma', texto: `Paso ${n}: indicar la plataforma.` });
    if (desconocidosPorPaso.has(i)) pendientes.push({ paso: i, tipo: 'costos_desconocidos', texto: `Paso ${n}: faltan costos que no conocés (${desconocidosPorPaso.get(i).join(', ')}).` });
    if (hipotesisPorPaso.has(i)) pendientes.push({ paso: i, tipo: 'hipotesis', texto: `Paso ${n}: hay datos cargados como hipótesis; una hipótesis no se puede confirmar.` });

    if (r.tipo !== 'transferencia') {
      const c = m.confirmacionCotizacion;
      const motivo = !c ? 'sin'
        : c.valor !== plain(r.precio) ? 'valor'
          : c.plataforma !== undefined && c.plataforma !== null && !mismaPlataforma(c.plataforma, plataforma) ? 'plataforma'
            : c.importe && toDec(c.importe).lt(r.operado) ? 'importe'
              : !vigente(c.at, vigenciaCotizacionHoras) ? 'vencida' : null;
      if (motivo === null) confirmaciones++;
      else {
        const textos = {
          sin: `Paso ${n}: confirmar la cotización en la plataforma.`,
          valor: `Paso ${n}: la cotización cambió después de confirmarla; volvé a confirmarla.`,
          plataforma: `Paso ${n}: la cotización se confirmó en otra plataforma (${c?.plataforma}); volvé a confirmarla.`,
          importe: `Paso ${n}: la cotización se confirmó para un importe menor que el que operás ahora; volvé a confirmarla.`,
          vencida: `Paso ${n}: la cotización se confirmó hace más de ${vigenciaCotizacionHoras} h; volvé a confirmarla.`,
        };
        pendientes.push({ paso: i, tipo: motivo === 'vencida' ? 'cotizacion_vencida' : 'cotizacion', texto: textos[motivo] });
      }

      const lq = m.liquidezConfirmada;
      const lqOk = lq && vigente(lq.at, vigenciaCotizacionHoras) && toDec(lq.hasta).gte(r.bruto)
        && (lq.plataforma === undefined || lq.plataforma === null || mismaPlataforma(lq.plataforma, plataforma));
      if (lqOk) confirmaciones++;
      else {
        const texto = lq && !toDec(lq.hasta).gte(r.bruto) ? `Paso ${n}: la liquidez se confirmó para un monto menor; volvé a confirmarla.`
          : `Paso ${n}: confirmar en la plataforma que hay liquidez para este monto${r.liquidez !== null ? ' (la liquidez que escribiste es un dato, no una confirmación)' : ''}.`;
        pendientes.push({ paso: i, tipo: 'liquidez', texto });
      }
    }

    for (const cond of m.condiciones ?? []) {
      const texto = String(cond.texto ?? '').trim() || 'condición sin descripción';
      if (cond.confirmada && vigente(cond.confirmadaAt, vigenciaCondicionDias * 24)) confirmaciones++;
      else if (cond.confirmada) pendientes.push({ paso: i, tipo: 'condicion_vencida', texto: `Paso ${n}: «${texto}» se confirmó hace más de ${vigenciaCondicionDias} días.` });
      else pendientes.push({ paso: i, tipo: 'condicion', texto: `Paso ${n}: ${texto}` });
    }
  });

  let estado;
  if (!pendientes.length && !violaciones.length) estado = 'verificada';
  else if (confirmaciones === 0 && !violaciones.length) estado = 'teorica';
  else estado = 'condicionada';
  return { estado, pendientes, violaciones, confirmaciones };
}

export { Dec };
