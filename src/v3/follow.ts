// The companion (engine v2): the character not being played follows the one who is, along the trail the leader left
// (footsteps every quarter metre, with the places they jumped), so it goes where the player went instead of
// straight into a wall. It keeps a little way back, jumps where the leader jumped (or up onto a step too high to
// walk), stops where it cannot go (the knight at the foot of a wall she climbed), waits when told to, and if it
// falls far behind or gets stuck while out of sight it catches up unseen.
import * as THREE from 'three';
import type { Actor } from './game';
import type { MotorInput } from './motor';
import { SOLID, DOWN } from './physics';

type Crumb = { p: THREE.Vector3; jump: boolean; climb: boolean };

const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export class Follower {
  mode: 'follow' | 'wait' = 'follow';
  // Ground this one must not follow onto (the knight: water over his head). It stops at the edge instead.
  unsafe?: (me: Actor, p: THREE.Vector3) => boolean;
  private trail: Crumb[] = [];
  private last = new THREE.Vector3(Infinity, 0, 0);
  private input: MotorInput = { wish: new THREE.Vector2(), walk: false, jumpHeld: false };
  private jumpT = 0;
  private stuckT = 0;
  private best = Infinity;
  private nextGround = new THREE.Vector3();
  private probe = new THREE.Vector3();
  private sideDirection = new THREE.Vector3();

  // A thin Rapier ray can miss a heightfield triangle seam even while the character is grounded. Use
  // its actual foot width as a fallback, with an upward normal, rather than declaring a hole in the trail.
  private support(me: Actor, x: number, y: number, z: number) {
    const B = me.motor.build;
    const floor = me.motor.physics.groundY(x, y + B.step + 0.1, z, B.step + 0.7, SOLID);
    if (floor !== null) return floor;
    const radius = B.radius * 0.7;
    this.probe.set(x, y + B.step + radius + 0.1, z);
    const hit = me.motor.physics.sphereCast(this.probe, DOWN, radius, B.step + 0.7 + radius, SOLID);
    return hit && hit.normal.y > 0.65 ? hit.point.y : null;
  }

  // Each fixed step: where the leader is, and whether it just jumped.
  record(leader: Actor, jumped: boolean) {
    const b = leader.char.body;
    if (leader.char.carriedBy || leader.motor.mode !== 'move' && !b.climb) return;
    // A throw is an ability for the kitten, not a walkable route for the knight to copy.
    if (!b.grounded && !b.climb && !leader.motor.jumping && !leader.motor.swimming) return;
    if (jumped && this.trail.length) this.trail[this.trail.length - 1].jump = true;
    if (jumped || this.last.distanceTo(b.pos) > 0.25) {
      this.trail.push({ p: b.pos.clone(), jump: jumped, climb: !!b.climb });
      this.last.copy(b.pos);
      if (this.trail.length > 160) this.trail.shift();
    }
  }

  clear() { this.trail.length = 0; this.last.set(Infinity, 0, 0); this.stuckT = 0; this.best = Infinity; }

  // The follower's input for this step, or null to stand still.
  step(dt: number, me: Actor, leader: Actor, unseen: (p: THREE.Vector3) => boolean, leaderWish?: THREE.Vector2): MotorInput | null {
    this.jumpT = Math.max(0, this.jumpT - dt);
    if (this.mode === 'wait' || me.motor.mode !== 'move') return null;
    const mp = me.char.body.pos, lp = leader.char.body.pos;
    const knight = me.motor.build.kind === 'knight';
    const gap = knight ? 1.7 : 1.1;
    const dLeader = flat(mp, lp);
    // After a switch she often starts behind him. His solid capsule must not trap her there while his
    // following distance tells him to stand still. Step aside on supported ground when she walks toward him.
    const wl = leaderWish?.length() ?? 0;
    if (knight && wl > 0.1 && dLeader < 2 && Math.abs(lp.y - mp.y) < 0.5) {
      const wx = leaderWish!.x / wl, wz = leaderWish!.y / wl;
      const along = (mp.x - lp.x) * wx + (mp.z - lp.z) * wz;
      const across = (mp.x - lp.x) * wz - (mp.z - lp.z) * wx;
      if (along > 0.05 && Math.abs(across) < 0.65) {
        const preferred = across >= 0 ? 1 : -1;
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? preferred : -preferred;
          const sx = wz * side, sz = -wx * side;
          const floor = this.support(me, mp.x + sx * 0.45, mp.y, mp.z + sz * 0.45);
          if (floor === null || floor < mp.y - 0.5) continue;
          this.nextGround.set(mp.x + sx * 0.45, floor, mp.z + sz * 0.45);
          if (this.unsafe?.(me, this.nextGround)) continue;
          const origin = this.nextGround.set(mp.x, mp.y + me.motor.build.height * 0.5, mp.z);
          if (me.motor.physics.raycast(origin, this.sideDirection.set(sx, 0, sz), 0.5, SOLID)) continue;
          this.input.wish.set(sx, sz); this.input.walk = true; this.input.jumpHeld = false;
          return this.input;
        }
      }
    }
    // Crumbs it has reached, and any behind the nearest one.
    let near = -1, nd = Infinity;
    for (let i = 0; i < this.trail.length; i++) {
      const d = flat(this.trail[i].p, mp) + Math.abs(this.trail[i].p.y - mp.y) * 0.5;
      if (d < nd) { nd = d; near = i; }
    }
    if (near > 0 && nd < 1.2) this.trail.splice(0, near);
    while (this.trail.length && flat(this.trail[0].p, mp) < 0.3 && Math.abs(this.trail[0].p.y - mp.y) < 0.4) {
      if (this.trail[0].jump && me.motor.grounded) { me.motor.queueJump(); this.jumpT = 0.35; }
      this.trail.shift();
    }
    // Close by: stand.
    if (dLeader < gap && Math.abs(lp.y - mp.y) < 0.8) { this.stuckT = 0; this.best = Infinity; return null; }
    // Far behind, or no way forward, and nobody watching: catch up to a point on the trail a little behind the leader.
    const target = this.trail[0];
    const blocked = !target || (target.climb && knight) || !!this.unsafe?.(me, target.p);
    if (dLeader < this.best - 0.1) { this.best = dLeader; this.stuckT = 0; } else this.stuckT += dt;
    if ((dLeader > 14 || this.stuckT > 3) && leader.motor.grounded && unseen(mp)) {
      for (let i = this.trail.length - 1; i >= 0; i--) {
        const c = this.trail[i];
        if (!c.climb && !c.jump && !this.unsafe?.(me, c.p) && Math.abs(c.p.y - mp.y) < 0.65 && flat(c.p, lp) > gap * 0.8 && unseen(c.p)) {
          const origin = mp.clone(); origin.y += me.motor.build.height * 0.5;
          const delta = c.p.clone().sub(mp), distance = delta.length();
          if (distance > 0.01 && me.motor.physics.raycast(origin, delta.multiplyScalar(1 / distance), distance, SOLID)) continue;
          // A destination may be dry even though a moat or cleft lies between it and the companion. Verify
          // the whole short catch-up route; otherwise invisible teleporting could solve a closed bridge.
          let routeSafe = true;
          const samples = Math.ceil(distance / 0.55), sample = new THREE.Vector3();
          for (let j = 1; j <= samples; j++) {
            sample.lerpVectors(mp, c.p, j / samples);
            const floor = this.support(me, sample.x, sample.y, sample.z);
            if (floor === null || Math.abs(floor - sample.y) > 0.55 || this.unsafe?.(me, sample)) { routeSafe = false; break; }
          }
          if (!routeSafe) continue;
          me.motor.place(c.p.clone(), Math.atan2(lp.x - c.p.x, lp.z - c.p.z));
          me.char.resetPose(me.ground);
          this.trail.splice(0, i + 1);
          this.stuckT = 0; this.best = Infinity;
          return null;
        }
      }
    }
    if (blocked) return null;
    const dx = target.p.x - mp.x, dz = target.p.z - mp.z, d = Math.hypot(dx, dz) || 1;
    // Do not walk off a bank toward a thrown/climbing leader. Check the next step, with enough room to
    // brake before the edge. A recorded normal jump can still carry the companion over a small gap.
    if (me.motor.grounded && this.jumpT === 0) {
      const ahead = Math.min(0.45, d), x = mp.x + dx / d * ahead, z = mp.z + dz / d * ahead;
      const floor = this.support(me, x, mp.y, z);
      this.nextGround.set(x, floor ?? mp.y, z);
      if (floor === null || floor < mp.y - 0.5 || this.unsafe?.(me, this.nextGround)) return null;
    }
    // At a run when well behind, slowing as it comes up.
    const urge = THREE.MathUtils.clamp((dLeader - gap) / 1.5, 0.3, 1);
    this.input.wish.set((dx / d) * urge, (dz / d) * urge);
    this.input.walk = false;
    // Jump where the leader jumped, or up onto ground too high to step.
    if (me.motor.grounded && d < 0.5 && (target.jump || target.p.y - mp.y > me.motor.build.step + 0.04)) {
      me.motor.queueJump();
      this.jumpT = 0.35;
      target.jump = false;
    }
    this.input.jumpHeld = this.jumpT > 0;
    return this.input;
  }
}
