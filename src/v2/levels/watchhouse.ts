// Chapter One, "The Watch-House" (docs/STORY.md): two summers later, a morning after a storm. Their home on the
// moor's edge: a walled yard with a watch tower, his forge, a hoist on the west wall; outside, a mill-pond, its
// sluice and the stone mill-race to the mill. The storm brought the old ash down across the gate. Both are played
// (Tab switches; Q tells the other to wait or follow), and every way forward needs the two of them:
//   1. The hoist: she rides the basket up to the wall-walk while he turns the crank; she drops down outside.
//   2. The postern: barred from outside; she climbs onto a crate and knocks the bar off, and he comes out.
//   3. The rope: he ties the mill's winch rope round the fallen ash.
//   4. The sluice: an old weighted plate at the bottom of the mill-pond holds the sluice open while something heavy
//      stands on it. He wades in and sinks to the bottom (she cannot: she floats); the race floods.
//   5. The mill: she swims the flooded race up to the wheel's landing (out of reach when the race is dry) and lets
//      the brake off. The wheel turns, the winch drags the ash clear and the gate swings open.
// Then the road, together.
import * as THREE from 'three/webgpu';
import { Simplex2, smoothstep } from '../../world/noise';
import { FIELD_OVERRIDE, PATHS, PUDDLES, STANDING_STONES } from '../../world/layout';
import { LOOK } from '../../render/settings';
import { RAPIER, Physics, L } from '../physics';
import { LevelBuilder, paintMaterial } from '../level';
import { placeProp, instanceProp } from '../props';
import { Campfire } from '../fx';
import { Water, Pool } from '../water';
import { WATER } from '../motor';
import type { LevelInfo, Actor } from '../game';
import type { Cutscene } from '../timeline';
import type { LevelModule, StoryContext } from './types';
import { Subtitles, say } from '../speech';

const n1 = new Simplex2(31), n2 = new Simplex2(43), n3 = new Simplex2(59);
// The yard's walls (x, z) and their height; north is -Z.
const Y = { minX: -9, maxX: 9, minZ: -7, maxZ: 7, wallH: 2.8, wallT: 0.6 };
const GATE = { x: 0, half: 1.4, h: 2.5 };
const POSTERN = { z: 3, half: 0.55, h: 1.9 };
const HOIST = { x: -8.2, z: -3.4, crankX: -7.0, crankZ: -2.0 };
const FORGE = { x: -6.6, z: 2.4 };
const TOWER = { x: -6.4, z: 5.0 };
// The mill-pond, its sluice, the race and the mill.
const POND = { x: 12, z: -14, rx: 5.5, rz: 4.5 };
const RACE = { x0: 17.0, x1: 29.0, z0: -14.8, z1: -13.2 };
const SLUICE_X = 19.2;
const WHEEL = { x: 27.6, z: -14, r: 1.5 };
const LANDING = { x0: 25.3, x1: 26.7, z0: -13.2, z1: -12.2 };
const MILL = { x0: 25, x1: 30.5, z0: -12.2, z1: -7.6 };
// The fallen ash, root to crown, outside the gate; where the winch drags it.
const ASH = { a: new THREE.Vector3(-5.4, 0, -8.3), b: new THREE.Vector3(7.2, 0, -9.1), r: 0.42 };
const ROAD_END_Z = -24;

const water = new Water();
let Y0 = 0; // the yard's ground

function moor(x: number, z: number) {
  let h = 1.0 * n1.fbm(x / 60, z / 60, 4) + 0.3 * n2.fbm(x / 16, z / 16, 3) + 0.04 * n3.noise(x / 3, z / 3);
  h += smoothstep(70, 380, Math.hypot(x - 6, z + 6)) * (14 + 20 * n2.fbm(x / 240, z / 240, 4));
  return h;
}
const inRace = (x: number, z: number, pad = 0) => x > RACE.x0 - pad && x < RACE.x1 + pad && z > RACE.z0 - pad && z < RACE.z1 + pad;
export function height(x: number, z: number) {
  const h0 = moor(x, z);
  // Level round the house, the pond and the mill, out to the moor.
  const d = Math.hypot(Math.max(Y.minX - 4 - x, 0, x - 32), Math.max(-22 - z, 0, z - (Y.maxZ + 4)));
  let h = h0 + (Y0 - h0) * (1 - smoothstep(2, 22, d));
  // The road out of the gate, worn low.
  const rd = Math.abs(x - (z < -12 ? (z + 12) * 0.25 : 0));
  if (z < Y.minZ) h -= 0.05 * (1 - smoothstep(0.6, 1.6, rd));
  // The race: a stone-lined channel, its floor 1.25 m down.
  if (inRace(x, z, 0.5)) h = Math.min(h, Y0 - 1.25);
  return water.carve(h, x, z);
}

let dir: Director | null = null;

