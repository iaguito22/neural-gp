import { buildTrack } from '../js/track.js';
import { Sim, DT } from '../js/sim.js';
const T = buildTrack();
const sim = new Sim(T, { seed: 3 });
const n = +(process.argv[2]||1);
sim.startSession('FP');
sim.cars.forEach((c,i)=>{ if(i>=n) c.out=true; else c.plan.runs[0].go = i*25; });
sim.on(e=>{ if(['lap','mistake','contact','retire','leave','pitin','pitstop','limits'].includes(e.type)) console.log(sim.t.toFixed(1), e.type, e.car?.code, e.kind||'', e.time?.toFixed?.(3)||'', e.corner||'', e.other?.code||''); });
let last=0; const c0=sim.cars[0];
for (let k=0;k<60*800;k++){ sim.step();
  if (process.argv[3] && sim.t-last>2){ last=sim.t; console.log(`t=${sim.t.toFixed(0)} s=${c0.s.toFixed(0)} v=${(c0.v*3.6).toFixed(0)} tgt=${(c0.vprof[T.idx(c0.s)]*3.6).toFixed(0)} d=${c0.d.toFixed(1)} line=${c0.line[T.idx(c0.s)].toFixed(1)} st=${c0.state} pit=${c0.inPit}/${c0.pitPhase} kind=${c0.lapKind} mode=${c0.mode} mist=${c0.mistake?.type||''}`);}
}
