// Recordings (Blue): upcoming and in-progress recordings in the guide's
// layout, and cancelling them.
//
// A one-off rule (single episode or film) is removed outright. For a series
// rule the viewer chooses: skip just this airing (cancel the grab; Plex
// forgets this if the server restarts) or delete the whole series rule.
import { h } from '../../util/dom.js';
import { ROWS, hhmm, dayLabel, mins, scheduledEntries } from './helpers.js';

export function createSchedule(ctx) {
  // status = 'loading' | 'ready' | 'error'; top = first visible row.
  const state = { entries: [], index: 0, top: 0, status: 'loading', error: '' };
  let screen = null, cancel = null, cancelEl = null;
  const sg = {};

  function build() {
    screen = h('div', 'hx-sched', ctx.el);
    const top = h('div', 'hx-top', screen);
    h('div', 'hx-title', top).textContent = 'Recordings';
    sg.clock = h('div', 'hx-clock', top);
    const panel = h('section', 'hx-info', screen);
    const main = h('div', 'hx-info-main', panel);
    sg.ch = h('div', 'hx-info-ch', main);
    sg.title = h('h2', 'hx-info-title', main);
    sg.sub = h('div', 'hx-info-sub', main);
    sg.meta = h('div', 'hx-info-meta', main);
    const side = h('div', 'hx-info-side', panel);
    sg.summary = h('p', 'hx-info-summary', side);
    sg.chips = h('div', 'hx-chips', side);
    const head = h('div', 'hx-times', screen);
    h('div', 'hx-day', head).textContent = 'WHEN';
    sg.count = h('div', 'hx-day hx-sched-count', head);
    sg.rows = h('div', 'hx-rows', screen);
    const keys = h('footer', 'hx-keys', screen);
    const key = (label, kind, value) => {
      const item = h('span', '', keys);
      const k = h('span', kind, item);
      if (kind === 'hx-dot') k.style.background = value; else k.textContent = value;
      item.appendChild(document.createTextNode(label));
    };
    key('Choose', 'hx-glyph', '▲▼');
    key('Page', 'hx-glyph', 'CH+ CH−');
    key('Cancel recording', 'hx-key', 'OK');
    h('span', 'hx-sp', keys);
    key('Back to guide', 'hx-key', 'Back');
  }

  function render() {
    if (!screen) build();
    ctx.el.classList.remove('ep-grid-active');
    ctx.el.classList.add('ep-sched-active');
    const { entries } = state;
    const now = Date.now();
    sg.clock.textContent = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ';
    h('b', '', sg.clock).textContent = hhmm(now);
    sg.count.textContent = state.status === 'ready' && entries.length ?
      entries.length + (entries.length === 1 ? ' RECORDING SCHEDULED' : ' RECORDINGS SCHEDULED') : '';
    if (state.index < state.top) state.top = state.index;
    if (state.index >= state.top + ROWS) state.top = state.index - ROWS + 1;
    state.top = Math.max(0, Math.min(state.top, Math.max(0, entries.length - ROWS)));
    sg.rows.textContent = '';
    entries.slice(state.top, state.top + ROWS).forEach((e, i) => {
      const sel = state.top + i === state.index;
      const line = h('div', 'hx-row' + (sel ? ' sel' : ''), sg.rows);
      const when = h('div', 'hx-ch hx-when', line);
      h('span', 'hx-when-day', when).textContent = Number.isFinite(e.start) ? dayLabel(e.start) : '';
      h('span', 'hx-when-time', when).textContent = Number.isFinite(e.start) ? hhmm(e.start) + ' – ' + hhmm(e.end) : '--:--';
      const block = h('div', 'hx-prog hx-sched-prog' + (sel ? ' focus' : e.start <= now ? ' on' : ''), line);
      h('div', 'hx-pt rec', block).textContent = e.title;
      h('div', 'hx-pm', block).textContent = [e.episode, e.channel].filter(Boolean).join('  ·  ');
    });
    const e = entries[state.index];
    sg.meta.textContent = ''; sg.chips.textContent = ''; sg.sub.textContent = '';
    if (!e) {
      sg.ch.textContent = '';
      sg.title.textContent = state.status === 'loading' ? 'Loading recordings…' :
        state.status === 'error' ? 'Unable to load recordings' : 'No scheduled recordings';
      sg.summary.textContent = state.status === 'error' ? state.error :
        state.status === 'loading' ? '' : 'Programmes you record from the guide appear here.';
      return;
    }
    sg.ch.textContent = '';
    h('b', '', sg.ch).textContent = '● ' + (e.start <= now ? 'RECORDING NOW' : 'SCHEDULED');
    sg.ch.appendChild(document.createTextNode(e.channel || ''));
    sg.title.textContent = e.title;
    sg.sub.textContent = e.episode;
    if (Number.isFinite(e.start)) {
      h('span', '', sg.meta).textContent = dayLabel(e.start) + ' ' + hhmm(e.start) + ' – ' + hhmm(e.end);
      if (e.start > now) h('span', '', sg.meta).textContent = 'Starts in ' + mins(e.start - now);
      else if (e.end > now) {
        const bar = h('div', 'hx-bar', sg.meta);
        h('i', '', bar).style.width = Math.round((now - e.start) / (e.end - e.start) * 100) + '%';
        h('span', '', sg.meta).textContent = mins(e.end - now) + ' left';
      }
    }
    sg.summary.textContent = e.summary || '';
    const md = e.md || {};
    for (const genre of (md.Genre || []).slice(0, 3)) if (genre?.tag) h('span', '', sg.chips).textContent = genre.tag;
    if (md.year) h('span', '', sg.chips).textContent = String(md.year);
    if (Number.isFinite(e.start) && e.end > e.start) h('span', '', sg.chips).textContent = mins(e.end - e.start);
  }

  // keepIndex: refresh in place after a cancel instead of starting at the top.
  async function show(keepIndex) {
    const wasIndex = state.index;
    ctx.setView('schedule');
    Object.assign(state, { entries: [], index: 0, top: 0, status: 'loading' });
    if (!keepIndex) ctx.say('');
    render();
    try {
      const mc = await ctx.server.get('/media/subscriptions/scheduled');
      if (ctx.state.view !== 'schedule') return;
      state.entries = scheduledEntries(mc);
      state.status = 'ready';
      if (keepIndex) state.index = Math.max(0, Math.min(wasIndex, state.entries.length - 1));
      render();
    } catch (e) {
      if (ctx.state.view !== 'schedule') return;
      state.status = 'error';
      state.error = e.message;
      render();
    }
  }

  // ---- cancelling -----------------------------------------------------------------

  async function openCancel() {
    const e = state.entries[state.index];
    if (!e || cancel) return;
    const op = e.item || {};
    const subId = op.mediaSubscriptionID;
    const opId = op.id || (String(op.key || '').split('/').pop());
    cancel = { e, opId, subId, idx: 0, busy: false, status: '', items: [] };
    ctx.setView('cancel');
    renderCancel();
    // Work out whether the rule covers more than this airing.
    let subType = null, ruleTitle = '';
    if (subId != null) {
      try {
        const mc = await ctx.server.get('/media/subscriptions/' + encodeURIComponent(subId));
        const sub = (mc.MediaSubscription || [])[0] || {};
        subType = sub.type != null ? Number(sub.type) : null;
        ruleTitle = sub.title || '';
      } catch (err) { /* fall back to counting airings */ }
    }
    if (!cancel || cancel.e !== e) return;
    const siblings = state.entries.filter(x => x.item?.mediaSubscriptionID != null && x.item.mediaSubscriptionID === subId).length;
    const series = subType != null ? (subType === 2 || subType === 3) : siblings > 1;
    const items = [];
    if (series) {
      if (opId) items.push(['Skip this episode only', 'grab']);
      if (subId != null) items.push(['Cancel series recording' + (siblings > 1 ? ' (' + siblings + ' scheduled)' : '') +
        (ruleTitle ? ' · ' + ruleTitle : ''), 'sub']);
    } else if (subId != null) items.push(['Cancel this recording', 'sub']);
    else if (opId) items.push(['Cancel this recording', 'grab']);
    items.push(['Keep recording', 'keep']);
    cancel.items = items;
    cancel.series = series;
    renderCancel();
  }

  function renderCancel() {
    if (!cancelEl) {
      cancelEl = h('div', 'hx-dialog', ctx.el);
      const box = h('div', 'hx-dlg hx-menu hx-cancel', cancelEl);
      h('div', 'hx-dlg-eyebrow', box).textContent = 'CANCEL RECORDING';
      cancelEl._title = h('h2', 'hx-dlg-title', box);
      cancelEl._sub = h('div', 'hx-dlg-sub', box);
      cancelEl._list = h('div', 'hx-menu-list', box);
      cancelEl._status = h('div', 'hx-dlg-status', box);
      h('div', 'hx-dlg-hint', box).textContent = '▲▼ choose · OK select · Back keep';
    }
    cancelEl.style.display = '';
    const e = cancel.e;
    cancelEl._title.textContent = e.title;
    cancelEl._sub.textContent = [e.episode, Number.isFinite(e.start) ? dayLabel(e.start) + ' ' + hhmm(e.start) + ' – ' + hhmm(e.end) : '',
      e.channel].filter(Boolean).join('  ·  ');
    cancelEl._list.textContent = '';
    if (!cancel.items.length) h('div', 'hx-dlg-sub', cancelEl._list).textContent = 'Checking recording rule…';
    cancel.items.forEach(([label], i) => {
      h('div', 'hx-btn hx-menu-item' + (i === cancel.idx ? ' focus' : ''), cancelEl._list).textContent = label;
    });
    cancelEl._status.textContent = cancel.status || '';
  }

  function closeCancel() {
    if (cancelEl) cancelEl.style.display = 'none';
    cancel = null;
    ctx.setView('schedule');
    render();
  }

  async function confirmCancel() {
    const choice = cancel.items[cancel.idx];
    if (!choice || cancel.busy) return;
    const [, what] = choice;
    if (what === 'keep') { closeCancel(); return; }
    const { e, opId, subId } = cancel;
    cancel.busy = true; cancel.status = 'Cancelling…'; renderCancel();
    try {
      if (what === 'grab') await ctx.api.del('/media/grabbers/operations/' + encodeURIComponent(opId));
      else await ctx.api.del('/media/subscriptions/' + encodeURIComponent(subId));
    } catch (err) {
      if (!cancel) return;
      cancel.busy = false; cancel.status = 'Not cancelled: ' + err.message; renderCancel();
      return;
    }
    const md = e.md || {};
    const guids = ctx.guide.state.scheduledGuids;
    if (md.guid) guids.delete(md.guid);
    if (what === 'sub' && md.grandparentGuid) guids.delete(md.grandparentGuid);
    const wasSeries = cancel.series;
    closeCancel();
    ctx.say(what === 'grab' ? 'Skipped: ' + e.title + (e.episode ? ' · ' + e.episode : '') :
      'Cancelled: ' + e.title + (wasSeries ? ' (series)' : ''));
    ctx.guide.loadScheduled();
    show(true);
  }

  function cancelKey(action) {
    if (!cancel) return true;
    switch (action) {
      case 'up': cancel.idx = Math.max(0, cancel.idx - 1); renderCancel(); return true;
      case 'down': cancel.idx = Math.min(Math.max(0, cancel.items.length - 1), cancel.idx + 1); renderCancel(); return true;
      case 'enter': case 'red': case 'record': confirmCancel(); return true;
      case 'back': case 'menu': if (!cancel.busy) closeCancel(); return true;
      default: return true;
    }
  }

  function onKey(action) {
    switch (action) {
      case 'up': state.index = Math.max(0, state.index - 1); render(); return true;
      case 'down': state.index = Math.max(0, Math.min(state.entries.length - 1, state.index + 1)); render(); return true;
      case 'pageup': state.index = Math.max(0, state.index - ROWS); state.top = state.index; render(); return true;
      case 'pagedown': state.index = Math.max(0, Math.min(state.entries.length - 1, state.index + ROWS)); state.top = state.index; render(); return true;
      case 'enter': case 'red': case 'record': case 'menu': openCancel(); return true;
      case 'back': case 'left': case 'blue': ctx.guide.show(); return true;
      default: return true;
    }
  }

  return { state, show, onKey, cancelKey };
}
