# Sir Bram, stylized (engine v2): plate over a navy coat on the shared rig (blender/char_lib.py). Chunky, softly
# bevelled shapes that read from across the moor: an oversized great helm, broad layered pauldrons, a breastplate
# with a dark cross (and the dent where the blade went in), big gauntlets and sabatons, a coat skirt split for the
# legs, his sword at his hip with the faded pink ribbon on its hilt, and a shield on his back.
#
# Plates are skinned rigidly to one bone; elbow and knee caps take half of each neighbour so they turn half as far
# as the joint (they stay over it); the skirt's panels follow the thighs below the belt.
#
# Run: blender -b --factory-startup -P blender/char_knight.py   (KNIGHT_PREVIEW=1 also renders previews)
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
from char_lib import (load_rig, Rig, material, Piece, basis, frame, assemble, export, mirror_x, pose_rest_a, preview, TAU,
                      PREVIEW, skin)
import bpy

arm, man = load_rig()
R = Rig(arm)
PI = math.pi


def ss(x, a, b):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---- Materials (the game rebuilds each by name).
material('steel', '#b8bec4', metal=1.0, rough=0.32)
material('steel_dark', '#7a8288', metal=1.0, rough=0.42)
material('visor', '#0b0c0d', rough=0.9)
material('coat', '#1e2939', rough=0.85, sheen=0.4)
material('trim', '#d9cfb6', rough=0.8, sheen=0.3)
material('leather', '#5b3b25', rough=0.68)
material('brass', '#c9a24c', metal=1.0, rough=0.34)
material('emblem', '#18202d', rough=0.7)
material('ribbon', '#e7a1b4', rough=0.55, sheen=0.5)
material('field', '#243552', rough=0.6)

# The mannequin under the plate is the coat and hose.
for s in man.material_slots:
    s.material = bpy.data.materials['coat']

parts = []
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
FRONT = Vector((0, -1, 0))

# ---- Helm: a great helm half again a head's size, with eye slits either side of the nasal bar, breathing holes
# on his right cheek, a brow band, a band down the face, a brass rim and a finial.
HC = Vector((0, 0.002, 1.705))
hx, hy, hz, hp = 0.132, 0.142, 0.175, 2.5
helm = Piece('helm', ['steel', 'visor'])
helm.shell(HC, hx, hy, hz, power=hp, v0=-1.05, v1=PI / 2, su=56, sv=30).outward(HC)
helm.cut(lambda c: c.y < -0.07 and 1.722 < c.z < 1.747 and 0.024 < abs(c.x) < 0.112)
helm.cut(lambda c: c.y < -0.06 and 1.60 < c.z < 1.672 and -0.112 < c.x < -0.03 and (round(c.x / 0.0145) + round(c.z / 0.0145)) % 2 == 0)
parts.append(helm.finish('Head', thick=0.008, bevel=0.0025, inner=1))
brow = Piece('helm_brow', ['steel_dark'])
brow.shell(HC, hx * 1.025, hy * 1.025, hz * 1.02, power=hp, u0=PI + 0.32, u1=TAU - 0.32, v0=0.2, v1=0.33, su=40, sv=3).outward(HC)
parts.append(brow.finish('Head', thick=0.005, bevel=0.0015))
nasal = Piece('helm_nasal', ['steel_dark'])
nasal.shell(HC, hx * 1.022, hy * 1.022, hz * 1.02, power=hp, u0=1.5 * PI - 0.085, u1=1.5 * PI + 0.085, v0=-1.0, v1=1.42, su=4, sv=30).outward(HC)
parts.append(nasal.finish('Head', thick=0.005, bevel=0.0015))
rim = Piece('helm_rim', ['steel_dark'])
rim.torus(HC + Vector((0, 0, -0.152)), hx * 1.005, 0.011, segs=56, rsegs=10, rx=1.0, ry=hy / hx, rz=1.35)
parts.append(rim.finish('Head'))
fin = Piece('helm_finial', ['brass'])
fin.shell(HC + Vector((0, 0, hz + 0.012)), 0.02, 0.02, 0.024, su=16, sv=10)
parts.append(fin.finish('Head'))

