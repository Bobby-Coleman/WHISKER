# The kitten's tail, ears, hips, legs and paws: a skin mesh per rig part and groomed strand fur per part.
# Skins go to public/models/kitten_body.glb (part__skin__piece, each in its rig part's local space as in
# src/chars/kitten.ts, game coordinates, exported without axis conversion); strands to public/models/kitten_<part>.kkf.
# Fur stays clear of the plate: no roots under the cuisses, greaves or fauld, and strands are pushed outside them.
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
from scipy.spatial import cKDTree
import kk_blender as kb
import kk_armor as A
import kk_groom as G
from kk_sdf import ellipsoid, capsule, sphere, union, smin, smax, gradient, polygonize
from kitten_head_build import lin, ss, mix, wobble, COAT, COAT_DARK, CREAM, PUB

rng = np.random.default_rng(11)
INNER, INNER_DEEP, WHITE = lin('#c9a197'), lin('#9c7a70'), lin('#f1ebe4')
LOOK_FUR = dict(width=(0.00011, 0.00016))


def surface(sdf, lo, hi, step):
    v, f = polygonize(sdf, lo, hi, step)
    return v, gradient(sdf, v), f


def skin_object(name, sdf, lo, hi, step, color_fn, faces, shell_fn=None):
    # shell_fn(points, normals) -> (length m, direction): the undercoat drawn as shells in the game.
    v, f = polygonize(sdf, lo, hi, step)
    ob = A.recalc_normals(A._new_object(name, v, f))
    n0 = len(ob.data.polygons)
    if n0 > faces:
        dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = faces / n0
    A.finish(ob, subsurf=0)
    me = ob.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = col
    nrm = gradient(sdf, co)
    rgba = np.ones((len(co), 4), np.float32); rgba[:, :3] = color_fn(co, nrm)
    col.data.foreach_set('color', rgba.ravel())
    if shell_fn is not None:
        ln, dr = shell_fn(co, nrm)
        dr = G.tangent_project(np.broadcast_to(dr, co.shape).astype(float), nrm)
        a = me.attributes.new('_furLen', 'FLOAT', 'POINT'); a.data.foreach_set('value', np.asarray(ln, np.float32).ravel())
        b = me.attributes.new('_furDir', 'FLOAT_VECTOR', 'POINT'); b.data.foreach_set('vector', dr.astype(np.float32).ravel())
    return ob


def push_out(pts, sdf, min_off=0.0003):
    return G.collide(pts, sdf, lambda q: gradient(sdf, q), min_off)


def finish_groom(name, pts, col, nn, width, ao=None):
    rank = rng.random(len(pts))
    o = np.argsort(rank)
    ao = np.full(len(pts), 0.85) if ao is None else ao
    path = os.path.join(PUB, f'kitten_{name}.kkf')
    G.write_kkf(path, pts[o].astype(np.float32), col[o], ao[o], width[o], nn[o], rank=rank[o])
    print(f'{name}: {len(pts)} strands x {pts.shape[1]} points, {os.path.getsize(path)} bytes')


def hard_union(*fs):
    return lambda x, y, z: np.min([g(x, y, z) for g in fs], axis=0)


def angle_front(p):
    # Angle around the part's Y axis, 0 facing +Z (forward), as the plate lathes use.
    return np.arctan2(p[:, 0], p[:, 2])


# ---------------------------------------------------------------- tail
# Tail group space: root at the hips, curling back (-Z) and up (+Y) behind the cape.
TAIL_CTRL = np.array([(0, 0.0, 0.004), (0, 0.006, -0.024), (0, 0.018, -0.048), (0, 0.044, -0.068), (0, 0.075, -0.074), (0, 0.1, -0.066), (0, 0.117, -0.052)])


