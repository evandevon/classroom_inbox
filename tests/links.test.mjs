// Class links: encoding, decoding and the checks the join page relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTeacher, decodeTeacher, isInboxUrl, isExpired, joinLink, teacherCodeFrom, b64urlEncode } from '../js/links.js';

const URL1 = 'https://script.google.com/macros/s/AKfy123/exec';

test('a new class link round-trips, with no padding and no key', () => {
  const t = { name: 'Mr Evans 3/4B ✏️', url: URL1, join: 'abc123', expires: 1800000000000 };
  const code = encodeTeacher(t);
  assert.doesNotMatch(code, /[=+/]/);
  assert.deepEqual(decodeTeacher(code), t);
  const link = joinLink('https://evandevon.github.io/classroom_inbox/join/?x=1#y', t);
  assert.equal(link, 'https://evandevon.github.io/classroom_inbox/join/?teacher=' + code);
  assert.equal(teacherCodeFrom(link), code);
});

test('older links with the key still decode', () => {
  assert.deepEqual(decodeTeacher(b64urlEncode(JSON.stringify({ n: 'K', u: URL1, k: 'secret' }))), { name: 'K', url: URL1, secret: 'secret' });
});

test('PagePal-path links are read too', () => {
  assert.equal(teacherCodeFrom('https://evandevon.github.io/PagePal/?teacher=XYZ'), 'XYZ');
  assert.equal(teacherCodeFrom('not a link'), null);
});

test('only Apps Script addresses are trusted', () => {
  assert.ok(isInboxUrl(URL1));
  assert.ok(isInboxUrl('https://script.googleusercontent.com/macros/echo?x=1'));
  for (const u of ['http://script.google.com/x', 'https://script.google.com.evil.com/x', 'https://evil.com/?https://script.google.com/', 'https://script.google.com/', '']) {
    assert.equal(isInboxUrl(u), false, u);
    assert.equal(decodeTeacher(b64urlEncode(JSON.stringify({ n: 'x', u, j: 'j', x: 1 }))), null);
  }
  assert.equal(decodeTeacher('%%%'), null);
  assert.equal(decodeTeacher(b64urlEncode('null')), null);
  assert.equal(decodeTeacher(b64urlEncode(JSON.stringify({ n: 'x', u: URL1 }))), null, 'no join code or key');
});

test('expiry', () => {
  assert.equal(isExpired({ join: 'j', expires: 1000 }, 2000), true);
  assert.equal(isExpired({ join: 'j', expires: 3000 }, 2000), false);
  assert.equal(isExpired({ secret: 'k' }, 2000), false);
});
