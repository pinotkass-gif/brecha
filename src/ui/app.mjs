// Interfaz de Brecha. Toda la matemática vive en src/engine; acá sólo se lee, se muestra y se guarda.
import { calcularSimple, precioCompraFinal, COBROS_FIJOS } from '../engine/simple.mjs';
import { parseNumberAR, formatARS, formatARSSigned, formatPct, formatQuote, formatUnits, formatNumberAR } from '../engine/format.mjs';
import { toDec, plain } from '../engine/decimal.mjs';
import { NO_APLICA, esNoAplica } from '../engine/costos.mjs';
import { estadoCostoTexto, opcionesFiscal, bloqueCalidad, bloqueEconomico, bloqueExplicacion, tablaObjetivos, prefijoResultado, tono, tituloResultado } from './comun.mjs';
import { explicarSimple } from '../engine/explicacion.mjs';
import { relacionDesdePct, pctDesdeRelacion, SENTIDOS_CONVERSION, UNIDAD_SENTIDO } from '../engine/conversion.mjs';
import { MERCADOS, IDS_MERCADOS, mercadoPorId } from '../quotes/markets.mjs';
import { proveedorPorDefecto } from '../quotes/providers/index.mjs';
import { consultarConReintentos, puedeConsultar, POLITICA_CONSULTA } from '../quotes/cliente.mjs';
import { clasificar, restaurarPolitica, POLITICA_FRESCURA_DEFECTO, HORAS_MAXIMAS } from '../quotes/frescura.mjs';
import { textoProblema } from '../quotes/calidad.mjs';
import { KEY_CALLE, restaurarCalle, leerCalle, avisoCalle } from '../quotes/calle.mjs';
import { estadoInicial, aplicarRespuesta, editarManual, editarFuenteManual, volverAAPI, manuales, restaurar } from '../quotes/store.mjs';
import { crearSimuladorRutas } from './rutas.mjs';
import { crearOportunidades } from './oportunidades.mjs';
import { crearHistorial } from './historial.mjs';
import { crearAnalisis } from './analisis.mjs';
import { crearBonos } from './bonos.mjs';
import { crearPlataformas } from './plataformas.mjs';
import { crearCapturas } from './capturas.mjs';
import { crearChat } from './chat.mjs';
import { crearExchanges } from './exchanges.mjs';
import { crearOpcionesUsdt } from './opciones-usdt.mjs';
import { crearBancos } from './bancos.mjs';
import { crearInicio } from './inicio.mjs';
import { conversionComprando, conversionVendiendo, prepararPrecios, opcionesLado } from '../exchanges/arbitraje.mjs';
import { resumenDeSimple, resumenDeRuta, trazaDeSimple } from '../historial/modelo.mjs';
import { simularRuta } from '../engine/route.mjs';
import { rutaDesdeSimple } from '../routes/desde-simple.mjs';
import { IDS_ACTIVOS } from '../routes/activos.mjs';
import { DECIMALES, NOMBRES, restaurarBorrador, normalizar } from '../routes/borrador.mjs';
import { controlarCoherencia, restaurarContraste } from '../quotes/coherencia.mjs';
import { restaurarCalendario, feriadosDelAnio, fechaAR, HORARIOS_DEFECTO } from '../quotes/calendario.mjs';

const KEY_COT = 'brecha.cotizaciones.v1';
const KEY_FORM = 'brecha.formulario.v3';
const KEY_FORM_V1 = 'brecha.formulario.v1';
const KEY_MODO = 'brecha.modo.v1';
const KEY_POLITICA = 'brecha.politica.v1';
let rutas = null;
let oportunidades = null;
let historial = null;
let exchanges = null;
let opcionesUsdt = null;
let bancos = null;
let inicio = null;
const KEY_TEMA = 'brecha.tema.v1';
const KEY_NIVEL = 'brecha.nivel.v1';
/** Niveles de uso: cada uno muestra más herramientas. Nada se borra: lo oculto se ve subiendo de nivel. */
const NIVELES_USO = ['rapido', 'avanzado', 'profesional'];
const NIVEL_UI = {
  rapido: { t: 'Rápido', d: 'Una operación sencilla: monto, mercados y precios. Los costos que no cargues cuentan como «No sé».' },
  avanzado: { t: 'Avanzado', d: 'Suma comisiones, impuestos, conversiones, transferencias, la matriz de mercados y el detalle del cálculo.' },
  profesional: { t: 'Profesional', d: 'Todo: rutas por pasos, liquidez, escenarios, sensibilidad, estrés, confirmaciones, bonos, perfiles y capturas.' },
};
const rangoNivel = (n) => NIVELES_USO.indexOf(n);
/** Versión: 'celular' (pestañas abajo, compacta) o 'web' (compu). La define index.html (scripts/variantes.mjs). */
const PLATAFORMA = document.documentElement.dataset.plataforma === 'celular' ? 'celular' : 'web';
const KEY_SECCION = 'brecha.seccion.v1';
const SECCIONES = ['sec-inicio', 'sec-simulacion', 'sec-cotizaciones', 'sec-preguntar', 'oportunidades', 'historial'];
/** Calculadora con lo justo para la operativa del propietario (pesos → billete → USDT → pesos; 12/11/2026) o completa. */
const KEY_OPERATIVA = 'brecha.operativa.v1';
let operativa = 'completa'; // se decide en init
/** Compu: por pestañas (una sección a la vez, como el celular) o todo junto (la página larga de antes). */
const KEY_VISTA = 'brecha.pantalla.v1'; // ojo: 'brecha.vista.v1' es la vista de la matriz
/** La presentación aparece la primera vez; después la app abre en la última pestaña. */
const KEY_INICIO_VISTO = 'brecha.inicio.visto.v1';
let vista = PLATAFORMA === 'celular' || storage0().get(KEY_VISTA) !== 'todo' ? 'pestanas' : 'todo';
const porPestanas = () => PLATAFORMA === 'celular' || vista === 'pestanas';
/** Lectura previa a crear `storage` (se usa una sola vez, al cargar). */
function storage0() { return { get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } } }; }
let nivelUso = 'profesional';
const INVALIDO = '__invalido__';
const PROVEEDOR = proveedorPorDefecto;

