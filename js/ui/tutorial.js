/**
 * TUTORIEL (moins de 5 minutes) : il présente les boutons et le fonctionnement du jeu au
 * quotidien, met en lumière l'élément dont il parle, et peut être passé à tout moment.
 * La progression est mémorisée : on peut le relancer (bouton « ? » en haut, ou Paramètres)
 * et reprendre là où on s'était arrêté, ou recommencer depuis le début.
 */
const KEY = 'cdp-tuto';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...o })); } catch { /* ignore */ } };
export const tutoDone = () => !!read().done || !!read().skipped;
export const tutoStep = () => read().step || 0;

/**
 * Étapes : chapitre, titre, texte, liste à puces facultative, élément à éclairer (sélecteur CSS),
 * écran à afficher avant. Environ 15 secondes de lecture par étape : moins de 5 minutes en tout.
 */
export const STEPS = [
  // 1. Les bases
  { c: 'Les bases', t: 'Bienvenue, coach !', x: 'Vous êtes l\'entraîneur ET le manager d\'un vrai club : vous choisissez l\'équipe et la tactique, recrutez, gérez les egos, les finances et la relation avec la direction. Ce tutoriel dure moins de 5 minutes ; passez-le quand vous voulez, il se relance avec le bouton « ? » en haut.' },
  { c: 'Les bases', t: 'Le bouton qui fait avancer le temps', x: 'En haut à droite : « Jour suivant » les jours sans match, « Jouer » les jours de match. Le jeu ne bouge jamais sans vous : préparez, puis avancez. Tout est sauvegardé automatiquement après chaque action.', sel: '[data-act="topgo"]', tab: 'home' },
  { c: 'Les bases', t: 'Date, calendrier et saison', x: 'Un vrai calendrier : championnat le week-end, coupes et Europe en semaine, trêves internationales, mercato d\'été (juillet-août) et d\'hiver (janvier). Touchez votre club en haut à gauche pour voir le classement.', sel: '.top-date' },
  { c: 'Les bases', t: 'Le menu', x: 'Tout est rangé en quatre familles :', l: ['Équipe : effectif, tactique, entraînement, jeunes, staff', 'Compétitions : calendrier, championnat, coupes, statistiques, monde du foot', 'Mercato : recrutement, ventes, prêts', 'Club : direction, finances, carrière, amis, paramètres'], sel: '#tabbar .inner' },
  // 2. La journée type
  { c: 'Journée type', t: 'Votre journée type en 6 gestes', x: 'Chaque jour, un bon coach fait le tour de ces points (une minute suffit) :', l: ['1. Lire les messages (offres, demandes de joueurs, direction)', '2. Vérifier l\'état de l\'équipe : blessés, suspendus, fatigue, moral', '3. Régler l\'entraînement de la semaine', '4. Suivre le mercato (offres, négociations en cours)', '5. Jour de match : préparer la compo et la tactique', '6. Appuyer sur « Jour suivant » ou « Jouer »'] },
  { c: 'Journée type', t: '1. Les messages', x: 'Offres pour vos joueurs, réponses de clubs, joueurs qui veulent vous parler, demandes du président, agents qui proposent un joueur… Certains messages attendent une décision : si vous ne répondez pas, l\'adjoint ou le temps décident pour vous.', sel: '[data-nav="mail"]' },
  { c: 'Journée type', t: '2. L\'état de l\'équipe', x: 'Dans « Effectif » : note (sur 100), forme, moral, condition physique, rythme, blessures et suspensions. Un joueur fatigué joue moins bien et se blesse plus. Touchez un joueur pour voir sa fiche, lui parler, le prolonger, le mettre sur la liste des transferts.', sel: '[data-nav="squad"]', tab: 'squad' },
  { c: 'Journée type', t: '3. L\'entraînement', x: 'Choisissez l\'intensité et le thème de la semaine (physique, tactique, attaque, défense…). Plus c\'est intense, plus on progresse… et plus on se fatigue. Avant un gros match, allégez. Les jeunes progressent surtout en jouant et en s\'entraînant.', sel: '[data-nav="train"]' },
  { c: 'Journée type', t: '4. Le mercato', x: 'Rien n\'est instantané, comme en vrai :', l: ['offre au club → réponse sous quelques jours (acceptée, refusée ou contre-offre)', 'contrat avec le joueur et son agent (salaire, durée, primes, statut)', 'visite médicale, puis signature', 'une recrue ne peut pas repartir avant 6 mois'], sel: '[data-nav="market"]' },
  { c: 'Journée type', t: '5. Le jour de match : la préparation', x: 'Avant le coup d\'envoi : compo adverse, météo, arbitre (sévère ou laxiste), forme de vos joueurs. Dans « Tactiques », choisissez le système, glissez vos joueurs, réglez mentalité, pressing et style de passe. Pressé ? « ⚡ Auto » ou « Laisser l\'adjoint préparer le match ».', sel: '[data-nav="tactics"]', tab: 'tactics' },
  { c: 'Journée type', t: '6. Pendant le match', x: 'Le match se joue en direct (22 joueurs qui décident) :', l: ['« 🎬 Résumé » : seulement les actions chaudes ; vitesses ×1 à ×8', '« 📋 Compo & tactique » met en pause : 5 changements en 3 fenêtres, consignes', 'causerie à la mi-temps, cris depuis le banc', 'stats en direct et classement en direct (multiplex)'] },
  { c: 'Journée type', t: 'Après le match', x: 'Interview et conférence de presse : vos réponses changent le moral des joueurs, l\'humeur des supporters et la confiance du président. Protéger un joueur, mettre la pression, rester calme… chaque mot compte.' },
  // 3. Le long terme
  { c: 'Le long terme', t: 'La réputation (« rep »)', x: 'Votre réputation de coach (sur 100) est votre statut dans le football : victoires, trophées et objectifs la font monter, les échecs la font baisser. Plus elle est haute, plus les grands clubs vous appellent et plus les stars acceptent de vous rejoindre. Chaque club a aussi sa réputation (prestige, revenus, attrait).', sel: '#topcoach' },
  { c: 'Le long terme', t: 'La direction', x: 'Le président fixe des objectifs (classement, coupes, budget, jeunes). Sa confiance monte et descend selon vos résultats et votre gestion : trop basse, c\'est le licenciement — en pleine saison si besoin. Vous pouvez aussi lui demander plus de budget ou de meilleures installations.', sel: '[data-nav="board"]' },
  { c: 'Le long terme', t: 'Les finances', x: 'Recettes (billetterie, droits TV, sponsors, primes, ventes) contre dépenses (salaires, transferts, staff). Le budget transferts et la masse salariale sont fixés par la direction. Dépenser plus que ce qu\'on gagne mène à la crise financière : ventes forcées de joueurs, retrait de points, voire faillite.', sel: '[data-nav="fin"]' },
  { c: 'Le long terme', t: 'Le vestiaire', x: 'Vos joueurs ont un caractère, des liens entre eux et des attentes (temps de jeu, salaire, statut promis). Un titulaire mis sur le banc trop longtemps râle ; un leader content entraîne les autres. La cohésion fait gagner des matchs.' },
  { c: 'Le long terme', t: 'Jeunes, staff et scouting', x: 'Le centre de formation sort de nouveaux talents chaque saison. Le staff (adjoint, préparateurs, médecins, recruteurs) améliore tout : progression, blessures, connaissance des joueurs. Envoyez des recruteurs en mission pour découvrir des pépites.', sel: '[data-nav="staff"]' },
  { c: 'Le long terme', t: 'Le rythme d\'une saison', x: 'Été : réunion avec la direction, stage et matchs amicaux (les internationaux rentrent plus tard), mercato. Saison : championnat, coupes, Europe. Janvier : mercato d\'hiver. Fin de saison : bilan, trophées, contrats qui expirent, retraites… puis on repart !', sel: '[data-nav="fixtures"]' },
  // 4. Jouer avec les autres
  { c: 'Avec les autres', t: 'Amis et carrière en ligne', x: 'Défiez vos amis avec un code d\'équipe, créez une ligue entre amis, ou lancez une carrière en ligne jusqu\'à 24 managers (chacun son club) :', l: ['on passe au jour suivant quand tout le monde est prêt', 'contre un autre manager, le match se joue EN DIRECT à deux : chacun dirige son équipe, une pause arrête le match chez les deux', 'transferts négociés entre managers (offre, contre-offre, échange de joueurs, prêt) depuis la fiche du joueur', 'discussion entre tous les managers de la partie (carte « Entre managers » de l\'Accueil)'], sel: '[data-nav="friends"]' },
  { c: 'Avec les autres', t: 'À vous de jouer !', x: 'Rappel de la journée type : messages → effectif → entraînement → mercato → préparation du match → « Jouer ». Le reste (blessures, offres, rumeurs) arrive tout seul. Bonne carrière, coach ! (Ce tutoriel se relance avec « ? ».)' },
];

