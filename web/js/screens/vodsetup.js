// Settings → Dispatcharr VOD: the Xtream server address and the user's Xtream
// output login (set per user in Dispatcharr's Users tab). OK on a field opens
// the TV keyboard; "Test and save" signs in before anything is stored.
import { h, setText, toggleClass } from '../util/dom.js';
import { session } from '../session.js';
import { useAmbience } from '../ui/backdrop.js';
import { toast } from '../ui/options.js';
import * as router from '../router.js';
import {
  loadConfig, saveConfig, clearConfig, normaliseServer, XtreamClient, friendlyError,
} from '../xtream/api.js';

const IME_DONE = 65376;
const IME_CANCEL = 65385;

// A Dispatcharr tuner added to Plex has a URI like http://host:9191/hdhr;
// the Xtream service lives at the same address.
export async function guessServer(server) {
  try {
    const d = await server.get('/livetv/dvrs');
    const dvrs = d.Dvr || d.DVR || d.Directory || [];
    for (const dvr of dvrs) {
      for (const dev of dvr.Device || []) {
        if (dev.uri && /\/hdhr\/?$/i.test(dev.uri)) return normaliseServer(dev.uri);
      }
    }
  } catch (e) { /* no Live TV: leave it blank */ }
  return '';
}

export function VodSetupScreen({ onSaved } = {}) {
  const el = h('div', 'screen settings vod-setup');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Dispatcharr VOD';
  const intro = h('div', 'vod-setup-intro', el);
  intro.textContent = 'Films from Dispatcharr\'s Xtream Codes output. Use the Xtream login set for your user in Dispatcharr → Users.';
  const list = h('div', 'settings-list vod-setup-list', el);
  const status = h('div', 'vod-setup-status', el);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'OK on a field opens the keyboard · ▲▼ move · Back to leave';

  const saved = loadConfig() || { server: '', username: '', password: '' };

  function field(label, value, type) {
    const row = h('div', 'setting vod-field', list);
    h('span', 'setting-label', row).textContent = label;
    const input = h('input', 'vod-input', row);
    input.type = type || 'text';
    input.value = value || '';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    return { el: row, input, kind: 'input' };
  }
  function button(label, run) {
    const row = h('div', 'setting vod-button', list);
    h('span', 'setting-label', row).textContent = label;
    return { el: row, run, kind: 'button' };
  }

  const server = field('Server', saved.server, 'url');
  server.input.placeholder = 'http://dispatcharr:9191';
  const user = field('Username', saved.username);
  const pass = field('Password', saved.password, 'password');
  const items = [server, user, pass, button('Test and save', testAndSave)];
  if (loadConfig()) items.push(button('Remove VOD from EasyPlex', remove));

  let index = 0;
  let busy = false;
  let editing = null;

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
  }

  function say(text, ok) {
    setText(status, text);
    toggleClass(status, 'ok', !!ok);
  }

  function edit(it) {
    editing = it;
    it.input.focus();
    if (it.input.setSelectionRange) {
      const n = it.input.value.length;
      try { it.input.setSelectionRange(n, n); } catch (e) { /* type=url/password */ }
    }
  }
  function stopEditing(advance) {
    if (!editing) return;
    editing.input.blur();
    editing = null;
    if (advance) index = Math.min(items.length - 1, index + 1);
    render();
  }

  items.forEach(it => {
    if (it.kind !== 'input') return;
    it.input.addEventListener('keydown', e => {
      // The TV keyboard's Done / Cancel keys (OK and arrows arrive via onKey).
      if (e.keyCode === IME_DONE) { e.preventDefault(); stopEditing(true); }
      else if (e.keyCode === IME_CANCEL) stopEditing(false);
    });
    it.input.addEventListener('blur', () => { if (editing === it) { editing = null; render(); } });
  });

  async function testAndSave() {
    if (busy) return;
    const cfg = { server: normaliseServer(server.input.value), username: user.input.value.trim(), password: pass.input.value };
    if (!cfg.server) { say('Enter the server address, e.g. http://dispatcharr:9191'); index = 0; render(); return; }
    if (!cfg.username) { say('Enter your Xtream username.'); index = 1; render(); return; }
    server.input.value = cfg.server;
    busy = true;
    say('Signing in to ' + cfg.server + '…');
    try {
      const client = new XtreamClient(cfg);
      await client.auth();
      const cats = await client.categories();
      saveConfig(cfg);
      say('Connected · ' + cats.length + ' film categories', true);
      toast('Dispatcharr VOD is set up — find it on the home bar');
      if (onSaved) onSaved();
      setTimeout(() => { if (router.top() && router.top().el === el) router.back(); }, 900);
    } catch (e) {
      say('Not saved: ' + friendlyError(e));
    } finally {
      busy = false;
    }
  }

  function remove() {
    clearConfig();
    toast('Dispatcharr VOD removed');
    if (onSaved) onSaved();
    router.back();
  }

  if (!saved.server && session.server) {
    guessServer(session.server).then(uri => {
      if (uri && !server.input.value) { server.input.value = uri; say('Server filled in from your Plex Live TV tuner.'); }
    });
  }
  render();

  return {
    el,
    name: 'vod-setup',
    onShow() { ambience.restore(); render(); },
    onHide() { if (editing) stopEditing(false); },
    onKey(action) {
      if (editing) {
        if (action === 'enter') stopEditing(true);
        else if (action === 'up' || action === 'down') {
          stopEditing(false);
          index = Math.max(0, Math.min(items.length - 1, index + (action === 'down' ? 1 : -1)));
          render();
        } else if (action === 'back') stopEditing(false);
        return true;
      }
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') {
        const it = items[index];
        if (it.kind === 'input') edit(it); else it.run();
        return true;
      }
      return false;
    },
  };
}
