// Films from Dispatcharr's Xtream output: categories down the left, posters on
// the right. Each category loads on its own (a whole catalogue can be tens of
// thousands of films). Continue Watching comes from resume points on the box.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
import { useAmbience } from '../ui/backdrop.js';
import { prefetch } from '../ui/images.js';
import { isFast } from '../input.js';
import { showOptions, toast } from '../ui/options.js';
import * as router from '../router.js';
import * as store from '../util/store.js';
import {
  loadConfig, XtreamClient, friendlyError, imageUrl, resumeItems, resumeFor, clearResume,
} from '../xtream/api.js';
import { VodDetailScreen, vodMetaLine, playVod } from './voddetail.js';
import { VodSetupScreen } from './vodsetup.js';

const RESUME_ID = '__resume';
const LAST_KEY = 'xtreamCategory';
const RAIL_ROW = 64;
const RAIL_VISIBLE = 13;
const SORTS = [
  { id: 'server', label: 'Server order' },
  { id: 'title', label: 'A–Z' },
  { id: 'added', label: 'Recently added' },
  { id: 'rating', label: 'Rating' },
];

export function sortMovies(list, sort) {
  const out = list.slice();
  if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'added') out.sort((a, b) => b.added - a.added);
  else if (sort === 'rating') out.sort((a, b) => b.rating - a.rating);
  return out;
}

