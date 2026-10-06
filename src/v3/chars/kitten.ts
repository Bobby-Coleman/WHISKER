// The kitten (v3): a fluffy cream-and-ginger toy kitten with a big round head and huge glossy eyes, built from
// rounded shapes on a joint hierarchy (chars/kitten/model.ts) and posed procedurally every frame from her gameplay
// body. On all fours she walks, trots and, flat out, bounds in a gallop, her phase advanced by the distance she covers
// and each paw held where it touched down until it lifts (no skating), on the ground under it (two-bone IK per leg);
// she stretches out rising in a jump and reaches her forepaws down falling, squashes on landing, paddles with her
// chin up swimming, climbs ivy paw over paw, dangles when the knight holds her, hunkers down in the wind, and does
// what a story asks (sit, crouch, curl up asleep, nudge, look, meow). Every pose is a set of joint targets; states
// cross-fade by eased weights, so nothing pops. Her cape (chars/kitten/cape.ts) is a little cloth on her shoulders.
import * as THREE from 'three';
import { CharacterBody, PoseContext, WIND } from '../body';
import { toy, Fade } from '../render/materials';
import type { ToyCharacter } from './api';
import { KittenRig, REST, LEG, TAIL_N, EYE_R } from './kitten/model';
import { Cape, Ball } from './kitten/cape';

const V = THREE.Vector3;
type V3 = THREE.Vector3;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const CLIMB_DIST = 0.075; // (climb.ts) how far her chest stays off the face
const SWIM_FLOAT = 0.1; // (motor.ts) her feet under the surface while she swims
const HEAD_SCALE = 1.06;

// Every joint's target. Rotations are Euler angles (x: pitch, + tips the nose down; y: yaw, + turns her left; z:
// roll, + leans her right), the pelvis in model space and the rest relative to their parents. Paws (the paw joint,
// where the leg meets the paw) are model-space targets for the leg IK, with their orientation and knee/elbow poles.
class Pose {
  hip = new V(); hipR = new V(); spine = new V(); chest = new V(); neck = new V(); head = new V();
  paw = [new V(), new V(), new V(), new V()];
  pawR = [new V(), new V(), new V(), new V()];
  pole = [new V(), new V(), new V(), new V()];
  fore = new V(); hind = new V(); // shoulder and hip sockets moved (in their girdle's space)
  tail = new Float32Array(TAIL_N * 2); // pitch (+ curls up), yaw (+ toward her right) per joint
  ear = new V(); // x: laid back, y: turned out, z: drooped
  lid = 0; mouth = 0;
  sq = new V(1, 1, 1);
  private static vs = (p: Pose) => [p.hip, p.hipR, p.spine, p.chest, p.neck, p.head, ...p.paw, ...p.pawR, ...p.pole, p.fore, p.hind, p.ear, p.sq];
  copy(o: Pose) {
    const a = Pose.vs(this), b = Pose.vs(o);
    for (let i = 0; i < a.length; i++) a[i].copy(b[i]);
    this.tail.set(o.tail); this.lid = o.lid; this.mouth = o.mouth;
    return this;
  }
  lerp(o: Pose, t: number) {
    if (t <= 0) return this;
    if (t >= 1) return this.copy(o);
    const a = Pose.vs(this), b = Pose.vs(o);
    for (let i = 0; i < a.length; i++) a[i].lerp(b[i], t);
    for (let i = 0; i < this.tail.length; i++) this.tail[i] += (o.tail[i] - this.tail[i]) * t;
    this.lid += (o.lid - this.lid) * t; this.mouth += (o.mouth - this.mouth) * t;
    return this;
  }
}

// Leg order: left fore, right fore, left hind, right hind.
const SIDE = [1, -1, 1, -1];
const FORE = [true, true, false, false];
// Footfall offsets in the cycle for a walk (lateral sequence), a trot (diagonal pairs) and a bounding gallop.
const GAIT = { walk: [0.25, 0.75, 0, 0.5], trot: [0.5, 1.0, 0, 0.5], gallop: [0.5, 0.6, 0, 0.1] };

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _x = new V(), _y = new V(), _z = new V();
const ONE = new V(1, 1, 1);

export class ToyKitten implements ToyCharacter {
  kind = 'kitten' as const;
  body = new CharacterBody(0.09, 0.34);
  group = new THREE.Group();
  renderPos = new THREE.Vector3(); renderYaw = 0;
  carriedBy: ToyCharacter | null = null; holding: ToyCharacter | null = null;
  // Story controls (0..1 targets, eased).
  sit = 0; crouch = 0; curl = 0; nudge = 0;
  lookTarget: THREE.Vector3 | null = null;
  outfit = { armour: false, cape: false, bow: false };

  private fade: Fade = { value: 1 };
  private rig!: KittenRig;
  private cape!: Cape;
  private P = new Pose(); private Q = new Pose();
  private t = 0;
  // Gait.
  private phase = 0; private speed = 0; private mv = 0; private slope = 0; private turn = 0;
  private plants = [0, 1, 2, 3].map(() => ({ p: new V(), planted: false }));
  private lastYaw = 0;
  // Eased state weights.
  private w = { air: 0, swim: 0, climb: 0, carry: 0, sit: 0, crouch: 0, curl: 0, nudge: 0, wind: 0 };
  private airTime = 0; private swimPh = 0; private climbOver = 0; private climbRef: number | null = null; private climbT = 0; private ledgeNear = false;
  // Face and secondary motion.
  private blinkT = 2; private blink = -1; private twitch = [{ t: 3, a: -1 }, { t: 5, a: -1 }];
  private look = new THREE.Vector2(); private glance = { t: 2, yaw: 0, pitch: 0, watch: true, tilt: 0 }; private tilt = 0;
  private meowS: { t: number; dur: number; amt: number; open: number; roll: number; cry: boolean } | null = null;
  private tailA = new Float32Array(TAIL_N * 2); private tailV = new Float32Array(TAIL_N * 2);
  private earA = new V();
  private lastVy = 0;
  // Smooths her into and out of the knight's hands.
  private carryOff = new V(); private carryYaw = 0; private wasCarried = false; private lastRender = new V(); private lastRenderYaw = 0;
  private balls: Ball[] = [];
  private capeLast: V3 | null = null;
  private torsoM = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
  private torsoInv = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
  private qP = new THREE.Quaternion(); private qC = new THREE.Quaternion(); private qPaw = new THREE.Quaternion();
  private sphereList: THREE.Sphere[] = [new THREE.Sphere(), new THREE.Sphere(), new THREE.Sphere(), new THREE.Sphere()];

  async load() {
    this.rig = new KittenRig(this.fade);
    this.rig.build();
    this.group.add(this.rig.model);
    this.group.name = 'kitten';
    this.cape = new Cape(toy('#ffffff', { vertexColors: true, rough: 0.95, side: THREE.DoubleSide, fade: this.fade }));
    this.group.add(this.cape.mesh);
    for (let i = 0; i < 13; i++) this.balls.push({ c: new V(), r: 0.05, up: new V(0, 1, 0) });
    this.cape.balls = this.balls;
    this.cape.shape = (P, o) => this.torsoPush(P, o);
    this.applyOutfit();
    this.resetSecondary();
  }

