// Circuito 3D y alrededores: asfalto con goma, pianos, escapatorias, muros con publicidad, vallas,
// pit lane con garajes por equipo, semáforo de salida, gradas con público, pantallas, árboles, colinas.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as TX from './textures.js';
import { HALF_W, between } from './track.js';
import { TEAMS } from './teams.js';

const HW = HALF_W;

// ---------------------------------------------------------------- ayudantes de geometría
class Ribbon {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.n = 0; }
  // columnas: lista de [x,y,z,u,v] con la misma cantidad por estación
  strip(rows) {
    // rows: array de estaciones; cada estación = array de vértices [x,y,z,u,v]
    const cols = rows[0].length;
    const base = this.n;
    for (const r of rows) for (const v of r) { this.pos.push(v[0], v[1], v[2]); this.uv.push(v[3], v[4]); this.n++; }
    for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < cols - 1; c++) {
      const a = base + i * cols + c, b = a + cols;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  quad(p0, p1, p2, p3, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const b = this.n;
    for (const [p, t] of [[p0, uv[0]], [p1, uv[1]], [p2, uv[2]], [p3, uv[3]]]) { this.pos.push(...p); this.uv.push(...t); this.n++; }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}

function smooth(a, r, loops = 2) {
  const n = a.length; let src = Float32Array.from(a);
  for (let p = 0; p < loops; p++) {
    const dst = new Float32Array(n);
    for (let i = 0; i < n; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += src[(i + j + n) % n]; dst[i] = acc / (2 * r + 1); }
    src = dst;
  }
  return src;
}

function hash(x) { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); }

