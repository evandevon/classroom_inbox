/**
 * Classroom Inbox (version 6)
 * Receives work that students send from PagePal, Word Helper and other
 * Classroom Inbox tools. Everything lives in one folder in your Google Drive:
 *
 *   Classroom Inbox/
 *     PagePal submissions/        ← "PagePal submissions" spreadsheet,
 *       Class/Worksheet/…pdf        and PDFs by class, then worksheet
 *     Word Helper submissions/    ← "Word Helper submissions" spreadsheet,
 *       Class/…pdf                  and PDFs by class
 *
 * This Google Sheet (the one the script is attached to) becomes the home
 * page: its Tools tab links to each tool's spreadsheet and folder, with a
 * count of what has arrived. One class QR code works for every tool.
 * You can rename the Classroom Inbox folder, or drag it anywhere in your
 * Drive: the script remembers folders by their ID, not their name.
 *
 * Set-up (the Classroom Inbox teacher page walks you through it):
 *   1. Paste this whole file into Extensions › Apps Script › Code.gs.
 *   2. Project Settings › tick "Show appsscript.json manifest file in editor",
 *      then replace appsscript.json with the one on the teacher page. That
 *      limits the script to this sheet and to files it creates itself.
 *   3. Click the + next to "Services" (left-hand side), choose
 *      "Google Sheets API", click Add.
 *   4. Run setup() and allow access. Read the summary in the Execution log.
 *   5. First time: Deploy › New deployment › Web app — Execute as: Me,
 *      Who has access: Anyone.
 *      Updating: Deploy › Manage deployments › pencil › Version: New version
 *      › Deploy. The address and your class QR codes stay the same.
 *
 * Security, in brief:
 *   - Class QR codes carry a JOIN code, not the sending key. A photographed
 *     QR code stops working when it expires. "Forever" codes never expire:
 *     cancelClassCodes() stops them (and all other class codes).
 *   - Sending needs the KEY, which an iPad only receives by joining.
 *   - resetCode() makes a new key: every iPad must scan a new QR code.
 *   - Files must really be JPEG, PNG, PDF, or (for a tool that records)
 *     MP3, M4A or WAV, checked by their contents; 5 MB at most each.
 *     Sends are rate-limited.
 *   - The spreadsheets hold no formulas: students' text is stored as text
 *     (and stays text if downloaded as CSV), and links are plain links,
 *     only to files this script made.
 *   - Nothing can be read back through the web address.
 *   - The script can only open this sheet and files it made itself,
 *     never your other files.
 *
 * Turning it off (pick one, in the function menu at the top, then Run):
 *   - cancelClassCodes(): new iPads can't join; joined iPads still send.
 *   - pauseInbox() / resumeInbox(): stop receiving anything for now, and
 *     turn it back on later. Same address, code and QR codes.
 *   - resetCode(): new secret code; every iPad must scan a new QR code.
 *   - For good: Deploy › Manage deployments › Archive. The web address then
 *     stops working. Your sheets and PDFs stay in your Drive until you
 *     delete them.
 *
 * Adding a tool: add one entry to TOOLS below, run setup(), deploy a new version.
 */

const VERSION = 6;
const TOP_FOLDER_NAME = 'Classroom Inbox';
const HOME_TAB_NAME = 'Tools';
const OLD_TAB_NAME = 'Submissions';              // PagePal's tab in this sheet, versions 1–4
const OLD_TAB_RENAME = 'PagePal (before v5)';
const MAX_FILE_BYTES = 5 * 1024 * 1024;          // a page picture is usually 0.2–0.5 MB
const MAX_BODY_CHARS = 16 * 1024 * 1024;         // whole request, as text
const MAX_PER_MINUTE = 60;                       // a class of 30 sending at once is fine
const MAX_PER_DAY = 1500;
const MAX_FOREVER_CODES = 20;                    // never-expiring class codes kept at once
const MAX_JOIN_DAYS = 80;                        // about one school term

// ── The tools ──────────────────────────────────────────
// One entry per tool. Each says where its work goes and how a submission
// becomes a row. The property names (…Prop) are where the script remembers
// the IDs of what it made; don't change them once a tool is in use.
//
//   name        shown in the Tools tab and the set-up summary
//   folder      its folder (inside Classroom Inbox); also its spreadsheet's name
//   headers     the spreadsheet's column headings
//   files       which uploads a submission may carry (each becomes a link column)
//   subFolders  folder path for a submission's files, e.g. ['3/4K', 'Fractions']
//   fileName    file name for its uploads (without .pdf / .jpg)
//   row         the row: text, numbers, or {file: 'pdf', label: 'View PDF'} for a link

