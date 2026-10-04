// The prologue, "The Hawthorn" (docs/STORY.md): the Grey Moor at dusk after the battle, in rain and fog. Wordless
// but for him, like a Pixar short. The wounded knight limps up the road out of the mist to a lone hawthorn on a rise
// and slides down against its trunk; by the overturned camp wagon a tiny kitten nudges her mother, who will not wake,
// until a horn far off sends her out into the fog. From there she is played: across the hedged fields of the
// battlefield toward the sound of his breathing, under a wrecked cart, over the palisade's fallen log, swimming the
// flooded ditch and up the barricade's plank. She finds him and jumps up into his lap; he lifts his head and speaks
// to her through his helm. The title, and two summers later.
//
// The fields are walled by real hedgerows (no invisible walls): one gap in each, on the road, each blocked by
// something she gets past her own way. The hawthorn on its rise, banners, fires and smoke show the way.
import * as THREE from 'three/webgpu';
import { Simplex2, smoothstep } from '../../world/noise';
import { FIELD_OVERRIDE, PATHS, PUDDLES, STANDING_STONES } from '../../world/layout';
import { LOOK } from '../../render/settings';
import { RAPIER, Physics, L } from '../physics';
import { LevelBuilder, paintMaterial } from '../level';
import { placeProp, instanceProp, instanceBaked } from '../props';
import { Campfire, createRain, SmokePlume } from '../fx';
import { Water } from '../water';
import { WATER } from '../motor';
import { bakeSoldiers, horseGeometry } from '../fallen';
import type { LevelInfo } from '../game';
import type { Cutscene } from '../timeline';
import type { LevelModule, StoryContext } from './types';
import { DrivenAvatar } from '../driven';
import { Subtitles, say } from '../speech';

type P2 = [number, number];
const n1 = new Simplex2(71), n2 = new Simplex2(83), n3 = new Simplex2(97);
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ---- The map (metres; north is -Z). The fields' outer hedges; inside, three lines across between the camp and the
// hawthorn, each with one gap on the road.
const W = -30, E = 17, N = -16, S = 46;
const CAMP = { x: -14, z: 37 };
// The camp was laid out round (-12.4, 23.4); its pieces keep their places relative to it.
const cx = (x: number) => x + CAMP.x + 12.4, cz = (z: number) => z + CAMP.z - 23.4;
const MOTHER = new THREE.Vector3(cx(-12.35), 0, cz(24.3));
const SEAT = new THREE.Vector3(0, 0, 0.36); // where the knight sits, his back to the trunk
const TRUNK = new THREE.Vector3(0, 0, -0.18);
// The road: in from the south through the camp, through each gap, past the hawthorn and away north-east.
const ROAD: P2[] = [[-17, 60], [-16.2, 46], [-15.4, 41], [-13.4, 35.4], [-11.2, 30.6], [-9.6, 26.6], [-8.4, 23.2], [-7.4, 19.8], [-6.6, 16.6],
  [-5.4, 13.2], [-3.9, 9.2], [-2.2, 5.4], [-0.6, 2.9], [1.6, 1.8], [4.6, -2.4], [9, -9], [14, -16], [22, -30]];
const H1: P2[] = [[W, 32.4], [-20, 31.6], [-11.2, 30.6], [0, 29.4], [E, 28.6]];
const PAL: P2[] = [[W, 24.6], [-17, 24.0], [-8.4, 23.2], [4, 22.2], [E, 21.4]];
const H3: P2[] = [[W, 11.0], [-14, 10.2], [-3.9, 9.2], [6, 7.4], [E, 5.8]];
const CART = new THREE.Vector2(-11.2, 30.6), LOG = new THREE.Vector2(-8.4, 23.2), DITCH = new THREE.Vector2(-6.6, 16.8), CRATES = new THREE.Vector2(-3.9, 9.2);
// Where the road leaves the fields: blocked by wreckage.
const ROADBLOCKS: P2[] = [[-16.2, 46], [14, -16]];

const water = new Water();

function moor(x: number, z: number) {
  let h = 0.8 * n1.fbm(x / 55, z / 55, 4) + 0.25 * n2.fbm(x / 15, z / 15, 3) + 0.04 * n3.noise(x / 3, z / 3);
  h += smoothstep(70, 360, Math.hypot(x + 6, z - 15)) * (12 + 18 * n2.fbm(x / 220, z / 220, 4));
  return h;
}
const segs = (line: P2[]) => line.slice(1).map((p, i) => [line[i], p] as [P2, P2]);
const ROAD_SEG = segs(ROAD);
function lineDist(sg: [P2, P2][], x: number, z: number) {
  let d = Infinity;
  for (const [[ax, az], [bx, bz]] of sg) {
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return d;
}
const H_CAMP = moor(CAMP.x, CAMP.z);
export function height(x: number, z: number) {
  let h = moor(x, z);
  // The rise the hawthorn stands on.
  h += 1.25 * Math.exp(-(x * x + z * z) / (2 * 6.5 * 6.5));
  // The camp, levelled.
  const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
  h += (H_CAMP - h) * (1 - smoothstep(3, 9, dc));
  // A little flat under the knight and the trunk.
  const ds = Math.hypot(x - SEAT.x, z - SEAT.z);
  const hs = moor(0, 0.3) + 1.25 * Math.exp(-(0.09) / (2 * 6.5 * 6.5));
  h += (hs - h) * (1 - smoothstep(0.8, 2.2, ds));
  // The road, worn a little lower.
  h -= 0.06 * (1 - smoothstep(0.4, 1.6, lineDist(ROAD_SEG, x, z)));
  return water.carve(h, x, z);
}

// Points every `step` metres along a line, with its direction.
function along(line: P2[], step: number) {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  for (const [[ax, az], [bx, bz]] of segs(line)) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) out.push({ x: ax + (bx - ax) * i / n, z: az + (bz - az) * i / n, dx: (bx - ax) / len, dz: (bz - az) / len });
  }
  const [ax, az] = line[line.length - 2], [bx, bz] = line[line.length - 1];
  const len = Math.hypot(bx - ax, bz - az);
  out.push({ x: bx, z: bz, dx: (bx - ax) / len, dz: (bz - az) / len });
  return out;
}

