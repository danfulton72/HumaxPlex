// Image loader regression tests. The fake browser image completes only when
// requested, making request order and shared downloads deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const requests = [];
class FakeImage {
  set src(value) { this.url = value; requests.push(this); }
  complete() { this.onload(); }
}
globalThis.Image = FakeImage;
const { load, prefetch } = await import('../web/js/ui/images.js');
function tile() {
  const classes = new Set();
  return {
    classList: { add: (...c) => c.forEach(v => classes.add(v)), remove: (...c) => c.forEach(v => classes.delete(v)) },
    removeAttribute(k) { if (k === 'src') delete this.src; },
  };
}

test('one in-flight download serves multiple visible tiles', () => {
  const a = tile(), b = tile();
  load(a, 'shared'); load(b, 'shared');
  assert.equal(requests.filter(r => r.url === 'shared').length, 1);
  requests.find(r => r.url === 'shared').complete();
  assert.equal(a.src, 'shared'); assert.equal(b.src, 'shared');
});

test('visible tile requests run ahead of queued prefetches', () => {
  const blockers = Array.from({ length: 6 }, (_, i) => tile());
  blockers.forEach((el, i) => load(el, 'blocking-' + i));
  prefetch('prefetched');
  const visible = tile(); load(visible, 'visible');
  requests.find(r => r.url === 'blocking-0').complete();
  assert.equal(requests.at(-1).url, 'visible');
  requests.at(-1).complete();
  requests.find(r => r.url === 'blocking-1').complete();
  assert.equal(requests.at(-1).url, 'prefetched');
});

test('recycled tiles ignore old responses and cancelled queued images', () => {
  const obsolete = tile();
  load(obsolete, 'queued-obsolete');
  load(obsolete, 'replacement');
  requests.find(r => r.url === 'blocking-2').complete();
  assert.equal(requests.at(-1).url, 'replacement');
  assert.ok(!requests.some(r => r.url === 'queued-obsolete'));
  requests.at(-1).complete();
  assert.equal(obsolete.src, 'replacement');
});
