// Test: can we feed Twitch's player a clean "live tail" built from index-dvr.m3u8?
// MODE=media  -> usher master request is answered with a media playlist
// MODE=master -> answered with a master whose variant is our media playlist
// The tail is REBUILT from the fresh DVR playlist on every request (sliding window).
const crypto = require('crypto');
const path = require('path');
const PW = 'playwright';
const { chromium, request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = (process.argv[2] || 'T2x2').toLowerCase();
const MODE = process.env.MODE || 'media';
const TAIL_SEGS = Number(process.env.TAIL || 12);
const QUALITY = process.env.QUALITY || '720p60';
const RUN_SEC = Number(process.env.RUN || 90);
const INF = {
  '1080p60': '#EXT-X-STREAM-INF:BANDWIDTH=7500000,CODECS="avc1.4D402A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000',
  '720p60': '#EXT-X-STREAM-INF:BANDWIDTH=3100000,CODECS="avc1.4D4020,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000',
  '480p30': '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=852x480,FRAME-RATE=30.000',
  '360p30': '#EXT-X-STREAM-INF:BANDWIDTH=566000,CODECS="avc1.4D401E",RESOLUTION=640x360,FRAME-RATE=30.000',
}[QUALITY] || '#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const SERVERS = ['d3fi1amfgojobc', 'd3stzm2eumvgb4', 'dgeft87wbj63p', 'd3vd9lfkzbru3h', 'd1m7jfoe9zdc1j', 'd2vi6trrdongqn'];
const Q = `query($login: String!) { user(login: $login) { stream { id createdAt } videos(first: 1, type: ARCHIVE) { edges { node { animatedPreviewURL } } } } }`;

// ---- DVR playlist access (with a short cache so bursts of requests don't hammer the CDN)
let dvrUrl = null;
let cache = { at: 0, text: '', tail: null };
async function fetchDvrText(api) {
  const res = await api.get(dvrUrl + (dvrUrl.includes('?') ? '&' : '?') + '_=' + Date.now(), { timeout: 15000 });
  if (!res.ok()) throw new Error('dvr ' + res.status());
  return await res.text();
}

// Build a live-looking tail: absolute MEDIA-SEQUENCE, LIVE-SEQUENCE, ELAPSED/TOTAL, MAP, PDT.
function buildTail(dvrText, dvrUrl, tail) {
  const lines = dvrText.split('\n');
  const segs = []; // { idx, dur, pdt, uri }
  let pendingPdt = null;
  let pendingDur = null;
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) { pendingPdt = l; return; }
    if (l.startsWith('#EXTINF:')) {
      pendingDur = parseFloat(l.slice(8).split(',')[0]) || 10;
      return;
    }
    if (l && !l.startsWith('#') && pendingDur !== null) {
      segs.push({ idx: segs.length, dur: pendingDur, pdt: pendingPdt, uri: l });
      pendingDur = null; pendingPdt = null;
    }
  });
  if (!segs.length) return null;

  const keep = segs.slice(-tail);
  const first = keep[0];
  const base = dvrUrl.slice(0, dvrUrl.lastIndexOf('/') + 1);
  let elapsed = 0;
  for (const s of segs) { if (s.idx < first.idx) elapsed += s.dur; }
  let windowDur = 0;
  for (const s of keep) windowDur += s.dur;

  const mapLine = lines.find((l) => l.startsWith('#EXT-X-MAP'));
  const out = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:' + first.idx,
    '#EXT-X-TWITCH-LIVE-SEQUENCE:' + first.idx,
    '#EXT-X-TWITCH-ELAPSED-SECS:' + elapsed.toFixed(3),
    '#EXT-X-TWITCH-TOTAL-SECS:' + (elapsed + windowDur).toFixed(3),
  ];
  if (mapLine) out.push(mapLine.replace(/URI="([^"]+)"/, (_, u) => `URI="${base}${u}"`));
  for (const s of keep) {
    if (s.pdt) out.push(s.pdt);
    out.push('#EXTINF:' + s.dur.toFixed(3) + ',live');
    out.push(base + s.uri);
  }
  return out.join('\n') + '\n';
}

async function getTail(api, force) {
  const now = Date.now();
  if (!force && cache.tail && now - cache.at < 2500) return cache.tail;
  const text = await fetchDvrText(api);
  const tail = buildTail(text, dvrUrl, TAIL_SEGS);
  cache = { at: now, text, tail };
  return tail;
}

