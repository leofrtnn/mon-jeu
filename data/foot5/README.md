# Big 5 — clubs et joueurs (saison 2026-27)

`foot5.json` contient les **96 clubs**, environ **2 600 joueurs** et les **96 entraîneurs** des 5 grands championnats :
Premier League, LaLiga, Serie A, Bundesliga et Ligue 1.

## Contenu

- **leagues** : id, nom, pays, liste des clubs.
- **clubs** :
  - identité : nom, nom complet, surnom, fondation ;
  - stade et capacité, entraîneur, président, propriétaire, site web ;
  - couleurs du maillot (domicile et extérieur, en hexadécimal) ;
  - **logo** (`logo.url`), liens Wikipédia et Wikidata.
- **players** :
  - identité : nom, nom complet, numéro, rôle (capitaine…) ;
  - poste (code Wikipédia, poste détaillé, poste du jeu en français) ;
  - nationalité, date et lieu de naissance, âge, taille ;
  - **photo** (`photo.url`) ;
  - statistiques au club actuel (matchs, buts, depuis quand) ;
  - sélection nationale A (matchs, buts) ;
  - **carrière complète** club par club (années, matchs, buts, prêts).
- **coaches** (entraîneurs principaux, un par club) :
  - nom, nom complet, club, nationalité(s), date et lieu de naissance, âge ;
  - **photo** (`photo.url`) ;
  - carrière d'entraîneur (années, équipes) et carrière de joueur ;
  - liens Wikipédia et Wikidata.
  - `vacant: true` quand le poste est vacant ou non renseigné.

## Images

Les logos et les photos ne sont **pas copiés** dans le fichier. Les champs `url` pointent vers les images
hébergées par Wikipédia et Wikimedia Commons, qui s'affichent directement dans un navigateur ou une application.

- Ajoutez `?width=200` à l'URL pour obtenir une miniature.
- Chaque image reste soumise à ses propres droits : les logos de clubs sont des marques déposées, et les photos ont leur propre licence, indiquée sur Commons.

## Sources et limites

- **Sources** : Wikipédia en anglais (texte sous licence CC BY-SA 4.0) et Wikidata (CC0), extraites automatiquement le jour indiqué dans `meta.generated`.
- **Erreurs possibles** : l'extraction est automatique, et Wikipédia peut avoir du retard sur un transfert.
- **Joueurs exclus** : les joueurs prêtés à l'extérieur ne sont pas comptés dans l'effectif de leur club d'origine.

## Consulter

`index.html` affiche les données sur téléphone : ligues, puis clubs avec logos, puis joueurs avec photos et statistiques, plus une recherche.
Il faut l'ouvrir via un serveur web, par exemple GitHub Pages ou `python3 -m http.server`.

## Mettre à jour

```bash
SSL_CERT_FILE=... python3 scripts/foot/build.py
```

Le script a besoin d'accéder à `en.wikipedia.org`. Le cache (`scripts/foot/.cache`) évite de tout retélécharger ; supprimez-le pour rafraîchir les données.
