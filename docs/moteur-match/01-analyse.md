# Moteur de match en direct — Étape 1 : analyse de l'architecture existante

*Coach de Poche — analyse menée avant toute refonte. Les chiffres viennent de mesures sur des
matchs simulés par le moteur actuel (outils de banc d'essai décrits en fin de document).*

## 1. Cartographie

| Fichier | Lignes | Rôle actuel |
|---|---|---|
| `js/engine/live.js` | ~2 400 | **Tout** le moteur en direct : placement des 22 joueurs, IA du porteur, duels, passes, tirs, gardien, coups de pied arrêtés, déplacements, collisions, statistiques. Une seule classe `LiveSim`. |
| `js/ui/ballPhysics.js` | ~220 | Physique du ballon : gravité, traînée, effet Magnus, rebonds, roulement, poteaux, filets, `solveKick` (trouve la vitesse initiale pour atteindre un point). **Bonne base, à conserver.** |
| `js/engine/positions.js` | ~60 | Position « formation » d'un joueur selon la position du ballon et la tactique. |
| `js/engine/match.js` | ~1 260 | Moteur **rapide** par événements (matchs non regardés) + fonctions partagées (événements, stats, cartons, changements, causeries). |
| `js/ui/matchView.js` | ~1 790 | Pilote l'écran : avance `LiveSim` par pas fixes de 1/96 s, temps forts, accéléré, ralentis, 2D. |
| `js/ui/match3d.js` | ~3 070 | Rendu 3D : stade, caméra, et **animation procédurale** des joueurs (`Player3D.pose`) déduite de l'état de la simulation. |
| `js/ui/mhPlayer.js` | ~260 | Corps réaliste (maillage skinné) qui suit les mêmes os que le modèle simplifié. |

Flux d'une image : `matchView.frame` → `LiveSim.step(1/96)` × n → `match3d.render` qui lit
`players` / `ball` (objets **partagés et mutés** par la simulation) et pose les corps.

## 2. Problèmes d'architecture

### 2.1 Les résultats sont tirés au sort AVANT que le ballon parte (cause n° 1 d'« illogique »)

* **Passe** (`doPass`) : `ok = rand() < o.p` est décidé au moment de la frappe. Si la passe
  « rate », le moteur **choisit un intercepteur** et **dirige le ballon vers lui** (`to = worst.o`).
  Le défenseur ne coupe pas la trajectoire : c'est la trajectoire qui va vers le défenseur.
  → Récupérations « aléatoires », défenseurs qui reçoivent des passes qui ne leur étaient pas
  destinées.
* **Tir** (`doShot`) : l'issue (`goal` / `saved` / `post` / `wide` / `blocked`) est tirée au sort,
  puis on calcule la trajectoire qui produit cette issue. Le plongeon du gardien est **programmé**
  pour coller au résultat (`diveDelay`). Un ballon qui entre dans le but sans issue « but » est
  éjecté sur la ligne.
* **Tacle** (`updateDefense`) : à moins de 1,4–2 m, un tirage au sort décide faute / ballon gagné /
  dribble. Le ballon est alors **attribué** au tacleur (`gain`), sans contact réel.

Conséquence : la physique du ballon (qui est bonne) ne décide de rien. Elle ne fait que
« jouer » un résultat déjà connu. C'est pour ça que les corrections visuelles s'accumulent :
on maquille une décision abstraite.

### 2.2 Il n'y a pas de contact pied–ballon : le ballon est « aimanté »

Mesures sur un match complet :

| Moment | Distance pied → ballon (médiane / p90) |
|---|---|
| **Réception d'une passe** | **1,88 m / 1,94 m** |
| Récupération d'un ballon libre | 1,38 m / 1,93 m |
| Conduite de balle (en continu) | 0,67 m / 1,74 m (max 4,4 m) |
| Tacle réussi (tacleur → porteur) | 1,12 m / 1,57 m |
| Départ d'une passe ou d'un tir | 0,13 m / 0,30 m ✔ |

* La réception se déclenche dans un **rayon de 1,35 à 1,9 m** (`reach` dans `updateLoose`) :
  le ballon est ensuite **tiré vers le pied** (`glued`, interpolation vers `foot()`).
  À l'écran : le joueur ne touche pas le ballon, le ballon vient à lui.
* Le « pied » est un point fixe `foot(p, d)` devant le joueur, avec **six distances différentes**
  selon l'endroit du code (0,3 / 0,4 / 0,45 / 0,5 / 0,55 m), sans lien avec la jambe animée.
* Les départs de passes et de tirs sont, eux, corrects : le ballon part quand l'animation de la
  jambe est à 57 % (instant du contact), à ~13 cm du pied.

### 2.3 « Hitbox » incohérentes

Il n'existe pas de forme physique du joueur. Chaque règle a son propre seuil, codé en dur :
contact entre joueurs 1,0 m, tacle 0,9 / 1,4 / 2,0 m, réception 1,35 / 1,9 m, tête 1,4 m,
captage du gardien 1,6 / 2,2 m, vol de balle 0,6 m, porteur trop loin 4,5 m… On relève plus de
70 comparaisons de distance « magiques » dans `live.js`. Deux systèmes peuvent donc se
contredire : un joueur « touche » le ballon pour une règle et pas pour une autre.

### 2.4 Plusieurs systèmes écrivent la même cible de déplacement

La cible `p.tx / p.ty` d'un joueur est réécrite par **17 fonctions** dans le même pas de
simulation, dans un ordre implicite : `_positioning` (15 écritures), `restartPositions` (16),
`updateHolder` (7), `buildUpShape` (6), `updateLoose`, `steadyTargets`, `wideRuns`, `findSpace`,
`defensiveLine`, `doPass`, `doShot`, `doCross`, `goal`, `kickoffTargets`, `idle`, `move`, `tick`.
Les « rôles » (`press`, `cover`, `mark`, `support`, `run`…) sont recalculés toutes les 0,3 s
sans état persistant ; l'hystérésis a été ajoutée au cas par cas. C'est la source des
placements « affolants » : le dernier qui écrit gagne.

### 2.5 La vitesse est décidée ailleurs que la décision

`move()` contient une longue cascade de plafonds de vitesse par rôle, par distance à la cible,
par menace, par état « au repos ». La décision (où aller) et l'allure (à quelle vitesse) sont
séparées et se contredisent régulièrement (cible lointaine + plafond de marche, etc.).

### 2.6 Les animations devinent l'action au lieu de la recevoir

Le moteur expose des **minuteurs** (`kick`, `ctrl`, `slide`, `touch`, `dive`, `jump`, `fall`,
`bump`…, ~15 champs). Le rendu (`Player3D.pose`) les interprète et **reconstitue** le reste :
sens de course (marche avant / arrière / pas chassés), inclinaison à l'accélération, pied
d'appui… Plusieurs corrections récentes (fin du « moonwalk », bras, gardien) ont été faites
côté rendu parce que l'information n'existe pas côté moteur. Le moteur et l'animation n'ont pas
de **contrat commun** (phase d'action, instant de contact, pied utilisé, hauteur du contact).

### 2.7 Unités et repères mélangés

Les joueurs sont en coordonnées **normalisées** (0–1), le ballon en **mètres**, le rendu dans
un repère centré et éventuellement **retourné** (`flip`). Chaque calcul convertit (`* L`, `* W`),
ce qui multiplie les risques d'erreur (ex. vitesses et cibles en unités différentes).

### 2.8 Deux moteurs, deux calibrages

Le moteur rapide (`match.js`) et le moteur en direct (`live.js`) produisent les mêmes
statistiques par des chemins différents. Le direct est calibré par **~25 paramètres globaux**
(`TUNE` : `lossW`, `keepW`, `shotW`, `xg`, `finish`, `onTarget`…) qui compensent les défauts
structurels ci-dessus. Résultat : les moyennes sont justes, mais pour de mauvaises raisons, et
chaque correction en déplace d'autres.

### 2.9 Ce qui fonctionne et sera conservé

* `ballPhysics.js` (trajectoires, effet, rebonds, filets, `solveKick`).
* Le pas de simulation fixe et le hasard déterministe (rejouer un match à l'identique, matchs en ligne).
* La boucle de décision du porteur par utilité (bonne idée, mauvaises entrées).
* Le synchronisme frappe ↔ jambe (contact à ~57 % du geste).
* Les données joueurs (attributs, rôles, traits, tactiques) et tout l'habillage (caméra, foule, HUD).
* Les outils de mesure (stats d'un match moyen, audit d'anomalies, géométrie des contacts).

## 3. Problèmes prioritaires

1. **Contact pied–ballon réel** : le ballon ne doit changer de propriétaire que lorsqu'il entre
   physiquement dans la zone d'atteinte du joueur, à l'instant d'un geste.
2. **Issues émergentes** : passes, tirs, interceptions et arrêts doivent résulter de la
   trajectoire (erreur d'exécution appliquée à la frappe) et des joueurs qui l'atteignent ou non.
3. **Un seul propriétaire de la cible de chaque joueur** par pas (intention unique).
4. **Contrat moteur → animation** (phase d'action, instant de contact).
5. **Comportement collectif** piloté par un état d'équipe (phase de jeu, hauteur du bloc,
   affectations persistantes) plutôt que par 17 retouches.

## 4. Architecture cible (proposition)

```
WORLD (mètres, pas fixe 1/96 s, hasard déterministe)
 ├─ Ball      : ballPhysics.js (inchangé)
 ├─ Body      : cinématique joueur (accélération, freinage, rayon de virage selon les attributs),
 │              orientation distincte de la vitesse, capsule de collision unique (r ≈ 0,35 m)
 └─ Contact   : zone d'atteinte du pied / de la tête / des mains selon le geste et sa phase ;
                un toucher n'existe que si le ballon y est à l'instant du contact
ACTIONS (une machine à états par joueur) : Se déplacer, Recevoir, Conduire, Passer, Tirer,
 Centrer, Tacler, Jouer de la tête, Gardien (placement, plongeon, captage, parade)
 Chaque action : approche → armé → CONTACT (événement daté) → récupération.
 Le résultat d'un contact applique une impulsion au ballon avec une erreur d'exécution qui
 dépend des attributs, de la pression, du pied, de l'équilibre.
IA ÉQUIPE : phase de jeu (construction, progression, finition, bloc haut/médian/bas, transitions),
 hauteur et largeur du bloc, affectations persistantes (presseur, couverture, marquages).
IA JOUEUR : le porteur choisit parmi des options évaluées avec des prédictions physiques
 (temps d'arrivée des adversaires sur la trajectoire) ; les autres choisissent une INTENTION
 (se proposer, appel, fixer, couvrir, marquer, coulisser) → une seule cible + une allure.
ÉVÉNEMENTS : bus unique (stats, commentaire, son, rendu, ralentis).
RENDU : l'animateur lit l'action et sa phase, aligne l'instant de contact du geste sur
 l'événement physique ; la position et l'orientation viennent du moteur, jamais l'inverse.
```

## 5. Plan de migration (sans casser l'existant)

Chaque étape garde le jeu jouable, passe les tests, et se mesure avec le banc d'essai.

| Étape | Contenu | Risque principal |
|---|---|---|
| 4a | Repère en mètres + capsule et zones d'atteinte uniques (constantes centralisées) | régressions de seuils |
| 4b | Réception physique : le receveur va au point d'interception ; contrôle seulement au contact, premier toucher qui amortit/oriente | moins de passes réussies au début |
| 4c | Passes : erreur d'exécution appliquée à la frappe ; interception = un adversaire atteint la trajectoire à temps | stats de passes à recalibrer par les attributs |
| 4d | Tirs : erreur de visée physique ; arrêt = le gardien atteint le ballon (plongeon calculé, pas scénarisé) | nombre de buts à recalibrer |
| 4e | Duels : le tacle est un geste avec contact sur le ballon (ou sur la jambe → faute) | fautes / cartons |
| 5 | Déplacements : intention unique par joueur + cinématique par attributs | placement |
| 6 | Contrat d'animation (action + phase + instant de contact) | rendu |
| 7 | IA d'équipe et intentions sans ballon | comportement collectif |
| 8 | Tests en situation réelle, rejouables, et recalibrage (moins de `TUNE`) | — |

## 6. Banc d'essai (mesures de référence)

Outils utilisés pour cette analyse, à intégrer au dépôt à l'étape 4 :
* stats d'un match moyen (33 indicateurs comparés aux moyennes réelles) ;
* audit d'anomalies (téléportations, ballon abandonné, porteur loin du ballon…) ;
* géométrie des contacts (distances pied–ballon ci-dessus) ;
* allures, courses à reculons, double poursuite, compacité des blocs.

Valeurs actuelles à ne pas dégrader : ~2,8 buts, ~26 tirs, ~80 % de passes, ~22 fautes,
~10 corners, 220–235 km parcourus, 0 téléportation de ballon.
