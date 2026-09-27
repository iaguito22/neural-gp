import { makeV6 } from './engineDSP.js';
// Sistema de audio sintetizado Web Audio para F1 V6 Turbo Híbrido (Versión Definitiva).
// Arquitectura física:
// - Motor ICE V6: tren de pulsos de combustión con rugido de escape y grano mecánico real (AM-noise rasp),
//   subgraves potentes de cigüeñal (50-180 Hz) y resonancias formantes de colectores (320, 840, 1900 Hz).
// - Turbocharger & Gas Flow: silbido de turbina de alta frecuencia (3.5-5.2 kHz) y flujo de gases directo.
// - ERS / MGU-K: inversor eléctrico de alta frecuencia (1.8-4.5 kHz) en aceleración y frenada regenerativa.
// - Transmisión Seamless: microcortes de encendido (50 ms) con detonación explosiva (bang) instantánea en subidas,
//   golpe de gas (blip) con ladrido grave en reducciones y petardeo continuo en retención.
// - Acústica y Cámaras: Doppler físico EXCLUSIVO en planos fijos de pista (Doppler=1.0 en cockpit, chase y dron),
//   suavizado continuo de distancia para evitar saltos de ganancia, y reverberación convolutiva de circuito.

export class EngineAudio {
  constructor() {
    this.on = false;
    this.ctx = null;
    this.prevCar = null;
    this.prevGear = 1;
    this.prevThrottle = 0;
    this.shiftCutUntil = 0;
    this.downshiftBlipUntil = 0;
    this.lastCrackleTime = 0;
    this.smoothedDist = null;
  }

