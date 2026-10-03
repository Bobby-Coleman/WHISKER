// +X is the character's left when facing +Z; parts named L/R follow that.
// Shared character body + procedural biped presentation. Gameplay owns `body`; visuals read it.
import * as THREE from 'three/webgpu';
import { Gait, GaitParams, orientBone, solveTwoBone } from './rig';

export type Kind = 'kitten' | 'knight';

export class CharacterBody {
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; prevYaw = 0; turnRate = 0;
  radius: number; height: number;
  grounded = true; vy = 0;
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
  dims: { upperArm: number; foreArm: number; shoulderW: number; shoulderY: number; spine: number; neck: number };
  breath = 0;
  lean = 0; leanSide = 0;
  pelvisDrop = 0;
  accel = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  carriedBy: Character | null = null;
  holding: Character | null = null;
  override: ((c: Character, ctx: PoseContext) => void) | null = null;

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
    this.gait.update(dt, this.renderPos, b.vel, this.renderYaw, b.turnRate, ctx.ground);
    this.poseLegs(ctx);
    this.poseUpper(ctx);
    this.solveArms();
  }

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
    const pelvisY = p.hipY + g.bob - this.pelvisDrop - crouch + Math.sin(this.breath * 1.3) * p.hipY * 0.004;
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
  protected leanScale() { return 0.12; }

  protected abstract poseUpper(ctx: PoseContext): void;

  protected poseCarried(_ctx: PoseContext) {}

  protected solveArms() {
    const P = this.parts, d = this.dims;
    P.chest.updateMatrix();
    for (const side of [-1, 1]) {
      const arm = side > 0 ? this.armL : this.armR;
      const ua = side > 0 ? P.uarmL : P.uarmR, fa = side > 0 ? P.farmL : P.farmR, hand = side > 0 ? P.handL : P.handR;
      const sh = new THREE.Vector3(side * d.shoulderW, d.shoulderY, 0).applyMatrix4(P.chest.matrix);
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
