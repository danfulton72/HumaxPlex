#!/usr/bin/env python3
"""Copy upstream SamSUCKS web UI and adapt for Android 9."""
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1]).resolve()
dest = Path(sys.argv[2]).resolve()
assert (source / "app/js/screens/player.js").is_file(), "Expected upstream SamSUCKS checkout"
if dest.exists():
    shutil.rmtree(dest)
shutil.copytree(source / "app", dest)

def edit(path, old, new):
    f = dest / path
    data = f.read_text(encoding="utf-8")
    if old not in data:
        raise RuntimeError("Upstream has changed; patch no longer applies: " + path)
    f.write_text(data.replace(old, new), encoding="utf-8")

edit("index.html", '<script src="$WEBAPIS/webapis/webapis.js"></script>', "")
edit("index.html", "<title>SamSUCKS</title>", "<title>HumaxPlex</title>")
# Android WebView must expose its *actual* CSS viewport, not claim a 1920px viewport.
# app.js fitWindow() then scales the 1920x1080 UI to the measured device size.
edit("index.html", 'content="width=1920, height=1080"',
     'content="width=device-width, initial-scale=1.0, maximum-scale=1.0"')
edit("js/app.js", "import { isTizen, registerKeys } from './platform/tizen.js';",
     "import { isTizen, registerKeys } from './platform/tizen.js';\nimport { inject } from './input.js';".replace("\\n", "\n"))
edit("js/app.js", "  registerKeys();", "  registerKeys();\n  window.__androidAction = inject;".replace("\\n", "\n"))
edit("js/platform/tizen.js", "return { model, name, platform: isTizen ? 'Samsung' : 'Web' };",
     "return { model: 'FVP-4KGTR', name: 'Humax FVP-4KGTR', platform: 'Android' };")
edit("js/plex/client.js", "'X-Plex-Platform-Version': '6.5',", "'X-Plex-Platform-Version': '9',")
edit("js/plex/client.js", "export const PRODUCT = 'SamSUCKS';", "export const PRODUCT = 'HumaxPlex';")
edit("js/screens/player.js",
     "  container: { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 },\n  video: { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 },\n  audio: { aac: 1, ac3: 1, eac3: 1, mp3: 1, mp2: 1, flac: 1, opus: 1, vorbis: 1, pcm: 1 },".replace("\\n","\n"),
     "  container: { mp4: 1, m4v: 1, mkv: 1 },\n  video: { h264: 1, hevc: 1 },\n  audio: { aac: 1, ac3: 1, eac3: 1, mp3: 1 },".replace("\\n","\n"))

old = """function fitWindow() {
  const root = document.documentElement;
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.position = 'relative'; // so the margins below move #app too
  root.style.zoom = s;
  root.style.marginLeft = Math.max(0, (innerWidth - 1920 * s) / 2 / s) + 'px';
  root.style.marginTop = Math.max(0, (innerHeight - 1080 * s) / 2 / s) + 'px';
}"""
new = """function fitWindow() {
  const root = document.documentElement;
  const body = document.body;
  // Some Android TV WebViews report physical-size innerWidth but logical-size screen.width.
  // This Humax reports inner=1920x1080, screen=960x540, DPR=2.
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
}"""
edit("js/app.js", old, new)


edit("js/ui/images.js", """    const loader = new Image();
    loader.src = job.url;""", "    const loader = new Image();")

# WebView's Image.decode() can fail or stall on Humax despite normal img.onload.
# Prefer native image onload/onerror, and show a fallback failure marker in logs.
edit("js/ui/images.js",
     """    if (loader.decode) loader.decode().then(() => done(true), () => done(false));
    else { loader.onload = () => done(true); loader.onerror = () => done(false); }""",
     """    loader.onload = () => done(true);
    loader.onerror = () => { console.warn('HumaxPlex image load failed', job.url.split('?')[0]); done(false); };
    loader.src = job.url;""")

# Also fix hero artwork, which independently calls Image.decode().
edit("js/ui/backdrop.js",
     "    if (loader.decode) loader.decode().then(swap, () => {});\n    else loader.onload = swap;",
     "    loader.onload = swap;")


# Android WebView can reject Plex's /photo/:/transcode resources even while
# its JSON API works. Test original authenticated media artwork URLs directly.
# Keep upstream's resized transcoder URLs unchanged on Samsung/Tizen.
edit("js/plex/server.js",
     "    if (!path) return '';",
     """    if (!path) return '';
    if (typeof HumaxVideo !== 'undefined') {
      return 'https://appassets.androidplatform.net/pleximg?url=' + encodeURIComponent(this.url(path));
    }""")