def tail_spine(n=72):
    # Centripetal-free uniform Catmull-Rom through the control points.
    P = np.vstack([TAIL_CTRL[:1] * 2 - TAIL_CTRL[1:2], TAIL_CTRL, TAIL_CTRL[-1:] * 2 - TAIL_CTRL[-2:-1]])
    out = []
    segs = len(TAIL_CTRL) - 1
    for i in range(segs):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        for t in np.linspace(0, 1, n // segs, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(TAIL_CTRL[-1])
    S = np.array(out)
    seg = np.linalg.norm(np.diff(S, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    return S, s


def tail_radius(s):
    return 0.0066 - 0.0026 * s


def tail_sdf():
    S, s = tail_spine()
    r = tail_radius(s)

    def f(x, y, z):
        d = np.full(np.shape(x), 1e9)
        for i in range(len(S) - 1):
            d = np.minimum(d, capsule(S[i], S[i + 1], r[i], r[i + 1])(x, y, z))
        return d
    return f


def groom_tail(count=15000, NP=8):
    sdf = tail_sdf()
    S, s_sp = tail_spine()
    v, n, f = surface(sdf, (-0.012, -0.012, -0.088), (0.012, 0.128, 0.016), 0.0005)
    tree = cKDTree(S)
    _, near = tree.query(v)
    s_v = s_sp[near]
    dens = lambda p: 1.0 + 0 * p[:, 0]
    mask = lambda p: 0.25 + 0.75 * ss(s_sp[tree.query(p)[1]], 0.02, 0.1)
    p, nn, ti, bary = G.sample_roots(v, n, f, dens, mask, count, rng)
    _, k = tree.query(p)
    s = s_sp[k]
    tang = S[np.minimum(k + 1, len(S) - 1)] - S[np.maximum(k - 1, 0)]
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    # Bottlebrush plume: fur sweeps toward the tip and stands well off the skin; the end hairs carry on past the tip.
    d = G.tangent_project(tang + 0.15 * nn, nn)
    tipz = ss(s, 0.9, 1.0)
    L = 0.0195 * (0.82 + 0.3 * s) * rng.uniform(0.75, 1.18, len(p)) * (0.55 + 0.45 * ss(s, 0.0, 0.12))
    lift = np.radians(52 - 25 * tipz + rng.normal(0, 8, len(p)))
    pts = G.grow(p, nn, d, L, lift, NP, rng, droop=0.22, lay=0.45, frizz=0.035, frizz_freq=1.6, wave=0.16, waves=rng.uniform(0.5, 1.1, len(p)))
    pts = G.clump(pts, p, 0.55, rng, guide_frac=0.05, radius=0.0045, power=1.3)
    pts = push_out(pts, sdf, 0.0004)
    # Pale underside (toward the body), faint darker bands, lighter toward the end.
    under = ss(nn @ np.array([0, -0.3, 1.0]) / 1.044, -0.2, 0.7)
    bands = (0.5 + 0.5 * np.cos(s * 2 * np.pi * 4.5 + 0.6 * wobble(p, 300.0))) ** 4 * (0.4 + 0.6 * (0.5 + 0.5 * wobble(p, 180.0)))
    col = mix(COAT, COAT_DARK, bands * 0.28 * (1 - under))
    col = mix(col, CREAM, 0.55 * under + 0.2 * tipz)
    col *= rng.uniform(0.92, 1.06, len(p))[:, None]
    width = rng.uniform(0.00022, 0.00034, len(p)) * (1 - 0.2 * tipz)
    finish_groom('tail', pts, col, nn, width)

    def skin(c, nrm):
        u = ss(nrm @ np.array([0, -0.3, 1.0]) / 1.044, -0.2, 0.7)
        return mix(COAT * 0.92, CREAM * 0.95, 0.5 * u)

    def shell(c, nrm):
        _, kk = tree.query(c)
        sv = s_sp[kk]
        tg = S[np.minimum(kk + 1, len(S) - 1)] - S[np.maximum(kk - 1, 0)]
        tg /= np.linalg.norm(tg, axis=1, keepdims=True)
        return 0.0105 * (0.75 + 0.35 * sv) * (0.35 + 0.65 * ss(sv, 0.0, 0.12)), tg + 0.3 * nrm
    return skin_object('tail__skin__tail', sdf, (-0.012, -0.012, -0.088), (0.012, 0.128, 0.016), 0.0008, skin, 2400, shell)


# ---------------------------------------------------------------- ears
# Ear group space: base at y = 0, tip at y = H, inner bowl facing +Z (the code ear used the same frame).
# Big, round-tipped kitten ears as in the reference: about a third of the face's width at the base, standing up
# out of the fluff and tilted out.
EW, EH, ECUP = 0.031, 0.025, 0.0066


def ear_shape(x, y):
    v = np.clip(y / EH, 0, 1)
    half = np.maximum(EW / 2 * np.maximum(1 - v ** 2.4, 0) ** 0.55, 1e-4)
    u = np.clip(x / half, -1, 1)
    zm = -ECUP * np.cos(u * np.pi / 2) * (1 - 0.72 * v)
    t = 0.0034 * (1 - v) ** 0.7 + 0.0009
    return v, half, u, zm, t


def ear_sdf():
    def f(x, y, z):
        v, half, u, zm, t = ear_shape(x, y)
        outline = np.where(y < EH, np.abs(x) - half, np.sqrt(x * x + (y - EH) ** 2))
        outline = np.maximum(outline, -(y + 0.006))
        slab = np.maximum(z - (zm + 0.0005), (zm - t) - z)
        return smax(outline, slab, 0.0011)
    return f


def groom_ear(NP=6):
    sdf = ear_sdf()
    lo, hi = (-0.019, -0.007, -0.012), (0.019, 0.029, 0.004)
    v, n, f = surface(sdf, lo, hi, 0.00022)
    shape = lambda p: ear_shape(p[:, 0], p[:, 1])
    vis = lambda p: ss(p[:, 1], -0.002, 0.003)
    # Back of the ear and its rim: short dense coat combed toward the tip.
    p, nn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], lambda q: vis(q) * (1 - ss(gradient(sdf, q)[:, 2], -0.05, 0.25)), 3400, rng)
    ev = shape(p)[0]
    d = G.tangent_project(np.array([0, 1.0, 0]) + 0.35 * np.sign(p[:, 0])[:, None] * np.array([1.0, 0, 0]), nn)
    L = (0.0032 + 0.0022 * (1 - ev)) * rng.uniform(0.8, 1.2, len(p))
    back = G.grow(p, nn, d, L, np.radians(20 + rng.normal(0, 5, len(p))), NP, rng, droop=0.0, lay=0.6, frizz=0.03, wave=0.06)
    bcol = mix(COAT, COAT_DARK, 0.25 * ss(ev, 0.4, 1.0)) * rng.uniform(0.92, 1.06, len(p))[:, None]
    bw = rng.uniform(0.00012, 0.00017, len(p))
    # Furnishings: long pale hairs curling up out of the bowl near the rims and the base.
    q, qn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0],
                                 lambda q: vis(q) * ss(gradient(sdf, q)[:, 2], 0.25, 0.5) * np.maximum(ss(np.abs(shape(q)[2]), 0.3, 0.7), 1 - ss(shape(q)[0], 0.2, 0.55)), 1700, rng)
    qv = shape(q)[0]
    dq = G.tangent_project(np.array([0, 1.0, 0.7]) - 0.4 * np.sign(q[:, 0])[:, None] * np.array([1.0, 0, 0]), qn)
    Lq = rng.uniform(0.0085, 0.0135, len(q)) * (1 - 0.3 * qv)
    furn = G.grow(q, qn, dq, Lq, np.radians(48 + rng.normal(0, 8, len(q))), NP, rng, droop=0.0, lay=0.3, frizz=0.05, wave=0.22, waves=rng.uniform(0.6, 1.2, len(q)))
    fcol = WHITE * rng.uniform(0.93, 1.03, len(q))[:, None]
    fw = rng.uniform(0.00007, 0.0001, len(q))
    # A small tuft at the tip.
    t, tn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], lambda q: ss(q[:, 1], EH - 0.005, EH - 0.002), 90, rng)
    dt_ = G.tangent_project(np.array([0, 1.0, 0.25]), tn)
    tuft = G.grow(t, tn, dt_, rng.uniform(0.004, 0.0065, len(t)), np.radians(30 + rng.normal(0, 6, len(t))), NP, rng, droop=0.0, lay=0.2, frizz=0.04, wave=0.1)
    tcol = mix(COAT, COAT_DARK, 0.35) * np.ones((len(t), 1))
    pts = np.concatenate([back, furn, tuft]); col = np.concatenate([bcol, fcol, tcol]); nn_all = np.concatenate([nn, qn, tn])
    width = np.concatenate([bw, fw, rng.uniform(0.00009, 0.00012, len(t))])
    pts = push_out(pts, sdf, 0.00025)
    finish_groom('ear', pts, col, nn_all, width)

    def skin(c, nrm):
        vv, half, uu, zm, th = ear_shape(c[:, 0], c[:, 1])
        front = ss(nrm[:, 2], -0.1, 0.3)
        bowl = mix(INNER, INNER_DEEP, (1 - ss(np.abs(uu), 0.0, 0.6)) * (1 - ss(vv, 0.0, 0.6)) * 0.6)
        bowl = mix(bowl, CREAM, ss(np.abs(uu), 0.7, 0.95) * 0.7)
        outer = mix(COAT * 0.92, COAT_DARK, 0.2 * ss(vv, 0.5, 1.0))
        return mix(outer, bowl, front)
    def shell(c, nrm):
        vv = ear_shape(c[:, 0], c[:, 1])[0]
        return 0.0022 * (1 - ss(nrm[:, 2], -0.1, 0.2)) * (1 - 0.4 * vv) * ss(c[:, 1], -0.002, 0.002), np.array([0, 1.0, 0])
    return skin_object('ear__skin__ear', sdf, lo, hi, 0.0003, skin, 2200, shell)


