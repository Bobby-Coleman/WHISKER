# The kitten's miniature plate and sword as hero meshes: lathed plates with real thickness, rolled edges, lames
# and rivets, a fullered blade, a brass guard and wheel pommel, a leather-wrapped grip.
# Every piece is modelled in the local space of the rig part that carries it (see src/chars/kitten.ts):
# chest and pelvis are Y-up with +Z forward; arm and leg parts extend along -Y from their joint.
# Writes public/models/kitten_armor.glb; object names are part__material__piece.
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
import kk_blender as kb
import kk_armor as A

PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')
T = 0.0006          # plate thickness at kitten scale
BEV = 0.00018


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smooth_profile(prof, per=2):
    # Catmull-Rom through the control points (ends clamped), so plates are smooth without subdivision.
    P = np.asarray(prof, float)
    if len(P) < 3:
        return [tuple(p) for p in P]
    Q = np.vstack([P[0], P, P[-1]])
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for t in np.linspace(0, 1, per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return [tuple(p) for p in out]


def plate(name, prof, rolls=(), thick=T, sx=1.0, sz=1.0, deform=None, a0=0.0, a1=2 * np.pi, segs=48, rr=0.0009, smooth=True, bevel=None):
    # A lathed plate plus rolled edges at the given profile ends ('top' = first point, 'bottom' = last).
    ob = A.lathe(name, smooth_profile(prof) if smooth else prof, segs=segs, sx=sx, sz=sz, deform=deform, a0=a0, a1=a1)
    A.finish(ob, thick=thick, bevel=BEV if bevel is None else bevel, subsurf=0)
    parts = [ob]
    for which in rolls:
        y, r = prof[0] if which == 'top' else prof[-1]
        rl = A.roll(name + '_roll' + which, y, r, rr, segs=segs, sx=sx, sz=sz, deform=deform, a0=a0, a1=a1, ring=8)
        A.finish(rl, subsurf=0)
        parts.append(rl)
    return A.join(name, parts) if len(parts) > 1 else ob


def dome(name, h, r, apex_axis=(0, 1, 0), center=(0, 0, 0), base=-0.0, sx=1.0, sz=1.0, roll_rr=0.0008, thick=T, bevel=None, segs=32):
    # Spherical-ish cap of height h over base radius r, rolled at its rim, pointing along apex_axis.
    ts = np.linspace(0, 1, 9)
    prof = [(base + h * (1 - t * t), r * np.sin(t * np.pi / 2) ** 0.85) for t in ts]
    prof[0] = (base + h, 0.0)
    ob = plate(name, prof, rolls=('bottom',), sx=sx, sz=sz, rr=roll_rr, segs=segs, smooth=False, thick=thick, bevel=bevel)
    a = np.asarray(apex_axis, float); a /= np.linalg.norm(a)
    y = np.array([0, 1.0, 0])
    v = np.cross(y, a); s = np.linalg.norm(v); c = y @ a
    if s < 1e-8:
        R = np.eye(3) if c > 0 else np.diag([1, -1, -1.0])
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + vx + vx @ vx * ((1 - c) / s ** 2)
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = center
    return A.transform(ob, M)


def rivets_on(name, prof_point, angles, sx=1.0, sz=1.0, lift=0.0004, radius=0.0009):
    y, r = prof_point
    out = []
    for k, a in enumerate(angles):
        p = np.array([r * np.sin(a) * sx, y, r * np.cos(a) * sz])
        n = np.array([np.sin(a) * sz, 0.0, np.cos(a) * sx]); n /= np.linalg.norm(n)
        out.append(A.rivet(f'{name}_{k}', p + n * lift, n, radius=radius))
    return out


# ---------------------------------------------------------------- chest
def cuirass():
    # After the reference: a breastplate that stands nearly upright from mid-chest to the waist (so it mirrors the
    # bright horizon rather than the ground), rounding over the shoulders at the top.
    prof = [(0.093, 0.0305), (0.089, 0.0348), (0.081, 0.043), (0.069, 0.0492), (0.053, 0.0527), (0.037, 0.0529),
            (0.021, 0.0522), (0.009, 0.0512), (0.001, 0.0506), (-0.004, 0.0512)]

    def deform(V, P, th):
        x, y, z = V[..., 0], V[..., 1], V[..., 2]
        front = ss(z, 0.0, 0.02)
        # Medial ridge down the breastplate and a soft forward swell at mid-chest.
        keel = 0.0026 * np.exp(-(x / 0.0095) ** 2) * ss(y, 0.002, 0.026) * (1 - ss(y, 0.072, 0.089))
        swell = 1 + 0.06 * np.exp(-((y - 0.045) ** 2) / 0.0012)
        V[..., 2] = np.where(z > 0, z * swell + keel * front, z)
        return V
    body = plate('chest__plate__cuirass', prof, rolls=('top', 'bottom'), sz=0.84, deform=deform, rr=0.001)
    # Rivets along the waist and a pair at the neck.
    rv = rivets_on('cuirass_rv', (0.004, 0.051), [-1.0, -0.45, 0.45, 1.0, np.pi - 0.6, np.pi + 0.6], sz=0.84)
    rv += rivets_on('cuirass_rvn', (0.086, 0.0385), [-0.7, 0.7], sz=0.84)
    for o in rv:
        A.finish(o, subsurf=0)
    return A.join('chest__plate__cuirass', [body] + rv)


def pauldron(side):
    # Dome over the shoulder and three lames down the upper arm, open toward the neck.
    # Large, rounded pauldrons as in the reference: a deep dome and four lames down the upper arm.
    parts = [dome('pd_dome', 0.0245, 0.0322, base=-0.003, sz=1.05, roll_rr=0.0011)]
    a0, a1 = np.radians(-50), np.radians(230)     # lames wrap front, outside and back (angle 90 deg = +X)
    for k, (yt, rt, yb, rb) in enumerate([(-0.0015, 0.031, -0.0095, 0.0321), (-0.0085, 0.0301, -0.0165, 0.031),
                                          (-0.0155, 0.0291, -0.0235, 0.0297), (-0.0225, 0.0281, -0.0298, 0.0284)]):
        prof = [(yt, rt), ((yt + yb) / 2, (rt + rb) / 2 + 0.0004), (yb, rb)]
        lame = plate(f'pd_lame{k}', prof, rolls=('bottom',), a0=a0, a1=a1, sz=1.05, segs=40, rr=0.0008)
        parts.append(lame)
        for a in (a0 + 0.12, a1 - 0.12):
            y = yt + (yb - yt) * 0.45; r = rt + 0.0006
            p = np.array([r * np.sin(a), y, r * np.cos(a) * 1.05]); n = np.array([np.sin(a), 0.0, np.cos(a)])
            rv = A.rivet(f'pd_rv{k}{a:.2f}', p + n * 0.0003, n, radius=0.0008)
            A.finish(rv, subsurf=0)
            parts.append(rv)
    ob = A.join('pd', parts)
    # Into chest space: the shoulder joint sits at (0.047, 0.072, 0); the dome is tilted out over the arm.
    A.transform(ob, A.mat4(t=(0.047, 0.073, -0.002), rz=-0.42))
    if side < 0:
        A.transform(ob, np.diag([-1.0, 1, 1, 1]))
    ob.name = ob.data.name = 'chest__plate__pauldron' + ('L' if side > 0 else 'R')
    return ob


# ---------------------------------------------------------------- pelvis
def belt_and_fauld():
    out = []
    belt = A.lathe('pelvis__leather__belt', [(0.0135, 0.0516), (0.0045, 0.052)], segs=48, sz=0.84)
    A.finish(belt, thick=0.0009, bevel=0.0002, subsurf=0)
    out.append(belt)
    # Brass buckle: a small square frame at the front.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0042, minor_radius=0.0009, major_segments=4, minor_segments=8,
                                     location=(0, 0, 0))
    bk = bpy.context.active_object
    A.transform(bk, A.mat4(t=(0.0, 0.009, 0.052 * 0.84 + 0.0012), rz=np.pi / 4))
    A.finish(bk, bevel=0.0002, subsurf=0)
    bk.name = bk.data.name = 'pelvis__brass__buckle'
    out.append(bk)
    # Fauld: three lames flaring over the hips, open at the back for the tail.
    a0, a1 = np.radians(-150), np.radians(150)
    lames = []
    for k, (yt, rt, yb, rb) in enumerate([(0.0055, 0.052, -0.0065, 0.0546), (-0.0035, 0.0536, -0.0155, 0.0562),
                                          (-0.0125, 0.0552, -0.0245, 0.0582)]):
        prof = [(yt, rt), ((yt + yb) / 2, (rt + rb) / 2 + 0.0005), (yb, rb)]
        lames.append(plate(f'fauld{k}', prof, rolls=('bottom',), a0=a0, a1=a1, sz=0.82, segs=48, rr=0.0008))
        for o in rivets_on(f'fauld_rv{k}', ((yt + yb) / 2, (rt + rb) / 2 + 0.0008), [-1.1, 1.1, -2.4, 2.4], sz=0.82, radius=0.0008):
            A.finish(o, subsurf=0)
            lames.append(o)
    # Tassets: two lames over the front of each thigh, hanging from the fauld in front of the mail skirt.
    for s in (-1, 1):
        c = s * 0.5
        for k, (yt, rt, yb, rb) in enumerate([(-0.0225, 0.0588, -0.0385, 0.0612), (-0.0355, 0.0605, -0.0515, 0.0628)]):
            prof = [(yt, rt), ((yt + yb) / 2, (rt + rb) / 2 + 0.0006), (yb, rb)]
            lames.append(plate(f'tasset{s}{k}', prof, rolls=('bottom',), a0=c - 0.42, a1=c + 0.42, sz=0.84, segs=24, rr=0.0008))
    out.append(A.join('pelvis__plate__fauld', lames))
    return out