# Report image failures to the on-screen diagnostic without logging authentication tokens.
edit("js/ui/images.js",
     "console.warn('HumaxPlex image load failed', job.url.split('?')[0]);",
     "console.warn('HumaxPlex image load failed', job.url.split('?')[0]); if (typeof HumaxVideo !== 'undefined') HumaxVideo.imageFailed(job.url.split('?')[0]);")
edit("js/ui/backdrop.js", "    loader.onload = swap;",
     "    loader.onload = swap;\n    loader.onerror = () => { if (typeof HumaxVideo !== 'undefined') HumaxVideo.imageFailed(url.split('?')[0]); };")

# Ignore Plex's previously selected subtitle stream when starting a new item.
# Media3's subtitle menu can explicitly enable a supported text track later.
edit("js/screens/player.js",
     "      subStream = streamsOf(part, 3).find(s => s.selected) || null;",
     "      subStream = null;")


# Allow the native quality menu to request real Plex stream changes. A quality
# change restarts the same item at the current position using a new transcode.
edit("js/screens/player.js",
     "  let mode = 'direct';",
     """  let mode = 'direct';
  let humaxQuality = null;
  window.__humaxSetQuality = (bitrate, resolution) => {
    if (!alive || !media || !part) return;
    humaxQuality = bitrate > 0 ? { bitrate, resolution } : null;
    mode = humaxQuality ? 'hls' : decideMode();
    triedFallback = false;
    open(position).catch(e => failed(e.message || String(e)));
  };""")
edit("js/screens/player.js",
     """        audioStreamID: audioStream && audioStream.id,
        subtitleStreamID: burn ? subStream.id : undefined,""",
     """        audioStreamID: audioStream && audioStream.id,
        subtitleStreamID: burn ? subStream.id : undefined,
        maxBitrate: humaxQuality ? humaxQuality.bitrate : 40000,
        resolution: humaxQuality ? humaxQuality.resolution : '3840x2160',""")
edit("js/screens/player.js", "    player.destroy();",
     "    if (window.__humaxSetQuality) delete window.__humaxSetQuality;\n    player.destroy();")

# Plex uses the /link/?pin= URL for short four-character TV link codes.
# The generic app.plex.tv/auth route is intended for a different auth flow.
edit("js/plex/auth.js",
     """  return 'https://app.plex.tv/auth#?' + query({
    clientID: clientId,
    code,
    'context[device][product]': PRODUCT,
  });""",
     """  return 'https://plex.tv/link/?pin=' + encodeURIComponent(code);""")

# Media3 backend delegates HLS/MP4 playback to Android, not Android WebView.
native_backend = """
function humaxBackend(container, listener) {
  let currentTime = 0;
  let currentState = 'NONE';
  let ready = null;
  let timer = 0;
  window.__humaxVideoEvent = (name, value) => {
    if (name === 'ready') {
      currentState = 'PLAYING';
      if (ready) { ready(); ready = null; }
    } else if (name === 'buffer') {
      listener.onBuffering(value);
    } else if (name === 'error') {
      if (ready) { ready(new Error(value)); ready = null; }
      else listener.onError(value);
    } else if (name === 'end') {
      listener.onEnd();
    } else if (name === 'time') {
      currentTime = value;
      listener.onTime(value);
    }
  };
  return {
    open(url) { HumaxVideo.open(url); },
    prepare() {
      return new Promise((resolve, reject) => {
        ready = err => err ? reject(err) : resolve();
      });
    },
    play() { currentState = 'PLAYING'; HumaxVideo.play(); },
    pause() { currentState = 'PAUSED'; HumaxVideo.pause(); },
    seek(ms) { HumaxVideo.seek(Math.max(0, Math.floor(ms))); return Promise.resolve(); },
    time() { return currentTime; },
    state() { return currentState; },
    tracks() { return { audio: [], text: [] }; },
    selectAudio() { return false; },
    selectText() { return false; },
    suspend() { HumaxVideo.pause(); },
    restore() {},
    close() { currentState = 'NONE'; HumaxVideo.close(); },
    destroy() { HumaxVideo.close(); delete window.__humaxVideoEvent; },
  };
}

"""
f = dest / "js/platform/player.js"
player_code = f.read_text(encoding="utf-8")
player_code = native_backend + player_code
player_code = player_code.replace(
    "  if (typeof webapis !== 'undefined' && webapis.avplay) return avplayBackend(container, listener);",
    "  if (typeof HumaxVideo !== 'undefined') return humaxBackend(container, listener);\n  if (typeof webapis !== 'undefined' && webapis.avplay) return avplayBackend(container, listener);"
)
f.write_text(player_code, encoding="utf-8")



# Keep the original authorised Plex Home account token when switching profiles.
edit("js/session.js",
     "  token: store.get('token'),",
     "  token: store.get('token'),\n  rootToken: store.get('rootToken') || store.get('token'),")
