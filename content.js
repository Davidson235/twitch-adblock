// Twitch adblock (v5) — MAIN world content script.
// Facts this is built on:
//   * Twitch fetches HLS playlists inside a blob: Web Worker (page fetch/XHR sees 0 m3u8).
//   * The worker blob is tiny (98 B) => it is a loader; the real code arrives later.
//   * Ads are SSAI: ad segments live in the same playlist/CDN as the stream.
//   * A PlaybackAccessToken issued for playerType=embed/popout/autoplay returns a clean stream.
// Strategy:
//   L1: rewrite the usher master request through a playerType=embed token (no ads at all).
//   L2: if an ad playlist still shows up, strip its ad segments in-place.
// Diagnostics:
//   On every master rewrite we ALSO request a normal (playerType=site) token and inspect its
//   playlists. That answers "was there an ad right now?" independently of the player UI:
//     check.adSegs > 0  -> Twitch had an ad for this channel, the player never received it
//     check.adSegs == 0 -> there was no ad in this moment (blocker had nothing to block)
// UI: popup.html talks to us through bridge.js (chrome.storage <-> window.postMessage).
(() => {
  if (window.__adstripInstalled) return;
  window.__adstripInstalled = true;

  const stats = (window.__adstrip = {
    v: 5, channel: null, enabled: true, pageWorkers: 0, patched: 0, masters: 0, cleanMasters: 0,
    playlists: 0, adPlaylists: 0, strippedSegs: 0, empty: 0, blocked: 0,
    checks: [], log: [], errors: [], workerStats: [],
  });

  const say = (msg) => {
    stats.log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
    if (stats.log.length > 200) stats.log.shift();
    try { console.log('%c[Twitch adblock]', 'color:#9146FF;font-weight:bold', msg); } catch (e) {}
  };

  // ---------- bridge -> popup ----------
  const publish = () => {
    try {
      window.postMessage({
        __adstrip_to_ext: true, type: 'stats',
        stats: {
          v: stats.v, channel: stats.channel, enabled: stats.enabled,
          pageWorkers: stats.pageWorkers, patched: stats.patched,
          masters: stats.masters, cleanMasters: stats.cleanMasters,
          playlists: stats.playlists, adPlaylists: stats.adPlaylists,
          strippedSegs: stats.strippedSegs, blocked: stats.blocked,
          phase: stats.phase, dvrOk: stats.dvrOk,
          checks: stats.checks, errors: stats.errors, log: stats.log.slice(-40),
        },
      }, '*');
    } catch (e) {}
  };

  const addBlocked = (n) => {
    stats.blocked += n || 1;
    try { window.postMessage({ __adstrip_to_ext: true, type: 'blocked', n: n || 1 }, '*'); } catch (e) {}
  };

  const onMsg = (e) => {
    const d = e.data;
    if (!d || !d.__adstrip) return;
    if (d.kind === 'stats') {
      const ws = d.stats || {};
      stats.workerStats.push(ws);
      if (ws.phase) stats.phase = ws.phase;
      if (ws.dvrOk) stats.dvrOk = ws.dvrOk;
      // Mirror the player worker's counters at the top level (they are monotonic per worker).
      if (ws.masters) stats.masters = Math.max(stats.masters, ws.masters);
      if (ws.cleanMasters) stats.cleanMasters = Math.max(stats.cleanMasters, ws.cleanMasters);
      if (ws.playlists) stats.playlists = Math.max(stats.playlists, ws.playlists);
      if (ws.adPlaylists) stats.adPlaylists = Math.max(stats.adPlaylists, ws.adPlaylists);
      if (ws.stripped) stats.strippedSegs = Math.max(stats.strippedSegs, ws.stripped);
      publish();
      return;
    }
    if (d.kind === 'err') { stats.errors.push(String(d.e).slice(0, 160)); publish(); return; }
    if (d.kind === 'note') { say(d.m); publish(); return; }
    if (d.kind === 'stripped') { addBlocked(1); publish(); return; }
    if (d.kind === 'check') {
      const c = d.check;
      stats.checks.push(c);
      if (c.ok) {
        say(`PROBE ${c.channel}: normal (site) stream has ad segments=${c.adSegs}` +
            ` (variants checked: ${c.checked}) -> ` +
            (c.adSegs > 0 ? 'AD WAS SERVED, player never got it' : 'no ad at this moment'));
        if (c.adSegs > 0) addBlocked(1);
      } else {
        say(`PROBE ${c.channel}: check failed (${c.err})`);
      }
      publish();
      return;
    }
  };

  // ---------- popup -> us ----------
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__adstrip_from_ext !== true) return;
    if (d.type === 'config') {
      const next = d.enabled !== false;
      if (next !== stats.enabled) {
        stats.enabled = next;
        say(next ? 'enabled' : 'disabled');
        broadcast();
        publish();
      }
    }
  });

  const workers = [];
  let cfgChannel = null;
  try { cfgChannel = new BroadcastChannel('__adstrip_cfg'); } catch (e) {}
  const broadcast = () => {
    // BroadcastChannel reaches patched workers without touching their message channel.
    try { cfgChannel && cfgChannel.postMessage({ __adstrip_cfg: true, enabled: stats.enabled }); } catch (e) {}
  };

  // ---------------- worker payload ----------------
  function WORKER_PATCH() {
    if (self.__adstripInit) return;
    self.__adstripInit = true;

    const SRC = self.__ADSTRIP_SRC || '';
    let ENABLED = self.__ADSTRIP_ENABLED !== false;
    const FORCE_DVR = self.__ADSTRIP_FORCE_DVR === true; // test hook: skip L1, go straight to DVR-tail
    const W = { fetches: 0, masters: 0, cleanMasters: 0, playlists: 0, adPlaylists: 0, stripped: 0, empty: 0, saved: 0, dvrOk: 0, dvrFail: 0, dvrTailFetches: 0, nested: 0, probed: 0, errors: [] };
    const post = (m) => { try { self.postMessage(Object.assign({ __adstrip: 1 }, m)); } catch (e) {} };
    const err = (m) => { W.errors.push(String(m).slice(0, 140)); post({ kind: 'err', e: m }); };

    // Live config comes over BroadcastChannel on purpose: posting a foreign object into the
    // worker's normal message channel makes Twitch's own onmessage handler throw
    // ("Cannot read properties of undefined (reading 'startsWith')") and kills the player.
    try {
      const bc = new BroadcastChannel('__adstrip_cfg');
      bc.onmessage = (e) => {
        if (e.data && e.data.__adstrip_cfg) ENABLED = e.data.enabled !== false;
      };
    } catch (e) {}

    const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    const PQ = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
    const realFetch = self.fetch.bind(self);

    const AD_RANGE = /CLASS="twitch-stitched-ad"|CLASS="twitch-ad-quartile"/;

    function stripPlaylist(text) {
      const lines = text.split('\n');
      const out = [];
      let buf = [];
      let removed = 0;
      let liveSegs = 0;
      let adSegs = 0;
      const flush = () => { if (buf.length) { out.push.apply(out, buf); buf = []; } };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.indexOf('#EXT-X-DATERANGE') === 0) {
          if (AD_RANGE.test(line)) { removed++; continue; }
          flush(); out.push(line); continue;
        }
        if (line.indexOf('#EXT-X-DISCONTINUITY') === 0 || line.indexOf('#EXT-X-MAP') === 0 ||
            line.indexOf('#EXT-X-PROGRAM-DATE-TIME') === 0 || line.indexOf('#EXT-X-KEY') === 0) {
          buf.push(line); continue;
        }
        if (line.indexOf('#EXTINF') === 0) {
          const isLive = /,\s*live\s*$/.test(line);
          if (!isLive) { i++; removed++; adSegs++; buf = []; continue; }
          flush(); out.push(line); liveSegs++; continue;
        }
        if (line.indexOf('#EXT-X-TWITCH-PREFETCH') === 0) {
          if (removed > 0) { i++; continue; }
          out.push(line); continue;
        }
        out.push(line);
      }
      flush();
      return { text: out.join('\n'), removed: removed, adSegs: adSegs, liveSegs: liveSegs };
    }

    async function gqlToken(channel, playerType) {
      const body = {
        operationName: 'PlaybackAccessToken',
        variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: playerType, platform: 'web' },
        extensions: { persistedQuery: { version: 1, sha256Hash: PQ } },
      };
      const gr = await realFetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
      });
      const j = await gr.json();
      return j && j.data && j.data.streamPlaybackAccessToken;
    }

    function usherUrl(channel, tok) {
      const q = new URLSearchParams({
        allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
        player_backend: 'mediaplayer', player_version: '1.58.0',
        play_session_id: 'astrip' + Date.now(), sig: tok.signature, token: tok.value,
        supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
      });
      return 'https://usher.ttvnw.net/api/v2/channel/hls/' + channel + '.m3u8?' + q.toString();
    }

    async function cleanMaster(channel) {
      if (FORCE_DVR) throw new Error('forced dvr');
      // embed is the primary type; dvr/popout are only tried if it is refused (same clean stream).
      let last = null;
      for (const pt of ['embed', 'dvr', 'popout']) {
        try {
          const t = await gqlToken(channel, pt);
          if (!t) throw new Error('gql: no token');
          const mr = await realFetch(usherUrl(channel, t));
          if (!mr.ok) throw new Error('usher ' + mr.status);
          const text = await mr.text();
          if (text.indexOf('#EXTM3U') !== 0) throw new Error('bad master');
          return text;
        } catch (e) { last = e; }
      }
      throw last || new Error('no clean master');
    }

    // ---------- variant 3: clean DVR-tail fallback ----------
    // L1 can fail (usher 404 / rate limit / token refused). The DVR recording on the CDN never
    // contains SSAI ads, so we rebuild a live-looking playlist from its tail and refresh that
    // window on every request. Verified: 120 s of continuous playback, MEDIA-SEQUENCE slides.
    const DVR_SERVERS = ['d3fi1amfgojobc', 'd3stzm2eumvgb4', 'dgeft87wbj63p', 'd3vd9lfkzbru3h', 'd1m7jfoe9zdc1j', 'd2vi6trrdongqn', 'd2nvs31859zcd8'];
    const DVR_QUALITIES = ['720p60', '480p30', '360p30', '1080p60'];
    const DVR_INF = {
      '1080p60': '#EXT-X-STREAM-INF:BANDWIDTH=7500000,CODECS="avc1.4D402A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000',
      '720p60': '#EXT-X-STREAM-INF:BANDWIDTH=3100000,CODECS="avc1.4D4020,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000',
      '480p30': '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=852x480,FRAME-RATE=30.000',
      '360p30': '#EXT-X-STREAM-INF:BANDWIDTH=566000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30.000',
    };
    const DVR_TAIL_SEGS = 12; // 2 minutes behind the live edge
    const dvrCache = {};
    let dvrTail = { at: 0, url: '', body: '' };

    async function sha1hex(s) {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
    }

    // base = {login}_{streamId}_{streamStartUnix}; path = {sha1(base)[0:20]}_{base}/{quality}/index-dvr.m3u8
    async function dvrLocate(channel) {
      if (Object.prototype.hasOwnProperty.call(dvrCache, channel)) return dvrCache[channel];
      dvrCache[channel] = null;
      try {
        const gr = await realFetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            query: 'query($login:String!){user(login:$login){stream{id createdAt}videos(first:1,type:ARCHIVE){edges{node{animatedPreviewURL}}}}}',
            variables: { login: channel },
          }),
        });
        const j = await gr.json();
        const u = j && j.data && j.data.user;
        if (!u || !u.stream) return null;
        const base = channel + '_' + u.stream.id + '_' + Math.floor(Date.parse(u.stream.createdAt) / 1000);
        const hash = await sha1hex(base);
        const preview = u.videos && u.videos.edges[0] && u.videos.edges[0].node.animatedPreviewURL;
        const pm = preview && preview.match(/^https:\/\/([\w-]+)\.cloudfront\.net\//);
        const servers = [];
        if (pm) servers.push(pm[1]);
        for (const s of DVR_SERVERS) if (servers.indexOf(s) < 0) servers.push(s);
        let server = null;
        for (const s of servers) {
          const res = await realFetch('https://' + s + '.cloudfront.net/' + hash + '_' + base + '/chunked/index-dvr.m3u8', { cache: 'no-store' }).catch(() => null);
          if (res && res.ok) { server = s; break; }
        }
        if (!server) return null;
        for (const q of DVR_QUALITIES) {
          const url = 'https://' + server + '.cloudfront.net/' + hash + '_' + base + '/' + q + '/index-dvr.m3u8';
          const res = await realFetch(url, { cache: 'no-store' }).catch(() => null);
          if (res && res.ok) { dvrCache[channel] = { url: url, quality: q }; return dvrCache[channel]; }
        }
      } catch (e) { err('dvr locate ' + e.message); }
      return null;
    }

    // Turn the last N DVR segments into a live playlist: absolute sequence numbers, native tags.
    function dvrBuildTail(text, url) {
      const lines = text.split('\n');
      const segs = [];
      let pdt = null, dur = null;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l.indexOf('#EXT-X-PROGRAM-DATE-TIME:') === 0) { pdt = l; continue; }
        if (l.indexOf('#EXTINF:') === 0) { dur = parseFloat(l.slice(8).split(',')[0]) || 10; continue; }
        if (l && l.charAt(0) !== '#' && dur !== null) { segs.push({ idx: segs.length, dur: dur, pdt: pdt, uri: l }); dur = null; pdt = null; }
      }
      if (!segs.length) return null;
      const keep = segs.slice(-DVR_TAIL_SEGS);
      const first = keep[0];
      const dir = url.slice(0, url.lastIndexOf('/') + 1);
      let elapsed = 0, windowDur = 0;
      for (const s of segs) if (s.idx < first.idx) elapsed += s.dur;
      for (const s of keep) windowDur += s.dur;
      const map = lines.find((l) => l.indexOf('#EXT-X-MAP') === 0);
      const out = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:10',
        '#EXT-X-MEDIA-SEQUENCE:' + first.idx, '#EXT-X-TWITCH-LIVE-SEQUENCE:' + first.idx,
        '#EXT-X-TWITCH-ELAPSED-SECS:' + elapsed.toFixed(3),
        '#EXT-X-TWITCH-TOTAL-SECS:' + (elapsed + windowDur).toFixed(3)];
      if (map) out.push(map.replace(/URI="([^"]+)"/, (m0, u0) => 'URI="' + dir + u0 + '"'));
      for (const s of keep) {
        if (s.pdt) out.push(s.pdt);
        out.push('#EXTINF:' + s.dur.toFixed(3) + ',live');
        out.push(dir + s.uri);
      }
      return out.join('\n') + '\n';
    }

    async function dvrTailBody(url) {
      const clean = url.replace(/[?&]__adstrip_tail=1/, '');
      if (dvrTail.body && dvrTail.url === clean && Date.now() - dvrTail.at < 2500) return dvrTail.body;
      const res = await realFetch(clean, { cache: 'no-store' });
      if (!res.ok) throw new Error('dvr ' + res.status);
      const body = dvrBuildTail(await res.text(), clean);
      if (!body) throw new Error('dvr empty');
      dvrTail = { at: Date.now(), url: clean, body: body };
      return body;
    }

    async function dvrMaster(channel) {
      const loc = await dvrLocate(channel);
      if (!loc) return null;
      return '#EXTM3U\n#EXT-X-VERSION:6\n' + (DVR_INF[loc.quality] || '') + '\n' + loc.url + '?__adstrip_tail=1\n';
    }

    // Independent check: ask Twitch for the NORMAL (site) stream and count ad segments in it.
    // Never handed to the player - diagnostics only.
    async function probeNormal(channel) {
      try {
        const t = await gqlToken(channel, 'site');
        if (!t) return { channel: channel, ok: false, err: 'no site token' };
        const mr = await realFetch(usherUrl(channel, t));
        if (!mr.ok) return { channel: channel, ok: false, err: 'usher ' + mr.status };
        const master = await mr.text();
        const variants = (master.match(/^https:.*\.m3u8$/gm) || []).slice(0, 2);
        let adSegs = 0, stitched = false, checked = 0, live = 0;
        for (const v of variants) {
          const vr = await realFetch(v);
          if (!vr.ok) continue;
          const txt = await vr.text();
          checked++;
          if (/twitch-stitched-ad|twitch-ad-quartile/.test(txt)) stitched = true;
          for (const line of txt.split('\n')) {
            if (line.indexOf('#EXTINF') !== 0) continue;
            if (/,\s*live\s*$/.test(line)) live++; else adSegs++;
          }
        }
        return { channel: channel, ok: true, at: new Date().toISOString(), checked: checked, adSegs: adSegs, liveSegs: live, stitched: stitched, variantsInMaster: variants.length };
      } catch (e) {
        return { channel: channel, ok: false, err: String(e).slice(0, 120) };
      }
    }

    self.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      W.fetches++;
      const p = realFetch(input, init);

      if (!ENABLED) return p;
      if (!/\.m3u8/i.test(url)) return p;

      // Our own synthetic DVR-tail URL (handed out by the L1 fallback): rebuild the sliding
      // window from the fresh DVR playlist. Kept alive even when the toggle is off, otherwise
      // a mid-session toggle would black out a stream that is already on the fallback.
      if (url.indexOf('__adstrip_tail=1') >= 0) {
        W.dvrTailFetches++;
        if (W.dvrTailFetches % 10 === 1) post({ kind: 'stats', stats: Object.assign({ phase: 'DVR-tail' }, W) });
        return dvrTailBody(url).then((body) => new Response(body, {
          status: 200, statusText: 'OK', headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        })).catch((e) => { err('dvr tail ' + e.message); return p; });
      }

      // --- L1: master playlist -> swap in a playerType=embed token
      const mm = url.match(/usher\.ttvnw\.net\/api\/[^/]*\/channel\/hls\/([A-Za-z0-9_]+)\.m3u8/);
      if (mm) {
        const ch = mm[1];
        W.masters++;
        return cleanMaster(ch).then((text) => {
          W.cleanMasters++;
          post({ kind: 'stats', stats: Object.assign({ phase: 'L1', channel: ch }, W) });
          // one diagnostic probe per worker session
          if (!W.probed) {
            W.probed = 1;
            probeNormal(ch).then((c) => post({ kind: 'check', check: c }));
          }
          return new Response(text, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
        }).catch(async (e) => {
          err('L1 ' + e.message);
          try {
            const m = await dvrMaster(ch);
            if (m) {
              W.dvrOk++;
              post({ kind: 'stats', stats: Object.assign({ phase: 'L1->DVR' }, W) });
              post({ kind: 'note', m: 'L1 failed (' + e.message + ') -> serving the clean DVR tail' });
              if (!W.probed) {
                W.probed = 1;
                probeNormal(ch).then((c) => post({ kind: 'check', check: c }));
              }
              return new Response(m, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
            }
          } catch (e2) { err('dvr master ' + e2.message); }
          W.dvrFail++;
          return p;
        });
      }

      // --- L2: any playlist that carries SSAI ads -> strip them
      return p.then((res) => {
        if (!res || !res.ok) return res;
        return res.clone().text().then((text) => {
          if (!/twitch-stitched-ad|twitch-ad-quartile/.test(text)) return res;
          W.playlists++; W.adPlaylists++;
          const r = stripPlaylist(text);
          W.stripped += r.adSegs;
          // Safety net (variant 4): a playlist with zero live segments means the player gets
          // nothing to play -> black screen. An ad is the lesser evil, so hand back the original.
          if (!r.liveSegs) {
            W.empty++; W.saved++;
            post({ kind: 'stats', stats: Object.assign({ phase: 'L2-guard' }, W) });
            post({ kind: 'note', m: 'L2-guard: playlist is ads only (' + r.adSegs + ' segs) -> original returned' });
            return res;
          }
          post({ kind: 'stats', stats: Object.assign({ phase: 'L2' }, W) });
          if (!r.removed) return res;
          post({ kind: 'stripped', n: 1 });
          const headers = new Headers(res.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(r.text, { status: res.status, statusText: res.statusText, headers: headers });
        });
      });
    };

    // --- keep patching nested workers (the loader may spawn the real player worker)
    try {
      const NW = self.Worker;
      if (NW) {
        self.Worker = class extends NW {
          constructor(url, options) {
            try {
              const u = String(url || '');
              if (u.indexOf('blob:') === 0) {
                const x = new XMLHttpRequest();
                x.open('GET', u, false);
                x.overrideMimeType('text/javascript');
                x.send();
                const src = x.responseText || '';
                if (src.length) {
                  W.nested++;
                  const prefix = 'self.__ADSTRIP_SRC=' + JSON.stringify(SRC) + ';self.__ADSTRIP_ENABLED=' + (ENABLED ? 'true' : 'false') + ';self.__ADSTRIP_FORCE_DVR=' + (FORCE_DVR ? 'true' : 'false') + ';try{' + SRC + '}catch(e){}';
                  super(URL.createObjectURL(new Blob([prefix + '\n;\n' + src], { type: 'text/javascript' })), options);
                  return;
                }
              }
            } catch (e) { err('nested ' + e.message); }
            super(url, options);
          }
        };
      }
    } catch (e) { err('workerhook ' + e.message); }
  }

  const SRC_TXT = '(' + WORKER_PATCH.toString() + ')();';

  // ---------------- page side ----------------
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      let patched = false;
      try {
        const u = String(url || '');
        if (u.indexOf('blob:') === 0) {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', u, false);
          xhr.overrideMimeType('text/javascript');
          xhr.send();
          const src = xhr.responseText || '';
          stats.pageWorkers++;
          if (src.length > 0) {
            const prefix = 'self.__ADSTRIP_SRC=' + JSON.stringify(SRC_TXT) +
              ';self.__ADSTRIP_ENABLED=' + (stats.enabled ? 'true' : 'false') +
              ';self.__ADSTRIP_FORCE_DVR=' + (window.__adstripForceDvr ? 'true' : 'false') +
              ';try{' + SRC_TXT + '}catch(e){}';
            super(URL.createObjectURL(new Blob([prefix + '\n;\n' + src], { type: 'text/javascript' })), options);
            patched = true;
            stats.patched++;
          }
        }
      } catch (e) {
        stats.errors.push('page ' + String(e).slice(0, 140));
      }
      if (!patched) super(url, options);
      try {
        this.addEventListener('message', onMsg);
        workers.push(this);
      } catch (e) {}
    }
  };

  // Channel name, for the log header
  try {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{2,25})$/);
    if (m) stats.channel = m[1];
  } catch (e) {}

  // Download the whole diagnostic log as JSON
  window.__adstripDump = function () {
    try {
      const data = JSON.stringify(window.__adstrip, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'twitch-adblock-' + (stats.channel || 'log') + '-' + Date.now() + '.json';
      a.click();
    } catch (e) {}
    return window.__adstrip;
  };

  say('installed, channel=' + (stats.channel || '?'));
  publish();
})();
