// Screenshot the popup only (no channel needed) — for UI checks after edits.
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const EXT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'ui');
fs.mkdirSync(OUT, { recursive: true });
const PROFILE = process.env.PROFILE || 'ui-profile';

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, PROFILE), {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  await ext.waitForTimeout(2000);
  const id = await ext.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector('extensions-item-list');
    const items = list && list.shadowRoot ? [...list.shadowRoot.querySelectorAll('extensions-item')] : [];
    const hit = items.find((i) => (i.name || '').includes('adblock')) || items[0];
    return hit ? hit.id : null;
  });
  console.log('id =', id, 'name-check ok');
  await ext.close();
  if (!id) throw new Error('extension not loaded');

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 320, height: 460 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(600);

  // seed a realistic state so the screenshot is not all zeros
  await popup.evaluate(() => new Promise((res) => {
    chrome.storage.local.set({
      enabled: true,
      totalBlocked: 1,
      stats: { blocked: 1, v: 5, dvrOk: false, checks: [{ adSegs: 6, liveSegs: 2 }] },
    }, res);
  }));
  await popup.waitForTimeout(500);

  const read = () => popup.evaluate(() => ({
    title: document.querySelector('.title') ? document.querySelector('.title').textContent : null,
    sub: !!document.querySelector('.sub'),
    total: document.getElementById('total').textContent,
    status: document.getElementById('statusText').textContent,
    btn: document.getElementById('btnLabel').textContent,
    foot: document.getElementById('foot').textContent.replace(/\s+/g, ' ').trim(),
    size: { w: document.body.offsetWidth, h: document.body.offsetHeight },
  }));

  console.log('on  =', JSON.stringify(await read()));
  const box = await popup.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight }));
  await popup.setViewportSize({ width: box.w, height: box.h });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(OUT, 'popup-on.png') });

  await popup.click('#toggleBtn');
  await popup.waitForTimeout(700);
  console.log('off =', JSON.stringify(await read()));
  await popup.screenshot({ path: path.join(OUT, 'popup-off.png') });
  await popup.click('#toggleBtn');
  await popup.waitForTimeout(400);

  await ctx.close();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
