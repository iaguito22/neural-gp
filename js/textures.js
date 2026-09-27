// Texturas procedurales (canvas): asfalto, pianos, hierba, grava, publicidad, gradas, libreas, neumáticos.
import * as THREE from 'three';

const cache = new Map();
let anisotropy = 4;
export function setAnisotropy(a) { anisotropy = a; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }
function rnd(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

function noise(ctx, w, h, n, colFn, r) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = colFn(r()); ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
}

export const SPONSORS = [
  ['NEURAL', '#0B1B3A', '#5CE1E6'], ['APEX OIL', '#D40000', '#FFFFFF'], ['GRIDLINE', '#111111', '#FFD400'],
  ['VOLTA', '#1B5E20', '#FFFFFF'], ['KAIROS', '#FFFFFF', '#1C3F94'], ['TORQUE', '#FF6A00', '#111111'],
  ['SYNAPSE', '#6A1B9A', '#FFFFFF'], ['HELIX', '#00897B', '#FFFFFF'], ['ORBITAL', '#0D47A1', '#FFFFFF'],
  ['TENSOR', '#212121', '#FF3D00'], ['GRADIENT', '#F5F5F5', '#D81B60'], ['BACKPROP', '#263238', '#76FF03'],
];

export function asphalt() {
  return once('asphalt', () => {
    const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(7);
    // Base gris asfalto circuito uniforme y neutro
    g.fillStyle = '#37393d';
    g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      // Grano fino de árido y bitumen apenas visible (+/- 6 a 10)
      const n = (r() - 0.5) * 14 + (r() < 0.01 ? 16 : (r() > 0.99 ? -14 : 0));
      d[i] = Math.min(255, Math.max(0, d[i] + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    }
    g.putImageData(img, 0, 0);
    const t = tex(c); t.repeat.set(1, 1); return t;
  });
}

export function asphaltNormal() {
  return once('asphaltN', () => {
    const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(15);
    const height = new Float32Array(W * H);
    
    // 1. Árido fino granular uniforme
    for (let i = 0; i < height.length; i++) {
      height[i] = (r() - 0.5) * 0.28;
    }
    
    // 2. Gravilla compactada (micro-gránulos)
    for (let k = 0; k < 6000; k++) {
      const cx = Math.floor(r() * W), cy = Math.floor(r() * H), rad = 1 + Math.floor(r() * 2);
      const hVal = (r() - 0.5) * 0.35;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy <= rad * rad) {
            const px = (cx + dx + W) % W, py = (cy + dy + H) % H;
            height[py * W + px] += hVal * (1 - Math.hypot(dx, dy) / (rad + 0.5));
          }
        }
      }
    }
    
    // 3. Micro-estrías longitudinales a lo largo de Y (dirección de marcha / s)
    // Esto crea reflejos alargados y rotos (anisotropía física del asfalto rodado)
    for (let k = 0; k < 1200; k++) {
      const cx = Math.floor(r() * W), y0 = Math.floor(r() * H), len = 14 + Math.floor(r() * 34);
      const strVal = (r() - 0.5) * 0.22;
      for (let dy = 0; dy < len; dy++) {
        const py = (y0 + dy) % H;
        height[py * W + cx] += strVal;
        if (cx > 0) height[py * W + (cx - 1)] += strVal * 0.5;
        if (cx < W - 1) height[py * W + (cx + 1)] += strVal * 0.5;
      }
    }

    const img = g.createImageData(W, H), d = img.data;
    const scale = 1.1;
    for (let y = 0; y < H; y++) {
      const ym = (y - 1 + H) % H, yp = (y + 1) % H;
      for (let x = 0; x < W; x++) {
        const xm = (x - 1 + W) % W, xp = (x + 1) % W;
        // Diferencias centrales con escala mayor en X para acentuar reflejos alargados en Y
        const dx = (height[y * W + xp] - height[y * W + xm]) * scale * 1.35;
        const dy = (height[yp * W + x] - height[ym * W + x]) * scale * 0.85;
        const dz = 1.0;
        const len = Math.hypot(dx, dy, dz);
        const idx = (y * W + x) * 4;
        d[idx] = Math.floor((-dx / len * 0.5 + 0.5) * 255);
        d[idx + 1] = Math.floor((dy / len * 0.5 + 0.5) * 255);
        d[idx + 2] = Math.floor((dz / len * 0.5 + 0.5) * 255);
        d[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, true, false);
  });
}

