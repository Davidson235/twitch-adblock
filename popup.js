const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, stats: {}, totalBlocked: 0 };

const UI_LANG = (() => {
  try { return chrome.i18n.getUILanguage() || 'en'; } catch (e) { return 'en'; }
})();

function t(key, subs) {
  try {
    const s = chrome.i18n.getMessage(key, subs);
    return s || key;
  } catch (e) {
    return key;
  }
}

function applyI18n() {
  document.documentElement.lang = UI_LANG.split('-')[0];
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    const msg = t(key);
    if (msg && msg !== key) el.textContent = msg;
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString(UI_LANG);
}

function render(state) {
  const s = state.stats || {};
  const on = state.enabled !== false;

  $('total').textContent = fmt(state.totalBlocked || 0);
  $('session').textContent = t('sessionCount', [fmt(s.blocked || 0)]);
  $('statusText').textContent = on ? t('statusLive') : t('statusOff');
  $('btnLabel').textContent = on ? t('btnDisable') : t('btnEnable');
  $('toggleBtn').setAttribute('aria-pressed', String(on));
  $('toggleBtn').setAttribute('aria-label', on ? t('ariaDisable') : t('ariaEnable'));
  $('toggleBtn').setAttribute('title', on ? t('ariaDisable') : t('ariaEnable'));
  document.body.classList.toggle('off', !on);

  const checks = Array.isArray(s.checks) ? s.checks : [];
  const adSegs = checks.reduce((a, c) => a + (c.adSegs || 0), 0);
  $('ver').textContent = 'v' + (s.v || 5);
  $('foot').title = t('diagChecks', [String(checks.length), String(adSegs)]) +
    (s.dvrOk ? t('dvrTail') : '');
}

function load() {
  chrome.storage.local.get(DEFAULTS, render);
}

applyI18n();
load();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') load();
});

$('toggleBtn').addEventListener('click', () => {
  chrome.storage.local.get(DEFAULTS, (v) => {
    chrome.storage.local.set({ enabled: v.enabled === false });
  });
});

$('dump').addEventListener('click', () => {
  chrome.storage.local.get(DEFAULTS, (v) => {
    const data = JSON.stringify(v.stats || {}, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'twitch-adblock-' + ((v.stats && v.stats.channel) || 'log') + '-' + Date.now() + '.json';
    a.click();
  });
});
