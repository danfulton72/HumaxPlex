// Pure Live TV helpers: no DOM, no network, no state. Everything here is
// covered by tests/unit.test.mjs.

export const SLOT = 30 * 60000;
export const HOUR = 3600000;
export const DAY = 86400000;
export const GUIDE_TTL = 15 * 60000;
export const SPAN = 2 * HOUR;          // guide shows two hours at a time
export const ROWS = 7;                 // rows visible at once (guide, recordings)

// ---- time -------------------------------------------------------------------

// Local calendar date. toISOString() would give the UTC date, which is the
// previous day between 00:00 and 01:00 during BST.
export function localDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Plex sends epoch seconds, epoch milliseconds or ISO strings depending on field.
export function toMillis(raw) {
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw))) {
    const n = Number(raw);
    return n < 1e11 ? n * 1000 : n;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return NaN; // date only, no time
  return new Date(raw).getTime();
}

export function airingBounds(m) {
  const media = m?.Media?.[0] || {};
  const start = toMillis(media.beginsAt ?? m?.beginsAt ?? media.startTime ?? m?.startTime ??
    m?.airingStart ?? m?.start);
  let end = toMillis(media.endsAt ?? m?.endsAt);
  if (!Number.isFinite(end) && Number.isFinite(start)) end = start + (Number(m?.duration) || SLOT);
  return { start, end };
}

export function airingIn(shows, when) {
  for (const m of shows) {
    const b = airingBounds(m);
    if (Number.isFinite(b.start) && b.start <= when && b.end > when) return m;
  }
  return null;
}

export function hhmm(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('en-GB',
    { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
}

export function dayLabel(t, now = Date.now()) {
  const d = localDate(t);
  if (d === localDate(now)) return 'Today';
  if (d === localDate(now + DAY)) return 'Tomorrow';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function mins(ms) {
  const n = Math.max(0, Math.round(ms / 60000));
  return n >= 60 ? Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + (n % 60) + ' min' : '') : n + ' min';
}

// ---- programmes -------------------------------------------------------------

export function titleOf(m) { return m?.title || m?.grandparentTitle || 'Programme'; }
export function rangeOf(m) { const b = airingBounds(m); return hhmm(b.start) + '–' + hhmm(b.end); }
export function mainTitle(m) { return m?.grandparentTitle || m?.title || 'Programme'; }
export function subTitle(m) {
  if (!m?.grandparentTitle || !m.title || m.title === m.grandparentTitle) return '';
  const se = m.parentIndex != null && m.index != null ? 'S' + m.parentIndex + ' E' + m.index + ' · ' : '';
  return se + m.title;
}

// ---- channels ---------------------------------------------------------------

// Display name for a channel: drop a leading channel number and everything up
// to and including the first "|" ("14365 UK| SKY CINEMA" -> "SKY CINEMA").
export function channelLabel(name) {
  const raw = String(name || '').trim();
  let s = raw.replace(/^\d+\s+/, '');
  const bar = s.indexOf('|');
  if (bar !== -1) s = s.slice(bar + 1);
  return s.trim() || raw;
}

// The "XX|" prefix Dispatcharr names carry ("14365 UK| SKY" -> "UK").
export function channelGroup(row) {
  const name = String(row?.name || row?.channel || '').trim().replace(/^\d+\s+/, '');
  const bar = name.indexOf('|');
  return bar > 0 ? name.slice(0, bar).trim() : '';
}

// Stable identity for favourites and "last channel".
export function chanKey(row) {
  return String(row?.channelId || row?.gridKey || row?.channelVcn || row?.name || '');
}

export function sortByChannelNumber(rows) {
  const num = r => {
    const n = parseFloat(r.channelVcn);
    return Number.isFinite(n) ? n : Infinity;
  };
  return rows.slice().sort((a, b) => num(a) - num(b) ||
    String(a.name || '').localeCompare(String(b.name || '')));
}

export function findByNumber(rows, n) {
  if (!n) return null;
  return rows.find(r => String(r.channelVcn || '') === n) ||
    rows.find(r => Number(r.channelVcn) === Number(n)) || null;
}

const EPG_ID = /tv\.plex\.providers\.epg\.(?:cloud|xmltv|custom):\d+/;

// Guide provider paths ("/tv.plex.providers.epg.xmltv:7") from /media/providers
// and the DVR list. The guide source need not share the DVR's id.
export function epgProviderPaths(providersReply, dvrs) {
  const prefixes = new Set();
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const field of ['identifier', 'id', 'key']) {
      const match = String(obj[field] || '').match(EPG_ID);
      if (match) prefixes.add('/' + match[0]);
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Feature' || key === 'Directory' || key === 'MediaProvider' || key === 'Pivot') {
        for (const child of Array.isArray(value) ? value : []) walk(child);
      }
    }
  };
  if (providersReply) (providersReply.MediaProvider || providersReply.Directory || []).forEach(walk);
  for (const dvr of dvrs || []) {
    for (const field of ['key', 'identifier', 'providerIdentifier']) {
      const match = String(dvr[field] || '').match(EPG_ID);
      if (match) prefixes.add('/' + match[0]);
    }
  }
  return [...prefixes];
}

