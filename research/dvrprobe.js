// Verify the "DVR playlist" mechanism used by Twitch DVR extensions.
// URL: https://{server}.cloudfront.net/{sha1(base)[0:20]}_{base}/chunked/index-dvr.m3u8
// base = {login}_{streamId}_{streamStartUnix}
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

const SERVERS = [
  'd3fi1amfgojobc', 'd3stzm2eumvgb4', 'dgeft87wbj63p', 'd3vd9lfkzbru3h', 'd1m7jfoe9zdc1j',
  'd2vi6trrdongqn', 'd2nvs31859zcd8', 'd1g1f25tn8m2e6', 'd1mhjrowxxagfy', 'd1oca24q5dwo6d',
];

const Q = `query($login: String!) {
  user(login: $login) {
    id
    stream { id createdAt }
    videos(first: 1, type: ARCHIVE) { edges { node { id status animatedPreviewURL publishedAt } } }
  }
}`;

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 45000 });
  const r = await ctx.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: Q, variables: { login: CH } },
  });
  const j = await r.json();
  const u = j && j.data && j.data.user;
  if (!u) { console.log('no user', JSON.stringify(j).slice(0, 300)); await ctx.dispose(); return; }
  const live = u.stream;
  const vod = u.videos && u.videos.edges[0] && u.videos.edges[0].node;
  console.log(JSON.stringify({ channel: CH, live: !!live, streamId: live && live.id, startedAt: live && live.createdAt, vod: vod && { id: vod.id, status: vod.status, publishedAt: vod.publishedAt } }, null, 2));

  if (!live) { console.log('channel offline'); await ctx.dispose(); return; }

  const base = `${CH}_${live.id}_${Math.floor(Date.parse(live.createdAt) / 1000)}`;
  const hash = crypto.createHash('sha1').update(base).digest('hex').slice(0, 20);
  const path = `${hash}_${base}/chunked/index-dvr.m3u8`;
  console.log('base =', base);
  console.log('path =', path);

  // server hint from the VOD preview, if any
  let hinted = null;
  if (vod && vod.animatedPreviewURL) {
    const m = vod.animatedPreviewURL.match(/^https:\/\/(\w+)\.cloudfront\.net\/(\w{20}_\w+_\d+_\d+)\//);
    if (m) hinted = m[1];
    console.log('preview =', vod.animatedPreviewURL.slice(0, 110));
  }

  const servers = [...new Set([...(hinted ? [hinted] : []), ...SERVERS])];
  for (const s of servers) {
    const url = `https://${s}.cloudfront.net/${path}`;
    const res = await ctx.get(url).catch(() => null);
    if (!res) continue;
    const txt = res.ok() ? await res.text() : '';
    const segs = (txt.match(/^#EXTINF/gm) || []).length;
    const ads = /twitch-stitched-ad|twitch-ad-quartile|Amazon\|/.test(txt);
    console.log(`  ${s}: ${res.status()} bytes=${txt.length} segs=${segs} ads=${ads}`);
    if (res.ok() && segs > 0) {
      console.log('  first 6 lines:');
      txt.split('\n').slice(0, 6).forEach((l) => console.log('    ' + l.slice(0, 140)));
      console.log('  last 4 lines:');
      txt.split('\n').slice(-4).forEach((l) => console.log('    ' + l.slice(0, 140)));
      break;
    }
  }
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
