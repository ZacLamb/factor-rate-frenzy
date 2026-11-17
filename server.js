import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ARENA, resolve, RULES } from './public/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 2567;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
fs.mkdirSync(DATA_DIR, { recursive: true });
const LEADS = path.join(DATA_DIR, 'leads.jsonl');

/* ---------------- static + lead API ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const VENDOR = {
  '/vendor/three.module.js': 'node_modules/three/build/three.module.js',
  '/vendor/colyseus.js': 'node_modules/colyseus.js/dist/colyseus.js',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map();

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }

  if (url.pathname === '/api/lead' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
    setTimeout(() => hits.set(ip, Math.max(0, (hits.get(ip) || 1) - 1)), 60000);
    if (n > 20) { res.writeHead(429); res.end('{"ok":false}'); return; }
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const name = String(j.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
        const email = String(j.email || '').trim().toLowerCase().slice(0, 120);
        if (!name || !EMAIL_RE.test(email)) throw new Error('invalid');
        const row = { ts: new Date().toISOString(), name, email, ref: String(j.ref || '').slice(0, 60) };
        fs.appendFileSync(LEADS, JSON.stringify(row) + '\n');
        console.log('LEAD', JSON.stringify(row));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"invalid"}');
      }
    });
    return;
  }

  if (url.pathname === '/api/leads') {
    if (!ADMIN_KEY || url.searchParams.get('key') !== ADMIN_KEY) { res.writeHead(403); res.end('forbidden'); return; }
    const rows = fs.existsSync(LEADS) ? fs.readFileSync(LEADS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    res.writeHead(200, { 'content-type': 'text/csv' });
    res.end('timestamp,name,email,ref\n' + rows.map((r) => [r.ts, r.name, r.email, r.ref].map(esc).join(',')).join('\n'));
    return;
  }

  let file;
  if (VENDOR[url.pathname]) file = path.join(__dirname, VENDOR[url.pathname]);
  else {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    file = path.join(__dirname, 'public', rel);
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end(); return; }
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

/* ---------------- game room ---------------- */
const R = RULES;
const BOT_NAMES = ['Rapid Rick', 'Funding Fay', 'Net-30 Nate', 'ACH Annie', 'Bridge Bob'];
const rnd = (a, b) => a + Math.random() * (b - a);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, n);

class MatchRoom extends Room {
  maxClients = 8;

  onCreate(options) {
    this.code = options.code;
    this.players = new Map();
    this.orbs = []; this.bullets = [];
    this.phase = 'lobby'; this.tl = R.ROUND; this.elapsed = 0; this.resultsT = 0;
    this.nid = 1; this.ticks = 0; this.hostId = null; this.spawnT = 0; this.stackT = 6;

    this.onMessage('in', (c, m) => {
      const p = this.players.get(c.sessionId); if (!p || !m) return;
      if (Number.isFinite(m.x) && Number.isFinite(m.z)) { p.x = Math.max(-ARENA, Math.min(ARENA, m.x)); p.z = Math.max(-ARENA, Math.min(ARENA, m.z)); }
      if (Number.isFinite(m.a)) p.ang = m.a;
      p.fire = !!m.f;
    });
    this.onMessage('ab', (c) => { const p = this.players.get(c.sessionId); if (p) this.useSurge(p); });
    this.onMessage('start', (c) => { if (c.sessionId === this.hostId && this.phase === 'lobby') this.startRound(); });
    this.onMessage('prof', (c, m) => {
      const p = this.players.get(c.sessionId); if (!p || !m) return;
      p.name = clean(m.name, 14) || p.name; p.skin = Math.max(0, Math.min(5, m.skin | 0));
      this.sendRoster();
    });
    this.setSimulationInterval((dt) => this.update(Math.min(dt, 100) / 1000), 1000 / 30);
  }

