// Decorado propio de cada circuito: la ciudad portuaria (Porto Cidade) y el desierto de noche con focos (Al Noor).
import * as THREE from 'three';
import * as TX from './textures.js';
import { HALF_W, between } from './track.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };

// Caja (edificio) con UV por metros para que las ventanas no se estiren; se acumulan en una sola geometría
class Blocks {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; this.roof = []; }
  add(x, y, z, w, d, h, yaw, color, floorH = 3.2, bayW = 4) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (a, b, hh) => [x + a * c + b * s, y + hh, z - a * s + b * c];
    const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const floors = h / (floorH * 16);
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = cs[k], [a1, b1] = cs[(k + 1) % 4];
      const len = Math.hypot(a1 - a0, b1 - b0), u = len / (bayW * 4);
      const base = this.n;
      for (const [p, t] of [[P(a0, b0, 0), [0, 0]], [P(a1, b1, 0), [u, 0]], [P(a1, b1, h), [u, floors]], [P(a0, b0, h), [0, floors]]]) {
        this.pos.push(...p); this.uv.push(...t); this.col.push(color.r, color.g, color.b); this.n++;
      }
      this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    this.roof.push(cs.map(([a, b]) => P(a, b, h)));
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
  roofMesh(material) {
    const pos = [], idx = []; let n = 0;
    for (const r of this.roof) { for (const p of r) pos.push(p[0], p[1] + 0.05, p[2]); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); material.side = THREE.DoubleSide; return m;
  }
}

// ¿cabe un edificio (rectángulo orientado) sin tocar pista, muros, gradas ni lo ya ocupado?
function makeFits(T, world, ctx) {
  return (x, z, w, d, yaw, margin) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    if (!ctx.occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + Math.max(w, d) * 0.5)) return false;
    if (world.trackDist(x, z) > 230 + Math.hypot(w, d)) return true;       // lejos de pista, muros y gradas
    const pts = [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]];
    for (const [a, b] of pts) {
      const px = x + a * c + b * s, pz = z - a * s + b * c;
      const n = world.nearest(px, pz, 6);
      if (n.i < 0) continue;
      const sN = n.i * T.ds, dx = px - T.x[n.i], dz = pz - T.z[n.i];
      const side = dx * T.lx[n.i] + dz * T.lz[n.i] >= 0 ? 1 : -1;
      if (n.d < world.barrier(sN, side) + margin) return false;
      if (between(T, sN, T.wrap(T.pit.entryA - 60), T.wrap(T.pit.exitB + 60)) && side < 0 && n.d < 160) return false;
      for (const st of world.stands) if (st.side === side && between(T, sN, T.wrap(st.s0 - 10), T.wrap(st.s0 + st.len + 10)) && n.d < world.barrier(sN, side) + st.depth + 14) return false;
    }
    return true;
  };
}

