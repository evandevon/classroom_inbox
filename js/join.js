// Join page: a student scanned a class QR code with the iPad camera, or
// pasted a class link.
// Swap the join code for the sending key and save the connection where
// PagePal and Word Helper both look (same origin, so one save connects both).
// The key is never shown or logged, and the code leaves the address bar.

import { decodeTeacher, isExpired, teacherCodeFrom } from './links.js';
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

let teacher = null; // the class code being joined
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

/** Ask "Send your work to …?" for a decoded class code. */
function ask(found) {
  teacher = found;
  setClassName(teacher.name);
  const switching = existing && (existing.url !== teacher.url || existing.name !== teacher.name);
  $('#ask-switch').hidden = !switching;
  if (switching) $('#ask-switch').textContent = `This iPad sends work to ${existing.name} now. Saying yes sends it to ${teacher.name} instead.`;
  show('v-ask');
}

function showNone() {
  if (existing) {
    $('#none-current').hidden = false;
    $('#none-current').textContent = `This iPad sends work to ${existing.name}. To change that, scan a new class QR code or paste a class link.`;
  }
  show('v-none');
}

// A pasted class link: any web address with ?teacher=… (a Classroom Inbox,
// PagePal or Word Helper link), even inside a longer message, or the bare code.
function codeFromPaste(text) {
  const raw = String(text || '').trim();
  for (const m of raw.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const c = teacherCodeFrom(m.replace(/[).,;!?]+$/, ''));
    if (c) return c;
  }
  return /^[\w-]{20,}$/.test(raw) ? raw : null;
}

function pasteMessage(text) {
  $('#paste-msg').textContent = text;
  $('#paste-msg').hidden = !text;
}

$('#paste-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#paste-link').value;
  if (!text.trim()) return pasteMessage('Paste the class link your teacher shared first.');
  const pasted = codeFromPaste(text);
  const found = pasted ? decodeTeacher(pasted) : null;
  if (!found) return pasteMessage('That isn’t a class link. Copy the whole link your teacher shared (it starts with https:// and has ?teacher= in it), then paste it again.');
  if (isExpired(found)) return pasteMessage('That class link has expired. Ask your teacher for a new one.');
  pasteMessage('');
  $('#paste-link').value = '';
  ask(found);
});
$('#paste-link').addEventListener('input', () => pasteMessage(''));
document.querySelectorAll('.try-link').forEach(b => b.addEventListener('click', () => {
  showNone();
  $('#paste-link').focus();
}));
$('#yes').addEventListener('click', connect);
$('#retry').addEventListener('click', connect);
$('#no').addEventListener('click', () => show('v-no'));

if (code === null) {
  showNone();
} else {
  const found = decodeTeacher(code);
  if (!found) show('v-bad');
  else if (isExpired(found)) show('v-expired');
  else ask(found);
}
