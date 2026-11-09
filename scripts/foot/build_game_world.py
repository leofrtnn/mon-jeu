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
  # Championnats 11 à 20.
  ('olympiacos', 74, 'OLY'), ('panathinaikos', 70, 'PAO'), ('paok', 71, 'PAOK'), ('aek', 70, 'AEK'), ('aris', 62, 'ARI'), ('asteras', 56, 'AST'),
  ('atromitos', 56, 'ATR'), ('ofi', 57, 'OFI'), ('volos', 54, 'VOL'), ('levadiakos', 55, 'LEV'), ('panetolikos', 54, 'PNT'), ('iraklis', 53, 'IRA'),
  ('kalamata', 52, 'KAL'), ('kifisia', 53, 'KIF'),
  ('bodo', 71, 'BOD'), ('molde', 66, 'MOL'), ('rosenborg', 64, 'RBK'), ('brann', 63, 'BRA'), ('viking', 62, 'VIK'), ('valerenga', 60, 'VIF'),
  ('lillestrom', 59, 'LSK'), ('tromso', 58, 'TIL'), ('sarpsborg', 57, 'SAR'), ('fredrikstad', 57, 'FFK'), ('kfum', 56, 'KFU'), ('sandefjord', 55, 'SAN'),
  ('aalesund', 54, 'AAL'), ('hamarkameratene', 54, 'HAM'), ('kristiansund', 54, 'KBK'), ('start', 53, 'IKS'),
  ('legia', 66, 'LEG'), ('lech', 66, 'LPO'), ('rakow', 65, 'RAK'), ('jagiellonia', 63, 'JAG'), ('pogon', 61, 'POG'), ('gornik', 60, 'GOR'),
  ('widzew', 59, 'WID'), ('cracovia', 58, 'CRA'), ('wisla krakow', 58, 'WKR'), ('slask', 58, 'SLA'), ('zaglebie', 57, 'ZAG'), ('piast', 57, 'PIA'),
  ('korona', 56, 'KOR'), ('katowice', 56, 'GKS'), ('motor', 56, 'MOT'), ('radomiak', 55, 'RAD'), ('wisla plock', 55, 'WPL'), ('wieczysta', 54, 'WIE'),
  ('copenhagen', 71, 'FCK'), ('midtjylland', 70, 'FCM'), ('brondby', 64, 'BIF'), ('nordsjaelland', 63, 'FCN'), ('agf', 62, 'AGF'), ('randers', 58, 'RFC'),
  ('silkeborg', 58, 'SIF'), ('viborg', 57, 'VFF'), ('odense', 57, 'OB'), ('sonderjyske', 55, 'SJF'), ('lyngby', 55, 'LBK'), ('horsens', 54, 'ACH'),
  ('salzburg', 72, 'RBS'), ('sturm', 67, 'STU'), ('rapid', 63, 'RAP'), ('austria wien', 62, 'FAK'), ('lask', 61, 'LASK'), ('wolfsberger', 58, 'WAC'),
  ('hartberg', 55, 'TSV'), ('altach', 54, 'ALT'), ('tirol', 54, 'WSG'), ('ried', 54, 'RIE'), ('grazer', 54, 'GAK'), ('lustenau', 53, 'LUS'),
  ('young boys', 69, 'YB'), ('basel', 67, 'FCB'), ('lugano', 63, 'LUG'), ('servette', 62, 'SFC'), ('zurich', 60, 'FCZ'), ('st. gallen', 59, 'FCSG'),
  ('luzern', 59, 'FCL'), ('lausanne', 58, 'LS'), ('sion', 57, 'SIO'), ('grasshopper', 56, 'GCZ'), ('thun', 55, 'THU'), ('vaduz', 53, 'VAD'),
  ('celtic', 74, 'CEL'), ('rangers', 71, 'RFC'), ('hearts', 60, 'HEA'), ('heart of midlothian', 60, 'HEA'), ('hibernian', 59, 'HIB'), ('aberdeen', 59, 'ABE'),
  ('dundee united', 56, 'DUU'), ('dundee', 54, 'DUN'), ('motherwell', 56, 'MOT'), ('kilmarnock', 55, 'KIL'), ('st mirren', 55, 'STM'), ('st johnstone', 53, 'STJ'),
  ('falkirk', 53, 'FAL'),
  ('malmo', 68, 'MFF'), ('djurgarden', 64, 'DIF'), ('hammarby', 63, 'HIF'), ('aik', 63, 'AIK'), ('hacken', 62, 'BKH'), ('elfsborg', 62, 'IFE'),
  ('mjallby', 58, 'MAI'), ('goteborg', 58, 'IFK'), ('sirius', 56, 'SIR'), ('gais', 56, 'GAIS'), ('brommapojkarna', 55, 'BP'), ('halmstad', 55, 'HBK'),
  ('kalmar', 55, 'KFF'), ('degerfors', 54, 'DIF2'), ('vasteras', 54, 'VSK'), ('orgryte', 53, 'ORG'),
  ('dinamo zagreb', 71, 'DIN'), ('hajduk', 66, 'HAJ'), ('rijeka', 64, 'RIJ'), ('osijek', 60, 'OSI'), ('lokomotiva', 57, 'LOK'), ('varazdin', 56, 'VAR'),
  ('gorica', 56, 'GOR2'), ('istra', 56, 'IST'), ('slaven', 55, 'SLB'), ('rudes', 53, 'RUD'),
  ('crvena', 72, 'CZV'), ('red star', 72, 'CZV'), ('partizan', 66, 'PAR'), ('vojvodina', 60, 'VOJ'), ('cukaricki', 58, 'CUK'), ('tsc', 58, 'TSC'),
  ('radnicki nis', 55, 'RNI'), ('novi pazar', 55, 'NPA'), ('mladost', 54, 'MLA'), ('ofk beograd', 54, 'OFK'), ('imt', 53, 'IMT'), ('radnik', 53, 'RAS'),
  ('zeleznicar', 53, 'ZEL'), ('radnicki 1923', 54, 'R23'), ('macva', 52, 'MAC'), ('zemun', 52, 'ZEM'),
  # Championnats 21 à 30.
  ('flamengo', 80, 'FLA'), ('palmeiras', 80, 'PAL'), ('botafogo', 75, 'BOT'), ('fluminense', 72, 'FLU'), ('atletico mineiro', 73, 'CAM'),
  ('corinthians', 72, 'COR'), ('sao paulo', 72, 'SAO'), ('internacional', 71, 'INT2'), ('gremio', 70, 'GRE2'), ('cruzeiro', 72, 'CRU'),
  ('bahia', 69, 'BAH'), ('vasco', 68, 'VAS'), ('santos fc', 68, 'SAN'), ('bragantino', 68, 'RBB'), ('athletico', 67, 'CAP'),
  ('vitoria', 63, 'VIT'), ('mirassol', 63, 'MIR'), ('coritiba', 62, 'CFC'), ('chapecoense', 61, 'CHA'), ('remo', 60, 'REM'),
  ('al hilal', 78, 'HIL'), ('al-hilal', 78, 'HIL'), ('al nassr', 77, 'NAS'), ('al ahli', 76, 'AHL'), ('al-ittihad', 75, 'ITT'), ('al qadsiah', 72, 'QAD'),
  ('al-ettifaq', 66, 'ETT'), ('al shabab', 66, 'SHB'), ('al-taawoun', 65, 'TAA'), ('neom', 64, 'NEO'), ('al-khaleej', 62, 'KHL'),
  ('al-fateh', 62, 'FAT'), ('al-fayha', 61, 'FAY'), ('al-kholood', 61, 'KHO'), ('al-riyadh', 60, 'RIY'), ('al-hazem', 59, 'HAZ'),
  ('al-diriyah', 59, 'DIR'), ('al-faisaly', 59, 'FAI'), ('abha', 58, 'ABH'),
  ('club america', 72, 'AME'), ('monterrey', 72, 'MTY'), ('tigres', 72, 'TIG'), ('cruz azul', 71, 'CAZ'), ('toluca', 70, 'TOL'),
  ('guadalajara', 68, 'CHV'), ('pachuca', 67, 'PAC'), ('pumas', 66, 'PUM'), ('leon', 65, 'LEO'), ('santos laguna', 63, 'SLA'),
  ('kawasaki', 66, 'KAW'), ('vissel', 68, 'VIS'), ('sanfrecce', 67, 'SAN2'), ('kashima', 67, 'KAS'), ('urawa', 66, 'URA'), ('machida', 66, 'MAC2'),
  ('yokohama f', 65, 'YFM'), ('gamba', 64, 'GAM'), ('kashiwa', 65, 'KRE'), ('fc tokyo', 63, 'TOK'), ('nagoya', 63, 'NAG'), ('cerezo', 63, 'CER'),
  ('zenit', 74, 'ZEN'), ('krasnodar', 71, 'KRA'), ('spartak', 70, 'SPA'), ('cska moscow', 69, 'CSK'), ('dynamo moscow', 68, 'DYM'), ('lokomotiv moscow', 68, 'LMO'),
  ('rubin', 63, 'RUB'), ('rostov', 63, 'ROS'),
  ('shakhtar', 72, 'SHA'), ('dynamo kyiv', 70, 'DYN'), ('polissya', 63, 'POL2'), ('kryvbas', 60, 'KRY'), ('zorya', 60, 'ZOR'), ('oleksandriya', 58, 'OLE'),
  ('fcsb', 66, 'FCSB'), ('cfr cluj', 64, 'CFR'), ('universitatea craiova', 64, 'UCV'), ('rapid', 63, 'RAP'), ('dinamo bucuresti', 61, 'DIN2'), ('farul', 61, 'FAR'),
  ('ferencvaros', 69, 'FTC'), ('puskas', 61, 'PAFC'), ('paksi', 60, 'PAK'), ('gyor', 60, 'ETO'), ('debreceni', 58, 'DVSC'), ('ujpest', 57, 'UTE'),
  ('apoel', 63, 'APO'), ('pafos', 65, 'PAF'), ('omonia', 63, 'OMO'), ('aek larnaca', 62, 'AEK2'), ('aris limassol', 60, 'ARI'), ('apollon', 60, 'APL'),
  ('maccabi tel aviv', 66, 'MTA'), ('maccabi haifa', 64, 'MHA'), ('hapoel be', 64, 'HBS'), ('beitar', 63, 'BEI'), ('hapoel tel aviv', 60, 'HTA'),
]
DEFAULT_REP = {'POR1': 57, 'NED1': 58, 'BEL1': 57, 'TUR1': 59, 'CZE1': 55, 'GRE1': 55, 'NOR1': 55, 'POL1': 56, 'DEN1': 56, 'AUT1': 55,
               'SUI1': 56, 'SCO1': 54, 'SWE1': 55, 'CRO1': 54, 'SRB1': 53,
               'BRA1': 64, 'KSA1': 58, 'MEX1': 62, 'JPN1': 61, 'RUS1': 60, 'UKR1': 56, 'ROU1': 56, 'HUN1': 54, 'CYP1': 54, 'ISR1': 55}