export const prologue: LevelModule = {
  weather: 'dusk',

  prepareField() {
    PATHS.length = 0; PUDDLES.length = 0; STANDING_STONES.length = 0;
    PATHS.push(ROAD.map(([x, z]) => ({ x, z })));
    // Ruts round the camp.
    PATHS.push([{ x: cx(-14), z: cz(30) }, { x: cx(-12.4), z: cz(25.5) }, { x: cx(-9), z: cz(26) }]);
    // The water: the flooded ditch in front of the palisade, right across the fields (and out under the hedges);
    // a shell-hole pond in the camp field; a pool among the reeds west of the hawthorn.
    water.pools.length = 0;
    const ditchLevel = Math.min(...[-34, -26, -18, -10, -6.6, -2, 6, 14, 21].map((x) => moor(x, 16.8 - 0.051 * (x + 6.5)))) - 0.12;
    water.add({ x: -6.5, z: 16.8, rx: 28.5, rz: 1.65, rot: -0.051, level: ditchLevel, depth: 0.7 });
    water.add({ x: -22.5, z: 39.5, rx: 3.4, rz: 2.5, rot: 0.6, level: moor(-22.5, 39.5) - 0.18, depth: 0.55 });
    water.add({ x: -17, z: -4, rx: 4.6, rz: 3.0, rot: -0.4, level: moor(-17, -4) - 0.2, depth: 0.8 });
    // Churned mud where the fallen lie, and round the gaps where the fighting was thickest.
    for (const [x, z] of [...SOLDIERS, ...HORSES]) PATHS.push([{ x, z }, { x: x + 0.3, z: z + 0.2 }]);
    FIELD_OVERRIDE.height = height;
    // Grass keeps off the road and the camp's floor, and stays short round the knight (no tall blades in the close
    // shots) and out of the water.
    FIELD_OVERRIDE.exclusion = (x, z) => {
      const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
      const ds = 1 - smoothstep(2.2, 3.4, Math.hypot(x - SEAT.x, z - SEAT.z - 0.6));
      const lvl = water.surfaceAt(x, z);
      const wet = lvl !== null && height(x, z) < lvl + 0.04 ? 1 : 0;
      let fallen = 0;
      for (const [fx, fz] of SOLDIERS) fallen = Math.max(fallen, 1 - smoothstep(0.9, 1.6, Math.hypot(x - fx, z - fz)));
      for (const [fx, fz] of HORSES) fallen = Math.max(fallen, 1 - smoothstep(1.4, 2.3, Math.hypot(x - fx, z - fz)));
      return Math.max(Math.max(1 - smoothstep(2.5, 3.5, dc), 1 - smoothstep(0.7, 1.5, lineDist(ROAD_SEG, x, z))) * 0.85, ds, wet, fallen * 0.9);
    };
  },

  async build(physics: Physics, lv: LevelBuilder, scene: THREE.Scene): Promise<LevelInfo> {
    const root = lv.root;
    const H = (x: number, z: number) => height(x, z);
    SEAT.y = H(SEAT.x, SEAT.z); TRUNK.y = H(TRUNK.x, TRUNK.z); MOTHER.y = H(MOTHER.x, MOTHER.z);
    const wood = paintMaterial('#7e6045', 0.85), darkWood = paintMaterial('#5a4331', 0.9), iron = paintMaterial('#3c3e41', 0.55);
    const cloth = paintMaterial('#55302a', 0.95);
    const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const box = (c: THREE.Vector3, size: [number, number, number], yaw = 0, member = L.world, surface?: any) =>
      physics.addBox(c, new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), yawQ(yaw), surface, member);
    const props: Promise<unknown>[] = [];
    const prop = (id: string, x: number, z: number, o: { yaw?: number; pitch?: number; roll?: number; scale?: number; dy?: number; tint?: Record<string, string> } = {}) =>
      props.push(placeProp(id, { at: [x, H(x, z) + (o.dy ?? 0), z], yaw: o.yaw, pitch: o.pitch, roll: o.roll, scale: o.scale, tint: o.tint }, root));

    // ---- The water.
    scene.add(water.build(height));
    WATER.surface = (x, z) => water.surfaceAt(x, z);

    // ---- The hawthorn: a twisted tree, autumn-rusty, leaning out over where he will sit, on its rise.
    prop('nature/TwistedTree_1', TRUNK.x, TRUNK.z, { yaw: 2.35, scale: 0.4, dy: -0.15, tint: { Leaves_TwistedTree: '#9a5a36' } });
    physics.addFixed(RAPIER.ColliderDesc.cylinder(1.4, 0.26).setTranslation(TRUNK.x, TRUNK.y + 1.3, TRUNK.z));
    for (const [x, z, s, id] of [[-24, -14, 0.5, 'DeadTree_2'], [27, -6, 0.45, 'DeadTree_4'], [-36, 22, 0.55, 'DeadTree_4'], [24, 34, 0.5, 'DeadTree_2'], [12, -11, 0.42, 'DeadTree_4'], [-26, 18.5, 0.4, 'DeadTree_2']] as const) {
      prop(`nature/${id}`, x, z, { yaw: x, scale: s });
    }

    // ---- Hedgerows: bushes along each line, a dense dark core inside them, and a solid wall to bump into. Gaps
    // are left where the road goes through (each blocked by something of its own).
    const bushes: THREE.Matrix4[] = [], cores: THREE.Matrix4[] = [];
    const hedge = (line: P2[], gaps: P2[] = [], gapHalf = 1.3) => {
      const pts = along(line, 1.15);
      const runs: (typeof pts)[] = [];
      let run: typeof pts = [];
      for (const p of pts) {
        if (gaps.some(([gx, gz]) => Math.hypot(p.x - gx, p.z - gz) < gapHalf)) { if (run.length) runs.push(run); run = []; }
        else run.push(p);
      }
      if (run.length) runs.push(run);
      for (const r of runs) {
        r.forEach((p, i) => {
          for (const row of [0, 1]) {
            if (row && i % 2) continue;
            const ox = -p.dz * (row ? 0.55 : 0) + (rnd() - 0.5) * 0.3, oz = p.dx * (row ? 0.55 : 0) + (rnd() - 0.5) * 0.3;
            const x = p.x + ox, z = p.z + oz;
            const s = 1.1 + rnd() * 0.35;
            bushes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, H(x, z) - 0.12, z), yawQ(rnd() * 6.28), new THREE.Vector3(s, 0.95 + rnd() * 0.4, s)));
          }
        });
        for (let i = 0; i < r.length; i++) {
          const a = r[i], b = r[Math.min(i + 1, r.length - 1)];
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, len = Math.max(0.6, Math.hypot(b.x - a.x, b.z - a.z) + 0.35);
          const yaw = Math.atan2(a.dx, a.dz), y = H(mx, mz);
          box(new THREE.Vector3(mx, y + 0.8, mz), [1.15, 2.0, len], yaw, L.world, { kind: 'leaves' });
          cores.push(new THREE.Matrix4().compose(new THREE.Vector3(mx, y + 0.45, mz), yawQ(yaw), new THREE.Vector3(0.95, 1.05, len)));
          if (i === r.length - 2) break;
        }
      }
    };
    hedge([[W, N], [W, S]]); hedge([[E, N], [E, S]]);
    hedge([[W, N], [-8, N - 0.6], [E, N]], [ROADBLOCKS[1]]); hedge([[W, S], [E, S]], [ROADBLOCKS[0]]);
    hedge(H1, [[CART.x, CART.y]]);
    hedge(H3, [[CRATES.x, CRATES.y]]);
    props.push(instanceProp('nature/Bush_Common', bushes, root, { Leaves_TwistedTree: '#3d4a2b' }));
    {
      const core = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), paintMaterial('#27301f', 0.95), cores.length);
      cores.forEach((m, i) => core.setMatrixAt(i, m));
      core.receiveShadow = true; core.castShadow = true;
      core.computeBoundingSphere();
      root.add(core);
    }

    // ---- The palisade: a line of sharpened stakes across the fields, bound by a rail; its gap holds a fallen log.
    {
      const shaft = new THREE.CylinderGeometry(0.05, 0.06, 1.55, 6).translate(0, 0.775, 0);
      const tip = new THREE.ConeGeometry(0.05, 0.2, 6).translate(0, 1.65, 0);
      const stakes: THREE.Matrix4[] = [];
      const rails: THREE.Matrix4[] = [];
      const pts = along(PAL, 0.3);
      let prev: (typeof pts)[number] | null = null;
      for (const p of pts) {
        if (Math.hypot(p.x - LOG.x, p.z - LOG.y) < 1.1) { prev = null; continue; }
        const y = H(p.x, p.z) - 0.25;
        const lean = 0.32 + (rnd() - 0.5) * 0.18, yaw = Math.atan2(p.dx, p.dz) + Math.PI / 2 + (rnd() - 0.5) * 0.2;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, (rnd() - 0.5) * 0.12, 'YXZ'));
        stakes.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(1, 0.85 + rnd() * 0.3, 1)));
        if (prev && rnd() < 0.97) {
          const mx = (p.x + prev.x) / 2, mz = (p.z + prev.z) / 2;
          rails.push(new THREE.Matrix4().compose(new THREE.Vector3(mx, H(mx, mz) + 0.55, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.atan2(p.dx, p.dz), 0, 'YXZ')), new THREE.Vector3(1, 0.32, 1)));
          box(new THREE.Vector3(mx, H(mx, mz) + 0.75, mz), [0.5, 1.6, 0.42], Math.atan2(p.dx, p.dz), L.world, { kind: 'wood' });
        }
        prev = p;
      }
      for (const [g, mat, list] of [[shaft, darkWood, stakes], [tip, wood, stakes], [new THREE.CylinderGeometry(0.045, 0.045, 1, 6), darkWood, rails]] as const) {
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        root.add(im);
      }
    }

    // ---- Where the road leaves the fields: an overturned cart and barrels jammed in the hedge's gap.
    for (const [x, z] of ROADBLOCKS) {
      const yaw = x < 0 ? 0.2 : -0.6;
      prop('props/Stall_Cart_Empty', x, z, { yaw: yaw + Math.PI / 2, roll: 0.35, dy: 0.2 });
      prop('props/Barrel', x + 1.1, z + 0.4, { roll: Math.PI / 2, yaw: 0.8, dy: 0.35 });
      prop('props/Crate_Wooden', x - 1.2, z - 0.3, { yaw: 0.5 });
      box(new THREE.Vector3(x, H(x, z) + 1, z), [3.4, 2.0, 1.4], yaw, L.world, { kind: 'wood' });
    }

    // ---- Wreckage over the fields: spears driven in at angles, shields, swords, barrels; banners on poles.
    const spearShaft = new THREE.CylinderGeometry(0.014, 0.017, 2.1, 6).translate(0, 1.05, 0);
    const spearTip = new THREE.ConeGeometry(0.03, 0.17, 6).translate(0, 2.18, 0);
    const spears: THREE.Matrix4[] = [], broken: THREE.Matrix4[] = [];
    const spear = (x: number, z: number, lean: number, yaw: number, isBroken = false) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, H(x, z) - 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0, 'YXZ')), new THREE.Vector3(1, isBroken ? 0.45 + rnd() * 0.3 : 1, 1));
      (isBroken ? broken : spears).push(m);
    };
    const clearOf = (x: number, z: number) => lineDist(ROAD_SEG, x, z) > 1.8 && Math.hypot(x - CAMP.x, z - CAMP.z) > 5 && Math.hypot(x - SEAT.x, z - SEAT.z) > 3
      && (water.surfaceAt(x, z) === null || height(x, z) > (water.surfaceAt(x, z) ?? 0) + 0.1);
    for (let i = 0; i < 150; i++) {
      const x = W + 1.5 + rnd() * (E - W - 3), z = N + 1.5 + rnd() * (S - N - 3);
      if (!clearOf(x, z)) continue;
      const k = rnd();
      if (k < 0.45) spear(x, z, 0.15 + rnd() * 0.5, rnd() * 6.28, rnd() < 0.4);
      else if (k < 0.62) prop('props/Shield_Wooden', x, z, { yaw: rnd() * 6.28, pitch: -1.35 - rnd() * 0.2, dy: 0.05 });
      else if (k < 0.74) prop('props/Sword_Bronze', x, z, { yaw: rnd() * 6.28, pitch: 1.5, dy: 0.02 });
      else if (k < 0.8) prop('props/Axe_Bronze', x, z, { yaw: rnd() * 6.28, pitch: 1.5, dy: 0.03 });
      else if (k < 0.88) prop('props/Barrel', x, z, { yaw: rnd() * 6.28, roll: Math.PI / 2, dy: 0.35 });
      else prop('nature/Rock_Medium_2', x, z, { yaw: rnd() * 6.28, scale: 0.3 + rnd() * 0.25, dy: -0.1 });
    }
    // Spears thick along the road's edges by the gaps (where the fighting was).
    for (const g of [CART, LOG, CRATES]) for (let i = 0; i < 9; i++) {
      const a = rnd() * 6.28, r = 2.2 + rnd() * 2.5, x = g.x + Math.cos(a) * r, z = g.y + Math.sin(a) * r;
      if (lineDist(ROAD_SEG, x, z) > 1.4 && water.surfaceAt(x, z) === null) spear(x, z, 0.2 + rnd() * 0.5, rnd() * 6.28, rnd() < 0.3);
    }
    for (const [geo, mat, list] of [[spearShaft, wood, spears], [spearTip, iron, spears], [spearShaft, wood, broken]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.computeBoundingSphere();
      root.add(im);
    }
    const pole = new THREE.CylinderGeometry(0.03, 0.035, 3.2, 8).translate(0, 1.6, 0);
    const banner = (x: number, z: number, lean: number, yaw: number, id: string, tint = '#8a4a3c') => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(pole, darkWood); m.castShadow = true; g.add(m);
      g.position.set(x, H(x, z) - 0.25, z); g.rotation.set(lean, yaw, 0, 'YXZ');
      root.add(g);
      props.push(placeProp(id, { at: [0, 3.05, 0.04], tint: { MI_Banner: tint } }, g));
    };
    // Banners mark the way: by each gap and on the rise.
    banner(CART.x + 1.9, CART.y + 1.2, 0.12, 0.4, 'props/Banner_1_Cloth');
    banner(LOG.x - 1.8, LOG.y + 0.9, -0.2, 2.2, 'props/Banner_2_Cloth', '#3c4a6a');
    banner(CRATES.x + 2.0, CRATES.y + 0.8, 0.1, -0.6, 'props/Banner_1_Cloth');
    banner(3.4, -1.6, 0.08, 1.8, 'props/Banner_2_Cloth');
    banner(-3.2, -2.4, -0.15, 0.6, 'props/Banner_1_Cloth', '#3c4a6a');
    banner(-19, 33.6, 0.5, 1.2, 'props/Banner_2_Cloth');
    banner(7, 39.5, 0.35, -1.0, 'props/Banner_1_Cloth', '#3c4a6a');
    banner(-22, 26.5, 0.75, 0.3, 'props/Banner_1_Cloth');
    banner(9, 12.5, 0.6, 2.6, 'props/Banner_2_Cloth', '#3c4a6a');
    banner(-15, 13.0, 0.2, 1.4, 'props/Banner_1_Cloth');
    banner(12, -8.5, 0.3, -2.0, 'props/Banner_2_Cloth');

    // ---- The camp: the overturned wagon, a dying fire, things spilled; the mother under a torn banner.
    prop('village/Prop_Wagon', cx(-14.2), cz(25.4), { yaw: 1.1, roll: Math.PI / 2 - 0.08, dy: 0.95 });
    box(new THREE.Vector3(cx(-14.2), H_CAMP + 0.95, cz(25.4)), [1.6, 1.9, 4.0], 1.1);
    prop('props/Barrel', cx(-10.7), cz(25.9), { roll: Math.PI / 2, yaw: 0.6, dy: 0.35 });
    prop('props/Crate_Wooden', cx(-13.4), cz(22.2), { yaw: 0.4 });
    prop('props/Cauldron', cx(-9.6), cz(24.2), { yaw: 1.0, roll: 0.9, dy: 0.25 });
    prop('props/Bag', cx(-11.2), cz(26.4), { yaw: 2.2, pitch: -1.3, dy: 0.15 });
    prop('props/Rope_1', cx(-12.8), cz(22.9), { yaw: 0.8 });
    prop('props/Bucket_Wooden_1', cx(-10.2), cz(22.8), { yaw: 0.3, roll: 1.4, dy: 0.15 });
    prop('props/WeaponStand', cx(-15.6), cz(22.6), { yaw: 0.9, roll: 1.35, dy: 0.2 });
    prop('props/Chest_Wood', cx(-16.2), cz(27.8), { yaw: -0.4 });
    box(new THREE.Vector3(cx(-13.4), H_CAMP + 0.45, cz(22.2)), [0.85, 0.9, 0.9], 0.4, L.detail);
    // The mother: a shape under the banner, her tail out from under it.
    {
      const g = new THREE.Group();
      g.position.set(MOTHER.x, MOTHER.y, MOTHER.z);
      g.rotation.y = 0.5;
      const NN = 24, WW = 0.95, D = 0.75;
      const geo = new THREE.PlaneGeometry(WW, D, NN, NN).rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const body = Math.max(0, 1 - (x / 0.28) ** 2 - (z / 0.17) ** 2);
        const fold = 0.012 * Math.sin(x * 21 + z * 9) + 0.008 * Math.sin(z * 31);
        p.setY(i, 0.012 + 0.16 * Math.sqrt(body) + fold * (1 - body) + 0.02 * Math.max(0, 1 - Math.hypot(x - 0.3, z + 0.2) / 0.2));
      }
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, cloth); c.castShadow = true; c.receiveShadow = true;
      g.add(c);
      mother = g;
      root.add(g);
      box(new THREE.Vector3(MOTHER.x, MOTHER.y + 0.08, MOTHER.z), [0.55, 0.16, 0.35], 0.5, L.detail);
    }

    // ---- The first gap, under a cart: a cart bed propped on a wheel and a barrel, jammed in the hedge's gap; the
    // only way through is underneath it (the bed is 0.5 m up; she is 0.34 m tall).
    {
      const dir = new THREE.Vector2(-9.6 - -13.4, 26.6 - 35.4).normalize();
      const yaw = Math.atan2(dir.x, dir.y);
      const g = new THREE.Group();
      g.position.set(CART.x, H(CART.x, CART.y), CART.y);
      g.rotation.y = yaw;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.09, 1.25), wood);
      bed.position.set(0, 0.56, 0); bed.rotation.z = 0.05; bed.castShadow = true; bed.receiveShadow = true;
      g.add(bed);
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.18, 0.08), darkWood);
        rail.position.set(0, 0.68, sx * 0.6); rail.rotation.z = 0.05; rail.castShadow = true; g.add(rail);
      }
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 18).rotateX(Math.PI / 2), darkWood);
      wheel.position.set(1.55, 0.46, -0.66); wheel.castShadow = true; g.add(wheel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.025, 6, 24), iron);
      rim.position.copy(wheel.position); g.add(rim);
      const brokenW = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 18).rotateX(Math.PI / 2), darkWood);
      brokenW.position.set(-2.4, 0.04, 0.9); brokenW.rotation.set(Math.PI / 2, 0, 0.4); g.add(brokenW);
      root.add(g);
      g.updateMatrixWorld(true);
      const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.05));
      physics.addBox(new THREE.Vector3(0, 0.6, 0).applyMatrix4(g.matrixWorld), new THREE.Vector3(1.62, 0.12, 0.66), wq);
      // Its ends close the gap to the hedges, down to the ground.
      for (const ex of [-1.5, 1.5]) physics.addBox(new THREE.Vector3(ex, 0.3, 0).applyMatrix4(g.matrixWorld), new THREE.Vector3(0.12, 0.32, 0.62), yawQ(yaw), undefined, L.detail);
      props.push(placeProp('props/Barrel', { at: [-1.45, 0, -0.1], scale: 0.62 }, g));
    }

    // ---- The palisade's gap, over a fallen log: a log across the gap (too high to step over) and a shield leaning
    // on it like a step.
    {
      const dir = new THREE.Vector2(-7.4 - -9.6, 19.8 - 26.6).normalize();
      const across = Math.atan2(dir.y, -dir.x);
      const c = new THREE.Vector3(LOG.x, H(LOG.x, LOG.y), LOG.y);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 3.6, 12).rotateZ(Math.PI / 2), darkWood);
      log.position.set(c.x, c.y + 0.17, c.z); log.rotation.y = across; log.castShadow = true; log.receiveShadow = true;
      root.add(log);
      physics.addFixed(RAPIER.ColliderDesc.capsule(1.6, 0.2).setTranslation(c.x, c.y + 0.17, c.z)
        .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, across, Math.PI / 2, 'YXZ'))), { kind: 'wood' });
      const sx = c.x - dir.x * 0.42, sz = c.z - dir.y * 0.42;
      const syaw = Math.atan2(dir.x, dir.y);
      props.push(placeProp('props/Shield_Wooden', { at: [sx, c.y + 0.16, sz], yaw: syaw, pitch: -1.05 }, root));
      physics.addBox(new THREE.Vector3(sx, c.y + 0.15, sz), new THREE.Vector3(0.3, 0.02, 0.3),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, syaw, 0, 'YXZ')), { kind: 'wood' }, L.detail);
    }

    // ---- The last gap, up a broken plank: a barricade of crates across it (too high to jump) and a plank leaning on
    // it that she can climb.
    {
      const dir = new THREE.Vector2(-2.2 - -5.4, 5.4 - 13.2).normalize();
      const yaw = Math.atan2(dir.x, dir.y);
      const g = new THREE.Group();
      g.position.set(CRATES.x, H(CRATES.x, CRATES.y), CRATES.y);
      g.rotation.y = yaw;
      root.add(g);
      for (const [x, s] of [[-1.25, 0], [-0.42, 0.06], [0.42, -0.04], [1.25, 0.08]]) {
        props.push(placeProp('props/Crate_Wooden', { at: [x, 0, 0], yaw: s }, g));
      }
      g.updateMatrixWorld(true);
      physics.addBox(new THREE.Vector3(0, 0.44, 0).applyMatrix4(g.matrixWorld), new THREE.Vector3(1.7, 0.45, 0.45), yawQ(yaw), { climb: true, kind: 'wood' });
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.12, 0.045), paintMaterial('#7e6045', 0.85, 1, 0.16));
      plank.castShadow = true; plank.receiveShadow = true;
      const lean = 0.36;
      plank.position.set(0.1, 0.52, -0.64); plank.rotation.set(lean, 0, 0.04);
      g.add(plank);
      g.updateMatrixWorld(true);
      const pq = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0.04, 'YXZ'));
      physics.addBox(plank.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.31, 0.56, 0.03), pq, { climb: true, kind: 'wood' });
    }

    // ---- Dead horses, lying where they fell (the soldiers are laid out in start(), from the knight).
    {
      const coats = ['bay', 'grey', 'black'] as const;
      const horseMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.78 });
      const saddle = paintMaterial('#4a2c1e', 0.8), blanket = paintMaterial('#6a2420', 0.95);
      HORSES.forEach(([x, z, yaw, coat], i) => {
        const g = new THREE.Group();
        g.position.set(x, H(x, z) - 0.04, z); g.rotation.y = yaw;
        const m = new THREE.Mesh(horseGeoms[coats[coat]] ??= horseGeometry(coats[coat]), horseMat);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
        if (i % 2 === 0) {
          // Saddle and blanket on its upturned flank.
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.75), blanket); b.position.set(-0.05, 0.62, 0.05); b.rotation.z = 0.3; g.add(b);
          const sd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.5), saddle); sd.position.set(-0.12, 0.68, 0.05); sd.rotation.z = 0.25; g.add(sd);
        }
        root.add(g);
        box(new THREE.Vector3(x, H(x, z) + 0.3, z).add(new THREE.Vector3(0.2, 0, 0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)), [1.3, 0.62, 2.3], yaw, L.detail, { kind: 'cloth' });
      });
    }

    await Promise.all(props);
    return {
      killY: -30,
      killZones: [],
      spawn: {
        kitten: { pos: new THREE.Vector3(cx(-11.75), H(cx(-11.75), cz(23.55)), cz(23.55)), yaw: -0.71 },
        // Out in the fog up the road to the north-east, where he comes from.
        knight: { pos: new THREE.Vector3(4.3, H(4.3, -3.9), -3.9), yaw: -2.3 },
      },
    };
  },

  async start(c: StoryContext) {
    director = new Director(c);
    (globalThis as any).__prologue = director; // for the test plans
    await director.start();
  },
  begin(c: StoryContext) { director?.opening(c); },
  update(dt: number, t: number, c: StoryContext) { director?.update(dt, t, c); },
  call(_c: StoryContext, kind: string) { director?.heard(kind); },
  // Views drawn once while loading, so every shader the opening shows is ready before it plays.
  warmViews() {
    const h = height;
    return [
      { pos: [-24, h(-24, 49) + 9, 49], look: [-4, h(-4, 10) + 1.2, 10] },
      { pos: [4.7, h(4.3, -3.9) + 1.15, -0.3], look: [4.3, h(4.3, -3.9) + 1.15, -3.9] },
      { pos: [-2.6, SEAT.y + 1.1, 3.6], look: [0, SEAT.y + 0.85, 0.4] },
      { pos: [cx(-10.55), H_CAMP + 0.42, cz(24.9)], look: [cx(-12.05), H_CAMP + 0.1, cz(23.95)] },
      { pos: [cx(-12.9), H_CAMP + 0.5, cz(25.3)], look: [cx(-10.9), H_CAMP + 0.2, cz(21.4)] },
      { pos: [-6, h(-6, 20) + 1.2, 21], look: [-6.6, h(-6.6, 16.8), 16.8] },
    ] as { pos: [number, number, number]; look: [number, number, number] }[];
  },
};

