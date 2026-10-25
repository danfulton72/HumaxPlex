// Shared request plumbing for plex.tv and Plex Media Server.
import { VERSION } from '../config.js';
import { deviceInfo } from '../platform/device.js';
import * as store from '../util/store.js';
import { uuid } from '../util/format.js';

export const PRODUCT = 'EasyPlex';

let clientId = store.get('clientId');
if (!clientId) {
  clientId = uuid();
  store.set('clientId', clientId);
}
export { clientId };

const device = deviceInfo();

// Identity params, also needed as query params on URLs handed to the native
// player (which can't send headers).
export function identity() {
  return {
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': device.appVersion || VERSION,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Platform': device.platform,
    'X-Plex-Platform-Version': device.version || '9',
    'X-Plex-Device': device.model,
    'X-Plex-Device-Name': device.name,
    'X-Plex-Model': device.model,
  };
}

export function query(params) {
  const parts = [];
  for (const k in params) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.join('&');
}

export function withQuery(url, params) {
  const q = query(params);
  if (!q) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + q;
}

export class HttpError extends Error {
  constructor(status, url) {
    super('HTTP ' + status + ' from ' + url.split('?')[0].replace(/^https?:\/\/[^/]+/, ''));
    this.status = status;
  }
}

export async function request(url, { method = 'GET', token, params, timeout = 15000, body, raw } = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, identity());
  if (token) headers['X-Plex-Token'] = token;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  const full = withQuery(url, params);
  try {
    const res = await fetch(full, { method, headers, body, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new HttpError(res.status, full);
    if (raw) return res;
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}
