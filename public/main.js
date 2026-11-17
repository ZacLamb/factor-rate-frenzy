import * as THREE from 'three';
import { ARENA, SHOPS, resolve, RULES } from './shared.js';

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

/* ---------- state ---------- */
let room = null, myId = null, roster = new Map(), hostId = null, phase = 'lobby', snap = null;
let myName = '', mySkin = +localStorage.getItem('frf_skin') || 0, code = '';
const touch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (touch) document.body.classList.add('touch');
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
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: !touch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.75 : 2));
renderer.shadowMap.enabled = !touch; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f3a);
scene.fog = new THREE.Fog(0x1b1f3a, 70, 150);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);
scene.add(new THREE.HemisphereLight(0xbfd2ff, 0x2a2438, 0.9));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.2);
sun.position.set(-30, 50, 20); sun.castShadow = !touch;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 140 });
scene.add(sun);

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

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 40, ARENA * 2 + 40), new THREE.MeshStandardMaterial({
  roughness: 0.95, map: canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b2f3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = 'rgba(255,215,90,.5)'; g.lineWidth = 6; g.setLineDash([40, 30]);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  }),
}));
ground.material.map.wrapS = ground.material.map.wrapT = THREE.RepeatWrapping; ground.material.map.repeat.set(4, 4);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// arena plaza
const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.9 }));
plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true; scene.add(plaza);
// walls
const wallM = new THREE.MeshStandardMaterial({ color: 0x4a4f6a, roughness: 0.8 });
for (const [x, z, w, d] of [[0, -ARENA - 1, ARENA * 2 + 4, 2], [0, ARENA + 1, ARENA * 2 + 4, 2], [-ARENA - 1, 0, 2, ARENA * 2], [ARENA + 1, 0, 2, ARENA * 2]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), wallM); m.position.set(x, 1.2, z); m.castShadow = true; scene.add(m);
}
// buildings
for (const b of SHOPS) {
  const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: b.hq ? 0.5 : 0 }));
  body.position.y = b.h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
  if (b.label) {
    const face = b.z > 0 ? -1 : 1; // sign faces the arena centre
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.85, b.hq ? 1.6 : 1.4), new THREE.MeshBasicMaterial({
      map: canvasTex(512, 96, (c, w, h) => { c.fillStyle = b.hq ? '#ff3d4d' : '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = b.hq ? '#fff' : '#222'; c.font = '900 56px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.label, w / 2, h / 2 + 3); }),
    }));
    for (const side of [1, -1]) {
      const s = sign.clone(); s.position.set(0, b.hq ? b.h - 2 : b.h - 1.3, side * (b.d / 2 + 0.05)); if (side < 0) s.rotation.y = Math.PI; g.add(s);
    }
    if (b.awning) {
      const aw = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.25, 2), new THREE.MeshStandardMaterial({ color: b.awning }));
      aw.position.set(0, 3.1, face * (b.d / 2 + 0.8)); aw.rotation.x = face * 0.25; aw.castShadow = true; g.add(aw);
    }
  }
  if (b.hq) { // spinning "coin" on top of lender tower
    const c = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.35, 12, 28), new THREE.MeshStandardMaterial({ color: 0xff3d4d, emissive: 0xff1030, emissiveIntensity: 1.2 }));
    c.position.y = b.h + 2; c.name = 'hqRing'; g.add(c);
  }
  scene.add(g);
}
// street lamps decoration
for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5), new THREE.MeshStandardMaterial({ color: 0x222 }));
  p.position.set(i * 32, 2.5, j * 6); scene.add(p);
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); l.position.set(i * 32, 5.2, j * 6); scene.add(l);
}

/* ---------- characters ---------- */
function makeChar(skin) {
  const k = SKINS[skin] || SKINS[0], g = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: k.body, roughness: 0.6 });
  const skinM = new THREE.MeshStandardMaterial({ color: 0xf1c6a0, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.7, 6, 14), bodyM); body.position.y = 1.15; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), skinM); head.position.y = 2.2; head.castShadow = true; g.add(head);
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
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x442200 })); gun.position.set(0.62, 1.35, 0.55); g.add(gun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = 'ring'; g.add(ring);
  const aura = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.5, 28), new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  aura.rotation.x = -Math.PI / 2; aura.position.y = 0.08; aura.visible = false; aura.name = 'aura'; g.add(aura);
  return g;
}
const chars = new Map(); // id -> {g, tx, tz, tang, ...}
function ensureChar(id) {
  let c = chars.get(id); const r = roster.get(id);
  if (c && r && c.skin === r.s && c.name === r.n) return c;
  if (c) scene.remove(c.g);
  const g = makeChar(r ? r.s : 0); const tag = textSprite(r ? r.n : '…', id === myId ? '#ffc83d' : '#fff', 4.2);
  tag.position.y = 3.6; g.add(tag); scene.add(g);
  c = { g, x: c?.x ?? 0, z: c?.z ?? 0, ang: c?.ang ?? 0, skin: r?.s, name: r?.n, flash: 0 };
  chars.set(id, c); return c;
}

