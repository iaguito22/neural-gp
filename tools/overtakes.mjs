import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(args.track);
const sim = new Sim(T, { seed: +(args.seed || 3), raceLaps: +(args.laps || 6) });
sim.startSession('FP'); while (!sim.session.done) sim.step();
const pairs = {}; const log = [];
sim.on(e => { if (e.type === 'overtake') { const k = [e.car.code, e.other.code].sort().join('-'); pairs[k] = (pairs[k] || 0) + 1; log.push(`${e.t.toFixed(1)} ${e.car.code}>${e.other.code} ${e.corner} ${e.plan} ${e.how} lap${e.car.lap}`); } });
sim.startSession('RACE'); while (!sim.session.done) sim.step();
console.log(Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15).map(x => x.join(':')).join('  '));
const per = {}; for (const l of log) { const lp = l.split(' lap')[1]; per[lp] = (per[lp] || 0) + 1; }
console.log('total', log.length, 'por vuelta', JSON.stringify(per));
if (args.log) console.log(log.slice(0, +args.log).join('\n'));
