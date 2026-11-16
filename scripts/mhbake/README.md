# Joueurs réalistes (données MakeHuman)

`data/mh/` contient le corps des joueurs vus de près : un humain réaliste issu des données de
[MakeHuman](http://www.makehuman.org) (corps de base, cibles de morphologie, peaux, cheveux, yeux,
sourcils — ressources publiées en CC0 par l'équipe MakeHuman), « cuit » par `bake.py`.

Régénérer :

```sh
npm pack makehuman-data && tar xzf makehuman-data-*.tgz   # données MakeHuman (≈ 90 Mo)
MH_DATA=$PWD/package python3 scripts/mhbake/bake.py /tmp/mh_out
# puis copier mhplayer.bin et les textures (converties en .webp / .jpg) dans data/mh/
```

Le script : morphologie d'athlète (homme jeune, musclé) en 3 variantes de peau, poids ramenés
aux 13 os du jeu (les animations du jeu s'appliquent telles quelles), bras et jambes remis
droits, tenue taillée dans le corps (maillot, manches, short, chaussettes, crampons) avec des
coordonnées de texture compatibles avec les textures de maillot du jeu, cheveux / yeux / sourcils.
