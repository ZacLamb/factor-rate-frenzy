import * as THREE from 'three';
import { ARENA, SHOPS, resolve, RULES, RANKS, levelFor, perks } from './shared.js';

const $ = (s) => document.querySelector(s);
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const SKINS = [
  { n: 'Diner Dina', e: '🍳', body: 0xe4572e, hat: 'chef' },
  { n: 'Barber Beto', e: '💈', body: 0x3a86ff, hat: 'cap' },
  { n: 'Taco Tony', e: '🌮', body: 0xffa62b, hat: 'sombrero' },
  { n: 'Laundry Lou', e: '🧺', body: 0x2ec4b6, hat: 'beanie' },
  { n: 'Florist Flo', e: '🌸', body: 0xef476f, hat: 'flower' },
  { n: 'Bodega Bo', e: '🥤', body: 0x8ac926, hat: 'cap' },
];
const TIPS = [
  'A factor rate of 1.35 on $5,000 means you repay $6,750 — a fixed $1,750 cost, however fast you pay.',
  'Holdback = a % of every card sale goes to the lender automatically. Slow week? You pay less. Great week? You pay faster.',
  'Paying an advance off early does NOT cut the cost. That is why the effective APR can be triple digits.',
  'Stacking = taking a second advance before the first is paid. More cash now, higher payback, bigger holdback.',
  'Compare offers by total payback and effective APR, not just the factor rate.',
  'No fixed term: an MCA is repaid from future sales, not on a monthly schedule.',
];
const cfg = RULES;
let pid = localStorage.getItem('frf_pid');
if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('frf_pid', pid); }
const myLv = () => roster.get(myId)?.lv || 0;

/* ---------- state ---------- */
let cfgS = { seats: 4, bots: true };
let room = null, myId = null, roster = new Map(), hostId = null, phase = 'lobby', snap = null;
let myName = '', mySkin = +localStorage.getItem('frf_skin') || 0, code = '';
const touch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (touch) document.body.classList.add('touch');
if (touch) $('#howD')?.removeAttribute('open');
const me = { x: 0, z: 0, ang: 0, stun: 0, surgeCd: 0, surge: 0, boost: 0, owed: 0, cash: 0, hb: 0.25, swept: 0 };

/* ---------- audio ---------- */
let actx;
function beep(f, d = 0.08, type = 'sine', v = 0.05, f2) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f; if (f2) o.frequency.linearRampToValueAtTime(f2, actx.currentTime + d);
    g.gain.value = v; g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
  } catch {}
}

