import { test, expect } from '@playwright/test';
import { standInInbox, INBOX_URL, SECRET, unb64url } from './stand-in.mjs';

async function connect(page, { name = 'Mr Evans 3/4B', secret = SECRET } = {}) {
  await page.getByLabel(/Class name/).fill(name);
  await page.getByLabel(/Web app URL/).fill(INBOX_URL);
  await page.getByLabel(/Secret code/).fill(secret);
}

test('the script and manifest are on the page, ready to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByText('Show the script').click();
  await expect(page.locator('#gs-text')).toContainText('Classroom Inbox (version 6)');
  await page.getByRole('button', { name: 'Copy the script' }).click();
  await expect(page.locator('#toast')).toContainText('Script copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("app: 'PagePal Inbox'");
  await page.getByRole('button', { name: 'Copy appsscript.json' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).oauthScopes).toEqual([
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request',
  ]);
  await expect(page.getByRole('link', { name: 'Download it' })).toHaveAttribute('download', 'Classroom-Inbox.gs');
});

test('deploy tabs: Updating explains the pencil, and arrow keys move between tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tabpanel', { name: 'First time' })).toBeVisible();
  await page.getByRole('tab', { name: 'First time' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Updating' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Updating' })).toContainText('greyed out until you click the pencil');
  await expect(page.getByRole('tabpanel', { name: 'First time' })).toBeHidden();
});

test('checking a v6 inbox shows the version and the tools it accepts; secret never saved', async ({ page }) => {
  const inbox = await standInInbox(page);
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toContainText('Connected: Classroom Inbox, version 6. It accepts work from PagePal and Word Helper.');
  await expect(page.locator('#tools .badge.yes')).toHaveCount(2);
  await expect(page.locator('#tools')).toContainText('PagePal submissions › Class › Worksheet');
  await expect(page.locator('#tools')).toContainText('Word Helper submissions › Class');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).toContain(INBOX_URL);
  expect(stored).not.toContain(SECRET);
  expect(inbox.requests.every(r => r.method === 'GET')).toBe(true);
});

test('an older script is flagged for updating', async ({ page }) => {
  const inbox = await standInInbox(page, { version: 4 });
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toHaveClass(/warn/);
  await expect(page.locator('#check-status')).toContainText('your script is version 4');
  await expect(page.locator('#check-status')).toContainText('Update it');

  inbox.version = 3; inbox.tools = null; // before tools were listed: PagePal only
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toContainText('takes PagePal work only');
  await expect(page.locator('.tool', { hasText: 'Word Helper' }).locator('.badge')).toHaveText('Needs the new script');
});

test('a wrong address or unreachable inbox says what to check', async ({ page }) => {
  const inbox = await standInInbox(page);
  await page.goto('/');
  await page.getByLabel(/Web app URL/).fill('https://example.com/exec');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toContainText('should start with');
  inbox.down = true;
  await connect(page);
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toContainText('Couldn’t reach your inbox');
  await expect(page.locator('#check-status')).toContainText('Who has access');
});

test('making a class QR code: wrong secret, then a code that holds a join code, never the key', async ({ page }) => {
  await standInInbox(page);
  await page.goto('/');
  await connect(page, { secret: 'not-the-secret' });
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#make-status')).toContainText('secret code doesn’t match');
  await expect(page.locator('#qr-result')).toBeHidden();

  await page.getByLabel(/Secret code/).fill(SECRET);
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#qr-result')).toBeVisible();
  await expect(page.locator('#qr svg')).toBeVisible();
  await expect(page.locator('#qr-label')).toHaveText('Mr Evans 3/4B');
  await expect(page.locator('#qr-result')).toContainText('Scan with the iPad camera');
  await expect(page.locator('#qr-expiry')).toContainText('Connects new iPads until');
  const link = await page.locator('#qr-link').textContent();
  const u = new URL(link);
  expect(u.pathname).toBe('/join/');
  const code = unb64url(u.searchParams.get('teacher'));
  expect(code.n).toBe('Mr Evans 3/4B');
  expect(code.u).toBe(INBOX_URL);
  expect(code.j).toMatch(/^join/);
  expect(code.k).toBeUndefined();
  expect(link).not.toContain(SECRET);
  const days = (code.x - Date.now()) / 86400000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);
});

