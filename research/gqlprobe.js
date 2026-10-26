// Compare playlists obtained with different playerTypes (vaft "backup player" trick)
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = process.argv[2] || 'recrent';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';

const gql = (playerType, platform) => ({
  operationName: 'PlaybackAccessToken',
  variables: { isLive: true, login: CH, isVod: false, vodID: '', playerType, platform },
  extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
});

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const out = [];
  for (const [pt, platform] of [['site', 'web'], ['embed', 'web'], ['popout', 'web'], ['autoplay', 'android']]) {
    const r = await ctx.post('https://gql.twitch.tv/gql', {
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
      data: gql(pt, platform),
    });
    const j = await r.json().catch(() => null);
    const tok = j && j.data && j.data.streamPlaybackAccessToken;
    if (!tok) { out.push({ pt, err: 'no token', status: r.status(), body: JSON.stringify(j).slice(0, 200) }); continue; }
    const params = new URLSearchParams({
      allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
      player_backend: 'mediaplayer', player_version: '1.58.0', play_session_id: 'x' + Date.now(),
      sig: tok.signature, token: tok.value, supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
    });
    const master = 'https://usher.ttvnw.net/api/channel/hls/' + CH + '.m3u8?' + params.toString();
    const mr = await ctx.get(master);
    const mt = await mr.text();
    const urls = [...mt.matchAll(/^https:.*\.m3u8$/gm)].map(m => m[0]);
    const variants = mt.split('\n').filter(l => l.startsWith('#EXT-X-STREAM-INF')).length;
    const rec = { pt, status: mr.status(), bytes: mt.length, variants, firstUrl: urls[0] ? urls[0].slice(0, 90) : null, note: '' };
    if (!urls.length) {
      rec.note = mt.slice(0, 120);
    } else {
      // fetch 2 variants
      for (const u of urls.slice(0, 3)) {
        const qr = await ctx.get(u);
        const qt = await qr.text();
        const extinf = qt.split('\n').filter(l => l.startsWith('#EXTINF'));
        const ad = extinf.filter(l => !l.includes(',live')).length;
        rec[`v_${ad ? 'AD' : 'clean'}_${extinf.length}`] = (rec[`v_${ad ? 'AD' : 'clean'}_${extinf.length}`] || 0) + 1;
        if (ad || /stitched/i.test(qt)) rec.AD_FOUND = true;
        rec.last = { url: u.slice(0, 70), extinf: extinf.length, ad, stitched: /stitched/i.test(qt) };
      }
    }
    out.push(rec);
    console.log(JSON.stringify(rec));
  }
  fs.writeFileSync(path.join(__dirname, 'gql-' + CH + '.json'), JSON.stringify(out, null, 2));
  await ctx.dispose();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
