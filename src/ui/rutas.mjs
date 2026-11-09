// Simulador por pasos: editor de la ruta y su resultado. La matemática está en src/engine/route.mjs.
// Regla: lo que no sabés queda como "No sé" y el resultado se muestra como cota máxima; lo que falta
// para calcular se muestra como DATOS INSUFICIENTES. "Confirmada por vos" nunca es garantía de ejecución.
import { simularRuta, evaluarRuta, MAX_PASOS, MAX_COSTOS, MAX_NIVELES_LIBRO } from '../engine/route.mjs';
import { parseNumberAR, formatNumberAR, formatPct } from '../engine/format.mjs';
import { plain, toDec, ONE } from '../engine/decimal.mjs';
import { esNoAplica } from '../engine/costos.mjs';
import { ACTIVOS, IDS_ACTIVOS, activoPorId, corto } from '../routes/activos.mjs';
import {
  PLANTILLAS, TIPOS_CONDICION, INVALIDO, crearBorrador, pasoNuevo, desdeDe, normalizar, etiquetaBase, kindCotizacion, kindMonto,
  nuevaCondicion, nuevoCosto, PRESETS_COSTO, reiniciarPar, aplicarReferencia, restaurarBorrador, borradorDesdeEntrada, mostrar,
  MAX_CONDICIONES, LARGOS, DECIMALES, NOMBRES,
} from '../routes/borrador.mjs';
import { referenciaPaso } from '../routes/referencias.mjs';
import { rutaDesdeSimple } from '../routes/desde-simple.mjs';
import { VIGENCIA_COTIZACION_HORAS, VIGENCIA_CONDICION_DIAS } from '../routes/config.mjs';
import { aplicarPerfil, avisoPerfil } from '../routes/plataformas.mjs';
import { resumenDeRuta, trazaDeRuta } from '../historial/modelo.mjs';
import { esc, monto, montoConSigno, numeroPrecio, estadoCostoTexto, opcionesFiscal, bloqueCalidad, bloqueEconomico, bloqueExplicacion, tablaObjetivos, prefijoResultado, tono, tituloResultado } from './comun.mjs';
import { explicarRuta } from '../engine/explicacion.mjs';

const KEY = 'brecha.ruta.v1';
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const esCripto = (id) => activoPorId(id)?.familia === 'cripto';
const esUSD = (id) => activoPorId(id)?.familia === 'usd';

function duracion(h, dh) {
  const partes = [];
  if (h !== null && h !== undefined) {
    const min = Number(toDec(h).times(60).round(0, 1).toString());
    const d = Math.floor(min / 1440);
    const hs = Math.floor((min % 1440) / 60);
    const m = min % 60;
    if (d) partes.push(`${d} d`);
    if (hs) partes.push(`${hs} h`);
    if (m) partes.push(`${m} min`);
  }
  if (dh !== null && dh !== undefined && !toDec(dh).eq(0)) partes.push(`${formatNumberAR(dh, { decimals: 2, minDecimals: 0 })} días hábiles`);
  if (h === null || h === undefined) return '—';
  return partes.length ? partes.join(' + ') : '0 min';
}

const ESTADOS = {
  teorica: { t: 'Ruta teórica', i: '◇', d: 'Los números cierran, pero todavía no confirmaste ningún dato ni condición.' },
  condicionada: { t: 'Ruta condicionada', i: '◈', d: 'Faltan confirmar datos, costos o condiciones, o hay límites que no se cumplen.' },
  verificada: { t: 'Ruta confirmada por vos', i: '✔', d: 'Confirmaste cotizaciones (en esa plataforma y para ese importe), liquidez, costos y condiciones.' },
  incompleta: { t: 'Ruta incompleta', i: '!', d: 'Faltan datos para calcular.' },
};
const ADVERTENCIA = 'Simulación: Brecha no ejecuta operaciones ni registra ejecuciones. Que confirmes una cotización, la liquidez o las condiciones no garantiza que la operación se pueda completar, ni que esté permitida en tu caso, ni es una certificación legal.';

const TIPOS_PASO_UI = [['cambio', 'Cambio (un activo por otro)'], ['transferencia', 'Transferencia del mismo activo (entre plataformas o redes)']];
const REDONDEOS_UI = [['ninguno', 'Exacto (sin redondear entre pasos)'], ['abajo', 'Como liquida una plataforma: hacia abajo'], ['cercano', 'Al más cercano']];
const PRESETS_UI = Object.entries(PRESETS_COSTO).map(([k, p]) => [k, p.concepto]);

/**
 * @param {{editor: HTMLElement, resultado: HTMLElement, getMercados: () => object, storage: {get: Function, set: Function},
 *   fecha: (iso: string) => string, hace: (ms: number) => string}} deps
 */