// ------------------------------------------------------------------ farolas, aceras y arbolado junto al muro
function streetside(ctx, { lamps = true, trees = true, sidewalk = true }) {
  const { T, world, scene, G } = ctx;
  const P = [0, 0, 0];
  const pos = (s, d, dy = 0) => { T.pos(s, d, P); return [P[0], P[1] + dy, P[2]]; };
  const pitSide = (s, side) => side < 0 && between(T, s, T.wrap(T.pit.entryA - 40), T.wrap(T.pit.exitB + 40));
  if (sidewalk) {
    const m = new THREE.MeshStandardMaterial({ color: 0xbdbab2, roughness: 0.95 });
    for (const side of [1, -1]) {
      world.along(0, T.L, (s) => side * (world.barrier(s, side) + (side > 0 ? 0.45 : 6)), (s) => side * (world.barrier(s, side) + (side > 0 ? 6 : 0.45)), 0.12, m, 6, 6);
    }
  }
  const lampPts = [], treePts = [];
  for (let s = 10; s < T.L; s += 38) for (const side of [1, -1]) {
    if (pitSide(s, side)) continue;
    const B = world.barrier(s, side);
    if (lamps && (Math.round(s / 38) + (side > 0 ? 0 : 1)) % 2 === 0) lampPts.push({ p: pos(s, side * (B + 1.3)), yaw: Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
    if (trees && Math.sin(s * 0.0031 + side) > -0.2) treePts.push(pos(s + 19, side * (B + 4.2)));
  }
  if (lamps && lampPts.length) {
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 9, 6); pole.translate(0, 4.5, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 2.4); arm.translate(0, 8.9, 1.1);
    const head = new THREE.BoxGeometry(0.45, 0.16, 0.9); head.translate(0, 8.8, 2.2);
    const pm = new THREE.MeshStandardMaterial({ color: 0x3b4045, metalness: 0.6, roughness: 0.4 });
    const hm = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xfff2d6, emissiveIntensity: ctx.night ? 2.5 : 0.15 });
    const ip = new THREE.InstancedMesh(pole, pm, lampPts.length), ia = new THREE.InstancedMesh(arm, pm, lampPts.length), ih = new THREE.InstancedMesh(head, hm, lampPts.length);
    lampPts.forEach(({ p }) => world.addOccluder(p[0], p[2], 0.18, 0.18, 0, p[1] - 1, p[1] + 9.2));
    lampPts.forEach(({ p, yaw }, k) => { m4.compose(v.set(p[0], p[1], p[2]), q.setFromAxisAngle(Y, yaw), sc.set(1, 1, 1)); ip.setMatrixAt(k, m4); ia.setMatrixAt(k, m4); ih.setMatrixAt(k, m4); });
    ip.castShadow = true; scene.add(ip, ia, ih);
  }
  if (trees && treePts.length) {
    const crown = new THREE.IcosahedronGeometry(2.6, 1); crown.translate(0, 5.2, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.26, 3.4, 5); trunk.translate(0, 1.7, 0);
    const lm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const ic = new THREE.InstancedMesh(crown, lm, treePts.length), it = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5b4431 }), treePts.length);
    const col = new THREE.Color();
    treePts.forEach((p) => { const s = 0.8 + hash(p[0]) * 0.5; world.addOccluder(p[0], p[2], 2.2 * s, 2.2 * s, 0, p[1] + 3.2 * s, p[1] + 7.6 * s); });
    treePts.forEach((p, k) => { const s = 0.8 + hash(p[0]) * 0.5; m4.compose(v.set(p[0], p[1], p[2]), q.setFromAxisAngle(Y, hash(p[2]) * 6), sc.set(s, s, s)); ic.setMatrixAt(k, m4); it.setMatrixAt(k, m4); ic.setColorAt(k, col.setHSL(0.27 + hash(p[0] + 1) * 0.06, 0.5, 0.2 + hash(p[2] + 3) * 0.08)); });
    ic.castShadow = true; scene.add(ic, it);
  }
}

