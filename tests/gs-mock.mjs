// Stand-ins for the Apps Script services the Classroom Inbox script uses,
// plus a small fake of the Drive and Sheets REST APIs behind UrlFetchApp.
// load() runs the .gs file in a fresh sandbox and returns helpers.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const GS = new URL('../apps-script/Classroom-Inbox.gs', import.meta.url);

// ── Fake Google Drive + Sheets REST APIs ───────────────

export class FakeGoogle {
  constructor() {
    this.files = new Map();      // id → {id, name, mimeType, parents, trashed, bytes?, sheets?}
    this.n = 0;
    this.calls = 0;
    this.failAt = 0;             // throw on this fetch number (simulates a run that stops)
    this.sheetsApiOn = true;
    this.denyMove = false;
    this.log = [];
  }

  newId() { return 'id' + String(++this.n).padStart(26, '0'); }

  create(meta, extra = {}) {
    const id = this.newId();
    const f = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || ['ROOT'], trashed: false, ...extra };
    if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
      f.sheets = [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: {} }, rows: [] }];
    }
    this.files.set(id, f);
    return f;
  }

  byName(name) { return [...this.files.values()].filter(f => f.name === name && !f.trashed); }

  /** Every cell ever written to a spreadsheet through the API. */
  allCells() {
    const out = [];
    for (const f of this.files.values()) for (const s of f.sheets || []) for (const r of s.rows) out.push(...r.values);
    return out;
  }

  fetch(url, o = {}) {
    this.calls++;
    if (this.failAt && this.calls >= this.failAt) throw new Error('Exceeded maximum execution time');
    const method = (o.method || 'get').toLowerCase();
    const u = new URL(url);
    this.log.push(method + ' ' + u.pathname);
    const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const notFound = () => reply(404, { error: { message: 'File not found' } });

    if (u.host === 'sheets.googleapis.com') {
      if (!this.sheetsApiOn) {
        return reply(403, { error: { message: 'Google Sheets API has not been used in project 123 before or it is disabled.' } });
      }
      const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(:batchUpdate)?(?:\/values\/(.+))?$/);
      const f = m && this.files.get(decodeURIComponent(m[1]));
      if (!f || !f.sheets) return notFound();
      if (m[2]) {
        const body = JSON.parse(o.payload);
        for (const req of body.requests) {
          if (req.updateSheetProperties) {
            const p = req.updateSheetProperties.properties;
            const s = f.sheets.find(x => x.properties.sheetId === p.sheetId);
            if (!s) return reply(400, 'no such sheet');
            if (p.title) s.properties.title = p.title;
            if (p.gridProperties) Object.assign(s.properties.gridProperties, p.gridProperties);
          } else if (req.appendCells) {
            const s = f.sheets.find(x => x.properties.sheetId === req.appendCells.sheetId);
            if (!s) return reply(400, 'no such sheet');
            s.rows.push(...req.appendCells.rows);
          } else {
            return reply(400, 'unknown request');
          }
        }
        return reply(200, { replies: [] });
      }
      if (m[3]) {
        const range = decodeURIComponent(m[3]);
        const title = range.match(/^'(.*)'!/)[1].replace(/''/g, "'");
        const s = f.sheets.find(x => x.properties.title === title);
        if (!s) return reply(400, 'bad range');
        const values = s.rows.slice(1).map(r => {
          const v = r.values[0] && r.values[0].userEnteredValue;
          return v ? [String(v.stringValue ?? v.numberValue)] : [];
        });
        while (values.length && !values[values.length - 1].length) values.pop();
        return reply(200, { values });
      }
      return reply(200, { sheets: f.sheets.map(s => ({ properties: { sheetId: s.properties.sheetId, title: s.properties.title } })) });
    }

    if (u.host === 'www.googleapis.com' && u.pathname === '/upload/drive/v3/files') {
      const bytes = Buffer.from(o.payload.map(b => b & 0xff));
      const text = bytes.toString('latin1');
      const start = text.indexOf('\r\n\r\n') + 4;
      const meta = JSON.parse(Buffer.from(text.slice(start, text.indexOf('\r\n--', start)), 'latin1').toString('utf8'));
      const parent = this.files.get(meta.parents[0]);
      if (!parent || parent.trashed) return notFound();
      const bodyStart = text.indexOf('\r\n\r\n', text.indexOf('\r\n--', start)) + 4;
      const f = this.create(meta, { bytes: bytes.subarray(bodyStart, text.lastIndexOf('\r\n--')) });
      return reply(200, { id: f.id, webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view?usp=drivesdk' });
    }

    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/drive/v3/files')) {
      const id = decodeURIComponent(u.pathname.slice('/drive/v3/files/'.length));
      if (method === 'post' && !id) {
        const meta = JSON.parse(o.payload);
        if (meta.parents && !this.files.has(meta.parents[0])) return notFound();
        return reply(200, { id: this.create(meta).id });
      }
      const f = this.files.get(id);
      if (!f) return notFound();
      if (method === 'get') return reply(200, { id: f.id, trashed: f.trashed, parents: f.parents });
      if (method === 'patch') {
        if (this.denyMove) return reply(403, { error: { message: 'Insufficient permissions for the specified parent.' } });
        const add = u.searchParams.get('addParents');
        const remove = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
        f.parents = f.parents.filter(p => !remove.includes(p));
        if (add) f.parents.push(add);
        return reply(200, { id: f.id, parents: f.parents });
      }
    }
    return reply(400, 'unexpected request ' + method + ' ' + url);
  }
}

