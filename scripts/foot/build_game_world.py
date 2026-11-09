"""
Construit data/real-world.json : version compacte de data/foot5/foot5.json, prête pour le jeu
(mode « Monde réel »). Seuls les faits nécessaires au jeu sont gardés (noms, postes, âges,
nationalités, numéros, sélections, couleurs, stades) + le NOM des fichiers de logo et de photo
sur Wikipédia/Wikimedia : les images ne sont pas copiées, le jeu les affiche depuis Wikimedia.
La réputation des clubs (niveau sportif et financier) est une estimation du jeu.

Usage : python3 scripts/foot/build_game_world.py
"""
import json, os, re, unicodedata

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
# Championnats 6 à 10 : réputation et sigle par mot-clé du nom (le reste : valeurs par défaut).
REP_KEY = [
  ('benfica', 81, 'SLB'), ('porto', 80, 'FCP'), ('sporting cp', 82, 'SCP'), ('braga', 73, 'SCB'), ('vitoria', 66, 'VSC'), ('guimar', 66, 'VSC'),
  ('famalic', 62, None), ('gil vicente', 60, 'GVI'), ('rio ave', 58, None), ('moreirense', 58, None), ('santa clara', 59, None), ('estoril', 59, None),
  ('casa pia', 57, None), ('arouca', 58, None), ('nacional', 55, None), ('maritimo', 56, None), ('alverca', 54, None), ('estrela', 55, None), ('viseu', 53, None),
  ('ajax', 78, 'AJX'), ('psv', 79, 'PSV'), ('feyenoord', 77, 'FEY'), ('az', 71, 'AZ'), ('twente', 68, 'TWE'), ('utrecht', 66, 'UTR'),
  ('go ahead', 62, 'GAE'), ('heerenveen', 61, None), ('nec', 62, 'NEC'), ('groningen', 60, None), ('sparta rotterdam', 59, 'SPR'), ('fortuna sittard', 58, 'FOR'),
  ('pec zwolle', 58, 'PEC'), ('excelsior', 56, 'EXC'), ('ado den haag', 56, 'ADO'), ('cambuur', 55, None), ('telstar', 53, None), ('willem', 56, 'WII'),
  ('club brugge', 76, 'CLB'), ('anderlecht', 71, 'RSCA'), ('union', 73, 'USG'), ('genk', 69, 'KRC'), ('gent', 67, 'GNT'), ('antwerp', 68, 'ANT'),
  ('standard', 64, 'SL16'), ('cercle', 60, 'CER'), ('mechelen', 61, 'KVM'), ('charleroi', 61, 'CHA'), ('westerlo', 59, None), ('leuven', 59, 'OHL'),
  ('sint-truid', 58, 'STVV'), ('kortrijk', 56, 'KVK'), ('zulte', 56, 'ZWA'), ('beveren', 54, None), ('lommel', 54, None), ('louviere', 53, 'RAAL'),
  ('galatasaray', 81, 'GS'), ('fenerbah', 80, 'FB'), ('besiktas', 75, 'BJK'), ('trabzon', 71, 'TS'), ('basaksehir', 67, 'IBFK'), ('samsun', 64, None),
  ('goztepe', 63, None), ('rizespor', 60, None), ('kasimpasa', 61, None), ('konyaspor', 61, None), ('alanya', 60, None), ('gaziantep', 60, None),
  ('eyup', 61, None), ('kocaeli', 59, None), ('genclerbirligi', 58, 'GEN'), ('amed', 57, None), ('erzurum', 56, None), ('corum', 55, None),
  ('slavia', 72, 'SLA'), ('sparta prague', 70, 'SPA'), ('plzen', 67, 'PLZ'), ('banik', 62, 'BAN'), ('jablonec', 58, None), ('olomouc', 59, 'SIG'),
  ('liberec', 58, None), ('boleslav', 58, 'MBO'), ('hradec', 56, None), ('slovacko', 56, None), ('bohemians', 56, 'BOH'), ('teplice', 55, None),
  ('pardubice', 54, None), ('zbrojovka', 53, 'ZBR'), ('artis', 53, None), ('zlin', 53, None),
]
DEFAULT_REP = {'POR1': 57, 'NED1': 58, 'BEL1': 57, 'TUR1': 59, 'CZE1': 55}
PREFIX = {'fc', 'sc', 'sk', 'fk', 'ac', 'kv', 'k', 'r', 'rsc', 'sl', 'cd', 'cf', 'gd', 'ud', 'kaa', 'krc', 'kvc', 'rc', 'sv', 'afc', 'f', 'c', 's', 'a',
          'royal', 'royale', 'club', 'cs', 'pec', 'ado', 'sfk', '1', 'raal', 'fsv', 'ksv', 'vv', 'sint', 'oud'}

