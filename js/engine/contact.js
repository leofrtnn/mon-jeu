/**
 * GÉOMÉTRIE DE CONTACT JOUEUR–BALLON (étape 4a de la refonte du moteur en direct).
 *
 * Module pur, en MÈTRES, sans état ni hasard propre (le hasard est fourni par l'appelant, donc
 * tout reste déterministe à graine identique). C'est l'unique source de vérité pour savoir si un
 * joueur PEUT toucher le ballon, avec quelle partie du corps, et avec quelle qualité de toucher.
 *
 * Repère : x le long du terrain (0 → 105), y en largeur (0 → 68), z la hauteur du CENTRE du ballon.
 * Un joueur est décrit par { x, y, face, vx, vy } en mètres (face = angle du regard, en radians).
 *
 * Principe : un toucher n'existe que si, pendant le pas de simulation, le ballon passe
 * physiquement dans la zone d'atteinte d'une partie du corps. Rien ne déplace le ballon vers le
 * joueur : c'est le joueur qui doit amener son corps sur la trajectoire.
 */

/** Rayon du ballon (m). */
export const BALL_R = 0.11;

/** Corps du joueur : rayon de la capsule de collision (épaules), et taille de référence. */
export const BODY = { radius: 0.32, height: 1.82 };

/**
 * Parties du corps qui peuvent toucher le ballon, selon la hauteur du centre du ballon.
 *  - zMin / zMax : hauteurs du centre du ballon pour lesquelles la partie est utilisable ;
 *  - ahead       : distance du point de contact naturel devant le centre du corps ;
 *  - reach       : rayon autour de ce point atteignable sans se déséquilibrer (toucher propre) ;
 *  - stretch     : rayon supplémentaire atteignable en s'étirant (toucher dégradé) ;
 *  - back        : jusqu'où derrière le centre du corps le ballon reste jouable (pied d'appui pivoté).
 * Valeurs issues des proportions d'un adulte de 1,80 m (jambe ~0,95 m, fente ~1 m).
 */
export const PARTS = {
  foot: { zMin: 0, zMax: 0.5, ahead: 0.32, reach: 0.38, stretch: 0.42, back: 0.15 },
  thigh: { zMin: 0.45, zMax: 0.95, ahead: 0.3, reach: 0.3, stretch: 0.15, back: 0.05 },
  chest: { zMin: 0.95, zMax: 1.55, ahead: 0.22, reach: 0.28, stretch: 0.1, back: 0 },
  head: { zMin: 1.5, zMax: 2.05, ahead: 0.12, reach: 0.25, stretch: 0.1, back: 0 },
};
/** Hauteur gagnée en sautant (tête), selon le physique (0-99) : ~0,35 m à 0,65 m. */
export const jumpGain = (phy = 60) => 0.35 + Math.max(0, Math.min(1, (phy - 40) / 55)) * 0.3;

/** Vitesse relative (m/s) au-delà de laquelle la zone d'atteinte se réduit (temps de réaction). */
const FAST = 9;

/** Parties du corps utilisables pour un ballon à la hauteur z (en tenant compte du saut). */
export function partsForHeight(z, { canJump = true, phy = 60 } = {}) {
  const out = [];
  for (const [k, P] of Object.entries(PARTS)) {
    const zMax = k === 'head' && canJump ? P.zMax + jumpGain(phy) : P.zMax;
    if (z >= P.zMin && z <= zMax) out.push(k);
  }
  return out;
}

/** Point de contact naturel d'une partie du corps (m). `side` : -1 pied gauche, +1 pied droit, 0 axe. */
export function contactPoint(pl, part, side = 0) {
  const P = PARTS[part], c = Math.cos(pl.face || 0), s = Math.sin(pl.face || 0);
  const lat = part === 'foot' ? side * 0.12 : 0;   // le pied est à côté de l'axe du corps
  return { x: pl.x + c * P.ahead - s * lat, y: pl.y + s * P.ahead + c * lat };
}

/**
 * Le ballon est-il, à cet instant, dans la zone d'atteinte du joueur ?
 * Renvoie null, ou { part, dist, stretch (0 = toucher propre … 1 = à la limite), point, behind }.
 * La zone dépend de la hauteur du ballon (partie du corps utilisable) et de sa vitesse relative
 * au joueur (un ballon très rapide laisse moins de temps pour ajuster le geste).
 */
