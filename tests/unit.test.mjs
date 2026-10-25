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
