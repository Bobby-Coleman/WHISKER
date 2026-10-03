# The shared character rig and its animations (engine v2), from the Quaternius Universal Animation Library 1 and 2
# (CC0, assets-src/packs). Both libraries use the same Unreal-style skeleton (root, pelvis, spine_01-03, neck_01, Head,
# clavicle/upperarm/lowerarm/hand, thigh/calf/foot/ball, fingers), so UAL 1's clips (from its Unreal FBX) go onto UAL 2's
# armature. Exports public/chars/ual_anims.glb: the skeleton with the clips the game uses (rotations, plus the pelvis's
# and root's translation; the game retargets them to each character), and public/chars/mannequin.glb: the skinned
# mannequin for engine tests.
#
# Run: blender -b --factory-startup -P blender/ual_rig.py
import bpy, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PACKS = os.path.join(REPO, "assets-src", "packs")
UAL2 = os.path.join(PACKS, "universal_animation_library_2standard", "Universal Animation Library 2 [Standard]", "Unreal-Godot", "UAL2_Standard.glb")
UAL1 = os.path.join(PACKS, "universal_animation_librarystandard", "Animation Library[Standard]", "Unreal Engine", "AL_Standard.fbx")
OUT = os.path.join(REPO, "public", "chars")

# The clips the game uses: locomotion, jumps, carrying and throwing, climbing up, sitting and getting up (the
# prologue), swimming, sword and shield, and a few gestures for cutscenes.
KEEP = [
    "Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Walk_Formal_Loop",
    "Jump_Start", "Jump_Loop", "Jump_Land", "NinjaJump_Start", "NinjaJump_Idle_Loop", "NinjaJump_Land",
    "Roll", "Crouch_Idle_Loop", "Crouch_Fwd_Loop", "Push_Loop", "Walk_Carry_Loop", "OverhandThrow", "PickUp_Table",
    "Interact", "ClimbUp_1m_RM", "Sitting_Enter", "Sitting_Idle_Loop", "Sitting_Exit", "LayToIdle", "Death01",
    "Hit_Chest", "Hit_Knockback", "Swim_Fwd_Loop", "Swim_Idle_Loop", "Sword_Idle", "Sword_Attack", "Sword_Block",
    "Idle_Shield_Loop", "Shield_OneShot", "Yes", "Idle_No_Loop", "Idle_Talking_Loop", "Idle_FoldArms_Loop",
    "Fixing_Kneeling", "Zombie_Walk_Fwd_Loop", "Slide_Start", "Slide_Loop", "Slide_Exit", "Idle_Lantern_Loop",
]
# Bones whose translation is animated (the rest keep their rest offsets, so a character with other proportions
# keeps its own).
MOVING = {"root", "pelvis"}


def clean_name(n):
    return re.sub(r"^(Rig\|)+", "", n)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=UAL2)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
arm.name = "UAL"
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.lower().startswith("icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
ual2_actions = set(a.name for a in bpy.data.actions)

# UAL 1: import its rig, then keep only its actions (same bone names, same rest pose).
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=UAL1, automatic_bone_orientation=False)
for o in set(bpy.data.objects) - before:
    bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    if a.name not in ual2_actions:
        a.name = clean_name(a.name)

# FBX actions start at frame 1; shift them to 0 like the glTF ones.
fps = bpy.context.scene.render.fps
print("scene fps", fps)

keep = []
for name in KEEP:
    a = bpy.data.actions.get(name)
    if a is None:
        print("missing clip", name)
        continue
    keep.append(a)
for a in list(bpy.data.actions):
    if a not in keep:
        bpy.data.actions.remove(a)


def strip(action):
    # Keep rotations for every bone; translations only for root and pelvis; no scale.
    removed = 0
    # Blender 4.4+ layered actions keep fcurves in channelbags; older ones on the action.
    bags = []
    try:
        for layer in action.layers:
            for strip_ in layer.strips:
                for bag in strip_.channelbags:
                    bags.append(bag.fcurves)
    except AttributeError:
        bags.append(action.fcurves)
    for fcs in bags:
        for fc in list(fcs):
            m = re.match(r'pose\.bones\["([^"]+)"\]\.(\w+)', fc.data_path)
            if not m:
                continue
            bone, prop = m.group(1), m.group(2)
            if prop == "scale" or (prop == "location" and bone not in MOVING):
                fcs.remove(fc)
                removed += 1
    return removed


for a in keep:
    r = strip(a)
    fr = a.frame_range
    if fr[0] != 0:
        # Shift keys so every clip starts at frame 0.
        try:
            for layer in a.layers:
                for s in layer.strips:
                    for bag in s.channelbags:
                        for fc in bag.fcurves:
                            for kp in fc.keyframe_points:
                                kp.co.x -= fr[0]; kp.handle_left.x -= fr[0]; kp.handle_right.x -= fr[0]
        except AttributeError:
            for fc in a.fcurves:
                for kp in fc.keyframe_points:
                    kp.co.x -= fr[0]; kp.handle_left.x -= fr[0]; kp.handle_right.x -= fr[0]
    a.use_fake_user = True
    print(f"clip {a.name:24s} frames {a.frame_range[0]:.0f}-{a.frame_range[1]:.0f}  stripped {r}")

# Each kept action becomes an NLA track so the glTF exporter writes them all (the importer's own tracks go first).
arm.animation_data_create()
arm.animation_data.action = None
for t in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(t)
for a in list(bpy.data.actions):
    if a not in keep:
        bpy.data.actions.remove(a)
for a in keep:
    t = arm.animation_data.nla_tracks.new()
    t.name = a.name
    s = t.strips.new(a.name, 0, a)
    t.mute = True

os.makedirs(OUT, exist_ok=True)
mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"]


def export(path, with_mesh):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for m in mesh:
        m.select_set(with_mesh)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_animations=with_mesh is False,
        export_animation_mode="NLA_TRACKS", export_force_sampling=False, export_optimize_animation_size=True,
        export_anim_single_armature=True, export_skins=True, export_morph=False, export_materials="EXPORT",
        export_yup=True, export_apply=False,
    )
    print("exported", path, os.path.getsize(path))


export(os.path.join(OUT, "ual_anims.glb"), with_mesh=False)
export(os.path.join(OUT, "mannequin.glb"), with_mesh=True)
