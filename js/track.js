// Circuito: geometría pura (sin three.js) para que la simulación corra también en node.
// Convención: s = metros a lo largo del eje, d = desplazamiento lateral (+ = izquierda del sentido de marcha).

export const HALF_W = 9;          // pista de 18 m: ancha, para adelantar
import { IDEAL_NODES } from './idealNodes.js';
export const CAR_HALF = 1.0;      // medio ancho del coche
export const PIT_D = -24;         // eje del pit lane (a la derecha de la recta)
export const PIT_WALL_D = -13;    // muro que separa pista y pit lane

// Trazado (x, z) en metros. Sentido de marcha: el del array.
const CONTROL = [
  [150, 0], [500, 0], [850, 0],
  [960, 8], [1012, 55], [1002, 112], [950, 142],          // T1 horquilla
  [860, 162], [760, 186],
  [700, 242], [712, 320], [662, 392], [652, 462],         // eses
  [702, 522], [800, 552],
  [1050, 566], [1300, 580],                               // recta de atrás
  [1384, 612], [1404, 664], [1384, 714], [1400, 764],     // chicane
  [1362, 802], [1262, 832],
  [1000, 838], [700, 832], [480, 822],                    // recta norte
  [332, 792], [242, 722],
  [232, 642], [152, 582], [132, 502],                     // chicane lenta
  [42, 442], [-120, 402], [-262, 322], [-342, 202],       // curvones rápidos
  [-352, 90], [-302, 22], [-200, 0],                      // última curva
];

export const CORNER_NAMES = [];

// Circuitos urbano y nocturno: polígono de vértices [x, z, radio]. La pista sale de (0,0) hacia +x (recta de meta),
// redondea cada vértice con su radio y vuelve por la última recta. El lado +z (derecha) es el interior: boxes y paddock.
// Urbano estilo Yeda: curvas enlazadas de ángulos variados (ninguna en L), dos horquillas tras rectas largas para adelantar
const URBAN = [
  [1150, 0, 24], [1000, 210, 70], [1080, 430, 150], [1300, 560, 110], [1330, 820, 60], [1150, 1010, 60],
  [900, 1000, 200], [700, 900, 80], [480, 960, 80], [250, 880, 90], [60, 960, 150], [-560, 960, 20],
  [-330, 780, 55], [-420, 560, 100], [-700, 420, 120], [-900, 210, 90], [-760, 0, 60],
]
const DESERT = [
  [980, 0, 70], [1320, 260, 95], [1380, 660, 24], [1260, 740, 24], [1020, 470, 60], [760, 540, 45],
  [620, 820, 85], [180, 930, 160], [-260, 820, 60], [-380, 560, 40], [-160, 410, 32], [-420, 250, 50],
  [-780, 260, 38], [-860, 0, 48],
];

// Montaña al atardecer: curvas enlazadas de radios variados, una horquilla y dos curvones rápidos; nada en L
const MOUNT = [
  [1200, 0, 50], [1330, 250, 220], [1150, 520, 90], [1320, 760, 140], [1100, 1000, 110], [700, 1080, 300], [320, 1240, 35],
  [420, 960, 110], [230, 820, 120], [20, 860, 70], [-120, 780, 90], [-300, 900, 65], [-620, 760, 200], [-420, 300, 70],
  [-700, 20, 90], [-420, -20, 200],
];

export const CIRCUITS = {
  gp: { id: 'gp', name: 'Neural Park', place: 'Circuito permanente · de día', laps: 20 },
  urban: { id: 'urban', name: 'Porto Cidade', place: 'Urbano rápido junto al puerto · de día', urban: true, poly: URBAN, elev: 0.35 },
  night: { id: 'night', name: 'Al Noor', place: 'Desierto · carrera de noche', night: true, poly: DESERT, elev: 0.7 },
  mount: { id: 'mount', name: 'Monte Alto', place: 'Montaña · al atardecer', sunset: true, poly: MOUNT, elev: 2.4 },
};

