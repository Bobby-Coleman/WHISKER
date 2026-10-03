# Hard-surface helpers for plate armour and swords: lathed plates with real thickness, rolled edges, rivets,
# built directly in game coordinates (Y up, +Z forward) and exported without axis conversion;
# per-vertex AO and edge masks (no UVs: the game's metal shader is procedural), and named GLB export.
import os
import numpy as np
import bpy
import bmesh
import kk_blender as kb


def _new_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _orient_outward(ob, center_fn):
    # Flip the whole mesh if most normals point toward the lathe axis (or toward center_fn(p)).
    me = ob.data
    n = len(me.polygons)
    if n == 0:
        return
    c = np.empty(n * 3); me.polygons.foreach_get('center', c); c = c.reshape(-1, 3)
    nn = np.empty(n * 3); me.polygons.foreach_get('normal', nn); nn = nn.reshape(-1, 3)
    out = c - center_fn(c)
    if (np.einsum('ij,ij->i', out, nn) < 0).mean() > 0.5:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(me); bm.free(); me.update()


def axis_center(c):
    # Nearest point on the local Y axis.
    a = np.zeros_like(c); a[:, 1] = c[:, 1]
    return a


def lathe(name, prof, segs=72, sx=1.0, sz=1.0, deform=None, a0=0.0, a1=2 * np.pi):
    """Surface of revolution about +Y. prof: [(y, r), ...] from one edge to the other. Angle 0 faces +Z.
    deform(V, prof, theta) may edit the (M, segs, 3) vertex grid. A partial arc (a1 - a0 < 2 pi) stays open."""
    P = np.asarray(prof, float)
    M = len(P)
    full = abs((a1 - a0) - 2 * np.pi) < 1e-6
    th = np.linspace(a0, a1, segs, endpoint=not full)
    V = np.zeros((M, segs, 3))
    V[..., 0] = P[:, None, 1] * np.sin(th)[None, :] * sx
    V[..., 1] = P[:, None, 0] + 0 * th[None, :]
    V[..., 2] = P[:, None, 1] * np.cos(th)[None, :] * sz
    if deform is not None:
        V = deform(V, P, th)
    faces = []
    cols = segs if full else segs - 1
    for i in range(M - 1):
        for j in range(cols):
            j2 = (j + 1) % segs
            faces.append((i * segs + j, (i + 1) * segs + j, (i + 1) * segs + j2, i * segs + j2))
    ob = _new_object(name, V.reshape(-1, 3), faces)
    if (P[:, 1] < 1e-7).any():
        # Collapse the ring at a closed pole (r = 0) into a single vertex.
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
        bm.to_mesh(ob.data); bm.free(); ob.data.update()
    _orient_outward(ob, axis_center)
    return ob


def recalc_normals(ob):
    # Consistent outward normals for a closed mesh.
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return ob


def roll(name, y, r, rr, segs=72, sx=1.0, sz=1.0, deform=None, ring=10, a0=0.0, a1=2 * np.pi):
    # Rolled edge: a thin torus at plate radius r (its tube centre sits rr outside the plate edge);
    # an open arc (a1 - a0 < 2 pi) follows a partial plate.
    phi = np.linspace(0, 2 * np.pi, ring, endpoint=False)
    prof = [(y + rr * np.sin(f), r + rr * (1 - np.cos(f)) * 0.9) for f in phi]
    P = np.asarray(prof)
    full = abs((a1 - a0) - 2 * np.pi) < 1e-6
    th = np.linspace(a0, a1, segs, endpoint=not full)
    V = np.zeros((ring, segs, 3))
    V[..., 0] = P[:, None, 1] * np.sin(th)[None, :] * sx
    V[..., 1] = P[:, None, 0] + 0 * th[None, :]
    V[..., 2] = P[:, None, 1] * np.cos(th)[None, :] * sz
    if deform is not None:
        V = deform(V, P, th)
    faces = []
    for i in range(ring):
        i2 = (i + 1) % ring
        for j in range(segs if full else segs - 1):
            j2 = (j + 1) % segs
            faces.append((i * segs + j, i2 * segs + j, i2 * segs + j2, i * segs + j2))
    ob = _new_object(name, V.reshape(-1, 3), faces)
    tube_c = np.array([0.0, y, 0.0])

    def tube_center(c):
        # Closest point on the torus core circle.
        rad = np.sqrt((c[:, 0] / sx) ** 2 + (c[:, 2] / sz) ** 2) + 1e-9
        k = (r + rr * 0.9) / rad
        return np.stack([c[:, 0] * k, np.full(len(c), y), c[:, 2] * k], 1)
    _orient_outward(ob, tube_center)
    return ob