const $ = (sel) => document.querySelector(sel);
/** "978,04 USDT": hasta `dec` decimales, sin ceros de más. */
const unidades = (v, unidad, dec) => `${formatNumberAR(v, { decimals: dec, minDecimals: 0 })} ${unidad}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const storage = {
  get(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: la app sigue andando */ }
  },
  /** Igual que set, pero avisa si no se pudo guardar (lleno o bloqueado). */
  trySet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  },
};

/* ---------- Estado ---------- */
let cot = restaurar(storage.get(KEY_COT));
let calle = restaurarCalle(storage.get(KEY_CALLE)); // blue de la calle que cargó él (o null)
let politica = restaurarPolitica(storage.get(KEY_POLITICA));
const KEY_CAL = 'brecha.calendario.v1';
const KEY_CONTRASTE = 'brecha.contraste.v1';
let calendario = restaurarCalendario(storage.get(KEY_CAL));
let contraste = restaurarContraste(storage.get(KEY_CONTRASTE));
let analisis = null;
let capturas = null;
const sim = { overrideBase: false, overrideVenta: false, consultando: false, nota: '', exch: {} };
/** Precio elegido de un exchange (calculadora): se valida al leerlo del navegador. */
function exchGuardado(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[a-z0-9]{1,30}$/.test(x.id)) return null;
  const nombre = typeof x.nombre === 'string' ? x.nombre.slice(0, 60) : x.id;
  const at = typeof x.at === 'string' && x.at.length <= 40 && !Number.isNaN(Date.parse(x.at)) ? x.at : null;
  return { id: x.id, nombre, at, conComisiones: x.conComisiones !== false, banco: x.banco === true, manual: x.manual === true };
}
function exchRestaurado(g) {
  const out = {};
  if (g && typeof g === 'object') for (const k of ['base', 'venta', 'conversion']) { const x = exchGuardado(g[k]); if (x) out[k] = x; }
  return out;
}
/** Estado de frescura de un mercado según la política vigente y el calendario (feriados). */
const estadoDe = (id) => clasificar(cot.mercados[id], id, { politica, cal: calendario });
/** Control de coherencia entre mercados (alertas; nunca cambia precios). */
const coherencia = () => {
  // Los precios de tu otra fuente se escriben en formato argentino ("1.640,5"): se leen antes de comparar.
  const leer = (t) => { const p = parseNumberAR(t, { kind: 'money' }); return p.ok && !p.empty ? p.value.toString() : null; };
  const k = Object.fromEntries(Object.entries(contraste).map(([id, x]) => [id, { compra: leer(x.compra), venta: leer(x.venta), fuente: x.fuente }]));
  return controlarCoherencia(cot.mercados, { contraste: k });
};
/**
 * Cotizaciones que se usan solas: las marcadas "no usar" por el control de coherencia quedan afuera
 * (se ven en la tarjeta con el motivo; si querés usarlas igual, cargalas a mano en la calculadora).
 */
function mercadosUsables() {
  const c = coherencia();
  const out = {};
  for (const id of IDS_MERCADOS) out[id] = c.porMercado[id].veredicto === 'no_usar' ? { ...cot.mercados[id], valido: false } : cot.mercados[id];
  return out;
}
const ESTADO_UI = {
  actualizada: { t: 'Actualizada', i: '●', c: 'ok' },
  antigua: { t: 'Antigua', i: '⏱', c: 'old' },
  manual: { t: 'Manual', i: '✎', c: 'manual' },
  no_disponible: { t: 'Sin datos', i: '—', c: 'none' },
};
const textoUmbral = (c) => `${formatNumberAR(c.umbralHoras, { decimals: 2, minDecimals: 0 })} h${c.horario === 'habil' ? ' hábiles' : ''}`;

/** Moneda de un costo fijo según cómo se cobra: ARS se escribe con punto de miles; unidades, con punto decimal. */
const kindCobro = (sel) => (COBROS_FIJOS[$(sel).value]?.moneda === 'ARS' ? 'money' : 'ratio');
const CAMPOS = [
  { key: 'monto', el: 'monto', kind: () => 'money' },
  { key: 'cotizacionBase', el: 'cotizacion-base', kind: () => 'money' },
  { key: 'aumentoPct', el: 'aumento', kind: () => 'percent' },
  { key: 'precioVenta', el: 'precio-venta', kind: () => 'money' },
  // La conversión se carga como "% que te cobran" (o te dan de más); el motor recibe la relación equivalente.
  { key: 'relacionConversion', el: 'conversion', kind: () => 'percent', conversion: true },
  { key: 'comisionCompraPct', el: 'com-compra', kind: () => 'percent', costo: true },
  { key: 'comisionVentaPct', el: 'com-venta', kind: () => 'percent', costo: true },
  { key: 'impuestoCompraPct', el: 'impuesto', kind: () => 'percent', costo: true },
  { key: 'ivaComisionesPct', el: 'iva', kind: () => 'percent', costo: true },
  { key: 'otrosCostos', el: 'otros', kind: () => kindCobro('#otros-cobro'), costo: true, cobro: '#otros-cobro' },
  { key: 'costoTransferencia', el: 'transf', kind: () => kindCobro('#transf-cobro'), costo: true, cobro: '#transf-cobro' },
  { key: 'slippageVentaPct', el: 'slippage', kind: () => 'percent', costo: true },
];
const SELECTS = ['modo-monto', 'mercado-compra', 'mercado-venta', 'conversion-sentido', 'otros-cobro', 'transf-cobro', 'impuesto-fiscal', 'iva-fiscal'];
/** Cómo se nombra cada mercado al hablar de la conversión ("pasar de dólar oficial a USDT/USDC"). */
const NOMBRE_CONVERSION = { oficial: 'dólar oficial', blue: 'dólar blue (billete)', mep: 'dólar MEP', ccl: 'dólar CCL (cable)', cripto: 'USDT/USDC' };
const CHECKS = ['relacion-hipotesis'];
/** Campo del motor → id del input (para los botones "No aplica" / "Cargar" del resultado). */
const INPUT_DE = Object.fromEntries(CAMPOS.map((c) => [c.key, c.el]));
const mismoInstrumento = () => $('#mercado-compra').value === $('#mercado-venta').value;

/* ---------- Fechas ---------- */
const fmtFecha = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const fecha = (iso) => (iso ? fmtFecha.format(new Date(iso)).replace(',', '') : '—');
const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
const hora = (iso) => (iso ? fmtHora.format(new Date(iso)) : '—');
function hace(ms) {
  if (ms === null || ms === undefined) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/* ---------- Cotizaciones ---------- */
function guardarCot() {
  storage.set(KEY_COT, cot);
}

/** Precio usable para calcular: existe y la cotización no está invalidada. */
function precioMercado(id, punta) {
  const m = mercadosUsables()[id];
  if (!m || !m[punta] || m.valido === false) return null;
  return m[punta];
}

/** "3 h 20 min" a partir de milisegundos. */
function duracionCorta(ms) {
  if (ms === null || ms === undefined) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function renderCotizaciones() {
  const coh = coherencia();
  $('#cotizaciones').innerHTML = MERCADOS.map((def) => {
    const m = cot.mercados[def.id];
    const c = estadoDe(def.id);
    const ui = ESTADO_UI[c.estado];
    const ver = coh.porMercado[def.id];
    const verBadge = ver.veredicto === 'confiable' ? '' : ` <span class="badge ${ver.veredicto === 'no_usar' ? 'neg' : 'old'}" data-testid="veredicto-${def.id}">${ver.veredicto === 'no_usar' ? '⛔ No usar' : '⚠ Revisar'}</span>`;
    const alertasCoh = ver.alertas.filter((a) => a.nivel !== 'info' && a.codigo !== 'invalido' && a.codigo !== 'puntas_invertidas' && a.codigo !== 'spread' && a.codigo !== 'salto');
    const mercadoTxt = c.edadMercadoMs !== null && HORARIOS_DEFECTO[def.id] && c.edadMs !== null
      ? ` · en horario de mercado: ${duracionCorta(c.edadMercadoMs)}${c.mercadoAbierto ? '' : ' (mercado cerrado ahora)'}` : '';
    const badge = `<span class="badge ${ui.c}" data-testid="estado-${def.id}"><span aria-hidden="true">${ui.i}</span> ${ui.t}</span>${verBadge}`;
    let fuente = '';
    let cuando = '';
    if (m.origen === 'api') {
      fuente = `${m.fuente}${m.fuenteOriginal ? ` · origen: ${m.fuenteOriginal}` : ''}`;
      cuando = c.motivo === 'sin_fecha'
        ? `⚠ La fuente no informó de cuándo es el dato · recibido ${hora(m.fetchedAt)}`
        : c.motivo === 'fecha_futura'
          ? `⚠ La fuente informa una fecha del futuro (${fecha(m.fechaFuente)}): no se sabe de cuándo es el dato · recibido ${hora(m.fetchedAt)}`
          : `${c.antigua ? `⚠ Antigua (más de ${textoUmbral(c)}) · ` : ''}Dato de la fuente: ${fecha(m.fechaFuente)} · ${hace(c.edadMs)}${mercadoTxt} · recibido ${hora(m.fetchedAt)}`;
    } else if (m.origen === 'manual') {
      fuente = `Manual${m.fuenteManual ? ` · ${m.fuenteManual}` : ''}`;
      cuando = `${c.antigua ? `⚠ Cargada hace más de ${textoUmbral(c)}: revisala · ` : ''}Cargada ${fecha(m.editadoAt)} · ${hace(c.edadMs)}`;
    } else {
      cuando = 'Todavía no hay cotización';
    }
    const problemas = (m.problemas || []).filter((p) => p !== 'incompleto' || m.origen === 'manual');
    const apiAlt = m.origen === 'manual' && m.api
      ? `<p class="api-alt">${esc(m.api.fuente)}: compra ${m.api.compra ? formatQuote(m.api.compra) : '—'} · venta ${m.api.venta ? formatQuote(m.api.venta) : '—'} <button type="button" class="btn ghost small" data-volver="${def.id}">Volver a ${esc(m.api.fuente)}</button></p>` : '';
    const fuenteManual = m.origen === 'manual'
      ? `<label class="q-src">De dónde sale <input type="text" data-fuente="${def.id}" value="${esc(m.fuenteManual)}" placeholder="Ej.: mi broker" maxlength="60" aria-label="${def.nombre}: de dónde sale la cotización manual"></label>` : '';
    const inp = (punta, label) => `
      <label class="q-field">
        <span>${label}</span>
        <input type="text" inputmode="decimal" data-id="${def.id}" data-punta="${punta}" value="${m[punta] ? esc(formatQuote(m[punta])) : ''}" aria-label="${def.nombre}: ${label}">
      </label>`;
    return `
      <article class="card estado-${c.estado}${m.valido ? '' : ' invalid'}" data-mercado="${def.id}">
        <header><h3>${def.nombre}</h3>${badge}</header>
        <p class="inst">${esc(def.instrumento)}</p>
        <div class="q-row">${inp('compra', 'Compra (te pagan)')}${inp('venta', 'Venta (pagás)')}</div>
        ${fuente ? `<p class="fuente">${esc(fuente)}</p>` : ''}
        <p class="when${c.antigua ? ' old' : ''}">${esc(cuando)}</p>
        ${fuenteManual}
        ${problemas.length ? `<p class="problem">⚠ ${esc(problemas.map(textoProblema).join(' · '))}</p>` : ''}
        ${alertasCoh.length ? `<p class="problem" data-testid="coherencia-${def.id}">${ver.veredicto === 'no_usar' ? '⛔' : '⚠'} ${esc(alertasCoh.map((a) => a.texto).join(' '))}${ver.veredicto === 'no_usar' ? ' No se usa sola para calcular: si querés usarla igual, cargala a mano en la calculadora.' : ''}</p>` : ''}
        ${apiAlt}
        <p class="card-error" data-error="${def.id}" hidden></p>
      </article>`;
  }).join('');
}

function renderEstadoConsulta() {
  const el = $('#estado-consulta');
  const u = cot.ultimaConsulta;
  el.classList.remove('error');
  const nota = sim.nota ? ` ${sim.nota}` : '';
  if (sim.consultando) { el.textContent = `Consultando ${PROVEEDOR.nombre}…`; return; }
  if (!u) { el.textContent = `Sin consultas todavía.${nota}`; return; }
  const intentos = u.intentos > 1 ? ` (${u.intentos} intentos)` : '';
  if (u.ok) {
    const falt = u.faltantes?.length ? ` · faltaron: ${u.faltantes.map((id) => mercadoPorId(id).nombre).join(', ')}` : '';
    el.textContent = `Consultado ${fecha(u.at)} · ${PROVEEDOR.nombre}${intentos}${falt} · cotizaciones de referencia.${nota}`;
  } else {
    el.classList.add('error');
    const hay = IDS_MERCADOS.some((id) => cot.mercados[id].compra || cot.mercados[id].venta);
    const espera = u.reintentarDespues && Date.parse(u.reintentarDespues) > Date.now() ? ` Podés reintentar desde las ${hora(u.reintentarDespues)}.` : '';
    const datos = hay
      ? ` Se muestran los últimos datos guardados${u.ultimoExitoAt ? ` (consultados ${fecha(u.ultimoExitoAt)})` : ''}, cada uno con su estado.`
      : ' Cargá las cotizaciones a mano o reintentá.';
    el.textContent = `No se pudo actualizar (${fecha(u.at)}${intentos}): ${u.error.mensaje}${espera}${datos}${nota}`;
  }
}

function renderAvisoManuales() {
  const el = $('#aviso-manuales');
  const cons = (cot.ultimaConsulta?.conservados ?? []).filter((id) => cot.mercados[id].origen === 'manual');
  if (!cons.length) { el.hidden = true; el.innerHTML = ''; return; }
  const nombres = cons.map((id) => mercadoPorId(id).nombre).join(', ');
  el.hidden = false;
  el.innerHTML = `<p>Conservé tus cotizaciones manuales de <strong>${esc(nombres)}</strong>. ${esc(PROVEEDOR.nombre)} trajo valores nuevos (los ves en cada tarjeta).</p>
    <div class="banner-actions"><button type="button" class="btn small" id="reemplazar-manuales">Reemplazar por ${esc(PROVEEDOR.nombre)}</button>
    <button type="button" class="btn ghost small" id="cerrar-aviso">Mantener las mías</button></div>`;
}

function notaBloqueo(gate) {
  const s = Math.ceil(gate.esperarMs / 1000);
  if (gate.motivo === 'copia_local') {
    return `Usando la copia local: se renueva sola pasados ${POLITICA_CONSULTA.copiaLocalMinutos} min o con el botón.`;
  }
  if (gate.motivo === 'espera_manual') {
    return `Ya se consultó hace instantes: podés volver a consultar en ${s} s (la fuente no cambia segundo a segundo).`;
  }
  return `${PROVEEDOR.nombre} pidió esperar: podés reintentar en ${s} s.`;
}

/** @param {'auto'|'manual'} motivo  auto = al abrir (usa la copia local si es reciente) */
async function actualizarCotizaciones(motivo = 'manual') {
  if (sim.consultando) return;
  const gate = puedeConsultar(cot.ultimaConsulta, { motivo });
  if (!gate.permitido) {
    sim.nota = notaBloqueo(gate);
    renderEstadoConsulta();
    return;
  }
  sim.nota = '';
  sim.consultando = true;
  $('#btn-actualizar').disabled = true;
  renderEstadoConsulta();
  try {
    const resp = await consultarConReintentos(PROVEEDOR);
    cot = aplicarRespuesta(cot, resp);
    guardarCot();
    if (resp.ok) capturas?.alActualizar();
  } finally {
    // Pase lo que pase, el botón vuelve a quedar disponible.
    sim.consultando = false;
    $('#btn-actualizar').disabled = false;
    renderTodo();
  }
}

/* ---------- Política de vencimiento ---------- */
function renderPolitica() {
  const box = $('#politica-campos');
  box.innerHTML = MERCADOS.map((def) => {
    const r = politica[def.id];
    return `<div class="field pol-field">
      <label for="pol-${def.id}">${def.nombre}: antigua después de</label>
      <div class="with-action"><input id="pol-${def.id}" data-politica="${def.id}" type="text" inputmode="decimal" value="${esc(formatNumberAR(r.horas, { decimals: 2, minDecimals: 0 }))}" aria-describedby="pol-${def.id}-u">
      <span class="unit" id="pol-${def.id}-u">h ${r.horario === 'habil' ? 'hábiles' : 'corridas'}</span></div>
    </div>`;
  }).join('');
  renderCalendario();
  $('#politica-consulta').textContent = `Al abrir la app se usa la copia local si tiene menos de ${POLITICA_CONSULTA.copiaLocalMinutos} min. `
    + `Con el botón, como máximo una consulta por minuto. Si falla la red o el servidor, se reintenta ${POLITICA_CONSULTA.reintentos} veces (a los 1 y 3 s). `
    + `Si ${PROVEEDOR.nombre} pide esperar, se respeta.`;
}

/** Feriados: los automáticos del año y los que cargás vos (trasladables, puentes). */
function renderCalendario() {
  const anio = Number(fechaAR(Date.now()).slice(0, 4));
  const auto = [...feriadosDelAnio(anio)].sort();
  $('#calendario-campos').innerHTML = `
    <p class="sub">Feriados (no cuentan como horas hábiles)</p>
    <p class="hint">Automáticos ${anio} (inamovibles por ley, Carnaval y Viernes Santo): ${esc(auto.map((f) => f.slice(5).split('-').reverse().join('/')).join(', '))}.
      Los trasladables y los días no laborables con fines turísticos cambian por decreto: cargalos vos (fuente: argentina.gob.ar/interior/feriados).</p>
    <div class="row two">
      <div class="field"><label for="cal-extra">Feriados que agregás <span class="unit">uno por línea, AAAA-MM-DD</span></label>
        <textarea id="cal-extra" rows="3" data-cal="extra" placeholder="2026-08-17">${esc(calendario.extra.join('\n'))}</textarea></div>
      <div class="field"><label for="cal-quitar">Feriados automáticos que sacás <span class="unit">uno por línea</span></label>
        <textarea id="cal-quitar" rows="3" data-cal="quitar">${esc(calendario.quitar.join('\n'))}</textarea></div>
    </div>`;
}

/** Panel de calidad: veredicto, alertas, antigüedades y la fuente de contraste que cargás vos. */
function renderCalidad() {
  const coh = coherencia();
  const VER = { confiable: '✔ Confiable', revisar: '⚠ Revisar', no_usar: '⛔ No usar' };
  const filas = MERCADOS.map((def) => {
    const v = coh.porMercado[def.id];
    const c = estadoDe(def.id);
    const m = cot.mercados[def.id];
    const k = contraste[def.id] ?? { compra: '', venta: '', fuente: '' };
    const inp = (campo, ph) => `<input type="text" data-contraste="${def.id}.${campo}" value="${esc(k[campo] ?? '')}" placeholder="${ph}" aria-label="${def.nombre}: ${campo === 'fuente' ? 'otra fuente' : `${campo} en otra fuente`}">`;
    return `<tr data-testid="calidad-${def.id}"><th scope="row">${def.nombre}</th><td class="ver-${v.veredicto}">${VER[v.veredicto]}</td>
      <td>${v.alertas.length ? `<ul>${v.alertas.map((a) => `<li>${esc(a.texto)}</li>`).join('')}</ul>` : 'Sin alertas'}</td>
      <td>${m.fechaFuente ? esc(fecha(m.fechaFuente)) : '—'}<br><span class="unit">recibido ${m.fetchedAt ? esc(hora(m.fetchedAt)) : '—'}</span></td>
      <td>${duracionCorta(c.edadMs)}<br><span class="unit">${HORARIOS_DEFECTO[def.id] ? `en horario de mercado: ${duracionCorta(c.edadMercadoMs)}` : 'opera todo el día'}</span></td>
      <td class="contraste">${inp('compra', 'Compra')}${inp('venta', 'Venta')}${inp('fuente', 'De dónde')}</td></tr>`;
  }).join('');
  $('#calidad-campos').innerHTML = `${coh.generales.map((g) => `<p class="hint">${esc(g.texto)}</p>`).join('')}
    <div class="table-wrap"><table class="breakdown calidad-tabla"><thead><tr><th scope="col">Mercado</th><th scope="col">Veredicto</th><th scope="col">Alertas</th><th scope="col">Publicado</th><th scope="col">Antigüedad</th><th scope="col">Tu otra fuente</th></tr></thead><tbody>${filas}</tbody></table></div>
    <p class="hint">Horarios de mercado usados para la antigüedad: oficial 10 a 15, blue 10 a 18, MEP y CCL 11 a 17 (hora de Buenos Aires, valores a verificar); cripto opera todo el día.</p>`;
}

function aplicarPolitica(id, raw) {
  const p = parseNumberAR(raw, { kind: 'ratio' });
  const err = $(`#pol-${id}`);
  if (!p.ok || p.empty || !p.value.gt(0) || p.value.gt(HORAS_MAXIMAS)) {
    err.setAttribute('aria-invalid', 'true');
    return;
  }
  err.removeAttribute('aria-invalid');
  politica = restaurarPolitica({ ...politica, [id]: { horas: Number(p.value.toString()) } });
  storage.set(KEY_POLITICA, politica);
  renderTodo();
}

/** Las edades cambian con el tiempo aunque no se consulte: se recalculan cada minuto, sin red. */
function refrescarEdades() {
  const act = document.activeElement;
  if (!act || !$('#cotizaciones').contains(act)) renderCotizaciones();
  renderEstadoConsulta();
  sincronizarPrecios();
  recalcular();
  rutas?.refrescar();
  exchanges?.refrescar();
  opcionesUsdt?.render(); // "hace X min"
}

