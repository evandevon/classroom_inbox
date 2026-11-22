import { test, expect } from '@playwright/test';
import { standInInbox, INBOX_URL, KEY, b64url } from './stand-in.mjs';

const OTHER_SETTINGS = {
  studentName: 'Mia S',
  sizeLevels: { text: 2, stamp: 1, ink: 0 },
  displayMode: 'high-contrast',
  voiceName: 'Karen',
  speechRate: 0.75,
  teacherEmail: 'ev@example.edu.au',
  futureField: [1, 2, 3],
  teacher: null,
};

function link({ n = 'Mr Evans 3/4B', u = INBOX_URL, j = 'join0xxxxxxxxxxx', x = Date.now() + 86400000, k } = {}) {
  return '/join/?teacher=' + b64url(k ? { n, u, k } : { n, u, j, x });
}

/** Open the join page with some existing PagePal settings on this "iPad". */
async function openWith(page, path, settings = OTHER_SETTINGS) {
  await page.goto('/join/');
  await page.evaluate(s => {
    if (s === undefined) localStorage.removeItem('pagepal.settings');
    else localStorage.setItem('pagepal.settings', typeof s === 'string' ? s : JSON.stringify(s));
  }, settings);
  await page.goto(path);
}

const settings = page => page.evaluate(() => JSON.parse(localStorage.getItem('pagepal.settings')));

test('joining saves the connection, keeps every other setting, and tidies the address', async ({ page }) => {
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  const inbox = await standInInbox(page);
  inbox.joins['join0xxxxxxxxxxx'] = { expires: Date.now() + 86400000, label: 'Mr Evans 3/4B' };
  await openWith(page, link());

  await expect(page.getByRole('heading', { name: 'Send your work to Mr Evans 3/4B?' })).toBeVisible();
  await expect(page.getByText('Only say yes to a QR code your teacher gave you.')).toBeVisible();
  expect(page.url()).not.toContain('teacher=');
  expect(inbox.requests).toHaveLength(0); // nothing sent before the student says yes

  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByRole('heading', { name: 'You’re connected to Mr Evans 3/4B' })).toBeVisible();

  const s = await settings(page);
  expect(s.teacher).toEqual({ name: 'Mr Evans 3/4B', url: INBOX_URL, secret: KEY });
  const { teacher, ...rest } = s;
  const { teacher: _, ...expected } = OTHER_SETTINGS;
  expect(rest).toEqual(expected);

  const post = inbox.requests.find(r => r.method === 'POST');
  expect(JSON.parse(post.body)).toEqual({ action: 'join', join: 'join0xxxxxxxxxxx' });
  expect(post.contentType || '').not.toContain('application/json'); // a "simple" request: no pre-flight

  await expect(page.getByRole('link', { name: 'Open PagePal' })).toHaveAttribute('href', 'https://evandevon.github.io/PagePal/');
  await expect(page.getByRole('link', { name: 'Open Word Helper' })).toHaveAttribute('href', 'https://evandevon.github.io/Word_Helper/');
  await expect(page.locator('main')).toContainText('Home Screen');
  await expect(page.locator('main')).toContainText('“Settings › Scan class QR code” in PagePal');

  expect(await page.locator('body').innerText()).not.toContain(KEY);
  expect(logs.join('\n')).not.toContain(KEY);
  expect(page.url()).not.toContain('teacher=');
});

test('works on a fresh iPad and when the saved settings are damaged', async ({ page }) => {
  const inbox = await standInInbox(page);
  inbox.joins['join0xxxxxxxxxxx'] = { expires: Date.now() + 86400000, label: 'x' };
  for (const start of [undefined, '{not json', '"a string"', '[1,2]']) {
    await openWith(page, link(), start);
    await page.getByRole('button', { name: 'Yes, connect' }).click();
    await expect(page.getByRole('heading', { name: /You’re connected/ })).toBeVisible();
    expect((await settings(page)).teacher.secret).toBe(KEY);
  }
});

test('an expired class QR code says so, and contacts nobody', async ({ page }) => {
  const inbox = await standInInbox(page);
  await openWith(page, link({ x: Date.now() - 1000 }));
  await expect(page.getByRole('heading', { name: 'That class QR code has expired.' })).toBeVisible();
  await expect(page.getByText('Ask your teacher for a new one.', { exact: true })).toBeVisible();
  expect(inbox.requests).toHaveLength(0);
  expect((await settings(page)).teacher).toBeNull();
});

test('a code the inbox no longer knows shows the expired message', async ({ page }) => {
  await standInInbox(page); // no join codes
  await openWith(page, link());
  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByRole('heading', { name: 'That class QR code has expired.' })).toBeVisible();
  expect((await settings(page)).teacher).toBeNull();
});

test('only Google Apps Script addresses are accepted', async ({ page }) => {
  const seen = [];
  page.on('request', r => seen.push(r.url()));
  for (const u of ['https://evil.example/exec', 'http://script.google.com/macros/s/x/exec', 'https://script.google.com.evil.example/x']) {
    await openWith(page, link({ u }));
    await expect(page.getByRole('heading', { name: 'That QR code didn’t work' })).toBeVisible();
  }
  await openWith(page, '/join/?teacher=%%%not-base64');
  await expect(page.getByRole('heading', { name: 'That QR code didn’t work' })).toBeVisible();
  expect(seen.filter(u => u.includes('evil'))).toEqual([]);
});

