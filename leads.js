// Lead capture: validation, anti-spam, storage (Postgres or JSON file), verification tokens.
import dns from 'dns/promises';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DISPOSABLE = new Set(`mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net tempmail.com temp-mail.org temp-mail.io tempmail.net tempmailo.com yopmail.com yopmail.fr trashmail.com trashmail.net getnada.com nada.email dispostable.com maildrop.cc throwawaymail.com fakeinbox.com mintemail.com mytemp.email tempail.com emailondeck.com moakt.com mohmal.com spamgourmet.com tempinbox.com burnermail.io inboxkitten.com mailnesia.com mailcatch.com discard.email discardmail.com spambox.us fakemail.net fake-mail.net dropmail.me emailfake.com email-fake.com tmpmail.org tmpmail.net tmail.ws mail.tm mailpoof.com tempr.email 33mail.com anonbox.net byom.de cuvox.de dayrep.com einrot.com fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com teleworm.us armyspy.com instaddr.win lroid.com vomoto.com zeroe.ml jetable.org nospam.ze.tc wegwerfmail.de wegwerfmail.net owlymail.com spam4.me 1secmail.com 1secmail.net 1secmail.org kzccv.com qiott.com wuuvo.com vjuum.com laafd.com txcct.com esiix.com xojxe.com yoggm.com icznn.com`.split(/\s+/));
const TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com' };
const JUNK_LOCAL = /^(test|tester|testing|asdf+|qwer+|abc+|aaa+|xxx+|fake|noemail|none|no|null|admin|info|user|example|sample|spam|nospam|hello|hi|email|mail|name|me|you|a|b|c|x|y|z)\d*$/i;
const JUNK_NAME = /(https?:|www\.|\.(com|net|org|ru|xyz|top|io|co)\b|@|<|>|click here|free money|crypto|viagra|casino|bit\.ly|telegram|whatsapp)/i;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export const sha = (s, n = 16) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);
export const token = () => crypto.randomBytes(18).toString('base64url');

export function checkName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim();
  if (n.length < 2 || n.length > 40) return { ok: false, reason: 'name' };
  if (JUNK_NAME.test(n) || (n.match(/\d/g) || []).length > 4) return { ok: false, reason: 'name' };
  if (!/[a-zÀ-ɏ]/i.test(n)) return { ok: false, reason: 'name' };
  return { ok: true, name: n };
}

export function checkEmailStatic(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length < 6 || email.length > 120 || !EMAIL_RE.test(email) || email.includes('..')) return { ok: false, reason: 'syntax' };
  const [local, domain] = email.split('@');
  if (TYPOS[domain]) return { ok: false, reason: 'typo', suggest: `${local}@${TYPOS[domain]}` };
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };
  if (/(^|\.)example\.(com|org|net)$/.test(domain) || domain === 'test.com' || domain === 'localhost') return { ok: false, reason: 'junk' };
  const base = local.split('+')[0];
  if (JUNK_LOCAL.test(base)) return { ok: false, reason: 'junk' };
  if (/^(.)\1{4,}/.test(base)) return { ok: false, reason: 'junk' };
  // Heuristic (accepted but flagged, excluded from mailing lists): long random-looking mailbox
  const digits = (base.match(/\d/g) || []).length, vowels = (base.match(/[aeiou]/g) || []).length;
  let risk = 'ok';
  if (base.length >= 14 && (digits / base.length > 0.4 || vowels / base.length < 0.12)) risk = 'suspect:random-looking';
  return { ok: true, email, domain, risk };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);
// true = domain can receive mail, false = definitely cannot, null = couldn't tell (don't block)
export async function domainCanReceive(domain) {
  if (process.env.MX_CHECK === 'off') return true;
  try { const mx = await withTimeout(dns.resolveMx(domain), 2500); if (mx?.length) return true; } catch (e) { if (!['ENOTFOUND', 'ENODATA'].includes(e.code)) return null; }
  try { const a = await withTimeout(dns.resolve4(domain), 2500); return a.length > 0; } catch (e) { return ['ENOTFOUND', 'ENODATA'].includes(e.code) ? false : null; }
}

/* ---------------- storage ---------------- */
export function makeStore(pool, dataDir) {
  const file = path.join(dataDir, 'leads.json');
  const readAll = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const writeAll = (rows) => fs.writeFileSync(file, JSON.stringify(rows));
  const COLS = ['name', 'email', 'ref', 'pid', 'newsletter', 'consent_at', 'status', 'verify_token', 'verified_at', 'unsub_token', 'unsub_at', 'mx_ok', 'ip_hash', 'last_recap', 'last_confirm', 'risk'];
  const norm = (r) => r && ({ ...r, newsletter: !!r.newsletter, created_at: r.created_at ? new Date(r.created_at).toISOString() : '' });
  const init = async () => {
    if (!pool) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), name TEXT NOT NULL, email TEXT NOT NULL, ref TEXT DEFAULT '')`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS pid TEXT, ADD COLUMN IF NOT EXISTS newsletter BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unverified', ADD COLUMN IF NOT EXISTS verify_token TEXT, ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS unsub_token TEXT, ADD COLUMN IF NOT EXISTS unsub_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS mx_ok BOOLEAN, ADD COLUMN IF NOT EXISTS ip_hash TEXT, ADD COLUMN IF NOT EXISTS last_recap TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS last_confirm TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS risk TEXT NOT NULL DEFAULT 'unchecked'`);
    await pool.query('CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (lower(email))');
    await pool.query('CREATE INDEX IF NOT EXISTS leads_pid_idx ON leads (pid)');
  };
  return {
    init,
    async byEmail(email) { if (pool) return norm((await pool.query('SELECT * FROM leads WHERE lower(email)=$1 ORDER BY id LIMIT 1', [email])).rows[0]); return norm(readAll().find((r) => r.email === email)); },
    async byPid(pid) { if (!pid) return null; if (pool) return norm((await pool.query('SELECT * FROM leads WHERE pid=$1 ORDER BY id DESC LIMIT 1', [pid])).rows[0]); return norm(readAll().filter((r) => r.pid === pid).pop()); },
    async byToken(kind, t) { if (!t || t.length < 10) return null; const col = kind === 'verify' ? 'verify_token' : 'unsub_token'; if (pool) return norm((await pool.query(`SELECT * FROM leads WHERE ${col}=$1 LIMIT 1`, [t])).rows[0]); return norm(readAll().find((r) => r[col] === t)); },
    async insert(row) {
      if (pool) { const cols = COLS.filter((c) => row[c] !== undefined); await pool.query(`INSERT INTO leads (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => row[c])); return; }
      const rows = readAll(); rows.push({ created_at: new Date().toISOString(), ...row }); writeAll(rows);
    },
    async update(email, patch) {
      const cols = Object.keys(patch).filter((c) => COLS.includes(c)); if (!cols.length) return;
      if (pool) { await pool.query(`UPDATE leads SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE lower(email)=$1`, [email, ...cols.map((c) => patch[c])]); return; }
      const rows = readAll(); for (const r of rows) if (r.email === email) Object.assign(r, patch); writeAll(rows);
    },
    async all() { if (pool) return (await pool.query('SELECT * FROM leads ORDER BY id')).rows.map(norm); return readAll().map(norm); },
    async removeEmails(emails) {
      if (!emails.length) return 0;
      if (pool) return (await pool.query('DELETE FROM leads WHERE lower(email) = ANY($1)', [emails])).rowCount;
      const set = new Set(emails), rows = readAll(), keep = rows.filter((r) => !set.has(r.email)); writeAll(keep); return rows.length - keep.length;
    },
  };
}
