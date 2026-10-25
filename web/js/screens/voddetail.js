// One Xtream film: artwork, details from get_vod_info, and Play / Resume.
import { h, setText, toggleClass } from '../util/dom.js';
import { HeroArt, useAmbience } from '../ui/backdrop.js';
import { duration as fmtDuration, clock } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { imageUrl, resumeFor, clearResume, friendlyError } from '../xtream/api.js';
import { VodPlayerScreen } from './vodplayer.js';

export function vodMetaLine(m) {
  const parts = [];
  if (m.year) parts.push(m.year);
  if (m.duration) parts.push(fmtDuration(m.duration));
  if (m.rating) parts.push('★ ' + Number(m.rating).toFixed(1));
  if (m.genre) parts.push(m.genre);
  return parts.join('  ·  ');
}

export function playVod(client, movie, fromStart) {
  const r = fromStart ? null : resumeFor(movie.id);
  router.push(VodPlayerScreen(client, movie, { offset: r ? r.position : 0 }));
}

export function VodDetailScreen(client, item) {
  const el = h('div', 'screen detail vod-detail');
  const ambience = useAmbience();
  const art = new HeroArt(el, 'hero-art detail-art');
  const body = h('div', 'detail-body vod-detail-body', el);
  const posterBox = h('div', 'vod-detail-poster', body);
  const poster = h('img', 'vod-detail-img', posterBox);
  poster.alt = '';
  poster.onload = () => poster.classList.add('in');
  poster.onerror = () => poster.classList.remove('in');
  const text = h('div', 'vod-detail-text', body);
  const title = h('h1', 'detail-title', text);
  const meta = h('div', 'detail-meta', text);
  const summary = h('div', 'detail-summary', text);
  const credits = h('div', 'detail-tags', text);
  const cast = h('div', 'detail-tags', text);
  const buttonsEl = h('div', 'detail-buttons', text);
  const status = h('div', 'vod-detail-status', text);

  let movie = Object.assign({}, item);
  let buttons = [];
  let index = 0;

  function paint() {
    setText(title, movie.title);
    setText(meta, vodMetaLine(movie));
    setText(summary, movie.plot || '');
    setText(credits, movie.director ? 'Directed by ' + movie.director : '');
    setText(cast, movie.cast ? 'Starring ' + movie.cast : '');
    const p = imageUrl(movie.posterUrl);
    if (p && poster.getAttribute('src') !== p) { poster.classList.remove('in'); poster.src = p; }
    toggleClass(posterBox, 'empty', !p);
    art.set(imageUrl(movie.backdropUrl || ''));
    paintButtons();
  }

  function paintButtons() {
    const r = resumeFor(movie.id);
    const defs = r ? [
      { label: 'Resume from ' + clock(r.position), icon: icons.play, run: () => playVod(client, movie, false) },
      { label: 'Play from the start', run: () => playVod(client, movie, true) },
      { label: 'Remove from Continue Watching', run: () => { clearResume(movie.id); index = 0; paintButtons(); } },
    ] : [
      { label: 'Play', icon: icons.play, run: () => playVod(client, movie, true) },
    ];
    buttonsEl.textContent = '';
    index = Math.min(index, defs.length - 1);
    buttons = defs.map((d, i) => {
      const b = h('div', 'btn' + (i === index ? ' focus' : ''), buttonsEl);
      if (d.icon) b.innerHTML = d.icon;
      h('span', '', b).textContent = d.label;
      return Object.assign({ el: b }, d);
    });
  }

  function render() {
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', i === index));
  }

  async function load() {
    setText(status, '');
    try {
      const info = await client.info(movie.id);
      // Keep what the list already knew when the detail call leaves it blank.
      Object.keys(info).forEach(k => { if (info[k] || !movie[k]) movie[k] = info[k]; });
      paint();
    } catch (e) {
      setText(status, 'Couldn\'t load the details: ' + friendlyError(e));
    }
  }

  paint();
  load();

  return {
    el,
    name: 'vod-detail',
    onShow() { ambience.restore(); paintButtons(); },
    onKey(action) {
      switch (action) {
        case 'left': index = Math.max(0, index - 1); render(); return true;
        case 'right': index = Math.min(buttons.length - 1, index + 1); render(); return true;
        case 'enter': if (buttons[index]) buttons[index].run(); return true;
        case 'play': case 'playpause': playVod(client, movie, false); return true;
        case 'up': case 'down': return true;
      }
      return false;
    },
    get movie() { return movie; },
  };
}