export const watchhouse: LevelModule = {
  weather: 'morning',

  prepareField() {
    PATHS.length = 0; PUDDLES.length = 0; STANDING_STONES.length = 0;
    Y0 = moor(0, 0);
    PATHS.push([{ x: 0, z: -6.8 }, { x: 0, z: -12 }, { x: -2, z: -20 }, { x: -3, z: -28 }, { x: -5, z: -60 }]);
    PATHS.push([{ x: 9.6, z: 3 }, { x: 12, z: 0 }, { x: 14, z: -7 }, { x: 22, z: -9 }, { x: 25, z: -10 }]);
    water.pools.length = 0;
    water.add({ x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz, rot: 0.15, level: 0, depth: 1.5 });
    FIELD_OVERRIDE.height = height;
    FIELD_OVERRIDE.exclusion = (x, z) => {
      const yard = x > Y.minX - 0.5 && x < Y.maxX + 0.5 && z > Y.minZ - 0.5 && z < Y.maxZ + 0.5 ? 1 : 0;
      const mill = x > MILL.x0 - 0.5 && x < MILL.x1 + 0.5 && z > MILL.z0 - 0.5 && z < MILL.z1 + 0.5 ? 1 : 0;
      const lvl = water.surfaceAt(x, z);
      const wet = lvl !== null && height(x, z) < lvl + 0.04 ? 1 : 0;
      return Math.max(yard * 0.9, mill, wet, inRace(x, z, 0.7) ? 1 : 0);
    };
  },

  async build(physics: Physics, lv: LevelBuilder, scene: THREE.Scene): Promise<LevelInfo> {
    const root = lv.root;
    const H = (x: number, z: number) => height(x, z);
    // The pond's surface a little under the yard's ground; the race fills to it when the sluice is open.
    const pond = water.pools[0];
    pond.level = Y0 - 0.12;
    const race = water.add({ x: (RACE.x0 + RACE.x1) / 2, z: -14, rx: (RACE.x1 - RACE.x0) / 2 + 1.5, rz: 1.4, rot: 0, level: Y0 - 1.2, depth: 0, carve: false, wobble: 0,
      bounds: { x0: SLUICE_X, x1: RACE.x1, z0: RACE.z0 - 0.1, z1: RACE.z1 + 0.1 } });
    scene.add(water.build(height));
    WATER.surface = (x, z) => {
      // In the race (and the inlet up to the sluice) the race's level; the pond elsewhere.
      if (inRace(x, z) && x > SLUICE_X) return race.level;
      return water.surfaceAt(x, z);
    };
    const STONE = '#77705f', WALL = '#6d685b', WOOD = '#7a5a3c', DARK = '#4e3b2a', ROOF = '#5b4a3e', IRON = '#45494c';
    const props: Promise<unknown>[] = [];
    const prop = (id: string, x: number, z: number, o: { y?: number; yaw?: number; pitch?: number; roll?: number; scale?: number; tint?: Record<string, string> } = {}) =>
      props.push(placeProp(id, { at: [x, o.y ?? H(x, z), z], yaw: o.yaw, pitch: o.pitch, roll: o.roll, scale: o.scale, tint: o.tint }, root));
    const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // ---- The yard: its floor of beaten earth and flags, the walls with a walk along their tops.
    const wall = { color: WALL, tiles: 0.55 };
    const yb = Y0 - 0.6;
    lv.box([0, yb, 0], [Y.maxX - Y.minX, Y0 - yb + 0.02, Y.maxZ - Y.minZ], 0, { color: '#7c7262', tiles: 0.9, bevel: 0.02, cast: false });
    const W = Y.wallT, Hh = Y.wallH;
    // West, south: whole. North: either side of the gate, a lintel over it. East: either side of the postern.
    lv.box([Y.minX, Y0, 0], [W, Hh, Y.maxZ - Y.minZ + W], 0, wall);
    lv.box([0, Y0, Y.maxZ], [Y.maxX - Y.minX + W, Hh, W], 0, wall);
    const gl = GATE.x - GATE.half, gr = GATE.x + GATE.half;
    lv.box([(Y.minX + gl) / 2, Y0, Y.minZ], [gl - Y.minX, Hh, W], 0, wall);
    lv.box([(gr + Y.maxX) / 2, Y0, Y.minZ], [Y.maxX - gr, Hh, W], 0, wall);
    lv.box([GATE.x, Y0 + GATE.h, Y.minZ], [GATE.half * 2 + 0.02, Hh - GATE.h, W], 0, { ...wall, bevel: 0.02 });
    const pl = POSTERN.z - POSTERN.half, pr = POSTERN.z + POSTERN.half;
    lv.box([Y.maxX, Y0, (Y.minZ + pl) / 2], [W, Hh, pl - Y.minZ + W], 0, wall);
    lv.box([Y.maxX, Y0, (pr + Y.maxZ) / 2], [W, Hh, Y.maxZ - pr + W], 0, wall);
    lv.box([Y.maxX, Y0 + POSTERN.h, POSTERN.z], [W, Hh - POSTERN.h, POSTERN.half * 2 + 0.02], 0, { ...wall, bevel: 0.02 });
    // Gate posts and a few merlons along the wall-walk's outer edge.
    for (const x of [gl - 0.25, gr + 0.25]) lv.box([x, Y0, Y.minZ - 0.35], [0.5, Hh + 0.3, 0.3], 0, { color: STONE, tiles: 0.5 });
    for (let x = Y.minX + 1.5; x < Y.maxX - 1; x += 2.6) if (Math.abs(x - GATE.x) > 2.2) lv.box([x, Y0 + Hh, Y.minZ - 0.18], [0.7, 0.45, 0.24], 0, { color: STONE, tiles: 0.5 });

    // ---- The watch tower in the south-west corner, and the forge under a lean-to on the west wall.
    lv.box([TOWER.x, Y0, TOWER.z], [3.6, 7.2, 3.6], 0, { color: STONE, tiles: 0.6 });
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [0, -1.4], [-1.4, 0]]) lv.box([TOWER.x + dx, Y0 + 7.2, TOWER.z + dz], [0.7, 0.6, 0.7], 0, { color: STONE, tiles: 0.6 });
    lv.box([TOWER.x + 0.6, Y0, TOWER.z - 1.82], [1.0, 1.9, 0.08], 0, { color: DARK, rough: 0.8 });
    // The forge: a stone hearth with its fire, the anvil, a roof on posts.
    lv.box([FORGE.x - 1.6, Y0, FORGE.z], [1.2, 0.85, 1.6], 0, { color: STONE, tiles: 0.45 });
    lv.box([FORGE.x - 1.9, Y0 + 0.85, FORGE.z], [0.6, 1.8, 0.8], 0, { color: STONE, tiles: 0.45 });
    lv.box([FORGE.x, Y0, FORGE.z], [0.34, 0.45, 0.34], 0, { color: DARK });
    lv.box([FORGE.x, Y0 + 0.45, FORGE.z], [0.6, 0.18, 0.26], 0, { color: IRON, rough: 0.5 });
    for (const [dx, dz] of [[0.9, -1.6], [0.9, 1.6]]) lv.box([FORGE.x + dx, Y0, FORGE.z + dz], [0.16, 2.5, 0.16], 0, { color: WOOD });
    {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.1, 3.8), paintMaterial(ROOF, 0.9));
      roof.position.set(FORGE.x - 0.45, Y0 + 2.6, FORGE.z); roof.rotation.z = -0.22; roof.castShadow = true; roof.receiveShadow = true;
      root.add(roof);
    }
    // Barrels, a cart, firewood about the yard.
    prop('props/Barrel', 6.8, 5.6); prop('props/Barrel', 7.5, 5.2, { yaw: 1 }); prop('props/Crate_Wooden', 7.2, -5.6, { yaw: 0.3 });
    prop('props/Stall_Cart_Empty', 4.2, 5.2, { yaw: 1.4 }); prop('props/Bucket_Wooden_1', -4.8, 1.0); prop('props/WeaponStand', -8.1, 0.6, { yaw: Math.PI / 2 });
    prop('props/Chest_Wood', -4.6, 3.8, { yaw: 0.4 });

    // ---- The hoist on the west wall: a timber frame, a rope over its pulley, the basket she rides; his crank.
    const hoist = { y: 0, want: 0 };
    {
      const fx = HOIST.x, fz = HOIST.z;
      for (const dz of [-0.75, 0.75]) lv.box([fx + 0.55, Y0, fz + dz], [0.16, Hh + 0.9, 0.16], 0, { color: WOOD });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.16), paintMaterial(WOOD, 0.85));
      beam.position.set(fx + 0.2, Y0 + Hh + 0.85, fz); root.add(beam);
      const crankPost = lv.box([HOIST.crankX, Y0, HOIST.crankZ], [0.22, 0.9, 0.22], 0, { color: WOOD });
      void crankPost;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14).rotateZ(Math.PI / 2), paintMaterial(DARK, 0.8));
      wheel.position.set(HOIST.crankX + 0.15, Y0 + 0.82, HOIST.crankZ); root.add(wheel);
      const basket = lv.moverBox([0.86, 0.12, 0.86], (_t, p, q) => { p.set(fx, Y0 + 0.06 + hoist.y * (Hh - 0.06), fz); q.identity(); }, { color: WOOD, rough: 0.8 });
      void basket;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), paintMaterial('#8a7a5a', 0.9));
      root.add(rope);
      hoistVis = { wheel, rope, top: new THREE.Vector3(fx, Y0 + Hh + 0.85, fz), base: Y0 + 0.12 };
    }

    // ---- The gate's two leaves (they open outward, and the ash lies against them) and the postern's door.
    const gate = { open: 0 };
    for (const side of [-1, 1]) {
      const hinge = new THREE.Vector3(GATE.x + side * GATE.half, Y0, Y.minZ - 0.2);
      lv.moverBox([GATE.half - 0.02, GATE.h - 0.04, 0.16], (_t, p, q) => {
        const a = side * gate.open * 1.7;
        q.copy(yawQ(-a));
        p.copy(hinge).add(new THREE.Vector3(-side * (GATE.half / 2), (GATE.h - 0.04) / 2 + 0.02, 0).applyQuaternion(q));
      }, { color: WOOD, rough: 0.85 });
    }
    const postern = { open: 0 };
    {
      const hinge = new THREE.Vector3(Y.maxX + 0.2, Y0, POSTERN.z - POSTERN.half);
      lv.moverBox([0.12, POSTERN.h - 0.04, POSTERN.half * 2 - 0.04], (_t, p, q) => {
        q.copy(yawQ(-postern.open * 1.6));
        p.copy(hinge).add(new THREE.Vector3(0, (POSTERN.h - 0.04) / 2 + 0.02, POSTERN.half).applyQuaternion(q));
      }, { color: WOOD, rough: 0.85 });
    }
    // The bar across the postern, outside, and the crate she stands on to reach it.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.5), paintMaterial(DARK, 0.85));
    bar.position.set(Y.maxX + 0.42, Y0 + 0.95, POSTERN.z); bar.castShadow = true;
    root.add(bar);
    for (const dz of [-0.85, 0.85]) lv.box([Y.maxX + 0.38, Y0 + 0.82, POSTERN.z + dz], [0.12, 0.25, 0.1], 0, { color: IRON, rough: 0.5, member: L.detail });
    lv.box([Y.maxX + 0.75, Y0, POSTERN.z - 1.4], [0.6, 0.55, 0.6], 0.2, { color: '#a07a4c', rough: 0.8 });

    // ---- The fallen ash: root plate at the west end, the trunk across the gate, its crown by the pond.
    const ash = { t: 0 };
    {
      const g = new THREE.Group();
      const mid = ASH.a.clone().add(ASH.b).multiplyScalar(0.5), len = ASH.a.distanceTo(ASH.b);
      const along = new THREE.Vector3().subVectors(ASH.b, ASH.a).normalize();
      const yaw = Math.atan2(along.x, along.z);
      const bark = paintMaterial('#5f574b', 0.95);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(ASH.r * 0.7, ASH.r, len, 14).rotateX(Math.PI / 2), bark);
      trunk.castShadow = true; trunk.receiveShadow = true;
      g.add(trunk);
      const roots = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 12).rotateX(Math.PI / 2), paintMaterial('#4c3f33', 0.95));
      roots.position.z = -len / 2 - 0.1; roots.castShadow = true; g.add(roots);
      for (const [z, a, l] of [[2.2, 0.7, 2.4], [3.5, -0.8, 2.8], [4.6, 0.3, 3.0], [5.6, -0.4, 2.2]] as const) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, l, 7).translate(0, l / 2, 0), bark);
        b.position.set(0, 0, z); b.rotation.set(Math.PI / 2 - 0.5, 0, a); b.castShadow = true; g.add(b);
      }
      g.position.set(mid.x, Y0 + ASH.r - 0.05, mid.z); g.rotation.y = yaw;
      root.add(g);
      const crown: THREE.Matrix4[] = [];
      for (let i = 0; i < 9; i++) crown.push(new THREE.Matrix4().compose(new THREE.Vector3((i % 3 - 1) * 1.1, -0.3 + (i % 2) * 0.4, len / 2 - 2.6 + Math.floor(i / 3) * 1.4), yawQ(i), new THREE.Vector3(1.3, 1.1, 1.3)));
      props.push(instanceProp('nature/Bush_Common', crown, g, { Leaves_TwistedTree: '#55663a' }));
      const body = physics.addPlatform(g, [RAPIER.ColliderDesc.capsule(len / 2, ASH.r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })], (_t, p, q) => {
        // Dragged east toward the mill, swinging its root end round off the gate.
        const s = ash.t * ash.t * (3 - 2 * ash.t);
        p.set(mid.x + 4.2 * s, Y0 + ASH.r - 0.05, mid.z - 2.6 * s);
        q.copy(yawQ(yaw + 0.42 * s));
      }, { kind: 'wood' });
      void body;
      ashMid = mid;
    }
    // The winch rope, from the mill to the ash (shown once he ties it on).
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), paintMaterial('#8a7a5a', 0.9));
    rope.visible = false; rope.castShadow = true;
    root.add(rope);

    // ---- The mill-pond's sluice, the race and the mill.
    // Stone banks along the race (too high to climb out of except up the steps at its head).
    const bankTop = Y0 + 0.3, floor = Y0 - 1.25;
    // The south bank leaves a gap at the landing; the north bank, at the steps out of the race's head.
    const STEP_X0 = SLUICE_X + 0.2, STEP_X1 = SLUICE_X + 1.1;
    const bank = (x0: number, x1: number, z: number) => lv.box([(x0 + x1) / 2, floor, z], [x1 - x0, bankTop - floor, 0.6], 0, { color: STONE, tiles: 0.45 });
    bank(SLUICE_X, LANDING.x0, RACE.z1 + 0.3); bank(LANDING.x1, RACE.x1, RACE.z1 + 0.3);
    bank(SLUICE_X, STEP_X0, RACE.z0 - 0.3); bank(STEP_X1, RACE.x1, RACE.z0 - 0.3);
    lv.box([RACE.x1 + 0.3, floor, -14], [0.6, bankTop - floor, RACE.z1 - RACE.z0 + 1.2], 0, { color: STONE, tiles: 0.45 });
    // Steps up out of the race's head, to the north.
    lv.stairs([(STEP_X0 + STEP_X1) / 2, floor, RACE.z1 - 0.02], 5, 0.25, 0.32, STEP_X1 - STEP_X0, Math.PI, { color: STONE, tiles: 0.4 });
    // The inlet's walls between the pond and the sluice.
    for (const z of [RACE.z0 - 0.3, RACE.z1 + 0.3]) lv.box([(RACE.x0 + SLUICE_X) / 2, floor, z], [SLUICE_X - RACE.x0, bankTop - floor, 0.6], 0, { color: STONE, tiles: 0.45 });
    // The sluice gate in its frame: it lifts while the weight-plate is down.
    const sluice = { open: 0 };
    for (const z of [RACE.z0 - 0.15, RACE.z1 + 0.15]) lv.box([SLUICE_X, floor, z], [0.3, bankTop - floor + 1.9, 0.3], 0, { color: WOOD });
    lv.box([SLUICE_X, bankTop + 1.9, -14], [0.3, 0.25, RACE.z1 - RACE.z0 + 0.6], 0, { color: WOOD });
    lv.moverBox([0.16, bankTop - floor + 0.1, RACE.z1 - RACE.z0], (_t, p, q) => { p.set(SLUICE_X, floor + (bankTop - floor + 0.1) / 2 + sluice.open * 1.75, -14); q.identity(); }, { color: DARK, rough: 0.8 });
    // The weight-plate on the pond's bed, under the water.
    const plateY = H(POND.x, POND.z);
    const plateMesh = new THREE.Group();
    {
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.12, 18), paintMaterial(STONE, 0.8, 1, 0.3));
      slab.position.y = 0.06; slab.receiveShadow = true; plateMesh.add(slab);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14).rotateX(Math.PI / 2), paintMaterial(IRON, 0.5));
      ring.position.y = 0.13; plateMesh.add(ring);
      const holder = new THREE.Group(); holder.position.set(POND.x, plateY, POND.z); holder.add(plateMesh); root.add(holder);
      // A chain from the plate toward the sluice, half in the mud.
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, SLUICE_X - POND.x, 5).rotateZ(Math.PI / 2), paintMaterial(IRON, 0.5));
      chain.position.set((POND.x + SLUICE_X) / 2, plateY + 0.04, -14); root.add(chain);
    }
    // The mill: a stone building beside the race's end, its wheel in the race, the landing under a low roof.
    lv.box([(MILL.x0 + MILL.x1) / 2, Y0 - 0.1, (MILL.z0 + MILL.z1) / 2], [MILL.x1 - MILL.x0, 4.2, MILL.z1 - MILL.z0], 0, { color: STONE, tiles: 0.55 });
    {
      const roofMat = paintMaterial(ROOF, 0.9);
      for (const s of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(MILL.x1 - MILL.x0 + 0.6, 0.12, (MILL.z1 - MILL.z0) / 2 + 0.6), roofMat);
        r.position.set((MILL.x0 + MILL.x1) / 2, Y0 + 4.1 + 0.8, (MILL.z0 + MILL.z1) / 2 + s * 1.15); r.rotation.x = s * 0.62; r.castShadow = true;
        root.add(r);
      }
    }
    // The landing: a ledge in the race's south bank at the wheel, walled in on its land sides, under a low roof, so
    // it is reached only from the water.
    const landTop = Y0 - 0.1;
    lv.box([(LANDING.x0 + LANDING.x1) / 2, floor, (LANDING.z0 + LANDING.z1) / 2], [LANDING.x1 - LANDING.x0, landTop - floor, LANDING.z1 - LANDING.z0], 0, { color: STONE, tiles: 0.4 });
    lv.box([LANDING.x0 - 0.15, floor, (LANDING.z0 + LANDING.z1) / 2 + 0.15], [0.3, Y0 + 1.1 - floor, LANDING.z1 - LANDING.z0 + 0.3], 0, { color: STONE, tiles: 0.45 });
    lv.box([LANDING.x1 + 0.15, floor, (LANDING.z0 + LANDING.z1) / 2 + 0.15], [0.3, Y0 + 1.1 - floor, LANDING.z1 - LANDING.z0 + 0.3], 0, { color: STONE, tiles: 0.45 });
    lv.box([(LANDING.x0 + LANDING.x1) / 2, Y0 + 0.55, (LANDING.z0 + LANDING.z1) / 2], [LANDING.x1 - LANDING.x0 + 0.6, 0.14, LANDING.z1 - LANDING.z0 + 0.4], 0, { color: WOOD });
    // The brake lever on the landing.
    const lever = new THREE.Group();
    {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05).translate(0, 0.21, 0), paintMaterial(WOOD, 0.8));
      lever.add(stick);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), paintMaterial(IRON, 0.5)); knob.position.y = 0.42; lever.add(knob);
      lever.position.set(LANDING.x1 - 0.3, landTop, LANDING.z0 + 0.45); lever.rotation.x = -0.5;
      root.add(lever);
    }
    // The wheel: paddles round a hub, turning when the race runs and the brake is off. It blocks the race beyond it.
    const wheel = new THREE.Group();
    {
      const wood = paintMaterial(WOOD, 0.85);
      for (const s of [-0.28, 0.28]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL.r - 0.05, 0.06, 6, 28), wood); rim.position.z = s; wheel.add(rim);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 10).rotateX(Math.PI / 2), paintMaterial(DARK, 0.8)); wheel.add(hub);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, WHEEL.r, 0.06).translate(0, WHEEL.r / 2, 0), wood); spoke.rotation.z = a; wheel.add(spoke);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), wood); pad.position.set(-Math.sin(a) * WHEEL.r, Math.cos(a) * WHEEL.r, 0); pad.rotation.z = a; wheel.add(pad);
      }
      wheel.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
      wheel.position.set(WHEEL.x, Y0 - 0.1, WHEEL.z); wheel.rotation.y = Math.PI / 2;
      root.add(wheel);
      physics.addBox(new THREE.Vector3(WHEEL.x, Y0 - 0.1, WHEEL.z), new THREE.Vector3(WHEEL.r, WHEEL.r, 0.75), yawQ(Math.PI / 2), { kind: 'wood' });
    }

    // ---- The way out: the road north past a mile-stone; reeds and rocks round the pond; the moor beyond.
    for (const [x, z, s] of [[-14, -16, 0.5], [22, 8, 0.45], [-18, 10, 0.55], [34, -20, 0.5]] as const) prop('nature/DeadTree_4', x, z, { yaw: x, scale: s });
    for (const [x, z, s] of [[6.8, -12.5, 0.5], [9, -18.8, 0.6], [16.5, -18, 0.45], [17.2, -10.6, 0.4], [-2.6, -15, 0.5]] as const) prop('nature/Rock_Medium_1', x, z, { yaw: x * 3, scale: s, y: H(x, z) - 0.1 });
    lv.box([1.6, H(1.6, -19), -19], [0.4, 0.9, 0.3], 0.2, { color: STONE, tiles: 0.4 });

    await Promise.all(props);
    // Everything the story drives.
    Object.assign(state, { hoist, gate, postern, ash, sluice, rope, bar, lever, wheel, pond, race, plateMesh, plateY, landTop });
    return {
      killY: Y0 - 30,
      killZones: [],
      spawn: {
        kitten: { pos: new THREE.Vector3(FORGE.x + 0.9, Y0, FORGE.z - 0.4), yaw: Math.PI / 2 },
        knight: { pos: new THREE.Vector3(FORGE.x + 1.4, Y0, FORGE.z + 0.2), yaw: -Math.PI / 2 },
      },
    };
  },

  async start(c: StoryContext) {
    dir = new Director(c);
    (globalThis as any).__ch1 = dir;
    dir.start();
  },
  begin(c: StoryContext) { dir?.opening(c); },
  update(dt: number, t: number, c: StoryContext) { dir?.update(dt, t, c); },
  warmViews() {
    return [
      { pos: [FORGE.x + 2.2, Y0 + 1.2, FORGE.z + 1.6], look: [FORGE.x, Y0 + 0.6, FORGE.z] },
      { pos: [2, Y0 + 5, 6], look: [0, Y0, -8] },
      { pos: [16, Y0 + 3, -6], look: [22, Y0 - 0.5, -14] },
    ] as { pos: [number, number, number]; look: [number, number, number] }[];
  },
};