# ---------------------------------------------------------------- arms
def arm_pieces():
    # Arm lengths follow the rig (src/chars/kitten.ts): upper arm 0.046, forearm 0.062.
    rere = plate('uarm__plate__rerebrace', [(-0.0075, 0.0139), (-0.024, 0.0135), (-0.0405, 0.0125)],
                 rolls=('top', 'bottom'), segs=36, rr=0.0007)
    # Elbow cop: a dome over the point of the elbow (+Z faces the pole) with a band around the joint.
    cop = dome('farm_cop', 0.0085, 0.0138, apex_axis=(0, 0, 1), center=(0, 0, 0.003), roll_rr=0.0007)
    band = plate('farm_band', [(0.004, 0.0136), (-0.004, 0.0138)], rolls=('bottom',), segs=36, rr=0.0006)
    couter = A.join('farm__plate__couter', [cop, band])
    vamb = plate('farm__plate__vambrace', [(-0.0055, 0.0131), (-0.031, 0.0126), (-0.0565, 0.0112)],
                 rolls=('top', 'bottom'), segs=36, rr=0.0007)
    # Mitten gauntlet: a flared cuff and a plated paw in three lames.
    cuff = plate('hand_cuff', [(0.0065, 0.0146), (0.0015, 0.0131), (-0.0045, 0.0125)], rolls=('top',), segs=36, rr=0.0007)
    lames = []
    for k, (yt, yb) in enumerate([(-0.003, -0.0105), (-0.0095, -0.0165), (-0.0155, -0.0262)]):
        ys = np.linspace(yt, yb, 5)
        # Paw outline: widest across the knuckles, closing at the tip.
        r = lambda y: 0.0132 * np.sqrt(np.clip(1 - ((y + 0.011) / 0.0155) ** 2, 0.02, 1))
        prof = [(y, r(y) + 0.0003 * k) for y in ys]
        if k == 2:
            prof[-1] = (yb, 0.0)
        lames.append(plate(f'hand_lame{k}', prof, rolls=('top',) if k else (), sx=1.06, sz=0.84, segs=32, rr=0.0006))
    gaunt = A.join('hand__plate__gauntlet', [cuff] + lames)
    return [rere, couter, vamb, gaunt]