const TOOLS = {
  pagepal: {
    name: 'PagePal',
    folder: 'PagePal submissions',
    where: 'PagePal submissions › Class › Worksheet',
    folderProp: 'FOLDER_ID', subsProp: 'SUBFOLDERS', sheetProp: 'PP_SHEET_ID', tabProp: 'PP_SHEET_TAB',
    headers: [
      'Received', 'Student', 'Worksheet', 'Class',
      'Time working (min)', 'Total time (min)', 'Words written',
      'Typed', 'Spoken', 'Suggestions', 'Spell corrections', 'Assistance %',
      'Times listened', 'Words listened to', 'Answer', 'Page', 'PDF', 'Notes',
    ],
    files: ['image', 'pdf'],
    subFolders: function (d, c) { return [c.classFolder, safeName_(worksheetOf_(d))]; },
    fileName: function (d, c) { return [c.label, worksheetOf_(d), c.stamp]; },
    row: function (d, c) {
      const st = c.stats;
      return [
        c.received, c.label, worksheetOf_(d), c.className,
        mins_(st.workingSecs), mins_(st.totalSecs), num_(st.wordsWritten),
        num_(st.typed), num_(st.dictated), num_(st.suggestion), num_(st.corrected), num_(st.assistanceRate),
        num_(st.listens), words_(st.wordsListened),
        text_(d.answer, 40000),
        { file: 'image', label: 'View page' }, { file: 'pdf', label: 'View PDF' },
        c.notes,
      ];
    },
  },
  'word-helper': {
    name: 'Word Helper',
    folder: 'Word Helper submissions',
    where: 'Word Helper submissions › Class',
    folderProp: 'WH_FOLDER_ID', subsProp: 'WH_SUBFOLDERS', sheetProp: 'WH_SHEET_ID', tabProp: 'WH_SHEET_TAB',
    headers: [
      'Received', 'Student', 'Class',
      'Time working (min)', 'Total time (min)', 'Words written',
      'Typed', 'Spoken', 'Suggestions', 'Spell corrections', 'Assistance %',
      'Times listened', 'Words listened to', 'Words defined', 'Writing', 'PDF', 'Notes',
    ],
    files: ['pdf'],
    subFolders: function (d, c) { return [c.classFolder]; },
    fileName: function (d, c) { return [c.label, 'Word Helper', c.stamp]; },
    row: function (d, c) {
      const st = c.stats;
      return [
        c.received, c.label, c.className,
        mins_(st.workingSecs), mins_(st.totalSecs), num_(st.wordsWritten),
        num_(st.typed), num_(st.dictated), num_(st.suggestion), num_(st.corrected), num_(st.assistanceRate),
        num_(st.listens), words_(st.wordsListened), words_(st.wordsDefined),
        text_(d.answer, 40000), { file: 'pdf', label: 'View PDF' }, c.notes,
      ];
    },
  },
};

function worksheetOf_(d) { return text_(d.worksheet, 100) || 'Worksheet'; }

function toolOf_(name) {
  return Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
}

// ── Files ──────────────────────────────────────────────
// A submission carries files in named slots: image, pdf, audio. A tool lists
// the slots it uses in TOOLS (files: [...]); each slot only takes its own
// kind of file. A file is saved only if its contents really are that type
// (checked by its first bytes, whatever the sender claims) and it is 5 MB
// or less. No tool sends audio yet: a recording tool would list 'audio'.

const SLOTS = {
  image: 'a JPEG or PNG picture',
  pdf: 'a PDF',
  audio: 'an MP3, M4A or WAV recording',
};

const FILE_TYPES = {
  'image/jpeg': { slot: 'image', ext: '.jpg', match: function (b) { return startsWith_(b, 0, [0xFF, 0xD8, 0xFF]); } },
  'image/png': { slot: 'image', ext: '.png', match: function (b) { return startsWith_(b, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); } },
  'application/pdf': { slot: 'pdf', ext: '.pdf', match: function (b) { return startsWith_(b, 0, [0x25, 0x50, 0x44, 0x46, 0x2D]); } }, // %PDF-
  // MP3: an "ID3" tag, or straight into an MPEG audio frame (11 sync bits).
  'audio/mpeg': { slot: 'audio', ext: '.mp3', match: function (b) {
    return startsWith_(b, 0, [0x49, 0x44, 0x33]) || (b.length > 1 && (b[0] & 0xFF) === 0xFF && (b[1] & 0xE0) === 0xE0);
  } },
  // M4A (what an iPad records): "ftyp" at byte 4.
  'audio/mp4': { slot: 'audio', ext: '.m4a', match: function (b) { return startsWith_(b, 4, [0x66, 0x74, 0x79, 0x70]); } },
  // WAV: "RIFF" … "WAVE".
  'audio/wav': { slot: 'audio', ext: '.wav', match: function (b) {
    return startsWith_(b, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith_(b, 8, [0x57, 0x41, 0x56, 0x45]);
  } },
};

// Other names browsers use for the same types.
const TYPE_ALIASES = {
  'image/jpg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg', 'audio/mpeg3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav',
};

/** 'audio/mp4;codecs=mp4a.40.2' → the FILE_TYPES entry, or null. */
function fileType_(type) {
  let t = String(type || '').split(';')[0].trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TYPE_ALIASES, t)) t = TYPE_ALIASES[t];
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, t) ? { mime: t, info: FILE_TYPES[t] } : null;
}