export function reachAt(pl, ball, opts = {}) {
  const rvx = (ball.vx || 0) - (pl.vx || 0), rvy = (ball.vy || 0) - (pl.vy || 0);
  const rel = Math.hypot(rvx, rvy, ball.vz || 0);
  const speedK = rel <= FAST ? 1 : Math.max(0.55, 1 - (rel - FAST) / 30);
  const c = Math.cos(pl.face || 0), s = Math.sin(pl.face || 0);
  let best = null;
  for (const part of partsForHeight(ball.z ?? BALL_R, opts)) {
    if (opts.parts && !opts.parts.includes(part)) continue;
    const P = PARTS[part];
    // Repère du joueur : u devant, w sur le côté.
    const dx = ball.x - pl.x, dy = ball.y - pl.y;
    const u = dx * c + dy * s, w = -dx * s + dy * c;
    if (u < -P.back) continue;                                   // dans le dos : injouable
    const du = u - P.ahead, dist = Math.hypot(du, w) - BALL_R;   // distance de la surface du ballon au point de contact
    const rMax = (P.reach + P.stretch) * speedK;
    if (dist > rMax) continue;
    const stretch = Math.max(0, Math.min(1, (dist - P.reach * speedK) / Math.max(1e-6, P.stretch * speedK)));
    if (!best || stretch < best.stretch || (stretch === best.stretch && dist < best.dist)) best = { part, dist, stretch, behind: u < 0, point: contactPoint(pl, part) };
  }
  return best;
}

/**
 * Test BALAYÉ : le ballon est passé de b0 à b1 pendant le pas ; le joueur de p0 à p1.
 * On échantillonne le mouvement relatif (un ballon à 30 m/s parcourt ~0,3 m par pas de 1/96 s,
 * jusqu'à 1,5 m avec des pas de 0,05 s) pour ne jamais « traverser » une zone sans la voir.
 * Renvoie { t (0-1 dans le pas), reach, ball } du premier instant où le contact est possible.
 */
export function sweptReach(p0, p1, b0, b1, opts = {}) {
  const d = Math.hypot(b1.x - b0.x, b1.y - b0.y, (b1.z ?? 0) - (b0.z ?? 0)) + Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const n = Math.max(1, Math.min(24, Math.ceil(d / 0.08)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, lerp = (a, b) => a + (b - a) * t;
    const pl = { x: lerp(p0.x, p1.x), y: lerp(p0.y, p1.y), face: p1.face, vx: p1.vx, vy: p1.vy };
    const ball = { x: lerp(b0.x, b1.x), y: lerp(b0.y, b1.y), z: lerp(b0.z ?? BALL_R, b1.z ?? BALL_R), vx: b1.vx, vy: b1.vy, vz: b1.vz };
    const r = reachAt(pl, ball, opts);
    if (r) return { t, reach: r, ball };
  }
  return null;
}

/**
 * Temps pour qu'un joueur atteigne un point (m), avec un modèle cinématique simple et
 * déterministe : temps de réaction, accélération jusqu'à sa vitesse de pointe, demi-tour coûteux.
 */
export function timeToReach(pl, x, y, { vmax = 8, acc = 5, react = 0.18 } = {}) {
  const dx = x - pl.x, dy = y - pl.y, d = Math.hypot(dx, dy);
  if (d < 0.05) return 0;
  const v0 = ((pl.vx || 0) * dx + (pl.vy || 0) * dy) / d;          // vitesse déjà orientée vers le point
  const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - (pl.face || 0)), Math.cos(Math.atan2(dy, dx) - (pl.face || 0))));
  const tTurn = turn > 1.6 ? 0.25 : turn > 0.8 ? 0.1 : 0;          // se retourner prend du temps
  const v = Math.max(0, Math.min(vmax, v0));
  const tAcc = (vmax - v) / acc, dAcc = v * tAcc + 0.5 * acc * tAcc * tAcc;
  const tRun = d <= dAcc ? (-v + Math.sqrt(v * v + 2 * acc * d)) / acc : tAcc + (d - dAcc) / vmax;
  return react + tTurn + tRun;
}

