// Pure helpers: dates, airing times, channel names and ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/env.mjs';

setupDom();
const lt = await import('../web/js/screens/livetv.js');

test('localDate uses the local calendar day, not UTC', () => {
  // 00:30 on 24 Oct BST is still 23 Oct in UTC; the guide must ask for the 24th.
  const t = new Date(2026, 9, 24, 0, 30).getTime();
  assert.equal(new Date(t).toISOString().slice(0, 10), '2026-10-23');
  assert.equal(lt.localDate(t), '2026-10-24');
});

test('toMillis accepts seconds, milliseconds and ISO strings', () => {
  assert.equal(lt.toMillis(1700000000), 1700000000000);
  assert.equal(lt.toMillis('1700000000'), 1700000000000);
  assert.equal(lt.toMillis(1700000000000), 1700000000000);
  assert.equal(lt.toMillis('2026-10-24T21:00:00Z'), Date.UTC(2026, 9, 24, 21));
  assert.ok(Number.isNaN(lt.toMillis('2026-10-24')), 'date-only has no time');
  assert.ok(Number.isNaN(lt.toMillis(null)));
});

test('airingBounds reads Media first and falls back to duration', () => {
  assert.deepEqual(lt.airingBounds({ Media: [{ beginsAt: 100, endsAt: 200 }] }), { start: 100000, end: 200000 });
  assert.deepEqual(lt.airingBounds({ beginsAt: 100, duration: 60000 }), { start: 100000, end: 160000 });
});

test('airingIn finds the programme on air at a moment', () => {
  const shows = [{ title: 'a', Media: [{ beginsAt: 0, endsAt: 100 }] }, { title: 'b', Media: [{ beginsAt: 100, endsAt: 200 }] }];
  assert.equal(lt.airingIn(shows, 50000).title, 'a');
  assert.equal(lt.airingIn(shows, 100000).title, 'b', 'end is exclusive');
  assert.equal(lt.airingIn(shows, 300000), null);
});

test('channelLabel drops the number and everything up to the first |', () => {
  assert.equal(lt.channelLabel('14365 UK| SKY CINEMA THRILLER HD'), 'SKY CINEMA THRILLER HD');
  assert.equal(lt.channelLabel('UK| BBC One HD'), 'BBC One HD');
  assert.equal(lt.channelLabel('BBC Two HD'), 'BBC Two HD');
  assert.equal(lt.channelLabel('101  BBC One'), 'BBC One');
  assert.equal(lt.channelLabel('UK|SKY|NEWS'), 'SKY|NEWS', 'only the first |');
  assert.equal(lt.channelLabel('5|'), '5|', 'never returns an empty name');
});

test('sortByChannelNumber orders numerically, unnumbered last', () => {
  const rows = [{ channelVcn: '10', name: 'b' }, { channelVcn: '2', name: 'a' }, { name: 'z' }, { channelVcn: '2', name: '0' }];
  assert.deepEqual(lt.sortByChannelNumber(rows).map(r => r.name), ['0', 'a', 'b', 'z']);
});

// ---- helpers extracted from the Live TV screen --------------------------------
const hp = await import('../web/js/screens/livetv/helpers.js');

test('scheduledEntries reads MediaGrabOperation, keeps active ones, in time order', () => {
  // The shape /media/subscriptions/scheduled actually returns (see the
  // recordings-list fix): MediaGrabOperation[] with nested Metadata.
  const mc = { MediaGrabOperation: [
    { status: 'scheduled', id: 'b', Metadata: { grandparentTitle: 'Show', title: 'Ep', parentIndex: 2, index: 5,
      Media: [{ channelTitle: '14365 UK| SKY ONE', beginsAt: 2000, endsAt: 3000 }] } },
    { status: 'inprogress', id: 'a', Metadata: { title: 'Film', Media: [{ channelTitle: 'UK| BBC One', beginsAt: 1000, endsAt: 4000 }] } },
    { status: 'complete', id: 'c', Metadata: { title: 'Old' } },
  ] };
  const e = hp.scheduledEntries(mc);
  assert.deepEqual(e.map(x => x.title), ['● REC  Film', 'Show']);
  assert.equal(e[1].episode, 'S2 E5 · Ep');
  assert.equal(e[1].channel, 'SKY ONE');
  assert.equal(e[0].start, 1000000);
  assert.deepEqual(hp.scheduledEntries({}), [], 'missing list is empty, not an error');
  assert.deepEqual(hp.scheduledEntries({ Metadata: [{ title: 'x' }] }), [], 'the old wrong shape yields nothing');
});

