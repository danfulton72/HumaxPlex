// Channels: discovering the DVR, guide providers and lineup; favourites and
// which list is shown (favourites / all / a group); typing a channel number.
//
// Favourites and the chosen list are remembered on this box. Groups come from
// the "XX|" prefix Dispatcharr channel names carry (offered only if there are
// two or more). Number entry searches every channel, not just the list shown.
import { h, setText } from '../../util/dom.js';
import { getRaw, setRaw } from '../../util/store.js';
import { showOptions } from '../../ui/options.js';
import { channelLabel, channelGroup, chanKey, findByNumber, epgProviderPaths, channelRowsFrom, safeObject } from './helpers.js';

const FAV_KEY = 'easyplexLiveFavourites';
const FILTER_KEY = 'easyplexLiveFilter';
const LAST_KEY = 'easyplexLiveLastChannel';

export function createChannels(ctx) {
  let favourites = new Set();
  try { favourites = new Set(JSON.parse(getRaw(FAV_KEY) || '[]')); } catch (e) { favourites = new Set(); }
  // all = every channel; list = 'auto' | 'fav' | 'all' | 'group:<name>'.
  // debugResponses = what the discovery endpoints returned, for diagnostics.
  const state = { dvrs: [], providers: [], all: [], list: getRaw(FILTER_KEY) || 'auto', debugResponses: [] };
  const digits = { value: '', timer: 0, el: null };

  // ---- loading ----------------------------------------------------------------

  async function load() {
    ctx.el.classList.remove('ep-grid-active');
    ctx.list.innerHTML = '';
    setText(ctx.info, 'Checking Plex DVR and programme guide…');
    try {
      const d = await ctx.server.get('/livetv/dvrs');
      state.dvrs = d.Dvr || d.DVR || d.Directory || [];
      if (!state.dvrs.length) {
        setText(ctx.info, 'No Plex DVR found. Configure a supported tuner in Plex Media Server → Live TV & DVR.');
        ctx.setView('empty');
        return;
      }
      let providersReply = null;
      try { providersReply = await ctx.server.get('/media/providers'); } catch (e) { console.warn('Plex provider discovery:', e.message); }
      state.providers = epgProviderPaths(providersReply, state.dvrs);
      const urls = [];
      for (const prefix of state.providers) {
        urls.push(prefix + '/watchnow/all');
        urls.push(prefix + '/lineups/dvr/channels');
      }
      const replies = await Promise.allSettled(urls.map(url => ctx.server.get(url)));
      state.debugResponses = replies.map((r, i) => ({ name: urls[i], data: r.status === 'fulfilled' ? { keys: Object.keys(r.value), sample: safeObject((r.value.Metadata || r.value.Channel || r.value.Directory || [])[0] || r.value) } : { error: String(r.reason?.message || 'request failed').slice(0, 120) } }));
      const dvrId = String(state.dvrs[0]?.key || state.dvrs[0]?.id || '').replace(/^.*:/, '');
      const rows = channelRowsFrom(urls, replies, dvrId);
      if (!ctx.state.alive) return;
      if (!rows.length) {
        setText(ctx.info, 'DVR found. EPG providers: ' + state.providers.length +
          ' · Successful guide requests: ' + replies.filter(r => r.status === 'fulfilled').length +
          '/' + replies.length + '. Channel listings unavailable; press Green for diagnostics.');
        ctx.setView('empty');
        return;
      }
      state.all = rows;
      ctx.guide.activate();
    } catch (e) {
      setText(ctx.info, 'Live TV unavailable: ' + e.message);
      ctx.setView('empty');
    }
  }

  // ---- favourites and lists ---------------------------------------------------

  function isFavourite(row) { return favourites.has(chanKey(row)); }

  function groups() {
    const out = [];
    for (const r of state.all) { const name = channelGroup(r); if (name && !out.includes(name)) out.push(name); }
    return out.length > 1 ? out : [];
  }

  // The list actually shown ("auto" means favourites once there are any).
  function effectiveList() {
    const l = state.list;
    if (l === 'auto') return favourites.size ? 'fav' : 'all';
    if (l === 'fav' && !favourites.size) return 'all';
    if (l.startsWith('group:') && !groups().includes(l.slice(6))) return 'all';
    return l;
  }
  function listLabel(l) {
    if (l === 'fav') return 'Favourites';
    if (l.startsWith('group:')) return l.slice(6) + ' channels';
    return 'All channels';
  }
  function listName() { return listLabel(effectiveList()); }
  function showingFavourites() { return effectiveList() === 'fav'; }

  // Rebuild the guide's rows for the current list, keeping keepRow selected.
  function applyList(keepRow) {
    const l = effectiveList();
    let rows = state.all;
    if (l === 'fav') rows = state.all.filter(isFavourite);
    else if (l.startsWith('group:')) rows = state.all.filter(r => channelGroup(r) === l.slice(6));
    ctx.guide.setRows(rows.length ? rows : state.all, keepRow);
  }

  function refreshGuide() {
    if (ctx.state.view === 'grid') { ctx.guide.render(); ctx.guide.fill(); }
  }

  function setList(l) {
    state.list = l;
    setRaw(FILTER_KEY, l);
    applyList(ctx.guide.currentRow());
    refreshGuide();
    ctx.say('Showing ' + listName().toLowerCase());
  }

  function toggleFavourite(row) {
    if (!row) return;
    const k = chanKey(row);
    const adding = !favourites.has(k);
    // Keep showing the current list; the default ("auto") switches to
    // favourites the next time Live TV opens.
    if (state.list === 'auto') state.list = effectiveList();
    if (adding) favourites.add(k); else favourites.delete(k);
    setRaw(FAV_KEY, JSON.stringify([...favourites]));
    const name = channelLabel(row.name || row.channel);
    const watching = ctx.state.view === 'playing';
    if (watching) ctx.playback.banner(row, adding ? '★ Added to favourites' : 'Removed from favourites');
    else ctx.say(adding ? '★ ' + name + ' added to favourites' : name + ' removed from favourites');
    // Removing the last favourite while viewing favourites falls back to all.
    applyList(watching ? ctx.playback.state.playing : ctx.guide.currentRow());
    refreshGuide();
  }

  function openListMenu() {
    const l = effectiveList();
    showOptions({
      eyebrow: 'CHANNELS', title: 'Show channels',
      items: [
        { label: favourites.size ? 'Favourites  (' + favourites.size + ')' : 'Favourites  (none yet)', checked: l === 'fav',
          run: () => favourites.size ? setList('fav') : ctx.say('Hold OK on a channel and choose “Add to favourites”') },
        { label: 'All channels  (' + state.all.length + ')', checked: l === 'all', run: () => setList('all') },
        ...groups().map(name => ({ label: name + '  (' + state.all.filter(r => channelGroup(r) === name).length + ')',
          checked: l === 'group:' + name, run: () => setList('group:' + name) })),
      ],
    });
  }

  function lastChannelKey() { return getRaw(LAST_KEY); }
  function rememberLastChannel(row) { setRaw(LAST_KEY, chanKey(row)); }

  // ---- number entry -------------------------------------------------------------

  function showDigits() {
    const row = findByNumber(state.all, digits.value);
    if (ctx.state.view === 'playing') {
      const v = ctx.native();
      if (row) ctx.playback.banner(row, 'Channel ' + digits.value);
      else if (v && v.setLiveBanner) v.setLiveBanner('Channel ' + digits.value + ' …', -1);
      return;
    }
    if (!digits.el) digits.el = h('div', 'hx-digits', ctx.el);
    digits.el.textContent = '';
    h('b', '', digits.el).textContent = digits.value;
    h('span', '', digits.el).textContent = row ? channelLabel(row.name || row.channel) : '…';
    digits.el.style.display = '';
  }
  function hideDigits() { if (digits.el) digits.el.style.display = 'none'; }

  function addDigit(d) {
    digits.value = (digits.value + d).slice(-6);
    clearTimeout(digits.timer);
    showDigits();
    digits.timer = setTimeout(commitDigits, 1800);
  }
  function cancelDigits() {
    clearTimeout(digits.timer);
    digits.value = '';
    hideDigits();
    const playing = ctx.playback.state.playing;
    if (ctx.state.view === 'playing' && playing) ctx.playback.banner(playing);
  }
  function commitDigits() {
    clearTimeout(digits.timer);
    const n = digits.value;
    digits.value = '';
    hideDigits();
    const row = findByNumber(state.all, n);
    const watching = ctx.state.view === 'playing';
    if (!row) {
      const playing = ctx.playback.state.playing;
      if (watching && playing) ctx.playback.banner(playing, 'No channel ' + n);
      else ctx.say('No channel ' + n);
      return;
    }
    if (!ctx.guide.state.rows.includes(row)) {
      state.list = 'all';
      setRaw(FILTER_KEY, 'all');
      applyList(row);
      ctx.say('Showing all channels');
    }
    if (watching) ctx.playback.tuneNow(row);
    else if (ctx.state.view === 'grid') { ctx.guide.selectRow(row); ctx.guide.render(); ctx.guide.fill(); }
  }

  // Digits, and OK/Back while a number is being typed, in the guide or while watching.
  function digitKey(action) {
    if (/^digit\d$/.test(action)) { addDigit(action.slice(5)); return true; }
    if (digits.value && action === 'enter') { commitDigits(); return true; }
    if (digits.value && action === 'back') { cancelDigits(); return true; }
    return false;
  }

  function destroy() { clearTimeout(digits.timer); }

  return {
    state, load, isFavourite, listName, showingFavourites, applyList, toggleFavourite, openListMenu,
    lastChannelKey, rememberLastChannel, digitKey, destroy,
  };
}
