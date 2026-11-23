# Défauts d'interface relevés (hors moteur de match)

Défauts trouvés pendant le travail sur le moteur et l'animation. Ils sont enregistrés ici pour ne pas
être oubliés ; chacun sera corrigé séparément, sans lien avec les étapes du moteur.

## DI-1 — Ralenti programmé qui fige le match (ouvert)
* **Relevé** : étape 6c-A, en faisant tourner la sonde aérienne en simulation accélérée.
* **Symptôme** : après une faute ou une occasion, le match s'arrête définitivement (horloge figée, plus
  aucun pas de simulation), sans message.
* **Cause** (`js/ui/matchView.js`) :
  * `updateLive` rend la main tant qu'un ralenti est programmé (`replayPlan`) et que son délai est écoulé :
    `if (this.replayPlan && this.replayPlan.frames && (this.replayPlan.wait -= realDt) <= 0) { this.startReplay(); return; }` ;
  * `startReplay` sort sans rien faire si moins de 10 images ont été enregistrées
    (`if (!frames || frames.length < 10) return;`) et **ne supprime pas** `replayPlan` ;
  * la condition reste vraie à chaque image : la boucle ne simule plus jamais.
* **Quand** : les images du ralenti sont enregistrées une fois par image affichée (`recordFrame`) ; à très
  faible cadence (quelques images par seconde, appareil très lent ou vitesse accélérée), la fenêtre de
  4,6 s du ralenti contient moins de 10 images.
* **Impact** : blocage complet du match pour le joueur concerné (et, en ligne, attente de l'autre
  manager). Aucun effet sur le moteur ni sur les résultats.
* **Correction proposée** (interface seulement) : dans `startReplay`, abandonner le ralenti
  (`this.replayPlan = null`) quand il n'y a pas assez d'images ; ajouter un test qui simule une cadence
  très faible.
* **Contournement actuel** : la sonde `anim-probe.cjs` coupe les ralentis en mode accéléré.
