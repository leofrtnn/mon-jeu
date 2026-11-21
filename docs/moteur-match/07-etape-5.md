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

## 5b — Allure demandée par l'intention (`paceOf`, `live.js`)
### Principe
* L'intention **demande** une allure : marche 1,3 m/s (petits pas autour de sa place 1,1) · trot 3,2 ·
  course 5,0 · sprint 6,3 · à fond (capacité du joueur). La vitesse **atteinte** reste décidée par la
  cinématique de `move()` : accélération (attribut vitesse), freinage, virages, fatigue, météo,
  ballon au pied. Mesure : une demande « sprint » n'est atteinte que 34 % du temps (le reste :
  phase d'accélération, virage, arrivée).
* 5b-1 : les six familles de plafonds de `move()` regroupées à l'identique (`paceOld`, empreinte
  de match inchangée) ; interrupteur `__X.pace0` pour comparer sur les mêmes matchs.
* 5b-2 : plus de paliers de vitesse qui baissent instantanément avec la distance à la cible.
  L'allure dépend de l'intention et de la situation (distance restante, but menacé, ballon proche) ;
  elle **monte immédiatement**, ne **redescend** que si la demande plus basse dure 0,3 s ;
  **arrivée** avec hystérésis (au pas sous 1 m, relance au-delà de 3 m).
