// Arranque: pista, mundo 3D, coches, simulación, director de cámaras, HUD y flujo del fin de semana.
import * as THREE from 'three';
import { buildTrack, HALF_W, CIRCUITS } from './track.js';
import { Sim, DT } from './sim.js';
import { buildWorld } from './world.js';
import { buildScenery } from './scenery.js';
import { buildCar } from './carModel.js';
import { Director } from './director.js';
import { UI, NEXT } from './ui.js';
import * as TX from './textures.js';
import { EngineAudio } from './audio.js';
import { Radio } from './radio.js';
import { Manager } from './manager.js';
import { Replay } from './replay.js';
import { TEAMS } from './teams.js';
import { buildWeather } from './weather.js';
import { buildFx } from './fx.js';

// solo se guardan los ajustes: lo aprendido empieza de cero cada fin de semana (cada uno es un mundo)
const SETTINGS = 'ngp-settings-v1';
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const msg = (t) => { const el = document.getElementById('loadMsg'); if (el) el.textContent = t; };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

const params = new URLSearchParams(location.search);
const DEFAULT_SPEED = { FP: 1, Q1: 1, Q2: 1, Q3: 1, RACE: 1 };

async function main(choice) {
  const quality = choice.quality, trackId = choice.track;
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('ngp-brains')) localStorage.removeItem(k); } catch { /* sin almacenamiento */ }
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 0.85 : 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = CIRCUITS[trackId].night ? 1.05 : CIRCUITS[trackId].sunset ? 0.95 : 0.82;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  TX.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 14000);

  msg('Trazando el circuito…'); await frame();
  const T = buildTrack(trackId);
  msg('Levantando gradas, boxes y escapatorias…'); await frame();
  const world = buildWorld(T, scene, renderer, quality);
  msg('Plantando bosques y montando el paddock…'); await frame();
  const scenery = buildScenery(T, scene, world, quality, world.sunDir);
  msg('Preparando los 22 monoplazas…'); await frame();
  const weatherFx = buildWeather(scene, world, scenery, renderer, camera, quality);
  world.autoOccluders(scene);
  const sim = new Sim(T, { raceLaps: choice.raceLaps, brains: {} });
  sim.weatherMode = choice.weather;
  const visuals = sim.cars.map((car) => { const v = buildCar(car.team, car.drv); scene.add(v.root); return v; });
  const fx = buildFx(scene, T, sim, visuals, world);

  const director = new Director(camera, renderer.domElement, T, sim, world, visuals);
  scenery.addCameraTowers(director.trackCams);

  // precarga en la GPU: todo (geometrías, texturas, shaders, las dos versiones de cada coche) se sube ahora, en la
  // pantalla de carga; si no, cada plano nuevo que descubría otra zona del circuito daba un tirón de 50-180 ms
  msg('Cargando en la tarjeta gráfica…'); await frame();
  {
    const culled = [], hidden = [];
    scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } }
      if (!o.visible) { hidden.push(o); o.visible = true; }
    });
    scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) renderer.initTexture(m[k]); });
    camera.position.set(0, 300, 0); camera.lookAt(0, 0, 0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
  }
  const app = {
    sim, T, director, speed: 1, lastSpeed: 1, skipping: false, audio: choice.audio,
    setSpeed(s) { if (s > 0) this.lastSpeed = s; this.speed = s; ui.syncButtons(); },
    skip() { if (!sim.session?.done) { this.skipping = true; document.getElementById('skipBar')?.remove(); const d = document.createElement('div'); d.id = 'skipBar'; d.innerHTML = '<b>Simulando el resto de la sesión…</b><div class="track"><i></i></div>'; document.getElementById('hud').appendChild(d); } },
    restart() { location.reload(); },   // fin de semana nuevo: pilotos sin nada aprendido
    nextSession() {
      const cur = sim.session?.id;
      let nx = cur ? NEXT[cur] : 'FP';
      if (cur === 'RACE' || !nx) { this.restart(); return; }
      startSession(nx);
    },
  };
  const ui = new UI(app);
  const radio = app.radio = new Radio(sim, director, app);
  const replay = app.replay = new Replay(app, sim, director);

  function startSession(id) {
    sim.startSession(id);
    app.setSpeed(DEFAULT_SPEED[id]);
    director.setAuto(true);
    if (id === 'RACE') { director.focus = sim.raceOrder[0]; director.type = 'heli'; director.first = true; }
    else { director.focus = sim.cars[0]; director.type = 'track'; }
  }

  sim.on((e) => {
    if (e.type === 'sessionEnd') {
      app.skipping = false; document.getElementById('skipBar')?.remove();
      setTimeout(() => ui.results(e.id, e.cls), app.speed > 4 ? 300 : 2500);
    }
  });

  // --- colocación de los coches cada frame
  const P = [0, 0, 0], P2 = [0, 0, 0];
  let simLead = 0;
  const camWorld = new THREE.Vector3();
  function place(car, V, dt, realDt) {
    const root = V.root;
    // detalle según tamaño en pantalla (distancia corregida por el zoom), con histéresis
    const eff = camera.position.distanceTo(root.position) * Math.tan((camera.fov * Math.PI) / 360) / Math.tan(Math.PI / 6);
    if (V.detailed && eff > 110) { V.detailed = false; V.hi.visible = false; V.lo.visible = true; }
    else if (!V.detailed && eff < 85) { V.detailed = true; V.hi.visible = true; V.lo.visible = false; }
    const inGarage = car.state === 'garage' || car.out;
    if (inGarage) {
      const box = T.pit.boxes[TEAMS.indexOf(car.team)];
      const first = sim.cars.find((c) => c.team === car.team) === car;
      const s = box.s + (first ? 4.5 : -4.5);
      T.pos(s, T.pit.d - 16, P);
      const i = T.idx(s);
      root.position.set(P[0], P[1] + 0.02, P[2]);
      root.rotation.set(0, Math.atan2(T.lx[i], T.lz[i]), 0, 'YXZ');
      V.body.rotation.set(0, 0, 0); V.teleport = true;
      return;
    }
    // interpolación: se dibuja donde estará tras el tiempo aún no simulado (evita saltos de 0/2 pasos por fotograma)
    const lead = (car.inPit && car.pitPhase === 'stop') || car.state === 'grid' ? 0 : simLead;   // parado en la parrilla: sin extrapolar
    const sv = car.s + (car.vs ?? car.v) * lead, dv = car.d + (car.inPit ? 0 : (car.d - (car.dPrev ?? car.d)) / DT * lead);
    T.pos(sv, dv, P);
    const i = T.idx(sv);
    const trackYaw = Math.atan2(T.lerp(T.tx, sv), T.lerp(T.tz, sv));
    // el rumbo relativo y el giro de volante se suavizan (la física trabaja a pasos discretos)
    const k = 1 - Math.exp(-realDt * 10);
    if (V.visYaw == null || V.teleport) { V.visYaw = car.yaw; V.visSteer = car.steer; V.teleport = false; }
    V.visYaw += (car.yaw - V.visYaw) * k;
    V.visSteer += (car.steer - V.visSteer) * (1 - Math.exp(-realDt * 8));
    T.pos(sv + 2, dv, P2); const yA = P2[1]; T.pos(sv - 2, dv, P2);
    const grade = (yA - P2[1]) / 4;
    const bank = Math.abs(dv) <= HALF_W + 0.5 ? T.lerp(T.bank, sv) : 0;
    root.position.set(P[0], P[1], P[2]);
    root.rotation.set(-Math.atan(grade), trackYaw + V.visYaw + car.slide, -bank, 'YXZ');
    V.body.rotation.set(car.pitch, 0, car.roll * 0.6);
    // ruedas
    // giro de rueda: por encima de ~1/4 de vuelta por fotograma se ve estroboscópico -> se limita
    const spin = Math.min((car.v * dt) / 0.36, 0.9);
    for (const w of V.wheels) { w.spin.rotation.x += spin; if (w.front) w.steer.rotation.y = THREE.MathUtils.clamp(V.visSteer * 0.5, -0.38, 0.38); }
    for (const w of V.loWheels) w.rotation.x += spin;
    V.flap.rotation.x += ((car.drs ? -0.55 : 0) - V.flap.rotation.x) * Math.min(1, dt * 12);
    // luz trasera: parpadea en el pit lane, con VSC o despacio; con pista mojada, encendida siempre
    const blink = (car.inPit || sim.flag === 'VSC' || car.v < 15) && Math.floor(performance.now() / 250) % 2 === 0;
    V.rain.material.emissiveIntensity = blink ? 3 : (sim.wx?.wet ?? 0) > 0.15 ? 2.2 : 0;
    V.setCompound(car.tyre.c, car.v > 22);
  }

  // --- bucle
  window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });
  let last = performance.now(), acc = 0, skipFrame = 0;
  const focusPos = new THREE.Vector3();
  function loop(now) {
    requestAnimationFrame(loop);
    try { tick(now); } catch (e) { console.error(e); }
  }
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (app.skipping && sim.session && !sim.session.done) {
      // misma simulación que viéndola (paso de 1/60 s), pero casi todo el tiempo para simular: solo se dibuja 1 de cada 4 fotogramas
      const t0 = performance.now();
      while (performance.now() - t0 < 70 && !sim.session.done) for (let k = 0; k < 30; k++) sim.step();
      skipFrame = (skipFrame + 1) % 4;
      const ss = sim.session;
      const prog = ss.id === 'RACE' ? (sim.raceOrder?.[0]?.lap ?? 0) / sim.raceLaps : sim.t / (ss.dur + 60);
      const bar = document.querySelector('#skipBar i'); if (bar) bar.style.width = `${Math.min(100, prog * 100)}%`;
    } else if (replay.active) {
      acc = 0;                                             // repetición: la carrera se congela
    } else if (sim.session && !sim.session.done) {
      acc += dt * app.speed;
      let n = 0; const maxSteps = 60 * 40;
      while (acc >= DT && n < maxSteps) { sim.step(); acc -= DT; n++; }
      if (n >= maxSteps) acc = 0;
    }
    if (!app.skipping) replay.record();
    const replaying = replay.update(dt);
    simLead = replaying || app.skipping || !sim.session || sim.session.done ? 0 : Math.max(0, Math.min(DT, acc));
    if (app.skipping && skipFrame !== 0) { ui.update(dt); return; }
    sim.cars.forEach((car, k) => place(car, visuals[k], dt * (replaying ? replay.rate : app.speed || 0), dt));
    director.update(dt);
    weatherFx.update(dt, sim, director.type, visuals);
    fx.update(dt);
    focusPos.copy(visuals[director.focus.i].root.position);
    world.update(dt, sim, focusPos, camera.position);
    scenery.update(dt, focusPos, camera.position);
    app.audio.update(director.focus, director.type, camera, focusPos, app.skipping ? 99 : replaying ? 1 : app.speed, sim, visuals);
    radio.update(dt, app.skipping ? 99 : app.speed);
    app.manager?.update(dt);
    ui.update(dt);
    renderer.render(scene, camera);
  }

  // --- empieza
  document.getElementById('loading').remove();
  if (choice.mode === 'mgr') { app.manager = new Manager(sim, director, choice.team); director.setFocus(app.manager.cars[0]); }
  ui.syncButtons();
  if (!params.get('autostart')) startSession(params.get('start') || 'FP');
  if (params.get('autostart')) { ui.closeModal(); startSession(params.get('autostart')); }
  requestAnimationFrame(loop);
  window.__app = app; window.__vis = visuals; window.__world = world; window.__sim = sim; window.__dir = director; window.__scene = scene; window.__THREE = THREE; window.__renderer = renderer; window.__fx = fx;
}

