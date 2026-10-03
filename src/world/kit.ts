// The stylized world kit (blender/kit_*.py): pieces carry painted colours (COLOR_0) and masks (_masks: R occlusion,
// G worn edge, B cavity, A moss). One material reads them for all stone and timber: edges catch a painted highlight,
// joints and hollows darken, moss is a little rougher, and a slow world-space tint keeps repeated pieces from
// matching stone for stone.
import * as THREE from 'three/webgpu';
import { attribute, float, mix, positionWorld, vec3, smoothstep, clamp } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakedNoise } from '../render/noisetex';

let shared: THREE.Material | null = null;

export function kitMaterial() {
  if (shared) return shared;
  const m = new THREE.MeshStandardNodeMaterial();
  const col = attribute('color', 'vec4').rgb;
  const mk = attribute('_masks', 'vec4');
  const wp = positionWorld;
  const broad = bakedNoise(wp.xz.mul(0.11).add(wp.y.mul(0.07))).g.mul(0.5).add(0.5);
  const fine = bakedNoise(wp.xz.mul(1.9).add(wp.yz.mul(1.3))).b.mul(0.5).add(0.5);
  let base: any = col.mul(broad.mul(0.16).add(0.92)).mul(fine.mul(0.08).add(0.96));
  // Painted wear: lighter worn edges, darker joints and hollows.
  base = base.mul(mk.g.mul(0.3).add(1)).mul(float(1).sub(mk.b.mul(0.4)));
  m.colorNode = clamp(base, 0, 1);
  m.aoNode = mix(float(1), mk.r, 0.8);
  m.roughnessNode = float(0.86).sub(mk.g.mul(0.1)).add(mk.a.mul(0.06)).add(smoothstep(0.3, 0.9, fine).mul(0.04));
  m.metalness = 0;
  void vec3;
  shared = m;
  return m;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

// Loads a kit piece once; each call returns a fresh instance sharing its geometry.
export async function kitPiece(name: string) {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}kit/${name}.glb`).then((g) => {
      g.scene.traverse((o: any) => {
        if (o.isMesh) { o.material = kitMaterial(); o.castShadow = true; o.receiveShadow = true; }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  const src = await p;
  return src.clone(true);
}