  mkPlayer(id, name, skin, bot) {
    return { id, name, skin, bot, x: 0, z: 0, ang: 0, fire: false, stun: 0, immune: 0, fireCd: 0, surge: 0, surgeCd: 0, boost: 0,
      owed: 0, cash: 0, hb: 0, swept: 0, stacks: 0, advance: 0, payback: 0, cleared: 0, rethink: 0, tgt: null, greedy: false };
  }
  resetStats(p) {
    p.owed = Math.round(R.ADVANCE * R.FACTOR); p.cash = R.ADVANCE; p.hb = R.HOLDBACK; p.swept = 0; p.stacks = 0;
    p.advance = R.ADVANCE; p.payback = p.owed; p.cleared = 0; p.stun = 0; p.immune = 0; p.surge = 0; p.surgeCd = 0; p.boost = 0; p.fireCd = 0;
  }

  onJoin(client, options) {
    const p = this.mkPlayer(client.sessionId, clean(options?.name, 14) || 'Merchant', Math.max(0, Math.min(5, (options?.skin | 0))), false);
    this.resetStats(p);
    const a = Math.random() * 6.28; p.x = Math.cos(a) * 14; p.z = Math.sin(a) * 14;
    if (this.phase === 'play') { /* join in progress, fresh books */ }
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    client.send('spawn', { x: p.x, z: p.z });
    this.sendRoster();
  }
  onLeave(client) {
    this.players.delete(client.sessionId);
    if (this.hostId === client.sessionId) {
      const h = [...this.players.values()].find((q) => !q.bot);
      this.hostId = h ? h.id : null;
    }
    this.sendRoster();
  }

  sendRoster() {
    this.broadcast('roster', { host: this.hostId, code: this.code, p: [...this.players.values()].map((p) => ({ id: p.id, n: p.name, s: p.skin, b: p.bot ? 1 : 0 })) });
  }

  startRound() {
    for (const [id, p] of this.players) if (p.bot) this.players.delete(id);
    const humans = [...this.players.values()];
    const want = Math.max(0, 4 - humans.length);
    for (let i = 0; i < want; i++) {
      const b = this.mkPlayer('bot' + this.nid++, BOT_NAMES[i % BOT_NAMES.length], (i * 2 + 1) % 6, true);
      b.greedy = Math.random() < 0.35; this.players.set(b.id, b);
    }
    const all = [...this.players.values()];
    all.forEach((p, i) => {
      this.resetStats(p);
      const a = (i / all.length) * Math.PI * 2 + 0.4;
      const s = resolve(Math.cos(a) * 15, Math.sin(a) * 15, 1);
      p.x = s.x; p.z = s.z;
      const c = this.clients.find((c) => c.sessionId === p.id); if (c) c.send('spawn', { x: p.x, z: p.z });
    });
    this.orbs = []; this.bullets = []; this.tl = R.ROUND; this.elapsed = 0; this.stackT = 8;
    for (let i = 0; i < 26; i++) this.spawnOrb(0);
    this.phase = 'play';
    this.sendRoster();
    this.broadcast('fx', { k: 'start' });
  }

  spawnOrb(kind, x, z, v, noPick) {
    let ox = x, oz = z;
    if (ox === undefined) {
      for (let i = 0; i < 12; i++) {
        const tx = rnd(-ARENA + 3, ARENA - 3), tz = rnd(-ARENA + 3, ARENA - 3);
        const r = resolve(tx, tz, 2);
        if (Math.abs(r.x - tx) < 0.01 && Math.abs(r.z - tz) < 0.01) { ox = tx; oz = tz; break; }
      }
      if (ox === undefined) return;
    }
    this.orbs.push({ id: this.nid++, x: ox, z: oz, k: kind, v: v || Math.round(rnd(400, 1200) / 50) * 50, noPick, t: 0 });
  }

  useSurge(p) {
    if (this.phase !== 'play' || p.surgeCd > 0 || p.stun > 0) return;
    p.surge = 4; p.surgeCd = 12;
    this.broadcast('fx', { k: 'surge', id: p.id });
  }

  speedOf(p) { return p.stun > 0 ? 0 : R.SPEED * (p.surge > 0 ? 1.5 : 1); }

  collect(p, v, quiet) {
    const gross = Math.round(v * (p.boost > 0 ? 2 : 1));
    let sweep = 0;
    if (p.owed > 0) sweep = Math.min(p.owed, Math.round(gross * p.hb));
    p.owed -= sweep; p.swept += sweep; p.cash += gross - sweep;
    const c = this.clients.find((c) => c.sessionId === p.id);
    if (c && !quiet) c.send('gain', { g: gross, s: sweep, b: p.boost > 0 ? 1 : 0 });
    if (p.owed <= 0 && !p.cleared) {
      p.cleared = Math.max(1, Math.round(this.elapsed)); p.cash += 2000;
      this.broadcast('fx', { k: 'free', id: p.id, n: p.name });
      this.endRound(p.id);
    }
  }

