// Chapter One, "The Road to the Castle" (v3). A bright windy morning on the moor: Sir Bram and Whisker walk a glen
// toward the castle on its crag, always in view at the head of it. Seven beats, each built on what one of them can
// do and the other can't (docs/research/coop-puzzles.md):
//   1 the Field Wall: a gate tied shut from the far side; she climbs the ivy and lifts the rope loop.
//   2 the Ditch: too wide to jump; he swings a fallen trunk round its roots into the far bank's notches.
//   3 the Sheepfold: walls too high and too smooth; he throws her over, she pulls the bar's pin, he shoulders the
//     swollen gate. A creep hole she can knock open from inside.
//   4 the Mill Stream: a deep channel he can't wade; she swims it, climbs the mill's timbers and knocks out the pin
//     that holds the bridge's leaf up.
//   5 the Windy Ridge: gusts that blow her off the crest; rocks, his lee and a hay cart for shelter.
//   6 the Tor Gap (the twist): too wide to throw her across, unless a gust carries her.
//   7 the Castle Gate: she swims the moat and climbs the counterweight chain; the drawbridge falls; he heaves the
//     portcullis up and holds it while she throws the catch.
// Travel is toward -z; the wind blows toward +x (across the ridge, and along the throw at the tor).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Level, Ctx } from './types';
import type { Cutscene } from '../timeline';
import type { Actor } from '../game';
import type { Usable, Plate } from '../interact';
import { Terrain } from '../world/terrain';
import { Water } from '../world/water';
import { Kit, ivy, stone } from '../world/kit';
import { WATER } from '../motor';
import { PAL, col, toy, metal } from '../render/materials';
import { Simplex2 } from '../../world/noise';
import { forest, TREES, boulders, flowers, banner, aimBanner, bushes, rng } from '../world/foliage';
import { Smoke, Crows, WindStreaks } from '../world/fx';
import { RAPIER, L } from '../physics';
import { WIND } from '../body';
import { dynamic, mergeStatic } from '../world/merge';
import { Hinge, EASE, plankLeaf, pinMesh, handleMesh, Rope, Gusts, shelteredAt, PIN_PINK, HIS_BLUE } from '../world/mech';

const n1 = new Simplex2(311), n2 = new Simplex2(353), n3 = new Simplex2(397);
const water = new Water();
const sm = THREE.MathUtils.smoothstep, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

// ---- The layout (z of each beat), shared by the land, the build and the director.
const Z = { wall: -28, ditch: -62, fold: -105, stream: -140, ridge0: -176, ridge1: -240, torS: -252, moatN: -288, moatS: -296 };
const STREAM_LEVEL = -0.3;
const MOAT_LEVEL = 4.6;
const HIGH = 6; // the ridge, the tor and the castle's plateau
const BRIDGE_X = -6;
const GATE_X = 16;
// The glen's half-width down its length (z, half-width), linear between.
const HW: [number, number][] = [[60, 46], [-6, 46], [-21, 14], [-36, 14], [-46, 17], [-74, 17], [-80, 24], [-92, 24], [-98, 12.5], [-112, 12.5], [-118, 18], [-152, 18], [-160, 14], [-180, 14]];
const BEATS = [Z.wall, Z.ditch, Z.fold, Z.stream];

