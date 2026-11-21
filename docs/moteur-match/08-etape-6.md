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
