# Étape 6 — Contrat moteur → animation

Découpage validé (validation entre chaque sous-étape) :
* **6a** : descriptif moteur en lecture seule et diagnostic de cohérence, sans migration visuelle ;
* **6b** : frappes, passes, centres et contrôles ;
* **6c** : duels, tacles, têtes et gardien ;
* **6d** : déplacement, et suppression des déductions correspondantes dans le rendu.

Le moteur est l'unique source de vérité sur les gestes et les déplacements ; le rendu 3D se contente
de les représenter. Pendant toute l'étape, on ne touche ni à la physique, ni aux contacts, ni aux
décisions, ni à l'arbitrage, ni à la cinématique.

## 6a — Descriptif moteur en lecture seule et diagnostic de cohérence — rapport, non validé

### Principe
* **Module** `js/engine/gesture.js` (`GestureLog`). Il est instancié par `LiveSim` sous le nom
  `sim.gest`.
* **Points d'appel.** Le moteur l'appelle en écriture seule, à **27 endroits** de `live.js`, là où
  il a **déjà** décidé quelque chose :
  * un geste : armé d'une frappe, tacle, saut, plongeon, geste technique, remise en jeu ;
  * un contact physique : frappe, contrôle, touche de conduite, prise de balle, tacle sur le
    ballon, tête, mains du gardien ;
  * la fin d'un armé : abandon, ou ballon perdu.

  Le déplacement est décrit à la fin de chaque pas de `move()`, à partir de l'état du modèle 5c.
* **Garanties.**
  * L'enregistreur ne décide rien et ne consomme aucun hasard.
  * Le moteur ne lit jamais `p.act`, `p.loco` ni le journal (vérifié par recherche dans le code et
    par les tests).
  * `snapshot()` ne sauvegarde que ses propres champs. La synchronisation en ligne (chaque côté
    simule) n'est pas concernée.
* **Coût.** 3 matchs au pas de 1/96 s, joués deux fois avec l'enregistreur réel et deux fois avec
  un enregistreur muet : **+0,2 %** (162,8 → 163,1 µs par pas), soit le bruit de mesure. L'historique
  n'est conservé que si un outil le demande (`gest.all` ou `gest.keep`). En jeu, seul le geste
  courant de chaque joueur est gardé.

### Référence temporelle
* **Horloge** : `sim.now`, en secondes de jeu simulé (pas fixe `dt`, 1/96 s en jeu). Au pas n,
  `now` vaut la fin du pas.
* **Contact physique.**
  * Contact balayé à la fraction `frac` du pas : t = now − (1 − frac)·dt.
  * Frappe (impulsion donnée à l'exécution) : t = now, avec frac = 1.
* **Contact prévu** `tPlan` : l'instant que le moteur prévoit en décidant le geste (par exemple la
  fin de l'armé d'une frappe, ou le point de la trajectoire pour un saut de tête).
* **Contact animé** `t_anim`, tel que l'animation actuelle le représente (avant migration) :
  t_anim = début du geste (ou du dernier réarmé) + `anim.at` × `anim.dur`. `anim` indique le
  minuteur lu par le rendu, la durée réelle de l'animation (minuteur × 1,6 : le rendu le décompte à
  dt / 1,6) et la fraction où le contact est représenté.
* **Décalages.**
  * Δanim = t_anim − t_phys : positif quand l'animation montre le contact après le contact
    physique.
  * Δplan = t_phys − t_plan.
* **Précision de référence : un pas (1/96 s ≈ 10,4 ms).** Une animation est alignée si
  |Δanim| ≤ dt.

### Contrat
**Geste** (`p.act` : le dernier geste du joueur ; historique dans `gest.gestures`) :

