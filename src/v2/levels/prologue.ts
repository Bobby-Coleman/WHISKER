// The prologue, "The Hawthorn" (docs/STORY.md): the Grey Moor at dusk after the battle, in rain and fog. Wordless,
// like a Pixar short. The wounded knight limps out of the mist to a lone hawthorn on a rise and slides down against
// its trunk; by the overturned camp wagon a tiny kitten nudges her mother, who will not wake, until a horn far off
// sends her out into the fog. From there she is played: under a cart, over a fallen shield, up a broken plank, toward
// the sound of breathing. She finds him; he lifts his head. She climbs him (the climbing lesson is his body) and curls
// up on his chest; he lifts his gauntlet over her, out of the rain. The night passes. Dawn, horns, torches in the fog.
// The title, and two summers later.
import * as THREE from 'three/webgpu';
import { Simplex2, smoothstep } from '../../world/noise';
import { FIELD_OVERRIDE, PATHS, PUDDLES, STANDING_STONES } from '../../world/layout';
import { LOOK } from '../../render/settings';
import { RAPIER, Physics, L } from '../physics';
import { LevelBuilder, paintMaterial } from '../level';
import { placeProp } from '../props';
import { Campfire, createRain } from '../fx';
import type { LevelInfo } from '../game';
import type { Cutscene } from '../timeline';
import type { LevelModule, StoryContext } from './types';
import { DrivenAvatar } from '../driven';

const n1 = new Simplex2(71), n2 = new Simplex2(83), n3 = new Simplex2(97);
const CAMP = { x: -12.4, z: 23.4 };
const MOTHER = new THREE.Vector3(-12.35, 0, 24.3);
const SEAT = new THREE.Vector3(0, 0, 0.5); // where the knight sits, his back to the trunk
const TRUNK = new THREE.Vector3(0, 0, -0.18);
// The way from the camp to the hawthorn, through the wreckage; obstacles at three points along it.
const ROUTE: [number, number][] = [[-12.6, 24.6], [-11.5, 22.3], [-10.4, 20.3], [-9.6, 18.2], [-8.1, 15.5], [-6.6, 12.8], [-5.2, 10.1], [-3.9, 7.4], [-2.6, 4.6]];
const CART = new THREE.Vector2(-9.6, 18.2), LOG = new THREE.Vector2(-6.6, 12.8), CRATES = new THREE.Vector2(-3.9, 7.4);
const HALF = 1.55; // the lane's half-width

