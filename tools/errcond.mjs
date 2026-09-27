// Errores por condición (por cada 100 vueltas): lisos en seco, lisos en mojado, gomas de agua en mojado.
// Cuenta trompos, salidas, bloqueos y derrapes cazados (la trasera se va y la recoge): node tools/errcond.mjs [track] [seeds] [sesiones]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
import { COMPOUNDS } from '../js/teams.js';
const T = buildTrack(process.argv[2] || 'gp'), seeds = +(process.argv[3] || 2), sess = (process.argv[4] || 'FP,Q1,RACE').split(',');
const agg = {};
const cond = (sim, c) => { const w = sim.wetAt(c), wt = COMPOUNDS[c.tyre.c].wet; return w < 0.06 ? (wt ? null : 'lisos/seco') : w > 0.15 ? (wt ? 'agua/mojado' : 'lisos/mojado') : null; };
const A = (k) => agg[k] || (agg[k] = { laps: 0, spin: 0, off: 0, lockup: 0, slide: 0 });
for (const wx of ['dry', 'mixed', 'wet']) for (let seed = 1; seed <= seeds; seed++) {
  const sim = new Sim(T, { seed, raceLaps: 12 }); sim.weatherMode = wx;
  sim.on((e) => {
    if (!e.car) return; const k = cond(sim, e.car); if (!k) return;
    if (e.type === 'lap') A(k).laps++;
    else if (e.type === 'mistake' && (e.kind === 'spin' || e.kind === 'off')) A(k)[e.kind]++;
    else if (e.type === 'lockup') A(k).lockup++;
  });
  const was = new Map();
  for (const id of sess) {
    sim.startSession(id);
    while (!sim.session.done) {
      sim.step();
      for (const c of sim.cars) { const on = !!c.slideOn; if (on && !was.get(c)) { const k = cond(sim, c); if (k) A(k).slide++; } was.set(c, on); }
    }
  }
}
for (const [k, a] of Object.entries(agg)) {
  const per = (x) => (a[x] / Math.max(1, a.laps) * 100).toFixed(1).padStart(5);
  console.log(`${k.padEnd(13)} vueltas ${String(a.laps).padStart(5)} | por 100 v: trompo ${per('spin')} salida ${per('off')} bloqueo ${per('lockup')} derrape ${per('slide')}`);
}
