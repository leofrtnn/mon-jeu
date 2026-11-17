/**
 * Débrief individuel d'après-match : un mot du coach à un joueur (féliciter, encourager,
 * recadrer). La réaction dépend de sa note du soir et de sa personnalité ; elle touche son
 * moral et un peu sa forme pour le match suivant.
 */
import { clamp } from '../core/rng.js';
import { pers, persInfo } from './people.js';

export const DEBRIEF = {
  praise: { icon: '👏', label: 'Féliciter' },
  encourage: { icon: '💪', label: 'Encourager' },
  criticize: { icon: '☝', label: 'Recadrer' },
};

/** Applique le mot du coach. `rating` = note du match. Renvoie { delta, text, tone }. */
export function debriefPlayer(p, kind, rating) {
  const P = pers(p), sens = persInfo(p)?.sens ?? 1;
  const first = p.name.split(' ').slice(-1)[0];
  let d = 0, text = '';
  const good = rating >= 7, bad = rating < 6.2;
  if (kind === 'praise') {
    if (good) { d = 6; text = `${first} apprécie : « Merci coach, on continue comme ça. »`; }
    else if (bad) { d = P === 'ambitious' || P === 'leader' ? -2 : 1; text = d < 0 ? `${first} reste lucide : « J'ai été moyen ce soir, pas la peine de me ménager. »` : `${first} sourit, un peu gêné après un match moyen.`; }
    else { d = 3; text = `${first} est content qu'on remarque son travail.`; }
  } else if (kind === 'encourage') {
    if (bad) { d = 4; text = `${first} relève la tête : « Je vais me rattraper. »`; }
    else { d = 2; text = `${first} hoche la tête, motivé.`; }
  } else if (kind === 'criticize') {
    if (good) { d = -8; text = `${first} ne comprend pas : « J'ai fait un bon match ! » Il le prend très mal.`; }
    else if (P === 'leader' || P === 'ambitious') { d = bad ? 3 : -1; text = bad ? `${first} accepte la critique : « Vous avez raison, je dois être meilleur. »` : `${first} trouve la remarque sévère, mais l'encaisse.`; }
    else if (P === 'sensitive' || P === 'rebel') { d = P === 'rebel' ? -7 : -5; text = P === 'rebel' ? `${first} s'emporte : « Regardez plutôt vos choix tactiques ! »` : `${first} baisse les yeux, touché par vos mots.`; }
    else { d = bad ? 1 : -3; text = bad ? `${first} prend note sans broncher.` : `${first} semble agacé par la remarque.`; }
  }
  const delta = Math.round(d * (d < 0 ? sens : Math.min(1.2, sens)));
  p.morale = clamp((p.morale ?? 60) + delta, 5, 99);
  if (delta >= 3) p.form = clamp((p.form ?? 50) + 2, 5, 95);
  if (delta <= -5) p.form = clamp((p.form ?? 50) - 2, 5, 95);
  return { delta, text, tone: delta > 0 ? 'good' : delta < 0 ? 'bad' : 'info' };
}