/* ---------- three.js scene ---------- */
let QUAL = localStorage.getItem('frf_q') || (touch ? 'low' : 'high');
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: false, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, QUAL === 'low' ? 1 : 1.5), dprMax = dpr;
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = QUAL !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
function canvasTexEarly(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
scene.background = canvasTexEarly(16, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#16307a'); gr.addColorStop(0.5, '#8a4aa8'); gr.addColorStop(1, '#ff9a5e'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
scene.fog = new THREE.Fog(0x5a4290, 85, 240);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);
scene.add(new THREE.HemisphereLight(0xd6ecff, 0x7a5a8a, 1.25));
const sun = new THREE.DirectionalLight(0xffc88a, 2.1);
sun.castShadow = QUAL !== 'low';
sun.shadow.mapSize.set(QUAL === 'ultra' ? 2048 : 1024, QUAL === 'ultra' ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
scene.add(sun, sun.target);

/* ---- post-processing / reflections (High & Ultra), switchable at runtime ---- */
let composer = null, bloom = null, FX = null, envPM = null, fxTried = false, refl = null, wetMap = null, dgCount = 0;
async function ensureFx() {
  if (FX || fxTried) return !!FX; fxTried = true;
  FX = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'), import('three/addons/objects/Reflector.js'),
  ]).catch((e) => { console.warn('fx unavailable', e); return null; });
  if (!FX) return false;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 2 });
  composer = new FX[0].EffectComposer(renderer, rt);
  composer.addPass(new FX[1].RenderPass(scene, camera));
  bloom = new FX[2].UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.55, 0.95);
  composer.addPass(bloom); composer.addPass(new FX[3].OutputPass());
  const pm = new THREE.PMREMGenerator(renderer);
  const envTex = canvasTexEarly(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#171347'); gr.addColorStop(0.5, '#5a3f93'); gr.addColorStop(1, '#e58a8a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,${190 + (i % 3) * 20},${120 + (i % 5) * 20},.9)`; g.beginPath(); g.arc((i * 97) % w, h * (0.35 + ((i * 53) % 40) / 100), 4 + (i % 4) * 3, 0, 6.3); g.fill(); }
  });
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envPM = pm.fromEquirectangular(envTex).texture;
  return true;
}
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function textSprite(text, color = '#fff', size = 4, bg = true) {
  const t = canvasTex(256, 64, (g, w, h) => {
    g.font = '800 34px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (bg) { g.fillStyle = 'rgba(0,0,0,.55)'; const tw = Math.min(w - 8, g.measureText(text).width + 28); g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, h - 16, 16); g.fill(); }
    g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(size, size / 4, 1); s.renderOrder = 10; return s;
}

function windowMaps(w, h, base, lit = 0.55) {
  const cols = Math.max(2, Math.round(w / 1.7)), rows = Math.max(1, Math.round(h / 1.9)), cell = 28;
  const mk = (emit) => canvasTex(cols * cell, rows * cell, (g, W, H) => {
    g.fillStyle = emit ? '#000' : base; g.fillRect(0, 0, W, H);
    const r = (() => { let s = (cols * 31 + rows * 17 + (emit ? 0 : 0)) % 9973; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const on = r() < lit;
      g.fillStyle = emit ? (on ? (r() < 0.07 ? '#9fd8ff' : '#ffb04a') : '#000') : (on ? '#ffe9b0' : 'rgba(10,14,30,.75)');
      g.fillRect(x * cell + 6, y * cell + 6, cell - 12, cell - 10);
    }
  });
  return { map: mk(false), emissiveMap: mk(true) };
}
// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 40, ARENA * 2 + 40), new THREE.MeshStandardMaterial({
  roughness: 0.95, map: canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6e6288'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = 'rgba(255,215,90,.85)'; g.lineWidth = 7; g.setLineDash([40, 30]);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  }),
}));
ground.material.map.wrapS = ground.material.map.wrapT = THREE.RepeatWrapping; ground.material.map.repeat.set(4, 4);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
function wetMapGet() {
  if (!wetMap) {
    wetMap = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 22; i++) { const x = Math.random() * w, y = Math.random() * h, r = 14 + Math.random() * 36; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#202020'); gr.addColorStop(1, 'rgba(224,224,224,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } });
    wetMap.colorSpace = THREE.NoColorSpace; wetMap.wrapS = wetMap.wrapT = THREE.RepeatWrapping; wetMap.repeat.set(4, 4);
  }
  return wetMap;
}
function buildRefl() {
  const { Reflector } = FX[4], S = Reflector.ReflectorShader;
  const shader = { name: 'WetStreet', uniforms: THREE.UniformsUtils.clone(S.uniforms), vertexShader: S.vertexShader,
    fragmentShader: 'uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv; void main(){ vec4 b = texture2DProj(tDiffuse, vUv); gl_FragColor = vec4(b.rgb * color, 0.42); }' };
  refl = new Reflector(new THREE.PlaneGeometry(ARENA * 2 + 6, ARENA * 2 + 6), { textureWidth: Math.min(1024, innerWidth * 0.5 | 0), textureHeight: Math.min(1024, innerHeight * 0.5 | 0), clipBias: 0.003, shader, color: 0x8f9bd0 });
  refl.material.transparent = true; refl.material.depthWrite = false; refl.rotation.x = -Math.PI / 2; refl.position.y = 0.04; scene.add(refl);
}
const QNAME = { low: 'Fast', high: 'High', ultra: 'Ultra' };
function applyQuality(q) {
  QUAL = q; try { localStorage.setItem('frf_q', q); } catch {}
  const on = q !== 'low' && !!FX;
  renderer.shadowMap.enabled = on; sun.castShadow = on;
  const sz = q === 'ultra' ? 2048 : 1024; if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  scene.environment = on ? envPM : null; scene.environmentIntensity = 0.65;
  ground.material.roughnessMap = on ? wetMapGet() : null; ground.material.roughness = on ? 1 : 0.95; ground.material.metalness = on ? 0.2 : 0;
  if (on && q === 'ultra') { if (!refl) buildRefl(); refl.visible = true; } else if (refl) refl.visible = false;
  dprMax = Math.min(devicePixelRatio, q === 'low' ? 1 : 1.5); dpr = dprMax; renderer.setPixelRatio(dpr);
  scene.traverse((o) => { const ms = o.material; if (ms) (Array.isArray(ms) ? ms : [ms]).forEach((x) => { x.needsUpdate = true; }); });
  resize();
  const qb = document.querySelector('#qBtn'); if (qb) { qb.textContent = '⚙ ' + QNAME[q]; qb.disabled = false; }
}
async function setQuality(q) { if (q !== 'low') await ensureFx(); applyQuality(q); }
// arena plaza
const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshStandardMaterial({ roughness: 0.85, map: canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#5a4e70'; g.fillRect(0, 0, w, h); const n = 10, s = w / n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#8a7a98' : '#9a8aa6'; g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4); }
  g.strokeStyle = 'rgba(255,200,61,.9)'; g.lineWidth = 14; g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 6.3); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.beginPath(); g.arc(w / 2, h / 2, w * 0.3, 0, 6.3); g.stroke();
}) }));
{ const pr = new THREE.Mesh(new THREE.TorusGeometry(15.1, 0.14, 6, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e8ff).multiplyScalar(2.2) })); pr.rotation.x = Math.PI / 2; pr.position.y = 0.07; scene.add(pr); }
plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true; scene.add(plaza);
// walls
const wallM = new THREE.MeshStandardMaterial({ color: 0x4a4f6a, roughness: 0.8 });
for (const [x, z, w, d] of [[0, -ARENA - 1, ARENA * 2 + 4, 2], [0, ARENA + 1, ARENA * 2 + 4, 2], [-ARENA - 1, 0, 2, ARENA * 2], [ARENA + 1, 0, 2, ARENA * 2]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), wallM); m.position.set(x, 1.2, z); m.castShadow = true; scene.add(m);
}
// buildings
for (const b of SHOPS) {
  const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
  const wm = b.label ? windowMaps(b.w, b.h, '#' + b.color.toString(16).padStart(6, '0'), b.hq ? 0.35 : 0.6) : null;
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), wm
    ? new THREE.MeshStandardMaterial({ map: wm.map, emissiveMap: wm.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.55, metalness: b.hq ? 0.4 : 0 })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.8 }));
  body.position.y = b.h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
  if (b.label) {
    const face = b.z > 0 ? -1 : 1; // sign faces the arena centre
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.85, b.hq ? 1.6 : 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5),
      map: canvasTex(512, 96, (c, w, h) => { c.fillStyle = b.hq ? '#ff3d4d' : '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = b.hq ? '#fff' : '#222'; c.font = '900 56px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.label, w / 2, h / 2 + 3); }),
    }));
    for (const side of [1, -1]) {
      const s = sign.clone(); s.position.set(0, b.hq ? b.h - 2 : b.h - 1.3, side * (b.d / 2 + 0.05)); if (side < 0) s.rotation.y = Math.PI; g.add(s);
    }
    if (b.awning) {
      const aw = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.25, 2), new THREE.MeshStandardMaterial({ map: canvasTex(128, 32, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#' + b.awning.toString(16).padStart(6, '0'); g.fillRect(i * 16, 0, 16, h); } }) }));
      aw.position.set(0, 3.1, face * (b.d / 2 + 0.8)); aw.rotation.x = face * 0.25; aw.castShadow = true; g.add(aw);
    }
  }
  if (b.label && !b.hq) {
    const cy = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e8ff).multiplyScalar(2.2) });
    for (const [w, d, x, z] of [[b.w + 0.3, 0.14, 0, b.d / 2 + 0.07], [b.w + 0.3, 0.14, 0, -b.d / 2 - 0.07], [0.14, b.d, b.w / 2 + 0.07, 0], [0.14, b.d, -b.w / 2 - 0.07, 0]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), cy); t.position.set(x, b.h + 0.05, z); g.add(t); }
  }
  if (b.planter) { const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 0), new THREE.MeshStandardMaterial({ color: 0x4fa84a, roughness: 0.8, flatShading: true })); bush.position.y = b.h + 1.0; bush.castShadow = true; g.add(bush); }
  if (b.hq) { // spinning "coin" on top of lender tower
    const c = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.35, 12, 28), new THREE.MeshStandardMaterial({ color: 0xff3d4d, emissive: 0xff1030, emissiveIntensity: 3 }));
    c.position.y = b.h + 2; c.name = 'hqRing'; g.add(c);
  }
  scene.add(g);
}
// "Powered by Fundara" banners on the north and south walls
for (const z of [-ARENA - 1.05, ARENA + 1.05]) {
  const bn = new THREE.Mesh(new THREE.PlaneGeometry(26, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.3), map: canvasTex(1024, 80, (g, w, h) => { g.fillStyle = '#12142a'; g.fillRect(0, 0, w, h); g.fillStyle = '#9aa1c6'; g.font = '600 26px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P O W E R E D   B Y', w * 0.36, h / 2); g.fillStyle = '#1fd1a5'; g.font = '900 44px system-ui'; g.fillText('FUNDARA', w * 0.64, h / 2 + 2); }) }));
  bn.position.set(0, 1.2, z); if (z > 0) bn.rotation.y = Math.PI; scene.add(bn);
}
// party string lights across the streets + floating confetti
{
  const bulbs = [], lines = [[-15, -21, 15, -21], [-15, 21, 15, 21], [-21, -15, -21, 15], [21, -15, 21, 15]];
  const gm = new THREE.SphereGeometry(0.22, 8, 6), cols = [0xff5d8f, 0xffc83d, 0x35e0c0, 0x6ab7ff, 0xffffff];
  for (const [x1, z1, x2, z2] of lines) {
    const pts = [], N = 18;
    for (let i = 0; i <= N; i++) { const f = i / N, sag = Math.sin(f * Math.PI) * 0.9; const p = new THREE.Vector3(x1 + (x2 - x1) * f, 6.4 - sag, z1 + (z2 - z1) * f); pts.push(p); if (i % 2 === 1) bulbs.push(p); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x20182e })));
  }
  const im = new THREE.InstancedMesh(gm, new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length), d = new THREE.Object3D(), c = new THREE.Color();
  bulbs.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.setHex(cols[i % cols.length]).multiplyScalar(2.2)); });
  scene.add(im);
}
const CONF = 140, confPos = new Float32Array(CONF * 3), confCol = new Float32Array(CONF * 3);
for (let i = 0; i < CONF; i++) {
  confPos.set([(Math.random() * 2 - 1) * ARENA, Math.random() * 14, (Math.random() * 2 - 1) * ARENA], i * 3);
  const cc = new THREE.Color([0xffc83d, 0x35e0c0, 0xff5d8f, 0xffffff][i % 4]); confCol.set([cc.r, cc.g, cc.b], i * 3);
}
const confGeo = new THREE.BufferGeometry(); confGeo.setAttribute('position', new THREE.BufferAttribute(confPos, 3)); confGeo.setAttribute('color', new THREE.BufferAttribute(confCol, 3));
const confetti = new THREE.Points(confGeo, new THREE.PointsMaterial({ map: canvasTexEarly(32, 32, (g, w, h) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }), size: 0.6, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(confetti);
// wall neon strip, lamps, trees, skyline
const neonM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e8ff).multiplyScalar(2.4) });
for (const [x, z, w, d] of [[0, -ARENA - 1, ARENA * 2 + 4, 0.2], [0, ARENA + 1, ARENA * 2 + 4, 0.2], [-ARENA - 1, 0, 0.2, ARENA * 2], [ARENA + 1, 0, 0.2, ARENA * 2]]) {
  const n = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), neonM); n.position.set(x, 2.46, z); scene.add(n);
}
const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe9a8).multiplyScalar(3) }), poleM = new THREE.MeshStandardMaterial({ color: 0x1a1a22 });
let lampN = 0;
for (const [x, z] of [[-27, -ARENA - 3], [0, -ARENA - 3], [27, -ARENA - 3], [-27, ARENA + 3], [0, ARENA + 3], [27, ARENA + 3], [-ARENA - 3, -14], [-ARENA - 3, 14], [ARENA + 3, -14], [ARENA + 3, 14]]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7), poleM); p.position.set(x, 3.5, z); scene.add(p);
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), lampM); l.position.set(x, 7.2, z); scene.add(l);
}
{
  const N = 40, trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3426 }), N);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 4.5, 8), new THREE.MeshStandardMaterial({ color: 0x1f6b4a, roughness: 0.9 }), N * 2);
  const d = new THREE.Object3D();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, r = ARENA + 8 + (k % 3) * 3, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.96, sc = 0.9 + (k % 4) * 0.15;
    d.rotation.set(0, 0, 0); d.scale.setScalar(sc); d.position.set(x, sc, z); d.updateMatrix(); trunks.setMatrixAt(k, d.matrix);
    for (let q = 0; q < 2; q++) { d.scale.setScalar(sc * (1 - q * 0.3)); d.position.set(x, (3.2 + q * 1.6) * sc, z); d.updateMatrix(); crowns.setMatrixAt(k * 2 + q, d.matrix); }
  }
  scene.add(trunks, crowns);
}
const skyMats = [0, 1, 2].map((i) => { const wm = windowMaps(10 + i * 2, 40, i === 0 ? '#1a1633' : i === 1 ? '#221a40' : '#181a38', 0.4); return new THREE.MeshStandardMaterial({ map: wm.map, emissiveMap: wm.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 1 }); });
{
  const geo = new THREE.BoxGeometry(1, 1, 1), per = 14, d = new THREE.Object3D();
  skyMats.forEach((mat, mi) => {
    const im = new THREE.InstancedMesh(geo, mat, per);
    for (let n = 0; n < per; n++) {
      const k = n * 3 + mi, a = (k / 44) * Math.PI * 2 + (k % 3) * 0.02, r = 88 + (k % 5) * 9, h = 28 + ((k * 37) % 40);
      d.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); d.rotation.set(0, a, 0); d.scale.set(11 + (k % 3) * 2, h, 11 + (k % 4) * 2); d.updateMatrix(); im.setMatrixAt(n, d.matrix);
    }
    scene.add(im);
  });
}

