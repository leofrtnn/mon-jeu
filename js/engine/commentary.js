/**
 * Commentaires en direct (français). Plusieurs dizaines de phrases par type
 * d'événement, combinées avec des fragments pour éviter les répétitions.
 * Placeholders : {p} joueur, {p2} second joueur, {t} équipe, {o} adversaire,
 * {s} score, {x} valeur.
 */

const T = {
  kickoff: [
    "C'est parti ! {t} donne le coup d'envoi.", "L'arbitre siffle, {t} engage.", "Coup d'envoi donné par {p}.",
    "Le ballon roule ! {t} a l'engagement.", "Et c'est lancé ! {p} touche le premier ballon.",
    "{t} engage, le public pousse déjà.", "On repart, {p} donne le coup d'envoi.",
  ],
  pass: [
    "{p} trouve {p2}.", "{p} décale {p2}.", "Passe propre de {p} vers {p2}.", "{t} fait tourner, {p} pour {p2}.",
    "{p} temporise puis sert {p2}.", "Une-deux entre {p} et {p2}.", "{p} joue simple avec {p2}.",
    "{t} conserve le ballon, {p} à la baguette.", "Circulation patiente de {t}.", "{p} cherche {p2} entre les lignes.",
    "{p} oriente le jeu vers {p2}.", "Petit jeu entre {p} et {p2}.", "{p} lève la tête et trouve {p2}.",
    "{t} construit depuis l'arrière.", "Bonne remise de {p} pour {p2}.", "{p} casse une ligne d'une passe vers {p2} !",
    "{t} monopolise le ballon.", "{p} donne dans la course de {p2}.", "Passe en retrait de {p} pour {p2}.",
    "Joli mouvement collectif de {t}.",
  ],
  longpass: [
    "Long ballon de {p} vers {p2}.", "{p} renverse le jeu sur {p2}.", "Transversale de {p}, contrôlée par {p2}.",
    "{p} cherche directement {p2} dans la profondeur.", "Ouverture lumineuse de {p} pour {p2} !",
    "Jeu long de {t}, {p2} récupère.", "{p} allonge vers {p2}.", "Ballon par-dessus la défense de {p} pour {p2} !",
    "{p} change d'aile, {p2} est servi.", "Dégagement de {p} vers {p2}.",
  ],
  dribble: [
    "{p} élimine {p2} !", "Crochet de {p}, {p2} est dans le vent.", "{p} accélère et laisse {p2} sur place.",
    "Petit pont de {p} sur {p2} !", "{p} fait parler sa technique face à {p2}.", "{p} déborde {p2}.",
    "Quel dribble de {p} !", "{p} efface {p2} d'un contrôle orienté.", "{p} résiste à la charge de {p2} et file.",
    "{p} provoque et passe {p2}.", "Feinte de corps de {p}, {p2} est battu.", "{p} part balle au pied !",
    "Grosse percussion de {p}.", "{p} s'infiltre, {p2} ne peut suivre.", "Roulette de {p} ! {p2} est mystifié.",
  ],
  tackle: [
    "{p} récupère le ballon dans les pieds de {p2}.", "Tacle propre de {p} sur {p2}.", "{p} ferme la porte à {p2}.",
    "Bien joué par {p}, qui stoppe {p2}.", "{p} gagne son duel face à {p2}.", "Intervention autoritaire de {p}.",
    "{p} chipe le ballon à {p2}.", "{p2} perd le ballon face à {p}.", "{p} remporte le duel.", "Récupération haute de {p} !",
    "{p} anticipe et coupe la trajectoire.", "Tacle glissé parfait de {p} !",
  ],
  interception: [
    "{p} intercepte.", "Passe interceptée par {p}.", "{p} lit parfaitement le jeu.", "{p} coupe la passe.",
    "Ballon perdu par {t}, {p} récupère.", "{p} s'interpose.", "Mauvaise passe, {p} en profite.",
    "{p} sent le coup et intercepte.", "Le ballon est récupéré par {p}.", "{p} met le pied au bon moment.",
  ],
  header: [
    "{p} gagne le duel aérien.", "Tête défensive de {p}.", "{p} s'impose dans les airs.", "{p} remporte le ballon de la tête.",
    "Duel aérien pour {p}.", "{p} repousse de la tête.",
  ],
  cross: [
    "Centre de {p} vers {p2}…", "{p} centre au second poteau !", "{p} envoie un centre tendu.", "{p} déborde et centre !",
    "Centre en retrait de {p}.", "{p} adresse un ballon dans la surface.", "Centre dangereux de {p} !",
    "{p} cherche la tête de {p2}.", "Centre brossé de {p}.", "{p} met le ballon devant le but !",
  ],
  clearance: [
    "{p} dégage en catastrophe.", "Dégagement de {p}.", "{p} écarte le danger.", "{p} repousse le ballon.",
    "{p} sauve les meubles.", "La défense tient bon, {p} dégage.", "{p} renvoie loin devant.", "Coup de tête salvateur de {p}.",
  ],
  clearance_second: [
    "{p} repousse mais le second ballon revient à {t}.", "Dégagement trop court de {p}, {t} récupère.",
    "{p} dégage dans l'axe, {t} reprend possession.",
  ],
  offside: [
    "Hors-jeu de {p}.", "Le drapeau se lève, {p} était hors-jeu.", "{p} part trop tôt, hors-jeu.",
    "Hors-jeu signalé contre {p}.", "{p} est pris au piège du hors-jeu.", "La défense remonte bien, {p} est hors-jeu.",
  ],
  foul: [
    "Faute de {p} sur {p2}.", "{p} accroche {p2}.", "{p} déséquilibre {p2}, coup de sifflet.", "Coup franc : {p} a fauché {p2}.",
    "{p} arrive en retard sur {p2}.", "Faute de {p}, l'arbitre siffle.", "{p} retient {p2} par le maillot.",
    "{p2} est mis au sol par {p}.", "Charge irrégulière de {p}.", "{p} fait faute pour stopper {p2}.",
    "Tacle par derrière de {p} sur {p2}.", "{p2} s'écroule après le contact avec {p}.",
  ],
  yellow: [
    "Carton jaune pour {p}.", "{p} est averti.", "L'arbitre sort le jaune pour {p}.", "Avertissement pour {p}.",
    "{p} voit jaune.", "{p} écope d'un carton jaune.", "Jaune mérité pour {p}.", "{p} rejoint la liste des avertis.",
    "{p} est sanctionné d'un carton jaune.", "L'arbitre n'hésite pas : jaune pour {p}.",
  ],
  red_direct: [
    "CARTON ROUGE ! {p} est expulsé !", "Rouge direct pour {p} ! {t} va finir à dix.", "{p} est renvoyé aux vestiaires !",
    "L'arbitre sort le rouge ! {p} doit quitter le terrain.", "Expulsion de {p} ! Énorme coup dur pour {t}.",
  ],
  red_second: [
    "Deuxième jaune pour {p}… c'est le rouge !", "{p} prend un second avertissement et sort !",
    "Double peine pour {p}, expulsé !", "{p} récidive : deuxième jaune, rouge !",
  ],
  injury: [
    "{p} se tord de douleur… il ne peut pas continuer.", "Blessure pour {p}, les soigneurs entrent.",
    "{p} se tient la cuisse, mauvaise nouvelle pour {t}.", "Coup dur : {p} est touché.", "{p} sort sur blessure.",
    "{p} reste au sol, ça ne sent pas bon.", "Le staff médical s'occupe de {p}.",
  ],
  sub: [
    "Changement pour {t} : {p} remplace {p2}.", "{p} entre en jeu à la place de {p2}.", "{p2} cède sa place à {p}.",
    "{t} effectue un changement : {p} pour {p2}.", "Sortie de {p2}, entrée de {p}.", "{p} fait son entrée, {p2} est applaudi.",
  ],
  corner: [
    "Corner pour {t}.", "{t} obtient un corner.", "Corner, {p} va le tirer.", "Encore un corner pour {t} !",
    "{p} file vers le poteau de corner.", "Corner à suivre pour {t}.",
  ],
  cornerkick: [
    "{p} tire le corner…", "Corner frappé par {p}.", "{p} enroule son corner.", "Le corner de {p} arrive dans la surface…",
  ],
  freekick: [
    "Coup franc bien placé pour {t}.", "Coup franc dangereux pour {t} !", "{p} pose le ballon pour le coup franc.",
    "Coup franc à 25 mètres pour {t}.", "{t} obtient un coup franc intéressant.",
  ],
  penalty: [
    "PENALTY pour {t} !", "L'arbitre désigne le point de penalty !", "Penalty ! {p} va le tirer.",
    "C'est penalty ! {t} a l'occasion rêvée.", "Faute dans la surface : penalty pour {t} !",
  ],
  shot_saved: [
    "Frappe de {p}… arrêt de {p2} !", "{p2} s'interpose devant {p} !", "Quelle parade de {p2} sur la tentative de {p} !",
    "{p} tente sa chance, {p2} capte.", "Tir cadré de {p}, {p2} veille.", "{p2} détourne la frappe de {p} !",
    "Arrêt réflexe de {p2} !", "{p} frappe fort, {p2} repousse !", "{p2} sort le grand jeu face à {p} !",
    "{p} ajuste, mais {p2} est sur la trajectoire.", "Superbe envolée de {p2} !", "{p2} bloque en deux temps.",
    "{p} croise, {p2} se détend !", "Le gardien {p2} sauve son équipe !", "{p2} claque le ballon au-dessus !",
  ],
  shot_wide: [
    "{p} tente sa chance… à côté.", "Frappe de {p}, ça passe au-dessus.", "{p} manque le cadre.", "Tentative de {p}, non cadrée.",
    "{p} enroule, mais c'est trop large.", "{p} dévisse complètement sa frappe.", "{p} frappe… dans les nuages.",
    "Ça frôle le poteau ! {p} n'était pas loin.", "{p} tente de loin, sans danger.", "Occasion manquée par {p} !",
    "{p} se précipite et rate le cadre.", "Frappe trop enlevée de {p}.", "{p} ne cadre pas, dommage pour {t}.",
    "{p} reprend de volée… à côté !", "{p} n'arrive pas à cadrer.",
  ],
  shot_blocked: [
    "Frappe de {p}, contrée par {p2}.", "{p2} se jette et bloque la tentative de {p}.", "Tir de {p} dévié par {p2}.",
    "{p} frappe, mais {p2} s'interpose.", "Contre de {p2} sur la frappe de {p}.", "La défense fait bloc devant {p}.",
    "{p} tente, {p2} contre.", "Le tir de {p} est repoussé par la défense.",
  ],
  shot_post: [
    "POTEAU ! {p} n'a pas eu de chance !", "Sur le poteau ! {p} y était presque !", "La barre ! Quelle frappe de {p} !",
    "{p} trouve le montant !", "Le poteau sauve {o} sur la frappe de {p} !", "Ça tape la transversale ! {p} se prend la tête.",
  ],
  header_shot: [
    "Tête de {p} !", "{p} s'élève plus haut que tout le monde…", "Reprise de la tête de {p} !", "{p} smashe de la tête…",
  ],
  goal: [
    "BUUUUT ! {p} fait trembler les filets !", "BUT ! {p} marque pour {t} !", "GOOOAL ! {p} ne tremble pas !",
    "Et c'est le but ! {p} trompe le gardien !", "BUT ! Quelle finition de {p} !", "{p} marque ! {s}",
    "BUT ! {p} conclut une belle action !", "Le stade explose ! {p} a marqué !", "{p} pousse le ballon au fond ! BUT !",
    "BUT ! {p} ajuste le gardien !", "Imparable ! {p} marque !", "C'est au fond ! {p} pour {t} !",
    "BUT ! {p} crucifie {o} !", "Quelle frappe ! {p} lucarne !", "BUT ! {p} est à la conclusion !",
    "Plat du pied sécurité, {p} marque !", "BUT ! {p} se joue de la défense et marque !", "{p} trouve le chemin des filets !",
    "BUT ! La défense de {o} est prise de vitesse, {p} conclut !", "{p} ne laisse aucune chance au gardien ! BUT !",
  ],
  goal_header: [
    "BUT DE LA TÊTE ! {p} s'envole !", "Coup de casque de {p}, BUT !", "{p} place sa tête… BUT !", "Tête rageuse de {p}, c'est au fond !",
    "BUT ! {p} reprend de la tête, imparable !",
  ],
  goal_penalty: [
    "Penalty transformé par {p} !", "{p} ne tremble pas : BUT sur penalty !", "Contre-pied parfait de {p} !",
    "{p} prend le gardien à contre-pied ! BUT !", "Penalty en force de {p}, but !",
  ],
  goal_freekick: [
    "COUP FRANC DIRECT ! {p} enroule dans la lucarne !", "BUT sur coup franc ! {p} est un artiste !",
    "{p} brosse le coup franc, c'est au fond !", "Coup franc magistral de {p} ! BUT !",
  ],
  penalty_miss: ["{p} rate son penalty !", "Penalty arrêté ! Le gardien a deviné le côté de {p} !", "{p} manque le cadre sur penalty !"],
  var_confirmed: ["VAR : le but est validé !", "Après vérification, le but est accordé.", "La VAR confirme la décision de l'arbitre."],
  var_cancelled: ["VAR : but refusé !", "L'arbitre consulte la VAR… le but est annulé !", "Douche froide : la VAR annule tout !"],
  var_pen_cancelled: ["VAR : le penalty est annulé !", "Après visionnage, pas de penalty."],
  var_pen_confirmed: ["VAR : le penalty est confirmé."],
  added: ["{x} minute(s) de temps additionnel.", "Le 4e arbitre annonce {x} minute(s) supplémentaires.", "Il reste {x} minute(s) à jouer dans le temps additionnel."],
  ht: ["C'est la mi-temps ! {s}", "L'arbitre siffle la pause. {s}", "Mi-temps sur le score de {s}.", "Les joueurs rentrent aux vestiaires : {s}."],
  et: ["Égalité au bout du temps réglementaire : place à la prolongation ! {s}", "On jouera 30 minutes de plus ! {s}", "Prolongation ! Les organismes vont souffrir. {s}"],
  eht: ["Fin de la première période de prolongation. {s}", "On change de côté pour les 15 dernières minutes. {s}"],
  ft: ["C'est terminé ! {s}", "Coup de sifflet final ! {s}", "Fin du match : {s}.", "L'arbitre met fin à la rencontre. {s}"],
};