// ------------------------------------------------------------------ Porto Cidade: manzanas, puerto y yates
export function buildUrban(ctx) {
  const { T, world, scene, G, r, quality } = ctx;
  const fits = makeFits(T, world, ctx);
  streetside(ctx, {});
  const bb = world.bb, WATER_Z = bb.z0 - 230;               // el puerto: al sur de la recta de meta
  ctx.waterZ = WATER_Z;
  const palette = ['#e8d7b5', '#d98f5f', '#f2e3c6', '#c96f4a', '#e7c46a', '#b9c8c6', '#f0efe8', '#d6a9a1', '#9fb7c9', '#e3b582', '#cfd8b8', '#f5d3a7'];
  const variants = [new Blocks(), new Blocks(), new Blocks()];
  const col = new THREE.Color();
  const roofBits = [], awnings = [], signs = [];
  let placed = 0;
  const P = [0, 0, 0];
  const add = (bx, bz, w, d, h, yaw, k, claim = true) => {
    const gy = G(bx, bz) - 0.5;
    col.set(palette[Math.floor(r() * palette.length)]).convertSRGBToLinear();
    variants[k % 3].add(bx, gy, bz, w, d, h, yaw, col);
    world.addOccluder(bx, bz, w / 2, d / 2, yaw, gy - 2, gy + h);
    if (r() < 0.6) roofBits.push([bx + (r() - 0.5) * w * 0.4, gy + h, bz + (r() - 0.5) * d * 0.4, 1.5 + r() * 2.5]);
    if (claim) ctx.occ.push({ x: bx, z: bz, r: Math.min(w, d) * 0.45 });
    placed++;
    return gy;
  };
  // 1) fachadas a pie de calle: edificios alineados con la pista, con toldos de tiendas y rótulos en las azoteas
  const pitSide = (sN, side) => side < 0 && between(T, sN, T.wrap(T.pit.entryA - 60), T.wrap(T.pit.exitB + 60));
  for (const side of [1, -1]) {
    let sN = 0;
    while (sN < T.L) {
      const w = 16 + r() * 14, d = 14 + r() * 8;
      const sm = sN + w / 2, i = T.idx(sm);
      if (pitSide(sm, side) || Math.abs(T.k[i]) > 1 / 90) { sN += w + 6; continue; }       // curvas lentas: plazas y escapatorias
      const off = world.barrier(sm, side) + 7.5 + d / 2 + (hash(sm * 0.1 + side) < 0.25 ? 12 : 0);
      T.pos(sm, side * off, P);
      const yaw = Math.atan2(T.tx[i], T.tz[i]) + Math.PI / 2;
      if (fits(P[0], P[2], w, d, yaw, 4)) {
        const h = 12 + Math.floor(r() * 7) * 3.2 + (r() < 0.12 ? 18 + r() * 30 : 0);
        const gy = add(P[0], P[2], w, d, h, yaw, placed);
        // toldo sobre la planta baja, del lado de la pista
        if (r() < 0.7) { T.pos(sm, side * (off - d / 2 - 0.9), P); awnings.push([P[0], gy + 3.6, P[2], yaw, w * 0.85, r()]); }
        if (r() < 0.22) { T.pos(sm, side * (off - d / 2 + 2), P); signs.push([P[0], gy + h, P[2], yaw, side, Math.floor(r() * 12)]); }
      }
      sN += w + 1 + r() * 4;
    }
  }
  // 2) el resto de la ciudad en manzanas (lo más cercano a la pista primero)
  const step = 44, x0 = bb.x0 - 900, x1 = bb.x1 + 900, z0 = WATER_Z + 40, z1 = bb.z1 + 900;
  const maxB = quality === 'low' ? 3500 : 9000;
  const parkTrees = [];
  const cells = [];
  for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) cells.push([x, z, world.trackDist(x, z)]);
  cells.sort((a, b) => a[2] - b[2]);
  for (const [x, z] of cells) {
    if (placed >= maxB) break;
    // parques (los mismos que pinta el suelo): árboles en vez de edificios
    const park = hash(Math.floor(x / 180) * 5.3 + Math.floor(z / 180) * 9.1) < 0.12 && world.trackDist(x, z) > 200;
    if (park) { for (let t = 0; t < 5; t++) { const tx = x + (r() - 0.5) * 40, tz = z + (r() - 0.5) * 40; if (fits(tx, tz, 3, 3, 0, 2)) parkTrees.push([tx, tz]); } continue; }
    const blockH = hash(Math.floor(x / 150) * 3.7 + Math.floor(z / 150) * 1.3);
    if (blockH < 0.05) continue;
    for (const [ox, oz] of [[-10.5, -10.5], [10.5, -10.5], [-10.5, 10.5], [10.5, 10.5]]) {
      const w = 17 + r() * 3, d = 17 + r() * 3, bx = x + ox, bz = z + oz;
      if (!fits(bx, bz, w, d, 0, 5)) continue;
      const far = Math.min(1, world.trackDist(bx, bz) / 900);
      const h = 11 + Math.floor(r() * 6) * 3.2 + (r() < 0.06 + far * 0.2 ? 20 + r() * 70 * far : 0);
      add(bx, bz, w, d, h, 0, placed, false);
    }
  }
  variants.forEach((b, k) => {
    const mat = new THREE.MeshStandardMaterial({ map: TX.facade(k + 1), vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const m = b.mesh(mat); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(b.roofMesh(new THREE.MeshStandardMaterial({ color: k === 1 ? 0xa65a3c : 0x8c8f93, roughness: 0.9 })));
  });
  if (roofBits.length) {
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xc8cbd0, roughness: 0.6, metalness: 0.3 }), roofBits.length);
    roofBits.forEach(([x, y, z, s], k) => { m4.compose(v.set(x, y, z), q.setFromAxisAngle(Y, r()), sc.set(s, s * 0.7, s * 1.3)); im.setMatrixAt(k, m4); });
    scene.add(im);
  }
  if (awnings.length) {
    const g = new THREE.BoxGeometry(1, 0.18, 1.8); g.rotateX(0.18);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), awnings.length);
    const AW = ['#b3261e', '#1d5c8c', '#2e7d4f', '#e0a526', '#6b3fa0', '#d9d4c7', '#c2571a'];
    awnings.forEach(([x, y, z, yaw, w, h], k) => { m4.compose(v.set(x, y, z), q.setFromAxisAngle(Y, yaw), sc.set(w, 1, 1)); im.setMatrixAt(k, m4); im.setColorAt(k, col.set(AW[Math.floor(h * AW.length)]).convertSRGBToLinear()); });
    im.castShadow = true; scene.add(im);
  }
  if (parkTrees.length) {
    const crown = new THREE.IcosahedronGeometry(3.2, 1); crown.translate(0, 6, 0);
    const trunk = new THREE.CylinderGeometry(0.22, 0.3, 4, 5); trunk.translate(0, 2, 0);
    const ic = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), parkTrees.length);
    const it = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5b4431 }), parkTrees.length);
    parkTrees.forEach(([x, z], k) => { const s2 = 0.8 + hash(x) * 0.6; m4.compose(v.set(x, G(x, z) - 0.3, z), q.setFromAxisAngle(Y, hash(z) * 6), sc.set(s2, s2, s2)); ic.setMatrixAt(k, m4); it.setMatrixAt(k, m4); ic.setColorAt(k, col.setHSL(0.26 + hash(x + 2) * 0.07, 0.45, 0.2 + hash(z + 5) * 0.1)); });
    ic.castShadow = true; scene.add(ic, it);
  }
  // rótulos luminosos en las azoteas, mirando a la pista
  for (const [x, y, z, yaw, side, k] of signs) {
    const t = TX.sponsorBoard(40 + k, 96);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    t.repeat.set(0.3, 1);
    m.position.set(x, y + 2.4, z); m.rotation.y = yaw + (side > 0 ? Math.PI : 0); scene.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x33373c })); frame.position.set(x, y + 0.6, z); scene.add(frame);
  }
  // 3) pasarelas peatonales sobre la pista, en rectas (cuentan para las cámaras)
  {
    const glassM = new THREE.MeshStandardMaterial({ color: 0x9cc4dc, metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.55 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.4, roughness: 0.4 });
    const spots = [];
    for (let sN = 0; sN < T.L; sN += 10) {
      let ok = true;
      for (let q2 = -60; q2 <= 60; q2 += 10) if (Math.abs(T.k[T.idx(sN + q2)]) > 1 / 400) ok = false;
      if (!ok || between(T, sN, T.wrap(T.pit.entryA - 150), T.wrap(T.pit.exitB + 100))) continue;
      if (world.overheads.some((o) => Math.abs(T.rel(o.s, sN)) < 400) || spots.some((q3) => Math.abs(T.rel(q3, sN)) < 700)) continue;
      spots.push(sN);
    }
    for (const sN of spots.slice(0, 4)) {
      const i = T.idx(sN), yaw = Math.atan2(T.tx[i], T.tz[i]);
      const wL = world.barrier(sN, 1) + 3, wR = world.barrier(sN, -1) + 3, span = wL + wR, mid = (wL - wR) / 2;
      T.pos(sN, mid, P); const cy = P[1] + 8.2;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.6, 3.6), steel); deck.position.set(P[0], cy, P[2]); deck.rotation.y = yaw; deck.castShadow = true; scene.add(deck);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(span, 0.25, 4), steel); roof.position.set(P[0], cy + 3.2, P[2]); roof.rotation.y = yaw; scene.add(roof);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(span, 2.9, 3.4), glassM); gl.position.set(P[0], cy + 1.75, P[2]); gl.rotation.y = yaw; scene.add(gl);
      const tb = TX.sponsorBoard(60 + spots.indexOf(sN), 96); tb.repeat.set(0.4, 1);
      for (const f of [-1, 1]) {
        T.pos(sN + f * 1.9, mid, P);
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF_W + 6, 1.4), new THREE.MeshBasicMaterial({ map: tb }));
        ban.position.set(P[0], cy - 0.2, P[2]); ban.rotation.y = yaw + (f < 0 ? Math.PI : 0); scene.add(ban);
      }
      for (const side of [1, -1]) {
        T.pos(sN, side * (side > 0 ? wL : wR), P);
        const tw = new THREE.Mesh(new THREE.BoxGeometry(4.5, cy - P[1] + 3.4, 4.5), steel); tw.position.set(P[0], (cy + 3.4 + P[1]) / 2, P[2]); tw.rotation.y = yaw; tw.castShadow = true; scene.add(tw);
        world.addOccluder(P[0], P[2], 2.3, 2.3, yaw, P[1] - 1, cy + 3.4);
      }
      world.overheads.push({ s: sN, h0: 7.6, h1: 11.6, w: Math.max(wL, wR) + 2, len: 2.2 });
    }
  }
  // 4) rascacielos de cristal junto al puerto (el skyline que se ve desde la recta)
  {
    const glassT = TX.glass();
    const tm = new THREE.MeshStandardMaterial({ map: glassT, color: 0xb8d4e8, metalness: 0.7, roughness: 0.12, envMapIntensity: 1.3 });
    const cx = (bb.x0 + bb.x1) / 2;
    for (let k = 0; k < 16; k++) {
      const x = cx + (k - 7.5) * 150 + (r() - 0.5) * 60, z = bb.z1 + 260 + r() * 380;
      const w = 26 + r() * 22, h = 110 + r() * 150;
      if (!fits(x, z, w, w, 0, 30)) continue;
      const gy = G(x, z) - 0.5;
      const geo = k % 3 === 0 ? new THREE.CylinderGeometry(w * 0.5, w * 0.55, h, 20) : new THREE.BoxGeometry(w, h, w * 0.8);
      const t = new THREE.Mesh(geo, tm); t.position.set(x, gy + h / 2, z); t.rotation.y = r() * 1.5; t.castShadow = true; scene.add(t);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 18, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8 }));
      crown.position.set(x, gy + h + 9, z); scene.add(crown);
      world.addOccluder(x, z, w / 2, w / 2, 0, gy, gy + h);
    }
  }
  // puerto: agua, muelle, paseo con palmeras y yates amarrados
  const wx0 = bb.x0 - 1500, wx1 = bb.x1 + 1500;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, 2600), new THREE.MeshStandardMaterial({ color: 0x1f5873, metalness: 0.55, roughness: 0.12, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set((wx0 + wx1) / 2, 2.2, WATER_Z - 1300); scene.add(water);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(wx1 - wx0, 4, 14), new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.9 }));
  quay.position.set((wx0 + wx1) / 2, 2.6, WATER_Z + 6); quay.receiveShadow = true; scene.add(quay);
  const hull = new THREE.CapsuleGeometry(1.6, 9, 4, 10); hull.rotateZ(Math.PI / 2); hull.scale(1, 0.55, 1); hull.translate(0, 0.6, 0);
  const cabin = new THREE.BoxGeometry(5, 1.6, 2.4); cabin.translate(-0.8, 1.9, 0);
  const mast = new THREE.CylinderGeometry(0.06, 0.08, 9, 4); mast.translate(0.5, 5, 0);
  const boats = [];
  for (let x = wx0 + 200; x < wx1 - 200; x += 16 + r() * 10) {
    if (r() < 0.15) continue;
    boats.push([x, WATER_Z - 12 - r() * 3, (r() - 0.5) * 0.1 + Math.PI / 2, 0.8 + r() * 0.9, r() < 0.35]);
    if (r() < 0.35) boats.push([x + r() * 40, WATER_Z - 80 - r() * 500, r() * 6, 0.9 + r() * 1.4, r() < 0.3]);
  }
  const hm = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.3, metalness: 0.1 });
  const ih = new THREE.InstancedMesh(hull, hm, boats.length), ic = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.15, metalness: 0.6 }), boats.length);
  const sail = boats.filter((b) => b[4]);
  const im = new THREE.InstancedMesh(mast, new THREE.MeshStandardMaterial({ color: 0xdddddd }), sail.length);
  boats.forEach(([x, z, yaw, s], k) => { m4.compose(v.set(x, 2.2, z), q.setFromAxisAngle(Y, yaw), sc.set(s, s, s)); ih.setMatrixAt(k, m4); ic.setMatrixAt(k, m4); });
  sail.forEach(([x, z, yaw, s], k) => { m4.compose(v.set(x, 2.2, z), q.setFromAxisAngle(Y, yaw), sc.set(s, s, s)); im.setMatrixAt(k, m4); });
  ih.castShadow = true; scene.add(ih, ic, im);
  palms(ctx, Array.from({ length: Math.floor((wx1 - wx0 - 400) / 22) }, (_, k) => [wx0 + 200 + k * 22, WATER_Z + 20]).filter(([x, z]) => fits(x, z, 2, 2, 0, 3)));
}

