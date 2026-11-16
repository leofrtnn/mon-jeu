"""
Captures de mouvement (base CMU, libre d'usage y compris commercial) -> cycles de foulée du jeu.

Pour chaque clip : cinématique directe du BVH, repérage d'un cycle (deux appuis du pied gauche),
puis, à 32 instants du cycle, les angles dans les conventions du squelette du jeu :
  hanche (balancier z, écart x), genou z, cheville z, épaule (z avant, x écart), coude z,
  rotation du buste (y), inclinaison du buste (z), rebond du bassin (m pour un joueur de 1,80 m).
Sortie : js/ui/mocapData.js (tables compactes, ~10 Ko).

Usage : python3 scripts/mocap/bvh2gait.py <dossier des .bvh>
"""
import sys, os, json, numpy as np

D = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'js', 'ui', 'mocapData.js')


def parse_bvh(path):
    lines = open(path).read().split('\n')
    joints, stack, i = [], [], 0
    while not lines[i].strip().startswith('MOTION'):
        t = lines[i].split()
        if t and t[0] in ('ROOT', 'JOINT'):
            joints.append({'name': t[1], 'parent': stack[-1] if stack else -1, 'chan': [], 'off': None}); cur = len(joints) - 1
        elif t and t[0] == 'End':
            joints.append({'name': joints[stack[-1]]['name'] + '_end', 'parent': stack[-1], 'chan': [], 'off': None}); cur = len(joints) - 1
        elif t and t[0] == '{': stack.append(cur)
        elif t and t[0] == '}': stack.pop()
        elif t and t[0] == 'OFFSET': joints[cur]['off'] = np.array([float(x) for x in t[1:4]])
        elif t and t[0] == 'CHANNELS': joints[cur]['chan'] = t[2:]
        i += 1
    nf = int(lines[i + 1].split()[1]); ft = float(lines[i + 2].split()[2])
    data = np.array([[float(x) for x in l.split()] for l in lines[i + 3:i + 3 + nf] if l.strip()])
    return joints, data, ft