# ---------------------------------------------------------------- legs
def leg_pieces():
    a0, a1 = np.radians(-105), np.radians(105)
    cuisse = plate('thigh__plate__cuisse', [(-0.0105, 0.0214), (-0.025, 0.0206), (-0.0395, 0.0174)], rolls=('top', 'bottom'),
                   a0=a0, a1=a1, sz=1.06, segs=36, rr=0.0007)
    cop = dome('poleyn_cop', 0.0085, 0.0152, apex_axis=(0, 0, 1), center=(0, 0, 0.004), roll_rr=0.0007)
    # Fan-shaped side wing on the outside of the knee (both sides: the left and right shins share the piece).
    wings = [dome(f'poleyn_wing{s}', 0.0035, 0.0105, apex_axis=(s, 0, 0.35), center=(s * 0.0105, 0.0005, 0.0045), roll_rr=0.0006, sz=1.25) for s in (-1, 1)]
    poleyn = A.join('shin__plate__poleyn', [cop] + wings)
    # Greave down to the ankle (the shin is 0.048 long), barely tapered and flaring a little over the instep, so its
    # faces stand upright and mirror the misty horizon rather than the ground.
    greave = plate('shin__plate__greave', [(-0.0075, 0.015), (-0.022, 0.0149), (-0.036, 0.0138), (-0.0445, 0.0134), (-0.049, 0.014)],
                   rolls=('top', 'bottom'), sz=1.1, segs=36, rr=0.0007)
    return [cuisse, poleyn, greave, sabaton()]