// Polígono con esquinas redondeadas -> puntos de control densos (arcos cada ~8 m, rectas cada ~60 m)
function filletPath(poly) {
  const V = poly.map(([x, z]) => [x, z]), n = V.length, pts = [];
  const norm = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };
  const line = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / 60)); for (let q = 0; q < k; q++) pts.push([a[0] + (b[0] - a[0]) * q / k, a[1] + (b[1] - a[1]) * q / k]); };
  let cur = [0, 0];
  const all = [[0, 0], ...V];
  for (let k = 1; k <= n; k++) {
    const A = all[k - 1], P = all[k], B = k < n ? all[k + 1] : [0, 0], R = poly[k - 1][2];
    const u = norm([P[0] - A[0], P[1] - A[1]]), w = norm([B[0] - P[0], B[1] - P[1]]);
    const th = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])));
    const t = R * Math.tan(th / 2);
    const p0 = [P[0] - u[0] * t, P[1] - u[1] * t];
    line(cur, p0);
    const turn = Math.sign(u[0] * w[1] - u[1] * w[0]);
    const c = [p0[0] - u[1] * R * turn, p0[1] + u[0] * R * turn];   // centro del arco
    const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]), m = Math.max(2, Math.ceil(R * th / 8));
    for (let q = 0; q < m; q++) { const a = a0 + turn * th * q / m; pts.push([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R]); }
    cur = [P[0] + w[0] * t, P[1] + w[1] * t];
  }
  line(cur, [0, 0]);
  return pts;
}

function catmull(p0, p1, p2, p3, t) {
  // Catmull-Rom centrípeta
  const a = 0.5;
  const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), a) || 1e-4;
  const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), a) || 1e-4;
  const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), a) || 1e-4;
  const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
  const tt = t1 + (t2 - t1) * t;
  const out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const A1 = (t1 - tt) / (t1 - t0) * p0[k] + (tt - t0) / (t1 - t0) * p1[k];
    const A2 = (t2 - tt) / (t2 - t1) * p1[k] + (tt - t1) / (t2 - t1) * p2[k];
    const A3 = (t3 - tt) / (t3 - t2) * p2[k] + (tt - t2) / (t3 - t2) * p3[k];
    const B1 = (t2 - tt) / (t2 - t0) * A1 + (tt - t0) / (t2 - t0) * A2;
    const B2 = (t3 - tt) / (t3 - t1) * A2 + (tt - t1) / (t3 - t1) * A3;
    out[k] = (t2 - tt) / (t2 - t1) * B1 + (tt - t1) / (t2 - t1) * B2;
  }
  return out;
}

function smoothArr(a, r, passes = 1) {
  const n = a.length;
  let src = Float64Array.from(a);
  for (let p = 0; p < passes; p++) {
    const dst = new Float64Array(n);
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += src[(j + n) % n];
    for (let i = 0; i < n; i++) {
      dst[i] = acc / (2 * r + 1);
      acc += src[(i + r + 1) % n] - src[(i - r + n) % n];
    }
    src = dst;
  }
  return src;
}

