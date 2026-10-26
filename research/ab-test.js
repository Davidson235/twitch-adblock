// A/B test: same channel, same proxy, with and without the blocker extension.
// Usage: node ab-test.js block|noblock ch1 ch2 ...
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const MODE = process.argv[2] || 'noblock';
const CHANNELS = process.argv.slice(3).length ? process.argv.slice(3) : ['recrent', 'gensyxa'];
const EXT = process.env.EXT_DIR || path.join(__dirname, '..');
const OUT = path.join(__dirname, 'ab');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ab_${MODE}.log`);
const log = (m) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${m}`; fs.appendFileSync(LOG, s + '\n'); console.log(s); };

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const PER_CH = 75000;

(async () => {
  fs.writeFileSync(LOG, '');
  const args = [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-blink-features=AutomationControlled',
  ];
  if (MODE === 'block') args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);

  const profile = path.join(__dirname, `ab-profile-${MODE}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, proxy: PROXY, viewport: { width: 1280, height: 760 }, locale: 'ru-RU', args,
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const per = [];
  let servedAd = 0, servedClean = 0;
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('.m3u8')) return;
    try {
      const b = await res.text();
      if (/twitch-stitched-ad/.test(b)) servedAd++; else servedClean++;
    } catch (e) {}
  });

  for (const ch of CHANNELS) {
    log('=== ' + ch);
    try { await page.goto('https://www.twitch.tv/' + ch, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch (e) { log('goto ' + e.message.slice(0, 60)); continue; }

    const t0 = Date.now();
    let adUi = false, uiText = '', samples = [], lastCt = -1, stalled = 0;
    while (Date.now() - t0 < PER_CH) {
      const r = await page.evaluate(() => {
        const root = document.querySelector('.video-player') || document.body;
        const txt = (root.innerText || '').replace(/\s+/g, ' ');
        const v = document.querySelector('video');
        return {
          ad: /Реклама\s*\(|рекламн\S*\s+пауз|Advertisement\s*\(/i.test(txt),
          txt: txt.slice(0, 220),
          ct: v ? v.currentTime : null,
          dur: v ? v.duration : null,
          paused: v ? v.paused : null,
          ready: v ? v.readyState : null,
          w: v ? v.videoWidth : null,
          offline: /не в сети|offline|Запись недоступна/i.test(txt),
        };
      }).catch(() => null);
      if (r) {
        if (r.ad && !adUi) { adUi = true; uiText = r.txt; log('  AD UI: ' + uiText.slice(0, 120)); try { await page.screenshot({ path: path.join(OUT, `ad_${MODE}_${ch}.png`) }); } catch (e) {} }
        if (r.ct !== null) {
          if (lastCt >= 0 && Math.abs(r.ct - lastCt) < 0.15 && !r.paused) stalled++;
          lastCt = r.ct;
          samples.push({ t: Date.now() - t0, ct: +r.ct.toFixed(2), ready: r.ready, w: r.w, paused: r.paused, dur: r.dur });
        }
        if (r.offline) { log('  OFFLINE: ' + r.txt.slice(0, 90)); break; }
      }
      await page.waitForTimeout(1200);
    }

    const st = MODE === 'block' ? await page.evaluate(() => window.__adstrip || null).catch(() => null) : null;
    const first = samples[0], last = samples[samples.length - 1];
    const played = first && last ? +(last.ct - first.ct).toFixed(1) : null;
    const entry = { ch, adUi, playedSec: played, samples: samples.length, stalledTicks: stalled, w: last && last.w, stats: st };
    per.push(entry);
    log(`  => adUi=${adUi} played=${played}s width=${last && last.w} stalledTicks=${stalled}`);
    if (st) log('  stats=' + JSON.stringify(st));
  }

  fs.writeFileSync(path.join(OUT, `ab_${MODE}.json`), JSON.stringify({ mode: MODE, servedAd, servedClean, per }, null, 2));
  log(`DONE mode=${MODE} adPlaylistsServed=${servedAd} cleanPlaylists=${servedClean}`);
  await ctx.close();
})().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
