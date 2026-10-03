// Hero assets made in Blender (see blender/): meshes as GLB, baked maps as PNG, groomed fur as .kkf strand files.
// Everything loads from ./models next to the page; if anything is missing the game falls back to code-built parts.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadStrands, StrandData } from './strands';
import { fetchBinary } from './binfile';

const BASE = './models/';

export type KittenAssets = {
  head: THREE.BufferGeometry;
  // Lighter copy of the head carrying the undercoat attributes (furLen, furDir) for shell fur.
  headShell: THREE.BufferGeometry;
  headMaps: { albedo: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture };
  headFur: StrandData;
  whiskers: StrandData;
  // Plate, sword and fittings by name (part__material__piece), each in its rig part's local space.
  armor: Map<string, THREE.BufferGeometry>;
  // Groomed tail, ears, hips, legs and paws: a skin per rig part (part__skin__piece) and its strand fur.
  body: { skins: Map<string, THREE.BufferGeometry>; fur: Record<BodyFur, StrandData> } | null;
};

export const BODY_FUR = ['tail', 'ear', 'hips', 'thigh', 'shin', 'paw'] as const;
export type BodyFur = typeof BODY_FUR[number];

async function loadBody() {
  try {
    const [skins, ...furs] = await Promise.all([glbPieces('kitten_body.glb'), ...BODY_FUR.map((n) => loadStrands(`${BASE}kitten_${n}.kkf`))]);
    for (const g of skins.values()) {
      // Undercoat for shells (written by Blender as _FURLEN/_FURDIR); the fur base material also reads `tissue`.
      const len = g.getAttribute('_furlen'), dir = g.getAttribute('_furdir');
      if (len && dir) { g.setAttribute('furLen', len); g.setAttribute('furDir', dir); g.deleteAttribute('_furlen'); g.deleteAttribute('_furdir'); }
      g.setAttribute('tissue', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    }
    const fur = Object.fromEntries(BODY_FUR.map((n, i) => [n, furs[i]])) as Record<BodyFur, StrandData>;
    return { skins, fur };
  } catch (e) {
    console.warn('Groomed kitten body unavailable; using the code-built body fur.', e);
    return null;
  }
}

function texture(name: string, srgb: boolean) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(BASE + name, (t) => {
      // glTF UVs put v = 0 at the top of the image.
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => reject(new Error(`Could not load ${name}`)));
  });
}

// Undercoat for shell fur, one record per head vertex: length (0.05 mm units) and combing direction (int8 xyz).
async function shellAttributes(name: string, geo: THREE.BufferGeometry) {
  const buf = await fetchBinary(BASE + name);
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'KKS1') throw new Error(`${name} is not a shell file`);
  const n = dv.getUint32(4, true);
  if (n !== geo.attributes.position.count) throw new Error(`${name} has ${n} vertices, the head has ${geo.attributes.position.count}`);
  const len = new Float32Array(n), dir = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 4;
    len[i] = dv.getUint8(o) * 0.00005;
    for (let c = 0; c < 3; c++) dir[i * 3 + c] = dv.getInt8(o + 1 + c) / 127;
  }
  geo.setAttribute('furLen', new THREE.BufferAttribute(len, 1));
  geo.setAttribute('furDir', new THREE.BufferAttribute(dir, 3));
}

const loadGlb = async (name: string) => new GLTFLoader().parseAsync(await fetchBinary(BASE + name), BASE);

async function glbPieces(name: string) {
  const gltf = await loadGlb(name);
  gltf.scene.updateMatrixWorld(true);
  const out = new Map<string, THREE.BufferGeometry>();
  gltf.scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const g = (o.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(o.matrixWorld);
    out.set(o.name, g);
  });
  return out;
}

async function glbGeometry(name: string) {
  const gltf = await loadGlb(name);
  let geo: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o: any) => { if (!geo && o.isMesh) geo = o.geometry; });
  if (!geo) throw new Error(`${name} has no mesh`);
  return geo as THREE.BufferGeometry;
}

export async function loadKittenAssets(): Promise<KittenAssets | null> {
  try {
    const [head, headShell, armor, albedo, normal, orm, headFur, whiskers, body] = await Promise.all([
      glbGeometry('kitten_head.glb'), glbGeometry('kitten_head_shell.glb'), glbPieces('kitten_armor.glb'),
      texture('kitten_head_albedo.png', true), texture('kitten_head_normal.png', false), texture('kitten_head_orm.png', false),
      loadStrands(BASE + 'kitten_head.kkf'), loadStrands(BASE + 'kitten_whiskers.kkf'), loadBody(),
    ]);
    await shellAttributes('kitten_head_shell.bin', headShell);
    return { head, headShell, headMaps: { albedo, normal, orm }, headFur, whiskers, armor, body };
  } catch (e) {
    console.warn('Hero kitten assets unavailable; using the code-built head.', e);
    return null;
  }
}

// The knight's helm, plate, boots and sword (part__material__piece), or null to keep the code-built pieces.
export async function loadKnightAssets(): Promise<Map<string, THREE.BufferGeometry> | null> {
  try {
    return await glbPieces('knight_armor.glb');
  } catch (e) {
    console.warn('Hero knight assets unavailable; using the code-built armour.', e);
    return null;
  }
}