/* ---------- characters ---------- */
const hexTex = canvasTexEarly(256, 256, (g, w, h) => {
  g.fillStyle = 'rgba(70,170,255,.2)'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(200,245,255,.95)'; g.lineWidth = 3;
  const r = 30, dx = r * 1.732, dy = r * 1.5;
  for (let row = -1; row < h / dy + 1; row++) for (let col = -1; col < w / dx + 1; col++) {
    const cx = col * dx + (row % 2 ? dx / 2 : 0), cy = row * dy; g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.stroke();
  }
}); hexTex.wrapS = hexTex.wrapT = THREE.RepeatWrapping; hexTex.repeat.set(3, 2);
function makeChar(skin) {
  const k = SKINS[skin] || SKINS[0], g = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: k.body, roughness: 0.6 });
  const skinM = new THREE.MeshStandardMaterial({ color: 0xf1c6a0, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.7, 6, 14), bodyM); body.position.y = 1.15; body.castShadow = true; g.add(body);
  const olM = new THREE.MeshBasicMaterial({ color: 0x1a1230, side: THREE.BackSide });
  const outline = (mesh, s = 1.07) => { const o = new THREE.Mesh(mesh.geometry, olM); o.scale.setScalar(s); mesh.add(o); };
  outline(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), skinM); head.position.y = 2.2; head.castShadow = true; g.add(head); outline(head, 1.08);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff })); apron.position.set(0, 1.05, 0.58); g.add(apron);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x111 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06), eyeM); e.position.set(s * 0.17, 2.27, 0.42); g.add(e); }
  const hm = new THREE.MeshStandardMaterial({ color: k.hat === 'chef' ? 0xffffff : k.hat === 'flower' ? 0xff9bd2 : 0x222a44 });
  let hat;
  if (k.hat === 'chef') { hat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.6, 14), hm); hat.position.y = 2.8; }
  else if (k.hat === 'sombrero') { hat = new THREE.Group(); const br = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xe9c46a })); const cr = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.5, 14), br.material); cr.position.y = 0.28; hat.add(br, cr); hat.position.y = 2.6; }
  else if (k.hat === 'beanie') { hat = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10, 0, 6.3, 0, 1.5), hm); hat.position.y = 2.3; }
  else if (k.hat === 'flower') { hat = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.12, 8, 16), hm); hat.rotation.x = Math.PI / 2; hat.position.y = 2.65; }
  else { hat = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.2, 16), hm); hat.position.y = 2.6; const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), hm); v.position.set(0, 2.52, 0.5); g.add(v); }
  g.add(hat);
  g.userData.legs = [-1, 1].map((s) => { const lg = new THREE.Group(); lg.position.set(s * 0.26, 0.5, 0); const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x1d2236 })); lm.position.y = -0.25; lm.castShadow = true; const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.52), new THREE.MeshStandardMaterial({ color: 0x0e1020, roughness: 0.4 })); shoe.position.set(0, -0.5, 0.08); shoe.castShadow = true; lg.add(lm, shoe); g.add(lg); return lg; });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), new THREE.MeshBasicMaterial({ map: hexTex, color: new THREE.Color(1.1, 1.5, 2), transparent: true, depthWrite: false, side: THREE.DoubleSide })); bubble.position.y = 1.5; bubble.visible = false; bubble.name = 'bubble'; g.add(bubble);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x442200 })); gun.position.set(0.74, 1.42, 0.95); g.add(gun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = 'ring'; g.add(ring);
  const aura = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.5, 28), new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  aura.rotation.x = -Math.PI / 2; aura.position.y = 0.08; aura.visible = false; aura.name = 'aura'; g.add(aura);
  // arms, face details, hair, badge, glowing belt
  g.userData.arms = [-1, 1].map((s) => { const a = new THREE.Group(); a.position.set(s * 0.74, 1.62, 0);
    const am = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.75, 8), bodyM); am.position.y = -0.38; am.castShadow = true;
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skinM); hd.position.y = -0.8; a.add(am, hd); g.add(a); return a; });
  g.userData.arms[1].rotation.x = -1.25;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.8 });
  for (const s of [-1, 1]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.05), dark); br.position.set(s * 0.17, 2.4, 0.42); br.rotation.z = s * -0.15; g.add(br); }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 12, Math.PI), eyeM); smile.rotation.z = Math.PI; smile.position.set(0, 2.14, 0.43); g.add(smile);
  if (skin === 2) { const mu = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), dark); mu.position.set(0, 2.2, 0.45); g.add(mu); }
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark); hair.position.set(0, 2.24, -0.05); hair.rotation.x = -0.35; g.add(hair);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff })); badge.position.set(-0.26, 1.5, 0.62); g.add(badge);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.05, 8, 22), new THREE.MeshStandardMaterial({ color: k.body, emissive: k.body, emissiveIntensity: 2 })); belt.rotation.x = Math.PI / 2; belt.position.y = 0.85; g.add(belt);
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x1f3b8a })); tie.position.set(0.02, 1.45, 0.64); g.add(tie);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.56), new THREE.MeshStandardMaterial({ color: 0xffffff })); stack.position.set(0, -0.92, 0.14); g.userData.arms[0].add(stack);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.03, 0.57), new THREE.MeshBasicMaterial({ color: 0xd7263d })); edge.position.set(0, -0.84, 0.14); g.userData.arms[0].add(edge);
  for (const ch of g.children) if (ch.position.y > 2.05 && ch.name !== 'bubble') { ch.position.x *= 1.25; ch.position.z *= 1.25; ch.position.y = 1.85 + (ch.position.y - 1.85) * 1.25; ch.scale.multiplyScalar(1.25); }
  return g;
}
const CHAR_SCALE = 1.22;
const chars = new Map(); // id -> {g, tx, tz, tang, ...}
function ensureChar(id) {
  let c = chars.get(id); const r = roster.get(id);
  if (c && r && c.skin === r.s && c.name === r.n && c.lv === r.lv) return c;
  if (c) scene.remove(c.g);
  const lv = r?.lv || 0; const g = makeChar(r ? r.s : 0);
  const tag = textSprite((lv ? RANKS[lv].i + ' ' : '') + (r ? r.n : '…'), lv >= 5 ? '#ffd84d' : id === myId ? '#ffc83d' : '#fff', 4.6);
  tag.position.y = 3.6; g.add(tag); scene.add(g);
  if (lv >= 5) { const cr = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.3, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0xaa7a00, emissiveIntensity: 0.8, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.25 })); cr.position.y = 2.85; g.add(cr); }
  c = { lv, g, x: c?.x ?? 0, z: c?.z ?? 0, ang: c?.ang ?? 0, skin: r?.s, name: r?.n, flash: 0 };
  c.aura = g.getObjectByName('aura'); c.ringM = g.getObjectByName('ring'); c.bubble = g.getObjectByName('bubble');
  chars.set(id, c); return c;
}

