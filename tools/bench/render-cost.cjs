/**
 * Coût d'affichage du match 3D sur mobile (étape 6) : émulation d'un téléphone (Pixel 5, paysage)
 * avec processeur ralenti (CPU ×4 par le protocole Chrome), match en direct sans avance rapide.
 * Mesure, sur N secondes de jeu : durée des images (requestAnimationFrame) — moyenne, médiane, p95,
 * part des images > 33 ms — et temps de calcul de la simulation par image.
 * Usage : node tools/bench/render-cost.cjs [secondes=20] [ralentissement=4]
 * Le rendu headless (logiciel) ne représente pas un vrai téléphone : la mesure sert à COMPARER deux
 * versions dans les mêmes conditions, pas à prédire les images par seconde d'un appareil réel.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SECS = +(process.argv[2] || 20), SLOW = +(process.argv[3] || 4);
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
    await page.fill('input[name=username]', 'Mesure'); await page.fill('input[name=email]', 'mesure@exemple.fr'); await page.fill('input[name=password]', 'motdepasse');
    await page.click('[data-act=asubmit]');
    await page.click('[data-act=new][data-v="1"]');
    await page.waitForSelector('.sheet [data-act=go]', { timeout: 60000 }); await page.click('.sheet [data-act=go]');
    await page.waitForSelector('[data-act=div][data-v="5"]'); await page.click('[data-act=div][data-v="5"]');
    await page.click('.club-card >> nth=3'); await page.click('.sheet [data-act=take]');
    await page.waitForSelector('.sheet #c-fn'); await page.fill('.sheet #c-fn', 'Coach'); await page.fill('.sheet #c-ln', 'Mesure');
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
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
    // AB=1 : même match, fenêtres successives avec l'enregistreur de gestes réel / muet / réel (isoler son coût).
    // AB6=1 : même match, fenêtres successives affichage direct (avant 6b) / contrat (6b : différé + gestes migrés) ; REP=n paires (défaut 2).
    const R = +(process.env.REP || 2), windows = process.env.AB6 ? Array.from({ length: 2 * R }, (_, i) => (i % 2 ? 'contrat' : 'direct')) : process.env.AB ? ['réel', 'muet', 'réel', 'muet'] : ['réel'];
    for (const mode of windows) {
    if (process.env.AB6) await page.evaluate((m) => { const v = window.__view; v.animMode = m; v.disp6.reset(); }, mode);
    else await page.evaluate((m) => { const L = window.__view.live; L._gestReal ||= L.gest; L.gest = m === 'muet' ? { begin() { return null; }, replan() {}, finish() {}, contact() { return null; }, note() {}, sweep() {} } : L._gestReal; }, mode);
    const r = await page.evaluate((secs) => new Promise((res) => {
      const L = window.__view.live, step0 = L.step.bind(L); let simMs = 0;
      L.step = (dt) => { const a = performance.now(); const o = step0(dt); simMs += performance.now() - a; return o; };
      const fr = []; let last = performance.now(); const t0 = last, now0 = L.now;
      const loop = () => { const t = performance.now(); fr.push(t - last); last = t; if (t - t0 < secs * 1000) requestAnimationFrame(loop); else { L.step = step0; res({ fr, simMs, gameS: L.now - now0, wall: (t - t0) / 1000 }); } };
      requestAnimationFrame(loop);
    }), SECS);
    const s = [...r.fr].sort((a, b) => a - b), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    console.log(JSON.stringify({ mode, cpuSlowdown: SLOW, frames: r.fr.length, wallS: +r.wall.toFixed(1), gameS: +r.gameS.toFixed(1), meanMs: +(r.fr.reduce((a, b) => a + b, 0) / r.fr.length).toFixed(1), medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), over33: +(100 * r.fr.filter((x) => x > 33.4).length / r.fr.length).toFixed(1), simMsPerFrame: +(r.simMs / r.fr.length).toFixed(2) }));
    }
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
