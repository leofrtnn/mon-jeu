/**
 * Captures 3D du diagnostic des intentions (étape 5d) : un match en direct avec ?diag=1, à
 * plusieurs moments de jeu. Chaque joueur a un trait vers sa cible, coloré selon la priorité de
 * l'intention retenue (blanc P1 · bleu P2 · vert P3 · orange P4 · rouge P5 · violet P6).
 * Usage : node tools/bench/intent-shots.cjs [dossier=./captures-5d]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'captures-5d');
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
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://localhost:${srv.address().port}/?backend=local&diag=1`);
    await page.click('[data-act=amode][data-v=signup]');
    await page.fill('input[name=username]', 'Diag');
    await page.fill('input[name=email]', 'diag@exemple.fr');
    await page.fill('input[name=password]', 'motdepasse');
    await page.click('[data-act=asubmit]');
    await page.waitForSelector('[data-act=new][data-v="1"]');
    await page.click('[data-act=new][data-v="1"]');
    await page.waitForSelector('.sheet [data-act=go]', { timeout: 60000 });
    await page.click('.sheet [data-act=go]');
    // Club (Ligue 1), coach par défaut, préparation estivale passée, puis premier match joué en direct.
    await page.waitForSelector('[data-act=div][data-v="5"]');
    await page.click('[data-act=div][data-v="5"]');
    await page.click('.club-card >> nth=3');
    await page.click('.sheet [data-act=take]');
    await page.waitForSelector('.sheet #c-fn');
    await page.fill('.sheet #c-fn', 'Coach'); await page.fill('.sheet #c-ln', 'Diag');
    for (let i = 0; i < 8 && !(await page.isVisible('.sheet [data-act=ok]')); i++) await page.click('.sheet [data-act=next]');
    await page.click('.sheet [data-act=ok]');
    await page.waitForSelector('[data-act=psmeeting]');
    await page.click('[data-act=psmeeting]');
    await page.click('.sheet [data-act=ch][data-v=accept]');
    await page.click('.sheet [data-act=ok]');
    await page.click('[data-act=pscamp][data-v=alps]');
    await page.click('[data-act=psint][data-v=hard]');
    for (let i = 0; i < 12 && !(await page.isEnabled('[data-act=psstart]')); i++) await page.click('[data-act=psday][data-v="3"]');
    await page.click('[data-act=psstart]');
    await page.waitForSelector('[data-act=play], [data-act=simulate]');
    if (!(await page.$('[data-act=play]'))) {
      await page.click('[data-act=simulate] >> nth=0');
      await page.waitForSelector('.sheet [data-act=close]', { timeout: 30000 });
      await page.click('.sheet [data-act=close]');
    }
    await page.waitForSelector('[data-act=play]');
    await page.click('[data-act=play]');
    await page.click('[data-act=go]');
    await page.waitForFunction(() => window.__view?.live?.m?.phase === 'live', null, { timeout: 60000 });
    // Rendu continu, sans avance rapide : on attend des moments de jeu (ballon en jeu, pas de remise).
    await page.evaluate(() => { const v = window.__view; v.hlWant = () => true; });
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(i === 1 ? 6000 : 4500);
      // Après les trois premières : avance rapide d'environ 20 s pour voir d'autres phases de jeu.
      if (i === 4) { await page.click('[data-c=speed]'); await page.click('[data-c=speed]'); await page.waitForTimeout(20000); await page.click('[data-c=speed]'); }
      await page.waitForFunction(() => { const L = window.__view?.live; return L && L.m.phase === 'live' && !L.restart && !(L.celebrate > 0); }, null, { timeout: 60000 });
      const info = await page.evaluate(() => { const L = window.__view.live, c = {}; for (const p of L.players.values()) { const k = 'P' + (p._intent?.pri || 1); c[k] = (c[k] || 0) + 1; } return { t: +L.now.toFixed(1), minute: L.m.minute, pri: c, diag: !!L.diag }; });
      await page.screenshot({ path: path.join(OUT, `intent-${i}.png`) });
      console.log(`intent-${i}.png`, JSON.stringify(info));
    }
  } catch (e) {
    console.error('Échec :', e.message);
    try { await page.screenshot({ path: path.join(OUT, 'echec.png') }); } catch { /* ignore */ }
    process.exitCode = 1;
  }
  if (errors.length) console.error('Erreurs de page :', errors.slice(0, 5));
  await browser.close(); srv.close();
})();