* **Freinage voulu** (cinématique) : un replacement calme décélère à 1,5 m/s² (on arrive en
  marchant — c'est ce que faisaient implicitement les anciens paliers), pressé (but menacé)
  2,5 m/s² ; missions (appel, repli, dédoublement, surface), pressing, marquage et urgences
  gardent 6 m/s² comme avant.
* Marquage : demande relative — l'allure de l'attaquant plus de quoi revenir.
* Inchangés (hors champ de 5b) : arrêts de jeu, gardien, porteur (dont « rattraper son ballon »),
  destinataire d'une passe. Second presseur : lissage conservé.

### Essais écartés
| Essai | Effet mesuré | Cause |
|---|---|---|
| Allure fixée à la distance de départ, freinage d'urgence seul | marche 59 %, 12,7 km, 771 passes, marquage 2,52 m | les anciens paliers servaient de freinage : arrivées lancées |
| Allure réévaluée à chaque bascule « à sa place », arrivée sans hystérésis | 79 changements de demande / joueur / minute | cible qui glisse autour du seuil d'arrivée |
| Freinage calme appliqué aussi aux missions | appels : progrès 3,34 m au lieu de 3,62 | l'appel ralentissait trop tôt |
| Maintien 0,6 s | sprint 6,6 % | maintien trop long ; 0,3 s retenu (valeur initiale) |

### Résultats (16 matchs, mêmes graines ; stats.mjs : 100-103, 200-203, 300-303, 400-403)
| | 5a final | 5b | Réel / indicateur |
|---|---|---|---|
| Marquage (distance au joueur marqué) | 2,26 m | **2,24 m** | — |
| Appels : départ / fin / progrès | −7,4 / −2,9 / 3,62 m | −7,9 / −3,0 / 3,60 m | — |
| Pressing | 4,00 m | 3,95 m | — |
| Allures marche / trot / course / sprint | 68,2 / 15,5 / 11,5 / 4,8 % | 62,9 / 18,4 / 12,8 / 5,8 % | 60-70 / 20-25 / 7-10 / 3-5 |
| Distance / joueur de champ (1/96 s ; 0,05 s) | 11,58 ; 11,76 km | 12,07 ; 12,20 km | 10-11,5 |
| Changements de demande d'allure | — | 29 / joueur / minute | — |
| Sauts de cible | 13,6 / min | 14,3 / min | — |
| Tacles / fautes / coups francs | 30,1 / 15,8 / 20,1 | 33,5 / 18,6 / 24,4 | 28-35 / 20-23 / 24-28 |
| Interceptions / dribbles / possessions | 102 / 37 / 287 | 111 / 42 / 307 | — / 30-40 / 200-260 |
| Hors-jeu | 4,6 | **6,3** | 3,5-4,5 |
| Passes / réussies | 844 / 82,0 % | 851 / 81,8 % | 850-1000 / 80-84 % |
| Buts / tirs / cadrés | 3,3 / 16,3 / 6,7 | 3,8 / 17,6 / 6,9 | 2,7-2,9 / 24-26 / 8,5-9 |
| Tirs de la tête | 19,5 % | 20,9 % | 12-16 % |
| Distance 22 joueurs (stats.mjs) | 223 km | 231 km | 215-235 |

### Points ouverts
* **Plus d'intensité** : sprint +1 point, +0,5 km par joueur. Origine mesurée : replacement quand
  le but est menacé (sprint réel 1,11 % du temps contre 0,62 %) et repli (1,15 % contre 0,90 %) —
  ces déplacements ne sont plus bridés par paliers à l'approche. Non compensé.
* **Hors-jeu 6,3** (4,6) : les attaquants restent plus près de la ligne ; à relier aux appels
  tactiques (synchronisation, IA) — non corrigé dans 5b.
* Les demandes « sprint » / « à fond » sont atteintes 29-34 % du temps : courtes (pressing,
  poursuite) ou interrompues avant la pleine vitesse. Ce sera l'objet de 5c (même modèle
  cinématique pour le mouvement et le calcul du temps d'arrivée).

### Hors champ de 5b (toujours documentés)
Appels tactiques et stabilité des rôles (sauts de cible restants), longs ballons (~170), penaltys,
choix tête / contrôle / frappe (tirs de la tête, manque de frappes du pied).

### Validation
114 tests ✔, interface ✔, contacts physiquement possibles 100 % ✔, déterminisme ✔, moteur rapide
`b47d8708` ✔. Contacts et physique du ballon non modifiés.

## 5b — Diagnostic avant 5c (sans modification du moteur)
Outils : `intensity-report.mjs`, `offside-report.mjs` (`PACE0=1` rejoue exactement 5a dans le même
code : comparaison sur les mêmes graines 100-115). Les matchs divergent dès les premières secondes
(la moindre différence d'allure change la suite) : la comparaison action par action n'a de sens
que jusqu'à la première divergence ; on compare donc les distributions sur 16 matchs.

### 1. Intensité par type d'intention (km / joueur / 90 min ; sprint = > 5,5 m/s)
| Intention | Temps | km 5a → 5b | Sprint (% du temps total) 5a → 5b | Demandes sprint / à fond 5a → 5b |
|---|---|---|---|---|
| Replacement | 80 % | 7,87 → **8,14** | 0,7 → **1,2** | 1,0 → 2,1 % (52 % non atteintes) |
| Marquage | 4 % | 0,71 → 0,76 | 0,8 → 0,8 | — |
| Autres (poursuite, coupe, receveur…) | 4 % | 0,66 → 0,73 | 0,7 → 0,8 | 3,1 → 3,6 % |
| Pressing | 4 % | 0,70 → 0,72 | 0,6 → 0,7 | 2,8 → 2,9 % |
| Repli | 2,5 % | 0,61 → 0,65 | 0,9 → 1,0 | 1,9 → 2,1 % |
| Appel | 3 % | 0,58 → 0,60 | 0,6 → 0,8 | 1,6 → 1,9 % |
| Porteur | 3 % | 0,45 → 0,48 | 0,4 → 0,4 | — |
| **Total** | | **11,58 → 12,07** | **4,8 → 5,8** | |
* Le **replacement** explique ~55 % de la hausse de distance et la moitié de la hausse du sprint.
  Il marche moins (77,9 → 71,7 %) et trottine plus (12,4 → 16,2 %) : en approche, le freinage
  calme (1,5 m/s²) laisse 2 à 3,5 m/s entre 1,5 et 4 m de la cible, là où l'ancien palier imposait
  1,9 m/s ; et la demande sprint (but menacé, > 18 m) dure jusqu'à la levée de pied (0,3 s).
* Pleine vitesse réelle (≥ 90 % de la capacité) : ~0,8 % du temps dans les deux cas ; le
  « sprint » au sens > 5,5 m/s est surtout de la course rapide. La moitié des demandes de sprint
  du replacement ne dépasse pas 5,5 m/s (déplacements trop courts pour accélérer).

### 2. Hors-jeu (16 matchs, graines 100-115)
| | 5a | 5b |
|---|---|---|
| Passes vers un joueur hors-jeu / sifflées | 4,44 / 3,56 | 6,38 / 5,25 |
| Par rôle (sifflés) | appel 3,25 · attente 0,25 · une-deux 0,06 | appel 4,63 · attente 0,31 · autres 0,31 |
| Par type de passe | en profondeur 3,25 · au sol 0,19 · levée 0,13 | en profondeur 4,63 · au sol 0,50 · levée 0,13 |
| Phase de l'appel au choix de la passe | > 1,5 s 2,31 · 0,5-1,5 s 0,81 · < 0,5 s 0,38 | > 1,5 s 3,13 · 0,5-1,5 s 1,50 · < 0,5 s 0,31 |
| Avance de l'attaquant au choix / au départ du ballon | 1,78 / 2,27 m | 1,77 / 2,21 m |
| Délai choix → départ du ballon | 0,29 s | 0,29 s |
| Vitesse de l'attaquant au choix / au départ | 3,9 / 3,4 m/s | 3,9 / 3,1 m/s |
| Ligne défensive − ballon | 24,4 m | 22,4 m |
| Temps passé en position de hors-jeu (rôle appel / attente) | 20,1 / 18,8 % | 19,3 / 20,3 % |
| Options de passe évaluées vers un appel : hors-jeu | 18,4 % | 19,0 % |
| Passes en profondeur / dont vers un hors-jeu | 40,0 / 12,8 % | 35,9 / 16,0 % |
| Pression sur le passeur (adversaire le plus proche) | 1,56 m | 1,53 m |

### 3. Attribution
* **Pas les allures des attaquants** : le temps passé en position de hors-jeu, l'avance au moment
  de la passe, le délai et la synchronisation appel / passeur sont identiques en 5a et 5b.
* **Décision du passeur** : à exposition égale, il choisit plus souvent l'attaquant hors-jeu
  (16 % des passes en profondeur contre 12,8 %). Le hors-jeu entre dans son choix par un facteur
  de perception (`offsideSeen` 0,86) ; avec une défense plus serrée en 5b (marquage 2,24 m,
  pressing 3,95 m, interceptions 102 → 111), les solutions régulières valent moins et l'appel
  hors-jeu l'emporte plus souvent. Effet indirect de l'intensité défensive sur l'IA du passeur.
* Écart significatif mais modéré : 57 → 84 hors-jeu sur 16 matchs (≈ 2,3 écarts types), forte
  variance par match (1 à 9).
* Relève de l'IA (perception du hors-jeu par le passeur, synchronisation des appels) — à traiter
  avec les appels tactiques et la stabilité des rôles, pas dans 5c.

## 5c — Modèle cinématique unique (`js/engine/body.js`) — rapport, non validé
### Principe
* **Un seul pas de vitesse** (`velocityStep`) pour le déplacement réel (`move()`) et pour la
  prédiction. La vitesse voulue vers la cible est le minimum de trois valeurs : l'allure demandée,
  le freinage voulu √(2·b·d) et 5,6 m/s à reculons. La vitesse ne change que de `acc`·dt en
  accélération (`accelOf(vit)` = 4,4 + 0,013·vit) ou de 8,5·dt en freinage, avec un facteur
  ×0,75 dans un virage serré lancé.
* **Capacité** (`topSpeed`) : la vitesse de pointe dépend de l'attribut, du trait « fusée », de la
  météo, de la fatigue et du ballon au pied. C'est la même formule que le mouvement, désormais
  utilisée aussi par `reachOpts` (avant 5c : vitesse de pointe sans fatigue ni météo).
* **Temps d'arrivée** (`timeTo`, `pursue`) : on simule ce même pas depuis l'état réel du joueur
  (position, vitesse, orientation), au pas de 0,04 s, avec un passage interpolé.
  * Il sert à la réception et à l'interception (`timeToReach`) et à la poursuite du ballon libre
    (le chasseur poursuit la position prévue du ballon qui ralentit).
  * L'ancienne formule fermée reste disponible (`timeToReachOld`) pour comparaison.
  * La perception (`react`) s'ajoute toujours.
* **Élagage exact** : un point au-delà de la distance atteignable par le modèle n'est pas simulé.
  La simulation s'arrête aussi à l'instant utile du plan, et `receivePlan` cesse de chercher quand
  l'attente seule coûte déjà plus que la meilleure option. Ces trois règles ne changent aucun
  résultat.
  * Coût de calcul : +39 % (16 matchs en 86 s contre 62 s).
* **5c-1** (extraction seule) : empreinte de match identique à 5b (d70462a6).
* **5c-2** (prédiction + virage) : nouvelle empreinte, 54a57a04.
* `__X.noturn` et `__X.oldeta` (copie de mesure, non livrés) suppriment chacun l'un des deux
  changements. Avec les deux, on retrouve d70462a6.

### Nouvelle règle physique : vitesse en virage
* **Défaut trouvé dans le mouvement réel, antérieur à 5c.** Un joueur lancé vers un point hors de
  l'axe de sa course ne ralentissait pas : il passait à côté du point puis lui tournait autour.
  Exemple : à 6 m/s, un point à 45° et 6 m demandait 2,98 s.
* **Correction.** Pour rejoindre le point, il faut un virage de rayon R = d / (2 sin θ) ; la vitesse
  y est limitée à √((acc + 1,5)·R), avec un plancher de 1 m/s. Si le point est derrière le joueur,
  celui-ci freine. Le même cas prend maintenant 1,49 s.
* La règle vaut pour le mouvement comme pour la prédiction. Elle ne touche ni les contacts ni le
  ballon.
* **Pas de coût de pivot à l'arrêt.** À l'arrêt, le modèle réel ne coûte aucun temps pour pivoter :
  le joueur part en reculant puis se retourne. La prédiction le reproduit fidèlement, et le test de
  `contact.test.js` porte désormais sur un joueur lancé. Ajouter un vrai coût de pivot serait une
  amélioration physique possible : elle n'est pas faite.

### Scénarios contrôlés (`tests/body.test.js`)
* **Couverture** : 68 cas sur 4 profils (vitesse 40, 60 ou 85, et un profil vitesse 70 avec
  énergie 55). Les scénarios :
  * départ arrêté de 3 à 40 m, face au point ou dos au point ;
  * course lancée à 6 m/s avec un virage de 45° à 180° ;
  * arrivée avec une portée de 0,3 m ;
  * poursuite d'un ballon qui ralentit.

| | Erreur moyenne | Erreur max |
|---|---|---|
| Nouveau modèle | 0,046 s | 0,079 s |
| Ancienne formule | 0,633 s | 1,449 s |

* Biais (prédit − réel) de l'ancienne formule : −0,31 s au départ arrêté, −0,56 s pour un virage de
  45°, −1,0 s à 90°, −1,4 s à 180°.
* Nouveau modèle : −0,04 à −0,07 s.
* L'ancienne formule était donc **systématiquement optimiste** : elle jugeait possibles des
  réceptions et des interceptions qui ne l'étaient pas.

### Temps d'arrivée en match (`eta-report.mjs`, 8 matchs, graines 100-107)
| | 5b (ancienne formule) | 5c |
|---|---|---|
| Plans avec marge ≥ 0 | 172 815 | 128 366 |
| Plans stables / modifiés / interrompus | 14,6 / 55,1 / 30,2 % | 20,4 / 45,6 / 34,0 % |
| Réceptions stables : erreur p10 / p90 | 0,000 / +0,116 s | −0,082 / +0,008 s |
| Réceptions stables : \|erreur\| < 0,1 s / < 0,2 s | 85 / 92 % | 84 / 94 % |
| Interceptions stables : p10 / p90 | −0,190 / +0,329 s | −0,086 / +0,118 s |
| Interceptions stables : \|erreur\| < 0,1 s / < 0,2 s | 64 / 73 % | 79 / 88 % |

* Il y a moins de plans jugés faisables (−26 %), et ils sont plus stables.
* L'erreur en match reste plus grande que dans les scénarios contrôlés, car en match :
  * le joueur ne vise pas exactement le point du plan (pied en avance, ajustements) ;
  * le plan est réévalué toutes les 0,15 s ;
  * l'arrivée est mesurée à 0,3 m.

### Défaut antérieur découvert pendant la campagne : matchs bloqués (`stall-report.mjs`)
La campagne a révélé des matchs où le jeu s'arrête pendant de longues minutes. Il y a deux causes,
toutes deux **antérieures à 5c** et présentes dans 5a et 5b.

1. **`celebrate` reste négatif après un but annulé par la VAR.**
   * À la fin de la célébration, s'il y a vérification VAR, le compteur n'est pas remis à 0.
     Si le but est refusé, le jeu reprend avec `celebrate` ≈ −0,01.
   * `ballStep`, `contestStep`, `contactStep` et `gkWatch` testent `!this.celebrate`, et une valeur
     négative non nulle compte comme vraie. Jusqu'à la fin du match :
     * aucune sortie n'est sifflée ;
     * aucun tacle n'est possible ;
     * le ballon libre ne peut plus être touché.
   * Le match se fige dès que le ballon sort ou s'immobilise.
2. **Zone morte sur les lignes.**
   * Au-delà de 0,08 m après la ligne, le ballon n'est plus jouable (`updateLoose`,
     `loosePickup`).
   * Il n'est sorti qu'au-delà de 0,10 m.
   * Un ballon qui s'arrête entre les deux (graine 101 en 5c : x = 105,09 m) n'est ni jouable ni
     sorti.

| Graines | 5b : matchs touchés | 5c : matchs touchés |
|---|---|---|
| 100-115 (`move-report` et les autres outils) | 107 (VAR) | 101 (zone morte), 110 et 115 (VAR) |
| `stats.mjs` (100-103, 200-203, 300-303, 400-403) | 200, 202, 301 (VAR) | 101 (zone morte), 202 (VAR) |

* Chaque match touché perd de 30 à 45 minutes de jeu réel.
* Les moyennes de distance, d'allures, de tacles, de fautes et de hors-jeu des étapes précédentes
  sont donc contaminées, 5b comprise. La part touchée dépend du hasard des trajectoires, pas du
  modèle. 5c n'aggrave rien : les trajectoires divergent et les buts annulés tombent ailleurs.
* Les deux corrections tiennent en une ligne chacune :
  * remettre `celebrate` à 0 à la fin de la célébration ;
  * aligner le seuil de jeu sur celui de la sortie.
* Ces corrections ont depuis été appliquées : voir « 5c — Base corrigée » plus bas.
* Essai en copie (zone morte alignée à 0,10 m) : la graine 101 se joue normalement jusqu'au bout.

### Comparaison 5b → 5c AVANT correction (historique, contaminée par les matchs bloqués)
Ces chiffres sont conservés pour mémoire. Ils ne doivent pas être mélangés avec ceux de la base
corrigée ci-dessous.

**Sur tous les matchs** (y compris les matchs bloqués) :

| | 5b | 5c |
|---|---|---|
| Distance / joueur de champ / 90 min (`move-report`) | 12,07 km | 11,22 km |
| Allures marche / trot / course / sprint | 62,9 / 18,4 / 12,8 / 5,8 % | 66,2 / 16,8 / 11,7 / 5,3 % |
| Demande sprint → réel sprint ; demande à fond → réel sprint | 34 % ; 29 % | 33 % ; 26 % |
| Pleine vitesse réelle (≥ 90 % de la capacité) | ~0,8 % | ~0,8 % |
| Marquage (médiane) | 2,24 m | 2,13 m |
| Marquage, `mark-report` 100-103 : distance / durée des épisodes / interrompus | 2,34 m / 1,66 s / 11,0 % | 2,24 m / 1,81 s / 9,0 % |
| Pressing : défenseur le plus proche du porteur | 3,95 m | 3,68 m |
| Appels collectifs, écart à la ligne au départ / à la fin / progrès | −7,87 / −2,96 / 3,60 m | −7,43 / −2,58 / 3,68 m |
| Une-deux : progrès | 10,46 m | 10,55 m |
| Appels par match / point atteint | 127 / 78 % | 122 / 79 % |
| Ballon libre : délai avant le premier contact | 1,45 s | 1,57 s |
| Sauts de cible > 3 m / joueur / min | 14,3 | 13,1 |
| Tacles / fautes / hors-jeu (`stats.mjs`) | 33,5 / 18,6 / 6,3 | 30,4 / 16,2 / 4,9 |
| Hors-jeu (`offside-report`, 100-115) : passes vers un hors-jeu / sifflés | 6,38 / 5,25 | 5,94 / 4,50 |

**Sur les matchs sains seulement** (`stall-report`, au pas 1/96 s, hors matchs bloqués) :

| | 5b | 5c |
|---|---|---|
| Graines 100-115 : distance en jeu effectif / match | 12,26 km (15 matchs) | 12,08 km (13 matchs) |
| Graines 100-115 : tacles / fautes / hors-jeu | 42,6 / 18,6 / 5,3 | 45,8 / 21,7 / 4,3 |
| Graines `stats` : distance en jeu effectif / match | 12,35 km (13 matchs) | 12,23 km (14 matchs) |
| Graines `stats` : tacles / fautes / hors-jeu | 42,2 / 20,6 / 4,5 | 39,6 / 20,0 / 6,1 |

### Lecture (avant correction, historique)
* **Distance.** La baisse brute de −7 % vient presque entièrement des matchs bloqués. Sur les
  matchs sains, la baisse est de −1 à −1,5 % (12,26 → 12,08 et 12,35 → 12,23 km). C'est cohérent
  avec la règle de virage : un joueur lancé ralentit pour tourner au lieu d'orbiter. L'intensité
  5b est donc conservée, et non corrigée artificiellement.
* **Tacles, fautes, hors-jeu.** Sur les matchs sains, les écarts changent de signe d'un jeu de
  graines à l'autre (tacles +7 % puis −6 %, hors-jeu −19 % puis +35 %). Ils ne sont pas distincts
  du bruit, et les écarts bruts sont dominés par les matchs bloqués. Aucun effet comportemental
  n'est établi.
* **Améliorations physiques.**
  * Prédiction juste dans les scénarios contrôlés (moins de 0,08 s contre 1,45 s).
  * Plans de réception et d'interception plus stables (+40 % de plans stables), erreur
    d'interception divisée par trois environ.
  * Plus d'orbite autour des cibles.
  * Marquage et pressing un peu plus serrés (2,24 → 2,13 m ; 3,95 → 3,68 m).
  * Appels inchangés (progrès 3,6 → 3,7 m).
  * Sauts de cible en légère baisse (14,3 → 13,1 par minute).
* **Régression mesurée.** Le ballon libre est touché un peu plus tard (1,45 → 1,57 s), car le
  chasseur n'est plus choisi sur une estimation optimiste. Aucune autre régression
  comportementale n'est établie.
* **Hors champ, inchangés** : hors-jeu (IA du passeur), longs ballons, penaltys, choix
  tête / contrôle / tir.
* **Tirs de la tête.** Ils passent de 20,9 à 25,4 % dans `stats.mjs` (des 16 matchs, dont des
  bloqués). Le choix tête / contrôle / tir reste documenté comme hors champ ; ce point est à
  surveiller.
* **Contrôles.**
  * Moteur rapide b47d8708 inchangé.
  * Contacts physiquement possibles à 100 % (`diag-report`).
  * Déterminisme conservé (54a57a04 ×2, diagnostic neutre).
  * Tests d'interface réussis.
  * 118 tests unitaires réussis.
* **En attente de décision** : correction des deux défauts de blocage, puis nouvelle mesure de 5b
  et 5c sur la même base. 5d n'est pas commencée.

## 5c — Base corrigée : 5b corrigée (nouvelle référence) → 5c corrigée — rapport, non validé
### Correctif minimal (`live.js`, avant validation de 5c)
* **Célébration.** À la fin de la célébration, le compteur `celebrate` est remis à 0 dans tous les
  cas : but validé, but annulé par la VAR ou but sans VAR. C'est l'unique état global décompté
  avec `-= dt` et testé comme booléen. `varT` n'est testé que par `> 0`, et le compteur individuel
  `p.celeb` est borné à 0. Aucun autre état de célébration ne peut bloquer le moteur.
* **Lignes.** Un seul seuil, `OUT_M` = 0,10 m, s'applique à la jouabilité (`updateLoose`,
  `loosePickup`) et à la sortie (`ballStep`). Il n'y a plus de zone morte, et la sortie n'est pas
  avancée : le ballon reste jouable jusqu'à 0,10 m au-delà de la ligne.
