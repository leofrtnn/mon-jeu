/**
 * MODÈLE CINÉMATIQUE DU JOUEUR (étape 5c) — un seul modèle pour le déplacement réel (move()) et
 * pour le calcul du temps d'arrivée (réception, interception, poursuite du ballon).
 *
 * Pas de vitesse (velocityStep) : vitesse voulue vers la cible = min(allure demandée, freinage
 * voulu √(2·b·d)), à reculons ≤ 5,6 m/s ; la vitesse ne change que d'au plus `acc`·dt en
 * accélération (attribut vitesse) ou 8,5·dt en freinage, ×0,75 pour un virage serré lancé.
 * Capacité (topSpeed) : vitesse de pointe selon l'attribut, le trait « fusée », la météo, la
 * fatigue, le ballon au pied.
 * Temps d'arrivée (timeTo, pursue) : on SIMULE ce même pas depuis l'état réel du joueur (position,
 * vitesse, orientation), au pas h (0,04 s par défaut), jusqu'à être à portée du point.
 * Module pur et déterministe (aucun hasard).
 */
export const BODY = { DECEL: 8.5, BACK: 5.6, TURN_SPEED: 3.5, TURN_ANGLE: 1.3, TURN_K: 0.75, STOP: 0.15, FACE_RATE: 7, ARRIVE: 0.2, GRIP: 1.5, TURN_MIN: 1 };

/** Accélération (m/s²) selon l'attribut vitesse. */
export const accelOf = (vit = 60) => 4.4 + vit * 0.013;

/** Vitesse de pointe atteignable (m/s), même formule que le mouvement réel. */
export function topSpeed({ vit = 60, energy = 100, weather = 1, fusee = false, withBall = 1, celeb = false } = {}) {
  return (6.2 + vit * 0.03) * (fusee ? 1.03 : 1) * weather * (energy > 70 ? 1 - (100 - energy) * 0.002 : 0.94 - (70 - energy) * 0.006) * withBall * (celeb ? 0.8 : 1);
}

/**
 * Un pas de vitesse vers une cible située à (dx, dy) m. `s` = { vx, vy, speed, face } (modifié).
 * maxSp : allure demandée bornée par la capacité ; brake : décélération voulue à l'approche.
 */
