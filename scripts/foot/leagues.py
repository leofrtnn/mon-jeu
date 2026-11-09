"""Clubs actuels des 20 premiers championnats européens (modèles de navigation Wikipédia)."""
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
]
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
