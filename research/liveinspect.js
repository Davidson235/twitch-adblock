// Dump the exact structure of a real Twitch LIVE media playlist (playerType=embed).
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = (process.argv[2] || 't2x2').toLowerCase();
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const gr = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
    data: {
      operationName: 'PlaybackAccessToken',
      variables: { isLive: true, login: CH, isVod: false, vodID: '', playerType: 'embed', platform: 'web' },
      extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
    },
  });
  const gj = await gr.json();
  const tok = gj && gj.data && gj.data.streamPlaybackAccessToken;
  if (!tok) { console.log('no token', JSON.stringify(gj).slice(0, 200)); await ctx.dispose(); return; }

  const q = new URLSearchParams({
    allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
    player_backend: 'mediaplayer', player_version: '1.58.0', play_session_id: 'i' + Date.now(),
    sig: tok.signature, token: tok.value, supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
  });
  const mr = await ctx.get('https://usher.ttvnw.net/api/channel/hls/' + CH + '.m3u8?' + q.toString());
  const mt = await mr.text();
  const variants = [...mt.matchAll(/^https:.*\.m3u8$/gm)].map((m) => m[0]);
  if (!variants.length) { console.log('no variants', mr.status(), mt.slice(0, 200)); await ctx.dispose(); return; }

  const vr = await ctx.get(variants[0]);
  const vt = await vr.text();
  const lines = vt.split('\n');
  console.log('status =', vr.status(), 'bytes =', vt.length, 'lines =', lines.length);
  console.log('--- tags (unique, in order) ---');
  const seen = [];
  lines.forEach((l) => {
    const m = l.match(/^(#EXT[A-Z0-9-]*|#ID3-EQUIV[A-Z-]*)/);
    if (m && !seen.includes(m[1])) seen.push(m[1]);
  });
  console.log(seen.join('\n'));
  console.log('--- first 30 lines ---');
  lines.slice(0, 30).forEach((l, i) => console.log(String(i).padStart(3) + ': ' + l.slice(0, 180)));
  console.log('--- around 5th EXTINF ---');
  let n = 0, at = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].startsWith('#EXTINF')) { n++; if (n === 5) { at = i; break; } } }
  if (at > 0) lines.slice(Math.max(0, at - 4), at + 4).forEach((l, i) => console.log(String(at - 4 + i).padStart(3) + ': ' + l.slice(0, 180)));
  console.log('--- last 12 lines ---');
  lines.slice(-12).forEach((l, i) => console.log(String(lines.length - 12 + i).padStart(3) + ': ' + l.slice(0, 180)));
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
