// Sistema de audio sintetizado Web Audio para F1 V6 Turbo Híbrido.
// Sin archivos de audio externos. Todo sintetizado proceduralmente en tiempo real.
// Incluye: armónicos ricos V6, turbo whine y wastegate, cortes y golpes de marcha,
// petardeo suave al soltar gas, Doppler multivoz, chirrido de neumáticos, grava/pianos y ambiente.

export class EngineAudio {
  constructor() {
    this.on = false;
    this.ctx = null;
    this.prevGear = 1;
    this.prevThrottle = 0;
    this.shiftCutUntil = 0;
    this.downshiftBlipUntil = 0;
    this.lastCrackleTime = 0;
  }

  _makeDistortionCurve(k = 1.2) {
    const n = 512, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
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

  _makeV6PeriodicWave(ctx) {
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    // Armónicos del V6: fundamental, 2º armónico fuerte, orden 3, 4, 6, 8 con presencia metálica
    imag[1] = 1.0;
    imag[2] = 0.80;
    imag[3] = 0.60;
    imag[4] = 0.45;
    imag[5] = 0.32;
    imag[6] = 0.25;
    imag[7] = 0.18;
    imag[8] = 0.14;
    imag[10] = 0.09;
    imag[12] = 0.06;
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

    // Bus Master y Compresor / Limitador
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 6;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    comp.connect(ctx.destination);

    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);

    const whiteBuf = this._makeNoiseBuffer(ctx, 2.0, false);
    const pinkBuf = this._makeNoiseBuffer(ctx, 2.0, true);

    // ==========================================
    // 1. MOTOR DEL COCHE ENFOCADO (Focus Car Engine)
    // ==========================================
    const engineGain = this.engineGain = ctx.createGain();
    engineGain.gain.value = 0.32;

    const enginePanner = this.enginePanner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const engineAirFilter = this.engineAirFilter = ctx.createBiquadFilter();
    engineAirFilter.type = 'lowpass';
    engineAirFilter.frequency.value = 8000;
    engineAirFilter.Q.value = 0.5;

    const engineShaper = ctx.createWaveShaper();
    engineShaper.curve = this._makeDistortionCurve(1.2);
    engineShaper.oversample = '2x';

    // Filtro de seguimiento del acelerador
    const engineLP = this.engineLP = ctx.createBiquadFilter();
    engineLP.type = 'lowpass';
    engineLP.frequency.value = 4500;
    engineLP.Q.value = 0.7;

    // Resonancia de escape / colectores (~1350 Hz)
    const enginePeak = this.enginePeak = ctx.createBiquadFilter();
    enginePeak.type = 'peaking';
    enginePeak.frequency.value = 1350;
    enginePeak.Q.value = 1.8;
    enginePeak.gain.value = 4.5;

    // Resonancia de admisión (~2400 Hz)
    const engineIntake = this.engineIntake = ctx.createBiquadFilter();
    engineIntake.type = 'peaking';
    engineIntake.frequency.value = 2400;
    engineIntake.Q.value = 2.0;
    engineIntake.gain.value = 3.0;

    // Cadena de procesado del motor
    enginePeak.connect(engineIntake);
    engineIntake.connect(engineLP);
    engineLP.connect(engineShaper);
    engineShaper.connect(engineAirFilter);
    if (enginePanner) {
      engineAirFilter.connect(enginePanner);
      enginePanner.connect(engineGain);
    } else {
      engineAirFilter.connect(engineGain);
    }
    engineGain.connect(master);

    // Banco de órdenes armónicos del V6 Turbo Híbrido (3 detonaciones por revolución)
    const v6Wave = this._makeV6PeriodicWave(ctx);
    const harmConfigs = [
      { mult: 0.5, amp: 0.22, type: 'triangle' }, // Orden 1.5: subarmónico de bancada / cigüeñal
      { mult: 1.0, amp: 0.38, customWave: v6Wave }, // Orden 3.0: fundamental de encendido V6
      { mult: 1.5, amp: 0.28, type: 'sawtooth' }, // Orden 4.5: asimetría acústica V6
      { mult: 2.0, amp: 0.35, customWave: v6Wave }, // Orden 6.0: 2º armónico de combustión (rugido)
      { mult: 2.5, amp: 0.24, type: 'sawtooth' }, // Orden 7.5: textura intermedia
      { mult: 3.0, amp: 0.26, type: 'sawtooth' }, // Orden 9.0: 3º armónico (mordida aguda)
      { mult: 4.0, amp: 0.20, type: 'sawtooth' }, // Orden 12.0: 4º armónico (chillido metálico)
      { mult: 5.0, amp: 0.14, type: 'sawtooth' }  // Orden 15.0: presencia de altas RPM
    ];

    this.harmonics = harmConfigs.map((cfg) => {
      const o = ctx.createOscillator();
      if (cfg.customWave) o.setPeriodicWave(cfg.customWave);
      else o.type = cfg.type;
      const g = ctx.createGain();
      g.gain.value = cfg.amp;
      o.connect(g);
      g.connect(enginePeak);
      o.start();
      return { o, mult: cfg.mult, g, amp: cfg.amp };
    });

    // Modulación de grano / vibración mecánica (LFO a frecuencia de giro del motor)
    const lfo = this.grainLFO = ctx.createOscillator();
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.10;
    lfo.connect(lfoGain);
    lfoGain.connect(engineGain.gain);
    lfo.start();

    // ==========================================
    // 2. TURBOCHARGER (Whine y Wastegate)
    // ==========================================
    // Silbido del turbo (whine de alta frecuencia ~2.8 - 5.5 kHz)
    const turboOsc = this.turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    const turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 3600;
    turboFilter.Q.value = 1.4;
    const turboGain = this.turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboGain.connect(engineAirFilter);
    turboOsc.start();

    // Descarga de turbo (blow-off / wastegate hiss al soltar acelerador)
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
    wgGain.connect(engineAirFilter);
    wgNoise.start();

    // Transitorios de cambio de marcha y petardeo (pops de escape)
    const popNoise = ctx.createBufferSource();
    popNoise.buffer = whiteBuf;
    popNoise.loop = true;
    const popFilter = ctx.createBiquadFilter();
    popFilter.type = 'bandpass';
    popFilter.frequency.value = 1300;
    popFilter.Q.value = 2.4;
    const popGain = this.crackleGain = ctx.createGain();
    popGain.gain.value = 0;
    popNoise.connect(popFilter);
    popFilter.connect(popGain);
    popGain.connect(engineAirFilter);
    popNoise.start();

    // Golpe sordo de escape en reducciones (downshift thud)
    const thudNoise = ctx.createBufferSource();
    thudNoise.buffer = pinkBuf;
    thudNoise.loop = true;
    const thudFilter = ctx.createBiquadFilter();
    thudFilter.type = 'bandpass';
    thudFilter.frequency.value = 450;
    thudFilter.Q.value = 2.0;
    const thudGain = this.thudGain = ctx.createGain();
    thudGain.gain.value = 0;
    thudNoise.connect(thudFilter);
    thudFilter.connect(thudGain);
    thudGain.connect(engineAirFilter);
    thudNoise.start();

    // ==========================================
    // 3. VOCES SECUNDARIAS (Doppler en exteriores)
    // ==========================================
    this.secondaryVoices = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(v6Wave);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3000;
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
      osc.start();
      this.secondaryVoices.push({ osc, lp, pan, gain: g });
    }

