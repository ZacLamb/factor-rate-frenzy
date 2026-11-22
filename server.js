import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { Server, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ARENA, resolve, RULES, RANKS, levelFor, perks, MAPS } from './public/shared.js';
import { makeStore, checkName, checkEmailStatic, domainCanReceive, sha, token } from './leads.js';
import { mailerEnabled, sendMail, confirmEmail, recapEmail, BASE } from './mail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 2567;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- static + lead API ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const VENDOR = {
  '/vendor/three.module.js': 'node_modules/three/build/three.module.js',
  '/vendor/colyseus.js': 'node_modules/colyseus.js/dist/colyseus.js',
};
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);
const DB_URL = process.env.DATABASE_URL;
const pool = DB_URL ? new pg.Pool({ connectionString: DB_URL, ssl: /railway\.internal|localhost/.test(DB_URL) ? false : { rejectUnauthorized: false } }) : null;
const store = makeStore(pool, DATA_DIR);
store.init().then(() => console.log('leads store ready')).catch((e) => console.error('leads init failed', e.message));
const SALT = process.env.IP_SALT || ADMIN_KEY || 'frf';
const PROG = path.join(DATA_DIR, 'progress.json');
if (pool) pool.query(`CREATE TABLE IF NOT EXISTS progress (pid TEXT PRIMARY KEY, name TEXT, xp INT NOT NULL DEFAULT 0, matches INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now())`)
  .then(() => pool.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS wins INT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS streak INT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS last_day TEXT, ADD COLUMN IF NOT EXISTS wk TEXT, ADD COLUMN IF NOT EXISTS wxp INT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS daily TEXT`))
  .catch((e) => console.error('progress init', e.message));
const readProg = () => { try { return JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch { return {}; } };

const dayKey = (off = 0) => new Date(Date.now() - off * 864e5).toISOString().slice(0, 10);
const weekKey = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const MISSIONS = [
  { id: 'hits', t: 'Hit 6 rivals with notices', target: 6, xp: 40 }, { id: 'coins', t: 'Collect 25 coins', target: 25, xp: 40 },
  { id: 'wins', t: 'Finish a match in 1st place', target: 1, xp: 50 }, { id: 'matches', t: 'Play 3 matches', target: 3, xp: 30 },
  { id: 'nostack', t: 'Finish a match without stacking', target: 1, xp: 30 }, { id: 'power', t: 'Grab 3 power-ups', target: 3, xp: 35 },
  { id: 'free', t: 'Go debt-free once', target: 1, xp: 60 },
];
function missionsFor(day) {
  let h = 7; for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = [...MISSIONS], out = [];
  while (out.length < 3) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; out.push(pool.splice((h >>> 8) % pool.length, 1)[0]); }
  return out;
}
const blankProfile = () => ({ xp: 0, matches: 0, wins: 0, streak: 0, last_day: '', wk: '', wxp: 0, daily: { day: '', prog: {}, done: [] } });
async function loadProfile(pid) {
  const pf = blankProfile(); if (!pid) return pf;
  try {
    let r;
    if (pool) r = (await pool.query('SELECT xp, matches, wins, streak, last_day, wk, wxp, daily FROM progress WHERE pid=$1', [pid])).rows[0];
    else r = readProg()[pid];
    if (r) { Object.assign(pf, { xp: r.xp || 0, matches: r.matches || 0, wins: r.wins || 0, streak: r.streak || 0, last_day: r.last_day || '', wk: r.wk || '', wxp: r.wxp || 0 }); try { const d = typeof r.daily === 'string' ? JSON.parse(r.daily) : r.daily; if (d?.day) pf.daily = d; } catch {} }
  } catch (e) { console.error('loadProfile', e.message); }
  return pf;
}
async function saveProfile(pid, name, pf) {
  if (!pid) return;
  try {
    if (pool) await pool.query('INSERT INTO progress (pid,name,xp,matches,wins,streak,last_day,wk,wxp,daily) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (pid) DO UPDATE SET name=$2, xp=$3, matches=$4, wins=$5, streak=$6, last_day=$7, wk=$8, wxp=$9, daily=$10, updated_at=now()',
      [pid, name, pf.xp, pf.matches, pf.wins, pf.streak, pf.last_day, pf.wk, pf.wxp, JSON.stringify(pf.daily)]);
    else { const d = readProg(); d[pid] = { name, ...pf }; fs.writeFileSync(PROG, JSON.stringify(d)); }
  } catch (e) { console.error('saveProfile', e.message); }
}
function profileSummary(pf) {
  const today = dayKey(), alive = pf.last_day === today || pf.last_day === dayKey(1);
  const d = pf.daily?.day === today ? pf.daily : { prog: {}, done: [] };
  return { xp: pf.xp, streak: alive ? pf.streak : 0, missions: missionsFor(today).map((m) => ({ id: m.id, t: m.t, target: m.target, xp: m.xp, prog: d.prog[m.id] || 0, done: d.done.includes(m.id) })) };
}
const lbCache = {};
async function topPlayers(period) {
  const k = period === 'week' ? 'week' : 'all', wk = weekKey();
  if (lbCache[k] && Date.now() - lbCache[k].t < 8000) return lbCache[k].rows;
  let rows;
  if (pool) rows = k === 'week'
    ? (await pool.query('SELECT pid, name, wxp AS xp, matches, wins FROM progress WHERE wk=$1 ORDER BY wxp DESC LIMIT 200', [wk])).rows
    : (await pool.query('SELECT pid, name, xp, matches, wins FROM progress ORDER BY xp DESC, matches ASC LIMIT 200')).rows;
  else {
    rows = Object.entries(readProg()).filter(([, r]) => k === 'all' || r.wk === wk).map(([pid, r]) => ({ pid, name: r.name, xp: k === 'week' ? r.wxp || 0 : r.xp || 0, matches: r.matches || 0, wins: r.wins || 0 }))
      .sort((a, b) => b.xp - a.xp || a.matches - b.matches).slice(0, 200);
  }
  lbCache[k] = { t: Date.now(), rows };
  return rows;
}
const hitsByIp = new Map();
function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x'; }
// Per-IP limits sized so a whole office on one network can still sign up: 40 attempts/hour, 25 new leads/hour.
function bump(map, ip) { const now = Date.now(), arr = (map.get(ip) || []).filter((t) => now - t < 3600e3); arr.push(now); map.set(ip, arr); if (map.size > 5000) for (const [k, a] of map) if (!a.some((t) => now - t < 3600e3)) map.delete(k); return arr.length; }
const newByIp = new Map();
const rateLimited = (ip) => bump(hitsByIp, ip) > 40;
const readJson = (req, max = 4096) => new Promise((resolve, reject) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > max) { req.destroy(); reject(new Error('big')); } }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const page = (res, title, msg, href = BASE, label = 'Back to the game') => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;background:#0e1030;color:#e8e6ff;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:20px"><div style="max-width:420px"><div style="font-size:28px;font-weight:900;color:#ffc83d">FACTOR RATE FRENZY</div><h2>${title}</h2><p style="color:#c9c3ff;line-height:1.5">${msg}</p><a href="${href}" style="display:inline-block;background:#ffc83d;color:#241a00;font-weight:800;text-decoration:none;padding:13px 22px;border-radius:12px">${label}</a><p style="font-size:11px;color:#8d93b0;margin-top:28px">Powered by Fundara</p></div>`); };
const adminOk = (url) => ADMIN_KEY && url.searchParams.get('key') === ADMIN_KEY;