test('scheduledGuidSet finds guids at any depth', () => {
  const s = hp.scheduledGuidSet({ MediaGrabOperation: [{ Metadata: { guid: 'g1', grandparentGuid: 'x' } }, { Metadata: { Media: [{ guid: 'g2' }] } }] });
  assert.ok(s.has('g1') && s.has('g2'));
});

const TEMPLATE_OPT = {
  title: 'This Episode', type: 4,
  parameters: 'hints%5Bguid%5D=plex%3A%2F%2Fepisode%2F1&hints%5BratingKey%5D=plex%253A%252F%252Fepisode%252F1&params%5BlibraryType%5D=2',
  Setting: [{ id: 'minVideoQuality', value: 0 }, { id: 'replaceLowerQuality', default: false }, { id: 'lineupChannel', default: '' }],
};
const SECTIONS = [
  { key: 3, title: 'Films', type: 'movie', Location: [{ id: 30, path: '/films' }] },
  { key: 5, title: 'TV', type: 'show', Location: [{ id: 50, path: '/tv/a' }, { id: 51, path: '/tv/b' }] },
  { key: 6, title: 'More TV', type: 'show' },
];

test('libraryKind follows params[libraryType], else the option type', () => {
  assert.equal(hp.libraryKind(TEMPLATE_OPT), 'show');
  assert.equal(hp.libraryKind({ parameters: 'params[libraryType]=1', type: 4 }), 'movie');
  assert.equal(hp.libraryKind({ type: 1 }), 'movie');
  assert.equal(hp.libraryKind({ type: 2 }), 'show');
});

test('librariesFor lists every folder of matching libraries', () => {
  assert.deepEqual(hp.librariesFor(TEMPLATE_OPT, SECTIONS).map(l => l.sectionId + ':' + l.locId), ['5:50', '5:51', '6:']);
  assert.deepEqual(hp.librariesFor({ type: 1 }, SECTIONS).map(l => l.title), ['Films']);
});

test('defaultLibrary prefers the template, then the last used, then the first', () => {
  const libs = hp.librariesFor(TEMPLATE_OPT, SECTIONS);
  assert.equal(hp.defaultLibrary({ ...TEMPLATE_OPT, targetLibrarySectionID: 6 }, libs, '5:51'), 2);
  assert.equal(hp.defaultLibrary(TEMPLATE_OPT, libs, '5:51'), 1);
  assert.equal(hp.defaultLibrary(TEMPLATE_OPT, libs, null), 0);
});

test('subscriptionQuery matches what Plex Web sends', () => {
  const lib = { sectionId: '5', locId: '51' };
  const q = hp.subscriptionQuery(TEMPLATE_OPT, lib, {}, true);
  assert.ok(q.includes('hints%5BratingKey%5D=plex%253A%252F%252Fepisode%252F1'), 'parameters untouched');
  const p = new URLSearchParams(q);
  assert.equal(p.get('prefs[minVideoQuality]'), '0');
  assert.equal(p.get('prefs[replaceLowerQuality]'), 'false');
  assert.equal(p.get('prefs[lineupChannel]'), '', 'blank prefs still sent');
  assert.equal(p.get('targetLibrarySectionID'), '5');
  assert.equal(p.get('targetSectionLocationID'), '51');
  assert.equal(p.get('includeGrabs'), '1');
  assert.equal(p.get('type'), '4', 'type added when parameters lack it');
  assert.equal(new URLSearchParams(hp.subscriptionQuery(TEMPLATE_OPT, lib, {}, false)).get('targetSectionLocationID'), '');
  const own = new URLSearchParams(hp.subscriptionQuery({ type: 2, parameters: 'type=2&hints%5Bguid%5D=x' }, lib, {}, false));
  assert.deepEqual(own.getAll('type'), ['2'], 'no duplicate type');
  const bare = new URLSearchParams(hp.subscriptionQuery({ type: 4 }, lib, { guid: 'g', ratingKey: 'r', title: 'T' }, false));
  assert.equal(bare.get('hints[guid]'), 'g');
  assert.equal(bare.get('hints[title]'), 'T');
});