const COUNTER = ["Contre-attaque !", "Ça part en contre !", "Transition rapide !", "Attention au contre !"];
const ASSIST = [" Passe décisive de {p2}.", " Servi par {p2}.", " Sur un service de {p2}.", " Grâce à une offrande de {p2}."];

let lastIdx = {};
/** Choix d'une phrase en évitant de répéter la dernière. */
function pick(type, r) {
  const arr = T[type];
  if (!arr) return '';
  let i = Math.floor(r() * arr.length);
  if (arr.length > 1 && lastIdx[type] === i) i = (i + 1) % arr.length;
  lastIdx[type] = i;
  return arr[i];
}

function fill(s, v) {
  return s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
}

/**
 * Texte de commentaire d'un événement, ou null si l'événement ne mérite pas de ligne.
 * names : (id) => nom du joueur ; teams : [nom0, nom1]
 * opts.verbose : commenter aussi des actions de construction (aléatoirement).
 */
export function describe(ev, ctx, r = Math.random, opts = {}) {
  const team = ev.side >= 0 ? ctx.teams[ev.side] : '';
  const opp = ev.side >= 0 ? ctx.teams[1 - ev.side] : '';
  const v = { p: ctx.name(ev.pid), p2: ctx.name(ev.pid2), t: team, o: opp, x: ev.value,
    s: `${ctx.teams[0]} ${ev.score[0]}-${ev.score[1]} ${ctx.teams[1]}` };
  let type = ev.type;
  switch (ev.type) {
    case 'shot':
      if (ev.outcome === 'goal') return null; // l'événement 'goal' suit
      if (ev.kind === 'penalty' && ev.outcome !== 'goal') type = 'penalty_miss';
      else type = 'shot_' + ev.outcome;
      if (ev.kind === 'header' && r() < 0.6) return fill(pick('header_shot', r), v) + ' ' + fill(pick(type, r), v);
      break;
    case 'goal': {
      type = ev.kind === 'header' ? 'goal_header' : ev.kind === 'penalty' ? 'goal_penalty' : ev.kind === 'freekick' ? 'goal_freekick' : 'goal';
      let s = fill(pick(type, r), v);
      if (ev.pid2) s += fill(ASSIST[Math.floor(r() * ASSIST.length)], v);
      return s;
    }
    case 'red': type = ev.kind === 'second' ? 'red_second' : 'red_direct'; break;
    case 'var':
      type = ev.reason === 'penalty' ? (ev.outcome === 'cancelled' ? 'var_pen_cancelled' : 'var_pen_confirmed')
        : (ev.outcome === 'cancelled' ? 'var_cancelled' : 'var_confirmed');
      break;
    case 'clearance': if (ev.second) type = 'clearance_second'; else if (!opts.verbose || r() > 0.5) return null; break;
    case 'freekick': if (!ev.direct && r() > 0.5) return null; break;
    case 'pass': case 'longpass': case 'dribble': case 'tackle': case 'interception': case 'header': case 'cross': case 'cornerkick': case 'offside': case 'foul': {
      if (!opts.verbose) return null;
      const keep = { pass: 0.06, longpass: 0.2, dribble: 0.35, tackle: 0.25, interception: 0.18, header: 0.15, cross: 0.4, cornerkick: 0.5, offside: 0.8, foul: 0.55 }[ev.type];
      if (r() > keep) return null;
      if ((ev.type === 'tackle' || ev.type === 'interception') && ev.counter) return fill(pick(ev.type, r), v) + ' ' + COUNTER[Math.floor(r() * COUNTER.length)];
      break;
    }
    case 'corner': if (!opts.verbose && r() > 0.5) return null; break;
    default: break;
  }
  if (!T[type]) return null;
  return fill(pick(type, r), v);
}

/** Icône associée à un type d'événement (fil de commentaires). */
export function iconFor(ev) {
  switch (ev.type) {
    case 'goal': return '⚽';
    case 'yellow': return '🟨';
    case 'red': return '🟥';
    case 'injury': return '✚';
    case 'sub': return '⇄';
    case 'var': return '📺';
    case 'penalty': return '◎';
    case 'shot': return ev.outcome === 'post' ? '▮' : ev.outcome === 'saved' ? '🧤' : '•';
    case 'ht': case 'ft': case 'et': case 'eht': case 'kickoff': return '⏱';
    case 'corner': case 'cornerkick': return '⚑';
    default: return '·';
  }
}
