"""
Complète les effectifs incomplets avec de VRAIS joueurs, trouvés sur Wikidata :
joueurs dont la carrière (P54 « membre de l'équipe ») mentionne le club sans date de fin
(ou avec une fin future), nés après 1984. Ajoutés à data/real-world.json (postprocess),
sans jamais inventer de joueur. Les clubs qui restent incomplets devront recruter.

Usage : SSL_CERT_FILE=/root/.ccr/ca-bundle.crt python3 wikidata_fill.py
"""
import json, os, sys, time, urllib.parse, urllib.request, collections, hashlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, '..', '..', 'data', 'foot5', 'foot5.json')
OUT = os.path.join(ROOT, '..', '..', 'data', 'real-world.json')
CACHE = os.path.join(ROOT, '.cache', 'wikidata')
os.makedirs(CACHE, exist_ok=True)
UA = 'CoachDePoche/1.0 (jeu de football ; script de données)'

POS = {  # postes Wikidata → postes du jeu
    'Q201330': 'GB', 'Q336286': 'DC', 'Q1047981': 'DC', 'Q2135049': 'DD', 'Q1406617': 'DG', 'Q4144436': 'DD', 'Q6461131': 'DG',
    'Q193592': 'MC', 'Q1574062': 'MDC', 'Q16239427': 'MDC', 'Q1061325': 'MO', 'Q21010451': 'MG', 'Q4127497': 'MD', 'Q192837': 'AG',
    'Q280658': 'BU', 'Q628099': 'BU', 'Q1316283': 'BU', 'Q2620099': 'AD', 'Q10862201': 'AG', 'Q4344572': 'MC',
}


def sparql(q):
    key = hashlib.md5(q.encode()).hexdigest()
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        return json.load(open(path))
    if os.environ.get('CACHE_ONLY'):   # service saturé : on se contente de ce qui est déjà en cache
        return {'results': {'bindings': []}}
    url = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
            data = json.load(urllib.request.urlopen(req, timeout=60))
            json.dump(data, open(path, 'w'))
            time.sleep(0.6)
            return data
        except Exception as e:
            print('  retry', e, file=sys.stderr)
            time.sleep(5 + attempt * 5)
    return {'results': {'bindings': []}}


def squad(qid):
    q = f"""
SELECT ?p ?pLabel ?first ?last ?birth ?posq ?natLabel ?img ?start ?num WHERE {{
  ?p p:P54 ?st . ?st ps:P54 wd:{qid} .
  OPTIONAL {{ ?st pq:P580 ?start }} OPTIONAL {{ ?st pq:P582 ?end }} OPTIONAL {{ ?st pq:P1618 ?num }}
  FILTER(!BOUND(?end) || ?end > NOW())
  ?p wdt:P31 wd:Q5 ; wdt:P569 ?birth .
  FILTER(YEAR(?birth) >= 1985)
  FILTER NOT EXISTS {{ ?p wdt:P570 ?death }}
  OPTIONAL {{ ?p wdt:P413 ?posq }}
  OPTIONAL {{ ?p wdt:P1532 ?nat }} OPTIONAL {{ ?p wdt:P27 ?nat2 }}
  BIND(COALESCE(?nat, ?nat2) AS ?natx)
  OPTIONAL {{ ?natx rdfs:label ?natLabel FILTER(LANG(?natLabel) = "fr") }}
  OPTIONAL {{ ?p wdt:P735 ?fn . ?fn rdfs:label ?first FILTER(LANG(?first) IN ("en","fr","es","pt")) }}
  OPTIONAL {{ ?p wdt:P734 ?ln . ?ln rdfs:label ?last FILTER(LANG(?last) IN ("en","fr","es","pt")) }}
  OPTIONAL {{ ?p wdt:P18 ?img }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en,es,pt,ar". }}
}} LIMIT 400"""
    rows = sparql(q)['results']['bindings']
    by = collections.OrderedDict()
    for r in rows:
        pid = r['p']['value'].rsplit('/', 1)[-1]
        x = by.setdefault(pid, {'qid': pid, 'name': r.get('pLabel', {}).get('value', ''), 'pos': set(), 'nat': None, 'img': None, 'birth': r['birth']['value'][:10], 'num': None, 'start': None, 'first': None, 'last': None})
        if 'posq' in r:
            code = POS.get(r['posq']['value'].rsplit('/', 1)[-1])
            if code: x['pos'].add(code)
        if 'natLabel' in r and not x['nat']: x['nat'] = r['natLabel']['value']
        if 'img' in r and not x['img']: x['img'] = urllib.parse.unquote(r['img']['value'].rsplit('/', 1)[-1]).replace('_', ' ')
        if 'num' in r and not x['num']:
            try: x['num'] = int(float(r['num']['value']))
            except ValueError: pass
        if 'start' in r: x['start'] = max(x['start'] or '', r['start']['value'][:10])
        if 'first' in r and not x['first']: x['first'] = r['first']['value']
        if 'last' in r and not x['last']: x['last'] = r['last']['value']
    out = []
    for x in by.values():
        # Un joueur passé par le club il y a longtemps (début avant 2018, sans fin) : donnée douteuse.
        if x['start'] and x['start'] < '2019-01-01': continue
        if not x['pos'] or x['name'].startswith('Q'): continue
        out.append(x)
    return out