def ascii_low(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()

def rep_short(c, league):
    n = ascii_low(c['name'] + ' ' + c['id'].replace('-', ' '))
    for key, rep, short in REP_KEY:
        if re.search(r'\b' + re.escape(key), n):   # début de mot : « az » ne capte pas « Gaziantep »
            return rep, short
    return DEFAULT_REP.get(league, 58), None

def auto_short(name, used):
    words = [w for w in re.split(r'[^A-Za-zÀ-ÿ0-9]+', name) if w]
    core = [w for w in words if ascii_low(w) not in PREFIX] or words
    base = ascii_low(core[0]).upper()[:3] if core else 'CLB'
    s, k = base, 0
    while s in used:
        s = base[:2] + chr(65 + k); k += 1
    return s

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

# Noms de fichiers de logo mal extraits de Wikipédia.
LOGO_FIX = {'tottenham-hotspur': 'Tottenham Hotspur.svg'}

def clean_logo(cid, f):
    if cid in LOGO_FIX: return LOGO_FIX[cid]
    if not f: return None
    f = f.split('|')[0].replace('class=skin-invert', '').strip()
    return f if '.' in f else None

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
used = set(SHORT.values())
for lg in d['leagues']:
    for cid in lg['clubs']:
        c = next(x for x in d['clubs'] if x['id'] == cid)
        name = c.get('shortName') if c.get('shortName') and len(c['name']) > 22 else c['name']
        if cid in REP:
            rep, short = REP[cid], SHORT.get(cid)
        else:
            rep, short = rep_short(c, lg['id'])
        if not short or (short in used and cid not in SHORT):
            short = auto_short(name, used)
        used.add(short)
        clubs.append({'id': cid, 'league': lg['id'], 'name': name, 'short': short, 'colors': colors(c),
                      'stadium': c.get('capacity') or 15000, 'rep': rep, 'logo': clean_logo(cid, (c.get('logo') or {}).get('file'))})
players = []
for p in d['players']:
    first, last = split(p['name'])
    intl = p.get('international') or {}
    players.append({'club': p['club'], 'f': first, 'l': last, 'pos': p['position']['game'], 'age': p.get('age') or 0,
                    'nat': (p.get('nationality') or {}).get('name') or '', 'num': p.get('number') or 0,
                    'caps': intl.get('caps') or 0, 'ig': intl.get('goals') or 0, 'apps': (p.get('clubStats') or {}).get('apps') or 0,
                    'ph': (p.get('photo') or {}).get('file')})
coaches = [{'club': c['club'], 'name': c['name'], 'nat': (c.get('nationality') or [''])[0], 'age': c.get('age') or 50} for c in d['coaches']]
out = {'format': 'coach-de-poche-monde-reel-v1', 'season': d['meta']['season'], 'sources': d['meta']['sources'],
       'leagues': [{'id': lg['id'], 'name': lg['name'], 'country': lg['country']} for lg in d['leagues']],
       'clubs': clubs, 'players': players, 'coaches': coaches}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{OUT} : {len(clubs)} clubs, {len(players)} joueurs, {len(coaches)} entraîneurs, {os.path.getsize(OUT) // 1024} Ko")
