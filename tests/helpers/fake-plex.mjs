// A fake Plex Media Server and native shell for Live TV tests.
//
// Response shapes follow what Plex actually returns (see the field names used
// by Plex Web in Plex Media Server logs, and the /media/subscriptions/scheduled
// shape: MediaContainer.MediaGrabOperation[] with nested Metadata).
export function createFakePlex() {
  const nowS = Math.floor(Date.now() / 1000);
  const state = {
    requests: [],
    schedOps: [
      { id: 'op-a', mediaSubscriptionID: 12, status: 'scheduled', Metadata: { grandparentTitle: 'Rec1', title: 'Pilot', parentIndex: 1, index: 2, summary: 'S', guid: 'plex://episode/p', grandparentGuid: 'plex://show/r', Media: [{ channelTitle: '14365 UK| SKY CINEMA', beginsAt: nowS + 7200, endsAt: nowS + 9000 }] } },
      { id: 'op-b', mediaSubscriptionID: 11, status: 'scheduled', Metadata: { title: 'Rec0', guid: 'plex://movie/0', Media: [{ channelTitle: 'UK| BBC One', beginsAt: nowS + 3600, endsAt: nowS + 5400 }] } },
      { id: 'op-c', mediaSubscriptionID: 12, status: 'scheduled', Metadata: { grandparentTitle: 'Rec1', title: 'Second', parentIndex: 1, index: 3, Media: [{ channelTitle: '14365 UK| SKY CINEMA', beginsAt: nowS + 90000, endsAt: nowS + 92000 }] } },
      { status: 'complete', Metadata: { title: 'Done' } },
    ],
  };
  // One-hour programmes all day on every channel: "<gridKey> <date> <hour>".
  function dayShows(gridKey, date) {
    const [y, m, d] = date.split('-').map(Number);
    const out = [];
    for (let h = 0; h < 24; h++) {
      const s = new Date(y, m - 1, d, h).getTime() / 1000;
      out.push({ title: gridKey + ' ' + date + ' ' + h, guid: 'g' + h, ratingKey: 'r' + h, Media: [{ beginsAt: s, endsAt: s + 3600 }] });
    }
    return out;
  }
  const channels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const server = {
    token: 't',
    url: (p, q) => 'http://pms' + p + '?' + new URLSearchParams(q || {}),
    async sections() {
      return [
        { key: 3, title: 'Films', type: 'movie', Location: [{ id: 30, path: '/films' }] },
        { key: 5, title: 'TV Recordings', type: 'show', Location: [{ id: 50, path: '/tv/a' }, { id: 51, path: '/tv/b' }] },
      ];
    },
    async get(path, params) {
      state.requests.push({ path, params });
      if (path === '/livetv/dvrs') return { Dvr: [{ key: '7', Device: [{ uri: 'http://disp:9191/hdhr' }] }] };
      if (path === '/media/providers') return { MediaProvider: [{ identifier: 'tv.plex.providers.epg.xmltv:7' }] };
      if (path.endsWith('/watchnow/all')) {
        // Deliberately out of order: the guide sorts by channel number.
        return { Metadata: [3, 1, 2, 4, 5, 6, 7, 8, 9, 10].map(n => ({ title: 'Now' + n, type: 'episode',
          Media: [{ channelVcn: String(n), channelTitle: (n <= 6 ? 'UK| ' : 'US| ') + 'Chan' + n, channelIdentifier: 'id' + n, beginsAt: nowS - 60, endsAt: nowS + 60 }] })) };
      }
      if (path.endsWith('/lineups/dvr/channels')) return { Channel: channels.map(n => ({ id: 'id' + n, gridKey: 'gk' + n, channelVcn: String(n) })) };
      if (path.endsWith('/grid')) return { Metadata: dayShows(params.channelGridKey, params.date) };
      if (path === '/media/subscriptions/template') {
        return { SubscriptionTemplate: [{ MediaSubscription: [
          { title: 'This Episode', type: 4, selected: true,
            parameters: 'hints%5Bguid%5D=' + encodeURIComponent(params.guid) + '&hints%5BratingKey%5D=plex%253A%252F%252Fepisode%252Fx&hints%5Btitle%5D=News+at+Ten&params%5BairingTimes%5D=1684184400&params%5BlibraryType%5D=2&params%5BmediaProviderID%5D=3',
            Setting: [{ id: 'minVideoQuality', default: 0, value: 0, type: 'int' }, { id: 'replaceLowerQuality', default: false, value: false, type: 'bool' },
              { id: 'lineupChannel', default: '', type: 'text' }, { id: 'endOffsetMinutes', default: 0, value: 2, type: 'int' }] },
          { title: 'All Episodes', type: 2, airingsType: 'New Airings Only', parameters: 'hints%5Bguid%5D=plex%3A%2F%2Fshow%2Fx&params%5BlibraryType%5D=2&type=2' },
        ] }] };
      }
      if (path === '/media/subscriptions/scheduled') return { MediaGrabOperation: state.schedOps.slice() };
      if (/^\/media\/subscriptions\/\d+$/.test(path)) {
        const id = Number(path.split('/').pop());
        return { MediaSubscription: [{ key: String(id), type: id === 12 ? 2 : 4, title: id === 12 ? 'Rec1' : 'Rec0' }] };
      }
      throw new Error('unexpected ' + path);
    },
  };

  // The Android shell's JavaScript bridge, recording what the page asks of it.
  const native = {
    opened: [], banners: [], menus: [], closed: 0,
    loadHdhrLineup() {
      setTimeout(() => window.__easyplexHdhrLineup(JSON.stringify(channels.map(n => ({ GuideNumber: String(n), GuideName: 'Chan' + n, URL: 'http://disp/ch' + n })))));
    },
    open(u) { native.opened.push(u); },
    close() { native.closed++; },
    setLiveBanner(t, p) { native.banners.push({ t, p }); },
    showMenu(t, j) { native.menus.push({ t, items: JSON.parse(j) }); },
  };
  return { server, native, state, nowS };
}

// fetch() stand-in for POST/DELETE calls; handler(url, opts) returns
// { status, body } (body string), defaulting to 200 '{}'.
export function fakeFetch(handler, log = []) {
  return async (url, opts = {}) => {
    log.push({ url, method: opts.method || 'GET' });
    const r = (handler && handler(url, opts)) || {};
    const status = r.status || 200;
    return { ok: status < 400, status, text: async () => (r.body != null ? r.body : '{}') };
  };
}
