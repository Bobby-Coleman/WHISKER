// The kitten's climbing (engine v2): any collider marked `climb` (ivy on stone, rough timber, a rope net, in the
// prologue the knight's own plate). She takes hold by running or jumping into it. The stick climbs up, down and along
// the face, and each step finds the face again with a ray, so she follows it round bulges and corners. At the top she
// pulls herself up onto the ledge; a jump pushes her off. While she climbs the motor is held and this places her;
// the pose (chars/kitten.ts) reads `body.climb` and sheathes her sword.
import * as THREE from 'three';
import { Physics, SOLID, DOWN } from './physics';
import { Motor } from './motor';
// How far her chest stays off the face.
export const CLIMB_DIST = 0.075;

export const CLIMB = {
  up: 1.25, side: 0.95, // m/s on the face
  reach: 0.14, // how far beyond her radius a face can be taken hold of
  chest: 0.55, // where on her height the face is probed
  push: 2.4, pushUp: 5.2, // push-off velocity
};

const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(), _side = new THREE.Vector3(), _cand = new THREE.Vector3();

export class Climber {
  normal = new THREE.Vector3(0, 0, 1); // the face's outward normal where she holds it
  target = new THREE.Vector3(); // where her feet belong on the face; she eases onto it
  exit: null | { t: number; dur: number; from: THREE.Vector3; top: THREE.Vector3; to: THREE.Vector3; yaw: number } = null;
  private cooldown = 0;
  onGrab?: () => void;

  constructor(public motor: Motor, public physics: Physics) {}

  get active() { return this.motor.body.climb !== null; }

  private chestY() { return this.motor.build.height * CLIMB.chest; }
  private flatNormal(out: THREE.Vector3) {
    out.set(this.normal.x, 0, this.normal.z);
    return out.lengthSq() > 1e-6 ? out.normalize() : out.set(0, 0, 1);
  }

  tick(dt: number) { this.cooldown = Math.max(0, this.cooldown - dt); }

  // Takes hold of a climbable face she is moving into (dirX, dirZ: the stick's world direction, unit length).
  tryGrab(dirX: number, dirZ: number) {
    const m = this.motor, b = m.body;
    if (b.climb || m.mode !== 'move' || this.cooldown > 0) return false;
    const o = _a.set(b.pos.x, b.pos.y + this.chestY(), b.pos.z);
    const h = this.physics.raycast(o, _d.set(dirX, 0, dirZ), m.build.radius + CLIMB.reach, SOLID);
    if (!h || !h.surface?.climb || Math.abs(h.normal.y) > 0.6) return false;
    const nl = Math.hypot(h.normal.x, h.normal.z) || 1;
    if ((dirX * -h.normal.x + dirZ * -h.normal.z) / nl < 0.55) return false;
    m.mode = 'held';
    this.normal.copy(h.normal);
    const n = this.flatNormal(_d);
    this.target.set(h.point.x + n.x * CLIMB_DIST, h.point.y - this.chestY(), h.point.z + n.z * CLIMB_DIST);
    const gy = this.physics.groundY(this.target.x, this.target.y + 0.15, this.target.z, 0.4);
    if (gy !== null && this.target.y < gy) this.target.y = gy;
    b.climb = { u: 0, v: this.target.y, phase: 0, speed: 0, exit: null };
    b.vel.set(0, 0, 0); b.vy = 0; b.grounded = false;
    m.vel.set(0, 0, 0);
    this.exit = null;
    this.onGrab?.();
    return true;
  }

