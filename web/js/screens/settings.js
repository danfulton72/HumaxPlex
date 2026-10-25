// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { deviceInfo } from '../platform/device.js';
import { h, toggleClass } from '../util/dom.js';
import { session, signOut, useServer, activateHomeUser, isAdmin, ensureUserRole } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { homeRequest, homeUsers, userLabel } from '../plex/home.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { useAmbience } from '../ui/backdrop.js';
import * as store from '../util/store.js';
import { showOptions, toast } from '../ui/options.js';
import { VodSetupScreen } from './vodsetup.js';
import { loadConfig as vodConfig } from '../xtream/api.js';

const START_LABELS = { home: 'Home', guide: 'Live TV guide', channel: 'Live TV: last channel' };

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  const list = h('div', 'settings-list', el);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'EasyPlex ' + (deviceInfo().appVersion || VERSION) + (DEV ? ' (dev)' : '') + ' · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  let index = 0;
  let items = [];
  let choosingUser = false;
  async function switchUser() {
    try {
      const users = await homeUsers();
      if (!users.length) throw new Error('No Plex Home profiles found');
      choosingUser = true;
      list.innerHTML = '';
      items = users.map(u => ({
        label: userLabel(u), value: u.protected ? 'PIN required' : 'Select',
        run: async () => {
          try {
            let pin = '';
            if (u.protected || u.hasPassword || u.pin) {
              pin = window.prompt('Enter Plex Home PIN for ' + userLabel(u)) || '';
              if (!pin) return;
              if (!/^\d{4}$/.test(pin)) throw new Error('Enter a four digit PIN');
            }
            const switched = await homeRequest('/api/home/users/' + u.id + '/switch',
              { method:'POST', pin });
            const token = switched.authenticationToken || switched.authToken ||
              (switched.user && switched.user.authToken);
            if (!token) throw new Error('Plex returned no profile token');
            activateHomeUser(token, u);
            const servers = await getServers(token);
            if (servers.length) {
              const uri = await connect(servers[0]);
              useServer(servers[0], uri);
            }
            restart();
          } catch (e) { foot.textContent = e.message; }
        },
      }));
      index = 0;
      items.forEach(it => {
        it.el = h('div', 'setting', list);
        h('span', 'setting-label', it.el).textContent = it.label;
        h('span', 'setting-value', it.el).textContent = it.value;
      });
      render();
    } catch (e) { foot.textContent = e.message; }
  }

  function build() {
    list.innerHTML = '';
    items = [
      { label: 'Server', value: session.server ? session.server.name : '—', run: switchServer },
      { label: 'Plex user', value: session.user ? session.user.title : '—', run: switchUser, action: 'Switch user' },
      { label: 'Unlink Plex account', value: 'Sign out', run: doSignOut },
      { label: 'Start screen', value: START_LABELS[store.get('startScreen', 'home')] || 'Home', run: chooseStart },
      isAdmin() ? {
        label: 'Dispatcharr VOD', value: vodConfig() ? vodConfig().username + ' @ ' + vodConfig().server.replace(/^https?:\/\//, '') : 'Not set up',
        run: () => router.push(VodSetupScreen({ onSaved: build })),
      } : {
        label: 'Dispatcharr VOD', value: 'Managed by the Plex admin',
        run: () => toast('Switch to the Plex admin profile to change VOD settings'),
      },
    ];
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    render();
  }

  function chooseStart() {
    const cur = store.get('startScreen', 'home');
    showOptions({
      title: 'Start screen', subtitle: 'What EasyPlex opens on',
      items: Object.keys(START_LABELS).map(k => ({
        label: START_LABELS[k], checked: k === cur, run: () => { store.set('startScreen', k); build(); },
      })),
    });
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
  }

  async function switchServer() {
    try {
      const servers = await getServers(session.token);
      if (servers.length === 1) {
        const uri = await connect(servers[0]);
        useServer(servers[0], uri);
        restart();
        return;
      }
      router.push(ServerPicker({ servers, onDone: restart }));
    } catch (e) {
      error('server list failed', e);
    }
  }

  function doSignOut() {
    signOut();
    restart();
  }

  function restart() {
    // Rebuild from scratch: app.js decides between login and home.
    window.dispatchEvent(new Event('easyplex:restart'));
  }

  build();
  ensureUserRole().then(() => { if (!choosingUser) build(); });

  return {
    el,
    name: 'settings',
    onShow() { ambience.restore(); if (!choosingUser) build(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      if (action === 'back' && choosingUser) { choosingUser = false; index = 0; build(); return true; }
      return false;
    },
  };
}
