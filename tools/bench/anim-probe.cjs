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
  // SEED=n : Math.random de la page fixé (création de la partie, choix d'affichage) — le même match est
  // rejoué à chaque passe, pour comparer les MÊMES gestes avant / après une correction de rendu.
  if (process.env.SEED) await ctx.addInitScript((seed) => { const realNow = Date.now.bind(Date); window.__freezeNow = true; Date.now = () => (window.__freezeNow ? 1767225600000 + seed * 1000 : realNow()); let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, +process.env.SEED);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('ERREUR PAGE :', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')));
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
    await page.waitForFunction(() => !!window.__view?.r3d?.probeAir, null, { timeout: 120000 });   // (vue 3D prête)
    await page.evaluate(() => { window.__freezeNow = false; });   // (horloge rendue au jeu une fois le match lancé)
    if (process.env.HEADTEST) { const cases = []; const HP = process.env.HEADTEST === 'poitrine' ? 'poitrine' : null, HH = HP ? [1.0, 1.25, 1.47] : [1.5, 1.75, 2.1]; for (const mh of [0, 1]) for (const h of HH) for (const a of [0, 45, 90, 135, 180]) cases.push([a / 57.3, 0.5, h, mh, HP]); const r = await page.evaluate((c) => window.__view.r3d.headTest(c), cases); for (const x of r) console.log(JSON.stringify(x)); throw new Error('banc d\'essai terminé'); }
    if (process.env.GKTEST) { const cases = []; const FACES = process.env.GKTEST === 'faces' ? [0, Math.PI] : [0]; for (const face of FACES) for (const mh of [0, 1]) for (const [lat, h, fwd, dive] of [[0, 1.0, 0.6, 0], [0.4, 0.5, 0.6, 0], [-0.5, 1.6, 0.5, 0], [0, 2.1, 0.4, 0], [1.6, 0.6, 0.3, 1], [-2.0, 1.4, 0.3, 1], [2.4, 0.3, 0.2, 1]]) for (const res of ['capté', 'repoussé', 'dévié']) cases.push([lat, h, fwd, res, dive, mh, face]); const r = await page.evaluate((c) => window.__view.r3d.gkTest(c), cases); for (const x of r) console.log(JSON.stringify(x)); throw new Error('banc d\'essai terminé'); }
    if (process.env.DIVESIDE) { console.log(JSON.stringify(await page.evaluate(() => window.__view.r3d.diveSideTest()))); throw new Error('banc d\'essai terminé'); }
    if (process.env.CALIB) { const c = await page.evaluate(() => window.__view.r3d.calib6()); console.log(JSON.stringify(c)); throw new Error('étalonnage terminé'); }
    // Historique d'affichage élargi (outil seulement ; l'historique des gestes reste celui du jeu) : chaque relevé couvre tout le temps
    // écoulé depuis le précédent, sans trou (couverture vérifiée ci-dessous).
    const SPEED = +(process.env.SPEED || 0), WIN = SPEED ? 32 : 5, GKONLY = !!process.env.GK, TKONLY = !!process.env.TK, THONLY = !!process.env.TH, AIRONLY = !!process.env.AIR || GKONLY || TKONLY || THONLY;   // TH=1 : lancers de touche (6c-D)   // TK=1 : tacles et duels de corps (6c-C)   // GK=1 : gestes du gardien seulement (6c-B)   // AIR=1 : gestes aériens seulement (6c-A)
    await page.evaluate(([x]) => { window.__view.disp6.extra = x + 1; }, [WIN]);
    // SPEED=n : la simulation avance n fois plus vite (au plus 1 s de jeu par image) pour couvrir un match
    // entier ; l'affichage n'a pas à être fluide, la sonde rejoue elle-même chaque geste pas à pas.
    if (process.env.GKSERIES) await page.evaluate(() => { window.__view.r3d._gkSeries = {}; });
    if (process.env.LOD) await page.evaluate((l) => { window.__view.r3d._probeLOD = l; }, process.env.LOD);   // LOD=mh|simple : modèle mesuré
    if (SPEED) await page.evaluate((k) => { const v = window.__view; v.TS = k; v.opts.replays = false; v.replayPlan = null; }, SPEED);   // (ralentis coupés : à très faible cadence d'image, un ralenti sans assez d'images fige le match — défaut d'interface signalé, hors 6c)
    const res = { contrat: [], ancien: [], airC: [], airA: [], gkC: [], gkA: [], tkC: [], tkA: [], bumpC: [], bumpA: [], thC: [], thA: [] };
    let last = await page.evaluate(() => window.__view.live.now), start = last;
    while (last - start < SECS) {
      await page.waitForTimeout(2500);
      // Mi-temps : causerie et reprise (sans effet sur la mesure) ; fin du match : arrêt.
      for (const sel of ['.sheet [data-act=talk] >> nth=1', '.sheet [data-act=resume]', '.sheet [data-act=ok]']) if (await page.isVisible(sel.split(' >> ')[0]).catch(() => false)) await page.click(sel).catch(() => {});
      if (SPEED) await page.evaluate((k) => { const v = window.__view; if (!v.paused) v.TS = k; }, SPEED);
      if (await page.evaluate(() => window.__view.m.phase === 'ft' || window.__view.m.phase === 'done').catch(() => false)) break;
      const r = await page.evaluate(([WIN, AIRONLY, GKONLY, TKONLY, THONLY]) => {
        const v = window.__view, now = v.live.now, tTo = now - 0.5, prev = v._probeT ?? null, tFrom = Math.max(prev || 0, tTo - WIN);
        if (tTo <= tFrom) return { now, c: [], a: [], ac: [], aa: [], cov: null, acov: null };
        v._probeT = tTo;
        const c = AIRONLY ? [] : v.r3d.probe6('contrat', tFrom, tTo), a = AIRONLY ? [] : v.r3d.probe6('ancien', tFrom, tTo);
        // Couverture : gestes migrés avec contact depuis le relevé précédent, mesurés ou non (fenêtre limitée
        // par l'historique d'affichage ; aucun tri sur le résultat du geste).
        const K = new Set(['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied', 'contrôle', 'subi', 'touche de conduite']);
        const all = prev == null ? [] : v.live.gest.gestures.filter((g) => K.has(g.kind) && g.tContact != null && g.tContact > prev && g.tContact <= tTo);
        const got = new Set(c.map((x) => x.gid)); if (AIRONLY) all.length = 0;
        // Gestes aériens (6c-A) : avec ou sans contact, joueurs de champ ; même comptage de couverture.
        const ac = GKONLY || TKONLY || THONLY ? [] : v.r3d.probeAir('contrat', tFrom, tTo), aa = GKONLY || TKONLY || THONLY ? [] : v.r3d.probeAir('ancien', tFrom, tTo);
        // Tacles et duels (6c-C) : tous les tacles (contact ballon, sur l'homme ou aucun) et tous les débuts de déséquilibre.
        // Lancers de touche (6c-D) : tous les gestes « touche », avec ou sans lâcher.
        const hc = THONLY ? v.r3d.probeTH('contrat', tFrom, tTo) : null, ha = THONLY ? v.r3d.probeTH('ancien', tFrom, tTo) : null;
        const allH = prev == null || !THONLY ? [] : v.live.gest.gestures.filter((g) => g.kind === 'touche' && (g.tContact ?? g.t0) > prev && (g.tContact ?? g.t0) <= tTo);
        const gotH = new Set((hc || []).map((x) => x.gid)), hcov = prev == null || !THONLY ? null : { n: allH.length, miss: allH.filter((g) => !gotH.has(g.id)).map((g) => ({ rel: g.tContact != null, gap: (g.tContact ?? g.t0) < tFrom })) };
        const tc = TKONLY ? v.r3d.probeTK('contrat', tFrom, tTo) : null, ta = TKONLY ? v.r3d.probeTK('ancien', tFrom, tTo) : null;
        const allT = prev == null || !TKONLY ? [] : v.live.gest.gestures.filter((g) => g.kind.startsWith('tacle') && (g.tContact ?? g.t0) > prev && (g.tContact ?? g.t0) <= tTo);
        const gotT = new Set((tc?.tk || []).map((x) => x.gid)), tcov = prev == null || !TKONLY ? null : { n: allT.length, miss: allT.filter((g) => !gotT.has(g.id)).map((g) => ({ kind: g.kind, gap: (g.tContact ?? g.t0) < tFrom })) };
        // Gardien (6c-B) : tous ses gestes (plongeons, sauts « mains », mains, relances au pied), avec ou sans contact.
        const GKK = new Set(['plongeon', 'saut', 'mains', 'dégagement', 'passe', 'passe levée']), Tg = (g) => g.tContact ?? (g.kind === 'plongeon' ? g.t0 + 0.4 : (g.tPlan ?? g.t0 + 0.36));
        const gc = GKONLY ? v.r3d.probeGK('contrat', tFrom, tTo) : [], ga = GKONLY ? v.r3d.probeGK('ancien', tFrom, tTo) : [];
        const allG = prev == null || !GKONLY ? [] : v.live.gest.gestures.filter((g) => GKK.has(g.kind) && v.players.get(g.pid)?.gk && !(g.kind === 'saut' && g.part !== 'mains') && Tg(g) > prev && Tg(g) <= tTo);
        const gotG = new Set(gc.map((x) => x.gid)), gcov = prev == null || !GKONLY ? null : { n: allG.length, miss: allG.filter((g) => !gotG.has(g.id)).map((g) => ({ kind: g.kind, gap: Tg(g) < tFrom })) };
        const AK = new Set(['saut de tête', 'tête', 'saut']), Tof = (g) => g.tContact ?? g.tPlan ?? (g.t0re ?? g.t0) + 0.36, isA = (g) => AK.has(g.kind) || (g.kind === 'contrôle' && ['tête', 'poitrine', 'cuisse'].includes(g.cPart) && g.tContact != null);
        const allA = prev == null ? [] : v.live.gest.gestures.filter((g) => isA(g) && g.part !== 'mains' && !v.players.get(g.pid)?.gk && Tof(g) > prev && Tof(g) <= tTo);
        const gotA = new Set(ac.map((x) => x.gid)); const skippedA = ac.filter((x) => x.skipped); for (let i = ac.length - 1; i >= 0; i--) if (ac[i].skipped) ac.splice(i, 1); for (let i = aa.length - 1; i >= 0; i--) if (aa[i].skipped) aa.splice(i, 1);
        const acov = prev == null ? null : { n: allA.length, skipped: skippedA.length, miss: allA.filter((g) => !gotA.has(g.id)).map((g) => ({ kind: g.kind, gap: Tof(g) < tFrom })) };
        return { now, c, a, ac, aa, gc, ga, gcov, tc, ta, tcov, hc, ha, hcov, acov, cov: prev == null ? null : { n: all.length, miss: all.filter((g) => !got.has(g.id)).map((g) => ({ kind: g.kind, gap: g.tContact < tFrom })) } };
      }, [WIN, AIRONLY, GKONLY, TKONLY, THONLY]);
      res.contrat.push(...r.c); res.ancien.push(...r.a); res.airC.push(...(r.ac || [])); res.airA.push(...(r.aa || [])); res.gkC.push(...(r.gc || [])); res.gkA.push(...(r.ga || [])); if (r.gcov) { (res.gcov ||= { n: 0, miss: [] }).n += r.gcov.n; res.gcov.miss.push(...r.gcov.miss); } if (r.tc) { res.tkC.push(...r.tc.tk); res.bumpC.push(...r.tc.bumps); res.tkA.push(...r.ta.tk); res.bumpA.push(...r.ta.bumps); } if (r.tcov) { (res.tcov ||= { n: 0, miss: [] }).n += r.tcov.n; res.tcov.miss.push(...r.tcov.miss); } if (r.hc) { res.thC.push(...r.hc); res.thA.push(...r.ha); } if (r.hcov) { (res.hcov ||= { n: 0, miss: [] }).n += r.hcov.n; res.hcov.miss.push(...r.hcov.miss); } last = r.now;
      if (process.env.PROGRESS) console.error(`t=${r.now.toFixed(0)} aériens ${res.airC.length} ` + await page.evaluate(() => { const v = window.__view; return JSON.stringify({ paused: v.paused, phase: v.m.phase, TS: v.TS, stalled: v.stalled, replay: !!v.replaying, banner: v.banner?.text, sheet: [...document.querySelectorAll('.sheet [data-act]')].map((b) => b.dataset.act).slice(0, 8), fast: v.fast, hl: v.hl, acc: v.liveAcc, slow: v.slowmo, spd: v.speed, ls: v.liveSpeed?.(0.016), rp: !!v.replayPlan, rl: !!v.replayLive, steps: v.liveSteps, ko: v.koWait, cur: v.cur?.type }); }).catch((e) => e.message));
      if (r.acov) { (res.acov ||= { n: 0, miss: [], skipped: 0 }).n += r.acov.n; res.acov.skipped += r.acov.skipped || 0; res.acov.miss.push(...r.acov.miss); }
      if (r.cov) { (res.cov ||= { n: 0, miss: [] }).n += r.cov.n; res.cov.miss.push(...r.cov.miss); }
    }
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
    const dt = 1 / 96, pc = (a, f) => `${(100 * a.filter(f).length / Math.max(1, a.length)).toFixed(0)} %`;
    const kinds = [...new Set([...res.contrat, ...res.ancien].map((x) => x.kind))];
    console.log(`sonde visuelle : ${res.contrat.length} gestes (${(last - start).toFixed(0)} s de jeu). d = distance partie du corps ↔ SURFACE du ballon au contact (minimum dans ±1 pas ; négatif = dans le ballon).`);
    console.log('classes : crédible −1 cm ≤ d ≤ 3 cm · trop éloigné d > 3 cm · pénétration d < −1 cm ; portée : ok / fente (le corps se porte vers le ballon, ≤ 0,5 m) / corps (contrôle poitrine, cuisse, tête) / hors de portée de la jambe / ballon haut (> 0,75 m)');
    for (const k of kinds) for (const mode of ['ancien', 'contrat']) {
      const a = res[mode].filter((x) => x.kind === k); if (!a.length) continue;
      const d = a.map((x) => x.dAtC);
      console.log(`  ${k.padEnd(24)} ${mode.padEnd(8)} n=${String(a.length).padStart(4)} · d médiane ${q(d, 0.5).toFixed(3)} p90 ${q(d, 0.9).toFixed(3)} p95 ${q(d, 0.95).toFixed(3)} · |d| ≤ 1/2/3/4 cm : ${pc(d, (x) => Math.abs(x) <= 0.01)} / ${pc(d, (x) => Math.abs(x) <= 0.02)} / ${pc(d, (x) => Math.abs(x) <= 0.03)} / ${pc(d, (x) => Math.abs(x) <= 0.04)} · crédible ${pc(d, (x) => x >= -0.01 && x <= 0.03)} · trop éloigné ${pc(d, (x) => x > 0.03)} · pénétration ${pc(d, (x) => x < -0.01)}`);
      if (mode === 'contrat') {
        const by = {}; for (const x of a) (by[x.reach || '—'] ||= []).push(x);
        const fr = a.map((x) => x.dFrame);
        console.log(`      à ± une image (60 i/s) du contact : |d| ≤ 1/2/3 cm : ${pc(fr, (x) => Math.abs(x) <= 0.01)} / ${pc(fr, (x) => Math.abs(x) <= 0.02)} / ${pc(fr, (x) => Math.abs(x) <= 0.03)} · d p95 ${q(fr, 0.95).toFixed(3)}`);
        console.log(`      portée : ` + Object.entries(by).map(([r, b]) => `${r} ${b.length} (d médiane ${q(b.map((x) => x.dAtC), 0.5).toFixed(3)}, ballon à ${q(b.map((x) => x.dh), 0.5).toFixed(2)} m du joueur, hauteur ${q(b.map((x) => x.h), 0.5).toFixed(2)} m)`).join(' · '));
        const yw = a.filter((x) => x.yaw > 0.02);
        if (yw.length) console.log(`      pivot d'affichage vers le ballon (ballon derrière ou sur le côté) : ${yw.length} (${pc(a, (x) => x.yaw > 0.02)}) · médiane ${(q(yw.map((x) => x.yaw), 0.5) * 180 / Math.PI).toFixed(0)}°, max ${(Math.max(...yw.map((x) => x.yaw)) * 180 / Math.PI).toFixed(0)}° · d médiane ${q(yw.map((x) => x.dAtC), 0.5).toFixed(3)}`);
        const cr = a.filter((x) => x.cross != null);
        if (cr.length) console.log(`      jambes croisées au contact (pied du geste passé de l'autre côté du pied d'appui) : > 5 cm ${pc(cr, (x) => x.cross < -0.05)} · > 10 cm ${pc(cr, (x) => x.cross < -0.1)} · > 15 cm ${pc(cr, (x) => x.cross < -0.15)}` + (a.some((x) => x.side > 0.02) ? ` · décalage latéral d'affichage : ${a.filter((x) => x.side > 0.02).length} (médiane ${(q(a.filter((x) => x.side > 0.02).map((x) => x.side), 0.5) * 100).toFixed(0)} cm)` : ''));
        const pen = a.filter((x) => x.maxPen > 0.02);
        console.log(`      pénétration > 2 cm hors du contact : ${pen.length} (${pc(a, (x) => x.maxPen > 0.02)}) — ` + pen.map((x) => `${(x.maxPen * 100).toFixed(1)} cm à ${x.penT > 0 ? '+' : ''}${(x.penT * 1000).toFixed(0)} ms, ballon à ${x.dh} m`).join(' ; '));
      }
    }
    if (res.cov) {
      const by = {}; for (const m of res.cov.miss) by[m.kind] = (by[m.kind] || 0) + 1;
      console.log(`couverture : ${res.cov.n} gestes migrés avec contact entre le premier et le dernier relevé ; non mesurés ${res.cov.miss.length} (hors fenêtre de relevé ${res.cov.miss.filter((m) => m.gap).length}, autres ${res.cov.miss.filter((m) => !m.gap).length})` + (res.cov.miss.length ? ' — ' + Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ') : ''));
    }
    // ——— Gestes aériens (6c-A) ———
    if (res.airC.length || res.acov) {
      console.log(`\ngestes aériens (6c-A) : ${res.airC.length} gestes (joueurs de champ ; saut du gardien exclu, 6c-B)`);
      if (res.acov) console.log(`couverture aérienne : ${res.acov.n} gestes ; non mesurés ${res.acov.miss.length}${res.acov.skipped ? ` (dont ${res.acov.skipped} sans modèle réaliste chargé, LOD=mh)` : ''}` + (res.acov.miss.length ? ' — ' + JSON.stringify(res.acov.miss) : ''));
      const fam = (x) => x.kind + (x.contact ? ` · contact ${x.part || '?'}` : ' · sans contact');
      const fams = [...new Set(res.airC.map(fam))].sort();
      const cm = (x) => (x * 100).toFixed(1);
      for (const f of fams) for (const mode of ['ancien', 'contrat']) {
        const a = (mode === 'contrat' ? res.airC : res.airA).filter((x) => fam(x) === f); if (!a.length) continue;
        if (a[0].contact) {
          const d = a.map((x) => x.dAtC), fr = a.map((x) => x.dFrame), tp = a.filter((x) => mode === 'ancien' || (x.amp ?? 1) >= 0.3).map((x) => x.topT);
          console.log(`  ${f.padEnd(40)} ${mode.padEnd(8)} n=${String(a.length).padStart(3)} · d médiane ${cm(q(d, 0.5))} p90 ${cm(q(d, 0.9))} p95 ${cm(q(d, 0.95))} cm · |d| ≤ 1/2/3/4 cm : ${pc(d, (x) => Math.abs(x) <= 0.01)} / ${pc(d, (x) => Math.abs(x) <= 0.02)} / ${pc(d, (x) => Math.abs(x) <= 0.03)} / ${pc(d, (x) => Math.abs(x) <= 0.04)} · crédible ${pc(d, (x) => x >= -0.01 && x <= 0.03)} · trop éloigné ${pc(d, (x) => x > 0.03)} · pénétration ${pc(d, (x) => x < -0.01)} · à ± 1 image ≤ 3 cm ${pc(fr, (x) => Math.abs(x) <= 0.03)} · sommet du saut − contact${mode === 'contrat' ? ' (sauts d\'amplitude ≥ 0,3 : ' + tp.length + ')' : ''} : ${tp.length ? `médiane ${(q(tp, 0.5) * 1000).toFixed(0)} ms [p5 ${(q(tp, 0.05) * 1000).toFixed(0)}, p95 ${(q(tp, 0.95) * 1000).toFixed(0)}]` : '—'}`);
          if (mode === 'contrat') {
            const ps = a.filter((x) => (x.lean || 0) > 0.02 || (x.nod || 0) > 0.02);
            if (ps.length) console.log(`      pose (tête) : buste penché ${ps.length} (médiane ${q(ps.map((x) => x.lean), 0.5).toFixed(2)} rad, max ${Math.max(...ps.map((x) => x.lean)).toFixed(2)}) · menton rentré ${a.filter((x) => (x.nod || 0) > 0.02).length} (max ${Math.max(0, ...a.map((x) => x.nod || 0)).toFixed(2)} rad) · cou : angle min ${Math.min(...a.map((x) => x.neck ?? 0)).toFixed(2)} rad (limite −0,65)`);
            console.log(`      contact joueur-joueur pendant le geste (bousculade) : ${a.filter((x) => x.bumped).length} · autre partie du corps dans le ballon au contact (> 1 cm, hors mains et pieds) : ${a.filter((x) => x.otherC && x.otherC.d < -0.01).length}` + (a.some((x) => x.otherC && x.otherC.d < -0.01) ? ' — ' + a.filter((x) => x.otherC && x.otherC.d < -0.01).map((x) => `${x.otherC.part} ${(x.otherC.d * 100).toFixed(1)} cm`).join(', ') : ''));
            const amp = a.filter((x) => x.amp != null).map((x) => x.amp), hi = a.filter((x) => x.high), ball = a.map((x) => x.h);
            console.log(`      ballon au contact : hauteur médiane ${q(ball, 0.5).toFixed(2)} m [p5 ${q(ball, 0.05).toFixed(2)}, p95 ${q(ball, 0.95).toFixed(2)}], à ${q(a.map((x) => x.dh), 0.5).toFixed(2)} m du joueur · amplitude du saut médiane ${q(amp, 0.5).toFixed(2)} · ballon trop haut pour la tête : ${hi.length} · phase au contact : médiane ${q(a.map((x) => x.uC ?? NaN).filter((x) => x === x), 0.5)} · fente ${a.filter((x) => x.lunge > 0.02).length} · pivot ${a.filter((x) => x.yaw > 0.02).length} · portée : ${JSON.stringify(a.reduce((m, x) => ((m[x.reach || '—'] = (m[x.reach || '—'] || 0) + 1), m), {}))}`);
            const far = a.filter((x) => x.dAtC > 0.03).sort((x, y) => y.dAtC - x.dAtC).slice(0, 6);
            if (far.length) console.log('      cas trop éloignés (les plus défavorables) : ' + far.map((x) => `${cm(x.dAtC)} cm (ballon ${x.h} m de haut à ${x.dh} m, amplitude voulue ${x.amp}, ${x.reach})`).join(' ; '));
          }
        } else {
          const m = a.map((x) => x.minAll), fc = a.filter((x) => x.minAll < 0.01);
          console.log(`  ${f.padEnd(40)} ${mode.padEnd(8)} n=${String(a.length).padStart(3)} · distance minimale corps ↔ ballon : médiane ${cm(q(m, 0.5))} p5 ${cm(q(m, 0.05))} cm · FAUX CONTACT VISUEL (< 1 cm) : ${fc.length} (${pc(a, (x) => x.minAll < 0.01)}) · < 5 cm : ${a.filter((x) => x.minAll < 0.05).length}` + (fc.length ? ' — ' + fc.slice(0, 6).map((x) => `${cm(x.minAll)} cm à ${(x.minAllT * 1000).toFixed(0)} ms, ${x.minAllPart} (${x.src || ''}${x.notes.length ? ', ' + x.notes.join('/') : ''})`).join(' ; ') : ''));
          if (mode === 'contrat') console.log(`      contact joueur-joueur pendant le saut (bousculade) : ${a.filter((x) => x.bumped).length}, dont faux contact au ballon : ${a.filter((x) => x.bumped && x.minAll < 0.01).length} · écartement d'affichage (évite un contact visuel) : ${a.filter((x) => x.avoid > 0.005).length} (médiane ${cm(q(a.filter((x) => x.avoid > 0.005).map((x) => x.avoid), 0.5) || 0)} cm) · origine : ${JSON.stringify(a.reduce((m, x) => ((m[x.src || '?'] = (m[x.src || '?'] || 0) + 1), m), {}))} · ballon proche (< 1,3 m) : ${a.filter((x) => x.why === 'sans contact, ballon proche').length}`);
        }
      }
    }
    console.log(`(ancien = anciens indicateurs, même différé ; « au contact » : minimum dans ±1 pas = ±${(dt * 1000).toFixed(1)} ms)`);
    if (process.env.GKSERIES) res.gkSeries = await page.evaluate(() => window.__view.r3d._gkSeries);
    if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify(res));
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
