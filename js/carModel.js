// Monoplaza procedural: chasis por secciones (loft) con cintura de botella de coca-cola, pontones que nacen del chasis,
// suelo y difusor, alerones multielemento, DRS móvil, halo, piloto, volante, retrovisores, suspensión que llega a la
// mangueta, disco y pinza dentro de la llanta, ruedas con banda de compuesto y tapacubos.
// Ejes locales: +z hacia delante, +y arriba, +x a la izquierda. Origen: suelo, entre ejes.
import * as THREE from 'three';
import * as TX from './textures.js';
import { COMPOUNDS } from './teams.js';

const geoCache = new Map();
const g = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };

// Sección superelipse: x = cx ± w, y entre yb y yt
function loft(stations, around = 32, nExp = 3.2) {
  const pos = [], uv = [], idx = [];
  const ns = stations.length;
  for (let si = 0; si < ns; si++) {
    const st = stations[si];
    const yc = (st.yb + st.yt) / 2, h = (st.yt - st.yb) / 2;
    const n = st.n ?? nExp;
    for (let a = 0; a <= around; a++) {
      const th = -Math.PI / 2 + (a / around) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const x = (st.cx ?? 0) + st.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = yc + h * Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (s < 0 ? (st.flat ?? 1) : 1);
      pos.push(x, y, st.z);
      uv.push(a / around, si / (ns - 1));
    }
  }
  const row = around + 1;
  for (let si = 0; si < ns - 1; si++) for (let a = 0; a < around; a++) {
    const p = si * row + a, q = p + row;
    idx.push(p, q, p + 1, p + 1, q, q + 1);
  }
  // tapas
  const capF = pos.length / 3; const f0 = stations[0];
  pos.push(f0.cx ?? 0, (f0.yb + f0.yt) / 2, f0.z); uv.push(0.5, 0);
  for (let a = 0; a < around; a++) idx.push(capF, a + 1, a);
  const capB = pos.length / 3; const fl = stations[ns - 1];
  pos.push(fl.cx ?? 0, (fl.yb + fl.yt) / 2, fl.z); uv.push(0.5, 1);
  const base = (ns - 1) * row;
  for (let a = 0; a < around; a++) idx.push(capB, base + a, base + a + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

// Perfil alar extruido a lo largo de x con borde de ataque redondeado y curvatura
function airfoil(chord, thick, span, camber = 0.06) {
  const sh = new THREE.Shape();
  const N = 16;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N; const x = t * chord;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
    const yc = camber * chord * 4 * t * (1 - t);
    pts.push([x, yc + yt, yc - yt]);
  }
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) sh.lineTo(p[0], p[1]);
  for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][2]);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

function tube(points, r = 0.028, seg = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, r, 10, false);
}

function rod(a, b, r = 0.014) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(r, r, len, 8);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0));
  const pos = A.clone().add(B).multiplyScalar(0.5);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler().setFromRotationMatrix(m)));
  geo.translate(pos.x, pos.y, pos.z);
  return geo;
}

