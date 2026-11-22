// Talking to a teacher's inbox (their Google Apps Script web app).
// Every POST is a JSON body with no Content-Type header: a "simple"
// request, so the browser skips the CORS pre-flight Apps Script can't answer.

import { isInboxUrl } from './links.js';

/** The newest script version, as shipped in apps-script/Classroom-Inbox.gs. */
export const LATEST_VERSION = 6;

/** Where PagePal and Word Helper keep the connection (same origin, so shared). */
export const SETTINGS_KEY = 'pagepal.settings';

export async function postJson(url, body) {
  if (!isInboxUrl(url)) return { ok: false, error: 'bad-request' };
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    return { ok: false, error: 'network' };
  }
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : { ok: false, error: 'bad-reply' };
  } catch {
    return { ok: false, error: 'bad-reply' };
  }
}

/**
 * Visit the address (GET) to see what's deployed.
 * → {ok: true, version, tools, name} | {ok: false, error: 'network' | 'not-inbox'}
 */
export async function inboxInfo(url) {
  if (!isInboxUrl(url)) return { ok: false, error: 'not-inbox' };
  let info;
  try {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    info = await res.json();
  } catch {
    return { ok: false, error: 'network' };
  }
  if (!info || info.app !== 'PagePal Inbox') return { ok: false, error: 'not-inbox' };
  const version = Number(info.version) || 1;
  // Before version 4 the script took PagePal only and didn't list its tools.
  const tools = Array.isArray(info.tools) ? info.tools.map(String) : ['pagepal'];
  return { ok: true, version, tools, name: info.name ? String(info.name) : 'PagePal Inbox', paused: info.paused === true };
}

/** Teacher page: a new join code (this also proves the secret code is right). */
export function newJoinCode(url, secret, days, label) {
  return postJson(url, { action: 'newJoin', secret, days, label });
}

/** Join page: swap a class QR code's join code for the sending key. */
export function joinInbox(url, join) {
  return postJson(url, { action: 'join', join });
}

/** The saved connection {name, url, secret}, or null. */
export function readConnection(storage = localStorage) {
  try {
    const s = JSON.parse(storage.getItem(SETTINGS_KEY));
    const t = s && s.teacher;
    if (!t || typeof t !== 'object' || !isInboxUrl(t.url) || !t.secret) return null;
    return { name: String(t.name || 'my teacher').slice(0, 80), url: t.url, secret: String(t.secret) };
  } catch {
    return null;
  }
}

/** Save the connection where both tools look, keeping every other setting. */
export function saveConnection({ name, url, secret }, storage = localStorage) {
  let s = {};
  try { s = JSON.parse(storage.getItem(SETTINGS_KEY)) || {}; } catch { s = {}; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  s.teacher = { name, url, secret };
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const INBOX_ERRORS = {
  'wrong-code': 'Your teacher’s class QR code has changed. Ask your teacher for the new one.',
  'expired-join': 'That class QR code has expired. Ask your teacher for a new one.',
  busy: 'Your teacher’s inbox is very busy right now. Wait a minute and try again.',
  'too-big': 'That was too big to send. Tell your teacher.',
  network: 'Couldn’t reach your teacher’s inbox. Check the wifi and try again.',
  'bad-reply': 'Your teacher’s inbox didn’t answer properly. Tell your teacher.',
  'bad-request': 'Your teacher’s inbox didn’t understand the message. Tell your teacher.',
  server: 'Your teacher’s inbox had a problem. Tell your teacher.',
  paused: 'Your teacher’s inbox is turned off right now. Tell your teacher.',
};

export function inboxError(code) {
  return INBOX_ERRORS[code] || INBOX_ERRORS.server;
}
