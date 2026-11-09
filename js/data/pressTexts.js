/**
 * BANQUE DE TEXTES DE PRESSE (interviews d'après-match, conférences d'avant-match).
 * Variables : {p} joueur, {opp} adversaire, {score}, {club}, {n} série, {star} vedette adverse,
 * {said} déclaration passée, {coach} entraîneur adverse.
 */

/** Journalistes fictifs. */
export const JOURNALISTS = [
  { name: 'Claire Mercier', outlet: 'Onze Matin', type: 'kind' },
  { name: 'Hugo Ferrand', outlet: 'Ballon Hebdo', type: 'neutral' },
  { name: 'Sami Belkadi', outlet: 'Radio Virage', type: 'neutral' },
  { name: 'Marc Delorme', outlet: 'Le Coup Franc', type: 'trap' },
  { name: 'Inès Vidal', outlet: 'Tribune Foot', type: 'trap' },
  { name: 'Jordan Pacaud', outlet: 'Lucarne TV', type: 'tabloid' },
  { name: 'Lola Garnier', outlet: 'Le Buzz Sportif', type: 'tabloid' },
  { name: 'Paul Arnaud', outlet: 'La Gazette du Stade', type: 'kind' },
];

/** Entrées en matière selon le profil du journaliste. */
export const OPENERS = {
  kind: ['Merci coach, une question simple.', 'Une question simple, coach.', 'Avec tout le respect que je vous dois…', 'Merci de vous arrêter.', 'Une question en douceur, coach.'],
  neutral: ['Coach, une question.', 'Bonsoir coach.', 'Pour revenir sur le match…', 'Une question rapide.', 'Si vous permettez…'],
  trap: ['Soyons honnêtes, coach…', 'Je vais être direct.', 'Beaucoup se posent la question ce soir.', 'Pardon d\'insister, mais…', 'On a entendu beaucoup de choses cette semaine.'],
  tabloid: ['Les réseaux s\'enflamment déjà, coach !', 'Exclusif : on vous pose LA question.', 'Les supporters veulent savoir !', 'Coup de tonnerre ce soir…', 'Tout le monde en parle !'],
};

