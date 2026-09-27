// Bloqueos, derrapes cazados, trompos y salidas en una carrera: node tools/lockups.mjs [track=..] [seed=3] [wx=dry|wet|mixed]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const a = Object.fromEntries(process.argv.slice(2).map(x => x.split('=')));
const T = buildTrack(a.track);
const sim = new Sim(T, { seed: +(a.seed || 3), raceLaps: +(a.laps || 12) });
sim.weatherMode = a.wx || 'dry';
const cnt = {}; const inc = (k) => cnt[k] = (cnt[k] || 0) + 1;
let slideOn = new Map();
sim.on((e) => { if (e.type === 'lockup') inc('bloqueos'); if (e.type === 'mistake') inc('error_' + e.kind); if (e.type === 'retire') inc('abandono_' + e.why); if (e.type === 'contact') inc(e.wall ? 'golpe_muro' : 'toque'); if (e.type === 'debris') inc('pieza_' + e.part + (e.broken ? '_rota' : '')); if (e.type === 'gravel') inc('grava_en_pista'); });
for (const ses of ['FP', 'RACE']) {
  sim.startSession(ses); Object.keys(cnt).forEach(k => delete cnt[k]);
  while (!sim.session.done) { sim.step(); for (const c of sim.cars) { const on = Math.abs(c.beta) > 0.12; if (on && !slideOn.get(c)) inc('derrapes'); slideOn.set(c, on); } }
  const flat = sim.cars.map(c => c.tyre.flat || 0); 
  console.log(ses, JSON.stringify(cnt), 'goma cuadrada media', (flat.reduce((p, q) => p + q, 0) / flat.length).toFixed(3));
}