// [x, z, yaw, pose, tabard]: the fallen soldiers. Poses: 0 on his back, 1 face down, 2 on his side.
const SOLDIERS: [number, number, number, number, string | null][] = [
  [-20, 40, 0.4, 0, 'red'], [-6, 42, 2.1, 1, 'blue'], [2, 35, -0.8, 2, null], [-24.5, 34.5, 1.2, 1, 'red'], [-4.6, 38.6, 2.8, 0, null],
  [-16, 27, 0.2, 0, 'blue'], [-4, 26, -1.9, 2, 'red'], [6, 27.5, 1.1, 0, null], [-24, 28, 2.6, 2, null], [-1.8, 27.3, 0.9, 1, 'red'],
  [-12.5, 19.9, 1.5, 1, 'red'], [2, 19.4, -0.3, 0, 'blue'], [-19, 20.4, 0.6, 2, 'blue'],
  [-10, 12.5, -0.6, 2, 'red'], [4, 11.5, 2.4, 1, null], [-17.5, 13.2, 1.9, 0, 'blue'],
  [6, -3.5, 1.2, 0, 'red'], [-8, -2, -2.2, 1, 'blue'], [-4, -8, 0.3, 2, null], [10, 4, 2.0, 2, 'blue'], [-18, 4, 0.9, 0, null],
  [3.4, 5.6, -1.1, 1, 'red'], [-11, -11, 1.7, 0, 'red'],
];
// [x, z, yaw, coat]: the horses (coat 0 bay, 1 grey, 2 black).
const HORSES: [number, number, number, number][] = [[-3.6, 39.6, 0.7, 1], [-0.6, 26.0, 2.3, 0], [-21, 12.6, -0.4, 2], [12, -7.2, 1.1, 0], [-13, -10.5, 2.6, 1], [9.5, 41.5, -1.4, 2]];
const horseGeoms: Partial<Record<string, THREE.BufferGeometry>> = {};
// Fires burning about the field (landmarks with their smoke), and great columns of smoke beyond the hedges.
const FIRES: [number, number, number][] = [[cx(-10.1), cz(25.1), 1], [3.6, 25.4, 0.9], [-19, 21.8, 0.8], [7.5, -1.5, 1.1]];
const PLUMES: [number, number, number][] = [[30, -38, 34], [-42, -24, 28], [44, 18, 30], [-8, -48, 36]];