/* ---------- orbs, bullets, fx ---------- */
const orbMeshes = new Map(), bulletMeshes = new Map(), fxList = [];
const coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.16, 22).rotateX(Math.PI / 2);
const coinTex = canvasTexEarly(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2); gr.addColorStop(0, '#ffe58a'); gr.addColorStop(1, '#e0a020'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = '#b97800'; g.lineWidth = 7; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, 6.3); g.stroke(); g.fillStyle = '#b97800'; for (const [x, y, hh] of [[44, 74, 18], [60, 62, 30], [76, 50, 42]]) g.fillRect(x, y + (42 - hh) * 0.5, 10, hh); });
const coinMat = new THREE.MeshStandardMaterial({ map: coinTex, color: 0xffffff, metalness: 0.8, roughness: 0.25, emissive: 0xb07400, emissiveIntensity: 1.4 });
const POW = { 1: { c: 0xff2e63, l: 'STACK?', lc: '#ff8fa8', geo: () => new THREE.OctahedronGeometry(1.1) },
  2: { c: 0x3ddc97, l: 'PAYOFF DISCOUNT', lc: '#8fffcf', geo: () => new THREE.IcosahedronGeometry(1) },
  3: { c: 0x4cc9f0, l: 'LEGAL SHIELD', lc: '#9fe6ff', geo: () => new THREE.TorusKnotGeometry(0.6, 0.22, 48, 8) },
  4: { c: 0xb388ff, l: 'HOLDBACK HOLIDAY', lc: '#d4bcff', geo: () => new THREE.DodecahedronGeometry(1) } };
const ORB_COL = { 0: 0xffc83d, 1: 0xff2e63, 2: 0x3ddc97, 3: 0x4cc9f0, 4: 0xb388ff };
const glowGeo = new THREE.CircleGeometry(0.9, 16), glowMat = new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.22 });
function makeOrb(k, v) {
  const g = new THREE.Group(); g.userData.k = k;
  if (k >= 1) {
    const P = POW[k];
    const m = new THREE.Mesh(P.geo(), new THREE.MeshStandardMaterial({ color: P.c, emissive: P.c, emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.3 }));
    m.position.y = 1.6; m.name = 'spin'; g.add(m);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.7, 32), new THREE.MeshBasicMaterial({ color: P.c, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.08; halo.name = 'halo'; g.add(halo);
    const s = textSprite(P.l, P.lc, 4.2); s.position.y = 3.6; g.add(s);
  } else {
    const m = new THREE.Mesh(coinGeo, coinMat); const sc = 0.95 + Math.min(v, 1500) / 1500 * 0.8; m.scale.setScalar(sc); m.position.y = 1.1; m.name = 'spin'; g.add(m);
    const glow = new THREE.Mesh(glowGeo, glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; g.add(glow);
  }
  return g;
}
const bulletGeo = new THREE.PlaneGeometry(1.1, 1.4).rotateX(-Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(128, 160, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d7263d'; g.lineWidth = 5; g.strokeRect(12, 14, w - 24, 40);
  g.fillStyle = '#d7263d'; g.font = '900 22px system-ui'; g.textAlign = 'center'; g.fillText('NOTICE', w / 2, 43);
  g.fillStyle = '#b9bdc9'; for (let i = 0; i < 6; i++) g.fillRect(14, 74 + i * 14, i % 3 === 2 ? w * 0.5 : w - 28, 5);
  
}) });
function addRing(x, z, color = 0xff5d6c, max = 4) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 28), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.3, z); scene.add(m); fxList.push({ m, t: 0, max });
}
const burstGeo = new THREE.SphereGeometry(0.17, 6, 5);
function burst(x, z, color, n = 9) {
  for (let i = 0; i < n; i++) {
    const mm = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true })); mm.position.set(x, 1.2, z); scene.add(mm);
    const a = Math.random() * 6.28, sp = 3 + Math.random() * 5; fxList.push({ m: mm, p: true, t: 0, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 5, vz: Math.sin(a) * sp });
  }
}
const _v = new THREE.Vector3();
function floatText(x, z, y, text, color = '#fff') {
  _v.set(x, y, z).project(camera); if (_v.z > 1) return;
  const d = document.createElement('div'); d.className = 'float'; d.textContent = text; d.style.color = color;
  d.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; d.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
  document.body.appendChild(d); setTimeout(() => d.remove(), 1100);
}
function toast(text, cls = '') {
  const d = document.createElement('div'); d.className = 't ' + cls; d.textContent = text; $('#toast').appendChild(d); setTimeout(() => d.remove(), 4000);
  while ($('#toast').children.length > 3) $('#toast').firstChild.remove();
}