/* ---------- orbs, bullets, fx ---------- */
const orbMeshes = new Map(), bulletMeshes = new Map(), fxList = [];
const coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.16, 22).rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.8, roughness: 0.25, emissive: 0x7a5200, emissiveIntensity: 0.6 });
function makeOrb(k, v) {
  const g = new THREE.Group();
  if (k === 1) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshStandardMaterial({ color: 0xff2e63, emissive: 0xff0a4a, emissiveIntensity: 1, metalness: 0.4, roughness: 0.3 }));
    m.position.y = 1.6; m.name = 'spin'; g.add(m);
    const s = textSprite('STACK?', '#ff8fa8', 3.4); s.position.y = 3.4; g.add(s);
    const l = new THREE.PointLight(0xff2e63, 2, 12); l.position.y = 1.5; g.add(l);
  } else {
    const m = new THREE.Mesh(coinGeo, coinMat); const sc = 0.75 + Math.min(v, 1500) / 1500 * 0.7; m.scale.setScalar(sc); m.position.y = 1.1; m.name = 'spin'; m.castShadow = !touch; g.add(m);
  }
  return g;
}
const bulletGeo = new THREE.BoxGeometry(0.55, 0.08, 0.75);
const bulletMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3344, emissiveIntensity: 0.6 });
function addRing(x, z, color = 0xff5d6c, max = 4) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 28), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.3, z); scene.add(m); fxList.push({ m, t: 0, max });
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
  keys[e.code] = true; if (e.code === 'Space') { e.preventDefault(); ability(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousemove', (e) => { mouseNdc = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 }; });
let rightDown = false;
addEventListener('contextmenu', (e) => { if (e.target.id === 'c') e.preventDefault(); });
$('#c').addEventListener('mousedown', (e) => { if (e.button === 2) rightDown = true; else mouseDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 2) rightDown = false; else mouseDown = false; });
function bindStick(name, el) {
  const s = stick[name];
  const set = (e) => { const r = el.getBoundingClientRect(); let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } s.x = dx; s.y = dy; el.firstElementChild.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; };
  el.addEventListener('pointerdown', (e) => { s.id = e.pointerId; el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === s.id) set(e); });
  const end = (e) => { if (e.pointerId === s.id) { s.id = null; s.x = s.y = 0; el.firstElementChild.style.transform = ''; } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
bindStick('L', $('#stickL')); bindStick('R', $('#stickR'));
$('#abBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); ability(); });
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
let wantFire = false;
function ability() { if (room && phase === 'play' && me.surgeCd <= 0 && me.stun <= 0) { room.send('ab'); beep(500, 0.2, 'sawtooth', 0.04, 900); } }

/* ---------- network ---------- */
function ws() { return location.origin.replace(/^http/, 'ws'); }
async function connect() {
  const params = new URLSearchParams(location.search);
  code = (params.get('m') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) { code = Math.random().toString(36).slice(2, 7).toUpperCase(); history.replaceState(null, '', '?m=' + code); }
  try {
    const client = new Colyseus.Client(ws());
    room = await client.joinOrCreate('match', { code, name: myName, skin: mySkin });
  } catch (e) { return showMsg('Could not join', 'This match is full or the server is busy. Try a new link.'); }
  myId = room.sessionId;
  room.onLeave(() => showMsg('Disconnected', 'Lost connection to the match.'));
  room.onMessage('roster', (m) => { hostId = m.host; roster = new Map(m.p.map((p) => [p.id, p])); renderLobby(); });
  room.onMessage('spawn', (m) => { me.x = m.x; me.z = m.z; });
  room.onMessage('snap', onSnap);
  room.onMessage('gain', (m) => {
    floatText(me.x, me.z, 3.2, '+' + money(m.g - m.s), m.b ? '#ff9bd2' : '#3ddc97');
    if (m.s > 0 && Math.random() < 0.5) floatText(me.x + 0.5, me.z, 2.2, '−' + money(m.s) + ' holdback', '#ff5d6c');
    beep(880 + Math.random() * 200, 0.07, 'triangle', 0.04);
  });
  room.onMessage('fx', onFx);
  room.onMessage('results', onResults);
  setInterval(sendInput, 50);
}
function sendInput() { if (room) room.send('in', { x: +me.x.toFixed(2), z: +me.z.toFixed(2), a: +me.ang.toFixed(3), f: wantFire }); }
function onSnap(s) {
  const prev = phase; snap = s; phase = s.ph;
  const seen = new Set();
  for (const a of s.p) {
    const id = a[0]; seen.add(id);
    if (id === myId) { Object.assign(me, { stun: a[4], owed: a[5], cash: a[6], hb: a[7], boost: a[8], surge: a[9], surgeCd: a[10], swept: a[11] }); continue; }
    const c = ensureChar(id); c.tx = a[1]; c.tz = a[2]; c.tang = a[3]; c.stun = a[4]; c.surge = a[9]; c.boost = a[8];
    if (c.x === 0 && c.z === 0) { c.x = a[1]; c.z = a[2]; }
  }
  for (const id of [...chars.keys()]) if (!seen.has(id) && id !== myId) { scene.remove(chars.get(id).g); chars.delete(id); }
  const live = new Set();
  for (const o of s.o) {
    live.add(o[0]); let m = orbMeshes.get(o[0]);
    if (!m) { m = makeOrb(o[4], o[3]); scene.add(m); orbMeshes.set(o[0], m); m.userData.born = performance.now(); }
    m.position.x = o[1]; m.position.z = o[2];
  }
  for (const [id, m] of orbMeshes) if (!live.has(id)) { scene.remove(m); orbMeshes.delete(id); }
  const lb = new Set();
  for (const b of s.b) {
    lb.add(b[0]); let m = bulletMeshes.get(b[0]);
    if (!m) { m = new THREE.Mesh(bulletGeo, bulletMat); m.position.y = 1.4; scene.add(m); bulletMeshes.set(b[0], m); m.position.set(b[1], 1.4, b[2]); m.userData.fresh = true; }
    m.userData.tx = b[1]; m.userData.tz = b[2]; m.rotation.y = b[3];
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
  if (phase === 'play') { $('#results').classList.add('hidden'); $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden'); showBanner('PAY OFF YOUR ADVANCE FIRST', 'You owe $6,750. Grab coins — 25% of each is swept to the lender. First to $0 wins, otherwise highest net worth at 0:00. Avoid the red STACK pods.'); beep(660, 0.3, 'square', 0.04, 990); }
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
  else if (f.k === 'free') toast(`${f.n} is DEBT-FREE — round over!`, 'good');
}

/* ---------- HUD & lobby ---------- */
function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
let lastBoard = 0;
function updateHud() {
  if (!snap) return;
  $('#tval').textContent = fmtTime(snap.tl);
  $('#b-owed').textContent = money(me.owed); $('#b-cash').textContent = money(me.cash); $('#b-swept').textContent = money(me.swept);
  $('#b-hb').textContent = Math.round(me.hb * 100) + '%';
  const pay = me.swept + (me.owed <= 0 ? 0 : 0); const total = me.swept + me.owed;
  $('#b-bar').style.width = (total ? (pay / total) * 100 : 0) + '%';
  $('#b-net').textContent = money(me.cash - me.owed); $('#b-net').className = me.cash - me.owed >= 0 ? 'green' : 'red';
  $('#b-boost').classList.toggle('hidden', !(me.boost > 0));
  $('#abBtn').classList.toggle('cd', me.surgeCd > 0); $('#abBtn').textContent = me.surgeCd > 0 ? Math.ceil(me.surgeCd) : 'SURGE';
  const now = performance.now(); if (now - lastBoard < 300) return; lastBoard = now;
  const rows = snap.p.map((a) => ({ id: a[0], owed: a[5], cash: a[6], net: a[6] - a[5] })).sort((a, b) => b.net - a.net);
  $('#board').innerHTML = '<h4 style="margin:0 0 4px;font-size:10px;letter-spacing:2px;color:#ffc83d">NET WORTH</h4>' + rows.map((r) => `<div class="brow ${r.id === myId ? 'me' : ''}"><span>${SKINS[roster.get(r.id)?.s || 0].e} ${roster.get(r.id)?.n || ''}</span><b>${money(r.net)}</b></div>`).join('');
}
function renderLobby() {
  $('#roster').innerHTML = [...roster.values()].map((p) => `<div class="pl"><span>${SKINS[p.s].e}</span>${p.n}${p.id === myId ? ' (you)' : ''}<em>${p.id === hostId ? 'HOST' : ''}</em></div>`).join('');
  const host = hostId === myId; $('#startBtn').classList.toggle('hidden', !host); $('#waitMsg').classList.toggle('hidden', host);
  $('#shareLink').value = location.origin + '/?m=' + code;
}
function buildSkins() {
  $('#skins').innerHTML = SKINS.map((s, i) => `<div class="skin ${i === mySkin ? 'sel' : ''}" data-i="${i}" title="${s.n}">${s.e}</div>`).join('');
  $('#skins').querySelectorAll('.skin').forEach((el) => el.onclick = () => { mySkin = +el.dataset.i; localStorage.setItem('frf_skin', mySkin); buildSkins(); room?.send('prof', { name: myName, skin: mySkin }); });
}
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
  $('#results').classList.remove('hidden'); $('#lobby').classList.add('hidden');
  beep(520, 0.25, 'triangle', 0.05, 780);
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
try { const l = JSON.parse(localStorage.getItem('frf_lead') || 'null'); if (l?.email) { myName = l.name; afterGate(); } else $('#gate').classList.remove('hidden'); } catch { $('#gate').classList.remove('hidden'); }

/* ---------- main loop ---------- */
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w / h < 1 ? 70 : 50; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); let t = 0;
const camPos = new THREE.Vector3(0, 30, 20);
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
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
    const sp = (me.stun > 0 ? 0 : cfg.SPEED * (me.surge > 0 ? 1.5 : 1)) * dt;
    let r = resolve(me.x + mx * sp, me.z, 0.9); me.x = r.x; me.z = r.z;
    r = resolve(me.x, me.z + mz * sp, 0.9); me.x = r.x; me.z = r.z;
    // aim
    const sr = stick.R; wantFire = false;
    if (sr.id !== null && Math.hypot(sr.x, sr.y) > 0.25) { me.ang = Math.atan2(sr.x, sr.y); wantFire = true; }
    else if (!touch) {
      ray.setFromCamera(mouseNdc, camera);
      if (ray.ray.intersectPlane(plane, hitP)) me.ang = Math.atan2(hitP.x - me.x, hitP.z - me.z);
      wantFire = mouseDown;
    } else if (l > 0.2) me.ang = Math.atan2(mx, mz);
    if (phase !== 'play') wantFire = false;
  }
  // my character
  if (myId && roster.has(myId)) {
    const c = ensureChar(myId); c.g.visible = true;
    c.x = me.x; c.z = me.z; c.ang = me.ang; c.stun = me.stun; c.surge = me.surge; c.boost = me.boost;
  }
  // others: smooth
  for (const [id, c] of chars) {
    if (id !== myId && c.tx !== undefined) {
      const k = 1 - Math.exp(-14 * dt); c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k;
      let da = c.tang - c.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); c.ang += da * k;
    }
    c.g.position.set(c.x, (c.stun > 0 ? 0 : Math.abs(Math.sin(t * 9 + c.x)) * 0.0), c.z);
    c.g.rotation.y = c.ang;
    c.g.rotation.z = c.stun > 0 ? Math.sin(t * 30) * 0.2 : 0;
    c.g.getObjectByName('aura').visible = c.surge > 0;
    const ring = c.g.getObjectByName('ring'); ring.material.color.set(id === myId ? 0xffc83d : roster.get(id)?.b ? 0x8892b0 : 0xffffff);
    if (c.flash > 0) { c.flash -= dt; c.g.scale.setScalar(1 + c.flash * 0.5); } else c.g.scale.setScalar(1);
    if (c.boost > 0) { c.g.children[0].material.emissive?.set(0x550022); } else c.g.children[0].material.emissive?.set(0x000000);
  }
  for (const m of orbMeshes.values()) { const s = m.getObjectByName('spin'); s.rotation.y += dt * 3; s.position.y = (s.geometry.type === 'OctahedronGeometry' ? 1.6 : 1.1) + Math.sin(t * 3 + m.position.x) * 0.2; }
  for (const m of bulletMeshes.values()) { if (m.userData.tx !== undefined) { const k = 1 - Math.exp(-35 * dt); m.position.x += (m.userData.tx - m.position.x) * k; m.position.z += (m.userData.tz - m.position.z) * k; } }
  for (let i = fxList.length - 1; i >= 0; i--) { const f = fxList[i]; f.t += dt * 2.2; f.m.scale.setScalar(1 + f.t * f.max); f.m.material.opacity = Math.max(0, 1 - f.t); if (f.t >= 1) { scene.remove(f.m); fxList.splice(i, 1); } }
  const ring = scene.getObjectByName('hqRing'); if (ring) ring.rotation.y += dt * 2;
  // camera
  const back = camera.aspect < 1 ? 1.15 : 0, tgt = new THREE.Vector3(me.x * 0.9, 30 + back * 8, me.z * 0.9 + 19 + back * 6);
  camPos.lerp(tgt, 1 - Math.exp(-6 * dt)); camera.position.copy(camPos); camera.lookAt(camPos.x * 0.98, 0, camPos.z - (19 + back * 6) * 0.98);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__frf = { me, get phase() { return phase; } };