let hoistVis: { wheel: THREE.Mesh; rope: THREE.Mesh; top: THREE.Vector3; base: number } | null = null;
let ashMid = new THREE.Vector3();
const state: any = {};

// The knight's lines as play goes on, each said once (and not over another).
class Barks {
  private said = new Set<string>();
  private busyT = 0;
  private queue: string[] = [];
  constructor(private c: StoryContext, private subs: Subtitles) {}
  line(key: string, text: string) {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.queue.push(text);
  }
  update(dt: number) {
    this.busyT -= dt;
    if (this.busyT > 0 || !this.queue.length) return;
    const text = this.queue.shift()!;
    const head = new THREE.Vector3(0, 0.1, 0.1).applyMatrix4(this.c.knight.parts.head.matrixWorld);
    this.busyT = say(this.c.audio, this.subs, text, head) + 1.6;
  }
}

class Director {
  stage: 'title' | 'opening' | 'play' | 'drag' | 'road' | 'end' = 'title';
  private subs = new Subtitles();
  private barks: Barks;
  private black: HTMLDivElement;
  private fire: Campfire;
  private crankT = 0;
  roped = false;
  braked = true;
  private wheelSpin = 0;
  private flow = 0;

  constructor(private c: StoryContext) {
    this.barks = new Barks(c, this.subs);
    this.black = document.createElement('div');
    this.black.style.cssText = 'position:fixed;inset:0;background:#0b0c0c;opacity:0;pointer-events:none;z-index:5;transition:opacity 1.6s';
    document.body.appendChild(this.black);
    this.fire = new Campfire(new THREE.Vector3(FORGE.x - 1.6, Y0 + 0.86, FORGE.z), 0.55);
    c.scene.add(this.fire.group);
  }

