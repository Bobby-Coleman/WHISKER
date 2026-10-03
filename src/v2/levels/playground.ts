// The movement playground (?v2): an old stone terrace on the moor holding a test of everything the engine does.
// South half: stairs to a line of jumps (gaps of 1.5, 2.2 and 2.5 m), a wall with a kitten-sized hole through it, a
// wall with ivy that she climbs (he throws her up instead), a ramp beside a slope too steep to walk, a lift to a high
// platform with a beam across to the ivy wall's top, and crates the knight can push to reach a ledge he cannot jump.
// A ferry crosses a pit to the north half, where a turntable turns.
import * as THREE from 'three/webgpu';
import { Simplex2, smoothstep } from '../../world/noise';
import { FIELD_OVERRIDE, PATHS, PUDDLES, STANDING_STONES } from '../../world/layout';
import { RAPIER, Physics } from '../physics';
import { LevelBuilder, pingPong } from '../level';
import type { LevelInfo } from '../game';
import type { Cutscene } from '../timeline';

const n1 = new Simplex2(11), n2 = new Simplex2(23), n3 = new Simplex2(37);
// The terrace's footprint (x, z) and the pit across it.
const T = { minX: -11, maxX: 11, minZ: -47, maxZ: 3, pitMinZ: -34, pitMaxZ: -27 };

function moor(x: number, z: number) {
  let h = 1.3 * n1.fbm(x / 60, z / 60, 4) + 0.35 * n2.fbm(x / 17, z / 17, 3) + 0.05 * n3.noise(x / 3.5, z / 3.5);
  // Hills rise beyond the field.
  h += smoothstep(70, 380, Math.hypot(x, z + 20)) * (14 + 20 * n2.fbm(x / 240, z / 240, 4));
  return h;
}
const H0 = moor(0, -20);
const rectDist = (x: number, z: number) => Math.hypot(Math.max(T.minX - x, 0, x - T.maxX), Math.max(T.minZ - z, 0, z - T.maxZ));

// The moor round the terrace: levelled to its foot, with the pit sunk under the ferry (its edges hidden under the
// terrace's slabs and end walls). Grass and plants stay off the stone.
export function prepareField() {
  PATHS.length = 0; PUDDLES.length = 0; STANDING_STONES.length = 0;
  PATHS.push([{ x: 1.5, z: 60 }, { x: -0.5, z: 30 }, { x: 0.4, z: 12 }, { x: 0, z: 3.5 }]);
  FIELD_OVERRIDE.height = (x, z) => {
    const h = moor(x, z);
    let y = h + (H0 - h) * (1 - smoothstep(0, 9, rectDist(x, z)));
    const wz = (1 - smoothstep(T.pitMaxZ, T.pitMaxZ + 0.5, z)) * smoothstep(T.pitMinZ - 0.5, T.pitMinZ, z);
    const wx = 1 - smoothstep(T.maxX, T.maxX + 0.5, Math.abs(x));
    y -= 4.2 * wz * wx;
    return y;
  };
  FIELD_OVERRIDE.exclusion = (x, z) => (rectDist(x, z) < 0.5 ? 1 : 0);
}

// Weathered moorland stone, warm and a little green-grey; oak; iron.
const STONE = '#6f685d', STEP = '#7d7466', PILLAR = '#77705f', WALL = '#686458', WOOD = '#7a5a3c', LEDGE = '#736b5c', IRON = '#4d5256';

