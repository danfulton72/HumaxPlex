
function nativeBackend(container, listener) {
  let currentTime = 0;
  let currentState = 'NONE';
  let ready = null;
  let timer = 0;
  window.__easyplexVideoEvent = (name, value) => {
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
    open(url) { EasyPlexVideo.open(url); },
    prepare() {
      return new Promise((resolve, reject) => {
        ready = err => err ? reject(err) : resolve();
      });
    },
    play() { currentState = 'PLAYING'; EasyPlexVideo.play(); },
    pause() { currentState = 'PAUSED'; EasyPlexVideo.pause(); },
    seek(ms) { EasyPlexVideo.seek(Math.max(0, Math.floor(ms))); return Promise.resolve(); },
    time() { return currentTime; },
    state() { return currentState; },
    tracks() { return { audio: [], text: [] }; },
    selectAudio() { return false; },
    selectText() { return false; },
    suspend() { EasyPlexVideo.pause(); },
    restore() {},
    close() { currentState = 'NONE'; EasyPlexVideo.close(); },
    destroy() { EasyPlexVideo.close(); delete window.__easyplexVideoEvent; },
  };
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
  if (typeof EasyPlexVideo !== 'undefined') return nativeBackend(container, listener);
  return videoBackend(container, listener);
}
