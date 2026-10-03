# Character building blocks (engine v2): armour plates, cloth and props built with bmesh on the shared rig (the
# Quaternius Universal Animation Library skeleton, CC0), skinned rigidly to one bone (plates) or blended across
# several (cloth), then exported with the armature as glTF for SkinnedAvatar (src/v2/avatar.ts).
#
# Blender space: Z up, metres. The rig stands in a T-pose facing -Y, and +X is the character's left.
import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
UAL2 = os.path.join(REPO, 'assets-src', 'packs', 'universal_animation_library_2standard', 'Universal Animation Library 2 [Standard]', 'Unreal-Godot', 'UAL2_Standard.glb')
OUT = os.path.join(REPO, 'public', 'chars')
PREVIEW = os.path.join(HERE, 'out')
TAU = 2 * math.pi


def V(*a):
    return Vector(a if len(a) == 3 else a[0])


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def load_rig():
    """The UAL 2 armature and its mannequin, with the library's animations removed (characters carry no clips)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=UAL2)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name.lower().startswith('icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
        arm.animation_data.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    man = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    bpy.context.view_layer.update()
    return arm, man


class Rig:
    """Rest-pose bone frames in armature space."""

    def __init__(self, arm):
        self.arm = arm
        self.b = arm.data.bones

    def head(self, n):
        return self.b[n].head_local.copy()

    def tail(self, n):
        return self.b[n].tail_local.copy()

    def at(self, n, t):
        return self.head(n).lerp(self.tail(n), t)

    def axis(self, n):
        return (self.tail(n) - self.head(n)).normalized()


_mats = {}


def material(name, color, metal=0.0, rough=0.6, sheen=0.0, coat=0.0):
    """A Principled material by name (the game recognises its name and builds its own shader for it)."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(color), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if sheen and 'Sheen Weight' in b.inputs:
        b.inputs['Sheen Weight'].default_value = sheen
    if coat and 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
    _mats[name] = m
    return m


def frame(axis, ref):
    """A basis (columns x, y, z) with y along `axis` and x toward `ref`, both made perpendicular."""
    y = Vector(axis).normalized()
    r = Vector(ref)
    x = r - y * r.dot(y)
    if x.length < 1e-6:
        x = Vector((1, 0, 0)) if abs(y.x) < 0.9 else Vector((0, 0, 1))
        x = x - y * x.dot(y)
    x.normalize()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def basis(x, y, z):
    return Matrix((Vector(x), Vector(y), Vector(z))).transposed()


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


