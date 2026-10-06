// Static batching (v3): after a level is built, every mesh that never moves is baked into world space and merged
// with the others sharing its material (and shadow flags), bucketed by ground cell so the view and the shadow camera
// still cull them in pieces. Anything that moves (hinged leaves, wheels, banners whose shader waves them in object
// space, things that hide or turn) is marked `userData.dynamic` and left alone with everything under it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const dynamic = <T extends THREE.Object3D>(o: T) => { o.userData.dynamic = true; return o; };

export function mergeStatic(root: THREE.Object3D, cell = 40) {
  root.updateMatrixWorld(true);
  type Bucket = { mat: THREE.Material; cast: boolean; recv: boolean; colors: boolean; geos: THREE.BufferGeometry[] };
  const buckets = new Map<string, Bucket>();
  const taken: THREE.Mesh[] = [];
  const box = new THREE.Box3(), c = new THREE.Vector3();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    // Something that moves as a whole: its own parts merge among themselves (unless it animates them one by one).
    if (o.userData.dynamic) { if (!o.userData.keep) mergeLocal(o); return; }
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material)
      && !(m.material as THREE.ShaderMaterial).isShaderMaterial && m.geometry.attributes.position) {
      const mat = m.material as THREE.Material & { vertexColors?: boolean };
      box.setFromObject(m).getCenter(c);
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, recv: m.receiveShadow, colors: !!mat.vertexColors, geos: [] }));
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(b.colors ? ['color'] : [])].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (b.colors && !g.attributes.color) { const a = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
      g.morphAttributes = {};
      b.geos.push(g);
      taken.push(m);
    }
    for (const ch of o.children.slice()) visit(ch);
  };
  visit(root);
  for (const m of taken) m.parent?.remove(m);
  const out = new THREE.Group(); out.name = 'Static';
  let n = 0;
  for (const b of buckets.values()) {
    const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos);
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    out.add(mesh); n++;
  }
  root.add(out);
  return { meshes: taken.length, draws: n };
}

// Merge an object's own parts (in its local space), by material: a gate of twelve planks is one draw.
export function mergeLocal(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), rel = new THREE.Matrix4();
  type Bucket = { mat: THREE.Material; cast: boolean; recv: boolean; colors: boolean; geos: THREE.BufferGeometry[] };
  const buckets = new Map<string, Bucket>();
  const taken: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || o !== obj && o.userData.keep) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !(m.material as THREE.ShaderMaterial).isShaderMaterial && !m.userData.dynamic) {
      const mat = m.material as THREE.Material & { vertexColors?: boolean };
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, recv: m.receiveShadow, colors: !!mat.vertexColors, geos: [] }));
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(b.colors ? ['color'] : [])].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (b.colors && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      b.geos.push(g);
      taken.push(m);
    }
    for (const ch of o.children.slice()) if (ch === obj || !ch.userData.dynamic || ch === o) visit(ch);
  };
  visit(obj);
  if (taken.length < 2) return;
  for (const m of taken) m.parent?.remove(m);
  for (const b of buckets.values()) {
    const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    obj.add(mesh);
  }
}
