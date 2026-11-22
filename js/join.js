// Join page: a student scanned a class QR code with the iPad camera.
// Swap the join code for the sending key and save the connection where
// PagePal and Word Helper both look (same origin, so one save connects both).
// The key is never shown or logged, and the code leaves the address bar.

import { decodeTeacher, isExpired } from './links.js';
import { joinInbox, readConnection, saveConnection, inboxError } from './inbox.js';
import { KNOWN_TOOLS } from './tools.js';

const $ = sel => document.querySelector(sel);

function show(id) {
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== id; });
  const h = $('#' + id + ' h1');
  if (h) h.focus({ preventScroll: true });
}

function setClassName(name) {
  document.querySelectorAll('.class-name').forEach(el => { el.textContent = name; });
}

const params = new URLSearchParams(location.search);
const code = params.get('teacher');
// Take the code out of the address bar (and history) straight away.
if (code !== null) history.replaceState(null, '', location.pathname + location.hash);

const teacher = code ? decodeTeacher(code) : null;
const existing = readConnection();

function toolButtons() {
  $('#tool-buttons').innerHTML = '';
  Object.values(KNOWN_TOOLS).forEach(t => {
    const a = document.createElement('a');
    a.className = 'btn primary';
    a.href = t.url;
    const img = document.createElement('img');
    img.src = t.icon;
    img.alt = '';
    a.append(img, 'Open ' + t.name);
    $('#tool-buttons').append(a);
  });
  $('#connect-hints').textContent = Object.values(KNOWN_TOOLS)
    .map(t => `“${t.connect}” in ${t.name}`).join(' or ');
}

async function connect() {
  show('v-working');
  let saved;
  if (teacher.join) {
    const result = await joinInbox(teacher.url, teacher.join);
    if (!result.ok || !result.key) {
      if (result.error === 'expired-join') return show('v-expired');
      $('#error-msg').textContent = inboxError(result.ok ? 'bad-reply' : result.error);
      return show('v-error');
    }
    saved = { name: teacher.name, url: teacher.url, secret: String(result.key) };
  } else {
    saved = { name: teacher.name, url: teacher.url, secret: teacher.secret }; // an older link with the key in it
  }
  if (!saveConnection(saved)) {
    $('#error-msg').textContent = 'This browser won’t let the page save the connection. If Private Browsing is on, turn it off and scan the QR code again.';
    return show('v-error');
  }
  toolButtons();
  show('v-done');
}

if (code === null) {
  if (existing) {
    $('#none-current').hidden = false;
    $('#none-current').textContent = `This iPad sends work to ${existing.name}. To change that, scan a new class QR code.`;
  }
  show('v-none');
} else if (!teacher) {
  show('v-bad');
} else if (isExpired(teacher)) {
  show('v-expired');
} else {
  setClassName(teacher.name);
  if (existing && (existing.url !== teacher.url || existing.name !== teacher.name)) {
    $('#ask-switch').hidden = false;
    $('#ask-switch').textContent = `This iPad sends work to ${existing.name} now. Saying yes sends it to ${teacher.name} instead.`;
  }
  show('v-ask');
  $('#yes').addEventListener('click', connect);
  $('#retry').addEventListener('click', connect);
  $('#no').addEventListener('click', () => show('v-no'));
}
