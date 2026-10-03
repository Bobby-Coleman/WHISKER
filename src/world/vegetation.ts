// Vegetation kit (living grass, dead grass, reeds, weeds, small flowers) placed in 16 m chunks and animated on the
// GPU with shared TSL wind. Each kit draws as two instanced meshes (near chunks, which cast shadows, and the rest):
// whenever the view changes, the chunks in view are packed into them, thinned with distance. That keeps the plants
// to about two dozen draws instead of one per kit per chunk, and all kits share one material (one shader).
import * as THREE from 'three/webgpu';
import {
  positionLocal, uv, vec3, transformNormalToView, vec2, float, sin, mx_noise_float, mx_fractal_noise_float, mix, attribute, smoothstep, Fn, normalLocal, pow,
  positionWorld, cos,
} from 'three/tsl';
import { WIND } from '../render/settings';
import { bakedNoise } from '../render/noisetex';
import { characterAO } from '../render/occlusion';
import { heightAt, pathDist, wetNatural, vegetationExclusion } from './layout';
import { mulberry32, Simplex2 } from './noise';

type KitDef = {
  name: string; blades: [number, number]; height: [number, number]; width: [number, number]; spread: number;
  lean: number; curl: number; segs: number; base: string; tip: string; flower?: string; stiffness: number;
};

const KITS: KitDef[] = [
  { name: 'living_short', blades: [10, 14], height: [0.1, 0.2], width: [0.006, 0.01], spread: 0.09, lean: 0.35, curl: 0.25, segs: 3, base: '#3c4426', tip: '#7d8452', stiffness: 1 },
  { name: 'living_mid', blades: [9, 13], height: [0.18, 0.3], width: [0.006, 0.011], spread: 0.11, lean: 0.4, curl: 0.35, segs: 4, base: '#3a4224', tip: '#868a56', stiffness: 1 },
  { name: 'living_tall', blades: [8, 11], height: [0.28, 0.42], width: [0.005, 0.009], spread: 0.12, lean: 0.45, curl: 0.4, segs: 4, base: '#39401f', tip: '#8f8f5c', stiffness: 1 },
  { name: 'living_sage', blades: [10, 14], height: [0.14, 0.26], width: [0.007, 0.012], spread: 0.1, lean: 0.3, curl: 0.3, segs: 3, base: '#434b33', tip: '#8e957a', stiffness: 1 },
  { name: 'living_tussock', blades: [16, 22], height: [0.2, 0.36], width: [0.004, 0.007], spread: 0.08, lean: 0.6, curl: 0.55, segs: 4, base: '#3d4022', tip: '#99925e', stiffness: 0.9 },
  { name: 'dead_bent', blades: [8, 12], height: [0.2, 0.36], width: [0.005, 0.009], spread: 0.12, lean: 0.9, curl: 0.8, segs: 4, base: '#4d4330', tip: '#a08d66', stiffness: 0.8 },
  { name: 'dead_upright', blades: [7, 10], height: [0.24, 0.44], width: [0.004, 0.008], spread: 0.1, lean: 0.35, curl: 0.35, segs: 4, base: '#554933', tip: '#ab9a72', stiffness: 0.9 },
  { name: 'reed_a', blades: [5, 8], height: [0.7, 1.15], width: [0.006, 0.01], spread: 0.1, lean: 0.12, curl: 0.15, segs: 5, base: '#3f4628', tip: '#8d8a5e', stiffness: 0.55 },
  { name: 'reed_b', blades: [4, 7], height: [0.9, 1.35], width: [0.007, 0.011], spread: 0.08, lean: 0.1, curl: 0.12, segs: 5, base: '#4b4a2c', tip: '#a39468', stiffness: 0.5 },
  { name: 'weed', blades: [5, 7], height: [0.06, 0.12], width: [0.018, 0.03], spread: 0.05, lean: 1.0, curl: 0.4, segs: 3, base: '#323b22', tip: '#566039', stiffness: 1.2 },
  { name: 'flower', blades: [3, 5], height: [0.16, 0.28], width: [0.003, 0.004], spread: 0.06, lean: 0.15, curl: 0.1, segs: 3, base: '#3c4426', tip: '#646b42', flower: '#d9d2bd', stiffness: 0.9 },
];

