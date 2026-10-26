# Research scripts

Playwright scripts used to reverse-engineer Twitch playback and to regression-test the blocker.
They are **not** part of the extension and are excluded from release builds.

## Setup

```bash
npm install playwright
npx playwright install chromium
```

Some scripts need an HTTP proxy (Twitch geo-blocks parts of the world). Credentials are never
hardcoded — pass them through the environment:

```powershell
$env:PROXY_SERVER = 'http://host:port'
$env:PROXY_USER   = 'user'
$env:PROXY_PASS   = 'pass'
```

Without `PROXY_SERVER` the scripts go direct.

## Conventions

- `RUN=1` — actually start the browser (without it most scripts print their plan and exit).
- `PROFILE=<name>` — Playwright profile directory (defaults per script).
- Scripts that open Twitch run **headed**: headless Chrome does not receive SSAI ads, so the test
  would prove nothing.

## Main scripts

| Script | What it does |
|---|---|
| `livecheck.js` | checks which of the given channels are actually live (GQL `viewersCount`) |
| `chanswitch-test.js` | 10-minute run with random channel hopping, asserts video keeps playing |
| `dvrfallback-test.js` | end-to-end test of layer 3 (`FORCE=1` forces the DVR tail) |
| `dvrtail-test.js` | builds a sliding live playlist out of the DVR playlist (`MODE`, `QUALITY`, `TAIL`) |
| `guard-test.js` | unit test for the layer-2 black-screen guard on the real `stripPlaylist` |
| `popup-shot.js` | screenshots the popup (no channel needed) |
| `locale-shot.js` | screenshots the popup in several UI languages (`LANGS=en-US,ru-RU`) |
| `typematrix.js` | compares `playerType` values (`site`, `embed`, `dvr`, `popout`, `autoplay`) |
| `ui-test.js` | full run: opens a channel, waits, dumps `window.__adstrip` and the popup |
| `diag.js`, `reqlog.js`, `hooktest.js` | low-level diagnostics of worker patching and playlist requests |

## Notes

- Profiles (`*profile*`) and generated screenshots are git-ignored.
- After editing `content.js` or `manifest.json`, reload the extension in `chrome://extensions`
  before running a test — Playwright loads the folder as an unpacked extension.
- Kill leftover `chrome.exe` processes bound to a profile before reusing it; a locked profile
  makes the next launch fail.
