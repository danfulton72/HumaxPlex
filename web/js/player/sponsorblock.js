// Tube Archivist SponsorBlock metadata; opt-in for a single Plex library.
import * as store from '../util/store.js';

export const CATEGORIES = [
  ['sponsor', 'Sponsored segments'], ['selfpromo', 'Self-promotion'],
  ['interaction', 'Like/subscribe reminders'], ['intro', 'Intros'],
  ['outro', 'Outros'], ['filler', 'Filler content'],
];
const DEFAULT = ['sponsor', 'selfpromo', 'interaction'];
const cache = new Map();

export function config() {
  const c = store.get('sponsorBlock', {}) || {};
  return {
    enabled: !!c.enabled, server: String(c.server || '').replace(/\/+$/, ''),
    token: String(c.token || ''), sectionId: String(c.sectionId || ''),
    categories: Array.isArray(c.categories) ? c.categories : DEFAULT,
  };
}

export function saveConfig(c) {
  store.set('sponsorBlock', c);
  cache.clear();
}

// Extract the YouTube ID from a Plex file path. Tube Archivist names files two
// ways: a bare ID stem (`SHGauVE2ud4.mp4`) or a bracketed ID in the title
// (`My Video [dQw4w9WgXcQ].mkv`). Accept both, but only when the ID is the whole
// filename stem (or the bracketed form) so we never grab an arbitrary 11-char
// run out of a longer title.
export function youtubeId(filename) {
  const name = String(filename || '').split('/').pop();
  let m = name.match(/\[([a-zA-Z0-9_-]{11})\](?!\w)/);
  if (m && /\.[^.]+$/.test(name)) return m[1];
  m = name.match(/^([a-zA-Z0-9_-]{11})\.[^.]+$/);
  return m ? m[1] : null;
}

export function normalizeSegments(payload, categories) {
  const data = payload && (payload.data || payload);
  const sponsor = data && (data.sponsorblock || data);
  const segments = Array.isArray(sponsor) ? sponsor : sponsor && sponsor.segments;
  if (!Array.isArray(segments) || sponsor.is_enabled === false) return [];
  return segments.filter(s => categories.includes(s.category) && s.actionType !== 'mute')
    .map(s => {
      const bounds = s.segment || [s.startTime, s.endTime];
      return { start: Number(bounds[0]) * 1000, end: Number(bounds[1]) * 1000 };
    })
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

export function skipTarget(segments, position, duration, ignored = new Set()) {
  const i = segments.findIndex((s, n) => !ignored.has(n) && position >= s.start && position < s.end - 300);
  if (i < 0) return null;
  let end = segments[i].end;
  for (let j = i + 1; j < segments.length && segments[j].start <= end; j++) end = Math.max(end, segments[j].end);
  return { index: i, target: duration > 0 ? Math.min(end, duration - 500) : end };
}

// Probe whether the configured Tube Archivist server is reachable AND the
// token is valid, without needing a real video ID. We request a deliberately
// bogus video id: with a valid token TA gets past auth and returns 404
// ("video not found"); with a bad/missing token it returns 403 ("Invalid
// token"). A network failure / timeout means the server is unreachable.
export async function verifyConnection(server, token) {
  const url = String(server || '').replace(/\/+$/, '') + '/api/video/AAAAAAAAAAA/';
  let status, body;
  if (typeof EasyPlexVideo !== 'undefined' && EasyPlexVideo.fetchSponsor) {
    // Native bridge resolves only on 200; anything else surfaces as a reject
    // carrying the HTTP status in the message.
    try {
      await nativeRequest(url, token);
      return { ok: true };
    } catch (e) {
      const m = String(e && e.message || '');
      const code = m.match(/HTTP (\d{3})/);
      if (!code) return { ok: false, reason: 'Could not reach Tube Archivist (' + (m || 'timeout') + ')' };
      const s = Number(code[1]);
      if (s === 0) return { ok: false, reason: 'Could not reach Tube Archivist (no response)' };
      return interpret(s, m);
    }
  }
  try {
    const r = await fetch(url, { headers: { Authorization: 'Token ' + token } });
    status = r.status;
    try { body = await r.json(); } catch (_) { body = {}; }
  } catch (e) {
    return { ok: false, reason: 'Could not reach Tube Archivist at ' + url.split('/api')[0] };
  }
  return interpret(status, body && body.detail);
}

function interpret(status, detail) {
  if (status === 404) return { ok: true };                 // got past auth -> token is good
  if (status === 401 || status === 403)
    return { ok: false, reason: 'Tube Archivist rejected the API token' + (detail ? ' (' + detail + ')' : '') };
  if (status >= 500) return { ok: false, reason: 'Tube Archivist server error (HTTP ' + status + ')' };
  return { ok: false, reason: 'Unexpected response from Tube Archivist (HTTP ' + status + ')' };
}

function nativeRequest(url, token) {
  if (typeof EasyPlexVideo === 'undefined' || !EasyPlexVideo.fetchSponsor) {
    return fetch(url, { headers: { Authorization: 'Token ' + token } })
      .then(r => { if (!r.ok) throw new Error('Tube Archivist HTTP ' + r.status); return r.json(); });
  }
  return new Promise((resolve, reject) => {
    const id = 'sb' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { delete window.__easyplexSponsorCallbacks[id]; reject(new Error('Tube Archivist timeout')); }, 12000);
    window.__easyplexSponsorCallbacks ||= {};
    window.__easyplexSponsorCallbacks[id] = (status, response) => {
      clearTimeout(timer);
      delete window.__easyplexSponsorCallbacks[id];
      if (status !== 200) { reject(new Error('Tube Archivist HTTP ' + status)); return; }
      try { resolve(JSON.parse(response)); } catch (e) { reject(e); }
    };
    EasyPlexVideo.fetchSponsor(url, token, id);
  });
}

export async function segmentsFor(item, part) {
  const c = config();
  if (!c.enabled || !c.server || !c.token || !c.sectionId ||
      String(item.librarySectionID) !== c.sectionId) return [];
  const id = youtubeId(part && part.file);
  if (!id) return [];
  const key = c.server + '/' + id + '/' + c.categories.join(',');
  if (cache.has(key)) return cache.get(key);
  const result = normalizeSegments(await nativeRequest(c.server + '/api/video/' + id + '/', c.token), c.categories);
  cache.set(key, result);
  return result;
}
