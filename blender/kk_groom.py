# Strand grooming in numpy: root sampling on a surface, flow-field direction, lift and droop, clumping, frizz,
# collision against an SDF, and a compact binary export (.kkf) read by src/chars/strands.ts.
import struct
import numpy as np
from scipy.spatial import cKDTree


def sample_roots(v, n, tris, density, mask, count, rng):
    # Area- and density-weighted random roots on triangles. density/mask: callables on (N,3) points.
    a, b, c = v[tris[:, 0]], v[tris[:, 1]], v[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    cen = (a + b + c) / 3
    w = area * density(cen) * mask(cen)
    w = np.maximum(w, 0)
    idx = rng.choice(len(tris), size=count * 2, p=w / w.sum())
    r1, r2 = rng.random(len(idx)), rng.random(len(idx))
    s = np.sqrt(r1)
    bary = np.stack([1 - s, s * (1 - r2), s * r2], 1)
    T = tris[idx]
    p = (v[T] * bary[:, :, None]).sum(1)
    nn = (n[T] * bary[:, :, None]).sum(1)
    nn /= np.linalg.norm(nn, axis=1, keepdims=True)
    keep = mask(p) > rng.random(len(p))  # soft mask edges
    p, nn, idx, bary = p[keep][:count], nn[keep][:count], idx[keep][:count], bary[keep][:count]
    return p, nn, idx, bary


def tangent_project(d, n):
    d = d - n * (d * n).sum(1, keepdims=True)
    return d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)


def grow(p, n, d, L, lift, npts, rng, droop=0.35, lay=0.65, frizz=0.1, frizz_freq=2.2, wave=0.0, waves=1.0):
    # Each strand starts lifted `lift` radians off the skin along flow d, lays toward the skin and droops with length.
    # frizz is a per-point kink; wave is a smooth sideways S-curve with `waves` periods along the strand.
    # frizz, wave and waves may be scalars or per-strand arrays.
    N = len(p)
    b2 = np.cross(n, d)
    pts = np.zeros((N, npts, 3))
    pts[:, 0] = p - n * 0.00025
    seg = (L / (npts - 1))[:, None]
    phase = rng.random(N) * 6.283
    phase2 = rng.random(N) * 6.283
    fz = np.broadcast_to(frizz, (N,)) * (0.5 + rng.random(N))
    wv = np.broadcast_to(wave, (N,)) * (0.6 + 0.8 * rng.random(N))
    ws = np.broadcast_to(waves, (N,))
    g = np.array([0.0, -1.0, 0.0])
    for k in range(1, npts):
        t = k / (npts - 1)
        a = lift * (1 - lay * t ** 0.8)
        dirk = np.cos(a)[:, None] * d + np.sin(a)[:, None] * n
        dirk = dirk + g * (droop * t * t * (L / 0.02))[:, None]
        ang = phase + frizz_freq * k
        dirk = dirk + (fz * np.cos(ang))[:, None] * b2 + (fz * np.sin(ang) * 0.6)[:, None] * n
        dirk = dirk + (wv * np.sin(phase2 + 6.283 * ws * t))[:, None] * b2
        dirk /= np.linalg.norm(dirk, axis=1, keepdims=True)
        pts[:, k] = pts[:, k - 1] + dirk * seg
    return pts


def clump(pts, roots, amount, rng, guide_frac=0.09, radius=0.0035, power=1.4):
    N, P, _ = pts.shape
    gidx = np.where(rng.random(N) < guide_frac)[0]
    tree = cKDTree(roots[gidx])
    dist, nearest = tree.query(roots)
    gi = gidx[nearest]
    t = np.linspace(0, 1, P)[None, :, None]
    target = pts[gi] + (pts[:, :1] - pts[gi][:, :1]) * (1 - t)
    c = (amount * (dist < radius))[:, None, None] * t ** power
    out = pts + c * (target - pts)
    out[gidx] = pts[gidx]
    return out


def collide(pts, sdf, grad, min_off=0.0003):
    # Push points (except roots) outside the skin.
    N, P, _ = pts.shape
    q = pts[:, 1:].reshape(-1, 3).copy()
    for _ in range(3):
        d = sdf(q[:, 0], q[:, 1], q[:, 2])
        bad = d < min_off
        if not bad.any():
            break
        gr = grad(q[bad])
        q[bad] += gr * (min_off - d[bad])[:, None]
    pts[:, 1:] = q.reshape(N, P - 1, 3)
    return pts


def resample_length(pts, frac):
    # Shorten strands to `frac` of their length along their own polyline (keeps point count).
    N, P, _ = pts.shape
    segl = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    cum = np.concatenate([np.zeros((N, 1)), np.cumsum(segl, 1)], 1)
    total = cum[:, -1:] * frac[:, None]
    tq = np.linspace(0, 1, P)[None, :] * total
    out = np.empty_like(pts)
    for i in range(N):
        for c in range(3):
            out[i, :, c] = np.interp(tq[i], cum[i], pts[i, :, c])
    return out


