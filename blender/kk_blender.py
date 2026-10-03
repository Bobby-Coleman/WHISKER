# Shared Blender helpers for the hero-model pass (run with the bpy module from blender-venv).
# Game space is Y-up with +Z forward; Blender is Z-up. game (x, y, z) -> blender (x, -z, y).
import os
import bpy
import bmesh
import numpy as np
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)


def g2b(v):
    v = np.asarray(v, float)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], axis=-1)


def b2g(v):
    v = np.asarray(v, float)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], axis=-1)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.scale_length = 1.0
    return sc


def mesh_object(name, verts_game, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    vb = g2b(verts_game)
    me.from_pydata([tuple(v) for v in vb], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_modifiers(ob):
    select_only(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def voxel_remesh(ob, size, smooth_iters=0):
    m = ob.modifiers.new('remesh', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = size
    m.adaptivity = 0.0
    m.use_smooth_shade = True
    if smooth_iters:
        s = ob.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
        s.iterations = smooth_iters
        s.smooth_type = 'LENGTH_WEIGHTED'
        s.use_only_smooth = True
    apply_modifiers(ob)


def mesh_arrays(ob, world=False):
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', tris)
    return co, tris.reshape(-1, 3)


def clay(name='clay', color=(0.6, 0.6, 0.6), rough=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def overcast_world(strength=1.0, top=(0.62, 0.68, 0.72), bottom=(0.25, 0.26, 0.2)):
    w = bpy.data.worlds.new('overcast')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = (*bottom, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (*top, 1)
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs['From Min'].default_value = -1
    mp.inputs['From Max'].default_value = 1
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
    nt.links.new(mp.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def add_sun(direction_game=(-0.45, 0.55, -0.7), strength=2.0, angle_deg=12, color=(1.0, 0.97, 0.92)):
    L = bpy.data.lights.new('sun', 'SUN')
    L.energy = strength
    L.angle = np.radians(angle_deg)
    L.color = color
    ob = bpy.data.objects.new('sun', L)
    bpy.context.scene.collection.objects.link(ob)
    d = Vector(tuple(g2b(np.asarray(direction_game, float))))  # direction toward the light
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def add_camera(pos_game, look_game, lens=50.0, sensor=36.0):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.sensor_width = sensor
    cam.clip_start = 0.001
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    p = Vector(tuple(g2b(np.asarray(pos_game, float))))
    t = Vector(tuple(g2b(np.asarray(look_game, float))))
    ob.location = p
    ob.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def render(path, w=640, h=640, samples=48, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    # Render on the GPU when one is available (OptiX, then CUDA); review renders take seconds instead of minutes.
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA'):
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices: d.use = d.type == kind
                sc.cycles.device = 'GPU'
                break
    except Exception as e:  # no GPU backend: stay on the CPU
        print('GPU render unavailable:', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.film_transparent = transparent
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
