// The Classroom Inbox Apps Script, run against stand-in Google services.
// Run: node --test tests/inbox.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { load, FakeGoogle, FakeSpreadsheet, PDF, JPEG } from './gs-mock.mjs';

const SHEET = 'application/vnd.google-apps.spreadsheet';
const FOLDER = 'application/vnd.google-apps.folder';

function ready() {
  const env = load();
  env.setup();
  return env;
}

const key = env => env.store.get('KEY');
const sheetFile = (env, prop) => env.google.files.get(env.store.get(prop));
const rowsOf = (env, prop) => sheetFile(env, prop).sheets[0].rows.map(r => r.values.map(cellText));
function cellText(c) {
  const v = c && c.userEnteredValue;
  if (!v) return '';
  return 'stringValue' in v ? v.stringValue : v.numberValue;
}
const linkOf = c => (c && c.textFormatRuns ? c.textFormatRuns[0].format.link.uri : null);
const toolsTab = env => env.ss.sheets.find(s => String(s.id) === env.store.get('HOME_TAB'));

/** Everything that should be true after a finished setup, however many times it ran. */
function assertSetUp(env) {
  const g = env.google;
  const tops = g.byName('Classroom Inbox');
  assert.equal(tops.length, 1, 'one Classroom Inbox folder');
  const top = tops[0];
  assert.equal(env.store.get('TOP_FOLDER_ID'), top.id);
  for (const [name, folderProp, sheetProp, headers] of [
    ['PagePal submissions', 'FOLDER_ID', 'PP_SHEET_ID', 18],
    ['Word Helper submissions', 'WH_FOLDER_ID', 'WH_SHEET_ID', 17],
  ]) {
    const folders = g.byName(name).filter(f => f.mimeType === FOLDER);
    const sheets = g.byName(name).filter(f => f.mimeType === SHEET);
    assert.equal(folders.length, 1, 'one ' + name + ' folder');
    assert.equal(sheets.length, 1, 'one ' + name + ' spreadsheet');
    assert.deepEqual(folders[0].parents, [top.id], name + ' folder is inside Classroom Inbox');
    assert.deepEqual(sheets[0].parents, [folders[0].id], name + ' spreadsheet is inside its folder');
    assert.equal(env.store.get(folderProp), folders[0].id);
    assert.equal(env.store.get(sheetProp), sheets[0].id);
    const tab = sheets[0].sheets[0];
    assert.equal(tab.properties.title, 'Submissions');
    assert.equal(tab.rows[0].values.length, headers, 'header row');
    assert.equal(tab.rows.filter(r => cellText(r.values[0]) === 'Received').length, 1, 'headers written once');
  }
  const home = toolsTab(env);
  assert.ok(home, 'Tools tab');
  assert.equal(env.ss.sheets.filter(s => s.name === 'Tools').length, 1);
  assert.deepEqual(home.text()[0], ['Tool', 'Spreadsheet', 'Folder', 'Rows received', 'Last received']);
  assert.equal(home.get(2, 1).v, 'PagePal');
  assert.equal(home.get(2, 2).link, 'https://docs.google.com/spreadsheets/d/' + env.store.get('PP_SHEET_ID'));
  assert.equal(home.get(2, 3).link, 'https://drive.google.com/drive/folders/' + env.store.get('FOLDER_ID'));
  assert.equal(home.get(3, 1).v, 'Word Helper');
  assert.match(key(env), /^[0-9a-fk]{24}$/);
}

// ── Set-up ─────────────────────────────────────────────

