// HumaxPlex Live TV & DVR screen.
// Copied verbatim into the web app by patches/apply.py (js/screens/livetv.js).
//
// Channels and EPG come from the Plex DVR; playback goes straight to the
// Dispatcharr HDHomeRun stream when Plex reports a /hdhr tuner device,
// otherwise through Plex's own live-session transcode.
//
// Remote keys
//   Guide grid : arrows move · OK/Play watch · Record/Red record · FF/RW ±1 day
//                Green recordings · Yellow channel day guide · Blue diagnostics
//   Watching   : Up/CH+ next channel · Down/CH− previous · Left/Last previous
//                channel · OK/Info now & next · Right audio/subtitles · Back guide
import { h, setText } from '../util/dom.js';
import { session } from '../session.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import { identity } from '../plex/client.js';

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

export function LiveTvScreen() {
  const el = h('div', 'screen settings humax-live');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Live TV & DVR';
  const info = h('div', 'humax-live-status', el);
  const list = h('div', 'humax-live-list', el);
  const details = h('div', 'humax-live-detail', el);
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
  function guideKnown(row, when) { return !!(row?.gridKey && cached(localDate(when), row)); }

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
    if (view === 'grid' && text) sayTimer = setTimeout(() => { if (details._text === String(text)) setText(details, ''); }, 7000);
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
    h('div', 'hx-title', top).textContent = 'Live TV';
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
    h('span', 'hx-sp', keys);
    key('Recordings', 'hx-dot', '#2FA84F');
    key('Day guide', 'hx-dot', '#F2C230');
    key('Diagnostics', 'hx-dot', '#3A7BE0');
  }

  function renderInfo(row, p) {
    const now = Date.now();
    g.ch.textContent = '';
    if (row.channelVcn) h('b', '', g.ch).textContent = row.channelVcn;
    g.ch.appendChild(document.createTextNode(row.name || row.channel));
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
    el.classList.add('humax-grid-active');
    const now = Date.now();
    g.clock.textContent = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ';
    h('b', '', g.clock).textContent = hhmm(now);
    // Keep the selected row inside the visible window: no measuring, no scrolling.
    if (gridIndex < gridTop) gridTop = gridIndex;
    if (gridIndex >= gridTop + ROWS) gridTop = gridIndex - ROWS + 1;
    gridTop = Math.max(0, Math.min(gridTop, Math.max(0, channelRows.length - ROWS)));
    const a = windowStart, b = windowStart + SPAN;
    const pct = t => ((t - a) / SPAN * 100).toFixed(3) + '%';
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
      h('span', 'hx-num', ch).textContent = row.channelVcn || '';
      h('span', 'hx-name', ch).textContent = row.name || row.channel;
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
    channelRows = entries.slice();
    gridIndex = 0; gridTop = 0;
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
  }

  // ---- diagnostics ----------------------------------------------------------

  const allowed = /^(type|title|grandparentTitle|channelTitle|channelCallSign|channelName|channelIdentifier|channelVcn|channelNumber|gridKey|guideKey|ratingKey|key|id|identifier|source|providerIdentifier|epgSource|beginsAt|endsAt|startTime|duration|onAir|Media|Channel|Metadata|Airing|Directory|Dvr|DVR|MediaProvider|Feature|totalSize|size|status|protocol|decision|mediaType|partIndex|index)$/;
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
      diagnostic = h('div', 'humax-live-debug', el);
      h('div', 'humax-debug-title', diagnostic);
      h('pre', 'humax-debug-content', diagnostic);
    }
    diagnostic.querySelector('.humax-debug-title').textContent = title;
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
      ['Plex DVRs', dvrs.map(d => safeObject(d))],
      ['EPG providers', providers],
      ...debugResponses.map((r, i) => ['Endpoint ' + (i + 1) + ' ' + r.name, r.data]),
    ];
    debugPage = Math.max(0, Math.min(debugPage, cards.length - 1));
    pre.textContent = 'PAGE ' + (debugPage + 1) + ' / ' + cards.length + '\n' + cards[debugPage][0] + '\n\n' +
      JSON.stringify(cards[debugPage][1], null, 2).slice(0, 3200);
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
    el.classList.remove('humax-grid-active');
    list.innerHTML = '';
    entries.forEach(e => {
      const row = h('div', 'humax-live-row', list);
      h('span', 'humax-live-channel', row).textContent = e.channel;
      h('span', 'humax-live-show', row).textContent = e.title;
    });
    focus();
  }

  // ---- loading channels -------------------------------------------------------

  async function load() {
    el.classList.remove('humax-grid-active');
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
          '/' + replies.length + '. Channel listings unavailable; press Blue for diagnostics.');
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
      say('Channel lineup did not provide a matching guide key. Press Blue for diagnostics.');
      return;
    }
    guideChannel = row;
    openGuide(0);
  }
  async function openGuide(delta) {
    view = 'guide';
    dayOffset = Math.max(0, Math.min(7, delta));
    const date = localDate(Date.now() + dayOffset * DAY);
    el.classList.remove('humax-grid-active');
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

  async function showScheduled() {
    view = 'schedule';
    el.classList.remove('humax-grid-active');
    entries = []; index = 0; render();
    setText(info, 'DVR recording schedule · Back: guide grid');
    setText(details, 'Loading recordings…');
    try {
      const mc = await server.get('/media/subscriptions/scheduled');
      if (view !== 'schedule') return;
      entries = (mc.Metadata || mc.MediaSubscription || mc.Directory || []).map(m => ({
        channel: m.channelTitle || 'Scheduled',
        title: m.title || m.grandparentTitle || 'Recording',
        subtitle: m.summary || m.title || '', item: m,
      }));
      index = 0; render();
      if (!entries.length) setText(details, 'No scheduled recordings.');
    } catch (e) { setText(details, 'Unable to load recordings: ' + e.message); }
  }
  async function dvrPost(path, params = {}) {
    const url = server.url(path, params);
    const response = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ Accept: 'application/json', 'X-Plex-Token': server.token }, identity()),
    });
    const body = await response.text();
    if (!response.ok) throw new Error('Plex HTTP ' + response.status + ' ' + body.slice(0, 140));
    let data;
    try { data = JSON.parse(body); }
    catch (e) { throw new Error('Plex returned non-JSON response'); }
    const result = data.MediaContainer || data;
    if (typeof result.status === 'number' && result.status < 0)
      throw new Error('Plex status ' + result.status + ': ' + String(result.message || 'No error explanation').slice(0, 180));
    return result;
  }
  async function recordSelected() {
    const selected = view === 'grid' ? selectedGrid() : null;
    const m = selected?.programme || (view === 'guide' ? entries[index]?.item : null);
    const title = m ? titleOf(m) : selected?.row?.title;
    if (!m) { say('No programme selected for recording'); return; }
    const guid = m.guid;
    const ratingKey = m.ratingKey;
    if (!guid && !ratingKey) {
      say('Plex EPG lacks programme GUID/rating key; cannot create DVR rule.'); return;
    }
    if (!window.confirm('Schedule Plex recording: ' + title + '?')) return;
    say('Checking Plex recording template for ' + title + '…');
    try {
      const template = await server.get('/media/subscriptions/template', guid ? { guid } : { ratingKey });
      const t = (template.SubscriptionTemplate || template.MediaSubscription || [])[0];
      if (!t) throw new Error('No DVR recording template returned');
      const target = t.targetLibrarySectionID || t.targetSectionID;
      if (!target || t.type == null) throw new Error('Recording destination/type missing');
      const params = {
        targetLibrarySectionID: target,
        type: t.type,
        hints: JSON.stringify({ ratingKey: String(ratingKey || ''), guid: String(guid || '') }),
      };
      if (t.targetSectionLocationID) params.targetSectionLocationID = t.targetSectionLocationID;
      if (t.params?.mediaProviderID) params['params[mediaProviderID]'] = t.params.mediaProviderID;
      const result = await dvrPost('/media/subscriptions', params);
      const subs = result.MediaSubscription || [];
      if (m.guid) scheduledGuids.add(m.guid);
      if (view === 'grid') renderGrid();
      loadScheduled();
      say('Plex recording rule created for ' + title +
        (subs[0]?.key ? ' · rule ' + subs[0].key : '') + ' · Green shows the schedule');
    } catch (err) { say('Recording not scheduled: ' + err.message); }
  }

  // ---- playback -----------------------------------------------------------------

  const native = () => (typeof HumaxVideo !== 'undefined' ? HumaxVideo : null);

  // Native now/next banner over the video (the WebView is hidden while playing).
  function banner(row, extra) {
    const v = native();
    if (!v || typeof v.setLiveBanner !== 'function' || !row) return;
    const now = Date.now();
    const lines = [row.channel];
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
      const timeout = setTimeout(() => { window.__humaxHdhrLineup = null; reject(new Error('HDHR lineup timed out')); }, 16000);
      window.__humaxHdhrLineup = raw => {
        clearTimeout(timeout);
        try {
          const rows = JSON.parse(raw);
          if (!Array.isArray(rows)) throw new Error(rows.error || 'Invalid HDHR lineup response');
          hdhrLineup = rows;
          resolve(rows);
        } catch (err) { reject(err); }
        finally { window.__humaxHdhrLineup = null; }
      };
      native().loadHdhrLineup(uri);
    });
    try { return await hdhrPending; } finally { hdhrPending = null; }
  }
  function startPlayback(url, row) {
    const v = native();
    if (!v) throw new Error('Native player unavailable');
    window.__humaxLivePlayError = (msg) => {
      if (view !== 'playing') return;
      const stalled = String(msg).indexOf('NATIVE_STALL') !== -1;
      const text = stalled ? 'No video after 8s — this channel may not decode on this box.' : 'Playback failed: ' + msg;
      setText(details, text);
      setText(info, 'Live TV · playback error · Back to close');
    };
    stopPlexSession();
    v.open(url);
    if (playingRow && playingRow !== row) lastRow = playingRow;
    playingRow = row;
    view = 'playing';
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
    if (!/^\d+$/.test(dvr) || !ids.length) throw new Error('No numeric DVR ID or channel identifier; press Blue for diagnostics');
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
    const playbackSession = 'humax-live-' + Date.now();
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

  load();
  return {
    el, name: 'livetv', onShow() { ambience.restore(); },
    onKey(action) {
      if (view === 'playing') {
        switch (action) {
          case 'up': case 'pageup': zap(1); return true;
          case 'down': case 'pagedown': zap(-1); return true;
          case 'left': case 'last':
            if (lastRow) { clearTimeout(zapTimer); zapTarget = null; tuneRow(lastRow); }
            else banner(playingRow, 'No previous channel');
            return true;
          case 'enter': case 'info': banner(zapTarget || playingRow); return true;
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
          case 'green': showScheduled(); return true;
          case 'yellow': openChannelGuide(); return true;
          case 'blue': debugPage = 0; showDebug(); return true;
          case 'info': return true; // the info panel already shows the details
          case 'back': return false;
          default: return true;
        }
      }
      if (view === 'tune-debug') {
        if (action === 'down' || action === 'pagedown') { debugPage = Math.min(Math.floor((tuneReport.length - 1) / 25), debugPage + 1); renderTuneReport(); return true; }
        if (action === 'up' || action === 'pageup') { debugPage = Math.max(0, debugPage - 1); renderTuneReport(); return true; }
        if (action === 'back' || action === 'enter') { closeOverlay(); return true; }
        return true;
      }
      if (view === 'debug') {
        if (action === 'pageup' || action === 'up' || action === 'left') { debugPage--; showDebug(); return true; }
        if (action === 'pagedown' || action === 'down' || action === 'right') { debugPage++; showDebug(); return true; }
        if (action === 'back' || action === 'enter' || action === 'blue') { closeOverlay(); return true; }
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
          case 'blue': debugPage = 0; showDebug(); return true;
          case 'back': case 'yellow': showGrid(); return true;
          default: return true;
        }
      }
      if (view === 'schedule') {
        switch (action) {
          case 'up': index = Math.max(0, index - 1); focus(); return true;
          case 'down': index = Math.min(entries.length - 1, index + 1); focus(); return true;
          case 'back': case 'left': case 'green': showGrid(); return true;
          default: return true;
        }
      }
      if (view === 'empty' && action === 'blue') { debugPage = 0; returnView = 'grid'; showDebug(); return true; }
      return false;
    },
    destroy() {
      alive = false;
      clearTimeout(zapTimer);
      clearInterval(clockTimer);
      clearTimeout(sayTimer);
      if (view === 'playing') { const v = native(); if (v) v.close(); stopPlexSession(); }
    },
  };
}
