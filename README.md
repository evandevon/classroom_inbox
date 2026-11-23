# Classroom Inbox

One place for a teacher to set up the “send work to the teacher” system that the student tools share, make class QR codes, and keep each tool’s work organised in Google Drive.

**Teacher page:** https://evandevon.github.io/classroom_inbox/ (GitHub Pages: Settings › Pages › Deploy from branch › `main` / root)
**Class links:** https://evandevon.github.io/classroom_inbox/join/?teacher=CODE

Plain HTML, CSS and JS modules. No build step.

## Tools

| Tool | Sends | Spreadsheet and files |
| --- | --- | --- |
| [PagePal](https://github.com/evandevon/PagePal) | `tool: 'pagepal'` (or no tool, from older PagePal) | `Classroom Inbox › PagePal submissions` (spreadsheet), PDFs in `› Class › Worksheet` |
| [Word Helper](https://github.com/evandevon/Word_Helper) | `tool: 'word-helper'` | `Classroom Inbox › Word Helper submissions` (spreadsheet), PDFs in `› Class` |

The Google Sheet the script is attached to becomes the home page: its **Tools** tab links to each spreadsheet and folder, with a count and the time of the last arrival.

**Adding a tool:** add one entry to `TOOLS` in `apps-script/Classroom-Inbox.gs` (folder, headings, how a submission becomes a row) and one to `KNOWN_TOOLS` in `js/tools.js` (name, address, icon). The tool sends `{action: 'submit', tool: '<key>', secret, student, className, …}` and reads the connection from `localStorage['pagepal.settings'].teacher`.

## How the inbox works

- **Set-up:** the teacher pastes `apps-script/Classroom-Inbox.gs` into Extensions › Apps Script, replaces `appsscript.json`, adds the Google Sheets API service, runs `setup()`, and deploys a web app (Execute as: Me, Access: Anyone). Updating is Manage deployments › pencil › New version, so the address and QR codes stay the same. `showStatus()` shows the summary and secret code again; `resetCode()` makes a new key.
- **Turning it off:** `cancelClassCodes()` stops every class QR code and link (joined iPads keep sending). `pauseInbox()` and `resumeInbox()` stop and restart receiving, with the same address and codes; while paused, requests get `{ok:false, error:'paused'}`, and `GET` reports `paused`. To stop for good, archive the deployment in Manage deployments.
- **Permissions:** only `spreadsheets.currentonly`, `drive.file` and `script.external_request`. The script opens only its own sheet and the files and folders it made. It writes to them through the Drive and Sheets REST APIs. Folders are remembered by ID, so the teacher can rename or move the Classroom Inbox folder.
- **Requests:** all are POSTs with a JSON body and no Content-Type header, which avoids a CORS pre-flight.
  - `{action:'newJoin', secret, days, label}` → `{ok, join, expires}`
  - `{action:'join', join}` → `{ok, key, name}`
  - `{action:'submit', tool, secret, …}` → `{ok, warnings}`
  - `GET` → `{ok, app:'PagePal Inbox', name:'Classroom Inbox', version, tools}`. `app` stays `PagePal Inbox` because Word Helper checks it.
- **Errors:** `wrong-code`, `expired-join`, `busy`, `too-big`, `bad-request`, `bad-reply`, `server`, `network`.
- **Class link:** `?teacher=CODE`, where CODE is base64url JSON `{n, u, j, x}`. Older links use `{n, u, k}`. The join code expires after 1–80 days, or never (`days: 'forever'`, version 6+: `expires` is 0 and `x` is 0, and it lasts until `cancelClassCodes` or `resetCode`; at most 20 at once). The key is never in a QR code.
- **Safety:** no formulas (all text goes in as `stringValue`), and text that starts like a formula gets an invisible word joiner so it stays text if downloaded as CSV. Links go only to Drive. Rate limits.
- **Files:** each tool lists the slots it uses (`files` in `TOOLS`), and each slot takes one kind of file, checked by its first bytes. The limit is 5 MB per file.
  - `image`: JPEG or PNG
  - `pdf`: PDF
  - `audio`: MP3, M4A or WAV. No tool uses this yet; it's ready for a recording tool.
- **Upgrading from PagePal Inbox v4:** setup moves the old tool folders into Classroom Inbox once. It copies the old `Submissions` tab rows (with their links) into the new PagePal spreadsheet, sends Word Helper test rows to Word Helper's spreadsheet, and renames the tab `PagePal (before v5)`. Progress is saved after every step, so a setup that stops part-way is safe to run again.

## Files

```
index.html               Teacher page: set-up guide, connect, class QR code, your tools
join/index.html          Where class QR codes lead: connects PagePal and Word Helper in this browser
css/site.css
js/teacher.js            Teacher page logic
js/join.js               Join page logic
js/links.js              Class link encoding/decoding (pure, unit-tested)
js/inbox.js              Talking to the inbox; reading/saving pagepal.settings
js/tools.js              Known tools (name, address, icon, where work goes)
lib/qrcode.js            qrcode-generator 2.0.4, MIT, © Kazuhiko Arase
icons/
apps-script/             Classroom-Inbox.gs (version 6) and appsscript.json
tests/                   node --test: the script against stand-in Google services; links
tests/pages/             Playwright: teacher and join pages against a stand-in inbox
```

## Tests

```
npm install
npm test                       # script + links (Node 20+)
npx playwright install chromium   # once
npm run test:pages             # or: CHROME_PATH=/usr/bin/google-chrome npm run test:pages
```
