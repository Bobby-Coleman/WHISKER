// The prologue, "The Hawthorn" (v3). A wide valley at sunset after the battle: smoke rising on the horizon, crows
// wheeling over one lone hawthorn on a rise. A wounded knight (a broken spear in his shoulder) stumbles out of the
// haze to the tree and slides down against it. Far off across the field, a kitten nudges her mother, who will not
// wake. A horn; she looks up and sees the crows over the tree, and sets off. Played: across the battlefield (a
// fallen tree to jump, a stream to swim, wreckage), always toward the tree on the skyline; her meow is answered.
// She finds him: she hops up into his lap; he lifts his head and speaks to her through his helm. Title; "Two summers
// later"; Chapter One.
import * as THREE from 'three';
import type { Level, Ctx } from './types';
import type { Cutscene } from '../timeline';
import { Terrain } from '../world/terrain';
import { Water } from '../world/water';
import { WATER } from '../motor';
import { PAL, col, toy } from '../render/materials';
import { Simplex2 } from '../../world/noise';
import { forest, TREES, hawthorn, boulders, flowers, banner, BANNER_TIME, rng } from '../world/foliage';
import { Batch, shield, spear, sword, helmet, barrel, crate, sack, fallen, overturnedCart, wagonOnSide, wheel, M } from '../world/props';
import { Smoke, Crows, Fire } from '../world/fx';
import { RAPIER, L } from '../physics';
import { WIND } from '../body';

const n1 = new Simplex2(71), n2 = new Simplex2(83), n3 = new Simplex2(97);
const water = new Water();
// The tree on its rise, the knight's seat against its trunk (facing back down the field toward the camp), the camp.
const TREE = new THREE.Vector3(0, 0, 0);
const FACE = Math.atan2(-30, 125); // the knight looks back down the field
const SEAT = new THREE.Vector3(Math.sin(FACE) * 0.46, 0, Math.cos(FACE) * 0.46);
const CAMP = new THREE.Vector3(-30, 0, 125);
const MOTHER = CAMP.clone().add(new THREE.Vector3(1.1, 0, 0.6));
const LOG = { a: new THREE.Vector2(-30, 96.5), b: new THREE.Vector2(-10, 99.5), r: 0.24 };
const STREAM = { x: -5, z: 74, rx: 200, rz: 3.2, rot: 0.06 };
const CENTER = new THREE.Vector2(0, 58);
let terrain: Terrain | null = null;

function base(x: number, z: number) {
  let h = 1.3 * n1.fbm(x / 70, z / 70, 3) + 0.35 * n2.fbm(x / 18, z / 18, 2) + 0.04 * n3.noise(x / 3, z / 3);
  // The tree's rise.
  h += 3.4 * Math.exp(-(x * x + z * z) / (2 * 15 * 15));
  // The valley's rim: steep wooded hills all round, and the far hills beyond.
  const r = Math.hypot((x - CENTER.x) / 1.0, (z - CENTER.y) / 1.12);
  h += THREE.MathUtils.smoothstep(r, 136, 166) * 10 + THREE.MathUtils.smoothstep(r, 166, 1000) * (26 + 30 * n2.fbm(x / 400, z / 400, 3));
  // The camp, levelled.
  const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
  h += (campH() - h) * (1 - THREE.MathUtils.smoothstep(dc, 4, 10));
  // A flat under the knight.
  const ds = Math.hypot(x - SEAT.x, z - SEAT.z);
  h += (seatH() - h) * (1 - THREE.MathUtils.smoothstep(ds, 1.0, 2.6));
  return h;
}
let _campH: number | null = null, _seatH: number | null = null;
function raw(x: number, z: number) { return 1.3 * n1.fbm(x / 70, z / 70, 3) + 0.35 * n2.fbm(x / 18, z / 18, 2) + 3.4 * Math.exp(-(x * x + z * z) / (2 * 15 * 15)); }
function campH() { return (_campH ??= raw(CAMP.x, CAMP.z)); }
function seatH() { return (_seatH ??= raw(SEAT.x, SEAT.z)); }
export function height(x: number, z: number) { return water.carve(base(x, z), x, z); }
// The trampled track from the camp to the tree (paints mud, thins the grass).
function trackDist(x: number, z: number) {
  const ax = CAMP.x, az = CAMP.z - 3, bx = 0, bz = 6;
  const vx = bx - ax, vz = bz - az, t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  const px = ax + vx * t + Math.sin(t * 9) * 4, pz = az + vz * t;
  return Math.hypot(x - px, z - pz) + n3.noise(x / 4, z / 4) * 0.6;
}

const LINES = ['What’s your name, little one?', 'Looks like we’re the only ones left, huh?', 'How’d you make it through all this?', 'Don’t you worry. I’m gonna take care of you.'];

class Director {
  stage: 'title' | 'opening' | 'walk' | 'found' | 'end' = 'title';
  smokes: Smoke[] = [];
  crows: Crows;
  fires: Fire[] = [];
  banners: THREE.Object3D[] = [];
  hints = new Set<string>();
  breathT = 2; walkT = 0; answerT = 0;
  constructor(private c: Ctx) {
    this.crows = new Crows(new THREE.Vector3(TREE.x, height(0, 0) + 2, TREE.z), 7, 10);
  }
  get k() { return this.c.game.kitten; }
  get n() { return this.c.game.knight; }

