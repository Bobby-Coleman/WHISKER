// +X is the character's left when facing +Z; parts named L/R follow that.
// Shared character body + procedural biped presentation. Gameplay owns `body`; visuals read it.
import * as THREE from 'three/webgpu';
import { Gait, GaitParams, orientBone, solveTwoBone } from './rig';
import type { Climbable } from '../game/physics';

// On a climbable face: where along it (u) and how high the feet are (v); `exit` animates a vault or a mantle at the
// top. Gameplay (game/climb.ts) owns it; the pose reads it.
export type ClimbState = {
  panel: Climbable; u: number; v: number; phase: number; speed: number;
  exit: null | { t: number; dur: number; from: THREE.Vector3; top: THREE.Vector3; to: THREE.Vector3 };
};

export type Kind = 'kitten' | 'knight';

export class CharacterBody {
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; prevYaw = 0; turnRate = 0;
  radius: number; height: number;
  grounded = true; vy = 0;
  // Strength of the last landing (0..1), eased off by the pose: a dip in the knees and pelvis.
  landing = 0;
  climb: ClimbState | null = null;
  // Visual-only height offset that eases to zero: a step up taken in one physics step reads as a quick hop.
  visualDY = 0;
  constructor(radius: number, height: number) { this.radius = radius; this.height = height; }
}

export type PoseContext = {
  dt: number; time: number;
  ground: (x: number, z: number) => number;
  lookAt: THREE.Vector3 | null; // world point of interest (companion, interaction)
  active: boolean;
};

export const PART_NAMES = ['pelvis', 'chest', 'head', 'uarmL', 'uarmR', 'farmL', 'farmR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'] as const;
export type PartName = (typeof PART_NAMES)[number];

export abstract class Character {
  kind: Kind;
  body: CharacterBody;
  group = new THREE.Group();
  parts = {} as Record<PartName, THREE.Group>;
  gait: Gait;
  // Interpolated render transform.
  renderPos = new THREE.Vector3();
  renderYaw = 0;
  headLook = new THREE.Euler();
  armL = { target: new THREE.Vector3(), pole: new THREE.Vector3(1, -0.4, -1), handQ: new THREE.Quaternion(), useHandQ: false };
  armR = { target: new THREE.Vector3(), pole: new THREE.Vector3(-1, -0.4, -1), handQ: new THREE.Quaternion(), useHandQ: false };
  dims: { upperArm: number; foreArm: number; shoulderW: number; shoulderY: number; shoulderZ?: number; spine: number; neck: number };
  breath = 0;
  lean = 0; leanSide = 0;
  pelvisDrop = 0;
  accel = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  carriedBy: Character | null = null;
  holding: Character | null = null;
  override: ((c: Character, ctx: PoseContext) => void) | null = null;
  // 0 on the ground .. 1 on a climbing face (eased by the pose).
  climbBlend = 0;

  constructor(kind: Kind, body: CharacterBody, gait: GaitParams, dims: Character['dims']) {
    this.kind = kind; this.body = body; this.gait = new Gait(gait); this.dims = dims;
    for (const n of PART_NAMES) { const g = new THREE.Group(); g.name = `${kind}_${n}`; this.parts[n] = g; this.group.add(g); }
    this.group.name = kind;
  }

  toLocal(world: THREE.Vector3, out: THREE.Vector3) {
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const dx = world.x - this.renderPos.x, dz = world.z - this.renderPos.z;
    return out.set(c * dx - s * dz, world.y - this.renderPos.y, s * dx + c * dz);
  }
  toWorld(local: THREE.Vector3, out: THREE.Vector3) {
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    return out.set(c * local.x + s * local.z + this.renderPos.x, local.y + this.renderPos.y, -s * local.x + c * local.z + this.renderPos.z);
  }

  resetPose(ground: (x: number, z: number) => number) {
    this.renderPos.copy(this.body.pos); this.renderYaw = this.body.yaw;
    this.gait.reset(this.body.pos, this.body.yaw, ground);
  }

