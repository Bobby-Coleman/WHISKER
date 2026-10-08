// Her Chapter One form: the little knight on two legs (kitten/bipedModel.ts) on the animation library's skeleton
// (avatar.ts). The clips give her idle, walk, jog, sprint, jumps, landings and a crouch; over them she poses herself:
// her longsword held upright before her in both paws when she stands (as in the photo), on her shoulder when she
// moves, aloft out of the water when she swims, slung on her back when she climbs or is carried; paw over paw up a
// face and a pull-up over the top; an upright dog-paddle; held under her arms with her legs dangling; tumbling when
// thrown and landing on her feet; hunkered into the wind; sitting and curled up asleep when a story asks. Her head
// turns to what she looks at, she blinks, her ears twitch, her tail swings on springs, and her long cream cape
// (cape.ts) hangs from her shoulders and blows behind her without passing through her.
import * as THREE from 'three';
import { PoseContext, WIND } from '../../body';
import { toy, Fade } from '../../render/materials';
import { Avatar } from '../avatar';
import { buildBiped, BipedModel, KITTEN_PROPS, SWORD, FIST, TAIL_N } from './bipedModel';
import { Cape, Ball } from './cape';
import type { KittenForm, KittenHost, Meow } from './form';

const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop'];
const GAITS = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop'];
// Ground speeds (m/s) at which each loop is fully on (her legs cycle faster than the loops' own pace: she scurries).
const SPEED = { walk: 0.8, jog: 2.2, sprint: 3.3 };
const CLIMB_DIST = 0.075; // (climb.ts) her body's distance from the face
const SWIM_FLOAT = 0.1; // (motor.ts) her feet under the surface while she swims
const LONG_CAPE = { cols: 6, rows: 7, w0: 0.15, w1: 0.28, len: 0.22, drape: 0.058, trim: false, folds: { n: 3.5, amp: 0.0055 } };

