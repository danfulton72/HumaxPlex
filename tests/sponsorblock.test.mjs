import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, normalizeSegments, skipTarget } from '../web/js/player/sponsorblock.js';

test('extracts bracketed YouTube IDs from Tube Archivist filenames', () => {
  assert.equal(youtubeId('/video/Example [dQw4w9WgXcQ].mkv'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('Other video.mkv'), null);
  assert.equal(youtubeId('not-a-video-id.mkv'), null);
});

test('filters and sorts SponsorBlock segments using milliseconds', () => {
  const payload = { data: { sponsorblock: { is_enabled: true, segments: [
    { category: 'interaction', segment: [20, 30] },
    { category: 'sponsor', segment: [4.5, 9.25] },
    { category: 'intro', segment: [1, 4] },
    { category: 'sponsor', segment: [40, 50], actionType: 'mute' },
    { category: 'sponsor', segment: [10, 1] },
  ] } } };
  assert.deepEqual(normalizeSegments(payload, ['sponsor', 'interaction']), [
    { start: 4500, end: 9250 }, { start: 20000, end: 30000 },
  ]);
});

test('skipTarget skips once, merges overlaps, and respects duration', () => {
  const segments = [{ start: 1000, end: 4000 }, { start: 3500, end: 6000 }];
  assert.deepEqual(skipTarget(segments, 1500, 10000), { index: 0, target: 6000 });
  assert.equal(skipTarget(segments, 1500, 10000, new Set([0])), null);
  assert.deepEqual(skipTarget(segments, 4000, 5200), { index: 1, target: 4700 });
  assert.equal(skipTarget(segments, 7000, 10000), null);
});
