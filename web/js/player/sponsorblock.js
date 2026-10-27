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
      String(item.librarySectionID) !== c.sectionId) {
    console.log('[SB] skip lookup: enabled=' + c.enabled + ' server=' + c.server + ' token=' + (!!c.token) + ' sectionId=' + c.sectionId + ' itemSection=' + (item && item.librarySectionID));
    return [];
  }
  const id = youtubeId(part && part.file);
  if (!id) { console.log('[SB] no youtube id in file=' + (part && part.file)); return []; }
  const key = c.server + '/' + id + '/' + c.categories.join(',');
  if (cache.has(key)) { console.log('[SB] cache hit ' + id); return cache.get(key); }
  console.log('[SB] fetching ' + c.server + '/api/video/' + id + '/');
  const result = normalizeSegments(await nativeRequest(c.server + '/api/video/' + id + '/', c.token), c.categories);
  cache.set(key, result);
  console.log('[SB] got ' + result.length + ' skippable segment(s) for ' + id);
  return result;
}
