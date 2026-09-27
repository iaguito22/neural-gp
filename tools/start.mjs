import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(args.track);
const sim = new Sim(T, { seed: +(args.seed || 3), raceLaps: +(args.laps || 20) });
sim.startSession('FP'); while (!sim.session.done) sim.step();
sim.startSession('RACE');
const marks = (args.at || '14,18,21,24,27,30').split(',').map(Number);
let k = 0;
while (!sim.session.done && k < marks.length) {
  sim.step();
  if (sim.raceStart && sim.t - sim.raceStart >= marks[k]) {
    console.log(`t+${marks[k]}`);
    for (const c of sim.raceOrder.slice(0, +(args.n || 22))) console.log(`  ${String(c.pos).padStart(2)} g${String(c.gridPos).padStart(2)} ${c.code} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${c.v.toFixed(1)} vp=${c.vprof[T.idx(c.s)].toFixed(1)} mode=${c.mode} ${c.mistake?.type || ''} dev=${c.dev.toFixed(1)} devT=${c.devTarget.toFixed(1)} beta=${c.beta.toFixed(2)} thr=${c.throttle.toFixed(1)} brk=${c.brake.toFixed(2)}`);
    k++;
  }
}
