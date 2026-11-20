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

## 5a — Passe de diagnostic (avant 5b)
Outils : `jump-report.mjs` (sauts de cible par cause), `run-replay.mjs` (appels image par image),
`mark-report.mjs` (continuité du marquage). Champs de diagnostic ajoutés à l'arbitre, sans effet
sur le jeu (empreinte inchangée).

### 1. Sauts de cible (16 matchs, mesure identique avant / après : mêmes totaux que move-report)
| Cause | Avant 5a | Après 5a |
|---|---|---|
| Changement de rôle du placement collectif (formation ↔ soutien, couverture, appel, repli…) | 8,2 (`_positioning`) + 0,8 (`steadyTargets`) | 8,8 |
| Porteur, receveur, poursuite, coupe (P4-P5, non lissés) | 5,1 | 4,7 |
| Suivi défensif non lissé (marquage, repli, contenir, second presseur, appel) | — | 1,5 |
| Reprise sans intention en cours (après un geste, une fin sans relais) | — | 1,1 |
| Préemption | — | 0,9 |
| Fin d'intention (expiration ou condition) puis reprise | — | 0,9 |
| Reprise après arrêt de jeu | 1,3 | 1,3 |
| Remplacement à priorité égale | — | 0,1 |
| **Total / joueur / minute** | **16,6** | **19,4** |
L'objectif < 5 n'est pas atteignable par l'arbitre seul : la moitié des sauts vient de la
réattribution des rôles toutes les 0,3 s (décision d'IA) et un quart du porteur et du ballon.

### 2. Appels moins profonds — origine localisée
Pendant l'appel, la dynamique est la même (progrès 3,5 m contre 3,4 ; vitesses, durée 1,5 s,
intention « appel » retenue 97 %). Toute la différence est au **départ** : −11,9 m de la ligne
contre −9,6. Cause : à la **fin d'un appel** (65 % : « plus choisi pour l'appel »), le passage
P3 appel → P1 formation est un changement d'intention, et la cible saute à la place tactique
(−16,9 m) ; avant 5a, la cible redescendait depuis le point d'appel à l'allure de marche
(−0,7 → −6,8 m en 3 s). Le joueur recule donc franchement (−11,3 m après 3 s contre −6,0) et
l'appel suivant part de plus loin.

### 3. Marquage
Continuité : intention « marquage » retenue 99,1 % du temps, 9 % des épisodes interrompus au
moins une fois (espacement, repli, pressing, porteur : < 0,25 % chacun). L'écart vient (a) des
attaquants marqués plus mobiles (35 % du temps à la marche contre 44 %) et (b) d'un retard plus
grand sur la cible face à un attaquant qui marche (2,46 m contre 1,90) : même mécanisme que
ci-dessus (attaquants qui reculent après chaque appel).

### Correction candidate (non appliquée, à valider)
Redescente vers une intention lissée (P1-P3, priorité ≤ à l'intention quittée) : la cible
**repart de l'ancre courante et glisse** au lieu de sauter. Les montées (préemption, P4-P5,
suivi) restent immédiates. Mesure sur 16 matchs :
| | Avant 5a | 5a actuel | Candidate |
|---|---|---|---|
| Sauts de cible | 16,6 | 19,4 | **15,2** |
| Départ des appels (écart à la ligne) | −9,6 m | −11,9 m | −6,5 m |
| Hors-jeu / centres / dégagements | 4,6 / 23,3 / 34,2 | 3,1 / 19,8 / 28,0 | 4,9 / 24,2 / 33,9 |
| Marquage / pressing | 2,20 / 4,12 m | 2,46 / 4,11 m | 2,24 / 4,06 m |
| Allures marche / trot | 68 / 15 % | 65 / 18 % | 67 / 16 % |
| Buts / tirs de la tête | 3,9 / 25 % | 2,9 / 21 % | 4,1 / 28 % |

### Exceptions au lissage en P2-P3 (mesure par retrait, 8 matchs, sur la candidate)
| Exception (non lissée) | Si on la retire | Avis |
|---|---|---|
| Marquage (P3) | marquage 2,36 → 2,65 m | justifiée |
| Appel collectif (P3) | hors-jeu 4,9 → 3,8 (le décalage ±1 m autour de la ligne disparaît) | justifiée |
| Repli (P3) | aucun effet mesurable | non justifiée → hystérésis proposée |
| Contenir + second presseur (P2) | sauts −1,7 / min, pressing 3,88 → 3,96 m, tacles 31,5 → 28,0 | à séparer (contenir était lissé avant 5a, le second presseur non) |
Le pressing (P4) et le gardien / arrêts de jeu (placement exact, déjà non lissés avant 5a) ne
relèvent pas de cette règle.

