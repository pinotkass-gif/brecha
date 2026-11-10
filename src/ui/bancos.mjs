// "Dólar oficial en bancos" (Cotizaciones): Galicia, Nación y Macro. Nación viene de CriptoYa; Galicia se carga a mano
// porque no hay una fuente al día que el navegador pueda leer (ver src/bancos/bancos.mjs); Macro muestra de cuándo es
// su último dato. Lo cargado a mano se valida y se guarda en el navegador; todo se muestra escapado.
import { BANCOS, MANUALES, KEY_MANUAL, crearFuenteBancos, prepararBancos, validarManual, restaurarManual, comoOpciones } from '../bancos/bancos.mjs';
import { formatNumberAR } from '../engine/format.mjs';
import { esc } from './comun.mjs';

const FECHA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
/** "06/11 10:11" en hora de Buenos Aires, siempre con dos dígitos (algunos navegadores ponen "6/11"). */
function cuando(iso) {
  const p = Object.fromEntries(FECHA.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const d = (x) => String(x).padStart(2, '0');
  return `${d(p.day)}/${d(p.month)} ${d(p.hour === '24' ? '00' : p.hour)}:${d(p.minute)}`;
}
const precio = (v) => (v ? `$ ${formatNumberAR(v, { decimals: 2, minDecimals: 2 })}` : '—');
const paraCampo = (v) => (v ? formatNumberAR(v, { decimals: 4, minDecimals: 0 }) : '');
function hace(min) {
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${Math.round(min)} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

/**
 * @param {{root: HTMLElement, storage: object, fetch?: typeof fetch, ahora?: () => Date,
 *   referencia?: () => ({compra: *, venta: *} | null), avisar?: (msg: string) => void}} deps
 */
export function crearBancos({ root, storage, fetch: f, ahora = () => new Date(), referencia = () => null, avisar = () => {} }) {
  const fuente = crearFuenteBancos({ fetch: f, storage, ahora });
  let manual = restaurarManual(storage.get(KEY_MANUAL));
  let api = null; // { at, filas, origen }
  let estado = 'inicial';
  let error = '';
  let nota = '';
  let errorManual = '';
  const oyentes = [];
  const avisarCambio = () => { for (const fn of oyentes) fn(); };
  const filas = () => prepararBancos({ api: api?.filas ?? null, apiAt: api?.at ?? null, manual, ahora: ahora(), referencia: referencia() });

  function tarjeta(b) {
    const esManual = MANUALES.includes(b.id);
    const badge = b.origen === 'manual' ? (b.revisar ? '<span class="badge old">Manual · revisala</span>' : '<span class="badge manual">Manual</span>')
      : b.origen === 'api' ? '<span class="badge api">Actualizada</span>'
        : estado === 'cargando' && !api ? '<span class="badge none">Buscando…</span>' : '<span class="badge none">Sin dato al día</span>';
    let fuenteTxt;
    if (b.origen === 'manual') fuenteTxt = `La cargaste vos el ${cuando(b.fecha)} (${hace(b.edadMin)}).${b.revisar ? ' Pasó más de un día: revisala.' : ''}${b.apiAlDia ? ` CriptoYa ahora tiene un dato al día: compra ${precio(b.apiAlDia.compra)} / venta ${precio(b.apiAlDia.venta)}.` : ''}`;
    else if (b.origen === 'api') fuenteTxt = `CriptoYa · dato del ${cuando(b.fecha)} (${hace(b.edadMin)}).`;
    else if (b.apiViejo) fuenteTxt = `No hay dato al día: el último que tiene CriptoYa es del ${b.apiViejo.fecha.slice(8, 10)}/${b.apiViejo.fecha.slice(5, 7)}/${b.apiViejo.fecha.slice(0, 4)} (compra ${precio(b.apiViejo.compra)} / venta ${precio(b.apiViejo.venta)}). No se usa.${esManual ? ' Cargala a mano.' : ''}`;
    else fuenteTxt = estado === 'cargando' && !api ? 'Trayendo la cotización…' : esManual ? 'Cargala a mano: el banco no publica su cotización de forma que la app la pueda leer.' : 'Sin dato.';
    const problemas = b.motivos.filter((m) => !m.startsWith('el último dato automático')).map((m) => `<p class="problem">${esc(m)}</p>`).join('');
    const valores = esManual
      ? `<form class="banco-manual" data-banco-form="${b.id}" novalidate>
          <div class="q-row">
            <label class="q-field">Compra (te pagan)<input id="${b.id}-compra" type="text" inputmode="decimal" placeholder="Opcional" value="${esc(b.origen === 'manual' ? paraCampo(b.compra) : '')}"></label>
            <label class="q-field">Venta (pagás)<input id="${b.id}-venta" type="text" inputmode="decimal" placeholder="Obligatoria" value="${esc(b.origen === 'manual' ? paraCampo(b.venta) : '')}"></label>
          </div>
          <div class="banner-actions"><button type="submit" class="btn small primary">Guardar</button>${b.origen === 'manual' ? `<button type="button" class="btn ghost small" data-banco-borrar="${b.id}">Borrar</button>` : ''}</div>
          ${errorManual ? `<p class="card-error" role="alert">${esc(errorManual)}</p>` : ''}
        </form>`
      : `<div class="q-row"><div class="q-field">Compra (te pagan)<strong class="banco-valor">${esc(precio(b.compra))}</strong></div><div class="q-field">Venta (pagás)<strong class="banco-valor">${esc(precio(b.venta))}</strong></div></div>`;
    return `<article class="card banco" data-testid="banco-${b.id}"><header><h3>${esc(b.nombre)}</h3>${badge}</header>
      ${valores}<p class="fuente">${esc(fuenteTxt)}</p>${problemas}</article>`;
  }

  let pendiente = false;
  /** No se redibuja mientras escribís en Galicia (se perdería lo escrito); se hace al salir del campo. */
  function render({ forzar = false } = {}) {
    const act = typeof document !== 'undefined' ? document.activeElement : null;
    if (!forzar && act && root.contains(act) && act.tagName === 'INPUT') { pendiente = true; return; }
    pendiente = false;
    const lista = filas();
    root.innerHTML = `<div class="bancos-head"><h3>Dólar oficial en bancos</h3>
        <p class="hint">Compra = lo que te paga el banco por cada dólar; venta = lo que pagás. Nación viene de CriptoYa. Galicia y Macro no se pueden traer al día (CriptoYa tiene su último dato del 19/12/2025 y los bancos no lo publican de forma que la app lo pueda leer): Galicia la cargás vos.</p></div>
      <div class="cards bancos-cards">${lista.map(tarjeta).join('')}</div>
      <p class="hint" id="bancos-estado" role="status">${esc([error, api?.aviso ?? '', nota].filter(Boolean).join(' '))}</p>`;
  }

  async function actualizar(forzar = false) {
    if (estado === 'cargando') return;
    estado = 'cargando';
    nota = '';
    render();
    try {
      const r = await fuente.cargar({ forzar });
      if (r.ok) { api = r; error = ''; if (r.esperaMs) nota = `Los bancos se consultan como mucho una vez por minuto: probá en ${Math.ceil(r.esperaMs / 1000)} s.`; }
      else error = r.error;
    } catch (e) {
      error = `No pude traer las cotizaciones de los bancos (${e?.message ?? 'error'}).`;
    } finally {
      estado = 'listo';
      render();
      avisarCambio();
    }
  }

  root.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-banco-form]');
    if (!form) return;
    ev.preventDefault();
    const id = form.dataset.bancoForm;
    if (!MANUALES.includes(id)) return;
    const v = validarManual({ compra: root.querySelector(`#${id}-compra`).value, venta: root.querySelector(`#${id}-venta`).value });
    if (!v.ok) {
      errorManual = v.error;
      const escrito = { compra: root.querySelector(`#${id}-compra`).value, venta: root.querySelector(`#${id}-venta`).value };
      render({ forzar: true });
      root.querySelector(`#${id}-compra`).value = escrito.compra; // se deja lo que escribiste para corregirlo
      root.querySelector(`#${id}-venta`).value = escrito.venta;
      root.querySelector(`#${id}-venta`)?.focus();
      return;
    }
    errorManual = '';
    manual = { ...manual, [id]: { compra: v.compra, venta: v.venta, at: ahora().toISOString() } };
    storage.set(KEY_MANUAL, manual);
    render({ forzar: true });
    avisarCambio();
    avisar(`Guardé la cotización de ${BANCOS[id]}: venta $ ${formatNumberAR(v.venta, { decimals: 2, minDecimals: 2 })}${v.compra ? `, compra $ ${formatNumberAR(v.compra, { decimals: 2, minDecimals: 2 })}` : ''}. En la calculadora aparece cuando comprás o vendés el dólar oficial.`);
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-banco-borrar]');
    if (!b || !MANUALES.includes(b.dataset.bancoBorrar)) return;
    const { [b.dataset.bancoBorrar]: _, ...resto } = manual;
    manual = resto;
    storage.set(KEY_MANUAL, manual);
    errorManual = '';
    render();
    avisarCambio();
  });

  root.addEventListener('focusout', () => setTimeout(() => { if (pendiente) render(); }, 0));
  render();
  return {
    actualizar,
    render,
    /** Para las opciones de la calculadora: filas con "compra" = lo que pagás (venta del banco). */
    datosOpciones: () => ({ at: api?.at ?? null, filas: comoOpciones(filas()), cargando: estado === 'cargando' && !api }),
    estado: () => ({ estado, error, nota }),
    alCambiar: (fn) => { oyentes.push(fn); },
    /** Lleva el foco a cargar Galicia a mano. */
    enfocarManual: () => { const el = root.querySelector('#galicia-venta'); el?.scrollIntoView({ block: 'center' }); el?.focus(); },
  };
}
