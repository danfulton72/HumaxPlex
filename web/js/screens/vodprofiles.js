// Plex admin only: choose which VOD categories each Plex Home profile sees.
// Settings → Dispatcharr VOD → Categories for each profile.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import { toast } from '../ui/options.js';
import * as router from '../router.js';
import { homeUsers } from '../plex/home.js';
import { loadConfig, XtreamClient, friendlyError } from '../xtream/api.js';
import { allowedFor, setAllowed, limitLabel } from '../xtream/limits.js';

const ROW = 84;
const VISIBLE = 7;

// A scrolling list of setting rows; items are { label, value, run, dim }.
function settingList(parent, top) {
  const clip = h('div', 'vod-plist', parent);
  clip.style.top = top + 'px';
  clip.style.height = (ROW * VISIBLE) + 'px';
  const track = h('div', 'vod-plist-track', clip);
  let rows = [];
  let index = 0;
  return {
    set(items, keep) {
      track.textContent = '';
      rows = items.map(it => {
        const el = h('div', 'setting vod-prow', track);
        it.labelEl = h('span', 'setting-label', el);
        it.valueEl = h('span', 'setting-value', el);
        it.el = el;
        return it;
      });
      if (!keep) index = 0;
      this.render();
    },
    render() {
      index = Math.max(0, Math.min(rows.length - 1, index));
      rows.forEach((it, i) => {
        setText(it.labelEl, it.label);
        setText(it.valueEl, it.value || '');
        toggleClass(it.el, 'focus', i === index);
        toggleClass(it.el, 'dim', !!it.dim);
      });
      const first = Math.max(0, Math.min(rows.length - VISIBLE, index - Math.floor(VISIBLE / 2)));
      setTransform(track, 'translateY(' + (-first * ROW) + 'px)');
    },
    move(d) { index += d; this.render(); },
    current() { return rows[index]; },
    get index() { return index; },
    set index(i) { index = i; },
  };
}

function screenShell(title, intro) {
  const el = h('div', 'screen settings vod-profiles');
  h('h1', 'settings-title', el).textContent = title;
  const introEl = h('div', 'vod-setup-intro', el);
  introEl.textContent = intro;
  const status = h('div', 'vod-plist-status', el);
  const foot = h('div', 'settings-foot', el);
  return { el, introEl, status, foot };
}

export function VodProfilesScreen() {
  const { el, status, foot } = screenShell('VOD categories by profile',
    'Choose which film categories each Plex Home profile sees in EasyPlex. You (the admin) always see everything. Saved on this box.');
  const ambience = useAmbience();
  foot.textContent = '▲▼ choose · OK to set categories · Back to leave';
  const list = settingList(el, 320);
  let users = [];
  let categories = [];

  function build(keep) {
    list.set(users.map(u => ({
      label: u.title + (u.admin ? '  (admin)' : '') + (u.restricted ? '  · managed' : ''),
      value: u.admin ? 'All categories' : limitLabel(allowedFor(u.uuid), categories.length),
      dim: u.admin,
      run: () => {
        if (u.admin) { toast('The admin always sees every category'); return; }
        router.push(VodCategoriesScreen(u, categories));
      },
    })), keep);
  }

  async function load() {
    setText(status, 'Loading profiles and categories…');
    try {
      const cfg = loadConfig();
      const [u, c] = await Promise.all([homeUsers(), new XtreamClient(cfg).categories()]);
      users = u.filter(x => x.uuid);
      categories = c;
      if (!users.length) {
        setText(status, 'This Plex account has no Home profiles. Add profiles for your children in Plex (Settings → Plex Home), then come back here.');
        return;
      }
      const admin = users.find(x => x.admin);
      setText(status, admin && !admin.protected ?
        'Tip: give your admin profile a PIN in Plex, or anyone can switch to it and see every category.' : '');
      build(false);
    } catch (e) {
      setText(status, 'Couldn\'t load: ' + (e.status != null ? friendlyError(e) : e.message));
    }
  }
  load();

  return {
    el,
    name: 'vod-profiles',
    onShow() { ambience.restore(); if (users.length) build(true); },
    onKey(action) {
      if (action === 'up') { list.move(-1); return true; }
      if (action === 'down') { list.move(1); return true; }
      if (action === 'pageup') { list.move(-VISIBLE); return true; }
      if (action === 'pagedown') { list.move(VISIBLE); return true; }
      if (action === 'enter') { const it = list.current(); if (it) it.run(); return true; }
      return false;
    },
  };
}

// Ticks for one profile. Changes are saved as they are made.
export function VodCategoriesScreen(user, categories) {
  const { el, introEl, status, foot } = screenShell(user.title,
    'Limit which film categories ' + user.title + ' sees. With a limit on, categories added later stay hidden until you tick them.');
  const ambience = useAmbience();
  foot.textContent = '▲▼ choose · OK tick / untick · CH ▲▼ page · Back when done';
  const list = settingList(el, 320);
  const saved = allowedFor(user.uuid);
  let limited = saved != null;
  const allowed = new Set(saved || []);

  function save() {
    setAllowed(user.uuid, user.title, limited ? [...allowed] : null);
    setText(status, limited ? limitLabel([...allowed], categories.length) + ' allowed' : 'No limit: every category, including new ones');
  }

  function turnOn() {
    if (limited) return;
    limited = true;
    allowed.clear();          // safe start: nothing until ticked
  }

  function build(keep) {
    const items = [
      { label: 'Limit categories', value: limited ? 'On' : 'Off — sees everything',
        run: () => { if (limited) { limited = false; } else turnOn(); save(); build(true); } },
      { label: 'Tick every category', value: '', run: () => { turnOn(); categories.forEach(c => allowed.add(String(c.id))); save(); build(true); } },
      { label: 'Untick every category', value: '', run: () => { turnOn(); allowed.clear(); save(); build(true); } },
    ].concat(categories.map(c => ({
      label: c.name,
      value: !limited ? '' : allowed.has(String(c.id)) ? '✓ Allowed' : 'Hidden',
      dim: !limited,
      run: () => {
        turnOn();
        const id = String(c.id);
        if (allowed.has(id)) allowed.delete(id); else allowed.add(id);
        save();
        build(true);
      },
    })));
    list.set(items, keep);
  }

  if (!categories.length) setText(introEl, 'No film categories came back from Dispatcharr, so there is nothing to choose yet.');
  build(false);
  setText(status, limited ? limitLabel([...allowed], categories.length) + ' allowed' : 'No limit: every category, including new ones');

  return {
    el,
    name: 'vod-categories',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { list.move(-1); return true; }
      if (action === 'down') { list.move(1); return true; }
      if (action === 'pageup') { list.move(-VISIBLE); return true; }
      if (action === 'pagedown') { list.move(VISIBLE); return true; }
      if (action === 'enter') { const it = list.current(); if (it) it.run(); return true; }
      return false;
    },
  };
}