// ── Things you run from the editor ─────────────────────

/**
 * Makes (or checks) everything: the secret code, the Classroom Inbox folder,
 * each tool's folder and spreadsheet, and the Tools tab. Moves PagePal's old
 * rows across once. Safe to run again at any time.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('KEY')) props.setProperty('KEY', newCode_(24));
  const notes = [];
  try {
    topFolderId_();
    Object.keys(TOOLS).forEach(function (tool) {
      getFolderId_(tool);
      moveIntoTop_(tool, notes);
      withLock_(function () { return toolSheet_(tool); });
    });
    moveOldRows_(notes);
    Object.keys(TOOLS).forEach(recount_);
    writeHome_();
  } catch (err) {
    if (/Sheets API/.test(err.message)) {
      Logger.log('One more switch to turn on: in the Apps Script editor, click the + next to "Services" ' +
        '(left-hand side), choose "Google Sheets API", click Add, then run setup again.\n' +
        '(It lets this script fill in the spreadsheets it makes; it still can\'t open your other files.)');
    } else {
      Logger.log('Set-up stopped part-way: ' + err.message +
        '\nCheck that appsscript.json was replaced as the guide shows, then run setup again. ' +
        'Running it again is safe: it carries on from where it stopped.');
    }
    throw err;
  }
  logStatus_(notes);
}

/** Show the set-up summary again (where work goes, and the secret code). */
function showStatus() {
  logStatus_([]);
}

/**
 * Cancel every class QR code and link (including ones that never expire).
 * iPads that already joined keep sending; new iPads need a new QR code.
 */
function cancelClassCodes() {
  PropertiesService.getScriptProperties().deleteProperty('JOINS');
  Logger.log('All class QR codes and links are cancelled. iPads that already joined still send work.\n' +
    'Make a new class QR code on the Classroom Inbox teacher page when you need one.');
}

/** Turn the inbox off for now. Nothing is received until resumeInbox is run. */
function pauseInbox() {
  PropertiesService.getScriptProperties().setProperty('PAUSED', '1');
  Logger.log('The inbox is paused. Students who send work are told your inbox is turned off, and nothing is saved.\n' +
    'Run resumeInbox to turn it back on. Your web address, secret code and class QR codes stay the same.');
}

/** Turn the inbox back on after pauseInbox. */
function resumeInbox() {
  PropertiesService.getScriptProperties().deleteProperty('PAUSED');
  Logger.log('The inbox is on again.');
}

function isPaused_() {
  return PropertiesService.getScriptProperties().getProperty('PAUSED') === '1';
}

/** New secret code. Every iPad must scan a new class QR code afterwards. */
function resetCode() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('KEY', newCode_(24));
  props.deleteProperty('JOINS');
  Logger.log('New secret code: ' + props.getProperty('KEY') +
    '\nOn the Classroom Inbox teacher page, connect with the new code and make a new class QR code. ' +
    'Students scan it again.');
}

// ── The web app ────────────────────────────────────────

/** Visiting the address in a browser: a quick "is it working?" check. Reveals nothing. */
function doGet() {
  // app stays 'PagePal Inbox': Word Helper and older PagePal pages look for it.
  return json_({ ok: true, app: 'PagePal Inbox', name: 'Classroom Inbox', version: VERSION, tools: Object.keys(TOOLS), paused: isPaused_() });
}

function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (body.length > MAX_BODY_CHARS) return json_({ ok: false, error: 'too-big' });
  let data;
  try { data = JSON.parse(body || '{}'); } catch (err) { return json_({ ok: false, error: 'bad-request' }); }
  if (!data || typeof data !== 'object') return json_({ ok: false, error: 'bad-request' });
  try {
    if (isPaused_()) return json_({ ok: false, error: 'paused' });
    if (!withLock_(underRateLimit_)) return json_({ ok: false, error: 'busy' });
    if (data.action === 'join') return json_(withLock_(function () { return join_(data); }));
    if (data.action === 'newJoin') return json_(withLock_(function () { return newJoin_(data); }));
    return json_(submit_(data));
  } catch (err) {
    if (err && err.message === 'busy') return json_({ ok: false, error: 'busy' });
    return json_({ ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 200) });
  }
}

/**
 * Run fn while holding the script lock. Only short bookkeeping happens
 * inside it; slow uploads happen outside, so a whole class can send at once.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── Joining (class QR codes) ───────────────────────────

/** The teacher page asks for a join code (proving it knows the key). */
function newJoin_(data) {
  const props = PropertiesService.getScriptProperties();
  if (!sameCode_(data.secret, props.getProperty('KEY'))) return { ok: false, error: 'wrong-code' };
  // days: 1–80, or 'forever' (lasts until cancelClassCodes or resetCode; expires is then 0)
  const forever = data.days === 'forever';
  const days = Math.max(1, Math.min(MAX_JOIN_DAYS, Number(data.days) || 7));
  const joins = liveJoins_();
  if (forever) {
    const kept = Object.keys(joins).filter(function (k) { return joins[k].forever; });
    if (kept.length >= MAX_FOREVER_CODES) return { ok: false, error: 'too-many-codes' };
  }
  const join = newCode_(16);
  const expires = forever ? 0 : Date.now() + days * 86400000;
  joins[join] = forever ? { exp: 0, forever: true, label: text_(data.label, 80) } : { exp: expires, label: text_(data.label, 80) };
  props.setProperty('JOINS', JSON.stringify(joins));
  return { ok: true, join: join, expires: expires };
}

