# The human knight's hero metal and boots: a riveted great helm with a real eye slit, breaths and a cruciform
# strap, a ridged breastplate with rolled edges and backplate, embossed tassets, couters, vambraces, gauntlets,
# tall creased boots and the big sword. Cloth layers (gambeson, sleeves, skirt, trousers) stay in the game.
# Each piece is modelled in its rig part's local space (src/chars/knight.ts) and exported to
# public/models/knight_armor.glb as part__material__piece.
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
import kk_blender as kb
import kk_armor as A
from kitten_armor import ss, smooth_profile, plate, dome, blade, guard, grip, pommel, loft, PUB
from kk_sdf import ellipsoid, capsule, union, smin, polygonize

T = 0.0022          # plate thickness
BEV = 0.0007
RR = 0.0032         # rolled-edge tube radius
HIP_SX, HIP_SZ = 1.18, 0.72


def kplate(name, prof, rolls=(), **kw):
    kw.setdefault('thick', T); kw.setdefault('bevel', BEV); kw.setdefault('rr', RR)
    return plate(name, prof, rolls=rolls, **kw)


def edge_offset(pts, sx, sz, out=0.35):
    # Nudge boundary points outward from the body axis so a rolled-edge tube sits on the outer face.
    P = np.array(pts, float)
    rad = np.stack([P[:, 0] / sx ** 2, np.zeros(len(P)), P[:, 2] / sz ** 2], 1)
    rad /= np.linalg.norm(rad, axis=1, keepdims=True) + 1e-12
    return P + rad * RR * out


def panel(name, V, rolls=('first', 'last', 'left', 'right'), sx=1.0, sz=1.0, thick=T, rr=RR):
    ob = A.grid_object(name, V)
    A.finish(ob, thick=thick, bevel=BEV, subsurf=0)
    parts = [ob]
    edges = {'first': V[0], 'last': V[-1], 'left': V[:, 0], 'right': V[:, -1]}
    for k in rolls:
        parts.append(A.sweep_tube(f'{name}_{k}', edge_offset(edges[k], sx, sz), rr, ring=8))
    return A.join(name, parts)


def rivet_at(name, p, sx=1.0, sz=1.0, radius=0.0042):
    p = np.asarray(p, float)
    n = np.array([p[0] / sx ** 2, 0.0, p[2] / sz ** 2]); n /= np.linalg.norm(n)
    rv = A.rivet(name, p + n * 0.0012, n, radius=radius)
    A.finish(rv, subsurf=0)
    return rv


# ---------------------------------------------------------------- chest
def breastplate():
    prof = smooth_profile([(-0.045, 0.168), (0.02, 0.172), (0.1, 0.18), (0.2, 0.19), (0.29, 0.183), (0.35, 0.16), (0.395, 0.112)], per=4)
    span = lambda y, t: 1.5 - 0.22 * ss(y, 0.3, 0.395)

    def deform(V, P):
        x, y, z = V[..., 0], V[..., 1], V[..., 2]
        ridge = 0.008 * np.exp(-(x / 0.03) ** 2) * ss(y, 0.02, 0.16) * (1 - ss(y, 0.3, 0.37))
        V[..., 2] = z * (1 + 0.1 * np.exp(-((y - 0.17) ** 2) / 0.012)) + ridge
        return V
    V = A.panel_grid(prof, span, segs=56, sz=0.72, deform=deform)
    ob = panel('breast', V, sz=0.72)
    rv = [rivet_at(f'br_rv{i}', V[r, c], sz=0.72) for i, (r, c) in enumerate([(2, 3), (2, 52), (len(V) - 4, 4), (len(V) - 4, 51)])]
    return A.join('chest__chestplate__breastplate', [ob] + rv)


def backplate():
    prof = smooth_profile([(-0.02, 0.165), (0.1, 0.176), (0.22, 0.184), (0.31, 0.176), (0.365, 0.14)], per=4)
    V = A.panel_grid(prof, lambda y, t: 1.7, lambda y, t: np.pi, segs=56, sz=0.69)
    return A.join('chest__plate__backplate', [panel('back', V, sz=0.69)])


