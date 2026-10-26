// Bridge between the popup (chrome.storage) and the blocker running in the MAIN world.
// The MAIN world has no access to chrome.*, so they talk over window.postMessage.
(() => {
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__adstrip_to_ext !== true) return;

    if (d.type === 'stats') {
      chrome.storage.local.set({ stats: d.stats });
    } else if (d.type === 'blocked') {
      chrome.storage.local.get({ totalBlocked: 0 }, (v) => {
        chrome.storage.local.set({ totalBlocked: (v.totalBlocked || 0) + (d.n || 1) });
      });
    }
  });

  const pushConfig = () => {
    chrome.storage.local.get({ enabled: true }, (v) => {
      window.postMessage({ __adstrip_from_ext: true, type: 'config', enabled: v.enabled !== false }, '*');
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) pushConfig();
  });

  pushConfig();
})();