export function buildPlayground(_physics: Physics, lv: LevelBuilder): LevelInfo {
  const H = H0 + 0.3; // the terrace's top
  const base = H0 - 4.5; // slabs go down past the pit's floor
  const stone = { color: STONE, tiles: 0.9, bevel: 0.08 };
  // The terrace: two slabs either side of the pit, and walls closing the pit's ends.
  lv.box([0, base, (T.maxZ + T.pitMaxZ) / 2], [22, H - base, T.maxZ - T.pitMaxZ], 0, stone);
  lv.box([0, base, (T.pitMinZ + T.minZ) / 2], [22, H - base, T.pitMinZ - T.minZ], 0, stone);
  for (const s of [-1, 1]) lv.box([s * 11.3, base, (T.pitMinZ + T.pitMaxZ) / 2], [0.6, H + 0.6 - base, T.pitMaxZ - T.pitMinZ + 0.6], 0, { color: WALL, tiles: 0.6 });

  // West: stairs up to a line of jumps, and a ramp back down.
  lv.stairs([-7, H, -3], 6, 0.2, 0.45, 2.4, Math.PI, { color: STEP, tiles: 0.6 });
  lv.box([-7, H, -7.2], [2.8, 1.2, 3.0], 0, { color: PILLAR, tiles: 0.6 });
  lv.box([-7, H, -11.2], [2, 1.2, 2], 0, { color: PILLAR, tiles: 0.6 }); // 1.5 m gap
  lv.box([-7, H, -15.4], [2, 1.5, 2], 0, { color: PILLAR, tiles: 0.6 }); // 2.2 m gap, a step up
  lv.box([-7, H, -20.4], [3, 1.2, 3], 0, { color: PILLAR, tiles: 0.6 }); // 2.5 m gap, a step down
  lv.ramp([-7, H, -25.4], 2.4, 3.5, 1.2, 0, { color: STEP });

  // Centre: a wall with a hole only the kitten fits through (the knight goes round).
  const hw = 0.17, hh = 0.42, wz = -5.5;
  lv.box([-1.6 - hw / 2, H, wz], [3.2 - hw, 2, 0.5], 0, { color: WALL, tiles: 0.5 });
  lv.box([1.6 + hw / 2, H, wz], [3.2 - hw, 2, 0.5], 0, { color: WALL, tiles: 0.5 });
  lv.box([0, H + hh, wz], [hw * 2 + 0.02, 2 - hh, 0.5], 0, { color: WALL, tiles: 0.5, bevel: 0.02 });

  // Centre: the ivy wall. She climbs its face; he throws her up, or rides the lift and crosses the beam.
  lv.ivyWall([0, H, -14], [5, 2.6, 1.6], 0, { color: WALL, tiles: 0.55 }, 11, 1.2);

  // East: a ramp up to a platform, and beside it a slope too steep to walk (it slides you back).
  lv.ramp([7, H, -2.6], 2.4, 3.8, 1.2, Math.PI, { color: STEP });
  lv.box([7, H, -7.9], [2.6, 1.2, 3], 0, { color: PILLAR, tiles: 0.6 });
  lv.ramp([9.7, H, -2.6], 1.4, 1.05, 1.5, Math.PI, { color: LEDGE });

  // East: a lift up to a high platform, and a beam across to the ivy wall's top.
  lv.box([7, H, -14], [2.6, 2.6, 2.6], 0, { color: PILLAR, tiles: 0.6 });
  const liftLow = H - 0.13, liftHigh = H + 2.6 - 0.15;
  lv.moverBox([2, 0.3, 2], (t, p, q) => { p.set(7, liftLow + (liftHigh - liftLow) * pingPong(t, 9, 0.3), -11.7); q.identity(); }, { color: WOOD, rough: 0.8 });
  lv.box([4.05, H + 2.38, -14], [3.3, 0.22, 0.32], 0, { color: WOOD, rough: 0.8, bevel: 0.03 });

  // South-east: crates and a ledge too high to jump. The knight pushes a crate over to climb it; the kitten is too
  // light to shift one.
  lv.box([9, H, 1.4], [2.4, 1.7, 2.4], 0, { color: LEDGE, tiles: 0.6 });
  lv.crate([4.6, H, 1.6], 0.9, 80);
  lv.crate([3.3, H, 0.4], 0.9, 80);
  lv.crate([4.2, H, -0.9], 0.7, 80);

  // The ferry over the pit.
  lv.moverBox([2.6, 0.3, 2.6], (t, p, q) => { p.set(0, H - 0.13, THREE.MathUtils.lerp(-28.6, -32.4, pingPong(t, 8, 0.25))); q.identity(); }, { color: WOOD, rough: 0.8 });

  // North: a turntable with a post on it.
  const Y = new THREE.Vector3(0, 1, 0);
  const tt = lv.mover(new THREE.CylinderGeometry(2, 2, 0.4, 48), [RAPIER.ColliderDesc.cylinder(0.2, 2), RAPIER.ColliderDesc.cuboid(0.25, 0.6, 0.25).setTranslation(1.3, 0.8, 0)],
    (t, p, q) => { p.set(-6, H, -40); q.setFromAxisAngle(Y, t * 0.5); }, { color: IRON, rough: 0.7 });
  // Its post is a child of the disc's visual, so it turns with it.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), (tt.obj as THREE.Mesh).material);
  post.position.set(1.3, 0.8, 0); post.castShadow = true; post.receiveShadow = true;
  tt.obj.add(post);

  // Establishing shots: a slow crane over the terrace, then low beside the pair as they set off.
  const intro: Cutscene = {
    name: 'playground-intro', length: 8.6, skippable: true,
    fades: [{ at: 0, dur: 0, to: 1 }, { at: 0.2, dur: 1.4, to: 0 }],
    shots: [
      { at: 0, dur: 4.2, from: { pos: [15, H + 6.5, 9], look: [0, H + 1, -15], mm: 28 }, to: { pos: [10, H + 4.2, 6.5], look: [-1, H + 0.8, -7], mm: 32 }, ease: 'smooth' },
      { at: 4.2, dur: 4.4, from: { pos: [2.3, H + 0.55, -2.8], look: [0.3, H + 0.35, -0.4], mm: 40, dof: 0.25 }, to: { pos: [2.0, H + 0.5, -2.3], look: [0.2, H + 0.3, -0.9], mm: 42, dof: 0.25 }, ease: 'smooth' },
    ],
    marks: [
      { at: 4.3, who: 'kitten', path: [[0.55, H, 0.6], [0.5, H, -1.3]], speed: 1.1, face: Math.PI },
      { at: 4.7, who: 'knight', path: [[-0.75, H, 0.9], [-0.95, H, -0.9]], speed: 1.0, face: Math.PI },
    ],
  };

  const killZone = new THREE.Box3(new THREE.Vector3(T.minX, -1000, T.pitMinZ), new THREE.Vector3(T.maxX, H - 1.3, T.pitMaxZ));
  return {
    killY: H0 - 30,
    killZones: [killZone],
    intro,
    spawn: {
      kitten: { pos: new THREE.Vector3(0.55, H, 0.6), yaw: Math.PI },
      knight: { pos: new THREE.Vector3(-0.75, H, 0.9), yaw: Math.PI },
    },
  };
}