let director: Director | null = null;
let mother: THREE.Group | null = null;

// Chapter One is reachable from the end of the prologue once it is finished.
const CH1_READY = false;

// What he says to her, through his helm.
const LINES = [
  'What’s your name, little one?',
  'Looks like we’re the only ones left, huh?',
  'How’d you make it through all this?',
  'Don’t you worry. I’m gonna take care of you.',
];

// The story's running: cutscenes, the triggers between them, the fires and rain, the water.
class Director {
  stage: 'title' | 'opening' | 'walk' | 'found' | 'end' = 'title';
  private fires: Campfire[] = [];
  private plumes: SmokePlume[] = [];
  private rain: ReturnType<typeof createRain>;
  private black: HTMLDivElement;
  private subs: Subtitles;
  private hintsShown = new Set<string>();
  // Where she sits in his lap.
  private lapTop = new THREE.Vector3();
  private breathT = 3;
  private walkT = 0;
  private answerT = 0;
  private paddleT = 0;

  constructor(private c: StoryContext) {
    this.rain = createRain(2600);
    c.scene.add(this.rain.mesh);
    this.black = document.createElement('div');
    this.black.style.cssText = 'position:fixed;inset:0;background:#0b0c0c;opacity:0;pointer-events:none;z-index:5';
    document.body.appendChild(this.black);
    this.subs = new Subtitles();
  }

