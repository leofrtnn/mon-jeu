/**
 * Sonde 6d-B (complément) : essai réel du ralenti de but (graine 24 conseillée : but à 25 s).
 * Relève image par image le nombre de célébrations du moteur et de célébrations réellement dessinées (3D : entrée
 * de la pose ; 2D : silhouettes, bras levés), les écritures de celeb pendant le ralenti, l'état complet du moteur
 * avant / après le ralenti ; avec TWIN=1, moteurs jumeaux sans interface pendant tout l'essai.
 * Usage : SEED=24 TWIN=1 node tools/bench/replay-check.cjs [racine=.] [3d|anim] [préfixe des captures]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const STYLE = process.argv[3] || '3d', OUT = path.resolve(process.argv[4] || 'rp-out');
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
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
  // SEED=n : Math.random de la page fixé (création de la partie, choix d'affichage) — le même match est
  // rejoué à chaque passe, pour comparer les MÊMES gestes avant / après une correction de rendu.
  if (process.env.SEED) await ctx.addInitScript((seed) => { const realNow = Date.now.bind(Date); window.__freezeNow = true; Date.now = () => (window.__freezeNow ? 1767225600000 + seed * 1000 : realNow()); let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, +process.env.SEED);
  if (process.env.TWIN) await ctx.addInitScript(() => { globalThis.__twin6 = { noMirror: [] }; });
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
    // ---- Essai du ralenti (sonde hors dépôt) ----
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    if (process.env.SEED) await page.evaluate(() => { window.__freezeNow = false; });
    await page.evaluate((style) => {
      const v = window.__view, L = v.live, R = window.__rp = { frames: [], starts: [], ends: [], celebW: 0, celebWlist: [], replayCalls: 0 };
      if (style !== '3d') v.setStyle(style);
      const prim = (o) => { const r = {}; for (const k of Object.keys(o).sort()) if (['number', 'string', 'boolean'].includes(typeof o[k]) || o[k] == null) r[k] = o[k]; return r; };
      const state = () => ({ now: L.now, rng: L.m.rng.getState(), score: L.m.score.join('-'), minute: L.m.minute, phase: L.m.phase, ball: prim(L.P), players: Object.fromEntries([...L.players].map(([id, p]) => [id, prim(p)])), holder: L.holder?.mp.id ?? null, celebrate: L.celebrate });
      const diffS = (a, b) => { const d = []; for (const k of ['now', 'rng', 'score', 'minute', 'phase', 'holder', 'celebrate']) if (a[k] !== b[k]) d.push(k); for (const k of new Set([...Object.keys(a.ball), ...Object.keys(b.ball)])) if (a.ball[k] !== b.ball[k]) d.push('ballon.' + k); for (const id of Object.keys(a.players)) { const p = a.players[id], q = b.players[id] || {}; for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) if (p[k] !== q[k]) d.push(`${id}.${k} ${p[k]}→${q[k]}`); } return d; };
      const s0 = v.startReplay.bind(v), e0 = v.endReplay.bind(v), p0 = v.playReplay.bind(v);
      v.startReplay = () => { const st = state(); const r = s0(); if (v.replayLive) { R.starts.push({ now: L.now, wall: performance.now(), kind: v.replayLive.kind }); R._st = st; } return r; };
      v.endReplay = () => { const had = !!v.replayLive; const r = e0(); if (had) { const st = state(); R.ends.push({ now: L.now, wall: performance.now(), diff: diffS(R._st, st).slice(0, 30), nDiff: diffS(R._st, st).length }); } return r; };
      v.playReplay = (dt) => { const before = new Map([...L.players].map(([id, p]) => [id, p.celeb])); const r = p0(dt); R.replayCalls++; for (const [id, p] of L.players) if (p.celeb !== before.get(id)) { R.celebW++; if (R.celebWlist.length < 5) R.celebWlist.push({ id, from: before.get(id), to: p.celeb }); } return r; };
      // Ce que dessinent réellement les rendus : 3D (entrée de la pose) et 2D (silhouettes, bras levés).
      const shown = R.shown = new Map();
      if (style === '3d') {
        const r0 = v.r3d.render.bind(v.r3d);
        v.r3d.render = (...a) => { shown.clear(); for (const [id, e] of v.r3d.players) if (!e.p3._rpw) { const f = e.p3.pose.bind(e.p3); e.p3.pose = (p, ...b) => { shown.set(id, (p.celeb || 0) > 0); return f(p, ...b); }; e.p3._rpw = true; } return r0(...a); };
      } else {
        const d0 = v.drawPlayer.bind(v);
        v.drawPlayer = (g, p, ...b) => { if (p.mp) shown.set(p.mp.id, p.celeb > 0 && !v.replayLive); return d0(g, p, ...b); };
      }
      const f0 = v.frame.bind(v);
      v._loop = (ts) => { shown.clear(); v.frame(ts); };
      v.frame = (ts) => { const r = f0(ts); const goalSide = L.m.score[0] + L.m.score[1] > 0 ? (L.m.score[0] > 0 ? 0 : 1) : null;
        if (goalSide != null && R.frames.length < 20000) { const ids = [...L.players].filter(([, p]) => p.side === goalSide && !p.gk).map(([id]) => id);
          R.frames.push({ wall: performance.now(), now: +L.now.toFixed(3), rp: !!v.replayLive, pass: v.replayLive?.pass ?? null, eng: ids.filter((id) => (L.players.get(id).celeb || 0) > 0).length, shown: ids.filter((id) => shown.get(id)).length, n: ids.length }); }
        return r; };
    }, STYLE);
    // Attente du premier but puis du ralenti et de la reprise.
    await page.waitForFunction(() => window.__view.live.m.score.join() !== '0,0', null, { timeout: 300000 });
    console.log('but', await page.evaluate(() => window.__view.live.now.toFixed(2)));
    await page.waitForFunction(() => window.__rp.starts.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500); await page.screenshot({ path: OUT + '-ralenti.png' });
    await page.waitForFunction(() => window.__rp.ends.length > 0, null, { timeout: 900000 });
    await page.waitForTimeout(150); await page.screenshot({ path: OUT + '-apres.png' });
    await page.waitForTimeout(6000);
    const res = await page.evaluate(() => { const R = window.__rp, F = R.frames; const tw = globalThis.__twin6?.res;
      const st = R.starts[0], en = R.ends[0];
      const seg = (a, b) => F.filter((f) => f.wall >= a && f.wall < b);
      const before = seg(0, st.wall), during = seg(st.wall, en.wall), after = seg(en.wall, Infinity);
      const sum = (A) => ({ frames: A.length, engCeleb: [Math.min(...A.map((f) => f.eng)), Math.max(...A.map((f) => f.eng))], shownCeleb: [Math.min(...A.map((f) => f.shown)), Math.max(...A.map((f) => f.shown))], now: A.length ? [A[0].now, A[A.length - 1].now] : null, mismatch: A.filter((f) => !f.rp && f.shown !== f.eng).length });
      const firstAfter = after.slice(0, 4).map((f) => `${f.now} moteur ${f.eng}/${f.n} affiché ${f.shown}`);
      return { starts: R.starts.length, ends: R.ends.map((e) => ({ nDiff: e.nDiff, diff: e.diff })), celebWritesDuringReplay: R.celebW, celebW: R.celebWlist, replayCalls: R.replayCalls, before: sum(before), during: sum(during), after: sum(after), firstAfter,
        twin: tw ? { mirror: tw.mirror, mirrorN: tw.mirrorN, pure: tw.pure && { t: tw.pure.t, d: tw.pure.d.slice(0, 3) }, writes: tw.writes, steps: tw.steps } : null };
    });
    console.log(JSON.stringify(res, null, 1));
    console.log('erreurs', JSON.stringify(errs));
  } catch (e) { console.log('Échec :', e.message.slice(0, 600)); }
  await browser.close(); srv.close();
})();