function table(z: number, T: [number, number][]) {
  if (z >= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (z >= T[i][0]) { const [z0, a] = T[i - 1], [z1, b] = T[i]; return lerp(a, b, (z0 - z) / (z0 - z1)); }
  return T[T.length - 1][1];
}
// A low wind-cut bank keeps the route readable without enclosing the field in a canyon. Its short inner
// face still exceeds the motor's climbing slope; beyond that, rolling heather rises slowly into the fog.
// The rocky ridge and castle keep their old high outer silhouettes.
const hill = (d: number, x: number, z: number) => {
  if (d <= 0) return 0;
  const n = n2.fbm(x / 60, z / 60, 2) * sm(d, 4, 16);
  const low = Math.min(d * 1.55, 4.0 + d * 0.08) + 1.3 * n;
  const crag = Math.min(d * 1.8, 6.5 + d * 0.5) + 4 * n;
  return lerp(low, crag, sm(-z, 145, 176));
};
// The stream's bed across z: a deep channel between two shallow shelves, banks rising out to the meadow.
function streamBed(z: number) {
  const d = Math.abs(z - Z.stream);
  if (d < 1.5) return -2.3;
  if (d < 3.5) return -1.0;
  if (d < 5.5) return -1.0 + (d - 3.5) / 2;
  return 0;
}
// A boulder: a unit icosphere pushed about into a lumpy, faceted rock (about 1.8 across before scaling).
const rockGeos = new Map<number, THREE.BufferGeometry>();
function rockGeo(seed: number) {
  const k = seed % 5;
  let g = rockGeos.get(k);
  if (g) return g;
  g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = 1 + 0.16 * n3.noise(v.x * 1.7 + k * 3, v.z * 1.7 + v.y * 1.3) + 0.08 * Math.sin(v.y * 4 + k);
    v.multiplyScalar(f); v.y = Math.max(v.y, -0.92);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  rockGeos.set(k, g);
  return g;
}

// How near a beat (flat ground there).
const nearBeat = (z: number) => Math.max(...BEATS.map((b) => 1 - sm(Math.abs(z - b), 10, 18)));

export function height(x: number, z: number) {
  const noise = 0.3 * n1.fbm(x / 34, z / 34, 2) + 0.06 * n3.noise(x / 6, z / 6);
  // The glen, from the field up to the ridge.
  if (z > Z.ridge0 + 4) {
    const w = table(z, HW);
    const floor = HIGH * sm(-z, 152, 176);
    let h = floor + noise * (1 - nearBeat(z)) * (z > -12 ? 1.3 : 0.7);
    // The ditch, the stream.
    const dd = Math.abs(z - Z.ditch);
    if (dd < 5) h -= 1.3 * (1 - sm(dd, 2.2, 3.6));
    h += streamBed(z);
    return h + hill(Math.abs(x) - w, x, z);
  }
  const ridge = (xx: number) => {
    if (xx < -2) return Math.max(-2, HIGH - (-2 - xx) * 1.6) + Math.max(0, -13 - xx) * 1.7;
    if (xx <= 2) return HIGH;
    if (xx < 28) return Math.max(-2, HIGH - (xx - 2) * 1.6);
    return -2 + (xx - 28) * 1.7;
  };
  // The ridge (blending out of the glen at its north end), and on past it the tor's near side.
  if (z > Z.ridge1) {
    const glen = HIGH + hill(Math.abs(x) - 14, x, z);
    const t = sm(-z, -(Z.ridge0 + 4), -(Z.ridge0 - 3));
    return lerp(glen, ridge(x) + noise * 0.25 * (x < -2 ? 1 : 0), t);
  }
  // Past the ridge: the tor. West of the gap a rock mass; the gap's floor; east, the plateau to the castle.
  if (z > Z.torS && x < 7) return x < 3 ? ridge(x) : -2;
  if (z > Z.torS - 4 && x < 7) return 15 + 3 * n2.noise(x / 9, z / 9);
  // The plateau and the castle: walled in by hills either side.
  const x0 = z > Z.torS - 4 ? 7 : -6, x1 = z > Z.torS - 4 ? 28 : 38;
  let h = HIGH + noise * 0.25 * sm(-z, 250, 258) * (1 - sm(-z, 280, 287));
  // The moat.
  if (z <= Z.moatN && z >= Z.moatS && x > -8 && x < 40) h = -0.5;
  const out = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  return h + hill(out, x, z) + (z < -344 ? Math.min((-344 - z) * 1.7, 4 + (-344 - z) * 0.25) : 0);
}

// The road: a dirt track through every crossing.
const TRACK: [number, number][] = [[0, 40], [-0.5, 10], [0, Z.wall + 2], [0, Z.wall - 2], [-2.5, -44], [2.6, Z.ditch + 3], [2.6, Z.ditch - 3.5], [0, -84], [0, Z.fold + 4], [0, Z.fold - 5], [-3, -122], [BRIDGE_X, Z.stream + 6], [BRIDGE_X, Z.stream - 6], [-2, -158], [0, Z.ridge0], [0, -244], [6, -246], [11, -247], [GATE_X, -262], [GATE_X, -287]];
function trackDist(x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < TRACK.length; i++) {
    const [ax, az] = TRACK[i - 1], [bx, bz] = TRACK[i];
    const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best + n3.noise(x / 3, z / 3) * 0.35;
}
// Ground that structures cover flush (no grass through them).
const BARE: [number, number, number, number][] = [
  [-3.2, Z.ridge1 - 12.2, 3.2, Z.ridge1 + 0.2], [6.8, Z.ridge1 - 16.2, 13.2, Z.ridge1 + 1.8], // the tor's blocks
  [-4.5, Z.fold - 4.5, 4.5, Z.fold + 4.5], // the fold
  [-3.3, Z.stream - 9.3, 4.4, Z.stream - 2.3], // the mill
  [-9, -342, 41, Z.moatS - 0.1], [-9, Z.moatN - 0.3, 41, Z.moatN + 2.2], // the castle, the moat's near wall
];
const bare = (x: number, z: number) => BARE.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

// Each checkpoint: where both stand, and which puzzles are done by then.
type State = { gate: boolean; root: boolean; trunk: boolean; bar: boolean; fold: boolean; stone: boolean; ballast: boolean; brake: boolean; mill: boolean; cart: boolean; tor: boolean; draw: boolean; latched: boolean };
const ORDER = ['start', 'ditch', 'fold', 'mill', 'ridge', 'tor', 'castle'] as const;
type CP = typeof ORDER[number];
const SPAWN: Record<CP, { at: [number, number]; yaw: number }> = {
  start: { at: [-0.5, 24], yaw: Math.PI },
  ditch: { at: [-1, -40], yaw: Math.PI },
  fold: { at: [0, -88], yaw: Math.PI },
  mill: { at: [-4, -122], yaw: Math.PI },
  ridge: { at: [0, -172], yaw: Math.PI },
  tor: { at: [0, -237.5], yaw: Math.PI },
  castle: { at: [GATE_X, -264], yaw: Math.PI },
};
// The z the leader passes to save each checkpoint.
const SAVE_AT: [CP, number][] = [['ditch', Z.wall - 5], ['fold', -84], ['mill', -118], ['ridge', -168], ['tor', -236], ['castle', -258]];

const LINES = {
  intro: ['There’s the castle, Whisker. No lamps in the windows.', 'Every knight was called home. Stay close. This wind carries strange things.'],
  wall: 'Clever girl. What would I do without you?',
  ditch: 'There. After you, my lady.',
  fold: 'Never met a gate I couldn’t argue with.',
  mill: 'You swim like an otter. Don’t tell the other cats.',
  ridge: 'Mind the wind up here. Keep behind the rocks, or behind me.',
  tor: 'A flying cat. Now I’ve seen everything.',
  moat: 'Bridge is up, and nobody on the walls. Can you get in, little one?',
  draw: 'Ha! That’s my girl!',
  end: ['No watchmen. No welcome. Just that bell.', 'Then we’ll find them. Together.'],
};

class Director {
  state: State = { gate: false, root: false, trunk: false, bar: false, fold: false, stone: false, ballast: false, brake: false, mill: false, cart: false, tor: false, draw: false, latched: false };
  cp: CP = 'start';
  stage: 'title' | 'intro' | 'play' | 'end' = 'title';
  hints = new Set<string>();
  gusts = new Gusts(4.5, 1.0, 1.5);
  streaks = new WindStreaks(70);
  banners: THREE.Object3D[] = [];
  crows: Crows;
  smokes: Smoke[] = [];
  // Mechanisms.
  gate!: Hinge; trunk!: Hinge; foldGate!: Hinge; leaf!: Hinge; cart!: Hinge; torBridge!: Hinge; draw!: Hinge; port!: Hinge; wheel!: THREE.Object3D; drum!: THREE.Object3D;
  loop!: THREE.Object3D; bar!: THREE.Object3D; stoneObj!: THREE.Object3D; stoneCol!: RAPIER.Collider; millRope!: Rope; torRope!: Rope; drawChains: Rope[] = [];
  catchObj!: THREE.Object3D; trunkRamps: RAPIER.Collider[] = [];
  rootWedge!: THREE.Object3D;
  ballast!: Hinge; millPlate!: Plate; winch!: THREE.Object3D; braceRope!: Rope;
  plates: Omit<Plate, 'pressed'>[] = [];
  get millBraced() { return this.state.mill || this.ballast?.p >= 0.98 || !!this.millPlate?.pressed; }
  rattle = 0; rattleGate: Hinge | null = null;
  holding = false;
  lastShelter = new THREE.Vector3();
  shortThrows = 0;
  ivyT = 0; deepT = 0;
  private lastBrace: boolean | null = null;
  private throwPoints = new Float32Array(36 * 3);
  private throwArc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#e2d5ad', transparent: true, opacity: 0.7, depthWrite: false }));
  constructor(private c: Ctx) {
    this.crows = new Crows(new THREE.Vector3(GATE_X, HIGH + 22, -322), 5, 14);
  }
  // Things to do a moment later, on the game's clock (paused with it, stepped with it).
  private timers: { t: number; fn: () => void }[] = [];
  after(t: number, fn: () => void) { this.timers.push({ t, fn }); }
  // Usables are made with the level and handed to the game once it exists.
  usables: Usable[] = [];
  use(u: Usable) { this.usables.push(u); return u; }
  get k() { return this.c.game.kitten; }
  get n() { return this.c.game.knight; }
  H(x: number, z: number) { return height(x, z); }
  P(x: number, z: number, dy = 0): [number, number, number] { return [x, this.ground(x, z) + dy, z]; }
  ground(x: number, z: number) { return this.c.physics.groundY(x, 30, z, 60) ?? height(x, z); }

  line(text: string, secs = 3.6) {
    const c = this.c, p = new THREE.Vector3();
    c.knight.headPos(p);
    c.audio.speak(text, p);
    c.hud.subtitle(text, secs);
  }
  hint(id: string, text: string, secs = 5) { if (this.hints.has(id)) return; this.hints.add(id); this.c.hud.say(text, secs); }
  key(desk: string, touch: string) { return this.c.touch() ? touch : desk; }

  // ---------------------------------------------------------------------------------------------------------------
  build() {
    const c = this.c, kit = new Kit(c.physics), H = (x: number, z: number) => height(x, z);
    c.root.add(kit.root);
    this.throwArc.geometry.setAttribute('position', new THREE.BufferAttribute(this.throwPoints, 3));
    this.throwArc.visible = false; this.throwArc.frustumCulled = false; c.root.add(dynamic(this.throwArc));
    const R = rng(23);
    const rockC = '#8f8b84';
    // A rock: a faceted boulder over a box collider (what shelters her is what you see).
    let rs = 3;
    const rock = (x: number, z: number, w: number, h: number, d: number, yaw = 0, y?: number) => {
      const base = (y ?? H(x, z)) - 0.25;
      if (w * d > 30) return kit.box([x, base, z], [w, h + 0.25, d], yaw, { color: rockC, bevel: 0.3, rough: 0.95 });
      const m = new THREE.Mesh(rockGeo(rs++), toy(rockC, { flat: true, rough: 0.95 }));
      m.scale.set(w * 0.56, (h + 0.25) * 0.56, d * 0.56); m.position.set(x, base + (h + 0.25) / 2, z); m.rotation.y = yaw;
      m.castShadow = true; m.receiveShadow = true;
      c.root.add(m);
      c.physics.addBox(m.position, new THREE.Vector3(w / 2, (h + 0.25) / 2, d / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), { kind: 'stone' }, L.world);
      return m;
    };
    const dry = (x0: number, x1: number, z: number, h: number, t = 0.6, y = 0) => kit.box([(x0 + x1) / 2, y - 0.3, z], [x1 - x0, h + 0.3, t], 0, { stone: 0.3, color: '#a49d8f' });

    // ===== 1. The Field Wall =====
    {
      const z = Z.wall;
      dry(-19, -1.25, z, 1.7); dry(1.25, 3.25, z, 1.7); dry(4.75, 19, z, 1.7);
      kit.ivyWall([4, -0.3, z], [1.5, 2.0, 0.6], 0, { stone: 0.3, color: '#a49d8f' }, 1.4);
      c.root.add(ivy(new THREE.Vector3(4, -0.3, z), 1.5, 2.0, 0.6, Math.PI, 1.4));
      for (const s of [-1, 1]) kit.box([s * 1.1, -0.1, z], [0.32, 2.1, 0.72], 0, { color: PAL.woodDark, bevel: 0.05 });
      // The gate: hinged on the left post, swinging away (-z) when the loop on the far side is lifted.
      const leafObj = plankLeaf(1.9, 1.55, 0.09);
      this.gate = new Hinge(c.physics, leafObj, [RAPIER.ColliderDesc.cuboid(0.95, 0.78, 0.06)], new THREE.Vector3(-0.95, 0.83, z), new THREE.Vector3(0.95, 0, 0), new THREE.Vector3(0, 1, 0), 0, 1.75, 0.7);
      c.root.add(leafObj);
      this.loop = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 14), toy('#c9b07a'));
      this.loop.position.set(1.0, 1.55, z - 0.42); this.loop.rotation.y = Math.PI / 2;
      const tassel = pinMesh(); tassel.children[0].visible = false; tassel.children[1].visible = false;
      tassel.position.set(1.0, 1.42, z - 0.5); this.loop.add(tassel); tassel.position.set(0, -0.08, 0);
      c.root.add(dynamic(this.loop));
      for (const s of [-1, 1]) rock(s * 15.0, z + 0.3, 2.6, 2.2, 2.4, s * 0.4, Math.min(height(s * 15, z), height(s * 14, z)));
      this.use({ pos: new THREE.Vector3(0.95, H(0.95, z - 0.9), z - 0.9), radius: 0.75, who: 'kitten', text: 'Lift the rope loop', ready: () => !this.state.gate, use: () => this.openGate() });
      this.use({ pos: new THREE.Vector3(0, H(0, z + 0.9), z + 0.9), radius: 1.3, who: 'knight', text: 'Push the gate', ready: () => !this.state.gate, use: () => {
        this.shake(this.gate); c.audio.play('creak', new THREE.Vector3(0, 1, z), 0.6);
        c.hud.say('Tied shut from the other side.', 3);
        this.after(1.8, () => this.hint('switch', this.key('<b>Tab</b> switches to Whisker. She can climb the <b>ivy</b> on the wall.', 'Tap <b>🐾</b> to switch to Whisker. She can climb the <b>ivy</b> on the wall.'), 6));
      } });
    }

    // ===== 2. The Ditch =====
    {
      const z = Z.ditch, near = z + 1.3, far = z - 1.3;
      const rev = (z0: number, z1: number) => {
        kit.box([0, -1.65, (z0 + z1) / 2], [46, 1.67, Math.abs(z1 - z0)], 0, { color: '#686b4c', bevel: 0.03 });
        // Timber facing on the ditch side.
        const face = plankLeaf(46, 1.3, 0.08, PAL.woodDark, true);
        face.position.set(0, -0.66, z0 + (z0 > z ? -0.04 : 0.04));
        c.root.add(face);
      };
      rev(near, z + 5.8); rev(far, z - 5.8);
      // Steps cut into the near side, along the wall (out of the ditch if anyone falls in).
      kit.stairs([-9.6, -1.3, near - 0.46], 5, 0.26, 0.42, 0.9, -Math.PI / 2, { color: '#8a7052' });
      // The fallen oak along the near bank: its roots at +x (the pivot), crown at -x.
      const r = 0.36, len = 5.4, pivot = new THREE.Vector3(2.7, -0.04, near + 0.75);
      const tg = new THREE.Group();
      const log = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, len, 14).rotateZ(Math.PI / 2), toy('#6b4a33'));
      log.castShadow = true; log.receiveShadow = true;
      // Roots splayed out low from its foot (under where you step on).
      const roots = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 5)) + Math.PI;
        const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.9, 6).translate(0, 0.45, 0), toy('#5a4030'));
        rt.position.set(len / 2 - 0.1, 0, 0); rt.rotation.set(a, 0, -0.9 - (i % 2) * 0.3, 'XYZ'); rt.castShadow = true;
        roots.add(rt);
      }
      const crown = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + i * 0.04, 1), toy(i % 2 ? '#6e9a42' : '#87ad4c', { flat: true }));
        b.position.set(-len / 2 - 0.05 + i * 0.1, 0.2 + (i % 2) * 0.15, (i - 1.5) * 0.3); b.castShadow = true;
        crown.add(b);
      }
      const handle = handleMesh(0.5); handle.rotation.y = Math.PI / 2; handle.position.set(-len / 2 + 0.55, r + 0.05, 0);
      tg.add(log, roots, crown, handle);
      c.root.add(tg);
      // One box for the log (a capsule beside a flat walkway stalls the character controller where they touch).
      this.trunk = new Hinge(c.physics, tg, [RAPIER.ColliderDesc.cuboid(len / 2, r * 0.95, 0.44).setTranslation(0, -0.02, 0)], pivot, new THREE.Vector3(-len / 2, 0, 0), new THREE.Vector3(0, 1, 0), 0, -Math.PI / 2, 0.42, EASE.smooth, new THREE.Quaternion(), { kind: 'wood' });
      this.trunk.onArrive = () => {
        c.audio.play('thud', pivot, 1.2);
        const ends = [new THREE.Vector3(pivot.x, 0, pivot.z + 0.2), new THREE.Vector3(pivot.x, 0, pivot.z - len + 0.2)];
        void ends;
      };
      const crownAt = new THREE.Vector3(pivot.x - len + 0.4, 0, pivot.z + 0.6);
      this.use({ pos: crownAt, radius: 1.2, who: 'knight', text: 'Shove the trunk round', ready: () => !this.state.trunk, use: () => this.shoveTrunk() });
      this.use({ pos: crownAt, radius: 0.9, who: 'kitten', text: 'Push the trunk', ready: () => !this.state.trunk, use: () => { c.hud.say('She shoves with all four paws. It doesn’t move an inch.', 3); c.audio.play('mrrp', crownAt); } });
      // An old repair wedge jams the roots. The hollow is a real low passage, and the pin is recessed far
      // enough that neither actor can reach through its roof. She frees it; only his weight moves the oak.
      const rz = pivot.z + 1.55;
      kit.box([5.85, 0.48, rz], [1.9, 0.48, 0.95], 0, { color: '#655447', bevel: 0.1, surface: { kind: 'wood' } });
      for (const dz of [-0.57, 0.57]) kit.box([5.85, -0.05, rz + dz], [1.9, 1.05, 0.24], 0, { color: '#655447', bevel: 0.07 });
      kit.box([4.92, -0.05, rz], [0.2, 1.05, 1.15], 0, { color: '#655447', bevel: 0.05 });
      const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.24, 0.25), toy('#c8a26a'));
      wedge.position.set(5.26, 0.15, rz); wedge.rotation.z = -0.22;
      const pull = pinMesh(); pull.rotation.y = Math.PI / 2; pull.position.set(0.07, 0.05, 0); wedge.add(pull);
      c.root.add(dynamic(wedge)); this.rootWedge = wedge;
      this.use({ pos: new THREE.Vector3(5.48, 0, rz), radius: 0.38, who: 'kitten', text: 'Pull the root wedge', ready: () => !this.state.root, use: () => {
        this.state.root = true; wedge.visible = false;
        c.audio.play('bolt', wedge.position, 0.8);
        this.hint('rootfree', 'The roots are free. Bram can swing the oak into the bank’s notches.', 4);
        this.objective();
      } });
      // A trickle along the bottom.
      water.add({ x: 0, z, rx: 30, rz: 1.25, rot: 0, level: -1.2, depth: 0.15, rect: true, carve: false });
    }

    // ===== 3. The Sheepfold =====
    {
      const z0 = Z.fold, nz = z0 + 4, fz = z0 - 4, hgt = 2.4;
      const pale = { stone: 0.55, color: '#d6cfbf' };
      const seg = (x0: number, x1: number, z: number, y0 = 0, y1 = hgt) => kit.box([(x0 + x1) / 2, y0 - (y0 === 0 ? 0.3 : 0), z], [x1 - x0, y1 - y0 + (y0 === 0 ? 0.3 : 0), 0.5], 0, pale);
      // Near wall: the gate (x -1..1), the creep hole (x 2.04..2.38, 0.42 high).
      seg(-4.25, -1.08, nz); seg(1.08, 2.04, nz); seg(2.04, 2.38, nz, 0.42); seg(2.38, 4.25, nz);
      // The wings out to the glen's sides.
      seg(-20, -4.25, nz); seg(4.25, 20, nz);
      // Far wall with its gap; the sides.
      seg(-4.25, -1.1, fz); seg(1.1, 4.25, fz);
      for (const s of [-1, 1]) kit.box([s * 4, -0.3, z0], [0.5, hgt + 0.3, 8.5], 0, pale);
      // Coping stones along the top (where she lands).
      for (const [x0, x1, z] of [[-4.25, 4.25, nz], [-4.25, -1.1, fz], [1.1, 4.25, fz]] as const) kit.box([(x0 + x1) / 2, hgt, z], [x1 - x0 + 0.1, 0.1, 0.62], 0, { color: '#bdb5a5' });
      // The gate: one leaf hinged at the left post, opening inward.
      const leafObj = plankLeaf(2.0, 2.1, 0.1, '#7a5537');
      this.foldGate = new Hinge(c.physics, leafObj, [RAPIER.ColliderDesc.cuboid(1.0, 1.05, 0.07)], new THREE.Vector3(-1.0, 1.1, nz), new THREE.Vector3(1.0, 0, 0), new THREE.Vector3(0, 1, 0), 0, 1.65, 0.6);
      c.root.add(leafObj);
      // The bar across the inside, low, in iron brackets, held by her pin.
      const bar = new THREE.Mesh(new RoundedBoxGeometry(2.5, 0.16, 0.14, 1, 0.03), toy(PAL.woodDark));
      bar.position.set(0, 0.32, nz - 0.33); bar.castShadow = true;
      c.root.add(dynamic(bar)); this.bar = bar;
      for (const s of [-1, 1]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.24), metal(PAL.steelDark)); br.position.set(s * 1.18, 0.32, nz - 0.33); c.root.add(br); }
      const pin = dynamic(pinMesh()); pin.position.set(1.05, 0.42, nz - 0.4); pin.rotation.y = Math.PI; c.root.add(pin);
      this.bar.userData.pin = pin;
      this.use({ pos: new THREE.Vector3(0.95, 0, nz - 0.85), radius: 0.7, who: 'kitten', text: 'Pull the pin', ready: () => !this.state.bar, use: () => this.dropBar() });
      this.use({ pos: new THREE.Vector3(-0.2, 0, nz - 0.85), radius: 0.8, who: 'kitten', text: 'Push the gate', ready: () => this.state.bar && !this.state.fold, use: () => { this.shake(this.foldGate); c.hud.say('Swollen tight in its frame. It needs his weight.', 3.5); } });
      this.use({ pos: new THREE.Vector3(0, 0, nz + 0.9), radius: 1.3, who: 'knight', text: 'Shoulder the gate', ready: () => !this.state.fold, use: () => this.shoulderGate() });
      // The creep hole's loose stone, outside; knocked out from inside.
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 1), toy('#9c968a', { flat: true }));
      st.scale.set(1, 0.95, 0.8); st.position.set(2.21, 0.2, nz + 0.33); st.castShadow = true;
      c.root.add(dynamic(st)); this.stoneObj = st;
      this.stoneCol = c.physics.addBox(new THREE.Vector3(2.21, 0.21, nz + 0.12), new THREE.Vector3(0.17, 0.21, 0.13), undefined, { kind: 'stone' }, L.detail);
      this.use({ pos: new THREE.Vector3(2.21, 0, nz - 0.6), radius: 0.6, who: 'kitten', text: 'Knock the stone out', ready: () => !this.state.stone, use: () => this.knockStone() });
      // A few sheep about the fold and the meadow before it.
      this.sheep(c, [[-8, -78], [-5, -82], [6, -76], [9, -86], [-12, -88], [3, -92], [-2.5, z0 - 1], [2, z0 + 1.5]]);
    }

    // ===== 4. The Mill Stream =====
    {
      const z = Z.stream, lvl = STREAM_LEVEL;
      water.add({ x: 0, z, rx: 28, rz: 5.2, rot: 0, level: lvl, depth: 2, rect: true, carve: false });
      // Too deep for him past the shelves: his own edge, either side of the channel (not across the bridge).
      for (const zz of [z + 1.5, z - 1.5]) for (const [x0, x1] of [[-30, BRIDGE_X - 0.95], [BRIDGE_X + 0.95, 30]]) c.physics.addBox(new THREE.Vector3((x0 + x1) / 2, -0.8, zz), new THREE.Vector3((x1 - x0) / 2, 1.7, 0.08), undefined, { kind: 'water' }, L.knightOnly);
      // Stone lips on the shelves' edges (the drop-off you can see).
      for (const zz of [z + 1.5 + 0.12, z - 1.5 - 0.12]) kit.box([0, -2.4, zz], [56, 1.4, 0.24], 0, { stone: 0.35, color: '#7f7a70', cast: false });
      // The bridge: two piers, fixed decks to them, and the leaf standing up over the channel.
      const deckY = 0.2;
      for (const zz of [z + 2.0, z - 2.0]) kit.box([BRIDGE_X, -2.4, zz], [1.9, 2.45 + deckY - 0.14, 1.0], 0, { stone: 0.35, color: '#8f8a80' });
      const deck = (z0: number, z1: number) => kit.box([BRIDGE_X, deckY - 0.15, (z0 + z1) / 2], [1.8, 0.15, Math.abs(z1 - z0)], 0, { color: PAL.wood, bevel: 0.02, surface: { kind: 'wood' } });
      deck(z + 6.0, z + 1.5); deck(z - 1.5, z - 6.0);
      const leafObj = plankLeaf(1.7, 3.0, 0.15, PAL.wood, true);
      leafObj.rotation.x = -Math.PI / 2;
      const leafG = new THREE.Group(); leafG.add(leafObj);
      this.leaf = new Hinge(c.physics, leafG, [RAPIER.ColliderDesc.cuboid(0.85, 0.075, 1.5)], new THREE.Vector3(BRIDGE_X, deckY - 0.075, z - 1.5), new THREE.Vector3(0, 0, 1.5), new THREE.Vector3(1, 0, 0), -Math.PI / 2, 0, 1.1, EASE.fall, new THREE.Quaternion(), { kind: 'wood' });
      this.leaf.onArrive = () => { c.audio.play('thud', new THREE.Vector3(BRIDGE_X, 0, z), 1.4); c.audio.play('splash', new THREE.Vector3(BRIDGE_X, 0, z), 0.8); };
      c.root.add(leafG);
      // The mill on the far bank: a timber lower storey she can climb (standing in the water), a plastered upper
      // storey set back to leave a gallery, a roof; the wheel turning on its east side.
      const mx0 = -3, mx1 = 4, front = z - 2.5, back = z - 9;
      const lower = kit.box([(mx0 + mx1) / 2, -2.4, (front + back) / 2], [mx1 - mx0, 5.4, back - front < 0 ? front - back : back - front], 0, { color: '#7a5436', surface: { climb: true, kind: 'wood' }, bevel: 0.04 });
      void lower;
      for (let y = -0.1; y < 3; y += 0.42) { const b = new THREE.Mesh(new THREE.BoxGeometry(mx1 - mx0 + 0.04, 0.07, 0.06), toy('#5b3d26')); b.position.set((mx0 + mx1) / 2, y, front + 0.02); c.root.add(b); }
      for (let x = mx0 + 0.3; x < mx1; x += 1.2) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.3, 0.08), toy('#5b3d26')); b.position.set(x, 1.35, front + 0.03); b.castShadow = true; c.root.add(b); }
      kit.box([(mx0 + mx1) / 2, 3.0, (front - 1 + back) / 2], [mx1 - mx0, 3.0, front - 1 - back], 0, { color: '#efe4cf', bevel: 0.03 });
      // Roof: a long prism.
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, mx1 - mx0 + 0.8, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6 + Math.PI), toy('#9c4a36', { flat: true }));
      roof.scale.set(1, 0.55, 1); roof.position.set((mx0 + mx1) / 2, 6.0 + 1.0, (front - 1 + back) / 2); roof.castShadow = true;
      c.root.add(roof);
      c.physics.addBox(new THREE.Vector3((mx0 + mx1) / 2, 6.8, (front - 1 + back) / 2), new THREE.Vector3((mx1 - mx0) / 2 + 0.4, 0.8, (front - 1 - back) / 2 + 0.6), undefined, { kind: 'wood' });
      // The wheel.
      const wheel = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 6, 24).rotateY(Math.PI / 2), toy('#5b3d26'));
      wheel.add(rim);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.42), toy(PAL.wood));
        p.position.set(0, Math.sin(a) * 1.55, Math.cos(a) * 1.55); p.rotation.x = -a; wheel.add(p);
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.1, 0.08), toy('#5b3d26')); s.rotation.x = a; wheel.add(s);
      }
      wheel.position.set(mx1 + 0.4, 0.7, z - 4.4); wheel.traverse((o) => { o.castShadow = true; });
      c.root.add(dynamic(wheel)); this.wheel = wheel;
      c.physics.addFixed(RAPIER.ColliderDesc.cylinder(0.3, 1.65).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)).setTranslation(mx1 + 0.4, 0.7, z - 4.4), { kind: 'wood' }, L.detail);
      // The rope: from the leaf's top over a pulley at the mill's corner to her pin on the gallery.
      const pin = pinMesh(); pin.position.set(-1.8, 3.27, front - 0.98); c.root.add(pin);
      const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 6, 12).rotateY(Math.PI / 4), metal(PAL.steelDark)); pulley.position.set(mx0 - 0.1, 4.3, front + 0.05); c.root.add(pulley);
      this.millRope = new Rope(new THREE.Vector3(BRIDGE_X, 3.05, z - 1.5), new THREE.Vector3(mx0 - 0.1, 4.3, front + 0.05), 0.12);
      const rope2 = new Rope(new THREE.Vector3(mx0 - 0.1, 4.3, front + 0.05), new THREE.Vector3(-1.8, 3.3, front - 0.85), 0.06);
      c.root.add(this.millRope.mesh, rope2.mesh);
      this.millRope.mesh.userData.other = rope2;
      this.use({ pos: new THREE.Vector3(-1.8, 3.0, front - 0.6), radius: 0.75, who: 'kitten', text: 'Release the bridge pin', ready: () => !this.state.mill, use: () => {
        if (!this.millBraced || !this.state.brake) {
          c.audio.play('clank', pin.position, 0.6);
          c.hud.say('The rope pulls too hard. The blue winch must take the bridge’s weight first.', 5);
          this.objective(); return;
        }
        this.dropLeaf();
      } });

      // The winch needs two simultaneous jobs: weight on the iron plate keeps its pawl engaged, while a
      // strong hand turns its handle four metres away. The knight cannot do both. A stone in a groove is
      // a permanent substitute for him, discoverable by standing on the plate first. There is no timer.
      const px = -10, pz = z + 7;
      kit.box([px, -0.04, pz], [1.65, 0.08, 1.65], 0, { color: '#575e5c', bevel: 0.04 });
      const plateTop = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.045, 1.48), metal(HIS_BLUE, 0.6));
      plateTop.position.set(px, 0.065, pz); c.root.add(dynamic(plateTop));
      this.plates.push({ pos: new THREE.Vector3(px, 0.08, pz), radius: 0.74, heavy: true, mesh: plateTop, travel: 0.04, load: () => this.ballast.p >= 0.98, onChange: (pressed) => {
        if (pressed && !this.state.mill) {
          c.audio.play('clank', new THREE.Vector3(px, 0, pz), 0.7);
          this.hint('plate', 'His weight engages the winch. But he needs a free hand over at the blue handle. What else could hold this plate?', 6);
        }
        this.objective();
      } });
      const ballast = new THREE.Group();
      const block = new THREE.Mesh(new RoundedBoxGeometry(1.16, 1.0, 1.16, 2, 0.09), toy('#777c76', { rough: 0.95 }));
      block.position.y = 0.54; ballast.add(block);
      const bh = handleMesh(0.65); bh.rotation.y = Math.PI / 2; bh.position.set(-0.62, 0.61, 0); ballast.add(bh);
      for (const zz of [-0.43, 0.43]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.03, 0.09), toy('#50483e')); rail.position.set(-11.4, 0.02, pz + zz); c.root.add(rail); }
      this.ballast = new Hinge(c.physics, ballast, [RAPIER.ColliderDesc.cuboid(0.58, 0.5, 0.58).setTranslation(0, 0.54, 0)], new THREE.Vector3(-12.8, 0, pz), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 0, 0.5, EASE.smooth, new THREE.Quaternion(), { kind: 'stone' });
      this.ballast.platform.path = (_t, pos, quat) => { pos.set(lerp(-12.8, px, EASE.smooth(this.ballast.p)), 0, pz); quat.identity(); };
      this.ballast.onArrive = () => { c.audio.play('stone', new THREE.Vector3(px, 0, pz), 0.8); this.objective(); };
      ballast.traverse((o) => { o.castShadow = true; o.receiveShadow = true; }); c.root.add(ballast);
      const shoveAt = new THREE.Vector3(-13.65, 0, pz);
      this.use({ pos: shoveAt, radius: 1.0, who: 'knight', text: 'Slide the ballast onto the plate', ready: () => !this.state.ballast, use: () => {
        this.state.ballast = true; this.ballast.target = 1;
        c.knight.play('Push'); c.knight.pushing = true; this.after(1.2, () => { c.knight.pushing = false; });
        this.hint('ballast', 'The stone holds his place. Now Bram can turn the winch while Whisker takes the far-bank pin.', 5);
        this.objective();
      } });
      this.use({ pos: shoveAt, radius: 0.8, who: 'kitten', text: 'Push the ballast', ready: () => !this.state.ballast, use: () => c.hud.say('It barely rocks. This is a job for Bram.', 3) });
      const wg = new THREE.Group();
      const wd = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.8, 12).rotateZ(Math.PI / 2), toy(PAL.woodDark)); wd.position.y = 0.62; wg.add(wd);
      const wh = handleMesh(0.85); wh.position.set(0, 0.7, 0.33); wg.add(wh);
      wg.position.set(BRIDGE_X, 0, pz); this.winch = dynamic(wg); c.root.add(wg);
      for (const sx of [-0.5, 0.5]) kit.box([BRIDGE_X + sx, 0, pz], [0.14, 0.85, 0.2], 0, { color: PAL.woodDark });
      this.braceRope = new Rope(new THREE.Vector3(px, 0.1, pz), new THREE.Vector3(BRIDGE_X - 0.5, 0.65, pz), 0.2, 0.024);
      c.root.add(this.braceRope.mesh);
      this.use({ pos: new THREE.Vector3(BRIDGE_X, 0, pz + 0.65), radius: 1.0, who: 'knight', text: 'Wind the bridge winch', ready: () => !this.state.mill && !this.state.brake, use: () => {
        if (!this.millBraced) { c.audio.play('clank', wg.position, 0.7); c.hud.say('The winch slips back. Something heavy must stay on the blue plate.', 5); this.objective(); return; }
        this.state.brake = true; wh.rotation.z = Math.PI / 2; c.audio.play('creak', wg.position, 0.8);
        this.hint('winch', 'Click. The rope is slack. Whisker can swim across, climb the mill timbers and pull the pink pin.', 6); this.objective();
      } });
    }

    // ===== 5. The Windy Ridge =====
    {
      const rz = [-178.5, -181.5, -184.5, -187.5, -190.5, -204.5, -219, -233.5, -236.5];
      for (const z of rz) rock(-1.95, z, 0.95, 1.45, 1.3, (R() - 0.5) * 0.2, HIGH);
      // Windward boulders down the slope (decor) and pennants along the crest.
      for (let i = 0; i < 14; i++) { const z = -180 - i * 4.3, x = -5 - R() * 6; rock(x, z, 0.8 + R(), 0.5 + R() * 0.8, 0.8 + R(), R() * 3); }
      for (const z of [-195, -210, -226]) { const b = banner('#f4ead2', 1.6, 0.35, 0.7, 0); b.position.set(2.2, HIGH - 0.05, z); aimBanner(b); c.root.add(b); this.banners.push(b); }
      // The hay cart, parked in its groove behind the rock at -204.5; he shoves it to the middle of the gap.
      const cart = new THREE.Group();
      const box = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.7, 2.0, 2, 0.05), toy(PAL.wood)); box.position.y = 0.55; cart.add(box);
      const hay = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.7, 1.9, 3, 0.3), toy(PAL.straw)); hay.position.y = 1.15; cart.add(hay);
      for (const sx of [-1, 1]) for (const sz of [-0.6, 0.6]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 14).rotateZ(Math.PI / 2), toy(PAL.woodDark)); w.position.set(sx * 0.7, 0.32, sz); cart.add(w);
      }
      const hdl = handleMesh(0.9); hdl.position.set(0, 0.85, 1.1); cart.add(hdl);
      cart.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      c.root.add(cart);
      for (const sx of [-0.45, 0.45]) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 7.6), toy('#6d5640')); g.position.set(-1.0 + sx, HIGH + 0.012, -209); c.root.add(g); }
      const cz0 = -206.3, cz1 = -211.75;
      this.cart = new Hinge(c.physics, cart, [RAPIER.ColliderDesc.cuboid(0.62, 0.75, 1.0).setTranslation(0, 0.75, 0)], new THREE.Vector3(-1.0, HIGH, cz0), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 0, 0.32, EASE.smooth, new THREE.Quaternion(), { kind: 'wood' });
      // A hinge used as a slide: its path is rewritten to run along the groove.
      const ch = this.cart;
      ch.platform.path = (_t, pos, quat) => { pos.set(-1.0, HIGH, lerp(cz0, cz1, EASE.smooth(ch.p))); quat.identity(); };
      this.cart.onArrive = () => c.audio.play('thud', new THREE.Vector3(-1, HIGH, cz1), 0.8);
      this.use({ pos: new THREE.Vector3(-1.0, HIGH, cz0 + 1.45), radius: 0.9, who: 'knight', text: 'Shove the hay cart along', ready: () => !this.state.cart && this.cart.p === 0, use: () => this.shoveCart() });
      this.use({ pos: new THREE.Vector3(-1.0, HIGH, cz0 + 1.3), radius: 0.7, who: 'kitten', text: 'Push the cart', ready: () => !this.state.cart && this.cart.p === 0, use: () => c.hud.say('Far too heavy for her.', 2.5) });
    }

    // ===== 6. The Tor Gap =====
    {
      const zc = -242.4; // the plank bridge, at the gap's north end (clear of where she lands)
      rock(0, (Z.ridge1 + Z.torS) / 2, 6, HIGH + 2, 12, 0, -2);
      rock(10, -248, 6, HIGH + 2, 16, 0, -2);
      kit.box([17.5, -2.3, Z.ridge1 + 0.7], [21, HIGH + 2.3, 1.8], 0, { color: rockC, bevel: 0.3 });
      rock(-2.35, -245.5, 1.1, 1.5, 2.4, 0.1, HIGH);
      rock(-2.2, -249.5, 1.0, 1.1, 1.6, -0.2, HIGH);
      // Pennants on both lips streaming across (the wind blows the way she has to go).
      // A straw bale on the far lip: where to aim her.
      const bale = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.7, 1.0, 3, 0.22), toy(PAL.straw, { rough: 0.95 }));
      bale.position.set(9.4, HIGH + 0.35, -247); bale.rotation.y = 0.3; bale.castShadow = true; bale.receiveShadow = true;
      c.root.add(bale);
      c.physics.addBox(bale.position, new THREE.Vector3(0.62, 0.35, 0.48), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3), { kind: 'straw' }, L.detail);
      for (const [x, z] of [[2.7, -244.3], [2.7, -250.8], [7.3, -244.3], [7.3, -250.8]] as const) { const b = banner('#f4ead2', 2.0, 0.35, 0.9, 0); b.position.set(x, HIGH - 0.05, z); aimBanner(b); c.root.add(b); this.banners.push(b); }
      // The plank bridge, standing against its post on the far lip, hinged at the far edge; her pin ties it.
      const pl = plankLeaf(4.6, 1.5, 0.14, PAL.wood, true);
      pl.rotation.x = -Math.PI / 2;
      const bg = new THREE.Group(); bg.add(pl);
      this.torBridge = new Hinge(c.physics, bg, [RAPIER.ColliderDesc.cuboid(2.3, 0.07, 0.75)], new THREE.Vector3(7.0, HIGH + 0.07, zc), new THREE.Vector3(-2.3, 0, 0), new THREE.Vector3(0, 0, 1), -Math.PI / 2, 0, 1.0, EASE.fall, new THREE.Quaternion(), { kind: 'wood' });
      this.torBridge.onArrive = () => c.audio.play('thud', new THREE.Vector3(5, HIGH, zc), 1.3);
      c.root.add(bg);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), toy(PAL.woodDark)); post.position.set(7.6, HIGH + 1.3, zc - 1.0); post.castShadow = true; c.root.add(post);
      c.physics.addFixed(RAPIER.ColliderDesc.cylinder(1.3, 0.12).setTranslation(7.6, HIGH + 1.3, zc - 1.0), { kind: 'wood' }, L.detail);
      const pin = pinMesh(); pin.position.set(7.6, HIGH + 0.27, zc - 0.9); c.root.add(pin);
      this.torRope = new Rope(new THREE.Vector3(7.1, HIGH + 4.4, zc), new THREE.Vector3(7.6, HIGH + 0.3, zc - 0.85), 0.05);
      c.root.add(this.torRope.mesh);
      this.use({ pos: new THREE.Vector3(7.9, HIGH, zc - 0.4), radius: 0.75, who: 'kitten', text: 'Pull the pin', ready: () => !this.state.tor, use: () => this.dropTorBridge() });
    }

    // ===== 7. The Castle =====
    this.castle(kit);

    // ===== The land's dressing =====
    // Woods up the glen's sides, lone trees, rocks at the hills' feet, flowers, the wind's streaks.
    const oaks: { x: number; y: number; z: number; s: number }[] = [], pines: typeof oaks = [], lone: typeof oaks = [], stones: typeof oaks = [];
    for (let i = 0; i < 200; i++) {
      const z = 50 - R() * 400, side = R() < 0.5 ? -1 : 1;
      const w = z > Z.ridge0 ? table(z, HW) : 16;
      const x = side * (w + 10 + R() * 40) + (z < Z.ridge1 ? GATE_X : 0);
      const y = height(x, z);
      if (y < -1 || Math.abs(z - Z.moatN) < 14 && x > -12 && x < 44) continue;
      (R() < 0.45 ? pines : oaks).push({ x, y: y - 0.2, z, s: 1.0 + R() * 0.9 });
    }
    c.root.add(forest(TREES.oak, oaks, undefined, 4, 7, true), forest(TREES.pine, pines, undefined, 3, 9, true));
    for (const [x, z] of [[-24, 8], [21, 2], [-12, -52], [13, -70], [-16, -122], [14, -128], [-9, -160]]) lone.push({ x, y: height(x, z) - 0.1, z, s: 1.1 + R() * 0.3 });
    c.root.add(forest(TREES.oak, lone, c.physics, 3, 13));
    for (let i = 0; i < 120; i++) {
      const z = 40 - R() * 210;
      const w = table(z, HW), side = R() < 0.5 ? -1 : 1;
      const x = side * (w + 0.4 + R() * 1.4), sc = 0.5 + R() * 1.3;
      if (BEATS.some((b) => Math.abs(z - b) < 7)) continue;
      stones.push({ x, y: Math.min(height(x, z), height(x - side * sc, z)) - 0.25 * sc, z, s: sc });
    }
    c.root.add(boulders(stones, c.physics, '#9b978e'));
    const bsh: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 40; i++) { const z = 30 - R() * 190, side = R() < 0.5 ? -1 : 1, x = side * (table(z, HW) - 1.2 - R() * 2); if (BEATS.some((b) => Math.abs(z - b) < 8)) continue; bsh.push({ x, y: height(x, z), z, s: 0.6 + R() * 0.6 }); }
    c.root.add(bushes(bsh, '#5f9a45', '#2f6234', c.physics));
    const fl: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 700; i++) {
      const z = 40 - R() * 200, x = (R() - 0.5) * 2 * table(z, HW);
      if (trackDist(x, z) < 1.6 || water.surfaceAt(x, z) !== null || bare(x, z) || BEATS.some((b) => Math.abs(z - b) < 4)) continue;
      fl.push({ x, y: height(x, z), z });
    }
    c.root.add(flowers(fl, ['#ffffff', '#ffd84a', '#c39be8', '#ff9fb2']));
    for (const [x, z, color] of [[-6, 16, PAL.bannerBlue], [7, 4, PAL.bannerRed], [-9, Z.wall + 3, PAL.bannerBlue], [10, -96, PAL.bannerRed], [-8, -150, PAL.bannerBlue]] as const) {
      const b = banner(color, 3.0, 0.6, 1.2, 0); b.position.set(x, height(x, z) - 0.15, z); aimBanner(b); c.root.add(b); this.banners.push(b);
      c.physics.addFixed(RAPIER.ColliderDesc.cylinder(1.5, 0.05).setTranslation(x, height(x, z) + 1.4, z), { kind: 'wood' }, L.detail);
    }
    // Chimney smoke from the castle's kitchens, leaning downwind; the crows over its towers.
    for (const [x, z] of [[8, -322], [25, -318]] as const) { const s = new Smoke(new THREE.Vector3(x, HIGH + 12, z), 18, 18, '#d8d4cc', 0.45, 0.8); this.smokes.push(s); c.root.add(s.mesh); }
    this.crows.group.userData.keep = true;
    c.root.add(dynamic(this.crows.group), this.streaks.mesh);
    const m = mergeStatic(c.root, 64);
    console.debug('moor static merge', m);
  }

  // Sheep: woolly blobs with dark faces and legs, grazing.
  sheep(c: Ctx, spots: [number, number][]) {
    const wool = toy('#f1ece2', { flat: true }), dark = toy('#2e2a2a');
    spots.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), wool); body.scale.set(1, 0.8, 1.3); body.position.y = 0.6;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), dark); head.scale.set(0.9, 1, 1.3); head.position.set(0, 0.62, 0.55);
      g.add(body, head);
      for (const sx of [-0.18, 0.18]) for (const sz of [-0.28, 0.3]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.4, 6), dark); l.position.set(sx, 0.2, sz); g.add(l); }
      g.position.set(x, height(x, z), z); g.rotation.y = i * 2.3;
      g.traverse((o) => { o.castShadow = true; });
      g.userData.head = dynamic(head); g.userData.phase = i * 1.7;
      c.root.add(g);
      c.physics.addFixed(RAPIER.ColliderDesc.capsule(0.3, 0.35).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, i * 2.3, 0, 'YXZ'))).setTranslation(x, height(x, z) + 0.55, z), { kind: 'wool' }, L.detail);
      this.flock.push(g);
    });
  }
  flock: THREE.Object3D[] = [];

  // The castle on its plateau: the moat, the curtain wall with its gatehouse (two towers, the passage, the winding
  // loggia above it with the windlass and the murder hole), the drawbridge, the portcullis; the bailey and the keep.
  castle(kit: Kit) {
    const c = this.c, y0 = HIGH, gx = GATE_X;
    const S = { stone: 0.5, color: '#b9b2a2' }, S2 = { stone: 0.5, color: '#a8a090' };
    water.add({ x: 16, z: (Z.moatN + Z.moatS) / 2, rx: 24, rz: (Z.moatN - Z.moatS) / 2, rot: 0, level: MOAT_LEVEL, depth: 5, rect: true, carve: false });
    // The near wall of the moat, and the abutment the bridge comes down on.
    kit.box([16, -0.7, Z.moatN + 1.05], [48, y0 + 0.72, 2.1], 0, S2);
    kit.box([gx, -0.7, Z.moatN - 1.25], [4, y0 + 0.72, 2.6], 0, S2);
    // Her steps up out of the moat (narrow, along the wall), east of the bridge.
    kit.stairs([26.2, MOAT_LEVEL - 0.25, Z.moatN - 0.21], 7, 0.24, 0.34, 0.42, Math.PI / 2, { stone: 0.3, color: '#a8a090' });
    // Curtain wall either side of the gatehouse, crenellated.
    const wallTop = y0 + 8;
    const crenels = (x0: number, x1: number, z: number, top: number) => { for (let x = x0 + 0.4; x < x1 - 0.3; x += 1.4) kit.box([x, top, z], [0.8, 0.8, 0.7], 0, { ...S, collide: false, cast: true }); };
    for (const [x0, x1] of [[-9, 11], [21, 41]] as const) { kit.box([(x0 + x1) / 2, 0, Z.moatS - 1.25], [x1 - x0, wallTop, 2.5], 0, S); crenels(x0, x1, Z.moatS - 0.4, wallTop); }
    // Side and back walls (the bailey), corner towers.
    kit.box([-8, y0 - 0.5, -320], [2.5, 8.5, 46], 0, S); kit.box([40, y0 - 0.5, -320], [2.5, 8.5, 46], 0, S); kit.box([16, y0 - 0.5, -342], [50, 8.5, 2.5], 0, S);
    for (const [x, z] of [[-8, -297], [40, -297], [-8, -342], [40, -342]] as const) this.tower(kit, x, z, 2.6, wallTop + 4);
    // The gatehouse: towers either side of the passage.
    this.tower(kit, 12.4, Z.moatS - 2.2, 2.1, wallTop + 5, true);
    kit.box([19.25, 0, Z.moatS - 2.5], [3.5, y0 + 4.6, 5], 0, S); // the right tower, up to the loggia's floor
    // The passage's floor (x 14.5..17.5), its arch and the loggia's floor over it, with the murder hole.
    kit.box([gx, -0.6, Z.moatS - 2.25], [3.2, y0 + 0.6, 4.5], 0, S2);
    const fy = y0 + 4.2, ft = 0.4; // the loggia's floor: top at y0 + 4.6
    kit.box([gx - 0.8, fy, Z.moatS - 2.25], [1.4, ft, 4.5], 0, S2); // west of the hole
    kit.box([gx + 1.15, fy, Z.moatS - 2.25], [0.7, ft, 4.5], 0, S2); // east of it
    kit.box([gx + 0.25, fy, Z.moatS - 0.9], [1.1, ft, 1.8], 0, S2); // in front (over the portcullis)
    kit.box([gx + 0.25, fy, Z.moatS - 4.1], [1.1, ft, 0.8], 0, S2); // behind
    // The loggia: open to the moat, its back wall, ends and roof.
    const ly = y0 + 4.6, lh = 2.8;
    kit.box([17.75, ly, Z.moatS - 4.75], [7, lh, 0.5], 0, S);
    kit.box([14.4, ly, Z.moatS - 2.5], [0.4, lh, 5], 0, S); kit.box([21.1, ly, Z.moatS - 2.5], [0.4, lh, 5], 0, S);
    kit.box([17.75, ly + lh, Z.moatS - 2.4], [7.2, 0.5, 5.4], 0, S);
    crenels(14.3, 21.3, Z.moatS - 0.3, ly + lh + 0.5);
    // The windlass: a drum on posts at the back, its pawl (her pin) beside it.
    const drum = new THREE.Group();
    const dm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 16).rotateZ(Math.PI / 2), toy(PAL.wood)); drum.add(dm);
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.08, 0.95), toy(PAL.woodDark)); sp.rotation.x = (i / 6) * Math.PI; drum.add(sp); }
    drum.position.set(16.6, ly + 0.75, Z.moatS - 3.9); drum.traverse((o) => { o.castShadow = true; });
    c.root.add(dynamic(drum)); this.drum = drum;
    c.physics.addBox(new THREE.Vector3(16.6, ly + 0.75, Z.moatS - 3.9), new THREE.Vector3(1.3, 0.5, 0.5), undefined, { kind: 'wood' }, L.detail);
    const pawl = pinMesh(); pawl.position.set(18.2, ly + 0.27, Z.moatS - 3.75); c.root.add(pawl);
    this.use({ pos: new THREE.Vector3(18.2, ly, Z.moatS - 3.2), radius: 0.8, who: 'kitten', text: 'Knock the pawl free', ready: () => !this.state.draw, use: () => this.dropDrawbridge() });
    // The counterweight chain down the right tower's face into the moat: big links, climbable.
    const chain = new THREE.Group();
    const link = new THREE.TorusGeometry(0.11, 0.035, 6, 12);
    for (let y = MOAT_LEVEL - 0.6, i = 0; y < ly; y += 0.17, i++) { const l = new THREE.Mesh(link, metal(PAL.steelDark, 0.5)); l.position.set(0, y, 0); l.rotation.set(0, i % 2 ? Math.PI / 2 : 0, 0); l.scale.set(1, 1.5, 1); chain.add(l); }
    chain.position.set(19.3, 0, Z.moatS + 0.08); c.root.add(chain);
    c.physics.addBox(new THREE.Vector3(19.3, (MOAT_LEVEL - 0.6 + ly) / 2, Z.moatS + 0.05), new THREE.Vector3(0.24, (ly - MOAT_LEVEL + 0.6) / 2, 0.05), undefined, { climb: true, kind: 'chain' }, L.world);
    // The drawbridge, raised against the gatehouse; hinged at its foot.
    const db = plankLeaf(3.0, 6.0, 0.3, '#6e4a2e', true);
    db.rotation.x = -Math.PI / 2;
    const dg = new THREE.Group(); dg.add(db);
    this.draw = new Hinge(c.physics, dg, [RAPIER.ColliderDesc.cuboid(1.5, 0.15, 3.0)], new THREE.Vector3(gx, y0 - 0.15, Z.moatS), new THREE.Vector3(0, 0, 3.0), new THREE.Vector3(1, 0, 0), -Math.PI / 2, 0, 0.42, EASE.fall, new THREE.Quaternion(), { kind: 'wood' });
    c.root.add(dg);
    for (const sx of [-1.3, 1.3]) { const r = new Rope(new THREE.Vector3(), new THREE.Vector3(gx + sx, y0 + 6.4, Z.moatS - 0.1), 0.02, 0.04, '#55595f'); this.drawChains.push(r); c.root.add(r.mesh); }
    // The portcullis: iron-shod oak bars a kitten's head apart; solid only to him.
    const pc = new THREE.Group();
    const barM = toy('#4a3a2c');
    for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 4.2, 0.08), barM); b.position.x = -1.4 + i * 0.255; pc.add(b); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), metal(PAL.steelDark)); tip.position.set(-1.4 + i * 0.255, -2.17, 0); tip.rotation.x = Math.PI; pc.add(tip); }
    for (let j = 0; j < 6; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.1), barM); b.position.y = -1.8 + j * 0.72; pc.add(b); }
    const grip = handleMesh(1.2); grip.position.set(0, -1.75, 0.12); pc.add(grip);
    pc.traverse((o) => { o.castShadow = true; });
    const portZ = Z.moatS - 2.0;
    this.port = new Hinge(c.physics, pc, [RAPIER.ColliderDesc.cuboid(1.5, 2.1, 0.08)], new THREE.Vector3(gx, y0 + 2.1, portZ), new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 0, 0.7, EASE.out, new THREE.Quaternion(), { kind: 'iron' }, L.knightOnly);
    const ph = this.port;
    ph.platform.path = (_t, pos, quat) => { pos.set(gx, y0 + 2.1 + 2.15 * ph.ease(ph.p), portZ); quat.identity(); };
    c.root.add(pc);
    // The ratchet catch inside the passage, at her height, with its ribbon; and his hold.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.1), metal(PAL.steelDark)); rail.position.set(gx + 1.45, y0 + 0.7, portZ - 0.35); c.root.add(rail);
    const ct = dynamic(pinMesh()); ct.position.set(gx + 1.42, y0 + 0.28, portZ - 0.5); ct.rotation.y = -Math.PI / 2; c.root.add(ct); this.catchObj = ct;
    this.use({ pos: new THREE.Vector3(gx + 1.0, y0, portZ - 0.7), radius: 0.75, who: 'kitten', text: 'Throw the catch', ready: () => !this.state.latched, use: () => this.throwCatch() });
    this.use({ pos: new THREE.Vector3(gx, y0, portZ + 0.75), radius: 1.0, who: 'knight', text: 'Heave the portcullis up', ready: () => !this.holding && !this.state.latched && this.state.draw, use: () => this.heave() });
    this.use({ pos: new THREE.Vector3(gx, y0, portZ + 0.75), radius: 1.4, who: 'knight', text: 'Let go', ready: () => this.holding, use: () => this.letGo() });
    // Arrow slits along the curtain and up the towers; long banners hanging either side of the gate.
    const slit = toy('#2a2622', { rough: 1 });
    const slitGeo = new THREE.BoxGeometry(0.16, 0.9, 0.08);
    for (const [x0, x1] of [[-6, 10], [22, 39]] as const) for (let x = x0; x < x1; x += 3.4) {
      const m = new THREE.Mesh(slitGeo, slit); m.position.set(x, y0 + 4.6, Z.moatS + 0.02); c.root.add(m);
    }
    for (const [x, r] of [[12.4, 2.1]] as const) for (const yy of [y0 + 4, y0 + 8]) {
      const m = new THREE.Mesh(slitGeo, slit); m.position.set(x, yy, Z.moatS - 2.2 + r + 0.01); c.root.add(m);
    }
    for (const x of [13.0, 19.25]) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 4.2, 1, 6), toy(HIS_BLUE, { side: THREE.DoubleSide, rough: 0.85 }));
      const pp = cloth.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) { const yy = pp.getY(i); if (yy < -1.9) pp.setY(i, yy - (Math.abs(pp.getX(i)) < 0.1 ? -0.35 : 0)); }
      cloth.position.set(x, y0 + 8.2, x < 16 ? Z.moatS - 2.2 + 2.12 : Z.moatS + 0.03); cloth.castShadow = true; c.root.add(cloth);
      const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), toy(PAL.cream, { side: THREE.DoubleSide }));
      emblem.position.set(x, y0 + 8.9, cloth.position.z + 0.012); c.root.add(emblem);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6).rotateZ(Math.PI / 2), toy(PAL.gold)); rod.position.set(x, y0 + 10.35, cloth.position.z + 0.02); c.root.add(rod);
    }
    // The bailey: the keep with its towers and banners, a well.
    kit.box([16, y0 - 0.3, -324], [16, 20, 12], 0, S);
    crenels(8, 24, -318, y0 + 19.7);
    this.tower(kit, 8, -318, 2.8, y0 + 26); this.tower(kit, 24, -318, 2.8, y0 + 26); this.tower(kit, 16, -330, 3.6, y0 + 34);
    for (const [x, z, h] of [[8, -318, y0 + 26], [24, -318, y0 + 26], [16, -330, y0 + 34], [12.4, Z.moatS - 2.2, wallTop + 5]] as const) { const b = banner(HIS_BLUE, 3.4, 0.8, 1.6, 0); b.position.set(x, h + 2.2, z); aimBanner(b); c.root.add(b); this.banners.push(b); }
    kit.box([28, y0 - 0.2, -308], [1.6, 0.9, 1.6], 0, { stone: 0.25, color: '#8f8a80' });
  }

  // A round tower with a conical slate roof (or battlements).
  tower(kit: Kit, x: number, z: number, r: number, top: number, battlements = false) {
    const c = this.c;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, top + 1, 16), stone('#b4ad9d', 0.5));
    m.position.set(x, top / 2 - 0.5, z); m.castShadow = true; m.receiveShadow = true; c.root.add(m);
    c.physics.addFixed(RAPIER.ColliderDesc.cylinder((top + 1) / 2, r).setTranslation(x, top / 2 - 0.5, z), { kind: 'stone' }, L.world);
    if (battlements) { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; kit.box([x + Math.cos(a) * (r - 0.25), top, z + Math.sin(a) * (r - 0.25)], [0.6, 0.7, 0.5], -a, { stone: 0.5, color: '#b4ad9d', collide: false }); } return; }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 2.2, 16), toy('#5d6a82', { flat: true }));
    roof.position.set(x, top + r * 1.1, z); roof.castShadow = true; c.root.add(roof);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Puzzle actions.

  shake(h: Hinge) { this.rattle = 0.5; this.rattleGate = h; }

  openGate() {
    const c = this.c;
    this.state.gate = true;
    this.objective();
    this.loop.visible = false;
    c.audio.play('creak', new THREE.Vector3(0, 1, Z.wall), 0.9);
    this.after(0.25, () => { this.gate.target = 1; c.audio.play('door', new THREE.Vector3(0, 1, Z.wall), 0.8); });
    this.after(1.4, () => { this.line(LINES.wall); this.hint('call', this.key('<b>Q</b> calls Bram to her (press again and he waits).', '<b>Call</b> brings Bram to her (again: he waits).'), 6); });
  }

  shoveTrunk() {
    const c = this.c, kn = c.knight;
    if (!this.state.root) {
      c.audio.play('creak', this.trunk.hinge, 0.8);
      c.hud.say('A wedge jams the roots. The little hollow is too low for Bram.', 5);
      this.hint('root', 'A pink ribbon hangs inside the root hollow, on the oak’s east end.', 5);
      return;
    }
    this.state.trunk = true;
    kn.pushing = true; kn.play('Push');
    c.audio.play('creak', this.trunk.hinge, 1);
    this.after(0.3, () => { this.trunk.target = 1; });
    this.after(1.6, () => { kn.pushing = false; });
    this.after(3.2, () => this.line(LINES.ditch));
    this.objective();
    // Little earth ramps up onto each end once it lies across.
    this.trunk.onArrive = () => {
      c.audio.play('thud', this.trunk.hinge, 1.2);
      const x = this.trunk.hinge.x, z0 = this.trunk.hinge.z, z1 = z0 - 5.4;
      for (const [z, dir] of [[z0 + 0.45, 1], [z1 - 0.45, -1]] as const) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dir * 0.42, 0, 0));
        this.trunkRamps.push(c.physics.addBox(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(0.45, 0.05, 0.42), q, { kind: 'earth' }, L.detail));
      }
    };
  }

  dropBar() {
    const c = this.c;
    this.state.bar = true;
    c.audio.play('bolt', this.bar.position, 0.9);
    const pin = this.bar.userData.pin as THREE.Object3D;
    const t0 = performance.now();
    const fall = () => {
      const t = Math.min(1, (performance.now() - t0) / 500);
      this.bar.position.y = 0.32 - 0.24 * t * t; this.bar.rotation.z = 0.25 * t; this.bar.position.z = Z.fold + 4 - 0.33 - 0.25 * t;
      pin.position.z = Z.fold + 4 - 0.4 - 0.25 * t; pin.position.y = 0.42 - 0.38 * t * t;
      if (t < 1) requestAnimationFrame(fall); else c.audio.play('thud', this.bar.position, 0.6);
    };
    fall();
    this.after(0.9, () => this.hint('shoulder', 'The bar is off. The gate won’t budge for her, though. It wants his shoulder.', 4.5));
  }

  shoulderGate() {
    const c = this.c, kn = c.knight;
    if (!this.state.bar) {
      this.shake(this.foldGate); c.audio.play('thud', new THREE.Vector3(0, 1, Z.fold + 4), 0.7);
      c.hud.say('Barred on the inside.', 2.8);
      this.after(1.5, () => this.hint('throw', this.key('Walls too high to climb. <b>E</b> beside her lifts her; <b>E</b> again throws her over.', '<b>Act</b> beside her lifts her; <b>Act</b> again throws her over the wall.'), 6));
      return;
    }
    this.state.fold = true;
    this.objective();
    kn.play('Shoulder'); kn.pushing = true;
    this.after(0.28, () => { this.foldGate.rate = 2.2; this.foldGate.target = 1; c.audio.play('thud', new THREE.Vector3(0, 1, Z.fold + 4), 1.3); c.audio.play('door', new THREE.Vector3(0, 1, Z.fold + 4), 0.6); });
    this.after(0.9, () => { kn.pushing = false; });
    this.after(1.8, () => this.line(LINES.fold));
  }

  knockStone() {
    const c = this.c;
    this.state.stone = true;
    c.physics.world.removeCollider(this.stoneCol, true);
    c.audio.play('stone', this.stoneObj.position, 0.8);
    const s0 = this.stoneObj.position.clone(), t0 = performance.now();
    const roll = () => {
      const t = Math.min(1, (performance.now() - t0) / 700);
      this.stoneObj.position.set(s0.x + 0.15 * t, s0.y - 0.06 * t, s0.z + 0.8 * EASE.out(t)); this.stoneObj.rotation.x = 4 * t;
      if (t < 1) requestAnimationFrame(roll);
    };
    roll();
    this.hint('creep', 'A way in and out, just her size.', 3);
  }

  dropLeaf() {
    const c = this.c;
    this.state.mill = true;
    this.objective();
    c.audio.play('bolt', new THREE.Vector3(-1.8, 3.2, Z.stream - 3.5), 0.9);
    this.millRope.mesh.visible = false; (this.millRope.mesh.userData.other as Rope).mesh.visible = false;
    this.after(0.15, () => { this.leaf.target = 1; c.audio.play('creak', new THREE.Vector3(BRIDGE_X, 2, Z.stream), 0.8); });
    // The result, from his side of the stream.
    const z = Z.stream;
    const cs: Cutscene = {
      name: 'mill-bridge', length: 2.6, letterbox: false, skippable: true,
      shots: [{ at: 0, dur: 2.6, from: { pos: [BRIDGE_X - 4.5, 2.3, z + 8.5], look: [BRIDGE_X, 0.8, z - 0.5], mm: 30 }, to: { pos: [BRIDGE_X - 4.0, 2.1, z + 8.0], look: [BRIDGE_X, 0.4, z - 0.5], mm: 30 } }],
    };
    c.timeline.play(cs);
    this.after(3.4, () => this.line(LINES.mill));
  }

  shoveCart() {
    const c = this.c, kn = c.knight;
    this.state.cart = true;
    kn.pushing = true; kn.play('Push');
    c.audio.play('creak', new THREE.Vector3(-1, HIGH + 0.5, -206), 0.8);
    this.after(0.25, () => { this.cart.target = 1; });
    this.after(1.5, () => { kn.pushing = false; });
    this.hint('cart', 'Rolled into the middle of the gap: a windbreak she can rest behind.', 4.5);
  }

  dropTorBridge() {
    const c = this.c;
    this.state.tor = true;
    this.objective();
    this.torRope.mesh.visible = false;
    c.audio.play('bolt', new THREE.Vector3(7.6, HIGH + 0.3, -246.9), 0.9);
    this.after(0.15, () => { this.torBridge.target = 1; c.audio.play('creak', new THREE.Vector3(7, HIGH + 2, -246), 0.8); });
    this.after(1.7, () => this.line(LINES.tor));
  }

  // The set piece: the windlass spins, the chains run, the bridge tips and slams down; dust, crows, Bram cheers.
  dropDrawbridge() {
    const c = this.c, gx = GATE_X, y0 = HIGH;
    this.state.draw = true;
    this.objective();
    c.audio.play('bolt', new THREE.Vector3(18.2, y0 + 4.9, Z.moatS - 3.75), 1);
    const kp = c.game.knight.char.body.pos.clone();
    const behind: [number, number, number] = [kp.x - 3, kp.y + 2.4, kp.z + 6.5];
    const cs: Cutscene = {
      name: 'drawbridge', length: 7.2, letterbox: true, skippable: true,
      shots: [
        { at: 0, dur: 1.4, from: { pos: [gx + 3.4, y0 + 5.6, Z.moatS - 1.0], look: [16.6, y0 + 5.2, Z.moatS - 3.9], mm: 28 } },
        { at: 1.4, dur: 3.6, from: { pos: behind, look: [gx, y0 + 3, Z.moatS + 1], mm: 30 }, to: { pos: [behind[0] + 0.6, behind[1] - 0.4, behind[2] - 1.5], look: [gx, y0 + 1.5, Z.moatS + 2], mm: 32 } },
        { at: 5.0, dur: 2.2, from: { pos: [kp.x + 1.4, kp.y + 1.75, kp.z - 1.6], look: [kp.x, kp.y + 1.6, kp.z], mm: 40 }, to: { pos: [kp.x + 1.3, kp.y + 1.7, kp.z - 1.4], look: [kp.x, kp.y + 1.6, kp.z], mm: 42 } },
      ],
      cues: [
        { at: 0.2, run: () => { this.drumSpin = 7; c.audio.play('gate', new THREE.Vector3(gx, y0 + 5, Z.moatS), 1.1); } },
        { at: 1.5, run: () => { this.draw.target = 1; }, onSkip: true },
        { at: 4.0, run: () => { c.audio.play('thud', new THREE.Vector3(gx, y0, Z.moatS + 3), 1.6); this.dust(new THREE.Vector3(gx, y0, Z.moatS + 3)); this.crows.group.userData.scatter = 1; c.audio.play('caw', new THREE.Vector3(gx, y0 + 12, -310), 1); } },
        { at: 5.2, run: () => this.line(LINES.draw, 2.5) },
      ],
      onEnd: () => { this.draw.set(1); this.hint('murder', 'A hole in the floor drops into the gate passage, inside the portcullis.', 5); },
    };
    c.timeline.play(cs);
  }
  drumSpin = 0;

  dust(at: THREE.Vector3) {
    const s = new Smoke(at, 3, 14, '#c9bba0', 0.55, 1.6);
    this.c.root.add(s.mesh);
    this.smokes.push(s);
    this.after(6, () => { s.mesh.visible = false; });
  }

  heave() {
    const c = this.c, n = this.n, kn = c.knight, gx = GATE_X, portZ = Z.moatS - 2.0;
    this.holding = true;
    n.motor.place(new THREE.Vector3(gx, HIGH, portZ + 0.5), Math.PI);
    n.motor.mode = 'held';
    kn.resetPose(n.ground);
    this.port.target = 1;
    c.audio.play('gate', new THREE.Vector3(gx, HIGH + 2, portZ), 0.7);
    kn.play('Lift');
    this.hint('hold', this.key('He’ll hold it as long as it takes. <b>Tab</b> to Whisker: the catch is inside, by the wall.', 'He’ll hold it as long as it takes. Switch to Whisker: the catch is inside, by the wall.'), 6);
  }

  letGo() {
    const c = this.c, n = this.n, kn = c.knight, portZ = Z.moatS - 2.0;
    this.holding = false;
    kn.hands = null;
    n.motor.mode = 'move';
    if (!this.state.latched) {
      this.port.rate = 2.5; this.port.target = 0;
      this.after(0.35, () => { this.port.rate = 0.7; c.audio.play('thud', new THREE.Vector3(GATE_X, HIGH, portZ), 1.2); });
      n.motor.place(new THREE.Vector3(GATE_X, HIGH, portZ + 0.9), Math.PI);
      c.hud.say('It slams back down. Something has to hold it up.', 3);
    } else {
      c.audio.play('clank', new THREE.Vector3(GATE_X, HIGH + 2, portZ), 1);
      this.hint('through', 'The catch holds it. Through you go, both of you.', 4);
    }
  }

  throwCatch() {
    const c = this.c;
    if (this.port.p < 0.95) { c.audio.play('clank', this.catchObj.position, 0.6); c.hud.say('It clicks back. The gate has to be up for it to catch.', 3.5); return; }
    this.state.latched = true;
    this.objective();
    this.catchObj.rotation.z = 0.9;
    c.audio.play('bolt', this.catchObj.position, 1);
    this.hint('letgo', this.key('Clack. <b>Tab</b> back to Bram, and let go.', 'Clack. Switch back to Bram, and let go.'), 5);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Story.

  start(checkpoint: string | null) {
    const c = this.c;
    for (const u of this.usables) c.game.interactions.add(u);
    for (const p of this.plates) this.millPlate = c.game.interactions.plate(p);
    c.kitten.resetStoryPose(); c.knight.resetStoryPose();
    c.kitten.setOutfit({ armour: true, cape: true, bow: true });
    c.knight.setOutfit({ wounded: false });
    c.game.canSwitch = true;
    c.padLabel('KeyQ', 'Call'); c.padLabel('Tab', 'Switch'); c.padLabel('KeyE', 'Act'); c.padLabel('KeyG', 'Hint');
    this.cp = (ORDER as readonly string[]).includes(checkpoint ?? '') ? checkpoint as CP : 'start';
    const i = ORDER.indexOf(this.cp);
    const s = this.state;
    s.gate = i >= 1; s.root = s.trunk = i >= 2; s.bar = s.fold = s.stone = i >= 3; s.ballast = s.brake = s.mill = i >= 4; s.tor = i >= 6;
    if (s.gate) { this.gate.set(1); this.loop.visible = false; }
    if (s.trunk) { this.rootWedge.visible = false; this.trunk.set(1); this.shoveTrunkRamps(); }
    if (s.bar) { this.bar.visible = false; (this.bar.userData.pin as THREE.Object3D).visible = false; this.foldGate.set(1); this.knockStoneInstant(); }
    if (s.mill) { this.ballast.set(1); this.leaf.set(1); this.millRope.mesh.visible = false; (this.millRope.mesh.userData.other as Rope).mesh.visible = false; }
    if (s.tor) { this.torBridge.set(1); this.torRope.mesh.visible = false; }
    this.place(this.cp);
    // Walking together: she follows him.
    c.game.switchTo(c.game.knight);
    c.game.follower.mode = 'follow';
    c.game.camera.snap(c.game.subject(), Math.PI * 0 + 0);
    c.game.camera.yaw = 0; c.game.camera.pitch = 0.25;
    if (this.cp !== 'start') { this.stage = 'play'; this.objective(); }
  }
  shoveTrunkRamps() {
    const c = this.c, x = this.trunk.hinge.x, z0 = this.trunk.hinge.z, z1 = z0 - 5.4;
    for (const [z, dir] of [[z0 + 0.45, 1], [z1 - 0.45, -1]] as const) this.trunkRamps.push(c.physics.addBox(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(0.45, 0.05, 0.42), new THREE.Quaternion().setFromEuler(new THREE.Euler(dir * 0.42, 0, 0)), { kind: 'earth' }, L.detail));
    this.trunk.onArrive = () => {};
  }
  knockStoneInstant() { this.state.stone = true; this.c.physics.world.removeCollider(this.stoneCol, true); this.stoneObj.position.z += 0.8; }

  place(cp: CP) {
    const s = SPAWN[cp], [x, z] = s.at, g = this.c.game;
    const ny = this.ground(x, z), ky = this.ground(x + 0.9, z + 0.4);
    g.placeAt({ knight: { pos: new THREE.Vector3(x, ny, z), yaw: s.yaw }, kitten: { pos: new THREE.Vector3(x + 0.9, ky, z + 0.4), yaw: s.yaw } });
  }

  objective() {
    const c = this.c, s = this.state;
    const text = !s.gate ? 'Find a way through the <b>field wall</b>.'
      : !s.trunk ? 'Free the oak and bridge the <b>ditch</b>.'
      : !s.fold ? 'Get both companions through the <b>sheepfold</b>.'
      : !s.mill ? (s.brake ? 'The rope is slack. Release the <b>far-bank bridge pin</b>.' : 'Take the bridge’s weight on the <b>mill winch</b>.')
      : !s.tor ? 'Cross the <b>windy ridge</b> together.'
      : !s.draw ? 'Get Whisker into the <b>castle gatehouse</b>.'
      : !s.latched ? 'Raise and secure the <b>portcullis</b>.' : 'Bring <b>both companions</b> into the castle.';
    c.hud.objective(text);
  }

  begin() {
    if (this.stage !== 'title') return;
    if (this.cp !== 'start') { this.stage = 'play'; return; }
    this.intro();
  }

  intro() {
    const c = this.c, P = (x: number, z: number) => this.P(x, z);
    this.stage = 'intro';
    const cs: Cutscene = {
      name: 'moor-intro', length: 13, letterbox: true, skippable: true,
      shots: [
        { at: 0, dur: 6.5, from: { pos: [-14, 9, 44], look: [GATE_X, 22, -300], mm: 24 }, to: { pos: [-8, 6.5, 36], look: [GATE_X, 18, -300], mm: 26 } },
        { at: 6.5, dur: 6.5, from: { pos: [2.6, 0.75, 31.5], look: [-0.6, 1.5, 18], mm: 30 }, to: { pos: [2.2, 0.85, 28.0], look: [-0.6, 1.7, 14], mm: 30 } },
      ],
      marks: [
        { at: 0.5, who: 'knight', path: [P(-1.4, 38), P(-0.8, 30), P(-0.5, 24)], speed: 1.4, face: Math.PI },
        { at: 0.5, who: 'kitten', path: [P(-0.2, 38.6), P(0.3, 30.6), P(0.4, 24.4)], speed: 1.4, face: Math.PI },
      ],
      cues: [
        { at: 1.2, run: () => { void c.hud.card('Chapter One', 'The Road to the Castle', 'The castle has called every knight of the moor home.', 2.6); } },
        { at: 7.4, run: () => this.line(LINES.intro[0], 3) },
        { at: 10.2, run: () => this.line(LINES.intro[1], 3.4) },
      ],
      onEnd: () => {
        this.stage = 'play';
        c.game.switchTo(c.game.knight);
        c.game.follower.mode = 'follow';
        c.game.camera.snap(c.game.subject(), 0);
        this.objective();
        this.after(0.6, () => this.hint('move', this.key('<b>WASD</b> to walk. Whisker follows you.', 'Walk with the left stick. Whisker follows you.'), 5));
      },
    };
    c.hud.fadeLevel(0);
    c.timeline.play(cs);
  }

  // The end of the chapter: through the gate, into the bailey; the bell; the card.
  ending() {
    const c = this.c, gx = GATE_X;
    this.stage = 'end';
    c.hud.objective(null);
    const P = (x: number, z: number) => this.P(x, z);
    const cs: Cutscene = {
      name: 'moor-end', length: 11, letterbox: true, skippable: false,
      shots: [
        { at: 0, dur: 6, from: { pos: [gx + 4, HIGH + 1.6, -305], look: [gx, HIGH + 1.2, -300], mm: 30 }, to: { pos: [gx + 6, HIGH + 4.5, -312], look: [gx, HIGH + 5, -320], mm: 26 } },
        { at: 6, dur: 5, from: { pos: [gx - 1.5, HIGH + 1.0, -309.5], look: [gx, HIGH + 1.0, -306], mm: 36 }, to: { pos: [gx - 1.3, HIGH + 1.1, -309.0], look: [gx, HIGH + 1.0, -306], mm: 38 } },
      ],
      marks: [
        { at: 0.2, who: 'knight', path: [P(gx, -301), P(gx - 0.3, -306)], speed: 1.1, face: Math.PI },
        { at: 0.6, who: 'kitten', path: [P(gx + 0.8, -301.2), P(gx + 0.6, -306.4)], speed: 1.1, face: Math.PI },
      ],
      cues: [
        { at: 1.0, run: () => c.audio.play('castleBell', new THREE.Vector3(gx, HIGH + 20, -329), 1) },
        { at: 6.4, run: () => this.line(LINES.end[0], 2.4) },
        { at: 8.6, run: () => this.line(LINES.end[1], 2.6) },
        { at: 10.5, run: () => { void this.finish(); } },
      ],
    };
    c.timeline.play(cs);
  }
  async finish() {
    const c = this.c;
    await c.hud.fade(1, 1.4);
    if (dir !== this) return;
    await c.hud.card('', 'End of Chapter One', 'Beyond the gates, the bell is still calling.', 3);
    if (dir !== this) return;
    void c.hud.fade(0, 1.2);
    this.stage = 'play';
  }

  // Q from the one played, toward the one waiting. She won't come out into the wind on the ridge.
  heard() {}

  private hintSteps = new Map<string, number>();
  giveHint() {
    const s = this.state;
    const key = !s.gate ? 'wall' : !s.trunk ? 'oak' : !s.fold ? 'fold' : !s.mill ? 'mill' : !s.tor ? 'wind' : !s.draw ? 'moat' : !s.latched ? 'gate' : 'together';
    const clues: Record<string, string[]> = {
      wall: ['The field gate is tied on its far side. Look for a way around its latch.', 'Ivy can hold claws, but tears under steel.', 'Whisker can climb the ivy to the right of the gate, then lift the rope loop inside.'],
      oak: ['The oak pivots at its roots, but an old repair wedge jams it.', 'Something small can get under the root hollow beside the oak.', 'Whisker pulls the pink wedge from the low hollow; Bram can then swing the oak across.'],
      fold: ['The gate has two problems: an inside bar and a swollen frame.', 'She can reach the inside; he can force the frame once it is unbarred.', 'Bram throws Whisker over the wall. She pulls the bar pin; he shoulders the gate.'],
      mill: ['Follow the rope: the blue plate engages the winch, and the gallery pin carries the bridge’s weight.', 'Bram cannot stand on the plate and turn the distant handle at the same time. Find a substitute for his weight.', 'Bram slides the ballast onto the plate and turns the blue winch. Whisker swims across, climbs the mill, and releases the pink pin.'],
      wind: ['A gust is a threat in the open, but rocks and Bram leave a calm patch downwind.', 'Leave Bram on the windward edge, then move Whisker through his lee. The cart can fill another gap.', 'At the tor, aim Bram across the gap and throw during a gust. Whisker reaches the far pin and lowers his bridge.'],
      moat: ['The drawbridge is held from the winding room. Follow its counterweight chain.', 'Steel cannot swim the moat. Whisker can reach the chain from the water.', 'Swim Whisker to the right-hand chain, climb to the winding room, and pull the drawbridge pin.'],
      gate: ['The portcullis needs strength to rise and a small paw to catch its ratchet.', 'Bram will keep holding while you switch. The catch is on the inside wall.', 'Have Bram lift the gate, switch to Whisker to set its catch, then let him release it.'],
      together: ['The road is only crossed when both companions reach the bailey. Call the other one, or switch and bring them through.'],
    };
    const at = this.hintSteps.get(key) ?? 0;
    this.hintSteps.set(key, at + 1);
    this.c.hud.say(clues[key][Math.min(at, clues[key].length - 1)], 7);
  }

  // ---------------------------------------------------------------------------------------------------------------
  update(dt: number, t: number) {
    const c = this.c, g = c.game;
    if (this.timers.length) {
      for (const tm of this.timers) tm.t -= dt;
      const due = this.timers.filter((tm) => tm.t <= 0);
      this.timers = this.timers.filter((tm) => tm.t > 0);
      for (const tm of due) tm.fn();
    }
    for (const h of [this.gate, this.trunk, this.foldGate, this.leaf, this.cart, this.ballast, this.torBridge, this.draw, this.port]) h.update(dt);
    const braced = this.millBraced;
    if (braced !== this.lastBrace) {
      this.lastBrace = braced;
      this.braceRope.sag = braced ? 0.025 : 0.2; this.braceRope.build();
      if (!braced && this.state.brake && !this.state.mill) {
        this.state.brake = false; this.winch.children[1].rotation.z = 0;
        c.audio.play('clank', this.winch.position, 0.5); this.objective();
      }
    }
    // A rattle on a stuck gate.
    if (this.rattle > 0 && this.rattleGate) {
      this.rattle -= dt;
      const h = this.rattleGate;
      h.p = Math.max(0, Math.sin(this.rattle * 40) * 0.012 * (this.rattle / 0.5));
      if (this.rattle <= 0) h.p = 0;
    }
    this.wheel.rotation.x -= dt * 0.6;
    if (this.drumSpin > 0) { this.drum.rotation.x += dt * this.drumSpin; this.drumSpin = Math.max(0, this.drumSpin - dt * 1.4); }
    // The drawbridge's chains follow its end.
    if (this.draw.moving || this.drawChains[0].a.lengthSq() === 0) {
      const tip = new THREE.Vector3(0, 0, 6).applyAxisAngle(new THREE.Vector3(1, 0, 0), this.draw.angle).add(this.draw.hinge);
      this.drawChains.forEach((r, i) => { r.a.set(GATE_X + (i ? 1.3 : -1.3), tip.y + 0.1, tip.z); r.sag = 0.02 + this.draw.p * 0.3; r.build(); });
    }
    // Crows: scattered by the bridge, then settling back to circling.
    const sc = (this.crows.group.userData.scatter as number) || 0;
    if (sc > 0) { this.crows.group.userData.scatter = Math.max(0, sc - dt * 0.15); this.crows.center.y += dt * 6 * sc; } else this.crows.center.y += (HIGH + 22 - this.crows.center.y) * dt * 0.2;
    this.crows.update(dt, t);
    for (const s of this.smokes) s.update(dt);
    // The sheep graze.
    for (const s of this.flock) { const h = s.userData.head as THREE.Object3D, ph = s.userData.phase as number; h.position.y = 0.62 - 0.25 * Math.max(0, Math.sin(t * 0.4 + ph)); }
    // His hands on the portcullis while he holds it.
    if (this.holding) {
      const y = HIGH + 2.1 + 2.15 * this.port.ease(this.port.p) - 2.1 + 0.35 - 0.12;
      c.knight.hands = { left: new THREE.Vector3(GATE_X - 0.3, Math.min(y, HIGH + 2.05), Z.moatS - 1.88), right: new THREE.Vector3(GATE_X + 0.3, Math.min(y, HIGH + 2.05), Z.moatS - 1.88) };
    }

    // ---- The wind: gusts all over the moor (seen and heard), but they only push her on the ridge and the tor.
    const phase = this.gusts.update(dt);
    const kb = this.k.char.body, nb = this.n.char.body;
    const zone = this.windZone(kb.pos);
    const active = g.active === g.kitten && !c.timeline.playing;
    const force = zone ? 1 : 0.1;
    WIND.base = 0.65 + (zone ? 0.25 : 0);
    WIND.push = active || g.follower.mode === 'follow' && g.active === g.knight ? force * (0.8 + 4.6 * this.gusts.strength) : 0;
    this.throwArc.visible = g.carry.holding && !c.timeline.playing;
    if (this.throwArc.visible) {
      const throwWind = this.windZone(nb.pos) ? 0.8 + 4.6 * this.gusts.strength : 0.08 + 0.46 * this.gusts.strength;
      const count = g.carry.predict(this.throwPoints, throwWind);
      this.throwArc.geometry.setDrawRange(0, count);
      this.throwArc.geometry.attributes.position.needsUpdate = true;
      this.hint('aim', 'The pale arc shows her throw. Turn Bram to aim; steer Whisker in the air.', 5);
    }
    this.streaks.update(dt, c.camera.position.clone().lerp(g.active.char.renderPos, 0.6));
    if (zone && this.k.motor.grounded && !kb.climb && kb.pos.y > HIGH - 0.02 && kb.pos.x < 1.9 && WIND.sheltered(kb.pos)) this.lastShelter.copy(kb.pos);
    if (zone === 'tor' && (this.lastShelter.lengthSq() === 0 || this.lastShelter.z > Z.ridge1 - 1)) this.lastShelter.set(-0.6, HIGH, -244.5);
    if (zone && this.lastShelter.lengthSq() > 0) this.k.motor.safe.copy(this.lastShelter);
    // Down in the bowl or the gap, nowhere there is a place to come back to: the crest is.
    const below = (p: THREE.Vector3) => p.z < Z.ridge0 - 1 && p.z > Z.torS - 1 && (p.x > 2.0 && p.x < 40 || p.x < -2.2 && p.x > -13) && p.y < HIGH - 0.12;
    if (below(kb.pos)) this.k.motor.safe.copy(this.lastShelter.lengthSq() > 0 ? this.lastShelter : new THREE.Vector3(-0.6, HIGH, clamp(kb.pos.z, -250, -179)));
    if (below(nb.pos)) this.n.motor.safe.set(-0.4, HIGH, clamp(nb.pos.z, -250, -179));
    if (zone && phase === 'warn' && active) this.hint('gust', 'A gust is coming. Get behind a rock!', 3.5);
    c.hud.wind(this.windZone(g.active.char.body.pos) && !c.timeline.playing ? (phase === 'lull' ? 'calm' : phase) : 'off');

    if (this.stage !== 'play' || c.timeline.playing) return;

    // A checkpoint certifies a completed shared crossing. Saving by the leader alone let a kitten scouting
    // ahead skip unfinished puzzles on reload, and stranded Bram on the wrong bank.
    const lead = g.active.char.body.pos;
    const solved: Record<CP, boolean> = { start: true, ditch: this.state.gate, fold: this.state.trunk, mill: this.state.fold, ridge: this.state.mill, tor: this.state.mill, castle: this.state.tor };
    for (const [cp, z] of SAVE_AT) if (kb.pos.z < z && nb.pos.z < z && solved[cp] && ORDER.indexOf(cp) > ORDER.indexOf(this.cp)) { this.cp = cp; c.checkpoint(cp); this.objective(); }

    // ---- Hints and lines by place.
    const kp = kb.pos, np = nb.pos;
    if (g.active === g.knight && Math.abs(np.x - 4) < 1.1 && np.z > Z.wall && np.z < Z.wall + 1.2) {
      this.ivyT += dt;
      if (this.ivyT > 0.6) { this.hint('ivy', 'The ivy tears under all that steel. Too heavy for him.', 3.5); }
    } else this.ivyT = 0;
    if (g.active === g.knight && nb.wade > 0.45 && Math.abs(np.z - Z.stream) < 2.2) {
      this.deepT += dt;
      if (this.deepT > 0.5) this.hint('deep', 'The channel’s too deep for him in all that steel. Whisker can swim it.', 5);
    } else this.deepT = 0;
    if (kb.swimming) this.hint('swim', 'She swims! Paddle across, and <b>jump</b> to scramble out.', 4);
    if (lead.z < -128 && lead.z > -137 && !this.state.mill) this.hint('millseen', 'The bridge rope is stretched tight. A blue handle, a weight plate, and a stone worn smooth in its groove…', 6);
    if (Math.abs(lead.z - (Z.stream - 4)) < 3 && g.active === g.kitten) this.hint('mill', 'The mill’s rough timbers: she can climb them to the gallery.', 4.5);
    if (lead.z < Z.ridge0 + 2 && !this.hints.has('ridgeLine')) { this.hints.add('ridgeLine'); this.line(LINES.ridge, 4); }
    if (lead.z < -190.5 && lead.z > -203 && g.active === g.kitten && kp.y > 4) this.hint('lee', this.key('Too far to run between gusts. Bram is a wall the wind can’t move: <b>Tab</b>, and stand him in the gap.', 'Too far to run between gusts. Bram is a wall the wind can’t move: switch, and stand him in the gap.'), 6);
    if (lead.z < Z.ridge1 + 1 && lead.z > Z.torS && !this.hints.has('torSeen')) { this.hints.add('torSeen'); c.hud.say('Too wide to throw her across. But see how the pennants stream over the gap…', 5); }
    if (lead.z < -270 && !this.hints.has('moat')) { this.hints.add('moat'); this.line(LINES.moat, 4); }
    if (kb.swimming && kp.z < Z.moatN) this.hint('chain', 'The counterweight chain hangs down into the moat by the right-hand tower. She can climb it.', 5);
    if (this.state.draw && !this.hints.has('portc') && g.active === g.knight && np.z < Z.moatS + 0.5) { this.hints.add('portc'); c.hud.say('The portcullis. Heavy, but he can heave it up and hold it.', 4); }

    // ---- She won't come out into the wind to follow him; he won't follow her into deep water.
    if (g.follower.mode === 'follow' && g.active === g.knight && zone && !WIND.sheltered(kp)) {
      g.follower.mode = 'wait'; g.follower.clear();
      this.k.char.play?.('flinch');
      c.kitten.meow('mew'); c.audio.play('mew', kp);
      c.hud.say('She flattens her ears. She won’t come out into the wind.', 3);
    }

    // ---- Throws at the tor that fall short.
    if (this.windZone(kp) === 'tor' && kp.y < 2 && !this.state.tor) {
      // (the bowl's kill zone respawns her; count it once per fall)
    }
    // ---- The end: both through the gate.
    if (this.state.latched && !this.holding && np.z < Z.moatS - 3.2 && kp.z < Z.moatS - 2.6) this.ending();
  }

  // Where the wind can blow her off: the ridge's crest and the tor's top.
  windZone(p: THREE.Vector3): 'ridge' | 'tor' | null {
    if (p.y < 3) return null;
    if (p.z < Z.ridge0 && p.z > Z.ridge1 && p.x < 6) return 'ridge';
    if (p.z <= Z.ridge1 && p.z > Z.torS - 1 && p.x < 7.2) return 'tor';
    return null;
  }

  // A fall from the ridge or the tor: back to her last shelter, with a word the first time.
  onFall(a: Actor) {
    const c = this.c;
    if (a !== c.game.kitten) return;
    const zone = a.char.body.pos.z <= Z.ridge1 + 0.5 ? 'tor' : 'ridge';
    if (zone === 'tor' && !this.state.tor) {
      this.shortThrows++;
      if (this.shortThrows === 1) c.hud.say('Short! Throw her into a gust, and let the wind carry her.', 4.5);
      else if (this.shortThrows === 3) c.hud.say('Wait for the grass to flatten and the whistle to rise, then throw.', 4.5);
    } else this.hint('blown', 'Blown off! Rest behind the rocks while a gust passes.', 3.5);
  }
}