/** Questions d'après-match par sujet. */
export const POST_Q = {
  win: [
    'Victoire {score} contre {opp}. Qu\'est-ce qui a fait la différence ?',
    'Trois points de plus face à {opp}. Satisfait de la copie rendue ?',
    'Votre équipe a su gagner contre {opp}. Est-ce le déclic que vous attendiez ?',
    'Ce succès {score}, c\'est la récompense du travail de la semaine ?',
    '{opp} n\'a pas existé par moments. Vous vous attendiez à un match aussi maîtrisé ?',
    'Victoire importante contre {opp}. Vous regardez le classement ce soir ?',
    'Le score de {score} reflète-t-il vraiment la physionomie du match ?',
    'Gagner contre {opp}, ça change quoi pour la suite de la saison ?',
    'Qu\'avez-vous dit à vos joueurs dans le vestiaire après ce {score} ?',
    'On a vu une équipe sûre d\'elle contre {opp}. C\'est la meilleure version de votre groupe ?',
  ],
  bigwin: [
    '{score} ! Votre équipe a déroulé contre {opp}. Une démonstration ?',
    'Une large victoire {score}. Vous êtes impressionné par vos joueurs ?',
    'Après un tel festival contre {opp}, peut-on parler de candidat au titre ?',
    'Ce {score} va faire du bruit. Message envoyé à la concurrence ?',
    '{opp} a sombré. Vous avez eu de la peine pour votre collègue ?',
    'Score fleuve ce soir. Faut-il se méfier de l\'excès de confiance maintenant ?',
    'Vos supporters ont chanté pendant tout le match. C\'est la soirée parfaite ?',
    'Avec un tel {score}, le doute n\'est plus permis sur votre projet ?',
  ],
  draw: [
    'Match nul {score} contre {opp}. Point gagné ou deux points perdus ?',
    'Un {score} qui ne fait les affaires de personne ?',
    'Vous avez eu du mal à faire la différence contre {opp}. Pourquoi ?',
    'Ce nul contre {opp}, vous le prenez comment ?',
    'Il a manqué quoi pour l\'emporter ce soir ?',
    'Le partage des points est-il logique selon vous ?',
    'Votre équipe a semblé fatiguée en fin de match. Inquiet ?',
    'Un nul frustrant pour les supporters. Vous comprenez leur déception ?',
  ],
  loss: [
    'Défaite {score} contre {opp}. Comment l\'expliquez-vous ?',
    'Votre équipe est passée à côté ce soir. Qui est responsable ?',
    'Ce revers contre {opp}, c\'est un accident ou un signal d\'alarme ?',
    'Les supporters ont sifflé à la fin. Vous les comprenez ?',
    'Qu\'est-ce qui n\'a pas fonctionné face à {opp} ?',
    'Vous avez semblé impuissant sur le banc. C\'était le cas ?',
    'Cette défaite {score}, elle vous inquiète pour la suite ?',
    'Vos choix tactiques sont-ils en cause ce soir ?',
    'On a vu une équipe sans réaction. Le message passe-t-il encore ?',
    'Faut-il remettre en question la préparation de ce match ?',
  ],
  heavyloss: [
    '{score}… C\'est une humiliation contre {opp}, non ?',
    'Après une telle claque, votre poste est-il menacé ?',
    'Vos joueurs ont-ils lâché ce soir ?',
    'Le président était en tribune. Vous lui avez parlé ?',
    'Comment se relever d\'un {score} pareil ?',
    'Certains parlent de naufrage collectif. Vous êtes d\'accord ?',
    'Vous allez présenter des excuses aux supporters ?',
    'Le vestiaire est-il encore avec vous après un tel score ?',
  ],
  scorer: [
    '{p} a encore frappé ce soir. Il est indispensable ?',
    'Quel regard portez-vous sur la performance de {p} ?',
    '{p} marque à nouveau. On parle de sélection pour lui, vous militez ?',
    'Un mot sur le but de {p} ?',
    '{p} est-il le joueur le plus important de votre effectif ?',
    'Les gros clubs regardent {p}. Il est à vendre ?',
    'Vous attendiez autant de {p} cette saison ?',
    '{p} semble au-dessus du lot. Vous lui avez dit quoi à la fin ?',
  ],
  error: [
    '{p} a été en difficulté ce soir. Lui gardez-vous votre confiance ?',
    'L\'erreur de {p} coûte cher. Allez-vous le sortir de l\'équipe ?',
    '{p} a semblé perdu. Vous lui en voulez ?',
    'Beaucoup pointent {p} du doigt. Vous le défendez ?',
    'Après la prestation de {p}, faut-il recruter à son poste ?',
    '{p} traverse une mauvaise passe. Vous l\'avez vu venir ?',
    'Les supporters ont ciblé {p}. Il peut s\'en remettre ?',
    'Est-ce la dernière fois que l\'on voit {p} titulaire ?',
  ],
  red: [
    'Le carton rouge de {p} a changé le match. Il a manqué de lucidité ?',
    '{p} laisse ses partenaires à dix. Vous allez le sanctionner ?',
    'Ce rouge pour {p}, il est mérité selon vous ?',
    'L\'indiscipline de {p} vous coûte des points. Inquiet ?',
    '{p} expulsé : c\'est un problème de caractère ?',
    'Vous avez parlé à {p} après son exclusion ?',
    'Faut-il revoir les consignes après l\'expulsion de {p} ?',
    'Les arbitres ont-ils {p} dans le collimateur ?',
  ],
  streakWin: [
    '{n} victoires de suite. Jusqu\'où peut aller votre équipe ?',
    'Votre série de {n} succès impressionne. Quel est le secret ?',
    'On ne vous arrête plus. Vous êtes favoris désormais ?',
    'Après {n} victoires, avez-vous peur de la chute ?',
    'Votre équipe semble invincible. Vous le ressentez ?',
    'Cette série de {n} matchs, c\'est votre meilleure période ?',
    'Le titre, on peut en parler maintenant ?',
    '{n} victoires d\'affilée : les joueurs ont-ils encore faim ?',
  ],
  streakLoss: [
    '{n} défaites d\'affilée. Vous sentez le vestiaire vous échapper ?',
    'La spirale continue. Comment l\'arrêter ?',
    'Après {n} revers, avez-vous encore la confiance du président ?',
    'Vos joueurs croient-ils encore en votre projet ?',
    'Cette série noire, c\'est la pire de votre carrière ?',
    '{n} défaites… Allez-vous démissionner ?',
    'Faut-il un électrochoc ? Un changement de système ?',
    'Les supporters réclament votre départ. Votre réaction ?',
  ],
  referee: [
    'L\'arbitrage a fait débat ce soir. Vous vous sentez lésé ?',
    'La VAR a-t-elle faussé le match ?',
    'Ce penalty sifflé contre vous, il y était ?',
    'Vous êtes allé voir l\'arbitre à la fin. Qu\'est-ce que vous lui avez dit ?',
    'Certaines décisions arbitrales ont pesé. Vous allez les commenter ?',
    'L\'arbitre a-t-il été à la hauteur de l\'enjeu ?',
    'Vous parlez d\'injustice ce soir ?',
    'Faut-il revoir l\'utilisation de la vidéo ?',
  ],
  young: [
    '{p} a été remarquable pour son âge. Il est prêt pour le haut niveau ?',
    'Le jeune {p} a crevé l\'écran. Vous allez lui donner plus de temps de jeu ?',
    'Quel avenir pour {p} ?',
    '{p} est-il la future star du club ?',
    'On compare déjà {p} aux plus grands. C\'est exagéré ?',
    'Comment gérez-vous la pression autour de {p} ?',
    '{p} a gagné sa place ce soir ?',
    'Des clubs étrangers suivent {p}. Il restera ?',
  ],
  rumour: [
    'On annonce {p} sur le départ. Vous confirmez ?',
    'Les rumeurs autour de {p} perturbent-elles le groupe ?',
    '{p} a-t-il la tête ailleurs ?',
    'Un grand club serait prêt à tout pour {p}. Votre réaction ?',
    'Allez-vous retenir {p} à tout prix ?',
    'Son agent fait monter les enchères pour {p}. Vous êtes agacé ?',
    'Le dossier {p} est-il bouclé ?',
    '{p} vous a-t-il parlé de son avenir ?',
  ],
  callback: [
    'Vous aviez dit « {said} ». Vous maintenez ?',
    'Il y a quelques semaines : « {said} ». Ça tient toujours ?',
    'On se souvient de votre phrase : « {said} ». Vous la regrettez ?',
    '« {said} » : c\'était votre déclaration. Les faits vous donnent raison ?',
    'Vos mots, « {said} », ont fait le tour des réseaux. Assumez-vous ?',
    'Vous aviez promis : « {said} ». Où en est-on ?',
  ],
  lie: [
    'Vous disiez faire confiance à {p}… et il a fini sur le banc. Comment l\'expliquer ?',
    '{p} écarté malgré votre soutien public. Votre parole a-t-elle encore une valeur ?',
    'Vous défendiez {p} la semaine dernière. Que s\'est-il passé ?',
    'Le vestiaire peut-il vous croire après le cas {p} ?',
    'Vos actes contredisent vos paroles sur {p}. Pourquoi ?',
    '{p} a appris son éviction par la presse ?',
  ],
};

