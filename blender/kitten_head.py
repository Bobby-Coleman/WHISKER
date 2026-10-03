# Kitten head hero sculpt: skull and face from the game's tuned SDF, plus eyelid rims, a shaped nose leather with
# nostrils, philtrum and mouth line. Writes the high and low meshes to out/ and renders a clay preview.
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
from kk_sdf import ellipsoid, capsule, torus, union, smin, smax, polygonize
import kk_blender as kb

EYE = dict(x=0.0158, y=-0.005, z=0.0277, r=0.0084)
SOCK = dict(x=0.0159, y=-0.0048, z=0.0311, rx=0.0099, ry=0.0091, rz=0.0077)
NOSEP = dict(x=0.0, y=-0.0148, z=0.0404, rx=0.0047, ry=0.0034, rz=0.0035)


def eye_axis(s):
    # Eye local +Z in head space for rotation (-0.05, s*0.32, 0), XYZ order.
    a, b = -0.05, s * 0.32
    v = np.array([np.sin(b), 0.0, np.cos(b)])
    return np.array([v[0], v[1] * np.cos(a) - v[2] * np.sin(a), v[1] * np.sin(a) + v[2] * np.cos(a)])


def eye_frame(s):
    f = eye_axis(s)
    u = np.cross([0.0, 1.0, 0.0], f); u /= np.linalg.norm(u)
    v = np.cross(f, u)
    return f, u, v


def eye_ap(du, dv, dw):
    # Azimuthal-equidistant angles around the eye axis (radians): circles on the eyeball stay circles,
    # so a round aperture doesn't come out diamond-shaped at large opening angles.
    th = np.arctan2(np.sqrt(du * du + dv * dv), dw)
    ph = np.arctan2(dv, du)
    return th * np.cos(ph), th * np.sin(ph)


APERTURE = dict(a_h=0.92, a_v=0.6, tilt=-0.09)


def lid_solid(s, gap=0.00035, a_h=APERTURE['a_h'], a_v=APERTURE['a_v'], tilt=APERTURE['tilt']):
    # Lids hug the eyeball: a ball slightly larger than the eye with an almond aperture cut along the eye axis.
    f, u, v = eye_frame(s)
    c = np.array([s * EYE['x'], EYE['y'], EYE['z']])
    R = EYE['r'] + gap

    def g(x, y, z):
        px, py, pz = x - c[0], y - c[1], z - c[2]
        du = px * u[0] + py * u[1] + pz * u[2]
        dv = px * v[0] + py * v[1] + pz * v[2]
        dw = px * f[0] + py * f[1] + pz * f[2]
        ball = np.sqrt(px * px + py * py + pz * pz) - R
        tu, tv = eye_ap(du, dv, dw)
        tv = tv - tilt * s * tu  # outer corner (s*u) sits a little higher
        ap = (np.sqrt((tu / a_h) ** 2 + (tv / a_v) ** 2) - 1.0) * R * 0.8
        ap = np.where(dw > 0, ap, R)
        return np.maximum(ball, -ap)
    return g