  // Local (knight-frame) to world: x his left, z his front.
  L(x: number, y: number, z: number) {
    const c = Math.cos(FACE), s = Math.sin(FACE);
    return new THREE.Vector3(SEAT.x + c * x + s * z, SEAT.y + y, SEAT.z - s * x + c * z);
  }

  start() {
    const c = this.c;
    c.kitten.resetStoryPose(); c.knight.resetStoryPose();
    c.kitten.setOutfit({ armour: false, cape: false, bow: false });
    c.knight.setOutfit({ wounded: true });
    c.game.canSwitch = false;
    c.game.follower.mode = 'wait';
    c.padLabel('KeyQ', 'Meow'); c.padLabel('Tab', null); c.padLabel('KeyE', null); c.padLabel('KeyG', null);
    // He is not played here: his capsule must not catch her as she climbs him.
    this.n.motor.collider.setEnabled(false);
    this.n.motor.mode = 'held';
    this.seat(true);
    c.kitten.nudge = 1;
  }

  // He sits against the trunk (instantly, or sliding down it).
  seat(instant: boolean) {
    const kn = this.c.knight, m = this.n.motor;
    m.place(SEAT.clone(), FACE); m.mode = 'held';
    kn.resetPose(this.n.ground);
    kn.gait = 'normal';
    if (instant) kn.seated = 1; else kn.beginSlide();
  }

  opening() {
    const c = this.c, kn = c.knight, kt = c.kitten;
    this.stage = 'opening';
    kn.seated = 0; kn.gait = 'stumble'; kn.headUp = 0;
    const H = height;
    const P = (x: number, z: number, dy = 0) => [x, H(x, z) + dy, z] as [number, number, number];
    const kp = () => this.n.char.body.pos;
    // A point in his frame as he walks: `ahead` along his facing, `left` to his left, `up` above his feet.
    const rel = (ahead: number, left: number, up: number) => {
      const b = this.n.char.body, f = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
      return b.pos.clone().addScaledVector(f, ahead).add(new THREE.Vector3(f.z * left, up, -f.x * left));
    };
    const kpos = c.kitten.renderPos.clone();
    // Out of the field toward the tree; a halt to catch himself; on, and round to its trunk.
    const leg1: [number, number, number][] = [P(7.5, -9.5), P(4.8, -5.4), P(3.6, -3.4)];
    const L1 = this.L(0.9, 0, 0.9);
    const leg2: [number, number, number][] = [P(3.6, -3.4), P(2.4, -2), [L1.x, H(L1.x, L1.z), L1.z], [SEAT.x, SEAT.y, SEAT.z]];
    const near = this.L(0, 0, 0);
    const cs: Cutscene = {
      name: 'opening', length: 45.5, skippable: true,
      fades: [{ at: 0, dur: 0, to: 1 }, { at: 0.4, dur: 3.2, to: 0 }],
      shots: [
        // The valley at sunset: smoke on the horizon, the lone tree on its rise, crows over it.
        { at: 0, dur: 8.5, from: { pos: [CAMP.x - 22, campH() + 16, CAMP.z + 32], look: [0, H(0, 0) + 4, 0], mm: 24 }, to: { pos: [CAMP.x - 14, campH() + 11, CAMP.z + 18], look: [0, H(0, 0) + 3, 0], mm: 28 }, ease: 'smooth' },
        // Out of the haze: the knight, stumbling toward the tree (we track ahead of him, three-quarter front).
        { at: 8.5, dur: 9, from: { pos: () => kp().clone().add(new THREE.Vector3(-2.6, 1.5, 3.4)), look: () => kp().clone().add(new THREE.Vector3(0, 1.15, 0)), mm: 40 }, to: { pos: () => kp().clone().add(new THREE.Vector3(-2.2, 1.4, 2.9)), look: () => kp().clone().add(new THREE.Vector3(0, 1.1, 0)), mm: 42 }, ease: 'linear', handheld: 1.6 },
        // Close, from in front of him as he comes on: the spear in his shoulder, his hand pressed to it.
        { at: 17.5, dur: 4, from: { pos: () => rel(3.0, 1.1, 1.3), look: () => rel(0.3, 0, 1.15), mm: 38 }, to: { pos: () => rel(2.7, 0.95, 1.25), look: () => rel(0.3, 0, 1.12), mm: 40 }, ease: 'linear', handheld: 1.2 },
        // He reaches the tree, turns, and slides down its trunk.
        { at: 21.5, dur: 9.5, from: { pos: this.L(2.6, 1.5, 4.6).toArray() as any, look: this.L(0, 1.0, 0).toArray() as any, mm: 32 }, to: { pos: this.L(1.9, 1.0, 3.3).toArray() as any, look: this.L(0, 0.6, 0.2).toArray() as any, mm: 34 }, ease: 'smooth' },
        // Far across the field: the kitten, nudging the still shape under the blanket.
        { at: 31, dur: 7.5, from: { pos: [kpos.x + 0.9, campH() + 0.32, kpos.z + 0.75], look: [MOTHER.x - 0.3, campH() + 0.12, MOTHER.z - 0.2], mm: 45 }, to: { pos: [kpos.x + 0.8, campH() + 0.28, kpos.z + 0.62], look: [MOTHER.x - 0.3, campH() + 0.12, MOTHER.z - 0.2], mm: 50 }, ease: 'smooth' },
        // The horn: she looks up. Over her shoulder, far away on the skyline: the tree, the crows.
        { at: 38.5, dur: 7, from: { pos: [kpos.x - 0.25, campH() + 0.3, kpos.z + 0.75], look: [0, H(0, 0) + 3, 0], mm: 60 }, to: { pos: [kpos.x - 0.2, campH() + 0.32, kpos.z + 0.6], look: [0, H(0, 0) + 3.2, 0], mm: 75 }, ease: 'smooth' },
      ],
      marks: [
        { at: 8.5, who: 'knight', path: leg1, speed: 0.75 },
        { at: 18.6, who: 'knight', path: leg2, speed: 0.8, face: FACE, until: 25.8 },
      ],
      cues: [
        { at: 0.3, run: () => c.audio.play('caw', new THREE.Vector3(-4, 8, 4), 1), onSkip: false },
        { at: 12.6, run: () => kn.stagger() },
        { at: 17.4, run: () => { kn.stagger(); c.audio.play('breath', kp(), 1.3); }, onSkip: false },
        { at: 25.8, run: () => { this.seat(false); } },
        { at: 27.4, run: () => c.audio.play('breath', near, 1.0), onSkip: false },
        { at: 31.1, run: () => { kt.nudge = 1; } },
        { at: 32.1, run: () => this.meow('mew', 0.8), onSkip: false },
        { at: 33.9, run: () => this.meow('mew', 0.6), onSkip: false },
        { at: 36.1, run: () => c.audio.play('horn', new THREE.Vector3(80, 10, -60), 1), onSkip: false },
        { at: 36.9, run: () => { kt.nudge = 0; kt.lookTarget = new THREE.Vector3(0, H(0, 0) + 3, 0); } },
        { at: 40.1, run: () => this.meow('cry', 1), onSkip: false },
        { at: 45.4, run: () => { kt.lookTarget = null; kt.nudge = 0; this.seat(true); } },
      ],
      onEnd: () => this.startWalk(),
    };
    c.timeline.play(cs);
  }