* Rien d'autre ne change : ni la physique du ballon, ni les contacts, ni les comportements.
* **Tests** (`tests/rules.test.js`). Trois d'entre eux échouent si l'on retire le correctif.
  * Ballon arrêté avant la ligne, sur la ligne, ou jusqu'à 0,10 m au-delà : il est joué.
  * Au-delà de 0,10 m : sortie immédiate, et la remise (touche, six mètres ou corner) va au bon
    camp selon le dernier toucheur.
  * Ballon qui franchit la ligne à 3, 6, 8, 12, 15 ou 20 m/s : sifflé au premier pas au-delà de
    0,10 m, jamais avant.
  * But annulé, confirmé ou sans VAR : le compteur revient à 0, sans jamais devenir négatif. Le
    score est correct et la reprise aussi (coup franc ou engagement).
  * Après un but annulé, 10 minutes de jeu : les sorties sont sifflées, les tacles et les contacts
    sur ballon libre ont lieu, et le ballon libre n'est jamais immobile plus de 5 s.
* **Empreintes de match** (graine 5, 20 min). Le correctif change les deux versions, car un ballon
  arrêté entre 0,08 et 0,10 m est maintenant joué.
  * 5b : d70462a6 → 901a8739.
  * 5c : 54a57a04 → 112bd1dc.
  * Moteur rapide : b47d8708, inchangé.
