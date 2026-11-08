"""
Construit data/foot5/foot5.json : clubs et joueurs des 5 grands championnats (saison en cours).

Sources : Wikipédia en anglais (modèles de navigation des ligues, pages des clubs,
infobox des joueurs). Les logos et photos ne sont PAS copiés : le fichier contient
des liens vers les images hébergées par Wikipédia / Wikimedia Commons.

Usage :
  SSL_CERT_FILE=... python3 scripts/foot/build.py
Le cache (scripts/foot/.cache) rend les relances instantanées ; supprimez-le pour rafraîchir.
"""
import json, os, re, sys, datetime, urllib.parse
import wiki, leagues
from wikiparse import templates, clean, link_target
from nations import NATIONS

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'foot5', 'foot5.json')
TODAY = datetime.date.today()

def file_url(name, host='en.wikipedia.org'):
    if not name:
        return None
    name = re.sub(r'^(File|Image|Fichier):', '', name.strip(), flags=re.I).strip()
    if not re.search(r'\.(svg|png|jpe?g|gif|webp|tiff?)$', name, re.I):
        return None
    return f'https://{host}/wiki/Special:FilePath/' + urllib.parse.quote(name.replace(' ', '_'))

def wiki_url(title):
    return 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))

def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower().encode('ascii', 'ignore').decode()).strip('-')
    return s or 'x'

def first_infobox(text, kind):
    t = templates(text, r'Infobox ' + kind)
    return t[0]['params'] if t else {}

def to_int(v):
    m = re.search(r'\d[\d,\. ]*', v or '')
    return int(re.sub(r'\D', '', m.group(0))) if m else None

def hexcol(v):
    v = (v or '').strip().lstrip('#')
    return '#' + v.upper() if re.fullmatch(r'[0-9A-Fa-f]{6}', v) else None

# ---------- Postes ----------
def game_position(fs, detail):
    d = (detail or '').lower()
    rules = [
        ('goalkeeper', 'GB'), ('centre-back', 'DC'), ('center-back', 'DC'), ('centre back', 'DC'), ('center back', 'DC'), ('sweeper', 'DC'),
        ('left wing-back', 'DG'), ('left-back', 'DG'), ('left back', 'DG'), ('right wing-back', 'DD'), ('right-back', 'DD'), ('right back', 'DD'),
        ('full-back', 'DD'), ('wing-back', 'DD'),
        ('defensive midfielder', 'MDC'), ('holding midfielder', 'MDC'), ('attacking midfielder', 'MO'), ('playmaker', 'MO'),
        ('central midfielder', 'MC'), ('midfielder', 'MC'),
        ('left winger', 'AG'), ('left wing', 'AG'), ('right winger', 'AD'), ('right wing', 'AD'), ('winger', 'AG'),
        ('striker', 'BU'), ('centre-forward', 'BU'), ('center-forward', 'BU'), ('centre forward', 'BU'), ('forward', 'BU'),
        ('defender', 'DC'),
    ]
    for k, v in rules:
        if k in d:
            return v
    return {'GK': 'GB', 'DF': 'DC', 'MF': 'MC', 'FW': 'BU'}.get((fs or '').upper(), 'MC')

POS_FR = {'GB': 'Gardien', 'DC': 'Défenseur central', 'DG': 'Latéral gauche', 'DD': 'Latéral droit', 'MDC': 'Milieu défensif',
          'MC': 'Milieu central', 'MO': 'Milieu offensif', 'AG': 'Ailier gauche', 'AD': 'Ailier droit', 'BU': 'Attaquant'}

# ---------- Clubs ----------
SKIP = re.compile(r'former|notable|record|of the (year|season)|women|reserve|youth|academy|loan|under-|u-?\d\d|\bb team|retired|captain|international|world cup|staff|manager', re.I)

def squad_section(text):
    """Premier bloc {{Fs start}}…{{Fs end}} de la section effectif (équipe première, hors prêts)."""
    heads = [(m.start(), m.end(), len(m.group(1)), m.group(2).strip()) for m in re.finditer(r'\n(={2,4})([^=\n]+)\1', text)]
    for i, (hs, he, lvl, title) in enumerate(heads):
        if not re.search(r'squad|players', title, re.I) or SKIP.search(title):
            continue
        stop = next((h[0] for h in heads[i + 1:] if h[2] <= lvl), len(text))
        sec = text[he:stop]
        m = re.search(r'\{\{\s*(Fs start|Football squad start)', sec, re.I)
        if m:
            e = re.search(r'\{\{\s*(Fs end|Football squad end)', sec[m.end():], re.I)
            block = sec[m.start(): m.end() + (e.start() if e else len(sec))]
        else:
            block = sec
        if re.search(r'Fs player|Football squad player', block, re.I):
            return block
    return ''

