// End-to-end test of the DVR-tail fallback inside the real extension.
// FORCE=1 makes L1 throw, so the extension must serve the clean DVR tail.
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
const CH = (process.argv[2] || 'T2x2').toLowerCase();
const RUN = Number(process.env.RUN || 120);
const FORCE = process.env.FORCE !== '0';
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function acceptCookies(page) {
  const sels = ['[data-a-target="consent-banner-accept"]', 'button[aria-label="Принять"]', 'button:has-text("Принять")', 'button:has-text("Accept")', 'button:has-text("Согласен")'];
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      if (await el.count() && await el.isVisible()) { await el.click({ timeout: 3000 }); return true; }
    } catch (e) {}
  }
  return false;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'fb-profile'), {
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

  if (FORCE) {
    await ctx.addInitScript(() => { window.__adstripForceDvr = true; });
  }

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const accepted = await acceptCookies(page);
  try {
    const b = page.locator('button:has-text("Начать просмотр")').first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 3000 }); log('age gate clicked'); }
  } catch (e) {}
  log('cookies accepted = ' + accepted + ', FORCE=' + FORCE + ', sampling ' + RUN + 's');

  const samples = [];
  let timeouts = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < RUN * 1000) {
    await page.waitForTimeout(5000);
    const s = await Promise.race([
      page.evaluate(() => {
        const v = [...document.querySelectorAll('video')].find((x) => x.videoWidth > 0) || document.querySelector('video');
        if (!v) return { video: null };
        let buf = 0;
        try { if (v.buffered.length) buf = +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1); } catch (e) {}
        return { w: v.videoWidth, h: v.videoHeight, ct: +v.currentTime.toFixed(1), paused: v.paused, ready: v.readyState, buf };
      }),
      new Promise((r) => setTimeout(() => r({ timeout: true }), 12000)),
    ]);
    if (s.timeout) timeouts++;
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
  }

  const st = await page.evaluate(() => window.__adstrip || null);
  log('samples:');
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (i % 6 === 0 || s.paused || s.timeout || !s.w || i === samples.length - 1) console.log('   ' + JSON.stringify(s));
  }
  const bad = samples.filter((s) => s.paused || s.timeout || !s.w).length;
  const cts = samples.filter((s) => typeof s.ct === 'number').map((s) => s.ct);
  log('anomalies = ' + bad + '/' + samples.length + ', ct ' + (cts[0] || 0) + ' -> ' + (cts[cts.length - 1] || 0));
  log('stats = ' + JSON.stringify({
    patched: st && st.patched, masters: st && st.masters, cleanMasters: st && st.cleanMasters,
    blocked: st && st.blocked, stripped: st && st.strippedSegs, errors: st && st.errors,
  }));
  log('timeouts = ' + timeouts + ', url = ' + page.url());
  const ws = st && st.workerStats && st.workerStats[st.workerStats.length - 1];
  log('worker = ' + JSON.stringify(ws));
  log('log tail = ' + JSON.stringify((st && st.log || []).slice(-8)));
  await page.screenshot({ path: path.join(__dirname, 'ui', 'dvr-fallback.png') });
  await ctx.close();
  log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
