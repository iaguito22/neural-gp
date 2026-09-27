// Efectos visuales de la física: humo de bloqueo (delanteras) y derrape/trompo (traseras),
// daños en alerones y suspensión, trozos de fibra de carbono (debris), impacto y desplazamiento
// de barreras TecPro, chispas y manchas de grava en pista.
import * as THREE from 'three';
import { HALF_W } from './track.js';
import * as TX from './textures.js';

export function buildFx(scene, T, sim, visuals, world) {
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const tmpEuler = new THREE.Euler();
  const tmpW = new THREE.Vector3();
  const P = [0, 0, 0], P2 = [0, 0, 0];

  // =========================================================================
  // 1. SISTEMA DE HUMO (Bloqueo delantero + Derrape/Trompo trasero)
  // =========================================================================
  const MAX_SMOKE = 3500;
  const smkPos = new Float32Array(MAX_SMOKE * 3);
  const smkSize = new Float32Array(MAX_SMOKE);
  const smkAlpha = new Float32Array(MAX_SMOKE);
  const smkShade = new Float32Array(MAX_SMOKE);

  const smkVel = new Float32Array(MAX_SMOKE * 3);
  const smkLife = new Float32Array(MAX_SMOKE);
  const smkMaxLife = new Float32Array(MAX_SMOKE);
  const smkS0 = new Float32Array(MAX_SMOKE);
  const smkSMax = new Float32Array(MAX_SMOKE);
  const smkA0 = new Float32Array(MAX_SMOKE);
  let smkLive = 0;

  const smkGeo = new THREE.BufferGeometry();
  smkGeo.setAttribute('position', new THREE.BufferAttribute(smkPos, 3).setUsage(THREE.DynamicDrawUsage));
  smkGeo.setAttribute('aSize', new THREE.BufferAttribute(smkSize, 1).setUsage(THREE.DynamicDrawUsage));
  smkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smkAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  smkGeo.setAttribute('aShade', new THREE.BufferAttribute(smkShade, 1).setUsage(THREE.DynamicDrawUsage));
  smkGeo.setDrawRange(0, 0);

  const smkUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uScale: { value: 450.0 },
  };

  const smkMat = new THREE.ShaderMaterial({
    uniforms: smkUniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: `
      uniform float uScale;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aShade;
      varying float vAlpha;
      varying float vShade;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vAlpha = aAlpha;
        vShade = aShade;
        gl_PointSize = clamp(aSize * uScale / max(0.4, -mvPosition.z), 1.0, 380.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vShade;
      #include <fog_pars_fragment>
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float d = dot(coord, coord) * 4.0;
        if (d > 1.0) discard;
        float falloff = (1.0 - d) * (1.0 - d);
        gl_FragColor = vec4(vec3(vShade), vAlpha * falloff);
        #include <fog_fragment>
      }
    `,
  });

  const smokeMesh = new THREE.Points(smkGeo, smkMat);
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 3;
  scene.add(smokeMesh);

  function emitSmoke(x, y, z, vx, vy, vz, life, s0, sMax, a0, shade) {
    if (smkLive >= MAX_SMOKE) return;
    const k = smkLive++;
    smkPos[k * 3] = x; smkPos[k * 3 + 1] = y; smkPos[k * 3 + 2] = z;
    smkVel[k * 3] = vx; smkVel[k * 3 + 1] = vy; smkVel[k * 3 + 2] = vz;
    smkLife[k] = 0; smkMaxLife[k] = life;
    smkS0[k] = s0; smkSMax[k] = sMax;
    smkA0[k] = a0; smkShade[k] = shade;
    smkSize[k] = s0; smkAlpha[k] = a0;
  }

  // =========================================================================
  // 2. SISTEMA DE CHISPAS (Impactos y Patines de titanio / Skid blocks)
  // =========================================================================
  const MAX_SPARKS = 4500;
  const spkPos = new Float32Array(MAX_SPARKS * 3);
  const spkCol = new Float32Array(MAX_SPARKS * 3);
  const spkSize = new Float32Array(MAX_SPARKS);
  const spkAlpha = new Float32Array(MAX_SPARKS);

  const spkVel = new Float32Array(MAX_SPARKS * 3);
  const spkLife = new Float32Array(MAX_SPARKS);
  const spkMaxLife = new Float32Array(MAX_SPARKS);
  const spkGroundY = new Float32Array(MAX_SPARKS);
  let spkLive = 0;

  const isNight = !!(T?.meta?.night || world?.night);
  const trackN = T.N || 1000;
  const trackDs = T.ds || 1.0;

  // Curvatura vertical (compresiones / valles y crestas / cambios de rasante)
  const trackD2y = new Float32Array(trackN);
  const span = Math.max(2, Math.round(3.5 / trackDs));
  const spanDistSq = (span * trackDs) ** 2;
  if (T.y && T.y.length >= trackN) {
    for (let i = 0; i < trackN; i++) {
      const iPrev = (i - span + trackN) % trackN;
      const iNext = (i + span) % trackN;
      trackD2y[i] = (T.y[iNext] - 2 * T.y[i] + T.y[iPrev]) / spanDistSq;
    }
  }

  // Estado de ráfagas intermitentes por coche (hasta 24 coches)
  const carSpk = Array.from({ length: 24 }, () => ({
    burstTimer: 0,
    cooldown: 0,
    burstDuration: 0,
    intensity: 0,
  }));

  const spkGeo = new THREE.BufferGeometry();
  spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3).setUsage(THREE.DynamicDrawUsage));
  spkGeo.setAttribute('aColor', new THREE.BufferAttribute(spkCol, 3).setUsage(THREE.DynamicDrawUsage));
  spkGeo.setAttribute('aSize', new THREE.BufferAttribute(spkSize, 1).setUsage(THREE.DynamicDrawUsage));
  spkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(spkAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  spkGeo.setDrawRange(0, 0);

  const spkUniforms = { uScale: { value: 450.0 } };
  const spkMat = new THREE.ShaderMaterial({
    uniforms: spkUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uScale;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uScale / max(0.3, -mvPosition.z), 1.0, 140.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float d = dot(coord, coord) * 4.0;
        if (d > 1.0) discard;
        float falloff = (1.0 - d);
        gl_FragColor = vec4(vColor, vAlpha * falloff);
      }
    `,
  });

  const sparksMesh = new THREE.Points(spkGeo, spkMat);
  sparksMesh.frustumCulled = false;
  sparksMesh.renderOrder = 6;
  scene.add(sparksMesh);

  const tmpSpkLocal = new THREE.Vector3();
  const tmpSpkWld = new THREE.Vector3();
  const tmpFwd = new THREE.Vector3();
  const tmpRt = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();

  function emitSparks(x, y, z, baseVx, baseVy, baseVz, count = 25, speed = 14) {
    for (let c = 0; c < count; c++) {
      if (spkLive >= MAX_SPARKS) return;
      const k = spkLive++;
      spkPos[k * 3] = x + (Math.random() - 0.5) * 0.2;
      spkPos[k * 3 + 1] = y + (Math.random() - 0.5) * 0.2;
      spkPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.2;

      const spd = speed * (0.5 + Math.random() * 0.9);
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI * 0.5;
      spkVel[k * 3] = baseVx * 0.3 + Math.cos(theta) * Math.cos(phi) * spd;
      spkVel[k * 3 + 1] = Math.max(1.5, baseVy * 0.3 + Math.sin(phi) * spd + 2.0);
      spkVel[k * 3 + 2] = baseVz * 0.3 + Math.sin(theta) * Math.cos(phi) * spd;

      spkLife[k] = 0;
      spkMaxLife[k] = 0.25 + Math.random() * 0.35;
      spkGroundY[k] = y - 0.3;

      const isWhite = Math.random() < 0.25;
      spkCol[k * 3] = 1.0;
      spkCol[k * 3 + 1] = isWhite ? 0.95 : 0.45 + Math.random() * 0.4;
      spkCol[k * 3 + 2] = isWhite ? 0.8 : 0.05 + Math.random() * 0.15;
      spkSize[k] = 0.08 + Math.random() * 0.08;
      spkAlpha[k] = 1.0;
    }
  }

  function emitSkidSparks(car, rootPos, rootQuat, count, intensity, nightMode) {
    tmpFwd.set(0, 0, 1).applyQuaternion(rootQuat);
    tmpRt.set(1, 0, 0).applyQuaternion(rootQuat);
    tmpUp.set(0, 1, 0).applyQuaternion(rootQuat);

    const carV = car.v || 70;
    const groundY = rootPos.y;

    for (let c = 0; c < count; c++) {
      if (spkLive >= MAX_SPARKS) return;
      const k = spkLive++;

      // Coordenadas locales del coche: centro del suelo (x ≈ 0, z entre +0.8 y -1.2, y ≈ 0.02)
      // Patines delantero (+0.7), central (-0.2) y trasero (-1.0)
      const skidChoice = Math.random();
      const lz = skidChoice < 0.35
        ? 0.45 + Math.random() * 0.35
        : (skidChoice < 0.70
            ? -0.40 + Math.random() * 0.50
            : -1.20 + Math.random() * 0.45);
      const lx = (Math.random() - 0.5) * (skidChoice < 0.35 ? 0.14 : 0.26);
      const ly = 0.015 + Math.random() * 0.015;

      tmpSpkLocal.set(lx, ly, lz);
      tmpSpkWld.copy(tmpSpkLocal).applyQuaternion(rootQuat).add(rootPos);

      spkPos[k * 3] = tmpSpkWld.x;
      spkPos[k * 3 + 1] = tmpSpkWld.y;
      spkPos[k * 3 + 2] = tmpSpkWld.z;

      // Expulsión hacia atrás respecto al coche en coordenadas mundo
      const vFwd = carV * (0.08 + Math.random() * 0.24);
      const vLat = (Math.random() - 0.5) * (2.2 + Math.random() * 3.6);
      const vUp = 0.25 + Math.random() * 1.8;

      spkVel[k * 3] = tmpFwd.x * vFwd + tmpRt.x * vLat + tmpUp.x * vUp;
      spkVel[k * 3 + 1] = tmpFwd.y * vFwd + tmpRt.y * vLat + tmpUp.y * vUp;
      spkVel[k * 3 + 2] = tmpFwd.z * vFwd + tmpRt.z * vLat + tmpUp.z * vUp;

      spkLife[k] = 0;
      spkMaxLife[k] = 0.20 + Math.random() * 0.30; // se apaga en 0.2-0.5 s
      spkGroundY[k] = groundY;

      // Chorro de chispas naranja-blanco
      const rType = Math.random();
      if (nightMode) {
        // De noche brillan más (aditivas)
        if (rType < 0.38) {
          spkCol[k * 3] = 1.95;
          spkCol[k * 3 + 1] = 1.85;
          spkCol[k * 3 + 2] = 1.45;
          spkSize[k] = 0.042 + Math.random() * 0.025;
        } else if (rType < 0.82) {
          spkCol[k * 3] = 1.95;
          spkCol[k * 3 + 1] = 0.85 + Math.random() * 0.35;
          spkCol[k * 3 + 2] = 0.12 + Math.random() * 0.10;
          spkSize[k] = 0.038 + Math.random() * 0.021;
        } else {
          spkCol[k * 3] = 1.65;
          spkCol[k * 3 + 1] = 0.45 + Math.random() * 0.20;
          spkCol[k * 3 + 2] = 0.04 + Math.random() * 0.06;
          spkSize[k] = 0.032 + Math.random() * 0.017;
        }
        spkAlpha[k] = 1.0;
      } else {
        // De día: tonos vivos naranja-blanco
        if (rType < 0.35) {
          spkCol[k * 3] = 1.0;
          spkCol[k * 3 + 1] = 0.98;
          spkCol[k * 3 + 2] = 0.88;
          spkSize[k] = 0.035 + Math.random() * 0.021;
        } else if (rType < 0.80) {
          spkCol[k * 3] = 1.0;
          spkCol[k * 3 + 1] = 0.62 + Math.random() * 0.28;
          spkCol[k * 3 + 2] = 0.08 + Math.random() * 0.10;
          spkSize[k] = 0.032 + Math.random() * 0.017;
        } else {
          spkCol[k * 3] = 1.0;
          spkCol[k * 3 + 1] = 0.38 + Math.random() * 0.18;
          spkCol[k * 3 + 2] = 0.03 + Math.random() * 0.04;
          spkSize[k] = 0.028 + Math.random() * 0.014;
        }
        spkAlpha[k] = 0.95;
      }
    }
  }

  // =========================================================================
  // 3. TROZOS DE FIBRA DE CARBONO (Debris: e.type === 'debris')
  // =========================================================================
  const MAX_DEBRIS = 150;
  const debrisPrismGeo = new THREE.BoxGeometry(0.18, 0.035, 0.28);
  const debrisMat = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.3,
  });

  const debrisMesh = new THREE.InstancedMesh(debrisPrismGeo, debrisMat, MAX_DEBRIS);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.castShadow = true;
  debrisMesh.receiveShadow = false;
  debrisMesh.frustumCulled = false;
  scene.add(debrisMesh);

  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_DEBRIS; i++) {
    debrisMesh.setMatrixAt(i, zeroMatrix);
    debrisMesh.setColorAt(i, new THREE.Color(0x181818));
  }
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;

  const debrisPieces = Array.from({ length: MAX_DEBRIS }, () => ({
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    rx: 0, ry: 0, rz: 0,
    vrx: 0, vry: 0, vrz: 0,
    life: 0,
    groundY: 0,
    onGround: false,
    color: new THREE.Color(0x181818),
  }));
  let debrisNextIdx = 0;

  function spawnDebrisPiece(x, y, z, vx, vy, vz, color, groundY) {
    const idx = debrisNextIdx;
    debrisNextIdx = (debrisNextIdx + 1) % MAX_DEBRIS;

    const p = debrisPieces[idx];
    p.active = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.rx = Math.random() * Math.PI * 2;
    p.ry = Math.random() * Math.PI * 2;
    p.rz = Math.random() * Math.PI * 2;
    p.vrx = (Math.random() - 0.5) * 16;
    p.vry = (Math.random() - 0.5) * 16;
    p.vrz = (Math.random() - 0.5) * 16;
    p.life = 0;
    p.groundY = groundY;
    p.onGround = false;
    p.color.copy(color);

    debrisMesh.setColorAt(idx, p.color);
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

  function spawnDebrisExplosion(car, part, sev, broken, s, d) {
    const V = visuals[car?.i];
    let carX = 0, carY = 0, carZ = 0;
    let fwdX = 0, fwdZ = 1, rightX = 1, rightZ = 0;
    let groundY = 0;

    if (V && V.root) {
      carX = V.root.position.x;
      carY = V.root.position.y;
      carZ = V.root.position.z;
      tmpV.set(0, 0, 1).applyQuaternion(V.root.quaternion);
      fwdX = tmpV.x; fwdZ = tmpV.z;
      tmpV.set(1, 0, 0).applyQuaternion(V.root.quaternion);
      rightX = tmpV.x; rightZ = tmpV.z;
      groundY = carY;
    } else {
      T.pos(s || 0, d || 0, P);
      carX = P[0]; carY = P[1]; carZ = P[2];
      groundY = carY;
    }

    let offFwd = 0, offRight = 0, offUp = 0.25;
    if (part === 'fw') { offFwd = 2.4; offUp = 0.2; }
    else if (part === 'rw') { offFwd = -2.1; offUp = 0.7; }
    else if (part === 'susp') { offFwd = 1.6; offRight = 0.85; offUp = 0.35; }

    const spawnX = carX + fwdX * offFwd + rightX * offRight;
    const spawnY = carY + offUp;
    const spawnZ = carZ + fwdZ * offFwd + rightZ * offRight;

    const count = broken ? 10 + Math.floor(Math.random() * 8) : 4 + Math.floor((sev || 0.2) * 8);
    const carV = car?.v ?? 20;

    const colCarbon = new THREE.Color(0x181818);
    const colTeam = new THREE.Color(car?.team?.c1 ?? 0x282828);

    for (let i = 0; i < count; i++) {
      const isTeamColor = Math.random() < 0.45;
      const pieceCol = isTeamColor ? colTeam : colCarbon;

      const fwdSpeed = carV * (0.2 + Math.random() * 0.3);
      const vx = fwdX * fwdSpeed + (Math.random() - 0.5) * 7.0;
      const vy = 2.5 + Math.random() * 5.5;
      const vz = fwdZ * fwdSpeed + (Math.random() - 0.5) * 7.0;

      spawnDebrisPiece(
        spawnX + (Math.random() - 0.5) * 0.4,
        spawnY + (Math.random() - 0.5) * 0.2,
        spawnZ + (Math.random() - 0.5) * 0.4,
        vx, vy, vz, pieceCol, groundY
      );
    }
  }

  // =========================================================================
  // 4. BARRERAS TECPRO DEFORMADAS / DESPLAZADAS (e.type === 'barrier')
  // =========================================================================
  const MAX_TECPRO_HITS = 80;
  const tecGeo = new THREE.BoxGeometry(1.2, 0.95, 1.4);
  const tecMat = world.mat?.tecpro || new THREE.MeshStandardMaterial({
    map: TX.tecpro(),
    roughness: 0.7,
  });

  const tecInstancedMesh = new THREE.InstancedMesh(tecGeo, tecMat, MAX_TECPRO_HITS);
  tecInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tecInstancedMesh.castShadow = true;
  tecInstancedMesh.receiveShadow = true;
  tecInstancedMesh.frustumCulled = false;
  scene.add(tecInstancedMesh);

  for (let i = 0; i < MAX_TECPRO_HITS; i++) {
    tecInstancedMesh.setMatrixAt(i, zeroMatrix);
  }
  tecInstancedMesh.instanceMatrix.needsUpdate = true;

  let tecHitIdx = 0;

  function handleBarrierHit(s, d, side, sev, car) {
    const wallD = side * T.barrier(s, side);
    T.pos(s, wallD, P);
    T.pos(s + 2, wallD, P2);

    const trackYaw = Math.atan2(P2[0] - P[0], P2[2] - P[2]);
    const normX = -Math.cos(trackYaw) * side;
    const normZ = Math.sin(trackYaw) * side;

    const numBlocks = Math.min(4, 2 + Math.floor((sev || 5) / 6));
    const pushDist = 0.35 + Math.min(1.8, (sev || 5) * 0.08);

    for (let k = 0; k < numBlocks; k++) {
      const idx = tecHitIdx;
      tecHitIdx = (tecHitIdx + 1) % MAX_TECPRO_HITS;

      const ds = (k - (numBlocks - 1) / 2) * 1.35;
      T.pos(s + ds, wallD, P);

      const bx = P[0] + normX * (pushDist * (0.8 + Math.random() * 0.4)) + (Math.random() - 0.5) * 0.3;
      const bz = P[2] + normZ * (pushDist * (0.8 + Math.random() * 0.4)) + (Math.random() - 0.5) * 0.3;
      const by = P[1] + 0.48 + Math.random() * 0.15;

      const euler = new THREE.Euler(
        (Math.random() - 0.5) * 0.35,
        trackYaw + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.35,
        'YXZ'
      );
      tmpQ.setFromEuler(euler);
      tmpV.set(bx, by, bz);
      tmpM.compose(tmpV, tmpQ, new THREE.Vector3(1, 1, 1));
      tecInstancedMesh.setMatrixAt(idx, tmpM);
    }
    tecInstancedMesh.instanceMatrix.needsUpdate = true;

    emitSparks(P[0], P[1] + 0.5, P[2], P2[0] - P[0], 5, P2[2] - P[2], 40, 18);
  }

  // =========================================================================
  // 5. GRAVA EN PISTA (e.type === 'gravel')
  // =========================================================================
  const MAX_GRAVEL_PTS = 2500;
  const grvPos = new Float32Array(MAX_GRAVEL_PTS * 3);
  const grvCol = new Float32Array(MAX_GRAVEL_PTS * 3);
  const grvSize = new Float32Array(MAX_GRAVEL_PTS);
  const grvAlpha = new Float32Array(MAX_GRAVEL_PTS);

  const grvGeo = new THREE.BufferGeometry();
  grvGeo.setAttribute('position', new THREE.BufferAttribute(grvPos, 3).setUsage(THREE.DynamicDrawUsage));
  grvGeo.setAttribute('aColor', new THREE.BufferAttribute(grvCol, 3).setUsage(THREE.DynamicDrawUsage));
  grvGeo.setAttribute('aSize', new THREE.BufferAttribute(grvSize, 1).setUsage(THREE.DynamicDrawUsage));
  grvGeo.setAttribute('aAlpha', new THREE.BufferAttribute(grvAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  grvGeo.setDrawRange(0, 0);

  const grvUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uScale: { value: 450.0 },
  };

  const grvMat = new THREE.ShaderMaterial({
    uniforms: grvUniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: `
      uniform float uScale;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uScale / max(0.4, -mvPosition.z), 1.0, 45.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float d = dot(coord, coord) * 4.0;
        if (d > 1.0) discard;
        float falloff = (1.0 - d * 0.3);
        gl_FragColor = vec4(vColor, vAlpha * falloff);
        #include <fog_fragment>
      }
    `,
  });

  const gravelMesh = new THREE.Points(grvGeo, grvMat);
  gravelMesh.frustumCulled = false;
  gravelMesh.renderOrder = 2;
  scene.add(gravelMesh);

  const GRAVEL_PALETTE = [
    [0.48, 0.44, 0.38],
    [0.34, 0.31, 0.28],
    [0.58, 0.53, 0.46],
    [0.26, 0.24, 0.22],
    [0.65, 0.60, 0.52],
  ];

  function pseudoRnd(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function updateGravel() {
    let ptCount = 0;
    const gravelList = sim.gravel || [];

    for (let gi = 0; gi < gravelList.length; gi++) {
      const g = gravelList[gi];
      const curAmt = g.amt - (sim.t - g.t) / 300;
      if (curAmt <= 0) continue;

      const numPts = Math.min(80, Math.floor(g.len * 2.2));
      const seedBase = Math.floor(g.s * 10) + gi * 1000;
      const baseD = Number.isFinite(g.d) ? g.d : (g.car ? (g.car.d >= 0 ? 1 : -1) * (HALF_W - 2) : 0);
      const patchW = Number.isFinite(g.w) ? g.w : 3.5;

      for (let k = 0; k < numPts; k++) {
        if (ptCount >= MAX_GRAVEL_PTS) break;

        const r1 = pseudoRnd(seedBase + k * 13.7);
        const r2 = pseudoRnd(seedBase + k * 29.3);
        const r3 = pseudoRnd(seedBase + k * 7.1);

        const sPos = g.s + r1 * g.len;
        const dPos = baseD + (r2 - 0.5) * patchW;

        T.pos(sPos, dPos, P);

        const idx = ptCount++;
        grvPos[idx * 3] = P[0];
        grvPos[idx * 3 + 1] = P[1] + 0.022;
        grvPos[idx * 3 + 2] = P[2];

        const pal = GRAVEL_PALETTE[Math.floor(r3 * GRAVEL_PALETTE.length) % GRAVEL_PALETTE.length];
        grvCol[idx * 3] = pal[0];
        grvCol[idx * 3 + 1] = pal[1];
        grvCol[idx * 3 + 2] = pal[2];

        grvSize[idx] = 0.12 + r3 * 0.14;
        grvAlpha[idx] = Math.max(0, Math.min(1, curAmt * (0.65 + r3 * 0.35)));
      }
    }

    grvGeo.setDrawRange(0, ptCount);
    if (ptCount > 0) {
      grvGeo.attributes.position.needsUpdate = true;
      grvGeo.attributes.aColor.needsUpdate = true;
      grvGeo.attributes.aSize.needsUpdate = true;
      grvGeo.attributes.aAlpha.needsUpdate = true;
    }
  }

  // =========================================================================
  // 6. EVENTOS DE LA SIMULACIÓN (sim.on)
  // =========================================================================
  function resetSessionFx() {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      debrisPieces[i].active = false;
      debrisMesh.setMatrixAt(i, zeroMatrix);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    debrisNextIdx = 0;

    for (let i = 0; i < MAX_TECPRO_HITS; i++) {
      tecInstancedMesh.setMatrixAt(i, zeroMatrix);
    }
    tecInstancedMesh.instanceMatrix.needsUpdate = true;
    tecHitIdx = 0;

    smkLive = 0;
    spkLive = 0;
    smkGeo.setDrawRange(0, 0);
    spkGeo.setDrawRange(0, 0);
    grvGeo.setDrawRange(0, 0);

    for (let i = 0; i < carSpk.length; i++) {
      carSpk[i].burstTimer = 0;
      carSpk[i].cooldown = 0;
      carSpk[i].burstDuration = 0;
      carSpk[i].intensity = 0;
    }

    for (const car of sim.cars) {
      const V = visuals[car.i];
      if (!V) continue;
      if (V.fw) { V.fw.rotation.set(0, 0, 0); V.fw.position.set(0, 0, 2.62); }
      if (V.rw) { V.rw.rotation.set(0, 0, 0); V.rw.position.set(0, 0, -2.25); }
      if (V.fwLo) V.fwLo.visible = !V.detailed;
      if (V.rwLo) V.rwLo.visible = !V.detailed;
      if (V.wheels && V.wheels[1] && V.wheels[1].steer) {
        V.wheels[1].steer.rotation.z = 0;
        V.wheels[1].steer.rotation.x = 0;
      }
      if (V.loWheels && V.loWheels[1]) {
        V.loWheels[1].rotation.z = 0;
      }
    }
  }

  sim.on((e) => {
    if (!e) return;
    if (e.type === 'session') {
      resetSessionFx();
    } else if (e.type === 'debris') {
      spawnDebrisExplosion(e.car, e.part, e.sev, e.broken, e.s, e.d);
    } else if (e.type === 'barrier') {
      handleBarrierHit(e.s, e.d, e.side, e.sev, e.car);
    } else if (e.type === 'contact' && e.wall && (e.sev || 0) > 6) {
      const V = visuals[e.car?.i];
      if (V && V.root) {
        emitSparks(V.root.position.x, V.root.position.y + 0.4, V.root.position.z, 0, 4, 0, 30, 16);
      }
    }
  });

  // =========================================================================
  // 7. ACTUALIZACIÓN POR FRAME
  // =========================================================================
  const wheelLocalPos = [
    new THREE.Vector3(0.8, 0.04, 1.8),   // FL
    new THREE.Vector3(-0.8, 0.04, 1.8),  // FR
    new THREE.Vector3(0.78, 0.04, -1.8), // RL
    new THREE.Vector3(-0.78, 0.04, -1.8),// RR
  ];

  function update(dt) {
    if (dt <= 0) return;

    const vH = window.innerHeight || 800;
    const uScaleVal = vH * 0.866;
    smkUniforms.uScale.value = uScaleVal;
    spkUniforms.uScale.value = uScaleVal;
    grvUniforms.uScale.value = uScaleVal;

    const wet = sim.wx?.wet ?? 0;
    const wetFactor = Math.max(0.08, 1.0 - wet * 0.85); // en mojado muchas menos

    // -----------------------------------------------------------------------
    // A. Emisión de humo, chispas de patines y daños en coches
    // -----------------------------------------------------------------------
    for (let ci = 0; ci < sim.cars.length; ci++) {
      const car = sim.cars[ci];
      const V = visuals[car.i];
      if (!V || car.out || car.state === 'garage') continue;

      const root = V.root;
      const rootPos = root.position;
      const rootQuat = root.quaternion;

      // 1. Daños en el modelo 3D (alerones y suspensión)
      const parts = car.parts || { fw: 0, rw: 0, susp: 0 };
      
      // Alerón delantero
      if (V.fw) {
        if (parts.fw >= 0.5) {
          V.fw.rotation.set(0.09, 0.24, -0.19);
          V.fw.position.set(0.08, -0.06, 2.56);
          if (V.fwLo) V.fwLo.visible = false;
        } else {
          V.fw.rotation.set(0, 0, 0);
          V.fw.position.set(0, 0, 2.62);
          if (V.fwLo) V.fwLo.visible = !V.detailed;
        }
      }

      // Alerón trasero
      if (V.rw) {
        if (parts.rw >= 0.5) {
          V.rw.rotation.set(-0.16, 0.19, 0.25);
          V.rw.position.set(0.07, -0.05, -2.21);
          if (V.rwLo) V.rwLo.visible = false;
        } else {
          V.rw.rotation.set(0, 0, 0);
          V.rw.position.set(0, 0, -2.25);
          if (V.rwLo) V.rwLo.visible = !V.detailed;
        }
      }

      // Suspensión (rueda delantera derecha torcida)
      if (V.wheels && V.wheels[1] && V.wheels[1].steer) {
        if (parts.susp >= 0.5) {
          V.wheels[1].steer.rotation.z = 0.38;
          V.wheels[1].steer.rotation.x = 0.12;
          if (V.loWheels && V.loWheels[1]) V.loWheels[1].rotation.z = 0.38;
        } else {
          V.wheels[1].steer.rotation.z = 0;
          V.wheels[1].steer.rotation.x = 0;
          if (V.loWheels && V.loWheels[1]) V.loWheels[1].rotation.z = 0;
        }
      }

      // 2. Humo de bloqueo de ruedas delanteras (car.lock)
      const lock = car.lock || 0;
      if (lock > 0.03 && car.v > 2) {
        const rate = lock * Math.min(2.0, car.v / 15) * 26 * dt;
        let count = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);

        tmpV.set(0, 0, 1).applyQuaternion(rootQuat);
        const fwdX = tmpV.x, fwdZ = tmpV.z;
        const vFwd = car.v * 0.14;

        while (count-- > 0) {
          for (let wi = 0; wi < 2; wi++) {
            tmpW.copy(wheelLocalPos[wi]).applyQuaternion(rootQuat).add(rootPos);

            const vx = fwdX * vFwd + (Math.random() - 0.5) * 0.8;
            const vy = 0.35 + Math.random() * 0.6;
            const vz = fwdZ * vFwd + (Math.random() - 0.5) * 0.8;

            const life = 0.85 + Math.random() * 0.45;
            const s0 = 0.35 + lock * 0.25;
            const sMax = 0.9 + lock * 0.6;
            const a0 = 0.16 + lock * 0.22;   // (humo fino: más espeso tapaba medio plano)
            const shade = 0.88 + Math.random() * 0.1;

            emitSmoke(tmpW.x, tmpW.y, tmpW.z, vx, vy, vz, life, s0, sMax, a0, shade);
          }
        }
      }

      // 3. Humo de derrape / trompo en ruedas traseras (car.beta / mistake.spin)
      const absBeta = Math.abs(car.beta || 0);
      const isSpin = car.mistake && car.mistake.type === 'spin';
      if ((absBeta > 0.12 || isSpin) && car.v > 2) {
        const intensity = isSpin ? 1.0 : Math.min(1.0, (absBeta - 0.12) / 0.22);
        const rate = intensity * Math.min(2.0, car.v / 14) * 60 * dt;
        let count = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);

        tmpV.set(0, 0, 1).applyQuaternion(rootQuat);
        const fwdX = tmpV.x, fwdZ = tmpV.z;
        const vFwd = car.v * 0.1;

        while (count-- > 0) {
          for (let wi = 2; wi < 4; wi++) {
            tmpW.copy(wheelLocalPos[wi]).applyQuaternion(rootQuat).add(rootPos);

            const vx = fwdX * vFwd + (Math.random() - 0.5) * 1.2;
            const vy = 0.4 + Math.random() * 0.7;
            const vz = fwdZ * vFwd + (Math.random() - 0.5) * 1.2;

            const life = 0.9 + Math.random() * 0.5;
            const s0 = 0.4;
            const sMax = 1.3 + intensity * 0.7;
            const a0 = 0.25 + intensity * 0.3;
            const shade = 0.89 + Math.random() * 0.08;

            emitSmoke(tmpW.x, tmpW.y, tmpW.z, vx, vy, vz, life, s0, sMax, a0, shade);
          }
        }
      }

      // 4. Chispas de los patines (skid blocks de titanio)
      if (car.state !== 'grid' && !car.inPit && car.v > 60) {
        const st = carSpk[ci] || (carSpk[ci] = { burstTimer: 0, cooldown: 0, burstDuration: 0, intensity: 0 });

        if (st.cooldown > 0) st.cooldown -= dt;
        if (st.burstTimer > 0) st.burstTimer -= dt;

        // Factores de roce de patines:
        // Velocidad: por encima de ~250 km/h (~69.4 m/s)
        const v = car.v;
        const vExcess = Math.max(0, v - 68.0);
        const aeroDownforce = (v / 75.0) ** 2 * (vExcess / 11.5);

        // Compresiones (cambio de pendiente hacia arriba / valle) y cambios de rasante
        const sIdx = T.idx ? T.idx(car.s) : Math.floor(((car.s % T.L + T.L) % T.L) / trackDs);
        const d2yVal = trackD2y[sIdx] || 0;
        const vertAcc = v * v * d2yVal;
        let compFactor = 0;
        if (vertAcc > 0.55) {
          compFactor = Math.min(3.8, vertAcc * 0.70); // valle / compresión fuerte
        } else if (d2yVal < -0.0008) {
          // Cambio de rasante / cresta
          compFactor = Math.min(2.2, Math.abs(d2yVal) * v * 16.0);
        }

        // Pisar pianos a alta velocidad (|d| cerca de HALF_W en curvas)
        const absD = Math.abs(car.d || 0);
        let kerbFactor = 0;
        const isCorner = Math.abs(T.k ? T.k[sIdx] : 0) > 0.0025 || (T.zoneOf && T.zoneOf[sIdx] >= 0);
        if (absD > 7.6 && (isCorner || absD > 8.4) && v > 62) {
          kerbFactor = Math.min(3.6, (absD - 7.4) * 1.75 * (v / 65.0));
        }

        // Baches / micro-ondulaciones del asfalto
        const sVal = car.s || 0;
        const bumpWave = Math.sin(sVal * 0.33 + 1.4) * Math.cos(sVal * 0.77 + 0.8) + 0.45 * Math.sin(sVal * 1.63);
        const bumpFactor = (bumpWave > 0.40 && v > 70) ? (bumpWave - 0.40) * 2.5 : 0;

        // Dinámica de cabeceo (pitch)
        const pitchFactor = car.pitch < -0.006 ? Math.min(1.8, Math.abs(car.pitch) * 75.0) : 0;

        // Menos combustible = coche más bajo
        const fuel = car.fuel ?? 50;
        const fuelFactor = 1.0 + Math.max(0, (100 - fuel) / 100) * 0.55;

        // Puntuación total de contacto
        const scrapeScore = (aeroDownforce * (0.34 + compFactor + bumpFactor + pitchFactor) + kerbFactor * (v / 56.0)) * fuelFactor * wetFactor;

        // Ráfagas a ritmo fijo: por encima de ~270 km/h, medio segundo de chispas cada 2 s (con un desfase por coche
        // para que no salgan todos a la vez); además, una ráfaga extra en una compresión fuerte
        st.cycle = (st.cycle ?? ci * 0.37) + dt;
        const fast = v > 75 && wetFactor > 0.3;
        if (!fast) st.cycle = Math.min(st.cycle, 1.5);        // al volver a ir rápido, sale enseguida
        if (fast && st.cycle >= 2.0) { st.cycle = 0; st.burstTimer = 0.5; st.intensity = Math.min(3.5, Math.max(1, scrapeScore)); }
        else if (compFactor > 1.5 && st.burstTimer <= 0 && st.cooldown <= 0 && v > 62) { st.burstTimer = 0.3; st.cooldown = 1.5; st.intensity = Math.min(3.5, Math.max(1, scrapeScore)); }

        if (st.burstTimer > 0) {
          const rate = (170 + st.intensity * 200) * dt;   // (más y más finas)
          let count = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
          if (count > 0) {
            emitSkidSparks(car, rootPos, rootQuat, count, st.intensity, isNight);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // B. Actualización de partículas de humo
    // -----------------------------------------------------------------------
    for (let i = 0; i < smkLive; i++) {
      smkLife[i] += dt;
      if (smkLife[i] >= smkMaxLife[i]) {
        const last = --smkLive;
        if (i < last) {
          smkPos[i * 3] = smkPos[last * 3];
          smkPos[i * 3 + 1] = smkPos[last * 3 + 1];
          smkPos[i * 3 + 2] = smkPos[last * 3 + 2];
          smkVel[i * 3] = smkVel[last * 3];
          smkVel[i * 3 + 1] = smkVel[last * 3 + 1];
          smkVel[i * 3 + 2] = smkVel[last * 3 + 2];
          smkLife[i] = smkLife[last];
          smkMaxLife[i] = smkMaxLife[last];
          smkS0[i] = smkS0[last];
          smkSMax[i] = smkSMax[last];
          smkA0[i] = smkA0[last];
          smkShade[i] = smkShade[last];
          smkSize[i] = smkSize[last];
          smkAlpha[i] = smkAlpha[last];
        }
        i--;
        continue;
      }

      const t = smkLife[i] / smkMaxLife[i];
      smkPos[i * 3] += smkVel[i * 3] * dt;
      smkPos[i * 3 + 1] += smkVel[i * 3 + 1] * dt;
      smkPos[i * 3 + 2] += smkVel[i * 3 + 2] * dt;

      smkVel[i * 3] *= 0.96;
      smkVel[i * 3 + 1] += 0.25 * dt;
      smkVel[i * 3 + 2] *= 0.96;

      const expand = t * (2.0 - t);
      smkSize[i] = smkS0[i] + (smkSMax[i] - smkS0[i]) * expand;
      smkAlpha[i] = smkA0[i] * (1.0 - t * t);
    }

    smkGeo.setDrawRange(0, smkLive);
    if (smkLive > 0) {
      smkGeo.attributes.position.needsUpdate = true;
      smkGeo.attributes.aSize.needsUpdate = true;
      smkGeo.attributes.aAlpha.needsUpdate = true;
      smkGeo.attributes.aShade.needsUpdate = true;
    }

    // -----------------------------------------------------------------------
    // C. Actualización de chispas
    // -----------------------------------------------------------------------
    for (let i = 0; i < spkLive; i++) {
      spkLife[i] += dt;
      if (spkLife[i] >= spkMaxLife[i]) {
        const last = --spkLive;
        if (i < last) {
          spkPos[i * 3] = spkPos[last * 3];
          spkPos[i * 3 + 1] = spkPos[last * 3 + 1];
          spkPos[i * 3 + 2] = spkPos[last * 3 + 2];
          spkVel[i * 3] = spkVel[last * 3];
          spkVel[i * 3 + 1] = spkVel[last * 3 + 1];
          spkVel[i * 3 + 2] = spkVel[last * 3 + 2];
          spkCol[i * 3] = spkCol[last * 3];
          spkCol[i * 3 + 1] = spkCol[last * 3 + 1];
          spkCol[i * 3 + 2] = spkCol[last * 3 + 2];
          spkLife[i] = spkLife[last];
          spkMaxLife[i] = spkMaxLife[last];
          spkGroundY[i] = spkGroundY[last];
          spkSize[i] = spkSize[last];
          spkAlpha[i] = spkAlpha[last];
        }
        i--;
        continue;
      }

      const t = spkLife[i] / spkMaxLife[i];
      spkVel[i * 3 + 1] -= 22.0 * dt;

      const drag = Math.pow(0.95, dt * 60);
      spkVel[i * 3] *= drag;
      spkVel[i * 3 + 2] *= drag;

      spkPos[i * 3] += spkVel[i * 3] * dt;
      spkPos[i * 3 + 1] += spkVel[i * 3 + 1] * dt;
      spkPos[i * 3 + 2] += spkVel[i * 3 + 2] * dt;

      if (spkPos[i * 3 + 1] <= spkGroundY[i] + 0.02) {
        spkPos[i * 3 + 1] = spkGroundY[i] + 0.02;
        spkVel[i * 3 + 1] = -spkVel[i * 3 + 1] * 0.42;
        spkVel[i * 3] *= 0.74;
        spkVel[i * 3 + 2] *= 0.74;
      }

      spkAlpha[i] = 1.0 - t * t;
    }

    spkGeo.setDrawRange(0, spkLive);
    if (spkLive > 0) {
      spkGeo.attributes.position.needsUpdate = true;
      spkGeo.attributes.aAlpha.needsUpdate = true;
      spkGeo.attributes.aColor.needsUpdate = true;
      spkGeo.attributes.aSize.needsUpdate = true;
    }

    // -----------------------------------------------------------------------
    // D. Física de trozos de fibra de carbono (Debris)
    // -----------------------------------------------------------------------
    let debrisDirty = false;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const p = debrisPieces[i];
      if (!p.active) continue;

      p.life += dt;
      if (p.life >= 60.0) {
        p.active = false;
        debrisMesh.setMatrixAt(i, zeroMatrix);
        debrisDirty = true;
        continue;
      }

      if (!p.onGround) {
        p.vy -= 14.0 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;

        p.rx += p.vrx * dt;
        p.ry += p.vry * dt;
        p.rz += p.vrz * dt;

        p.vx *= Math.pow(0.98, dt * 60);
        p.vz *= Math.pow(0.98, dt * 60);

        if (p.y <= p.groundY + 0.018) {
          p.y = p.groundY + 0.018;
          if (Math.abs(p.vy) > 0.8) {
            p.vy = -p.vy * 0.36;
            p.vx *= 0.65;
            p.vz *= 0.65;
            p.vrx *= 0.5;
            p.vry *= 0.5;
            p.vrz *= 0.5;
          } else {
            p.vy = 0;
            p.vx = 0;
            p.vz = 0;
            p.vrx = 0;
            p.vry = 0;
            p.vrz = 0;
            p.rx = 0;
            p.rz = 0;
            p.onGround = true;
          }
        }

        tmpEuler.set(p.rx, p.ry, p.rz, 'YXZ');
        tmpQ.setFromEuler(tmpEuler);
        tmpV.set(p.x, p.y, p.z);
        tmpM.compose(tmpV, tmpQ, new THREE.Vector3(1, 1, 1));
        debrisMesh.setMatrixAt(i, tmpM);
        debrisDirty = true;
      }
    }

    if (debrisDirty) {
      debrisMesh.instanceMatrix.needsUpdate = true;
    }

    // -----------------------------------------------------------------------
    // E. Manchas de grava en pista
    // -----------------------------------------------------------------------
    updateGravel();
  }

  return { update };
}