# ---- Gorget: a collar of plate on the shoulders, under the helm's rim.
gor = Piece('gorget', ['steel'])
gor.lathe((0, 0.012, 1.425), (0, 0.0, 1.565), [(0, 0.168), (0.35, 0.142), (0.7, 0.114), (1.0, 0.1)], ref=X, ex=1.15, ez=1.0, segs=48)
gor.outward((0, 0.006, 1.5), axis=Z)
parts.append(gor.finish('spine_03', thick=0.006, bevel=0.002))

# ---- Breastplate with a keel, the dent, and the dark cross; the backplate.
BC = Vector((0, 0.02, 1.265))
bx_, by_, bz_ = 0.195, 0.17, 0.235
DENT = Vector((0.075, -0.13, 1.155))


def chest_w(c):
    w3 = ss(c.z, 1.2, 1.36)
    return {'spine_03': w3, 'spine_02': 1 - w3}


def keel_dent(p):
    if p.y < 0:
        p.y -= 0.014 * max(0.0, 1 - abs(p.x) / 0.07)
    d = (p - DENT).length
    if d < 0.04:
        p.y += 0.011 * (1 - (d / 0.04) ** 2)
    return p


def plate_cuts(c, back=False):
    neck = c.z > (1.44 if back else 1.425) and abs(c.x) < (0.09 if back else 0.085)
    arms = abs(c.x) > 0.155 and c.z > 1.36
    return neck or arms


bp = Piece('breastplate', ['steel'])
bp.shell(BC, bx_, by_, bz_, power=2.2, u0=PI + 0.04, u1=TAU - 0.04, v0=-0.95, v1=1.0, su=40, sv=24).outward(BC)
bp.deform(keel_dent).cut(plate_cuts)
parts.append(bp.finish(chest_w, thick=0.008, bevel=0.0025))
cross = Piece('cross', ['emblem'])
cross.shell(BC, bx_ * 1.012, by_ * 1.012, bz_ * 1.008, power=2.2, u0=PI + 0.04, u1=TAU - 0.04, v0=-0.95, v1=1.0, su=72, sv=44).outward(BC)
cross.deform(keel_dent)
cross.cut(lambda c: not ((abs(c.x) < 0.026 and 1.10 < c.z < 1.425) or (abs(c.z - 1.315) < 0.026 and abs(c.x) < 0.15)) or plate_cuts(c))
parts.append(cross.finish(chest_w, thick=0.0025))
back = Piece('backplate', ['steel'])
back.shell(BC, bx_, by_ * 0.98, bz_, power=2.2, u0=0.04, u1=PI - 0.04, v0=-0.95, v1=1.0, su=40, sv=24).outward(BC)
back.cut(lambda c: plate_cuts(c, True))
parts.append(back.finish(chest_w, thick=0.008, bevel=0.0025))

# ---- Fauld: two lames below the breastplate.
for i, (z0, z1, r0, r1) in enumerate([(1.10, 1.035, 0.158, 0.168), (1.05, 0.985, 0.164, 0.176)]):
    f = Piece(f'fauld{i}', ['steel'])
    f.lathe((0, 0.0, z0), (0, 0.0, z1), [(0, r0), (1, r1)], ref=FRONT, ex=0.95, ez=1.1, a0=-2.0, a1=2.0, segs=36)
    f.outward((0, 0, (z0 + z1) / 2), axis=Z)
    parts.append(f.finish('pelvis', thick=0.005, bevel=0.002))

# ---- Coat skirt: front panels follow each thigh, the back panel both; a cream hem.
SKIRT = [(0, 0.165), (0.25, 0.19), (0.6, 0.235), (1.0, 0.272)]


def skirt_w(c, side):
    w = ss(0.94 - c.z, 0.0, 0.2)  # 0 at the belt, 1 a span below
    if side == 'l':
        return {'thigh_l': w, 'pelvis': 1 - w}
    if side == 'r':
        return {'thigh_r': w, 'pelvis': 1 - w}
    sh = ss(c.x, -0.09, 0.09)
    return {'thigh_l': w * sh, 'thigh_r': w * (1 - sh), 'pelvis': 1 - w}


