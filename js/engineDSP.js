// Motor V6 por explosiones: en vez de osciladores (sonaba a sintetizador), un tren de pulsos de presión —uno por
// cilindro, 3 por vuelta del cigüeñal— con pequeñas diferencias entre cilindros y de un ciclo a otro, que pasa por
// el escape (resonancias + tubo). Con gas los pulsos son fuertes y secos; sin gas, débiles y con algún petardeo.
// Es una función pura para poder usarla dentro de un AudioWorklet y también en node (tools/engineWav.mjs).
export function makeV6(sr, seed = 1) {
  let rs = seed >>> 0 || 1;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
  const cyl = [1.0, 0.86, 1.1, 0.93, 1.04, 0.84];      // cada cilindro suena un poco distinto (bancadas, escape)
  // resonador de 2 polos (paso banda) con frecuencia y Q
  const res = (f, q) => ({ f, q, y1: 0, y2: 0 });
  const R = [res(420, 2.2), res(1150, 3.0), res(2600, 3.5), res(160, 1.2), res(85, 1.4)];
  const RG = [0.9, 0.55, 0.22, 0.6, 0.9];   // (85 Hz: cuerpo del bloque, los subgraves)
  const comb = new Float32Array(Math.round(sr * 0.01)); let cw = 0;
  let phase = 0, env = 0, nEnv = 0, lp = 0, last = 0, dc = 0, next = 0;
  return function process(out, n, rpm, load, cut) {
    const cycleHz = rpm / 120;                          // ciclo de 4 tiempos = 2 vueltas
    const fire = cycleHz * 6;
    const tau = Math.max(0.0006, 0.35 / fire);         // cuánto dura cada pulso
    const dEnv = Math.exp(-1 / (sr * tau)), dNoise = Math.exp(-1 / (sr * 0.0012));
    const bright = 0.18 + 0.55 * load;                  // con gas, pulsos más secos (más agudos)
    for (const r of R) { const w = 2 * Math.PI * r.f / sr; r.a1 = -2 * Math.exp(-w / (2 * r.q)) * Math.cos(w); r.a2 = Math.exp(-w / r.q); r.b = 1 - Math.exp(-w / (2 * r.q)); }
    for (let i = 0; i < n; i++) {
      phase += cycleHz / sr;
      if (phase >= 1) phase -= 1;
      const k = Math.floor(phase * 6);
      if (k !== next) {
        next = k;
        // explosión: fuerza según gas; en corte de encendido no hay
        const onLoad = 0.28 + 0.72 * load;
        let a = cyl[k] * onLoad * (0.92 + 0.16 * rnd()) * (1 - cut);
        // sin gas y con vueltas: a veces una explosión en el escape (petardeo)
        if (load < 0.15 && rpm > 8000 && rnd() < 0.05) a = 1.3 + rnd() * 0.6;
        env += a; nEnv += a * (0.35 + 0.5 * (1 - load));
      }
      const noise = (rnd() * 2 - 1) * nEnv;
      const x = env + noise * 0.6;
      env *= dEnv; nEnv *= dNoise;
      lp += bright * (x - lp);                          // más o menos brillo según el gas
      let y = lp * 0.35;
      for (let r = 0; r < R.length; r++) {
        const Z = R[r], v = Z.b * lp - Z.a1 * Z.y1 - Z.a2 * Z.y2;
        Z.y2 = Z.y1; Z.y1 = v; y += v * RG[r];
      }
      // tubo de escape: eco muy corto que da el timbre metálico
      // (el retardo cambia con las vueltas, como la onda de presión en el escape: fijo sonaba a chicharra metálica)
      const dly = Math.min(comb.length - 2, sr * (0.0016 + 0.0022 * (1 - (rpm - 4000) / 9000)));
      const rp = cw - dly, i0 = Math.floor(rp), fr = rp - i0, L = comb.length;
      const del = comb[(i0 + L) % L] * (1 - fr) + comb[(i0 + 1 + L) % L] * fr;
      const yc = y + 0.28 * del; comb[cw] = yc; cw = cw + 1 >= L ? 0 : cw + 1;
      // quitar continua y saturar suave
      dc += 0.0015 * (yc - dc);
      const s = Math.tanh((yc - dc) * 0.25);
      last = s; out[i] = s * 0.75;
    }
    return last;
  };
}