export function buildTrack(id = 'gp') {
  const meta = CIRCUITS[id] || CIRCUITS.gp;
  const CP = meta.poly ? filletPath(meta.poly) : CONTROL;
  // 1) curva densa
  const dense = [];
  const n = CP.length;
  for (let i = 0; i < n; i++) {
    const p0 = CP[(i - 1 + n) % n], p1 = CP[i], p2 = CP[(i + 1) % n], p3 = CP[(i + 2) % n];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(8, Math.ceil(seg / 0.5));
    for (let k = 0; k < steps; k++) dense.push(catmull(p0, p1, p2, p3, k / steps));
  }
  // 2) remuestreo cada 1 m
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const N = Math.round(total);
  const ds = total / N;
  let x = new Float64Array(N), z = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = i * ds;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
    const a = dense[j], b = dense[(j + 1) % dense.length];
    x[i] = a[0] + (b[0] - a[0]) * f;
    z[i] = a[1] + (b[1] - a[1]) * f;
  }
  x = smoothArr(x, 2, 2); z = smoothArr(z, 2, 2);

  // 3) tangentes, normales izquierda y curvatura con signo (+ = gira a la izquierda)
  const tx = new Float64Array(N), tz = new Float64Array(N), lx = new Float64Array(N), lz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let dx = x[b] - x[a], dz = z[b] - z[a];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz;
    // izquierda con y arriba: left = (fz, 0, -fx)
    lx[i] = dz; lz[i] = -dx;
  }
  let k = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N, b = (i + 3) % N;
    const dtx = (tx[b] - tx[a]) / (6 * ds), dtz = (tz[b] - tz[a]) / (6 * ds);
    k[i] = dtx * lx[i] + dtz * lz[i];
  }
  k = smoothArr(k, 4, 2);

  // 4) altimetría suave (m)
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = (i / N) * Math.PI * 2;
    y[i] = (meta.elev ?? 1) * (3.2 * Math.sin(u + 2.4) + 2.2 * Math.sin(2 * u + 0.3) + 1.1 * Math.sin(5 * u + 1.9)) + 6;
  }
  // banking suave en curvas rápidas (radianes, positivo = inclina hacia el interior)
  const bank = new Float64Array(N);
  const bk = meta.urban ? 0.3 : 1; // en la ciudad las calles apenas tienen peralte
  for (let i = 0; i < N; i++) bank[i] = bk * Math.max(-0.05, Math.min(0.05, k[i] * 2.2));
  const bankS = smoothArr(bank, 20, 2);

  const T = {
    N, L: N * ds, ds, x, z, y, tx, tz, lx, lz, k, bank: bankS,
    halfW: HALF_W, id: meta.id, meta,
  };
  T.wrap = (s) => ((s % T.L) + T.L) % T.L;
  T.idx = (s) => { const i = Math.floor(T.wrap(s) / ds); return i >= N ? 0 : i; };
  T.lerp = (arr, s) => {
    const u = T.wrap(s) / ds; const i = Math.floor(u) % N; const f = u - Math.floor(u);
    return arr[i] * (1 - f) + arr[(i + 1) % N] * f;
  };
  // posición mundo de (s,d)
  T.pos = (s, d, out = [0, 0, 0]) => {
    const u = T.wrap(s) / ds; const i = Math.floor(u) % N; const f = u - Math.floor(u); const i2 = (i + 1) % N;
    const cx = x[i] * (1 - f) + x[i2] * f, cz = z[i] * (1 - f) + z[i2] * f;
    const Lx = lx[i] * (1 - f) + lx[i2] * f, Lz = lz[i] * (1 - f) + lz[i2] * f;
    const b = bankS[i] * (1 - f) + bankS[i2] * f;
    out[0] = cx + Lx * d; out[2] = cz + Lz * d;
    out[1] = y[i] * (1 - f) + y[i2] * f + (Math.abs(d) <= HALF_W + 0.5 ? -b * d : -b * Math.sign(d) * HALF_W);
    return out;
  };
  // diferencia de s hacia delante (b delante de a)
  T.ahead = (a, b) => { let dd = b - a; dd -= Math.floor(dd / T.L) * T.L; return dd; };
  T.rel = (a, b) => { let dd = T.ahead(a, b); if (dd > T.L / 2) dd -= T.L; return dd; };

  detectCorners(T);
  buildZones(T);
  T.ideal = storedIdeal(T) || idealLine(T);
  T.sectors = [0, Math.round(T.L * 0.34), Math.round(T.L * 0.68)];
  buildPit(T);
  buildDRS(T);
  buildRunoff(T);
  T.speedTraps = Math.round(T.pit.boxes[0].s + 200);
  return T;
}

function detectCorners(T) {
  const { N, k } = T;
  const TH = 1 / 260;
  const corners = [];
  let i = 0;
  // arrancar en una recta
  let start = 0; while (Math.abs(k[start]) > TH) start++;
  for (let c = 0; c < N; c++) {
    const idx = (start + c) % N;
    if (Math.abs(k[idx]) > TH) {
      let e = c;
      while (e < N && Math.abs(k[(start + e) % N]) > TH) e++;
      let apex = idx, best = 0, area = 0;
      for (let q = c; q < e; q++) { const ii = (start + q) % N; area += k[ii]; if (Math.abs(k[ii]) > best) { best = Math.abs(k[ii]); apex = ii; } }
      const len = e - c;
      if (Math.abs(area) * T.ds > 0.18 || best > 1 / 60) {
        const prev = corners[corners.length - 1];
        const sIn = idx * T.ds, sOut = ((start + e) % N) * T.ds;
        // fusionar con la anterior si el hueco es mínimo y mismo sentido
        if (prev && T.ahead(prev.sOut, sIn) < 25 && Math.sign(prev.dir) === Math.sign(area)) {
          prev.sOut = sOut; prev.len += len; if (best > prev.kmax) { prev.kmax = best; prev.apex = apex * T.ds; }
          prev.angle += area * T.ds;
        } else {
          corners.push({ sIn, sOut, apex: apex * T.ds, kmax: best, dir: Math.sign(area), len, angle: area * T.ds });
        }
      }
      c = e;
    }
  }
  corners.sort((a, b) => a.sIn - b.sIn);
  corners.forEach((c, n) => { c.id = n; c.name = 'T' + (n + 1); c.radius = 1 / c.kmax; });
  T.corners = corners;
}

