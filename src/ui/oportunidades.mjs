// Matriz de escenarios: vista A (brecha bruta), vista B (resultado neto con costos) y explorador de escenarios.
// Reglas: lo no verificado nunca se presenta como oportunidad ejecutable; lo incompleto se muestra como cota
// máxima (≤), lo hipotético como estimado (≈) y lo que no tiene datos suficientes, sin número.
import { calcularMatriz } from '../engine/matrix.mjs';
import { ordenarOportunidades, CRITERIOS, GRUPOS } from '../engine/ranking.mjs';
import { formatPct, formatARSSigned, formatARS, formatNumberAR } from '../engine/format.mjs';
import { toDec } from '../engine/decimal.mjs';
import { TRATAMIENTOS } from '../engine/costos.mjs';
import { MERCADOS, IDS_MERCADOS, mercadoPorId } from '../quotes/markets.mjs';
import { ACTIVOS, corto } from '../routes/activos.mjs';
import { CAMPOS_MERCADO, MAX_CONVERSIONES, restaurarPerfil, normalizarPerfil, nuevaConversion } from '../routes/perfil.mjs';
import { evaluarCombinaciones } from '../routes/combinaciones.mjs';
import { esc, tono } from './comun.mjs';

const KEY_VISTA = 'brecha.vista.v1';
const KEY_CRITERIO = 'brecha.criterio.v1';
const KEY_PERFIL = 'brecha.perfil.v1';
const nombre = (id) => mercadoPorId(id)?.nombre ?? id;

const VISTAS = {
  bruta: {
    hint: 'Filas: dónde comprás. Columnas: dónde vendés. Compara cotizaciones de referencia; no incluye aumento, comisiones, impuestos ni conversión. Una brecha positiva no es una operación ejecutable. Tocá una celda para cargarla en la calculadora.',
    leyenda: '⏱ usa una cotización antigua · ✎ usa una cotización manual',
  },
  neta: {
    hint: 'Rentabilidad neta de cada combinación con los costos y conversiones que cargues abajo, para el monto de referencia. Es teórica: nadie confirmó estos datos. Si falta la conversión entre los dos instrumentos, no hay resultado (no se supone 1 a 1). Tocá una celda para abrirla en el simulador por pasos.',
    leyenda: '≤ como máximo (faltan costos) · ≈ estimado (usa una hipótesis tuya) · "Faltan datos" = sin resultado · ⏱ cotización antigua · ✎ cotización manual',
  },
  ranking: {
    hint: 'Compara las combinaciones y tu ruta. Los grupos no se mezclan: primero lo que confirmaste vos, después lo que tiene datos completos, lo hipotético, lo incompleto y lo que no tiene datos suficientes. Ninguna fila es una oportunidad ejecutable. No incluye comprar y vender en el mismo mercado.',
    leyenda: '≤ cota máxima · ≈ estimado · ⏱ cotización antigua · ✎ cotización manual',
  },
};
const MOTIVOS = { sin_dato: 'sin cotización', sin_monto: 'falta el monto de referencia', costos_invalidos: 'hay costos inválidos', sin_conversion: 'falta la conversión entre los dos instrumentos' };
const ESTADOS = { verificada: 'Confirmada por vos', condicionada: 'Condicionada', teorica: 'Teórica' };
const NIVEL_UI = { completo: 'Datos completos', estimado: 'Estimado', incompleto: 'Incompleto', insuficiente: 'Datos insuficientes' };
const prefijo = (nivel) => (nivel === 'incompleto' ? '≤ ' : nivel === 'estimado' ? '≈ ' : '');

/**
 * @param {{root: HTMLElement, getMercados: () => object, estadoDe: (id: string) => {estado: string}, storage: object,
 *   getSeleccion: () => string, onElegirSimple: (c: string, v: string) => void,
 *   onElegirRuta: (entrada: object, notas: object, titulo: string) => void, onIrARuta: () => void, getRutaResumen: () => object|null}} deps
 */