# ---------------------------------------------------------------- pelvis
def tasset(side):
    # Long front plate per side, flaring toward mid-thigh, with three embossed lame lines and a rolled hem.
    prof = smooth_profile([(0.1, 0.152), (0.04, 0.163), (-0.06, 0.181), (-0.21, 0.203)], per=5)
    span = lambda y, t: 0.85 + 0.5 * t
    center = lambda y, t: side * ((0.85 + 0.5 * t) / 2 - 0.03)

    def deform(V, P):
        M = V.shape[0]
        t = np.linspace(0, 1, M)[:, None]
        bump = 0.006 * np.sin(t * np.pi) + sum(0.0022 * np.exp(-((t - c) / 0.025) ** 2) for c in (0.3, 0.54, 0.77))
        rad = np.stack([V[..., 0] / HIP_SX ** 2, 0 * V[..., 1], V[..., 2] / HIP_SZ ** 2], -1)
        rad /= np.linalg.norm(rad, axis=-1, keepdims=True)
        return V + rad * bump[..., None]
    V = A.panel_grid(prof, span, center, segs=24, sx=HIP_SX, sz=HIP_SZ, deform=deform)
    ob = panel('tasset', V, rolls=('last', 'left', 'right'), sx=HIP_SX, sz=HIP_SZ, thick=0.002)
    rv = [rivet_at(f'ts_rv{i}', V[2, c], sx=HIP_SX, sz=HIP_SZ) for i, c in enumerate((2, 21))]
    out = A.join('pelvis__tasset__tasset' + ('L' if side > 0 else 'R'), [ob] + rv)
    return out


# ---------------------------------------------------------------- helm
def helm():
    sx, sz = 0.92, 1.05
    parts = []
    lower = kplate('helm_lower', [(0.0, 0.117), (0.04, 0.119), (0.08, 0.12), (0.12, 0.1205), (0.164, 0.121)],
                   rolls=('top', 'bottom'), sx=sx, sz=sz, segs=64, rr=0.0028)
    upper = kplate('helm_upper', [(0.178, 0.121), (0.22, 0.121), (0.245, 0.119), (0.262, 0.112), (0.272, 0.098), (0.276, 0.07), (0.277, 0.0)],
                   rolls=('top',), sx=sx, sz=sz, segs=64, rr=0.0028)
    # Behind the eye slit (outside the front +-54 degrees) a band closes the gap.
    band = kplate('helm_band', [(0.163, 0.121), (0.179, 0.121)], sx=sx, sz=sz, segs=48, a0=np.pi * 0.3, a1=np.pi * 1.7)
    # Brow reinforcement over the slit, standing a little proud.
    brow = kplate('helm_brow', [(0.179, 0.1245), (0.193, 0.1245)], rolls=('top', 'bottom'), sx=sx, sz=sz, segs=40,
                  a0=-np.pi * 0.32, a1=np.pi * 0.32, rr=0.0022, thick=0.002)
    parts += [lower, upper, band, brow]
    # Cruciform strap down the face, riveted.
    for (y0, y1) in ((0.012, 0.161), (0.196, 0.256)):
        prof = [(y, 0.1258 if y < 0.25 else 0.118) for y in np.linspace(y0, y1, 8)]
        strap = kplate('helm_strap', prof, sx=sx, sz=sz, segs=6, a0=-0.1, a1=0.1, thick=0.002, smooth=False)
        parts.append(strap)
        for y in np.linspace(y0 + 0.012, y1 - 0.012, 3):
            parts.append(rivet_at('helm_srv', (0, y, 0.1258 * sz + 0.0015), sx=sx, sz=sz, radius=0.0036))
    # Rivets around the lower rim and the top.
    for a in np.linspace(0, 2 * np.pi, 18, endpoint=False):
        if abs(np.angle(np.exp(1j * a))) < 0.15:
            continue
        parts.append(rivet_at('helm_rv', (0.121 * np.sin(a) * sx, 0.016, 0.121 * np.cos(a) * sz), sx=sx, sz=sz, radius=0.0034))
        parts.append(rivet_at('helm_rvt', (0.121 * np.sin(a) * sx, 0.236, 0.121 * np.cos(a) * sz), sx=sx, sz=sz, radius=0.0034))
    metal = A.join('head__helm__helm', parts)
    # Breaths: dark holes punched low on the wearer's right of the face.
    holes = []
    for r in range(3):
        for c in range(3):
            a = 0.33 + c * 0.12; y = 0.055 + r * 0.03
            bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.0042, depth=0.014, location=(0, 0, 0))
            h = bpy.context.active_object
            n = np.array([-np.sin(a) / sx, 0, np.cos(a) / sz]); n /= np.linalg.norm(n)
            p = np.array([-np.sin(a) * 0.121 * sx, y, np.cos(a) * 0.121 * sz])
            z = np.array([0, 0, 1.0]); v = np.cross(z, n); s = np.linalg.norm(v); cth = z @ n
            vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
            R = np.eye(3) + vx + vx @ vx * ((1 - cth) / s ** 2)
            M = np.eye(4); M[:3, :3] = R; M[:3, 3] = p + n * 0.0003
            A.transform(h, M)
            holes.append(h)
    dark = A.join('head__dark__breaths', holes)
    lining = A.lathe('head__dark__lining', [(0.004, 0.108), (0.25, 0.108), (0.262, 0.0)], segs=40, sx=0.9, sz=1.02)
    return [metal, dark, lining]


