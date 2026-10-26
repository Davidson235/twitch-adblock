// Loads the blocker extension, watches for ad UI + network ad playlists, dumps window.__adstrip stats.
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const EXT = path.join(__dirname, 'blocker');
const OUT = path.join(__dirname, 'blocktest');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'block.log');
const log = (m) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${m}`; fs.appendFileSync(LOG, s + '\n'); console.log(s); };

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CHANNELS = process.argv.slice(2).length ? process.argv.slice(2) : ['morphe_ya', 'recrent', 'gensyxa'];
const PER_CH = Number(process.env.PER_CH || 60000);

(async () => {
  fs.writeFileSync(LOG, '');
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'blocktest-profile'), {
    headless: false,
    proxy: PROXY,
    viewport: { width: 1280, height: 760 },
    locale: 'ru-RU',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--disable-blink-features=AutomationControlled',
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
    ],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  let servedAds = 0;
  let servedClean = 0;
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('.m3u8')) return;
    try {
      const b = await res.text();
      if (/twitch-stitched-ad/.test(b)) {
        servedAds++;
        const roll = (b.match(/X-TV-TWITCH-AD-ROLL-TYPE="([^"]+)"/) || [])[1];
        log(`  NET AD playlist roll=${roll} segs=${b.split('\n').filter(l => l.startsWith('#EXTINF')).length}`);
      } else servedClean++;
    } catch (e) {}
  });

  for (const ch of CHANNELS) {
    log('=== ' + ch);
    try { await page.goto('https://www.twitch.tv/' + ch, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch (e) { log('goto ' + e.message.slice(0, 60)); continue; }

    let adUi = false, uiText = '';
    const t0 = Date.now();
    while (Date.now() - t0 < PER_CH) {
      try {
        const r = await page.evaluate(() => {
          const root = document.querySelector('.video-player') || document.body;
          const txt = (root.innerText || '').replace(/\s+/g, ' ');
          return { ad: /Реклама\s*\(|рекламн\S*\s+пауз|Advertisement\s*\(/i.test(txt), txt: txt.slice(0, 200) };
        });
        if (r.ad) { adUi = true; uiText = r.txt; break; }
      } catch (e) {}
      await page.waitForTimeout(900);
    }

    const st = await page.evaluate(() => window.__adstrip || null);
    log(`  adUi=${adUi} ${uiText.slice(0, 90)}`);
    log('  stats=' + JSON.stringify(st));
    if (adUi) { try { await page.screenshot({ path: path.join(OUT, 'uiad_' + ch + '.png') }); } catch (e) {} }
    if (st && (st.cleanMasters > 0 || st.strippedSegs > 0)) {
      fs.writeFileSync(path.join(OUT, 'stats_' + ch + '.json'), JSON.stringify(st, null, 2));
    }
  }

  log(`DONE adPlaylistsSeen=${servedAds} cleanPlaylists=${servedClean}`);
  await ctx.close();
})().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
