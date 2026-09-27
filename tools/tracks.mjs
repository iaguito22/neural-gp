// Comprueba los circuitos: longitud, curvas, separación mínima entre tramos, rectas de DRS y zona de boxes
import { buildTrack, CIRCUITS, HALF_W } from '../js/track.js';
for (const id of Object.keys(CIRCUITS)) {
  const T = buildTrack(id);
  let minSep = 1e9, at = null;
  for (let i = 0; i < T.N; i += 3) for (let j = 0; j < T.N; j += 3) {
    if (Math.abs(T.rel(i * T.ds, j * T.ds)) < 150) continue;
    const d = Math.hypot(T.x[i] - T.x[j], T.z[i] - T.z[j]); if (d < minSep) { minSep = d; at = [i, j]; }
  }
  let kmax = 0; for (let i = 0; i < T.N; i++) kmax = Math.max(kmax, Math.abs(T.k[i]));
  // recta de boxes: curvatura máxima en [-560, 730]
  let kp = 0; for (let s = -560; s < 730; s += 2) kp = Math.max(kp, Math.abs(T.k[T.idx(s)]));
  console.log(id, 'L', T.L.toFixed(0), 'curvas', T.corners.length, 'Rmin', (1 / kmax).toFixed(0), 'sep mín', minSep.toFixed(0), at?.map(q => (q * T.ds).toFixed(0)).join('/'), 'Rmin recta boxes', (1 / kp).toFixed(0),
    'DRS', T.drs.map(z => T.ahead(z.a, z.b).toFixed(0)).join('+'), 'radios', T.corners.map(c => c.radius.toFixed(0)).join(' '));
}