/** Questions d'avant-match (gros matchs). */
export const PRE_Q = {
  compare: [
    '{p} ou {star} : qui est le meilleur ?',
    'On dit que {star} est supérieur à {p}. Vous êtes d\'accord ?',
    '{p} doit-il prouver qu\'il vaut {star} ?',
    'Si vous pouviez échanger {p} contre {star}, vous le feriez ?',
    'Le duel {p} – {star} sera-t-il la clé du match ?',
    '{star} a déclaré être le meilleur à son poste. Que répondez-vous pour {p} ?',
    'Qui a le plus de talent, {p} ou {star} ?',
    '{p} a-t-il peur de {star} ?',
  ],
  rival: [
    '{coach} dit que votre équipe est surcotée. Votre réponse ?',
    '{opp}, c\'est le match de l\'année pour vos supporters ?',
    'Il y a de la rancune entre les deux clubs. Vous l\'entretenez ?',
    '{coach} vous a égratigné cette semaine. Vous avez lu ?',
    'Que pensez-vous du projet de {opp} ?',
    'On dit que {opp} joue un football ennuyeux. Votre avis ?',
    '{opp} vous a pris un joueur l\'été dernier. Ça reste en travers ?',
    'Ce match contre {opp} a-t-il un goût de revanche ?',
  ],
  starFuture: [
    '{p} sera-t-il encore chez vous la saison prochaine ?',
    'Son contrat expire bientôt : {p} va-t-il prolonger ?',
    '{p} a été aperçu avec un agent étranger. Inquiet ?',
    'Si une offre énorme arrive pour {p}, vous la refusez ?',
    '{p} vous a-t-il assuré de sa fidélité ?',
    'Le club peut-il encore retenir {p} ?',
    'Êtes-vous prêt à construire l\'équipe sans {p} ?',
    'Le salaire de {p} est-il un problème ?',
  ],
  pressure: [
    'Ce match contre {opp}, c\'est une finale avant l\'heure ?',
    'Une défaite contre {opp} serait-elle une catastrophe ?',
    'Vos joueurs supportent-ils la pression d\'un tel rendez-vous ?',
    'Ce match peut-il sauver ou condamner votre saison ?',
    'Vous jouez gros contre {opp}. Le ressentez-vous ?',
    'Le président attend une victoire. Vous la promettez ?',
    'Êtes-vous favori face à {opp} ?',
    'Que se passera-t-il si vous perdez contre {opp} ?',
  ],
};