edit("js/session.js",
     "  session.token = token;\n  session.user =",
     "  session.token = token;\n  session.rootToken = token;\n  store.set('rootToken', token);\n  session.user =")
edit("js/session.js",
     "export function useServer(resource, uri) {",
     """export function activateHomeUser(token, user) {
  session.token = token;
  session.user = { title: user.title || user.username, thumb: user.thumb, uuid: user.uuid };
  session.server = null;
  store.set('token', token);
  store.set('user', session.user);
  store.set('server', undefined);
  store.set('homeCache', undefined);
}

export function useServer(resource, uri) {""")
edit("js/session.js",
     "  session.token = null;\n  session.user = null;",
     "  session.token = null;\n  session.rootToken = null;\n  store.set('rootToken', undefined);\n  session.user = null;")

# Plex Home fast user switching with a separate persistent master token.
# PIN-protected users prompt for their four-digit Plex Home PIN; no bypass.
edit("js/screens/settings.js",
     "import { session, signOut, useServer } from '../session.js';",
     "import { session, signOut, useServer, activateHomeUser } from '../session.js';")
edit("js/screens/settings.js",
     "import { getServers, connect } from '../plex/auth.js';",
     "import { getServers, connect } from '../plex/auth.js';\nimport { request, identity } from '../plex/client.js';")
edit("js/screens/settings.js",
     "  let items = [];",
     """  let items = [];
  let choosingUser = false;
  function userLabel(user) { return user.title || user.username || user.name || 'Plex user'; }
  async function homeRequest(url, { method = 'GET', pin } = {}) {
    const response = await fetch('https://plex.tv' + url +
      (pin ? '?pin=' + encodeURIComponent(pin) : ''), {
        method,
        headers: Object.assign({ Accept: 'application/json' }, identity(), {
          'X-Plex-Token': session.rootToken || session.token,
        }),
      });
    if (!response.ok) throw new Error('Plex user switch failed (HTTP ' + response.status + ')');
    const body = await response.text();
    if (body.trim().startsWith('<')) {
      const root = new DOMParser().parseFromString(body, 'application/xml').documentElement;
      return {
        users: Array.from(root.querySelectorAll('user')).map(el => ({
          id: el.getAttribute('id'), title: el.getAttribute('title') || el.getAttribute('username'),
          protected: el.getAttribute('protected') === '1',
        })),
        authenticationToken: root.getAttribute('authenticationToken'),
      };
    }
    return JSON.parse(body);
  }
  async function switchUser() {
    try {
      const result = await homeRequest('/api/v2/home/users');
      const users = Array.isArray(result) ? result : (result.users || result.User || []);
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
              if (!/^\\d{4}$/.test(pin)) throw new Error('Enter a four digit PIN');
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
  }""")
edit("js/screens/settings.js",
     "      { label: 'Signed in as', value: session.user ? session.user.title : '—', run: doSignOut, action: 'Sign out' },",
     """      { label: 'Plex user', value: session.user ? session.user.title : '—', run: switchUser, action: 'Switch user' },
      { label: 'Unlink Plex account', value: 'Sign out', run: doSignOut },""")
edit("js/screens/settings.js",
     "      if (action === 'enter') { items[index].run(); return true; }",
     """      if (action === 'enter') { items[index].run(); return true; }
      if (action === 'back' && choosingUser) { choosingUser = false; index = 0; build(); return true; }""")

# HumaxPlex branding in the Home header and Settings footer.
edit("js/screens/home.js",
     "  h('img', 'brand-wordmark', brandText).src = 'img/wordmark.png';",
     "  h('div', 'humax-wordmark', brandText).textContent = 'HumaxPlex';")
edit("js/screens/home.js",
     "  h('div', 'brand-by', brandText).textContent = 'by rfaile313';",
     "  h('div', 'brand-by', brandText).textContent = 'Plex for Humax';")
edit("js/screens/settings.js", "'SamSUCKS ' + VERSION", "'HumaxPlex ' + VERSION")

# Follow the focused season: the pill row can extend arbitrarily far horizontally.
edit("js/screens/detail.js",
     "    if (episodes) episodes.row.setActive(zone === 'episodes');",
     """    if (seasons[seasonIndex] && seasons[seasonIndex].el) {
      const pill = seasons[seasonIndex].el;
      const clip = seasonsEl;
      const left = pill.offsetLeft;
      const right = left + pill.offsetWidth;
      const visible = clip.clientWidth || 1600;
      if (left < clip.scrollLeft + 24) clip.scrollLeft = Math.max(0, left - 24);
      else if (right > clip.scrollLeft + visible - 24)
        clip.scrollLeft = Math.max(0, right - visible + 24);
    }
    if (episodes) episodes.row.setActive(zone === 'episodes');""")


