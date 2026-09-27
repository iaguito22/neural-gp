// Errores de pilotaje por sesión: trompos, salidas, bloqueos… por cada 100 vueltas, en seco y con tiempo variable.
// Y solapes entre coches en carrera (dos coches uno dentro del otro): node tools/errors.mjs [track] [seeds] [FP,Q1,…]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const T = buildTrack(process.argv[2] || 'gp'), seeds = +(process.argv[3] || 2);
for (const wx of ['dry', 'mixed']) {
  const agg = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const sim = new Sim(T, { seed, raceLaps: 15 }); sim.weatherMode = wx;
    let cur = null;
    sim.on((e) => { if (!cur) return; const k = e.type === 'mistake' ? e.kind : e.type; if (['mistake', 'lockup', 'retire', 'contact', 'limits'].includes(e.type)) cur[k] = (cur[k] || 0) + 1; if (e.type === 'lap') cur.laps++; });
    for (const id of (process.argv[4] || 'FP,Q1,Q2,Q3,RACE').split(',')) {
      const a = agg[id] || (agg[id] = { laps: 0, rain: 0, n: 0, over: 0, overMax: 0 }); cur = a;
      sim.startSession(id);
      while (!sim.session.done) {
        sim.step(); a.rain += sim.wx?.rain || 0; a.n++;
        if (id === 'RACE' && a.n % 5 === 0) for (let i = 0; i < sim.cars.length; i++) for (let j = i + 1; j < sim.cars.length; j++) {
          const A = sim.cars[i], B = sim.cars[j]; if (A.state !== 'track' || B.state !== 'track' || A.inPit || B.inPit) continue;
          const ds = Math.abs(T.rel(A.s, B.s)), dd = Math.abs(A.d - B.d);
          if (ds < 4.2 && dd < 1.6) { a.over++; a.overMax = Math.max(a.overMax, Math.min(4.2 - ds, 1.6 - dd)); }
        }
      }
    }
  }
  console.log(`\n== ${wx}`);
  for (const [id, a] of Object.entries(agg)) {
    const per = (k) => ((a[k] || 0) / a.laps * 100).toFixed(1);
    console.log(`${id.padEnd(5)} vueltas ${String(a.laps).padStart(4)} lluvia ${(a.rain / a.n).toFixed(2)} | por 100 v: trompo ${per('spin')} salida ${per('off')} bloqueo ${per('lockup')} límites ${per('limits')} contacto ${per('contact')} abandono ${per('retire')}${id === 'RACE' ? ` | solapes ${a.over} (máx ${a.overMax.toFixed(2)} m)` : ''}`);
  }
}