export function asphaltRough() {
  return once('asphaltR', () => {
    const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(9);
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Micro-variación de rugosidad de alta frecuencia de áridos (sin manchas ni charcos estáticos)
        const microNoise = (r() - 0.5) * 0.08;
        const val = Math.min(255, Math.max(220, Math.floor((0.96 + microNoise) * 255)));
        const idx = (y * W + x) * 4;
        d[idx] = val;
        d[idx + 1] = val;
        d[idx + 2] = val;
        d[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, true, false);
  });
}

export function carContactShadow() {
  return once('carContactShadow', () => {
    const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    
    const drawPatch = (cx, cy, rx, ry, alpha) => {
      g.save();
      g.translate(cx, cy);
      g.scale(rx, ry);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grd.addColorStop(0.5, `rgba(0,0,0,${alpha * 0.7})`);
      grd.addColorStop(0.85, `rgba(0,0,0,${alpha * 0.25})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
    };

    // 1. Sombra amplia y difusa bajo todo el coche (Ambient Occlusion global)
    drawPatch(128, 256, 110, 240, 0.45);

    // 2. Suelo / pontones / difusor del monoplaza
    drawPatch(128, 256, 75, 180, 0.75);
    drawPatch(128, 280, 65, 140, 0.85);
    drawPatch(128, 410, 60, 50, 0.80);
    drawPatch(128, 90, 65, 45, 0.60);

    // 3. Huella de contacto oscura e intensa bajo cada neumático (4 ruedas)
    const fwX = 85, rwX = 83;
    const fwY = 115, rwY = 410;
    drawPatch(128 - fwX, fwY, 24, 38, 0.95);
    drawPatch(128 + fwX, fwY, 24, 38, 0.95);
    drawPatch(128 - rwX, rwY, 30, 44, 0.98);
    drawPatch(128 + rwX, rwY, 30, 44, 0.98);

    const t = tex(c, false, true);
    return t;
  });
}

// goma: franja oscura con bordes difuminados (u de 0 a 1 a lo ancho)
export function rubber() {
  return once('rubber', () => {
    const c = canvas(64, 256), g = c.getContext('2d'), r = rnd(3);
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(10,10,12,0)'); gr.addColorStop(0.3, 'rgba(10,10,12,0.55)'); gr.addColorStop(0.5, 'rgba(8,8,10,0.7)');
    gr.addColorStop(0.7, 'rgba(10,10,12,0.55)'); gr.addColorStop(1, 'rgba(10,10,12,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.2})`; g.fillRect(8 + r() * 48, r() * 256, 1, 6 + r() * 30); }
    return tex(c);
  });
}

export function kerb(colA = '#D7191C', colB = '#F4F4F4') {
  return once('kerb' + colA + colB, () => {
    const c = canvas(64, 128), g = c.getContext('2d');
    g.fillStyle = colA; g.fillRect(0, 0, 64, 64); g.fillStyle = colB; g.fillRect(0, 64, 64, 64);
    // borde de goma y suciedad
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 300; i++) g.fillRect(Math.random() * 64, Math.random() * 128, 2, 2);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 4, 128);
    return tex(c);
  });
}

export function grass() {
  return once('grass', () => {
    const c = canvas(512, 512), g = c.getContext('2d'), r = rnd(11);
    g.fillStyle = '#4c7a2f'; g.fillRect(0, 0, 512, 512);
    // franjas de cortacésped
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,220,0.05)' : 'rgba(0,30,0,0.06)'; g.fillRect(0, i * 64, 512, 64); }
    noise(g, 512, 512, 50000, (v) => (v < 0.5 ? `rgba(40,70,20,${0.3 + v * 0.3})` : `rgba(120,160,70,${v * 0.25})`), r);
    return tex(c);
  });
}

export function terrainGrass() {
  return once('tgrass', () => {
    // detalle neutro: el color lo ponen los vértices (césped, campos, tierra)
    const c = canvas(512, 512), g = c.getContext('2d'), r = rnd(12);
    g.fillStyle = '#d8d8d0'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,90,80' : '255,255,245'},${0.05 + r() * 0.08})`; g.beginPath(); g.arc(r() * 512, r() * 512, 10 + r() * 50, 0, 7); g.fill(); }
    noise(g, 512, 512, 70000, (v) => (v < 0.5 ? `rgba(70,75,60,${0.18 + v * 0.3})` : `rgba(255,255,240,${v * 0.2})`), r);
    return tex(c);
  });
}