/** An iPad scanned a class QR code: swap the join code for the sending key. */
function join_(data) {
  const props = PropertiesService.getScriptProperties();
  const joins = liveJoins_();
  const code = String(data.join || '');
  const entry = Object.prototype.hasOwnProperty.call(joins, code) ? joins[code] : null;
  if (!entry) return { ok: false, error: 'expired-join' };
  return { ok: true, key: props.getProperty('KEY'), name: entry.label };
}

/** Join codes that haven't expired (expired ones are tidied away). */
function liveJoins_() {
  const props = PropertiesService.getScriptProperties();
  let joins = {};
  try { joins = JSON.parse(props.getProperty('JOINS') || '{}'); } catch (err) { joins = {}; }
  const now = Date.now();
  Object.keys(joins).forEach(function (k) { if (!joins[k].forever && !(joins[k].exp > now)) delete joins[k]; });
  return joins;
}

// ── Receiving work ─────────────────────────────────────

function submit_(data) {
  if (!sameCode_(data.secret, PropertiesService.getScriptProperties().getProperty('KEY'))) {
    return { ok: false, error: 'wrong-code' };
  }
  const toolName = data.tool === undefined ? 'pagepal' : String(data.tool);
  const t = toolOf_(toolName);
  if (!t) return { ok: false, error: 'bad-request' };

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const student = text_(data.student, 80) || 'Unknown';
  const className = text_(data.className, 80);
  const notes = [];
  const c = {
    label: (data.test ? 'TEST ' : '') + student,
    className: className,
    classFolder: safeName_(className) || 'My class',
    received: Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm'),
    stamp: Utilities.formatDate(now, tz, 'yyyy-MM-dd HHmm'),
    stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
    notes: '',
  };

  // Uploads go in the tool's folder, e.g. PagePal submissions › 3/4K › Fractions,
  // named "Student – Worksheet – date time.pdf" so they sort by student.
  const links = {};
  const uploads = t.files.filter(function (k) { return data[k] && data[k].base64; });
  if (uploads.length) {
    const folderId = withLock_(function () { return subFolderId_(toolName, t.subFolders(data, c)); });
    const fileName = t.fileName(data, c).map(safeName_).join(' – ');
    uploads.forEach(function (k) { links[k] = saveFile_(folderId, data[k], fileName, notes, k); });
  }
  c.notes = notes.join(' ');

  const row = t.row(data, c).map(function (v) {
    return v && typeof v === 'object' ? { link: links[v.file] || '', label: v.label } : v;
  });
  addRow_(toolName, row);
  try { withLock_(function () { recordArrival_(toolName, c.received); }); } catch (err) { /* the row is safe; the count can wait */ }
  return { ok: true, warnings: notes };
}

/** Add a row to a tool's spreadsheet, making the spreadsheet again if it was deleted. */
function addRow_(tool, row) {
  let target = withLock_(function () { return toolSheet_(tool); });
  try {
    appendCells_(target, [row]);
  } catch (err) {
    if (!/Google error (404|403|400)/.test(err.message)) throw err;
    // Deleted in the last few minutes (the "it exists" check is remembered for 10).
    CacheService.getScriptCache().remove('exists-' + target.id);
    target = withLock_(function () { return toolSheet_(tool); });
    appendCells_(target, [row]);
  }
}

/**
 * file = {type: 'image/jpeg', base64: '...'} in slot 'image', 'pdf' or
 * 'audio'. Saved only if it's the slot's kind of file, its contents really
 * are that type, and it's 5 MB or less. Returns a Drive link or ''.
 */
function saveFile_(folderId, file, baseName, notes, slot) {
  if (!file || !file.base64) return '';
  const ft = fileType_(file.type);
  if (!ft || ft.info.slot !== slot) { notes.push('File refused: not ' + (SLOTS[slot] || 'an accepted file') + '.'); return ''; }
  if (String(file.base64).length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) { notes.push('File refused: over 5 MB.'); return ''; }
  let bytes;
  try { bytes = Utilities.base64Decode(String(file.base64)); } catch (err) { notes.push('File refused: damaged.'); return ''; }
  if (bytes.length > MAX_FILE_BYTES) { notes.push('File refused: over 5 MB.'); return ''; }
  if (!ft.info.match(bytes)) { notes.push('File refused: contents don’t match a ' + ft.info.ext + ' file.'); return ''; }
  const blob = Utilities.newBlob(bytes, ft.mime, baseName + ft.info.ext);
  return driveUpload_(blob, folderId);
}