let open = null;

/** Lance le tutoriel à l'étape `from` (0 = début). */
export function startTutorial(app, from = 0) {
  closeTutorial();
  let i = Math.max(0, Math.min(STEPS.length - 1, from));
  const wrap = document.createElement('div');
  wrap.className = 'tuto';
  document.body.appendChild(wrap);
  open = wrap;
  const show = () => {
    const s = STEPS[i];
    write({ step: i });
    if (s.tab && app.state?.userClubId && app.tab !== s.tab) { try { app.go(s.tab); } catch { /* ignore */ } }
    setTimeout(() => {
      const el = s.sel ? document.querySelector(s.sel) : null;
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      const hole = r ? `<div class="tuto-hole" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>` : '<div class="tuto-dim"></div>';
      const below = r ? r.top < window.innerHeight / 2 : true;
      wrap.innerHTML = `${hole}<div class="tuto-card ${below ? 'bottom' : 'top'}">
        <div class="tuto-prog">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
        <small class="muted">${s.c ? `${s.c} · ` : ''}Étape ${i + 1} / ${STEPS.length}</small>
        <h3>${s.t}</h3><p>${s.x}</p>${s.l ? `<ul class="tuto-list">${s.l.map((li) => `<li>${li}</li>`).join('')}</ul>` : ''}
        <div class="btns"><button class="btn sm" data-tuto="skip">Passer le tutoriel</button><span class="grow"></span>
          ${i > 0 ? '<button class="btn sm" data-tuto="prev">◂</button>' : ''}
          <button class="btn sm primary" data-tuto="next">${i === STEPS.length - 1 ? 'Terminer ✓' : 'Suivant ▸'}</button></div></div>`;
    }, s.tab ? 120 : 0);
  };
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tuto]');
    if (!b) return;
    const k = b.dataset.tuto;
    if (k === 'next') { if (i >= STEPS.length - 1) { write({ done: true, step: 0 }); closeTutorial(); app.toast?.('Tutoriel terminé : relancez-le quand vous voulez avec « ? ».', 3500); return; } i++; show(); }
    else if (k === 'prev') { i = Math.max(0, i - 1); show(); }
    else if (k === 'skip') { write({ skipped: true, step: i }); closeTutorial(); app.toast?.('Tutoriel passé : bouton « ? » en haut pour le reprendre.', 3500); }
  });
  show();
}

export function closeTutorial() { if (open) { open.remove(); open = null; } }

/** Relance : propose de reprendre là où on s'était arrêté, ou de recommencer. */
export function relaunchTutorial(app) {
  const st = read();
  if (!st.step) return startTutorial(app, 0);
  const h = app.sheet({
    html: `<h2>Tutoriel</h2><p>Vous vous étiez arrêté à l'étape ${st.step + 1} / ${STEPS.length} (« ${STEPS[st.step].t} »).</p>
      <div class="btns"><button class="btn" data-act="restart">Recommencer</button><button class="btn primary" data-act="resume">Reprendre</button></div>`,
    actions: {
      restart: () => { h.close(); startTutorial(app, 0); },
      resume: () => { h.close(); startTutorial(app, st.step); },
    },
  });
}
