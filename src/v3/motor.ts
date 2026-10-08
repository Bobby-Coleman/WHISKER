// The platformer motor both characters share: the same run speed and the same jump, so every gap is crossable by
// both (as in It Takes Two). They differ in size, weight and abilities (climb.ts, carry.ts), not in pace.
//
// Movement is resolved by Rapier's kinematic character controller: it slides along walls, walks up slopes to
// MOVE.maxSlope, steps up small ledges and stays on the ground going down. The feel is momentum with quick
// acceleration, a buffered jump with coyote time, variable height (let go early for a hop), a short hang at the
// apex and a faster fall. A moving platform carries whatever stands on it, and a jump keeps its motion.
import * as THREE from 'three';
import { RAPIER, Physics, Platform, L, groups, Surface, SOLID, DOWN } from './physics';
import { CharacterBody, WIND } from './body';

export const MOVE = {
  // The pace v1 settled on: brisk for the knight, and not a blur for the kitten a fifth of his height.
  run: 3.5, walk: 1.45, // m/s, both characters
  accel: 30, decel: 38, skid: 60, // on the ground, m/s²
  airAccel: 10, airDrag: 0.6, // steering in the air; momentum is kept without input
  turn: 15, airTurn: 6, // facing, rad/s
  // About v1's half-metre hop for both (a leap of four times her height looked like flying), with platformer
  // gravity: quick up, a little hang, quicker down. Gaps up to about 1.6 m at a run.
  jumpHeight: 0.6, // metres, with the button held to the apex
  gUp: 16, gCut: 40, gDown: 26, // gravity rising (button held) / rising after letting go / falling
  apexBand: 1.0, apexHang: 0.6, // near the apex, with the button held, gravity eases off
  coyote: 0.11, buffer: 0.14, // grace after running off an edge, and for a press just before landing
  terminal: 24,
  maxSlope: THREE.MathUtils.degToRad(50),
};
export const jumpSpeed = () => Math.sqrt(2 * MOVE.gUp * MOVE.jumpHeight);

// Water (water.ts), where a level has it: the surface over (x, z), or null. The kitten swims where it is deeper than
// she is tall at the shoulder (slower, floating, a lunge to get out); the knight walks the bottom, slowed as it rises
// up his legs, and can barely jump in it.
export const WATER: { surface: ((x: number, z: number) => number | null) | null } = { surface: null };
export const SWIM = { speed: 1.5, accel: 7, decel: 4, float: 0.1, enter: 0.15, leave: 0.1, lunge: 0.85 };

export type Kind = 'kitten' | 'knight';
// Size and weight: a capsule from the feet (radius, total height), the step it walks up, how far down it sticks to
// the ground, its skin (gap kept to surfaces), its mass for pushing props, and what stops it.
export type Build = { kind: Kind; radius: number; height: number; step: number; snap: number; skin: number; mass: number; member: number; solid: number };
export const BUILDS: Record<Kind, Build> = {
  // She is stopped by the knight (she cannot run through him); he brushes her aside instead (game.ts).
  kitten: { kind: 'kitten', radius: 0.09, height: 0.34, step: 0.22, snap: 0.24, skin: 0.006, mass: 4, member: L.kitten, solid: SOLID | L.prop | L.knight | L.kittenOnly },
  knight: { kind: 'knight', radius: 0.3, height: 1.8, step: 0.34, snap: 0.36, skin: 0.012, mass: 110, member: L.knight, solid: SOLID | L.prop | L.knightOnly },
};

// Stick input in world space: wish.x is world x, wish.y is world z, length 0..1.
export type MotorInput = { wish: THREE.Vector2; walk: boolean; jumpHeld: boolean };
const NO_INPUT: MotorInput = { wish: new THREE.Vector2(), walk: false, jumpHeld: false };

const _c = new THREE.Vector3(), _c2 = new THREE.Vector3(), _carry = new THREE.Vector3(), _o = new THREE.Vector3();

