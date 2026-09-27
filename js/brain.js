// Cerebro de cada piloto: lo que aprende y conserva entre sesiones (y entre fines de semana).
//  - trazada: nodos laterales cada NODE_STEP m, refinados por prueba y error en cada curva
//  - compromiso: fracción del agarre que se atreve a usar en cada curva (busca el límite)
//  - degradación estimada por compuesto (tandas largas de libres)
//  - dónde le salen los adelantamientos (bandido por curva)
import { HALF_W, CAR_HALF } from './track.js';

export const NODE_STEP = 15;
const LIM = HALF_W - CAR_HALF - 0.25;

function gauss(rng) {
  let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function newBrain(T, drv, rng) {
  const nNodes = Math.round(T.L / NODE_STEP); const step = T.L / nNodes;
  const nodes = new Float32Array(nNodes);
  const k0 = 0.7 + 0.25 * drv.know;   // la goma es su referencia: parten de ella (cada fin de semana de cero) y la afinan practicando
  // ruido suave (ondas largas): trazada torpe, pero sin zigzag en las rectas
  const waves = [0, 1, 2, 3].map(() => ({ l: 180 + rng() * 420, p: rng() * 6.28, a: (0.4 + rng()) * 0.7 * (1 - drv.know) }));
  for (let i = 0; i < nNodes; i++) {
    const ideal = T.ideal[T.idx(i * step)];
    // número entero de ondas por vuelta: la trazada cierra sin escalón en la meta
    let noise = 0; for (const w of waves) noise += w.a * Math.sin((i * step) / T.L * 6.283 * Math.max(1, Math.round(T.L / w.l)) + w.p);
    nodes[i] = Math.max(-LIM, Math.min(LIM, ideal * k0 + noise));
  }
  const nz = T.zones.length;
  const commit = new Float32Array(nz);
  for (let z = 0; z < nz; z++) commit[z] = 0.885 + 0.035 * drv.know + gauss(rng) * 0.008;
  return {
    v: 3, nodes: Array.from(nodes), commit: Array.from(commit),
    zoneBase: new Array(nz).fill(0), zoneN: new Array(nz).fill(0),
    exp: 0, acc: 0, laps: 0, mistakes: 0,
    deg: { S: { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 }, M: { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 }, H: { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 } },
    ot: new Array(nz).fill(0).map(() => ({ t: 0, w: 0 })),
    bestHist: [],   // [{w: weekend, sess, t}]
    lapHist: [],    // últimas vueltas limpias (para la gráfica)
  };
}

// Trazada por muestra a partir de los nodos (Catmull-Rom uniforme). i0/n: tramo a recalcular.
export function buildLine(T, brain, out, i0 = 0, cnt = T.N) {
  const n = brain.nodes.length, P = brain.nodes, step = T.L / n;
  for (let q = 0; q < cnt; q++) {
    const i = (i0 + q) % T.N;
    const u = (i * T.ds) / step; const j = Math.floor(u); const t = u - j;
    const p0 = P[(j - 1 + n) % n], p1 = P[j % n], p2 = P[(j + 1) % n], p3 = P[(j + 2) % n];
    const t2 = t * t, t3 = t2 * t;
    out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  return out;
}

// Curvatura real de la trazada y longitud de cada tramo (i0/cnt: tramo a recalcular).
// Ángulo entre cuerdas de 3 m ≈ seno (error < 1 % en la curva más cerrada): mucho más barato que atan2.
let PX = null, PZ = null, KT = null, SL = null;
export function lineGeometry(T, line, kOut, lenOut, i0 = 0, cnt = T.N) {
  const N = T.N, h = 3;
  if (!PX || PX.length !== N) { PX = new Float64Array(N); PZ = new Float64Array(N); KT = new Float64Array(N); SL = new Float64Array(N); }
  const full = cnt >= N;
  const a0 = full ? 0 : i0 - 14, a1 = full ? N : i0 + cnt + 14;
  const md = (q) => (q % N + N) % N;
  const x = T.x, z = T.z, lx = T.lx, lz = T.lz;
  for (let q = a0; q < a1; q++) { const i = md(q), L = line[i]; PX[i] = x[i] + lx[i] * L; PZ[i] = z[i] + lz[i] * L; }
  const c1 = full ? a1 : a1 - h;
  for (let q = a0; q < c1; q++) { const i = md(q), b = md(q + h); const dx = PX[b] - PX[i], dz = PZ[b] - PZ[i]; SL[i] = Math.sqrt(dx * dx + dz * dz); }
  const k0 = full ? 0 : a0 + h, k1 = full ? N : a1 - h - 1;
  for (let q = k0; q < k1; q++) {
    const i = md(q), a = md(q - h), b = md(q + h), n2 = md(q + 1);
    const ax = PX[i] - PX[a], az = PZ[i] - PZ[a], bx = PX[b] - PX[i], bz = PZ[b] - PZ[i];
    const la = SL[a], lb = SL[i];
    KT[i] = -(ax * bz - az * bx) / (la * lb) * 2 / (la + lb); // con (x,z) y y arriba: izquierda => cross < 0
    const ex = PX[n2] - PX[i], ez = PZ[n2] - PZ[i];
    lenOut[i] = Math.sqrt(ex * ex + ez * ez);
  }
  // suavizado corto (media de 7)
  const s0 = full ? 0 : i0, s1 = full ? N : i0 + cnt;
  let acc = 0; for (let r = -3; r <= 3; r++) acc += KT[md(s0 + r)];
  for (let q = s0; q < s1; q++) { kOut[md(q)] = acc / 7; acc += KT[md(q + 4)] - KT[md(q - 3)]; }
}

// Tramo de muestras afectado por cambiar los nodos [n0, n1]
export function nodeSpan(T, nNodes, n0, n1) {
  const step = T.L / nNodes;
  const a = Math.floor(((n0 - 2) * step) / T.ds), b = Math.ceil(((n1 + 3) * step) / T.ds);
  return [((a % T.N) + T.N) % T.N, Math.min(T.N, b - a + 1)];
}

export function degSlope(brain, c, prior) {
  const d = brain.deg[c]; if (!d) return prior;
  if (d.n < 3) return prior;
  const den = d.n * d.sxx - d.sx * d.sx;
  if (Math.abs(den) < 1e-6) return prior;
  const slope = (d.n * d.sxy - d.sx * d.sy) / den;
  const w = Math.min(1, d.n / 8);
  return prior * (1 - w) + Math.max(0, slope) * w;
}

export function addDeg(brain, c, age, t) {
  const d = brain.deg[c]; if (!d) return;
  if (d.n > 40) { d.n *= 0.9; d.sx *= 0.9; d.sy *= 0.9; d.sxx *= 0.9; d.sxy *= 0.9; }
  d.n++; d.sx += age; d.sy += t; d.sxx += age * age; d.sxy += age * t;
}

// Lo aprendido para mojado va aparte: su trazada, su compromiso por curva y sus tiempos de referencia.
// Nace de lo de seco (pero más prudente); luego cada uno aprende en sus condiciones y pasa un poco al otro.
// feel: tacto con el coche deslizando (d seco, w mojado): sube cazando derrapes y con vueltas.
export function ensureWet(brain, drv, rng) {
  if (!brain.feel) brain.feel = { d: 0.5, w: 0.15 + 0.4 * rng() };
  if (brain.wet && brain.wet.nodes.length === brain.nodes.length) return brain.wet;
  const nz = brain.commit.length;
  brain.wet = {
    nodes: brain.nodes.slice(), commit: brain.commit.map((c) => c - 0.03 - 0.025 * (1 - drv.know)),
    zoneBase: new Array(nz).fill(0), zoneN: new Array(nz).fill(0), laps: 0,
  };
  return brain.wet;
}

export { gauss };