  private get kitten() { return this.c.game.kitten; }
  private get knight() { return this.c.game.knight; }

  start() {
    const c = this.c, g = c.game, I = g.interactions;
    LOOK.fogDistance.value = 110;
    c.kitten.setBare(false);
    c.kitten.defaultPose = null;
    g.canSwitch = true;
    g.follower.mode = 'follow';
    // The hoist's crank (his).
    I.add({
      pos: new THREE.Vector3(HOIST.crankX, Y0, HOIST.crankZ), radius: 1.1, who: 'knight',
      text: 'Turn the crank', ready: () => this.crankT <= 0,
      use: () => {
        state.hoist.want = state.hoist.want > 0.5 ? 0 : 1;
        this.crankT = 3.2;
        const kn = c.knight;
        kn.reachWant = 1;
        kn.reachL.set(HOIST.crankX + 0.15, Y0 + 1.0, HOIST.crankZ + 0.12); kn.reachR.set(HOIST.crankX + 0.15, Y0 + 0.9, HOIST.crankZ - 0.12);
        c.audio.play('creak', new THREE.Vector3(HOIST.x, Y0 + 1.5, HOIST.z), 1);
        if (state.hoist.want === 1 && !this.onBasket()) this.barks.line('basket', 'Nobody in the basket, little one. In you get.');
      },
    });
    // The gate (his): it will not open while the ash lies against it.
    I.add({
      pos: new THREE.Vector3(GATE.x, Y0, Y.minZ + 0.6), radius: 1.6, who: 'knight', text: 'Push the gate', ready: () => state.ash.t < 0.5,
      use: () => { c.audio.play('thud', new THREE.Vector3(GATE.x, Y0 + 1, Y.minZ), 0.8); this.barks.line('gate2', 'Won’t budge. That ash is lying right across it.'); this.barks.line('gate3', 'The hoist, little one. Up onto the wall with you.'); },
    });
    I.add({
      pos: new THREE.Vector3(Y.maxX - 0.6, Y0, POSTERN.z), radius: 1.2, who: 'knight', text: 'Open the postern', ready: () => state.postern.open < 0.5,
      use: () => { c.audio.play('thud', new THREE.Vector3(Y.maxX, Y0 + 1, POSTERN.z), 0.6); this.barks.line('postern', 'Barred on the outside. If you were out there, you could knock it off.'); },
    });
    // The postern's bar (hers, from the crate).
    I.add({
      pos: new THREE.Vector3(Y.maxX + 0.75, Y0 + 0.95, POSTERN.z - 0.7), radius: 1.0, who: 'kitten', text: 'Knock the bar off', ready: () => state.postern.open < 0.5 && !this.barDown,
      use: () => { this.barDown = true; c.audio.play('bolt', state.bar.position, 1); },
    });
    // The rope (his), at the ash's crown end, toward the mill.
    I.add({
      pos: new THREE.Vector3(ASH.b.x - 0.6, Y0, ASH.b.z + 0.6), radius: 1.6, who: 'knight', text: 'Tie the winch rope to the ash', ready: () => !this.roped,
      use: () => {
        this.roped = true; state.rope.visible = true;
        c.audio.play('creak', ASH.b, 0.8);
        this.barks.line('roped', 'There. Now if the mill wheel would only turn…');
        this.barks.line('sluice', 'The sluice is shut. There’s an old weight-plate down in the pond that opens it. I’ll go in.');
      },
    });
    // The brake (hers, on the landing).
    I.add({
      pos: new THREE.Vector3(LANDING.x1 - 0.3, state.landTop, LANDING.z0 + 0.45), radius: 0.8, who: 'kitten', text: 'Let the brake off', ready: () => this.braked,
      use: () => {
        state.lever.rotation.x = 0.5;
        c.audio.play('bolt', state.lever.position, 1);
        if (!this.roped) { state.lever.rotation.x = -0.5; this.barks.line('norope', 'Wait, wait. I haven’t tied the rope on yet.'); return; }
        this.braked = false;
      },
    });
    // The weight-plate on the pond's bed (only he is heavy enough, and only he sinks to it).
    I.plate({
      pos: new THREE.Vector3(POND.x, state.plateY, POND.z), radius: 0.9, heavy: true, mesh: state.plateMesh, travel: 0.06,
      onChange: (on) => {
        c.audio.play(on ? 'gate' : 'stone', new THREE.Vector3(SLUICE_X, Y0, -14), 0.9);
        if (on) { this.barks.line('onplate', 'Got it. Go on, swim the race while I hold it!'); c.hud.say('The sluice lifts while he stands on the plate.', 4); }
      },
    });
  }
  private barDown = false;

