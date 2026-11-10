// Chat para preguntar sobre el histórico de los dólares ("¿cómo estuvo la brecha oficial cripto los últimos 3 meses?").
// Entiende la pregunta (src/historico/preguntas.mjs), baja el histórico que haga falta (fuente.mjs) y responde con
// los datos reales (analisis.mjs): números, gráfico, tabla por mes y fuente. No es una IA y nunca inventa datos.
import { interpretar, EJEMPLOS, hoyAR, MERCADOS_HIST } from '../historico/preguntas.mjs';
import { responder, ayuda } from '../historico/analisis.mjs';
import { crearFuenteHistorico } from '../historico/fuente.mjs';
import { interpretarEscenario, calcularEscenario, MERCADOS_CALCULADORA } from '../chat/escenario.mjs';
import { interpretarExchanges, responderExchanges } from '../chat/exchanges.mjs';
import { interpretarGalicia, responderGalicia } from '../chat/bancos.mjs';
import { formatNumberAR, parseNumberAR } from '../engine/format.mjs';
import { esc } from './comun.mjs';

const KEY = 'brecha.chat.v1';
const MAX_MENSAJES = 30;
const MAX_PUNTOS_GUARDADOS = 120;
const fmtFecha = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
/** "10/11/2026, 21:57" en hora de Buenos Aires (24 h). */
const CUANDO = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const texto = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
const textos = (xs, n, largo) => (Array.isArray(xs) ? xs.slice(0, n).map((x) => texto(x, largo)).filter(Boolean) : []);

/** Valida la conversación guardada (todo se muestra escapado, pero igual se descarta lo que no tiene la forma esperada). */
function restaurar(g) {
  if (!Array.isArray(g)) return [];
  return g.slice(-MAX_MENSAJES).flatMap((m) => {
    if (!m || typeof m !== 'object') return [];
    if (m.rol === 'yo') return texto(m.texto, 500) ? [{ rol: 'yo', texto: texto(m.texto, 500) }] : [];
    if (m.rol !== 'brecha' || !m.respuesta || typeof m.respuesta !== 'object') return [];
    const r = m.respuesta;
    const tabla = r.tabla && Array.isArray(r.tabla.cabeza) && Array.isArray(r.tabla.filas)
      ? { cabeza: textos(r.tabla.cabeza, 8, 60), filas: r.tabla.filas.slice(0, 200).map((f) => textos(f, 8, 60)) } : null;
    const series = Array.isArray(r.series) ? r.series.slice(0, 7).map((s) => ({
      nombre: texto(s?.nombre, 60),
      puntos: Array.isArray(s?.puntos) ? s.puntos.filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.valor)).slice(0, 400) : [],
    })).filter((s) => s.puntos.length) : [];
    const a = r.accion;
    const accion = a && a.tipo === 'galicia' ? { tipo: 'galicia' } : a && a.tipo === 'calculadora' && a.compra in MERCADOS_CALCULADORA && a.venta in MERCADOS_CALCULADORA && ['ars', 'unidades'].includes(a.modo)
      ? { tipo: 'calculadora', compra: a.compra, venta: a.venta, modo: a.modo, monto: texto(a.monto, 40), base: texto(a.base, 40), precioVenta: texto(a.precioVenta, 40), conversionPct: texto(a.conversionPct, 40), sentido: ['cobran', 'sobreprecio', 'dan'].includes(a.sentido) ? a.sentido : 'cobran',
        ...(a.costos && typeof a.costos === 'object' ? { costos: costosGuardados(a.costos), ...(a.origen === 'exchanges' ? { origen: 'exchanges' } : {}) } : {}) } : null;
    return [{ rol: 'brecha', respuesta: { ok: r.ok === true, frases: textos(r.frases, 20, 1000), avisos: textos(r.avisos, 10, 500), tabla, series, unidad: r.unidad === '%' ? '%' : r.unidad === 'ARS' ? 'ARS' : '', fuente: texto(r.fuente, 300), accion, verExchanges: r.verExchanges === true } }];
  });
}

/** Costos de una combinación de exchanges (guardada): texto corto o null; la forma de cobro, de una lista fija. */
function costosGuardados(k) {
  const v = (x) => (typeof x === 'string' ? x.slice(0, 40) : null);
  return { comCompra: v(k.comCompra), comVenta: v(k.comVenta), transf: v(k.transf), transfCobro: ['descuenta_origen', 'descuenta_destino'].includes(k.transfCobro) ? k.transfCobro : undefined };
}

/** Menos puntos para guardar la conversación (el gráfico se ve igual). */
function paraGuardar(r) {
  return { ...r, series: (r.series ?? []).map((s) => {
    if (s.puntos.length <= MAX_PUNTOS_GUARDADOS) return s;
    const paso = s.puntos.length / MAX_PUNTOS_GUARDADOS;
    const pts = [];
    for (let i = 0; i < MAX_PUNTOS_GUARDADOS - 1; i++) pts.push(s.puntos[Math.floor(i * paso)]);
    pts.push(s.puntos.at(-1));
    return { ...s, puntos: pts };
  }) };
}