// Zonas de aprendizaje: cada curva desde 160 m antes hasta 120 m después
function buildZones(T) {
  const zones = [];
  const cs = T.corners;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const prev = cs[(i - 1 + cs.length) % cs.length];
    const next = cs[(i + 1) % cs.length];
    let a = T.wrap(c.sIn - 150);
    const gapPrev = T.ahead(prev.sOut, c.sIn);
    if (gapPrev < 300) a = T.wrap(prev.sOut + gapPrev * 0.5);
    let b = T.wrap(c.sOut + 120);
    const gapNext = T.ahead(c.sOut, next.sIn);
    if (gapNext < 300) b = T.wrap(c.sOut + gapNext * 0.5);
    zones.push({ id: i, a, b, corner: c, len: T.ahead(a, b) });
  }
  T.zones = zones;
  // zona de cada muestra (-1 = recta)
  T.zoneOf = new Int16Array(T.N).fill(-1);
  for (const z of zones) for (let q = 0; q < z.len; q++) T.zoneOf[T.idx(z.a + q)] = z.id;
  // siguiente curva desde cada muestra (para decidir adelantamientos)
  T.nextCorner = new Int16Array(T.N);
  for (let i = 0; i < T.N; i++) {
    const s = i * T.ds; let best = 0, bd = 1e9;
    for (const c of cs) { const dd = T.ahead(s, c.sIn); if (dd < bd) { bd = dd; best = c.id; } }
    T.nextCorner[i] = best;
  }
}

// Trazada ideal optimizada por tiempo de vuelta (tools/ideal.mjs), si corresponde a este trazado
function storedIdeal(T) {
  const st = IDEAL_NODES[T.id];
  if (!st || Math.abs(st.L - T.L) > 0.5) return null;
  const P = st.nodes, n = P.length, step = T.L / n, out = new Float64Array(T.N);
  for (let i = 0; i < T.N; i++) {   // Catmull-Rom uniforme, igual que las trazadas de los pilotos
    const u = (i * T.ds) / step, j = Math.floor(u), t = u - j;
    const p0 = P[(j - 1 + n) % n], p1 = P[j % n], p2 = P[(j + 1) % n], p3 = P[(j + 2) % n], t2 = t * t, t3 = t2 * t;
    out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  return out;
}

// Trazada de mínima curvatura (si no hay una optimizada guardada) (conocimiento "de libro" que los pilotos refinan practicando)
export function idealLine(T, lim = HALF_W - CAR_HALF - 0.3) {
  const { N, x, z, lx, lz } = T;
  // lim: margen al borde
  const d = new Float64Array(N);
  for (const h of [40, 24, 14, 8, 5]) {
    for (let it = 0; it < 220; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - h + N) % N, b = (i + h) % N;
        const pax = x[a] + lx[a] * d[a], paz = z[a] + lz[a] * d[a];
        const pbx = x[b] + lx[b] * d[b], pbz = z[b] + lz[b] * d[b];
        const mx = (pax + pbx) / 2, mz = (paz + pbz) / 2;
        const px = x[i] + lx[i] * d[i], pz = z[i] + lz[i] * d[i];
        let nd = d[i] + ((mx - px) * lx[i] + (mz - pz) * lz[i]) * 0.5;
        d[i] = Math.max(-lim, Math.min(lim, nd));
      }
    }
  }
  return smoothArr(d, 3, 2);
}

