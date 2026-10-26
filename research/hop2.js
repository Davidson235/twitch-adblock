const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PW = 'playwright';
const { chromium } = require(PW);

const DIR = path.join(__dirname, 'hop2');
fs.mkdirSync(DIR, { recursive: true });
const LOG = path.join(DIR, 'hop2.log');
const log = (m) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${m}`; fs.appendFileSync(LOG, s + '\n'); console.log(s); };

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const MAX_CH = Number(process.argv[2] || 20);
const PER_CH_MS = Number(process.argv[3] || 16000);
const START = Number(process.argv[4] || 0);

(async () => {
  fs.writeFileSync(LOG, '');
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'hop2-profile'), {
    headless: false,
    proxy: PROXY,
    viewport: { width: 1280, height: 720 },
    locale: 'ru-RU',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  let channels = [];
  try {
    await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 2200); await page.waitForTimeout(1000); }
    channels = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('a[href^="/"]').forEach(a => {
        const m = a.getAttribute('href').match(/^\/([A-Za-z0-9_]{3,25})$/);
        if (m && !['directory', 'settings', 'search', 'subscriptions', 'inventory', 'wallet', 'drops', 'turbo', 'downloads', 'jobs', 'legal', 'p', 'store'].includes(m[1])) out.add(m[1]);
      });
      return [...out];
    });
  } catch (e) { log('dir err ' + e.message); }
  log('channels(' + channels.length + '): ' + channels.join(','));

  const report = { found: null, perChannel: [], playlists: [] };
  let adHit = false;

  for (let ci = START; ci < Math.min(channels.length, START + MAX_CH); ci++) {
    const ch = channels[ci];
    const chDir = path.join(DIR, ch);
    fs.mkdirSync(chDir, { recursive: true });
    let counter = 0;
    const local = [];
    const seen = new Set();
    const onResp = async (res) => {
      const u = res.url();
      if (!u.includes('.m3u8')) return;
      try {
        const body = await res.text();
        const h = crypto.createHash('md5').update(body).digest('hex').slice(0, 8);
        const extinf = body.split('\n').filter(l => l.startsWith('#EXTINF'));
        const adSegs = extinf.filter(l => !l.includes(',live')).length;
        const stitched = /stitched/i.test(body);
        local.push({ ch, bytes: body.length, extinf: extinf.length, adSegs, stitched });
        if (!seen.has(h)) {
          seen.add(h);
          const fn = path.join(chDir, `${String(++counter).padStart(3, '0')}_${adSegs || stitched ? 'AD' : 'live'}_${h}.m3u8`);
          fs.writeFileSync(fn, `# ${new Date().toISOString()} ${u}\n# extinf=${extinf.length} adSegs=${adSegs} stitched=${stitched}\n\n${body}`);
        }
      } catch (e) {}
    };
    page.on('response', onResp);
    log(`=== [${ci}] ${ch}`);
    try { await page.goto('https://www.twitch.tv/' + ch, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (e) { log('  goto ' + e.message.slice(0, 60)); page.off('response', onResp); continue; }

    let domAd = false, snippet = '';
    const t0 = Date.now();
    while (Date.now() - t0 < PER_CH_MS) {
      try {
        const r = await page.evaluate(() => {
          const root = document.querySelector('.video-player') || document.body;
          const txt = (root.innerText || '').replace(/\s+/g, ' ');
          return { ad: /Реклама\s*\(|рекламн\S*\s+пауз|Advertisement\s*\(|Ad\s*\(\d/i.test(txt), snippet: txt.slice(0, 140) };
        });
        if (r.ad) { domAd = true; snippet = r.snippet; break; }
      } catch (e) {}
      await page.waitForTimeout(700);
    }
    page.off('response', onResp);
    const adPl = local.filter(x => x.adSegs || x.stitched).length;
    report.perChannel.push({ ch, domAd, adPlaylists: adPl, playlists: local.length, snippet });
    log(`  => pl=${local.length} adPl=${adPl} domAd=${domAd} ${snippet.slice(0, 80)}`);

    if (domAd || adPl) {
      adHit = true;
      try { await page.screenshot({ path: path.join(chDir, 'ad_hit.png') }); } catch (e) {}
      // capture more of the ad
      const t1 = Date.now();
      const onResp2 = async (res) => {
        const u = res.url();
        if (!u.includes('.m3u8')) return;
        try {
          const body = await res.text();
          const h = crypto.createHash('md5').update(body).digest('hex').slice(0, 8);
          const extinf = body.split('\n').filter(l => l.startsWith('#EXTINF'));
          const adSegs = extinf.filter(l => !l.includes(',live')).length;
          if (!seen.has(h)) { seen.add(h); fs.writeFileSync(path.join(chDir, `ad_${h}.m3u8`), `# ${new Date().toISOString()} ${u}\n\n${body}`); }
          local.push({ ch, bytes: body.length, extinf: extinf.length, adSegs, stitched: /stitched/i.test(body) });
        } catch (e) {}
      };
      page.on('response', onResp2);
      while (Date.now() - t1 < 25000) { await page.waitForTimeout(1000); }
      page.off('response', onResp2);
      report.found = ch;
      break;
    }
  }

  report.playlists = report.perChannel;
  fs.writeFileSync(path.join(DIR, 'hop2-report.json'), JSON.stringify(report, null, 2));
  log('DONE adHit=' + adHit + ' found=' + (report.found || 'none'));
  await ctx.close();
})().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