* **Référence 5b corrigée** : la 5b d'origine plus ces deux seules corrections, mesurée avec les
  mêmes outils.

### Matchs bloqués et temps de jeu réel (`stall-report`, pas 1/96 s, 28 matchs par version)
Graines utilisées : 100-115, 200-203, 300-303 et 400-403.

| | 5b corrigée | 5c corrigée |
|---|---|---|
| Matchs bloqués (ballon libre immobile > 5 s) | 0 / 28 | 0 / 28 |
| Temps avec `celebrate` < 0 | 0 s | 0 s |
| Jeu effectif, graines 100-115 : moyenne (min-max) | 64,7 min (58,3-74,3) | 66,8 min (61,2-72,5) |
| Jeu effectif, graines `stats` : moyenne (min-max) | 64,0 min (58,9-71,7) | 65,5 min (60,0-73,6) |
| Durée simulée par match | 99-102 min | 98-101 min |

Jeu effectif par match (min), 5b corrigée → 5c corrigée :

| Graine | 100 | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5b corrigée | 71,7 | 61,9 | 59,6 | 66,2 | 74,3 | 68,0 | 62,0 | 68,1 | 58,3 | 65,8 | 60,6 | 59,7 | 61,6 | 65,1 | 64,8 |
| 5c corrigée | 71,0 | 61,7 | 62,4 | 63,6 | 71,0 | 69,7 | 67,7 | 67,9 | 63,2 | 71,8 | 66,2 | 61,2 | 63,3 | 69,2 | 72,5 |