let dir: Director | null = null;

export const moor: Level = {
  id: 'moor', title: 'Chapter One: The Road to the Castle', look: 'morning',
  async build(c: Ctx) {
    water.pools.length = 0;
    dir = new Director(c);
    (globalThis as any).__moor = dir;
    // The land: the glen, its sides, the ridge, the plateau; painted meadow, track, mud and rock.
    const t = new Terrain({
      cx: 12, cz: -160, half: 212, step: 2, height, farHalf: 2600, farStep: 60,
      color: (x, z, h, slope) => {
        const g = col('#626d50').lerp(col('#4c4e3e'), clamp(0.5 + n2.noise(x / 20, z / 20) * 0.7, 0, 1));
        g.lerp(col('#b9b45e'), clamp(n1.noise(x / 31 + 7, z / 31) * 0.9, 0, 0.4));
        const tr = trackDist(x, z);
        g.lerp(col('#8b8775'), (1 - sm(tr, 0.7, 1.8)) * 0.9);
        const wl = water.surfaceAt(x, z);
        if (wl !== null && h < wl + 0.2) g.lerp(col('#6a5640'), clamp((wl + 0.2 - h) * 2.5, 0, 1));
        // Steep faces: mossy rock, greyer where steepest.
        const st = clamp(slope * 1.2 - 0.7, 0, 1);
        g.lerp(col('#7c8a5e').lerp(col('#8d8b80'), clamp(0.5 + n3.noise(x / 7, z / 7 + h / 5) * 0.8, 0, 1)), st * 0.85);
        if (h < -0.9 && Math.abs(z - Z.ditch) < 2) g.lerp(col('#5d4632'), 0.8);
        return g;
      },
      grass: (x, z, h, slope) => {
        const wl = water.surfaceAt(x, z);
        if (wl !== null && h < wl + 0.06) return 0;
        if (bare(x, z) || h < -1) return 0;
        return sm(trackDist(x, z), 1.0, 2.2) * (1 - clamp(slope - 0.7, 0, 1));
      },
    });
    c.setTerrain(t, { root: '#39443a', mid: '#707d59', tip: '#a5a78a', dry: '#989078', height: 0.3 });
    const p = c.look.preset;
    const visualBed = (x: number, z: number) => (Math.abs(z - Z.stream) < 1.5 ? -2.3 : height(x, z));
    c.root.add(water.build(visualBed, { sunDir: c.look.sunDir, sun: new THREE.Color(p.sun).multiplyScalar(p.sunIntensity * 0.4), sky: new THREE.Color(p.hemiSky), horizon: new THREE.Color(p.horizon) }));
    WATER.surface = (x, z) => water.surfaceAt(x, z);
    WIND.dir.set(1, 0); WIND.base = 0.35;
    WIND.sheltered = (q) => shelteredAt(q, c.physics, c.game ? c.game.knight.char.body.pos : null);
    dir.build();
    const s = SPAWN.start;
    return {
      killY: -30,
      // The bowl under the ridge and the tor's gap: a fall there puts her back at her last shelter.
      killZones: [
        // Off the crest's lee edge: the slope is too steep to cling to; back to the last shelter.
        new THREE.Box3(new THREE.Vector3(2.0, -10, Z.ridge1), new THREE.Vector3(40, HIGH - 0.03, Z.ridge0 - 2)),
        // The windward face is visibly just as steep; it is a fall-and-rescue route, not a walk around
        // the cooperation puzzle. The land and this rescue region share the same crest edge.
        new THREE.Box3(new THREE.Vector3(-13, -10, Z.ridge1), new THREE.Vector3(-2.2, HIGH - 0.03, Z.ridge0 - 2)),
        // Into the tor's gap.
        new THREE.Box3(new THREE.Vector3(2.6, -10, Z.torS), new THREE.Vector3(40, 3.2, Z.ridge1)),
      ],
      spawn: { kitten: { pos: new THREE.Vector3(s.at[0] + 0.9, height(s.at[0] + 0.9, s.at[1] + 0.4), s.at[1] + 0.4), yaw: s.yaw }, knight: { pos: new THREE.Vector3(s.at[0], height(s.at[0], s.at[1]), s.at[1]), yaw: s.yaw } },
    };
  },
  start(c, checkpoint) {
    dir!.start(checkpoint);
    const g = c.game, prev = g.onFall;
    // No carrying her along the ridge: she has to cross it on her own paws (the tor's throw is fine).
    g.carry.allow = () => { const p = g.knight.char.body.pos; return !(p.z < Z.ridge0 + 2 && p.z > Z.ridge1 + 0.5 && p.y > 3); };
    g.onFall = (a, phase) => { prev?.(a, phase); if (phase === 'in') dir?.onFall(a); };
  },
  begin() { dir?.begin(); },
  update(dt, c) { dir?.update(dt, (c as any).time ?? performance.now() / 1000); },
  call() { dir?.heard(); },
  hint() { dir?.giveHint(); },
  dispose() { (dir as any)?.c.hud.wind('off'); dir = null; WIND.sheltered = () => false; },
  warmViews() {
    return [
      { pos: [-14, 9, 44], look: [GATE_X, 22, -300] },
      { pos: [0, 3, Z.stream + 10], look: [0, 0, Z.stream] },
      { pos: [-6, HIGH + 3, -200], look: [0, HIGH, -230] },
      { pos: [GATE_X - 4, HIGH + 3, -275], look: [GATE_X, HIGH + 4, -296] },
    ] as any;
  },
};

export const MOOR = { Z, GATE_X, BRIDGE_X, HIGH, get dir() { return dir; } };