  meow(kind: 'meow' | 'mew' | 'mrrp' | 'cry', gain = 1) { this.c.kitten.meow(kind); this.c.audio.play(kind, this.k.char.body.pos, gain); }
  say(line: string) {
    const head = this.c.knight.headPos(new THREE.Vector3());
    const dur = this.c.audio.speak(line, head, 1.0);
    this.c.hud.subtitle(line, dur + 1.3);
  }

  startWalk() {
    const c = this.c;
    if (this.stage === 'walk') return;
    this.stage = 'walk';
    this.seat(true);
    c.kitten.nudge = 0; c.kitten.lookTarget = null;
    c.game.switchTo(this.k);
    c.hud.objective('Find him. <b>The crows</b> are circling over the hawthorn.');
    c.hud.say(c.touch() ? 'Left thumb moves her. Meow, and listen.' : 'WASD moves her; the mouse turns the camera. <b>Q</b>: meow, and listen.', 6);
    c.checkpoint('walk');
  }

  heard() {
    if (this.answerT > 0 || this.stage !== 'walk') return;
    this.answerT = 2.5;
    const d = this.k.char.body.pos.distanceTo(SEAT);
    const g = THREE.MathUtils.clamp(2.2 - d / 60, 0.5, 1.6);
    setTimeout(() => { if (dir !== this) return; this.c.audio.play('hum', SEAT.clone().add(new THREE.Vector3(0, 1, 0)), g * 1.6); this.c.audio.play('breath', SEAT, g); }, 900);
  }

