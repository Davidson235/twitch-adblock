// Which of these channels are actually live right now?
const PW = 'playwright';
const { request } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const LIST = (process.argv[2] || 'sasavot,morphe_ya,busteroid1337,melharucos,iLame,Jeens,Starky,SleDuck,kopsteep').split(',');
const Q = 'query($login:String!){user(login:$login){stream{id viewersCount createdAt game{name}}}}';

(async () => {
  const ctx = await request.newContext({ proxy: PROXY, timeout: 30000 });
  const live = [];
  for (const ch of LIST) {
    const r = await ctx.post('https://gql.twitch.tv/gql', {
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
      data: { query: Q, variables: { login: ch.toLowerCase() } },
    }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    const s = j && j.data && j.data.user && j.data.user.stream;
    if (s) {
      live.push(ch);
      const mins = Math.round((Date.now() - Date.parse(s.createdAt)) / 60000);
      console.log(`${ch.padEnd(18)} LIVE  ${String(s.viewersCount).padStart(7)} viewers  ${mins} min  ${s.game ? s.game.name : ''}`);
    } else {
      console.log(`${ch.padEnd(18)} offline`);
    }
  }
  console.log('\nLIVE: ' + live.join(','));
  await ctx.dispose();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