| Graine | 115 | 200 | 201 | 202 | 203 | 300 | 301 | 302 | 303 | 400 | 401 | 402 | 403 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5b corrigée | 66,8 | 63,5 | 62,3 | 58,9 | 66,7 | 59,6 | 60,1 | 67,9 | 67,7 | 59,0 | 65,5 | 67,3 | 65,7 |
| 5c corrigée | 66,7 | 69,4 | 65,5 | 63,7 | 66,6 | 65,6 | 62,8 | 73,6 | 68,5 | 60,0 | 64,5 | 68,6 | 60,7 |

### Comparaison 5b corrigée → 5c corrigée
Mêmes graines, mêmes outils, mêmes paramètres et mêmes définitions.

| | 5b corrigée | 5c corrigée |
|---|---|---|
| Distance / joueur de champ / 90 min (`move-report`, 100-115) | 12,29 km | 12,07 km (−1,8 %) |
| Distance en jeu effectif (`stall-report`, 28 matchs) | 12,38 km | 12,14 km (−2,0 %) |
| Distance des 22 joueurs (`stats.mjs`) | 231,4 km | 229,9 km |
| Allures marche / trot / course / sprint | 62,1 / 18,8 / 13,1 / 6,0 % | 63,2 / 18,4 / 12,7 / 5,7 % |
| Demande sprint → réel sprint ; demande à fond → réel sprint | 34 % ; 29 % | 34 % ; 27 % |
| Intensité : replacement / marquage / pressing / repli / appel (km/j/90) | 8,27 / 0,78 / 0,72 / 0,67 / 0,61 | 8,24 / 0,75 / 0,73 / 0,61 / 0,60 |
| Marquage, médiane (`move-report`) | 2,24 m | 2,09 m |
| Marquage, `mark-report` 100-103 : distance / durée des épisodes / interrompus | 2,30 m / 1,67 s / 10,9 % | 2,15 m / 1,59 s / 9,5 % |
| Pressing : défenseur le plus proche du porteur | 3,95 m | 3,74 m |
| Appels collectifs : écart à la ligne au départ / à la fin / progrès | −6,94 / −2,54 / 3,59 m | −6,60 / −1,80 / 3,59 m |
| Une-deux : progrès | 10,52 m | 10,57 m |
| Appels par match / point d'appel atteint | 124 / 78 % | 129 / 79 % |
| Ballon libre : délai avant le premier contact (médiane) | 1,48 s | 1,52 s |
| Sauts de cible > 3 m / joueur / min | 14,5 | 14,0 |
| Tacles / fautes (`stats.mjs`) | 32,3 / 19,5 | 30,9 / 17,6 |
| Tacles / fautes (`stall-report`, 28 matchs) | 43,8 / 19,2 | 42,8 / 18,1 |
| Hors-jeu (`stats.mjs`) | 5,8 | 5,8 |
| Hors-jeu (`offside-report`, 100-115) : passes vers un hors-jeu / sifflés | 6,00 / 4,63 | 6,00 / 5,00 |
| Hors-jeu (`stall-report`, 28 matchs) | 4,96 | 4,75 |
| Tirs / cadrés / buts (`stats.mjs`, pas 0,05 s) | 18,3 / 7,9 / 4,2 | 17,7 / 8,6 / 4,9 |
| Tirs / buts (`stall-report`, pas 1/96 s, 28 matchs) | 20,2 / 3,9 | 16,9 / 3,3 |
| Part des tirs de la tête (`stats.mjs`) | 25,3 % | 24,7 % |
| Tirs de la tête / du pied par match (`header-report`, 100-115) | 5,13 / 11,13 | 3,81 / 11,94 |
| Têtes sur corner / sur centre en jeu (`header-report`) | 0,94 / 3,38 | 0,38 / 2,69 |
| Centres (`header-report`) | 25,8 | 22,1 |
| Passes (`stall-report`, 28 matchs) | 841 | 879 |
| Jeu effectif (`stats.mjs`) | 64,7 min | 65,1 min |

**Temps d'arrivée en match** (`eta-report`, 8 matchs, graines 100-107) :

| | 5b corrigée (ancienne formule) | 5c corrigée |
|---|---|---|
| Plans avec marge ≥ 0 | 178 235 | 144 741 (−19 %) |
| Plans stables / modifiés / interrompus | 14,6 / 55,2 / 30,2 % | 19,4 / 46,2 / 34,4 % |
| Réceptions stables : erreur p10 / p90 | 0,000 / +0,131 s | −0,076 / +0,010 s |
| Réceptions stables : \|erreur\| < 0,1 s / < 0,2 s | 85 / 92 % | 84 / 94 % |
| Interceptions stables : p10 / p90 | −0,047 / +0,404 s | −0,075 / +0,182 s |
| Interceptions stables : \|erreur\| < 0,1 s / < 0,2 s | 64 / 74 % | 80 / 86 % |

