import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const T = buildTrack(); const sim = new Sim(T, { seed: +(process.argv[2]||7), raceLaps: 20 });
sim.qualiOrder = sim.cars.slice();
sim.startSession('RACE');
const until = +(process.argv[3]||300);
sim.on(e=>{ if(['contact','retire','mistake','pitin','pitstop'].includes(e.type)) { const a=e.car,b=e.other; console.log(sim.t.toFixed(1), e.type, e.kind||'', a.code, `s=${a.s.toFixed(0)} d=${a.d.toFixed(1)} v=${(a.v*3.6).toFixed(0)} mode=${a.mode}`, b?`| ${b.code} s=${b.s.toFixed(0)} d=${b.d.toFixed(1)} v=${(b.v*3.6).toFixed(0)} mode=${b.mode}`:'', e.sev?.toFixed(1)||'', e.time?.toFixed(1)||'', JSON.stringify(a.dbg||{},(k,v)=>typeof v==='number'?+v.toFixed(3):v)); a.dbg=null; }});
while (sim.t < until && !sim.session.done) sim.step();
for (const c of sim.cars) console.log(c.code, 'lap', c.lap, 's', c.s.toFixed(0), 'd', c.d.toFixed(1), 'v', (c.v*3.6).toFixed(0), 'state', c.state, 'pit', c.inPit, c.pitPhase, 'mode', c.mode, 'mist', c.mistake?.type, 'ret', c.retired, 'parked', c.parked, 'pitReq', c.pitReq, 'dmg', c.dmg);
