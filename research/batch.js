const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PW = 'playwright';
const { chromium } = require(PW);

const DIR = path.join(__dirname, 'batch');
fs.mkdirSync(DIR, { recursive: true });
const LOG = path.join(DIR, 'batch.log');
const log = (m) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${m}`; fs.appendFileSync(LOG, s + '\n'); console.log(s); };

// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const MAX_CH = Number(process.argv[2] || 10);
const PER_CH_MS = Number(process.argv[3] || 50000);

(async () => {
  fs.writeFileSync(LOG, '');
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'batch-profile'), {
    headless: true,
    proxy: PROXY,
    viewport: { width: 1280, height: 720 },
    locale: 'ru-RU',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // --- collect live channels from directory
  let channels = [];
  try {
    await page.goto('https://www.twitch.tv/directory/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2000); await page.waitForTimeout(1200); }
    channels = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('a[href^="/"]').forEach(a => {
        const m = a.getAttribute('href').match(/^\/([A-Za-z0-9_]{3,25})$/);
        if (m && !['directory', 'settings', 'search', 'subscriptions', 'inventory', 'wallet', 'drops'].includes(m[1])) out.add(m[1]);
      });
      return [...out];
    });
    log('directory channels: ' + channels.slice(0, 40).join(','));
  } catch (e) { log('directory err ' + e.message); }
  if (!channels.length) channels = ['xqc', 'kaicenat', 'tarik', 'ibai'];

  const report = { channels: [], playlists: [], adFound: null };

  // --- per channel
  const seen = new Set();
  let n = 0;
  for (const ch of channels) {
    if (n >= MAX_CH) break;
    n++;
    const chDir = path.join(DIR, ch);
    fs.mkdirSync(chDir, { recursive: true });
    let counter = 0;
    const local = [];
    const onResp = async (res) => {
      const u = res.url();
      if (!u.includes('.m3u8')) return;
      try {
        const body = await res.text();
        const h = crypto.createHash('md5').update(body).digest('hex').slice(0, 8);
        const extinf = body.split('\n').filter(l => l.startsWith('#EXTINF'));
        const adSegs = extinf.filter(l => !l.includes(',live')).length;
        const stitched = /stitched/i.test(body);
        const classes = [...body.matchAll(/CLASS="([^"]+)"/g)].map(m => m[1]);
        const rec = { ch, url: u.slice(0, 150), bytes: body.length, extinf: extinf.length, adSegs, stitched, classes };
        local.push(rec);
        if (!seen.has(h)) {
          seen.add(h);
          const fn = path.join(chDir, `${String(++counter).padStart(3, '0')}_${adSegs || stitched ? 'AD' : 'live'}_${h}.m3u8`);
          fs.writeFileSync(fn, `# ${new Date().toISOString()} ${u}\n# extinf=${extinf.length} adSegs=${adSegs} stitched=${stitched}\n\n${body}`);
        }
      } catch (e) {}
    };
    page.on('response', onResp);

    log(`=== ${ch}`);
    let domAd = false;
    try {
      await page.goto('https://www.twitch.tv/' + ch, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) { log('  goto ' + e.message.slice(0, 60)); page.off('response', onResp); continue; }

    const t0 = Date.now();
    while (Date.now() - t0 < PER_CH_MS) {
      try {
        const r = await page.evaluate(() => {
          const root = document.querySelector('.video-player') || document.body;
          const txt = (root.innerText || '').replace(/\s+/g, ' ');
          return { ad: /Реклама\s*\(|рекламн\S*\s+пауз|Advertisement\s*\(/i.test(txt), snippet: txt.slice(0, 120) };
        });
        if (r.ad && !domAd) { domAd = true; log('  DOM AD: ' + r.snippet); try { await page.screenshot({ path: path.join(chDir, 'domad.png') }); } catch (e) {} }
      } catch (e) {}
      await page.waitForTimeout(1500);
    }
    page.off('response', onResp);

    const adSegs = local.reduce((a, b) => a + (b.adSegs ? 1 : 0), 0);
    const stitched = local.some(x => x.stitched);
    const entry = { ch, domAd, playlists: local.length, adPlaylists: adSegs, stitched };
    report.channels.push(entry);
    report.playlists.push(...local);
    log(`  => playlists=${local.length} adPlaylists=${adSegs} stitched=${stitched} domAd=${domAd}`);

    if (domAd || adSegs || stitched) {
      report.adFound = ch;
      log('  *** AD CAPTURED on ' + ch + ' ***');
      await page.waitForTimeout(15000);
      try { await page.screenshot({ path: path.join(chDir, 'final.png') }); } catch (e) {}
      break;
    }
  }

  fs.writeFileSync(path.join(DIR, 'batch-report.json'), JSON.stringify(report, null, 2));
  log('DONE adFound=' + (report.adFound || 'none'));
  await ctx.close();
})().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