async function verifyTurnstile(tok, ip) {
  const secret = process.env.TURNSTILE_SECRET; if (!secret) return true;
  try { const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: String(tok || ''), remoteip: ip }) }); return !!(await r.json()).success; } catch { return false; }
}

/* ---------------- "Looking for leads?" answers from the results screen ---------------- */
// Stored in Postgres (or data/lead_interest.json), and a "yes" is forwarded to Zac: by email when the
// mailer is on (NOTIFY_EMAIL, default zac@fundara.co) and to LEAD_INTEREST_WEBHOOK (e.g. a GHL inbound
// webhook) when set. List them at /api/lead-interest?key=ADMIN_KEY.
const LI_FILE = path.join(DATA_DIR, 'lead_interest.json');
const LI_TYPES = { email: 'Email leads', live: 'Live transfers', data: 'Aged / data lists', unsure: 'Not sure yet' };
if (pool) pool.query(`CREATE TABLE IF NOT EXISTS lead_interest (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), pid TEXT, name TEXT, email TEXT, answer TEXT, kind TEXT, volume TEXT)`).catch((e) => console.error('lead_interest init', e.message));
const liSeen = new Map();
async function handleLeadInterest(req, res) {
  const ip = clientIp(req);
  let j; try { j = await readJson(req); } catch { return sendJson(res, 400, { ok: false }); }
  const pid = String(j.pid || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
  const answer = j.answer === 'yes' ? 'yes' : 'no';
  const kind = LI_TYPES[j.kind] ? j.kind : null;
  const volume = String(j.volume || '').replace(/[^0-9a-zA-Z +\-–/,]/g, '').slice(0, 30) || null;
  const key = pid || ip; const now = Date.now();
  if (now - (liSeen.get(key) || 0) < 20e3) return sendJson(res, 429, { ok: false, error: 'rate' });
  liSeen.set(key, now);
  let name = null, email = null;
  const lead = pid ? await store.byPid(pid).catch(() => null) : null;
  if (lead) { name = lead.name; email = lead.email; }
  if (!email && j.email) { const em = checkEmailStatic(j.email); if (!em.ok) return sendJson(res, 400, { ok: false, error: 'email' }); email = em.email; }
  if (!name && j.name) { const nm = checkName(j.name); if (nm.ok) name = nm.name; }
  if (answer === 'yes' && !email) return sendJson(res, 400, { ok: false, error: 'email' });
  const row = { pid, name, email, answer, kind, volume, created_at: new Date().toISOString() };
  if (pool) await pool.query('INSERT INTO lead_interest (pid,name,email,answer,kind,volume) VALUES ($1,$2,$3,$4,$5,$6)', [pid, name, email, answer, kind, volume]);
  else { let a = []; try { a = JSON.parse(fs.readFileSync(LI_FILE, 'utf8')); } catch {} a.push(row); fs.writeFileSync(LI_FILE, JSON.stringify(a)); }
  if (answer === 'yes') {
    console.log('LEAD-INTEREST', name, email, kind, volume);
    const label = LI_TYPES[kind] || 'Not specified';
    if (mailerEnabled) sendMail({ to: process.env.NOTIFY_EMAIL || 'zac@fundara.co', subject: `Factor Rate Frenzy: ${name || email} wants leads (${label})`,
      html: `<p><b>${String(name || '').replace(/[<>&]/g, '')}</b> (${email}) answered <b>yes</b> to "Looking for MCA leads?" in Factor Rate Frenzy.</p><p>Type: ${label}${volume ? `<br>Volume: ${volume}` : ''}</p>`,
      text: `${name || ''} (${email}) wants MCA leads. Type: ${label}${volume ? ', volume: ' + volume : ''}` }).catch(() => {});
    if (process.env.LEAD_INTEREST_WEBHOOK) fetch(process.env.LEAD_INTEREST_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'factor-rate-frenzy', name, email, lead_type: label, volume, tags: ['frf-wants-leads'] }) }).catch((e) => console.error('lead-interest webhook', e.message));
  }
  sendJson(res, 200, { ok: true });
}

