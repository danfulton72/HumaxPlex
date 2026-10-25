// localStorage wrapper. It persists across app restarts; it can throw when full.
const PREFIX = 'ss.';

export function get(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function set(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) { /* quota */ }
}

// Plain string values under their own keys (no prefix, no JSON), for settings
// saved that way by earlier versions (Live TV favourites, last channel…).
export function getRaw(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function setRaw(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* quota or blocked */ }
}
