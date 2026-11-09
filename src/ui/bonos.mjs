// Herramienta: tipo de cambio MEP o CCL con bonos (las dos operaciones de títulos, con todos sus costos).
// No inventa tarifas, parking ni reglas: lo que no cargás queda como "No sé" y el resultado sale incompleto.
import { calcularBonos, SENTIDOS } from '../engine/bonos.mjs';
import { parseNumberAR, formatNumberAR, formatPct } from '../engine/format.mjs';
import { esNoAplica, NO_APLICA } from '../engine/costos.mjs';
import { esc, monto, numeroPrecio, bloqueCalidad } from './comun.mjs';

const KEY = 'brecha.bonos.v1';
const PATA = [['comisionPct', 'Comisión', '%'], ['comisionMinimo', 'Comisión mínima', 'moneda de la pata'], ['derechosPct', 'Derechos de mercado', '%'], ['ivaPct', 'IVA sobre comisión y derechos', '%'], ['impuestosPct', 'Impuestos', '%']];
const vacio = () => ({
  sentido: 'comprar_usd', mercado: 'mep', bono: '', especies: '', monto: '', precioPesos: '', precioDolares: '', loteMinimo: '1',
  pesos: Object.fromEntries(PATA.map(([k]) => [k, ''])), dolares: Object.fromEntries(PATA.map(([k]) => [k, ''])),
  plazoPesos: '', plazoDolares: '', parkingDias: '', liquidezVN: '', fechaReferencia: '',
});

function restaurar(g) {
  const b = vacio();
  if (!g || typeof g !== 'object') return b;
  const t = (x, n = 60) => (typeof x === 'string' ? x.slice(0, n) : '');
  for (const k of Object.keys(b)) if (typeof b[k] === 'string') b[k] = t(g[k], k === 'bono' || k === 'especies' ? 60 : 40) || b[k];
  if (!(b.sentido in SENTIDOS)) b.sentido = 'comprar_usd';
  if (!['mep', 'ccl'].includes(b.mercado)) b.mercado = 'mep';
  for (const lado of ['pesos', 'dolares']) for (const [k] of PATA) b[lado][k] = t(g[lado]?.[k], 40);
  return b;
}

/**
 * @param {{root: HTMLElement, storage: object, getReferencia: (mercado: string, punta: string) => string|null,
 *   aplicarSimple: (d: object) => void, aplicarRuta: (d: object) => string|null, avisar: (m: string) => void}} deps
 */