function buildPit(T) {
  // la recta principal es s ∈ [L-~350, ~850]; el pit lane va a la derecha
  const L = T.L;
  const pit = {
    entryA: T.wrap(-560), entryB: T.wrap(-380), // rampa de entrada (d: línea -> PIT_D)
    limitA: T.wrap(-330), limitB: 420,          // zona de 80 km/h
    exitA: 470, exitB: 700,                     // rampa de salida
    d: PIT_D, wallD: PIT_WALL_D, speed: 80 / 3.6,
    boxes: [],
  };
  // 11 boxes, uno por equipo, del primero (cerca de la entrada) al último
  for (let i = 0; i < 11; i++) pit.boxes.push({ s: T.wrap(-250 + i * 55), d: PIT_D - 3.5 });
  pit.fastD = PIT_D + 2.5;
  pit.edgeD = -HALF_W + 1.9;                    // centro del carril cuando aún va pegado al borde de la pista
  // desde aquí el coche que entra se pega a la derecha: todo lo que dé la recta (120-250 m), para que no cruce la pista de golpe
  let back = 120;
  while (back < 250 && Math.abs(T.k[T.idx(pit.entryA - back - 10)]) < 0.004) back += 10;
  pit.decide = T.wrap(pit.entryA - back);
  pit.halfW = 3.3;                              // medio ancho del carril (entrada, rápido y salida)
  // eje del carril de boxes: sale del borde derecho, corre paralelo a la recta y vuelve a él
  const sm = (f) => { f = Math.min(1, Math.max(0, f)); return f * f * (3 - 2 * f); };
  pit.laneD = (s) => {
    if (between(T, s, pit.entryA, pit.entryB)) return pit.edgeD + (pit.fastD - pit.edgeD) * sm(T.ahead(pit.entryA, s) / T.ahead(pit.entryA, pit.entryB));
    if (between(T, s, pit.exitA, pit.exitB)) return pit.fastD + (pit.edgeD - pit.fastD) * sm(T.ahead(pit.exitA, s) / T.ahead(pit.exitA, pit.exitB));
    return pit.fastD;
  };
  T.pit = pit;
  // parrilla: P1 en s = -12, cada 8 m, alterna lados
  T.grid = [];
  for (let p = 0; p < 22; p++) T.grid.push({ s: T.wrap(-14 - p * 8.5), d: p % 2 === 0 ? 3.2 : -3.2 });
}

function buildDRS(T) {
  // las dos rectas más largas
  const cs = T.corners; const straights = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i].sOut, b = cs[(i + 1) % cs.length].sIn;
    straights.push({ a, b, len: T.ahead(a, b) });
  }
  straights.sort((p, q) => q.len - p.len);
  T.drs = straights.slice(0, 2).map((st) => ({
    detect: T.wrap(st.a - 90), a: T.wrap(st.a + 60), b: T.wrap(st.b - 60),
  }));
  T.inDRS = new Uint8Array(T.N);
  T.drs.forEach((z, n) => { for (let q = 0; q < T.ahead(z.a, z.b); q++) T.inDRS[T.idx(z.a + q)] = n + 1; });
}

