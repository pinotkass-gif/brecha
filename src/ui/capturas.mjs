// Capturas de cotizaciones y análisis histórico: evolución de precios, de las brechas, diferencias entre mercados,
// máximos y mínimos, y cómo habría ido una simulación guardada con los precios de cada captura.
// Las capturas las decidís vos (botón, o en cada actualización si lo activás): nunca hay consultas automáticas.
import { crearCaptura, restaurarCapturas, agregarCaptura, serie, diferencia, estadisticas, exportarCapturas, importarCapturas } from '../historial/capturas.mjs';
import { MERCADOS, mercadoPorId } from '../quotes/markets.mjs';
import { formatNumberAR } from '../engine/format.mjs';
import { esc } from './comun.mjs';

const KEY = 'brecha.capturas.v1';
const KEY_AUTO = 'brecha.capturas.auto.v1';
const TRAZOS = { oficial: '', blue: '6 3', mep: '2 3', ccl: '10 3 2 3', cripto: '1 2' };
const n = (x, d = 2) => formatNumberAR(String(Math.round(x * 10 ** d) / 10 ** d), { decimals: d, minDecimals: 0 });

/**
 * @param {{root: HTMLElement, storage: object, getMercados: () => object, fecha: (iso: string) => string, avisar: (m: string) => void,
 *   getSimulaciones: () => Array<{id: string, nombre: string, tipo: string}>, evolucion: (id: string, capturas: Array) => Array}} deps
 */