| Champ | Sens |
|---|---|
| `id` | identifiant stable et croissant, unique dans le match |
| `pid`, `side` | joueur |
| `kind` | passe, passe levée, frappe, centre, dégagement, remise en jeu au pied, touche, contrôle, touche de conduite, prise de balle, tacle (fente), tacle (glissé), saut de tête, tête, saut, plongeon, mains, geste technique, subi |
| `part`, `foot` | partie du corps prévue (pied, tête, mains, jambe, corps) ; pied G / D |
| `src` | endroit du moteur qui a décidé le geste |
| `t0`, `tPlan`, `t0re` | début ; contact prévu (ou null si le contact sera constaté par la géométrie : tacle, plongeon, saut défensif) ; début du dernier réarmé ou de la dernière relance |
| `anim` | `{ timer, dur, at }` : représentation actuelle par le rendu (`at` null : pas encore définie, voir 6c) |
| `contacts`, `aux`, `tContact`, `cPart` | contacts principaux, contacts secondaires (touches de conduite pendant l'armé), instant et partie du corps du premier contact principal |
| `end`, `outcome`, `why` | fin ; issue : `contact`, `sans contact`, `annulé`, `interrompu` ou `subi` ; motif |
| `reflex`, `rearm`, `relaunch`, `notes` | geste ouvert au contact (aucun armé décidé avant) ; armé suspendu ; geste relancé par le moteur ; évènements sans ballon (tacle sur l'homme) |

**Contact** (`gest.contacts`) : `{ id, pid, side, kind, part, t, step, frac, gid, role }`.
* `gid` : le geste auquel le contact est rattaché.
* `role` : `principal` ou `secondaire`.
* Plusieurs contacts dans un même pas ont des identifiants distincts : 1 338 pas sur 70 078 en
  comptent plusieurs (joueurs différents).

**Règles de rattachement d'un contact à un geste :**
1. Le contact est **principal** pour le geste en cours qui l'attend :
   * une frappe armée reçoit le contact de la frappe exécutée, quel qu'en soit le type final ;
   * un tacle, un saut, un plongeon ou un geste technique reçoit tout contact survenu pendant son
     déroulement.
2. Pendant l'armé d'une frappe, une touche de conduite est un contact **secondaire** : le geste de
   frappe continue.
3. Sinon, un geste **réflexe** est ouvert au contact (contrôle, touche de conduite, prise de balle,
   frappe sans armé, subi).

Quand le moteur relance le même geste avant tout contact (saut relancé, armé recommencé), c'est le
**même geste** : son instant prévu est mis à jour.

**Déplacement** (`p.loco`, écrit par `move()` après le pas du modèle 5c) :
`{ speed, vx, vy, acc, face, turn, mode, ctrl }`.
* `mode` : arrêt (< 0,3 m/s), avant, pas chassés (écart vitesse / orientation entre 0,9 et 2,2 rad)
  ou reculons (> 2,2 rad).
* `ctrl` : libre, plongeon, tacle ou au sol.

Le rendu ne l'utilise pas encore (6d).

### Diagnostic (`gesture-report.mjs`, 8 matchs, graines 100-107, pas 1/96 s)
**Couverture et identifiants**
* Contacts du diagnostic physique : 62 990 sur 62 990 décrits (**100 %**) ; **0 contact sans
  geste**.
* Contacts décrits par match : 8 928, dont 7 965 principaux et 963 secondaires.
* Répartition par match :
  * conduite : 6 534 ;
  * frappe : 876 ;
  * réception : 705 ;
  * récupération : 426 ;
  * duel : 119 ;
  * tacle sur le ballon : 84 ;
  * tête : 62 ;
  * interception : 46 ;
  * lancer : 33 ;
  * déviation : 29 ;
  * mains : 11 ;
  * contres : 3,5.

**Partie du corps** : 4 contacts d'une autre partie que celle prévue, sur 52 990 gestes à partie
prévue (0,01 %). Il s'agit de trois sauts de tête touchés de la cuisse, du pied ou de la poitrine,
et d'un tacle touché de la cuisse.

**Gestes sans contact, par motif** (par match). Ils ne sont pas comptés comme des erreurs :

| Geste | Issue | Motif | Par match |
|---|---|---|---|
| Tacle (fente) | sans contact | geste exécuté, ballon manqué ou contact sur l'homme | 45,9 |
| Saut de tête | sans contact | saut disputé, ballon non touché (50,7 % des sauts) | 32,9 |
| Passe | annulé | armé abandonné, ballon hors de portée du pied | 22,5 |
| Passe | interrompu | ballon perdu pendant l'armé | 14,3 |
| Tacle (glissé) | sans contact | 93,6 % des glissés | 12,9 |
| Touche | sans contact | le tireur garde le ballon faute de partenaire disponible (24 % des touches) | 10,5 |
| Passe | sans contact | animation terminée sans exécution | 5,5 |
| Geste technique | sans contact | feinte sans toucher | 4,8 |
| Plongeon | sans contact | gardien battu ou ballon à côté (71 % des plongeons) | 2,5 |

**Décalage contact animé − contact physique** (animation actuelle, avant migration) :

| Geste | n | Médiane | p5 / p95 | Part \|Δ\| ≤ 1 pas |
|---|---|---|---|---|
| Passe (armée) | 5 331 | −0,008 s | −0,008 / −0,007 | 99,9 % |
| Passe levée / centre / dégagement / frappe (armés) | 765 / 178 / 178 / 80 | −0,010 s | | 100 % |
| Remise en jeu au pied | 403 | −0,004 s | | 100 % |
| Touche de conduite | 43 961 | **+0,128 s** | +0,112 / +0,128 | 0 % |
| Contrôle | 9 323 | **+0,240 s** | | 0 % |
| Subi (ballon qui heurte un joueur) | 254 | +0,240 s | | 0 % |
| Tête (sans saut préalable) | 239 | +0,240 s | | 0 % |
| Saut de tête | 256 | **+0,261 s** | +0,068 / +0,360 | 0,8 % |
| Passe / frappe sans armé | 71 | +0,25 à +0,28 s | | 0 % |
| Touche (lancer) | 261 | **+0,437 s** | | 0 % |
| Tacles, plongeon, gestes techniques | — | non défini (`at` null : instant de contact animé à établir en 6c) | | |

**Contact physique − contact prévu.**
* Frappes armées : entre 0 et 1 pas dans 99,9 à 100 % des cas. La frappe part au premier pas qui
  atteint l'instant prévu.
* Sauts de tête : −0,040 s en médiane. Le ballon arrive un peu avant le sommet prévu.

### Lecture
* Le contrat couvre tous les contacts physiques. Chaque contact est rattaché à un geste par un
  identifiant stable, et les gestes interrompus, annulés, feints ou sans contact sont distingués.
* Les **frappes armées** sont déjà synchronisées : l'animation et le contact physique coïncident à
  un pas près.
* **Les gestes réflexes sont en retard à l'écran.** Le rendu démarre leur animation au moment du
  contact et place le contact animé au milieu, donc toujours trop tard :
  * touche de conduite : +0,13 s ;
  * contrôle, tête, subi : +0,24 s ;
  * passe ou frappe sans armé : +0,25 à +0,28 s ;
  * touche : +0,44 s ;
  * saut de tête : le moteur déclenche le saut 0,28 s avant le contact prévu, mais le sommet animé
    tombe 0,36 s après le début du saut.

  Ce sont les cibles de 6b (frappes, passes, centres, contrôles) et de 6c (têtes, duels, gardien).
* **Particularités du moteur révélées, non corrigées** (ni physique ni décision ne changent en 6) :
  * touche sans lancer quand aucun partenaire n'est disponible : le tireur garde le ballon ;
  * frappes armées suspendues (réarmées) : 301 par match ;
  * saut de tête relancé par le moteur avant le contact. C'est le même geste dans le descriptif.

### Tests et non-régression
* **`tests/gesture.test.js`** (3 tests) :
  * neutralité : enregistreur réel, enregistreur muet, journal complet et diagnostic donnent le
    même match, sur deux graines ;
  * couverture de 100 % des contacts du diagnostic ;
  * identifiants croissants et références valides ;
  * frappes armées exécutées dans le pas qui suit l'instant prévu ;
  * issues explicites ;
  * déplacement cohérent avec le modèle 5c.
* **Déterminisme sur trois graines**, chacune jouée deux fois, avec et sans diagnostic : la graine
  change bien le résultat, et le match est identique d'une exécution à l'autre.

  | Graine | Empreinte |
  |---|---|
  | 5 | **112bd1dc** (inchangée) |
  | 104 | 2a6d7bc9 |
  | 300 | 8b411e7e |
* **Moteur rapide** : b47d8708.
* **Contacts physiquement possibles** : 100 % (`diag-report`).
* **Tests unitaires** : 126 réussis (les 123 existants et les 3 tests du contrat).
* **Tests d'interface** : réussis.
* **Match en ligne entre deux managers** (`duel.e2e.cjs`) : même match des deux côtés,
  576 001 pas.
* **Affichage mobile** (`render-cost.cjs`) :
  * Conditions : Pixel 5 émulé en paysage, rendu logiciel sans carte graphique, match en direct
    sans avance rapide.
  * Dans un même match, en alternant l'enregistreur réel et l'enregistreur muet par fenêtres de
    15 s, les images durent 206 / 185 ms et 185 / 194 ms : aucun écart régulier.
  * Entre deux matchs différents (avant et après 6a), on mesure 182 et 184 ms contre 197 et
    197 ms. Cet écart vient du match généré (équipes, stade), pas du descriptif : la mesure dans un
    même match le montre.
  * Le rendu n'est pas modifié en 6a. Cette mesure sert de référence pour 6b à 6d. Le rendu
    logiciel ne représente pas un vrai téléphone : seule la comparaison dans les mêmes conditions
    compte.

### Limites
* `anim.at` n'est pas encore défini pour les tacles, les plongeons et les gestes techniques.
  L'instant de contact de ces animations sera établi en 6c.
* Le contact animé est déduit des minuteurs que le rendu lit aujourd'hui, et non mesuré sur le
  squelette 3D. La mesure squelette contre ballon est une piste pour 6b.
* Les célébrations, chutes, déséquilibres, appels de l'arbitre et gestes du banc sont des états
  sans contact. Ils restent hors du contrat 6a, et le déplacement les reprendra en 6d.
* Les anciens indicateurs (`kick`, `ctrl`, `touch`, `jump`, `slide`…) pilotent toujours **tout**
  le rendu. Ils n'ont pas changé de statut en 6a : aucun geste n'est encore migré.

## 6b — Frappes, passes, centres et contrôles — rapport, non validé
### Principe
* **Affichage différé.** L'écran montre la partie avec un différé constant `DELAY` = **0,15 s**
  (`js/ui/animSync.js`).
  * Un contact a lieu au temps moteur t. L'image du temps t − 0,15 s n'a pas encore été affichée :
    le geste peut y commencer **avant** le contact. Le contact animé tombe alors exactement sur
    l'image du contact physique.
  * Le différé est supérieur à la plus longue anticipation nécessaire (0,15 s pour une frappe sans
    armé). Démarrer l'animation au moment du contact, comme avant, la mettait toujours en retard.
* **Couche d'affichage.**
  * À chaque pas, la vue copie les champs d'affichage des joueurs et du ballon, sans jamais modifier
    les objets du moteur.
  * Elle construit des objets d'affichage à t_aff = now − 0,15 s, avec des positions interpolées
    entre deux pas.
  * Le rendu 3D (joueurs, ballon, caméra) lit ces objets.
  * Les évènements du match (sons, commentaires, bannières, score) sont mis en file et diffusés
    quand l'image affichée atteint leur instant (diagnostic complémentaire ci-dessous). Les fins de
    période (mi-temps, fin) restent immédiates, après avoir vidé la file. L'horloge affichée reste au
    temps du moteur (0,15 s de jeu simulé d'avance sur l'image).
* **Gestes migrés (pilotés par le contrat).**
  * Familles : frappes, passes, passes levées, centres, dégagements, remises en jeu au pied (armés
    ou non), contrôles, contacts subis, touches de conduite.
  * Les champs de geste lus par le rendu (`kick`, `kickMax`, `kickFoot`, `kickPow`, `kickSide`,
    `kickLoft`, `kickOut`, `touch`, `touchMax`, `touchFoot`, `touchIn`, `ctrl`, `ctrlH`) sont
    **recalculés à partir du contrat** : contact, style du geste et issue.
  * Les anciens indicateurs du moteur ne pilotent plus ces gestes.
* **Anciens indicateurs.** Ils restent, avec le statut **non migrés**, pour les tacles, les têtes,
  le gardien, la touche, les chutes, les célébrations et les gestes techniques.
  * Un contrôle ou une touche rattachés à un tacle ou à un geste technique gardent l'ancien
    indicateur.
  * Au choix : `?anim=contrat` (défaut), `?anim=ancien` (même différé, anciens indicateurs, pour
    comparer), ou `?anim=direct` (sans différé, comme avant 6b).
* **Timing par famille.** Le contact animé coïncide exactement avec le contact physique :

  | Famille | Avant le contact | Au contact | Après le contact |
  |---|---|---|---|
  | Frappe armée | armé de l'instant décidé par le moteur jusqu'à l'élan (tenu si la frappe est suspendue), puis fouetté sur la dernière fraction du geste | fraction 0,55 | accompagnement |
  | Frappe sans armé | élan compressé dans les 0,15 s qui précèdent | fraction 0,55 | accompagnement |
  | Touche de conduite | 0,112 s | sommet du geste | 0,112 s |
  | Contrôle | le corps se présente 0,12 s avant | | amorti 0,24 s |
  | Contact subi (sans réaction) | aucune anticipation | réaction | |

  Les frappes armées gardent leur armé, mais le contact animé est maintenant exactement au contact
  (auparavant de 0 à 1 pas avant).
* **Contact visuel sur le squelette (cinématique inverse de la jambe).**
  * Le moteur place le ballon n'importe où dans la zone d'atteinte, jusqu'à 0,8 m du point de
    contact naturel. En conduite, il est souvent à 0,12-0,25 m du centre du joueur.
  * Un geste joué à une position fixe par rapport au corps passait donc loin du ballon : à 0,35-0,6 m
    au moment du contact, même pour les frappes déjà synchronisées en 6a.
  * Correction : autour du contact (0,08 à 0,1 s avant, 0,04 à 0,05 s après), la jambe du geste est
    amenée par cinématique inverse (hanche et genou, moindres carrés amortis sur le vrai squelette)
    sur le point de la surface du ballon le plus proche du pied, à la position du ballon à l'instant
    du contact (connue grâce au différé).
  * Hors du pas du contact, le pied du geste est empêché de pénétrer le ballon affiché.
* **Rien ne change dans le moteur** : physique, contacts, décisions, arbitrage et cinématique sont
  intacts. Le contrat relève seulement en plus le style du geste (pied, puissance, intérieur ou
  extérieur, ballon levé, durée de l'armé, hauteur du contrôle), déjà décidé par le moteur.

### Mesures
**Timing contrat → animation** (`tests/animsync.test.js`, sans navigateur) :
* Pour toutes les frappes d'un match : phase 0,55 exactement au contact physique.
* Animation commencée avant le contact, et au plus 0,15 s avant pour une frappe sans armé.
* Ancien contact animé des frappes armées : entre 0 et 1 pas avant le contact (aucune régression).
* Touches et contrôles : sommet exactement au contact.
* Gestes annulés ou interrompus : plus aucune animation après la fin du geste (pas de frappe
  fantôme).

**Contact visuel sur le squelette 3D** (`anim-probe.cjs`).
* Méthode :
  * même match, mêmes gestes, mêmes instants, ancien rendu puis contrat, rejoués pas à pas (1/96 s)
    autour de chaque contact avec le calcul de pose réel du rendu (pose, lissage, cinématique
    inverse) ;
  * 400 s de jeu, 271 gestes ;
  * distance mesurée entre la partie du corps (bout du pied ; genou, poitrine ou tête pour un
    contrôle) et la **surface** du ballon ;
  * « au contact » = minimum dans ±1 pas autour du contact physique.

| Famille | n | Distance au contact, ancien → contrat | Contact ≤ 3 cm, ancien → contrat | Rapprochement maximal à ≤ 1 pas du contact, ancien → contrat | Pied dans le ballon hors du contact > 2 cm, ancien → contrat |
|---|---|---|---|---|---|
| Touche de conduite | 187 | 0,453 → **0,007 m** | 4 → **80 %** | 8 → **63 %** | 4 → 5 % |
| Contrôle | 49 | 0,558 → **0,025 m** | 0 → **63 %** | 22 → **35 %** | 4 → 0 % |
| Passe (armée) | 23 | 0,347 → **−0,008 m** | 9 → **43 %** (le reste à moins de 4 cm, légèrement dans le ballon) | 17 → **96 %** | 4 → 4 % |
| Remise en jeu au pied | 5 | 0,426 → −0,009 m | 0 → 20 % | 20 → **100 %** | 20 → 0 % |
| Passe levée, dégagement, frappe, subi | 1 à 3 chacun | voir la sortie de l'outil | | | |

### Lecture
* **Le timing des familles migrées est exact.** Le contact animé coïncide avec le contact physique
  par construction (tests), et l'animation commence bien avant le contact.
* **Le contact visuel est obtenu dans la grande majorité des cas** : le pied est sur le ballon au
  contact (médianes de 0,7 cm à 2,5 cm), contre 35 à 56 cm avant 6b.
* **Écarts restants (non masqués) :**
  * Contrôles et touches : le rapprochement maximal n'est à un pas du contact que dans 35 à 63 % des
    cas. La distance reste quasi nulle sur plusieurs pas autour du contact : le ballon contrôlé reste
    au pied.
  * 5 % des touches de conduite ont le pied plus de 2 cm dans le ballon hors du contact. En conduite,
    le moteur garde le ballon à 0,12-0,25 m du centre du joueur, sous son corps : la jambe d'appui et
    la jambe de touche le frôlent. Cette géométrie relève du moteur (conduite), hors du champ de 6b.
  * Ballons hauts ou lointains (dégagement, quelques frappes) : la cinématique inverse ne peut pas
    toujours atteindre le ballon. Elle est limitée aux articulations de la jambe, sans saut ni
    pivot du corps.
  * Contrôles de la poitrine, de la cuisse ou de la tête : synchronisés dans le temps, mais sans
    cinématique inverse. Le corps n'est pas déplacé vers le ballon.
* **Anomalies de logique moteur révélées par 6a, non corrigées (consigne) :**
  * passes annulées, ballon hors de portée : 22,5 par match ;
  * frappes suspendues, puis réarmées : 301 par match ;
  * touches sans lancer faute de partenaire : 24 % des touches ;
  * ballon de conduite maintenu sous le corps du porteur (nouveau, vu sur le squelette).

  Elles sont transmises à la logique moteur, pour une étape à décider.

### Captures avant / après (`anim-shots.cjs`)
* Méthode : même instant de jeu (l'image du contact physique), même joueur filmé de côté, ancien
  rendu puis contrat.
* Sur la touche de conduite et le contrôle, le pied est sur le ballon avec le contrat, alors qu'il
  en est éloigné avec l'ancien rendu.
* Sur l'exemple de passe, le pied s'approche du ballon sans le toucher franchement : c'est un des
  cas résiduels mesurés ci-dessus (cinématique inverse limitée).
* Les captures ne sont pas versionnées (taille). Elles se régénèrent avec
  `node tools/bench/anim-shots.cjs`.

### Non-régression
* **Moteur** : match identique (112bd1dc), avec ou sans diagnostic.
* **Déterminisme** sur trois graines : 5 → 112bd1dc, 104 → 2a6d7bc9, 300 → 8b411e7e.
* **Moteur rapide** : b47d8708.
* **Contacts** : physiquement possibles à 100 %.
* **Contrat** : 100 % des contacts du diagnostic décrits, 0 contact sans geste (`gesture-report`,
  4 matchs).
* **Tests unitaires** : 128 réussis (126, plus 2 tests de synchronisation).
* **Tests d'interface** : réussis.
* **Match en ligne** entre deux managers : même match des deux côtés.
* **Couche d'affichage** : sans effet sur le match (test, deux graines).
* **Coût mobile** (`render-cost.cjs`, `AB6=1`) : même match, fenêtres de 15 s en alternant affichage
  direct (avant 6b) et contrat (6b).

  | Processeur | Direct | Contrat |
  |---|---|---|
  | Non ralenti | 240 et 216 ms par image | 236 et 202 ms par image |
  | Ralenti ×4 | 335 ms par image | 326 ms par image |

  Pas d'écart mesurable dans le bruit. L'enregistrement par pas, l'échantillonnage différé et la
  cinématique inverse (1 à 3 joueurs par image) restent marginaux devant le rendu.

## 6b — Diagnostic complémentaire (validation suspendue) — rapport, non validé
Demandé avant toute validation de 6b : distributions complètes, classes de contact, ballons hauts ou
lointains, décalage son / commentaires / image dû au différé, cohérence en ligne, captures des cas
résiduels. Aucune anomalie n'est retirée des mesures : chaque geste migré mesuré figure dans une
classe, y compris les cas défavorables. Toutes les corrections sont **dans le rendu seul** ; le moteur
(physique, contacts, décisions, cinématique) n'est pas modifié.

### Méthode (`anim-probe.cjs`, campagne finale)
* Même match, 481 s de jeu, 380 gestes migrés, rejoués pas à pas (1/96 s) avec le calcul de pose
  réel du rendu : ancien rendu (anciens indicateurs, même différé) puis contrat.
* d = distance entre la partie du corps (bout du pied ; genou, poitrine ou tête pour un contrôle) et
  la **surface** du ballon, minimum dans ±1 pas (±10,4 ms) autour du contact physique. Négatif = dans
  le ballon.
* Classes : **crédible** −1 cm ≤ d ≤ 3 cm ; **trop éloigné** d > 3 cm ; **pénétration** d < −1 cm.
* Pénétration hors contact : pied plus de 2 cm dans le ballon à plus d'un pas du contact (fenêtre
  −0,35 s à +0,3 s).
* Mesure temporelle ajoutée : distance minimale à ± une image de 60 i/s (±16,7 ms) du contact.
* Portée : ok / fente (le corps se porte vers le ballon) / corps (contrôle cuisse, poitrine, tête) /
  hors de portée de la jambe / ballon haut (> 0,75 m).
* Jambes croisées : au contact, le pied du geste est passé de plus de 5, 10 ou 15 cm de l'autre côté
  du pied d'appui (repère du joueur).

### Distributions (contrat ; ancien rendu entre parenthèses pour la médiane)
| Famille | n | d médiane | p90 | p95 | ≤ 1 / 2 / 3 / 4 cm | Crédible | Trop éloigné | Pénétration au contact | À ± 1 image : ≤ 1 / 3 cm |
|---|---|---|---|---|---|---|---|---|---|
| Touche de conduite | 265 | 0,001 m (0,300) | 0,010 | 0,015 | 91 / 96 / 98 / 98 % | **98 %** | 2 % | 0 % | 91 / 98 % |
| Contrôle | 63 | 0,021 m (0,530) | 0,051 | 0,165 | 30 / 44 / 67 / 86 % | 63 % | 33 % | 3 % | 81 / **90 %** |
| Passe (armée) | 33 | −0,004 m (0,213) | −0,004 | 0,000 | 97 / 100 / 100 / 100 % | **100 %** | 0 % | 0 % | 97 / 100 % |
| Dégagement | 5 | −0,003 m (0,625) | | | 80 / 100 % | 100 % | 0 % | 0 % | |
| Remise en jeu au pied | 5 | −0,004 m | | | 80 / 100 % | 100 % | 0 % | 0 % | |
| Passe levée | 3 | −0,004 m (0,596) | | | 100 % | 100 % | 0 % | 0 % | |
| Centre | 2 | 0,032 m (0,733) | | | 50 % | 50 % | 50 % | 0 % | |
| Frappe | 1 | −0,004 m | | | 100 % | 100 % | | | |
| Contact subi | 3 | 0,042 m (0,139) | | | 33 % | 33 % | 67 % | 0 % | 67 / 67 % |

**Pénétration hors contact** : 0 % pour les touches de conduite (0 / 265), les passes et toutes les
frappes ; 2 contrôles sur 63 (genou 3,3 cm à +223 ms ; genou 9,1 cm à +25 ms sur un contrôle de la
cuisse d'un ballon à 0,64 m de haut) ; 1 contact subi (3,0 cm à +233 ms). L'anti-pénétration ne
traite que les pieds ; le genou d'un contrôle de la cuisse n'est pas couvert.

**Les 5 % de touches à plus de 2 cm dans le ballon hors du contact** (demande 2) : ce n'était pas la
géométrie de la conduite, mais l'anti-pénétration qui n'aboutissait pas en un seul essai de la
cinématique inverse (ballon entre les pieds, sortie radiale impossible). Elle essaie maintenant jusqu'à
trois fois, en levant le pied au-dessus du ballon : 0 cas sur 265.

### Contrôles : l'écart restant est temporel, pas spatial
* Les contrôles « trop éloignés » sont à 3-5 cm au pas du contact, mais le pied rejoint le ballon
  10 à 15 ms plus tard (distance minimale ≈ 0) : le ballon arrive à environ 10 m/s, soit 1 cm par
  milliseconde.
* À ± une image de 60 i/s du contact, 90 % des contrôles sont à 3 cm ou moins. L'écart est plus court
  qu'une image affichée.
* Restent hors de cette tolérance : les contrôles de ballons hauts ou lointains (ci-dessous).

### Ballons hauts et lointains (demande 3)
* **Ballons lointains au sol** : le moteur admet un contact jusqu'à 1,1-1,3 m du centre du joueur ;
  la jambe 3D en atteint environ 0,95 m.
  * À l'affichage, le corps se porte vers le ballon autour du contact (« fente », au plus 0,5 m),
    sans modifier la position du moteur. Au-delà, le cas reste classé « hors de portée » : la jambe
    n'est pas forcée.
  * Fente : 48 touches (ballon médian à 0,92 m, d médiane 0,1 cm), 28 contrôles, 4 passes.
  * Hors de portée restants : 0 touche (contre 22 avant la rotation d'affichage), 3 contrôles.
* **Ballons derrière ou sur le côté** (cause principale des touches trop éloignées) : le moteur
  admet un contact dans toutes les directions ; 26 % des touches et 25 % des contrôles ont le ballon
  à plus de 60° de l'orientation du corps, souvent derrière lui. La jambe ne peut pas frapper vers
  l'arrière.
  * Représentation : le corps pivote vers le ballon autour du contact (0,22 s avant, 0,18 s après),
    au-delà de 60° d'écart, de 75° au plus, puis revient à l'orientation du moteur. C'est un crochet.
  * Pas de pivot pour un ballon collé au joueur (moins de 0,35 m) : il se joue de l'intérieur, de
    l'extérieur ou du talon.
  * Pivot médian 45° (touches) et 48° (contrôles) ; d médiane avec pivot −0,2 cm et 0,9 cm.
* **Ballons hauts** (contrôle de la poitrine, de la cuisse, de la tête) :
  * pas de jambe forcée vers un ballon haut ; le corps se porte vers le ballon (au plus 0,5 m) pour
    que la partie du corps prévue par le moteur le touche ;
  * 3 contrôles « corps » (ballon à 0,48 m de haut, d médiane −2,4 cm : la partie du corps entre
    légèrement dans le ballon) ;
  * 3 contrôles hors de portée (ballon médian à 0,64 m de haut et 0,72 m du joueur, d médiane
    16,5 cm). Il leur faudrait une autre représentation (saut, extension de la jambe en l'air), que
    le squelette actuel n'a pas : cas restants, rares (5 % des contrôles), à traiter avec les gestes
    aériens (6c, têtes et sauts).
* **Jambes croisées** :
  * Frappes : le pied de frappe est décidé par le moteur. Le ballon est parfois du côté de l'autre
    pied ; la jambe croisait alors derrière la jambe d'appui (25 % des passes, visible sur les
    captures). Représentation : décalage latéral d'affichage du joueur (au plus 0,35 m, médiane
    17 cm) pour que le ballon soit devant le pied de frappe. Passes : croisement > 10 cm 0 %.
  * Touches et contrôles : la jambe est choisie une fois par geste (pas de changement de jambe en
    cours de geste) : celle du côté du ballon si elle l'atteint, sinon celle qui l'atteint le mieux.
    Croisement > 10 cm : 8 à 14 % avant, 5 % des touches et 2 % des contrôles après. Les cas
    restants sont des touches de l'intérieur du pied à travers le corps (captures).

### Son, commentaires et image (demande 4) (`av-sync.cjs`)
* **Avant** : les évènements (sons de frappe, sifflets, commentaires, bannières, score) partaient au
  temps du moteur, donc **0,15 s avant l'image** qui les montre, plus jusqu'à une image d'attente.
* **Correction (rendu)** : les évènements sont mis en file et diffusés quand l'image affichée atteint
  leur instant. Mi-temps et fin restent immédiates, après avoir vidé la file. Avance rapide, ralentis
  et reprise vident la file.
* Mesure : même match, deux fenêtres. Rendu logiciel sans GPU, 4 à 5 images par seconde : la
  granularité d'image domine la mesure.

  | | Avance de l'évènement sur l'image, temps de jeu (médiane [p5, p95]) | Avance en temps réel (médiane) |
  |---|---|---|
  | Avant (11 évènements) | +212 ms [+160, +244] | +197 ms |
  | Après (6 évènements) | −48 ms [−110, −6] | **0 ms** [0, 1] |

  Après correction, l'évènement est diffusé avec l'image qui le montre (même image, 0 ms en temps
  réel). Au plus une image plus tard en temps de jeu (≤ 16,7 ms à 60 i/s, ici une image logicielle).
* L'horloge reste au temps du moteur : 0,15 s de jeu simulé d'avance, sans effet visible.

### Cohérence en ligne (demande 4)
* Indépendamment du résultat identique de la simulation : à la pause commune, les deux onglets ont
  **la même image différée** (même instant affiché, mêmes positions de joueurs et du ballon, mêmes
  phases de geste) et **les mêmes évènements en attente** dans la file. Vérification ajoutée à
  `tests/duel.e2e.cjs` ; réussie.
* Le différé et la file dépendent seulement du temps du moteur, identique des deux côtés.

### Captures (demande 5) (`anim-shots.cjs`)
* `RES=1` : cas résiduels classés par la sonde, y compris défavorables (trop éloigné, hors de portée,
  jambes croisées, pivot), une image au contact.
* `SEQ=1` : séquence de 13 images de −240 à +240 ms autour d'un contact avec pivot, caméra fixe de
  côté puis caméra de jeu.
* Constats :
  * touche « hors de portée » (ballon à 1,25 m, d 25 cm) : le pied est clairement loin du ballon.
    Cas défavorable, rare (moins de 1 % des touches) ;
  * touche « trop éloignée » de la sonde avec la semelle posée sur le ballon : la sonde ne mesure
    que le bout du pied, elle est pessimiste dans ce cas ;
  * contrôles à 3-4 cm : visuellement au contact ;
  * passe et touche à jambes croisées : croisement devant la jambe d'appui, plausible ;
  * séquence de pivot : en gros plan, le buste tourne d'environ 90° en 120 ms puis revient. Cela se
    lit comme un crochet rapide, mais se remarque au ralenti. À la caméra de jeu, le joueur fait une
    trentaine de pixels et le pivot est à peine perceptible.

### Corrections apportées (rendu seul)
1. Touches : jambe choisie une fois par geste (côté du ballon, sinon celle qui l'atteint).
2. Fente d'affichage jusqu'à 0,5 m ; fente de la partie du corps pour les contrôles cuisse,
   poitrine, tête.
3. Pivot d'affichage vers un ballon derrière ou sur le côté (touches, contrôles).
4. Décalage latéral d'affichage des frappes (ballon du côté de l'autre pied).
5. Anti-pénétration en trois essais (radial, puis en levant le pied).
6. Évènements (sons, commentaires, score) au rythme de l'image.

### Non-régression
* **Moteur** : match identique (112bd1dc), avec ou sans diagnostic.
* **Déterminisme** : 5 → 112bd1dc, 104 → 2a6d7bc9, 300 → 8b411e7e.
* **Moteur rapide** : b47d8708.
* **Contacts** : physiquement possibles à 100 %.
* **Tests unitaires** : 128 réussis. **Tests d'interface** : réussis.
* **Match en ligne** : même match des deux côtés, et même image différée avec les mêmes évènements en
  attente à la pause commune.
* **Coût mobile** (`render-cost.cjs`, `AB6=1 REP=4`) : même match, 8 fenêtres de 15 s en alternant
  affichage direct (référence 6a) et contrat. Moyenne des durées d'image par fenêtre :

  | Processeur | Direct (6a) | Contrat (6b) |
  |---|---|---|
  | Non ralenti | 256, 224, 235, 217 ms (moyenne 233) | 238, 245, 232, 281 ms (moyenne 249) |
  | Ralenti ×4 | 412, 387, 491, 326 ms (moyenne 404) | 343, 416, 436, 376 ms (moyenne 393) |

  Écart dans le bruit d'une fenêtre à l'autre (±20 %, selon les phases de jeu), sans tendance
  systématique. Rendu logiciel headless : la mesure compare deux versions, elle ne prédit pas un vrai
  téléphone. Le pivot, le décalage latéral et le choix de jambe ne coûtent une cinématique inverse
  supplémentaire qu'à la première image d'une touche ou d'un contrôle.

### Décision proposée
* **Écarts jugés visuellement négligeables**, à accepter explicitement :
  * contrôles à 3-5 cm au pas du contact, rejoints moins d'une image plus tard ;
  * touches dont la semelle est posée sur le ballon, que la sonde compte trop éloignées ;
  * croisements résiduels (5 % des touches, 2 % des contrôles), croisement devant la jambe d'appui,
    plausible ;
  * 3 pénétrations hors contact (genou d'un contrôle de la cuisse, contact subi), brèves ;
  * son et commentaires au plus une image après l'image du geste ; horloge 0,15 s en avance.
* **Écarts perceptibles qui restent** (rares ou visibles seulement en gros plan) :
  * moins de 1 % des touches et 5 % des contrôles hors de portée (ballon haut ou très loin) : pied
    loin du ballon. La représentation adaptée (saut, jambe en l'air) relève des gestes aériens (6c) ;
  * pivot d'affichage rapide (jusqu'à 75° en environ 0,2 s) sur 26 % des touches : à peine
    perceptible à la caméra de jeu, visible en gros plan ou au ralenti. C'est la représentation
    d'une anomalie moteur (contact admis derrière le joueur), transmise au backlog de l'étape 7.
* Proposition : valider 6b avec ces réserves, ou demander une correction du pivot (fenêtre plus
  longue) avant 6c. **6c n'est pas commencée.**
