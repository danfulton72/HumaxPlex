// Device layer for Android TV. The native shell (MainActivity) exposes
// window.EasyPlexVideo; in a desktop browser the fallbacks keep the UI usable.

// keyCode → action, for keyboards in a desktop browser. On the TV the native
// shell maps remote keys and calls window.__androidAction directly.
const KEYMAP = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  8: 'back', 27: 'back', 32: 'playpause', 19: 'pause',
  33: 'pageup', 34: 'pagedown', 77: 'menu',
};

export function actionFor(e) {
  return KEYMAP[e.keyCode] || null;
}

function native() {
  return typeof EasyPlexVideo !== 'undefined' ? EasyPlexVideo : null;
}

export function exitApp() {
  const n = native();
  if (n && typeof n.exit === 'function') n.exit();
  else window.close();
}

// Identity reported to Plex. The platform stays "Android" so the server uses
// its generic profile plus our own X-Plex-Client-Profile-Extra.
let cached = null;
export function deviceInfo() {
  if (cached) return cached;
  let info = {};
  try {
    const n = native();
    if (n && typeof n.deviceInfo === 'function') info = JSON.parse(n.deviceInfo()) || {};
  } catch (e) { info = {}; }
  const maker = String(info.manufacturer || '').trim();
  const model = String(info.model || '').trim() || 'Browser';
  const name = maker && !model.toLowerCase().startsWith(maker.toLowerCase()) ? maker + ' ' + model : model;
  cached = {
    model,
    name: name || 'EasyPlex',
    platform: 'Android',
    version: String(info.release || ''),
    appVersion: String(info.appVersion || ''),
  };
  return cached;
}

// Transcode targets stay at 1080p-friendly defaults; the native player asks
// for higher quality explicitly through the quality menu.
export function supports4K() {
  return false;
}

// The native shell keeps the screen awake while video plays.
export function setScreenSaver() {}