  // ---- She finds him.
  found() {
    const c = this.c, kn = c.knight, kt = c.kitten;
    this.stage = 'found';
    c.hud.objective(null);
    const kb = this.k.char.body;
    const lap = kn.lapPoint(new THREE.Vector3());
    const head = kn.headPos(new THREE.Vector3());
    const gy = (v: THREE.Vector3) => { v.y = c.physics.groundY(v.x, v.y + 1.2, v.z, 3, L.world) ?? height(v.x, v.z); return v; };
    // By his left boot, then up into his lap.
    const boot = gy(this.L(0.62, 0, 1.0));
    const start = kb.pos.clone();
    const P = (v: THREE.Vector3) => [v.x, v.y, v.z] as [number, number, number];
    const path: [number, number, number][] = [P(start)];
    // Come round in front of him if she arrived from behind the tree.
    const local = this.toLocal(start);
    if (local.z < 0.8) path.push(P(gy(this.L(local.x >= 0 ? 1.6 : -1.6, 0, 1.4))));
    path.push(P(boot));
    let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    const WALK = 0.7, arrive = len / WALK;
    const leap = arrive + 1.6, LEAP = 1.25;
    const land = leap + Math.hypot(lap.x - boot.x, lap.z - boot.z, lap.y - boot.y) / LEAP;
    const at = (t: number) => land + t;
    const facing = Math.atan2(lap.x - boot.x, lap.z - boot.z);
    const cs: Cutscene = {
      name: 'found', length: at(32), skippable: false,
      fades: [{ at: at(29), dur: 2.6, to: 1 }],
      shots: [
        // Wide, from beside the tree: him slumped under it, her small in the grass coming up to him.
        { at: 0, dur: arrive + 0.3, from: { pos: P(this.L(2.6, 1.0, 3.2)), look: P(this.L(0.2, 0.4, 1.0)), mm: 30 }, to: { pos: P(this.L(2.3, 0.9, 2.8)), look: P(this.L(0.2, 0.35, 1.0)), mm: 32 }, ease: 'smooth' },
        // From her eye line: his helm, his chin on his chest.
        { at: arrive + 0.3, dur: 1.4, from: { pos: P(this.L(0.5, 0.26, 1.65)), look: P(this.L(-0.08, 0.64, 0.2)), mm: 34 }, to: { pos: P(this.L(0.46, 0.26, 1.55)), look: P(this.L(-0.08, 0.64, 0.2)), mm: 36 }, ease: 'smooth' },
        // Side on, from his left: she gathers herself and leaps up into his lap.
        { at: leap - 0.4, dur: land - leap + 1.6, from: { pos: P(this.L(2.0, 0.45, 0.8)), look: P(this.L(0.3, 0.3, 0.6)), mm: 32 }, to: { pos: P(this.L(1.85, 0.48, 0.75)), look: P(this.L(0.2, 0.34, 0.5)), mm: 34 }, ease: 'smooth' },
        // Close, front-left three-quarter: her in his lap as she sits up to him.
        { at: at(1.2), dur: 2.8, from: { pos: P(this.L(0.8, 0.5, 1.2)), look: P(this.L(0, 0.46, 0.3)), mm: 35 }, to: { pos: P(this.L(0.72, 0.5, 1.1)), look: P(this.L(0, 0.47, 0.3)), mm: 36 }, ease: 'smooth' },
        // Over her shoulder, up at his helm as he lifts his head to her.
        { at: at(4), dur: 4.5, from: { pos: P(this.L(0.14, 0.44, 1.0)), look: P(this.L(-0.02, 0.72, 0.18)), mm: 32 }, to: { pos: P(this.L(0.12, 0.43, 0.92)), look: P(this.L(-0.02, 0.76, 0.18)), mm: 34 }, ease: 'smooth' },
        // The two of them, three-quarter, the sunset behind.
        { at: at(8.5), dur: 6.5, from: { pos: P(this.L(1.5, 0.8, 1.65)), look: P(this.L(0, 0.48, 0.3)), mm: 32 }, to: { pos: P(this.L(1.3, 0.75, 1.4)), look: P(this.L(0, 0.48, 0.3)), mm: 34 }, ease: 'smooth' },
        // His helm, close, from his right.
        { at: at(15), dur: 4.5, from: { pos: P(this.L(-0.6, 0.86, 1.2)), look: P(this.L(-0.02, 0.78, 0.14)), mm: 40 }, to: { pos: P(this.L(-0.55, 0.85, 1.1)), look: P(this.L(-0.02, 0.78, 0.14)), mm: 42 }, ease: 'smooth' },
        // She curls up on his lap; his hand comes over her like a roof.
        { at: at(19.5), dur: 5.5, from: { pos: P(this.L(0.8, 0.62, 0.8)), look: P(this.L(0, 0.4, 0.3)), mm: 38 }, to: { pos: P(this.L(0.7, 0.58, 0.72)), look: P(this.L(0, 0.4, 0.3)), mm: 40 }, ease: 'smooth' },
        // Up and away: the tree on its rise, the two of them under it, the field at dusk.
        { at: at(25), dur: 7, from: { pos: P(this.L(2.2, 1.2, 4)), look: P(this.L(0, 1, 0)), mm: 32 }, to: { pos: P(this.L(8, 7, 16)), look: P(this.L(0, 2.5, 0)), mm: 30 }, ease: 'in' },
      ],
      marks: [
        { at: 0, who: 'kitten', path, speed: WALK, face: facing },
        { at: leap, who: 'kitten', path: [P(boot), P(lap)], speed: LEAP, face: facing, probe: 0.02, arc: 0.28 },
        { at: at(0.6), who: 'kitten', path: [P(lap)], speed: 1, face: FACE + Math.PI, probe: 0.02 },
        { at: at(19.6), who: 'kitten', path: [P(lap)], speed: 1, face: FACE + Math.PI / 2, probe: 0.02 },
      ],
      cues: [
        { at: 0.4, run: () => this.meow('mew', 0.8) },
        { at: arrive + 0.1, run: () => { kt.lookTarget = head.clone(); this.c.audio.play('breath', head, 1.1); } },
        { at: arrive + 0.9, run: () => this.meow('mew', 1) },
        { at: leap - 1.0, run: () => { kt.crouch = 1; } },
        { at: leap - 0.02, run: () => { kt.crouch = 0; } },
        { at: land, run: () => c.audio.play('thud', lap, 0.1) },
        { at: at(0.5), run: () => this.meow('mrrp', 0.9) },
        { at: at(1.4), run: () => { kt.sit = 1; } },
        { at: at(3.0), run: () => this.meow('meow', 1) },
        { at: at(4.3), run: () => { kn.lookTarget = lap.clone().add(new THREE.Vector3(0, 0.2, 0)); kn.headUp = 1; c.audio.play('breath', head, 0.9); } },
        { at: at(5.8), run: () => this.say(LINES[0]) },
        { at: at(9.2), run: () => this.meow('mew', 1) },
        { at: at(11.0), run: () => this.say(LINES[1]) },
        { at: at(14.6), run: () => c.audio.play('breath', head, 0.8) },
        { at: at(15.6), run: () => this.say(LINES[2]) },
        { at: at(19.4), run: () => this.meow('mrrp', 0.7) },
        { at: at(19.8), run: () => { kt.sit = 0; kt.curl = 1; } },
        { at: at(20.6), run: () => { kn.shelter = 1; } },
        { at: at(21.4), run: () => c.audio.play('purr', lap, 1.1) },
        { at: at(22.0), run: () => this.say(LINES[3]) },
        { at: at(26), run: () => c.audio.play('purr', lap, 0.7) },
      ],
      onEnd: () => this.title(),
    };
    // His lap as her ground, so her paws stand on his thighs (not through them to the grass).
    c.physics.addBox(lap.clone().add(new THREE.Vector3(0, -0.03, 0)), new THREE.Vector3(0.14, 0.03, 0.13), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE), { kind: 'cloth' }, L.detail);
    this.music = c.audio.theme(0.9);
    c.timeline.play(cs);
  }
  music: { stop: (f?: number) => void } | null = null;
  toLocal(p: THREE.Vector3) {
    const c = Math.cos(FACE), s = Math.sin(FACE), dx = p.x - SEAT.x, dz = p.z - SEAT.z;
    return new THREE.Vector3(c * dx - s * dz, p.y - SEAT.y, s * dx + c * dz);
  }
  dir(x: number, y: number, z: number) { const c = Math.cos(FACE), s = Math.sin(FACE); return new THREE.Vector3(c * x + s * z, y, -s * x + c * z); }

  async title() {
    const c = this.c;
    this.stage = 'end';
    this.music?.stop(9);
    c.hud.fadeLevel(1);
    c.hud.subtitle(null);
    await c.hud.card('', 'WHISKER', '', 3.2);
    if (dir !== this) return;
    await c.hud.card('', '', 'Two summers later.', 2.4);
    if (dir !== this) return;
    c.next('moor');
  }

  update(dt: number, t: number) {
    const c = this.c;
    BANNER_TIME.value += dt;
    for (const s of this.smokes) s.update(dt);
    for (const f of this.fires) f.update(dt, t);
    this.crows.update(dt, t);
    const kb = this.k.char.body;
    water.update(dt, [{ key: kb, pos: kb.pos, speed: Math.hypot(kb.vel.x, kb.vel.z), size: 0.7 }]);
    this.answerT = Math.max(0, this.answerT - dt);
    if (c.timeline.playing || this.stage !== 'walk') return;
    const kp = kb.pos;
    const d = kp.distanceTo(SEAT);
    // His breathing, as she comes near; a crow now and then.
    this.breathT -= dt;
    if (this.breathT < 0) {
      this.breathT = 4 + Math.random() * 2;
      if (d < 26) c.audio.play('breath', SEAT, THREE.MathUtils.clamp(1.6 - d / 20, 0.2, 1.3));
      else if (Math.random() < 0.35) c.audio.play('caw', new THREE.Vector3(TREE.x, height(0, 0) + 12, TREE.z), 0.8);
    }
    const hint = (id: string, cond: boolean, text: string, secs = 5) => { if (cond && !this.hints.has(id)) { this.hints.add(id); c.hud.say(text, secs); } };
    hint('log', Math.hypot(kp.x - (LOG.a.x + LOG.b.x) / 2, kp.z - (LOG.a.y + LOG.b.y) / 2) < 9 && kp.z > 97, c.touch() ? 'A fallen tree. <b>Jump</b> (hold it to jump higher).' : 'A fallen tree. <b>Space</b> jumps (hold it to jump higher).', 5);
    hint('swim', kb.swimming, 'She swims. Paddle across, and <b>jump</b> to climb out at the far bank.', 5);
    this.walkT += dt;
    hint('lost', this.walkT > 70, c.touch() ? 'Lost? <b>Meow</b>, and listen for him. Follow the crows.' : 'Lost? <b>Q</b> to meow, and listen for him. Follow the crows.', 6);
    if (this.toLocal(kp).z > 0.3 && Math.hypot(kp.x - SEAT.x, kp.z - SEAT.z) < 2.6 && Math.abs(kp.y - SEAT.y) < 1) this.found();
    else if (d < 2.2) this.found();
  }
}