export function gravel() {
  return once('gravel', () => {
    const c = canvas(256, 256), g = c.getContext('2d'), r = rnd(13);
    g.fillStyle = '#b9a47f'; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 30000, (v) => (v < 0.5 ? `rgba(120,100,70,${0.4 + v * 0.4})` : `rgba(235,225,200,${v * 0.5})`), r);
    return tex(c);
  });
}

export function runoffPaint() {
  return once('runoff', () => {
    const c = canvas(256, 256), g = c.getContext('2d'), r = rnd(21);
    g.fillStyle = '#5a6068'; g.fillRect(0, 0, 256, 256);
    // bandas azul/rojo pintadas a lo largo
    g.fillStyle = '#2f5fa8'; g.fillRect(40, 0, 70, 256);
    g.fillStyle = '#b8323a'; g.fillRect(120, 0, 70, 256);
    noise(g, 256, 256, 20000, (v) => `rgba(${v < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + v * 0.08})`, r);
    return tex(c);
  });
}

export function sponsorBoard(seed = 1, h = 64) {
  return once('board' + seed + h, () => {
    const W = 2048, H = h * 2, c = canvas(W, H), g = c.getContext('2d'), r = rnd(seed);
    let x = 0;
    while (x < W) {
      const s = SPONSORS[Math.floor(r() * SPONSORS.length)];
      const w = 260 + Math.floor(r() * 160);
      g.fillStyle = s[1]; g.fillRect(x, 0, w, H);
      g.fillStyle = s[2]; g.font = `900 ${H * 0.55}px "Titillium Web", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s[0], x + w / 2, H * 0.54, w - 20);
      x += w;
    }
    return tex(c);
  });
}

export function concreteWall() {
  return once('wall', () => {
    const c = canvas(256, 64), g = c.getContext('2d'), r = rnd(31);
    g.fillStyle = '#c9c9c4'; g.fillRect(0, 0, 256, 64);
    noise(g, 256, 64, 4000, (v) => `rgba(${v < 0.5 ? '60,60,60' : '255,255,255'},${0.1 + v * 0.1})`, r);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 2, 64);
    return tex(c);
  });
}

export function tecpro() {
  return once('tecpro', () => {
    const c = canvas(256, 64), g = c.getContext('2d');
    const cols = ['#d32f2f', '#f5f5f5', '#1565c0', '#f5f5f5'];
    for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % 4]; g.fillRect(i * 32, 0, 32, 64); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * 32, 0, 2, 64); g.fillRect(i * 32, 30, 32, 3); }
    return tex(c);
  });
}

export function fence() {
  return once('fence', () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(210,215,220,0.9)'; g.lineWidth = 2;
    for (let i = -128; i < 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke(); }
    return tex(c, true);
  });
}

export function crowd(seed = 5) {
  return once('crowd' + seed, () => {
    const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), r = rnd(seed);
    g.fillStyle = '#6d6f73'; g.fillRect(0, 0, W, H);
    const rows = 16, rh = H / rows;
    const shirt = ['#e53935', '#fdd835', '#1e88e5', '#ffffff', '#43a047', '#fb8c00', '#212121', '#8e24aa', '#ff7043', '#90caf9', '#d81b60'];
    for (let row = 0; row < rows; row++) {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, row * rh + rh - 3, W, 3);
      for (let x = 2; x < W; x += 6 + r() * 2) {
        if (r() < 0.12) continue;
        g.fillStyle = shirt[Math.floor(r() * shirt.length)]; g.fillRect(x, row * rh + rh * 0.35, 5, rh * 0.55);
        g.fillStyle = ['#f1c27d', '#e0ac69', '#8d5524', '#c68642', '#ffdbac'][Math.floor(r() * 5)];
        g.fillRect(x + 1, row * rh + rh * 0.1, 3, rh * 0.28);
      }
    }
    return tex(c);
  });
}

export function glass() {
  return once('glass', () => {
    const c = canvas(256, 128), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#9fc3d9'); gr.addColorStop(1, '#2a4557');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1b1f24'; for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 3, 128); g.fillRect(0, 62, 256, 4);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(90, 0); g.lineTo(20, 128); g.lineTo(0, 128); g.fill();
    return tex(c);
  });
}

export function numberTex(num, fg = '#ffffff', bg = null) {
  return once('num' + num + fg + bg, () => {
    const c = canvas(256, 256), g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 256, 256); }
    g.fillStyle = fg; g.font = '900 190px "Titillium Web", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), 128, 140);
    const t = tex(c, false); return t;
  });
}

// Librea: u alrededor de la sección (0 = abajo), v a lo largo (0 = morro)
export function livery(team, num) {
  return once('liv' + team.id + num, () => {
    const W = 1024, H = 1024, c = canvas(W, H), g = c.getContext('2d');
    // Base c1
    g.fillStyle = team.c1; g.fillRect(0, 0, W, H);

    // Vientre y bajos en fibra de carbono expuesta
    g.fillStyle = '#101114';
    g.fillRect(0, 0, W * 0.14, H);
    g.fillRect(W * 0.86, 0, W * 0.14, H);

    // Patrón sutil de carbono en los bajos
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < H; y += 8) {
      for (let x = 0; x < W * 0.14; x += 8) { if (((x + y) / 8) % 2 === 0) g.fillRect(x, y, 4, 4); }
      for (let x = W * 0.86; x < W; x += 8) { if (((x + y) / 8) % 2 === 0) g.fillRect(x, y, 4, 4); }
    }

    // Líneas de corte inferior en color terciario c3
    g.fillStyle = team.c3;
    g.fillRect(W * 0.136, 0, W * 0.012, H);
    g.fillRect(W * 0.852, 0, W * 0.012, H);

    // Franja central en el morro y lomo (c2 y c3)
    g.fillStyle = team.c2;
    g.beginPath();
    g.moveTo(W * 0.45, 0); g.lineTo(W * 0.55, 0);
    g.lineTo(W * 0.57, H * 0.35); g.lineTo(W * 0.43, H * 0.35);
    g.closePath(); g.fill();

    // Fileteados c3 a los lados de la franja del morro
    g.fillStyle = team.c3;
    g.fillRect(W * 0.425, 0, W * 0.01, H * 0.35);
    g.fillRect(W * 0.565, 0, W * 0.01, H * 0.35);

    // Espina superior del airbox y capó motor (v: 0.35 a 0.95)
    g.fillStyle = team.c2;
    g.fillRect(W * 0.46, H * 0.35, W * 0.08, H * 0.62);
    g.fillStyle = team.c3;
    g.fillRect(W * 0.445, H * 0.38, W * 0.012, H * 0.58);
    g.fillRect(W * 0.543, H * 0.38, W * 0.012, H * 0.58);

    // Gráficos dinámicos laterales en los pontones (u ≈ 0.26 y 0.74)
    for (const u of [0.26, 0.74]) {
      const sgn = u < 0.5 ? 1 : -1;
      // Cuña c2
      g.fillStyle = team.c2;
      g.beginPath();
      g.moveTo(W * (u - 0.11 * sgn), H * 0.22);
      g.lineTo(W * (u + 0.11 * sgn), H * 0.32);
      g.lineTo(W * (u + 0.10 * sgn), H * 0.72);
      g.lineTo(W * (u - 0.11 * sgn), H * 0.78);
      g.closePath(); g.fill();

      // Franjas de acento c3
      g.fillStyle = team.c3;
      g.beginPath();
      g.moveTo(W * (u - 0.12 * sgn), H * 0.21);
      g.lineTo(W * (u + 0.12 * sgn), H * 0.31);
      g.lineTo(W * (u + 0.12 * sgn), H * 0.33);
      g.lineTo(W * (u - 0.12 * sgn), H * 0.23);
      g.closePath(); g.fill();

      g.beginPath();
      g.moveTo(W * (u + 0.11 * sgn), H * 0.71);
      g.lineTo(W * (u - 0.11 * sgn), H * 0.77);
      g.lineTo(W * (u - 0.11 * sgn), H * 0.79);
      g.lineTo(W * (u + 0.11 * sgn), H * 0.73);
      g.closePath(); g.fill();
    }

    // Nombre del equipo en grande en los pontones
    g.save();
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 6; g.shadowOffsetX = 2; g.shadowOffsetY = 2;
    g.font = `900 ${W * 0.056}px "Titillium Web", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const u of [0.26, 0.74]) {
      g.save();
      g.translate(W * u, H * 0.52);
      g.rotate(u < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      g.scale(-1, 1);
      g.fillText(team.short, 0, 0);
      g.restore();
    }
    g.restore();

    // Patrocinadores técnicos secundarios en los pontones
    const spIdx = Math.abs((team.id.charCodeAt(0) * 7 + (team.id.charCodeAt(1) || 0)) % SPONSORS.length);
    const sp1 = SPONSORS[spIdx], sp2 = SPONSORS[(spIdx + 4) % SPONSORS.length];
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = `800 ${W * 0.024}px "Titillium Web", Arial`;
    g.textAlign = 'center';
    for (const u of [0.26, 0.74]) {
      g.save();
      g.translate(W * u, H * 0.36);
      g.rotate(u < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      g.scale(-1, 1);
      g.fillText(sp1[0], 0, 0);
      g.translate(0, W * 0.28);
      g.fillText(sp2[0], 0, 0);
      g.restore();
    }
    g.restore();

    // Número del piloto en el morro (superior)
    g.save();
    g.translate(W * 0.5, H * 0.15);
    g.rotate(Math.PI / 2);
    // Placa porta-número estilizada
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.roundRect(-W * 0.07, -W * 0.05, W * 0.14, W * 0.10, 8);
    g.fill();
    g.strokeStyle = team.c3; g.lineWidth = 2; g.stroke();
    // Número
    g.fillStyle = '#ffffff';
    g.font = `900 ${W * 0.08}px "Titillium Web", Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), 0, 0);
    g.restore();

    // Número del piloto en los flancos de la aleta trasera
    for (const u of [0.38, 0.62]) {
      g.save();
      g.translate(W * u, H * 0.78);
      g.rotate(u < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      g.scale(-1, 1);
      g.fillStyle = team.c2;
      g.beginPath(); g.roundRect(-W * 0.05, -W * 0.04, W * 0.10, W * 0.08, 6); g.fill();
      g.strokeStyle = team.c3; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#ffffff';
      g.font = `900 ${W * 0.055}px "Titillium Web", Arial`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), 0, 0);
      g.restore();
    }

    const t = tex(c, false); return t;
  });
}

export function tyreSide(color, blur = false) {
  return once('tyre' + color + blur, () => {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#141518'; g.fillRect(0, 0, 512, 512);

    // Anillo exterior de caucho
    g.strokeStyle = '#1d1f24'; g.lineWidth = 8;
    g.beginPath(); g.arc(256, 256, 245, 0, Math.PI * 2); g.stroke();

    // Banda de compuesto principal (vibrante)
    g.strokeStyle = color; g.lineWidth = 14;
    g.beginPath(); g.arc(256, 256, 222, 0, Math.PI * 2); g.stroke();

    // Filetes de acento interior y exterior de la banda
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.arc(256, 256, 229, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(256, 256, 215, 0, Math.PI * 2); g.stroke();

    // Anillo interior de unión con la llanta
    g.strokeStyle = '#22252b'; g.lineWidth = 6;
    g.beginPath(); g.arc(256, 256, 175, 0, Math.PI * 2); g.stroke();

    if (blur) {
      g.strokeStyle = 'rgba(240,240,240,0.35)'; g.lineWidth = 20;
      g.beginPath(); g.arc(256, 256, 222, 0, Math.PI * 2); g.stroke();
    } else {
      g.fillStyle = '#f5f5f7'; g.font = '900 24px "Titillium Web", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const a0 of [0, Math.PI]) {
        const txt = 'GRIPTEC';
        for (let k = 0; k < txt.length; k++) {
          g.save(); g.translate(256, 256);
          g.rotate(a0 + (k - 3) * 0.09);
          g.fillText(txt[k], 0, -222);
          g.restore();
        }
      }
      // Marcas de código de barras / RFID en el flanco
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 6; i++) {
        g.fillRect(250 + (i % 2 ? 3 : 0), 65 + i * 4, 12, 2);
        g.fillRect(250 + (i % 2 ? 3 : 0), 435 + i * 4, 12, 2);
      }
    }
    return tex(c, false);
  });
}

export function wheelCover(teamColor) {
  return once('cover' + teamColor, () => {
    const c = canvas(512, 512), g = c.getContext('2d');
    // Fondo de carbono mate
    g.fillStyle = '#16171a'; g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#222429'; g.beginPath(); g.arc(256, 256, 230, 0, Math.PI * 2); g.fill();

    // Aletas / radios aerodinámicos de la llanta (10 álabes de flujo)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.save();
      g.translate(256, 256);
      g.rotate(a);
      g.fillStyle = i % 2 === 0 ? '#2d3038' : '#1b1c20';
      g.beginPath();
      g.moveTo(60, -10); g.lineTo(220, -22); g.lineTo(218, 12); g.lineTo(60, 6);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5; g.stroke();
      g.restore();
    }

    // Anillo aerodinámico con color de equipo
    g.strokeStyle = teamColor; g.lineWidth = 14;
    g.beginPath(); g.arc(256, 256, 185, 0.2, 2.3); g.stroke();
    g.beginPath(); g.arc(256, 256, 185, 3.3, 5.4); g.stroke();

    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.arc(256, 256, 194, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(256, 256, 176, 0, Math.PI * 2); g.stroke();

    // Centro / tuerca de bloqueo central de titanio anodizado
    g.fillStyle = '#0f1012'; g.beginPath(); g.arc(256, 256, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8e96a0'; g.beginPath(); g.arc(256, 256, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b0b8c2'; g.beginPath(); g.arc(256, 256, 32, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c1e22'; g.beginPath(); g.arc(256, 256, 18, 0, Math.PI * 2); g.fill();

    // 5 pines de bloqueo de rueda
    g.fillStyle = '#111316';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath(); g.arc(256 + Math.cos(a) * 110, 256 + Math.sin(a) * 110, 12, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 2; g.stroke();
    }
    return tex(c, false);
  });
}

export function carbon() {
  return once('carbon', () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#141518'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 128; x += 8) {
        const alt = ((x + y) / 8) % 2;
        g.fillStyle = alt ? '#22252a' : '#101113';
        g.fillRect(x, y, 8, 4);
        g.fillStyle = alt ? '#181a1e' : '#282b32';
        g.fillRect(x + (alt ? 0 : 4), y + 4, 4, 4);
      }
    }
    const t = tex(c); t.repeat.set(8, 8); return t;
  });
}

export function helmet(color, accent) {
  return once('helm' + color + accent, () => {
    const c = canvas(256, 128), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 256, 128);
    // Franjas de diseño de casco moderno
    g.fillStyle = accent;
    g.fillRect(0, 48, 256, 16);
    g.beginPath();
    g.moveTo(0, 80); g.lineTo(256, 110); g.lineTo(256, 128); g.lineTo(0, 98);
    g.closePath(); g.fill();
    // Banda superior y franja dorsal
    g.fillStyle = '#111215';
    g.fillRect(116, 0, 24, 128);
    g.fillStyle = '#ffffff';
    g.fillRect(124, 0, 8, 128);
    // Tira de patrocinador en la visera
    g.fillStyle = '#0a0a0c';
    g.fillRect(0, 36, 256, 12);
    g.fillStyle = '#ffffff';
    g.font = '900 10px "Titillium Web", Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('APEX RACING', 128, 42);
    return tex(c, false);
  });
}

export function screenTex(text, bg = '#0b0b0f', fg = '#ffffff') {
  const c = canvas(1024, 512), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = fg; g.font = '900 120px "Titillium Web", Arial'; g.textAlign = 'center'; g.fillText(text, 512, 290);
  const t = tex(c, false); return { tex: t, canvas: c, ctx: g };
}

export function roofTex() {
  return once('roof', () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#d7dadd'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < 128; x += 8) g.fillRect(x, 0, 2, 128);
    return tex(c);
  });
}

export function buildingTex(seed = 1, lit = false) {
  return once('bld' + seed + lit, () => {
    const c = canvas(256, 256), g = c.getContext('2d'), r = rnd(seed);
    g.fillStyle = ['#d9d4c9', '#b8bec6', '#e6e2da', '#9ea5ad'][seed % 4]; g.fillRect(0, 0, 256, 256);
    for (let y = 8; y < 256; y += 24) for (let x = 6; x < 256; x += 18) {
      g.fillStyle = r() < 0.2 ? '#44566a' : '#2e3b4a'; g.fillRect(x, y, 12, 14);
    }
    return tex(c);
  });
}

// ---------------------------------------------------------------- circuitos urbano y nocturno
export function sand() {
  return once('sand', () => {
    const c = canvas(512, 512), g = c.getContext('2d'), r = rnd(21);
    g.fillStyle = '#c9a36b'; g.fillRect(0, 0, 512, 512);
    // ondas de viento
    for (let y = 0; y < 512; y += 9) { g.strokeStyle = `rgba(${r() < 0.5 ? '120,85,45' : '255,235,190'},0.12)`; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3); g.stroke(); }
    noise(g, 512, 512, 60000, (v) => (v < 0.5 ? `rgba(110,80,40,${0.15 + v * 0.3})` : `rgba(255,240,200,${v * 0.25})`), r);
    return tex(c);
  });
}

// fachada de ciudad: blanca para teñir por instancia (color del edificio), con ventanas, balcones y persianas
export function facade(seed = 1) {
  return once('fac' + seed, () => {
    const c = canvas(256, 512), g = c.getContext('2d'), r = rnd(seed * 7 + 3);
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, 256, 512);
    noise(g, 256, 512, 8000, (v) => `rgba(0,0,0,${v * 0.06})`, r);
    const cols = seed % 3 === 0 ? 5 : 4, rows = 16, cw = 256 / cols, rh = 512 / rows;
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 512 - rh * 1.4, 256, rh * 1.4);                 // bajos
    for (let y = 0; y < rows - 1; y++) {
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, y * rh, 256, 3);                                // cornisa de cada planta
      for (let x = 0; x < cols; x++) {
        const wx = x * cw + cw * 0.25, wy = y * rh + rh * 0.22, ww = cw * 0.5, wh = rh * 0.62;
        g.fillStyle = r() < 0.25 ? '#6f8193' : '#34424f'; g.fillRect(wx, wy, ww, wh);
        if (r() < 0.45) { g.fillStyle = ['#2e7d4f', '#8a5a2b', '#3b5f8a', '#7a2d2d'][seed % 4]; g.fillRect(wx, wy, ww, wh * (0.3 + r() * 0.6)); } // persiana
        if (seed % 2 && r() < 0.5) { g.fillStyle = 'rgba(40,40,40,0.55)'; g.fillRect(wx - 3, wy + wh, ww + 6, 4); }            // balcón
      }
    }
    return tex(c);
  });
}

// fachada de noche: oscura con ventanas encendidas (para emissiveMap)
export function litFacade(seed = 1) {
  return once('lit' + seed, () => {
    const c = canvas(256, 512), g = c.getContext('2d'), r = rnd(seed * 13 + 5);
    g.fillStyle = '#000000'; g.fillRect(0, 0, 256, 512);
    for (let y = 6; y < 512; y += 22) for (let x = 5; x < 256; x += 16) {
      if (r() < 0.42) continue;
      const w = r(); g.fillStyle = w < 0.6 ? '#ffd9a0' : w < 0.85 ? '#fff4dd' : '#9fd0ff'; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x, y, 10, 13);
    }
    g.globalAlpha = 1;
    return tex(c);
  });
}

// destello redondo para los focos (sprites aditivos)
export function glow() {
  return once('glow', () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,250,235,0.85)'); gr.addColorStop(0.4, 'rgba(255,235,200,0.18)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c, false);
  });
}

// rayado diagonal blanco (zona cebreada entre la pista y el carril de boxes)
export function hatch() {
  return once('hatch', () => {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(245,245,245,0.95)'; g.lineWidth = 26;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 128 - 10, -10); g.lineTo(k * 128 + 138, 138); g.stroke(); }
    return tex(c);
  });
}
// texto pintado en el suelo, estirado a lo largo como las marcas viales
export function roadText(text) {
  return once('rt' + text, () => {
    const c = canvas(256, 1024), g = c.getContext('2d');
    g.clearRect(0, 0, 256, 1024); g.fillStyle = 'rgba(245,245,245,0.95)';
    g.save(); g.scale(1, 3.2); g.font = '900 150px "Titillium Web", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((l, i) => g.fillText(l, 128, 160 + (i - (lines.length - 1) / 2) * 150, 240));
    g.restore();
    return tex(c, false);
  });
}
// atenuador de impactos amarillo y negro
export function chevrons() {
  return once('chev', () => {
    const c = canvas(256, 64), g = c.getContext('2d');
    g.fillStyle = '#ffd200'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#141414';
    for (let x = -64; x < 256; x += 48) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 56, 0); g.lineTo(x + 32, 0); g.fill(); }
    return tex(c);
  });
}
