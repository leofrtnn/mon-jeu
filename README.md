# Coach de Poche — manager de football mobile

Un manager de football léger, dans l'esprit de Football Manager : peu de menus, tout se joue au pouce, des parties courtes.
Le moteur simule chaque match minute par minute, et l'affichage le rejoue en direct sur un terrain vu de dessus.

- **Technologie** : HTML, CSS et JavaScript (modules ES), sans framework ni étape de build.
- **PWA** : le jeu s'installe sur l'écran d'accueil et se joue hors ligne.
- **Sauvegarde** : automatique et compressée, sur 3 emplacements.

## Lancer le jeu

```bash
npm start              # python3 -m http.server 8080 → http://localhost:8080
```

Les modules ES ne se chargent pas en `file://`, d'où le petit serveur local. Le service worker (mode hors ligne) ne s'active qu'en HTTPS ou sur `localhost`.

## Tests

```bash
npm test               # moteur (1000 matchs…), 2 saisons complètes, multijoueur, vie du club, dérive (60 saisons)
npm run test:drift     # dérive des systèmes « vie du club » sur 500 saisons (~80 s)
npm run drift          # même banc, avec le détail des moyennes par indicateur
npm run test:ui        # bout en bout dans Chromium (Playwright) : partie, match, Worker, sauvegarde, amis
npm run calibrate      # statistiques détaillées du moteur (node tests/calibrate.js 2000)
npm run sw             # régénère la liste des fichiers du cache hors ligne
```

Calibration actuelle sur 2000 matchs de D1 :

| Mesure | Valeur |
|---|---|
| Buts par match | ~2,65 |
| Tirs / cadrés | ~28 / ~10,5 |
| Fautes / jaunes / rouges | ~20 / ~3,6 / ~0,18 |
| Domicile / nul / extérieur | ~45 % / 24 % / 31 % |

Chaque championnat a son propre profil : style plus technique en Ibérie, plus physique en Albion.

## Fonctionnalités

### Monde
- **Monde réel** (au choix en début de partie) : les 5 grands championnats, avec leur vrai format.
  - Premier League, LaLiga et Serie A à 20 clubs (38 journées) ; Bundesliga et Ligue 1 à 18 clubs (34 journées).
  - Vrais clubs, joueurs (noms, postes, âges, nationalités, numéros, sélections) et entraîneurs de la saison 2026-27.
  - FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France ; qualifiés pour la coupe continentale : 4/4/3/3/2.
  - Les notes des joueurs sont estimées par le jeu (niveau du club, statut international, âge). Pas de relégation : les données ne contiennent que l'élite.
  - **Logos et visages** : affichés depuis Wikipédia / Wikimedia Commons (non copiés dans le jeu, connexion nécessaire). À défaut : écusson aux couleurs du club, initiales du joueur.
  - Données : `data/real-world.json`, généré depuis `data/foot5/foot5.json` par `scripts/foot/build_game_world.py`.
- **80 clubs fictifs, 3 pays, 4 championnats** : France D1/D2 (promotions et relégations), Liga Ibérica, Albion Premier.
- **Compétitions** : une coupe nationale par pays et une coupe continentale, la *Ligue des Étoiles* (4 groupes, puis quarts, demies et finale).
- **Sélections nationales** : nationalités, 3 trêves internationales, classement Elo, capes. Les internationaux reviennent fatigués, et parfois blessés.
- **Vrais noms** : le jeu n'embarque aucun vrai nom. Il permet en revanche l'**import/export JSON des noms** de clubs et de joueurs (Club → Réglages).

### Moteur de match
- **Positions continues** : les 22 joueurs ont une position réelle. Le receveur d'une passe est choisi selon sa distance, l'espace libre autour de lui et son rôle ; le défenseur le plus proche conteste l'action.
- **Rôles individuels** : meneur, pivot, piston, renard, pivot de pointe, ailier intérieur.
- **Coups de pied arrêtés** : tireurs désignés pour les corners, coups francs et penaltys.
- **Coupe** : prolongations (2 × 15 min), puis tirs au but.
- **Calibration** propre à chaque championnat (buts, fautes, cartons).