export function VodScreen() {
  const el = h('div', 'screen library vod');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = 'Films';
  const count = h('div', 'lib-count', head);
  const sortEl = h('div', 'lib-sort', head);
  const focusInfo = h('div', 'lib-focus vod-focus', el);
  const hint = h('div', 'lib-hint', el);
  hint.innerHTML = 'Hold OK&nbsp; Options &nbsp;&nbsp;·&nbsp;&nbsp; <i class="key-yellow"></i> Sort &nbsp;&nbsp;·&nbsp;&nbsp; ▶ Play';
  const rail = h('div', 'vod-rail', el);
  const railTrack = h('div', 'vod-rail-track', rail);
  const message = h('div', 'vod-message', el);

  const cfg = loadConfig();
  const client = cfg ? new XtreamClient(cfg) : null;
  let categories = [];          // [{ id, name }]
  let catIndex = 0;
  let shownId = null;           // category whose films are in the grid
  let items = [];
  let zone = 'rail';
  let sortIndex = Math.max(0, SORTS.findIndex(s => s.id === store.get('xtreamSort', 'server')));
  const cache = new Map();      // category id -> films
  let generation = 0;
  let railTimer = 0;

  let grid = null;
  grid = new Grid({
    cols: 5, top: 200, height: 880, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      if (grid && !isFast()) {
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) if (items[i]) prefetch(imageUrl(items[i].posterUrl));
      }
      if (zone !== 'grid') return;
      showFocus(item);
    },
    onSelect: item => openFilm(item),
    onNeed: () => {},
  });
  grid.el.classList.add('vod-grid');
  el.appendChild(grid.el);

  function showFocus(item) {
    if (!item) { setText(focusInfo, ''); return; }
    const meta = vodMetaLine(item);
    setText(focusInfo, item.title + (meta ? '   ' + meta : ''));
  }

  function railEntries() {
    const resume = resumeItems();
    return (resume.length ? [{ id: RESUME_ID, name: 'Continue watching', count: resume.length }] : []).concat(categories);
  }

  function paintRail() {
    const entries = railEntries();
    railTrack.textContent = '';
    entries.forEach((c, i) => {
      const n = h('div', 'vod-cat', railTrack);
      n.textContent = c.name;
      toggleClass(n, 'focus', zone === 'rail' && i === catIndex);
      toggleClass(n, 'current', c.id === shownId);
      toggleClass(n, 'resume', c.id === RESUME_ID);
    });
    const first = Math.max(0, Math.min(entries.length - RAIL_VISIBLE, catIndex - Math.floor(RAIL_VISIBLE / 2)));
    setTransform(railTrack, 'translateY(' + (-first * RAIL_ROW) + 'px)');
    toggleClass(el, 'in-rail', zone === 'rail');
  }

  // Progress bars on films that have a resume point.
  function markProgress(list) {
    for (const m of list) {
      const r = resumeFor(m.id);
      m.viewOffset = r ? r.position : 0;
      m.duration = r ? r.duration : m.duration;
    }
    return list;
  }

  function repaintTiles() {
    grid.rows.forEach(r => r.tiles.forEach(t => { t.item = null; }));
    grid.refresh();
  }

  function setItems(list, id) {
    shownId = id;
    items = id === RESUME_ID ? list : markProgress(sortMovies(list, SORTS[sortIndex].id));
    grid.index = 0;
    grid.total = 0;
    grid.setTotal(items.length);
    const name = (railEntries().find(c => c.id === id) || {}).name || '';
    setText(count, items.length + (items.length === 1 ? ' film' : ' films') + (name ? '  ·  ' + name : ''));
    setText(sortEl, id === RESUME_ID ? '' : 'Sorted by ' + SORTS[sortIndex].label);
    setText(message, items.length ? '' : 'No films in this category.');
    paintRail();
  }

  async function showCategory(id) {
    const gen = ++generation;
    if (id === RESUME_ID) { setItems(resumeItems(), id); return; }
    store.set(LAST_KEY, id);
    if (cache.has(id)) { setItems(cache.get(id), id); return; }
    items = [];
    grid.setTotal(0);
    setText(message, 'Loading…');
    setText(count, '');
    try {
      const list = await client.movies(id);
      cache.set(id, list);
      if (gen !== generation) return;
      setItems(list, id);
    } catch (e) {
      if (gen !== generation) return;
      setText(message, 'Couldn\'t load films: ' + friendlyError(e) + '  ·  OK to retry');
    }
  }

  async function loadCategories() {
    if (!client) { setText(message, 'Set up Dispatcharr VOD in Settings first.'); return; }
    setText(message, 'Connecting to ' + cfg.server + '…');
    try {
      categories = await client.categories();
      if (!categories.length) {
        setText(message, 'No film categories. Check that this Dispatcharr user can see VOD and that a VOD-enabled M3U account is set up.');
        paintRail();
        return;
      }
      const entries = railEntries();
      const last = store.get(LAST_KEY, null);
      const at = entries.findIndex(c => c.id === last);
      catIndex = entries[0].id === RESUME_ID ? 0 : Math.max(0, at);
      paintRail();
      showCategory(entries[catIndex].id);
    } catch (e) {
      setText(message, 'Couldn\'t reach the VOD server: ' + friendlyError(e) + '  ·  OK to retry · Hold OK for settings');
    }
  }

  function openFilm(item) {
    if (item) router.push(VodDetailScreen(client, item));
  }

  function railMove(d) {
    const entries = railEntries();
    if (!entries.length) return;
    catIndex = Math.max(0, Math.min(entries.length - 1, catIndex + d));
    paintRail();
    clearTimeout(railTimer);
    const id = entries[catIndex].id;
    railTimer = setTimeout(() => { if (id !== shownId) showCategory(id); }, 450);
  }

  function enterGrid() {
    if (!items.length) return;
    zone = 'grid';
    paintRail();
    grid.focusIndex(Math.min(grid.index, items.length - 1));
    showFocus(grid.current());
  }

  function leaveGrid() {
    zone = 'rail';
    const entries = railEntries();
    const i = entries.findIndex(c => c.id === shownId);
    if (i >= 0) catIndex = i;
    setText(focusInfo, '');
    paintRail();
  }

  function openMenu() {
    const cur = zone === 'grid' ? grid.current() : null;
    const resume = cur ? resumeFor(cur.id) : null;
    showOptions({
      title: 'Films',
      subtitle: cur ? cur.title : (railEntries()[catIndex] || {}).name || '',
      focus: 0,
      items: [
        cur && { label: resume ? 'Resume' : 'Play', run: () => playVod(client, cur, false) },
        resume && { label: 'Play from the start', run: () => playVod(client, cur, true) },
        cur && { label: 'Details', run: () => openFilm(cur) },
        resume && { label: 'Remove from Continue Watching', run: () => { clearResume(cur.id); afterResumeChange(); } },
        ...SORTS.map((s, i) => ({ label: 'Sort by ' + s.label, checked: i === sortIndex, run: () => setSort(i) })),
        { label: 'Reload categories', run: () => { cache.clear(); loadCategories(); } },
        { label: 'Dispatcharr VOD settings…', run: () => router.push(VodSetupScreen()) },
      ],
    });
  }

  function setSort(i) {
    sortIndex = i;
    store.set('xtreamSort', SORTS[i].id);
    if (shownId && shownId !== RESUME_ID) setItems(cache.get(shownId) || [], shownId);
    toast('Sorted by ' + SORTS[i].label, 1500);
  }

  // Continue Watching appears/disappears and the list shifts by one.
  function afterResumeChange() {
    const entries = railEntries();
    if (shownId === RESUME_ID) {
      if (entries[0] && entries[0].id === RESUME_ID) setItems(resumeItems(), RESUME_ID);
      else { zone = 'rail'; catIndex = 0; if (entries[0]) showCategory(entries[0].id); }
    } else {
      const i = entries.findIndex(c => c.id === shownId);
      if (zone === 'rail' || i < 0) catIndex = Math.max(0, Math.min(entries.length - 1, i < 0 ? catIndex : i));
      paintRail();
      markProgress(items);
      repaintTiles();
    }
  }

  loadCategories();

  return {
    el,
    name: 'vod',
    onShow() {
      ambience.restore();
      ambience.set(null);
      if (categories.length) afterResumeChange();
    },
    onKey(action) {
      if (!client) {
        if (action === 'enter' || action === 'menu') { router.push(VodSetupScreen()); return true; }
        return false;
      }
      if (action === 'menu') { openMenu(); return true; }
      if (action === 'yellow') { setSort((sortIndex + 1) % SORTS.length); return true; }
      if (zone === 'rail') {
        switch (action) {
          case 'up': railMove(-1); return true;
          case 'down': railMove(1); return true;
          case 'pageup': railMove(-RAIL_VISIBLE); return true;
          case 'pagedown': railMove(RAIL_VISIBLE); return true;
          case 'right': case 'enter': {
            const entries = railEntries();
            if (!entries.length) { loadCategories(); return true; }
            const id = entries[catIndex].id;
            clearTimeout(railTimer);
            if (id !== shownId || (!items.length && action === 'enter')) {
              showCategory(id).then(() => { if (action === 'enter' || items.length) enterGrid(); });
            } else enterGrid();
            return true;
          }
        }
        return false;
      }
      switch (action) {
        case 'left':
          if (grid.index % grid.cols === 0) leaveGrid(); else grid.move(-1, 0);
          return true;
        case 'right': grid.move(1, 0); return true;
        case 'up': grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'pageup': grid.focusIndex(grid.index - grid.cols * 3); return true;
        case 'pagedown': grid.focusIndex(grid.index + grid.cols * 3); return true;
        case 'enter': grid.select(); return true;
        case 'play': case 'playpause': if (grid.current()) playVod(client, grid.current(), false); return true;
        case 'back': leaveGrid(); return true;
      }
      return false;
    },
    destroy() { clearTimeout(railTimer); generation++; },
  };
}
