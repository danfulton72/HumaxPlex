// Plex calls that change something (POST/DELETE). Reads go through server.get.
import { identity } from '../../plex/client.js';
import { plexError } from './helpers.js';

export function createApi(server) {
  const headers = () => Object.assign({ Accept: 'application/json', 'X-Plex-Token': server.token }, identity());

  // POST and return the MediaContainer. rawQuery is appended as-is (already
  // encoded), for parameter strings Plex hands us and expects back untouched.
  async function post(path, params = {}, rawQuery = '') {
    const url = server.url(path, params) + (rawQuery ? '&' + rawQuery : '');
    const response = await fetch(url, { method: 'POST', headers: headers() });
    const body = await response.text();
    if (!response.ok) throw plexError(response.status, body);
    let data;
    try { data = JSON.parse(body); } catch (e) { throw new Error('Plex returned non-JSON response'); }
    const result = data.MediaContainer || data;
    if (typeof result.status === 'number' && result.status < 0)
      throw new Error('Plex status ' + result.status + ': ' + String(result.message || 'No error explanation').slice(0, 180));
    return result;
  }

  async function del(path) {
    const response = await fetch(server.url(path), { method: 'DELETE', headers: headers() });
    if (!response.ok) throw plexError(response.status, await response.text());
  }

  return { post, del };
}
