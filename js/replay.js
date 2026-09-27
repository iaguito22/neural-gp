// Repeticiones: se graba cada fotograma lo que hace falta para dibujar los coches (búfer circular de ~90 s de sim) y,
// al reproducir, la simulación se congela y esos campos se sustituyen por lo grabado (interpolado); director, efectos y
// audio funcionan igual que en directo. Al volver al directo se restaura el estado exacto de cada coche.
// Salen con la tecla R / botón, y solas tras un accidente, un trompo arriba o un adelantamiento por el podio.
const NUM = ['s', 'd', 'dPrev', 'vs', 'v', 'yaw', 'steer', 'slide', 'pitch', 'roll', 'lock', 'beta', 'gear', 'rpm', 'throttle', 'brake'];
const STATES = ['track', 'grid', 'garage'], PHASES = ['', 'in', 'stop', 'out', 'box'], TYRES = ['S', 'M', 'H', 'I', 'W'];
const F = NUM.length + 7;           // + drs, state, inPit, pitPhase, spin, out, tyre
const HZ_MAX = 40, KEEP = 90;       // como mucho 40 fotos por segundo de sim; 90 s

export class Replay {
  constructor(app, sim, dir) {
    this.app = app; this.sim = sim; this.dir = dir;
    this.n = sim.cars.length; this.cap = HZ_MAX * KEEP;
    this.buf = new Float32Array(this.cap * this.n * F); this.ts = new Float64Array(this.cap);
    this.head = 0; this.count = 0; this.sess = null;
    this.active = false; this.auto = true; this.pending = null; this.lastAuto = -1e9;
    const bar = this.bar = document.createElement('div'); bar.id = 'replayBar';
    document.getElementById('hud').appendChild(bar);
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'live') this.stop(); else if (a === 'slow') { this.rate = this.rate === 1 ? 0.4 : 1; this.drawBar(); }
    });
    sim.on((e) => this.onEvent(e));
  }

  // --- grabación
  record() {
    const sim = this.sim, ss = sim.session; if (!ss) return;
    if (ss !== this.sess) { this.sess = ss; this.count = 0; this.pending = null; }
    const t = sim.t;
    if (this.count && t - this.ts[(this.head - 1 + this.cap) % this.cap] < 1 / HZ_MAX - 1e-6) return;
    const k = this.head, base = k * this.n * F, B = this.buf;
    sim.cars.forEach((c, i) => {
      let o = base + i * F;
      for (const f of NUM) B[o++] = c[f] ?? 0;
      B[o++] = c.drs ? 1 : 0; B[o++] = Math.max(0, STATES.indexOf(c.state)); B[o++] = c.inPit ? 1 : 0;
      B[o++] = Math.max(0, PHASES.indexOf(c.pitPhase || '')); B[o++] = c.mistake?.type === 'spin' ? 1 : 0; B[o++] = c.out || c.retired ? 1 : 0;
      B[o++] = Math.max(0, TYRES.indexOf(c.tyre.c));
    });
    this.ts[k] = t; this.head = (k + 1) % this.cap; this.count = Math.min(this.cap, this.count + 1);
  }
  oldest() { return this.count ? this.ts[(this.head - this.count + this.cap) % this.cap] : 0; }
  newest() { return this.count ? this.ts[(this.head - 1 + this.cap) % this.cap] : 0; }
  // índice del último fotograma con tiempo <= t
  find(t) {
    let lo = 0, hi = this.count - 1;
    const at = (j) => this.ts[(this.head - this.count + j + this.cap) % this.cap];
    if (t <= at(0)) return 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (at(m) <= t) lo = m; else hi = m - 1; }
    return lo;
  }

  // --- repeticiones automáticas
  onEvent(e) {
    const sim = this.sim, race = sim.session?.id === 'RACE';
    if (!this.auto || this.active || !e.car) return;
    let big = false;
    if (e.type === 'retire' && e.why === 'accidente') big = true;
    else if (e.type === 'mistake' && e.kind === 'spin' && (e.car === this.dir.focus || (race && e.car.pos <= 8))) big = true;
    else if (e.type === 'overtake' && race && e.pos <= 3 && sim.t - sim.raceStart > 20) big = true;
    else if (e.type === 'contact' && !e.wall && e.sev > 8) big = true;
    if (!big || sim.t - this.lastAuto < 30) return;
    if (this.pending && this.pending.at > sim.t) return;
    this.pending = { car: e.car, t: sim.t, at: sim.t + 4, why: e.type };
  }

  // --- reproducir
  start(car, t0, t1, why = '') {
    if (this.active || this.count < 10) return false;
    t0 = Math.max(this.oldest(), t0); t1 = Math.min(this.newest(), t1);
    if (t1 - t0 < 2) return false;
    const D = this.dir;
    this.saved = this.sim.cars.map((c) => { const o = {}; for (const f of NUM) o[f] = c[f]; Object.assign(o, { drs: c.drs, state: c.state, inPit: c.inPit, pitPhase: c.pitPhase, mistake: c.mistake, out: c.out, tc: c.tyre.c }); return o; });
    this.savedDir = { auto: D.auto, type: D.type, focus: D.focus };
    this.active = true; this.t = t0; this.t0 = t0; this.t1 = t1; this.car = car; this.rate = 1; this.why = why;
    this.shot = -1; this.shotT = 0; this.shots = ['track', 'chase', 'heli', 'track', 'tcam'];
    D.auto = false; D.setFocus(car);
    this.bar.classList.add('on'); this.drawBar();
    document.body.classList.add('replay');
    return true;
  }
  replayLast(car, secs = 12) { return this.start(car || this.dir.focus, this.newest() - secs, this.newest(), 'manual'); }

  stop() {
    if (!this.active) return;
    this.sim.cars.forEach((c, i) => {
      const o = this.saved[i];
      for (const f of NUM) c[f] = o[f];
      c.drs = o.drs; c.state = o.state; c.inPit = o.inPit; c.pitPhase = o.pitPhase; c.mistake = o.mistake; c.out = o.out; c.tyre.c = o.tc;
    });
    const D = this.dir, S = this.savedDir;
    D.auto = S.auto; D.type = S.type; D.setFocus(S.focus); D.first = true;
    this.active = false; this.bar.classList.remove('on'); document.body.classList.remove('replay');
    this.lastAuto = this.sim.t;
  }

  drawBar() {
    const c = this.car;
    this.bar.innerHTML = `<span class="tag">REPETICIÓN</span><span class="who"><i style="background:${c.team.c1}"></i>${c.drv.last.toUpperCase()}</span>
      <span class="prog"><i></i></span><button data-a="slow">${this.rate === 1 ? 'Cámara lenta' : 'Velocidad normal'}</button><button data-a="live">Volver al directo</button>`;
  }

  // aplica el fotograma interpolado; devuelve true si está reproduciendo (el bucle no debe avanzar la sim)
  update(dt) {
    const sim = this.sim;
    if (!this.active) {
      const P = this.pending;
      if (P && sim.t >= P.at) {
        this.pending = null;
        const ok = this.app.speed > 0 && this.app.speed <= 2 && !this.app.skipping && !sim.session?.done;
        if (ok) { this.lastAuto = sim.t; this.start(P.car, P.t - 7, P.t + 3, P.why); }
      }
      if (!this.active) return false;
    }
    this.t += dt * this.rate;
    if (this.t >= this.t1) { this.stop(); return false; }
    // cambio de plano cada ~3 s
    this.shotT -= dt;
    if (this.shotT <= 0) { this.shot = (this.shot + 1) % this.shots.length; this.shotT = 3.2; this.dir.type = this.shots[this.shot]; this.dir.first = true; this.dir.trackCam = null; }
    const j = this.find(this.t), cap = this.cap, i0 = (this.head - this.count + j + cap) % cap, i1 = (i0 + 1) % cap;
    const ta = this.ts[i0], tb = j + 1 < this.count ? this.ts[i1] : ta, u = tb > ta ? Math.min(1, (this.t - ta) / (tb - ta)) : 0;
    const B = this.buf, T = sim.T;
    sim.cars.forEach((c, i) => {
      let a = i0 * this.n * F + i * F, b = (j + 1 < this.count ? i1 : i0) * this.n * F + i * F;
      for (let q = 0; q < NUM.length; q++, a++, b++) {
        const f = NUM[q], A = B[a], Bv = B[b];
        c[f] = f === 's' ? T.wrap(A + T.rel(A, Bv) * u) : A + (Bv - A) * u;
      }
      c.drs = B[a++] > 0.5; c.state = STATES[B[a++]]; c.inPit = B[a++] > 0.5; c.pitPhase = PHASES[B[a++]] || null;
      c.mistake = B[a++] > 0.5 ? { type: 'spin', t: 0, slow: 1 } : null; c.out = B[a++] > 0.5; c.tyre.c = TYRES[B[a++]] || c.tyre.c;
    });
    const pr = this.bar.querySelector('.prog i'); if (pr) pr.style.width = `${((this.t - this.t0) / (this.t1 - this.t0)) * 100}%`;
    return true;
  }
}
