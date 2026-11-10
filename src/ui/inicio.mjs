// «Inicio»: la presentación de Brecha (pedido 10/11/2026). Escena 3D con la figura de la presentación (src/inicio/escena.mjs,
// se carga recién al mostrarla), cuatro partes que aparecen al bajar, rayitas de progreso, cursor de anillos (sólo compu)
// y números en vivo. Se apaga al salir de la pestaña (no gasta batería). Sin WebGL: fondo azul y los textos.
// Con «reducir movimiento»: una imagen quieta y las cuatro partes una debajo de la otra.
import { esc } from './comun.mjs';

const RANGOS = [[-0.1, 0.16], [0.26, 0.44], [0.54, 0.72], [0.82, 1.05]];
const DESTINOS = [0, 0.35, 0.63, 0.93];
const FUENTES = 'https://fonts.googleapis.com/css2?family=Italiana&family=Outfit:wght@300;400;600&display=swap';

/** ¿El navegador puede hacer 3D? (se prueba en un canvas aparte para no tocar el de la escena) */
function hayWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

/** "Brecha" → <span class="letra">B</span>… con demora creciente (respeta <br> y espacios). */
function partirEnLetras(el) {
  let k = 0;
  el.innerHTML = el.innerHTML.split(/(<br\s*\/?>)/i).map((parte) => (/^<br/i.test(parte) ? parte
    : [...parte].map((c) => (c === ' ' ? ' ' : `<span class="letra" style="transition-delay:${(k++ * 0.035).toFixed(3)}s">${esc(c)}</span>`)).join(''))).join('');
}

/**
 * @param {{root: HTMLElement, plataforma: 'web'|'celular', getResumen?: () => Array<{nombre: string, valor: string, clase?: string}>, alturaArriba?: () => number}} deps
 */
