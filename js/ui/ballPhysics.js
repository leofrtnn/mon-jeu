/**
 * PHYSIQUE DU BALLON (unités réelles : mètres, secondes)
 * ------------------------------------------------------------------
 * Repère : X le long du terrain (0 → 105, buts en X = 0 et X = 105), Y en largeur (0 → 68),
 * Z vers le haut. Le ballon subit :
 *  - la gravité ;
 *  - la traînée de l'air (a = -k·|v|·v) ;
 *  - l'effet Magnus : l'effet latéral (rotation autour de l'axe vertical) enroule la
 *    trajectoire, l'effet coupé/brossé (rotation horizontale) la fait flotter ou plonger ;
 *  - les rebonds sur l'herbe (restitution, frottement, l'effet s'use) puis le roulement
 *    (résistance de l'herbe) ;
 *  - les poteaux, la transversale, les filets et les panneaux publicitaires.
 *
 * solveKick() calcule la vitesse de départ (et l'effet) qui amène le ballon à un point
 * donné, au sol ou en l'air, en tenant compte de toute la physique (méthode du tir :
 * on simule, on mesure l'écart, on corrige). Aucune dépendance au navigateur.
 */

export const PITCH_L = 105, PITCH_W = 68;
export const R = 0.11;                  // rayon du ballon
export const G = 9.81;
const K_DRAG = 0.0125;                  // ρ·Cd·A / 2m ≈ 1,2·0,25·0,038 / 0,86
const K_MAGNUS = 0.0034;                // accélération par (rad/s)·(m/s)
const SPIN_DECAY = 0.12;                // l'effet s'atténue en vol (par seconde)
const BOUNCE_E = 0.58;                  // restitution verticale sur l'herbe
const BOUNCE_F = 0.8;                   // perte de vitesse horizontale à chaque rebond
const ROLL_DEC = 1.7;                   // décélération du ballon qui roule (m/s²)
export const GOAL_HALF = 3.66, BAR = 2.44, POST_R = 0.06, NET_D = 2.0;

export function createBall(x = PITCH_L / 2, y = PITCH_W / 2) {
  return { x, y, z: R, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, rolling: true, inGoal: 0, hitPost: false, rot: { a: 0, b: 0 } };
}

export const speedOf = (b) => Math.hypot(b.vx, b.vy, b.vz);

/** Avance la simulation de dt secondes (sous-pas de 1/240 s). opts.noBounce : pour le solveur. */
export function stepBall(b, dt, opts = {}) {
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) sub(b, h, opts);
}

function sub(b, h, opts) {
  const air = b.z > R + 0.002 || b.vz > 0.05;
  if (air) {
    const v = Math.hypot(b.vx, b.vy, b.vz);
    let ax = -K_DRAG * v * b.vx, ay = -K_DRAG * v * b.vy, az = -G - K_DRAG * v * b.vz;
    // Magnus : rotation verticale (spin) → force latérale ; rotation horizontale (top) → portance / plongée.
    ax += K_MAGNUS * -b.spin * b.vy;
    ay += K_MAGNUS * b.spin * b.vx;
    az += K_MAGNUS * b.top * Math.hypot(b.vx, b.vy);
    b.vx += ax * h; b.vy += ay * h; b.vz += az * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    const dec = Math.exp(-SPIN_DECAY * h);
    b.spin *= dec; b.top *= dec;
    b.rolling = false;
    if (b.z < R) {
      if (opts.noBounce) return;
      b.z = R;
      if (-b.vz > 0.9) {
        b.vz = -b.vz * BOUNCE_E;
        b.vx *= Math.min(0.97, BOUNCE_F * (b.skidK || 1)); b.vy *= Math.min(0.97, BOUNCE_F * (b.skidK || 1)); // pelouse mouillée : rebond rasant
        // L'effet « mord » l'herbe : il dévie un peu le rebond puis s'use.
        b.vx += -b.spin * 0.01 * b.vy; b.vy += b.spin * 0.01 * b.vx;
        b.spin *= 0.5; b.top *= 0.3;
      } else { b.vz = 0; b.rolling = true; }
    }
  } else {
    // Au sol : roulement (résistance de l'herbe + un peu d'air).
    b.z = R; b.vz = 0; b.rolling = true;
    const v = Math.hypot(b.vx, b.vy);
    if (v < 0.05) { b.vx = b.vy = 0; } else {
      const dec = Math.min(v, (ROLL_DEC * (b.rollK || 1) + K_DRAG * v * v) * h); // pluie : le ballon fuse ; neige : il freine
      b.vx -= (b.vx / v) * dec; b.vy -= (b.vy / v) * dec;
      // Un ballon qui roule avec de l'effet tourne légèrement.
      b.vx += -b.spin * 0.002 * b.vy * h * 60; b.vy += b.spin * 0.002 * b.vx * h * 60;
      b.spin *= Math.exp(-2 * h);
    }
    b.x += b.vx * h; b.y += b.vy * h;
  }
  // Rotation visuelle (le ballon roule sur lui-même).
  b.rot.a += (Math.hypot(b.vx, b.vy) / R) * h;
  b.rot.b = Math.atan2(b.vy, b.vx);
  if (!opts.noFrame) frame(b);
}

