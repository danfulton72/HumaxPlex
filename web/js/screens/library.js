// A whole library as a virtualized poster grid, loaded page by page.
// Hold OK (or Yellow) for sort and filter; CH▲/CH▼ jump by letter (title sort) or by page.
import { h, setText } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
import { Row } from '../ui/row.js';
import { useAmbience } from '../ui/backdrop.js';
import { session } from '../session.js';
import { prefetch } from '../ui/images.js';
import { isFast } from '../input.js';
import { openItem, playItem, itemOptions } from '../nav.js';
import { showOptions } from '../ui/options.js';
import { error } from '../util/log.js';
import { metaLine } from '../util/format.js';

const PAGE = 140;
const RECENT_LIMIT = 12;
// Vertical layout when the Recently Added rail is present: the rail sits just
// under the header and the grid takes the space below it. Without the rail the
// grid uses the full area (gridTop/gridHeight defaults).
const GRID_TOP_DEFAULT = 200;
const GRID_HEIGHT_DEFAULT = 880;
const RECENT_ROW_TOP = 150;
const GRID_TOP_WITH_RECENT = 590;
const GRID_HEIGHT_WITH_RECENT = 490;
const SORTS = [
  { id: 'titleSort', label: 'A–Z' },
  { id: 'addedAt:desc', label: 'Recently added' },
  { id: 'originallyAvailableAt:desc', label: 'Release date' },
  { id: 'audienceRating:desc', label: 'Rating' },
];

