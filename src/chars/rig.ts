// Procedural biped rig: rigid segments driven by two-bone IK, with planted feet and a velocity-matched
// gait so stride length and cadence follow actual travel speed (no foot sliding on flat ground).
import * as THREE from 'three/webgpu';

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

export function orientBone(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, pole: THREE.Vector3) {
  // Bone geometry points along -Y from its joint; local +Z faces the pole.
  _y.subVectors(from, to).normalize();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
}

export function solveTwoBone(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3) {
  const dir = new THREE.Vector3().subVectors(t, a);
  let d = dir.length();
  const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) + 1e-4;
  d = Math.min(maxD, Math.max(minD, d));
  dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
  p.normalize();
  outMid.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
  // Return the clamped end so segments never stretch.
  return new THREE.Vector3().copy(a).addScaledVector(dir, d);
}

export type GaitParams = {
  hipY: number; hipW: number; l1: number; l2: number; ankleH: number;
  walkStride: number; runStride: number; walkSpeed: number; runSpeed: number;
  swingWalk: number; swingRun: number; stepHeightWalk: number; stepHeightRun: number;
  bobWalk: number; bobRun: number; settleRate: number; footSide: number;
};

type Foot = {
  side: number; planted: THREE.Vector3; start: THREE.Vector3; target: THREE.Vector3; cur: THREE.Vector3;
  swinging: boolean; lift: number; pitch: number;
};

export class Gait {
  p: GaitParams;
  phase = 0;
  feet: Foot[];
  moving = 0; // 0 idle .. 1 run
  bob = 0; sway = 0; lean = 0;
  stepEvents: { side: number; strength: number }[] = [];
  constructor(p: GaitParams) {
    this.p = p;
    const mk = (side: number): Foot => ({ side, planted: new THREE.Vector3(), start: new THREE.Vector3(), target: new THREE.Vector3(), cur: new THREE.Vector3(), swinging: false, lift: 0, pitch: 0 });
    this.feet = [mk(-1), mk(1)];
  }

  restOffset(side: number, yaw: number, out: THREE.Vector3) {
    const s = this.p.footSide * side;
    return out.set(Math.cos(yaw) * s, 0, -Math.sin(yaw) * s);
  }

  reset(pos: THREE.Vector3, yaw: number, ground: (x: number, z: number) => number) {
    for (const f of this.feet) {
      this.restOffset(f.side, yaw, f.planted).add(pos);
      f.planted.y = ground(f.planted.x, f.planted.z);
      f.cur.copy(f.planted); f.swinging = false;
    }
  }

  update(dt: number, pos: THREE.Vector3, vel: THREE.Vector3, yaw: number, turnRate: number, ground: (x: number, z: number) => number) {
    const p = this.p;
    const v = Math.hypot(vel.x, vel.z);
    const runT = THREE.MathUtils.smoothstep(v, p.walkSpeed * 0.9, p.runSpeed);
    this.moving += ((v > 0.08 ? 0.35 + 0.65 * runT : 0) - this.moving) * Math.min(1, dt * 6);
    let stride = THREE.MathUtils.lerp(p.walkStride, p.runStride, runT);
    if (v < p.walkSpeed) stride *= 0.55 + 0.45 * (v / p.walkSpeed);
    const swingFrac = THREE.MathUtils.lerp(p.swingWalk, p.swingRun, runT);
    let rate = v / stride;
    // Settling steps when stopping: keep stepping until both feet rest under the body.
    const rest = new THREE.Vector3();
    let off = 0;
    for (const f of this.feet) {
      this.restOffset(f.side, yaw, rest).add(pos);
      off = Math.max(off, Math.hypot(f.planted.x - rest.x, f.planted.z - rest.z));
    }
    const anySwing = this.feet.some((f) => f.swinging);
    if (v < 0.12) {
      if (off > p.walkStride * 0.12 || anySwing) rate = Math.max(rate, p.settleRate);
      else rate = 0;
    }
    rate = Math.max(rate, v > 0.12 ? 0.6 : 0);
    const prevPhase = this.phase;
    this.phase = (this.phase + rate * dt) % 1;
    const cycleT = rate > 0 ? 1 / rate : 1;
    for (const f of this.feet) {
      const off2 = f.side < 0 ? 0 : 0.5;
      const lp = (this.phase + off2) % 1;
      const lpPrev = (prevPhase + off2) % 1;
      const inSwing = rate > 0 && lp < swingFrac;
      if (inSwing && !f.swinging) {
        f.swinging = true; f.start.copy(f.planted);
      }
      if (f.swinging) {
        const s = rate > 0 ? Math.min(1, lp / swingFrac) : 1;
        const remain = (1 - s) * swingFrac * cycleT;
        const stanceT = (1 - swingFrac) * cycleT;
        const lead = Math.min(remain + stanceT * 0.5, 0.6);
        const futureYaw = yaw + turnRate * remain;
        this.restOffset(f.side, futureYaw, f.target);
        f.target.x += pos.x + vel.x * lead;
        f.target.z += pos.z + vel.z * lead;
        f.target.y = ground(f.target.x, f.target.z);
        const e = s * s * (3 - 2 * s);
        f.cur.lerpVectors(f.start, f.target, e);
        const h = THREE.MathUtils.lerp(p.stepHeightWalk, p.stepHeightRun, runT) * Math.min(1, 0.4 + v / p.walkSpeed);
        f.lift = Math.sin(Math.PI * s) * h;
        f.cur.y += f.lift;
        f.pitch = Math.sin(Math.PI * s * 1.2 - 0.4) * 0.5 * Math.min(1, v / p.walkSpeed + 0.2);
        const ended = !inSwing || lp < lpPrev && lpPrev < swingFrac && false;
        if (ended || s >= 1) {
          f.swinging = false; f.planted.copy(f.target); f.cur.copy(f.target); f.lift = 0; f.pitch = 0;
          this.stepEvents.push({ side: f.side, strength: 0.3 + 0.7 * Math.min(1, v / p.runSpeed) });
        }
      } else {
        f.planted.y = ground(f.planted.x, f.planted.z);
        f.cur.copy(f.planted); f.lift = 0; f.pitch *= 0.8;
      }
    }
    // Body motion: two bobs per cycle, lateral weight transfer once per cycle.
    const bobAmp = THREE.MathUtils.lerp(p.bobWalk, p.bobRun, runT) * Math.min(1, v / p.walkSpeed);
    this.bob = -Math.abs(Math.cos(this.phase * Math.PI * 2)) * bobAmp + bobAmp * 0.5;
    this.sway = Math.sin(this.phase * Math.PI * 2) * bobAmp * 0.6;
  }
}

export function makePart(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
