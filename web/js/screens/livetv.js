// Live TV & DVR screen: the coordinator for the modules in ./livetv/.
//
//   channels    finding channels, favourites and lists, number entry
//   guide       the guide grid and its info panel
//   dayguide    one channel's day as a list
//   schedule    the recordings screen and cancelling
//   record      the record dialog and creating recording rules
//   playback    watching, zapping, failures
//   diagnostics the Green pages and the tuning report
//
// Each module keeps its own state; they reach each other through `ctx`. The
// coordinator owns the current view and sends each key to the module for it.
//
// Remote keys
//   Guide grid : arrows move · OK/Play watch · Record/Red record · FF/RW ±1 day
//                Blue recordings · Yellow channel day guide · Green diagnostics
//                Hold OK (or Menu) for an options list · 0-9 channel number
//   Watching   : Up/CH+ next channel · Down/CH− previous · Left/Last previous
//                channel · OK/Info now & next · Right audio/subtitles · Back guide
//                Hold OK record / favourite · 0-9 channel number
import { h, setText } from '../util/dom.js';
import { session } from '../session.js';
import { useAmbience } from '../ui/backdrop.js';
import { showOptions } from '../ui/options.js';
import { channelLabel } from './livetv/helpers.js';
import { createApi } from './livetv/api.js';
import { createChannels } from './livetv/channels.js';
import { createGuide } from './livetv/guide.js';
import { createDayGuide } from './livetv/dayguide.js';
import { createSchedule } from './livetv/schedule.js';
import { createRecord } from './livetv/record.js';
import { createPlayback } from './livetv/playback.js';
import { createDiagnostics } from './livetv/diagnostics.js';

// Pure helpers, re-exported for callers and tests that import them from here.
export { localDate, toMillis, airingBounds, airingIn, channelLabel, sortByChannelNumber } from './livetv/helpers.js';

// Every view the screen can be in. setView() refuses anything else, so a typo
// fails loudly instead of leaving the remote dead.
const VIEWS = new Set(['loading', 'empty', 'grid', 'guide', 'schedule', 'cancel', 'record', 'debug', 'tune-debug', 'playing']);

export function LiveTvScreen({ autoplay = false } = {}) {
  const el = h('div', 'screen settings ep-live');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Live TV & DVR';
  const server = session.server;
  let sayTimer = 0;

  const ctx = {
    el,
    info: h('div', 'ep-live-status', el),     // status line (loading, day guide)
    list: h('div', 'ep-live-list', el),       // day guide list
    details: h('div', 'ep-live-detail', el),  // messages; a toast over the guide
    server,
    api: createApi(server),
    state: { view: 'loading', alive: true, autoplay },
    setView(view) {
      if (!VIEWS.has(view)) throw new Error('Live TV: unknown view "' + view + '"');
      ctx.state.view = view;
    },
    // A message; over the guide and recordings it clears itself.
    say(text) {
      setText(ctx.details, text);
      clearTimeout(sayTimer);
      const v = ctx.state.view;
      if ((v === 'grid' || v === 'schedule') && text) {
        sayTimer = setTimeout(() => { if (ctx.details._text === String(text)) setText(ctx.details, ''); }, 7000);
      }
    },
    native: () => (typeof EasyPlexVideo !== 'undefined' ? EasyPlexVideo : null),
  };
  ctx.channels = createChannels(ctx);
  ctx.guide = createGuide(ctx);
  ctx.dayguide = createDayGuide(ctx);
  ctx.schedule = createSchedule(ctx);
  ctx.record = createRecord(ctx);
  ctx.playback = createPlayback(ctx);
  ctx.diagnostics = createDiagnostics(ctx);

  // Hold OK / Menu in the guide or day guide: everything the colour and
  // record keys do, for remotes without them.
  function openMenu() {
    const items = [];
    const debug = { label: 'Diagnostics', run: () => ctx.diagnostics.show(0) };
    if (ctx.state.view === 'grid') {
      const row = ctx.guide.currentRow();
      items.push({ label: 'Watch channel', run: () => ctx.playback.tuneRow(row) });
      if (ctx.guide.selected()?.programme) items.push({ label: 'Record…', run: () => ctx.record.open() });
      if (row) items.push({ label: ctx.channels.isFavourite(row) ? 'Remove from favourites' : 'Add to favourites', run: () => ctx.channels.toggleFavourite(row) });
      items.push({ label: 'Channels: ' + ctx.channels.listName() + '…', run: ctx.channels.openListMenu });
      items.push({ label: 'Recordings', run: () => ctx.schedule.show() });
      items.push({ label: 'Channel day guide', run: () => ctx.dayguide.openFor(row) });
      items.push(debug);
      showOptions({ title: row ? channelLabel(row.name || row.channel) : 'Live TV', items, focus: 0 });
    } else if (ctx.state.view === 'guide') {
      const channel = ctx.dayguide.state.channel;
      if (ctx.dayguide.selectedProgramme()) items.push({ label: 'Record…', run: () => ctx.record.open() });
      items.push({ label: 'Watch channel', run: () => ctx.playback.tuneRow(channel) });
      items.push({ label: 'Back to guide', run: () => ctx.guide.show() });
      items.push(debug);
      showOptions({ title: channel ? channelLabel(channel.name || channel.channel) : 'Live TV', items, focus: 0 });
    }
  }

  // Leaving the app stops live TV (the native side has already closed the video).
  function onLifecycle(e) { if (e.detail === 'stop' && ctx.state.view === 'playing') ctx.playback.stop(); }
  window.addEventListener('easyplex:lifecycle', onLifecycle);

  ctx.channels.load();

  return {
    el,
    name: 'livetv',
    onShow() { ambience.restore(); },
    onKey(action) {
      const view = ctx.state.view;
      if (action === 'menu' && (view === 'grid' || view === 'guide')) { openMenu(); return true; }
      if ((view === 'grid' || view === 'playing') && ctx.channels.digitKey(action)) return true;
      switch (view) {
        case 'playing': return ctx.playback.onKey(action);
        case 'grid': return ctx.guide.onKey(action);
        case 'guide': return ctx.dayguide.onKey(action);
        case 'schedule': return ctx.schedule.onKey(action);
        case 'cancel': return ctx.schedule.cancelKey(action);
        case 'record': return ctx.record.onKey(action);
        case 'debug': case 'tune-debug': return ctx.diagnostics.onKey(action);
        case 'empty':
          if (action === 'green') { ctx.diagnostics.show(0); return true; }
          return false;
        default: return false;
      }
    },
    destroy() {
      ctx.state.alive = false;
      window.removeEventListener('easyplex:lifecycle', onLifecycle);
      clearTimeout(sayTimer);
      ctx.channels.destroy();
      ctx.guide.destroy();
      ctx.playback.destroy();
    },
  };
}