// Channel rows from the providers' watch-now listings, joined to the DVR
// lineup for guide keys. replies[i] is { status, value } for urls[i].
export function channelRowsFrom(urls, replies, dvrId) {
  const lineup = new Map();
  replies.forEach((reply, i) => {
    if (reply.status !== 'fulfilled' || !urls[i].includes('/lineups/dvr/channels')) return;
    for (const c of reply.value.Channel || []) {
      const key = c.gridKey || c.id;
      if (key == null) continue;
      for (const k of [c.id, c.gridKey, c.channelIdentifier, c.channelVcn]) {
        if (k != null) lineup.set(String(k), String(key));
      }
    }
  });
  const uniq = new Set();
  const found = [];
  replies.forEach((reply, ri) => {
    if (!urls[ri].includes('/watchnow/all') || reply.status !== 'fulfilled') return;
    const mc = reply.value;
    for (const m of mc.Metadata || mc.Channel || mc.Directory || []) {
      if (!(m.Media?.length || m.onAir || m.type === 'episode' || m.type === 'movie')) continue;
      const channel = m.Media?.[0] || m.Channel?.[0] || m.channel || {};
      const number = channel.channelVcn || channel.channelNumber || m.channelVcn || '';
      const label = channel.channelTitle || m.channelTitle || channel.channelCallSign || m.channelCallSign || channel.title || channel.name || 'Channel';
      const title = m.title || m.grandparentTitle || 'On air';
      const key = channel.channelIdentifier || m.key || m.ratingKey;
      const unique = number + ':' + key;
      if (uniq.has(unique)) continue;
      uniq.add(unique);
      found.push({
        channel: (number ? number + '  ' : '') + label, name: label,
        title, subtitle: m.summary || m.grandparentTitle || title, item: m,
        gridKey: channel.gridKey || lineup.get(String(channel.channelIdentifier || channel.channelVcn || '')),
        channelId: channel.channelIdentifier, channelVcn: channel.channelVcn || number, dvrId,
      });
    }
  });
  return sortByChannelNumber(found);
}

// ---- recordings schedule ------------------------------------------------------

// /media/subscriptions/scheduled returns MediaContainer.MediaGrabOperation[],
// one operation per recording with a status: "scheduled" (upcoming),
// "inprogress" (recording now) or "complete" (finished, already in the
// library). Active ones carry a nested Metadata with title/type/channelTitle.
export function scheduledEntries(mc) {
  const ops = (mc?.MediaGrabOperation || []).filter(o => o && (o.status === 'scheduled' || o.status === 'inprogress'));
  return ops.map(o => {
    const md = o.Metadata || {};
    const media = (md.Media || [])[0] || {};
    const { start, end } = airingBounds(md);
    const rawChannel = media.channelTitle || md.channelTitle || '';
    return {
      channel: rawChannel ? channelLabel(rawChannel) : '',
      title: (o.status === 'inprogress' ? '● REC  ' : '') + (mainTitle(md) || 'Recording'),
      episode: subTitle(md),
      summary: md.summary || '',
      start, end, md, item: o,
    };
  }).sort((x, y) => (Number.isFinite(x.start) ? x.start : Infinity) - (Number.isFinite(y.start) ? y.start : Infinity));
}