const V = () => new THREE.Vector3();
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
type Side = 'l' | 'r';
type Mode = 'hold' | 'shoulder' | 'aloft' | 'back' | 'lap' | 'ground';
const MODES: Mode[] = ['hold', 'shoulder', 'aloft', 'back', 'lap', 'ground'];
// How much of a place's orientation is kept upright in her frame rather than turned with her chest.
const UPRIGHT: Record<Mode, number> = { hold: 0.6, shoulder: 0.65, aloft: 0.5, back: 0, lap: 0, ground: 0 };
const _a = V(), _b = V(), _c = V(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class BipedKitten implements KittenForm {
  root = new THREE.Group();
  private av = new Avatar(KITTEN_PROPS);
  m!: BipedModel;
  private cape!: Cape;
  private ready = false;
  private t = 0;
  // Eased state.
  private spd = 0; private moveW = 0; private turn = 0; private lastYaw = 0;
  private w = { air: 0, swim: 0, climb: 0, carry: 0, sit: 0, crouch: 0, curl: 0, nudge: 0, wind: 0 };
  private land = 0; private takeoff = -1; private wasGrounded = true; private dip = 0; private airTime = 0;
  private tumble = -1; private tumbleRate = 0; private wasCarried = false;
  private stillT = 0; private swimPh = 0;
  private climbOver = 0; private climbRef: number | null = null; private climbT = 0;
  private sw: Record<Mode, number> = { hold: 1, shoulder: 0, aloft: 0, back: 0, lap: 0, ground: 0 };
  private swordRel = {} as Record<Mode, THREE.Matrix4>;
  private swordUp = {} as Record<Mode, THREE.Quaternion>;
  private pauldronRel: { c: THREE.Quaternion; u: THREE.Quaternion }[] = [];
  private tail0Q = new THREE.Quaternion();
  // Face and secondary motion.
  private blinkT = 2; private blink = -1; private twitch = [{ t: 3, a: -1 }, { t: 5, a: -1 }];
  private glance = { t: 2, watch: true }; private earA = V(); private lid = 0; private mouth = 0; private ear = V();
  private meowS: { t: number; dur: number; amt: number; open: number; roll: number; cry: boolean } | null = null;
  private tailP = new Float32Array(TAIL_N * 2); private tailA = new Float32Array(TAIL_N * 2); private tailV = new Float32Array(TAIL_N * 2);
  private lastVy = 0;
  // The cape's pins and colliders (relative to her chest at rest), and its frame-to-frame motion.
  private pinRel: THREE.Vector3[] = [];
  private balls: Ball[] = [];
  private caps: { a: THREE.Vector3; b: THREE.Vector3; r: number; deep: boolean }[] = [];
  private capeLast: THREE.Vector3 | null = null;
  private back = V();

  constructor(private host: KittenHost, private fade: Fade) {}

  async load() {
    const av = this.av;
    await av.load(CLIPS);
    // Made (and baked onto the skeleton) at its rest pose, before any clip has moved it.
    this.m = buildBiped(av, this.fade);
    this.root.add(av.root);
    this.root.name = 'kittenKnight';
    for (const n of GAITS) av.manual(n, true);
    av.alignLoops(['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop']);
    for (const n of ['Jump_Start', 'Jump_Land']) {
      const c = av.clip(n)!;
      for (const a of [c.lower, c.upper]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 0; }
    }
    this.tail0Q.copy(this.m.tail[0].quaternion);
    // Where the sword sits in each of its places, relative to her chest at rest (on the ground: to her feet).
    const chestRest = new THREE.Matrix4().compose(av.restP.get('spine_03')!, av.restQ.get('spine_03')!, new THREE.Vector3(1, 1, 1));
    const chestInv = chestRest.clone().invert();
    const place = (guard: THREE.Vector3, blade: THREE.Vector3, edge: THREE.Vector3) => {
      const Y = blade.clone().normalize(), X = edge.clone().addScaledVector(Y, -edge.dot(Y)).normalize(), Z = new THREE.Vector3().crossVectors(X, Y);
      return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(guard);
    };
    // Upright before her right shoulder, guard at her chin (the photo); on her right shoulder, the blade back over it;
    // aloft (swimming); slung across her back, hilt over her left shoulder; across her lap; on the ground by her.
    this.swordRel.hold = chestInv.clone().multiply(place(new THREE.Vector3(-0.02, 0.232, 0.08), new THREE.Vector3(-0.03, 1, 0.05), new THREE.Vector3(1, 0, 0)));
    this.swordRel.shoulder = chestInv.clone().multiply(place(new THREE.Vector3(-0.052, 0.217, 0.052), new THREE.Vector3(-0.17, 0.45, -0.88), new THREE.Vector3(0.2, 0.88, 0.3)));
    this.swordRel.aloft = chestInv.clone().multiply(place(new THREE.Vector3(-0.085, 0.29, 0.03), new THREE.Vector3(-0.15, 0.8, -0.55), new THREE.Vector3(0, 0.5, 0.8)));
    this.swordRel.back = chestInv.clone().multiply(place(new THREE.Vector3(0.05, 0.29, -0.058), new THREE.Vector3(-0.4, -0.9, -0.02), new THREE.Vector3(0, 0, 1)));
    this.swordRel.lap = chestInv.clone().multiply(place(new THREE.Vector3(-0.05, 0.118, 0.07), new THREE.Vector3(1, 0.02, 0.15), new THREE.Vector3(0, 0, -1)));
    this.swordRel.ground = place(new THREE.Vector3(-0.12, 0.006, -0.1), new THREE.Vector3(1, 0, 0.06), new THREE.Vector3(0, 0, -1));
    // Each place's orientation in her own (upright) frame: a held sword keeps mostly upright as she leans.
    for (const k of MODES) this.swordUp[k] = new THREE.Quaternion().setFromRotationMatrix(k === 'ground' ? this.swordRel[k] : chestRest.clone().multiply(this.swordRel[k]));
    // The pauldrons' frames, taken with her arms hanging as they idle.
    av.weight('Idle_Loop', 1);
    av.evaluate(0);
    this.root.updateMatrixWorld(true);
    for (const s of ['l', 'r'] as Side[]) {
      const qU = av.quat(`upperarm_${s}`).multiply(av.restQ.get(`upperarm_${s}`)!.clone().invert());
      this.pauldronRel.push({ c: av.quat(`clavicle_${s}`).invert().multiply(qU), u: av.restQ.get(`upperarm_${s}`)!.clone().invert() });
    }
    av.weight('Idle_Loop', 0);
    // The cape: pinned round the back of her neck to the tops of her pauldrons.
    this.cape = new Cape(toy('#ffffff', { vertexColors: true, rough: 0.95, side: THREE.DoubleSide, fade: this.fade }), LONG_CAPE);
    this.root.add(this.cape.mesh);
    for (let i = 0; i < this.cape.cols; i++) {
      const a = lerp(-1.5, 1.5, i / (this.cape.cols - 1));
      this.pinRel.push(new THREE.Vector3(Math.sin(a) * 0.06, 0.222 + 0.012 * Math.abs(Math.sin(a)), -0.036 * Math.cos(a) + 0.006).applyMatrix4(chestInv));
    }
    for (let i = 0; i < 6; i++) this.balls.push({ c: V(), r: 0.05, up: new THREE.Vector3(0, 1, 0) });
    for (let i = 0; i < 7; i++) this.caps.push({ a: V(), b: V(), r: 0.05, deep: false });
    this.cape.balls = this.balls;
    this.cape.shape = (P, o) => this.capsulePush(P, o);
    this.ready = true;
    this.applyOutfit();
  }

  applyOutfit() {
    if (!this.m) return;
    const o = this.host.outfit, m = this.m;
    m.face.showBow(o.bow);
    this.cape.mesh.visible = o.cape;
    // Without armour (should a story want her on two legs bare): no plate, mail, leather or sword, her furry limbs.
    for (const x of [m.steel, m.mail, m.gear]) x.visible = o.armour;
    m.bare.visible = !o.armour;
  }

  meow(kind: Meow) {
    const [dur, amt, open, roll] = ({ meow: [0.55, 0.26, 0.8, 0], mew: [0.32, 0.16, 0.5, 0.04], mrrp: [0.38, 0.1, 0.38, 0.3], cry: [0.95, 0.4, 1.1, 0] } as const)[kind];
    this.meowS = { t: 0, dur, amt, open, roll: roll * (Math.random() < 0.5 ? -1 : 1), cry: kind === 'cry' };
  }

  reset(ground: (x: number, z: number) => number) {
    if (!this.ready) return;
    const h = this.host, b = h.body;
    const carried = h.carriedBy !== null, climbing = !!b.climb && !carried, swimming = b.swimming && !carried && !climbing;
    Object.assign(this.w, { carry: carried ? 1 : 0, climb: climbing ? 1 : 0, swim: swimming ? 1 : 0, air: 0, sit: h.sit, crouch: h.crouch, curl: h.curl, nudge: h.nudge, wind: b.wind });
    this.spd = 0; this.moveW = 0; this.turn = 0; this.lastYaw = h.renderYaw; this.land = 0; this.takeoff = -1; this.dip = 0;
    this.tumble = -1; this.wasCarried = carried; this.wasGrounded = b.grounded; this.stillT = 1;
    this.airTime = this.climbOver = this.climbT = 0; this.climbRef = null;
    this.av.resetGrounding();
    this.lastVy = b.vy;
    this.tailA.fill(0); this.tailV.fill(0);
    this.snap = true;
    this.pose(0, { dt: 0, time: this.t, ground, lookAt: null, active: false });
    this.resetCloth();
  }
  private snap = false;

  // ---- Her group's space (x her left, y up, z her front; origin at her feet) and the world.
  private L(x: number, y: number, z: number, out = V()) { return out.set(x, y, z).applyMatrix4(this.host.group.matrixWorld); }
  private D(x: number, y: number, z: number, out = V()) { return out.set(x, y, z).transformDirection(this.host.group.matrixWorld); }
  private local(p: THREE.Vector3, out = V()) { return out.copy(p).applyMatrix4(_m2.copy(this.host.group.matrixWorld).invert()); }

  // ================================================================ The pose, each rendered frame.
  pose(dt: number, ctx: PoseContext) {
    if (!this.ready) return;
    const h = this.host, b = h.body, av = this.av, w = this.w, snap = this.snap;
    this.snap = false;
    this.t += dt;
    const E = (v: number, to: number, k: number) => (snap ? to : v + (to - v) * ease(k, dt));
    const carried = h.carriedBy !== null, climbing = !!b.climb && !carried, swimming = b.swimming && !carried && !climbing;
    const airborne = !b.grounded && !swimming && !climbing && !carried;
    this.airTime = airborne ? this.airTime + dt : 0;
    // Thrown: let go of in the air going up fast, she tumbles head over heels and comes round to land on her feet.
    if (this.wasCarried && !carried && airborne && b.vy > 2.5) { this.tumble = 0; this.tumbleRate = 0; }
    this.wasCarried = carried;
    if (this.tumble >= 0) {
      // One full turn, timed to finish as she comes down to where she was let go.
      const left = TAU - this.tumble, tLand = Math.max(0.12, (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * 22 * 0.4))) / 22 - 0.12);
      this.tumbleRate = clamp(left / tLand, 5, 16);
      this.tumble += this.tumbleRate * dt;
      if (this.tumble >= TAU || !airborne) this.tumble = -1;
    }
    w.carry = E(w.carry, carried ? 1 : 0, 10);
    // Climbing, and over the top.
    if (climbing) {
      this.climbT += dt;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      const f = b.pos.x * fx + b.pos.z * fz;
      if (this.climbRef === null || this.climbT < 0.3) this.climbRef = f;
      this.climbOver = Math.max(0, f - this.climbRef);
    } else { this.climbOver = 0; this.climbRef = null; this.climbT = 0; }
    if (b.climb?.exit && !carried) { const a = b.climb.exit.t / b.climb.exit.dur; w.climb = Math.min(E(w.climb, 1, 12), 1 - ss(0.55, 1.0, a)); }
    else w.climb = E(w.climb, climbing ? 1 : 0, 12);
    w.swim = E(w.swim, swimming ? 1 : 0, 7);
    w.air = E(w.air, airborne && (this.airTime > 0.06 || b.vy > 0.6) ? 1 : 0, airborne ? 12 : 18);
    w.sit = E(w.sit, clamp(h.sit, 0, 1), 5); w.crouch = E(w.crouch, clamp(h.crouch, 0, 1), 8);
    w.curl = E(w.curl, clamp(h.curl, 0, 1), 3); w.nudge = E(w.nudge, clamp(h.nudge, 0, 1), 8);
    w.wind = E(w.wind, carried || climbing || swimming ? 0 : b.wind, 4);
    b.landing = Math.max(0, b.landing - dt * 3.2);
    const free = (1 - w.climb) * (1 - w.carry) * (1 - w.swim);
    const story = Math.max(w.sit, w.curl) * free * (1 - w.air);

    // ---------- Clips: locomotion by speed, cycling as fast as her short legs can.
    const held = carried || climbing;
    const rawSp = held || story > 0.5 ? 0 : Math.hypot(b.vel.x, b.vel.z);
    this.spd = E(this.spd, rawSp, 12);
    const sp = this.spd;
    const dyaw = Math.atan2(Math.sin(h.renderYaw - this.lastYaw), Math.cos(h.renderYaw - this.lastYaw));
    this.lastYaw = h.renderYaw;
    if (dt > 0) this.turn += (clamp(dyaw / dt, -12, 12) - this.turn) * ease(8, dt);
    const turnStep = clamp(Math.abs(this.turn) * 0.05 - sp, 0, 0.25);
    const gsp = Math.max(sp, turnStep);
    let wi = 0, ww = 0, wj = 0, ws = 0;
    if (gsp < 0.05) wi = 1;
    else if (gsp < SPEED.walk) { const t = (gsp - 0.05) / (SPEED.walk - 0.05); wi = 1 - t; ww = t; }
    else if (gsp < SPEED.jog) { const t = (gsp - SPEED.walk) / (SPEED.jog - SPEED.walk); ww = 1 - t; wj = t; }
    else if (gsp < SPEED.sprint) { const t = (gsp - SPEED.jog) / (SPEED.sprint - SPEED.jog); wj = 1 - t; ws = t; }
    else ws = 1;
    this.moveW = E(this.moveW, gsp > 0.08 ? 1 : 0, 6);
    const hz = gsp < 0.05 ? 0 : clamp(1.0 + 1.2 * gsp, 1.0, 5.2);
    if (!snap) av.phase = (av.phase + hz * dt * 0.5) % 1;
    for (const n of GAITS) { const l = av.clip(n)!; av.time(n, ((av.phase + l.offset) % 1) * l.dur); }
    // In the air: the take-off, then the air loop; a landing.
    if (airborne && this.wasGrounded && b.vy > 0.5 && this.tumble < 0) this.takeoff = 0;
    if (b.grounded && !this.wasGrounded && !snap) {
      const s = clamp(Math.max(b.landing, 0.25), 0, 1);
      this.dip = Math.max(this.dip, 0.008 + 0.014 * s);
      if (b.landing > 0.15 && sp < 1.5) { av.time('Jump_Land', 0.06); this.land = clamp(0.4 + b.landing, 0, 1); }
    }
    this.wasGrounded = b.grounded || climbing || swimming || carried;
    this.land = Math.max(0, this.land - dt * (sp > 0.8 ? 4 : 1.8));
    const landC = av.clip('Jump_Land')!;
    if (this.land > 0) av.time('Jump_Land', Math.min(landC.dur, landC.lower.time + dt * 1.25));
    let startW = 0;
    if (this.takeoff >= 0) {
      this.takeoff += dt;
      av.time('Jump_Start', Math.min(0.6, 0.22 + this.takeoff * 1.4));
      startW = 1 - ss(0.2, 0.4, this.takeoff);
      if (this.takeoff > 0.45 || !airborne) this.takeoff = -1;
    }
    av.time('Jump_Loop', (this.t * 0.6) % av.clip('Jump_Loop')!.dur);
    // Crouched (asked, or hunkered against the wind).
    const crouch = Math.max(w.crouch, w.wind * 0.75) * free;
    const groundW = (1 - w.air) * free;
    const landW = this.land * 0.7 * groundW;
    const locoW = groundW * (1 - landW);
    const wcI = crouch * (1 - this.moveW), wcF = crouch * this.moveW;
    const cw: [string, number][] = [
      ['Walk_Loop', ww * locoW * (1 - crouch)], ['Jog_Fwd_Loop', wj * locoW * (1 - crouch)], ['Sprint_Loop', ws * locoW * (1 - crouch)],
      ['Crouch_Idle_Loop', wcI * locoW], ['Crouch_Fwd_Loop', wcF * locoW], ['Jump_Land', landW],
      ['Jump_Start', w.air * startW * free], ['Jump_Loop', w.air * (1 - startW) * free],
    ];
    let tot = 0;
    for (const [n, x] of cw) { av.weight(n, x); tot += x; }
    // The idle fills the rest (never the skeleton's bind pose).
    av.weight('Idle_Loop', Math.max(0, 1 - tot));
    // Her own root: lowered into the knight's hands (held under her arms), or turning head over heels.
    const r = av.root;
    r.position.set(0, -0.19 * w.carry, 0); r.quaternion.identity();
    // Asleep: lying on her right side, settled on the ground.
    const curlK = w.curl * free;
    if (curlK > 0.001) {
      r.quaternion.setFromAxisAngle(_a.set(0, 0, 1), Math.PI / 2 * curlK);
      r.position.add(_b.set(0.13 * curlK, (this.groundLocal(ctx, 0, 0) + 0.058) * curlK, 0.02 * curlK));
    }
    if (this.tumble >= 0) {
      const c = _a.set(0, 0.16, 0);
      r.quaternion.setFromAxisAngle(_b.set(1, 0, 0), this.tumble);
      r.position.add(c).sub(_c.copy(c).applyQuaternion(r.quaternion));
    }
    av.evaluate(snap ? 0 : dt);
    this.host.group.updateMatrixWorld(true);
    av.captureFeet();

    // ---------- Her own posing over the clips.
    const left = this.D(1, 0, 0), fwd = this.D(0, 0, 1);
    this.dip = Math.max(0, this.dip - dt * 0.12);
    const idleW = wi * locoW * (1 - crouch);
    const breath = Math.sin(this.t * 2.2);
    av.turn('spine_03', left, -0.03 * breath * (0.3 + idleW));
    {
      const p = av.pos('pelvis');
      p.y -= this.dip * groundW;
      av.setPos('pelvis', p);
    }
    // Leaning into turns at speed; a lean forward running.
    const lean = clamp(this.turn * sp * 0.03, -0.25, 0.25) * groundW;
    av.turn('pelvis', fwd, -lean * 0.5); av.turn('spine_02', fwd, -lean * 0.4);
    av.turn('spine_01', left, 0.1 * ss(1.2, 3, sp) * groundW);
    // The wind: low, leaning into it.
    if (w.wind > 0.01) {
      const wd = this.D(0, 0, 0, _a).set(WIND.dir.x, 0, WIND.dir.y);
      const into = _b.crossVectors(UP, wd).normalize();
      av.turn('spine_01', into, -0.22 * w.wind * free); av.turn('spine_03', into, -0.12 * w.wind * free);
    }
    // Story poses (standing still).
    if (w.nudge > 0.01) this.nudgePose(w.nudge * free * (1 - this.moveW), left);

    // ---------- The sword's place, and her paws on it.
    const still = sp < 0.12 && !airborne && b.grounded;
    this.stillT = still ? this.stillT + dt : 0;
    const want: Record<Mode, number> = { hold: 0, shoulder: 0, aloft: 0, back: 0, lap: 0, ground: 0 };
    if (carried || climbing) want.back = 1;
    else if (swimming) want.aloft = 1;
    else if (h.curl > 0.5) want.ground = 1;
    else if (h.sit > 0.5) want.lap = 1;
    else if (this.stillT > 0.25 && w.wind < 0.5 && h.crouch < 0.5 && h.nudge < 0.5) want.hold = 1;
    else want.shoulder = 1;
    for (const k of MODES) this.sw[k] = E(this.sw[k], want[k], k === 'back' || want.back ? 9 : 7);

    // ---------- Whole-body states over the clips (each weighted).
    if (w.sit > 0.01 && free > 0.01) this.sitPose(w.sit * free * (1 - w.curl), ctx);
    if (w.curl > 0.01 && free > 0.01) this.curlPose(w.curl * free, ctx);
    if (w.swim > 0.01) this.swimPose(w.swim, dt, left, fwd);
    if (w.climb > 0.01) this.climbPose(w.climb, ctx);
    if (w.carry > 0.01) this.carriedPose(w.carry);

    // ---------- Feet on the ground.
    const ikW = groundW * (1 - Math.max(w.sit, w.curl)) * (this.tumble >= 0 ? 0 : 1);
    av.footIK(ctx, dt, ikW, h.renderYaw, h.renderPos, lerp(1, 0.9, idleW));
    // The sword where her body now is.
    this.placeSword();

    // ---------- Arms: on the sword, else free and kept clear of her armour.
    this.arms(left, fwd);

    // ---------- Head, face, tail, pauldrons.
    this.headPose(ctx, dt, left);
    this.facePose(dt);
    this.tailPose(dt, sp, snap);
    this.pauldrons();
    this.root.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- The sword.
  private swordW = new THREE.Matrix4();
  private placeSword() {
    const av = this.av, chest = av.bones.spine_03.matrixWorld, sw = this.sw;
    const p = _a.set(0, 0, 0), q = _q.identity();
    let tot = 0;
    const pp = V(), qq = new THREE.Quaternion(), sc = V();
    for (const k of MODES) {
      const wk = sw[k];
      if (wk < 1e-3) continue;
      if (k === 'ground') _m.multiplyMatrices(this.host.group.matrixWorld, this.swordRel.ground);
      else _m.multiplyMatrices(chest, this.swordRel[k]);
      _m.decompose(pp, qq, sc);
      const up = UPRIGHT[k];
      if (up > 0) qq.slerp(_q2.setFromRotationMatrix(this.host.group.matrixWorld).multiply(this.swordUp[k]), up);
      tot += wk;
      p.lerp(pp, tot === wk ? 1 : wk / tot);
      if (tot === wk) q.copy(qq); else q.slerp(qq, wk / tot);
    }
    this.swordW.compose(p, q, sc.set(1, 1, 1));
    const s = this.m.sword;
    _m.copy(this.av.root.matrixWorld).invert().multiply(this.swordW);
    _m.decompose(s.position, s.quaternion, s.scale);
    s.updateMatrixWorld(true);
  }
  // A point along the sword (y up the blade from the guard) and its axis, world.
  private onSword(y: number, out = V()) { return out.set(0, y, 0).applyMatrix4(this.swordW); }
  private swordAxis(out = V()) { return out.set(0, 1, 0).transformDirection(this.swordW); }

  // A fist round a grip at `fist` (world) whose axis (the thumb's way) is `Z`, the arm by IK with its elbow toward
  // `pole`; weighted from where the clips have it.
  private gripAt(s: Side, fist: THREE.Vector3, Z: THREE.Vector3, pole: THREE.Vector3, w: number) {
    if (w < 0.002) return;
    const av = this.av;
    const sh = av.pos(`upperarm_${s}`);
    const Zn = Z.clone().normalize();
    const Y = fist.clone().sub(sh);
    Y.addScaledVector(Zn, -Y.dot(Zn)).normalize().negate();
    const X = V().crossVectors(Y, Zn);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Zn));
    const off = FIST.clone(); if (s === 'r') off.x = -off.x;
    const wrist = fist.clone().sub(off.applyQuaternion(q));
    const T = av.pos(`hand_${s}`).lerp(wrist, w);
    const pl = av.bend(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`).lerp(pole.clone().normalize(), w);
    av.limb(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, T, pl, true, 0.008 * w);
    av.setCanon(`hand_${s}`, Y, Zn, w);
  }

  private arms(left: THREE.Vector3, fwd: THREE.Vector3) {
    const sw = this.sw, w = this.w;
    const bodyW = (1 - w.climb) * (1 - w.carry);
    // Free arms first: hanging clear of the cuirass and skirt.
    this.splay('l', left, fwd, bodyW * (1 - w.swim) * (1 - w.curl)); this.splay('r', left, fwd, bodyW * (1 - w.curl));
    const ax = this.swordAxis(_c).clone();
    const armed = this.host.outfit.armour ? 1 : 0;
    const gR = (sw.hold + sw.shoulder + sw.aloft + sw.lap) * bodyW * armed;
    const gL = (sw.hold + sw.lap) * bodyW * armed;
    if (gR > 0.002) {
      const pole = this.D(-1, -0.45, -0.25).lerp(this.D(-1, -0.2, 0.1), sw.aloft);
      this.gripAt('r', this.onSword(-0.012), ax, pole, Math.min(1, gR));
    }
    if (gL > 0.002) {
      // The left paw below the right on the grip (held), or resting on the blade across her lap.
      const y = lerp(-0.034, 0.13, sw.lap / Math.max(1e-3, sw.hold + sw.lap));
      this.gripAt('l', this.onSword(y), ax, this.D(0.7, -1, 0.35), Math.min(1, gL));
    }
  }

  // An arm the clips swing is kept out from her sides (her armour is far stouter than the mannequin).
  private splay(s: Side, left: THREE.Vector3, fwd: THREE.Vector3, w: number) {
    const av = this.av, sg = s === 'l' ? 1 : -1;
    const sh = this.local(av.pos(`upperarm_${s}`)), el = this.local(av.pos(`lowerarm_${s}`));
    const lu = sh.distanceTo(el);
    if (w < 0.01) return;
    const needE = 0.074 - el.x * sg;
    if (needE > 0 && el.y < sh.y + 0.01) av.turn(`upperarm_${s}`, fwd, sg * clamp(needE / lu, 0, 0.9) * w);
    const e2 = av.pos(`lowerarm_${s}`), wr = av.pos(`hand_${s}`), wl = this.local(wr);
    const needW = 0.08 - wl.x * sg;
    if (needW > 0 && wl.y < 0.2) { const f = wr.clone().sub(e2); av.aim(`lowerarm_${s}`, f, f.clone().addScaledVector(left, sg * needW), w); }
  }

  // ---------------------------------------------------------------- Whole-body states.
  // Sitting on the ground, legs out before her, sword across her lap.
  private sitPose(k: number, ctx: PoseContext) {
    const av = this.av;
    const g = this.groundLocal(ctx, 0, 0.0);
    const pel = this.L(0, g + 0.042, -0.012);
    av.setPos('pelvis', av.pos('pelvis').lerp(pel, k));
    av.turn('pelvis', this.D(1, 0, 0), -0.12 * k);
    av.turn('spine_02', this.D(1, 0, 0), 0.1 * k);
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1;
      const T = av.pos(`foot_${s}`).lerp(this.L(sg * 0.04, g + 0.018, 0.078), k);
      av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, T, this.D(sg * 0.2, 1, 0.1));
      av.setCanon(`foot_${s}`, this.D(0, 0, -1), this.D(0, 1, 0.1), k);
    }
  }

  // Asleep, curled up on her right side: knees drawn up, head bowed to them, paws tucked, tail round her.
  private curlPose(k: number, ctx: PoseContext) {
    const av = this.av;
    const br = Math.sin(this.t * 1.5);
    void ctx;
    // Curled: spine and neck bent forward, head down to the knees.
    const bendAx = av.axis('spine_01', _a.set(1, 0, 0)).clone();
    av.turn('spine_01', bendAx, 0.35 * k + br * 0.01); av.turn('spine_02', bendAx, 0.3 * k); av.turn('spine_03', bendAx, 0.2 * k);
    av.turn('neck_01', bendAx, 0.35 * k); av.turn('Head', bendAx, 0.2 * k);
    for (const s of ['l', 'r'] as Side[]) {
      // Thighs up to her chest, shins folded back under them.
      av.turn(`thigh_${s}`, bendAx, -1.4 * k);
      av.turn(`calf_${s}`, bendAx, 1.9 * k);
      // Arms folded in to her chest.
      av.turn(`upperarm_${s}`, bendAx, -0.9 * k);
      av.turn(`lowerarm_${s}`, bendAx, -1.6 * k);
    }
  }

  // Swimming upright: a dog-paddle with her left paw and her legs, the sword held up out of the water, bobbing.
  private swimPose(k: number, dt: number, left: THREE.Vector3, fwd: THREE.Vector3) {
    const av = this.av, b = this.host.body;
    const sp = Math.hypot(b.vel.x, b.vel.z);
    this.swimPh = (this.swimPh + dt * (1.6 + 1.1 * sp)) % 1;
    const a = TAU * this.swimPh;
    const pel = av.pos('pelvis');
    pel.copy(pel.lerp(this.L(0, 0.088 + 0.004 * Math.sin(2 * a), -0.005), k));
    av.setPos('pelvis', pel);
    av.turn('spine_01', left, 0.12 * k);
    // Legs kick in turn.
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1, ph = a + (s === 'l' ? 0 : Math.PI);
      const T = av.pos(`foot_${s}`).lerp(this.L(sg * 0.036, 0.03 + 0.022 * Math.max(0, Math.sin(ph)), 0.012 + 0.025 * Math.cos(ph)), k);
      av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, T, fwd.clone().addScaledVector(left, sg * 0.3));
    }
    // The left paw paddles round in front of her at the waterline.
    const P = this.L(0.045, 0.118 + 0.022 * Math.sin(a), 0.07 + 0.028 * Math.cos(a));
    const cur = av.pos('hand_l');
    av.limb('upperarm_l', 'lowerarm_l', 'hand_l', cur.lerp(P, k), this.D(1, -0.6, -0.2));
    av.setCanon('hand_l', this.D(0.2, 0.3, -1), this.D(-0.3, 1, 0), k);
  }

  // Climbing: facing the face, paw over paw up it, feet pushing; at the top her paws go over onto the ledge and she
  // pulls herself up.
  private climbPose(k: number, ctx: PoseContext) {
    const av = this.av, b = this.host.body, cl = b.climb;
    const ph = cl ? cl.phase : this.t * 4;
    const fwd = this.D(0, 0, 1), left = this.D(1, 0, 0);
    // Body upright against the face, leaning into it.
    const pel = av.pos('pelvis').lerp(this.L(0, 0.092 + 0.006 * Math.sin(ph * 2), 0.004), k);
    av.setPos('pelvis', pel);
    av.turn('pelvis', left, 0.16 * k);
    let wallZ = CLIMB_DIST, ledge: number | null = null;
    if (cl?.exit) {
      const e = cl.exit, f = this.D(0, 0, 1);
      ledge = e.to.y - this.host.renderPos.y;
      wallZ = CLIMB_DIST - ((this.host.renderPos.x - e.from.x) * f.x + (this.host.renderPos.z - e.from.z) * f.z);
    } else {
      wallZ = CLIMB_DIST - this.climbOver;
      const top = this.groundRaw(ctx, 0, wallZ + 0.04);
      if (top < 0.33) ledge = top;
    }
    const pull = ledge !== null ? ss(0.36, 0.2, ledge) : 0;
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1, alt = s === 'l' ? 0 : Math.PI;
      const reach = 0.5 + 0.5 * Math.sin(ph + alt);
      // Paws on the ivy above her shoulders, beside her head; over the edge at the top.
      const P = this.L(sg * 0.062, 0.215 + 0.06 * reach, wallZ - 0.014);
      if (ledge !== null) P.lerp(this.L(sg * 0.05, ledge + 0.012, wallZ + 0.018), ss(0, 0.7, pull));
      const cur = av.pos(`hand_${s}`);
      av.limb(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, cur.lerp(P, k), this.D(sg, -0.5, -0.6), true, 0.01 * k);
      av.setCanon(`hand_${s}`, this.D(0, -0.2, -1).lerp(this.D(0, 1, -0.3), ss(0, 0.7, pull)), this.D(-sg * 0.3, 1, 0), k);
      // Feet against the face below her, pushing by turns.
      const F = this.L(sg * 0.036, 0.012 + 0.04 * (1 - reach), wallZ - 0.03);
      av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, av.pos(`foot_${s}`).lerp(F, k), this.D(sg * 0.4, 0.3, 1));
      av.setCanon(`foot_${s}`, this.D(0, 1, 0.3), fwd, k * 0.6);
    }
  }

  // Held under her arms in the knight's hands: arms up over his, legs dangling and swinging a little.
  private carriedPose(k: number) {
    const av = this.av;
    const sw = Math.sin(this.t * 1.8);
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1;
      const P = this.L(sg * 0.085, 0.028 + 0.003 * Math.sin(this.t * 2 + sg), 0.045);
      av.limb(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, av.pos(`hand_${s}`).lerp(P, k), this.D(sg, -0.3, -0.7));
      av.setCanon(`hand_${s}`, this.D(0, 0.5, -1), this.D(-sg, 0, 0.3), k);
      const F = this.L(sg * 0.034, -0.19 + 0.006, 0.012 + 0.012 * Math.sin(this.t * 2.3 + sg * 1.7) + 0.004 * sw);
      av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, av.pos(`foot_${s}`).lerp(F, k), this.D(0, 0, 1));
    }
  }

  // Head-butting forward every couple of seconds, eyes closed into it.
  private nudgePose(k: number, left: THREE.Vector3) {
    const push = Math.pow(Math.max(0, Math.sin(this.t * 2.6)), 2);
    this.av.turn('spine_02', left, (0.12 + push * 0.15) * k);
    this.av.turn('neck_01', left, (0.1 + push * 0.25) * k);
    this.lid = Math.max(this.lid, push * 0.95 * k);
  }

  // ---------------------------------------------------------------- Head and face.
  private headPose(ctx: PoseContext, dt: number, left: THREE.Vector3) {
    const h = this.host, w = this.w, g = this.glance;
    g.t -= dt;
    if (g.t <= 0) { g.watch = Math.random() < 0.65; g.t = 1.6 + Math.random() * 3; }
    const target = h.lookTarget ?? (g.watch && ctx.lookAt ? ctx.lookAt : null);
    const free = (1 - w.climb) * (1 - w.curl) * (1 - w.air) * (this.tumble >= 0 ? 0 : 1);
    this.av.look(free > 0.3 ? target : null, h.renderYaw, dt, { maxYaw: 0.9, maxUp: 0.5, maxDown: 0.35, rate: 4 });
    // Climbing: looking up the face; swimming: chin up.
    this.av.turn('Head', left, (-0.25 * w.climb - 0.15 * w.swim));
    // Her voice: the head lifts and the mouth opens.
    this.mouth = 0;
    const m = this.meowS;
    if (m) {
      m.t += dt;
      const a = m.t / (m.dur + 0.25);
      if (a >= 1) this.meowS = null;
      else {
        const e = Math.pow(Math.sin(Math.PI * a), 0.7);
        this.mouth = m.open * ss(0, 0.12, m.t) * ss(m.dur + 0.12, m.dur - 0.08, m.t);
        this.av.turn('Head', left, -m.amt * e * 0.6);
        this.av.turn('Head', this.D(0, 0, 1), m.roll * e);
        if (m.cry) { this.ear.x += 0.5 * e; this.lid = Math.max(this.lid, 0.35 * e); }
        else this.lid = Math.max(this.lid, 0.15 * e);
      }
    }
  }

  private facePose(dt: number) {
    const w = this.w;
    // Ears: back and flat in the wind, back a little running, down asleep.
    this.ear.x += 1.0 * w.wind + 0.25 * ss(1.5, 3, this.spd) + 0.3 * w.curl + 0.2 * w.swim;
    this.ear.z += 0.25 * w.wind + 0.25 * w.curl;
    this.lid = Math.max(this.lid, 0.5 * w.wind, w.curl, 0.12 * w.carry);
    // Blinks (now and then a double).
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blink < 0) { this.blink = 0; this.blinkT = 1.8 + Math.random() * 3.6; if (Math.random() < 0.2) this.blinkT = 0.3; }
    if (this.blink >= 0) {
      this.blink += dt / 0.17;
      if (this.blink >= 1) this.blink = -1;
      else this.lid = Math.max(this.lid, ss(0, 1, 1 - Math.abs(this.blink * 2 - 1)));
    }
    const tw: [number, number] = [0, 0];
    for (let s = 0; s < 2; s++) {
      const t = this.twitch[s];
      t.t -= dt;
      if (t.t <= 0 && t.a < 0) { t.a = 0; t.t = 2.5 + Math.random() * 6; }
      if (t.a >= 0) { t.a += dt / 0.28; if (t.a >= 1) t.a = -1; }
      tw[s] = t.a >= 0 ? Math.sin(Math.PI * t.a) : 0;
    }
    this.earA.lerp(this.ear, this.snapFace ? 1 : 0.25);
    this.snapFace = false;
    this.m.face.pose(this.lid, this.mouth, this.earA, tw, this.m.glintMat);
    this.lid = 0; this.ear.set(0, 0, 0);
  }
  private snapFace = true;

  // ---------------------------------------------------------------- Tail: hanging behind her and curling out to her
  // left (the photo), up behind her running, streaming downwind; on springs, swinging as she turns and leaps.
  private tailPose(dt: number, sp: number, snap: boolean) {
    const w = this.w, P = this.tailP, m = this.m;
    const run = ss(0.5, 2.5, sp) * (1 - w.air);
    const sway = Math.sin(this.t * 1.3);
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      const idleP = [-0.85, 0.5, 0.55, 0.5, 0.35][i], idleY = [-0.5, -0.32, -0.3, -0.28, -0.2][i];
      const runP = [-0.25, 0.12, 0.1, 0.06, 0.05][i];
      P[i * 2] = lerp(idleP, runP, run) + 0.06 * Math.sin(this.t * 2 - i * 0.7) * f;
      P[i * 2 + 1] = lerp(idleY, 0, run) + sway * 0.08 * (0.3 + f) + run * 0.12 * Math.sin(TAU * this.av.phase * 2 - i * 0.8);
      // Swimming: afloat behind; climbing and carried: hanging.
      P[i * 2] = lerp(P[i * 2], i === 0 ? -0.2 : 0.02, w.swim);
      P[i * 2] = lerp(P[i * 2], i === 0 ? -1.2 : 0.06, Math.max(w.climb, w.carry));
      P[i * 2 + 1] = lerp(P[i * 2 + 1], Math.sin(this.t * 2.2 - i * 0.7) * 0.15 * f, Math.max(w.swim, w.climb, w.carry));
      // Asleep: wrapped round her.
      P[i * 2] = lerp(P[i * 2], i === 0 ? -0.6 : 0.0, w.curl);
      P[i * 2 + 1] = lerp(P[i * 2 + 1], [-0.9, -0.6, -0.55, -0.5, -0.45][i], w.curl);
    }
    if (w.wind > 0.01) {
      const wd = this.local(_a.copy(this.host.renderPos).add(_b.set(WIND.dir.x, 0, WIND.dir.y)), _c);
      const yawTo = clamp(Math.atan2(-wd.x, -wd.z), -1.4, 1.4);
      const g = 0.5 + 0.5 * WIND.gust;
      for (let i = 0; i < TAIL_N; i++) {
        const f = i / (TAIL_N - 1);
        P[i * 2] = lerp(P[i * 2], (i === 0 ? -0.35 : 0.02) + Math.sin(this.t * 13 - i * 1.1) * 0.1 * g * f, w.wind);
        P[i * 2 + 1] = lerp(P[i * 2 + 1], (i === 0 ? yawTo * 0.6 : yawTo * 0.08) + Math.sin(this.t * 17 - i * 1.3) * 0.2 * g * (0.3 + f), w.wind);
      }
    }
    // Springs.
    const A = this.tailA, Vv = this.tailV, b = this.host.body;
    if (snap || dt <= 0) { A.set(P); Vv.fill(0); this.lastVy = b.vy; }
    else {
      const dvy = clamp(b.vy - this.lastVy, -6, 6); this.lastVy = b.vy;
      const dyaw = this.turn * dt;
      for (let i = 0; i < TAIL_N; i++) {
        const f = i / (TAIL_N - 1);
        A[i * 2 + 1] -= dyaw * 0.35 * (0.3 + f) * (1 - w.carry);
        A[i * 2] += dvy * 0.04 * (0.4 + f) * (1 - w.carry);
      }
      const n = Math.max(1, Math.ceil(dt / (1 / 120))), hh = dt / n;
      for (let s = 0; s < n; s++) for (let i = 0; i < TAIL_N * 2; i++) {
        const f = (i >> 1) / (TAIL_N - 1);
        const kk = lerp(300, 110, f), c = 2 * 0.6 * Math.sqrt(kk);
        Vv[i] += ((P[i] - A[i]) * kk - Vv[i] * c) * hh;
        A[i] += Vv[i] * hh;
      }
    }
    for (let i = 0; i < TAIL_N; i++) {
      _q.setFromEuler(new THREE.Euler(A[i * 2], A[i * 2 + 1], 0, 'YXZ'));
      if (i === 0) m.tail[0].quaternion.copy(this.tail0Q).multiply(_q); else m.tail[i].quaternion.copy(_q);
    }
  }

  // The pauldrons follow her chest, and her upper arms part of the way (lifted with the arm, never into her head).
  private pauldrons() {
    const av = this.av;
    (['l', 'r'] as Side[]).forEach((s, i) => {
      const rel = this.pauldronRel[i];
      const qc = av.quat(`clavicle_${s}`).multiply(rel.c);
      const qu = av.quat(`upperarm_${s}`).multiply(rel.u);
      av.setQuat(this.m.pauldrons[i], qc.slerp(qu, 0.4));
    });
  }

  // ---------------------------------------------------------------- Ground probes (relative to her feet).
  private groundLocal(ctx: PoseContext, x: number, z: number) { const p = this.L(x, 0, z); return clamp(ctx.ground(p.x, p.z) - this.host.renderPos.y, -0.1, 0.1); }
  private groundRaw(ctx: PoseContext, x: number, z: number) { const p = this.L(x, 0, z); return ctx.ground(p.x, p.z) - this.host.renderPos.y; }

  // ================================================================ The cape.
  cloth(dt: number) {
    if (!this.ready || !this.host.outfit.cape) return;
    this.capeFrame();
    this.cape.step(clamp(dt, 0, 0.1));
    this.cape.sync(_m.copy(this.root.matrixWorld).invert());
  }

  resetCloth() {
    if (!this.ready) return;
    this.root.updateMatrixWorld(true);
    this.capeFrame();
    const back = this.D(0, -0.25, -1).normalize();
    this.cape.bodyDelta.set(0, 0, 0);
    this.cape.reset(back);
    this.cape.settlePins();
    this.cape.sync(_m.copy(this.root.matrixWorld).invert());
  }

  private capeFrame() {
    const av = this.av, m = this.m, c = this.cape;
    const chest = av.bones.spine_03.matrixWorld;
    for (let i = 0; i < c.cols; i++) c.pins[i].copy(this.pinRel[i]).applyMatrix4(chest);
    // Balls: her head, her pauldrons, her tail.
    const B = this.balls;
    let k = 0;
    const ball = (o: THREE.Object3D, x: number, y: number, z: number, r: number) => {
      const bl = B[k++];
      bl.c.set(x, y, z).applyMatrix4(o.matrixWorld); bl.r = r;
      bl.up.set(0, 1, 0).transformDirection(o.matrixWorld);
    };
    ball(m.headC, 0, 0.004, -0.004, 0.062);
    ball(m.pauldrons[0], 0, 0, 0, 0.034); B[k - 1].c.y += 0.004;
    ball(m.pauldrons[1], 0, 0, 0, 0.034); B[k - 1].c.y += 0.004;
    ball(m.tail[1], 0, 0, 0, 0.02);
    ball(m.tail[3], 0, 0, 0, 0.019);
    B.length = k;
    // Capsules: her body (cuirass), the skirt, her legs, the sword.
    const P = (n: string, out = V()) => out.setFromMatrixPosition(av.bones[n].matrixWorld);
    const cp = this.caps;
    let j = 0;
    const cap = (a: THREE.Vector3, b: THREE.Vector3, r: number, deep: boolean) => { const x = cp[j++]; x.a.copy(a); x.b.copy(b); x.r = r; x.deep = deep; };
    cap(_a.set(0, 0.0, 0.0).applyMatrix4(av.bones.spine_01.matrixWorld), _b.set(0, 0.0, 0.0).applyMatrix4(av.bones.spine_03.matrixWorld).addScaledVector(this.D(0, 1, 0), 0.012), 0.054, true);
    const pel = av.bones.pelvis.matrixWorld;
    cap(this.toWorldFromRest(pel, 'pelvis', 0, 0.138, -0.002, _a), this.toWorldFromRest(pel, 'pelvis', 0, 0.09, -0.002, _b), 0.064, true);
    cap(P('thigh_l', _a), P('calf_l', _b), 0.024, false);
    cap(P('thigh_r', _a), P('calf_r', _b), 0.024, false);
    cap(P('calf_l', _a), P('foot_l', _b), 0.021, false);
    cap(P('calf_r', _a), P('foot_r', _b), 0.021, false);
    cap(this.onSword(-SWORD.pommel, _a), this.onSword(SWORD.blade, _b), 0.008, false);
    cp.length = j;
    c.near.a.copy(P('pelvis')).addScaledVector(this.D(0, 1, 0), -0.1); c.near.b.copy(m.headC.getWorldPosition(_c)); c.near.r = 0.2;
    // Her back's direction (deep points go out that way, never through her).
    this.back.copy(this.D(0, 0, -1));
    _a.setFromMatrixPosition(av.bones.spine_03.matrixWorld);
    if (this.capeLast) c.bodyDelta.subVectors(_a, this.capeLast); else c.bodyDelta.set(0, 0, 0);
    if (c.bodyDelta.lengthSq() > 0.25) c.bodyDelta.set(0, 0, 0);
    this.capeLast = (this.capeLast ?? V()).copy(_a);
    // A collar: the cloth stays behind the fronts of her shoulders.
    c.collar.c.copy(this.pinRel[0]).applyMatrix4(chest).lerp(_b.copy(this.pinRel[c.cols - 1]).applyMatrix4(chest), 0.5).addScaledVector(this.D(0, 0, 1), 0.03);
    c.collar.n.copy(this.D(0, 0, 1));
    const b = this.host.body;
    c.water = b.swimming ? this.host.renderPos.y + SWIM_FLOAT - 0.004 : null;
    c.floor = b.grounded ? this.host.renderPos.y + 0.004 : null;
    c.sheltered = WIND.sheltered(this.host.renderPos);
  }
  // A point given in her rest pose (character space) carried by a bone as it is now.
  private toWorldFromRest(boneM: THREE.Matrix4, bone: string, x: number, y: number, z: number, out: THREE.Vector3) {
    const p = this.av.restP.get(bone)!, q = this.av.restQ.get(bone)!;
    out.set(x - p.x, y - p.y, z - p.z).applyQuaternion(_q2.copy(q).invert());
    return out.applyMatrix4(boneM);
  }

  // Out of her body's capsules (a point deep in her body or skirt goes out behind her, never through her).
  private capsulePush(P: Float32Array, o: number) {
    for (const c of this.caps) {
      const ax = c.b.x - c.a.x, ay = c.b.y - c.a.y, az = c.b.z - c.a.z;
      const px = P[o] - c.a.x, py = P[o + 1] - c.a.y, pz = P[o + 2] - c.a.z;
      const ll = ax * ax + ay * ay + az * az || 1e-9;
      const t = clamp((px * ax + py * ay + pz * az) / ll, 0, 1);
      let dx = px - ax * t, dy = py - ay * t, dz = pz - az * t;
      const r = c.r + 0.004;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (c.deep && (d < r * 0.5 || dx * this.back.x + dz * this.back.z < 0)) {
        // Through to the far side, or deep: out behind her back.
        const bx = this.back.x, bz = this.back.z;
        const along = dx * bx + dz * bz;
        const lat2 = d2 - along * along;
        const out = Math.sqrt(Math.max(0, r * r - lat2));
        dx += bx * (out - along); dz += bz * (out - along);
        P[o] = c.a.x + ax * t + dx; P[o + 1] = c.a.y + ay * t + dy; P[o + 2] = c.a.z + az * t + dz;
        continue;
      }
      if (d < 1e-6) { dx = this.back.x; dy = 0; dz = this.back.z; d = 1; }
      const s = r / d;
      P[o] = c.a.x + ax * t + dx * s; P[o + 1] = c.a.y + ay * t + dy * s; P[o + 2] = c.a.z + az * t + dz * s;
    }
  }

  // ================================================================ For the owner.
  headPos(out: THREE.Vector3) { return this.m ? this.m.headC.getWorldPosition(out) : out.copy(this.host.renderPos).setY(this.host.renderPos.y + 0.28); }

  spheres(s: THREE.Sphere[]) {
    const av = this.av, m = this.m;
    s[0].set(s[0].center.setFromMatrixPosition(av.bones.pelvis.matrixWorld), 0.07);
    s[1].set(s[1].center.setFromMatrixPosition(av.bones.spine_03.matrixWorld), 0.065);
    s[2].set(m.headC.getWorldPosition(s[2].center), 0.065);
    s[3].set(s[3].center.setFromMatrixPosition(m.tail[2].matrixWorld), 0.03);
    return s;
  }
}
