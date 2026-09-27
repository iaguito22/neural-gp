// Radios piloto ⇄ equipo. Salen de los eventos de la sim: sobre todo del coche enfocado y de lo gordo (líder, podio,
// accidentes). Se ven en un panel del HUD y, con el sonido puesto y a velocidad normal, se oyen: pitido de radio y
// voz sintetizada del navegador (speechSynthesis), más grave el ingeniero que el piloto.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const P = (n) => `P${n}`;

export class Radio {
  constructor(sim, dir, app) {
    this.sim = sim; this.dir = dir; this.app = app;
    this.q = []; this.cur = null; this.curT = 0; this.gap = 0;
    this.last = new Map();           // última radio por coche y tipo (para no repetir)
    this.voices = [];
    const sv = () => { this.voices = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang)); };
    if (window.speechSynthesis) { sv(); window.speechSynthesis.onvoiceschanged = sv; }
    const el = this.el = document.createElement('div'); el.id = 'radio';
    document.getElementById('hud').appendChild(el);
    sim.on((e) => this.onEvent(e));
  }

  // ¿merece radio? el enfocado siempre; los demás solo si pasa algo gordo
  focusOr(car, big) { return car === this.dir.focus || big; }
  once(car, key, secs) {
    const k = car.code + key, t = this.sim.t, prev = this.last.get(k);
    if (prev != null && t - prev < secs && t >= prev) return false;
    this.last.set(k, t); return true;
  }
  say(car, lines, prio = 1) {
    // lines: [['d'|'e', texto], ...]  d = piloto, e = ingeniero
    if (this.q.length > 4) this.q = this.q.filter((m) => m.prio > prio);
    this.q.push({ car, lines, prio, t: this.sim.t });
    this.q.sort((a, b) => b.prio - a.prio);
  }

  onEvent(e) {
    const s = this.sim, c = e.car, race = s.session?.id === 'RACE', f = this.dir.focus;
    if (!c && e.type !== 'weather') return;
    const eng = c ? c.drv.first : '';
    switch (e.type) {
      case 'lockup':
        if (c === f && e.sev > 0.5 && this.once(c, 'lock', 40)) this.say(c, [['d', pick([`Me he pasado en la ${e.corner || 'frenada'}, he bloqueado.`, 'Bloqueo delante, creo que he cuadrado la goma.', 'Uf, bloqueo. Vibra un poco.'])], ['e', pick(['Entendido, cuida las frenadas.', 'Copiado. Vigilamos la goma.', 'Recibido, tranquilo.'])]]);
        break;
      case 'mistake':
        if (e.kind === 'spin' && this.focusOr(c, race && c.pos <= 5) && this.once(c, 'spin', 30)) this.say(c, [['d', pick(['¡Trompo, trompo!', '¡Se me ha ido la trasera!', '¡Me he girado!'])], ['e', pick([`${eng}, ¿estás bien? ¿Puedes seguir?`, 'Copiado. Vuelve con cuidado, viene tráfico.'])]], 3);
        else if (e.kind === 'off' && c === f && this.once(c, 'off', 45)) this.say(c, [['d', pick(['Me he salido, perdón.', 'Me he ido largo.', 'Fuera de pista, vuelvo.'])]]);
        break;
      case 'debris':
        if (e.broken && this.focusOr(c, race && c.pos <= 6) && this.once(c, 'dmg' + e.part, 60)) {
          const what = e.part === 'fw' ? 'el alerón delantero' : e.part === 'rw' ? 'el alerón trasero' : 'la suspensión';
          this.say(c, [['d', pick([`¡He roto ${what}!`, `Tengo daños, ${what}.`])], ['e', race ? pick(['Box, box. Entra esta vuelta.', 'Lo vemos. Box esta vuelta, cambiamos piezas.']) : 'Recibido, vuelve a boxes.']], 3);
        }
        break;
      case 'contact':
        if (!e.wall && c === f && e.sev > 5 && this.once(c, 'touch', 40)) this.say(c, [['d', pick([`¡Me ha tocado ${e.other?.code || ''}!`, '¡Contacto! ¿Qué hace?', '¡Me ha cerrado la puerta!'])], ['e', 'Copiado, lo están mirando.']], 2);
        break;
      case 'retire':
        if (this.focusOr(c, race && c.pos <= 8)) this.say(c, [['d', e.why === 'accidente' ? pick(['Estoy bien. Coche destrozado.', 'Estoy bien... lo siento, chicos.']) : pick(['Se acabó. Lo siento.', 'Paro el coche.'])], ['e', pick([`Mala suerte, ${eng}. Lo importante es que estás bien.`, 'Recibido. Aparca donde puedas.'])]], 4);
        break;
      case 'overtake':
        if (c === f && race && this.once(c, 'ot', 25)) this.say(c, [['e', pick([`Buen adelantamiento. Ahora ${P(e.pos)}.`, `¡Bien hecho! ${P(e.pos)}.`, `Eso es. ${P(e.pos)}, sigue así.`])]]);
        else if (e.other === f && race && this.once(e.other, 'lost', 30)) this.say(e.other, [['d', pick(['No tengo agarre.', 'No he podido defender.', '¿Cómo va de ritmo él?'])], ['e', pick(['Copiado. Tu ritmo es bueno, paciencia.', 'Entendido. Las gomas vendrán.'])]]);
        break;
      case 'pitin':
        if (c === f && race) this.say(c, [['e', pick(['Box, box. Box, box.', 'Box esta vuelta, box esta vuelta.'])], ['d', 'Copiado.']], 2);
        break;
      case 'pitstop':
        if (c === f && race) this.say(c, [['e', e.time > 4 ? pick(['Lo siento, problema en la parada. Empuja.', 'Parada lenta, perdona. Vamos.']) : pick(['Buena parada. Ahora a empujar.', 'Gomas nuevas. Empuja estas vueltas.'])]], 2);
        break;
      case 'fastest':
        if (c === f && this.once(c, 'fast', 60)) this.say(c, [['e', race ? pick(['Vuelta rápida. Muy bien.', '¡Vuelta rápida de carrera!']) : pick(['P1, P1. Gran vuelta.', 'Eres el más rápido, bien hecho.'])]]);
        break;
      case 'limits':
        if (c === f && this.once(c, 'lim', 60)) this.say(c, [['e', 'Te han quitado la vuelta, límites de pista.'], ['d', pick(['Vale, vale.', '¿En serio?'])]]);
        break;
      case 'knockout':
        if (c === f) this.say(c, [['e', pick([`Lo siento, ${eng}. Eliminados.`, 'Fuera. No ha sido suficiente, lo siento.'])], ['d', pick(['Mierda. No tenía más.', 'Vale. Lo siento, chicos.'])]], 3);
        break;
      case 'finish':
        if (c === f || (race && e.pos === 1)) {
          const p = e.pos;
          this.say(c, [['e', p === 1 ? pick([`¡Ganamos, ${eng}! ¡Ganamos!`, '¡P1! ¡Victoria! ¡Increíble!']) : p <= 3 ? `¡${P(p)}, podio! ¡Qué carrera!` : p <= 10 ? `${P(p)}. Puntos. Buen trabajo.` : `${P(p)}. Hoy no ha podido ser.`], ['d', p <= 3 ? pick(['¡Sí! ¡Gracias a todos!', '¡Vamos! ¡Qué coche!']) : pick(['Gracias, chicos.', 'Seguimos trabajando.'])]], 4);
        }
        break;
      case 'weather':
        if (e.what === 'rainStart' && f && this.once(f, 'rain', 90)) this.say(f, [['d', pick(['Empieza a llover.', 'Gotas en la visera. Está lloviendo.'])], ['e', pick(['Recibido. Te decimos cuándo cambiar.', 'Copiado, preparamos intermedios.'])]], 2);
        else if (e.what === 'rainStop' && f && this.once(f, 'dry', 90)) this.say(f, [['e', 'Ha parado de llover. La trazada se secará pronto.']]);
        break;
      case 'lap':
        if (c === f && race && c.tyre.wear > 0.62 && this.once(c, 'tyres', 200)) this.say(c, [['d', pick(['Las gomas se acaban.', 'No me queda goma.'])], ['e', 'Entendido. Estamos con ello.']]);
        break;
    }
  }

  update(dt, speed) {
    const el = this.el;
    this.gap -= dt;
    if (this.cur) {
      this.curT -= dt;
      if (this.curT <= 0) { this.cur = null; el.classList.remove('on'); this.gap = 0.6; }
      return;
    }
    // mensajes viejos (la sim va rápida) se descartan
    while (this.q.length && this.sim.t - this.q[0].t > 25) this.q.shift();
    if (this.gap > 0 || !this.q.length) return;
    const m = this.cur = this.q.shift();
    const c = m.car, col = c.team.c1 === '#141414' ? c.team.c2 : c.team.c1;
    el.innerHTML = `<div class="rh"><span class="bar" style="background:${col}"></span><b>${c.code}</b><span>RADIO · ${c.team.short}</span><i class="wave"><em></em><em></em><em></em><em></em></i></div>` +
      m.lines.map(([w, t]) => `<p class="${w}"><span>${w === 'd' ? c.drv.last.toUpperCase() : 'INGENIERO'}</span>${t}</p>`).join('');
    el.classList.add('on');
    const txt = m.lines.reduce((n, [, t]) => n + t.length, 0);
    this.curT = Math.max(3.5, 1.2 + txt * 0.07);
    if (this.app.audio?.on && speed > 0 && speed <= 2) this.speak(m);
  }

  speak(m) {
    const ss = window.speechSynthesis; if (!ss) return;
    this.beep();
    ss.cancel();
    const v = this.voices;
    m.lines.forEach(([w, t], k) => {
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'es-ES'; if (v.length) u.voice = v[(w === 'd' ? 1 : 0) % v.length];
      u.rate = w === 'd' ? 1.15 : 1.05; u.pitch = w === 'd' ? 1.1 : 0.8; u.volume = 0.9;
      if (k === m.lines.length - 1) u.onend = () => this.beep(0.7);
      ss.speak(u);
    });
  }

  // pitido de radio (dos tonos cortos con algo de ruido)
  beep(g = 1) {
    try {
      const ctx = this.ctx || (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const t = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0.06 * g; out.connect(ctx.destination);
      [[1200, 0], [900, 0.07]].forEach(([fq, d]) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fq;
        const e = ctx.createGain(); e.gain.setValueAtTime(0, t + d); e.gain.linearRampToValueAtTime(1, t + d + 0.005); e.gain.setValueAtTime(1, t + d + 0.05); e.gain.linearRampToValueAtTime(0, t + d + 0.06);
        o.connect(e).connect(out); o.start(t + d); o.stop(t + d + 0.07);
      });
    } catch { /* sin audio */ }
  }
}
