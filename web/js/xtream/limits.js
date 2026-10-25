// Which VOD categories each Plex Home profile may see, set by the Plex admin.
// Stored on this box: { [profile uuid]: { title, allow: [category ids] } }.
// No entry means every category. A restricted profile only sees the listed
// categories, so ones the provider adds later stay hidden until allowed.
import * as store from '../util/store.js';

const KEY = 'xtreamLimits';

function all() {
  const v = store.get(KEY, {});
  return v && typeof v === 'object' ? v : {};
}

// null = all categories; otherwise an array of allowed category ids.
export function allowedFor(profile) {
  const e = all()[profile];
  return e && Array.isArray(e.allow) ? e.allow.map(String) : null;
}

// For the signed-in profile: by Plex uuid, or by name for profiles saved
// before EasyPlex recorded the uuid.
export function allowedForUser(user) {
  if (!user) return null;
  if (user.uuid) {
    const byId = allowedFor(user.uuid);
    if (byId) return byId;
  }
  const v = all();
  const key = Object.keys(v).find(k => v[k] && v[k].title && v[k].title === user.title);
  return key ? allowedFor(key) : null;
}

export function setAllowed(profile, title, ids) {
  const v = all();
  if (ids == null) delete v[profile];
  else v[profile] = { title: title || '', allow: [...new Set(ids.map(String))] };
  store.set(KEY, v);
}

export function filterCategories(categories, allow) {
  if (!allow) return categories;
  const ok = new Set(allow);
  return categories.filter(c => ok.has(String(c.id)));
}

// "All categories", "No films", "3 of 40 categories".
export function limitLabel(allow, total) {
  if (!allow) return 'All categories';
  if (!allow.length) return 'No films';
  return allow.length + (total ? ' of ' + total : '') + (allow.length === 1 && !total ? ' category' : ' categories');
}
