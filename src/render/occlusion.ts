// Ambient occlusion the characters cast on what they stand in: each body part is a sphere, and the ground and grass
// darken their sky light by the sphere's cosine-weighted solid angle (as capsule/sphere AO in games). Contact
// darkening under feet is what grounds a figure under an overcast sky, where the sun casts almost no shadow.
import { Fn, uniformArray, float, Loop, max, dot, length, clamp } from 'three/tsl';
import { Vector4 } from 'three/webgpu';

export const OCC_COUNT = 20;
export const OCCLUDERS = uniformArray(Array.from({ length: OCC_COUNT }, () => new Vector4(0, -1000, 0, 0.001)), 'vec4');

export const characterAO = Fn(([p, n]: any[]) => {
  const ao = float(1).toVar();
  Loop(OCC_COUNT, ({ i }: any) => {
    const s: any = OCCLUDERS.element(i);
    const d = s.xyz.sub(p);
    const l = max(length(d), 1e-4);
    const h = l.div(s.w);
    const occ = clamp(max(dot(n, d.div(l)), 0).div(h.mul(h)), 0, 1);
    ao.mulAssign(float(1).sub(occ.mul(0.8)));
  });
  return ao;
});

// Sphere list for one character: [object, local x, y, z, radius] per entry, written into OCCLUDERS from `start`.
export type OccSpec = [{ matrixWorld: { elements: ArrayLike<number> } }, number, number, number, number][];

export function writeOccluders(start: number, spec: OccSpec) {
  const arr = OCCLUDERS.array as Vector4[];
  for (let k = 0; k < spec.length && start + k < OCC_COUNT; k++) {
    const [o, x, y, z, r] = spec[k];
    const e = o.matrixWorld.elements;
    arr[start + k].set(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], r);
  }
}