**Écarts mesurés sur 28 matchs** (`stall-report`) : l'écart de moyenne divisé par son erreur type
donne z, et |z| ≈ 2 correspond à la limite de ce que le hasard des trajectoires explique.

| | Écart 5c − 5b | z |
|---|---|---|
| Jeu effectif | +3,3 % | 2,0 |
| Distance en jeu effectif | −2,0 % | −2,3 |
| Tirs | −16 % | −2,1 |
| Buts | −15 % | −1,4 |
| Passes | +4,5 % | 1,6 |
| Fautes | −6 % | −0,9 |
| Tacles | −2 % | −0,4 |
| Hors-jeu | −4 % | −0,3 |

### Revalidation
* **Scénarios contrôlés** (68 cas, `body.test.js`) : erreur moyenne 0,046 s, max 0,079 s, donc
  toujours sous 0,1 s. L'ancienne formule donne 0,633 et 1,449 s. La poursuite d'un ballon qui
  ralentit reste sous 0,1 s.
* **Plans de réception et d'interception** : plus de plans stables (14,6 → 19,4 %). L'erreur en
  match est centrée et resserrée, comme le montre le tableau ci-dessus.
* **Mouvement réel et prédiction** : le même pas `velocityStep` sert aux deux. Le biais résiduel
  est de −0,04 à −0,07 s dans les scénarios contrôlés.
* **Contacts physiquement possibles à 100 %** (`diag-report`) : réception, conduite,
  récupération, duel, déviation, interception et contre.
* **Déterminisme** : 112bd1dc deux fois, diagnostic neutre, et la graine change bien le résultat.
* **Tests** : moteur rapide b47d8708 inchangé ; 123 tests unitaires réussis (118 + 5 règles) ;
  tests d'interface réussis.
* Les outils sont conservés : `intensity-report`, `offside-report`, `stall-report` (qui donne
  maintenant aussi le jeu effectif et la durée par match) et `PACE0=1`.

### Lecture
* **Blocages.** Aucun match bloqué sur les 28 graines, dans les deux versions. Le jeu effectif est
  régulier, entre 58 et 74 minutes par match.
* **Physique (améliorations).**
  * Prédiction juste dans les scénarios contrôlés.
  * Plans plus stables, avec une erreur d'interception divisée par deux environ (p90 +0,40 →
    +0,18 s).
  * Plus d'orbite autour des cibles.
* **Intensité.** La distance baisse de 1,8 à 2 % (z ≈ −2, à la limite du bruit), et la part de
  sprint passe de 6,0 à 5,7 %. C'est cohérent avec la règle de virage : un joueur lancé ralentit
  pour tourner au lieu de tourner autour du point. L'intensité 5b est conservée, et aucune
  compensation n'a été ajoutée.
* **IA (inchangée, effets indirects).**
  * Marquage et pressing un peu plus serrés (2,24 → 2,09 m ; 3,95 → 3,74 m).
  * Appels inchangés (progrès 3,59 m) et un peu plus nombreux à atteindre la ligne (fin à −1,80 m
    contre −2,54 m).
  * Sauts de cible en légère baisse.
* **Tacles, fautes et hors-jeu.** Les écarts restent dans le bruit (|z| < 1). Les fautes baissent
  dans les trois mesures (−6 à −10 %), mais sans écart distinct du hasard. À surveiller.
* **Régressions possibles, à examiner avant validation.**
  * **Tirs.** −16 % au pas 1/96 s (20,2 → 16,9, z ≈ −2,1), mais seulement −3 % dans `stats.mjs`
    au pas 0,05 s. La baisse porte surtout sur les têtes : 5,13 → 3,81 par match, dont celles sur
    corner (0,94 → 0,38) et sur centre (3,38 → 2,69). Les centres baissent aussi (25,8 → 22,1).
    Explication plausible, non démontrée : la prédiction n'étant plus optimiste, les attaquants ne
    se jugent plus à temps pour des ballons aériens qu'ils n'auraient pas pu atteindre. Le choix
    tête / contrôle / tir et les rebonds de ballon levé restent hors champ de 5c.
  * **Jeu effectif.** +3,3 % (64,2 → 66,4 min, z ≈ 2,0). C'est cohérent avec moins de tirs, donc
    moins de six mètres (17,3 → 14,8 dans `stats.mjs`).
  * **Ballon libre.** Le premier contact arrive un peu plus tard (1,48 → 1,52 s, contre 1,45 →
    1,57 s avant correction) : le chasseur n'est plus choisi sur une estimation optimiste.
* **Non validé.** 5c n'est pas déclarée validée et 5d n'est pas commencée. La baisse des tirs,
  surtout de la tête, est le point à trancher. Voir le diagnostic ci-dessous : à 1/96 s, cette
  baisse est en grande partie un effet d'échantillon et de mesure.

## 5c — Diagnostic des tirs (5b corrigée → 5c corrigée) — rapport, non validé
Aucune modification du moteur dans cette partie : observation seulement. Deux outils ont été
ajoutés et l'attribution de `header-report` a été corrigée (voir 1).
* `aerial-report.mjs` : ballons aériens dans la surface, attaquants en position, tentatives, têtes
  et renoncements. Il mesure aussi les fautes : tacles, contacts sur l'homme, vitesse relative,
  intensité.
* `shot-report.mjs` : décisions du porteur près du but (pression, xG estimé, choix), entrées dans
  la surface et issue des passes vers la surface.

Définition commune de la **vérité physique** dans ces outils : le modèle cinématique 5c (validé à
moins de 0,08 s contre le mouvement réel) dit si un joueur peut amener sa tête (ou son pied) sur
un point de la trajectoire prédite du ballon à temps. Le calcul part de son état réel au départ du
ballon, avec une réaction de 0,18 s et une portée de 0,3 m. Les mêmes formules servent pour toutes
les versions mesurées. Les deux outils ne changent rien au match : sur la graine 100, on retrouve
exactement les tirs, fautes et temps de jeu de `stall-report`.