  // How many triangles and meshes she is drawn with (for budgets and tests).
  stats() {
    let meshes = 0, tris = 0;
    this.group.traverse((o: any) => { if (o.isMesh && o.visible) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    return { meshes, tris };
  }

  setOutfit(o: Partial<{ armour: boolean; cape: boolean; bow: boolean }>) {
    const hadCape = this.outfit.cape;
    Object.assign(this.outfit, o);
    this.applyOutfit();
    if (this.outfit.cape && !hadCape) this.resetCloth();
  }
  private applyOutfit() {
    if (!this.rig) return;
    this.rig.armour.visible = this.outfit.armour;
    this.rig.bow.visible = this.outfit.bow;
    // The chest fluff folds away under the breastplate.
    this.rig.ruff.scale.setScalar(this.outfit.armour ? 0.01 : 1);
    this.cape.mesh.visible = this.outfit.cape;
  }

  // Her voice: the head lifts and the mouth opens ('cry' wide and long, 'mew' small, 'mrrp' with a little tilt).
  meow(kind: 'meow' | 'mew' | 'mrrp' | 'cry' = 'meow') {
    const [dur, amt, open, roll] = ({ meow: [0.55, 0.26, 0.8, 0], mew: [0.32, 0.16, 0.5, 0.04], mrrp: [0.38, 0.1, 0.38, 0.3], cry: [0.95, 0.4, 1.1, 0] } as const)[kind];
    this.meowS = { t: 0, dur, amt, open, roll: roll * (Math.random() < 0.5 ? -1 : 1), cry: kind === 'cry' };
  }

  resetPose(_ground: (x: number, z: number) => number) {
    const b = this.body;
    this.renderPos.copy(b.pos); this.renderYaw = b.yaw;
    this.lastRender.copy(b.pos); this.lastRenderYaw = b.yaw; this.lastYaw = b.yaw;
    this.carryOff.set(0, 0, 0); this.carryYaw = 0; this.wasCarried = this.carriedBy !== null;
    b.visualDY = 0;
    const carried = this.carriedBy !== null, climbing = !!b.climb && !carried, swimming = b.swimming && !carried && !climbing;
    Object.assign(this.w, { carry: carried ? 1 : 0, climb: climbing ? 1 : 0, swim: swimming ? 1 : 0, air: 0, sit: this.sit, crouch: this.crouch, curl: this.curl, nudge: this.nudge, wind: b.wind });
    this.speed = 0; this.mv = 0; this.slope = 0; this.turn = 0;
    for (const p of this.plants) p.planted = false;
    this.place();
    if (this.rig) {
      this.posePass(0, { dt: 0, time: this.t, ground: _ground, lookAt: null, active: false }, true);
      this.resetCloth();
    }
  }

  private place() { this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0); }

  updateVisual(alpha: number, ctx: PoseContext) {
    const b = this.body, dt = clamp(ctx.dt, 0, 0.1);
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    if (b.visualDY !== 0) {
      this.renderPos.y += b.visualDY;
      b.visualDY *= Math.exp(-dt * 18);
      if (Math.abs(b.visualDY) < 1e-4) b.visualDY = 0;
    }
    const dy = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    this.renderYaw = b.prevYaw + dy * alpha;
    // Lifted up or set down: she travels there over a moment instead of in one step.
    const carried = this.carriedBy !== null;
    if (carried !== this.wasCarried) {
      this.wasCarried = carried;
      if (this.lastRender.distanceTo(this.renderPos) < 3) {
        this.carryOff.copy(this.lastRender).sub(this.renderPos);
        this.carryYaw = Math.atan2(Math.sin(this.lastRenderYaw - this.renderYaw), Math.cos(this.lastRenderYaw - this.renderYaw));
      }
    }
    const k = Math.exp(-dt * 9);
    this.carryOff.multiplyScalar(k); this.carryYaw *= k;
    this.renderPos.add(this.carryOff); this.renderYaw += this.carryYaw;
    this.lastRender.copy(this.renderPos); this.lastRenderYaw = this.renderYaw;
    this.place();
    if (!this.rig) return;
    this.posePass(dt, ctx, false);
  }

  update(dt: number, _ctx: PoseContext) {
    if (!this.rig || !this.outfit.cape) return;
    this.capeFrame();
    this.cape.step(clamp(dt, 0, 0.1));
    this.group.updateMatrixWorld();
    this.cape.sync(_m.copy(this.group.matrixWorld).invert());
  }

  // Lays the cape out over her back afresh (spawns, teleports, respawns).
  resetCloth() {
    if (!this.rig) return;
    this.group.updateMatrixWorld(true);
    this.capeFrame();
    const back = new V().setFromMatrixPosition(this.rig.pelvis.matrixWorld).sub(_a.setFromMatrixPosition(this.rig.chest.matrixWorld)).normalize();
    this.cape.bodyDelta.set(0, 0, 0);
    this.cape.reset(back);
    this.cape.settlePins();
    this.cape.sync(_m.copy(this.group.matrixWorld).invert());
  }

  headPos(out: THREE.Vector3) { return this.rig ? this.rig.head.getWorldPosition(out) : out.copy(this.renderPos).setY(this.renderPos.y + 0.2); }

  // Rump, chest and head (and the tail's middle), world space.
  spheres() {
    const s = this.sphereList;
    if (!this.rig) { for (const x of s) x.set(_a.copy(this.renderPos).setY(this.renderPos.y + 0.15), 0.16); return s; }
    const r = this.rig;
    s[0].set(s[0].center.setFromMatrixPosition(r.pelvis.matrixWorld), 0.075);
    s[1].set(s[1].center.setFromMatrixPosition(r.chest.matrixWorld), 0.072);
    s[2].set(s[2].center.setFromMatrixPosition(r.head.matrixWorld), 0.068);
    s[3].set(s[3].center.setFromMatrixPosition(r.tail[3].matrixWorld), 0.04);
    return s;
  }

  setFade(f: number) { this.fade.value = f; }

  // ---------------------------------------------------------------------------------------------------------------
  // The pose, each frame.

  private posePass(dt: number, ctx: PoseContext, snap: boolean) {
    const b = this.body, w = this.w, P = this.P;
    this.t += dt;
    const carried = this.carriedBy !== null, climbing = !!b.climb && !carried, swimming = b.swimming && !carried && !climbing;
    const airborne = !b.grounded && !swimming && !climbing && !carried;
    this.airTime = airborne ? this.airTime + dt : 0;
    const ease = (v: number, to: number, rate: number) => (snap ? to : v + (to - v) * (1 - Math.exp(-dt * rate)));
    w.carry = ease(w.carry, carried ? 1 : 0, 10);
    // Over the top of a climb: she moves on into the face's line (a plain climb keeps her off it).
    if (climbing) {
      this.climbT += dt;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      const f = b.pos.x * fx + b.pos.z * fz, df = (b.pos.x - b.prevPos.x) * fx + (b.pos.z - b.prevPos.z) * fz;
      if (this.climbRef === null || this.climbT < 0.4 || !this.ledgeNear || (Math.abs(b.pos.y - b.prevPos.y) > 2 * Math.abs(df) && f - this.climbRef < 0.03)) this.climbRef = f;
      this.climbOver = Math.max(0, f - this.climbRef);
    } else { this.climbOver = 0; this.climbRef = null; this.climbT = 0; this.ledgeNear = false; }
    if (b.climb?.exit && !carried) { const a = b.climb.exit.t / b.climb.exit.dur; w.climb = Math.min(w.climb, 1 - ss(0.5, 1.0, a)); }
    else if (climbing && this.climbOver > 0.01) w.climb = Math.min(w.climb, 1 - ss(0.01, 0.2, this.climbOver));
    else w.climb = ease(w.climb, climbing ? 1 : 0, 12);
    w.swim = ease(w.swim, swimming ? 1 : 0, 7);
    w.air = ease(w.air, airborne && (this.airTime > 0.07 || b.vy > 0.6) ? 1 : 0, airborne ? 13 : 20);
    w.sit = ease(w.sit, clamp(this.sit, 0, 1), 8); w.crouch = ease(w.crouch, clamp(this.crouch, 0, 1), 9);
    w.curl = ease(w.curl, clamp(this.curl, 0, 1), 5); w.nudge = ease(w.nudge, clamp(this.nudge, 0, 1), 8);
    w.wind = ease(w.wind, carried || climbing ? 0 : b.wind, 5);
    b.landing = Math.max(0, b.landing - dt * 3.2);

    // On the ground (with the gait), then the story poses over it while she stands still, then the air, water, wall
    // and hands over everything.
    this.locomotion(P, dt, ctx, snap);
    const still = (1 - this.mv) * (1 - w.air) * (1 - w.swim) * (1 - w.climb) * (1 - w.carry);
    if (w.crouch * still > 1e-3) P.lerp(this.crouchPose(this.Q, ctx), w.crouch * still);
    if (w.nudge * still > 1e-3) P.lerp(this.nudgePose(this.Q, ctx), w.nudge * still);
    if (w.sit * still > 1e-3) P.lerp(this.sitPose(this.Q, ctx), w.sit * still);
    if (w.curl * still > 1e-3) P.lerp(this.curlPose(this.Q, ctx), w.curl * still);
    // Landing: a squash.
    const land = b.landing * (1 - w.air) * (1 - w.swim);
    if (land > 1e-3) {
      P.hip.y -= 0.028 * land; P.spine.x += 0.12 * land; P.chest.x += 0.06 * land; P.head.x -= 0.15 * land; P.neck.x += 0.1 * land;
      P.sq.y -= 0.1 * land; P.sq.x += 0.05 * land; P.sq.z += 0.04 * land; P.ear.z += 0.3 * land;
      for (let i = 0; i < 4; i++) P.paw[i].x *= 1 + 0.25 * land;
    }
    if (w.wind > 1e-3) this.windMods(P, w.wind * (1 - w.swim));
    if (w.air > 1e-3) P.lerp(this.airPose(this.Q), w.air);
    if (w.swim > 1e-3) P.lerp(this.swimPose(this.Q, dt), w.swim);
    if (w.climb > 1e-3) P.lerp(this.climbPose(this.Q, ctx), w.climb);
    if (w.carry > 1e-3) P.lerp(this.carriedPose(this.Q), w.carry);
    this.face(P, dt, ctx);
    this.tailDynamics(P, dt, snap);
    this.apply(P);
  }

  // Model space (her group's) from world, and the ground under a model-space point, relative to her.
  private toModel(p: V3, out: V3) {
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const dx = p.x - this.renderPos.x, dz = p.z - this.renderPos.z;
    return out.set(c * dx - s * dz, p.y - this.renderPos.y, s * dx + c * dz);
  }
  private gy(ctx: PoseContext, x: number, z: number) {
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const wx = this.renderPos.x + c * x + s * z, wz = this.renderPos.z - s * x + c * z;
    return clamp(ctx.ground(wx, wz) - this.renderPos.y, -0.11, 0.11);
  }

  // The ground under a model-space point, relative to her, unclamped (probes start a step above her feet).
  private gyRaw(ctx: PoseContext, x: number, z: number) {
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    return ctx.ground(this.renderPos.x + c * x + s * z, this.renderPos.z - s * x + c * z) - this.renderPos.y;
  }

  // The rest stance, the base of every pose.
  private base(P: Pose) {
    P.hip.set(0, REST.pelvis.y, REST.pelvis.z); P.hipR.set(0, 0, 0);
    P.spine.set(0, 0, 0); P.chest.set(0, 0, 0); P.neck.set(0, 0, 0); P.head.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      P.paw[i].set(SIDE[i] * (FORE[i] ? 0.031 : 0.034), LEG.pawH, FORE[i] ? 0.08 : -0.066);
      P.pawR[i].set(0, 0, 0);
      if (FORE[i]) P.pole[i].set(SIDE[i] * 0.15, -0.1, -1); else P.pole[i].set(SIDE[i] * 0.2, 0, 1);
    }
    P.fore.set(0, 0, 0); P.hind.set(0, 0, 0);
    P.ear.set(0, 0, 0); P.lid = 0; P.mouth = 0; P.sq.copy(ONE);
    return P;
  }

