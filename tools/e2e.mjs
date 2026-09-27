// Prueba de extremo a extremo en el navegador: recorre el juego entero pulsando lo que pulsaría una persona y
// comprueba que cada cosa hace lo que debe. Necesita playwright y un servidor del proyecto en PORT (por defecto 8799):
//   python3 -m http.server 8799 &   node tools/e2e.mjs [chrome=/ruta/a/chrome] [track=gp] [mode=watch|mgr]
import { chromium } from 'playwright';
const a = Object.fromEntries(process.argv.slice(2).map((x) => x.split('=')));
const PORT = process.env.PORT || 8799, URL0 = `http://localhost:${PORT}/`;
const b = await chromium.launch({ executablePath: a.chrome || undefined, headless: false, args: ['--use-gl=angle', '--use-angle=gl-egl', '--force-device-scale-factor=1'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [], ok = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
const check = (name, cond, extra = '') => { (cond ? ok : bad).push(name + (extra ? ` (${extra})` : '')); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const setSel = (id, v) => ev(([i, x]) => { const s = document.getElementById(i); s.value = x; s.dispatchEvent(new Event('change')); }, [id, v]);
const click = async (sel) => { await p.click(sel); await p.waitForTimeout(250); };

// --- portada
await p.goto(URL0); await p.waitForSelector('#iGo', { timeout: 150000 });
if (a.track && (await ev(() => document.getElementById('iTrack').value)) !== a.track) {
  await setSel('iTrack', a.track); await p.waitForTimeout(1500); await p.waitForSelector('#iGo', { timeout: 150000 });
}
check('portada: 4 tarjetas de circuito', (await p.$$('.tcard')).length === 4);
check('portada sin cargar el circuito', !(await ev(() => !!window.__sim)));
await click('.seg[data-for="iMode"] button[data-v="mgr"]');
check('portada: mánager muestra equipos', await ev(() => !document.querySelector('.teams').classList.contains('off')));
if (a.mode !== 'mgr') await click('.seg[data-for="iMode"] button[data-v="watch"]');
await click('.seg[data-for="iLaps"] button[data-v="10"]');
check('portada: vueltas → programa', await ev(() => document.getElementById('schedLaps').textContent.startsWith('10')));
await click('.seg[data-for="iWx"] button[data-v="mixed"]');
await click('#iGo'); await p.waitForFunction(() => window.__sim?.session, null, { timeout: 150000 }); await p.waitForTimeout(1500);
check('empieza en libres', await ev(() => window.__sim.session?.id === 'FP'));
check('10 vueltas de carrera', await ev(() => window.__sim.raceLaps === 10));
check('tiempo variable', await ev(() => window.__sim.weatherMode === 'mixed'));
if (a.mode === 'mgr') check('panel mánager', !!(await p.$('#mgr')));

// --- cámaras y controles
for (const t of ['chase', 'cockpit', 'tcam', 'nose', 'rear', 'heli', 'track', 'free']) {
  await click(`[data-cam="${t}"]`); await p.waitForTimeout(400);
  check(`cámara ${t}`, await ev((x) => window.__dir.type === x, t));
}
await click('#bAuto'); check('AUTO', await ev(() => window.__dir.auto));
await click('#bNext'); const f1 = await ev(() => window.__dir.focus.code); await click('#bNext');
check('piloto siguiente', f1 !== (await ev(() => window.__dir.focus.code)));
for (const s of [2, 4, 1]) { await click(`[data-speed="${s}"]`); check(`velocidad ${s}×`, await ev((x) => window.__app.speed === x, s)); }
const t0 = await ev(() => window.__sim.t); await p.keyboard.press(' '); await p.waitForTimeout(600);
check('espacio pausa', Math.abs((await ev(() => window.__sim.t)) - t0) < 0.2 || (await ev(() => window.__app.speed === 0)));
await p.keyboard.press(' ');
for (const k of ['1', '5', '7']) { await p.keyboard.press(k); await p.waitForTimeout(200); }
check('tecla 7 = pista', await ev(() => window.__dir.type === 'track'));
await p.keyboard.press('a'); await p.keyboard.press('+'); check('tecla + dobla', await ev(() => window.__app.speed === 2)); await p.keyboard.press('-');
await p.keyboard.press('h'); check('H oculta HUD', await ev(() => document.getElementById('hud').classList.contains('hidden'))); await p.keyboard.press('h');
await p.keyboard.press('m'); const snd = await ev(() => window.__app.audio.on); await p.keyboard.press('m');
check('M alterna sonido', snd !== (await ev(() => window.__app.audio.on)));
await p.click('#rows li:nth-child(5)'); await p.waitForTimeout(300);
check('clic en la torre enfoca', await ev(() => document.querySelector('#rows li:nth-child(5)').dataset.i == window.__dir.focus.i));

// --- pausa
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
check('Esc abre pausa', !!(await p.$('.pauseSheet')));
await click('#pGo'); check('seguir cierra pausa', !(await p.$('.modal')));

// --- aprendizaje
await p.evaluate(() => window.__app.setSpeed(16)); await p.waitForTimeout(12000); await p.evaluate(() => window.__app.setSpeed(1));
await p.keyboard.press('l'); await p.waitForTimeout(500);
check('L abre aprendizaje', !!(await p.$('#lchart')));
await click('#lCond button[data-c="w"]'); check('aprendizaje: mojado', await ev(() => document.querySelector('#lCond .on')?.dataset.c === 'w'));
await click('#lCond button[data-c="d"]');
await p.click('.cls tbody tr:nth-child(3)'); await p.waitForTimeout(300);
check('aprendizaje: clic en piloto enfoca', !!(await p.$('#lcommit')));
await click('#mClose');

// --- repetición
await p.keyboard.press('r'); await p.waitForTimeout(800);
check('R abre repetición', await ev(() => window.__app.replay.active));
const rt = await ev(() => window.__sim.t); await p.waitForTimeout(800);
check('repetición congela la sim', Math.abs((await ev(() => window.__sim.t)) - rt) < 0.05);
await click('#replayBar button[data-a="slow"]'); check('cámara lenta', await ev(() => window.__app.replay.rate < 1));
await click('#replayBar button[data-a="live"]'); await p.waitForTimeout(800); check('volver al directo', await ev(() => !window.__app.replay.active));

// --- fin de semana entero con «Saltar»
for (const want of ['FP', 'Q1', 'Q2', 'Q3', 'RACE']) {
  const cur = await ev(() => window.__sim.session?.id);
  check(`sesión ${want}`, cur === want, cur);
  if (a.mode === 'mgr' && want === 'RACE') {
    await p.waitForTimeout(8000);
    const i = await ev(() => window.__app.manager.cars[0].i);
    await p.click(`#mgr button[data-a="tyre"][data-v="H"][data-i="${i}"]`); await p.click(`#mgr button[data-a="box"][data-i="${i}"]`);
    check('mánager: BOX marcado', await ev((k) => window.__sim.cars[k].mgr.box, i));
  }
  await click('#bSkip');
  await p.waitForSelector('.modal #mNext', { timeout: 400000 });
  check(`resultados ${want}`, true);
  await click('#mLearn'); check(`aprendizaje desde resultados ${want}`, !!(await p.$('#mBack'))); await click('#mBack');
  if (want === 'RACE') break;
  await click('#mNext'); await p.waitForTimeout(1500);
}
check('carrera terminada', await ev(() => window.__sim.session?.done));
const winner = await ev(() => window.__sim.raceOrder?.[0]?.code);
check('hay ganador', !!winner, winner);
// nuevo fin de semana
await click('#mNext'); await p.waitForTimeout(4000);
check('nuevo fin de semana vuelve a la portada', !!(await p.$('#iGo')));

console.log(`\nOK ${ok.length}   FALLOS ${bad.length}   ERRORES DE CONSOLA ${errs.length}`);
if (bad.length) console.log('FALLOS:\n  ' + bad.join('\n  '));
if (errs.length) console.log('ERRORES:\n  ' + [...new Set(errs)].slice(0, 10).join('\n  '));
await b.close();
process.exit(bad.length || errs.length ? 1 : 0);