class Piece:
    """One part (a plate, a strap, a cloth panel) built as a surface in bmesh; finish() thickens, bevels, smooths and
    skins it. `mats` names the materials its faces use (index 0 by default)."""

    def __init__(self, name, mats):
        self.name = name
        self.bm = bmesh.new()
        self.mats = list(mats)
        self.cur = 0

    def mat(self, i):
        self.cur = i
        return self

    def _grid(self, pts, rows, cols, wrap=False, flip=False):
        vs = [self.bm.verts.new(p) for p in pts]
        cw = cols if wrap else cols - 1
        for i in range(rows - 1):
            for j in range(cw):
                a = vs[i * cols + j]
                b = vs[i * cols + (j + 1) % cols]
                c = vs[(i + 1) * cols + (j + 1) % cols]
                d = vs[(i + 1) * cols + j]
                f = self.bm.faces.new((a, d, c, b) if flip else (a, b, c, d))
                f.material_index = self.cur
        return vs

    def lathe(self, p0, p1, profile, ref=(0, 0, 1), segs=32, ex=1.0, ez=1.0, a0=0.0, a1=TAU, shape=None, flip=False):
        """A surface of revolution along p0→p1. profile: (t, r) pairs, t along the axis (may run past 0..1), r the
        radius; the cross-section is an ellipse (r·ex toward `ref`, r·ez across), over angles a0..a1 (0 toward ref).
        shape(angle, t) scales the radius locally (a ridge, a flare)."""
        p0, p1 = Vector(p0), Vector(p1)
        ax = p1 - p0
        F = frame(ax, ref)
        x, z = F.col[0], F.col[2]
        full = abs((a1 - a0) - TAU) < 1e-6
        n = segs if full else segs + 1
        pts = []
        for (t, r) in profile:
            c = p0 + ax * t
            for j in range(n):
                a = a0 + (a1 - a0) * j / segs
                k = shape(a, t) if shape else 1.0
                pts.append(c + x * (math.cos(a) * r * ex * k) + z * (math.sin(a) * r * ez * k))
        self._grid(pts, len(profile), n, wrap=full, flip=flip)
        return self

    def shell(self, center, rx, ry, rz, B=Matrix.Identity(3), u0=0.0, u1=TAU, v0=-math.pi / 2, v1=math.pi / 2, su=32, sv=16, power=2.0, shape=None, flip=False):
        """A patch of a superellipsoid (power 2: an ellipsoid; higher: boxier) in basis B about `center`. u is the
        angle about local z from +x, v the elevation from the xy plane. shape(u, v) scales the radius locally."""
        e = 2.0 / power
        center = Vector(center)
        full = abs((u1 - u0) - TAU) < 1e-6
        n = su if full else su + 1
        pts = []
        for i in range(sv + 1):
            v = v0 + (v1 - v0) * i / sv
            cv, sn = math.cos(v), math.sin(v)
            for j in range(n):
                u = u0 + (u1 - u0) * j / su
                k = shape(u, v) if shape else 1.0
                lp = Vector((rx * spow(cv, e) * spow(math.cos(u), e), ry * spow(cv, e) * spow(math.sin(u), e), rz * spow(sn, e))) * k
                pts.append(center + B @ lp)
        self._grid(pts, sv + 1, n, wrap=full, flip=flip)
        return self

    def box(self, center, size, B=Matrix.Identity(3), bevel=0.01, segs=2):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, 0.45 * min(size)), segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
        for v in bm.verts:
            v.co = Vector(center) + B @ v.co
        for f in bm.faces:
            f.material_index = self.cur
        self._absorb(bm)
        return self

    def torus(self, center, R, r, B=Matrix.Identity(3), segs=32, rsegs=10, a0=0.0, a1=TAU, rx=1.0, ry=1.0, rz=1.0):
        """A ring about local z (radius R, tube r): straps, rims, rings. rx/ry stretch the ring into an ellipse,
        rz flattens the tube vertically."""
        full = abs((a1 - a0) - TAU) < 1e-6
        n = segs if full else segs + 1
        pts = []
        for j in range(n):
            a = a0 + (a1 - a0) * j / segs
            c = Vector((math.cos(a) * R * rx, math.sin(a) * R * ry, 0))
            out = Vector((math.cos(a), math.sin(a), 0))
            for i in range(rsegs):
                b = TAU * i / rsegs
                pts.append(Vector(center) + B @ (c + out * (math.cos(b) * r) + Vector((0, 0, math.sin(b) * r * rz))))
        self._grid_t(pts, n, rsegs, full)
        return self

    def _grid_t(self, pts, n, m, wrap_n):
        vs = [self.bm.verts.new(p) for p in pts]
        rows = n if wrap_n else n - 1
        for j in range(rows):
            for i in range(m):
                a = vs[j * m + i]
                b = vs[j * m + (i + 1) % m]
                c = vs[((j + 1) % n) * m + (i + 1) % m]
                d = vs[((j + 1) % n) * m + i]
                f = self.bm.faces.new((a, b, c, d))
                f.material_index = self.cur

    def _absorb(self, bm):
        mp = {}
        for v in bm.verts:
            mp[v] = self.bm.verts.new(v.co)
        for f in bm.faces:
            nf = self.bm.faces.new([mp[v] for v in f.verts])
            nf.material_index = f.material_index
        bm.free()

    def sweep(self, pts, radius, segs=10, closed=False, rz=1.0, ref=(0, 0, 1), caps=True):
        """A tube along a polyline: straps, beads, rims, cords. `radius` may be a number or fn(i/n); rz flattens
        the section across `ref` (a strap lying on a surface whose normal is ref)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        ring = []
        for i, p in enumerate(pts):
            a = pts[(i - 1) % n] if (closed or i > 0) else p
            b = pts[(i + 1) % n] if (closed or i < n - 1) else p
            t = (b - a).normalized()
            N = Vector(ref) - t * Vector(ref).dot(t)
            if N.length < 1e-6:
                N = t.orthogonal()
            N.normalize()
            Bn = t.cross(N)
            r = radius(i / max(1, n - 1)) if callable(radius) else radius
            for k in range(segs):
                ang = TAU * k / segs
                ring.append(p + N * (math.cos(ang) * r * rz) + Bn * (math.sin(ang) * r))
        vs = [self.bm.verts.new(q) for q in ring]
        rows = n if closed else n - 1
        for i in range(rows):
            for k in range(segs):
                a0 = vs[i * segs + k]; a1 = vs[i * segs + (k + 1) % segs]
                b1 = vs[((i + 1) % n) * segs + (k + 1) % segs]; b0 = vs[((i + 1) % n) * segs + k]
                f = self.bm.faces.new((a0, b0, b1, a1))
                f.material_index = self.cur
        if caps and not closed:
            for i, sgn in ((0, 1), (n - 1, -1)):
                c = self.bm.verts.new(pts[i])
                for k in range(segs):
                    a0 = vs[i * segs + k]; a1 = vs[i * segs + (k + 1) % segs]
                    f = self.bm.faces.new((c, a1, a0) if sgn > 0 else (c, a0, a1))
                    f.material_index = self.cur
        return self

    def cut(self, pred):
        """Removes faces whose centre satisfies pred (an eye slit, a hole)."""
        dead = [f for f in self.bm.faces if pred(f.calc_center_median())]
        bmesh.ops.delete(self.bm, geom=dead, context='FACES')
        return self

    def deform(self, fn):
        for v in self.bm.verts:
            v.co = fn(v.co.copy())
        return self

    def outward(self, ref, axis=None):
        """Turns the surface so its normals face away from a point (or from the line through it along `axis`),
        which thickening and shading rely on."""
        self.bm.normal_update()
        ref = Vector(ref)
        s = 0.0
        for f in self.bm.faces:
            c = f.calc_center_median()
            d = c - ref
            if axis is not None:
                a = Vector(axis).normalized()
                d = d - a * d.dot(a)
            s += f.normal.dot(d) * f.calc_area()
        if s < 0:
            bmesh.ops.reverse_faces(self.bm, faces=self.bm.faces[:])
        return self

    def finish(self, weights, thick=0.0, bevel=0.0, bevel_segs=2, subsurf=0, inner=None, rim=None, sharp_angle=40, smooth=True):
        """The piece as an object: optional subdivision, thickness (inward; inner faces take material index `inner`),
        rounded rims, smooth shading with sharp edges past `sharp_angle`, and skin weights: a bone name (rigid) or
        fn(co) -> {bone: weight}."""
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for nm in self.mats:
            me.materials.append(bpy.data.materials[nm])
        for p in me.polygons:
            p.use_smooth = smooth
        if subsurf:
            m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
        if thick:
            m = ob.modifiers.new('thick', 'SOLIDIFY'); m.thickness = thick; m.offset = -1.0; m.use_rim = True
            m.use_even_offset = True
            if inner is not None:
                m.material_offset = inner
            if rim is not None:
                m.material_offset_rim = rim
        if bevel:
            m = ob.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = bevel_segs; m.limit_method = 'ANGLE'
            m.angle_limit = math.radians(35); m.harden_normals = False
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        ob.select_set(False)
        # Sharp edges past the angle; the rest shade smooth.
        bm = bmesh.new(); bm.from_mesh(ob.data)
        lim = math.radians(sharp_angle)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim:
                e.smooth = False
        bm.to_mesh(ob.data); bm.free()
        skin(ob, weights)
        return ob


def skin(ob, weights):
    if isinstance(weights, str):
        g = ob.vertex_groups.new(name=weights)
        g.add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
        return
    groups = {}
    for v in ob.data.vertices:
        ws = weights(v.co)
        tot = sum(ws.values()) or 1.0
        for bn, w in ws.items():
            if w <= 1e-4:
                continue
            if bn not in groups:
                groups[bn] = ob.vertex_groups.new(name=bn)
            groups[bn].add([v.index], w / tot, 'REPLACE')


def mirror_x(ob):
    """A left piece's right twin: mirrored across x, with its _l bone weights renamed _r."""
    me = ob.data.copy()
    o2 = bpy.data.objects.new(ob.name.replace('_l', '_r').replace('.L', '.R'), me)
    bpy.context.scene.collection.objects.link(o2)
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    # Vertex weights come with the mesh data, matched to groups by index; newer Blender keeps the group names on the
    # mesh too (then the copy already has them and they are renamed), older on the object (then they are created).
    rn = lambda n: n[:-2] + '_r' if n.endswith('_l') else n
    if len(o2.vertex_groups) == len(ob.vertex_groups):
        for g in o2.vertex_groups:
            g.name = rn(g.name)
    else:
        for g in ob.vertex_groups:
            o2.vertex_groups.new(name=rn(g.name))
    return o2