for name, a0, a1, side in (('skirt_fl', 0.05, 1.75, 'l'), ('skirt_fr', -1.75, -0.05, 'r'), ('skirt_b', 1.75, TAU - 1.75, 'b')):
    sk = Piece(name, ['coat', 'trim'])
    n = max(8, int(abs(a1 - a0) / 0.09))
    prof = SKIRT
    sk.lathe((0, 0.01, 1.0), (0, 0.035, 0.46), prof, ref=FRONT, ex=0.95, ez=1.08, a0=a0, a1=a1, segs=n)
    sk.mat(1).lathe((0, 0.01, 1.0), (0, 0.035, 0.46), [(0.955, 0.2665), (1.0, 0.2722)], ref=FRONT, ex=0.955, ez=1.085, a0=a0, a1=a1, segs=n)
    sk.outward((0, 0.02, 0.75), axis=Z)
    parts.append(sk.finish(lambda c, s=side: skirt_w(c, s), thick=0.009, bevel=0.0025))

# ---- Belt and buckle.
belt = Piece('belt', ['leather'])
belt.torus((0, 0.0, 0.978), 0.163, 0.015, rx=1.07, ry=0.93, rz=1.6, segs=56, rsegs=8)
parts.append(belt.finish('pelvis'))
buckle = Piece('buckle', ['brass'])
buckle.box((0, -0.165, 0.978), (0.052, 0.014, 0.046), bevel=0.006)
parts.append(buckle.finish('pelvis'))

# ---- Sword at his left hip, the pink ribbon on its grip.
MOUTH = Vector((0.205, -0.045, 0.955))
TIP = Vector((0.275, 0.37, 0.235))
sa = (TIP - MOUTH).normalized()
scab = Piece('scabbard', ['leather', 'brass'])
scab.lathe(MOUTH, TIP, [(0.0, 0.03), (0.5, 0.027), (0.88, 0.022), (0.97, 0.016), (1.0, 0.004)], ref=X, ex=1.0, ez=0.45, segs=20)
scab.mat(1).lathe(MOUTH, TIP, [(-0.005, 0.0335), (0.075, 0.033)], ref=X, ex=1.0, ez=0.5, segs=20)
scab.lathe(MOUTH, TIP, [(0.86, 0.025), (0.99, 0.009)], ref=X, ex=1.05, ez=0.55, segs=20)
scab.outward(MOUTH, axis=sa)
parts.append(scab.finish('pelvis', thick=0.0, bevel=0.0))
hilt = Piece('hilt', ['leather', 'steel', 'brass'])
G0 = MOUTH - sa * 0.03
hilt.lathe(G0, G0 - sa * 0.15, [(0, 0.017), (0.5, 0.019), (1.0, 0.016)], ref=X, segs=14)
hilt.mat(1).box(MOUTH - sa * 0.018, (0.2, 0.024, 0.024), B=frame(X, sa) @ Matrix.Rotation(PI / 2, 3, 'Z'), bevel=0.008)
hilt.mat(2).shell(G0 - sa * 0.172, 0.025, 0.025, 0.025, su=16, sv=10)
parts.append(hilt.finish('pelvis'))
rib = Piece('ribbon', ['ribbon'])
RB = G0 - sa * 0.06
side_ = sa.cross(Z).normalized()
rib.torus(RB, 0.021, 0.006, B=frame(sa, X) @ Matrix.Rotation(PI / 2, 3, 'X'), segs=20, rsegs=6, rz=0.5)
for k, (ang, ln) in enumerate(((0.25, 0.13), (-0.3, 0.1))):
    d = (Matrix.Rotation(ang, 3, sa) @ (-Z)).normalized()
    p0 = RB + side_ * 0.02 * (1 if k == 0 else -1)
    tail = p0 + d * ln + sa * 0.02
    rib.lathe(p0, tail, [(0, 0.008), (0.9, 0.009), (1.0, 0.004)], ref=side_, ex=1.0, ez=0.22, segs=8)