function startsWith_(bytes, at, sig) {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if ((bytes[at + i] & 0xFF) !== sig[i]) return false;
  return true;
}

// ── Google Drive and Sheets, limited to files this script creates ───
// (Apps Script's built-in DriveApp and SpreadsheetApp.openById ask for your
//  whole Drive or every spreadsheet, so the Drive and Sheets APIs are used
//  directly with the narrower "drive.file" permission.)

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function driveCall_(method, url, payload, contentType) {
  const options = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (payload !== undefined) { options.payload = payload; options.contentType = contentType; }
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('Google error ' + code + ': ' + res.getContentText().slice(0, 300));
  const text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

function createFile_(name, mimeType, parentId) {
  const meta = { name: name, mimeType: mimeType };
  if (parentId) meta.parents = [parentId];
  return driveCall_('post', DRIVE + '?fields=id', JSON.stringify(meta), 'application/json').id;
}

/** Is this file or folder still there (and not in the bin)? */
function fileExists_(id) {
  const cache = CacheService.getScriptCache();
  if (cache.get('exists-' + id)) return true; // checked in the last 10 minutes
  try {
    const f = driveCall_('get', DRIVE + '/' + encodeURIComponent(id) + '?fields=id,trashed');
    if (f.trashed) return false;
    cache.put('exists-' + id, '1', 600);
    return true;
  } catch (err) {
    return false;
  }
}

/** The Classroom Inbox folder, made if it's missing or was deleted. */
function topFolderId_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('TOP_FOLDER_ID');
  if (id && fileExists_(id)) return id;
  const created = createFile_(TOP_FOLDER_NAME, FOLDER_MIME);
  props.setProperty('TOP_FOLDER_ID', created);
  return created;
}

/** A tool's folder, made inside Classroom Inbox if it's missing or was deleted. */
function getFolderId_(tool) {
  const t = TOOLS[tool];
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(t.folderProp);
  if (id && fileExists_(id)) return id;
  const created = createFile_(t.folder, FOLDER_MIME, topFolderId_());
  props.setProperty(t.folderProp, created);
  props.deleteProperty(t.subsProp);
  setMoved_(tool, created); // made in the right place already
  return created;
}

function movedMap_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('MOVED') || '{}'); } catch (err) { return {}; }
}

function setMoved_(tool, folderId) {
  const moved = movedMap_();
  moved[tool] = folderId;
  PropertiesService.getScriptProperties().setProperty('MOVED', JSON.stringify(moved));
}

/**
 * Folders made by earlier versions sit at the top of My Drive: move each
 * into Classroom Inbox, once. After that, the teacher may move them anywhere.
 */
function moveIntoTop_(tool, notes) {
  const t = TOOLS[tool];
  const folderId = PropertiesService.getScriptProperties().getProperty(t.folderProp);
  if (!folderId || movedMap_()[tool] === folderId) return;
  const top = topFolderId_();
  try {
    const f = driveCall_('get', DRIVE + '/' + encodeURIComponent(folderId) + '?fields=parents');
    const parents = f.parents || [];
    if (parents.indexOf(top) < 0) {
      let url = DRIVE + '/' + encodeURIComponent(folderId) + '?fields=id,parents&addParents=' + encodeURIComponent(top);
      if (parents.length) url += '&removeParents=' + encodeURIComponent(parents.join(','));
      driveCall_('patch', url, '{}', 'application/json');
    }
    setMoved_(tool, folderId);
  } catch (err) {
    if (!/Google error (403|404)/.test(err.message)) throw err; // a hiccup: try again next run
    notes.push('Couldn’t move the "' + t.folder + '" folder into ' + TOP_FOLDER_NAME +
      ' (perhaps you put it in a folder of your own). Drag it there yourself if you want it there: ' +
      folderLink_(folderId));
    setMoved_(tool, folderId); // don't keep trying; the teacher decides where it lives
  }
}

/**
 * Nested sub-folders, e.g. ['3/4K', 'Fractions page 12'], each made once and
 * remembered by its path. Names that differ only in capitals share a folder.
 */
function subFolderId_(tool, names) {
  const props = PropertiesService.getScriptProperties();
  const subsProp = TOOLS[tool].subsProp;
  let map = {};
  try { map = JSON.parse(props.getProperty(subsProp) || '{}'); } catch (err) { map = {}; }
  let parent = getFolderId_(tool), path = '', changed = false;
  names.forEach(function (name) {
    path += '/' + name.toLowerCase();
    if (!(map[path] && fileExists_(map[path]))) { map[path] = createFile_(name, FOLDER_MIME, parent); changed = true; }
    parent = map[path];
  });
  if (changed) props.setProperty(subsProp, JSON.stringify(map));
  return parent;
}

/**
 * A tool's spreadsheet: {id, tab}. Made by this script inside the tool's
 * folder (so "drive.file" covers it), and made again if deleted. Each step is
 * saved as soon as it's done, so a set-up that stops part-way carries on.
 */
