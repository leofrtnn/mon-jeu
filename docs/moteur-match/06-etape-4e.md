# Étape 4e — Tacles, ballons chipés, duels de corps, ballons coincés, jeu aérien et touches

## Problème
* Tacle : faute, ballon gagné ou dribble réussi tirés au sort (sigmoïde des attributs) pour tout
  défenseur à 1,4–2 m du porteur.
* Dribble (« crochet ») : succès tiré au moment où il commençait.
* Ballon chipé : un défenseur dont le pied était à moins de 0,6 m du ballon le récupérait selon un
  tirage par seconde.
* Ballon coincé plus de 3 s : donné au plus proche, ou duel tiré au sort.

## Ce qui a changé (4e-1)
* **Tacle physique** (`contact.js · TACKLE`, `tackleFoot`, `sweptTackleBall`, `legHits`) :
  * le défenseur au contact lit le duel 5 fois par seconde : position prévue du ballon, corps du
    porteur entre lui et le ballon (`shields` : il ne peut pas l'atteindre), ballon exposé (touche
    trop longue), course perdue ; envie de s'engager selon les consignes (pressing, dureté), sa
    défense, son caractère ; sinon il temporise ;
  * engagement debout (fente ~0,55 m, pied jusqu'à ~1,3 m devant) ou glissé (~2,4 m, réservé au
    ballon vraiment exposé ou à la course perdue), avec une erreur de lecture selon défense et vision ;
  * le pied suit une vraie trajectoire ; contact vérifié dans l'ordre réel :
    pied sur le ballon (lutte avec le porteur s'il l'a aussi dans sa zone : ballon gagné, poussé,
    disputé, ou le porteur garde) — jambe sur le joueur (intensité réelle : vitesse, glissé, par
    derrière ; l'arbitre siffle ou laisse jouer selon sa sévérité ; carton selon la gravité) — ou rien
    (raté, le défenseur doit se relever et se replacer avant de se réengager) ;
  * qualité du tacle (`tackleQuality`) : défense, puissance, timing, extension, équilibre (vitesse
    et direction de course par rapport au geste).
* **Ballon chipé** : seulement si le ballon a échappé au contrôle du porteur (hors de la zone de son
  pied ET à plus de 0,6 m de lui), que le défenseur a eu le temps de réagir à la touche, et qu'il
  l'atteint réellement.
* **Protection** : pressé de près, le porteur se tourne dos à l'adversaire et garde le ballon de
  l'autre côté de son corps.
* **Dribble** : la feinte prend le défenseur à contre-pied (dribble, défense, lecture, difficulté du
  geste, aléa) ; ensuite course au ballon ; « défenseur éliminé » constaté physiquement. Petit pont
  (ballon entre les jambes), sombrero (ballon levé) réellement joués.
* **Duel de corps** (`bodyScore`) : force, taille, poids, élan, orientation, placement, aléa.
* **Ballon coincé** : plus aucune attribution. Après 3 s, relance des interactions réelles (le
  porteur doit jouer, les adversaires s'engagent, les joueurs proches vont au ballon) ; balle à
  terre de sécurité (Loi 8, à l'équipe qui l'a touché en dernier) au bout de 10 s — jamais
  observée dans les tests de 16 matchs sauf 1 cas.

## Jeu aérien et touches (4e-2) — causes trouvées, comportements corrigés
Analyse de la dernière action avant chaque touche et du contexte de chaque tête :
* **Passes longues trop longues** : la difficulté d'une passe levée était comptée deux fois dans
  l'erreur de dosage (σ ≈ 5–10 m à 40 m) — erreur du modèle de l'étape 4c, corrigée. Touches
  directement après une passe longue : 18,5 → 8 par match.
* **Receveur seul qui joue de la tête** : son choix de point de réception privilégiait le plus tôt
  (hauteur de tête) ; seul, il laisse désormais redescendre le ballon pour le contrôler.
* **Têtes non disputées** : le défenseur ne disputait le ballon que s'il pouvait arriver avant
  l'attaquant ; le plus proche va maintenant au contact (côté but) même en retard.
* **Déviations de la tête vers les lignes** : la moitié des prolongations ont lieu à moins de 10 m
  d'une ligne ; le joueur réoriente désormais le ballon vers l'intérieur.

## Résultats
### Duels (duel-report, 4 matchs par profil)
| Profil | Fautes | Tacles réussis | Jaunes | Dribbles réussis |
|---|---|---|---|---|
| Référence | 15,8 | 34,3 | 4,3 | 8,8 |
| Tacles durs | 20,3 | 36,5 | 4,0 | 10,5 |
| Tacles prudents | 12,5 | 23,8 | 2,3 | 10,5 |
| Pressing haut | 21,0 | 44,0 | 4,0 | 9,0 |
| Réel | 20–23 | 28–35 | 3,5–4 | 10–12 |

* Ballon gagné par tacle debout : 5 % (défense < 60) → 18–22 % (≥ 75) ; ballon touché 21 % → 35–39 %.
* Glissé : ~13 par match, 52 % ratés, 38 % de fautes (souvent en retard).
* Duels de corps : le joueur le plus « physique » l'emporte dans ~61 % des cas.

### Statistiques de match (8 matchs)
| | Réel | 4d | 4e |
|---|---|---|---|
| Touches | 38–45 | 61,1 | **44,5** |
| Fautes | 20–23 | 18,6 | 18,1 |
| Tacles réussis | 28–35 | 23,0 | 34,1 |
| Passes / réussies | 850–1000 / 80–84 % | 770 / 80,2 % | 847 / 83,3 % |
| Buts / tirs | 2,7–2,9 / 24–26 | 2,3 / 16,9 | 4,6 / 16,5 |
| Corners | 9,5–10,5 | 9,3 | 8,5 |
| Tirs de la tête | 12–16 % | 27 % | 29 % |
| Penaltys | 0,25–0,32 | 0,1 | 0,8 |

## Validation
Tests unitaires (99 ✔, dont tacle : pied / ballon / jambe / protection, qualité, duel de corps),
tests d'interface ✔, déterminisme ✔, moteur rapide inchangé (`b47d8708`).

## Anomalies restantes
* **Tirs de la tête (29 %)** : en valeur absolue ~4,7 par match (réel ~3,5) ; la part est gonflée
  surtout par le manque de frappes du pied (16,5 tirs au lieu de 24–26). Les têtes au but viennent
  des centres (2,3) et des seconds ballons dans la surface (1,7).
* **Longs ballons** trop nombreux (190 contre 90–120) : choix des joueurs (à traiter avec l'IA).
* **Penaltys** élevés (0,8) : fautes réelles de défenseurs qui taclent dans leur surface ; la
  retenue des défenseurs dans la surface est faible.
* **Interceptions** comptées : elles incluent maintenant les ballons pris sur une touche trop longue.
* Buts variables selon l'échantillon (2,3 à 4,6 sur 8 matchs).