/* ---------- Formulario ---------- */
function llenarSelects() {
  const opts = MERCADOS.map((m) => `<option value="${m.id}">${m.nombre}</option>`).join('');
  $('#mercado-compra').innerHTML = opts;
  $('#mercado-venta').innerHTML = opts;
  $('#mercado-compra').value = 'oficial';
  $('#mercado-venta').value = 'blue';
  for (const id of ['otros-cobro', 'transf-cobro']) $(`#${id}`).innerHTML = Object.entries(COBROS_FIJOS).map(([k, c]) => `<option value="${k}">${c.texto}</option>`).join('');
  $('#otros-cobro').value = 'suma_capital';
  $('#transf-cobro').value = 'suma_capital';
  $('#impuesto-fiscal').innerHTML = opcionesFiscal('pendiente');
  $('#iva-fiscal').innerHTML = opcionesFiscal('pendiente');
}

/** Textos de la conversión y de los cobros según los mercados elegidos. */
function actualizarEtiquetas() {
  const a = mercadoPorId($('#mercado-compra').value);
  const b = mercadoPorId($('#mercado-venta').value);
  const mismo = mismoInstrumento();
  const na = NOMBRE_CONVERSION[a.id] ?? a.nombre;
  const nb = NOMBRE_CONVERSION[b.id] ?? b.nombre;
  $('#conversion').disabled = mismo;
  $('#conversion-sentido').disabled = mismo;
  $('#relacion-probar').hidden = mismo;
  $('#relacion-hipotesis').disabled = mismo;
  $('#campo-relacion').classList.toggle('requerido', !mismo);
  const simple = operativa === 'simple';
  $('#conversion-pregunta').textContent = simple ? 'Qué % en USD te cobran los USDT' : mismo ? 'Conversión' : `¿Cuánto te cobran por pasar de ${na} a ${nb}?`;
  $('#relacion-unidad').textContent = simple ? '% arriba del dólar (obligatorio)' : mismo ? 'no hace falta: comprás y vendés el mismo dólar' : `${UNIDAD_SENTIDO[$('#conversion-sentido').value] ?? UNIDAD_SENTIDO.cobran} (obligatorio)`;
  $('#relacion-hint').textContent = simple ? 'Lo que pagás de más por cada USDT, en dólares billete. Por ejemplo 2 = cada USDT te sale 1,02 dólares. Si te los dan 1 a 1, poné 0.' : mismo
    ? ''
    : `Comprás ${a.instrumento} y vendés ${b.instrumento}: no son lo mismo, y pasar de uno al otro suele tener un costo. Cargá el % que te cobran en esa operación (por ejemplo 1,5) o, si pagás cada ${b.unidad} más caro que el ${a.unidad} (por ejemplo el oficial + 2 %), elegí «Pagás más caro». Si no te cobran nada, poné 0. Si no lo sabés, no hay resultado; podés probar sin costo marcándolo como hipótesis.`;
  for (const id of ['otros-cobro', 'transf-cobro']) {
    for (const o of $(`#${id}`).options) {
      const c = COBROS_FIJOS[o.value];
      o.textContent = c.moneda === 'origen' ? `${c.texto} (${a.unidad}, ${c.momento})` : c.moneda === 'destino' ? `${c.texto} (${b.unidad}, ${c.momento})` : `${c.texto}, ${c.momento}`;
    }
  }
}

/** Completa cotización base y precio de venta desde el mercado, salvo que los hayas editado en la calculadora. */
function sincronizarPrecios() {
  const c = $('#mercado-compra').value;
  const v = $('#mercado-venta').value;
  if (!sim.overrideBase) {
    const p = c === 'blue' && calle ? toDec(calle.venta) : precioMercado(c, 'venta');
    $('#cotizacion-base').value = p ? formatQuote(p) : '';
  }
  if (!sim.overrideVenta) {
    const p = precioMercado(v, 'compra');
    $('#precio-venta').value = p ? formatQuote(p) : '';
  }
  $('#reset-base').hidden = !sim.overrideBase;
  $('#reset-venta').hidden = !sim.overrideVenta;
  $('#cotizacion-base-src').textContent = textoFuente(c, 'venta', sim.overrideBase);
  $('#precio-venta-src').textContent = textoFuente(v, 'compra', sim.overrideVenta);
  renderCalle();
}

/** Recuadro «Tu blue de la calle»: se ve cuando comprás blue. */
function renderCalle() {
  const caja = $('#blue-calle');
  const ver = $('#mercado-compra').value === 'blue';
  caja.hidden = !ver;
  if (!ver) return;
  const api = precioMercado('blue', 'venta');
  const apiTxt = api ? formatARS(api) : 'sin dato';
  if (document.activeElement !== $('#blue-calle-precio')) $('#blue-calle-precio').value = calle ? formatQuote(toDec(calle.venta)) : '';
  $('#blue-calle-quitar').hidden = !calle;
  const aviso = calle ? avisoCalle(calle, api) : null;
  $('#blue-calle-estado').textContent = calle
    ? `Usando tu blue de la calle: ${formatARS(toDec(calle.venta))} (lo cargaste el ${fecha(calle.at)}). Blue en DolarAPI: ${apiTxt}.${aviso ? ` ${aviso}` : ''}`
    : `Ahora usa el blue de DolarAPI (${apiTxt}). Si en la calle conseguís el billete a otro precio, cargalo acá: queda guardado para la próxima.`;
}
function guardarCalle(nuevo) {
  calle = nuevo;
  storage.set(KEY_CALLE, calle);
  if ($('#mercado-compra').value === 'blue') { sim.overrideBase = false; delete sim.exch.base; if (sim.guardada) sim.guardada.base = false; }
  sincronizarPrecios();
  recalcular();
}

function textoFuente(id, punta, override) {
  const def = mercadoPorId(id);
  const hoy = precioMercado(id, punta) ? formatQuote(precioMercado(id, punta)) : 'sin dato';
  if (override && sim.guardada?.[punta === 'venta' ? 'base' : 'venta']) return `Precio guardado en «${sim.guardada.nombre}» (${fecha(sim.guardada.fecha)}). Hoy ${def.nombre} ${punta}: ${hoy}`;
  const ex = override ? sim.exch[punta === 'venta' ? 'base' : 'venta'] : null;
  if (ex?.banco) return `${ex.nombre} · ${ex.manual ? `la cargaste a mano${ex.at ? ` el ${fecha(ex.at)}` : ''}` : `CriptoYa${ex.at ? `, dato de ${fecha(ex.at)}` : ''}`} (${def.nombre} ${punta} en DolarAPI: ${hoy})`;
  if (ex) return `${ex.nombre} · CriptoYa, ${ex.conComisiones ? 'con' : 'sin'} comisiones${ex.at ? `, precio de las ${hora(ex.at)}` : ''} (${def.nombre} ${punta} en DolarAPI: ${hoy})`;
  if (override) return `Cargado a mano en la calculadora (${def.nombre} ${punta}: ${hoy})`;
  if (id === 'blue' && punta === 'venta' && calle) return `Tu blue de la calle, cargado el ${fecha(calle.at)} (blue venta en DolarAPI: ${hoy})`;
  const m = cot.mercados[id];
  const c = estadoDe(id);
  if (!precioMercado(id, punta)) return `${def.nombre} · ${punta} · sin cotización válida: cargala a mano`;
  if (m.origen === 'manual') return `${def.nombre} · ${punta} · cotización manual${m.fuenteManual ? ` (${m.fuenteManual})` : ''}, cargada ${fecha(m.editadoAt)}${c.antigua ? ' · ⚠ revisala' : ''}`;
  return `${def.nombre} · ${punta} · ${m.fuente}, dato de ${fecha(m.fechaFuente)} (${hace(c.edadMs)}) · ${ESTADO_UI[c.estado].t.toLowerCase()}`;
}

/** Cómo se muestra un valor de un campo (para el texto de abajo de cada campo). */
function formatoCampo(campo, kind) {
  return (v) => {
    if (campo.key === 'monto') return $('#modo-monto').value === 'ars' ? formatARS(v) : formatUnits(v, mercadoPorId($('#mercado-compra').value).unidad);
    if (campo.cobro && kind !== 'money') {
      const moneda = COBROS_FIJOS[$(campo.cobro).value]?.moneda;
      const unidad = moneda === 'origen' ? mercadoPorId($('#mercado-compra').value).unidad : mercadoPorId($('#mercado-venta').value).unidad;
      return unidades(v, unidad, 6);
    }
    if (kind === 'money') return formatARS(v);
    if (kind === 'percent') return `${formatNumberAR(v, { decimals: 6, minDecimals: 0 })} %`;
    return formatNumberAR(v, { decimals: 8, minDecimals: 0 });
  };
}