/** Poteaux, transversale, filets, panneaux. */
function frame(b) {
  for (const gx of [0, PITCH_L]) {
    const dir = gx === 0 ? -1 : 1;               // vers l'extérieur du terrain
    // Poteaux : cylindres verticaux.
    for (const py of [PITCH_W / 2 - GOAL_HALF, PITCH_W / 2 + GOAL_HALF]) {
      if (b.z > BAR + R) continue;
      const dx = b.x - gx, dy = b.y - py, d = Math.hypot(dx, dy), min = R + POST_R;
      if (d < min && d > 1e-6) collide(b, dx / d, dy / d, 0, min - d, 0.75);
    }
    // Transversale : cylindre horizontal le long de Y.
    if (Math.abs(b.y - PITCH_W / 2) < GOAL_HALF) {
      const dx = b.x - gx, dz = b.z - BAR, d = Math.hypot(dx, dz), min = R + POST_R;
      if (d < min && d > 1e-6) collide(b, dx / d, 0, dz / d, min - d, 0.7);
    }
    // Dans le but : on entre si on franchit la ligne entre les poteaux, sous la barre.
    const behind = (b.x - gx) * dir;           // distance derrière la ligne
    if (behind > 0 && behind < NET_D + 1 && Math.abs(b.y - PITCH_W / 2) < GOAL_HALF && b.z < BAR) {
      if (!b.inGoal) b.inGoal = gx === 0 ? -1 : 1;
    }
    if (b.inGoal === (gx === 0 ? -1 : 1)) {
      // Filet du fond, filets latéraux, toit : ils absorbent l'énergie.
      if (behind > NET_D - R) { b.x = gx + dir * (NET_D - R); b.vx *= -0.12; b.vy *= 0.45; b.vz *= 0.45; b.spin = 0; }
      const lat = b.y - PITCH_W / 2;
      if (Math.abs(lat) > GOAL_HALF - R) { b.y = PITCH_W / 2 + Math.sign(lat) * (GOAL_HALF - R); b.vy *= -0.15; b.vx *= 0.6; }
      if (b.z > BAR - R) { b.z = BAR - R; b.vz = -Math.abs(b.vz) * 0.2; b.vx *= 0.6; }
      if (behind < R && b.vx * dir < 0) { b.vx = 0; } // ne ressort pas du but
    }
  }
  // Panneaux publicitaires autour du terrain.
  if (b.x < -5 || b.x > PITCH_L + 5) { b.x = Math.max(-5, Math.min(PITCH_L + 5, b.x)); b.vx *= -0.35; b.vy *= 0.6; }
  if (b.y < -4 || b.y > PITCH_W + 4) { b.y = Math.max(-4, Math.min(PITCH_W + 4, b.y)); b.vy *= -0.35; b.vx *= 0.6; }
}

function collide(b, nx, ny, nz, pen, e) {
  b.x += nx * pen; b.y += ny * pen; b.z += nz * pen;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vz -= (1 + e) * vn * nz;
    b.spin *= 0.4;
    b.hitPost = true;
  }
}

/** Copie légère (pour prédire sans toucher au vrai ballon). */
export const cloneBall = (b) => ({ ...b, rot: { ...b.rot } });

/** Position prévue du ballon dans t secondes. */
export function predict(b, t) {
  const c = cloneBall(b);
  stepBall(c, t);
  return c;
}

/**
 * Frappe : règle la vitesse (et l'effet) du ballon pour atteindre la cible.
 *  mode 'ground' : ballon à ras de terre qui arrive avec la vitesse `arrive` (m/s).
 *  mode 'air'    : ballon qui passe par la cible (x, y, z) au bout de T secondes.
 * Retourne le temps de trajet prévu (s).
 */
export function solveKick(b, target, { mode = 'air', T = 1, arrive = 4, spin = 0, top = 0 } = {}) {
  b.spin = spin; b.top = top; b.inGoal = 0; b.hitPost = false;
  const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy) || 0.01;
  if (mode === 'ground') {
    b.z = R; b.vz = 0; b.spin = spin * 0.3; b.top = 0;
    const ux = dx / d, uy = dy / d;
    // Vitesse de départ (dichotomie) : le ballon doit franchir d avec la vitesse `arrive`.
    const run = (v0) => {
      const c = { ...b, vx: ux * v0, vy: uy * v0, rot: { a: 0, b: 0 } };
      let trav = 0, t = 0;
      while (trav < d && t < 10 && Math.hypot(c.vx, c.vy) > 0.06) {
        const px = c.x, py = c.y;
        stepBall(c, 1 / 120, { noFrame: true });
        trav += Math.hypot(c.x - px, c.y - py); t += 1 / 120;
      }
      return { ok: trav >= d, v: Math.hypot(c.vx, c.vy), t };
    };
    let lo = arrive, hi = 45, v0 = hi, t = 0;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2, r = run(mid);
      if (!r.ok || r.v < arrive) lo = mid; else { hi = mid; v0 = mid; t = r.t; }
    }
    if (!t) t = run(v0).t;
    b.vx = ux * v0; b.vy = uy * v0;
    return t;
  }
  // En l'air : estimation balistique puis corrections (traînée, Magnus).
  const tz = target.z ?? R;
  let vx = dx / T, vy = dy / T, vz = (tz - b.z + 0.5 * G * T * T) / T;
  for (let it = 0; it < 10; it++) {
    const c = { ...b, vx, vy, vz, rot: { a: 0, b: 0 } };
    stepBall(c, T, { noBounce: true, noFrame: true });
    const ex = target.x - c.x, ey = target.y - c.y, ez = tz - c.z;
    if (Math.abs(ex) + Math.abs(ey) + Math.abs(ez) < 0.02) break;
    vx += ex / T; vy += ey / T; vz += ez / T;
  }
  b.vx = vx; b.vy = vy; b.vz = vz; b.rolling = false;
  if (b.z <= R) b.z = R + 0.003;
  return T;
}
