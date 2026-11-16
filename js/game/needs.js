/**
 * Recrutement selon les besoins tactiques : le staff passe l'effectif au crible du système
 * joué (titulaires faibles, doublures manquantes, âge, contrats) et du style demandé
 * (pressing, largeur, ligne haute, coups de pied arrêtés). Chaque besoin propose une recherche.
 */
import { clubPlayers } from './state.js';
import { ratingAt, overall } from '../engine/ratings.js';
import { slotsOf, DEFAULT_TACTICS } from '../data/constants.js';

const POS_LABEL = { GB: 'Gardien', DC: 'Défenseur central', DG: 'Latéral gauche', DD: 'Latéral droit', MDC: 'Milieu défensif', MC: 'Milieu central', MG: 'Milieu gauche', MD: 'Milieu droit', MO: 'Meneur de jeu', AG: 'Ailier gauche', AD: 'Ailier droit', BU: 'Avant-centre' };
const ATT = ['AG', 'AD', 'BU', 'MO'], WIDE = ['DG', 'DD', 'MG', 'MD', 'AG', 'AD'];

/**
 * Liste des besoins, du plus urgent au moins urgent :
 * { key, pos, title, why, level (1-3), search: { pos:[...], ovrMin, ageMax } }
 */
export function squadNeeds(state, club) {
  const t = { ...DEFAULT_TACTICS, ...club.tactics };
  const slots = slotsOf(t);
  const squad = clubPlayers(state, club).filter((p) => !p.loanedOut);
  const byId = new Map(squad.map((p) => [p.id, p]));
  const xi = (club.lineup || []).map((id) => byId.get(id));
  const xiR = xi.map((p, i) => (p ? ratingAt(p, slots[i].pos) : 0));
  const avg = xiR.reduce((a, b) => a + b, 0) / Math.max(1, xiR.filter(Boolean).length);
  const out = [];
  const add = (n) => { if (!out.some((o) => o.key === n.key)) out.push(n); };
  const target = Math.round(avg + 2);

  // Poste par poste, dans le système joué.
  const need = {};
  slots.forEach((s, i) => { (need[s.pos] ||= []).push(i); });
  for (const [pos, idx] of Object.entries(need)) {
    const starters = idx.map((i) => xi[i]).filter(Boolean);
    const weak = idx.filter((i) => xi[i] && xiR[i] < avg - 4);
    if (!starters.length || weak.length) {
      const gap = starters.length ? Math.round(avg - Math.min(...weak.map((i) => xiR[i]))) : 20;
      add({ key: `weak-${pos}`, pos, title: `${POS_LABEL[pos] || pos} titulaire`, level: gap >= 9 ? 3 : 2,
        why: starters.length ? `${weak.map((i) => xi[i].name).join(', ')} : ${gap} points sous le niveau du onze à ce poste.` : 'Personne pour tenir ce poste dans votre système.',
        search: { pos: [pos], ovrMin: Math.max(0, target - 1) } });
    }
    // Doublures : joueurs hors du onze capables de jouer là sans trop baisser le niveau.
    const backups = squad.filter((p) => !club.lineup.includes(p.id) && ratingAt(p, pos) >= avg - 9).length;
    if (backups < idx.length && pos !== 'GB') add({ key: `depth-${pos}`, pos, title: `Doublure ${POS_LABEL[pos] || pos}`, level: 1,
      why: `${backups} remplaçant(s) crédible(s) pour ${idx.length} place(s) : une blessure ou une suspension et le niveau chute.`,
      search: { pos: [pos], ovrMin: Math.max(0, Math.round(avg - 6)), ageMax: 30 } });
    if (pos === 'GB' && backups < 1) add({ key: 'depth-GB', pos, title: 'Gardien remplaçant', level: 1, why: 'Aucun gardien de secours au niveau.', search: { pos: ['GB'], ovrMin: Math.max(0, Math.round(avg - 8)) } });
    // Anticiper : titulaires âgés ou en fin de contrat.
    for (const p of starters) {
      if (p.age >= 32) add({ key: `age-${pos}`, pos, title: `Successeur de ${p.name}`, level: p.age >= 34 ? 2 : 1, why: `${p.name} a ${p.age} ans : préparer la relève à ce poste.`, search: { pos: [pos], ovrMin: Math.max(0, Math.round(avg - 5)), ageMax: 24 } });
      else if ((p.contract ?? 9) <= 1 && !p.onLoanFrom) add({ key: `ctr-${pos}`, pos, title: `${p.name} en fin de contrat`, level: 1, why: 'Il peut partir libre : prolongez-le ou trouvez son remplaçant.', search: { pos: [pos], ovrMin: Math.max(0, Math.round(avg - 3)) } });
      if (p.onLoanFrom) add({ key: `loan-${pos}`, pos, title: `${p.name} n'est que prêté`, level: 1, why: 'Il repartira en fin de saison (option d\'achat possible).', search: { pos: [pos], ovrMin: Math.max(0, Math.round(avg - 3)) } });
    }
  }

  // Style de jeu demandé par vos consignes.
  const at = (list, k) => { const ps = xi.filter((p, i) => p && list.includes(slots[i].pos)); return ps.length ? ps.reduce((a, p) => a + (p.attrs[k] || 0), 0) / ps.length : 99; };
  if (t.pressing === 'high' && at([...ATT, 'MC', 'MDC'], 'phy') < avg - 2) add({ key: 'style-press', pos: 'ATT', title: 'Pressing haut : plus d\'endurance devant', level: 2,
    why: 'Vos attaquants et milieux manquent de coffre pour presser 90 minutes.', search: { pos: ['ATT', 'MC'], ovrMin: Math.max(0, target - 3), ageMax: 28 } });
  if ((t.width === 'high' || t.crossing === 'high') && at(WIDE, 'vit') < avg) add({ key: 'style-wide', pos: 'AG', title: 'Jeu large : des joueurs de couloir rapides', level: 2,
    why: 'Vous jouez par les ailes mais vos joueurs de côté manquent de vitesse.', search: { pos: ['AG', 'AD', 'DG', 'DD'], ovrMin: Math.max(0, target - 3) } });
  if (t.line === 'high' && at(['DC'], 'vit') < avg - 4) add({ key: 'style-line', pos: 'DC', title: 'Ligne haute : un central rapide', level: 2,
    why: 'Défendre haut avec des centraux lents expose aux ballons dans le dos.', search: { pos: ['DC'], ovrMin: Math.max(0, target - 3) } });
  if (t.mentality === 'offensive') {
    const best = Math.max(0, ...xi.filter((p, i) => p && slots[i].pos === 'BU').map((p) => p.attrs.tir || 0));
    if (best && best < avg) add({ key: 'style-fin', pos: 'BU', title: 'Un finisseur', level: 2, why: 'Votre plan offensif crée des occasions, mais votre avant-centre conclut mal.', search: { pos: ['BU'], ovrMin: Math.max(0, target) } });
  }
  // Coups de pied arrêtés.
  const aerial = Math.max(0, ...xi.filter(Boolean).map((p) => p.attrs.phy * 0.6 + p.attrs.tir * 0.2 + p.attrs.def * 0.2));
  if (aerial < 68) add({ key: 'cpa-air', pos: 'DC', title: 'CPA : une menace aérienne', level: 1, why: 'Personne ne domine dans les airs : vos corners rapportent peu.', search: { pos: ['DC', 'BU'], ovrMin: Math.max(0, target - 4) } });
  const deliv = Math.max(0, ...xi.filter(Boolean).map((p) => p.attrs.pas));
  if (deliv < 74) add({ key: 'cpa-taker', pos: 'MO', title: 'CPA : un tireur de corners', level: 1, why: 'Aucun bon centreur pour les coups de pied arrêtés.', search: { pos: ['MO', 'MC', 'AG', 'AD'], ovrMin: Math.max(0, target - 4) } });

  return out.sort((a, b) => b.level - a.level);
}

export { overall };