def assemble(arm, obs, name):
    """Joins pieces into one skinned mesh on the armature."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob.data.validate(clean_customdata=False)
    ob.parent = arm
    m = ob.modifiers.new('rig', 'ARMATURE'); m.object = arm
    return ob


def export(arm, meshes, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False, export_skins=True,
                              export_morph=False, export_materials='EXPORT', export_yup=True, export_apply=False)
    tris = sum(len(p.vertices) - 2 for m in meshes for p in m.data.polygons)
    print('exported', path, os.path.getsize(path), 'bytes', tris, 'tris')
    return path


def pose_rest_a(arm, down=62):
    """Arms lowered from the T-pose (for previews): the upper arms swing down about the forward axis."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for side, s in (('l', 1), ('r', -1)):
        pb = arm.pose.bones['upperarm_' + side]
        B = arm.data.bones['upperarm_' + side].matrix_local.to_3x3()
        q = Matrix.Rotation(math.radians(down) * s, 3, 'Y')
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (B.inverted() @ q @ B).to_quaternion()
    bpy.ops.object.mode_set(mode='OBJECT')


def preview(path, cam_pos, look, lens=50, w=900, h=1100, samples=64, sun=(-0.5, -0.7, 0.6), bg=(0.62, 0.66, 0.7)):
    sc = bpy.context.scene
    w_ = sc.world or bpy.data.worlds.new('w')
    sc.world = w_
    w_.use_nodes = True
    b = w_.node_tree.nodes['Background']
    b.inputs['Color'].default_value = (*bg, 1)
    b.inputs['Strength'].default_value = 1.0
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 2.6; sd.angle = math.radians(10)
    so = bpy.data.objects.new('sun', sd); sc.collection.objects.link(so)
    so.rotation_euler = Vector(sun).to_track_quat('Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam'); cd.lens = lens
    co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co)
    co.location = Vector(cam_pos)
    co.rotation_euler = (Vector(look) - Vector(cam_pos)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    # Ground to catch the shadow.
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    g = bpy.context.active_object
    g.data.materials.append(material('preview_ground', '#7d7a70', rough=0.9))
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples
    try:
        sc.cycles.device = 'GPU'
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for t in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = t
                prefs.get_devices()
                for d in prefs.devices:
                    d.use = True
                break
            except Exception:
                pass
    except Exception:
        pass
    sc.render.resolution_x = w; sc.render.resolution_y = h
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(g, do_unlink=True)
    print('preview', path)