let dir: Director | null = null;

export const prologue: Level = {
  id: 'prologue', title: 'Prologue: The Hawthorn', look: 'dusk',
  async build(c: Ctx) {
    _campH = null; _seatH = null;
    water.pools.length = 0;
    // The stream across the whole valley.
    const sl = Math.min(...[-120, -80, -40, -5, 30, 70, 110].map((x) => raw(x, STREAM.z + (x - STREAM.x) * STREAM.rot))) - 0.35;
    water.add({ x: STREAM.x, z: STREAM.z, rx: STREAM.rx, rz: STREAM.rz, rot: -STREAM.rot, level: sl, depth: 1.0, rect: true });
    TREE.y = height(0, 0); SEAT.y = height(SEAT.x, SEAT.z); CAMP.y = campH(); MOTHER.y = campH();
    const t = new Terrain({
      cx: 0, cz: 55, half: 178, step: 2, height, farHalf: 2600, farStep: 60,
      color: (x, z, h, slope) => {
        const g = col('#626d50').lerp(col('#4c4e3e'), THREE.MathUtils.clamp(0.5 + n2.noise(x / 22, z / 22) * 0.7, 0, 1));
        g.lerp(col('#96927b'), THREE.MathUtils.clamp(n1.noise(x / 35 + 9, z / 35) * 0.8, 0, 0.45));
        const tr = trackDist(x, z);
        g.lerp(col('#6a6354'), (1 - THREE.MathUtils.smoothstep(tr, 0.6, 2.2)) * 0.85);
        const wl = water.surfaceAt(x, z);
        if (wl !== null && h < wl + 0.25) g.lerp(col('#6a5640'), THREE.MathUtils.clamp((wl + 0.25 - h) * 3, 0, 1));
        g.lerp(col('#7a6a58'), THREE.MathUtils.clamp(slope * 1.2 - 0.5, 0, 0.8));
        if (Math.hypot(x - CAMP.x, z - CAMP.z) < 6) g.lerp(col('#6a6354'), 0.5);
        return g;
      },
      grass: (x, z, h, slope) => {
        const wl = water.surfaceAt(x, z);
        if (wl !== null && h < wl + 0.06) return 0;
        const tr = THREE.MathUtils.smoothstep(trackDist(x, z), 1.0, 2.6);
        const camp = THREE.MathUtils.smoothstep(Math.hypot(x - CAMP.x, z - CAMP.z), 4.5, 7);
        const seat = THREE.MathUtils.smoothstep(Math.hypot(x - SEAT.x, z - SEAT.z), 1.6, 3);
        return tr * camp * seat * (1 - THREE.MathUtils.clamp(slope - 0.8, 0, 1)) * 0.95;
      },
    });
    terrain = t;
    c.setTerrain(t, { root: '#39443a', mid: '#707d59', tip: '#a5a78a', dry: '#989078', height: 0.26 });
    const H = (x: number, z: number) => t.heightAt(x, z);
    const p = c.look.preset;
    c.root.add(water.build(H, { sunDir: c.look.sunDir, sun: new THREE.Color(p.sun).multiplyScalar(p.sunIntensity * 0.45), sky: new THREE.Color(p.hemiSky), horizon: new THREE.Color(p.horizon) }));
    WATER.surface = (x, z) => water.surfaceAt(x, z);
    WIND.dir.set(0.7, -0.7).normalize(); WIND.base = 0.8;

    // ---- The hawthorn.
    const ht = hawthorn(5);
    ht.group.position.set(TREE.x, TREE.y - 0.1, TREE.z);
    ht.group.rotation.y = FACE + Math.PI * 0.65;
    c.root.add(ht.group);
    c.physics.addFixed(RAPIER.ColliderDesc.cylinder(1.6, 0.3).setTranslation(TREE.x, TREE.y + 1.5, TREE.z), { kind: 'wood' }, L.world);

    // ---- The rim: woods round the valley's edge, scattered trees and boulders inside it.
    const R = rng(11);
    const ring: { x: number; y: number; z: number; s: number }[] = [], pines: typeof ring = [];
    for (let i = 0; i < 230; i++) {
      const a = (i / 230) * Math.PI * 2 + R() * 0.03, rr = 140 + R() * 26;
      const x = CENTER.x + Math.cos(a) * rr, z = CENTER.y + Math.sin(a) * rr * 1.12;
      (i % 3 ? ring : pines).push({ x, y: H(x, z) - 0.2, z, s: 1.1 + R() * 0.8 });
    }
    c.root.add(forest(TREES.oak, ring, c.physics, 4, 3, true), forest(TREES.pine, pines, c.physics, 3, 5, true));
    const lone: typeof ring = [];
    for (const [x, z] of [[-60, 40], [55, 95], [70, 20], [-80, 100], [40, -40], [-50, -20]]) lone.push({ x, y: H(x, z) - 0.1, z, s: 1.2 });
    c.root.add(forest(TREES.oak, lone, c.physics, 3, 9));
    const rocks: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const x = -120 + R() * 240, z = -40 + R() * 200;
      if (Math.hypot(x - CENTER.x, (z - CENTER.y) / 1.12) > 132 || trackDist(x, z) < 4 || water.surfaceAt(x, z) !== null || Math.hypot(x, z) < 12 || Math.hypot(x - CAMP.x, z - CAMP.z) < 14) continue;
      rocks.push({ x, y: H(x, z) - 0.1, z, s: 0.4 + R() * 1.0 });
    }
    c.root.add(boulders(rocks, c.physics));
    const fl: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 900; i++) {
      const x = -110 + R() * 220, z = -30 + R() * 180;
      if (water.surfaceAt(x, z) !== null || trackDist(x, z) < 2) continue;
      fl.push({ x, y: H(x, z), z });
    }
    c.root.add(flowers(fl, ['#f2efe0', '#f3d35b', '#d79ad8']));

    // ---- The battle's wreckage, thickest between the stream and the camp, thinning toward the tree.
    const b = new Batch(c.physics, 60);
    const houses = [PAL.bannerRed, PAL.bannerBlue, '#6a7a3c'];
    for (let i = 0; i < 26; i++) {
      const x = -70 + R() * 110, z = 20 + R() * 100;
      if (water.surfaceAt(x, z) !== null || Math.hypot(x - CAMP.x, z - CAMP.z) < 9 || trackDist(x, z) < 1.4) continue;
      fallen(b, new THREE.Vector3(x, H(x, z) - 0.04, z), R() * 6.28, houses[i % 3], R() < 0.4);
      shield(b, M(new THREE.Vector3(x + 1.0, H(x + 1, z + 0.4) + 0.02, z + 0.4), R() * 6.28), [houses[i % 3], PAL.cream]);
    }
    for (let i = 0; i < 90; i++) {
      const x = -80 + R() * 130, z = 10 + R() * 115;
      if (water.surfaceAt(x, z) !== null || Math.hypot(x - CAMP.x, z - CAMP.z) < 7 || Math.hypot(x, z) < 6) continue;
      const k = R();
      if (k < 0.45) spear(b, new THREE.Vector3(x, H(x, z), z), R() * 6.28, 0.2 + R() * 0.5, R() < 0.35);
      else if (k < 0.65) shield(b, M(new THREE.Vector3(x, H(x, z) + 0.02, z), R() * 6.28, (R() - 0.5) * 0.3), [houses[i % 3], PAL.cream]);
      else if (k < 0.8) sword(b, M(new THREE.Vector3(x, H(x, z) + 0.02, z), R() * 6.28));
      else if (k < 0.9) helmet(b, M(new THREE.Vector3(x, H(x, z), z), R() * 6.28, R() < 0.5 ? Math.PI / 2 : 0));
      else wheel(b, M(new THREE.Vector3(x, H(x, z) + 0.05, z), R() * 6.28, Math.PI / 2), 0.5);
    }
    for (const [x, z, y] of [[-18, 108, 0.6], [-44, 102, 2.2], [-8, 52, -0.9], [-36, 58, 1.4], [16, 34, 0.3]] as const) overturnedCart(b, new THREE.Vector3(x, H(x, z) - 0.05, z), y);
    // The camp: the wagon on its side, barrels, crates, sacks, the mother under a blanket.
    wagonOnSide(b, CAMP.clone().add(new THREE.Vector3(-2.8, -0.05, -0.8)), 0.45);
    barrel(b, M(CAMP.clone().add(new THREE.Vector3(2.2, 0.28, 1.6)), 0.4, 0, Math.PI / 2));
    b.collide(CAMP.clone().add(new THREE.Vector3(2.2, 0.28, 1.6)), new THREE.Vector3(0.3, 0.28, 0.42), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));
    crate(b, M(CAMP.clone().add(new THREE.Vector3(-1.2, 0.35, 2.4)), 0.4));
    b.collide(CAMP.clone().add(new THREE.Vector3(-1.2, 0.35, 2.4)), new THREE.Vector3(0.36, 0.36, 0.36), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));
    sack(b, M(CAMP.clone().add(new THREE.Vector3(0.6, 0.15, 2.2)), 1.2));
    sack(b, M(CAMP.clone().add(new THREE.Vector3(-3.6, 0.15, 1.6)), 0.2));
    c.root.add(b.build());
    // The fallen tree across the track (she jumps it): a trunk with a root plate.
    {
      const a3 = new THREE.Vector3(LOG.a.x, 0, LOG.a.y), b3 = new THREE.Vector3(LOG.b.x, 0, LOG.b.y);
      const mid = a3.clone().lerp(b3, 0.5), len = a3.distanceTo(b3), yaw = Math.atan2(b3.x - a3.x, b3.z - a3.z);
      const y = Math.min(H(a3.x, a3.z), H(mid.x, mid.z), H(b3.x, b3.z)) + LOG.r - 0.06;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(LOG.r * 0.85, LOG.r, len, 12).rotateX(Math.PI / 2), toy('#6b4a33'));
      trunk.position.set(mid.x, y, mid.z); trunk.rotation.y = yaw; trunk.castShadow = true; trunk.receiveShadow = true;
      c.root.add(trunk);
      const roots = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.3, 10).rotateX(Math.PI / 2), toy('#5a4030'));
      roots.position.copy(a3).setY(y + 0.3); roots.rotation.y = yaw; roots.castShadow = true;
      c.root.add(roots);
      c.physics.addFixed(RAPIER.ColliderDesc.capsule(len / 2, LOG.r).setTranslation(mid.x, y, mid.z).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'))), { kind: 'wood' }, L.world);
      c.physics.addFixed(RAPIER.ColliderDesc.cylinder(0.15, 1.0).setTranslation(a3.x, y + 0.3, a3.z).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'))), { kind: 'wood' }, L.world);
    }
    // The mother: a hump under a patched blanket, her tail out from under it.
    {
      const g = new THREE.Group();
      g.position.copy(MOTHER); g.rotation.y = 0.5;
      const geo = new THREE.PlaneGeometry(0.9, 0.7, 20, 20).rotateX(-Math.PI / 2);
      const pp = geo.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), z = pp.getZ(i);
        const body = Math.max(0, 1 - (x / 0.27) ** 2 - (z / 0.16) ** 2);
        pp.setY(i, 0.01 + 0.15 * Math.sqrt(body) + 0.01 * Math.sin(x * 20 + z * 9) * (1 - body));
      }
      geo.computeVertexNormals();
      const blanket = new THREE.Mesh(geo, toy('#9a4c3f', { side: THREE.DoubleSide }));
      blanket.castShadow = true; blanket.receiveShadow = true;
      g.add(blanket);
      const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.28, 0.03, 0.05), new THREE.Vector3(0.42, 0.03, 0.12), new THREE.Vector3(0.5, 0.03, 0.02), new THREE.Vector3(0.55, 0.05, -0.08)]), 12, 0.03, 8), toy(PAL.ginger));
      tail.castShadow = true;
      g.add(tail);
      c.root.add(g);
      c.physics.addBox(MOTHER.clone().add(new THREE.Vector3(0, 0.08, 0)), new THREE.Vector3(0.3, 0.08, 0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5), { kind: 'cloth' }, L.detail);
    }
    // Banners on poles across the field, some fallen.
    for (const [x, z, color, lean] of [[-14, 112, PAL.bannerRed, 0.15], [-40, 84, PAL.bannerBlue, -0.25], [10, 62, PAL.bannerRed, 0.35], [-25, 40, PAL.bannerBlue, 0.1], [22, 18, PAL.bannerRed, -0.2], [-6, 12, PAL.bannerBlue, 0.05], [-58, 66, PAL.bannerRed, 0.6], [34, 80, PAL.bannerBlue, 0.25]] as const) {
      const bn = banner(color, 3.2, 0.7, 1.3, lean as number);
      bn.position.set(x as number, H(x as number, z as number) - 0.2, z as number);
      bn.rotation.y = Math.atan2(-WIND.dir.y, WIND.dir.x);
      c.root.add(bn);
    }
    // The broken footbridge over the stream (where the track crosses), its middle fallen in.
    {
      const bx = -20, bz = STREAM.z + (bx - STREAM.x) * STREAM.rot;
      for (const s of [-1, 1]) {
        const z = bz + s * (STREAM.rz + 0.6);
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.0), toy(PAL.stone));
        pier.position.set(bx, H(bx, z) + 0.4, z); pier.castShadow = true; pier.receiveShadow = true;
        c.root.add(pier);
        c.physics.addBox(pier.position, new THREE.Vector3(1.1, 0.8, 0.5), undefined, { kind: 'stone' });
      }
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 3.4), toy(PAL.woodDark));
      plank.position.set(bx + 0.3, water.pools[0].level + 0.05, bz); plank.rotation.set(0.15, 0.3, 0.2);
      c.root.add(plank);
    }
    // Smoke over the horizon, the camp's dying fire.
    const smokes: Smoke[] = [];
    for (const [x, z, h] of [[70, -50, 40], [-95, -30, 34], [55, 140, 30], [-110, 90, 36], [110, 40, 42], [-30, -80, 45]] as const) {
      const s = new Smoke(new THREE.Vector3(x, H(x, z), z), h, 26, '#4d4652', 0.5, 1.4);
      smokes.push(s); c.root.add(s.mesh);
    }
    const fire = new Fire(CAMP.clone().add(new THREE.Vector3(1.6, 0, -1.4)), 0.8);
    fire.group.position.y = H(fire.group.position.x, fire.group.position.z);
    c.root.add(fire.group, fire.smoke.mesh);
    dir = new Director(c);
    (globalThis as any).__prologue = dir;
    dir.smokes = smokes; dir.fires = [fire];
    c.root.add(dir.crows.group);
    const ks = CAMP.clone().add(new THREE.Vector3(0.55, 0, 0.15)); ks.y = H(ks.x, ks.z);
    return {
      killY: -40, killZones: [],
      spawn: { kitten: { pos: ks, yaw: Math.atan2(MOTHER.x - ks.x, MOTHER.z - ks.z) }, knight: { pos: SEAT.clone(), yaw: FACE } },
    };
  },
  start(c, checkpoint) {
    dir!.start();
    if (checkpoint === 'walk') { dir!.startWalk(); c.hud.fadeLevel(0); }
  },
  begin() { if (dir && dir.stage === 'title') dir.opening(); },
  update(dt, c) { dir?.update(dt, (c as any).time ?? performance.now() / 1000); },
  call() { dir?.heard(); },
  hint(c) { if (dir?.stage === 'walk') c.hud.say('Follow the crows over the lone hawthorn. Meow with Q and listen for his breathing.', 6); },
  dispose() { dir?.music?.stop(0.4); dir = null; },
  warmViews() {
    const h = height;
    return [
      { pos: [CAMP.x - 22, campH() + 16, CAMP.z + 32], look: [0, h(0, 0) + 4, 0] },
      { pos: [SEAT.x + 2.6, SEAT.y + 1.2, SEAT.z + 3.4], look: [SEAT.x, SEAT.y + 0.6, SEAT.z] },
    ] as any;
  },
};

// Debug and tests: places and the director.
export const PROLOGUE = { TREE, SEAT, CAMP, FACE, LOG, STREAM, get dir() { return dir; } };
