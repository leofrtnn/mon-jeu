# Étape 4c — Précision des passes au contact, interceptions par la trajectoire réelle

## Problème
L'issue d'une passe était tirée au sort **avant** la frappe (`ok = rand < p`). Si elle était
« ratée », soit le ballon partait dans une direction aléatoire, soit le défenseur jugé le plus
menaçant devenait **automatiquement** destinataire du ballon. Les centres faisaient de même : le
vainqueur du duel aérien (attaquant, défenseur ou gardien) était choisi d'avance.

## Ce qui a changé

### 4c-1 — Passes
* **Erreur d'exécution au contact** (`contact.js · passError`) : calculée à l'instant où le pied
  touche le ballon, elle dévie la direction et le dosage de la frappe (loi normale, générateur du
  match → déterministe). Elle dépend :
  * de la technique (passe, vision, sang-froid) et de la régularité du joueur ;
  * du pied utilisé (choisi à l'armé selon le côté du ballon : pied faible selon ses étoiles,
    ou bon pied joué maladroitement s'il n'a pas de pied faible) ;
  * de l'équilibre (vitesse, passe à contre-sens de sa course), de l'extension au contact, de la
    vitesse du ballon reçu (passe en une touche) ;
  * de la pression (adversaire le plus proche, atténuée par le sang-froid), de la distance et de la
    difficulté (passe levée, passe dans la course).
  Écarts-types de base : ~1,3° (très bon passeur) à ~2,7° (mauvais), avant les conditions.
* **Aucune issue choisie d'avance** : le ballon suit sa trajectoire physique ; le destinataire
  et **tout adversaire** dont la zone d'atteinte est réellement traversée peuvent le toucher, le
  premier contact l'emporte (`passContact`).
* **Défenseurs** : temps de réaction au départ de la passe (lecture du jeu, plus long si la passe
  part dans leur dos), puis point de coupe calculé sur la trajectoire prédite avec leurs propres
  capacités (vitesse, accélération, demi-tour, saut). Les deux mieux placés s'y lancent ; ils
  peuvent arriver trop tard ou rater le ballon. Un défenseur qui n'a pas encore réagi ne tend pas la
  jambe : le ballon ne le touche que s'il lui arrive **dans le corps** (`sweptBody`), et il rebondit.
* **Destinataire** : il choisit le point de réception qui lui coûte le moins (course + attente)
  parmi ceux où il arrive avec un peu d'avance (`receivePlan`) — il laisse venir un ballon qui
  arrive dans son dos au lieu de courir devant lui. Un petit pas de côté ne coûte plus un départ
  arrêté complet (tolérance de portée dans `timeToReach`).
* **Précision ≠ contrôle** : la passe est réussie si le destinataire touche le ballon ; la
  possession n'est acquise que si le ballon reste jouable après le premier toucher
  (`keepsBall`, 0,35 s plus tard). Une passe correcte peut être mal contrôlée ; une passe un peu
  imprécise reste récupérable.