  // Pelvis and chest (and head) of a pose, in model space. (The matrices are reused: use them before the next call.)
  private G = { pel: new THREE.Matrix4(), spi: new THREE.Matrix4(), che: new THREE.Matrix4(), nec: new THREE.Matrix4(), hea: new THREE.Matrix4() };
  private fk(P: Pose) {
    const G = this.G, j = (r: V3) => _q.setFromEuler(_e.set(r.x, r.y, r.z, 'YXZ'));
    G.pel.compose(P.hip, j(P.hipR), ONE);
    G.spi.multiplyMatrices(G.pel, _m.compose(REST.spine, j(P.spine), ONE));
    G.che.multiplyMatrices(G.spi, _m.compose(REST.chest, j(P.chest), ONE));
    G.nec.multiplyMatrices(G.che, _m.compose(REST.neck, j(P.neck), ONE));
    G.hea.multiplyMatrices(G.nec, _m.compose(REST.head, j(P.head), ONE));
    return G;
  }
  // A socket of a leg in model space, offset in its girdle's space.
  private socket(G: { pel: THREE.Matrix4; che: THREE.Matrix4 }, i: number, off: V3, out: V3) {
    const s = (FORE[i] ? REST.fore : REST.hind);
    return out.set(s.x * SIDE[i] + off.x * SIDE[i], s.y + off.y, s.z + off.z).applyMatrix4(FORE[i] ? G.che : G.pel);
  }