/* ---------- input ---------- */
const keys = {}; let mouseNdc = { x: 0, y: 0 }, mouseDown = false;
const stick = { L: { id: null, x: 0, y: 0 }, R: { id: null, x: 0, y: 0 } };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true; if (e.code === 'Space') { e.preventDefault(); ability(); } if (e.code === 'KeyF' && !e.repeat) fireNotice();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousemove', (e) => { mouseNdc = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 }; });
let rightDown = false;
addEventListener('contextmenu', (e) => { if (e.target.id === 'c') e.preventDefault(); });
$('#c').addEventListener('mousedown', (e) => { if (e.button === 2) rightDown = true; else fireNotice(); });
addEventListener('mouseup', (e) => { if (e.button === 2) rightDown = false; });
function bindStick(name, el) {
  const s = stick[name];
  const set = (e) => { const r = el.getBoundingClientRect(); let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } s.x = dx; s.y = dy; el.firstElementChild.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; };
  el.addEventListener('pointerdown', (e) => { s.id = e.pointerId; el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === s.id) set(e); });
  const end = (e) => { if (e.pointerId === s.id) { if (name === 'R' && Math.hypot(s.x, s.y) > 0.3) fireNotice(); s.id = null; s.x = s.y = 0; el.firstElementChild.style.transform = ''; } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
bindStick('L', $('#stickL')); bindStick('R', $('#stickR'));
$('#abBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); ability(); });
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
let wantFire = false, lastFire = -9;
function fireNotice() {
  if (!room || phase !== 'play' || me.stun > 0 || performance.now() - lastFire < 600) return;
  lastFire = performance.now(); room.send('fire', { a: +me.ang.toFixed(3) }); beep(420, 0.08, 'square', 0.03, 260);
}
function ability() { if (room && phase === 'play' && me.surgeCd <= 0 && me.stun <= 0) { room.send('ab'); beep(500, 0.2, 'sawtooth', 0.04, 900); } }

/* ---------- network ---------- */
function ws() { return location.origin.replace(/^http/, 'ws'); }
async function connect() {
  const params = new URLSearchParams(location.search);
  code = (params.get('m') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) { code = Math.random().toString(36).slice(2, 7).toUpperCase(); history.replaceState(null, '', '?m=' + code); }
  try {
    const client = new Colyseus.Client(ws());
    room = await client.joinOrCreate('match', { code, name: myName, skin: mySkin, pid });
  } catch (e) { return showMsg('Could not join', 'This match is full (the host can raise the player limit in the lobby) or the server is busy. Try again or start a new link.'); }
  myId = room.sessionId;
  room.onLeave(() => showMsg('Disconnected', 'Lost connection to the match.'));
  room.onMessage('roster', (m) => { hostId = m.host; cfgS = m.cfg || cfgS; roster = new Map(m.p.map((p) => [p.id, p])); renderLobby(); });
  room.onMessage('spawn', (m) => { me.x = m.x; me.z = m.z; });
  room.onMessage('snap', onSnap);
  room.onMessage('gain', (m) => {
    floatText(me.x, me.z, 3.2, '+' + money(m.g - m.s), m.b ? '#ff9bd2' : '#3ddc97');
    if (m.s > 0 && Math.random() < 0.5) floatText(me.x + 0.5, me.z, 2.2, '−' + money(m.s) + ' holdback', '#ff5d6c');
    beep(880 + Math.random() * 200, 0.07, 'triangle', 0.04);
  });
  room.onMessage('fx', onFx);
  room.onMessage('results', onResults);
  room.onMessage('xp', onXp);
  setInterval(sendInput, 33);
}
function sendInput() { if (room) room.send('in', { x: +me.x.toFixed(2), z: +me.z.toFixed(2), a: +me.ang.toFixed(3), f: false }); }
let lastSnapT = 0, gapEma = 33, interp = 100, mvx = 0, mvz = 0, lastHud = 0;
const _tgt = new THREE.Vector3(), _smp = { x: 0, z: 0, ang: 0 };
function sampleBuf(buf, rt, out) {
  const n = buf.length; if (!n) return false;
  const L = buf[n - 1];
  if (rt >= L.t) { out.x = L.x; out.z = L.z; out.ang = L.ang; return true; }
  for (let i = n - 2; i >= 0; i--) {
    const a = buf[i]; if (a.t > rt) continue;
    const b = buf[i + 1], f = (rt - a.t) / (b.t - a.t || 1); let da = b.ang - a.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
    out.x = a.x + (b.x - a.x) * f; out.z = a.z + (b.z - a.z) * f; out.ang = a.ang + da * f; return true;
  }
  const F = buf[0]; out.x = F.x; out.z = F.z; out.ang = F.ang; return true;
}
function onSnap(s) {
  const nowT = performance.now();
  if (lastSnapT) { gapEma += (nowT - lastSnapT - gapEma) * 0.1; interp = Math.max(75, Math.min(170, gapEma * 2.4)); } lastSnapT = nowT;
  const prev = phase; snap = s; phase = s.ph;
  const seen = new Set();
  for (const a of s.p) {
    const id = a[0]; seen.add(id);
    if (id === myId) { Object.assign(me, { stun: a[4], owed: a[5], cash: a[6], hb: a[7], boost: a[8], surge: a[9], surgeCd: a[10], swept: a[11], shield: a[13], cut: a[14] }); continue; }
    const c = ensureChar(id); (c.buf ||= []).push({ t: nowT, x: a[1], z: a[2], ang: a[3] }); if (c.buf.length > 8) c.buf.shift(); c.tx = a[1]; c.stun = a[4]; c.surge = a[9]; c.boost = a[8]; c.shield = a[13];
    if (c.x === 0 && c.z === 0) { c.x = a[1]; c.z = a[2]; }
  }
  for (const id of [...chars.keys()]) if (!seen.has(id) && id !== myId) { scene.remove(chars.get(id).g); chars.delete(id); }
  const live = new Set();
  for (const o of s.o) {
    live.add(o[0]); let m = orbMeshes.get(o[0]);
    if (!m) { m = makeOrb(o[4], o[3]); scene.add(m); orbMeshes.set(o[0], m); m.userData.born = performance.now(); }
    m.position.x = o[1]; m.position.z = o[2];
  }
  for (const [id, m] of orbMeshes) if (!live.has(id)) { if (phase === 'play') burst(m.position.x, m.position.z, ORB_COL[m.userData.k] || 0xffc83d, m.userData.k ? 14 : 7); scene.remove(m); orbMeshes.delete(id); }
  const lb = new Set();
  for (const b of s.b) {
    lb.add(b[0]); let m = bulletMeshes.get(b[0]);
    if (!m) { m = new THREE.Mesh(bulletGeo, bulletMat); m.position.y = 1.5; scene.add(m); bulletMeshes.set(b[0], m); m.position.set(b[1], 1.4, b[2]); m.userData.fresh = true; }
    m.userData.tx = b[1]; m.userData.tz = b[2]; m.userData.ang = b[3]; m.userData.st = nowT;
  }
  for (const [id, m] of bulletMeshes) if (!lb.has(id)) { scene.remove(m); bulletMeshes.delete(id); }
  if (prev !== phase) onPhase(prev);
  updateHud();
}
function showBanner(t, p) {
  const b = $('#banner'); b.classList.add('hidden'); void b.offsetWidth; b.innerHTML = `<h1>${t}</h1><p>${p}</p>`; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 4900);
}
function onPhase(prev) {
  if (phase === 'play') { $('#results').classList.add('hidden'); $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden'); showBanner('PAY OFF YOUR ADVANCE FIRST', 'You owe $6,750. Grab coins — 25% of each is swept to the lender. First to $0 wins, otherwise highest net worth at 0:00. Grab power-ups, avoid the red STACK pods.'); beep(660, 0.3, 'square', 0.04, 990); }
  else if (phase === 'lobby') { $('#hud').classList.add('hidden'); if ($('#results').classList.contains('hidden')) $('#lobby').classList.remove('hidden'); renderLobby(); }
  else if (phase === 'results') { /* panel opened by 'results' message */ }
}
function onFx(f) {
  const rn = (id) => roster.get(id)?.n || 'Someone';
  if (f.k === 'hit') {
    addRing(f.x, f.z); const c = f.id === myId ? null : chars.get(f.id); if (c) c.flash = 0.4;
    if (f.id === myId) { toast(`${rn(f.by)} served you a collections notice! −${money(f.d)} cash dropped`, 'bad'); beep(160, 0.3, 'sawtooth', 0.07, 80); }
    else if (f.by === myId) { toast(`Direct hit on ${rn(f.id)}!`, 'good'); beep(300, 0.12, 'square', 0.05); }
  } else if (f.k === 'stack') {
    addRing(f.x, f.z, 0xff2e63, 7);
    toast(f.id === myId ? 'STACKED! +$3,000 cash and 2× sales… but payback +$4,350 and holdback +5%.' : `${rn(f.id)} stacked a second advance!`, 'bad'); if (f.id === myId) beep(200, 0.5, 'sawtooth', 0.06, 120);
  } else if (f.k === 'surge') { addRing(chars.get(f.id)?.x ?? me.x, chars.get(f.id)?.z ?? me.z, 0xffc83d, 6); }
  else if (f.k === 'pow') {
    const names = { 2: 'Early-payoff discount: −$600 off your payback!', 3: 'Legal shield! Immune to notices for 8s.', 4: 'Holdback holiday! Sweep drops to 40% for 10s (a reconciliation).' };
    burst(f.x, f.z, ORB_COL[f.pk], 18); if (f.id === myId) { toast(names[f.pk], 'good'); beep(700, 0.25, 'triangle', 0.05, 1100); }
  } else if (f.k === 'block') { addRing(f.x, f.z, 0x4cc9f0, 5); if (f.id === myId) { toast('Shield blocked a notice!', 'good'); beep(900, 0.1, 'square', 0.04); } }
  else if (f.k === 'free') toast(`${f.n} is DEBT-FREE — round over!`, 'good');
}

/* ---------- HUD & lobby ---------- */
function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
let lastBoard = 0, lastSec = 0;
function updateHud() {
  if (!snap) return;
  const nh = performance.now(); if (nh - lastHud < 90) return; lastHud = nh;
  $('#tval').textContent = fmtTime(snap.tl);
  $('#tbar').firstElementChild.style.width = (snap.tl / cfg.ROUND * 100) + '%'; $('#timer').classList.toggle('warn', snap.tl <= 30 && phase === 'play');
  const sec = Math.ceil(snap.tl); if (phase === 'play' && sec <= 10 && sec !== lastSec) beep(sec <= 3 ? 880 : 600, 0.08, 'square', 0.03); lastSec = sec;
  $('#b-shield').classList.toggle('hidden', !(me.shield > 0)); $('#b-cut').classList.toggle('hidden', !(me.cut > 0));
  $('#b-hb').textContent = Math.round(me.hb * (me.cut > 0 ? 0.4 : 1) * 100) + '%';
  $('#b-owed').textContent = money(me.owed); $('#b-cash').textContent = money(me.cash); $('#b-swept').textContent = money(me.swept);
  const pay = me.swept + (me.owed <= 0 ? 0 : 0); const total = me.swept + me.owed;
  $('#b-bar').style.width = (total ? (pay / total) * 100 : 0) + '%';
  $('#b-net').textContent = money(me.cash - me.owed); $('#b-net').className = me.cash - me.owed >= 0 ? 'green' : 'red';
  $('#b-boost').classList.toggle('hidden', !(me.boost > 0));
  $('#abBtn').classList.toggle('cd', me.surgeCd > 0); $('#abBtn').textContent = me.surgeCd > 0 ? Math.ceil(me.surgeCd) : 'SURGE';
  const now = performance.now(); if (now - lastBoard < 300) return; lastBoard = now;
  const rows = snap.p.map((a) => ({ id: a[0], owed: a[5], cash: a[6], net: a[6] - a[5] })).sort((a, b) => b.net - a.net);
  $('#board').innerHTML = '<h4 style="margin:0 0 4px;font-size:10px;letter-spacing:2px;color:#ffc83d">NET WORTH</h4>' + rows.map((r) => `<div class="brow ${r.id === myId ? 'me' : ''}"><span>${SKINS[roster.get(r.id)?.s || 0].e} ${roster.get(r.id)?.n || ''}</span><b>${money(r.net)}</b></div>`).join('');
}
function rankHtml(xp, lv) {
  const R = RANKS[lv], N = RANKS[lv + 1], pct = N ? Math.round((xp - R.xp) / (N.xp - R.xp) * 100) : 100;
  const unlocked = RANKS.slice(1, lv + 1).map((r) => `${r.i} ${r.perk}`).join(' · ');
  return `<b>${R.i} ${R.n.toUpperCase()}</b> <span style="float:right">${xp} XP</span>
    <div class="bar" style="margin:6px 0"><i style="width:${pct}%;background:linear-gradient(90deg,#ffc83d,#fff1b5)"></i></div>
    <div style="font-size:12px;color:#c9c3a6">${N ? `Next: ${N.i} <b>${N.n}</b> at ${N.xp} XP — ${N.perk}` : 'Maximum rank reached. You are the Top Rep.'}</div>
    ${unlocked ? `<div style="margin-top:4px;font-size:11px;color:#c9c3a6">Perks: ${unlocked}</div>` : ''}`;
}
function renderLobby() {
  const mr = roster.get(myId); if (mr) { $('#rankCard').innerHTML = rankHtml(mr.xp || 0, mr.lv || 0); $('#b-rank').textContent = RANKS[mr.lv || 0].i + ' ' + RANKS[mr.lv || 0].n; }
  $('#roster').innerHTML = [...roster.values()].map((p) => `<div class="pl"><span>${SKINS[p.s].e}</span>${p.lv ? RANKS[p.lv].i + ' ' : ''}${p.n}${p.id === myId ? ' (you)' : ''}<em>${p.id === hostId ? 'HOST' : ''}</em></div>`).join('');
  $('#seatN').textContent = cfgS.seats; $('#botTgl').checked = cfgS.bots;
  const isHost = hostId === myId; for (const id of ['#seatDn', '#seatUp', '#botTgl']) $(id).disabled = !isHost;
  $('#seatDn').disabled = !isHost || cfgS.seats <= Math.max(2, [...roster.values()].filter((p) => !p.b).length); $('#seatUp').disabled = !isHost || cfgS.seats >= 8;
  const host = hostId === myId; $('#startBtn').classList.toggle('hidden', !host); $('#waitMsg').classList.toggle('hidden', host);
  $('#shareLink').value = location.origin + '/?m=' + code;
}
function buildSkins() {
  $('#skins').innerHTML = SKINS.map((s, i) => `<div class="skin ${i === mySkin ? 'sel' : ''}" data-i="${i}" title="${s.n}">${s.e}</div>`).join('');
  $('#skins').querySelectorAll('.skin').forEach((el) => el.onclick = () => { mySkin = +el.dataset.i; localStorage.setItem('frf_skin', mySkin); buildSkins(); room?.send('prof', { name: myName, skin: mySkin }); });
}
$('#qBtn').title = 'Graphics quality (tap to change)';
$('#qBtn').onclick = async () => { const qb = $('#qBtn'); qb.disabled = true; qb.textContent = '⚙ …'; await setQuality({ low: 'high', high: 'ultra', ultra: 'low' }[QUAL]); };
$('#seatDn').onclick = () => room?.send('cfg', { seats: cfgS.seats - 1, bots: cfgS.bots });
$('#seatUp').onclick = () => room?.send('cfg', { seats: cfgS.seats + 1, bots: cfgS.bots });
$('#botTgl').onchange = () => room?.send('cfg', { seats: cfgS.seats, bots: $('#botTgl').checked });
$('#startBtn').onclick = () => room?.send('start');
$('#copyBtn').onclick = async () => {
  const url = $('#shareLink').value;
  try { if (navigator.share && touch) await navigator.share({ title: 'Factor Rate Frenzy', text: 'Join my match!', url }); else { await navigator.clipboard.writeText(url); } $('#copyBtn').textContent = 'COPIED ✓'; } catch { $('#shareLink').select(); }
  setTimeout(() => $('#copyBtn').textContent = 'COPY LINK', 1800);
};
$('#resBtn').onclick = () => { $('#results').classList.add('hidden'); if (phase === 'lobby') $('#lobby').classList.remove('hidden'); };

function onResults(m) {
  $('#hud').classList.add('hidden');
  const my = m.res.find((r) => r.id === myId);
  const apr = (r) => { const cost = r.payback - r.advance, frac = Math.max(0.02, r.swept / r.payback), days = r.cleared || m.dur / frac; return Math.min(9999, (cost / r.advance) * 365 / days * 100); };
  const rank = m.res.findIndex((r) => r.id === myId) + 1;
  $('#resTitle').textContent = my?.cleared ? '🎉 DEBT-FREE!' : rank === 1 ? '🏆 YOU WIN' : 'ROUND OVER';
  $('#resList').innerHTML = m.res.map((r, i) => `<div class="pl"><span>${i + 1}.</span><span>${SKINS[r.s].e}</span>${r.n}${r.id === myId ? ' (you)' : ''}<em>${r.cleared ? 'DEBT-FREE' : ''}${r.stacks ? ' · stacked ×' + r.stacks : ''}</em><b>${money(r.net)}</b></div>`).join('');
  if (my) {
    const cost = my.payback - my.advance, a = Math.round(apr(my));
    $('#resLesson').innerHTML = `<b>Your books:</b> advance ${money(my.advance)} → payback ${money(my.payback)} (cost ${money(cost)}, ${(my.payback / my.advance).toFixed(2)}× blended factor).<br>` +
      `<b>Effective APR ≈ ${a.toLocaleString()}%.</b> A factor rate isn't an interest rate — the faster you repay a fixed fee, the higher the APR.` +
      (my.stacks ? `<br><b>You stacked ${my.stacks}×:</b> extra cash cost you ${money(my.stacks * Math.round(cfg.STACK_ADV * cfg.STACK_FACTOR - cfg.STACK_ADV))} more in fees and a bigger holdback.` : `<br><b>No stacking</b> — you kept the cost fixed at ${money(cost)}.`);
  }
  $('#resXp').classList.add('hidden'); $('#results').classList.remove('hidden'); $('#lobby').classList.add('hidden');
  beep(520, 0.25, 'triangle', 0.05, 780);
}
function onXp(x) {
  const lvl = RANKS[x.lv], next = RANKS[x.lv + 1];
  $('#resXp').innerHTML = `<b>EXPERIENCE +${x.gain} XP</b><br>` + x.parts.map((p) => `${p[0]}: <b>+${p[1]}</b>`).join('<br>') +
    `<br><br>${x.up ? `<b>🎉 RANK UP! You are now ${lvl.i} ${lvl.n}</b> — ${lvl.perk}<br>` : ''}Rank: ${lvl.i} ${lvl.n} · ${x.xp} XP${next ? ` · ${next.xp - x.xp} XP to ${next.n}` : ''}`;
  $('#resXp').classList.remove('hidden');
  if (x.up) beep(600, 0.5, 'triangle', 0.06, 1200);
}
function showMsg(t, p) { $('#msgT').textContent = t; $('#msgP').textContent = p; $('#msg').classList.remove('hidden'); }

/* ---------- gate ---------- */
async function afterGate() {
  $('#gate').classList.add('hidden'); buildSkins();
  $('#lobbyTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  $('#lobby').classList.remove('hidden');
  await connect();
}
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const name = $('#gName').value.trim(), email = $('#gEmail').value.trim();
  $('#gErr').textContent = ''; $('#gBtn').disabled = true;
  try {
    const r = await fetch('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, ref: document.referrer ? new URL(document.referrer).hostname : '' }) });
    if (!r.ok) throw new Error();
    localStorage.setItem('frf_lead', JSON.stringify({ name, email })); myName = name; afterGate();
  } catch { $('#gErr').textContent = 'Please enter a valid name and email.'; $('#gBtn').disabled = false; }
});
function proceed() {
  $('#intro').classList.add('hidden'); beep(520, 0.12, 'triangle', 0.04, 780);
  try { const l = JSON.parse(localStorage.getItem('frf_lead') || 'null'); if (l?.email) { myName = l.name; afterGate(); } else $('#gate').classList.remove('hidden'); } catch { $('#gate').classList.remove('hidden'); }
}
$('#playBtn').onclick = proceed;
if (sessionStorage.getItem('frf_skipintro')) { sessionStorage.removeItem('frf_skipintro'); proceed(); }

/* ---------- main loop ---------- */
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); if (composer && bloom) { composer.setPixelRatio(dpr); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2); }
  camera.aspect = w / h; camera.fov = w / h < 1 ? 70 : 50; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const aimLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 15).rotateX(-Math.PI / 2).translate(0, 0, 8.5), new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.55, depthWrite: false }));