export function crearOportunidades({ root, getMercados, estadoDe, storage, getSeleccion, onElegirSimple, onElegirRuta, onIrARuta, getRutaResumen }) {
  let vista = Object.hasOwn(VISTAS, storage.get(KEY_VISTA)) ? storage.get(KEY_VISTA) : 'bruta';
  let criterio = Object.hasOwn(CRITERIOS, storage.get(KEY_CRITERIO)) ? storage.get(KEY_CRITERIO) : 'roi';
  let perfil = restaurarPerfil(storage.get(KEY_PERFIL));
  let cache = { clave: null, norm: null, items: [] };

  const q = (s) => root.querySelector(s);
  const el = {
    tabla: q('#matriz'), wrapTabla: q('#vista-tabla'), ranking: q('#ranking'), wrapRanking: q('#vista-ranking'),
    hint: q('#matriz-hint'), leyenda: q('#leyenda'), costos: q('#costos-netos'), campos: q('#costos-campos'),
    faltan: q('#faltan'), criterio: q('#criterio'),
  };
  el.criterio.innerHTML = Object.entries(CRITERIOS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('');
  el.criterio.value = criterio;

  function combinaciones() {
    const mercados = getMercados();
    const clave = JSON.stringify([mercados, perfil]);
    if (cache.clave !== clave) {
      const norm = normalizarPerfil(perfil);
      cache = { clave, norm, items: evaluarCombinaciones(mercados, norm) };
    }
    return cache;
  }

  function marcas(compra, venta) {
    const e = [estadoDe(compra).estado, estadoDe(venta).estado];
    const antigua = e.includes('antigua');
    const manual = e.includes('manual');
    return {
      simbolos: `${antigua ? '⏱' : ''}${manual ? '✎' : ''}`,
      texto: `${antigua ? ' Usa una cotización antigua.' : ''}${manual ? ' Usa una cotización manual.' : ''}`,
    };
  }

  const cabecera = () => `<thead><tr><th scope="col" class="corner"><span class="sr-only">Comprás en / vendés en</span><span aria-hidden="true">Compro ↓ / Vendo →</span></th>${MERCADOS.map((d) => `<th scope="col">${d.nombre}</th>`).join('')}</tr></thead>`;

  function renderBruta() {
    const m = calcularMatriz(getMercados(), IDS_MERCADOS);
    const sel = getSeleccion();
    const body = m.map((fila) => {
      const nf = nombre(fila.compra);
      const celdas = fila.celdas.map((c) => {
        const key = `${fila.compra}>${c.venta}`;
        const nc = nombre(c.venta);
        if (c.brechaPct === null) {
          return `<td><button type="button" class="cell empty" data-celda="${key}" aria-label="Comprar en ${nf} y vender en ${nc}: sin dato">—</button></td>`;
        }
        const cls = c.brechaPct.gt(0) ? 'pos' : c.brechaPct.lt(0) ? 'neg' : 'neu';
        const txt = formatPct(c.brechaPct);
        const mk = marcas(fila.compra, c.venta);
        return `<td><button type="button" class="cell ${cls}${c.mismoMercado ? ' diag' : ''}${key === sel ? ' sel' : ''}" data-celda="${key}" aria-pressed="${key === sel}" aria-label="Comprar en ${nf} y vender en ${nc}: brecha bruta ${txt}.${mk.texto} Cargar en la calculadora">${txt}${mk.simbolos ? `<span class="marca" aria-hidden="true">${mk.simbolos}</span>` : ''}</button></td>`;
      }).join('');
      return `<tr><th scope="row">${nf}</th>${celdas}</tr>`;
    }).join('');
    el.tabla.innerHTML = `${cabecera()}<tbody>${body}</tbody>`;
  }

  function renderNeta() {
    const { items, norm } = combinaciones();
    const body = IDS_MERCADOS.map((c) => {
      const nf = nombre(c);
      const celdas = IDS_MERCADOS.map((v) => {
        const it = items.find((i) => i.id === `${c}>${v}`);
        const nc = nombre(v);
        if (!it.disponible) {
          if (it.motivo === 'sin_conversion') {
            return `<td><button type="button" class="cell insuf" data-falta-conv="${it.falta.desde}>${it.falta.hacia}" aria-label="Comprar en ${nf} y vender en ${nc}: datos insuficientes, falta la conversión ${corto(it.falta.desde)} → ${corto(it.falta.hacia)}. Cargarla">Faltan datos</button></td>`;
          }
          return `<td><button type="button" class="cell empty" disabled aria-label="Comprar en ${nf} y vender en ${nc}: ${MOTIVOS[it.motivo] ?? 'sin dato'}">—</button></td>`;
        }
        const cls = tono(it.roiPct, it.nivel);
        const txt = `${prefijo(it.nivel)}${formatPct(it.roiPct)}`;
        const mk = marcas(c, v);
        const detalle = it.nivel === 'incompleto' ? ` Como máximo: faltan costos (${it.parcial.join('; ')}).` : it.nivel === 'estimado' ? ' Estimado: usa una conversión cargada como hipótesis.' : '';
        return `<td><button type="button" class="cell ${cls}${it.mismoMercado ? ' diag' : ''} nivel-${it.nivel}" data-combo="${it.id}" aria-label="Comprar en ${nf} y vender en ${nc}: resultado neto ${prefijo(it.nivel)}${formatARSSigned(it.resultadoNeto)}, ROI ${txt}, ${it.pasos} pasos.${detalle}${mk.texto} Abrir en el simulador por pasos">${txt}<span class="marca" aria-hidden="true">${mk.simbolos}</span></button></td>`;
      }).join('');
      return `<tr><th scope="row">${nf}</th>${celdas}</tr>`;
    }).join('');
    el.tabla.innerHTML = `${cabecera()}<tbody>${body}</tbody>`;

    const conversiones = [...new Set(items.filter((i) => i.motivo === 'sin_conversion').map((i) => i.faltan[0]))];
    const faltan = [...new Set(items.flatMap((i) => i.parcial ?? []))];
    const errores = [...norm.errores, ...new Set(items.flatMap((i) => i.errores ?? []))];
    el.faltan.innerHTML = (errores.length ? `<div class="viol" role="alert"><p class="res-title">Corregí estos costos</p><ul>${errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '')
      + (conversiones.length ? `<details class="pend calidad-insuf" data-testid="faltan-conversiones"><summary class="res-title">DATOS INSUFICIENTES en ${items.filter((i) => i.motivo === 'sin_conversion').length} combinaciones: faltan ${conversiones.length} conversiones</summary><ul>${conversiones.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><p class="hint">Cargalas abajo en "Conversiones entre instrumentos" (o tocá la celda). Si no sabés el valor real, podés cargar un supuesto marcándolo como hipótesis.</p></details>` : '')
      + (faltan.length ? `<details class="pend" data-testid="faltan"><summary class="res-title">Resultado incompleto: faltan ${faltan.length} datos de costos (las celdas con ≤ son una cota máxima)</summary><ul>${faltan.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : '');
  }

  const horas = (h) => (h === null || h === undefined ? '—' : `${formatNumberAR(h, { decimals: 1, minDecimals: 0 })} h`);

  function itemHTML(i) {
    const mk = i.esRuta ? { simbolos: '', texto: '' } : marcas(i.compra, i.venta);
    const attr = i.esRuta ? 'data-ruta="1"' : `data-combo="${i.id}"`;
    const accion = i.esRuta ? 'Ir al simulador por pasos' : 'Abrir en el simulador por pasos';
    const tags = [`${i.pasos} pasos`, ESTADOS[i.estado] ?? i.estado, NIVEL_UI[i.nivel] ?? '', i.faltantes ? `faltan ${i.faltantes} datos` : '', mk.simbolos].filter(Boolean).join(' · ');
    const cls = tono(i.roiPct, i.nivel);
    const p = prefijo(i.nivel);
    return `<li><button type="button" class="rank-item" ${attr} aria-label="${esc(`${i.titulo}: ROI ${p}${formatPct(i.roiPct)}, ${p}${formatARSSigned(i.resultadoNeto)}, ${tags}.${mk.texto} ${accion}`)}">
        <span class="rank-main"><span class="rank-name">${esc(i.titulo)}</span><span class="rank-tags">${esc(tags)}</span></span>
        <span class="rank-nums"><span class="rank-roi ${cls}">${p}${formatPct(i.roiPct)}</span>
        <span class="rank-sub">${p}${formatARSSigned(i.resultadoNeto)} sobre ${formatARS(i.capitalInvertido ?? i.montoInicial)} · costos ${formatPct(i.costoPct, { signed: false })}</span>
        <span class="rank-sub">Tiempo ${horas(i.tiempoHoras)} · margen de seguridad ${i.margenSeguridadPct ? formatPct(i.margenSeguridadPct) : '—'}${i.violaciones ? ` · ${i.violaciones} límites/liquidez sin cumplir` : ''}</span></span>
      </button></li>`;
  }

  function insuficienteHTML(i) {
    const que = i.faltan?.length ? i.faltan.join('; ') : MOTIVOS[i.motivo] ?? 'sin datos';
    const btn = i.falta ? ` <button type="button" class="btn ghost small" data-falta-conv="${i.falta.desde}>${i.falta.hacia}">Cargar la conversión</button>` : '';
    return `<li class="insuf-item"><span class="rank-name">${esc(i.titulo)}</span> <span class="rank-tags">DATOS INSUFICIENTES: ${esc(que)}</span>${btn}</li>`;
  }

  function renderRanking() {
    const { items } = combinaciones();
    const lista = items.filter((i) => !i.mismoMercado && (i.disponible || i.motivo === 'sin_conversion'));
    const ruta = getRutaResumen();
    if (ruta) lista.push(ruta);
    const g = ordenarOportunidades(lista, criterio);
    const seccion = (k) => {
      const xs = g[k];
      const vacio = {
        confirmadas: 'No hay rutas confirmadas por vos. Para confirmar una, abrila en el simulador por pasos y confirmá sus datos, costos y condiciones.',
        completas: 'Ninguna combinación tiene todos los costos y conversiones cargados.',
      }[k];
      if (!xs.length && !vacio) return '';
      const aviso = k === 'confirmadas' || k === 'insuficientes' ? '' : '<p class="rank-aviso">Comparación con cotizaciones de referencia: <strong>no son oportunidades ejecutables</strong>.</p>';
      return `<section aria-labelledby="rank-${k}" class="grupo grupo-${k}"><h3 id="rank-${k}" class="rank-h">${esc(GRUPOS[k])} <span class="unit">(${xs.length})</span></h3>
        ${xs.length ? `${aviso}<ol class="rank" data-testid="explorador-${k}">${k === 'insuficientes' ? xs.map(insuficienteHTML).join('') : xs.map(itemHTML).join('')}</ol>` : `<p class="hint">${esc(vacio)}</p>`}</section>`;
    };
    el.ranking.innerHTML = Object.keys(GRUPOS).map(seccion).join('');
  }

  function renderCostos() {
    const p = perfil;
    const filas = MERCADOS.map((d) => `<tr><th scope="row">${d.nombre}</th>${CAMPOS_MERCADO.map((c) => `<td><input type="text" inputmode="decimal" data-perfil="m.${d.id}.${c.k}" value="${esc(p.mercados[d.id][c.k])}" placeholder="No sé" aria-label="${d.nombre}: ${c.label} (${c.unidad})"></td>`).join('')}
      <td><select data-perfil="m.${d.id}.impuestoFiscal" aria-label="${d.nombre}: tratamiento de los impuestos">${Object.entries(TRATAMIENTOS).map(([k, t]) => `<option value="${k}"${k === p.mercados[d.id].impuestoFiscal ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
      <td><button type="button" class="btn ghost small" data-accion="na-mercado" data-id="${d.id}" aria-label="${d.nombre}: marcar los costos vacíos como no aplica">Vacíos: no aplica</button></td></tr>`).join('');
    const opts = (sel) => ACTIVOS.filter((a) => a.id !== 'ARS').map((a) => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.corto)}</option>`).join('');
    const convs = p.conversiones.map((v, i) => `<li class="conv">
        <select data-conv="${i}.desde" aria-label="Conversión ${i + 1}: desde">${opts(v.desde)}</select>
        <span aria-hidden="true">→</span>
        <select data-conv="${i}.hacia" aria-label="Conversión ${i + 1}: hacia">${opts(v.hacia)}</select>
        <input type="text" inputmode="decimal" data-conv="${i}.relacion" value="${esc(v.relacion)}" placeholder="Relación (obligatoria)" aria-label="Conversión ${i + 1}: relación (unidades de destino por 1 de origen)">
        <label class="check"><input type="checkbox" data-conv="${i}.hipotesis"${v.hipotesis ? ' checked' : ''}> Hipótesis</label>
        <input type="text" inputmode="decimal" data-conv="${i}.comisionPct" value="${esc(v.comisionPct)}" placeholder="Comisión %: no sé" aria-label="Conversión ${i + 1}: comisión %">
        <input type="text" inputmode="decimal" data-conv="${i}.fijoDestino" value="${esc(v.fijoDestino)}" placeholder="Fijo en ${esc(corto(v.hacia))}: no sé" aria-label="Conversión ${i + 1}: costo fijo en ${esc(corto(v.hacia))}">
        <button type="button" class="btn ghost small" data-accion="quitar-conv" data-i="${i}" aria-label="Quitar conversión ${i + 1}">Quitar</button>
      </li>`).join('');
    el.campos.innerHTML = `
      <div class="field monto-ref"><label for="perfil-monto">Monto de referencia <span class="unit">ARS: cada combinación arranca con este monto</span></label>
        <input id="perfil-monto" type="text" inputmode="decimal" data-perfil="montoARS" value="${esc(p.montoARS)}"></div>
      <p class="hint">Vacío = <strong>No sé</strong> (la celda sale incompleta, como cota máxima). 0 = sin costo, confirmado. Escribí «no aplica» si ese costo no existe. Las comisiones y los impuestos de compra se cobran encima de lo que pagás; la comisión de venta se descuenta de lo que recibís.</p>
      <div class="table-wrap"><table class="costos"><thead><tr><th scope="col">Mercado</th>${CAMPOS_MERCADO.map((c) => `<th scope="col">${c.label} <span class="unit">${c.unidad}</span></th>`).join('')}<th scope="col">Tratamiento de los impuestos</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${filas}</tbody></table></div>
      <p class="sub">Conversiones entre instrumentos</p>
      <p class="hint">Si una combinación compra un dólar y vende otro (por ejemplo oficial → CCL), necesita la conversión entre los dos: cuántas unidades del segundo recibís por 1 del primero. <strong>Sin esa conversión la combinación no tiene resultado</strong> (no se supone 1 a 1). Si no sabés el valor, podés cargar un supuesto marcándolo como hipótesis: la celda queda como estimada (≈).</p>
      <ul class="convs">${convs}</ul>
      <button type="button" class="btn ghost small" data-accion="agregar-conv"${p.conversiones.length >= MAX_CONVERSIONES ? ' disabled' : ''}>+ Agregar conversión</button>`;
  }

  function guardarPerfil() {
    storage.set(KEY_PERFIL, perfil);
  }

  function render() {
    for (const b of root.querySelectorAll('[data-vista]')) b.setAttribute('aria-pressed', String(b.dataset.vista === vista));
    el.hint.textContent = VISTAS[vista].hint;
    el.leyenda.textContent = VISTAS[vista].leyenda;
    el.wrapTabla.hidden = vista === 'ranking';
    el.wrapRanking.hidden = vista !== 'ranking';
    el.costos.hidden = vista === 'bruta';
    el.faltan.hidden = vista !== 'neta';
    if (vista === 'bruta') renderBruta();
    else if (vista === 'neta') renderNeta();
    else renderRanking();
  }

  /** Abre el panel de costos con una conversión nueva para ese par (o enfoca la existente). */
  function cargarConversion(par) {
    const [desde, hacia] = par.split('>');
    let i = perfil.conversiones.findIndex((v) => v.desde === desde && v.hacia === hacia);
    if (i < 0) {
      if (perfil.conversiones.length >= MAX_CONVERSIONES) return;
      perfil.conversiones.push(nuevaConversion(desde, hacia));
      i = perfil.conversiones.length - 1;
      guardarPerfil();
    }
    renderCostos();
    if (vista === 'bruta') vista = 'neta';
    render();
    el.costos.open = true;
    root.querySelector(`[data-conv="${i}.relacion"]`)?.focus();
  }

  root.addEventListener('click', (ev) => {
    const vBtn = ev.target.closest('[data-vista]');
    if (vBtn) {
      vista = vBtn.dataset.vista;
      storage.set(KEY_VISTA, vista);
      return render();
    }
    const falta = ev.target.closest('[data-falta-conv]');
    if (falta) return cargarConversion(falta.dataset.faltaConv);
    const acc = ev.target.closest('[data-accion]');
    if (acc?.dataset.accion === 'agregar-conv') {
      perfil.conversiones.push(nuevaConversion());
      guardarPerfil();
      renderCostos();
      root.querySelector(`[data-conv="${perfil.conversiones.length - 1}.relacion"]`)?.focus();
      return render();
    }
    if (acc?.dataset.accion === 'quitar-conv') {
      perfil.conversiones.splice(Number(acc.dataset.i), 1);
      guardarPerfil();
      renderCostos();
      return render();
    }
    if (acc?.dataset.accion === 'na-mercado') {
      const m = perfil.mercados[acc.dataset.id];
      for (const c of CAMPOS_MERCADO) if (!String(m[c.k] ?? '').trim()) m[c.k] = 'no aplica';
      guardarPerfil();
      renderCostos();
      return render();
    }
    const celda = ev.target.closest('[data-celda]');
    if (celda) {
      const [c, v] = celda.dataset.celda.split('>');
      return onElegirSimple(c, v);
    }
    const combo = ev.target.closest('[data-combo]');
    if (combo) {
      const it = combinaciones().items.find((i) => i.id === combo.dataset.combo);
      if (it?.disponible) onElegirRuta(it.entrada, it.notas, it.titulo);
      return undefined;
    }
    if (ev.target.closest('[data-ruta]')) onIrARuta();
    return undefined;
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t === el.criterio) {
      criterio = t.value;
      storage.set(KEY_CRITERIO, criterio);
      return render();
    }
    if (t.dataset.perfil) {
      const [a, id, k] = t.dataset.perfil.split('.');
      if (a === 'montoARS') perfil.montoARS = t.value;
      else perfil.mercados[id][k] = t.value;
    } else if (t.dataset.conv) {
      const [i, k] = t.dataset.conv.split('.');
      perfil.conversiones[Number(i)][k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'hacia') renderCostos();
    } else return undefined;
    guardarPerfil();
    return render();
  });

  renderCostos();
  return { render };
}

export { toDec };
