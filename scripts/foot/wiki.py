"""Accès Wikipédia / Wikidata avec cache disque (collecte respectueuse : requêtes groupées, pause)."""
import json, os, time, hashlib, urllib.request, urllib.parse, urllib.error

CACHE = os.environ.get('FOOT_CACHE', os.path.join(os.path.dirname(__file__), '.cache'))
os.makedirs(CACHE, exist_ok=True)
UA = 'CoachDePocheData/1.0 (projet personnel; https://github.com/leofrtnn/mon-jeu)'

def get(url, params):
    q = urllib.parse.urlencode(params)
    key = hashlib.sha1((url + '?' + q).encode()).hexdigest()
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    for attempt in range(8):
        try:
            req = urllib.request.Request(url + '?' + q, headers={'User-Agent': UA, 'Accept': 'application/json', 'Api-User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if attempt == 7 or e.code not in (429, 500, 502, 503, 504):
                raise
            wait = int(e.headers.get('Retry-After') or 0) or min(60, 5 * 2 ** attempt)
            print(f'  {e.code}, pause {wait}s', flush=True)
            time.sleep(wait)
        except Exception:
            if attempt == 7:
                raise
            time.sleep(5)
    with open(path, 'w') as f:
        json.dump(data, f)
    time.sleep(1.0)
    return data

def wikitexts(titles):
    """Wikitexte de pages (50 max par requête), suit les redirections. Retourne {titre_demandé: (titre_final, texte)}."""
    out = {}
    titles = list(titles)
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = get('https://en.wikipedia.org/w/api.php', {
            'action': 'query', 'prop': 'revisions|pageprops', 'rvprop': 'content', 'rvslots': 'main',
            'redirects': 1, 'format': 'json', 'formatversion': 2, 'titles': '|'.join(chunk), 'ppprop': 'wikibase_item'})
        q = d.get('query', {})
        alias = {}
        for n in q.get('normalized', []): alias[n['to']] = n['from']
        for r in q.get('redirects', []): alias[r['to']] = alias.get(r['from'], r['from'])
        for p in q.get('pages', []):
            if p.get('missing') or 'revisions' not in p:
                continue
            src = p['title']
            while src in alias: src = alias[src]
            out[src] = (p['title'], p['revisions'][0]['slots']['main']['content'], p.get('pageprops', {}).get('wikibase_item'))
    return out

def entities(qids):
    out = {}
    qids = [q for q in qids if q]
    for i in range(0, len(qids), 50):
        d = get('https://www.wikidata.org/w/api.php', {'action': 'wbgetentities', 'ids': '|'.join(qids[i:i + 50]),
            'props': 'claims|labels|sitelinks', 'languages': 'fr|en', 'sitefilter': 'frwiki|enwiki', 'format': 'json'})
        out.update(d.get('entities', {}))
    return out