export class Motor {
  readonly collider: RAPIER.Collider;
  readonly cc: RAPIER.KinematicCharacterController;
  // The velocity it means to have (m/s). The body's `vel` is what it actually did (walls and slopes included).
  vel = new THREE.Vector3();
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  groundCollider: RAPIER.Collider | null = null;
  platform: Platform | null = null;
  surface: Surface | undefined;
  jumping = false;
  coyote = 0; buffer = 0;
  airTime = 0;
  // Swimming (the kitten), or how deep the water is round its legs (m).
  swimming = false;
  // Only a carried throw can receive the designated crossing's gust. Walking and ordinary jumps cannot.
  thrown = false;
  windVel = new THREE.Vector2();
  wade = 0;
  onSplash?: (strength: number) => void;
  // 'move': the motor runs. 'held': something else places it each step (a climb, a carry, a cutscene).
  mode: 'move' | 'held' = 'move';
  // The last firm, open ground it stood on, where a fall returns it.
  safe = new THREE.Vector3();
  private safeT = 0;
  // A collider it passes through for a moment (the knight, for a kitten just thrown from his hands).
  private ignore: { c: RAPIER.Collider; t: number } | null = null;
  onJump?: () => void;
  onLand?: (strength: number) => void;
  private center = new THREE.Vector3();
  private query: number;
  private filter = (c: RAPIER.Collider) => !(this.ignore && this.ignore.c.handle === c.handle);