    // ==========================================
    // 4. NEUMÁTICOS, SUPERFICIE Y GRAVA
    // ==========================================
    // Chirrido de neumáticos (derrape / bloqueo de frenos)
    const screechNoise = ctx.createBufferSource();
    screechNoise.buffer = whiteBuf;
    screechNoise.loop = true;
    const screechFilter1 = ctx.createBiquadFilter();
    screechFilter1.type = 'bandpass';
    screechFilter1.frequency.value = 980;
    screechFilter1.Q.value = 5.0;
    const screechFilter2 = ctx.createBiquadFilter();
    screechFilter2.type = 'bandpass';
    screechFilter2.frequency.value = 1480;
    screechFilter2.Q.value = 5.5;
    const screechGain = this.screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechNoise.connect(screechFilter1);
    screechNoise.connect(screechFilter2);
    screechFilter1.connect(screechGain);
    screechFilter2.connect(screechGain);
    screechGain.connect(master);
    screechNoise.start();

    // Superficie / grava / hierba al salirse de pista (|d| > ~6.8)
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

    // ==========================================
    // 5. AMBIENTE (Viento, Público, Lluvia)
    // ==========================================
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

    // Público lejano (murmullo / ambiente suave de gradas)
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
    const clampedVRad = Math.max(-110, Math.min(110, vRad));
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

