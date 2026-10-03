// Engine v2 play: the two characters (a visual Character, the motor that moves it, and their abilities), which one
// is played, the fixed physics step, the follow camera, falls and respawns. Single player switches between them; the
// one not played stays exactly where it was left (on a platform it rides along), so nothing wanders off or glitches
// behind the player's back.
import * as THREE from 'three/webgpu';
import { Physics, L, SOLID } from './physics';
import { Motor, MotorInput, BUILDS } from './motor';
import { Climber } from './climb';
import { Carry } from './carry';
import { FollowCamera, Subject } from './camera';
import type { Character } from '../chars/character';
import type { InputFrame } from '../game/input';
import type { Cutscene } from './timeline';

export type Actor = { char: Character; motor: Motor; ground: (x: number, z: number) => number };
export type Spawn = { pos: THREE.Vector3; yaw: number };
export type LevelInfo = { killY: number; killZones: THREE.Box3[]; spawn: { kitten: Spawn; knight: Spawn }; intro?: Cutscene };

const ZERO2 = new THREE.Vector2();

export class Game {
  kitten: Actor & { climber: Climber };
  knight: Actor;
  carry: Carry;
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

  constructor(public physics: Physics, kittenChar: Character, knightChar: Character, public level: LevelInfo, aspect: number) {
    const mk = (char: Character, kind: 'kitten' | 'knight'): Actor => {
      const motor = new Motor(physics, BUILDS[kind], char.body);
      const B = motor.build;
      const ground = (x: number, z: number) => physics.groundY(x, char.body.pos.y + B.step + 0.05, z, B.step + 1.2, SOLID | L.prop) ?? char.body.pos.y;
      return { char, motor, ground };
    };
    const k = mk(kittenChar, 'kitten');
    this.kitten = { ...k, climber: new Climber(k.motor, physics) };
    this.knight = mk(knightChar, 'knight');
    this.carry = new Carry(physics, this.knight, this.kitten);
    this.active = this.kitten;
    this.camera = new FollowCamera(aspect);
    this.placeAt(level.spawn);
  }

  get companion() { return this.active === this.kitten ? this.knight : this.kitten; }

  // Both characters to their marks, at rest, and the camera behind the one played.
  placeAt(s: LevelInfo['spawn']) {
    this.kitten.climber.drop(); this.carry.cancel();
    this.kitten.motor.place(s.kitten.pos, s.kitten.yaw);
    this.knight.motor.place(s.knight.pos, s.knight.yaw);
    for (const a of [this.kitten, this.knight]) a.char.resetPose(a.ground);
    (this.kitten.char as any).resetCloth?.();
    this.camera.snap(this.subject());
  }

  subject(a = this.active): Subject {
    return { pos: a.char.renderPos.lengthSq() > 0 ? a.char.renderPos : a.char.body.pos, vel: a.char.body.vel, grounded: a.motor.grounded, climbing: !!a.char.body.climb, kind: a.motor.build.kind, yaw: a.char.body.yaw };
  }

  switchTo(next: Actor) {
    if (next === this.active) return;
    this.active = next;
    this.onSwitch?.(next);
  }

  // Once per rendered frame, before the fixed steps: presses (switch, act, jump) and the held buttons.
  handleInput(inp: InputFrame) {
    this.jumpHeld = inp.jumpHeld;
    if (this.locked) return;
    const a = this.active;
    if (inp.switchPressed) this.switchTo(this.companion);
    else if (inp.jumpPressed) {
      if (a === this.kitten && a.char.carriedBy) this.carry.putDown();
      else if (a === this.kitten && a.char.body.climb) this.climbJump = true;
      else a.motor.queueJump();
    }
    if (inp.interactPressed && a === this.knight) {
      if (this.carry.holding) { this.carry.throw(); this.switchTo(this.kitten); }
      else if (this.carry.canLift()) this.carry.lift();
    }
    if (inp.waitPressed && a === this.knight && this.carry.holding) this.carry.putDown();
  }

  // What the played character can do here, for the on-screen prompt.
  prompt(): { text: string; key: 'act' | 'jump' } | null {
    if (this.locked) return null;
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
      const mi: MotorInput | null = played ? { wish, walk: inp.walk, jumpHeld: this.jumpHeld } : null;
      a.motor.step(dt, mi);
      // Running or jumping into a climbable face, she takes hold.
      if (a === k && played && wish.lengthSq() > 0.09) {
        const l = wish.length();
        k.climber.tryGrab(wish.x / l, wish.y / l);
      }
    }
    k.climber.tick(dt);
    this.carry.step();
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
      if (pos.y < this.level.killY || this.level.killZones.some((z) => z.containsPoint(pos))) {
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
    if (a === this.kitten) (a.char as any).resetCloth?.();
    if (a === this.active) { this.camera.snap(this.subject(), this.camera.yaw); this.onFall?.(a, 'in'); }
  }
}