def rivet(name, pos, normal, radius=0.0011, flat=0.55):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    me = ob.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co[:, 2] *= flat
    n = np.asarray(normal, float); n /= np.linalg.norm(n)
    # Rotate +Z onto n.
    z = np.array([0, 0, 1.0])
    v = np.cross(z, n); s = np.linalg.norm(v); c = z @ n
    if s < 1e-8:
        R = np.eye(3) if c > 0 else np.diag([1, -1, -1])
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + vx + vx @ vx * ((1 - c) / s ** 2)
    co = co @ R.T + np.asarray(pos)
    me.vertices.foreach_set('co', co.ravel()); me.update()
    for p in me.polygons:
        p.use_smooth = True
    return ob


def surface_point(V, i, j):
    # Vertex and approximate outward normal of a lathe grid (for placing rivets).
    p = V[i, j]
    a = V[min(i + 1, V.shape[0] - 1), j] - V[max(i - 1, 0), j]
    b = V[i, (j + 1) % V.shape[1]] - V[i, j - 1]
    n = np.cross(b, a)
    return p, n / (np.linalg.norm(n) + 1e-12)


def finish(ob, thick=0.0, bevel=0.0, subsurf=1, smooth=True):
    # Thickness, softened edges and subdivision, applied; flat-shaded meshes keep their facets.
    kb.select_only(ob)
    if thick:
        m = ob.modifiers.new('solid', 'SOLIDIFY'); m.thickness = thick; m.offset = -1.0; m.use_even_offset = True
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
        m.angle_limit = np.radians(40)
    if subsurf:
        m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
    kb.apply_modifiers(ob)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def join(name, obs):
    kb.select_only(obs[0])
    for o in obs[1:]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name; ob.data.name = name
    return ob


def transform(ob, M):
    # Apply a 4x4 matrix (numpy) to the mesh data directly.
    me = ob.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co = co @ M[:3, :3].T + M[:3, 3]
    me.vertices.foreach_set('co', co.ravel())
    if np.linalg.det(M[:3, :3]) < 0:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(me); bm.free()
    me.update()
    return ob


def mat4(t=(0, 0, 0), rx=0.0, ry=0.0, rz=0.0, s=(1, 1, 1)):
    # Translation * Rz * Ry * Rx * Scale (three.js default XYZ Euler order, applied to column vectors).
    cx, sx_ = np.cos(rx), np.sin(rx); cy, sy_ = np.cos(ry), np.sin(ry); cz, sz_ = np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx_], [0, sx_, cx]])
    Ry = np.array([[cy, 0, sy_], [0, 1, 0], [-sy_, 0, cy]])
    Rz = np.array([[cz, -sz_, 0], [sz_, cz, 0], [0, 0, 1]])
    M = np.eye(4)
    M[:3, :3] = Rz @ Ry @ Rx @ np.diag(s)
    M[:3, 3] = t
    return M


def mirror_x(ob, name):
    c = ob.copy(); c.data = ob.data.copy(); c.name = name; c.data.name = name
    bpy.context.scene.collection.objects.link(c)
    return transform(c, np.diag([-1.0, 1, 1, 1]))


