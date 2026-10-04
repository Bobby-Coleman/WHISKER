// The fallen of the battle (the prologue): soldiers and horses lying where they fell. A soldier is a copy of the
// knight (v1's model, every piece of plate and cloth) laid out in one of a few poses, some in a coloured tabard, and
// then baked: each material's pieces merged into one geometry, so a whole field of them is a handful of instanced
// draws. Horses are sculpted from signed distance fields, lying on their sides, legs out stiff.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Knight } from '../chars/knight';
import { solveTwoBone, orientBone } from '../chars/rig';
import { polygonize, union, ellipsoid, capsule, SDF } from '../chars/sdf';
import { clothMaterial } from '../chars/materials';

export type Baked = { geometry: THREE.BufferGeometry; material: THREE.Material }[];

type V = [number, number, number];
// A pose, in the knight's standing frame (+Y up, +Z his front, +X his left): where the ankles and hands go and which
// way knees and elbows bend; the head's turn; then how the body is laid on the ground (a rotation and a lift).
type FallenPose = {
  ankles: [V, V]; knees: [V, V]; hands: [V, V]; elbows: [V, V]; head: V; chest: V; lay: V; lift: number; sword?: { at: V; rot: V };
};
const POSES: FallenPose[] = [
  // On his back, one arm flung out, one knee up, the head fallen aside.
  { ankles: [[0.24, 0.12, 0.05], [-0.2, 0.08, -0.03]], knees: [[0.3, 0, 1], [-0.1, 0, 1]], hands: [[0.62, 1.6, -0.05], [-0.42, 0.95, 0.0]], elbows: [[1, -0.3, -0.4], [-1, 0, -0.6]],
    head: [0.15, 0.7, 0.1], chest: [0.05, 0.12, 0.04], lay: [-Math.PI / 2, 0, 0], lift: 0.17, sword: { at: [-0.75, 1.3, -0.12], rot: [0, 0, 0.5] } },
  // Face down, one arm reaching on ahead, a leg drawn up.
  { ankles: [[0.18, 0.06, -0.02], [-0.34, 0.3, -0.22]], knees: [[0.1, 0, 1], [-1, 0, 0.6]], hands: [[0.22, 2.02, 0.12], [-0.32, 0.92, 0.1]], elbows: [[1, 0, -0.3], [-1, 0, -1]],
    head: [0.0, -0.9, 0.0], chest: [-0.06, -0.15, 0.0], lay: [Math.PI / 2, 0, 0], lift: 0.21 },
  // On his side, curled round, his hands in front of him.
  { ankles: [[0.1, 0.25, 0.3], [-0.06, 0.16, 0.12]], knees: [[0, 0, 1], [0, 0, 1]], hands: [[0.12, 1.05, 0.45], [-0.1, 1.15, 0.38]], elbows: [[1, -1, 0.2], [-1, -1, 0.2]],
    head: [0.35, 0.2, 0.0], chest: [0.3, 0.0, 0.0], lay: [0, 0, -Math.PI / 2], lift: 0.25 },
];

const TABARDS: Record<string, string> = { red: '#6a2420', blue: '#26304a' };

function poseFallen(k: Knight, f: FallenPose) {
  const P = k.parts, g = k.gait.p;
  k.group.position.set(0, 0, 0); k.group.rotation.set(0, 0, 0); k.group.scale.setScalar(1);
  P.pelvis.position.set(0, g.hipY, 0); P.pelvis.rotation.set(0, 0, 0);
  P.pelvis.updateMatrix();
  P.chest.position.copy(new THREE.Vector3(0, 0.1, 0).applyMatrix4(P.pelvis.matrix));
  P.chest.rotation.set(f.chest[0], f.chest[1], f.chest[2]);
  P.chest.updateMatrix();
  P.head.position.copy(new THREE.Vector3(0, 0.445, 0).applyMatrix4(P.chest.matrix));
  P.head.rotation.set(f.head[0], f.head[1], f.head[2], 'YXZ');
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const th = side > 0 ? P.thighL : P.thighR, sh = side > 0 ? P.shinL : P.shinR, ft = side > 0 ? P.footL : P.footR;
    const hip = new THREE.Vector3(side * g.hipW, 0, 0).applyMatrix4(P.pelvis.matrix);
    const pole = new THREE.Vector3(...f.knees[i]);
    const knee = new THREE.Vector3();
    const end = solveTwoBone(hip, new THREE.Vector3(...f.ankles[i]), g.l1, g.l2, pole, knee);
    orientBone(th, hip, knee, pole);
    orientBone(sh, knee, end, pole);
    ft.position.copy(end); ft.rotation.set(-0.6, side * 0.4, 0);
    const arm = side > 0 ? k.armL : k.armR;
    arm.target.set(...f.hands[i]); arm.pole.set(...f.elbows[i]); arm.useHandQ = false;
  }
  (k as any).solveArms();
  if (f.sword) { k.sword.visible = true; k.sword.position.set(...f.sword.at); k.sword.rotation.set(...f.sword.rot); }
  else k.sword.visible = false;
  for (const p of Object.values(P)) p.updateMatrix();
  k.group.rotation.set(f.lay[0], f.lay[1], f.lay[2]);
  k.group.position.y = f.lift;
  k.group.updateMatrixWorld(true);
}