  _makeDistortionCurve(k = 2.0) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      if (x < 0) {
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      } else {
        curve[i] = Math.tanh(x * 2.2) * 0.96;
      }
    }
    return curve;
  }

  _makeNoiseBuffer(ctx, duration = 2.0, pink = false) {
    const length = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (!pink) {
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.12;
        b6 = white * 0.115926;
      }
    }
    return buf;
  }

  _makeCircuitReverbBuffer(ctx, duration = 0.90, decay = 2.8) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buf = ctx.createBuffer(2, length, sampleRate);
    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);

    const reflections = [
      { time: 0.015, leftAmp: 0.45, rightAmp: 0.24 },
      { time: 0.032, leftAmp: 0.30, rightAmp: 0.42 },
      { time: 0.055, leftAmp: 0.36, rightAmp: 0.28 },
      { time: 0.085, leftAmp: 0.24, rightAmp: 0.32 },
      { time: 0.120, leftAmp: 0.20, rightAmp: 0.20 }
    ];

    for (const r of reflections) {
      const idx = Math.floor(r.time * sampleRate);
      if (idx < length) {
        left[idx] += r.leftAmp;
        right[idx] += r.rightAmp;
      }
    }

    let filterL = 0, filterR = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * decay);
      const whiteL = (Math.random() * 2 - 1) * env * 0.25;
      const whiteR = (Math.random() * 2 - 1) * env * 0.25;
      filterL = 0.65 * filterL + 0.35 * whiteL;
      filterR = 0.65 * filterR + 0.35 * whiteR;
      left[i] += filterL;
      right[i] += filterR;
    }

    return buf;
  }

  _makeF1ExhaustWave(ctx) {
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const decay = 1 / Math.pow(k, 0.70);
      const harmonicColor = (k % 2 === 1) ? 1.0 : 0.85;
      imag[k] = decay * harmonicColor * Math.sin(k * 0.35);
      real[k] = decay * harmonicColor * Math.cos(k * 0.35) * 0.45;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.on = true;
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    // Bus Master y Compresor de salida
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 3;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.002;
    comp.release.value = 0.06;
    comp.connect(ctx.destination);

    const master = this.master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(comp);

    // ==========================================
    // REVERBERACIÓN CONVOLUTIVA DE CIRCUITO
    // ==========================================
    const convolver = this.convolver = ctx.createConvolver();
    convolver.buffer = this._makeCircuitReverbBuffer(ctx, 0.90, 2.8);

    const reverbLP = ctx.createBiquadFilter();
    reverbLP.type = 'lowpass';
    reverbLP.frequency.value = 4800;

    const reverbGain = this.reverbGain = ctx.createGain();
    reverbGain.gain.value = 0;

    convolver.connect(reverbLP);
    reverbLP.connect(reverbGain);
    reverbGain.connect(master);

    const whiteBuf = this._makeNoiseBuffer(ctx, 2.0, false);
    const pinkBuf = this._makeNoiseBuffer(ctx, 2.0, true);

    // ==========================================
    // 1. CAPA SUBGRAVE / PEGADA DE CIGÜEÑAL (50-200 Hz)
    // ==========================================
    const subBassGain = this.subBassGain = ctx.createGain();
    subBassGain.gain.value = 0.48;

    const subOsc1 = this.subOsc1 = ctx.createOscillator();
    subOsc1.type = 'triangle';
    subOsc1.connect(subBassGain);
    subOsc1.start();

    const subOsc2 = this.subOsc2 = ctx.createOscillator();
    subOsc2.type = 'sawtooth';
    const subOsc2Gain = ctx.createGain();
    subOsc2Gain.gain.value = 0.35;
    subOsc2.connect(subOsc2Gain);
    subOsc2Gain.connect(subBassGain);
    subOsc2.start();

    const subLowpass = ctx.createBiquadFilter();
    subLowpass.type = 'lowpass';
    subLowpass.frequency.value = 280;
    subLowpass.Q.value = 1.4;
    subBassGain.connect(subLowpass);
    subLowpass.connect(master);

    // ==========================================
    // 2. MOTOR ICE V6 (Combustión, Escape, Resonancias)
    // ==========================================
    const engineGain = this.engineGain = ctx.createGain();
    engineGain.gain.value = 0.42;

    const enginePanner = this.enginePanner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const engineAirFilter = this.engineAirFilter = ctx.createBiquadFilter();
    engineAirFilter.type = 'lowpass';
    engineAirFilter.frequency.value = 10000;
    engineAirFilter.Q.value = 0.5;

    const engineShaper = ctx.createWaveShaper();
    engineShaper.curve = this._makeDistortionCurve(2.0);
    engineShaper.oversample = '2x';

    const engineLP = this.engineLP = ctx.createBiquadFilter();
    engineLP.type = 'lowpass';
    engineLP.frequency.value = 5800;
    engineLP.Q.value = 0.9;

    // Resonancias formantes del sistema de escape V6
    const engineLowShelf = this.engineLowShelf = ctx.createBiquadFilter();
    engineLowShelf.type = 'lowshelf';
    engineLowShelf.frequency.value = 180;
    engineLowShelf.gain.value = 8.0;

    const enginePeakLow = this.enginePeakLow = ctx.createBiquadFilter();
    enginePeakLow.type = 'peaking';
    enginePeakLow.frequency.value = 320;
    enginePeakLow.Q.value = 2.2;
    enginePeakLow.gain.value = 6.0;

    const enginePeakMid = this.enginePeakMid = ctx.createBiquadFilter();
    enginePeakMid.type = 'peaking';
    enginePeakMid.frequency.value = 840;
    enginePeakMid.Q.value = 1.8;
    enginePeakMid.gain.value = 5.5;

    const enginePeakHigh = this.enginePeakHigh = ctx.createBiquadFilter();
    enginePeakHigh.type = 'peaking';
    enginePeakHigh.frequency.value = 1900;
    enginePeakHigh.Q.value = 2.2;
    enginePeakHigh.gain.value = 4.8;

    engineLowShelf.connect(enginePeakLow);
    enginePeakLow.connect(enginePeakMid);
    enginePeakMid.connect(enginePeakHigh);
    enginePeakHigh.connect(engineLP);
    engineLP.connect(engineShaper);
    engineShaper.connect(engineAirFilter);

    if (enginePanner) {
      engineAirFilter.connect(enginePanner);
      enginePanner.connect(engineGain);
    } else {
      engineAirFilter.connect(engineGain);
    }
    engineGain.connect(master);
    engineGain.connect(convolver);

    // Textura mecánica de combustión (AM noise rasp)
    const raspNoise = ctx.createBufferSource();
    raspNoise.buffer = pinkBuf;
    raspNoise.loop = true;
    const raspFilter = ctx.createBiquadFilter();
    raspFilter.type = 'bandpass';
    raspFilter.frequency.value = 1400;
    raspFilter.Q.value = 2.0;
    const raspGain = this.raspGain = ctx.createGain();
    raspGain.gain.value = 0.08;
    raspNoise.connect(raspFilter);
    raspFilter.connect(raspGain);
    raspGain.connect(engineLowShelf);
    raspNoise.start();

    // Osciladores armónicos de combustión V6
    const exhaustWave = this._makeF1ExhaustWave(ctx);
    const harmConfigs = [
      { mult: 0.5000, amp: 0.45, type: 'sawtooth' }, // 1.5X asimetría bancadas
      { mult: 1.0000, amp: 0.70, customWave: exhaustWave }, // 3.0X FUNDAMENTAL DE ENCENDIDO V6
      { mult: 1.5000, amp: 0.45, type: 'sawtooth' }, // 4.5X rugido áspero
      { mult: 2.0000, amp: 0.55, customWave: exhaustWave }, // 6.0X 2º armónico de combustión
      { mult: 3.0000, amp: 0.38, type: 'sawtooth' }, // 9.0X mordida metálica
      { mult: 4.0000, amp: 0.24, type: 'sawtooth' }  // 12.0X chillido en altas
    ];

    this.harmonics = harmConfigs.map((cfg) => {
      const o = ctx.createOscillator();
      if (cfg.customWave) o.setPeriodicWave(cfg.customWave);
      else o.type = cfg.type;

      const g = ctx.createGain();
      g.gain.value = cfg.amp;
      o.connect(g);
      g.connect(engineLowShelf);
      o.start();
      return { o, mult: cfg.mult, g, amp: cfg.amp };
    });

    // motor por explosiones (engineDSP.js) en un AudioWorklet: cuando está listo sustituye a los osciladores y al
    // subgrave (que sonaban a sintetizador); va directo al filtro de aire, sin la EQ ni la saturación de los osciladores
    const useV6 = (node, P) => {
      if (this.v6) return;
      this.v6 = P;
      const g = this.v6Gain = ctx.createGain(); g.gain.value = 1.1;
      node.connect(g).connect(engineAirFilter);
      for (const h of this.harmonics) { h.g.gain.value = 0; }
      this.subBassGain.gain.value = 0; this.raspGain.gain.value = 0;
    };
    // si el AudioWorklet no arranca (en algunos Chrome addModule no termina nunca), el mismo motor en el hilo principal
    const fallback = () => {
      if (this.v6 || !ctx.createScriptProcessor) return;
      const sp = ctx.createScriptProcessor(1024, 0, 1), gen = makeV6(ctx.sampleRate, 7);
      const P = { rpm: 5000, load: 0, cut: 0, _sp: sp };
      sp.onaudioprocess = (e) => { const o = e.outputBuffer.getChannelData(0); gen(o, o.length, P.rpm, P.load, P.cut); };
      useV6(sp, P);
    };
    if (ctx.audioWorklet) {
      ctx.audioWorklet.addModule(new URL('./v6worklet.js', import.meta.url)).then(() => {
        if (this.v6) return;
        const node = new AudioWorkletNode(ctx, 'v6', { outputChannelCount: [1] });
        const pr = node.parameters, P = { node };
        for (const k of ['rpm', 'load', 'cut']) Object.defineProperty(P, k, { set: (v) => pr.get(k).setTargetAtTime(v, ctx.currentTime, k === 'cut' ? 0.001 : 0.012) });
        useV6(node, P);
      }).catch((e) => { console.warn('motor: sin AudioWorklet', e); fallback(); });
    }
    setTimeout(fallback, 1500);

    // Grano / vibración periódica mecánica
    const lfo = this.grainLFO = ctx.createOscillator();
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.10;
    lfo.connect(lfoGain);
    lfoGain.connect(engineGain.gain);
    lfo.start();

    // ==========================================
    // 3. TURBOCHARGER, AIRE Y ERS (HÍBRIDO F1)
    // ==========================================
    // Silbido de turbina de turbo (3.4 - 5.5 kHz) directo al master
    const turboOsc = this.turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    const turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 4000;
    turboFilter.Q.value = 3.2;
    const turboGain = this.turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboGain.connect(master);
    turboOsc.start();

    // Soplado de gas de escape / turbo hiss directo
    const blowNoise = ctx.createBufferSource();
    blowNoise.buffer = pinkBuf;
    blowNoise.loop = true;
    const blowFilter = ctx.createBiquadFilter();
    blowFilter.type = 'highpass';
    blowFilter.frequency.value = 2400;
    const blowGain = this.blowGain = ctx.createGain();
    blowGain.gain.value = 0;
    blowNoise.connect(blowFilter);
    blowFilter.connect(blowGain);
    blowGain.connect(master);
    blowNoise.start();

    // Wastegate hiss al soltar gas
    const wgNoise = ctx.createBufferSource();
    wgNoise.buffer = whiteBuf;
    wgNoise.loop = true;
    const wgFilter = ctx.createBiquadFilter();
    wgFilter.type = 'bandpass';
    wgFilter.frequency.value = 3200;
    wgFilter.Q.value = 1.8;
    const wgGain = this.wastegateGain = ctx.createGain();
    wgGain.gain.value = 0;
    wgNoise.connect(wgFilter);
    wgFilter.connect(wgGain);
    wgGain.connect(master);
    wgNoise.start();

    // Inversor eléctrico ERS / MGU-K (1.8 - 4.5 kHz)
    const ersOsc = this.ersOsc = ctx.createOscillator();
    ersOsc.type = 'sine';
    const ersFilter = ctx.createBiquadFilter();
    ersFilter.type = 'bandpass';
    ersFilter.frequency.value = 2800;
    ersFilter.Q.value = 3.5;
    const ersGain = this.ersGain = ctx.createGain();
    ersGain.gain.value = 0;
    ersOsc.connect(ersFilter);
    ersFilter.connect(ersGain);
    ersGain.connect(master);
    ersOsc.start();

    // ==========================================
    // 4. TRANSICIONES SEAMLESS (Pops, Bangs, Thump)
    // ==========================================
    // Detonación / crack agudo de cambio de marcha (upshift pop)
    const popNoise = ctx.createBufferSource();
    popNoise.buffer = whiteBuf;
    popNoise.loop = true;
    const popFilter = ctx.createBiquadFilter();
    popFilter.type = 'bandpass';
    popFilter.frequency.value = 1600;
    popFilter.Q.value = 1.8;
    const popGain = this.crackleGain = ctx.createGain();
    popGain.gain.value = 0;
    popNoise.connect(popFilter);
    popFilter.connect(popGain);
    popGain.connect(master);
    popGain.connect(convolver);
    popNoise.start();

    // Thump grave de combustión / corte (120 Hz)
    const thudOsc = this.thudOsc = ctx.createOscillator();
    thudOsc.type = 'sine';
    thudOsc.frequency.value = 120;
    const thudGain = this.thudGain = ctx.createGain();
    thudGain.gain.value = 0;
    thudOsc.connect(thudGain);
    thudGain.connect(master);
    thudGain.connect(convolver);
    thudOsc.start();

    // ==========================================
    // 5. VOCES SECUNDARIAS (Rivales con Doppler)
    // ==========================================
    this.secondaryVoices = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(exhaustWave);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3800;
      lp.Q.value = 0.7;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const g = ctx.createGain();
      g.gain.value = 0;

      osc.connect(lp);
      if (pan) {
        lp.connect(pan);
        pan.connect(g);
      } else {
        lp.connect(g);
      }
      g.connect(master);
      g.connect(convolver);
      osc.start();
      this.secondaryVoices.push({ osc, lp, pan, gain: g });
    }

    // ==========================================
    // 6. NEUMÁTICOS, RODAJE, GRAVA Y AMBIENTE
    // ==========================================
    // Ruido de rodadura
    const rollNoise = ctx.createBufferSource();
    rollNoise.buffer = pinkBuf;
    rollNoise.loop = true;
    const rollFilter = ctx.createBiquadFilter();
    rollFilter.type = 'bandpass';
    rollFilter.frequency.value = 380;
    rollFilter.Q.value = 1.2;
    const rollGain = this.rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollNoise.connect(rollFilter);
    rollFilter.connect(rollGain);
    rollGain.connect(master);
    rollNoise.start();

    // Chirrido de neumáticos
    const screechNoise = ctx.createBufferSource();
    screechNoise.buffer = whiteBuf;
    screechNoise.loop = true;
    const screechFilter1 = ctx.createBiquadFilter();
    screechFilter1.type = 'bandpass';
    screechFilter1.frequency.value = 980;
    screechFilter1.Q.value = 4.8;
    const screechFilter2 = ctx.createBiquadFilter();
    screechFilter2.type = 'bandpass';
    screechFilter2.frequency.value = 1520;
    screechFilter2.Q.value = 5.0;
    const screechGain = this.screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechNoise.connect(screechFilter1);
    screechNoise.connect(screechFilter2);
    screechFilter1.connect(screechGain);
    screechFilter2.connect(screechGain);
    screechGain.connect(master);
    screechNoise.start();

    // Grava / hierba
    const gravelNoise = ctx.createBufferSource();
    gravelNoise.buffer = pinkBuf;
    gravelNoise.loop = true;
    const gravelFilter = ctx.createBiquadFilter();
    gravelFilter.type = 'bandpass';
    gravelFilter.frequency.value = 850;
    gravelFilter.Q.value = 2.0;
    const gravelGain = this.gravelGain = ctx.createGain();
    gravelGain.gain.value = 0;
    gravelNoise.connect(gravelFilter);
    gravelFilter.connect(gravelGain);
    gravelGain.connect(master);
    gravelNoise.start();

    // Viento
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = pinkBuf;
    windNoise.loop = true;
    const windFilter = this.windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = this.windGain = ctx.createGain();
    windGain.gain.value = 0;
    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windNoise.start();

    // Público
    const crowdNoise = ctx.createBufferSource();
    crowdNoise.buffer = pinkBuf;
    crowdNoise.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.value = 950;
    crowdFilter.Q.value = 1.8;
    const crowdGain = this.crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdNoise.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(master);
    crowdNoise.start();

    // Lluvia
    const rainNoise = ctx.createBufferSource();
    rainNoise.buffer = whiteBuf;
    rainNoise.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2500;
    rainFilter.Q.value = 0.5;
    const rainGain = this.rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    this.rainOut = ctx.createGain();
    this.rainOut.gain.value = 1;
    this.rainOut.connect(comp);
    rainNoise.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(this.rainOut);
    rainNoise.start();

    this.on = true;
  }

  // baja el resto del sonido mientras habla la radio (para que se entienda)
  duck(on) { this.ducked = on; }

  stop() {
    this.on = false;
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(0, t, 0.05);
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  toggle() {
    if (this.on) this.stop();
    else this.start();
    return this.on;
  }

  _calcDopplerAndPan(car, carPos, carRotY, camPos, camRight) {
    if (!carPos || !camPos) return { doppler: 1.0, pan: 0, dist: 20 };
    const dx = camPos.x - carPos.x;
    const dy = camPos.y - carPos.y;
    const dz = camPos.z - carPos.z;
    const dist = Math.max(0.5, Math.hypot(dx, dy, dz));

    const dirX = dx / dist;
    const dirZ = dz / dist;

    const speed = car.v || 0;
    const yaw = carRotY || 0;
    const vx = speed * Math.sin(yaw);
    const vz = speed * Math.cos(yaw);

    const vRad = vx * dirX + vz * dirZ;
    const c = 343;
    const clampedVRad = Math.max(-105, Math.min(105, vRad));
    const doppler = c / (c - clampedVRad);

    let pan = 0;
    if (camRight) {
      const relX = carPos.x - camPos.x;
      const relY = carPos.y - camPos.y;
      const relZ = carPos.z - camPos.z;
      const dotRight = relX * camRight.x + relY * camRight.y + relZ * camRight.z;
      pan = Math.max(-1, Math.min(1, dotRight / Math.max(10, dist)));
    }

    return { doppler, pan, dist };
  }

  update(car, cam, camObjOrDist, focusPos, speed, sim, visuals) {
    if (!this.ctx || !this.on) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    const t = this.ctx.currentTime;

    let camPos = null;
    let camRight = null;
    let dist = 20;

    if (camObjOrDist && typeof camObjOrDist === 'object' && camObjOrDist.isCamera) {
      camPos = camObjOrDist.position;
      const e = camObjOrDist.matrixWorld.elements;
      camRight = { x: e[0], y: e[1], z: e[2] };
      if (focusPos) {
        dist = Math.hypot(camPos.x - focusPos.x, camPos.y - focusPos.y, camPos.z - focusPos.z);
      }
    } else if (typeof camObjOrDist === 'number') {
      dist = camObjOrDist;
    }

    // Suavizado continuo de distancia para eliminar saltos bruscos en cambios de cámara
    if (this.smoothedDist == null) this.smoothedDist = dist;
    else this.smoothedDist += (dist - this.smoothedDist) * 0.08;

    const rainVal = sim?.wx?.rain ?? (typeof speed === 'number' && typeof visuals === 'undefined' ? (arguments[4] || 0) : 0);
    const simSpeed = typeof speed === 'number' ? speed : 1;

    const onboard = cam === 'cockpit' || cam === 'tcam' || cam === 'nose' || cam === 'rear';
    const isPaused = simSpeed === 0 || simSpeed > 4;
    const isMuted = isPaused || !car || car.state === 'garage' || car.retired;

    // 1. Lluvia y Ambiente
    const rainVol = isPaused ? 0 : rainVal * (onboard ? 0.05 : 0.08);
    this.rainGain.gain.setTargetAtTime(rainVol, t, 0.3);

    const crowdVol = isMuted ? 0 : (cam === 'track' ? 0.035 : 0.018);
    this.crowdGain.gain.setTargetAtTime(crowdVol, t, 0.4);

    const carSpeed = car?.v ?? 0;
    const windVol = isMuted ? 0 : (0.015 + Math.min(0.08, carSpeed / 300) * (onboard ? 0.7 : 0.4));
    const windCutoff = 350 + Math.min(1200, carSpeed * 12);
    this.windGain.gain.setTargetAtTime(windVol, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(windCutoff, t, 0.15);

    // Ruido de rodadura
    const rollVol = isMuted ? 0 : Math.min(0.06, (carSpeed / 100) * 0.05);
    this.rollGain.gain.setTargetAtTime(rollVol, t, 0.1);

    // 2. Volumen Master suave y sin saltos (>0.3 s)
    const distAtten = Math.max(0.45, 1 / (1 + this.smoothedDist * 0.008));
    let masterVol = onboard
      ? 0.35
      : cam === 'chase'
        ? 0.32
        : cam === 'heli'
          ? 0.28
          : 0.30 * distAtten;

    if (this.ducked) masterVol *= 0.55;
    if (isMuted) masterVol = 0;
    this.master.gain.setTargetAtTime(masterVol, t, this.ducked ? 0.1 : 0.25);

    // Reverberación de circuito (seca en cabina, espaciosa en planos exteriores)
    const reverbVol = isMuted || onboard ? 0 : (cam === 'track' ? 0.35 : cam === 'heli' ? 0.36 : 0.16);
    this.reverbGain.gain.setTargetAtTime(reverbVol, t, 0.25);

    if (!car) return;

    // ==========================================
    // 3. CAMBIOS DE MARCHA DISCRETOS Y DETONACIONES
    // ==========================================
    const curGear = car.gear ?? 1;
    const curThrottle = car.throttle ?? 0;
    const curBrake = car.brake ?? 0;
    let gearChanged = false;

    // Reiniciar marcha previa si cambia el coche enfocado
    if (this.prevCar !== car) {
      this.prevCar = car;
      this.prevGear = curGear;
    }

    if (this.prevGear !== curGear && carSpeed > 6) {
      gearChanged = true;
      if (curGear > this.prevGear) {
        // Subida de marcha: microcorte de encendido (50 ms) + bang explosivo de escape + thump grave
        this.shiftCutUntil = t + 0.050;
        // (bajada en 4 ms, no de golpe: un salto a 0 chascaba en cada cambio)
        this.engineGain.gain.cancelScheduledValues(t);
        this.engineGain.gain.setTargetAtTime(0.06, t, 0.004);
        this.engineGain.gain.setTargetAtTime(0.42 + curThrottle * 0.35, t + 0.050, 0.010);

        // Detonación seca y potente de escape
        this.crackleGain.gain.cancelScheduledValues(t);
        this.crackleGain.gain.setValueAtTime(0.3, t);
        this.crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

        // Thump grave de par motor (120 Hz)
        this.thudGain.gain.cancelScheduledValues(t);
        this.thudGain.gain.setValueAtTime(0.75, t);
        this.thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.048);
      } else if (curGear < this.prevGear) {
        // Reducción: golpe/blip de revoluciones + ladrido grave de escape
        this.downshiftBlipUntil = t + 0.085;
        this.thudGain.gain.cancelScheduledValues(t);
        this.thudGain.gain.setValueAtTime(0.80, t);
        this.thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.080);

        this.crackleGain.gain.cancelScheduledValues(t);
        this.crackleGain.gain.setValueAtTime(0.25, t);
        this.crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.050);
      }
      this.prevGear = curGear;
    }

    const inShiftCut = t < this.shiftCutUntil;
    const inDownshiftBlip = t < this.downshiftBlipUntil;

    // Wastegate al soltar acelerador bruscamente
    if (this.prevThrottle > 0.55 && curThrottle < 0.20 && carSpeed > 15) {
      this.wastegateGain.gain.cancelScheduledValues(t);
      this.wastegateGain.gain.setValueAtTime(0.22, t);
      this.wastegateGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    }
    this.prevThrottle = curThrottle;

    // Petardeo continuo en retención a altas RPM
    if (curThrottle < 0.18 && (car.rpm || 0) > 7200 && carSpeed > 15 && !inShiftCut) {
      if (t - this.lastCrackleTime > 0.035 + Math.random() * 0.040) {
        this.lastCrackleTime = t;
        const popIntensity = 0.15 + Math.random() * 0.22;
        this.crackleGain.gain.cancelScheduledValues(t);
        this.crackleGain.gain.setValueAtTime(popIntensity, t);
        this.crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.024);
      }
    }

    // ==========================================
    // 4. MOTOR PRINCIPAL: CÁLCULO DE FRECUENCIAS Y DOPPLER
    // ==========================================
    // Doppler SOLO aplica a planos fijos de pista (cámaras exteriores estáticas)
    // En cockpit, chase o dron la cámara se desplaza con el monoplaza (Doppler = 1.0)
    let focusDoppler = 1.0;
    let focusPan = 0;
    if (cam === 'track' && camPos && focusPos) {
      const focusVis = visuals ? visuals[car.i] : null;
      const rotY = focusVis?.root?.rotation?.y ?? 0;
      const res = this._calcDopplerAndPan(car, focusPos, rotY, camPos, camRight);
      focusDoppler = res.doppler;
      focusPan = res.pan;
    }

    if (this.enginePanner) {
      this.enginePanner.pan.setTargetAtTime(onboard ? 0 : focusPan, t, 0.05);
    }

    let effRpm = Math.max(4800, car.rpm || 4800) * (carSpeed < 0.5 ? 0.75 : 1);
    if (inDownshiftBlip) effRpm = Math.min(12500, effRpm + 2600);

    const crankFreq = (effRpm / 60) * focusDoppler;
    const firingFreq = crankFreq * 3.0; // 3 detonaciones por revolución

    // Capa Subgraves (50-200 Hz): pegada física de cigüeñal
    if (gearChanged) {
      this.subOsc1.frequency.cancelScheduledValues(t);
      this.subOsc1.frequency.setValueAtTime(crankFreq, t);
      this.subOsc2.frequency.cancelScheduledValues(t);
      this.subOsc2.frequency.setValueAtTime(crankFreq * 0.5, t);
    } else {
      this.subOsc1.frequency.setTargetAtTime(crankFreq, t, 0.008);
      this.subOsc2.frequency.setTargetAtTime(crankFreq * 0.5, t, 0.008);
    }
    const flybyBassBoost = (cam === 'track' && dist < 28 && carSpeed > 20) ? 8.0 : 0;
    this.subBassGain.gain.setTargetAtTime(this.v6 ? 0 : 0.48 + (flybyBassBoost > 0 ? 0.30 : 0), t, 0.04);

    // Actualización de osciladores armónicos:
    // Salto instantáneo sin rampa en cambios de marcha
    for (const h of this.harmonics) {
      const targetF = firingFreq * h.mult;
      if (gearChanged) {
        h.o.frequency.cancelScheduledValues(t);
        h.o.frequency.setValueAtTime(targetF, t);
      } else {
        h.o.frequency.setTargetAtTime(targetF, t, 0.008);
      }

      const dynGain = h.amp * (h.mult >= 1.5 ? 0.65 + curThrottle * 0.75 : 0.85 + curThrottle * 0.35);
      h.g.gain.setTargetAtTime(this.v6 ? 0 : dynGain, t, 0.03);
    }

    // Grano mecánico
    this.grainLFO.frequency.setTargetAtTime(crankFreq, t, 0.02);

    // Textura mecánica de raspado
    this.raspGain.gain.setTargetAtTime(this.v6 ? 0 : 0.06 + curThrottle * 0.12, t, 0.04);
    if (this.v6) {
      const P = this.v6;
      // en cada marcha las vueltas solo van de 7000 a 12200 (×1,7): se exagera la subida para que el tono suba de verdad
      // al estirar la marcha (×2,7), como en la tele
      const rpmA = 7000 * Math.pow(effRpm / 7000, 2.1);
      P.rpm = rpmA * focusDoppler; P.load = inShiftCut ? 0 : curThrottle; P.cut = inShiftCut ? 1 : 0;
    }

    // EQ y resonancias formantes
    this.engineLowShelf.gain.setTargetAtTime(8.0 + flybyBassBoost + (1 - curThrottle) * 2.0, t, 0.04);

    const lpFreq = onboard
      ? 3000 + curThrottle * 6500
      : Math.max(2200, (2400 + curThrottle * 4200) - this.smoothedDist * 2);
    this.engineLP.frequency.setTargetAtTime(lpFreq, t, 0.04);

    const airFreq = onboard ? 10000 : Math.max(2800, 9200 - this.smoothedDist * 6);
    this.engineAirFilter.frequency.setTargetAtTime(airFreq, t, 0.04);

    // Silbido de Turbocharger y Soplado directo de aire (brillo F1)
    const turboFreq = 3400 + (effRpm - 4800) * 0.22 + curThrottle * 1600;
    this.turboOsc.frequency.setTargetAtTime(turboFreq * (cam === 'track' ? focusDoppler : 1), t, 0.03);
    // (flojito: un seno puro a 4 kHz fuerte era lo que sonaba «eléctrico, a alien» al acelerar)
    const turboVol = (0.004 + 0.02 * Math.pow(curThrottle, 1.3)) * (onboard ? 1.0 : 0.85);
    this.turboGain.gain.setTargetAtTime(turboVol, t, 0.04);

    const blowVol = curThrottle * 0.085 * Math.min(1, carSpeed / 15);
    this.blowGain.gain.setTargetAtTime(blowVol, t, 0.04);

    // ERS / MGU-K Inverter Whine
    const ersFreq = 1800 + carSpeed * 28;
    this.ersOsc.frequency.setTargetAtTime(ersFreq, t, 0.03);
    const isErsActive = (curThrottle > 0.4 || curBrake > 0.3) && carSpeed > 10;
    const ersVol = isErsActive ? (curThrottle > 0.4 ? 0.006 : 0.02) : 0;   // se oye sobre todo al regenerar en la frenada
    this.ersGain.gain.setTargetAtTime(ersVol, t, 0.05);

    // Ganancia continua del motor (salvo corte de encendido explícito)
    if (!inShiftCut) {
      const bodyVol = 0.38 + curThrottle * 0.42;
      this.engineGain.gain.setTargetAtTime(bodyVol, t, 0.04);
    }

    // ==========================================
    // 5. VOCES SECUNDARIAS (Rivales con Doppler)
    // ==========================================
    if (!onboard && sim?.cars && visuals && camPos) {
      const candidates = [];
      for (const otherCar of sim.cars) {
        if (otherCar === car || otherCar.state === 'garage' || otherCar.retired) continue;
        const vis = visuals[otherCar.i];
        if (!vis?.root?.position) continue;
        const oPos = vis.root.position;
        const d = Math.hypot(camPos.x - oPos.x, camPos.y - oPos.y, camPos.z - oPos.z);
        if (d < 180) candidates.push({ car: otherCar, pos: oPos, rotY: vis.root.rotation.y, dist: d });
      }

      candidates.sort((a, b) => a.dist - b.dist);

      for (let i = 0; i < this.secondaryVoices.length; i++) {
        const voice = this.secondaryVoices[i];
        const cand = candidates[i];
        if (cand && !isPaused) {
          const res = this._calcDopplerAndPan(cand.car, cand.pos, cand.rotY, camPos, camRight);
          const oRpm = Math.max(4800, cand.car.rpm || 4800);
          const oFreq = (oRpm / 60) * 3.0 * (cam === 'track' ? res.doppler : 1.0);
          voice.osc.frequency.setTargetAtTime(oFreq, t, 0.02);

          const distNorm = Math.max(0, 1 - cand.dist / 180);
          const oVol = distNorm * distNorm * (0.09 + (cand.car.throttle || 0) * 0.14);
          voice.gain.gain.setTargetAtTime(oVol, t, 0.04);

          if (voice.pan) voice.pan.pan.setTargetAtTime(res.pan, t, 0.05);

          const oLp = Math.max(900, 4800 - cand.dist * 10);
          voice.lp.frequency.setTargetAtTime(oLp, t, 0.05);
        } else {
          voice.gain.gain.setTargetAtTime(0, t, 0.08);
        }
      }
    } else {
      for (const voice of this.secondaryVoices) {
        voice.gain.gain.setTargetAtTime(0, t, 0.05);
      }
    }

    // ==========================================
    // 6. CHIRRIDO DE NEUMÁTICOS Y GRAVA
    // ==========================================
    const brakeLock = Math.min(1, (car.lock || 0) * 1.4);   // solo si bloquea (antes: en cualquier frenada fuerte)
    const slideInt = (Math.abs(car.slide || 0) * 5 + Math.abs(car.beta || 0) * 8) * Math.min(1, carSpeed / 15);
    const totalSkid = Math.max(0, Math.min(1, Math.max(brakeLock, slideInt)));

    const screechVol = isMuted ? 0 : totalSkid * (onboard ? 0.20 : 0.14) * Math.min(1, carSpeed / 10);
    this.screechGain.gain.setTargetAtTime(screechVol, t, 0.05);

    const offTrack = Math.abs(car.d || 0) > 10.6 && carSpeed > 4 && !car.inPit;   // pista de 18 m + piano
    const gravelVol = isMuted || !offTrack ? 0 : Math.min(1, carSpeed / 25) * 0.22;
    this.gravelGain.gain.setTargetAtTime(gravelVol, t, 0.06);
  }
}