    // 2. Volumen Master
    let masterVol = onboard ? 0.30 : cam === 'chase' ? 0.24 : 0.22 * Math.min(1, 40 / Math.max(7, dist));
    if (isMuted) masterVol = 0;
    this.master.gain.setTargetAtTime(masterVol, t, 0.08);

    if (!car) return;

    // ==========================================
    // 3. CAMBIOS DE MARCHA, DESCARGA Y PETARDEO
    // ==========================================
    const curGear = car.gear ?? 1;
    const curThrottle = car.throttle ?? 0;
    const curBrake = car.brake ?? 0;

    if (this.prevGear !== curGear && carSpeed > 8) {
      if (curGear > this.prevGear) {
        // Subida de marcha: corte rápido de encendido + pop seco (35 ms)
        this.shiftCutUntil = t + 0.038;
        this.crackleGain.gain.cancelScheduledValues(t);
        this.crackleGain.gain.setValueAtTime(0.12, t);
        this.crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      } else if (curGear < this.prevGear) {
        // Reducción: golpe/blip de revoluciones + golpe sordo de escape (70 ms)
        this.downshiftBlipUntil = t + 0.075;
        this.thudGain.gain.cancelScheduledValues(t);
        this.thudGain.gain.setValueAtTime(0.18, t);
        this.thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      }
      this.prevGear = curGear;
    }

    const inShiftCut = t < this.shiftCutUntil;
    const inDownshiftBlip = t < this.downshiftBlipUntil;

    // Descarga de turbo (wastegate)
    if (this.prevThrottle > 0.60 && curThrottle < 0.22 && carSpeed > 15) {
      this.wastegateGain.gain.cancelScheduledValues(t);
      this.wastegateGain.gain.setValueAtTime(0.08, t);
      this.wastegateGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    }
    this.prevThrottle = curThrottle;

    // Petardeo suave en retención (overrun crackle / pops)
    if (curThrottle < 0.18 && (car.rpm || 0) > 7500 && carSpeed > 15 && !inShiftCut) {
      if (t - this.lastCrackleTime > 0.045 + Math.random() * 0.04) {
        this.lastCrackleTime = t;
        const popIntensity = 0.06 + Math.random() * 0.08;
        this.crackleGain.gain.cancelScheduledValues(t);
        this.crackleGain.gain.setValueAtTime(popIntensity, t);
        this.crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      }
    }

    // ==========================================
    // 4. MOTOR PRINCIPAL: ARMÓNICOS Y DOPPLER
    // ==========================================
    let focusDoppler = 1.0;
    let focusPan = 0;
    if (!onboard && camPos && focusPos) {
      const focusVis = visuals ? visuals[car.i] : null;
      const rotY = focusVis?.root?.rotation?.y ?? 0;
      const res = this._calcDopplerAndPan(car, focusPos, rotY, camPos, camRight);
      focusDoppler = res.doppler;
      focusPan = res.pan;
    }

    if (this.enginePanner) {
      this.enginePanner.pan.setTargetAtTime(onboard ? 0 : focusPan, t, 0.05);
    }

    let effRpm = Math.max(4800, car.rpm || 4800) * (carSpeed < 0.5 ? 0.7 : 1);
    if (inDownshiftBlip) effRpm = Math.min(12500, effRpm + 1900);

    // Frecuencia base de encendido (3 detonaciones por revolución)
    const firingFreq = (effRpm / 60) * 3.0 * focusDoppler;

    // Actualización dinámica de armónicos
    for (const h of this.harmonics) {
      h.o.frequency.setTargetAtTime(firingFreq * h.mult, t, 0.035);
      const dynGain = h.amp * (h.mult >= 2.0 ? 0.50 + curThrottle * 0.90 : 0.75 + curThrottle * 0.45);
      h.g.gain.setTargetAtTime(dynGain, t, 0.05);
    }

