# Builds the kitten head hero asset: high sculpt -> game mesh with UVs -> baked albedo, normal, AO and roughness
# -> public/models/kitten_head.glb + textures, plus out/kitten_head.npz (game-space surface data for the groom).
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
import kk_blender as kb
from kitten_head import build, EYE, SOCK, NOSEP, eye_frame, eye_ap, APERTURE
from kk_sdf import capsule

PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')
TEX = 1024


def lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# Peach-cream coat with soft tabby markings, as in the reference clip (its haze and colour cast removed).
COAT, COAT_DARK, CREAM = lin('#d9b49a'), lin('#9f765e'), lin('#f0e2d4')
NOSE, NOSE_DARK, LID, LIP = lin('#d99a93'), lin('#a8645f'), lin('#2b1f19'), lin('#4a302b')


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)[..., None]
    return a + (b - a) * t


def eye_dist(p):
    d = []
    for s in (-1, 1):
        d.append(np.sqrt(((p[:, 0] - s * SOCK['x']) / SOCK['rx']) ** 2 + ((p[:, 1] - SOCK['y']) / SOCK['ry']) ** 2 + ((p[:, 2] - SOCK['z']) / SOCK['rz']) ** 2))
    return np.minimum(*d)


def nose_dist(p):
    N = NOSEP
    return np.sqrt(((p[:, 0] - N['x']) / N['rx']) ** 2 + ((p[:, 1] - N['y']) / N['ry']) ** 2 + ((p[:, 2] - N['z']) / N['rz']) ** 2)


def lid_margin(p, a_h=APERTURE['a_h'], a_v=APERTURE['a_v'], tilt=APERTURE['tilt']):
    # 1 on the thin dark lid margin and the aperture walls, 0 elsewhere.
    out = np.zeros(len(p))
    R = EYE['r'] + 0.00035
    for s in (-1, 1):
        f, u, v = eye_frame(s)
        q = p - np.array([s * EYE['x'], EYE['y'], EYE['z']])
        du, dv, dw = q @ u, q @ v, q @ f
        tu, tv = eye_ap(du, dv, dw)
        tv = tv - tilt * s * tu
        rho = np.sqrt((tu / a_h) ** 2 + (tv / a_v) ** 2)
        r = np.linalg.norm(q, axis=1)
        m = (1 - ss(r - R, 0.0003, 0.0012)) * (1 - ss(rho, 1.02, 1.12)) * (dw > 0)
        out = np.maximum(out, m)
    return out


def mouth_mask(p):
    N = NOSEP
    ym, zm = N['y'] - 0.0074, N['z'] - 0.0014
    caps = [capsule((0, ym, zm), (s * 0.0062, ym - 0.0022, zm - 0.0042), 0.0005, 0.0003) for s in (-1, 1)]
    caps.append(capsule((0, N['y'] - N['ry'] * 0.6, N['z'] + 0.0028), (0, N['y'] - 0.0072, N['z'] - 0.0012), 0.00055))
    d = np.min([c(p[:, 0], p[:, 1], p[:, 2]) for c in caps], axis=0)
    return 1 - ss(d, 0.0002, 0.0011)


_WOB = np.random.default_rng(3).normal(size=(4, 3))


def wobble(p, f):
    # Cheap smooth noise in [-1, 1] for breaking up markings.
    w = sum(np.sin(f * (p @ (d / np.linalg.norm(d))) + 1.7 * i) for i, d in enumerate(_WOB))
    return w / 4


