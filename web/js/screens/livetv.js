// EasyPlex Live TV & DVR screen.
// Copied verbatim into the web app by patches/apply.py (js/screens/livetv.js).
//
// Channels and EPG come from the Plex DVR; playback goes straight to the
// Dispatcharr HDHomeRun stream when Plex reports a /hdhr tuner device,
// otherwise through Plex's own live-session transcode.
//
// Remote keys
//   Guide grid : arrows move · OK/Play watch · Record/Red record · FF/RW ±1 day
//                Blue recordings · Yellow channel day guide · Green diagnostics
//                Hold OK (or Menu) for an options list, for remotes without those keys
//   Watching   : Up/CH+ next channel · Down/CH− previous · Left/Last previous
//                channel · OK/Info now & next · Right audio/subtitles · Back guide
import { h, setText } from '../util/dom.js';
import { session } from '../session.js';
import { useAmbience } from '../ui/backdrop.js';
import { identity } from '../plex/client.js';
import { showOptions, closeOptions } from '../ui/options.js';

// Reuse EPG results when the screen is reopened during the same app session.
// Keys are "<local YYYY-MM-DD>:<gridKey>", values {time, shows}.
const sharedGuideCache = new Map();

const SLOT = 30 * 60000;
const HOUR = 3600000;
const DAY = 86400000;
const GUIDE_TTL = 15 * 60000;
const SPAN = 2 * HOUR;          // guide shows two hours at a time
const ROWS = 7;                 // channels visible at once

// ---- time helpers (pure; exported for tests) --------------------------------

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

// Display name for a channel: drop a leading channel number and everything up
// to and including the first "|" ("14365 UK| SKY CINEMA" -> "SKY CINEMA").
export function channelLabel(name) {
  const raw = String(name || '').trim();
  let s = raw.replace(/^\d+\s+/, '');
  const bar = s.indexOf('|');
  if (bar !== -1) s = s.slice(bar + 1);
  return s.trim() || raw;
}

export function sortByChannelNumber(rows) {
  const num = r => {
    const n = parseFloat(r.channelVcn);
    return Number.isFinite(n) ? n : Infinity;
  };
  return rows.slice().sort((a, b) => num(a) - num(b) ||
    String(a.name || '').localeCompare(String(b.name || '')));
}

