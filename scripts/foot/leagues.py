"""Clubs actuels des 30 championnats championnats européens (modèles de navigation Wikipédia)."""
import re, wiki

LEAGUES = [
    {'id': 'ENG1', 'size': 20, 'name': 'Premier League', 'country': 'Angleterre', 'templates': ['Template:Premier League']},
    {'id': 'ESP1', 'size': 20, 'name': 'LaLiga', 'country': 'Espagne', 'templates': ['Template:La Liga teamlist']},
    {'id': 'ITA1', 'size': 20, 'name': 'Serie A', 'country': 'Italie', 'templates': ['Template:Serie A']},
    {'id': 'GER1', 'size': 18, 'name': 'Bundesliga', 'country': 'Allemagne', 'templates': ['Template:Bundesliga']},
    {'id': 'FRA1', 'size': 18, 'name': 'Ligue 1', 'country': 'France', 'templates': ['Template:Ligue 1']},
    # Championnats 6 à 10 (classement UEFA des pays).
    {'id': 'POR1', 'size': 18, 'name': 'Liga Portugal', 'country': 'Portugal', 'templates': ['Template:Primeira Liga']},
    {'id': 'NED1', 'size': 18, 'name': 'Eredivisie', 'country': 'Pays-Bas', 'templates': ['Template:Eredivisie']},
    {'id': 'BEL1', 'size': 18, 'name': 'Pro League', 'country': 'Belgique', 'templates': ['Template:Belgian Pro League']},
    {'id': 'TUR1', 'size': 18, 'name': 'Süper Lig', 'country': 'Turquie', 'templates': ['Template:Süper Lig']},
    {'id': 'CZE1', 'size': 16, 'name': 'Chance Liga', 'country': 'Tchéquie', 'templates': ['Template:Czech First League']},
    # Championnats 11 à 20.
    {'id': 'GRE1', 'size': 14, 'name': 'Super League', 'country': 'Grèce', 'templates': ['Template:Superleague Greece teamlist']},
    {'id': 'NOR1', 'size': 16, 'name': 'Eliteserien', 'country': 'Norvège', 'templates': ['Template:Eliteserien'], 'season': '2026'},
    {'id': 'POL1', 'size': 18, 'name': 'Ekstraklasa', 'country': 'Pologne', 'templates': ['Template:Ekstraklasa teamlist']},
    {'id': 'DEN1', 'size': 12, 'name': 'Superliga', 'country': 'Danemark', 'templates': ['Template:Danish Superliga teamlist']},
    {'id': 'AUT1', 'size': 12, 'name': 'Bundesliga (AUT)', 'country': 'Autriche', 'templates': ['Template:Austrian Bundesliga teamlist']},
    {'id': 'SUI1', 'size': 12, 'name': 'Super League (SUI)', 'country': 'Suisse', 'templates': ['Template:Swiss Super League teamlist']},
    {'id': 'SCO1', 'size': 12, 'name': 'Premiership', 'country': 'Écosse', 'templates': ['Template:Scottish Premiership']},
    {'id': 'SWE1', 'size': 16, 'name': 'Allsvenskan', 'country': 'Suède', 'templates': ['Template:Allsvenskan'], 'season': '2026'},
    {'id': 'CRO1', 'size': 10, 'name': 'HNL', 'country': 'Croatie', 'templates': ['Template:Hrvatska nogometna liga']},
    {'id': 'SRB1', 'size': 16, 'name': 'SuperLiga', 'country': 'Serbie', 'templates': ['Template:Serbian SuperLiga']},
    # Championnats 21 à 30 (Europe de l'Est, Méditerranée, et quatre grands championnats hors d'Europe).
    {'id': 'BRA1', 'size': 20, 'name': 'Brasileirão', 'country': 'Brésil', 'templates': ['Template:Campeonato Brasileiro Série A'], 'season': '2026'},
    {'id': 'KSA1', 'size': 18, 'name': 'Saudi Pro League', 'country': 'Arabie saoudite', 'templates': [], 'clubs': [
        'Abha Club', 'Al Ahli Saudi FC', 'Al-Ettifaq Club', 'Al-Faisaly FC', 'Al-Fateh SC', 'Al-Fayha FC', 'Al-Diriyah Club', 'Al-Hazem FC',
        'Al-Hilal Saudi FC', 'Al-Ittihad Club (Jeddah)', 'Al-Khaleej Club', 'Al-Kholood Club', 'Al Nassr FC', 'Al Qadsiah FC', 'Al-Riyadh SC',
        'Al Shabab Club', 'Al-Taawoun FC', 'Neom SC']},
    {'id': 'MEX1', 'size': 18, 'name': 'Liga MX', 'country': 'Mexique', 'templates': ['Template:Liga MX']},
    {'id': 'JPN1', 'size': 20, 'name': 'J1 League', 'country': 'Japon', 'templates': [], 'article': '2026–27 J1 League'},
    {'id': 'RUS1', 'size': 16, 'name': 'Premier League (RUS)', 'country': 'Russie', 'templates': ['Template:Russian Premier League']},
    {'id': 'UKR1', 'size': 16, 'name': 'Premier League (UKR)', 'country': 'Ukraine', 'templates': ['Template:Ukrainian Premier League']},
    {'id': 'ROU1', 'size': 16, 'name': 'SuperLiga (ROU)', 'country': 'Roumanie', 'templates': ['Template:Liga I teamlist']},
    {'id': 'HUN1', 'size': 12, 'name': 'NB I', 'country': 'Hongrie', 'templates': ['Template:Nemzeti Bajnokság I']},
    {'id': 'CYP1', 'size': 14, 'name': 'First Division', 'country': 'Chypre', 'templates': ['Template:Cypriot First Division']},
    # Deuxièmes divisions des 5 grands championnats (montées et descentes).
    {'id': 'ENG2', 'size': 24, 'name': 'Championship', 'country': 'Angleterre', 'templates': ['Template:EFL Championship']},
    {'id': 'ESP2', 'size': 22, 'name': 'LaLiga 2', 'country': 'Espagne', 'templates': ['Template:Segunda División']},
    {'id': 'ITA2', 'size': 20, 'name': 'Serie B', 'country': 'Italie', 'templates': ['Template:Serie B teamlist']},
    {'id': 'GER2', 'size': 18, 'name': '2. Bundesliga', 'country': 'Allemagne', 'templates': ['Template:2. Bundesliga']},
    {'id': 'FRA2', 'size': 18, 'name': 'Ligue 2', 'country': 'France', 'templates': ['Template:Ligue 2 teamlist']},
    {'id': 'ISR1', 'size': 14, 'name': 'Ligat HaAl', 'country': 'Israël', 'templates': ['Template:Ligat HaAl'], 'season': '|Clubs]]'},
    # Championnats 36 à 45 : Asie, Océanie, Golfe, Afrique du Nord, Amérique du Sud.
    {'id': 'KOR1', 'size': 12, 'name': 'K League 1', 'country': 'Corée du Sud', 'templates': [], 'article': '2026 K League 1'},
    {'id': 'CHN1', 'size': 16, 'name': 'Super League (CHN)', 'country': 'Chine', 'templates': [], 'article': '2026 Chinese Super League'},
    {'id': 'AUS1', 'size': 12, 'name': 'A-League', 'country': 'Australie', 'templates': [], 'article': '2025–26 A-League Men'},
    {'id': 'UAE1', 'size': 14, 'name': 'UAE Pro League', 'country': 'Émirats arabes unis', 'templates': ['Template:UAE Pro League'], 'season': '2025–26'},
    {'id': 'QAT1', 'size': 12, 'name': 'Stars League', 'country': 'Qatar', 'templates': [], 'article': '2025–26 Qatar Stars League'},
    {'id': 'MAR1', 'size': 16, 'name': 'Botola Pro', 'country': 'Maroc', 'templates': [], 'article': '2025–26 Botola Pro'},
    {'id': 'PER1', 'size': 18, 'name': 'Liga 1 (PER)', 'country': 'Pérou', 'templates': [], 'article': '2026 Liga 1 (Peru)'},
    {'id': 'CHI1', 'size': 16, 'name': 'Primera División (CHI)', 'country': 'Chili', 'templates': ['Template:Chilean Primera División'], 'season': '2026'},
    {'id': 'COL1', 'size': 20, 'name': 'Primera A', 'country': 'Colombie', 'templates': ['Template:Categoría Primera A'], 'season': '2026'},
    {'id': 'URU1', 'size': 16, 'name': 'Primera División (URU)', 'country': 'Uruguay', 'templates': ['Template:Uruguayan Primera División'], 'season': '2026'},
]
CLUB_BOX = re.compile(r'\{\{\s*Infobox football club', re.I)