/** Réponses : style × humeur. */
export const ANSWERS = {
  humble: {
    win: ['On reste humbles, rien n\'est fait.', 'C\'est une victoire collective, on savoure et on avance.', 'Il y a encore beaucoup de travail, mais je suis content.', 'Le mérite revient aux joueurs.', 'On a eu un peu de réussite aussi, soyons honnêtes.', 'Trois points, c\'est tout ce qui compte. Pas de quoi s\'enflammer.'],
    loss: ['J\'assume, c\'est moi le premier responsable.', 'On n\'a pas été à la hauteur, il faut le reconnaître.', '{opp} a mérité sa victoire.', 'On va travailler, se remettre en question, et revenir.', 'Les supporters ont raison d\'être déçus.', 'Ce n\'était pas notre soirée. On doit faire mieux.'],
    draw: ['Un point, c\'est mieux que rien.', 'On prend ce point et on avance.', 'Le nul est logique, je pense.', 'On aurait pu perdre aussi, restons lucides.', 'C\'est un point de plus au classement.', 'Pas parfait, mais l\'équipe a montré du caractère.'],
    player: ['{p} a encore beaucoup à apprendre, comme nous tous.', '{p} travaille bien, on va l\'accompagner.', 'Je ne vais pas m\'étendre sur {p}, le collectif prime.', '{p} sait ce qu\'il doit améliorer.', 'Personne n\'est au-dessus du groupe, même pas {p}.', 'On jugera {p} sur la saison, pas sur un match.'],
    pre: ['{opp} est une très belle équipe, on les respecte.', 'On ne se considère pas favoris.', 'On va essayer de faire notre match, sans plus.', 'Chaque match est difficile, celui-là un peu plus.', 'Je ne m\'occupe que de mon équipe.', 'On abordera ce match avec beaucoup d\'humilité.'],
  },
  fighter: {
    win: ['On est là, et il faudra compter sur nous !', 'Ceux qui doutaient de nous peuvent se taire.', 'C\'est le début de quelque chose de grand.', 'On veut tout gagner, je le dis clairement.', '{opp} a vu ce dont on est capables.', 'On ne s\'arrêtera pas là.'],
    loss: ['On reviendra plus forts, je vous le garantis.', 'Ce n\'est qu\'un accident, regardez-nous au prochain match.', 'Je ne suis pas inquiet, cette équipe a du caractère.', '{opp} n\'a rien montré de spécial.', 'On n\'a pas perdu contre meilleur que nous.', 'Ceux qui nous enterrent vont le regretter.'],
    draw: ['On aurait dû les écraser.', 'Ce nul me met en colère.', 'On vaut beaucoup mieux que ça.', 'Le prochain, on le gagne, point.', 'On a été volés de deux points.', '{opp} est venu pour défendre, ça ne m\'impressionne pas.'],
    player: ['Que ceux qui critiquent {p} viennent le dire en face.', '{p} vous fera taire très vite.', 'Je ne laisserai personne attaquer {p}.', '{p} est un guerrier, il va répondre sur le terrain.', 'Laissez {p} tranquille.', '{p} vaut largement mieux que ce que vous écrivez.'],
    pre: ['On va gagner ce match, je n\'ai aucun doute.', '{opp} a peur de nous, et ils ont raison.', 'On est meilleurs qu\'eux, sur tous les plans.', 'Ce match, on va le jouer pour les écraser.', '{coach} ferait mieux de s\'occuper de son équipe.', 'Que le meilleur gagne… et ce sera nous.'],
  },
  protect: {
    win: ['Je veux saluer tout le groupe, sans exception.', 'Ce sont les joueurs qui gagnent, pas l\'entraîneur.', 'Même ceux qui n\'ont pas joué ont participé à cette victoire.', 'Je suis fier de mes joueurs.', 'Le groupe vit bien, ça se voit sur le terrain.', 'Mes joueurs méritent tous les éloges.'],
    loss: ['Je ne lâcherai pas mes joueurs.', 'Si quelqu\'un doit être critiqué, c\'est moi.', 'Mon groupe a tout donné, je ne lui reprocherai rien.', 'Je refuse de pointer un joueur du doigt.', 'On perd ensemble, on gagne ensemble.', 'Les joueurs ont mon soutien total.'],
    draw: ['Mes joueurs ont été courageux.', 'Je ne peux rien reprocher au groupe.', 'Le groupe est uni, c\'est le plus important.', 'On a vu de belles choses, je retiens le positif.', 'Mes joueurs sont fatigués, ils ont été héroïques.', 'Je suis satisfait de l\'engagement.'],
    player: ['Je fais entièrement confiance à {p}.', '{p} restera titulaire, il a tout mon soutien.', '{p} est un joueur essentiel pour nous.', 'Tout le monde fait des erreurs, je soutiens {p}.', '{p} a toute ma confiance, point final.', 'Je protégerai {p} quoi qu\'il arrive.'],
    pre: ['Mes joueurs n\'ont rien à prouver à personne.', '{p} n\'a besoin de se comparer à personne.', 'Je protège mon groupe de toute cette agitation.', 'Mes joueurs sont concentrés, laissez-les tranquilles.', 'Aucun de mes joueurs n\'est à vendre.', 'On parle de mon équipe, pas de celle d\'en face.'],
  },
  evasive: {
    win: ['On verra bien.', 'Je ne commente pas trop, on passe au suivant.', 'Le prochain match est plus important.', 'Pas de grande déclaration ce soir.', 'C\'est le football, on avance.', 'Demandez aux joueurs.'],
    loss: ['Je n\'ai pas grand-chose à dire.', 'On analysera à froid.', 'Le prochain match arrive vite.', 'Je préfère ne pas réagir à chaud.', 'C\'est comme ça.', 'Pas de commentaire.'],
    draw: ['Un match de plus.', 'On regardera la vidéo.', 'Je ne sais pas trop quoi vous dire.', 'C\'est un nul, voilà.', 'Rien de spécial à signaler.', 'Passons à autre chose.'],
    player: ['Je ne parle pas des individualités.', 'On verra pour {p}.', 'Pas de commentaire sur {p}.', 'C\'est une question pour plus tard.', 'Je n\'ai rien à ajouter sur {p}.', 'Chaque chose en son temps.'],
    pre: ['On verra sur le terrain.', 'Pas de pronostic.', 'Je ne m\'occupe pas des autres.', 'Question suivante.', 'Je n\'ai rien à ajouter.', 'Le terrain parlera.'],
  },
};