  // ---- On the ground: idle, walk, trot, gallop.
  private locomotion(P: Pose, dt: number, ctx: PoseContext, snap: boolean) {
    const b = this.body, w = this.w;
    this.base(P);
    const held = this.carriedBy !== null || !!b.climb;
    const sp = held ? 0 : Math.hypot(b.vel.x, b.vel.z);
    this.speed = snap ? sp : this.speed + (sp - this.speed) * (1 - Math.exp(-dt * 10));
    const s = this.speed;
    this.mv = snap ? (s > 0.08 ? 1 : 0) : this.mv + ((s > 0.08 ? 1 : 0) - this.mv) * (1 - Math.exp(-dt * 7));
    const trot = ss(0.6, 1.15, s), gallop = ss(2.0, 2.8, s);
    const off = (i: number) => lerp(lerp(GAIT.walk[i], GAIT.trot[i], trot), GAIT.gallop[i], gallop);
    const duty = lerp(lerp(0.62, 0.47, trot), 0.27, gallop);
    const stride = lerp(lerp(0.12 + 0.12 * s, 0.15 + 0.12 * s, trot), 0.24 + 0.15 * s, gallop);
    // Turning: how fast her facing changes (rad/s), eased.
    const dyaw = Math.atan2(Math.sin(this.renderYaw - this.lastYaw), Math.cos(this.renderYaw - this.lastYaw));
    this.lastYaw = this.renderYaw;
    if (dt > 0) this.turn += (clamp(dyaw / dt, -12, 12) - this.turn) * (1 - Math.exp(-dt * 8));
    // The phase: from the distance covered; after she stops, a few settling steps bring stray paws home.
    let rate = s / stride;
    const grounded = w.air < 0.5 && w.swim < 0.5 && w.climb < 0.5 && w.carry < 0.5;
    if (s < 0.12 && grounded) {
      let off2 = 0;
      for (let i = 0; i < 4; i++) { const p = this.plants[i], n = P.paw[i]; off2 = Math.max(off2, Math.hypot(p.p.x - n.x, p.p.z - n.z)); }
      if (off2 > 0.012) rate = Math.max(rate, 2.6);
    }
    this.phase = (this.phase + rate * dt) % 1;
    const R = duty * (rate > 1e-4 ? s / rate : 0);
    const lift = lerp(lerp(0.017, 0.024, trot), 0.034, gallop);
    const ph = this.phase;

    // The body: level with the ground under it (nose up a slope), bobbing with the steps; in the gallop the spine
    // arches as the hind paws come through and stretches as the forepaws reach, and the body rocks and flies.
    const gH = grounded ? this.gy(ctx, 0, -0.066) : 0;
    // Under her chest, or under her head where that is a step up (on stairs her head is past the riser before her
    // body is): her front rises to it rather than her face going into the step.
    const gA = grounded ? this.gy(ctx, 0, 0.17) : 0, gC = grounded ? Math.max(this.gy(ctx, 0, 0.08), gA < 0.1 ? gA - 0.015 : -1) : 0;
    const slope = grounded ? clamp(-Math.atan2(gC - gH, 0.146), -0.55, 0.55) : 0;
    this.slope = snap ? slope : this.slope + (slope - this.slope) * (1 - Math.exp(-dt * 12));
    const mvG = this.mv * gallop, mvW = this.mv * (1 - gallop);
    const arch = Math.cos(TAU * (ph + 0.03)) * mvG; // + gathered, - stretched
    const bob = mvW * 0.0028 * Math.cos(TAU * 2 * ph) * (1 - trot * 0.4) - mvG * 0.015 * Math.cos(TAU * 2 * (ph - 0.17)) - 0.012 * mvG;
    const rock = -0.11 * Math.sin(TAU * (ph - 0.05)) * mvG;
    const breathe = Math.sin(this.t * 2.3);
    P.hip.y = REST.pelvis.y + (grounded ? (gH + gC) / 2 + (gH - gC) * 0.47 : 0) + bob;
    P.hip.z = REST.pelvis.z + arch * 0.01;
    P.hipR.x = this.slope + rock - arch * 0.19;
    const lean = clamp(-this.turn * s * 0.035, -0.3, 0.3);
    P.hipR.z = lean; P.spine.z = lean * 0.15;
    P.spine.x = arch * 0.2 + breathe * 0.006 * (1 - this.mv); P.chest.x = arch * 0.16 - breathe * 0.004 * (1 - this.mv);
    P.spine.y = clamp(this.turn * 0.025, -0.2, 0.2); P.chest.y = clamp(this.turn * 0.025, -0.2, 0.2);
    // The head steady and level whatever the body does; a little lower and forward at speed.
    P.neck.x = 0.06 * this.mv + 0.12 * mvG;
    P.head.x = -(P.hipR.x + P.spine.x + P.chest.x + P.neck.x) * 0.85 - 0.05 * this.mv;
    P.neck.y = clamp(this.turn * 0.04, -0.3, 0.3); P.head.z = -lean * 0.5;
    P.ear.x = 0.35 * mvG + 0.1 * mvW * trot;

    // Paws: each stays where it touched down (followed in her own frame as she moves and turns) until its foot
    // lifts; the swing carries it to its next footfall ahead.
    const c = Math.cos(dyaw), sn = Math.sin(dyaw);
    const cy = Math.cos(this.renderYaw), sy = Math.sin(this.renderYaw);
    const mx = (cy * b.vel.x - sy * b.vel.z) * dt * (held ? 0 : 1), mz = (sy * b.vel.x + cy * b.vel.z) * dt * (held ? 0 : 1);
    const strideNow = rate > 1e-4 ? s / rate : 0;
    for (let i = 0; i < 4; i++) {
      const pl = this.plants[i], N = P.paw[i];
      N.x *= 1 - 0.22 * gallop;
      const nx = N.x, nz = N.z;
      if (!grounded || snap) { pl.planted = false; pl.p.set(nx, 0, nz); }
      else {
        // Where it last stood stays fixed on the ground: her frame moved by (mx, mz) and turned by dyaw.
        const x = pl.p.x - mx, z = pl.p.z - mz;
        pl.p.x = c * x - sn * z; pl.p.z = sn * x + c * z;
      }
      const u = (((ph - off(i)) % 1) + 1) % 1;
      const T = P.paw[i];
      if (u < duty) {
        if (!pl.planted) { pl.planted = true; pl.p.set(nx, 0, nz + R * (0.5 - u / duty)); }
        // Out of reach (pushed, slid): drawn back toward where it should be.
        const cz = nz + R * (0.5 - u / duty), ex = pl.p.x - nx, ez = pl.p.z - cz, e = Math.hypot(ex, ez);
        if (e > 0.06) { const k = (e - 0.06) / e; pl.p.x -= ex * k; pl.p.z -= ez * k; }
        T.set(pl.p.x, 0, pl.p.z);
        T.y = (grounded ? this.gy(ctx, T.x, T.z) : 0) + LEG.pawH;
        P.pawR[i].x = this.slope;
      } else {
        // The swing: from where it lifted to where it will come down, both fixed on the ground, so the paw leaves
        // and meets the ground at rest.
        pl.planted = false;
        const v = (u - duty) / (1 - duty), k = ss(0, 1, v);
        const bz = nz + strideNow * (duty / 2 + (1 - v) * (1 - duty));
        T.set(pl.p.x + (nx - pl.p.x) * k, 0, pl.p.z + (bz - pl.p.z) * k);
        const travel = Math.min(1, Math.hypot(nx - pl.p.x, bz - pl.p.z) / 0.03);
        T.y = (grounded ? this.gy(ctx, T.x, T.z) : 0) + LEG.pawH + lift * Math.sin(Math.PI * v) * travel;
        // The paw curls through its swing (pads showing behind it).
        P.pawR[i].x = this.slope + Math.sin(Math.PI * Math.min(1, v * 1.3)) * lerp(0.5, 1.1, gallop) * travel;
      }
    }
    // Tail: carried up in a soft curve with its tip hooked, swaying; up and happy at a walk; out behind in the gallop.
    const sway = Math.sin(this.t * 1.4);
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      const idleP = [0.95, 0.3, 0.12, 0.0, -0.22, -0.38][i], walkP = [1.25, 0.2, 0.05, -0.05, -0.2, -0.32][i], galP = [0.3, 0.06, 0.02, 0.02, 0.05, 0.08][i];
      P.tail[i * 2] = lerp(lerp(idleP, walkP, this.mv * (1 - gallop)), galP, mvG) + mvG * 0.14 * Math.sin(TAU * ph - i * 0.8) - P.hipR.x * (i === 0 ? 0.8 : 0);
      P.tail[i * 2 + 1] = sway * 0.1 * (0.4 + f) * (1 - mvG * 0.7) + Math.sin(this.t * 2.1 - i * 0.7) * 0.05 * f;
    }
  }

  // Hunkered down against the wind: low, ears flat, squinting, the tail whipping downwind.
  private windMods(P: Pose, k: number) {
    P.hip.y -= 0.022 * k; P.spine.x += 0.04 * k; P.chest.x += 0.04 * k; P.neck.x += 0.1 * k; P.head.x -= 0.12 * k;
    for (let i = 0; i < 4; i++) { P.paw[i].x *= 1 + 0.18 * k; }
    P.ear.x += 1.0 * k; P.ear.z += 0.25 * k; P.lid = Math.max(P.lid, 0.55 * k);
    // Downwind in her own frame.
    const cy = Math.cos(this.renderYaw), sy = Math.sin(this.renderYaw);
    const dx = cy * WIND.dir.x - sy * WIND.dir.y, dz = sy * WIND.dir.x + cy * WIND.dir.y;
    const yawTo = clamp(Math.atan2(-dx, -dz), -1.5, 1.5);
    P.hipR.z += clamp(-dx, -1, 1) * 0.1 * k;
    const g = 0.5 + 0.5 * WIND.gust;
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      P.tail[i * 2] = lerp(P.tail[i * 2], (i === 0 ? 0.1 : 0.02) + Math.sin(this.t * 13 - i * 1.1) * 0.12 * g * f, k);
      P.tail[i * 2 + 1] = lerp(P.tail[i * 2 + 1], (i === 0 ? yawTo * 0.6 : yawTo * 0.08) + Math.sin(this.t * 17 - i * 1.3) * 0.22 * g * (0.3 + f), k);
    }
  }

  // ---- In the air: stretched out rising (forelegs reaching on and up, hind legs back), forepaws reaching down for
  // the ground falling.
  private airPose(P: Pose) {
    const b = this.body;
    this.base(P);
    const r = ss(-1.2, 1.8, b.vy);
    P.hip.y = lerp(0.112, 0.118, r);
    P.hipR.x = lerp(0.2, -0.3, r);
    P.spine.x = lerp(0.0, 0.06, r); P.chest.x = lerp(0.04, 0.06, r);
    P.neck.x = lerp(0.05, -0.05, r);
    P.head.x = -(P.hipR.x + P.spine.x + P.chest.x + P.neck.x) * 0.8 + lerp(0.12, -0.05, r);
    const G = this.fk(P);
    for (let i = 0; i < 4; i++) {
      const T = P.paw[i];
      if (FORE[i]) { this.socket(G, i, _a.set(0.004, lerp(-0.1, -0.035, r), lerp(0.03, 0.078, r)), T); P.pawR[i].x = lerp(-0.1, -0.5, r); }
      else { this.socket(G, i, _a.set(0.004, lerp(-0.08, -0.06, r), lerp(0.03, -0.08, r)), T); P.pawR[i].x = lerp(0.35, 1.25, r); }
    }
    const tr = [lerp(0.95, -0.2, r), lerp(0.25, 0.05, r), lerp(0.15, 0.05, r), lerp(0.05, 0.05, r), lerp(-0.1, 0.08, r), lerp(-0.2, 0.1, r)];
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = tr[i]; P.tail[i * 2 + 1] = 0; }
    P.ear.x = lerp(0.05, 0.5, r);
    P.sq.set(lerp(1, 0.97, r), lerp(1.02, 0.97, r), lerp(0.99, 1.07, r));
    return P;
  }

  // ---- Swimming: low and level, chin up over the water, paddling all four (diagonal pairs), tail afloat behind.
  private swimPose(P: Pose, dt: number) {
    const b = this.body;
    this.base(P);
    const sp = Math.hypot(b.vel.x, b.vel.z);
    this.swimPh = (this.swimPh + dt * (1.5 + 0.9 * sp)) % 1;
    const ph = this.swimPh;
    P.hip.y = 0.064 + 0.0035 * Math.sin(TAU * 2 * ph);
    P.hipR.x = -0.05;
    P.neck.x = -0.5; P.head.x = 0.3;
    const G = this.fk(P);
    for (let i = 0; i < 4; i++) {
      const a = TAU * (ph + (i === 0 || i === 3 ? 0 : 0.5));
      const T = P.paw[i];
      if (FORE[i]) { this.socket(G, i, _a.set(0.006, -0.058 + 0.02 * Math.sin(a), 0.028 + 0.03 * Math.cos(a)), T); P.pawR[i].x = 0.4 + 0.4 * Math.sin(a); }
      else { this.socket(G, i, _a.set(0.006, -0.062 + 0.012 * Math.sin(a), -0.028 + 0.034 * Math.cos(a)), T); P.pawR[i].x = 0.9; }
    }
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = i === 0 ? 0.2 : 0.0; P.tail[i * 2 + 1] = Math.sin(this.t * 2.4 - i * 0.8) * 0.16 * (0.3 + i / TAIL_N); }
    P.ear.x = 0.2;
    return P;
  }

  // ---- Climbing: facing the face, body up it, forepaws reaching up by turns, hind paws pushing, tail hanging; at
  // the top the forepaws go over onto the ledge and she pulls herself up.
  private climbPose(P: Pose, ctx: PoseContext) {
    const b = this.body;
    this.base(P);
    const cl = b.climb;
    const ph = cl ? cl.phase : 0;
    P.hip.set(0, 0.078 + 0.005 * Math.sin(ph * 2), -0.012);
    P.hipR.x = -1.3;
    P.spine.x = 0.06; P.chest.x = 0.04;
    P.neck.x = 0.55; P.head.x = 0.3;
    P.fore.set(0.004, -0.004, 0.004);
    const G = this.fk(P);
    const chestY = _a.setFromMatrixPosition(G.che).y, hipY = P.hip.y;
    const wall = CLIMB_DIST - 0.013;
    for (let i = 0; i < 4; i++) {
      const alt = i === 0 || i === 3 ? 0 : Math.PI;
      const reach = 0.5 + 0.5 * Math.sin(ph + alt);
      if (FORE[i]) { P.paw[i].set(SIDE[i] * 0.03, chestY + 0.04 + 0.045 * reach, wall); P.pawR[i].x = -1.45; P.pole[i].set(SIDE[i] * 0.9, -0.5, -0.4); }
      else { P.paw[i].set(SIDE[i] * 0.042, hipY - 0.045 + 0.03 * (1 - reach), wall - 0.002); P.pawR[i].x = -1.2; P.pole[i].set(SIDE[i] * 0.8, 0.3, 0.4); }
    }
    // Near the top: the face ends within reach, so the forepaws go over onto the ledge and she pulls herself up,
    // tipping forward over it. (climb.ts keeps its exit to itself, so the ledge is found by probing over the edge;
    // `body.climb.exit`, when an engine sets it, drives the same.)
    let ledge: number | null = null, wallZ = CLIMB_DIST;
    if (cl?.exit) {
      const e = cl.exit, fx = Math.sin(this.renderYaw), fz = Math.cos(this.renderYaw);
      ledge = e.to.y - this.renderPos.y;
      wallZ = CLIMB_DIST - ((this.renderPos.x - e.from.x) * fx + (this.renderPos.z - e.from.z) * fz);
    } else {
      wallZ = CLIMB_DIST - this.climbOver;
      const top = this.gyRaw(ctx, 0, wallZ + 0.045);
      if (top < 0.262) ledge = top;
      this.ledgeNear = ledge !== null;
    }
    if (ledge !== null) {
      const pull = ss(0.3, 0.16, ledge) * (cl?.exit ? 1 : 1);
      for (let i = 0; i < 2; i++) {
        _b.set(SIDE[i] * 0.032, ledge + LEG.pawH, wallZ + 0.03);
        P.paw[i].lerp(_b, ss(0, 0.6, pull)); P.pawR[i].x = lerp(P.pawR[i].x, 0, ss(0, 0.6, pull));
      }
      P.hipR.x = lerp(-1.3, -0.95, pull);
      P.neck.x = lerp(0.55, 0.35, pull); P.head.x = lerp(0.3, 0.45, pull);
    }
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = 0.06 + (i === 0 ? 0.2 : 0); P.tail[i * 2 + 1] = Math.sin(this.t * 1.6 - i * 0.6) * 0.12 * (0.3 + i / TAIL_N); }
    return P;
  }

  // ---- In the knight's hands, held under her forelegs: forelegs up over his thumbs, hind legs and tail dangling.
  private carriedPose(P: Pose) {
    this.base(P);
    const sw = Math.sin(this.t * 1.8);
    P.hip.set(sw * 0.004, -0.122, -0.014);
    P.hipR.set(-1.42, 0, sw * 0.05);
    P.spine.x = -0.04; P.chest.x = -0.04;
    P.neck.x = 0.72; P.head.x = 0.62; P.head.z = 0.12 * Math.sin(this.t * 0.6);
    P.fore.set(0.004, 0.0, 0.0);
    const G = this.fk(P);
    for (let i = 0; i < 4; i++) {
      // Forelegs up over his hands, paws drooping.
      if (FORE[i]) { P.paw[i].set(SIDE[i] * 0.046, 0.058 + 0.004 * Math.sin(this.t * 2 + i), 0.062); P.pawR[i].x = 1.1; P.pole[i].set(SIDE[i] * 0.85, -0.35, -0.3); }
      else { this.socket(G, i, _a.set(0.004, -0.075, 0.012 + 0.008 * Math.sin(this.t * 2.3 + i * 1.7)), P.paw[i]); P.pawR[i].x = 1.25; P.pole[i].set(SIDE[i] * 0.2, 0, 1); }
    }
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = i >= 4 ? 0.35 : 0.04; P.tail[i * 2 + 1] = Math.sin(this.t * 1.8 - i * 0.5) * 0.12 * (0.3 + i / TAIL_N); }
    P.ear.x = 0.1; P.lid = 0.12;
    return P;
  }

  // ---- Story poses.
  // Sitting up on her haunches: forelegs straight, chest up, hind paws folded beside them, tail curled round.
  private sitPose(P: Pose, ctx: PoseContext) {
    this.base(P);
    const g = this.gy(ctx, 0, 0);
    // Rump on the ground, back rounding up to an upright chest, head level on top.
    P.hip.set(0, 0.056 + g, -0.06);
    P.hipR.x = -0.55;
    P.spine.x = -0.1; P.chest.x = -0.22;
    P.neck.x = 0.57; P.head.x = 0.3 + Math.sin(this.t * 2.2) * 0.008;
    P.fore.set(0.002, -0.012, 0.006);
    for (let i = 0; i < 4; i++) {
      if (FORE[i]) { P.paw[i].set(SIDE[i] * 0.022, g + LEG.pawH, 0.078); P.pole[i].set(SIDE[i] * 0.1, 0, -1); }
      else { P.paw[i].set(SIDE[i] * 0.047, g + LEG.pawH, 0.032); P.pawR[i].y = SIDE[i] * 0.2; P.pole[i].set(SIDE[i] * 0.5, 0.8, 0.5); }
    }
    // The tail round her left side toward her paws, its tip stirring.
    const tc = [0.38, 0.06, 0.04, 0.02, 0.02, 0.04], ty = [-0.85, -0.75, -0.6, -0.45, -0.35, -0.3];
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = tc[i]; P.tail[i * 2 + 1] = ty[i] + (i >= 4 ? Math.sin(this.t * 1.7) * 0.1 : 0); }
    return P;
  }

  // Gathered low to leap, her rump wiggling.
  private crouchPose(P: Pose, ctx: PoseContext) {
    this.base(P);
    const g = this.gy(ctx, 0, 0);
    const wig = Math.sin(this.t * 15) * (0.55 + 0.45 * Math.sin(this.t * 2.3));
    P.hip.set(wig * 0.006, 0.086 + g, -0.07);
    P.hipR.set(0.16, wig * 0.14, wig * 0.08);
    P.spine.x = 0.08; P.chest.x = 0.1; P.spine.y = -wig * 0.08;
    P.neck.x = -0.32; P.head.x = -(0.16 + 0.08 + 0.1 - 0.32) - 0.1;
    for (let i = 0; i < 4; i++) {
      if (FORE[i]) { P.paw[i].set(SIDE[i] * 0.033, g + LEG.pawH, 0.1); P.pole[i].set(SIDE[i] * 0.4, 0.5, -1); }
      else { P.paw[i].set(SIDE[i] * 0.037, g + LEG.pawH, -0.046); P.pole[i].set(SIDE[i] * 0.25, 0.2, 1); }
    }
    const tc = [-0.3, 0.02, 0.0, 0.0, 0.05, 0.1];
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = tc[i]; P.tail[i * 2 + 1] = i >= 3 ? Math.sin(this.t * 9 - i) * 0.3 * (i - 2) / 3 : 0; }
    P.ear.x = -0.15; P.lid = -0.08;
    return P;
  }

  // Asleep, curled round on herself like a croissant: lying a little on her side, her head turned back along her
  // body with her chin on her paws, the tail wrapped round to her nose; breathing slow.
  private curlPose(P: Pose, ctx: PoseContext) {
    this.base(P);
    const g = this.gy(ctx, 0, 0);
    const br = Math.sin(this.t * 1.5);
    P.hip.set(-0.02, 0.05 + g, -0.05);
    P.hipR.set(0.0, 0.85, 0.3);
    P.spine.set(0.02, -0.62, 0.0); P.chest.set(0.03 - br * 0.015, -0.62, -0.08);
    P.neck.set(0.72, -0.75, 0.0); P.head.set(0.12, -0.6, 0.5);
    P.sq.set(1 + br * 0.008, 1 + br * 0.012, 1);
    P.fore.set(0, 0.006, 0); P.hind.set(0, 0.006, 0);
    const G = this.fk(P);
    for (let i = 0; i < 4; i++) {
      if (FORE[i]) { this.socket(G, i, _a.set(-0.01, -0.03, 0.058), P.paw[i]); P.pawR[i].set(0, -0.4, 0); P.pole[i].set(SIDE[i] * 0.3, 0.8, -0.4); }
      else { this.socket(G, i, _a.set(0.006, -0.03, 0.05), P.paw[i]); P.pawR[i].set(0, 0.3, 0); P.pole[i].set(SIDE[i] * 0.6, 0.7, 0.6); }
      P.paw[i].y = g + LEG.pawH * 0.8;
    }
    const ty = [1.0, 0.55, 0.5, 0.5, 0.45, 0.4];
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = i === 0 ? -0.25 : 0.02; P.tail[i * 2 + 1] = ty[i]; }
    P.lid = 1; P.ear.set(0.3, 0.1, 0.25);
    return P;
  }

  // Head-butting forward (her mother), every couple of seconds, eyes closed into it.
  private nudgePose(P: Pose, ctx: PoseContext) {
    this.base(P);
    const g = this.gy(ctx, 0, 0);
    const push = Math.pow(Math.max(0, Math.sin(this.t * 2.6)), 2);
    P.hip.set(0, 0.104 + g, -0.072 + push * 0.012);
    P.hipR.x = 0.08;
    P.spine.x = 0.05; P.chest.x = 0.1 + push * 0.05;
    P.neck.x = -0.25 - push * 0.2; P.head.x = 0.0 - push * 0.35;
    for (let i = 0; i < 4; i++) P.paw[i].set(SIDE[i] * (FORE[i] ? 0.031 : 0.036), g + LEG.pawH, FORE[i] ? 0.092 : -0.078);
    const tc = [0.45, 0.2, 0.1, 0.0, -0.15, -0.3];
    for (let i = 0; i < TAIL_N; i++) { P.tail[i * 2] = tc[i]; P.tail[i * 2 + 1] = Math.sin(this.t * 1.3 - i * 0.5) * 0.12; }
    P.lid = push * 0.95; P.ear.x = 0.35 * push;
    return P;
  }

  // ---- Over every pose: where she looks, blinks, ear twitches, her voice.
  private face(P: Pose, dt: number, ctx: PoseContext) {
    const w = this.w, g = this.glance;
    // What she looks at: a story's target, else (standing about) now the knight, now something else.
    g.t -= dt;
    if (g.t <= 0) {
      g.watch = Math.random() < 0.6; g.t = 1.6 + Math.random() * 3.2;
      g.yaw = (Math.random() * 2 - 1) * 0.7; g.pitch = -0.3 + Math.random() * 0.4;
      g.tilt = Math.random() < 0.3 ? (Math.random() < 0.5 ? -0.22 : 0.22) : 0;
    }
    const free = (1 - w.climb) * (1 - w.curl) * (1 - w.swim * 0.6) * (1 - w.air);
    let ty = 0, tp = 0;
    const target = this.lookTarget ?? (g.watch && ctx.lookAt ? ctx.lookAt : null);
    const G = this.fk(P);
    if (target) {
      this.toModel(target, _a);
      _b.setFromMatrixPosition(G.hea);
      _a.sub(_b);
      const yaw = Math.atan2(_a.x, _a.z) - (P.hipR.y + P.spine.y + P.chest.y);
      const dist = Math.hypot(_a.x, _a.z);
      const story = !!this.lookTarget;
      if ((story || (Math.abs(yaw) < 2.0 && dist < 7)) && free > 0.05) {
        ty = clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -1.15, 1.15);
        tp = clamp(-Math.atan2(_a.y, Math.max(0.15, dist)), -0.8, 0.45);
      }
    } else if (this.mv < 0.5) { ty = g.yaw; tp = g.pitch; }
    const idle = (1 - this.mv) * free;
    ty *= lerp(0.25, 1, idle) * free; tp *= lerp(0.3, 1, idle) * free;
    const k = 1 - Math.exp(-dt * 4.5);
    this.look.x += (ty - this.look.x) * k; this.look.y += (tp - this.look.y) * k;
    this.tilt += (g.tilt * idle * (this.lookTarget ? 0.5 : 1) - this.tilt) * (1 - Math.exp(-dt * 3));
    P.neck.y += 0.35 * this.look.x; P.head.y += 0.65 * this.look.x;
    P.neck.x += 0.4 * this.look.y; P.head.x += 0.6 * this.look.y;
    P.head.z += this.tilt;
    // Her voice.
    const m = this.meowS;
    if (m) {
      m.t += dt;
      const a = m.t / (m.dur + 0.25);
      if (a >= 1) this.meowS = null;
      else {
        const e = Math.pow(Math.sin(Math.PI * a), 0.7);
        const open = m.open * ss(0, 0.12, m.t) * ss(m.dur + 0.12, m.dur - 0.08, m.t);
        P.head.x -= m.amt * e * 0.6; P.neck.x -= m.amt * e * 0.4; P.head.z += m.roll * e;
        P.mouth = Math.max(P.mouth, open);
        if (m.cry) { P.ear.x += 0.5 * e; P.lid = Math.max(P.lid, 0.35 * e); }
        else P.lid = Math.max(P.lid, 0.15 * e);
      }
    }
    // Blinks (now and then a double).
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blink < 0) { this.blink = 0; this.blinkT = 1.8 + Math.random() * 3.6; if (Math.random() < 0.2) this.blinkT = 0.3; }
    if (this.blink >= 0) {
      this.blink += dt / 0.17;
      if (this.blink >= 1) this.blink = -1;
      else P.lid = Math.max(P.lid, ss(0, 1, 1 - Math.abs(this.blink * 2 - 1)));
    }
    // Ear twitches, one ear at a time.
    for (let s = 0; s < 2; s++) {
      const tw = this.twitch[s];
      tw.t -= dt;
      if (tw.t <= 0 && tw.a < 0) { tw.a = 0; tw.t = 2.5 + Math.random() * 6; }
      if (tw.a >= 0) { tw.a += dt / 0.28; if (tw.a >= 1) tw.a = -1; }
    }
  }

  // The tail follows its pose on springs: a little lag and overshoot, swinging out as she turns and whipping as
  // she leaps or lands.
  private tailDynamics(P: Pose, dt: number, snap: boolean) {
    const A = this.tailA, Vv = this.tailV;
    if (snap || dt <= 0) { A.set(P.tail); Vv.fill(0); this.lastVy = this.body.vy; P.tail.set(A); return; }
    const dvy = clamp(this.body.vy - this.lastVy, -6, 6); this.lastVy = this.body.vy;
    const dyaw = this.turn * dt;
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      A[i * 2 + 1] += dyaw * 0.35 * (0.3 + f) * (1 - this.w.carry);
      A[i * 2] += dvy * 0.04 * (0.4 + f) * (1 - this.w.carry);
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let s = 0; s < n; s++) for (let i = 0; i < TAIL_N * 2; i++) {
      const f = (i >> 1) / (TAIL_N - 1);
      const kk = lerp(320, 110, f), c = 2 * 0.62 * Math.sqrt(kk);
      Vv[i] += ((P.tail[i] - A[i]) * kk - Vv[i] * c) * h;
      A[i] += Vv[i] * h;
    }
    P.tail.set(A);
  }

  // ---- Onto the joints: torso by forward kinematics, legs by two-bone IK in model space, then tail, ears, face.
  private apply(P: Pose) {
    const r = this.rig;
    r.model.scale.copy(P.sq);
    r.pelvis.position.copy(P.hip); r.pelvis.rotation.set(P.hipR.x, P.hipR.y, P.hipR.z, 'YXZ');
    r.spine.rotation.set(P.spine.x, P.spine.y, P.spine.z, 'YXZ');
    r.chest.rotation.set(P.chest.x, P.chest.y, P.chest.z, 'YXZ');
    r.neck.rotation.set(P.neck.x, P.neck.y, P.neck.z, 'YXZ');
    r.head.rotation.set(P.head.x, P.head.y, P.head.z, 'YXZ');
    r.head.scale.setScalar(HEAD_SCALE);
    const G = this.fk(P);
    const qP = this.qP.setFromRotationMatrix(G.pel), qC = this.qC.setFromRotationMatrix(G.che);
    for (let i = 0; i < 4; i++) {
      const L = r.legs[i];
      const o = FORE[i] ? P.fore : P.hind;
      L.upper.position.set(L.socket.x + o.x * SIDE[i], L.socket.y + o.y, L.socket.z + o.z);
      const H = _a.copy(L.upper.position).applyMatrix4(FORE[i] ? G.che : G.pel);
      const knee = _b, end = _c;
      solveTwoBone(H, P.paw[i], L.l1, L.l2, P.pole[i], knee, end);
      const qG = FORE[i] ? qC : qP;
      const qU = aim(H, knee, P.pole[i], _q);
      L.upper.quaternion.copy(qG).invert().multiply(qU);
      const qL = aim(knee, end, P.pole[i], _q2);
      L.lower.quaternion.copy(qU).invert().multiply(qL);
      const qPaw = this.qPaw.setFromEuler(_e.set(P.pawR[i].x, P.pawR[i].y, P.pawR[i].z, 'YXZ'));
      L.paw.quaternion.copy(qL).invert().multiply(qPaw);
    }
    for (let i = 0; i < TAIL_N; i++) r.tail[i].rotation.set(P.tail[i * 2], P.tail[i * 2 + 1], 0, 'YXZ');
    // Ears: tilted out, turned a little forward-out; laid back, drooped, twitched.
    const ke = 0.25;
    this.earA.lerp(P.ear, ke);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1, tw = this.twitch[s].a >= 0 ? Math.sin(Math.PI * this.twitch[s].a) : 0;
      r.ears[s].rotation.set(-0.12 - this.earA.x - tw * 0.45, side * (0.22 + this.earA.y + tw * 0.25), -side * (0.36 + this.earA.z * 0.6 + this.earA.x * 0.25), 'ZYX');
    }
    // Lids: the upper lid comes down over the eye while the eye itself squashes down toward its lower edge, so a
    // closed eye is a soft curved line; catchlights go out with the shine.
    const lid = clamp(P.lid, -0.15, 1), sq = 1 - 0.86 * ss(0.25, 1, lid);
    for (const l of r.lids) l.rotation.x = lid < 0 ? lerp(-2.6, -2.85, -lid / 0.15) : lerp(-2.6, -1.25, lid);
    for (let s = 0; s < 2; s++) {
      const e = r.eyes[s];
      e.scale.set(1, 1.1 * sq, 0.9);
      e.position.set(REST.eye.x * (s === 0 ? 1 : -1), REST.eye.y, REST.eye.z).add(_d.set(0, -0.4 * EYE_R * 1.1 * (1 - sq), 0).applyQuaternion(e.quaternion));
    }
    r.glintMat.visible = lid < 0.55;
    const o = clamp(P.mouth, 0, 1.2);
    r.jaw.scale.set(0.5 + 0.45 * o, 0.08 + 0.92 * o, 0.55 + 0.45 * o);
    r.jaw.position.y = REST.jaw.y - 0.003 * o;
    this.group.updateMatrixWorld(true);
  }

  // ---- The cape's pins (across her shoulders) and the balls standing in for her body, world space.
  private capeFrame() {
    const r = this.rig, c = this.cape;
    const n = c.cols;
    for (let i = 0; i < n; i++) {
      // Round the base of her neck: the middle behind it, the corners fastened at the fronts of her shoulders.
      const a = lerp(-1.0, 1.0, i / (n - 1)), sa = Math.abs(Math.sin(a));
      c.pins[i].set(Math.sin(a) * 0.056, Math.cos(a) * 0.058 + 0.004, -0.016 + sa * sa * 0.016).applyMatrix4(r.chest.matrixWorld);
    }
    const B = this.balls;
    let k = 0;
    const ball = (o: THREE.Object3D, x: number, y: number, z: number, rad: number) => {
      const bl = B[k++];
      bl.c.set(x, y, z).applyMatrix4(o.matrixWorld); bl.r = rad;
      bl.up.set(0, 1, 0).transformDirection(o.matrixWorld);
    };
    // Her head, the tops of her forelegs and her tail as balls; her body by its own surface (torsoPush).
    ball(r.head, 0, 0.004, -0.004, 0.053);
    for (let i = 0; i < 2; i++) ball(r.legs[i].upper, 0, 0.002, 0, 0.027);
    ball(r.tail[0], 0, 0, -0.012, 0.022);
    B.length = k;
    // A capsule round her body for a quick test before the true shape.
    c.near.a.set(0, 0, -0.07).applyMatrix4(r.pelvis.matrixWorld); c.near.b.set(0, 0, 0.06).applyMatrix4(r.chest.matrixWorld); c.near.r = 0.085;
    // How far she moved since the last frame (the cloth's steps place her part way).
    _a.setFromMatrixPosition(r.chest.matrixWorld);
    if (this.capeLast) c.bodyDelta.subVectors(_a, this.capeLast); else c.bodyDelta.set(0, 0, 0);
    if (c.bodyDelta.lengthSq() > 0.25) c.bodyDelta.set(0, 0, 0);
    this.capeLast = (this.capeLast ?? new V()).copy(_a);
    // Each torso joint's skinning matrix (bind pose to world now) and its inverse.
    const sk = r.body.skeleton;
    for (let j = 0; j < 3; j++) {
      const bone = [r.pelvis, r.spine, r.chest][j];
      this.torsoM[j].multiplyMatrices(bone.matrixWorld, sk.boneInverses[j]); // (pelvis, spine and chest lead the bone list)
      this.torsoInv[j].copy(this.torsoM[j]).invert();
    }
    // A collar: the cloth stays behind the fronts of her shoulders (a gale lifts it, never over her head).
    c.collar.c.set(0, 0, 0.02).applyMatrix4(r.chest.matrixWorld);
    c.collar.n.set(0, 0, 1).transformDirection(r.chest.matrixWorld);
    const b = this.body;
    c.water = b.swimming ? this.renderPos.y + SWIM_FLOAT - 0.004 : null;
    c.floor = b.grounded ? this.renderPos.y + 0.004 : null;
    c.sheltered = WIND.sheltered(this.renderPos);
  }

  // Out of her body: the point taken back to the pose she was modelled in by the torso joint nearest it, pushed out
  // of the torso's surface (with a little room for the wool), and brought back.
  private torsoPush(P: Float32Array, o: number) {
    const f = this.rig.torsoSDF, M = this.torsoInv;
    const q = _x.set(P[o], P[o + 1], P[o + 2]).applyMatrix4(M[1]);
    const zP = REST.pelvis.z, zC = REST.pelvis.z + REST.spine.z + REST.chest.z;
    const j = q.z < zP + 0.025 ? 0 : q.z > zC - 0.025 ? 2 : 1;
    if (j !== 1) q.set(P[o], P[o + 1], P[o + 2]).applyMatrix4(M[j]);
    const room = 0.0045;
    const d = f(q.x, q.y, q.z) - room;
    if (d >= 0) return;
    if (d < -0.018) {
      // Deep inside (her body went through it in a step): out through the top of her back, never under her.
      let lo = q.y, hi = q.y;
      for (let k = 0; k < 16 && f(q.x, hi, q.z) < room; k++) hi += 0.012;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (f(q.x, m, q.z) < room) lo = m; else hi = m; }
      q.y = hi;
      q.applyMatrix4(this.torsoM[j]);
      P[o] = q.x; P[o + 1] = q.y; P[o + 2] = q.z;
      return;
    }
    const e = 0.0006;
    const g = _y.set(f(q.x + e, q.y, q.z) - f(q.x - e, q.y, q.z), f(q.x, q.y + e, q.z) - f(q.x, q.y - e, q.z), f(q.x, q.y, q.z + e) - f(q.x, q.y, q.z - e));
    const gl = g.length();
    if (gl < 1e-9) g.set(0, 1, 0); else g.multiplyScalar(1 / gl);
    q.addScaledVector(g, -d);
    q.applyMatrix4(this.torsoM[j]);
    P[o] = q.x; P[o + 1] = q.y; P[o + 2] = q.z;
  }

  private resetSecondary() {
    this.blinkT = 1 + Math.random() * 2;
  }
}

// Two-bone IK: from a (the joint) toward t, segment lengths l1 and l2, bending toward `pole`. Writes the middle joint
// and the reached end (clamped short of full stretch).
function solveTwoBone(a: V3, t: V3, l1: number, l2: number, pole: V3, mid: V3, end: V3) {
  const dir = _d.subVectors(t, a);
  let d = dir.length();
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
  dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = _x.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
  p.normalize();
  mid.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
  end.copy(a).addScaledVector(dir, d);
}

// The rotation that points a segment's -y from `from` to `to` with its +z toward `pole`.
function aim(from: V3, to: V3, pole: V3, out: THREE.Quaternion) {
  _y.subVectors(from, to).normalize();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m2.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m2);
}
