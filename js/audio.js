// Sonido sintetizado del coche enfocado: armónicos suaves del V6 (sin saturación ni silbidos agudos),
// un leve "grano" de combustión y aire/rodadura grave. Todo pasa por un compresor.
export class EngineAudio {
  constructor() { this.on = false; this.ctx = null; }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.connect(ctx.destination);
    const master = this.master = ctx.createGain(); master.gain.value = 0; master.connect(comp);
    // cuerpo del motor: armónicos 0.5, 1, 2, 3 de la frecuencia de encendido
    const body = this.body = ctx.createGain(); body.gain.value = 0.3;
    const lp = this.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.5;
    body.connect(lp).connect(master);
    this.harm = [[0.5, 0.35, 'sine'], [1, 0.5, 'triangle'], [2, 0.22, 'sine'], [3, 0.1, 'sine'], [1.5, 0.08, 'sine']].map(([m, a, type]) => {
      const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain(); g.gain.value = a; o.connect(g).connect(body); o.start(); return { o, m, g, a };
    });
    // grano: modulación de amplitud lenta ligada a las rpm (da textura sin chirriar)
    const trem = ctx.createGain(); trem.gain.value = 0.5; this.trem = trem;
    const lfo = this.lfo = ctx.createOscillator(); lfo.type = 'sine'; const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(body.gain); lfo.start();
    // aire y rodadura: ruido marrón filtrado grave
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 600;
    const ng = this.noiseGain = ctx.createGain(); ng.gain.value = 0;
    noise.connect(nf).connect(ng).connect(master); noise.start();
    // lluvia: ruido blanco en banda media-alta, independiente del motor (no baja con la velocidad de la simulación)
    const wb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const wd = wb.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const rn = ctx.createBufferSource(); rn.buffer = wb; rn.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2600; rf.Q.value = 0.4;
    const rg = this.rainGain = ctx.createGain(); rg.gain.value = 0;
    this.rainOut = ctx.createGain(); this.rainOut.gain.value = 1; this.rainOut.connect(comp);
    rn.connect(rf).connect(rg).connect(this.rainOut); rn.start();
    this.on = true;
  }

  stop() { this.on = false; if (this.master) { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } }
  toggle() { if (this.on) this.stop(); else this.start(); return this.on; }

  update(car, cam, dist, speed, rain = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const onboard = cam === 'cockpit' || cam === 'tcam' || cam === 'nose' || cam === 'rear';
    this.rainGain.gain.setTargetAtTime(speed === 0 ? 0 : rain * (onboard ? 0.05 : 0.08), t, 0.5);
    let vol = onboard ? 0.28 : cam === 'chase' ? 0.22 : 0.18 * Math.min(1, 30 / Math.max(6, dist));
    if (speed > 4 || speed === 0 || !car || car.state === 'garage' || car.retired) vol = 0;
    this.master.gain.setTargetAtTime(vol, t, 0.1);
    if (!car) return;
    const rpm = Math.max(4500, car.rpm || 4500) * (car.v < 0.5 ? 0.7 : 1);
    const f = (rpm / 60) * 1.5; // tono grave agradable (media frecuencia de encendido del V6)
    const thr = car.throttle ?? 0;
    for (const h of this.harm) {
      h.o.frequency.setTargetAtTime(f * h.m, t, 0.04);
      h.g.gain.setTargetAtTime(h.a * (h.m >= 2 ? 0.4 + thr * 0.8 : 1), t, 0.06);
    }
    this.lfo.frequency.setTargetAtTime(f / 6, t, 0.05);
    this.lp.frequency.setTargetAtTime(700 + thr * 1100 + (onboard ? 250 : -150), t, 0.08);
    this.body.gain.setTargetAtTime(0.18 + thr * 0.32, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(Math.min(1, car.v / 85) * (onboard ? 0.5 : 0.3), t, 0.15);
  }
}