function buildCluster(def: KitDef, seed: number) {
  const r = mulberry32(seed);
  const rr = (a: number, b: number) => a + (b - a) * r();
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
  const cb = new THREE.Color(def.base), ct = new THREE.Color(def.tip);
  const nb = Math.round(rr(def.blades[0], def.blades[1] + 0.99));
  const addBlade = (ox: number, oz: number, h: number, w: number, yaw: number, lean: number, curl: number, segs: number, cA: THREE.Color, cB: THREE.Color) => {
    const start = pos.length / 3;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const px = -dz, pz = dx; // blade width direction
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = lean * t + curl * t * t;
      const x = ox + dx * bend * h * 0.6, z = oz + dz * bend * h * 0.6;
      const y = h * t * (1 - 0.25 * curl * t * t);
      const ww = w * (1 - Math.pow(t, 1.6));
      const c = cA.clone().lerp(cB, Math.pow(t, 0.8));
      for (const side of [-1, 1]) {
        pos.push(x + px * ww * side, y, z + pz * ww * side);
        // Normals blended toward up for soft, readable overcast shading.
        nrm.push(dx * 0.35, 0.9, dz * 0.35);
        uvs.push(h, t);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (let b = 0; b < nb; b++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * def.spread;
    const h = rr(def.height[0], def.height[1]);
    const shade = rr(0.82, 1.1);
    addBlade(Math.cos(a) * d, Math.sin(a) * d, h, rr(def.width[0], def.width[1]), r() * Math.PI * 2, def.lean * rr(0.4, 1.2), def.curl * rr(0.5, 1.3), def.segs,
      cb.clone().multiplyScalar(shade), ct.clone().multiplyScalar(shade));
    if (def.flower) {
      // Tiny pale head: a few crossed petals near the tip.
      const fc = new THREE.Color(def.flower);
      const lastTip = pos.length / 3 - 1;
      const tx = pos[lastTip * 3], ty = pos[lastTip * 3 + 1], tz = pos[lastTip * 3 + 2];
      for (let p = 0; p < 3; p++) {
        const st = pos.length / 3;
        const ang = p * Math.PI / 3;
        const s = 0.012;
        const cx = Math.cos(ang) * s, cz = Math.sin(ang) * s;
        pos.push(tx - cx, ty, tz - cz, tx + cx, ty, tz + cz, tx - cz * 0.5, ty + 0.006, tz + cx * 0.5);
        for (let k = 0; k < 3; k++) { nrm.push(0, 1, 0); uvs.push(h, 1); col.push(fc.r, fc.g, fc.b); }
        idx.push(st, st + 1, st + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Shared GPU wind: slow prevailing bend + traveling gusts + small tip flutter, anchored at the base.
export const windOffset = Fn(([p, tip, height, stiffness]: any[]) => {
  const dir = vec2(WIND.dir.x, WIND.dir.y);
  const t = WIND.time;
  const travel = p.xz.mul(0.045).sub(dir.mul(t).mul(0.16));
  // Baked gradient noise (two texture reads per vertex instead of two 3D noise evaluations). Each read returns two
  // independent fields; turning one against the other over time stands in for the noise's slow third axis.
  const g = bakedNoise(travel, true), ga = t.mul(0.08);
  const gust = smoothstep(-0.25, 0.75, g.b.mul(cos(ga)).add(g.a.mul(sin(ga))));
  const r = bakedNoise(p.xz.mul(0.35).sub(dir.mul(t).mul(0.6)).add(vec2(3.7, 1.3)), true), ra = t.mul(0.3);
  const ripple = r.b.mul(cos(ra)).add(r.a.mul(sin(ra))).mul(0.5).add(0.5);
  const flutter = sin(t.mul(7.3).add(p.x.mul(5.1)).add(p.z.mul(3.7))).mul(0.035);
  const bend = float(0.14).add(gust.mul(0.42)).add(ripple.mul(0.08)).mul(WIND.strength).div(stiffness);
  const w = pow(tip, 1.7).mul(height);
  const off = vec3(dir.x, 0, dir.y).mul(bend.mul(w)).add(vec3(dir.y.negate(), 0, dir.x).mul(flutter.mul(w)));
  // Keep blade length roughly constant.
  const drop = off.x.mul(off.x).add(off.z.mul(off.z)).div(height.mul(2.0).add(0.001));
  return off.sub(vec3(0, drop, 0));
});

function vegetationMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, vertexColors: true });
  m.roughness = 0.82;
  m.metalness = 0;
  const tip = uv().y, h = uv().x;
  // Up-facing shading normal: blades read as part of the turf instead of dark flipped faces.
  m.normalNode = transformNormalToView(vec3(0, 1, 0));
  m.positionNode = positionLocal.add(windOffset(positionLocal, tip, h, attribute('stiff', 'float')));
  // Restrained backlit translucency near blade tips, without glow.
  m.emissiveNode = attribute('color', 'vec3').mul(pow(tip, 2.0).mul(0.06));
  // Blades around a character's feet sit in its occlusion too (lower blades more, as the ground does).
  m.aoNode = characterAO(positionWorld, vec3(0, 1, 0));
  void normalLocal; void mix; void mx_fractal_noise_float;
  return m;
}

type KitRun = { k: number; mats: Float32Array; cols: Float32Array; full: number; tall: boolean };
type VegChunk = { cx: number; cz: number; sphere: THREE.Sphere; kits: KitRun[] };

export function createVegetation(density: number, radius: number) {
  const group = new THREE.Group();
  group.name = 'Vegetation';
  const kitGeos = KITS.map((k, i) => {
    const g = buildCluster(k, 1000 + i * 77);
    g.setAttribute('stiff', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(k.stiffness), 1));
    return g;
  });
  const material = vegetationMaterial();
  const broad = new Simplex2(91);
  const CH = 16;
  const chunks: VegChunk[] = [];
  const R = 96;
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tmpC = new THREE.Color();
  const capacity = new Array(KITS.length).fill(0);
  let total = 0;
  for (let cz = -R; cz < R; cz += CH) for (let cx = -R; cx < R; cx += CH) {
    const ccx = cx + CH / 2, ccz = cz + CH / 2;
    if (Math.hypot(ccx, ccz) > R + 10) continue;
    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663));
    const lists: { m: THREE.Matrix4; c: THREE.Color }[][] = KITS.map(() => []);
    const step = 0.62 / Math.sqrt(density);
    let yMin = Infinity, yMax = -Infinity;
    for (let z = cz; z < cz + CH; z += step) for (let x = cx; x < cx + CH; x += step) {
      const px = x + (rand() - 0.5) * step * 1.4, pz = z + (rand() - 0.5) * step * 1.4;
      const ex = vegetationExclusion(px, pz);
      if (ex >= 1 || rand() < ex) continue;
      const pd = pathDist(px, pz);
      const wet = wetNatural(px, pz);
      const bA = broad.fbm(px / 30, pz / 30, 3) * 0.5 + 0.5;
      const bB = broad.fbm(px / 12 + 40, pz / 12, 2) * 0.5 + 0.5;
      // Broad patches of density, thinning on paths and in standing water.
      let d = 0.35 + 0.75 * bA;
      d *= Math.min(1, Math.max(0.05, (pd - 0.45) / 1.1));
      if (wet > 0.75) d *= 0.35;
      if (rand() > d) continue;
      let kit: number;
      const q = rand();
      if (wet > 0.5 && q < 0.4 * wet) kit = 7 + (rand() < 0.5 ? 0 : 1);
      else if (q < 0.012) kit = 10;
      else if (q < 0.05) kit = 9;
      else if (bB > 0.62 && rand() < 0.7) kit = 5 + (rand() < 0.55 ? 0 : 1);
      else {
        // The blade carpet is the turf; clusters add the taller tufts, tussocks and seed heads that break it up.
        const u = rand();
        kit = pd < 2.2 ? (u < 0.5 ? 4 : u < 0.8 ? 0 : 3) : u < 0.38 ? 4 : u < 0.62 ? 2 : u < 0.8 ? 1 : 3;
      }
      const y = heightAt(px, pz);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      tmpP.set(px, y - 0.01, pz);
      tmpQ.setFromAxisAngle(up, rand() * Math.PI * 2);
      const s = 0.75 + rand() * 0.6;
      tmpS.set(s, s * (0.85 + rand() * 0.3), s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      const tint = 0.85 + rand() * 0.25;
      tmpC.setRGB(tint * (0.97 + bB * 0.06), tint, tint * (0.95 + bA * 0.05));
      lists[kit].push({ m: tmpM.clone(), c: tmpC.clone() });
    }
    if (yMin > yMax) continue;
    // Bounds for view culling: the chunk square, its ground heights and the tallest reeds, with room for wind.
    const half = CH / 2 + 1.5;
    const sphere = new THREE.Sphere(new THREE.Vector3(ccx, (yMin + yMax) / 2 + 0.7, ccz), Math.hypot(half, half, (yMax - yMin) / 2 + 1.6));
    const chunk: VegChunk = { cx: ccx, cz: ccz, sphere, kits: [] };
    lists.forEach((list, k) => {
      if (!list.length) return;
      // Random order so truncating count thins density evenly with distance.
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
      const mats = new Float32Array(list.length * 16), cols = new Float32Array(list.length * 3);
      list.forEach((e, i) => { e.m.toArray(mats, i * 16); e.c.toArray(cols, i * 3); });
      chunk.kits.push({ k, mats, cols, full: list.length, tall: k >= 7 && k <= 8 });
      capacity[k] += list.length;
      total += list.length;
    });
    chunks.push(chunk);
  }
  // Two meshes per kit: chunks within 10 m (they cast shadows, and are kept even when behind the camera, as their
  // shadows can fall into view) and the rest (only when in view).
  // Capacity stays above what fits a uniform buffer (1024 matrices at WebGPU's default limit): smaller instanced
  // meshes get their count baked into the shader, which gave every chunk of the old layout its own shader.
  const makeMesh = (k: number, near: boolean) => {
    if (!capacity[k]) return null;
    const cap = Math.max(capacity[k], 1100);
    const im = new THREE.InstancedMesh(kitGeos[k], material, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.visible = false;
    im.frustumCulled = false;
    im.receiveShadow = true;
    im.castShadow = near;
    im.name = `Veg_${KITS[k].name}_${near ? 'near' : 'far'}`;
    group.add(im);
    return im;
  };
  const nearMeshes = KITS.map((_, k) => makeMesh(k, true));
  const farMeshes = KITS.map((_, k) => makeMesh(k, false));
  const nearN = new Int32Array(KITS.length), farN = new Int32Array(KITS.length);
  const frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), camPos = new THREE.Vector3();
  const lastVP = new Float32Array(16);
  let lodRadius = radius, lastRadius = -1;
  const upload = (im: THREE.InstancedMesh | null, n: number) => {
    if (!im) return;
    im.count = n;
    im.visible = n > 0;
    im.instanceMatrix.clearUpdateRanges(); im.instanceColor!.clearUpdateRanges();
    if (n === 0) return;
    im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true;
    im.instanceColor!.addUpdateRange(0, n * 3); im.instanceColor!.needsUpdate = true;
  };
  return {
    group,
    total,
    setRadius(r: number) { lodRadius = r; },
    update(cam: THREE.Camera) {
      cam.updateMatrixWorld();
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      // A still view (the title, a paused game) re-packs and re-uploads nothing.
      let same = lodRadius === lastRadius;
      for (let i = 0; i < 16 && same; i++) same = Math.abs(vp.elements[i] - lastVP[i]) < 1e-6;
      if (same) return;
      lastVP.set(vp.elements); lastRadius = lodRadius;
      frustum.setFromProjectionMatrix(vp, (cam as any).coordinateSystem, (cam as any).reversedDepth);
      cam.getWorldPosition(camPos);
      nearN.fill(0); farN.fill(0);
      for (const c of chunks) {
        const d = Math.max(0, Math.hypot(c.cx - camPos.x, c.cz - camPos.z) - CH * 0.6);
        const isNear = d < 10;
        if (!isNear && !frustum.intersectsSphere(c.sphere)) continue;
        // Smooth density fade by distance instead of a hard pop.
        const fade = 1 - Math.min(1, Math.max(0, (d - 14) / (lodRadius - 14)));
        const meshes = isNear ? nearMeshes : farMeshes, counts = isNear ? nearN : farN;
        for (const e of c.kits) {
          const f = e.tall ? Math.max(fade, d < lodRadius * 1.3 ? 0.6 : 0) : fade * fade;
          const n = Math.floor(e.full * f);
          const im = meshes[e.k];
          if (n === 0 || !im) continue;
          const o = counts[e.k];
          (im.instanceMatrix.array as Float32Array).set(e.mats.subarray(0, n * 16), o * 16);
          (im.instanceColor!.array as Float32Array).set(e.cols.subarray(0, n * 3), o * 3);
          counts[e.k] = o + n;
        }
      }
      for (let k = 0; k < KITS.length; k++) { upload(nearMeshes[k], nearN[k]); upload(farMeshes[k], farN[k]); }
    },
  };
}
