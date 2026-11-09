// Panel de análisis (debajo de cada resultado): escenarios adversos, sensibilidad al precio de salida,
// calculadora inversa, escala de costos y factor tiempo. Trabaja sobre una COPIA de la simulación: nunca la cambia.
// Se calcula sólo con el panel abierto (son decenas de simulaciones) para no frenar la escritura.
import { ESCENARIOS, evaluarEscenarios, sensibilidad } from '../engine/escenarios.mjs';
import { calcularInversa, escalaDeCostos, OBJETIVOS_INVERSA } from '../engine/inversa.mjs';
import { metricasTiempo } from '../routes/tiempo.mjs';
import { parseNumberAR, formatNumberAR, formatPct } from '../engine/format.mjs';
import { toDec } from '../engine/decimal.mjs';
import { corto } from '../routes/activos.mjs';
import { esc, monto, montoConSigno, numeroPrecio } from './comun.mjs';

const KEY = 'brecha.analisis.v1';

/**
 * @param {{storage: object, fecha: (iso: string) => string, getCal: () => object}} deps
 * @returns {{html: (id: string, datos: object|null) => string, enlazar: (raiz: HTMLElement, id: string, getDatos: () => object|null) => void}}
 *   datos: {entrada (ruta), motor (opciones), unidadPrecio, conTiempo, nivel}
 */
