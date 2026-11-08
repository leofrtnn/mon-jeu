"""Mini-analyseur de wikitexte : modèles {{...}}, infobox, nettoyage des valeurs."""
import re

def _match_close(text, i):
    """Indice juste après la fermeture du modèle qui commence en i ('{{')."""
    depth = 0
    n = len(text)
    while i < n:
        if text.startswith('{{', i):
            depth += 1; i += 2
        elif text.startswith('}}', i):
            depth -= 1; i += 2
            if depth == 0:
                return i
        else:
            i += 1
    return n

def split_params(body):
    """Découpe 'nom|a=1|b=[[x|y]]' sur les | de niveau 0."""
    parts, cur, d_t, d_l, i = [], '', 0, 0, 0
    while i < len(body):
        two = body[i:i + 2]
        if two == '{{': d_t += 1; cur += two; i += 2; continue
        if two == '}}': d_t -= 1; cur += two; i += 2; continue
        if two == '[[': d_l += 1; cur += two; i += 2; continue
        if two == ']]': d_l -= 1; cur += two; i += 2; continue
        c = body[i]
        if c == '|' and d_t == 0 and d_l == 0:
            parts.append(cur); cur = ''
        else:
            cur += c
        i += 1
    parts.append(cur)
    name = parts[0].strip()
    named, pos = {}, []
    for p in parts[1:]:
        m = re.match(r'\s*([^=\[\]{}|]+?)\s*=(.*)$', p, re.S)
        if m:
            named[m.group(1).strip().lower()] = m.group(2).strip()
        else:
            pos.append(p.strip())
    return name, named, pos

def templates(text, pattern):
    """Tous les modèles dont le nom correspond à `pattern` (regex, insensible à la casse)."""
    out = []
    rx = re.compile(r'\{\{\s*(' + pattern + r')\s*[|}\n]', re.I)
    for m in rx.finditer(text):
        end = _match_close(text, m.start())
        name, named, pos = split_params(text[m.start() + 2:end - 2])
        out.append({'name': name, 'params': named, 'pos': pos, 'start': m.start(), 'end': end})
    return out

MONTHS = {}

def _date_from(parts):
    nums = [p for p in parts if re.fullmatch(r'\d{1,4}', p.strip())]
    if len(nums) >= 3:
        y, mo, d = int(nums[0]), int(nums[1]), int(nums[2])
        return f'{y:04d}-{mo:02d}-{d:02d}'
    if nums:
        return nums[0]
    return ''

def _inner_template(t):
    name, named, pos = split_params(t)
    n = name.lower().strip()
    if n.startswith(('birth date', 'start date', 'bda', 'birth-date', 'dob')):
        return _date_from(pos)
    if n in ('convert', 'cvt'):
        return ' '.join(pos[:2])
    if n == 'height':
        if 'm' in named: return named['m'] + ' m'
        if 'cm' in named: return named['cm'] + ' cm'
        return ''
    if n in ('ubl', 'unbulleted list', 'plainlist', 'flatlist', 'hlist', 'ublist'):
        return ', '.join(pos)
    if n in ('nowrap', 'nobr', 'small', 'lang', 'nobold', 'abbr', 'sortname'):
        return ' '.join(pos[-1:]) if n != 'sortname' else ' '.join(pos[:2])
    if n.startswith(('url',)):
        return pos[0] if pos else ''
    if n in ('flagicon', 'flag', 'fb', 'efn', 'refn', 'sfn', 'citation needed', 'cn', 'updated', 'as of', 'small caps', 'nbsp', 'clarify', 'when', 'dubious'):
        return ''
    if n.startswith(('cite', 'french football updater', 'english football updater', 'coord', 'football updater')):
        return ''
    return ' '.join(pos[:1])

def clean(v):
    """Valeur d'infobox -> texte lisible."""
    if not v:
        return ''
    v = re.sub(r'<!--.*?-->', '', v, flags=re.S)
    v = re.sub(r'<ref[^>/]*/>', '', v)
    v = re.sub(r'<ref[^>]*>.*?</ref>', '', v, flags=re.S)
    v = re.sub(r'<br\s*/?>', ', ', v)
    v = re.sub(r'<[^>]+>', '', v)
    # Modèles imbriqués : du plus intérieur vers l'extérieur.
    for _ in range(6):
        nv = re.sub(r'\{\{([^{}]*)\}\}', lambda m: _inner_template(m.group(1)), v)
        if nv == v:
            break
        v = nv
    v = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', v)
    v = re.sub(r'\[https?://\S+\s*([^\]]*)\]', r'\1', v)
    v = v.replace("'''", '').replace("''", '').replace('&nbsp;', ' ')
    v = re.sub(r'\s+', ' ', v).strip(' ,;')
    return v

def link_target(v):
    """Cible du premier lien [[cible|texte]]."""
    m = re.search(r'\[\[([^\]|#]+)', v or '')
    return m.group(1).strip() if m else None