# ---------------------------------------------------------------- hips, thighs, shins, paws
def hips_sdf():
    return ellipsoid((0, -0.004, -0.004), (0.036, 0.026, 0.031))


def fauld_sdf():
    # Outer surface of the fauld lames (y 0.0055 .. -0.0245, r 0.047 .. 0.054, z scaled 0.82), open at the back.
    def f(x, y, z):
        r = np.sqrt(x * x + (z / 0.82) ** 2)
        rr = 0.0468 + (0.0536 - 0.0468) * np.clip((0.0055 - y) / 0.03, 0, 1) + 0.0012
        band = np.maximum(y - 0.0065, -0.0255 - y)
        return np.maximum(rr - r, band) + 1e9 * (np.abs(np.arctan2(x, z)) > np.radians(152))
    return f


def groom_hips(count=2600, NP=6):
    sdf = hips_sdf()
    lo, hi = (-0.04, -0.034, -0.04), (0.04, 0.026, 0.032)
    v, n, f = surface(sdf, lo, hi, 0.0006)
    mask = lambda p: (1 - ss(p[:, 1], -0.024, -0.016)) + ss(np.abs(angle_front(p)), np.radians(140), np.radians(160)) * (1 - ss(p[:, 1], -0.004, 0.006))
    p, nn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], lambda q: np.clip(mask(q), 0, 1), count, rng)
    d = G.tangent_project(np.array([0, -1.0, -0.35]) + 0 * p, nn)
    L = rng.uniform(0.0085, 0.0135, len(p))
    pts = G.grow(p, nn, d, L, np.radians(32 + rng.normal(0, 7, len(p))), NP, rng, droop=0.3, lay=0.55, frizz=0.04, wave=0.12)
    pts = G.clump(pts, p, 0.45, rng, guide_frac=0.06, radius=0.004)
    pts = push_out(pts, hard_union(sdf, fauld_sdf()), 0.0004)
    col = mix(COAT, CREAM, 0.45 + 0.4 * ss(-p[:, 1], 0.02, 0.03)) * rng.uniform(0.92, 1.05, len(p))[:, None]
    finish_groom('hips', pts, col, nn, rng.uniform(0.00018, 0.00026, len(p)))
    shell = lambda c, nr: (0.0072 * np.clip(mask(c), 0, 1), np.array([0, -1.0, -0.35]))
    return skin_object('pelvis__skin__hips', sdf, lo, hi, 0.001, lambda c, nr: mix(COAT * 0.95, CREAM * 0.95, 0.5) + 0 * c, 1600, shell)


