# Stylized castle kit: a crenellated wall section and a round tower, in chunky, softly bevelled stone laid course by
# course, with recessed dark mortar, a heavier plinth course, moss in the joints and on the tops, slate shingles and
# a pennant. Writes public/kit/castle_wall.glb and public/kit/castle_tower.glb; KIT_PREVIEW=1 renders a look in Cycles.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from mathutils import Vector, Matrix
import kit_lib as K
from kit_lib import lin

# Weathered moorland stone: cool and warm greys a step darker than limestone, with a few ochre and green-grey stones.
STONE = [lin('#7d8287'), lin('#8a847a'), lin('#767c76'), lin('#6c7073'), lin('#938b7e'), lin('#7f786c'), lin('#868d8c'), lin('#9b917f')]
MORTAR = lin('#34322f')
SLATE = [lin('#5d6670'), lin('#545c66'), lin('#66707a'), lin('#4e555e')]
WOOD = [lin('#7a5a3c'), lin('#6c4e33'), lin('#83623f')]
IRON = lin('#3a3a3c')
RED = lin('#8c2622')


def stone(rng):
    return K.jitter(rng, STONE[rng.integers(len(STONE))], 0.05)


def wall(B, rng, L, H, T, x0=0.0, crenels=True, plinth=True):
    """Stones on both faces of a wall L long, H high and T thick, centred on x0 (Blender X along the wall, Y across)."""
    gap = 0.065
    # Core slab: the mortar that shows, deep in the joints.
    B.box((x0, 0, H / 2), (L - 0.04, T - 0.2, H), MORTAR, bevel=0.015, segs=1)
    for face in (-1, 1):
        z, course = 0.0, 0
        while z < H - 0.08:
            ch = min(H - z, rng.uniform(0.34, 0.52))
            if H - (z + ch) < 0.22:
                ch = H - z
            deep = 0.26 + (0.08 if plinth and course == 0 else 0.0)
            x = -L / 2 + (rng.uniform(0.18, 0.38) if course % 2 else 0.0)
            if course % 2:  # a part-stone at the start of the staggered course
                bl = x + L / 2
                if bl > 0.12:
                    _stone(B, rng, x0 - L / 2 + bl / 2, face, T, deep, z, ch, bl, gap)
            while x < L / 2 - 0.06:
                bl = min(L / 2 - x, rng.uniform(0.55, 0.95))
                if L / 2 - (x + bl) < 0.22:
                    bl = L / 2 - x
                _stone(B, rng, x0 + x + bl / 2, face, T, deep, z, ch, bl, gap)
                x += bl
            z += ch
            course += 1
    # Coping: flat capstones across the top.
    x = -L / 2
    while x < L / 2 - 0.05:
        bl = min(L / 2 - x, rng.uniform(0.6, 0.9))
        if L / 2 - (x + bl) < 0.25:
            bl = L / 2 - x
        tilt = K.rot_xyz(rng.normal(0, 0.01), rng.normal(0, 0.012), rng.normal(0, 0.012))
        B.box((x0 + x + bl / 2, 0, H + 0.08), (bl - gap, T + 0.12, 0.2), stone(rng), rot=tilt, bevel=0.08, segs=4, profile=0.55, bulge=0.05)
        x += bl
    if crenels:
        # Merlons on the outer edge (Blender -Y faces out): one chunky rounded stone each, a little uneven in height.
        n = max(1, int(round(L / 1.35)))
        for i in range(n):
            cx = x0 - L / 2 + (i + 0.5) * L / n
            w = min(0.82, L / n - 0.46)
            yb = -T / 2 + 0.27
            hh = rng.uniform(0.62, 0.74)
            tilt = K.rot_xyz(rng.normal(0, 0.015), rng.normal(0, 0.02), rng.normal(0, 0.03))
            B.box((cx + rng.normal(0, 0.02), yb, H + 0.17 + hh / 2), (w, 0.5, hh), stone(rng), rot=tilt, bevel=0.13, segs=4, profile=0.55, bulge=0.07,
                  sub=3, rough=0.02, chip=0.5, grad=0.16, seed=rng.random() * 100)