  // Called each render frame with the interpolation alpha between physics steps.
  updateVisual(alpha: number, ctx: PoseContext) {
    const b = this.body;
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    if (b.visualDY !== 0) {
      this.renderPos.y += b.visualDY;
      b.visualDY *= Math.exp(-Math.max(1e-4, ctx.dt) * 18);
      if (Math.abs(b.visualDY) < 1e-4) b.visualDY = 0;
    }
    let dy = b.yaw - b.prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.renderYaw = b.prevYaw + dy * alpha;
    this.group.position.copy(this.renderPos);
    this.group.rotation.set(0, this.renderYaw, 0);
    const dt = Math.max(1e-4, ctx.dt);
    this.accel.subVectors(b.vel, this.lastVel).divideScalar(dt);
    this.lastVel.copy(b.vel);
    if (this.carriedBy) {
      this.poseCarried(ctx);
      return;
    }
    // In the air the feet plan their steps on a ground just under the body: the legs tuck instead of reaching for
    // the earth below. On landing they plant again and the body dips with the impact.
    const tuck = this.gait.p.hipY * 0.42;
    const ground = b.grounded ? ctx.ground : (_x: number, _z: number) => this.renderPos.y + tuck;
    this.gait.update(dt, this.renderPos, b.vel, this.renderYaw, b.turnRate, ground);
    this.climbBlend += ((b.climb ? 1 : 0) - this.climbBlend) * Math.min(1, dt * 7);
    if (this.climbBlend > 0.001) this.climbFeet(ctx);
    b.landing = Math.max(0, b.landing - dt * 3.5);
    this.poseLegs(ctx);
    this.poseUpper(ctx);
    this.solveArms();
  }

  // Driven by an animated skeleton (engine v2, src/v2/driven.ts): `mats` holds each part's world transform, taken
  // from the bones; the character then adds only its own secondary motion (ears, tail, skirt, sword, cape anchors).
  poseDriven(pos: THREE.Vector3, yaw: number, ctx: PoseContext, mats: Partial<Record<PartName, THREE.Matrix4>>) {
    const b = this.body, dt = Math.max(1e-4, ctx.dt);
    this.renderPos.copy(pos); this.renderYaw = yaw;
    this.group.position.copy(pos);
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld();
    this.accel.subVectors(b.vel, this.lastVel).divideScalar(dt);
    this.lastVel.copy(b.vel);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const l = new THREE.Matrix4(), s = new THREE.Vector3();
    for (const n of PART_NAMES) {
      const m = mats[n];
      if (!m) continue;
      const p = this.parts[n];
      l.multiplyMatrices(inv, m).decompose(p.position, p.quaternion, s);
      p.updateMatrix();
    }
    this.breath += dt;
    const sp = Math.hypot(b.vel.x, b.vel.z);
    this.gait.moving += ((sp > 0.08 ? Math.min(1, 0.35 + 0.65 * sp / 3.5) : 0) - this.gait.moving) * Math.min(1, dt * 6);
    this.climbBlend += ((b.climb ? 1 : 0) - this.climbBlend) * Math.min(1, dt * 7);
    b.landing = Math.max(0, b.landing - dt * 3.5);
    this.poseSecondary(ctx);
  }

  protected poseSecondary(_ctx: PoseContext) {}