    // Grano mecánico
    this.grainLFO.frequency.setTargetAtTime((effRpm / 60) * focusDoppler, t, 0.04);

    // Filtros de timbre
    const lpFreq = onboard
      ? 2800 + curThrottle * 4700
      : Math.max(1100, (1600 + curThrottle * 2600) - dist * 10);
    this.engineLP.frequency.setTargetAtTime(lpFreq, t, 0.06);

    const airFreq = onboard ? 8500 : Math.max(1400, 7500 - dist * 22);
    this.engineAirFilter.frequency.setTargetAtTime(airFreq, t, 0.08);

    // Turbocharger Whine
    const turboFreq = 2600 + (effRpm - 4800) * 0.30 + curThrottle * 1400;
    this.turboOsc.frequency.setTargetAtTime(turboFreq * (onboard ? 1 : focusDoppler), t, 0.06);
    const turboVol = (0.008 + 0.042 * Math.pow(curThrottle, 1.6)) * (onboard ? 1.0 : 0.65);
    this.turboGain.gain.setTargetAtTime(turboVol, t, 0.08);

    // Ganancia del cuerpo del motor (con corte en subida de marcha)
    let bodyVol = 0.24 + curThrottle * 0.38;
    if (inShiftCut) bodyVol *= 0.10;
    this.engineGain.gain.setTargetAtTime(bodyVol, t, inShiftCut ? 0.005 : 0.06);

    // ==========================================
    // 5. VOCES SECUNDARIAS (Doppler en exteriores)
    // ==========================================
    if (!onboard && sim?.cars && visuals && camPos) {
      const candidates = [];
      for (const otherCar of sim.cars) {
        if (otherCar === car || otherCar.state === 'garage' || otherCar.retired) continue;
        const vis = visuals[otherCar.i];
        if (!vis?.root?.position) continue;
        const oPos = vis.root.position;
        const d = Math.hypot(camPos.x - oPos.x, camPos.y - oPos.y, camPos.z - oPos.z);
        if (d < 160) candidates.push({ car: otherCar, pos: oPos, rotY: vis.root.rotation.y, dist: d });
      }

      candidates.sort((a, b) => a.dist - b.dist);

      for (let i = 0; i < this.secondaryVoices.length; i++) {
        const voice = this.secondaryVoices[i];
        const cand = candidates[i];
        if (cand && !isPaused) {
          const res = this._calcDopplerAndPan(cand.car, cand.pos, cand.rotY, camPos, camRight);
          const oRpm = Math.max(4800, cand.car.rpm || 4800);
          const oFreq = (oRpm / 60) * 3.0 * res.doppler;
          voice.osc.frequency.setTargetAtTime(oFreq, t, 0.04);

          const distNorm = Math.max(0, 1 - cand.dist / 160);
          const oVol = distNorm * distNorm * (0.06 + (cand.car.throttle || 0) * 0.09);
          voice.gain.gain.setTargetAtTime(oVol, t, 0.06);

          if (voice.pan) voice.pan.pan.setTargetAtTime(res.pan, t, 0.05);

          const oLp = Math.max(500, 3800 - cand.dist * 18);
          voice.lp.frequency.setTargetAtTime(oLp, t, 0.06);
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
    const brakeLock = curBrake > 0.35 && carSpeed > 8 ? (curBrake - 0.35) * 1.6 : 0;
    const slideInt = (Math.abs(car.slide || 0) * 5 + Math.abs(car.beta || 0) * 8) * Math.min(1, carSpeed / 15);
    const totalSkid = Math.max(0, Math.min(1, Math.max(brakeLock, slideInt)));

    const screechVol = isMuted ? 0 : totalSkid * (onboard ? 0.20 : 0.14) * Math.min(1, carSpeed / 10);
    this.screechGain.gain.setTargetAtTime(screechVol, t, 0.05);

    const offTrack = Math.abs(car.d || 0) > 6.8 && carSpeed > 4;
    const gravelVol = isMuted || !offTrack ? 0 : Math.min(1, carSpeed / 25) * 0.22;
    this.gravelGain.gain.setTargetAtTime(gravelVol, t, 0.06);
  }
}