  private onBasket() {
    const p = this.kitten.char.body.pos;
    return Math.abs(p.x - HOIST.x) < 0.45 && Math.abs(p.z - HOIST.z) < 0.45 && p.y < Y0 + Y.wallH * state.hoist.y + 0.4;
  }

  // ---- The forge, in the morning: her new armour, his ribbon; then the gate.
  opening(c: StoryContext) {
    this.stage = 'opening';
    const kn = c.knight;
    const anvilTop = Y0 + 0.63;
    const kp = new THREE.Vector3(FORGE.x, anvilTop, FORGE.z);
    const cs: Cutscene = {
      name: 'opening', length: 17, skippable: true,
      fades: [{ at: 0, dur: 0, to: 1 }, { at: 0.3, dur: 2.0, to: 0 }],
      shots: [
        { at: 0, dur: 7, from: { pos: [FORGE.x + 1.9, Y0 + 0.95, FORGE.z + 1.3], look: [FORGE.x, anvilTop + 0.2, FORGE.z], mm: 40, dof: 0.4 }, to: { pos: [FORGE.x + 1.6, Y0 + 0.9, FORGE.z + 1.0], look: [FORGE.x, anvilTop + 0.22, FORGE.z], mm: 44, dof: 0.4 }, ease: 'smooth' },
        { at: 7, dur: 4, from: { pos: [FORGE.x + 0.55, anvilTop + 0.3, FORGE.z + 0.5], look: [FORGE.x, anvilTop + 0.22, FORGE.z], mm: 55, dof: 0.6 }, to: { pos: [FORGE.x + 0.5, anvilTop + 0.28, FORGE.z + 0.45], look: [FORGE.x, anvilTop + 0.24, FORGE.z], mm: 58, dof: 0.6 }, ease: 'smooth' },
        { at: 11, dur: 6, from: { pos: [3, Y0 + 4.5, 4], look: [GATE.x, Y0 + 0.5, Y.minZ - 1.5], mm: 32 }, to: { pos: [2.4, Y0 + 5.2, 2.6], look: [GATE.x, Y0 + 0.3, Y.minZ - 2], mm: 32 }, ease: 'smooth' },
      ],
      marks: [
        { at: 0, who: 'kitten', path: [[kp.x, kp.y, kp.z]], face: Math.PI / 2, probe: 0.3 },
        { at: 0, who: 'knight', path: [[FORGE.x + 0.8, Y0, FORGE.z]], face: -Math.PI / 2 },
        { at: 13, who: 'kitten', path: [[FORGE.x + 0.9, Y0, FORGE.z - 0.4]], face: Math.PI / 2 },
      ],
      cues: [
        { at: 0.6, run: () => this.c.audio.play('clank', kp, 0.4), onSkip: false },
        { at: 2.0, run: () => { kn.reachWant = 1; const b = new THREE.Vector3(0, 0.05, 0).applyMatrix4(c.kitten.parts.head.matrixWorld); kn.reachL.copy(b).add(new THREE.Vector3(0.05, 0.04, 0.06)); kn.reachR.copy(b).add(new THREE.Vector3(0.05, 0.04, -0.06)); } },
        { at: 4.6, run: () => { kn.reachWant = 0; } },
        { at: 5.0, run: () => this.say('There. Now you look like a proper knight.'), onSkip: false },
        { at: 8.2, run: () => { c.kitten.meow('mrrp'); c.audio.play('mrrp', kp, 1); }, onSkip: false },
        { at: 11.6, run: () => this.say('The old ash came down in the storm. Right across our gate.'), onSkip: false },
      ],
      onEnd: () => this.play(),
    };
    c.timeline.play(cs);
  }

