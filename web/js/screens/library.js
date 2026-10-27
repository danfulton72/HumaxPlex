// A whole library as a virtualized poster grid, loaded page by page.
// The newest additions sit at the very top of the grid (as its first row(s)),
// so they scroll away with the rest of the content rather than being pinned.
// Hold OK (or Yellow) for sort and filter; CH▲/CH▼ jump by letter (title sort)
// or by page.
import { h, setText } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
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
  let items = [];            // server items, indexed by SERVER position (0-based)
  let recent = [];           // newest items, shown as the grid's leading row(s)
  let serverTotal = 0;       // item count the server reported for the current sort
  let letters = [];          // [{ title: 'A', start: 0 }] — server positions
  let generation = 0;
  let alphaMode = false;
  let alphaIndex = 0;

  // Grid index <-> server index. The recent block occupies the first R slots;
  // everything after it is a server item shifted down by R.
  const R = () => recent.length;
  const gridItem = g => (g < R() ? recent[g] : items[g - R()]);
  const serverIndexOf = g => Math.max(0, g - R());

  function paintAlpha() {
    if (!grid) return;
    alphaRail.innerHTML = '';
    alphaRail.style.display = letters.length ? '' : 'none';
    letters.forEach((l, i) => {
      const node = h('div', 'ep-alpha-letter', alphaRail);
      node.textContent = l.title;
      // Letter starts are server positions; compare against the focused item's
      // server position (only meaningful once past the recent block).
      const sIdx = serverIndexOf(grid.index);
      node.classList.toggle('focus', alphaMode && i === alphaIndex);
      node.classList.toggle('selected', sIdx >= l.start &&
        (i === letters.length - 1 || sIdx < letters[i + 1].start));
    });
  }
  function chooseLetter() {
    if (!letters[alphaIndex]) return;
    grid.focusIndex(R() + letters[alphaIndex].start);
    paintAlpha();
  }

  const type = section.type === 'show' ? 2 : 1;
  // Shows count as unwatched while any episode is unwatched.
  const filter = () => (unwatchedOnly ? (type === 2 ? { unwatchedLeaves: 1 } : { unwatched: 1 }) : {});

  grid = new Grid({
    top: 200, height: 880, total: 0,
    getItem: gridItem,
    onFocus: (item, index) => {
      // Warm posters for the row just past the recycled pool.
      if (grid && !isFast()) {
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) {
          const it = gridItem(i);
          if (it) prefetch(session.server.image(it.thumb, 216, 324));
        }
      }
      if (!item) { setText(focusInfo, ''); return; }
      // Newest items get a small "new" cue in the focus line.
      const tag = index < R() ? 'New · ' : '';
      setText(focusInfo, tag + item.title + '   ' + metaLine(item));
      ambience.set(item.UltraBlurColors);
    },
    onSelect: item => openItem(item),
    onNeed: (start, end) => {
      // Convert the grid range to a server range, then load the covering pages.
      const sStart = serverIndexOf(start);
      const sEnd = serverIndexOf(end);
      for (let p = Math.floor(sStart / PAGE); p <= Math.floor(sEnd / PAGE); p++) loadPage(p);
    },
  });
  el.appendChild(grid.el);

  async function loadPage(p) {
    if (pages.has(p)) return;
    // Skip pages past the end of the SERVER list (the recent block is separate
    // and never paged). Only enforce this once the server has reported a total;
    // before that, page 0 must always load even if grid.total == R().
    if (serverTotal > 0 && p * PAGE >= serverTotal) return;
    pages.set(p, 'loading');
    const gen = generation;
    try {
      const res = await session.server.items(section.key, p * PAGE, PAGE, { sort: SORTS[sortIndex].id, type, filter: filter() });
      if (gen !== generation) return;
      res.items.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      serverTotal = res.total;
      if (grid.total !== R() + serverTotal) {
        grid.setTotal(R() + serverTotal);
        setText(count, serverTotal + (unwatchedOnly ? ' unwatched' : '') + (section.type === 'show' ? ' shows' : ' movies'));
      } else {
        grid.refresh();
      }
      if (p === 0 && res.items[0] && grid.index >= R()) grid.onFocus(grid.current());
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

  // Newest additions become the grid's leading row(s). Loaded once per section;
  // deduped against Continue Watching so nothing repeats. When there's nothing
  // new the grid is just the normal sorted list.
  async function loadRecent() {
    try {
      const recType = section.type === 'show' ? 4 : 1; // 4 = episode, 1 = movie
      const recs = await session.server.recentItems(section.key, { type: recType, limit: RECENT_LIMIT });
      if (!recs.length) return;
      recent = recs;
      // The recent block now occupies the first R() slots, so the total grows by
      // R(). serverTotal is authoritative once page 0 has landed; otherwise the
      // in-flight loadPage will setTotal with the updated R().
      if (pages.get(0) === true) grid.setTotal(R() + serverTotal);
      else grid.refresh();
    } catch (e) { error('recently added failed', section.title, e); }
  }

  function reload() {
    generation++;
    alphaMode = false;
    alphaRail.style.display = 'none';
    pages = new Map();
    items = [];
    serverTotal = 0;
    setText(sortEl, 'Sorted by ' + SORTS[sortIndex].label + (unwatchedOnly ? '  ·  Unwatched only' : ''));
    setText(count, '');
    grid.total = R();       // keep the recent block visible while the grid refetches
    grid.index = 0;
    grid.refresh();
    loadPage(0);
    loadLetters();
  }
  reload();
  loadRecent();

  function openAlpha() {
    if (!letters.length) return;
    alphaMode = true;
    const sIdx = serverIndexOf(grid.index);
    const i = letters.findIndex((l, k) => sIdx >= l.start &&
      (k === letters.length - 1 || sIdx < letters[k + 1].start));
    alphaIndex = Math.max(0, i);
    paintAlpha();
  }

  function openMenu() {
    const cur = grid.current();
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
      const sIdx = serverIndexOf(grid.index);
      let li = letters.findIndex((l, k) => sIdx >= l.start && (k === letters.length - 1 || sIdx < letters[k + 1].start));
      li = Math.max(0, Math.min(letters.length - 1, li + dir));
      grid.focusIndex(R() + letters[li].start);
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
        case 'up': grid.move(0, -1); return true;
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
