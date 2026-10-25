
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

// Video backend: Samsung AVPlay (hardware decode, plays straight to the video
// plane under the web layer) on the TV, <video> in a desktop browser.
//
// listener: { onTime(ms), onBuffering(bool), onEnd(), onError(msg), onSubtitle(text, durationMs) }

function avplayBackend(container, listener) {
  const av = webapis.avplay;
  const obj = document.createElement('object');
  obj.type = 'application/avplayer';
  obj.className = 'av-object';
  container.appendChild(obj);
  let opened = false;

  const api = {
    open(url, { uhd = false } = {}) {
      api.close();
      av.open(url);
      opened = true;
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      if (uhd) {
        try { av.setStreamingProperty('SET_MODE_4K', 'TRUE'); } catch (e) { /* not a UHD panel */ }
      }
      av.setListener({
        onbufferingstart: () => listener.onBuffering(true),
        onbufferingprogress: () => {},
        onbufferingcomplete: () => listener.onBuffering(false),
        oncurrentplaytime: ms => listener.onTime(ms),
        onstreamcompleted: () => listener.onEnd(),
        onerror: e => listener.onError(String(e)),
        onevent: () => {},
        onsubtitlechange: (duration, text) => listener.onSubtitle(text, Number(duration)),
        ondrmevent: () => {},
      });
    },
    prepare() {
      return new Promise((resolve, reject) => av.prepareAsync(resolve, e => reject(new Error(String(e && e.name || e)))));
    },
    play() { av.play(); },
    pause() { av.pause(); },
    seek(ms) {
      return new Promise((resolve, reject) => av.seekTo(Math.max(0, Math.floor(ms)), resolve, e => reject(new Error(String(e && e.name || e)))));
    },
    time() {
      try { return av.getCurrentTime(); } catch (e) { return 0; }
    },
    state() {
      try { return av.getState(); } catch (e) { return 'NONE'; }
    },
    tracks() {
      let info = [];
      try { info = av.getTotalTrackInfo() || []; } catch (e) {}
      return {
        audio: info.filter(t => t.type === 'AUDIO').map(t => t.index),
        text: info.filter(t => t.type === 'TEXT').map(t => t.index),
      };
    },
    selectAudio(avIndex) {
      try { av.setSelectTrack('AUDIO', avIndex); return true; } catch (e) { return false; }
    },
    selectText(avIndex) {
      try {
        if (avIndex == null) { av.setSilentSubtitle(true); return true; }
        av.setSelectTrack('TEXT', avIndex);
        av.setSilentSubtitle(false);
        return true;
      } catch (e) { return false; }
    },
    suspend() { try { av.suspend(); } catch (e) {} },
    restore() { try { av.restore(); } catch (e) {} },
    close() {
      if (!opened) return;
      opened = false;
      try { av.stop(); } catch (e) {}
      try { av.close(); } catch (e) {}
    },
    destroy() {
      api.close();
      if (obj.parentNode) obj.parentNode.removeChild(obj);
    },
  };
  return api;
}

function videoBackend(container, listener) {
  const v = document.createElement('video');
  v.className = 'av-object';
  container.appendChild(v);
  v.addEventListener('timeupdate', () => listener.onTime(v.currentTime * 1000));
  v.addEventListener('waiting', () => listener.onBuffering(true));
  v.addEventListener('playing', () => listener.onBuffering(false));
  v.addEventListener('ended', () => listener.onEnd());
  v.addEventListener('error', () => listener.onError('video error ' + (v.error && v.error.code)));
  return {
    open(url) { v.src = url; },
    prepare() {
      return new Promise((resolve, reject) => {
        v.addEventListener('loadedmetadata', resolve, { once: true });
        v.addEventListener('error', () => reject(new Error('load failed')), { once: true });
        v.load();
      });
    },
    play() { v.play(); },
    pause() { v.pause(); },
    seek(ms) { v.currentTime = ms / 1000; return Promise.resolve(); },
    time() { return v.currentTime * 1000; },
    state() { return v.paused ? 'PAUSED' : 'PLAYING'; },
    tracks() { return { audio: [], text: [] }; },
    selectAudio() { return false; },
    selectText() { return false; },
    suspend() {},
    restore() {},
    close() { v.removeAttribute('src'); v.load(); },
    destroy() { v.removeAttribute('src'); if (v.parentNode) v.parentNode.removeChild(v); },
  };
}

export function createPlayer(container, listener) {
  if (typeof HumaxVideo !== 'undefined') return humaxBackend(container, listener);
  if (typeof webapis !== 'undefined' && webapis.avplay) return avplayBackend(container, listener);
  return videoBackend(container, listener);
}