export function crearSimuladorRutas({ editor, resultado, getMercados, estadoMercado = () => null, storage, fecha, hace, onCambio = () => {}, accionesResultado = () => '', analisis = null, getPlataformas = () => [] }) {
  let b = restaurarBorrador(storage.get(KEY)) ?? crearBorrador('oficial-usdt', getMercados());
  let anterior = null;
  let avisoReemplazo = b.migrado ? 'Esta ruta venía de la versión anterior: los costos que estaban vacíos ahora figuran como "No sé" (antes contaban como 0). Revisalos.' : '';
  let ultimo = null;
  let ultimoEstado = null;
  let ultimaEntrada = null;

  const guardar = () => storage.set(KEY, b);

  /* ---------- HTML ---------- */
  const opcionesActivos = (sel, excluir) => ACTIVOS.filter((a) => a.id !== excluir)
    .map((a) => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('');
  const opciones = (pares, sel) => pares.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const idDe = (k) => `r-${k.replace(/\./g, '-')}`;
  /** Prefijo invisible para lectores de pantalla: hay un campo igual en cada paso. */
  const srPaso = (k) => {
    const m = /^p(\d+)\./.exec(k);
    return m ? `<span class="sr-only">Paso ${Number(m[1]) + 1}: </span>` : '';
  };

  function input(k, label, valor, { kind = 'money', unidad = '', placeholder = '', unit = '', clase = '', costo = false } = {}) {
    const id = idDe(k);
    const na = costo ? `<button type="button" class="btn ghost small na" data-accion="no-aplica" data-objetivo="${k}" aria-label="${esc(label)}: no aplica">No aplica</button>` : '';
    return `<div class="field ${clase}">
      <label for="${id}">${srPaso(k)}${label}${unit ? ` <span class="unit">${esc(unit)}</span>` : ''}</label>
      <div class="with-action"><input id="${id}" data-k="${k}" data-kind="${kind}" data-unidad="${unidad}"${costo ? ' data-costo="1"' : ''} type="text" inputmode="decimal" value="${esc(valor)}" placeholder="${esc(costo ? 'No sé' : placeholder)}" aria-describedby="${id}-echo">${na}</div>
      <small id="${id}-echo" class="echo"></small>
    </div>`;
  }
  function select(k, label, html, { clase = '' } = {}) {
    const id = idDe(k);
    return `<div class="field ${clase}"><label for="${id}">${srPaso(k)}${label}</label><select id="${id}" data-k="${k}">${html}</select></div>`;
  }

  /** Activo en el que se cobra un costo según su lado. */
  const activoDeLado = (lado, desde, hacia) => (lado === 'destino' ? hacia : lado === 'aparte' ? b.activoInicial : desde);

  function opcionesCobro(c, p, desde) {
    const H = corto(p.hacia);
    const D = corto(desde);
    const I = corto(b.activoInicial);
    if (c.clase === 'fijo') {
      return opciones([['origen', `En ${D}: sale de lo que entregás`], ['destino', `En ${H}: se descuenta de lo que recibís`], ['aparte', `Aparte, en ${I}: se suma al capital desembolsado`]], c.lado);
    }
    const pares = [
      ['origen|neto', `Encima: sale de lo que entregás (${D}), sobre lo operado`],
      ['origen|bruto', `Sale de lo que entregás (${D}), sobre todo lo entregado`],
      ['destino|bruto', `Se descuenta de lo que recibís (${H}), sobre lo recibido bruto`],
      ['destino|neto', `Se descuenta de lo que recibís (${H}), sobre lo recibido neto de los otros %`],
    ];
    if (desde === b.activoInicial && p.tipo !== 'transferencia') pares.push(['aparte|neto', `Aparte, en ${I}: se suma al capital (sobre lo operado)`], ['aparte|bruto', `Aparte, en ${I}: se suma al capital (sobre todo lo entregado)`]);
    for (const r of p.costos) if (r.id !== c.id && r.base !== 'concepto') pares.push([`concepto|${r.id}`, `Sobre «${r.concepto}» (por ejemplo, IVA de esa comisión)`]);
    const actual = c.base === 'concepto' ? `concepto|${c.sobre ?? ''}` : `${c.lado}|${c.base}`;
    if (!pares.some(([v]) => v === actual)) pares.unshift([actual, 'Elegí cómo se cobra']);
    return opciones(pares, actual);
  }

  function htmlCosto(c, j, p, i, desde) {
    const k = (x) => `p${i}.k${j}.${x}`;
    const activo = activoDeLado(c.lado, desde, p.hacia);
    const esPct = c.clase === 'pct';
    return `<li class="costo">
      <div class="costo-top">
        <input type="text" data-k="${k('concepto')}" value="${esc(c.concepto)}" maxlength="${LARGOS.corto}" aria-label="Paso ${i + 1}: nombre del costo" class="costo-nombre">
        <select data-k="${k('clase')}" aria-label="Paso ${i + 1}: tipo de costo «${esc(c.concepto)}»">${opciones([['pct', '%'], ['fijo', 'Importe fijo']], c.clase)}</select>
        <button type="button" class="btn ghost small" data-accion="quitar-costo" data-paso="${i}" data-costo="${j}" aria-label="Quitar «${esc(c.concepto)}»">Quitar</button>
      </div>
      <div class="row two">
        ${input(k('valor'), esPct ? `${esc(c.concepto)} (%)` : `${esc(c.concepto)} (en ${esc(corto(activo))})`, c.valor, { kind: esPct ? 'percent' : kindMonto(activo), unidad: esPct ? '' : activo, costo: true })}
        ${select(k('cobro'), 'Cómo se cobra', opcionesCobro(c, p, desde))}
      </div>
      <div class="row two">
        ${esPct ? input(k('minimo'), 'Mínimo', c.minimo, { kind: kindMonto(activo), unidad: activo, unit: `en ${corto(activo)}, opcional`, placeholder: 'Sin mínimo' }) : '<div></div>'}
        ${select(k('fiscal'), 'Tratamiento', opcionesFiscal(c.fiscal))}
      </div>
      <label class="check"><input type="checkbox" data-k="${k('hipotesis')}"${c.hipotesis ? ' checked' : ''}> Es una hipótesis (no lo confirmé)</label>
    </li>`;
  }

  /** Elegir un perfil de "Mis plataformas" y cargar sus costos en el paso. */
  function htmlPerfil(p, i) {
    const lista = getPlataformas();
    if (!lista.length) return '';
    const aviso = avisoPerfil(p, lista);
    const sel = p.perfil?.id && lista.some((x) => x.id === p.perfil.id) ? p.perfil.id : '';
    return `<div class="with-action perfil-paso">
        <select id="${idDe(`p${i}.perfilSel`)}" aria-label="Paso ${i + 1}: perfil de plataforma"><option value="">Perfil de plataforma…</option>${lista.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.nombre || 'Sin nombre')}</option>`).join('')}</select>
        <button type="button" class="btn ghost small" data-accion="cargar-perfil" data-paso="${i}">Cargar costos del perfil</button>
      </div>${aviso ? `<p class="nota" data-testid="aviso-perfil-${i}">⚠ ${esc(aviso)}</p>` : ''}`;
  }

  function htmlPaso(p, i) {
    const desde = desdeDe(b, i);
    const transferencia = p.tipo === 'transferencia';
    const ref = transferencia ? null : referenciaPaso(desde, p.hacia, getMercados());
    const k = (c) => `p${i}.${c}`;
    const cotId = idDe(k('cotizacion'));
    const conLibro = !transferencia && p.libro?.length > 0;
    const refBoton = ref && !(p.fuenteCotizacion?.tipo === 'referencia')
      ? `<button type="button" class="btn ghost small" data-accion="usar-referencia" data-paso="${i}">Usar referencia (${esc(mostrar(ref.valor, kindCotizacion(desde, p.hacia, ref.base)))})</button>` : '';
    const condiciones = p.condiciones.map((c, j) => {
      const ck = `p${i}.c${j}`;
      const cid = idDe(ck);
      return `<li class="cond${c.confirmada ? ' ok' : ''}">
        <div class="cond-top">
          <label class="check"><input type="checkbox" id="${cid}-confirmada" data-k="${ck}.confirmada"${c.confirmada ? ' checked' : ''}> Confirmada</label>
          <select data-k="${ck}.tipo" aria-label="Tipo de condición">${opciones(Object.entries(TIPOS_CONDICION), c.tipo)}</select>
          <button type="button" class="btn ghost small" data-accion="eliminar-condicion" data-paso="${i}" data-cond="${j}" aria-label="Eliminar condición">Quitar</button>
        </div>
        <textarea rows="2" data-k="${ck}.texto" maxlength="${LARGOS.condicion}" aria-label="Paso ${i + 1}: condición a verificar" placeholder="Qué hay que verificar">${esc(c.texto)}</textarea>
        <label class="ref-date">Fecha de referencia <input type="date" data-k="${ck}.fechaReferencia" value="${esc(c.fechaReferencia)}"></label>
      </li>`;
    }).join('');
    const unidadCantidad = p.base === 'destino_por_origen' ? desde : p.hacia;
    const niveles = (p.libro ?? []).map((n, j) => `<li class="nivel">
        ${input(`p${i}.l${j}.precio`, `Nivel ${j + 1}: precio`, n.precio, { kind: kindCotizacion(desde, p.hacia, p.base), unit: etiquetaBase(desde, p.hacia, p.base) })}
        ${input(`p${i}.l${j}.cantidad`, 'Cantidad disponible', n.cantidad, { kind: kindMonto(unidadCantidad), unidad: unidadCantidad, unit: corto(unidadCantidad) })}
        <button type="button" class="btn ghost small" data-accion="quitar-nivel" data-paso="${i}" data-nivel="${j}" aria-label="Quitar el nivel ${j + 1}">Quitar</button>
      </li>`).join('');

    const cotizacionHTML = transferencia ? `<p class="hint">Transferencia: el activo no cambia (precio 1). Cargá abajo la comisión de retiro, el gas de la red y el mínimo de retiro.</p>` : `
      <div class="field">
        <label for="${cotId}">${srPaso(k('cotizacion'))}Cotización${conLibro ? ' <span class="unit">(se usa el libro de órdenes)</span>' : ''}</label>
        <div class="with-action">
          <input id="${cotId}" data-k="${k('cotizacion')}" data-kind="${kindCotizacion(desde, p.hacia, p.base)}" data-unidad="precio" type="text" inputmode="decimal" value="${esc(p.cotizacion)}" placeholder="No sé" aria-describedby="${cotId}-echo ${cotId}-src"${conLibro ? ' disabled' : ''}>
          <select data-k="${k('base')}" aria-label="Cómo se expresa la cotización">${opciones([
    ['origen_por_destino', etiquetaBase(desde, p.hacia, 'origen_por_destino')],
    ['destino_por_origen', etiquetaBase(desde, p.hacia, 'destino_por_origen')],
  ], p.base)}</select>
        </div>
        <small id="${cotId}-src" class="src"></small> ${refBoton}
        <small id="${cotId}-echo" class="echo"></small>
        <div class="row two">
          ${select(k('cotizacionTipo'), 'Qué precio es', opciones([['ejecucion', 'Precio de ejecución (ya incluye el spread)'], ['medio', 'Precio medio (hay que aplicar el spread)']], p.cotizacionTipo))}
          <label class="check"><input type="checkbox" data-k="${k('cotizacionHipotesis')}"${p.cotizacionHipotesis ? ' checked' : ''}> Es una hipótesis (no la confirmé)</label>
        </div>
        <div class="confirmar">
          <label class="check"><input type="checkbox" data-k="${k('confirmarCotizacion')}"${p.cotizacionHipotesis ? ' disabled' : ''}> ${srPaso(k('x'))}Confirmé esta cotización en la plataforma</label>
          <input type="text" data-k="${k('fuenteConfirmacion')}" value="${esc(p.fuenteConfirmacion ?? '')}" maxlength="${LARGOS.plataforma}" placeholder="Dónde la viste (ej.: pantalla de la app)" aria-label="Paso ${i + 1}: dónde confirmaste la cotización">
        </div>
        <small class="src" id="${cotId}-conf"></small>
      </div>`;

    return `<li class="paso${transferencia ? ' transferencia' : ''}" data-paso="${i}">
      <div class="paso-head">
        <h3>Paso ${i + 1}: ${esc(corto(desde))} → ${esc(corto(p.hacia))}${transferencia ? ' <span class="unit">(transferencia)</span>' : ''}</h3>
        <button type="button" class="btn ghost small" data-accion="eliminar-paso" data-paso="${i}" aria-label="Eliminar paso ${i + 1}">Eliminar</button>
      </div>
      ${p.nota ? `<p class="nota">ⓘ ${esc(p.nota)}</p>` : ''}
      <div class="row two">
        ${select(k('tipo'), 'Tipo de paso', opciones(TIPOS_PASO_UI, p.tipo))}
        ${transferencia ? `<div class="field"><span class="label">Activo</span><p class="valor-fijo">${esc(activoPorId(desde)?.nombre ?? desde)}</p></div>` : select(k('hacia'), `Recibís (entregás ${esc(corto(desde))})`, opcionesActivos(p.hacia, desde))}
      </div>
      <div class="row two">
        <div class="field"><label for="${idDe(k('plataforma'))}">${srPaso(k('plataforma'))}Plataforma</label>
          <input id="${idDe(k('plataforma'))}" data-k="${k('plataforma')}" type="text" maxlength="${LARGOS.plataforma}" value="${esc(p.plataforma)}" placeholder="Banco, broker, exchange…"></div>
        ${transferencia || esCripto(desde) || esCripto(p.hacia) ? `<div class="field"><label for="${idDe(k('red'))}">${srPaso(k('red'))}Red</label>
          <input id="${idDe(k('red'))}" data-k="${k('red')}" type="text" maxlength="${LARGOS.corto}" value="${esc(p.red ?? '')}" placeholder="Ej.: TRC20, ERC20, BEP20"></div>` : '<div></div>'}
      </div>
      ${htmlPerfil(p, i)}
      ${cotizacionHTML}
      <details class="more" open>
        <summary>Costos del paso</summary>
        <p class="hint">Vacío = No sé (el resultado queda incompleto). 0 = confirmado en cero. "No aplica" = no existe en este paso.</p>
        <ul class="costos-lista">${p.costos.map((c, j) => htmlCosto(c, j, p, i, desde)).join('')}</ul>
        <div class="with-action agregar-costo">
          <select id="${idDe(k('preset'))}" aria-label="Paso ${i + 1}: costo para agregar">${opciones(PRESETS_UI, 'comision')}</select>
          <button type="button" class="btn ghost small" data-accion="agregar-costo" data-paso="${i}"${p.costos.length >= MAX_COSTOS ? ' disabled' : ''}>+ Agregar costo</button>
          <button type="button" class="btn ghost small" data-accion="no-aplica-paso" data-paso="${i}">Los que no sé de este paso: no aplican</button>
        </div>
        ${transferencia || conLibro ? '' : `<div class="row two">
          ${input(k('slippagePct'), 'Slippage estimado', p.slippagePct, { kind: 'percent', unit: '% de precio en contra', costo: true })}
          ${p.cotizacionTipo === 'medio' ? input(k('spreadPct'), 'Spread', p.spreadPct, { kind: 'percent', unit: '% respecto del precio medio', costo: true }) : '<div></div>'}
        </div>`}
      </details>
      ${transferencia ? '' : `<details class="more"${conLibro ? ' open' : ''}>
        <summary>Precio según el monto (libro de órdenes)</summary>
        <p class="hint">Si cargás los niveles del libro (precio y cantidad disponible), el precio sale del promedio ponderado para tu monto. Si el monto supera lo que cargaste, no hay precio: DATOS INSUFICIENTES. Cantidad en ${esc(corto(unidadCantidad))}.</p>
        <ul class="niveles">${niveles}</ul>
        <button type="button" class="btn ghost small" data-accion="agregar-nivel" data-paso="${i}"${(p.libro?.length ?? 0) >= MAX_NIVELES_LIBRO ? ' disabled' : ''}>+ Agregar nivel</button>
      </details>`}
      <details class="more"${[p.minimo, p.maximo, p.liquidez, p.tiempoValor].some((x) => String(x ?? '').trim()) ? ' open' : ''}>
        <summary>Límites, liquidez y tiempo</summary>
        <div class="row two">
          ${input(k('minimo'), transferencia ? 'Mínimo de retiro' : 'Mínimo por operación', p.minimo, { kind: kindMonto(desde), unidad: desde, unit: corto(desde), placeholder: 'Sin dato' })}
          ${input(k('maximo'), 'Máximo por operación', p.maximo, { kind: kindMonto(desde), unidad: desde, unit: corto(desde), placeholder: 'Sin dato' })}
        </div>
        ${transferencia ? '' : `${input(k('liquidez'), 'Liquidez informada', p.liquidez, { kind: kindMonto(p.hacia), unidad: p.hacia, unit: `${corto(p.hacia)} (es un dato; para confirmarla, marcá abajo)`, placeholder: 'Sin dato' })}
        <div class="confirmar">
          <label class="check"><input type="checkbox" data-k="${k('liquidezConfirmada')}"> ${srPaso(k('x'))}Confirmé que hay liquidez para este monto</label>
          <input type="text" data-k="${k('fuenteLiquidez')}" value="${esc(p.fuenteLiquidez ?? '')}" maxlength="${LARGOS.plataforma}" placeholder="Dónde lo viste" aria-label="Paso ${i + 1}: dónde confirmaste la liquidez">
        </div>
        <small class="src" id="${idDe(k('liquidez'))}-conf"></small>`}
        <div class="row two">
          ${input(k('tiempoValor'), 'Tiempo estimado', p.tiempoValor, { kind: 'ratio', placeholder: 'Sin dato' })}
          ${select(k('tiempoUnidad'), 'Unidad', opciones([['min', 'minutos'], ['h', 'horas'], ['d', 'días corridos'], ['dh', 'días hábiles']], p.tiempoUnidad))}
        </div>
      </details>
      <div class="conds">
        <p class="sub">Condiciones a verificar <span class="unit">(sugeridas: preguntas para confirmar vos, no reglas)</span></p>
        <ul>${condiciones}</ul>
        <button type="button" class="btn ghost small" data-accion="agregar-condicion" data-paso="${i}"${p.condiciones.length >= MAX_CONDICIONES ? ' disabled' : ''}>+ Agregar condición</button>
      </div>
      <div class="paso-res" id="r-p${i}-res" aria-live="polite"></div>
    </li>`;
  }

  function htmlEditor() {
    const plantillas = PLANTILLAS.map((pl) => `<option value="${pl.id}">${esc(pl.nombre)}</option>`).join('');
    return `
      ${avisoReemplazo ? `<div class="banner" role="status"><p>${esc(avisoReemplazo)}</p>${anterior ? '<button type="button" class="btn small" data-accion="deshacer">Deshacer</button>' : ''}</div>` : ''}
      <fieldset>
        <legend>Ruta</legend>
        <div class="row two">
          ${select('activoInicial', 'Empezás con', opcionesActivos(b.activoInicial))}
          ${input('montoInicial', 'Monto inicial', b.montoInicial, { kind: kindMonto(b.activoInicial), unidad: b.activoInicial })}
        </div>
        <div class="row two">
          <div class="field"><label for="r-plantilla">Plantilla</label>
            <div class="with-action"><select id="r-plantilla">${plantillas}</select>
            <button type="button" class="btn small" data-accion="plantilla">Cargar</button></div></div>
          ${input('estresPct', 'Estrés', b.estresPct, { kind: 'percent', unit: '% de precio en contra en cada paso', placeholder: '0' })}
        </div>
        ${select('redondeo', 'Redondeo de ejecución', opciones(REDONDEOS_UI, b.redondeo ?? 'ninguno'))}
      </fieldset>
      <ol class="pasos">${b.pasos.map(htmlPaso).join('')}</ol>
      <div class="ruta-actions">
        <button type="button" class="btn" data-accion="agregar-paso"${b.pasos.length >= MAX_PASOS ? ' disabled' : ''}>+ Agregar paso</button>
        <span class="hint">Sale de ${esc(corto(desdeDe(b, b.pasos.length)))}. Máximo ${MAX_PASOS} pasos.</span>
      </div>`;
  }

  function render() {
    const act = document.activeElement;
    const foco = act && editor.contains(act) ? act.dataset.k || act.id : null;
    const pos = foco && typeof act.selectionStart === 'number' ? act.selectionStart : null;
    editor.innerHTML = htmlEditor();
    if (foco) {
      const el = editor.querySelector(`[data-k="${CSS.escape(foco)}"]`) ?? document.getElementById(foco);
      if (el) {
        el.focus();
        if (pos !== null) try { el.setSelectionRange(pos, pos); } catch { /* selects y checkboxes */ }
      }
    }
    recalcular();
  }

  /* ---------- Cálculo y resultado ---------- */
  const opcionesMotor = { activosValidos: IDS_ACTIVOS, decimales: DECIMALES, nombres: NOMBRES };
  function recalcular() {
    const { entrada, meta } = normalizar(b);
    ultimaEntrada = { ...entrada, estresPct: null };
    const sim = simularRuta(ultimaEntrada, opcionesMotor);
    ultimo = sim;
    const est = evaluarRuta(sim, meta, { vigenciaCotizacionHoras: VIGENCIA_COTIZACION_HORAS, vigenciaCondicionDias: VIGENCIA_CONDICION_DIAS });
    ultimoEstado = est;
    const e = entrada.estresPct;
    const conEstres = e && e !== INVALIDO && toDec(e).gt(0) ? simularRuta(entrada, { ...opcionesMotor, objetivos: 'equilibrio' }) : null;
    actualizarCampos(sim);
    renderResultado(sim, est, conEstres, e);
    guardar();
    onCambio();
  }

  function actualizarCampos(sim) {
    // Interpretación de cada número (y estado de cada costo: nunca un vacío parece un 0)
    for (const el of editor.querySelectorAll('input[data-kind]')) {
      const echo = document.getElementById(`${el.id}-echo`);
      if (!echo) continue;
      const p = parseNumberAR(el.value, { kind: el.dataset.kind });
      const u = el.dataset.unidad;
      const formato = (v) => {
        if (el.dataset.kind === 'percent') return `${formatNumberAR(v, { decimals: 6, minDecimals: 0 })} %`;
        if (u === 'precio') {
          const i = Number(el.dataset.k.match(/^p(\d+)/)[1]);
          return `${numeroPrecio(v)} ${etiquetaBase(desdeDe(b, i), b.pasos[i].hacia, b.pasos[i].base)}`;
        }
        if (u) return monto(v, u);
        return formatNumberAR(v, { decimals: 6, minDecimals: 0 });
      };
      echo.classList.remove('bad', 'nose', 'na', 'cero');
      el.removeAttribute('aria-invalid');
      if (el.dataset.costo) {
        const e = estadoCostoTexto(el.value, p, formato);
        echo.textContent = e.texto;
        if (e.clase) echo.classList.add(e.clase);
        if (e.clase === 'bad') el.setAttribute('aria-invalid', 'true');
        continue;
      }
      if (!p.ok) {
        echo.textContent = p.error;
        echo.classList.add('bad');
        el.setAttribute('aria-invalid', 'true');
        continue;
      }
      if (p.empty) {
        echo.textContent = u === 'precio' && !el.disabled ? 'No sé: sin la cotización no hay resultado (no se supone 1)' : '';
        if (echo.textContent) echo.classList.add('nose');
        continue;
      }
      echo.textContent = `= ${formato(p.value)}`;
    }
    const errPorPaso = new Map();
    for (const er of sim.errors) if (er.paso !== undefined) errPorPaso.set(er.paso, [...(errPorPaso.get(er.paso) ?? []), er.message]);

    b.pasos.forEach((p, i) => {
      const desde = desdeDe(b, i);
      const r = sim.ok ? sim.result.pasos[i] : null;
      const cotId = idDe(`p${i}.cotizacion`);
      const src = document.getElementById(`${cotId}-src`);
      if (src) src.textContent = textoFuente(p, desde);
      // Confirmación de la cotización: valor, plataforma e importe
      const parsed = parseNumberAR(p.cotizacion, { kind: kindCotizacion(desde, p.hacia, p.base) });
      const actual = r ? plain(r.precio) : parsed.ok && !parsed.empty ? plain(parsed.value) : null;
      const conf = p.confirmacionCotizacion;
      const mismaPlat = !conf?.plataforma || conf.plataforma.trim().toLowerCase() === p.plataforma.trim().toLowerCase();
      const alcanzaImporte = !conf?.importe || !r || toDec(conf.importe).gte(r.operado);
      const valida = !!(conf && actual !== null && conf.valor === actual && mismaPlat && alcanzaImporte);
      const cb = editor.querySelector(`[data-k="p${i}.confirmarCotizacion"]`);
      if (cb) cb.checked = valida;
      const confTxt = document.getElementById(`${cotId}-conf`);
      if (confTxt) {
        confTxt.textContent = valida
          ? `Confirmada ${fecha(conf.at)}${conf.plataforma ? ` en ${conf.plataforma}` : ''}${conf.importe ? ` para operar hasta ${monto(toDec(conf.importe), desde)}` : ''}${conf.fuente ? ` · fuente: ${conf.fuente}` : ''}${vencida(conf.at, VIGENCIA_COTIZACION_HORAS) ? ` · tiene más de ${VIGENCIA_COTIZACION_HORAS} h, volvé a confirmarla` : ''}`
          : !conf ? '' : conf.valor !== actual ? 'La cotización cambió después de confirmarla: volvé a confirmarla.'
            : !mismaPlat ? `Se confirmó en otra plataforma (${conf.plataforma}): volvé a confirmarla.` : 'Operás más que el importe para el que la confirmaste: volvé a confirmarla.';
      }
      // Liquidez confirmada
      const lq = p.liquidezConfirmada;
      const lqValida = !!(lq && r && toDec(lq.hasta).gte(r.bruto) && (!lq.plataforma || lq.plataforma.trim().toLowerCase() === p.plataforma.trim().toLowerCase()));
      const lcb = editor.querySelector(`[data-k="p${i}.liquidezConfirmada"]`);
      if (lcb) lcb.checked = lqValida;
      const lqTxt = document.getElementById(`${idDe(`p${i}.liquidez`)}-conf`);
      if (lqTxt) lqTxt.textContent = lqValida ? `Confirmada ${fecha(lq.at)} para hasta ${monto(toDec(lq.hasta), p.hacia)}${lq.plataforma ? ` en ${lq.plataforma}` : ''}${lq.fuente ? ` · fuente: ${lq.fuente}` : ''}` : lq ? 'El monto o la plataforma cambiaron: volvé a confirmar la liquidez.' : '';
      // Resultado del paso
      const box = document.getElementById(`r-p${i}-res`);
      if (!box) return;
      if (errPorPaso.has(i)) {
        box.innerHTML = `<p class="bad">${errPorPaso.get(i).map(esc).join('<br>')}</p>`;
        return;
      }
      if (!r) { box.innerHTML = ''; return; }
      const costos = r.costos.filter((c) => !c.monto.eq(0)).map((c) => `${c.concepto} ${monto(c.monto, c.activo)}${c.alMinimo ? ' (mínimo)' : ''}${c.lado === 'aparte' ? ' (aparte)' : ''}`);
      if (!r.costoSlippage.eq(0)) costos.push(`${r.mejorPrecio ? 'impacto del libro y estrés' : 'slippage y spread'} ${monto(r.costoSlippage, p.hacia)}`);
      if (!r.ajusteRedondeo.eq(0)) costos.push(`redondeo ${monto(r.ajusteRedondeo, p.hacia)}`);
      // Stablecoins y dólares: nunca se asume 1 a 1; se muestra cuánto se aparta de la paridad.
      const paridad = p.tipo !== 'transferencia' && ((esCripto(desde) && (esUSD(p.hacia) || esCripto(p.hacia))) || (esUSD(desde) && esCripto(p.hacia)));
      const porUno = paridad ? (r.base === 'destino_por_origen' ? r.precio : ONE.div(r.precio)) : null;
      const desvio = porUno ? `<p class="hint">Desvío de la paridad 1 a 1: ${formatPct(porUno.minus(ONE).times(100))} (recibís ${numeroPrecio(porUno)} ${esc(corto(p.hacia))} por 1 ${esc(corto(desde))}).</p>` : '';
      const libro = r.mejorPrecio ? `<p class="hint">Precio promedio para tu monto: ${numeroPrecio(r.precio)} (mejor nivel ${numeroPrecio(r.mejorPrecio)}, impacto ${formatPct(r.impactoPct, { signed: false })}).</p>` : '';
      box.innerHTML = `<p><span>Entregás <strong>${monto(r.entregado, desde)}</strong></span>
        <span aria-hidden="true">→</span> <span>recibís <strong data-testid="paso-${i}-recibido">${monto(r.recibido, p.hacia)}</strong></span></p>
        ${libro}${desvio}${costos.length ? `<p class="hint">Costos: ${esc(costos.join(' · '))}</p>` : ''}
        ${r.violaciones.map((v) => `<p class="bad">⚠ ${esc(v.texto)}</p>`).join('')}`;
    });
  }

  function vencida(iso, horas) {
    const t = Date.parse(iso ?? '');
    return Number.isNaN(t) || Date.now() - t > horas * 3600e3;
  }

  function textoFuente(p, desde) {
    if (p.tipo === 'transferencia') return '';
    if (p.libro?.length) return 'Precio del libro de órdenes que cargaste (promedio para tu monto).';
    const f = p.fuenteCotizacion;
    if (!f) return 'Sin referencia para este par: cargá la cotización de tu plataforma.';
    if (f.tipo === 'manual') return 'Cargada a mano.';
    if (f.tipo === 'simple') return f.detalle ?? 'Desde la calculadora simple.';
    if (f.tipo !== 'referencia') return f.detalle ?? '';
    const cuando = f.origen === 'manual' ? 'cotización manual' : `${f.fuente ?? 'DolarAPI'}, dato de ${fecha(f.fechaFuente)}${f.fechaFuente ? ` (${hace(Date.now() - Date.parse(f.fechaFuente))})` : ''}`;
    const est = estadoMercado(f.mercado);
    const aviso = est?.estado === 'antigua' ? ' · ⚠ antigua' : est?.estado === 'no_disponible' ? ' · ⚠ ya no es válida' : '';
    return `Referencia: ${f.nombreMercado} ${f.punta} · ${cuando}${aviso}${f.generica ? ' · referencia cripto genérica, sin exchange ni stablecoin' : ''}. No es el precio de tu plataforma.`;
  }

  /** "Paso 2: comisión" → botón que marca ese costo como "no aplica". */
  function botonNoAplica(d) {
    const m = /^costos\.(\d+)$/.exec(d.campo ?? '');
    const k = m ? `p${d.paso}.k${m[1]}.valor` : d.campo === 'slippagePct' ? `p${d.paso}.slippagePct` : d.campo === 'spreadPct' ? `p${d.paso}.spreadPct` : null;
    if (!k) return '';
    return ` <button type="button" class="btn ghost small" data-accion="ir-a" data-objetivo="${k}">Cargar</button> <button type="button" class="btn ghost small" data-accion="no-aplica" data-objetivo="${k}" aria-label="${esc(d.texto)}: no aplica">No aplica</button>`;
  }

  function renderResultado(sim, est, conEstres, estresRaw) {
    const e = ESTADOS[est.estado];
    const estadoHTML = `<div class="estado ${est.estado}" data-testid="ruta-estado"><p class="res-title"><span aria-hidden="true">${e.i}</span> ${e.t}</p><p>${esc(e.d)}</p></div>
      <p class="disclaimer advertencia" data-testid="ruta-advertencia">${esc(ADVERTENCIA)}</p>`;
    resultado.dataset.nivel = sim.ok ? sim.calidad.nivel : sim.datosInsuficientes ? 'insuficiente' : 'error';
    if (!sim.ok) {
      resultado.innerHTML = sim.datosInsuficientes
        ? `${estadoHTML}${bloqueCalidad(sim.calidad)}`
        : `${estadoHTML}<div class="res-errors" role="alert"><p class="res-title">Falta corregir para calcular</p>
        <ul>${sim.errors.map((er) => `<li>${esc(er.message)}</li>`).join('')}</ul></div>`;
      return;
    }
    const r = sim.result;
    const fin = r.activoFinal;
    const nivel = sim.calidad.nivel;
    let headline;
    if (r.mismoActivo) {
      const c = tono(r.resultadoNeto, nivel);
      const t = tituloResultado(r.estado, nivel);
      headline = `<div class="headline ${c}">
        <p class="res-title"><span aria-hidden="true">${t.i}</span> ${t.t}${est.estado === 'verificada' ? '' : ' · ruta sin confirmar'}</p>
        <p class="big" data-testid="ruta-neto">${prefijoResultado(nivel)}${montoConSigno(r.resultadoNeto, fin)}</p>
        <p class="roi">Resultado de caja · ROI neto ${nivel === 'incompleto' ? 'como máximo ' : ''}<strong class="${c}" data-testid="ruta-roi">${formatPct(r.roiPct)}</strong></p></div>
        ${bloqueEconomico(r.resultadoEconomico, r.resultadoNeto, { activo: fin, conceptos: r.fiscal?.detalle ?? [], noValuables: r.fiscal?.noValuables ?? [] })}`;
    } else {
      headline = `<div class="headline neu"><p class="res-title">La ruta termina en ${esc(corto(fin))}</p>
        <p class="big" data-testid="ruta-neto">${monto(r.montoFinal, fin)}</p>
        <p class="roi">No hay ganancia comparable en ${esc(corto(r.activoInicial))} sin un paso de vuelta: agregalo para medirla.</p></div>`;
    }
    const ult = sim.result.pasos[sim.result.pasos.length - 1];
    const unidadEq = etiquetaBase(ult.desde, ult.hacia, ult.base);
    const eqTxt = r.equilibrio ? `${numeroPrecio(r.equilibrio.precio)} <span class="unit">${esc(unidadEq)}</span>` : '—';
    let estresHTML = '';
    if (conEstres?.ok && conEstres.result.mismoActivo) {
      estresHTML = `<p class="estres" data-testid="ruta-estres">Con precios ${esc(formatNumberAR(toDec(estresRaw), { decimals: 4, minDecimals: 0 }))} % peores en cada paso: <strong>${montoConSigno(conEstres.result.resultadoNeto, fin)}</strong> (ROI ${formatPct(conEstres.result.roiPct)})</p>`;
    } else if (conEstres && !conEstres.ok) {
      estresHTML = `<p class="estres bad">Con ese estrés la ruta no se puede calcular: ${esc(conEstres.errors[0].message)}</p>`;
    }
    const lista = (titulo, items, cls, testid) => (items.length
      ? `<div class="${cls}" data-testid="${testid}"><p class="res-title">${titulo}</p><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    const aparte = r.pagosAparte && !r.pagosAparte.eq(0) ? ` <span class="unit">incluye ${monto(r.pagosAparte, r.activoInicial)} pagados aparte</span>` : '';

    resultado.innerHTML = `${estadoHTML}${bloqueCalidad(sim.calidad, { botonNoAplica })}${headline}
      ${bloqueExplicacion(explicarRuta(sim, { nombre: corto, monto, montoConSigno }))}
      <dl class="kpis">
        <div><dt>Capital desembolsado${aparte}</dt><dd data-testid="ruta-capital">${monto(r.capitalInvertido, r.activoInicial)}</dd></div>
        <div><dt>Capital final</dt><dd data-testid="ruta-final">${monto(r.montoFinal, fin)}</dd></div>
        <div><dt>Ingreso bruto <span class="unit">sin costos</span></dt><dd>${monto(r.brutoTeorico, fin)}</dd></div>
        <div><dt>Costos totales <span class="unit">en ${esc(corto(fin))}${nivel === 'incompleto' ? ', los conocidos' : ''}</span></dt><dd data-testid="ruta-costos">${monto(r.costosTotales, fin)}</dd></div>
        <div><dt>Equilibrio <span class="unit">precio del último paso</span></dt><dd data-testid="ruta-equilibrio">${eqTxt}</dd></div>
        <div><dt>Tiempo estimado</dt><dd>${duracion(r.tiempoTotalHoras, r.tiempoDiasHabiles)}</dd></div>
      </dl>
      <div class="gaps">
        ${r.brechaRutaPct ? `<p>Brecha bruta de la ruta <strong data-testid="ruta-brecha">${formatPct(r.brechaRutaPct)}</strong></p>` : ''}
        ${r.equilibrio ? `<p>Margen de seguridad <strong data-testid="ruta-margen">${formatPct(r.equilibrio.margenSeguridadPct)}</strong> <span class="unit">cuánto puede empeorar el último precio antes de perder</span></p>` : ''}
        <p class="hint">La brecha compara precios sin costos; no es ganancia.</p>
      </div>
      ${r.mismoActivo ? tablaObjetivos(r.objetivosPrecio, unidadEq, nivel) : ''}
      ${estresHTML}
      ${lista('No se cumple', est.violaciones.map((v) => v.texto), 'viol', 'ruta-violaciones')}
      ${est.pendientes.length ? `<details class="pend" data-testid="ruta-pendientes"${est.pendientes.length <= 6 ? ' open' : ''}>
        <summary class="res-title">Para confirmar la ruta faltan ${est.pendientes.length} cosas</summary>
        <ul>${est.pendientes.map((p) => `<li>${esc(p.texto)}</li>`).join('')}</ul></details>` : ''}
      ${sim.warnings.filter((w) => w.code !== 'costos_desconocidos').length ? `<ul class="warnings">${sim.warnings.filter((w) => w.code !== 'costos_desconocidos').map((w) => `<li>⚠ ${esc(w.message)}</li>`).join('')}</ul>` : ''}
      <div class="res-actions">${accionesResultado()}</div>
      ${analisis?.html('ruta', datosAnalisis, { conTiempo: true }) ?? ''}`;
  }

  /** La ruta actual para el panel de análisis. */
  function datosAnalisis() {
    if (!ultimo?.ok || !ultimaEntrada) return null;
    const u = ultimo.result.pasos.at(-1);
    return { entrada: ultimaEntrada, motor: opcionesMotor, unidadPrecio: etiquetaBase(u.desde, u.hacia, u.base), conTiempo: true, resultado: ultimo.result };
  }

  /* ---------- Eventos ---------- */
  const RX = /^p(\d+)\.(?:([ckl])(\d+)\.)?(\w+)$/;
  function setValor(k, v) {
    const m = k.match(RX);
    if (!m) { b[k] = v; return; }
    const p = b.pasos[Number(m[1])];
    if (!p) return;
    if (m[2] === 'c') {
      const c = p.condiciones[Number(m[3])];
      if (!c) return;
      c[m[4]] = v;
      if (m[4] === 'texto' && c.confirmada) {
        c.confirmada = false;
        c.confirmadaAt = null;
        const cb = editor.querySelector(`[data-k="p${m[1]}.c${m[3]}.confirmada"]`);
        if (cb) cb.checked = false;
      }
      return;
    }
    if (m[2] === 'k') { const c = p.costos[Number(m[3])]; if (c) c[m[4]] = v; return; }
    if (m[2] === 'l') { const n = p.libro[Number(m[3])]; if (n) n[m[4]] = v; return; }
    p[m[4]] = v;
    if (m[4] === 'cotizacion') p.fuenteCotizacion = { tipo: 'manual' };
  }

  function onCheck(k, checked, el) {
    const m = k.match(RX);
    if (!m) return;
    const i = Number(m[1]);
    const p = b.pasos[i];
    const ahora = new Date().toISOString();
    const r = ultimo?.ok ? ultimo.result.pasos[i] : null;
    if (m[2] === 'c') {
      const c = p.condiciones[Number(m[3])];
      c.confirmada = checked;
      c.confirmadaAt = checked ? ahora : null;
      if (checked && !c.fechaReferencia) {
        c.fechaReferencia = hoyAR();
        const d = editor.querySelector(`[data-k="p${i}.c${m[3]}.fechaReferencia"]`);
        if (d) d.value = c.fechaReferencia;
      }
      el.closest('.cond')?.classList.toggle('ok', checked);
    } else if (m[2] === 'k') {
      p.costos[Number(m[3])].hipotesis = checked;
    } else if (m[4] === 'cotizacionHipotesis') {
      p.cotizacionHipotesis = checked;
      if (checked) p.confirmacionCotizacion = null;
      return render();
    } else if (m[4] === 'confirmarCotizacion') {
      if (!checked) p.confirmacionCotizacion = null;
      else if (!r) {
        el.checked = false;
        const t = document.getElementById(`${idDe(`p${i}.cotizacion`)}-conf`);
        if (t) t.textContent = 'Cargá una cotización válida (y que la ruta se pueda calcular) antes de confirmarla.';
        return;
      } else {
        p.confirmacionCotizacion = { valor: plain(r.precio), at: ahora, fuente: (p.fuenteConfirmacion ?? '').trim(), plataforma: p.plataforma.trim(), importe: plain(r.operado), activo: desdeDe(b, i) };
      }
    } else if (m[4] === 'liquidezConfirmada') {
      if (!checked || !r) {
        p.liquidezConfirmada = null;
        el.checked = false;
      } else {
        p.liquidezConfirmada = { hasta: plain(r.bruto), at: ahora, fuente: (p.fuenteLiquidez ?? '').trim(), plataforma: p.plataforma.trim() };
      }
    }
    recalcular();
  }

  function onSelect(k, v) {
    const mercados = getMercados();
    if (k === 'activoInicial') {
      b.activoInicial = v;
      reiniciarPar(b, 0, mercados);
      return render();
    }
    if (k === 'redondeo') { b.redondeo = v; return render(); }
    const m = k.match(RX);
    if (!m) return;
    const i = Number(m[1]);
    const p = b.pasos[i];
    if (m[2] === 'c') { p.condiciones[Number(m[3])][m[4]] = v; return recalcular(); }
    if (m[2] === 'k') {
      const c = p.costos[Number(m[3])];
      if (m[4] === 'clase') {
        c.clase = v;
        c.base = v === 'pct' ? (c.lado === 'destino' ? 'bruto' : 'neto') : null;
        c.sobre = null;
        if (v === 'fijo') c.minimo = '';
        if (v === 'pct' && c.lado === 'aparte' && desdeDe(b, i) !== b.activoInicial) c.lado = 'origen';
      } else if (m[4] === 'cobro') {
        if (c.clase === 'fijo') c.lado = v;
        else if (v.startsWith('concepto|')) {
          const id = v.slice('concepto|'.length);
          const ref = p.costos.find((x) => x.id === id);
          c.base = 'concepto';
          c.sobre = id;
          c.lado = ref?.lado ?? 'destino';
        } else {
          const [lado, base] = v.split('|');
          c.lado = lado;
          c.base = base;
          c.sobre = null;
        }
        // Un costo "sobre otro" que apuntaba a éste sigue su lado
        for (const x of p.costos) if (x.base === 'concepto' && x.sobre === c.id) x.lado = c.lado;
      } else c[m[4]] = v;
      return render();
    }
    if (m[4] === 'hacia') {
      p.hacia = v;
      reiniciarPar(b, i, mercados);
      reiniciarPar(b, i + 1, mercados);
    } else if (m[4] === 'tipo') {
      const desde = desdeDe(b, i);
      const nuevo = pasoNuevo(desde, v === 'transferencia' ? desde : (desde === 'ARS' ? 'USD_BANCO' : 'ARS'), mercados, v);
      b.pasos[i] = { ...nuevo, id: p.id, plataforma: p.plataforma, nota: p.nota };
      reiniciarPar(b, i + 1, mercados);
    } else if (m[4] === 'base') {
      p.base = v;
      p.confirmacionCotizacion = null;
    } else {
      p[m[4]] = v;
    }
    render();
  }

  const acciones = {
    'agregar-paso': () => {
      if (b.pasos.length >= MAX_PASOS) return;
      const desde = desdeDe(b, b.pasos.length);
      b.pasos.push(pasoNuevo(desde, desde === 'ARS' ? 'USD_BANCO' : 'ARS', getMercados()));
      render();
      editor.querySelector(`[data-k="p${b.pasos.length - 1}.hacia"]`)?.focus();
    },
    'eliminar-paso': (btn) => {
      const i = Number(btn.dataset.paso);
      b.pasos.splice(i, 1);
      if (b.pasos[i]) reiniciarPar(b, i, getMercados());
      render();
    },
    'agregar-condicion': (btn) => {
      const i = Number(btn.dataset.paso);
      if (b.pasos[i].condiciones.length >= MAX_CONDICIONES) return;
      b.pasos[i].condiciones.push(nuevaCondicion());
      render();
      editor.querySelector(`[data-k="p${i}.c${b.pasos[i].condiciones.length - 1}.texto"]`)?.focus();
    },
    'eliminar-condicion': (btn) => {
      b.pasos[Number(btn.dataset.paso)].condiciones.splice(Number(btn.dataset.cond), 1);
      render();
    },
    'agregar-costo': (btn) => {
      const i = Number(btn.dataset.paso);
      const p = b.pasos[i];
      if (p.costos.length >= MAX_COSTOS) return;
      const preset = editor.querySelector(`#${idDe(`p${i}.preset`)}`)?.value ?? 'comision';
      const desde = desdeDe(b, i);
      const c = nuevoCosto(preset, desde === 'ARS' ? 'origen' : 'destino');
      if (c.lado === 'aparte' && c.clase === 'pct' && desde !== b.activoInicial) c.lado = 'origen';
      if (c.base === 'concepto') {
        const ref = p.costos.find((x) => x.clase === 'pct' && x.base !== 'concepto') ?? p.costos.find((x) => x.base !== 'concepto');
        if (ref) { c.sobre = ref.id; c.lado = ref.lado; } else { c.base = c.lado === 'destino' ? 'bruto' : 'neto'; }
      }
      p.costos.push(c);
      render();
      editor.querySelector(`[data-k="p${i}.k${p.costos.length - 1}.valor"]`)?.focus();
    },
    'quitar-costo': (btn) => {
      const p = b.pasos[Number(btn.dataset.paso)];
      const [quitado] = p.costos.splice(Number(btn.dataset.costo), 1);
      for (const x of p.costos) if (x.sobre === quitado?.id) x.sobre = null;
      render();
    },
    'cargar-perfil': (btn) => {
      const i = Number(btn.dataset.paso);
      const id = editor.querySelector(`#${idDe(`p${i}.perfilSel`)}`)?.value;
      const perfil = getPlataformas().find((x) => x.id === id);
      if (!perfil) return;
      b.pasos[i].nota = aplicarPerfil(b.pasos[i], perfil, { desde: desdeDe(b, i), activoInicial: b.activoInicial });
      b.pasos[i].confirmacionCotizacion = null;
      render();
    },
    'no-aplica': (btn) => {
      setValor(btn.dataset.objetivo, 'no aplica');
      render();
    },
    'no-aplica-paso': (btn) => {
      const p = b.pasos[Number(btn.dataset.paso)];
      for (const c of p.costos) if (!String(c.valor ?? '').trim()) c.valor = 'no aplica';
      if (!String(p.slippagePct ?? '').trim()) p.slippagePct = 'no aplica';
      if (p.cotizacionTipo === 'medio' && !String(p.spreadPct ?? '').trim()) p.spreadPct = 'no aplica';
      render();
    },
    'ir-a': (btn) => {
      const el = editor.querySelector(`[data-k="${CSS.escape(btn.dataset.objetivo)}"]`);
      el?.closest('details')?.setAttribute('open', '');
      el?.focus();
    },
    'agregar-nivel': (btn) => {
      const p = b.pasos[Number(btn.dataset.paso)];
      if ((p.libro?.length ?? 0) >= MAX_NIVELES_LIBRO) return;
      p.libro = [...(p.libro ?? []), { precio: '', cantidad: '' }];
      render();
    },
    'quitar-nivel': (btn) => {
      b.pasos[Number(btn.dataset.paso)].libro.splice(Number(btn.dataset.nivel), 1);
      render();
    },
    'usar-referencia': (btn) => {
      const i = Number(btn.dataset.paso);
      aplicarReferencia(b.pasos[i], desdeDe(b, i), getMercados());
      render();
    },
    plantilla: () => {
      const id = editor.querySelector('#r-plantilla').value;
      reemplazar(crearBorrador(id, getMercados()), `Cargaste la plantilla ${PLANTILLAS.find((p) => p.id === id)?.nombre}.`);
    },
    deshacer: () => {
      if (!anterior) return;
      b = anterior;
      anterior = null;
      avisoReemplazo = '';
      render();
    },
  };

  function reemplazar(nuevo, mensaje) {
    anterior = structuredClone(b);
    b = nuevo;
    avisoReemplazo = `${mensaje} La ruta anterior se reemplazó.`;
    render();
  }

  editor.addEventListener('input', (ev) => {
    const t = ev.target;
    const k = t.dataset.k;
    if (!k || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    setValor(k, t.value);
    recalcular();
  });
  editor.addEventListener('change', (ev) => {
    const t = ev.target;
    const k = t.dataset.k;
    if (!k) return;
    if (t.type === 'checkbox') onCheck(k, t.checked, t);
    else if (t.tagName === 'SELECT') onSelect(k, t.value);
  });
  editor.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-accion]');
    if (btn && acciones[btn.dataset.accion]) acciones[btn.dataset.accion](btn);
  });
  analisis?.enlazar(resultado, 'ruta', datosAnalisis);
  resultado.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-accion]');
    if (btn && acciones[btn.dataset.accion]) acciones[btn.dataset.accion](btn);
  });

  return {
    render,
    /** Recalcula sin volver a dibujar los campos (para edades que cambian con el tiempo). */
    refrescar: () => recalcular(),
    /**
     * Las cotizaciones de referencia siguen a las cotizaciones nuevas, y los pasos todavía vacíos
     * toman la referencia si ahora existe. Lo cargado a mano o desde la calculadora simple no se toca.
     */
    alActualizarCotizaciones() {
      const mercados = getMercados();
      b.pasos.forEach((p, i) => {
        const vacio = !String(p.cotizacion).trim() && !p.fuenteCotizacion;
        if (p.fuenteCotizacion?.tipo === 'referencia' || vacio) aplicarReferencia(p, desdeDe(b, i), mercados);
      });
      render();
    },
    /** Foto de la ruta actual para el historial. */
    capturar() {
      const mercados = getMercados();
      const cotizaciones = b.pasos.map((p, i) => {
        const desde = desdeDe(b, i);
        const r = ultimo?.ok ? ultimo.result.pasos[i] : null;
        const kind = kindCotizacion(desde, p.hacia, p.base);
        const parsed = parseNumberAR(p.cotizacion, { kind });
        const valor = p.tipo === 'transferencia' ? '1' : r ? plain(r.precio) : parsed.ok && !parsed.empty ? plain(parsed.value) : null;
        const f = p.fuenteCotizacion;
        const fuente = p.tipo === 'transferencia' ? 'Transferencia (mismo activo)' : p.libro?.length ? 'Libro de órdenes cargado' : f?.tipo === 'referencia'
          ? `Referencia ${f.nombreMercado} ${f.punta} (${f.origen === 'manual' ? 'manual' : f.fuente ?? 'DolarAPI'})`
          : f?.tipo === 'manual' ? 'Cargada a mano' : f?.tipo === 'simple' ? (f.detalle ?? 'Desde otra simulación') : 'Sin fuente';
        const estado = f?.tipo === 'referencia' && mercados ? estadoMercado(f.mercado)?.estado ?? null : null;
        const conf = p.confirmacionCotizacion;
        return {
          etiqueta: `Paso ${i + 1}: ${corto(desde)} → ${corto(p.hacia)}${p.plataforma ? ` (${p.plataforma})` : ''}${p.cotizacionHipotesis ? ' · hipótesis' : ''}`,
          valor, unidad: p.tipo === 'transferencia' ? `${corto(desde)} por 1 ${corto(desde)}` : etiquetaBase(desde, p.hacia, p.base), fuente,
          fecha: f?.tipo === 'referencia' ? f.fechaFuente ?? null : null, estado,
          confirmada: !!(conf && valor !== null && conf.valor === valor),
        };
      });
      const ult = ultimo?.ok ? ultimo.result.pasos[ultimo.result.pasos.length - 1] : null;
      return {
        tipo: 'ruta',
        nombre: `${[b.activoInicial, ...b.pasos.map((p) => p.hacia)].map(corto).join(' → ')} · ${b.montoInicial || '—'} ${corto(b.activoInicial)}`,
        entrada: { ruta: structuredClone(b) },
        cotizaciones,
        resumen: resumenDeRuta(ultimo, ultimoEstado, ult ? etiquetaBase(ult.desde, ult.hacia, ult.base) : null),
        plataformas: b.pasos.map((p) => p.plataforma.trim()).filter(Boolean),
        motor: ultimo?.result?.version ?? null,
        traza: trazaDeRuta(ultimo),
      };
    },
    /** Abre una ruta guardada (con deshacer). Devuelve false si el borrador no es válido. */
    cargarBorrador(borrador, mensaje) {
      const r = restaurarBorrador(structuredClone(borrador));
      if (!r) return false;
      reemplazar(r, r.migrado ? `${mensaje} Venía de la versión anterior: los costos vacíos ahora figuran como "No sé".` : mensaje);
      return true;
    },
    /** Carga una ruta armada en otro lado (por ejemplo, una celda del resultado neto). */
    cargarEntrada(entrada, { notas = {}, mensaje = 'Ruta cargada.', fuente } = {}) {
      reemplazar(borradorDesdeEntrada(entrada, { notas, fuente }), mensaje);
    },
    /** Resumen de la ruta actual para el explorador (sólo si empieza y termina en ARS y se puede calcular). */
    resumen() {
      if (!ultimo?.ok || !ultimoEstado) return null;
      const r = ultimo.result;
      if (!r.mismoActivo || r.activoInicial !== 'ARS') return null;
      return {
        id: 'ruta',
        esRuta: true,
        titulo: `Tu ruta: ${[r.activoInicial, ...r.pasos.map((p) => p.hacia)].map(corto).join(' → ')}`,
        estado: ultimoEstado.estado,
        nivel: ultimo.calidad.nivel,
        calidad: ultimo.calidad,
        parcial: ultimo.calidad.desconocidos.map((d) => d.texto),
        faltantes: ultimo.calidad.desconocidos.length,
        pasos: r.pasos.length,
        roiPct: r.roiPct,
        resultadoNeto: r.resultadoNeto,
        costoPct: r.costosTotales.div(r.capitalInvertido).times(100),
        montoInicial: r.montoInicial,
        capitalInvertido: r.capitalInvertido,
        tiempoHoras: r.tiempoTotalHoras,
        margenSeguridadPct: r.equilibrio?.margenSeguridadPct ?? null,
        violaciones: ultimoEstado.violaciones.length,
      };
    },
    /**
     * Usa un tipo de cambio calculado con bonos en el paso que corresponde (ARS → USD MEP/cable o al revés).
     * Los costos del paso quedan en «no aplica»: ya están dentro de ese tipo de cambio (no se cobran dos veces).
     */
    aplicarBonos(d) {
      const usd = d.mercado === 'ccl' ? 'USD_CABLE' : 'USD_MEP';
      const comprar = d.sentido === 'comprar_usd';
      const i = b.pasos.findIndex((p, k) => (comprar ? desdeDe(b, k) === 'ARS' && p.hacia === usd : desdeDe(b, k) === usd && p.hacia === 'ARS'));
      if (i < 0) return `La ruta no tiene un paso ${comprar ? `ARS → ${corto(usd)}` : `${corto(usd)} → ARS`}: agregalo y volvé a tocar el botón.`;
      const p = b.pasos[i];
      p.base = comprar ? 'origen_por_destino' : 'destino_por_origen';
      p.cotizacion = mostrar(d.tc, 'money');
      p.cotizacionTipo = 'ejecucion';
      p.cotizacionHipotesis = false;
      p.libro = [];
      p.fuenteCotizacion = { tipo: 'bonos', detalle: d.detalle };
      p.confirmacionCotizacion = null;
      for (const c of p.costos) c.valor = 'no aplica';
      p.nota = 'Los costos de este paso están dentro del tipo de cambio con bonos (por eso figuran como «no aplica»).';
      render();
      return `Paso ${i + 1}: cargué el tipo de cambio con bonos.${d.incompleto ? ' Ojo: tenía costos en «No sé».' : ''}`;
    },
    /** Arma la ruta equivalente a una operación de la calculadora simple. */
    cargarDesdeSimple(entradaSimple, mercadoCompra, mercadoVenta) {
      const conv = rutaDesdeSimple(entradaSimple, mercadoCompra, mercadoVenta);
      if (!conv.ok) return conv;
      reemplazar(borradorDesdeEntrada(conv.entrada, { notas: conv.notas }), 'Ruta armada desde la calculadora simple.');
      return conv;
    },
  };
}
