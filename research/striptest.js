const fs=require('fs');
const f=process.argv[2];
let text=fs.readFileSync(f,'utf8').split('\n').slice(3).join('\n');
const AD=/CLASS="twitch-stitched-ad"|CLASS="twitch-ad-quartile"/;
function strip(t){const lines=t.split('\n');const out=[];let buf=[];let removed=0;const flush=()=>{if(buf.length){out.push(...buf);buf=[];}};
for(let i=0;i<lines.length;i++){const l=lines[i];
 if(l.startsWith('#EXT-X-DATERANGE')){if(AD.test(l)){removed++;continue;}flush();out.push(l);continue;}
 if(l.startsWith('#EXT-X-DISCONTINUITY')||l.startsWith('#EXT-X-MAP')){buf.push(l);continue;}
 if(l.startsWith('#EXTINF')){const live=/,\s*live\s*$/.test(l);if(!live){i++;removed++;buf=[];continue;}flush();out.push(l);continue;}
 if(l.startsWith('#EXT-X-TWITCH-PREFETCH')){if(removed>0){i++;continue;}out.push(l);continue;}
 out.push(l);}
flush();return {out:out.join('\n'),removed};}
const r=strip(text);
const res=r.out.split('\n');
console.log('removed lines:',r.removed);
console.log('extinf total:',res.filter(l=>l.startsWith('#EXTINF')).length,'ad:',res.filter(l=>l.startsWith('#EXTINF')&&!/,\s*live\s*$/.test(l)).length);
console.log('stitched left:',/stitched/.test(r.out));
console.log('--- head ---'); console.log(res.slice(0,14).join('\n'));
console.log('--- tail ---'); console.log(res.slice(-4).join('\n'));
