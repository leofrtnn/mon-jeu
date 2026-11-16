"""Lecture des données MakeHuman (makehuman-data) : maillage de base, cibles, os."""
import json, numpy as np, os

D = os.environ.get('MH_DATA') or os.path.join(os.path.dirname(__file__), '..', 'dl_mh', 'package')   # paquet npm makehuman-data décompressé
PUB = os.path.join(D, 'public', 'data')


def load_base():
    d = json.load(open(os.path.join(PUB, 'models', 'human_full_size.json')))
    V = np.array(d['vertices'], dtype=np.float64).reshape(-1, 3)
    uvs = np.array(d['uvs'][0], dtype=np.float64).reshape(-1, 2)
    F = d['faces']
    faces = []  # (verts[3|4], mat, uvidx[3|4])
    i = 0
    nuvl = 1
    while i < len(F):
        t = F[i]; i += 1
        quad = t & 1; hasMat = t & 2; hasFaceUv = t & 4; hasFVUv = t & 8
        hasFN = t & 16; hasFVN = t & 32; hasFC = t & 64; hasFVC = t & 128
        n = 4 if quad else 3
        vs = F[i:i + n]; i += n
        mat = None
        if hasMat: mat = F[i]; i += 1
        uv = None
        if hasFaceUv: i += nuvl
        if hasFVUv:
            uv = F[i:i + n]; i += n * nuvl
        if hasFN: i += 1
        if hasFVN: i += n
        if hasFC: i += 1
        if hasFVC: i += n
        faces.append((vs, mat, uv))
    mats = [m['DbgName'] for m in d['materials']]
    si = np.array(d['skinIndices'], dtype=np.int64).reshape(-1, 4)
    sw = np.array(d['skinWeights'], dtype=np.float64).reshape(-1, 4)
    bones = d['bones']
    return V, uvs, faces, mats, si, sw, bones


_TL = None
def target_index():
    global _TL
    if _TL is None:
        t = json.load(open(os.path.join(D, 'src', 'json', 'targets', 'target-list.json')))['targets']
        _TL = sorted(t.keys())
    return _TL


def target(name, nverts):
    tl = target_index()
    k = tl.index('data/targets/' + name + '.target')
    row = nverts * 3
    with open(os.path.join(PUB, 'targets', 'targets.bin'), 'rb') as f:
        f.seek(k * row * 2)
        a = np.frombuffer(f.read(row * 2), dtype=np.int16).astype(np.float64) * 1e-3
    return a.reshape(-1, 3)
