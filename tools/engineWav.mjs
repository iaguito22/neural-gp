// Renderiza el motor (js/engineDSP.js) a un WAV para escucharlo sin el juego: aceleración de 1ª a 8ª con cortes
// en cada cambio, frenada con reducciones y ralentí. node tools/engineWav.mjs [salida.wav]
import { makeV6 } from '../js/engineDSP.js';
import fs from 'fs';
const sr = 44100, out = process.argv[2] || 'engine.wav';
const eng = makeV6(sr, 7);
const gears = [0, 95, 130, 165, 200, 240, 275, 310, 358];
const rpmAt = (kmh) => { let g = 1; while (g < 8 && kmh > gears[g]) g++; return [g, 7000 + 5200 * Math.min(1, (kmh - gears[g - 1]) / (gears[g] - gears[g - 1]))]; };
const blk = 128, samples = [];
let kmh = 60, t = 0, g0 = 1, cutT = 0;
const plan = (t) => (t < 9 ? 'acel' : t < 12.5 ? 'freno' : t < 14 ? 'acel2' : 'ralenti');
while (t < 16) {
  const ph = plan(t), dt = blk / sr;
  let load = 1;
  if (ph === 'acel' || ph === 'acel2') kmh = Math.min(345, kmh + dt * (kmh < 150 ? 38 : kmh < 250 ? 22 : 10));
  else if (ph === 'freno') { kmh = Math.max(80, kmh - dt * 110); load = 0; }
  else { kmh = 0; load = 0.05; }
  let [g, rpm] = kmh > 1 ? rpmAt(kmh) : [0, 4800];
  if (g !== g0) { if (g > g0) cutT = 0.05; g0 = g; }
  const cut = cutT > 0 ? 1 : 0; cutT -= dt;
  const buf = new Float32Array(blk); eng(buf, blk, rpm, load, cut); samples.push(buf); t += dt;
}
const N = samples.length * blk, wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
let o = 44; for (const b of samples) for (const v of b) { wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 30000))), o); o += 2; }
fs.writeFileSync(out, wav); console.log('escrito', out, (N / sr).toFixed(1), 's');