# ---------------------------------------------------------------- arms and hands
def arm_pieces():
    cop = dome('farm_cop', 0.03, 0.046, apex_axis=(0, 0, 1), center=(0, -0.005, 0.012), roll_rr=0.0026, thick=T, bevel=BEV, segs=40)
    wing = kplate('farm_wing', [(0.0, 0.03), (-0.004, 0.034)], rolls=('bottom',), segs=24, a0=-0.9, a1=0.9, rr=0.0024)
    A.transform(wing, A.mat4(t=(0.0, -0.005, 0.03), rx=np.pi / 2))
    couter = A.join('farm__plate__couter', [cop, wing])
    vamb = kplate('farm__plate__vambrace', [(-0.035, 0.0465), (-0.1, 0.0448), (-0.2, 0.0372), (-0.252, 0.0335)],
                  rolls=('top', 'bottom'), sz=1.08, segs=48, rr=0.0028)
    rv = []
    for y in (-0.06, -0.15, -0.23):
        r = np.interp(-y, [0.035, 0.1, 0.2, 0.252], [0.0465, 0.0448, 0.0372, 0.0335])
        rv.append(rivet_at('vb_rv', (r, y, 0.0), sz=1.08, radius=0.0032))
    vamb = A.join('farm__plate__vambrace', [vamb] + rv)
    return [couter, vamb]


def rbox(c, h, r):
    c = np.asarray(c); h = np.asarray(h)

    def f(x, y, z):
        qx = np.abs(x - c[0]) - h[0] + r; qy = np.abs(y - c[1]) - h[1] + r; qz = np.abs(z - c[2]) - h[2] + r
        out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - r
    return f


def gauntlet():
    # Flared plate cuff, then a fist: back-of-hand plate, finger lames (ridges) and a thumb.
    cuff = kplate('hand_cuff', [(0.03, 0.046), (0.008, 0.039), (-0.02, 0.0345)], rolls=('top',), segs=48, rr=0.0028)
    s = 1
    base = union(0.012,
                 capsule((0, 0.0, 0), (0, -0.04, 0.004), 0.032, 0.029),
                 rbox((0, -0.068, 0.004), (0.033, 0.024, 0.024), 0.017),
                 capsule((-0.028 * s, -0.045, 0.016), (-0.032 * s, -0.068, -0.01), 0.0105))

    def f(x, y, z):
        d = base(x, y, z)
        # Finger lames: raised bands across the fingers; a plate edge where the back of the hand begins.
        lam = 0.0014 * np.clip(np.sin((y + 0.05) * 230), 0, 1) ** 0.6 * (y < -0.052)
        return d - lam - 0.0008 * (y > -0.05) * (y < -0.046)
    v, fcs = polygonize(f, (-0.07, -0.13, -0.06), (0.07, 0.04, 0.06), 0.0014)
    hand = A.recalc_normals(A._new_object('hand_fist', v, fcs))
    dec = hand.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.25
    A.finish(hand, subsurf=0)
    g = A.join('hand__plate__gauntletL', [cuff, hand])
    return [g, A.mirror_x(g, 'hand__plate__gauntletR')]


def ellipse2(x, z, rx, rz):
    k0 = np.sqrt((x / rx) ** 2 + (z / rz) ** 2)
    k1 = np.sqrt((x / rx ** 2) ** 2 + (z / rz ** 2) ** 2) + 1e-9
    return k0 * (k0 - 1.0) / k1


