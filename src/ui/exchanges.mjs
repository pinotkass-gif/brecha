// Sección "USDT en exchanges": precios de cada exchange (CriptoYa) y arbitraje teórico entre ellos.
// Consulta sólo cuando la sección se ve por primera vez (si la copia tiene más de 5 min), al cambiar el volumen
// o con su botón (como mucho una vez por minuto). Todo lo que viene de la red se muestra escapado.
import { crearFuenteExchanges, VOLUMENES, VOLUMEN_POR_DEFECTO } from '../exchanges/criptoya.mjs';
import { arbitrajes, prepararPrecios, mejores, accionCalculadora, nombreRed, nombreExchange, FAMILIAS, duracion, LIMITE_POR_DEFECTO } from '../exchanges/arbitraje.mjs';
import { formatNumberAR, parseNumberAR, formatARS, formatARSSigned } from '../engine/format.mjs';
import { toDec, round } from '../engine/decimal.mjs';
import { esc } from './comun.mjs';

export const KEY_EXCHANGES = 'brecha.exchanges.v1';
export const MERCADOS_USD = { oficial: 'dólar oficial', mep: 'dólar MEP', blue: 'dólar blue', ccl: 'dólar CCL' };
const PREF = { monto: '1.000.000', volumen: VOLUMEN_POR_DEFECTO, conComisiones: true, incluirP2P: true, familia: 'pesos', mercado: 'oficial' };
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });

function restaurar(g) {
  const p = { ...PREF };
  if (!g || typeof g !== 'object') return p;
  if (typeof g.monto === 'string' && g.monto.length <= 40) p.monto = g.monto;
  if (VOLUMENES.includes(g.volumen)) p.volumen = g.volumen;
  if (typeof g.conComisiones === 'boolean') p.conComisiones = g.conComisiones;
  if (typeof g.incluirP2P === 'boolean') p.incluirP2P = g.incluirP2P;
  if (Object.hasOwn(FAMILIAS, g.familia)) p.familia = g.familia;
  if (Object.hasOwn(MERCADOS_USD, g.mercado)) p.mercado = g.mercado;
  return p;
}
const pesos = (v) => formatARS(v);
const precioArs = (v) => `$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const precioUsd = (v) => `US$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const usdt = (v) => `${formatNumberAR(v, { decimals: 2, minDecimals: 2 })} USDT`;
const pct = (v, signo = true) => `${signo && v.gt(0) ? '+' : ''}${formatNumberAR(round(v, 2), { decimals: 2, minDecimals: 2 })} %`;
/** Lo que se carga en los campos de la calculadora va en formato argentino ("1.685,418"): "1685.418" se leería como miles. */
const campo = (x) => (typeof x === 'string' && x !== '' && x !== 'no aplica' ? formatNumberAR(toDec(x), { decimals: 12, minDecimals: 0 }) : x);
function paraCampos(a) {
  return { ...a, monto: campo(a.monto), base: campo(a.base), precioVenta: campo(a.precioVenta), conversionPct: campo(a.conversionPct), costos: { ...a.costos, transf: campo(a.costos.transf) } };
}
const tono = (v, completo) => (!completo ? 'neu' : v.gt(0) ? 'pos' : v.lt(0) ? 'neg' : 'neu');

/**
 * @param {{root: HTMLElement, seccion?: HTMLElement, storage: object, fetch?: typeof fetch, ahora?: () => Date,
 *   precioDolar?: (id: string, punta: 'compra'|'venta') => ({valor: *, texto: string} | null),
 *   onAbrirCalculadora?: (accion: object) => void}} deps
 */