function hhmm(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('en-GB',
    { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
}
function titleOf(m) { return m?.title || m?.grandparentTitle || 'Programme'; }
function rangeOf(m) { const b = airingBounds(m); return hhmm(b.start) + '–' + hhmm(b.end); }

// ---- screen -----------------------------------------------------------------

export function LiveTvScreen({ autoplay = false } = {}) {
  const el = h('div', 'screen settings ep-live');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Live TV & DVR';
  const info = h('div', 'ep-live-status', el);
  const list = h('div', 'ep-live-list', el);
  const details = h('div', 'ep-live-detail', el);
  const server = session.server;
  const guideCache = sharedGuideCache;

  let alive = true;
  let view = 'loading';           // loading | grid | guide | schedule | debug | tune-debug | playing
  let returnView = 'grid';        // where debug overlays go back to
  let entries = [], index = 0;    // list views (day guide, schedule)
  let providers = [], dvrs = [], dayOffset = 0, guideChannel = null;
  let debugResponses = [], diagnostic = null, debugPage = 0;
  // Guide: gridIndex = selected channel, gridTop = first visible row,
  // focusTime = the cursor's moment in time, windowStart = left edge of the timeline.
  let channelRows = [], gridIndex = 0, gridTop = 0, focusTime = 0, windowStart = 0;
  let scheduledGuids = new Set(), gridEl = null, g = {}, sayTimer = 0, clockTimer = 0;
  // Playback / zapping
  let playingRow = null, lastRow = null, zapTarget = null, zapTimer = 0, tuneSeq = 0;
  let plexPlaybackSession = '';

  // ---- guide data -----------------------------------------------------------

  function cached(date, row) { return guideCache.get(date + ':' + row.gridKey); }
  function airingAt(row, when) {
    if (!row?.gridKey) return null;
    for (const date of [localDate(when), localDate(when - DAY), localDate(when + DAY)]) {
      const hit = airingIn(cached(date, row)?.shows || [], when);
      if (hit) return hit;
    }
    return null;
  }

  async function fetchDay(row, date) {
    const cacheKey = date + ':' + row.gridKey;
    const hit = guideCache.get(cacheKey);
    if (hit && Date.now() - hit.time < GUIDE_TTL) return hit.shows;
    let anyOk = false;
    for (const prefix of providers) {
      try {
        const data = await server.get(prefix + '/grid', { channelGridKey: row.gridKey, date });
        anyOk = true;
        const shows = data.Metadata || data.Airing || data.Media || [];
        if (shows.length) {
          guideCache.set(cacheKey, { time: Date.now(), shows });
          return shows;
        }
      } catch (e) { /* try next provider */ }
    }
    // Remember genuinely empty days so they are not re-requested on every key press.
    if (anyOk) guideCache.set(cacheKey, { time: Date.now(), shows: [] });
    return [];
  }

  const epgPending = new Set();
  let epgRenderQueued = false, fillToken = 0;
  function queueGridRender() {
    if (epgRenderQueued) return;
    epgRenderQueued = true;
    setTimeout(() => { epgRenderQueued = false; if (alive && view === 'grid') renderGrid(); }, 350);
  }
  // Fetch every local date the visible window touches (plus a margin before it,
  // in case the server files late-night programmes under the UTC date), visible
  // channels first. A newer call supersedes older workers so priority follows
  // the cursor.
  async function fillGrid() {
    const token = ++fillToken;
    const start = windowStart, end = windowStart + SPAN;
    const dates = [...new Set([localDate(start - 2 * HOUR), localDate(start), localDate(end)])];
    const rows = channelRows;
    const ordered = rows.slice(gridTop, gridTop + ROWS)
      .concat(rows.slice(0, gridTop), rows.slice(gridTop + ROWS));
    const jobs = [];
    for (const row of ordered) if (row?.gridKey) for (const date of dates) jobs.push({ row, date });
    let next = 0;
    async function worker() {
      while (next < jobs.length && alive && token === fillToken) {
        const { row, date } = jobs[next++];
        const key = date + ':' + row.gridKey;
        const hit = guideCache.get(key);
        if ((hit && Date.now() - hit.time < GUIDE_TTL) || epgPending.has(key)) continue;
        epgPending.add(key);
        try { await fetchDay(row, date); queueGridRender(); }
        finally { epgPending.delete(key); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, () => worker()));
  }

  // ---- grid -----------------------------------------------------------------

  const slotFloor = t => Math.floor(t / SLOT) * SLOT;
  const minFocus = () => slotFloor(Date.now());
  const maxFocus = () => Date.now() + 7 * DAY;
  function say(text) {
    setText(details, text);
    clearTimeout(sayTimer);
    if ((view === 'grid' || view === 'schedule') && text) sayTimer = setTimeout(() => { if (details._text === String(text)) setText(details, ''); }, 7000);
  }
  function isScheduled(m) {
    return !!m && ((m.guid && scheduledGuids.has(m.guid)) || (m.grandparentGuid && scheduledGuids.has(m.grandparentGuid)));
  }
  // Best effort: collect every guid in the DVR schedule so the guide can mark
  // programmes (and series) that will be recorded.
  async function loadScheduled() {
    try {
      const mc = await server.get('/media/subscriptions/scheduled');
      const found = new Set();
      const walk = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 8) return;
        if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
        if (typeof o.guid === 'string') found.add(o.guid);
        for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
      };
      walk(mc, 0);
      scheduledGuids = found;
      if (alive && view === 'grid') renderGrid();
    } catch (e) { /* no markers */ }
  }
  // Programmes overlapping [a, b) on a channel, from whichever cached days hold them.
  function showsBetween(row, a, b) {
    if (!row?.gridKey) return [];
    const seen = new Set(), out = [];
    for (const date of new Set([localDate(a - DAY), localDate(a), localDate(b)])) {
      for (const m of cached(date, row)?.shows || []) {
        const bd = airingBounds(m);
        if (!Number.isFinite(bd.start) || bd.end <= a || bd.start >= b) continue;
        const k = bd.start + ':' + titleOf(m);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ m, start: bd.start, end: bd.end });
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }
  function selectedGrid() {
    const row = channelRows[gridIndex];
    if (!row) return null;
    return { row, programme: airingAt(row, focusTime) };
  }
  function dayLabel(t) {
    const d = localDate(t);
    if (d === localDate(Date.now())) return 'Today';
    if (d === localDate(Date.now() + DAY)) return 'Tomorrow';
    return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function mainTitle(m) { return m?.grandparentTitle || m?.title || 'Programme'; }
  function subTitle(m) {
    if (!m?.grandparentTitle || !m.title || m.title === m.grandparentTitle) return '';
    const se = m.parentIndex != null && m.index != null ? 'S' + m.parentIndex + ' E' + m.index + ' · ' : '';
    return se + m.title;
  }
  function mins(ms) {
    const n = Math.max(0, Math.round(ms / 60000));
    return n >= 60 ? Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + (n % 60) + ' min' : '') : n + ' min';
  }

  function buildGrid() {
    gridEl = h('div', 'hx-grid', el);
    const top = h('div', 'hx-top', gridEl);
    g.head = h('div', 'hx-title', top);
    g.head.textContent = 'Live TV';
    g.clock = h('div', 'hx-clock', top);
    const panel = h('section', 'hx-info', gridEl);
    const main = h('div', 'hx-info-main', panel);
    g.ch = h('div', 'hx-info-ch', main);
    g.title = h('h2', 'hx-info-title', main);
    g.sub = h('div', 'hx-info-sub', main);
    g.meta = h('div', 'hx-info-meta', main);
    const side = h('div', 'hx-info-side', panel);
    g.summary = h('p', 'hx-info-summary', side);
    g.chips = h('div', 'hx-chips', side);
    const times = h('div', 'hx-times', gridEl);
    g.day = h('div', 'hx-day', times);
    g.hours = h('div', 'hx-hours', times);
    g.rows = h('div', 'hx-rows', gridEl);
    const keys = h('footer', 'hx-keys', gridEl);
    const key = (label, kind, value) => {
      const item = h('span', '', keys);
      const k = h('span', kind, item);
      if (kind === 'hx-dot') k.style.background = value; else k.textContent = value;
      item.appendChild(document.createTextNode(label));
    };
    key('Watch', 'hx-key', 'OK');
    key('Record', 'hx-dot', '#E5383B');
    key('Channels', 'hx-glyph', '▲▼');
    key('Programmes', 'hx-glyph', '◀▶');
    key('Day', 'hx-glyph', 'FF RW');
    key('Number', 'hx-glyph', '0–9');
    key('More', 'hx-key', 'Hold OK');
    h('span', 'hx-sp', keys);
    key('Diagnostics', 'hx-dot', '#2FA84F');
    key('Day guide', 'hx-dot', '#F2C230');
    key('Recordings', 'hx-dot', '#3A7BE0');
  }

  function renderInfo(row, p) {
    const now = Date.now();
    g.ch.textContent = (isFavourite(row) ? '★ ' : '') + channelLabel(row.name || row.channel) +
      (row.channelVcn ? '  ·  ' + row.channelVcn : '');
    g.meta.textContent = '';
    g.chips.textContent = '';
    if (!p) {
      const onNow = focusTime <= now + 60000 && row.title;
      g.title.textContent = onNow ? row.title : 'No programme information';
      g.sub.textContent = '';
      g.summary.textContent = onNow ? (row.subtitle && row.subtitle !== row.title ? row.subtitle : '') :
        (row.gridKey ? (cached(localDate(focusTime), row) ? 'The guide has nothing listed for this time.' : 'Loading guide…') :
          'This channel has no guide data in Plex.');
      return;
    }
    const { start, end } = airingBounds(p);
    g.title.textContent = mainTitle(p);
    g.sub.textContent = subTitle(p);
    const when = (localDate(start) === localDate(now) ? '' : dayLabel(start) + ' ') + hhmm(start) + ' – ' + hhmm(end);
    h('span', '', g.meta).textContent = when;
    if (start <= now && end > now) {
      const bar = h('div', 'hx-bar', g.meta);
      h('i', '', bar).style.width = Math.round((now - start) / (end - start) * 100) + '%';
      h('span', '', g.meta).textContent = mins(end - now) + ' left';
    } else if (start > now) {
      h('span', '', g.meta).textContent = (start - now < DAY ? 'Starts in ' + mins(start - now) : mins(end - start));
    }
    g.summary.textContent = p.summary || '';
    const chips = [];
    if (isScheduled(p)) chips.push(['● Recording', 'rec']);
    for (const genre of (p.Genre || []).slice(0, 3)) if (genre?.tag) chips.push([genre.tag, '']);
    if (p.year) chips.push([String(p.year), '']);
    chips.push([mins(end - start), '']);
    for (const [text, cls] of chips) h('span', cls, g.chips).textContent = text;
  }

  function renderGrid() {
    if (!gridEl) buildGrid();
    el.classList.remove('ep-sched-active');
    el.classList.add('ep-grid-active');
    const now = Date.now();
    g.clock.textContent = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ';
    h('b', '', g.clock).textContent = hhmm(now);
    // Keep the selected row inside the visible window: no measuring, no scrolling.
    if (gridIndex < gridTop) gridTop = gridIndex;
    if (gridIndex >= gridTop + ROWS) gridTop = gridIndex - ROWS + 1;
    gridTop = Math.max(0, Math.min(gridTop, Math.max(0, channelRows.length - ROWS)));
    const a = windowStart, b = windowStart + SPAN;
    const pct = t => ((t - a) / SPAN * 100).toFixed(3) + '%';
    g.head.textContent = 'Live TV  ·  ' + filterLabel(effectiveFilter());
    g.day.textContent = dayLabel(a).toUpperCase();
    g.hours.textContent = '';
    for (let k = 0; k < 4; k++) {
      const span = h('span', '', g.hours);
      span.style.left = (k * 25) + '%';
      span.textContent = hhmm(a + k * SLOT);
    }
    g.rows.textContent = '';
    const sel = selectedGrid();
    channelRows.slice(gridTop, gridTop + ROWS).forEach((row, i) => {
      const ri = gridTop + i;
      const line = h('div', 'hx-row' + (ri === gridIndex ? ' sel' : ''), g.rows);
      const ch = h('div', 'hx-ch', line);
      h('span', 'hx-name', ch).textContent = (effectiveFilter() !== 'fav' && isFavourite(row) ? '★ ' : '') +
        channelLabel(row.name || row.channel);
      const track = h('div', 'hx-track', line);
      const shows = showsBetween(row, a, b);
      const block = (start, end, cls, title, sub, rec) => {
        if (cls === 'empty' && ri === gridIndex && !sel?.programme && focusTime >= start && focusTime < end) {
          cls = 'focus';
          title = title || 'No guide data';
        }
        const l = Math.max(start, a), r = Math.min(end, b);
        const node = h('div', 'hx-prog ' + cls + ((r - l) < 15 * 60000 ? ' narrow' : ''), track);
        node.style.left = pct(l);
        node.style.width = 'calc(' + pct(r) + ' - ' + pct(l) + ' - 6px)';
        h('div', 'hx-pt' + (rec ? ' rec' : ''), node).textContent = (start < a ? '‹ ' : '') + title;
        if (sub) h('div', 'hx-pm', node).textContent = sub;
      };
      if (!shows.length) {
        const label = a <= now && row.title ? row.title :
          (!row.gridKey || cached(localDate(a), row) ? 'No guide data' : 'Loading…');
        const focusHere = ri === gridIndex;
        block(a, b, (focusHere ? 'focus' : 'empty'), label, '', false);
        return;
      }
      let cursor = a;
      for (const s of shows) {
        if (s.end <= cursor) continue;           // overlapping listing: keep the earlier one
        const st = s.start < cursor && cursor > a ? cursor : s.start;
        if (st >= b) continue;
        if (st > cursor) block(cursor, st, 'empty', '', '', false);
        const focused = ri === gridIndex && sel?.programme === s.m;
        const onNow = s.start <= now && s.end > now;
        block(st, s.end, focused ? 'focus' : onNow ? 'on' : '', titleOf(s.m),
          hhmm(s.start) + ' – ' + hhmm(s.end), isScheduled(s.m));
        cursor = Math.max(cursor, s.end);
      }
      if (cursor < b) block(cursor, b, 'empty', '', '', false);
    });
    if (now >= a && now < b) {
      const line = h('div', 'hx-now', g.rows);
      line.style.left = 'calc(272px + (100% - 272px) * ' + ((now - a) / SPAN).toFixed(4) + ')';
    }
    const row = channelRows[gridIndex];
    if (row) renderInfo(row, sel?.programme);
  }

  // ---- guide navigation: by programme, not by fixed time slot -------------------

  function revealFocus() {
    if (focusTime < windowStart) windowStart = Math.max(minFocus(), slotFloor(focusTime));
    if (focusTime >= windowStart + SPAN) windowStart = slotFloor(focusTime);
  }
  function moveRight() {
    const p = airingAt(channelRows[gridIndex], focusTime);
    const next = p ? airingBounds(p).end : slotFloor(focusTime) + SLOT;
    focusTime = Math.min(maxFocus(), next);
    revealFocus();
  }
  function moveLeft() {
    const row = channelRows[gridIndex];
    const p = airingAt(row, focusTime);
    const cur = p ? airingBounds(p).start : slotFloor(focusTime);
    if (cur <= Date.now()) {               // already on what is on now
      focusTime = Math.max(focusTime, Date.now());
      windowStart = minFocus();
      return;
    }
    const prev = airingAt(row, cur - 1);
    focusTime = Math.max(Date.now(), prev ? airingBounds(prev).start : slotFloor(cur - 1));
    revealFocus();
  }
  function moveDays(n) {
    focusTime = Math.max(Date.now(), Math.min(maxFocus(), focusTime + n * DAY));
    windowStart = Math.max(minFocus(), slotFloor(focusTime));
  }

  function showGrid() {
    if (diagnostic) diagnostic.style.display = 'none';
    if (!channelRows.length) { view = 'loading'; load(); return; }
    // Never leave the guide pointing at the past after it has been open a while.
    if (windowStart < minFocus()) windowStart = minFocus();
    if (focusTime < Date.now()) focusTime = Date.now();
    view = 'grid';
    setText(details, '');
    renderGrid();
    fillGrid();
  }
  function activateGrid() {
    allRows = entries.slice();
    applyFilter(null);
    // Open on the channel last watched, if it is in the current list.
    const last = prefGet(LAST_KEY);
    const lastIdx = last ? channelRows.findIndex(r => chanKey(r) === last) : -1;
    if (lastIdx >= 0) { gridIndex = lastIdx; gridTop = Math.max(0, gridIndex - 3); }
    focusTime = Date.now();
    windowStart = minFocus();
    showGrid();
    loadScheduled();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      if (!alive || view !== 'grid') return;
      if (windowStart < minFocus()) windowStart = minFocus();
      if (focusTime < Date.now()) focusTime = Date.now();
      renderGrid();
    }, 30000);
    if (autoplay) {
      autoplay = false;
      if (lastIdx >= 0) tuneRow(channelRows[gridIndex]);
    }
  }

  // ---- favourites, channel groups, number entry -------------------------------
  // Favourites and the chosen list are remembered on this box. Groups come from
  // the "XX|" prefix Dispatcharr channel names carry (shown only if there are
  // two or more). Number entry searches every channel, not just the list shown.
  const FAV_KEY = 'easyplexLiveFavourites', FILTER_KEY = 'easyplexLiveFilter', LAST_KEY = 'easyplexLiveLastChannel';
  let allRows = [];
  let favourites = new Set();
  try { favourites = new Set(JSON.parse(prefGet(FAV_KEY) || '[]')); } catch (e) { favourites = new Set(); }
  let filter = prefGet(FILTER_KEY) || 'auto';
  function chanKey(row) { return String(row?.channelId || row?.gridKey || row?.channelVcn || row?.name || ''); }
  function isFavourite(row) { return favourites.has(chanKey(row)); }
  function channelGroup(row) {
    const name = String(row?.name || row?.channel || '').trim().replace(/^\d+\s+/, '');
    const bar = name.indexOf('|');
    return bar > 0 ? name.slice(0, bar).trim() : '';
  }
  function groups() {
    const out = [];
    for (const r of allRows) { const gname = channelGroup(r); if (gname && !out.includes(gname)) out.push(gname); }
    return out.length > 1 ? out : [];
  }
  function effectiveFilter() {
    if (filter === 'auto') return favourites.size ? 'fav' : 'all';
    if (filter === 'fav' && !favourites.size) return 'all';
    if (filter.startsWith('group:') && !groups().includes(filter.slice(6))) return 'all';
    return filter;
  }
  function filterLabel(f) {
    if (f === 'fav') return 'Favourites';
    if (f.startsWith('group:')) return f.slice(6) + ' channels';
    return 'All channels';
  }
  function applyFilter(keepRow) {
    const f = effectiveFilter();
    let rows = allRows;
    if (f === 'fav') rows = allRows.filter(isFavourite);
    else if (f.startsWith('group:')) rows = allRows.filter(r => channelGroup(r) === f.slice(6));
    channelRows = rows.length ? rows : allRows;
    const keep = keepRow ? channelRows.indexOf(keepRow) : -1;
    gridIndex = keep >= 0 ? keep : Math.min(gridIndex, Math.max(0, channelRows.length - 1));
    gridTop = Math.max(0, gridIndex - 3);
  }
  function setFilter(f) {
    filter = f;
    prefSet(FILTER_KEY, f);
    applyFilter(channelRows[gridIndex]);
    if (view === 'grid') { renderGrid(); fillGrid(); }
    say('Showing ' + filterLabel(effectiveFilter()).toLowerCase());
  }
  function toggleFavourite(row) {
    if (!row) return;
    const k = chanKey(row);
    const adding = !favourites.has(k);
    // Keep showing the current list; the default ("auto") switches to
    // favourites the next time Live TV opens.
    if (filter === 'auto') filter = effectiveFilter();
    if (adding) favourites.add(k); else favourites.delete(k);
    prefSet(FAV_KEY, JSON.stringify([...favourites]));
    const name = channelLabel(row.name || row.channel);
    if (view === 'playing') banner(row, adding ? '★ Added to favourites' : 'Removed from favourites');
    else say(adding ? '★ ' + name + ' added to favourites' : name + ' removed from favourites');
    // Removing the last favourite while viewing favourites falls back to all.
    applyFilter(view === 'playing' ? playingRow : channelRows[gridIndex]);
    if (view === 'grid') { renderGrid(); fillGrid(); }
  }
  function openFilterMenu() {
    const f = effectiveFilter();
    showOptions({
      eyebrow: 'CHANNELS', title: 'Show channels',
      items: [
        { label: favourites.size ? 'Favourites  (' + favourites.size + ')' : 'Favourites  (none yet)', checked: f === 'fav',
          run: () => favourites.size ? setFilter('fav') : say('Hold OK on a channel and choose “Add to favourites”') },
        { label: 'All channels  (' + allRows.length + ')', checked: f === 'all', run: () => setFilter('all') },
        ...groups().map(gname => ({ label: gname + '  (' + allRows.filter(r => channelGroup(r) === gname).length + ')',
          checked: f === 'group:' + gname, run: () => setFilter('group:' + gname) })),
      ],
    });
  }

  let digits = '', digitTimer = 0, digitEl = null;
  function findByNumber(n) {
    if (!n) return null;
    return allRows.find(r => String(r.channelVcn || '') === n) ||
      allRows.find(r => Number(r.channelVcn) === Number(n)) || null;
  }
  function showDigits() {
    const row = findByNumber(digits);
    if (view === 'playing') {
      const v = native();
      if (row) banner(row, 'Channel ' + digits);
      else if (v && v.setLiveBanner) v.setLiveBanner('Channel ' + digits + ' …', -1);
      return;
    }
    if (!digitEl) digitEl = h('div', 'hx-digits', el);
    digitEl.textContent = '';
    h('b', '', digitEl).textContent = digits;
    h('span', '', digitEl).textContent = row ? channelLabel(row.name || row.channel) : '…';
    digitEl.style.display = '';
  }
  function hideDigits() { if (digitEl) digitEl.style.display = 'none'; }
  function numberKey(d) {
    digits = (digits + d).slice(-6);
    clearTimeout(digitTimer);
    showDigits();
    digitTimer = setTimeout(commitDigits, 1800);
  }
  function cancelDigits() { clearTimeout(digitTimer); digits = ''; hideDigits(); if (view === 'playing' && playingRow) banner(playingRow); }
  function commitDigits() {
    clearTimeout(digitTimer);
    const n = digits;
    digits = '';
    hideDigits();
    const row = findByNumber(n);
    if (!row) {
      if (view === 'playing' && playingRow) banner(playingRow, 'No channel ' + n);
      else say('No channel ' + n);
      return;
    }
    if (!channelRows.includes(row)) { filter = 'all'; prefSet(FILTER_KEY, 'all'); applyFilter(row); say('Showing all channels'); }
    if (view === 'playing') { clearTimeout(zapTimer); zapTarget = null; tuneRow(row); }
    else if (view === 'grid') { gridIndex = channelRows.indexOf(row); renderGrid(); fillGrid(); }
  }


  // ---- diagnostics ----------------------------------------------------------

  const allowed = /^(type|title|grandparentTitle|channelTitle|channelCallSign|channelName|channelIdentifier|channelVcn|channelNumber|gridKey|guideKey|ratingKey|key|id|identifier|source|providerIdentifier|epgSource|beginsAt|endsAt|startTime|duration|onAir|Media|Channel|Metadata|Airing|Directory|Dvr|DVR|MediaProvider|Feature|totalSize|size|status|protocol|decision|mediaType|partIndex|index|SubscriptionTemplate|MediaSubscription|targetLibrarySectionID|targetSectionLocationID|parameters|airingsType|selected|Setting|librarySectionTitle|locationPath|value|default|guid)$/;
  function safeObject(value, depth = 0) {
    if (depth > 3) return '[nested]';
    if (Array.isArray(value)) return value.slice(0, 3).map(v => safeObject(v, depth + 1));
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach(k => { if (allowed.test(k)) output[k] = safeObject(value[k], depth + 1); });
      return output;
    }
    return typeof value === 'string' ? value.slice(0, 100).replace(/(X-Plex-Token|token|authorization)=[^& ]+/gi, '[redacted]') : value;
  }
  function overlay(title) {
    if (!diagnostic) {
      diagnostic = h('div', 'ep-live-debug', el);
      h('div', 'ep-debug-title', diagnostic);
      h('pre', 'ep-debug-content', diagnostic);
    }
    diagnostic.querySelector('.ep-debug-title').textContent = title;
    diagnostic.style.display = '';
    return diagnostic.querySelector('pre');
  }
  function closeOverlay() {
    if (diagnostic) diagnostic.style.display = 'none';
    if (returnView === 'guide' && guideChannel) { view = 'guide'; render(); }
    else if (!channelRows.length) view = 'empty';
    else showGrid();
  }
  function showDebug() {
    if (view !== 'debug') returnView = view === 'guide' ? 'guide' : 'grid';
    view = 'debug';
    const pre = overlay('Live TV diagnostics — Up/Down: page · Back closes');
    const selected = returnView === 'grid' ? channelRows[gridIndex] : entries[index];
    const sel = returnView === 'grid' ? selectedGrid() : null;
    const cards = [
      ['Selected programme', selected ? { fields: Object.keys(selected.item || {}), mediaFields: Object.keys(selected.item?.Media?.[0] || {}), channelFields: Object.keys(selected.item?.Channel?.[0] || {}), values: safeObject(selected.item) } : 'none'],
      ['Selected channel', selected ? safeObject({ channelTitle: selected.channel, gridKey: selected.gridKey, channelIdentifier: selected.channelId, channelVcn: selected.channelVcn }) : 'none'],
      ['Guide cache', sel ? {
        cachedDays: [...guideCache.keys()].filter(k => k.endsWith(':' + sel.row.gridKey)).map(k => k.split(':')[0] + ' (' + guideCache.get(k).shows.length + ')'),
        programmeAtCursor: sel.programme ? safeObject(sel.programme) : 'none',
        totalCachedDays: guideCache.size,
      } : 'n/a'],
      ['Last recording request', recordAttemptText()],
      ['Recording template', templateText(lastTemplate)],
      ['Plex DVRs', dvrs.map(d => safeObject(d))],
      ['EPG providers', providers],
      ...debugResponses.map((r, i) => ['Endpoint ' + (i + 1) + ' ' + r.name, r.data]),
    ];
    debugPage = Math.max(0, Math.min(debugPage, cards.length - 1));
    pre.textContent = 'PAGE ' + (debugPage + 1) + ' / ' + cards.length + '\n' + cards[debugPage][0] + '\n\n' +
      (typeof cards[debugPage][1] === 'string' ? cards[debugPage][1] :
        JSON.stringify(cards[debugPage][1], null, 2)).slice(0, 4000);
  }
  let tuneReport = [];
  function showTuneReport(lines, title) {
    tuneReport = lines; debugPage = 0;
    returnView = 'grid';
    view = 'tune-debug';
    renderTuneReport(title || 'Plex tuning diagnostics — Down: next · Back: close');
  }
  function renderTuneReport(title) {
    overlay(title || 'Plex tuning diagnostics — Down: next · Back: close').textContent =
      'TUNE REPORT · page ' + (debugPage + 1) + '\n' + tuneReport.slice(debugPage * 25, (debugPage + 1) * 25).join('\n');
  }

  // ---- list views (day guide, schedule) ---------------------------------------

  function focus() {
    Array.from(list.children).forEach((node, i) => node.classList.toggle('focus', i === index));
    const e = entries[index];
    if (e) setText(details, e.subtitle);
    const node = list.children[index];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    el.classList.remove('ep-grid-active', 'ep-sched-active');
    list.innerHTML = '';
    entries.forEach(e => {
      const row = h('div', 'ep-live-row', list);
      h('span', 'ep-live-channel', row).textContent = e.channel;
      h('span', 'ep-live-show', row).textContent = e.title;
    });
    focus();
  }

  // ---- loading channels -------------------------------------------------------

  async function load() {
    el.classList.remove('ep-grid-active');
    list.innerHTML = '';
    setText(info, 'Checking Plex DVR and programme guide…');
    try {
      const d = await server.get('/livetv/dvrs');
      dvrs = d.Dvr || d.DVR || d.Directory || [];
      if (!dvrs.length) {
        setText(info, 'No Plex DVR found. Configure a supported tuner in Plex Media Server → Live TV & DVR.');
        view = 'empty';
        return;
      }
      const prefixes = new Set();
      const epgId = /tv\.plex\.providers\.epg\.(?:cloud|xmltv|custom):\d+/;
      try {
        const reply = await server.get('/media/providers');
        const all = reply.MediaProvider || reply.Directory || [];
        const walk = obj => {
          if (!obj || typeof obj !== 'object') return;
          for (const field of ['identifier', 'id', 'key']) {
            const match = String(obj[field] || '').match(epgId);
            if (match) prefixes.add('/' + match[0]);
          }
          for (const [key, value] of Object.entries(obj)) {
            if (key === 'Feature' || key === 'Directory' || key === 'MediaProvider' || key === 'Pivot') {
              for (const child of Array.isArray(value) ? value : []) walk(child);
            }
          }
        };
        all.forEach(walk);
      } catch (e) { console.warn('Plex provider discovery:', e.message); }
      for (const dvr of dvrs) {
        for (const field of ['key', 'identifier', 'providerIdentifier']) {
          const match = String(dvr[field] || '').match(epgId);
          if (match) prefixes.add('/' + match[0]);
        }
      }
      providers = [...prefixes];
      const urls = [];
      for (const prefix of prefixes) {
        urls.push(prefix + '/watchnow/all');
        urls.push(prefix + '/lineups/dvr/channels');
      }
      const replies = await Promise.allSettled(urls.map(url => server.get(url)));
      debugResponses = replies.map((r, i) => ({ name: urls[i], data: r.status === 'fulfilled' ? { keys: Object.keys(r.value), sample: safeObject((r.value.Metadata || r.value.Channel || r.value.Directory || [])[0] || r.value) } : { error: String(r.reason?.message || 'request failed').slice(0, 120) } }));
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
      const dvrId = String(dvrs[0]?.key || dvrs[0]?.id || '').replace(/^.*:/, '');
      replies.forEach((reply, ri) => {
        if (!urls[ri].includes('/watchnow/all') || reply.status !== 'fulfilled') return;
        const mc = reply.value;
        const programs = mc.Metadata || mc.Channel || mc.Directory || [];
        programs.forEach(m => {
          if (!(m.Media?.length || m.onAir || m.type === 'episode' || m.type === 'movie')) return;
          const channel = m.Media?.[0] || m.Channel?.[0] || m.channel || {};
          const number = channel.channelVcn || channel.channelNumber || m.channelVcn || '';
          const label = channel.channelTitle || m.channelTitle || channel.channelCallSign || m.channelCallSign || channel.title || channel.name || 'Channel';
          const title = m.title || m.grandparentTitle || 'On air';
          const key = channel.channelIdentifier || m.key || m.ratingKey;
          const unique = number + ':' + key;
          if (uniq.has(unique)) return;
          uniq.add(unique);
          found.push({
            channel: (number ? number + '  ' : '') + label, name: label,
            title, subtitle: m.summary || m.grandparentTitle || title, item: m,
            gridKey: channel.gridKey || lineup.get(String(channel.channelIdentifier || channel.channelVcn || '')),
            channelId: channel.channelIdentifier, channelVcn: channel.channelVcn || number, dvrId,
          });
        });
      });
      if (!alive) return;
      if (!found.length) {
        setText(info, 'DVR found. EPG providers: ' + prefixes.size +
          ' · Successful guide requests: ' + replies.filter(r => r.status === 'fulfilled').length +
          '/' + replies.length + '. Channel listings unavailable; press Green for diagnostics.');
        view = 'empty';
        return;
      }
      entries = sortByChannelNumber(found);
      activateGrid();
    } catch (e) {
      setText(info, 'Live TV unavailable: ' + e.message);
      view = 'empty';
    }
  }

  // ---- per-channel day guide ---------------------------------------------------

  function openChannelGuide() {
    const row = channelRows[gridIndex];
    if (!row) return;
    if (!row.gridKey || !providers.length) {
      say('Channel lineup did not provide a matching guide key. Press Green for diagnostics.');
      return;
    }
    guideChannel = row;
    openGuide(0);
  }
  async function openGuide(delta) {
    view = 'guide';
    dayOffset = Math.max(0, Math.min(7, delta));
    const date = localDate(Date.now() + dayOffset * DAY);
    el.classList.remove('ep-grid-active');
    setText(info, 'Guide: ' + guideChannel.channel + ' · ' + date +
      ' · Left/Right: day · OK: record · Play: watch · Back: guide grid');
    setText(details, 'Loading channel schedule…');
    entries = []; render();
    try {
      const shows = (await fetchDay(guideChannel, date)).slice()
        .sort((a, b) => airingBounds(a).start - airingBounds(b).start);
      if (view !== 'guide') return;
      entries = shows.map(m => ({
        channel: hhmm(airingBounds(m).start),
        title: titleOf(m),
        subtitle: m.summary || m.title || '',
        item: m, gridKey: guideChannel.gridKey, channelId: guideChannel.channelId,
        channelVcn: guideChannel.channelVcn,
      }));
      // Start on the programme that is on now when viewing today.
      const nowIdx = dayOffset === 0 ? entries.findIndex(e => airingBounds(e.item).end > Date.now()) : 0;
      index = Math.max(0, nowIdx);
      render();
      if (!entries.length) setText(details, 'No scheduled programmes received for this date.');
    } catch (e) { setText(details, 'Guide request failed: ' + e.message); }
  }

  // ---- DVR schedule & recording -----------------------------------------------

  // Recordings: same layout as the guide — info panel for the selected
  // recording above a list of upcoming recordings in start-time order.
  let schedEl = null, sg = {}, schedTop = 0, schedState = 'loading', schedError = '';
  function buildSchedule() {
    schedEl = h('div', 'hx-sched', el);
    const top = h('div', 'hx-top', schedEl);
    h('div', 'hx-title', top).textContent = 'Recordings';
    sg.clock = h('div', 'hx-clock', top);
    const panel = h('section', 'hx-info', schedEl);
    const main = h('div', 'hx-info-main', panel);
    sg.ch = h('div', 'hx-info-ch', main);
    sg.title = h('h2', 'hx-info-title', main);
    sg.sub = h('div', 'hx-info-sub', main);
    sg.meta = h('div', 'hx-info-meta', main);
    const side = h('div', 'hx-info-side', panel);
    sg.summary = h('p', 'hx-info-summary', side);
    sg.chips = h('div', 'hx-chips', side);
    const head = h('div', 'hx-times', schedEl);
    h('div', 'hx-day', head).textContent = 'WHEN';
    sg.count = h('div', 'hx-day hx-sched-count', head);
    sg.rows = h('div', 'hx-rows', schedEl);
    const keys = h('footer', 'hx-keys', schedEl);
    const key = (label, kind, value) => {
      const item = h('span', '', keys);
      const k = h('span', kind, item);
      if (kind === 'hx-dot') k.style.background = value; else k.textContent = value;
      item.appendChild(document.createTextNode(label));
    };
    key('Choose', 'hx-glyph', '▲▼');
    key('Page', 'hx-glyph', 'CH+ CH−');
    key('Cancel recording', 'hx-key', 'OK');
    h('span', 'hx-sp', keys);
    key('Back to guide', 'hx-key', 'Back');
  }
  function renderSchedule() {
    if (!schedEl) buildSchedule();
    el.classList.remove('ep-grid-active');
    el.classList.add('ep-sched-active');
    const now = Date.now();
    sg.clock.textContent = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ';
    h('b', '', sg.clock).textContent = hhmm(now);
    sg.count.textContent = schedState === 'ready' && entries.length ?
      entries.length + (entries.length === 1 ? ' RECORDING SCHEDULED' : ' RECORDINGS SCHEDULED') : '';
    if (index < schedTop) schedTop = index;
    if (index >= schedTop + ROWS) schedTop = index - ROWS + 1;
    schedTop = Math.max(0, Math.min(schedTop, Math.max(0, entries.length - ROWS)));
    sg.rows.textContent = '';
    entries.slice(schedTop, schedTop + ROWS).forEach((e, i) => {
      const sel = schedTop + i === index;
      const line = h('div', 'hx-row' + (sel ? ' sel' : ''), sg.rows);
      const when = h('div', 'hx-ch hx-when', line);
      h('span', 'hx-when-day', when).textContent = Number.isFinite(e.start) ? dayLabel(e.start) : '';
      h('span', 'hx-when-time', when).textContent = Number.isFinite(e.start) ? hhmm(e.start) + ' – ' + hhmm(e.end) : '--:--';
      const block = h('div', 'hx-prog hx-sched-prog' + (sel ? ' focus' : e.start <= now ? ' on' : ''), line);
      h('div', 'hx-pt rec', block).textContent = e.title;
      h('div', 'hx-pm', block).textContent = [e.episode, e.channel].filter(Boolean).join('  ·  ');
    });
    const e = entries[index];
    sg.meta.textContent = ''; sg.chips.textContent = ''; sg.sub.textContent = '';
    if (!e) {
      sg.ch.textContent = '';
      sg.title.textContent = schedState === 'loading' ? 'Loading recordings…' :
        schedState === 'error' ? 'Unable to load recordings' : 'No scheduled recordings';
      sg.summary.textContent = schedState === 'error' ? schedError :
        schedState === 'loading' ? '' : 'Programmes you record from the guide appear here.';
      return;
    }
    sg.ch.textContent = '';
    h('b', '', sg.ch).textContent = '● ' + (e.start <= now ? 'RECORDING NOW' : 'SCHEDULED');
    sg.ch.appendChild(document.createTextNode(e.channel || ''));
    sg.title.textContent = e.title;
    sg.sub.textContent = e.episode;
    if (Number.isFinite(e.start)) {
      h('span', '', sg.meta).textContent = dayLabel(e.start) + ' ' + hhmm(e.start) + ' – ' + hhmm(e.end);
      if (e.start > now) h('span', '', sg.meta).textContent = 'Starts in ' + mins(e.start - now);
      else if (e.end > now) {
        const bar = h('div', 'hx-bar', sg.meta);
        h('i', '', bar).style.width = Math.round((now - e.start) / (e.end - e.start) * 100) + '%';
        h('span', '', sg.meta).textContent = mins(e.end - now) + ' left';
      }
    }
    sg.summary.textContent = e.summary || '';
    const md = e.md || {};
    for (const genre of (md.Genre || []).slice(0, 3)) if (genre?.tag) h('span', '', sg.chips).textContent = genre.tag;
    if (md.year) h('span', '', sg.chips).textContent = String(md.year);
    if (Number.isFinite(e.start) && e.end > e.start) h('span', '', sg.chips).textContent = mins(e.end - e.start);
  }
  async function showScheduled(keepIndex) {
    const wasIndex = index;
    view = 'schedule';
    entries = []; index = 0; schedTop = 0; schedState = 'loading';
    if (!keepIndex) setText(details, '');
    renderSchedule();
    try {
      const mc = await server.get('/media/subscriptions/scheduled');
      if (view !== 'schedule') return;
      // Plex returns MediaContainer.MediaGrabOperation[] — one op per recording,
      // with a status lifecycle: "scheduled" (upcoming), "inprogress" (recording now),
      // "complete" (finished). Show the active ones (upcoming + recording); hide the
      // finished ones here (they live in the recorded library). Each active op carries
      // a nested .Metadata with title/type/channelTitle.
      const ops = (mc.MediaGrabOperation || []).filter(o => o && (o.status === 'scheduled' || o.status === 'inprogress'));
      entries = ops.map(o => {
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
      schedState = 'ready';
      if (keepIndex) index = Math.max(0, Math.min(wasIndex, entries.length - 1));
      renderSchedule();
    } catch (e) {
      if (view !== 'schedule') return;
      schedState = 'error'; schedError = e.message;
      renderSchedule();
    }
  }
  // ---- cancelling a scheduled recording -------------------------------------
  // A one-off rule (single episode or film) is removed outright. For a series
  // rule the viewer chooses: skip just this airing (cancel the grab; Plex
  // forgets this if the server restarts) or delete the whole series rule.
  let cancel = null, cancelEl = null;
  async function dvrDelete(path) {
    const response = await fetch(server.url(path), {
      method: 'DELETE',
      headers: Object.assign({ Accept: 'application/json', 'X-Plex-Token': server.token }, identity()),
    });
    if (!response.ok) {
      const body = await response.text();
      const title = /<title>([^<]*)<\/title>/i.exec(body);
      const text = (title ? title[1] : body.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      throw new Error('Plex HTTP ' + response.status + (text ? ' ' + text.slice(0, 140) : ''));
    }
  }
  async function openCancel() {
    const e = entries[index];
    if (!e || cancel) return;
    const op = e.item || {};
    const subId = op.mediaSubscriptionID;
    const opId = op.id || (String(op.key || '').split('/').pop());
    cancel = { e, opId, subId, idx: 0, busy: false, status: '', items: [] };
    view = 'cancel';
    renderCancel();
    // Work out whether the rule covers more than this airing.
    let subType = null, subTitle = '';
    if (subId != null) {
      try {
        const mc = await server.get('/media/subscriptions/' + encodeURIComponent(subId));
        const sub = (mc.MediaSubscription || [])[0] || {};
        subType = sub.type != null ? Number(sub.type) : null;
        subTitle = sub.title || '';
      } catch (err) { /* fall back to counting airings */ }
    }
    if (!cancel || cancel.e !== e) return;
    const siblings = entries.filter(x => x.item?.mediaSubscriptionID != null && x.item.mediaSubscriptionID === subId).length;
    const series = subType != null ? (subType === 2 || subType === 3) : siblings > 1;
    const items = [];
    if (series) {
      if (opId) items.push(['Skip this episode only', 'grab']);
      if (subId != null) items.push(['Cancel series recording' + (siblings > 1 ? ' (' + siblings + ' scheduled)' : '') +
        (subTitle ? ' · ' + subTitle : ''), 'sub']);
    } else if (subId != null) items.push(['Cancel this recording', 'sub']);
    else if (opId) items.push(['Cancel this recording', 'grab']);
    items.push(['Keep recording', 'keep']);
    cancel.items = items;
    cancel.series = series;
    renderCancel();
  }
  function renderCancel() {
    if (!cancelEl) {
      cancelEl = h('div', 'hx-dialog', el);
      const box = h('div', 'hx-dlg hx-menu hx-cancel', cancelEl);
      h('div', 'hx-dlg-eyebrow', box).textContent = 'CANCEL RECORDING';
      cancelEl._title = h('h2', 'hx-dlg-title', box);
      cancelEl._sub = h('div', 'hx-dlg-sub', box);
      cancelEl._list = h('div', 'hx-menu-list', box);
      cancelEl._status = h('div', 'hx-dlg-status', box);
      h('div', 'hx-dlg-hint', box).textContent = '▲▼ choose · OK select · Back keep';
    }
    cancelEl.style.display = '';
    const e = cancel.e;
    cancelEl._title.textContent = e.title;
    cancelEl._sub.textContent = [e.episode, Number.isFinite(e.start) ? dayLabel(e.start) + ' ' + hhmm(e.start) + ' – ' + hhmm(e.end) : '',
      e.channel].filter(Boolean).join('  ·  ');
    cancelEl._list.textContent = '';
    if (!cancel.items.length) h('div', 'hx-dlg-sub', cancelEl._list).textContent = 'Checking recording rule…';
    cancel.items.forEach(([label], i) => {
      h('div', 'hx-btn hx-menu-item' + (i === cancel.idx ? ' focus' : ''), cancelEl._list).textContent = label;
    });
    cancelEl._status.textContent = cancel.status || '';
  }
  function closeCancel() {
    if (cancelEl) cancelEl.style.display = 'none';
    cancel = null;
    view = 'schedule';
    renderSchedule();
  }
  async function confirmCancel() {
    const choice = cancel.items[cancel.idx];
    if (!choice || cancel.busy) return;
    const [, what] = choice;
    if (what === 'keep') { closeCancel(); return; }
    const { e, opId, subId } = cancel;
    cancel.busy = true; cancel.status = 'Cancelling…'; renderCancel();
    try {
      if (what === 'grab') await dvrDelete('/media/grabbers/operations/' + encodeURIComponent(opId));
      else await dvrDelete('/media/subscriptions/' + encodeURIComponent(subId));
    } catch (err) {
      if (!cancel) return;
      cancel.busy = false; cancel.status = 'Not cancelled: ' + err.message; renderCancel();
      return;
    }
    const md = e.md || {};
    if (md.guid) scheduledGuids.delete(md.guid);
    if (what === 'sub' && md.grandparentGuid) scheduledGuids.delete(md.grandparentGuid);
    const wasSeries = cancel.series;
    closeCancel();
    say(what === 'grab' ? 'Skipped: ' + e.title + (e.episode ? ' · ' + e.episode : '') :
      'Cancelled: ' + e.title + (wasSeries ? ' (series)' : ''));
    loadScheduled();
    showScheduled(true);
  }
  function cancelKey(action) {
    if (!cancel) return true;
    switch (action) {
      case 'up': cancel.idx = Math.max(0, cancel.idx - 1); renderCancel(); return true;
      case 'down': cancel.idx = Math.min(Math.max(0, cancel.items.length - 1), cancel.idx + 1); renderCancel(); return true;
      case 'enter': case 'red': case 'record': confirmCancel(); return true;
      case 'back': case 'menu': if (!cancel.busy) closeCancel(); return true;
      default: return true;
    }
  }

  async function dvrPost(path, params = {}, rawQuery = '') {
    const url = server.url(path, params) + (rawQuery ? '&' + rawQuery : '');
    const response = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ Accept: 'application/json', 'X-Plex-Token': server.token }, identity()),
    });
    const body = await response.text();
    if (!response.ok) {
      const title = /<title>([^<]*)<\/title>/i.exec(body);
      const text = (title ? title[1] : body.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      const err = new Error('Plex HTTP ' + response.status + (text ? ' ' + text.slice(0, 140) : ''));
      err.status = response.status;
      throw err;
    }
    let data;
    try { data = JSON.parse(body); }
    catch (e) { throw new Error('Plex returned non-JSON response'); }
    const result = data.MediaContainer || data;
    if (typeof result.status === 'number' && result.status < 0)
      throw new Error('Plex status ' + result.status + ': ' + String(result.message || 'No error explanation').slice(0, 180));
    return result;
  }
  // Recording follows Plex's own model: the template lists what can be recorded
  // (this airing, all episodes, …) and each choice must be saved into a library
  // of the right kind (movie or TV) and one of its folders.
  let dlg = null, dlgEl = null, d = {}, lastTemplate = null;
  const REC_PREF = 'easyplexRecordLibrary:';
  function prefGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function prefSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  // Which kind of library the option records into: Plex says so in the option's
  // parameters (params[libraryType] 1 = movies, 2 = TV); else go by its type.
  function libraryKind(opt) {
    const m = /(?:^|&)params(?:%5B|\[)libraryType(?:%5D|\])=(\d+)/i.exec(String(opt?.parameters || ''));
    if (m) return m[1] === '1' ? 'movie' : 'show';
    return Number(opt?.type) === 1 ? 'movie' : 'show';
  }
  function librariesFor(opt, sections) {
    const kind = libraryKind(opt);
    const out = [];
    for (const sec of sections.filter(x => x.type === kind)) {
      const locs = (sec.Location || []).filter(l => l && l.id != null);
      if (!locs.length) out.push({ sectionId: String(sec.key), title: sec.title, locId: '', path: '' });
      for (const loc of locs) out.push({ sectionId: String(sec.key), title: sec.title, locId: String(loc.id), path: loc.path || '' });
    }
    return out;
  }
  function defaultLibrary(opt, libs) {
    const byTemplate = libs.findIndex(l => String(opt.targetLibrarySectionID || '') === l.sectionId &&
      (!opt.targetSectionLocationID || String(opt.targetSectionLocationID) === l.locId));
    if (byTemplate >= 0) return byTemplate;
    const saved = prefGet(REC_PREF + libraryKind(opt));
    const bySaved = libs.findIndex(l => l.sectionId + ':' + l.locId === saved);
    return bySaved >= 0 ? bySaved : 0;
  }
  function buildDialog() {
    dlgEl = h('div', 'hx-dialog', el);
    const box = h('div', 'hx-dlg', dlgEl);
    h('div', 'hx-dlg-eyebrow', box).textContent = 'RECORD';
    d.title = h('h2', 'hx-dlg-title', box);
    d.sub = h('div', 'hx-dlg-sub', box);
    const field = label => {
      const row = h('div', 'hx-field', box);
      h('div', 'hx-field-label', row).textContent = label;
      const mid = h('div', 'hx-field-mid', row);
      const value = h('div', 'hx-field-value', mid);
      const note = h('div', 'hx-field-note', mid);
      h('div', 'hx-field-arrows', row).textContent = '◀ ▶';
      return { row, value, note };
    };
    d.what = field('WHAT');
    d.where = field('SAVE TO');
    const buttons = h('div', 'hx-dlg-buttons', box);
    d.ok = h('div', 'hx-btn', buttons); d.ok.textContent = 'Record';
    d.cancel = h('div', 'hx-btn', buttons); d.cancel.textContent = 'Cancel';
    d.status = h('div', 'hx-dlg-status', box);
    h('div', 'hx-dlg-hint', box).textContent = '▲▼ choose · ◀▶ change · OK confirm · Back cancel';
  }
  function renderDialog() {
    if (!dlgEl) buildDialog();
    dlgEl.style.display = '';
    const opt = dlg.opts[dlg.optIdx];
    const lib = dlg.libs[dlg.libIdx];
    d.title.textContent = dlg.title;
    d.sub.textContent = dlg.when;
    d.what.value.textContent = opt ? (opt.title || 'Record') : '';
    d.what.note.textContent = dlg.opts.length > 1 ? (dlg.optIdx + 1) + ' of ' + dlg.opts.length + (opt?.airingsType ? ' · ' + opt.airingsType : '') :
      (opt?.airingsType || '');
    d.where.value.textContent = lib ? lib.title : 'No ' + (libraryKind(opt) === 'movie' ? 'movie' : 'TV') + ' library in Plex';
    d.where.note.textContent = lib ? (lib.path + (dlg.libs.length > 1 ? '  ·  ' + (dlg.libIdx + 1) + ' of ' + dlg.libs.length : '')) :
      'Add one in Plex Media Server, then try again';
    d.what.row.classList.toggle('focus', dlg.focus === 0);
    d.where.row.classList.toggle('focus', dlg.focus === 1);
    d.ok.classList.toggle('focus', dlg.focus === 2 && dlg.btn === 0);
    d.cancel.classList.toggle('focus', dlg.focus === 2 && dlg.btn === 1);
    d.ok.classList.toggle('disabled', !lib || dlg.busy);
    d.status.textContent = dlg.status || '';
  }
  function closeDialog() {
    if (dlgEl) dlgEl.style.display = 'none';
    if (dlg) view = dlg.returnTo;
    dlg = null;
  }
  async function recordSelected() {
    const selected = view === 'grid' ? selectedGrid() : null;
    const m = selected?.programme || (view === 'guide' ? entries[index]?.item : null);
    if (!m) { say('No programme selected for recording'); return; }
    if (!m.guid && !m.ratingKey) { say('Plex EPG lacks a programme GUID; cannot create a recording.'); return; }
    const { start, end } = airingBounds(m);
    const row = selected?.row || guideChannel;
    say('Getting recording options for ' + titleOf(m) + '…');
    try {
      const [template, sections] = await Promise.all([
        server.get('/media/subscriptions/template', m.guid ? { guid: m.guid } : { ratingKey: m.ratingKey }),
        server.sections(),
      ]);
      lastTemplate = template;
      const opts = template.SubscriptionTemplate?.[0]?.MediaSubscription || template.MediaSubscription || [];
      if (!opts.length) throw new Error('Plex returned no recording options for this programme');
      if (view !== 'grid' && view !== 'guide') return;
      const optIdx = Math.max(0, opts.findIndex(o => o.selected));
      const libs = librariesFor(opts[optIdx], sections);
      dlg = {
        m, opts, optIdx, sections, libs, libIdx: defaultLibrary(opts[optIdx], libs),
        focus: libs.length ? 2 : 1, btn: 0, busy: false, status: '', returnTo: view,
        title: mainTitle(m),
        when: [row ? channelLabel(row.name || row.channel) : '', (localDate(start) === localDate(Date.now()) ? '' : dayLabel(start) + ' ') +
          hhmm(start) + ' – ' + hhmm(end), subTitle(m)].filter(Boolean).join('  ·  '),
      };
      say('');
      view = 'record';
      renderDialog();
    } catch (err) { say('Recording not available: ' + err.message); }
  }
  function changeDialog(delta) {
    if (dlg.focus === 0 && dlg.opts.length > 1) {
      dlg.optIdx = (dlg.optIdx + delta + dlg.opts.length) % dlg.opts.length;
      const opt = dlg.opts[dlg.optIdx];
      const prev = dlg.libs[dlg.libIdx];
      dlg.libs = librariesFor(opt, dlg.sections);
      const same = prev ? dlg.libs.findIndex(l => l.sectionId === prev.sectionId && l.locId === prev.locId) : -1;
      dlg.libIdx = same >= 0 ? same : defaultLibrary(opt, dlg.libs);
    } else if (dlg.focus === 1 && dlg.libs.length > 1) {
      dlg.libIdx = (dlg.libIdx + delta + dlg.libs.length) % dlg.libs.length;
    } else if (dlg.focus === 2) {
      dlg.btn = dlg.btn ? 0 : 1;
    }
    dlg.status = '';
    renderDialog();
  }
  // Query for POST /media/subscriptions, built the way Plex Web builds it: every
  // preference from the option's Setting list (blank ones too), the library and
  // folder, includeGrabs, then the option's own parameter string passed through
  // untouched, plus the type if that string lacks one.
  function prefValue(st) {
    const v = st.value !== undefined && st.value !== null ? st.value : st.default;
    if (v === undefined || v === null) return '';
    return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  }
  function subscriptionQuery(opt, lib, m, withLocation) {
    const parts = [];
    const add = (k, v) => parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : String(v)));
    for (const st of opt.Setting || []) if (st && st.id) add('prefs[' + st.id + ']', prefValue(st));
    add('targetLibrarySectionID', lib.sectionId);
    add('targetSectionLocationID', withLocation ? lib.locId : '');
    add('includeGrabs', 1);
    let given = String(opt.parameters || '').replace(/^[?&]+/, '');
    if (given) parts.push(given);
    else {
      if (m.guid) add('hints[guid]', m.guid);
      if (m.ratingKey) add('hints[ratingKey]', m.ratingKey);
      add('hints[title]', titleOf(m));
    }
    if (!/(?:^|&)type=/.test(given) && opt.type != null) add('type', opt.type);
    return parts.join('&');
  }
  // What the last attempt sent and got back, for the diagnostics page.
  let lastRecordAttempts = [];
  function decodeQuery(q) {
    return q.split('&').filter(Boolean).map(kv => {
      const i = kv.indexOf('=');
      const dec = x => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
      return i < 0 ? dec(kv) : dec(kv.slice(0, i)) + ' = ' + dec(kv.slice(i + 1)).slice(0, 90);
    });
  }
  function recordAttemptText() {
    if (!lastRecordAttempts.length) return 'none yet';
    const out = lastRecordAttempts.map((a, i) => 'Attempt ' + (i + 1) + ': ' + a.result);
    out.push('', 'Sent (attempt ' + lastRecordAttempts.length + '):');
    return out.concat(lastRecordAttempts[lastRecordAttempts.length - 1].query).join('\n');
  }
  function templateText(t) {
    const opts = templateSummary(t);
    if (typeof opts === 'string') return opts;
    const out = [];
    opts.forEach((o, i) => {
      out.push('Option ' + (i + 1) + ': ' + o.title + ' · type ' + o.type + (o.airingsType ? ' · ' + o.airingsType : '') +
        (o.selected ? ' · selected' : '') + ' · library ' + (o.targetLibrarySectionID ?? '-') + '/' + (o.targetSectionLocationID ?? '-'));
      o.parameters.forEach(x => out.push('  ' + x));
      if (o.settings.length) out.push('  prefs: ' + o.settings.join(', '));
    });
    return out.join('\n');
  }
  function templateSummary(t) {
    if (!t) return 'none yet — press Record on a programme';
    const opts = t.SubscriptionTemplate?.[0]?.MediaSubscription || t.MediaSubscription || [];
    return opts.map(o => ({
      title: o.title, type: o.type, airingsType: o.airingsType, selected: o.selected,
      targetLibrarySectionID: o.targetLibrarySectionID, targetSectionLocationID: o.targetSectionLocationID,
      librarySectionTitle: o.librarySectionTitle, locationPath: o.locationPath,
      parameters: decodeQuery(String(o.parameters || '')),
      settings: (o.Setting || []).map(st => st.id + ' = ' + prefValue(st) + (st.type ? ' (' + st.type + ')' : '')),
    }));
  }
  async function submitRecording() {
    if (!dlg || dlg.busy) return;
    const opt = dlg.opts[dlg.optIdx], lib = dlg.libs[dlg.libIdx], m = dlg.m;
    if (!lib) { dlg.status = 'Choose a library to save into.'; renderDialog(); return; }
    dlg.busy = true; dlg.status = 'Scheduling…'; renderDialog();
    const r = await scheduleRecording(opt, lib, m);
    if (!r.ok) {
      if (!dlg) return;
      dlg.busy = false;
      dlg.status = 'Not scheduled: ' + r.error + ' · Green: details';
      renderDialog();
      return;
    }
    const what = opt.title || 'Recording';
    closeDialog();
    if (view === 'grid') renderGrid();
    say(what + ' scheduled: ' + mainTitle(m) + ' → ' + lib.title + ' · Blue shows recordings');
  }
  // Create the recording rule; shared by the record dialog and the
  // while-watching menu. Resolves { ok } or { ok: false, error }.
  async function scheduleRecording(opt, lib, m) {
    lastRecordAttempts = [];
    // Plex Web leaves the folder blank and lets Plex pick; try the chosen folder
    // first, then blank if Plex rejects the request.
    const tries = lib.locId ? [true, false] : [false];
    let lastErr = null;
    for (const withLocation of tries) {
      const q = subscriptionQuery(opt, lib, m, withLocation);
      try {
        await dvrPost('/media/subscriptions', {}, q);
        lastRecordAttempts.push({ result: 'OK', query: decodeQuery(q) });
        lastErr = null;
        break;
      } catch (err) {
        lastRecordAttempts.push({ result: err.message, query: decodeQuery(q) });
        lastErr = err;
        if (err.status !== 400) break;
      }
    }
    if (lastErr) return { ok: false, error: lastErr.message };
    prefSet(REC_PREF + libraryKind(opt), lib.sectionId + ':' + lib.locId);
    if (m.guid) scheduledGuids.add(m.guid);
    if (Number(opt.type) !== 4 && m.grandparentGuid) scheduledGuids.add(m.grandparentGuid);
    loadScheduled();
    return { ok: true };
  }
  // Options list (hold OK / Menu): everything the colour and record keys do.
  function openMenu() {
    const items = [];
    if (view === 'grid') {
      const row = channelRows[gridIndex];
      items.push({ label: 'Watch channel', run: () => tuneSelected() });
      if (selectedGrid()?.programme) items.push({ label: 'Record…', run: () => recordSelected() });
      if (row) items.push({ label: isFavourite(row) ? 'Remove from favourites' : 'Add to favourites', run: () => toggleFavourite(row) });
      items.push({ label: 'Channels: ' + filterLabel(effectiveFilter()) + '…', run: openFilterMenu });
      items.push({ label: 'Recordings', run: () => showScheduled() });
      items.push({ label: 'Channel day guide', run: () => openChannelGuide() });
      items.push({ label: 'Diagnostics', run: () => { debugPage = 0; showDebug(); } });
      showOptions({ title: row ? channelLabel(row.name || row.channel) : 'Live TV', items, focus: 0 });
    } else if (view === 'guide') {
      if (entries[index]?.item) items.push({ label: 'Record…', run: () => recordSelected() });
      items.push({ label: 'Watch channel', run: () => tuneSelected() });
      items.push({ label: 'Back to guide', run: () => showGrid() });
      items.push({ label: 'Diagnostics', run: () => { debugPage = 0; showDebug(); } });
      showOptions({ title: guideChannel ? channelLabel(guideChannel.name || guideChannel.channel) : 'Live TV', items, focus: 0 });
    }
  }

  // Hold OK while watching: record what's on, favourite the channel. The web
  // page is hidden behind the video, so the list is shown natively.
  async function openLiveMenu() {
    const v = native();
    const row = playingRow;
    if (!v || !v.showMenu || !row) return;
    const m = airingAt(row, Date.now());
    const choices = [];
    if (m && (m.guid || m.ratingKey)) {
      banner(row, 'Getting recording options…');
      try {
        const [template, sections] = await Promise.all([
          server.get('/media/subscriptions/template', m.guid ? { guid: m.guid } : { ratingKey: m.ratingKey }),
          server.sections(),
        ]);
        lastTemplate = template;
        const opts = template.SubscriptionTemplate?.[0]?.MediaSubscription || template.MediaSubscription || [];
        for (const o of opts) {
          const libs = librariesFor(o, sections);
          const lib = libs[defaultLibrary(o, libs)];
          if (lib) choices.push(['Record: ' + (o.title || 'this programme') + '  →  ' + lib.title, () => recordQuick(o, lib, m, row)]);
        }
      } catch (e) {
        choices.push(['Recording unavailable (' + String(e.message).slice(0, 60) + ')', () => banner(row)]);
      }
    }
    choices.push([isFavourite(row) ? 'Remove from favourites' : 'Add to favourites', () => toggleFavourite(row)]);
    choices.push(['Back to guide', () => stopWatching()]);
    if (view !== 'playing' || playingRow !== row) return;
    banner(row);
    window.__easyplexMenuChoice = i => { const c = choices[i]; if (c) c[1](); };
    v.showMenu(channelLabel(row.name || row.channel) + (m ? '  ·  ' + titleOf(m) : ''), JSON.stringify(choices.map(c => c[0])));
  }
  async function recordQuick(opt, lib, m, row) {
    banner(row, 'Scheduling ' + titleOf(m) + '…');
    const r = await scheduleRecording(opt, lib, m);
    if (playingRow === row) banner(row, r.ok ? '● ' + (opt.title || 'Recording') + ' scheduled  →  ' + lib.title : 'Not scheduled: ' + r.error);
  }

  function dialogKey(action) {
    switch (action) {
      case 'up': dlg.focus = Math.max(0, dlg.focus - 1); renderDialog(); return true;
      case 'down': dlg.focus = Math.min(2, dlg.focus + 1); renderDialog(); return true;
      case 'left': changeDialog(-1); return true;
      case 'right': changeDialog(1); return true;
      case 'enter':
        if (dlg.focus < 2) { dlg.focus++; renderDialog(); }
        else if (dlg.btn === 0) submitRecording();
        else closeDialog();
        return true;
      case 'record': case 'red': submitRecording(); return true;
      case 'green': {                       // show what was sent and what Plex offered
        const back = dlg.returnTo;
        closeDialog();
        view = back;
        debugPage = 3;
        showDebug();
        return true;
      }
      case 'back': closeDialog(); return true;
      default: return true;
    }
  }

  // ---- playback -----------------------------------------------------------------

  const native = () => (typeof EasyPlexVideo !== 'undefined' ? EasyPlexVideo : null);

  // Native now/next banner over the video (the WebView is hidden while playing).
  function banner(row, extra) {
    const v = native();
    if (!v || typeof v.setLiveBanner !== 'function' || !row) return;
    const now = Date.now();
    const lines = [channelLabel(row.name || row.channel)];
    let progress = -1;
    const cur = airingAt(row, now);
    if (cur) {
      const b = airingBounds(cur);
      lines.push('Now   ' + rangeOf(cur) + '  ' + titleOf(cur));
      progress = Math.round(Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start))) * 1000);
      const nxt = airingAt(row, b.end + 1000);
      if (nxt) lines.push('Next  ' + hhmm(airingBounds(nxt).start) + '  ' + titleOf(nxt));
    } else if (row.title) {
      lines.push('Now   ' + row.title);
    }
    if (extra) lines.push(extra);
    v.setLiveBanner(lines.join('\n'), progress);
  }

  let hdhrLineup = null, hdhrPending = null;
  function tunerDeviceUri() {
    for (const d of dvrs) {
      for (const device of d.Device || d.Devices || []) {
        if (typeof device.uri === 'string' && /\/hdhr\/?$/.test(device.uri)) return device.uri;
      }
    }
    return '';
  }
  async function getHdhrLineup() {
    if (hdhrLineup) return hdhrLineup;
    const uri = tunerDeviceUri();
    if (!uri) throw new Error('Plex DVR does not expose a Dispatcharr /hdhr device URL');
    if (!native()?.loadHdhrLineup) throw new Error('Native HDHomeRun lookup unavailable');
    if (hdhrPending) return hdhrPending;
    hdhrPending = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { window.__easyplexHdhrLineup = null; reject(new Error('HDHR lineup timed out')); }, 16000);
      window.__easyplexHdhrLineup = raw => {
        clearTimeout(timeout);
        try {
          const rows = JSON.parse(raw);
          if (!Array.isArray(rows)) throw new Error(rows.error || 'Invalid HDHR lineup response');
          hdhrLineup = rows;
          resolve(rows);
        } catch (err) { reject(err); }
        finally { window.__easyplexHdhrLineup = null; }
      };
      native().loadHdhrLineup(uri);
    });
    try { return await hdhrPending; } finally { hdhrPending = null; }
  }
  function startPlayback(url, row) {
    const v = native();
    if (!v) throw new Error('Native player unavailable');
    window.__easyplexLivePlayError = (msg) => {
      if (view !== 'playing' || !playingRow) return;
      const failedRow = playingRow;
      const stalled = String(msg).indexOf('NATIVE_STALL') !== -1;
      stopWatching();
      const i = channelRows.indexOf(failedRow);
      const next = channelRows.length > 1 ? channelRows[(i + 1) % channelRows.length] : null;
      showOptions({
        eyebrow: 'PLAYBACK PROBLEM',
        title: channelLabel(failedRow.name || failedRow.channel),
        subtitle: stalled ? 'No picture arrived within 8 seconds. This channel may use a format this box can’t decode.'
          : 'The stream stopped: ' + String(msg).slice(0, 120),
        focus: 0,
        items: [
          { label: 'Try again', run: () => tuneRow(failedRow) },
          next && { label: 'Watch next channel  (' + channelLabel(next.name || next.channel) + ')', run: () => tuneRow(next) },
          { label: 'Back to guide', run: () => {} },
        ],
      });
    };
    stopPlexSession();
    v.open(url);
    if (playingRow && playingRow !== row) lastRow = playingRow;
    playingRow = row;
    view = 'playing';
    closeOptions();
    prefSet(LAST_KEY, chanKey(row));
    gridIndex = Math.max(0, channelRows.indexOf(row));
    setText(info, 'Live TV · ' + row.channel + ' · Back to close');
    banner(row);
  }
  async function playDispatcharr(row, seq) {
    const rows = await getHdhrLineup();
    if (seq !== tuneSeq) return;
    const ids = [row.channelVcn, row.channelId, row.gridKey,
      row.item?.Media?.[0]?.channelVcn, row.item?.Media?.[0]?.channelIdentifier]
      .filter(v => v != null && String(v) !== '').map(String);
    let candidate = rows.find(r => ids.includes(String(r.GuideNumber)));
    if (!candidate) {
      const label = String(row.name || row.channel).replace(/^\s*\d+\s+/, '').trim().toLowerCase();
      candidate = rows.find(r => String(r.GuideName || '').trim().toLowerCase() === label);
    }
    if (!candidate) throw new Error('No Dispatcharr lineup match for ' + row.channel +
      ' (ids ' + ids.join(',') + '; ' + rows.length + ' available)');
    const url = String(candidate.URL || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('Channel has no HTTP stream URL');
    startPlayback(url, row);
  }
  function stopPlexSession() {
    if (!plexPlaybackSession) return;
    const s = plexPlaybackSession;
    plexPlaybackSession = '';
    server.get('/video/:/transcode/universal/stop', { session: s }).catch(() => {});
  }
  async function playViaPlex(row, seq) {
    const dvr = row.dvrId || String(dvrs[0]?.key || dvrs[0]?.id || '').replace(/^.*:/, '');
    const ids = [...new Set([row.channelId, row.channelVcn, row.gridKey,
      row.item?.Media?.[0]?.channelIdentifier, row.item?.Media?.[0]?.id]
      .filter(v => v !== undefined && v !== null && String(v) !== '').map(String))];
    if (!/^\d+$/.test(dvr) || !ids.length) throw new Error('No numeric DVR ID or channel identifier; press Green for diagnostics');
    const report = ['DVR ID: ' + dvr, 'Programme: ' + row.title,
      'Channel ID: ' + String(row.channelId || 'missing'),
      'Channel VCN: ' + String(row.channelVcn || 'missing'),
      'Guide key: ' + String(row.gridKey || 'missing'),
      'Media ID: ' + String(row.item?.Media?.[0]?.id || 'missing'),
      'Candidate count: ' + ids.length];
    say('Tuning ' + row.channel + ' via DVR ' + dvr + '…');
    let data = null;
    for (const id of ids) {
      try {
        data = await dvrPost('/livetv/dvrs/' + encodeURIComponent(dvr) + '/channels/' + encodeURIComponent(id) + '/tune');
        report.push('Channel ' + id + ': Plex accepted response');
        break;
      } catch (err) {
        report.push('Channel ' + id + ': ' + String(err.message).replace(/<[^>]*>/g, ' ').slice(0, 160));
      }
    }
    if (seq !== tuneSeq) return;
    if (!data) {
      report.push('All tuning attempts rejected. No HLS request made.');
      if (view !== 'playing') showTuneReport(report);
      throw new Error('Plex rejected every tune attempt');
    }
    const subscription = (data.MediaSubscription || data.MediaContainer?.MediaSubscription || [])[0];
    const operation = subscription?.MediaGrabOperation?.[0];
    const video = operation?.Video || subscription?.Video;
    const sessionMedia = Array.isArray(video?.Media) ? video.Media[0] : video?.Media;
    const uuid = sessionMedia?.uuid || sessionMedia?.id || operation?.Metadata?.Media?.[0]?.uuid;
    if (!uuid) {
      if (view !== 'playing') showTuneReport(liveShape(data), 'Plex tuning response (no session UUID) · Back to return');
      throw new Error('Tune response had no live session');
    }
    const playbackSession = 'ep-live-' + Date.now();
    const playUrl = server.url('/video/:/transcode/universal/start.m3u8', {
      path: '/livetv/sessions/' + uuid, session: playbackSession,
      hasMDE: 1, mediaBufferSize: 102400,
      'X-Plex-Session-Identifier': playbackSession,
      protocol: 'hls', mediaIndex: 0, partIndex: 0,
      directPlay: 0, directStream: 0, directStreamAudio: 1,
      fastSeek: 1, videoQuality: 100, videoResolution: '1920x1080',
      maxVideoBitrate: 12000, subtitles: 'none',
      audioBoost: 100, location: 'lan',
    });
    const response = await fetch(playUrl.replace('/start.m3u8', '/decision'), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error('Plex HLS decision HTTP ' + response.status + ' · ' + body.replace(/<[^>]*>/g, ' ').slice(0, 200));
    }
    if (seq !== tuneSeq) return;
    startPlayback(playUrl, row);
    plexPlaybackSession = playbackSession;
  }
  // Plex web and third-party clients differ in where PMS nests live session
  // metadata. Capture the structural paths, safely, for diagnostics.
  function liveShape(value, path = 'root', depth = 0, out = []) {
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
  async function tuneRow(row) {
    if (!row) return;
    const seq = ++tuneSeq;
    const zapping = view === 'playing';
    if (!zapping) say('Tuning ' + row.channel + '…');
    try {
      if (tunerDeviceUri()) await playDispatcharr(row, seq);
      else await playViaPlex(row, seq);
    } catch (err) {
      if (seq !== tuneSeq) return;
      if (zapping) banner(row, 'Cannot tune: ' + err.message);
      else say(row.channel + ': ' + err.message);
    }
  }
  function tuneSelected() {
    const row = view === 'guide' ? guideChannel : channelRows[gridIndex];
    tuneRow(row);
  }

  // Up/Down while watching. Presses are collected for a moment (banner shows the
  // target straight away) so stepping several channels opens only one stream.
  function zap(delta) {
    if (!channelRows.length) return;
    const from = zapTarget || playingRow || channelRows[gridIndex];
    let i = channelRows.indexOf(from);
    if (i < 0) i = gridIndex;
    i = (i + delta + channelRows.length) % channelRows.length;
    zapTarget = channelRows[i];
    banner(zapTarget);
    clearTimeout(zapTimer);
    zapTimer = setTimeout(() => {
      const target = zapTarget;
      zapTarget = null;
      if (target && target !== playingRow) tuneRow(target);
      else if (playingRow) banner(playingRow);
    }, 700);
  }
  function stopWatching() {
    clearTimeout(zapTimer);
    zapTarget = null;
    tuneSeq++;
    const v = native();
    if (v) v.close();
    stopPlexSession();
    playingRow = null;
    showGrid();
  }

  // ---- keys -------------------------------------------------------------------

  // Leaving the app stops live TV (the native side has already closed the video).
  function onLifecycle(e) { if (e.detail === 'stop' && view === 'playing') stopWatching(); }
  window.addEventListener('easyplex:lifecycle', onLifecycle);

  load();
  return {
    el, name: 'livetv', onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'menu' && (view === 'grid' || view === 'guide')) { openMenu(); return true; }
      if (view === 'grid' || view === 'playing') {
        if (/^digit\d$/.test(action)) { numberKey(action.slice(5)); return true; }
        if (digits && action === 'enter') { commitDigits(); return true; }
        if (digits && action === 'back') { cancelDigits(); return true; }
      }
      if (view === 'playing') {
        switch (action) {
          case 'up': case 'pageup': zap(1); return true;
          case 'down': case 'pagedown': zap(-1); return true;
          case 'left': case 'last':
            if (lastRow) { clearTimeout(zapTimer); zapTarget = null; tuneRow(lastRow); }
            else banner(playingRow, 'No previous channel');
            return true;
          case 'enter': case 'info': banner(zapTarget || playingRow); return true;
          case 'menu': openLiveMenu(); return true;
          case 'back': case 'stop': stopWatching(); return true;
          default: return true;
        }
      }
      if (view === 'grid') {
        switch (action) {
          case 'up': gridIndex = Math.max(0, gridIndex - 1); renderGrid(); if (gridIndex < gridTop + 1) fillGrid(); return true;
          case 'down': gridIndex = Math.min(channelRows.length - 1, gridIndex + 1); renderGrid(); if (gridIndex >= gridTop + ROWS - 1) fillGrid(); return true;
          case 'left': moveLeft(); renderGrid(); fillGrid(); return true;
          case 'right': moveRight(); renderGrid(); fillGrid(); return true;
          case 'rw': moveDays(-1); renderGrid(); fillGrid(); return true;
          case 'ff': moveDays(1); renderGrid(); fillGrid(); return true;
          case 'pageup': gridIndex = Math.max(0, gridIndex - ROWS); gridTop = gridIndex; renderGrid(); fillGrid(); return true;
          case 'pagedown': gridIndex = Math.min(channelRows.length - 1, gridIndex + ROWS); gridTop = gridIndex; renderGrid(); fillGrid(); return true;
          case 'enter': case 'play': case 'playpause': tuneSelected(); return true;
          case 'record': case 'red': recordSelected(); return true;
          case 'blue': showScheduled(); return true;
          case 'yellow': openChannelGuide(); return true;
          case 'green': debugPage = 0; showDebug(); return true;
          case 'info': return true; // the info panel already shows the details
          case 'back': return false;
          default: return true;
        }
      }
      if (view === 'record') return dlg ? dialogKey(action) : true;
      if (view === 'tune-debug') {
        if (action === 'down' || action === 'pagedown') { debugPage = Math.min(Math.floor((tuneReport.length - 1) / 25), debugPage + 1); renderTuneReport(); return true; }
        if (action === 'up' || action === 'pageup') { debugPage = Math.max(0, debugPage - 1); renderTuneReport(); return true; }
        if (action === 'back' || action === 'enter') { closeOverlay(); return true; }
        return true;
      }
      if (view === 'debug') {
        if (action === 'pageup' || action === 'up' || action === 'left') { debugPage--; showDebug(); return true; }
        if (action === 'pagedown' || action === 'down' || action === 'right') { debugPage++; showDebug(); return true; }
        if (action === 'back' || action === 'enter' || action === 'green') { closeOverlay(); return true; }
        return true;
      }
      if (view === 'guide') {
        switch (action) {
          case 'up': index = Math.max(0, index - 1); focus(); return true;
          case 'down': index = Math.min(entries.length - 1, index + 1); focus(); return true;
          case 'left': openGuide(dayOffset - 1); return true;
          case 'right': openGuide(dayOffset + 1); return true;
          case 'enter': case 'record': case 'red': recordSelected(); return true;
          case 'play': case 'playpause': tuneSelected(); return true;
          case 'green': debugPage = 0; showDebug(); return true;
          case 'back': case 'yellow': showGrid(); return true;
          default: return true;
        }
      }
      if (view === 'schedule') {
        switch (action) {
          case 'up': index = Math.max(0, index - 1); renderSchedule(); return true;
          case 'down': index = Math.max(0, Math.min(entries.length - 1, index + 1)); renderSchedule(); return true;
          case 'pageup': index = Math.max(0, index - ROWS); schedTop = index; renderSchedule(); return true;
          case 'pagedown': index = Math.max(0, Math.min(entries.length - 1, index + ROWS)); schedTop = index; renderSchedule(); return true;
          case 'enter': case 'red': case 'record': case 'menu': openCancel(); return true;
          case 'back': case 'left': case 'blue': showGrid(); return true;
          default: return true;
        }
      }
      if (view === 'cancel') return cancelKey(action);
      if (view === 'empty' && action === 'green') { debugPage = 0; returnView = 'grid'; showDebug(); return true; }
      return false;
    },
    destroy() {
      alive = false;
      window.removeEventListener('easyplex:lifecycle', onLifecycle);
      clearTimeout(digitTimer);
      clearTimeout(zapTimer);
      clearInterval(clockTimer);
      clearTimeout(sayTimer);
      if (view === 'playing') { const v = native(); if (v) v.close(); stopPlexSession(); }
    },
  };
}
