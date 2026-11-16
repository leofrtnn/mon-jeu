import { roleFx } from '../data/constants.js';
/**
 * Positions continues des joueurs sur le terrain (coordonnées absolues 0..1).
 * Partagé par le moteur (choix des receveurs/défenseurs selon les distances
 * réelles et l'espace libre) et par le rendu (cibles de déplacement).
 */
const MENT_SHIFT = { defensive: -0.04, balanced: 0, offensive: 0.04 };
const WIDTH_K = { low: 0.85, mid: 1, high: 1.12 };

/**
 * Position d'un joueur selon formation, rôle, phase de jeu et ballon.
 * t : équipe du match ; mp : joueur ; (bx, by) : ballon (absolu) ; inPoss : son équipe a le ballon.
 */
export function formationPos(t, mp, bx, by, inPoss, kickoff = false) {
  const s = t.slots[mp.slot];
  const role = t.roles?.[mp.slot] || 'std';
  const fx = roleFx(role);
  const bd = t.side === 0 ? bx : 1 - bx;
  const bl = t.side === 0 ? by : 1 - by;
  let depth, lat;
  if (kickoff) {
    depth = s.pos === 'GB' ? 0.03 : Math.min(0.47, 0.06 + s.x * 0.52);
    lat = s.y;
  } else if (s.pos === 'GB') {
    depth = 0.025 + Math.max(0, bd - 0.4) * 0.14 + (bd > 0.35 ? (inPoss ? fx.dIn || 0 : fx.dOut || 0) : 0);
    lat = 0.5 + (bl - 0.5) * 0.18;
  } else {
    // Bloc compact : ~30 m entre la défense et l'attaque sans ballon, ~38 m avec (au lieu de 41 m figés).
    const span = inPoss ? 0.62 : 0.5;
    depth = 0.4 + (s.x - 0.5) * span + (bd - 0.5) * 0.48 + (inPoss ? 0.07 : -0.05) + (MENT_SHIFT[t.tactics.mentality] || 0);
    depth += inPoss ? fx.dIn || 0 : fx.dOut || 0;   // rôle : monte, décroche, presse, couvre
    // Ligne défensive (sans ballon) et consignes individuelles (avec ballon).
    if (!inPoss) depth += { low: -0.05, mid: 0, high: 0.05 }[t.tactics.line] || 0;
    const pi = t.pi?.[mp.slot];
    if (inPoss && pi) {
      depth += { def: -0.05, sup: 0, att: 0.05 }[pi.duty] || 0;
      depth += { stay: -0.04, normal: 0, join: 0.04 }[pi.runs] || 0;
    }
    // Latéraux : montées (avec ballon) selon la consigne.
    if (inPoss && (s.pos === 'DG' || s.pos === 'DD')) depth += { stay: -0.05, normal: 0, join: 0.11 }[t.tactics.overlap] || 0;
    // Contre-attaque : les attaquants restent haut quand on défend, prêts à partir.
    if (!inPoss && t.tactics.counter === 'on' && ['BU', 'AG', 'AD'].includes(s.pos)) depth += 0.06;
    const pull = inPoss ? 0.12 : 0.3;
    lat = 0.5 + (s.y - 0.5) * (inPoss ? (WIDTH_K[t.tactics.width] || 1) * ((s.pos === 'DG' || s.pos === 'DD') && t.tactics.overlap === 'join' ? 1.12 : 1) : 0.82);
    // Rôle : rentre dans l'axe (latéral inversé, ailier intérieur…) ou écarte (mezzala, débordeur).
    if (inPoss && fx.narrow) lat = 0.5 + (lat - 0.5) * (1 - fx.narrow);
    lat += (bl - lat) * pull;
    // Distances au ballon : sans ballon, les attaquants redescendent (sauf consigne de contre) et
    // la défense ne recule pas à plus de ~40 m derrière le jeu ; avec ballon, la défense remonte
    // derrière l'attaque et personne ne part à plus de ~32 m devant le ballon.
    const att = ['BU', 'AG', 'AD', 'MO'].includes(s.pos);
    if (!inPoss) depth = Math.min(depth, bd + (att && t.tactics.counter === 'on' ? 0.27 : att ? 0.19 : 0.12));
    else depth = Math.min(depth, bd + 0.3);
    depth = Math.max(depth, bd - (inPoss ? 0.42 : 0.38));
    depth = Math.max(bd < 0.2 ? 0.05 : 0.1, Math.min(0.93, depth));
  }
  lat = Math.max(0.03, Math.min(0.97, lat));
  return t.side === 0 ? { x: depth, y: lat } : { x: 1 - depth, y: 1 - lat };
}

/** Distance "terrain" (le terrain est plus long que large : y pondéré). */
export const pitchDist = (a, b) => { const dx = a.x - b.x, dy = (a.y - b.y) * 0.65; return Math.sqrt(dx * dx + dy * dy); };
