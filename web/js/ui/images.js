// Image requests share one loader per URL. Visible tiles take priority over
// prefetches, while concurrency remains bounded for older Android TV CPUs.
const MAX_ACTIVE = 6;
const LOADED_MAX = 800;
const visibleQueue = [];
const prefetchQueue = [];
const pending = new Map(); // URL -> shared request
const loaded = new Map();
let active = 0;

function remember(url) {
  loaded.delete(url);
  loaded.set(url, true);
  if (loaded.size > LOADED_MAX) loaded.delete(loaded.keys().next().value);
}

function attach(img, url, instant) {
  img.src = url;
  if (instant) img.classList.add('in', 'now');
  else { img.classList.remove('now'); img.classList.add('in'); }
}

function pump() {
  while (active < MAX_ACTIVE && (visibleQueue.length || prefetchQueue.length)) {
    const job = visibleQueue.length ? visibleQueue.pop() : prefetchQueue.shift();
    // Promoted prefetches and cancelled obsolete requests leave stale slots.
    if (job.started || pending.get(job.url) !== job) continue;
    if (!job.background && ![...job.viewers].some(img => img._want === job.url)) {
      pending.delete(job.url);
      continue;
    }
    job.started = true;
    active++;
    const loader = new Image();
    const done = ok => {
      active--;
      pending.delete(job.url);
      if (ok) {
        remember(job.url);
        for (const img of job.viewers) {
          if (img._want === job.url) attach(img, job.url, false);
        }
      }
      pump();
    };
    loader.onload = () => done(true);
    loader.onerror = () => {
      console.warn('EasyPlex image load failed', job.url.split('?')[0]);
      if (typeof EasyPlexVideo !== 'undefined') EasyPlexVideo.imageFailed(job.url.split('?')[0]);
      done(false);
    };
    loader.src = job.url;
  }
}

function request(url, img, background) {
  let job = pending.get(url);
  if (!job) {
    job = { url, viewers: new Set(), started: false, background };
    pending.set(url, job);
    (background ? prefetchQueue : visibleQueue).push(job);
  } else if (!background && !job.started) {
    // Visible work takes precedence even if originally queued as prefetch.
    job.background = false;
    visibleQueue.push(job);
  }
  if (img) job.viewers.add(img);
  // Bound stale queue entries after very fast remote scrolling.
  if (visibleQueue.length > 250) {
    const keep = visibleQueue.filter(j => !j.started && pending.get(j.url) === j);
    visibleQueue.splice(0, visibleQueue.length, ...keep);
  }
  pump();
}

// Point an <img> at a URL. Identical in-flight URLs share one download.
export function load(img, url) {
  if (img._want === url) return;
  const old = pending.get(img._want);
  if (old) {
    old.viewers.delete(img);
    if (!old.started && !old.background && !old.viewers.size) pending.delete(old.url);
  }
  img._want = url;
  if (!url) {
    img.classList.remove('in', 'now');
    img.removeAttribute('src');
    return;
  }
  if (loaded.has(url)) {
    attach(img, url, true);
    return;
  }
  img.classList.remove('in', 'now');
  request(url, img, false);
}

// Warm a poster at lower priority than anything currently visible.
export function prefetch(url) {
  if (!url || loaded.has(url)) return;
  request(url, null, true);
}