def cuisse_sdf():
    # Thigh plate outer surface: y -0.0105 .. -0.0395, r 0.0214 .. 0.0174 (z scaled 1.06), +-105 degrees around the front.
    def f(x, y, z):
        r = np.sqrt(x * x + (z / 1.06) ** 2)
        rr = 0.0214 + (0.0174 - 0.0214) * np.clip((-0.0105 - y) / 0.029, 0, 1) + 0.0012
        band = np.maximum(y + 0.0095, -0.0405 - y)
        outside = np.abs(np.arctan2(x, z)) > np.radians(108)
        return np.where(outside, 1.0, np.maximum(rr - r, band))
    return f


def thigh_sdf():
    return capsule((0, 0.004, 0), (0, -0.048, 0.0), 0.0172, 0.0132)


def groom_thigh(count=4200, NP=7):
    sdf = thigh_sdf()
    lo, hi = (-0.022, -0.066, -0.022), (0.022, 0.024, 0.022)
    v, n, f = surface(sdf, lo, hi, 0.0005)
    a = lambda p: np.abs(angle_front(p))
    under_plate = lambda p: (a(p) < np.radians(112)) * (p[:, 1] < -0.008) * (p[:, 1] > -0.042)
    mask = lambda p: (1 - under_plate(p)) * ss(p[:, 1], -0.062, -0.056)
    p, nn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], mask, count, rng)
    back = ss(a(p), np.radians(100), np.radians(150))
    d = G.tangent_project(np.array([0, -1.0, 0]) + (-0.35 * back)[:, None] * np.array([0, 0, 1.0]), nn)
    L = (0.0058 + 0.0072 * back) * rng.uniform(0.8, 1.2, len(p))
    pts = G.grow(p, nn, d, L, np.radians(34 + 8 * back + rng.normal(0, 6, len(p))), NP, rng, droop=0.28, lay=0.55, frizz=0.035, wave=0.12)
    pts = G.clump(pts, p, 0.5, rng, guide_frac=0.06, radius=0.0035)
    pts = push_out(pts, hard_union(sdf, cuisse_sdf()), 0.0004)
    col = mix(COAT, CREAM, 0.5 + 0.2 * back) * rng.uniform(0.92, 1.05, len(p))[:, None]
    finish_groom('thigh', pts, col, nn, rng.uniform(0.00017, 0.00025, len(p)))

    def shell(c, nr):
        bk = ss(a(c), np.radians(100), np.radians(150))
        return (0.0042 + 0.0035 * bk) * (1 - under_plate(c)), np.array([0, -1.0, 0]) - 0.35 * bk[:, None] * np.array([0, 0, 1.0])
    return skin_object('thigh__skin__thigh', sdf, lo, hi, 0.0008, lambda c, nr: mix(COAT * 0.95, CREAM * 0.95, 0.55) + 0 * c, 1600, shell)


