// Monoplaza procedural: chasis por secciones (loft), pontones, suelo y difusor, alerones multi-elemento,
// DRS móvil, halo, piloto, volante, retrovisores, suspensión, ruedas con banda de compuesto y tapacubos.
// Ejes locales: +z hacia delante, +y arriba, +x a la izquierda. Origen: suelo, entre ejes.
import * as THREE from 'three';
import * as TX from './textures.js';
import { COMPOUNDS } from './teams.js';

const geoCache = new Map();
const g = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };

// Sección superelipse: x = cx ± w, y entre yb y yt
function loft(stations, around = 28, nExp = 3.2) {
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

// Perfil alar extruido a lo largo de x
function airfoil(chord, thick, span, camber = 0.06) {
  const sh = new THREE.Shape();
  const N = 14;
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
  // shape en (x=cuerda, y) -> cuerda hacia -z, extrusión a lo largo de x centrada
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2);
  return geo; // ahora cuerda a lo largo de -z... (borde de ataque en z=0, salida en z=-chord)
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

function tube(points, r = 0.03, seg = 40) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, r, 8, false);
}

function rod(a, b, r = 0.014) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(r, r, len, 6);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0));
  const pos = A.clone().add(B).multiplyScalar(0.5);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler().setFromRotationMatrix(m)));
  geo.translate(pos.x, pos.y, pos.z);
  return geo;
}

