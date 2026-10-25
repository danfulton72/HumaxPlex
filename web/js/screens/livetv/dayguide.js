// One channel's programmes for a day, as a list (Yellow / "Channel day guide").
import { h, setText } from '../../util/dom.js';
import { DAY, localDate, airingBounds, hhmm, titleOf, channelLabel } from './helpers.js';

export function createDayGuide(ctx) {
  // entries = programmes shown; index = selected; day = days ahead of today.
  const state = { entries: [], index: 0, day: 0, channel: null };

  function focus() {
    Array.from(ctx.list.children).forEach((node, i) => node.classList.toggle('focus', i === state.index));
    const e = state.entries[state.index];
    if (e) setText(ctx.details, e.subtitle);
    const node = ctx.list.children[state.index];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    ctx.el.classList.remove('ep-grid-active', 'ep-sched-active');
    ctx.list.innerHTML = '';
    state.entries.forEach(e => {
      const row = h('div', 'ep-live-row', ctx.list);
      h('span', 'ep-live-channel', row).textContent = e.channel;
      h('span', 'ep-live-show', row).textContent = e.title;
    });
    focus();
  }

  function openFor(row) {
    if (!row) return;
    if (!row.gridKey || !ctx.channels.state.providers.length) {
      ctx.say('Channel lineup did not provide a matching guide key. Press Green for diagnostics.');
      return;
    }
    state.channel = row;
    openDay(0);
  }

  async function openDay(delta) {
    ctx.setView('guide');
    state.day = Math.max(0, Math.min(7, delta));
    const date = localDate(Date.now() + state.day * DAY);
    const channel = state.channel;
    ctx.el.classList.remove('ep-grid-active');
    setText(ctx.info, 'Guide: ' + channelLabel(channel.name || channel.channel) + ' · ' + date +
      ' · Left/Right: day · OK: record · Play: watch · Back: guide grid');
    setText(ctx.details, 'Loading channel schedule…');
    state.entries = [];
    render();
    try {
      const shows = (await ctx.guide.fetchDay(channel, date)).slice()
        .sort((a, b) => airingBounds(a).start - airingBounds(b).start);
      if (ctx.state.view !== 'guide') return;
      state.entries = shows.map(m => ({
        channel: hhmm(airingBounds(m).start),
        title: titleOf(m),
        subtitle: m.summary || m.title || '',
        item: m, gridKey: channel.gridKey, channelId: channel.channelId, channelVcn: channel.channelVcn,
      }));
      // Start on the programme that is on now when viewing today.
      const nowIdx = state.day === 0 ? state.entries.findIndex(e => airingBounds(e.item).end > Date.now()) : 0;
      state.index = Math.max(0, nowIdx);
      render();
      if (!state.entries.length) setText(ctx.details, 'No scheduled programmes received for this date.');
    } catch (e) { setText(ctx.details, 'Guide request failed: ' + e.message); }
  }

  function selectedProgramme() { return state.entries[state.index]?.item || null; }

  function onKey(action) {
    switch (action) {
      case 'up': state.index = Math.max(0, state.index - 1); focus(); return true;
      case 'down': state.index = Math.min(state.entries.length - 1, state.index + 1); focus(); return true;
      case 'left': openDay(state.day - 1); return true;
      case 'right': openDay(state.day + 1); return true;
      case 'enter': case 'record': case 'red': ctx.record.open(); return true;
      case 'play': case 'playpause': ctx.playback.tuneRow(state.channel); return true;
      case 'green': ctx.diagnostics.show(0); return true;
      case 'back': case 'yellow': ctx.guide.show(); return true;
      default: return true;
    }
  }

  return { state, openFor, render, selectedProgramme, onKey };
}