def sabaton():
    # Articulated sabaton over the top of the paw (foot space: origin at the ankle, +Z toward the toes, the sole at
    # y = -0.0134). Lames arch over the instep and toe box like roof tiles, each rear lame riding over the next, and
    # stop short of the toes so the fur toes show in front, as in the reference.
    lames = []
    # (top of the arch (z, y), pitch of the lame's axis below level, half-width, arch height, length)
    spec = [((0.0078, 0.0112), 1.0, 0.0128, 0.0118, 0.0062),
            ((0.0112, 0.0068), 0.62, 0.0139, 0.0104, 0.0058),
            ((0.0146, 0.0036), 0.32, 0.0148, 0.0094, 0.0056),
            ((0.0178, 0.0021), 0.12, 0.0152, 0.0088, 0.005)]
    span = 1.92                     # the sides come down to a little below the arch's centre
    for k, ((zt, yt), phi, hw, h, L) in enumerate(spec):
        lift = 0.00035 * (len(spec) - 1 - k)   # rear lames ride over the next one
        r = h + lift
        ob = plate(f'sab{k}', [(-L / 2, r), (0.0, r * 1.01), (L / 2, r * 0.995)], rolls=('bottom',), a0=np.pi - span, a1=np.pi + span,
                   sx=(hw + lift) / r, segs=28, rr=0.0006)
        up = np.array([0.0, np.cos(phi), np.sin(phi)])
        c = np.array([0.0, yt, zt]) - up * r
        lames.append(A.transform(ob, A.mat4(t=tuple(c), rx=np.pi / 2 + phi)))
        for o in rivets_on(f'sab_rv{k}', (0.0, r + 0.0002), [np.pi - 1.45, np.pi + 1.45], sx=(hw + lift) / r, radius=0.0006):
            A.finish(o, subsurf=0)
            lames.append(A.transform(o, A.mat4(t=tuple(c), rx=np.pi / 2 + phi)))
    return A.join('foot__plate__sabaton', lames)


# ---------------------------------------------------------------- sword
def loft(name, sections):
    # sections: list of (K, 3) arrays, same K, closed loops; quads between consecutive loops, ends capped.
    S = np.stack(sections)
    n, K, _ = S.shape
    faces = [(i * K + k, (i + 1) * K + k, (i + 1) * K + (k + 1) % K, i * K + (k + 1) % K) for i in range(n - 1) for k in range(K)]
    verts = list(S.reshape(-1, 3))
    c0 = len(verts); verts.append(S[0].mean(0))
    c1 = len(verts); verts.append(S[-1].mean(0))
    faces += [(c0, (k + 1) % K, k) for k in range(K)]
    faces += [(c1, (n - 1) * K + k, (n - 1) * K + (k + 1) % K) for k in range(K)]
    ob = A._new_object(name, verts, faces)
    return A.recalc_normals(ob)


def blade(length=0.44, base=0.0035, w0=0.0215, w1=0.0125, t0=0.0043, t1=0.0022, point=0.055, fuller=0.62, name='sword__steel__blade'):
    secs = []
    ys = np.concatenate([np.linspace(0, 1 - point / length, 18), np.linspace(1 - point / length, 0.999, 8)[1:]])
    for t in ys:
        y = base + t * length
        pt = ss(t, 1 - point / length, 1.0)
        w = (w0 + (w1 - w0) * t) * (1 - pt) ** 0.85 + 0.0004
        th = (t0 + (t1 - t0) * t) * (1 - 0.8 * pt) + 0.0002
        f = ss(t, 0.02, 0.06) * (1 - ss(t, fuller - 0.08, fuller))      # fuller depth along the blade
        xs = np.array([1.0, 0.82, 0.55, 0.3, 0.15, 0.0, -0.15, -0.3, -0.55, -0.82, -1.0])
        top = []
        for x in xs:
            # Lenticular section thinning to the edges, with a shallow groove in the middle third.
            z = (1 - abs(x) ** 1.6) ** 0.8 * th / 2
            z -= f * th * 0.28 * np.exp(-(x / 0.2) ** 2)
            top.append((x * w / 2, y, z))
        bot = [(px, py, -pz) for (px, py, pz) in top[-2:0:-1]]
        secs.append(np.array(top + bot))
    ob = loft(name, secs)
    kb.select_only(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=np.radians(50))
    return ob