test('the QR code can last the whole term (80 days)', async ({ page }) => {
  await standInInbox(page);
  await page.goto('/');
  await connect(page);
  await page.getByLabel(/connects new iPads for/).selectOption('80');
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#qr-result')).toBeVisible();
  const code = unb64url(new URL(await page.locator('#qr-link').textContent()).searchParams.get('teacher'));
  expect(Math.round((code.x - Date.now()) / 86400000)).toBe(80);
});

test('Copy link and Download picture work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await standInInbox(page);
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#qr-result')).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator('#qr-link').textContent());
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download picture' }).click()]);
  expect(download.suggestedFilename()).toBe('Class-QR-Mr-Evans-3-4B.png');
});

test('remembers the class and address from the old PagePal teacher page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(url => localStorage.setItem('pagepal.teacherPage', JSON.stringify({ name: 'Ms K, 5/6', url })), INBOX_URL);
  await page.reload();
  await expect(page.getByLabel(/Class name/)).toHaveValue('Ms K, 5/6');
  await expect(page.getByLabel(/Web app URL/)).toHaveValue(INBOX_URL);
  await expect(page.getByLabel(/Secret code/)).toHaveValue('');
});

test('a class QR code made here connects a student on the join page', async ({ page }) => {
  await standInInbox(page);
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#qr-result')).toBeVisible();
  const link = await page.locator('#qr-link').textContent();
  await page.goto(link);
  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByRole('heading', { name: 'You’re connected to Mr Evans 3/4B' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pagepal.settings')).teacher);
  expect(saved).toEqual({ name: 'Mr Evans 3/4B', url: INBOX_URL, secret: SECRET });
});

test('a QR code can last forever: no expiry date, a clear warning, and it connects a student', async ({ page }) => {
  await standInInbox(page);
  await page.goto('/');
  await connect(page);
  await page.getByLabel(/connects new iPads for/).selectOption('forever');
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#qr-result')).toBeVisible();
  await expect(page.locator('#qr-expiry')).toHaveText('Connects new iPads until you cancel it');
  await expect(page.locator('#make-status')).toHaveClass(/warn/);
  await expect(page.locator('#make-status')).toContainText('cancelClassCodes');
  const link = await page.locator('#qr-link').textContent();
  const code = unb64url(new URL(link).searchParams.get('teacher'));
  expect(code.x || 0).toBe(0);
  expect(JSON.stringify(code)).not.toContain(SECRET);
  await page.goto(link);
  await page.getByRole('button', { name: 'Yes, connect' }).click();
  await expect(page.getByRole('heading', { name: 'You’re connected to Mr Evans 3/4B' })).toBeVisible();
});

test('forever needs script version 6: an older script says so and sends nothing', async ({ page }) => {
  const inbox = await standInInbox(page, { version: 5 });
  await page.goto('/');
  await connect(page);
  await page.getByLabel(/connects new iPads for/).selectOption('forever');
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#make-status')).toContainText('can’t make QR codes that never expire');
  await expect(page.locator('#qr-result')).toBeHidden();
  expect(inbox.requests.filter(r => r.method === 'POST')).toHaveLength(0);
});

test('a paused inbox is flagged, and making a QR code says how to resume', async ({ page }) => {
  await standInInbox(page, { paused: true });
  await page.goto('/');
  await connect(page);
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.locator('#check-status')).toContainText('Your inbox is paused');
  await page.getByRole('button', { name: 'Make the QR code' }).click();
  await expect(page.locator('#make-status')).toContainText('resumeInbox');
});

test('the page explains how to turn the inbox off', async ({ page }) => {
  await page.goto('/');
  const off = page.getByRole('region', { name: 'Turning the inbox off' });
  for (const fn of ['cancelClassCodes', 'pauseInbox', 'resumeInbox', 'resetCode']) await expect(off).toContainText(fn);
  await expect(off).toContainText('Archive');
});