def shin_sdf():
    return capsule((0, 0.003, 0.001), (0, -0.047, 0.002), 0.0114, 0.0094)


def groom_shin(count=2000, NP=5):
    sdf = shin_sdf()
    lo, hi = (-0.016, -0.062, -0.016), (0.016, 0.018, 0.018)
    v, n, f = surface(sdf, lo, hi, 0.0004)
    covered = lambda p: ((p[:, 1] < -0.006) & (p[:, 1] > -0.0395)) | ((p[:, 1] > -0.008) & (p[:, 2] > 0.0) & (np.abs(angle_front(p)) < np.radians(80)))
    mask = lambda p: (1 - covered(p)) * ss(p[:, 1], -0.058, -0.052)
    p, nn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], mask, count, rng)
    d = G.tangent_project(np.array([0, -1.0, 0.1]) + 0 * p, nn)
    L = rng.uniform(0.0042, 0.0062, len(p))
    pts = G.grow(p, nn, d, L, np.radians(30 + rng.normal(0, 6, len(p))), NP, rng, droop=0.25, lay=0.6, frizz=0.03, wave=0.08)

    def plate(x, y, z):
        r = np.sqrt(x * x + (z / 1.1) ** 2)
        rr = 0.0152 + (0.0131 - 0.0152) * np.clip((-0.0075 - y) / 0.031, 0, 1) + 0.0011
        band = np.maximum(y + 0.0065, -0.0395 - y)
        return np.maximum(rr - r, band)
    pts = push_out(pts, hard_union(sdf, plate), 0.0003)
    col = mix(COAT, CREAM, 0.72) * rng.uniform(0.93, 1.05, len(p))[:, None]
    finish_groom('shin', pts, col, nn, rng.uniform(0.00014, 0.0002, len(p)))
    shell = lambda c, nr: (0.0032 * (1 - covered(c)), np.array([0, -1.0, 0.1]))
    return skin_object('shin__skin__shin', sdf, lo, hi, 0.0007, lambda c, nr: mix(COAT * 0.95, CREAM * 0.95, 0.7) + 0 * c, 1200, shell)


