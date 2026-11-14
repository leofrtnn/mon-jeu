/**
 * LANGUES : français (langue d'origine), anglais, espagnol.
 * Le jeu est écrit en français ; pour une autre langue, un observateur traduit à la volée les
 * textes affichés (menus, boutons, onglets, titres, messages courants) à partir d'un
 * dictionnaire de phrases et de quelques motifs. Les textes longs et générés (commentaires de
 * match, articles, dialogues) restent en français pour l'instant.
 */
export const LANGS = { fr: { label: 'Français', flag: '🇫🇷' }, en: { label: 'English', flag: '🇬🇧' }, es: { label: 'Español', flag: '🇪🇸' } };

// [français, anglais, espagnol]
const PHRASES = [
  ['Accueil', 'Home', 'Inicio'], ['Messages', 'Inbox', 'Mensajes'], ['Effectif', 'Squad', 'Plantilla'], ['Tactiques', 'Tactics', 'Tácticas'],
  ['Entraînement', 'Training', 'Entrenamiento'], ['Jeunes', 'Youth', 'Cantera'], ['Staff', 'Staff', 'Cuerpo técnico'], ['Calendrier', 'Fixtures', 'Calendario'],
  ['Championnat', 'League', 'Liga'], ['Coupes', 'Cups', 'Copas'], ['Statistiques', 'Statistics', 'Estadísticas'], ['Monde du foot', 'Football world', 'Mundo del fútbol'],
  ['Recrutement', 'Transfers', 'Fichajes'], ['Paramètres', 'Settings', 'Ajustes'], ['ÉQUIPE', 'TEAM', 'EQUIPO'], ['Équipe', 'Team', 'Equipo'],
  ['COMPÉTITIONS', 'COMPETITIONS', 'COMPETICIONES'], ['Compétitions', 'Competitions', 'Competiciones'], ['MERCATO', 'TRANSFERS', 'MERCADO'], ['Mercato', 'Transfers', 'Mercado'],
  ['Continuer', 'Continue', 'Continuar'], ['Effacer', 'Delete', 'Borrar'], ['Nouvelle partie', 'New game', 'Nueva partida'], ['Importer', 'Import', 'Importar'],
  ['Vide', 'Empty', 'Vacía'], ['Se déconnecter', 'Log out', 'Cerrar sesión'], ['Se connecter', 'Log in', 'Iniciar sesión'], ['Créer un compte', 'Sign up', 'Crear cuenta'],
  ['Fermer', 'Close', 'Cerrar'], ['Annuler', 'Cancel', 'Cancelar'], ['Valider', 'Confirm', 'Confirmar'], ['Retour', 'Back', 'Volver'], ['Suivant', 'Next', 'Siguiente'],
  ['Jouer', 'Play', 'Jugar'], ['Simuler', 'Simulate', 'Simular'], ['Sauvegarder', 'Save', 'Guardar'], ['Réinitialiser les filtres', 'Reset filters', 'Restablecer filtros'],
  ['Compo & tactique', 'Line-up & tactics', 'Alineación y táctica'], ['📋 Compo & tactique', '📋 Line-up & tactics', '📋 Alineación y táctica'], ['⏭ Fin', '⏭ End', '⏭ Fin'],
  ['⚡ Temps fort', '⚡ Key moment', '⚡ Momento clave'], ['⏩ Accéléré x4', '⏩ Fast x4', '⏩ Acelerado x4'], ['⚡ TEMPS FORT', '⚡ KEY MOMENT', '⚡ MOMENTO CLAVE'], ['⏩ ACCÉLÉRÉ ×4', '⏩ FAST ×4', '⏩ ACELERADO ×4'],
  ['Mentalité', 'Mentality', 'Mentalidad'], ['Pressing', 'Pressing', 'Presión'], ['Tempo', 'Tempo', 'Ritmo'], ['Largeur', 'Width', 'Amplitud'],
  ['Défensive', 'Defensive', 'Defensiva'], ['Équilibrée', 'Balanced', 'Equilibrada'], ['Offensive', 'Attacking', 'Ofensiva'], ['Bas', 'Low', 'Bajo'], ['Moyen', 'Medium', 'Medio'], ['Haut', 'High', 'Alto'],
  ['Lent', 'Slow', 'Lento'], ['Normal', 'Normal', 'Normal'], ['Rapide', 'Fast', 'Rápido'], ['Possession %', 'Possession %', 'Posesión %'], ['Tirs', 'Shots', 'Tiros'], ['Cadrés', 'On target', 'A puerta'],
  ['Passes réussies %', 'Pass accuracy %', 'Pases completados %'], ['Corners', 'Corners', 'Córners'], ['Fautes', 'Fouls', 'Faltas'],
  ['Rechercher', 'Search', 'Buscar'], ['Prêts', 'Loans', 'Cesiones'], ['Dossiers', 'Deals', 'Operaciones'], ['Ventes', 'Sales', 'Ventas'],
  ['Filtres', 'Filters', 'Filtros'], ['⚙ Filtres', '⚙ Filters', '⚙ Filtros'], ['Âge', 'Age', 'Edad'], ['Nationalité', 'Nationality', 'Nacionalidad'], ['Pied fort', 'Preferred foot', 'Pie dominante'], ['Statut', 'Status', 'Estado'],
  ['Défense', 'Defence', 'Defensa'], ['Milieu', 'Midfield', 'Medio campo'], ['Attaque', 'Attack', 'Ataque'], ['Tous', 'All', 'Todos'], ['Toutes', 'All', 'Todas'], ['Indifférent', 'Any', 'Indiferente'],
  ['Droit', 'Right', 'Derecho'], ['Gauche', 'Left', 'Izquierdo'], ['Libres', 'Free agents', 'Libres'], ['Dans mon budget', 'Within budget', 'Dentro del presupuesto'],
  ['Finances', 'Finances', 'Finanzas'], ['Direction', 'Board', 'Directiva'], ['Carrière', 'Career', 'Carrera'], ['Amis', 'Friends', 'Amigos'],
  ['Actualités', 'News', 'Noticias'], ['Entraîneurs', 'Managers', 'Entrenadores'], ['Sélections', 'National teams', 'Selecciones'],
  ['Poste', 'Position', 'Posición'], ['Niveau', 'Ability', 'Nivel'], ['Forme', 'Form', 'Forma'], ['Moral', 'Morale', 'Moral'], ['Condition', 'Fitness', 'Condición'],
  ['Titulaire', 'Starter', 'Titular'], ['Capitaine', 'Captain', 'Capitán'], ['Gardiens', 'Goalkeepers', 'Porteros'], ['Défenseurs', 'Defenders', 'Defensas'], ['Milieux', 'Midfielders', 'Centrocampistas'], ['Attaquants', 'Forwards', 'Delanteros'],
  ['Valeur', 'Value', 'Valor'], ['Salaire', 'Wage', 'Salario'], ['Contrat', 'Contract', 'Contrato'], ['Matchs', 'Apps', 'Partidos'], ['Buts', 'Goals', 'Goles'], ['Passes D.', 'Assists', 'Asistencias'], ['Note moy.', 'Avg rating', 'Nota media'],
  ['Discuter', 'Talk', 'Hablar'], ['Prolonger', 'Extend', 'Renovar'], ['Vendre', 'Sell', 'Vender'], ['Prêter', 'Loan out', 'Ceder'], ['Libérer', 'Release', 'Liberar'],
  ['Demander un prêt', 'Ask for a loan', 'Pedir cesión'], ['Envoyer l\'offre', 'Send offer', 'Enviar oferta'], ['Envoyer la proposition', 'Send proposal', 'Enviar propuesta'], ['Accepter', 'Accept', 'Aceptar'],
  ['Abandonner le dossier', 'Abandon deal', 'Abandonar operación'], ['Historique', 'History', 'Historial'], ['Approche', 'Approach', 'Enfoque'],
  ['Lancer la saison ▸', 'Start the season ▸', 'Empezar la temporada ▸'], ['Réunion avec le CA', 'Board meeting', 'Reunión con la directiva'], ['Jour suivant ▸', 'Next day ▸', 'Día siguiente ▸'], ['+3 jours ▸▸', '+3 days ▸▸', '+3 días ▸▸'],
  ['Préparation', 'Pre-season', 'Pretemporada'], ['Matchs amicaux', 'Friendlies', 'Amistosos'], ['Adversaires proposés', 'Suggested opponents', 'Rivales sugeridos'],
  ['Langue', 'Language', 'Idioma'], ['Sauvegarde automatique sur cet appareil', 'Autosave on this device', 'Guardado automático en este dispositivo'],
  ['Le manager de foot qui tient dans une main.', 'The football manager that fits in one hand.', 'El mánager de fútbol que cabe en una mano.'],
  ['55 championnats (dont les D2 des 5 grands) · vrais clubs, joueurs et entraîneurs · coupes nationales, supercoupes, 7 coupes continentales, Coupe du monde et Euro', '55 leagues (incl. the second tiers of the big 5) · real clubs, players and managers · domestic cups, super cups, 7 continental cups, World Cup and Euro', '55 ligas (incluidas las segundas de las 5 grandes) · clubes, jugadores y entrenadores reales · copas nacionales, supercopas, 7 copas continentales, Mundial y Eurocopa'],
  ['Football Manager de poche', 'Pocket football manager', 'Mánager de fútbol de bolsillo'], ['Emplacements de sauvegarde', 'Save slots', 'Ranuras de guardado'],
  ['Victoire', 'Win', 'Victoria'], ['Nul', 'Draw', 'Empate'], ['Défaite', 'Loss', 'Derrota'], ['Classement', 'Table', 'Clasificación'], ['Buteurs', 'Top scorers', 'Goleadores'],
  ['Prochain match', 'Next match', 'Próximo partido'], ['Dernier match', 'Last match', 'Último partido'], ['Budget', 'Budget', 'Presupuesto'],
  ['Cohésion', 'Cohesion', 'Cohesión'], ['Meilleurs duos', 'Best partnerships', 'Mejores parejas'], ['À intégrer', 'Settling in', 'Por integrar'], ['Vestiaire', 'Dressing room', 'Vestuario'],
  ['Marché des entraîneurs', 'Manager market', 'Mercado de entrenadores'], ['Postes vacants', 'Vacant jobs', 'Puestos vacantes'], ['Entraîneurs libres', 'Free managers', 'Entrenadores libres'],
];
const IDX = { en: 1, es: 2 };
const PATTERNS = [
  [/^Saison (\d{4})-(\d{2,4})$/, { en: 'Season $1-$2', es: 'Temporada $1-$2' }],
  [/^Emplacement (\d)$/, { en: 'Slot $1', es: 'Ranura $1' }],
  [/^(\d+) joueur\(s\) trouvé\(s\)(.*)$/, { en: '$1 player(s) found$2', es: '$1 jugador(es) encontrado(s)$2' }],
  [/^(\d+) ans$/, { en: '$1 yrs', es: '$1 años' }],
];