## 5a — Corrections validées et validation finale
* **Glissement au retour** : en redescendant vers une intention lissée (P1-P3, priorité ≤ à celle
  qu'on quitte, hors suivi), la cible repart du point courant et glisse ; préemptions, P4-P5 et
  suivi restent immédiats.
* **Repli** : hystérésis P3. **Contenir** : lissage de l'ancien placement calme (repart au-delà
  de 3,2 m — 2 m si le but est menacé —, s'arrête à 1 m, 2,2 / 5 m/s), via des seuils propres à
  l'intention (`jump`, `settle`). **Second presseur** : intention distincte, hystérésis P2.
* Exceptions non lissées restantes en P2-P3 : **marquage** et **appel collectif** (justifiées
  par la mesure, voir ci-dessus).

### Effet séparé de contenir et du second presseur (16 matchs, retirer le lissage de l'un)
| | Final (les deux lissés) | Contenir non lissé | Second presseur non lissé |
|---|---|---|---|
| Pressing (défenseur le plus proche) | 4,00 m | 4,04 m | 3,89 m |
| Tacles réussis | 30,1 | 33,3 | 32,9 |
| Sauts de cible | 13,6 / min | 14,8 / min | 14,9 / min |
| Distance / joueur | 11,58 km | 12,24 km | 12,20 km |
Lisser « contenir » ne coûte rien au pressing ; le second presseur non lissé serre un peu le
porteur (−0,1 m). Les deux non lissés font ~3 tacles de plus et ~0,6 km de course en plus.
Valeur initiale conservée (les deux lissés) ; à revoir avec l'allure (5b).

### Résultats (mêmes graines ; `stats.mjs` tire ses 16 matchs sur 100-103, 200-203, 300-303, 400-403, les autres outils sur 100-115)
| | Avant 5a | 5a (avant correction) | 5a final | Réel |
|---|---|---|---|---|
| Sauts de cible > 3 m | 16,6 / min | 19,4 | **13,6** | < 5 (objectif d'étape) |
| Départ des appels (écart à la ligne) | −9,6 m | −11,9 m | −7,4 m | — |
| Hors-jeu | 4,6 | 3,1 | **4,6** | 3,5-4,5 |
| Marquage | 2,20 m | 2,46 m | **2,26 m** | — |
| Pressing | 4,12 m | 4,11 m | 4,00 m | — |
| Centres | 23,3 | 19,8 | 22,9 | 30-40 |
| Dégagements | 34,2 | 28,0 | 34,9 | 35-45 |
| Tirs / cadrés / contrés | 14,8 / 6,3 / 3,2 | 14,8 / 5,8 / 2,4 | 16,3 / 6,7 / 2,8 | 24-26 / 8,5-9 / 6-8 |
| Buts / xG | 3,9 / 1,9 | 2,9 / 1,7 | 3,3 / 1,9 | 2,7-2,9 / 2,6-2,9 |
| Tirs de la tête (stats.mjs) | 25,3 % | 21,2 % | 19,5 % | 12-16 % |
| Tacles / fautes | 31,8 / 16,6 | 29,5 / 15,4 | 30,1 / 15,8 | 28-35 / 20-23 |
| Allures marche / trot / course / sprint | 68 / 15 / 12 / 5 % | 65 / 18 / 12 / 5 % | 68 / 16 / 12 / 5 % | 60-70 / 20-25 / 7-10 / 3-5 |
| Distance / joueur de champ | 11,87 km | 11,76 km | 11,58 km | 10-11,5 |
Sauts restants (13,6 / min) : P4-P5 (porteur, ballon) 4,7 · réattribution des rôles toutes les
0,3 s 4,4 · reprise après arrêt de jeu 1,3 · reprise sans intention 1,2 · préemption 0,9 ·
suivi 0,8. L'objectif < 5 relève de la décision d'IA (stabilité des rôles) et de la cible du
porteur, pas de l'arbitre.

### Tirs de la tête (`header-report.mjs`, graines 100-115)
| Par match | Avant 5a | 5a avant correction | 5a final |
|---|---|---|---|
| Tirs de la tête / du pied | 5,13 / 13,1 (28 %) | 4,06 / 11,3 (26 %) | 3,94 / 12,4 (24 %) |
| Têtes : centre en jeu · corner · passe longue · second ballon | 2,44 · 0,94 · 0,44 · 1,31 | 2,50 · 0,25 · 0,25 · 1,06 | 2,31 · 0,94 · 0,31 · 0,38 |
| Centres · têtes au but par centre | 26,3 · 0,093 | 20,8 · 0,120 | 22,0 · 0,105 |
| Pied : second ballon / conduite · corner · passe au sol | 10,3 · 2,1 · 0,6 | 8,8 · 1,8 · 0,5 | 10,5 · 1,6 · 0,1 |
La hausse à 28 % (mesure de la candidate) ne se confirme pas : 19,5 % (stats) / 24 % (100-115).
Origine de la part élevée : (1) **trop peu de tirs du pied** (12-13 au lieu de ~20) — cause
principale, anomalie connue ; (2) **choix de finition** : tout ballon au-dessus de 1,2 m à
moins de 13 m, dans l'axe, est repris de la tête vers le but (règle de décision, à revoir avec
l'IA) ; (3) le volume de centres n'est pas en cause (22 par match, sous le réel). Non corrigé.

### Validation
114 tests ✔ (dont 10 sur l'arbitre), interface ✔, contacts physiquement possibles 100 % ✔,
déterminisme ✔ (avec et sans instrumentation), moteur rapide `b47d8708` ✔. Contacts et physique
du ballon non modifiés.
