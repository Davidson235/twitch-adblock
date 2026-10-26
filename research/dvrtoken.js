// Does GQL accept playerType=dvr, and is the resulting playlist the full (clean) DVR window?
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = (process.argv[2] || 'T2x2').toLowerCase();
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  for (const pt of ['site', 'dvr', 'embed']) {
    const gr = await ctx.post('https://gql.twitch.tv/gql', {
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
      data: {
        operationName: 'PlaybackAccessToken',
        variables: { isLive: true, login: CH, isVod: false, vodID: '', playerType: pt, platform: 'web' },
        extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
      },
    });
    const gj = await gr.json().catch(() => null);
    const tok = gj && gj.data && gj.data.streamPlaybackAccessToken;
    if (!tok) { console.log(pt, 'no token', gr.status(), JSON.stringify(gj).slice(0, 160)); continue; }

    const q = new URLSearchParams({
      allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
      player_backend: 'mediaplayer', player_version: '1.58.0', play_session_id: 'x' + Date.now(),
      sig: tok.signature, token: tok.value, supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
    });
    const mr = await ctx.get('https://usher.ttvnw.net/api/channel/hls/' + CH + '.m3u8?' + q.toString());
    const mt = await mr.text();
    const variants = [...mt.matchAll(/^https:.*\.m3u8$/gm)].map((m) => m[0]);
    let info = { pt, status: mr.status(), variants: variants.length };
    if (variants[0]) {
      const vr = await ctx.get(variants[0]);
      const vt = await vr.text();
      const extinf = vt.split('\n').filter((l) => l.startsWith('#EXTINF'));
      info.type = (vt.match(/^#EXT-X-PLAYLIST-TYPE:(.+)$/m) || [])[1] || null;
      info.segs = extinf.length;
      info.adSegs = extinf.filter((l) => !/,\s*live\s*$/.test(l)).length;
      info.mediaSeq = (vt.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m) || [])[1] || null;
      info.ads = /twitch-stitched-ad|twitch-ad-quartile|Amazon\|/.test(vt);
      info.firstSeg = (vt.split('\n').find((l) => /^https?:|^\d+\.(mp4|ts)/.test(l)) || '').slice(0, 60);
    }
    console.log(JSON.stringify(info));
  }
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
