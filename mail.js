// Email sending (Resend REST API) + templates. Set RESEND_API_KEY and MAIL_FROM in the environment to enable.
const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || '';
export const BASE = (process.env.PUBLIC_URL || 'https://play.fundara.co').replace(/\/$/, '');
const ADDRESS = process.env.MAIL_ADDRESS || ''; // physical mailing address (required by CAN-SPAM for marketing email)
export const mailerEnabled = !!(KEY && FROM);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendMail({ to, subject, html, text, unsubUrl }) {
  if (!mailerEnabled) { console.log('MAIL (disabled, not sent):', subject); return false; }
  try {
    const headers = unsubUrl ? { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, html, text, headers }) });
    if (!r.ok) { console.error('MAIL failed', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error('MAIL error', e.message); return false; }
}

const shell = (title, body, unsubUrl) => `<!doctype html><html><body style="margin:0;background:#0e1030;font-family:Arial,Helvetica,sans-serif;color:#e8e6ff">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1030"><tr><td align="center" style="padding:24px 12px">
<table width="100%" style="max-width:520px;background:#171a3d;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="padding:22px 24px;background:#2a1f5a"><div style="font-size:12px;letter-spacing:3px;color:#c9c3ff">THE MERCHANT CASH ADVANCE GAME</div><div style="font-size:26px;font-weight:900;color:#ffc83d;line-height:1.1">FACTOR RATE FRENZY</div></td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px;color:#fff">${title}</h2>${body}</td></tr>
<tr><td style="padding:16px 24px;font-size:11px;line-height:1.5;color:#8d93b0;border-top:1px solid #2a2e5c">Powered by <a href="https://fundara.co" style="color:#35e0c0">Fundara</a>.${ADDRESS ? '<br>' + esc(ADDRESS) : ''}${unsubUrl ? `<br><a href="${unsubUrl}" style="color:#8d93b0">Unsubscribe</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
const btn = (href, label, bg = '#ffc83d', fg = '#241a00') => `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};font-weight:800;text-decoration:none;padding:13px 22px;border-radius:12px;margin:8px 0">${label}</a>`;

export function confirmEmail(lead, verifyUrl) {
  const html = shell('Confirm your email', `<p style="line-height:1.55;color:#cfd2ee">Hi ${esc(lead.name)}, tap the button to confirm your email${lead.newsletter ? ' and start getting your match recaps and Fundara news' : ''}.</p>${btn(verifyUrl, 'Confirm my email')}<p style="font-size:12px;color:#8d93b0">If you didn't sign up, ignore this message and nothing will happen.</p>`);
  return { subject: 'Confirm your email for Factor Rate Frenzy', html, text: `Hi ${lead.name}, confirm your email: ${verifyUrl}\nIf you didn't sign up, ignore this message.` };
}

export function recapEmail(lead, r, unsubUrl) {
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const rows = [['Finish', r.cleared ? `Debt-free in ${r.cleared}s 🎉` : `#${r.rank} of ${r.players}`], ['Net worth', money(r.net)], ['XP earned', '+' + r.gain], ['Rank', `${r.rankIcon} ${r.rankName} · ${r.xp} XP`], ...(r.streak > 1 ? [['Streak', `🔥 ${r.streak} days`]] : [])]
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#9aa1c6">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#fff">${esc(v)}</td></tr>`).join('');
  const html = shell('Your match recap', `<table width="100%" style="font-size:14px;border-collapse:collapse">${rows}</table>
  <p style="margin:18px 0 4px">${btn(BASE, 'Play again')}</p>
  <div style="margin-top:18px;padding:14px 16px;border-radius:12px;background:#22265a;font-size:14px;line-height:1.55;color:#d6d9f5"><b style="color:#fff">Thinking about real business funding?</b><br>Fundara can help you compare options. ${btn('https://fundara.co', 'Visit fundara.co', '#35e0c0', '#04231c')}</div>`, unsubUrl);
  return { subject: `Your Factor Rate Frenzy recap: ${r.cleared ? 'debt-free!' : '#' + r.rank}`, html, text: `Your Factor Rate Frenzy recap\n${rows.replace(/<[^>]+>/g, ' ')}\nPlay again: ${BASE}\nFundara: https://fundara.co\nUnsubscribe: ${unsubUrl}` };
}
