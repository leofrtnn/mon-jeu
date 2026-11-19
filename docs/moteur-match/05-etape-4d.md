# Étape 4d — Tirs, gardien et jeu de tête physiques

## Problème
* L'issue de chaque tir (but, arrêt, contre, poteau, à côté) était tirée au sort **avant** la
  frappe ; la trajectoire était fabriquée pour correspondre au résultat, le gardien plongeait au
  moment prévu et un ballon qui entrait sans but « accordé » était renvoyé artificiellement.
* Le gardien attrapait les ballons libres et aériens par simple proximité.
* La tête : duel aérien et direction tirés au hasard.

## Ce qui a changé

### 4d-1 — Tir et gardien
* **Tir** : le tireur choisit un point du but (côté, hauteur, marge au poteau selon sa technique) ;
  l'erreur d'exécution au contact (`contact.js · shotError` : frappe, sang-froid, pied, équilibre,
  pression, ballon en une touche, geste, spécialités) dévie la frappe ; vitesses réalistes
  (plat du pied ~70 km/h, frappe en force 75-100 km/h). Ensuite **seule la physique décide**.
* **But** : constaté quand le ballon franchit la ligne dans le cadre (physique du ballon), quel que
  soit le dernier joueur à l'avoir touché — but contre son camp possible.
* **Issue** constatée après coup (`shotResolve`) : arrêt (le gardien a touché un tir cadré), contre,
  poteau, à côté. Événement `strike` à la frappe (son, animation), `shot` à l'issue réelle.
* **Gardien** (`gkWatch`) :
  * lit la trajectoire **prédite** (physique) vers son but après son **temps de réaction**
    (réflexes ~0,18-0,25 s, +0,12 s si sa vue est masquée par des joueurs, nouvelle lecture après
    une déviation) ;
  * cible le point de la trajectoire le plus proche de lui ; ballon à portée de bras → prise debout
    (pas chassé, saut si haut) ; sinon **plongeon dosé** (`DIVE`, `diveRange` selon son agilité :
    corps ~1,3-2,4 m + bras 0,95 m, impulsion 0,1 s, extension complète en 0,5 s), déclenché pour
    que les mains arrivent au point de passage ; trop loin ou trop tard : il ne l'atteint pas ;
  * placement sur la **bissectrice** de l'angle des poteaux (au lieu de l'axe ballon–centre du but).
* **Zones de contact du gardien** : mains debout (`PARTS.hands`, jusqu'à 2,35 m + détente), mains en
  plongeon (point de la cinématique, rayon 0,3 m), corps allongé (segment épaule–mains), corps seul
  avant d'avoir réagi. Mains uniquement dans sa surface et pas sur une passe volontaire d'un partenaire.
* **Prise de balle au contact** (`gkHandle`) : qualité selon ses mains, la vitesse du ballon,
  l'extension, la hauteur, un ballon flottant, un terrain glissant (+ aléa du geste) →
  capté / repoussé (de face : rebond vers le terrain ; en extension : la paume dévie le ballon qui
  garde son élan, souvent en corner) / effleuré (bout des gants seulement) / boxé (ballon aérien
  dans la circulation). Un ballon effleuré peut encore entrer.
* **Penalty** : le gardien parie sur un côté avant la frappe (il ne peut pas réagir à 11 m) ; ses
  mains doivent encore rencontrer le ballon.
* **Contres** : sur la vraie trajectoire du tir (corps avant réaction, jambe après).
* Les traits du gardien (Mur, Chat, Stoppeur) agissent sur ses réflexes, ses mains, sa portée —
  plus sur une probabilité de but.

### 4d-2 — Têtes et duels aériens
* **Timing du saut** (`jumpOpts`) : sur un ballon haut, chaque joueur saute plus ou moins en rythme
  (détente, lecture, technique) ; un saut mal synchronisé monte moins haut — le ballon peut passer
  au-dessus. Le saut de l'animation part ~0,28 s avant le contact prévu (sommet au contact).
* **Duel aérien** (`aerialDuel`) : plusieurs joueurs des deux équipes au contact dans le même pas →
  vainqueur selon la hauteur atteinte (détente × timing), le physique, le placement (extension),
  l'ordre d'arrivée, une part d'aléa ; un adversaire au contact gêne le geste.
* **Tête** (`header`) : contact au point réel, qualité selon la technique (frappe / défense), la
  puissance, le timing, l'extension, la gêne ; geste choisi par le joueur — **tête au but** (tir
  physique, vitesse issue du cou et du ballon reçu), **remise** (vraie passe de la tête vers un
  partenaire, qui doit la recevoir), **déviation** (prolongation), **dégagement** (loin, haut) — et
  erreur d'exécution d'autant plus grande que le contact est mauvais.