/** Gráfico de líneas (una por serie), con su nombre al final y trazos distintos (no depende sólo del color). */
function grafico(series, unidad) {
  const todos = series.flatMap((s) => s.puntos);
  if (todos.length < 2) return '';
  const W = 340;
  const H = 180;
  const pad = 34;
  const xs = todos.map((p) => Date.parse(p.fecha));
  const ys = todos.map((p) => p.valor);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (unidad === '%') { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (y) => H - 22 - ((y - y0) / (y1 - y0 || 1)) * (H - 40);
  const etq = (v) => (unidad === '%' ? `${formatNumberAR(String(Math.round(v * 100) / 100), { decimals: 2, minDecimals: 0 })} %` : `$ ${formatNumberAR(String(Math.round(v)), { decimals: 0 })}`);
  const trazos = ['', '6 3', '2 3', '10 3 2 3', '1 2', '8 2', '4 4'];
  const lineas = series.map((s, i) => {
    const d = s.puntos.map((p, k) => `${k ? 'L' : 'M'}${sx(Date.parse(p.fecha)).toFixed(1)},${sy(p.valor).toFixed(1)}`).join(' ');
    const u = s.puntos.at(-1);
    return `<path d="${d}" class="serie s-${i}" stroke-dasharray="${trazos[i % trazos.length]}"/>${series.length > 1 ? `<text x="${Math.min(W - 2, sx(Date.parse(u.fecha)) + 2).toFixed(1)}" y="${(sy(u.valor) - 3).toFixed(1)}" class="lbl" text-anchor="end">${esc(s.nombre)}</text>` : ''}`;
  }).join('');
  const cero = unidad === '%' && y0 < 0 && y1 > 0 ? `<line x1="${pad}" x2="${W - pad}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" class="cero"/>` : '';
  const desc = series.map((s) => `${s.nombre}: de ${etq(s.puntos[0].valor)} a ${etq(s.puntos.at(-1).valor)}`).join('; ');
  return `<svg class="grafico chat-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Evolución del ${fmtFecha(new Date(x0).toISOString().slice(0, 10))} al ${fmtFecha(new Date(x1).toISOString().slice(0, 10))}. ${desc}`)}">
    ${cero}${lineas}
    <text x="${pad}" y="${H - 6}" class="lbl">${esc(fmtFecha(new Date(x0).toISOString().slice(0, 10)))}</text>
    <text x="${W - pad}" y="${H - 6}" class="lbl" text-anchor="end">${esc(fmtFecha(new Date(x1).toISOString().slice(0, 10)))}</text>
    <text x="2" y="${(sy(y1) + 4).toFixed(1)}" class="lbl">${esc(etq(y1))}</text><text x="2" y="${(sy(y0) + 4).toFixed(1)}" class="lbl">${esc(etq(y0))}</text>
  </svg>`;
}

function htmlRespuesta(r, i) {
  const frases = r.frases.map((f) => `<p>${esc(f)}</p>`).join('');
  const botones = [
    r.accion ? `<button type="button" class="btn small" data-abrir-calculadora="${i}">${r.accion.tipo === 'galicia' ? 'Usarla en la calculadora' : 'Abrir en la calculadora'}</button>` : '',
    r.verExchanges ? '<button type="button" class="btn ghost small" data-ir-exchanges>Ver todo en «USDT en exchanges»</button>' : '',
  ].join('');
  const accion = botones ? `<div class="banner-actions">${botones}</div>` : '';
  const avisos = r.avisos?.length ? `<ul class="chat-avisos">${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '';
  const tabla = r.tabla ? `<details class="chat-tabla"><summary>Mes por mes</summary><div class="table-wrap"><table class="breakdown"><thead><tr>${r.tabla.cabeza.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.tabla.filas.map((f) => `<tr>${f.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div></details>` : '';
  const fuente = r.fuente ? `<p class="chat-fuente">${esc(r.fuente)}</p>` : '';
  return `${frases}${avisos}${r.ok ? grafico(r.series ?? [], r.unidad) : ''}${tabla}${fuente}${accion}`;
}

/** Ayuda cuando la simulación no se entiende. */
function ayudaEscenario(motivo) {
  return [motivo === 'mercado_no_operable'
    ? 'La simulación usa los mercados de la calculadora: oficial, blue, MEP, CCL y cripto (USDT/USDC).'
    : 'No encontré qué dólar comprás.', 'Probá así: «consigo el oficial a 1535 y compro USDT al 2 %: ¿cómo salgo si vendo?». También podés decir a cuánto vendés («si vendo a 1650»), en qué mercado («y vendo al blue») y el monto («con 5.000 dólares» o «con 1 palo»).'];
}

/**
 * @param {{root: HTMLElement, storage: {get: Function, set: Function, trySet: Function}, ahora?: () => Date, fetch?: typeof fetch}} deps
 */
export function crearChat({ root, storage, ahora = () => new Date(), fetch: f, precioDeHoy = () => null, onAbrirCalculadora = () => {}, exchanges = null, onIrAExchanges = () => {}, bancos = null }) {
  const fuente = crearFuenteHistorico({ storage, ahora, fetch: f });
  let mensajes = restaurar(storage.get(KEY));
  let ocupado = false;

  root.innerHTML = `<div class="chat">
      <ol class="chat-log" data-testid="chat-log" aria-live="polite" aria-label="Conversación"></ol>
      <div class="chat-sugerencias" role="group" aria-label="Preguntas de ejemplo">${EJEMPLOS.map((e) => `<button type="button" class="btn ghost small" data-ejemplo="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <form class="chat-form" id="chat-form" novalidate autocomplete="off">
        <label for="chat-pregunta" class="sr-only">Tu pregunta sobre el histórico</label>
        <input id="chat-pregunta" type="text" maxlength="300" enterkeyhint="send" placeholder="Ej.: ¿cómo estuvo la brecha oficial cripto los últimos 3 meses?">
        <button type="submit" class="btn primary" id="chat-enviar">Preguntar</button>
      </form>
      <p class="hint chat-pie">Responde con las cotizaciones de cierre de cada día (ArgentinaDatos), simula operaciones con el motor de la calculadora («consigo el oficial a 1535 y compro USDT al 2 %: ¿cómo salgo si vendo?») , contesta sobre USDT en los exchanges con los precios de CriptoYa («¿dónde está más barato el USDT?», «compro en Belo y vendo en Binance P2P») y carga la cotización de Galicia («galicia 1535»). No es una inteligencia artificial: entiende preguntas sobre oficial, blue, MEP, CCL, cripto, mayorista y tarjeta. <button type="button" class="btn ghost small" data-chat="borrar">Borrar la conversación</button></p>
    </div>`;
  const log = root.querySelector('.chat-log');
  const input = root.querySelector('#chat-pregunta');
  const enviar = root.querySelector('#chat-enviar');

  function guardar() {
    let lista = mensajes.slice(-MAX_MENSAJES).map((m) => (m.respuesta ? { ...m, respuesta: paraGuardar(m.respuesta) } : m));
    while (lista.length && !storage.trySet(KEY, lista)) lista = lista.slice(2); // sin lugar: se olvidan las más viejas
  }

  function render({ bajar = false } = {}) {
    log.innerHTML = mensajes.length ? mensajes.map((m, i) => (m.rol === 'yo'
      ? `<li class="chat-msg yo"><p>${esc(m.texto)}</p></li>`
      : `<li class="chat-msg brecha${m.respuesta?.ok ? '' : ' no-entendi'}${m.pendiente ? ' pendiente' : ''}" data-testid="chat-respuesta">${m.pendiente ? `<p>${esc(m.pendiente)}</p>` : htmlRespuesta(m.respuesta, i)}</li>`)).join('')
      : '<li class="chat-msg brecha vacio"><p>Preguntame por el histórico de los dólares (brechas, máximos, mínimos, promedios o cuánto estaba un día) o contame una operación para ver cómo salís. Tocá un ejemplo para empezar.</p></li>';
    if (bajar) log.lastElementChild?.scrollIntoView?.({ block: 'nearest' }); // sólo al preguntar, nunca al abrir la app
    enviar.disabled = ocupado;
  }

  async function preguntar(t) {
    const pregunta = String(t ?? '').trim().slice(0, 300);
    if (!pregunta || ocupado) return;
    ocupado = true;
    mensajes.push({ rol: 'yo', texto: pregunta });
    // ¿Cargar o consultar Galicia ("galicia 1535", "galicia compra 1485 venta 1535", "¿a cuánto está galicia?")?
    const gal = bancos ? interpretarGalicia(pregunta) : null;
    if (gal) {
      let r;
      try { r = responderGalicia(gal, bancos); } catch { r = { ok: false, frases: ['No pude guardar la cotización de Galicia: probá desde la tarjeta en Cotizaciones.'] }; }
      mensajes.push({ rol: 'brecha', respuesta: { avisos: [], series: [], tabla: null, unidad: '', fuente: '', ...r } });
      ocupado = false;
      guardar();
      render({ bajar: true });
      return;
    }
    // ¿USDT en los exchanges ("¿dónde está más barato el USDT?", "compro en Belo y vendo en Binance P2P")?
    const ex = exchanges ? interpretarExchanges(pregunta) : null;
    if (ex) {
      const msg = { rol: 'brecha', pendiente: 'Buscando los precios de los exchanges…' };
      mensajes.push(msg);
      render({ bajar: true });
      const sinDatos = { ok: false, frases: ['No pude traer los precios de los exchanges (CriptoYa). Probá de nuevo en un rato.'] };
      let r;
      try {
        const d = await exchanges.datos();
        const p = exchanges.preferencias() ?? {};
        const m = parseNumberAR(p.monto ?? '', { kind: 'money' });
        r = d ? responderExchanges(ex, d, { monto: m.ok && !m.empty ? m.value : undefined, conComisiones: p.conComisiones, incluirP2P: p.incluirP2P }) : sinDatos;
      } catch {
        r = sinDatos;
      }
      delete msg.pendiente;
      msg.respuesta = { avisos: [], series: [], tabla: null, unidad: '', fuente: '', ...r };
      ocupado = false;
      guardar();
      render({ bajar: true });
      return;
    }
    // ¿Una operación ("compro … y vendo …")? Se simula con el motor de la calculadora.
    const e = interpretarEscenario(pregunta);
    if (e) {
      let r;
      if (!e.ok) r = { ok: false, frases: ayudaEscenario(e.motivo) };
      else {
        // Precio de hoy de cada mercado; si no hay, el último cierre del histórico (y se dice de cuándo es).
        const respaldo = {};
        for (const [id, punta, dado] of [[e.esc.compra, 'venta', e.esc.precioCompra], [e.esc.venta, 'compra', e.esc.precioVenta]]) {
          if (dado || precioDeHoy(id, punta)) continue;
          const c = await fuente.cargar(id);
          if (c.ok) { const u = c.filas.at(-1); respaldo[`${id}.${punta}`] = { valor: String(u[punta]), texto: `$ ${formatNumberAR(String(u[punta]), { decimals: 2 })}, último cierre del ${fmtFecha(u.fecha)} en ArgentinaDatos, porque hoy no hay cotización` }; }
        }
        r = calcularEscenario(e.esc, (id, punta) => precioDeHoy(id, punta) ?? respaldo[`${id}.${punta}`] ?? null);
      }
      mensajes.push({ rol: 'brecha', respuesta: { avisos: [], series: [], tabla: null, unidad: '', fuente: '', ...r } });
      ocupado = false;
      guardar();
      render({ bajar: true });
      return;
    }
    const i = interpretar(pregunta, hoyAR(ahora()));
    if (!i.ok) {
      mensajes.push({ rol: 'brecha', respuesta: { ok: false, frases: ayuda(i.motivo), avisos: [], series: [], tabla: null, unidad: '', fuente: '' } });
    } else {
      const msg = { rol: 'brecha', pendiente: `Buscando el histórico de ${i.consulta.mercados.map((id) => MERCADOS_HIST[id].nombre).join(', ')}…` };
      mensajes.push(msg);
      render({ bajar: true });
      const cargas = await Promise.all(i.consulta.mercados.map((id) => fuente.cargar(id)));
      const falla = cargas.find((c) => !c.ok);
      let r;
      if (falla) {
        r = { ok: false, frases: [falla.error], avisos: [], series: [], tabla: null, unidad: '', fuente: '' };
      } else {
        const datos = Object.fromEntries(i.consulta.mercados.map((id, k) => [id, cargas[k].filas]));
        r = responder(i.consulta, datos);
        r.avisos = [...(r.avisos ?? []), ...cargas.map((c) => c.aviso).filter(Boolean)];
        const at = cargas.map((c) => c.at).sort()[0];
        r.fuente = `Fuente: ArgentinaDatos, cierre de cada día (mismos mercados que DolarAPI). Datos bajados el ${CUANDO.format(new Date(at)).replace(',', ' a las')}.`;
      }
      delete msg.pendiente;
      msg.respuesta = { avisos: [], series: [], tabla: null, unidad: '', fuente: '', ...r };
    }
    ocupado = false;
    guardar();
    render({ bajar: true });
  }

  root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = input.value;
    input.value = '';
    preguntar(t);
  });
  root.addEventListener('click', (ev) => {
    const ej = ev.target.closest('[data-ejemplo]');
    if (ej) { preguntar(ej.dataset.ejemplo); return; }
    const calc = ev.target.closest('[data-abrir-calculadora]');
    if (calc) {
      const a = mensajes[Number(calc.dataset.abrirCalculadora)]?.respuesta?.accion;
      if (a) onAbrirCalculadora(a);
      return;
    }
    if (ev.target.closest('[data-ir-exchanges]')) { onIrAExchanges(); return; }
    if (ev.target.closest('[data-chat="borrar"]')) {
      mensajes = [];
      storage.set(KEY, []);
      render();
    }
  });
  render();
  return { preguntar, mensajes: () => mensajes };
}
