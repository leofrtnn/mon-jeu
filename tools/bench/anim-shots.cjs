/**
 * Captures avant / après (étape 6b) : au même instant de jeu (image du contact physique d'un geste
 * migré), le même joueur filmé de près, une fois avec l'ancien rendu (anciens indicateurs, même
 * différé) et une fois avec le contrat (gestes synchronisés + cinématique inverse au contact).
 * Usage : node tools/bench/anim-shots.cjs [dossier=./captures-6b] [paires=6]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'captures-6b'), PAIRS = +(process.argv[3] || 6);
fs.mkdirSync(OUT, { recursive: true });
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
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
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
    await page.evaluate(() => { window.__view.disp6.extra = 1.4; });
    await page.waitForTimeout(8000);
    const want = ['touche de conduite', 'contrôle', 'passe', 'passe levée', 'centre', 'frappe', 'dégagement', 'subi'];
    const done = new Map(); let shots = 0;
    for (let tries = 0; tries < 80 && shots < PAIRS; tries++) {
      await page.waitForTimeout(1200);
      const pick = await page.evaluate((args) => {
        const [want, done] = args, v = window.__view, G = v.live.gest, now = v.live.now;
        const g = [...G.gestures].reverse().find((x) => want.includes(x.kind) && x.tContact != null && x.tContact > now - 1.1 && x.tContact < now - 0.45 && (done[x.kind] || 0) < 1);
        if (!g) return null;
        const e = v.r3d.players.get(g.pid); if (!e) return null;
        v.TS0 = v.TS; v.TS = 0;   // simulation figée
        v._cam0 = v.r3d.updateCamera; v._samp0 = v.sampleDisplay;
        // Caméra de côté : perpendiculaire à l'axe joueur → ballon, du côté opposé au joueur le plus proche (pas d'occultation).
        v.r3d.updateCamera = function () {
          const q = e.p3.root.position, B = v.dispBall || v.ball, [bx, bz] = this.toWorld(B.x, B.y);
          const mx = (q.x + bx) / 2, mz = (q.z + bz) / 2; let nx = -(bz - q.z), nz = bx - q.x; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          let side = 1, best = Infinity;
          for (const [id2, e2] of this.players) { if (e2 === e) continue; const r = e2.p3.root.position, d = Math.hypot(r.x - mx, r.z - mz); if (d < best) { best = d; side = ((r.x - mx) * nx + (r.z - mz) * nz) > 0 ? -1 : 1; } }
          this.camera.position.set(mx + nx * side * 2.8, 1.1, mz + nz * side * 2.8); this.camera.lookAt(mx, 0.45, mz); this.camera.fov = 34; this.camera.updateProjectionMatrix();
        };
        v._shot = { tC: g.tContact, kind: g.kind + (g.reflex && ['passe', 'passe levée', 'centre', 'frappe', 'dégagement'].includes(g.kind) ? ' sans armé' : ''), id: g.id };
        return v._shot;
      }, [want, Object.fromEntries(done)]);
      if (!pick) continue;
      for (const mode of ['ancien', 'contrat']) {
        await page.evaluate((m) => { const v = window.__view; v.sampleDisplay = function () { const ok = this.disp6.sample(m, this._shot.tC); if (!ok) return; this.dispPlayers = this.disp6.disp; this.dispPhys = this.disp6.ball; this.dispBall = this.disp6.ballN; this.dispHolder = this.disp6.holder; this.dispInHands = this.disp6.inHands; }; v.liveAcc = 0; }, mode);
        await page.waitForTimeout(700);
        const f = path.join(OUT, `${String(shots + 1).padStart(2, '0')}-${pick.kind.replace(/ /g, '_')}-${mode}.png`);
        await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280 * 0.7, height: 720 } });
        console.log(f);
      }
      await page.evaluate(() => { const v = window.__view; v.TS = v.TS0; v.r3d.updateCamera = v._cam0; v.sampleDisplay = v._samp0; });
      done.set(pick.kind.split(' sans')[0], (done.get(pick.kind.split(' sans')[0]) || 0) + 1); shots++;
    }
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