async function handleLead(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: 'rate' });
  let j; try { j = await readJson(req); } catch { return sendJson(res, 400, { ok: false, error: 'bad' }); }
  if (j.hp) return sendJson(res, 200, { ok: true }); // honeypot filled: pretend success, store nothing
  if (!(Number(j.dt) > 1500)) return sendJson(res, 400, { ok: false, error: 'fast' }); // submitted faster than a human can type
  if (!(await verifyTurnstile(j.cf, ip))) return sendJson(res, 400, { ok: false, error: 'captcha' });
  const nm = checkName(j.name); if (!nm.ok) return sendJson(res, 400, { ok: false, error: 'name' });
  const em = checkEmailStatic(j.email); if (!em.ok) return sendJson(res, 400, { ok: false, error: em.reason, suggest: em.suggest });
  const can = await domainCanReceive(em.domain); if (can === false) return sendJson(res, 400, { ok: false, error: 'domain' });
  const pid = String(j.pid || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64), optin = !!j.optin, now = new Date().toISOString();
  let lead = await store.byEmail(em.email);
  if (lead) {
    const patch = { name: nm.name, pid: pid || lead.pid, ip_hash: sha(ip + SALT) };
    if (optin && !lead.newsletter) { patch.newsletter = true; patch.consent_at = now; }
    await store.update(em.email, patch); lead = { ...lead, ...patch };
  } else {
    if (bump(newByIp, ip) > 25) return sendJson(res, 429, { ok: false, error: 'rate' });
    lead = { name: nm.name, email: em.email, ref: String(j.ref || '').slice(0, 60), pid, newsletter: optin, consent_at: optin ? now : null, status: 'unverified', verify_token: token(), unsub_token: token(), mx_ok: can, ip_hash: sha(ip + SALT), risk: em.risk };
    await store.insert(lead); console.log('LEAD', lead.name, em.domain, lead.risk);
  }
  if (mailerEnabled && lead.status !== 'verified' && lead.risk === 'ok' && (!lead.last_confirm || Date.now() - new Date(lead.last_confirm) > 3600e3)) {
    const m = confirmEmail(lead, `${BASE}/verify?t=${lead.verify_token}`);
    if (await sendMail({ to: lead.email, ...m })) await store.update(em.email, { last_confirm: now });
  }
  sendJson(res, 200, { ok: true, verify: mailerEnabled });
}

