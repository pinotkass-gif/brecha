// Opciones de exchange dentro de la calculadora (pedido 10/11/2026: "cuando salga a USDT que me aparezcan las opciones
// de exchange automáticamente, con verde porcentualmente cuánto mejor son que las demás, actualizado").
// Si la operación compra USDT con pesos, vende USDT por pesos o pasa entre dólares y USDT, aparece abajo de ese campo
// la lista de exchanges (precios de CriptoYa, los mismos de «USDT en exchanges»), de la mejor a la peor, con cuánto
// rinde cada una frente al promedio (en verde las que rinden más) y un botón para usar ese precio. Nunca cambia un
// precio sola: lo usa sólo si tocás «Usar».
// Igual con el dólar oficial: si comprás o vendés el oficial, aparecen los bancos (Galicia a mano, Nación y Macro).
import { prepararPrecios, opcionesLado, rinde, redParaPasar, nombreRed, nombreExchange, duracion } from '../exchanges/arbitraje.mjs';
import { formatNumberAR } from '../engine/format.mjs';
import { round, ONE, HUNDRED } from '../engine/decimal.mjs';
import { esc } from './comun.mjs';

const VISIBLES = 5;
const precioArs = (v) => `$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const precioUsd = (v) => `US$ ${formatNumberAR(v, { decimals: 4, minDecimals: 2 })}`;
const pct = (v) => `${v.gt(0) ? '+' : ''}${formatNumberAR(round(v, 2), { decimals: 2, minDecimals: 2 })} %`;
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Qué listas corresponden a la operación de la calculadora.
 * @param {string} compra  mercado de compra  @param {string} venta  mercado de venta
 * @returns {{base: object|null, venta: object|null, conversion: object|null}}
 */
export function slotsPara(compra, venta) {
  const conv = compra !== venta && (compra === 'cripto' || venta === 'cripto');
  return {
    base: compra === 'cripto' ? { titulo: 'Dónde comprar USDT con pesos', lado: 'compra', fiat: 'ARS' }
      : compra === 'oficial' ? { titulo: 'Dónde comprar el dólar oficial', lado: 'compra', fiat: 'ARS', fuente: 'bancos' } : null,
    venta: venta === 'cripto' ? { titulo: 'Dónde vender tus USDT por pesos', lado: 'venta', fiat: 'ARS' }
      : venta === 'oficial' ? { titulo: 'Dónde vender el dólar oficial', lado: 'venta', fiat: 'ARS', fuente: 'bancos' } : null,
    conversion: !conv ? null : venta === 'cripto'
      ? { titulo: 'Dónde pasar tus dólares a USDT', lado: 'compra', fiat: 'USD' }
      : { titulo: 'Dónde pasar tus USDT a dólares', lado: 'venta', fiat: 'USD' },
  };
}

/** De qué exchange a cuál hay que pasar los USDT, según lo elegido (y cómo se descuenta en la calculadora). */
export function pasoDeLaOperacion(compra, venta, elegidos) {
  const e = elegidos ?? {};
  if (compra === 'cripto' && venta === 'cripto') return { desde: e.base?.id, hacia: e.venta?.id, cobro: 'descuenta_origen', donde: 'venta' };
  if (venta === 'cripto') return { desde: e.conversion?.id, hacia: e.venta?.id, cobro: 'descuenta_destino', donde: 'venta' };
  if (compra === 'cripto') return { desde: e.base?.id, hacia: e.conversion?.id, cobro: 'descuenta_origen', donde: 'conversion' };
  return null;
}

/**
 * @param {{cont: {base: HTMLElement, venta: HTMLElement, conversion: HTMLElement}, exchanges: object, ahora?: () => Date,
 *   getContexto: () => {compra: string, venta: string, actual: {base: *, venta: *, conversion: *}, elegidos: object, transf: string},
 *   onUsar: (x: object) => void, onCargarRetiro: (x: {valor: *, cobro: string, texto: string}) => void}} deps
 */
export function crearOpcionesUsdt({ cont, exchanges, bancos = null, ahora = () => new Date(), getContexto, onUsar, onCargarRetiro, onIrAManual = () => {} }) {
  const abiertos = { base: false, venta: false, conversion: false };
  let ultimo = {}; // opciones mostradas por lista (para los botones)

  function cabeza(def, datos, pref) {
    const e = exchanges.estado();
    const viejo = datos && ahora().getTime() - Date.parse(datos.at) > 15 * 60e3;
    const cuando = datos ? `precios de las ${HORA.format(new Date(datos.at))} (hace ${duracion(Math.max(0, ahora().getTime() - Date.parse(datos.at)) / 60e3)})` : '';
    return `<div class="opc-head"><p><strong>${esc(def.titulo)}</strong> <span class="hint">· CriptoYa, ${pref.conComisiones ? 'con' : 'sin'} comisiones${pref.incluirP2P ? '' : ', sin P2P'}${cuando ? ` · ${esc(cuando)}` : ''}${viejo ? ' · <span class="problem">son viejos: actualizalos</span>' : ''}</span></p>
      <button type="button" class="btn ghost small" data-opc-actualizar${e.estado === 'cargando' ? ' disabled' : ''}>Actualizar</button></div>
      ${e.nota ? `<p class="hint">${esc(e.nota)}</p>` : ''}`;
  }

  /** Bancos: siempre los tres (los que no tienen dato al día, abajo y con el motivo): la lista no cambia de alto. */
  function renderBancos(clave, def, ctx, el) {
    const d = bancos.datosOpciones();
    const { opciones } = opcionesLado(d.filas, def.lado);
    const usables = new Set(opciones.map((o) => o.id));
    const fila = (id) => d.filas.find((f) => f.id === id);
    ultimo[clave] = { def, opciones, bancos: true, fila };
    const elegido = ctx.elegidos?.[clave]?.id;
    const mejor = opciones[0];
    const actual = ctx.actual?.[clave];
    let frente = '<p class="opc-actual">&nbsp;</p>';
    if (mejor && elegido === mejor.id) frente = '<p class="opc-actual">Estás usando la mejor opción de la lista.</p>';
    else if (mejor && opciones.length > 1 && actual && actual.gt(0)) {
      const r = round(rinde(mejor.precio, actual, def.lado), 2);
      if (r.gt(0)) frente = `<p class="opc-actual">La mejor, <strong>${esc(mejor.nombre)}</strong>, te rinde <strong class="opc-rinde mejor">${esc(pct(r))}</strong> más que lo que tenés cargado (${esc(precioArs(actual))}).</p>`;
    } else if (mejor && actual && actual.gt(0)) {
      const r = round(rinde(mejor.precio, actual, def.lado), 2);
      if (!r.eq(0)) frente = `<p class="opc-actual">${esc(mejor.nombre)} te rinde <strong class="opc-rinde ${r.gt(0) ? 'mejor' : 'peor'}">${esc(pct(r))}</strong> frente a lo que tenés cargado (${esc(precioArs(actual))}).</p>`;
    }
    const sinDato = d.filas.filter((f) => !usables.has(f.id)).map((f) => {
      const motivo = f.motivos.length ? `${f.origen === 'ninguno' ? 'sin dato al día: ' : ''}${f.motivos.join('; ')}`
        : d.cargando ? 'trayendo la cotización…'
          : f.origen === 'manual' && def.lado === 'venta' && !f.venta ? 'cargaste sólo la venta: falta la compra (lo que te paga)'
            : f.apiViejo ? `sin dato al día (el último es del ${f.apiViejo.fecha.slice(8, 10)}/${f.apiViejo.fecha.slice(5, 7)}/${f.apiViejo.fecha.slice(0, 4)})` : 'sin dato';
      const cargar = f.id === 'galicia' ? `<button type="button" class="btn small" data-opc-ir-manual>${f.origen === 'manual' ? 'Corregirla' : 'Cargala a mano'}</button>` : '';
      return `<li class="opc-item sin-dato" data-testid="opc-${clave}-${f.id}"><span class="opc-nombre">${esc(f.nombre)}</span><span class="opc-precio hint">${esc(motivo)}</span><span></span>${cargar || '<span></span>'}</li>`;
    }).join('');
    const e = bancos.estado();
    el.innerHTML = `<div class="opc-head"><p><strong>${esc(def.titulo)}</strong> <span class="hint">· bancos: Nación de CriptoYa, Galicia la cargás vos${def.lado === 'compra' ? ' (se usa la venta: lo que pagás)' : ' (se usa la compra: lo que te pagan)'}</span></p>
        <button type="button" class="btn ghost small" data-opc-actualizar="bancos"${e.estado === 'cargando' ? ' disabled' : ''}>Actualizar</button></div>
      ${e.nota ? `<p class="hint">${esc(e.nota)}</p>` : ''}${frente}
      <ol class="opc-lista">${opciones.map((x, i) => item(clave, def, { ...x, origen: fila(x.id)?.origen }, i, elegido)).join('')}${sinDato}</ol>`;
  }

  function item(clave, def, x, i, elegido) {
    const fmt = def.fiat === 'ARS' ? precioArs : precioUsd;
    const uso = elegido === x.id;
    const detalleUsd = def.fiat === 'USD' && def.lado === 'compra'
      ? ` <span class="hint">(${x.precio.gte(1) ? `${formatNumberAR(round(x.precio.minus(ONE).times(HUNDRED), 2), { decimals: 2, minDecimals: 0 })} % arriba` : `${formatNumberAR(round(ONE.minus(x.precio).times(HUNDRED), 2), { decimals: 2, minDecimals: 0 })} % abajo`} del dólar)</span>` : '';
    const clase = x.rinde.gt(0) ? 'mejor' : x.rinde.lt(0) ? 'peor' : 'igual';
    return `<li class="opc-item${uso ? ' en-uso' : ''}${i === 0 ? ' primera' : ''}" data-testid="opc-${clave}-${i}">
      <span class="opc-nombre">${esc(x.nombre)}${x.p2p ? ' <span class="badge none">P2P</span>' : ''}${x.origen === 'manual' ? ' <span class="badge manual">a mano</span>' : ''}${uso ? ' <span class="badge ok">en uso</span>' : ''}</span>
      <span class="opc-precio">${esc(fmt(x.precio))}${def.fiat === 'USD' ? ' por USDT' : ''}${detalleUsd}</span>
      <span class="opc-rinde ${clase}" title="Cuánto más (o menos) te rinde que el promedio de los exchanges de la lista">${esc(pct(x.rinde))} vs. promedio</span>
      <button type="button" class="btn small" data-opc-usar="${clave}" data-i="${i}" aria-label="Usar ${esc(x.nombre)}: ${esc(fmt(x.precio))}"${uso ? ' disabled' : ''}>${uso ? 'Usando' : 'Usar'}</button></li>`;
  }

  function lineaRetiro(ctx, datos) {
    const paso = pasoDeLaOperacion(ctx.compra, ctx.venta, ctx.elegidos);
    if (!paso || !paso.desde || !paso.hacia) return { donde: paso?.donde, html: '' };
    const A = nombreExchange(paso.desde);
    const B = nombreExchange(paso.hacia);
    const r = redParaPasar(datos.fees, paso.desde, paso.hacia, datos.at);
    if (r.mismo) return { donde: paso.donde, html: `<p class="opc-retiro">Comprás y vendés en ${esc(A)}: no hay que pasar los USDT a otro exchange.</p>` };
    if (!r.conocida) return { donde: paso.donde, html: `<p class="opc-retiro">Comprás en ${esc(A)} y vendés en ${esc(B)}: no sé cuánto cuesta pasar los USDT (${esc(r.motivo)}). Cargalo en «Costo de transferencia».</p>` };
    const valor = formatNumberAR(r.retiro, { decimals: 8, minDecimals: 0 });
    const cargado = ctx.transf === valor && ctx.transfCobro === paso.cobro;
    return {
      donde: paso.donde,
      html: `<p class="opc-retiro">Comprás en ${esc(A)} y vendés en ${esc(B)}: pasar los USDT cuesta <strong>${esc(valor)} USDT</strong> por ${esc(nombreRed(r.red))} (comisión de retiro según CriptoYa${r.vieja ? ', sin fecha o vieja: verificala' : ''}${r.verificarDestino ? `; verificá que ${esc(B)} acepte esa red` : ''}).
        ${cargado ? '<span class="badge ok">cargado en «Costo de transferencia»</span>' : `<button type="button" class="btn small" data-opc-retiro data-valor="${esc(valor)}" data-cobro="${paso.cobro}">Cargarlo en «Costo de transferencia»</button>`}</p>`,
    };
  }

  function render() {
    const ctx = getContexto();
    const slots = slotsPara(ctx.compra, ctx.venta);
    const datos = exchanges.datosActuales();
    const pref = exchanges.preferencias();
    const e = exchanges.estado();
    const retiro = datos ? lineaRetiro(ctx, datos) : { html: '' };
    ultimo = {};
    for (const clave of ['base', 'venta', 'conversion']) {
      const el = cont[clave];
      const def = slots[clave];
      if (!el) continue;
      el.hidden = !def;
      if (!def) { el.innerHTML = ''; continue; }
      if (def.fuente === 'bancos') { if (bancos) renderBancos(clave, def, ctx, el); else el.hidden = true; continue; }
      if (!datos) {
        el.innerHTML = `${cabeza(def, null, pref)}<p class="hint">${e.estado === 'cargando' ? 'Trayendo los precios de los exchanges…' : esc(e.error || 'Todavía no traje los precios de los exchanges.')}</p>`;
        continue;
      }
      const lista = def.fiat === 'ARS' ? datos.ars : datos.usd;
      if (!lista) { el.innerHTML = `${cabeza(def, datos, pref)}<p class="hint">CriptoYa no trajo precios de USDT en dólares.</p>`; continue; }
      const { opciones } = opcionesLado(prepararPrecios(lista, { at: datos.at, conComisiones: pref.conComisiones, incluirP2P: pref.incluirP2P }), def.lado);
      ultimo[clave] = { def, opciones, at: datos.at, conComisiones: pref.conComisiones };
      if (!opciones.length) { el.innerHTML = `${cabeza(def, datos, pref)}<p class="hint">No hay precios usables ahora.</p>`; continue; }
      const elegido = ctx.elegidos?.[clave]?.id;
      const mejor = opciones[0];
      const actual = ctx.actual?.[clave];
      let frente = '';
      if (elegido === mejor.id) frente = `<p class="opc-actual">Estás usando la mejor opción de la lista.</p>`;
      else if (actual && actual.gt(0)) {
        const r = round(rinde(mejor.precio, actual, def.lado), 2);
        frente = r.eq(0)
          ? `<p class="opc-actual">Lo que tenés cargado es el precio de la mejor opción (${esc(mejor.nombre)}).</p>`
          : r.gt(0)
          ? `<p class="opc-actual">La mejor, <strong>${esc(mejor.nombre)}</strong>, te rinde <strong class="opc-rinde mejor">${esc(pct(r))}</strong> más que lo que tenés cargado (${esc(def.fiat === 'ARS' ? precioArs(actual) : precioUsd(actual))}).</p>`
          : `<p class="opc-actual">Lo que tenés cargado (${esc(def.fiat === 'ARS' ? precioArs(actual) : precioUsd(actual))}) es igual o mejor que la mejor opción de la lista: verificá que sea un precio real.</p>`;
      }
      const resto = opciones.slice(VISIBLES);
      el.innerHTML = `${cabeza(def, datos, pref)}${frente}
        <ol class="opc-lista">${opciones.slice(0, VISIBLES).map((x, i) => item(clave, def, x, i, elegido)).join('')}</ol>
        ${resto.length ? `<details class="opc-mas" data-opc-mas="${clave}"${abiertos[clave] ? ' open' : ''}><summary><span class="opc-ver">Ver las otras ${resto.length}</span><span class="opc-ocultar">Achicar la lista</span></summary><ol class="opc-lista" start="${VISIBLES + 1}">${resto.map((x, i) => item(clave, def, x, i + VISIBLES, elegido)).join('')}</ol><button type="button" class="btn ghost small opc-achicar" data-opc-achicar>Achicar la lista</button></details>` : ''}
        ${retiro.donde === clave ? retiro.html : ''}
        <p class="hint">Es un precio de referencia: verificalo en el exchange antes de operar (límites, medios de pago y, en los P2P, el aviso).</p>`;
    }
  }

  for (const [clave, el] of Object.entries(cont)) {
    if (!el) continue;
    el.addEventListener('click', (ev) => {
      // Lista larga abierta: «Achicar la lista» o tocar el recuadro (fuera de un botón o campo) la vuelve a achicar
      const mas = el.querySelector('details[data-opc-mas][open]');
      if (mas && (ev.target.closest('[data-opc-achicar]') || !ev.target.closest('button, a, input, select, textarea, label, summary'))) {
        mas.open = false;
        abiertos[clave] = false;
        if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
        return;
      }
      const act = ev.target.closest('[data-opc-actualizar]');
      if (act) { if (act.dataset.opcActualizar === 'bancos') bancos?.actualizar(true); else exchanges.actualizar(true); return; }
      if (ev.target.closest('[data-opc-ir-manual]')) { onIrAManual(); return; }
      const ret = ev.target.closest('[data-opc-retiro]');
      if (ret) { onCargarRetiro({ valor: ret.dataset.valor, cobro: ret.dataset.cobro }); return; }
      const b = ev.target.closest('[data-opc-usar]');
      const u = ultimo[clave];
      if (!b || !u) return;
      const x = u.opciones[Number(b.dataset.i)];
      if (x && u.bancos) { const f = u.fila(x.id); onUsar({ clave, fuente: 'bancos', lado: u.def.lado, fiat: 'ARS', id: x.id, nombre: x.nombre, precio: x.precio, at: f?.fecha ?? null, manual: f?.origen === 'manual', conComisiones: false }); return; }
      if (x) onUsar({ clave, lado: u.def.lado, fiat: u.def.fiat, id: x.id, nombre: x.nombre, precio: x.precio, at: u.at, conComisiones: u.conComisiones });
    });
    el.addEventListener('toggle', (ev) => { if (ev.target.matches?.('[data-opc-mas]')) abiertos[clave] = ev.target.open; }, true);
  }

  let pendiente = false;
  return {
    /** Redibuja (una vez por cuadro aunque lo pidan muchas veces seguidas). */
    render() {
      if (pendiente) return;
      pendiente = true;
      const f = () => { pendiente = false; render(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(f); else setTimeout(f, 0);
    },
    renderYa: render,
    /** Cambió la operación: si ahora pasa por USDT, trae precios (usa la copia si tiene menos de 5 min). */
    alCambiarMercado() {
      const ctx = getContexto();
      const s = slotsPara(ctx.compra, ctx.venta);
      if ([s.base, s.venta, s.conversion].some((x) => x && x.fuente !== 'bancos')) exchanges.actualizar(false);
      render();
    },
  };
}
