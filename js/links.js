// Class links: what goes in a class QR code, and reading one back.
// Pure functions (no page access), unit-tested in tests/links.test.mjs.
//
// A class link looks like …/classroom_inbox/join/?teacher=CODE. CODE is
// base64url (no padding) JSON {n: class name, u: inbox web app URL,
// j: join code, x: expiry in ms}. Older links hold {n, u, k: secret}.
// PagePal and Word Helper read ?teacher= on any path, so these links also
// work when scanned or pasted inside either tool. The secret code (KEY) is
// never put in a new link: the join code is swapped for it.

export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/** Only Google Apps Script web app addresses are ever contacted. */
export function isInboxUrl(u) {
  return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(String(u || ''));
}

export function encodeTeacher({ name, url, join, expires, secret }) {
  const o = join ? { n: name, u: url, j: join, x: expires } : { n: name, u: url, k: secret };
  return b64urlEncode(JSON.stringify(o));
}

/**
 * CODE → {name, url, join, expires} (new links) or {name, url, secret}
 * (older links), or null if it isn't a class code we trust.
 */
export function decodeTeacher(code) {
  try {
    const o = JSON.parse(b64urlDecode(String(code)));
    if (!o || typeof o !== 'object' || !isInboxUrl(o.u)) return null;
    const name = String(o.n || 'my teacher').slice(0, 80);
    if (o.j) return { name, url: String(o.u), join: String(o.j), expires: Number(o.x) || 0 };
    if (o.k) return { name, url: String(o.u), secret: String(o.k) };
    return null;
  } catch {
    return null;
  }
}

/** Has a decoded class code run out? (Older codes with a key never expire.) */
export function isExpired(teacher, now = Date.now()) {
  return Boolean(teacher && teacher.join && teacher.expires && now > teacher.expires);
}

/** The ?teacher= value in some text (a link on any path), or null. */
export function teacherCodeFrom(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.searchParams.get('teacher');
}

/** The class link for a QR code: the join page with ?teacher=CODE. */
export function joinLink(joinPageUrl, teacher) {
  const u = new URL(joinPageUrl);
  u.search = '';
  u.hash = '';
  u.searchParams.set('teacher', encodeTeacher(teacher));
  return u.href;
}
