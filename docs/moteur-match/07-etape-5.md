# Étape 5 — Déplacements : intention unique, allure, cinématique partagée

Découpage validé : 5-0 (protection des passes levées) · 5a (arbitrage des intentions) ·
5b (allure dans l'intention) · 5c (modèle cinématique partagé mouvement / planification) ·
5d (diagnostics, validation globale). Chaque sous-étape est présentée avant la suivante.

## Mesures de départ (avant 5a — 2 matchs, pas 1/96 s, outil d'observation sans effet)
| Indicateur | Mesuré | Réel / objectif |
|---|---|---|
| Sauts de cible > 3 m | 16,4 / joueur / minute | < 5 |
| Pas où plusieurs fonctions réécrivent la cible | 3,2 % | 0 % |
| Demi-tours brusques lancé | 0,01 / minute | — |
| Course à reculons / en crabe | 0,5 % / 0,9 % | — |
| Allures marche / trot / course / sprint | 68 / 15 / 12 / 5 % | 60-70 / 20-25 / 7-10 / 3-5 % (indicateur) |
| Distance / joueur de champ | 11,9 km | 10-11,5 km (indicateur) |
Écritures de cible : _positioning 35 %, steadyTargets 25 %, poursuite du ballon 10 %, porteur 9 %,
ballon libre / passes 8 %, findSpace, defensiveLine, buildUpShape, remises en jeu…

## 5-0 — Protection des passes levées (`tests/lofted.test.js`)
* Dosage : difficulté d'une passe levée comptée **une seule fois** (σ levée = 1,45 × σ au sol,
  direction et dosage) à 30, 40 et 50 m, pour des passeurs à 50, 65 et 85.
* Écart type du dosage borné (valeurs validées en 4e + 10 %, sans pression) : 30 m ≤ 3,4 m,
  40 m ≤ 5,2 m, 50 m ≤ 6,5 m ; plus précis pour un meilleur passeur, plus large avec la distance
  et la pression. Mesuré : 40 m → 3,0 m (passeur 85) à 4,7 m (passeur 50).
* Trajectoire sans erreur : passage au point visé à l'instant prévu (< 0,15 m ; mesuré < 0,07 m),
  avec et sans effet.
* Premier rebond : au-delà de la cible et à moins de 16 m (garde-fou contre l'aggravation).
* En match (2 matchs de référence) : passes longues sorties sans aucun contact < 15 %
  (mesuré 8,5 % ; 1 % sous 35 m, 10-12 % au-delà).
* Diagnostic : une passe sortie sans contact est maintenant classée « sortie sans contact »
  (auparavant « en cours à la fin »). Aucun effet sur le jeu (empreinte de référence inchangée).

### Anomalie physique relevée (non corrigée, à valider)
Une passe levée passe bien au point visé, mais à 0,4-1,5 m de hauteur en descente avec la rétro
de la frappe brossée (`top: 2,2`) : elle plane et **rebondit 8 à 14 m au-delà de la cible**
(40 m → rebond à ~54 m). Si le receveur ne la prend pas au point visé, elle file loin, souvent
dehors — contribution probable aux longs ballons perdus et aux têtes « de passage ».
Report validé : traité dans une étape dédiée à l'exécution des passes et au rebond, après
l'étape 5. La physique du ballon n'est pas modifiée pendant l'étape 5 ; diagnostics et tests conservés.

## 5a — Arbitrage des intentions (`js/engine/intent.js`)
### Principe
* **Un seul propriétaire de la cible** : `tx`/`ty` sont des propriétés gardées ; toute écriture
  hors arbitre est comptée (`targetViolations`) et refusée en mode strict (tests). Le placement
  collectif écrit des brouillons (`ptx`/`pty`) convertis en propositions ; les systèmes du moteur
  (porteur, receveur, coupe, poursuite, gardien…) ne font que **proposer** (`want`).
* **Une seule intention arbitrée par joueur et par pas** (`resolveIntents`, juste avant le
  mouvement) ; compteur de double arbitrage = 0 vérifié en match.
* Priorités : P1 placement · P2 soutien · P3 mission (identifiant + condition de fin explicite :
  appel daté, marquage d'un joueur donné, repli, dédoublement, surface) · P4 urgence (coupe,
  duel aérien, poursuite, pressing, ballon coincé ; valeur = marge d'arrivée réelle) · P5 action
  sur le ballon (porteur, receveur réellement en mesure de jouer le ballon — sinon il retombe en
  P4 avec sa marge —, gardien, tireur) · P6 geste en cours, hors arbitrage, dont la fin déclenche
  une réévaluation immédiate.
* Expiration depuis la dernière proposition valide (TTL P1 0,6 s · P2 1,5 s · P3 0,6 s · P4 0,6 s ·
  P5 0,12 s, ou TTL propre à la proposition) ; **conditions de fin explicites** : passe jouée,
  coupée ou perdue (receveur, coupe), porteur dépossédé, mission terminée, et **arrêt de jeu**
  (toutes les intentions prennent fin).
* Préemption immédiate par une priorité supérieure ; retour à la meilleure intention encore valide.
* À priorité égale (créneaux différents) : remplacement seulement après 0,6 s et si la rivale
  vaut ≥ 1,25 × ; départage fixe priorité ↓, valeur ↓, rang de source ↑, identifiant ↑.
* P4-P5 et le suivi défensif jamais lissés (point mis à jour à chaque proposition).

### Écarts par rapport aux règles proposées (à valider)
1. **Même créneau, changement d'identifiant** (un rôle qui « clignote » P1 ↔ P2 à chaque
   réévaluation) : attend 0,6 s ; un **retour** à l'intention qu'on vient de quitter attend 1,2 s.
   Sans cela : 2,9 oscillations A→B→A par joueur et par minute ; avec : 0,7.
2. **Suivi défensif** (`track` : marquage, repli, contenir, second presseur) : point mis à jour
   immédiatement et montée de priorité immédiate dans le même créneau, comme P4-P5 (une
   réaction défensive n'est jamais lissée). Idem pour l'appel collectif de l'attaquant (attente
   à la limite du hors-jeu puis départ : le décalage de ±1 m autour du défenseur compte), pour le
   placement du gardien (bissectrice, étape 4d) et pour le placement sur arrêt de jeu — ces trois
   cas n'étaient déjà pas lissés avant 5a.
3. **Écart > 3 m en P1** : la règle « repris tel quel » doublait les sauts de cible
   (17 → 32 / minute). Remplacée par l'hystérésis de l'ancien placement calme : à sa place, il ne
   repart qu'au-delà de 3 m (1,5 m en P2-P3), glisse à l'allure de marche jusqu'à 1 m (0,4 m),
   et la cible **ne saute jamais** pour une même intention ; au-delà de 30 m d'écart (grand
   déplacement du bloc), rattrapage accéléré continu (avant 5a : saut direct).
