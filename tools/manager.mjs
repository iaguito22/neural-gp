// Prueba de las palancas del mánager: el mismo coche con ritmo push / normal / save y con más o menos carga.
// node tools/manager.mjs [track=..] [seed=3]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const a = Object.fromEntries(process.argv.slice(2).map(x => x.split('=')));
const T = buildTrack(a.track);
for (const [pace, trim] of [['normal', 0], ['push', 0], ['save', 0], ['normal', 1], ['normal', -1]]) {
  const sim = new Sim(T, { seed: +(a.seed || 3), raceLaps: 12 }); sim.weatherMode = 'dry';
  sim.startSession('FP'); while (!sim.session.done) sim.step();
  sim.startSession('RACE');
  const me = sim.cars.find(c => c.code === (a.car || 'VER'));
  me.mgr = { pace, auto: true, box: false, tyre: null, trimNext: null }; me.trim = trim; sim.rebuildProfile(me);
  let vmax = 0; while (!sim.session.done) { sim.step(); if (me.v * 3.6 > vmax) vmax = me.v * 3.6; }
  const clean = me.laps.slice(1).sort((x, y) => x - y); const med = clean[clean.length >> 1];
  console.log(`${pace.padEnd(6)} trim ${String(trim).padStart(2)}: pos ${me.finishPos ?? me.pos} mediana vuelta ${med?.toFixed(2)} mejor ${me.best.toFixed(2)} punta ${vmax.toFixed(0)} paradas ${me.stops} errores ${me.brain.mistakes}`);
}
