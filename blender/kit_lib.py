# Stylized world kit: shared building blocks. Pieces are built in Blender's own space (Z up, metres) with bmesh, given
# painted per-vertex colours (COLOR) and masks (_MASKS: R occlusion, G worn edge, B cavity, A moss), and exported as
# standard Y-up glTF for the game's stylized material (src/v2/materials.ts).
#
# The look: chunky, softly bevelled shapes with a little hand-made irregularity (no ruler-straight CG edges), big
# readable silhouettes, and colour carried by the geometry rather than photographs, so it holds up close and far
# and stays consistent from piece to piece.
import os
import math
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, noise

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'kit')
os.makedirs(OUT, exist_ok=True)


def lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Builder:
    """Accumulates shapes (each built in its own small bmesh, so building stays fast however many there are) with a
    colour per vertex, then becomes one object."""

    def __init__(self, name):
        self.name = name
        self.V, self.F, self.C = [], [], []
        self.nv = 0

    def _flush(self, bm, colors):
        bm.verts.index_update()
        co = np.array([v.co[:] for v in bm.verts], np.float64).reshape(-1, 3)
        self.F.extend([[v.index + self.nv for v in f.verts] for f in bm.faces])
        self.V.append(co)
        c = np.asarray(colors, np.float64)
        self.C.append(np.tile(c, (len(co), 1)) if c.ndim == 1 else c)
        self.nv += len(co)
        bm.free()

    def box(self, center, size, color, rot=Matrix.Identity(3), bevel=0.04, segs=3, profile=0.6, bulge=0.0, sub=1,
            rough=0.0, chip=0.0, grad=0.0, seed=0.0):
        """A softly bevelled block: size (x, y, z) in metres, rotated by rot (3x3) about its centre. `bulge` swells the
        faces so the stone reads as dressed by hand; `chip` knocks off a corner or two; `rough` pecks the faces with
        noise; `grad` paints the top a little lighter and the underside darker."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        if sub > 1:
            bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=sub - 1, use_grid_fill=True)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        bw = min(bevel, 0.45 * min(size))
        if bw > 1e-4:
            # Only the block's real corners (not the flat grid edges a subdivision adds).
            edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > 0.4]
            bmesh.ops.bevel(bm, geom=edges, offset=bw, segments=segs, profile=profile, affect='EDGES', clamp_overlap=True)
        if bulge:
            for v in bm.verts:
                p = v.co
                k = 1 + bulge * (1 - abs(p.x / (size[0] * 0.5)) ** 2) * (1 - abs(p.y / (size[1] * 0.5)) ** 2) * (1 - abs(p.z / (size[2] * 0.5)) ** 2)
                v.co = Vector((p.x * k, p.y * k, p.z * k))
        if chip:
            rs = np.random.default_rng(int(seed * 7919) % (2 ** 31))
            for _ in range(1 + int(rs.random() < 0.4)):
                if rs.random() > chip:
                    continue
                cn = Vector((rs.choice((-1, 1)) * size[0] / 2, rs.choice((-1, 1)) * size[1] / 2, rs.choice((-1, 1)) * size[2] / 2))
                reach = rs.uniform(0.18, 0.32) * min(size)
                for v in bm.verts:
                    d = (v.co - cn).length
                    if d < reach * 2.2:
                        w = (1 - d / (reach * 2.2)) ** 2
                        v.co = v.co - cn.normalized() * w * reach * 0.6
        if rough:
            for v in bm.verts:
                p = v.co
                q = Vector((p.x * 3.1 + seed * 13.7, p.y * 3.1 + seed * 5.3, p.z * 3.1 + seed * 2.9))
                n = noise.noise(q) + 0.45 * noise.noise(q * 2.7)
                dirv = Vector((p.x / max(size[0], 1e-3), p.y / max(size[1], 1e-3), p.z / max(size[2], 1e-3)))
                if dirv.length > 1e-6:
                    v.co = p + dirv.normalized() * (rough * n)
        c0 = np.asarray(color, float)
        cols = []
        hz = max(size[2] * 0.5, 1e-3)
        for v in bm.verts:
            if grad:
                t = max(-1.0, min(1.0, v.co.z / hz)) if rot is None else max(-1.0, min(1.0, (rot @ v.co).z / hz))
                k = 1 + grad * (0.75 * t if t > 0 else 1.1 * t)
                cols.append(np.clip(c0 * k, 0, 1))
            v.co = rot @ v.co + Vector(center)
        self._flush(bm, np.array(cols) if grad else c0)

    def cylinder(self, center, radius, height, color, segs=40, bevel=0.0):
        """A capped cylinder standing on `center` (its base), for cores behind stone rings."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=height)
        for v in bm.verts:
            v.co = v.co + Vector((center[0], center[1], center[2] + height / 2))
        self._flush(bm, np.asarray(color, float))

    def mesh(self, verts_xyz, faces, color):
        bm = bmesh.new()
        vs = [bm.verts.new(Vector(p)) for p in verts_xyz]
        for f in faces:
            try:
                bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        self._flush(bm, np.asarray(color, float))

    def obj(self, smooth_angle=40):
        me = bpy.data.meshes.new(self.name)
        V = np.concatenate(self.V) if self.V else np.zeros((0, 3))
        me.from_pydata(V.tolist(), [], self.F)
        me.update()
        col = np.concatenate(self.C) if self.C else np.zeros((0, 3))
        rgba = np.ones((len(col), 4), np.float32); rgba[:, :3] = col
        a = me.color_attributes.new('COLOR', 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', rgba.ravel())
        me.color_attributes.active_color = a
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        # Smooth shading within each stone, hard where faces meet at a crease.
        try:
            for o in bpy.context.scene.objects:
                o.select_set(False)
            bpy.context.view_layer.objects.active = ob
            ob.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            pass
        return ob


def rot_z(a):
    return Matrix.Rotation(a, 3, 'Z')


def rot_xyz(rx, ry, rz):
    return Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X')


def jitter(rng, color, amount=0.06):
    c = np.asarray(color, float)
    return np.clip(c * (1 + rng.normal(0, amount)) * (1 + rng.normal(0, amount * 0.4, 3)), 0, 1)


def moss_and_masks(ob, ao_distance=0.6, samples=48, edge_radius=0.06, moss_low=0.0, moss_amount=1.0, seed=1, streaks=0.0):
    """Bake occlusion (Cycles) and derive worn-edge, cavity and moss masks per vertex into _MASKS; tint COLOR with
    moss where it grows: on what faces the sky and in the shelter of the foot of a wall."""
    me = ob.data
    n = len(me.vertices)
    if 'AOBAKE' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['AOBAKE'])
    ao_attr = me.color_attributes.new('AOBAKE', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ao_attr
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for dev in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = dev
                prefs.get_devices()
                if any(d.type == dev for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == dev
                    sc.cycles.device = 'GPU'
                    break
            except Exception:
                continue
    except Exception:
        sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = ao_distance
    for o in sc.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    rgba = np.empty(n * 4, np.float32)
    ao_attr.data.foreach_get('color', rgba)
    ao = rgba.reshape(-1, 4)[:, 0].copy()
    me.color_attributes.remove(ao_attr)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    d = co[e[:, 1]] - co[e[:, 0]]
    L2 = (d * d).sum(1) + 1e-14
    k0 = -2 * np.einsum('ij,ij->i', nr[e[:, 0]], d) / L2
    k1 = 2 * np.einsum('ij,ij->i', nr[e[:, 1]], d) / L2
    acc = np.zeros(n); cnt = np.zeros(n)
    np.add.at(acc, e[:, 0], k0); np.add.at(acc, e[:, 1], k1)
    np.add.at(cnt, e[:, 0], 1); np.add.at(cnt, e[:, 1], 1)
    curv = acc / np.maximum(cnt, 1)
    edge = np.clip((curv * edge_radius - 0.25) / 0.9, 0, 1)
    cav = np.clip((-curv * edge_radius - 0.2) / 0.9, 0, 1)
    # Moss: on faces that look up and in the damp at the foot, broken up by noise.
    nz = nr[:, 2]
    blot = np.array([noise.noise(Vector((p[0] * 1.7 + seed, p[1] * 1.7, p[2] * 1.7))) for p in co])
    fine = np.array([noise.noise(Vector((p[0] * 6.0, p[1] * 6.0 + seed, p[2] * 6.0))) for p in co])
    up = ss(nz, 0.35, 0.85)
    foot = 1 - ss(co[:, 2], moss_low + 0.05, moss_low + 0.6)
    moss = np.clip((up * 0.9 + foot * 0.75) * ss(blot + 0.25 * fine, -0.15, 0.35) * moss_amount, 0, 1)
    moss *= np.clip(0.4 + 0.6 * ao, 0, 1)
    masks = np.stack([ao, edge, cav, moss], 1).astype(np.float32)
    if '_MASKS' in me.attributes:
        me.attributes.remove(me.attributes['_MASKS'])
    m = me.attributes.new('_MASKS', 'FLOAT_COLOR', 'POINT')
    m.data.foreach_set('color', masks.ravel())
    # Fold moss into the painted colour as well, so it reads even without the game's material.
    colattr = me.color_attributes['COLOR']
    rgba = np.empty(n * 4, np.float32); colattr.data.foreach_get('color', rgba); rgba = rgba.reshape(-1, 4)
    mossc = lin('#5f7a3c')
    rgba[:, :3] = rgba[:, :3] * (1 - moss[:, None] * 0.85) + mossc[None, :] * (moss[:, None] * 0.85)
    if streaks:
        # Rain streaks down the faces from the top: dark runs, strongest high up, broken along the wall.
        top = co[:, 2].max()
        run = np.array([noise.noise(Vector((p[0] * 2.2 + seed, p[1] * 2.2, 0.0))) for p in co])
        s = ss(run, 0.05, 0.5) * ss(co[:, 2], top * 0.35, top * 0.95) * (1 - ss(np.abs(nz), 0.3, 0.7)) * streaks
        rgba[:, :3] *= (1 - 0.32 * s)[:, None]
    colattr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = colattr
    return ob


def export(obs, name):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
        ca = o.data.color_attributes
        i = [a.name for a in ca].index('COLOR')
        ca.active_color_index = i
        ca.render_color_index = i
    bpy.context.view_layer.objects.active = obs[0]
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_materials='NONE',
              export_normals=True, export_texcoords=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
              export_apply=True, export_attributes=True)
    try:
        # Without a material, Blender 4.2+ exports the active colours only when asked to.
        bpy.ops.export_scene.gltf(**kw, export_active_vertex_color_when_no_material=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    tris = sum(len(p.vertices) - 2 for o in obs for p in o.data.polygons)
    print('exported', name, os.path.getsize(path), 'bytes', tris, 'tris')
    return path


def preview(path, cam_pos, look, lens=35, w=960, h=640, samples=48, sun=(-0.45, -0.6, 0.65)):
    """A quick Cycles look at the scene under an overcast sky with a soft sun, using the painted colours."""
    sc = bpy.context.scene
    mat = bpy.data.materials.new('painted')
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = 'COLOR'
    nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    for o in sc.objects:
        if o.type == 'MESH':
            o.data.materials.clear(); o.data.materials.append(mat)
    w_ = sc.world or bpy.data.worlds.new('w'); sc.world = w_
    w_.use_nodes = True
    bg = w_.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.66, 0.7, 1); bg.inputs['Strength'].default_value = 1.1
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 2.2; sd.angle = math.radians(14)
    so = bpy.data.objects.new('sun', sd); sc.collection.objects.link(so)
    so.rotation_euler = Vector(sun).to_track_quat('Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam'); cd.lens = lens
    co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co)
    co.location = Vector(cam_pos)
    co.rotation_euler = (Vector(look) - Vector(cam_pos)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples
    sc.render.resolution_x = w; sc.render.resolution_y = h
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('preview', path)
