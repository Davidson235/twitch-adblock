// Unit test for the L2 guard (variant 4): extract the real stripPlaylist() from content.js and
// check that an ad-only playlist is recognised as "nothing left to play".
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(at, i);
}

const fnSrc = extractFn(SRC, 'stripPlaylist');
const stripPlaylist = eval('(function () { const AD_RANGE = /CLASS="twitch-stitched-ad"|CLASS="twitch-ad-quartile"/; return (' + fnSrc + '); })()');

const adOnly = fs.readFileSync(path.join(__dirname, 'sample-ad-playlist.m3u8'), 'utf8');

const mixed = [
  '#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:100',
  '#EXT-X-DATERANGE:ID="ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-01-01T00:00:00Z"',
  '#EXTINF:6.000,', 'https://cdn/ad1.ts',
  '#EXTINF:6.000,', 'https://cdn/ad2.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:12Z',
  '#EXTINF:2.000,live', 'https://cdn/live1.ts',
  '#EXTINF:2.000,live', 'https://cdn/live2.ts',
  '#EXTINF:2.000,live', 'https://cdn/live3.ts',
].join('\n');

const clean = [
  '#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:2',
  '#EXTINF:2.000,live', 'https://cdn/live1.ts',
  '#EXTINF:2.000,live', 'https://cdn/live2.ts',
].join('\n');

const cases = [
  { name: 'ad-only preroll', text: adOnly, expectLive: 0, expectRemoved: '>0' },
  { name: 'mixed ad + live', text: mixed, expectLive: 3, expectRemoved: 3 },
  { name: 'clean live', text: clean, expectLive: 2, expectRemoved: 0 },
];

let fail = 0;
for (const c of cases) {
  const r = stripPlaylist(c.text);
  const outLines = r.text.split('\n').filter((l) => l.startsWith('#EXTINF')).length;
  const guard = r.liveSegs === 0; // guard must return the ORIGINAL playlist in this case
  const okLive = r.liveSegs === c.expectLive;
  const okRemoved = c.expectRemoved === '>0' ? r.removed > 0 : r.removed === c.expectRemoved;
  const ok = okLive && okRemoved;
  if (!ok) fail++;
  console.log(JSON.stringify({
    case: c.name, ok,
    liveSegs: r.liveSegs, adSegs: r.adSegs, removed: r.removed, outExtinf: outLines,
    guardTriggers: guard, playerWouldGet: guard ? 'ORIGINAL (ad plays, no black screen)' : (r.removed ? 'STRIPPED' : 'ORIGINAL'),
  }));
}
console.log(fail ? 'FAIL ' + fail : 'ALL OK');
process.exit(fail ? 1 : 0);