export function crearAnalisis({ storage, fecha, getCal = () => ({}) }) {
  const guardado = storage.get(KEY) ?? {};
  const estado = {
    abierto: {},
    marcados: Array.isArray(guardado.marcados) ? guardado.marcados.filter((k) => k in ESCENARIOS) : ['compra_1', 'venta_1'],
    riesgo: typeof guardado.riesgo === 'string' ? guardado.riesgo.slice(0, 20) : '',
    inversa: { tipo: 'ganancia', valor: '', paso: '0', resultado: null },
    escala: null,
  };
  const guardar = () => storage.set(KEY, { marcados: estado.marcados, riesgo: estado.riesgo });

  function tablaEscenarios(d) {
    const riesgo = parseNumberAR(estado.riesgo, { kind: 'percent' });
    const opts = { motor: d.motor, riesgoDiarioPct: riesgo.ok && !riesgo.empty ? riesgo.value : null };
    const lista = Object.keys(ESCENARIOS);
    if (estado.marcados.length > 1) lista.push(estado.marcados);
    const { base, escenarios } = evaluarEscenarios(d.entrada, lista, opts);
    if (!base.ok || !base.result.mismoActivo) return '<p class="hint">Los escenarios necesitan una simulación calculable que vuelva al activo inicial.</p>';
    const act = base.result.activoInicial;
    const filas = escenarios.map((x) => (x.ok
      ? `<tr${Array.isArray(lista[escenarios.indexOf(x)]) ? ' class="combinado"' : ''}><th scope="row">${esc(x.texto)}</th><td>${montoConSigno(x.resultadoNeto, act)}</td><td>${montoConSigno(x.diferencia, act)}</td><td>${x.diferenciaPct ? formatPct(x.diferenciaPct) : '—'}</td><td>${formatPct(x.roiPct)} <span class="unit">(${x.diferenciaRoiPts.gt(0) ? '+' : ''}${formatNumberAR(x.diferenciaRoiPts, { decimals: 2 })} pts)</span></td><td>${x.equilibrio ? numeroPrecio(x.equilibrio) : '—'}</td>${x.violaciones ? '<td>⚠ límites o liquidez</td>' : '<td></td>'}</tr>`
      : `<tr><th scope="row">${esc(x.texto)}</th><td colspan="6" class="hint">${esc(x.motivo)}</td></tr>`)).join('');
    return `<div class="table-wrap"><table class="breakdown escenarios" data-testid="escenarios">
      <thead><tr><th scope="col">Escenario</th><th scope="col">Resultado</th><th scope="col">Diferencia</th><th scope="col">Diferencia %</th><th scope="col">ROI</th><th scope="col">Equilibrio</th><th scope="col"><span class="sr-only">Avisos</span></th></tr></thead>
      <tbody><tr class="original"><th scope="row">Original</th><td>${montoConSigno(base.result.resultadoNeto, act)}</td><td>—</td><td>—</td><td>${formatPct(base.result.roiPct)}</td><td>${base.result.equilibrio ? numeroPrecio(base.result.equilibrio.precio) : '—'}</td><td></td></tr>${filas}</tbody></table></div>
      ${base.calidad.nivel !== 'completo' ? '<p class="hint">La simulación original no tiene todos los datos: los escenarios heredan esa calidad (cota máxima o estimado).</p>' : ''}`;
  }

  function graficoSensibilidad(s, d) {
    const pts = s.puntos.filter((p) => p.ok);
    if (pts.length < 2) return '';
    const xs = pts.map((p) => Number(p.precio.toString()));
    const ys = pts.map((p) => Number(p.resultadoNeto.toString()));
    const W = 320;
    const H = 150;
    const pad = 28;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
    const sy = (y) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);
    const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');
    const actual = Number(s.actual.toString());
    const eq = s.equilibrio ? Number(s.equilibrio.toString()) : null;
    const marca = (x, cls, txt) => (x >= minX && x <= maxX ? `<line x1="${sx(x).toFixed(1)}" x2="${sx(x).toFixed(1)}" y1="${pad / 2}" y2="${H - pad}" class="${cls}"/><text x="${sx(x).toFixed(1)}" y="${pad / 2 - 2}" class="lbl" text-anchor="middle">${txt}</text>` : '');
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Resultado según el precio de salida: de ${esc(numeroPrecio(pts[0].precio))} a ${esc(numeroPrecio(pts.at(-1).precio))}${eq ? `; equilibrio en ${esc(numeroPrecio(s.equilibrio))}` : ''}">
      <line x1="${pad}" x2="${W - pad}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" class="cero"/>
      ${marca(actual, 'actual', 'hoy')}${eq ? marca(eq, 'eq', 'equilibrio') : ''}
      <path d="${linea}" class="serie"/>
      <text x="${pad}" y="${H - 6}" class="lbl">${esc(numeroPrecio(pts[0].precio))}</text>
      <text x="${W - pad}" y="${H - 6}" class="lbl" text-anchor="end">${esc(numeroPrecio(pts.at(-1).precio))}</text>
    </svg><p class="hint">Eje horizontal: precio de salida (${esc(d.unidadPrecio ?? '')}). Eje vertical: resultado neto. La línea cruza el cero en el equilibrio.</p>`;
  }

  function seccionSensibilidad(d) {
    const s = sensibilidad(d.entrada, { motor: d.motor });
    if (!s.ok) return '<p class="hint">La sensibilidad necesita una simulación calculable, que vuelva al activo inicial y cuyo último paso tenga una cotización (no un libro ni una transferencia).</p>';
    const act = d.entrada.activoInicial;
    const filas = s.puntos.map((p) => `<tr${p.variacionPct === 0 ? ' class="original"' : ''}><td>${p.variacionPct > 0 ? '+' : ''}${formatNumberAR(p.variacionPct, { decimals: 1, minDecimals: 0 })} %</td><td>${numeroPrecio(p.precio)}</td><td>${p.ok ? montoConSigno(p.resultadoNeto, act) : '—'}</td><td>${p.ok ? formatPct(p.roiPct) : '—'}</td></tr>`).join('');
    return `${graficoSensibilidad(s, d)}<div class="table-wrap"><table class="breakdown" data-testid="sensibilidad"><thead><tr><th scope="col">Precio de salida</th><th scope="col">${esc(d.unidadPrecio ?? 'Precio')}</th><th scope="col">Resultado</th><th scope="col">ROI</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }

  function seccionInversa(d, id) {
    const pasos = d.entrada.pasos.map((p, i) => `<option value="${i}"${String(i) === estado.inversa.paso ? ' selected' : ''}>Paso ${i + 1}: recibir ${esc(corto(p.hacia ?? p.desde))}</option>`).join('');
    const firma = JSON.stringify(d.entrada);
    const r = estado.inversa.firma === firma ? estado.inversa.resultado : null;
    let res = '';
    if (r && !r.ok) res = `<p class="bad">${esc(r.motivo)}</p>`;
    else if (r) {
      res = `<p data-testid="inversa-resultado">Necesitás empezar con <strong>${monto(r.montoInicial, r.activo)}</strong>${r.capitalInvertido.eq(r.montoInicial) ? '' : ` (capital desembolsado ${monto(r.capitalInvertido, r.activo)}, con lo pagado aparte)`}. Con eso: capital final ${monto(r.montoFinal, d.entrada.pasos.at(-1).hacia ?? r.activo)}${r.resultadoNeto ? `, resultado ${montoConSigno(r.resultadoNeto, r.activo)} (ROI ${formatPct(r.roiPct)})` : ''}.</p>
        ${r.nivel !== 'completo' ? '<p class="hint">Faltan datos o hay hipótesis: con todos los costos haría falta más.</p>' : ''}
        ${r.violaciones.length ? `<ul class="warnings">${r.violaciones.map((v) => `<li>⚠ ${esc(v)}</li>`).join('')}</ul>` : ''}`;
    }
    const e = estado.escalaFirma === firma ? estado.escala : null;
    let escala = '';
    if (e && !e.ok) escala = `<p class="bad">${esc(e.motivo)}</p>`;
    else if (e?.sinGananciaPosible) escala = `<p data-testid="escala">Aun con un monto enorme (sin peso de los costos fijos) el ROI sería ${formatPct(e.roiLimitePct)}: <strong>no hay capital mínimo rentable</strong>.</p>`;
    else if (e) {
      escala = `<p data-testid="escala">ROI máximo posible (con un monto enorme, donde los fijos no pesan): <strong>${formatPct(e.roiLimitePct)}</strong>.</p><ul>
        <li>Capital mínimo para no perder: <strong>${e.minimoRentable ? monto(e.minimoRentable, e.activo) : '—'}</strong></li>
        ${e.umbrales.map((u) => `<li>Desde ${monto(u.monto, e.activo)}, los costos fijos se llevan como mucho el ${u.pesoPct} % de la ganancia posible.</li>`).join('')}</ul>
        <p class="hint">No contempla los máximos ni la liquidez de cada paso: revisalos para montos grandes.</p>`;
    }
    return `<div class="row two">
        <div class="field"><label for="${id}-inv-tipo">Querés</label><select id="${id}-inv-tipo" data-inv="tipo">${Object.entries(OBJETIVOS_INVERSA).map(([k, t]) => `<option value="${k}"${k === estado.inversa.tipo ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="${id}-inv-valor">Valor</label><input id="${id}-inv-valor" data-inv="valor" type="text" inputmode="decimal" value="${esc(estado.inversa.valor)}" placeholder="Ej.: 50.000"></div>
      </div>
      ${estado.inversa.tipo === 'recibir' ? `<div class="field"><label for="${id}-inv-paso">En qué paso</label><select id="${id}-inv-paso" data-inv="paso">${pasos}</select></div>` : ''}
      <div class="banner-actions"><button type="button" class="btn small" data-analisis="inversa">Calcular el capital necesario</button>
      <button type="button" class="btn ghost small" data-analisis="escala">Capital mínimo rentable y escala de costos</button></div>
      ${res}${escala}`;
  }

  function seccionTiempo(d) {
    const r = d.resultado;
    if (!r) return '';
    const m = metricasTiempo({ horas: r.tiempoTotalHoras, diasHabiles: r.tiempoDiasHabiles, roiPct: r.roiPct, inicio: new Date(), cal: getCal() });
    if (!m) return '<p class="hint">Cargá el tiempo estimado de cada paso (en "Límites, liquidez y tiempo") para ver la duración, la fecha de fin y la rentabilidad por día.</p>';
    const dias = formatNumberAR(m.dias, { decimals: 2, minDecimals: 0 });
    const anual = m.anualizadaPct !== null
      ? `<li>Anualizada <strong>${formatPct(toDec(m.anualizadaPct.toFixed(6)))}</strong> <span class="unit">proyección matemática: no es una rentabilidad garantizada ni necesariamente repetible</span></li>`
      : `<li>Anualizada: no se calcula (${m.motivoAnual === 'plazo_corto' ? 'con menos de un día exageraría' : 'fuera de escala'}).</li>`;
    const margen = r.equilibrio?.margenSeguridadPct;
    return `<ul data-testid="tiempo">
      <li>Capital inmovilizado <strong>${dias} días</strong> · fin estimado si empezás ahora: <strong>${esc(fecha(m.fin.toISOString()))}</strong> (los días hábiles saltean fines de semana y feriados del calendario)</li>
      ${m.diariaPct !== null ? `<li>Rentabilidad por día <strong>${formatPct(toDec(m.diariaPct.toFixed(8)), { decimals: 4 })}</strong></li>` : ''}
      ${anual}
      ${margen ? `<li>Riesgo de la espera: durante esos ${dias} días, si el precio de salida empeora más de <strong>${formatPct(margen, { signed: false })}</strong> (tu margen de seguridad), la operación pierde.</li>` : ''}
    </ul>`;
  }

  /** Contenido del panel. `id` ("simple" o "ruta") va en los ids: los dos paneles pueden estar abiertos a la vez. */
  function contenido(d, id) {
    if (!d) return '<p class="hint">El análisis necesita una simulación calculable.</p>';
    return `<fieldset class="analisis-esc"><legend>Escenarios adversos</legend>
        <p class="hint">Cada fila recalcula una copia de la simulación con ese cambio; la original no se toca. Marcá varios para combinarlos.</p>
        <div class="checks">${Object.entries(ESCENARIOS).map(([k, x]) => `<label class="check"><input type="checkbox" data-esc="${k}"${estado.marcados.includes(k) ? ' checked' : ''}> ${esc(x.texto)}</label>`).join('')}</div>
        <div class="field"><label for="${id}-riesgo-dia">Cuánto puede empeorar el precio de salida por día de espera <span class="unit">% (lo cargás vos; sin este dato no se calcula el retraso)</span></label>
        <input id="${id}-riesgo-dia" data-riesgo="1" type="text" inputmode="decimal" value="${esc(estado.riesgo)}" placeholder="No sé"></div>
        ${tablaEscenarios(d)}
      </fieldset>
      <fieldset><legend>Sensibilidad al precio de salida</legend>${seccionSensibilidad(d)}</fieldset>
      <fieldset><legend>Calculadora inversa</legend>${seccionInversa(d, id)}</fieldset>
      ${d.conTiempo ? `<fieldset><legend>Tiempo</legend>${seccionTiempo(d)}</fieldset>` : ''}`;
  }

  return {
    /** HTML del panel (cerrado salvo que lo hayas abierto). */
    html(id, getDatos, { conTiempo = false } = {}) {
      const abierto = !!estado.abierto[id];
      return `<details class="analisis" data-desde="profesional" data-panel-analisis="${id}"${abierto ? ' open' : ''}>
        <summary>Análisis: escenarios, sensibilidad, capital necesario${conTiempo ? ' y tiempo' : ''}</summary>
        <div class="analisis-cuerpo">${abierto ? contenido(getDatos(), id) : ''}</div></details>`;
    },
    /** Eventos del panel dentro de `raiz` (el contenedor del resultado). */
    enlazar(raiz, id, getDatos) {
      const repintar = () => {
        const p = raiz.querySelector(`[data-panel-analisis="${id}"] .analisis-cuerpo`);
        if (p) p.innerHTML = contenido(getDatos(), id);
      };
      raiz.addEventListener('toggle', (ev) => {
        const det = ev.target;
        if (det.dataset?.panelAnalisis !== id) return;
        estado.abierto[id] = det.open;
        if (det.open) repintar();
      }, true);
      raiz.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t.closest(`[data-panel-analisis="${id}"]`)) return;
        if (t.dataset.esc) {
          estado.marcados = t.checked ? [...new Set([...estado.marcados, t.dataset.esc])] : estado.marcados.filter((k) => k !== t.dataset.esc);
          guardar();
          repintar();
        } else if (t.dataset.riesgo) {
          estado.riesgo = t.value;
          guardar();
          repintar();
        } else if (t.dataset.inv) {
          estado.inversa[t.dataset.inv] = t.value;
          estado.inversa.resultado = null;
          if (t.dataset.inv === 'tipo') repintar();
        }
      });
      raiz.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-analisis]');
        if (!b || !b.closest(`[data-panel-analisis="${id}"]`)) return;
        const d = getDatos();
        if (!d) return;
        if (b.dataset.analisis === 'inversa') {
          const v = parseNumberAR(estado.inversa.valor, { kind: 'money' });
          estado.inversa.firma = JSON.stringify(d.entrada);
          estado.inversa.resultado = !v.ok || v.empty ? { ok: false, motivo: 'Cargá el valor del objetivo.' }
            : calcularInversa(d.entrada, { tipo: estado.inversa.tipo, valor: v.value.toString(), paso: Number(estado.inversa.paso) }, d.motor);
        } else if (b.dataset.analisis === 'escala') {
          estado.escalaFirma = JSON.stringify(d.entrada);
          estado.escala = escalaDeCostos(d.entrada, d.motor);
        }
        repintar();
      });
    },
    /** Al recalcular la simulación, los resultados viejos de la inversa ya no valen. */
    invalidar() {
      estado.inversa.resultado = null;
      estado.escala = null;
    },
  };
}
