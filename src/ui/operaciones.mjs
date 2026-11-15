// Pestaña «Operaciones»: las vueltas que hizo de verdad, por día, con la ganancia calculada y (si la corrige) la real.
// La diferencia entre las dos es un costo que no tuvimos en cuenta: se muestra de varias formas para encontrar cuál
// fue, y el promedio queda como "lo aprendido" (se resta en las próximas cuentas, siempre dicho aparte).
import {
  KEY_OPERACIONES, restaurarOperaciones, nuevaOperacion, agregarOperacion, corregirOperacion, borrarOperacion,
  calcularOperacion, aprendizaje, ajustarConAprendido, porDia, totales, diaAR,
} from '../operaciones/modelo.mjs';
import { lineaOperacion } from '../chat/operaciones.mjs';
import { parseNumberAR, formatARS, formatARSSigned, formatPct, formatNumberAR } from '../engine/format.mjs';
import { esc } from './comun.mjs';
import { toDec } from '../engine/decimal.mjs';

const FECHA = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const tono = (d) => (d.gt(0) ? 'pos' : d.lt(0) ? 'neg' : '');
const ar = (v, dec = 2) => formatNumberAR(v, { decimals: dec, minDecimals: 0 });

/**
 * @param {{root: HTMLElement, storage: object, ahora?: () => Date, deCalculadora?: () => object|null, onCambio?: () => void, avisar?: (t: string) => void}} deps
 */