* Les seconds ballons aériens libres se jouent aussi de la tête.

### Diagnostic
* `Diag.gks` : chaque lecture du gardien (point de passage prévu, temps de réaction, vue masquée,
  geste, départ et portée du plongeon, contact réel, qualité, résultat) ; `Diag.shots` (point visé,
  erreur, cadré, intervention, issue) ; `Diag.aerials` (joueur, geste, qualité, hauteur, disputé,
  adversaire, erreur de timing).
* Vue 3D : point de passage anticipé (losange violet), mains du gardien en plongeon (sphère au rayon réel).
* `tools/bench/gk-report.mjs` : tirs, cadrés, arrêts, prises, parades, effleurements, sorties,
  têtes, buts encaissés.

## Résultats

### Gardien et tirs (gk-report, par match)
| | 12 matchs | 16 matchs | Réel |
|---|---|---|---|
| Tirs / cadrés | 17,3 / 8,7 | 17,7 / 8,2 | 24-26 / 8,5-9 |
| Tirs cadrés arrêtés | **70,2 %** | 61,1 % | ~70 % |
| Tirs cadrés touchés par le gardien | 52,9 % | 44,3 % | — |
| Buts | 2,6 | 3,3 | 2,7-2,9 |
| Captés / repoussés / effleurés / boxés | — | 3,3 / 10,9 / 1,3 / 0,4 | — |
| Buts contre son camp | 0,08 | 0,25 | ~0,1 |
| Réaction moyenne du gardien | 0,23 s | 0,22 s | 0,2-0,3 s |

Le taux d'arrêt varie sensiblement d'un échantillon à l'autre (61 à 70 %) : il dépend de
l'endroit d'où partent les tirs et de leur placement. Il découle entièrement du contact réel.

### Statistiques de match (8 matchs, `stats.mjs`)
Buts 2,3 · tirs 16,9 · cadrés 6,6 · arrêts 4,6 · corners 9,3 · passes réussies 80,2 % ·
possessions 262 · touches 61 · tirs de la tête 27 %.

## Validation
Tests unitaires (96 ✔ — dont tests physiques du gardien, du plongeon, de la prise de balle, du
tir), tests d'interface ✔, déterminisme ✔ (identique avec ou sans diagnostic), moteur rapide
inchangé (`b47d8708`).

## Choix de modélisation à signaler
* Dispersion des tirs : l'écart-type d'exécution (paramètre physique du geste) a été élargi
  après mesure du taux de tirs cadrés (70 % au départ, irréaliste) ; vitesses de frappe ramenées à
  des valeurs réelles. Aucune probabilité de but n'existe plus dans le moteur.
* Pénalité de vitesse sur la prise de balle : 0,012 par m/s au-delà de 10 m/s.

## Anomalies restantes
* Trop de touches (61 contre 38-45) et de duels aériens comptés (75 contre 35-50, chaque tête est
  comptée) : têtes déviées ou dégagées vers les lignes ; peu de têtes disputées (14 %) — le
  marquage des défenseurs sur les ballons aériens relève de l'étape 4e.
* Tirs de la tête trop fréquents (27 % des tirs contre 12-16 %).
* Seconds ballons après parade : pas encore de suivi spécifique des attaquants.
* Coups francs directs peu cadrés (petit échantillon).
* Dénouement automatique d'un ballon coincé (duelWatch), tacles et ballons chipés par proximité
  (étape 4e).
