// A stand-in for a teacher's inbox: intercepts script.google.com (and the
// googleusercontent redirect host) and answers like the Apps Script would.

export const INBOX_URL = 'https://script.google.com/macros/s/AKfyTEST123/exec';
export const SECRET = 'abcdef0123456789abcdef01';
export const KEY = SECRET; // the sending key is the secret code

export async function standInInbox(page, opts = {}) {
  const state = {
    version: opts.version ?? 5,
    tools: opts.tools === undefined ? ['pagepal', 'word-helper'] : opts.tools,
    joins: {},
    requests: [],
    down: false,
    joinReply: opts.joinReply || null,
  };
  const handler = async route => {
    const req = route.request();
    const body = req.postData();
    state.requests.push({ method: req.method(), url: req.url(), body, contentType: req.headers()['content-type'] });
    const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });
    if (state.down) return route.abort('internetdisconnected');
    if (req.method() === 'GET') {
      const info = { ok: true, app: 'PagePal Inbox', version: state.version };
      if (state.tools) info.tools = state.tools;
      if (state.version >= 5) info.name = 'Classroom Inbox';
      return reply(info);
    }
    const data = JSON.parse(body || '{}');
    if (data.action === 'newJoin') {
      if (data.secret !== SECRET) return reply({ ok: false, error: 'wrong-code' });
      const days = Math.max(1, Math.min(80, Number(data.days) || 7));
      const join = 'join' + Object.keys(state.joins).length + 'xxxxxxxxxxx';
      const expires = Date.now() + days * 86400000;
      state.joins[join] = { expires, label: data.label };
      return reply({ ok: true, join, expires });
    }
    if (data.action === 'join') {
      if (state.joinReply) return reply(state.joinReply);
      const j = state.joins[data.join];
      if (!j || j.expires < Date.now()) return reply({ ok: false, error: 'expired-join' });
      return reply({ ok: true, key: KEY, name: j.label });
    }
    return reply({ ok: false, error: 'bad-request' });
  };
  await page.route('https://script.google.com/**', handler);
  await page.route('https://script.googleusercontent.com/**', handler);
  return state;
}

export function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s) {
  return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}
