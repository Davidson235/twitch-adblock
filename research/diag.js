// Diagnostics: does the extension break player start?
// Usage: node diag.js <channel>            (with extension)
//        NOEXT=1 node diag.js <channel>    (without extension)
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const EXT = path.join(__dirname, '..');
// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;
const CH = process.argv[2] || 'dangerlyoha';
const NOEXT = process.env.NOEXT === '1';
const TAG = NOEXT ? 'noext' : 'ext';

async function clickFirst(page, sels, label) {
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      if ((await el.count()) && (await el.isVisible())) {
        await el.click({ timeout: 3000 });
        console.log(label + ' clicked via ' + s);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'diag-profile'), {
    headless: false, proxy: PROXY, viewport: { width: 1280, height: 760 }, locale: 'ru-RU',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
      .concat(NOEXT ? [] : [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]),
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const reqs = [];
  const consoleErrs = [];
  const pageErrs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!/usher|playlist\.ttvnw|\.m3u8/i.test(u)) return;
    let frame = '';
    try { frame = r.frame().url(); } catch (e) {}
    reqs.push({ type: r.resourceType(), frame: frame.slice(0, 90), url: u.slice(0, 110) });
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrs.push(String(e).slice(0, 200)));

  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  await clickFirst(page, ['[data-a-target="consent-banner-accept"]', 'button:has-text("Принять")', 'button:has-text("Accept")'], 'cookies');
  await page.waitForTimeout(1500);
  await clickFirst(page, ['button:has-text("Начать просмотр")', 'button:has-text("Start Watching")'], 'age gate');
  await page.waitForTimeout(25000);

  const info = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('video')];
    const v = vids.find((x) => x.videoWidth > 0) || vids[0] || null;
    return {
      adstrip: window.__adstrip ? {
        enabled: window.__adstrip.enabled, patched: window.__adstrip.patched,
        pageWorkers: window.__adstrip.pageWorkers,
        masters: window.__adstrip.masters, cleanMasters: window.__adstrip.cleanMasters,
        workerStats: window.__adstrip.workerStats,
        errors: window.__adstrip.errors, log: window.__adstrip.log,
      } : null,
      videos: vids.length,
      video: v ? { w: v.videoWidth, h: v.videoHeight, ct: +v.currentTime.toFixed(1), paused: v.paused, ready: v.readyState, src: (v.currentSrc || '').slice(0, 70) } : null,
      frames: [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 100)),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 180),
    };
  });

  console.log('REQS:'); reqs.slice(0, 14).forEach((r) => console.log(` ${r.type} frame=${r.frame} ${r.url}`));
  if (consoleErrs.length) { console.log('CONSOLE ERRORS:'); consoleErrs.slice(0, 8).forEach((e) => console.log('  ' + e)); }
  if (pageErrs.length) { console.log('PAGE ERRORS:'); pageErrs.slice(0, 8).forEach((e) => console.log('  ' + e)); }
  await page.screenshot({ path: path.join(__dirname, 'diag-' + TAG + '.png') });
  console.log('INFO:', JSON.stringify(info, null, 2));
  await ctx.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