PREF = ['GB', 'MDC', 'MO', 'DD', 'DG', 'AD', 'AG', 'DC', 'MC', 'BU', 'MG', 'MD']


def main():
    src = json.load(open(SRC))
    world = json.load(open(OUT))
    wd_of = {c['id']: c.get('wikidata') for c in src['clubs']}
    count = collections.Counter(p['club'] for p in world['players'])
    known = {(p['f'] + ' ' + p['l']).lower() for p in world['players']}
    added_total, report = 0, []
    for club in world['clubs']:
        cid = club['id']
        if count[cid] >= 22 and sum(1 for p in world['players'] if p['club'] == cid and p['pos'] == 'GB') >= 2:
            continue
        qid = wd_of.get(cid)
        if not qid:
            report.append((club['name'], count[cid], 0, 'pas de Wikidata')); continue
        cands = squad(qid)
        today = 2026.5
        add = 0
        for x in cands:
            if count[cid] >= 28: break
            full = (x['first'] or '') + ' ' + (x['last'] or '')
            name = x['name']
            if name.lower() in known or full.strip().lower() in known: continue
            parts = name.split(' ')
            first, last = (' '.join(parts[:-1]), parts[-1]) if len(parts) > 1 else ('', name)
            if x['last'] and x['last'] in name: last = x['last']; first = name.replace(last, '').strip()
            pos = sorted(x['pos'], key=lambda c: PREF.index(c) if c in PREF else 99)[0]
            age = int(today - (int(x['birth'][:4]) + (int(x['birth'][5:7]) - 1) / 12))
            if age < 16 or age > 40: continue
            world['players'].append({'club': cid, 'f': first, 'l': last, 'pos': pos, 'p2': [c for c in x['pos'] if c != pos][:2], 'age': age,
                                     'nat': x['nat'] or '', 'num': x['num'] or 0, 'caps': 0, 'ig': 0, 'apps': 0, 'ph': x['img'], 'src': 'wikidata'})
            known.add(name.lower()); count[cid] += 1; add += 1
        added_total += add
        report.append((club['name'], count[cid] - add, add, ''))
        print(f"{club['name']:35s} {count[cid] - add:3d} + {add:2d} (Wikidata)", flush=True)
    json.dump(world, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
    still = [(c['name'], count[c['id']]) for c in world['clubs'] if count[c['id']] < 18]
    print(f'OK : {added_total} vrais joueurs ajoutés ; encore incomplets (<18) : {len(still)}', still[:20])


if __name__ == '__main__':
    main()
