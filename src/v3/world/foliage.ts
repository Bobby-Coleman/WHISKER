// Stylised nature and field pieces (v3): trees as a curved trunk under lumpy canopy blobs, the hero hawthorn, boulders,
// bushes, flower dots, dry-stone walls and fences, banners that wave. Repeated things are instanced or merged by
// material so a whole moor is a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toy, PAL, col, SCENERY_WIND } from '../render/materials';
import { stone } from './kit';
import { RAPIER, Physics, L } from '../physics';
import { WIND } from '../body';

export const rng = (seed: number) => { let s = seed % 2147483647 || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// A lumpy blob: an icosphere pushed about by a few sine lobes, coloured darker underneath.
function blob(r: number, seed: number, top: THREE.Color, bottom: THREE.Color, detail = 2) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, R = rng(seed);
  const a = [R() * 6, R() * 6, R() * 6, R() * 6];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    const k = 1 + 0.12 * Math.sin(n.x * 4 + a[0]) * Math.sin(n.y * 3 + a[1]) + 0.08 * Math.sin(n.z * 5 + a[2]) + 0.05 * Math.sin((n.x + n.z) * 7 + a[3]);
    v.multiplyScalar(k);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const c = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / r;
    tmp.copy(bottom).lerp(top, THREE.MathUtils.smoothstep(y, -0.8, 0.7));
    c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function colored(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.index) g = g.toNonIndexed();
  return g;
}
const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };

// A trunk: a tube along a curve, tapering, with a couple of branches; bark-coloured with a darker foot.
function trunk(height: number, radius: number, lean: THREE.Vector3, seed: number, branches = 3, lo = false) {
  const R = rng(seed);
  const pts = [new THREE.Vector3(0, -0.3, 0)];
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector3(lean.x * t * t + Math.sin(t * 5 + seed) * 0.08 * height * 0.1, height * t, lean.z * t * t + Math.cos(t * 4 + seed) * 0.08 * height * 0.1));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geos: THREE.BufferGeometry[] = [];
  const segs = lo ? 5 : 16, rad = lo ? 5 : 9;
  const tube = new THREE.TubeGeometry(curve, segs, radius, rad, false);
  // Taper.
  const p = tube.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const seg = Math.floor(i / (rad + 1)) / segs;
    const c = curve.getPointAt(Math.min(1, seg));
    const v = new THREE.Vector3().fromBufferAttribute(p, i).sub(c).multiplyScalar(1.15 - seg * 0.6 + (seg < 0.1 ? 0.3 * (0.1 - seg) * 10 : 0));
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  tube.computeVertexNormals();
  geos.push(strip(tube));
  const tips: THREE.Vector3[] = [curve.getPointAt(1)];
  for (let b = 0; b < branches; b++) {
    const t0 = 0.45 + R() * 0.4, a = R() * Math.PI * 2;
    const s = curve.getPointAt(t0);
    const e = s.clone().add(new THREE.Vector3(Math.cos(a) * height * 0.35, height * (0.15 + R() * 0.2), Math.sin(a) * height * 0.35));
    const m = s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, height * 0.06, 0));
    const bc = new THREE.QuadraticBezierCurve3(s, m, e);
    const bs = lo ? 2 : 6, br = lo ? 4 : 6;
    const bt = new THREE.TubeGeometry(bc, bs, radius * 0.45, br, false);
    const bp = bt.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const seg = Math.floor(i / (br + 1)) / bs, c = bc.getPoint(Math.min(1, seg));
      const v = new THREE.Vector3().fromBufferAttribute(bp, i).sub(c).multiplyScalar(1 - seg * 0.6);
      bp.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    }
    bt.computeVertexNormals();
    geos.push(strip(bt));
    tips.push(e);
  }
  return { geo: mergeGeometries(geos)!, tips, top: curve.getPointAt(1) };
}

