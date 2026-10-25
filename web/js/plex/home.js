// Plex Home: the profiles on the account that linked this box, and switching
// between them. Always asked with the account (root) token.
import { session } from '../session.js';
import { identity } from './client.js';

export async function homeRequest(url, { method = 'GET', pin } = {}) {
  const response = await fetch('https://plex.tv' + url +
    (pin ? '?pin=' + encodeURIComponent(pin) : ''), {
      method,
      headers: Object.assign({ Accept: 'application/json' }, identity(), {
        'X-Plex-Token': session.rootToken || session.token,
      }),
    });
  if (!response.ok) throw new Error('Plex Home request failed (HTTP ' + response.status + ')');
  const body = await response.text();
  if (body.trim().startsWith('<')) {
    const root = new DOMParser().parseFromString(body, 'application/xml').documentElement;
    return {
      users: Array.from(root.querySelectorAll('user')).map(el => ({
        id: el.getAttribute('id'), uuid: el.getAttribute('uuid') || undefined,
        title: el.getAttribute('title') || el.getAttribute('username'),
        protected: el.getAttribute('protected') === '1',
        admin: el.getAttribute('admin') === '1',
        restricted: el.getAttribute('restricted') === '1',
      })),
      authenticationToken: root.getAttribute('authenticationToken'),
    };
  }
  return JSON.parse(body);
}

export function userLabel(user) { return user.title || user.username || user.name || 'Plex user'; }

// [{ id, uuid, title, admin, restricted, protected }]
export async function homeUsers() {
  const result = await homeRequest('/api/v2/home/users');
  const users = Array.isArray(result) ? result : (result.users || result.User || []);
  return users.map(u => Object.assign({}, u, { title: userLabel(u), admin: !!u.admin, restricted: !!u.restricted, protected: !!(u.protected || u.hasPassword) }));
}
