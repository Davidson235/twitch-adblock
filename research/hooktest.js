// Determines WHERE the player fetches .m3u8 (page context vs Web Worker)
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
const OUT = path.join(__dirname, 'hooktest.json');

(async () => {
  const ctx = await chromium.launch({
    headless: true,
    proxy: PROXY,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__hits = [];
    const push = (src, url) => { try { window.__hits.push({ src, url: String(url).slice(0, 120), t: Date.now() }); } catch (e) {} };
    const of = window.fetch;
    window.fetch = function (input, init) {
      const u = typeof input === 'string' ? input : (input && input.url);
      if (u && String(u).includes('.m3u8')) push('page.fetch', u);
      return of.apply(this, arguments);
    };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (u && String(u).includes('.m3u8')) push('page.xhr', u);
      return oo.apply(this, arguments);
    };
    const OW = window.Worker;
    window.__workers = [];
    window.Worker = class extends OW {
      constructor(url, opts) {
        super(url, opts);
        try {
          window.__workers.push(String(url).slice(0, 80));
          // patch inside worker: wrap its fetch via a message-free approach is not possible;
          // instead we record that a worker was created so we can interpret network logs.
        } catch (e) {}
      }
    };
  });

  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(25000);
  const res = await page.evaluate(() => ({ hits: window.__hits, workers: window.__workers || [] }));
  fs.writeFileSync(OUT, JSON.stringify({ ch: CH, ...res }, null, 2));
  console.log('page-origin m3u8 hits:', res.hits.length);
  console.log(JSON.stringify(res.hits.slice(0, 8), null, 1));
  console.log('workers:', res.workers.length, JSON.stringify(res.workers.slice(0, 5)));
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
