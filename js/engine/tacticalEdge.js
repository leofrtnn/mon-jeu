/**
 * DUEL TACTIQUE
 * ------------------------------------------------------------------
 * Une équipe n'est pas meilleure juste parce qu'elle a de meilleurs joueurs : il faut que
 * son plan de jeu convienne à ses joueurs, et qu'il réponde à celui de l'adversaire.
 *
 * Chaque minute, on calcule pour chaque équipe un « avantage tactique » (-0,3 … +0,3) :
 *  - adéquation plan / joueurs : pressing haut avec des joueurs sans coffre, passes courtes
 *    sans bons passeurs, ligne haute avec des défenseurs lents, contre-attaque sans vitesse…
 *  - confrontation des plans : contre-attaque rapide contre une ligne haute, pressing haut
 *    contre une relance courte maladroite, bloc bas contre une équipe qui ne sait pas
 *    déborder, jeu direct qui saute un pressing, centres contre une défense petite, etc.
 * Cet avantage multiplie le rendement de toute l'équipe (voir refreshMultipliers) : une
 * équipe bien organisée peut battre largement une équipe plus forte sur le papier.
 */
const LV = { low: -1, mid: 0, high: 1 };
const MT = { defensive: -1, balanced: 0, offensive: 1 };

const GROUPS = { D: ['DC', 'DG', 'DD'], CB: ['DC'], FB: ['DG', 'DD'], M: ['MDC', 'MC', 'MO'], F: ['BU', 'AG', 'AD'], W: ['AG', 'AD', 'DG', 'DD'], ST: ['BU'] };

/** Moyenne d'un attribut sur un groupe de postes (joueurs encore sur le terrain). */
function avg(t, group, attr) {
  let s = 0, n = 0;
  for (const mp of t.onPitch) {
    if (!mp || !mp.onPitch || mp.red || mp.injured) continue;
    const pos = t.slots[mp.slot]?.pos;
    if (group && !GROUPS[group].includes(pos)) continue;
    s += attr === 'energy' ? mp.energy : mp.p.attrs[attr]; n++;
  }
  return n ? s / n : 60;
}

/** Écart normalisé de deux valeurs d'attributs (≈ -1 … 1). */
const gap = (a, b, scale = 15) => Math.max(-1, Math.min(1, (a - b) / scale));

/**
 * Avantage tactique de A face à D, avec le détail (pour l'écran du match).
 * Retourne { edge, notes: [{ v, text }] } ; v > 0 : à l'avantage de A.
 */