function echo(campo, raw, p, kind) {
  const el = document.getElementById(`${campo.el}-echo`);
  const input = document.getElementById(campo.el);
  if (!el) return;
  el.classList.remove('bad', 'nose', 'na', 'cero');
  input.removeAttribute('aria-invalid');
  if (campo.costo) {
    const e = estadoCostoTexto(raw, p, formatoCampo(campo, kind));
    el.textContent = e.texto;
    if (e.clase) el.classList.add(e.clase);
    if (e.clase === 'bad') input.setAttribute('aria-invalid', 'true');
    return;
  }
  if (!p.ok) {
    el.textContent = p.error;
    el.classList.add('bad');
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  if (p.empty) {
    el.textContent = campo.conversion && !mismoInstrumento() ? 'No sé: sin este dato no hay resultado (nunca se supone que pasar de un dólar al otro es gratis)' : '';
    if (el.textContent) el.classList.add('nose');
    return;
  }
  if (campo.conversion) return echoConversion(el, input, p.value);
  el.textContent = `= ${formatoCampo(campo, kind)(p.value)}`;
}

/** Texto de abajo del % de la conversión: qué significa en unidades ("por cada 100 USD recibís 98,5 USDT/USDC"). */
function echoConversion(el, input, pctValor) {
  const r = relacionDesdePct(pctValor, $('#conversion-sentido').value);
  if (!r.ok) {
    el.textContent = r.error;
    el.classList.add('bad');
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  const ua = mercadoPorId($('#mercado-compra').value).unidad;
  const ub = mercadoPorId($('#mercado-venta').value).unidad;
  if (toDec(pctValor).eq(0)) { el.textContent = `Sin costo: por cada 100 ${ua} recibís 100 ${ub}`; el.classList.add('cero'); return; }
  const recibis = `por cada 100 ${ua} recibís ${formatNumberAR(r.relacion.times(100), { decimals: 6, minDecimals: 0 })} ${ub}`;
  el.textContent = $('#conversion-sentido').value === 'sobreprecio'
    ? `= cada ${ub} te sale ${formatNumberAR(pctValor, { decimals: 6, minDecimals: 0 })} % más que el ${ua}: ${recibis}`
    : `= ${recibis}`;
}

function leerFormulario() {
  actualizarEtiquetas();
  const entrada = { modoMonto: $('#modo-monto').value };
  for (const campo of CAMPOS) {
    const kind = campo.kind();
    const raw = document.getElementById(campo.el).value;
    const p = parseNumberAR(raw, { kind });
    echo(campo, raw, p, kind);
    entrada[campo.key] = campo.costo && esNoAplica(raw) ? NO_APLICA : !p.ok ? INVALIDO : p.empty ? null : p.value;
    if (campo.conversion && p.ok && !p.empty) {
      const r = relacionDesdePct(p.value, $('#conversion-sentido').value);
      entrada[campo.key] = r.ok ? r.relacion : INVALIDO;
      // Cómo la cargaste (para decirlo igual en la explicación y en la ruta por pasos); el motor sólo usa R
      if (r.ok) entrada.conversionDicha = { sentido: $('#conversion-sentido').value, pct: p.value };
    }
  }
  entrada.otrosCostos = { monto: entrada.otrosCostos, cobro: $('#otros-cobro').value };
  entrada.costoTransferencia = { monto: entrada.costoTransferencia, cobro: $('#transf-cobro').value };
  entrada.impuestoFiscal = $('#impuesto-fiscal').value;
  entrada.ivaFiscal = $('#iva-fiscal').value;
  entrada.requiereConversion = !mismoInstrumento();
  if (mismoInstrumento()) { entrada.relacionConversion = null; delete entrada.conversionDicha; } // mismo instrumento: no hay conversión
  entrada.relacionHipotesis = !mismoInstrumento() && $('#relacion-hipotesis').checked;
  return entrada;
}

function datosFormulario() {
  const data = { version: 3, overrideBase: sim.overrideBase, overrideVenta: sim.overrideVenta, exch: sim.exch, campos: {}, selects: {}, checks: {}, masCostos: $('#mas-costos').open };
  for (const c of CAMPOS) data.campos[c.el] = document.getElementById(c.el).value;
  for (const s of SELECTS) data.selects[s] = document.getElementById(s).value;
  for (const k of CHECKS) data.checks[k] = document.getElementById(k).checked;
  return data;
}

function guardarFormulario() {
  storage.set(KEY_FORM, datosFormulario());
}

/**
 * Formulario guardado → campos. El formato anterior (v1) se convierte: el "1" que venía por defecto en la
 * relación de conversión NO se conserva (sería suponer 1 a 1), y "transferencia en ARS/origen/destino" pasa a su forma de cobro.
 * @returns {boolean} true si hubo que convertir un formulario anterior
 */
function aplicarFormulario(d) {
  if (!d || typeof d !== 'object') return false;
  const v1 = d.version !== 3;
  const selects = { ...(d.selects ?? {}) };
  if (v1 && typeof selects['transf-unidad'] === 'string') selects['transf-cobro'] = { ARS: 'suma_capital', origen: 'descuenta_origen', destino: 'descuenta_destino' }[selects['transf-unidad']];
  for (const s of SELECTS) {
    const el = document.getElementById(s);
    const v = selects[s];
    if (typeof v === 'string' && [...el.options].some((o) => o.value === v)) el.value = v;
  }
  for (const c of CAMPOS) {
    const v = d.campos?.[c.el];
    if (typeof v === 'string') document.getElementById(c.el).value = v;
  }
  for (const k of CHECKS) document.getElementById(k).checked = d.checks?.[k] === true;
  let convertido = false;
  // Antes la conversión se guardaba como relación ("relacion": 0,985): se pasa al % exacto que te cobran.
  if (typeof d.campos?.conversion !== 'string' && typeof d.campos?.relacion === 'string') {
    const m = conversionDesdeRelacionVieja(d.campos.relacion, v1);
    $('#conversion').value = m.texto;
    $('#conversion-sentido').value = m.sentido;
    if (m.aviso) sim.avisoConversion = m.aviso;
    if (v1 && d.campos.relacion.trim() === '1') convertido = true;
  }
  sim.overrideBase = d.overrideBase === true;
  sim.overrideVenta = d.overrideVenta === true;
  sim.exch = exchRestaurado(d.exch);
  if (!sim.overrideBase) delete sim.exch.base;
  if (!sim.overrideVenta) delete sim.exch.venta;
  if (d.masCostos) $('#mas-costos').open = true;
  return convertido || v1;
}

/**
 * Una relación guardada con la versión anterior (unidades que recibís por cada una) → % que te cobran.
 * El "1" que venía por defecto en la versión 1 no se conserva (sería suponer que la conversión es gratis).
 * @returns {{texto: string, sentido: 'cobran'|'dan', aviso: string|null, relacion: *}}
 */
function conversionDesdeRelacionVieja(raw, v1 = false) {
  const t = String(raw ?? '').trim();
  if (!t || (v1 && t === '1')) return { texto: '', sentido: 'cobran', aviso: null, relacion: null };
  const p = parseNumberAR(t, { kind: 'ratio' });
  if (!p.ok || p.empty || p.value.lte(0)) return { texto: '', sentido: 'cobran', aviso: `No pude pasar la relación de conversión guardada («${t}») a %: cargá cuánto te cobran.`, relacion: null };
  const { sentido, pct } = pctDesdeRelacion(p.value);
  const texto = formatNumberAR(pct, { decimals: 12, minDecimals: 0 });
  return { texto, sentido, relacion: p.value, aviso: `La conversión ahora se carga como el % que te cobran: tu relación ${t} quedó como «${sentido === 'cobran' ? 'te cobran' : 'te dan de más'} ${texto} %» (es lo mismo).` };
}

function restaurarFormulario() {
  const nuevo = storage.get(KEY_FORM);
  if (nuevo) { aplicarFormulario(nuevo); return; }
  const viejo = storage.get(KEY_FORM_V1);
  if (viejo && aplicarFormulario(viejo)) {
    sim.nota = '';
    sim.avisoMigracion = 'Brecha 3: los costos vacíos ahora cuentan como "No sé" (antes valían 0) y la relación de conversión ya no se supone 1 a 1. Revisá tu simulación.';
  }
}

/* ---------- Resultado ---------- */
function advertenciasDeRuta(compra, venta, entrada) {
  const out = [];
  const a = mercadoPorId(compra);
  const b = mercadoPorId(venta);
  if (compra === venta) {
    out.push('Mismo mercado: comprás al precio de venta y vendés al de compra, así que el spread juega en contra.');
  } else {
    out.push(`Ruta no verificada: pasar de ${a.instrumento} a ${b.instrumento} puede requerir pasos, plazos, costos y condiciones normativas que esta calculadora no verifica.`);
  }
  const r = entrada.relacionConversion;
  if (compra !== venta && entrada.relacionHipotesis && r && r !== INVALIDO && toDec(r).eq(1)) {
    out.push(`Probás sin costo para pasar de ${NOMBRE_CONVERSION[compra] ?? a.instrumento} a ${NOMBRE_CONVERSION[venta] ?? b.instrumento} (0 %): es una hipótesis, no un dato. Cargá el % que te cobran de verdad.`);
  }
  for (const [id, punta, ov] of [[compra, 'venta', sim.overrideBase], [venta, 'compra', sim.overrideVenta]]) {
    if (ov) continue;
    const m = cot.mercados[id];
    const c = estadoDe(id);
    const n = mercadoPorId(id).nombre;
    if (c.estado === 'antigua') {
      out.push(c.motivo === 'sin_fecha' || c.motivo === 'fecha_futura'
        ? `No se sabe de cuándo es la cotización de ${n}${c.motivo === 'fecha_futura' ? ' (la fuente informa una fecha del futuro)' : ''}.`
        : `La cotización de ${n} (${punta}) es antigua: más de ${textoUmbral(c)} según la fuente.`);
    } else if (c.estado === 'manual') {
      out.push(`La cotización de ${n} (${punta}) es manual${m.fuenteManual ? ` (${m.fuenteManual})` : ''}${c.antigua ? ` y se cargó hace más de ${textoUmbral(c)}: revisala` : ''}.`);
    }
    for (const p of ['salto_brusco', 'spread_inusual']) {
      if (m.problemas?.includes(p)) out.push(`${n}: ${textoProblema(p)}.`);
    }
  }
  return out;
}

const DISCLAIMER_SIMPLE = 'Simulación con cotizaciones de referencia: no garantiza que la operación se pueda ejecutar a estos precios.';

function renderResultado(r, entrada) {
  const box = $('#resultado');
  const compra = $('#mercado-compra').value;
  const venta = $('#mercado-venta').value;
  box.dataset.nivel = r.ok ? r.calidad.nivel : r.datosInsuficientes ? 'insuficiente' : 'error';
  const nota = sim.notaGuardada ? `<div class="banner" role="status" data-testid="nota-guardada"><p>${esc(sim.notaGuardada)}</p></div>` : '';
  if (!r.ok) {
    if (r.datosInsuficientes) {
      const ayuda = r.errors.some((e) => e.field === 'relacionConversion')
        ? '<div class="banner-actions"><button type="button" class="btn small" data-accion-simple="probar-1a1">Probar sin costo (0 %) como hipótesis</button> <button type="button" class="btn ghost small" data-cargar-campo="relacionConversion">Cargar el % que te cobran</button></div>' : '';
      box.innerHTML = `<h3 id="h-res" class="sr-only">Resultado</h3>${nota}${bloqueCalidad(r.calidad, { ayudaInsuficiente: ayuda })}<p class="disclaimer">${DISCLAIMER_SIMPLE}</p>`;
      return;
    }
    box.innerHTML = `<h3 id="h-res" class="sr-only">Resultado</h3>${nota}
      <div class="res-errors" role="alert"><p class="res-title">Falta corregir para calcular</p>
      <ul>${r.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul></div>`;
    return;
  }
  const x = r.result;
  const nivel = r.calidad.nivel;
  const uo = mercadoPorId(compra).unidad;
  const ud = mercadoPorId(venta).unidad;
  const tit = tituloResultado(x.estado, nivel);
  const c = tono(x.resultadoNeto, nivel);
  const avisos = [...r.warnings.filter((w) => w.code !== 'costos_desconocidos').map((w) => w.message), ...advertenciasDeRuta(compra, venta, entrada)];
  const fila = (label, value, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th><td>${value}</td></tr>`;
  const botonNoAplica = (d) => (INPUT_DE[d.campo]
    ? ` <button type="button" class="btn ghost small" data-cargar-campo="${d.campo}">Cargar</button> <button type="button" class="btn ghost small" data-na-campo="${d.campo}" aria-label="${esc(d.etiqueta)}: no aplica">No aplica</button>` : '');
  const fijos = Object.entries(x.fijos).filter(([, v]) => !v.eq(0)).map(([k, v]) => {
    const cb = COBROS_FIJOS[k];
    const moneda = cb.moneda === 'origen' ? uo : cb.moneda === 'destino' ? ud : 'ARS';
    return fila(`Costos fijos: ${cb.texto.toLowerCase()} (${cb.momento})`, moneda === 'ARS' ? formatARS(v) : unidades(v, moneda, 6));
  }).join('');

  const todosNoAplican = r.calidad.desconocidos?.length > 1
    ? '<div class="banner-actions"><button type="button" class="btn ghost small" data-accion-simple="todos-no-aplican">Ninguno de estos existe: marcarlos «no aplica»</button></div>' : '';
  box.innerHTML = `<h3 id="h-res" class="sr-only">Resultado</h3>
    ${nota}
    ${bloqueCalidad(r.calidad, { botonNoAplica, pie: todosNoAplican })}
    <div class="headline ${c}" data-testid="headline">
      <p class="res-title"><span aria-hidden="true">${tit.i}</span> ${tit.t}</p>
      <p class="big" data-testid="resultado-neto">${prefijoResultado(nivel)}${formatARSSigned(x.resultadoNeto)}</p>
      <p class="roi">Resultado de caja · ROI neto ${nivel === 'incompleto' ? 'como máximo ' : ''}<strong class="${c}" data-testid="roi">${formatPct(x.roiPct)}</strong></p>
    </div>
    ${bloqueExplicacion(explicarSimple(r, { mismoMercado: compra === venta, unidadOrigen: uo, unidadDestino: ud, conversion: entrada.conversionDicha ?? null }))}
    ${bloqueEconomico(x.resultadoEconomico, x.resultadoNeto, { conceptos: x.fiscal.conceptos })}
    <dl class="kpis">
      <div><dt>Capital desembolsado</dt><dd data-testid="capital-inicial">${formatARS(x.capitalInicial)}</dd></div>
      <div><dt>Capital final</dt><dd data-testid="capital-final">${formatARS(x.capitalFinal)}</dd></div>
      <div><dt>Ingreso bruto <span class="unit">a cotización</span></dt><dd data-testid="ingreso-bruto">${formatARS(x.ingresoBruto)}</dd></div>
      <div><dt>Costos totales${nivel === 'incompleto' ? ' <span class="unit">conocidos</span>' : ''}</dt><dd data-testid="costos-totales">${formatARS(x.costosTotales)}</dd></div>
      <div><dt>Equilibrio <span class="unit">precio de venta</span></dt><dd data-testid="equilibrio">${formatARS(x.equilibrioVenta)}</dd></div>
      <div><dt>Margen de seguridad</dt><dd data-testid="margen">${formatPct(x.objetivosPrecio[0].margenSeguridadPct)}</dd></div>
    </dl>
    <div class="gaps">
      <p>Brecha nominal <strong data-testid="brecha-nominal">${formatPct(x.brechaNominalPct)}</strong></p>
      <p>Brecha ajustada por conversión <strong data-testid="brecha-ajustada">${formatPct(x.brechaAjustadaPct)}</strong></p>
      <p class="hint">La brecha compara precios; no es ganancia. El resultado neto incluye los costos cargados.</p>
    </div>
    ${tablaObjetivos(x.objetivosPrecio, `ARS por 1 ${ud}`, nivel)}
    ${avisos.length ? `<ul class="warnings" data-testid="avisos">${avisos.map((a) => `<li>⚠ ${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="res-actions">${historial?.botones('simple') ?? ''}<button type="button" class="btn ghost small" id="abrir-como-ruta" data-desde="profesional">Abrir como ruta por pasos →</button></div>
    ${analisis?.html('simple', datosAnalisisSimple) ?? ''}
    <details class="detail" data-desde="avanzado">
      <summary>Detalle del cálculo</summary>
      <table class="breakdown"><tbody>
        ${fila('Cantidad comprada', unidades(x.cantidadOrigen, uo, 4))}
        ${fila('Precio de compra final', formatARS(x.precioCompraFinal, { decimals: 4 }))}
        ${fila('Compra', formatARS(x.compra))}
        ${fila('Comisión de compra (sobre la compra)', formatARS(x.comisionCompra))}
        ${fila('IVA u otro % sobre la comisión de compra', formatARS(x.ivaCompra))}
        ${fila('Impuestos sobre la compra', formatARS(x.impuestoCompra))}
        ${fijos}
        ${fila('Costos en unidades (valorizados al precio de venta)', formatARS(x.costoTransferenciaUnidadesARS))}
        ${fila('Unidades recibidas', unidades(x.unidadesRecibidas, ud, 4))}
        ${fila('Precio de venta efectivo', formatARS(x.precioVentaEfectivo, { decimals: 4 }))}
        ${fila('Ingreso efectivo', formatARS(x.ingresoEfectivo))}
        ${fila('Comisión de venta (sobre lo cobrado)', formatARS(x.comisionVenta))}
        ${fila('IVA u otro % sobre la comisión de venta', formatARS(x.ivaVenta))}
        ${fila('Slippage', formatARS(x.costoSlippage))}
      </tbody></table>
    </details>
    <p class="disclaimer">${DISCLAIMER_SIMPLE}</p>`;
}

function actualizarPrecioFinal(entrada) {
  const out = $('#precio-final');
  const B = entrada.cotizacionBase;
  const A = entrada.aumentoPct;
  if (!B || B === INVALIDO || A === INVALIDO || toDec(B).lte(0)) { out.textContent = '—'; return; }
  const a = A ?? 0;
  if (toDec(a).lt(0) || toDec(a).gt(100)) { out.textContent = '—'; return; }
  out.textContent = formatARS(precioCompraFinal(B, a), { decimals: 2 });
}

/** La operación simple como ruta equivalente, para el panel de análisis. */
function datosAnalisisSimple() {
  const conv = rutaDesdeSimple(leerFormulario(), $('#mercado-compra').value, $('#mercado-venta').value);
  if (!conv.ok) return null;
  return { entrada: conv.entrada, motor: { activosValidos: IDS_ACTIVOS, decimales: DECIMALES, nombres: NOMBRES }, unidadPrecio: `ARS por 1 ${mercadoPorId($('#mercado-venta').value).unidad}`, conTiempo: false };
}

/**
 * Una simulación simple guardada → entrada del motor (sin tocar la pantalla). Para recalcularla con otros precios.
 * Del formato anterior, el "1" por defecto de la conversión no se conserva (no se supone 1 a 1).
 */
function entradaDesdeGuardada(s) {
  const campos = s.campos ?? {};
  const sel = s.selects ?? {};
  const v1 = s.version !== 3;
  const cobroT = sel['transf-cobro'] ?? ({ ARS: 'suma_capital', origen: 'descuenta_origen', destino: 'descuenta_destino' }[sel['transf-unidad']] ?? 'suma_capital');
  const cobroO = sel['otros-cobro'] ?? 'suma_capital';
  const kindDe = (c) => (c.key === 'otrosCostos' ? (COBROS_FIJOS[cobroO]?.moneda === 'ARS' ? 'money' : 'ratio') : c.key === 'costoTransferencia' ? (COBROS_FIJOS[cobroT]?.moneda === 'ARS' ? 'money' : 'ratio') : c.kind());
  const e = { modoMonto: sel['modo-monto'] ?? 'unidades' };
  for (const c of CAMPOS) {
    if (c.conversion) {
      // Guardada con el % (nuevo) o con la relación (versión anterior): las dos dan la misma relación.
      if (typeof campos.conversion === 'string') {
        const p = parseNumberAR(campos.conversion, { kind: 'percent' });
        const r = p.ok && !p.empty ? relacionDesdePct(p.value, sel['conversion-sentido'] ?? 'cobran') : null;
        e[c.key] = !p.ok || (r && !r.ok) ? INVALIDO : r ? r.relacion : null;
      } else {
        const m = conversionDesdeRelacionVieja(campos.relacion ?? '', v1);
        e[c.key] = m.relacion;
      }
      continue;
    }
    const raw = campos[c.el] ?? '';
    const p = parseNumberAR(raw, { kind: kindDe(c) });
    e[c.key] = c.costo && esNoAplica(raw) ? NO_APLICA : !p.ok ? INVALIDO : p.empty ? null : p.value;
  }
  e.otrosCostos = { monto: e.otrosCostos, cobro: cobroO };
  e.costoTransferencia = { monto: e.costoTransferencia, cobro: cobroT };
  e.impuestoFiscal = sel['impuesto-fiscal'] ?? 'pendiente';
  e.ivaFiscal = sel['iva-fiscal'] ?? 'pendiente';
  const compra = sel['mercado-compra'] ?? 'oficial';
  const venta = sel['mercado-venta'] ?? 'blue';
  e.requiereConversion = compra !== venta;
  if (compra === venta) e.relacionConversion = null;
  e.relacionHipotesis = compra !== venta && s.checks?.['relacion-hipotesis'] === true;
  return { entrada: e, compra, venta };
}

/** Cómo habría dado una simulación simple guardada con los precios de cada captura (mismos costos y monto). */
function evolucionSimple(id, lista) {
  const r = historial?.registros().find((x) => x.id === id);
  if (!r || r.tipo !== 'simple') return [];
  const { entrada, compra, venta } = entradaDesdeGuardada(r.entrada.simple);
  return lista.map((c) => {
    const base = c.mercados[compra];
    const vta = c.mercados[venta];
    if (!base?.valido || !base.venta || !vta?.valido || !vta.compra) return { at: c.at, ok: false, motivo: 'Esa captura no tiene los precios de los dos mercados.' };
    const x = calcularSimple({ ...entrada, cotizacionBase: base.venta, precioVenta: vta.compra });
    if (!x.ok) return { at: c.at, ok: false, motivo: x.datosInsuficientes ? 'DATOS INSUFICIENTES' : x.errors[0]?.message ?? 'No se pudo calcular.' };
    return { at: c.at, ok: true, roiPct: Number(x.result.roiPct.toFixed(6)), resultado: `${x.calidad.nivel === 'incompleto' ? '≤ ' : x.calidad.nivel === 'estimado' ? '≈ ' : ''}${formatARSSigned(x.result.resultadoNeto)}`, nivel: x.calidad.nivel };
  });
}

/* ---------- Mi operativa ---------- */
const esLaOperativa = () => $('#mercado-compra').value === 'blue' && $('#mercado-venta').value === 'cripto' && $('#modo-monto').value === 'ars' && $('#conversion-sentido').value === 'sobreprecio';
/** 'simple' deja la calculadora en pesos → billete (blue) → USDT (pagando X % más) → pesos; 'completa', como siempre. */
function aplicarOperativa(v, { guardar = true } = {}) {
  operativa = v === 'completa' ? 'completa' : 'simple';
  if (guardar) storage.set(KEY_OPERATIVA, operativa);
  document.body.dataset.operativa = operativa;
  if (operativa === 'simple' && !esLaOperativa()) {
    const cambiaMercado = $('#mercado-compra').value !== 'blue' || $('#mercado-venta').value !== 'cripto';
    const eraUnidades = $('#modo-monto').value !== 'ars';
    $('#mercado-compra').value = 'blue';
    $('#mercado-venta').value = 'cripto';
    $('#modo-monto').value = 'ars';
    $('#conversion-sentido').value = 'sobreprecio';
    if (eraUnidades) $('#monto').value = '1.000.000'; // el monto estaba en dólares: arranca con un millón de pesos
    if (cambiaMercado) { cambiarMercado(); return; } // recalcula
  }
  recalcular();
}

/* ---------- Ciclo ---------- */
function recalcular() {
  // Si algo cargó otra operación (historial, chat, matriz), se muestra la calculadora completa: las etiquetas simples mentirían
  if (operativa === 'simple' && !esLaOperativa()) { operativa = 'completa'; document.body.dataset.operativa = 'completa'; }
  const entrada = leerFormulario();
  actualizarPrecioFinal(entrada);
  renderResultado(calcularSimple(entrada), entrada);
  avisoOcultos();
  oportunidades?.render();
  opcionesUsdt?.render();
  guardarFormulario();
  actualizarBarra();
}

function renderTodo() {
  renderEstadoConsulta();
  renderAvisoManuales();
  renderCotizaciones();
  if ($('#calidad-cot').open) renderCalidad();
  sincronizarPrecios();
  recalcular();
  rutas?.alActualizarCotizaciones();
  exchanges?.refrescar(); // los recorridos con dólares usan estas cotizaciones
  bancos?.render(); // "se aleja mucho del oficial" depende de estas cotizaciones
  inicio?.actualizarDatos();
}

/* ---------- Modos: calculadora simple / simulador por pasos ---------- */
function cambiarModo(modo) {
  const esRutas = modo === 'rutas';
  if (esRutas) subirNivel('profesional', 'mostrarte el simulador por pasos');
  $('#tab-simple').setAttribute('aria-selected', String(!esRutas));
  $('#tab-rutas').setAttribute('aria-selected', String(esRutas));
  $('#tab-simple').tabIndex = esRutas ? -1 : 0;
  $('#tab-rutas').tabIndex = esRutas ? 0 : -1;
  $('#panel-simple').hidden = esRutas;
  $('#panel-rutas').hidden = !esRutas;
  storage.set(KEY_MODO, esRutas ? 'rutas' : 'simple');
  actualizarBarra();
}

function bindModos() {
  $('#tab-simple').addEventListener('click', () => cambiarModo('simple'));
  $('#tab-rutas').addEventListener('click', () => cambiarModo('rutas'));
  $('.tabs').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const siguiente = $('#tab-simple').getAttribute('aria-selected') === 'true' ? 'rutas' : 'simple';
    cambiarModo(siguiente);
    $(siguiente === 'rutas' ? '#tab-rutas' : '#tab-simple').focus();
  });
  $('#resultado').addEventListener('click', (ev) => {
    if (ev.target.id !== 'abrir-como-ruta') return;
    const conv = rutas.cargarDesdeSimple(leerFormulario(), $('#mercado-compra').value, $('#mercado-venta').value);
    if (!conv.ok) return;
    cambiarModo('rutas');
    irASimulacion();
  });
}

/** Hipótesis explícita: conversión sin costo (0 %), marcada como hipótesis (el resultado queda ESTIMADO, nunca "completo"). */
function probarUnoAUno() {
  if (mismoInstrumento()) return;
  $('#conversion').value = '0';
  $('#conversion-sentido').value = 'cobran';
  $('#relacion-hipotesis').checked = true;
  recalcular();
}

function cambiarMercado() {
  sim.overrideBase = false;
  sim.overrideVenta = false;
  sim.guardada = null;
  sim.exch = {};
  sincronizarPrecios();
  recalcular();
  opcionesUsdt?.alCambiarMercado(); // si ahora pasa por USDT, aparecen las opciones de los exchanges
}

/* ---------- Historial ---------- */
function avisar(msg) {
  const t = $('#toast');
  if (!t || !msg) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/** Cotización usada por la calculadora simple, con su fuente, para guardarla. */
function cotizacionUsada(id, punta, override, valor, indice) {
  const m = cot.mercados[id];
  const def = mercadoPorId(id);
  const v = valor && valor !== INVALIDO ? plain(valor) : null;
  const etiqueta = `${def.nombre} ${punta}`;
  const unidad = `ARS por 1 ${def.unidad}`;
  if (override) {
    const previa = sim.guardada?.cotizaciones?.[indice];
    if (sim.guardada?.[indice === 0 ? 'base' : 'venta'] && previa?.valor === v) return previa;
    return { etiqueta, valor: v, unidad, fuente: 'Cargado a mano en la calculadora', fecha: null, estado: null, confirmada: null };
  }
  const manual = m.origen === 'manual';
  return {
    etiqueta, valor: v, unidad,
    fuente: manual ? `Manual${m.fuenteManual ? ` · ${m.fuenteManual}` : ''}` : `${m.fuente}${m.fuenteOriginal ? ` · origen: ${m.fuenteOriginal}` : ''}`,
    fecha: manual ? m.editadoAt : m.fechaFuente, estado: estadoDe(id).estado, confirmada: null,
  };
}

function capturarSimple() {
  const entrada = leerFormulario();
  const calculo = calcularSimple(entrada);
  const c = $('#mercado-compra').value;
  const v = $('#mercado-venta').value;
  const d = datosFormulario();
  const montoTxt = $('#monto').value.trim();
  const nombre = `${mercadoPorId(c).nombre} → ${mercadoPorId(v).nombre} · ${$('#modo-monto').value === 'ars' ? `$ ${montoTxt}` : `${montoTxt} ${mercadoPorId(c).unidad}`}`;
  return {
    tipo: 'simple',
    nombre,
    // Se guarda con los precios fijos: al abrirla se ven los de ese momento, no los de hoy.
    entrada: { simple: { version: 3, campos: d.campos, selects: d.selects, checks: d.checks, overrideBase: true, overrideVenta: true } },
    cotizaciones: [
      cotizacionUsada(c, 'venta', sim.overrideBase, entrada.cotizacionBase, 0),
      cotizacionUsada(v, 'compra', sim.overrideVenta, entrada.precioVenta, 1),
    ],
    resumen: resumenDeSimple(calculo),
    plataformas: [],
    motor: calculo.result?.version ?? null,
    traza: trazaDeSimple(calculo),
  };
}

function abrirSimple(r) {
  const s = r.entrada.simple;
  for (const c of CAMPOS) document.getElementById(c.el).value = '';
  $('#conversion-sentido').value = 'cobran';
  sim.avisoConversion = null;
  const convertido = aplicarFormulario({ ...s, version: s.version ?? 1 });
  sim.overrideBase = s.overrideBase;
  sim.notaGuardada = null;
  sim.overrideVenta = s.overrideVenta;
  sim.guardada = { nombre: r.nombre, fecha: r.creadaAt, cotizaciones: r.cotizaciones, base: s.overrideBase, venta: s.overrideVenta };
  cambiarModo('simple');
  sincronizarPrecios();
  sim.notaGuardada = compararConGuardado(r, resumenDeSimple(calcularSimple(leerFormulario())));
  recalcular();
  irASimulacion();
  avisar(convertido && s.version !== 3
    ? `Abriste «${r.nombre}» (guardada con la versión anterior): los costos vacíos ahora cuentan como "No sé" y la conversión ya no se supone 1 a 1.`
    : `Abriste «${r.nombre}». Los precios son los guardados; "Usar la del mercado" trae los de hoy.${sim.avisoConversion ? ` ${sim.avisoConversion}` : ''}`);
  sim.avisoConversion = null;
}

/**
 * Si el motor actual da otro resultado que el guardado (por ejemplo, porque ahora un costo vacío es "No sé"),
 * se muestran los dos. Lo guardado nunca se modifica en silencio.
 */
function compararConGuardado(r, ahora) {
  const antes = r.resumen;
  const fmt = (s) => (s?.ok && s.resultadoNeto !== null ? (s.moneda === 'ARS' || !s.moneda ? formatARSSigned(s.resultadoNeto) : `${s.resultadoNeto} ${s.moneda}`) : s?.nivel === 'insuficiente' ? 'DATOS INSUFICIENTES' : 'sin resultado');
  const igualNumero = antes?.ok && ahora?.ok && antes.resultadoNeto !== null && ahora.resultadoNeto !== null
    && toDec(antes.resultadoNeto).round(2, 1).eq(toDec(ahora.resultadoNeto).round(2, 1));
  const igualNivel = (antes?.nivel ?? null) === null || antes.nivel === ahora?.nivel;
  if (igualNumero && igualNivel) return null;
  const motor = r.motor ? `el motor ${r.motor}` : 'el motor anterior (Brecha 2: un costo vacío contaba como 0 y la conversión se suponía 1 a 1)';
  return `Esta simulación se guardó con ${motor} y dio ${fmt(antes)}${antes?.nivel ? ` (${antes.nivel})` : ''}. Con el motor actual da ${fmt(ahora)}${ahora?.nivel ? ` (${ahora.nivel})` : ''}. Lo guardado no se modificó.`;
}

function abrirRuta(r) {
  const b = restaurarBorrador(structuredClone(r.entrada.ruta));
  let nota = '';
  if (b) {
    const { entrada } = normalizar(b);
    const ahora = resumenDeRuta(simularRuta({ ...entrada, estresPct: null }, { activosValidos: IDS_ACTIVOS, decimales: DECIMALES, nombres: NOMBRES, objetivos: false }), null);
    nota = compararConGuardado(r, ahora) ?? '';
  }
  if (!rutas.cargarBorrador(r.entrada.ruta, `Abriste «${r.nombre}» (guardada ${fecha(r.creadaAt)}). Las confirmaciones vencidas hay que renovarlas.${nota ? ` ${nota}` : ''}`)) return;
  cambiarModo('rutas');
  irASimulacion();
  avisar(`Abriste «${r.nombre}».`);
}

function bind() {
  $('#btn-actualizar').addEventListener('click', () => { actualizarCotizaciones('manual'); bancos?.actualizar(true); });
  $('#politica').addEventListener('change', (ev) => {
    const id = ev.target.dataset?.politica;
    if (id) aplicarPolitica(id, ev.target.value);
  });
  $('#politica').addEventListener('change', (ev) => {
    const k = ev.target.dataset?.cal;
    if (!k) return;
    calendario = restaurarCalendario({ ...calendario, [k]: ev.target.value.split(/[\s,;]+/).filter(Boolean) });
    storage.set(KEY_CAL, calendario);
    renderCalendario();
    renderTodo();
  });
  $('#calidad-cot').addEventListener('toggle', () => { if ($('#calidad-cot').open) renderCalidad(); });
  $('#calidad-cot').addEventListener('change', (ev) => {
    const k = ev.target.dataset?.contraste;
    if (!k) return;
    const [id, campo] = k.split('.');
    contraste = restaurarContraste({ ...contraste, [id]: { ...(contraste[id] ?? {}), [campo]: ev.target.value } });
    storage.set(KEY_CONTRASTE, contraste);
    renderTodo();
  });
  $('#politica-restablecer').addEventListener('click', () => {
    politica = restaurarPolitica(null);
    storage.set(KEY_POLITICA, politica);
    renderPolitica();
    renderTodo();
  });

  $('#form-sim').addEventListener('input', (ev) => {
    sim.notaGuardada = null;
    const id = ev.target.id;
    if (id === 'cotizacion-base') { sim.overrideBase = true; delete sim.exch.base; if (sim.guardada) sim.guardada.base = false; }
    if (id === 'precio-venta') { sim.overrideVenta = true; delete sim.exch.venta; if (sim.guardada) sim.guardada.venta = false; }
    if (id === 'conversion') delete sim.exch.conversion;
    if (id === 'cotizacion-base' || id === 'precio-venta') {
      $('#reset-base').hidden = !sim.overrideBase;
      $('#reset-venta').hidden = !sim.overrideVenta;
      $('#cotizacion-base-src').textContent = textoFuente($('#mercado-compra').value, 'venta', sim.overrideBase);
      $('#precio-venta-src').textContent = textoFuente($('#mercado-venta').value, 'compra', sim.overrideVenta);
    }
    if (ev.target.tagName === 'INPUT') recalcular();
  });
  $('#form-sim').addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (id === 'conversion-sentido') delete sim.exch.conversion;
    if (id === 'mercado-compra' || id === 'mercado-venta') cambiarMercado();
    else if (ev.target.tagName === 'SELECT' || ev.target.type === 'checkbox') recalcular();
  });
  const marcarNoAplica = (inputId) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.value = 'no aplica';
    recalcular();
  };
  $('#form-sim').addEventListener('click', (ev) => {
    const na = ev.target.closest('[data-na]');
    if (na) { marcarNoAplica(na.dataset.na); return; }
    if (ev.target.id === 'relacion-probar') probarUnoAUno();
  });
  // Acciones desde el resultado: completar lo que falta sin buscar el campo.
  $('#resultado').addEventListener('click', (ev) => {
    const na = ev.target.closest('[data-na-campo]');
    if (na) { marcarNoAplica(INPUT_DE[na.dataset.naCampo]); return; }
    const cargar = ev.target.closest('[data-cargar-campo]');
    if (cargar) {
      const el = document.getElementById(INPUT_DE[cargar.dataset.cargarCampo]);
      const nivelCampo = el?.closest('[data-desde]')?.dataset.desde;
      if (nivelCampo) subirNivel(nivelCampo, 'que puedas cargarlo');
      el?.closest('details')?.setAttribute('open', '');
      el?.focus();
      return;
    }
    if (ev.target.closest('[data-accion-simple="probar-1a1"]')) probarUnoAUno();
    if (ev.target.closest('[data-accion-simple="todos-no-aplican"]')) {
      // Declaración explícita: los costos que están en "No sé" pasan a "no aplica".
      for (const c of CAMPOS) if (c.costo && !$(`#${c.el}`).value.trim()) $(`#${c.el}`).value = 'no aplica';
      recalcular();
    }
  });
  $('#nivel-uso').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-nivel-uso]');
    if (b) aplicarNivel(b.dataset.nivelUso);
  });
  $('#aviso-ocultos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-subir-nivel]');
    if (b) aplicarNivel(b.dataset.subirNivel);
  });
  $('#form-sim').addEventListener('submit', (ev) => ev.preventDefault());
  const guardarCalleDelCampo = () => {
    const r = leerCalle($('#blue-calle-precio').value, new Date());
    if (!r.ok) { $('#blue-calle-estado').textContent = `${r.error} No se guardó.`; $('#blue-calle-precio').setAttribute('aria-invalid', 'true'); return; }
    $('#blue-calle-precio').removeAttribute('aria-invalid');
    $('#blue-calle-precio').blur();
    guardarCalle(r.calle);
    avisar(`Guardé tu blue de la calle: ${formatARS(toDec(r.calle.venta))}. Queda para las próximas veces.`);
  };
  $('#blue-calle-guardar').addEventListener('click', guardarCalleDelCampo);
  $('#blue-calle-precio').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); guardarCalleDelCampo(); } });
  $('#blue-calle-quitar').addEventListener('click', () => { guardarCalle(null); avisar('Listo: vuelve a usar el blue de DolarAPI.'); });
  $('#mas-costos').addEventListener('toggle', guardarFormulario);
  $('#reset-base').addEventListener('click', () => { sim.overrideBase = false; delete sim.exch.base; if (sim.guardada) sim.guardada.base = false; sincronizarPrecios(); recalcular(); });
  $('#reset-venta').addEventListener('click', () => { sim.overrideVenta = false; delete sim.exch.venta; if (sim.guardada) sim.guardada.venta = false; sincronizarPrecios(); recalcular(); });

  // Edición de tarjetas: se aplica al confirmar (Enter o salir del campo) para no perder el foco.
  $('#cotizaciones').addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.fuente) {
      cot = editarFuenteManual(cot, t.dataset.fuente, t.value);
      guardarCot();
      renderTodo();
      return;
    }
    if (!t.dataset.id) return;
    const p = parseNumberAR(t.value, { kind: 'money' });
    const err = document.querySelector(`[data-error="${t.dataset.id}"]`);
    if (!p.ok || (!p.empty && p.value.lte(0))) {
      err.textContent = `${mercadoPorId(t.dataset.id).nombre}: ${p.ok ? 'tiene que ser mayor que 0' : p.error}. No se guardó.`;
      err.hidden = false;
      t.setAttribute('aria-invalid', 'true');
      return;
    }
    cot = editarManual(cot, t.dataset.id, t.dataset.punta, p.empty ? null : p.value.toString());
    guardarCot();
    renderTodo();
  });
  $('#cotizaciones').addEventListener('click', (ev) => {
    const id = ev.target.dataset?.volver;
    if (!id) return;
    cot = volverAAPI(cot, id);
    guardarCot();
    renderTodo();
  });
  $('#aviso-manuales').addEventListener('click', (ev) => {
    if (ev.target.id === 'reemplazar-manuales') {
      for (const id of cot.ultimaConsulta.conservados) if (cot.mercados[id].origen === 'manual') cot = volverAAPI(cot, id);
      cot.ultimaConsulta.conservados = [];
    } else if (ev.target.id === 'cerrar-aviso') {
      cot.ultimaConsulta.conservados = [];
    } else return;
    guardarCot();
    renderTodo();
  });
}

