/**
 * Analyse d'après-match façon FM : carte des tirs, origine des occasions, couloirs utilisés,
 * zones de récupération, et constats rédigés par le staff sur ce qui a marché ou non.
 */
const BOX = 1 - 16.5 / 105;   // entrée de la surface (repère d'attaque)

/** Tirs du match (avec position du tireur), dans le repère d'attaque de chaque équipe. */
export function shotList(m) {
  return (m.log || []).filter((e) => e.type === 'shot' && e.ax != null)
    .map((e) => ({ side: e.side, pid: e.pid, xg: e.xg || 0, kind: e.kind, outcome: e.outcome, ax: e.ax, ay: e.ay, minute: e.minute }));
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Profil offensif d'une équipe. */
export function shotProfile(m, side) {
  const S = shotList(m).filter((s) => s.side === side);
  const n = S.length, xg = S.reduce((a, s) => a + s.xg, 0);
  const inBox = S.filter((s) => s.ax >= BOX), big = S.filter((s) => s.xg >= 0.25);
  const goals = S.filter((s) => s.outcome === 'goal').length;
  return { n, xg, goals, inBox: inBox.length, outBox: n - inBox.length, big: big.length, bigScored: big.filter((s) => s.outcome === 'goal').length,
    headers: S.filter((s) => s.kind === 'header').length, setp: S.filter((s) => s.kind === 'freekick' || s.kind === 'penalty').length,
    onT: S.filter((s) => s.outcome === 'goal' || s.outcome === 'saved').length, avg: n ? xg / n : 0 };
}

/**
 * Constats du staff pour `side` (liste de { tone: 'good'|'bad'|'info', text }).
 * `tac` = tactique jouée par l'équipe (pour relier les chiffres aux consignes).
 */
export function insights(m, side, tac = {}) {
  const out = [];
  const me = shotProfile(m, side), th = shotProfile(m, 1 - side);
  const T = m.teams[side], O = m.teams[1 - side];
  const A = m.ana || { rec: [[0, 0, 0], [0, 0, 0]], lane: [[0, 0, 0], [0, 0, 0]] };
  const add = (tone, text) => out.push({ tone, text });
  const goals = m.score[side], against = m.score[1 - side];

  // Finition.
  if (me.n) {
    const d = goals - me.xg;
    if (d >= 1.2) add('good', `Réalisme clinique : ${goals} but(s) pour ${me.xg.toFixed(2)} xG. Difficile de faire mieux, mais ce rendement ne durera pas forcément.`);
    else if (d <= -1.2) add('bad', `Gâchis devant le but : ${me.xg.toFixed(2)} xG pour ${goals} but(s)${me.big ? `, ${me.big - me.bigScored} grosse(s) occasion(s) manquée(s)` : ''}. Le plan créait assez, la finition a manqué.`);
  }
  // Qualité des tirs.
  if (me.n >= 6 && me.outBox / me.n >= 0.55) add('bad', `${pct(me.outBox, me.n)} % de nos tirs de loin (xG moyen ${me.avg.toFixed(2)}) : on tente trop tôt. Jouez davantage dans la surface${tac.longShots === 'high' ? ' et réduisez les frappes lointaines' : ''}.`);
  else if (me.n >= 5 && me.avg >= 0.14) add('good', `Occasions de qualité : xG moyen de ${me.avg.toFixed(2)} par tir, ${me.inBox} tir(s) dans la surface.`);
  if (me.n <= 4) add('bad', `Seulement ${me.n} tir(s) : l'équipe a peu inquiété l'adversaire${tac.mentality === 'defensive' || tac.mentality === 'ultradef' ? ' (mentalité défensive)' : ''}.`);
  // Possession stérile.
  const tot = (T.stats.poss + O.stats.poss) || 1, poss = Math.round((T.stats.poss / tot) * 100);
  if (poss >= 58 && me.xg < th.xg) add('bad', `${poss} % de possession mais moins d'xG que l'adversaire (${me.xg.toFixed(2)} contre ${th.xg.toFixed(2)}) : possession stérile, il faut plus de verticalité.`);
  if (poss <= 42 && me.xg > th.xg + 0.3) add('good', `Avec ${poss} % de possession seulement, nous avons créé plus qu'eux : le plan en contre a fonctionné.`);
  // Couloirs.
  const lane = A.lane[side], lt = lane[0] + lane[1] + lane[2];
  if (m.live && lt >= 20) {
    const names = ['à gauche', 'dans l\'axe', 'à droite'];
    const i = lane.indexOf(Math.max(...lane)), share = pct(lane[i], lt);
    if (share >= 45) add('info', `Jeu orienté ${names[i]} (${share} % des actions dans le camp adverse)${i === 1 && tac.width === 'high' ? ' alors que vous demandez de la largeur' : i !== 1 && tac.width === 'low' ? ' alors que vous demandez un jeu resserré' : ''}.`);
  }
  // Pressing.
  const rec = A.rec[side], rt = rec[0] + rec[1] + rec[2];
  if (m.live && rt >= 8) {
    const hi = pct(rec[2], rt);
    if (tac.pressing === 'high' && hi < 18) add('bad', `Pressing haut peu efficace : ${hi} % seulement des ballons récupérés dans le dernier tiers.`);
    else if (hi >= 28) add('good', `Pressing payant : ${rec[2]} ballon(s) récupéré(s) dans le camp adverse (${hi} %).`);
    else if (pct(rec[0], rt) >= 60) add('info', `Récupérations surtout près de notre but (${pct(rec[0], rt)} %) : l'équipe a beaucoup subi.`);
  }
  // Défense : origine des occasions adverses.
  if (th.big >= 3) add('bad', `${th.big} grosses occasions concédées${th.headers >= 3 ? `, dont beaucoup de têtes (${th.headers}) : problème sur les centres` : ''}.`);
  else if (th.n && th.xg < 0.6) add('good', `Défense solide : l'adversaire n'a cumulé que ${th.xg.toFixed(2)} xG.`);
  if (against >= 2 && th.xg < 1) add('info', `${against} buts encaissés pour ${th.xg.toFixed(2)} xG adverse : un peu de malchance (ou un soir sans pour le gardien).`);
  if (me.setp + me.headers >= 4 && me.goals === 0) add('info', `${me.headers} tête(s) et ${me.setp} tir(s) sur coups de pied arrêtés sans marquer : travaillez les CPA à l'entraînement.`);
  // Discipline.
  if (T.stats.fouls >= 17) add('bad', `${T.stats.fouls} fautes commises : l'engagement frôle l'excès${tac.tackling === 'hard' ? ' (consigne de tacles appuyés)' : ''}.`);
  if (!out.length) add('info', 'Match sans enseignement marquant : les deux plans se sont neutralisés.');
  return out;
}

/** Joueurs marquants dans les duels et à la passe. */
export function playerLeaders(m, side) {
  const T = m.teams[side];
  const all = [...T.onPitch, ...(T.out || []), ...(T.bench || [])].filter((mp) => mp && mp.minIn != null);
  const top = (f, k) => all.filter(f).sort(k)[0];
  const tk = top((p) => (p.tackles || 0) > 0, (a, b) => (b.tackles || 0) - (a.tackles || 0));
  const ps = top((p) => (p.passes || 0) >= 15, (a, b) => (b.passesOk || 0) / b.passes - (a.passesOk || 0) / a.passes);
  const vol = top((p) => (p.passes || 0) > 0, (a, b) => (b.passes || 0) - (a.passes || 0));
  return { tackler: tk && { name: tk.name, n: tk.tackles }, accurate: ps && { name: ps.name, pct: pct(ps.passesOk || 0, ps.passes) }, volume: vol && { name: vol.name, n: vol.passes } };
}