  private get kitten() { return this.c.game.kitten; }
  private get knight() { return this.c.game.knight; }

  async start() {
    const c = this.c;
    // Heavy dusk fog, thin enough to see the hawthorn's rise and the smoke from the camp field.
    LOOK.fogDistance.value = 64;
    for (const [x, z, s] of FIRES) {
      const f = new Campfire(new THREE.Vector3(x, height(x, z), z), s);
      c.scene.add(f.group);
      this.fires.push(f);
    }
    for (const [x, z, hgt] of PLUMES) {
      const p = new SmokePlume(new THREE.Vector3(x, height(x, z), z), hgt);
      c.scene.add(p.mesh);
      this.plumes.push(p);
    }
    // The fallen soldiers: the knight's own model laid out in a few poses and tabards, baked and instanced.
    {
      const kinds: [number, string | null][] = [];
      const key = (p: number, t: string | null) => `${p}|${t}`;
      const idx = new Map<string, number>();
      for (const [, , , p, t] of SOLDIERS) if (!idx.has(key(p, t))) { idx.set(key(p, t), kinds.length); kinds.push([p, t]); }
      const baked = bakeSoldiers((c.knight as any).hero ?? null, kinds);
      const mats: THREE.Matrix4[][] = kinds.map(() => []);
      const root = new THREE.Group(); root.name = 'Fallen';
      for (const [x, z, yaw, p, t] of SOLDIERS) {
        const y = height(x, z);
        mats[idx.get(key(p, t))!].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.03, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
        c.physics.addBox(new THREE.Vector3(x, y + 0.12, z), new THREE.Vector3(0.36, 0.14, 0.85), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { kind: 'metal' }, L.detail);
      }
      baked.forEach((b, i) => instanceBaked(b, mats[i], root));
      c.scene.add(root);
    }
    // She is a plain kitten still, small and young, on all fours; he is wounded. Only she is played.
    c.kitten.setBare(true);
    c.kitten.defaultPose = c.kitten.poseQuadruped;
    c.game.canSwitch = false;
    c.game.follower.mode = 'wait';
    c.padLabel('KeyQ', 'Meow'); c.padLabel('Tab', null); c.padLabel('KeyE', null); c.padLabel('KeyG', null);
    const kn = this.knight;
    kn.motor.collider.setEnabled(false);
    // Into the water, and out.
    this.kitten.motor.onSplash = (s) => {
      const p = this.kitten.char.body.pos;
      c.audio.play('splash', p, 0.5 + s * 0.6);
      water.ripple(p.x, p.z, 1.6); water.ripple(p.x + 0.05, p.z - 0.04, 1.0);
    };
    // Her mother's tail out from under the banner: a copy of her own, grown.
    if (mother) {
      const tail = c.kitten.tail.clone(true);
      tail.position.set(0.3, 0.03, 0.08);
      tail.rotation.set(0.1, -Math.PI / 2 + 0.35, Math.PI / 2);
      tail.scale.setScalar(1.6);
      mother.add(tail);
    }
    // The dropped helm on the slope: a copy of his own.
    const helm = new THREE.Group();
    for (const ch of c.knight.parts.head.children) if ((ch as THREE.Mesh).isMesh) helm.add((ch as THREE.Mesh).clone());
    helm.position.set(-1.6, height(-1.6, 3.3) + 0.12, 3.3);
    helm.rotation.set(1.35, 0.6, 0.25);
    c.scene.add(helm);
    // His seat on the ground as built (the mesh, not the formula).
    SEAT.y = c.physics.groundY(SEAT.x, SEAT.y + 1, SEAT.z, 3) ?? SEAT.y;
  }

