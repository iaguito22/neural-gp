// Brusquedad de la entrada a boxes: aceleración lateral (d'' en el marco de la pista) y giro por zonas.
// node tools/pitentry.mjs [track=urban|night] [session=RACE|FP]
import { buildTrack } from '../js/track.js';
import { Sim, DT } from '../js/sim.js';
const arg = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(arg.track);
const sim = new Sim(T, { seed: 3 });
sim.startSession(arg.session || 'FP');
const p = T.pit, zones = { decide: [p.decide, p.entryA], ramp: [p.entryA, p.entryB], lane: [p.entryB, p.boxes[10].s] };
const st = new Map(), res = {};
const zoneOf = (s) => Object.keys(zones).find(k => { const [a, b] = zones[k]; return T.ahead(a, s) < T.ahead(a, b); });
for (let k = 0; k < 60 * 1800; k++) {
  sim.step();
  for (const c of sim.cars) {
    const m = st.get(c) || { d: [], psi: 0 }; st.set(c, m);
    m.d.push(c.d); if (m.d.length > 3) m.d.shift();
    if (c.inPit && c.pitPhase === 'in' && m.d.length === 3) {
      const z = zoneOf(c.s) || 'box';
      const alat = Math.abs(m.d[2] - 2 * m.d[1] + m.d[0]) / DT / DT;
      const yr = Math.abs(c.psi - m.psi) / DT;
      const r = res[z] ||= { alat: 0, yr: 0, v: 0, n: 0 };
      if (alat < 200) { r.alat = Math.max(r.alat, alat); r.yr = Math.max(r.yr, yr); }
      r.v = Math.max(r.v, c.v * 3.6); r.n++;
    }
    m.psi = c.psi;
  }
}
for (const [z, r] of Object.entries(res)) console.log(z.padEnd(7), `alat max ${(r.alat / 9.81).toFixed(2)} g  giro max ${r.yr.toFixed(2)} rad/s  v max ${r.v.toFixed(0)} km/h`);
