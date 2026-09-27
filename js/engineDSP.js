// Motor V6 por explosiones: en vez de osciladores (sonaba a sintetizador), un tren de pulsos de presión —uno por
// cilindro, 3 por vuelta del cigüeñal— con pequeñas diferencias entre cilindros y de un ciclo a otro, que pasa por
// el escape (resonancias + tubo). Con gas los pulsos son densos, graves y con cuerpo; sin gas, suaves y con petardeo.
// Es una función pura para poder usarla dentro de un AudioWorklet y también en node (tools/engineWav.mjs).
export function makeV6(sr, seed = 1) {
  let rs = seed >>> 0 || 1;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
  const cyl = [1.02, 0.88, 1.08, 0.92, 1.05, 0.85];      // balance y asimetría de flujo entre cilindros / bancadas
  // resonador de 2 polos (paso banda) con frecuencia y Q
  const res = (f, q) => ({ f, q, y1: 0, y2: 0 });
  const R = [res(360, 1.9), res(860, 1.8), res(1900, 1.4), res(150, 1.4), res(80, 1.6)];
  // medio orden (media frecuencia de encendido): el «bramido» grave del escape de un V6, que sigue a las vueltas
  const half = res(200, 2.2);
  const comb = new Float32Array(Math.round(sr * 0.01)); let cw = 0;
  let combLp = 0;
  let phase = 0, env = 0, nEnv = 0, lp = 0, last = 0, dc = 0, next = 0;
  return function process(out, n, rpm, load, cut) {
    const cycleHz = rpm / 120;                          // ciclo de 4 tiempos = 2 vueltas
    const fire = cycleHz * 6;
    const tau = Math.max(0.0006, (0.35 + 0.22 * load) / fire); // pulso con mayor masa acústica bajo carga
    const dEnv = Math.exp(-1 / (sr * tau)), dNoise = Math.exp(-1 / (sr * 0.0013));
    const bright = 0.18 + 0.15 * load;                  // brillo controlado con gas para evitar silbido de sintetizador
    // Ganancias de formantes: con gas dominan los subgraves y cuerpo (80 y 150 Hz)
    const RG = [
      0.80 - 0.10 * load,                               // 360 Hz: garganta de escape / rugido medio
      0.45 - 0.25 * load,                               // 860 Hz: mordida mecánica
      0.22 - 0.12 * load,                               // 1900 Hz: timbre metálico suave
      0.60 + 0.45 * load,                               // 150 Hz: pegada de cigüeñal y escape
      0.90 + 0.55 * load                                // 80 Hz: subgrave y masa del bloque
    ];
    half.f = Math.min(900, fire * 0.5); half.q = 2.2;
    for (const r of [...R, half]) {
      const w = 2 * Math.PI * r.f / sr;
      r.a1 = -2 * Math.exp(-w / (2 * r.q)) * Math.cos(w);
      r.a2 = Math.exp(-w / r.q);
      r.b = 1 - Math.exp(-w / (2 * r.q));
    }
    for (let i = 0; i < n; i++) {
      // Micro-irregularidad torsional / combustión estocástica bajo carga
      const jitter = (rnd() * 2 - 1) * 0.024 * load;
      phase += (cycleHz * (1 + jitter)) / sr;
      if (phase >= 1) phase -= 1;
      const k = Math.floor(phase * 6);
      if (k !== next) {
        next = k;
        // explosión: fuerza según gas; en corte de encendido no hay
        const onLoad = 0.28 + 0.72 * load;
        // las dos bancadas no suenan igual (escapes de distinta longitud): esa alternancia es la que da energía a media
        // frecuencia de encendido, el tono grave que se oye por debajo del aullido
        const bank = k % 2 ? 1 - 0.32 * load : 1 + 0.32 * load;
        let a = cyl[k] * bank * onLoad * (0.90 + 0.20 * rnd()) * (1 - cut);
        // sin gas y con vueltas: petardeo en el escape
        if (load < 0.15 && rpm > 8000 && rnd() < 0.05) a = 1.3 + rnd() * 0.6;
        env += a;
        nEnv += a * (0.35 + 0.5 * (1 - load) + 0.28 * load);
      }
      // Textura mecánica / raspado de combustión
      const noise = (rnd() * 2 - 1) * nEnv;
      const x = env + noise * (0.50 + 0.18 * load);
      env *= dEnv; nEnv *= dNoise;
      lp += bright * (x - lp);
      let y = lp * (0.32 + 0.06 * (1 - load));
      for (let r = 0; r < R.length; r++) {
        const Z = R[r], v = Z.b * lp - Z.a1 * Z.y1 - Z.a2 * Z.y2;
        Z.y2 = Z.y1; Z.y1 = v; y += v * RG[r];
      }
      { const v = half.b * lp - half.a1 * half.y1 - half.a2 * half.y2; half.y2 = half.y1; half.y1 = v; y += v * 1.3 * load; }   // (sin gas, nada: la retención gustaba como estaba)
      // Tubo de escape con amortiguación de agudos en la realimentación
      const dly = Math.min(comb.length - 2, sr * (0.0016 + 0.0022 * (1 - (rpm - 4000) / 9000)));
      const rp = cw - dly, i0 = Math.floor(rp), fr = rp - i0, L = comb.length;
      const del = comb[(i0 + L) % L] * (1 - fr) + comb[(i0 + 1 + L) % L] * fr;
      const combDamp = 0.22 + 0.48 * (1 - load);
      combLp += combDamp * (del - combLp);
      const fbGain = 0.28 * (1 - 0.35 * load);
      const yc = y + fbGain * combLp;
      comb[cw] = yc; cw = cw + 1 >= L ? 0 : cw + 1;
      // Quitar continua y saturación analógica suave
      dc += 0.0015 * (yc - dc);
      const dry = yc - dc;
      const drive = 0.25 + 0.06 * load;
      const s = Math.tanh(dry * drive);
      last = s; out[i] = s * 0.80;
    }
    return last;
  };
}