/* ---------- Chat y exchanges → calculadora ---------- */
/**
 * Carga en la calculadora la operación que el chat entendió ("consigo el oficial a 1535 y paso a USDT al 2 %…")
 * o una combinación de la sección de exchanges (con `costos`: comisiones que ya están en el precio y retiro de USDT).
 */
function abrirEscenarioEnCalculadora(a) {
  if (!a || a.tipo !== 'calculadora' || !mercadoPorId(a.compra) || !mercadoPorId(a.venta)) return;
  $('#mercado-compra').value = a.compra;
  $('#mercado-venta').value = a.venta;
  cambiarMercado();
  $('#modo-monto').value = a.modo === 'ars' ? 'ars' : 'unidades';
  $('#monto').value = a.monto;
  $('#cotizacion-base').value = a.base;
  sim.overrideBase = true;
  $('#aumento').value = '';
  $('#precio-venta').value = a.precioVenta;
  sim.overrideVenta = true;
  $('#conversion').value = a.conversionPct;
  $('#conversion-sentido').value = Object.hasOwn(SENTIDOS_CONVERSION, a.sentido) ? a.sentido : 'cobran';
  $('#relacion-hipotesis').checked = false;
  sim.exch = exchRestaurado(a.exch);
  const k = a.costos && typeof a.costos === 'object' ? a.costos : null;
  if (k) {
    // Sólo lo que la combinación sabe (números ya escritos en formato argentino); lo demás queda como estaba (vacío = «No sé»).
    const poner = (id, v) => { if (typeof v === 'string' && v.length <= 60) $(`#${id}`).value = v; };
    poner('com-compra', k.comCompra);
    poner('com-venta', k.comVenta);
    if (Object.hasOwn(COBROS_FIJOS, k.transfCobro)) $('#transf-cobro').value = k.transfCobro;
    $('#transf').value = typeof k.transf === 'string' && k.transf.length <= 60 ? k.transf : '';
  }
  cambiarModo('simple');
  sincronizarPrecios();
  recalcular();
  irASimulacion();
  if (a.origen === 'exchanges') {
    avisar(`Cargué la combinación de los exchanges.${k?.comCompra === 'no aplica' || k?.comVenta === 'no aplica' ? ' Las comisiones del exchange ya están en el precio.' : ''}${k?.transf && !esNoAplica(k.transf) ? ' El retiro de USDT quedó en «Costo de transferencia».' : ''} Impuestos y demás costos: cargalos acá.`);
    return;
  }
  const conCostos = CAMPOS.some((c) => c.costo && document.getElementById(c.el).value.trim() !== '');
  avisar(conCostos
    ? 'Cargué tu operación del chat. Dejé las comisiones que ya tenías en la calculadora: por eso el número puede ser distinto al del chat.'
    : 'Cargué tu operación del chat. Las comisiones están en «No sé»: cargalas acá para ver el resultado real.');
}