def _stone(B, rng, cx, face, T, deep, z, ch, bl, gap):
    if z > 0.5 and rng.random() < 0.025:
        return  # a stone fallen out of the face: the dark mortar core shows
    # Pillowy, hand-dressed stones: big soft bevels, a swell in the faces, a slight tilt, and courses that wander a
    # little along the wall instead of running ruler-straight.
    prot = rng.uniform(0.0, 0.05)
    cy = face * (T / 2 - deep / 2 + prot)
    wob = 0.025 * math.sin(cx * 1.7 + z * 2.3) + rng.normal(0, 0.008)
    tilt = K.rot_xyz(rng.normal(0, 0.016), rng.normal(0, 0.02), rng.normal(0, 0.022))
    sz = (bl - gap, deep, ch - gap - abs(wob) * 0.5)
    B.box((cx + rng.normal(0, 0.01), cy, z + ch / 2 + wob * 0.5), sz, stone(rng), rot=tilt,
          bevel=min(0.11, 0.22 * min(sz[0], sz[2])) * rng.uniform(0.85, 1.1), segs=4, profile=0.55, bulge=0.06,
          sub=3, rough=0.016, chip=0.35, grad=0.14, seed=rng.random() * 100)


def tower(B, rng, R=2.1, H=6.6):
    gap = 0.065
    B.cylinder((0, 0, 0), R - 0.16, H, MORTAR, segs=48)  # core: the mortar deep in the joints
    z, course = 0.0, 0
    while z < H - 0.08:
        ch = min(H - z, rng.uniform(0.38, 0.47))
        if H - (z + ch) < 0.2:
            ch = H - z
        deep = 0.26 + (0.08 if course == 0 else 0.0)
        r = R + (0.06 if course == 0 else 0.0)
        n = max(8, int(round(2 * math.pi * r / rng.uniform(0.68, 0.82))))
        off = rng.uniform(0, 2 * math.pi)
        for i in range(n):
            a = off + (i + rng.uniform(-0.12, 0.12)) * 2 * math.pi / n
            chord = 2 * r * math.sin(math.pi / n) * rng.uniform(0.94, 1.02)
            prot = rng.uniform(0.0, 0.04)
            cr = r - deep / 2 + prot
            rot = K.rot_z(a + math.pi / 2) @ K.rot_xyz(rng.normal(0, 0.016), rng.normal(0, 0.02), rng.normal(0, 0.022))
            sz = (chord - gap, deep, ch - gap)
            B.box((cr * math.cos(a), cr * math.sin(a), z + ch / 2 + 0.02 * math.sin(a * 3 + z * 2)), sz, stone(rng), rot=rot,
                  bevel=min(0.11, 0.22 * min(sz[0], sz[2])) * rng.uniform(0.85, 1.1), segs=4, profile=0.55, bulge=0.06,
                  sub=3, rough=0.016, chip=0.3, grad=0.14, seed=rng.random() * 100)
        z += ch
        course += 1
    # Corbels: a ring of stepped brackets under the parapet.
    Rp = R + 0.32
    n = 16
    for i in range(n):
        a = (i + 0.5) * 2 * math.pi / n
        for k, (dz, out) in enumerate(((0.0, 0.12), (0.22, 0.26))):
            cr = R + out / 2 - 0.02
            B.box((cr * math.cos(a), cr * math.sin(a), H + dz + 0.11), (0.3, out + 0.12, 0.2), stone(rng), rot=K.rot_z(a + math.pi / 2), bevel=0.04, segs=3, bulge=0.03)
    # Parapet ring and merlons.
    zp = H + 0.44
    n = 20
    for i in range(n):
        a = (i + 0.5) * 2 * math.pi / n
        chord = 2 * Rp * math.sin(math.pi / n)
        B.box((Rp * math.cos(a), Rp * math.sin(a), zp + 0.2), (chord - gap, 0.42, 0.4 - gap), stone(rng), rot=K.rot_z(a + math.pi / 2), bevel=0.05, segs=3, bulge=0.035)
        if i % 2 == 0:
            B.box((Rp * math.cos(a), Rp * math.sin(a), zp + 0.62), (chord * 0.92 - gap, 0.42, 0.44 - gap), stone(rng), rot=K.rot_z(a + math.pi / 2), bevel=0.05, segs=3, bulge=0.035)
    # Conical roof of overlapping slate shingles with flared eaves, set inside the parapet.
    zr0, zr1, Rr = zp + 0.35, zp + 0.35 + 3.4, Rp + 0.05
    rows = 13
    for j in range(rows):
        t = j / rows
        rr = Rr * (1 - t) ** 0.92
        zz = zr0 + (zr1 - zr0) * (t ** 1.08) - 0.12 * (1 - t) ** 3   # a little kick out at the eaves
        n = max(6, int(round(2 * math.pi * rr / 0.34)))
        slope = math.atan2(Rr, zr1 - zr0)
        off = (0.5 if j % 2 else 0.0) * 2 * math.pi / n
        for i in range(n):
            a = off + i * 2 * math.pi / n + rng.normal(0, 0.02)
            w = 2 * rr * math.sin(math.pi / n) * 1.12
            # Lie on the cone (its side leans `slope` from vertical), a touch steeper so each row laps the one below.
            rot = K.rot_z(a + math.pi / 2) @ Matrix.Rotation(-slope * 1.06, 3, 'X') @ K.rot_xyz(rng.normal(0, 0.03), 0, rng.normal(0, 0.04))
            c = K.jitter(rng, SLATE[rng.integers(len(SLATE))], 0.06)
            B.box((rr * math.cos(a), rr * math.sin(a), zz), (w, 0.05, 0.46), c, rot=rot, bevel=0.018, segs=2, bulge=0.0)
    # Finial and pennant.
    B.box((0, 0, zr1 + 0.25), (0.09, 0.09, 0.6), IRON, bevel=0.03, segs=2)
    B.box((0, 0, zr1 + 0.06), (0.24, 0.24, 0.16), IRON, bevel=0.07, segs=3)
    pole_top = zr1 + 1.4
    B.box((0, 0, zr1 + 0.7), (0.05, 0.05, 1.4), WOOD[0], bevel=0.02, segs=2)
    flag = []
    for k in range(9):
        u = k / 8
        wave = 0.08 * math.sin(u * 5.0)
        flag.append(((0.03 + u * 1.15, wave, pole_top - 0.08), (0.03 + u * 1.15, wave, pole_top - 0.08 - 0.5 * (1 - u * 0.6))))
    vs, fs = [], []
    for k, (a, b) in enumerate(flag):
        vs += [a, b]
        if k:
            i = 2 * k
            fs.append((i - 2, i - 1, i + 1, i))
    B.mesh(vs, fs, RED)
    # Door: an arched plank door with iron straps, and two arrow slits.
    door_a = -math.pi / 2
    dx, dy = (R + 0.02) * math.cos(door_a), (R + 0.02) * math.sin(door_a)
    for k in range(5):
        u = (k - 2) * 0.2
        B.box((dx + u, dy, 0.95), (0.19, 0.08, 1.9), K.jitter(rng, WOOD[k % 3], 0.05), rot=K.rot_z(0), bevel=0.025, segs=2)
    for zz in (0.45, 1.45):
        B.box((dx, dy - 0.05, zz), (1.02, 0.03, 0.08), IRON, bevel=0.012, segs=1)
    B.box((dx, dy + 0.06, 2.05), (1.25, 0.32, 0.3), stone(rng), bevel=0.06, segs=3, bulge=0.04)   # lintel
    for a in (math.pi / 6, math.pi * 5 / 6 + 0.3):
        sx, sy = (R + 0.03) * math.cos(a), (R + 0.03) * math.sin(a)
        B.box((sx, sy, 3.6), (0.14, 0.1, 0.9), lin('#151413'), rot=K.rot_z(a + math.pi / 2), bevel=0.03, segs=2)
    return zr1


