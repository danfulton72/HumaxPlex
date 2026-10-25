// Playback for Xtream films: the file streams straight from the server into the
// native player. Same controls as Plex films (accelerating seek that commits
// when you stop pressing, OSD mirrored to the native HUD, failure dialog), and
// the position is kept on the box so the film can be resumed later.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { createPlayer } from '../platform/player.js';
import { setScreenSaver } from '../platform/device.js';
import { clock } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { log } from '../util/log.js';
import { saveResume, clearResume } from '../xtream/api.js';

const OSD_HIDE_MS = 4000;
const SEEK_COMMIT_MS = 900;
const SAVE_MS = 15000;

function pad(n) { return (n < 10 ? '0' : '') + n; }

export function seekStep(count) {
  return count < 3 ? 10000 : count < 8 ? 30000 : count < 16 ? 60000 : 180000;
}

export function VodPlayerScreen(client, movie, { offset = 0 } = {}) {
  const el = h('div', 'screen player vod-player');
  const stage = h('div', 'player-stage', el);
  const spinner = h('div', 'spinner on', el);
  const pauseBig = h('div', 'pause-big', el);
  pauseBig.innerHTML = icons.pause;

  const osd = h('div', 'osd', el);
  const osdTop = h('div', 'osd-top', osd);
  const osdTitle = h('div', 'osd-title', osdTop);
  const osdSub = h('div', 'osd-sub', osdTop);
  const osdBottom = h('div', 'osd-bottom', osd);
  const bar = h('div', 'osd-bar', osdBottom);
  const barFill = h('div', 'osd-fill', bar);
  const knob = h('div', 'osd-knob', bar);
  const seekLabel = h('div', 'osd-seek', knob);
  const times = h('div', 'osd-times', osdBottom);
  const tNow = h('span', 'osd-now', times);
  const tInfo = h('span', 'osd-info', times);
  const tLeft = h('span', 'osd-left', times);
  const hintEl = h('div', 'osd-hint', osdBottom);
  hintEl.innerHTML = '▼ Audio &amp; subtitles';

  const errorEl = h('div', 'hx-dialog ep-fail hidden', el);
  const errorBox = h('div', 'hx-dlg hx-menu', errorEl);
  h('div', 'hx-dlg-eyebrow', errorBox).textContent = 'PLAYBACK PROBLEM';
  const errorTitle = h('h2', 'hx-dlg-title', errorBox);
  const errorMsg = h('div', 'hx-dlg-sub', errorBox);
  const errorList = h('div', 'hx-menu-list', errorBox);
  h('div', 'hx-dlg-hint', errorBox).textContent = '▲▼ choose · OK select · Back to leave';
  let errorItems = [], errorIndex = 0;

  let position = offset || 0;
  let duration = movie.duration || 0;
  let paused = false;
  let started = false;
  let alive = true;
  let seekTarget = null;
  let seekCount = 0;
  let lastSeekAt = 0;
  let seekTimer = 0;
  let osdTimer = 0;
  let saveTimer = 0;
  let lastText = 0;

  const url = client.streamUrl(movie.id, movie.ext);

  const player = createPlayer(stage, {
    onTime(ms) {
      if (!started) return;
      position = ms;
      if (seekTarget == null) renderProgress(position);
    },
    onDuration(ms) { if (ms > 0) duration = ms; },
    onBuffering(on) { toggleClass(spinner, 'on', on); },
    onEnd() { finished(); },
    onError(msg) { failed(msg); },
    onSubtitle() {},
  });

  // ---- OSD ------------------------------------------------------------------

  function endsAt(ms) {
    const ends = new Date(Date.now() + Math.max(0, duration - ms));
    return pad(ends.getHours()) + ':' + pad(ends.getMinutes());
  }

  function hudTitle() { return movie.title + (movie.year ? '  (' + movie.year + ')' : ''); }

  function renderProgress(ms) {
    const p = duration ? Math.max(0, Math.min(1, ms / duration)) : 0;
    setTransform(barFill, 'scaleX(' + p.toFixed(4) + ')');
    setTransform(knob, 'translateX(' + Math.round(p * 1728) + 'px)');
    const now = Date.now();
    if (now - lastText > 900 || seekTarget != null) {
      lastText = now;
      setText(tNow, clock(ms));
      setText(tLeft, duration ? '−' + clock(duration - ms) : '');
      setText(tInfo, duration ? 'Ends at ' + endsAt(ms) : '');
      pushHud(false);
    }
  }

  const nativeHud = () => (typeof EasyPlexVideo !== 'undefined' && EasyPlexVideo.setHud ? EasyPlexVideo : null);
  function pushHud(show) {
    const n = nativeHud();
    if (!n || !started) return;
    const ms = seekTarget != null ? seekTarget : position;
    const p = duration ? Math.round(Math.max(0, Math.min(1, ms / duration)) * 1000) : -1;
    const line = (seekTarget != null ? 'Seek to ' + clock(seekTarget) + '  ·  ' : '') +
      (paused && seekTarget == null ? 'Paused  ·  ' : '') +
      clock(ms) + (duration ? ' / ' + clock(duration) + '  ·  Ends ' + endsAt(ms) : '');
    n.setHud(hudTitle(), line, p, !!show, paused || seekTarget != null);
  }

  function showOsd(sticky) {
    toggleClass(el, 'osd-on', true);
    clearTimeout(osdTimer);
    if (!sticky && !paused) osdTimer = setTimeout(() => toggleClass(el, 'osd-on', false), OSD_HIDE_MS);
    pushHud(true);
  }

  function hideOsd() {
    clearTimeout(osdTimer);
    toggleClass(el, 'osd-on', false);
    const n = nativeHud();
    if (n && n.hideHud) n.hideHud();
  }

  // ---- playback -------------------------------------------------------------

  async function start(at) {
    toggleClass(spinner, 'on', true);
    started = false;
    log('vod play', movie.title, 'at', clock(at || 0));
    try {
      player.open(url);
      await player.prepare();
      if (!alive) return;
      if (at > 0) await player.seek(at);
      player.play();
      started = true;
      paused = false;
      toggleClass(el, 'paused', false);
      toggleClass(spinner, 'on', false);
      position = at || 0;
      renderProgress(position);
      showOsd();
    } catch (e) {
      failed(e.message || String(e));
    }
  }

  function save() {
    if (started && duration) saveResume(movie, position, duration);
  }

  function finished() {
    clearResume(movie.id);
    started = false;
    exit(false);
  }

  function friendly(msg) {
    const m = String(msg || '');
    if (/HTTP 401|HTTP 403|401|403/.test(m)) return 'The server refused the stream (check the Xtream login and connection limit).';
    if (/HTTP 404|404/.test(m)) return 'The film file was not found on the server.';
    if (/HTTP 5\d\d/.test(m)) return 'The server had a problem sending this film.';
    if (/decod|codec|format|unsupported|NATIVE_STALL/i.test(m)) return 'This box can\'t play this film\'s video or audio format.';
    if (/network|timeout|IO_|Failed to fetch|ENOTFOUND/i.test(m)) return 'The connection to the server dropped.';
    return 'Something went wrong while playing.';
  }

  function failed(msg) {
    if (!alive) return;
    toggleClass(spinner, 'on', false);
    save();
    started = false;
    setText(errorTitle, hudTitle());
    setText(errorMsg, friendly(msg) + '  (' + String(msg || 'unknown error').slice(0, 120) + ')');
    errorItems = [
      { label: 'Try again', run: () => { errorEl.classList.add('hidden'); start(position); } },
      position > 0 && { label: 'Start from the beginning', run: () => { errorEl.classList.add('hidden'); start(0); } },
      { label: 'Back', run: () => exit() },
    ].filter(Boolean);
    errorIndex = 0;
    renderFailure();
    errorEl.classList.remove('hidden');
    hideOsd();
  }

  function renderFailure() {
    errorList.textContent = '';
    errorItems.forEach((it, i) => {
      h('div', 'hx-btn hx-menu-item' + (i === errorIndex ? ' focus' : ''), errorList).textContent = it.label;
    });
  }

  function failureKey(action) {
    if (action === 'up') { errorIndex = Math.max(0, errorIndex - 1); renderFailure(); }
    else if (action === 'down') { errorIndex = Math.min(errorItems.length - 1, errorIndex + 1); renderFailure(); }
    else if (action === 'enter') errorItems[errorIndex].run();
    else if (action === 'back' || action === 'stop') exit();
    return true;
  }

  function togglePause() {
    if (!started) return;
    if (paused) { player.play(); paused = false; showOsd(); }
    else { player.pause(); paused = true; save(); showOsd(true); }
    toggleClass(el, 'paused', paused);
    pushHud(true);
  }

  function seekBy(dir) {
    if (!started) return;
    const now = Date.now();
    seekCount = now - lastSeekAt < 700 ? seekCount + 1 : 0;
    lastSeekAt = now;
    const from = seekTarget == null ? position : seekTarget;
    const max = duration ? duration - 3000 : Infinity;
    seekTarget = Math.max(0, Math.min(max, from + dir * seekStep(seekCount)));
    toggleClass(el, 'seeking', true);
    setText(seekLabel, clock(seekTarget));
    renderProgress(seekTarget);
    showOsd(true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  async function commitSeek() {
    clearTimeout(seekTimer);
    if (seekTarget == null) return;
    const target = seekTarget;
    seekTarget = null;
    toggleClass(el, 'seeking', false);
    position = target;
    showOsd();
    toggleClass(spinner, 'on', true);
    try {
      await player.seek(target);
      if (paused) togglePause();
    } finally {
      toggleClass(spinner, 'on', false);
    }
  }

  function cancelSeek() {
    clearTimeout(seekTimer);
    seekTarget = null;
    toggleClass(el, 'seeking', false);
    renderProgress(position);
    showOsd();
  }

  function exit(keep = true) {
    if (keep) save();
    router.back();
  }

  function onLifecycle(e) {
    if (e.detail === 'stop' && started && !paused) togglePause();
  }

  function onVisibility() {
    if (document.hidden && started && !paused) togglePause();
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    [seekTimer, osdTimer].forEach(clearTimeout);
    clearInterval(saveTimer);
    player.destroy();
    document.documentElement.classList.remove('playing');
    setScreenSaver(true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('easyplex:lifecycle', onLifecycle);
  }

  setText(osdTitle, movie.title);
  setText(osdSub, [movie.year, movie.genre].filter(Boolean).join('  ·  '));

  return {
    el,
    name: 'vod-player',
    onShow() {
      document.documentElement.classList.add('playing');
      setScreenSaver(false);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('easyplex:lifecycle', onLifecycle);
      if (!saveTimer) saveTimer = setInterval(() => { if (started && !paused) save(); }, SAVE_MS);
      if (!started && errorEl.classList.contains('hidden')) start(position);
    },
    onKey(action) {
      if (!errorEl.classList.contains('hidden')) return failureKey(action);
      switch (action) {
        case 'enter':
          if (seekTarget != null) commitSeek();
          else if (el.classList.contains('osd-on') || paused) togglePause();
          else showOsd();
          return true;
        case 'playpause': if (seekTarget != null) commitSeek(); else togglePause(); return true;
        case 'play': if (paused) togglePause(); return true;
        case 'pause': if (!paused) togglePause(); return true;
        case 'left': case 'rw': seekBy(-1); return true;
        case 'right': case 'ff': seekBy(1); return true;
        case 'up': case 'info': showOsd(); return true;
        case 'stop': exit(); return true;
        case 'back':
          if (seekTarget != null) { cancelSeek(); return true; }
          if (el.classList.contains('osd-on') && !paused) { hideOsd(); return true; }
          exit();
          return true;
      }
      return true;
    },
    destroy: teardown,
    // For tests.
    get state() { return { position, duration, paused, started }; },
  };
}