  takeStack(p) {
    p.cash += R.STACK_ADV; p.owed += Math.round(R.STACK_ADV * R.STACK_FACTOR);
    p.payback += Math.round(R.STACK_ADV * R.STACK_FACTOR); p.advance += R.STACK_ADV;
    p.hb = Math.min(0.6, p.hb + R.STACK_HB); p.boost = 15; p.stacks++; p.cleared = 0;
    this.broadcast('fx', { k: 'stack', id: p.id, n: p.name, x: p.x, z: p.z });
  }

  update(dt) {
    this.ticks++;
    if (this.phase === 'play') this.updatePlay(dt);
    else if (this.phase === 'results') {
      this.resultsT -= dt;
      if (this.resultsT <= 0) {
        for (const [id, p] of this.players) if (p.bot) this.players.delete(id);
        this.phase = 'lobby'; this.orbs = []; this.bullets = [];
        for (const p of this.players.values()) this.resetStats(p);
        this.sendRoster();
      }
    } else {
      for (const p of this.players.values()) { p.stun = 0; }
    }
    if (this.ticks % 2 === 0) this.snapshot();
  }

  updatePlay(dt) {
    this.elapsed += dt; this.tl -= dt;
    this.spawnT -= dt; this.stackT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.55; if (this.orbs.filter((o) => o.k === 0).length < 34) this.spawnOrb(0); }
    if (this.stackT <= 0) { this.stackT = 11; if (this.orbs.filter((o) => o.k === 1).length < 2) this.spawnOrb(1, undefined, undefined, R.STACK_ADV); }

    const list = [...this.players.values()];
    for (const p of list) {
      p.stun = Math.max(0, p.stun - dt); p.immune = Math.max(0, p.immune - dt);
      p.fireCd = Math.max(0, p.fireCd - dt); p.surge = Math.max(0, p.surge - dt);
      p.surgeCd = Math.max(0, p.surgeCd - dt); p.boost = Math.max(0, p.boost - dt);
      p.acc = (p.acc || 0) + 20 * dt; if (p.acc >= 40) { const v = p.acc; p.acc = 0; this.collect(p, v, true); } // base card-sales trickle
      if (this.phase !== 'play') return;
      if (p.bot) this.botThink(p, list, dt);
      if (p.fire && p.fireCd <= 0 && p.stun <= 0) this.shoot(p);
    }
    for (const b of this.bullets) {
      b.x += b.vx * dt; b.z += b.vz * dt; b.ttl -= dt;
      const r = resolve(b.x, b.z, 0.1);
      if (Math.abs(r.x - b.x) > 0.001 || Math.abs(r.z - b.z) > 0.001) b.ttl = 0;
      for (const q of list) {
        if (q.id === b.owner || q.immune > 0) continue;
        const dx = q.x - b.x, dz = q.z - b.z;
        if (dx * dx + dz * dz < 1.3 * 1.3) { b.ttl = 0; this.hit(q, b); break; }
      }
    }
    this.bullets = this.bullets.filter((b) => b.ttl > 0);