// Merges a posed object's meshes by material (and attribute layout) into baked pieces.
export function bake(root: THREE.Object3D): Baked {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  root.traverse((o: any) => {
    if (!o.isMesh || !o.visible || Array.isArray(o.material)) return;
    let p = o; let shown = true;
    while (p) { if (!p.visible) shown = false; p = p.parent; }
    if (!shown) return;
    const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    for (const n of Object.keys(g.morphAttributes)) delete g.morphAttributes[n];
    const key = `${o.material.uuid}|${Object.keys(g.attributes).sort().join(',')}|${g.index ? 1 : 0}`;
    let e = groups.get(key);
    if (!e) { e = { material: o.material, geos: [] }; groups.set(key, e); }
    e.geos.push(g);
  });
  const out: Baked = [];
  for (const e of groups.values()) {
    const m = e.geos.length > 1 ? mergeGeometries(e.geos, false) : e.geos[0];
    if (m) out.push({ geometry: m, material: e.material });
    else for (const g of e.geos) out.push({ geometry: g, material: e.material });
  }
  return out;
}

// One baked soldier per pose and tabard (none, red, blue): `kinds[i]` = [pose, tabard].
export function bakeSoldiers(hero: Map<string, THREE.BufferGeometry> | null, kinds: [number, string | null][]): Baked[] {
  const out: Baked[] = [];
  const tabMats = new Map<string, THREE.Material>();
  for (const [pose, tab] of kinds) {
    const k = new Knight(hero);
    // A tabard over the plate: a panel on the chest and one hanging from the belt.
    if (tab) {
      let m = tabMats.get(tab);
      if (!m) { m = clothMaterial(TABARDS[tab], { rough: 0.95, weave: 0.5 }); (m as any).side = THREE.DoubleSide; tabMats.set(tab, m); }
      const top = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.4), m);
      top.position.set(0, 0.17, 0.215); top.rotation.x = -0.06;
      k.parts.chest.add(top);
      const low = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.46), m);
      low.position.set(0, -0.16, 0.2); low.rotation.x = 0.1;
      k.parts.pelvis.add(low);
    }
    poseFallen(k, POSES[pose]);
    out.push(bake(k.group));
  }
  return out;
}

// A horse lying dead on its side: sculpted standing (+Y up, facing +Z), then laid on its right side.
export function horseGeometry(coat: 'bay' | 'grey' | 'black') {
  type YZ = [number, number];
  const leg = (x: number, top: YZ, knee: YZ, hoof: YZ, r: number) => [
    capsule(x, top[0], top[1], x, knee[0], knee[1], r, r * 0.62),
    capsule(x, knee[0], knee[1], x, hoof[0], hoof[1], r * 0.6, r * 0.5),
    ellipsoid(x, hoof[0] - 0.02, hoof[1] + 0.02, r * 0.75, r * 0.6, r * 0.85),
  ];
  const S: SDF = union(0.06,
    ellipsoid(0, 1.25, 0.02, 0.3, 0.36, 0.74), // barrel
    ellipsoid(0, 1.3, 0.52, 0.28, 0.35, 0.3), // chest
    ellipsoid(0, 1.32, -0.58, 0.31, 0.36, 0.36), // quarters
    capsule(0, 1.42, 0.68, 0, 1.92, 1.02, 0.17, 0.11), // neck
    capsule(0, 1.95, 1.03, 0, 1.72, 1.45, 0.13, 0.08), // head, the muzzle down and forward
    ellipsoid(0, 1.86, 1.12, 0.1, 0.12, 0.13), // jaw
    capsule(0.05, 2.02, 1.0, 0.06, 2.13, 0.98, 0.025, 0.012), capsule(-0.05, 2.02, 1.0, -0.06, 2.13, 0.98, 0.025, 0.012), // ears
    ...leg(0.15, [1.05, 0.52], [0.55, 0.6], [0.06, 0.58], 0.085), ...leg(-0.15, [1.05, 0.52], [0.55, 0.62], [0.06, 0.62], 0.085),
    ...leg(0.15, [1.1, -0.6], [0.6, -0.8], [0.06, -0.68], 0.1), ...leg(-0.15, [1.1, -0.6], [0.6, -0.78], [0.06, -0.62], 0.1),
    capsule(0, 1.45, -0.9, 0, 0.9, -1.12, 0.07, 0.05), // tail
  );
  // Laid on its right side: standing (x, y, z) goes to (1.25 - y, x + 0.34, z), its legs out across the ground.
  const L: SDF = (x, y, z) => S(y - 0.34, 1.25 - x, z);
  const base = { bay: '#5a3a24', grey: '#8d8a84', black: '#2a2522' }[coat];
  const c0 = new THREE.Color(base), dark = new THREE.Color('#1e1714'), pale = c0.clone().lerp(new THREE.Color('#d8d0c4'), 0.25);
  const lin = (c: THREE.Color) => [c.r, c.g, c.b] as [number, number, number];
  return polygonize(L, new THREE.Vector3(-1.15, -0.05, -1.35), new THREE.Vector3(1.4, 0.78, 1.65), 80, (x, y, z) => {
    const sy = 1.25 - x; // standing height
    // Dark points (lower legs, mane and tail), a paler belly.
    if (coat !== 'grey' && (sy < 0.62 || (z < -0.82 && sy > 0.85))) return lin(dark);
    if (sy < 0.14) return lin(dark); // hooves
    if (sy > 1.45 && z > 0.62 && z < 1.08 && Math.abs(y - 0.34) < 0.07) return lin(dark); // mane
    if (sy < 1.0 && sy > 0.62) return lin(pale);
    return lin(c0);
  });
}
