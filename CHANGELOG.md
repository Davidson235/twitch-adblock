# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] — 2026-10-26

### Added

- English localization (`_locales/en`) next to Russian (`_locales/ru`); the popup and the manifest follow the browser language, English is the default locale.
- Pixel-art popup in Twitch purple: framed card, glitch wordmark, crown, pixel smileys.
- State-aware main button: “Turn off” while blocking is on, “Turn on” while it is off.
- `scripts/build.ps1` to produce `dist/twitch-adblock-<version>.zip`.
- GitHub Actions release workflow that attaches the zip to a `v*` tag.

### Changed

- Popup counter now has a hard purple offset shadow; status row shows `LIVE` / `OFF`.
- Diagnostics (`checks / ad segments / DVR tail`) moved to the footer tooltip.
- Console diagnostics and worker notes translated to English.
- Log file names are now `twitch-adblock-*.json`.
- Version bumped to `0.6.0`.

## [0.5.0] — 2026-10-24

### Added

- Layer 3: DVR-tail fallback (`index-dvr.m3u8`), rebuilt on every request.
- Layer 2 black-screen guard: an ad-only playlist is returned untouched.

### Changed

- Extension and popup renamed to **Twitch adblock**.
- Popup shows the total blocked counter, per-tab counter and a log download button.

## [0.1.0] — 2026-10-20

### Added

- Initial PoC: `window.Worker` patch, master-playlist rewrite via `playerType=embed`, ad-segment stripping, `window.__adstrip` diagnostics.