def paw_sdf():
    toes = [sphere((sx, -0.0088, 0.0205 - 0.0022 * abs(sx) / 0.0098), 0.0041) for sx in (-0.0098, -0.0034, 0.0034, 0.0098)]
    body = union(0.004, ellipsoid((0, -0.0062, 0.0085), (0.0108, 0.0072, 0.0162)), capsule((0, 0.006, -0.001), (0, -0.005, 0.0), 0.0086))
    toe_u = union(0.0016, *toes)

    def f(x, y, z):
        d = smin(body(x, y, z), toe_u(x, y, z), 0.003)
        return smax(d, -(y + 0.0138), 0.002)
    return f


def groom_paw(count=3600, NP=4):
    sdf = paw_sdf()
    lo, hi = (-0.017, -0.016, -0.014), (0.017, 0.016, 0.03)
    v, n, f = surface(sdf, lo, hi, 0.0003)
    mask = lambda p: ss(p[:, 1], -0.0128, -0.0112)
    p, nn, _, _ = G.sample_roots(v, n, f, lambda q: 1 + 0 * q[:, 0], mask, count, rng)
    d = G.tangent_project(np.array([0, -0.45, 1.0]) + 0 * p, nn)
    front = ss(p[:, 2], 0.014, 0.022)
    L = (0.0028 + 0.0016 * front) * rng.uniform(0.8, 1.2, len(p))
    pts = G.grow(p, nn, d, L, np.radians(26 + rng.normal(0, 6, len(p))), NP, rng, droop=0.15, lay=0.5, frizz=0.03, wave=0.05)
    pts = push_out(pts, sdf, 0.0002)
    col = mix(CREAM, WHITE, 0.6) * rng.uniform(0.94, 1.03, len(p))[:, None]
    finish_groom('paw', pts, col, nn, rng.uniform(0.00013, 0.00018, len(p)))
    shell = lambda c, nr: (0.0026 * mask(c), np.array([0, -0.45, 1.0]))
    return skin_object('foot__skin__paw', sdf, lo, hi, 0.0004, lambda c, nr: mix(CREAM, WHITE, 0.4) * 0.95 + 0 * c, 1600, shell)


if __name__ == '__main__':
    kb.reset()
    t = time.time()
    obs = []
    for fn in (groom_tail, groom_ear, groom_hips, groom_thigh, groom_shin, groom_paw):
        t1 = time.time()
        obs.append(fn())
        print(fn.__name__, round(time.time() - t1, 1), 's')
    A.export_glb(os.path.join(PUB, 'kitten_body.glb'), obs, attributes=True)
    for o in obs:
        print(o.name, len(o.data.polygons), 'faces')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'kitten_body.blend'))
    print('total', round(time.time() - t, 1), 's')