def guard(k=1.0, name='sword__brass__guard', half=0.0375):
    # Cross: a squared bar tapering to the ends, quillons curving slightly up toward the blade, knobbed tips.
    secs = []
    for x in np.linspace(-half, half, 25):
        u = abs(x) / half
        h = 0.0062 * k * (1 - 0.25 * u) ; d = 0.0085 * k * (1 - 0.3 * u)
        yc = 0.0012 * k * u ** 2.5 * 4
        ring = [(x, yc + h / 2 * np.sign(np.cos(a)) * min(1, abs(np.cos(a)) * 1.6), d / 2 * np.sign(np.sin(a)) * min(1, abs(np.sin(a)) * 1.6))
                for a in np.linspace(0, 2 * np.pi, 16, endpoint=False)]
        secs.append(np.array(ring))
    bar = loft('guard_bar', secs)
    A.finish(bar, subsurf=1)
    knobs = []
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.0042 * k, location=(s * (half + 0.001 * k), 0.0046 * k, 0))
        knobs.append(bpy.context.active_object)
        for p in knobs[-1].data.polygons:
            p.use_smooth = True
    return A.join(name, [bar] + knobs)


def grip(k=1.0, length=0.0595, name='sword__leather__grip'):
    prof = [(-0.0005 * k, 0.0053 * k), (-0.2 * length, 0.0059 * k), (-0.5 * length, 0.0062 * k), (-0.8 * length, 0.0059 * k), (-length, 0.0053 * k)]

    def deform(V, P, th):
        # Spiral leather wrap: raised bands winding down the grip.
        y = V[..., 1]
        band = np.clip(np.sin(th[None, :] + y * (2 * np.pi / (0.0065 * k))), 0, 1) ** 0.5
        f = 1 + 0.07 * band * ss(-y, 0.001 * k, 0.004 * k) * (1 - ss(-y, length - 0.0035 * k, length - 0.0005 * k))
        V[..., 0] *= f; V[..., 2] *= f
        return V
    ys = np.linspace(prof[0][0], prof[-1][0], 40)
    rs = np.interp(-ys, [-p[0] for p in prof], [p[1] for p in prof])
    ob = A.lathe(name, list(zip(ys, rs)), segs=40, deform=deform)
    A.finish(ob, subsurf=0)
    return ob


def pommel(k=1.0, y=-0.066, name='sword__brass__pommel'):
    # Wheel pommel with a raised boss on each face.
    prof = [(0.0032, 0.0), (0.0032, 0.0048), (0.0036, 0.0072), (0.0028, 0.0086), (0.0, 0.0091), (-0.0028, 0.0086),
            (-0.0036, 0.0072), (-0.0032, 0.0048), (-0.0032, 0.0)]
    ob = A.lathe('pommel', [(a * k, b * k) for a, b in prof], segs=48)
    A.finish(ob, subsurf=1)
    A.transform(ob, A.mat4(t=(0, y, 0), rx=np.pi / 2))
    ob.name = ob.data.name = name
    return ob


if __name__ == '__main__':
    kb.reset()
    allobs = [cuirass(), pauldron(1), pauldron(-1)] + belt_and_fauld() + arm_pieces() + leg_pieces() + [blade(), guard(), grip(), pommel()]
    # Per-part AO: pieces of one rig part occlude each other; other parts (which share the same local origin)
    # are hidden while baking.
    groups = {}
    for o in allobs:
        groups.setdefault(o.name.split('__')[0], []).append(o)
    for gname, obs in groups.items():
        for o in allobs:
            o.hide_render = o not in obs
        for o in obs:
            A.vertex_masks(o, ao_distance=0.006 if gname != 'sword' else 0.004, samples=48)
    for o in allobs:
        o.hide_render = False
    A.export_glb(os.path.join(PUB, 'kitten_armor.glb'), allobs)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in allobs)
    print('pieces', len(allobs), 'triangles', tris)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'kitten_armor.blend'))