def head_sdf():
    base = union(0.01,
                 ellipsoid((0, 0.006, -0.004), (0.044, 0.04, 0.042)),            # cranium
                 ellipsoid((0.02, -0.0158, 0.008), (0.028, 0.024, 0.027)),       # cheeks
                 ellipsoid((-0.02, -0.0158, 0.008), (0.028, 0.024, 0.027)),
                 ellipsoid((0, -0.008, 0.0305), (0.0105, 0.0108, 0.0118)),       # nose bridge
                 ellipsoid((0.0072, -0.0222, 0.0342), (0.0108, 0.0089, 0.0104)),  # whisker pads
                 ellipsoid((-0.0072, -0.0222, 0.0342), (0.0108, 0.0089, 0.0104)),
                 ellipsoid((0, -0.0302, 0.0262), (0.0092, 0.0068, 0.0088)),      # chin
                 ellipsoid((0.0152, 0.0028, 0.0266), (0.0135, 0.0086, 0.0106)),  # brows
                 ellipsoid((-0.0152, 0.0028, 0.0266), (0.0135, 0.0086, 0.0106)),
                 ellipsoid((0, -0.038, -0.01), (0.028, 0.028, 0.028)))           # neck
    N = NOSEP

    def nose(x, y, z):
        # Rounded inverted triangle: full width at the top, narrowing to the philtrum (approximate distance bound).
        t = np.clip((y - (N['y'] - N['ry'])) / (2 * N['ry']), 0.0, 1.0)
        rx = N['rx'] * (0.5 + 0.5 * t ** 0.7)
        px, py, pz = (x - N['x']) / rx, (y - N['y']) / N['ry'], (z - N['z']) / N['rz']
        k0 = np.sqrt(px * px + py * py + pz * pz)
        return (k0 - 1.0) * np.minimum(np.minimum(rx, N['ry']), N['rz'])
    # Comma-shaped slits low on each side of the leather, opening down and out.
    nostrils = [ellipsoid((s * 0.0031, N['y'] - 0.0019, N['z'] + 0.0017), (0.0012, 0.00055, 0.0012)) for s in (-1, 1)]
    philtrum = capsule((0, N['y'] - N['ry'] * 0.6, N['z'] + 0.0028), (0, N['y'] - 0.0072, N['z'] - 0.0012), 0.00055)
    ym, zm = N['y'] - 0.0074, N['z'] - 0.0014
    mouth = [capsule((0, ym, zm), (s * 0.0062, ym - 0.0022, zm - 0.0042), 0.0005, 0.0003) for s in (-1, 1)]
    socks = [ellipsoid((s * SOCK['x'], SOCK['y'], SOCK['z']), (SOCK['rx'], SOCK['ry'], SOCK['rz'])) for s in (-1, 1)]
    lids = [lid_solid(s) for s in (-1, 1)]

    def sdf(x, y, z):
        d = smin(base(x, y, z), nose(x, y, z), 0.002)
        for s in socks:
            d = smax(d, -s(x, y, z), 0.003)
        for l in lids:
            d = smin(d, l(x, y, z), 0.0016)
        for n in nostrils:
            d = smax(d, -n(x, y, z), 0.0006)
        d = smax(d, -philtrum(x, y, z), 0.0005)
        for m in mouth:
            d = smax(d, -m(x, y, z), 0.0006)
        return d
    return sdf


LO, HI = (-0.062, -0.07, -0.056), (0.062, 0.056, 0.057)


def build(step_hi=0.0004, voxel_lo=0.0011):
    step_hi = float(os.environ.get('KK_STEP', step_hi))
    t = time.time()
    sdf = head_sdf()
    v, f = polygonize(sdf, LO, HI, step_hi)
    print('hi polygonized', len(v), 'verts in', round(time.time() - t, 1), 's')
    kb.reset()
    hi = kb.mesh_object('HeadHigh', v, f)
    kb.voxel_remesh(hi, step_hi * 0.9, smooth_iters=0)
    lo = hi.copy(); lo.data = hi.data.copy(); lo.name = 'Head'
    bpy.context.scene.collection.objects.link(lo)
    # Quadric decimation keeps the lid edges, nostrils and mouth line that a uniform remesh would blur.
    dec = lo.modifiers.new('dec', 'DECIMATE'); dec.decimate_type = 'COLLAPSE'
    dec.ratio = float(os.environ.get('KK_LO_FACES', 26000)) / max(1, len(lo.data.polygons))
    dec.use_collapse_triangulate = True
    kb.apply_modifiers(lo)
    print('lo faces', len(lo.data.polygons), 'hi faces', len(hi.data.polygons))
    return hi, lo, sdf


if __name__ == '__main__':
    os.makedirs(kb.OUT, exist_ok=True)
    hi, lo, sdf = build()
    hi.hide_render = True
    mat = kb.clay()
    lo.data.materials.append(mat)
    hi.data.materials.append(mat)
    # Eyeballs for the preview.
    eyem = kb.clay('eye', (0.02, 0.02, 0.02), 0.05)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=EYE['r'], segments=48, ring_count=24,
                                             location=tuple(kb.g2b(np.array([s * EYE['x'], EYE['y'], EYE['z']]))))
        bpy.ops.object.shade_smooth()
        bpy.context.active_object.data.materials.append(eyem)
    kb.overcast_world(1.0)
    kb.add_sun(strength=2.5)
    kb.add_camera((-0.07, 0.006, 0.3), (0, -0.006, 0.0), lens=85)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'kitten_head.blend'))
    kb.render(os.path.join(kb.OUT, 'head_clay_lo.png'), 560, 560, 32)
    lo.hide_render = True; hi.hide_render = False
    kb.render(os.path.join(kb.OUT, 'head_clay_hi.png'), 560, 560, 32)
