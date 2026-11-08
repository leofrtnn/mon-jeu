# Coach de Poche — manager de football mobile

Un manager de football léger, dans l'esprit de Football Manager : peu de menus, tout se joue au pouce, des parties courtes.
Le moteur simule chaque match minute par minute, et l'affichage le rejoue en direct sur un terrain vu de dessus.

- **Technologie** : HTML, CSS et JavaScript (modules ES), sans framework ni étape de build.
- **PWA** : le jeu s'installe sur l'écran d'accueil et se joue hors ligne grâce au service worker.
- **Sauvegarde** : automatique dans `localStorage`.

## Lancer le jeu

Les modules ES ne se chargent pas en `file://`, il faut donc un petit serveur local :

```bash
npm start              # équivaut à : python3 -m http.server 8080
# puis ouvrir http://localhost:8080 (sur mobile : http://<ip-du-pc>:8080)
```

Pour l'installer en PWA : menu du navigateur, puis « Ajouter à l'écran d'accueil ».
Le service worker ne s'active qu'en HTTPS ou sur `localhost`.

## Tests

```bash
npm test               # moteur (1000 matchs) + 2 saisons complètes
npm run calibrate      # distributions détaillées : node tests/calibrate.js 2000
npm run sw             # régénère la liste des fichiers du cache hors ligne
```

Calibration actuelle sur 2000 matchs de D1 :

| Mesure | Valeur | Repère réel |
|---|---|---|
| Buts par match | **2,63** | ~2,6 |
| xG par match | 2,74 | — |
| Tirs / cadrés | 26,7 / 10,1 | ~25 / ~9 |
| Fautes / jaunes / rouges | 19,5 / 3,5 / 0,16 | ~22 / ~3,8 / ~0,15 |
| Corners | 9,7 | ~10 |
| Domicile / nul / extérieur | 43 % / 24 % / 33 % | ~45 / 25 / 30 |
| Le plus fort gagne (écart > 4 pts) | ~70-80 % | des surprises restent possibles |

Tout le hasard passe par un générateur pseudo-aléatoire à graine (`js/core/rng.js`).
Avec la même graine, on obtient le même match, ce qui permet de reproduire un bug.

## Architecture

```
index.html, manifest.webmanifest, sw.js, icons/
css/style.css                 thème sombre, accent aux couleurs du club
js/main.js                    démarrage et service worker
js/core/rng.js                PRNG à graine (mulberry32)
js/data/constants.js          postes, attributs, formations, consignes
js/data/names.js              noms procéduraux (joueurs, clubs, couleurs)
js/data/generator.js          génération du monde (40 clubs × 25 joueurs)
js/engine/ratings.js          note par poste, condition, compo auto
js/engine/match.js            ★ moteur minute par minute
js/engine/ai.js               IA d'entraîneur (formation, mentalité, changements)
js/engine/commentary.js       commentaires en français
js/game/state.js              état et sauvegarde localStorage
js/game/season.js             calendrier, coupe, journées, classements, board, fin de saison
js/game/economy.js            valeurs, salaires, billetterie, sponsors, primes
js/game/transfers.js          achat, vente, prêts, prolongations, mercato IA
js/game/progression.js        entraînement, évolution selon l'âge, retraites
js/ui/app.js                  onglets, feuilles modales, toasts
js/ui/components.js           badges, jauges, lignes de joueur
js/ui/matchView.js            ★ rendu canvas du match (60 fps)
js/ui/screens/*.js            accueil, effectif, tactique, calendrier, club, match…
tests/                        tests Node (node:test)
```

Les couches sont séparées : le moteur et la logique de jeu ne touchent jamais au DOM, ce qui permet de les tester directement sous Node.

### Le moteur de match

- **Rythme** : chaque minute contient 2 à 6 actions, selon le tempo des deux équipes.
- **Choix du porteur** : il choisit entre passe courte, passe longue, dribble, centre et tir. Ce choix dépend de la zone (défense, milieu, attaque, surface), de la tactique et de ses attributs.
- **Duel** : un défenseur adverse, choisi selon sa position, conteste l'action. La réussite suit une sigmoïde de l'écart d'attributs effectifs.
- **Attributs effectifs** : attribut × condition (fatigue, forme, moral) × adaptation au poste × avantage du terrain × infériorité numérique.
- **Événements** : interceptions, tacles, fautes, cartons (deux jaunes valent un rouge), pénaltys, coups francs directs, corners, hors-jeu, tirs (contrés, arrêtés, sur le poteau, à côté, buts), VAR, blessures et temps additionnel.
- **Statistiques** : possession, tirs, xG, passes, fautes et corners sont calculés à partir des actions jouées ; aucune n'est tirée au sort directement.
- **Fatigue** : elle progresse au fil du match et pèse davantage après la 60e minute. L'IA fait ses changements et adapte sa mentalité au score.
- **Niveau du match** : les seuils du moteur sont relatifs au niveau moyen des joueurs, si bien qu'un match de D2 a des statistiques comparables à un match de D1.

## Boucle de jeu

1. **Choix du club**, en D1 ou en D2.
2. **Avant-match** : compo et tactique.
3. **Match en direct** : vitesse x1, x2 ou x4, mode « Résumé » (temps forts seulement) ou « Fin » (simulation immédiate).
   - **Pause** : changements (5 maximum), formation, mentalité, pressing, tempo.
   - **Mi-temps** : statistiques et causerie (3 choix).
   - **Fin de match** : statistiques, notes des joueurs, homme du match.
4. **Gestion rapide** : blessures, suspensions, finances, offres reçues.
5. **Journée suivante.** Une saison compte 38 journées et 5 tours de coupe.
6. **Fin de saison** : bilan, primes, promotions et relégations, évolution des joueurs, retraites, jeunes du centre, évaluation par le board (limogeage possible).

## Améliorations possibles

- **Contenu** : plusieurs ligues et pays, coupes continentales, sélections nationales, et import de vrais noms via un fichier de données.
- **Carrière longue** : réputation du coach, changements de club, staff (adjoint, recruteur, préparateur physique), installations.
- **Mercato** : vraies négociations (contre-offres, clauses, bonus), agents, rumeurs, recrutement avec un brouillard sur les attributs.
- **Entraînement** : planning hebdomadaire, rôles individuels (meneur, pivot, piston), consignes de coups de pied arrêtés.
- **Match** : prolongations en coupe, changement de côté visible, ralentis des buts, carte de chaleur, graphique xG minute par minute, audio d'ambiance.
- **Moteur** : positions continues des 22 joueurs, plutôt que des zones, pour des animations encore plus fidèles. Calibration par championnat.
- **Technique** : sauvegarde compressée et multi-emplacements, export/import, Web Worker pour simuler la journée sans bloquer l'interface, tests d'interface Playwright.
- **Multijoueur** : ligue entre amis en asynchrone, défis de compo partagés.