// --- pantalla de inicio: sale al momento, sin construir nada (el circuito elegido se carga al empezar)
async function startScreen() {
  await document.fonts?.ready;
  const settings = readJSON(SETTINGS) || {};
  const quality = params.get('q') || settings.quality || 'high';
  const trackId = CIRCUITS[params.get('track')] ? params.get('track') : CIRCUITS[settings.track] ? settings.track : 'gp';
  const laps = +(params.get('laps') || settings.raceLaps || 20), wx = params.get('wx') || settings.weather || 'random';
  const loading = document.getElementById('loading'); loading.style.display = 'none'; document.body.classList.add('menu');
  // circuitos: dibujo del trazado de cada uno (del eje real), longitud y curvas
  const trackCard = (c) => {
    const TT = buildTrack(c.id);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < TT.N; i += 10) { x0 = Math.min(x0, TT.x[i]); x1 = Math.max(x1, TT.x[i]); z0 = Math.min(z0, TT.z[i]); z1 = Math.max(z1, TT.z[i]); }
    const W = 150, H = 96, k = Math.min((W - 12) / (x1 - x0), (H - 12) / (z1 - z0)), ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
    let d = ''; for (let i = 0; i < TT.N; i += 12) d += `${i ? 'L' : 'M'}${(ox + (TT.x[i] - x0) * k).toFixed(1)},${(oz + (TT.z[i] - z0) * k).toFixed(1)}`;
    const sx = ox + (TT.x[0] - x0) * k, sz = oz + (TT.z[0] - z0) * k;
    return `<button class="tcard ${c.id === trackId ? 'on' : ''}" data-track="${c.id}"><svg viewBox="0 0 ${W} ${H}"><path d="${d}Z"/><circle cx="${sx.toFixed(1)}" cy="${sz.toFixed(1)}" r="3.2"/></svg>
      <b>${c.name}</b><span>${c.place}</span><em>${(TT.L / 1000).toFixed(2)} km · ${TT.corners.length} curvas</em></button>`;
  };
  const seg = (id, opts, cur) => `<div class="seg" data-for="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const hidden = (id, opts, cur) => `<select id="${id}" hidden>${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const O = {
    iLaps: [10, 15, 20, 30].map((l) => [l, l]),
    iWx: [['random', 'Aleatorio'], ['dry', 'Seco'], ['mixed', 'Chubascos'], ['wet', 'Lluvia']],
    iMode: [['watch', 'Espectador'], ['mgr', 'Mánager']],
    iQ: [['high', 'Alta'], ['low', 'Baja']],
  };
  const curMode = settings.mode === 'mgr' ? 'mgr' : 'watch', curTeam = TEAMS.some((t) => t.id === settings.team) ? settings.team : TEAMS[0].id;
  const intro = document.createElement('div'); intro.className = 'modal'; document.body.appendChild(intro);
  intro.innerHTML = `<div class="sheet"><div class="start">
      <div class="st-l">
        <div class="logo">NEURAL <i>GP</i></div>
        <p class="tag">Veintidós pilotos con IA que aprenden dando vueltas. Buscan la trazada en libres, la exprimen en clasificación y pelean en carrera. Cada fin de semana empiezan de cero.</p>
        <h3>Circuito</h3>
        <div class="tcards">${Object.values(CIRCUITS).map(trackCard).join('')}</div>
        <h3>El fin de semana</h3>
        <div class="sched"><div><b>Libres</b><span>30 min · buscan trazada y límite</span></div><div><b>Clasificación</b><span>Q1 12′ · Q2 10′ · Q3 9′</span></div><div><b>Carrera</b><span id="schedLaps">${laps} vueltas · paradas y peleas</span></div></div>
      </div>
      <div class="st-r">
        <h3>Modo</h3>${seg('iMode', O.iMode, curMode)}
        <div class="teams ${curMode === 'mgr' ? '' : 'off'}">${TEAMS.map((t) => `<button data-team="${t.id}" class="${t.id === curTeam ? 'on' : ''}" title="${t.name}"><i style="background:${t.c1}"></i><i style="background:${t.c2}"></i><span>${t.short}</span></button>`).join('')}</div>
        <p class="hint">${curMode === 'mgr' ? 'Llevas a los dos pilotos desde el muro: ritmo, paradas, neumáticos y alerón.' : 'La retransmisión se realiza sola; puedes elegir piloto y plano cuando quieras.'}</p>
        <h3>Tiempo</h3>${seg('iWx', O.iWx, wx)}
        <h3>Vueltas de carrera</h3>${seg('iLaps', O.iLaps, laps)}
        <h3>Calidad gráfica</h3>${seg('iQ', O.iQ, quality)}
        <button class="btn go" id="iGo">Empezar el fin de semana</button>
        <p class="keys"><b>A</b> auto · <b>1–8</b> planos · <b>Espacio</b> pausa · <b>+/−</b> velocidad · <b>R</b> repetición · <b>L</b> aprendizaje · <b>Esc</b> menú</p>
      </div>
      ${hidden('iTrack', Object.values(CIRCUITS).map((c) => [c.id, c.name]), trackId)}${hidden('iLaps', O.iLaps, laps)}${hidden('iWx', O.iWx, wx)}${hidden('iMode', O.iMode, curMode)}${hidden('iQ', O.iQ, quality)}${hidden('iTeam', TEAMS.map((t) => [t.id, t.name]), curTeam)}
    </div></div>`;
  intro.querySelector('.sheet').classList.add('startSheet');
  // los controles visibles mueven los <select> ocultos (que son los que se leen al empezar)
  intro.querySelectorAll('.seg').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const s = intro.querySelector('#' + g.dataset.for); s.value = b.dataset.v; s.dispatchEvent(new Event('change'));
    if (g.dataset.for === 'iLaps') intro.querySelector('#schedLaps').textContent = `${b.dataset.v} vueltas · paradas y peleas`;
  }));
  intro.querySelectorAll('[data-team]').forEach((b) => (b.onclick = () => { intro.querySelectorAll('[data-team]').forEach((x) => x.classList.toggle('on', x === b)); intro.querySelector('#iTeam').value = b.dataset.team; }));
  // elegir circuito no carga nada: se carga al empezar
  const pickTrack = (id) => { intro.querySelectorAll('[data-track]').forEach((x) => x.classList.toggle('on', x.dataset.track === id)); intro.querySelector('#iTrack').value = id; };
  intro.querySelectorAll('[data-track]').forEach((b) => (b.onclick = () => pickTrack(b.dataset.track)));
  intro.querySelector('#iTrack').onchange = (e) => pickTrack(e.target.value);
  intro.querySelector('#iMode').onchange = (e) => {
    const m = e.target.value === 'mgr';
    intro.querySelector('.teams').classList.toggle('off', !m);
    intro.querySelector('.hint').textContent = m ? 'Llevas a los dos pilotos desde el muro: ritmo, paradas, neumáticos y alerón.' : 'La retransmisión se realiza sola; puedes elegir piloto y plano cuando quieras.';
  };
  return new Promise((resolve) => {
    const go = () => {
      const v = (id) => intro.querySelector('#' + id).value;
      const choice = { quality: v('iQ'), track: v('iTrack'), raceLaps: +v('iLaps'), weather: v('iWx'), mode: v('iMode'), team: v('iTeam') };
      writeJSON(SETTINGS, { ...settings, ...choice });
      // el sonido se arranca aquí, con el clic (el navegador no deja hacerlo después de la carga)
      choice.audio = new EngineAudio(); choice.audio.start();
      intro.remove(); loading.style.display = ''; document.body.classList.remove('menu');
      resolve(choice);
    };
    intro.querySelector('#iGo').onclick = go;
    if (params.get('autostart')) go();
  });
}

startScreen().then(main).catch((e) => { console.error(e); const el = document.getElementById('loadMsg'); if (el) el.textContent = 'Error: ' + e.message; });
