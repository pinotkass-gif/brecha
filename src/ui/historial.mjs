// Panel de historial: guardar, abrir, duplicar, renombrar, anotar, borrar, comparar, exportar e importar.
import { formatARSSigned, formatARS, formatPct, formatNumberAR } from '../engine/format.mjs';
import { toDec } from '../engine/decimal.mjs';
import { crearRegistro, duplicar, exportarJSON, importarJSON, aCSV, restaurarRegistro, MAX_SIMULACIONES } from '../historial/modelo.mjs';
import { cargarHistorial, guardarHistorial } from '../historial/almacen.mjs';
import { corto } from '../routes/activos.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_COMPARAR = 4;
const ESTADOS = { teorica: 'Teórica', condicionada: 'Condicionada', verificada: 'Confirmada por vos', incompleta: 'Incompleta' };
const NIVELES_UI = { insuficiente: 'Datos insuficientes', incompleto: 'Incompleto (cota máxima)', estimado: 'Estimado (hipótesis)', completo: 'Datos completos' };

/** La traza guardada en palabras: cómo se llegó al resultado. */
function trazaTexto(t) {
  if (!t) return [];
  const n = (x, d = 2) => (x === null || x === undefined ? '—' : formatNumberAR(x, { decimals: d, minDecimals: 0 }));
  if (t.tipo === 'ruta') {
    const out = (t.pasos ?? []).map((p, i) => `Paso ${i + 1} (${p.desde} → ${p.hacia}): entregás ${n(p.entregado, 6)}, operás ${n(p.operado, 6)} a ${n(p.precio, 6)} (efectivo ${n(p.precioEfectivo, 6)}), bruto ${n(p.bruto, 6)}, recibís ${n(p.recibido, 6)}${p.costos?.length ? `; costos: ${p.costos.map((c) => `${c.concepto} ${n(c.monto, 6)} ${c.activo}${c.estado === 'desconocido' ? ' (no sé)' : ''}`).join(', ')}` : ''}${p.ajusteRedondeo && p.ajusteRedondeo !== '0' ? `; redondeo ${n(p.ajusteRedondeo, 6)}` : ''}`);
    out.push(`Capital desembolsado ${n(t.capitalInvertido)} ${t.activoInicial} → capital final ${n(t.montoFinal)} ${t.activoFinal}${t.resultadoNeto ? ` · resultado ${n(t.resultadoNeto)}` : ''} · redondeo de ejecución: ${t.redondeo}`);
    return out;
  }
  const i = t.importes ?? {};
  const v = t.valores ?? {};
  const e = t.estados ?? {};
  return [
    `Valores: monto ${n(v.monto, 4)} (${t.modoMonto}), cotización base ${n(v.cotizacionBase, 4)}, aumento ${n(v.aumentoPct, 4)} %, venta ${n(v.precioVenta, 4)}, conversión ${n(v.relacionConversion, 6)}${t.relacionHipotesis ? ' (hipótesis)' : ''}`,
    `Costos: comisión de compra ${n(v.comisionCompraPct, 4)} % (${e.comisionCompraPct}), de venta ${n(v.comisionVentaPct, 4)} % (${e.comisionVentaPct}), impuestos ${n(v.impuestoCompraPct, 4)} % (${e.impuestoCompraPct}, ${t.impuestoFiscal}), IVA ${n(v.ivaComisionesPct, 4)} % (${e.ivaComisionesPct}), otros ${n(v.otrosCostos)} (${t.cobroOtros}), transferencia ${n(v.costoTransferencia, 6)} (${t.cobroTransferencia}), slippage ${n(v.slippageVentaPct, 4)} %`,
    `Compra ${n(i.compra)} + comisión ${n(i.comisionCompra)} + IVA ${n(i.ivaCompra)} + impuestos ${n(i.impuestoCompra)} + fijos = capital desembolsado ${n(i.inversionTotal)}`,
    `Unidades recibidas ${n(i.unidadesRecibidas, 6)} × precio efectivo ${n(i.precioVentaEfectivo, 4)} = ${n(i.ingresoEfectivo)} − comisión ${n(i.comisionVenta)} − IVA ${n(i.ivaVenta)} = capital final ${n(i.capitalFinal)}`,
    `Resultado de caja ${n(i.resultadoNeto)} · ${t.redondeo}`,
  ];
}

