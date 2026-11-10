// Símbolo del dólar cripto para «Inicio» (pedido del propietario 10/11/2026: "un símbolo de billete USD cripto, más
// fácil en 3D", en lugar del langostino). Una "S" de metal negro brillante con bisel y la barra del "$" como una luz
// LED azul que la atraviesa, un aro de moneda/token con línea LED y bloques de cadena que orbitan unidos por luz.
// Todo armado con piezas de Three.js (sin modelos ni tipografías externas).

/**
 * @param {typeof import('../vendor/three.module.min.js')} THREE
 * @param {{liviano?: boolean}} [opts]
 * @returns {{grupo: object, animar: (t: number) => void}}
 */
export function construirDolar(THREE, { liviano = false } = {}) {
  const grupo = new THREE.Group(); // la escena lo escala y lo centra
  const cuerpo = new THREE.Group(); // lo que se mueve
  grupo.add(cuerpo);
  const mat = {
    metal: new THREE.MeshStandardMaterial({ color: 0x0b0d11, metalness: 1, roughness: 0.16 }),
    satinado: new THREE.MeshStandardMaterial({ color: 0x1a2029, metalness: 1, roughness: 0.32 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.85, 2.6), toneMapped: false }),
  };
  const sombra = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ---------- La "S": trazo de ancho parejo alrededor de dos arcos (simetría de media vuelta) ----------
  const R = 0.45; // radio de cada panza
  const W = 0.105; // medio ancho del trazo
  const pasos = liviano ? 70 : 140;
  const centro = [];
  const arco = (cx, cy, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; centro.push(new THREE.Vector2(cx + R * Math.cos(a), cy + R * Math.sin(a))); } };
  const g = Math.PI / 180;
  arco(0, R, 32 * g, 270 * g, pasos / 2); // panza de arriba: de arriba a la derecha, por la izquierda, hasta el medio
  centro.pop(); // el punto del medio no se repite
  arco(0, -R, 90 * g, -148 * g, pasos / 2); // panza de abajo: del medio, por la derecha, hasta abajo a la izquierda
  const izq = [];
  const der = [];
  centro.forEach((p, i) => {
    const a = centro[Math.max(0, i - 1)];
    const b = centro[Math.min(centro.length - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const n = new THREE.Vector2(-t.y, t.x).multiplyScalar(W);
    izq.push(p.clone().add(n));
    der.push(p.clone().sub(n));
  });
  const forma = new THREE.Shape([...izq, ...der.reverse()]);
  const ese = sombra(new THREE.Mesh(new THREE.ExtrudeGeometry(forma, {
    depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: liviano ? 3 : 6, curveSegments: 12, steps: 1,
  }), mat.metal));
  ese.geometry.center();
  cuerpo.add(ese);

  // ---------- La barra del "$": una luz LED que atraviesa la S (con tapas de metal y halo en las puntas) ----------
  const barra = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.35, liviano ? 12 : 24), mat.led);
  cuerpo.add(barra);
  const halo = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(170, 225, 255, 1)');
    gr.addColorStop(0.3, 'rgba(60, 160, 255, 0.6)');
    gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const halos = [];
  for (const y of [-1.175, 1.175]) {
    const tapa = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.09, liviano ? 12 : 24), mat.satinado));
    tapa.position.y = y + Math.sign(y) * 0.04;
    cuerpo.add(tapa);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.y = y;
    s.scale.setScalar(0.5);
    cuerpo.add(s);
    halos.push(s);
  }
  const brillo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  brillo.scale.set(0.7, 2.6, 1);
  cuerpo.add(brillo);
  const luz = new THREE.PointLight(0x3aa0ff, 4, 3, 1.6);
  luz.position.set(0, 0, 0.35);
  cuerpo.add(luz);

  // ---------- Aro de moneda/token con línea LED ----------
  const aro = new THREE.Group();
  aro.add(sombra(new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.055, liviano ? 12 : 20, liviano ? 80 : 140), mat.metal)));
  const lineaLed = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.012, 8, liviano ? 80 : 140), mat.led);
  lineaLed.position.z = 0.05;
  aro.add(lineaLed);
  for (let i = 0; i < 24; i++) { // muescas del canto
    const m = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.13), mat.satinado));
    const a = (i / 24) * Math.PI * 2;
    m.position.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
    m.rotation.z = a;
    aro.add(m);
  }
  cuerpo.add(aro);

  // ---------- Bloques de la cadena orbitando, unidos por luz ----------
  const orbita = new THREE.Group();
  orbita.rotation.set(1.15, 0.2, -0.35);
  cuerpo.add(orbita);
  const nBloques = liviano ? 6 : 8;
  const radioOrb = 1.72;
  const bordes = new THREE.LineBasicMaterial({ color: 0x6cc4ff, transparent: true, opacity: 0.9 });
  const puntos = [];
  for (let i = 0; i < nBloques; i++) {
    const a = (i / nBloques) * Math.PI * 2;
    const caja = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const b = sombra(new THREE.Mesh(caja, mat.satinado));
    b.add(new THREE.LineSegments(new THREE.EdgesGeometry(caja), bordes));
    b.position.set(Math.cos(a) * radioOrb, Math.sin(a) * radioOrb, 0);
    b.rotation.set(a, a * 0.7, 0);
    orbita.add(b);
    puntos.push(b.position.clone());
  }
  const cadena = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(puntos), new THREE.LineBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.4 }));
  orbita.add(cadena);

  function animar(t) {
    cuerpo.position.y = Math.sin(t * 0.8) * 0.05;
    cuerpo.rotation.y = Math.sin(t * 0.25) * 0.35; // se balancea despacio
    orbita.rotation.z = -0.35 + t * 0.18; // los bloques giran
    for (const b of orbita.children) if (b.isMesh) { b.rotation.x += 0.004; b.rotation.y += 0.006; }
    const p = 0.82 + Math.sin(t * 2.1) * 0.18;
    for (const h of halos) h.material.opacity = p;
    brillo.material.opacity = 0.25 + Math.sin(t * 2.1) * 0.08;
    luz.intensity = 4 * p;
    aro.rotation.z = t * 0.05;
  }

  return { grupo, animar };
}
