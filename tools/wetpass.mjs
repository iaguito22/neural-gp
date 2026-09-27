// Lluvia: cuánto tarda un coche con I/W en pasar a uno con lisos que tiene delante.
// A la salida, la mitad de la parrilla (pares) sale con blandos. node tools/wetpass.mjs [track=..] [seed=3] [laps=8]
import { buildTrack } from '../js/track.js';
import { Sim, DT } from '../js/sim.js';
const a = Object.fromEntries(process.argv.slice(2).map(x => x.split('=')));
const T = buildTrack(a.track);
const sim = new Sim(T, { seed: +(a.seed || 3), raceLaps: +(a.laps || 8) });
sim.weatherMode = a.wx || 'wet';
sim.startSession('FP'); while (!sim.session.done) sim.step();
sim.startSession('RACE');
let forced = false;
let total = 0;
const stuck = new Map(), done = [], modes = {};
const slick = (c) => 'SMH'.includes(c.tyre.c);
while (!sim.session.done) {
  sim.step();
  if (!forced && sim.session.phase === 'green') { forced = true; if (!a.natural) sim.cars.forEach((c, k) => { if (k % 2) c.tyre.c = 'S'; }); }
  if (!forced || sim.wx.line < +(a.minLine ?? 0.3)) continue;
  for (const c of sim.cars) {
    if (c.out || c.retired || c.inPit || slick(c)) continue;
    const ah = sim.carAheadOnTrack(c);
    const k = c.code;
    if (ah && !ah.inPit && slick(ah) && T.rel(c.s, ah.s) < 30 && T.rel(c.s, ah.s) > 0 && sim.tyreGrip(c, false) / sim.tyreGrip(ah, false) > 1.06) {
      total += DT;
      const st = stuck.get(k) || { o: ah, t: 0, dev: 0, n: 0 };
      if (st.o !== ah) { st.o = ah; st.t = 0; st.dev = 0; st.n = 0; }
      st.t += DT; st.dev += Math.abs(c.d - c.line[T.idx(c.s)]); st.n++;
      modes[c.mode] = (modes[c.mode] || 0) + DT;
      stuck.set(k, st);
    } else if (stuck.has(k)) {
      const st = stuck.get(k); stuck.delete(k);
      if (st.t > 0.5) done.push({ k, o: st.o.code, t: st.t, dev: st.dev / st.n, passed: ah !== st.o && T.rel(c.s, st.o.s) < 0 });
    }
  }
}
const P = done.filter(d => d.passed), all = done.length;
const med = (x) => x.length ? x.sort((p, q) => p - q)[x.length >> 1].toFixed(1) : '-';
console.log(`casos ${all}, pasados ${P.length}; tiempo detrás hasta pasar: mediana ${med(P.map(d => d.t))} s, máx ${Math.max(0, ...P.map(d => d.t)).toFixed(1)} s; dev media ${(done.reduce((s, d) => s + d.dev, 0) / Math.max(1, all)).toFixed(2)} m`);
console.log('total detrás con ventaja >6 %:', total.toFixed(0), 's');
console.log('modo mientras está detrás (s):', JSON.stringify(Object.fromEntries(Object.entries(modes).map(([m, t]) => [m, +t.toFixed(0)]))));
if (a.log) console.log(done.sort((p, q) => q.t - p.t).slice(0, 10).map(d => `${d.k}>${d.o} ${d.t.toFixed(1)}s dev ${d.dev.toFixed(2)} ${d.passed ? 'pasa' : ''}`).join('\n'));