def rotm(axis, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    return {'X': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'Y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]), 'Z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def fk(joints, frame):
    """Positions monde de toutes les articulations pour une image."""
    pos = [None] * len(joints); rot = [None] * len(joints); k = 0
    for j, J in enumerate(joints):
        R = np.eye(3); T = J['off'].copy()
        for ch in J['chan']:
            v = frame[k]; k += 1
            if ch.endswith('position'): T[{'X': 0, 'Y': 1, 'Z': 2}[ch[0]]] = v if J['parent'] < 0 else T[{'X': 0, 'Y': 1, 'Z': 2}[ch[0]]]
            else: R = R @ rotm(ch[0], v)
        if J['parent'] < 0:
            rot[j] = R; pos[j] = T
        else:
            p = J['parent']; rot[j] = rot[p] @ R; pos[j] = pos[p] + rot[p] @ J['off']
    return np.array(pos)


def ang(a, b):
    return np.arccos(np.clip(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1))


def clip_angles(path):
    joints, data, ft = parse_bvh(path)
    idx = {J['name']: i for i, J in enumerate(joints)}
    P = np.array([fk(joints, f) for f in data])          # (frames, joints, 3), y vers le haut
    g = lambda n: P[:, idx[n]]
    hips = g('Hips')
    # Cap : direction moyenne de déplacement (clips en ligne droite).
    vel = np.gradient(hips, axis=0) / ft
    speed_h = np.linalg.norm(vel[:, [0, 2]], axis=1)
    up = np.array([0, 1.0, 0])
    lleg = g('LeftLeg') - g('LeftUpLeg')
    leg_len = np.median(np.linalg.norm(lleg, axis=1) + np.linalg.norm(g('LeftFoot') - g('LeftLeg'), axis=1))
    out = []
    for f in range(len(P)):
        r = g('RightUpLeg')[f] - g('LeftUpLeg')[f]; r[1] = 0; r /= np.linalg.norm(r)        # droite
        fw = np.cross(up, r); fw /= np.linalg.norm(fw)                                      # avant (y × droite)
        # Repère du buste (pour les bras) : haut = bassin → cou, droite = épaule G → épaule D.
        tu = g('Neck')[f] - g('Hips')[f]; tu /= np.linalg.norm(tu)
        tr = g('RightArm')[f] - g('LeftArm')[f]; tr -= tu * np.dot(tr, tu); tr /= np.linalg.norm(tr)
        tf = np.cross(tu, tr)
        row = {}
        for s, S in (('L', 'Left'), ('R', 'Right')):
            th = g(S + 'Leg')[f] - g(S + 'UpLeg')[f]; sh_ = g(S + 'Foot')[f] - g(S + 'Leg')[f]; ft_ = g(S + 'ToeBase')[f] - g(S + 'Foot')[f]
            row['hz' + s] = np.arctan2(np.dot(th, fw), -np.dot(th, up))
            out_ = np.dot(th, r) * (1 if s == 'R' else -1)
            row['hx' + s] = np.arctan2(out_, -np.dot(th, up))
            row['kz' + s] = -ang(th, sh_)
            row['az' + s] = -(ang(sh_, ft_) - np.pi / 2)
            ua = g(S + 'ForeArm')[f] - g(S + 'Arm')[f]; fa = g(S + 'Hand')[f] - g(S + 'ForeArm')[f]
            row['sz' + s] = np.arctan2(np.dot(ua, tf), -np.dot(ua, tu))
            row['sx' + s] = np.arctan2(np.dot(ua, tr) * (1 if s == 'R' else -1), -np.dot(ua, tu))
            row['ez' + s] = ang(ua, fa)
        hl = g('RightUpLeg')[f] - g('LeftUpLeg')[f]; hl[1] = 0
        sl = g('RightArm')[f] - g('LeftArm')[f]; sl[1] = 0
        row['twist'] = np.arctan2(np.dot(np.cross(hl, sl), up), np.dot(hl, sl))
        row['lean'] = np.arctan2(np.dot(tu, fw), np.dot(tu, up))
        row['bob'] = hips[f, 1]
        out.append(row)
    keys = list(out[0].keys())
    A = np.array([[o[k] for k in keys] for o in out])
    # Cycle : entre deux appuis du pied gauche (hanche gauche la plus en avant = attaque du pas).
    hz = A[:, keys.index('hzL')]
    peaks = [i for i in range(2, len(hz) - 2) if hz[i] == max(hz[i - 2:i + 3]) and hz[i] > np.percentile(hz, 70)]
    if len(peaks) < 2: raise SystemExit(f'{path} : pas de cycle net')
    # On moyenne les cycles complets (rééchantillonnés sur 32 instants).
    cyc = []
    for a, b in zip(peaks[:-1], peaks[1:]):
        if b - a < 20: continue
        t = np.linspace(a, b, 33)[:-1]
        cyc.append(np.array([np.interp(t, np.arange(len(A)), A[:, k]) for k in range(len(keys))]).T)
    C = np.mean(cyc[1:-1] if len(cyc) > 3 else cyc, axis=0)
    C[:, keys.index('bob')] = (C[:, keys.index('bob')] - C[:, keys.index('bob')].mean()) / leg_len * 0.88   # en mètres (jambe de 0,88 m)
    v = float(np.median(speed_h) / leg_len * 0.88)
    return keys, C, v, len(cyc)


res = {}
CANDS = {'walk': ['02_01', '02_02'], 'jog': ['16_36'], 'run': ['35_22']}
for name, fs in CANDS.items():
    best = None
    for f in fs:
        try: r_ = clip_angles(os.path.join(D, f + '.bvh'))
        except SystemExit as e: print(e); continue
        if best is None or (name == 'run' and r_[2] > best[2]) or (name != 'run' and r_[3] > best[3]): best = r_ + (f,)
    keys, C, v, n, f = best
    res[name] = {'v': round(v, 2), 'cycle': np.round(C, 3).tolist()}
    print(name, f, 'vitesse %.2f m/s' % v, n, 'cycles', 'hanche %.2f..%.2f' % (C[:, 0].min(), C[:, 0].max()), 'genou min %.2f' % C[:, keys.index('kzL')].min())
with open(OUT, 'w') as fo:
    fo.write('/**\n * Cycles de foulée issus de captures de mouvement réelles (base CMU, Carnegie Mellon University,\n'
             ' * libre d\'usage y compris commercial ; conversion BVH de B. Hahne). Générés par\n'
             ' * scripts/mocap/bvh2gait.py : 32 instants par cycle (deux pas), angles en radians dans les\n'
             ' * conventions du squelette du jeu ; v = vitesse du clip (m/s).\n */\n')
    fo.write('export const GAIT_KEYS = ' + json.dumps(keys) + ';\n')
    fo.write('export const GAITS = ' + json.dumps(res, separators=(',', ':')) + ';\n')
print('écrit', OUT)
