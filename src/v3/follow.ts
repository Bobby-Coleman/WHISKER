// The companion (engine v2): the character not being played follows the one who is, along the trail the leader left
// (footsteps every quarter metre, with the places they jumped), so it goes where the player went instead of
// straight into a wall. It keeps a little way back, jumps where the leader jumped (or up onto a step too high to
// walk), stops where it cannot go (the knight at the foot of a wall she climbed), waits when told to, and if it
// falls far behind or gets stuck while out of sight it catches up unseen.
import * as THREE from 'three';
import type { Actor } from './game';
import type { MotorInput } from './motor';

type Crumb = { p: THREE.Vector3; jump: boolean; climb: boolean };

const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export class Follower {
  mode: 'follow' | 'wait' = 'wait';
  private trail: Crumb[] = [];
  private last = new THREE.Vector3(Infinity, 0, 0);
  private input: MotorInput = { wish: new THREE.Vector2(), walk: false, jumpHeld: false };
  private jumpT = 0;
  private stuckT = 0;
  private best = Infinity;

  // Each fixed step: where the leader is, and whether it just jumped.
  record(leader: Actor, jumped: boolean) {
    const b = leader.char.body;
    if (leader.char.carriedBy || leader.motor.mode !== 'move' && !b.climb) return;
    if (jumped && this.trail.length) this.trail[this.trail.length - 1].jump = true;
    if (jumped || this.last.distanceTo(b.pos) > 0.25) {
      this.trail.push({ p: b.pos.clone(), jump: jumped, climb: !!b.climb });
      this.last.copy(b.pos);
      if (this.trail.length > 160) this.trail.shift();
    }
  }

  clear() { this.trail.length = 0; this.last.set(Infinity, 0, 0); this.stuckT = 0; this.best = Infinity; }

  // The follower's input for this step, or null to stand still.
  step(dt: number, me: Actor, leader: Actor, unseen: (p: THREE.Vector3) => boolean): MotorInput | null {
    this.jumpT = Math.max(0, this.jumpT - dt);
    if (this.mode === 'wait' || me.motor.mode !== 'move') return null;
    const mp = me.char.body.pos, lp = leader.char.body.pos;
    const knight = me.motor.build.kind === 'knight';
    const gap = knight ? 1.7 : 1.1;
    const dLeader = flat(mp, lp);
    // Crumbs it has reached, and any behind the nearest one.
    let near = -1, nd = Infinity;
    for (let i = 0; i < this.trail.length; i++) {
      const d = flat(this.trail[i].p, mp) + Math.abs(this.trail[i].p.y - mp.y) * 0.5;
      if (d < nd) { nd = d; near = i; }
    }
    if (near > 0 && nd < 1.2) this.trail.splice(0, near);
    while (this.trail.length && flat(this.trail[0].p, mp) < 0.3 && Math.abs(this.trail[0].p.y - mp.y) < 0.4) this.trail.shift();
    // Close by: stand.
    if (dLeader < gap && Math.abs(lp.y - mp.y) < 0.8) { this.stuckT = 0; this.best = Infinity; return null; }
    // Far behind, or no way forward, and nobody watching: catch up to a point on the trail a little behind the leader.
    const target = this.trail[0];
    const blocked = !target || (target.climb && knight);
    if (dLeader < this.best - 0.1) { this.best = dLeader; this.stuckT = 0; } else this.stuckT += dt;
    if ((dLeader > 14 || this.stuckT > 3) && leader.motor.grounded && unseen(mp)) {
      for (let i = this.trail.length - 1; i >= 0; i--) {
        const c = this.trail[i];
        if (!c.climb && !c.jump && flat(c.p, lp) > gap * 0.8 && unseen(c.p)) {
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
