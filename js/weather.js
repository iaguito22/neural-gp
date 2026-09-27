// Lluvia en pantalla: gotas que caen alrededor de la cámara (todo en el shader), nubes y luz de día nublado,
// pista mojada que refleja, espuma de agua detrás de los coches y gotas en la cámara on-board.
// Lo que manda es la simulación (sim.wx: lluvia, agua en pista); aquí solo se dibuja.
import * as THREE from 'three';

const ONBOARD = new Set(['cockpit', 'tcam', 'nose', 'rear']);

export function buildWeather(scene, world, scenery, renderer, camera, quality) {
  const night = !!world.night, hi = quality !== 'low';
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------------------------------------------------------------- gotas
  const N = hi ? 14000 : 6000;
  const pos = new Float32Array(N * 6), aEnd = new Float32Array(N * 2), aRnd = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 70, y = Math.random() * 36, z = Math.random() * 70, r = Math.random();
    pos.set([x, y, z, x, y, z], i * 6); aEnd[i * 2 + 1] = 1; aRnd[i * 2] = aRnd[i * 2 + 1] = r;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1));
  rg.setAttribute('aRnd', new THREE.BufferAttribute(aRnd, 1));
  const ru = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uVel: { value: new THREE.Vector3(1.5, -13, 0.8) }, uLen: { value: 0.8 },
    uCol: { value: new THREE.Color(night ? 0xdfe6f2 : 0xc4ccd6) }, uOp: { value: night ? 0.5 : 0.36 } };
  const rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
    uniforms: ru, transparent: true, depthWrite: false, fog: false,
    vertexShader: `uniform float uT, uAmt, uLen; uniform vec3 uCam, uVel; attribute float aEnd, aRnd; varying float vA;
      const vec3 BOX = vec3(70.0, 36.0, 70.0);
      void main() {
        vec3 p = position + uVel * uT * (0.8 + 0.4 * aRnd);
        p = mod(p - uCam + 0.5 * BOX, BOX) - 0.5 * BOX + uCam;
        p -= normalize(uVel) * uLen * (0.6 + 0.8 * aRnd) * aEnd;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vA = step(aRnd, uAmt) * (1.0 - 0.8 * aEnd) * smoothstep(0.4, 2.5, -mv.z) * (1.0 - smoothstep(22.0, 35.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uOp; varying float vA;
      void main() { if (vA < 0.01) discard; gl_FragColor = vec4(uCol, uOp * vA); }`,
  }));
  rain.frustumCulled = false; rain.renderOrder = 5; rain.visible = false; scene.add(rain);

  // ---------------------------------------------------------------- espuma de agua (spray) detrás de los coches
  const M = hi ? 7000 : 3000;
  const sp = new Float32Array(M * 3), sSize = new Float32Array(M), sAlpha = new Float32Array(M);
  const pv = new Float32Array(M * 3), pLife = new Float32Array(M), pMax = new Float32Array(M), pS0 = new Float32Array(M), pA0 = new Float32Array(M);
  let live = 0;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const su = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 400 }, uCol: { value: new THREE.Color(night ? 0x9aa4b4 : 0xd9dee4) } };
  const spray = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: su, transparent: true, depthWrite: false, fog: true,
    vertexShader: `uniform float uScale; attribute float aSize, aAlpha; varying float vA;
      #include <fog_pars_vertex>
      void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vA = aAlpha * smoothstep(1.5, 7.0, -mvPosition.z); gl_PointSize = min(420.0, aSize * uScale / max(0.5, -mvPosition.z)); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      #include <fog_pars_fragment>
      void main() { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0; if (d > 1.0) discard; gl_FragColor = vec4(uCol, vA * (1.0 - d) * (1.0 - d));
        #include <fog_fragment>
      }`,
  }));
  // (las que pasan pegadas a la cámara se desvanecen: enormes en pantalla, eran un velo blanco en el dron)
  spray.frustumCulled = false; spray.renderOrder = 4; scene.add(spray);
  const emit = (x, y, z, vx, vy, vz, life, s0, a0 = 1) => {
    if (live >= M) return;
    const k = live++;
    sp[k * 3] = x; sp[k * 3 + 1] = y; sp[k * 3 + 2] = z; pv[k * 3] = vx; pv[k * 3 + 1] = vy; pv[k * 3 + 2] = vz;
    pLife[k] = 0; pMax[k] = life; pS0[k] = s0; pA0[k] = a0;
  };

  // ---------------------------------------------------------------- gotas en la lente (on-board)
  const cv = document.createElement('canvas'); cv.id = 'drops';
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
  document.getElementById('view').after(cv);
  const g2 = cv.getContext('2d'); const drops = []; let dropsOn = false;
  const fitCanvas = () => { cv.width = Math.round(window.innerWidth / 2); cv.height = Math.round(window.innerHeight / 2); };
  fitCanvas(); window.addEventListener('resize', fitCanvas);

  // ---------------------------------------------------------------- valores de partida (para volver a seco)
  const m = world.mat;
  const base = {
    sun: world.sun.intensity, hemi: world.hemi?.intensity ?? 0, fogC: scene.fog.color.clone(), fogN: scene.fog.near, fogF: scene.fog.far,
    env: scene.environmentIntensity,
  };
  const wetMats = [
    [m.asphalt, 0x44464a, night ? 0.2 : 0.22, night ? 1.7 : 1.1], [m.verge, 0x6a6c70, 0.3, 1.1], [m.kerb, 0xa0a0a0, 0.22, 1.1], [m.kerbY, 0xa0a0a0, 0.22, 1.1],
    [m.white, 0xc8c8c8, 0.25, 1.0], [m.paint, 0x9a9a9a, 0.35, 0.9], [m.check, 0xb0b0b0, 0.3, 0.9], [m.rubber, 0x808080, 0.3, 1.0],
    [m.grass, 0xa6b0a4, 0.75, 0.5], [m.gravel, 0x8c8a86, 0.6, 0.6], [m.terrain, 0xb4bcb0, 0.85, 0.4],
  ].filter((x) => x[0]).map(([mt, col, rough, env]) => ({ mt, c0: mt.color.clone(), c1: new THREE.Color(col).multiply(mt.color), r0: mt.roughness, r1: rough, e0: mt.envMapIntensity ?? 1, e1: env }));
  const fogWet = new THREE.Color(night ? 0x0b0d12 : 0x8b939b);
  const cloudCol = new THREE.Color(0x70757c), white = new THREE.Color(0xffffff);

  let cloud = 0, wetV = -1, tt = 0;
  const camPrev = new THREE.Vector3(), camVel = new THREE.Vector3(), tmp = new THREE.Vector3(), fwd = new THREE.Vector3();
  let first = true;

  function update(dt, sim, camType, visuals) {
    const wx = sim.wx; if (!wx) return;
    const rainAmt = wx.rain, wet = wx.line * 0.6 + wx.wet * 0.4;
    // --- cielo y luz: nubla antes de que empiece a llover y se abre despacio
    const cTarget = Math.min(1, rainAmt * 1.7 + (wx.target > 0.05 ? 0.35 : 0) + wx.wet * 0.25);
    cloud += (cTarget - cloud) * Math.min(1, dt / 6);
    if (first) cloud = cTarget;
    world.sun.intensity = base.sun * (1 - (night ? 0.18 : 0.8) * cloud);
    if (world.hemi) world.hemi.intensity = base.hemi * (1 + (night ? 0 : 0.35) * cloud);
    scene.fog.color.copy(base.fogC).lerp(fogWet, cloud * 0.9);
    scene.fog.near = lerp(base.fogN, night ? 160 : 170, Math.min(1, rainAmt * 1.3));
    scene.fog.far = lerp(base.fogF, night ? 1500 : 2100, Math.min(1, rainAmt * 1.2));
    scene.environmentIntensity = base.env * (1 - 0.35 * cloud * (night ? 0 : 1));
    if (scenery.dome) scenery.dome.material.uniforms.cloud.value = cloud;
    if (scenery.cloudMat) { scenery.cloudMat.color.copy(white).lerp(cloudCol, cloud); scenery.cloudMat.opacity = 0.9 * (1 - 0.5 * cloud); }
    // --- suelo mojado (solo se tocan los materiales si ha cambiado algo)
    if (Math.abs(wet - wetV) > 0.004) {
      wetV = wet; const k = Math.min(1, wet * 1.6);
      for (const w of wetMats) { w.mt.color.copy(w.c0).lerp(w.c1, k); w.mt.roughness = lerp(w.r0, w.r1, k); w.mt.envMapIntensity = lerp(w.e0, w.e1, k); }
    }
    // --- gotas cayendo
    const cam = camera.position;
    if (first) camPrev.copy(cam);
    tmp.copy(cam).sub(camPrev).divideScalar(Math.max(1e-3, dt)); if (tmp.length() > 120) tmp.set(0, 0, 0);
    camVel.lerp(tmp, Math.min(1, dt * 6)); camPrev.copy(cam);
    tt = (tt + dt) % 600;
    rain.visible = rainAmt > 0.02;
    if (rain.visible) {
      ru.uT.value = tt; ru.uCam.value.copy(cam); ru.uAmt.value = Math.min(1, rainAmt * 1.15);
      // la lluvia "viene" hacia la cámara cuando va rápida (velocidad relativa)
      ru.uVel.value.set(1.5 - camVel.x * 0.35, -13, 0.8 - camVel.z * 0.35);
      ru.uLen.value = 0.7 + Math.min(1.6, camVel.length() * 0.02);
    }
    // --- spray
    su.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const sw = Math.min(1, wet * 1.5);
    if (sw > 0.06 && dt > 0) {
      for (const car of sim.cars) {
        const V = visuals[car.i]; if (!V || car.out || car.state === 'garage' || car.v < 8) continue;
        const R = V.root.position; const dc = R.distanceTo(cam); if (dc > 320) continue;
        fwd.set(0, 0, 1).applyQuaternion(V.root.quaternion);
        // cuanto más agua, más agresivo: más gotas, más grandes, más altas y que duran más (con charcos, una cortina)
        // y sobre todo cuanto más rápido: despacio apenas levanta agua; a 300 km/h, cortina (antes a 110 ya tapaba el coche)
        const q = Math.min(1, Math.max(0, (car.v - 18) / 62)), qs = q * q;
        const n = sw * (1 + 1.2 * sw * sw) * qs * (hi ? 80 : 45) * dt * (dc > 150 ? 0.5 : 1);
        let cnt = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
        while (cnt-- > 0) {
          const side = Math.random() < 0.5 ? -1 : 1, back = 2.1 + Math.random() * 0.8;
          const x = R.x - fwd.x * back + fwd.z * side * 0.75, z = R.z - fwd.z * back - fwd.x * side * 0.75;
          const f = car.v * (0.12 + Math.random() * 0.2), tail = Math.random() < 0.35;   // cola alta del difusor
          const up = (0.45 + 0.55 * q) * (1 + 0.9 * sw * sw), big = (0.5 + 0.5 * q) * (1 + 0.6 * sw * sw), spread = 3 * (1 + 0.8 * sw) * (0.5 + 0.5 * q);
          emit(tail ? R.x - fwd.x * 2.4 : x, R.y + (tail ? 0.6 : 0.25) + Math.random() * 0.3, tail ? R.z - fwd.z * 2.4 : z,
            fwd.x * f + (Math.random() - 0.5) * spread, ((tail ? 3 : 1.2) + Math.random() * 2.8) * up, fwd.z * f + (Math.random() - 0.5) * spread,
            (0.6 + Math.random() * 0.9) * (0.6 + 0.4 * q) * (1 + 0.5 * sw * sw), (tail ? 1.4 : 0.9 + Math.random() * 0.8) * big, 0.45 + 0.55 * q);
        }
      }
    }
    for (let k = 0; k < live; k++) {
      pLife[k] += dt;
      if (pLife[k] >= pMax[k]) {
        // quitar: el último ocupa su hueco
        const l = --live;
        sp[k * 3] = sp[l * 3]; sp[k * 3 + 1] = sp[l * 3 + 1]; sp[k * 3 + 2] = sp[l * 3 + 2];
        pv[k * 3] = pv[l * 3]; pv[k * 3 + 1] = pv[l * 3 + 1]; pv[k * 3 + 2] = pv[l * 3 + 2];
        pLife[k] = pLife[l]; pMax[k] = pMax[l]; pS0[k] = pS0[l]; pA0[k] = pA0[l]; k--; continue;
      }
      const drag = Math.exp(-dt * 2.2);
      pv[k * 3] *= drag; pv[k * 3 + 2] *= drag; pv[k * 3 + 1] = pv[k * 3 + 1] * drag - 1.5 * dt;
      sp[k * 3] += pv[k * 3] * dt; sp[k * 3 + 1] += pv[k * 3 + 1] * dt; sp[k * 3 + 2] += pv[k * 3 + 2] * dt;
      const a = pLife[k] / pMax[k];
      sSize[k] = pS0[k] * (1 + a * 3.2); sAlpha[k] = pA0[k] * (night ? 0.2 : 0.26) * sw * (0.75 + 0.55 * sw) * (1 - a) * Math.min(1, a * 8);
    }
    sg.setDrawRange(0, live);
    if (live) { sg.attributes.position.needsUpdate = true; sg.attributes.aSize.needsUpdate = true; sg.attributes.aAlpha.needsUpdate = true; }
    // --- gotas en la lente
    const onb = ONBOARD.has(camType) && rainAmt > 0.04;
    if (onb || dropsOn) {
      const W = cv.width, H = cv.height;
      g2.clearRect(0, 0, W, H);
      if (!onb) { drops.length = 0; dropsOn = false; }
      else {
        dropsOn = true;
        const spd = Math.min(1, camVel.length() / 80);
        let n = rainAmt * 26 * dt; while (n > 0) { if (Math.random() < n) drops.push({ x: Math.random() * W, y: Math.random() * H, r: 1.5 + Math.random() * 5.5, t: 0, life: 0.8 + Math.random() * 2.2 }); n -= 1; }
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i]; d.t += dt;
          if (d.t > d.life) { drops.splice(i, 1); continue; }
          // con velocidad el aire las arrastra hacia arriba y hacia fuera
          d.y -= spd * 260 * dt * (d.r / 4); d.x += (d.x - W / 2) / W * spd * 160 * dt;
          const a = Math.min(1, (d.life - d.t) * 2) * 0.55;
          const gr = g2.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r);
          gr.addColorStop(0, `rgba(255,255,255,${a * 0.5})`); gr.addColorStop(0.6, `rgba(190,200,215,${a * 0.12})`); gr.addColorStop(1, `rgba(20,25,35,${a * 0.35})`);
          g2.fillStyle = gr; g2.beginPath(); g2.arc(d.x, d.y, d.r, 0, 6.3); g2.fill();
        }
        if (drops.length > 140) drops.splice(0, drops.length - 140);
      }
    }
    first = false;
  }
  return { update, reset() { first = true; wetV = -1; live = 0; } };
}
