# Grooms the kitten's head fur and whiskers as strands (from out/kitten_head.npz) and writes public/models/*.kkf.
# With KK_PREVIEW=1 it also renders a Cycles close-up of the groomed head for review.
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import kk_groom as G
from kitten_head import head_sdf, EYE, NOSEP, eye_frame, eye_ap, APERTURE
from kitten_head_build import ss, eye_dist, nose_dist, lid_margin, mouth_mask, head_color, PUB
from kk_sdf import gradient
import kk_blender as kb

NP = 8
rng = np.random.default_rng(7)


def len_map(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    nd, ed = nose_dist(p), eye_dist(p)
    tissue = 1 - ss(nd, 0.95, 1.25)
    L = np.ones(len(p))
    L *= 0.14 + 0.86 * ss(ed, 1.05, 1.8)
    L *= 1 - tissue
    L *= 0.22 + 0.78 * ss(nd, 1.15, 2.6)
    face = ss(z, 0.012, 0.03) * (1 - ss(np.abs(x), 0.02, 0.036))
    L *= 1 - 0.5 * face
    L *= np.where((z > 0.024) & (y < 0.002), 0.62, 1.0)
    L *= 1 + 0.7 * ss(np.abs(x), 0.026, 0.046) * (1 - ss(y, -0.008, 0.012))   # cheek fluff
    L *= 1 + 0.7 * ss(-y, 0.026, 0.05)                                          # ruff
    L *= 1 + 0.2 * ss(y, 0.02, 0.04)                                            # crown
    return L


def flow(p, n):
    nose = np.array([0.0, -0.010, 0.046])
    r = p - nose
    d = r / np.linalg.norm(r, axis=1, keepdims=True)
    wg = 0.2 + 0.45 * ss(-p[:, 2], -0.01, 0.03) + 0.45 * ss(-p[:, 1], -0.01, 0.03)
    d = d + wg[:, None] * np.array([0, -1.0, 0])
    d = d + (0.35 * ss(p[:, 1], 0.0, 0.03))[:, None] * np.array([0, 0, -1.0])
    for s in (-1, 1):
        c = np.array([s * EYE['x'], EYE['y'], EYE['z']])
        re = p - c
        re /= np.linalg.norm(re, axis=1, keepdims=True)
        we = (1 - ss(eye_dist(p), 1.1, 1.9)) * 0.9 * (np.sign(p[:, 0]) == s)
        d = d + we[:, None] * re
    return G.tangent_project(d, n)


def lift_map(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    a = 30 + 14 * ss(np.abs(x), 0.02, 0.045) + 10 * ss(y, 0.01, 0.04) + 16 * ss(-y, 0.02, 0.05)
    a *= 0.4 + 0.6 * ss(eye_dist(p), 1.1, 1.8)
    face = ss(z, 0.014, 0.032) * (1 - ss(np.abs(x), 0.02, 0.034))
    a *= 1 - 0.55 * face
    return np.radians(a + rng.normal(0, 5, len(p)))


def mask(p):
    m = ss(nose_dist(p), 1.08, 1.22)
    m *= 1 - ss(lid_margin(p), 0.35, 0.8)
    m *= ss(eye_dist(p), 0.9, 0.97)
    m *= 1 - ss(mouth_mask(p), 0.2, 0.6)
    m *= ss(p[:, 1], -0.066, -0.055)   # nothing on the hidden underside of the neck
    return m


def blocked(pts):
    # Points that would cover an eye aperture or sit in front of the nose leather.
    P = pts.reshape(-1, 3)
    bad = np.zeros(len(P), bool)
    for s in (-1, 1):
        f, u, v = eye_frame(s)
        q = P - np.array([s * EYE['x'], EYE['y'], EYE['z']])
        dw = q @ f
        tu, tv = eye_ap(q @ u, q @ v, dw)
        tv = tv - APERTURE['tilt'] * s * tu
        rho = np.sqrt((tu / APERTURE['a_h']) ** 2 + (tv / APERTURE['a_v']) ** 2)
        bad |= (dw > 0) & (rho < 1.12)
    bad |= (nose_dist(P) < 1.18) & (P[:, 2] > NOSEP['z'] - 0.002)
    return bad.reshape(pts.shape[:2])


def shell_mask(p):
    # Undercoat everywhere except the eye apertures, lid margins, nose leather and mouth line.
    m = ss(nose_dist(p), 1.0, 1.14)
    m *= 1 - ss(lid_margin(p), 0.2, 0.6)
    m *= ss(eye_dist(p), 0.86, 0.94)
    m *= 1 - ss(mouth_mask(p), 0.15, 0.5)
    return m


def groom_head(count):
    # Guard coat as strands; the dense undercoat is drawn with shells in the game (see shell_attributes).
    D = np.load(os.path.join(kb.OUT, 'kitten_head.npz'))
    v, n, tris, tri_uv, ao_img = D['v'], D['n'], D['tris'], D['tri_uv'], D['ao']
    density = lambda p: 0.55 + 0.45 * ss(len_map(p), 0.4, 1.3)
    p, nn, ti, bary = G.sample_roots(v, n, tris, density, mask, count, rng)
    uv = (tri_uv[ti] * bary[:, :, None]).sum(1)
    L = 0.0155 * len_map(p) * rng.uniform(0.72, 1.15, len(p))
    fly = rng.random(len(p)) < 0.02
    L[fly] *= rng.uniform(1.15, 1.45, fly.sum())
    d = flow(p, nn)
    lift = lift_map(p) * 0.8
    face = ss(p[:, 2], 0.014, 0.032) * (1 - ss(np.abs(p[:, 0]), 0.02, 0.034))
    pts = G.grow(p, nn, d, L, lift, NP, rng, droop=0.3, lay=0.72, frizz=np.where(fly, 0.1, 0.025), frizz_freq=1.3,
                 wave=np.where(fly, 0.22, 0.1 * (1 - 0.6 * face)), waves=rng.uniform(0.5, 1.2, len(p)))
    amt = 0.72 * (1 - 0.55 * face) + 0.15 * ss(-p[:, 1], 0.02, 0.05)
    amt[fly] = 0.1
    pts = G.clump(pts, p, amt, rng, guide_frac=0.035, radius=0.0055, power=1.25)
    sdf = head_sdf()
    pts = G.collide(pts, sdf, lambda q: gradient(sdf, q), 0.00035)
    # Trim strands that would cover the eyes or the nose leather.
    bad = blocked(pts)
    first = np.where(bad.any(1), bad.argmax(1), NP)
    frac = np.clip((first - 1) / (NP - 1), 0.0, 1.0)
    cut = first < NP
    pts[cut] = G.resample_length(pts[cut], np.maximum(frac[cut] * 0.9, 0.05))
    keep = ~(cut & (frac < 0.2))
    pts, p, nn, uv, L = pts[keep], p[keep], nn[keep], uv[keep], L[keep]
    col = head_color(p) * rng.uniform(0.9, 1.07, len(p))[:, None]
    col *= np.array([1.0, 0.985, 0.97]) ** rng.normal(0, 1, (len(p), 1))
    ao = G.bilinear(ao_img, uv)
    width = (0.00013 + 0.00005 * ss(L, 0.008, 0.025)) * rng.uniform(0.8, 1.2, len(p))
    width *= 1 - 0.3 * ss(p[:, 2], 0.014, 0.032) * (1 - ss(np.abs(p[:, 0]), 0.02, 0.034))
    # Sorted by LOD rank so the game can skip the tail of the list when the head is small on screen.
    rank = rng.random(len(p))
    o = np.argsort(rank)
    return pts[o], col[o], ao[o], width[o], nn[o], rank[o]


def shell_attributes():
    pos, nrm = G.read_glb(os.path.join(PUB, 'kitten_head_shell.glb'))
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    length = np.minimum(0.0058 * len_map(pos), 0.0072) * shell_mask(pos)
    G.write_shell(os.path.join(PUB, 'kitten_head_shell.bin'), length, flow(pos, nrm))
    return len(pos)


def whiskers():
    # Pad whiskers in four rows per side, a few brow whiskers; long, stiff, pale, slightly drooping.
    P = 8
    roots, dirs, lens = [], [], []
    for s in (-1, 1):
        for row in range(4):
            for j in range(3 if row < 3 else 2):
                x = s * (0.0062 + 0.0026 * j + 0.0006 * row)
                y = NOSEP['y'] - 0.0068 - 0.0021 * row + 0.0004 * j
                z = NOSEP['z'] - 0.0032 - 0.0021 * j - 0.0006 * row
                roots.append((x, y, z))
                ang = 0.25 - 0.12 * row + rng.normal(0, 0.05)
                dirs.append((s * np.cos(ang) * 0.9, np.sin(ang) - 0.12, 0.42 - 0.05 * row))
                lens.append(0.046 - 0.004 * row + rng.normal(0, 0.002))
        for j in range(3):
            roots.append((s * (0.012 + 0.006 * j), 0.0105 + 0.001 * j, 0.0345 - 0.004 * j))
            dirs.append((s * 0.55, 0.75, 0.35))
            lens.append(0.026 - 0.003 * j)
    roots, dirs, lens = np.array(roots), np.array(dirs, float), np.array(lens)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    pts = np.zeros((len(roots), P, 3))
    for i in range(len(roots)):
        d = dirs[i].copy(); q = roots[i].copy()
        pts[i, 0] = q
        for k in range(1, P):
            t = k / (P - 1)
            d = d + np.array([0, -0.06, 0]) * t + np.array([0, 0, 0.02])
            d /= np.linalg.norm(d)
            q = q + d * lens[i] / (P - 1)
            pts[i, k] = q
    col = np.tile(np.array([0.92, 0.9, 0.86]), (len(roots), 1))
    ao = np.full(len(roots), 0.9)
    width = np.full(len(roots), 0.00034)
    nn = dirs
    return pts, col, ao, width, nn


def preview(pts, col, width, wpts, out_png):
    import bpy
    import kitten_head_build as HB
    bpy.ops.wm.open_mainfile(filepath=os.path.join(kb.OUT, 'kitten_head_baked.blend'))
    sc = bpy.context.scene
    lo = bpy.data.objects['Head']
    for o in list(sc.objects):
        if o.name not in ('Head',):
            if o.type == 'MESH' and o.name.startswith('Sphere'):
                continue
            o.hide_render = True
    # Textured skin.
    m = bpy.data.materials.new('skin'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    for key, socket, cs in (('albedo', 'Base Color', 'sRGB'), ('normal', None, 'Non-Color')):
        im = bpy.data.images.load(os.path.join(PUB, f'kitten_head_{key}.png')); im.colorspace_settings.name = cs
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = im
        if socket:
            nt.links.new(tx.outputs['Color'], b.inputs[socket])
        else:
            nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tx.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.7
    lo.data.materials.clear(); lo.data.materials.append(m)
    eyem = kb.clay('eyeM', (0.012, 0.01, 0.008), 0.03)
    for o in sc.objects:
        if o.name.startswith('Sphere'):
            o.data.materials.clear(); o.data.materials.append(eyem); o.hide_render = False
            for poly in o.data.polygons: poly.use_smooth = True
    fur = G.curves_object('Fur', pts, width * 0.5, col, kb.g2b)
    fur.data.materials.append(G.hair_material('fur', 0.4))
    wk = G.curves_object('Whiskers', wpts, np.full(len(wpts), 0.00017), np.tile([0.9, 0.88, 0.84], (len(wpts), 1)), kb.g2b, 0.3)
    wk.data.materials.append(G.hair_material('wk', 0.25))
    sc.world = kb.overcast_world(1.15)
    kb.add_sun(strength=1.6, angle_deg=25)
    kb.add_camera((-0.06, 0.004, 0.26), (0, -0.006, 0.0), lens=85)
    sc.render.hair_type = 'STRIP' if hasattr(sc.render, 'hair_type') else sc.render.hair_type
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 16
    kb.render(out_png, 640, 640, int(os.environ.get('KK_SAMPLES', 48)))


if __name__ == '__main__':
    t = time.time()
    pts, col, ao, width, nn, rank = groom_head(int(os.environ.get('KK_COUNT', 56000)))
    print('head strands', len(pts), 'in', round(time.time() - t, 1), 's')
    G.write_kkf(os.path.join(PUB, 'kitten_head.kkf'), pts.astype(np.float32), col, ao, width, nn, rank=rank)
    wpts, wcol, wao, ww, wn = whiskers()
    G.write_kkf(os.path.join(PUB, 'kitten_whiskers.kkf'), wpts.astype(np.float32), wcol, wao, ww, wn, rank=np.zeros(len(wpts)))
    print('shell vertices', shell_attributes())
    np.savez_compressed(os.path.join(kb.OUT, 'kitten_head_groom.npz'), pts=pts, col=col, width=width, wpts=wpts)
    print('sizes', os.path.getsize(os.path.join(PUB, 'kitten_head.kkf')), os.path.getsize(os.path.join(PUB, 'kitten_whiskers.kkf')))
    if os.environ.get('KK_PREVIEW'):
        preview(pts, col, width, wpts, os.path.join(kb.OUT, 'head_groom.png'))
