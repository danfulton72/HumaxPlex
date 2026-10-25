// Xtream (Dispatcharr VOD) helpers: server addresses, API replies, stream URLs,
// resume points and sorting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/env.mjs';

setupDom();
const x = await import('../web/js/xtream/api.js');
const { sortMovies } = await import('../web/js/screens/vod.js');
const { seekStep } = await import('../web/js/screens/vodplayer.js');
const { vodMetaLine } = await import('../web/js/screens/voddetail.js');

test('normaliseServer accepts bare hosts, pasted API URLs and the Plex tuner URI', () => {
  assert.equal(x.normaliseServer('dispatcharr.lan:9191'), 'http://dispatcharr.lan:9191');
  assert.equal(x.normaliseServer(' http://10.0.0.5:9191/ '), 'http://10.0.0.5:9191');
  assert.equal(x.normaliseServer('https://tv.example.com/player_api.php?username=a&password=b'), 'https://tv.example.com');
  assert.equal(x.normaliseServer('http://10.0.0.5:9191/get.php'), 'http://10.0.0.5:9191');
  assert.equal(x.normaliseServer('http://10.0.0.5:9191/hdhr'), 'http://10.0.0.5:9191');
  assert.equal(x.normaliseServer(''), '');
});

test('config is saved normalised and can be removed', () => {
  x.saveConfig({ server: 'host:9191/', username: ' dan ', password: 'p w' });
  assert.deepEqual(x.loadConfig(), { server: 'http://host:9191', username: 'dan', password: 'p w' });
  assert.ok(x.isConfigured());
  x.clearConfig();
  assert.equal(x.loadConfig(), null);
  assert.ok(!x.isConfigured());
});

test('stream and API URLs escape the login', () => {
  const c = new x.XtreamClient({ server: 'host:9191', username: 'dan', password: 'a/b#c' });
  assert.equal(c.streamUrl('42', 'mkv'), 'http://host:9191/movie/dan/a%2Fb%23c/42.mkv');
  assert.equal(c.streamUrl('42'), 'http://host:9191/movie/dan/a%2Fb%23c/42.mp4');
  const u = new URL(c.apiUrl({ action: 'get_vod_streams', category_id: '7' }));
  assert.equal(u.pathname, '/player_api.php');
  assert.equal(u.searchParams.get('password'), 'a/b#c');
  assert.equal(u.searchParams.get('category_id'), '7');
});

test('movieItem shapes get_vod_streams entries for tiles', () => {
  const m = x.movieItem({ stream_id: 11, name: 'Heat (1995)', stream_icon: 'http://i/h.jpg', rating: '8.3', container_extension: 'mkv', added: '1700000000', category_id: 3 });
  assert.equal(m.id, '11');
  assert.equal(m.title, 'Heat');
  assert.equal(m.year, '1995');
  assert.equal(m.posterUrl, 'http://i/h.jpg');
  assert.equal(m.rating, 8.3);
  assert.equal(m.ext, 'mkv');
  assert.equal(m.categoryId, '3');
  assert.equal(x.movieItem({ stream_id: 1, name: 'Ronin', year: '1998' }).year, '1998');
  assert.equal(x.movieItem({ stream_id: 1, name: 'Ronin' }).ext, 'mp4');
});

test('movieInfo reads details, artwork and either duration form', () => {
  const info = x.movieInfo({
    info: { name: 'Heat', year: '1995', plot: 'Cops.', genre: 'Crime', director: 'Michael Mann', actors: 'Al Pacino', rating: '8.3',
      cover_big: 'http://i/c.jpg', backdrop_path: ['', 'http://i/b.jpg'], duration: '02:50:00' },
    movie_data: { stream_id: 11, container_extension: 'mkv' },
  }, '11');
  assert.equal(info.duration, 10200000);
  assert.equal(info.backdropUrl, 'http://i/b.jpg');
  assert.equal(info.cast, 'Al Pacino');
  assert.equal(info.ext, 'mkv');
  assert.equal(x.movieInfo({ info: { name: 'A', duration_secs: 6000 } }, '5').duration, 6000000);
  assert.equal(x.movieInfo({ info: {} }, '5').duration, 0);
  assert.equal(vodMetaLine(info), '1995  ·  2h 50m  ·  ★ 8.3  ·  Crime');
});

test('auth succeeds only for an active, authorised account', async () => {
  const reply = (status, body) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const cfg = { server: 'h', username: 'u', password: 'p' };
  assert.equal((await new x.XtreamClient(cfg, reply(200, { user_info: { auth: 1, status: 'Active' } })).auth()).auth, 1);
  await assert.rejects(new x.XtreamClient(cfg, reply(200, { user_info: { auth: 0 } })).auth(), e => e.status === 401);
  await assert.rejects(new x.XtreamClient(cfg, reply(401, { error: 'Unauthorized' })).auth(), e => e.status === 401);
  await assert.rejects(new x.XtreamClient(cfg, reply(200, { user_info: { auth: 1, status: 'Expired' } })).auth(), /Expired/);
  const notJson = async () => ({ ok: true, status: 200, text: async () => '<html>' });
  await assert.rejects(new x.XtreamClient(cfg, notJson).auth(), /Xtream/);
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(new x.XtreamClient(cfg, down).auth(), /Could not reach http:\/\/h/);
});

test('friendlyError explains the usual Dispatcharr refusals', () => {
  assert.match(x.friendlyError({ status: 401 }), /username or password/);
  assert.match(x.friendlyError({ status: 403 }), /network access/);
  assert.match(x.friendlyError({ status: 429 }), /Too many/);
});

