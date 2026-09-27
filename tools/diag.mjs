// Diagnóstico de la física: errores por tipo y coches que no vuelven al garaje.
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(args.track);
const sim = new Sim(T, { seed: +(args.seed || 3), raceLaps: +(args.laps || 20) });
const kinds = {}; const byCar = {};
sim.on(e => { if (e.type === 'mistake' || e.type === 'retire' || (e.type === 'contact' && e.wall)) { const k = e.type === 'mistake' ? e.kind : e.type === 'retire' ? 'retire:' + e.why : 'wall'; kinds[k] = (kinds[k] || 0) + 1; byCar[e.car.code] = (byCar[e.car.code] || 0) + 1; } });
const only = (args.only || 'FP').split(',');
for (const id of only) {
  for (const k in kinds) delete kinds[k];
  sim.startSession(id);
  let n = 0; const lim = +(args.max || 2400) * 60;
  while (!sim.session.done && n < lim) { sim.step(); n++; }
  console.log(id, 'simT', sim.t.toFixed(0), 'done', sim.session.done, JSON.stringify(kinds));
  for (const c of sim.cars) if (!sim.session.done && c.state !== 'garage' && !c.out) console.log('  vivo:', c.code, c.state, c.lapKind, 'inPit', c.inPit, c.pitPhase, 'v', c.v.toFixed(1), 's', c.s.toFixed(0), 'd', c.d.toFixed(1), 'ret', c.retired, c.parked, c.mistake?.type);
}
console.log(JSON.stringify(byCar));