### Affichage du match
- **Vue 2D façon FM** (par défaut) : terrain entier fixe, pastilles numérotées, nom du porteur du ballon, bandeau de commentaire sur le terrain, fil réduit aux temps forts. Le bouton « 2D / 🎥 » rebascule sur la vue animée.
- **Joueurs dessinés et animés** : numéro sur le torse, tête orientée, bras et pieds qui bougent, maillot et short aux couleurs du club.
- **Gestes** : frappe, tacle glissé, plongeon du gardien, jeu de tête, célébration.
- **Mouvements** : les joueurs accélèrent et freinent selon leur vitesse et leur fatigue, et le dribbleur garde le ballon au pied. Un arbitre suit le jeu.
- **Identification** : le nom (ou le numéro) s'affiche sous chaque joueur. Toucher un joueur ouvre sa fiche en direct.
- **Ralentis** : chaque but est rejoué au ralenti.
- **Audio d'ambiance** synthétisé en Web Audio, sans aucun fichier : foule, sifflets, clameur, « oh ! » sur les occasions.
- **Statistiques visuelles** : graphique des **xG minute par minute** et **cartes de chaleur**, à la mi-temps et en fin de match.
- **Conseils de l'adjoint** à la mi-temps, bandeau de changement de côté.
- **Commentaires** : 20 à 47 phrases par événement courant.

### Notes façon FM
- **Attributs sur 20**, regroupés (Technique, Mental, Physique, Gardien), couleurs FM ; plages estimées (ex. 12-15) pour les joueurs mal connus.
- **Niveau et potentiel en étoiles** (demi-étoiles), relatifs à votre championnat ; forme et moral en mots. Le moteur garde une échelle interne fine.

### Votre coach
- **Création** en début de partie :
  - identité : prénom, nom, nationalité, âge ;
  - avatar dessiné : teint, coiffure, couleur des cheveux, barbe, lunettes, tenue et sa couleur ;
  - philosophie de jeu et formation préférée.
- **5 compétences notées de 1 à 20** : Tactique, Motivation, Discipline, Formation des jeunes, Préparation physique.
  - 50 points à répartir au départ.
  - Chaque compétence a un effet réel : performance de l'équipe, causeries, cartons, progression des jeunes, récupération et endurance.
  - Chaque saison et chaque trophée rapportent des points à dépenser.
- **Personnalisation à tout moment** : touchez l'avatar en haut à droite, ou passez par Club → Carrière.

### Tactique (façon FM)
- **Bases** : formations de base, mentalité, pressing, tempo, largeur.
- **11 consignes d'équipe** :
  - ligne défensive, style de passe, couloir privilégié ;
  - centres, tirs de loin, contre-attaque, piège du hors-jeu ;
  - tacles, marquage, relance du gardien, gain de temps.
- **Consignes individuelles** : rôle, mission (défense, soutien, attaque), tirs, dribbles, montées.
- **Éditeur de postes** : chaque joueur se déplace librement sur le terrain, et son poste est déduit de la zone.
- **3 plans tactiques** (A, B, C) à enregistrer, chargeables aussi pendant un match.

### Simulation de coach réaliste
- **Marché des entraîneurs** :
  - chaque club a un entraîneur nommé (compétences, philosophie, formation préférée) qui influence le jeu de son équipe ;
  - les présidents jugent leur coach : limogeages en cours de saison et en fin de saison ;
  - postes vacants auxquels vous pouvez postuler (entretien), entraîneurs sans club, fil d'actualité.
- **Votre staff, poste par poste** : adjoint, entraîneur des gardiens, préparateur physique, médecin, jusqu'à 3 recruteurs, responsable formation, analyste vidéo.
  - Chaque membre a une note de 1 à 20, un salaire et un contrat.
  - Un marché du staff permet d'embaucher et de licencier (avec indemnités).
  - **Contrats négociés** : salaire et durée, contre-propositions, 3 essais. Un bon technicien boude les petits clubs. Pas de prolongation automatique : « Prolonger » apparaît pendant la dernière année.
  - Avant chaque match, l'analyste vidéo rédige un rapport sur l'adversaire.
- **Conseil d'administration** :
  - budget transferts et masse salariale distincts et rééquilibrables ; achats, salaires et prolongations bloqués s'ils sortent des enveloppes ;
  - 60 % des ventes reversées au budget transferts ;
  - identité de club, objectifs multiples (classement, coupes, style, jeunes, finances) ;
  - confiance détaillée, demandes au CA, limogeage possible en pleine saison.
- **Transferts réalistes** :
  - les joueurs ambitieux refusent les clubs moins prestigieux, et un club ne lâche pas ses titulaires à un rival plus modeste ;
  - le statut promis (Star, Titulaire, Rotation, Remplaçant, Espoir) est suivi : mécontentement, puis demande de départ si la promesse n'est pas tenue ;
  - les gros clubs recrutent les meilleurs joueurs des petits clubs.
- **Vie du club** :
  - conférences de presse avant les matchs : effets sur la motivation des deux équipes et sur les supporters ;
  - discussions individuelles avec les joueurs ;
  - l'humeur des supporters joue sur l'affluence.