/* ---------- Opciones de exchange en la calculadora ---------- */
/** Precio equivalente de lo cargado en la conversión (dólares por USDT), para compararlo con los exchanges. */
function conversionComoPrecio() {
  const p = parseNumberAR($('#conversion').value, { kind: 'percent' });
  if (!p.ok || p.empty) return null;
  const r = relacionDesdePct(p.value, $('#conversion-sentido').value);
  if (!r.ok || !r.relacion.gt(0)) return null;
  return $('#mercado-venta').value === 'cripto' ? toDec(1).div(r.relacion) : r.relacion;
}
function contextoOpciones() {
  const leer = (id) => { const p = parseNumberAR($(`#${id}`).value, { kind: 'money' }); return p.ok && !p.empty ? p.value : null; };
  return {
    compra: $('#mercado-compra').value, venta: $('#mercado-venta').value,
    actual: { base: leer('cotizacion-base'), venta: leer('precio-venta'), conversion: conversionComoPrecio() },
    elegidos: sim.exch, transf: $('#transf').value.trim(), transfCobro: $('#transf-cobro').value,
  };
}
/** «Usar» una opción: pone ese precio (o ese % de conversión) y avisa qué hizo con la comisión. */
function usarOpcion(x) {
  const valor = formatNumberAR(x.precio, { decimals: 12, minDecimals: 0 });
  const elegido = { id: x.id, nombre: x.nombre, at: x.at, conComisiones: x.conComisiones, banco: x.fuente === 'bancos', manual: x.manual === true };
  let comision = '';
  const comisionEnPrecio = (campo, nombre) => {
    if (!x.conComisiones) return;
    const el = $(`#${campo}`);
    if (!el.value.trim()) { el.value = 'no aplica'; comision = ` La ${nombre} quedó «no aplica»: ya está en el precio.`; }
    else if (!esNoAplica(el.value)) comision = ` Ojo: tenés cargada una ${nombre}; si es la del exchange, ponela en «no aplica» para no cobrarla dos veces (ya está en el precio).`;
  };
  if (x.clave === 'base') {
    $('#cotizacion-base').value = valor;
    sim.overrideBase = true;
    if (sim.guardada) sim.guardada.base = false;
    comisionEnPrecio('com-compra', 'comisión de compra');
  } else if (x.clave === 'venta') {
    $('#precio-venta').value = valor;
    sim.overrideVenta = true;
    if (sim.guardada) sim.guardada.venta = false;
    comisionEnPrecio('com-venta', 'comisión de venta');
  } else {
    const c = x.lado === 'compra' ? conversionComprando(x.precio) : conversionVendiendo(x.precio);
    $('#conversion-sentido').value = c.sentido;
    $('#conversion').value = formatNumberAR(toDec(c.pct), { decimals: 12, minDecimals: 0 });
    $('#relacion-hipotesis').checked = false;
  }
  sim.exch[x.clave] = elegido;
  sincronizarPrecios();
  recalcular();
  const que = x.fuente === 'bancos'
    ? `Usé ${x.lado === 'compra' ? 'la venta' : 'la compra'} de ${x.nombre}: $ ${formatNumberAR(x.precio, { decimals: 2, minDecimals: 2 })}${x.manual ? ' (la cargaste vos)' : ''}.`
    : x.clave === 'conversion'
    ? `Usé ${x.nombre} para pasar ${x.lado === 'compra' ? 'tus dólares a USDT' : 'tus USDT a dólares'} (US$ ${formatNumberAR(x.precio, { decimals: 4, minDecimals: 2 })} por USDT).`
    : `Usé el precio de ${x.nombre}: $ ${formatNumberAR(x.precio, { decimals: 4, minDecimals: 2 })}.`;
  avisar(`${que}${comision}`);
}
/** Desde el chat («galicia 1535» → «Usarla en la calculadora»): comprás el oficial a la venta de Galicia. */
function usarGaliciaEnCalculadora() {
  const f = bancos?.datosOpciones().filas.find((x) => x.id === 'galicia');
  if (!f || !f.usarCompra) { avisar('Galicia no está cargada o se aleja mucho del oficial: revisala en Cotizaciones.'); return; }
  if ($('#mercado-compra').value !== 'oficial') { $('#mercado-compra').value = 'oficial'; cambiarMercado(); }
  cambiarModo('simple');
  usarOpcion({ clave: 'base', fuente: 'bancos', lado: 'compra', fiat: 'ARS', id: 'galicia', nombre: f.nombre, precio: f.compra, at: f.fecha, manual: f.origen === 'manual', conComisiones: false });
  irASimulacion();
}
function cargarRetiro({ valor, cobro }) {
  if (!Object.hasOwn(COBROS_FIJOS, cobro) || typeof valor !== 'string' || valor.length > 40) return;
  $('#transf-cobro').value = cobro;
  $('#transf').value = valor;
  recalcular();
  avisar(`Cargué ${valor} USDT en «Costo de transferencia» (lo que cuesta pasar los USDT de un exchange al otro).`);
}