for s in (1, -1):
    rib.torus(RB + side_ * 0.025 * s, 0.018, 0.005, B=frame(side_, Z), segs=16, rsegs=6, rx=1.0, ry=0.6, rz=0.4)
parts.append(rib.finish('pelvis'))

# ---- Shield on his back: a heater, navy with a cream chevron, a steel rim.
SH0 = Vector((0, 0.235, 1.42))


def heater(u, w):
    width = 1.0 if w < 0.42 else math.sqrt(max(0.0, 1 - ((w - 0.42) / 0.58) ** 2))
    return abs(u) <= width + 1e-6


def heater_w(w):
    return 1.0 if w < 0.42 else math.sqrt(max(0.0, 1 - ((w - 0.42) / 0.58) ** 2))


def on_shield(u, w, lift=0.0):
    return Vector((u * 0.27, SH0.y + 0.055 * (1 - u * u) + lift, SH0.z - w * 0.62))


# The face: rows across the shield, each as wide as the heater outline at its height (no stepped edge).
sh = Piece('shield', ['field', 'steel_dark', 'steel'])
sw_, su_ = 30, 24
pts = []
for i in range(sw_ + 1):
    w = i / sw_
    hw = max(0.035, heater_w(w))
    for j in range(su_ + 1):
        pts.append(on_shield((-1 + 2 * j / su_) * hw, w))
sh._grid(pts, sw_ + 1, su_ + 1)
sh.outward((0, 0.0, 1.2))
parts.append(sh.finish('spine_03', thick=0.022, bevel=0.004, inner=1, rim=2))
# The chevron: a band in a V across the face.
chev = Piece('chevron', ['trim'])
pts = []
nu, nk = 40, 3
for k in range(nk + 1):
    off = -0.075 + 0.15 * k / nk
    for j in range(nu + 1):
        u = -0.96 + 1.92 * j / nu
        pts.append(on_shield(u, 0.62 - 0.42 * abs(u) + off, lift=0.004))
chev._grid(pts, nk + 1, nu + 1)
chev.outward((0, 0.0, 1.2))
parts.append(chev.finish('spine_03', thick=0.003))

# ---- Arms (left; mirrored for the right).
S = R.head('upperarm_l') + Vector((0.008, -0.01, 0.004))
arm_parts = []
for i, (rad, v0, v1, off, wts) in enumerate((
    ((0.128, 0.132, 0.122), -0.12, 1.45, (0.0, 0.0, 0.012), {'clavicle_l': 1.0}),
    ((0.137, 0.139, 0.116), -0.45, 0.12, (0.018, 0.0, -0.004), {'clavicle_l': 0.7, 'upperarm_l': 0.3}),
    ((0.143, 0.143, 0.11), -0.76, -0.32, (0.036, 0.0, -0.01), {'clavicle_l': 0.4, 'upperarm_l': 0.6}),
)):
    pa = Piece(f'pauldron{i}_l', ['steel'])
    c = S + Vector(off)
    pa.shell(c, *rad, u0=-1.8, u1=1.8, v0=v0, v1=v1, su=34, sv=max(4, int((v1 - v0) / 0.08)), power=2.1).outward(c)
    arm_parts.append(pa.finish(lambda co, w=wts: w, thick=0.007, bevel=0.0025))
