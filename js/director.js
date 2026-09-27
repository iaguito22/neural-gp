// Cámaras: on-board (cockpit, T-cam, morro, trasera), persecución, helicóptero, cámaras de pista tipo TV
// y cámara libre. El director automático elige piloto y plano según lo que está pasando.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAM_MOUNTS } from './carModel.js';
import { HALF_W } from './track.js';
import { SESSIONS } from './sim.js';
import { TEAMS } from './teams.js';

const SESSIONS_CUT = { Q1: SESSIONS.Q1.cut, Q2: SESSIONS.Q2.cut, Q3: 0 };

export const CAM_TYPES = ['chase', 'cockpit', 'tcam', 'nose', 'rear', 'heli', 'track', 'free'];
export const CAM_LABEL = { chase: 'Exterior', cockpit: 'Cockpit', tcam: 'T-Cam', nose: 'Morro', rear: 'Trasera', heli: 'Dron', track: 'Pista', free: 'Libre' };

// peso de una posición: arriba vale mucho más (victoria, podio, puntos)
const posW = (p) => (p === 1 ? 1 : p <= 3 ? 0.85 : p <= 6 ? 0.7 : p <= 10 ? 0.55 : p <= 15 ? 0.33 : 0.22);

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

export class Director {
  constructor(camera, dom, T, sim, world, visuals) {
    this.cam = camera; this.T = T; this.sim = sim; this.world = world; this.vis = visuals;
    this.auto = true; this.type = 'heli'; this.focus = sim.cars[0];
    this.shotT = 0; this.shotLen = 6; this.holdFocus = 0;
    this.smoothPos = new THREE.Vector3(); this.smoothLook = new THREE.Vector3(); this.first = true;
    this.fov = 60; this.trackCam = null; this.reason = '';
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.maxDistance = 400; this.controls.minDistance = 4;
    this.buildTrackCams();
    this.events = []; this.seen = [];
    sim.on((e) => this.onEvent(e));
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const f of this.listeners) f(this); }

  buildTrackCams() {
    const T = this.T, cams = [];
    const P = [0, 0, 0];
    let k = 0;
    // nocturno: carteles altos sobre el muro: cámaras más altas y algo más atrás, y más a menudo
    const night = T.id === 'night', hK = night ? 5 : 0, oK = night ? 3 : 0;
    const add = (s, side, h, off, tag) => {
      const B = this.world.barrier(s, side);
      h += hK; off += oK;
      T.pos(s, side * (B + off), P);
      const gy = Math.max(P[1], this.world.groundY(P[0], P[2]));
      cams.push({ s: T.wrap(s), pos: new THREE.Vector3(P[0], gy + h, P[2]), side, tag });
    };
    // en cada curva: una a la salida (por fuera) y otra antes de la frenada
    for (const c of T.corners) {
      const out = -(Math.sign(c.dir) || 1);
      add(c.apex, out, 9.5 + (k % 3) * 2, 4, 'curva');
      add(c.sIn - 160, (k % 2 ? 1 : -1), 9 + (k % 2) * 3, 4, 'frenada');
      k++;
    }
    const stepS = night ? 150 : 230;
    for (let s = 0; s < T.L; s += stepS) add(s + 60, (Math.floor(s / stepS) % 2 ? 1 : -1), 9 + (Math.floor(s / 100) % 3) * 2, 4, 'recta');
    // meta: una antes de la línea (se ve llegar el coche) y otra justo después, en el lado de la tribuna
    add(-70, 1, 12, 4, 'meta'); add(30, 1, 10, 4, 'meta');
    // pit lane
    for (const b of [T.pit.boxes[2], T.pit.boxes[7]]) { T.pos(b.s + 40, T.pit.wallD - 2, P); cams.push({ s: T.wrap(b.s + 40), pos: new THREE.Vector3(P[0], P[1] + 4, P[2]), side: -1, tag: 'boxes' }); }
    cams.sort((a, b) => a.s - b.s);
    this.trackCams = cams;
  }

  setType(t, manual = true) {
    if (manual) { this.auto = false; this.lockFocus = false; }
    if (t === 'free' && this.type !== 'free') {
      const cp = this.vis[this.focus.i].root.position;
      this.controls.target.copy(cp);
      this.cam.position.set(cp.x + 18, cp.y + 10, cp.z + 18);
    }
    this.type = t; this.controls.enabled = t === 'free'; this.first = true; this.trackCam = null; this.shotT = 0;
    this.changed();
  }
  setFocus(car, manual = true) {
    if (manual && !this.lockFocus) this.auto = false;
    if (car === this.focus) return;
    this.focus = car; this.first = true; this.trackCam = null; this.shotT = 0; this.changed();
  }
  setAuto(on) { this.auto = on; this.lockFocus = false; this.shotT = this.shotLen; this.holdFocus = 0; if (on && this.type === 'free') this.setType('track', false); this.changed(); }
  // realización automática pegada a un piloto: elige los planos, no el coche
  setAutoDriver(on) { this.auto = on; this.lockFocus = on; this.shotT = this.shotLen; if (on && this.type === 'free') this.setType('track', false); this.changed(); }

  onEvent(e) {
    // peso = interés; las salidas de pista pesan poco (no justifican dejar una buena pelea)
    const W = { retire: 16, spin: 14, off: 4, wide: 2, contact: 8 };
    if (e.type === 'mistake' || e.type === 'retire' || e.type === 'contact') {
      const k = e.type === 'mistake' ? e.kind : e.type;
      if (e.type === 'contact' && e.sev < 6) return;
      this.events.push({ car: e.car, w: W[k] || 6, big: k === 'retire' || k === 'spin' || (k === 'contact' && e.sev > 10), until: this.sim.t + (k === 'spin' || k === 'retire' ? 8 : 5) });
    }
    if (e.type === 'overtake') this.events.push({ car: e.car, w: 3 + 8 * posW(e.pos || e.car.pos), until: this.sim.t + 5 });
    if (e.type === 'pitstop' && this.sim.session?.id === 'RACE') this.events.push({ car: e.car, w: 2 + 6 * posW(e.car.pos), until: this.sim.t + 6, pit: true });
    if (e.type === 'fastest') this.events.push({ car: e.car, w: 4, until: this.sim.t + 4 });
    if (this.events.length > 40) this.events.splice(0, 10);
  }

  // ---- caos por el tiempo: el que se la juega con otra goma que casi nadie lleva (lluvia sobre lisos, lisos sobre húmedo)
  // interesa unas vueltas para ver cómo va; si va más rápido que los demás, más; si pierde mucho, deja de interesar
  gamble() {
    const sim = this.sim, W = sim.wx, now = sim.t;
    if (this._gbT != null && this._gbT <= now && now - this._gbT < 1) return this._gb;
    this._gbT = now; const m = this._gb = new Map();
    if (!W || (W.rain < 0.05 && W.wet < 0.05)) return m;
    const run = sim.cars.filter((c) => !c.out && !c.retired && !c.finished && c.state !== 'garage');
    const wetT = (c) => c.tyre.c === 'I' || c.tyre.c === 'W';
    const nW = run.filter(wetT).length;
    if (nW === 0 || nW === run.length) return m;
    const minWet = nW / run.length < 0.35, minSlick = nW / run.length > 0.65;
    if (!minWet && !minSlick) return m;
    const odd = run.filter((c) => (minWet ? wetT(c) : !wetT(c)) && c.tyre.age <= 5);
    const rest = run.filter((c) => (minWet ? !wetT(c) : wetT(c)) && c.lastLap > 0).map((c) => c.lastLap).sort((a, b) => a - b);
    const med = rest[rest.length >> 1];
    for (const c of odd) {
      let v = 5 + 6 * posW(c.pos);
      if (c.tyre.age >= 2 && c.lastLap > 0 && med) {
        const d = c.lastLap - med;
        if (d < -0.4) v *= 1.4 + Math.min(1, -d / 4);        // la apuesta sale bien: a verlo
        else if (d > 2.5) v = 0;                              // va mucho más lento: ya no interesa
        else if (d > 0.8) v *= 0.5;
      }
      if (v > 0) m.set(c, v);
    }
    return m;
  }

  // ---- interés de cada coche
  score(car) {
    const sim = this.sim, T = this.T, ss = sim.session;
    if (!ss || car.out || car.state === 'garage' || car.parked) return -1;
    let s = 0; const why = [];
    const race = ss.id === 'RACE';
    let battle = 0;
    if (race) {
      const started = ss.phase === 'green' || ss.phase === 'flag';
      const early = started && sim.t - sim.raceStart < 20;
      if (!started || early) s += car.pos === 1 ? 20 : car.pos <= 5 ? 6 - car.pos : 0;
      if (car.finished && this.sim.t - car.finishT < 6 && car.finishPos <= 3) { s += 25; why.push('meta'); }
      const gb = this.gamble().get(car);
      if (gb) { s += gb; why.push('lap'); }
      const ah = sim.carAheadOnTrack(car);
      if (ah && !car.inPit && !ah.inPit && started && !early && !car.finished) {
        const rel = T.ahead(car.s, ah.s);
        const gap = rel / Math.max(20, car.v);
        const lapDiff = Math.round((ah.dist - car.dist - rel) / T.L);
        if (rel > 0 && gap < 1.0 && lapDiff === 0 && !ah.retired) {
          // la pelea vale más cuanto más arriba: por la victoria, por el podio, por los puntos
          const w = posW(ah.pos);
          battle = (8 + 10 * (1 - gap) + (rel < 8 ? 5 : 0)) * w + 4 * w;
          s += battle; why.push('battle');
          if (rel < 8) why.push('side');
          if (car === this.focus || ah === this.focus) s += 1.5 + 3 * w;   // seguir con la misma pelea (más cuanto más arriba)
        }
        // se está acercando al de delante (a menos de 2 s) en las posiciones de arriba
        else if (rel > 0 && gap < 2.2 && lapDiff === 0 && ah.pos <= 6) { s += 5 * posW(ah.pos) * (2.2 - gap); why.push('chase'); }
      }
      if (car.mode === 'attack') s += 1.5 * posW(car.pos);
      // muy rápido ahora mismo (remontando): algo de prioridad
      if (car.lastLap && sim.fastest && car.lastLap < sim.fastest.t + 0.4 && car.lap > 1) { s += 2; why.push('fast'); }
      if (car.lap === sim.raceLaps - 1 && car.pos <= 3) s += 4;
      if (car.pos === 1) s += 1;                               // el líder solo, apenas
    } else if (car.lapKind === 'push' && !car.inPit) {
      // clasificación/libres: manda la vuelta lanzada, según lo buena que va
      s += 3;
      const best = sim.fastest?.t;
      if (car.delta != null && best) {
        const proj = best + car.delta;
        const cls = sim.classification(); let pp = cls.findIndex((c) => !(c.best < proj)); if (pp < 0) pp = cls.length;
        s += Math.max(0, 9 - pp * 1.1); why.push('lap');
        if (car.delta < 0) { s += 6; why.push('purple'); }
        const cut = ss.id !== 'FP' ? SESSIONS_CUT[ss.id] : 0;
        if (cut && Math.abs(pp - cut) <= 2 && ss.dur - sim.t < 200) { s += 5; why.push('bubble'); }
        if (car.sector === 2) s += 2 + Math.max(0, 3 - Math.abs(car.delta) * 5);      // final de una vuelta buena
      } else if (!car.lapClean) s -= 3;
      else s += 1;
      if (car.secCol?.includes('purple')) { s += 2; why.push('purple'); }
      if (ss.id.startsWith('Q') && ss.phase === 'flag') s += 4;
      if (car === this.focus && car.lapClean) s += 5;              // no cortar una vuelta buena a medias
    } else if (car.lapKind === 'out') s += 0.5;
    else s -= 1;
    for (const ev of this.events) if (ev.car === car && sim.t < ev.until) { s += ev.w; why.push(ev.pit ? 'pit' : ev.big ? 'crash' : 'event'); }
    if (car.mistake?.type === 'spin') { s += 8; why.push('mistake'); }
    if (car.inPit && car.pitPhase === 'stop' && race) { s += 1 + 5 * posW(car.pos); why.push('pit'); }
    return { s, why, battle };
  }

  // ---- libres y clasificación: realización por historias
  // Cada coche en pista es una posible historia y se elige la de más valor y se sigue entera (la vuelta lanzada completa,
  // con los planos alternando dentro y fuera, la llegada a meta desde una cámara de meta y unos segundos para ver el tiempo).
  // Libres: lo que cuenta es cómo aprenden: quien está mejorando su propia vuelta (más si sube en la tabla), un error,
  // el tráfico (uno en vuelta rápida que se echa encima de otro) y, cuando no pasa nada, ir pasando por pilotos que hace
  // rato que no salen. Clasificación: la vuelta que va a mejorar la tabla y, sobre todo en Q1 y Q2, los que se juegan
  // quedar eliminados (los que están en la zona de corte o justo encima).
  storyOf(car, ctx) {
    const sim = this.sim, T = this.T, ss = sim.session, fp = ss.id === 'FP';
    if (car.out || car.retired || car.state === 'garage' || car.parked) return null;
    const toLine = T.ahead(car.s, 0), frac = 1 - toLine / T.L;
    if (car.mistake && (car.mistake.type === 'spin' || car.mistake.type === 'off')) return { kind: 'mistake', v: car.mistake.type === 'spin' ? 16 : fp ? 7 : 8 };
    for (const ev of this.events) if (ev.car === car && sim.t < ev.until && ev.big) return { kind: 'mistake', v: 12 };
    if (car.inPit) {
      // salida de boxes: al principio de la sesión, un poco; luego apenas (no ir saltando de coche en coche por el pit lane)
      if (car.pitPhase === 'out' && T.ahead(car.s, T.pit.exitA) < 260) return { kind: 'pitexit', v: (sim.t < 150 ? 2.2 : 1.2) + (ctx.posNow(car) <= 5 ? 1 : 0) };
      return null;
    }
    const now = ctx.posNow(car), cut = ctx.cut;
    // en la zona de eliminación (o a dos puestos de ella) en Q1/Q2: interesa más todo lo que hace
    const danger = cut && (now > cut - 2) ? (now > cut ? 1 : 0.6) : 0;
    if (car.lapKind === 'push' && car.lapClean) {
      let v, p = null, good = true;
      if (car.delta != null && ctx.best) {
        const proj = ctx.best + car.delta;
        p = ctx.posOf(proj, car);
        const own = car.deltaOwn;
        if (isFinite(car.best) && (own != null ? own > 0.05 : proj > car.best + 0.05)) { good = false; v = 1.5 + 2.5 * danger; }   // no va a mejorar
        else {
          v = p === 1 ? 13 : p <= 3 ? 10 : p <= 6 ? 8 : p <= 10 ? 6 : 4;
          if (now > p) v += Math.min(fp ? 5 : 3, (now - p) * (fp ? 0.6 : 0.4));                 // sube puestos
          if (fp && own != null && own < -0.15) v += Math.min(3, -own * 3);                    // libres: aprende y mejora mucho
          if (cut && (now > cut || p > cut - 2)) v += (now > cut && p <= cut ? 6 : 4) + (ctx.late ? 4 : 0);   // se salva / se la juega
          if (car.delta < 0) v += 2;
        }
      } else if (!ctx.best) v = 7;                                                             // primeras vueltas lanzadas de la sesión
      else v = 3.5 + ctx.pace(car) + 3 * danger;                                              // aún sin referencia en esta vuelta
      v *= 0.55 + 0.45 * frac;                                                                 // cuanto más cerca de meta, más vale
      if (ctx.late && !fp) v *= 1.35;
      // tráfico: se le echa encima a uno más lento (a ver si le deja pasar)
      const ah = sim.carAheadOnTrack(car);
      if (ah && !ah.inPit && T.ahead(car.s, ah.s) < 160 && car.v > ah.v + 4 && (ah.lapKind !== 'push' || ah.mode === 'yield')) {
        v += fp ? 4 : 3;
        if (fp && T.ahead(car.s, ah.s) < 90) return { kind: 'traffic', v: v + 1, p, toLine, good, other: ah };
      }
      return { kind: toLine < 1100 && good ? 'finish' : 'hotlap', v, p, toLine, good };
    }
    // sin vuelta lanzada: vuelta de salida, tanda larga, enfriando
    let v = car.lapKind === 'out' ? 1.6 : car.lapKind === 'race' || car.lapKind === 'push' ? 1.4 : 0.6;
    v += ctx.pace(car) + (car.lapKind === 'out' ? 1.5 * danger : 0);
    return { kind: 'filler', v };
  }

  directSession() {
    const sim = this.sim, ss = sim.session, T = this.T;
    if (!ss || ss.id === 'RACE') return false;
    // sesión nueva: sim.t vuelve a 0 y todo lo guardado en tiempo de sesión es de la anterior (un qHold de 724 s
    // de Q1 dejaba el director clavado en un coche todo Q2 y Q3)
    if (this.storySess !== ss) {
      this.storySess = ss; this.qHold = 0; this.storyT = null; this.lastFill = undefined; this.seen = []; this.story = null; this.qLap = null; this.lineShot = -1;
    }
    const cls = sim.classification(), best = sim.fastest?.t;
    const cut = SESSIONS_CUT[ss.id] || 0, left = ss.dur - sim.t;
    const nPos = new Map(); cls.forEach((c, k) => nPos.set(c, isFinite(c.best) ? k + 1 : 99));
    const ctx = {
      best, cut, late: left < 200 || ss.phase === 'flag',
      posOf: (t, self) => { let p = 1; for (const c of cls) if (c !== self && c.best < t) p++; return p; },
      posNow: (c) => nPos.get(c) ?? 99,
      // los de arriba de la tabla (o del fin de semana) interesan algo más cuando no pasa nada
      pace: (c) => { const n = nPos.get(c) ?? 99; return n <= 3 ? 1.2 : n <= 10 ? 0.6 : 0; },
    };
    const f = this.focus, now = sim.t;
    // acaba de cerrar la vuelta: se queda a ver el tiempo
    if (f && f.lap !== this.qLap) { const was = this.qLap; this.qLap = f.lap; if (was != null && this.story?.kind !== 'filler' && this.story?.car === f) this.qHold = now + 4; }
    if (this.qHold && now < this.qHold) { this.shotCycleS(null); return true; }
    let top = null;
    const stories = [];
    for (const car of sim.cars) {
      const st = this.storyOf(car, ctx); if (!st) continue;
      st.car = car;
      // variedad: el relleno prefiere coches que hace rato que no salen
      if ((st.kind === 'filler' || st.kind === 'pitexit') && car !== f) st.v -= Math.max(0, 3 - (now - (this.seen[car.i] ?? -1e9)) / 40);
      stories.push(st);
      if (!top || st.v > top.v) top = st;
    }
    if (!top) return true;
    const cur = f ? stories.find((x) => x.car === f) : null;
    const curV = cur ? cur.v : -1;
    // tiempo siguiendo a este coche (no desde el último plano: los planos cambian cada pocos segundos)
    const held = (this.storyT != null && this.storyT <= now ? now - this.storyT : 1e9) * 1000;
    let go = false;
    if (!cur || !this.story) go = true;
    else if (top.car !== f) {
      if (top.kind === 'mistake' && top.v >= 12 && cur.kind !== 'mistake' && !(cur.kind === 'finish' && cur.toLine < 500 && cur.v > 8)) go = true;
      else if (cur.kind === 'hotlap' || cur.kind === 'finish') {
        // no dejar una vuelta buena a medias, salvo por otra que acaba ya y vale claramente más
        const bail = !cur.good && held > 4000;
        const steal = top.kind === 'finish' && top.toLine < 900 && top.v > curV + 3 && !(cur.kind === 'finish' && cur.toLine < 700) && held > 3500;
        go = bail || steal || (held > 5000 && top.v > curV + 6);
      } else go = held > (cur.kind === 'filler' || cur.kind === 'pitexit' ? 11000 : cur.kind === 'traffic' ? 6000 : 4000) && top.v > curV + 1.5 || (held > 20000 && top.v > curV - 0.5 && top.kind !== 'filler');
      if (!go && cur.kind === 'filler' && held > 16000 && !(this.lastFill <= now && now - this.lastFill < 16)) {
        // relleno largo: cambiar de coche para ver a otros
        const alt = stories.filter((x) => x.car !== f && (x.kind === 'filler' || x.kind === 'pitexit')).sort((x, y) => y.v - x.v)[0];
        if (alt) { top = alt; go = true; this.lastFill = now; }
      }
    }
    if (go && top.car !== f) {
      this.story = { kind: top.kind, car: top.car, t0: now };
      this.focus = top.car; this.storyT = now; this.qLap = top.car.lap; this.qHold = 0; this.lineShot = -1; this.shotN = 0;
      this.seen[top.car.i] = now;
      this.reason = { mistake: 'mistake', finish: 'lap', hotlap: 'lap', traffic: 'lap', pitexit: 'pit', filler: '' }[top.kind];
      this.cutTo(this.sessionShot(top));
      return true;
    }
    if (cur) { this.story = { ...(this.story || {}), kind: cur.kind, car: f }; this.seen[f.i] = now; }
    // llegada a meta: plano desde una cámara de meta (una vez por vuelta)
    if (cur && (cur.kind === 'finish' || cur.kind === 'hotlap') && cur.good && cur.toLine < 330 && this.lineShot !== f.lap) {
      this.lineShot = f.lap; this.cutTo('track', 12, true); return true;
    }
    this.shotCycleS(cur);
    return true;
  }

  // ---- carrera: peleas. Cada pareja a menos de 1,6 s es una pelea posible; se valora por la posición, lo cerca que
  // van, si el de detrás es más rápido (sus últimas vueltas), si lleva goma más blanda o más nueva y si tiene DRS.
  // Se elige una y se sigue entera (alternando los dos coches) hasta que se deshace; solo se deja por otra que valga
  // claramente más o, tras un buen rato, por variedad (y por un accidente gordo: eso lo lleva la lógica general)
  battles() {
    const sim = this.sim, T = this.T, out = [];
    const RANK = { S: 2, M: 1, H: 0, I: 1, W: 1 };
    const pace = (c) => { const L = c.laps, n = L.length; if (n < 2) return null; const a = L.slice(-2).filter((x) => x > 0); return a.length ? a.reduce((x, y) => x + y) / a.length : null; };
    for (const car of sim.cars) {
      if (car.out || car.retired || car.finished || car.inPit || car.state !== 'track') continue;
      const ah = sim.carAheadOnTrack(car);
      if (!ah || ah.retired || ah.finished || ah.inPit) continue;
      const rel = T.ahead(car.s, ah.s), gap = rel / Math.max(20, car.v);
      if (gap > 1.6 || Math.round((ah.dist - car.dist - rel) / T.L) !== 0) continue;
      const pa = pace(car), pb = pace(ah), dp = pa && pb ? Math.max(-1.5, Math.min(1.5, pb - pa)) : 0;   // + = el de detrás va más rápido
      const comp = (RANK[car.tyre.c] ?? 1) - (RANK[ah.tyre.c] ?? 1), age = Math.max(-1, Math.min(1, (ah.tyre.age - car.tyre.age) / 12));
      let v = (5 + 9 * (1 - gap / 1.6)) * (0.35 + posW(ah.pos)) + 4 * dp + 2.5 * comp + 2 * age + (car.drs ? 2 : 0) + (rel < 8 ? 4 : 0);
      if (dp < -0.7) v *= 0.6;                       // el de detrás es claramente más lento: no va a pasar nada
      out.push({ a: car, b: ah, v, gap, key: car.i < ah.i ? car.i * 100 + ah.i : ah.i * 100 + car.i });
    }
    return out;
  }

  directBattle() {
    const sim = this.sim, ss = sim.session, now = sim.t;
    if (!ss || ss.id !== 'RACE' || !(ss.phase === 'green' || ss.phase === 'flag') || now - (sim.raceStart ?? 0) < 20) { this.fight = null; return false; }
    // accidente o trompo gordo: manda la lógica general (y luego se vuelve a buscar pelea)
    for (const e of this.events) if (e.big && now < e.until && e.car !== this.focus && !(this.fight && e.car === this.fight.b)) { if (!this.fight || this.fight.v < 14 || e.w >= 16) { this.fight = null; return false; } }
    const list = this.battles();
    let F = this.fight;
    if (F) {
      let cur = list.find((b) => b.key === F.key);
      // la pelea sigue con otro: el que se mete entre ellos, o uno de los dos con el siguiente del tren
      if (!cur) { for (const b of list) if ((b.a === F.a || b.b === F.a || b.a === F.b || b.b === F.b) && (!cur || b.v > cur.v)) cur = b; if (cur) F.key = cur.key; }
      if (cur) { F.v = cur.v; F.a = cur.a; F.b = cur.b; F.lost = null; }
      else if ((F.lost ??= now) && now - F.lost > 5) F = this.fight = null;      // se ha deshecho: unos segundos más y fuera
    }
    // solo peleas que ya duran unos segundos (las que se hacen y deshacen en un momento hacían saltar la cámara)
    const age = this.bAge || (this.bAge = new Map()), live = new Set();
    for (const b of list) { live.add(b.key); if (!age.has(b.key)) age.set(b.key, now); }
    for (const k of age.keys()) if (!live.has(k)) age.delete(k);
    let best = null; for (const b of list) if (now - age.get(b.key) >= 4 && (!best || b.v > best.v)) best = b;
    if (F && best && best.key !== F.key) {
      const held = now - F.t0;
      if ((held > 20 && best.v > F.v * 1.4 + 4) || (held > 75 && best.v > F.v + 1) || (F.lost && now - F.lost > 2 && best.v > 6)) F = null;
    }
    if (!F) {
      if (!best || best.v < 6) { this.fight = null; return false; }
      F = this.fight = { ...best, t0: now, lost: null };
      this.shotT = 1e9;     // corte ya
    }
    if (this.focus !== F.a && this.focus !== F.b) this.shotT = 1e9;
    // la cámara trasera, solo en el de delante (en el de detrás no se ve la pelea)
    if (this.type === 'rear' && this.focus === F.a) this.shotT = 1e9;
    if (this.shotT > this.shotLen && performance.now() - (this.lastCut || 0) > 3500 || this.shotT > 1e8) {
      const r = Math.random(), chaser = this.focus !== F.a ? r < 0.6 : r < 0.4;   // alternar entre los dos
      const car = chaser ? F.a : F.b, q = Math.random();
      const type = chaser ? (q < 0.4 ? 'track' : q < 0.58 ? 'tcam' : q < 0.74 ? 'cockpit' : q < 0.88 ? 'chase' : 'heli')
        : (q < 0.4 ? 'track' : q < 0.65 ? (F.gap < 0.8 ? 'rear' : 'track') : q < 0.8 ? 'heli' : 'tcam');
      this.focus = car; this.first = true; this.trackCam = null; this.type = type === this.type && type !== 'track' ? 'track' : type;
      this.shotT = 0; this.shotLen = 6 + Math.random() * 5; this.holdFocus = 8; this.reason = 'battle'; this.lastCut = performance.now();
      this.changed();
    }
    return true;
  }

  cutTo(type, len, line = false) {
    this.type = type; this.first = true; this.trackCam = null; this.shotT = 0; this.wantLine = line;
    this.shotLen = len || 5 + Math.random() * 4; this.lastCut = performance.now(); this.shotN = (this.shotN || 0) + 1;
    this.changed();
  }

  // plano para una historia: una vuelta lanzada alterna fuera (pista) y dentro (cockpit, T-cam, morro)
  sessionShot(st) {
    const r = Math.random(), n = this.shotN || 0;
    if (!st) return r < 0.4 ? 'track' : r < 0.6 ? 'tcam' : r < 0.8 ? 'chase' : 'heli';
    switch (st.kind) {
      case 'mistake': return r < 0.7 ? 'track' : 'heli';
      case 'pitexit': return r < 0.45 ? 'track' : r < 0.7 ? 'tcam' : 'heli';
      case 'traffic': return r < 0.45 ? 'track' : r < 0.7 ? 'heli' : r < 0.9 ? 'tcam' : 'chase';
      case 'finish': case 'hotlap': {
        if (st.toLine < 330) return 'track';
        if (n % 2 === 0) return r < 0.8 ? 'track' : 'heli';
        // dentro del coche: la T-cam es la preferida
        return r < 0.55 ? 'tcam' : r < 0.78 ? 'cockpit' : r < 0.9 ? 'nose' : 'chase';
      }
      default: return r < 0.38 ? 'track' : r < 0.63 ? 'tcam' : r < 0.78 ? 'chase' : r < 0.9 ? 'heli' : 'rear';
    }
  }

  shotCycleS(cur) {
    if (this.shotT <= this.shotLen) return;
    if (this.wantLine && this.qHold && this.sim.t < this.qHold) return;   // viendo el tiempo: no cortar
    const st = cur || { kind: this.story?.kind || 'filler', toLine: 1e9 };
    let t = this.sessionShot(st);
    if (t === this.type && t !== 'track') t = 'track';
    this.cutTo(t, st.kind === 'filler' ? 6 + Math.random() * 5 : 5 + Math.random() * 4);
  }

  shotCycle() {
    if (this.shotT <= this.shotLen) return;
    const sc = this.score(this.focus);
    this.type = this.pickType(sc === -1 ? [] : sc.why); this.first = true; this.trackCam = null; this.shotT = 0; this.shotLen = 6 + Math.random() * 6;
    this.lastCut = performance.now();
    this.changed();
  }

  pickType(why) {
    const r = Math.random();
    const has = (w) => why.includes(w);
    const avoid = this.type;
    let t;
    if (this.sim.session?.id === 'RACE' && ['grid', 'lights'].includes(this.sim.session.phase)) return 'heli';
    if (this.sim.session?.id === 'RACE' && this.sim.t - (this.sim.raceStart ?? 0) < 12) return 'heli';
    if (has('pit')) t = 'track';
    else if (has('mistake') || has('crash') || has('event')) t = r < 0.65 ? 'track' : 'heli';
    else if (has('side') || has('battle')) t = r < 0.5 ? 'track' : r < 0.7 ? 'cockpit' : r < 0.82 ? 'tcam' : r < 0.92 ? 'chase' : 'rear';
    else if (has('purple') || has('lap')) t = r < 0.35 ? 'cockpit' : r < 0.7 ? 'track' : r < 0.85 ? 'tcam' : 'chase';
    else t = r < 0.45 ? 'track' : r < 0.6 ? 'chase' : r < 0.72 ? 'tcam' : r < 0.82 ? 'cockpit' : r < 0.9 ? 'nose' : 'heli';
    if (t === avoid && t !== 'track') t = 'track';
    if (t === 'rear' && has('battle')) t = 'chase';     // en el de detrás de una pelea la trasera no enseña nada
    return t;
  }

  direct(dt) {
    this.shotT += dt; this.holdFocus -= dt;
    this._acc = (this._acc || 0) + dt; if (this._acc < 0.4) return; this._acc = 0;
    // auto fijo en un piloto: solo cambia de plano
    if (this.lockFocus) {
      if (this.shotT > this.shotLen || (this.focus.mistake?.type === 'spin' && this.type !== 'track' && this.type !== 'heli' && this.shotT > 1.5)) {
        const sc = this.score(this.focus);
        this.type = this.pickType(sc === -1 ? [] : sc.why); this.first = true; this.trackCam = null; this.shotT = 0; this.shotLen = 5 + Math.random() * 6;
        this.changed();
      }
      return;
    }
    // clasificación: siempre en el coche que va en la vuelta más rápida (proyección con el delta en vivo)
    // libres y clasificación: historias
    if (this.directSession()) return;
    if (this.directBattle()) return;
    let best = null, bs = -1e9, cur = null;
    for (const car of this.sim.cars) {
      const sc = this.score(car); if (sc === -1) continue;
      if (car === this.focus) cur = sc;
      if (sc.s > bs) { bs = sc.s; best = { car, ...sc }; }
    }
    if (!best) return;
    const curS = cur ? cur.s : -1;
    // corte inmediato solo por un trompo o un accidente, y nunca dejando una pelea buena (salvo que el accidente sea gordo)
    const bigEv = best.why.includes('crash') || best.why.includes('mistake');
    const urgent = bigEv && best.car !== this.focus && !this.focus.mistake && (!cur || cur.battle < 14 || best.why.includes('crash') && best.s > curS + 10);
    // sin cortes seguidos: al menos 4 s entre planos salvo trompo/accidente
    if (!urgent && cur && performance.now() - (this.lastCut || 0) < 4000) return;
    if ((this.holdFocus <= 0 && best.car !== this.focus && best.s > curS + 2.5) || urgent || !cur) {
      this.focus = best.car; this.first = true; this.trackCam = null;
      this.type = this.pickType(best.why); this.shotT = 0; this.shotLen = 6 + Math.random() * 6; this.holdFocus = 8;
      this.reason = best.why[0] || '';
      this.lastCut = performance.now();
      this.changed();
    } else if (this.shotT > this.shotLen) {
      this.type = this.pickType(cur?.why || []); this.first = true; this.trackCam = null; this.shotT = 0; this.shotLen = 6 + Math.random() * 6;
      this.lastCut = performance.now();
      this.changed();
    }
  }

  // ---- colocación de la cámara
  update(dt) {
    if (this.auto) this.direct(dt);
    const V = this.vis[this.focus.i]; if (!V) return;
    const root = V.root; const cam = this.cam;
    root.updateMatrixWorld();
    const q = root.quaternion;
    const carPos = root.position;
    const fwd = v1.set(0, 0, 1).applyQuaternion(q);
    let fov = 60;
    const lerp = (a, b, k) => a + (b - a) * k;
    const k = this.first ? 1 : 1 - Math.exp(-dt * 6);
    // en el garaje: ningún plano normal funciona (paredes, techo): cámara de garaje, desde la puerta mirando dentro
    // (el tipo de plano elige el encuadre: exteriores desde la puerta, a bordo desde una esquina del fondo)
    const garage = this.focus.state === 'garage' && this.type !== 'free';
    if (garage) {
      const T = this.T, box = T.pit.boxes[Math.max(0, TEAMS.indexOf(this.focus.team))];
      const inboard = ['cockpit', 'tcam', 'nose', 'rear'].includes(this.type);
      // (el coche está a 4,5 m del centro del garaje: el primero del equipo a un lado, el segundo al otro)
      const side = this.sim.cars.find((c) => c.team === this.focus.team) === this.focus ? 1 : -1;
      const P = [0, 0, 0];
      if (inboard) T.pos(box.s + side * 7, -43, P); else T.pos(box.s + side * 0.8, -30.5, P);
      cam.position.set(P[0], P[1] + (inboard ? 3.6 : 2.6), P[2]);
      this.smoothLook.copy(carPos).add(v3.set(0, 0.5, 0));
      cam.up.set(0, 1, 0); cam.lookAt(this.smoothLook);
      this.fov = inboard ? 62 : 50; if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
      this.first = false; this.inGarage = true;
      return;
    }
    // parada en boxes: desde el pit lane, con los mecánicos (pista: de tres cuartos delante; heli: desde arriba)
    if (this.focus.inPit && this.focus.pitPhase === 'stop' && (this.type === 'track' || this.type === 'heli')) {
      const T = this.T, box = T.pit.boxes[Math.max(0, TEAMS.indexOf(this.focus.team))], P = [0, 0, 0];
      const high = this.type === 'heli';
      T.pos(box.s + (high ? -7 : 8.5), T.pit.d + (high ? 2 : 4.5), P);
      cam.position.set(P[0], P[1] + (high ? 10 : 1.9), P[2]);
      this.smoothLook.copy(carPos).add(v3.set(0, 0.4, 0));
      cam.up.set(0, 1, 0); cam.lookAt(this.smoothLook);
      this.fov = high ? 42 : 48; if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
      this.first = false; this.inGarage = true; this.trackCam = null;
      return;
    }
    if (this.inGarage) { this.inGarage = false; this.first = true; }
    switch (this.type) {
      case 'chase': {
        // detrás del coche con el giro suavizado (sin quedarse atrás a alta velocidad); en un trompo, detrás de la trayectoria
        const yaw = Math.atan2(fwd.x, fwd.z) - (this.focus.mistake?.type === 'spin' ? this.focus.slide : 0);
        if (this.first || this.cyaw == null) this.cyaw = yaw;
        let dy = yaw - this.cyaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
        this.cyaw += dy * (1 - Math.exp(-dt * 7));
        const back = v2.set(Math.sin(this.cyaw), 0, Math.cos(this.cyaw));
        cam.position.copy(carPos).addScaledVector(back, -6.8).add(v3.set(0, 2.0, 0));
        this.smoothLook.copy(carPos).addScaledVector(back, 5).add(v3.set(0, 0.7, 0));
        cam.up.set(0, 1, 0); cam.lookAt(this.smoothLook); fov = 64; break;
      }
      case 'cockpit': case 'tcam': case 'nose': case 'rear': {
        const m = CAM_MOUNTS[this.type];
        const bodyM = V.body.matrixWorld;
        cam.position.set(...m.pos).applyMatrix4(bodyM);
        const shake = this.focus.v * 0.00004 * (this.type === 'nose' ? 3 : 1);
        cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake;
        v2.set(...m.look).applyMatrix4(bodyM);
        cam.up.set(0, 1, 0).applyQuaternion(V.body.getWorldQuaternion(new THREE.Quaternion()));
        cam.lookAt(v2); fov = this.type === 'cockpit' ? 74 : this.type === 'rear' ? 55 : 68; break;
      }
      case 'heli': {
        // salida: plano del pelotón (centro de los diez primeros), no del líder escapándose solo
        const ss = this.sim.session;
        // parrilla y semáforos: desde detrás de la parrilla, alto, con toda la fila de coches hacia el pórtico; se acerca despacio
        // y aguanta los primeros segundos de la arrancada
        if (ss?.id === 'RACE' && (ss.phase === 'grid' || ss.phase === 'lights' || (ss.phase === 'green' && this.sim.t - this.sim.raceStart < 3.5))) {
          const T = this.T, g = T.grid, back = g[g.length - 1].s, front = g[0].s;
          const el = ss.phase === 'green' ? 12 : Math.min(12, this.sim.t);
          const cs = T.wrap(back - 55 + el * 1.6), P = [0, 0, 0];
          T.pos(cs, 2, P); cam.position.set(P[0], P[1] + 17 - el * 0.35, P[2]);
          T.pos(T.wrap(front - 40), 0, P); this.smoothLook.set(P[0], P[1] + 1, P[2]);
          cam.up.set(0, 1, 0); cam.lookAt(this.smoothLook); fov = 34; this.pyaw = null; break;
        }
        if (ss?.id === 'RACE' && ss.phase === 'green' && this.sim.t - this.sim.raceStart < 14) {
          const pack = (this.sim.raceOrder || []).filter((c) => !c.out && !c.retired).slice(0, 10);
          if (pack.length) {
            const c = new THREE.Vector3(); for (const p of pack) c.add(this.vis[p.i].root.position); c.multiplyScalar(1 / pack.length);
            const i = this.T.idx(pack[Math.floor(pack.length / 2)].s), tw = v2.set(this.T.tx[i], 0, this.T.tz[i]);
            const yaw = Math.atan2(tw.x, tw.z);
            if (this.first || this.pyaw == null) { this.pyaw = yaw; this.pc = c.clone(); }
            let dy = yaw - this.pyaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; this.pyaw += dy * (1 - Math.exp(-dt * 1.2));
            this.pc.lerp(c, this.first ? 1 : 1 - Math.exp(-dt * 3));
            const f2 = v2.set(Math.sin(this.pyaw), 0, Math.cos(this.pyaw)), side = v3.set(f2.z, 0, -f2.x);
            cam.position.copy(this.pc).addScaledVector(f2, -46).addScaledVector(side, 10); cam.position.y += 20;
            cam.up.set(0, 1, 0); this.smoothLook.copy(this.pc).addScaledVector(f2, 18); cam.lookAt(this.smoothLook); fov = 48; break;
          }
        }
        // dron: orbita alrededor del coche, sube y se acerca despacio; si algo lo tapa (edificios, gradas) gira más rápido y sube
        if (this.first || this.droneAngle == null) {
          this.droneAngle = Math.random() * Math.PI * 2;
          this.droneDir = (Math.random() < 0.5 ? 1 : -1) * (0.12 + Math.random() * 0.08);
          this.droneT = Math.random() * 100; this.droneLift = 0; this.droneLosT = 0;
        }
        this.droneT += dt;
        this.droneLosT -= dt;
        if (this.droneLosT <= 0) { this.droneLosT = 0.2; this.droneBlocked = this.world.losBlocked(cam.position, v3.copy(carPos).setY(carPos.y + 0.8)); }
        this.droneLift = Math.max(0, Math.min(30, this.droneLift + (this.droneBlocked ? 14 : -3) * dt));
        this.droneAngle += this.droneDir * dt * (this.droneBlocked ? 4 : 1);
        const dist = 24 + 6 * Math.sin(this.droneT * 0.35);
        const h = Math.max(3, 13 + 5 * Math.sin(this.droneT * 0.25 + 1.0) + this.droneLift);
        cam.position.set(carPos.x + Math.sin(this.droneAngle) * dist, carPos.y + h, carPos.z + Math.cos(this.droneAngle) * dist);
        // mira al coche sin retraso (con retraso, a 300 km/h o con la sim acelerada, el coche se salía del plano)
        this.smoothLook.copy(carPos).addScaledVector(fwd, 4); this.smoothLook.y += 0.6;
        cam.up.set(0, 1, 0);
        cam.lookAt(this.smoothLook);
        fov = 50;
        break;
      }
      case 'track': {
        const T = this.T, s = this.focus.s;
        let tc = this.trackCam;
        const ahead = (c) => T.rel(s, c.s);
        const tgtNow = v2.copy(carPos).add(v3.set(0, 0.8, 0));
        // revisar la visibilidad 4 veces por segundo; si se tapa dos veces seguidas, cambiar de cámara
        this.losT = (this.losT || 0) - dt;
        // cada 0,2 s: ¿se ve el coche (morro, centro y cola)? una sola vez tapado basta para cambiar de cámara
        if (tc && this.losT <= 0) {
          this.losT = 0.2;
          const P1 = tgtNow.clone().addScaledVector(fwd, 2.4), P2 = tgtNow.clone().addScaledVector(fwd, -2.4);
          // y dónde estará en 0,4 s: se cambia antes de que se tape, no después
          const Pf = [0, 0, 0]; T.pos(s + this.focus.v * 0.4, this.focus.d, Pf); const PF = new THREE.Vector3(Pf[0], Pf[1] + 0.8, Pf[2]);
          const bad = this.world.losBlocked(tc.pos, tgtNow) || this.world.losBlocked(tc.pos, PF) || (this.world.losBlocked(tc.pos, P1) && this.world.losBlocked(tc.pos, P2));
          this.losBad = bad ? 2 : 0;
        }
        if (!tc && this.auto && this.noCamUntil > performance.now()) { this.type = Math.random() < 0.5 ? 'chase' : 'heli'; this.first = true; break; }
        if (!tc || ahead(tc) < -45 || ahead(tc) > 330 || this.losBad >= 2 || (this.focus.inPit !== (tc.tag === 'boxes') && this.focus.pitPhase === 'stop')) {
          const P = [0, 0, 0];
          const futs = [0.5, 1.5, 3, 4.5].map((tt) => { T.pos(s + Math.max(8, this.focus.v) * tt, this.focus.d, P); return new THREE.Vector3(P[0], P[1] + 0.8, P[2]); });
          const clear = (c, n) => !this.world.losBlocked(c.pos, tgtNow) && futs.slice(0, n).every((f) => !this.world.losBlocked(c.pos, f));
          const cands = [];
          for (const c of this.trackCams) {
            if (c.tag === 'boxes' && !(this.focus.inPit)) continue;
            if (c === tc && this.losBad >= 2) continue;
            const a = ahead(c);
            if (a < -10 || a > 300) continue;
            const toLine = T.ahead(s, 0);
            // llegada a meta: la cámara de meta que le toca (la de antes de la línea y, pasada, la de después)
            if (this.wantLine && (toLine < 400 || toLine > T.L - 60)) cands.push({ c, score: Math.abs(a - (toLine > T.L - 60 ? 0 : toLine)) + (c.tag === 'meta' ? -60 : 0) });
            else cands.push({ c, score: Math.abs(a - 90) + (c.tag === 'curva' ? -30 : 0) });
          }
          cands.sort((x, y) => x.score - y.score);
          let pick = null;
          for (const { c } of cands.slice(0, 12)) if (clear(c, 4)) { pick = c; break; }
          if (!pick) for (const { c } of cands.slice(0, 12)) if (clear(c, 2)) { pick = c; break; }
          if (!pick) {
            // ninguna cámara de pista lo ve: otro plano (no siempre la persecución)
            this.noCamUntil = performance.now() + 5000; const r = Math.random();
            this.type = this.auto ? (r < 0.4 ? 'chase' : r < 0.7 ? 'heli' : 'tcam') : 'chase'; this.first = true; this.changed(); break;
          }
          tc = this.trackCam = pick; this.losBad = 0; this.losT = 0.25;
          this.first = true;
        }
        cam.position.copy(tc.pos); cam.up.set(0, 1, 0);
        const target = v2.copy(carPos).add(v3.set(0, 0.6, 0));
        // si hay pelea, encuadrar a los dos
        const ah = this.sim.carAheadOnTrack(this.focus);
        let span = 7;
        if (ah && !ah.inPit && T.rel(this.focus.s, ah.s) < 40) {
          const AV = this.vis[ah.i]; target.lerp(AV.root.position, 0.4); span = 7 + T.rel(this.focus.s, ah.s) * 0.55;
        }
        this.smoothLook.copy(target);
        cam.lookAt(this.smoothLook);
        const dist = cam.position.distanceTo(this.smoothLook);
        fov = THREE.MathUtils.clamp(2 * Math.atan((span * 0.9) / dist) * 57.3, 3.5, 55); break;
      }
      case 'free': {
        const delta = v2.copy(carPos).sub(this.controls.target);
        this.controls.target.add(delta); cam.position.add(delta);
        this.controls.update(); fov = 55; break;
      }
    }
    this.fov = this.first ? fov : lerp(this.fov, fov, this.type === 'track' ? 1 - Math.exp(-dt * 4) : 1);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.first = false;
  }
}