export function velocityStep(s, dx, dy, maxSp, brake, acc, dt) {
  const dist = Math.hypot(dx, dy);
  let want = dist < BODY.STOP ? 0 : Math.min(maxSp, Math.sqrt(2 * brake * dist));
  if (dist > 0.01 && s.face != null && Math.cos(Math.atan2(dy, dx) - s.face) < -0.5) want = Math.min(want, BODY.BACK); // à reculons
  // Virage (étape 5c) : pour rejoindre un point qui n'est pas dans l'axe de sa course, il faut un
  // virage de rayon R = d / (2 sin θ) (cercle tangent à la course passant par le point) ; on ne le
  // prend qu'à v ≤ √(adhérence · R), adhérence = accélération + GRIP. Trop vite : on ralentit pour
  // tourner (sinon on passe à côté du point et on lui tourne autour). Point derrière soi : on freine.
  const sp0v = s.speed || 0;
  if (sp0v > 2 && dist > 0.01) {
    const cosA = (s.vx * dx + s.vy * dy) / (sp0v * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    if (cosA < 0 || sinA > 0.05) {
      const R = cosA < 0 ? 0 : dist / (2 * sinA);
      want = Math.min(want, Math.max(BODY.TURN_MIN, Math.sqrt((acc + BODY.GRIP) * R)));
    }
  }
  const dvx = dist > 0.01 ? (dx / dist) * want : 0, dvy = dist > 0.01 ? (dy / dist) * want : 0;
  const ax = dvx - s.vx, ay = dvy - s.vy, am = Math.hypot(ax, ay);
  // Inertie : on accélère selon sa vitesse de pointe, on ne tourne pas sur place lancé.
  const sp0 = s.speed || 0;
  let lim = (want > sp0 ? acc : BODY.DECEL) * dt;
  if (sp0 > BODY.TURN_SPEED && want > 0.5) {
    const turn = Math.abs(Math.atan2(s.vx * dvy - s.vy * dvx, s.vx * dvx + s.vy * dvy));
    if (turn > BODY.TURN_ANGLE) lim *= BODY.TURN_K;
  }
  if (am > lim) { s.vx += (ax / am) * lim; s.vy += (ay / am) * lim; } else { s.vx = dvx; s.vy = dvy; }
}

/** Orientation pendant une course simulée : le corps suit le sens de la course. */
function faceStep(s, dt) {
  if (s.speed <= 0.6) return;
  let d = Math.atan2(s.vy, s.vx) - (s.face || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  s.face = (s.face || 0) + d * Math.min(1, dt * BODY.FACE_RATE);
}

/**
 * Simule le joueur `pl` ({ x, y, vx, vy, face, speed? } en m) qui poursuit une cible donnée par
 * `target(t)` → { x, y } ; renvoie le premier instant où il est à `radius` m de la cible.
 */
export function pursue(pl, target, { vmax = 8, acc = 5, brake = 6, radius = BODY.ARRIVE, h = 0.04, tMax = 4 } = {}) {
  const s = { x: pl.x, y: pl.y, vx: pl.vx || 0, vy: pl.vy || 0, face: pl.face ?? null };
  s.speed = pl.speed ?? Math.hypot(s.vx, s.vy);
  let g = target(0), prevD = Math.hypot(g.x - s.x, g.y - s.y);
  if (prevD <= radius) return { t: 0, x: g.x, y: g.y };
  for (let t = h; t <= tMax + 1e-9; t += h) {
    velocityStep(s, g.x - s.x, g.y - s.y, vmax, brake, acc, h);
    s.x += s.vx * h; s.y += s.vy * h; s.speed = Math.hypot(s.vx, s.vy);
    faceStep(s, h);
    g = target(t);
    const d = Math.hypot(g.x - s.x, g.y - s.y);
    if (d <= radius) {
      // Instant de passage interpolé dans le dernier pas.
      const k = prevD > d ? Math.min(1, Math.max(0, (prevD - radius) / (prevD - d))) : 1;
      return { t: t - h + k * h, x: g.x, y: g.y };
    }
    prevD = d;
  }
  return null;
}

/** Temps (s) pour amener le joueur à `slack` m du point fixe (x, y) ; `react` s'ajoute (perception). */
export function timeTo(pl, x, y, { vmax = 8, acc = 5, brake = 6, react = 0, slack = 0, h = 0.04, tMax = 4 } = {}) {
  const radius = Math.max(slack, BODY.ARRIVE);
  const d0 = Math.hypot(x - pl.x, y - pl.y);
  if (d0 <= Math.max(slack, 0.05)) return 0;
  // Borne exacte du modèle : la vitesse ne croît que d'au plus acc·h par pas et ne dépasse pas
  // max(vitesse initiale, vitesse de pointe) ; au-delà de cette distance, le point est hors d'atteinte
  // dans l'horizon (même résultat que la simulation, sans la dérouler).
  const sp0 = pl.speed ?? Math.hypot(pl.vx || 0, pl.vy || 0);
  const reach = Math.min(sp0 * tMax + 0.5 * acc * tMax * tMax + acc * h * tMax, Math.max(sp0, vmax) * tMax) + h * Math.max(sp0, vmax);
  const r = d0 - radius > reach ? null : pursue(pl, () => ({ x, y }), { vmax, acc, brake, radius, h, tMax });
  if (r) return react + r.t;
  return react + tMax + Math.max(0, Math.hypot(x - pl.x, y - pl.y) - vmax * tMax) / vmax;   // hors horizon : borne basse
}
