/**
 * Test d'interface de bout en bout (Playwright, Chromium, viewport mobile).
 * Lance un petit serveur statique, crée une partie, parcourt les onglets,
 * joue un match (pause, mi-temps, fin), simule des journées via le Web Worker,
 * vérifie la sauvegarde compressée et l'absence d'erreurs.
 *
 * Usage : npm run test:ui   (nécessite Playwright + Chromium installés)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5 landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const step = (name) => console.log('✓', name);
  try {
    await page.goto(base);
    await page.click('[data-act=new][data-v="1"]');
    await page.click('[data-act=div][data-v="3"]');
    await page.click('.prow[data-act=pick] >> nth=3');
    await page.click('[data-act=yes]');
    // Création du coach : apparence, compétences, puis validation.
    await page.waitForSelector('.sheet [data-act=ok]');
    await page.click('.sheet [data-act=tab][data-v=look]');
    await page.click('.sheet [data-act=random]');
    await page.click('.sheet [data-act=tab][data-v=skills]');
    await page.click('.sheet [data-act=dec][data-v=discipline]');
    await page.click('.sheet [data-act=inc][data-v=tactics]');
    await page.click('.sheet [data-act=ok]');
    // Préparation estivale : réunion avec le CA, un amical simulé, lancement de la saison.
    await page.waitForSelector('[data-act=psmeeting]');
    await page.click('[data-act=psmeeting]');
    await page.click('.sheet [data-act=ch][data-v=accept]');
    await page.click('.sheet [data-act=ok]');
    await page.click('[data-act=psadd] >> nth=0');
    await page.click('[data-act=pssim] >> nth=0');
    await page.click('[data-act=psstart]');
    await page.waitForSelector('[data-act=play]');
    const coach = await page.evaluate(() => window.__app.state.coach);
    assert.equal(coach.skills.tactics, 11);
    assert.ok(coach.created);
    step('partie créée (Liga Ibérica) + coach personnalisé + préparation (réunion CA, amical)');

    for (const tab of ['squad', 'tactics', 'schedule', 'club', 'home']) {
      await page.click(`[data-tab=${tab}]`);
      await page.waitForTimeout(150);
    }
    for (const t of ['fin', 'market', 'staff', 'train', 'youth', 'obj', 'friends', 'settings']) {
      await page.click('[data-tab=club]'); await page.click(`[data-act=ctab][data-v=${t}]`);
    }
    step('onglets et sous-onglets');

    // Mission de recrutement.
    await page.click('[data-tab=club]'); await page.click('[data-act=ctab][data-v=market]');
    await page.click('[data-act=mmode][data-v=scout]');
    await page.click('[data-act=mission] >> nth=0');
    await page.selectOption('.sheet select[data-act=mr]', 'FRA');
    await page.click('.sheet [data-act=go]');
    await page.waitForSelector('text=En mission');
    // Négociation avec un membre du staff.
    await page.click('[data-act=ctab][data-v=staff]');
    await page.click('[data-act=hirestaff] >> nth=0');
    await page.waitForSelector('.sheet [data-act=propose]');
    await page.click('.sheet [data-act=propose]');
    await page.waitForSelector('.sheet .msg');
    await page.click('.sheet [data-act=close]');
    step('mission de recrutement + négociation de staff');

    await page.click('[data-tab=tactics]');
    await page.click('[data-act=auto]');
    await page.click('.slot >> nth=10'); await page.click('.slot >> nth=9');
    step('compo (tap-tap)');

    await page.click('[data-tab=home]');
    await page.click('[data-act=play]');
    await page.click('[data-act=go]');
    await page.click('[data-c=speed]'); await page.click('[data-c=speed]');
    await page.click('[data-c=quick]');
    await page.waitForSelector('[data-act=talk]', { timeout: 120000 });
    await page.click('[data-act=talk] >> nth=1');
    await page.click('[data-act=resume]');
    await page.click('[data-c=skip]');
    await page.waitForSelector('[data-act=done]');
    await page.click('[data-act=done]');
    await page.waitForSelector('.sheet [data-act=close]');
    await page.click('.sheet [data-act=close]');
    step('match joué (résumé rapide, mi-temps, fin)');

    for (let i = 0; i < 6; i++) {
      await page.click('[data-act=simulate]');
      await page.waitForSelector('.sheet [data-act=close]', { timeout: 30000 });
      await page.click('.sheet [data-act=close]');
    }
    const day = await page.evaluate(() => window.__app.state.day);
    assert.ok(day >= 7, `journée ${day}`);
    const mode = await page.evaluate(() => window.__simMode);
    assert.equal(mode, 'worker', 'simulation dans le Web Worker');
    step(`6 journées simulées dans le Web Worker (journée ${day + 1})`);

    await page.waitForTimeout(800);
    const raw = await page.evaluate(() => localStorage.getItem('cdp-slot-1'));
    assert.ok(raw && raw.startsWith('gz:'), 'sauvegarde compressée');
    await page.reload();
    await page.waitForSelector('[data-tab=home]');
    const day2 = await page.evaluate(() => window.__app.state && window.__app.state.day);
    assert.equal(day2, day, 'reprise de la sauvegarde');
    step(`sauvegarde gzip (${Math.round(raw.length / 1024)} Ko) et reprise`);

    // Multijoueur : code d'équipe, amical contre son propre code, ligue entre amis.
    await page.click('[data-tab=club]'); await page.click('[data-act=ctab][data-v=friends]');
    await page.click('[data-act=genCode]');
    const code = await page.inputValue('#mycode');
    assert.ok(code.startsWith('CDP1-'));
    await page.fill('#friendcode', code);
    await page.click('[data-act=challenge]');
    await page.click('[data-act=go]');
    await page.click('[data-c=skip]');
    await page.waitForSelector('[data-act=done]');
    await page.click('[data-act=done]');
    await page.click('[data-act=no]');
    await page.click('[data-tab=club]'); await page.click('[data-act=ctab][data-v=friends]');
    await page.click('[data-act=addMine]');
    // Deuxième équipe : un club d'un autre championnat, via l'état du jeu.
    const code2 = await page.evaluate(async () => {
      const f = await import('./js/game/friends.js');
      const t = f.snapshotTeam(window.__app.state); t.name = 'Équipe test'; t.short = 'TST';
      return f.encodeTeam(t);
    });
    await page.fill('#friendcode', code2);
    await page.click('[data-act=addTeam]');
    await page.click('[data-act=runLeague]');
    await page.waitForSelector('table.tbl');
    step('multijoueur : code, amical, ligue entre amis');

    assert.deepEqual(errors, [], 'aucune erreur console');
    console.log('\nTous les tests d\'interface sont passés.');
  } catch (e) {
    console.error('ÉCHEC :', e.message, '\nErreurs page :', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