PREFIX = {'fc', 'sc', 'sk', 'fk', 'ac', 'kv', 'k', 'r', 'rsc', 'sl', 'cd', 'cf', 'gd', 'ud', 'kaa', 'krc', 'kvc', 'rc', 'sv', 'afc', 'f', 'c', 's', 'a',
          'royal', 'royale', 'club', 'cs', 'pec', 'ado', 'sfk', '1', 'raal', 'fsv', 'ksv', 'vv', 'sint', 'oud'}

def ascii_low(s):
    s = s.translate(str.maketrans({'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'ı': 'i'}))
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()

def rep_short(c, league):
    n = ascii_low(c['name'] + ' ' + c['id'].replace('-', ' '))
    for key, rep, short in REP_KEY:
        if re.search(r'\b' + re.escape(key), n):   # début de mot : « az » ne capte pas « Gaziantep »
            return rep, short
    return DEFAULT_REP.get(league, 58), None

def auto_short(name, used):
    words = [w for w in re.split(r'[\W_]+', name) if w]
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
# ---------- Niveau des joueurs (déterministe : le même joueur a la même note à chaque partie) ----------
# Force des sélections (0 à 1) : 60 sélections avec la France ne valent pas 60 avec Malte.
NATION_STR = {
  'FRA': 1, 'ESP': 1, 'ENG': 1, 'ARG': 1, 'BRA': .95, 'POR': .95, 'NED': .9, 'BEL': .85, 'GER': .9, 'ITA': .88, 'CRO': .85,
  'URU': .78, 'COL': .75, 'MAR': .78, 'USA': .62, 'MEX': .65, 'JPN': .7, 'SUI': .72, 'DEN': .74, 'SEN': .7, 'NOR': .68,
  'AUT': .7, 'TUR': .68, 'UKR': .62, 'SRB': .64, 'POL': .62, 'SWE': .62, 'KOR': .62, 'ECU': .62, 'CZE': .58, 'SCO': .55,
  'HUN': .55, 'WAL': .55, 'NGA': .6, 'CIV': .62, 'EGY': .55, 'ALG': .58, 'GHA': .52, 'CMR': .55, 'IRN': .5, 'AUS': .5,
  'CAN': .55, 'CHI': .5, 'PER': .45, 'PAR': .5, 'VEN': .45, 'GRE': .52, 'RUS': .55, 'SVK': .5, 'SVN': .5, 'ROU': .5,
  'IRL': .48, 'NIR': .4, 'ISL': .42, 'FIN': .42, 'GEO': .52, 'TUN': .5, 'MLI': .52, 'BIH': .45, 'ALB': .45, 'MKD': .4,
  'MNE': .4, 'ISR': .4, 'KSA': .42, 'QAT': .4, 'CRC': .42, 'PAN': .42, 'JAM': .4, 'BUL': .38, 'CYP': .3, 'KOS': .42,
  'BFA': .48, 'COD': .5, 'GUI': .45, 'GAB': .42, 'ZAM': .38, 'RSA': .42, 'UZB': .45, 'CPV': .45, 'ANG': .38, 'BEN': .35,
}
def norm_club(n):
    n = ascii_low(n)
    n = re.sub(r'\(.*?\)', ' ', n)
    words = [w for w in re.split(r'[\W_]+', n) if w and w not in PREFIX and w not in ('futbol', 'football', 'calcio', 'de', 'and', 'the')]
    return ' '.join(words)
def lead_bonus(n):
    if n <= 0: return -1.5
    import math
    return max(-1.5, min(4.5, (math.log10(n) - 2.3) * 3.2))   # 200 car. → 0, 1000 → 2,2, 3000 → 3,7

def player_score(p, rep_club, rep_of):
    caps = ((p.get('international') or {}).get('caps')) or 0
    nat = (p.get('nationality') or {}).get('code') or ''
    strn = NATION_STR.get(nat, .3)
    intl = (min(caps, 90) / 90) ** .6 * (1.5 + 6.5 * strn) - (1.2 if caps == 0 else 0)
    senior = 0; best = 0; goals = 0
    for c in p.get('career') or []:
        a = c.get('apps') or 0
        g = c.get('goals') or 0
        name = c.get('club') or ''
        if re.search(r'\b(U-?\d\d|II|B|reserves?|youth|academy|Jong|Castilla|Primavera)\b', name, re.I):
            continue
        senior += a; goals += g
        if a >= 12:
            r = rep_of.get(norm_club(name))
            if r: best = max(best, r)
    age = p.get('age') or 26
    age_k = -7 if age <= 17 else -5 if age <= 19 else -3 if age <= 21 else -1 if age <= 23 else 0 if age <= 30 else -1 if age <= 32 else -2.5 if age <= 34 else -4
    exp = min(2.5, senior / 160) - (2.5 if senior < 15 else 0)
    pedigree = max(0, best - rep_club) * .16
    gp = (p.get('position') or {}).get('game')
    scorer = 0
    if gp in ('BU', 'AG', 'AD', 'MO') and senior >= 40:
        scorer = max(-1, min(3.5, (goals / senior - .25) * 9 if gp == 'BU' else (goals / senior - .15) * 9))
    return intl + exp + pedigree + age_k + scorer + lead_bonus(p.get('leadLen') or 0)

def stable_noise(key):
    import hashlib
    return (int(hashlib.md5(key.encode()).hexdigest()[:6], 16) / 0xFFFFFF - .5) * 2.0   # ±1

rep_of = {}
for c in clubs:
    src = next(x for x in d['clubs'] if x['id'] == c['id'])
    for n in (src.get('name'), src.get('fullName'), src.get('shortName'), c['name']):
        if n: rep_of.setdefault(norm_club(n), c['rep'])
club_rep = {c['id']: c['rep'] for c in clubs}
levels = {}
by_club = {}
for p in d['players']:
    if p['club'] not in club_rep: continue
    by_club.setdefault(p['club'], []).append(p)
for cid, ps in by_club.items():
    rep = club_rep[cid]
    target = 31 + rep * .54                          # moyenne visée des 14 meilleurs (rep 94 → 81,8 ; 70 → 68,8 ; 55 → 60,7)
    raw = {p['id']: player_score(p, rep, rep_of) + stable_noise(p['name'] + cid) for p in ps}
    top = sorted(raw.values(), reverse=True)[:14]
    mean = sum(top) / len(top)
    for p in ps:
        levels[p['id']] = max(40, min(93, round(target + (raw[p['id']] - mean) * 1.1)))

players = []
for p in d['players']:
    first, last = split(p['name'])
    intl = p.get('international') or {}
    players.append({'club': p['club'], 'f': first, 'l': last, 'pos': p['position']['game'], 'age': p.get('age') or 0,
                    'nat': (p.get('nationality') or {}).get('name') or '', 'num': p.get('number') or 0,
                    'caps': intl.get('caps') or 0, 'ig': intl.get('goals') or 0, 'apps': (p.get('clubStats') or {}).get('apps') or 0,
                    'ph': (p.get('photo') or {}).get('file'), 'lv': levels.get(p['id'])})
coaches = [{'club': c['club'], 'name': re.sub(r'\s*\([^)]*\)', '', c['name'] or '').strip() or None, 'nat': (c.get('nationality') or [''])[0], 'age': c.get('age') or 50} for c in d['coaches']]
out = {'format': 'coach-de-poche-monde-reel-v1', 'season': d['meta']['season'], 'sources': d['meta']['sources'],
       'leagues': [{'id': lg['id'], 'name': lg['name'], 'country': lg['country']} for lg in d['leagues']],
       'clubs': clubs, 'players': players, 'coaches': coaches}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{OUT} : {len(clubs)} clubs, {len(players)} joueurs, {len(coaches)} entraîneurs, {os.path.getsize(OUT) // 1024} Ko")