  private seat() {
    const c = this.c, kn = this.knight;
    kn.motor.place(SEAT.clone(), 0);
    kn.motor.mode = 'held';
    kn.char.resetPose(kn.ground);
    const anim = this.anim(kn);
    anim.walkClip = 'Walk_Loop'; anim.walkSpeed = null;
    c.knight.wounded = false;
    c.knight.overrideBlend = 1.6;
    c.knight.override = c.knight.poseSlumped;
  }

  private anim(a: { char: unknown }) { return (a.char as DrivenAvatar).anim; }

  // Her voice in the story (the call button plays its own).
  private meow(kind: 'meow' | 'mew' | 'mrrp' | 'cry', gain = 1) {
    this.c.kitten.meow(kind);
    this.c.audio.play(kind, this.kitten.char.body.pos, gain);
  }

  // He speaks (muffled in the helm); the words under the picture.
  private say(line: string) {
    say(this.c.audio, this.subs, line, new THREE.Vector3(0, 0.1, 0.1).applyMatrix4(this.c.knight.parts.head.matrixWorld));
  }

  // She called. Lost in the fog, he answers (a breath, a murmur) so she can find him.
  heard(_kind: string) {
    const c = this.c;
    if (this.answerT > 0 || this.stage !== 'walk') return;
    const d = this.kitten.char.body.pos.distanceTo(SEAT);
    if (d < 40) {
      this.answerT = 2.2;
      const g = THREE.MathUtils.clamp(1.8 - d / 22, 0.3, 1.4);
      setTimeout(() => { c.audio.play('hum', SEAT.clone().add(new THREE.Vector3(0, 1, 0)), g * 1.4); c.audio.play('breath', SEAT, g); }, 900);
    }
  }

