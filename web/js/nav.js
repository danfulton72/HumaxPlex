// Where selecting things goes. Kept in one place so screens don't import each other.
import * as router from './router.js';
import { DetailScreen } from './screens/detail.js';
import { LibraryScreen } from './screens/library.js';
import { PlayerScreen } from './screens/player.js';
import { SearchScreen } from './screens/search.js';
import { SettingsScreen } from './screens/settings.js';

export function openItem(item) {
  if (item.type === 'clip') { playItem(item); return; }
  router.push(DetailScreen(item));
}

export function playItem(item, opts) {
  if (item.type === 'show' || item.type === 'season') {
    // Play on a show means "the next episode"; the detail screen resolves it.
    router.push(DetailScreen(item, { autoplay: true }));
    return;
  }
  router.push(PlayerScreen(item, opts || {}));
}

export function openLibrary(section) {
  router.push(LibraryScreen(section));
}

export function openSearch() {
  router.push(SearchScreen());
}

export function openSettings() {
  router.push(SettingsScreen());
}

// Options for one film, show or episode (hold OK on any poster or episode).
// onChanged runs after watched state changes so the screen can refresh.
import { showOptions, toast } from './ui/options.js';
import { session } from './session.js';
import { clock, episodeLabel } from './util/format.js';

export function itemOptions(item, { onChanged, details = true } = {}) {
  if (!item) return;
  const isShow = item.type === 'show' || item.type === 'season';
  const watched = isShow ? item.leafCount && item.viewedLeafCount >= item.leafCount : !!item.viewCount;
  const items = [];
  if (isShow) items.push({ label: 'Play next episode', run: () => playItem(item) });
  else if (item.viewOffset) {
    items.push({ label: 'Resume from ' + clock(item.viewOffset), run: () => playItem(item, { offset: item.viewOffset }) });
    items.push({ label: 'Play from the start', run: () => playItem(item, { offset: 0 }) });
  } else items.push({ label: 'Play', run: () => playItem(item, { offset: 0 }) });
  if (details) items.push({ label: 'Details', run: () => router.push(DetailScreen(item)) });
  items.push({
    label: watched ? 'Mark as unwatched' : 'Mark as watched',
    run: async () => {
      try {
        if (watched) await session.server.unscrobble(item.ratingKey);
        else await session.server.scrobble(item.ratingKey);
        session.server.invalidate();
        toast(watched ? 'Marked as unwatched' : 'Marked as watched');
        if (onChanged) onChanged();
      } catch (e) { toast('Couldn\'t update watched state'); }
    },
  });
  if (item.type === 'episode' && item.grandparentRatingKey) {
    items.push({ label: 'Go to show', run: () => router.push(DetailScreen({ ratingKey: item.grandparentRatingKey, type: 'show', title: item.grandparentTitle })) });
  }
  showOptions({
    title: item.type === 'episode' ? item.grandparentTitle : item.title,
    subtitle: item.type === 'episode' ? episodeLabel(item) + '  ' + item.title : '',
    items,
    focus: 0,
  });
}