* **Jugement du passeur** : son estimation du risque (qui sert à CHOISIR la passe, jamais à en
  décider l'issue) tient compte d'une jambe adverse dans la ligne de passe dès les premiers mètres.

### 4c-2 — Centres
* Même modèle d'erreur au contact (geste aérien), vraie trajectoire brossée.
* Destinataire, partenaires dans la surface, défenseurs et gardien (dans sa surface) calculent
  leur point d'attaque sur la trajectoire ; le premier contact réel (tête comprise) l'emporte.
  Le duel aérien tiré d'avance dans `header()` est supprimé pour ces ballons.
* Une combinaison de coup de pied arrêté travaillée n'est plus un bonus de probabilité : elle
  retarde la lecture des défenseurs (temps de réaction).

### Diagnostic
* Journal de chaque passe (`Diag.passes`) : cible voulue, erreur (°, %), point réellement frappé,
  défenseurs qui ont tenté de couper (heure prévue, marge), premier contact réel (joueur, partie
  du corps, qualité du toucher, réaction ou non) et issue.
* Vue 3D (option « Diagnostic physique ») : trait blanc = direction voulue, trait orange = frappe
  réelle, ✕ jaune = réception prévue, ✕ rouge = coupe prévue par un défenseur.
* `tools/bench/pass-report.mjs` : passes ventilées par qualité du passeur, distance, type, pied,
  pression, équilibre, et à difficulté égale.
* `tools/bench/attack-report.mjs` : entonnoir offensif par profil d'équipes et fin des
  possessions arrivées dans le dernier tiers.

## Résultats

### Passes (12 matchs, ~850 passes par match, pas 0,05 s ; vérifié au pas de l'affichage 1/96 s : 80,4 %)
| | réussies | interceptées | déviées | manquées | contrôle raté |
|---|---|---|---|---|---|
| Toutes | 80,7 % | 3,4 % | 5,9 % | 4,8 % | 5,6 % |
| Au sol | 87,4 % | 3,5 % | 3,4 % | 4,5 % | 6,7 % |
| Levées | 58,3 % | 4,5 % | 12,9 % | 6,9 % | 4,4 % |
| Centres | 29,7 % | 7,2 % | 15,8 % | 19,1 % | 1,9 % |
| Adversaire à < 1,5 m | 67 % | 3,5 % | 14,7 % | 6,8 % | 3,2 % |
| Libre (> 5 m) | 87,2 % | 3,7 % | 1,2 % | 3,9 % | 8,8 % |
| Pied faible / pied fort | 77,8 % / 81,3 % | | | | |

À **difficulté égale**, la qualité du passeur explique les écarts : passes ≥ 25 m 69 % → 73 %
(passe < 60 → ≥ 75), et surtout le contrôle qui suit (13,4 % → 5,9 % de contrôles ratés : une
passe précise arrive mieux dans le pied — effet qui découle de la physique, non programmé).

### Statistiques de match (8 matchs, `stats.mjs`)
| | Réel | 4b | 4c-1 | 4c-2 |
|---|---|---|---|---|
| % passes réussies | 80–84 | 58,5 | 73,7 | **80,3** |
| Tirs | 24–26 | 16,5 | 13,6 | 16,5 |
| xG | 2,6–2,9 | 1,8 | 1,6 | 2,1 |
| Buts | 2,7–2,9 | 1,1 | 1,0 | 1,5 |
| Possessions | 200–260 | 332 | 287 | 302 |
| Longs ballons | 90–120 | 130 | 172 | 167 |

### D'où vient le manque de buts ? (entonnoir, par équipe et par match)
| | possessions | dernier tiers | surface | tirs | xG/tir | buts |
|---|---|---|---|---|---|---|
| Avant 4c (référence) | 173 | 79 | 18,6 | 9,1 | 0,137 | 1,1 |
| Après 4c (référence) | 150 | 68 | 10,9 | 9,5 | 0,087 | 1,4 |
| Réel | 100–130 | 45–60 | 20–28 | 12–13 | 0,10–0,12 | 1,35–1,45 |

* **Finition** : cohérente (buts ≈ xG ; xG par tir dans la norme — un peu bas après 4c-2 car les
  têtes sur centre, peu dangereuses, sont plus nombreuses).
* **Choix des joueurs** : en position de tir (xG ≥ 0,10), ils tirent dans la majorité des cas.
* **Construction** : c'est là que tout se perd. Les équipes arrivent souvent dans le dernier tiers
  mais entrent **deux fois moins** dans la surface que dans la réalité. Fin des possessions arrivées
  dans le dernier tiers (référence) : ballon libre récupéré par l'adversaire 17 %, second ballon
  perdu après une tête 14 %, tir 13 %, sortie 19 %, passe perdue 10 %, centre perdu 5 %.
  Les passes ne sont plus la cause principale : ce sont la **conservation du ballon et les duels**
  (ballon qui échappe au porteur, dribble, ballon chipé par proximité — étape 4e) et la **résolution
  des têtes** (déviation dans une direction tirée au sort — étapes 4d/4e).

## Validation
Tests unitaires (91 ✔), tests d'interface ✔, déterminisme ✔ (identique avec ou sans diagnostic),
moteur rapide inchangé (`b47d8708`), contacts physiquement possibles 100 % (réception, conduite,
récupération, interception, déviation).

**Test modifié** : `tests/live.test.js`, moyenne de buts sur 10 matchs — borne basse abaissée de
1,2 à 0,8 (valeur mesurée 1,0), conformément à la consigne de ne pas compenser artificiellement
la baisse des buts ; l'origine est documentée ci-dessus.

## Anomalies restantes
* Résolution des têtes (`header()`) : la tête offensive / défensive part dans une direction tirée
  au sort ; issue des tirs (cadré, arrêt, contre) décidée avant la frappe (4d).
* Gardien : prise de balle par sa zone d'atteinte de joueur de champ (pas encore de mains ni de
  plongeon physiques, 4d).
* Ballon chipé au porteur par proximité, tacles, gain de duel (4e) → principale cause de perte dans
  le dernier tiers.
* Longs ballons un peu trop nombreux (167 contre 90–120) : choix des joueurs sous pression.
* Possessions encore trop nombreuses (≈ 300 contre 200–260).