  // His body, as she can stand on it: boots and shins, his lap (where she jumps up to him), his breastplate.
  private bodyColliders() {
    const c = this.c, P = c.knight.parts, physics = c.physics;
    const kb = this.knight.char.body;
    c.knight.group.position.copy(kb.pos); c.knight.group.rotation.set(0, kb.yaw, 0);
    c.knight.poseSlumped(c.knight, { dt: 1e-3, time: 0, ground: this.knight.ground, lookAt: null, active: false });
    c.knight.group.updateMatrixWorld(true);
    const add = (part: THREE.Object3D, desc: RAPIER.ColliderDesc, local: THREE.Vector3, surface?: any) => {
      const m = new THREE.Matrix4().copy(part.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z));
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      physics.addFixed(desc, surface, L.detail);
    };
    const Wp = (p: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(p.matrixWorld);
    const plank = (a: THREE.Vector3, b: THREE.Vector3, width: number, thick: number, surface: any) => {
      const dir = b.clone().sub(a), len = dir.length();
      dir.divideScalar(len);
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const n = new THREE.Vector3().crossVectors(side, dir);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side.clone().negate(), n, dir));
      const cc = a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, -thick / 2);
      physics.addBox(cc, new THREE.Vector3(width / 2, thick / 2, len / 2), q, surface, L.detail);
    };
    for (const [ft, sh, th] of [[P.footL, P.shinL, P.thighL], [P.footR, P.shinR, P.thighR]]) {
      const ankle = Wp(ft, 0, 0.07, 0), knee = Wp(sh, 0, 0, 0).add(new THREE.Vector3(0, 0.075, 0)), hip = Wp(th, 0, 0, 0).add(new THREE.Vector3(0, 0.1, 0));
      plank(ankle, knee, 0.22, 0.1, { kind: 'leather' });
      plank(knee, knee.clone().lerp(hip, 0.75), 0.22, 0.12, { kind: 'cloth' });
    }
    for (const ft of [P.footL, P.footR]) add(ft, RAPIER.ColliderDesc.cuboid(0.07, 0.06, 0.13), new THREE.Vector3(0, -0.02, 0.07), { kind: 'leather' });
    const lap = Wp(P.pelvis, 0, 0, 0);
    physics.addBox(lap.clone().add(new THREE.Vector3(0, 0.02, 0.12)), new THREE.Vector3(0.21, 0.08, 0.17), undefined, { kind: 'cloth' }, L.detail);
    add(P.chest, RAPIER.ColliderDesc.cuboid(0.17, 0.23, 0.12), new THREE.Vector3(0, 0.2, 0.02), { kind: 'metal' });
    add(P.head, RAPIER.ColliderDesc.ball(0.15), new THREE.Vector3(0, 0.14, 0));
    this.lapTop.copy(lap).add(new THREE.Vector3(0, 0.1, 0.14));
  }

  // ---- The opening: him limping up the road, her at the camp, the horn.
  opening(c: StoryContext) {
    this.stage = 'opening';
    const kn = this.knight;
    kn.motor.mode = 'held';
    c.knight.wounded = true;
    const anim = this.anim(kn);
    // A slow, heavy walk (his hand held to his side, his sword dragging), not a shamble.
    anim.walkClip = 'Walk_Loop'; anim.walkSpeed = 0.95;
    c.kitten.overrideBlend = 6;
    c.kitten.override = c.kitten.poseNudge;
    const H = height;
    const kp = () => kn.char.body.pos;
    const walk: [number, number, number][] = [[4.3, H(4.3, -3.9), -3.9], [2.1, H(2.1, -1.3), -1.3], [0.9, H(0.9, 0.8), 0.8], [SEAT.x, SEAT.y, SEAT.z]];
    const k0: [number, number, number] = [cx(-11.75), H_CAMP, cz(23.55)];
    const cs: Cutscene = {
      name: 'opening', length: 38.5, skippable: true,
      fades: [{ at: 0, dur: 0, to: 1 }, { at: 0.5, dur: 3.0, to: 0 }],
      shots: [
        // The battlefield in the last light: hedged fields, fires and smoke in the fog, the hawthorn on its rise.
        { at: 0, dur: 8, from: { pos: [-24, H(-24, 49) + 9, 49], look: [-4, H(-4, 10) + 1.2, 10], mm: 30 }, to: { pos: [-18, H(-18, 42) + 6, 42.5], look: [-1, H(-1, 3) + 1.6, 2], mm: 33 }, ease: 'smooth' },
        // Up the road out of the mist, a hand to his side.
        { at: 8, dur: 8, from: { pos: () => kp().clone().add(new THREE.Vector3(0.4, 1.15, 3.6)), look: () => kp().clone().add(new THREE.Vector3(0, 1.15, 0)), mm: 38 }, to: { pos: () => kp().clone().add(new THREE.Vector3(1.2, 1.0, 3.0)), look: () => kp().clone().add(new THREE.Vector3(0, 1.1, 0)), mm: 40 }, ease: 'linear', handheld: 1.4 },
        // He reaches the tree and slides down against it.
        { at: 16, dur: 6, from: { pos: [-2.6, SEAT.y + 1.1, 3.6], look: [0, SEAT.y + 0.85, 0.4], mm: 40 }, to: { pos: [-2.2, SEAT.y + 0.8, 3.2], look: [0, SEAT.y + 0.55, 0.45], mm: 42, dof: 0.2 }, ease: 'smooth' },
        // The ribbon on his sword's grip.
        { at: 22, dur: 4, from: { pos: [-0.95, SEAT.y + 0.32, 1.45], look: [-0.36, SEAT.y + 0.07, 0.6], mm: 55, dof: 0.7 }, to: { pos: [-0.85, SEAT.y + 0.26, 1.3], look: [-0.36, SEAT.y + 0.06, 0.6], mm: 58, dof: 0.7 }, ease: 'smooth' },
        // At the camp: the kitten and the still shape under the banner.
        { at: 26, dur: 7.5, from: { pos: [cx(-10.55), H_CAMP + 0.42, cz(24.9)], look: [cx(-12.05), H_CAMP + 0.1, cz(23.95)], mm: 45, dof: 0.45 }, to: { pos: [cx(-10.75), H_CAMP + 0.36, cz(24.6)], look: [cx(-12.05), H_CAMP + 0.12, cz(23.95)], mm: 48, dof: 0.45 }, ease: 'smooth' },
        // She goes out into the fog, toward the road.
        { at: 33.5, dur: 5, from: { pos: [cx(-12.9), H_CAMP + 0.5, cz(25.3)], look: [cx(-11.3), H_CAMP + 0.15, cz(22.4)], mm: 38 }, to: { pos: [cx(-12.5), H_CAMP + 0.55, cz(24.6)], look: [cx(-10.9), H_CAMP + 0.2, cz(21.4)], mm: 38 }, ease: 'smooth', blend: 0.8 },
      ],
      marks: [
        { at: 8, who: 'knight', path: walk, speed: 0.75, face: 0 },
        { at: 33.6, who: 'kitten', path: [k0, [cx(-11.45), H(cx(-11.45), cz(22.6)), cz(22.6)], [cx(-11.1), H(cx(-11.1), cz(21.6)), cz(21.6)]], speed: 0.7, face: Math.atan2(0.5, -1) },
      ],
      cues: [
        { at: 0.2, run: () => this.c.audio.play('caw', new THREE.Vector3(-4, 3, 14), 1), onSkip: false },
        { at: 16.6, run: () => this.seat() },
        { at: 18.5, run: () => this.c.audio.play('breath', SEAT, 1), onSkip: false },
        // She nudges her mother, and calls her, quietly.
        { at: 26.9, run: () => this.meow('mew', 0.8), onSkip: false },
        { at: 28.3, run: () => this.meow('mew', 0.6), onSkip: false },
        { at: 29.5, run: () => this.c.audio.play('horn', new THREE.Vector3(30, 5, -40), 1), onSkip: false },
        { at: 30.6, run: () => { c.kitten.override = null; } },
        // She calls out into the fog, where the horn was.
        { at: 31.9, run: () => this.meow('cry', 1), onSkip: false },
        { at: 38.4, run: () => { c.kitten.override = null; } },
      ],
      onEnd: () => this.startWalk(),
    };
    c.timeline.play(cs);
  }

  private startWalk() {
    const c = this.c;
    if (!this.knight.char.body || this.stage === 'walk') return;
    this.stage = 'walk';
    if (!c.knight.override) this.seat();
    this.bodyColliders();
    c.game.switchTo(this.kitten);
    c.hud.objective('Follow the sound of breathing, to the hawthorn on the rise.');
    c.hud.say(c.touch() ? 'The stick moves her. Meow, and listen.' : 'WASD moves her; the mouse turns the camera. Q: meow, and listen.', 7);
  }

  // ---- She finds him. She jumps up into his lap; he lifts his head and speaks to her.
  private found() {
    const c = this.c;
    this.stage = 'found';
    c.hud.objective(null);
    const kpos = this.kitten.char.body.pos.clone();
    const head = new THREE.Vector3(0, 0.14, 0).applyMatrix4(c.knight.parts.head.matrixWorld);
    // A spot before his boots, between them; then up into his lap.
    const spot = new THREE.Vector3(SEAT.x - 0.04, 0, SEAT.z + 1.22);
    spot.y = c.physics.groundY(spot.x, SEAT.y + 0.6, spot.z, 3) ?? height(spot.x, spot.z);
    const lap = this.lapTop.clone();
    const face = lap.clone().add(new THREE.Vector3(0, 0.2, 0.06));
    const P = (v: THREE.Vector3) => [v.x, v.y, v.z] as [number, number, number];
    const cs: Cutscene = {
      name: 'found', length: 33, skippable: false,
      fades: [{ at: 30.2, dur: 2.2, to: 1 }],
      shots: [
        // Low behind her: the knight above, his head down on his chest.
        { at: 0, dur: 3.2, from: { pos: [SEAT.x - 1.0, SEAT.y + 0.36, SEAT.z + 3.4], look: [SEAT.x, SEAT.y + 0.5, SEAT.z + 0.2], mm: 30 }, to: { pos: [SEAT.x - 0.85, SEAT.y + 0.34, SEAT.z + 3.05], look: [SEAT.x, SEAT.y + 0.62, SEAT.z + 0.1], mm: 32 }, ease: 'smooth' },
        // From the side: she gathers herself and jumps up into his lap.
        { at: 3.2, dur: 3.0, from: { pos: [SEAT.x + 2.2, SEAT.y + 0.55, SEAT.z + 1.2], look: [SEAT.x, SEAT.y + 0.35, SEAT.z + 0.75], mm: 36 }, to: { pos: [SEAT.x + 2.0, SEAT.y + 0.6, SEAT.z + 1.1], look: [SEAT.x, SEAT.y + 0.42, SEAT.z + 0.6], mm: 38 }, ease: 'smooth' },
        // His helm, lifting to look at her.
        { at: 6.2, dur: 4.4, from: { pos: head.clone().add(new THREE.Vector3(0.62, 0.0, 0.95)), look: head, mm: 46, dof: 0.35 }, to: { pos: head.clone().add(new THREE.Vector3(0.55, -0.04, 0.85)), look: head, mm: 50, dof: 0.35 }, ease: 'smooth' },
        // Her, in his lap, looking up at him.
        { at: 10.6, dur: 2.6, from: { pos: face.clone().add(new THREE.Vector3(0.2, 0.0, 0.55)), look: face, mm: 52, dof: 0.6 }, to: { pos: face.clone().add(new THREE.Vector3(0.16, -0.01, 0.48)), look: face, mm: 55, dof: 0.6 }, ease: 'smooth' },
        // The two of them.
        { at: 13.2, dur: 4.4, from: { pos: [SEAT.x - 1.5, SEAT.y + 0.95, SEAT.z + 2.3], look: [SEAT.x, SEAT.y + 0.6, SEAT.z + 0.3], mm: 38 }, to: { pos: [SEAT.x - 1.3, SEAT.y + 0.9, SEAT.z + 2.05], look: [SEAT.x, SEAT.y + 0.6, SEAT.z + 0.3], mm: 40 }, ease: 'smooth' },
        // His helm again.
        { at: 17.6, dur: 3.6, from: { pos: head.clone().add(new THREE.Vector3(-0.7, -0.05, 0.85)), look: head, mm: 48, dof: 0.35 }, to: { pos: head.clone().add(new THREE.Vector3(-0.62, -0.08, 0.78)), look: head, mm: 50, dof: 0.35 }, ease: 'smooth' },
        // Down over his arm: she curls up in his lap; his gauntlet over her, out of the rain.
        { at: 21.2, dur: 6.0, from: { pos: lap.clone().add(new THREE.Vector3(-0.5, 0.75, 0.66)), look: lap.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 42, dof: 0.35 }, to: { pos: lap.clone().add(new THREE.Vector3(-0.42, 0.66, 0.56)), look: lap.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 46, dof: 0.35 }, ease: 'smooth' },
        // The hawthorn in the rain, the two of them under it, the field round them.
        { at: 27.2, dur: 5.8, from: { pos: [-4.6, SEAT.y + 1.6, 6.2], look: [0, SEAT.y + 1.1, 0.4], mm: 35 }, to: { pos: [-5.4, SEAT.y + 2.0, 7.2], look: [0, SEAT.y + 1.2, 0.4], mm: 34 }, ease: 'linear' },
      ],
      marks: [
        { at: 0, who: 'kitten', path: [P(kpos), P(spot)], speed: 0.9, face: Math.PI },
        { at: 4.3, who: 'kitten', path: [P(spot), P(lap)], speed: 1.25, face: Math.PI, probe: 0.01, arc: 0.3 },
        // Turned across his lap to sleep.
        { at: 21.4, who: 'kitten', path: [P(lap)], speed: 1, face: -Math.PI / 2, probe: 0.01 },
      ],
      cues: [
        { at: 0.6, run: () => this.meow('mew', 0.9) },
        { at: 2.2, run: () => c.audio.play('breath', SEAT, 1.2) },
        { at: 4.0, run: () => this.meow('mrrp', 0.7) },
        { at: 5.3, run: () => c.audio.play('thud', lap, 0.12) },
        { at: 5.7, run: () => this.meow('meow', 1) },
        { at: 6.4, run: () => { c.knight.headUp = 0.5; } },
        { at: 7.6, run: () => this.say(LINES[0]) },
        { at: 11.2, run: () => this.meow('mew', 1) },
        { at: 13.8, run: () => this.say(LINES[1]) },
        { at: 16.4, run: () => c.audio.play('breath', head, 1.0) },
        { at: 18.2, run: () => this.say(LINES[2]) },
        { at: 21.0, run: () => this.meow('mrrp', 0.8) },
        { at: 21.6, run: () => { c.kitten.overrideBlend = 2.5; c.kitten.override = c.kitten.poseCurled; } },
        { at: 22.6, run: () => { c.knight.shelter = 1; c.knight.headUp = 0.35; } },
        { at: 23.4, run: () => c.audio.play('purr', lap, 1.1) },
        { at: 23.8, run: () => this.say(LINES[3]) },
        { at: 27.4, run: () => c.audio.play('purr', lap, 0.8) },
      ],
      onEnd: () => this.title(),
    };
    c.timeline.play(cs);
  }

  // Black; the title; the line that leads on; then the panel.
  private title() {
    this.stage = 'end';
    this.black.style.transition = 'none';
    this.black.style.opacity = '1';
    this.subs.hide();
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;color:#ece8de;font-family:"Cormorant Garamond",Georgia,serif;text-align:center;transition:opacity 2.2s;opacity:0;padding:0 16px';
    t.innerHTML = '<div style="font-size:clamp(44px,9vw,104px);letter-spacing:.2em;padding-left:.2em">WHISKER</div>';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '1'; }, 900);
    setTimeout(() => { t.style.opacity = '0'; }, 6200);
    setTimeout(() => { t.innerHTML = '<div style="font-size:clamp(20px,2.8vw,32px);font-style:italic;letter-spacing:.04em">Two summers later.</div>'; t.style.opacity = '1'; }, 8600);
    setTimeout(() => { t.style.opacity = '0'; }, 12600);
    setTimeout(() => { t.remove(); this.endPanel(); }, 14800);
  }

  private endPanel() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0c0d0d;color:#ece8de;font:16px Georgia,serif;z-index:7;text-align:center;padding:24px';
    d.innerHTML = `<div style="font-size:clamp(22px,3vw,34px);letter-spacing:.14em;text-transform:uppercase">End of the prologue</div>
      <div style="opacity:.8;font-style:italic;max-width:34em">Chapter One: the Watch-House${CH1_READY ? '' : ', coming next'}.</div>`;
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:15px Georgia,serif;background:rgba(236,232,222,.08);color:#ece8de;border:1px solid rgba(236,232,222,.4);border-radius:3px;padding:9px 18px;cursor:pointer;min-width:260px';
      b.onclick = fn;
      d.appendChild(b);
    };
    if (CH1_READY) btn('Continue to Chapter One', () => { const u = new URL(location.href); u.searchParams.set('level', 'ch1'); location.href = u.toString(); });
    btn('Play the prologue again', () => location.reload());
    btn('Engine test course', () => { const u = new URL(location.href); u.searchParams.set('level', 'test'); location.href = u.toString(); });
    btn('The old version (five chapters)', () => { const u = new URL(location.href); u.searchParams.delete('v2'); u.searchParams.delete('level'); location.href = u.toString(); });
    document.body.appendChild(d);
  }

  update(dt: number, t: number, c: StoryContext) {
    for (const f of this.fires) f.update(dt, t, c.camera);
    for (const p of this.plumes) p.update(dt, c.camera);
    const kb = this.kitten.char.body, nb = this.knight.char.body;
    water.update(dt, [
      { key: kb, pos: kb.pos, speed: Math.hypot(kb.vel.x, kb.vel.z), size: 0.7 },
      { key: nb, pos: nb.pos.clone().setY(nb.pos.y + 0.9), speed: Math.hypot(nb.vel.x, nb.vel.z), size: 1.4 },
    ]);
    // Paddling.
    if (this.kitten.motor.swimming && Math.hypot(kb.vel.x, kb.vel.z) > 0.3) {
      this.paddleT -= dt;
      if (this.paddleT < 0) { this.paddleT = 0.42; c.audio.play('paddle', kb.pos, 0.8); }
    }
    this.answerT = Math.max(0, this.answerT - dt);
    if (c.timeline.playing) return;
    const kp = kb.pos;
    // His slow breathing, heard as she comes near.
    if (this.stage === 'walk') {
      this.breathT -= dt;
      const d = kp.distanceTo(SEAT);
      if (this.breathT < 0 && d < 18) { this.breathT = 4.5 + Math.random() * 2; c.audio.play('breath', SEAT, THREE.MathUtils.clamp(1.4 - d / 16, 0.15, 1.2)); }
      // Hints where each lesson is.
      const near = (p: THREE.Vector2, r: number) => Math.hypot(kp.x - p.x, kp.z - p.y) < r;
      const hint = (id: string, p: THREE.Vector2, r: number, text: string, secs = 5) => { if (near(p, r) && !this.hintsShown.has(id)) { this.hintsShown.add(id); c.hud.say(text, secs); } };
      hint('cart', CART, 3.2, 'Under the cart.', 4);
      hint('log', LOG, 2.8, c.touch() ? 'Jump: the Jump button (hold it to jump higher). The shield makes a step.' : 'Space jumps; hold it to jump higher. The shield makes a step.', 6);
      hint('ditch', DITCH, 3.6, c.touch() ? 'Swim across. At the far bank, Jump to climb out.' : 'Swim across. At the far bank, Space to climb out.', 6);
      hint('crates', CRATES, 2.8, 'Too high to jump. Run into the plank to climb it.', 6);
      // Slow to find him: remind her she can call.
      this.walkT += dt;
      if (this.walkT > 60 && !this.hintsShown.has('call')) { this.hintsShown.add('call'); c.hud.say(c.touch() ? 'Lost? Meow, and listen for him.' : 'Lost? Q to meow, and listen for him.', 6); }
      if (Math.hypot(kp.x - SEAT.x, kp.z - (SEAT.z + 0.9)) < 1.8 && Math.abs(kp.y - SEAT.y) < 0.8) this.found();
    }
  }
}

// Debug: jump straight to a part of the prologue (__v2.story(stage)).
export function debugStage(c: StoryContext, stage: string) {
  if (!director) return;
  c.timeline.skip();
  const d = director as any;
  if (stage === 'walk') { d.seat(); d.startWalk(); }
  if (stage === 'found') {
    d.seat(); d.startWalk();
    c.game.kitten.motor.place(new THREE.Vector3(SEAT.x - 0.3, height(SEAT.x - 0.3, SEAT.z + 2.1), SEAT.z + 2.1), Math.PI);
    d.found();
  }
}
// Debug and test plans: places along the way.
export const PLACES = { CART, LOG, DITCH, CRATES, SEAT, CAMP, ROAD };
