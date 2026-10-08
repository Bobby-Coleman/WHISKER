// The knight's lift (engine v2): beside the kitten he picks her up in both hands and carries her; a second press
// throws her high and forward, onto ledges no jump reaches, and play passes to her in the air (single player);
// Q sets her down in front of him. She rides in his hands with her motor held; he cannot jump while carrying her.
import * as THREE from 'three';
import { Physics, SOLID } from './physics';
import { Motor, MOVE } from './motor';
import { WIND } from './body';
import type { Avatar } from './game';

// From his hands she rises some 2 m. A designated gust-assisted crossing can extend the short throw.
export const THROW = { forward: 2.6, up: 7.5, reach: 1.15 };

export class Carry {
  holding = false;
  // Where lifting is allowed at all (a level can forbid it, as on the windy ridge).
  allow: () => boolean = () => true;
  private hold = new THREE.Vector3();

  constructor(public physics: Physics, public knight: { char: Avatar; motor: Motor }, public kitten: { char: Avatar; motor: Motor }) {
    knight.motor.canJump = () => !this.holding;
  }

  // Close enough, in front of him, and both on their feet (not while she climbs or is already airborne).
  canLift() {
    const n = this.knight, k = this.kitten;
    if (this.holding || !this.allow() || n.motor.mode !== 'move' || k.motor.mode !== 'move' || !n.motor.grounded || !k.motor.grounded) return false;
    const dx = k.char.body.pos.x - n.char.body.pos.x, dz = k.char.body.pos.z - n.char.body.pos.z, d = Math.hypot(dx, dz);
    if (d > THROW.reach || Math.abs(k.char.body.pos.y - n.char.body.pos.y) > 0.5) return false;
    const fwd = (Math.sin(n.char.body.yaw) * dx + Math.cos(n.char.body.yaw) * dz) / (d || 1);
    return d < 0.45 || fwd > 0.2;
  }

  lift() {
    const n = this.knight, k = this.kitten;
    this.holding = true;
    k.motor.mode = 'held';
    k.char.carriedBy = n.char; n.char.holding = k.char;
    k.char.body.climb = null;
    // He turns to face her as he bends for her.
    const dx = k.char.body.pos.x - n.char.body.pos.x, dz = k.char.body.pos.z - n.char.body.pos.z;
    if (Math.hypot(dx, dz) > 0.05) n.char.body.yaw = Math.atan2(dx, dz);
  }

  // Each fixed step while held: she rides in his hands.
  step() {
    if (!this.holding) return;
    const n = this.knight, k = this.kitten, b = k.char.body;
    b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
    if (n.char.holdPoint) n.char.holdPoint(this.hold);
    else this.hold.copy(n.char.body.pos).add(new THREE.Vector3(0, n.motor.build.height * 0.6, 0));
    b.pos.copy(this.hold);
    b.yaw = n.char.body.yaw;
    b.vel.set(0, 0, 0); b.vy = 0; b.grounded = false;
    k.motor.syncCollider();
  }

  private release() {
    const n = this.knight, k = this.kitten;
    this.holding = false;
    k.char.carriedBy = null; n.char.holding = null;
  }

  // The same release point feeds the actual throw and its optional aiming ribbon. Predicting uses a small
  // fixed buffer and the motor's gravity/drag, so it costs nothing when she is not being carried.
  private throwStart() {
    const n = this.knight, k = this.kitten, start = this.hold.clone(), B = k.motor.build;
    const mid = start.clone(); mid.y += B.height / 2;
    if (this.physics.overlaps(mid, B.radius, SOLID)) { start.copy(n.char.body.pos); start.y += n.motor.build.height + 0.05; }
    const fwd = new THREE.Vector3(Math.sin(n.char.body.yaw), 0, Math.cos(n.char.body.yaw));
    if (this.physics.raycast(mid, fwd, 0.95, SOLID)) { start.copy(n.char.body.pos).addScaledVector(fwd, 0.1); start.y += n.motor.build.height + 0.05; }
    return start;
  }

  predict(out: Float32Array, windSpeed = WIND.push) {
    if (!this.holding) return 0;
    const p = this.throwStart(), yaw = this.knight.char.body.yaw;
    let vx = Math.sin(yaw) * THROW.forward, vz = Math.cos(yaw) * THROW.forward, vy = THROW.up;
    let wx = 0, wz = 0;
    const dt = 0.045, count = Math.floor(out.length / 3), prev = p.clone(), delta = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      out[i * 3] = p.x; out[i * 3 + 1] = p.y + this.kitten.motor.build.height * 0.5; out[i * 3 + 2] = p.z;
      prev.copy(p);
      vx *= 1 - MOVE.airDrag * dt; vz *= 1 - MOVE.airDrag * dt;
      vy -= (vy > 0 ? MOVE.gUp : MOVE.gDown) * dt;
      const open = windSpeed > 0.05 && !WIND.sheltered(p), f = dt * (open ? 3.5 : 6);
      wx += ((open ? WIND.dir.x * windSpeed : 0) - wx) * f;
      wz += ((open ? WIND.dir.y * windSpeed : 0) - wz) * f;
      p.x += (vx + wx) * dt; p.y += vy * dt; p.z += (vz + wz) * dt;
      const origin = prev.clone(); origin.y += this.kitten.motor.build.height * 0.5;
      delta.subVectors(p, prev); const distance = delta.length();
      const hit = distance > 0 ? this.physics.raycast(origin, delta.multiplyScalar(1 / distance), distance, SOLID) : null;
      if (hit) {
        const j = Math.min(count - 1, i + 1);
        out[j * 3] = hit.point.x; out[j * 3 + 1] = hit.point.y; out[j * 3 + 2] = hit.point.z;
        return j + 1;
      }
    }
    return count;
  }

  // Up and forward in an arc. She starts at his hands (or above his shoulders if a wall is in the way of them).
  throw() {
    if (!this.holding) return;
    const n = this.knight, k = this.kitten, kb = k.char.body;
    this.release();
    const start = this.throwStart();
    const yaw = n.char.body.yaw;
    // Close up to a wall he heaves her from over his head, so she clears it instead of hitting its face.
    k.motor.place(start, yaw);
    kb.prevPos.copy(kb.pos);
    k.motor.launch(new THREE.Vector3(Math.sin(yaw) * THROW.forward, THROW.up, Math.cos(yaw) * THROW.forward));
    k.motor.thrown = true;
    // Clear of his capsule before she can collide with it.
    k.motor.passThrough(n.motor.collider, 0.45);
  }

  // Set down gently in front of him, or at his feet if there is no room in front.
  putDown() {
    if (!this.holding) return;
    const n = this.knight, k = this.kitten;
    this.release();
    const yaw = n.char.body.yaw, p = n.char.body.pos;
    const front = new THREE.Vector3(p.x + Math.sin(yaw) * 0.55, p.y + 0.5, p.z + Math.cos(yaw) * 0.55);
    let gy = this.physics.groundY(front.x, front.y, front.z, 1.2);
    const blocked = this.physics.overlaps(new THREE.Vector3(front.x, (gy ?? p.y) + k.motor.build.height / 2 + 0.02, front.z), k.motor.build.radius, SOLID);
    if (gy === null || blocked) { front.set(p.x, p.y + 0.3, p.z); gy = p.y; }
    k.motor.place(new THREE.Vector3(front.x, gy, front.z), yaw);
    k.motor.passThrough(n.motor.collider, 0.6);
  }

  // Dropped at once (a respawn or a cutscene).
  cancel() {
    if (!this.holding) return;
    this.release();
    this.kitten.motor.mode = 'move';
  }
}