/**
 * Point d'interception : le premier instant où le joueur peut amener une partie de son corps sur
 * la trajectoire PRÉDITE du ballon (la prédiction vient de la vraie physique du ballon).
 *  - `path` : [{ t, x, y, z, vx, vy, vz }] échantillons de trajectoire (voir ballPath) ;
 *  - renvoie { t, x, y, z, part, margin } (margin = avance du joueur, en s) ou null.
 * Le joueur se place sur le point au sol sous le ballon, décalé pour présenter la partie du corps.
 */
export function interceptPlan(pl, path, opts = {}) {
  for (const s of path) {
    const parts = partsForHeight(s.z, opts);
    if (!parts.length) continue;
    const part = parts.includes('foot') ? 'foot' : parts[0];
    const P = PARTS[part];
    // Il présente le pied/le corps face au ballon : il se place un peu en amont de la trajectoire.
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const x = s.x - (s.vx / sp) * P.ahead, y = s.y - (s.vy / sp) * P.ahead;
    const tr = timeToReach(pl, x, y, opts);
    const margin = s.t - tr;
    if (margin >= (opts.minMargin ?? 0)) return { t: s.t, x, y, z: s.z, part, margin };
  }
  return null;
}

/** Échantillonne la trajectoire d'un ballon (fonction de prédiction fournie, ex. ballPhysics.predict). */
export function ballPath(ball, predictFn, { horizon = 3, step = 0.05 } = {}) {
  const out = [];
  let b = ball;
  for (let t = step; t <= horizon + 1e-9; t += step) {
    b = predictFn(b, step);
    out.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
  }
  return out;
}

/**
 * Qualité d'un toucher (0 = raté … 1 = parfait) à partir de la technique du joueur et des
 * conditions physiques réelles du contact.
 *  - tech     : technique (0-99), ex. moyenne dribble / passe ;
 *  - stretch  : 0 propre … 1 à la limite de la zone ;
 *  - rel      : vitesse relative ballon–joueur (m/s) ;
 *  - part     : partie du corps (le pied est la plus précise, la poitrine amortit bien, la tête peu) ;
 *  - pressure : distance (m) de l'adversaire le plus proche.
 */
export function touchQuality({ tech = 60, stretch = 0, rel = 5, part = 'foot', pressure = 10 }) {
  const partK = { foot: 1, thigh: 0.88, chest: 0.92, head: 0.7 }[part] ?? 0.8;
  const t = (tech - 30) / 65;                                 // 0 (30) … 1 (95)
  const speedPen = Math.max(0, rel - 6) * (0.035 - 0.02 * t);  // ballon fusant : plus dur pour les moins techniques
  const pressPen = pressure < 1.5 ? 0.12 : pressure < 3 ? 0.06 : 0;
  return Math.max(0, Math.min(1, (0.55 + 0.45 * t) * partK - stretch * 0.35 - speedPen - pressPen));
}

/**
 * Premier toucher : nouvelle vitesse du ballon après le contact (impulsion physique, jamais un
 * déplacement du ballon).
 *  - incoming : vitesse du ballon avant contact { vx, vy, vz } ;
 *  - pl       : joueur (vitesse { vx, vy }) ;
 *  - dir      : direction souhaitée du premier toucher (radians) — orienté vers l'espace ;
 *  - push     : vitesse souhaitée du ballon par rapport au joueur (m/s, 0 = l'arrêter sous le pied) ;
 *  - q        : qualité (touchQuality) ;
 *  - rnd      : deux nombres aléatoires [0,1) fournis par l'appelant (hasard déterministe).
 * Un bon toucher amortit presque toute la vitesse entrante et place le ballon où il faut ; un
 * mauvais laisse une partie de la vitesse et dévie la direction.
 */
export function firstTouch({ incoming, pl, dir, push, q, rnd }) {
  const cushion = 0.55 + 0.42 * q;                 // part de la vitesse entrante absorbée
  const err = (1 - q) * (rnd[0] - 0.5) * 1.6;      // erreur d'orientation (rad)
  const pushK = 1 + (1 - q) * (rnd[1] - 0.3) * 1.2; // dosage
  const a = dir + err, v = Math.max(0, push * pushK);
  const vx = (pl.vx || 0) + Math.cos(a) * v + incoming.vx * (1 - cushion);
  const vy = (pl.vy || 0) + Math.sin(a) * v + incoming.vy * (1 - cushion);
  const vz = Math.max(0, (incoming.vz || 0) * (1 - cushion) * -0.4);
  return { vx, vy, vz, cushion, err };
}