def article_clubs(title, size):
    """Clubs cités dans la section « Teams » de l'article de la saison (pages avec une infobox de club)."""
    got = wiki.wikitexts([title])
    if title not in got:
        return []
    t = got[title][1]
    m = re.search(r'==\s*(Teams|Clubs|Stadiums and locations)', t)
    block = t[m.start():m.start() + 15000] if m else t
    links = []
    for l in LINK.findall(block):
        l = l.strip()
        if l not in links and not l.startswith(('File:', 'Image:', 'Category:')): links.append(l)
    pages = wiki.wikitexts(links[:120])
    out, seen = [], set()
    for l in links[:120]:
        if l in pages and CLUB_BOX.search(pages[l][1]) and pages[l][0] not in seen:
            seen.add(pages[l][0]); out.append(l)
    return out[:size]
LINK = re.compile(r'\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]')

def current_clubs(text, season='2026–27'):
    """Liste de liens qui suit la première mention de la saison en cours dans le navbox."""
    i = text.find(season)
    if i < 0:
        return []
    m = re.search(r'\|\s*list\d+\s*=', text[i:])
    if not m:
        return []
    start = i + m.end()
    end = re.search(r'\n\s*\|\s*(group|list|below|state)\w*\s*=', text[start:])
    block = text[start:start + (end.start() if end else 3000)]
    return [l.strip() for l in LINK.findall(block) if not l.strip().startswith(('File:', 'Image:'))]

