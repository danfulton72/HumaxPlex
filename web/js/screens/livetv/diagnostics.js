// Diagnostics pages (Green) and the Plex tuning report: what Plex returned,
// what the guide has cached, and the last recording request.
import { h } from '../../util/dom.js';
import { safeObject, recordAttemptText, templateText } from './helpers.js';

const TUNE_TITLE = 'Plex tuning diagnostics — Down: next · Back: close';

export function createDiagnostics(ctx) {
  // page = page shown; back = the view to return to; report = tuning lines.
  const state = { page: 0, back: 'grid', report: [] };
  let panel = null;

  function overlay(title) {
    if (!panel) {
      panel = h('div', 'ep-live-debug', ctx.el);
      h('div', 'ep-debug-title', panel);
      h('pre', 'ep-debug-content', panel);
    }
    panel.querySelector('.ep-debug-title').textContent = title;
    panel.style.display = '';
    return panel.querySelector('pre');
  }

  function hide() { if (panel) panel.style.display = 'none'; }

  function close() {
    hide();
    if (state.back === 'guide' && ctx.dayguide.state.channel) { ctx.setView('guide'); ctx.dayguide.render(); }
    else if (!ctx.guide.state.rows.length) ctx.setView('empty');
    else ctx.guide.show();
  }

  function cards() {
    const fromGuide = state.back === 'grid';
    const selected = fromGuide ? ctx.guide.currentRow() : ctx.dayguide.state.entries[ctx.dayguide.state.index];
    const sel = fromGuide ? ctx.guide.selected() : null;
    const cache = ctx.guide.cache;
    return [
      ['Selected programme', selected ? { fields: Object.keys(selected.item || {}), mediaFields: Object.keys(selected.item?.Media?.[0] || {}), channelFields: Object.keys(selected.item?.Channel?.[0] || {}), values: safeObject(selected.item) } : 'none'],
      ['Selected channel', selected ? safeObject({ channelTitle: selected.channel, gridKey: selected.gridKey, channelIdentifier: selected.channelId, channelVcn: selected.channelVcn }) : 'none'],
      ['Guide cache', sel ? {
        cachedDays: [...cache.keys()].filter(k => k.endsWith(':' + sel.row.gridKey)).map(k => k.split(':')[0] + ' (' + cache.get(k).shows.length + ')'),
        programmeAtCursor: sel.programme ? safeObject(sel.programme) : 'none',
        totalCachedDays: cache.size,
      } : 'n/a'],
      ['Last recording request', recordAttemptText(ctx.record.state.attempts)],
      ['Recording template', templateText(ctx.record.state.template)],
      ['Plex DVRs', ctx.channels.state.dvrs.map(d => safeObject(d))],
      ['EPG providers', ctx.channels.state.providers],
      ...ctx.channels.state.debugResponses.map((r, i) => ['Endpoint ' + (i + 1) + ' ' + r.name, r.data]),
    ];
  }

  // Page 0 is the selected programme; page 3 the last recording request.
  function show(page = state.page) {
    if (ctx.state.view !== 'debug') state.back = ctx.state.view === 'guide' ? 'guide' : 'grid';
    ctx.setView('debug');
    const pre = overlay('Live TV diagnostics — Up/Down: page · Back closes');
    const all = cards();
    state.page = Math.max(0, Math.min(page, all.length - 1));
    const [name, value] = all[state.page];
    pre.textContent = 'PAGE ' + (state.page + 1) + ' / ' + all.length + '\n' + name + '\n\n' +
      (typeof value === 'string' ? value : JSON.stringify(value, null, 2)).slice(0, 4000);
  }

  function showTuneReport(lines, title) {
    state.report = lines;
    state.page = 0;
    state.back = 'grid';
    ctx.setView('tune-debug');
    renderTuneReport(title);
  }
  function renderTuneReport(title) {
    overlay(title || TUNE_TITLE).textContent =
      'TUNE REPORT · page ' + (state.page + 1) + '\n' + state.report.slice(state.page * 25, (state.page + 1) * 25).join('\n');
  }

  function onKey(action) {
    if (ctx.state.view === 'tune-debug') {
      if (action === 'down' || action === 'pagedown') { state.page = Math.min(Math.floor((state.report.length - 1) / 25), state.page + 1); renderTuneReport(); return true; }
      if (action === 'up' || action === 'pageup') { state.page = Math.max(0, state.page - 1); renderTuneReport(); return true; }
      if (action === 'back' || action === 'enter') { close(); return true; }
      return true;
    }
    if (action === 'pageup' || action === 'up' || action === 'left') { show(state.page - 1); return true; }
    if (action === 'pagedown' || action === 'down' || action === 'right') { show(state.page + 1); return true; }
    if (action === 'back' || action === 'enter' || action === 'green') { close(); return true; }
    return true;
  }

  return { state, show, hide, close, showTuneReport, onKey };
}