Versions comparées (pas du jeu : 1/96 s, sauf mention) :
* 5b corrigée ;
* 5c corrigée ;
* deux ablations de 5c (copie de mesure, non livrée) :
  * « prédiction seule » : 5c sans la règle de virage ;
  * « virage seul » : 5c avec l'ancienne prédiction.
  * Les deux ablations réunies redonnent exactement 5b corrigée (901a8739).

Graines :
* les 28 de la campagne précédente (100-115, 200-203, 300-303, 400-403) ;
* **56 graines nouvelles (500-555)** pour la réplication.

### 1. Les deux mesures de tirs, et le pas de simulation
* **Même définition.** `stats.mjs` et `stall-report` comptent tous deux `team.stats.shots` (même
  événement, mêmes graines `stats`). Seul le pas diffère : 0,05 s dans `stats.mjs` et
  `header-report`, 1/96 s dans `stall-report` et dans le jeu (`LIVE_STEP`).
* **Le pas change le match.** Avec le même code et la même graine, le match n'est pas le même :
  les trajectoires divergent. Le pas de 0,05 s ne sert qu'aux outils de mesure.
* **L'écart venait surtout de l'échantillon 5b.** Sur les 28 graines d'origine, 5b corrigée donne
  20,0 tirs à 1/96 s (erreur type ±1,3). Sur 56 graines nouvelles, elle en donne 18,1 (±0,8).

| Tirs par match | 5b corrigée | 5c corrigée | Écart |
|---|---|---|---|
| 1/96 s, 28 graines d'origine | 20,0 ± 1,3 | 16,8 ± 0,9 | −16 % |
| 1/96 s, 56 graines nouvelles | 18,1 ± 0,8 | 17,3 ± 0,9 | −4 % (dans le bruit) |
| **1/96 s, les 84 matchs** | **18,7** | **17,1** | **−8,5 % (z ≈ −1,7)** |
| 0,05 s, 28 graines (`aerial-report`) | 17,5 ± 1,1 | 16,4 ± 1,0 | −7 % |
| 0,05 s, 16 graines `stats` (`stats.mjs`) | 18,3 | 17,7 | −3 % |
| Ablations à 1/96 s, 28 graines d'origine | prédiction seule : 16,9 | virage seul : 17,4 | |

* **Têtes au but.** Elles ne baissent qu'au pas de 0,05 s :
  * 0,05 s : 4,93 → 3,93 (−20 %), avec la même tendance dans les deux ablations (4,32 et 4,18) ;
  * 1/96 s, sur les 84 matchs : 5,04 → 4,95 (−2 %) ;
  * 1/96 s, graines nouvelles : 4,96 → 5,14.
  * La baisse des têtes rapportée jusqu'ici (`header-report`, `stats.mjs`) a été mesurée au pas de
    0,05 s, qui n'est pas celui du jeu. Ces outils ne doivent pas servir à juger les situations
    aériennes de 5c.
* **Défaut de mesure trouvé dans `header-report`.**
  * Il classait un tir « sur corner » s'il survenait dans les 8 s suivant l'*apparition* du corner.
  * Or la mise en place d'un corner dure environ 32 s : 100 % des corners sont joués après 8 s.
  * Le « 0,94 → 0,38 tête sur corner » n'était donc pas une mesure de corners.
  * Corrigé : on compte maintenant à partir du moment où la remise est *jouée*. Le résultat
    devient 0,63 → 0,75 tête sur corner (16 matchs, 0,05 s).

### 2. Ventilation des situations aériennes (`aerial-report`, 1/96 s)
| Par match | 5b corrigée (28 / 56 graines) | 5c corrigée (28 / 56 graines) |
|---|---|---|
| Corners | 9,86 / 8,36 | 7,43 / 8,73 |
| Centres | 28,6 / 27,3 | 26,5 / 27,1 |
| Ballons levés jouables de la tête dans la surface | 36,7 / 33,4 | 34,1 / 34,1 |
| … avec au moins un attaquant en position | 23,1 / 20,5 | 20,8 / 21,7 |
| Attaquants à moins de 25 m | 135 / 123 | 117 / 123 |
| Attaquants en position (vérité physique) | 46,4 / 41,7 | 38,1 / 43,2 |
| Jugés à portée par l'ancienne formule | 61,3 / 54,4 | 50,5 / 56,3 |
| Tentatives de tête (plan de tête) | 48,1 / 42,0 | 29,4 / 34,4 |
| … réalistes (en position) | 33,7 / 30,0 | 26,5 / 31,1 |
| … **irréalistes (hors de portée physique)** | **14,4 / 12,0** | **2,9 / 3,3** |
| Contacts tête-ballon des attaquants | 8,04 / 7,70 | 6,82 / 7,71 |
| … d'attaquants hors de portée au départ du ballon | 1,57 / 1,25 | 0,57 / 0,66 |
| … d'attaquants en position | 6,46 / 6,45 | 6,25 / 7,05 |
| Têtes au but | 5,21 / 4,96 | 4,57 / 5,14 |

**Renoncements** (attaquants proches qui ne touchent pas le ballon), par match, 56 graines
nouvelles :

| | 5b corrigée | 5c corrigée |
|---|---|---|
| Inatteignable, non envoyé | 50,8 | 56,5 |
| Atteignable, mais mal évalué par l'estimation de la version | 0,09 | 0 |
| Atteignable, non envoyé (règles de sélection : 20 m du but, 2 meilleurs, passes levées hors centre) | 4,9 | 4,2 |
| Atteignable, envoyé pour un autre geste (laisser retomber, contrôle) | 6,1 | 7,3 |
| Tête tentée, devancé par un autre joueur (atteignable) | 17,2 | 17,8 |
| Tête tentée, devancé (inatteignable) | 7,5 | 1,8 |
| Tête tentée, arrivé trop tard (atteignable) | 4,8 | 4,9 |
| Tête tentée, arrivé trop tard (inatteignable) | 2,8 | 0,8 |
| Ballon dans sa zone de tête, ne le joue pas | 1,7 | 1,6 |

* **Hypothèse physique vérifiée.**
  * L'ancienne formule jugeait à portée environ 30 % d'attaquants de plus que la vérité physique.
  * En 5b, 12 à 14 tentatives de tête par match visaient des ballons hors de portée. Elles
    donnaient 1,3 à 1,6 tête par match, obtenues par des attaquants qui ne pouvaient pas être
    là : déplacement sans limite de virage, ou estimation optimiste.
  * En 5c, ces tentatives tombent à environ 3 par match, et les têtes qu'elles donnent à environ
    0,6.
  * Les tentatives réalistes ne baissent pas sur les graines nouvelles (30,0 → 31,1), et leurs
    contacts augmentent (6,27 → 6,77).
