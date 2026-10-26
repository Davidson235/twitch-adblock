// 10-minute channel-hopping test: switch to a random live channel every 15-60 s and verify
// that on every page the worker is patched, L1 returns a clean master, and video actually plays.
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
const CHANNELS = (process.argv[2] || 'sasavot,morphe_ya,busteroid1337,melharucos,iLame,Jeens,Starky,SleDuck,kopsteep,frametamer666').split(',');
const TOTAL = Number(process.env.RUN || 600);
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function accept(page) {
  const sels = ['[data-a-target="consent-banner-accept"]', 'button[aria-label="Принять"]', 'button:has-text("Принять")', 'button:has-text("Accept")'];
  for (const s of sels) {
    try { const el = page.locator(s).first(); if (await el.count() && await el.isVisible()) { await el.click({ timeout: 2000 }); break; } } catch (e) {}
  }
  try {
    const b = page.locator('button:has-text("Начать просмотр")').first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 2000 }); }
  } catch (e) {}
}

async function state(page) {
  return Promise.race([
    page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((x) => x.videoWidth > 0) || document.querySelector('video');
      const st = window.__adstrip || {};
      return {
        video: v ? { w: v.videoWidth, h: v.videoHeight, ct: +v.currentTime.toFixed(1), paused: v.paused, ready: v.readyState } : null,
        patched: st.patched || 0, masters: st.masters || 0, cleanMasters: st.cleanMasters || 0,
        dvrOk: st.dvrOk || 0, blocked: st.blocked || 0, phase: st.phase || null,
        checks: (st.checks || []).map((c) => ({ ok: c.ok, adSegs: c.adSegs, liveSegs: c.liveSegs })),
        errors: (st.errors || []).slice(0, 3),
      };
    }),
    new Promise((r) => setTimeout(() => r(null), 10000)),
  ]);
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'cs-profile'), {
    headless: false, proxy: PROXY, viewport: { width: 1280, height: 760 }, locale: 'ru-RU',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled',
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const t0 = Date.now();
  const results = [];
  let prev = null;
  let hop = 0;

  while ((Date.now() - t0) / 1000 < TOTAL - 12) {
    let ch = CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
    if (CHANNELS.length > 1 && ch === prev) ch = CHANNELS[(CHANNELS.indexOf(ch) + 1) % CHANNELS.length];
    prev = ch;
    hop++;
    const remain = TOTAL - (Date.now() - t0) / 1000;
    const dwell = Math.max(12, Math.min(15 + Math.floor(Math.random() * 46), Math.floor(remain - 6)));

    const navStart = Date.now();
    await page.goto('https://www.twitch.tv/' + ch, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await accept(page);
    const loadMs = Date.now() - navStart;

    const start = Date.now();
    let first = null, last = null, paused = 0, blank = 0, samples = 0;
    while ((Date.now() - start) / 1000 < dwell) {
      await page.waitForTimeout(5000);
      const s = await state(page);
      if (!s) { blank++; continue; }
      samples++;
      if (s.video && s.video.w > 0) { if (!first) first = s.video; last = s.video; if (s.video.paused) paused++; }
      else blank++;
    }
    const end = (await state(page)) || {};
    const rec = {
      hop, ch, dwell, loadMs,
      w: last ? last.w : 0, h: last ? last.h : 0,
      ct0: first ? first.ct : null, ct1: last ? last.ct : null,
      paused, blank, samples,
      patched: end.patched || 0, masters: end.masters || 0, cleanMasters: end.cleanMasters || 0,
      dvrOk: end.dvrOk || 0, blocked: end.blocked || 0,
      adSegs: (end.checks || []).reduce((a, c) => a + (c.adSegs || 0), 0),
      checks: (end.checks || []).length,
      errors: (end.errors || []).length,
      err0: (end.errors || [])[0] || '',
    };
    results.push(rec);
    log(`${String(hop).padStart(2)}. ${ch.padEnd(16)} ${String(dwell).padStart(2)}s  ` +
        `${rec.w}x${rec.h}  ct ${rec.ct0}->${rec.ct1}  paused=${paused} blank=${blank}  ` +
        `masters=${rec.masters} clean=${rec.cleanMasters} dvr=${rec.dvrOk} adSegs=${rec.adSegs} err=${rec.errors}`);
  }

  const ok = results.filter((r) => r.w > 0 && r.cleanMasters > 0 && r.paused === 0);
  const noVideo = results.filter((r) => r.w === 0);
  const bad = results.filter((r) => r.paused > 0);
  log('--- SUMMARY ---');
  log(`hops=${results.length} ok=${ok.length} noVideo=${noVideo.length} paused=${bad.length} ` +
      `adSegs=${results.reduce((a, r) => a + r.adSegs, 0)} dvrFallbacks=${results.filter((r) => r.dvrOk > 0).length} ` +
      `errors=${results.reduce((a, r) => a + r.errors, 0)}`);
  if (noVideo.length) log('no video: ' + noVideo.map((r) => r.ch).join(','));
  if (bad.length) log('paused: ' + bad.map((r) => `${r.ch}(${r.paused})`).join(','));
  fs.writeFileSync(path.join(__dirname, 'ui', 'chanswitch.json'), JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.join(__dirname, 'ui', 'chanswitch.png') });
  await ctx.close();
  log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