function toolSheet_(tool) {
  const t = TOOLS[tool];
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(t.sheetProp);
  if (id && fileExists_(id)) {
    const ready = props.getProperty(t.tabProp);
    if (ready !== null) return { id: id, tab: Number(ready) };
    // made on an earlier run that stopped part-way: finish preparing it below
  } else {
    id = createFile_(t.folder, SHEET_MIME, getFolderId_(tool));
    props.setProperty(t.sheetProp, id);
    props.deleteProperty(t.tabProp);
    setCount_(tool, 0, '');
  }
  const info = driveCall_('get', SHEETS + '/' + encodeURIComponent(id) + '?fields=sheets.properties.sheetId');
  const tab = info.sheets[0].properties.sheetId;
  driveCall_('post', SHEETS + '/' + encodeURIComponent(id) + ':batchUpdate', JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: tab, title: 'Submissions', gridProperties: { frozenRowCount: 1 } },
      fields: 'title,gridProperties.frozenRowCount' } },
  ] }), 'application/json');
  appendCells_({ id: id, tab: tab }, [t.headers], true);
  props.setProperty(t.tabProp, String(tab)); // marks it ready
  try { writeHomeRow_(tool); } catch (err) { /* setup writes the Tools tab anyway */ }
  return { id: id, tab: tab };
}

/**
 * Add rows to a sheet through the Sheets API. Text goes in as plain text
 * (stringValue: never a formula, whatever it starts with); {link, label}
 * becomes a plain link, only to Drive files this script made.
 */
function appendCells_(target, rows, bold) {
  const cellOf = function (v) {
    if (v && typeof v === 'object') {
      if (!isOwnLink_(v.link)) return {};
      return { userEnteredValue: { stringValue: String(v.label) }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: v.link } } }] };
    }
    if (typeof v === 'number' && isFinite(v)) return { userEnteredValue: { numberValue: v } };
    if (v === '' || v === null || v === undefined) return {};
    const c = { userEnteredValue: { stringValue: csvSafe_(String(v)) } };
    if (bold) c.userEnteredFormat = { textFormat: { bold: true } };
    return c;
  };
  for (let i = 0; i < rows.length; i += 500) {
    const body = { requests: [{ appendCells: {
      sheetId: target.tab,
      rows: rows.slice(i, i + 500).map(function (r) { return { values: r.map(cellOf) }; }),
      fields: '*',
    } }] };
    driveCall_('post', SHEETS + '/' + encodeURIComponent(target.id) + ':batchUpdate', JSON.stringify(body), 'application/json');
  }
}

/**
 * Text that starts like a formula (= + - @, or a tab or return) gets an
 * invisible word joiner in front. In Sheets it's plain text either way; this
 * keeps it text if the sheet is downloaded as CSV and opened in Excel.
 * Teachers' own formulas are untouched: this only applies to what the
 * script writes.
 */
function csvSafe_(s) {
  return /^[=+\-@\t\r]/.test(s) ? '\u2060' + s : s;
}

/** Links in the spreadsheets may only point to Drive files. */
function isOwnLink_(url) {
  return /^https:\/\/drive\.google\.com\/[\w\/?=&.-]+$/.test(url || '') ||
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+$/.test(url || '');
}

function folderLink_(id) { return 'https://drive.google.com/drive/folders/' + id; }
function sheetLink_(id) { return 'https://docs.google.com/spreadsheets/d/' + id; }