  protected poseLegs(ctx: PoseContext) {
    const g = this.gait, p = g.p;
    const P = this.parts;
    // Lower the pelvis on slopes so the downhill leg can reach.
    const lf = new THREE.Vector3(), rf = new THREE.Vector3();
    this.toLocal(g.feet[0].cur, lf); this.toLocal(g.feet[1].cur, rf);
    const lowFoot = Math.min(lf.y - g.feet[0].lift, rf.y - g.feet[1].lift);
    const drop = Math.max(0, -lowFoot) * 0.9;
    this.pelvisDrop += (drop - this.pelvisDrop) * Math.min(1, ctx.dt * 10);
    const speed = Math.hypot(this.body.vel.x, this.body.vel.z);
    const crouch = this.crouchAmount(speed);
    this.breath += ctx.dt;
    const pelvisY = p.hipY + g.bob - this.pelvisDrop - crouch + Math.sin(this.breath * 1.3) * p.hipY * 0.004 - this.body.landing * p.hipY * 0.14;
    P.pelvis.position.set(g.sway * 0.6, pelvisY, 0);
    const fwdLean = THREE.MathUtils.clamp(speed / p.runSpeed, 0, 1);
    // Acceleration-driven lean in local space.
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const accF = s * this.accel.x + c * this.accel.z;
    const accS = c * this.accel.x - s * this.accel.z;
    this.lean += ((fwdLean * this.leanScale() + THREE.MathUtils.clamp(accF * 0.02, -0.12, 0.12)) - this.lean) * Math.min(1, ctx.dt * 5);
    this.leanSide += ((THREE.MathUtils.clamp(-accS * 0.012 - this.body.turnRate * speed * 0.02, -0.15, 0.15)) - this.leanSide) * Math.min(1, ctx.dt * 5);
    P.pelvis.rotation.set(this.lean * 0.3, Math.sin(g.phase * Math.PI * 2) * 0.12 * fwdLean, this.leanSide * 0.5 + g.sway * 1.5);
    P.pelvis.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const side = f.side;
      const thigh = side > 0 ? P.thighL : P.thighR, shin = side > 0 ? P.shinL : P.shinR, foot = side > 0 ? P.footL : P.footR;
      const hip = new THREE.Vector3(side * p.hipW, 0, 0).applyMatrix4(P.pelvis.matrix);
      const footL = this.toLocal(f.cur, new THREE.Vector3());
      const ankle = footL.clone(); ankle.y += p.ankleH;
      const knee = new THREE.Vector3();
      const pole = new THREE.Vector3(side * 0.08, 0, 1);
      const end = solveTwoBone(hip, ankle, p.l1, p.l2, pole, knee);
      orientBone(thigh, hip, knee, pole);
      orientBone(shin, knee, end, pole);
      foot.position.copy(end);
      // Foot follows yaw with a heel/toe pitch during swing.
      const yawLocal = 0;
      foot.rotation.set(-f.pitch, yawLocal, 0);
    }
  }

  protected crouchAmount(_speed: number) { return 0; }
  // Climbing characters place their feet on the face here (after the gait, before the legs are solved).
  protected climbFeet(_ctx: PoseContext) {}
  protected leanScale() { return 0.12; }

  protected abstract poseUpper(ctx: PoseContext): void;

  protected poseCarried(_ctx: PoseContext) {}

  protected solveArms() {
    const P = this.parts, d = this.dims;
    P.chest.updateMatrix();
    for (const side of [-1, 1]) {
      const arm = side > 0 ? this.armL : this.armR;
      const ua = side > 0 ? P.uarmL : P.uarmR, fa = side > 0 ? P.farmL : P.farmR, hand = side > 0 ? P.handL : P.handR;
      const sh = new THREE.Vector3(side * d.shoulderW, d.shoulderY, d.shoulderZ ?? 0).applyMatrix4(P.chest.matrix);
      const elbow = new THREE.Vector3();
      const end = solveTwoBone(sh, arm.target, d.upperArm, d.foreArm, arm.pole, elbow);
      orientBone(ua, sh, elbow, arm.pole);
      orientBone(fa, elbow, end, arm.pole);
      hand.position.copy(end);
      if (arm.useHandQ) hand.quaternion.copy(arm.handQ);
      else hand.quaternion.copy(fa.quaternion);
    }
  }

  abstract update(dt: number, ctx: PoseContext): void;
}
