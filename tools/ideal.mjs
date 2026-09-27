// Trazada ideal de verdad: optimiza por tiempo de vuelta los nodos laterales (cada 10 m) de cada circuito
// con un modelo sencillo de coche (agarre + carga aerodinámica, frenada y tracción limitadas) y la guarda en
// js/idealNodes.js. Es lo que se dibuja como goma, la línea discontinua del panel de aprendizaje y el punto de
// partida de los pilotos. Volver a ejecutar si cambia el trazado de un circuito: node tools/ideal.mjs
import { buildTrack, HALF_W, CAR_HALF } from '../js/track.js';
import { buildLine, lineGeometry } from '../js/brain.js';
import { gearPower } from '../js/sim.js';
import fs from 'fs';
import { IDEAL_NODES } from '../js/idealNodes.js';
const LIM = HALF_W - CAR_HALF - 1.1;
// nodos cada 10 m (más finos que los de los pilotos): con 20 m no le daba para cruzar de fuera a dentro en las curvas lentas
const NS = +(process.env.NS || 10), SC = 20 / NS;   // baches y penalización igual que con 20 m, en metros
const LAM = +(process.env.LAM || 0);   // peso extra de la curvatura (0: solo tiempo)
const STEPS = [[6, 3], [4, 2], [3, 1.5], [2, 1], [1.2, 0.6], [2, 0.4], [1, 0.3], [0.7, 0.15]];   // margen: la de libro no va rozando la línea blanca
const out = { ...IDEAL_NODES };   // los circuitos que no se recalculan se conservan
for (const id of (process.argv[2] || 'gp,urban,night').split(',')) {
  const T = buildTrack(id), N = T.N;
  const n = Math.round(T.L / NS), step = T.L / n;
  const k = new Float64Array(N), len = new Float64Array(N), v = new Float64Array(N), line = new Float64Array(N);
  // el mismo modelo que usa el juego (sim.js): agarre repartido entre frenar/acelerar y girar (elipse), carga
  // aerodinámica, frenada y tracción limitadas, potencia y resistencia; si no, la «ideal» frenaría dentro de la curva
  const G = 9.81, MU = 1.53, A = 0.0038, MASS = 800, CD = 0.96, ROLL = 160, BRK = 0.67, TRAC = 0.58, PW = 770 * 1000 * 0.96;
  const ell = (r) => (r >= 0.993 ? 0.12 : Math.max(0.12, Math.sqrt(1 - r * r)));
  const wN = Float64Array.from({ length: n }, (_, j) => (T.corners.some((c) => T.ahead(c.sIn - 80, j * step) <= T.ahead(c.sIn - 80, c.sOut + 60)) ? 0.004 : 0.004));
  const time = (nodes) => {
    buildLine(T, { nodes }, line); lineGeometry(T, line, k, len);
    for (let i = 0; i < N; i++) { const kk = Math.abs(k[i]), den = kk - MU * A; v[i] = den <= 1e-6 ? 110 : Math.min(110, Math.sqrt(MU * G / den)); }
    for (let p = 0; p < 2; p++) for (let i = N - 1; i >= 0; i--) {
      const vn = v[(i + 1) % N], cap = MU * (G + A * vn * vn);
      const dec = BRK * cap * ell(vn * vn * Math.abs(k[i]) / cap) + (CD * vn * vn + ROLL) / MASS;
      const lim = Math.sqrt(vn * vn + 2 * dec * len[i]); if (lim < v[i]) v[i] = lim;
    }
    for (let p = 0; p < 2; p++) for (let i = 0; i < N; i++) {
      const vp = v[(i - 1 + N) % N], cap = MU * (G + A * vp * vp);
      const acc = Math.min(TRAC * cap * ell(vp * vp * Math.abs(k[i]) / cap), PW * gearPower(vp) / (MASS * Math.max(vp, 8))) - (CD * vp * vp + ROLL) / MASS;
      const lim = Math.sqrt(Math.max(0, vp * vp + 2 * acc * len[i])); if (lim < v[i]) v[i] = lim;
    }
    let t = 0; for (let i = 0; i < N; i++) t += len[i] / v[i];
    // suavidad: sin la penalización, en las rectas (donde el modelo no pierde nada) la línea haría eses
    // (en las curvas casi nada: si no, en las lentas no se atrevía a cruzar de fuera a dentro y se quedaba abierta)
    let w = 0; for (let j = 0; j < n; j++) { const a = nodes[(j - 1 + n) % n], b = nodes[j], c = nodes[(j + 1) % n]; w += (a - 2 * b + c) ** 2 * wN[j] * SC ** 3; }
    return t + w;
  };
  // energía de curvatura (Σ k²·ds): la trazada de mínima curvatura, exterior-interior-exterior de libro
  const bend = (nodes) => {
    buildLine(T, { nodes }, line); lineGeometry(T, line, k, len);
    let e = 0; for (let i = 0; i < N; i++) e += k[i] * k[i] * len[i];
    return e * 1000;
  };
  const optimise = (nodes, time, steps = STEPS) => {
    let best = time(nodes); const t0 = best;
    const bak = new Float64Array(n);
    // movimientos suaves: un «bache» gaussiano de anchura w nodos centrado en cada nodo (anchos primero, luego finos)
    for (let [w, h] of steps) {
      w *= SC; const R = Math.ceil(w * 2.5);
      for (let sweep = 0; sweep < 10; sweep++) {
        let imp = false;
        for (let j = 0; j < n; j++) {
          for (const dv of [h, -h]) {
            for (let q = -R; q <= R; q++) { const m = (j + q + n) % n; bak[m] = nodes[m]; nodes[m] = Math.max(-LIM, Math.min(LIM, nodes[m] + dv * Math.exp(-(q * q) / (2 * w * w)))); }
            const t = time(nodes);
            if (t < best - 1e-5) { best = t; imp = true; break; }
            for (let q = -R; q <= R; q++) { const m = (j + q + n) % n; nodes[m] = bak[m]; }
          }
        }
        if (!imp) break;
      }
    }
    return { nodes, t: best, t0 };
  };
  const MODE = process.env.MODE || 'mix';   // bend: solo mínima curvatura · mix: arranca de ella y optimiza el tiempo
  const w0 = Date.now();
  const mc = optimise(new Float64Array(n), bend);
  console.log(id, 'curvatura', mc.t0.toFixed(1), '->', mc.t.toFixed(1), 'tiempo', time(mc.nodes).toFixed(2));
  let { nodes, t: best, t0 } = MODE === 'bend' ? { ...mc, t: time(mc.nodes), t0: time(new Float64Array(n)) } : optimise(mc.nodes, (x) => time(x) + LAM * bend(x));
  console.log(id, 'tiempo puro', time(nodes).toFixed(2), 'curvatura', bend(nodes).toFixed(1));
  console.log(id, 'mejor arranque', t0.toFixed(2), '-> ideal', best.toFixed(2), `(${((Date.now() - w0) / 1000).toFixed(0)} s)`);
  out[id] = { L: +T.L.toFixed(1), nodes: Array.from(nodes, (x) => +x.toFixed(2)) };
}
fs.writeFileSync(new URL('../js/idealNodes.js', import.meta.url), '// generado por tools/ideal.mjs: trazada ideal (m desde el centro) cada 10 m, por circuito\nexport const IDEAL_NODES = ' + JSON.stringify(out) + ';\n');
