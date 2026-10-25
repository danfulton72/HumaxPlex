// Who is signed in and which server we're talking to. Persisted so a restart
// goes straight to the home screen.
import * as store from './util/store.js';
import { Server } from './plex/server.js';
import { getServers, connect, getUser } from './plex/auth.js';
import { log } from './util/log.js';

export const session = {
  token: store.get('token'),
  rootToken: store.get('rootToken') || store.get('token'),
  user: store.get('user'),
  server: null,
};

const saved = store.get('server');
if (saved) session.server = new Server(saved);

export function signIn(token, user) {
  session.token = token;
  session.rootToken = token;
  store.set('rootToken', token);
  // The account that linked the box: the Plex Home admin, or the owner when
  // there is no Home.
  session.user = { title: user.title || user.username, thumb: user.thumb, uuid: user.uuid, admin: isAccountAdmin(user) };
  store.set('token', token);
  store.set('user', session.user);
}

function isAccountAdmin(user) {
  return !user.home || !!user.homeAdmin;
}

// True when the current profile is the Plex Home admin.
export function isAdmin() {
  return !!(session.user && session.user.admin === true);
}

// Sessions saved before roles were recorded: ask plex.tv once.
export async function ensureUserRole() {
  const u = session.user;
  if (!u || typeof u.admin === 'boolean' || !session.token) return;
  try {
    const me = await getUser(session.token);
    u.admin = isAccountAdmin(me);
    if (!u.uuid && me.uuid) u.uuid = me.uuid;
    store.set('user', u);
  } catch (e) { /* offline: treated as not admin until it can be checked */ }
}

// Stable key for per-profile settings on this box.
export function profileKey() {
  const u = session.user;
  return (u && (u.uuid || u.title)) || 'default';
}

export function activateHomeUser(token, user) {
  session.token = token;
  session.user = { title: user.title || user.username, thumb: user.thumb, uuid: user.uuid, admin: !!user.admin };
  session.server = null;
  store.set('token', token);
  store.set('user', session.user);
  store.set('server', undefined);
  store.set('homeCache', undefined);
}

export function useServer(resource, uri) {
  session.server = new Server({ uri, token: resource.accessToken, name: resource.name, id: resource.clientIdentifier });
  store.set('server', { uri, token: resource.accessToken, name: resource.name, id: resource.clientIdentifier });
}

export function signOut() {
  session.token = null;
  session.rootToken = null;
  store.set('rootToken', undefined);
  session.user = null;
  session.server = null;
  store.set('token', undefined);
  store.set('user', undefined);
  store.set('server', undefined);
  store.set('homeCache', undefined);
}

// The saved URI can go stale (DHCP, remote vs. home). Re-resolve it from plex.tv.
export async function reconnect() {
  const servers = await getServers(session.token);
  const current = session.server && servers.find(s => s.clientIdentifier === session.server.id);
  const resource = current || servers[0];
  if (!resource) throw new Error('No Plex servers on this account');
  const uri = await connect(resource);
  useServer(resource, uri);
  log('reconnected', resource.name, uri);
  return session.server;
}
