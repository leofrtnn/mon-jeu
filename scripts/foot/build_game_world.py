"""
Construit data/real-world.json : version compacte de data/foot5/foot5.json, prête pour le jeu
(mode « Monde réel »). Seuls les faits nécessaires au jeu sont gardés (noms, postes, âges,
nationalités, numéros, sélections, couleurs, stades). Aucun logo ni photo.
La réputation des clubs (niveau sportif et financier) est une estimation du jeu.

Usage : python3 scripts/foot/build_game_world.py
"""
import json, os, unicodedata

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC = os.path.join(ROOT, 'data', 'foot5', 'foot5.json')
OUT = os.path.join(ROOT, 'data', 'real-world.json')

# Réputation (30-95) : estimation du niveau des clubs, base de la force des effectifs et des budgets.
REP = {
  'arsenal': 92, 'aston-villa': 82, 'afc-bournemouth': 74, 'brentford': 73, 'brighton-hove-albion': 77, 'chelsea': 88,
  'coventry-city': 64, 'crystal-palace': 76, 'everton': 74, 'fulham': 73, 'hull-city': 62, 'ipswich-town': 65,
  'leeds-united': 70, 'liverpool': 92, 'manchester-city': 92, 'manchester-united': 85, 'newcastle-united': 84,
  'nottingham-forest': 76, 'sunderland': 68, 'tottenham-hotspur': 83,
  'deportivo-alavs': 65, 'athletic-club': 80, 'atltico-madrid': 87, 'barcelona': 92, 'real-betis': 79, 'celta-vigo': 72,
  'deportivo-a-corua': 63, 'elche': 64, 'espanyol': 68, 'getafe': 69, 'levante': 63, 'mlaga': 62, 'osasuna': 70,
  'racing-de-santander': 62, 'rayo-vallecano': 70, 'real-madrid': 94, 'real-sociedad': 77, 'sevilla': 74, 'valencia': 72, 'villarreal': 81,
  'atalanta': 82, 'bologna': 77, 'cagliari': 66, 'como': 75, 'fiorentina': 76, 'frosinone': 60, 'genoa': 67, 'inter-milan': 89,
  'juventus': 86, 'lazio': 78, 'lecce': 63, 'ac-milan': 85, 'monza': 62, 'napoli': 87, 'parma': 66, 'roma': 81, 'sassuolo': 66,
  'torino': 70, 'udinese': 68, 'venezia': 61,
  'fc-augsburg': 68, 'union-berlin': 70, 'werder-bremen': 71, 'borussia-dortmund': 86, 'sv-elversberg': 58, 'eintracht-frankfurt': 80,
  'sc-freiburg': 76, 'hamburger-sv': 68, 'tsg-hoffenheim': 74, '1-fc-kln': 67, 'rb-leipzig': 83, 'bayer-leverkusen': 85, 'mainz-05': 72,
  'bayern-munich': 93, 'borussia-mnchengladbach': 72, 'sc-paderborn': 59, 'schalke-04': 66, 'vfb-stuttgart': 79,
  'angers': 62, 'auxerre': 63, 'brest': 68, 'le-havre': 62, 'le-mans': 58, 'lens': 75, 'lille': 78, 'lorient': 62, 'lyon': 79,
  'olympique-de-marseille': 82, 'as-monaco': 81, 'nice': 74, 'paris-fc': 66, 'paris-saint-germain': 92, 'stade-rennais': 75,
  'rc-strasbourg': 73, 'toulouse': 70, 'troyes': 59,
}
SHORT = {
  'arsenal': 'ARS', 'aston-villa': 'AVL', 'afc-bournemouth': 'BOU', 'brentford': 'BRE', 'brighton-hove-albion': 'BHA', 'chelsea': 'CHE',
  'coventry-city': 'COV', 'crystal-palace': 'CRY', 'everton': 'EVE', 'fulham': 'FUL', 'hull-city': 'HUL', 'ipswich-town': 'IPS',
  'leeds-united': 'LEE', 'liverpool': 'LIV', 'manchester-city': 'MCI', 'manchester-united': 'MUN', 'newcastle-united': 'NEW',
  'nottingham-forest': 'NFO', 'sunderland': 'SUN', 'tottenham-hotspur': 'TOT',
  'deportivo-alavs': 'ALA', 'athletic-club': 'ATH', 'atltico-madrid': 'ATM', 'barcelona': 'BAR', 'real-betis': 'BET', 'celta-vigo': 'CEL',
  'deportivo-a-corua': 'DEP', 'elche': 'ELC', 'espanyol': 'ESP', 'getafe': 'GET', 'levante': 'LEV', 'mlaga': 'MAL', 'osasuna': 'OSA',
  'racing-de-santander': 'RAC', 'rayo-vallecano': 'RAY', 'real-madrid': 'RMA', 'real-sociedad': 'RSO', 'sevilla': 'SEV', 'valencia': 'VAL', 'villarreal': 'VIL',
  'atalanta': 'ATA', 'bologna': 'BOL', 'cagliari': 'CAG', 'como': 'COM', 'fiorentina': 'FIO', 'frosinone': 'FRO', 'genoa': 'GEN', 'inter-milan': 'INT',
  'juventus': 'JUV', 'lazio': 'LAZ', 'lecce': 'LEC', 'ac-milan': 'MIL', 'monza': 'MON', 'napoli': 'NAP', 'parma': 'PAR', 'roma': 'ROM', 'sassuolo': 'SAS',
  'torino': 'TOR', 'udinese': 'UDI', 'venezia': 'VEN',
  'fc-augsburg': 'FCA', 'union-berlin': 'FCU', 'werder-bremen': 'SVW', 'borussia-dortmund': 'BVB', 'sv-elversberg': 'SVE', 'eintracht-frankfurt': 'SGE',
  'sc-freiburg': 'SCF', 'hamburger-sv': 'HSV', 'tsg-hoffenheim': 'TSG', '1-fc-kln': 'KOE', 'rb-leipzig': 'RBL', 'bayer-leverkusen': 'B04', 'mainz-05': 'M05',
  'bayern-munich': 'FCB', 'borussia-mnchengladbach': 'BMG', 'sc-paderborn': 'SCP', 'schalke-04': 'S04', 'vfb-stuttgart': 'VFB',
  'angers': 'SCO', 'auxerre': 'AJA', 'brest': 'SB29', 'le-havre': 'HAC', 'le-mans': 'LMF', 'lens': 'RCL', 'lille': 'LOSC', 'lorient': 'FCL', 'lyon': 'OL',
  'olympique-de-marseille': 'OM', 'as-monaco': 'ASM', 'nice': 'OGCN', 'paris-fc': 'PFC', 'paris-saint-germain': 'PSG', 'stade-rennais': 'SRFC',
  'rc-strasbourg': 'RCSA', 'toulouse': 'TFC', 'troyes': 'ESTA',
}

