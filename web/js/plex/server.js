// Plex Media Server API, scoped to the features this client uses.
import { request, withQuery, identity } from './client.js';

const SUPPORTED_HUB_TYPES = { movie: 1, show: 1, episode: 1, season: 1, mixed: 1, clip: 1 };

export class Server {
  constructor({ uri, token, name, id }) {
    this.uri = uri;
    this.token = token;
    this.name = name;
    this.id = id;
    this.cache = new Map();
  }

  async get(path, params, { maxAge = 0 } = {}) {
    const key = withQuery(path, params);
    if (maxAge) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.t < maxAge) return hit.data;
    }
    const json = await request(this.uri + path, { token: this.token, params });
    const data = json.MediaContainer || json;
    if (maxAge) this.cache.set(key, { t: Date.now(), data });
    return data;
  }

  invalidate() {
    this.cache.clear();
  }

  // Posters/backdrops resized (and optionally blurred) by the server, so the TV
  // only ever downloads and decodes pixels it actually shows.
  image(path, width, height, { blur = 0, quality = 85, format = 'jpeg' } = {}) {
    if (!path) return '';
    if (typeof EasyPlexVideo !== 'undefined') {
      return 'https://appassets.androidplatform.net/pleximg?url=' + encodeURIComponent(this.url(path));
    }
    return withQuery(this.uri + '/photo/:/transcode', {
      width, height, minSize: 1, upscale: 1, blur: blur || undefined,
      quality, format, url: path, 'X-Plex-Token': this.token,
    });
  }

  url(path, params) {
    return withQuery(this.uri + path, Object.assign({ 'X-Plex-Token': this.token }, params));
  }

  async sections() {
    const mc = await this.get('/library/sections', null, { maxAge: 300000 });
    return (mc.Directory || []).filter(d => d.type === 'movie' || d.type === 'show');
  }

  async hubs() {
    const mc = await this.get('/hubs', { count: 24, includeExternalMedia: 0 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  // Cross-library "Recently Added" rows for Home (Option B): Plex's own
  // home.movies.recent / home.television.recent hubs, trimmed to RECENT_LIMIT,
  // with anything already in Continue Watching removed so an item doesn't appear
  // twice, and capped at one item per creator (channel/show for TV, studio for
  // movies) so a single prolific source doesn't fill the whole row. Returns []
  // when neither hub is present.
  async recentHubs(limit = 12) {
    const mc = await this.get('/hubs', { count: 24, includeExternalMedia: 0 });
    const watching = new Set((await this.onDeck()).map(m => m.ratingKey));
    const out = [];
    for (const h of (mc.Hub || [])) {
      const isTv = h.hubIdentifier === 'home.television.recent';
      if (!isTv && h.hubIdentifier !== 'home.movies.recent') continue;
      const seenCreators = new Set();
      const meta = [];
      for (const m of (h.Metadata || [])) {
        if (watching.has(m.ratingKey)) continue;
        const creator = isTv
          ? (m.grandparentTitle || '')
          : (m.studio || ((m.Director && m.Director[0] && m.Director[0].tag) || ''));
        if (creator && seenCreators.has(creator)) continue;
        if (creator) seenCreators.add(creator);
        meta.push(m);
        if (meta.length >= limit) break;
      }
      if (meta.length) out.push({ ...h, Metadata: meta, size: meta.length });
    }
    return out;
  }

  // In-progress items (Continue Watching / On Deck) across the whole server,
  // used to keep Recently Added from duplicating something you're mid-way through.
  async onDeck() {
    const mc = await this.get('/hubs', { count: 24, includeExternalMedia: 0 });
    const keys = ['home.continue', 'home.ondeck'];
    const out = [];
    for (const h of (mc.Hub || [])) {
      if (!keys.includes(h.hubIdentifier)) continue;
      for (const m of (h.Metadata || [])) out.push(m);
    }
    return out;
  }

  // Recently added items within ONE section (Option A). Shows use type=episode
  // so a freshly added series surfaces its newest episodes, not just the show.
  // Trimmed to `limit`, deduped against in-progress items, and capped at one
  // item per creator (channel/show for shows, studio/director for movies) so a
  // single prolific source doesn't fill the whole row.
  async recentItems(sectionId, { type, limit = 12, isShow = false } = {}) {
    const [res, watching] = await Promise.all([
      this.items(sectionId, 0, limit * 3, { sort: 'addedAt:desc', type }),
      this.onDeck(),
    ]);
    const seenKeys = new Set(watching.map(m => m.ratingKey));
    const seenCreators = new Set();
    const out = [];
    for (const it of res.items) {
      if (seenKeys.has(it.ratingKey)) continue;
      const creator = isShow
        ? (it.grandparentTitle || '')
        : (it.studio || ((it.Director && it.Director[0] && it.Director[0].tag) || it.title || ''));
      // Only dedupe when there IS a creator to group by; an empty key means
      // "no grouping info" and the item always shows (never hidden by accident).
      if (creator && seenCreators.has(creator)) continue;
      seenKeys.add(it.ratingKey);
      if (creator) seenCreators.add(creator);
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  }

  async sectionHubs(sectionId) {
    const mc = await this.get('/hubs/sections/' + sectionId, { count: 24 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  async items(sectionId, start, size, { sort = 'titleSort', type, filter = {} } = {}) {
    const mc = await this.get('/library/sections/' + sectionId + '/all', {
      sort, type, ...filter,
      'X-Plex-Container-Start': start,
      'X-Plex-Container-Size': size,
      excludeFields: 'summary,tagline',
    });
    return { total: mc.totalSize != null ? mc.totalSize : mc.size, items: mc.Metadata || [] };
  }

  async metadata(ratingKey) {
    const mc = await this.get('/library/metadata/' + ratingKey, { includeOnDeck: 1, includeExtras: 0 });
    const item = (mc.Metadata || [])[0];
    if (item && mc.OnDeck && mc.OnDeck.Metadata) item.onDeck = mc.OnDeck.Metadata[0];
    return item;
  }

  async children(ratingKey) {
    const mc = await this.get('/library/metadata/' + ratingKey + '/children', { excludeAllLeaves: 1 });
    return mc.Metadata || [];
  }

  async search(q) {
    const mc = await this.get('/hubs/search', { query: q, limit: 30, includeCollections: 0 });
    return (mc.Hub || []).filter(h => h.size > 0 && SUPPORTED_HUB_TYPES[h.type] && h.Metadata);
  }

  timeline(params) {
    return request(this.uri + '/:/timeline', { token: this.token, params, timeout: 8000 }).catch(() => {});
  }

  scrobble(ratingKey) {
    return request(this.uri + '/:/scrobble', {
      token: this.token, params: { identifier: 'com.plexapp.plugins.library', key: ratingKey },
    });
  }

  unscrobble(ratingKey) {
    return request(this.uri + '/:/unscrobble', {
      token: this.token, params: { identifier: 'com.plexapp.plugins.library', key: ratingKey },
    });
  }

  // HLS URL for content the TV can't direct play. Video is passed through when
  // possible; only the audio (e.g. DTS) or container gets converted.
  transcodeUrl(item, { session, offsetMs = 0, mediaIndex = 0, maxBitrate = 40000, resolution = '3840x2160', audioStreamID, subtitleStreamID } = {}) {
    // Declare only what the box can direct-play. Do NOT send an
    // add-transcode-target directive: Plex already has a built-in HLS
    // transcode target, and adding a duplicate (same context=streaming +
    // protocol=hls) makes the server reject the whole request with
    // "ClientProfileExtra: video transcode target already exists for
    // streaming hls" -> 400 -> playback error on screen.
    const extra = [
      'add-direct-play-profile(type=videoProfile&container=mp4,mkv&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3)',
    ].join('+');
    return withQuery(this.uri + '/video/:/transcode/universal/start.m3u8', Object.assign({}, identity(), {
      path: '/library/metadata/' + item.ratingKey,
      mediaIndex, partIndex: 0,
      protocol: 'hls', fastSeek: 1,
      directPlay: 0, directStream: 1, directStreamAudio: 1,
      offset: Math.floor(offsetMs / 1000),
      videoQuality: 100, videoResolution: resolution, maxVideoBitrate: maxBitrate,
      subtitles: subtitleStreamID ? 'burn' : 'none', subtitleSize: 100,
      audioBoost: 100, location: 'lan', copyts: 1,
      session, 'X-Plex-Session-Identifier': session,
      'X-Plex-Client-Profile-Extra': extra,
      'X-Plex-Token': this.token,
    }));
  }

  // Selected audio/subtitle streams are stored per part on the server.
  selectStreams(partId, { audioStreamID, subtitleStreamID }) {
    return request(this.uri + '/library/parts/' + partId, {
      method: 'PUT', token: this.token,
      params: { audioStreamID, subtitleStreamID, allParts: 1 },
    }).catch(() => {});
  }

  stopTranscode(session) {
    return request(this.uri + '/video/:/transcode/universal/stop', {
      token: this.token, params: { session }, timeout: 5000,
    }).catch(() => {});
  }
}