test('decodeQuery and templateText make readable diagnostics', () => {
  assert.deepEqual(hp.decodeQuery('a%5Bb%5D=c+d&e'), ['a[b] = c d', 'e']);
  const text = hp.templateText({ SubscriptionTemplate: [{ MediaSubscription: [{ ...TEMPLATE_OPT, selected: true }] }] });
  assert.match(text, /^Option 1: This Episode · type 4 · selected/);
  assert.match(text, /params\[libraryType\] = 2/);
  assert.match(hp.templateText(null), /none yet/);
});

test('plexError uses the HTML title when there is one', () => {
  const e = hp.plexError(400, '<html><head><title>Bad Request</title></head><body><h1>400 Bad Request</h1></body></html>');
  assert.equal(e.message, 'Plex HTTP 400 Bad Request');
  assert.equal(e.status, 400);
  assert.equal(hp.plexError(500, '').message, 'Plex HTTP 500');
});

test('channelGroup and findByNumber', () => {
  assert.equal(hp.channelGroup({ name: '14365 UK| SKY CINEMA' }), 'UK');
  assert.equal(hp.channelGroup({ name: 'BBC One' }), '');
  const rows = [{ channelVcn: '101' }, { channelVcn: '7' }];
  assert.equal(hp.findByNumber(rows, '7'), rows[1]);
  assert.equal(hp.findByNumber(rows, '007'), rows[1], 'leading zeros');
  assert.equal(hp.findByNumber(rows, '99'), null);
});

test('epgProviderPaths finds guide providers in /media/providers and the DVR list', () => {
  const paths = hp.epgProviderPaths(
    { MediaProvider: [{ identifier: 'com.plexapp.plugins.library' }, { Feature: [{ key: '/tv.plex.providers.epg.xmltv:12/grid' }] }] },
    [{ key: 'tv.plex.providers.epg.cloud:3' }]);
  assert.deepEqual(paths.sort(), ['/tv.plex.providers.epg.cloud:3', '/tv.plex.providers.epg.xmltv:12']);
  assert.deepEqual(hp.epgProviderPaths(null, []), []);
});

test('channelRowsFrom joins watch-now listings to lineup guide keys', () => {
  const urls = ['/p/watchnow/all', '/p/lineups/dvr/channels'];
  const replies = [
    { status: 'fulfilled', value: { Metadata: [
      { title: 'B', type: 'episode', Media: [{ channelVcn: '2', channelTitle: 'Two', channelIdentifier: 'id2' }] },
      { title: 'A', type: 'episode', Media: [{ channelVcn: '1', channelTitle: 'One', channelIdentifier: 'id1' }] },
      { title: 'A again', type: 'episode', Media: [{ channelVcn: '1', channelTitle: 'One', channelIdentifier: 'id1' }] },
    ] } },
    { status: 'fulfilled', value: { Channel: [{ id: 'id1', gridKey: 'gk1' }, { id: 'id2', gridKey: 'gk2' }] } },
  ];
  const rows = hp.channelRowsFrom(urls, replies, '7');
  assert.deepEqual(rows.map(r => [r.name, r.gridKey, r.title]), [['One', 'gk1', 'A'], ['Two', 'gk2', 'B']]);
  assert.equal(rows[0].dvrId, '7');
  assert.deepEqual(hp.channelRowsFrom(urls, [{ status: 'rejected' }, { status: 'rejected' }], '7'), []);
});

test('mediaDuration prefers the measured file length over agent metadata', async () => {
  const { mediaDuration, progress, metaLine } = await import('../web/js/util/format.js');
  // An NFO runtime of 22 minutes on a 41-minute file.
  const ep = { type: 'movie', duration: 1320000, viewOffset: 1200000, Media: [{ duration: 2460000, Part: [{ duration: 2460000 }] }] };
  assert.equal(mediaDuration(ep), 2460000);
  assert.equal(mediaDuration({ duration: 5, Media: [{ Part: [{ duration: 7 }] }] }), 7);
  assert.equal(mediaDuration({ duration: 5 }), 5);
  assert.equal(mediaDuration({}), 0);
  assert.ok(Math.abs(progress(ep) - 1200000 / 2460000) < 1e-9);
  assert.match(metaLine(ep), /41m/);
});