# The guide source has its own provider ID, which need not equal /livetv/dvrs id.
# Plex's /media/providers exposes the actual tv.plex.providers.epg.* identifiers.
# Ask for both the watch-now listings and configured-channel lineup.
# A focusable alphabet rail on the right of A-Z libraries. CH up/down still
# works; press Right from the rightmost grid column, then Up/Down to choose.
edit("js/screens/library.js",
     "  const hint = h('div', 'lib-hint', el);",
     """  const alphaRail = h('div', 'humax-alpha', el);
  const hint = h('div', 'lib-hint', el);""")
edit("js/screens/library.js",
     "  let generation = 0;",
     """  let generation = 0;
  let alphaMode = false;
  let alphaIndex = 0;
  function paintAlpha() {
    alphaRail.innerHTML = '';
    alphaRail.style.display = letters.length ? '' : 'none';
    letters.forEach((l, i) => {
      const node = h('div', 'humax-alpha-letter', alphaRail);
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
  }""")
edit("js/screens/library.js",
     "    } catch (e) { /* letter jump just won't work */ }",
     "      paintAlpha();\n    } catch (e) { /* letter jump just won't work */ }")
edit("js/screens/library.js",
     "    generation++;",
     "    generation++;\n    alphaMode = false;\n    alphaRail.style.display = 'none';")
edit("js/screens/library.js",
     "    onKey(action) {\n      switch (action) {",
     """    onKey(action) {
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
      switch (action) {""")
edit("js/screens/library.js", "        case 'left': grid.move(-1, 0); return true;",
     "        case 'left': grid.move(-1, 0); paintAlpha(); return true;")
edit("js/screens/library.js", "        case 'right': grid.move(1, 0); return true;",
     "        case 'right': grid.move(1, 0); paintAlpha(); return true;")

css = dest / "css/app.css"
css.write_text(css.read_text(encoding="utf-8") + """
/* Humax remote navigation fixes */
.humax-wordmark { color:#f3b234; font: 800 45px/1.05 var(--display); white-space:nowrap; }
.detail-seasons {
  display:flex; gap:12px; overflow-x:auto; overflow-y:hidden;
  max-width:1620px; width:1620px;
  scrollbar-width:none; scroll-behavior:smooth;
}
.detail-seasons .pill { flex:0 0 auto; }
.detail-buttons { overflow-x:auto; max-width:1620px; scrollbar-width:none; }
.humax-alpha {
  position:absolute; right:25px; top:200px; height:830px; width:58px;
  display:flex; flex-direction:column; justify-content:space-around;
  align-items:center; border-radius:18px; background:rgba(15,20,29,.82);
  z-index:18;
}
.humax-alpha-letter { font:600 24px var(--body); color:#c3c8d0; padding:0 10px; }
.humax-alpha-letter.selected { color:#f8be41; }
.humax-alpha-letter.focus { color:#fff; border-radius:6px; background:#b12b47; }
""", encoding="utf-8")



# Reuse the launcher pirate-P artwork inside the web-based UI.
logo_source = Path(__file__).resolve().parents[1] / "android/app/src/main/res/drawable-nodpi/humaxplex_logo.jpg"
if logo_source.is_file():
    shutil.copy2(logo_source, dest / "img/humaxplex-logo.jpg")

# Brand the splash and sign-in UI without disturbing the working Plex QR flow.
edit("index.html",
     '<div id="splash"><img src="img/splash.png" alt=""></div>',
     '<div id="splash"><div class="humax-splash-brand"><img class="humax-pirate-logo" src="img/humaxplex-logo.jpg" alt=""><strong>Humax<span>Plex</span></strong><small>PLEX FOR HUMAX</small></div></div>')
edit("js/screens/login.js",
     "  art.src = 'img/mascot-512.png';",
     """  art.style.display = 'none';
  const welcome = h('div', 'humax-login-brand', left);
  welcome.innerHTML = '<span class="humax-pirate">☠</span><strong>Humax<span>Plex</span></strong><small>PLEX FOR HUMAX</small>';""")
edit("js/screens/login.js",
     "  h('h1', 'login-title', panel).textContent = 'Sign in to Plex';",
     "  h('h1', 'login-title', panel).textContent = 'Link HumaxPlex to Plex';")
