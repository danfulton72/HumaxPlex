// The whole web app in headless Chromium, against a fake Plex server and a
// fake native shell: sign-in screen at TV resolutions, Back-to-exit, options
// lists, library filter, film playback HUD, leaving the app, failure screen,
// settings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

let server, base, browser;
before(async () => {
  server = http.createServer(async (req, res) => {
    const file = path.join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// The Android bridge, recording calls. Values mimic a Dangbei DBOX02.
const NATIVE = `
window.__calls = { open: [], hud: [], pause: 0, play: 0, close: 0, exit: 0 };
window.EasyPlexVideo = {
  deviceInfo: () => JSON.stringify({ manufacturer: 'Dangbei', model: 'DBOX02', release: '11', appVersion: '0.3.1' }),
  exit() { __calls.exit++; }, imageFailed() {},
  open(u) { __calls.open.push(u); }, close() { __calls.close++; },
  play() { __calls.play++; }, pause() { __calls.pause++; }, seek() {},
  setHud(t, line, p, show, sticky) { __calls.hud.push({ t, line, p, show, sticky }); },
  hideHud() {},
};`;
const SIGNED_IN = `
localStorage.setItem('ss.token', JSON.stringify('t'));
localStorage.setItem('ss.user', JSON.stringify({ title: 'Dan' }));
localStorage.setItem('ss.server', JSON.stringify({ uri: 'http://pms.test', token: 't', name: 'Mock Plex', id: 'm1' }));`;

const MOVIE = {
  ratingKey: '101', key: '/library/metadata/101', type: 'movie', title: 'The Long Road', year: 2024,
  duration: 6000000, viewOffset: 1200000, summary: 'A film.', thumb: '/t', art: '/a',
  Media: [{ container: 'mp4', videoCodec: 'h264', Part: [{ id: 9, key: '/library/parts/9/file.mp4',
    Stream: [{ streamType: 2, codec: 'aac', id: 1, selected: true }] }] }],
};

async function newPage({ width = 1920, height = 1080, scale = 1, signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await ctx.addInitScript(NATIVE + (signedIn ? SIGNED_IN : ''));
  const seen = [];
  await ctx.route('http://pms.test/**', route => {
    const u = new URL(route.request().url());
    seen.push({ method: route.request().method(), path: u.pathname, query: u.search });
    const p = u.pathname;
    let body = {};
    if (p === '/identity') body = { MediaContainer: { machineIdentifier: 'm1' } };
    else if (p === '/library/sections') body = { MediaContainer: { Directory: [{ key: '1', title: 'Films', type: 'movie' }] } };
    else if (p === '/hubs') body = { MediaContainer: { Hub: [{ hubIdentifier: 'movie.recent', title: 'Recently Added', type: 'movie', size: 1, Metadata: [MOVIE] }] } };
    else if (p === '/library/sections/1/all') body = { MediaContainer: { totalSize: 1, size: 1, Metadata: [MOVIE] } };
    else if (p === '/library/sections/1/firstCharacter') body = { MediaContainer: { Directory: [{ title: 'T', size: 1 }] } };
    else if (p.startsWith('/library/metadata/')) body = { MediaContainer: { Metadata: [MOVIE] } };
    else if (p.endsWith('/decision')) body = { MediaContainer: { generalDecisionCode: 1000 } };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route('**/plex.tv/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, code: 'ABCD' }) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.waitForTimeout(1500);
  const key = async (a, wait = 150) => { await page.evaluate(x => window.__androidAction(x), a); await page.waitForTimeout(wait); };
  const text = sel => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
  const list = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent), sel);
  return { ctx, page, errors, seen, key, text, list };
}

for (const [name, width, height, scale] of [['1080p', 1920, 1080, 1], ['960x540 @2x', 960, 540, 2], ['4K as 1280x720 @3x', 1280, 720, 3]]) {
  test('sign-in screen fills the screen at ' + name, async () => {
    const { ctx, page, errors } = await newPage({ width, height, scale, signedIn: false });
    const rect = await page.evaluate(() => { const r = document.body.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.deepEqual(rect, [width, height]);
    assert.match(await page.evaluate(() => document.body.innerText), /Link EasyPlex to Plex/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('signed-in app: exit, options, library, playback, failure, settings', async () => {
  const { ctx, page, errors, seen, key, text, list } = await newPage();
  const calls = () => page.evaluate(() => window.__calls);

  // Back twice to exit.
  assert.match(await page.evaluate(() => document.body.innerText), /Recently Added/);
  await key('back');
  assert.equal((await calls()).exit, 0);
  assert.match(await text('.ep-toast'), /Press Back again to exit/);
  await key('back');
  assert.equal((await calls()).exit, 1);

  // Hold OK on a film: options, mark watched.
  await key('menu');
  assert.deepEqual(await list('.ep-options .hx-menu-item'), ['Resume from 20:00', 'Play from the start', 'Details', 'Mark as watched']);
  await key('down'); await key('down'); await key('down'); await key('enter', 600);
  assert.ok(seen.some(r => r.path === '/:/scrobble'));
  assert.match(await text('.ep-toast'), /Marked as watched/);

  // Library: options include sort and unwatched filter.
  await key('up'); await key('right'); await key('enter', 800);
  assert.match(await text('.lib-title'), /Films/);
  await key('menu');
  const libItems = await list('.ep-options .hx-menu-item');
  assert.ok(libItems[1].startsWith('✓') && libItems.includes('Show unwatched only'));
  for (let i = 0; i < libItems.indexOf('Show unwatched only'); i++) await key('down');
  await key('enter', 800);
  assert.ok(seen.some(r => r.path === '/library/sections/1/all' && r.query.includes('unwatched=1')));
  assert.match(await text('.lib-sort'), /Unwatched only/);
  await key('back', 400);

  // Film playback: native HUD gets title, 24-hour end time, seek preview.
  await key('down', 300);
  await key('play', 1200);
  assert.equal((await calls()).open.length, 1);
  await page.evaluate(() => window.__easyplexVideoEvent('ready'));
  await page.waitForTimeout(400);
  let hud = (await calls()).hud.at(-1);
  assert.equal(hud.t, 'The Long Road  (2024)');
  assert.match(hud.line, /Ends \d\d:\d\d$/);
  await key('right'); await key('right'); await key('right');
  hud = (await calls()).hud.at(-1);
  assert.match(hud.line, /^Seek to /);
  assert.equal(hud.sticky, true);
  await page.waitForTimeout(1200);

  // Leaving the app pauses.
  await page.evaluate(() => window.__easyplexLifecycle('stop'));
  await page.waitForTimeout(200);
  assert.ok((await calls()).pause >= 1);
  assert.match((await calls()).hud.at(-1).line, /Paused/);

  // Failure: direct play falls back to HLS, then a choice screen.
  await page.evaluate(() => window.__easyplexVideoEvent('error', 'boom'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__easyplexVideoEvent('ready'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__easyplexVideoEvent('error', 'HTTP 500'));
  await page.waitForTimeout(500);
  assert.deepEqual(await list('.ep-fail .hx-menu-item'), ['Try again', 'Try again at lower quality (720p)', 'Back']);
  const opens = (await calls()).open.length;
  await key('down'); await key('enter', 900);
  const open = (await calls()).open;
  assert.equal(open.length, opens + 1);
  assert.match(open.at(-1), /maxVideoBitrate=4000/);
  assert.match(open.at(-1), /1280x720/);
  await page.evaluate(() => window.__easyplexVideoEvent('ready'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__easyplexVideoEvent('error', 'again'));
  await page.waitForTimeout(400);
  await key('down'); await key('down'); await key('enter', 500);
  assert.match(await page.evaluate(() => document.body.innerText), /Recently Added/);

  // Settings: start screen choice, no developer items.
  for (let i = 0; i < 5; i++) await key('right');
  await key('up');
  for (let i = 0; i < 5; i++) await key('right');
  await key('enter', 600);
  const labels = await list('.setting-label');
  assert.ok(labels.includes('Start screen'));
  assert.ok(!labels.some(l => /Performance|Demo/.test(l)));

  assert.deepEqual(errors, []);
  await ctx.close();
});
