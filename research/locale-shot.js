// Screenshots the popup in several UI languages: LANGS=en-US,ru-RU node research/locale-shot.js
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const EXT = process.env.EXT || path.join(__dirname, '..');
const OUT = path.join(EXT, 'docs');
const LANGS = (process.env.LANGS || 'en-US,ru-RU').split(',').map((s) => s.trim()).filter(Boolean);

async function shoot(lang) {
  const base = lang.split('-')[0];
  const profile = path.join(__dirname, `lang-profile-${base}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--lang=${lang}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  await ext.waitForTimeout(2000);
  const id = await ext.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector('extensions-item-list');
    const items = list && list.shadowRoot ? [...list.shadowRoot.querySelectorAll('extensions-item')] : [];
    const hit = items.find((i) => (i.name || '').toLowerCase().includes('adblock')) || items[0];
    return hit ? hit.id : null;
  });
  await ext.close();
  if (!id) throw new Error('extension not loaded for ' + lang);

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 320, height: 460 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(600);
  await popup.evaluate(() => new Promise((res) => {
    chrome.storage.local.set({
      enabled: true,
      totalBlocked: 1,
      stats: { blocked: 1, v: 5, dvrOk: false, checks: [{ adSegs: 6, liveSegs: 2 }] },
    }, res);
  }));
  await popup.waitForTimeout(500);

  const info = await popup.evaluate(() => ({
    ui: chrome.i18n.getUILanguage(),
    name: chrome.i18n.getMessage('extName'),
    desc: chrome.i18n.getMessage('extDescription'),
    lang: document.documentElement.lang,
    caption: document.querySelector('.cap').textContent,
    session: document.getElementById('session').textContent,
    btn: document.getElementById('btnLabel').textContent,
    status: document.getElementById('statusText').textContent,
    foot: document.getElementById('foot').textContent.replace(/\s+/g, ' ').trim(),
    title: document.getElementById('foot').title,
  }));
  console.log(base, JSON.stringify(info));

  const box = await popup.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight }));
  await popup.setViewportSize({ width: box.w, height: box.h });
  await popup.waitForTimeout(250);
  await popup.screenshot({ path: path.join(OUT, `popup-${base}.png`) });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const lang of LANGS) await shoot(lang);
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