async function auditLeads() {
  const rows = await store.all(), domainCache = new Map(), counts = { ok: 0, suspect: 0, invalid: 0 }, reasons = {}, bursts = {}, examples = [];
  for (const r of rows) {
    let risk = 'ok', why = '';
    const nm = checkName(r.name), em = checkEmailStatic(r.email);
    if (!em.ok) { risk = 'invalid'; why = em.reason; } else if (!nm.ok) { risk = 'invalid'; why = 'name'; }
    else {
      if (!domainCache.has(em.domain)) domainCache.set(em.domain, await domainCanReceive(em.domain));
      if (domainCache.get(em.domain) === false) { risk = 'invalid'; why = 'domain'; } else if (em.risk !== 'ok') { risk = 'suspect'; why = em.risk.split(':')[1]; }
    }
    counts[risk]++; if (why) reasons[why] = (reasons[why] || 0) + 1;
    const hr = String(r.created_at || '').slice(0, 13); if (hr) bursts[hr] = (bursts[hr] || 0) + 1;
    if (risk !== 'ok' && examples.length < 25) examples.push({ name: r.name, email: r.email, why });
    const tag = risk === 'ok' ? 'ok' : `${risk}:${why}`; if (r.risk !== tag) await store.update(String(r.email).toLowerCase(), { risk: tag });
  }
  const burstHours = Object.entries(bursts).filter(([, n]) => n >= 25).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => ({ hour: h, signups: n }));
  return { total: rows.length, ...counts, reasons, burstHours, examples, note: 'Run POST /api/leads/purge?key=…&confirm=yes to delete rows marked invalid. Suspect rows are kept but excluded from mailing lists.' };
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }

  if (url.pathname === '/api/lead' && req.method === 'POST') { handleLead(req, res).catch((e) => { console.error('lead', e.message); sendJson(res, 500, { ok: false, error: 'server' }); }); return; }
  if (url.pathname === '/api/lead-interest' && req.method === 'POST') { handleLeadInterest(req, res).catch((e) => { console.error('lead-interest', e.message); sendJson(res, 500, { ok: false }); }); return; }
  if (url.pathname === '/api/lead-interest') {
    if (!adminOk(url)) { res.writeHead(403); res.end('forbidden'); return; }
    (pool ? pool.query('SELECT * FROM lead_interest ORDER BY id DESC LIMIT 500').then((r) => r.rows) : Promise.resolve((() => { try { return JSON.parse(fs.readFileSync(LI_FILE, 'utf8')).reverse(); } catch { return []; } })()))
      .then((rows) => sendJson(res, 200, { total: rows.length, yes: rows.filter((r) => r.answer === 'yes').length, rows })).catch((e) => sendJson(res, 500, { error: e.message }));
    return;
  }
  if (url.pathname === '/api/config') return sendJson(res, 200, { turnstile: process.env.TURNSTILE_SITEKEY || null, verify: mailerEnabled });
  if (url.pathname === '/verify') {
    store.byToken('verify', url.searchParams.get('t')).then(async (l) => {
      if (!l) return page(res, 'Link expired', 'That confirmation link is not valid. Sign up again from the game to get a new one.');
      await store.update(String(l.email).toLowerCase(), { status: 'verified', verified_at: new Date().toISOString() });
      page(res, 'Email confirmed ✅', `Thanks ${String(l.name).replace(/[<>&"']/g, '')}! ${l.newsletter ? 'You will get your match recaps and Fundara news. You can unsubscribe any time.' : 'You are all set.'}`);
    }).catch(() => page(res, 'Something went wrong', 'Please try the link again in a minute.'));
    return;
  }
  if (url.pathname === '/unsubscribe') {
    store.byToken('unsub', url.searchParams.get('t')).then(async (l) => {
      if (!l) return page(res, 'Link not valid', 'This unsubscribe link is not valid.');
      await store.update(String(l.email).toLowerCase(), { newsletter: false, unsub_at: new Date().toISOString() });
      page(res, 'You are unsubscribed', 'You will no longer receive recaps or Fundara news. You can still play any time.');
    }).catch(() => page(res, 'Something went wrong', 'Please try again in a minute.'));
    return;
  }

  if (url.pathname === '/api/leaderboard') {
    topPlayers(url.searchParams.get('period')).then((rows) => {
      const pid = String(url.searchParams.get('pid') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
      const idx = pid ? rows.findIndex((r) => r.pid === pid) : -1;
      const out = { top: rows.slice(0, 20).map((r, i) => ({ r: i + 1, n: r.name, xp: r.xp, m: r.matches, w: r.wins, me: r.pid === pid ? 1 : 0 })), me: idx >= 0 ? { r: idx + 1, xp: rows[idx].xp, m: rows[idx].matches, w: rows[idx].wins } : null, total: rows.length };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(out));
    }).catch(() => { res.writeHead(500); res.end('{}'); });
    return;
  }

  if (url.pathname === '/api/leads/audit') {
    if (!adminOk(url)) { res.writeHead(403); res.end('forbidden'); return; }
    auditLeads().then((o) => sendJson(res, 200, o)).catch((e) => sendJson(res, 500, { error: e.message }));
    return;
  }
  if (url.pathname === '/api/leads/purge' && req.method === 'POST') {
    if (!adminOk(url) || url.searchParams.get('confirm') !== 'yes') { res.writeHead(403); res.end('forbidden: needs key and confirm=yes'); return; }
    store.all().then((rows) => store.removeEmails(rows.filter((r) => String(r.risk).startsWith('invalid')).map((r) => String(r.email).toLowerCase()))).then((n) => sendJson(res, 200, { deleted: n })).catch((e) => sendJson(res, 500, { error: e.message }));
    return;
  }
  if (url.pathname === '/api/leads') {
    (async () => {
      if (!adminOk(url)) { res.writeHead(403); res.end('forbidden'); return; }
      const q = url.searchParams; let rows = await store.all();
      if (q.get('status')) rows = rows.filter((r) => r.status === q.get('status'));
      if (q.get('newsletter') === '1') rows = rows.filter((r) => r.newsletter);
      if (q.get('risk') === 'ok') rows = rows.filter((r) => r.risk === 'ok');
      const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end('created_at,name,email,status,newsletter,risk,mx_ok,consent_at,verified_at,ref\n' + rows.map((r) => [r.created_at, r.name, r.email, r.status, r.newsletter ? 'yes' : 'no', r.risk, r.mx_ok, r.consent_at, r.verified_at, r.ref].map(esc).join(',')).join('\n'));
    })().catch(() => { res.writeHead(500); res.end('error'); });
    return;
  }

  let file;
  if (url.pathname.startsWith('/vendor/examples/')) {
    const base = path.join(__dirname, 'node_modules/three/examples');
    file = path.join(base, decodeURIComponent(url.pathname.slice('/vendor/examples/'.length)));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  } else if (VENDOR[url.pathname]) file = path.join(__dirname, VENDOR[url.pathname]);
  else {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    file = path.join(__dirname, 'public', rel);
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end(); return; }
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    // Cache-bust every deploy: version the asset URLs so browsers/CDNs never serve a stale build
    const name = path.basename(file);
    if (name === 'index.html') buf = Buffer.from(buf.toString().replace('href="style.css"', `href="style.css?v=${BUILD}"`).replace('src="main.js"', `src="main.js?v=${BUILD}"`));
    else if (name === 'main.js') buf = Buffer.from(buf.toString().replace("from './shared.js'", `from './shared.js?v=${BUILD}'`));
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': name === 'index.html' ? 'no-store' : 'public, max-age=3600' });
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
    this.cfg = { seats: 4, bots: true, map: 'main' }; this.shops = MAPS.main.shops; this.rules = MAPS.main.rules; this.rush = false; this.rushIn = Infinity; this.rushLeft = 0; this.maxClients = 4; this.nid = 1; this.ticks = 0; this.hostId = null; this.spawnT = 0; this.stackT = 6;

    this.onMessage('in', (c, m) => {
      const p = this.players.get(c.sessionId); if (!p || !m) return;
      if (Number.isFinite(m.x) && Number.isFinite(m.z)) { p.x = Math.max(-ARENA, Math.min(ARENA, m.x)); p.z = Math.max(-ARENA, Math.min(ARENA, m.z)); }
      if (Number.isFinite(m.a)) p.ang = m.a;
    });
    this.onMessage('fire', (c, m) => {
      const p = this.players.get(c.sessionId); if (!p || this.phase !== 'play' || p.fireCd > 0 || p.stun > 0) return;
      if (m && Number.isFinite(m.a)) p.ang = m.a;
      this.shoot(p);
    });
    this.onMessage('cfg', (c, m) => {
      if (c.sessionId !== this.hostId || this.phase !== 'lobby' || !m) return;
      const humans = [...this.players.values()].filter((p) => !p.bot).length;
      this.cfg.seats = Math.max(2, humans, Math.min(8, m.seats | 0 || this.cfg.seats)); this.cfg.bots = !!m.bots;
      if (typeof m.map === 'string' && MAPS[m.map]) { this.cfg.map = m.map; this.shops = MAPS[m.map].shops; this.rules = MAPS[m.map].rules; }
      this.maxClients = this.cfg.seats;
      if (this.clients.length < this.maxClients) this.unlock(); else this.lock();
      this.sendRoster();
    });
    this.onMessage('ping', (c, m) => c.send('pong', m));
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
    return { id, name, skin, bot, x: 0, z: 0, ang: 0, fire: false, stun: 0, immune: 0, fireCd: 0, surge: 0, surgeCd: 0, boost: 0, shieldT: 0, hbCut: 0, acc: 0,
      pid: '', xp: 0, lv: 0, perk: perks(0), pf: null, coinsN: 0, powN: 0, hits: 0, owed: 0, cash: 0, hb: 0, swept: 0, stacks: 0, advance: 0, payback: 0, cleared: 0, rethink: 0, tgt: null, greedy: false };
  }
  resetStats(p) {
    p.owed = Math.round(R.ADVANCE * R.FACTOR); p.perk = perks(p.lv); p.hits = 0; p.coinsN = 0; p.powN = 0; p.cash = R.ADVANCE + p.perk.startCash; p.hb = R.HOLDBACK; p.swept = 0; p.stacks = 0;
    p.advance = R.ADVANCE; p.payback = p.owed; p.cleared = 0; p.stun = 0; p.immune = 0; p.surge = 0; p.surgeCd = 0; p.boost = 0; p.fireCd = 0; p.shieldT = 0; p.hbCut = 0;
  }

  async onJoin(client, options) {
    const p = this.mkPlayer(client.sessionId, clean(options?.name, 14) || 'Merchant', Math.max(0, Math.min(5, (options?.skin | 0))), false);
    p.pid = String(options?.pid || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
    p.pf = await loadProfile(p.pid); p.xp = p.pf.xp; p.lv = levelFor(p.xp);
    this.resetStats(p);
    const a = Math.random() * 6.28, sp0 = resolve(Math.cos(a) * 14, Math.sin(a) * 14, 1, this.shops); p.x = sp0.x; p.z = sp0.z;
    if (this.phase === 'play') { /* join in progress, fresh books */ }
    this.players.set(p.id, p);
    if (this.phase === 'play' && this.players.size > this.cfg.seats) { const b = [...this.players.values()].find((q) => q.bot); if (b) this.players.delete(b.id); }
    if (!this.hostId) this.hostId = p.id;
    client.send('spawn', { x: p.x, z: p.z }); client.send('profile', profileSummary(p.pf));
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
    this.broadcast('roster', { host: this.hostId, code: this.code, cfg: this.cfg, p: [...this.players.values()].map((p) => ({ id: p.id, n: p.name, s: p.skin, b: p.bot ? 1 : 0, lv: p.lv, xp: p.xp })) });
  }

  startRound() {
    for (const [id, p] of this.players) if (p.bot) this.players.delete(id);
    const humans = [...this.players.values()];
    const want = this.cfg.bots ? Math.max(0, this.cfg.seats - humans.length) : 0;
    for (let i = 0; i < want; i++) {
      const b = this.mkPlayer('bot' + this.nid++, BOT_NAMES[i % BOT_NAMES.length], (i * 2 + 1) % 6, true);
      b.greedy = Math.random() < 0.35; this.players.set(b.id, b);
    }
    const all = [...this.players.values()];
    all.forEach((p, i) => {
      this.resetStats(p);
      const a = (i / all.length) * Math.PI * 2 + 0.4;
      const s = resolve(Math.cos(a) * 15, Math.sin(a) * 15, 1, this.shops);
      p.x = s.x; p.z = s.z;
      const c = this.clients.find((c) => c.sessionId === p.id); if (c) c.send('spawn', { x: p.x, z: p.z });
    });
    this.shops = MAPS[this.cfg.map].shops; this.rules = MAPS[this.cfg.map].rules; this.rush = false; this.rushIn = this.rules.rush ? this.rules.rush.every : Infinity;
    this.orbs = []; this.bullets = []; this.tl = R.ROUND; this.elapsed = 0; this.stackT = 8; this.powT = 6;
    for (let i = 0; i < 14 + 3 * all.length; i++) this.spawnOrb(0);
    this.phase = 'play';
    this.sendRoster();
    this.broadcast('fx', { k: 'start' });
  }

  spawnOrb(kind, x, z, v, noPick) {
    let ox = x, oz = z;
    if (ox === undefined) {
      for (let i = 0; i < 12; i++) {
        const tx = rnd(-ARENA + 3, ARENA - 3), tz = rnd(-ARENA + 3, ARENA - 3);
        const r = resolve(tx, tz, 2, this.shops);
        if (Math.abs(r.x - tx) < 0.01 && Math.abs(r.z - tz) < 0.01) { ox = tx; oz = tz; break; }
      }
      if (ox === undefined) return;
    }
    this.orbs.push({ id: this.nid++, x: ox, z: oz, k: kind, v: v || Math.round(rnd(400, 1200) / 50) * 50, noPick, t: 0 });
  }

  useSurge(p) {
    if (this.phase !== 'play' || p.surgeCd > 0 || p.stun > 0) return;
    p.surge = 4; p.surgeCd = 12 - p.perk.surgeCd;
    this.broadcast('fx', { k: 'surge', id: p.id });
  }

  speedOf(p) { return p.stun > 0 ? 0 : R.SPEED * p.perk.speed * (p.surge > 0 ? 1.5 : 1); }

  collect(p, v, quiet) {
    const gross = Math.round(v * (p.boost > 0 ? 2 : 1) * p.perk.sales * (quiet ? 1 : this.rules.coinVal * (this.rush ? 1.5 : 1)));
    let sweep = 0;
    if (p.owed > 0) { let hb = p.hbCut > 0 ? p.hb * 0.4 : p.hb; const z = this.rules.hbZone; if (z && Math.hypot(p.x - z.x, p.z - z.z) < z.r) hb *= z.mult; sweep = Math.min(p.owed, Math.round(gross * hb)); }
    p.owed -= sweep; p.swept += sweep; p.cash += gross - sweep; if (!quiet) p.coinsN++;
    const c = this.clients.find((c) => c.sessionId === p.id);
    if (c && !quiet) c.send('gain', { g: gross, s: sweep, b: p.boost > 0 ? 1 : 0 });
    this.clearCheck(p);
  }

  clearCheck(p) {
    if (p.owed <= 0 && !p.cleared) {
      p.cleared = Math.max(1, Math.round(this.elapsed)); p.cash += 2000;
      this.broadcast('fx', { k: 'free', id: p.id, n: p.name });
      this.endRound(p.id);
    }
  }

  takePower(p, k) {
    p.powN++;
    if (k === 2) { const d = Math.min(p.owed, 600); p.owed -= d; p.swept += d; this.clearCheck(p); }
    else if (k === 3) p.shieldT = 8;
    else if (k === 4) p.hbCut = 10;
    this.broadcast('fx', { k: 'pow', pk: k, id: p.id, n: p.name, x: p.x, z: p.z });
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
    this.snapshot();
  }

  updatePlay(dt) {
    this.elapsed += dt; this.tl -= dt;
    this.spawnT -= dt; this.stackT -= dt; this.powT -= dt;
    const RL = this.rules;
    if (RL.rush) {
      this.rushIn -= dt;
      if (!this.rush && this.rushIn <= 0) { this.rush = true; this.rushLeft = RL.rush.dur; this.broadcast('fx', { k: 'rush', on: true }); }
      else if (this.rush) { this.rushLeft -= dt; if (this.rushLeft <= 0) { this.rush = false; this.rushIn = RL.rush.every; this.broadcast('fx', { k: 'rush', on: false }); } }
    }
    if (this.spawnT <= 0) { this.spawnT = 0.55 / (RL.coinRate * (this.rush ? 3 : 1)); if (this.orbs.filter((o) => o.k === 0).length < (20 + 4 * this.players.size) * (this.rush ? 1.6 : 1)) this.spawnOrb(0); }
    if (this.stackT <= 0) { this.stackT = RL.stackEvery; if (this.orbs.filter((o) => o.k === 1).length < RL.stackCap) this.spawnOrb(1, undefined, undefined, R.STACK_ADV); }

    if (this.powT <= 0) {
      this.powT = RL.powEvery;
      if (this.orbs.filter((o) => o.k >= 2).length < 3) { const W = RL.powW, tot = W[0] + W[1] + W[2]; let x = Math.random() * tot, k = 0; while (k < 2 && x >= W[k]) { x -= W[k]; k++; } this.spawnOrb(2 + k, undefined, undefined, 0); }
    }
    const list = [...this.players.values()];
    for (const p of list) {
      p.shieldT = Math.max(0, p.shieldT - dt); p.hbCut = Math.max(0, p.hbCut - dt);
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
      const r = resolve(b.x, b.z, 0.1, this.shops);
      if (Math.abs(r.x - b.x) > 0.001 || Math.abs(r.z - b.z) > 0.001) b.ttl = 0;
      for (const q of list) {
        if (q.id === b.owner || q.immune > 0) continue;
        const dx = q.x - b.x, dz = q.z - b.z;
        if (dx * dx + dz * dz < 1.3 * 1.3) { b.ttl = 0; if (q.shieldT > 0) this.broadcast('fx', { k: 'block', id: q.id, x: q.x, z: q.z }); else this.hit(q, b); break; }
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
          if (q.surge > 0 && o.k === 0 && d2 > 2.4) { const d = Math.sqrt(d2); o.x += (dx / d) * 16 * dt; o.z += (dz / d) * 16 * dt; }
          else { o.dead = true; if (o.k === 1) this.takeStack(q); else if (o.k >= 2) this.takePower(q, o.k); else this.collect(q, o.v); break; }
        }
      }
    }
    this.orbs = this.orbs.filter((o) => !o.dead);
    if (this.phase === 'play' && this.tl <= 0) this.endRound(null);
  }

  shoot(p) {
    p.fireCd = p.bot ? 1.4 : 0.6 * p.perk.fire;
    this.bullets.push({ id: this.nid++, owner: p.id, x: p.x + Math.sin(p.ang) * 1.2, z: p.z + Math.cos(p.ang) * 1.2, vx: Math.sin(p.ang) * 22, vz: Math.cos(p.ang) * 22, ttl: 1.1 });
  }

  hit(q, b) {
    const sh = this.players.get(b.owner); if (sh) sh.hits++;
    q.stun = 1.2; q.immune = 2.4;
    const drop = Math.min(q.cash, 1800);
    q.cash -= drop;
    const n = drop >= 600 ? 3 : drop > 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = rnd(1.5, 3);
      const t = resolve(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, 0.6, this.shops);
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
    let foe = null, fd = 13;
    for (const q of list) { if (q === p) continue; const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < fd) { fd = d; foe = q; } }
    let mx = 0, mz = 0;
    if (p.tgt) { const dx = p.tgt.x - p.x, dz = p.tgt.z - p.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; }
    else { mx = Math.sin(this.elapsed + p.x); mz = Math.cos(this.elapsed + p.z); }
    if (foe) { p.ang = Math.atan2(foe.x - p.x, foe.z - p.z) + rnd(-0.3, 0.3); p.fire = Math.random() < 0.02; }
    else { p.ang = Math.atan2(mx, mz); p.fire = false; }
    if (p.surgeCd <= 0 && Math.random() < 0.15 * dt * 3) this.useSurge(p);
    const sp = this.speedOf(p) * 0.8 * dt;
    const r = resolve(p.x + mx * sp, p.z + mz * sp, 0.9, this.shops);
    if (Math.hypot(r.x - p.x - mx * sp, r.z - p.z - mz * sp) > sp * 0.5) { p.rethink = 0; p.tgt = null; }
    p.x = r.x; p.z = r.z;
  }

  endRound(winnerId) {
    if (this.phase !== 'play') return;
    this.phase = 'results'; this.resultsT = 16; if (this.rush) { this.rush = false; this.broadcast('fx', { k: 'rush', on: false }); }
    const res = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, s: p.skin, b: p.bot ? 1 : 0, net: p.cash - p.owed, cash: p.cash, owed: p.owed, swept: p.swept,
      stacks: p.stacks, advance: p.advance, payback: p.payback, cleared: p.cleared,
    }));
    res.sort((a, b) => (a.cleared && b.cleared ? a.cleared - b.cleared : a.cleared ? -1 : b.cleared ? 1 : b.net - a.net));
    this.broadcast('results', { res, dur: Math.round(this.elapsed), winner: winnerId });
    this.awardXp(res);
  }

  async awardXp(res) {
    const topId = res[0]?.id, today = dayKey();
    for (const p of [...this.players.values()]) {
      if (p.bot) continue;
      const r = res.find((x) => x.id === p.id); if (!r) continue;
      const pf = p.pf || await loadProfile(p.pid);
      const parts = [['Played a match', 25]];
      if (p.cleared) parts.push(['Debt-free!', 60]);
      if (p.id === topId) parts.push(['Top of the leaderboard', 40]);
      if (r.net > 0) parts.push(['Positive net worth', Math.min(50, Math.floor(r.net / 150))]);
      if (p.hits) parts.push([`${p.hits} notice hit${p.hits > 1 ? 's' : ''}`, Math.min(30, p.hits * 3)]);
      if (!p.stacks) parts.push(['No stacking — kept costs fixed', 15]);
      if (pf.last_day !== today) {
        pf.streak = pf.last_day === dayKey(1) ? pf.streak + 1 : 1; pf.last_day = today;
        parts.push([`Daily bonus (🔥 ${pf.streak}-day streak)`, 10 + 5 * Math.min(pf.streak, 6)]);
      }
      if (pf.daily?.day !== today) pf.daily = { day: today, prog: {}, done: [] };
      const stat = { hits: p.hits, coins: p.coinsN, wins: p.id === topId ? 1 : 0, matches: 1, nostack: p.stacks ? 0 : 1, power: p.powN, free: p.cleared ? 1 : 0 };
      for (const mi of missionsFor(today)) {
        if (pf.daily.done.includes(mi.id)) continue;
        pf.daily.prog[mi.id] = Math.min(mi.target, (pf.daily.prog[mi.id] || 0) + (stat[mi.id] || 0));
        if (pf.daily.prog[mi.id] >= mi.target) { pf.daily.done.push(mi.id); parts.push(['Mission: ' + mi.t, mi.xp]); }
      }
      const gain = parts.reduce((s, x) => s + x[1], 0), oldLv = p.lv;
      pf.xp += gain; pf.matches++; if (p.id === topId) pf.wins++;
      const wk = weekKey(); if (pf.wk !== wk) { pf.wk = wk; pf.wxp = 0; } pf.wxp += gain;
      await saveProfile(p.pid, p.name, pf);
      p.pf = pf; p.xp = pf.xp; p.lv = levelFor(p.xp);
      this.maybeRecap(p, r, res, gain, pf);
      const c = this.clients.find((c) => c.sessionId === p.id);
      if (c) { c.send('xp', { parts, gain, xp: p.xp, lv: p.lv, up: p.lv > oldLv }); c.send('profile', profileSummary(pf)); }
    }
    this.sendRoster();
  }

  async maybeRecap(p, r, res, gain, pf) {
    try {
      if (!mailerEnabled || !p.pid) return;
      const L = await store.byPid(p.pid);
      if (!L || !L.newsletter || L.status !== 'verified' || L.risk !== 'ok') return;
      if (L.last_recap && Date.now() - new Date(L.last_recap) < 20 * 3600e3) return;
      const now = new Date().toISOString(); await store.update(String(L.email).toLowerCase(), { last_recap: now });
      const unsub = `${BASE}/unsubscribe?t=${L.unsub_token}`, lv = levelFor(pf.xp);
      const rec = { rank: res.findIndex((x) => x.id === p.id) + 1, players: res.length, net: r.net, cleared: p.cleared, gain, xp: pf.xp, rankName: RANKS[lv].n, rankIcon: RANKS[lv].i, streak: pf.streak };
      await sendMail({ to: L.email, ...recapEmail(L, rec, unsub), unsubUrl: unsub });
    } catch (e) { console.error('recap', e.message); }
  }

  snapshot() {
    const r2 = (n) => Math.round(n * 100) / 100;
    this.broadcast('snap', {
      ph: this.phase, tl: Math.max(0, Math.round(this.tl * 10) / 10),
      p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.z), r2(p.ang), r2(p.stun), p.owed, p.cash, r2(p.hb), r2(p.boost), r2(p.surge), r2(p.surgeCd), p.swept, p.stacks, r2(p.shieldT), r2(p.hbCut)]),
      o: this.orbs.map((o) => [o.id, r2(o.x), r2(o.z), o.v, o.k]),
      b: this.bullets.map((b) => [b.id, r2(b.x), r2(b.z), r2(Math.atan2(b.vx, b.vz)), b.owner]),
    });
  }
}

const server = http.createServer(handler);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define('match', MatchRoom).filterBy(['code']);
gameServer.listen(Number(PORT)).then(() => console.log('Factor Rate Frenzy on :' + PORT));
