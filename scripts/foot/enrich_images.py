"""
Complète les photos manquantes des joueurs avec l'image Wikidata (propriété P18).
Seul le NOM du fichier est gardé : l'image reste hébergée sur Wikimedia Commons et le jeu
l'affiche depuis là (aucune image copiée dans le dépôt).

Usage : python3 scripts/foot/enrich_images.py   (puis build_game_world.py)
"""
import json, os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
import wiki

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC = os.path.join(ROOT, 'data', 'foot5', 'foot5.json')

def commons_url(name):
    return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + urllib.parse.quote(name.replace(' ', '_'))

def p18(ent):
    for c in ent.get('claims', {}).get('P18', []):
        v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
        if isinstance(v, str) and v: return v
    return None

d = json.load(open(SRC, encoding='utf-8'))
todo = [p for p in d['players'] if p.get('wikidata') and not (p.get('photo') or {}).get('file')]
todo += [c for c in d.get('coaches', []) if c.get('id', '').startswith('Q') and not (c.get('photo') or {}).get('file')]
print(f'{len(todo)} fiches sans photo', flush=True)
qids = [x.get('wikidata') or x['id'] for x in todo]
added = 0
for i in range(0, len(qids), 500):
    ents = wiki.entities(qids[i:i + 500])
    for x in todo[i:i + 500]:
        f = p18(ents.get(x.get('wikidata') or x['id'], {}))
        if f:
            x['photo'] = {'file': f, 'url': commons_url(f)}
            added += 1
    print(f'  {min(i + 500, len(qids))}/{len(qids)} · {added} photos ajoutées', flush=True)
with open(SRC, 'w', encoding='utf-8') as fh:
    json.dump(d, fh, ensure_ascii=False, indent=1)
print(f'OK : {added} photos ajoutées')
