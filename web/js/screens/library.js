// A whole library as a virtualized poster grid, loaded page by page.
// Yellow cycles the sort; CH▲/CH▼ jump by letter (title sort) or by page.
import { h, setText } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
import { useAmbience } from '../ui/backdrop.js';
import { session } from '../session.js';
import { prefetch } from '../ui/images.js';
import { isFast } from '../input.js';
import { openItem, playItem } from '../nav.js';
import { error } from '../util/log.js';
import { metaLine } from '../util/format.js';

const PAGE = 140;
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
  hint.innerHTML = '<i class="key-yellow"></i> Sort &nbsp;&nbsp; CH ▲▼ Jump';

  let sortIndex = 0;
  let pages = new Map();     // page -> 'loading' | true
  let items = [];
  let letters = [];          // [{ title: 'A', start: 0 }]
  let generation = 0;
  let alphaMode = false;
  let alphaIndex = 0;
  function paintAlpha() {
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

  const grid = new Grid({
    top: 200, height: 880, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      // Warm posters for the row just past the recycled pool.
      if (!isFast()) {
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

  async function loadPage(p) {
    if (pages.has(p)) return;
    if (grid.total && p * PAGE >= grid.total) return;
    pages.set(p, 'loading');
    const gen = generation;
    try {
      const res = await session.server.items(section.key, p * PAGE, PAGE, { sort: SORTS[sortIndex].id, type });
      if (gen !== generation) return;
      res.items.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      if (grid.total !== res.total) {
        grid.setTotal(res.total);
        setText(count, res.total + (section.type === 'show' ? ' shows' : ' movies'));
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
      const mc = await session.server.get('/library/sections/' + section.key + '/firstCharacter', { type });
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
    setText(sortEl, 'Sorted by ' + SORTS[sortIndex].label);
    grid.total = 0;
    grid.index = 0;
    grid.refresh();
    loadPage(0);
    loadLetters();
  }
  reload();

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
        alphaMode = true;
        const i = letters.findIndex((l,k) => grid.index >= l.start &&
          (k === letters.length - 1 || grid.index < letters[k+1].start));
        alphaIndex = Math.max(0, i);
        paintAlpha();
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
        case 'back':
          if (grid.index > grid.cols * 2) { grid.focusIndex(0); return true; }
          return false;
      }
      return false;
    },
  };
}
