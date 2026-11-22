/**
 * Synchronisation son / commentaires / image (étape 6b). Les évènements du match (sons, commentaires,
 * bannières, score) sont produits par le moteur ; l'image est affichée avec un différé (0,15 s).
 * Mesure, dans un même match, l'avance de chaque évènement sur l'image qui le montre :
 *  - en temps de jeu : instant de l'évènement − instant affiché au moment où il est diffusé ;
 *  - en temps réel : instant de diffusion − instant de la première image où le jeu affiché l'atteint.
 * Deux fenêtres : évènements au temps du moteur (avant correction), puis au rythme de l'image.
 * Usage : node tools/bench/av-sync.cjs [secondes par fenêtre=25]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SECS = +(process.argv[2] || 25);
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
    await page.fill('input[name=username]', 'Synchro'); await page.fill('input[name=email]', 'synchro@exemple.fr'); await page.fill('input[name=password]', 'motdepasse');
    await page.click('[data-act=asubmit]');
    await page.click('[data-act=new][data-v="1"]');
    await page.waitForSelector('.sheet [data-act=go]', { timeout: 60000 }); await page.click('.sheet [data-act=go]');
    await page.waitForSelector('[data-act=div][data-v="5"]'); await page.click('[data-act=div][data-v="5"]');
    await page.click('.club-card >> nth=3'); await page.click('.sheet [data-act=take]');
    await page.waitForSelector('.sheet #c-fn'); await page.fill('.sheet #c-fn', 'Coach'); await page.fill('.sheet #c-ln', 'Synchro');
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
    console.log('état :', JSON.stringify(await page.evaluate(async () => { const v = window.__view; v.avLog = []; await new Promise((r) => setTimeout(r, 2000)); const n = v.avLog.length; v.avLog = null; return { n, snaps: v.disp6?.snaps.length, mode: v.animMode, paused: v.paused, hl: v.hl, now: v.live.now, disp: !!v.dispPlayers }; })));
    console.log('rendu :', JSON.stringify(await page.evaluate(() => ({ style: window.__view.style, r3d: !!window.__view.r3d, gl: (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })() }))));
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
    for (const sync of [false, true]) {
      const log = await page.evaluate(async ([secs, sync]) => {
        const v = window.__view; v.syncEvents = sync; v.avLog = [];
        await new Promise((r) => setTimeout(r, secs * 1000));
        const L = v.avLog; v.avLog = null; return L;
      }, [SECS, sync]);
      const imgs = log.filter((x) => x.k === 'img'), evs = log.filter((x) => x.k === 'ev' && x.tD != null);
      const leadGame = [], leadWall = [];
      for (const e of evs) {
        leadGame.push(e.t - e.tD);
        const f = imgs.find((x) => x.tD >= e.t - 1e-9); if (f) leadWall.push(f.wall - e.wall);
      }
      const types = {}; for (const e of evs) types[e.type] = (types[e.type] || 0) + 1;
      console.log(`${sync ? 'au rythme de l\'image (6b)' : 'au temps du moteur (avant)'} : ${evs.length} évènements (${Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')}) · avance sur l'image en temps de jeu : médiane ${(1000 * q(leadGame, 0.5)).toFixed(0)} ms [p5 ${(1000 * q(leadGame, 0.05)).toFixed(0)}, p95 ${(1000 * q(leadGame, 0.95)).toFixed(0)}] · en temps réel : médiane ${q(leadWall, 0.5).toFixed(0)} ms [p5 ${q(leadWall, 0.05).toFixed(0)}, p95 ${q(leadWall, 0.95).toFixed(0)}] (${leadWall.length} mesurés) · images : ${imgs.length}, intervalle médian ${q(imgs.slice(1).map((x, i) => x.wall - imgs[i].wall), 0.5).toFixed(0)} ms`);
    }
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
