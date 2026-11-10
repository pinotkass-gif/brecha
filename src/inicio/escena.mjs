// Escena 3D de «Inicio»: una figura (opcional) sobre un escenario negro, chispas azules que suben, un fondo de ondas
// metálicas que pasa del acero oscuro al azul eléctrico al bajar, y una cámara que da la vuelta completa con el scroll.
// Estilo tomado del prompt que pasó el propietario (escena "Bronze and Time"), con colores y figura propios.
import * as THREE from '../vendor/three.module.min.js';

const VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Ondas metálicas lentas (mismas ondas que el prompt; paleta acero → azul eléctrico)
const FRAGMENT = `
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uScroll;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  float aspect = uResolution.x / uResolution.y;
  float time = uTime * 0.08;
  float scroll = uScroll;
  float sd = scroll * 5.0;
  vec2 w = uv;
  w.x += sin(uv.y * 2.5 + time * 0.2 + sd) * 0.35;
  w.y += cos(uv.x * 2.5 - time * 0.15 - sd * 0.8) * 0.35;
  w.x += sin(uv.y * 1.2 - time * 0.1 - sd * 1.5) * 0.25;
  w.y += cos(uv.x * 1.2 + time * 0.18 + sd * 1.2) * 0.25;
  w += vec2(scroll * 0.04, -scroll * 0.02) + vec2(uMouse.x * aspect * 0.05, uMouse.y * 0.05);
  float w1 = sin(dot(w, vec2(cos(0.6), sin(0.6))) * 2.4 + time);
  float w2 = cos(dot(w, vec2(cos(-0.7), sin(-0.7))) * 3.2 - time * 1.4 + w1 * 0.4);
  float w3 = sin(dot(w, vec2(cos(1.2), sin(1.2))) * 4.0 + time * 1.8 + w2 * 0.5);
  float field = w1 * 0.5 + w2 * 0.35 + w3 * 0.15;
  float crest = pow(max(0.0, 1.0 - abs(field - 0.1)), 2.5) * 0.5 + pow(max(0.0, 1.0 - abs(field - 0.15)), 8.0) * 0.9;
  // Arriba: acero oscuro / grafito. Abajo: azul eléctrico profundo
  vec3 s0 = vec3(0.0008, 0.0009, 0.0012), a0 = vec3(0.030, 0.036, 0.048), b0 = vec3(0.016, 0.019, 0.028), c0 = vec3(0.26, 0.30, 0.38);
  vec3 s1 = vec3(0.0003, 0.0006, 0.0016), a1 = vec3(0.010, 0.038, 0.092), b1 = vec3(0.005, 0.020, 0.058), c1 = vec3(0.10, 0.40, 0.85);
  float t = smoothstep(0.0, 1.0, scroll);
  vec3 col = mix(s0, s1, t);
  col = mix(col, mix(b0, b1, t), smoothstep(-0.6, 0.2, field));
  col = mix(col, mix(a0, a1, t), smoothstep(0.0, 0.8, field));
  col += mix(c0, c1, t) * crest * 1.4;
  col *= 1.0 - dot(uv, uv) * 0.12;
  gl_FragColor = vec4(col, 1.0);
}`;

function texturaChispa() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
}

/** Reflejos para el metal: una "sala" con paneles de luz (blancos y azules), pasada por PMREM. */
function entorno(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sala = new THREE.Scene();
  sala.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x030405, side: THREE.BackSide })));
  const panel = (w, h, rgb, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    sala.add(m);
  };
  panel(5, 1.4, [4, 4, 4.2], [0, 5.5, 0.5]); // caja de luz arriba
  panel(1.6, 4, [3, 3, 3.2], [5.5, 1.5, 2]); // principal a la derecha
  panel(1.2, 5, [0.4, 1.4, 4], [-5.5, 1, -1.5]); // tira azul atrás a la izquierda
  panel(3, 0.6, [0.2, 0.6, 2], [0, -4, 3]); // rebote azul abajo
  const rt = pm.fromScene(sala, 0.04);
  pm.dispose();
  return rt.texture;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{liviano?: boolean}} [opts]  liviano: celular (menos chispas, sin sombras, menos resolución)
 */
