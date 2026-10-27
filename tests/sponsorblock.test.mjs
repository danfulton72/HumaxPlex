import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, normalizeSegments, skipTarget, verifyConnection } from '../web/js/player/sponsorblock.js';

test('extracts bracketed YouTube IDs from Tube Archivist filenames', () => {
  assert.equal(youtubeId('/video/Example [dQw4w9WgXcQ].mkv'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('Other video.mkv'), null);
  assert.equal(youtubeId('not-a-video-id.mkv'), null);
});

test('extracts bare-ID stems from Tube Archivist filenames', () => {
  // TA's default naming: <channel>/<youtube_id>.<ext>, no brackets or title.
  assert.equal(youtubeId('/Media/tubearchivist/UCFki_upOKkji8k-ufUEX3cA/SHGauVE2ud4.mp4'), 'SHGauVE2ud4');
  assert.equal(youtubeId('qjYsukKQNvU.mkv'), 'qjYsukKQNvU');
  // A longer stem that merely contains an 11-char run must NOT match.
  assert.equal(youtubeId('dQw4w9WgXcQextra.mp4'), null);
  // Bracketed form still wins when both are present.
  assert.equal(youtubeId('My Video [dQw4w9WgXcQ].mp4'), 'dQw4w9WgXcQ');
});

test('normalizes segments from the video-detail response shape', () => {
  // The live TA endpoint /api/video/<id>/ returns the whole video object with a
  // top-level `sponsorblock` field (no `.data` wrapper, no `/sponsor/` route).
  const payload = {
    youtube_id: '3Qf4ABaXmFM',
    title: 'My 1st Bushcraft Camping Trip in Alaska',
    sponsorblock: {
      is_enabled: true, last_refresh: 1779397623, has_unlocked: true,
      segments: [
        { actionType: 'none', videoDuration: 1452.061, segment: [1446.243, 1452.061], votes: 1, category: 'interaction', locked: 0 },
        { actionType: 'skip', videoDuration: 1452.061, segment: [0.5, 12.2], votes: 9, category: 'sponsor', locked: 0 },
      ],
    },
  };
  assert.deepEqual(normalizeSegments(payload, ['sponsor', 'selfpromo', 'interaction']), [
    { start: 500, end: 12200 }, { start: 1446243, end: 1452061 },
  ]);
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

// verifyConnection probes a bogus video id: 404 means auth passed (token good),
// 403 means the token was rejected, a network failure means unreachable.
test('verifyConnection: 404 (past auth) counts as connected', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 404, json: async () => ({ error: 'video not found' }) });
  try {
    assert.deepEqual(await verifyConnection('http://ta:8000/', 'tok'), { ok: true });
  } finally { globalThis.fetch = real; }
});

test('verifyConnection: 403 reports an invalid token', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 403, json: async () => ({ detail: 'Invalid token.' }) });
  try {
    const r = await verifyConnection('http://ta:8000', 'bad');
    assert.equal(r.ok, false);
    assert.match(r.reason, /rejected the API token/);
  } finally { globalThis.fetch = real; }
});

test('verifyConnection: network failure reports unreachable', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  try {
    const r = await verifyConnection('http://unreachable:8000', 'tok');
    assert.equal(r.ok, false);
    assert.match(r.reason, /Could not reach Tube Archivist/);
  } finally { globalThis.fetch = real; }
});

test('verifyConnection: server 5xx is reported as a server error', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 502, json: async () => ({}) });
  try {
    const r = await verifyConnection('http://ta:8000', 'tok');
    assert.equal(r.ok, false);
    assert.match(r.reason, /server error/i);
  } finally { globalThis.fetch = real; }
});