// ── The attached spreadsheet (SpreadsheetApp) ───────────

class RichText {
  constructor(text, link) { this.text = text; this.link = link || null; }
  getText() { return this.text; }
  getLinkUrl() { return this.link; }
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(i, j, this.r + i, this.c + j); }
  getValues() { const out = []; this.each((i, j, r, c) => { (out[i] ||= [])[j] = this.sheet.get(r, c).v; }); return out; }
  getValue() { return this.getValues()[0][0]; }
  getRichTextValues() {
    const out = [];
    this.each((i, j, r, c) => { const cell = this.sheet.get(r, c); (out[i] ||= [])[j] = new RichText(String(cell.v), cell.link); });
    return out;
  }
  setValues(rows) { this.each((i, j, r, c) => this.sheet.put(r, c, rows[i][j])); return this; }
  setValue(v) { this.each((i, j, r, c) => this.sheet.put(r, c, v)); return this; }
  setRichTextValue(rt) { this.each((i, j, r, c) => this.sheet.put(r, c, rt.text, rt.link)); return this; }
  setFontWeight() { return this; }
}

export class FakeSheet {
  constructor(ss, name, id) { this.ss = ss; this.name = name; this.id = id; this.cells = []; this.frozen = 0; }
  get(r, c) { return (this.cells[r - 1] && this.cells[r - 1][c - 1]) || { v: '', link: null }; }
  put(r, c, v, link = null) {
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) this.ss.formulaWrites.push(v);
    (this.cells[r - 1] ||= [])[c - 1] = { v, link };
  }
  getSheetId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() {
    for (let r = this.cells.length; r > 0; r--) if ((this.cells[r - 1] || []).some(x => x && x.v !== '')) return r;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.cells.map(r => (r ? r.length : 0))); }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  clear() { this.cells = []; return this; }
  setFrozenRows(n) { this.frozen = n; }
  /** Test helper: fill rows as a v4 script would have left them. Cells may be {v, link}. */
  fill(rows) { rows.forEach((row, i) => row.forEach((x, j) => { (this.cells[i] ||= [])[j] = x && typeof x === 'object' && 'v' in x ? x : { v: x, link: null }; })); }
  /** Test helper: what a teacher sees. */
  text() { return this.cells.map(r => (r || []).map(x => (x ? x.v : ''))); }
}

export class FakeSpreadsheet {
  constructor() { this.sheets = []; this.nextId = 100; this.formulaWrites = []; }
  addSheet(name) { const s = new FakeSheet(this, name, this.nextId++); this.sheets.push(s); return s; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name, index) {
    const s = new FakeSheet(this, name, this.nextId++);
    if (index === undefined) this.sheets.push(s); else this.sheets.splice(index, 0, s);
    return s;
  }
}

// ── Load the script ────────────────────────────────────

export function load({ google = new FakeGoogle(), ss = new FakeSpreadsheet(), props = {} } = {}) {
  const store = new Map(Object.entries(props));
  const cache = new Map();
  const logs = [];
  const sandbox = {
    console,
    UrlFetchApp: { fetch: (url, o) => google.fetch(url, o) },
    ScriptApp: { getOAuthToken: () => 'token' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (store.has(k) ? store.get(k) : null),
        setProperty: (k, v) => { store.set(k, String(v)); },
        deleteProperty: k => { store.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: k => { cache.delete(k); },
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newRichTextValue: () => {
        const b = { text: '', link: null };
        return { setText(t) { b.text = t; return this; }, setLinkUrl(l) { b.link = l; return this; }, build: () => new RichText(b.text, b.link) };
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Decode: s => [...Buffer.from(s, 'base64')].map(b => (b > 127 ? b - 256 : b)),
      newBlob: (data, type, name) => {
        const bytes = typeof data === 'string' ? [...Buffer.from(data, 'utf8')].map(b => (b > 127 ? b - 256 : b)) : data.slice();
        return { getBytes: () => bytes.slice(), getContentType: () => type, getName: () => name };
      },
      formatDate: (d, tz, pattern) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(d).map(x => [x.type, x.value]));
        return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
    },
    Session: { getScriptTimeZone: () => 'Australia/Sydney' },
    Logger: { log: m => logs.push(String(m)) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(GS, 'utf8'), ctx, { filename: 'Classroom-Inbox.gs' });
  const run = src => vm.runInContext(src, ctx);
  return {
    google, ss, store, cache, logs, run,
    setup: () => run('setup()'),
    get: () => JSON.parse(run('doGet()').getContent()),
    post: body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    lastLog: () => logs[logs.length - 1] || '',
  };
}

/** A tiny valid-looking PDF, base64. */
export const PDF = Buffer.from('%PDF-1.4\n% test\n%%EOF').toString('base64');
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