  // One fixed step on the face. move: the stick (x right, y up); camYaw turns sideways input so that pushing right
  // moves her right on screen.
  step(dt: number, move: THREE.Vector2, jump: boolean, camYaw: number) {
    const m = this.motor, b = m.body, cl = b.climb!;
    b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
    b.vel.set(0, 0, 0); b.vy = 0; b.turnRate = 0;
    const n = this.flatNormal(new THREE.Vector3());
    // Pulling up over the top: up to the edge, then over it in a little arc.
    if (this.exit) {
      const e = this.exit;
      e.t += dt;
      const a = Math.min(1, e.t / e.dur);
      if (a < 0.55) {
        const s = a / 0.55, es = s * s * (3 - 2 * s);
        b.pos.lerpVectors(e.from, e.top, es);
      } else {
        const s = (a - 0.55) / 0.45;
        b.pos.lerpVectors(e.top, e.to, s * (2 - s));
        b.pos.y = THREE.MathUtils.lerp(e.top.y, e.to.y, s) + Math.sin(Math.PI * s) * 0.03;
      }
      cl.phase += dt * 9; cl.speed = 0.6;
      m.syncCollider();
      if (a >= 1) { b.climb = null; this.exit = null; this.cooldown = 0.3; m.place(e.to, e.yaw); }
      return;
    }
    b.yaw = Math.atan2(-n.x, -n.z);
    if (jump) { this.pushOff(n); return; }
    // The face's own up and sideways directions.
    _up.set(0, 1, 0).addScaledVector(this.normal, -this.normal.y).normalize();
    _side.crossVectors(_up, this.normal).normalize();
    const sign = Math.cos(camYaw) * _side.x - Math.sin(camYaw) * _side.z >= 0 ? 1 : -1;
    const su = THREE.MathUtils.clamp(move.x, -1, 1) * sign * CLIMB.side * dt;
    const uu = THREE.MathUtils.clamp(move.y, -1, 1) * CLIMB.up * dt;
    const before = _a.copy(this.target);
    if (Math.abs(su) + Math.abs(uu) > 1e-6) {
      _cand.copy(this.target).addScaledVector(_side, su).addScaledVector(_up, uu);
      // Find the face again opposite her chest at the new spot.
      const from = new THREE.Vector3(_cand.x + n.x * 0.3, _cand.y + this.chestY(), _cand.z + n.z * 0.3);
      const h = this.physics.raycast(from, _d.set(-n.x, 0, -n.z), 0.3 + CLIMB_DIST + 0.25, SOLID);
      if (h && h.surface?.climb && Math.abs(h.normal.y) < 0.75) {
        this.normal.copy(h.normal);
        const n2 = this.flatNormal(_d);
        this.target.set(h.point.x + n2.x * CLIMB_DIST, h.point.y - this.chestY(), h.point.z + n2.z * CLIMB_DIST);
      } else if (uu > 0 && (!h || h.dist > 0.3 + CLIMB_DIST + 0.1)) {
        // Nothing above: the top. Up onto the ledge if there is room, otherwise she holds where she is.
        if (this.tryMantle(n)) return;
      }
    }
    // The ground below the face: pushing down there, she steps off.
    const gy = this.physics.groundY(this.target.x, this.target.y + 0.12, this.target.z, 0.3);
    if (gy !== null && this.target.y <= gy + 0.004) {
      this.target.y = gy;
      if (move.y < -0.3) { this.stepOff(n, gy); return; }
    }
    // Ease onto the face from wherever she took hold.
    b.pos.lerp(this.target, Math.min(1, dt * 14));
    const moved = before.distanceTo(this.target);
    cl.speed = moved / dt;
    cl.phase += moved * 26; // one reach-and-pull for every few centimetres climbed
    cl.v = b.pos.y;
    m.syncCollider();
  }

  // Up and over the top edge onto whatever is there, if her body fits.
  private tryMantle(n: THREE.Vector3) {
    const m = this.motor, b = m.body, B = m.build;
    const over = new THREE.Vector3(b.pos.x - n.x * (CLIMB_DIST + B.radius + 0.08), b.pos.y + B.height * 1.15 + 0.12, b.pos.z - n.z * (CLIMB_DIST + B.radius + 0.08));
    const h = this.physics.raycast(over, DOWN, B.height * 1.15 + 0.3, SOLID);
    if (!h || h.normal.y < 0.7 || h.point.y < b.pos.y + B.height * 0.25) return false;
    const to = h.point.clone();
    // Room for her capsule there?
    const r = B.radius * 0.95;
    if (this.physics.overlaps(new THREE.Vector3(to.x, to.y + B.radius + 0.02, to.z), r) || this.physics.overlaps(new THREE.Vector3(to.x, to.y + B.height - B.radius, to.z), r)) return false;
    const top = new THREE.Vector3(b.pos.x - n.x * 0.02, to.y + 0.04, b.pos.z - n.z * 0.02);
    this.exit = { t: 0, dur: 0.5, from: b.pos.clone(), top, to, yaw: Math.atan2(-n.x, -n.z) };
    // The pose reads the pull-up from the body.
    if (b.climb) b.climb.exit = this.exit;
    return true;
  }

  // A jump on the face: off it backwards and up.
  private pushOff(n: THREE.Vector3) {
    const m = this.motor, b = m.body, B = m.build;
    b.climb = null; this.exit = null; this.cooldown = 0.35;
    const p = b.pos.clone().addScaledVector(n, B.radius + B.skin + 0.02 - CLIMB_DIST);
    m.place(p, Math.atan2(n.x, n.z));
    m.launch(new THREE.Vector3(n.x * CLIMB.push, CLIMB.pushUp, n.z * CLIMB.push), true);
  }

  // Down at the foot of the face: back on the ground.
  private stepOff(n: THREE.Vector3, gy: number) {
    const m = this.motor, b = m.body, B = m.build;
    b.climb = null; this.exit = null; this.cooldown = 0.35;
    const p = b.pos.clone().addScaledVector(n, B.radius + B.skin + 0.02 - CLIMB_DIST);
    p.y = gy;
    m.place(p, Math.atan2(n.x, n.z));
  }

  // Let go at once (a switch of character never does this; a cutscene or a respawn does).
  drop() {
    const b = this.motor.body;
    if (!b.climb) return;
    b.climb = null; this.exit = null;
    this.motor.mode = 'move';
  }
}
