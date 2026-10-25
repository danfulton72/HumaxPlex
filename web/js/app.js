// Boot: restore the session and go straight to Home when we can; otherwise sign in.
import { DEV, DEV_HOST, DEV_PLEX_URL, VERSION } from './config.js';
import * as router from './router.js';
import { inject } from './input.js';
import { session, reconnect, signOut } from './session.js';
import { HomeScreen } from './screens/home.js';
import { LoginScreen } from './screens/login.js';
import { initHud } from './ui/hud.js';
import { log, warn } from './util/log.js';
import * as nav from './nav.js';
import * as store from './util/store.js';

function goHome() {
  router.reset(HomeScreen());
}

function goLogin() {
  router.reset(LoginScreen({ onDone: goHome }));
}

async function verify() {
  // Home already painted from cache; make sure the saved connection still works.
  try {
    await session.server.get('/identity');
  } catch (e) {
    if (e.status === 401) { signOut(); goLogin(); return; }
    warn('saved server unreachable, re-resolving', e.message);
    try {
      await reconnect();
      goHome();
    } catch (err) {
      if (err.status === 401) { signOut(); goLogin(); }
    }
  }
}

// The UI is laid out for the TV's fixed 1920×1080 viewport. In a desktop
// browser, zoom it to fit the window and center it. zoom (not a transform)
// re-renders text and images at the window's real resolution.
function fitWindow() {
  const root = document.documentElement;
  const body = document.body;
  // Some Android TV WebViews report physical-size innerWidth but logical-size
  // screen.width (e.g. inner=1920x1080, screen=960x540, DPR=2), so use the smaller.
  const w = Math.min(window.innerWidth, window.screen.width || window.innerWidth);
  const h = Math.min(window.innerHeight, window.screen.height || window.innerHeight);
  const scale = Math.min(w / 1920, h / 1080);
  root.style.zoom = '1';
  root.style.width = w + 'px';
  root.style.height = h + 'px';
  root.style.position = 'static';
  root.style.margin = '0';
  body.style.width = '1920px';
  body.style.height = '1080px';
  body.style.transformOrigin = 'top left';
  body.style.transform = 'translate(' + ((w - 1920 * scale) / 2) + 'px,' + ((h - 1080 * scale) / 2) + 'px) scale(' + scale + ')';
}

function start() {
  // A release build installed over a dev build must not inherit its LAN shortcut.
  if (!DEV && session.token === 'lan-dev') {
    signOut();
    store.set('hud', undefined);
  }
  if (DEV && DEV_PLEX_URL && !session.token) {
    // Dev shortcut for servers that allow unauthenticated LAN access.
    store.set('token', 'lan-dev');
    store.set('user', { title: 'LAN (dev)' });
    store.set('server', { uri: DEV_PLEX_URL, token: '', name: 'Plex (LAN dev)', id: 'lan-dev' });
    location.reload();
    return;
  }
  if (session.token && session.server) {
    goHome();
    verify();
  } else {
    goLogin();
  }
}

export function boot() {
  if (DEV) window.__ss = { router, session, nav };
  log('boot', VERSION, navigator.userAgent);
  window.__androidAction = inject;
  fitWindow();
  window.addEventListener('resize', fitWindow);
  router.init(document.getElementById('app'));
  initHud(() => (router.top() && router.top().name) || '');
  window.addEventListener('easyplex:restart', start);
  start();
  const splash = document.getElementById('splash');
  setTimeout(() => {
    splash.classList.add('gone');
    setTimeout(() => splash.parentNode && splash.parentNode.removeChild(splash), 400);
  }, 500);
}