// ------------------------------------------------------------------ palmeras (paseo, oasis, paddock)
function palms(ctx, pts) {
  const { scene, G } = ctx;
  if (!pts.length) return;
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 9, 6); trunk.translate(0, 4.5, 0);
  const leaves = new THREE.BufferGeometry();
  { // 8 frondas caídas
    const pos = [], idx = []; let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const pts = [[0, 0, 0.5], [2.2, 0.7, 0.8], [4.6, -0.6, 0.35], [5.4, -1.8, 0]];
      for (const [d, h, w] of pts) { pos.push(ca * d - sa * w, 9 + h, sa * d + ca * w, ca * d + sa * w, 9 + h, sa * d - ca * w); }
      for (let j = 0; j < 3; j++) { const b = n + j * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      n += 8;
    }
    leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); leaves.setIndex(idx); leaves.computeVertexNormals();
  }
  const it = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x7a6040, roughness: 1 }), pts.length);
  const il = new THREE.InstancedMesh(leaves, new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 0.9, side: THREE.DoubleSide }), pts.length);
  pts.forEach(([x, z], k) => { const s = 0.85 + hash(x + z) * 0.45; const tilt = (hash(x) - 0.5) * 0.18; q.setFromEuler(new THREE.Euler(tilt, hash(z) * 6, tilt * 0.7)); m4.compose(v.set(x, G(x, z) - 0.2, z), q, sc.set(s, s, s)); it.setMatrixAt(k, m4); il.setMatrixAt(k, m4); });
  it.castShadow = il.castShadow = true; scene.add(it, il);
}

