// The last Plex item the player opened, so the screen underneath can put the
// focus back on it (Up Next may have moved on to a later episode).
let last = null;

export function setLastPlayed(item) {
  last = item ? {
    ratingKey: String(item.ratingKey),
    type: item.type,
    parentRatingKey: item.parentRatingKey != null ? String(item.parentRatingKey) : null,
    grandparentRatingKey: item.grandparentRatingKey != null ? String(item.grandparentRatingKey) : null,
  } : null;
}

// Read it once: later returns (from other screens) shouldn't re-apply it.
export function takeLastPlayed() {
  const l = last;
  last = null;
  return l;
}