function tyreGeo(radius, width, rimR) {
  const pts = [];
  const hw = width / 2, sh = 0.048;
  pts.push(new THREE.Vector2(rimR, -hw + 0.01));
  pts.push(new THREE.Vector2(radius - sh, -hw));
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI / 2;
    pts.push(new THREE.Vector2(radius - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI / 2;
    pts.push(new THREE.Vector2(radius - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh));
  }
  pts.push(new THREE.Vector2(radius - sh, hw));
  pts.push(new THREE.Vector2(rimR, hw - 0.01));
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

const matCache = new Map();
function mats(team, drv) {
  const key = team.id + drv.code;
  if (matCache.has(key)) return matCache.get(key);
  const carbonTex = TX.carbon();
  const m = {
    paint: new THREE.MeshStandardMaterial({ map: TX.livery(team, drv.num), metalness: 0.25, roughness: 0.22, envMapIntensity: 0.85 }),
    c1: new THREE.MeshStandardMaterial({ color: team.c1, metalness: 0.25, roughness: 0.22, envMapIntensity: 0.75 }),
    c2: new THREE.MeshStandardMaterial({ color: team.c2, metalness: 0.25, roughness: 0.25, envMapIntensity: 0.70 }),
    c3: new THREE.MeshStandardMaterial({ color: team.c3, metalness: 0.30, roughness: 0.28, envMapIntensity: 0.70 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x222428, map: carbonTex, metalness: 0.45, roughness: 0.38 }),
    carbonGloss: new THREE.MeshStandardMaterial({ color: 0x1e2024, map: carbonTex, metalness: 0.55, roughness: 0.22 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.15, roughness: 0.70 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.0, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x22252c, metalness: 0.85, roughness: 0.30, side: THREE.DoubleSide }),
    brake: new THREE.MeshStandardMaterial({ color: 0x3b3431, metalness: 0.6, roughness: 0.5 }),
    caliper: new THREE.MeshStandardMaterial({ color: team.c2, metalness: 0.3, roughness: 0.4 }),
    cover: new THREE.MeshStandardMaterial({ map: TX.wheelCover(team.c2), metalness: 0.50, roughness: 0.35 }),
    helmet: new THREE.MeshStandardMaterial({ map: TX.helmet(drv.helmet, team.c2), metalness: 0.35, roughness: 0.20 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0d1014, metalness: 0.95, roughness: 0.05 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xa5b0bc, metalness: 1.0, roughness: 0.15 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.90, roughness: 0.25 }),
    light: new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1515, emissiveIntensity: 0 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x050507, emissive: 0x1e88e5, emissiveIntensity: 0.7 }),
    tcam: new THREE.MeshStandardMaterial({ color: drv.num % 2 ? 0x111111 : 0xffd400, metalness: 0.35, roughness: 0.35 }),
    num: new THREE.MeshBasicMaterial({ map: TX.numberTex(drv.num, '#ffffff'), transparent: true, depthWrite: false }),
  };
  m.tyre = {};
  for (const c of 'SMHIW') m.tyre[c] = new THREE.MeshStandardMaterial({ map: TX.tyreSide(COMPOUNDS[c].color), metalness: 0, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
  m.tyreFast = {};
  for (const c of 'SMHIW') m.tyreFast[c] = new THREE.MeshStandardMaterial({ map: TX.tyreSide(COMPOUNDS[c].color, true), metalness: 0, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
  m.lowTyre = {};
  for (const c of 'SMHIW') m.lowTyre[c] = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.9, emissive: new THREE.Color(COMPOUNDS[c].color), emissiveIntensity: 0.08 });
  matCache.set(key, m);
  return m;
}

// Chasis F1 2026: morro afilado y bajo, transición fluida al cockpit, airbox triangular y cola estrecha
function bodyStations() {
  return [
    { z: 3.12, w: 0.036, yb: 0.22, yt: 0.26, n: 3.2 },
    { z: 2.95, w: 0.065, yb: 0.20, yt: 0.31, n: 3.2 },
    { z: 2.65, w: 0.095, yb: 0.18, yt: 0.37, n: 3.4 },
    { z: 2.25, w: 0.130, yb: 0.16, yt: 0.44, n: 3.4 },
    { z: 1.80, w: 0.170, yb: 0.14, yt: 0.52, n: 3.2 },
    { z: 1.35, w: 0.220, yb: 0.11, yt: 0.60, n: 3.0 },
    { z: 0.90, w: 0.265, yb: 0.09, yt: 0.66, n: 2.8 },
    { z: 0.45, w: 0.290, yb: 0.08, yt: 0.66, n: 2.6 },
    { z: 0.05, w: 0.300, yb: 0.08, yt: 0.65, n: 2.6 },
    { z: -0.30, w: 0.285, yb: 0.09, yt: 0.94, n: 3.0 },
    { z: -0.65, w: 0.250, yb: 0.10, yt: 0.90, n: 3.0 },
    { z: -1.05, w: 0.190, yb: 0.12, yt: 0.81, n: 2.8 },
    { z: -1.45, w: 0.140, yb: 0.15, yt: 0.69, n: 2.8 },
    { z: -1.85, w: 0.095, yb: 0.19, yt: 0.55, n: 2.6 },
    { z: -2.20, w: 0.060, yb: 0.24, yt: 0.44, n: 2.4 },
    { z: -2.50, w: 0.035, yb: 0.28, yt: 0.36, n: 2.2 },
  ];
}

// El borde interior se mete dentro del chasis (x = 0.12) para que el pontón nazca del cuerpo y no quede una raja entre los dos
function sidepodStations(side) {
  const st = (z, outer, yb, yt, n) => ({ z, w: (outer - 0.12) / 2, cx: side * (outer + 0.12) / 2, yb, yt, n });
  return [
    st(0.78, 0.7, 0.13, 0.5, 4),
    st(0.55, 0.8, 0.11, 0.55, 4),
    st(0.1, 0.8, 0.11, 0.55, 3.5),
    st(-0.5, 0.69, 0.12, 0.49, 3),
    st(-1.1, 0.51, 0.14, 0.4, 3),
    st(-1.6, 0.35, 0.17, 0.32, 3),
  ];
}

// Coche completo (detalle alto) + versión lejana (LOD)
export function buildCar(team, drv) {
  const M = mats(team, drv);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hi = new THREE.Group(), lo = new THREE.Group();
  const lod = new THREE.Group(); lod.add(hi, lo); lo.visible = false;
  body.add(lod);
  const add = (grp, geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = false;
    grp.add(m);
    return m;
  };

  // --- 1. CHASIS Y CARROCERÍA PRINCIPAL
  add(hi, g('body', () => loft(bodyStations(), 32)), M.paint);
  add(hi, g('podL', () => loft(sidepodStations(1), 28)), M.paint);
  add(hi, g('podR', () => loft(sidepodStations(-1), 28)), M.paint);

  // bocas de los pontones
  for (const sd of [1, -1]) {
    const inlet = add(hi, g('inlet', () => new THREE.CircleGeometry(0.15, 20).scale(0.75, 1.1, 1)), M.black, false);
    inlet.position.set(sd * 0.58, 0.33, 0.79);
  }

  // Hueco del cockpit y borde acolchado protector
  const cockpitHole = add(hi, g('cockpit', () => new THREE.CircleGeometry(0.26, 24).scale(1, 1.75, 1)), M.black, false);
  cockpitHole.rotation.x = -Math.PI / 2 + 0.06; cockpitHole.position.set(0, 0.612, 0.12);

  // Marco acolchado del cockpit (headrest protection)
  const headrest = add(hi, g('headrest', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.27, 0.32); s.lineTo(0.27, 0.32); s.lineTo(0.25, -0.22); s.lineTo(-0.25, -0.22); s.closePath();
    const h = new THREE.Path();
    h.moveTo(-0.21, 0.32); h.lineTo(0.21, 0.32); h.lineTo(0.19, -0.16); h.lineTo(-0.19, -0.16); h.closePath();
    s.holes.push(h);
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.015, bevelThickness: 0.02 });
    e.rotateX(Math.PI / 2 - 0.06);
    return e;
  }), M.c2);
  headrest.position.set(0, 0.63, 0.12);

  // Aleta de tiburón (shark fin) estilizada y toma de aire del motor (airbox)
  add(hi, g('fin', () => {
    const s = new THREE.Shape();
    s.moveTo(0.35, 0.90); s.lineTo(2.05, 0.46); s.lineTo(2.08, 0.70); s.lineTo(0.40, 1.01); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false });
    e.rotateY(Math.PI / 2); e.translate(-0.007, 0, 0); return e;
  }), M.c1);

  // Franja de remate superior de la aleta de tiburón
  add(hi, g('finTrim', () => {
    const s = new THREE.Shape();
    s.moveTo(0.38, 0.99); s.lineTo(2.08, 0.68); s.lineTo(2.08, 0.71); s.lineTo(0.38, 1.02); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: false });
    e.rotateY(Math.PI / 2); e.translate(-0.009, 0, 0); return e;
  }), M.c3);

  // Toma del airbox (triangular con divisor central)
  const airbox = add(hi, g('airbox', () => new THREE.CircleGeometry(0.105, 18).scale(1, 1.35, 1)), M.black, false);
  airbox.position.set(0, 0.855, -0.29);
  const airDivider = add(hi, g('airDiv', () => box(0.014, 0.18, 0.06)), M.carbon);
  airDivider.position.set(0, 0.855, -0.27);

  // Cámara On-board de la T-cam (superior sobre el airbox)
  const tcam = add(hi, g('tcam', () => box(0.09, 0.048, 0.20)), M.tcam);
  tcam.position.set(0, 0.995, -0.38);
  const tcamLens = add(hi, g('tcamLens', () => box(0.024, 0.024, 0.01)), M.visor, false);
  tcamLens.position.set(0.035, 0.995, -0.275);

  // Tubo pitot y antenas de telemetría en el morro
  const antenna = add(hi, g('antenna', () => rod([0, 0.52, 2.10], [0, 0.68, 2.10], 0.004)), M.carbon, false);
  const pitot = add(hi, g('pitot', () => rod([0, 0.50, 2.35], [0, 0.54, 2.45], 0.003)), M.chrome, false);

  // --- 2. SUELO DE EFECTO SUELO Y DIFUSOR TRASERO
  add(hi, g('floor', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.52, 1.35); s.lineTo(0.52, 1.35);
    s.lineTo(0.83, 0.90); s.lineTo(0.84, -1.35);
    s.quadraticCurveTo(0.83, -1.95, 0.52, -2.10);
    s.lineTo(-0.52, -2.10);
    s.quadraticCurveTo(-0.83, -1.95, -0.84, -1.35);
    s.lineTo(-0.83, 0.90); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: false });
    e.rotateX(Math.PI / 2); e.translate(0, 0.075, 0); return e;
  }), M.carbon);

  // Bordes del suelo (edge wings con aletas generadoras de vórtices y patín metálico)
  for (const sd of [1, -1]) {
    const edge = add(hi, g('edge', () => box(0.025, 0.065, 2.25)), M.carbon);
    edge.position.set(sd * 0.835, 0.095, -0.25);
    // Deflectores / generadores de vórtices en la entrada del suelo
    for (let k = 0; k < 3; k++) {
      const fence = add(hi, g('fence' + k, () => box(0.008, 0.12, 0.35)), M.carbon);
      fence.position.set(sd * (0.35 + k * 0.14), 0.11, 0.95 - k * 0.08);
      fence.rotation.y = sd * 0.12;
    }
  }

  // difusor
  const diff = add(hi, g('diff', () => { const e = box(1.0, 0.02, 0.55); e.rotateX(0.35); e.translate(0, 0.18, -2.25); return e; }), M.carbon);
  for (let i = -2; i <= 2; i++) { const st = add(hi, g('strake', () => { const e = box(0.012, 0.2, 0.5); e.rotateX(0.35); return e; }), M.carbon); st.position.set(i * 0.22, 0.2, -2.25); }

  // Tubo de escape central de titanio y estructura de impacto
  const exhaust = add(hi, g('exhaust', () => {
    const c = new THREE.CylinderGeometry(0.042, 0.046, 0.16, 16, 1, true);
    c.rotateX(Math.PI / 2); return c;
  }), M.rim);
  exhaust.position.set(0, 0.32, -2.35);

  // Plancha inferior de madera de jabroc con patines de titanio dorado
  const plank = add(hi, g('plank', () => box(0.28, 0.018, 2.9)), M.black, false);
  plank.position.set(0, 0.052, -0.2);
  for (const zP of [0.8, -0.2, -1.2]) {
    const skid = add(hi, g('skid' + zP, () => box(0.12, 0.006, 0.12)), M.gold, false);
    skid.position.set(0, 0.041, zP);
  }

  // --- alerón delantero
  const fw = new THREE.Group(); fw.position.set(0, 0, 2.62); hi.add(fw);
  const elems = [[0.24, 0.11, 0], [0.16, 0.16, -0.12], [0.13, 0.21, -0.2], [0.1, 0.26, -0.26]];
  elems.forEach(([ch, y, dz], k) => {
    const e = add(fw, g('fwe' + k, () => airfoil(ch, 0.1, 1.9, -0.08)), k === 3 ? M.c2 : M.carbon);
    e.position.set(0, y, 0.45 + dz * 0.4 - k * 0.07); e.rotation.x = 0.1 + k * 0.16;
  });
  for (const sd of [1, -1]) {
    const ep = add(fw, g('fwep', () => { const s = new THREE.Shape(); s.moveTo(0.28, 0.02); s.lineTo(-0.3, 0.02); s.lineTo(-0.3, 0.2); s.quadraticCurveTo(0.0, 0.24, 0.28, 0.1); s.closePath(); const e = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }); e.rotateY(Math.PI / 2); return e; }), M.carbon);
    ep.position.set(sd * 0.96, 0.04, 0.22);
    const lip = add(fw, g('fwlip', () => box(0.016, 0.03, 0.56)), M.c2); lip.position.set(sd * 0.96, 0.2, 0.22);
  }
  for (const sd of [1, -1]) { const py = add(fw, g('fwpy', () => box(0.02, 0.18, 0.25)), M.carbon); py.position.set(sd * 0.08, 0.2, 0.35); }

  // --- alerón trasero con DRS
  const rw = new THREE.Group(); rw.position.set(0, 0, -2.25); hi.add(rw);
  const main = add(rw, g('rwm', () => airfoil(0.32, 0.12, 1.02, -0.08)), M.carbon); main.position.set(0, 0.8, -0.05); main.rotation.x = 0.18;
  const flapPivot = new THREE.Group(); flapPivot.position.set(0, 0.9, -0.33); rw.add(flapPivot);
  const flap = add(flapPivot, g('rwf', () => airfoil(0.22, 0.1, 1.0, -0.06)), M.c2); flap.rotation.x = 0.55;
  for (const sd of [1, -1]) {
    const ep = add(rw, g('rwep', () => { const s = new THREE.Shape(); s.moveTo(-0.05, 0.42); s.lineTo(0.45, 0.45); s.lineTo(0.5, 1.0); s.lineTo(0.02, 0.98); s.quadraticCurveTo(-0.1, 0.7, -0.05, 0.42); const e = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false }); e.rotateY(Math.PI / 2); return e; }), M.carbon);
    ep.position.set(sd * 0.52, 0, 0);
    const band = add(rw, g('rwband', () => box(0.018, 0.16, 0.5)), M.c1); band.position.set(sd * 0.52, 0.9, -0.24);
  }
  const beam = add(rw, g('beam', () => airfoil(0.16, 0.12, 0.9, -0.05)), M.carbon); beam.position.set(0, 0.4, -0.05); beam.rotation.x = 0.25;
  const pylon = add(rw, g('pylon', () => box(0.025, 0.5, 0.12)), M.carbon); pylon.position.set(0, 0.62, -0.2);
  const rain = add(rw, g('rain', () => box(0.12, 0.05, 0.03)), M.light, false); rain.position.set(0, 0.36, -0.2);

  // --- 5. HALO, PILOTO, VOLANTE Y RETROVISORES
  // Halo de titanio curvado con perfil aerodinámico
  add(hi, g('halo', () => tube([
    [0.31, 0.64, -0.28], [0.33, 0.86, -0.05], [0.26, 0.90, 0.32],
    [0, 0.92, 0.50],
    [-0.26, 0.90, 0.32], [-0.33, 0.86, -0.05], [-0.31, 0.64, -0.28]
  ], 0.026, 48)), M.carbon);

  // Pilar delantero central del halo (blade pylon)
  add(hi, g('haloP', () => tube([[0, 0.92, 0.50], [0, 0.80, 0.66], [0, 0.66, 0.78]], 0.028, 14)), M.carbon);

  // Piloto: casco con librea, visera con tratamiento oscuro/iridiscente y hombros
  const helmet = add(hi, g('helmet', () => new THREE.SphereGeometry(0.138, 24, 18)), M.helmet);
  helmet.position.set(0, 0.80, 0.02); helmet.scale.set(1, 1.02, 1.14);
  const visor = add(hi, g('visor', () => new THREE.SphereGeometry(0.140, 24, 10, -0.92, 1.84, 1.18, 0.48)), M.visor);
  visor.position.copy(helmet.position); visor.scale.copy(helmet.scale);

  // Hombros del mono del piloto y arnés
  const shoulders = add(hi, g('shoulders', () => box(0.42, 0.16, 0.22)), M.c1);
  shoulders.position.set(0, 0.60, 0.02);
  const harness = add(hi, g('harness', () => box(0.28, 0.165, 0.225)), M.c2);
  harness.position.set(0, 0.60, 0.02);

  // Volante tipo mariposa (butterfly yoke) con empuñaduras, botones y pantalla LCD activa
  const wheel = add(hi, g('swheel', () => box(0.21, 0.095, 0.028)), M.black);
  wheel.position.set(0, 0.60, 0.36); wheel.rotation.x = -0.42;
  const scr = add(hi, g('scr', () => new THREE.PlaneGeometry(0.088, 0.044)), M.screen, false);
  scr.position.set(0, 0.605, 0.348); scr.rotation.x = -0.42 + Math.PI; scr.rotation.y = Math.PI;

  // Retrovisores aerodinámicos con doble soporte (stalk + flow conditioner al pontón)
  for (const sd of [1, -1]) {
    const mir = add(hi, g('mirror', () => {
      const b = box(0.12, 0.048, 0.045);
      return b;
    }), M.carbon);
    mir.position.set(sd * 0.46, 0.71, 0.60);

    const glassM = add(hi, g('mglass', () => new THREE.PlaneGeometry(0.11, 0.040)), M.chrome, false);
    glassM.position.set(sd * 0.46, 0.71, 0.576); glassM.rotation.y = Math.PI;

    // Soporte vertical al chasis y aleta horizontal al pontón
    add(hi, g('mstalk' + sd, () => rod([sd * 0.28, 0.62, 0.60], [sd * 0.45, 0.71, 0.60], 0.010)), M.carbon);
    add(hi, g('mstay' + sd, () => rod([sd * 0.46, 0.68, 0.60], [sd * 0.56, 0.54, 0.60], 0.010)), M.c2);
  }

  // Dorsales en el morro y en la aleta
  const n1 = add(hi, g('numPlane', () => new THREE.PlaneGeometry(0.22, 0.22)), M.num, false);
  n1.position.set(0, 0.485, 2.30); n1.rotation.x = -Math.PI / 2 + 0.28; n1.rotation.z = Math.PI;
  for (const sd of [1, -1]) {
    const n = add(hi, g('numPlaneSide', () => new THREE.PlaneGeometry(0.20, 0.20)), M.num, false);
    n.position.set(sd * 0.205, 0.75, -1.05); n.rotation.y = sd * (Math.PI / 2 - 0.12);
  }

  // --- 6. RUEDAS DE 18", TAPACUBOS, SUSPENSIÓN Y DEFLECTORES
  const wheels = [];
  const specs = [
    { z: 1.80, x: 0.80, r: 0.36, w: 0.305, front: true },
    { z: -1.80, x: 0.78, r: 0.36, w: 0.405, front: false },
  ];
  for (const sp of specs) for (const sd of [1, -1]) {
    const steer = new THREE.Group(); steer.position.set(sd * sp.x, sp.r, sp.z); hi.add(steer);
    const spin = new THREE.Group(); steer.add(spin);

    // Neumático con banda de rodadura y hombro redondeado
    const tyre = add(spin, g('tyre' + sp.w, () => tyreGeo(sp.r, sp.w, 0.230)), M.rubber);

    // Flanco exterior con banda de compuesto y lettering de alta definición
    const side = add(spin, g('side' + sp.r, () => {
      const r = new THREE.RingGeometry(0.230, sp.r - 0.010, 48, 1);
      const uv = r.attributes.uv, p = r.attributes.position;
      for (let k = 0; k < p.count; k++) uv.setXY(k, 0.5 + (p.getX(k) / sp.r) * 0.49, 0.5 + (p.getY(k) / sp.r) * 0.49);
      return r;
    }), M.tyre.M, false);
    side.position.x = sd * (sp.w / 2 + 0.002); side.rotation.y = sd * Math.PI / 2;

    // Flanco interior (visible desde cámaras onboard)
    const sideIn = add(spin, g('sideIn' + sp.r, () => {
      const r = new THREE.RingGeometry(0.230, sp.r - 0.010, 48, 1);
      const uv = r.attributes.uv, p = r.attributes.position;
      for (let k = 0; k < p.count; k++) uv.setXY(k, 0.5 + (p.getX(k) / sp.r) * 0.49, 0.5 + (p.getY(k) / sp.r) * 0.49);
      return r;
    }), M.tyre.M, false);
    sideIn.position.x = -sd * (sp.w / 2 + 0.002); sideIn.rotation.y = -sd * Math.PI / 2;

    // Tapacubos aerodinámico exterior de 18 pulgadas
    const cov = add(spin, g('cover', () => new THREE.CircleGeometry(0.230, 36)), M.cover, false);
    cov.position.x = sd * (sp.w / 2 - 0.028); cov.rotation.y = sd * Math.PI / 2;

    // Tuerca de rueda central 3D
    const nut = add(spin, g('wheelNut', () => {
      const c = new THREE.CylinderGeometry(0.022, 0.024, 0.035, 12);
      c.rotateZ(Math.PI / 2); return c;
    }), M.chrome, false);
    nut.position.x = sd * (sp.w / 2 - 0.010);

    // Cilindro interior de la llanta
    const rimIn = add(spin, g('rimIn' + sp.w, () => {
      const c = new THREE.CylinderGeometry(0.234, 0.234, sp.w * 0.92, 28, 1, true);
      c.rotateZ(Math.PI / 2); return c;
    }), M.rim, false);

    // dentro de la llanta: disco, pinza y mangueta (no giran con la rueda; las delanteras sí giran con la dirección).
    // La mangueta es a donde llegan los brazos, y el fondo tapa el hueco de la llanta (antes se veía la pista a través)
    const back = add(steer, g('rimBack', () => new THREE.CircleGeometry(0.234, 24)), M.rim, false);
    back.rotation.y = -sd * Math.PI / 2; back.position.x = sd * 0.02;
    const disc = add(steer, g('disc', () => { const c = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24); c.rotateZ(Math.PI / 2); return c; }), M.brake, false);
    disc.position.x = -sd * (sp.w / 2 - 0.06);
    const cal = add(steer, g('caliper', () => box(0.07, 0.16, 0.08)), M.caliper, false);
    cal.position.set(-sd * (sp.w / 2 - 0.06), 0.1, sp.front ? -0.1 : 0.1); cal.rotation.x = sp.front ? 0.6 : -0.6;
    const up = add(steer, g('upright', () => box(0.05, 0.34, 0.1)), M.carbon);
    up.position.x = -sd * (sp.w / 2 - 0.02);
    // conducto de freno (tambor de carbono hacia el chasis)
    const duct = add(steer, g('duct', () => new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16)), M.carbon, false);
    duct.rotation.z = Math.PI / 2; duct.position.x = -sd * (sp.w / 2 + 0.04);
    wheels.push({ steer, spin, tyre: side, tyreIn: sideIn, front: sp.front });
    // triángulos de suspensión
    const hub = [sd * (sp.x - sp.w / 2 + 0.02), sp.r, sp.z];   // la mangueta
    const inY = sp.front ? 0.34 : 0.3;
    add(hi, g(`susp${sp.z}${sd}a`, () => rod([sd * 0.2, inY + 0.12, sp.z + 0.25], [hub[0], hub[1] + 0.15, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}b`, () => rod([sd * 0.2, inY + 0.12, sp.z - 0.25], [hub[0], hub[1] + 0.15, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}c`, () => rod([sd * 0.18, inY - 0.12, sp.z + 0.3], [hub[0], hub[1] - 0.15, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}d`, () => rod([sd * 0.18, inY - 0.12, sp.z - 0.3], [hub[0], hub[1] - 0.15, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}e`, () => rod([sd * 0.2, inY + 0.05, sp.z + (sp.front ? 0.1 : -0.1)], [hub[0], hub[1], hub[2] + (sp.front ? 0.12 : -0.12)], 0.01)), M.carbon);
  }


  // --- 7. VERSIÓN LEJANA (LOD ULTRA-LIGERO)
  add(lo, g('bodyLo', () => loft(bodyStations().filter((_, i) => i % 2 === 0), 14)), M.paint);
  add(lo, g('podLLo', () => loft(sidepodStations(1).filter((_, i) => i % 2 === 0 || i === 5), 12)), M.paint);
  add(lo, g('podRLo', () => loft(sidepodStations(-1).filter((_, i) => i % 2 === 0 || i === 5), 12)), M.paint);
  const fwLo = add(lo, g('fwLo', () => box(1.92, 0.05, 0.45)), M.carbon); fwLo.position.set(0, 0.16, 2.85);
  const rwLo = add(lo, g('rwLo', () => box(1.05, 0.28, 0.40)), M.carbon); rwLo.position.set(0, 0.88, -2.45);
  const flLo = add(lo, g('flLo', () => box(1.64, 0.03, 3.35)), M.carbon); flLo.position.set(0, 0.08, -0.40);
  const hLo = add(lo, g('hLo', () => new THREE.SphereGeometry(0.14, 10, 8)), M.helmet); hLo.position.set(0, 0.80, 0.02);
  const loWheels = [];
  for (const sp of specs) for (const sd of [1, -1]) {
    const w = add(lo, g('wLo' + sp.w, () => {
      const c = new THREE.CylinderGeometry(sp.r, sp.r, sp.w, 18);
      c.rotateZ(Math.PI / 2); return c;
    }), M.lowTyre.M);
    w.position.set(sd * sp.x, sp.r, sp.z); loWheels.push(w);
  }

  const car = {
    root, body, lod, hi, lo, detailed: true, wheels, loWheels, flap: flapPivot, rain, fw, rw, fwLo, rwLo, M, compound: 'M', fast: false,
    setCompound(c, fast = false) {
      if (c === this.compound && fast === this.fast) return;
      this.compound = c; this.fast = fast;
      for (const w of this.wheels) w.tyre.material = w.tyreIn.material = (fast ? M.tyreFast : M.tyre)[c];
      for (const w of this.loWheels) w.material = M.lowTyre[c];
    },
  };
  return car;
}

// Cámara on-board: posiciones locales
export const CAM_MOUNTS = {
  cockpit: { pos: [0, 0.80, 0.14], look: [0, 0.68, 6] },
  tcam: { pos: [0, 1.16, -0.58], look: [0, 0.72, 8] },
  nose: { pos: [0.0, 0.50, 2.65], look: [0, 0.40, 10] },
  rear: { pos: [0.0, 1.05, -0.50], look: [0, 0.60, -8] },
};