4. Espacement autour d'un ballon libre : TTL 0,6 s (proposé à chaque pas mais par intermittence).

### Défauts trouvés pendant la validation (corrigés)
* Appels collectifs annulés dès leur proposition (condition de fin liée au une-deux) : 0 hors-jeu.
* Drapeau « à sa place, on marche » (`_idle`, lu par `move()`) plus posé : trot 15 → 22 %.
* Intentions d'avant l'arrêt de jeu encore valides à l'engagement de la seconde période
  (l'horloge ne tourne pas à la mi-temps) : joueurs placés jusqu'à 43 m de leur place.
* Receveur d'une passe terminée (déviée, perdue) gardant sa réception P5 jusqu'à 0,3 s au lieu
  de poursuivre le ballon (P4).

### Résultats (16 matchs, graines 100-115, mêmes graines avant / après, pas 1/96 s)
| Indicateur | Avant 5a | Après 5a |
|---|---|---|
| Écritures de cible hors arbitre | (3,2 % des pas) | **0** |
| Arbitrages en double | — | **0** |
| Changements d'intention / oscillations A→B→A < 1 s | — | 14,5 / 0,73 par joueur et par minute |
| Temps par priorité | — | P1 71 % · P2 11 % · P3 9 % · P4 4 % · P5 5 % |
| Sauts de cible > 3 m | 16,6 / min | 19,4 / min |
| Allures marche / trot / course / sprint | 68,4 / 15,0 / 11,6 / 5,0 % | 65,4 / 18,3 / 11,7 / 4,7 % |
| Distance / joueur de champ | 11,87 km | 11,76 km |
| Pressing (défenseur le plus proche du porteur) | 4,12 m | 4,11 m |
| Marquage (distance au joueur marqué) | 2,20 m | 2,46 m |
| Appels par match / point atteint | 117 / 79 % | 131 / 77 % |
| Ballon libre avant premier contact | 1,36 s | 1,39 s |

| Statistiques de match | Avant 5a | Après 5a | Réel |
|---|---|---|---|
| Buts / tirs | 3,9 / 14,8 | 2,9 / 14,8 | 2,7-2,9 / 24-26 |
| Tirs de la tête | 25,3 % | 21,2 % | 12-16 % |
| Passes / réussies | 844 / 83,2 % | 835 / 83,2 % | 850-1000 / 80-84 % |
| Longs ballons | 183 | 170 | 90-120 |
| Centres | 23,3 | 19,8 | 30-40 |
| Dégagements | 34,2 | 28,0 | 35-45 |
| Tirs contrés | 3,2 | 2,4 | 6-8 |
| Tacles réussis / fautes | 31,8 / 16,6 | 29,5 / 15,4 | 28-35 / 20-23 |
| Hors-jeu | 4,6 | 3,1 | 3,5-4,5 |
| Touches / coups francs | 49,3 / 21,4 | 45,8 / 18,4 | 38-45 / 24-28 |
| Penaltys | 0,6 | 0,5 | 0,25-0,32 |
| Distance 22 joueurs | 223 km | 214 km | 215-235 |

### Régressions restantes (ouvertes)
* **Appels moins profonds** : la cible d'appel est identique (même point par rapport à la ligne,
  même place tactique des attaquants, même lissage — mesuré), mais l'appel se termine ~2,4 m plus
  loin de la ligne. Conséquences probables : hors-jeu 4,6 → 3,1, centres 23 → 20, dégagements
  34 → 28. Cause non identifiée à ce stade.
* **Marquage un peu plus lâche** (2,20 → 2,46 m) alors que l'intention de marquage est la bonne
  98 % du temps et n'est pas lissée : l'écart vient du mouvement (`move()` plafonne l'allure selon
  la distance à la cible) — relève de 5b (allure dans l'intention).
* Sauts de cible un peu plus fréquents (16,6 → 19,4 / min) : changements d'intention (porteur,
  receveur, poursuite) et suivi défensif non lissé.

### Validation
Tests unitaires 112 ✔ (dont `tests/intent.test.js` : préemption et retour, expiration et fin de
mission, 0,6 s / +25 %, même créneau, départage, hystérésis, déterminisme, et un match en mode
strict : aucune écriture hors arbitre, aucun arbitrage en double), passes levées 30/40/50 m ✔,
contacts physiquement possibles 100 % ✔, interface ✔, déterminisme ✔, moteur rapide inchangé
(`b47d8708`). L'empreinte de référence du moteur en direct change (attendu : nouveau comportement).
Outil : `node tools/bench/move-report.mjs [matchs] [graine]`.
