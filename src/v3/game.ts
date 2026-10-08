// Engine v2 play: the two characters (a visual avatar, the motor that moves it, and their abilities), which one
// is played, the fixed physics step, the follow camera, falls and respawns. Single player switches between them; the
// one not played stays exactly where it was left (on a platform it rides along), so nothing wanders off or glitches
// behind the player's back.
import * as THREE from 'three';
import { Physics, L, SOLID } from './physics';
import { Motor, MotorInput, BUILDS, WATER } from './motor';
import { Climber } from './climb';
import { Carry } from './carry';
import { Follower } from './follow';
import { FollowCamera, Subject } from './camera';
import { Interactions } from './interact';
import type { ToyCharacter } from './chars/api';
import type { InputFrame } from './input';
import type { Cutscene } from './timeline';

// What play needs of a character: the toy characters (chars/api.ts), with the knight's hold point and one-shots.
export type Avatar = ToyCharacter & { holdPoint?(out: THREE.Vector3): THREE.Vector3; play?(name: string): void; resetCloth?(): void };

export type Actor = { char: Avatar; motor: Motor; ground: (x: number, z: number) => number };
export type Spawn = { pos: THREE.Vector3; yaw: number };
export type LevelInfo = { killY: number; killZones: THREE.Box3[]; spawn: { kitten: Spawn; knight: Spawn }; intro?: Cutscene };

const ZERO2 = new THREE.Vector2();

export class Game {
  kitten: Actor & { climber: Climber };
  knight: Actor;
  carry: Carry;
  // Levers, cranks, doors and plates the level adds.
  interactions = new Interactions();
  // The one not played follows the one who is (Q: wait / follow).
  follower = new Follower();
  private leaderJumped = false;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  active: Actor;
  camera: FollowCamera;
  // While a cutscene or a fade holds play, the active character gets no input.
  locked = false;
  private jumpHeld = false;
  private climbJump = false;
  private wish = new THREE.Vector2();
  private pending: { actor: Actor; t: number }[] = [];
  onFall?: (actor: Actor, phase: 'out' | 'in') => void;
  onSwitch?: (to: Actor) => void;
  onWait?: (who: Actor, waiting: boolean) => void;
  // The call button: her meow (and, where there is a companion, wait / follow).
  onCall?: (who: Actor) => void;
  onSink?: (who: Actor) => void;
  onHint?: () => void;

  constructor(public physics: Physics, kittenChar: Avatar, knightChar: Avatar, public level: LevelInfo, aspect: number) {
    const mk = (char: Avatar, kind: 'kitten' | 'knight'): Actor => {
      const motor = new Motor(physics, BUILDS[kind], char.body);
      const B = motor.build;
      const ground = (x: number, z: number) => physics.groundY(x, char.body.pos.y + B.step + 0.05, z, B.step + 1.2, SOLID | L.prop) ?? char.body.pos.y;
      return { char, motor, ground };
    };
    const k = mk(kittenChar, 'kitten');
    this.kitten = { ...k, climber: new Climber(k.motor, physics) };
    this.knight = mk(knightChar, 'knight');
    this.carry = new Carry(physics, this.knight, this.kitten);
    // He never follows her into water deeper than his chest.
    this.follower.unsafe = (me, p) => {
      if (me !== this.knight || !WATER.surface) return false;
      const s = WATER.surface(p.x, p.z);
      if (s === null) return false;
      const floor = physics.groundY(p.x, s + 0.3, p.z, 4, SOLID) ?? s - 4;
      return s - floor > 1.0;
    };
    for (const a of [this.kitten, this.knight] as Actor[]) a.motor.onJump = () => { if (a === this.active) this.leaderJumped = true; };
    this.active = this.kitten;
    this.camera = new FollowCamera(aspect);
    this.placeAt(level.spawn);
  }

  get companion() { return this.active === this.kitten ? this.knight : this.kitten; }
  // A level may keep play with one character (the prologue is hers alone).
  canSwitch = true;