// ------------------------------------------------------------------ Al Noor: focos, hotel iluminado, palmeras y ciudad al fondo
export function buildNight(ctx) {
  const { T, world, scene, G, r, quality } = ctx;
  const P = [0, 0, 0];
  const pos = (s, d) => { T.pos(s, d, P); return [P[0], P[1], P[2]]; };
  const fits = makeFits(T, world, ctx);
  // torres de focos a lo largo de toda la pista, alternando lados, con el panel mirando a la pista
  const towers = [];
  for (let s = 0; s < T.L; s += 58) {
    const side = Math.floor(s / 58) % 2 ? 1 : -1;
    if (side < 0 && between(T, s, T.wrap(T.pit.entryA - 20), T.wrap(T.pit.exitB + 20))) continue;
    const B = world.barrier(s, side), p = pos(s, side * (B + 3.5));
    const gy = Math.max(p[1], G(p[0], p[2]));
    const i = T.idx(s), yaw = Math.atan2(-side * T.lx[i], -side * T.lz[i]);
    towers.push({ x: p[0], y: gy, z: p[2], yaw });
  }
  // en la recta de boxes, focos sobre el edificio
  for (const b of T.pit.boxes) { const p = pos(b.s, -40); towers.push({ x: p[0], y: p[1] + 12, z: p[2], yaw: Math.atan2(T.lx[T.idx(b.s)], T.lz[T.idx(b.s)]), short: true }); }
  const H = 26;
  const pole = new THREE.CylinderGeometry(0.28, 0.5, H, 8); pole.translate(0, H / 2, 0);
  const frame = new THREE.BoxGeometry(6.4, 3.4, 0.5); frame.translate(0, 0, 0);
  const panel = new THREE.PlaneGeometry(5.8, 2.8);
  const pm = new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.7, roughness: 0.4 });
  const lm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 6, toneMapped: false });
  const ip = new THREE.InstancedMesh(pole, pm, towers.length), iF = new THREE.InstancedMesh(frame, pm, towers.length), iL = new THREE.InstancedMesh(panel, lm, towers.length);
  const glowPts = [];
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.55);
  towers.forEach((t, k) => {
    const h = t.short ? 6 : H;
    m4.compose(v.set(t.x, t.y, t.z), q.identity(), sc.set(1, h / H, 1)); ip.setMatrixAt(k, m4);
    world.addOccluder(t.x, t.z, 0.45, 0.45, 0, t.y - 1, t.y + h + 3);
    q.setFromAxisAngle(Y, t.yaw).multiply(tilt);
    m4.compose(v.set(t.x, t.y + h + 1.2, t.z), q, sc.set(1, 1, 1)); iF.setMatrixAt(k, m4);
    const fwd = new THREE.Vector3(0, 0, 0.3).applyQuaternion(q);
    m4.compose(v.set(t.x + fwd.x, t.y + h + 1.2 + fwd.y, t.z + fwd.z), q, sc.set(1, 1, 1)); iL.setMatrixAt(k, m4);
    glowPts.push(t.x + fwd.x * 3, t.y + h + 1.2, t.z + fwd.z * 3);
  });
  ip.castShadow = true; scene.add(ip, iF, iL);
  // halos de los focos (se ven de lejos)
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  scene.add(new THREE.Points(gg, new THREE.PointsMaterial({ map: TX.glow(), size: 26, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff3dc, fog: false })));
  // luces en los tejados de las gradas
  const strips = [];
  for (const st of world.stands) for (let s = st.s0; s < st.s0 + st.len; s += 9) { const B = world.barrier(s, st.side); const p = pos(s, st.side * (B + 6 + st.depth * 0.5)); strips.push(p[0], p[1] + st.h - 0.2, p[2]); }
  if (strips.length) { const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(strips, 3)); scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ map: TX.glow(), size: 7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xcfe4ff }))); }
  // hotel iluminado junto a la curva más lenta, con corona LED que cambia de color
  const slow = T.corners.slice().sort((a, b) => a.radius - b.radius)[0];
  const out = -(Math.sign(slow.dir) || 1);
  let hotel = null;
  for (let off = 70; off < 260 && !hotel; off += 20) {
    const p = pos(slow.apex, out * (world.barrier(slow.apex, out) + off));
    if (fits(p[0], p[2], 70, 70, 0, 8)) hotel = p;
  }
  const lit = [];
  if (hotel) {
    const b = new Blocks(), col = new THREE.Color(0x9aa3ad);
    const hy = G(hotel[0], hotel[2]) - 0.5;
    const parts = [[hotel[0] - 18, hotel[2], 24, 24, 78], [hotel[0] + 18, hotel[2] + 6, 24, 24, 64], [hotel[0], hotel[2] - 26, 50, 16, 18]];
    for (const [x, z, w, d, h] of parts) { b.add(x, hy, z, w, d, h, 0.3, col, 3.4, 3); world.addOccluder(x, z, w / 2, d / 2, 0.3, hy - 2, hy + h); }
    const hm = new THREE.MeshStandardMaterial({ map: TX.facade(4), emissiveMap: TX.litFacade(9), emissive: 0xffffff, emissiveIntensity: 1.4, vertexColors: true, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
    scene.add(b.mesh(hm)); scene.add(b.roofMesh(new THREE.MeshStandardMaterial({ color: 0x30343a })));
    const crown = new THREE.Mesh(new THREE.TorusGeometry(46, 1.6, 8, 64), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3aa0ff, emissiveIntensity: 3, toneMapped: false }));
    crown.rotation.x = Math.PI / 2; crown.position.set(hotel[0], hy + 84, hotel[2]); scene.add(crown);
    ctx.claim(hotel[0], hotel[2], 70);
    lit.push(crown.material);
  }
  // ciudad encendida en el horizonte (anillo lejano)
  {
    const b = new Blocks(), col = new THREE.Color(0x5a6068);
    const cx = (world.bb.x0 + world.bb.x1) / 2, cz = (world.bb.z0 + world.bb.z1) / 2;
    for (let k = 0; k < (quality === 'low' ? 160 : 320); k++) {
      const a = 3.6 + r() * 1.6 + (r() < 0.3 ? 2.2 : 0), d = 2300 + r() * 900;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, w = 20 + r() * 30;
      b.add(x, G(x, z) - 2, z, w, w * (0.6 + r() * 0.6), 20 + r() * r() * 190, r(), col, 3.4, 3);
    }
    scene.add(b.mesh(new THREE.MeshStandardMaterial({ map: TX.facade(2), emissiveMap: TX.litFacade(3), emissive: 0xffffff, emissiveIntensity: 1.1, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })));
  }
  // palmeras: paddock, borde de las rectas y oasis dispersos
  const pts = [];
  for (let s = 0; s < T.L; s += 26) for (const side of [1, -1]) {
    if (Math.sin(s * 0.004 + side * 1.7) < 0.35) continue;
    const p = pos(s, side * (world.barrier(s, side) + 14 + r() * 6)); if (fits(p[0], p[2], 3, 3, 0, 6)) pts.push([p[0], p[2]]);
  }
  for (let k = 0; k < 16; k++) {
    const x = world.bb.x0 - 400 + r() * (world.bb.x1 - world.bb.x0 + 800), z = world.bb.z0 - 400 + r() * (world.bb.z1 - world.bb.z0 + 800);
    if (!fits(x, z, 40, 40, 0, 20)) continue;
    for (let j = 0; j < 14; j++) { const a = r() * 6.28, d = r() * 26; pts.push([x + Math.cos(a) * d, z + Math.sin(a) * d]); }
  }
  palms(ctx, pts);
  // matojos del desierto
  {
    const g = new THREE.IcosahedronGeometry(0.9, 0); g.scale(1, 0.55, 1);
    const n = quality === 'low' ? 900 : 2200, pts2 = [];
    for (let t = 0; t < n * 4 && pts2.length < n; t++) { const x = world.bb.x0 - 900 + r() * (world.bb.x1 - world.bb.x0 + 1800), z = world.bb.z0 - 900 + r() * (world.bb.z1 - world.bb.z0 + 1800); if (world.trackDist(x, z) > 40 && ctx.occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r)) pts2.push([x, z]); }
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x6f6a3c, roughness: 1, flatShading: true }), pts2.length);
    pts2.forEach(([x, z], k) => { const s = 0.6 + hash(x) * 1.4; m4.compose(v.set(x, G(x, z), z), q.setFromAxisAngle(Y, hash(z) * 6), sc.set(s, s, s)); im.setMatrixAt(k, m4); });
    scene.add(im);
  }
  ctx.nightLit = lit;
}