export const getLang = () => { try { return localStorage.getItem('cdp-lang') || 'fr'; } catch { return 'fr'; } };
export function setLang(l) { try { localStorage.setItem('cdp-lang', l); } catch { /* ignore */ } location.reload(); }

let MAP = null;
function dict(lang) {
  if (MAP) return MAP;
  MAP = new Map();
  for (const row of PHRASES) MAP.set(row[0], row[IDX[lang]] || row[0]);
  return MAP;
}
function tr(text, lang) {
  const t = text.trim();
  if (!t || t.length > 220) return null;
  const m = dict(lang).get(t);
  if (m) return text.replace(t, m);
  for (const [re, rep] of PATTERNS) if (re.test(t)) return text.replace(t, t.replace(re, rep[lang]));
  return null;
}
function walk(root, lang) {
  if (root.nodeType === 3) { const r = tr(root.nodeValue, lang); if (r != null && r !== root.nodeValue) root.nodeValue = r; return; }
  if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.tagName === 'CANVAS') return;
  for (const a of ['placeholder', 'title', 'aria-label']) { const v = root.getAttribute?.(a); if (v) { const r = tr(v, lang); if (r) root.setAttribute(a, r); } }
  for (const c of root.childNodes) walk(c, lang);
}

/** Installe la traduction automatique de l'interface (rien à faire en français). */
export function installI18n() {
  const lang = getLang();
  document.documentElement.lang = lang;
  if (lang === 'fr' || !IDX[lang]) return;
  walk(document.body, lang);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { const r = tr(m.target.nodeValue, lang); if (r != null && r !== m.target.nodeValue) m.target.nodeValue = r; }
      else for (const n of m.addedNodes) walk(n, lang);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