export function tacticalEdge(A, D) {
  const ta = A.tactics, td = D.tactics;
  const notes = [];
  // Adéquation : un plan inadapté coûte cher, un plan adapté rapporte peu (les grosses
  // équipes conviennent à presque tout ; ce n'est pas ce qui doit décider du match).
  let phase = 'fit';
  const add = (v, text) => {
    const w = phase === 'fit' ? (v > 0 ? 0.3 : 1) : 1.2;
    v *= w;
    if (Math.abs(v) >= 0.008) notes.push({ v, text });
  };
  const level = (avg(A, null, 'pas') + avg(A, null, 'def') + avg(A, null, 'phy')) / 3;

  /* --- Adéquation du plan aux joueurs --- */
  const press = LV[ta.pressing] || 0;
  if (press > 0) {
    // Presser haut demande du coffre (physique) et de la fraîcheur.
    const fuel = gap(avg(A, null, 'phy'), 64, 14) * 0.5 + gap(avg(A, null, 'energy'), 75, 20) * 0.5;
    add(0.05 * fuel, fuel >= 0 ? 'Le pressing haut est bien tenu physiquement' : 'Le pressing haut épuise des joueurs qui n\'ont pas le coffre');
  }
  if (ta.passing === 'short') add(0.05 * gap(avg(A, 'M', 'pas'), 66, 12), avg(A, 'M', 'pas') >= 66 ? 'Le jeu court convient à des milieux techniques' : 'Le jeu court est trop exigeant pour ces milieux');
  if ((LV[ta.line] || 0) > 0 || ta.offsideTrap === 'on') {
    const pace = gap(avg(A, 'CB', 'vit'), 66, 12);
    add(0.045 * pace, pace >= 0 ? 'Défenseurs assez rapides pour jouer haut' : 'Ligne haute risquée avec des défenseurs lents');
  }
  if (ta.counter === 'on' || ta.passing === 'direct') add(0.04 * gap(avg(A, 'F', 'vit'), 68, 12), avg(A, 'F', 'vit') >= 68 ? 'Des attaquants rapides pour aller vite vers l\'avant' : 'Jeu vers l\'avant sans vitesse devant');
  if (ta.crossing === 'high') add(0.035 * gap(avg(A, 'ST', 'phy'), 68, 12), avg(A, 'ST', 'phy') >= 68 ? 'Un avant-centre costaud pour les centres' : 'Centres sans cible dans la surface');
  if (ta.dribbling === 'more') add(0.035 * gap(avg(A, 'F', 'dri'), 70, 12), avg(A, 'F', 'dri') >= 70 ? 'Des dribbleurs pour faire la différence' : 'Trop de dribbles ratés');
  if (ta.overlap === 'join') add(0.03 * gap(avg(A, 'FB', 'vit'), 66, 12), avg(A, 'FB', 'vit') >= 66 ? 'Latéraux capables d\'enchaîner les montées' : 'Latéraux trop lents pour monter et revenir');
  if (ta.marking === 'man') add(0.03 * gap(avg(A, 'D', 'def'), 68, 12), 'Marquage individuel ' + (avg(A, 'D', 'def') >= 68 ? 'bien tenu' : 'trop exigeant'));

  /* --- Confrontation des plans --- */
  phase = 'match';
  const lineD = (LV[td.line] || 0) + (td.offsideTrap === 'on' ? 0.5 : 0) + (MT[td.mentality] || 0) * 0.5;
  const goVertical = (ta.counter === 'on' ? 1 : 0) + (ta.passing === 'direct' ? 0.6 : 0);
  if (lineD > 0 && goVertical > 0) {
    const v = 0.06 * lineD * goVertical * (1 + gap(avg(A, 'F', 'vit'), avg(D, 'CB', 'vit'), 12));
    add(v, v >= 0 ? 'Nos contres font mal à leur ligne haute' : 'Leur défense rapide coupe nos contres');
  }
  const pressD = LV[td.pressing] || 0;
  if (pressD > 0) {
    if (ta.passing === 'direct' || ta.gkDist === 'long') add(0.05 * pressD, 'Le jeu long saute leur pressing');
    else if (ta.passing === 'short') {
      const v = 0.05 * pressD * gap(avg(A, 'D', 'pas') * 0.5 + avg(A, 'M', 'pas') * 0.5, 68, 12);
      add(v, v >= 0 ? 'Notre relance courte résiste à leur pressing' : 'Leur pressing étouffe notre relance courte');
    }
  }
  const blockD = (MT[td.mentality] || 0) < 0 && (LV[td.line] || 0) <= 0;
  if (blockD) {
    if ((LV[ta.width] || 0) > 0 || ta.overlap === 'join' || ta.crossing === 'high') add(0.04, 'La largeur et les centres contournent leur bloc bas');
    else if (ta.passing === 'short' && (LV[ta.width] || 0) < 0) add(-0.05, 'Notre jeu étroit bute sur leur bloc bas');
    if (ta.longShots === 'high') add(0.025 * gap(avg(A, 'M', 'tir'), 62, 12), 'Les frappes de loin contre un bloc bas');
  }
  if ((MT[ta.mentality] || 0) < 0 && (LV[ta.line] || 0) <= 0) {
    // Notre bloc bas face à une équipe qui veut le ballon sans dribbleurs ni centres.
    const unlock = (td.crossing === 'high' ? 0.5 : 0) + gap(avg(D, 'F', 'dri'), 70, 12) * 0.5;
    add(0.045 * (0.3 - unlock), unlock < 0.3 ? 'Notre bloc bas les frustre' : 'Ils trouvent des solutions contre notre bloc');
  }
  if ((MT[ta.mentality] || 0) > 0 && (MT[td.mentality] || 0) < 0 && td.counter === 'on') add(-0.04, 'Trop découverts face à leurs contres');
  if (ta.focus && ta.focus !== 'mixed' && ta.focus !== 'center') {
    // Couloir privilégié face à leur latéral le plus faible.
    const fb = D.onPitch.filter((mp) => mp && mp.onPitch && GROUPS.FB.includes(D.slots[mp.slot]?.pos));
    const weak = fb.length ? Math.min(...fb.map((mp) => mp.p.attrs.def)) : 65;
    add(0.03 * gap(66, weak, 12), weak < 66 ? 'On attaque le bon côté' : 'Leur latéral tient bon');
  }
  void level;
  const edge = Math.max(-0.35, Math.min(0.35, notes.reduce((s, n) => s + n.v, 0) * 1.8));
  notes.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  return { edge, notes };
}
