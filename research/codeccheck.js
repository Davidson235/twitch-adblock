const PW = 'playwright';
const { chromium } = require(PW);
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('about:blank');
  const r = await p.evaluate(() => {
    const t = (c) => { try { return MediaSource.isTypeSupported(c); } catch (e) { return 'err'; } };
    return {
      h264: t('video/mp4; codecs="avc1.64002a"'),
      hevc_hvc1: t('video/mp4; codecs="hvc1.1.6.L120.90"'),
      hevc_hev1: t('video/mp4; codecs="hev1.1.6.L120.90"'),
      av1: t('video/mp4; codecs="av01.0.08M.08"'),
      ua: navigator.userAgent,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
