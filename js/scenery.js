// Alrededores: cielo con nubes, paddock (motorhomes, camiones, carpas), aparcamientos, camping,
// lago, noria, bosques, aerogeneradores, ciudad, torres de cámaras de TV y helicóptero de la tele.
import * as THREE from 'three';
import * as TX from './textures.js';
import { TEAMS } from './teams.js';
import { HALF_W, between } from './track.js';
import { buildUrban, buildNight, buildMountain } from './decor.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

export function buildScenery(T, scene, world, quality, sunDir) {
  const r = rng(4242);
  const occ = [];
  const G = world.groundY;
  const maxB = (s) => Math.max(world.barrier(s, 1), world.barrier(s, -1));
  const clearOfTrack = (x, z, rad) => {
    const n = world.nearest(x, z, 6);
    if (n.i < 0) return true;
    const s = n.i * T.ds;
    const pitSide = between(T, s, T.wrap(T.pit.entryA - 60), T.wrap(T.pit.exitB + 60));
    return n.d > maxB(s) + rad + 14 + (pitSide ? 40 : 0);
  };
  const free = (x, z, rad) => clearOfTrack(x, z, rad) && occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + rad);
  const claim = (x, z, rad) => occ.push({ x, z, r: rad });
  const out = { update: () => {} };
  const night = !!world.night, urban = !!world.urban, sunset = !!world.sunset;
  const rural = !night && !urban && !sunset;

  // -------------------------------------------------------------- cielo
  {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: sunDir.clone() }, night: { value: night ? 1 : 0 }, sunset: { value: sunset ? 1 : 0 }, cloud: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 sun; uniform float night; uniform float sunset; uniform float cloud;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main(){
          if (night > 0.5) {
            // noche: degradado azul muy oscuro, estrellas, luna y resplandor de la ciudad en el horizonte
            float hh = max(vDir.y, 0.0);
            vec3 c = mix(vec3(0.05, 0.06, 0.10), vec3(0.006, 0.008, 0.02), pow(hh, 0.45));
            c += vec3(0.18, 0.11, 0.05) * pow(1.0 - hh, 10.0) * 0.6;
            vec3 g = floor(vDir * 420.0); float st = h3(g);
            if (st > 0.9975 && vDir.y > 0.05) c += vec3(0.9, 0.92, 1.0) * (st - 0.9975) * 360.0 * smoothstep(0.05, 0.3, vDir.y);
            vec3 moon = normalize(vec3(-0.45, 0.55, -0.7)); float m = dot(vDir, moon);
            c += vec3(0.95, 0.93, 0.85) * smoothstep(0.99945, 0.9997, m) * 1.6 + vec3(0.25, 0.28, 0.35) * pow(max(m, 0.0), 60.0) * 0.25;
            if (vDir.y < 0.0) c = vec3(0.02, 0.018, 0.02);
            // nublado: tapa estrellas y luna; las nubes bajas reflejan algo de la luz de la ciudad
            c = mix(c, vec3(0.045, 0.043, 0.05) + vec3(0.06, 0.045, 0.03) * pow(1.0 - hh, 3.0), cloud * 0.92);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          if (sunset > 0.5) {
            // atardecer en la montaña: cielo naranja-rosado hacia el sol y azul violáceo al otro lado
            float h = max(vDir.y, 0.0);
            vec3 zen = vec3(0.12, 0.15, 0.38);
            vec3 horSun = vec3(0.96, 0.48, 0.22);
            vec3 horAnti = vec3(0.55, 0.36, 0.54);
            vec3 gnd = vec3(0.18, 0.14, 0.16);
            float s = dot(vDir, normalize(sun));
            float sWeight = 0.5 + 0.5 * s;
            vec3 hor = mix(horAnti, horSun, pow(sWeight, 1.3));
            vec3 c = mix(hor, zen, pow(h, 0.42));
            if (vDir.y < 0.0) c = mix(hor, gnd, min(1.0, -vDir.y * 5.0));
            float sPos = max(s, 0.0);
            vec3 sunDisc = vec3(1.0, 0.88, 0.60) * pow(sPos, 600.0) * 7.0;
            vec3 sunGlow = vec3(1.0, 0.50, 0.18) * pow(sPos, 14.0) * 1.6 + vec3(0.95, 0.28, 0.20) * pow(sPos, 3.2) * 0.4;
            c += (sunDisc + sunGlow) * (1.0 - cloud);
            vec3 ov = mix(vec3(0.44, 0.38, 0.42), vec3(0.24, 0.22, 0.28), pow(h, 0.6));
            if (vDir.y < 0.0) ov = vec3(0.22, 0.20, 0.22);
            c = mix(c, ov, cloud);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          float h = max(vDir.y, 0.0);
          vec3 zen = vec3(0.16, 0.36, 0.72), hor = vec3(0.70, 0.80, 0.90), gnd = vec3(0.55, 0.62, 0.66);
          vec3 c = mix(hor, zen, pow(h, 0.55));
          if (vDir.y < 0.0) c = mix(hor, gnd, min(1.0, -vDir.y * 4.0));
          float s = max(dot(vDir, normalize(sun)), 0.0);
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.18) * (1.0 - cloud);
          // cielo de lluvia: capa gris uniforme, algo más clara en el horizonte
          vec3 ov = mix(vec3(0.50, 0.53, 0.57), vec3(0.33, 0.35, 0.39), pow(h, 0.6));
          if (vDir.y < 0.0) ov = vec3(0.42, 0.45, 0.48);
          c = mix(c, ov, cloud);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    dome.renderOrder = -10; scene.add(dome); out.dome = dome;
    // nubes: billboards con textura suave
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, rr = 18 + Math.random() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    const ctex = new THREE.CanvasTexture(cv); ctex.colorSpace = THREE.SRGBColorSpace;
    const cmat = new THREE.SpriteMaterial({
      map: ctex, transparent: true, depthWrite: false, fog: false,
      opacity: sunset ? 0.82 : 0.9,
      color: sunset ? new THREE.Color(0xffb08a) : new THREE.Color(0xffffff),
    });
    out.cloudMat = cmat;
    const cx = (world.bb.x0 + world.bb.x1) / 2, cz = (world.bb.z0 + world.bb.z1) / 2;
    for (let i = 0; i < (night ? 0 : 46); i++) {
      const s = new THREE.Sprite(cmat);
      const a = r() * Math.PI * 2, d = 800 + r() * 5000;
      s.position.set(cx + Math.cos(a) * d, 700 + r() * 900, cz + Math.sin(a) * d);
      const w = 700 + r() * 1300; s.scale.set(w, w * 0.45, 1);
      scene.add(s);
    }
  }

  // -------------------------------------------------------------- paddock
  const P = [0, 0, 0];
  const pos = (s, d, dy = 0) => { T.pos(s, d, P); return new THREE.Vector3(P[0], P[1] + dy, P[2]); };
  const yawAt = (s) => Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]);
  {
    const s0 = T.wrap(T.pit.boxes[0].s - 70), len = T.ahead(s0, T.wrap(T.pit.boxes[T.pit.boxes.length - 1].s + 90));
    const pav = new THREE.MeshStandardMaterial({ map: TX.asphalt(), color: 0xa7abb1, roughness: 0.95 });
    world.along(s0, len, -150, -52, -0.05, pav, 9, 9);
    for (let s = 0; s < len; s += 40) { const p = pos(s0 + s, -100); claim(p.x, p.z, 60); }
    TEAMS.forEach((team, k) => {
      const s = T.pit.boxes[k].s;
      // motorhome de dos plantas con franja acristalada
      const grp = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(22, 4.2, 13), new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.4, metalness: 0.2 }));
      base.position.y = 2.1; grp.add(base);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(21.6, 3.6, 12.6), new THREE.MeshStandardMaterial({ map: TX.glass(), metalness: 0.7, roughness: 0.1 }));
      glass.position.y = 6; grp.add(glass);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 0.5, 14), new THREE.MeshStandardMaterial({ color: team.c2, roughness: 0.5 }));
      roof.position.y = 8.05; grp.add(roof);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
      awn.position.set(0, 4.3, 9.4); grp.add(awn);
      grp.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      grp.position.copy(pos(s, -78)); grp.rotation.y = yawAt(s) + Math.PI / 2 * 0 + Math.PI; grp.position.y = G(grp.position.x, grp.position.z) + 0.05;
      grp.rotation.y = yawAt(s) - Math.PI / 2;
      scene.add(grp);
      // camiones del equipo
      for (const off of [-8, 8]) {
        const tr = new THREE.Group();
        const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.55, 4, 13.6), new THREE.MeshStandardMaterial({ color: team.c1, roughness: 0.35, metalness: 0.3 }));
        trailer.position.set(0, 2.3, 0); tr.add(trailer);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 13.65), new THREE.MeshStandardMaterial({ color: team.c2 })); stripe.position.set(0, 1.4, 0); tr.add(stripe);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.4, metalness: 0.4 })); cab.position.set(0, 1.9, 8.2); tr.add(cab);
        tr.traverse((o) => { o.castShadow = true; });
        const p = pos(s + off * 0.9, -112);
        tr.position.set(p.x, G(p.x, p.z), p.z); tr.rotation.y = yawAt(s) - Math.PI / 2 + 0.02;
        scene.add(tr);
      }
    });
    // carpas de hospitality
    const tentM = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.7 });
    const tent = new THREE.ConeGeometry(6, 4, 4); tent.rotateY(Math.PI / 4); tent.translate(0, 5, 0);
    const tentB = new THREE.BoxGeometry(8.4, 3, 8.4); tentB.translate(0, 1.5, 0);
    const n = 12;
    const im = new THREE.InstancedMesh(tent, tentM, n), ib = new THREE.InstancedMesh(tentB, tentM, n);
    for (let k = 0; k < n; k++) {
      const s = s0 + 20 + k * (len - 40) / n; const p = pos(s, -138);
      m4.compose(v.set(p.x, G(p.x, p.z), p.z), q.setFromAxisAngle(Y, yawAt(s)), sc.set(1, 1, 1)); im.setMatrixAt(k, m4); ib.setMatrixAt(k, m4);
    }
    im.castShadow = ib.castShadow = true; scene.add(im); scene.add(ib);
  }

  // -------------------------------------------------------------- aparcamientos con coches
  const carGeo = new THREE.BoxGeometry(1.8, 1.3, 4.3); carGeo.translate(0, 0.65, 0);
  const carTop = new THREE.BoxGeometry(1.6, 0.6, 2.2); carTop.translate(0, 1.55, -0.2);
  const parked = [];
  const lot = (x, z, w, d, yaw) => {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: TX.asphalt(), color: 0x9a9ea4, roughness: 0.95 }));
    pm.rotation.x = -Math.PI / 2; pm.rotation.z = yaw; pm.position.set(x, G(x, z) + 0.12, z); pm.receiveShadow = true; scene.add(pm);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let a = -w / 2 + 3; a < w / 2 - 2; a += 2.8) for (let b = -d / 2 + 4; b < d / 2 - 3; b += 7.5) {
      if (r() < 0.18) continue;
      const lx = a * c + b * s, lz = -a * s + b * c;
      parked.push([x + lx, z + lz, yaw + (r() < 0.5 ? 0 : Math.PI)]);
    }
    claim(x, z, Math.hypot(w, d) / 2);
  };
  // candidatos: puntos libres cerca de las gradas
  const tryLot = (s, side, off, w, d) => {
    for (let k = 0; k < 6; k++) {
      const p = pos(s, side * (world.barrier(s, side) + off + k * 25));
      if (free(p.x, p.z, Math.hypot(w, d) / 2)) { lot(p.x, p.z, w, d, yawAt(s)); return true; }
    }
    return false;
  };
  const cn = (i) => T.corners[i % T.corners.length];
  if (!urban) {
    tryLot(T.wrap(-120), 1, 70, 180, 90);
    tryLot(T.wrap(cn(0).apex), -Math.sign(cn(0).dir) || 1, 60, 120, 80);
    tryLot(T.wrap(cn(7).sIn), -Math.sign(cn(7).dir) || 1, 60, 140, 70);
    tryLot(T.wrap(cn(11).apex), -Math.sign(cn(11).dir) || 1, 70, 120, 80);
  }
  // decorado propio del circuito (ciudad y puerto / focos y desierto / montaña al atardecer)
  const ctx = { T, world, scene, G, r, quality, occ, claim, night, sunset, clearOfTrack };
  if (urban) buildUrban(ctx);
  if (night) buildNight(ctx);
  if (sunset) buildMountain(ctx);
  {
    const colors = [0xd32f2f, 0x1976d2, 0xfafafa, 0x212121, 0x9e9e9e, 0x388e3c, 0xfbc02d, 0x5d4037, 0x90a4ae, 0x0d47a1];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x1b2530, roughness: 0.1, metalness: 0.8 });
    const im = new THREE.InstancedMesh(carGeo, mat, parked.length), it = new THREE.InstancedMesh(carTop, glassM, parked.length);
    const col = new THREE.Color();
    parked.forEach(([x, z, yaw], k) => { m4.compose(v.set(x, G(x, z) + 0.12, z), q.setFromAxisAngle(Y, yaw), sc.set(1, 1, 1)); im.setMatrixAt(k, m4); it.setMatrixAt(k, m4); im.setColorAt(k, col.setHex(colors[Math.floor(r() * colors.length)])); });
    scene.add(im); scene.add(it);
  }

  // -------------------------------------------------------------- camping
  if (rural) {
    let placed = false;
    for (let t = 0; t < 200 && !placed; t++) {
      const x = world.bb.x0 - 250 + r() * (world.bb.x1 - world.bb.x0 + 500), z = world.bb.z0 - 250 + r() * (world.bb.z1 - world.bb.z0 + 500);
      if (!free(x, z, 70)) continue;
      claim(x, z, 70); placed = true;
      const tg = new THREE.ConeGeometry(1.6, 1.8, 4); tg.rotateY(Math.PI / 4); tg.translate(0, 0.9, 0);
      const cols = [0xff7043, 0x42a5f5, 0x66bb6a, 0xffca28, 0xab47bc, 0xef5350, 0x26c6da];
      const N = 110; const im = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ roughness: 0.8 }), N); const col = new THREE.Color();
      for (let k = 0; k < N; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 62; const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        m4.compose(v.set(px, G(px, pz), pz), q.setFromAxisAngle(Y, r() * 3), sc.set(1 + r() * 0.8, 1, 1 + r() * 1.2)); im.setMatrixAt(k, m4); im.setColorAt(k, col.setHex(cols[k % cols.length]));
      }
      im.castShadow = true; scene.add(im);
      const van = new THREE.BoxGeometry(2.3, 2.6, 6); van.translate(0, 1.3, 0);
      const iv = new THREE.InstancedMesh(van, new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.6 }), 16);
      for (let k = 0; k < 16; k++) { const a = r() * 6.28, d = 30 + r() * 35; const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; m4.compose(v.set(px, G(px, pz), pz), q.setFromAxisAngle(Y, r() * 3), sc.set(1, 1, 1)); iv.setMatrixAt(k, m4); }
      iv.castShadow = true; scene.add(iv);
    }
  }

  // -------------------------------------------------------------- lago y noria
  {
    let best = null, bd = 0;
    for (let t = 0; t < 400; t++) {
      const x = world.bb.x0 + r() * (world.bb.x1 - world.bb.x0), z = world.bb.z0 + r() * (world.bb.z1 - world.bb.z0);
      const d = world.trackDist(x, z);
      if (d > bd && occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 120)) { bd = d; best = [x, z]; }
    }
    if (best && bd > 110 && rural) {
      const rad = Math.min(140, bd - 70);
      const y = G(best[0], best[1]);
      const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x2c5f7c, metalness: 0.7, roughness: 0.06, envMapIntensity: 1.2 }));
      lake.scale.set(rad, rad * 0.6, 1); lake.rotation.x = -Math.PI / 2; lake.position.set(best[0], y + 0.35, best[1]); scene.add(lake);
      const beach = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshStandardMaterial({ color: 0xcdbb8f, roughness: 1 }));
      beach.scale.copy(lake.scale); beach.rotation.x = -Math.PI / 2; beach.position.set(best[0], y + 0.3, best[1]); scene.add(beach);
      claim(best[0], best[1], rad + 10);
    }
    for (let t = 0; t < (night || sunset ? 0 : 300); t++) {
      const x = world.bb.x0 + r() * (world.bb.x1 - world.bb.x0), z = world.bb.z0 + r() * (world.bb.z1 - world.bb.z0);
      if (!free(x, z, 40)) continue;
      claim(x, z, 40);
      const fw = new THREE.Group(); const gy = G(x, z);
      const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3 });
      fw.add(new THREE.Mesh(new THREE.TorusGeometry(26, 0.6, 6, 48), wm));
      fw.add(new THREE.Mesh(new THREE.TorusGeometry(22, 0.3, 6, 48), wm));
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 26, 0.3), wm); sp.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0); sp.rotation.z = a + Math.PI / 2; fw.add(sp);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 2), new THREE.MeshStandardMaterial({ color: ['#e53935', '#fdd835', '#1e88e5', '#43a047'][k % 4] })); cab.position.set(Math.cos(a) * 26, Math.sin(a) * 26 - 1.5, 0); fw.add(cab);
      }
      fw.position.set(x, gy + 30, z); scene.add(fw);
      for (const sd of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 33, 6), wm); leg.position.set(x + sd * 6, gy + 15, z); leg.rotation.z = sd * 0.2; scene.add(leg); }
      out.ferris = fw; break;
    }
  }

  // -------------------------------------------------------------- torres de TV
  out.addCameraTowers = (cams) => {
    const leg = new THREE.CylinderGeometry(0.06, 0.06, 1, 4); leg.translate(0, 0.5, 0);
    const legM = new THREE.MeshStandardMaterial({ color: 0xb0b6bc, metalness: 0.7, roughness: 0.4 });
    const plat = new THREE.BoxGeometry(2.2, 0.15, 2.2);
    const camG = new THREE.BoxGeometry(0.5, 0.45, 0.9);
    const person = new THREE.CapsuleGeometry(0.25, 0.8, 4, 8); person.translate(0, 0.65, 0);
    const list = cams.filter((c) => c.tag !== 'boxes');
    const iL = new THREE.InstancedMesh(leg, legM, list.length * 4), iP = new THREE.InstancedMesh(plat, legM, list.length);
    const iC = new THREE.InstancedMesh(camG, new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.4 }), list.length);
    const iM = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ color: 0xff6d00, roughness: 0.7 }), list.length);
    list.forEach((c, k) => {
      const gy = G(c.pos.x, c.pos.z); const h = c.pos.y - gy - 1.7;
      let n = 0; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { m4.compose(v.set(c.pos.x + a, gy, c.pos.z + b), q.identity(), sc.set(1, h, 1)); iL.setMatrixAt(k * 4 + n++, m4); }
      m4.compose(v.set(c.pos.x, gy + h, c.pos.z), q.identity(), sc.set(1, 1, 1)); iP.setMatrixAt(k, m4);
      // la cámara física y el operario, detrás del punto de vista (lado contrario a la pista): nunca tapan el plano
      const i = T.idx(c.s), bx = c.side * T.lx[i], bz = c.side * T.lz[i];
      m4.compose(v.set(c.pos.x + bx * 0.9, c.pos.y - 0.35, c.pos.z + bz * 0.9), q.identity(), sc.set(1, 1, 1)); iC.setMatrixAt(k, m4);
      m4.compose(v.set(c.pos.x + bx * 1.0 - bz * 0.7, gy + h + 0.1, c.pos.z + bz * 1.0 + bx * 0.7), q.identity(), sc.set(1, 1, 1)); iM.setMatrixAt(k, m4);
    });
    iL.castShadow = iP.castShadow = true;
    scene.add(iL, iP, iC, iM);
  };

  // -------------------------------------------------------------- aerogeneradores en las colinas
  const turbines = [];
  {
    const cx = (world.bb.x0 + world.bb.x1) / 2, cz = (world.bb.z0 + world.bb.z1) / 2;
    const tm = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 });
    const blade = new THREE.BoxGeometry(1.4, 26, 0.4); blade.translate(0, 13, 0);
    for (let k = 0; k < (rural ? 9 : 0); k++) {
      const a = 2.1 + k * 0.16 + r() * 0.05, d = 1700 + r() * 500;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, gy = G(x, z);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 62, 10), tm); tower.position.set(x, gy + 31, z); scene.add(tower);
      const hub = new THREE.Group(); hub.position.set(x, gy + 62, z); hub.rotation.y = -0.6;
      const nac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), tm); nac.position.z = -2; hub.add(nac);
      const rot = new THREE.Group(); rot.position.z = 1.2; hub.add(rot);
      for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(blade, tm); bl.rotation.z = (b * Math.PI * 2) / 3; rot.add(bl); }
      scene.add(hub); turbines.push({ rot, sp: 0.6 + r() * 0.3 });
    }
  }

  // -------------------------------------------------------------- ciudad lejana
  if (rural) {
    const cx = world.bb.x1 + 1300, cz = world.bb.z0 - 900;
    const bgeo = new THREE.BoxGeometry(1, 1, 1); bgeo.translate(0, 0.5, 0);
    const n = 140; const im = new THREE.InstancedMesh(bgeo, new THREE.MeshStandardMaterial({ map: TX.buildingTex(3), roughness: 0.6, metalness: 0.2 }), n);
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * 900 * (0.4 + r()), z = cz + (r() - 0.5) * 600 * (0.4 + r());
      const center = 1 - Math.min(1, Math.hypot(x - cx, z - cz) / 500);
      const h = 18 + r() * 40 + center * center * 160 * r();
      m4.compose(v.set(x, G(x, z) - 1, z), q.setFromAxisAngle(Y, r() * 0.3), sc.set(18 + r() * 26, h, 18 + r() * 26)); im.setMatrixAt(k, m4);
      im.setColorAt(k, col.setHSL(0.58, 0.05 + r() * 0.1, 0.62 + r() * 0.25));
    }
    scene.add(im);
  }

  // -------------------------------------------------------------- bosques y setos
  if (rural) {
    const nTrees = quality === 'low' ? 3500 : 8000;
    const pine = new THREE.ConeGeometry(2.6, 9, 7); pine.translate(0, 6.5, 0);
    const pine2 = new THREE.ConeGeometry(2.0, 5, 7); pine2.translate(0, 10, 0);
    const trunkG = new THREE.CylinderGeometry(0.3, 0.45, 3, 5); trunkG.translate(0, 1.5, 0);
    const round = new THREE.IcosahedronGeometry(3.6, 1); round.translate(0, 6.4, 0);
    const poplar = new THREE.SphereGeometry(1.8, 8, 6); poplar.scale(1, 3.2, 1); poplar.translate(0, 7.5, 0);
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const bark = new THREE.MeshStandardMaterial({ color: 0x5b4431, roughness: 1 });
    const pts = [];
    const x0 = world.bb.x0 - 1350, x1 = world.bb.x1 + 1350, z0 = world.bb.z0 - 1350, z1 = world.bb.z1 + 1350;
    let tries = 0;
    const dens = (x, z) => Math.sin(x * 0.004 + 1) * Math.cos(z * 0.0033) + 0.6 * Math.sin(x * 0.011 + z * 0.009) + 0.3 * Math.sin(x * 0.03 - z * 0.021);
    while (pts.length < nTrees && tries < nTrees * 25) {
      tries++;
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      const dn = dens(x, z);
      if (dn < 0.35 && r() < 0.93) continue;
      if (!free(x, z, 3)) continue;
      pts.push([x, G(x, z) - 0.3, z, r(), dn]);
    }
    // setos de árboles detrás de las vallas en tramos sueltos
    for (let s = 0; s < T.L; s += 14) {
      if (Math.sin(s * 0.004) < 0.2) continue;
      for (const side of [1, -1]) {
        const p = pos(s, side * (world.barrier(s, side) + 16 + r() * 6));
        if (free(p.x, p.z, 3)) pts.push([p.x, G(p.x, p.z) - 0.3, p.z, 0.5 + r() * 0.5, 1]);
      }
    }
    const col = new THREE.Color();
    const groups = { pine: [], round: [], poplar: [] };
    for (const p of pts) (p[3] < 0.4 ? groups.pine : p[3] < 0.85 ? groups.round : groups.poplar).push(p);
    const mk = (geo, material, list, colorFn, shadow) => {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((p, k) => {
        const s = 0.7 + ((p[3] * 7.13) % 1) * 0.9;
        q.setFromAxisAngle(Y, p[3] * 40); sc.set(s, s * (0.85 + ((p[3] * 3.7) % 1) * 0.4), s); v.set(p[0], p[1], p[2]); m4.compose(v, q, sc); im.setMatrixAt(k, m4);
        if (colorFn) im.setColorAt(k, colorFn(p));
      });
      im.castShadow = shadow; scene.add(im); return im;
    };
    const greens = (p) => col.setHSL(0.26 + ((p[3] * 13.1) % 1) * 0.08, 0.55, 0.07 + ((p[3] * 5.7) % 1) * 0.05);
    mk(pine, leaf, groups.pine, (p) => col.setHSL(0.36, 0.5, 0.045 + ((p[3] * 9.1) % 1) * 0.03), true);
    mk(pine2, leaf, groups.pine, (p) => col.setHSL(0.36, 0.5, 0.055 + ((p[3] * 9.1) % 1) * 0.03), false);
    mk(trunkG, bark, groups.pine.concat(groups.round, groups.poplar), null, false);
    mk(round, leaf, groups.round, greens, true);
    mk(poplar, leaf, groups.poplar, (p) => col.setHSL(0.22 + ((p[3] * 3.3) % 1) * 0.06, 0.6, 0.09), true);
  }

  // -------------------------------------------------------------- helicóptero de la tele
  {
    const heli = new THREE.Group();
    const hm = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.4, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), hm); body.scale.set(1, 0.9, 1.7); heli.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 7, 6), hm); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.3, -5); heli.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222 })); rotor.position.y = 1.7; heli.add(rotor);
    const rotor2 = rotor.clone(); rotor2.rotation.y = Math.PI / 2; heli.add(rotor2);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 3.6), new THREE.MeshStandardMaterial({ color: 0x888888 })); skid.position.y = -1.6; heli.add(skid);
    heli.position.set(0, 160, 0); scene.add(heli);
    let a = 0;
    out.update = (dt, focus, camPos) => {
      if (camPos) out.dome.position.copy(camPos);
      for (const t of turbines) t.rot.rotation.z += dt * t.sp;
      if (out.ferris) out.ferris.rotation.z += dt * 0.03;
      a += dt * 0.12;
      if (focus) {
        const tx = focus.x + Math.cos(a) * 220, tz = focus.z + Math.sin(a) * 220;
        heli.position.x += (tx - heli.position.x) * Math.min(1, dt * 0.25);
        heli.position.z += (tz - heli.position.z) * Math.min(1, dt * 0.25);
        heli.position.y = 150 + Math.sin(a * 3) * 6;
        heli.lookAt(focus.x, 150, focus.z);
      }
      rotor.rotation.y += dt * 40; rotor2.rotation.y += dt * 40;
    };
  }
  return out;
}