export function crearOperaciones({ root, storage, ahora = () => new Date(), deCalculadora = () => null, onCambio = () => {}, avisar = () => {} }) {
  let lista = restaurarOperaciones(storage.get(KEY_OPERACIONES));

  function guardar() {
    if (!storage.trySet(KEY_OPERACIONES, lista)) avisar('No pude guardar las operaciones en este navegador (¿está lleno o bloqueado?).');
    render();
    onCambio();
  }

  root.innerHTML = `
    <div class="ops-aprendido" id="ops-aprendido" data-testid="ops-aprendido" role="status"></div>
    <details class="politica ops-nueva" id="ops-nueva">
      <summary>Anotar una operación</summary>
      <form id="ops-form" class="ops-form" novalidate autocomplete="off">
        <div class="field"><label for="ops-pesos">Pesos que pusiste</label><input id="ops-pesos" type="text" inputmode="decimal" placeholder="1.000.000"></div>
        <div class="field"><label for="ops-billete">Dólar billete <span class="unit">$ por dólar</span></label><input id="ops-billete" type="text" inputmode="decimal" placeholder="1.470"></div>
        <div class="field"><label for="ops-pct">USDT al <span class="unit">% arriba del dólar</span></label><input id="ops-pct" type="text" inputmode="decimal" placeholder="2"></div>
        <div class="field"><label for="ops-venta">Vendiste cada USDT a <span class="unit">$</span></label><input id="ops-venta" type="text" inputmode="decimal" placeholder="1.680"></div>
        <div class="field"><label for="ops-donde">Dónde vendiste <span class="unit">opcional</span></label><input id="ops-donde" type="text" maxlength="60" placeholder="Binance P2P"></div>
        <div class="field"><label for="ops-dia">Día</label><input id="ops-dia" type="date"></div>
        <p class="hint ops-previa" id="ops-previa" data-testid="ops-previa" aria-live="polite"></p>
        <p class="card-error" id="ops-error" role="alert" hidden></p>
        <div class="banner-actions">
          <button type="submit" class="btn primary small" data-testid="ops-anotar">Anotar</button>
          <button type="button" class="btn ghost small" data-ops="traer">Traer lo de la calculadora</button>
        </div>
      </form>
    </details>
    <div id="ops-dias" class="ops-dias" data-testid="ops-dias"></div>
    <p class="hint">Se guarda sólo en este navegador (el celular y la compu tienen cada uno lo suyo). También podés anotarlas desde el chat: «anotá: puse 1 palo, billete a 1470, USDT al 2 %, vendí a 1680», y corregir la última con «en realidad gané 95 mil».</p>`;
  const $ = (s) => root.querySelector(s);

  const leer = (id, kind) => { const p = parseNumberAR($(id).value, { kind }); return p.ok && !p.empty ? p.value : null; };
  const datosForm = () => ({ pesos: leer('#ops-pesos', 'money'), billete: leer('#ops-billete', 'money'), pct: leer('#ops-pct', 'percent'), venta: leer('#ops-venta', 'money'), donde: $('#ops-donde').value, dia: $('#ops-dia').value });

  function previa() {
    const d = datosForm();
    const out = $('#ops-previa');
    if ([d.pesos, d.billete, d.pct, d.venta].some((v) => v === null)) { out.textContent = 'Completá los cuatro números y te muestro la ganancia antes de anotarla.'; return; }
    const r = nuevaOperacion(d, { ahora: ahora() });
    if (!r.ok) { out.textContent = r.error; return; }
    const x = calcularOperacion(r.op);
    const aj = ajustarConAprendido(x.ganancia, r.op.pesos, aprendizaje(lista));
    out.textContent = `${lineaOperacion(r.op, x)}: ganancia calculada ${formatARSSigned(x.ganancia)} (${formatPct(x.gananciaPct)})${aj ? `; con lo aprendido, unos ${formatARSSigned(aj)}` : ''}.`;
  }

  /** Anota una operación (desde el formulario, la calculadora, el chat o Claude). */
  function anotar(d, origen = 'mano') {
    const r = nuevaOperacion(d, { ahora: ahora(), origen });
    if (!r.ok) return r;
    const apr = aprendizaje(lista);
    lista = agregarOperacion(lista, r.op);
    guardar();
    const calc = calcularOperacion(r.op);
    return { ok: true, op: r.op, calc, apr, ajustada: ajustarConAprendido(calc.ganancia, r.op.pesos, apr) };
  }

  /** Corrige una (la última si no se dice cuál). cobrado = true: el número es lo que le quedó, no la ganancia. */
  function corregir({ id = null, real, motivo = '', cobrado = false }) {
    const op = id ? lista.find((o) => o.id === id) : [...lista].sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).at(-1);
    if (!op) return { ok: false, error: 'Todavía no hay operaciones anotadas para corregir.' };
    let valor = real;
    if (cobrado && valor !== null && valor !== undefined) {
      try { valor = toDec(String(valor)).minus(toDec(op.pesos)); } catch { /* lo valida corregirOperacion */ }
    }
    const r = corregirOperacion(lista, op.id, { real: valor === null || valor === undefined ? null : String(valor), motivo }, { ahora: ahora() });
    if (!r.ok) return r;
    lista = r.lista;
    guardar();
    return { ok: true, op: r.op, calc: calcularOperacion(r.op), apr: aprendizaje(lista) };
  }

  function htmlAprendido() {
    const a = aprendizaje(lista);
    if (!lista.length) return '<p><strong>Todavía no anotaste operaciones.</strong> Cada vez que des una vuelta, anotala acá, con «Anotar como hecha» en la calculadora o desde el chat. Yo calculo la ganancia y la sumo por día.</p>';
    if (!a.n) return '<p><strong>Lo aprendido:</strong> todavía nada. Cuando una operación te dé distinto de la cuenta, tocá «Corregir con lo que gané» y poné lo que ganaste de verdad: la diferencia es un costo que no tuvimos en cuenta y lo voy a restar en las próximas cuentas.</p>';
    const motivos = a.motivos.length ? ` Costos que anotaste: ${a.motivos.slice(0, 5).map((m) => `${esc(m.motivo)} (${m.veces} ${m.veces === 1 ? 'vez' : 'veces'}, ${formatARS(m.pesos)})`).join('; ')}.` : '';
    const rango = a.n > 1 ? ` Fue de ${formatPct(a.minPct)} a ${formatPct(a.maxPct)}.` : '';
    const que = a.costoPct.abs().lt('0.005') ? 'la cuenta dio igual que la realidad' : a.costoPct.gt(0)
      ? `en la realidad ganás en promedio <strong>${formatPct(a.costoPct, { signed: false })} de lo que ponés menos</strong> que la cuenta (${formatARS(a.costoPesos)} en total)`
      : `en la realidad ganás en promedio <strong>${formatPct(a.costoPct.neg(), { signed: false })} de lo que ponés más</strong> que la cuenta`;
    return `<p><strong>Lo aprendido</strong> de ${a.n} ${a.n === 1 ? 'operación corregida' : 'operaciones corregidas'}: ${que}.${rango}${motivos} ${a.costoPct.gt(0) ? 'Lo resto aparte en las próximas cuentas (en la calculadora y al anotar).' : ''}</p>${a.n < 3 ? '<p class="hint">Con pocas corregidas es sólo una pista: cuantas más corrijas, más fino queda.</p>' : ''}`;
  }

  function htmlOperacion(op, x) {
    const corr = x.real === null ? '' : x.dif.abs().lt(1)
      ? `<p class="ops-real" data-testid="ops-real">Ganaste de verdad <strong>${formatARSSigned(x.real)}</strong>: igual que la cuenta.</p>`
      : `<p class="ops-real" data-testid="ops-real">Ganaste de verdad <strong class="${tono(x.real)}">${formatARSSigned(x.real)}</strong> (${formatPct(x.realPct)}). ${x.dif.gt(0)
        ? `Se nos pasaron <strong>${formatARS(x.dif)}</strong> (${formatPct(x.difPct, { signed: false })} de lo que pusiste)${op.motivo ? `: ${esc(op.motivo)}` : ''}.</p>
           <p class="hint" data-testid="ops-equivale">Equivale a que el billete te saliera ${formatARS(x.equivale.billeteMasCaro)} más caro, a que te pagaran ${formatARS(x.equivale.ventaMenos)} menos por USDT, a una comisión de ${formatPct(x.equivale.comisionVentaPct, { signed: false })} al vender, o a ${ar(x.equivale.usdtMenos)} USDT de menos.`
        : `Ganaste ${formatARS(x.dif.neg())} más que la cuenta${op.motivo ? `: ${esc(op.motivo)}` : ''}.`}</p>`;
    return `<li class="ops-item" data-op="${esc(op.id)}" data-testid="ops-item">
      <p class="ops-linea">${esc(lineaOperacion(op, x))}</p>
      <p>Ganancia calculada <strong class="${tono(x.ganancia)}" data-testid="ops-calculada">${formatARSSigned(x.ganancia)}</strong> (${formatPct(x.gananciaPct)})</p>
      ${corr}
      <details class="ops-corregir">
        <summary data-testid="ops-corregir">${x.real === null ? 'Corregir con lo que gané' : 'Cambiar la corrección'}</summary>
        <form class="ops-form-corregir" data-corregir="${esc(op.id)}" novalidate autocomplete="off">
          <div class="field"><label for="ops-real-${esc(op.id)}">Lo que ganaste de verdad <span class="unit">$; si perdiste, con «-»</span></label><input id="ops-real-${esc(op.id)}" name="real" type="text" inputmode="decimal" value="${x.real === null ? '' : esc(ar(x.real))}"></div>
          <div class="field"><label for="ops-motivo-${esc(op.id)}">¿Qué costo se nos pasó? <span class="unit">opcional</span></label><input id="ops-motivo-${esc(op.id)}" name="motivo" type="text" maxlength="120" placeholder="Comisión del arbolito, transferencia…" value="${esc(op.motivo)}"></div>
          <p class="card-error" role="alert" hidden></p>
          <div class="banner-actions">
            <button type="submit" class="btn small">Guardar</button>
            ${x.real === null ? '' : '<button type="button" class="btn ghost small" data-ops="sin-corregir">Sacar la corrección</button>'}
            <button type="button" class="btn ghost small" data-ops="borrar">Borrar la operación</button>
          </div>
        </form>
      </details>
    </li>`;
  }

  function render() {
    $('#ops-aprendido').innerHTML = htmlAprendido();
    const hoy = diaAR(ahora());
    const ayer = diaAR(new Date(ahora().getTime() - 86400000));
    const t = totales(lista);
    const resumen = lista.length ? `<p class="ops-total" data-testid="ops-total">En total: ${t.n} ${t.n === 1 ? 'vuelta' : 'vueltas'} en ${t.dias} ${t.dias === 1 ? 'día' : 'días'}, ganancia <strong class="${tono(t.ganancia)}">${formatARSSigned(t.ganancia)}</strong>${t.corregidas < t.n ? ` (${t.corregidas ? `${t.corregidas} con lo real y el resto calculado` : 'calculada'})` : ' (todo con lo real)'}.</p>` : '';
    $('#ops-dias').innerHTML = resumen + porDia(lista).map((d) => {
      const nombre = d.dia === hoy ? 'Hoy' : d.dia === ayer ? 'Ayer' : FECHA.format(new Date(`${d.dia}T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase());
      const nota = d.corregidas === d.n ? 'con lo real' : d.corregidas ? `${d.corregidas} de ${d.n} con lo real` : 'calculada';
      return `<section class="ops-dia" data-testid="ops-dia" data-dia="${d.dia}">
        <h3>${esc(nombre)} <span class="unit">${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}</span></h3>
        <p class="ops-dia-total" data-testid="ops-dia-total">${d.n} ${d.n === 1 ? 'vuelta' : 'vueltas'} · pusiste ${formatARS(d.pesos, { decimals: 0 })} · ganancia <strong class="${tono(d.ganancia)}">${formatARSSigned(d.ganancia)}</strong> (${formatPct(d.gananciaPct)}, ${nota})</p>
        <ol class="ops-lista">${[...d.ops].reverse().map(({ op, calc }) => htmlOperacion(op, calc)).join('')}</ol>
      </section>`;
    }).join('');
    const cuenta = document.getElementById('ops-cuenta');
    if (cuenta) cuenta.textContent = lista.length ? `(${lista.length})` : '';
  }

  function llenar(d) {
    if (!d) return false;
    for (const [k, id] of [['pesos', '#ops-pesos'], ['billete', '#ops-billete'], ['pct', '#ops-pct'], ['venta', '#ops-venta'], ['donde', '#ops-donde']]) if (d[k] !== null && d[k] !== undefined) $(id).value = String(d[k]);
    previa();
    return true;
  }

  root.addEventListener('input', (ev) => { if (ev.target.closest('#ops-form')) previa(); });
  root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.id === 'ops-form') {
      const r = anotar(datosForm(), 'mano');
      const err = $('#ops-error');
      if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
      err.hidden = true;
      for (const id of ['#ops-pesos', '#ops-venta']) $(id).value = ''; // billete, % y lugar suelen repetirse en la vuelta siguiente
      previa();
      avisar('Operación anotada.');
      return;
    }
    if (f.dataset.corregir) {
      const raw = f.elements.real.value.trim();
      const p = parseNumberAR(raw.replace(/^[-−]\s*/, ''), { kind: 'money' });
      const err = f.querySelector('.card-error');
      if (!raw || !p.ok || p.empty) { err.textContent = 'Escribí cuánto ganaste en pesos (por ejemplo 95.000, o -5.000 si perdiste).'; err.hidden = false; return; }
      const real = /^[-−]/.test(raw) ? p.value.neg() : p.value;
      const r = corregir({ id: f.dataset.corregir, real: real.toString(), motivo: f.elements.motivo.value });
      if (!r.ok) { err.textContent = r.error; err.hidden = false; }
    }
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ops]');
    if (!b) return;
    const id = b.closest('[data-op]')?.dataset.op;
    if (b.dataset.ops === 'traer') {
      if (!llenar(deCalculadora())) { $('#ops-error').textContent = 'La calculadora no tiene cargada tu operativa (pesos → billete → USDT → pesos) con todos los números.'; $('#ops-error').hidden = false; } else $('#ops-error').hidden = true;
    } else if (b.dataset.ops === 'sin-corregir' && id) corregir({ id, real: null });
    else if (b.dataset.ops === 'borrar' && id) {
      if (!globalThis.confirm?.('¿Borrar esta operación? No se puede deshacer.')) return;
      lista = borrarOperacion(lista, id);
      guardar();
    }
  });

  $('#ops-dia').value = diaAR(ahora());
  $('#ops-dia').max = diaAR(ahora());
  render();
  previa();
  return {
    anotar, corregir, render,
    lista: () => lista,
    aprendizaje: () => aprendizaje(lista),
    porDia: () => porDia(lista),
    hoy: () => diaAR(ahora()),
    ayer: () => diaAR(new Date(ahora().getTime() - 86400000)),
    abrirFormulario: (d) => { $('#ops-nueva').open = true; llenar(d); },
  };
}
