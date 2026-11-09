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
npm test               # moteur (1000 matchs, prolongations, rôles, profils), 2 saisons complètes, multijoueur
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
- **Joueurs dessinés et animés** : numéro sur le torse, tête orientée, bras et pieds qui bougent, maillot et short aux couleurs du club.
- **Gestes** : frappe, tacle glissé, plongeon du gardien, jeu de tête, célébration.
- **Mouvements** : les joueurs accélèrent et freinent selon leur vitesse et leur fatigue, et le dribbleur garde le ballon au pied. Un arbitre suit le jeu.
- **Identification** : le nom (ou le numéro) s'affiche sous chaque joueur. Toucher un joueur ouvre sa fiche en direct.
- **Ralentis** : chaque but est rejoué au ralenti.
- **Audio d'ambiance** synthétisé en Web Audio, sans aucun fichier : foule, sifflets, clameur, « oh ! » sur les occasions.
- **Statistiques visuelles** : graphique des **xG minute par minute** et **cartes de chaleur**, à la mi-temps et en fin de match.
- **Conseils de l'adjoint** à la mi-temps, bandeau de changement de côté.
- **Commentaires** : 20 à 47 phrases par événement courant.

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