  private say(line: string) {
    say(this.c.audio, this.subs, line, new THREE.Vector3(0, 0.1, 0.1).applyMatrix4(this.c.knight.parts.head.matrixWorld));
  }

  private play() {
    const c = this.c;
    this.stage = 'play';
    c.knight.reachWant = 0;
    c.hud.objective('Get the gate open.');
    c.hud.say(c.touch() ? 'Switch changes between them; Wait tells the other to stay. Act uses things.' : 'Tab switches between the kitten and the knight; Q tells the other to wait or follow. E uses things.', 7);
  }

  private drag() {
    const c = this.c;
    this.stage = 'drag';
    const cs: Cutscene = {
      name: 'drag', length: 11, skippable: true,
      shots: [
        { at: 0, dur: 3.5, from: { pos: [WHEEL.x - 3.2, Y0 + 1.4, WHEEL.z + 2.6], look: [WHEEL.x, Y0, WHEEL.z], mm: 34 }, to: { pos: [WHEEL.x - 2.8, Y0 + 1.3, WHEEL.z + 2.3], look: [WHEEL.x, Y0, WHEEL.z], mm: 36 }, ease: 'smooth' },
        { at: 3.5, dur: 7.5, from: { pos: [GATE.x - 3, Y0 + 3.2, Y.minZ - 6.5], look: [ashMid.x + 1, Y0 + 0.3, ashMid.z], mm: 30 }, to: { pos: [GATE.x - 2, Y0 + 3.6, Y.minZ - 7.5], look: [ashMid.x + 2.5, Y0 + 0.3, ashMid.z - 1], mm: 30 }, ease: 'smooth' },
      ],
      cues: [
        { at: 0.2, run: () => c.audio.play('creak', new THREE.Vector3(WHEEL.x, Y0, WHEEL.z), 1.2) },
        { at: 3.8, run: () => { this.dragging = true; c.audio.play('gate', ashMid, 1.2); } },
        { at: 8.2, run: () => { this.gateOpening = true; c.audio.play('door', new THREE.Vector3(GATE.x, Y0 + 1, Y.minZ), 1); } },
        { at: 10.9, run: () => { state.ash.t = 1; state.gate.open = 1; }, onSkip: true },
      ],
      onEnd: () => {
        this.stage = 'road';
        c.hud.objective('Out onto the road, together.');
        this.barks.line('free', 'Ha! That’s my girl.');
        this.barks.line('road', 'Come on, then. The castle’s a long road off.');
      },
    };
    c.timeline.play(cs);
  }
  private dragging = false;
  private gateOpening = false;
  private hinted = new Set<string>();