export function crearEscena(canvas, { liviano = false, figura = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, liviano ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.9;
  renderer.shadowMap.enabled = !liviano;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  scene.fog = new THREE.FogExp2('#000000', 0.01);
  scene.environment = entorno(renderer);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.2, 3.6);
  scene.add(camera);

  const uniforms = { uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) }, uMouse: { value: new THREE.Vector2() }, uScroll: { value: 0 } };
  const fondo = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, depthWrite: false, depthTest: false }));
  fondo.position.set(0, 0, -8);
  fondo.renderOrder = -10;
  camera.add(fondo);

  // Luces: principal blanca arriba a la derecha, contraluz azul atrás, relleno suave abajo
  scene.add(new THREE.AmbientLight('#ffffff', 0.12));
  const clave = new THREE.SpotLight('#ffffff', 22, 0, Math.PI / 4, 0.9);
  clave.position.set(4, 6, 3);
  clave.castShadow = !liviano;
  clave.shadow.mapSize.set(2048, 2048);
  clave.shadow.camera.near = 1;
  clave.shadow.camera.far = 15;
  clave.shadow.bias = -0.001;
  scene.add(clave);
  const contra = new THREE.DirectionalLight('#6fb6ff', 9);
  contra.position.set(-5, 3, -4);
  scene.add(contra);
  const relleno = new THREE.DirectionalLight('#dfe8ff', 0.7);
  relleno.position.set(-2, -4, 2);
  scene.add(relleno);

  // Chispas: 70 % azules (como los ojos), 30 % blancas
  const cantidad = liviano ? 160 : 450;
  const pos = new Float32Array(cantidad * 3);
  const col = new Float32Array(cantidad * 3);
  const datos = [];
  for (let i = 0; i < cantidad; i++) {
    pos.set([(Math.random() - 0.5) * 6.5, (Math.random() - 0.5) * 5 - 0.5, (Math.random() - 0.5) * 6.5], i * 3);
    col.set(Math.random() < 0.7 ? [0.3 + Math.random() * 0.2, 0.68 + Math.random() * 0.15, 1] : [0.86, 0.93, 1], i * 3);
    datos.push({ vx: (Math.random() - 0.5) * 0.4, vy: 0.15 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, vel: 0.5 + Math.random() * 1.5, radio: 0.05 + Math.random() * 0.15, fase: Math.random() * Math.PI * 2 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const chispas = new THREE.Points(geo, new THREE.PointsMaterial({ size: liviano ? 0.035 : 0.025, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, map: texturaChispa() }));
  scene.add(chispas);

  // La figura (si hay): escalada a 3,5 y centrada en su pivote (para girar sobre su centro)
  const pivote = new THREE.Group();
  scene.add(pivote);
  const fig = figura ? figura(THREE, { liviano }) : null;
  if (fig) {
    pivote.add(fig.grupo);
    fig.grupo.updateMatrixWorld(true);
    const tam = new THREE.Box3().setFromObject(fig.grupo).getSize(new THREE.Vector3());
    fig.grupo.scale.setScalar(3.5 / Math.max(tam.x, tam.y, tam.z, 0.0001));
    fig.grupo.updateMatrixWorld(true);
    const centro = new THREE.Box3().setFromObject(fig.grupo).getCenter(new THREE.Vector3());
    fig.grupo.position.sub(centro);
    pivote.position.y = -0.2;
  }

  const mirar = new THREE.Vector3();
  const destino = new THREE.Vector3();
  let primera = true;

  function redimensionar(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uResolution.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }

  /**
   * Un cuadro. progreso: 0..1 (ya suavizado); velocidad: |destino − actual| del scroll (agita las chispas).
   * @param {{progreso: number, mouseX: number, mouseY: number, dt: number, t: number, velocidad?: number, angosto?: boolean}} f
   */
  function dibujar({ progreso, mouseX, mouseY, dt, t, velocidad = 0, angosto = false }) {
    pivote.rotation.y = mouseX * 0.25;
    pivote.rotation.x = mouseY * 0.15;
    fig?.animar?.(t);
    const p = chispas.geometry.attributes.position.array;
    const mult = 1 + velocidad * 9;
    const turb = velocidad * 0.8;
    for (let i = 0; i < cantidad; i++) {
      const k = i * 3;
      const d = datos[i];
      p[k] += d.vx * dt * mult;
      p[k + 1] += d.vy * dt * mult;
      p[k + 2] += d.vz * dt * mult;
      const sway = d.radio * (1 + turb * 4);
      p[k] += Math.sin(t * d.vel + d.fase) * sway * dt;
      p[k + 2] += Math.cos(t * d.vel + d.fase) * sway * dt;
      if (p[k + 1] > 3 || Math.abs(p[k]) > 3.5 || Math.abs(p[k + 2]) > 3.5) {
        p[k + 1] = -2.5;
        p[k] = (Math.random() - 0.5) * 3;
        p[k + 2] = (Math.random() - 0.5) * 3;
      }
    }
    chispas.geometry.attributes.position.needsUpdate = true;
    // La cámara da la vuelta completa: un giro por todo el recorrido
    const phi = progreso * Math.PI * 2;
    const arco = Math.sin(progreso * Math.PI);
    // Más lejos en pantallas angostas (celular parado) para que entre entero
    const radio = Math.max(4.4, 3.7 / Math.max(camera.aspect, 0.3)) - arco * 0.6;
    destino.set(radio * Math.sin(phi), 0.35 + arco * 0.8, radio * Math.cos(phi));
    // Al principio la figura queda corrida para dejar lugar a los textos (en pantallas angostas, más arriba)
    const e = (Math.cos(Math.min(1, progreso / 0.28) * Math.PI) + 1) * 0.5;
    // En pantallas angostas la figura queda siempre en la mitad de arriba (los textos van abajo)
    mirar.set(angosto ? 0 : -1.25 * e, angosto ? -0.15 - 0.42 * radio * Math.tan(Math.PI * 25 / 180) : -0.15, 0);
    if (primera) { camera.position.copy(destino); primera = false; } else camera.position.lerp(destino, 0.025);
    camera.lookAt(mirar);
    uniforms.uTime.value = t;
    uniforms.uMouse.value.set(mouseX, -mouseY);
    uniforms.uScroll.value = progreso;
    renderer.render(scene, camera);
  }

  function destruir() {
    renderer.dispose();
    scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
  }

  return { dibujar, redimensionar, destruir, renderer };
}
