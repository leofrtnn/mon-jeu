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
