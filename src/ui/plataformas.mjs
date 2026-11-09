// Editor de "Mis plataformas": perfiles locales de costos para cargar en las rutas con un clic.
import { TIPOS_PLATAFORMA, COBROS_PERFIL, nuevaPlataforma, nuevoCostoPerfil, nuevaRed, restaurarPlataformas, hoy, MAX_PLATAFORMAS } from '../routes/plataformas.mjs';
import { ACTIVOS } from '../routes/activos.mjs';
import { esc, opcionesFiscal } from './comun.mjs';

export const KEY_PLATAFORMAS = 'brecha.plataformas.v1';

/** @param {{root: HTMLElement, storage: object, onCambio: () => void}} deps */
export function crearPlataformas({ root, storage, onCambio = () => {} }) {
  let lista = restaurarPlataformas(storage.get(KEY_PLATAFORMAS));
  let confirmando = null;
  const opciones = (pares, sel) => pares.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const guardar = () => { storage.set(KEY_PLATAFORMAS, lista); onCambio(); };

  function htmlPlataforma(p, i) {
    const k = (x) => `${i}.${x}`;
    const costos = p.costos.map((c, j) => `<li class="costo"><div class="costo-top">
        <input type="text" data-pl="${k(`c${j}.concepto`)}" value="${esc(c.concepto)}" aria-label="${esc(p.nombre || 'Plataforma')}: nombre del costo ${j + 1}" class="costo-nombre">
        <select data-pl="${k(`c${j}.clase`)}" aria-label="Tipo">${opciones([['pct', '%'], ['fijo', 'Importe fijo']], c.clase)}</select>
        <input type="text" inputmode="decimal" data-pl="${k(`c${j}.valor`)}" value="${esc(c.valor)}" placeholder="No sé" aria-label="${esc(c.concepto)}: valor">
        <select data-pl="${k(`c${j}.cobro`)}" aria-label="${esc(c.concepto)}: cómo se cobra">${opciones(Object.entries(COBROS_PERFIL), c.cobro)}</select>
        ${c.clase === 'pct' ? `<input type="text" inputmode="decimal" data-pl="${k(`c${j}.minimo`)}" value="${esc(c.minimo)}" placeholder="Mínimo" aria-label="${esc(c.concepto)}: mínimo">` : ''}
        <select data-pl="${k(`c${j}.fiscal`)}" aria-label="${esc(c.concepto)}: tratamiento">${opcionesFiscal(c.fiscal)}</select>
        <button type="button" class="btn ghost small" data-pl-accion="quitar-costo" data-i="${i}" data-j="${j}">Quitar</button></div></li>`).join('');
    const redes = p.redes.map((r, j) => `<li class="red"><input type="text" data-pl="${k(`r${j}.red`)}" value="${esc(r.red)}" placeholder="Red (TRC20…)" aria-label="Red ${j + 1}">
        <input type="text" inputmode="decimal" data-pl="${k(`r${j}.retiro`)}" value="${esc(r.retiro)}" placeholder="Comisión de retiro: no sé" aria-label="Red ${j + 1}: comisión de retiro">
        <input type="text" inputmode="decimal" data-pl="${k(`r${j}.minimoRetiro`)}" value="${esc(r.minimoRetiro)}" placeholder="Mínimo de retiro" aria-label="Red ${j + 1}: mínimo de retiro">
        <input type="text" inputmode="decimal" data-pl="${k(`r${j}.tiempo`)}" value="${esc(r.tiempo)}" placeholder="Horas de acreditación" aria-label="Red ${j + 1}: horas de acreditación">
        <button type="button" class="btn ghost small" data-pl-accion="quitar-red" data-i="${i}" data-j="${j}">Quitar</button></li>`).join('');
    const borrar = confirmando === p.id
      ? `<span class="confirmar" role="alert">¿Borrar «${esc(p.nombre || 'sin nombre')}»? <button type="button" class="btn small peligro" data-pl-accion="borrar-si" data-i="${i}">Sí, borrar</button> <button type="button" class="btn ghost small" data-pl-accion="borrar-no">Cancelar</button></span>`
      : `<button type="button" class="btn ghost small" data-pl-accion="borrar" data-i="${i}">Borrar</button>`;
    return `<li class="plataforma" data-testid="plataforma-${i}">
      <div class="row two"><div class="field"><label>Nombre<input type="text" data-pl="${k('nombre')}" value="${esc(p.nombre)}" maxlength="80" placeholder="Ej.: Mi exchange"></label></div>
        <div class="field"><label>Tipo<select data-pl="${k('tipo')}">${opciones(Object.entries(TIPOS_PLATAFORMA), p.tipo)}</select></label></div></div>
      <div class="row two"><div class="field"><label>Tarifas revisadas el<input type="date" data-pl="${k('actualizado')}" value="${esc(p.actualizado)}"></label></div>
        <div class="field"><label>Horarios<input type="text" data-pl="${k('horarios')}" value="${esc(p.horarios)}" placeholder="Ej.: días hábiles de 10 a 17"></label></div></div>
      <p class="sub">Costos</p><ul class="costos-lista">${costos}</ul>
      <div class="banner-actions"><button type="button" class="btn ghost small" data-pl-accion="costo-pct" data-i="${i}">+ Costo %</button><button type="button" class="btn ghost small" data-pl-accion="costo-fijo" data-i="${i}">+ Costo fijo</button></div>
      <div class="row two"><div class="field"><label>Mínimo por operación<input type="text" inputmode="decimal" data-pl="${k('minimo')}" value="${esc(p.minimo)}" placeholder="Sin dato"></label></div>
        <div class="field"><label>Máximo por operación<input type="text" inputmode="decimal" data-pl="${k('maximo')}" value="${esc(p.maximo)}" placeholder="Sin dato"></label></div></div>
      <p class="sub">Activos que opera</p><div class="checks">${ACTIVOS.map((a) => `<label class="check"><input type="checkbox" data-pl-activo="${i}" value="${a.id}"${p.activos.includes(a.id) ? ' checked' : ''}> ${esc(a.corto)}</label>`).join('')}</div>
      <p class="sub">Redes (para retirar cripto)</p><ul class="redes">${redes}</ul>
      <button type="button" class="btn ghost small" data-pl-accion="red" data-i="${i}">+ Red</button>
      <div class="field"><label>Observaciones<textarea rows="2" data-pl="${k('observaciones')}" maxlength="1000">${esc(p.observaciones)}</textarea></label></div>
      ${borrar}</li>`;
  }

  function render() {
    root.innerHTML = `<p class="hint">Guardá acá las tarifas de tus plataformas para cargarlas en un paso de la ruta con un clic ("Cargar costos del perfil"). Brecha no trae tarifas: completalas vos con la fecha en que las revisaste. Si un perfil tiene más de 30 días, la ruta lo avisa.</p>
      <ul class="plataformas">${lista.map(htmlPlataforma).join('')}</ul>
      <button type="button" class="btn small" data-pl-accion="agregar"${lista.length >= MAX_PLATAFORMAS ? ' disabled' : ''}>+ Agregar plataforma</button>`;
  }

  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.plActivo !== undefined) {
      const p = lista[Number(t.dataset.plActivo)];
      p.activos = t.checked ? [...new Set([...p.activos, t.value])] : p.activos.filter((a) => a !== t.value);
      guardar();
      return;
    }
    const ruta = t.dataset.pl;
    if (!ruta) return;
    const partes = ruta.split('.');
    const p = lista[Number(partes[0])];
    if (!p) return;
    if (partes.length === 3) {
      const m = /^([cr])(\d+)$/.exec(partes[1]);
      const item = m[1] === 'c' ? p.costos[Number(m[2])] : p.redes[Number(m[2])];
      item[partes[2]] = t.value;
      if (partes[2] === 'clase') { item.concepto = item.concepto || 'Costo'; item.minimo = ''; }
    } else p[partes[1]] = t.value;
    // Cambiar una tarifa es revisarla hoy (salvo que estés cambiando la fecha misma)
    if (partes[1] !== 'actualizado' && partes[1] !== 'observaciones' && partes[1] !== 'nombre') p.actualizado = hoy();
    guardar();
    if (t.tagName === 'SELECT' || partes[1] !== 'actualizado') render();
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pl-accion]');
    if (!b) return;
    const i = Number(b.dataset.i);
    const p = lista[i];
    switch (b.dataset.plAccion) {
      case 'agregar': if (lista.length < MAX_PLATAFORMAS) lista.push(nuevaPlataforma()); break;
      case 'costo-pct': p.costos.push(nuevoCostoPerfil('pct')); break;
      case 'costo-fijo': p.costos.push(nuevoCostoPerfil('fijo')); break;
      case 'quitar-costo': p.costos.splice(Number(b.dataset.j), 1); break;
      case 'red': p.redes.push(nuevaRed()); break;
      case 'quitar-red': p.redes.splice(Number(b.dataset.j), 1); break;
      case 'borrar': confirmando = p.id; render(); return;
      case 'borrar-no': confirmando = null; render(); return;
      case 'borrar-si': lista.splice(i, 1); confirmando = null; break;
      default: return;
    }
    guardar();
    render();
  });
  render();
  return { render, lista: () => lista };
}