export function crearInicio({ root, plataforma, getResumen = () => [], alturaArriba = () => 0 }) {
  const canvas = root.querySelector('.inicio-canvas');
  const partes = [...root.querySelectorAll('.inicio-parte')];
  const llenos = [...root.querySelectorAll('.inicio-dash-lleno')];
  const puntos = [...root.querySelectorAll('.inicio-punto')];
  const cursorIn = root.querySelector('.inicio-cursor-adentro');
  const cursorOut = root.querySelector('.inicio-cursor-afuera');
  for (const t of root.querySelectorAll('.inicio-titulo')) partirEnLetras(t);
  const quieto = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const punteroFino = () => plataforma === 'web' && window.matchMedia?.('(pointer: fine)').matches;
  let visible = false;
  let escena = null;
  let cargando = null;
  let raf = 0;
  let ultimo = 0;
  let inicio = 0;
  let actual = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const cursor = { x: innerWidth / 2, y: innerHeight / 2, ox: innerWidth / 2, oy: innerHeight / 2 };
  const estado = (e) => { root.dataset.inicio = e; };

  function progresoBuscado() {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }
  function actualizarPartes(p) {
    RANGOS.forEach(([a, b], i) => partes[i]?.classList.toggle('activa', p >= a && p <= b));
    llenos.forEach((f, i) => { f.style.height = `${Math.max(0, Math.min(1, (p - i * 0.25) / 0.25)) * 100}%`; });
    puntos.forEach((d, i) => {
      let v = 90 + ((i * 55) % 180);
      if (i % 2 === 0) v = -v;
      const y = ((((i * 17) % 80) + 10 + p * v) % 100 + 100) % 100;
      d.style.top = `${y}%`;
    });
  }
  function medir() {
    root.style.setProperty('--alto-arriba', `${Math.round(alturaArriba())}px`);
    escena?.redimensionar(innerWidth, innerHeight);
  }

  function cuadro(ahora) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.1, (ahora - (ultimo || ahora)) / 1000);
    ultimo = ahora;
    const buscado = progresoBuscado();
    actual += (buscado - actual) * 0.035;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    if (punteroFino()) {
      cursor.ox += (cursor.x - cursor.ox) * 0.2;
      cursor.oy += (cursor.y - cursor.oy) * 0.2;
      cursorOut.style.transform = `translate(${cursor.ox}px, ${cursor.oy}px) translate(-50%, -50%)`;
    }
    actualizarPartes(actual);
    if (escena) {
      escena.dibujar({ progreso: actual, mouseX: mouse.x, mouseY: mouse.y, dt, t: (ahora - inicio) / 1000, velocidad: Math.abs(buscado - actual), angosto: innerWidth < 860 });
      if (!canvas.classList.contains('lista')) { canvas.classList.add('lista'); root.dataset.escena = 'lista'; }
    }
    raf = requestAnimationFrame(cuadro);
  }
  function arrancar() {
    if (!visible || raf || document.hidden) return;
    root.dataset.modo = quieto() ? 'quieto' : 'animado';
    if (quieto()) { // una imagen quieta y las cuatro partes a la vista
      estado('quieta');
      for (const p of partes) p.classList.add('activa');
      if (escena) {
        escena.dibujar({ progreso: 0.12, mouseX: 0, mouseY: 0, dt: 0, t: 0, angosto: innerWidth < 860 });
        canvas.classList.add('lista');
        root.dataset.escena = 'lista';
      }
      return;
    }
    estado('corriendo');
    ultimo = 0;
    raf = requestAnimationFrame(cuadro);
  }
  function parar() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  async function cargarEscena() {
    if (escena || cargando) return cargando;
    if (!hayWebGL()) { root.dataset.tres = 'no'; return null; }
    cargando = (async () => {
      try {
        const { crearEscena } = await import('../inicio/escena.mjs');
        escena = crearEscena(canvas, { liviano: plataforma === 'celular' || innerWidth < 860 });
        root.dataset.tres = 'si';
        medir();
      } catch (e) {
        console.warn('Brecha: no pude armar la escena 3D', e);
        root.dataset.tres = 'no';
        escena = null;
      }
      return escena;
    })();
    return cargando;
  }
  function cargarFuentes() {
    if (document.querySelector('link[data-fuentes-inicio]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FUENTES;
    l.dataset.fuentesInicio = '';
    document.head.append(l);
  }

  function actualizarDatos() {
    const dl = root.querySelector('#inicio-datos');
    if (!dl) return;
    const datos = getResumen() ?? [];
    dl.innerHTML = datos.map((d) => `<div><dt>${esc(d.nombre)}</dt><dd${d.clase ? ` class="${esc(d.clase)}"` : ''}>${esc(d.valor)}</dd></div>`).join('');
  }

  // Eventos (sólo hacen algo con la presentación a la vista)
  window.addEventListener('pointermove', (e) => {
    if (!visible) return;
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / innerHeight) * 2 - 1;
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (punteroFino()) cursorIn.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  }, { passive: true });
  window.addEventListener('resize', () => { if (visible) medir(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) parar(); else arrancar(); });
  root.querySelector('.inicio-progreso')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-parte]');
    if (!b) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo({ top: max * DESTINOS[Number(b.dataset.parte)], behavior: quieto() ? 'auto' : 'smooth' });
  });

  return {
    /** Se muestra: trae la escena (la primera vez), arranca la animación y el cursor. */
    async mostrar() {
      if (visible) return;
      visible = true;
      inicio = performance.now();
      actual = progresoBuscado();
      cargarFuentes();
      actualizarDatos();
      medir();
      document.documentElement.classList.toggle('cursor-inicio', punteroFino() && !quieto());
      actualizarPartes(actual);
      root.dataset.modo = quieto() ? 'quieto' : 'animado';
      estado('cargando');
      await cargarEscena();
      if (visible) arrancar();
    },
    /** Se va: se apaga todo (no gasta batería). */
    ocultar() {
      visible = false;
      parar();
      document.documentElement.classList.remove('cursor-inicio');
      estado('parado');
    },
    actualizarDatos,
    visible: () => visible,
  };
}
