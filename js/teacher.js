// Teacher page: the set-up guide, connecting to the inbox, class QR codes,
// and the list of tools the inbox accepts.

import qrcode from '../lib/qrcode.js';
import { isInboxUrl, joinLink } from './links.js';
import { inboxInfo, newJoinCode, LATEST_VERSION } from './inbox.js';
import { toolList } from './tools.js';

const $ = sel => document.querySelector(sel);
const JOIN_PAGE = new URL('join/', location.href).href;
const SAVED_KEY = 'classroomInbox.teacherPage';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function setStatus(el, kind, html) {
  el.className = 'status ' + kind;
  el.innerHTML = html;
  if (html) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copyText(text, done, el) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    if (el) { // fall back: select it so the teacher can press Ctrl + C
      el.closest('details') && (el.closest('details').open = true);
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Couldn’t copy automatically. It’s selected: press Ctrl + C (or ⌘ + C).', 6000);
    } else {
      toast('Couldn’t copy. Select the text and copy it yourself.');
    }
  }
}

// ── Step 1: the script and manifest ───────────────────

const files = { gs: '', json: '' };

async function loadText(url, el, key) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    files[key] = await res.text();
    el.textContent = files[key];
  } catch {
    el.textContent = 'Couldn’t load this file. Reload the page, or get it from GitHub (link at the bottom of the page).';
  }
}

loadText('apps-script/Classroom-Inbox.gs', $('#gs-text'), 'gs');
loadText('apps-script/appsscript.json', $('#json-text'), 'json');

$('#copy-gs').addEventListener('click', () => {
  if (!files.gs) return toast('The script is still loading. Try again in a moment.');
  copyText(files.gs, 'Script copied. Paste it into Code.gs.', $('#gs-text'));
});
$('#copy-json').addEventListener('click', () => {
  if (!files.json) return toast('Still loading. Try again in a moment.');
  copyText(files.json, 'Copied. Paste it into appsscript.json.', $('#json-text'));
});

// Deploy tabs: click, or arrow keys between them.
const tabs = [$('#tab-first'), $('#tab-update')];
function selectTab(tab, focus) {
  tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
  });
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab(tabs[(i + 1) % 2], true); }
  });
});

// ── Step 2: connect ───────────────────────────────────

const nameIn = $('#in-name'), urlIn = $('#in-url'), secretIn = $('#in-secret');

$('#show-secret').addEventListener('click', e => {
  const show = secretIn.type === 'password';
  secretIn.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(show));
});

// Remember the class name and address (never the secret code). The old
// PagePal teacher page saved the same two things, so start from those.
try {
  const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || localStorage.getItem('pagepal.teacherPage') || 'null');
  if (saved) { nameIn.value = saved.name || ''; urlIn.value = saved.url || ''; }
} catch { /* ignore */ }

function remember(name, url) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ name, url })); } catch { /* ignore */ }
}

const CHECKLIST = `<ul>
  <li>the address is the <strong>Web app URL</strong> from Deploy, ending in <code>/exec</code>;</li>
  <li>in <span class="path">Deploy › Manage deployments</span>, <strong>Execute as</strong> is Me and <strong>Who has access</strong> is Anyone;</li>
  <li>opening the address in a new tab shows <code>{"ok":true</code>.</li></ul>`;

const UPDATE_HOW = 'Update it: do step 1 again with the same sheet, choosing <strong>Updating</strong> at the end.';

let checked = null; // {url, version, tools} after a successful check

/** Reads the fields. Puts a message in el and returns null if something's missing. */
function readFields(el, needAll) {
  const name = nameIn.value.trim();
  const url = urlIn.value.trim();
  const secret = secretIn.value.trim();
  if (needAll && !name) { setStatus(el, 'error', 'Type the class name (step 2), as students know it.'); nameIn.focus(); return null; }
  if (!isInboxUrl(url)) {
    setStatus(el, 'error', 'The Web app URL (step 2) should start with <code>https://script.google.com/</code> and end in <code>/exec</code>. Copy it from <span class="path">Deploy › Manage deployments</span>.');
    urlIn.focus();
    return null;
  }
  if (needAll && !secret) {
    setStatus(el, 'error', 'Paste the secret code (step 2) from the Apps Script Execution log. Run <code>showStatus</code> to see it again.');
    secretIn.focus();
    return null;
  }
  return { name, url, secret };
}

/** GET the address and explain what's there. Returns the info, or null. */
async function check(el) {
  const f = readFields(el, false);
  if (!f) return null;
  setStatus(el, 'ok', 'Checking…');
  const info = await inboxInfo(f.url);
  if (!info.ok) {
    checked = null;
    renderTools(null);
    setStatus(el, 'error', info.error === 'not-inbox'
      ? 'That address answered, but it isn’t the Classroom Inbox script. Check you copied the Web app URL of the right project.'
      : 'Couldn’t reach your inbox. Check:' + CHECKLIST);
    return null;
  }
  checked = { url: f.url, ...info };
  if (nameIn.value.trim()) remember(nameIn.value.trim(), f.url); else remember('', f.url);
  renderTools(info.tools);
  const names = toolList(info.tools).filter(t => t.accepted).map(t => escapeHtml(t.name));
  const accepts = `It accepts work from ${names.join(' and ')}.`;
  if (info.version >= LATEST_VERSION) {
    setStatus(el, 'ok', `<p>Connected: Classroom Inbox, version ${info.version}. ${accepts}</p>` +
      '<p>The secret code is checked when you make the QR code.</p>');
  } else if (info.version >= 4) {
    setStatus(el, 'warn', `<p>Connected, but your script is version ${info.version}. ${accepts}</p>` +
      `<p>It still works. Version ${LATEST_VERSION} puts every tool’s work in one Classroom Inbox folder, with a spreadsheet each. ${UPDATE_HOW}</p>`);
  } else if (info.version >= 2) {
    setStatus(el, 'warn', `<p>Connected, but your script is version ${info.version}, which takes PagePal work only. Word Helper can’t send to it.</p><p>${UPDATE_HOW}</p>`);
  } else {
    setStatus(el, 'error', `<p>Your script is an early version that can’t make class QR codes.</p><p>${UPDATE_HOW}</p>`);
  }
  return checked;
}