test('saying no changes nothing', async ({ page }) => {
  const inbox = await standInInbox(page);
  await openWith(page, link());
  await page.getByRole('button', { name: 'No' }).click();
  await expect(page.getByRole('heading', { name: 'OK, not connected' })).toBeVisible();
  expect(await settings(page)).toEqual(OTHER_SETTINGS);
  expect(inbox.requests).toHaveLength(0);
});

test('no wifi: a kind message and Try again', async ({ page }) => {
  const inbox = await standInInbox(page);
  inbox.joins['join0xxxxxxxxxxx'] = { expires: Date.now() + 86400000, label: 'x' };
  inbox.down = true;
  await openWith(page, link());
  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByText('Couldn’t reach your teacher’s inbox. Check the wifi and try again.')).toBeVisible();
  inbox.down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: /You’re connected/ })).toBeVisible();
});

test('an older link with the key in it still connects (no join step)', async ({ page }) => {
  const inbox = await standInInbox(page);
  await openWith(page, link({ k: 'oldkey0123456789abcdef01' }));
  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByRole('heading', { name: /You’re connected/ })).toBeVisible();
  expect((await settings(page)).teacher).toEqual({ name: 'Mr Evans 3/4B', url: INBOX_URL, secret: 'oldkey0123456789abcdef01' });
  expect(inbox.requests).toHaveLength(0);
});

test('switching teachers says who the iPad sends to now', async ({ page }) => {
  await standInInbox(page);
  await openWith(page, link({ n: 'Ms K 5/6' }), { ...OTHER_SETTINGS, teacher: { name: 'Mr Evans 3/4B', url: INBOX_URL, secret: KEY } });
  await expect(page.getByText('This iPad sends work to Mr Evans 3/4B now. Saying yes sends it to Ms K 5/6 instead.')).toBeVisible();
});

test('opened with no code: how to scan, and the current connection', async ({ page }) => {
  await openWith(page, '/join/', { ...OTHER_SETTINGS, teacher: { name: 'Mr Evans 3/4B', url: INBOX_URL, secret: KEY } });
  await expect(page.getByRole('heading', { name: 'Scan your class QR code' })).toBeVisible();
  await expect(page.getByText('This iPad sends work to Mr Evans 3/4B.')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(KEY);
});

test('everything can be done with the keyboard, with large tap targets', async ({ page }) => {
  const inbox = await standInInbox(page);
  inbox.joins['join0xxxxxxxxxxx'] = { expires: Date.now() + 86400000, label: 'x' };
  await openWith(page, link());
  for (const name of ['Yes, connect', 'No']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  await page.getByRole('button', { name: 'Yes, connect' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /You’re connected/ })).toBeFocused();
});

// ── Pasting a class link ───────────────────────────────

const fullLink = (path, o) => 'https://evandevon.github.io' + path + '?teacher=' + b64url(o);
const CODE = () => ({ n: 'Mr Evans 3/4B', u: INBOX_URL, j: 'join0xxxxxxxxxxx', x: Date.now() + 86400000 });

for (const [what, text] of [
  ['a Classroom Inbox link', () => fullLink('/classroom_inbox/join/', CODE())],
  ['an older PagePal class link', () => fullLink('/PagePal/', CODE())],
  ['a link inside a longer message', () => 'Hi 3/4B! Join here: ' + fullLink('/classroom_inbox/join/', CODE()) + '. Thanks!'],
  ['a forever link (no expiry)', () => fullLink('/classroom_inbox/join/', { ...CODE(), x: 0 })],
]) {
  test(`pasting ${what} connects, after asking`, async ({ page }) => {
    const inbox = await standInInbox(page);
    inbox.joins['join0xxxxxxxxxxx'] = { expires: Date.now() + 86400000, label: 'Mr Evans 3/4B' };
    await openWith(page, '/join/');
    await page.getByLabel('Got a class link instead? Paste it here.').fill(text());
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('heading', { name: 'Send your work to Mr Evans 3/4B?' })).toBeVisible();
    expect(inbox.requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Yes, connect' }).click();
    await expect(page.getByRole('heading', { name: 'You’re connected to Mr Evans 3/4B' })).toBeVisible();
    expect((await settings(page)).teacher).toEqual({ name: 'Mr Evans 3/4B', url: INBOX_URL, secret: KEY });
    expect((await settings(page)).studentName).toBe('Mia S');
  });
}

test('pasting something that isn’t a class link says what to copy; nothing is contacted', async ({ page }) => {
  const inbox = await standInInbox(page);
  await openWith(page, '/join/');
  const box = page.getByLabel('Got a class link instead? Paste it here.');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert')).toContainText('Paste the class link');
  for (const bad of ['hello', 'https://evandevon.github.io/PagePal/', fullLink('/x/', { n: 'x', u: 'https://evil.example/exec', j: 'jjjjjjjjjjjjjjjj', x: 0 })]) {
    await box.fill(bad);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('alert')).toContainText('That isn’t a class link');
  }
  await box.fill(fullLink('/classroom_inbox/join/', { ...CODE(), x: Date.now() - 1000 }));
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await box.fill('x');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(inbox.requests).toHaveLength(0);
});

test('after a bad or expired QR code, the student can paste a link instead', async ({ page }) => {
  await standInInbox(page);
  await openWith(page, link({ x: Date.now() - 1000 }));
  await expect(page.getByRole('heading', { name: 'That class QR code has expired.' })).toBeVisible();
  await page.getByRole('button', { name: 'Paste a class link' }).click();
  await expect(page.getByLabel('Got a class link instead? Paste it here.')).toBeFocused();
});