// Every guid in the schedule, so the guide can mark programmes and series.
export function scheduledGuidSet(mc) {
  const found = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
    if (typeof o.guid === 'string') found.add(o.guid);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(mc, 0);
  return found;
}

// ---- recording requests -------------------------------------------------------

export function templateOptions(t) {
  return t?.SubscriptionTemplate?.[0]?.MediaSubscription || t?.MediaSubscription || [];
}

// Which kind of library the option records into: Plex says so in the option's
// parameters (params[libraryType] 1 = movies, 2 = TV); else go by its type.
export function libraryKind(opt) {
  const m = /(?:^|&)params(?:%5B|\[)libraryType(?:%5D|\])=(\d+)/i.exec(String(opt?.parameters || ''));
  if (m) return m[1] === '1' ? 'movie' : 'show';
  return Number(opt?.type) === 1 ? 'movie' : 'show';
}

// Libraries of the right kind, one entry per folder.
export function librariesFor(opt, sections) {
  const kind = libraryKind(opt);
  const out = [];
  for (const sec of sections.filter(x => x.type === kind)) {
    const locs = (sec.Location || []).filter(l => l && l.id != null);
    if (!locs.length) out.push({ sectionId: String(sec.key), title: sec.title, locId: '', path: '' });
    for (const loc of locs) out.push({ sectionId: String(sec.key), title: sec.title, locId: String(loc.id), path: loc.path || '' });
  }
  return out;
}

// Index of the library to preselect: the template's own, else the one last
// used for this kind ("sectionId:locId"), else the first.
export function defaultLibrary(opt, libs, saved) {
  const byTemplate = libs.findIndex(l => String(opt.targetLibrarySectionID || '') === l.sectionId &&
    (!opt.targetSectionLocationID || String(opt.targetSectionLocationID) === l.locId));
  if (byTemplate >= 0) return byTemplate;
  const bySaved = libs.findIndex(l => l.sectionId + ':' + l.locId === saved);
  return bySaved >= 0 ? bySaved : 0;
}

export function prefValue(st) {
  const v = st.value !== undefined && st.value !== null ? st.value : st.default;
  if (v === undefined || v === null) return '';
  return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
}

// Query for POST /media/subscriptions, built the way Plex Web builds it: every
// preference from the option's Setting list (blank ones too), the library and
// folder, includeGrabs, then the option's own parameter string passed through
// untouched, plus the type if that string lacks one.
export function subscriptionQuery(opt, lib, m, withLocation) {
  const parts = [];
  const add = (k, v) => parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : String(v)));
  for (const st of opt.Setting || []) if (st && st.id) add('prefs[' + st.id + ']', prefValue(st));
  add('targetLibrarySectionID', lib.sectionId);
  add('targetSectionLocationID', withLocation ? lib.locId : '');
  add('includeGrabs', 1);
  const given = String(opt.parameters || '').replace(/^[?&]+/, '');
  if (given) parts.push(given);
  else {
    if (m.guid) add('hints[guid]', m.guid);
    if (m.ratingKey) add('hints[ratingKey]', m.ratingKey);
    add('hints[title]', titleOf(m));
  }
  if (!/(?:^|&)type=/.test(given) && opt.type != null) add('type', opt.type);
  return parts.join('&');
}

// "a%5Bb%5D=c&d=e" -> ["a[b] = c", "d = e"] for diagnostics.
export function decodeQuery(q) {
  return String(q).split('&').filter(Boolean).map(kv => {
    const i = kv.indexOf('=');
    const dec = x => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
    return i < 0 ? dec(kv) : dec(kv.slice(0, i)) + ' = ' + dec(kv.slice(i + 1)).slice(0, 90);
  });
}

