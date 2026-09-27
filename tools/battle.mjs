// Estadística de peleas: cuánto tiempo pasa cada coche a <1 s del de delante, intentos y adelantamientos
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const T = buildTrack(); const sim = new Sim(T, { seed: +(process.argv[2]||7), raceLaps: 20 });
sim.qualiOrder = sim.cars.slice().sort((a,b)=>(b.team.power+b.drv.pace*50)-(a.team.power+a.drv.pace*50)).reverse(); // parrilla invertida
sim.startSession('RACE');
let close=0, attack=0, along=0, n=0, ot=0, otPista=0, mist=0;
sim.on(e=>{ if(e.type==='overtake'){ot++; if(e.how==='pista')otPista++;} if(e.type==='mistake')mist++; });
let k=0;
while (!sim.session.done && sim.t < 4000) { sim.step(); if(++k%30===0 && sim.session.phase==='green'){ for(const c of sim.cars){ if(c.inPit||c.retired||c.finished) continue; n++; const ah=sim.carAheadOnTrack(c); if(ah){ const rel=T.rel(c.s,ah.s); if(rel<c.v*1.0) close++; if(Math.abs(rel)<6) along++; } if(c.mode==='attack') attack++; } } }
console.log(`muestras=${n} <1s=${(close/n*100).toFixed(0)}% atacando=${(attack/n*100).toFixed(0)}% enParalelo=${(along/n*100).toFixed(1)}% adelantamientos=${ot} (pista ${otPista}) errores=${mist} t=${sim.t.toFixed(0)}`);
console.log(sim.classification().map(c=>`${c.pos}.${c.code}(${c.gridPos}) ${c.strategy.stints.map(s=>s.c).join('')}`).join(' '));