css.write_text(css.read_text(encoding="utf-8") + """
.humax-splash-brand,.humax-login-brand { display:flex; flex-direction:column; align-items:center;
 justify-content:center; gap:20px; color:#fff; }
.humax-splash-brand { position:absolute; inset:0; background:#10141d; }
.humax-login-brand { width:100%; height:100%; }
.humax-splash-brand strong,.humax-login-brand strong { font:800 108px/1 var(--display); letter-spacing:-4px; }
.humax-splash-brand strong span,.humax-login-brand strong span { color:#e6af30; }
.humax-pirate-logo { width:180px; height:180px; object-fit:contain; border-radius:26px; }
.humax-splash-brand small,.humax-login-brand small { font:500 24px var(--body); color:#a9b0bd; letter-spacing:9px; }
""", encoding="utf-8")

# Initial Plex DVR guide. Server-owned tuners/EPG only, not the Humax tuner.
live_js = """import { h, setText } from '../util/dom.js';
import { session } from '../session.js';
import { useAmbience } from '../ui/backdrop.js';
import * as router from '../router.js';
import { identity } from '../plex/client.js';

export function LiveTvScreen() {
  const el = h('div', 'screen settings humax-live');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Live TV & DVR';
  const info = h('div', 'humax-live-status', el);
  const list = h('div', 'humax-live-list', el);
  const details = h('div', 'humax-live-detail', el);
  let entries = [], index = 0, busy = false, alive = true;\n  let providers = [], dayOffset = 0, view = 'now', guideChannel = null, dvrs = [];
  let debugResponses = [], diagnostic = null, debugPage = 0;
  const allowed = /^(type|title|grandparentTitle|channelTitle|channelCallSign|channelName|channelIdentifier|channelVcn|channelNumber|gridKey|guideKey|ratingKey|key|id|identifier|source|providerIdentifier|epgSource|beginsAt|endsAt|startTime|duration|onAir|Media|Channel|Metadata|Airing|Directory|Dvr|DVR|MediaProvider|Feature|totalSize|size|status|protocol|decision|mediaType|partIndex|index)$/;
  function safeObject(value, depth = 0) {
    if (depth > 3) return '[nested]';
    if (Array.isArray(value)) return value.slice(0, 3).map(v => safeObject(v, depth+1));
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach(k => { if (allowed.test(k)) output[k] = safeObject(value[k], depth+1); });
      return output;
    }
    return typeof value === 'string' ? value.slice(0, 100).replace(/(X-Plex-Token|token|authorization)=[^& ]+/gi,'[redacted]') : value;
  }
  function showDebug() {
    if (!diagnostic) {
      diagnostic = h('div', 'humax-live-debug', el);
      const heading = h('div', 'humax-debug-title', diagnostic);
      heading.textContent = 'Live TV diagnostics — photos: Page Up/Down · Back closes';
      h('pre', 'humax-debug-content', diagnostic);
    }
    view = 'debug'; diagnostic.style.display = '';
    const selected = entries[index];
    const cards = [
      ['Selected programme', selected ? {fields:Object.keys(selected.item || {}), mediaFields:Object.keys(selected.item?.Media?.[0] || {}), channelFields:Object.keys(selected.item?.Channel?.[0] || {}), values:safeObject(selected.item)} : 'none'],
      ['Selected channel', selected ? safeObject({channelTitle:selected.channel, gridKey:selected.gridKey, channelIdentifier:selected.channelId, channelVcn:selected.channelVcn}) : 'none'],
      ['Plex DVRs', dvrs.map(d=>safeObject(d))],
      ['EPG providers', providers],
      ...debugResponses.map((r,i)=>['Endpoint '+(i+1)+' '+r.name, r.data]),
    ];
    debugPage = Math.max(0, Math.min(debugPage, cards.length - 1));
    diagnostic.querySelector('pre').textContent =
      'PAGE '+(debugPage+1)+' / '+cards.length+'\\n'+cards[debugPage][0]+'\\n\\n'+
      JSON.stringify(cards[debugPage][1], null, 2).slice(0,3200);
  }

  const server = session.server;
  function focus() {
    Array.from(list.children).forEach((node, i) => node.classList.toggle('focus', i === index));
    const e = entries[index];
    if (e) setText(details, e.subtitle);
    const node = list.children[index];
    if (node) node.scrollIntoView({ block:'nearest' });
  }
  function render() {
    list.innerHTML = '';
    entries.forEach(e => {
      const row = h('div', 'humax-live-row', list);
      h('span', 'humax-live-channel', row).textContent = e.channel;
      h('span', 'humax-live-show', row).textContent = e.title;
    });
    focus();
  }
  async function load() {
    setText(info, 'Checking Plex DVR and programme guide…');
    try {
      const d = await server.get('/livetv/dvrs');
      dvrs = d.Dvr || d.DVR || d.Directory || [];
      if (!dvrs.length) {
        setText(info, 'No Plex DVR found. Configure a supported tuner in Plex Media Server → Live TV & DVR.');
        return;
      }
      const prefixes = new Set();
      try {
        const providers = await server.get('/media/providers');
        const all = providers.MediaProvider || providers.Directory || [];
        const walk = obj => {
          if (!obj || typeof obj !== 'object') return;
          for (const field of ['identifier','id','key']) {
            const value = String(obj[field] || '');
            const match = value.match(/tv\\.plex\\.providers\\.epg\\.(?:cloud|xmltv|custom):\\d+/);
            if (match) prefixes.add('/' + match[0]);
          }
          for (const [key,value] of Object.entries(obj)) {
            if (key === 'Feature' || key === 'Directory' || key === 'MediaProvider' || key === 'Pivot') {
              for (const child of Array.isArray(value) ? value : []) walk(child);
            }
          }
        };
        all.forEach(walk);
      } catch (e) { console.warn('Plex provider discovery:', e.message); }
      for (const dvr of dvrs) {
        for (const field of ['key','identifier','providerIdentifier']) {
          const match = String(dvr[field] || '').match(/tv\\.plex\\.providers\\.epg\\.(?:cloud|xmltv|custom):\\d+/);
          if (match) prefixes.add('/' + match[0]);
        }
      }
      providers = [...prefixes];\n      const urls = [];
      for (const prefix of prefixes) {
        urls.push(prefix + '/watchnow/all');
        urls.push(prefix + '/lineups/dvr/channels');
      }
      const replies = await Promise.allSettled(urls.map(url => server.get(url)));
      debugResponses = replies.map((r,i)=>({name:urls[i],data:r.status === 'fulfilled' ? {keys:Object.keys(r.value),sample:safeObject((r.value.Metadata || r.value.Channel || r.value.Directory || [])[0] || r.value)} : {error:String(r.reason?.message || 'request failed').slice(0,120)}}));
      const lineup = new Map();
      replies.forEach((reply,i) => {
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
      entries = [];
      replies.forEach((reply,ri) => {
        if (!urls[ri].includes('/watchnow/all')) return;
        if (reply.status !== 'fulfilled') return;
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
          entries.push({channel: (number ? number + '  ' : '') + label,
            title, subtitle: m.summary || m.grandparentTitle || title, item: m,\n            gridKey: channel.gridKey || lineup.get(String(channel.channelIdentifier || channel.channelVcn || '')),
            channelId: channel.channelIdentifier, channelVcn: channel.channelVcn,
            dvrId: String(dvrs[0]?.key || dvrs[0]?.id || '').replace(/^.*:/,'') });
        });
      });
      if (!alive) return;
      if (!entries.length) {
        setText(info, 'DVR found. EPG providers: ' + prefixes.size +
          ' · Successful guide requests: ' + replies.filter(r => r.status === 'fulfilled').length +
          '/' + replies.length + '. Channel listings unavailable; please report this line.');
        return;
      }
      setText(info, entries.length + ' programmes on now · OK: guide · Left: diagnostics · Right: recordings');
      render();
    } catch (e) {
      setText(info, 'Live TV unavailable: ' + e.message);
    }
  }
  async function openProgram() {
    const selected = entries[index];
    if (!selected) return;
    if (!selected.gridKey || !providers.length) {
      setText(details, 'Channel lineup did not provide a matching guide key. Open diagnostics for details.');
      return;
    }
    guideChannel = selected;
    await openGuide(0);
  }
  function formatAiringTime(m) {
    const raw = m.Media?.[0]?.beginsAt ?? m.beginsAt ?? m.Media?.[0]?.startTime ?? m.startTime ?? m.airingStart ?? m.start;
    if (raw == null || raw === '' || /^\\d{4}-\\d{2}-\\d{2}$/.test(String(raw))) return '--:--';
    let date;
    if (typeof raw === 'number' || /^\\d{10,13}$/.test(String(raw))) {
      const num = Number(raw);
      date = new Date(num < 100000000000 ? num * 1000 : num);
    } else date = new Date(raw);
    return Number.isNaN(date.getTime()) ? '--:--' :
      date.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false});
  }
  async function openGuide(delta) {
    view = 'guide'; dayOffset = Math.max(0, Math.min(7, delta));
    const date = new Date(Date.now()+dayOffset*86400000).toISOString().slice(0,10);
    setText(info, 'Guide: ' + guideChannel.channel + ' · '+ date + ' · Left/Right: day · Back: Now');
    setText(details, 'Loading channel schedule…');
    try {
      let mc = null;
      for (const prefix of providers) {
        try {
          mc = await server.get(prefix + '/grid', {channelGridKey:guideChannel.gridKey, date});
          if ((mc.Metadata || mc.Media || mc.Airing || []).length) break;
        } catch(e) {}
      }
      entries = (mc?.Metadata || mc?.Airing || mc?.Media || []).map(m => ({
        channel: formatAiringTime(m),
        title: m.title || m.grandparentTitle || 'Programme',
        subtitle: m.summary || m.title || '',
        item:m, gridKey:guideChannel.gridKey, channelId:guideChannel.channelId,
        channelVcn:guideChannel.channelVcn
      }));
      index=0; render();
      if (!entries.length) setText(details, 'No scheduled programmes received for this date.');
    } catch(e) { setText(details,'Guide request failed: '+e.message); }
  }
  async function showScheduled() {
    view = 'schedule';
    setText(info, 'DVR recording schedule · Left or Back: Now');
    try {
      const mc = await server.get('/media/subscriptions/scheduled');
      entries = (mc.Metadata || mc.MediaSubscription || mc.Directory || []).map(m => ({
        channel: m.channelTitle || 'Scheduled',
        title: m.title || m.grandparentTitle || 'Recording',
        subtitle: m.summary || m.title || '', item:m
      }));
      index=0; render();
      if (!entries.length) setText(details,'No scheduled recordings.');
    } catch(e) { setText(details,'Unable to load recordings: '+e.message); }
  }
  async function dvrPost(path, params = {}) {
    const url = server.url(path, params);
    const response = await fetch(url, {method:'POST',
      headers:Object.assign({Accept:'application/json','X-Plex-Token':server.token}, identity())});
    const body = await response.text();
    if (!response.ok) throw new Error('Plex HTTP '+response.status+' '+body.slice(0,140));
    try { const data=JSON.parse(body); return data.MediaContainer || data; }
    catch(e) { return {}; }
  }
  function playablePath(data) {
    const m=(data.Metadata || data.MediaContainer?.Metadata || [])[0] || data;
    const part=m.Media?.[0]?.Part?.[0];
    return part?.key || m.key || data.key || '';
  }
  async function tuneSelected() {
    const e = view === 'guide' ? guideChannel : entries[index];
    if (!e) return;
    const dvr = e.dvrId || String(dvrs[0]?.key || dvrs[0]?.id || '').replace(/^.*:/,'');
    const ids = [...new Set([e.channelId,e.channelVcn,e.gridKey,
      e.item?.Media?.[0]?.channelIdentifier,e.item?.Media?.[0]?.id]
      .filter(v=>v !== undefined && v !== null && String(v) !== '').map(String))];
    if (!/^\\d+$/.test(dvr) || !ids.length) {
      setText(details,'No numeric DVR ID or channel identifier; open diagnostics.'); return;
    }
    const results = [];
    setText(details,'Tuning '+e.channel+' via DVR '+dvr+'…');
    let data=null;
    for (const id of ids) {
      try {
        data=await dvrPost('/livetv/dvrs/'+encodeURIComponent(dvr)+
          '/channels/'+encodeURIComponent(id)+'/tune');
        results.push(id+':OK');
        break;
      } catch(err) { results.push(id+':'+String(err.message).match(/HTTP \\d+/)?.[0]); }
    }
    if (!data) {
      setText(details,'Tune rejected · DVR '+dvr+' · IDs '+results.join(' | ')+
        ' · Try official Plex channel again if it also fails.');
      return;
    }
    try {
      let key=playablePath(data);
      if (!key) {
        const sessions=await server.get('/livetv/sessions');
        key=playablePath(sessions);
      }
      if (!key || !key.startsWith('/')) {
        setText(details,'Tune OK ('+results.join(', ')+'), no playable media key. '+JSON.stringify(safeObject(data)).slice(0,400));
        return;
      }
      HumaxVideo.open(server.url(key));
      view='playing';
      setText(info,'Live TV · Back to close');
    } catch(err) {setText(details,'Tune OK but playback failed: '+err.message);}
  }
  async function recordSelected() {
    const e=entries[index];
    if (!e || !e.item?.guid) {setText(details,'No programme GUID for recording; see diagnostics.'); return;}
    try {
      const template=await server.get('/media/subscriptions/template',{guid:e.item.guid});
      const candidates=template.SubscriptionTemplate || [];
      if (!candidates.length) {setText(details,'Plex returned no recording template for this programme.'); return;}
      const t=candidates[0];
      const target=t.targetLibrarySectionID;
      const type=t.type;
      if (!target || type == null) {
        setText(details,'Recording template missing destination or type: '+JSON.stringify(safeObject(t)).slice(0,300));return;
      }
      if (!window.confirm('Schedule Plex DVR recording for '+e.title+'?')) return;
      const params={targetLibrarySectionID:target,type,
        'hints[ratingKey]':e.item.ratingKey,'hints[title]':e.title};
      if (t.params?.mediaProviderID) params['params[mediaProviderID]']=t.params.mediaProviderID;
      const result=await dvrPost('/media/subscriptions',params);
      setText(details,'Recording scheduled: '+e.title);
    } catch(e) {setText(details,'Recording failed: '+e.message);}
  }
  function showProgramActions() {
    const e=entries[index];
    if (!e)return;
    setText(details,e.title+' · OK: schedule recording · Play: tune channel');
    recordSelected();
  }
  load();
  return {
    el, name:'livetv', onShow(){ ambience.restore(); },
    onKey(action) {
      if (view === 'debug') {
        if (action === 'pageup' || action === 'up' || action === 'left') { debugPage--; showDebug(); return true; }
        if (action === 'pagedown' || action === 'down' || action === 'right') { debugPage++; showDebug(); return true; }
        if (action === 'back' || action === 'enter') { diagnostic.style.display = 'none'; view='now'; return true; }
        return true;
      }
      if (action === 'left' && view === 'now') { debugPage=0; showDebug(); return true; }
      if (action === 'up') { index = Math.max(0,index-1); focus(); return true; }
      if (action === 'down') { index = Math.min(entries.length-1,index+1); focus(); return true; }
      if (action === 'play' || action === 'playpause') { tuneSelected(); return true; }
      if (view === 'playing' && action === 'back') {
        if (typeof HumaxVideo !== 'undefined') HumaxVideo.close();
        view='now'; load(); return true;
      }
      if (action === 'enter') { if (view === 'now') openProgram(); else if (view === 'guide') showProgramActions(); return true; }\n      if (action === 'right' && view === 'now') { showScheduled(); return true; }\n      if (action === 'left' && view === 'schedule') { view = 'now'; load(); return true; }\n      if (action === 'left' && view === 'guide') { openGuide(dayOffset-1); return true; }\n      if (action === 'right' && view === 'guide') { openGuide(dayOffset+1); return true; }\n      if (action === 'back' && view !== 'now') { view = 'now'; load(); return true; }
      return false;
    },
    destroy(){ alive = false; },
  };
}
"""
(dest / 'js/screens/livetv.js').write_text(live_js, encoding='utf-8')
edit("js/screens/home.js",
     "import { openItem, playItem, openLibrary, openSearch, openSettings } from '../nav.js';",
     "import { openItem, playItem, openLibrary, openSearch, openSettings } from '../nav.js';\\nimport { LiveTvScreen } from './livetv.js';".replace('\\n', chr(10)))