export function crearBonos({ root, storage, getReferencia, aplicarSimple, aplicarRuta, avisar }) {
  let b = restaurar(storage.get(KEY));
  let ultimo = null;

  const leer = (raw, kind) => {
    if (esNoAplica(raw)) return NO_APLICA;
    const p = parseNumberAR(raw, { kind });
    return !p.ok ? 'x' : p.empty ? null : p.value;
  };
  function entrada() {
    const comprar = b.sentido === 'comprar_usd';
    const ref = getReferencia(b.mercado, comprar ? 'venta' : 'compra');
    const pata = (lado, moneda) => Object.fromEntries(PATA.map(([k]) => [k, leer(b[lado][k], k === 'comisionMinimo' ? (moneda === 'ARS' ? 'money' : 'ratio') : 'percent')]));
    return {
      sentido: b.sentido, monto: leer(b.monto, comprar ? 'money' : 'ratio'), precioPesos: leer(b.precioPesos, 'money'), precioDolares: leer(b.precioDolares, 'ratio'),
      loteMinimo: leer(b.loteMinimo, 'ratio'), pesos: pata('pesos', 'ARS'), dolares: pata('dolares', 'USD'),
      plazoPesos: leer(b.plazoPesos, 'ratio'), plazoDolares: leer(b.plazoDolares, 'ratio'), parkingDias: leer(b.parkingDias, 'ratio'),
      liquidezVN: leer(b.liquidezVN, 'ratio'), referencia: ref,
    };
  }

  const campo = (k, label, valor, { unit = '', ph = '', kind = 'text' } = {}) => `<div class="field"><label for="bn-${k.replace('.', '-')}">${label}${unit ? ` <span class="unit">${esc(unit)}</span>` : ''}</label>
    <input id="bn-${k.replace('.', '-')}" data-bono="${k}" type="text" inputmode="${kind === 'text' ? 'text' : 'decimal'}" value="${esc(valor)}" placeholder="${esc(ph)}"></div>`;

  function resultadoHTML() {
    const r = calcularBonos(entrada());
    ultimo = r;
    if (!r.ok) {
      return r.datosInsuficientes ? bloqueCalidad(r.calidad) : `<div class="res-errors" role="alert"><ul>${r.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul></div>`;
    }
    const x = r.result;
    const pataHTML = (nombre, p, moneda) => `<tr><th scope="row">${nombre}</th><td>${monto(p.bruto, moneda)}</td><td>${monto(p.comision, moneda)}${p.comisionAlMinimo ? ' (mínimo)' : ''}</td><td>${monto(p.derechos, moneda)}</td><td>${monto(p.iva, moneda)}</td><td>${monto(p.impuestos, moneda)}</td><td><strong>${monto(p.total ?? p.neto, moneda)}</strong></td></tr>`;
    const comprar = r.sentido === 'comprar_usd';
    const usd = b.mercado === 'ccl' ? 'USD_CABLE' : 'USD_MEP';
    const mc = comprar ? 'ARS' : usd;
    const mv = comprar ? usd : 'ARS';
    return `${bloqueCalidad(r.calidad)}
      <div class="headline neu" data-testid="bonos-tc"><p class="res-title">Tipo de cambio efectivo ${b.mercado.toUpperCase()}${r.calidad.nivel === 'incompleto' ? ' (como mínimo: faltan costos)' : ''}</p>
        <p class="big">${numeroPrecio(x.tcEfectivo)} <span class="unit">ARS por 1 USD</span></p>
        <p class="roi">Sin costos ${numeroPrecio(x.tcSinCostos)} · los costos ${comprar ? 'encarecen' : 'bajan'} el tipo de cambio ${formatPct(x.costoTcPct, { signed: false })}${x.difReferenciaPct ? ` · contra la referencia de DolarAPI: ${formatPct(x.difReferenciaPct)}` : ''}</p></div>
      <p>${comprar ? 'Comprás' : 'Vendés'} <strong>${formatNumberAR(x.vn, { decimals: 0 })} VN</strong>${b.bono ? ` de ${esc(b.bono)}` : ''}: ${comprar ? 'pagás' : 'entregás'} ${monto(x.gastado.monto, mc)} y recibís ${monto(x.recibido.monto, mv)}${x.sobrante.gt(0) ? ` (te sobran ${monto(x.sobrante, mc)} por los lotes enteros)` : ''}.</p>
      <div class="table-wrap"><table class="breakdown"><thead><tr><th scope="col">Operación</th><th scope="col">Bruto</th><th scope="col">Comisión</th><th scope="col">Derechos</th><th scope="col">IVA</th><th scope="col">Impuestos</th><th scope="col">${comprar ? 'Total / neto' : 'Total / neto'}</th></tr></thead>
        <tbody>${pataHTML(`Compra del bono (${comprar ? 'en pesos' : 'en dólares'})`, x.patas.compra, mc)}${pataHTML(`Venta del bono (${comprar ? 'en dólares' : 'en pesos'})`, x.patas.venta, mv)}</tbody></table></div>
      <p class="hint">Plazos: ${formatNumberAR(x.diasHabiles, { decimals: 0 })} días hábiles en total${x.parkingDias ? ` (incluye ${formatNumberAR(x.parkingDias, { decimals: 0 })} de parking que cargaste)` : ''}. Brecha no conoce las reglas de parking ni de restricciones cruzadas: verificalas a la fecha de la operación.${b.fechaReferencia ? ` Precios de referencia del ${esc(b.fechaReferencia.replace('T', ' '))}.` : ''}</p>
      ${x.violaciones.length ? `<ul class="warnings">${x.violaciones.map((v) => `<li>⚠ ${esc(v)}</li>`).join('')}</ul>` : ''}
      <div class="banner-actions"><button type="button" class="btn small" data-bonos="simple">Usar en la calculadora simple</button>
        <button type="button" class="btn ghost small" data-bonos="ruta">Usar en el paso de la ruta</button></div>`;
  }

  function render() {
    const pata = (lado, titulo) => `<fieldset><legend>${titulo}</legend><div class="row two">${PATA.map(([k, t, u]) => campo(`${lado}.${k}`, t, b[lado][k], { unit: u === 'moneda de la pata' ? (lado === 'pesos' ? 'ARS' : 'USD') : u, ph: 'No sé', kind: 'num' })).join('')}</div></fieldset>`;
    root.innerHTML = `<p class="hint">El MEP y el CCL salen de comprar un bono en una moneda y venderlo en la otra. Cargá las puntas de tu broker (precio por cada 100 VN) y sus costos; no se asume que todos los brokers cobran lo mismo. Vacío = No sé.</p>
      <div class="row two">
        <div class="field"><label for="bn-sentido">Operación</label><select id="bn-sentido" data-bono="sentido">${Object.entries(SENTIDOS).map(([k, t]) => `<option value="${k}"${k === b.sentido ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="bn-mercado">Dólar</label><select id="bn-mercado" data-bono="mercado"><option value="mep"${b.mercado === 'mep' ? ' selected' : ''}>MEP (dólares en tu cuenta local)</option><option value="ccl"${b.mercado === 'ccl' ? ' selected' : ''}>CCL (dólares en una cuenta del exterior)</option></select></div>
      </div>
      <div class="row two">${campo('bono', 'Bono o instrumento', b.bono, { ph: 'Ej.: AL30' })}${campo('especies', 'Especies (pesos / dólares)', b.especies, { ph: 'Ej.: AL30 / AL30D' })}</div>
      <div class="row two">${campo('monto', b.sentido === 'comprar_usd' ? 'Pesos que querés usar' : 'Dólares que querés vender', b.monto, { kind: 'num' })}${campo('loteMinimo', 'Lote mínimo', b.loteMinimo, { unit: 'VN', kind: 'num' })}</div>
      <div class="row two">${campo('precioPesos', b.sentido === 'comprar_usd' ? 'Precio en pesos (punta vendedora)' : 'Precio en pesos (punta compradora)', b.precioPesos, { unit: 'ARS por 100 VN', kind: 'num' })}
        ${campo('precioDolares', b.sentido === 'comprar_usd' ? 'Precio en dólares (punta compradora)' : 'Precio en dólares (punta vendedora)', b.precioDolares, { unit: 'USD por 100 VN', kind: 'num' })}</div>
      ${pata('pesos', 'Costos de la operación en pesos')}${pata('dolares', 'Costos de la operación en dólares')}
      <div class="row two">${campo('plazoPesos', 'Plazo de liquidación en pesos', b.plazoPesos, { unit: 'días hábiles', kind: 'num' })}${campo('plazoDolares', 'Plazo de liquidación en dólares', b.plazoDolares, { unit: 'días hábiles', kind: 'num' })}</div>
      <div class="row two">${campo('parkingDias', 'Parking (si corresponde)', b.parkingDias, { unit: 'días hábiles: verificá la regla vigente', kind: 'num' })}${campo('liquidezVN', 'Liquidez disponible', b.liquidezVN, { unit: 'VN', kind: 'num', ph: 'Sin dato' })}</div>
      <div class="field"><label for="bn-fecha">Fecha y hora de los precios</label><input id="bn-fecha" type="datetime-local" data-bono="fechaReferencia" value="${esc(b.fechaReferencia)}"></div>
      <div class="bonos-resultado" aria-live="polite">${resultadoHTML()}</div>`;
  }

  function actualizarResultado() {
    const box = root.querySelector('.bonos-resultado');
    if (box) box.innerHTML = resultadoHTML();
    storage.set(KEY, b);
  }

  root.addEventListener('input', (ev) => {
    const k = ev.target.dataset?.bono;
    if (!k || ev.target.tagName === 'SELECT') return;
    const [a, c] = k.split('.');
    if (c) b[a][c] = ev.target.value; else b[a] = ev.target.value;
    actualizarResultado();
  });
  root.addEventListener('change', (ev) => {
    const k = ev.target.dataset?.bono;
    if (!k || ev.target.tagName !== 'SELECT') return;
    b[k] = ev.target.value;
    storage.set(KEY, b);
    render();
  });
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-bonos]');
    if (!btn || !ultimo?.ok) return;
    const d = {
      sentido: b.sentido, mercado: b.mercado, tc: ultimo.result.tcEfectivo,
      detalle: `Tipo de cambio ${b.mercado.toUpperCase()} con bonos${b.bono ? ` (${b.bono})` : ''}: incluye comisiones, derechos, IVA e impuestos de las dos operaciones`,
      incompleto: ultimo.calidad.nivel !== 'completo',
    };
    if (btn.dataset.bonos === 'simple') aplicarSimple(d);
    else {
      const msg = aplicarRuta(d);
      avisar(msg);
    }
  });

  render();
  return { render };
}