def head_color(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    c = np.tile(COAT, (len(p), 1))
    muzzle = ss(z, 0.016, 0.032) * (1 - ss(y, -0.0145, -0.0075))
    c = mix(c, CREAM, muzzle * 0.9)
    c = mix(c, CREAM, ss(-y, 0.024, 0.04) * 0.75)
    c = mix(c, CREAM, ss(np.abs(x), 0.022, 0.04) * (1 - ss(y, -0.012, 0.006)) * 0.45)
    # Soft, broken tabby lines: a few running up from between the eyes and fanning out over the crown.
    brk = 0.5 + 0.5 * wobble(p, 260.0)
    crown = ss(y, 0.014, 0.03) * (1 - muzzle)
    stripe = (0.5 + 0.5 * np.cos(x * 190 + np.sin(z * 90) * 0.9 + 0.8 * wobble(p, 120.0))) ** 4
    c = mix(c, COAT_DARK, crown * stripe * 0.34 * (0.4 + 0.6 * brk))
    fore = ss(y, 0.001, 0.013) * ss(z, -0.01, 0.02) * (1 - ss(np.abs(x), 0.015, 0.028))
    fan = x * (1.0 + 18.0 * np.maximum(y - 0.01, 0)) + 0.0009 * wobble(p, 150.0)
    lines = (0.5 + 0.5 * np.cos(2 * np.pi * fan / 0.0085)) ** 4
    c = mix(c, COAT_DARK * 0.85, fore * lines * 0.5 * (0.35 + 0.65 * brk))
    c = mix(c, COAT_DARK, ss(y, 0.02, 0.045) * ss(-z, -0.02, 0.03) * 0.35)  # warmer back of the head
    # Cheek lines running back from the outer corner of each eye.
    for sgn in (-1, 1):
        for a, off, k in ((0.0, 0.0, 0.5), (0.0045, -0.0055, 0.3)):
            c0 = np.array([sgn * (0.0245 + a), -0.006 + off, 0.0225 - a])
            d = np.array([sgn * 0.55, -0.28, -0.79]); d /= np.linalg.norm(d)
            q = p - c0
            along = q @ d
            perp = np.linalg.norm(q - along[:, None] * d[None, :], axis=1)
            line = (1 - ss(perp, 0.0009, 0.0024)) * ss(along, -0.001, 0.003) * (1 - ss(along, 0.012, 0.022))
            c = mix(c, COAT_DARK, line * k * (np.sign(x) == sgn))
    nd = nose_dist(p)
    nose = 1 - ss(nd, 0.92, 1.12)
    c = mix(c, mix(NOSE_DARK, NOSE, ss(nd, 0.2, 0.75) * (1 - ss(nd, 0.8, 1.0)) + 0.2), nose)
    c = mix(c, LIP, mouth_mask(p) * 0.85)
    c = mix(c, LID, lid_margin(p))
    return c


def head_rough(p):
    r = np.full(len(p), 0.82)
    r = r + (0.36 - r) * (1 - ss(nose_dist(p), 0.92, 1.12))
    r = r + (0.28 - r) * lid_margin(p)
    r = r + (0.45 - r) * mouth_mask(p)
    return r


def set_point_colors(ob, name, cols):
    me = ob.data
    a = me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((len(cols), 4), np.float32); rgba[:, :3] = cols
    a.data.foreach_set('color', rgba.ravel())
    return a


def attr_material(name, color_attr, rough_attr=None, bump_attr=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    ca = nt.nodes.new('ShaderNodeAttribute'); ca.attribute_name = color_attr
    nt.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    if rough_attr:
        ra = nt.nodes.new('ShaderNodeAttribute'); ra.attribute_name = rough_attr
        nt.links.new(ra.outputs['Fac'], b.inputs['Roughness'])
    if bump_attr:
        # Fine cobblestone texture on the nose leather.
        ba = nt.nodes.new('ShaderNodeAttribute'); ba.attribute_name = bump_attr
        tc = nt.nodes.new('ShaderNodeTexCoord')
        vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 2600.0
        nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        nt.links.new(vo.outputs['Distance'], mul.inputs[0]); nt.links.new(ba.outputs['Fac'], mul.inputs[1])
        bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.8; bu.inputs['Distance'].default_value = 0.00012
        nt.links.new(mul.outputs[0], bu.inputs['Height'])
        nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def new_image(name, size, non_color):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def bake(lo, hi, kind, img, samples=8, extrusion=0.0007, pass_filter=None):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples
    mat = lo.data.materials[0]
    nodes = mat.node_tree.nodes
    tex = nodes.get('bake_target') or nodes.new('ShaderNodeTexImage')
    tex.name = 'bake_target'; tex.image = img
    nodes.active = tex
    for o in sc.objects:
        o.select_set(False)
    if hi is not None:
        hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    kw = dict(type=kind, use_selected_to_active=hi is not None, cage_extrusion=extrusion, margin=6, use_clear=True)
    if pass_filter:
        kw['pass_filter'] = pass_filter
    t = time.time()
    bpy.ops.object.bake(**kw)
    print('baked', kind, round(time.time() - t, 1), 's')


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save(img, path):
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


if __name__ == '__main__':
    os.makedirs(PUB, exist_ok=True); os.makedirs(kb.OUT, exist_ok=True)
    hi, lo, sdf = build()
    # Attributes on the high sculpt.
    hv = kb.b2g(kb.mesh_arrays(hi)[0])
    set_point_colors(hi, 'Col', head_color(hv))
    rough = head_rough(hv)
    set_point_colors(hi, 'Rough', np.repeat(rough[:, None], 3, 1))
    nm = 1 - ss(nose_dist(hv), 0.85, 1.05)
    set_point_colors(hi, 'NoseMask', np.repeat(nm[:, None], 3, 1))
    hi.data.materials.append(attr_material('hiMat', 'Col', 'Rough', 'NoseMask'))
    # UVs on the game mesh.
    kb.select_only(lo)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=np.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    lo.data.materials.append(kb.clay('loMat'))
    # Eyeballs occlude the lids for AO.
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=EYE['r'], segments=48, ring_count=24,
                                             location=tuple(kb.g2b(np.array([s * EYE['x'], EYE['y'], EYE['z']]))))
    imgs = {
        'albedo': new_image('albedo', TEX, False), 'normal': new_image('normal', TEX, True),
        'rough': new_image('rough', TEX, True), 'ao': new_image('ao', TEX, True),
    }
    bake(lo, hi, 'DIFFUSE', imgs['albedo'], pass_filter={'COLOR'})
    bake(lo, hi, 'NORMAL', imgs['normal'])
    bake(lo, hi, 'ROUGHNESS', imgs['rough'])
    hi.hide_render = True
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.012
    bake(lo, None, 'AO', imgs['ao'], samples=96)
    save(imgs['albedo'], os.path.join(PUB, 'kitten_head_albedo.png'))
    save(imgs['normal'], os.path.join(PUB, 'kitten_head_normal.png'))
    # ORM: R = AO, G = roughness, B = metalness (0).
    orm = new_image('orm', TEX, True)
    pa, pr = pixels(imgs['ao']), pixels(imgs['rough'])
    o = np.zeros_like(pa); o[..., 0] = pa[..., 0]; o[..., 1] = pr[..., 0]; o[..., 3] = 1
    orm.pixels.foreach_set(o.ravel())
    save(orm, os.path.join(PUB, 'kitten_head_orm.png'))
    # Lighter copy of the game mesh for the undercoat shells, which don't need the lid or nostril detail.
    sh = lo.copy(); sh.data = lo.data.copy(); sh.name = 'HeadShell'
    sc.collection.objects.link(sh)
    dec = sh.modifiers.new('dec', 'DECIMATE'); dec.decimate_type = 'COLLAPSE'; dec.ratio = 0.3
    dec.use_collapse_triangulate = True
    kb.apply_modifiers(sh)
    kb.select_only(sh)
    sh.data.materials.clear()
    bpy.ops.export_scene.gltf(filepath=os.path.join(PUB, 'kitten_head_shell.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_materials='NONE', export_normals=True, export_texcoords=True, export_apply=True)
    print('shell mesh', len(sh.data.polygons), 'faces')
    # Game mesh export.
    kb.select_only(lo)
    lo.data.materials.clear()
    bpy.ops.export_scene.gltf(filepath=os.path.join(PUB, 'kitten_head.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_materials='NONE', export_normals=True, export_texcoords=True, export_tangents=True, export_apply=True)
    # Surface data for the groom (game space).
    me = lo.data
    me.calc_loop_triangles()
    v = kb.b2g(kb.mesh_arrays(lo)[0])
    tris = np.array([t.vertices[:] for t in me.loop_triangles], np.int32)
    tri_loops = np.array([t.loops[:] for t in me.loop_triangles], np.int32)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    vn = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', vn); vn = kb.b2g(vn.reshape(-1, 3))
    np.savez_compressed(os.path.join(kb.OUT, 'kitten_head.npz'), v=v, n=vn, tris=tris, tri_uv=uv[tri_loops], ao=pixels(imgs['ao'])[..., 0])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'kitten_head_baked.blend'))
    print('done', len(v), 'verts', len(tris), 'tris')