/* ---------- Herramientas para Claude (chat): leen los datos de la app y calculan con el motor ---------- */
function herramientasParaClaude() {
  const n = (x) => (x === null || x === undefined ? null : Number(plain(toDec(x))));
  const numero = (x, nombre) => { const d = toDec(String(x)); if (!d.gt(0)) throw new Error(`${nombre} tiene que ser mayor que 0.`); return d; };
  return [
    {
      name: 'cotizaciones_de_hoy',
      description: 'Cotizaciones actuales que tiene Brecha: oficial, blue, MEP, CCL y cripto (DolarAPI) con compra, venta, fecha y si está antigua, el dólar en bancos (Nación automático; Galicia sólo si el usuario la cargó a mano) y el blue de la calle que cargó el usuario (el precio real al que consigue el billete; si está, usalo en vez del blue de DolarAPI). "venta" es lo que paga el usuario al comprar; "compra" es lo que le pagan al vender.',
      input_schema: { type: 'object', properties: {} },
      run() {
        const mercados = Object.fromEntries(IDS_MERCADOS.map((id) => { const m = cot.mercados[id]; const e = estadoDe(id); return [id, m ? { compra: n(m.compra), venta: n(m.venta), fecha: m.fechaFuente ?? m.editadoAt ?? null, origen: m.origen ?? 'api', estado: e.estado } : null]; }));
        const b = bancos?.datosOpciones().filas.map((x) => ({ banco: x.nombre, venta_lo_que_pagas: n(x.compra), compra_lo_que_te_pagan: n(x.venta), origen: x.origen, fecha: x.fecha, aviso: x.motivos.join('; ') || null })) ?? [];
        return { mercados, bancos: b, blue_de_la_calle: calle ? { venta_lo_que_paga: n(calle.venta), cargado: calle.at } : null, consultado: cot.ultimaConsulta?.at ?? null };
      },
    },
    {
      name: 'precios_usdt_en_exchanges',
      description: 'A cuánto se vende y se compra el USDT por pesos en los exchanges argentinos ahora (CriptoYa, con comisiones): los 8 que más pagan al vender y los 8 más baratos para comprar. Los que terminan en P2P son avisos de particulares.',
      input_schema: { type: 'object', properties: {} },
      async run() {
        const d = await exchanges.datos();
        if (!d) return { error: 'No pude traer los precios de los exchanges ahora.' };
        const pr = prepararPrecios(d.ars, { at: d.at });
        const lista = (lado) => opcionesLado(pr, lado).opciones.slice(0, 8).map((x) => ({ exchange: x.nombre, precio: n(x.precio), p2p: x.p2p }));
        return { recibido: d.at, para_vender_usdt: lista('venta'), para_comprar_usdt: lista('compra') };
      },
    },
    {
      name: 'calcular_operativa',
      description: 'Cuenta exacta de la operativa pesos → dólar billete → USDT → pesos. pct_usdt es cuánto más caro sale cada USDT en dólares (2 = cada USDT cuesta 1,02 USD). Devuelve dólares comprados, USDT recibidos, pesos cobrados, ganancia o pérdida y a qué precio de venta queda hecho. No incluye comisiones ni impuestos salvo comision_venta_pct.',
      input_schema: { type: 'object', properties: { pesos: { type: 'number' }, precio_dolar: { type: 'number', description: 'pesos por dólar al comprar' }, pct_usdt: { type: 'number', description: '% arriba del dólar que cuesta cada USDT (0 = 1 a 1)' }, precio_venta_usdt: { type: 'number', description: 'pesos por USDT al vender' }, comision_venta_pct: { type: 'number' } }, required: ['pesos', 'precio_dolar', 'pct_usdt', 'precio_venta_usdt'] },
      run(i) {
        const pesos = numero(i.pesos, 'pesos'); const pd = numero(i.precio_dolar, 'precio_dolar'); const pv = numero(i.precio_venta_usdt, 'precio_venta_usdt');
        const rel = relacionDesdePct(String(i.pct_usdt), 'sobreprecio');
        if (!rel.ok) throw new Error(rel.error);
        const com = i.comision_venta_pct === undefined ? toDec(0) : toDec(String(i.comision_venta_pct));
        const usd = pesos.div(pd); const usdt = usd.times(rel.relacion);
        const cobrado = usdt.times(pv).times(toDec(1).minus(com.div(100)));
        const res = cobrado.minus(pesos);
        const r2 = (x) => Number(plain(x.round(2)));
        return { dolares_comprados: r2(usd), usdt_recibidos: r2(usdt), costo_de_cada_usdt_en_pesos: r2(pd.div(rel.relacion)), pesos_cobrados: r2(cobrado), resultado_en_pesos: r2(res), resultado_pct: r2(res.div(pesos).times(100)), precio_de_venta_para_no_perder: r2(pesos.div(usdt).div(toDec(1).minus(com.div(100)))) };
      },
    },
    {
      name: 'cargar_en_la_calculadora',
      description: 'Deja cargada la operativa en la pantalla Calcular de la app para que el usuario la vea y la ajuste. Usala sólo si el usuario lo pide.',
      input_schema: { type: 'object', properties: { pesos: { type: 'number' }, precio_dolar: { type: 'number' }, pct_usdt: { type: 'number' }, precio_venta_usdt: { type: 'number' } }, required: ['pesos', 'precio_dolar', 'pct_usdt', 'precio_venta_usdt'] },
      run(i) {
        const f = (x, nombre) => formatNumberAR(numero(x, nombre), { decimals: 6, minDecimals: 0 });
        const pct = toDec(String(i.pct_usdt));
        if (pct.lt(0) || pct.gt(100)) throw new Error('pct_usdt tiene que estar entre 0 y 100.');
        abrirEscenarioEnCalculadora({ tipo: 'calculadora', compra: 'oficial', venta: 'cripto', modo: 'ars', monto: f(i.pesos, 'pesos'), base: f(i.precio_dolar, 'precio_dolar'), precioVenta: f(i.precio_venta_usdt, 'precio_venta_usdt'), conversionPct: formatNumberAR(pct, { decimals: 6, minDecimals: 0 }), sentido: 'sobreprecio' });
        return { ok: true, nota: 'Quedó cargada en la pestaña Calcular.' };
      },
    },
    {
      name: 'guardar_cotizacion_galicia',
      description: 'Guarda la cotización del dólar en Banco Galicia que dicta el usuario (Galicia no se puede traer sola). venta = lo que paga por dólar (obligatoria); compra = lo que le pagan (opcional).',
      input_schema: { type: 'object', properties: { venta: { type: 'number' }, compra: { type: 'number' } }, required: ['venta'] },
      run(i) {
        const r = bancos.guardarManual('galicia', { venta: formatNumberAR(numero(i.venta, 'venta'), { decimals: 4, minDecimals: 0 }), compra: i.compra === undefined ? '' : formatNumberAR(numero(i.compra, 'compra'), { decimals: 4, minDecimals: 0 }) });
        if (!r.ok) throw new Error(r.error);
        return { ok: true, venta: n(r.fila.venta), compra: n(r.fila.compra), aviso: r.fila.motivos.join('; ') || null };
      },
    },
    {
      name: 'guardar_blue_calle',
      description: 'Guarda el precio del blue de la calle que dice el usuario (lo que paga por cada dólar billete). Queda guardado y la calculadora lo usa en vez del blue de DolarAPI. Para volver al de DolarAPI, venta = 0.',
      input_schema: { type: 'object', properties: { venta: { type: 'number', description: 'pesos por dólar billete; 0 para borrar el guardado' } }, required: ['venta'] },
      run(i) {
        if (Number(i.venta) === 0) { guardarCalle(null); return { ok: true, borrado: true, blue_dolarapi: n(precioMercado('blue', 'venta')) }; }
        const r = leerCalle(formatNumberAR(numero(i.venta, 'venta'), { decimals: 4, minDecimals: 0 }), new Date());
        if (!r.ok) throw new Error(r.error);
        guardarCalle(r.calle);
        return { ok: true, venta: n(r.calle.venta), blue_dolarapi: n(precioMercado('blue', 'venta')), aviso: avisoCalle(r.calle, precioMercado('blue', 'venta')) };
      },
    },
  ];
}

/* ---------- Inicio: números en vivo ---------- */
function resumenInicio() {
  const v = (id) => precioMercado(id, 'venta');
  const pesos = (x) => `$ ${formatNumberAR(x, { decimals: 2, minDecimals: 0 })}`;
  const filas = [['Oficial', 'oficial'], ['Blue', 'blue'], ['MEP', 'mep'], ['Cripto', 'cripto']].filter(([, id]) => v(id)).map(([nombre, id]) => ({ nombre, valor: pesos(v(id)) }));
  if (v('oficial') && v('cripto')) filas.push({ nombre: 'Brecha cripto', valor: formatPct(toDec(v('cripto')).div(toDec(v('oficial'))).minus(1).times(100)), clase: 'brecha' });
  return filas;
}

/* ---------- Matriz → simuladores ---------- */
function irASimulacion() {
  mostrarSeccion('sec-simulacion');
  $('#h-sim').scrollIntoView({ behavior: PLATAFORMA === 'celular' ? 'auto' : 'smooth', block: 'start' });
}

/* ---------- Versión celular: una sección a la vez, con pestañas abajo ---------- */
function mostrarSeccion(id) {
  if (!porPestanas()) return;
  let s = SECCIONES.includes(id) ? id : 'sec-simulacion';
  if (s === 'oportunidades' && rangoNivel(nivelUso) < 1) s = 'sec-simulacion'; // la matriz es del nivel Avanzado
  const cambio = document.body.dataset.seccion !== s;
  document.body.dataset.seccion = s;
  for (const b of document.querySelectorAll('#pestanas [data-seccion]')) {
    if (b.dataset.seccion === s) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (s === 'sec-inicio') storage.set(KEY_INICIO_VISTO, true); else storage.set(KEY_SECCION, s); // Inicio nunca queda como "última pestaña"
  if (cambio) window.scrollTo(0, 0);
  if (s === 'sec-inicio') inicio?.mostrar(); else inicio?.ocultar();
  if (s === 'sec-cotizaciones' && $('#calidad-cot').open) renderCalidad();
  actualizarBarra();
}
/** Última pestaña de trabajo (para «Saltar»). */
const ultimaSeccion = () => { const g = storage.get(KEY_SECCION); return SECCIONES.includes(g) && g !== 'sec-inicio' ? g : 'sec-simulacion'; };
/** Compu: por pestañas o todo junto. */
function aplicarVista(v, { inicial = null } = {}) {
  vista = PLATAFORMA === 'celular' || v !== 'todo' ? 'pestanas' : 'todo';
  if (PLATAFORMA === 'web') storage.set(KEY_VISTA, vista);
  document.documentElement.classList.toggle('por-pestanas', porPestanas());
  const b = $('#btn-vista');
  b.textContent = vista === 'todo' ? 'Ver por pestañas' : 'Ver todo junto';
  b.setAttribute('aria-pressed', String(vista === 'todo'));
  if (porPestanas()) {
    const actual = document.body.dataset.seccion;
    mostrarSeccion(inicial ?? (SECCIONES.includes(actual) ? actual : ultimaSeccion()));
  } else inicio?.ocultar();
  actualizarBarra();
}
function bindPestanas() {
  $('#pestanas').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-seccion]');
    if (b) mostrarSeccion(b.dataset.seccion);
  });
  // Botones que llevan a una pestaña (Inicio, «Saltar», las partes de la presentación)
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ir]');
    if (!b) return;
    const destino = b.dataset.ir === 'ultima' ? ultimaSeccion() : b.dataset.ir;
    if (!SECCIONES.includes(destino)) return;
    if (!porPestanas()) aplicarVista('pestanas');
    mostrarSeccion(destino);
  });
  $('#btn-vista').addEventListener('click', () => aplicarVista(vista === 'todo' ? 'pestanas' : 'todo'));
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ir-operativa]');
    if (b) aplicarOperativa(b.dataset.irOperativa);
  });
  // Link a la otra versión (celular ↔ compu), relativo a la raíz de la app
  const otra = document.documentElement.dataset.otra;
  for (const a of document.querySelectorAll('[data-otra-version]')) {
    if (!otra) { a.hidden = true; continue; }
    a.href = otra;
    if (a.id === 'otra-version') { a.textContent = PLATAFORMA === 'celular' ? 'Abrir la versión para compu' : 'Abrir la versión celular'; a.hidden = false; }
  }
  // La primera vez, la presentación; después, la última pestaña de trabajo
  aplicarVista(vista, { inicial: storage.get(KEY_INICIO_VISTO) ? ultimaSeccion() : 'sec-inicio' });
}
/** Publicada (https): un service worker guarda la app para abrirla sin internet. En la compu local no se usa. */
function registrarSinConexion() {
  if (location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => { /* sin service worker la app anda igual */ });
}
function elegirSimple(c, v) {
  $('#mercado-compra').value = c;
  $('#mercado-venta').value = v;
  cambiarModo('simple');
  cambiarMercado();
  irASimulacion();
}
function elegirRuta(entrada, notas, titulo) {
  rutas.cargarEntrada(entrada, { notas, mensaje: `Abriste ${titulo} desde el resultado neto.`, fuente: 'Desde el resultado neto (cotización de referencia)' });
  cambiarModo('rutas');
  irASimulacion();
}