export function LibraryScreen(section) {
  const el = h('div', 'screen library');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = section.title;
  const count = h('div', 'lib-count', head);
  const sortEl = h('div', 'lib-sort', head);
  const focusInfo = h('div', 'lib-focus', el);
  const alphaRail = h('div', 'ep-alpha', el);
  const hint = h('div', 'lib-hint', el);
  hint.innerHTML = 'Hold OK&nbsp; Options &nbsp;&nbsp;·&nbsp;&nbsp; <i class="key-yellow"></i> Sort &nbsp;&nbsp;·&nbsp;&nbsp; CH ▲▼ Jump';

  let grid = null;           // assigned below; the Grid reports focus while it is being built
  let sortIndex = 0;
  let unwatchedOnly = false;
  let pages = new Map();     // page -> 'loading' | true
  let items = [];
  let letters = [];          // [{ title: 'A', start: 0 }]
  let generation = 0;
  let alphaMode = false;
  let alphaIndex = 0;
  function paintAlpha() {
    if (!grid) return;
    alphaRail.innerHTML = '';
    alphaRail.style.display = letters.length ? '' : 'none';
    letters.forEach((l, i) => {
      const node = h('div', 'ep-alpha-letter', alphaRail);
      node.textContent = l.title;
      node.classList.toggle('focus', alphaMode && i === alphaIndex);
      node.classList.toggle('selected', grid.index >= l.start &&
        (i === letters.length - 1 || grid.index < letters[i + 1].start));
    });
  }
  function chooseLetter() {
    if (!letters[alphaIndex]) return;
    grid.focusIndex(letters[alphaIndex].start);
    paintAlpha();
  }

  const type = section.type === 'show' ? 2 : 1;
  // Shows count as unwatched while any episode is unwatched.
  const filter = () => (unwatchedOnly ? (type === 2 ? { unwatchedLeaves: 1 } : { unwatched: 1 }) : {});

  grid = new Grid({
    top: 200, height: 880, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      // Warm posters for the row just past the recycled pool.
      if (grid && !isFast()) {
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) {
          if (items[i]) prefetch(session.server.image(items[i].thumb, 216, 324));
        }
      }
      if (!item) { setText(focusInfo, ''); return; }
      setText(focusInfo, item.title + '   ' + metaLine(item));
      ambience.set(item.UltraBlurColors);
    },
    onSelect: item => openItem(item),
    onNeed: (start, end) => {
      for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
    },
  });
  el.appendChild(grid.el);

  // Option A: a "Recently Added" rail above the grid (newest episodes for shows,
  // newest movies otherwise), capped at RECENT_LIMIT and deduped against what's
  // already in Continue Watching. Hidden entirely when there's nothing new.
  const recentRow = new Row({
    title: 'Recently added', kind: 'poster', items: [],
    onFocus: item => { if (!item) return; setText(focusInfo, item.title + '   ' + metaLine(item)); ambience.set(item.UltraBlurColors); },
    onSelect: item => openItem(item),
  });
  recentRow.el.style.top = RECENT_ROW_TOP + 'px';
  recentRow.el.style.display = 'none';
  el.appendChild(recentRow.el);
  let zone = 'grid'; // 'recent' | 'grid'

  // Only one focus ring shows at a time: the rail's or the grid's.
  function syncZone() {
    const onRail = zone === 'recent' && recentRow.el.style.display !== 'none';
    recentRow.setActive(onRail);
    grid.ring.classList.toggle('on', !onRail);
  }

  function layoutGrid(withRecent) {
    grid.el.style.top = (withRecent ? GRID_TOP_WITH_RECENT : GRID_TOP_DEFAULT) + 'px';
    grid.el.style.height = (withRecent ? GRID_HEIGHT_WITH_RECENT : GRID_HEIGHT_DEFAULT) + 'px';
    grid.refresh();
  }

  async function loadRecent() {
    try {
      const recType = section.type === 'show' ? 4 : 1; // 4 = episode, 1 = movie
      const recs = await session.server.recentItems(section.key, { type: recType, limit: RECENT_LIMIT });
      if (!recs.length) { recentRow.el.style.display = 'none'; layoutGrid(false); return; }
      recentRow.setItems(recs);
      recentRow.el.style.display = '';
      layoutGrid(true);
      // Land on the rail first so the freshest additions are what you see.
      zone = 'recent';
      syncZone();
      recentRow.focusIndex(0);
    } catch (e) { error('recently added failed', section.title, e); }
  }

  async function loadPage(p) {
    if (pages.has(p)) return;
    if (grid && grid.total && p * PAGE >= grid.total) return;
    pages.set(p, 'loading');
    const gen = generation;
    try {
      const res = await session.server.items(section.key, p * PAGE, PAGE, { sort: SORTS[sortIndex].id, type, filter: filter() });
      if (gen !== generation) return;
      res.items.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      if (grid.total !== res.total) {
        grid.setTotal(res.total);
        setText(count, res.total + (unwatchedOnly ? ' unwatched' : '') + (section.type === 'show' ? ' shows' : ' movies'));
      } else {
        grid.refresh();
      }
      if (p === 0 && res.items[0]) grid.onFocus(grid.current());
    } catch (e) {
      pages.delete(p);
      error('library page failed', section.title, p, e);
    }
  }

  async function loadLetters() {
    letters = [];
    if (SORTS[sortIndex].id !== 'titleSort') return;
    try {
      const mc = await session.server.get('/library/sections/' + section.key + '/firstCharacter', { type, ...filter() });
      let start = 0;
      letters = (mc.Directory || []).map(d => {
        const l = { title: d.title, start };
        start += d.size;
        return l;
      });
      paintAlpha();
    } catch (e) { /* letter jump just won't work */ }
  }

  function reload() {
    generation++;
    alphaMode = false;
    alphaRail.style.display = 'none';
    pages = new Map();
    items = [];
    setText(sortEl, 'Sorted by ' + SORTS[sortIndex].label + (unwatchedOnly ? '  ·  Unwatched only' : ''));
    setText(count, '');
    grid.total = 0;
    grid.index = 0;
    grid.refresh();
    // Re-sorting is about the grid — return focus there if we were on the rail.
    zone = 'grid';
    syncZone();
    loadPage(0);
    loadLetters();
  }
  reload();
  loadRecent();

  function openAlpha() {
    if (!letters.length) return;
    alphaMode = true;
    const i = letters.findIndex((l, k) => grid.index >= l.start &&
      (k === letters.length - 1 || grid.index < letters[k + 1].start));
    alphaIndex = Math.max(0, i);
    paintAlpha();
  }

  function openMenu() {
    const cur = (zone === 'recent' && recentRow.el.style.display !== 'none') ? recentRow.current() : grid.current();
    showOptions({
      title: section.title,
      subtitle: cur ? 'Focused: ' + cur.title : '',
      focus: 0,
      items: [
        cur && { label: 'Options for “' + cur.title + '”…', run: () => itemOptions(cur, { onChanged: reload }) },
        ...SORTS.map((srt, i) => ({ label: 'Sort by ' + srt.label, checked: i === sortIndex,
          run: () => { if (i !== sortIndex) { sortIndex = i; reload(); } } })),
        { label: unwatchedOnly ? 'Show everything' : 'Show unwatched only', run: () => { unwatchedOnly = !unwatchedOnly; reload(); } },
        letters.length && { label: 'Jump to letter…', run: openAlpha },
      ],
    });
  }

  function jump(dir) {
    if (letters.length) {
      const i = grid.index;
      let li = letters.findIndex((l, k) => i >= l.start && (k === letters.length - 1 || i < letters[k + 1].start));
      li = Math.max(0, Math.min(letters.length - 1, li + dir));
      grid.focusIndex(letters[li].start);
      setText(focusInfo, letters[li].title);
    } else {
      grid.focusIndex(grid.index + dir * grid.cols * 3);
    }
  }

  return {
    el,
    name: 'library',
    onShow() { ambience.restore(); },
    onKey(action) {
      // Recently Added rail (Option A): left/right move within it, Down drops
      // into the grid, Up/Back leave it. Only active when the rail is showing.
      if (zone === 'recent' && recentRow.el.style.display !== 'none') {
        if (action === 'left' || action === 'right') { recentRow.move(action === 'left' ? -1 : 1); return true; }
        if (action === 'down') {
          zone = 'grid'; syncZone();
          grid.focusIndex(0);
          return true;
        }
        if (action === 'enter') { recentRow.select(); return true; }
        if (action === 'play' || action === 'playpause') { const c = recentRow.current(); if (c) playItem(c); return true; }
        if (action === 'back') { zone = 'grid'; syncZone(); grid.focusIndex(0); return true; }
        return true;
      }
      if (alphaMode) {
        if (action === 'up' || action === 'down') {
          alphaIndex = Math.max(0, Math.min(letters.length - 1, alphaIndex + (action === 'down' ? 1 : -1)));
          paintAlpha();
          return true;
        }
        if (action === 'enter' || action === 'left') {
          if (action === 'enter') chooseLetter();
          alphaMode = false;
          paintAlpha();
          return true;
        }
        if (action === 'back') { alphaMode = false; paintAlpha(); return true; }
        return true;
      }
      if (action === 'right' && letters.length && grid.index % grid.cols === grid.cols - 1) {
        openAlpha();
        return true;
      }
      switch (action) {
        case 'left': grid.move(-1, 0); paintAlpha(); return true;
        case 'right': grid.move(1, 0); paintAlpha(); return true;
        case 'up':
          // From the grid's top row, Up climbs back onto the Recently Added rail.
          if (grid.index < grid.cols && recentRow.el.style.display !== 'none') {
            zone = 'recent'; syncZone(); recentRow.focusIndex(0); return true;
          }
          grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'pageup': jump(-1); return true;
        case 'pagedown': jump(1); return true;
        case 'enter': grid.select(); return true;
        case 'play': case 'playpause': if (grid.current()) playItem(grid.current()); return true;
        case 'yellow': sortIndex = (sortIndex + 1) % SORTS.length; reload(); return true;
        case 'menu': openMenu(); return true;
        case 'back':
          if (grid.index > grid.cols * 2) { grid.focusIndex(0); return true; }
          return false;
      }
      return false;
    },
  };
}
