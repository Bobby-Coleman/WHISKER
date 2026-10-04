// CC0 props (Quaternius megakits via OpenGameArt, packed by tools/pack_props.mjs into public/props/<pack>/): loaded
// once each, then cloned per placement (geometry and materials shared). Placement helpers set position, turn, scale
// and shadows; tints recolour a prop's materials for a scene (a hawthorn's autumn leaves, mud on a banner).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

export function loadProp(id: string) {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}props/${id}.gltf`).then((g) => {
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material as THREE.MeshStandardMaterial;
        // Foliage cards are cut out, two-sided; everything else opaque.
        if (m.map && m.transparent) { m.alphaTest = 0.45; m.transparent = false; m.side = THREE.DoubleSide; }
      });
      return g.scene;
    });
    cache.set(id, p);
  }
  return p;
}

export type Place = { at: [number, number, number]; yaw?: number; pitch?: number; roll?: number; scale?: number | [number, number, number]; tint?: Record<string, string>; name?: string };

// A copy of a prop placed in the world. Tints give the named materials their own copies, coloured.
export async function placeProp(id: string, p: Place, parent: THREE.Object3D) {
  const src = await loadProp(id);
  const o = src.clone(true);
  o.position.set(...p.at);
  o.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
  if (p.scale !== undefined) { if (Array.isArray(p.scale)) o.scale.set(...p.scale); else o.scale.setScalar(p.scale); }
  if (p.tint) {
    const done = new Map<THREE.Material, THREE.Material>();
    o.traverse((m: any) => {
      if (!m.isMesh) return;
      const c = p.tint![m.material.name];
      if (!c) return;
      let mm = done.get(m.material);
      if (!mm) { mm = m.material.clone(); (mm as any).color = new THREE.Color(c); done.set(m.material, mm!); }
      m.material = mm;
    });
  }
  if (p.name) o.name = p.name;
  parent.add(o);
  o.updateMatrixWorld(true);
  return o;
}
