// Field maps baked once at load and shared by the terrain and grass shaders, so centimetre-scale ground detail
// (the muddy path, puddles, thin and dead patches) follows the same data as the vegetation and physics.
import * as THREE from 'three/webgpu';
import { clamp, floor, ivec2, textureLoad, float, select } from 'three/tsl';
import { pathDist, wetNatural, vegetationExclusion, grassVigour, deadGrass, puddleMask, PATHS } from './layout';

export const MASK_HALF = 120; // metres either side of the origin
export const MASK_RES = 0.5;
export const PATH_RANGE = 4; // path distance is stored up to 4 m

export type FieldMaps = {
  // RGBA8: path distance / 4 m, natural wetness, vegetation exclusion, vigour.
  mask: THREE.DataTexture;
  // RGBA8: dead-grass fraction, standing water.
  mask2: THREE.DataTexture;
  // R32F terrain heights on the playable mesh's own grid (read with textureLoad and interpolated per triangle).
  height: THREE.DataTexture;
  heightN: number; heightHalf: number; heightStep: number;
};

export function bakeFieldMaps(terrainNear: THREE.Mesh, half: number, step: number): FieldMaps {
  const n = Math.round(2 * MASK_HALF / MASK_RES);
  const a = new Uint8Array(n * n * 4), b = new Uint8Array(n * n * 4);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of PATHS) for (const q of p) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
  const pad = PATH_RANGE + 1;
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -MASK_HALF + (i + 0.5) * MASK_RES, z = -MASK_HALF + (j + 0.5) * MASK_RES;
    const k = (j * n + i) * 4;
    const nearPath = x > minX - pad && x < maxX + pad && z > minZ - pad && z < maxZ + pad;
    a[k] = nearPath ? u8(pathDist(x, z) / PATH_RANGE) : 255;
    a[k + 1] = u8(wetNatural(x, z));
    a[k + 2] = u8(vegetationExclusion(x, z));
    a[k + 3] = u8(grassVigour(x, z));
    b[k] = u8(deadGrass(x, z));
    b[k + 1] = u8(puddleMask(x, z));
    b[k + 3] = 255;
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  const pos = terrainNear.geometry.getAttribute('position');
  const hn = Math.round(Math.sqrt(pos.count));
  const hd = new Float32Array(hn * hn);
  for (let k = 0; k < hn * hn; k++) hd[k] = pos.getY(k);
  const height = new THREE.DataTexture(hd, hn, hn, THREE.RedFormat, THREE.FloatType);
  height.magFilter = height.minFilter = THREE.NearestFilter;
  height.needsUpdate = true;
  return { mask: mk(a), mask2: mk(b), height, heightN: hn, heightHalf: half, heightStep: step };
}

// Terrain height at world xz, exactly as the playable mesh interpolates it (two triangles per grid cell).
export function terrainHeight(maps: FieldMaps, xz: any) {
  const n = maps.heightN;
  const g = xz.add(maps.heightHalf).div(maps.heightStep);
  const gi: any = clamp(floor(g), 0, n - 2);
  const f: any = clamp(g.sub(gi), 0, 1);
  const i0: any = ivec2(gi);
  const ha = textureLoad(maps.height, i0).x;
  const hb = textureLoad(maps.height, i0.add(ivec2(1, 0))).x;
  const hc = textureLoad(maps.height, i0.add(ivec2(0, 1))).x;
  const hd = textureLoad(maps.height, i0.add(ivec2(1, 1))).x;
  const lower = ha.add(hb.sub(ha).mul(f.x)).add(hc.sub(ha).mul(f.y));
  const upper = hd.add(hc.sub(hd).mul(float(1).sub(f.x))).add(hb.sub(hd).mul(float(1).sub(f.y)));
  return select(f.x.add(f.y).lessThan(1), lower, upper);
}