/** A name that's safe and tidy as a Drive file or folder name. */
function safeName_(s) {
  return String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function driveUpload_(blob, folderId) {
  const boundary = 'inbox' + newCode_(12);
  const meta = JSON.stringify({ name: blob.getName(), parents: [folderId] });
  const head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  const body = head.concat(blob.getBytes(), tail);
  const file = driveCall_('post',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    body, 'multipart/related; boundary=' + boundary);
  return file.webViewLink || ('https://drive.google.com/file/d/' + file.id + '/view');
}

// ── Moving PagePal's old rows (one time) ───────────────
// Versions 1–4 put PagePal work in a "Submissions" tab of this sheet (and
// Word Helper test rows, Worksheet = "Word Helper", sometimes landed there
// too). Copy them into the tools' own spreadsheets, then rename the tab.
// Progress is saved after every step, so a set-up that stops part-way
// carries on without copying anything twice.

function moveOldRows_(notes) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName(OLD_TAB_NAME);
  if (!old) return;
  const tabId = String(old.getSheetId());
  let done = {};
  try { done = JSON.parse(props.getProperty('OLD_ROWS') || '{}'); } catch (err) { done = {}; }
  const state = done[tabId] || { pagepal: 0, 'word-helper': 0, renamed: false };
  if (state.renamed) return;

  const lastRow = old.getLastRow();
  if (lastRow < 2) return; // no rows to move: leave it alone (checked again next time)
  {
    const width = Math.max(old.getLastColumn(), 1);
    const head = old.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    const range = old.getRange(2, 1, lastRow - 1, width);
    const values = range.getValues();
    const rich = range.getRichTextValues();
    const col = function (name) { return head.indexOf(name); };
    const tz = Session.getScriptTimeZone();
    const get = function (r, name) {
      const i = col(name);
      if (i < 0) return '';
      const v = values[r][i];
      if (v instanceof Date || (v && typeof v.getTime === 'function' && typeof v.getFullYear === 'function')) {
        return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
      }
      return v === null || v === undefined ? '' : v;
    };
    const link = function (r, name, label) {
      const i = col(name);
      if (i < 0 || !rich[r][i]) return '';
      const url = rich[r][i].getLinkUrl();
      return url ? { link: url, label: label } : '';
    };
    const byTool = { pagepal: [], 'word-helper': [] };
    for (let r = 0; r < values.length; r++) {
      if (values[r].every(function (v) { return v === '' || v === null; })) continue;
      const fromWordHelper = String(get(r, 'Worksheet')).trim() === 'Word Helper';
      if (fromWordHelper) {
        byTool['word-helper'].push(TOOLS['word-helper'].headers.map(function (h) {
          if (h === 'Writing') return get(r, 'Answer');
          if (h === 'PDF') return link(r, 'PDF', 'View PDF');
          return get(r, h);
        }));
      } else {
        byTool.pagepal.push(TOOLS.pagepal.headers.map(function (h) {
          if (h === 'Page') return link(r, 'Page', 'View page');
          if (h === 'PDF') return link(r, 'PDF', 'View PDF');
          return get(r, h);
        }));
      }
    }
    ['pagepal', 'word-helper'].forEach(function (tool) {
      const rows = byTool[tool];
      while (state[tool] < rows.length) {
        const chunk = rows.slice(state[tool], state[tool] + 500);
        appendCells_(withLock_(function () { return toolSheet_(tool); }), chunk);
        state[tool] += chunk.length;
        done[tabId] = state;
        props.setProperty('OLD_ROWS', JSON.stringify(done)); // saved after every chunk
      }
      if (rows.length) notes.push('Moved ' + rows.length + ' earlier ' + TOOLS[tool].name + ' row' +
        (rows.length === 1 ? '' : 's') + ' into its spreadsheet.');
    });
  }

  let name = OLD_TAB_RENAME, n = 2;
  while (ss.getSheetByName(name)) name = OLD_TAB_RENAME + ' ' + n++;
  old.setName(name);
  state.renamed = true;
  done[tabId] = state;
  props.setProperty('OLD_ROWS', JSON.stringify(done));
  notes.push('The old "' + OLD_TAB_NAME + '" tab is now called "' + name + '". It has not been deleted.');
}

// ── The Tools tab (home page) ──────────────────────────

const HOME_HEADERS = ['Tool', 'Spreadsheet', 'Folder', 'Rows received', 'Last received'];

function homeTab_(create) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = props.getProperty('HOME_TAB');
  if (id !== null) {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) if (String(sheets[i].getSheetId()) === id) return sheets[i];
  }
  if (!create) return null;
  let sheet = ss.getSheetByName(HOME_TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(HOME_TAB_NAME, 0);
  props.setProperty('HOME_TAB', String(sheet.getSheetId()));
  return sheet;
}

/** Rewrite the whole Tools tab (set-up only). */
function writeHome_() {
  const sheet = homeTab_(true);
  sheet.clear();
  sheet.getRange(1, 1, 1, HOME_HEADERS.length).setValues([HOME_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  Object.keys(TOOLS).forEach(writeHomeRow_);
  const note = Object.keys(TOOLS).length + 3;
  sheet.getRange(note, 1).setValue('Each tool keeps its own spreadsheet and folder inside the ' + TOP_FOLDER_NAME +
    ' folder. You can rename that folder or move it anywhere in your Drive.');
}

function homeRow_(tool) { return Object.keys(TOOLS).indexOf(tool) + 2; }

/** One tool's line in the Tools tab: name, links, count, last arrival. */
function writeHomeRow_(tool) {
  const sheet = homeTab_(false);
  if (!sheet) return;
  const t = TOOLS[tool];
  const props = PropertiesService.getScriptProperties();
  const r = homeRow_(tool);
  const count = counts_()[tool] || { n: 0, last: '' };
  sheet.getRange(r, 1).setValue(t.name);
  setLink_(sheet.getRange(r, 2), props.getProperty(t.sheetProp) && sheetLink_(props.getProperty(t.sheetProp)), t.folder);
  setLink_(sheet.getRange(r, 3), props.getProperty(t.folderProp) && folderLink_(props.getProperty(t.folderProp)), t.where);
  sheet.getRange(r, 4, 1, 2).setValues([[count.n, count.last]]);
}

function counts_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('COUNTS') || '{}'); } catch (err) { return {}; }
}

function setCount_(tool, n, last) {
  const all = counts_();
  all[tool] = { n: n, last: last };
  PropertiesService.getScriptProperties().setProperty('COUNTS', JSON.stringify(all));
}