export const STYLE_LABELS = { humble: 'Humble', fighter: 'Combatif', protect: 'Protecteur', evasive: 'Évasif' };

/** Clips viraux. */
export const VIRAL = [
  '« {said} » : la phrase choc tourne en boucle sur les réseaux.',
  'Votre sortie fait le buzz : « {said} ».',
  '« {said} » : des millions de vues en une soirée.',
  'Les émissions de débat ne parlent que de ça : « {said} ».',
  'Votre déclaration devient un mème : « {said} ».',
  '« {said} » : le clip fait le tour du pays.',
];

/** Réponses des entraîneurs rivaux. */
export const RIVAL_REPLY = [
  '{coach} ({opp}) : « Qu\'il parle moins et gagne plus. »',
  '{coach} ({opp}) : « Ces déclarations ne m\'intéressent pas. »',
  '{coach} ({opp}) : « On répondra sur le terrain. »',
  '{coach} ({opp}) : « Un peu de respect ne ferait pas de mal. »',
  '{coach} ({opp}) : « Il a besoin d\'exister dans les médias. »',
  '{coach} ({opp}) : « Je souris quand j\'entends ça. »',
];

/** Remplit un gabarit. */
export function fill(t, v) {
  return t.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : '…'));
}

/** Nombre total de formulations (contrôlé par les tests). */
export function countTexts() {
  const n = (o) => Object.values(o).reduce((a, x) => a + (Array.isArray(x) ? x.length : n(x)), 0);
  return n(OPENERS) + n(POST_Q) + n(PRE_Q) + n(ANSWERS) + VIRAL.length + RIVAL_REPLY.length;
}
