/**
 * Sonde 6d-B (complément) : remplaçant entré pendant l'avance rapide des temps forts.
 * Joue le même scénario que le test d'interface (avance rapide forcée, vue 3D), déclenche une vraie blessure
 * par le chemin du moteur (m._pendingInjury → injure → remplacement automatique) et relève : erreurs de page
 * (avec pile), images qui avancent, joueurs du moteur absents de l'état d'affichage.
 * Usage : node tools/bench/repro-ffsub.cjs [racine=.] [skip-blessure|skip-temoin|jeu-blessure]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const SCEN = process.argv[3] || 'skip-blessure';

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
  // SEED=n : Math.random de la page fixé (création de la partie, choix d'affichage) — le même match est
  // rejoué à chaque passe, pour comparer les MÊMES gestes avant / après une correction de rendu.
  if (process.env.SEED) await ctx.addInitScript((seed) => { const realNow = Date.now.bind(Date); window.__freezeNow = true; Date.now = () => (window.__freezeNow ? 1767225600000 + seed * 1000 : realNow()); let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, +process.env.SEED);
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
    // ---- Scénario (sonde de reproduction, hors dépôt) ----
    const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).map((s) => s.trim().replace(/https?:\/\/localhost:\d+\//, '')).join(' | ')));
    await page.evaluate(() => { window.__view.hlWant = undefined; delete window.__view.hlWant; });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => { const v = window.__view; return { style: v.style, r3d: !!v.r3d, anim: v.animMode, minute: v.m.minute, now: +v.live.now.toFixed(2) }; });
    console.log('départ', JSON.stringify(info));
    const skip = SCEN.startsWith('skip'), inj = SCEN.endsWith('blessure');
    if (!skip) await page.evaluate(() => { const v = window.__view; v.TS = 10; v.highlights = false; });
    if (skip) await page.evaluate(() => { const v = window.__view; v.ffBudget = 400; v.hlWant = () => false; v.hlPre = () => false; v.hlGrace = 0; v.hl = 'skip'; });
    await page.waitForTimeout(1000);
    let injected = null;
    if (inj) injected = await page.evaluate(() => {
      const v = window.__view, m = v.m, T = m.teams[1], mp = T.onPitch.find((x) => x && T.slots[x.slot].pos !== 'GB' && x.onPitch && !x.injured);
      m._pendingInjury = [[T, mp]];   // blessure par le chemin du moteur (injure → doSub), à la prochaine minute
      return { pid: mp.id, minute: m.minute, players: v.players.size, disp: v.dispPlayers ? v.dispPlayers.size : null, hl: v.hl };
    });
    console.log('blessure injectée', JSON.stringify(injected));
    const watch = async () => page.evaluate(() => new Promise((res) => { const v = window.__view, t0 = v.lastTs, n0 = v.live.now; setTimeout(() => res({ frames: v.lastTs !== t0, now: +v.live.now.toFixed(2), minute: v.m.minute, hl: v.hl, players: v.players.size, disp: v.dispPlayers ? v.dispPlayers.size : null, missing: v.dispPlayers ? [...v.players.keys()].filter((id) => !v.dispPlayers.has(id)) : [], subs: v.m.teams.map((t) => t.subsUsed) }), 1000); }));
    for (let i = 0; i < (skip ? 6 : 30); i++) console.log('t+' + (i + 1) + 's', JSON.stringify(await watch()));
    console.log('erreurs', JSON.stringify(errs));
  } catch (e) { console.log('Échec :', e.message.split('\n')[0]); }
  await browser.close(); srv.close();
})();