def lum(h):
    h = h.lstrip('#'); r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0.299 * r + 0.587 * g + 0.114 * b

def colors(c):
    home = (c.get('colors') or {}).get('home') or ['#444444', '#ffffff']
    away = (c.get('colors') or {}).get('away') or ['#ffffff']
    c1 = home[0]
    c2 = next((x for x in home[1:] + away if x and x.lower() != c1.lower()), None)
    if not c2 or abs(lum(c1) - lum(c2)) < 60:
        c2 = '#ffffff' if lum(c1) < 140 else '#111111'
    return [c1.upper(), c2.upper()]

def split(name):
    parts = name.split()
    return ('', parts[0]) if len(parts) == 1 else (parts[0], ' '.join(parts[1:]))

d = json.load(open(SRC, encoding='utf-8'))
clubs = []
for lg in d['leagues']:
    for cid in lg['clubs']:
        c = next(x for x in d['clubs'] if x['id'] == cid)
        clubs.append({'id': cid, 'league': lg['id'], 'name': c.get('shortName') if c.get('shortName') and len(c['name']) > 22 else c['name'],
                      'short': SHORT.get(cid, c['name'][:3].upper()), 'colors': colors(c), 'stadium': c.get('capacity') or 20000,
                      'rep': REP.get(cid, 65)})
players = []
for p in d['players']:
    first, last = split(p['name'])
    intl = p.get('international') or {}
    players.append({'club': p['club'], 'f': first, 'l': last, 'pos': p['position']['game'], 'age': p.get('age') or 0,
                    'nat': (p.get('nationality') or {}).get('name') or '', 'num': p.get('number') or 0,
                    'caps': intl.get('caps') or 0, 'ig': intl.get('goals') or 0, 'apps': (p.get('clubStats') or {}).get('apps') or 0})
coaches = [{'club': c['club'], 'name': c['name'], 'nat': (c.get('nationality') or [''])[0], 'age': c.get('age') or 50} for c in d['coaches']]
out = {'format': 'coach-de-poche-monde-reel-v1', 'season': d['meta']['season'], 'sources': d['meta']['sources'],
       'leagues': [{'id': lg['id'], 'name': lg['name'], 'country': lg['country']} for lg in d['leagues']],
       'clubs': clubs, 'players': players, 'coaches': coaches}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{OUT} : {len(clubs)} clubs, {len(players)} joueurs, {len(coaches)} entraîneurs, {os.path.getsize(OUT) // 1024} Ko")
