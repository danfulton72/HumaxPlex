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

// A Dispatcharr Xtream output with two categories.
const XT_CATS = [{ category_id: '1', category_name: 'Action', parent_id: 0 }, { category_id: '2', category_name: 'Drama', parent_id: 0 }];
const XT_FILMS = [
  { stream_id: 11, name: 'Heat (1995)', stream_icon: 'http://xtream.test/img/11.jpg', rating: '8.3', container_extension: 'mkv', added: '1700000000', category_id: '1' },
  { stream_id: 12, name: 'Ronin (1998)', stream_icon: '', rating: '7.2', container_extension: 'mp4', added: '1700000100', category_id: '1' },
  { stream_id: 21, name: 'Quiet Days', stream_icon: '', rating: '6', container_extension: 'mp4', added: '1700000200', category_id: '2' },
];
const XT_INFO = {
  info: { name: 'Heat', year: '1995', plot: 'Cops and robbers in LA.', genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino, Robert De Niro',
    rating: '8.3', duration_secs: 6000, cover_big: 'http://xtream.test/img/11.jpg', backdrop_path: ['http://xtream.test/img/b11.jpg'] },
  movie_data: { stream_id: 11, container_extension: 'mkv' },
};

async function newPage({ width = 1920, height = 1080, scale = 1, signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await ctx.addInitScript(NATIVE + (signedIn ? SIGNED_IN : ''));
  const seen = [], xtreamSeen = [];
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
    else if (p === '/livetv/dvrs') body = { MediaContainer: { Dvr: [{ key: '1', Device: [{ uri: 'http://xtream.test/hdhr' }] }] } };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route('http://xtream.test/**', route => {
    const u = new URL(route.request().url());
    xtreamSeen.push(u.pathname + u.search);
    const q = u.searchParams;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (u.pathname !== '/player_api.php') return json(404, {});
    if (q.get('username') !== 'dan' || q.get('password') !== 'pw') return json(401, { error: 'Unauthorized' });
    const action = q.get('action');
    if (!action) return json(200, { user_info: { auth: 1, status: 'Active' }, server_info: {} });
    if (action === 'get_vod_categories') return json(200, XT_CATS);
    if (action === 'get_vod_streams') return json(200, XT_FILMS.filter(f => f.category_id === q.get('category_id')));
    if (action === 'get_vod_info') return json(200, XT_INFO);
    return json(200, []);
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
  return { ctx, page, errors, seen, xtreamSeen, key, text, list };
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
  // The player's measured length wins over Plex's metadata.
  await page.evaluate(() => window.__easyplexVideoEvent('duration', 7200000));
  await page.evaluate(() => window.__easyplexVideoEvent('time', 1300000));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__easyplexVideoEvent('time', 1301000));
  assert.match((await calls()).hud.at(-1).line, / \/ 2:00:00 /);
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

test('Dispatcharr VOD: set up in Settings, browse, details, play, resume', async () => {
  const { ctx, page, errors, xtreamSeen, key, text, list } = await newPage();
  const calls = () => page.evaluate(() => window.__calls);
  const navLabels = () => page.evaluate(() => [...document.querySelectorAll('.home .nav-item')].map(n => n.textContent || (n.querySelector('svg') ? 'icon' : '')));
  assert.ok(!(await navLabels()).includes('VOD'), 'no VOD until it is set up');

  // Settings → Dispatcharr VOD. The server comes from the Plex tuner URI.
  await key('up');
  for (let i = 0; i < 6; i++) await key('right');
  await key('enter', 600);
  assert.ok((await list('.setting-value')).includes('Not set up'));
  for (let i = 0; i < 4; i++) await key('down');
  await key('enter', 800);
  assert.equal(await page.inputValue('.vod-input >> nth=0'), 'http://xtream.test');
  assert.match(await text('.vod-setup-status'), /from your Plex Live TV tuner/);

  // Wrong password first: nothing saved, a clear message.
  await key('down'); await key('enter'); await page.keyboard.type('dan'); await key('enter');
  await key('enter'); await page.keyboard.type('nope'); await key('enter');
  await key('enter', 800);
  assert.match(await text('.vod-setup-status'), /username or password was not accepted/);
  assert.equal(await page.evaluate(() => localStorage.getItem('ss.xtream')), null);

  await key('up'); await key('enter');
  await page.fill('.vod-input >> nth=2', 'pw');
  await key('enter'); await key('enter', 800);
  assert.match(await text('.vod-setup-status'), /Connected · 2 film categories/);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('ss.xtream'))), { server: 'http://xtream.test', username: 'dan', password: 'pw' });
  await page.waitForTimeout(1000);
  assert.ok((await list('.setting-value')).some(v => v.includes('dan @ xtream.test')));

  // Back on the home bar there is a VOD item.
  await key('back', 600);
  assert.ok((await navLabels()).includes('VOD'));
  await key('left'); await key('left');
  await key('enter', 1000);
  assert.deepEqual(await list('.vod-cat'), ['Action', 'Drama']);
  assert.match(await text('.lib-count'), /2 films\s+·\s+Action/);
  assert.ok(xtreamSeen.some(u => u.includes('action=get_vod_streams') && u.includes('category_id=1')));
  assert.ok(!xtreamSeen.some(u => u.includes('action=get_vod_streams') && !u.includes('category_id')), 'never loads the whole catalogue');

  // Drama loads on its own; then back to Action and into the grid.
  await key('down', 700);
  assert.match(await text('.lib-count'), /1 film\s+·\s+Drama/);
  await key('up', 700);
  await key('right');
  assert.match(await text('.vod-focus'), /^Heat {3}1995/);
  await key('yellow');
  assert.match(await text('.lib-sort'), /A–Z/);
  await key('yellow'); await key('yellow'); await key('yellow');

  // Details from get_vod_info.
  await key('enter', 800);
  assert.equal(await text('.vod-detail .detail-title'), 'Heat');
  assert.equal(await text('.vod-detail .detail-meta'), '1995  ·  1h 40m  ·  ★ 8.3  ·  Crime');
  assert.match(await page.evaluate(() => document.querySelector('.vod-detail').innerText), /Directed by Michael Mann/);
  assert.deepEqual(await list('.vod-detail .btn'), ['Play']);

  // Play: the file straight from Dispatcharr, HUD in 24-hour time.
  await key('enter', 500);
  assert.equal((await calls()).open.at(-1), 'http://xtream.test/movie/dan/pw/11.mkv');
  await page.evaluate(() => window.__easyplexVideoEvent('ready'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__easyplexVideoEvent('time', 1200000));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__easyplexVideoEvent('time', 1201000));
  let hud = (await calls()).hud.at(-1);
  assert.equal(hud.t, 'Heat  (1995)');
  assert.match(hud.line, /^20:01 \/ 1:40:00 {2}· {2}Ends \d\d:\d\d$/);
  await key('right'); await key('right');
  assert.match((await calls()).hud.at(-1).line, /^Seek to 20:21/);
  await page.waitForTimeout(1200);

  // A failure offers a retry; Back leaves and keeps the resume point.
  await page.evaluate(() => window.__easyplexVideoEvent('error', 'HTTP 404'));
  await page.waitForTimeout(300);
  assert.deepEqual(await list('.ep-fail .hx-menu-item'), ['Try again', 'Start from the beginning', 'Back']);
  assert.match(await text('.ep-fail .hx-dlg-sub'), /not found on the server/);
  await key('back', 500);
  assert.deepEqual(await list('.vod-detail .btn'), ['Resume from 20:21', 'Play from the start', 'Remove from Continue Watching']);

  // Continue Watching heads the category list.
  await key('back', 500);
  assert.deepEqual(await list('.vod-cat'), ['Continue watching', 'Action', 'Drama']);
  await key('back'); await key('up', 300);
  await key('enter', 300);
  assert.match(await text('.lib-count'), /1 film\s+·\s+Continue watching/);
  await key('right');
  await key('menu');
  assert.deepEqual((await list('.ep-options .hx-menu-item')).slice(0, 4), ['Resume', 'Play from the start', 'Details', 'Remove from Continue Watching']);
  await key('enter', 500);
  assert.equal((await calls()).open.at(-1), 'http://xtream.test/movie/dan/pw/11.mkv');

  assert.deepEqual(errors, []);
  await ctx.close();
});