* **Pas de prudence excessive.** Les attaquants atteignables que l'estimation 5c écarte à tort
  sont 0 par match. Les ballons atteignables non joués relèvent des mêmes règles de sélection
  qu'en 5b, à des niveaux proches.
* **Taux par ballon jouable et par centre** (84 matchs, 1/96 s) :
  * têtes au but par ballon jouable : 0,146 → 0,145 ;
  * têtes au but par centre : 0,182 → 0,184.

### 3. Tirs au pied et occasions (`shot-report`, 1/96 s)
| | 5b corrigée (28 / 56) | 5c corrigée (28 / 56) |
|---|---|---|
| Tirs / 90 min de jeu effectif | 28,0 / 24,5 | 22,8 / 23,5 |
| Décisions du porteur dans la surface / match | 25,6 / 24,3 | 19,5 / 19,1 |
| … dont frappe | 17,8 / 13,8 % | 19,4 / 18,2 % |
| … pression (adversaire le plus proche) / xG estimé de la frappe | 1,92 m / 0,159 | 1,91 m / 0,162 |
| Décisions à 16-25 m / match ; dont frappe | 25,7 ; 41,5 % | 22,7 ; 40,7 % |
| **Séquences du porteur dans la surface / match** | **29,9 / 27,3** | **22,9 / 22,2 (−20 %)** |
| Entrées en conduite | 16,4 / 15,3 | 13,9 / 13,1 |
| Entrées sur passe en profondeur | 1,25 / 1,20 | 0,79 / 0,55 |
| Entrées sur ballon libre | 7,0 / 5,7 | 4,3 / 4,6 |

* **Le choix de frapper n'a pas changé.** À situation égale, la part de frappes, la pression subie
  et l'xG estimé sont les mêmes, voire un peu plus de frappes en 5c. Ce n'est ni une régression de
  décision ni un effet du pressing au moment du tir.
* **Ce qui baisse, c'est l'accès à la surface avec le ballon (−20 %, reproduit sur les deux jeux
  de graines).** Les ablations (26,8 et 26,5 séquences) montrent que les deux composantes y
  contribuent.
* **Passes en profondeur vers la surface** (56 graines nouvelles), selon la portée réelle du
  destinataire au départ du ballon :

| Destinataire au départ | 5b : passes → partenaire / défenseur | 5c : passes → partenaire / défenseur |
|---|---|---|
| à portée (0,3 m) | 4,84 → 1,84 (38 %) / 2,57 (53 %) | 5,54 → 1,46 (26 %) / 3,41 (62 %) |
| seulement jambe tendue (0,8 m) | 0,86 → 0,27 / 0,34 | 0,98 → 0,18 / 0,57 |
| hors de portée | 2,23 → 0,21 / 0,82 | 2,73 → 0,09 / 0,84 |

  * Le passeur (IA inchangée) vise 6 m devant l'appel, avec une estimation fixe du temps des
    défenseurs. Il ne vérifie pas que le receveur peut atteindre le ballon : 28 à 30 % de ses
    passes en profondeur sont hors de portée physique, en 5b comme en 5c.
  * La portée de 0,3 m des plans n'écarte presque rien d'atteignable : 0,09 passe par match est
    jugée hors de portée alors qu'elle était atteignable jambe tendue.
  * Sur les passes atteignables, **les défenseurs l'emportent plus souvent en 5c**. C'est cohérent
    avec la meilleure prédiction d'interception (interceptions à moins de 0,1 s du réel : 64 → 80 %).

### 4. Mesures complémentaires
* **Tirs rapportés au jeu effectif** (84 matchs) : 25,7 → 23,3 / 90 min (−9 %). Le jeu effectif
  passe de 65,7 à 66,4 min.
* **Tirs rapportés aux occasions aériennes** : inchangés (voir 2).
* **Fautes.**
  * Nombre par match : 19,6 → 18,7 (−5 %, 84 matchs).
  * Ablations (28 graines) : virage seul 17,2 ; prédiction seule 20,5. **C'est la règle de virage
    qui les fait baisser.**
  * Contacts sur l'homme : autant qu'avant (24,5 / 26,0 → 24,8 / 25,3 par match), mais sifflés
    moins souvent (78,5 / 76,3 % → 73,2 / 75,0 %).
  * Ce qui change dans ces contacts :
    * porteur moins rapide : 3,65 → 3,43 m/s ;
    * contacts par derrière : 18,7 → 15,2 % ;
    * tacles glissés : 29 → 23 % des contacts (18,3 → 13,6 tentés par match).
  * Ce sont les termes de l'intensité du contact jugée par l'arbitre. La formule du coup de
    sifflet est inchangée. Conséquence physique de la limite de vitesse en virage, aucune
    correction.

### 5. Conclusion du diagnostic
1. **Artefacts de mesure.**
   * La baisse des têtes au but n'existe qu'au pas de 0,05 s des outils. Au pas du jeu, sur 84
     matchs : 5,04 → 4,95.
   * La catégorie « tête sur corner » de `header-report` était fausse (corrigée).
   * Le −16 % de tirs de la première campagne venait en bonne partie d'un échantillon 5b haut : sur
     56 graines nouvelles, l'écart est de −4 %.
2. **Conséquence physique réaliste.**
   * Les tentatives de tête vers des ballons physiquement hors de portée passent de 12-14 à environ
     3 par match.
   * Les têtes obtenues depuis une position impossible passent de 1,3-1,6 à 0,6.
   * Les tentatives réalistes et les têtes au but par ballon jouable sont conservées.
   * Les fautes baissent parce que les contacts sont moins violents.
3. **Changement de comportement à surveiller, non corrigé.**
   * Le porteur arrive 20 % moins souvent dans la surface, ce qui donne −8,5 % de tirs sur 84
     matchs (à la limite du bruit).
   * La décision de tirer est intacte.
   * La baisse vient de l'accès à la surface :
     * passes en profondeur gagnées plus souvent par les défenseurs, grâce à une meilleure
       prédiction ;
     * moins d'entrées en conduite ;
     * moins de ballons libres dans la surface.
   * Le seul défaut identifié est hors du champ de 5c : le passeur choisit des passes en profondeur
     sans vérifier la portée du receveur (IA du passeur, chantier hors-jeu / longs ballons).

Aucun paramètre de tir, de choix tête / contrôle / frappe ou de décision tactique n'a été modifié.
5c n'est pas déclarée validée, et 5d n'est pas commencée.