export function crearCapturas({ root, storage, getMercados, fecha, avisar, getSimulaciones, evolucion }) {
  let lista = restaurarCapturas(storage.get(KEY));
  let auto = storage.get(KEY_AUTO) === true;
  const vista = { que: 'venta', a: 'blue', b: 'oficial', sim: '', confirmarBorrado: false };

  const guardar = () => {
    try { localStorage.setItem(KEY, JSON.stringify(lista)); return true; } catch { return false; }
  };

  function grafico(series, unidad) {
    const todos = series.flatMap((s) => s.puntos);
    if (todos.length < 2) return '<p class="hint">Hacen falta al menos dos capturas para ver la evolución.</p>';
    const W = 340;
    const H = 170;
    const pad = 30;
    const xs = todos.map((p) => Date.parse(p.at));
    const ys = todos.map((p) => p.valor);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const sy = (y) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    const lineas = series.filter((s) => s.puntos.length).map((s) => {
      const d = s.puntos.map((p, i) => `${i ? 'L' : 'M'}${sx(Date.parse(p.at)).toFixed(1)},${sy(p.valor).toFixed(1)}`).join(' ');
      const u = s.puntos.at(-1);
      return `<path d="${d}" class="serie s-${s.id}" stroke-dasharray="${TRAZOS[s.id] ?? ''}"/><text x="${(sx(Date.parse(u.at)) + 2).toFixed(1)}" y="${sy(u.valor).toFixed(1)}" class="lbl">${esc(s.nombre)}</text>`;
    }).join('');
    const cero = y0 < 0 && y1 > 0 ? `<line x1="${pad}" x2="${W - pad}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" class="cero"/>` : '';
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución entre ${esc(fecha(new Date(x0).toISOString()))} y ${esc(fecha(new Date(x1).toISOString()))}: de ${n(y0)} a ${n(y1)} ${esc(unidad)}">
      ${cero}${lineas}
      <text x="${pad}" y="${H - 8}" class="lbl">${esc(fecha(new Date(x0).toISOString()))}</text>
      <text x="${W - pad}" y="${H - 8}" class="lbl" text-anchor="end">${esc(fecha(new Date(x1).toISOString()))}</text>
      <text x="4" y="${sy(y1).toFixed(1)}" class="lbl">${n(y1)}</text><text x="4" y="${sy(y0).toFixed(1)}" class="lbl">${n(y0)}</text>
    </svg><p class="hint">Cada línea tiene su trazo (no depende sólo del color) y su nombre al final. Unidad: ${esc(unidad)}.</p>`;
  }

  function tablaEstadisticas(series, unidad) {
    const filas = series.map((s) => {
      const e = estadisticas(s.puntos);
      if (!e) return `<tr><th scope="row">${esc(s.nombre)}</th><td colspan="4">Sin datos</td></tr>`;
      return `<tr><th scope="row">${esc(s.nombre)}</th><td>${n(e.ultimo.valor)}</td><td>${n(e.min.valor)} <span class="unit">${esc(fecha(e.min.at))}</span></td><td>${n(e.max.valor)} <span class="unit">${esc(fecha(e.max.at))}</span></td><td>${e.variacionPct === null ? '—' : `${e.variacionPct > 0 ? '+' : ''}${n(e.variacionPct)} %`}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="breakdown" data-testid="capturas-estadisticas"><thead><tr><th scope="col">Serie (${esc(unidad)})</th><th scope="col">Último</th><th scope="col">Mínimo</th><th scope="col">Máximo</th><th scope="col">Variación desde la primera</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }

  function seccionEvolucion() {
    const sims = getSimulaciones().filter((s) => s.tipo === 'simple');
    if (!sims.length) return '<p class="hint">Guardá una simulación de la calculadora simple para ver cómo habría dado con los precios de cada captura.</p>';
    const opts = sims.map((s) => `<option value="${esc(s.id)}"${s.id === vista.sim ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('');
    let cuerpo = '';
    if (vista.sim) {
      const puntos = evolucion(vista.sim, lista);
      const ok = puntos.filter((p) => p.ok);
      cuerpo = ok.length
        ? `${grafico([{ id: 'oficial', nombre: 'ROI', puntos: ok.map((p) => ({ at: p.at, valor: p.roiPct })) }], 'ROI neto %')}
          <div class="table-wrap"><table class="breakdown" data-testid="capturas-evolucion"><thead><tr><th scope="col">Captura</th><th scope="col">Resultado</th><th scope="col">ROI</th><th scope="col">Datos</th></tr></thead><tbody>${puntos.map((p) => `<tr><td>${esc(fecha(p.at))}</td>${p.ok ? `<td>${esc(p.resultado)}</td><td>${n(p.roiPct)} %</td><td>${esc(p.nivel)}</td>` : `<td colspan="3" class="hint">${esc(p.motivo)}</td>`}</tr>`).join('')}</tbody></table></div>
          <p class="hint">Mismos costos, monto y conversión que la simulación guardada; cambian sólo los precios de compra y venta de cada captura.</p>`
        : '<p class="hint">Con los precios de las capturas no se pudo calcular (por ejemplo, faltaba una cotización).</p>';
    }
    return `<div class="field"><label for="cap-sim">Simulación guardada</label><select id="cap-sim" data-cap="sim"><option value="">Elegí una…</option>${opts}</select></div>${cuerpo}`;
  }

  function render() {
    let series;
    let unidad;
    if (vista.que === 'diferencia') {
      series = [{ id: vista.a, nombre: `${mercadoPorId(vista.a).nombre} vs ${mercadoPorId(vista.b).nombre}`, puntos: diferencia(lista, vista.a, vista.b) }];
      unidad = '% de diferencia en la venta';
    } else {
      series = MERCADOS.filter((m) => vista.que !== 'brecha' || m.id !== 'oficial').map((m) => ({ id: m.id, nombre: m.nombre, puntos: serie(lista, m.id, vista.que) }));
      unidad = vista.que === 'brecha' ? '% contra el oficial (venta)' : 'ARS por USD (venta)';
    }
    const opcMercado = (sel) => MERCADOS.map((m) => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${esc(m.nombre)}</option>`).join('');
    root.innerHTML = `<p class="hint">Una captura es una foto de las 5 cotizaciones. Se guardan sólo cuando vos lo pedís (o al actualizar, si lo activás): Brecha nunca consulta sola. ${lista.length} capturas guardadas en este navegador.</p>
      <div class="banner-actions">
        <button type="button" class="btn small" data-cap-accion="capturar">Guardar captura ahora</button>
        <label class="check"><input type="checkbox" data-cap="auto"${auto ? ' checked' : ''}> Guardar una captura cada vez que actualizo las cotizaciones</label>
      </div>
      <div class="row two">
        <div class="field"><label for="cap-que">Ver</label><select id="cap-que" data-cap="que">${[['venta', 'Precio de venta de cada mercado'], ['compra', 'Precio de compra de cada mercado'], ['brecha', 'Brecha de cada mercado contra el oficial'], ['diferencia', 'Diferencia entre dos mercados']].map(([v, t]) => `<option value="${v}"${v === vista.que ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${vista.que === 'diferencia' ? `<div class="field"><label>Mercados<span class="with-action"><select data-cap="a" aria-label="Mercado A">${opcMercado(vista.a)}</select><select data-cap="b" aria-label="Mercado B">${opcMercado(vista.b)}</select></span></label></div>` : '<div></div>'}
      </div>
      ${grafico(series, unidad)}
      ${tablaEstadisticas(series, unidad)}
      <p class="sub">Evolución de una simulación guardada</p>
      ${seccionEvolucion()}
      <div class="banner-actions">
        <button type="button" class="btn ghost small" data-cap-accion="exportar"${lista.length ? '' : ' disabled'}>Exportar capturas</button>
        <label class="btn ghost small file-btn">Importar capturas<input type="file" data-cap="importar" accept="application/json,.json"></label>
        ${vista.confirmarBorrado ? `<span class="confirmar" role="alert">¿Borrar las ${lista.length} capturas? No se puede deshacer. <button type="button" class="btn small peligro" data-cap-accion="borrar-si">Sí, borrar</button> <button type="button" class="btn ghost small" data-cap-accion="borrar-no">Cancelar</button></span>`
    : `<button type="button" class="btn ghost small" data-cap-accion="borrar"${lista.length ? '' : ' disabled'}>Borrar todas</button>`}
      </div>`;
  }

  function capturar(motivo) {
    const r = agregarCaptura(lista, crearCaptura(getMercados(), { motivo }));
    if (!r.agregada) { if (motivo === 'manual') avisar('Las cotizaciones no cambiaron desde la última captura: no guardé otra igual.'); return; }
    const antes = lista;
    lista = r.lista;
    if (!guardar()) { lista = antes; avisar('No se pudo guardar la captura: el navegador no tiene lugar.'); return; }
    if (motivo === 'manual') avisar('Captura guardada.');
    if (root.closest('details')?.open) render();
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cap-accion]');
    if (!b) return;
    const accion = b.dataset.capAccion;
    if (accion === 'capturar') return capturar('manual');
    if (accion === 'exportar') {
      const url = URL.createObjectURL(new Blob([exportarCapturas(lista)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `brecha-capturas-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return undefined;
    }
    if (accion === 'borrar') vista.confirmarBorrado = true;
    if (accion === 'borrar-no') vista.confirmarBorrado = false;
    if (accion === 'borrar-si') { lista = []; guardar(); vista.confirmarBorrado = false; }
    return render();
  });
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    const k = t.dataset.cap;
    if (!k) return;
    if (k === 'auto') { auto = t.checked; storage.set(KEY_AUTO, auto); return; }
    if (k === 'importar') {
      const f = t.files?.[0];
      t.value = '';
      if (!f) return;
      const r = importarCapturas(await f.text(), lista);
      if (!r.ok) { avisar(r.error); return; }
      lista = r.lista;
      guardar();
      avisar(`Importé ${r.agregadas} capturas.`);
      render();
      return;
    }
    vista[k] = t.value;
    render();
  });
  root.closest('details')?.addEventListener('toggle', (ev) => { if (ev.target.open) render(); });

  return {
    render,
    /** Llamar después de una actualización exitosa: guarda una captura sólo si lo activaste. */
    alActualizar() { if (auto) capturar('actualizacion'); },
    cantidad: () => lista.length,
  };
}
