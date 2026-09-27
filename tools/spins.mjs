// Trompos: cuántos, cuántos llegan a la barrera y cuántos abandonan
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const T = buildTrack(); const tot = {};
for (const seed of [1, 2, 3]) {
  const sim = new Sim(T, { seed, raceLaps: 20 }); sim.dbgWall = [];
  const ev = {}; sim.on((e) => { const k = e.session + ':' + e.type + (e.kind ? '.' + e.kind : '') + (e.why ? '.' + e.why : ''); ev[k] = (ev[k] || 0) + 1; });
  for (const id of ['FP', 'RACE']) { sim.startSession(id); while (!sim.session.done) sim.step(); }
  console.log('seed', seed, JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => /mistake|retire|contact/.test(k)))));
  console.log('  barrera:', sim.dbgWall.map((w) => w.join(' ')).join(' | '));
}