UA0, UA1 = R.head('upperarm_l'), R.tail('upperarm_l')
rere = Piece('rerebrace_l', ['steel'])
rere.lathe(UA0, UA1, [(0.3, 0.086), (0.6, 0.082), (0.9, 0.076)], ref=Z, ex=1.0, ez=0.96, segs=28).outward(UA0, axis=UA1 - UA0)
arm_parts.append(rere.finish('upperarm_l', thick=0.006, bevel=0.002))
E = R.head('lowerarm_l')
cou = Piece('couter_l', ['steel'])
cou.shell(E, 0.086, 0.086, 0.082, B=basis(X, -Z, Y), v0=0.3, v1=PI / 2, su=28, sv=8).outward(E)
cou.shell(E + Vector((0.0, 0.03, 0.068)), 0.06, 0.034, 0.012, B=basis(X, Y, Z), su=24, sv=6)
arm_parts.append(cou.finish(lambda co: {'upperarm_l': 0.5, 'lowerarm_l': 0.5}, thick=0.006, bevel=0.002))
LA0, LA1 = R.head('lowerarm_l'), R.tail('lowerarm_l')
vam = Piece('vambrace_l', ['steel'])
vam.lathe(LA0, LA1, [(0.12, 0.076), (0.5, 0.072), (0.86, 0.062)], ref=Z, ex=1.0, ez=0.92, segs=26).outward(LA0, axis=LA1 - LA0)
arm_parts.append(vam.finish('lowerarm_l', thick=0.005, bevel=0.002))
W = R.head('hand_l')
cuff = Piece('cuff_l', ['steel'])
cuff.lathe(W, LA0, [(-0.03, 0.062), (0.07, 0.074), (0.17, 0.09)], ref=Z, ex=1.0, ez=0.94, segs=28).outward(W, axis=LA0 - W)
arm_parts.append(cuff.finish('hand_l', thick=0.005, bevel=0.002))
# The gauntlet: a plate over the back of the hand, a mitten of three lames that curl with the fingers, and a
# thumb of two.
HY = 0.071  # the hand's centre line across the fingers (index to little finger)
glove = Piece('gauntlet_l', ['steel', 'steel_dark'])
glove.box(Vector((0.802, HY, 1.437)), (0.13, 0.112, 0.064), bevel=0.024, segs=3)
glove.mat(1).box(Vector((0.858, HY, 1.47)), (0.03, 0.114, 0.016), bevel=0.007)
arm_parts.append(glove.finish('hand_l'))
for k, (b, ln) in enumerate((('middle_01_l', 0.05), ('middle_02_l', 0.04), ('middle_03_l', 0.05))):
    h0 = R.head(b)
    seg = Piece(f'mitten{k}_l', ['steel'])
    seg.box(Vector((h0.x + ln / 2 - 0.004, HY, h0.z - 0.003)), (ln + 0.01, 0.108 - k * 0.006, 0.05 - k * 0.004), bevel=0.016 if k < 2 else 0.02, segs=3)
    arm_parts.append(seg.finish(b))
for k, b in enumerate(('thumb_01_l', 'thumb_02_l', 'thumb_03_l')):
    a0, a1 = R.head(b), R.tail(b)
    if b == 'thumb_03_l':
        a1 = R.tail('thumb_04_leaf_l')
    th = Piece(f'thumb{k}_l', ['steel'])
    th.lathe(a0, a1, [(-0.12, 0.024), (0.5, 0.025), (1.0, 0.021 if k < 2 else 0.016), (1.12, 0.004 if k == 2 else 0.02)], ref=Z, ex=1.0, ez=0.85, segs=14)
    th.outward(a0, axis=a1 - a0)
    arm_parts.append(th.finish(b))
parts += arm_parts
parts += [mirror_x(o) for o in arm_parts]

# ---- Legs (left; mirrored for the right).
leg_parts = []
T0, T1 = R.head('thigh_l'), R.tail('thigh_l')
cui = Piece('cuisse_l', ['steel'])
cui.lathe(T0, T1, [(0.5, 0.112), (0.75, 0.104), (0.96, 0.088)], ref=FRONT, ex=1.0, ez=0.86, a0=-1.95, a1=1.95, segs=26).outward(T0, axis=T1 - T0)
leg_parts.append(cui.finish('thigh_l', thick=0.006, bevel=0.002))
K = R.head('calf_l') + Vector((0, -0.012, 0))
pol = Piece('poleyn_l', ['steel'])
pol.shell(K, 0.088, 0.088, 0.084, B=basis(X, Z, -Y), v0=0.22, v1=PI / 2, su=28, sv=9).outward(K)
pol.shell(K + Vector((0.074, 0.01, 0.0)), 0.013, 0.055, 0.062, su=20, sv=8)
leg_parts.append(pol.finish(lambda co: {'thigh_l': 0.5, 'calf_l': 0.5}, thick=0.006, bevel=0.002))
C0, C1 = R.head('calf_l'), R.tail('calf_l')