test('setup makes one top folder, a folder and spreadsheet per tool, and the Tools tab', () => {
  const env = ready();
  assertSetUp(env);
  const log = env.lastLog();
  assert.match(log, /Your secret code is: [0-9a-f]{24}/);
  assert.match(log, /PagePal \(0 rows so far\)/);
  assert.match(log, /docs\.google\.com\/spreadsheets\/d\//);
  assert.match(log, /Word Helper submissions › Class/);
  assert.match(log, /Manage deployments › pencil › Version: New version/);
});

test('running setup again changes nothing and keeps the secret code', () => {
  const env = ready();
  const before = { files: env.google.files.size, key: key(env), props: Object.fromEntries(env.store) };
  env.cache.clear(); // as if it were days later
  env.setup();
  assertSetUp(env);
  assert.equal(env.google.files.size, before.files, 'no new files');
  assert.equal(key(env), before.key);
  for (const p of ['TOP_FOLDER_ID', 'FOLDER_ID', 'WH_FOLDER_ID', 'PP_SHEET_ID', 'WH_SHEET_ID', 'HOME_TAB']) {
    assert.equal(env.store.get(p), before.props[p], p);
  }
});

test('a setup that stops part-way (at any point) finishes cleanly when run again', () => {
  const probe = ready();
  const total = probe.google.calls;
  assert.ok(total > 10);
  for (let stop = 1; stop <= total; stop++) {
    const env = load();
    env.google.failAt = stop;
    assert.throws(() => env.setup(), /Exceeded maximum execution time/, 'stops at call ' + stop);
    assert.match(env.lastLog(), /run setup again/);
    env.google.failAt = 0;
    env.setup();
    assertSetUp(env);
  }
});

test('setup says exactly how to switch on the Sheets API', () => {
  const env = load();
  env.google.sheetsApiOn = false;
  assert.throws(() => env.setup());
  assert.match(env.lastLog(), /\+ next to "Services".*"Google Sheets API", click Add/s);
  env.google.sheetsApiOn = true;
  env.setup();
  assertSetUp(env);
});

test('GET reply still says PagePal Inbox (Word Helper checks it) and lists the tools', () => {
  const env = ready();
  assert.deepEqual(env.get(), { ok: true, app: 'PagePal Inbox', name: 'Classroom Inbox', version: 5, tools: ['pagepal', 'word-helper'] });
});

// ── Upgrading from version 4 ───────────────────────────

const V4_HEADERS = [
  'Received', 'Student', 'Worksheet', 'Class',
  'Time working (min)', 'Total time (min)', 'Words written',
  'Typed', 'Spoken', 'Suggestions', 'Spell corrections', 'Assistance %',
  'Times listened', 'Words listened to', 'Answer', 'Page', 'PDF', 'Notes',
];

/** A teacher's Drive and sheet as version 4 left them. */
function v4World(extraRows = 0) {
  const google = new FakeGoogle();
  const ss = new FakeSpreadsheet();
  ss.addSheet('Sheet1');
  const ppFolder = google.create({ name: 'PagePal submissions', mimeType: FOLDER });
  const classFolder = google.create({ name: '3/4K', mimeType: FOLDER, parents: [ppFolder.id] });
  const pdf = google.create({ name: 'Mia S – Fractions – 2026-11-20 1000.pdf', mimeType: 'application/pdf', parents: [classFolder.id] });
  const whFolder = google.create({ name: 'Word Helper submissions', mimeType: FOLDER });
  const whSheet = google.create({ name: 'Word Helper submissions', mimeType: SHEET, parents: [whFolder.id] });
  whSheet.sheets[0].properties.title = 'Submissions';
  const s = v => ({ userEnteredValue: { stringValue: v } });
  const whHeaders = ['Received', 'Student', 'Class', 'Time working (min)', 'Total time (min)', 'Words written',
    'Typed', 'Spoken', 'Suggestions', 'Spell corrections', 'Assistance %',
    'Times listened', 'Words listened to', 'Words defined', 'Writing', 'PDF', 'Notes'];
  whSheet.sheets[0].rows.push({ values: whHeaders.map(s) }, { values: ['2026-11-19 09:00', 'Sam', '3/4K'].map(s) });
  const old = ss.addSheet('Submissions');
  const pdfLink = 'https://drive.google.com/file/d/' + pdf.id + '/view?usp=drivesdk';
  const rows = [
    V4_HEADERS,
    [new Date('2026-11-20T00:00:00Z'), 'Mia S', 'Fractions', '3/4K', 4.5, 6, 30, 20, 10, 0, 1, 33, 2, 'half, quarter',
      '=1+1 is two', '', { v: 'View PDF', link: pdfLink }, ''],
    [new Date('2026-11-21T00:00:00Z'), 'TEST Ev', 'Word Helper', '3/4K', 1, 2, 12, 12, 0, 0, 0, 0, 0, '',
      'My holiday story', '', '', ''],
  ];
  for (let i = 0; i < extraRows; i++) rows.push([new Date('2026-11-01T00:00:00Z'), 'Kid ' + i, 'Spelling', '3/4K', 1, 1, 1, 1, 0, 0, 0, 0, 0, '', 'ok', '', '', '']);
  old.fill(rows);
  const props = {
    KEY: 'k'.repeat(24), FOLDER_ID: ppFolder.id, SUBFOLDERS: JSON.stringify({ '/3/4k': classFolder.id }),
    WH_FOLDER_ID: whFolder.id, WH_SHEET_ID: whSheet.id, WH_SHEET_TAB: '0',
    JOINS: JSON.stringify({ joinabc: { exp: Date.now() + 86400000, label: '3/4K' } }),
  };
  return { google, ss, props, ids: { ppFolder: ppFolder.id, whFolder: whFolder.id, whSheet: whSheet.id, pdfLink } };
}

test('upgrading from v4: folders move in, old rows move across once, old tab is renamed', () => {
  const w = v4World();
  const env = load(w);
  env.setup();
  assertSetUp(env);
  const top = env.store.get('TOP_FOLDER_ID');
  assert.equal(env.store.get('FOLDER_ID'), w.ids.ppFolder, 'same PagePal folder, by ID');
  assert.deepEqual(env.google.files.get(w.ids.ppFolder).parents, [top]);
  assert.deepEqual(env.google.files.get(w.ids.whFolder).parents, [top]);
  assert.equal(env.store.get('WH_SHEET_ID'), w.ids.whSheet, 'Word Helper keeps its spreadsheet');
  assert.equal(key(env), 'k'.repeat(24), 'secret code unchanged');

  const pp = sheetFile(env, 'PP_SHEET_ID').sheets[0].rows;
  assert.equal(pp.length, 2, 'header + one PagePal row');
  const row = pp[1].values;
  assert.equal(cellText(row[0]), '2026-11-20 11:00', 'date kept (Sydney time)');
  assert.equal(cellText(row[1]), 'Mia S');
  assert.equal(cellText(row[4]), 4.5);
  assert.equal(cellText(row[14]), '=1+1 is two');
  assert.equal(linkOf(row[16]), w.ids.pdfLink, 'View PDF link kept');
  assert.equal(cellText(row[16]), 'View PDF');

  const wh = rowsOf(env, 'WH_SHEET_ID');
  assert.equal(wh.length, 3, 'header + v4 row + moved test row');
  assert.equal(wh[2][1], 'TEST Ev');
  assert.equal(wh[2][14], 'My holiday story', 'Answer → Writing');

  assert.ok(env.ss.getSheetByName('PagePal (before v5)'), 'old tab renamed');
  assert.equal(env.ss.getSheetByName('Submissions'), null);
  assert.equal(env.ss.getSheetByName('PagePal (before v5)').getLastRow(), 3, 'old rows not deleted');
  assert.match(env.lastLog(), /Moved 1 earlier PagePal row/);

  const home = toolsTab(env);
  assert.equal(home.get(2, 4).v, 1, 'PagePal count');
  assert.equal(home.get(3, 4).v, 2, 'Word Helper count');
  assert.equal(home.get(3, 5).v, '2026-11-21 11:00');

  // A connected iPad and an existing class QR code keep working.
  assert.deepEqual(env.post({ action: 'join', join: 'joinabc' }), { ok: true, key: 'k'.repeat(24), name: '3/4K' });

  env.cache.clear();
  env.setup();
  assert.equal(sheetFile(env, 'PP_SHEET_ID').sheets[0].rows.length, 2, 're-run copies nothing again');
  assert.equal(rowsOf(env, 'WH_SHEET_ID').length, 3);
  assert.deepEqual(env.google.files.get(w.ids.ppFolder).parents, [top]);
});

test('moving old rows survives a setup that stops part-way', () => {
  const probe = load(v4World(1200));
  probe.setup();
  const total = probe.google.calls;
  for (let stop = 1; stop <= total; stop++) {
    const env = load(v4World(1200));
    env.google.failAt = stop;
    assert.throws(() => env.setup());
    env.google.failAt = 0;
    env.setup();
    assertSetUp(env);
    assert.equal(sheetFile(env, 'PP_SHEET_ID').sheets[0].rows.length, 1 + 1 + 1200, 'every row exactly once (stop ' + stop + ')');
    assert.equal(rowsOf(env, 'WH_SHEET_ID').length, 3);
  }
});

test('a tab with headers only is left alone', () => {
  const env = load();
  env.ss.addSheet('Submissions').fill([V4_HEADERS]);
  env.setup();
  assert.ok(env.ss.getSheetByName('Submissions'));
  assert.equal(sheetFile(env, 'PP_SHEET_ID').sheets[0].rows.length, 1);
});

test('a folder the script cannot move is left where the teacher put it, with a note', () => {
  const w = v4World();
  const env = load(w);
  env.google.denyMove = true;
  env.setup();
  assert.match(env.lastLog(), /Couldn’t move the "PagePal submissions" folder/);
  assert.deepEqual(env.google.files.get(w.ids.ppFolder).parents, ['ROOT']);
  env.google.denyMove = false;
  env.setup();
  assert.deepEqual(env.google.files.get(w.ids.ppFolder).parents, ['ROOT'], 'not moved later either');
});

// ── Sending ────────────────────────────────────────────

test('sending from PagePal: row, PDF in Class › Worksheet, count in the Tools tab', () => {
  const env = ready();
  const res = env.post({
    action: 'submit', tool: 'pagepal', secret: key(env), student: 'Mia S', worksheet: 'Fractions p12',
    className: '3/4K', answer: 'one half', stats: { workingSecs: 270, wordsListened: ['half'] },
    pdf: { type: 'application/pdf', base64: PDF }, image: { type: 'image/jpeg', base64: JPEG },
  });
  assert.deepEqual(res, { ok: true, warnings: [] });
  const rows = sheetFile(env, 'PP_SHEET_ID').sheets[0].rows;
  assert.equal(rows.length, 2);
  const row = rows[1].values;
  assert.equal(cellText(row[1]), 'Mia S');
  assert.equal(cellText(row[2]), 'Fractions p12');
  assert.equal(cellText(row[4]), 4.5);
  assert.equal(cellText(row[13]), 'half');
  const pdfFile = env.google.byName([...env.google.files.values()].find(f => f.name.endsWith('.pdf')).name)[0];
  assert.match(pdfFile.name, /^Mia S – Fractions p12 – \d{4}-\d\d-\d\d \d{4}\.pdf$/);
  const ws = env.google.files.get(pdfFile.parents[0]);
  const cls = env.google.files.get(ws.parents[0]);
  assert.equal(ws.name, 'Fractions p12');
  assert.equal(cls.name, '3-4K');
  assert.deepEqual(cls.parents, [env.store.get('FOLDER_ID')]);
  assert.equal(linkOf(row[16]), 'https://drive.google.com/file/d/' + pdfFile.id + '/view?usp=drivesdk');
  assert.ok(linkOf(row[15]), 'View page link');
  assert.equal(toolsTab(env).get(2, 4).v, 1);
  assert.match(String(toolsTab(env).get(2, 5).v), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
});

test('sending without a tool name still means PagePal (older PagePal)', () => {
  const env = ready();
  assert.equal(env.post({ secret: key(env), student: 'Old iPad', worksheet: 'W' }).ok, true);
  assert.equal(rowsOf(env, 'PP_SHEET_ID')[1][1], 'Old iPad');
});

test('sending from Word Helper: row in its spreadsheet, PDF in its Class folder', () => {
  const env = ready();
  const res = env.post({
    action: 'submit', tool: 'word-helper', secret: key(env), student: 'Sam', className: '3/4K', test: true,
    answer: 'Once upon a time', stats: { wordsDefined: ['upon'] }, pdf: { type: 'application/pdf', base64: PDF },
  });
  assert.deepEqual(res, { ok: true, warnings: [] });
  const rows = rowsOf(env, 'WH_SHEET_ID');
  assert.equal(rows[1][1], 'TEST Sam');
  assert.equal(rows[1][13], 'upon');
  assert.equal(rows[1][14], 'Once upon a time');
  const pdfFile = [...env.google.files.values()].find(f => f.name.endsWith('.pdf'));
  assert.match(pdfFile.name, /^TEST Sam – Word Helper – /);
  const cls = env.google.files.get(pdfFile.parents[0]);
  assert.deepEqual(cls.parents, [env.store.get('WH_FOLDER_ID')]);
  assert.equal(rowsOf(env, 'PP_SHEET_ID').length, 1, 'nothing in PagePal');
  assert.equal(toolsTab(env).get(3, 4).v, 1);
});

test('a file that is not what it says is refused, and the row still arrives', () => {
  const env = ready();
  const res = env.post({ tool: 'pagepal', secret: key(env), student: 'A', pdf: { type: 'application/pdf', base64: JPEG } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, ['File refused: contents don’t match a .pdf file.']);
  assert.equal(rowsOf(env, 'PP_SHEET_ID')[1][17], 'File refused: contents don’t match a .pdf file.');
});

test('an unknown tool is refused', () => {
  const env = ready();
  for (const tool of ['spellbook', 'constructor', '__proto__', 'toString']) {
    assert.deepEqual(env.post({ tool, secret: key(env), student: 'A' }), { ok: false, error: 'bad-request' }, tool);
  }
  assert.equal(rowsOf(env, 'PP_SHEET_ID').length, 1);
});

test('a wrong key is refused', () => {
  const env = ready();
  assert.deepEqual(env.post({ tool: 'pagepal', secret: 'x'.repeat(24), student: 'A' }), { ok: false, error: 'wrong-code' });
  assert.deepEqual(env.post({ tool: 'word-helper', student: 'A' }), { ok: false, error: 'wrong-code' });
  assert.deepEqual(env.post({ action: 'newJoin', secret: 'nope', days: 7 }), { ok: false, error: 'wrong-code' });
});

test('broken requests get bad-request', () => {
  const env = ready();
  assert.deepEqual(env.post('{not json'), { ok: false, error: 'bad-request' });
  assert.deepEqual(env.post('null'), { ok: false, error: 'bad-request' });
});

// ── Joining ────────────────────────────────────────────

test('join codes swap for the key, and stop working when they expire', () => {
  const env = ready();
  const made = env.post({ action: 'newJoin', secret: key(env), days: 200, label: 'Mr Evans 3/4B' });
  assert.equal(made.ok, true);
  assert.ok(made.expires <= Date.now() + 80 * 86400000 + 1000, 'at most 80 days');
  assert.ok(made.expires > Date.now() + 79 * 86400000);
  assert.deepEqual(env.post({ action: 'join', join: made.join }), { ok: true, key: key(env), name: 'Mr Evans 3/4B' });
  assert.deepEqual(env.post({ action: 'join', join: 'wrong' }), { ok: false, error: 'expired-join' });
  assert.deepEqual(env.post({ action: 'join', join: 'constructor' }), { ok: false, error: 'expired-join' });

  const joins = JSON.parse(env.store.get('JOINS'));
  joins[made.join].exp = Date.now() - 1;
  env.store.set('JOINS', JSON.stringify(joins));
  assert.deepEqual(env.post({ action: 'join', join: made.join }), { ok: false, error: 'expired-join' });
});

// ── Repairs ────────────────────────────────────────────

test('a deleted spreadsheet is made again on the next send', () => {
  const env = ready();
  env.post({ tool: 'pagepal', secret: key(env), student: 'First' });
  const oldId = env.store.get('PP_SHEET_ID');
  env.google.files.delete(oldId); // deleted for good, while "it exists" is still remembered
  const res = env.post({ tool: 'pagepal', secret: key(env), student: 'Second' });
  assert.deepEqual(res, { ok: true, warnings: [] });
  const newId = env.store.get('PP_SHEET_ID');
  assert.notEqual(newId, oldId);
  const rows = rowsOf(env, 'PP_SHEET_ID');
  assert.equal(rows[0][0], 'Received', 'headers on the new spreadsheet');
  assert.equal(rows[1][1], 'Second');
  assert.deepEqual(env.google.files.get(newId).parents, [env.store.get('FOLDER_ID')]);
  assert.equal(toolsTab(env).get(2, 2).link, 'https://docs.google.com/spreadsheets/d/' + newId, 'Tools tab points at the new one');
  assert.equal(toolsTab(env).get(2, 4).v, 1, 'count starts again with the new spreadsheet');
});

test('a binned folder is made again, inside Classroom Inbox', () => {
  const env = ready();
  env.google.files.get(env.store.get('WH_FOLDER_ID')).trashed = true;
  env.cache.clear();
  const res = env.post({ tool: 'word-helper', secret: key(env), student: 'S', className: 'K', pdf: { type: 'application/pdf', base64: PDF } });
  assert.equal(res.ok, true);
  const folder = env.google.files.get(env.store.get('WH_FOLDER_ID'));
  assert.equal(folder.trashed, false);
  assert.deepEqual(folder.parents, [env.store.get('TOP_FOLDER_ID')]);
});

// ── Never a formula ────────────────────────────────────

test('no text is ever stored as a formula', () => {
  const env = load(v4World());
  env.setup();
  const nasty = ['=IMPORTXML("http://x","//a")', '+SUM(1)', '-2+3', '@foo', '\t=1', '=HYPERLINK("http://evil","click")'];
  for (const s of nasty) {
    for (const tool of ['pagepal', 'word-helper']) {
      env.post({ tool, secret: key(env), student: s, worksheet: s, className: s, answer: s, stats: { wordsListened: [s], wordsDefined: [s] } });
    }
  }
  const cells = env.google.allCells();
  assert.ok(cells.length > 100);
  for (const c of cells) {
    const v = c.userEnteredValue || {};
    assert.equal(v.formulaValue, undefined);
    assert.deepEqual(Object.keys(v).filter(k => k !== 'stringValue' && k !== 'numberValue'), []);
    for (const run of c.textFormatRuns || []) {
      assert.match(run.format.link.uri, /^https:\/\/(drive|docs)\.google\.com\//);
    }
  }
  const stored = cells.map(cellText);
  for (const s of nasty) assert.ok(stored.includes(s.trim()), 'kept as text: ' + s);
  assert.deepEqual(env.ss.formulaWrites, [], 'nothing formula-like written to the attached sheet');
});

test('links only ever point at Drive', () => {
  const env = ready();
  env.run(`appendCells_(toolSheet_('pagepal'), [[{ link: 'https://evil.example/x', label: 'x' }, { link: 'javascript:alert(1)', label: 'y' }]])`);
  const last = sheetFile(env, 'PP_SHEET_ID').sheets[0].rows.at(-1).values;
  assert.deepEqual(last, [{}, {}]);
});