def read_glb(path):
    # Positions and normals of the first primitive in a GLB written by Blender (non-interleaved accessors).
    import json
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    jlen = struct.unpack_from('<I', b, 12)[0]
    js = json.loads(b[20:20 + jlen])
    base = 20 + jlen + 8
    prim = js['meshes'][0]['primitives'][0]

    def acc(i):
        a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
        k = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = base + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(b, np.float32, a['count'] * k, off).reshape(a['count'], k).astype(np.float64)
    return acc(prim['attributes']['POSITION']), acc(prim['attributes']['NORMAL'])


def write_shell(path, length, direction):
    # Per-vertex undercoat for shell fur: length in 0.05 mm units and the combing direction (int8 xyz).
    N = len(length)
    rec = np.zeros((N, 4), np.int8)
    rec[:, 0] = np.clip(np.round(length / 0.00005), 0, 255).astype(np.uint8).view(np.int8)
    rec[:, 1:] = np.round(np.clip(direction, -1, 1) * 127).astype(np.int8)
    with open(path, 'wb') as f:
        f.write(b'KKS1')
        f.write(struct.pack('<I', N))
        f.write(rec.tobytes())


def to_srgb8(c):
    c = np.clip(c, 0, 1)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.round(s * 255).astype(np.uint8)


def write_kkf(path, pts, color_lin, ao, width, normal, rank=None, rng=None):
    # KKF2: roots as uint16 in the root bounds, then each later point as an int8 step from the previous one
    # (quantised with error feedback so steps never drift), then per-strand colour, AO, LOD rank, width, normal.
    N, P, _ = pts.shape
    roots = pts[:, 0].astype(np.float64)
    lo = roots.min(0) - 1e-5
    hi = roots.max(0) + 1e-5
    qr = np.round((roots - lo) / (hi - lo) * 65535).astype(np.uint16)
    cur = lo + qr.astype(np.float64) / 65535 * (hi - lo)
    scale = float(np.abs(np.diff(pts, axis=1)).max()) / 120.0
    steps = np.zeros((N, P - 1, 3), np.int8)
    for k in range(1, P):
        s = np.clip(np.round((pts[:, k] - cur) / scale), -127, 127)
        steps[:, k - 1] = s
        cur = cur + s * scale
    if rank is None:
        rank = (rng or np.random.default_rng(1)).random(N)
    with open(path, 'wb') as f:
        f.write(b'KKF2')
        f.write(struct.pack('<II', N, P))
        f.write(struct.pack('<7f', *lo, *hi, scale))
        f.write(qr.tobytes())
        f.write(steps.tobytes())
        f.write(to_srgb8(color_lin).tobytes())
        f.write(np.round(np.clip(ao, 0, 1) * 255).astype(np.uint8).tobytes())
        f.write(np.round(np.clip(rank, 0, 1) * 255).astype(np.uint8).tobytes())
        f.write(np.round(np.clip(width / 1e-5, 0, 255)).astype(np.uint8).tobytes())
        f.write(np.round(np.clip(normal, -1, 1) * 127).astype(np.int8).tobytes())
    return N * P


def bilinear(img, uv):
    h, w = img.shape[:2]
    x = np.clip(uv[:, 0] * (w - 1), 0, w - 1); y = np.clip(uv[:, 1] * (h - 1), 0, h - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = x - x0, y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def curves_object(name, pts_game, radius_root, colors_lin, g2b, tip_ratio=0.15):
    # Blender hair curves for Cycles previews of a groom.
    import bpy
    N, P, _ = pts_game.shape
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([P] * N)
    cv.attributes['position'].data.foreach_set('vector', g2b(pts_game).reshape(-1).astype(np.float32))
    t = np.linspace(0, 1, P)
    rad = (radius_root[:, None] * (1 - (1 - tip_ratio) * t[None, :])).reshape(-1).astype(np.float32)
    if 'radius' not in cv.attributes:
        cv.attributes.new('radius', 'FLOAT', 'POINT')
    cv.attributes['radius'].data.foreach_set('value', rad)
    col = cv.attributes.new('col', 'FLOAT_COLOR', 'CURVE')
    rgba = np.ones((N, 4), np.float32); rgba[:, :3] = colors_lin
    col.data.foreach_set('color', rgba.ravel())
    ob = bpy.data.objects.new(name, cv)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def hair_material(name='hair', roughness=0.35, coat=0.0):
    import bpy
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hb = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    hb.parametrization = 'COLOR'
    hb.inputs['Roughness'].default_value = roughness
    hb.inputs['Radial Roughness'].default_value = 0.5
    hb.inputs['Coat'].default_value = coat
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'col'
    nt.links.new(at.outputs['Color'], hb.inputs['Color'])
    nt.links.new(hb.outputs[0], out.inputs['Surface'])
    return m