def boot_foot_sdf():
    # A boot built like a shoe last: a plan outline (heel cup, waist, rounded toe) extruded and intersected with
    # a side profile (ankle, sloping instep, domed toe box), edges rounded by a smooth max; then a welted sole 4 mm
    # proud of the upper, toe spring, an ankle column that tucks inside the shaft, and flex creases.
    # Ankle at the origin, ground at y = -0.077, toe toward +Z.
    from scipy.interpolate import PchipInterpolator
    from kk_sdf import smax
    top = PchipInterpolator([-0.09, -0.045, -0.015, 0.02, 0.06, 0.1, 0.14, 0.17, 0.2, 0.225], [-0.006, -0.002, 0.05, 0.055, 0.014, -0.006, -0.02, -0.029, -0.038, -0.045])

    def plan(x, z):
        heel = np.sqrt(x * x + (z + 0.03) ** 2) - 0.037
        h = np.clip((z + 0.03) / 0.15, 0, 1)
        waist = np.sqrt(x * x + (z - (-0.03 + 0.15 * h)) ** 2) - (0.039 + 0.01 * h)
        toe = ellipse2(x, z - 0.13, 0.048, 0.085)
        return smin(smin(heel, waist, 0.02), toe, 0.03)

    def f(x, y, z):
        spring = 0.008 * np.clip((z - 0.14) / 0.075, 0, 1) ** 2
        yy = y - spring
        t = top(np.clip(z, -0.09, 0.225)) - 0.45 * x * x / 0.05
        upper = smax(plan(x, z), smax(yy - t, -0.069 - yy, 0.004), 0.016)
        # Ankle column: as wide as the heel cup below, narrowing to slip inside the shaft above y = 0.
        s = np.clip((y + 0.035) / 0.045, 0, 1)
        ankle = smax(ellipse2(x, z + 0.004 * (1 - s), 0.0495 - 0.005 * s, 0.0555 - 0.0065 * s), y - 0.04, 0.008)
        upper = smin(upper, ankle, 0.012)
        # Soft flex creases across the instep and shallow folds where the foot meets the shaft.
        vamp = np.clip(np.sin((z - 0.07) * 300 + 2.0 * np.sin(x * 40)), 0, 1) ** 3 * np.exp(-((z - 0.09) / 0.02) ** 2)
        fold = np.clip(np.sin(y * 330 + 2.0 * np.sin(np.arctan2(x, z) * 3)), 0, 1) ** 3 * np.exp(-((y + 0.008) / 0.012) ** 2) * (z > -0.01)
        upper = upper + 0.0007 * vamp * (yy > t - 0.02) + 0.0009 * fold
        sole = smax(plan(x, z) - 0.004, smax(yy + 0.065, -0.077 - yy, 0.0015), 0.0025)
        return np.minimum(upper, sole)
    return f


# ---------------------------------------------------------------- boots
def boots():
    prof = smooth_profile([(-0.07, 0.066), (-0.14, 0.066), (-0.25, 0.057), (-0.37, 0.048), (-0.44, 0.051)], per=8)

    def deform(V, P, th):
        y = V[..., 1]
        a = np.arctan2(V[..., 0], V[..., 2])
        # Ankle creases, a back seam and slight unevenness in the leather.
        crease = np.clip(np.sin(y * 150 + 0.7 * np.sin(a * 2)), 0, 1) ** 2 * ss(-y, 0.31, 0.36) * (1 - ss(-y, 0.42, 0.44))
        seam = np.exp(-((np.abs(a) - np.pi) / 0.05) ** 2)
        k = 1 + (0.035 * crease + 0.012 * seam + 0.006 * np.sin(a * 5 + y * 40))
        V[..., 0] *= k; V[..., 2] *= k
        return V
    shaft = A.lathe('shin_shaft', prof, segs=48, sz=1.1, deform=deform)
    A.finish(shaft, thick=0.003, bevel=0.001, subsurf=0)
    cuff = A.lathe('shin_cuff', smooth_profile([(-0.066, 0.068), (-0.075, 0.073), (-0.11, 0.071), (-0.116, 0.067)], per=4), segs=48, sz=1.1)
    A.finish(cuff, thick=0.003, bevel=0.001, subsurf=0)
    shin = A.join('shin__boot__boot', [shaft, cuff])
    foot = A.recalc_normals(A._new_object('foot__bootfoot__boot', *polygonize(boot_foot_sdf(), (-0.07, -0.082, -0.085), (0.07, 0.06, 0.235), 0.002)))
    dec = foot.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.22
    A.finish(foot, subsurf=0)
    return [shin, foot]


if __name__ == '__main__':
    kb.reset()
    allobs = [breastplate(), backplate(), tasset(1), tasset(-1)] + helm() + arm_pieces() + gauntlet() + boots() + [
        blade(length=1.25, base=0.012, w0=0.072, w1=0.052, t0=0.012, t1=0.007, point=0.16, fuller=0.72, name='sword__steel__blade'),
        guard(k=3.6, half=0.15, name='sword__plate__guard'),
        grip(k=3.3, length=0.27, name='sword__leather__grip'),
        pommel(k=4.6, y=-0.3, name='sword__plate__pommel'),
    ]
    groups = {}
    for o in allobs:
        groups.setdefault(o.name.split('__')[0], []).append(o)
    for gname, obs in groups.items():
        for o in allobs:
            o.hide_render = o not in obs
        for o in obs:
            A.vertex_masks(o, ao_distance=0.035, samples=32, edge_radius=0.006)
    for o in allobs:
        o.hide_render = False
    A.export_glb(os.path.join(PUB, 'knight_armor.glb'), allobs)
    for o in allobs:
        print(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'knight_armor.blend'))
