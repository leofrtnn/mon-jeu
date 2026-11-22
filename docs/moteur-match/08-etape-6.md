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
  * Les commentaires, les sons et l'interface restent au temps du moteur. Ils précèdent l'image de
    0,15 s, comme avant 6b.
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