function tyreGeo(radius, width, rimR) {
  // perfil del neumático (en el plano xy, se revoluciona alrededor de y)
  const pts = [];
  const hw = width / 2, sh = 0.05;
  pts.push(new THREE.Vector2(rimR, -hw + 0.01));
  pts.push(new THREE.Vector2(radius - sh, -hw));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(radius - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(radius - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(radius - sh, hw));
  pts.push(new THREE.Vector2(rimR, hw - 0.01));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.rotateZ(Math.PI / 2); // eje de giro a lo largo de x
  return geo;
}

const matCache = new Map();
function mats(team, drv) {
  const key = team.id + drv.code;
  if (matCache.has(key)) return matCache.get(key);
  const carbonTex = TX.carbon();
  const m = {
    paint: new THREE.MeshStandardMaterial({ map: TX.livery(team, drv.num), metalness: 0.1, roughness: 0.42, envMapIntensity: 0.4 }),
    c1: new THREE.MeshStandardMaterial({ color: team.c1, metalness: 0.1, roughness: 0.42, envMapIntensity: 0.4 }),
    c2: new THREE.MeshStandardMaterial({ color: team.c2, metalness: 0.1, roughness: 0.42, envMapIntensity: 0.4 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x2a2c30, map: carbonTex, metalness: 0.35, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.2, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.0, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2c2e33, metalness: 0.8, roughness: 0.35 }),
    cover: new THREE.MeshStandardMaterial({ map: TX.wheelCover(team.c2), metalness: 0.5, roughness: 0.4 }),
    helmet: new THREE.MeshStandardMaterial({ map: TX.helmet(drv.helmet, team.c2), metalness: 0.3, roughness: 0.25 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.9, roughness: 0.08 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.2 }),
    light: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 0 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x050507, emissive: 0x1e88e5, emissiveIntensity: 0.6 }),
    tcam: new THREE.MeshStandardMaterial({ color: drv.num % 2 ? 0x111111 : 0xffd400, metalness: 0.3, roughness: 0.4 }),
    num: new THREE.MeshBasicMaterial({ map: TX.numberTex(drv.num, '#ffffff'), transparent: true, depthWrite: false }),
  };
  m.tyre = {};
  for (const c of 'SMHIW') m.tyre[c] = new THREE.MeshStandardMaterial({ map: TX.tyreSide(COMPOUNDS[c].color), metalness: 0, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
  m.tyreFast = {};
  for (const c of 'SMHIW') m.tyreFast[c] = new THREE.MeshStandardMaterial({ map: TX.tyreSide(COMPOUNDS[c].color, true), metalness: 0, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
  m.lowTyre = {};
  for (const c of 'SMHIW') m.lowTyre[c] = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9, emissive: new THREE.Color(COMPOUNDS[c].color), emissiveIntensity: 0.06 });
  matCache.set(key, m);
  return m;
}

function bodyStations() {
  return [
    { z: 3.08, w: 0.05, yb: 0.31, yt: 0.35 },
    { z: 2.95, w: 0.09, yb: 0.27, yt: 0.39 },
    { z: 2.6, w: 0.12, yb: 0.22, yt: 0.45 },
    { z: 2.1, w: 0.16, yb: 0.17, yt: 0.53 },
    { z: 1.6, w: 0.21, yb: 0.13, yt: 0.6 },
    { z: 1.1, w: 0.27, yb: 0.1, yt: 0.66 },
    { z: 0.7, w: 0.31, yb: 0.08, yt: 0.68 },
    { z: 0.3, w: 0.34, yb: 0.08, yt: 0.6 },
    { z: -0.1, w: 0.36, yb: 0.08, yt: 0.62 },
    { z: -0.35, w: 0.33, yb: 0.1, yt: 0.95 },
    { z: -0.75, w: 0.28, yb: 0.12, yt: 0.9 },
    { z: -1.25, w: 0.22, yb: 0.15, yt: 0.76 },
    { z: -1.8, w: 0.14, yb: 0.2, yt: 0.6 },
    { z: -2.3, w: 0.08, yb: 0.27, yt: 0.47 },
    { z: -2.48, w: 0.04, yb: 0.32, yt: 0.4 },
  ];
}

function sidepodStations(side) {
  const s = side;
  return [
    { z: 0.78, w: 0.13, yb: 0.13, yt: 0.5, cx: s * 0.58, n: 4 },
    { z: 0.55, w: 0.2, yb: 0.11, yt: 0.55, cx: s * 0.6, n: 4 },
    { z: 0.1, w: 0.22, yb: 0.11, yt: 0.55, cx: s * 0.58, n: 3.5 },
    { z: -0.5, w: 0.19, yb: 0.12, yt: 0.49, cx: s * 0.5, n: 3 },
    { z: -1.1, w: 0.13, yb: 0.14, yt: 0.4, cx: s * 0.38, n: 3 },
    { z: -1.6, w: 0.07, yb: 0.17, yt: 0.32, cx: s * 0.28, n: 3 },
  ];
}

// Coche completo (detalle alto) + versión lejana (LOD)
export function buildCar(team, drv) {
  const M = mats(team, drv);
  const root = new THREE.Group(); // posición en pista
  const body = new THREE.Group(); // cabeceo/balanceo
  root.add(body);
  const hi = new THREE.Group(), lo = new THREE.Group();
  // nivel de detalle manual (con zoom y con histéresis, ver main.js) para que no parpadee
  const lod = new THREE.Group(); lod.add(hi, lo); lo.visible = false;
  body.add(lod);
  const add = (grp, geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = false; grp.add(m); return m; };

  // --- chasis
  add(hi, g('body', () => loft(bodyStations(), 32)), M.paint);
  add(hi, g('podL', () => loft(sidepodStations(1), 24)), M.paint);
  add(hi, g('podR', () => loft(sidepodStations(-1), 24)), M.paint);
  // bocas de los pontones
  for (const sd of [1, -1]) {
    const inlet = add(hi, g('inlet', () => new THREE.CircleGeometry(0.15, 20).scale(0.75, 1.1, 1)), M.black, false);
    inlet.position.set(sd * 0.58, 0.33, 0.79);
  }
  // hueco del cockpit
  const cockpit = add(hi, g('cockpit', () => new THREE.CircleGeometry(0.26, 24).scale(1, 1.7, 1)), M.black, false);
  cockpit.rotation.x = -Math.PI / 2 + 0.06; cockpit.position.set(0, 0.615, 0.1);
  // aleta de tiburón y toma de aire
  add(hi, g('fin', () => { const s = new THREE.Shape(); s.moveTo(0.5, 0.88); s.lineTo(2.0, 0.5); s.lineTo(2.05, 0.72); s.lineTo(0.55, 1.0); s.closePath(); const e = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }); e.rotateY(Math.PI / 2); e.translate(-0.006, 0, 0); return e; }), M.c1);
  const airbox = add(hi, g('airbox', () => new THREE.CircleGeometry(0.1, 16).scale(1, 1.25, 1)), M.black, false);
  airbox.position.set(0, 0.86, -0.34);
  const tcam = add(hi, g('tcam', () => box(0.1, 0.05, 0.18)), M.tcam); tcam.position.set(0, 0.99, -0.42);

  // --- suelo y difusor
  add(hi, g('floor', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.55, 1.25); s.lineTo(0.55, 1.25); s.lineTo(0.8, 0.8); s.lineTo(0.8, -1.35); s.quadraticCurveTo(0.8, -1.9, 0.5, -2.05); s.lineTo(-0.5, -2.05); s.quadraticCurveTo(-0.8, -1.9, -0.8, -1.35); s.lineTo(-0.8, 0.8); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); e.rotateX(Math.PI / 2); e.translate(0, 0.075, 0); return e;
  }), M.carbon);
  // bordes del suelo (curvados hacia arriba)
  for (const sd of [1, -1]) { const e = add(hi, g('edge', () => box(0.02, 0.07, 2.2)), M.carbon); e.position.set(sd * 0.8, 0.1, -0.3); }
  const diff = add(hi, g('diff', () => { const e = box(1.0, 0.02, 0.55); e.rotateX(0.35); e.translate(0, 0.18, -2.25); return e; }), M.carbon);
  for (let i = -2; i <= 2; i++) { const st = add(hi, g('strake', () => { const e = box(0.012, 0.2, 0.5); e.rotateX(0.35); return e; }), M.carbon); st.position.set(i * 0.22, 0.2, -2.25); }
  const plank = add(hi, g('plank', () => box(0.3, 0.02, 2.8)), M.black, false); plank.position.set(0, 0.05, -0.2);

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

  // --- halo, piloto, volante, retrovisores
  add(hi, g('halo', () => tube([[0.3, 0.64, -0.3], [0.33, 0.86, -0.05], [0.26, 0.9, 0.32], [0, 0.92, 0.5], [-0.26, 0.9, 0.32], [-0.33, 0.86, -0.05], [-0.3, 0.64, -0.3]], 0.028, 48)), M.carbon);
  add(hi, g('haloP', () => tube([[0, 0.92, 0.5], [0, 0.8, 0.66], [0, 0.66, 0.78]], 0.03, 12)), M.carbon);
  const helmet = add(hi, g('helmet', () => new THREE.SphereGeometry(0.135, 20, 14)), M.helmet); helmet.position.set(0, 0.8, 0.02); helmet.scale.set(1, 1, 1.12);
  const visor = add(hi, g('visor', () => new THREE.SphereGeometry(0.137, 20, 8, -0.9, 1.8, 1.2, 0.45)), M.visor); visor.position.copy(helmet.position); visor.scale.copy(helmet.scale);
  const pads = add(hi, g('pads', () => box(0.5, 0.1, 0.18)), M.c2); pads.position.set(0, 0.64, -0.12);
  const wheel = add(hi, g('swheel', () => box(0.2, 0.09, 0.03)), M.black); wheel.position.set(0, 0.6, 0.36); wheel.rotation.x = -0.4;
  const scr = add(hi, g('scr', () => new THREE.PlaneGeometry(0.08, 0.04)), M.screen, false); scr.position.set(0, 0.603, 0.35); scr.rotation.x = -0.4 + Math.PI;
  scr.rotation.y = Math.PI;
  for (const sd of [1, -1]) {
    const mir = add(hi, g('mirror', () => box(0.11, 0.045, 0.04)), M.carbon); mir.position.set(sd * 0.45, 0.71, 0.6);
    const glassM = add(hi, g('mglass', () => new THREE.PlaneGeometry(0.1, 0.038)), M.visor, false); glassM.position.set(sd * 0.45, 0.71, 0.578); glassM.rotation.y = Math.PI;
    add(hi, g('mstalk' + sd, () => rod([sd * 0.3, 0.62, 0.6], [sd * 0.44, 0.71, 0.6], 0.012)), M.carbon);
  }
  // números
  const n1 = add(hi, g('numPlane', () => new THREE.PlaneGeometry(0.22, 0.22)), M.num, false); n1.position.set(0, 0.49, 2.3); n1.rotation.x = -Math.PI / 2 + 0.28; n1.rotation.z = Math.PI;
  for (const sd of [1, -1]) { const n = add(hi, g('numPlane', () => new THREE.PlaneGeometry(0.22, 0.22)), M.num, false); n.position.set(sd * 0.215, 0.75, -1.05); n.rotation.y = sd * (Math.PI / 2 - 0.12); }

  // --- ruedas y suspensión
  const wheels = [];
  const specs = [
    { z: 1.8, x: 0.8, r: 0.36, w: 0.3, front: true },
    { z: -1.8, x: 0.78, r: 0.36, w: 0.4, front: false },
  ];
  for (const sp of specs) for (const sd of [1, -1]) {
    const steer = new THREE.Group(); steer.position.set(sd * sp.x, sp.r, sp.z); hi.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const tyre = add(spin, g('tyre' + sp.w, () => tyreGeo(sp.r, sp.w, 0.23)), M.rubber);
    // flanco exterior: anillo plano con la banda del compuesto (UV planas, no las del torno)
    const side = add(spin, g('side' + sp.r, () => { const r = new THREE.RingGeometry(0.232, sp.r - 0.012, 48, 1); const uv = r.attributes.uv, p = r.attributes.position; for (let k = 0; k < p.count; k++) uv.setXY(k, 0.5 + (p.getX(k) / sp.r) * 0.49, 0.5 + (p.getY(k) / sp.r) * 0.49); return r; }), M.tyre.M, false);
    side.position.x = sd * (sp.w / 2 + 0.002); side.rotation.y = sd * Math.PI / 2;
    // y en el flanco interior (se ve desde las cámaras a bordo)
    const sideIn = add(spin, g('side' + sp.r), M.tyre.M, false);
    sideIn.position.x = -sd * (sp.w / 2 + 0.002); sideIn.rotation.y = -sd * Math.PI / 2;
    // tapacubos exterior, un poco hundido para que no parpadee con el flanco
    const cov = add(spin, g('cover', () => new THREE.CircleGeometry(0.232, 32)), M.cover, false);
    cov.position.x = sd * (sp.w / 2 - 0.035); cov.rotation.y = sd * Math.PI / 2;
    const rimIn = add(spin, g('rimIn' + sp.w, () => { const c = new THREE.CylinderGeometry(0.235, 0.235, sp.w * 0.9, 24, 1, true); c.rotateZ(Math.PI / 2); return c; }), M.rim, false);
    // conductos de freno (no giran)
    const duct = add(steer, g('duct', () => new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16)), M.carbon, false);
    duct.rotation.z = Math.PI / 2; duct.position.x = -sd * (sp.w / 2 + 0.02);
    wheels.push({ steer, spin, tyre: side, tyreIn: sideIn, front: sp.front });
    // triángulos de suspensión
    const hub = [sd * (sp.x - 0.14), sp.r, sp.z];
    const inY = sp.front ? 0.34 : 0.3;
    add(hi, g(`susp${sp.z}${sd}a`, () => rod([sd * 0.2, inY + 0.12, sp.z + 0.25], [hub[0], hub[1] + 0.1, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}b`, () => rod([sd * 0.2, inY + 0.12, sp.z - 0.25], [hub[0], hub[1] + 0.1, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}c`, () => rod([sd * 0.18, inY - 0.12, sp.z + 0.3], [hub[0], hub[1] - 0.1, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}d`, () => rod([sd * 0.18, inY - 0.12, sp.z - 0.3], [hub[0], hub[1] - 0.1, hub[2]])), M.carbon);
    add(hi, g(`susp${sp.z}${sd}e`, () => rod([sd * 0.2, inY + 0.05, sp.z + (sp.front ? 0.1 : -0.1)], [hub[0], hub[1], hub[2] + (sp.front ? 0.12 : -0.12)], 0.01)), M.carbon);
  }

  // --- versión lejana: pocas piezas
  add(lo, g('bodyLo', () => loft(bodyStations().filter((_, i) => i % 2 === 0), 12)), M.paint);
  add(lo, g('podLLo', () => loft(sidepodStations(1).filter((_, i) => i % 2 === 0 || i === 5), 10)), M.paint);
  add(lo, g('podRLo', () => loft(sidepodStations(-1).filter((_, i) => i % 2 === 0 || i === 5), 10)), M.paint);
  const fwLo = add(lo, g('fwLo', () => box(1.9, 0.05, 0.45)), M.carbon); fwLo.position.set(0, 0.16, 2.85);
  const rwLo = add(lo, g('rwLo', () => box(1.02, 0.28, 0.4)), M.carbon); rwLo.position.set(0, 0.88, -2.45);
  const flLo = add(lo, g('flLo', () => box(1.6, 0.03, 3.3)), M.carbon); flLo.position.set(0, 0.08, -0.4);
  const hLo = add(lo, g('hLo', () => new THREE.SphereGeometry(0.14, 8, 6)), M.helmet); hLo.position.set(0, 0.8, 0.02);
  const loWheels = [];
  for (const sp of specs) for (const sd of [1, -1]) {
    const w = add(lo, g('wLo' + sp.w, () => { const c = new THREE.CylinderGeometry(sp.r, sp.r, sp.w, 16); c.rotateZ(Math.PI / 2); return c; }), M.lowTyre.M);
    w.position.set(sd * sp.x, sp.r, sp.z); loWheels.push(w);
  }

  const car = {
    root, body, lod, hi, lo, detailed: true, wheels, loWheels, flap: flapPivot, rain, fw, rw, fwLo, rwLo, M, compound: 'M', fast: false,
    // rápido: dibujo desenfocado (sin texto), como el desenfoque de movimiento de la tele
    setCompound(c, fast = false) {
      if (c === this.compound && fast === this.fast) return; this.compound = c; this.fast = fast;
      for (const w of this.wheels) w.tyre.material = w.tyreIn.material = (fast ? M.tyreFast : M.tyre)[c];
      for (const w of this.loWheels) w.material = M.lowTyre[c];
    },
  };
  return car;
}

// Cámara on-board: posiciones locales
export const CAM_MOUNTS = {
  cockpit: { pos: [0, 0.8, 0.14], look: [0, 0.68, 6] },
  tcam: { pos: [0, 1.16, -0.58], look: [0, 0.72, 8] },
  nose: { pos: [0.0, 0.5, 2.65], look: [0, 0.4, 10] },
  rear: { pos: [0.0, 1.05, -0.5], look: [0, 0.6, -8] },
};