(async () => {
  const api = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const r = await api.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: Q, variables: { login: CH } },
  });
  const j = await r.json();
  const u = j && j.data && j.data.user;
  if (!u || !u.stream) { console.log('channel offline'); await api.dispose(); return; }
  const base = `${CH}_${u.stream.id}_${Math.floor(Date.parse(u.stream.createdAt) / 1000)}`;
  const hash = crypto.createHash('sha1').update(base).digest('hex').slice(0, 20);
  const p = `${hash}_${base}/${QUALITY}/index-dvr.m3u8`;
  const preview = u.videos && u.videos.edges[0] && u.videos.edges[0].node.animatedPreviewURL;
  const m = preview && preview.match(/^https:\/\/(\w+)\.cloudfront\.net\//);
  const servers = [...new Set([...(m ? [m[1]] : []), ...SERVERS])];
  for (const s of servers) {
    const url = `https://${s}.cloudfront.net/${p}`;
    const res = await api.get(url).catch(() => null);
    if (res && res.ok()) { dvrUrl = url; break; }
  }
  if (!dvrUrl) { console.log('dvr not found'); await api.dispose(); return; }

  const first = await getTail(api, true);
  console.log('dvr =', dvrUrl);
  console.log('TAIL =', TAIL_SEGS, 'segs, first tail bytes =', first.length);
  console.log('tail head:\n' + first.split('\n').slice(0, 9).map((l) => '  ' + l.slice(0, 110)).join('\n'));

  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'dvr-profile'), {
    headless: false, proxy: PROXY, viewport: { width: 1280, height: 760 }, locale: 'ru-RU',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const log = [];
  let tailHits = 0;
  const seqs = [];

  await ctx.route('**/usher.ttvnw.net/**', async (route) => {
    const url = route.request().url();
    try {
      if (/\/dvr-tail\//.test(url)) {
        tailHits++;
        const body = await getTail(api, false);
        const seq = (body.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m) || [])[1];
        const n = (body.match(/^#EXTINF/gm) || []).length;
        seqs.push(seq);
        if (tailHits <= 3 || tailHits % 10 === 0) log.push(`tail #${tailHits} seq=${seq} segs=${n}`);
        await route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body });
        return;
      }
      if (!/\/api\/.*\/channel\/hls\//.test(url)) { await route.continue(); return; }
      if (MODE === 'media') {
        const body = await getTail(api, false);
        log.push('master -> media');
        await route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body });
        return;
      }
      const out = ['#EXTM3U', '#EXT-X-VERSION:6', INF, `https://usher.ttvnw.net/dvr-tail/${CH}.m3u8`].join('\n') + '\n';
      log.push('master -> wrapper');
      await route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: out });
    } catch (e) {
      log.push('route error: ' + String(e).slice(0, 120));
      try { await route.abort(); } catch (_) {}
    }
  });

  page.on('console', (msg) => { if (msg.type() === 'error') log.push('console: ' + msg.text().slice(0, 140)); });
  page.on('pageerror', (e) => log.push('pageerror: ' + String(e).slice(0, 140)));

  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  for (const s of ['[data-a-target="consent-banner-accept"]', 'button:has-text("Принять")', 'button:has-text("Accept")']) {
    try { const el = page.locator(s).first(); if (await el.count() && await el.isVisible()) { await el.click({ timeout: 2500 }); break; } } catch (e) {}
  }

  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < RUN_SEC * 1000) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((x) => x.videoWidth > 0) || document.querySelector('video');
      if (!v) return { video: null };
      let buf = 0;
      try { if (v.buffered.length) buf = +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1); } catch (e) {}
      return {
        w: v.videoWidth, h: v.videoHeight, ct: +v.currentTime.toFixed(1),
        paused: v.paused, ready: v.readyState, buf,
      };
    });
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
  }

  console.log('MODE =', MODE, 'QUALITY =', QUALITY);
  console.log('samples:');
  for (const s of samples) console.log('  ' + JSON.stringify(s));
  console.log('tail hits =', tailHits, 'seqs =', seqs.join(','));
  console.log('LOG:'); log.slice(0, 24).forEach((l) => console.log('  ' + l));
  await page.screenshot({ path: path.join(__dirname, 'dvrtail-' + MODE + '.png') });
  await ctx.close();
  await api.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
