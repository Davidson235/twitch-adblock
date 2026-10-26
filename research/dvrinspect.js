// Inspect the structure of index-dvr.m3u8 (init map, segment naming, live edge).
const crypto = require('crypto');
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = (process.argv[2] || 'T2x2').toLowerCase();
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const SERVERS = ['d3fi1amfgojobc', 'd3stzm2eumvgb4', 'dgeft87wbj63p', 'd3vd9lfkzbru3h', 'd1m7jfoe9zdc1j', 'd2vi6trrdongqn'];

const Q = `query($login: String!) { user(login: $login) { stream { id createdAt } videos(first: 1, type: ARCHIVE) { edges { node { animatedPreviewURL } } } } }`;

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const r = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: Q, variables: { login: CH } },
  });
  const j = await r.json();
  const u = j && j.data && j.data.user;
  if (!u || !u.stream) { console.log('offline'); await ctx.dispose(); return; }

  const base = `${CH}_${u.stream.id}_${Math.floor(Date.parse(u.stream.createdAt) / 1000)}`;
  const hash = crypto.createHash('sha1').update(base).digest('hex').slice(0, 20);
  const path = `${hash}_${base}/chunked/index-dvr.m3u8`;

  let url = null;
  const preview = u.videos && u.videos.edges[0] && u.videos.edges[0].node.animatedPreviewURL;
  const m = preview && preview.match(/^https:\/\/(\w+)\.cloudfront\.net\//);
  const servers = [...new Set([...(m ? [m[1]] : []), ...SERVERS])];
  for (const s of servers) {
    const u2 = `https://${s}.cloudfront.net/${path}`;
    const res = await ctx.get(u2).catch(() => null);
    if (res && res.ok()) { url = u2; break; }
  }
  if (!url) { console.log('dvr not found'); await ctx.dispose(); return; }

  const txt = await (await ctx.get(url)).text();
  const lines = txt.split('\n');
  const extinf = lines.filter((l) => l.startsWith('#EXTINF'));
  console.log(JSON.stringify({
    url,
    lines: lines.length,
    extinf: extinf.length,
    hasMap: /^#EXT-X-MAP/m.test(txt),
    hasDiscontinuity: /^#EXT-X-DISCONTINUITY/m.test(txt),
    type: (txt.match(/^#EXT-X-PLAYLIST-TYPE:(.+)$/m) || [])[1] || null,
    mediaSeq: (txt.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m) || [])[1] || null,
    target: (txt.match(/^#EXT-X-TARGETDURATION:(\d+)$/m) || [])[1] || null,
  }, null, 2));
  console.log('--- first 18 lines ---');
  lines.slice(0, 18).forEach((l, i) => console.log(String(i).padStart(3) + ': ' + l.slice(0, 160)));
  const firstSeg = lines.findIndex((l) => /\.(mp4|ts)(\?|$)/.test(l));
  console.log('--- around first segment (line ' + firstSeg + ') ---');
  lines.slice(Math.max(0, firstSeg - 6), firstSeg + 4).forEach((l, i) => console.log(String(firstSeg - 6 + i).padStart(3) + ': ' + l.slice(0, 160)));
  console.log('--- last 10 lines ---');
  lines.slice(-10).forEach((l, i) => console.log(String(lines.length - 10 + i).padStart(3) + ': ' + l.slice(0, 160)));
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
