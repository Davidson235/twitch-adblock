// Logs every playlist-ish REQUEST (not response) to see the master/usher URL the player asks for.
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = process.argv[2] || 'recrent';
const MS = Number(process.argv[3] || 30000);
const OUT = path.join(__dirname, 'reqlog.json');

(async () => {
  const browser = await chromium.launch({ headless: true, proxy: PROXY, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const rows = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!/m3u8|usher|playlist\.ttvnw|gql\.twitch/i.test(u)) return;
    rows.push({ t: Date.now(), type: r.resourceType(), method: r.method(), url: u });
  });
  page.on('requestfailed', (r) => {
    if (/m3u8/.test(r.url())) rows.push({ failed: r.url().slice(0, 160), err: r.failure() && r.failure().errorText });
  });
  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(MS);
  fs.writeFileSync(OUT, JSON.stringify({ ch: CH, rows }, null, 2));
  for (const r of rows.slice(0, 25)) console.log((r.type || r.failed || '') + ' :: ' + (r.url || '').slice(0, 150));
  console.log('total', rows.length);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