/* ---------- Barra de resultado en celular ---------- */
const visibles = { resultado: false, 'ruta-resultado': false };
function resultadoActivo() {
  return $('#panel-rutas').hidden ? $('#resultado') : $('#ruta-resultado');
}
function actualizarBarra() {
  const barra = $('#barra-resultado');
  if (!barra) return;
  const res = resultadoActivo();
  const angosto = PLATAFORMA === 'celular' || window.matchMedia('(max-width: 860px)').matches;
  const fueraDeCalcular = porPestanas() && document.body.dataset.seccion && document.body.dataset.seccion !== 'sec-simulacion';
  const nivel = res.dataset.nivel;
  const tituloEl = res.querySelector('.headline .res-title')?.cloneNode(true);
  tituloEl?.querySelectorAll('.badge').forEach((b) => b.remove());
  const titulo = tituloEl ? tituloEl.textContent.trim() : '';
  const numero = res.querySelector('.headline .big')?.textContent.replace(/\s+/g, ' ').trim();
  const roi = res.querySelector('.headline .roi')?.textContent.replace(/\s+/g, ' ').trim();
  const etiqueta = { incompleto: 'INCOMPLETO', estimado: 'ESTIMADO' }[nivel];
  $('#barra-texto').textContent = numero
    ? `${etiqueta ? `${etiqueta} · ` : ''}${titulo}: ${numero}${roi ? ` · ${roi}` : ''}`
    : nivel === 'insuficiente' ? 'DATOS INSUFICIENTES: falta un dato para calcular' : 'Faltan datos para calcular';
  const tono = res.querySelector('.headline')?.classList;
  barra.dataset.tono = tono?.contains('pos') ? 'pos' : tono?.contains('neg') ? 'neg' : 'neu';
  // Con el teclado del celular abierto, la barra se esconde para no tapar el campo que estás escribiendo.
  barra.hidden = !angosto || fueraDeCalcular || visibles[res.id] || document.body.classList.contains('editando');
  document.body.classList.toggle('con-barra', !barra.hidden);
}

/** ¿Se está escribiendo en un campo? (en celular, eso abre el teclado virtual) */
function bindTeclado() {
  const esCampo = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'button';
  document.addEventListener('focusin', (ev) => {
    if (!esCampo(ev.target)) return;
    document.body.classList.add('editando');
    actualizarBarra();
  });
  document.addEventListener('focusout', () => {
    // Se espera un instante: el foco puede estar pasando a otro campo.
    setTimeout(() => {
      if (esCampo(document.activeElement)) return;
      document.body.classList.remove('editando');
      actualizarBarra();
    }, 120);
  });
  window.visualViewport?.addEventListener('resize', () => {
    const teclado = window.visualViewport.height < window.innerHeight * 0.75;
    document.body.classList.toggle('editando', teclado || esCampo(document.activeElement));
    actualizarBarra();
  });
}
function bindBarra() {
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) visibles[e.target.id] = e.isIntersecting;
      actualizarBarra();
    }, { threshold: 0.15 });
    obs.observe($('#resultado'));
    obs.observe($('#ruta-resultado'));
  }
  window.addEventListener('resize', actualizarBarra);
  $('#barra-ver').addEventListener('click', () => resultadoActivo().scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/* ---------- Niveles de uso: Rápido / Avanzado / Profesional ---------- */
/** Nivel guardado; si no hay, un usuario que ya usaba Brecha arranca en Profesional (no le desaparece nada). */
function nivelInicial() {
  const g = storage.get(KEY_NIVEL);
  if (NIVELES_USO.includes(g)) return g;
  try {
    // Haber visto la presentación o elegir cómo se ve la compu no es "haber usado Brecha"
    const deVista = new Set([KEY_INICIO_VISTO, KEY_VISTA, KEY_OPERATIVA]);
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('brecha.') && !deVista.has(k)) return 'profesional'; }
  } catch { /* sin almacenamiento */ }
  return 'rapido';
}
function aplicarNivel(n) {
  nivelUso = NIVELES_USO.includes(n) ? n : 'profesional';
  document.body.dataset.uso = nivelUso;
  storage.set(KEY_NIVEL, nivelUso);
  for (const b of document.querySelectorAll('#nivel-uso [data-nivel-uso]')) b.setAttribute('aria-pressed', String(b.dataset.nivelUso === nivelUso));
  $('#nivel-desc').textContent = NIVEL_UI[nivelUso].d;
  if (porPestanas() && nivelUso === 'rapido' && document.body.dataset.seccion === 'oportunidades') mostrarSeccion('sec-simulacion');
  if (rangoNivel(nivelUso) < 2) {
    if (!$('#panel-rutas').hidden) cambiarModo('simple');
    if ($('[data-vista="ranking"]')?.getAttribute('aria-pressed') === 'true') $('[data-vista="bruta"]').click();
  }
  avisoOcultos();
  actualizarBarra();
}
/** Sube al nivel que hace falta para lo que pediste (nunca baja). */
function subirNivel(minimo, para) {
  if (rangoNivel(nivelUso) >= rangoNivel(minimo)) return;
  aplicarNivel(minimo);
  avisar(`Pasé al nivel ${NIVEL_UI[minimo].t} para ${para}.`);
}
/** En Rápido: si hay datos cargados en campos que no se ven, se avisa (se siguen usando en el cálculo). */
function avisoOcultos() {
  const box = $('#aviso-ocultos');
  if (!box) return;
  const ocultos = rangoNivel(nivelUso) === 0
    ? [...$('#form-sim').querySelectorAll('[data-desde] input[type="text"]')].filter((i) => i.value.trim() !== '') : [];
  box.hidden = !ocultos.length;
  if (!ocultos.length) { box.innerHTML = ''; return; }
  const nombres = ocultos.map((i) => document.querySelector(`label[for="${i.id}"]`)?.childNodes[0]?.textContent.trim() || i.id);
  box.innerHTML = `<p>Hay ${ocultos.length === 1 ? '1 dato cargado' : `${ocultos.length} datos cargados`} en campos que el nivel Rápido no muestra (${esc(nombres.join(', '))}): se siguen usando en el cálculo.</p>
    <div class="banner-actions"><button type="button" class="btn small" data-subir-nivel="avanzado">Mostrarlos (nivel Avanzado)</button></div>`;
}

/* ---------- Tema ---------- */
const TEMAS = { auto: { t: 'Auto', a: 'automático' }, light: { t: 'Claro', a: 'claro' }, dark: { t: 'Oscuro', a: 'oscuro' } };
function aplicarTema(tema) {
  const t = Object.hasOwn(TEMAS, tema) ? tema : 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const b = $('#btn-tema');
  b.textContent = `◐ ${TEMAS[t].t}`;
  b.setAttribute('aria-label', `Tema: ${TEMAS[t].a}. Cambiar tema`);
  b.dataset.tema = t;
  storage.set(KEY_TEMA, t);
}
function bindTema() {
  aplicarTema(storage.get(KEY_TEMA));
  $('#btn-tema').addEventListener('click', () => {
    const orden = ['auto', 'light', 'dark'];
    aplicarTema(orden[(orden.indexOf($('#btn-tema').dataset.tema) + 1) % orden.length]);
  });
}

function init() {
  const nivel = nivelInicial(); // antes de que se guarde cualquier otra cosa
  bindTema();
  analisis = crearAnalisis({ storage, fecha, getCal: () => calendario });
  llenarSelects();
  restaurarFormulario();
  bind();
  const plataformas = crearPlataformas({ root: $('#plataformas-campos'), storage, onCambio: () => rutas?.render() });
  rutas = crearSimuladorRutas({
    getPlataformas: () => plataformas.lista(),
    editor: $('#ruta-editor'),
    resultado: $('#ruta-resultado'),
    getMercados: () => mercadosUsables(),
    estadoMercado: (id) => estadoDe(id),
    analisis,
    storage,
    fecha,
    hace,
    onCambio: () => {
      oportunidades?.render();
      actualizarBarra();
    },
    accionesResultado: () => historial?.botones('ruta') ?? '',
  });
  historial = crearHistorial({
    root: $('#historial'),
    storage,
    fecha,
    capturar: { simple: capturarSimple, ruta: () => rutas.capturar() },
    onAbrir: (r) => (r.tipo === 'simple' ? abrirSimple(r) : abrirRuta(r)),
    onActivo: () => { recalcular(); rutas.refrescar(); },
    avisar,
  });
  document.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-guardar], [data-actualizar]');
    if (!g) return;
    historial.guardar(g.dataset.guardar ?? g.dataset.actualizar, !!g.dataset.actualizar);
  });
  oportunidades = crearOportunidades({
    root: $('#oportunidades'),
    getMercados: () => mercadosUsables(),
    estadoDe,
    storage,
    getSeleccion: () => `${$('#mercado-compra').value}>${$('#mercado-venta').value}`,
    onElegirSimple: elegirSimple,
    onElegirRuta: elegirRuta,
    onIrARuta: () => { cambiarModo('rutas'); irASimulacion(); },
    getRutaResumen: () => rutas.resumen(),
  });
  capturas = crearCapturas({
    root: $('#capturas-campos'), storage, getMercados: () => cot.mercados, fecha, avisar,
    getSimulaciones: () => historial.registros(), evolucion: evolucionSimple,
  });
  analisis.enlazar($('#resultado'), 'simple', datosAnalisisSimple);
  crearChat({
    root: $('#chat'), storage,
    precioDeHoy: (id, punta) => { const v = precioMercado(id, punta); return v ? { valor: v, texto: textoFuente(id, punta, false) } : null; },
    onAbrirCalculadora: (a) => (a?.tipo === 'galicia' ? usarGaliciaEnCalculadora() : abrirEscenarioEnCalculadora(a)),
    bancos: { guardarManual: (id, v) => bancos.guardarManual(id, v), fila: (id) => bancos.fila(id), referencia: () => bancos.referencia() },
    herramientasClaude: herramientasParaClaude(),
    exchanges: { datos: () => exchanges?.datos() ?? Promise.resolve(null), preferencias: () => exchanges?.preferencias() ?? {} },
  });
  bancos = crearBancos({
    root: $('#bancos'), storage, avisar,
    referencia: () => ({ compra: precioMercado('oficial', 'compra'), venta: precioMercado('oficial', 'venta') }),
  });
  exchanges = crearExchanges({
    root: $('#exchanges'), seccion: $('#sec-exchanges'), storage,
    precioDolar: (id, punta) => { const v = precioMercado(id, punta); return v ? { valor: v, texto: textoFuente(id, punta, false) } : null; },
    onAbrirCalculadora: abrirEscenarioEnCalculadora,
  });
  opcionesUsdt = crearOpcionesUsdt({
    cont: { base: $('#opc-base'), venta: $('#opc-venta'), conversion: $('#opc-conversion') },
    exchanges, bancos, getContexto: contextoOpciones, onUsar: usarOpcion, onCargarRetiro: cargarRetiro,
    onIrAManual: () => { mostrarSeccion('sec-cotizaciones'); bancos.enfocarManual(); },
  });
  exchanges.alCambiar(() => opcionesUsdt.render());
  bancos.alCambiar(() => opcionesUsdt.render());
  crearBonos({
    root: $('#bonos-campos'), storage, avisar,
    getReferencia: (mercado, punta) => precioMercado(mercado, punta),
    aplicarSimple: (d) => {
      const tc = formatNumberAR(d.tc, { decimals: 12, minDecimals: 0 });
      if (d.sentido === 'comprar_usd') {
        $('#mercado-compra').value = d.mercado;
        cambiarMercado();
        $('#cotizacion-base').value = tc;
        sim.overrideBase = true;
        for (const id of ['com-compra', 'impuesto']) $(`#${id}`).value = 'no aplica';
      } else {
        $('#mercado-venta').value = d.mercado;
        cambiarMercado();
        $('#precio-venta').value = tc;
        sim.overrideVenta = true;
        $('#com-venta').value = 'no aplica';
      }
      cambiarModo('simple');
      sincronizarPrecios();
      recalcular();
      irASimulacion();
      avisar(`${d.detalle}. Los costos de ese lado quedaron como «no aplica» para no cobrarlos dos veces.${d.incompleto ? ' Ojo: el cálculo con bonos tenía costos en «No sé».' : ''}`);
    },
    aplicarRuta: (d) => rutas.aplicarBonos(d),
  });
  inicio = crearInicio({
    root: $('#sec-inicio'), plataforma: PLATAFORMA, getResumen: resumenInicio,
    alturaArriba: () => (PLATAFORMA === 'web' && porPestanas() ? $('#pestanas').offsetHeight : 0),
  });
  bindModos();
  bindBarra();
  aplicarOperativa(storage.get(KEY_OPERATIVA) === 'completa' ? 'completa' : 'simple', { guardar: false });
  aplicarNivel(nivel);
  bindPestanas();
  cambiarModo(storage.get(KEY_MODO) === 'rutas' && nivel === 'profesional' ? 'rutas' : 'simple');
  renderPolitica();
  renderTodo();
  bindTeclado();
  actualizarCotizaciones('auto');
  bancos.actualizar(false); // Nación (CriptoYa); usa la copia si tiene menos de 15 min
  opcionesUsdt.alCambiarMercado(); // si la operación guardada pasa por USDT, trae los precios de los exchanges
  if (sim.avisoMigracion) avisar(sim.avisoMigracion);
  else if (sim.avisoConversion) avisar(sim.avisoConversion);
  setInterval(refrescarEdades, 60000);
  registrarSinConexion();
  // Italiana (la letra de los títulos, en Inicio y en la app): se baja cuando la página ya cargó, para no frenarla.
  // Mientras tanto (o sin internet) se usa una serif del sistema.
  const fuentes = () => {
    if (document.querySelector('link[data-fuentes-inicio]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Italiana&display=swap';
    l.dataset.fuentesInicio = '';
    document.head.append(l);
  };
  if (document.readyState === 'complete') fuentes(); else window.addEventListener('load', fuentes, { once: true });
  window.brechaLista = true; // arrancó: los errores posteriores ya no son "no pudo arrancar" (ver index.html)
}

init();

// Para depurar desde la consola (no se usa en la app).
window.__brecha = { get estado() { return cot; }, reset: () => { cot = estadoInicial(); guardarCot(); renderTodo(); }, manuales: () => manuales(cot) };
