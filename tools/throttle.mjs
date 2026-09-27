// Uso del acelerador y ritmo en libres: node tools/throttle.mjs [track] [seed]
// reparto del tiempo en pista por posición del pedal, velocidad punta y mejor vuelta
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const [track = 'gp', seed = '3'] = process.argv.slice(2);
const T = buildTrack(track);
const sim = new Sim(T, { seed: +seed });
sim.startSession('FP');
const H = [0, 0, 0, 0, 0]; let vmax = 0, n = 0, jumps = 0; const prev = new Map();
for (let k = 0; k < 60 * 700; k++) {
  sim.step();
  for (const c of sim.cars) {
    if (c.state !== 'track' || c.inPit) continue;
    if (c.v * 3.6 > vmax) vmax = c.v * 3.6;
    if (c.brake > 0.05) continue;
    const t = c.throttle; H[t < 0.25 ? 0 : t < 0.5 ? 1 : t < 0.75 ? 2 : t < 0.98 ? 3 : 4]++; n++;
    const p = prev.get(c); if (p != null && t - p > 0.5) jumps++; prev.set(c, t);
  }
}
const best = Math.min(...sim.cars.map((c) => c.best).filter(isFinite));
console.log(track, 'vmax', vmax.toFixed(1), 'mejor', best.toFixed(3), 'pedal <25/50/75/98/100 %', H.map((h) => (h / n * 100).toFixed(0)).join('/'), 'saltos>50%/paso', jumps);
