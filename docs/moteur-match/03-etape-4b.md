# Étape 4b — Contacts joueur-ballon physiquement vérifiés

Principe : **aucun déplacement artificiel du ballon vers un joueur**. Un joueur ne touche le ballon
que si celui-ci est réellement dans une zone d'atteinte de son corps (géométrie unique
`contact.js`, qui tient compte de la hauteur et de la vitesse du ballon) à l'instant du contact.
Le contact est détecté par un test **balayé** (le ballon ne traverse jamais une zone sans être vu).
L'effet du toucher dépend de la technique du joueur et des conditions (étirement, vitesse
relative, pression, partie du corps), avec le générateur aléatoire du match : tout reste
déterministe pour une même configuration et une même graine.

## 4b-1 — Réception des passes (commit 5a7445a)
* Le destinataire se rend au point où il peut couper la **vraie** trajectoire prédite (réévalué
  toutes les 0,15 s) ; il peut arriver trop tard ou mal se placer : la passe est alors manquée.
* Contact vérifié après le mouvement ; il laisse venir le ballon jusqu'au point de contact idéal.
* Premier toucher par impulsion (`firstTouch`) : amorti, orientation et précision selon la
  technique ; un mauvais toucher laisse filer le ballon (pas de possession acquise).
* Suppression des anciens amortis/déviations artificiels de `receive()`.

## 4b-2 — Conduite de balle et gestes (passes, frappes, centres, dégagements)
**Problème** : à l'arrêt ou au pas, le ballon était tiré vers le pied du porteur (« colle ») ;
un ballon rapide était freiné artificiellement (×0,4) ; pendant l'armé, le joueur se figeait et
pouvait frapper un ballon resté à 1,9 m ; au départ de la frappe, le ballon était recalé sur le pied.

**Solution** :
* Le ballon roule librement ; le porteur ne le touche que dans la zone d'atteinte de son pied,
  par une impulsion :
  * au pas / à l'arrêt : petites touches qui visent le point de contact (0,32 m devant lui),
    imprécision selon la technique (`touchQuality`) ;
  * en course : poussée dont la force est **déduite de l'écart voulu** pied-ballon et de la
    décélération réelle du ballon sur l'herbe (~1,4 m/s²) : collé au pied en un-contre-un, ~0,3 m
    au trot, plus loin seulement lancé dans l'espace.
* Geste armé : il n'est exécuté que si le ballon est dans la zone d'atteinte au moment du contact.
  Sinon le joueur accompagne le ballon (en le regardant tant qu'il n'est pas au pied), l'animation
  reste à l'armé puis repart pour que l'image du contact coïncide avec le vrai contact ; au-delà
  du délai, le geste est **abandonné** (enregistré dans le diagnostic) et le joueur redécide.
* Décider (choix de la passe) reste possible ballon à un pas ; seul le **contact** exige la zone.
* Plus aucun recalage du ballon au départ des frappes (`kickBall`, centres, tirs).
* Comportements de porteur nécessaires sans la « colle » : il va au ballon en anticipant sa
  trajectoire, il peut accélérer au-delà du trot pour rattraper son ballon, il garde le ballon
  dans le terrain près des lignes, le premier contrôle est orienté vers l'intérieur.

## 4b-3 — Ballon libre
**Problème** : le joueur dont le « pied » était le plus proche (< 1 m) récupérait le ballon,
quelle que soit sa hauteur ou sa trajectoire (24 % de récupérations physiquement possibles).

**Solution** : test balayé pour tous les joueurs de champ (pied, cuisse, poitrine) ; le premier
contact réel l'emporte ; premier toucher selon la technique ; raté, le ballon repart libre.
Le tireur ne peut pas reprendre sa frappe pendant 0,45 s ; deux touches d'un même joueur sont
séparées d'au moins 0,25 s. Le poursuivant attaque le ballon qui roule (il vise au-delà au lieu
de freiner sur sa position).

## Résultats (outils `tools/bench/`)

| Mesure | Avant 4b | Après 4b-1 | Après 4b-3 |
|---|---|---|---|
| Réceptions physiquement possibles | 10 % | 100 % | 100 % |
| Récupérations physiquement possibles | 16 % | 24 % | **100 %** |
| Conduite (touches) physiquement possibles | — (colle) | — (colle) | **100 %** |
| Distance au point de contact (réception / récupération / conduite) | 2,2 m / — / — | 0,36 m / 1,35 m / — | 0,35 / 0,39 / 0,39 m |
| Départ des frappes : ballon dans la zone du pied | recalé | recalé | toujours (max 0,91 m du pied) |
| Réceptions manquées | — | 6 % | 11 % (dont gestes abandonnés) |

Validation : tests unitaires (87 ✔), tests d'interface ✔, déterminisme ✔ (identique avec ou sans
diagnostic), moteur rapide inchangé (`b47d8708`), aucun ballon bloqué (ballons libres > 6 s :
36 sur 4 matchs contre 48 avant ; dénouement automatique d'un ballon coincé : 5 sur 4 matchs).

### Statistiques (8 matchs, `stats.mjs`) — non corrigées par des bonus
| | Réel | 4b-1 | 4b-3 (sans l'attaque du ballon qui roule) | 4b-3 final |
|---|---|---|---|---|
| Buts | 2,7–2,9 | 5,3 | 2,5 | 1,1 |
| Tirs | 24–26 | 25,8 | 20,4 | 16,5 |
| % passes réussies | 80–84 | 62,6 | 57,4 | 58,5 |
| Passes | 850–1000 | 731 | 731 | 774 |
| Corners | 9,5–10,5 | 8,5 | 10,6 | 10,6 |
| Touches | 38–45 | 44 | 45,5 | 47,9 |
| Fautes | 20–23 | 15,5 | 17,1 | 18,8 |
| Distance (22 joueurs, km) | 215–235 | 214 | 226 | 227 |

Sur 8 matchs, le nombre de buts varie beaucoup d'une série à l'autre (écart-type ≈ 0,6).
Les tirs baissent parce que le porteur arrive plus souvent excentré (xG moyen plus faible à
distance égale) et centre davantage : effet du jeu, pas d'un tir bloqué. Le taux de passes réussies
est bas depuis 4b-1 : les réceptions peuvent réellement échouer alors que la précision des passes
est encore décidée avant la frappe (étape 4c). Aucun bonus n'a été ajouté pour compenser.

## Anomalies restantes (étapes suivantes)
* Issues des passes et des tirs tirées au sort avant le contact (4c, 4d) → taux de passes réussies bas.
* Gardien : prise de balle et sorties aériennes par proximité (4d).
* Tacles et « chipages » du ballon par proximité, gain en duel (4e).
* Dénouement automatique d'un ballon coincé plus de 3 s (rare) : non physique.
* Coups de pied arrêtés : le tireur est placé au ballon par la remise en jeu (non vérifié).
* `gain()` oriente encore le joueur face au ballon d'un coup.
* Joueurs en coordonnées normalisées dans le moteur (conversion `posM`).