### Préparation estivale
- **Réunion avec le CA** : accepter les objectifs, viser plus haut (budget +25 %) ou revoir à la baisse (budget −25 %), choisir l'identité de jeu.
- **Jusqu'à 3 matchs amicaux**, en direct ou simulés : forme, moral et recette. La saison démarre quand vous le décidez.

### Carrière longue
- **Réputation du coach** et trophées.
- **Offres d'emploi** de clubs plus prestigieux, en cours ou en fin de saison. Le limogeage est possible.
- **Staff** : entraîneur adjoint, recruteur, préparateur physique (niveaux 1 à 5).
- **Installations** : centre d'entraînement, agrandissement du stade (travaux sur plusieurs journées).
- **Plan d'entraînement hebdomadaire** : thème physique, technique, tactique ou récupération, avec une intensité au choix.

### Mercato
- **Négociation de l'indemnité** : offres, contre-propositions et patience du club.
- **Négociation du contrat** : salaire, durée, prime à la signature, **clause libératoire**, commission d'agent.
- **Brouillard sur les attributs** : les joueurs extérieurs sont vus sous forme de plages estimées. Le recruteur les affine en partant les **observer**.
- **Missions de recrutement** : chaque recruteur part 6 journées sur une région (France, Ibérie, Albion ou monde), un poste et un âge maximum, puis rend ses recommandations (Club → Mercato → Recrutement).
- **Dates réelles** : mercato d'été (15 juin – 1er septembre) et d'hiver (2 janvier – 1er février), frénésie de l'IA le dernier jour.
- **Vie du mercato** : rumeurs, joueurs qui demandent à partir via leur agent, clauses levées par l'IA, contre-offres sur les ventes.

### Technique
- **Sauvegardes** : 3 emplacements, compression gzip (environ 1,4 Mo ramenés à ~210 Ko), **export/import** de fichier.
- **Web Worker** : les ~45 matchs d'une journée sont simulés hors du fil principal, avec repli automatique sur le fil principal si le worker est indisponible.
- **Test d'interface Playwright** inclus dans le dépôt.

### Multijoueur asynchrone (sans serveur)
- **Code d'équipe** : votre onze, votre banc et votre tactique, compressés dans un texte de ~1 000 caractères à partager.
- **Défi** : un amical en direct contre l'équipe d'un ami.
- **Ligue entre amis** : un championnat aller-retour **déterministe**. Les mêmes codes donnent les mêmes résultats chez chacun, sans serveur. Un « code de ligue » permet d'inviter un ami avec toutes les équipes d'un coup.
- **Limite** : sans serveur, un code peut être modifié à la main. La somme de contrôle détecte seulement les codes abîmés lors d'un copier-coller. Une vraie ligue en ligne avec anti-triche demanderait un backend.

## Vie du club (boîte de réception unique)

Tout passe par les **messages de l'Accueil** : 3 messages importants maximum, le reste dans « Voir tout ». Une décision s'ouvre en carte à 2 ou 3 choix, avec une échéance. Les effets ne s'affichent qu'**après** le choix. Aucun nouvel onglet.

- **Interviews d'après-match** : 1 à 3 questions selon le contexte réel du match.
  - Contextes : score, buteur, erreur, rouge, série, arbitrage, jeune, rumeur, déclaration passée.
  - 8 journalistes fictifs aux profils différents : bienveillant, neutre, piégeur, sensationnaliste.
  - 4 réponses (humble, combatif, protecteur, évasif), ou « ne pas répondre ».
  - Fatigue médiatique : la même réponse répétée perd de son effet.
  - Clips viraux pendant 2 à 3 semaines, avec réponse possible d'un entraîneur rival.
  - Cohérence : « je fais confiance à X » puis X sur le banc ? La presse le ressort, avec une pénalité.
  - Plus de 300 formulations.
- **Conférences d'avant-match** (derby, choc au sommet, match décisif, coupe) : 2 questions pièges.
  - Elles motivent l'adversaire (« match de revanche ») et mettent la pression sur votre groupe.
- **Vestiaire** : personnalité (leader, ambitieux, loyal, mercenaire, sensible, rebelle) et influence pour chaque joueur.
  - Un noyau de 4 leaders contamine ou apaise ses proches (même nationalité, âge, ancienneté).
  - Événements : réunion de crise, clash, capitaine qui prend la parole.
- **Demandes privées** : temps de jeu, prolongation ou départ.
  - Sans réponse sous 2 à 3 semaines, le joueur parle à la presse, ce qui fait baisser le board et le vestiaire.
  - Les promesses sont mémorisées et vérifiées.