export function recordAttemptText(attempts) {
  if (!attempts.length) return 'none yet';
  const out = attempts.map((a, i) => 'Attempt ' + (i + 1) + ': ' + a.result);
  out.push('', 'Sent (attempt ' + attempts.length + '):');
  return out.concat(attempts[attempts.length - 1].query).join('\n');
}

export function templateText(t) {
  if (!t) return 'none yet — press Record on a programme';
  const out = [];
  templateOptions(t).forEach((o, i) => {
    out.push('Option ' + (i + 1) + ': ' + o.title + ' · type ' + o.type + (o.airingsType ? ' · ' + o.airingsType : '') +
      (o.selected ? ' · selected' : '') + ' · library ' + (o.targetLibrarySectionID ?? '-') + '/' + (o.targetSectionLocationID ?? '-'));
    decodeQuery(String(o.parameters || '')).forEach(x => out.push('  ' + x));
    const settings = (o.Setting || []).map(st => st.id + ' = ' + prefValue(st) + (st.type ? ' (' + st.type + ')' : ''));
    if (settings.length) out.push('  prefs: ' + settings.join(', '));
  });
  return out.join('\n');
}

// Error text from a failed Plex call: the HTML <title> if any, else the body.
export function plexError(status, body) {
  const title = /<title>([^<]*)<\/title>/i.exec(body || '');
  const text = (title ? title[1] : String(body || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const err = new Error('Plex HTTP ' + status + (text ? ' ' + text.slice(0, 140) : ''));
  err.status = status;
  return err;
}

// ---- diagnostics --------------------------------------------------------------

const ALLOWED = /^(type|title|grandparentTitle|channelTitle|channelCallSign|channelName|channelIdentifier|channelVcn|channelNumber|gridKey|guideKey|ratingKey|key|id|identifier|source|providerIdentifier|epgSource|beginsAt|endsAt|startTime|duration|onAir|Media|Channel|Metadata|Airing|Directory|Dvr|DVR|MediaProvider|Feature|totalSize|size|status|protocol|decision|mediaType|partIndex|index|SubscriptionTemplate|MediaSubscription|targetLibrarySectionID|targetSectionLocationID|parameters|airingsType|selected|Setting|librarySectionTitle|locationPath|value|default|guid)$/;

// A trimmed copy of a Plex reply for display: known fields only, short
// strings, three items per list, tokens redacted.
export function safeObject(value, depth = 0) {
  if (depth > 3) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 3).map(v => safeObject(v, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    Object.keys(value).forEach(k => { if (ALLOWED.test(k)) output[k] = safeObject(value[k], depth + 1); });
    return output;
  }
  return typeof value === 'string' ? value.slice(0, 100).replace(/(X-Plex-Token|token|authorization)=[^& ]+/gi, '[redacted]') : value;
}

// The structure of a reply as "path = value" lines, for the tuning report
// (Plex clients disagree on where live-session ids are nested).
export function liveShape(value, path = 'root', depth = 0, out = []) {
  if (depth > 7 || out.length > 80 || value == null) return out;
  if (Array.isArray(value)) {
    out.push(path + ': Array(' + value.length + ')');
    value.slice(0, 2).forEach((v, i) => liveShape(v, path + '[' + i + ']', depth + 1, out));
  } else if (typeof value === 'object') {
    Object.keys(value).slice(0, 20).forEach(k => {
      if (/token|auth|secret|password|cookie/i.test(k)) return;
      const v = value[k], where = path + '.' + k;
      if (v && typeof v === 'object') liveShape(v, where, depth + 1, out);
      else if (/uuid|key|id|session|status|type/i.test(k)) out.push(where + ' = ' + String(v).slice(0, 90));
      else out.push(where + ' : ' + typeof v);
    });
  }
  return out;
}