def parse_squad(text):
    sec = squad_section(text)
    rows = []
    for t in templates(sec, r'Fs player|Football squad player|Fs2 player'):
        p = t['params']
        raw = p.get('name', '')
        target = link_target(raw)
        name = clean(raw)
        if not name:
            continue
        rows.append({'no': clean(p.get('no', '')), 'nat': clean(p.get('nat', '')).upper(), 'pos': clean(p.get('pos', '')).upper(),
                     'name': name, 'title': target, 'other': clean(p.get('other', ''))})
    return rows

def build():
    data_leagues = leagues.all_leagues()
    club_titles = [c for lg in data_leagues for c in lg['clubs']]
    print(f'{len(club_titles)} clubs', flush=True)
    pages = {}
    for i in range(0, len(club_titles), 5):  # pages longues : petits lots
        pages.update(wiki.wikitexts(club_titles[i:i + 5]))
    clubs, squads = [], {}
    for lg in data_leagues:
        for title in lg['clubs']:
            if title not in pages:
                print('  page manquante', title); continue
            final, text, qid = pages[title]
            ib = first_infobox(text, 'football club')
            cid = slug(clean(ib.get('clubname', '')) or final)
            logo_file = clean(ib.get('image', '')) or None
            colors = [c for c in (hexcol(ib.get('body1')), hexcol(ib.get('shorts1')), hexcol(ib.get('socks1'))) if c]
            away = [c for c in (hexcol(ib.get('body2')), hexcol(ib.get('shorts2')), hexcol(ib.get('socks2'))) if c]
            founded = clean(ib.get('founded', ''))
            club = {
                'id': cid, 'name': clean(ib.get('clubname', '')) or final, 'fullName': clean(ib.get('fullname', '')) or None,
                'shortName': (clean(ib.get('short name', '')) or None),
                'league': lg['id'], 'country': lg['country'],
                'nickname': clean(ib.get('nickname', '')) or None,
                'founded': (re.search(r'\d{4}', founded).group(0) if re.search(r'\d{4}', founded) else None),
                'stadium': clean(ib.get('ground', '') or ib.get('stadium', '')) or None,
                'capacity': to_int(clean(ib.get('capacity', ''))),
                'manager': clean(ib.get('manager', '')) or None,
                'chairman': clean(ib.get('chairman', '')) or None,
                'owner': clean(ib.get('owner', '')) or None,
                'website': clean(ib.get('website', '')) or None,
                'colors': {'home': colors, 'away': away},
                'logo': {'file': logo_file, 'url': file_url(logo_file)},
                'wikipedia': wiki_url(final), 'wikidata': qid,
            }
            clubs.append(club)
            squads[cid] = parse_squad(text)
            print(f'  {lg["id"]} {club["name"]}: {len(squads[cid])} joueurs', flush=True)
    for lg in data_leagues:
        lg['clubIds'] = [c['id'] for c in clubs if c['league'] == lg['id']]

    # ---------- Joueurs ----------
    titles = sorted({r['title'] for rows in squads.values() for r in rows if r['title']})
    print(f'{len(titles)} pages de joueurs', flush=True)
    ptexts = {}
    for i in range(0, len(titles), 50):
        d = wiki.get('https://en.wikipedia.org/w/api.php', {
            'action': 'query', 'prop': 'revisions|pageprops', 'rvprop': 'content', 'rvslots': 'main', 'rvsection': 0,
            'redirects': 1, 'format': 'json', 'formatversion': 2, 'ppprop': 'wikibase_item', 'titles': '|'.join(titles[i:i + 50])})
        q = d.get('query', {})
        alias = {}
        for n in q.get('normalized', []): alias[n['to']] = n['from']
        for r in q.get('redirects', []): alias[r['to']] = alias.get(r['from'], r['from'])
        for p in q.get('pages', []):
            if 'revisions' not in p:
                continue
            src = p['title']
            while src in alias: src = alias[src]
            ptexts[src] = (p['title'], p['revisions'][0]['slots']['main']['content'], p.get('pageprops', {}).get('wikibase_item'))
        print(f'  {min(i + 50, len(titles))}/{len(titles)}', flush=True)

    players, seen = [], set()
    for club in clubs:
        for r in squads[club['id']]:
            final, text, qid = ptexts.get(r['title'], (None, '', None)) if r['title'] else (None, '', None)
            ib = first_infobox(text, 'football biography') if text else {}
            bd = clean(ib.get('birth_date', ''))
            age = None
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', bd):
                y, m, dd = map(int, bd.split('-'))
                age = TODAY.year - y - ((TODAY.month, TODAY.day) < (m, dd))
            h = clean(ib.get('height', ''))
            hm = re.search(r'(\d\.\d{2})\s*m', h) or re.search(r'(\d{3})\s*cm', h)
            height = (round(float(hm.group(1)) * 100) if '.' in hm.group(1) else int(hm.group(1))) if hm else None
            detail = clean(ib.get('position', ''))
            gp = game_position(r['pos'], detail)
            # Carrière en club.
            career = []
            for k in range(1, 40):
                cl = ib.get(f'clubs{k}')
                if cl is None:
                    continue
                career.append({'years': clean(ib.get(f'years{k}', '')), 'club': clean(cl).replace('→', '').strip(),
                               'loan': '→' in cl, 'apps': to_int(clean(ib.get(f'caps{k}', ''))), 'goals': to_int(clean(ib.get(f'goals{k}', '')))})
            current = next((c for c in reversed(career) if re.search(r'[–-]\s*$', c['years'] or '')), career[-1] if career else None)
            # Sélection A (on écarte les équipes de jeunes).
            nat_team = None
            for k in range(1, 30):
                t = ib.get(f'national_team{k}') or ib.get(f'nationalteam{k}')
                if not t:
                    continue
                name = clean(t)
                if re.search(r'\bU-?\d{2}\b|under-|olympic|\bB\b', name, re.I):
                    continue
                nat_team = {'team': name, 'years': clean(ib.get(f'national_years{k}', '') or ib.get(f'nationalyears{k}', '')),
                            'caps': to_int(clean(ib.get(f'national_caps{k}', '') or ib.get(f'nationalcaps{k}', ''))),
                            'goals': to_int(clean(ib.get(f'national_goals{k}', '') or ib.get(f'nationalgoals{k}', '')))}
            img = clean(ib.get('image', ''))
            pid = qid or 'p-' + slug(r['name'] + '-' + club['id'])
            if pid in seen:
                continue
            seen.add(pid)
            players.append({
                'id': pid, 'name': r['name'], 'fullName': clean(ib.get('full_name', '') or ib.get('fullname', '')) or None,
                'club': club['id'], 'number': to_int(r['no']), 'role': r['other'] or None,
                'position': {'code': r['pos'] or None, 'detail': detail or None, 'game': gp, 'fr': POS_FR[gp]},
                'nationality': {'code': r['nat'] or None, 'name': NATIONS.get(r['nat'], r['nat'] or None)},
                'birthDate': bd if re.fullmatch(r'\d{4}-\d{2}-\d{2}', bd) else None, 'age': age,
                'birthPlace': clean(ib.get('birth_place', '')) or None,
                'heightCm': height,
                'photo': {'file': img or None, 'url': file_url(img)},
                'clubStats': {'apps': current['apps'], 'goals': current['goals'], 'since': current['years']} if current else None,
                'international': nat_team,
                'career': career,
                'wikipedia': wiki_url(final) if final else None, 'wikidata': qid,
            })
    out = {
        'meta': {
            'title': 'Big 5 — clubs et joueurs', 'season': '2026–27', 'generated': TODAY.isoformat(),
            'counts': {'leagues': len(data_leagues), 'clubs': len(clubs), 'players': len(players)},
            'sources': 'Wikipédia en anglais (texte sous licence CC BY-SA 4.0), Wikidata (CC0). Données extraites automatiquement : peuvent contenir des erreurs.',
            'images': "Logos et photos non inclus : les champs 'url' pointent vers les fichiers hébergés par Wikipédia/Wikimedia Commons, chacun soumis à ses propres droits (les logos sont des marques déposées).",
            'positions': POS_FR,
        },
        'leagues': [{'id': lg['id'], 'name': lg['name'], 'country': lg['country'], 'clubs': lg['clubIds']} for lg in data_leagues],
        'clubs': clubs,
        'players': players,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'OK -> {OUT} ({len(clubs)} clubs, {len(players)} joueurs)')

if __name__ == '__main__':
    build()