// ¿s está entre a y b yendo hacia delante?
// Escapatorias: anchura hasta la barrera a cada lado y tipo de superficie (0 hierba, 1 grava, 2 asfalto pintado, 3 boxes)
function buildRunoff(T) {
  const STEP = 2, M = Math.floor(T.L / STEP), P = [0, 0, 0];
  const smooth = (a, r, loops) => { let src = Float32Array.from(a); const n = a.length; for (let p = 0; p < loops; p++) { const dst = new Float32Array(n); for (let i = 0; i < n; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += src[(i + j + n) % n]; dst[i] = acc / (2 * r + 1); } src = dst; } return src; };
  const kAbs = new Float32Array(M), kSgn = new Float32Array(M);
  for (let i = 0; i < M; i++) { const k = T.k[T.idx(i * STEP)]; kAbs[i] = Math.abs(k); kSgn[i] = k; }
  const kS = smooth(kSgn, 25, 2);
  const BL = new Float32Array(M), BR = new Float32Array(M), typeL = new Uint8Array(M), typeR = new Uint8Array(M);
  // tipos: 0 hierba, 1 grava, 2 asfalto pintado, 3 zona de boxes
  for (let i = 0; i < M; i++) {
    const s = i * STEP;
    const k = kS[i];
    const outside = k > 0 ? -1 : 1;              // gira a la izquierda -> fuera = derecha (d<0)
    const big = Math.min(30, Math.abs(k) * 2600);
    let wOut = 9 + big, wIn = 7 + big * 0.25;
    const slow = Math.abs(k) > 1 / 70;
    let tOut = big > 8 ? (slow ? 2 : 1) : 0, tIn = 0;
    if (T.meta.urban) {
      // calles: el muro se acerca y se aleja (avenidas, plazas, bocacalles); por fuera de las curvas lentas y medias,
      // escapatoria asfaltada; en las rectas rápidas, muro cerca
      const street = 0.5 + 0.5 * Math.sin(s / 173 + 1.1) * Math.sin(s / 61 + 0.4);
      const open = 0.35 + 0.65 * Math.max(0, Math.sin(s / 410 + 2.0));
      wOut = 3 + 6 * street * open + (Math.abs(k) > 1 / 220 ? Math.min(20, big * 0.85) : 0);
      wIn = 2.4 + 4 * (1 - street) * open;
      tOut = 2; tIn = 2;
    } else if (T.meta.night) {
      // desierto: escapatorias de asfalto pintado y arena (tipo 0) más allá
      tOut = big > 8 ? 2 : 0;
    }
    BL[i] = HALF_W + (outside === 1 ? wOut : wIn);
    BR[i] = HALF_W + (outside === -1 ? wOut : wIn);
    typeL[i] = outside === 1 ? tOut : tIn; typeR[i] = outside === -1 ? tOut : tIn;
  }
  // no invadir otras partes del circuito: limitar por distancia a muestras lejanas
  const cell = 40, grid = new Map();
  const key = (x, z) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
  for (let i = 0; i < T.N; i += 4) { const k = key(T.x[i], T.z[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const nearest = (x, z, maxR = 6) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = 1e9, bi = -1;
    for (let r = 0; r <= maxR; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const lst = grid.get((cx + a) * 100003 + cz + b); if (!lst) continue;
        for (const i of lst) { const dd = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2; if (dd < best) { best = dd; bi = i; } }
      }
      if (bi >= 0 && Math.sqrt(best) < (r - 1) * cell) break;
    }
    return { i: bi, d: Math.sqrt(best) };
  };
  T.nearest = nearest;
  for (let i = 0; i < M; i++) {
    const s = i * STEP;
    for (const side of [1, -1]) {
      const arr = side === 1 ? BL : BR;
      for (let d = Math.min(HALF_W + 4, arr[i]); d < arr[i] + 8; d += 3) {
        T.pos(s, side * d, P);
        const n = nearest(P[0], P[2], 2);
        if (n.i >= 0 && Math.abs(T.rel(s, n.i * T.ds)) > 120 && n.d < HALF_W + 10 + (d - HALF_W) * 0.3) { arr[i] = Math.max(Math.min(arr[i], HALF_W + 4), (d - HALF_W) * 0.5 + HALF_W); break; }
      }
    }
  }
  // boxes: lado derecho de la recta principal
  const pit = T.pit;
  for (let i = 0; i < M; i++) {
    const s = i * STEP;
    if (between(T, s, T.wrap(pit.entryA - 20), T.wrap(pit.exitB + 30))) { BR[i] = 34; typeR[i] = 3; }
  }
  const BLs = smooth(BL, 6, 2), BRs = smooth(BR, 6, 2);
  for (let i = 0; i < M; i++) { if (typeR[i] === 3) BRs[i] = 34; }
  T.runoff = { kS, BL: BLs, BR: BRs, typeL, typeR, STEP, M };
  T.barrier = (s, side) => { const i = Math.floor(T.wrap(s) / STEP) % M; return side > 0 ? BLs[i] : BRs[i]; };
  T.surface = (s, side) => { const i = Math.floor(T.wrap(s) / STEP) % M; return side > 0 ? typeL[i] : typeR[i]; };
  // muro contra el que choca un coche (en la recta de boxes, el muro del pit; en las rampas, la valla del fondo)
  const wA = T.wrap(pit.entryB + 20), wB = T.wrap(pit.exitA - 20);
  T.wall = (s, side) => (side < 0 && between(T, s, wA, wB) ? -PIT_WALL_D - 0.4 : T.barrier(s, side));
}

export function between(T, s, a, b) { return T.ahead(a, s) <= T.ahead(a, b); }
