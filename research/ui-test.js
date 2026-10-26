// Loads the extension, opens a channel, then opens the popup page and screenshots it.
const fs = require('fs');
const path = require('path');
const PW = 'playwright';
const { chromium } = require(PW);

const EXT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'ui');
fs.mkdirSync(OUT, { recursive: true });
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
// Optional HTTP proxy for regions where Twitch is blocked.
// Set PROXY_SERVER / PROXY_USER / PROXY_PASS instead of hardcoding credentials.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER || '', password: process.env.PROXY_PASS || '' }
  : undefined;

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'ui-profile'), {
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

  // --- extension id
  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  await ext.waitForTimeout(2500);
  const id = await ext.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector('extensions-item-list');
    const items = list && list.shadowRoot ? [...list.shadowRoot.querySelectorAll('extensions-item')] : [];
    const hit = items.find((i) => (i.name || '').includes('adblock')) || items[0];
    return hit ? hit.id : null;
  });
  log('extension id = ' + id);
  await ext.close();

  if (!id) throw new Error('extension not loaded');

  // --- twitch channel
  const page = await ctx.newPage();
  const CH = process.argv[2] || 'gensyxa';
  await page.goto('https://www.twitch.tv/' + CH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const accepted = await acceptCookies(page);
  try {
    const b = page.locator('button:has-text("Начать просмотр")').first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 3000 }); log('age gate clicked'); }
  } catch (e) {}
  log('cookies accepted = ' + accepted + ', waiting 45s');
  await page.waitForTimeout(45000);
  const st = await page.evaluate(() => window.__adstrip || null);
  log('stats = ' + JSON.stringify({ patched: st && st.patched, masters: st && st.masters, cleanMasters: st && st.cleanMasters, blocked: st && st.blocked, checks: st && st.checks, errors: st && st.errors, log: st && st.log }));
  log('worker = ' + JSON.stringify(st && st.workerStats && st.workerStats[st.workerStats.length - 1]));

  // --- popup page
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 320, height: 340 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(1200);
  const ui = await popup.evaluate(() => ({
    total: document.getElementById('total').textContent,
    session: document.getElementById('session').textContent,
    status: document.getElementById('statusText').textContent,
    btn: document.getElementById('btnLabel').textContent,
    foot: document.getElementById('foot').textContent.replace(/\s+/g, ' ').trim(),
    pressed: document.getElementById('toggleBtn').getAttribute('aria-pressed'),
  }));
  log('popup = ' + JSON.stringify(ui));
  await popup.screenshot({ path: path.join(OUT, 'popup-on.png') });

  // --- toggle off
  await popup.click('#toggleBtn');
  await popup.waitForTimeout(800);
  const off = await popup.evaluate(() => ({
    status: document.getElementById('statusText').textContent,
    pressed: document.getElementById('toggleBtn').getAttribute('aria-pressed'),
  }));
  log('after toggle = ' + JSON.stringify(off));
  await popup.screenshot({ path: path.join(OUT, 'popup-off.png') });

  const storage = await popup.evaluate(() => new Promise((r) => chrome.storage.local.get(null, r)));
  fs.writeFileSync(path.join(OUT, 'storage.json'), JSON.stringify(storage, null, 2));
  log('storage keys = ' + Object.keys(storage).join(','));

  // --- toggle back on
  await popup.click('#toggleBtn');
  await popup.waitForTimeout(600);

  await ctx.close();
  log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
