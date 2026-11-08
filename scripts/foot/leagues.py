"""Clubs actuels des 5 grands championnats (modèles de navigation Wikipédia)."""
import re, wiki

LEAGUES = [
    {'id': 'ENG1', 'size': 20, 'name': 'Premier League', 'country': 'Angleterre', 'templates': ['Template:Premier League']},
    {'id': 'ESP1', 'size': 20, 'name': 'LaLiga', 'country': 'Espagne', 'templates': ['Template:La Liga teamlist']},
    {'id': 'ITA1', 'size': 20, 'name': 'Serie A', 'country': 'Italie', 'templates': ['Template:Serie A']},
    {'id': 'GER1', 'size': 18, 'name': 'Bundesliga', 'country': 'Allemagne', 'templates': ['Template:Bundesliga']},
    {'id': 'FRA1', 'size': 18, 'name': 'Ligue 1', 'country': 'France', 'templates': ['Template:Ligue 1']},
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

def all_leagues():
    for lg in LEAGUES:
        got = wiki.wikitexts(lg['templates'])
        for t in lg['templates']:
            if t in got:
                clubs = current_clubs(got[t][1])
                clubs = [c for c in clubs if not re.match(r'^\d{4}', c)][:lg['size']]
                if clubs:
                    lg['clubs'] = clubs
                    break
    return LEAGUES

if __name__ == '__main__':
    for lg in all_leagues():
        print(lg['id'], len(lg.get('clubs', [])), lg.get('clubs', [])[:25])
