# Étape 4a — Géométrie de contact unique, diagnostic, banc d'essai

## Problème
Il n'existait aucune géométrie de contact commune : chaque règle du moteur avait son propre seuil
(réception à 1,35–1,9 m, « pied » placé à 6 distances différentes, tacle à 0,9–2 m…), sans tenir
compte de la hauteur ni de la vitesse du ballon. Impossible de dire si un contact était physique.

## Ce qui a été ajouté (sans changer le comportement du jeu)

| Fichier | Rôle |
|---|---|
| `js/engine/contact.js` | Module pur, en mètres, déterministe : parties du corps utilisables selon la hauteur du ballon (pied, cuisse, poitrine, tête + saut selon le physique), zone d'atteinte propre / en s'étirant, réduction de la zone pour un ballon rapide, test **balayé** (le ballon ne traverse jamais une zone sans être vu, même avec de grands pas), temps d'arrivée d'un joueur (réaction, accélération, demi-tour), point d'interception sur la trajectoire prédite, qualité du toucher (technique, étirement, vitesse, pression, partie du corps), premier toucher par impulsion. |
| `js/engine/diag.js` | Enregistreur de diagnostic (désactivé par défaut, sans hasard, sans effet sur le match). |
| `js/engine/live.js` | Points d'enregistrement seulement (`posM`, `diagContact`, trajectoire prédite après chaque frappe, interception prévue pour chaque passe). |
| `js/ui/match3d.js` | Affichage 3D du diagnostic : zones d'atteinte des joueurs proches du ballon, trajectoire prédite, ✕ jaune = interception prévue, sphère verte/rouge = contact réel physiquement possible / impossible. |
| Paramètres | « Diagnostic physique du match » (ou `?diag=1` dans l'adresse). |
| `tests/contact.test.js` | 11 tests physiques de la géométrie. |
| `tools/bench/` | Banc d'essai : `determinism.mjs`, `fast-fingerprint.mjs`, `contacts.mjs`, `stats.mjs`, `diag-report.mjs`. |

### Zones d'atteinte retenues (proportions d'un adulte de 1,80 m)
| Partie | Hauteur du centre du ballon | Point de contact devant le corps | Propre | + en s'étirant |
|---|---|---|---|---|
| Pied | 0 – 0,50 m | 0,32 m | 0,38 m | 0,42 m (fente : jusqu'à ~1,2 m du corps) |
| Cuisse | 0,45 – 0,95 m | 0,30 m | 0,30 m | 0,15 m |
| Poitrine | 0,95 – 1,55 m | 0,22 m | 0,28 m | 0,10 m |
| Tête | 1,50 – 2,05 m (+ 0,35 à 0,65 m en sautant) | 0,12 m | 0,25 m | 0,10 m |

Au-delà de 9 m/s de vitesse relative ballon–joueur, la zone se réduit (jusqu'à 55 %).

## Mesures de référence AVANT l'étape 4b (moteur inchangé)

* Déterminisme : graine 5, 20 min → empreinte `4a1398cc` (identique en relançant, identique avec le diagnostic branché, différente avec une autre graine).
* Moteur rapide : empreinte `b47d8708` sur 40 matchs (doit rester identique).
* Diagnostic (graine 77, minutes 10–20) — **contacts physiquement possibles** :
  réceptions **10 %** (distance médiane au point de contact 2,2 m), récupérations **16 %**,
  gardien 33 %, duels 0 %.
* Géométrie : réception à 1,88 m du pied (médiane), récupération 1,81 m, conduite 0,68 m
  (jusqu'à 4,4 m), départ des frappes 0,13 m (correct).
* Stats (8 matchs) : 2,6 buts, 29,5 tirs, 82 % de passes, 3,3 passes/possession, 23 fautes.

## Validation
`node --test tests/*.test.js` (87 ✔), tests d'interface ✔, déterminisme ✔, moteur rapide inchangé ✔.

## Anomalies restantes (traitées dans les étapes suivantes)
* Réceptions et récupérations « aimantées » à ~2 m (4b).
* Ballon tiré vers le pied pendant la conduite lente (4b : contrôle et conduite par touches réelles).
* Le ballon est recalé sur le pied au départ d'une frappe s'il est à moins de 0,4 m (4c).
* Issues des passes / tirs / tacles tirées au sort avant le contact (4c, 4d, 4e).
* Joueurs en coordonnées normalisées dans le moteur (conversion `posM` pour l'instant).