$('#check').addEventListener('click', () => check($('#check-status')));
urlIn.addEventListener('change', () => { checked = null; });

// ── Step 3: class QR code ─────────────────────────────

function makeQr(text) {
  const qr = qrcode(0, 'M'); // size picked automatically, medium error correction
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

function qrSvg(qr, label) {
  const n = qr.getModuleCount(), m = 4, size = n + m * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(label)}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** A printable picture: QR code with the class and expiry underneath. */
function qrPng(qr, lines) {
  const n = qr.getModuleCount(), cell = 16, margin = 4 * cell, qrSize = n * cell + margin * 2;
  const c = document.createElement('canvas');
  c.width = qrSize;
  c.height = qrSize + 40 + lines.length * 52;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(margin + col * cell, margin + r * cell, cell, cell);
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? 'bold 44px system-ui, Arial, sans-serif' : '30px system-ui, Arial, sans-serif';
    ctx.fillStyle = i === 0 ? '#000' : '#333';
    ctx.fillText(line, c.width / 2, qrSize + 20 + i * 52, c.width - 40);
  });
  return new Promise(r => c.toBlob(r, 'image/png'));
}

const fileSlug = s => String(s).trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'class';

let current = null; // {qr, url, label, expiry}

$('#make').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const el = $('#make-status');
  $('#qr-result').hidden = true;
  const f = readFields(el, true);
  if (!f) return;
  btn.disabled = true;
  try {
    const info = checked && checked.url === f.url ? checked : await check($('#check-status'));
    if (!info) { setStatus(el, 'error', 'Couldn’t connect. See step 2.'); return; }
    if (info.version < 2) { setStatus(el, 'error', 'Your script needs updating before it can make class QR codes. See step 2.'); return; }
    setStatus(el, 'ok', 'Making the QR code…');
    const days = Number($('#in-days').value) || 7;
    const result = await newJoinCode(f.url, f.secret, days, f.name);
    if (!result.ok || !result.join) {
      setStatus(el, 'error', result.error === 'wrong-code'
        ? 'Your inbox answered, but the secret code doesn’t match. Copy it again from the Execution log (run <code>showStatus</code> to see it).'
        : result.error === 'busy' ? 'Your inbox is busy. Wait a minute and try again.'
          : 'Couldn’t make the QR code. Check:' + CHECKLIST);
      return;
    }
    remember(f.name, f.url);
    const url = joinLink(JOIN_PAGE, { name: f.name, url: f.url, join: result.join, expires: result.expires });
    const until = new Date(result.expires).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    current = { qr: makeQr(url), url, label: f.name, expiry: 'Connects new iPads until ' + until };
    $('#qr').innerHTML = qrSvg(current.qr, 'Class QR code for ' + f.name);
    $('#qr-label').textContent = f.name;
    $('#qr-expiry').textContent = current.expiry;
    $('#qr-link').textContent = url;
    setStatus(el, 'ok', 'Done. Print it, or show it on the board while students scan it.');
    $('#qr-result').hidden = false;
    requestAnimationFrame(() => $('#qr-result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } finally {
    btn.disabled = false;
  }
});

$('#qr-copy').addEventListener('click', () => copyText(current.url, 'Class link copied.', $('#qr-link')));
$('#qr-png').addEventListener('click', async () => {
  downloadBlob(await qrPng(current.qr, [current.label, 'Scan with the iPad camera', current.expiry]), `Class-QR-${fileSlug(current.label)}.png`);
});
$('#qr-print').addEventListener('click', () => {
  const section = $('#qr-result').closest('section');
  section.classList.add('printing');
  window.print();
  setTimeout(() => section.classList.remove('printing'), 500);
});

// ── Your tools ────────────────────────────────────────

function renderTools(accepted) {
  const list = toolList(accepted);
  $('#tools-lead').textContent = accepted
    ? 'Where each tool’s work goes, inside your Classroom Inbox folder.'
    : 'Check the connection (step 2) to see which tools your inbox accepts.';
  $('#tools').innerHTML = list.map(t => {
    const badge = t.accepted === null ? ''
      : t.accepted ? '<span class="badge yes">Accepted</span>'
        : '<span class="badge no">Needs the new script</span>';
    const icon = t.icon ? `<img src="${escapeHtml(t.icon)}" alt="">` : '<span class="tool-icon-blank" aria-hidden="true"></span>';
    const open = t.url ? ` <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">Open ${escapeHtml(t.name)}</a>` : '';
    return `<li class="tool">${icon}<div>
      <div class="tool-name">${escapeHtml(t.name)}${badge}</div>
      <p>${escapeHtml(t.what)}${open}</p>
      <p class="where">Work goes to: ${escapeHtml(t.where)}</p></div></li>`;
  }).join('');
}

renderTools(null);

// Tells the start-up check in the page that the code loaded.
window.__inboxReady = true;