def clubs_group(text, season='2026–27'):
    """Variante : un groupe du navbox dont l'étiquette contient la saison (« 2026–27 clubs »)."""
    for m in re.finditer(r'\|\s*group\d+\s*=[^\n]*' + re.escape(season) + r'[^\n]*\n\s*\|\s*list\d+\s*=', text):
        start = m.end()
        end = re.search(r'\n\s*\|\s*(group|list|below|state)\w*\s*=|\n\}\}', text[start:])
        block = text[start:start + (end.start() if end else 3000)]
        clubs = [l.strip() for l in LINK.findall(block) if not l.strip().startswith(('File:', 'Image:'))]
        if len(clubs) >= 10:
            return clubs
    return []

def season_links(text, season, size):
    """Dernier recours (listes d'équipes) : les liens qui suivent le lien vers l'article de la saison."""
    links = [l.strip() for l in LINK.findall(text)]
    i = next((k for k, l in enumerate(links) if l.startswith(season)), None)
    if i is None:
        return []
    out = []
    for l in links[i + 1:]:
        if l.startswith(('File:', 'Image:', 'Category:')) or re.match(r'^\d{4}', l):
            break
        out.append(l)
        if len(out) >= size:
            break
    return out

def all_leagues():
    for lg in LEAGUES:
        if lg.get('clubs'):
            continue
        if lg.get('article'):
            lg['clubs'] = article_clubs(lg['article'], lg['size'])
            continue
        got = wiki.wikitexts(lg['templates'])
        for t in lg['templates']:
            if t in got:
                season = lg.get('season', '2026–27')
                clubs = current_clubs(got[t][1], season)
                clubs = [c for c in clubs if not re.match(r'^\d{4}', c)][:lg['size']]
                if len(clubs) < lg['size'] - 2:
                    alt = [c for c in clubs_group(got[t][1], season) if not re.match(r'^\d{4}', c)][:lg['size']]
                    if len(alt) > len(clubs): clubs = alt
                if len(clubs) < lg['size'] - 2:
                    alt = season_links(got[t][1], season, lg['size'])
                    if len(alt) > len(clubs): clubs = alt
                if len(clubs) % 2: clubs = clubs[:-1]  # calendrier aller-retour : nombre pair
                if clubs:
                    lg['clubs'] = clubs
                    break
    return LEAGUES

if __name__ == '__main__':
    for lg in all_leagues():
        print(lg['id'], len(lg.get('clubs', [])), lg.get('clubs', [])[:25])