if __name__ == '__main__':
    K.reset()
    rng = np.random.default_rng(11)
    Bw = K.Builder('castle_wall')
    wall(Bw, rng, 4.0, 3.2, 1.0)
    w = Bw.obj()
    K.moss_and_masks(w, ao_distance=0.5, seed=3, streaks=1.0)
    K.export([w], 'castle_wall')
    Bt = K.Builder('castle_tower')
    tower(Bt, np.random.default_rng(5))
    t = Bt.obj()
    K.moss_and_masks(t, ao_distance=0.6, seed=8, streaks=0.8)
    K.export([t], 'castle_tower')
    if os.environ.get('KIT_PREVIEW'):
        # Wall section to the left of the tower, for the look.
        w2 = w.copy(); w2.data = w.data.copy(); import bpy; bpy.context.scene.collection.objects.link(w2)
        w.location = (-4.2, 0, 0); w2.location = (-8.2, 0, 0)
        cam = [float(v) for v in os.environ.get('KIT_CAM', '-2.0,-13.5,3.2,-3.0,0,3.4,32').split(',')]
        K.preview(os.path.join(os.path.dirname(__file__), 'out', os.environ.get('KIT_OUT', 'kit_castle.png')), cam_pos=cam[0:3], look=cam[3:6], lens=cam[6], samples=64)