edit("js/screens/home.js",
     ".concat([{ label: 'Search', id: 'search', icon: icons.search }, { label: 'Settings', id: 'settings', icon: icons.gear }]);",
     ".concat([{ label: 'Live TV & DVR', id: 'livetv' }, { label: 'Search', id: 'search', icon: icons.search }, { label: 'Settings', id: 'settings', icon: icons.gear }]);")
edit("js/screens/home.js",
     "    else if (n.id === 'search') openSearch();",
     "    else if (n.id === 'livetv') router.push(LiveTvScreen());\\n    else if (n.id === 'search') openSearch();".replace('\\n', chr(10)))
# Already imported router? Home uses nav functions, so import the router explicitly.
edit("js/screens/home.js",
     "import * as store from '../util/store.js';",
     "import * as store from '../util/store.js';\\nimport * as router from '../router.js';".replace('\\n', chr(10)))
css.write_text(css.read_text(encoding="utf-8") + """
.humax-live-status { position:absolute; top:210px; left:160px; right:120px; color:#c3cbd5; font:24px var(--body); }
.humax-live-list { position:absolute; top:300px; left:155px; width:1470px; height:650px; overflow-y:auto; scrollbar-width:none; }
.humax-live-row { display:flex; gap:24px; padding:17px 25px; margin:7px 0;
  border-radius:14px; background:#242a36; font:26px var(--body); }
.humax-live-row.focus { background:#ad304a; }
.humax-live-channel { width:440px; flex-shrink:0; font-weight:700; }
.humax-live-show { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.humax-live-detail { position:absolute; left:160px; bottom:40px; right:160px;
  color:#dbe1e9; font:21px var(--body); max-height:90px; overflow:hidden; }
""", encoding='utf-8')

css.write_text(css.read_text(encoding="utf-8") + """
.humax-live-debug { position:absolute; inset:40px 45px; z-index:99; background:#0b1018;
 border:3px solid #d1a32d; border-radius:18px; padding:35px 42px; color:#f7f8fa; }
.humax-debug-title { font:700 29px var(--body); margin-bottom:28px; color:#f8bf4e; }
.humax-debug-content { white-space:pre-wrap; overflow-wrap:anywhere; font:25px/1.34 monospace; }
""", encoding="utf-8")

print("Prepared HumaxPlex app assets at", dest)
