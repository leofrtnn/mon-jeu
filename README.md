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
- **Ralentis** : chaque but est rejoué au ralenti.
- **Audio d'ambiance** synthétisé en Web Audio, sans aucun fichier : foule, sifflets, clameur, « oh ! » sur les occasions.
- **Statistiques visuelles** : graphique des **xG minute par minute** et **cartes de chaleur**, à la mi-temps et en fin de match.
- **Conseils de l'adjoint** à la mi-temps, bandeau de changement de côté.
- **Commentaires** : 20 à 47 phrases par événement courant.

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