aimLine.position.y = 0.12; aimLine.visible = false; scene.add(aimLine);
let frameN = 0, hqRing = null, ema = 16, adaptT = 0;
const clock = new THREE.Clock(); let t = 0;
const camPos = new THREE.Vector3(0, 30, 20);
const mini = $('#mini'), mg = mini.getContext('2d');
function drawMini() {
  if (!snap || phase !== 'play') return;
  const W = mini.width, S = W / (ARENA * 2 + 4), X = (x) => (x + ARENA + 2) * S, Z = (z) => (z + ARENA + 2) * S;
  mg.clearRect(0, 0, W, W);
  mg.fillStyle = 'rgba(40,46,70,.9)'; mg.fillRect(X(-ARENA), Z(-ARENA), ARENA * 2 * S, ARENA * 2 * S);
  for (const b of SHOPS) { mg.fillStyle = b.hq ? '#ff3d4d' : '#' + b.color.toString(16).padStart(6, '0'); mg.globalAlpha = b.label ? 0.9 : 0.5; mg.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * S, b.d * S); }
  mg.globalAlpha = 1;
  for (const o of snap.o) { mg.fillStyle = '#' + (ORB_COL[o[4]] || 0xffc83d).toString(16).padStart(6, '0'); const r = o[4] ? 7 : 3.2; mg.beginPath(); mg.arc(X(o[1]), Z(o[2]), r, 0, 6.3); mg.fill(); if (o[4]) { mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.stroke(); } }
  for (const b of snap.b) { mg.fillStyle = '#fff'; mg.fillRect(X(b[1]) - 2, Z(b[2]) - 2, 4, 4); }
  for (const a of snap.p) {
    const isMe = a[0] === myId, x = isMe ? me.x : a[1], z = isMe ? me.z : a[2], ang = isMe ? me.ang : a[3];
    mg.save(); mg.translate(X(x), Z(z)); mg.rotate(-ang + Math.PI); mg.fillStyle = isMe ? '#ffc83d' : roster.get(a[0])?.b ? '#8892b0' : '#ffffff';
    mg.beginPath(); mg.moveTo(0, 10); mg.lineTo(7, -7); mg.lineTo(-7, -7); mg.closePath(); mg.fill(); mg.restore();
  }
}
function frame() {
  const rawDt = clock.getDelta(); const dt = Math.min(rawDt, 0.05); t += dt;
  ema += (rawDt * 1000 - ema) * 0.05; adaptT += rawDt;
  if (adaptT > 2.5) { adaptT = 0;
    if (ema > 34 && dpr <= 0.71 && QUAL !== 'low' && phase !== 'play' && dgCount < 2) { dgCount++; setQuality(QUAL === 'ultra' ? 'high' : 'low'); }
    if (ema > 26 && dpr > 0.7) { dpr = Math.max(0.7, dpr - 0.2); renderer.setPixelRatio(dpr); resize(); }
    else if (ema < 15 && dpr < dprMax) { dpr = Math.min(dprMax, dpr + 0.15); renderer.setPixelRatio(dpr); resize(); } }
  // local movement
  const playing = phase === 'play' || phase === 'lobby';
  if (room && playing) {
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp) mz -= 1; if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
    mx += stick.L.x; mz += stick.L.y;
    if (!touch) {
      ray.setFromCamera(mouseNdc, camera);
      if (ray.ray.intersectPlane(plane, hitP)) {
        if (rightDown) { const dx = hitP.x - me.x, dz = hitP.z - me.z, d = Math.hypot(dx, dz); if (d > 1.2) { mx += dx / d; mz += dz / d; } }
      }
    }
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const spd = me.stun > 0 ? 0 : cfg.SPEED * perks(myLv()).speed * (me.surge > 0 ? 1.5 : 1), ea = 1 - Math.exp(-15 * dt);
    mvx += (mx * spd - mvx) * ea; mvz += (mz * spd - mvz) * ea;
    let r = resolve(me.x + mvx * dt, me.z, 0.9); me.x = r.x; me.z = r.z;
    r = resolve(me.x, me.z + mvz * dt, 0.9); me.x = r.x; me.z = r.z;
    // aim
    const sr = stick.R; wantFire = false;
    if (sr.id !== null && Math.hypot(sr.x, sr.y) > 0.25) { me.ang = Math.atan2(sr.x, sr.y); }
    else if (!touch) {
      ray.setFromCamera(mouseNdc, camera);
      if (ray.ray.intersectPlane(plane, hitP)) me.ang = Math.atan2(hitP.x - me.x, hitP.z - me.z);
    } else if (l > 0.2) me.ang = Math.atan2(mx, mz);
    if (phase !== 'play') wantFire = false;
  }
  { const show = phase === 'play' && me.stun <= 0 && (!touch || stick.R.id !== null); aimLine.visible = show;
    if (show) { aimLine.position.x = me.x; aimLine.position.z = me.z; aimLine.rotation.y = me.ang; const rdy = performance.now() - lastFire >= 600; aimLine.material.color.set(rdy ? 0xffc83d : 0x777777); aimLine.material.opacity = rdy ? 0.6 : 0.25; } }
  // my character
  if (myId && roster.has(myId)) {
    const c = ensureChar(myId); c.g.visible = true;
    c.x = me.x; c.z = me.z; { let da = me.ang - c.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); c.ang += da * (1 - Math.exp(-22 * dt)); } c.stun = me.stun; c.surge = me.surge; c.boost = me.boost;
  }
  // others: snapshot interpolation (rendered slightly in the past for smooth motion)
  const rtNow = performance.now() - interp;
  for (const [id, c] of chars) {
    if (id !== myId && c.buf && sampleBuf(c.buf, rtNow, _smp)) { c.x = _smp.x; c.z = _smp.z; c.ang = _smp.ang; }
    c.g.position.set(c.x, (c.stun > 0 ? 0 : Math.abs(Math.sin(t * 9 + c.x)) * 0.0), c.z);
    c.g.rotation.y = c.ang;
    c.g.rotation.z = c.stun > 0 ? Math.sin(t * 30) * 0.2 : 0;
    c.aura.visible = c.surge > 0;
    c.bubble.visible = (id === myId ? me.shield : c.shield) > 0;
    const mv = Math.hypot(c.x - (c.px ?? c.x), c.z - (c.pz ?? c.z)) / Math.max(dt, 1e-3); c.px = c.x; c.pz = c.z; c.walk = (c.walk || 0) + (Math.min(1, mv / 5) - (c.walk || 0)) * 0.25;
    const sw = Math.sin(t * 13 + (c.seed ??= Math.random() * 6)) * c.walk * 0.9; c.g.userData.legs[0].rotation.x = sw; c.g.userData.legs[1].rotation.x = -sw; c.g.children[0].position.y = 1.15 + Math.abs(sw) * 0.06; c.g.userData.arms[0].rotation.x = -sw * 0.8; c.g.userData.arms[1].rotation.x = -1.25 + Math.sin(t * 2 + (c.seed || 0)) * 0.04;
    const ring = c.ringM; ring.material.color.set(id === myId ? 0xffc83d : roster.get(id)?.b ? 0x8892b0 : 0xffffff);
    if (c.flash > 0) { c.flash -= dt; c.g.scale.setScalar(CHAR_SCALE * (1 + c.flash * 0.5)); } else c.g.scale.setScalar(CHAR_SCALE);
    if (c.boost > 0) { c.g.children[0].material.emissive?.set(0x550022); } else c.g.children[0].material.emissive?.set(0x000000);
  }
  for (const m of orbMeshes.values()) { const s = m.getObjectByName('spin'); s.rotation.y += dt * 3; s.position.y = (m.userData.k >= 1 ? 1.7 : 1.1) + Math.sin(t * 3 + m.position.x) * 0.2; if (m.userData.k >= 1) { s.rotation.x += dt * 1.2; const h = m.getObjectByName('halo'); h.scale.setScalar(1 + Math.sin(t * 4) * 0.12); } }
  for (const m of bulletMeshes.values()) { m.rotation.y += dt * 14; if (m.userData.tx !== undefined) {
    const u = m.userData, ahead = (performance.now() - u.st) / 1000, vx = Math.sin(u.ang) * 22, vz = Math.cos(u.ang) * 22;
    m.position.x += vx * dt; m.position.z += vz * dt;
    const k = 1 - Math.exp(-10 * dt); m.position.x += (u.tx + vx * ahead - m.position.x) * k; m.position.z += (u.tz + vz * ahead - m.position.z) * k; } }
  for (let i = fxList.length - 1; i >= 0; i--) { const f = fxList[i]; if (f.p) { f.t += dt * 1.8; f.vy -= 22 * dt; f.m.position.x += f.vx * dt; f.m.position.y = Math.max(0.1, f.m.position.y + f.vy * dt); f.m.position.z += f.vz * dt; f.m.material.opacity = Math.max(0, 1 - f.t); if (f.t >= 1) { scene.remove(f.m); f.m.material.dispose(); fxList.splice(i, 1); } continue; } f.t += dt * 2.2; f.m.scale.setScalar(1 + f.t * f.max); f.m.material.opacity = Math.max(0, 1 - f.t); if (f.t >= 1) { scene.remove(f.m); fxList.splice(i, 1); } }
  { const p = confGeo.attributes.position.array; for (let i = 0; i < CONF; i++) { p[i * 3 + 1] += dt * (0.6 + (i % 5) * 0.25); p[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.5; if (p[i * 3 + 1] > 14) p[i * 3 + 1] = 0.3; } confGeo.attributes.position.needsUpdate = true; }
  if (!hqRing) hqRing = scene.getObjectByName('hqRing'); if (hqRing) hqRing.rotation.y += dt * 2;
  if (QUAL !== 'low') { sun.position.set(me.x - 30, 50, me.z + 20); sun.target.position.set(me.x, 0, me.z); }
  // camera
  if (!room) { const a = t * 0.12; camPos.set(Math.cos(a) * 52, 26 + Math.sin(t * 0.3) * 3, Math.sin(a) * 52); camera.position.copy(camPos); camera.lookAt(0, 4, 0); if (composer && QUAL !== 'low') composer.render(); else renderer.render(scene, camera); requestAnimationFrame(frame); return; }
  const back = camera.aspect < 1 ? 1.15 : 0, tgt = _tgt.set(me.x * 0.9, 27 + back * 8, me.z * 0.9 + 16 + back * 6);
  camPos.lerp(tgt, 1 - Math.exp(-6 * dt)); camera.position.copy(camPos); camera.lookAt(camPos.x * 0.98, 0, camPos.z - (16 + back * 6) * 0.98);
  if ((frameN++ % 3) === 0) drawMini();
  if (composer && QUAL !== 'low') composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
await setQuality(QUAL);
{ // pre-compile every material (power-ups, notices, skins) so nothing hitches on first appearance
  const tmp = [0, 1, 2, 3, 4].map((k) => { const o = makeOrb(k, 800); scene.add(o); return o; });
  const bm = new THREE.Mesh(bulletGeo, bulletMat); scene.add(bm);
  const cs = SKINS.map((_, i) => { const g = makeChar(i); g.position.y = -50; scene.add(g); return g; });
  try { renderer.compile(scene, camera); } catch {}
  tmp.forEach((o) => scene.remove(o)); scene.remove(bm); cs.forEach((g) => scene.remove(g));
}
requestAnimationFrame(frame);
window.__frf = { me, get phase() { return phase; } };