const ESTADOS_COT = { actualizada: 'actualizada', antigua: 'antigua', manual: 'manual', no_disponible: 'sin datos' };

function monto(v, moneda) {
  if (v === null || v === undefined) return '—';
  if (!moneda || moneda === 'ARS') return formatARS(v);
  return `${formatNumberAR(v, { decimals: 4, minDecimals: 2 })} ${corto(moneda)}`;
}
function neto(s) {
  if (!s.ok) return 'Incompleta';
  if (s.resultadoNeto === null) return `Termina en ${corto(s.monedaFinal)}`;
  return s.moneda === 'ARS' ? formatARSSigned(s.resultadoNeto) : monto(s.resultadoNeto, s.moneda);
}
const tono = (s) => (!s.ok || s.resultadoNeto === null ? 'neu' : toDec(s.resultadoNeto).gt(0) ? 'pos' : toDec(s.resultadoNeto).lt(0) ? 'neg' : 'neu');

/**
 * @param {{root: HTMLElement, storage: object, fecha: (iso: string) => string, capturar: {simple: () => object, ruta: () => object},
 *   onAbrir: (r: object) => void, onActivo: () => void, avisar: (msg: string) => void}} deps
 */
export function crearHistorial({ root, storage, fecha, capturar, onAbrir, onActivo, avisar }) {
  let lista = cargarHistorial(storage);
  const activo = { simple: null, ruta: null };
  const seleccion = new Set();
  let confirmando = null;
  let mensaje = '';
  const q = (s) => root.querySelector(s);

  function persistir() {
    const r = guardarHistorial(storage, lista);
    if (!r.ok) mensaje = r.error;
    return r.ok;
  }

  function cotizacionesTexto(r) {
    return r.cotizaciones.map((c) => `${c.etiqueta}: ${c.valor ? formatNumberAR(c.valor, { decimals: 4, minDecimals: 0 }) : '—'} (${c.fuente}${c.fecha ? `, ${fecha(c.fecha)}` : ''}${c.estado ? `, ${ESTADOS_COT[c.estado] ?? c.estado}` : ''}${c.confirmada === true ? ', confirmada' : ''})`);
  }

  function itemHTML(r) {
    const s = r.resumen;
    const roi = s.ok && s.roiPct !== null ? ` · ROI ${formatPct(s.roiPct)}` : '';
    const tags = [r.tipo === 'simple' ? 'Calculadora simple' : `Por pasos${s.pasos ? ` (${s.pasos})` : ''}`];
    if (s.estado) tags.push(ESTADOS[s.estado]);
    if (s.nivel && s.nivel !== 'completo') tags.push(NIVELES_UI[s.nivel]);
    else if (!s.nivel && s.ok && s.parcial) tags.push('Parcial (motor anterior)');
    tags.push(r.motor ? `motor ${r.motor}` : 'motor anterior');
    const esActiva = activo[r.tipo] === r.id;
    const cots = cotizacionesTexto(r);
    const borrar = confirmando === r.id
      ? `<span class="confirmar" role="alert">¿Borrar «${esc(r.nombre)}»? No se puede deshacer.
          <button type="button" class="btn small peligro" data-h="borrar-si" data-id="${r.id}">Sí, borrar</button>
          <button type="button" class="btn ghost small" data-h="borrar-no">Cancelar</button></span>`
      : `<button type="button" class="btn ghost small" data-h="borrar" data-id="${r.id}" aria-label="Borrar «${esc(r.nombre)}»">Borrar</button>`;
    return `<li class="hist-item${esActiva ? ' activa' : ''}" data-id="${r.id}">
      <div class="hist-head">
        <label class="check" data-desde="avanzado"><input type="checkbox" data-h="comparar" data-id="${r.id}"${seleccion.has(r.id) ? ' checked' : ''}${!seleccion.has(r.id) && seleccion.size >= MAX_COMPARAR ? ' disabled' : ''}> <span class="sr-only">Comparar «${esc(r.nombre)}»</span><span aria-hidden="true">Comparar</span></label>
        <input type="text" class="hist-nombre" data-h="nombre" data-id="${r.id}" value="${esc(r.nombre)}" maxlength="120" aria-label="Nombre de la simulación">
      </div>
      <p class="hist-res"><strong class="${tono(s)}">${esc(neto(s))}</strong>${esc(roi)} · <span class="hist-tags">${esc(tags.join(' · '))}</span>${esActiva ? ' · <span class="badge manual">Abierta</span>' : ''}</p>
      <p class="hist-meta">Guardada ${esc(fecha(r.creadaAt))}${r.actualizadaAt !== r.creadaAt ? ` · cambios ${esc(fecha(r.actualizadaAt))}` : ''}${r.plataformas.length ? ` · Plataformas: ${esc(r.plataformas.join(', '))}` : ''}</p>
      ${cots.length ? `<details class="hist-cot"><summary>Cotizaciones usadas (${cots.length})</summary><ul>${cots.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      ${r.traza ? `<details class="hist-cot"><summary>Cómo se calculó (traza guardada)</summary><ul>${trazaTexto(r.traza).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      <textarea data-h="observaciones" data-id="${r.id}" rows="2" maxlength="2000" placeholder="Observaciones" aria-label="Observaciones de «${esc(r.nombre)}»">${esc(r.observaciones)}</textarea>
      <div class="hist-actions">
        <button type="button" class="btn small" data-h="abrir" data-id="${r.id}" aria-label="Abrir «${esc(r.nombre)}»">Abrir</button>
        <button type="button" class="btn ghost small" data-h="duplicar" data-id="${r.id}" aria-label="Duplicar «${esc(r.nombre)}»">Duplicar</button>
        ${borrar}
      </div>
    </li>`;
  }

  function comparacionHTML() {
    const sel = lista.filter((r) => seleccion.has(r.id));
    if (sel.length < 2) {
      return `<p class="hint">Marcá "Comparar" en 2 a ${MAX_COMPARAR} simulaciones para verlas lado a lado.${sel.length === 1 ? ' Falta 1.' : ''}</p>`;
    }
    const fila = (titulo, fn) => `<tr><th scope="row">${titulo}</th>${sel.map((r) => `<td>${fn(r)}</td>`).join('')}</tr>`;
    const s = (r) => r.resumen;
    return `<div class="table-wrap"><table class="comparar" data-testid="comparacion">
      <thead><tr><th scope="col"><span class="sr-only">Dato</span></th>${sel.map((r) => `<th scope="col">${esc(r.nombre)}</th>`).join('')}</tr></thead>
      <tbody>
        ${fila('Tipo', (r) => (r.tipo === 'simple' ? 'Calculadora simple' : 'Por pasos'))}
        ${fila('Guardada', (r) => esc(fecha(r.creadaAt)))}
        ${fila('Capital inicial', (r) => esc(monto(s(r).capitalInicial, s(r).moneda)))}
        ${fila('Capital final', (r) => esc(monto(s(r).capitalFinal, s(r).monedaFinal)))}
        ${fila('Resultado neto', (r) => `<strong class="${tono(s(r))}">${esc(neto(s(r)))}</strong>`)}
        ${fila('ROI neto', (r) => (s(r).ok && s(r).roiPct !== null ? formatPct(s(r).roiPct) : '—'))}
        ${fila('Costos totales', (r) => esc(monto(s(r).costosTotales, s(r).monedaFinal)))}
        ${fila('Equilibrio', (r) => (s(r).equilibrio ? `${formatNumberAR(s(r).equilibrio, { decimals: 4, minDecimals: 2 })} <span class="unit">${esc(s(r).equilibrioUnidad ?? '')}</span>` : '—'))}
        ${fila('Estado', (r) => esc([s(r).estado ? ESTADOS[s(r).estado] : 'Sin verificación (calculadora simple)', s(r).ok && s(r).parcial ? 'parcial' : ''].filter(Boolean).join(' · ')))}
        ${fila('Cotizaciones', (r) => cotizacionesTexto(r).map(esc).join('<br>') || '—')}
        ${fila('Observaciones', (r) => esc(r.observaciones) || '—')}
      </tbody></table></div>`;
  }

  function render() {
    q('#hist-cuenta').textContent = `${lista.length} de ${MAX_SIMULACIONES}`;
    q('#hist-msg').textContent = mensaje;
    q('#hist-comparar').innerHTML = lista.length >= 2 ? comparacionHTML() : '';
    q('#hist-lista').innerHTML = lista.length
      ? lista.map(itemHTML).join('')
      : '<li class="hint">Todavía no guardaste simulaciones. Usá "Guardar en el historial" en el resultado de cualquiera de los dos simuladores.</li>';
    q('#hist-exportar-json').disabled = !lista.length;
    q('#hist-exportar-csv').disabled = !lista.length;
  }

  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

  /** ¿Se va a poder volver a abrir? Se guarda sólo lo que pasa la misma validación que al recargar. */
  const recuperable = (reg) => restaurarRegistro(JSON.parse(JSON.stringify(reg))) !== null;
  const NO_RECUPERABLE = 'No se guardó: la simulación tiene datos que después no se podrían abrir (por ejemplo, números demasiado grandes). Revisá los valores.';

  /** Guarda lo que hay en el simulador; con actualizar = true pisa la simulación abierta. */
  function guardar(tipo, actualizar = false) {
    mensaje = '';
    const datos = capturar[tipo]();
    if (actualizar && activo[tipo]) {
      const i = lista.findIndex((x) => x.id === activo[tipo]);
      if (i >= 0) {
        const previo = lista[i];
        const nuevo = { ...previo, entrada: datos.entrada, cotizaciones: datos.cotizaciones, resumen: datos.resumen, plataformas: datos.plataformas, motor: datos.motor ?? null, traza: datos.traza ?? null, actualizadaAt: new Date().toISOString() };
        if (!recuperable(nuevo)) {
          avisar(NO_RECUPERABLE);
          return;
        }
        lista[i] = nuevo;
        if (persistir()) avisar(`Guardaste los cambios en «${previo.nombre}».`);
        else lista[i] = previo;
        render();
        onActivo();
        return;
      }
    }
    if (lista.length >= MAX_SIMULACIONES) {
      mensaje = `Llegaste a ${MAX_SIMULACIONES} simulaciones: exportá el historial y borrá algunas.`;
      avisar(mensaje);
      render();
      return;
    }
    const reg = crearRegistro(datos);
    if (!recuperable(reg)) {
      avisar(NO_RECUPERABLE);
      return;
    }
    lista.unshift(reg);
    if (!persistir()) {
      lista.shift();
      avisar(mensaje);
      render();
      return;
    }
    activo[tipo] = reg.id;
    avisar(`Guardada en el historial: «${reg.nombre}».`);
    render();
    onActivo();
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-h]');
    if (!b || b.type === 'checkbox') return;
    const id = b.dataset.id;
    const r = lista.find((x) => x.id === id);
    mensaje = '';
    switch (b.dataset.h) {
      case 'abrir':
        if (!r) return;
        activo[r.tipo] = r.id;
        onAbrir(r);
        render();
        onActivo();
        return;
      case 'duplicar': {
        if (!r) return;
        if (lista.length >= MAX_SIMULACIONES) { mensaje = `Llegaste a ${MAX_SIMULACIONES} simulaciones.`; break; }
        const d = duplicar(r);
        lista.splice(lista.indexOf(r), 0, d);
        if (persistir()) avisar(`Duplicaste «${r.nombre}».`);
        else lista.splice(lista.indexOf(d), 1);
        break;
      }
      case 'borrar':
        confirmando = id;
        break;
      case 'borrar-no':
        confirmando = null;
        break;
      case 'borrar-si': {
        const i = lista.findIndex((x) => x.id === id);
        if (i < 0) return;
        const [quitada] = lista.splice(i, 1);
        if (persistir()) {
          seleccion.delete(id);
          for (const t of ['simple', 'ruta']) if (activo[t] === id) activo[t] = null;
          avisar(`Borraste «${quitada.nombre}».`);
          onActivo();
        } else lista.splice(i, 0, quitada);
        confirmando = null;
        break;
      }
      case 'exportar-json':
        descargar(`brecha-historial-${hoy()}.json`, exportarJSON(lista), 'application/json');
        return;
      case 'exportar-csv':
        descargar(`brecha-historial-${hoy()}.csv`, aCSV(lista), 'text/csv;charset=utf-8');
        return;
      default:
        return;
    }
    render();
  });

  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'hist-importar') {
      const archivo = t.files?.[0];
      t.value = '';
      if (!archivo) return;
      const res = archivo.size > 5 * 1024 * 1024 ? { ok: false, error: 'El archivo es demasiado grande (más de 5 MB).' } : importarJSON(await archivo.text(), lista);
      if (!res.ok) {
        mensaje = res.error;
      } else {
        const antes = lista;
        lista = [...res.nuevos, ...lista];
        if (persistir()) {
          const partes = [`Importé ${res.nuevos.length} simulaciones`];
          if (res.repetidos) partes.push(`${res.repetidos} ya estaban`);
          if (res.invalidos) partes.push(`${res.invalidos} inválidas descartadas`);
          if (res.sinLugar) partes.push(`${res.sinLugar} no entraron (límite de ${MAX_SIMULACIONES})`);
          mensaje = `${partes.join(', ')}.`;
        } else lista = antes;
      }
      avisar(mensaje);
      render();
      return;
    }
    const id = t.dataset.id;
    const r = lista.find((x) => x.id === id);
    if (!r) return;
    if (t.dataset.h === 'comparar') {
      if (t.checked && seleccion.size < MAX_COMPARAR) seleccion.add(id);
      else seleccion.delete(id);
      render();
      root.querySelector(`[data-h="comparar"][data-id="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    if (t.dataset.h === 'nombre' || t.dataset.h === 'observaciones') {
      const campo = t.dataset.h;
      const previo = r[campo];
      r[campo] = campo === 'nombre' ? (t.value.trim().slice(0, 120) || previo) : t.value.slice(0, 2000);
      if (!persistir()) r[campo] = previo;
      render();
      onActivo();
    }
  });

  render();

  return {
    guardar,
    /** Botones de guardar para el panel de resultado de cada simulador. */
    botones(tipo) {
      const a = activo[tipo] && lista.find((x) => x.id === activo[tipo]);
      return `<div class="guardar">
        <button type="button" class="btn small" data-guardar="${tipo}">Guardar en el historial</button>
        ${a ? `<button type="button" class="btn ghost small" data-actualizar="${tipo}" title="Guardar cambios en «${esc(a.nombre)}»">Guardar cambios en «${esc(a.nombre.length > 40 ? `${a.nombre.slice(0, 39)}…` : a.nombre)}»</button>` : ''}
      </div>`;
    },
    nombreActivo: (tipo) => lista.find((x) => x.id === activo[tipo])?.nombre ?? null,
    registros: () => lista,
    cantidad: () => lista.length,
  };
}
