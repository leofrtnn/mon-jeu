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

/** Étapes : titre, texte, élément à éclairer (sélecteur CSS), écran à afficher avant. */
export const STEPS = [
  { t: 'Bienvenue, coach !', x: 'Vous dirigez un vrai club : composition, tactique, transferts, finances, relation avec la direction et les joueurs. Ce tutoriel dure moins de 5 minutes. Vous pouvez le passer et le relancer quand vous voulez avec le bouton « ? » en haut.' },
  { t: 'Le bouton principal', x: 'En haut à droite, le grand bouton fait avancer le temps : « Jouer » le jour de match, « Jour suivant » sinon. C\'est le cœur du jeu : préparez, puis avancez. Le jeu sauvegarde tout seul après chaque action.', sel: '[data-act="topgo"]', tab: 'home' },
  { t: 'La date et le calendrier', x: 'La saison suit un vrai calendrier : championnat le week-end, coupes en semaine, trêves internationales, mercato d\'été et d\'hiver. Le calendrier complet est dans « Calendrier ».', sel: '.top-date' },
  { t: 'Le menu', x: 'Tout le jeu est rangé ici : Équipe (effectif, tactique, entraînement, jeunes, staff), Compétitions, Mercato et Club (direction, finances, carrière).', sel: '#tabbar .inner' },
  { t: 'Votre effectif', x: 'Chaque joueur a une note (sur 100), une forme, un moral, une condition physique, des traits (Magicien, Leader…) et des étoiles de gestes techniques et de mauvais pied. Touchez un joueur pour voir sa fiche, lui parler, le prolonger ou le vendre.', sel: '[data-nav="squad"]', tab: 'squad' },
  { t: 'La tactique', x: 'Choisissez un système, glissez vos joueurs sur le terrain, réglez la mentalité, le pressing, le style de passe… Pressé ? Le bouton « ⚡ Auto » fait une composition solide en un clic.', sel: '[data-nav="tactics"]', tab: 'tactics' },
  { t: 'Le jour de match', x: 'Avant le coup d\'envoi : composition adverse, météo, arbitre (sévère, laxiste…). Le bouton « Laisser l\'adjoint préparer le match » adapte la tactique pour vous. Pendant le match, le mode « 🎬 Résumé » ne montre que les actions dangereuses.' },
  { t: 'Pendant le match', x: '« 📋 Compo & tactique » met le match en pause : changements (aux arrêts de jeu), consignes, causeries, cris depuis le banc, statistiques et classement en direct. Les changements sont limités comme en vrai (5 joueurs, 3 fenêtres).' },
  { t: 'Le mercato', x: 'Recrutement : cherchez des joueurs avec des filtres. Rien n\'est instantané : offre au club, réponse sous quelques jours, contrat avec le joueur et son agent, visite médicale. Un joueur qui vient de signer ne peut pas repartir avant six mois.', sel: '[data-nav="market"]' },
  { t: 'Vendre un joueur', x: 'Les offres arrivent dans « Messages » et « Recrutement › Ventes ». Acceptez, refusez ou demandez plus : le club acheteur répond sous 48 h. Les agents peuvent aussi vous proposer leurs joueurs, parfois avec un salaire réduit.', sel: '[data-nav="mail"]' },
  { t: 'La réputation (« rep »)', x: 'Votre réputation de coach (sur 100) mesure votre statut dans le football : elle monte avec les victoires, les trophées et les objectifs atteints, et baisse avec les échecs. Plus elle est haute, plus les grands clubs et les grands joueurs veulent travailler avec vous. Chaque club a aussi sa réputation : elle fixe son prestige, ses revenus et l\'attrait pour les joueurs.', sel: '#topcoach' },
  { t: 'La direction', x: 'Le président fixe des objectifs (classement, coupes, budget). Sa confiance monte et baisse selon vos résultats et votre gestion : trop basse, vous pouvez être limogé. Rendez-vous dans « Direction » pour suivre la confiance et demander des moyens.', sel: '[data-nav="board"]' },
  { t: 'Les finances', x: 'Budget transferts, masse salariale, recettes de match, droits TV, sponsors : dépenser plus que ses revenus mène à la crise. Surveillez la jauge dans « Finances ».', sel: '[data-nav="fin"]' },
  { t: 'Entraînement, jeunes et staff', x: 'L\'entraînement fait progresser vos joueurs (et entretient la forme). Le centre de formation sort des pépites chaque saison. Un bon staff (adjoint, préparateur, recruteurs, médecins) aide dans tous les domaines.', sel: '[data-nav="train"]' },
  { t: 'Au quotidien', x: 'Une journée type : lire les messages, ajuster la composition (fatigue, blessures), répondre aux offres, puis « Jouer ». Entre les matchs, l\'entraînement et le mercato avancent tout seuls. Bonne carrière, coach ! (Ce tutoriel se relance avec le bouton « ? ».)' },
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
        <small class="muted">Étape ${i + 1} / ${STEPS.length}</small>
        <h3>${s.t}</h3><p>${s.x}</p>
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