function moor(x: number, z: number) {
  let h = 1.1 * n1.fbm(x / 55, z / 55, 4) + 0.3 * n2.fbm(x / 15, z / 15, 3) + 0.04 * n3.noise(x / 3, z / 3);
  h += smoothstep(60, 360, Math.hypot(x, z - 10)) * (12 + 18 * n2.fbm(x / 220, z / 220, 4));
  return h;
}
const SEG = ROUTE.slice(1).map((p, i) => [ROUTE[i], p]);
function laneDist(x: number, z: number) {
  let d = Infinity;
  for (const [[ax, az], [bx, bz]] of SEG) {
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
  return h;
}

export const prologue: LevelModule = {
  weather: 'dusk',

  prepareField() {
    PATHS.length = 0; PUDDLES.length = 0; STANDING_STONES.length = 0;
    // A churned track along the lane, and the ruts of the camp.
    PATHS.push(ROUTE.map(([x, z]) => ({ x, z })));
    PATHS.push([{ x: -14, z: 30 }, { x: -12.4, z: 25.5 }, { x: -9, z: 26 }]);
    for (const [x, z, rx, rz] of [[-10.6, 21.4, 1.4, 0.8], [-7.4, 14.5, 1.0, 0.7], [-4.6, 9.0, 1.2, 0.6], [2.5, 3.5, 1.6, 0.9], [-15, 18, 2.2, 1.2]] as const) {
      PUDDLES.push({ x, z, rx, rz, rot: x * 0.3 });
    }
    FIELD_OVERRIDE.height = height;
    // Grass keeps off the lane's obstacles and the camp's floor; the moor round them stays rough.
    FIELD_OVERRIDE.exclusion = (x, z) => {
      const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
      // Short turf round the knight (no tall blades in the close shots).
      const ds = 1 - smoothstep(2.2, 3.4, Math.hypot(x - SEAT.x, z - SEAT.z - 0.6));
      return Math.max(Math.max(1 - smoothstep(2.5, 3.5, dc), 1 - smoothstep(0.6, 1.4, laneDist(x, z))) * 0.85, ds);
    };
  },

  async build(physics: Physics, lv: LevelBuilder, scene: THREE.Scene): Promise<LevelInfo> {
    const root = lv.root;
    const H = (x: number, z: number) => height(x, z);
    SEAT.y = H(SEAT.x, SEAT.z); TRUNK.y = H(TRUNK.x, TRUNK.z); MOTHER.y = H(MOTHER.x, MOTHER.z);
    const wood = paintMaterial('#7e6045', 0.85), darkWood = paintMaterial('#5a4331', 0.9), iron = paintMaterial('#3c3e41', 0.55);
    const cloth = paintMaterial('#55302a', 0.95);
    const box = (c: THREE.Vector3, size: [number, number, number], yaw = 0, member = L.world, surface?: any) =>
      physics.addBox(c, new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), surface, member);
    const props: Promise<unknown>[] = [];
    const prop = (id: string, x: number, z: number, o: { yaw?: number; pitch?: number; roll?: number; scale?: number; dy?: number; tint?: Record<string, string> } = {}) =>
      props.push(placeProp(id, { at: [x, H(x, z) + (o.dy ?? 0), z], yaw: o.yaw, pitch: o.pitch, roll: o.roll, scale: o.scale, tint: o.tint }, root));

    // ---- The hawthorn: a twisted tree, autumn-rusty, leaning out over where he will sit.
    prop('nature/TwistedTree_1', TRUNK.x, TRUNK.z, { yaw: 2.35, scale: 0.4, dy: -0.15, tint: { Leaves_TwistedTree: '#9a5a36' } });
    physics.addFixed(RAPIER.ColliderDesc.cylinder(1.4, 0.26).setTranslation(TRUNK.x, TRUNK.y + 1.3, TRUNK.z));
    // Haws on the ground, a few dead trees far out in the fog.
    for (const [x, z, s, id] of [[-24, -14, 0.5, 'DeadTree_2'], [21, -6, 0.45, 'DeadTree_4'], [-30, 20, 0.55, 'DeadTree_4'], [14, 26, 0.5, 'DeadTree_2']] as const) {
      prop(`nature/${id}`, x, z, { yaw: x, scale: s });
    }

    // ---- The lane: invisible walls keep her on it (only her: the knight is not played here); wreckage marks it.
    for (const side of [-1, 1]) {
      for (const [[ax, az], [bx, bz]] of SEG) {
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        const nx = -dz / len * side, nz = dx / len * side;
        const c = new THREE.Vector3((ax + bx) / 2 + nx * HALF, 0, (az + bz) / 2 + nz * HALF);
        c.y = H(c.x, c.z) + 1;
        box(c, [0.2, 2.4, len + 0.4], Math.atan2(dx, dz), L.kittenOnly);
      }
    }
    // Closed behind the camp; open onto the rise at the far end, ringed round the hawthorn.
    box(new THREE.Vector3(-13.6, H_CAMP + 1, 25.6), [4, 2.4, 0.2], -0.5, L.kittenOnly);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const c = new THREE.Vector3(Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2);
      if (laneDist(c.x, c.z) < HALF + 0.6) continue;
      c.y = H(c.x, c.z) + 1;
      box(c, [0.2, 2.4, 2.1], -a, L.kittenOnly);
    }
    // Wreckage along the lane's edges: spears driven into the mud at angles, shields, swords, barrels, crates.
    const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const spearShaft = new THREE.CylinderGeometry(0.014, 0.017, 2.1, 6).translate(0, 1.05, 0);
    const spearTip = new THREE.ConeGeometry(0.03, 0.17, 6).translate(0, 2.18, 0);
    const spear = (x: number, z: number, lean: number, yaw: number, broken = false) => {
      const g = new THREE.Group();
      const s = new THREE.Mesh(spearShaft, wood); s.castShadow = true;
      if (broken) s.scale.y = 0.45 + rng() * 0.3;
      g.add(s);
      if (!broken) { const t = new THREE.Mesh(spearTip, iron); t.castShadow = true; g.add(t); }
      g.position.set(x, H(x, z) - 0.2, z);
      g.rotation.set(lean, yaw, 0, 'YXZ');
      root.add(g);
    };
    for (const [[ax, az], [bx, bz]] of SEG) {
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0.5; s < len; s += 1.6) {
        for (const side of [-1, 1]) {
          const t = s / len, x0 = ax + (bx - ax) * t, z0 = az + (bz - az) * t;
          const nx = -(bz - az) / len * side, nz = (bx - ax) / len * side;
          const off = HALF + 0.25 + rng() * 0.9;
          const x = x0 + nx * off, z = z0 + nz * off;
          const k = rng();
          if (k < 0.32) spear(x, z, 0.15 + rng() * 0.45, rng() * 6.28, rng() < 0.4);
          else if (k < 0.5) prop('props/Shield_Wooden', x, z, { yaw: rng() * 6.28, pitch: -1.2 - rng() * 0.3, dy: 0.12 });
          else if (k < 0.62) prop('props/Sword_Bronze', x, z, { yaw: rng() * 6.28, pitch: 0.2 + rng() * 0.3, roll: rng() * 0.3, dy: -0.18 });
          else if (k < 0.74) prop('props/Barrel', x, z, { yaw: rng() * 6.28, roll: rng() < 0.5 ? Math.PI / 2 : 0, dy: rng() < 0.5 ? 0.35 : 0 });
          else if (k < 0.86) prop('props/Crate_Wooden', x, z, { yaw: rng() * 6.28, roll: rng() < 0.3 ? 0.4 : 0 });
          else prop('nature/Rock_Medium_2', x, z, { yaw: rng() * 6.28, scale: 0.35 + rng() * 0.2, dy: -0.1 });
        }
      }
    }
    // Banners on broken poles, some fallen.
    const pole = new THREE.CylinderGeometry(0.03, 0.035, 3.2, 8).translate(0, 1.6, 0);
    const banner = (x: number, z: number, lean: number, yaw: number, id: string) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(pole, darkWood); m.castShadow = true; g.add(m);
      g.position.set(x, H(x, z) - 0.25, z); g.rotation.set(lean, yaw, 0, 'YXZ');
      root.add(g);
      props.push(placeProp(id, { at: [0, 3.05, 0.04], tint: { MI_Banner: '#8a4a3c' } }, g));
    };
    banner(-6.9, 18.6, 0.22, 0.4, 'props/Banner_1_Cloth');
    banner(-1.2, 10.4, -0.35, 2.2, 'props/Banner_2_Cloth');
    banner(3.4, 6.8, 0.12, -0.6, 'props/Banner_1_Cloth');
    banner(-15.2, 21.0, 0.5, 1.2, 'props/Banner_2_Cloth');
    banner(5.5, -3.0, 0.08, 1.8, 'props/Banner_1_Cloth');

    // ---- The camp: the overturned wagon, a dying fire, things spilled; the mother under a torn banner.
    prop('village/Prop_Wagon', -14.2, 25.4, { yaw: 1.1, roll: Math.PI / 2 - 0.08, dy: 0.95 });
    box(new THREE.Vector3(-14.2, H_CAMP + 0.95, 25.4), [1.6, 1.9, 4.0], 1.1);
    prop('props/Barrel', -10.7, 25.9, { roll: Math.PI / 2, yaw: 0.6, dy: 0.35 });
    prop('props/Crate_Wooden', -13.4, 22.2, { yaw: 0.4 });
    prop('props/Cauldron', -9.6, 24.2, { yaw: 1.0, roll: 0.9, dy: 0.25 });
    prop('props/Bag', -11.2, 26.4, { yaw: 2.2, pitch: -1.3, dy: 0.15 });
    prop('props/Rope_1', -12.8, 22.9, { yaw: 0.8 });
    prop('props/Bucket_Wooden_1', -10.2, 22.8, { yaw: 0.3, roll: 1.4, dy: 0.15 });
    box(new THREE.Vector3(-13.4, H_CAMP + 0.45, 22.2), [0.85, 0.9, 0.9], 0.4, L.detail);
    // The mother: a shape under the banner, her tail out from under it.
    {
      const g = new THREE.Group();
      g.position.set(MOTHER.x, MOTHER.y, MOTHER.z);
      g.rotation.y = 0.5;
      const N = 24, W = 0.95, D = 0.75;
      const geo = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2);
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

    // ---- Obstacle 1, under a cart: a cart bed propped on a wheel and a barrel across the lane; the only way on is
    // underneath it (the bed is 0.5 m up; she is 0.34 m tall).
    {
      const dir = new THREE.Vector2(-8.1 - -10.4, 15.5 - 20.3).normalize();
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
      const broken = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 18).rotateX(Math.PI / 2), darkWood);
      broken.position.set(-2.4, 0.04, 0.9); broken.rotation.set(Math.PI / 2, 0, 0.4); g.add(broken);
      root.add(g);
      g.updateMatrixWorld(true);
      const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.05));
      physics.addBox(new THREE.Vector3(0, 0.6, 0).applyMatrix4(g.matrixWorld), new THREE.Vector3(1.62, 0.12, 0.66), wq);
      physics.addBox(new THREE.Vector3(1.55, 0.46, -0.66).applyMatrix4(g.matrixWorld), new THREE.Vector3(0.46, 0.46, 0.05), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), undefined, L.detail);
      props.push(placeProp('props/Barrel', { at: [-1.45, 0, -0.1], scale: 0.62 }, g));
      physics.addBox(new THREE.Vector3(-1.45, 0.28, -0.1).applyMatrix4(g.matrixWorld), new THREE.Vector3(0.22, 0.28, 0.22), undefined, undefined, L.detail);
    }

    // ---- Obstacle 2, over a fallen shield: a fallen banner pole's log across the lane (too high to step over) and a
    // shield leaning on it like a ramp.
    {
      const dir = new THREE.Vector2(-5.2 - -8.1, 10.1 - 15.5).normalize();
      const across = Math.atan2(dir.y, -dir.x);
      const c = new THREE.Vector3(LOG.x, H(LOG.x, LOG.y), LOG.y);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 3.6, 12).rotateZ(Math.PI / 2), darkWood);
      log.position.set(c.x, c.y + 0.17, c.z); log.rotation.y = across; log.castShadow = true; log.receiveShadow = true;
      root.add(log);
      physics.addFixed(RAPIER.ColliderDesc.capsule(1.6, 0.2).setTranslation(c.x, c.y + 0.17, c.z)
        .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, across, Math.PI / 2, 'YXZ'))), { kind: 'wood' });
      // The shield, leaning on the log on her side of it.
      const sx = c.x - dir.x * 0.42, sz = c.z - dir.y * 0.42;
      const syaw = Math.atan2(dir.x, dir.y);
      props.push(placeProp('props/Shield_Wooden', { at: [sx, c.y + 0.16, sz], yaw: syaw, pitch: -1.05 }, root));
      physics.addBox(new THREE.Vector3(sx, c.y + 0.15, sz), new THREE.Vector3(0.3, 0.02, 0.3),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, syaw, 0, 'YXZ')), { kind: 'wood' }, L.detail);
    }

    // ---- Obstacle 3, up a broken plank: a wall of crates across the lane (too high to jump) and a plank leaning on
    // it that she can climb.
    {
      const dir = new THREE.Vector2(-2.6 - -5.2, 4.6 - 10.1).normalize();
      const yaw = Math.atan2(dir.x, dir.y);
      const g = new THREE.Group();
      g.position.set(CRATES.x, H(CRATES.x, CRATES.y), CRATES.y);
      g.rotation.y = yaw;
      root.add(g);
      for (const [x, s] of [[-1.25, 0], [-0.42, 0.06], [0.42, -0.04], [1.25, 0.08]]) {
        props.push(placeProp('props/Crate_Wooden', { at: [x, 0, 0], yaw: s }, g));
      }
      g.updateMatrixWorld(true);
      // Rough timber: she can climb the crates anywhere; the plank shows the way.
      physics.addBox(new THREE.Vector3(0, 0.44, 0).applyMatrix4(g.matrixWorld), new THREE.Vector3(1.7, 0.45, 0.45), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { climb: true, kind: 'wood' });
      // The plank: a broken board leaning on the middle crates, its face toward her.
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.12, 0.045), paintMaterial('#7e6045', 0.85, 1, 0.16));
      plank.castShadow = true; plank.receiveShadow = true;
      const lean = 0.36;
      // On her side of the crates (local -z), its top resting on the crate's edge.
      plank.position.set(0.1, 0.52, -0.64); plank.rotation.set(lean, 0, 0.04);
      g.add(plank);
      g.updateMatrixWorld(true);
      const pq = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0.04, 'YXZ'));
      physics.addBox(plank.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.31, 0.56, 0.03), pq, { climb: true, kind: 'wood' });
    }

    // ---- The dropped helm and the haws are placed in start() (the helm is his).
    await Promise.all(props);
    void scene;
    return {
      killY: -30,
      killZones: [],
      spawn: {
        kitten: { pos: new THREE.Vector3(-11.75, H(-11.75, 23.55), 23.55), yaw: -0.71 },
        // Out in the fog to the north-east, where he comes from.
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
};

let director: Director | null = null;
let mother: THREE.Group | null = null;

// The story's running: cutscenes, the triggers between them, the fires and rain, the light.
class Director {
  stage: 'title' | 'opening' | 'walk' | 'found' | 'climb' | 'ending' | 'end' = 'title';
  private fires: Campfire[] = [];
  private rain: ReturnType<typeof createRain>;
  private tweens: { get: () => number; set: (v: number) => void; from: number; to: number; t: number; dur: number }[] = [];
  private white: HTMLDivElement;
  private torches: { g: THREE.Group; path: THREE.Vector3[]; t: number }[] = [];
  private hintsShown = new Set<string>();
  // Where she curls up: in his lap, against him.
  private lapTop = new THREE.Vector3();
  private breathT = 3;
  private walkT = 0;
  private answerT = 0;
  private onHim = false;

  constructor(private c: StoryContext) {
    this.rain = createRain(2600);
    c.scene.add(this.rain.mesh);
    this.white = document.createElement('div');
    this.white.style.cssText = 'position:fixed;inset:0;background:#f4f1ea;opacity:0;pointer-events:none;z-index:5';
    document.body.appendChild(this.white);
  }

  private get kitten() { return this.c.game.kitten; }
  private get knight() { return this.c.game.knight; }

  async start() {
    const c = this.c;
    // Heavy dusk fog and the fires.
    LOOK.fogDistance.value = 52;
    for (const [x, z, s] of [[-10.1, 25.1, 1], [-4.9, 12.1, 0.8], [3.6, 5.6, 0.9], [-8.4, 7.8, 0.7], [7.5, -1.5, 1.1]]) {
      const f = new Campfire(new THREE.Vector3(x, height(x, z), z), s);
      c.scene.add(f.group);
      this.fires.push(f);
    }
    // She is a plain kitten still, small and young; he is wounded. Only she is played.
    c.kitten.setBare(true);
    c.game.canSwitch = false;
    c.game.follower.mode = 'wait';
    // Her buttons: move, jump and meow.
    c.padLabel('KeyQ', 'Meow'); c.padLabel('Tab', null); c.padLabel('KeyE', null); c.padLabel('KeyG', null);
    const kn = this.knight;
    kn.motor.collider.setEnabled(false);
    // Her mother's tail out from under the banner: a copy of her own, grown.
    if (mother) {
      const tail = c.kitten.tail.clone(true);
      tail.position.set(0.3, 0.03, 0.08);
      tail.rotation.set(0.1, -Math.PI / 2 + 0.35, Math.PI / 2); // laid on its side: the curl lies along the ground
      tail.scale.setScalar(1.6);
      mother.add(tail);
    }
    // The dropped helm on the slope: a copy of his own.
    const helm = new THREE.Group();
    for (const ch of c.knight.parts.head.children) if ((ch as THREE.Mesh).isMesh) helm.add((ch as THREE.Mesh).clone());
    helm.position.set(-1.6, height(-1.6, 3.3) + 0.12, 3.3);
    helm.rotation.set(1.35, 0.6, 0.25);
    c.scene.add(helm);
    // Seat him now if the opening is skipped straight to play (?stage=...).
  }

  private seat() {
    const c = this.c, kn = this.knight;
    kn.motor.place(SEAT.clone(), 0);
    kn.motor.mode = 'held';
    kn.char.resetPose(kn.ground);
    (this.anim(kn) as any).walkClip = 'Walk_Loop';
    c.knight.wounded = false;
    c.knight.overrideBlend = 1.0;
    c.knight.override = c.knight.poseSlumped;
  }

  private anim(a: { char: unknown }) { return (a.char as DrivenAvatar).anim; }

  // Her voice in the story (the call button plays its own).
  private meow(kind: 'meow' | 'mew' | 'mrrp' | 'cry', gain = 1) {
    this.c.kitten.meow(kind);
    this.c.audio.play(kind, this.kitten.char.body.pos, gain);
  }

  // She called. Lost in the fog, he answers (a breath, a murmur) so she can find him; on him, he stirs.
  heard(_kind: string) {
    const c = this.c;
    if (this.answerT > 0) return;
    const d = this.kitten.char.body.pos.distanceTo(SEAT);
    if (this.stage === 'walk' && d < 24) {
      this.answerT = 2.2;
      const g = THREE.MathUtils.clamp(1.6 - d / 16, 0.25, 1.4);
      setTimeout(() => { c.audio.play('hum', SEAT.clone().add(new THREE.Vector3(0, 1, 0)), g * 1.4); c.audio.play('breath', SEAT, g); }, 900);
    } else if (this.stage === 'climb') {
      this.answerT = 2.2;
      const head = new THREE.Vector3(0, 0.14, 0).applyMatrix4(c.knight.parts.head.matrixWorld);
      setTimeout(() => { c.audio.play('hum', head, 1.2); c.knight.headUp = 1; }, 600);
    }
  }

  // His body, as she can climb it: boots and shins and thighs she can walk up, his lap, then the breastplate (a
  // face she climbs) to the hollow under his chin.
  private bodyColliders() {
    const c = this.c, P = c.knight.parts, physics = c.physics;
    // The pose in full, to measure from.
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
    // A walkway whose top runs from a to b (world), `width` across: the way she goes along a limb. A little wider than
    // the limb itself, so a kitten can keep her feet on it.
    const W = (p: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(p.matrixWorld);
    const plank = (a: THREE.Vector3, b: THREE.Vector3, width: number, thick: number, surface: any) => {
      const dir = b.clone().sub(a), len = dir.length();
      dir.divideScalar(len);
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const n = new THREE.Vector3().crossVectors(side, dir);
      // (-side, n, dir) is right-handed: side x n is -dir.
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side.clone().negate(), n, dir));
      const c = a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, -thick / 2);
      physics.addBox(c, new THREE.Vector3(width / 2, thick / 2, len / 2), q, surface, L.detail);
    };
    // Along each leg: boot top, up the shin to the knee, down the thigh to the hip. His right leg (the lower) walks;
    // the raised left is a jump onto the knee.
    for (const [ft, sh, th] of [[P.footL, P.shinL, P.thighL], [P.footR, P.shinR, P.thighR]]) {
      const ankle = W(ft, 0, 0.07, 0), knee = W(sh, 0, 0, 0).add(new THREE.Vector3(0, 0.075, 0)), hip = W(th, 0, 0, 0).add(new THREE.Vector3(0, 0.1, 0));
      plank(ankle, knee, 0.22, 0.1, { kind: 'leather' });
      // The thigh to most of the way up: his lap between them is its own (lower) box.
      plank(knee, knee.clone().lerp(hip, 0.75), 0.22, 0.12, { kind: 'cloth' });
    }
    for (const ft of [P.footL, P.footR]) add(ft, RAPIER.ColliderDesc.cuboid(0.07, 0.06, 0.13), new THREE.Vector3(0, -0.02, 0.07), { kind: 'leather' });
    // His lap, across both thighs.
    const lap = W(P.pelvis, 0, 0, 0);
    physics.addBox(lap.clone().add(new THREE.Vector3(0, 0.02, 0.12)), new THREE.Vector3(0.21, 0.08, 0.17), undefined, { kind: 'cloth' }, L.detail);
    add(P.chest, RAPIER.ColliderDesc.cuboid(0.17, 0.23, 0.12), new THREE.Vector3(0, 0.2, 0.02), { climb: true, kind: 'metal' });
    add(P.head, RAPIER.ColliderDesc.ball(0.15), new THREE.Vector3(0, 0.14, 0));
    this.lapTop.copy(lap).add(new THREE.Vector3(0, 0.1, 0.14));
  }

  private tween(get: () => number, set: (v: number) => void, to: number, dur: number) {
    this.tweens.push({ get, set, from: get(), to, t: 0, dur });
  }

  // ---- The opening: him limping in, her at the camp, the horn.
  opening(c: StoryContext) {
    this.stage = 'opening';
    const kn = this.knight;
    kn.motor.mode = 'held';
    c.knight.wounded = true;
    const anim = this.anim(kn);
    anim.walkClip = 'Zombie_Walk_Fwd_Loop'; anim.walkSpeed = 0.75;
    c.kitten.overrideBlend = 6;
    c.kitten.override = c.kitten.poseNudge;
    const H = height;
    const kp = () => kn.char.body.pos;
    // About six metres of limping, out of the mist to the tree (eight seconds).
    const walk: [number, number, number][] = [[4.3, H(4.3, -3.9), -3.9], [2.1, H(2.1, -1.3), -1.3], [0.9, H(0.9, 0.8), 0.8], [SEAT.x, SEAT.y, SEAT.z]];
    const cs: Cutscene = {
      name: 'opening', length: 38.5, skippable: true,
      fades: [{ at: 0, dur: 0, to: 1 }, { at: 0.5, dur: 3.0, to: 0 }],
      shots: [
        // The battlefield in the last light: fires in the fog, the hawthorn on its rise.
        { at: 0, dur: 8, from: { pos: [-22, H(-22, 30) + 8.5, 31], look: [-3, H(-3, 6) + 1.2, 6], mm: 30 }, to: { pos: [-15.5, H(-15.5, 24) + 5.0, 24.5], look: [-1, H(-1, 3) + 1.6, 2], mm: 33 }, ease: 'smooth' },
        // Out of the mist, limping, a hand to his side.
        // (Ahead of him and to his right, so the tree stays out of the lens; he comes toward us out of the fog.)
        { at: 8, dur: 8, from: { pos: () => kp().clone().add(new THREE.Vector3(0.4, 1.15, 3.6)), look: () => kp().clone().add(new THREE.Vector3(0, 1.15, 0)), mm: 38 }, to: { pos: () => kp().clone().add(new THREE.Vector3(1.2, 1.0, 3.0)), look: () => kp().clone().add(new THREE.Vector3(0, 1.1, 0)), mm: 40 }, ease: 'linear', handheld: 1.4 },
        // He reaches the tree and slides down against it.
        { at: 16, dur: 6, from: { pos: [-2.6, SEAT.y + 1.1, 3.6], look: [0, SEAT.y + 0.85, 0.4], mm: 40 }, to: { pos: [-2.2, SEAT.y + 0.8, 3.2], look: [0, SEAT.y + 0.55, 0.45], mm: 42, dof: 0.2 }, ease: 'smooth' },
        // The ribbon on his sword's grip.
        { at: 22, dur: 4, from: { pos: [-0.95, SEAT.y + 0.32, 1.45], look: [-0.36, SEAT.y + 0.07, 0.6], mm: 55, dof: 0.7 }, to: { pos: [-0.85, SEAT.y + 0.26, 1.3], look: [-0.36, SEAT.y + 0.06, 0.6], mm: 58, dof: 0.7 }, ease: 'smooth' },
        // At the camp: the kitten and the still shape under the banner.
        { at: 26, dur: 7.5, from: { pos: [-10.55, H_CAMP + 0.42, 24.9], look: [-12.05, H_CAMP + 0.1, 23.95], mm: 45, dof: 0.45 }, to: { pos: [-10.75, H_CAMP + 0.36, 24.6], look: [-12.05, H_CAMP + 0.12, 23.95], mm: 48, dof: 0.45 }, ease: 'smooth' },
        // She goes out into the fog, toward the lane.
        { at: 33.5, dur: 5, from: { pos: [-12.9, H_CAMP + 0.5, 25.3], look: [-11.3, H_CAMP + 0.15, 22.4], mm: 38 }, to: { pos: [-12.5, H_CAMP + 0.55, 24.6], look: [-10.9, H_CAMP + 0.2, 21.4], mm: 38 }, ease: 'smooth', blend: 0.8 },
      ],
      marks: [
        { at: 8, who: 'knight', path: walk, speed: 0.75, face: 0 },
        { at: 33.6, who: 'kitten', path: [[-11.75, H_CAMP, 23.55], [-11.45, H(-11.45, 22.6), 22.6], [-11.1, H(-11.1, 21.6), 21.6]], speed: 0.7, face: Math.atan2(0.5, -1) },
      ],
      cues: [
        { at: 0.2, run: () => this.c.audio.play('caw', new THREE.Vector3(-4, 3, 4), 1), onSkip: false },
        { at: 16.6, run: () => { anim.walkClip = 'Walk_Loop'; anim.walkSpeed = null; this.seat(); } },
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
    c.hud.objective('Follow the sound of breathing.');
    c.hud.say(c.touch() ? 'The stick moves her. Meow, and listen.' : 'WASD moves her; the mouse turns the camera. Q: meow, and listen.', 7);
  }

  // ---- She finds him; he lifts his head.
  private found() {
    const c = this.c;
    this.stage = 'found';
    c.hud.objective(null);
    const kpos = this.kitten.char.body.pos.clone();
    const head = new THREE.Vector3(0, 0.14, 0).applyMatrix4(c.knight.parts.head.matrixWorld);
    // She comes to a spot before his boots; the shots are set from him, not from wherever she arrived.
    const spot = new THREE.Vector3(SEAT.x + 0.08, 0, SEAT.z + 1.32);
    spot.y = c.physics.groundY(spot.x, spot.y + 3, spot.z, 6) ?? height(spot.x, spot.z);
    const face = spot.clone().add(new THREE.Vector3(0, 0.245, 0));
    const cs: Cutscene = {
      name: 'found', length: 12, skippable: true,
      shots: [
        // Low behind her: the knight above, his head down.
        { at: 0, dur: 5, from: { pos: [SEAT.x - 1.0, SEAT.y + 0.36, SEAT.z + 3.4], look: [SEAT.x, SEAT.y + 0.5, SEAT.z + 0.2], mm: 30 }, to: { pos: [SEAT.x - 0.85, SEAT.y + 0.34, SEAT.z + 3.05], look: [SEAT.x, SEAT.y + 0.62, SEAT.z + 0.1], mm: 32 }, ease: 'smooth' },
        // His helm, looking down at her.
        { at: 5, dur: 3.5, from: { pos: head.clone().add(new THREE.Vector3(0.75, 0.12, 0.85)), look: head, mm: 48, dof: 0.35 }, to: { pos: head.clone().add(new THREE.Vector3(0.68, 0.08, 0.78)), look: head, mm: 50, dof: 0.35 }, ease: 'smooth' },
        // Her, looking up at him.
        { at: 8.5, dur: 3.5, from: { pos: face.clone().add(new THREE.Vector3(0.17, -0.025, -0.5)), look: face, mm: 52, dof: 0.6 }, to: { pos: face.clone().add(new THREE.Vector3(0.14, -0.025, -0.44)), look: face, mm: 55, dof: 0.6 }, ease: 'smooth' },
      ],
      marks: [{ at: 0, who: 'kitten', path: [[kpos.x, kpos.y, kpos.z], [spot.x, spot.y, spot.z]], speed: 0.9, face: Math.PI }],
      cues: [
        { at: 0.5, run: () => this.meow('mew', 0.9), onSkip: false },
        { at: 1.4, run: () => { c.knight.headUp = 1; } },
        { at: 2.5, run: () => c.audio.play('breath', SEAT, 1.2), onSkip: false },
        { at: 3.6, run: () => this.meow('meow', 1), onSkip: false },
        { at: 6.2, run: () => c.audio.play('hum', head, 1.3), onSkip: false },
        { at: 9.3, run: () => this.meow('mrrp', 1), onSkip: false },
      ],
      onEnd: () => {
        this.stage = 'climb';
        c.hud.objective('Climb up to him.');
        c.hud.say('Up onto his boot and along his leg to his lap; then run into his breastplate to climb it.', 7);
      },
    };
    c.timeline.play(cs);
  }

  // ---- She curls up on his chest; his gauntlet over her; the night; dawn; the title.
  private ending() {
    const c = this.c;
    this.stage = 'ending';
    c.hud.objective(null);
    c.game.kitten.climber.drop();
    // Across his lap (she lies along -x from her hips, so her middle is at the lap's middle).
    const spot = this.lapTop.clone().add(new THREE.Vector3(0.05, 0, 0));
    const head = new THREE.Vector3(0, 0.14, 0).applyMatrix4(c.knight.parts.head.matrixWorld);
    // High over his right knee, down into his lap.
    const over = spot.clone().add(new THREE.Vector3(-0.55, 0.8, 0.74));
    const cs: Cutscene = {
      name: 'ending', length: 42, skippable: false,
      shots: [
        { at: 0, dur: 9, from: { pos: over, look: spot.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 42, dof: 0.35 }, to: { pos: spot.clone().add(new THREE.Vector3(-0.46, 0.72, 0.63)), look: spot.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 46, dof: 0.35 }, ease: 'smooth', blend: 1.2 },
        // Wide: the hawthorn, the two of them, the night coming down.
        { at: 9, dur: 12, from: { pos: [-4.6, SEAT.y + 1.6, 6.2], look: [0, SEAT.y + 1.1, 0.4], mm: 35 }, to: { pos: [-4.0, SEAT.y + 1.4, 5.4], look: [0, SEAT.y + 1.0, 0.4], mm: 36 }, ease: 'linear' },
        // Dawn: torches in the fog, coming.
        { at: 21, dur: 12, from: { pos: [2.5, SEAT.y + 1.2, 4.2], look: [-1.5, SEAT.y + 1.4, -12], mm: 36 }, to: { pos: [2.0, SEAT.y + 1.1, 3.6], look: [-1, SEAT.y + 1.3, -8], mm: 38 }, ease: 'smooth' },
        { at: 33, dur: 9, from: { pos: spot.clone().add(new THREE.Vector3(-0.45, 0.66, 0.56)), look: spot.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 48, dof: 0.4 }, to: { pos: spot.clone().add(new THREE.Vector3(-0.38, 0.58, 0.48)), look: spot.clone().add(new THREE.Vector3(0, 0.05, 0)), mm: 52, dof: 0.4 }, ease: 'smooth' },
      ],
      // Curled across his lap, under the breastplate.
      marks: [{ at: 0, who: 'kitten', path: [[spot.x, spot.y, spot.z]], speed: 1, face: -Math.PI / 2, probe: 0.01 }],
      cues: [
        { at: 0.3, run: () => this.meow('mrrp', 0.8) },
        { at: 0.6, run: () => { c.kitten.overrideBlend = 2.5; c.kitten.override = c.kitten.poseCurled; } },
        // His hand over her; she purrs.
        { at: 5.8, run: () => c.audio.play('purr', spot, 1.1) },
        { at: 9.2, run: () => c.audio.play('purr', spot, 0.7) },
        { at: 1.0, run: () => { c.knight.headUp = 0.55; } },
        // He laughs once, and it turns into a cough.
        { at: 3.2, run: () => { c.knight.headUp = 0.8; c.audio.play('breath', head, 1.4); } },
        { at: 3.7, run: () => { c.knight.headUp = 0.5; c.audio.play('thud', head, 0.15); } },
        { at: 5.0, run: () => { c.knight.shelter = 1; } },
        // The night passes.
        { at: 10, run: () => { this.tween(() => this.c.renderer.toneMappingExposure, (v) => { this.c.renderer.toneMappingExposure = v; }, 0.32, 5); for (const f of this.fires) this.tween(() => f.heat, (v) => { f.heat = v; }, 0.25, 6); } },
        { at: 15.5, run: () => this.c.audio.play('caw', new THREE.Vector3(-6, 4, -2), 0.5) },
        // Dawn: the light warms, horns, torches.
        { at: 19, run: () => { this.tween(() => this.c.renderer.toneMappingExposure, (v) => { this.c.renderer.toneMappingExposure = v; }, 1.3, 6); this.tween(() => this.rain.amount.value as number, (v) => { this.rain.amount.value = v; }, 0.15, 6); this.torchesCome(); } },
        { at: 21.5, run: () => this.c.audio.play('horn', new THREE.Vector3(-3, 5, -40), 1.2) },
        { at: 26, run: () => this.c.audio.play('horn', new THREE.Vector3(6, 5, -35), 1.0) },
        { at: 36, run: () => this.tween(() => parseFloat(this.white.style.opacity || '0'), (v) => { this.white.style.opacity = String(v); }, 1, 4.5) },
      ],
      onEnd: () => this.title(),
    };
    c.timeline.play(cs);
  }

  private torchesCome() {
    for (const [sx, sz, dx] of [[-6, -26, 0], [-2, -28, 1.2], [3, -27, -0.8], [7, -25, 0.4]]) {
      const g = new THREE.Group();
      const flame = new Campfire(new THREE.Vector3(0, 0, 0), 0.35);
      flame.group.position.set(0, 1.7, 0);
      g.add(flame.group);
      this.fires.push(flame);
      g.position.set(sx, height(sx, sz), sz);
      this.c.scene.add(g);
      this.torches.push({ g, path: [new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx * 0.4 + dx, 0, -9)], t: 0 });
    }
  }

  // The title on the white, in dark type; then the line that leads on; then the panel.
  private title() {
    this.stage = 'end';
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;color:#2b2622;font-family:"Cormorant Garamond",Georgia,serif;text-align:center;transition:opacity 2.2s;opacity:0;padding:0 16px';
    t.innerHTML = '<div style="font-size:clamp(44px,9vw,104px);letter-spacing:.2em;padding-left:.2em">WHISKER</div>';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '1'; }, 300);
    setTimeout(() => { t.style.opacity = '0'; }, 6000);
    setTimeout(() => { t.innerHTML = '<div style="font-size:clamp(20px,2.8vw,32px);font-style:italic;letter-spacing:.04em">Two summers later.</div>'; t.style.opacity = '1'; }, 8400);
    setTimeout(() => { t.style.opacity = '0'; }, 12400);
    setTimeout(() => {
      t.remove();
      this.white.style.transition = 'opacity 3s'; this.white.style.opacity = '0';
      this.endPanel();
    }, 14600);
  }

  private endPanel() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(12,13,13,.82);color:#ece8de;font:16px Georgia,serif;z-index:7;text-align:center;padding:24px';
    d.innerHTML = `<div style="font-size:clamp(22px,3vw,34px);letter-spacing:.14em;text-transform:uppercase">End of the prologue</div>
      <div style="opacity:.8;font-style:italic;max-width:34em">Chapter One, the Watch-House, comes next.</div>`;
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:15px Georgia,serif;background:rgba(236,232,222,.08);color:#ece8de;border:1px solid rgba(236,232,222,.4);border-radius:3px;padding:9px 18px;cursor:pointer;min-width:260px';
      b.onclick = fn;
      d.appendChild(b);
    };
    btn('Play the prologue again', () => location.reload());
    btn('Engine test course', () => { const u = new URL(location.href); u.searchParams.set('level', 'test'); location.href = u.toString(); });
    btn('The old version (five chapters)', () => { const u = new URL(location.href); u.searchParams.delete('v2'); u.searchParams.delete('level'); location.href = u.toString(); });
    document.body.appendChild(d);
  }

  update(dt: number, t: number, c: StoryContext) {
    for (const f of this.fires) f.update(dt, t, c.camera);
    for (const tw of this.tweens) {
      tw.t += dt;
      const a = Math.min(1, tw.t / tw.dur), e = a * a * (3 - 2 * a);
      tw.set(tw.from + (tw.to - tw.from) * e);
    }
    this.tweens = this.tweens.filter((tw) => tw.t < tw.dur);
    for (const tc of this.torches) {
      tc.t = Math.min(1, tc.t + dt / 14);
      const p = tc.path[0].clone().lerp(tc.path[1], tc.t);
      tc.g.position.set(p.x, height(p.x, p.z), p.z);
    }
    this.answerT = Math.max(0, this.answerT - dt);
    if (c.timeline.playing) return;
    const kp = this.kitten.char.body.pos;
    // His slow breathing, heard as she comes near.
    if (this.stage === 'walk' || this.stage === 'climb') {
      this.breathT -= dt;
      const d = kp.distanceTo(SEAT);
      if (this.breathT < 0 && d < 16) { this.breathT = 4.5 + Math.random() * 2; c.audio.play('breath', SEAT, THREE.MathUtils.clamp(1.4 - d / 14, 0.15, 1.2)); }
    }
    if (this.stage === 'walk') {
      // Hints where each lesson is.
      const near = (p: THREE.Vector2, r: number) => Math.hypot(kp.x - p.x, kp.z - p.y) < r;
      if (near(CART, 2.6) && !this.hintsShown.has('cart')) { this.hintsShown.add('cart'); c.hud.say('Under the cart.', 4); }
      if (near(LOG, 2.4) && !this.hintsShown.has('log')) { this.hintsShown.add('log'); c.hud.say(c.touch() ? 'Jump: the Jump button (hold it to jump higher).' : 'Space jumps; hold it to jump higher. The shield makes a step.', 6); }
      if (near(CRATES, 2.4) && !this.hintsShown.has('crates')) { this.hintsShown.add('crates'); c.hud.say('Too high to jump. Run into the plank to climb it.', 6); }
      // Slow to find him: remind her she can call.
      this.walkT += dt;
      if (this.walkT > 50 && !this.hintsShown.has('call')) { this.hintsShown.add('call'); c.hud.say(c.touch() ? 'Lost? Meow, and listen for him.' : 'Lost? Q to meow, and listen for him.', 6); }
      if (Math.hypot(kp.x - SEAT.x, kp.z - (SEAT.z + 0.9)) < 1.7) this.found();
    } else if (this.stage === 'climb') {
      // Up on him at last (his boot, his knee): she greets him.
      if (!this.onHim && this.kitten.motor.grounded && kp.y > SEAT.y + 0.1 && Math.hypot(kp.x - SEAT.x, kp.z - SEAT.z) < 1.0) { this.onHim = true; this.meow('mrrp', 1); }
      // In his lap (or up his breastplate): the ending.
      if (kp.distanceTo(this.lapTop) < 0.36 || (this.kitten.char.body.climb && kp.distanceTo(this.lapTop) < 0.8)) this.ending();
    }
  }
}

// Debug: jump straight to a part of the prologue (__v2.story(stage)).
export function debugStage(c: StoryContext, stage: string) {
  if (!director) return;
  c.timeline.skip();
  const d = director as any;
  if (stage === 'walk') { d.seat(); d.startWalk(); }
  if (stage === 'found' || stage === 'climb' || stage === 'ending') {
    d.seat(); d.startWalk();
    c.game.kitten.motor.place(new THREE.Vector3(SEAT.x - 0.3, height(SEAT.x - 0.3, SEAT.z + 1.6), SEAT.z + 1.6), Math.PI);
    if (stage !== 'found') { d.stage = 'climb'; c.knight.headUp = 1; }
    if (stage === 'ending') d.ending();
  }
}
