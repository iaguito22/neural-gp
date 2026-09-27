// Histograma de deslizamiento: máximo |beta| por paso de curva, y tiempo con exceso de agarre
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(args.track);
const sim = new Sim(T, { seed: +(args.seed || 3), raceLaps: +(args.laps || 12) });
const ev = {}; sim.on(e => { if (e.type === 'mistake') ev[e.kind] = (ev[e.kind] || 0) + 1; if (e.type === 'retire') ev['ret:' + e.why] = (ev['ret:' + e.why] || 0) + 1; if (e.type === 'contact' && e.wall) ev.wall = (ev.wall || 0) + 1; });
const bins = [0.01, 0.03, 0.06, 0.1, 0.2, 0.3, 0.45]; const hist = new Array(bins.length + 1).fill(0);
for (const id of (args.only || 'FP').split(',')) {
  sim.startSession(id);
  const mx = new Map();
  let n = 0;
  while (!sim.session.done && n < 60 * 60 * 60) {
    sim.step(); n++;
    for (const c of sim.cars) {
      if (c.zoneIn >= 0) mx.set(c, Math.max(mx.get(c) || 0, Math.abs(c.beta)));
      else if (mx.has(c)) { const b = mx.get(c); let k = 0; while (k < bins.length && b >= bins[k]) k++; hist[k]++; mx.delete(c); }
    }
  }
  console.log(id, 'simT', sim.t.toFixed(0), JSON.stringify(ev));
}
console.log('max beta por curva:', bins.map((b, k) => `<${b}:${hist[k]}`).join(' '), `>=0.45:${hist[bins.length]}`);