export function buildWorld(T, scene, renderer, quality = 'high') {
  const world = { update: () => {}, screens: [], lights: [], marshal: [], crews: [], overheads: [] };
  const meta = T.meta || {}, night = !!meta.night, urban = !!meta.urban;
  world.night = night; world.urban = urban;
  const STEP = 2;
  const M = Math.floor(T.L / STEP);
  const P = [0, 0, 0];
  const pos = (s, d, dy = 0) => { T.pos(s, d, P); return [P[0], P[1] + dy, P[2]]; };

  // ---------- anchura de escapatoria a cada lado
  // escapatorias y barreras: las calcula track.js (la simulación también las usa para los trompos)
  const { kS, BL: BLs, BR: BRs, typeL, typeR } = T.runoff;
  const nearest = T.nearest; world.nearest = nearest;
  world.barrier = T.barrier;

  // ---------- materiales
  const mat = {
    asphalt: new THREE.MeshStandardMaterial({ map: TX.asphalt(), roughness: 0.96, metalness: 0.0, color: 0xd6d6d6, envMapIntensity: 0.35 }),
    rubber: new THREE.MeshStandardMaterial({ map: TX.rubber(), transparent: true, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }),
    kerb: new THREE.MeshStandardMaterial({ map: TX.kerb(), roughness: 0.55 }),
    kerbY: new THREE.MeshStandardMaterial({ map: TX.kerb('#FFD200', '#1b1b1b'), roughness: 0.55 }),
    verge: new THREE.MeshStandardMaterial({ map: TX.asphalt(), color: 0xb9bcc2, roughness: 0.95 }),
    grass: new THREE.MeshStandardMaterial({ map: night ? TX.sand() : TX.grass(), roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ map: TX.gravel(), roughness: 1 }),
    paint: new THREE.MeshStandardMaterial({ map: TX.runoffPaint(), roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ map: TX.sponsorBoard(3, 64), roughness: 0.6, side: THREE.DoubleSide }),
    wall2: new THREE.MeshStandardMaterial({ map: TX.sponsorBoard(8, 64), roughness: 0.6, side: THREE.DoubleSide }),
    concrete: new THREE.MeshStandardMaterial({ map: TX.concreteWall(), roughness: 0.9, side: THREE.DoubleSide }),
    tecpro: new THREE.MeshStandardMaterial({ map: TX.tecpro(), roughness: 0.7 }),
    fence: new THREE.MeshStandardMaterial({ map: TX.fence(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.7, roughness: 0.4 }),
    terrain: new THREE.MeshStandardMaterial({ map: night ? TX.sand() : TX.terrainGrass(), roughness: 1, vertexColors: true }),
    check: new THREE.MeshStandardMaterial({ map: checkTex(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }),
  };
  mat.asphalt.map.repeat.set(1, 1);

  // ---------- pista
  {
    const r = new Ribbon(), cols = 6;
    for (let i = 0; i <= M; i++) {
      const s = i * STEP, row = [];
      for (let c = 0; c <= cols; c++) { const d = -HW + (2 * HW * c) / cols; const p = pos(s, d); row.push([...p, (d + HW) / 4.5, s / 4.5]); }
      r.strip([row]);
      r.idx.length; // se cierran abajo
    }
    // reconstruir índices para tiras conectadas
    r.idx = []; const cc = cols + 1;
    for (let i = 0; i < M; i++) for (let c = 0; c < cols; c++) { const a = i * cc + c, b = a + cc; r.idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const mesh = new THREE.Mesh(r.geo(), mat.asphalt); mesh.receiveShadow = true; scene.add(mesh);
  }
  // ribbon genérico a lo largo de s
  function along(s0, len, dA, dB, dy, material, uScale = 1, vScale = 4, shadow = true, stepM = STEP) {
    const r = new Ribbon(); const n = Math.max(1, Math.ceil(len / stepM));
    const rows = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (len * k) / n;
      const a = typeof dA === 'function' ? dA(s) : dA, b = typeof dB === 'function' ? dB(s) : dB;
      const ya = typeof dy === 'function' ? dy(s, 0) : dy, yb = typeof dy === 'function' ? dy(s, 1) : dy;
      if (Math.abs(b - a) < 0.01) {
        // pared vertical: u a lo largo (legible desde la pista), v en altura
        const u = (a < 0 ? -s : s) / vScale;
        rows.push([[...pos(s, a, ya), u, ya < yb ? 0 : 1], [...pos(s, b, yb), u, ya < yb ? 1 : 0]]);
      } else rows.push([[...pos(s, a, ya), 0, s / vScale], [...pos(s, b, yb), Math.abs(b - a) / uScale, s / vScale]]);
    }
    r.strip(rows);
    const m = new THREE.Mesh(r.geo(), material); m.receiveShadow = shadow; scene.add(m); return m;
  }
  // goma en la trazada ideal
  {
    const r = new Ribbon(); const rows = [];
    for (let i = 0; i <= M; i++) {
      const s = i * STEP, c = T.ideal[T.idx(s)];
      rows.push([[...pos(s, c - 1.6, 0.012), 0, s / 30], [...pos(s, c + 1.6, 0.012), 1, s / 30]]);
    }
    r.strip(rows); scene.add(new THREE.Mesh(r.geo(), mat.rubber));
  }
  // carril de boxes: eje (también antes de la entrada y después de la salida, pegado al borde) y tramos donde pisa la pista
  const pit = T.pit, PH = pit.halfW;
  const laneC = (s) => (between(T, s, T.wrap(pit.entryA - 90), pit.entryA) || between(T, s, pit.exitB, T.wrap(pit.exitB + 90)) ? pit.edgeD : pit.laneD(s));
  const sepAt = (a, len, dir) => { for (let q = 0; q <= len; q++) { const s = dir > 0 ? a + q : a + len - q; if (pit.laneD(s) + PH < -HW - 0.1) return T.wrap(s); } return T.wrap(a + len); };
  const sepIn = sepAt(pit.entryA, T.ahead(pit.entryA, pit.entryB), 1);   // el carril de entrada deja la pista
  const sepOut = sepAt(pit.exitA, T.ahead(pit.exitA, pit.exitB), -1);    // el de salida vuelve a ella
  const dashIn = [T.wrap(pit.entryA - 90), sepIn], dashOut = [sepOut, T.wrap(pit.exitB + 90)];
  const pitRamp = (s) => between(T, s, T.wrap(pit.entryA - 20), T.wrap(pit.exitB + 30));
  // líneas blancas de borde (la derecha, discontinua donde se entra y se sale de boxes)
  along(0, T.L, HW - 0.45, HW - 0.2, 0.01, mat.white);
  const paint = new Ribbon();
  const stripe = (s0, len, dFn, w, dash = 0, gap = 0) => {
    const pieces = dash ? [] : [[s0, len]];
    if (dash) for (let q = 0; q < len; q += dash + gap) pieces.push([s0 + q, Math.min(dash, len - q)]);
    for (const [a, l] of pieces) {
      const n = Math.max(1, Math.ceil(l / 1.5)), rows = [];
      for (let k = 0; k <= n; k++) { const ss = a + (l * k) / n, d = dFn(ss); rows.push([[...pos(ss, d - w / 2, 0.012), 0, 0], [...pos(ss, d + w / 2, 0.012), 1, 0]]); }
      paint.strip(rows);
    }
  };
  {
    const edge = () => -HW + 0.325;
    stripe(dashIn[1], T.ahead(dashIn[1], dashOut[0]), edge, 0.25);
    stripe(dashOut[1], T.ahead(dashOut[1], dashIn[0]), edge, 0.25);
    stripe(dashIn[0], T.ahead(dashIn[0], dashIn[1]), edge, 0.25, 3, 3);
    stripe(dashOut[0], T.ahead(dashOut[0], dashOut[1]), edge, 0.25, 3, 3);
  }
  // línea de meta y parrilla
  {
    along(-1, 2, -HW, HW, 0.013, mat.check, 1, 1, true, 1);
    for (const gs of T.grid) {
      const d = gs.d;
      along(gs.s + 1.2, 0.25, d - 1.4, d + 1.4, 0.013, mat.white, 1, 1, true, 1);
      along(gs.s - 3.5, 4.7, d - 1.5, d - 1.35, 0.013, mat.white, 1, 1, true, 1);
    }
  }
  // pianos en curvas
  {
    for (const side of [1, -1]) {
      let run = null;
      const flush = (a, b) => {
        if (b - a < 10) return;
        const mm = along(a, b - a, side > 0 ? HW - 0.3 : -HW - 1.5, side > 0 ? HW + 1.5 : -HW + 0.3,
          (s, e) => (side > 0 ? (e ? 0.02 : 0.07) : (e ? 0.07 : 0.02)), (a * 7) % 3 < 1 ? mat.kerbY : mat.kerb, 1.8, 3.2, true, 1);
        mm.castShadow = false;
      };
      for (let i = 0; i < M; i++) {
        const need = Math.abs(kS[i]) > 1 / 160 && !(side < 0 && pitRamp(i * STEP));
        if (need && run == null) run = i * STEP;
        if (!need && run != null) { flush(run - 12, i * STEP + 12); run = null; }
      }
    }
  }
  // escapatorias por tipo
  const byType = (side, type) => {
    const B = side > 0 ? BLs : BRs, tp = side > 0 ? typeL : typeR;
    let run = null;
    for (let i = 0; i <= M; i++) {
      const on = i < M && tp[i] === type;
      if (on && run == null) run = i;
      if (!on && run != null) {
        const s0 = run * STEP, len = (i - run) * STEP;
        const inner = (s) => side * (HW + 1.5), outer = (s) => side * (B[Math.floor(T.wrap(s) / STEP) % M] - 0.4);
        const material = type === 0 ? mat.grass : type === 1 ? mat.gravel : type === 2 ? mat.paint : mat.verge;
        const [a, b] = side > 0 ? [inner, outer] : [outer, inner];
        along(s0, len + STEP, a, b, -0.02, material, type === 2 ? 30 : 6, type === 2 ? 60 : 6);
        run = null;
      }
    }
  };
  for (const side of [1, -1]) for (const t of [0, 1, 2, 3]) byType(side, t);
  // arcén asfaltado junto a la pista (encima de la escapatoria)
  const vergeW = (s, side) => Math.min(HW + 3, world.barrier(s, side) - 0.45);
  along(0, T.L, HW + 0.1, (s) => vergeW(s, 1), -0.005, mat.verge, 6, 6);
  along(0, T.L, (s) => (pitRamp(s) ? -HW - 0.1 : -vergeW(s, -1)), -HW - 0.1, -0.005, mat.verge, 6, 6);

  // ---------- muros, tecpro y vallas (y sus segmentos en planta, para saber si tapan un plano)
  const WC = 16, wallGrid = new Map();
  const addWall = (ax, az, ay, bx, bz, by, top) => {
    const seg = { ax, az, ay, bx, bz, by, top };
    for (let cx = Math.floor(Math.min(ax, bx) / WC); cx <= Math.floor(Math.max(ax, bx) / WC); cx++) for (let cz = Math.floor(Math.min(az, bz) / WC); cz <= Math.floor(Math.max(az, bz) / WC); cz++) {
      const k = cx * 100003 + cz; let l = wallGrid.get(k); if (!l) wallGrid.set(k, l = []); l.push(seg);
    }
  };
  {
    for (const side of [1, -1]) {
      const B = side > 0 ? BLs : BRs, tp = side > 0 ? typeL : typeR;
      const wall = new Ribbon(), top = new Ribbon(), fence = new Ribbon(), tec = new Ribbon();
      const posts = [];
      for (let i = 0; i < M; i++) {
        if (tp[i] === 3 || tp[(i + 1) % M] === 3) continue;
        const s0 = i * STEP, s1 = s0 + STEP, i1 = (i + 1) % M;
        const d0 = side * B[i], d1 = side * B[i1];
        const g0 = pos(s0, d0, -0.3), g1 = pos(s1, d1, -0.3);
        const t0 = pos(s0, d0, 1.2), t1 = pos(s1, d1, 1.2);
        const soft = tp[i] >= 1;
        if (soft) {
          const o0 = pos(s0, d0 - side * 1.0, -0.3), o1 = pos(s1, d1 - side * 1.0, -0.3), q0 = pos(s0, d0 - side * 1.0, 1.0), q1 = pos(s1, d1 - side * 1.0, 1.0);
          tec.quad(o0, o1, q1, q0, [[s0 / 4, 0], [s1 / 4, 0], [s1 / 4, 1], [s0 / 4, 1]]);
          tec.quad(q0, q1, pos(s1, d1, 1.0), pos(s0, d0, 1.0), [[s0 / 4, 0], [s1 / 4, 0], [s1 / 4, 0.2], [s0 / 4, 0.2]]);
        }
        addWall(g0[0], g0[2], g0[1], g1[0], g1[2], g1[1], 4.5);
        const f = side > 0 ? [g0, g1, t1, t0] : [g1, g0, t0, t1];
        const us = side > 0 ? [[s0 / 24, 0], [s1 / 24, 0], [s1 / 24, 1], [s0 / 24, 1]] : [[-s1 / 24, 0], [-s0 / 24, 0], [-s0 / 24, 1], [-s1 / 24, 1]];
        wall.quad(...f, us);
        const h0 = pos(s0, d0 + side * 0.4, 1.2), h1 = pos(s1, d1 + side * 0.4, 1.2);
        top.quad(t0, t1, h1, h0);
        const b0 = pos(s0, d0 + side * 0.3, 1.2), b1 = pos(s1, d1 + side * 0.3, 1.2), u0 = pos(s0, d0 + side * 0.3, 4.2), u1 = pos(s1, d1 + side * 0.3, 4.2);
        fence.quad(b0, b1, u1, u0, [[s0 / 3, 0], [s1 / 3, 0], [s1 / 3, 1], [s0 / 3, 1]]);
        if (i % 3 === 0) posts.push(pos(s0, d0 + side * 0.35, 0));
      }
      const wm = new THREE.Mesh(wall.geo(), side > 0 ? mat.wall : mat.wall2); wm.receiveShadow = true; wm.castShadow = true; scene.add(wm);
      scene.add(new THREE.Mesh(top.geo(), mat.concrete));
      const tm = new THREE.Mesh(tec.geo(), mat.tecpro); tm.castShadow = true; scene.add(tm);
      scene.add(new THREE.Mesh(fence.geo(), mat.fence));
      const pg = new THREE.BoxGeometry(0.1, 4.4, 0.1); pg.translate(0, 2.1, 0);
      const inst = new THREE.InstancedMesh(pg, mat.post, posts.length);
      const m4 = new THREE.Matrix4();
      posts.forEach((p, k) => { m4.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(k, m4); });
      scene.add(inst);
    }
  }

  // ---------- terreno
  const bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  for (let i = 0; i < T.N; i += 10) { bb.x0 = Math.min(bb.x0, T.x[i]); bb.x1 = Math.max(bb.x1, T.x[i]); bb.z0 = Math.min(bb.z0, T.z[i]); bb.z1 = Math.max(bb.z1, T.z[i]); }
  const EXT = 1400;
  const ccx = (bb.x0 + bb.x1) / 2, ccz = (bb.z0 + bb.z1) / 2;
  const hills = (x, z) => {
    const r = Math.hypot(x - ccx, z - ccz);
    if (urban) {
      // la dársena del puerto, al sur de la recta de meta: el suelo baja bajo el agua
      const wz = bb.z0 - 230, sea = Math.min(1, Math.max(0, (wz + 10 - z) / 30));
      return 1.5 * Math.sin(x * 0.004 + z * 0.003) + Math.max(0, r - 1500) * 0.08 * (0.6 + 0.4 * Math.sin(Math.atan2(z - ccz, x - ccx) * 3)) * (1 - sea) - 14 * sea;
    }
    if (night) {
      // dunas: crestas largas y rizos
      const u = x * 0.8 + z * 0.6;
      return 9 * Math.pow(0.5 + 0.5 * Math.sin(u * 0.006 + Math.sin(z * 0.002) * 2), 2) + 4 * Math.sin(x * 0.011 - z * 0.007) + 1.2 * Math.sin(u * 0.05)
        + Math.max(0, r - 1300) * 0.05;
    }
    return 30 * (0.5 + 0.5 * Math.sin(x * 0.0024 + 1.3) * Math.cos(z * 0.0019 - 0.4)) + 16 * Math.sin(x * 0.0061 + z * 0.0043) + 5 * Math.sin(x * 0.019 - z * 0.014)
      + Math.max(0, r - 1250) * 0.11 * (0.7 + 0.3 * Math.sin(Math.atan2(z - ccz, x - ccx) * 5));
  };
  world.hills = hills;
  const groundY = (x, z) => {
    const n = nearest(x, z, 6);
    const ty = n.i >= 0 ? T.y[n.i] : 6;
    const t = Math.min(1, Math.max(0, (n.d - 60) / 360));
    const e = t * t * (3 - 2 * t);
    return (ty - 0.45) * (1 - e) + (hills(x, z) * e + 2 * e);
  };
  // lejos de la pista (más de ~240 m) la rejilla no llega: barrido grueso de todo el trazado
  world.trackDist = (x, z) => {
    const n = nearest(x, z, 6); if (n.i >= 0) return n.d;
    let b = 1e18; for (let i = 0; i < T.N; i += 8) { const dd = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2; if (dd < b) b = dd; }
    return Math.sqrt(b);
  };
  world.groundY = groundY;
  {
    const cs = quality === 'low' ? 16 : 10;
    const x0 = bb.x0 - EXT, x1 = bb.x1 + EXT, z0 = bb.z0 - EXT, z1 = bb.z1 + EXT;
    const nx = Math.ceil((x1 - x0) / cs), nz = Math.ceil((z1 - z0) / cs);
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = groundY(x, z);
      p.setY(i, y); uv.setXY(i, x / 40, z / 40);
      // cerca: césped; lejos: mosaico de campos de cultivo
      const dT = nearest(x, z, 5).d;
      const lush = [0.34, 0.5, 0.19];
      const fx = Math.floor((x + 40 * Math.sin(z / 230)) / 150), fz = Math.floor((z + 40 * Math.sin(x / 260)) / 110);
      const h = hash(fx * 17.3 + fz * 31.7);
      const FIELDS = [[0.42, 0.56, 0.22], [0.66, 0.6, 0.3], [0.36, 0.48, 0.18], [0.52, 0.42, 0.28], [0.5, 0.6, 0.26], [0.72, 0.66, 0.36], [0.3, 0.44, 0.17]];
      const f = FIELDS[Math.floor(h * FIELDS.length)];
      const w = Math.min(1, Math.max(0, (dT - 380) / 300));
      const edge = (Math.abs(((x + 40 * Math.sin(z / 230)) / 150) % 1) < 0.03 || Math.abs(((z + 40 * Math.sin(x / 260)) / 110) % 1) < 0.04) ? 0.82 : 1;
      const jit = 0.92 + 0.12 * hash(Math.floor(x / 23) * 3.1 + Math.floor(z / 23) * 7.7);
      if (urban) {
        // ciudad: aceras y plazas grises con parches; lejos, tejados y parques
        const park = hash(Math.floor(x / 180) * 5.3 + Math.floor(z / 180) * 9.1) < 0.12 && dT > 200;
        const base = park ? [0.36, 0.48, 0.24] : [0.55, 0.55, 0.53];
        for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.pow(base[k] * jit, 2.2) * 1.45;
      } else if (night) {
        // arena; iluminada cerca de la pista, a oscuras lejos (los focos no llegan)
        const lit = 0.18 + 0.82 * Math.exp(-Math.max(0, dT - 30) / 220);
        const sandC = [0.78, 0.62, 0.42];
        for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.pow(sandC[k] * jit * (0.9 + 0.1 * Math.sin(x * 0.05)), 2.2) * 1.45 * lit;
      } else
      for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.pow((lush[k] * (1 - w) + f[k] * w * (w > 0.5 ? edge : 1)) * jit * (y > 60 ? 0.9 : 1), 2.2) * 1.45;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat.terrain); m.receiveShadow = true; scene.add(m);
  }

  // ---------- interior de los garajes: luces de techo, pórtico con pantallas, bancos de trabajo, carros de herramientas,
  // estanterías con neumáticos en mantas, franjas del equipo en el suelo, panel con el nombre al fondo y mecánicos.
  // Todo instanciado por tipo de pieza (una llamada de dibujo para los 11 garajes)
  function garageDetail() {
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), vv = new THREE.Vector3(), ss = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const parts = [];   // { geo, mat, list: [[bs, u, w, y, sx, sy, sz, color|null, rotY]] }
    const part = (geo, mat) => { const p = { geo, mat, list: [] }; parts.push(p); return p; };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const light = part(unit, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.6 }));
    const steel = part(unit, new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.45, metalness: 0.6 }));
    const teamBox = part(unit, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.25 }));
    const screen = part(unit, new THREE.MeshStandardMaterial({ color: 0x06080c, emissive: 0x3a7bd5, emissiveIntensity: 0.55, roughness: 0.3 }));
    const top = part(unit, new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.35, metalness: 0.5 }));
    const stripe = part(unit, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    const tyreG = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 18);
    const blanket = part(tyreG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    const bodyG = new THREE.CapsuleGeometry(0.27, 0.9, 4, 8); bodyG.translate(0, 0.72, 0);
    const suit = part(bodyG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
    const headG = new THREE.SphereGeometry(0.15, 10, 8); headG.translate(0, 1.52, 0);
    const head = part(headG, new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 }));
    const tint = (hex, k) => col.set(hex).multiplyScalar(k).getHex();
    TEAMS.forEach((team, k) => {
      const bs = pit.boxes[k].s, c1 = team.c1, c2 = team.c2;
      // (u: a lo largo de la pista, desde el centro del garaje; w: profundidad desde la fachada -34 hacia el fondo -44)
      for (const u of [-5, 0, 5]) light.list.push([bs, u, 5, 4.72, 0.35, 0.08, 8.5]);
      // pórtico colgado con dos pantallas de telemetría mirando al coche
      steel.list.push([bs, 0, 2.2, 3.9, 12, 0.12, 0.12]);
      for (const u of [-3, 3]) screen.list.push([bs, u, 2.2, 3.45, 1.5, 0.85, 0.08]);
      // bancos de trabajo al fondo (color del equipo) con encimera, y carros de herramientas a los lados
      for (const u of [-5.2, 5.2]) { teamBox.list.push([bs, u, 9.2, 0.5, 4.2, 1.0, 1.1, c1]); top.list.push([bs, u, 9.2, 1.04, 4.3, 0.06, 1.2]); }
      for (const u of [-7.2, 7.2]) for (const w of [3.5, 6.2]) { teamBox.list.push([bs, u, w, 0.55, 0.8, 1.1, 1.3, c2 === '#FFFFFF' ? tint(c1, 0.8) : c2]); top.list.push([bs, u, w, 1.13, 0.85, 0.05, 1.35]); }
      // estantería con neumáticos en mantas (color del equipo)
      steel.list.push([bs, 0, 9.6, 1.6, 3.4, 0.06, 0.7]); steel.list.push([bs, 0, 9.6, 0.02, 3.4, 0.06, 0.7]);
      for (let st = 0; st < 4; st++) for (let h = 0; h < 3; h++) blanket.list.push([bs, -1.2 + st * 0.8, 9.6, 0.25 + h * 0.36 + (h > 1 ? 0.25 : 0), 1, 1, 1, h === 2 ? tint(c1, 0.9) : 0x161618]);
      // franjas del equipo en el suelo: el contorno de cada puesto
      for (const u0 of [-4.5, 4.5]) {
        for (const du of [-1.4, 1.4]) stripe.list.push([bs, u0 + du, 5.8, 0.045, 0.12, 0.02, 7.2, c1]);
        stripe.list.push([bs, u0, 9.4 - 0.05, 0.045, 2.9, 0.02, 0.12, c1]);
      }
      // paredes laterales: zócalo oscuro y franja del equipo
      for (const u of [-7.94, 7.94]) { steel.list.push([bs, u, 5, 0.45, 0.04, 0.9, 10]); stripe.list.push([bs, u, 5, 1.6, 0.05, 0.35, 10, c1]); stripe.list.push([bs, u, 5, 1.85, 0.05, 0.08, 10, c2]); }
      // mecánicos esperando (dos por puesto)
      for (const [u, w, r] of [[-6.4, 1.8, 0.4], [-2.4, 6.5, -1.2], [2.6, 7.2, 2.2], [6.3, 2.4, -0.6]]) { suit.list.push([bs, u, w, 0, 1, 1, 1, c1, r]); head.list.push([bs, u, w, 0, 1, 1, 1, null, r]); }
      // panel con el nombre del equipo al fondo
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const g = cv.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 512, 0); grd.addColorStop(0, c1); grd.addColorStop(1, '#101114');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 128); g.fillStyle = c2; g.fillRect(0, 118, 512, 10);
      g.fillStyle = '#fff'; g.font = '900 72px "Titillium Web", Arial'; g.textAlign = 'center'; g.fillText(team.name.toUpperCase(), 256, 86, 480);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.35, roughness: 0.6 }));
      const i = T.idx(bs), yaw = Math.atan2(T.tx[i], T.tz[i]);
      panel.position.set(...pos(bs, -43.93, 3.3)); panel.rotation.y = yaw + Math.PI / 2; scene.add(panel);
    });
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, p.list.length);
      p.list.forEach(([bs, u, w, y, sx, sy, sz, c, r = 0], n) => {
        const P3 = pos(bs + u, -34 - w, y);
        const i = T.idx(bs + u), yaw = Math.atan2(T.tx[i], T.tz[i]);
        qq.setFromAxisAngle(up, yaw + Math.PI / 2 + r);   // x local: a lo largo de la pista; z: hacia el fondo
        m4.compose(vv.set(P3[0], T.y[T.idx(bs)] + y + (p.geo === unit ? 0 : 0.02), P3[2]), qq, ss.set(sx, sy, sz));
        im.setMatrixAt(n, m4);
        if (c != null) im.setColorAt(n, col.set(c)); else if (im.instanceColor || p.list.some((x) => x[7] != null)) im.setColorAt(n, col.set(0xffffff));
      });
      im.castShadow = p.geo !== unit || p.mat !== light.mat; im.receiveShadow = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.userData.noOcclude = true; scene.add(im);
    }
  }

  // ---------- pit lane, muro, garajes
  const teamBoxes = [];
  {
    const A = T.wrap(pit.entryA - 20), len = T.ahead(A, T.wrap(pit.exitB + 30));
    // asfalto del pit: en las rampas solo el carril (con su arcén); entre medias, hasta los garajes
    const sm = (f) => { f = Math.min(1, Math.max(0, f)); return f * f * (3 - 2 * f); };
    const garW = (s) => sm(Math.min(T.ahead(pit.entryB, s) / 45, T.ahead(s, pit.exitA) / 45) * (between(T, s, pit.entryB, pit.exitA) ? 1 : 0));
    const outer = (s) => { const l = Math.max(-34, laneC(s) - PH - 1.4); return l + (-34 - l) * garW(s); };
    along(A, len, outer, -HW - 0.1, -0.01, mat.asphalt, 9, 9);
    // fuera del carril en las rampas: hierba/arena (en la ciudad, acera)
    along(A, len, -33.6, (s) => Math.min(-HW - 0.2, outer(s) + 0.05), -0.012, urban ? mat.verge : mat.grass, 6, 6);
    // líneas del carril: continuas fuera de la pista, discontinuas donde se incorpora o sale de ella
    const inner = (s) => laneC(s) + PH;
    const outerL = (s) => laneC(s) - PH;
    stripe(dashIn[0], T.ahead(dashIn[0], sepIn), inner, 0.25, 3, 3);
    stripe(sepIn, T.ahead(sepIn, sepOut), inner, 0.3);
    stripe(sepOut, T.ahead(sepOut, dashOut[1]), inner, 0.25, 3, 3);
    stripe(T.wrap(pit.entryA - 30), T.ahead(T.wrap(pit.entryA - 30), T.wrap(pit.exitB + 30)), outerL, 0.3);
    // líneas transversales del límite de velocidad y del final del carril
    for (const ls of [pit.limitA, pit.limitB]) {
      const rows = [];
      for (let k = 0; k <= 6; k++) { const d = laneC(ls) - PH - 4 + (2 * PH + 4) * k / 6; rows.push([[...pos(ls - 0.3, d, 0.013), 0, 0], [...pos(ls + 0.3, d, 0.013), 1, 0]]); }
      paint.strip(rows);
    }
    // zona cebreada entre la pista y el carril hasta el morro del muro
    const hatchM = new THREE.MeshStandardMaterial({ map: TX.hatch(), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const wA0 = T.wrap(pit.entryB + 20), wB0 = T.wrap(pit.exitA - 20);
    along(sepIn, T.ahead(sepIn, wA0), (s) => Math.min(-HW - 0.2, inner(s) + 0.2), -HW - 0.1, 0.008, hatchM, 3, 3, false, 1);
    along(wB0, T.ahead(wB0, sepOut), (s) => Math.min(-HW - 0.2, inner(s) + 0.2), -HW - 0.1, 0.008, hatchM, 3, 3, false, 1);
    // textos en el suelo
    const word = (s, d, text, w, l) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshStandardMaterial({ map: TX.roadText(text), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.geometry.rotateX(-Math.PI / 2);
      const i = T.idx(s); m.position.set(...pos(s, d, 0.014)); m.rotation.y = Math.atan2(-T.tx[i], -T.tz[i]); scene.add(m);
    };
    word(T.wrap(pit.entryA - 60), pit.edgeD, 'PIT', 4.6, 9);
    word(T.wrap(pit.limitA + 12), pit.fastD, '80', 4.6, 9);
    word(T.wrap(pit.limitB - 12), pit.fastD, 'END', 4.6, 9);
    word(T.wrap(pit.exitB - 40), pit.laneD(T.wrap(pit.exitB - 40)), 'EXIT', 4.6, 9);
    // atenuadores amarillos y negros en los morros del muro
    const chevM = new THREE.MeshStandardMaterial({ map: TX.chevrons(), roughness: 0.6 });
    for (const [ws, dir] of [[wA0, 1], [wB0, -1]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 5), chevM);
      const i = T.idx(ws - dir * 2.5); b.position.set(...pos(ws - dir * 2.5, pit.wallD, 0.55)); b.rotation.y = Math.atan2(T.tx[i], T.tz[i]);
      b.castShadow = true; scene.add(b);
    }
    // semáforo de salida del pit (verde)
    {
      const ls = T.wrap(pit.limitB + 6), d = laneC(ls) - PH - 1.2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), mat.post); post.position.set(...pos(ls, d, 1.6)); scene.add(post);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5 }));
      head.position.set(...pos(ls, d, 3.4)); head.rotation.y = Math.atan2(T.tx[T.idx(ls)], T.tz[T.idx(ls)]); scene.add(head);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x3dff6a }));
      lamp.position.set(...pos(ls - 0.26, d, 3.1)); lamp.rotation.y = Math.atan2(-T.tx[T.idx(ls)], -T.tz[T.idx(ls)]); scene.add(lamp);
    }
    // muro del pit (con huecos en las rampas)
    const wA = T.wrap(pit.entryB + 20), wLen = T.ahead(wA, pit.exitA - 20);
    along(wA, wLen, pit.wallD - 0.4, pit.wallD - 0.4, (s, e) => (e ? 1.2 : -0.2), mat.concrete, 1, 8);
    along(wA, wLen, pit.wallD + 0.4, pit.wallD + 0.4, (s, e) => (e ? -0.2 : 1.2), mat.wall, 1, 24);
    along(wA, wLen, pit.wallD - 0.4, pit.wallD + 0.4, 1.2, mat.concrete, 1, 8);
    along(wA, wLen, pit.wallD, pit.wallD, (s, e) => (e ? 4.5 : 1.2), mat.fence, 1, 3);
    for (let q = 0; q < wLen; q += 2) { const a = pos(wA + q, pit.wallD, -0.2), b = pos(wA + q + 2, pit.wallD, -0.2); addWall(a[0], a[2], a[1], b[0], b[2], b[1], 4.8); }
    // edificio de boxes
    const bA = T.wrap(pit.boxes[0].s - 40), bLen = T.ahead(bA, T.wrap(pit.boxes[pit.boxes.length - 1].s + 40));
    const facade = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
    const glassM = new THREE.MeshStandardMaterial({ map: TX.glass(), metalness: 0.6, roughness: 0.15 });
    glassM.map.repeat.set(1, 1);
    along(bA, bLen, -34, -34, (s, e) => (e ? 5.5 : 0), facade, 1, 6);
    along(bA, bLen, -34.5, -34.5, (s, e) => (e ? 12 : 5.5), glassM, 1, 16);
    along(bA, bLen, -52, -33, 12, new THREE.MeshStandardMaterial({ map: TX.roofTex(), roughness: 0.7, side: THREE.DoubleSide }), 8, 8);
    along(bA, bLen, -52, -52, (s, e) => (e ? 12 : 0), new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.8, side: THREE.DoubleSide }), 1, 12);
    along(bA, bLen, -33, -33, (s, e) => (e ? 12.6 : 12), mat.wall, 1, 24);
    along(bA, bLen, -52, -52, (s, e) => (e ? 0 : 12), new THREE.MeshStandardMaterial({ map: TX.buildingTex(2), roughness: 0.8 }), 1, 20);
    // suelo de todo el edificio
    along(bA, bLen, -52, -34, 0.02, new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.8 }), 10, 10);
    // garajes con color de equipo
    TEAMS.forEach((team, k) => {
      const bs = pit.boxes[k].s;
      const inner = new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.7 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.9 });
      along(bs - 9, 18, -33.9, -33.9, (s, e) => (e ? 4.8 : 0.02), dark, 1, 18); // hueco (fondo oscuro)
      along(bs - 8, 16, -44, -44, (s, e) => (e ? 0 : 4.8), inner, 1, 16);
      along(bs - 8, 16, -44, -34, 0.03, new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.5, metalness: 0.2 }), 10, 16);
      // paredes laterales, techo y fondo del edificio tras el garaje
      // (perpendiculares a la fachada: antes estaban giradas 90° y quedaban como un muro blanco en medio del garaje)
      const wallIn = new THREE.MeshStandardMaterial({ color: 0xb9bfc7, roughness: 0.75, side: THREE.DoubleSide });
      for (const e of [-8, 8]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.8), wallIn);
        const p = pos(bs + e, -39, 2.4); w.position.set(...p); w.rotation.y = Math.atan2(T.tx[T.idx(bs + e)], T.tz[T.idx(bs + e)]); scene.add(w);
      }
      along(bs - 8, 16, -44, -34, 4.8, new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.12 }), 10, 16);
      // marcas del box en el suelo
      const boxMat = new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 });
      along(bs - 4, 8, pit.d - 5, pit.d - 2, 0.015, boxMat, 1, 8);
      // cartel con el nombre
      const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
      g.fillStyle = team.c1; g.fillRect(0, 0, 512, 96); g.fillStyle = team.c2; g.fillRect(0, 84, 512, 12);
      g.fillStyle = '#fff'; g.font = '900 56px "Titillium Web", Arial'; g.textAlign = 'center'; g.fillText(team.short, 256, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      along(bs - 7, 14, -33.8, -33.8, (s, e) => (e ? 5.3 : 4.9), new THREE.MeshBasicMaterial({ map: t }), 1, 14);
      // puesto en el muro del pit
      // puesto del muro: plataforma con pantallas y tejadillo del color del equipo
      const stand = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 1.6), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 })); deck.position.y = 0.45; stand.add(deck);
      const scr = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 0.12), new THREE.MeshStandardMaterial({ color: 0x0b0d12, emissive: 0x2a6fdb, emissiveIntensity: 0.35 })); scr.position.set(0, 1.35, 0.35); stand.add(scr);
      const roofS = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.12, 2.0), new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.5 })); roofS.position.set(0, 2.5, 0.1); stand.add(roofS);
      for (const x of [-2.2, 2.2]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), mat.post); pole.position.set(x, 1.7, -0.6); stand.add(pole); }
      const sp = pos(bs, pit.wallD - 1.3, 0); stand.position.set(...sp); stand.rotation.y = Math.atan2(T.tx[T.idx(bs)], T.tz[T.idx(bs)]) + Math.PI / 2;
      stand.traverse((o) => { o.castShadow = true; }); scene.add(stand);
      teamBoxes.push({ s: bs, team });
    });
    garageDetail();
    { const pm = new THREE.Mesh(paint.geo(), mat.white); pm.receiveShadow = true; scene.add(pm); }
    // torre de control
    const tp = pos(T.wrap(pit.boxes[pit.boxes.length - 1].s + 70), -44, 0);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 34, 16), new THREE.MeshStandardMaterial({ map: TX.buildingTex(1), roughness: 0.6 }));
    tower.position.set(tp[0], tp[1] + 17, tp[2]); tower.castShadow = true; scene.add(tower);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 6, 16), glassM); top.position.set(tp[0], tp[1] + 37, tp[2]); scene.add(top);
  }

  // ---------- equipos de mecánicos (se muestran en las paradas)
  {
    const bodyG = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8); bodyG.translate(0, 0.75, 0);
    const headG = new THREE.SphereGeometry(0.17, 10, 8); headG.translate(0, 1.55, 0);
    TEAMS.forEach((team, k) => {
      const grp = new THREE.Group();
      const suit = new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.7 });
      const hel = new THREE.MeshStandardMaterial({ color: team.c2, roughness: 0.4 });
      const spots = [[1.3, 1.8], [-1.3, 1.8], [1.3, -1.8], [-1.3, -1.8], [1.9, 1.8], [-1.9, 1.8], [1.9, -1.8], [-1.9, -1.8], [0, 3.6], [0, -3.4], [1.2, 0.2], [-1.2, 0.2], [2.4, 0.6], [-2.4, -0.6]];
      const men = [];
      for (const [x, z] of spots) {
        const m = new THREE.Group();
        const b = new THREE.Mesh(bodyG, suit); b.castShadow = true; m.add(b); m.add(new THREE.Mesh(headG, hel));
        m.userData.base = [x, z]; grp.add(m); men.push(m);
      }
      grp.visible = false; scene.add(grp);
      world.crews.push({ grp, men, s: T.pit.boxes[k].s });
    });
  }

  // ---------- pórtico de salida con semáforo
  const gantryPosts = [];
  {
    const s = 6;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5, metalness: 0.4 });
    const pL = pos(s, HW + 2.5), pR = pos(s, -HW - 2.5);
    for (const p of [pL, pR]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), dark); c.position.set(p[0], p[1] + 4.5, p[2]); c.castShadow = true; scene.add(c); gantryPosts.push(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 5, 1.6, 0.9), dark);
    world.overheads.push({ s, h0: 5.4, h1: 10.2, w: HW + 3, len: 1.4 });
    const mid = pos(s, 0, 8.2); beam.position.set(...mid);
    const yaw = Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]); beam.rotation.y = yaw; beam.castShadow = true; scene.add(beam);
    // banner
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#e10600'; g.fillRect(0, 0, 1024, 128); g.fillStyle = '#fff'; g.font = '900 84px "Titillium Web", Arial'; g.textAlign = 'center'; g.fillText('NEURAL GRAND PRIX', 512, 94);
    const bt = new THREE.CanvasTexture(c); bt.colorSpace = THREE.SRGBColorSpace;
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW + 4, 1.5), new THREE.MeshBasicMaterial({ map: bt }));
    ban.position.set(...pos(s - 0.5, 0, 9.3)); ban.rotation.y = yaw + Math.PI; scene.add(ban);
    // 5 columnas de luces mirando a la parrilla
    const lampOff = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
    for (let k = 0; k < 5; k++) {
      const pod = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.4), dark); pod.add(back);
      const lamps = [];
      for (let j = 0; j < 4; j++) {
        const lm = lampOff.clone();
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), lm); lamp.position.set(0, 0.62 - j * 0.42, -0.21); lamp.rotation.y = Math.PI;
        pod.add(lamp); lamps.push(lm);
      }
      const d = (k - 2) * 1.4;
      pod.position.set(...pos(s - 0.6, d, 6.6)); pod.rotation.y = yaw;
      scene.add(pod); world.lights.push(lamps);
    }
  }

  // ---------- gradas
  const stands = [];
  const grandstand = (s0, len, side, rows = 18, roof = true, seed = 1) => {
    const B = (s) => world.barrier(s, side) + 6;
    const seatMat = new THREE.MeshStandardMaterial({ map: TX.crowd(seed), roughness: 0.9 });
    seatMat.map.repeat.set(len / 40, 1);
    const depth = rows * 0.85, H = rows * 0.5;
    const d0 = (s) => side * B(s), d1 = (s) => side * (B(s) + depth);
    const baseY = 1.5;
    // asientos inclinados
    const r = new Ribbon(); const rs = [];
    const n = Math.ceil(len / 4);
    for (let k = 0; k <= n; k++) {
      const s = s0 + (len * k) / n;
      const a = pos(s, d0(s), baseY), b = pos(s, d1(s), baseY + H);
      rs.push(side > 0 ? [[...a, (s - s0) / len * (len / 40), 0], [...b, (s - s0) / len * (len / 40), 1]] : [[...b, (s - s0) / len * (len / 40), 1], [...a, (s - s0) / len * (len / 40), 0]]);
    }
    r.strip(rs); const sm = new THREE.Mesh(r.geo(), seatMat); sm.receiveShadow = true; scene.add(sm);
    const struct = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.7 });
    along(s0, len, d0, d0, (s, e) => (e ? baseY : -0.5), struct, 1, 10);
    along(s0, len, d1, d1, (s, e) => (e ? -0.5 : baseY + H + 0.6), struct, 1, 10);
    if (roof) {
      const rr = new THREE.MeshStandardMaterial({ map: TX.roofTex(), roughness: 0.6, side: THREE.DoubleSide });
      along(s0, len, (s) => side * (B(s) - 2), (s) => side * (B(s) + depth + 0.5), (s, e) => (baseY + H + 5.5) - (e ? 0 : 1.2) * (side > 0 ? 1 : -1) * 0 + (e ? 0.8 : -0.4), rr, 8, 8);
      const cg = new THREE.CylinderGeometry(0.18, 0.18, 1, 8); cg.translate(0, 0.5, 0);
      const cols = []; for (let s = s0; s <= s0 + len; s += 12) cols.push(s);
      const inst = new THREE.InstancedMesh(cg, struct, cols.length);
      const m4 = new THREE.Matrix4();
      cols.forEach((s, k) => { const p = pos(s, side * (B(s) + depth + 0.3), -0.5); m4.compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(1, baseY + H + 6.5, 1)); inst.setMatrixAt(k, m4); });
      inst.castShadow = true; scene.add(inst);
    }
    stands.push({ s0, len, side, depth, h: 1.5 + H + (roof ? 6.5 : 1) });
  };
  grandstand(T.wrap(-300), 560, 1, 22, true, 1);           // tribuna principal frente a boxes
  const cT = (i) => T.corners[i % T.corners.length];
  grandstand(T.wrap(cT(0).sIn - 120), 260, -Math.sign(cT(0).dir) || 1, 16, true, 2);
  grandstand(T.wrap(cT(4).sIn - 80), 200, -Math.sign(cT(4).dir) || 1, 14, true, 3);
  grandstand(T.wrap(cT(7).sIn - 150), 240, -Math.sign(cT(7).dir) || 1, 16, false, 4);
  grandstand(T.wrap(cT(11).sIn - 60), 260, -Math.sign(cT(11).dir) || 1, 16, true, 5);
  grandstand(T.wrap(cT(1).sIn - 60), 140, -Math.sign(cT(1).dir) || 1, 12, false, 6);

  // ---------- pantallas gigantes
  const screen = (s, side, w = 16) => {
    const scr = TX.screenTex('NEURAL GP');
    const off = world.barrier(s, side) + 26;
    const p = pos(s, side * off, 0);
    const yaw = Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]);
    const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); g.rotation.y = yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + 0.5 * side;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false }));
    panel.position.y = 9 + w / 4; g.add(panel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, w / 2 + 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x15171a }));
    frame.position.set(0, 9 + w / 4, -0.3); g.add(frame);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a3d42 })); leg.position.y = 4.5; g.add(leg);
    scene.add(g); world.screens.push(scr);
  };
  screen(T.wrap(-150), 1); screen(T.wrap(cT(0).apex), -Math.sign(cT(0).dir) || 1); screen(T.wrap(cT(7).sIn - 60), -Math.sign(cT(7).dir) || 1);

  // ---------- puestos de comisarios con panel luminoso
  {
    const hut = new THREE.BoxGeometry(2.2, 2.4, 2.2); hut.translate(0, 1.2, 0);
    const hutMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0xff6d00, roughness: 0.6 });
    for (let s = 120; s < T.L; s += 380) {
      const side = hash(s) < 0.5 ? 1 : -1;
      if (between(T, s, T.wrap(pit.entryA - 40), T.wrap(pit.exitB + 40)) && side < 0) continue;
      const p = pos(s, side * (world.barrier(s, side) + 2.5), -0.3);
      const h = new THREE.Mesh(hut, hutMat); h.position.set(...p); h.castShadow = true; scene.add(h);
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 2.6), roofM); r.position.set(p[0], p[1] + 2.5, p[2]); scene.add(r);
      const lm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00ff55, emissiveIntensity: 0.0, toneMapped: false });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), lm);
      const yaw = Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]);
      panel.position.set(p[0], p[1] + 3.3, p[2]); panel.rotation.y = yaw + Math.PI + (side > 0 ? -0.8 : 0.8); scene.add(panel);
      world.marshal.push({ s, mat: lm });
    }
  }

  // ---------- carteles de distancia y DRS
  {
    const boardTex = (txt, bg = '#ffffff', fg = '#111111') => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 128, 128); g.fillStyle = fg; g.font = '900 64px "Titillium Web", Arial'; g.textAlign = 'center'; g.fillText(txt, 64, 86); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const heavy = T.corners.filter((c) => c.radius < 60);
    for (const c of heavy) {
      const side = -(Math.sign(c.dir) || 1);
      for (const dist of [100, 200, 300]) {
        const s = T.wrap(c.sIn - dist + 40);
        const p = pos(s, side * (HW + 4), 0);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ map: boardTex(String(dist)) }));
        b.position.set(p[0], p[1] + 1.4, p[2]); b.rotation.y = Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]) + Math.PI; scene.add(b);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), mat.post); pole.position.set(p[0], p[1] + 0.4, p[2]); scene.add(pole);
      }
    }
    for (const z of T.drs) {
      const p = pos(z.a, HW + 3, 0);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: boardTex('DRS', '#111111', '#ffffff') }));
      b.position.set(p[0], p[1] + 2, p[2]); b.rotation.y = Math.atan2(T.tx[T.idx(z.a)], T.tz[T.idx(z.a)]) + Math.PI; scene.add(b);
      along(T.wrap(z.detect), 0.4, -HW, HW, 0.013, mat.white, 1, 1, true, 1);
    }
  }

  // ---------- puente publicitario
  {
    const s = T.wrap(T.drs[1] ? (T.drs[1].a + T.ahead(T.drs[1].a, T.drs[1].b) * 0.4) : 2000);
    const yaw = Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]);
    const dark = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.5 });
    for (const side of [1, -1]) { const p = pos(s, side * (HW + 5), 0); const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 3), dark); c.position.set(p[0], p[1] + 5, p[2]); c.rotation.y = yaw; c.castShadow = true; scene.add(c); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 12, 3, 3.5), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: TX.sponsorBoard(21, 96) }), new THREE.MeshBasicMaterial({ map: TX.sponsorBoard(22, 96) })]);
    bridge.material[4].map.repeat.set(0.35, 1); bridge.material[5].map.repeat.set(0.35, 1);
    bridge.position.set(...pos(s, 0, 11.5)); bridge.rotation.y = yaw; bridge.castShadow = true; scene.add(bridge);
    world.overheads.push({ s, h0: 9.6, h1: 13.4, w: HW + 7, len: 2.2 });
  }

  // ---------- cielo, sol, niebla
  const sky = new Sky(); sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.2; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.0035; su.mieDirectionalG.value = 0.86;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(215));
  su.sunPosition.value.copy(sunDir);
  const pm = new THREE.PMREMGenerator(renderer);
  let sun;
  if (night) {
    // noche con focos: luz blanca casi cenital que sigue a la cámara (la pista siempre bien iluminada),
    // cielo casi negro y reflejos de focos en la carrocería
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(150));
    scene.fog = new THREE.Fog(0x070a14, 900, 5200);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8), new THREE.MeshBasicMaterial({ color: 0x0a0f1e, side: THREE.BackSide })));
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; const b = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 1), lampM); b.position.set(Math.cos(a) * 70, 38 + (k % 3) * 8, Math.sin(a) * 70); b.lookAt(0, 0, 0); envScene.add(b); }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x2a2620 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -10; envScene.add(floor);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.8;
    world.hemi = new THREE.HemisphereLight(0xaab8ff, 0x3b3226, 0.95); scene.add(world.hemi);
    sun = new THREE.DirectionalLight(0xf4f6ff, 3.1);
  } else {
    scene.fog = new THREE.Fog(0xaec8de, 1100, 6500);
    const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); envScene.add(sky2);
    Object.assign(sky2.material.uniforms.sunPosition.value, sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
    scene.environment = pm.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = 0.55;
    const hemi = world.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a6b3d, 0.45); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  }
  sun.castShadow = true;
  const smap = quality === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(smap, smap);
  const S = 70; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 700 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  world.sun = sun; world.sunDir = sunDir;

  // ---------- actualización por frame
  let scrT = 0;
  // ¿se ve el punto b desde la cámara a? (terreno, muros+vallas, gradas, edificio de boxes, muro del pit)
  // muro/valla: cruce exacto del rayo con los segmentos en planta, comparando alturas
  const seen = new Set();
  const wallBlocks = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), n = Math.ceil(L / 4);
    seen.clear();
    for (let k = 0; k <= n; k++) {
      const x = a.x + dx * k / n, z = a.z + dz * k / n;
      const lst = wallGrid.get(Math.floor(x / WC) * 100003 + Math.floor(z / WC)); if (!lst) continue;
      for (const sg of lst) {
        if (seen.has(sg)) continue; seen.add(sg);
        const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((sg.ax - a.x) * ez - (sg.az - a.z) * ex) / den, u = ((sg.ax - a.x) * dz - (sg.az - a.z) * dx) / den;
        if (t <= 0 || t >= 1 || u < 0 || u > 1 || (1 - t) * L < 2.5) continue;
        const y = a.y + (b.y - a.y) * t, base = sg.ay + (sg.by - sg.ay) * u;
        if (y < base + sg.top) return true;
      }
    }
    return false;
  };
  // cajas que tapan (edificios, copas de árboles): rejilla y prueba de rayo contra caja orientada
  const boxGrid = new Map();
  world.addOccluder = (x, z, hw, hd, yaw, y0, y1) => {
    const bx = { x, z, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw), y0, y1 }, R = Math.hypot(hw, hd);
    for (let cx = Math.floor((x - R) / WC); cx <= Math.floor((x + R) / WC); cx++) for (let cz = Math.floor((z - R) / WC); cz <= Math.floor((z + R) / WC); cz++) {
      const k = cx * 100003 + cz; let l = boxGrid.get(k); if (!l) boxGrid.set(k, l = []); l.push(bx);
    }
  };
  for (const p of gantryPosts) world.addOccluder(p[0], p[2], 0.5, 0.5, 0, p[1] - 1, p[1] + 9);
  // todo lo alto y estrecho que haya en la escena cerca de la pista (postes, palmeras, torres, mástiles…) tapa también:
  // así ninguna pieza de decorado queda fuera por olvido (una cámara de pista enfocaba un poste)
  world.autoOccluders = (root) => {
    const bb = new THREE.Box3(), m = new THREE.Matrix4(), bw = new THREE.Box3();
    let n = 0;
    const take = (box) => {
      const w = box.max.x - box.min.x, d = box.max.z - box.min.z, h = box.max.y - box.min.y;
      if (w > 14 || d > 14 || w <= 0 || d <= 0) return;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const gy = groundY(cx, cz);
      if (!(h >= 2.5 || box.min.y - gy > 2.2) || box.max.y < gy + 1) return;
      const nr = nearest(cx, cz, 4); if (nr.i < 0 || nr.d > 130) return;   // lejos de la pista: no hace falta
      world.addOccluder(cx, cz, w / 2, d / 2, 0, box.min.y, box.max.y); n++;
    };
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.noOcclude || !o.geometry) return;
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      if (o.isInstancedMesh) {
        for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); m.premultiply(o.matrixWorld); take(bw.copy(g.boundingBox).applyMatrix4(m)); }
      } else take(bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return n;
  };
  const boxBlocks = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), n = Math.ceil(L / 4), tEnd = 1 - 2.5 / Math.max(L, 3);
    seen.clear();
    for (let k = 0; k <= n; k++) {
      const lst = boxGrid.get(Math.floor((a.x + dx * k / n) / WC) * 100003 + Math.floor((a.z + dz * k / n) / WC)); if (!lst) continue;
      for (const bx of lst) {
        if (seen.has(bx)) continue; seen.add(bx);
        // rayo en coordenadas de la caja
        const ox = a.x - bx.x, oz = a.z - bx.z;
        const px = ox * bx.c - oz * bx.s, pz = ox * bx.s + oz * bx.c, vx = dx * bx.c - dz * bx.s, vz = dx * bx.s + dz * bx.c;
        let t0 = 0, t1 = tEnd;
        for (const [p, v, h] of [[px, vx, bx.hw], [pz, vz, bx.hd]]) {
          if (Math.abs(v) < 1e-9) { if (Math.abs(p) > h) { t0 = 2; break; } continue; }
          let ta = (-h - p) / v, tb = (h - p) / v; if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        }
        if (t0 >= t1) continue;
        const ya = a.y + (b.y - a.y) * t0, yb = a.y + (b.y - a.y) * t1;
        if (Math.min(ya, yb) < bx.y1 && Math.max(ya, yb) > bx.y0) return true;
      }
    }
    return false;
  };
  world.losBlocked = (a, b) => {
    if (wallBlocks(a, b) || boxBlocks(a, b)) return true;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz); const n = Math.ceil(len / 2.5);
    for (let k = 1; k < n; k++) {
      const f = k / n; const x = a.x + dx * f, y = a.y + dy * f, z = a.z + dz * f;
      if (Math.hypot(x - b.x, z - b.z) < 3) break;               // el propio coche
      const nr = nearest(x, z, 2); if (nr.i < 0) continue;
      const i = nr.i, s = i * T.ds;
      const d = (x - T.x[i]) * T.lx[i] + (z - T.z[i]) * T.lz[i];
      const gy = T.y[i];
      const h = y - gy;
      if (Math.abs(d) > HW + 1) {
        const side = d > 0 ? 1 : -1, B = world.barrier(s, side), ad = Math.abs(d);
        const pitZone = side < 0 && B >= 33.9;
        if (pitZone && d < -33 && d > -52 && h < 12.8) return true;                 // edificio de boxes
        for (const st of stands) if (st.side === side && between(T, s, st.s0, T.wrap(st.s0 + st.len)) && ad > B + 5 && ad < B + 7 + st.depth && h < st.h) return true;
      }
      for (const o of world.overheads) if (Math.abs(T.rel(o.s, s)) < o.len + 1.3 && Math.abs(d) < o.w && h > o.h0 && h < o.h1) return true; // puente y pórtico
      if (nr.d > 60 && y < groundY(x, z) + 0.5) return true;          // colinas
      if (nr.d <= 60 && h < 0.15) return true;                         // cresta de la propia pista o terraplén
    }
    return false;
  };

  world.update = (dt, sim, focus, camPos) => {
    // la sombra sigue a la cámara
    const c = focus || camPos;
    sun.position.set(c.x + sunDir.x * 300, c.y + sunDir.y * 300, c.z + sunDir.z * 300);
    sun.target.position.copy(c);
    if (world.ferris) world.ferris.rotation.z += dt * 0.03;
    // semáforo
    const lit = sim.session?.id === 'RACE' && sim.session.phase === 'lights' ? sim.lights : 0;
    world.lights.forEach((lamps, k) => lamps.forEach((m, j) => { const on = k < lit && j >= 2; m.emissive.setHex(on ? 0xff0000 : 0x000000); m.emissiveIntensity = on ? 4 : 0; }));
    // paneles de comisarios
    const flag = sim.flag;
    for (const m of world.marshal) {
      let col = 0x000000, it = 0;
      if (flag === 'VSC') { col = 0xffc400; it = (Math.floor(performance.now() / 400) % 2) ? 2.2 : 0.4; }
      else {
        for (const car of sim.cars) if ((car.mistake || (car.retired && !car.parked)) && !car.out && Math.abs(T.rel(m.s, car.s)) < 350 && T.rel(m.s, car.s) > -60) { col = 0xffc400; it = 2.2; }
      }
      m.mat.emissive.setHex(col); m.mat.emissiveIntensity = it;
    }
    // mecánicos
    for (const crew of world.crews) {
      const car = sim.cars.find((cc) => cc.inPit && (cc.pitPhase === 'stop' || (cc.pitPhase === 'in' && T.ahead(cc.s, crew.s) < 120)) && T.pit.boxes[TEAMS.indexOf(cc.team)].s === crew.s);
      crew.grp.visible = !!car && sim.session?.id === 'RACE';
      if (crew.grp.visible) {
        const tt = performance.now() / 1000;
        crew.men.forEach((m, k) => {
          const [x, z] = m.userData.base; const busy = car.pitPhase === 'stop';
          const p = pos(crew.s + z, T.pit.d - 3.5 + x * (busy ? 0.85 : 1.6), 0);
          m.position.set(p[0], p[1] + (busy ? -0.35 + Math.abs(Math.sin(tt * 6 + k)) * 0.05 : 0), p[2]);
          m.rotation.y = Math.atan2(T.tx[T.idx(crew.s)], T.tz[T.idx(crew.s)]) + (x > 0 ? -Math.PI / 2 : Math.PI / 2);
        });
      }
    }
    // pantallas: clasificación en directo
    scrT -= dt;
    if (scrT <= 0) {
      scrT = 1.5;
      const order = sim.session?.id === 'RACE' ? sim.raceOrder || sim.cars : sim.classification?.() || sim.cars;
      for (const scr of world.screens) {
        const g = scr.ctx; g.fillStyle = '#0b0c10'; g.fillRect(0, 0, 1024, 512);
        g.fillStyle = '#e10600'; g.fillRect(0, 0, 1024, 70);
        g.fillStyle = '#fff'; g.font = '900 48px "Titillium Web", Arial'; g.textAlign = 'left';
        g.fillText(sim.session ? (sim.session.id === 'RACE' ? `VUELTA ${Math.max(1, Math.min(sim.raceLaps, (order[0]?.lap ?? 0) + 1))}/${sim.raceLaps}` : sim.session.label) : 'NEURAL GP', 24, 52);
        order.slice(0, 6).forEach((car, k) => {
          const y = 120 + k * 64;
          g.fillStyle = car.team.c1; g.fillRect(24, y - 44, 10, 54);
          g.fillStyle = '#fff'; g.font = '700 46px "Titillium Web", Arial'; g.fillText(`${k + 1}`, 50, y);
          g.font = '900 46px "Titillium Web", Arial'; g.fillText(car.code, 120, y);
          g.font = '600 40px "Titillium Web", Arial'; g.fillStyle = '#c8c8c8';
          g.fillText(car.drv.last.toUpperCase(), 260, y);
        });
        scr.tex.needsUpdate = true;
      }
    }
  };
  world.stands = stands; world.along = along; world.pos = pos; world.bb = bb; world.mat = mat;
  return world;
}

function checkTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
