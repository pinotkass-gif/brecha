// Símbolo del dólar cripto para «Inicio» (pedido del propietario 10/11/2026: "un símbolo de billete USD cripto, más
// fácil en 3D", en lugar del langostino). El "$" con el contorno real de una tipografía (no dibujado a mano), en metal
// negro pulido con bisel y contraluz LED azul, un aro de moneda/token con línea LED y bloques de cadena orbitando.

/**
 * @param {typeof import('../vendor/three.module.min.js')} THREE
 * @param {{liviano?: boolean}} [opts]
 * @returns {{grupo: object, animar: (t: number) => void}}
 */
// Contorno del "$" de Helvetiker Bold (MgOpen, © 2004 MAGENTA Ltd., uso y redistribución permitidos con el aviso:
// src/vendor/helvetiker.LICENSE). Comandos m/l/q como en los typeface.json de Three.js, en milésimas.
const GLIFO = 'm 682 693 l 495 693 q 468 782 491 749 q 391 831 441 824 l 391 579 q 633 462 562 534 q 704 259 704 389 q 616 57 704 136 q 391 -22 528 -22 l 391 -156 l 308 -156 l 308 -22 q 76 69 152 -7 q 0 300 0 147 l 183 300 q 215 191 190 230 q 308 128 245 143 l 308 414 q 84 505 157 432 q 12 700 12 578 q 89 902 12 824 q 308 981 166 981 l 308 1069 l 391 1069 l 391 981 q 595 905 521 981 q 682 693 670 829 m 308 599 l 308 831 q 228 796 256 831 q 200 712 200 762 q 225 642 200 668 q 308 599 251 617 m 391 128 q 476 174 449 140 q 504 258 504 207 q 391 388 504 354 l 391 128';

export function construirDolar(THREE, { liviano = false } = {}) {
  const grupo = new THREE.Group(); // la escena lo escala y lo centra
  const cuerpo = new THREE.Group(); // lo que se mueve
  grupo.add(cuerpo);
  const mat = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2825, metalness: 0.7, roughness: 0.25 }),
    satinado: new THREE.MeshStandardMaterial({ color: 0xefe8dc, metalness: 0.2, roughness: 0.5 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.69, 0.34, 0.23), toneMapped: false }), // terracota
    cara: new THREE.MeshStandardMaterial({ color: 0x2b2825, metalness: 0.6, roughness: 0.3 }),
    canto: new THREE.MeshStandardMaterial({ color: 0xe8dccb, metalness: 1, roughness: 0.15 }),
  };
  const sombra = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ---------- El "$": el contorno real de la letra (Helvetiker Bold), extruido con bisel en metal negro pulido ----------
  const forma = new THREE.ShapePath();
  const o = GLIFO.split(' ');
  const k = 1 / 1000; // unidades de la tipografía → escena
  for (let i = 0; i < o.length;) {
    const c = o[i++];
    const n = () => Number(o[i++]) * k;
    if (c === 'm') forma.moveTo(n(), n());
    else if (c === 'l') forma.lineTo(n(), n());
    else if (c === 'q') { const x = n(), y = n(), cx = n(), cy = n(); forma.quadraticCurveTo(cx, cy, x, y); }
    else if (c === 'b') { const x = n(), y = n(), c1x = n(), c1y = n(), c2x = n(), c2y = n(); forma.bezierCurveTo(c1x, c1y, c2x, c2y, x, y); }
  }
  const formas = forma.toShapes();
  const curvas = liviano ? 10 : 24;
  const signo = new THREE.Mesh(new THREE.ExtrudeGeometry(formas, {
    depth: 0.16, curveSegments: curvas, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.018, bevelSegments: liviano ? 4 : 8,
  }), [mat.cara, mat.canto]); // cara grafito pulido, cantos y bisel de cromo: se lee nítido sobre el fondo oscuro
  signo.geometry.center();
  signo.scale.setScalar(1.75);
  sombra(signo);
  cuerpo.add(signo);
  // Contraluz LED: la misma letra, plana y un poco más grande, atrás (se ve como un borde de neón azul)
  const neon = new THREE.Mesh(new THREE.ShapeGeometry(formas, curvas), mat.led);
  neon.geometry.center();
  neon.scale.setScalar(1.75 * 1.07);
  neon.position.z = -0.16;
  cuerpo.add(neon);
  const halo = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(176, 87, 58, 0.22)');
    gr.addColorStop(0.45, 'rgba(176, 87, 58, 0.08)');
    gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const brillo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false }));
  brillo.scale.set(2.6, 3.0, 1);
  brillo.position.z = -0.35;
  cuerpo.add(brillo);
  const luz = new THREE.PointLight(0xffb08a, 2, 3, 1.6);
  luz.position.set(0, 0, -0.5);
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
  const radioOrb = 1.9;
  const bordes = new THREE.LineBasicMaterial({ color: 0xb0573a, transparent: true, opacity: 0.9 });
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
  const cadena = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(puntos), new THREE.LineBasicMaterial({ color: 0xb0573a, transparent: true, opacity: 0.35 }));
  orbita.add(cadena);

  function animar(t) {
    cuerpo.position.y = Math.sin(t * 0.8) * 0.05;
    cuerpo.rotation.y = Math.sin(t * 0.25) * 0.35; // se balancea despacio
    orbita.rotation.z = -0.35 + t * 0.18; // los bloques giran
    for (const b of orbita.children) if (b.isMesh) { b.rotation.x += 0.004; b.rotation.y += 0.006; }
    const p = 0.82 + Math.sin(t * 2.1) * 0.18;
    brillo.material.opacity = 0.75 + Math.sin(t * 2.1) * 0.2;
    luz.intensity = 2 * p;
    aro.rotation.z = t * 0.05;
  }

  return { grupo, animar };
}
