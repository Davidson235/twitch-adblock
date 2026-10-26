const fs = require('fs');
const AD_RANGE = /CLASS="twitch-stitched-ad"|CLASS="twitch-ad-quartile"/;
function stripPlaylist(text) { 
      const lines = text.split('\n');
      const out = [];
      let buf = [];
      let removed = 0;
      let liveSegs = 0;
      let adSegs = 0;
      const flush = () => { if (buf.length) { out.push.apply(out, buf); buf = []; } };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.indexOf('#EXT-X-DATERANGE') === 0) {
          if (AD_RANGE.test(line)) { removed++; continue; }
          flush(); out.push(line); continue;
        }
        if (line.indexOf('#EXT-X-DISCONTINUITY') === 0 || line.indexOf('#EXT-X-MAP') === 0 ||
            line.indexOf('#EXT-X-PROGRAM-DATE-TIME') === 0 || line.indexOf('#EXT-X-KEY') === 0) {
          buf.push(line); continue;
        }
        if (line.indexOf('#EXTINF') === 0) {
          const isLive = /,\s*live\s*$/.test(line);
          if (!isLive) { i++; removed++; adSegs++; buf = []; continue; }
          flush(); out.push(line); liveSegs++; continue;
        }
        if (line.indexOf('#EXT-X-TWITCH-PREFETCH') === 0) {
          if (removed > 0) { i++; continue; }
          out.push(line); continue;
        }
        out.push(line);
      }
      flush();
      return { text: out.join('\n'), removed: removed, adSegs: adSegs, liveSegs: liveSegs }; }
const txt = fs.readFileSync('C:/Users/user/Desktop/Папка/PProjects/z--In-work--/twitch_adblock/research/sample-ad-playlist.m3u8','utf8');
const r = stripPlaylist(txt);
const extinf = r.text.split('\n').filter(l => l.startsWith('#EXTINF'));
console.log(JSON.stringify({ removed: r.removed, adSegs: r.adSegs, liveSegs: r.liveSegs, outExtinf: extinf.length, outBytes: r.text.length }));
console.log('--- first lines of output ---');
console.log(r.text.split('\n').slice(0, 8).join('\n'));