// Matrix: for each live channel and each playerType, what does usher return and are there ads?
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
const CHANNELS = (process.argv[2] || 'T2x2,StRoGo,skywhywalker,deepins02').split(',');
const TYPES = [
  ['site', 'web'],
  ['embed', 'web'],
  ['dvr', 'web'],
  ['popout', 'web'],
  ['autoplay', 'android'],
];

async function token(ctx, ch, pt, platform) {
  const r = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
    data: {
      operationName: 'PlaybackAccessToken',
      variables: { isLive: true, login: ch, isVod: false, vodID: '', playerType: pt, platform },
      extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
    },
  });
  const j = await r.json().catch(() => null);
  return { status: r.status(), tok: j && j.data && j.data.streamPlaybackAccessToken, raw: j };
}

async function check(ctx, ch, pt, platform) {
  const t = await token(ctx, ch, pt, platform);
  if (!t.tok) return { pt, tokenStatus: t.status, err: 'no token' };
  const q = new URLSearchParams({
    allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
    player_backend: 'mediaplayer', player_version: '1.58.0', play_session_id: 'm' + Date.now(),
    sig: t.tok.signature, token: t.tok.value, supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
  });
  const mr = await ctx.get('https://usher.ttvnw.net/api/channel/hls/' + ch + '.m3u8?' + q.toString());
  const mt = await mr.text();
  const variants = [...mt.matchAll(/^https:.*\.m3u8$/gm)].map((m) => m[0]);
  if (!variants.length) return { pt, usher: mr.status(), variants: 0, note: mt.slice(0, 60) };
  const vr = await ctx.get(variants[0]);
  const vt = await vr.text();
  const extinf = vt.split('\n').filter((l) => l.startsWith('#EXTINF'));
  const adSegs = extinf.filter((l) => !/,\s*live\s*$/.test(l)).length;
  return {
    pt, usher: mr.status(), variants: variants.length,
    segs: extinf.length, adSegs,
    stitched: /twitch-stitched-ad|twitch-ad-quartile/.test(vt),
    type: (vt.match(/^#EXT-X-PLAYLIST-TYPE:(.+)$/m) || [])[1] || null,
    mediaSeq: (vt.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m) || [])[1] || null,
  };
}

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  for (const ch of CHANNELS) {
    const rows = [];
    for (const [pt, platform] of TYPES) {
      try { rows.push(await check(ctx, ch, pt, platform)); }
      catch (e) { rows.push({ pt, err: String(e).slice(0, 80) }); }
    }
    const live = rows.some((r) => r.segs > 0);
    console.log('\n=== ' + ch + (live ? '' : ' (offline?)') + ' ===');
    for (const r of rows) {
      console.log('  ' + JSON.stringify(r));
    }
  }
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
