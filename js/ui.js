// HUD estilo retransmisión: torre de tiempos, ficha y telemetría, peleas, avisos, mapa, semáforo,
// paneles de resultados y de aprendizaje.
import { COMPOUNDS, TEAMS } from './teams.js';
import { SESSIONS } from './sim.js';
import { CAM_TYPES, CAM_LABEL } from './director.js';
import { degSlope, buildLine } from './brain.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtLap = (t) => (isFinite(t) && t > 0 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}` : '—');
const fmtGap = (t) => (t < 60 ? `+${t.toFixed(3)}` : `+${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);
const tyreHTML = (c, age) => `<span class="tyre ${c}" title="${COMPOUNDS[c].name}${age != null ? ' · ' + age + ' vueltas' : ''}"><i>${c}</i></span>`;
const PLAN = { inside: 'por dentro', outside: 'por fuera', cutback: 'cruce a la salida', exit: 'rebufo a la salida' };
const NEXT = { FP: 'Q1', Q1: 'Q2', Q2: 'Q3', Q3: 'RACE' };
const NEXT_LABEL = { FP: 'Ir a la clasificación', Q1: 'Ir a la Q2', Q2: 'Ir a la Q3', Q3: 'Ir a la carrera', RACE: 'Nuevo fin de semana' };

export class UI {
  constructor(app) {
    this.app = app; this.sim = app.sim; this.T = app.T; this.dir = app.director;
    this.mode = 'interval'; this.acc = 0; this.accCard = 0;
    this.buildControls();
    this.buildMap();
    $('towerHead').onclick = () => { this.mode = this.mode === 'interval' ? 'leader' : 'interval'; this.acc = 1; };
    $('rows').onclick = (e) => { const li = e.target.closest('li'); if (li) this.dir.setFocus(this.sim.cars[+li.dataset.i]); };
    this.sim.on((e) => this.onEvent(e));
    this.dir.onChange(() => this.syncButtons());
  }

  // ---------------------------------------------------------- controles
  buildControls() {
    const c = $('controls');
    const camBtns = CAM_TYPES.map((t) => `<button data-cam="${t}">${CAM_LABEL[t]}</button>`).join('');
    c.innerHTML = `
      <div class="grp"><button id="bAuto" class="on" title="Realización automática (A)">AUTO</button><button id="bAutoD" title="Automática pegada al piloto elegido: solo cambia de plano (P)">AUTO PILOTO</button>${camBtns}</div>
      <div class="grp"><button id="bPrev" title="Piloto anterior ([)">‹</button><span class="lbl" id="focusLbl">—</span><button id="bNext" title="Piloto siguiente (])">›</button></div>
      <div class="spacer"></div>
      <div class="grp" id="speeds"><button id="bReplay" title="Repetición de los últimos 12 s del piloto enfocado (R)">↺ Repetir</button>${[0, 1, 2, 4, 8, 16, 32].map((s) => `<button data-speed="${s}">${s === 0 ? 'II' : s + '×'}</button>`).join('')}</div>
 <div class="grp"><button id="bSound" title="Sonido de motor (M)">Sonido</button><button id="bSkip" title="Simular el resto de la sesión a máxima velocidad">Saltar</button><button id="bLearn" class="red" title="Qué han aprendido los pilotos (L)">IA · Aprendizaje</button></div>`;
    c.querySelectorAll('[data-cam]').forEach((b) => (b.onclick = () => this.dir.setType(b.dataset.cam)));
    c.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => this.app.setSpeed(+b.dataset.speed)));
    $('bAuto').onclick = () => this.dir.setAuto(!(this.dir.auto && !this.dir.lockFocus));
    $('bAutoD').onclick = () => this.dir.setAutoDriver(!this.dir.lockFocus);
    $('qlive').onclick = (e) => { const q = e.target.closest('.ql'); if (q) this.dir.setFocus(this.sim.cars[+q.dataset.i]); };
    $('bPrev').onclick = () => this.cycle(-1); $('bNext').onclick = () => this.cycle(1);
    $('bSkip').onclick = () => this.app.skip();
    $('bSound').onclick = () => { this.app.audio.toggle(); this.syncButtons(); };
    $('bLearn').onclick = () => this.showLearning();
    $('bReplay').onclick = () => { const R = this.app.replay; if (R?.active) R.stop(); else R?.replayLast(); };
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'a') this.dir.setAuto(!(this.dir.auto && !this.dir.lockFocus));
      else if (k === 'p') this.dir.setAutoDriver(!this.dir.lockFocus);
      else if (k >= '1' && k <= '8') this.dir.setType(CAM_TYPES[+k - 1]);
      else if (k === '[' || k === 'arrowleft') this.cycle(-1);
      else if (k === ']' || k === 'arrowright') this.cycle(1);
      else if (k === ' ') { e.preventDefault(); this.app.setSpeed(this.app.speed === 0 ? this.app.lastSpeed || 1 : 0); }
      else if (k === '+' || k === '=') this.app.setSpeed(Math.min(32, Math.max(1, this.app.speed * 2)));
      else if (k === '-') this.app.setSpeed(Math.max(1, this.app.speed / 2));
      else if (k === 'l') this.showLearning();
      else if (k === 'r') { const R = this.app.replay; if (R?.active) R.stop(); else R?.replayLast(); }
      else if (k === 'm') { this.app.audio.toggle(); this.syncButtons(); }
      else if (k === 'h') $('hud').classList.toggle('hidden');
      else if (k === 'escape') { if (document.querySelector('.modal')) this.closeModal(); else this.pauseMenu(); }
    });
  }
  cycle(dir) {
    const list = this.order().filter((c) => !c.out);
    const i = list.indexOf(this.dir.focus);
    this.dir.setFocus(list[(i + dir + list.length) % list.length]);
  }
  syncButtons() {
    $('bAuto').classList.toggle('on', this.dir.auto && !this.dir.lockFocus);
    $('bAutoD').classList.toggle('on', !!this.dir.lockFocus);
    $('bSound').classList.toggle('on', !!this.app.audio?.on); $('bSound').textContent = this.app.audio?.on ? 'Sonido ON' : 'Sonido OFF';
    document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === this.dir.type));
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === this.app.speed));
    const f = this.dir.focus; $('focusLbl').textContent = f ? f.code : '—';
    $('camLabel').textContent = `${CAM_LABEL[this.dir.type]} · ${f ? f.drv.last : ''}${this.dir.lockFocus ? ' · auto piloto' : this.dir.auto ? ' · auto' : ''}`;
  }

  // ---------------------------------------------------------- orden
  order() {
    const sim = this.sim;
    if (sim.session?.id === 'RACE') return (sim.raceOrder || sim.cars).slice();
    const cls = sim.classification();
    if (sim.session?.id === 'Q2' || sim.session?.id === 'Q3') {
      const out = (sim.qualiOrder || []).filter((c) => c.out);
      return cls.concat(out.filter((c) => !cls.includes(c)));
    }
    return cls;
  }

  // ---------------------------------------------------------- torre
  tower() {
    const sim = this.sim, ss = sim.session; if (!ss) return;
    const race = ss.id === 'RACE';
    const order = this.order();
    $('sessName').textContent = race ? `VUELTA ${Math.max(1, Math.min(sim.raceLaps, (order[0]?.lap ?? 0) + 1))}/${sim.raceLaps}` : ss.short === 'FP' ? 'LIBRES' : ss.short;
    $('sessSub').textContent = race ? (this.mode === 'interval' ? 'Intervalo' : 'Líder') : ss.short === 'FP' ? 'Entrenamientos' : 'Clasificación';
    const cut = SESSIONS[ss.id]?.cut;
    const best = order.find((c) => isFinite(c.best))?.best;
    let html = '';
    order.forEach((car, p) => {
      let gap = '', tag = '', cls = '', gapCls = '';
      if (race) {
        if (car.retired) { gap = '<span class="tag dnf" style="position:static">OUT</span>'; cls = 'out'; }
        else if (p === 0) gap = car.finished ? 'GANADOR' : 'LÍDER';
        else {
          const ref = this.mode === 'interval' ? order[p - 1] : order[0];
          const laps = Math.floor((ref.dist - car.dist) / this.T.L + (ref.finished && !car.finished ? 0 : 0.0001));
          if (laps >= 1) gap = `+${laps} ${laps === 1 ? 'VUELTA' : 'VUELTAS'}`;
          else gap = fmtGap(sim.gapTo(car, ref));
        }
        if (car.inPit && !car.retired && !car.finished) gap = '<span class="tag pit" style="position:static">PIT</span>';
        if (sim.session.phase === 'grid' || sim.session.phase === 'lights') gap = p === 0 ? 'POLE' : '';
        if (this.sim.fastest?.car === car) gapCls = 'purple';
      } else {
        if (isFinite(car.best)) gap = p === 0 ? fmtLap(car.best) : fmtGap(car.best - best);
        else gap = '—';
        if (car.state === 'garage' && !car.out) gap = '<span class="tag pit" style="position:static">BOX</span> ' + gap;
        if (car.lapKind === 'push' && car.state !== 'garage' && car.secCol) gap = `<span class="secs">${[0, 1, 2].map((k) => `<i class="${car.secCol?.[k] || ''}"></i>`).join('')}</span>` + gap;
        if (car.out) cls = 'out';
        if (cut && p === cut) cls += ' cut';
        if (cut && p >= cut && !car.out) cls += ' danger';
        if (p === 0 && isFinite(car.best)) gapCls = 'purple';
      }
      // última vuelta: morada si es la más rápida de la sesión, verde si es su mejor
      const llCls = car.lastLap > 0 && sim.fastest?.car === car && Math.abs(sim.fastest.t - car.lastLap) < 1e-6 ? 'purple' : car.lastLap > 0 && Math.abs(car.best - car.lastLap) < 1e-6 ? 'pb' : '';
      if (car === this.dir.focus) cls += ' focus';
      if (car.finished && !car.retired) cls += ' fin';
      const up = race && car.gridPos && car.pos < car.gridPos && !car.retired ? '<span class="up">▲</span>' : '';
      html += `<li data-i="${car.i}" class="${cls}"><span class="p">${p + 1}</span><span class="bar" style="background:${car.team.c1}"></span><span class="code">${car.code}</span><span class="gap ${gapCls}">${gap}</span><span class="ll ${llCls}" title="Última vuelta">${car.lastLap > 0 ? fmtLap(car.lastLap) : ''}</span>${tyreHTML(car.tyre.c)}${tag}${up}${car.finished && !car.retired ? '<span class="chq" title="Ha cruzado la meta"></span>' : ''}</li>`;
    });
    $('rows').innerHTML = html;
    // barra de sesión
    let k = 'Tiempo', v = '--:--';
    if (race) { k = 'Vuelta'; v = `${Math.max(1, Math.min(sim.raceLaps, (order[0]?.lap ?? 0) + 1))} / ${sim.raceLaps}`; }
    else { const left = Math.max(0, ss.dur - sim.t); v = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`; k = SESSIONS[ss.id].label; }
    $('sbK').textContent = k; $('sbV').textContent = v;
    const flag = $('flag');
    const chq = ss.phase === 'flag' || ss.phase === 'done';
    flag.className = chq ? 'CHQ' : sim.flag;
    const pre = race && (ss.phase === 'grid' || ss.phase === 'lights');
    flag.textContent = chq ? '' : pre ? 'PARRILLA' : sim.flag === 'VSC' ? 'VSC' : 'VERDE';
    if (pre) flag.className = 'PRE';
    // tiempo: lluvia y agua en pista
    const wx = sim.wx, wxEl = $('wx');
    if (wx && wxEl) {
      const on = wx.rain > 0.03 || wx.wet > 0.05 || wx.target > 0.05;
      wxEl.classList.toggle('hidden', !on);
      if (on) {
        const lbl = wx.rain > 0.55 ? 'LLUVIA FUERTE' : wx.rain > 0.2 ? 'LLUVIA' : wx.rain > 0.03 ? 'LLOVIZNA' : wx.wet > 0.05 ? 'SECÁNDOSE' : 'NUBES';
        wxEl.innerHTML = `<span class="ic">${wx.rain > 0.03 ? '☂' : '☁'}</span><span class="l">${lbl}</span><span class="w" title="Agua en la trazada">${Math.round(wx.line * 100)}%</span>${wx.noDRS ? '<span class="d">DRS OFF</span>' : ''}`;
      }
    }
  }

  // ---------------------------------------------------------- ficha + telemetría
  card() {
    const car = this.dir.focus, sim = this.sim; if (!car || !sim.session) return;
    const race = sim.session.id === 'RACE';
    const order = this.order(); const p = order.indexOf(car);
    const ahead = order[p - 1], behind = order[p + 1];
    const gA = race ? (ahead ? fmtGap(sim.gapTo(car, ahead)) : '—') : (isFinite(car.best) && order[0] !== car && isFinite(order[0].best) ? fmtGap(car.best - order[0].best) : '—');
    const gB = race && behind && !behind.retired ? fmtGap(sim.gapTo(behind, car)) : '—';
    const b = car.brain;
    const commit = b.commit.reduce((a, c) => a + c, 0) / b.commit.length;
    let mode = '';
    if (car.retired) mode = 'Abandono';
    else if (car.state === 'garage') mode = 'En el garaje';
    else if (car.inPit) mode = car.pitPhase === 'stop' ? 'Parada en boxes' : car.pitPhase === 'in' ? 'Entrando en boxes' : 'Saliendo de boxes';
    else if (car.mistake) mode = { wide: 'Se abre en la curva', off: 'Se sale de la pista', spin: '¡Trompo!' }[car.mistake.type];
    else if (car.mode === 'attack' && car.target) mode = `Atacando a ${car.target.code}${car.atk ? ' · ' + PLAN[car.atk.type] : ''}`;
    else if (car.mode === 'defend') mode = `Defendiendo de ${car.attacker?.code || ''}`;
    else if (car.mode === 'yield') mode = 'Dejando pasar';
    else if (car.cand) mode = `Probando trazada en ${this.T.zones[car.cand.z].corner.name}`;
    else mode = race ? (car.finished ? 'Bandera a cuadros' : 'Ritmo de carrera') : { push: 'Vuelta rápida', out: 'Vuelta de salida', in: 'Vuelta de entrada', cool: 'Enfriando' }[car.lapKind] || '';
    $('card').innerHTML = `
      <div class="top"><div class="pos">${p + 1}</div><div class="stripe" style="background:${car.team.c1}"></div>
        <div class="who"><span class="n">${esc(car.drv.first)} · ${esc(car.team.name)}</span><span class="ln">${esc(car.drv.last)}</span></div>
        <div class="num" style="color:${car.team.c2 === '#FFFFFF' ? car.team.c1 : car.team.c2}">${car.drv.num}</div></div>
      ${this.deltaRow(car, race)}
      <div class="info">
        <div><span class="k">Neumático</span><span class="v">${tyreHTML(car.tyre.c)} ${Math.round((1 - car.tyre.wear) * 100)}%</span></div>
        <div><span class="k">${race ? 'Delante' : 'A P1'}</span><span class="v">${gA}</span></div>
        <div><span class="k">${race ? 'Detrás' : 'Vueltas'}</span><span class="v">${race ? gB : car.laps.length}</span></div>
        <div><span class="k">Mejor</span><span class="v">${fmtLap(car.best)}</span></div>
      </div>
      <div class="secrow">${[0, 1, 2].map((k) => this.sectorCell(car, k)).join('')}<div class="sec last"><span class="k">Última</span><b>${fmtLap(car.lastLap)}</b></div></div>
      <div class="mode"><span>${mode}</span><span>IA: ${b.exp} pruebas · ${b.acc} mejoras · límite ${(commit * 100).toFixed(1)}%</span></div>`;
  }
  // libres y clasificación: diferencia en vivo del que se está viendo, con la mejor de la sesión y con la suya
  deltaRow(car, race) {
    if (race || car.lapKind !== 'push' || car.inPit || car.state === 'garage') return '';
    const f = (d) => (d == null ? '—' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`);
    const c = (d) => (d == null ? 'none' : d < 0 ? 'good' : 'bad');
    const p1 = car.delta, own = car.deltaOwn;
    const p1c = p1 == null ? 'none' : p1 < 0 ? 'purple' : c(own);
    if (!car.lapClean) return '<div class="delta"><span class="k">Delta</span><b class="none">vuelta anulada</b></div>';
    return `<div class="delta"><span class="k">Delta P1</span><b class="${p1c}">${f(p1)}</b><span class="k">Su mejor</span><b class="${c(own)}">${f(own)}</b></div>`;
  }
  // sector k de la vuelta en curso (o de la anterior si aún no ha pasado por él), con su color
  sectorCell(car, k) {
    const cur = car.sector > k;
    const t = cur ? car.curSectors[k] : car.prevSectors?.[k];
    const col = cur ? car.secCol?.[k] : car.prevSecCol?.[k];
    const live = car.sector === k && car.state !== 'garage' && !car.inPit;
    const run = live ? Math.max(0, this.sim.t - car.sectorStart) : null;
    return `<div class="sec ${col || ''} ${live ? 'live' : ''}"><span class="k">S${k + 1}</span><b>${live ? run.toFixed(1) : t ? t.toFixed(3) : '—'}</b></div>`;
  }

  tele() {
    const car = this.dir.focus; if (!car) return;
    const kmh = Math.round(car.v * 3.6);
    const drs = car.drs ? 'on' : car.drsOk ? 'ok' : '';
    $('tele').innerHTML = `
      <div class="spd"><b>${kmh}</b><span>KM/H</span><div class="gear">${car.gear === 0 ? 'N' : car.gear}</div></div>
      <div class="rpm"><i style="clip-path: inset(0 ${100 - Math.max(0, Math.min(100, (car.rpm - 6500) / 58))}% 0 0)"></i></div>
      <div class="pedals"><span>ACEL</span><div class="ped thr"><i style="width:${Math.round(car.throttle * 100)}%"></i></div><span>FRENO</span><div class="ped brk"><i style="width:${Math.round(car.brake * 100)}%"></i></div></div>
      <div class="row"><span class="pill ${drs}">DRS</span>${car.inPit ? '<span class="pill pit">LIMITADOR</span>' : ''}<span class="pill">${car.tyre.age} VTAS</span><span class="pill">${Math.round(car.fuel)} KG</span></div>`;
  }

  // ---------------------------------------------------------- pelea
  battle() {
    const sim = this.sim, el = $('battle');
    const car = this.dir.focus;
    const ph = sim.session?.phase;
    if (!car || sim.session?.id !== 'RACE' || car.inPit || car.retired || ph === 'grid' || ph === 'lights' || sim.t - (sim.raceStart ?? 1e9) < 8) { el.classList.add('hidden'); return; }
    const order = this.order(); const p = order.indexOf(car);
    let a = null, b = null;
    const ah = order[p - 1], bh = order[p + 1];
    if (ah && !ah.inPit && sim.gapTo(car, ah) < 1.0 && Math.abs(car.lap - ah.lap) <= 1) { a = ah; b = car; }
    else if (bh && !bh.inPit && !bh.retired && sim.gapTo(bh, car) < 1.0) { a = car; b = bh; }
    if (!a) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="ttl">LUCHA POR P${order.indexOf(a) + 1}</div><div class="d"><i style="background:${a.team.c1}"></i>${a.code}</div><div class="gap">${sim.gapTo(b, a).toFixed(3)}</div><div class="d"><i style="background:${b.team.c1}"></i>${b.code}</div>`;
  }

  // ---------------------------------------------------------- clasificación: los 3 mejores en vuelta lanzada
  qualiLive() {
    const sim = this.sim, ss = sim.session, el = $('qlive');
    const on = ss && ss.id.startsWith('Q') && !ss.done;
    const best = sim.fastest?.t;
    const cls = on ? sim.classification() : [];
    const posOf = (t) => { let p = cls.findIndex((c) => !(c.best <= t)); return (p < 0 ? cls.length : p) + 1; };
    const list = on ? sim.cars.filter((c) => !c.out && c.state !== 'garage' && !c.inPit && c.lapKind === 'push' && c.lapClean && !c.retired) : [];
    // orden: los que van a mejor tiempo proyectado; sin referencia, los que más han avanzado
    const key = (c) => (c.delta != null && best ? best + c.delta : 1e4 - c.cpK);
    list.sort((a, b) => key(a) - key(b));
    const top = list.slice(0, 3);
    el.classList.toggle('hidden', !top.length);
    if (!top.length) return;
    el.innerHTML = top.map((c) => {
      let dl = '<span class="dl none">—</span>', pos = '–';
      if (c.delta != null && best) {
        const d = c.delta, own = isFinite(c.best) ? c.best - best : null;
        const cls2 = d < 0 ? 'purple' : own != null && d < own ? 'up' : 'down';
        dl = `<span class="dl ${cls2}">${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}</span>`;
        pos = 'P' + posOf(best + d);
      }
      const secs = [0, 1, 2].map((k) => {
        const done = c.sector > k, live = c.sector === k;
        const t = done ? c.curSectors[k].toFixed(3) : live ? Math.max(0, sim.t - c.sectorStart).toFixed(1) : '—';
        return `<div class="${done ? c.secCol?.[k] || '' : ''} ${live ? 'live' : ''}"><span>S${k + 1}</span><b>${t}</b></div>`;
      }).join('');
      return `<div class="ql ${c === this.dir.focus ? 'focus' : ''}" data-i="${c.i}"><div class="top"><span class="p">${pos}</span><i style="background:${c.team.c1}"></i><b>${c.code}</b>${dl}</div><div class="secs">${secs}</div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------- avisos
  note(cls, tag, html, ms = 5000) {
    const feed = $('feed');
    const d = document.createElement('div'); d.className = `note ${cls}`; d.innerHTML = `<span class="t">${tag}</span><span>${html}</span>`;
    feed.prepend(d);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => d.remove(), ms);
  }
  onEvent(e) {
    const sim = this.sim, race = sim.session?.id === 'RACE';
    const c = e.car;
    switch (e.type) {
      case 'overtake': if (e.how === 'pista' && (e.pos <= 12 || c === this.dir.focus)) this.note('green', 'ADELANTAMIENTO', `<b>${c.code}</b> pasa a <b>${e.other.code}</b>${e.plan && e.plan !== 'inside' ? ' ' + PLAN[e.plan] : ''}${e.corner ? ' en ' + e.corner : ''} · P${e.pos}`); break;
      case 'pitdone': this.note('blue', 'PIT STOP', `<b>${c.code}</b> ${e.time.toFixed(1)} s · ${COMPOUNDS[e.c].name.toLowerCase()}`); break;
      case 'fastest': this.note('purple', race ? 'VUELTA RÁPIDA' : 'MEJOR TIEMPO', `<b>${c.code}</b> ${fmtLap(e.time)}`); break;
      case 'mistake': if (e.kind !== 'wide' || c === this.dir.focus) this.note('yellow', e.kind === 'spin' ? 'TROMPO' : e.kind === 'off' ? 'FUERA DE PISTA' : 'SE ABRE', `<b>${c.code}</b>${e.corner ? ' en ' + e.corner : ''}`); break;
      case 'retire': this.note('red', 'ABANDONO', `<b>${c.code}</b> · ${e.why}`, 8000); break;
      case 'contact': if (e.wall) { if (e.sev > 7) this.note('yellow', 'CONTRA LAS BARRERAS', `<b>${c.code}</b> golpea la barrera`); } else if (e.sev > 7) this.note('yellow', 'TOQUE', `<b>${c.code}</b> y <b>${e.other.code}</b>`); break;
      case 'limits': if (!race) this.note('yellow', 'TIEMPO BORRADO', `<b>${c.code}</b> · límites de pista${e.corner ? ' en ' + e.corner : ''}`); break;
      case 'knockout': this.note('red', 'ELIMINADO', `<b>${c.code}</b> fuera en ${sim.session.id}`, 7000); break;
      case 'flag': this.note(e.flag === 'VSC' ? 'yellow' : 'green', e.flag === 'VSC' ? 'VSC' : 'PISTA LIBRE', e.flag === 'VSC' ? 'Coche de seguridad virtual' : 'Bandera verde'); break;
      case 'chequered': this.note('green', 'BANDERA', race && c ? `<b>${c.code}</b> gana el Gran Premio` : 'Fin de la sesión', 8000); break;
      case 'start': this.go('¡SEMÁFORO APAGADO!'); break;
      case 'weather': {
        const W = { rainStart: ['EMPIEZA A LLOVER', 'La pista se va a mojar'], rainMore: ['LLUEVE MÁS', 'Más agua en la pista'], rainLess: ['LLUEVE MENOS', 'La lluvia afloja'], rainStop: ['DEJA DE LLOVER', 'La trazada empezará a secarse'], drsOff: ['DRS DESACTIVADO', 'Pista mojada'], drsOn: ['DRS ACTIVADO', 'La pista se ha secado'] }[e.what];
        if (W) this.note(e.what === 'drsOn' || e.what === 'rainStop' ? 'green' : 'blue', W[0], W[1], 7000);
        break;
      }
      case 'lap': if (!race && c === this.dir.focus && this.dir.auto) this.lapPop(c, e); break;
      case 'session': $('feed').innerHTML = ''; this.note('green', 'SESIÓN', SESSIONS[e.id].label); break;
    }
  }
  // tiempo de vuelta del coche que se está viendo (libres/clasificación): posición y diferencia
  lapPop(c, e) {
    const sim = this.sim, cls = sim.classification().filter((x) => isFinite(x.best));
    const p = cls.indexOf(c) + 1, cut = SESSIONS[sim.session.id].cut;
    let tag, cl;
    if (!e.best) { tag = `SIN MEJORAR · P${p}`; cl = 'down'; }
    else if (p === 1) { tag = cls[1] ? `P1 · −${(cls[1].best - c.best).toFixed(3)}` : 'P1'; cl = 'purple'; }
    else { tag = `P${p} · +${(c.best - cls[0].best).toFixed(3)}`; cl = cut && p > cut ? 'red' : 'up'; }
    const zone = e.best && cut && sim.session.id !== 'FP' ? (p > cut ? 'ZONA DE ELIMINACIÓN' : p > cut - 3 ? 'POR POCO DENTRO' : '') : '';
    $('lapPop')?.remove();
    const d = document.createElement('div'); d.id = 'lapPop';
    d.innerHTML = `<i style="background:${c.team.c1}"></i><b>${c.code}</b><span class="t">${fmtLap(e.time)}</span><span class="r ${cl}">${tag}</span>${zone ? `<span class="z">${zone}</span>` : ''}`;
    $('hud').appendChild(d); setTimeout(() => d.remove(), 4200);
  }
  go(txt) { const d = document.createElement('div'); d.id = 'goBanner'; d.textContent = txt; $('hud').appendChild(d); setTimeout(() => d.remove(), 2500); }

  lights() {
    const sim = this.sim, el = $('lights');
    const on = sim.session?.id === 'RACE' && (sim.session.phase === 'lights' || sim.session.phase === 'grid');
    el.classList.toggle('hidden', !on);
    if (on) el.innerHTML = [0, 1, 2, 3, 4].map((k) => `<div class="pod ${k < sim.lights ? 'on' : ''}"><i></i><i></i><i></i><i></i></div>`).join('');
  }

  // ---------------------------------------------------------- mapa
  buildMap() {
    const T = this.T, cv = $('map');
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < T.N; i += 5) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
    const pad = 36, W = cv.width, H = cv.height;
    const sc = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0));
    this.mapXY = (x, z) => [pad + (x - x0) * sc + ((W - 2 * pad) - (x1 - x0) * sc) / 2, pad + (z - z0) * sc + ((H - 2 * pad) - (z1 - z0) * sc) / 2];
    const path = new Path2D();
    for (let i = 0; i <= T.N; i += 4) { const [x, y] = this.mapXY(T.x[i % T.N], T.z[i % T.N]); i ? path.lineTo(x, y) : path.moveTo(x, y); }
    path.closePath(); this.mapPath = path;
    // número de cada curva, por fuera del vértice
    const A = [0, 0, 0], B = [0, 0, 0];
    this.mapTurns = T.corners.map((c, n) => {
      T.pos(c.apex, 0, A); T.pos(c.apex, -c.dir * 10, B);
      const [ax, ay] = this.mapXY(A[0], A[2]), [bx, by] = this.mapXY(B[0], B[2]);
      const l = Math.hypot(bx - ax, by - ay) || 1;
      return [ax + (bx - ax) / l * 17, ay + (by - ay) / l * 17, String(n + 1)];
    });
  }
  map() {
    const cv = $('map'), g = cv.getContext('2d'), T = this.T, P = [0, 0, 0];
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 14; g.stroke(this.mapPath);
    g.strokeStyle = '#e8e8ee'; g.lineWidth = 5; g.stroke(this.mapPath);
    g.font = '700 19px "Titillium Web", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y, t] of this.mapTurns) g.fillText(t, x, y);
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    // sectores
    const cols = ['#e10600', '#2f80ed', '#ffd12e'];
    T.sectors.forEach((s, k) => { T.pos(s, 0, P); const [x, y] = this.mapXY(P[0], P[2]); g.fillStyle = cols[k]; g.fillRect(x - 3, y - 3, 6, 6); });
    const order = this.order().slice().reverse();
    for (const car of order) {
      if (car.out || car.state === 'garage') continue;
      T.pos(car.s, car.d, P); const [x, y] = this.mapXY(P[0], P[2]);
      const f = car === this.dir.focus;
      g.beginPath(); g.arc(x, y, f ? 9 : 6, 0, 7); g.fillStyle = car.team.c1; g.fill();
      g.lineWidth = f ? 3 : 1.5; g.strokeStyle = f ? '#fff' : 'rgba(255,255,255,0.7)'; g.stroke();
      if (f) { g.font = '900 20px "Titillium Web", Arial'; g.fillStyle = '#fff'; g.fillText(car.code, x + 12, y - 8); }
    }
  }

  // ---------------------------------------------------------- bucle
  update(dt) {
    this.acc += dt; this.accCard += dt;
    if (this.acc > 0.25) { this.acc = 0; this.tower(); this.battle(); this.lights(); this.map(); this.syncButtons(); }
    if (this.accCard > 0.08) { this.accCard = 0; this.card(); this.tele(); this.qualiLive(); }
  }

  // ---------------------------------------------------------- paneles
  closeModal() {
    document.querySelectorAll('.modal').forEach((m) => m.remove());
    if (this.pausedSpeed != null) { this.app.setSpeed(this.pausedSpeed); this.pausedSpeed = null; }
  }
  pauseMenu() {
    const was = this.app.speed;
    const m = this.modal(`<header><span class="kicker">PAUSA</span><h2>Menú</h2></header>
      <div class="body"><p class="lead">Al reiniciar, los pilotos olvidan todo lo aprendido y se vuelve a la pantalla de inicio.</p>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px"><button class="btn ghost" id="pRestart">Reiniciar fin de semana</button><button class="btn" id="pGo">Seguir</button></div></div>`);
    this.pausedSpeed = was; this.app.setSpeed(0);
    m.querySelector('#pGo').onclick = () => this.closeModal();
    m.querySelector('#pRestart').onclick = () => this.app.restart();
  }
  modal(html) {
    this.closeModal();
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="sheet">${html}</div>`;
    m.addEventListener('click', (e) => { if (e.target === m) this.closeModal(); });
    document.body.appendChild(m); return m;
  }

  results(id, cls) {
    const sim = this.sim, race = id === 'RACE';
    const best = cls.find((c) => isFinite(c.best))?.best;
    const rows = cls.map((c, p) => {
      let time;
      if (race) time = c.retired ? `<span class="pos-down">${c.retiredWhy === 'accidente' ? 'Accidente' : 'Abandono'}</span>` : p === 0 ? fmtLap(c.finishT - sim.raceStart) : (Math.floor((cls[0].dist - c.dist) / this.T.L) >= 1 ? `+${Math.floor((cls[0].dist - c.dist) / this.T.L)} v.` : fmtGap(c.finishT - cls[0].finishT));
      else time = isFinite(c.best) ? (p === 0 ? fmtLap(c.best) : fmtGap(c.best - best)) : 'Sin tiempo';
      const delta = race && c.gridPos ? c.gridPos - (p + 1) : 0;
      return `<tr><td class="num">${p + 1}</td><td><span class="bar" style="background:${c.team.c1}"></span><span class="code">${c.code}</span> ${esc(c.drv.first)} ${esc(c.drv.last)}</td><td>${esc(c.team.name)}</td><td class="num">${time}</td>
        ${race ? `<td class="num">${c.gridPos}</td><td class="num ${delta > 0 ? 'pos-up' : delta < 0 ? 'pos-down' : ''}">${delta > 0 ? '+' + delta : delta || '='}</td><td>${c.strategy.stints.slice(0, c.stint + 1).map((s) => tyreHTML(s.c)).join(' ')}</td><td class="num">${fmtLap(c.best)}</td>` : `<td class="num">${c.laps.length}</td><td class="num">${c.brain.acc}</td>`}</tr>`;
    }).join('');
    const head = race ? '<th>Pos</th><th>Piloto</th><th>Equipo</th><th class="num">Tiempo</th><th class="num">Salida</th><th class="num">±</th><th>Neumáticos</th><th class="num">Vuelta rápida</th>'
      : '<th>Pos</th><th>Piloto</th><th>Equipo</th><th class="num">Tiempo</th><th class="num">Vueltas</th><th class="num">Mejoras IA</th>';
    const cut = SESSIONS[id]?.cut;
    const title = race ? `Resultado · Gran Premio` : `Resultado · ${SESSIONS[id].label}`;
    const lead = race ? `Vuelta rápida: <b>${sim.fastest ? sim.fastest.car.code + ' ' + fmtLap(sim.fastest.t) : '—'}</b>. El próximo fin de semana los pilotos empiezan de cero.`
      : cut ? `Quedan eliminados del ${cut + 1}.º al ${id === 'Q1' ? 22 : 16}.º.` : id === 'Q3' ? `Pole para <b>${cls[0].drv.first} ${cls[0].drv.last}</b>.` : 'Los pilotos han probado trazadas y frenadas en cada curva. Mira el panel de IA para ver cuánto han mejorado.';
    const m = this.modal(`<header><span class="kicker">${race ? 'CARRERA' : SESSIONS[id].short}</span><h2>${title}</h2><button class="btn ghost" id="mLearn">Ver aprendizaje</button><button class="btn" id="mNext">${NEXT_LABEL[id]}</button></header>
      <div class="body"><p class="lead">${lead}</p><div class="tw"><table class="cls"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`);
    m.querySelector('#mNext').onclick = () => { this.closeModal(); this.app.nextSession(); };
    m.querySelector('#mLearn').onclick = () => this.showLearning(true);
  }

  showLearning(fromResults = false) {
    const sim = this.sim;
    // seco o mojado: cada condición tiene su propia memoria (trazada, límite por curva y tiempos)
    if (this.learnCond == null) this.learnCond = (sim.wx?.line ?? 0) > 0.25 ? 'w' : 'd';
    const cond = this.learnCond, wetC = cond === 'w';
    const kbOf = (c) => (wetC ? c.brain.wet : c.brain);
    const laps = (c) => c.brain.lapHist.filter((l) => !!l.wet === wetC);
    const bestOf = (c) => { const L = laps(c); return L.length ? Math.min(...L.map((l) => l.t)) : 999; };
    const cars = sim.cars.slice().sort((a, b) => bestOf(a) - bestOf(b));
    const prior = { S: 0.22, M: 0.12, H: 0.075 };
    const zero = { exp: 0, acc: 0, mist: 0, locks: 0, catches: 0 };
    const rows = cars.map((c) => {
      const b = c.brain, kb = kbOf(c), st = b.cs?.[cond] || zero;
      const commit = kb ? kb.commit.reduce((a, x) => a + x, 0) / kb.commit.length : NaN;
      const L = laps(c); const first = L[0]?.t, bestL = L.length ? Math.min(...L.map((l) => l.t)) : NaN;
      const gain = first && bestL ? first - bestL : 0;
      const ot = b.ot.reduce((a, o) => ({ t: a.t + o.t, w: a.w + o.w }), { t: 0, w: 0 });
      const deg = 'SMH'.split('').map((x) => (b.deg[x].n >= 3 ? degSlope(b, x, prior[x]).toFixed(2) : '·')).join(' / ');
      const feel = b.feel ? b.feel[cond] : NaN;
      const pct = (x, lo, span) => Math.max(0, Math.min(100, (x - lo) / span * 100));
      return `<tr data-i="${c.i}" class="${c === this.dir.focus ? 'hl' : ''}"><td><span class="bar" style="background:${c.team.c1}"></span><span class="code">${c.code}</span></td>
        <td class="num">${L.length}</td><td class="num">${st.exp}</td><td class="num">${st.acc}</td>
        <td>${isFinite(commit) ? `<span class="meter"><i style="width:${pct(commit, 0.82, 0.2)}%"></i></span> ${(commit * 100).toFixed(1)}%` : '—'}</td>
        <td>${isFinite(feel) ? `<span class="meter"><i style="width:${pct(feel, 0, 1)}%;background:#4FC3F7"></i></span>` : '—'}</td>
        <td class="num">${st.catches}</td><td class="num">${st.locks}</td><td class="num">${st.mist}</td>
        <td class="num">${gain > 0 ? '−' + gain.toFixed(2) + ' s' : '—'}</td>${wetC ? '' : `<td class="num">${deg}</td>`}<td class="num">${ot.t ? `${ot.w}/${ot.t}` : '—'}</td></tr>`;
    }).join('');
    const f = this.dir.focus, fn = esc(f.drv.last);
    const KIND = { trazada: 'prueba otra trazada y es más rápido', limite: 'se atreve a apretar más', copia: 'copia la trazada de otro y le sale', prudente: 'comete un error y aprieta menos', caza: 'caza un derrape' };
    const feed = (sim.learnLog || []).filter((e) => e.wet === wetC).slice(-14).reverse().map((e) => {
      const m = Math.floor(e.t / 60), sec = String(Math.floor(e.t % 60)).padStart(2, '0');
      return `<li class="${e.car === f ? 'me' : ''} k-${e.kind}"><span class="t">${e.sess || ''} ${m}:${sec}</span><span class="bar" style="background:${e.car.team.c1}"></span><b>${e.car.code}</b> ${KIND[e.kind] || e.kind}${e.corner ? ` en <i>${esc(e.corner)}</i>` : ''}${e.gain > 0.004 ? ` <em>−${e.gain.toFixed(2)} s</em>` : ''}</li>`;
    }).join('') || `<li class="empty">Aún no ha aprendido nada en ${wetC ? 'mojado' : 'seco'}.</li>`;
    const noWet = wetC && !sim.cars.some((c) => c.brain.wet);
    const m = this.modal(`<header><span class="kicker">IA</span><h2>Qué están aprendiendo los pilotos</h2>
        <div class="seg" id="lCond"><button data-c="d" class="${wetC ? '' : 'on'}">Seco</button><button data-c="w" class="${wetC ? 'on' : ''}">Mojado</button></div>
        ${fromResults ? '<button class="btn ghost" id="mBack">Volver</button>' : ''}<button class="btn" id="mClose">Cerrar</button></header>
      <div class="body">
        <p class="lead">En cada curva, cada piloto prueba pequeñas variaciones de su trazada y de cuánto agarre se atreve a usar, y se queda con lo que le hace más rápido sin errores; si se equivoca, ahí aprieta menos. <b>El seco y el mojado se aprenden por separado</b>: cada mejora pasa solo un poco (~15 %) a la otra memoria, y cazar derrapes en seco le da algo de tacto para cuando llueva. Lo aprendido se borra al empezar otro fin de semana.</p>
        ${noWet ? '<p class="lead"><b>Este fin de semana aún no ha llovido:</b> la memoria de mojado nacerá de la de seco, más prudente, la primera vez que la pista se moje.</p>' : ''}
        <div class="grid2">
          <div class="chartBox"><h3>Mejor vuelta según aprenden · ${wetC ? 'mojado' : 'seco'}</h3><canvas class="chart" id="lchart" width="1000" height="520"></canvas></div>
          <div class="chartBox"><h3>Trazada de ${fn} en ${wetC ? 'mojado' : 'seco'} frente a la ideal</h3><canvas class="chart" id="lline" width="1000" height="520"></canvas></div>
        </div>
        <div class="grid2" style="margin-top:14px">
          <div class="chartBox"><h3>Cuánto aprieta ${fn} en cada curva · seco y mojado</h3><canvas class="chart" id="lcommit" width="1000" height="420"></canvas></div>
          <div class="chartBox"><h3>Últimos aprendizajes · ${wetC ? 'mojado' : 'seco'}</h3><ul class="lfeed">${feed}</ul></div>
        </div>
        <h3 style="margin-top:16px">Pilotos · ${wetC ? 'mojado' : 'seco'}</h3>
        <div class="tw"><table class="cls"><thead><tr><th>Piloto</th><th class="num">Vueltas</th><th class="num">Pruebas</th><th class="num">Mejoras</th><th>Límite usado</th><th title="Tacto con el coche deslizando: sube cazando derrapes">Tacto</th><th class="num">Derrapes cazados</th><th class="num">Bloqueos</th><th class="num">Errores</th><th class="num">Ganado</th>${wetC ? '' : '<th class="num">Degradación S / M / H (s/vta)</th>'}<th class="num">Adelant. éxito/int.</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>`);
    m.querySelector('#mClose').onclick = () => this.closeModal();
    m.querySelector('#lCond').onclick = (e) => { const c = e.target.closest('button')?.dataset.c; if (c && c !== this.learnCond) { this.learnCond = c; this.showLearning(fromResults); } };
    const back = m.querySelector('#mBack'); if (back) back.onclick = () => { const e = sim.events.slice().reverse().find((x) => x.type === 'sessionEnd'); if (e) this.results(e.id, e.cls); };
    m.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr'); if (tr) { this.dir.setFocus(sim.cars[+tr.dataset.i]); this.showLearning(fromResults); } };
    this.drawLapChart(m.querySelector('#lchart'), wetC);
    this.drawLineChart(m.querySelector('#lline'), wetC);
    this.drawCommitChart(m.querySelector('#lcommit'));
  }

  // límite de agarre que se atreve a usar en cada curva: seco (color del equipo) y mojado (azul)
  drawCommitChart(cv) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, car = this.dir.focus, b = car.brain, T = this.T;
    const n = b.commit.length, L = 60, R = 16, Tp = 18, B = 56, bw = (W - L - R) / n;
    const lo = 0.8, hi = 1.02, Y = (v) => Tp + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - Tp - B);
    g.font = '600 20px "Titillium Web"'; g.fillStyle = '#a3a6b4'; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(Math.round(v * 100) + '%', 4, y + 6); }
    const dryC = car.team.c1 === '#141414' ? '#20E83B' : car.team.c1;
    for (let z = 0; z < n; z++) {
      const x = L + z * bw, w2 = Math.max(3, bw * 0.36);
      g.fillStyle = dryC; g.fillRect(x + bw * 0.12, Y(b.commit[z]), w2, H - B - Y(b.commit[z]));
      if (b.wet) { g.fillStyle = '#4FC3F7'; g.fillRect(x + bw * 0.12 + w2 + 2, Y(b.wet.commit[z]), w2, H - B - Y(b.wet.commit[z])); }
      const nm = (T.corners[z]?.name || '').replace(/^Curva\s*/i, 'T');
      g.fillStyle = '#a3a6b4'; g.font = '600 16px "Titillium Web"'; g.save(); g.translate(x + bw * 0.5, H - B + 14); g.rotate(-0.6); g.fillText(nm.slice(0, 10), -40, 10); g.restore();
    }
    g.font = '600 18px "Titillium Web"'; g.fillStyle = dryC; g.fillRect(W - 260, 8, 14, 14); g.fillStyle = '#d9d9df'; g.fillText('seco', W - 240, 21);
    g.fillStyle = '#4FC3F7'; g.fillRect(W - 170, 8, 14, 14); g.fillStyle = '#d9d9df'; g.fillText(b.wet ? 'mojado' : 'mojado (aún no)', W - 150, 21);
  }

  drawLapChart(cv, wet = false) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, sim = this.sim;
    // mejor vuelta acumulada: baja cuando el piloto aprende algo que le hace más rápido
    const series = sim.cars.map((c) => { let m = Infinity; return { c, pts: c.brain.lapHist.filter((l) => !!l.wet === wet).map((l) => (m = Math.min(m, l.t))) }; }).filter((s) => s.pts.length > 1);
    if (!series.length) { g.fillStyle = '#a3a6b4'; g.font = '600 28px "Titillium Web"'; g.fillText(wet ? 'Aún no hay vueltas limpias en mojado.' : 'Aún no hay vueltas limpias.', 30, 60); return; }
    const all = series.flatMap((s) => s.pts); const lo = Math.min(...all), hi = Math.min(Math.max(...all), lo + 6);
    const maxN = Math.max(...series.map((s) => s.pts.length));
    const L = 70, R = 20, Tp = 20, B = 50;
    const X = (i) => L + (i / Math.max(1, maxN - 1)) * (W - L - R), Y = (t) => Tp + ((Math.min(t, hi) - lo) / (hi - lo || 1)) * (H - Tp - B);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = '#a3a6b4'; g.font = '600 20px "Titillium Web"'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const t = lo + ((hi - lo) * k) / 4; const y = Y(t); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(fmtLap(t).slice(0, 7), 4, y + 6); }
    g.fillText('vueltas limpias →', W - 190, H - 12);
    for (const s of series) {
      const f = s.c === this.dir.focus;
      g.strokeStyle = f ? '#ffffff' : s.c.team.c1; g.globalAlpha = f ? 1 : 0.55; g.lineWidth = f ? 4 : 2;
      g.beginPath(); s.pts.forEach((t, i) => (i ? g.lineTo(X(i), Y(t)) : g.moveTo(X(i), Y(t)))); g.stroke();
      if (f) { const i = s.pts.length - 1; g.fillStyle = '#fff'; g.beginPath(); g.arc(X(i), Y(s.pts[i]), 6, 0, 7); g.fill(); g.font = '900 22px "Titillium Web"'; g.fillText(s.c.code, X(i) - 50, Y(s.pts[i]) - 12); }
    }
    g.globalAlpha = 1;
  }

  drawLineChart(cv, wet = false) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, T = this.T, car = this.dir.focus;
    const kb = wet ? car.brain.wet : car.brain;
    if (!kb) { g.fillStyle = '#a3a6b4'; g.font = '600 28px "Titillium Web"'; g.fillText('Aún no tiene trazada de mojado.', 30, 60); return; }
    const line = buildLine(T, kb, new Float32Array(T.N));
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < T.N; i += 5) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
    // zoom en la curva más lenta con más diferencia entre trazadas
    let bz = T.zones[0], bd = -1;
    for (const z of T.zones) { let d = 0; for (let q = 0; q < z.len; q += 5) { const i = T.idx(z.a + q); d += Math.abs(line[i] - T.ideal[i]); } if (d / z.len > bd) { bd = d / z.len; bz = z; } }
    const P = [0, 0, 0]; let cx0 = 1e9, cx1 = -1e9, cz0 = 1e9, cz1 = -1e9;
    for (let q = 0; q < bz.len; q += 2) { T.pos(bz.a + q, 0, P); cx0 = Math.min(cx0, P[0]); cx1 = Math.max(cx1, P[0]); cz0 = Math.min(cz0, P[2]); cz1 = Math.max(cz1, P[2]); }
    const pad = 30; const sc = Math.min((W - 2 * pad) / (cx1 - cx0 + 30), (H - 2 * pad - 30) / (cz1 - cz0 + 30));
    const mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2;
    const XY = (x, z) => [W / 2 + (x - mx) * sc, H / 2 + (z - mz) * sc];
    const strokeLine = (fn, col, w, dash = []) => {
      g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash); g.beginPath();
      for (let q = -40; q <= bz.len + 40; q += 2) { T.pos(bz.a + q, fn(T.idx(bz.a + q)), P); const [x, y] = XY(P[0], P[2]); q === -40 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke(); g.setLineDash([]);
    };
    strokeLine(() => 0, '#3a3c44', T.halfW * 2 * sc);
    strokeLine(() => T.halfW, '#d9d9df', 2); strokeLine(() => -T.halfW, '#d9d9df', 2);
    strokeLine((i) => T.ideal[i], '#a3a6b4', 3, [8, 8]);
    strokeLine((i) => line[i], car.team.c1 === '#141414' ? '#20E83B' : car.team.c1, 5);
    g.fillStyle = '#fff'; g.font = '900 26px "Titillium Web"'; g.fillText(bz.corner.name, 16, 34);
    g.font = '600 20px "Titillium Web"'; g.fillStyle = '#a3a6b4'; g.fillText('discontinua: trazada ideal (la goma) · color: la suya', 16, H - 14);
  }
}

export { NEXT };