- **Propriétaires** (ambitieux, mécène, gestionnaire, spéculateur, fan local) : environ 1 rachat pour 10 clubs par saison.
  - Le nouveau propriétaire fixe budgets et objectifs, avec un risque de renvoi.
  - Vous le rencontrez : 2 discours possibles.
- **Rivaux et relations** : graphe de -100 à +100 entre tous les clubs.
  - Origines : derbys, transferts, clashs, matchs tendus.
  - Effets : refus de vendre à un concurrent direct, intouchables, solidarité entre alliés, prix réduits ou majorés, prêts refusés, plus de cartons.
  - Club intermédiaire possible (avec commission). Les scores reviennent lentement vers leur base.
  - Fiche club accessible depuis le classement : humeur de la relation et vue « Relations ».
- **Crises financières** : santé financière calculée sur la trésorerie et l'équilibre d'exploitation.
  - Un club en crise brade ses joueurs (surtout le dernier jour), avec un message « X cherche à vendre ».
  - Retrait de points en cas de faillite, relégation administrative en D1.
- **Agents, rumeurs, clauses** :
  - agents gourmands, loyaux ou agressifs ;
  - rumeurs vraies à 70 % (suivies d'une offre), parfois lancées par un agent pour faire monter les prix ;
  - pourcentage à la revente, option d'achat sur les prêts, prime de but.
- **Deadline day** : 2 minutes en direct depuis l'Accueil, avec compte à rebours.
  - Offres surprises, bonnes affaires de clubs en crise, coups de théâtre.
- **Supporters** : l'ambiance du stade module l'avantage à domicile dans le moteur et la billetterie.
  - Elle dépend du prix des places, des résultats et des déclarations.
  - Événements : banderoles, sifflets, manifestations, tifo.
- **Sponsors** : contrats avec primes et exigences (titulariser la star, prime time, classement).
  - Un sponsor part après un scandale ou si ses exigences ne sont pas tenues ; de nouvelles offres arrivent après une bonne saison.
- **Blessures longues** : retour anticipé possible, mais avec un risque de rechute plus longue.
  - Le médecin réduit les risques. La blessure pèse sur le moral et sur la valeur du joueur.
- **Offres d'emploi** : les clubs plus prestigieux vous sollicitent quand tout va bien. Partir en cours de saison coûte de la réputation.
  - Après un limogeage, des clubs modestes ou en crise vous font des offres.

**Équilibrage** : tous les coefficients sont dans `js/data/balance.js` (commenté). **Sauvegarde** : format v3, avec migration automatique des sauvegardes v2.

## Architecture

```
js/core/rng.js              PRNG à graine
js/data/                    constantes (postes, rôles, formations), monde (pays, divisions), noms, génération
js/engine/match.js          ★ moteur minute par minute (positions continues, prolongations)
js/engine/positions.js      positions des joueurs (partagé moteur/rendu)
js/engine/ai.js, ratings.js, commentary.js
js/game/season.js           calendrier (52 journées), championnats, coupes, continentale, sélections, fin de saison
js/game/career.js           coach, staff, installations, entraînement, offres d'emploi
js/game/transfers.js        mercato, négociations, contrats
js/game/scouting.js         brouillard, observations, rumeurs, agents, clauses
js/game/friends.js          multijoueur asynchrone (codes, ligue déterministe)
js/data/balance.js          ★ équilibrage centralisé des systèmes « vie du club »
js/data/pressTexts.js       banque de textes de presse (journalistes, questions, réponses)
js/game/life.js             chef d'orchestre : points d'entrée appelés par la saison
js/game/inbox.js            décisions de la boîte de réception (choix, échéances)
js/game/press.js            interviews, conférences, cohérence, clips viraux
js/game/people.js           personnalités, influence, vestiaire, demandes des joueurs
js/game/owners.js           propriétaires, rachats, santé financière, crises
js/game/relations.js        graphe des relations, rivaux, politique de vente
js/game/fans.js             ambiance du stade, billetterie, sponsors
js/game/injuries.js         blessures longues, retour anticipé, rechutes
js/game/agents.js           agents, rumeurs, clauses
js/game/deadline.js         événements du deadline day
js/game/dataImport.js       import/export des noms
js/game/state.js            état, sauvegardes compressées multi-emplacements
js/game/worker.js           Web Worker de simulation
js/ui/                      app, composants, rendu canvas, audio, graphiques, écrans
tests/                      tests Node + test d'interface Playwright
```

## Pistes pour aller plus loin
- **Ligue en ligne** : avec un petit backend, permettre des matchs simultanés et un anti-triche.
- **Saisons historiques** : statistiques de carrière détaillées par saison.
- **Plus de pays** : un générateur de championnats paramétrable.
