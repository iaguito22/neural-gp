// Modo mánager: eliges un equipo y llevas a sus dos pilotos desde el muro de boxes.
// Por piloto: ritmo (atacar / normal / cuidar), llamar a boxes con el compuesto que quieras, estrategia automática o
// manual y ajuste de alerón (se monta en la siguiente parada o en el garaje). Arriba, radar de lluvia con lo que viene.
import { COMPOUNDS } from './teams.js';

const TYRES = ['S', 'M', 'H', 'I', 'W'];
const PACES = [['push', 'Atacar'], ['normal', 'Normal'], ['save', 'Cuidar']];
const TRIMS = [[-1, 'Poca carga'], [-0.5, ''], [0, 'Equilibrado'], [0.5, ''], [1, 'Mucha carga']];
const fmt = (t) => (isFinite(t) ? `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}` : '—');

export class Manager {
  constructor(sim, dir, teamId) {
    this.sim = sim; this.dir = dir; this.teamId = teamId;
    this.cars = sim.cars.filter((c) => c.team.id === teamId);
    for (const c of this.cars) c.mgr = { pace: 'normal', auto: true, box: false, tyre: null, trimNext: null };
    sim.managed = teamId;
    document.body.classList.add('mgr');
    const el = this.el = document.createElement('div'); el.id = 'mgr';
    document.getElementById('hud').appendChild(el);
    this.sel = 0; this.t = 0; this.render();
    el.addEventListener('click', (e) => this.onClick(e));
  }

  onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'sel') { this.sel = +b.dataset.v; this.dir.setFocus(this.cars[this.sel]); this.render(); return; }
    const car = this.sim.cars[+b.dataset.i], M = car?.mgr; if (!M) return;
    const a = b.dataset.a, v = b.dataset.v;
    if (a === 'pace') M.pace = v;
    else if (a === 'auto') M.auto = !M.auto;
    else if (a === 'tyre') M.tyre = M.tyre === v ? null : v;
    else if (a === 'box') { M.box = !M.box; if (!M.box) car.pitReq = false; }
    else if (a === 'trim') { const t = +v; M.trimNext = t === (car.trim || 0) ? null : t; if (car.state === 'garage') { car.trim = t; M.trimNext = null; this.sim.rebuildProfile(car); } }
    else if (a === 'focus') this.dir.setFocus(car);
    this.render();
  }

  update(dt) { this.t -= dt; if (this.t <= 0) { this.t = 0.25; this.render(); } }

  render() {
    const sim = this.sim, race = sim.session?.id === 'RACE';
    const tabs = this.cars.map((c, k) => {
      const w = Math.round((1 - c.tyre.wear) * 100), st = c.retired ? 'OUT' : c.inPit ? 'BOX' : c.mgr.box || c.pitReq ? '→BOX' : '';
      return `<button data-a="sel" data-v="${k}" class="tab ${k === this.sel ? 'on' : ''}"><span class="p">${c.pos ? 'P' + c.pos : '—'}</span><span class="bar" style="background:${c.team.c1}"></span><b>${c.code}</b><span class="ty" style="--tc:${COMPOUNDS[c.tyre.c].color}">${c.tyre.c}</span><span class="k">${w}%</span>${st ? `<em>${st}</em>` : ''}</button>`;
    }).join('');
    const cards = [this.cars[this.sel]].map((c) => {
      const M = c.mgr, tc = COMPOUNDS[c.tyre.c], wear = Math.round(c.tyre.wear * 100);
      const gapA = race && c.pos > 1 ? sim.raceOrder?.[c.pos - 2] : null, gapB = race ? sim.raceOrder?.[c.pos] : null;
      const g = (o) => (o && sim.gapTo ? sim.gapTo(c, o) : null);
      const ga = gapA ? Math.abs(g(gapA) ?? NaN) : NaN, gb = gapB ? Math.abs(sim.gapTo?.(gapB, c) ?? NaN) : NaN;
      const state = c.retired ? 'ABANDONO' : c.state === 'garage' ? 'EN EL GARAJE' : c.inPit ? 'EN BOXES' : M.box || c.pitReq ? 'ENTRA A BOXES' : '';
      const trimNow = c.trim || 0, trimSel = M.trimNext ?? trimNow;
      const last = c.laps?.length ? c.laps[c.laps.length - 1] : NaN;
      return `<div class="mc ${c === this.dir.focus ? 'f' : ''}">
        <div class="mh" data-a="focus" data-i="${c.i}"><span class="p">${race ? 'P' + c.pos : c.pos ? 'P' + c.pos : '—'}</span><span class="bar" style="background:${c.team.c1}"></span><b>${c.drv.last}</b>
          <span class="ty" style="--tc:${tc.color}">${c.tyre.c}</span><span class="wr"><i style="width:${100 - wear}%"></i></span><span class="k">${100 - wear}%</span></div>
        <div class="mi"><span>${race ? `Delante <b>${isFinite(ga) ? '+' + ga.toFixed(1) : '—'}</b> · Detrás <b>${isFinite(gb) ? '−' + gb.toFixed(1) : '—'}</b>` : `Mejor <b>${fmt(c.best)}</b>`}</span><span>Últ. <b>${fmt(last)}</b></span></div>
        ${state ? `<div class="st">${state}</div>` : ''}
        <div class="row seg">${PACES.map(([v, l]) => `<button data-a="pace" data-v="${v}" data-i="${c.i}" class="${M.pace === v ? 'on' : ''} ${v}">${l}</button>`).join('')}</div>
        <div class="row tyres">${TYRES.map((t) => `<button data-a="tyre" data-v="${t}" data-i="${c.i}" class="${M.tyre === t ? 'on' : ''}" style="--tc:${COMPOUNDS[t].color}" title="Compuesto para la próxima parada">${t}</button>`).join('')}
          <button data-a="box" data-v="1" data-i="${c.i}" class="box ${M.box ? 'on' : ''}" ${!race ? 'disabled title="Solo en carrera"' : ''}>${M.box ? 'BOX ✓' : 'BOX'}</button></div>
        <div class="row trim" title="Alerón: se monta en la próxima parada o en el garaje">${TRIMS.map(([v, l]) => `<button data-a="trim" data-v="${v}" data-i="${c.i}" class="${trimSel === v ? 'on' : ''} ${trimNow === v ? 'now' : ''}">${l || '·'}</button>`).join('')}</div>
        <div class="row foot"><button data-a="auto" data-i="${c.i}" class="auto ${M.auto ? 'on' : ''}">Estrategia ${M.auto ? 'automática' : 'manual'}</button>${M.trimNext != null ? '<span class="k">alerón nuevo en la parada</span>' : ''}</div>
      </div>`;
    }).join('');
    this.el.innerHTML = `<div class="mt"><span>MURO DE BOXES</span><b>${this.cars[0].team.name}</b></div>${this.radar()}<div class="tabs">${tabs}</div>${cards}`;
  }

  // radar: agua ahora (en la trazada y fuera) y la lluvia que viene en los próximos minutos (del guion del tiempo)
  radar() {
    const W = this.sim.wx; if (!W) return '';
    const t = this.sim.t, H = 15 * 60, cells = 30;
    const at = (tt) => { let r = W.ev[0]?.rain ?? 0; for (const e of W.ev) if (e.t <= tt) r = e.rain; return r; };
    const bars = Array.from({ length: cells }, (_, k) => {
      const tt = t + (k / cells) * H, r = k === 0 ? W.rain : at(tt);
      const h = Math.round(Math.min(1, r) * 100), col = r < 0.05 ? 'rgba(255,255,255,0.08)' : r < 0.3 ? '#4FC3F7' : r < 0.6 ? '#2F7BFF' : '#7C4DFF';
      return `<i style="height:${Math.max(6, h)}%;background:${col}"></i>`;
    }).join('');
    const next = W.ev.find((e) => e.t > t);
    const txt = next ? (next.rain > W.target + 0.05 ? `Lluvia ${next.rain > 0.6 ? 'fuerte' : next.rain > 0.3 ? 'moderada' : 'débil'} en ~${Math.max(1, Math.round((next.t - t) / 60))} min` : `Para en ~${Math.max(1, Math.round((next.t - t) / 60))} min`) : W.rain > 0.05 ? 'Sigue lloviendo' : 'Sin lluvia a la vista';
    return `<div class="rad"><div class="rt"><span>RADAR · 15 MIN</span><b>${txt}</b></div><div class="rb">${bars}</div>
      <div class="rw"><span>Agua en la trazada <b>${Math.round(W.line * 100)}%</b></span><span>Fuera <b>${Math.round(W.wet * 100)}%</b></span></div></div>`;
  }
}
