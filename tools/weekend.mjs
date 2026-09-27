// Simula un fin de semana entero sin gráficos y saca estadísticas (calibración).
import { buildTrack } from '../js/track.js';
import { Sim, DT, setDT } from '../js/sim.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(args.track);
if (args.dt) setDT(1 / +args.dt);
const sim = new Sim(T, { seed: +(args.seed || 7), raceLaps: +(args.laps || 20) });
sim.weatherMode = args.wx || 'dry';
const ev = {}; const log = [];
sim.on(e => { const ky = e.type === 'mistake' ? 'm:' + e.kind : e.type === 'retire' ? 'ret:' + e.why : e.type === 'overtake' ? 'ot:' + e.how : e.type; ev[ky] = (ev[ky] || 0) + 1;
  if (['overtake','mistake','retire','contact','pitstop','flag','knockout','chequered','weather','pitdone'].includes(e.type) && sim.session.id === 'RACE')
    log.push(`${(e.t).toFixed(0).padStart(5)} ${e.type} ${e.car?.code||''} ${e.other?.code||''} ${e.kind||e.corner||''} ${e.time?e.time.toFixed(1):''} ${e.flag||''} ${e.how||''} ${e.what||''} ${e.c||''}`); });
const fmt = t => isFinite(t) ? `${Math.floor(t/60)}:${(t%60).toFixed(3).padStart(6,'0')}` : '--';
const only = args.only ? args.only.split(',') : ['FP','Q1','Q2','Q3','RACE'];
const t0 = Date.now();
for (const id of only) {
  for (const k in ev) delete ev[k];
  sim.startSession(id);
  let n = 0;
  let wl = [];
  while (!sim.session.done && n < 5400 / DT) { sim.step(); n++; if (n % (60 / DT) === 0) wl.push(`${sim.wx.rain.toFixed(2)}/${sim.wx.wet.toFixed(2)}/${sim.wx.line.toFixed(2)}`); }
  if (sim.wx.kind !== 'dry') console.log('tiempo', sim.wx.kind, 'lluvia/agua/trazada por minuto:', wl.join(' '));
  const cls = sim.classification();
  console.log(`\n== ${id}  simT=${sim.t.toFixed(0)}s  wall=${((Date.now()-t0)/1000).toFixed(1)}s  events=${JSON.stringify(ev)}`);
  if (id === 'FP') console.log('aprendizaje FP (primera vuelta limpia -> mejor):', cls.map(c => `${c.code} ${c.laps[0]?.toFixed(1)}->${c.best.toFixed(1)}`).join('  '));
  if (id !== 'RACE') console.log(cls.slice(0, 20).map((c, p) => `${p+1}.${c.code} ${fmt(c.best)} laps=${c.laps.length} exp=${c.brain.exp}/${c.brain.acc} commit=${(c.brain.commit.reduce((a,b)=>a+b)/c.brain.commit.length).toFixed(3)}`).join('\n'));
  else {
    console.log(cls.map((c) => `${c.pos}.${c.code} grid${c.gridPos} ${c.finished?'':'DNF '+(c.retiredWhy||'')} laps=${c.lap} best=${fmt(c.best)} stops=${c.stops} ${c.strategy.stints.map(s=>s.c).join('-')} ot=${c.stats.ot} wear=${c.tyre.wear.toFixed(2)}`).join('\n'));
    if (args.log) console.log(log.join('\n'));
  }
}
