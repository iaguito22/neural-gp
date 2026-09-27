// Calidad de trazada: tiempo teórico de vuelta de cada piloto con su trazada y agarre fijo (compromiso 1)
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
import { buildLine, lineGeometry } from '../js/brain.js';
const T = buildTrack(); const sim = new Sim(T, { seed: +(process.argv[2] || 7), raceLaps: +(process.argv[3] || 20) });
function lineTime(line) {
  const k = new Float64Array(T.N), len = new Float64Array(T.N), v = new Float64Array(T.N);
  lineGeometry(T, line, k, len);
  const MU = 1.5, A = 0.0042;
  for (let i = 0; i < T.N; i++) { const kk = Math.abs(k[i]), den = kk - MU * A; v[i] = den <= 1e-6 ? 90 : Math.min(90, Math.sqrt(MU * 9.81 / den)); }
  for (let p = 0; p < 2; p++) for (let i = T.N - 1; i >= 0; i--) { const vn = v[(i + 1) % T.N]; const lim = Math.sqrt(vn * vn + 2 * 0.74 * MU * (9.81 + A * vn * vn) * len[i]); if (lim < v[i]) v[i] = lim; }
  for (let p = 0; p < 2; p++) for (let i = 0; i < T.N; i++) { const vp = v[(i - 1 + T.N) % T.N]; const lim = Math.sqrt(vp * vp + 2 * Math.min(12, 700000 / (800 * Math.max(vp, 5))) * len[i]); if (lim < v[i]) v[i] = lim; }
  let t = 0; for (let i = 0; i < T.N; i++) t += len[i] / v[i]; return t;
}
const stat = (tag) => { const ts = sim.cars.map((c) => lineTime(buildLine(T, c.brain, new Float64Array(T.N)))); ts.sort((a, b) => a - b);
  console.log(tag.padEnd(10), 'trazada media', (ts.reduce((a, b) => a + b) / ts.length).toFixed(2), 'mejor', ts[0].toFixed(2), 'peor', ts[ts.length - 1].toFixed(2), '| óptima ≈ 76.5'); };
stat('inicio');
const t0 = Date.now();
for (const id of ['FP', 'Q1', 'Q2', 'Q3', 'RACE']) {
  sim.startSession(id); while (!sim.session.done) sim.step();
  const b = sim.classification().filter((c) => isFinite(c.best)).map((c) => c.best);
  stat(id); console.log('           vueltas: mejor', Math.min(...b).toFixed(2), 'media', (b.reduce((a, c) => a + c) / b.length).toFixed(2), 'imitaciones', sim.cars.reduce((a, c) => a + (c.brain.imit || 0), 0), 'wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
let ot = {}; for (const c of sim.cars) for (const o of c.brain.ot) if (o.p) for (const k in o.p) { ot[k] = ot[k] || { t: 0, w: 0 }; ot[k].t += o.p[k].t; ot[k].w += o.p[k].w; }
console.log('planes de ataque en carrera (éxitos/intentos):', JSON.stringify(ot));