  update(dt: number, t: number, c: StoryContext) {
    this.fire.update(dt, t, c.camera);
    this.barks.update(dt);
    const S = state;
    if (!S.hoist) return;
    this.crankT = Math.max(0, this.crankT - dt);
    if (this.crankT <= 0 && c.knight.reachWant > 0 && this.stage === 'play') c.knight.reachWant = 0;
    // The hoist eases toward where the crank sends it.
    const hs = (S.hoist.want - S.hoist.y);
    S.hoist.y += THREE.MathUtils.clamp(hs, -dt / 3, dt / 3);
    if (hoistVis) {
      hoistVis.wheel.rotation.x += hs !== 0 ? dt * 4 * Math.sign(hs) : 0;
      const by = hoistVis.base + S.hoist.y * (Y.wallH - 0.06), top = hoistVis.top.y;
      hoistVis.rope.position.set(hoistVis.top.x, (by + top) / 2, hoistVis.top.z);
      hoistVis.rope.scale.y = Math.max(0.05, top - by);
    }
    // The postern bar falls, the door swings.
    if (this.barDown) {
      S.bar.position.y = Math.max(Y0 + 0.06, S.bar.position.y - dt * 3);
      S.bar.rotation.x = Math.min(0.5, S.bar.rotation.x + dt * 2);
      if (S.postern.open < 1) {
        S.postern.open = Math.min(1, S.postern.open + dt * 0.7);
        if (S.postern.open >= 1) { c.audio.play('creak', new THREE.Vector3(Y.maxX, Y0 + 1, POSTERN.z), 0.8); this.barks.line('posternOpen', 'Clever girl. Right, let’s see about that tree.'); c.hud.objective('Get the gate open. (The mill’s winch could drag the ash away.)'); }
      }
    }
    // The sluice follows the plate; the race fills or drains through it.
    const plate = c.game.interactions.plates[0];
    S.sluice.open = THREE.MathUtils.clamp(S.sluice.open + (plate?.pressed ? dt / 1.4 : -dt / 1.4), 0, 1);
    const low = Y0 - 1.2, high = S.pond.level;
    const want = low + (high - low) * S.sluice.open;
    water.setLevel(S.race, S.race.level + THREE.MathUtils.clamp(want - S.race.level, -dt * 0.35, dt * 0.45));
    this.flow = (S.race.level - low) / (high - low);
    // The wheel: turning when the race runs high and the brake is off.
    const spin = !this.braked && this.flow > 0.75 ? 1 : 0;
    this.wheelSpin += (spin - this.wheelSpin) * Math.min(1, dt * 0.8);
    S.wheel.rotation.z -= this.wheelSpin * dt * 1.1;
    if (spin && this.stage === 'play' && this.roped) this.drag();
    if (this.dragging) S.ash.t = Math.min(1, S.ash.t + dt / 4.2);
    if (this.gateOpening) S.gate.open = Math.min(1, S.gate.open + dt / 2.2);
    // The rope from the mill's wall to the ash's crown end.
    if (S.rope.visible) {
      const a = new THREE.Vector3(MILL.x0, Y0 + 1.2, MILL.z0 + 1.0);
      const s = S.ash.t * S.ash.t * (3 - 2 * S.ash.t);
      const b = ASH.b.clone().add(new THREE.Vector3(4.2 * s, Y0 + 0.35, -2.6 * s));
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      S.rope.position.copy(mid); S.rope.scale.set(1, len, 1);
      S.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    if (c.timeline.playing || this.stage !== 'play' && this.stage !== 'road') return;
    // Guidance as they go.
    const kp = this.kitten.char.body.pos, np = this.knight.char.body.pos;
    const outside = (p: THREE.Vector3) => p.x < Y.minX - 0.4 || p.x > Y.maxX + 0.4 || p.z < Y.minZ - 0.4 || p.z > Y.maxZ + 0.4;
    if (this.stage === 'play') {
      if (Math.hypot(kp.x - HOIST.x, kp.z - HOIST.z) < 2.2) this.barks.line('hoist', 'Hop in the basket and I’ll wind you up.');
      if (kp.y > Y0 + Y.wallH - 0.2 && !outside(kp)) this.barks.line('wall', 'Careful up there. Down the far side, and come round to the little door.');
      if (outside(kp) && !this.barDown) c.hud.objective('Knock the bar off the postern door, on the east wall.');
      if (outside(np) && !this.roped) this.barks.line('tree', 'The mill’s winch could drag this off. Let me get the rope on it.');
      if (S.race.level > Y0 - 0.6 && Math.hypot(kp.x - (RACE.x0 + 3), kp.z + 14) < 6 && !this.hinted.has('race')) { this.hinted.add('race'); c.hud.say('Swim up the race to the wheel.', 4); }
    }
    if (this.stage === 'road') {
      const a = c.game.active.char.body.pos, o = c.game.companion.char.body.pos;
      if (a.z < ROAD_END_Z && o.distanceTo(a) < 10) this.end();
      else if (a.z < ROAD_END_Z) c.hud.say('Wait for each other.', 2);
    }
  }

  private end() {
    this.stage = 'end';
    this.black.style.opacity = '1';
    this.subs.hide();
    setTimeout(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0c0d0d;color:#ece8de;font:16px Georgia,serif;z-index:7;text-align:center;padding:24px';
      d.innerHTML = `<div style="font-size:clamp(22px,3vw,34px);letter-spacing:.14em;text-transform:uppercase">End of Chapter One</div>
        <div style="opacity:.8;font-style:italic;max-width:34em">Chapter Two, the Grey Moor, comes next.</div>`;
      const btn = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'font:15px Georgia,serif;background:rgba(236,232,222,.08);color:#ece8de;border:1px solid rgba(236,232,222,.4);border-radius:3px;padding:9px 18px;cursor:pointer;min-width:260px';
        b.onclick = fn;
        d.appendChild(b);
      };
      btn('Play Chapter One again', () => location.reload());
      btn('Back to the prologue', () => { const u = new URL(location.href); u.searchParams.delete('level'); location.href = u.toString(); });
      document.body.appendChild(d);
    }, 1800);
  }
}

// Debug: jump to a stage of the chapter (__v2.story(stage)).
export function debugStageCh1(c: StoryContext, stage: string) {
  if (!dir) return;
  c.timeline.skip();
  const d = dir as any;
  if (d.stage === 'title' || d.stage === 'opening') d.play();
  const g = c.game;
  const put = (a: Actor, x: number, z: number, y = Y0) => { a.motor.place(new THREE.Vector3(x, y, z), a.char.body.yaw); a.char.resetPose(a.ground); };
  if (stage === 'outside') { put(g.kitten, Y.maxX + 1.4, POSTERN.z - 2.5); }
  if (stage === 'pond') { d.barDown = true; state.postern.open = 1; d.roped = true; state.rope.visible = true; put(g.knight, POND.x - 7, POND.z + 4); put(g.kitten, RACE.x0 + 2.4, RACE.z0 - 1.2); }
}
export const CH1 = { Y: () => Y0, HOIST, POND, RACE, SLUICE_X, LANDING, WHEEL, ASH, GATE, POSTERN, ROAD_END_Z };
