// Inspect the currently recording VOD: master variants, codecs, media playlist tail.
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = (process.argv[2] || 'T2x2').toLowerCase();
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

const VODQ = `query($login: String!) { user(login: $login) { videos(first: 1, type: ARCHIVE) { edges { node { id status lengthSeconds publishedAt } } } } }`;
const TOKQ = `query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`;

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const r1 = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: VODQ, variables: { login: CH } },
  });
  const j1 = await r1.json();
  const v = j1 && j1.data && j1.data.user && j1.data.user.videos.edges[0] && j1.data.user.videos.edges[0].node;
  console.log('vod =', JSON.stringify(v));
  if (!v) { await ctx.dispose(); return; }

  const r2 = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: TOKQ, variables: { id: v.id } },
  });
  const j2 = await r2.json();
  const tok = j2 && j2.data && j2.data.videoPlaybackAccessToken;
  if (!tok) { console.log('no vod token', JSON.stringify(j2).slice(0, 200)); await ctx.dispose(); return; }

  const q = new URLSearchParams({
    allow_source: 'true', allow_audio_only: 'true', p: '8863440', platform: 'web',
    player_backend: 'mediaplayer', player_version: '1.58.0', play_session_id: 'v' + Date.now(),
    sig: tok.signature, token: tok.value, supported_codecs: 'av1,h264', transcode_mode: 'cbr_v1',
  });
  const mr = await ctx.get(`https://usher.ttvnw.net/vod/${v.id}.m3u8?${q.toString()}`);
  const mt = await mr.text();
  console.log('vod master:', mr.status(), 'bytes', mt.length);
  console.log('--- master first 40 lines ---');
  mt.split('\n').slice(0, 40).forEach((l, i) => console.log(String(i).padStart(3) + ': ' + l.slice(0, 170)));

  const variants = [...mt.matchAll(/^https:.*\.m3u8$/gm)].map((m) => m[0]);
  console.log('variants =', variants.length);
  if (!variants.length) { await ctx.dispose(); return; }

  // pick the first variant whose STREAM-INF line mentions avc1, else the first
  const blocks = mt.split('#EXT-X-STREAM-INF:').slice(1);
  let pick = 0;
  blocks.forEach((b, i) => { if (/avc1/i.test(b.split('\n')[0]) && pick === 0) pick = i; });
  const url = variants[Math.min(pick, variants.length - 1)];
  console.log('picked variant =', url.slice(0, 110));

  const vr = await ctx.get(url);
  const vt = await vr.text();
  const lines = vt.split('\n');
  const extinf = lines.filter((l) => l.startsWith('#EXTINF'));
  console.log(JSON.stringify({
    status: vr.status(), bytes: vt.length, extinf: extinf.length,
    type: (vt.match(/^#EXT-X-PLAYLIST-TYPE:(.+)$/m) || [])[1] || null,
    mediaSeq: (vt.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m) || [])[1] || null,
    hasMap: /^#EXT-X-MAP/m.test(vt),
    target: (vt.match(/^#EXT-X-TARGETDURATION:(\d+)$/m) || [])[1] || null,
    ad: /twitch-stitched-ad|twitch-ad-quartile|Amazon\|/.test(vt),
  }, null, 2));
  console.log('--- media head 14 ---');
  lines.slice(0, 14).forEach((l, i) => console.log(String(i).padStart(3) + ': ' + l.slice(0, 160)));
  console.log('--- media tail 10 ---');
  lines.slice(-10).forEach((l, i) => console.log(String(lines.length - 10 + i).padStart(3) + ': ' + l.slice(0, 160)));
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
