"""
Cuisson du joueur réaliste (données MakeHuman, CC0) pour Coach de Poche.

Sortie : <out>/mhplayer.bin (en-tête JSON + tableaux binaires) et les textures.
 - corps d'athlète (homme jeune musclé) en 3 variantes (peau claire / foncée / asiatique) ;
 - os ramenés à NOTRE squelette (13 os : corps, buste, tête, hanche/genou/cheville ×2,
   épaule/coude ×2) : le joueur garde toutes les animations du jeu ;
 - bras ramenés le long du corps (le modèle de base est en « A ») ;
 - tenue taillée dans le corps : maillot, manches, short, chaussettes, crampons ;
 - cheveux (plusieurs coupes), yeux, sourcils (proxies MakeHuman ajustés au corps).
"""
import json, os, sys, struct, numpy as np
from PIL import Image
from load import load_base, target, PUB

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
V, UVS, FACES, MATS, SI, SW, BONES = load_base()
N = len(V)
BN = [b['name'].replace('____head', '') for b in BONES]
OUR = ['body', 'upper', 'head', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR', 'shL', 'elL', 'shR', 'elR']
OI = {n: i for i, n in enumerate(OUR)}


def our_bone(n):
    side = 'L' if n.endswith('.L') else 'R' if n.endswith('.R') else ''
    b = n.split('.')[0]
    if b in ('root', 'spine05', 'spine04') or b.startswith('pelvis'): return 'body'
    if b in ('spine03', 'spine02', 'spine01', 'clavicle', 'breast', 'neck01'): return 'upper'
    if b.startswith('upperleg'): return 'hip' + side
    if b.startswith('lowerleg'): return 'knee' + side
    if b == 'foot' or b.startswith('toe'): return 'ankle' + side
    if b.startswith('shoulder') or b.startswith('upperarm'): return 'sh' + side
    if b.startswith('lowerarm') or b == 'wrist' or b.startswith('finger') or b.startswith('metacarpal') or b.startswith('thumb'): return 'el' + side
    return 'head'


BMAP = np.array([OI[our_bone(n)] for n in BN])


def map_weights(si, sw):
    W = np.zeros((len(si), len(OUR)))
    for k in range(si.shape[1]):
        np.add.at(W, (np.arange(len(si)), BMAP[si[:, k]]), sw[:, k])
    s = W.sum(1, keepdims=True); s[s == 0] = 1
    return W / s


WB = map_weights(SI, SW)

# ---------- Morphologie : homme jeune, athlétique ----------
ETH = ['caucasian', 'african', 'asian']


def morph(eth):
    w = {e: 0.1 for e in ETH}; w[eth] = 0.8
    X = V.copy()
    for e, k in w.items(): X += k * target(f'macrodetails/{e}-male-young', N)
    X += 0.3 * target('macrodetails/universal-male-young-averagemuscle-averageweight', N)
    X += 0.7 * target('macrodetails/universal-male-young-maxmuscle-averageweight', N)
    return X


def group_center(X, name):
    gi = MATS.index(name)
    vs = sorted({v for f in FACES if f[1] == gi for v in f[0]})
    return X[vs].mean(0)


BODY_F = [f for f in FACES if MATS[f[1]] == 'body']
BODY_V = np.array(sorted({v for f in BODY_F for v in f[0]}))

# Repère du jeu (mètres) : avant +x (MH +z), haut +y, droite +z (MH -x) ; pieds à y = 0.
X0 = morph('caucasian')
YMIN = X0[BODY_V, 1].min()
HGT = (X0[BODY_V, 1].max() - YMIN) * 0.1
SCALE = 1.80 / HGT


def to_game(X):
    return np.stack([X[:, 2], X[:, 1] - YMIN, -X[:, 0]], 1) * 0.1 * SCALE


def rot(axis, ang):
    axis = axis / np.linalg.norm(axis); a, b, c = axis; co, s = np.cos(ang), np.sin(ang)
    return np.array([[co + a * a * (1 - co), a * b * (1 - co) - c * s, a * c * (1 - co) + b * s],
                     [b * a * (1 - co) + c * s, co + b * b * (1 - co), b * c * (1 - co) - a * s],
                     [c * a * (1 - co) - b * s, c * b * (1 - co) + a * s, co + c * c * (1 - co)]])


JN = {'hipL': 'joint-l-upper-leg', 'kneeL': 'joint-l-knee', 'ankleL': 'joint-l-ankle', 'hipR': 'joint-r-upper-leg', 'kneeR': 'joint-r-knee', 'ankleR': 'joint-r-ankle',
      'shL': 'joint-l-shoulder', 'elL': 'joint-l-elbow', 'handL': 'joint-l-hand', 'shR': 'joint-r-shoulder', 'elR': 'joint-r-elbow', 'handR': 'joint-r-hand',
      'neck': 'joint-neck', 'head': 'joint-head', 'pelvis': 'joint-pelvis', 'spine3': 'joint-spine-3', 'spine1': 'joint-spine-1'}
J0 = {k: to_game(group_center(X0, v)[None])[0] for k, v in JN.items()}
DOWN = np.array([0.0, -1.0, 0.0])


def repose(G, W, J):
    """Bras le long du corps : rotation du bras (épaule) puis de l'avant-bras (coude), pondérée."""
    G = G.copy()
    for s in 'LR':
        S, E, H = J['sh' + s], J['el' + s], J['hand' + s]
        a1 = np.cross(E - S, DOWN); ang1 = np.arccos(np.clip(np.dot(E - S, DOWN) / np.linalg.norm(E - S), -1, 1))
        R1 = rot(a1, ang1) if np.linalg.norm(a1) > 1e-9 else np.eye(3)
        wa = (W[:, OI['sh' + s]] + W[:, OI['el' + s]])[:, None]
        G = G + wa * ((G - S) @ R1.T + S - G)
        E2 = (E - S) @ R1.T + S; H2 = (H - S) @ R1.T + S
        a2 = np.cross(H2 - E2, DOWN); ang2 = np.arccos(np.clip(np.dot(H2 - E2, DOWN) / np.linalg.norm(H2 - E2), -1, 1))
        R2 = rot(a2, ang2) if np.linalg.norm(a2) > 1e-9 else np.eye(3)
        we = W[:, OI['el' + s]][:, None]
        G = G + we * ((G - E2) @ R2.T + E2 - G)
    return G


def repose_legs(G, W, J):
    """Jambes à la verticale sous la hanche (le modèle de base est jambes écartées)."""
    G = G.copy()
    for s in 'LR':
        Hp, K, A = J['hip' + s], J['knee' + s], J['ankle' + s]
        a1 = np.cross(K - Hp, DOWN); ang1 = np.arccos(np.clip(np.dot(K - Hp, DOWN) / np.linalg.norm(K - Hp), -1, 1))
        R1 = rot(a1, ang1) if np.linalg.norm(a1) > 1e-9 else np.eye(3)
        wl = (W[:, OI['hip' + s]] + W[:, OI['knee' + s]] + W[:, OI['ankle' + s]])[:, None]
        G = G + wl * ((G - Hp) @ R1.T + Hp - G)
        K2 = (K - Hp) @ R1.T + Hp; A2 = (A - Hp) @ R1.T + Hp
        a2 = np.cross(A2 - K2, DOWN); ang2 = np.arccos(np.clip(np.dot(A2 - K2, DOWN) / np.linalg.norm(A2 - K2), -1, 1))
        R2 = rot(a2, ang2) if np.linalg.norm(a2) > 1e-9 else np.eye(3)
        wk = (W[:, OI['knee' + s]] + W[:, OI['ankle' + s]])[:, None]
        G = G + wk * ((G - K2) @ R2.T + K2 - G)
    return G


_repose_arms = repose
def repose(G, W, J):
    return repose_legs(_repose_arms(G, W, J), W, J)


def joints_after(J):
    J = dict(J)
    for s in 'LR':
        Hp, K, A = J['hip' + s], J['knee' + s], J['ankle' + s]
        J['knee' + s] = Hp + DOWN * np.linalg.norm(K - Hp)
        J['ankle' + s] = J['knee' + s] + DOWN * np.linalg.norm(A - K)
    for s in 'LR':
        S, E, H = J['sh' + s], J['el' + s], J['hand' + s]
        J['el' + s] = S + DOWN * np.linalg.norm(E - S)
        J['hand' + s] = J['el' + s] + DOWN * np.linalg.norm(H - E)
    return J


JR = joints_after(J0)

# ---------- Normales lissées (par sommet d'origine) ----------
def vnormals(G, faces):
    n = np.zeros_like(G)
    for vs, *_ in faces:
        p = G[list(vs)]
        fn = np.cross(p[2] - p[0], p[1] - p[0]) if len(vs) == 3 else np.cross(p[2] - p[0], p[3] - p[1])
        for v in vs: n[v] += fn
    l = np.linalg.norm(n, axis=1, keepdims=True); l[l == 0] = 1
    return n / l


# Orientation : vérifiée plus bas (normale du ventre vers +x).
ARR = []   # (nom, dtype, ndarray)


def add(name, arr, dt):
    ARR.append((name, dt, np.ascontiguousarray(arr.astype(dt))))


def q_pos(p): return np.round(p * 10000).astype(np.int16)        # 0,1 mm
def q_nrm(n): return np.round(n * 127).astype(np.int8)
def q_uv(u): return np.round(np.clip(u, -0.5, 1.5) * 32767 / 1.5).astype(np.int16)   # -1,5..1,5


def skin_arrays(W):
    idx = np.argsort(-W, 1)[:, :4]
    w = np.take_along_axis(W, idx, 1)
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    return idx.astype(np.uint8), np.round(w * 255).astype(np.uint8)


META = {'bones': OUR, 'scale': SCALE, 'parts': {}, 'eth': ETH}

# Squelette (positions de repos, repère du jeu) : sert à placer nos os.
META['joints'] = {k: [round(float(x), 4) for x in v] for k, v in JR.items()}

# ---------- Régions de la tenue (sur la variante caucasienne repositionnée) ----------
G0 = repose(to_game(X0), WB, J0)
NRM0 = vnormals(G0, BODY_F)
# Le devant regarde +x ? (normale moyenne du ventre)
belly = [v for v in BODY_V if abs(G0[v, 2]) < 0.05 and abs(G0[v, 1] - (JR['pelvis'][1] + 0.15)) < 0.05]
print('normale du ventre', NRM0[belly].mean(0))
if NRM0[belly].mean(0)[0] < 0: print('!! normales inversées')

hipY = (JR['hipL'][1] + JR['hipR'][1]) / 2
kneeY = (JR['kneeL'][1] + JR['kneeR'][1]) / 2
ankleY = (JR['ankleL'][1] + JR['ankleR'][1]) / 2
neckY = JR['neck'][1]
shY = (JR['shL'][1] + JR['shR'][1]) / 2
print('articulations y : cheville %.3f genou %.3f hanche %.3f épaule %.3f cou %.3f' % (ankleY, kneeY, hipY, shY, neckY))

W0 = WB
armW = sum(W0[:, OI[b]] for b in ('shL', 'shR', 'elL', 'elR'))
foreW = W0[:, OI['elL']] + W0[:, OI['elR']]
legW = sum(W0[:, OI[b]] for b in ('hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'))
headW = W0[:, OI['head']]
ys = G0[:, 1]
armDrop = np.where(G0[:, 2] < 0, JR['shL'][1], JR['shR'][1]) - ys       # distance sous l'épaule (bras pendant)

HEM = hipY + 0.05           # bas du maillot (rentré par-dessus la ceinture du short)
COLLAR = neckY - 0.035
SLEEVE = 0.19               # longueur de manche sous l'épaule
WAIST = hipY + 0.13
SHORT_END = kneeY + 0.13
SOCK_TOP = kneeY - 0.07
BOOT_TOP = ankleY + 0.035
isBody = np.zeros(N, bool); isBody[BODY_V] = True
NX = JR['neck'][0]
rrN = np.sqrt((G0[:, 0] - NX) ** 2 + G0[:, 2] ** 2)
shirt = isBody & (ys > HEM) & ((ys < COLLAR) | ((rrN > 0.088) & (ys < neckY + 0.03))) & (headW < 0.5) & (foreW < 0.35) & ((armW < 0.5) | (armDrop < SLEEVE)) & (legW < 0.6)
sleeveV = shirt & (armW >= 0.5)
shorts = isBody & (ys < WAIST) & (ys > SHORT_END) & (armW < 0.05) & ~shirt | (isBody & (ys < WAIST) & (ys > SHORT_END) & (armW < 0.05) & (ys < HEM + 0.04))
socks = isBody & (ys < SOCK_TOP) & (ys > BOOT_TOP - 0.01) & (legW > 0.5)
boots = isBody & (ys < BOOT_TOP) & (legW > 0.5)
print('régions : maillot', shirt.sum(), 'manches', sleeveV.sum(), 'short', shorts.sum(), 'chaussettes', socks.sum(), 'crampons', boots.sum())

# Voisinage (pour l'érosion du corps caché sous la tenue).
NB = [set() for _ in range(N)]
for vs, *_ in BODY_F:
    for i in range(len(vs)):
        a, b = vs[i], vs[(i + 1) % len(vs)]; NB[a].add(b); NB[b].add(a)
covered = shirt | shorts | socks | boots
inner = covered.copy()
for _ in range(2):
    nxt = inner.copy()
    for v in np.nonzero(inner)[0]:
        if any(not inner[u] for u in NB[v]): nxt[v] = False
    inner = nxt
inner |= boots & (ys < BOOT_TOP - 0.025)   # pied entièrement caché sous la chaussure


def cyl_uv(P, center, v0, v1):
    u = (np.arctan2(P[:, 0] - center[0], P[:, 2] - center[2]) / (2 * np.pi)) % 1.0
    v = (P[:, 1] - v0) / (v1 - v0)
    return np.stack([u, v], 1)


def build_part(name, region, offset, uvfn, faces=BODY_F, keep=None, per_eth=True):
    """Coque (vêtement) ou peau : triangles des faces dont tous les sommets sont dans la région."""
    fl = [f for f in faces if all(region[v] for v in f[0])]
    verts, tris, uvs_out, src = [], [], [], []
    key = {}
    # u cylindrique : on duplique les sommets des faces à cheval sur la couture (u 0/1).
    Pref = G0
    for vs, m, uvi in fl:
        uvv = uvfn(Pref[list(vs)], vs, uvi)
        if uvv is not None and np.ptp(uvv[:, 0]) > 0.5: uvv = uvv.copy(); uvv[uvv[:, 0] < 0.5, 0] += 1.0
        q = []
        for j, v in enumerate(vs):
            k = (v, tuple(np.round(uvv[j], 5)) if uvv is not None else uvi[j])
            if k not in key:
                key[k] = len(src); src.append(v); uvs_out.append(uvv[j] if uvv is not None else UVS[uvi[j]])
            q.append(key[k])
        tris += [q[0], q[1], q[2]] + ([q[0], q[2], q[3]] if len(q) == 4 else [])
    src = np.array(src)
    META['parts'][name] = {'n': len(src), 't': len(tris)}
    add(name + '.uv', q_uv(np.array(uvs_out)), np.int16)
    add(name + '.idx', np.array(tris), np.uint16 if len(src) < 65535 else np.uint32)
    si, sw = skin_arrays(WB[src])
    add(name + '.si', si, np.uint8); add(name + '.sw', sw, np.uint8)
    return src, offset


def body_uv(P, vs, uvi): return None


# Corps visible : tout sauf l'intérieur de la tenue.
PARTS = []
PARTS.append(('body', build_part('body', isBody & ~inner, None, body_uv, faces=[f for f in BODY_F if not all(inner[v] for v in f[0])] )))
# Maillot (buste) et manches : texture du maillot (avant à u = 0,25, col en haut).
ctr = np.array([JR['pelvis'][0], 0, 0])
PARTS.append(('shirt', build_part('shirt', shirt & ~sleeveV | (shirt & (armW < 0.5)), lambda v: 0.011 + 0.013 * np.clip((HEM + 0.16 - G0[v, 1]) / 0.16, 0, 1), lambda P, vs, uvi: cyl_uv(P, ctr, HEM, COLLAR))))


def sleeve_uv(P, vs, uvi):
    out = []
    for p in P:
        sid = 'L' if p[2] < 0 else 'R'
        c = JR['sh' + sid]
        u = (np.arctan2(p[0] - c[0], p[2] - c[2]) / (2 * np.pi)) % 1.0
        out.append([u, 0.02 + 0.84 * np.clip(1 - (c[1] - p[1]) / SLEEVE, 0, 1)])   # sans la bande du col en haut ; liseré en bas
    return np.array(out)


# Manches : faces du maillot dont un sommet au moins est sur le bras.
PARTS.append(('sleeve', build_part('sleeve', shirt, lambda v: 0.012, sleeve_uv, faces=[f for f in BODY_F if all(shirt[v] for v in f[0]) and any(armW[v] >= 0.5 for v in f[0])])))
# Correction : le buste ne garde que les faces sans sommet de bras.
META['parts'].pop('shirt'); ARR[:] = [a for a in ARR if not a[0].startswith('shirt.')]; PARTS = [p for p in PARTS if p[0] != 'shirt']
NECK_RING = np.zeros(N, bool)
for v in np.nonzero(shirt)[0]:
    if G0[v, 1] > shY - 0.07 and rrN[v] < 0.13 and any(not shirt[u] for u in NB[v]): NECK_RING[v] = True


def shirt_uv(P, vs, uvi):
    uv = cyl_uv(P, ctr, HEM, shY + 0.02)
    v = np.clip(uv[:, 1], 0, 1) * 0.9
    rr = np.sqrt((P[:, 0] - NX) ** 2 + P[:, 2] ** 2)
    # Col : seul l'anneau du bord de l'encolure prend le liseré (bande du haut de la texture).
    ring = np.array([NECK_RING[v] for v in vs])
    v = np.where(ring, 0.985, np.minimum(v, 0.9))
    return np.stack([uv[:, 0], v], 1)


PARTS.insert(1, ('shirt', build_part('shirt', shirt, lambda v: 0.011 + 0.013 * np.clip((HEM + 0.16 - G0[v, 1]) / 0.16, 0, 1), shirt_uv, faces=[f for f in BODY_F if all(shirt[v] for v in f[0]) and not any(armW[v] >= 0.5 for v in f[0])])))
# Gardien : manche longue (jusqu'au poignet) et gants.
handDrop = shY - (JR['handL'][1] + JR['handR'][1]) / 2
longSleeve = isBody & (armW >= 0.5) & (armDrop < handDrop - 0.025) & (ys < COLLAR + 0.05)
gloves = isBody & (foreW > 0.5) & (armDrop >= handDrop - 0.045)


def sleeve_long_uv(P, vs, uvi):
    out = []
    for p in P:
        sid = 'L' if p[2] < 0 else 'R'
        c = JR['sh' + sid]
        u = (np.arctan2(p[0] - c[0], p[2] - c[2]) / (2 * np.pi)) % 1.0
        out.append([u, 0.02 + 0.84 * np.clip(1 - (c[1] - p[1]) / handDrop, 0, 1)])
    return np.array(out)


SL_ALL = shirt | longSleeve
PARTS.append(('sleeveLong', build_part('sleeveLong', SL_ALL, lambda v: 0.012, sleeve_long_uv, faces=[f for f in BODY_F if all(SL_ALL[v] for v in f[0]) and any(armW[v] >= 0.5 for v in f[0])])))
PARTS.append(('gloves', build_part('gloves', gloves, lambda v: 0.007, lambda P, vs, uvi: np.zeros((len(P), 2)))))
# Décalque du visage (photo du joueur) : faces de l'avant du visage, projection plane calée
# sur les yeux et la bouche (photo recadrée 128 × 128 : yeux vers 38 % du haut, bouche vers 75 %).
EYE = (to_game(group_center(X0, 'joint-l-eye')[None])[0] + to_game(group_center(X0, 'joint-r-eye')[None])[0]) / 2
MOUTH = to_game(group_center(X0, 'joint-mouth')[None])[0]
EYE_V, MOUTH_V = 0.62, 0.25
VS_ = (EYE_V - MOUTH_V) / 0.068          # yeux → lèvres : ≈ 6,8 cm sur un visage d'adulte
faceR = isBody & (headW > 0.9) & (G0[:, 0] > JR['neck'][0] + 0.02) & (ys > MOUTH[1] - 0.075) & (ys < EYE[1] + 0.085) & (np.abs(G0[:, 2]) < 0.078)


def face_uv(P, vs, uvi):
    v = EYE_V + (P[:, 1] - EYE[1]) * VS_
    u = 0.5 - P[:, 2] * VS_          # la droite du joueur (+z) est à gauche sur une photo de face
    return np.stack([u, v], 1)


PARTS.append(('faceDecal', build_part('faceDecal', faceR, lambda v: 0.0015, face_uv)))
PARTS.append(('shorts', build_part('shorts', shorts, lambda v: 0.016 + 0.02 * np.clip((WAIST - G0[v, 1]) / (WAIST - SHORT_END), 0, 1), lambda P, vs, uvi: cyl_uv(P, ctr, SHORT_END, WAIST))))
PARTS.append(('socks', build_part('socks', socks, lambda v: 0.0055, lambda P, vs, uvi: cyl_uv(P, P.mean(0), BOOT_TOP, SOCK_TOP))))
PARTS.append(('boots', build_part('boots', boots, lambda v: 0.008, lambda P, vs, uvi: np.zeros((len(P), 2)))))

# ---------- Proxies : cheveux, yeux, sourcils ----------
PROX = {'hair_short': 'hair/short02', 'hair_buzz': 'hair/short04', 'hair_afro': 'hair/afro01', 'hair_mohawk': 'hair/Harvey_Hawk1',
        'hair_long': 'hair/long01', 'hair_bun': 'hair/ponytail01', 'hair_curly': 'hair/short01', 'eyes': 'eyes/Low-Poly', 'brows': 'eyebrows/eyebrow001'}


def parse_faces(F):
    out = []; i = 0
    while i < len(F):
        t = F[i]; i += 1
        n = 4 if t & 1 else 3
        vs = F[i:i + n]; i += n
        if t & 2: i += 1
        if t & 4: i += 1
        uv = None
        if t & 8: uv = F[i:i + n]; i += n
        if t & 16: i += 1
        if t & 32: i += n
        if t & 64: i += 1
        if t & 128: i += n
        out.append((vs, 0, uv))
    return out


PROXY_DATA = {}
for name, rel in PROX.items():
    d = os.path.join(PUB, 'proxies', rel)
    js = [f for f in os.listdir(d) if f.endswith('.json')]
    if not js: print('!! pas de proxy', rel); continue
    p = json.load(open(os.path.join(d, js[0])))
    ref = np.array(p['ref_vIdxs']); wts = np.array(p['weights']); off = np.array(p['offsets'])
    tex = None
    tdir = os.path.join(d, 'textures')
    if os.path.isdir(tdir):
        mt = p['materials'][0].get('mapDiffuse') if p.get('materials') else None
        tex = os.path.join(d, mt) if mt and os.path.exists(os.path.join(d, mt)) else os.path.join(tdir, sorted(os.listdir(tdir))[0])
    PW = np.zeros((len(ref), len(OUR)))
    psi = np.array(p.get('skinIndices') or []); psw = np.array(p.get('skinWeights') or [])
    if psi.size == len(ref) * 4 and p.get('bones'):
        psi = psi.reshape(-1, 4); psw = psw.reshape(-1, 4)
        pmap = np.array([OI[our_bone(b['name'].replace('____head', ''))] for b in p['bones']])
        for k in range(4): np.add.at(PW, (np.arange(len(ref)), pmap[psi[:, k]]), psw[:, k])
        PW /= np.maximum(PW.sum(1, keepdims=True), 1e-9)
    else:
        PW[:, OI['head']] = 1.0   # yeux, sourcils : portés par la tête
    pf = parse_faces(p['faces'])
    puv = np.array(p['uvs'][0]).reshape(-1, 2)
    PROXY_DATA[name] = (ref, wts, off, pf, puv, PW, tex)
    print('proxy', name, len(ref), 'sommets', len(pf), 'faces', os.path.basename(tex) if tex else '-')


def proxy_part(name, X, first):
    ref, wts, off, pf, puv, PW, tex = PROXY_DATA[name][:7]
    P = (X[ref] * wts[:, :, None]).sum(1) + off
    G = repose(to_game(P), PW, J0) if False else to_game(P)
    if first:
        key = {}; src = []; uvo = []; tris = []
        for vs, _, uvi in pf:
            q = []
            for j, v in enumerate(vs):
                k = (v, uvi[j] if uvi else 0)
                if k not in key: key[k] = len(src); src.append(v); uvo.append(puv[uvi[j]] if uvi else [0, 0])
                q.append(key[k])
            tris += [q[0], q[1], q[2]] + ([q[0], q[2], q[3]] if len(q) == 4 else [])
        src = np.array(src)
        META['parts'][name] = {'n': len(src), 't': len(tris), 'tex': os.path.basename(tex) if tex else None}
        add(name + '.uv', q_uv(np.array(uvo)), np.int16)
        add(name + '.idx', np.array(tris), np.uint16)
        si, sw = skin_arrays(PW[src]); add(name + '.si', si, np.uint8); add(name + '.sw', sw, np.uint8)
        PROXY_DATA[name] = PROXY_DATA[name] + (src,)
    src = PROXY_DATA[name][7]
    Gp = G[src]
    # normales lissées du proxy
    n = np.zeros_like(G)
    for vs, *_ in pf:
        p = G[list(vs)]
        fn = np.cross(p[2] - p[0], p[1] - p[0]) if len(vs) == 3 else np.cross(p[2] - p[0], p[3] - p[1])
        for v in vs: n[v] += fn
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    return Gp, n[src]


# ---------- Positions par variante ----------
for ei, eth in enumerate(ETH):
    X = morph(eth)
    G = repose(to_game(X), WB, J0)
    NR = vnormals(G, BODY_F)
    for pname, (src, offset) in PARTS:
        P = G[src] + (NR[src] * np.array([offset(v) for v in src])[:, None] if offset else 0)
        if pname == 'boots':
            # Chaussure : on lisse le pied (plus d'orteils) puis on l'épaissit légèrement.
            loc = {v: i for i, v in enumerate(src)}
            nb = [[loc[u] for u in NB[v] if u in loc] for v in src]
            fixed = np.array([any(not boots[u] for u in NB[v]) for v in src])
            Q = G[src].copy()
            for _ in range(30):
                M = np.array([Q[n].mean(0) if n else Q[i] for i, n in enumerate(nb)])
                Q = np.where(fixed[:, None], Q, 0.45 * Q + 0.55 * M)
            Q += NR[src] * 0.016
            Q[:, 1] = np.maximum(Q[:, 1], 0.004)
            P = Q
        if pname == 'shorts':
            crotch = hipY - 0.07
            for i, v in enumerate(src):
                p = G[v]
                t = np.clip((WAIST - p[1]) / (WAIST - SHORT_END), 0, 1)
                if p[1] < crotch + 0.03:
                    s_ = 'L' if p[2] < 0 else 'R'
                    ax = np.array([JR['hip' + s_][0] + 0.01, JR['hip' + s_][2]])
                    d = np.array([p[0], p[2]]) - ax; r = np.linalg.norm(d) or 1e-6
                    k = np.clip((crotch + 0.03 - p[1]) / 0.06, 0, 1)
                    nr = max(r + 0.016, 0.098 + 0.024 * t)
                    nr = r + 0.016 + (nr - r - 0.016) * k
                    P[i, 0], P[i, 2] = ax[0] + d[0] / r * nr, ax[1] + d[1] / r * nr
                    P[i, 1] = p[1]
                else:
                    k2 = np.clip((crotch + 0.13 - p[1]) / 0.1, 0, 1)
                    P[i] += NR[v] * 0.014 * k2

        add(f'{pname}.pos{ei}', q_pos(P), np.int16)
        add(f'{pname}.nrm{ei}', q_nrm(NR[src]), np.int8)
    for name in PROXY_DATA:
        Gp, Np = proxy_part(name, X, ei == 0)
        add(f'{name}.pos{ei}', q_pos(Gp), np.int16)
        add(f'{name}.nrm{ei}', q_nrm(Np), np.int8)
    print('variante', eth, 'ok')

# Repères utiles : surface du dos et de la poitrine (numéros), hauteur du col.
sh_src = [s for n, (s, o) in PARTS if n == 'shirt'][0]
Pm = G0[sh_src]
mid = np.abs(Pm[:, 2]) < 0.04
def surf(y, sgn):
    sel = mid & (np.abs(Pm[:, 1] - y) < 0.03) & (np.sign(Pm[:, 0]) == sgn)
    return float((Pm[sel, 0] * sgn).max() * sgn) if sel.any() else 0.0
META['marks'] = {'backX': surf(shY - 0.18, -1) - 0.024, 'backY': shY - 0.18, 'chestX': surf(shY - 0.08, 1) + 0.024, 'chestY': shY - 0.08,
                 'hem': HEM, 'collar': COLLAR, 'height': 1.80}

# ---------- Écriture ----------
blob = b''; table = []
for name, dt, a in ARR:
    while len(blob) % 4: blob += b'\0'
    table.append({'name': name, 'type': np.dtype(dt).name, 'off': len(blob), 'len': int(a.size)})
    blob += a.tobytes()
META['arrays'] = table
head = json.dumps(META, separators=(',', ':')).encode()
while (len(head) + 8) % 4: head += b' '
with open(os.path.join(OUT, 'mhplayer.bin'), 'wb') as f:
    f.write(b'MHP1'); f.write(struct.pack('<I', len(head))); f.write(head); f.write(blob)
print('écrit', os.path.getsize(os.path.join(OUT, 'mhplayer.bin')) // 1024, 'Ko')

# ---------- Textures ----------
SK = {'caucasian': 'young_caucasian_male/textures/young_lightskinned_male_diffuse.png',
      'african': 'young_african_male/textures/young_darkskinned_male_diffuse.png',
      'asian': 'young_asian_male/textures/young_asian_male_diffuse.png'}
for e, rel in SK.items():
    p = os.path.join(PUB, 'skins', rel)
    if not os.path.exists(p):
        alt = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(PUB, 'skins', rel.split('/')[0])) for f in fs if f.endswith('.png') and 'thumb' not in f]
        p = alt[0]
    Image.open(p).convert('RGB').save(os.path.join(OUT, f'skin_{e}.jpg'), quality=88)
for name, data in PROXY_DATA.items():
    tex = data[6]
    if not tex: continue
    im = Image.open(tex).convert('RGBA')
    if name.startswith('hair') or name == 'brows':
        # Niveaux de gris (teinte appliquée en jeu selon la couleur de cheveux du joueur).
        r, g, b, a = im.split()
        l = Image.merge('RGB', (r, g, b)).convert('L')
        arr = np.asarray(l).astype(np.float32); m = arr[np.asarray(a) > 128].mean() if (np.asarray(a) > 128).any() else 128
        arr = np.clip(arr * (150.0 / max(m, 1)), 0, 255).astype(np.uint8)
        l = Image.fromarray(arr)
        im = Image.merge('RGBA', (l, l, l, a))
        if max(im.size) > 512: im = im.resize((512, 512), Image.LANCZOS)
    im.save(os.path.join(OUT, f'{name}.png'), optimize=True)
eyes_dir = os.path.join(PUB, 'proxies', 'eyes', 'Low-Poly', 'textures')
for c in ('brown', 'blue', 'green', 'grey'):
    Image.open(os.path.join(eyes_dir, f'{c}_eye.png')).convert('RGB').resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, f'eye_{c}.jpg'), quality=90)
print('textures ok')
