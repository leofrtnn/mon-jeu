/**
 * Contact VISUEL squelette 3D ↔ ballon (étape 6b) : pendant un match en direct, pour chaque geste
 * migré (frappes, passes, centres, dégagements, remises en jeu au pied, contrôles, touches de conduite),
 * la sonde du rendu (Match3D.probe6) rejoue l'affichage pas à pas autour du contact physique avec le
 * même calcul de pose que l'écran, une fois avec le contrat (mode « contrat ») et une fois avec les
 * anciens indicateurs (mode « ancien », même différé) : distance minimale partie du corps ↔ ballon et
 * instant de ce minimum par rapport au contact physique.
 * Usage : node tools/bench/anim-probe.cjs [secondes de jeu=60]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SECS = +(process.argv[2] || 60);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const serve = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(0, () => resolve(srv));
});

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5 landscape'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
  const page = await ctx.newPage();
  try {
    await page.goto(`http://localhost:${srv.address().port}/?backend=local`);
    await page.click('[data-act=amode][data-v=signup]');
    await page.fill('input[name=username]', 'Sonde'); await page.fill('input[name=email]', 'sonde@exemple.fr'); await page.fill('input[name=password]', 'motdepasse');
    await page.click('[data-act=asubmit]');
    await page.click('[data-act=new][data-v="1"]');
    await page.waitForSelector('.sheet [data-act=go]', { timeout: 60000 }); await page.click('.sheet [data-act=go]');
    await page.waitForSelector('[data-act=div][data-v="5"]'); await page.click('[data-act=div][data-v="5"]');
    await page.click('.club-card >> nth=3'); await page.click('.sheet [data-act=take]');
    await page.waitForSelector('.sheet #c-fn'); await page.fill('.sheet #c-fn', 'Coach'); await page.fill('.sheet #c-ln', 'Sonde');
    for (let i = 0; i < 8 && !(await page.isVisible('.sheet [data-act=ok]')); i++) await page.click('.sheet [data-act=next]');
    await page.click('.sheet [data-act=ok]');
    await page.waitForSelector('[data-act=psmeeting]'); await page.click('[data-act=psmeeting]');
    await page.click('.sheet [data-act=ch][data-v=accept]'); await page.click('.sheet [data-act=ok]');
    await page.click('[data-act=pscamp][data-v=alps]'); await page.click('[data-act=psint][data-v=hard]');
    for (let i = 0; i < 12 && !(await page.isEnabled('[data-act=psstart]')); i++) await page.click('[data-act=psday][data-v="3"]');
    await page.click('[data-act=psstart]');
    await page.waitForSelector('[data-act=play], [data-act=simulate]');
    if (!(await page.$('[data-act=play]'))) { await page.click('[data-act=simulate] >> nth=0'); await page.waitForSelector('.sheet [data-act=close]', { timeout: 30000 }); await page.click('.sheet [data-act=close]'); }
    await page.waitForSelector('[data-act=play]'); await page.click('[data-act=play]'); await page.click('[data-act=go]');
    await page.waitForFunction(() => window.__view?.live?.m?.phase === 'live', null, { timeout: 60000 });
    await page.evaluate(() => { window.__view.hlWant = () => true; });
    await page.waitForTimeout(4000);   // chargement terminé, jeu lancé
    if (process.env.CALIB) { const c = await page.evaluate(() => window.__view.r3d.calib6()); console.log(JSON.stringify(c)); throw new Error('étalonnage terminé'); }
    await page.evaluate(() => { window.__view.disp6.extra = 1.4; });
    const res = { contrat: [], ancien: [] };
    let last = await page.evaluate(() => window.__view.live.now), start = last;
    while (last - start < SECS) {
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const v = window.__view, now = v.live.now, tTo = now - 0.5, tFrom = Math.max(v._probeT || 0, tTo - 1.0);
        if (tTo <= tFrom) return { now, c: [], a: [] };
        v._probeT = tTo;
        const c = v.r3d.probe6('contrat', tFrom, tTo), a = v.r3d.probe6('ancien', tFrom, tTo);
        return { now, c, a };
      });
      res.contrat.push(...r.c); res.ancien.push(...r.a); last = r.now;
    }
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
    const dt = 1 / 96, kinds = [...new Set([...res.contrat, ...res.ancien].map((x) => x.kind))];
    console.log(`sonde visuelle : ${res.contrat.length} gestes (${(last - start).toFixed(0)} s de jeu) · instant du rapprochement maximal partie du corps ↔ ballon − contact physique (s) : médiane [p5, p95] · part à ≤ 1 pas · distance minimale (m) · distance au contact (m)`);
    for (const k of kinds) for (const mode of ['ancien', 'contrat']) {
      const a = res[mode].filter((x) => x.kind === k); if (!a.length) continue;
      const off = a.map((x) => x.dtMin);
      const tch = a.filter((x) => x.touchFrom != null), atc = a.map((x) => x.dAtC);
      console.log(`  ${k.padEnd(26)} ${mode.padEnd(8)} n=${String(a.length).padStart(4)}  ${q(off, 0.5).toFixed(3)} [${q(off, 0.05).toFixed(3)}, ${q(off, 0.95).toFixed(3)}] · ${(100 * off.filter((x) => Math.abs(x) <= dt + 1e-6).length / a.length).toFixed(0).padStart(3)} % · min ${q(a.map((x) => x.minD), 0.5).toFixed(3)} · au contact ${q(atc, 0.5).toFixed(3)} (|d| ≤ 3 cm : ${(100 * atc.filter((x) => Math.abs(x) <= 0.03).length / a.length).toFixed(0)} %) · pénétration hors du contact : médiane ${q(a.map((x) => x.maxPen), 0.5).toFixed(3)} m, p95 ${q(a.map((x) => x.maxPen), 0.95).toFixed(3)} m, > 2 cm ${(100 * a.filter((x) => x.maxPen > 0.02).length / a.length).toFixed(0)} % · partie du corps DANS le ballon hors [−1, +1] pas : avant ${(100 * tch.filter((x) => x.touchFrom < -dt - 1e-6).length / a.length).toFixed(0)} %, après ${(100 * tch.filter((x) => x.touchTo > dt + 1e-6).length / a.length).toFixed(0)} %`);
    }
    if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify(res));
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
