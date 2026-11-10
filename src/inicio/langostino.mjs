// Langostino mecánico negro con ojos LED azules (pedido del propietario 10/11/2026), armado con piezas de Three.js:
// caparazón blindado con costuras y cresta, rostro dentado, seis anillos de cola que se encastran (con tira LED y
// remaches), abanico de cola, patas articuladas, antenas de metal y ojos en pedúnculos que brillan en azul.
// Mira hacia +X; la cola va hacia -X. Sin modelos externos: todo sale de este archivo.

/**
 * @param {typeof import('../vendor/three.module.min.js')} THREE
 * @param {{liviano?: boolean}} [opts]  liviano: menos polígonos (celular)
 * @returns {{grupo: object, animar: (t: number) => void, luzOjos: object}}
 */
export function construirLangostino(THREE, { liviano = false } = {}) {
  const seg = liviano ? 0.6 : 1; // factor de detalle
  const n = (x) => Math.max(6, Math.round(x * seg));
  const grupo = new THREE.Group();
  const mat = {
    blindaje: new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 0.92, roughness: 0.3 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x161b23, metalness: 1, roughness: 0.24 }),
    cromo: new THREE.MeshStandardMaterial({ color: 0x8f9aab, metalness: 1, roughness: 0.18 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.85, 2.4), toneMapped: false }),
  };
  const piezas = [];
  const agregar = (padre, malla) => { malla.castShadow = true; malla.receiveShadow = true; padre.add(malla); piezas.push(malla); return malla; };
  const Y = new THREE.Vector3(0, 1, 0);
  /** Cilindro de a hasta b (barras, patas, pistones). */
  function barra(padre, a, b, r, material, r2 = r) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, d.length(), n(10)), material);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(Y, d.clone().normalize());
    return agregar(padre, m);
  }
  const bola = (padre, p, r, material) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, n(14), n(10)), material); m.position.copy(p); return agregar(padre, m); };

  // ---------- Línea del cuerpo (cabeza en +X, cola arqueada hacia abajo) ----------
  const eje = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.38, 0.04, 0), new THREE.Vector3(0.85, 0.2, 0), new THREE.Vector3(0.25, 0.27, 0),
    new THREE.Vector3(-0.35, 0.2, 0), new THREE.Vector3(-0.9, 0.02, 0), new THREE.Vector3(-1.3, -0.25, 0), new THREE.Vector3(-1.55, -0.55, 0),
  ]);

  // ---------- Caparazón (cefalotórax) ----------
  const cefalo = new THREE.Group();
  cefalo.position.set(0.82, 0.13, 0);
  cefalo.rotation.z = -0.08;
  grupo.add(cefalo);
  const casco = new THREE.Group();
  casco.scale.set(0.62, 0.34, 0.33);
  cefalo.add(casco);
  agregar(casco, new THREE.Mesh(new THREE.SphereGeometry(1, n(48), n(28)), mat.blindaje));
  for (const x of [-0.55, -0.1, 0.38]) { // costuras de las placas
    const c = agregar(casco, new THREE.Mesh(new THREE.TorusGeometry(Math.sqrt(1 - x * x) * 1.005, 0.018, n(6), n(40)), mat.cromo));
    c.position.x = x;
    c.rotation.y = Math.PI / 2;
  }
  const cresta = agregar(cefalo, new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.035, 0.03), mat.cromo)); // cresta dorsal
  cresta.position.set(0.02, 0.335, 0);
  const ledCresta = agregar(cefalo, new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.012, 0.04), mat.led));
  ledCresta.position.set(-0.05, 0.36, 0);
  const vientre = agregar(cefalo, new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.42), mat.interior)); // placa de abajo
  vientre.position.set(0, -0.24, 0);
  for (const z of [-1, 1]) { // remaches de los costados
    for (let i = 0; i < 4; i++) bola(cefalo, new THREE.Vector3(-0.36 + i * 0.24, -0.04, z * 0.315), 0.018, mat.cromo);
  }

  // ---------- Rostro (espina de adelante) con dientes ----------
  const rostro = new THREE.Group();
  rostro.position.set(1.36, 0.2, 0);
  rostro.rotation.z = 0.2;
  grupo.add(rostro);
  const espina = agregar(rostro, new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.72, n(8)), mat.blindaje));
  espina.rotation.z = -Math.PI / 2;
  espina.position.x = 0.36;
  for (let i = 0; i < 6; i++) {
    const d = agregar(rostro, new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, n(6)), mat.cromo));
    d.position.set(0.05 + i * 0.09, 0.035 - i * 0.004, 0);
    d.rotation.z = -0.5;
  }

  // ---------- Ojos LED en pedúnculos ----------
  const halo = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(160, 220, 255, 1)');
    g.addColorStop(0.25, 'rgba(60, 160, 255, 0.75)');
    g.addColorStop(0.6, 'rgba(30, 110, 255, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const halos = [];
  for (const z of [-1, 1]) {
    const base = new THREE.Vector3(1.3, 0.16, z * 0.11);
    const punta = new THREE.Vector3(1.43, 0.27, z * 0.26);
    barra(grupo, base, punta, 0.03, mat.interior, 0.024);
    bola(grupo, base, 0.04, mat.cromo); // articulación
    const ojo = bola(grupo, punta, 0.062, mat.led);
    ojo.castShadow = false;
    const aro = agregar(grupo, new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.012, n(6), n(24)), mat.cromo));
    aro.position.copy(punta);
    aro.lookAt(punta.clone().add(new THREE.Vector3(0.4, 0.15, z * 0.9)));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(punta);
    s.scale.setScalar(0.42);
    grupo.add(s);
    halos.push(s);
  }
  const luzOjos = new THREE.PointLight(0x3aa0ff, 3.5, 2.2, 1.6);
  luzOjos.position.set(1.55, 0.3, 0);
  grupo.add(luzOjos);

  // ---------- Antenas (látigos largos hacia atrás) y anténulas ----------
  const antenas = [];
  for (const z of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(1.32, 0.08, z * 0.07);
    grupo.add(piv);
    const curva = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.55, 0.22, z * 0.06), new THREE.Vector3(0.75, 0.62, z * 0.2),
      new THREE.Vector3(0.2, 1.0, z * 0.42), new THREE.Vector3(-1.0, 1.08, z * 0.62), new THREE.Vector3(-2.4, 0.78, z * 0.85),
    ]);
    agregar(piv, new THREE.Mesh(new THREE.TubeGeometry(curva, n(90), 0.011, n(6)), mat.cromo));
    bola(piv, new THREE.Vector3(0, 0, 0), 0.035, mat.interior);
    antenas.push({ piv, z, fase: z > 0 ? 0 : 1.7 });
    const corta = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.02, z * 0.02), new THREE.Vector3(0.38, 0.06, z * 0.1), new THREE.Vector3(0.72, 0.02, z * 0.16),
    ]);
    agregar(piv, new THREE.Mesh(new THREE.TubeGeometry(corta, n(30), 0.009, n(5)), mat.blindaje));
    const p = bola(piv, new THREE.Vector3(0.72, 0.02, z * 0.16), 0.016, mat.led);
    p.castShadow = false;
  }
  // Escamas antenales (placas planas al costado del rostro)
  for (const z of [-1, 1]) {
    const f = new THREE.Shape();
    f.moveTo(0, 0); f.quadraticCurveTo(0.22, 0.07, 0.42, 0.02); f.quadraticCurveTo(0.2, -0.05, 0, 0);
    const pl = agregar(grupo, new THREE.Mesh(new THREE.ExtrudeGeometry(f, { depth: 0.012, bevelEnabled: false, curveSegments: n(10) }), mat.blindaje));
    pl.position.set(1.3, 0.04, z * 0.17);
    pl.rotation.set(z * 0.5, z * 0.25, 0.05);
  }

  // ---------- Patas articuladas (5 pares) y pinzas adelante ----------
  const patas = [];
  for (let i = 0; i < 5; i++) {
    for (const z of [-1, 1]) {
      const piv = new THREE.Group();
      const x = 1.08 - i * 0.16;
      piv.position.set(x, -0.08, z * 0.17);
      grupo.add(piv);
      const largo = i === 0 ? 1.15 : 1 - i * 0.04;
      const cadera = new THREE.Vector3(0, 0, 0);
      const rodilla = new THREE.Vector3(0.06 * largo + (i === 0 ? 0.18 : 0), -0.2 * largo, z * 0.26 * largo);
      const pie = new THREE.Vector3((i === 0 ? 0.42 : 0.05 - i * 0.03) * largo, -0.52 * largo, z * 0.36 * largo);
      barra(piv, cadera, rodilla, 0.02, mat.blindaje, 0.016);
      bola(piv, rodilla, 0.026, mat.cromo);
      barra(piv, rodilla, pie, 0.015, mat.interior, 0.008);
      barra(piv, rodilla.clone().lerp(cadera, 0.3), rodilla.clone().lerp(pie, 0.35), 0.006, mat.cromo); // pistón
      if (i === 0) { // pinza
        const a = pie.clone().add(new THREE.Vector3(0.12, 0.04, z * 0.02));
        const b = pie.clone().add(new THREE.Vector3(0.12, -0.04, z * 0.04));
        barra(piv, pie, a, 0.009, mat.blindaje, 0.004);
        barra(piv, pie, b, 0.009, mat.blindaje, 0.004);
        bola(piv, pie, 0.02, mat.cromo);
      }
      patas.push({ piv, fase: i * 0.9 + (z > 0 ? 0 : Math.PI) });
    }
  }

  // ---------- Cola: seis anillos que se encastran ----------
  const cola = new THREE.Group();
  grupo.add(cola);
  const anillos = [];
  const hueco = 0.62 * Math.PI; // abierto abajo
  for (let i = 0; i < 6; i++) {
    const t = 0.38 + i * 0.087;
    const p = eje.getPointAt(t);
    const tg = eje.getTangentAt(t); // hacia la cola (la curva va de la cabeza a la cola)
    const r = 0.31 * (1 - i * 0.085);
    const largo = 0.3 * (1 - i * 0.05);
    const anillo = new THREE.Group();
    anillo.position.copy(p);
    anillo.quaternion.setFromUnitVectors(Y, tg);
    cola.add(anillo);
    agregar(anillo, new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r, largo, n(32), 1, true, 1.5 * Math.PI + hueco / 2, 2 * Math.PI - hueco), mat.blindaje));
    const borde = agregar(anillo, new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, 0.012, n(6), n(32), 2 * Math.PI - hueco), mat.cromo));
    borde.rotation.set(Math.PI / 2, 0, -(2 * Math.PI - hueco) / 2); // el arco queda centrado arriba, como el casco
    borde.position.y = largo / 2;
    agregar(anillo, new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.8, largo * 1.15, n(20)), mat.interior)); // núcleo
    const led = agregar(anillo, new THREE.Mesh(new THREE.BoxGeometry(0.014, largo * 0.62, 0.03), mat.led)); // tira LED arriba
    led.position.x = r + 0.004;
    led.castShadow = false;
    for (const lado of [-1, 1]) { // remaches y patas nadadoras
      bola(anillo, new THREE.Vector3(r * 0.35, 0, lado * r * 0.97), 0.016, mat.cromo);
      const nad = new THREE.Vector3(-r * 0.9, 0, lado * r * 0.45);
      barra(anillo, nad, nad.clone().add(new THREE.Vector3(-0.16, 0.03, lado * 0.05)), 0.01, mat.interior, 0.005);
    }
    anillos.push(anillo);
  }

  // ---------- Abanico de la cola (telson y urópodos con nervios LED) ----------
  const fin = eje.getPointAt(0.93);
  const tgFin = eje.getTangentAt(0.93);
  const abanico = new THREE.Group();
  abanico.position.copy(fin);
  abanico.rotation.z = Math.atan2(tgFin.y, tgFin.x);
  abanico.rotation.x = 0.85; // inclinado: se ve el abanico abierto también de costado
  cola.add(abanico);
  const hoja = (largo, ancho) => {
    const f = new THREE.Shape();
    f.moveTo(0, 0);
    f.quadraticCurveTo(largo * 0.45, ancho, largo, ancho * 0.35);
    f.quadraticCurveTo(largo * 1.05, 0, largo, -ancho * 0.35);
    f.quadraticCurveTo(largo * 0.45, -ancho, 0, 0);
    const g = new THREE.ExtrudeGeometry(f, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: n(14) });
    g.rotateX(Math.PI / 2); // plana, en el plano horizontal del abanico
    return g;
  };
  const telson = agregar(abanico, new THREE.Mesh(hoja(0.5, 0.09), mat.blindaje));
  telson.position.y = 0.01;
  const nervios = [];
  for (const ang of [-0.85, -0.42, 0.42, 0.85]) {
    const u = agregar(abanico, new THREE.Mesh(hoja(0.44, 0.13), mat.blindaje));
    u.rotation.y = ang;
    const nv = agregar(abanico, new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.008, 0.012), mat.led));
    nv.position.set(Math.cos(ang) * 0.2, 0.022, -Math.sin(ang) * 0.2);
    nv.rotation.y = ang;
    nv.castShadow = false;
    nervios.push(nv);
  }
  bola(abanico, new THREE.Vector3(0, 0, 0), 0.05, mat.cromo);

  // ---------- Movimiento mecánico suave ----------
  function animar(t) {
    for (const a of antenas) {
      a.piv.rotation.y = Math.sin(t * 0.6 + a.fase) * 0.06 * a.z;
      a.piv.rotation.z = Math.sin(t * 0.8 + a.fase) * 0.035;
    }
    for (const p of patas) p.piv.rotation.z = Math.sin(t * 1.6 + p.fase) * 0.07;
    anillos.forEach((a, i) => { a.rotation.x = 0; a.position.y = eje.getPointAt(0.38 + i * 0.087).y + Math.sin(t * 1.1 - i * 0.6) * 0.008 * i; });
    abanico.rotation.y = Math.sin(t * 0.9) * 0.08;
    abanico.rotation.x = 0.85 + Math.sin(t * 0.7) * 0.06;
    const brillo = 0.85 + Math.sin(t * 2.2) * 0.15;
    for (const h of halos) h.material.opacity = brillo;
    luzOjos.intensity = 3.5 * brillo;
  }

  return { grupo, animar, luzOjos, materiales: mat };
}