  // Both characters to their marks, at rest, and the camera behind the one played.
  placeAt(s: LevelInfo['spawn']) {
    this.kitten.climber.drop(); this.carry.cancel();
    this.kitten.motor.place(s.kitten.pos, s.kitten.yaw);
    this.knight.motor.place(s.knight.pos, s.knight.yaw);
    for (const a of [this.kitten, this.knight]) a.char.resetPose(a.ground);
    this.kitten.char.resetCloth?.();
    this.camera.snap(this.subject());
  }

  // The camera follows where she walks, not where the wind shoves her.
  private subjVel = new THREE.Vector3();
  subject(a = this.active): Subject {
    const w = a.motor.windVel;
    const vel = this.subjVel.copy(a.char.body.vel); vel.x -= w.x; vel.z -= w.y;
    return { pos: a.char.renderPos.lengthSq() > 0 ? a.char.renderPos : a.char.body.pos, vel, grounded: a.motor.grounded, climbing: !!a.char.body.climb, kind: a.motor.build.kind, yaw: a.char.body.yaw };
  }

  // The one left behind stays exactly where it is (on a lift, on a plate, holding a gate) until it is called.
  switchTo(next: Actor) {
    if (next === this.active) return;
    this.active = next;
    this.climbJump = false;
    this.follower.mode = 'wait';
    this.follower.clear();
    this.onSwitch?.(next);
  }

  // Once per rendered frame, before the fixed steps: presses (switch, act, jump) and the held buttons.
  handleInput(inp: InputFrame) {
    this.jumpHeld = inp.jumpHeld;
    if (this.locked) return;
    if (inp.hintPressed) this.onHint?.();
    if (inp.switchPressed) { if (this.canSwitch) this.switchTo(this.companion); }
    const a = this.active;
    if (!inp.switchPressed && inp.jumpPressed) {
      if (a === this.kitten && a.char.carriedBy) this.carry.putDown();
      else if (a === this.kitten && a.char.body.climb) this.climbJump = true;
      else a.motor.queueJump();
    }
    if (inp.interactPressed) {
      const u = this.carry.holding || this.liftFirst() ? null : this.interactions.nearest(a);
      if (u) u.use(a);
      else if (a === this.knight) {
        if (this.carry.holding) { this.knight.char.play?.('OverhandThrow'); this.carry.throw(); this.switchTo(this.kitten); }
        else if (this.carry.canLift()) this.carry.lift();
      }
    }
    if (inp.waitPressed) {
      if (a === this.knight && this.carry.holding) this.carry.putDown();
      else {
        this.onCall?.(a);
        // With one character in play (the prologue) it is only the call. Otherwise the other one comes to you
        // (follows), or, called again, stays where it is.
        if (this.canSwitch) {
          this.follower.mode = this.follower.mode === 'wait' ? 'follow' : 'wait';
          this.follower.clear();
          this.onWait?.(this.companion, this.follower.mode === 'wait');
        }
      }
    }
  }

  // Lifting her wins over a handle or door when she is right there at his feet in front of him (a follower trailing
  // a step behind doesn't get scooped up when he means to shove a cart).
  private liftFirst() {
    if (this.active !== this.knight || !this.carry.canLift()) return false;
    const p = this.knight.char.body.pos, k = this.kitten.char.body.pos, yaw = this.knight.char.body.yaw;
    const dx = k.x - p.x, dz = k.z - p.z, d = Math.hypot(dx, dz);
    return d < 0.45 || d < 0.9 && (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d > 0.3;
  }

  // What the played character can do here, for the on-screen prompt.
  prompt(): { text: string; key: 'act' | 'jump' } | null {
    if (this.locked) return null;
    const u = this.carry.holding || this.liftFirst() ? null : this.interactions.nearest(this.active);
    if (u) return { text: u.text, key: 'act' };
    if (this.active === this.knight) {
      if (this.carry.holding) return { text: 'Throw her up (Q sets her down)', key: 'act' };
      if (this.carry.canLift()) return { text: 'Lift the kitten', key: 'act' };
    }
    if (this.active === this.kitten && this.kitten.char.carriedBy) return { text: 'Hop down', key: 'jump' };
    return null;
  }

  // The stick, turned by the camera into a world direction (x, z).
  private worldWish(move: THREE.Vector2) {
    const y = this.camera.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y);
    return this.wish.set(fx * move.y - fz * move.x, fz * move.y + fx * move.x);
  }