def calf_bulge(a, t):
    s = max(0.0, math.sin(a)) ** 2
    return 1 + 0.42 * s * math.sin(PI * min(1.0, max(0.0, (t - 0.05) / 0.62)))


grv = Piece('greave_l', ['steel'])
grv.lathe(C0, C1, [(0.02, 0.08), (0.3, 0.08), (0.62, 0.07), (0.97, 0.058)], ref=X, ex=0.92, ez=1.04, segs=30, shape=calf_bulge)
grv.outward(C0, axis=C1 - C0)
leg_parts.append(grv.finish('calf_l', thick=0.006, bevel=0.002))
# Sabatons: one smooth shell over the foot, low at the toe and high at the ankle, ridged where the lames would
# overlap; the front follows the toes, the rest the foot. A leather sole under it.
FC = Vector((0.089, -0.058, 0.004))
frx, fry = 0.07, 0.158


def foot_height(p):
    t = ss(p.y, -0.2, 0.06)  # 0 at the toe .. 1 toward the heel
    p.z = FC.z + (p.z - FC.z) * (0.066 + 0.07 * t)
    return p


def foot_w(c):
    w = ss(-c.y, 0.08, 0.13)
    return {'ball_l': w, 'foot_l': 1 - w}


sab = Piece('sabaton_l', ['steel'])
sab.shell(FC, frx, fry, 1.0, power=2.4, v0=0.0, v1=PI / 2, su=40, sv=12).outward(FC).deform(foot_height)
leg_parts.append(sab.finish(foot_w, thick=0.006, bevel=0.002))


def dome_arc(yb, lift=0.0, n=24, p=2.4):
    """The dome's cross-section at y = yb (a superellipse arc over the foot), raised by `lift`."""
    k = (1 - abs((yb - FC.y) / fry) ** p) ** (1 / p)
    h = 0.066 + 0.07 * ss(yb, -0.2, 0.06)
    e = 2 / p
    out = []
    for i in range(n + 1):
        th = PI * i / n
        cx, sz = math.cos(th), math.sin(th)
        x = frx * k * math.copysign(abs(cx) ** e, cx)
        z = h * k * abs(sz) ** e
        nrm = Vector((x / (frx * k + 1e-6), 0, z / (h * k + 1e-6))).normalized()
        out.append(Vector((FC.x + x, yb, FC.z + z)) + nrm * lift)
    return out


# Lame edges: beads across the foot where one plate overlaps the next.
for k, yb in enumerate((-0.035, -0.082, -0.126)):
    rd = Piece(f'sabaton_ridge{k}_l', ['steel_dark'])
    rd.sweep(dome_arc(yb, lift=0.004), 0.0042, segs=8, ref=(0, 1, 0), rz=0.8)
    leg_parts.append(rd.finish(foot_w))
sole = Piece('sole_l', ['leather'])
sole.shell(Vector((FC.x, FC.y + 0.002, 0.007)), frx * 1.05, fry * 1.03, 0.009, power=2.4, su=40, sv=8)
leg_parts.append(sole.finish(foot_w))
parts += leg_parts
parts += [mirror_x(o) for o in leg_parts]

body = assemble(arm, parts, 'knight_plate')
out = export(arm, [body, man], 'knight')

if os.environ.get('KNIGHT_PREVIEW'):
    pose_rest_a(arm)
    os.makedirs(PREVIEW, exist_ok=True)
    preview(os.path.join(PREVIEW, 'knight_front.png'), (1.25, -2.9, 1.35), (0, 0, 1.0), lens=50)
    preview(os.path.join(PREVIEW, 'knight_back.png'), (-1.4, 2.8, 1.45), (0, 0, 1.0), lens=50)