    for (const o of this.orbs) {
      o.t += dt; if (o.noPick && o.t > 1.4) o.noPick = null;
      for (const q of list) {
        if (o.noPick === q.id) continue;
        const rad = 1.5 + (q.surge > 0 && o.k === 0 ? 5.5 : 0);
        const dx = q.x - o.x, dz = q.z - o.z, d2 = dx * dx + dz * dz;
        if (d2 < rad * rad) {
          if (q.surge > 0 && o.k === 0 && d2 > 2.4) { const d = Math.sqrt(d2); o.x += (dx / d) * 22 * dt; o.z += (dz / d) * 22 * dt; }
          else { o.dead = true; if (o.k === 1) this.takeStack(q); else this.collect(q, o.v); break; }
        }
      }
    }
    this.orbs = this.orbs.filter((o) => !o.dead);
    if (this.phase === 'play' && this.tl <= 0) this.endRound(null);
  }

  shoot(p) {
    p.fireCd = 0.5;
    this.bullets.push({ id: this.nid++, owner: p.id, x: p.x + Math.sin(p.ang) * 1.2, z: p.z + Math.cos(p.ang) * 1.2, vx: Math.sin(p.ang) * 34, vz: Math.cos(p.ang) * 34, ttl: 0.9 });
  }

  hit(q, b) {
    q.stun = 1.2; q.immune = 2.4;
    const drop = Math.min(q.cash, 1800);
    q.cash -= drop;
    const n = drop >= 600 ? 3 : drop > 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = rnd(1.5, 3);
      const t = resolve(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, 0.6);
      this.spawnOrb(0, t.x, t.z, Math.round(drop / n / 50) * 50, q.id);
    }
    this.broadcast('fx', { k: 'hit', id: q.id, by: b.owner, x: q.x, z: q.z, d: drop });
  }

  botThink(p, list, dt) {
    if (p.stun > 0) return;
    p.rethink -= dt;
    if (p.rethink <= 0 || !p.tgt || !this.orbs.includes(p.tgt)) {
      p.rethink = rnd(0.5, 1.1); let best = null, bd = 1e9;
      for (const o of this.orbs) {
        if (o.k === 1 && !p.greedy) continue;
        if (o.noPick === p.id) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z) - (o.k === 1 ? 6 : 0);
        if (d < bd) { bd = d; best = o; }
      }
      p.tgt = best;
    }
    let foe = null, fd = 16;
    for (const q of list) { if (q === p) continue; const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < fd) { fd = d; foe = q; } }
    let mx = 0, mz = 0;
    if (p.tgt) { const dx = p.tgt.x - p.x, dz = p.tgt.z - p.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; }
    else { mx = Math.sin(this.elapsed + p.x); mz = Math.cos(this.elapsed + p.z); }
    if (foe) { p.ang = Math.atan2(foe.x - p.x, foe.z - p.z) + rnd(-0.22, 0.22); p.fire = Math.random() < 0.06; }
    else { p.ang = Math.atan2(mx, mz); p.fire = false; }
    if (p.surgeCd <= 0 && Math.random() < 0.15 * dt * 3) this.useSurge(p);
    const sp = this.speedOf(p) * 0.82 * dt;
    const r = resolve(p.x + mx * sp, p.z + mz * sp, 0.9);
    if (Math.hypot(r.x - p.x - mx * sp, r.z - p.z - mz * sp) > sp * 0.5) { p.rethink = 0; p.tgt = null; }
    p.x = r.x; p.z = r.z;
  }

  endRound(winnerId) {
    if (this.phase !== 'play') return;
    this.phase = 'results'; this.resultsT = 16;
    const res = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, s: p.skin, b: p.bot ? 1 : 0, net: p.cash - p.owed, cash: p.cash, owed: p.owed, swept: p.swept,
      stacks: p.stacks, advance: p.advance, payback: p.payback, cleared: p.cleared,
    }));
    res.sort((a, b) => (a.cleared && b.cleared ? a.cleared - b.cleared : a.cleared ? -1 : b.cleared ? 1 : b.net - a.net));
    this.broadcast('results', { res, dur: Math.round(this.elapsed), winner: winnerId });
  }

  snapshot() {
    const r2 = (n) => Math.round(n * 100) / 100;
    this.broadcast('snap', {
      ph: this.phase, tl: Math.max(0, Math.round(this.tl * 10) / 10),
      p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.z), r2(p.ang), r2(p.stun), p.owed, p.cash, r2(p.hb), r2(p.boost), r2(p.surge), r2(p.surgeCd), p.swept, p.stacks]),
      o: this.orbs.map((o) => [o.id, r2(o.x), r2(o.z), o.v, o.k]),
      b: this.bullets.map((b) => [b.id, r2(b.x), r2(b.z), r2(Math.atan2(b.vx, b.vz))]),
    });
  }
}

const server = http.createServer(handler);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define('match', MatchRoom).filterBy(['code']);
gameServer.listen(Number(PORT)).then(() => console.log('Factor Rate Frenzy on :' + PORT));