export function crearExchanges({ root, seccion = root, storage, fetch: f, ahora = () => new Date(), precioDolar = () => null, onAbrirCalculadora = () => {} }) {
  const fuente = crearFuenteExchanges({ fetch: f, storage, ahora });
  let pref = restaurar(storage.get(KEY_EXCHANGES));
  let datos = null;
  let estado = 'inicial';
  let error = '';
  let nota = '';
  let ultimo = null; // último resultado de arbitrajes (para el botón de la calculadora)
  let pendiente = null;
  const guardar = () => storage.set(KEY_EXCHANGES, pref);
  const $ = (s) => root.querySelector(s);

  root.innerHTML = `
    <div class="exch-controles">
      <div class="field"><label for="exch-monto">Cuántos pesos usás</label>
        <input id="exch-monto" type="text" inputmode="decimal" value="${esc(pref.monto)}" aria-describedby="exch-monto-echo">
        <small id="exch-monto-echo" class="echo"></small></div>
      <div class="field"><label for="exch-volumen">Precios para operar</label>
        <select id="exch-volumen" aria-describedby="exch-volumen-hint">${VOLUMENES.map((v) => `<option value="${v}"${v === pref.volumen ? ' selected' : ''}>${formatNumberAR(v, { decimals: 0 })} USDT</option>`).join('')}</select>
        <small id="exch-volumen-hint" class="echo">El precio depende del monto: elegí el más parecido al tuyo.</small></div>
      <div class="exch-checks">
        <label class="check"><input type="checkbox" id="exch-comisiones"${pref.conComisiones ? ' checked' : ''}> Precios con las comisiones del exchange</label>
        <label class="check"><input type="checkbox" id="exch-p2p"${pref.incluirP2P ? ' checked' : ''}> Incluir P2P</label>
      </div>
    </div>
    <div class="exch-estado"><p id="exch-estado" role="status" aria-live="polite"></p><button type="button" class="btn small" id="exch-actualizar">Actualizar precios</button></div>
    <p id="exch-mejores" class="exch-mejores"></p>
    <div class="seg" role="group" aria-label="Recorrido del arbitraje" id="exch-familias">${Object.entries(FAMILIAS).map(([k, t]) => `<button type="button" data-exch-familia="${k}" aria-pressed="${k === pref.familia}">${esc(t)}</button>`).join('')}</div>
    <div class="field exch-mercado" id="exch-mercado-campo"${pref.familia === 'pesos' ? ' hidden' : ''}><label for="exch-mercado">Con qué dólar</label>
      <select id="exch-mercado">${Object.entries(MERCADOS_USD).map(([k, t]) => `<option value="${k}"${k === pref.mercado ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <small id="exch-mercado-src" class="src"></small></div>
    <div id="exch-ranking" aria-live="polite"></div>
    <details class="politica" id="exch-tabla-ars"><summary>Precios de cada exchange en pesos</summary><div class="table-wrap"></div></details>
    <details class="politica" id="exch-tabla-usd"><summary>Precios de cada exchange en dólares</summary><div class="table-wrap"></div></details>
    <p class="hint">Datos de <a href="https://criptoya.com" rel="noopener" target="_blank">CriptoYa</a> (sin afiliación), que los toma de cada exchange y los actualiza cada minuto. Para comprar se usa lo que pagás (ask) y para vender lo que te pagan (bid). «Con comisiones» usa el precio final que informa CriptoYa. Pasar USDT de un exchange a otro cuesta la comisión de retiro de la red más barata que tengan en común (también de CriptoYa).</p>`;

  /* ---------- Datos ---------- */
  let enCurso = null;
  /** La sección y el chat comparten la misma consulta si se piden a la vez. */
  function cargar(forzar = false) {
    if (enCurso) return enCurso;
    enCurso = cargarAhora(forzar).finally(() => { enCurso = null; });
    return enCurso;
  }
  async function cargarAhora(forzar) {
    estado = 'cargando';
    nota = '';
    $('#exch-actualizar').disabled = true;
    renderEstado();
    try {
      const r = await fuente.cargar({ volumen: pref.volumen, forzar });
      if (r.ok) {
        datos = r;
        error = '';
        if (r.esperaMs) nota = `Para no saturar a CriptoYa, el botón consulta como mucho una vez por minuto: probá en ${Math.ceil(r.esperaMs / 1000)} s.`;
      } else {
        error = r.error;
        if (r.esperaMs) nota = `Probá en ${Math.ceil(r.esperaMs / 1000)} s.`;
      }
    } catch (e) {
      error = `No pude traer los precios de los exchanges (${e?.message ?? 'error'}).`;
    } finally {
      estado = datos ? 'ok' : 'error';
      $('#exch-actualizar').disabled = false;
      render();
    }
    return datos;
  }

  /* ---------- Cuentas ---------- */
  function leerMonto() {
    const p = parseNumberAR($('#exch-monto').value, { kind: 'money' });
    if (!p.ok) return { error: p.error };
    if (p.empty || !p.value.gt(0)) return { error: 'Escribí cuántos pesos querés usar.' };
    return { valor: p.value };
  }
  function mercado() {
    const id = pref.mercado;
    const c = precioDolar(id, 'compra');
    const v = precioDolar(id, 'venta');
    return { id, nombre: MERCADOS_USD[id], compra: c?.valor ?? null, venta: v?.valor ?? null, textoCompra: c?.texto ?? '', textoVenta: v?.texto ?? '' };
  }
  function calcular() {
    const m = leerMonto();
    if (!datos || m.error) return { ok: false, error: m.error ?? '' };
    return arbitrajes({ ars: datos.ars, usd: datos.usd, fees: datos.fees, at: datos.at, monto: m.valor, familia: pref.familia, mercado: mercado(), conComisiones: pref.conComisiones, incluirP2P: pref.incluirP2P, limite: LIMITE_POR_DEFECTO });
  }

  /* ---------- Render ---------- */
  function renderEstado() {
    const el = $('#exch-estado');
    if (estado === 'cargando') { el.textContent = 'Trayendo los precios de CriptoYa…'; el.className = ''; return; }
    if (!datos) {
      el.textContent = error || 'Los precios se traen cuando abrís esta sección.';
      el.className = error ? 'error' : '';
      if (nota) el.textContent += ` ${nota}`;
      return;
    }
    const edad = Math.max(0, ahora().getTime() - Date.parse(datos.at));
    const vieja = edad > 15 * 60e3;
    el.className = vieja ? 'warn' : '';
    el.innerHTML = `Fuente: CriptoYa · precios para ${esc(formatNumberAR(datos.volumen, { decimals: 0 }))} USDT recibidos a las ${esc(HORA.format(new Date(datos.at)))} (hace ${esc(duracion(edad / 60e3))})${datos.origen === 'copia' ? ', copia guardada' : ''}${vieja ? '. <strong>Son viejos: actualizalos antes de decidir.</strong>' : '.'}`
      + [...datos.avisos, nota].filter(Boolean).map((a) => ` <span class="problem">${esc(a)}</span>`).join('');
  }

  /** Precios listos para mostrar (no dependen del monto ni del recorrido). */
  const precios = (lista) => (lista ? prepararPrecios(lista, { at: datos.at, conComisiones: pref.conComisiones, incluirP2P: pref.incluirP2P }) : null);
  function renderMejores() {
    const el = $('#exch-mejores');
    if (!datos) { el.textContent = ''; return; }
    const b = mejores(precios(datos.ars));
    el.innerHTML = [
      b.compra ? `Más barato para comprar USDT: <strong>${esc(b.compra.nombre)}</strong> a ${esc(precioArs(b.compra.compra))}` : '',
      b.venta ? `Más caro para vender: <strong>${esc(b.venta.nombre)}</strong> a ${esc(precioArs(b.venta.venta))}` : '',
    ].filter(Boolean).join(' · ');
  }

  function textoFila(x, m) {
    const red = x.paso.mismo ? 'sin pasarlos a otro exchange' : x.paso.conocida
      ? `pasás los USDT por ${esc(nombreRed(x.paso.red))} (te cobran ${esc(formatNumberAR(x.paso.retiro, { decimals: 8, minDecimals: 0 }))} USDT)`
      : 'pasás los USDT a otro exchange (no sé cuánto cuesta)';
    const A = (id) => `<strong>${esc(nombreExchange(id))}</strong>`;
    if (x.familia === 'dolares') {
      return `Comprás ${esc(`US$ ${formatNumberAR(x.dolares, { decimals: 2, minDecimals: 2 })}`)} (${esc(m.nombre)} a ${esc(precioArs(m.venta))}) → con ellos USDT en ${A(x.desde)} a ${esc(precioUsd(x.compra))} → ${red} → los vendés en ${A(x.hacia)} a ${esc(precioArs(x.venta))}`;
    }
    if (x.familia === 'adolares') {
      return `Comprás USDT en ${A(x.desde)} a ${esc(precioArs(x.compra))} → ${red} → los vendés en ${A(x.hacia)} a ${esc(precioUsd(x.venta))} → vendés los ${esc(`US$ ${formatNumberAR(x.dolares, { decimals: 2, minDecimals: 2 })}`)} (${esc(m.nombre)} a ${esc(precioArs(m.compra))})`;
    }
    return `Comprás USDT en ${A(x.desde)} a ${esc(precioArs(x.compra))} → ${red} → los vendés en ${A(x.hacia)} a ${esc(precioArs(x.venta))}`;
  }

  function renderRanking() {
    const el = $('#exch-ranking');
    const campoM = $('#exch-mercado-campo');
    campoM.hidden = pref.familia === 'pesos';
    const m = mercado();
    if (!campoM.hidden) {
      const punta = pref.familia === 'dolares' ? 'venta' : 'compra';
      $('#exch-mercado-src').textContent = m[punta]
        ? `${pref.familia === 'dolares' ? 'Comprás' : 'Vendés'} el ${m.nombre} a ${precioArs(m[punta])}: ${pref.familia === 'dolares' ? m.textoVenta : m.textoCompra}`
        : `No tengo a cuánto ${pref.familia === 'dolares' ? 'comprás' : 'vendés'} el ${m.nombre}: actualizá las cotizaciones de arriba o cargalo a mano.`;
    }
    const mm = leerMonto();
    const echo = $('#exch-monto-echo');
    echo.textContent = mm.error ? mm.error : `= ${pesos(mm.valor)}`;
    echo.className = mm.error ? 'echo bad' : 'echo';
    if (!datos) { ultimo = null; el.innerHTML = ''; return; }
    ultimo = calcular();
    if (!ultimo.ok) { el.innerHTML = ultimo.error ? `<p class="res-errors">${esc(ultimo.error)}</p>` : ''; return; }
    const r = ultimo;
    if (!r.filas.length) { el.innerHTML = '<p class="hint">No hay combinaciones con precios usables. Probá con «Incluir P2P» o actualizá los precios.</p>'; return; }
    const resumen = `De ${formatNumberAR(r.total, { decimals: 0 })} combinaciones, <strong>${formatNumberAR(r.positivas, { decimals: 0 })} dan ganancia</strong> con estos precios (antes de impuestos, IVA y otros costos que no estén en el precio).${r.sinPaso ? ` En ${formatNumberAR(r.sinPaso, { decimals: 0 })} no sé cuánto cuesta pasar los USDT: van al final y su resultado es «como máximo».` : ''} Estas son las ${r.filas.length} mejores:`;
    el.innerHTML = `<p class="rank-aviso">Es teórico: los precios son de referencia (CriptoYa) y no garantizan que puedas operar a ese precio ni por ese monto. Antes de mover plata verificá en cada exchange el precio, los límites, los medios de pago, los plazos de la transferencia y los impuestos. Brecha no opera.</p>
      <p class="hint">${resumen}</p>
      <ol class="exch-lista">${r.filas.map((x, i) => `<li class="exch-item" data-testid="arbitraje-${i}">
        <div class="exch-main">
          <p class="exch-ruta">${textoFila(x, m)}</p>
          <p class="exch-sub">${esc(usdt(x.usdt))}${x.paso.mismo || !x.paso.conocida ? '' : ` → llegan ${esc(usdt(x.neto))}`} · cobrás ${esc(pesos(x.pesos))}</p>
          ${x.notas.length ? `<ul class="exch-notas">${x.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="exch-nums">
          <span class="exch-res ${tono(x.resultado, x.completo)}">${x.completo ? '' : '<span class="badge partial">como máximo</span> '}${esc(formatARSSigned(round(x.resultado, 2)))}</span>
          <span class="rank-sub ${tono(x.resultado, x.completo)}">${esc(pct(x.pct))}</span>
          <button type="button" class="btn small" data-exch-abrir="${i}">Abrir en la calculadora</button>
        </div></li>`).join('')}</ol>`;
  }

  function tabla(lista, fiat) {
    if (!lista) return `<p class="hint">${fiat === 'USD' ? 'No tengo los precios en dólares.' : 'Sin datos.'}</p>`;
    const fmt = fiat === 'USD' ? precioUsd : precioArs;
    const orden = [...lista].sort((a, b) => (a.compra && b.compra ? a.compra.cmp(b.compra) : a.compra ? -1 : b.compra ? 1 : 0));
    const filas = orden.map((x) => {
      const spread = x.compra && x.venta ? x.compra.minus(x.venta).div(x.compra).times(100) : null;
      return `<tr${x.viejo ? ' class="exch-viejo"' : ''}><th scope="row">${esc(x.nombre)}${x.p2p ? ' <span class="badge none">P2P</span>' : ''}</th>
        <td>${x.compra ? esc(fmt(x.compra)) : 'sin oferta'}</td><td>${x.venta ? esc(fmt(x.venta)) : 'sin oferta'}</td>
        <td>${spread ? esc(pct(spread, false)) : '—'}</td><td>${x.edadMin === null ? '—' : esc(duracion(x.edadMin))}</td>
        <td>${x.motivos.length ? `<span class="problem">${esc(x.motivos.join('; '))}: no se usa</span>` : x.p2p && !pref.incluirP2P ? '<span class="hint">P2P: fuera del cálculo</span>' : ''}</td></tr>`;
    }).join('');
    return `<table class="breakdown exch-tabla"><thead><tr><th scope="col">Exchange</th><th scope="col">Comprás a</th><th scope="col">Vendés a</th><th scope="col" title="Lo que perdés si comprás y vendés en el mismo exchange">Diferencia</th><th scope="col">Dato de hace</th><th scope="col"><span class="sr-only">Estado</span></th></tr></thead><tbody>${filas}</tbody></table>`;
  }
  function renderTablas() {
    $('#exch-tabla-ars .table-wrap').innerHTML = datos ? tabla(precios(datos.ars), 'ARS') : '';
    $('#exch-tabla-usd .table-wrap').innerHTML = datos ? tabla(precios(datos.usd), 'USD') : '';
  }

  const oyentes = [];
  function render() {
    renderEstado();
    renderRanking();
    renderMejores();
    renderTablas();
    for (const f of oyentes) f(); // la calculadora muestra las mismas opciones
  }
  /** Para cambios que llegan seguido (escribir el monto, cotizaciones nuevas): una sola cuenta al final. */
  function renderLuego(ms = 250) {
    clearTimeout(pendiente);
    pendiente = setTimeout(render, ms);
  }

  /* ---------- Eventos ---------- */
  root.addEventListener('input', (ev) => {
    if (ev.target.id !== 'exch-monto') return;
    pref.monto = ev.target.value.slice(0, 40);
    guardar();
    renderLuego();
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'exch-monto') { clearTimeout(pendiente); render(); return; }
    if (t.id === 'exch-volumen' && VOLUMENES.includes(t.value)) { pref.volumen = t.value; guardar(); cargar(false); return; }
    if (t.id === 'exch-comisiones') pref.conComisiones = t.checked;
    else if (t.id === 'exch-p2p') pref.incluirP2P = t.checked;
    else if (t.id === 'exch-mercado' && Object.hasOwn(MERCADOS_USD, t.value)) pref.mercado = t.value;
    else return;
    guardar();
    render();
  });
  root.addEventListener('click', (ev) => {
    const fam = ev.target.closest('[data-exch-familia]');
    if (fam && Object.hasOwn(FAMILIAS, fam.dataset.exchFamilia)) {
      pref.familia = fam.dataset.exchFamilia;
      for (const b of root.querySelectorAll('[data-exch-familia]')) b.setAttribute('aria-pressed', String(b === fam));
      guardar();
      render();
      return;
    }
    if (ev.target.closest('#exch-actualizar')) { cargar(true); return; }
    const ab = ev.target.closest('[data-exch-abrir]');
    if (ab && ultimo?.ok) {
      const x = ultimo.filas[Number(ab.dataset.exchAbrir)];
      if (x) {
        const e = (id) => ({ id, nombre: nombreExchange(id), at: datos.at, conComisiones: pref.conComisiones });
        const exch = x.familia === 'pesos' ? { base: e(x.desde), venta: e(x.hacia) } : x.familia === 'dolares' ? { conversion: e(x.desde), venta: e(x.hacia) } : { base: e(x.desde), conversion: e(x.hacia) };
        onAbrirCalculadora({ ...paraCampos(accionCalculadora(x, { monto: ultimo.monto, conComisiones: pref.conComisiones, mercado: mercado() })), origen: 'exchanges', exch });
      }
    }
  });

  // Se consulta recién cuando la sección se ve (en el celular, al tocar su pestaña).
  let iniciado = false;
  const iniciar = () => { if (!iniciado) { iniciado = true; cargar(false); } };
  if (typeof IntersectionObserver === 'function') {
    const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { obs.disconnect(); iniciar(); } }, { rootMargin: '200px' });
    obs.observe(seccion);
  } else iniciar();
  render();

  return {
    /** Se llama cada minuto (edades) y cuando cambian las cotizaciones de los dólares. */
    refrescar: () => renderLuego(50),
    /** Datos actuales (los trae si todavía no están): para el chat. */
    async datos() { iniciado = true; return datos ?? cargar(false); },
    preferencias: () => ({ ...pref }),
    /** Lo que hay ahora, sin consultar. */
    datosActuales: () => datos,
    estado: () => ({ estado, error, nota }),
    /** Trae precios (respeta la copia de 5 min y, con forzar, el minuto de espera del botón). */
    actualizar: (forzar = false) => { iniciado = true; return cargar(forzar); },
    /** Avisa cuando cambian los datos o las preferencias. */
    alCambiar: (f) => { oyentes.push(f); },
  };
}