export type TreeKind = { height: number; radius: number; canopy: number; leaf: string; leafDark: string; bark: string; blobs: number; lean?: number };
export const TREES: Record<string, TreeKind> = {
  oak: { height: 3.6, radius: 0.2, canopy: 1.5, leaf: '#6b775b', leafDark: '#384a3c', bark: '#625447', blobs: 6, lean: 1.8 },
  birch: { height: 4.4, radius: 0.11, canopy: 1.0, leaf: '#92967a', leafDark: '#4e6048', bark: '#c3c4b6', blobs: 4, lean: 1.5 },
  pine: { height: 5, radius: 0.16, canopy: 1.2, leaf: '#4e6758', leafDark: '#2b4138', bark: '#574c40', blobs: 0 },
};

const plantMats = new Map<number, THREE.MeshStandardMaterial>();
function plantMaterial(height: number) {
  const key = Math.round(height * 10);
  const cached = plantMats.get(key);
  if (cached) return cached;
  const base = toy('#ffffff', { vertexColors: true, rough: 0.9 });
  const mat = base.clone();
  mat.onBeforeCompile = (sh, renderer) => {
    base.onBeforeCompile(sh, renderer);
    sh.uniforms.plantTime = SCENERY_WIND.time; sh.uniforms.plantWind = SCENERY_WIND.direction;
    sh.uniforms.plantStrength = SCENERY_WIND.strength; sh.uniforms.plantGust = SCENERY_WIND.gust;
    sh.uniforms.plantHeight = { value: height };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float plantTime, plantStrength, plantGust, plantHeight; uniform vec2 plantWind;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        float crown = pow(clamp(position.y / max(plantHeight, 0.1), 0.0, 1.0), 2.0);
        vec4 treeRoot = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          treeRoot = instanceMatrix * treeRoot;
        #endif
        treeRoot = modelMatrix * treeRoot;
        float wave = sin(dot(treeRoot.xz, plantWind) * 0.09 - plantTime * 1.1) * 0.5 + 0.5;
        float bend = crown * (0.025 + plantStrength * 0.035 + plantGust * wave * 0.085) * plantHeight;
        bend *= 0.75 + 0.25 * sin(plantTime * 2.1 + treeRoot.x * 0.3);
        mvPosition.xyz += mat3(viewMatrix) * vec3(plantWind.x * bend, -abs(bend) * 0.08, plantWind.y * bend);
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'moor-plant';
  plantMats.set(key, mat);
  return mat;
}

// One tree's geometry (trunk + canopy), vertex-coloured, centred on its base.
// lo: a distant tree (coarser trunk, faceted canopy), about a quarter of the triangles.
export function treeGeometry(k: TreeKind, seed: number, lo = false) {
  const R = rng(seed);
  const lean = new THREE.Vector3((R() - 0.5) * 0.6 * (k.lean ?? 1), 0, (R() - 0.5) * 0.6 * (k.lean ?? 1));
  const t = trunk(k.height, k.radius, lean, seed, k.blobs ? 3 : 0, lo);
  const geos = [colored(t.geo, col(k.bark))];
  if (k.blobs) {
    for (let i = 0; i < k.blobs; i++) {
      const at = i < t.tips.length ? t.tips[i] : t.top.clone().add(new THREE.Vector3((R() - 0.5) * k.canopy, (R() - 0.3) * k.canopy * 0.6, (R() - 0.5) * k.canopy));
      const r = k.canopy * (0.55 + R() * 0.45) * (i === 0 ? 1.15 : 0.85);
      geos.push(blob(r, seed * 7 + i, col(k.leaf), col(k.leafDark), lo ? 1 : 2).translate(at.x, at.y + r * 0.2, at.z));
    }
  } else {
    // A pine: stacked cones.
    for (let i = 0; i < 4; i++) {
      const r = k.canopy * (1 - i * 0.2), y = k.height * (0.35 + i * 0.18);
      const cone = new THREE.ConeGeometry(r, k.height * 0.36, lo ? 6 : 9, 1).translate(lean.x * 0.8, y, lean.z * 0.8);
      geos.push(colored(cone, col(k.leaf).lerp(col(k.leafDark), 0.5 - i * 0.12)));
    }
  }
  return mergeGeometries(geos.map((g) => strip(g)))!;
}

// Many trees of a few variants: one draw per variant. Colliders (a capsule up the trunk) when physics is given.
// far: low-detail trees that cast no shadow (the shadow map only covers the play area; casting would just draw
// every instance again into it).
export function forest(kind: TreeKind, spots: { x: number; y: number; z: number; s?: number; yaw?: number }[], physics?: Physics, variants = 3, seed = 1, far = false) {
  const group = new THREE.Group(); group.name = far ? 'ForestFar' : 'Forest';
  const mat = far ? toy('#ffffff', { vertexColors: true, rough: 0.9 }) : plantMaterial(kind.height);
  const geos = Array.from({ length: variants }, (_, i) => treeGeometry(kind, seed * 31 + i * 7, far));
  const buckets = new Map<string, { variant: number; matrices: THREE.Matrix4[] }>();
  spots.forEach((p, i) => {
    const s = p.s ?? 1;
    // Spatial batches keep a whole woodland's bounding sphere from making every tree render in every view.
    const variant = i % variants, cell = far ? 72 : 32;
    const key = `${variant}|${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = { variant, matrices: [] });
    bucket.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? i * 2.4), new THREE.Vector3(s, s, s)));
    if (physics) physics.addFixed(RAPIER.ColliderDesc.capsule(kind.height * s * 0.35, kind.radius * s * 1.1).setTranslation(p.x, p.y + kind.height * s * 0.35, p.z), { kind: 'wood' }, L.world);
  });
  for (const bucket of buckets.values()) {
    const m = new THREE.InstancedMesh(geos[bucket.variant], mat, bucket.matrices.length);
    bucket.matrices.forEach((mm, j) => m.setMatrixAt(j, mm));
    m.castShadow = !far; m.receiveShadow = !far; m.computeBoundingSphere();
    group.add(m);
  }
  return group;
}

// The hawthorn: a gnarled, leaning trunk, sparse wind-bent canopy in autumn red-orange, a scatter of red haws.
export function hawthorn(seed = 3) {
  const R = rng(seed);
  const t = trunk(3.4, 0.24, new THREE.Vector3(1.1, 0, 0.35), seed, 4);
  const geos: THREE.BufferGeometry[] = [colored(t.geo, col('#4f3a2c'))];
  const tips = t.tips.concat([t.top.clone().add(new THREE.Vector3(0.6, -0.2, -0.5)), t.top.clone().add(new THREE.Vector3(-0.5, 0.1, 0.6))]);
  tips.forEach((p, i) => {
    const r = 0.75 + R() * 0.45;
    geos.push(blob(r, seed * 13 + i, col('#aa7755'), col('#655244')).scale(1.38, 0.67, 1.05).translate(p.x + 0.25, p.y + 0.15, p.z));
  });
  const merged = mergeGeometries(geos.map((g) => strip(g)))!;
  const g = new THREE.Group(); g.name = 'Hawthorn';
  const m = new THREE.Mesh(merged, plantMaterial(3.4));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.dynamic = true; m.userData.keep = true;
  g.add(m);
  // Haws: little red berries among the leaves.
  const haws = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 1), toy('#c2262e', { rough: 0.4 }), 60);
  const M = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) {
    const p = tips[i % tips.length];
    M.makeTranslation(p.x + 0.25 + (R() - 0.5) * 1.6, p.y + 0.15 + (R() - 0.5) * 0.9, p.z + (R() - 0.5) * 1.4);
    haws.setMatrixAt(i, M);
  }
  g.add(haws);
  return { group: g, top: t.top };
}

// Boulders: lumpy grey stones, instanced, each with a collider (a ball, or a squat cylinder for flat ones).
export function boulders(spots: { x: number; y: number; z: number; s: number; yaw?: number }[], physics?: Physics, color = '#9a9890') {
  const group = new THREE.Group();
  const variants = [0, 1, 2].map((i) => blob(1, 40 + i * 9, col(color), col('#6f6d68'), 1));
  const mat = toy('#ffffff', { vertexColors: true, rough: 0.95, flat: true });
  const buckets: THREE.Matrix4[][] = [[], [], []];
  spots.forEach((p, i) => {
    buckets[i % 3].push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? i * 1.7), new THREE.Vector3(p.s, p.s * 0.75, p.s)));
    if (physics) physics.addFixed(RAPIER.ColliderDesc.ball(p.s * 0.82).setTranslation(p.x, p.y + p.s * 0.05, p.z), { kind: 'stone' }, L.world);
  });
  variants.forEach((g, i) => {
    if (!buckets[i].length) return;
    const m = new THREE.InstancedMesh(g, mat, buckets[i].length);
    buckets[i].forEach((mm, j) => m.setMatrixAt(j, mm));
    m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere();
    group.add(m);
  });
  return group;
}

// Bushes (and hedgerows when packed along a line), instanced.
export function bushes(spots: { x: number; y: number; z: number; s: number }[], leaf = '#68775c', dark = '#374d3e', physics?: Physics) {
  const g = blob(1, 77, col(leaf).lerp(col('#7a8171'), 0.4), col(dark).lerp(col('#435247'), 0.25), 2);
  const m = new THREE.InstancedMesh(g, plantMaterial(1.3), spots.length);
  spots.forEach((p, i) => {
    m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + p.s * 0.45, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.1), new THREE.Vector3(p.s, p.s * 0.9, p.s)));
    if (physics) physics.addFixed(RAPIER.ColliderDesc.ball(p.s * 0.85).setTranslation(p.x, p.y + p.s * 0.4, p.z), { kind: 'leaves' }, L.world);
  });
  m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere();
  return m;
}

// Flowers: tiny bright heads on stalks scattered through the grass (no collision).
export function flowers(spots: { x: number; y: number; z: number }[], colors = ['#d5d4c5', '#b8ad79', '#9a94a6', '#b38d94']) {
  const head = new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.16, 0);
  const stalk = new THREE.CylinderGeometry(0.005, 0.006, 0.16, 3).translate(0, 0.08, 0);
  const g = mergeGeometries([colored(head, new THREE.Color(1, 1, 1)), colored(stalk, col('#4f8a3a'))].map(strip))!;
  // Stalks keep their green: tint only the heads through instance colour mixed in the vertex colour (heads white).
  const m = new THREE.InstancedMesh(g, toy('#ffffff', { vertexColors: true, rough: 0.7 }), spots.length);
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    const s = 0.7 + ((i * 37) % 10) / 15;
    m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    m.setColorAt(i, c.set(colors[i % colors.length]));
  });
  m.computeBoundingSphere();
  return m;
}

// A dry-stone wall along a polyline: stacked rounded courses, a collider box per segment. Gaps where `gaps` say.
export function stoneWall(line: THREE.Vector3[], height: number, width: number, physics?: Physics, color = '#a19d92') {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const mid = a.clone().lerp(b, 0.5);
    const box = new THREE.BoxGeometry(width, height, len + width * 0.6, 1, 1, 1);
    // Slightly bowed top.
    const p = box.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setX(k, p.getX(k) * 0.82);
    box.computeVertexNormals();
    box.rotateY(yaw).translate(mid.x, Math.min(a.y, b.y) + height / 2 - 0.05, mid.z);
    geos.push(strip(box));
    if (physics) physics.addBox(new THREE.Vector3(mid.x, Math.min(a.y, b.y) + height / 2 - 0.05, mid.z), new THREE.Vector3(width / 2, height / 2 + 0.05, len / 2 + width * 0.3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { kind: 'stone' }, L.world);
  }
  const m = new THREE.Mesh(mergeGeometries(geos)!, stone(color, 0.32));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// A post-and-rail fence along a polyline (posts every ~2 m), colliders per segment (kitten can slip under the rails
// when `gapUnder`).
export function fence(line: THREE.Vector3[], physics?: Physics, gapUnder = true) {
  const geos: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6);
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < line.length - 2) continue;
      const p = a.clone().lerp(b, k / n);
      geos.push(strip(post.clone().translate(p.x, p.y + 0.5, p.z)));
    }
    const yaw = Math.atan2(b.x - a.x, b.z - a.z), mid = a.clone().lerp(b, 0.5);
    for (const h of [0.45, 0.85]) geos.push(strip(new THREE.BoxGeometry(0.05, 0.09, len).rotateY(yaw).translate(mid.x, (a.y + b.y) / 2 + h, mid.z)));
    if (physics) physics.addBox(new THREE.Vector3(mid.x, (a.y + b.y) / 2 + (gapUnder ? 0.7 : 0.5), mid.z), new THREE.Vector3(0.06, gapUnder ? 0.3 : 0.55, len / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { kind: 'wood' }, L.world);
  }
  const m = new THREE.Mesh(mergeGeometries(geos)!, toy(PAL.wood));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// A banner on a pole: the cloth waves in the wind in its vertex shader (one shared clock).
export const BANNER_TIME = SCENERY_WIND.time;
const bannerMats = new Map<string, THREE.Material>();
export function banner(color: string, h = 3.2, w = 0.7, len = 1.3, lean = 0) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, h, 7).translate(0, h / 2, 0), toy(PAL.woodDark));
  pole.castShadow = true;
  g.add(pole);
  const cloth = new THREE.PlaneGeometry(w, len, 6, 8).translate(w / 2, -len / 2, 0);
  // Swallow-tail cut.
  const p = cloth.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / w, y = -p.getY(i) / len; if (y > 0.85) p.setY(i, -len * (0.85 + 0.15 * (1 - Math.abs(x - 0.5) * 2))); }
  const materialKey = `${color}|${w}`;
  let mat = bannerMats.get(materialKey);
  if (!mat) {
    const base = toy(color, { side: THREE.DoubleSide });
    const m = base.clone();
    m.onBeforeCompile = (sh, renderer) => {
      base.onBeforeCompile(sh, renderer);
      sh.uniforms.bTime = BANNER_TIME;
      sh.uniforms.bStrength = SCENERY_WIND.strength; sh.uniforms.bGust = SCENERY_WIND.gust;
      sh.uniforms.bWidth = { value: w };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float bTime, bStrength, bGust, bWidth;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float f = clamp(transformed.x / bWidth, 0.0, 1.0);
          float force = 0.09 + bStrength * 0.16 + bGust * 0.18;
          transformed.z += sin(bTime * (3.1 + bGust * 2.0) + f * 4.0 - transformed.y * 1.5) * force * f;
          transformed.y += sin(bTime * 2.3 + f * 3.0) * (0.025 + bGust * 0.065) * f;`);
    };
    m.customProgramCacheKey = () => 'banner';
    mat = m;
    bannerMats.set(materialKey, m);
  }
  const c = new THREE.Mesh(cloth, mat);
  c.position.y = h - 0.08;
  c.castShadow = true;
  g.add(c);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toy(PAL.gold, { rough: 0.4 }));
  finial.position.y = h + 0.04;
  g.add(finial);
  g.rotation.z = lean;
  c.userData.dynamic = true; c.userData.keep = true; // its shader waves the cloth in object space: never merged
  // Cloth always streams downwind: the level turns the group's y to face WIND.dir.
  g.userData.cloth = c;
  return g;
}
export function aimBanner(b: THREE.Object3D) { b.rotation.y = Math.atan2(-WIND.dir.y, WIND.dir.x); }
