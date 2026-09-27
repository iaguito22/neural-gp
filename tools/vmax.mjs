// Velocidad punta por circuito en libres: node tools/vmax.mjs [track=urban|night]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const arg = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const T = buildTrack(arg.track);
const sim = new Sim(T, { seed: 3 });
sim.startSession('FP');
let vmax = 0, rmax = 0;
for (let k = 0; k < 60 * 900; k++) { sim.step(); for (const c of sim.cars) { if (c.v * 3.6 > vmax) vmax = c.v * 3.6; if (c.gear === 8 && c.rpm > rmax) rmax = c.rpm; } }
console.log(T.id || 'gp', 'vmax', vmax.toFixed(1), 'rpm8max', rmax.toFixed(0));