  constructor(public physics: Physics, public build: Build, public body: CharacterBody) {
    const B = build;
    const half = Math.max(0.001, B.height / 2 - B.radius);
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(half, B.radius).setCollisionGroups(groups(B.member, L.all)));
    this.query = groups(B.member, B.solid);
    const cc = physics.world.createCharacterController(B.skin);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle(MOVE.maxSlope);
    cc.setMinSlopeSlideAngle(MOVE.maxSlope);
    cc.enableAutostep(B.step, B.radius * 0.8, false);
    cc.enableSnapToGround(B.snap);
    cc.setSlideEnabled(true);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(B.mass);
    this.cc = cc;
    this.syncCollider();
  }

  centerOf(feet: THREE.Vector3, out: THREE.Vector3) { return out.set(feet.x, feet.y + this.build.height / 2 + this.build.skin, feet.z); }
  syncCollider() { this.centerOf(this.body.pos, this.center); this.collider.setTranslation(this.center); }

  // Puts it somewhere at rest (spawn, respawn, the end of a climb or a cutscene mark).
  place(feet: THREE.Vector3, yaw = this.body.yaw) {
    const b = this.body;
    b.pos.copy(feet); b.prevPos.copy(feet);
    b.yaw = b.prevYaw = yaw; b.turnRate = 0;
    b.vel.set(0, 0, 0); b.vy = 0; b.visualDY = 0;
    this.vel.set(0, 0, 0);
    this.wade = b.wade = 0; b.wind = 0; this.thrown = false; this.windVel.set(0, 0);
    this.jumping = false; this.buffer = 0; this.coyote = 0; this.airTime = 0;
    this.swimming = b.swimming = false;
    this.mode = 'move';
    this.syncCollider();
    this.probeGround();
    this.grounded = b.grounded = !!this.groundCollider;
    if (this.grounded) this.safe.copy(feet);
  }

  // Launched (a throw, a push off a wall): airborne with this velocity.
  launch(v: THREE.Vector3, asJump = false) {
    this.mode = 'move';
    this.thrown = false; this.windVel.set(0, 0);
    this.vel.copy(v);
    this.grounded = this.body.grounded = false;
    this.jumping = asJump; this.coyote = 0; this.platform = null;
  }

  passThrough(c: RAPIER.Collider, seconds: number) { this.ignore = { c, t: seconds }; }
  queueJump() { this.buffer = MOVE.buffer; }
  // Abilities can forbid jumping (carrying something awkward, for instance).
  canJump = () => true;

  step(dt: number, inp: MotorInput | null) {
    const b = this.body, B = this.build;
    b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
    if (this.ignore && (this.ignore.t -= dt) <= 0) this.ignore = null;
    if (this.mode !== 'move') { this.buffer = 0; return; }
    const input = inp ?? NO_INPUT;

    // Riding: what it stood on moved this step (the world has already stepped), so it moves by as much. It goes
    // through the controller with its own motion, so a platform cannot carry it into a wall.
    _carry.set(0, 0, 0);
    if (this.grounded && this.platform) {
      this.centerOf(b.pos, _c);
      this.platform.carry(_c2.copy(_c));
      _carry.subVectors(_c2, _c);
      b.yaw += this.platform.yawDelta();
    }

    // Water: how deep it stands over the ground here.
    const surf = WATER.surface ? WATER.surface(b.pos.x, b.pos.z) : null;
    let floor = b.pos.y;
    if (surf !== null) floor = this.physics.groundY(b.pos.x, Math.max(b.pos.y, surf) + 0.3, b.pos.z, 4, SOLID) ?? b.pos.y - 3;
    const deep = surf === null ? 0 : surf - floor;
    this.wade = surf === null ? 0 : Math.max(0, surf - b.pos.y);
    b.wade = this.wade;
    if (B.kind === 'kitten') {
      const was = this.swimming;
      if (!this.swimming && deep > SWIM.enter && b.pos.y < surf! - SWIM.float * 0.5 && this.vel.y <= 0.5) this.swimming = true;
      else if (this.swimming && (deep < SWIM.leave || surf === null)) this.swimming = false;
      if (this.swimming && !was) { this.onSplash?.(THREE.MathUtils.clamp(-this.vel.y / 4, 0.25, 1)); this.vel.y *= 0.2; this.jumping = false; }
      b.swimming = this.swimming;
    }
    if (this.swimming) { this.thrown = false; this.windVel.set(0, 0); b.wind = 0; this.swimStep(dt, input, surf!); return; }

    // Horizontal: toward the stick at run or walk speed (slower wading deep).
    const wl = Math.min(1, input.wish.length());
    const wadeK = B.kind === 'knight' ? 1 - 0.5 * THREE.MathUtils.clamp((this.wade - 0.3) / 0.7, 0, 1) : 1 - 0.25 * THREE.MathUtils.clamp(this.wade / 0.12, 0, 1);
    const top = (input.walk ? MOVE.walk : MOVE.run) * wadeK;
    const inv = wl > 0.01 ? (wl * top) / input.wish.length() : 0;
    const tx = input.wish.x * inv, tz = input.wish.y * inv;
    let vx = this.vel.x, vz = this.vel.z, vy = this.vel.y;
    if (this.grounded) {
      const dvx = tx - vx, dvz = tz - vz, dl = Math.hypot(dvx, dvz) || 1;
      const rate = wl < 0.01 ? MOVE.decel : vx * tx + vz * tz < 0 ? MOVE.skid : MOVE.accel;
      const k = Math.min(1, (rate * dt) / dl);
      vx += dvx * k; vz += dvz * k;
    } else if (wl > 0.01) {
      // Steering in the air, never slowing below the pace it already has (a jump off a ferry keeps the ferry's speed).
      const sp0 = Math.hypot(vx, vz);
      const dvx = tx - vx, dvz = tz - vz, dl = Math.hypot(dvx, dvz) || 1;
      const k = Math.min(1, (MOVE.airAccel * dt) / dl);
      vx += dvx * k; vz += dvz * k;
      const sp1 = Math.hypot(vx, vz), cap = Math.max(sp0, top);
      if (sp1 > cap) { vx *= cap / sp1; vz *= cap / sp1; }
    } else {
      const f = Math.max(0, 1 - MOVE.airDrag * dt);
      vx *= f; vz *= f;
    }

    // Jump: a press up to MOVE.buffer before landing counts, and so does one just after running off an edge.
    this.buffer = Math.max(0, this.buffer - dt);
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && (this.grounded || this.coyote > 0) && this.canJump()) {
      vy = jumpSpeed() * (this.wade > 0.6 ? 0.55 : 1);
      if (this.platform) {
        const pv = this.platform.pointVel(this.centerOf(b.pos, _c), dt, _c2);
        vx += pv.x; vz += pv.z; vy += Math.max(0, pv.y);
      }
      this.jumping = true; this.grounded = false; this.coyote = 0; this.buffer = 0;
      this.onJump?.();
    }

    // Gravity: lighter rising while the button is held, a hang at the apex, heavier falling.
    if (!this.grounded) {
      let g = vy > 0 ? (this.jumping && !input.jumpHeld ? MOVE.gCut : MOVE.gUp) : MOVE.gDown;
      if (this.jumping && input.jumpHeld && Math.abs(vy) < MOVE.apexBand) g *= MOVE.apexHang;
      vy = Math.max(vy - g * dt, -MOVE.terminal);
    } else vy = 0;

    // Ambient wind never moves her. The one authored crossing may carry an airborne throw, then stops
    // immediately on landing so a gust cannot shove her while she walks or stands on its platforms.
    if (B.kind === 'kitten' && this.thrown && !this.grounded) {
      const open = WIND.push > 0.05 && !WIND.sheltered(b.pos) && !b.climb;
      const wx = open ? WIND.dir.x * WIND.push : 0, wz = open ? WIND.dir.y * WIND.push : 0;
      const k = Math.min(1, dt * (open ? 3.5 : 6));
      this.windVel.x += (wx - this.windVel.x) * k; this.windVel.y += (wz - this.windVel.y) * k;
      b.wind = Math.min(1, this.windVel.length() / 4);
    } else { this.windVel.set(0, 0); b.wind = 0; }
    // Move through the world.
    const dx = vx * dt + _carry.x + this.windVel.x * dt, dz = vz * dt + _carry.z + this.windVel.y * dt;
    // On the ground the move is level and snapping keeps it there: pressing down into the floor as well made the
    // controller now and then lose a step's motion.
    const dy = (this.grounded ? 0 : vy * dt) + _carry.y;
    if (vy > 0) this.cc.disableSnapToGround(); else this.cc.enableSnapToGround(B.snap);
    this.cc.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.query, this.filter);
    const m = this.cc.computedMovement();
    const was = this.grounded, vyBefore = vy;
    this.grounded = this.cc.computedGrounded() && vy <= 0;
    // Heads stop on ceilings; walls take the velocity into them.
    for (let i = 0, n = this.cc.numComputedCollisions(); i < n; i++) {
      const c = this.cc.computedCollision(i);
      if (!c) continue;
      const nx = c.normal1.x, ny = c.normal1.y, nz = c.normal1.z;
      if (ny < -0.5 && vy > 0) vy = 0;
      if (Math.abs(ny) < 0.7) {
        const hl = Math.hypot(nx, nz) || 1, hx = nx / hl, hz = nz / hl;
        const into = vx * hx + vz * hz;
        if (into < 0) { vx -= hx * into; vz -= hz * into; }
      }
    }
    const t = this.collider.translation();
    this.center.set(t.x + m.x, t.y + m.y, t.z + m.z);
    this.collider.setTranslation(this.center);
    b.pos.set(this.center.x, this.center.y - B.height / 2 - B.skin, this.center.z);

    if (this.grounded) {
      this.thrown = false; this.windVel.set(0, 0); b.wind = 0;
      if (!was) {
        const s = THREE.MathUtils.clamp((-vyBefore - 2) / 9, 0, 1);
        b.landing = Math.max(b.landing, s);
        this.onLand?.(s);
      }
      vy = 0; this.jumping = false; this.coyote = MOVE.coyote; this.airTime = 0;
      // A step up happens in one step of physics; the body's visual eases up it instead.
      const rise = m.y - _carry.y;
      if (was && rise > 0.06) b.visualDY -= rise;
    } else this.airTime += dt;
    this.probeGround();

    // Facing: along its motion, or toward the stick when barely moving.
    const sp = Math.hypot(vx, vz);
    if (sp > 0.15 || wl > 0.2) {
      const want = sp > 0.15 ? Math.atan2(vx, vz) : Math.atan2(input.wish.x, input.wish.y);
      const d = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
      const r = (this.grounded ? MOVE.turn : MOVE.airTurn) * dt;
      b.yaw += THREE.MathUtils.clamp(d, -r, r);
    }
    const dyaw = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    b.turnRate = dyaw / dt;

    this.vel.set(vx, vy, vz);
    // The body's velocity is its own motion (what the legs did), not the platform's.
    b.vel.set((m.x - _carry.x) / dt, (m.y - _carry.y) / dt, (m.z - _carry.z) / dt);
    b.vy = vy;
    b.grounded = this.grounded;

    // Remember firm, open ground to come back to after a fall.
    this.safeT -= dt;
    if (this.grounded && !this.platform && this.groundNormal.y > 0.85 && this.safeT <= 0 && this.wade < 0.15) {
      this.safeT = 0.25;
      if (this.openGround()) this.safe.copy(b.pos);
    }
  }

  // Swimming: paddling at the surface, slower than on land, the body held afloat (feet `SWIM.float` under it); a
  // jump is a lunge up out of the water (onto a bank or a log).
  private swimStep(dt: number, input: MotorInput, surf: number) {
    const b = this.body, B = this.build;
    const wl = Math.min(1, input.wish.length());
    const inv = wl > 0.01 ? (wl * SWIM.speed) / input.wish.length() : 0;
    const tx = input.wish.x * inv, tz = input.wish.y * inv;
    let vx = this.vel.x, vz = this.vel.z;
    const dvx = tx - vx, dvz = tz - vz, dl = Math.hypot(dvx, dvz) || 1;
    const k = Math.min(1, ((wl < 0.01 ? SWIM.decel : SWIM.accel) * dt) / dl);
    vx += dvx * k; vz += dvz * k;
    // Afloat: eased to the surface, with a slow bob.
    const want = surf - SWIM.float + Math.sin(this.physics.time * 2.6) * 0.004;
    let vy = THREE.MathUtils.clamp((want - b.pos.y) * 7, -1.2, 1.2);
    this.buffer = Math.max(0, this.buffer - dt);
    let lunge = false;
    if (this.buffer > 0 && this.canJump()) {
      vy = jumpSpeed() * SWIM.lunge; lunge = true; this.buffer = 0;
      this.onJump?.();
    }
    this.cc.disableSnapToGround();
    this.cc.computeColliderMovement(this.collider, { x: vx * dt, y: vy * dt, z: vz * dt }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.query, this.filter);
    const m = this.cc.computedMovement();
    for (let i = 0, n = this.cc.numComputedCollisions(); i < n; i++) {
      const c = this.cc.computedCollision(i);
      if (!c || Math.abs(c.normal1.y) >= 0.7) continue;
      const hl = Math.hypot(c.normal1.x, c.normal1.z) || 1, hx = c.normal1.x / hl, hz = c.normal1.z / hl;
      const into = vx * hx + vz * hz;
      if (into < 0) { vx -= hx * into; vz -= hz * into; }
    }
    const t = this.collider.translation();
    this.center.set(t.x + m.x, t.y + m.y, t.z + m.z);
    this.collider.setTranslation(this.center);
    b.pos.set(this.center.x, this.center.y - B.height / 2 - B.skin, this.center.z);
    this.grounded = b.grounded = false;
    this.coyote = 0; this.airTime = 0;
    if (lunge) { this.swimming = b.swimming = false; this.jumping = true; }
    this.platform = null; this.groundCollider = null;
    const sp = Math.hypot(vx, vz);
    if (sp > 0.1 || wl > 0.2) {
      const want = sp > 0.1 ? Math.atan2(vx, vz) : Math.atan2(input.wish.x, input.wish.y);
      const d = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
      const r = MOVE.turn * 0.6 * dt;
      b.yaw += THREE.MathUtils.clamp(d, -r, r);
    }
    const dyaw = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    b.turnRate = dyaw / dt;
    this.vel.set(vx, vy, vz);
    b.vel.set(m.x / dt, m.y / dt, m.z / dt);
    b.vy = vy;
  }

  // What it stands on: the collider under its foot sphere (a moving platform carries it), the slope and the surface.
  private probeGround() {
    const B = this.build;
    this.groundCollider = null; this.platform = null; this.surface = undefined; this.groundNormal.set(0, 1, 0);
    const o = _o.set(this.center.x, this.center.y - B.height / 2 + B.radius, this.center.z);
    const h = this.physics.sphereCast(o, DOWN, B.radius * 0.9, B.radius * 0.1 + B.skin + 0.08, B.solid, this.collider);
    if (!h || h.normal.y < 0.45) return;
    this.groundCollider = h.collider;
    this.groundNormal.copy(h.normal);
    this.platform = this.physics.platformOf(h.collider);
    this.surface = h.surface;
  }

  // Ground all round the feet (not the lip of a drop): a safe place to return to.
  private openGround() {
    const p = this.body.pos, r = Math.max(0.35, this.build.radius * 2.5);
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const y = this.physics.groundY(p.x + ox, p.y + 0.3, p.z + oz, 0.7, SOLID);
      if (y === null || Math.abs(y - p.y) > 0.35) return false;
    }
    return true;
  }

  // Pushed sideways by something it cannot stop (the knight brushing past): moved through the controller, so walls
  // still hold it.
  nudge(dx: number, dz: number) {
    if (this.mode !== 'move') return;
    this.cc.enableSnapToGround(this.build.snap);
    this.cc.computeColliderMovement(this.collider, { x: dx, y: -0.01, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.query, this.filter);
    const m = this.cc.computedMovement();
    const t = this.collider.translation();
    this.center.set(t.x + m.x, t.y + m.y, t.z + m.z);
    this.collider.setTranslation(this.center);
    this.body.pos.set(this.center.x, this.center.y - this.build.height / 2 - this.build.skin, this.center.z);
  }
}
