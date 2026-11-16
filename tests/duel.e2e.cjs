/**
 * Test d'interface : MATCH EN DIRECT ENTRE DEUX MANAGERS (carrière en ligne).
 * Deux onglets = deux managers (serveur local, une session par onglet, salon temps réel par
 * BroadcastChannel). Rendez-vous, coup d'envoi commun, pause demandée par l'un (l'autre
 * s'arrête aussi), mi-temps, fin : le match doit être IDENTIQUE dans les deux onglets.
 *
 * Usage : node tests/duel.e2e.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
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
  const base = `http://localhost:${srv.address().port}/?backend=local&tab=1`;
  // Deux onglets actifs en même temps (sinon l'onglet en arrière-plan est mis en veille).
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
  const errors = [];
  const watch = (p, who) => {
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ServiceWorker/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  };
  const step = (n) => console.log('✓', n);
  const A = await ctx.newPage(); watch(A, 'A');
  let B = null;
  try {
    await A.goto(base);
    await A.click('[data-act=amode][data-v=signup]');
    await A.fill('input[name=username]', 'Alice');
    await A.fill('input[name=email]', 'alice@exemple.fr');
    await A.fill('input[name=password]', 'motdepasse');
    await A.click('[data-act=asubmit]');
    await A.waitForSelector('[data-act=new][data-v="1"]');
    // Partie en ligne à deux, avancée jusqu'au jour du match Alice - Bob.
    const setup = await A.evaluate(async () => {
      const { LocalBackend } = await import('./js/online/backend.js');
      const { loadRealData } = await import('./js/data/realWorld.js');
      const { createOnlineCareer } = await import('./js/online/multi.js');
      const { today, completeDay } = await import('./js/game/season.js');
      const { forEachHuman } = await import('./js/game/humans.js');
      const { packState } = await import('./js/game/state.js');
      const app = window.__app;
      const bob = new LocalBackend(localStorage, new Map());
      await bob.signUp('bob@exemple.fr', 'motdepasse', 'Bob');
      const g = await app.backend.createGame('Duel', 2);
      await bob.joinGame(g.code);
      // Deux clubs de Premier League qui se rencontrent dès la 1re journée (partie légère).
      const data = await loadRealData();
      const { newGame, startCareer } = await import('./js/game/season.js');
      const probe = newGame(99, { real: data });
      startCareer(probe, probe.clubs.find((c) => c.div === 1).id);
      if (probe.preseason) probe.preseason.active = false;
      let pair = null;
      for (let d = 0; d < 60 && !pair; d++) { probe.day = d; const fx = (today(probe)?.fixtures || []).find((x) => x.comp === 'league' && x.div === 1); if (fx) pair = [fx.h, fx.a]; }
      await app.backend.chooseClub(g.id, pair[0]); await bob.chooseClub(g.id, pair[1]);
      const me = await app.backend.user(), bu = await bob.user();
      const st = createOnlineCareer(data, 99, [{ user_id: me.id, username: 'Alice', club_id: pair[0] }, { user_id: bu.id, username: 'Bob', club_id: pair[1] }], g.id);
      forEachHuman(st, () => { st.coach = { ...(st.coach || {}), created: true, first: 'Coach', last: 'Test' }; });
      const key = pair.slice().sort().join();
      for (let i = 0; i < 60; i++) { const f = today(st)?.userFixture; if (f && [f.h, f.a].sort().join() === key) break; completeDay(st); }
      const f = today(st).userFixture;
      await app.backend.startGame(g.id, await packState(st));
      return { gid: g.id, bobSes: bob.ses.get('cdp-session'), aliceHome: f.h === pair[0], day: st.day };
    });
    step(`partie à deux créée, jour ${setup.day} : ${setup.aliceHome ? 'Alice reçoit Bob' : 'Bob reçoit Alice'}`);
    B = await ctx.newPage(); watch(B, 'B');
    await B.addInitScript((ses) => sessionStorage.setItem('cdp-session', ses), setup.bobSes);
    await B.goto(base);
    for (const p of [A, B]) {
      await p.waitForFunction(() => window.__app && window.__app.backend && window.__app.user, null, { timeout: 30000 });
      await p.evaluate(async (gid) => {
        const app = window.__app; app.allowLocalOnline = true;
        const m = await import('./js/ui/screens/online.js');
        await m.enterOnline(app, await app.backend.getGame(gid));
      }, setup.gid);
      await p.waitForSelector('#tabbar [data-nav=home]', { state: 'attached', timeout: 30000 });
      await p.evaluate(() => { window.__app.state.settings.matchStyle = 'fm'; }); // vue 2D : deux matchs dans le même navigateur de test
    }
    const [H, W] = setup.aliceHome ? [A, B] : [B, A]; // H reçoit, W se déplace
    await H.waitForSelector('[data-act=play]');
    await H.click('[data-act=play]');
    await H.waitForSelector('text=En attente de');
    await W.waitForSelector('[data-act=oduel]');
    await W.click('[data-act=oduel]');
    for (const p of [H, W]) await p.waitForSelector('.sheet [data-act=go]', { timeout: 30000 });
    step('rendez-vous : les deux managers sont dans le match');
    await H.click('.sheet [data-act=go]');
    await H.waitForSelector('text=En attente de', { timeout: 5000 });
    await W.click('.sheet [data-act=go]');
    const fast = (p) => p.evaluate(() => { const v = window.__view; v.ffBudget = 60; v.hlWant = () => false; v.hlPre = () => false; v.hlGrace = 0; v.hl = 'skip'; });
    await H.waitForFunction(() => window.__view && window.__view.m.phase === 'live', null, { timeout: 30000 });
    await W.waitForFunction(() => window.__view && window.__view.m.phase === 'live', null, { timeout: 30000 });
    await fast(H); await fast(W);
    for (const p of [H, W]) await p.evaluate((gid) => { const bc = new BroadcastChannel(`cdp-room-${gid}`); window.__rx = { n: 0, last: null }; bc.onmessage = (e) => { if (e.data?.t === 'duel') { window.__rx.n++; window.__rx.last = e.data.d?.q; } }; }, setup.gid);
    step('coup d\'envoi commun');
    // Le visiteur demande une pause : le match s'arrête chez les deux.
    await W.waitForFunction(() => window.__view.m.minute >= 10, null, { timeout: 60000 });
    await W.click('[data-c=pause]');
    await H.waitForSelector('.sheet [data-act=ok]', { timeout: 30000 });
    await W.waitForSelector('.sheet [data-act=form]', { timeout: 30000 });
    const pausedAt = await Promise.all([H, W].map((p) => p.evaluate(() => window.__view.liveSteps)));
    assert.equal(pausedAt[0], pausedAt[1], 'pause au même instant');
    // Changement de système pendant la pause (côté visiteur), puis reprise des deux côtés.
    await W.click('.sheet [data-act=form] >> nth=1');
    await W.keyboard.press('Escape');
    await H.click('.sheet [data-act=ok]');
    await fast(H); await fast(W);
    step(`pause commune au même instant (pas ${pausedAt[0]}), changements, reprise`);
    for (const p of [H, W]) {
      await p.waitForSelector('.sheet [data-act=talk]', { timeout: 400000 });
      await p.click('.sheet [data-act=talk] >> nth=1');
      await p.click('.sheet [data-act=resume]');
    }
    await fast(H); await fast(W);
    step('mi-temps : causerie de chacun, 2e mi-temps');
    for (const p of [H, W]) await p.waitForSelector('[data-act=done]', { timeout: 500000 });
    const res = await Promise.all([H, W].map((p) => p.evaluate(() => ({ score: window.__view.m.score.slice(), goals: window.__view.m.goals.map((g) => `${g.name} ${g.minute}`), shots: window.__view.m.teams.map((t) => t.stats.shots), steps: window.__view.liveSteps }))));
    assert.deepEqual(res[0], res[1], 'même match dans les deux onglets');
    step(`fin : même match des deux côtés (${res[0].score.join('-')}, ${res[0].goals.length} but(s), ${res[0].steps} pas)`);
    await H.click('[data-act=done]');
    await W.click('[data-act=done]');
    const played = await H.evaluate(() => window.__app.state.playedMatch && window.__app.state.playedMatch.score);
    assert.deepEqual(played, res[0].score, 'le résultat officiel est celui du match joué à deux');
    step('résultat enregistré chez celui qui reçoit (envoyé avec « Prêt »)');
    // Transfert entre managers : W fait une offre pour un joueur de H, H contre-propose, W accepte.
    await W.evaluate(async () => {
      const { clubPlayers, clubById } = await import('./js/game/state.js');
      const s = window.__app.state;
      const other = Object.keys(s.online.clubOf).map(Number).find((id) => id !== s.userClubId);
      const p = clubPlayers(s, clubById(s, other)).sort((a, b) => a.value - b.value)[5];
      const m = await import('./js/ui/screens/playerSheet.js');
      m.showPlayer(window.__app, p.id);
    });
    await W.click('.sheet [data-act=mgroffer]');
    await W.fill('#mo-fee', '1500000');
    await W.fill('#mo-note', 'Il aura du temps de jeu');
    await W.click('.sheet [data-act=send]');
    await H.waitForSelector('[data-act=mgrdeal]', { timeout: 15000 });
    await H.click('[data-act=mgrdeal]');
    await H.fill('#dl-fee', '2000000');
    await H.click('.sheet [data-act=counter]');
    await W.waitForFunction(() => Object.values(window.__app.state.online.deals || {}).some((d) => d.turn === window.__app.state.online.cur), null, { timeout: 15000 });
    await W.click('[data-act=mgrdeal]');
    await W.click('.sheet [data-act=accept]');
    await H.waitForFunction(() => Object.values(window.__app.state.online.deals || {}).some((d) => d.status === 'accepted' && d.fee === 2000000), null, { timeout: 15000 });
    step('transfert négocié en direct entre les deux managers (offre → contre-offre → accord)');
    await W.keyboard.press('Escape');
    await W.click('[data-act=mgrchat]');
    await W.fill('#chatin', 'Bien joué pour le match !');
    await W.click('.sheet [data-act=say]');
    await H.waitForFunction(() => (window.__app.state.online.chat || []).some((m) => m.text === 'Bien joué pour le match !'), null, { timeout: 15000 });
    step('discussion entre managers');
    assert.deepEqual(errors, [], 'aucune erreur console');
    console.log('\nTest du match à deux réussi.');
  } catch (e) {
    console.error('✗', e.message);
    for (const [p, n] of [[A, 'A'], [B, 'B']]) if (p) console.error(n, await p.evaluate(() => { const d = window.__duel, v = window.__view; return d ? JSON.stringify({ steps: v.liveSteps, phase: v.m.phase, paused: v.paused, stalled: v.stalled, peerStep: d.peerStep, inQ: d.inQ, outQ: d.outQ, early: [...d.early.keys()].slice(0, 5), halt: d.halt, sched: d.sched.length, recv: !!window.__app.online.duelRecv, buf: (window.__app.online.duelEarly || []).length, heard: Date.now() - d.lastHeard, wait: !!window.__ctrl.duelWait }) : 'pas de duel'; }).catch((x) => String(x)));
    for (const [p, n] of [[A, 'A'], [B, 'B']]) if (p) await p.screenshot({ path: path.join(__dirname, `duel-fail-${n}.png`) }).catch(() => {});
    if (errors.length) console.error(errors.slice(0, 10).join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close(); srv.close();
  }
})();
