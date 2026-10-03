# Re-bakes only the head albedo from head_color() onto the existing game mesh (out/kitten_head_baked.blend),
# so palette and marking changes don't need the full sculpt, remesh and bake.
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bpy
import kk_blender as kb
from kitten_head_build import head_color, set_point_colors, bake, new_image, save, PUB, TEX

bpy.ops.wm.open_mainfile(filepath=os.path.join(kb.OUT, 'kitten_head_baked.blend'))
hi, lo = bpy.data.objects['HeadHigh'], bpy.data.objects['Head']
hi.hide_render = False
hv = kb.b2g(kb.mesh_arrays(hi)[0])
a = hi.data.color_attributes.get('Col')
rgba = np.ones((len(hv), 4), np.float32); rgba[:, :3] = head_color(hv)
a.data.foreach_set('color', rgba.ravel())
if not lo.data.materials:
    lo.data.materials.append(kb.clay('loMat'))
img = new_image('albedo2', TEX, False)
bake(lo, hi, 'DIFFUSE', img, pass_filter={'COLOR'})
save(img, os.path.join(PUB, 'kitten_head_albedo.png'))
lo.data.materials.clear()
hi.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kb.OUT, 'kitten_head_baked.blend'))
print('recoloured')
