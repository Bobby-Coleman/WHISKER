// PlayerController routes input to the active character; CompanionController drives the other one.
// Both use the same shared run speed; acceleration, braking and turning differ per character.
import * as THREE from 'three/webgpu';
import { Character } from '../chars/character';
import { GAME } from '../render/settings';
import { PhysicsWorld, MASK } from './physics';
import { InputFrame } from './input';
import { regionOf, nextWaypoint, NavState } from './nav';

export const PROFILES = {
  // Both respond at once; the knight carries a little more momentum through stops and turns, the kitten less.
  knight: { accel: 11, decel: 14, turn: 10, turnAtRun: 7.5 },
  kitten: { accel: 15, decel: 20, turn: 14, turnAtRun: 11 },
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function drive(c: Character, dir: THREE.Vector2, speed: number, dt: number) {
  const b = c.body, pr = PROFILES[c.kind];
  const cur = Math.hypot(b.vel.x, b.vel.z);
  let yawRate = 0;
  if (speed > 0.02 && dir.lengthSq() > 1e-6) {
    const target = Math.atan2(dir.x, dir.y);
    const diff = wrap(target - b.yaw);
    const turn = THREE.MathUtils.lerp(pr.turn, pr.turnAtRun, Math.min(1, cur / GAME.runSpeed));
    const stepA = THREE.MathUtils.clamp(diff, -turn * dt, turn * dt);
    b.yaw = wrap(b.yaw + stepA);
    yawRate = stepA / dt;
    // Move mostly along the facing: large direction changes slow the body instead of sliding it sideways.
    const align = Math.max(0, Math.cos(diff));
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const tx = (fx * 0.75 + dir.x * 0.25) * speed * (0.25 + 0.75 * align), tz = (fz * 0.75 + dir.y * 0.25) * speed * (0.25 + 0.75 * align);
    const dvx = tx - b.vel.x, dvz = tz - b.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const rate = (Math.hypot(tx, tz) >= cur ? pr.accel : pr.decel) * dt;
    if (dl > rate) { b.vel.x += (dvx / dl) * rate; b.vel.z += (dvz / dl) * rate; } else { b.vel.x = tx; b.vel.z = tz; }
  } else {
    const rate = pr.decel * dt;
    if (cur > rate) { b.vel.x -= (b.vel.x / cur) * rate; b.vel.z -= (b.vel.z / cur) * rate; } else { b.vel.x = 0; b.vel.z = 0; }
  }
  b.turnRate += (yawRate - b.turnRate) * Math.min(1, dt * 12);
}

export class PlayerController {
  update(c: Character, input: InputFrame, camYaw: number, dt: number, enabled: boolean) {
    if (!enabled) { drive(c, new THREE.Vector2(), 0, dt); return; }
    const m = input.move;
    // Camera-relative: forward is where the camera looks.
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    const dir = new THREE.Vector2(fx * m.y + rx * m.x, fz * m.y + rz * m.x);
    const mag = Math.min(1, m.length());
    if (mag > 0) dir.normalize();
    const speed = (input.walk ? GAME.walkSpeed : GAME.runSpeed) * mag;
    drive(c, dir, speed, dt);
    // Jump: the knight a heavy half-metre, the kitten a quick hop of about the same, light on its feet.
    if (input.jumpPressed && c.body.grounded && !c.carriedBy) c.body.vy = c.kind === 'knight' ? 3.4 : 3.2;
  }
}

export class CompanionController {
  mode: 'follow' | 'wait' = 'follow';
  private moving = false;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private lastCheck = 0;
  private sidePref = 0;
  private sideT = 0;
  private detour: THREE.Vector3 | null = null;
  private detourT = 0;
  recoveries = 0;
  status = '';

  update(c: Character, leader: Character, physics: PhysicsWorld, nav: NavState, dt: number, time: number, isVisible: (p: THREE.Vector3) => boolean) {
    const b = c.body;
    if (this.mode === 'wait' || c.carriedBy) { drive(c, new THREE.Vector2(), 0, dt); this.moving = false; this.status = 'waiting'; return; }
    const gap = GAME.followGap[leader.kind === 'knight' ? 'kitten' : 'knight'];
    const myRegion = regionOf(b.pos), leadRegion = regionOf(leader.body.pos);
    let goal = leader.body.pos.clone();
    let finalLeg = true;
    if (myRegion !== leadRegion) {
      const wp = nextWaypoint(c.kind, myRegion, leadRegion, nav, b.pos);
      if (wp) { goal = wp; finalLeg = false; } else {
        // No route for this character (e.g. through a culvert): wait where it can see the leader.
        drive(c, new THREE.Vector2(), 0, dt);
        this.moving = false; this.status = 'no route';
        return;
      }
    }
    if (this.detour) {
      goal = this.detour; finalLeg = false;
      this.detourT -= dt;
      if (this.detourT < 0 || Math.hypot(b.pos.x - goal.x, b.pos.z - goal.z) < 0.4) this.detour = null;
    }
    const dx = goal.x - b.pos.x, dz = goal.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    const stopAt = finalLeg ? gap : 0.25;
    if (finalLeg) {
      if (this.moving && dist < stopAt + GAME.arriveTolerance) this.moving = false;
      else if (!this.moving && dist > stopAt + GAME.arriveTolerance + 0.55) this.moving = true;
    } else this.moving = dist > 0.2;
    if (!this.moving) { drive(c, new THREE.Vector2(), 0, dt); this.stuckT = 0; this.status = 'idle'; return; }
    // Speed: match the leader's travel; bounded catch-up when well behind.
    const leadSpeed = Math.hypot(leader.body.vel.x, leader.body.vel.z);
    const behind = dist - stopAt;
    let speed = behind > 1.2 ? GAME.runSpeed : THREE.MathUtils.lerp(GAME.walkSpeed * 0.7, GAME.runSpeed, THREE.MathUtils.clamp(behind / 1.2, 0, 1));
    if (finalLeg && leadSpeed > 0.3) speed = Math.max(Math.min(speed, leadSpeed + behind * 0.8), Math.min(leadSpeed, GAME.runSpeed));
    if (behind > 5) speed = GAME.runSpeed * THREE.MathUtils.lerp(1, GAME.catchUpMax, THREE.MathUtils.clamp((behind - 5) / 6, 0, 1));
    // Obstacle steering: probe ahead and pick the nearest free heading.
    const mask = c.kind === 'knight' ? MASK.knight : MASK.kitten;
    const desired = Math.atan2(dx, dz);
    const look = Math.min(dist, c.kind === 'knight' ? 1.6 : 0.8);
    const free = (a: number) => {
      const ex = b.pos.x + Math.sin(a) * look, ez = b.pos.z + Math.cos(a) * look;
      if (physics.segmentBlocked(b.pos.x, b.pos.z, ex, ez, b.radius * 0.9, b.pos.y + 0.1, b.pos.y + b.height, mask)) return false;
      // Never walk off a drop (window sill, upper floor).
      const g = physics.groundAt(ex, ez, b.pos.y, 0.3);
      return g > b.pos.y - 0.6;
    };
    let heading = desired;
    if (!free(desired)) {
      this.sideT -= dt;
      if (this.sideT <= 0) { this.sidePref = 0; }
      let found = false;
      for (let k = 1; k <= 8 && !found; k++) {
        const order = this.sidePref ? [this.sidePref] : [1, -1];
        for (const s of order) {
          const a = desired + s * k * 0.26;
          if (free(a)) { heading = a; this.sidePref = s; this.sideT = 1.2; found = true; break; }
        }
      }
    }
    drive(c, new THREE.Vector2(Math.sin(heading), Math.cos(heading)), speed, dt);
    // Stuck detection and recovery.
    if (time - this.lastCheck > 1.0) {
      const moved = this.lastPos.distanceTo(b.pos);
      if (moved < 0.25 * (c.kind === 'knight' ? 1 : 0.5)) this.stuckT += time - this.lastCheck; else this.stuckT = Math.max(0, this.stuckT - 1);
      this.lastPos.copy(b.pos); this.lastCheck = time;
    }
    this.status = 'following';
    if (this.stuckT > 2.5 && !this.detour) {
      // Try a sideways detour around whatever is in the way.
      const side = Math.random() < 0.5 ? 1 : -1;
      const a = desired + side * 1.3;
      this.detour = new THREE.Vector3(b.pos.x + Math.sin(a) * 3, 0, b.pos.z + Math.cos(a) * 3);
      this.detourT = 2.5;
      this.status = 'detour';
    }
    if (this.stuckT > 9 && myRegion === leadRegion) {
      // Unobtrusive recovery: only when off-screen, to a free spot behind the leader in the same region.
      for (let i = 0; i < 12; i++) {
        const a = leader.body.yaw + Math.PI + (Math.random() - 0.5) * 1.6;
        const r = gap + 1 + Math.random() * 2;
        const p = new THREE.Vector3(leader.body.pos.x + Math.sin(a) * r, 0, leader.body.pos.z + Math.cos(a) * r);
        p.y = physics.groundAt(p.x, p.z, leader.body.pos.y + 0.5);
        const o = { x: 0, z: 0 };
        const blocked = physics.resolve(p.x, p.z, b.radius, p.y + 0.1, p.y + b.height, mask, o);
        if (!blocked && regionOf(p) === leadRegion && !isVisible(b.pos) && !isVisible(p)) {
          b.pos.copy(p); b.prevPos.copy(p); b.vel.set(0, 0, 0);
          c.resetPose(physics.groundAt.bind(physics) as any);
          this.stuckT = 0; this.recoveries++; this.status = 'recovered';
          break;
        }
      }
    }
  }
}
