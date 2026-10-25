export function duration(ms) {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return min + 'm';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => (n < 10 ? '0' : '') + n;
  return (hh ? hh + ':' + pad(mm) : mm) + ':' + pad(ss);
}

export function episodeLabel(item) {
  if (item.type !== 'episode') return '';
  return 'S' + (item.parentIndex || 0) + ' · E' + (item.index || 0);
}

// Length of the actual file. Plex's item-level duration can come from agent
// or NFO metadata (often a rounded runtime such as exactly 22 minutes), while
// Media/Part durations are measured from the file when it is analysed.
export function mediaDuration(item) {
  const media = item && item.Media && item.Media[0];
  const part = media && media.Part && media.Part[0];
  return (media && media.duration) || (part && part.duration) || (item && item.duration) || 0;
}

// The line under a title: "2019 · PG-13 · 2h 4m" style.
export function metaLine(item) {
  const parts = [];
  if (item.type === 'episode') {
    parts.push(episodeLabel(item));
    if (item.originallyAvailableAt) parts.push(item.originallyAvailableAt.slice(0, 4));
  } else if (item.year) {
    parts.push(item.year);
  }
  if (item.contentRating) parts.push(item.contentRating);
  if (item.type === 'show' && item.childCount) parts.push(item.childCount + (item.childCount === 1 ? ' season' : ' seasons'));
  else if (mediaDuration(item)) parts.push(duration(mediaDuration(item)));
  if (item.audienceRating) parts.push('★ ' + Number(item.audienceRating).toFixed(1));
  return parts.join('  ·  ');
}

export function progress(item) {
  const total = mediaDuration(item);
  if (!item.viewOffset || !total) return 0;
  return Math.min(1, item.viewOffset / total);
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