test('categories and films parse empty or odd replies safely', async () => {
  const c = new x.XtreamClient({ server: 'h', username: 'u', password: 'p' }, async () => ({ ok: true, status: 200, text: async () => '{}' }));
  assert.deepEqual(await c.categories(), []);
  assert.deepEqual(await c.movies('1'), []);
});

test('resume points: saved mid-film, cleared near the start or end, newest first', () => {
  localStorage.clear();
  const film = { id: '11', title: 'Heat', year: '1995', posterUrl: 'p', ext: 'mkv' };
  x.saveResume(film, 30000, 6000000);
  assert.equal(x.resumeFor('11'), null, 'under a minute is not worth resuming');
  x.saveResume(film, 1200000, 6000000);
  assert.equal(x.resumeFor('11').position, 1200000);
  x.saveResume({ id: '12', title: 'Ronin' }, 600000, 6000000);
  assert.deepEqual(x.resumeList().map(r => r.id), ['12', '11']);
  const items = x.resumeItems();
  assert.equal(items[1].viewOffset, 1200000);
  assert.equal(items[1].posterUrl, 'p');
  x.saveResume(film, 5950000, 6000000);
  assert.equal(x.resumeFor('11'), null, 'finished films drop off');
  x.clearResume('12');
  assert.deepEqual(x.resumeList(), []);
});

test('sortMovies and the seek steps', () => {
  const list = [{ title: 'b', added: 1, rating: 9 }, { title: 'a', added: 3, rating: 5 }, { title: 'c', added: 2, rating: 7 }];
  assert.deepEqual(sortMovies(list, 'title').map(m => m.title), ['a', 'b', 'c']);
  assert.deepEqual(sortMovies(list, 'added').map(m => m.title), ['a', 'c', 'b']);
  assert.deepEqual(sortMovies(list, 'rating').map(m => m.title), ['b', 'c', 'a']);
  assert.deepEqual(sortMovies(list, 'server'), list);
  assert.deepEqual([0, 3, 8, 16].map(seekStep), [10000, 30000, 60000, 180000]);
});

test('imageUrl proxies absolute artwork on the box', () => {
  assert.equal(x.imageUrl('http://i/a.jpg'), 'http://i/a.jpg');
  assert.equal(x.imageUrl('/relative.jpg'), '');
  globalThis.EasyPlexVideo = {};
  assert.equal(x.imageUrl('http://i/a.jpg'), 'https://appassets.androidplatform.net/pleximg?url=http%3A%2F%2Fi%2Fa.jpg');
  delete globalThis.EasyPlexVideo;
});

test('category limits per profile: none means all, matched by uuid or name', async () => {
  const lim = await import('../web/js/xtream/limits.js');
  localStorage.clear();
  const cats = [{ id: '1', name: 'Kids' }, { id: '2', name: 'Horror' }, { id: '3', name: 'Family' }];
  assert.equal(lim.allowedFor('kid'), null);
  assert.deepEqual(lim.filterCategories(cats, null), cats);
  lim.setAllowed('kid', 'Ella', ['1', 3, '3']);
  assert.deepEqual(lim.allowedFor('kid'), ['1', '3']);
  assert.deepEqual(lim.filterCategories(cats, lim.allowedFor('kid')).map(c => c.name), ['Kids', 'Family']);
  assert.deepEqual(lim.allowedForUser({ uuid: 'kid', title: 'x' }), ['1', '3']);
  assert.deepEqual(lim.allowedForUser({ title: 'Ella' }), ['1', '3'], 'older sessions without a uuid match by name');
  assert.equal(lim.allowedForUser({ uuid: 'other', title: 'Dan' }), null);
  assert.equal(lim.limitLabel(null, 3), 'All categories');
  assert.equal(lim.limitLabel([], 3), 'No films');
  assert.equal(lim.limitLabel(['1', '3'], 40), '2 of 40 categories');
  lim.setAllowed('kid', 'Ella', []);
  assert.deepEqual(lim.filterCategories(cats, lim.allowedFor('kid')), [], 'an empty limit hides everything');
  lim.setAllowed('kid', 'Ella', null);
  assert.equal(lim.allowedFor('kid'), null);
});

test('resume points are kept per Plex profile', async () => {
  const { session } = await import('../web/js/session.js');
  localStorage.clear();
  session.user = { title: 'Dan', uuid: 'admin' };
  x.saveResume({ id: '11', title: 'Heat', categoryId: '2' }, 1200000, 6000000);
  assert.equal(x.resumeFor('11').categoryId, '2');
  session.user = { title: 'Ella', uuid: 'kid' };
  assert.equal(x.resumeFor('11'), null);
  assert.deepEqual(x.resumeItems(), []);
  session.user = null;
});

test('the account that linked the box is admin unless a Home says otherwise', async () => {
  const s = await import('../web/js/session.js');
  s.signIn('t', { title: 'Dan', uuid: 'a', home: true, homeAdmin: true });
  assert.ok(s.isAdmin());
  s.signIn('t', { title: 'Solo', uuid: 'b', home: false });
  assert.ok(s.isAdmin());
  s.activateHomeUser('k', { title: 'Ella', uuid: 'kid', admin: false });
  assert.ok(!s.isAdmin());
  assert.equal(s.profileKey(), 'kid');
  s.signOut();
  assert.ok(!s.isAdmin());
});