  fixedStep(dt: number, inp: InputFrame) {
    this.physics.step(dt);
    const wish = this.worldWish(this.locked ? ZERO2 : inp.move);
    const k = this.kitten;
    // The knight first, so the kitten in his hands rides where his hands now are.
    for (const a of [this.knight, this.kitten] as Actor[]) {
      const played = a === this.active && !this.locked;
      if (a === k && k.char.body.climb) {
        k.climber.step(dt, played ? inp.move : ZERO2, played && this.climbJump, this.camera.yaw);
        if (played) this.climbJump = false;
        continue;
      }
      const mi: MotorInput | null = played ? { wish, walk: inp.walk, jumpHeld: this.jumpHeld }
        : this.locked || this.carry.holding && a === k ? null : this.follower.step(dt, a, this.active, (p) => this.unseen(p));
      a.motor.step(dt, mi);
      // Running or jumping into a climbable face, she takes hold.
      if (a === k && played && wish.lengthSq() > 0.09) {
        const l = wish.length();
        k.climber.tryGrab(wish.x / l, wish.y / l);
      }
    }
    k.climber.tick(dt);
    if (!this.locked) this.follower.record(this.active, this.leaderJumped);
    this.leaderJumped = false;
    this.carry.step();
    this.interactions.step([this.kitten, this.knight], dt);
    this.brushPast();
    this.checkFalls(dt);
  }

  // The knight walking into the kitten moves her aside (through her controller, so never into a wall); she cannot
  // walk through him.
  private brushPast() {
    if (this.active !== this.knight || this.carry.holding) return;
    const k = this.kitten, n = this.knight;
    if (k.motor.mode !== 'move') return;
    const kp = k.char.body.pos, np = n.char.body.pos;
    if (kp.y > np.y + n.motor.build.height || kp.y + k.motor.build.height < np.y) return;
    const dx = kp.x - np.x, dz = kp.z - np.z, d = Math.hypot(dx, dz);
    const min = n.motor.build.radius + k.motor.build.radius + 0.03;
    if (d >= min) return;
    let ux = dx / (d || 1), uz = dz / (d || 1);
    if (d < 1e-3) { ux = Math.cos(n.char.body.yaw); uz = -Math.sin(n.char.body.yaw); }
    k.motor.nudge(ux * (min - d), uz * (min - d));
  }

  // Below the level or into a pit: back to the last firm ground. The played character fades out and in.
  private checkFalls(dt: number) {
    for (const p of this.pending) p.t -= dt;
    const due = this.pending.filter((p) => p.t <= 0);
    this.pending = this.pending.filter((p) => p.t > 0);
    for (const p of due) this.respawn(p.actor);
    for (const a of [this.kitten, this.knight] as Actor[]) {
      if (this.pending.some((p) => p.actor === a) || a.char.carriedBy) continue;
      const pos = a.char.body.pos;
      // The knight in water over his chest: his plate drags him down; back to the bank.
      const sunk = a === this.knight && a.motor.wade > 1.2;
      if (sunk || pos.y < this.level.killY || this.level.killZones.some((z) => z.containsPoint(pos))) {
        if (sunk) this.onSink?.(a);
        if (a === this.active) { this.pending.push({ actor: a, t: 0.3 }); this.onFall?.(a, 'out'); }
        else this.respawn(a);
      }
    }
  }

  respawn(a: Actor) {
    if (a === this.kitten) this.kitten.climber.drop();
    this.carry.cancel();
    a.motor.place(a.motor.safe);
    a.char.resetPose(a.ground);
    if (a === this.kitten) a.char.resetCloth?.();
    if (a === this.active) { this.camera.snap(this.subject(), this.camera.yaw); this.follower.clear(); this.onFall?.(a, 'in'); }
  }

  // Out of the camera's view (or far off in the fog): where a companion may catch up without being seen to.
  unseen(p: THREE.Vector3) {
    const c = this.camera.cam;
    c.updateMatrixWorld();
    this.pv.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    if (c.position.distanceTo(p) > 35) return true;
    return !this.frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(p.x, p.y + 0.6, p.z), 0.9));
  }
}