/** After each submission: two cells in the Tools tab. Cheap, and never stops a send. */
function recordArrival_(tool, when) {
  const c = counts_()[tool] || { n: 0, last: '' };
  setCount_(tool, c.n + 1, when);
  const sheet = homeTab_(false);
  if (sheet) sheet.getRange(homeRow_(tool), 4, 1, 2).setValues([[c.n + 1, when]]);
}

/** Set-up: count the rows already in a tool's spreadsheet. */
function recount_(tool) {
  const target = withLock_(function () { return toolSheet_(tool); });
  const info = driveCall_('get', SHEETS + '/' + encodeURIComponent(target.id) + '?fields=sheets.properties(sheetId,title)');
  const tab = (info.sheets || []).filter(function (s) { return s.properties.sheetId === target.tab; })[0];
  if (!tab) return;
  const range = "'" + tab.properties.title.replace(/'/g, "''") + "'!A2:A";
  const got = driveCall_('get', SHEETS + '/' + encodeURIComponent(target.id) + '/values/' + encodeURIComponent(range));
  const rows = (got.values || []).filter(function (r) { return r && r[0] !== undefined && r[0] !== ''; });
  setCount_(tool, rows.length, rows.length ? String(rows[rows.length - 1][0]) : '');
}

// ── The set-up summary ─────────────────────────────────

function logStatus_(notes) {
  const props = PropertiesService.getScriptProperties();
  const lines = ['Classroom Inbox (version ' + VERSION + ') is set up.', ''];
  const top = props.getProperty('TOP_FOLDER_ID');
  if (top) lines.push('Everything is in the "' + TOP_FOLDER_NAME + '" folder: ' + folderLink_(top), '');
  const counts = counts_();
  Object.keys(TOOLS).forEach(function (tool) {
    const t = TOOLS[tool];
    const n = (counts[tool] || {}).n || 0;
    lines.push(t.name + ' (' + n + ' row' + (n === 1 ? '' : 's') + ' so far)');
    if (props.getProperty(t.sheetProp)) lines.push('  Spreadsheet: ' + sheetLink_(props.getProperty(t.sheetProp)));
    if (props.getProperty(t.folderProp)) lines.push('  Files: ' + t.where + '  ' + folderLink_(props.getProperty(t.folderProp)));
  });
  lines.push('', 'This sheet’s "' + HOME_TAB_NAME + '" tab has the same links, with counts.');
  const live = liveJoins_();
  const forever = Object.keys(live).filter(function (k) { return live[k].forever; }).length;
  lines.push('Class QR codes working now: ' + Object.keys(live).length +
    (forever ? ' (' + forever + ' never expire; run cancelClassCodes to stop them)' : ''));
  if (isPaused_()) lines.push('The inbox is PAUSED: nothing is being received. Run resumeInbox to turn it back on.');
  if (notes.length) {
    lines.push('', 'Also:');
    notes.forEach(function (n) { lines.push('  - ' + n); });
  }
  lines.push('',
    'Your secret code is: ' + props.getProperty('KEY'),
    'Paste it into the Classroom Inbox teacher page to make your class QR code. Keep it private.',
    '',
    'Next: deploy. First time: Deploy › New deployment › Web app (Execute as: Me, Who has access: Anyone).',
    'Updating: Deploy › Manage deployments › pencil › Version: New version › Deploy.');
  Logger.log(lines.join('\n'));
}

// ── Helpers ────────────────────────────────────────────

/** Limits how fast the sheets can be filled, so a leaked code can't flood them. */
function underRateLimit_() {
  const cache = CacheService.getScriptCache();
  const minuteKey = 'm' + Math.floor(Date.now() / 60000);
  const perMinute = Number(cache.get(minuteKey) || 0) + 1;
  cache.put(minuteKey, String(perMinute), 120);
  if (perMinute > MAX_PER_MINUTE) return false;
  const props = PropertiesService.getScriptProperties();
  const dayKey = 'day-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  let day = { key: '', n: 0 };
  try { day = JSON.parse(props.getProperty('DAYCOUNT') || '{"key":"","n":0}'); } catch (err) { /* reset */ }
  if (day.key !== dayKey) day = { key: dayKey, n: 0 };
  day.n += 1;
  props.setProperty('DAYCOUNT', JSON.stringify(day));
  return day.n <= MAX_PER_DAY;
}

function newCode_(length) {
  let s = '';
  while (s.length < length) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, length);
}

/** Compare codes without leaking how much matched through timing. */
function sameCode_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function text_(value, max) {
  return value === undefined || value === null ? '' : String(value).slice(0, max).trim();
}

function words_(list) {
  return text_((Array.isArray(list) ? list : []).join(', '), 2000);
}

function num_(n) {
  return typeof n === 'number' && isFinite(n) ? n : '';
}

function mins_(secs) {
  return typeof secs === 'number' && isFinite(secs) ? Math.round(secs / 6) / 10 : '';
}

/** A plain clickable link (no formula), only to Drive files this script made. */
function setLink_(range, url, label) {
  if (!isOwnLink_(url)) { range.setValue(''); return; }
  range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(url).build());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