def vertex_masks(ob, ao_distance, samples=64, edge_radius=0.0015):
    """Per-vertex AO (Cycles bake, other visible objects occlude), convex edge and concave cavity masks.
    Stored as a linear float colour attribute 'Col': R = AO, G = edge, B = cavity."""
    me = ob.data
    if 'Col' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['Col'])
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = col
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = ao_distance
    kb.select_only(ob)
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    rgba = np.empty(len(me.vertices) * 4, np.float32); col.data.foreach_get('color', rgba); rgba = rgba.reshape(-1, 4)
    ao = rgba[:, 0].copy()
    # Convexity from neighbour positions relative to the vertex normal.
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    d = co[e[:, 1]] - co[e[:, 0]]
    L2 = (d * d).sum(1) + 1e-14
    # Normal curvature along each edge (1/m): positive where the surface falls away from the normal (convex).
    k0 = -2 * np.einsum('ij,ij->i', nr[e[:, 0]], d) / L2
    k1 = 2 * np.einsum('ij,ij->i', nr[e[:, 1]], d) / L2
    acc = np.zeros(n); cnt = np.zeros(n)
    np.add.at(acc, e[:, 0], k0); np.add.at(acc, e[:, 1], k1)
    np.add.at(cnt, e[:, 0], 1); np.add.at(cnt, e[:, 1], 1)
    curv = acc / np.maximum(cnt, 1)
    # Edges and creases tighter than a couple of millimetres (scaled for the piece's size via edge_radius).
    edge = np.clip((curv * edge_radius - 0.3) / 0.9, 0, 1)
    cav = np.clip((-curv * edge_radius - 0.25) / 0.9, 0, 1)
    rgba[:, 0] = ao; rgba[:, 1] = edge; rgba[:, 2] = cav; rgba[:, 3] = 1
    col.data.foreach_set('color', rgba.ravel())
    return ob


def export_glb(path, obs, attributes=False):
    # attributes: also write custom point attributes whose names start with '_' (the loader lower-cases them).
    kb.select_only(obs[0])
    for o in obs[1:]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=False,
                              export_materials='NONE', export_normals=True, export_texcoords=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_apply=True,
                              export_attributes=attributes)
    print('exported', os.path.basename(path), os.path.getsize(path), 'bytes', len(obs), 'objects')


def sweep_tube(name, pts, radius, ring=8, cap=True):
    # Round tube along a polyline (for rolled edges that don't follow a lathe row, e.g. a plate's side edges).
    P = np.asarray(pts, float)
    N = len(P)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    # Parallel-transport frames.
    ref = np.array([0, 1.0, 0]) if abs(T[0][1]) < 0.9 else np.array([1.0, 0, 0])
    Nn = np.cross(T[0], ref); Nn /= np.linalg.norm(Nn)
    frames = []
    for i in range(N):
        if i:
            Nn = Nn - T[i] * (Nn @ T[i]); Nn /= np.linalg.norm(Nn) + 1e-12
        B = np.cross(T[i], Nn)
        frames.append((Nn.copy(), B))
    phi = np.linspace(0, 2 * np.pi, ring, endpoint=False)
    V = np.array([[P[i] + radius * (np.cos(f) * frames[i][0] + np.sin(f) * frames[i][1]) for f in phi] for i in range(N)])
    faces = [(i * ring + k, i * ring + (k + 1) % ring, (i + 1) * ring + (k + 1) % ring, (i + 1) * ring + k)
             for i in range(N - 1) for k in range(ring)]
    verts = list(V.reshape(-1, 3))
    if cap:
        c0 = len(verts); verts.append(P[0]); c1 = len(verts); verts.append(P[-1])
        faces += [(c0, (k + 1) % ring, k) for k in range(ring)]
        faces += [(c1, (N - 1) * ring + k, (N - 1) * ring + (k + 1) % ring) for k in range(ring)]
    ob = _new_object(name, verts, faces)
    recalc_normals(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def panel_grid(prof, span_fn, center_fn=None, segs=32, sx=1.0, sz=1.0, deform=None):
    # Lathe-like grid whose angular extent varies along the profile: row i spans center +- span/2 (radians).
    P = np.asarray(prof, float)
    M = len(P)
    V = np.zeros((M, segs, 3))
    for i, (y, r) in enumerate(P):
        t = i / (M - 1)
        sp = span_fn(y, t); c = center_fn(y, t) if center_fn else 0.0
        th = np.linspace(c - sp / 2, c + sp / 2, segs)
        V[i, :, 0] = r * np.sin(th) * sx
        V[i, :, 1] = y
        V[i, :, 2] = r * np.cos(th) * sz
    if deform is not None:
        V = deform(V, P)
    return V


def grid_object(name, V):
    M, S, _ = V.shape
    faces = [(i * S + j, (i + 1) * S + j, (i + 1) * S + j + 1, i * S + j + 1) for i in range(M - 1) for j in range(S - 1)]
    ob = _new_object(name, V.reshape(-1, 3), faces)
    _orient_outward(ob, axis_center)
    return ob
