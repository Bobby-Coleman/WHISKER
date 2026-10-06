// The knight (v3): a chunky toy knight (knight/model.ts: three skinned meshes) on the animation library's skeleton
// (avatar.ts). Locomotion, jumps, carrying and one-shots come from the clips; on top of them he poses himself: arms
// kept clear of his armour, a wounded stumble (hunched, leaning into his left shoulder, his right hand pressed to
// the spear) with a stagger, sliding down a trunk to sit against it (legs out, the lap open, head on his chest,
// lifting it to look, his left hand sheltering what is in his lap), both hands on a bar or a crank, feet on the
// ground and his skirt and sword swinging clear.
import * as THREE from 'three';
import { CharacterBody, PoseContext, WIND } from '../body';
import type { ToyCharacter } from './api';
import { Avatar, Proportions } from './avatar';
import { buildKnight, KnightModel, Part, HAND, HELM_CENTRE, EYE, Panel, cuirassPoint } from './knight/model';

const K = 0.84 / 0.917, SP = 0.91;
// Hips 0.84 m, thigh 0.37, shin 0.39; shoulders 0.23 out at 1.32; a short neck under a big helm (top at 1.8).
export const KNIGHT_PROPS: Proportions = {
  hipRatio: K,
  scale: (p, c) => {
    if (p === 'root') return K;
    if (p === 'pelvis') return c.startsWith('thigh') ? [1.22, K, K] : SP;
    if (p === 'spine_03') return c.startsWith('clavicle') ? [1.18, SP, 0.85] : SP;
    if (p.startsWith('spine')) return SP;
    if (p === 'neck_01') return 0.75;
    if (p.startsWith('clavicle')) return [1.18, SP, 0.8];
    if (p.startsWith('upperarm')) return 0.95;
    if (p.startsWith('lowerarm')) return 0.92;
    if (/^(thigh|calf|foot|ball)/.test(p)) return K;
    return 1;
  },
};

const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Walk_Carry_Loop', 'Push_Loop',
  'OverhandThrow', 'PickUp_Table', 'Interact', 'Hit_Chest', 'Hit_Knockback'];
const GAITS = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Walk_Carry_Loop', 'Push_Loop'];
const UPPER_SHOTS = ['OverhandThrow', 'PickUp_Table', 'Interact', 'Hit_Chest', 'Hit_Knockback'];
// Natural ground speeds of the loops at his size (m/s).
const SPEED = { walk: 0.82, jog: 3.45, sprint: 5.2, push: 0.3 };

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const sm = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

type Side = 'l' | 'r';

export class ToyKnight implements ToyCharacter {
  kind = 'knight' as const;
  body = new CharacterBody(0.3, 1.8);
  group = new THREE.Group();
  renderPos = new THREE.Vector3(); renderYaw = 0;
  carriedBy: ToyCharacter | null = null; holding: ToyCharacter | null = null;
  // Story controls (0..1 targets, eased).
  seated = 0; headUp = 0; shelter = 0; restHand = 0;
  gait: 'normal' | 'stumble' = 'normal';
  lookTarget: THREE.Vector3 | null = null;
  // Both hands on something in the world (a gate's bar, a crank's handles), or null.
  hands: { left: THREE.Vector3; right: THREE.Vector3 } | null = null;
  pushing = false;
  outfit = { wounded: false };
  // Seated: where his left hand comes to rest when sheltering (his local space: x his left, y up, z his front;
  // the palm's middle goes there, palm down, cupped). Null: a roof 0.25 m over the lap point.
  shelterAt: THREE.Vector3 | null = null;
  // Seated: how far behind his hips (local -z) the trunk he leans on is (his back meets a vertical plane there).
  backRest = 0.22;

  private av = new Avatar(KNIGHT_PROPS);
  private m!: KnightModel;
  private ready = false;
  private yawQ = new THREE.Quaternion();
  private time = 0;
  // Eased state.
  private spd = 0; private air = 0; private land = 0; private wasGrounded = true; private takeoff = -1;
  private carryW = 0; private pushW = 0; private stumbleW = 0; private handsW = 0; private seatW = 0;
  private headUpNow = 0; private shelterNow = 0; private restNow = 0;
  private handTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  private oneShot: { name: string; t: number; dur: number } | null = null;
  // The slide down the trunk: u 0 standing .. 1 seated; a scripted slide runs `slideT` seconds.
  private u = 0; private slideT = -1;
  private staggerT = -1;
  private lurchT = 3; private lurch = 0;
  private curl = [0.4, 0.4];
  private dip = 0; // landing squash
  private pelvisVel = new THREE.Vector3(); private lastPelvis = new THREE.Vector3();
  private scab = { ang: 0.0, vel: 0 };
  private seatLift = 0;
  private lapRest = new THREE.Vector3(0, 0.33, 0.3);
  lapTops: number[] = [];

  async load() {
    await this.av.load(CLIPS);
    this.group.add(this.av.root);
    // His parts are made (and baked onto the skeleton) at its rest pose, before any clip has moved it.
    this.m = buildKnight(this.av);
    for (const n of GAITS) this.av.manual(n, true);
    this.av.alignLoops(['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Walk_Carry_Loop', 'Push_Loop']);
    for (const n of ['Jump_Start', 'Jump_Land', ...UPPER_SHOTS]) {
      const c = this.av.clip(n)!;
      for (const a of [c.lower, c.upper]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 0; }
    }
    // The pauldrons' frames, taken with the arms hanging as they idle.
    this.av.weight('Idle_Loop', 1);
    this.av.evaluate(0);
    this.group.updateMatrixWorld(true);
    for (const p of this.m.pauldrons) {
      const s = p.side === 'l' ? 1 : -1;
      const want = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0.42 * s, 1, 0.02).normalize());
      p.relC.copy(this.av.quat(`clavicle_${p.side}`).invert().multiply(want));
      p.relU.copy(this.av.quat(`upperarm_${p.side}`).invert().multiply(want));
    }
    this.av.weight('Idle_Loop', 0);
    this.scabRest = this.m.scabbard.position.clone();
    this.soles();
    this.av.soleLift = (i, ankle, ground) => this.soleLift(i, ankle, ground);
    this.setOutfit(this.outfit);
    this.ready = true;
    // Where her seat on his lap is, sat (measured once on his posed meshes at the origin).
    this.u = 1; this.seated = 1;
    for (let i = 0; i < 4; i++) this.pose({ dt: 1 / 60, time: 0, ground: () => 0, lookAt: null, active: false }, 1 / 60);
    this.lapRest.copy(this.measureLap());
    this.u = 0; this.seated = 0;
    this.resetPose();
    this.pose({ dt: 1 / 60, time: 0, ground: () => 0, lookAt: null, active: false }, 1 / 60);
  }

  setOutfit(o: Partial<{ wounded: boolean }>) {
    Object.assign(this.outfit, o);
    if (!this.m) return;
    const w = this.outfit.wounded;
    this.m.spear.scale.setScalar(w ? 1 : 1e-4);
    this.m.blood.visible = w;
    const st = this.m.stain;
    (st.attr.array as Float32Array).set(w ? st.bloody : st.clean); st.attr.needsUpdate = true;
  }

  // A one-shot over the legs: OverhandThrow, PickUp_Table, Interact, Hit_Chest, Hit_Knockback.
  // Also his own: 'Shoulder' (a shoulder barge), 'Lift' (a heave from the legs, as at a gate), 'Push' (a shove;
  // with `pushing`), 'Throw' and 'PickUp' (the clips' short names).
  play(name: string) {
    if (name === 'Shoulder' || name === 'Lift' || name === 'Push') { this.move = { name, t: 0 }; return; }
    const alias: Record<string, string> = { Throw: 'OverhandThrow', PickUp: 'PickUp_Table', Hit: 'Hit_Chest' };
    const n = alias[name] ?? name;
    const c = this.av.clip(n);
    if (!c) return;
    c.upper.reset(); c.upper.timeScale = 1; c.upper.play();
    this.oneShot = { name: n, t: 0, dur: c.dur };
  }
  private move: { name: string; t: number } | null = null;
  get busy() { return this.oneShot !== null; }

  // From standing with his back to a trunk (behind him) down to sitting against it.
  beginSlide() { this.slideT = 0; this.u = Math.min(this.u, 0.02); this.seated = 1; }
  // A wounded stumble: he lurches, nearly falls, catches himself.
  stagger() { this.staggerT = 0; }

  resetPose(_g?: (x: number, z: number) => number) {
    this.renderPos.copy(this.body.pos); this.renderYaw = this.body.yaw;
    this.place();
    if (this.slideT < 0) this.u = this.seated;
    this.seatW = sm(this.u / 0.12);
    this.stumbleW = this.gait === 'stumble' ? 1 : 0;
    this.headUpNow = this.headUp; this.shelterNow = this.shelter; this.restNow = this.restHand;
    this.carryW = this.holding ? 1 : 0;
    for (const p of this.m?.panels ?? []) { p.a1 = p.v1 = p.a2 = p.v2 = 0; }
    this.air = 0; this.land = 0;
    // Story controls set right after a reset (a checkpoint: sat already) take effect at once.
    this.snap = true;
  }
  private snap = false;
  private place() { this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0); this.yawQ.setFromAxisAngle(UP, this.renderYaw); }

  // ---- Local (x his left, y up, z his front; origin at his feet) to world.
  private L(x: number, y: number, z: number, out = V()) { return out.set(x, y, z).applyQuaternion(this.yawQ).add(this.renderPos); }
  private D(x: number, y: number, z: number, out = V()) { return out.set(x, y, z).applyQuaternion(this.yawQ); }
  private local(p: THREE.Vector3, out = V()) { return out.copy(p).sub(this.renderPos).applyQuaternion(this.yawQ.clone().invert()); }

  updateVisual(alpha: number, ctx: PoseContext) {
    const b = this.body;
    const dt = clamp(ctx.dt, 1e-4, 0.1);
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    if (b.visualDY !== 0) {
      this.renderPos.y += b.visualDY;
      b.visualDY *= Math.exp(-dt * 18);
      if (Math.abs(b.visualDY) < 1e-4) b.visualDY = 0;
    }
    const dy = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    this.renderYaw = b.prevYaw + dy * alpha;
    this.place();
    if (!this.ready) return;
    this.time += dt;
    this.pose(ctx, dt);
  }

  update(_dt: number, _ctx: PoseContext) {}

  // The ground round him as a plane (three probes a frame), for the cloth and the seat; the feet probe the real thing.
  private gp = { y: 0, x: 0, z: 0, dx: 0, dz: 0 };
  private plane = (x: number, z: number) => this.gp.y + (x - this.gp.x) * this.gp.dx + (z - this.gp.z) * this.gp.dz;
  private probe(ctx: PoseContext) {
    const p = this.renderPos, g = this.gp;
    g.x = p.x; g.z = p.z;
    g.y = ctx.ground(p.x, p.z);
    g.dx = (ctx.ground(p.x + 0.4, p.z) - g.y) / 0.4;
    g.dz = (ctx.ground(p.x, p.z + 0.4) - g.y) / 0.4;
    // A step or a ledge beside him is not a slope.
    if (Math.abs(g.dx) > 0.6) g.dx = 0;
    if (Math.abs(g.dz) > 0.6) g.dz = 0;
  }

  // ================================================================ The pose, each rendered frame.
  private pose(ctx: PoseContext, dt: number) {
    const b = this.body, av = this.av;
    this.probe(ctx);
    // Story controls, eased (or at once after a reset).
    if (this.snap) {
      this.snap = false;
      if (this.slideT < 0) this.u = clamp(this.seated, 0, 1);
      this.headUpNow = this.headUp; this.shelterNow = this.shelter; this.restNow = this.restHand;
      this.stumbleW = this.gait === 'stumble' ? 1 : 0;
      this.handsW = this.hands ? 1 : 0;
    }
    if (this.slideT >= 0) {
      this.slideT += dt;
      this.u = slideCurve(this.slideT);
      if (this.slideT >= SLIDE_DUR) { this.slideT = -1; this.u = 1; }
    } else {
      const target = clamp(this.seated, 0, 1);
      // Getting up is slow, unless something is already walking him off.
      const up = Math.hypot(b.vel.x, b.vel.z) > 0.2 ? 3 : 0.45;
      this.u += clamp(target - this.u, -dt * up, dt * 0.9);
    }
    const seatW = sm(this.u / 0.12);
    this.seatW = seatW;
    this.headUpNow += (clamp(this.headUp, 0, 1) - this.headUpNow) * ease(1.6, dt);
    this.shelterNow += (clamp(this.shelter, 0, 1) - this.shelterNow) * ease(1.4, dt);
    this.restNow += (clamp(this.restHand, 0, 1) - this.restNow) * ease(2, dt);
    this.stumbleW += ((this.gait === 'stumble' ? 1 : 0) - this.stumbleW) * ease(3, dt);
    this.carryW += ((this.holding ? 1 : 0) - this.carryW) * ease(7, dt);
    this.pushW += ((this.pushing ? 1 : 0) - this.pushW) * ease(5, dt);
    if (this.hands) { this.handTargets.left.copy(this.hands.left); this.handTargets.right.copy(this.hands.right); }
    this.handsW += ((this.hands ? 1 : 0) - this.handsW) * ease(4, dt);

    // ---------- Clips.
    const seatedish = seatW > 0.01;
    const rawSp = seatedish ? 0 : Math.hypot(b.vel.x, b.vel.z);
    this.spd += (rawSp - this.spd) * ease(12, dt);
    let sp = this.spd;
    // Turning on the spot: he steps round.
    const turnStep = clamp(Math.abs(b.turnRate) * 0.22 - sp, 0, 0.5) * (1 - seatW);
    const stum = this.stumbleW;
    const stag = this.staggerT >= 0 ? stagCurve(this.staggerT) : 0;
    if (this.staggerT >= 0) { this.staggerT += dt; if (this.staggerT > STAG_DUR) this.staggerT = -1; }
    const S = { walk: lerp(SPEED.walk, 0.5, stum), jog: SPEED.jog, sprint: SPEED.sprint };
    const gsp = Math.max(sp, turnStep) * (1 - stag * 0.8);
    let wi = 0, ww = 0, wj = 0, ws = 0;
    if (gsp < 0.08) wi = 1;
    else if (gsp < S.walk) { const t = (gsp - 0.08) / (S.walk - 0.08); wi = 1 - t; ww = t; }
    else if (gsp < S.jog) { const t = (gsp - S.walk) / (S.jog - S.walk); ww = 1 - t; wj = t; }
    else if (gsp < S.sprint) { const t = (gsp - S.jog) / (S.sprint - S.jog); wj = 1 - t; ws = t; }
    else ws = 1;
    const walk = av.clip('Walk_Loop')!, jog = av.clip('Jog_Fwd_Loop')!, sprint = av.clip('Sprint_Loop')!;
    // Short steps for the stumble: the cycle turns over faster for its speed.
    const strideW = S.walk * walk.dur * (1 - 0.25 * stum);
    const stride = ww * strideW + wj * S.jog * jog.dur + ws * S.sprint * sprint.dur;
    const mw = ww + wj + ws;
    if (mw > 0.001 && stride > 1e-4) av.phase = (av.phase + (gsp * mw * dt) / stride) % 1;
    // A limp: the cycle hurries through his left foot's stance.
    const ph = (av.phase + stum * 0.06 * Math.sin(av.phase * Math.PI * 2)) % 1;
    for (const l of [walk, jog, sprint]) av.time(l.name, ((ph + l.offset) % 1) * l.dur);

    // In the air: the take-off, then the air loop; a landing.
    const airborne = !b.grounded && !b.climb && !this.carriedBy && !seatedish;
    if (airborne && this.wasGrounded && b.vy > 0.5) this.takeoff = 0;
    this.air += ((airborne ? 1 : 0) - this.air) * ease(airborne ? 12 : 16, dt);
    if (b.grounded && !this.wasGrounded) {
      const s = clamp(Math.max(b.landing, 0.25), 0, 1);
      this.dip = Math.max(this.dip, 0.04 + 0.08 * s);
      if (b.landing > 0.15 && sp < 1.2) { av.time('Jump_Land', 0.06); this.land = clamp(0.4 + b.landing, 0, 1); }
      b.landing = 0;
    }
    this.wasGrounded = b.grounded;
    this.land = Math.max(0, this.land - dt * (sp > 1 ? 4 : 1.8));
    const land = av.clip('Jump_Land')!;
    if (this.land > 0) av.time('Jump_Land', Math.min(land.dur, land.lower.time + dt * 1.25));
    let startW = 0;
    if (this.takeoff >= 0) {
      this.takeoff += dt;
      av.time('Jump_Start', Math.min(0.6, 0.22 + this.takeoff * 1.4));
      startW = 1 - sm((this.takeoff - 0.2) / 0.2);
      if (this.takeoff > 0.45 || !airborne) this.takeoff = -1;
    }
    av.time('Jump_Loop', (this.time * 0.6) % av.clip('Jump_Loop')!.dur);
    const groundW = 1 - this.air;
    const landW = this.land * 0.75 * groundW;
    const locoW = groundW * (1 - landW);
    // Pushing: the push loop over everything, stepping with his speed (held when he stands against it).
    const pw = this.pushW * groundW * (1 - seatW);
    const push = av.clip('Push_Loop')!;
    if (pw > 0.001) {
      const pr = sp > 0.05 ? sp / (SPEED.push * 2.2 * push.dur) : 0;
      this.pushPhase = (this.pushPhase + pr * dt) % 1;
      av.time('Push_Loop', ((this.pushPhase + push.offset) % 1) * push.dur);
    }
    const k = (1 - pw);
    av.weight('Idle_Loop', wi * locoW * k);
    av.weight('Walk_Loop', ww * locoW * k);
    av.weight('Jog_Fwd_Loop', wj * locoW * k);
    av.weight('Sprint_Loop', ws * locoW * k);
    av.weight('Jump_Land', landW * k);
    av.weight('Jump_Start', this.air * startW * k);
    av.weight('Jump_Loop', this.air * (1 - startW) * k);
    av.weight('Push_Loop', pw);
    // Carrying: the carry loop's arms (in step while walking, still at rest), under the one-shots.
    const carry = av.clip('Walk_Carry_Loop')!;
    const cw = this.carryW * (1 - seatW);
    let upperScale = 1 - cw;
    av.time('Walk_Carry_Loop', sp > 0.3 ? ((av.phase + carry.offset) % 1) * carry.dur : carry.dur * 0.1, 'upper');
    let shotW = 0;
    if (this.oneShot) {
      const o = this.oneShot;
      o.t += dt;
      shotW = Math.min(1, o.t / 0.12) * clamp((o.dur - o.t) / 0.15, 0, 1);
      if (o.t >= o.dur) { av.weight(o.name, 0); this.oneShot = null; shotW = 0; }
      else av.weight(o.name, 0, shotW);
      upperScale *= 1 - shotW;
    }
    // The upper body's layers. A heavy man's run: half its arm pump and lean come from the walk (same phase).
    for (const n of ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Land', 'Jump_Start', 'Jump_Loop', 'Push_Loop']) {
      const c = av.clip(n)!;
      c.upper.setEffectiveWeight(c.lower.getEffectiveWeight() * upperScale);
    }
    {
      const run = (wj + ws) * locoW * k * upperScale * 0.45;
      av.clip('Jog_Fwd_Loop')!.upper.setEffectiveWeight(wj * locoW * k * upperScale * 0.55);
      av.clip('Sprint_Loop')!.upper.setEffectiveWeight(ws * locoW * k * upperScale * 0.55);
      av.clip('Walk_Loop')!.upper.setEffectiveWeight(ww * locoW * k * upperScale + run);
      // In the air the arms come up and out less than the clip flings them.
      av.clip('Jump_Loop')!.upper.setEffectiveWeight(this.air * (1 - startW) * k * upperScale * 0.6);
      av.clip('Idle_Loop')!.upper.setEffectiveWeight((wi * locoW * k + this.air * (1 - startW) * k * 0.4) * upperScale);
    }
    av.weight('Walk_Carry_Loop', 0, cw * (1 - shotW));
    // Push: his whole body back so his hands meet what is in front of him (the clip leans a long way in).
    this.av.root.position.set(0, 0, -0.2 * pw);
    av.evaluate(dt);
    this.group.updateMatrixWorld(true);
    av.captureFeet();

    // ---------- His own posing on top of the clips.
    const left = this.D(1, 0, 0), fwd = this.D(0, 0, 1);
    const groundY = this.renderPos.y;
    this.dip = Math.max(0, this.dip - dt * 0.35);
    const dipNow = this.dip > 0 ? Math.sin(Math.min(1, (0.16 - Math.min(0.16, this.dip)) / 0.16 + 0.5) * Math.PI) * this.dip : 0;
    // Breathing; at rest a slow weight shift from foot to foot.
    const idleW = wi * locoW * (1 - pw) * (1 - seatW);
    const breath = Math.sin(this.time * (stum > 0.5 || seatW > 0.5 ? 2.6 : 1.7));
    av.turn('spine_03', left, -0.018 * breath * (1 + stum));
    const shift = Math.sin(this.time * 0.55) * idleW * (1 - stum);
    {
      const p = av.pos('pelvis');
      p.addScaledVector(left, 0.018 * shift).y -= dipNow * groundW + 0.012 * idleW * (1 - Math.abs(shift));
      av.setPos('pelvis', p);
      av.turn('pelvis', fwd, 0.035 * shift);
      av.turn('spine_01', fwd, -0.03 * shift);
    }
    // Leaning into turns at speed.
    const lean = clamp(b.turnRate * sp * 0.025, -0.22, 0.22) * groundW * (1 - seatW);
    av.turn('pelvis', fwd, -lean * 0.5);
    av.turn('spine_02', fwd, -lean * 0.5);
    // Running: a little forward lean.
    av.turn('spine_01', left, 0.06 * clamp((sp - 1.5) / 2, 0, 1));

    this.splayArms(left, fwd, 1 - this.handsW * 0.9);
    if (stum > 0.001 || stag > 0) this.stumblePose(stum, stag, left, fwd, dt, ph);
    if (cw > 0.001) this.carryPose(cw * (1 - shotW), left, fwd);
    if (this.move) this.movePose(dt, left, fwd);
    const gripW = this.handsW * (1 - seatW);
    if (gripW > 0.001) this.gripPose(gripW, left, fwd, ctx);

    // ---------- Sitting against the trunk (overrides legs, hips, spine and arms).
    if (seatW > 0.001) this.seatPose(seatW, left, fwd, this.plane, dt);

    // ---------- Feet on the ground.
    const ikW = groundW * (1 - seatW) * (this.carriedBy ? 0 : 1);
    av.footIK(ctx, dt, ikW, this.renderYaw, this.renderPos, lerp(1, 0.82, idleW));
    // Hands on something in the world go last (the hips may have settled under the feet).
    if (gripW > 0.001) this.gripArms(gripW, left, fwd);

    // ---------- Head.
    this.headPose(ctx, dt, sp, seatW, stum);

    // ---------- Hands' curl, pauldrons, skirt, sword.
    this.handCurl(dt, sp, cw, seatW, stum);
    this.pauldrons();
    this.cloth(ctx, dt, seatW);
  }
  private pushPhase = 0;

  // Arms hang clear of the cuirass and skirt (the clips are made for a slimmer body).
  private splayArms(left: THREE.Vector3, fwd: THREE.Vector3, w: number) {
    const av = this.av;
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1;
      const sh = av.pos(`upperarm_${s}`), el = av.pos(`lowerarm_${s}`);
      const d = el.clone().sub(sh).normalize();
      const down = clamp(-d.y, 0, 1);
      // How far in toward the body the elbow already is (local x).
      const out = d.dot(left) * sg;
      const ang = (0.1 - clamp(out, -0.2, 0.3) * 0.4) * down * w;
      av.turn(`upperarm_${s}`, fwd, sg * ang);
      // The forearm and fist keep outside the hips.
      const wr = av.pos(`hand_${s}`), e2 = av.pos(`lowerarm_${s}`);
      const loc = this.local(wr);
      const want = 0.27 + 0.05 * clamp((loc.z + 0.05) / 0.2, 0, 1);
      const over = want - loc.x * sg;
      if (over > 0 && loc.y < 1.05) {
        const f = wr.clone().sub(e2);
        const to = f.clone().addScaledVector(left, sg * over * 0.8);
        av.aim(`lowerarm_${s}`, f, to, w);
      }
    }
  }

  // ---------------------------------------------------------------- Hands.
  // Puts a hand's palm (or its grip) at a world point: fingers along `fingers`, palm facing `palm`; the arm by IK
  // with its elbow toward `pole`. Weighted from where the clips have it.
  private placeHand(s: Side, point: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, pole: THREE.Vector3, w: number, ref: 'palm' | 'grip' = 'palm', stretch = 0) {
    if (w <= 0.001) return;
    const av = this.av;
    const Y = fingers.clone().negate().normalize();
    const X = (s === 'l' ? palm.clone().negate() : palm.clone());
    X.addScaledVector(Y, -X.dot(Y)).normalize();
    const Z = X.clone().cross(Y).normalize();
    const qc = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const r = (ref === 'palm' ? HAND.palm : HAND.grip).clone();
    if (s === 'r') r.x = -r.x;
    const wrist = point.clone().sub(r.applyQuaternion(qc));
    const cur = av.pos(`hand_${s}`);
    const T = cur.lerp(wrist, w);
    const pl = av.bend(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`).lerp(pole.clone().normalize(), w);
    av.limb(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, T, pl, true, stretch * w);
    av.setCanon(`hand_${s}`, Y, Z, w);
  }

  // Where she sits in his hands (her feet), between his palms.
  holdPoint(out: THREE.Vector3) {
    if (!this.ready) return out.copy(this.body.pos).add(this.D(0, 1.05, 0.34));
    const a = this.palmWorld('l'), b2 = this.palmWorld('r');
    out.addVectors(a, b2).multiplyScalar(0.5);
    out.y += 0.004;
    return out;
  }
  // Where a gauntlet grips (the middle of its fist), world: for a level that puts something in his hand.
  gripPoint(side: 'left' | 'right', out: THREE.Vector3) { return this.palmWorld(side === 'left' ? 'l' : 'r', out, 'grip'); }
  private palmWorld(s: Side, out = V(), ref: 'palm' | 'grip' = 'palm') {
    const p = HAND[ref].clone(); if (s === 'r') p.x = -p.x;
    const bone = this.av.bones[`hand_${s}`];
    bone.updateWorldMatrix(true, false);
    return out.copy(p).applyQuaternion(this.av.canonFrame(`hand_${s}`)).applyMatrix4(bone.matrixWorld);
  }

  // Carrying her: both hands cupped together before his chest, palms up.
  private carryPose(w: number, left: THREE.Vector3, fwd: THREE.Vector3) {
    const av = this.av;
    const chest = av.pos('spine_03');
    const c = chest.clone().addScaledVector(fwd, 0.33).add(new THREE.Vector3(0, -0.2, 0));
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1;
      const p = c.clone().addScaledVector(left, sg * 0.07);
      const fingers = fwd.clone().addScaledVector(left, -sg * 0.45).normalize();
      this.placeHand(s, p, fingers, UP.clone(), left.clone().multiplyScalar(sg).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3), w);
    }
  }

  // Both hands gripping (a bar overhead, a crank): body leaning into it, up on his toes for a high bar.
  private gripPose(w: number, left: THREE.Vector3, fwd: THREE.Vector3, _ctx: PoseContext) {
    const av = this.av;
    const L = this.handTargets.left, R = this.handTargets.right;
    const mid = L.clone().add(R).multiplyScalar(0.5);
    const loc = this.local(mid);
    // Reach: the shoulders' height plus the arm; a high bar lifts him (straight legs, up on his toes).
    const sh = (av.pos('upperarm_l').y + av.pos('upperarm_r').y) / 2 - this.renderPos.y;
    const reachY = loc.y - sh;
    const lift = clamp(reachY - 0.42, 0, 0.13) * w;
    // A bar out of reach overhead: he steps his hips in under it (his feet stay) to close the distance.
    const under = clamp(reachY - 0.45, 0, 0.4) * clamp(loc.z - 0.12, 0, 0.3) * 1.2 * w;
    if (under > 0) { const p = av.pos('pelvis').addScaledVector(fwd, under); av.setPos('pelvis', p); }
    // Lean the spine toward the grip (forward for a crank before him).
    const pitch = clamp(Math.atan2(loc.z - 0.2, Math.max(0.25, loc.y - 0.8)) * 0.4, -0.1, 0.32) * w;
    av.turn('spine_01', left, pitch * 0.4);
    av.turn('spine_02', left, pitch * 0.35);
    av.turn('spine_03', left, pitch * 0.25 - lift * 0.6);
    // Shoulders level (the idle's weight shift lowers one).
    {
      const dl = av.pos('upperarm_l').y - av.pos('upperarm_r').y;
      av.turn('spine_02', fwd, clamp(dl / 0.43, -0.2, 0.2) * w);
    }
    // Shrug up toward a high bar.
    for (const s of ['l', 'r'] as Side[]) av.turn(`clavicle_${s}`, fwd, (s === 'l' ? 1 : -1) * clamp(reachY - 0.3, 0, 0.45) * 0.4 * w);
    if (lift > 0) {
      // Up on his toes: the feet tip toe-down (their soles then lift the ankles as far).
      const p = av.pos('pelvis'); p.y += lift; av.setPos('pelvis', p);
      for (const s of ['l', 'r'] as Side[]) av.turn(`foot_${s}`, left, Math.asin(Math.min(0.95, lift / 0.15)));
    }
  }
  private gripArms(w: number, left: THREE.Vector3, fwd: THREE.Vector3) {
    const av = this.av;
    const L = this.handTargets.left, R = this.handTargets.right;
    for (const s of ['l', 'r'] as Side[]) {
      const sg = s === 'l' ? 1 : -1;
      const T = s === 'l' ? L : R, O = s === 'l' ? R : L;
      const shp = av.pos(`upperarm_${s}`);
      const fingers = T.clone().sub(shp).normalize().addScaledVector(UP, 0.3).normalize();
      // The thumb toward the other hand: palm faces away from him round the bar.
      const across = O.clone().sub(T).normalize();
      const palm = across.clone().cross(fingers).multiplyScalar(-sg).normalize();
      const pole = left.clone().multiplyScalar(sg * 0.8).addScaledVector(UP, -0.4).addScaledVector(fwd, -0.3);
      this.placeHand(s, T, fingers, palm, pole, w, 'grip', 0.09);
    }
  }

  // His own one-shots: a shoulder barge (left shoulder first), a heave from the legs, a shove.
  private movePose(dt: number, left: THREE.Vector3, fwd: THREE.Vector3) {
    const av = this.av, m = this.move!;
    m.t += dt;
    const D = m.name === 'Shoulder' ? 0.9 : m.name === 'Lift' ? 1.3 : 0.8;
    if (m.t >= D) { this.move = null; return; }
    const t = m.t;
    const p = av.pos('pelvis');
    if (m.name === 'Shoulder') {
      // Wind up (turn away, sink), drive (lunge, left shoulder leading), recover.
      const wind = sm(t / 0.18) * (1 - sm((t - 0.18) / 0.12));
      const drive = sm((t - 0.18) / 0.12) * (1 - sm((t - 0.42) / 0.45));
      p.addScaledVector(fwd, -0.06 * wind + 0.2 * drive); p.y -= 0.06 * wind + 0.05 * drive;
      av.setPos('pelvis', p);
      av.turn('spine_01', UP, -0.25 * wind + 0.35 * drive);
      av.turn('spine_02', UP, -0.15 * wind + 0.25 * drive);
      av.turn('spine_02', left, 0.25 * drive);
      av.turn('upperarm_l', left, -0.6 * drive);
      av.turn('upperarm_l', fwd, -0.4 * drive);
    } else if (m.name === 'Lift') {
      // Down into the legs, then up with everything.
      const dip = sm(t / 0.35) * (1 - sm((t - 0.35) / 0.35));
      const drive = sm((t - 0.35) / 0.3) * (1 - sm((t - 0.75) / 0.55));
      p.y -= 0.14 * dip; p.y += 0.03 * drive;
      av.setPos('pelvis', p);
      av.turn('spine_01', left, 0.18 * dip - 0.08 * drive);
      av.turn('neck_01', left, -0.15 * drive);
    } else {
      const drive = sm(t / 0.2) * (1 - sm((t - 0.35) / 0.45));
      p.addScaledVector(fwd, 0.08 * drive); p.y -= 0.04 * drive;
      av.setPos('pelvis', p);
      av.turn('spine_01', left, 0.15 * drive);
    }
  }

  // ---------------------------------------------------------------- The wounded stumble and the stagger.
  private stumblePose(w: number, stag: number, left: THREE.Vector3, fwd: THREE.Vector3, dt: number, ph: number) {
    const av = this.av;
    // An occasional lurch.
    this.lurchT -= dt;
    if (this.lurchT <= 0 && this.spd > 0.2) { this.lurchT = 3.5 + 3 * Math.random(); this.lurch = 1; }
    this.lurch = Math.max(0, this.lurch - dt * 1.6);
    const lurch = Math.sin(Math.min(1, 1 - this.lurch) * Math.PI) * w;
    // Step rhythm: his weak left side dips when he stands on it.
    const stepL = Math.max(0, Math.cos(ph * Math.PI * 2)), stepR = Math.max(0, -Math.cos(ph * Math.PI * 2));
    const moving = clamp(this.spd / 0.4, 0, 1);
    const sway = (0.05 * stepL - 0.025 * stepR) * moving;
    const t = this.time;
    // Hips: lower, dropping on the left; buckling in a stagger (the feet stay, so the knees give).
    {
      const p = av.pos('pelvis');
      p.y -= (0.035 + 0.02 * stepL * moving + 0.03 * lurch) * w + 0.13 * stag;
      p.addScaledVector(fwd, 0.05 * stag);
      av.setPos('pelvis', p);
      av.turn('pelvis', fwd, -(0.04 + sway) * w);
    }
    // The catching step: his left foot forward as he buckles, back under him as he straightens.
    if (this.staggerT >= 0) {
      const t = this.staggerT;
      const out = sm((t - 0.12) / 0.3) * (1 - sm((t - 1.05) / 0.45));
      const lift = Math.max(0, Math.sin(clamp((t - 0.12) / 0.3, 0, 1) * Math.PI)) * 0.07 + Math.max(0, Math.sin(clamp((t - 1.05) / 0.45, 0, 1) * Math.PI)) * 0.05;
      av.moveFoot(0, fwd.clone().multiplyScalar(0.26 * out).addScaledVector(left, 0.05 * out).add(new THREE.Vector3(0, lift, 0)));
    }
    // Hunched forward and leaning left toward the wound.
    const hunch = (0.2 + 0.08 * lurch) * w + 0.3 * stag;
    const roll = (0.07 + sway) * w + 0.12 * stag * Math.sin(this.staggerT * 9);
    for (const [n, f] of [['spine_01', 0.3], ['spine_02', 0.35], ['spine_03', 0.35]] as [string, number][]) {
      av.turn(n, left, hunch * f);
      av.turn(n, fwd, -roll * f);
    }
    av.turn('spine_03', UP, (0.1 + 0.03 * Math.sin(t * 0.7)) * w);
    // Left arm: limp from the shoulder, swinging a little with his steps.
    {
      const sh = av.pos('upperarm_l'), el = av.pos('lowerarm_l');
      const swing = (0.12 * Math.sin(ph * Math.PI * 2 + 0.6) * moving + 0.25 * stag);
      const down = UP.clone().negate().addScaledVector(fwd, 0.1 + swing).addScaledVector(left, 0.17).normalize();
      av.aim('upperarm_l', el.clone().sub(sh), down, w);
      const el2 = av.pos('lowerarm_l'), wr = av.pos('hand_l');
      const fdown = down.clone().addScaledVector(fwd, 0.22).normalize();
      av.aim('lowerarm_l', wr.sub(el2), fdown, w);
      av.turn('clavicle_l', fwd, -0.12 * w);
    }
    // Right hand pressed to the wound under the spear; flung out for balance in a stagger.
    {
      const press = w * (1 - sm(stag * 1.6));
      const chest = 'spine_02';
      const pt = this.chestPoint(chest, PRESS.phi, PRESS.y, 0.006);
      const n = this.chestPoint(chest, PRESS.phi, PRESS.y, 0.1).sub(pt).normalize();
      const fingers = this.chestDir(chest, PRESS.fx, PRESS.fy, 0.15).normalize();
      this.placeHand('r', pt, fingers, n.clone().negate(), left.clone().multiplyScalar(-0.7).addScaledVector(UP, -0.6).addScaledVector(fwd, 0.1), press);
      if (stag > 0) {
        const out = this.L(-0.55, 0.95, 0.35);
        this.placeHand('r', out, this.D(-0.6, -0.5, 0.4).normalize(), this.D(0, -1, 0.3).normalize(), this.D(-0.3, -1, -0.5), sm(stag * 1.6));
      }
    }
    // Head low, swaying (the neck keeps it nearer upright than the body).
    av.turn('neck_01', left, (0.1 + 0.05 * lurch) * w + 0.08 * stag);
    av.turn('Head', left, 0.08 * w);
    av.turn('Head', UP, (-0.06 + 0.08 * Math.sin(t * 0.9)) * w);
    av.turn('Head', fwd, (0.06 + 0.05 * Math.sin(t * 1.3 + 1)) * w);
  }

  // A point on (or off) the cuirass (round from the front toward his left by phi, at a height at rest), where the
  // chest bone has it now.
  private chestPoint(bone: string, phi: number, y: number, outward: number) {
    const v = cuirassPoint(phi, y, outward).sub(this.av.restP.get(bone)!);
    const bn = this.av.bones[bone];
    bn.updateWorldMatrix(true, false);
    return v.applyQuaternion(this.av.canonFrame(bone)).applyMatrix4(bn.matrixWorld);
  }
  private chestDir(bone: string, x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this.av.quat(bone).multiply(this.av.canonFrame(bone)));
  }

  // ---------------------------------------------------------------- Sitting against the trunk.
  private seatPose(W: number, left: THREE.Vector3, fwd: THREE.Vector3, ground: (x: number, z: number) => number, _dt: number) {
    const av = this.av, u = this.u;
    const gAt = (p: THREE.Vector3) => ground(p.x, p.z);
    // Keyframes along the slide (u): standing with his back to the trunk, sliding down it, sat.
    const k1 = sm(u / 0.75), k2 = sm((u - 0.65) / 0.35);
    const back = this.backRest;
    // Hips: down the trunk and a little out from it; the seat height is found below (nothing under the ground).
    let hipY = lerp(0.79, 0.3, sm((u - 0.05) / 0.65)) - 0.16 * k2 + this.seatLift * k2;
    const hipZ = lerp(-back + 0.17, -0.02, sm(u / 0.9));
    const tilt = -0.32 * k2 - 0.05 * k1; // pelvis rolled back
    // Torso leaning back to the trunk: solved so his upper back just meets it.
    const reach = 0.36, depth = 0.15;
    let leanB = 0.05;
    for (let i = 0; i < 6; i++) {
      const z = hipZ - depth * Math.cos(leanB) - reach * Math.sin(leanB);
      leanB = clamp(leanB + (z + back) * 1.6, 0, 0.5);
    }
    const slump = 0.18 * k2; // shoulders rounding forward
    // Pelvis.
    const pel = this.L(0, hipY, hipZ);
    const frame = (pitch: number, roll = 0, yaw = 0) => {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, this.renderYaw + yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
      return { y: UP.clone().applyQuaternion(q), z: new THREE.Vector3(0, 0, 1).applyQuaternion(q) };
    };
    const blendPos = (name: string, p: THREE.Vector3) => { av.setPos(name, av.pos(name).lerp(p, W)); };
    const breathe = Math.sin(this.time * 1.9) * 0.012;
    let f = frame(tilt);
    av.setCanon('pelvis', f.y, f.z, W);
    blendPos('pelvis', pel);
    f = frame(-leanB, 0.04 * k2); av.setCanon('spine_01', f.y, f.z, W);
    f = frame(-leanB, 0.05 * k2); av.setCanon('spine_02', f.y, f.z, W);
    f = frame(-leanB + slump + breathe, 0.06 * k2, -0.05 * k2); av.setCanon('spine_03', f.y, f.z, W);
    // His back against the trunk: the cuirass's back at the shoulder blades just meets it.
    for (let i = 0; i < 2; i++) {
      const bp = this.local(this.chestPoint('spine_02', Math.PI, 1.17, 0));
      const s1 = this.local(av.pos('spine_01'));
      const err = bp.z - (-back + 0.016);
      const ang = clamp(Math.atan2(err, Math.max(0.15, bp.y - s1.y)), -0.3, 0.4) * W;
      av.turn('spine_01', left, -ang);
    }
    // Head: on his chest, slumped forward and over to his right, away from the spear (lifted by headUp, below);
    // never back into the bark.
    const hd = (0.18 + 0.2 * k2) * (1 - this.headUpNow);
    const hr = (0.06 + 0.22 * k2) * (1 - this.headUpNow);
    f = frame(0.1 * k1 + hd * 0.5, hr * 0.5, -0.1 * k2); av.setCanon('neck_01', f.y, f.z, W);
    f = frame(0.1 * k1 + hd + 0.06, hr, -0.2 * k2 * (1 - this.headUpNow)); av.setCanon('Head', f.y, f.z, W);
    {
      const hz = Math.min(...[1.39, 1.47, 1.56].map((y) => this.local(this.helmPoint(Math.PI, y)).z));
      const over = -back + 0.02 - hz;
      if (over > 0) av.turn('neck_01', left, Math.min(0.5, over / 0.12) * W);
    }
    av.turn('clavicle_l', fwd, -0.1 * W);

    // No floating: the seat (the lowest of the hips' and thighs' undersides) comes down to the ground.
    if (k2 > 0) {
      const low = this.lowest(['hips']);
      const pp = av.pos('pelvis');
      const drop = (low - ground(pp.x, pp.z) - 0.004) * k2;
      const p = av.pos('pelvis'); p.y -= drop; av.setPos('pelvis', p);
    }

    // Legs: feet slide out as he goes down; sat, both lie stretched out along the ground a little apart, the knees
    // only just bent (never above his lap), the boots on their heels with the toes fallen outward.
    const feet: Record<Side, { p: THREE.Vector3; pole: THREE.Vector3; toeUp: number; out: number }> = {
      l: { p: new THREE.Vector3(lerp(0.12, 0.15, k2), 0, lerp(lerp(-back + 0.2, 0.42, k1), SEAT_FEET.l, k2)), pole: new THREE.Vector3(0.2, 1, 0.5), toeUp: k2, out: 0.35 * k2 },
      r: { p: new THREE.Vector3(lerp(-0.12, -0.15, k2), 0, lerp(lerp(-back + 0.17, 0.4, k1), SEAT_FEET.r, k2)), pole: new THREE.Vector3(-0.2, 1, 0.5), toeUp: k2, out: -0.35 * k2 },
    };
    for (const s of ['l', 'r'] as Side[]) {
      const F = feet[s];
      // Foot orientation: flat, or (stretched out) resting on its heel with the toe fallen outward.
      const pitch = -1.25 * F.toeUp;
      const fq = new THREE.Quaternion().setFromAxisAngle(UP, this.renderYaw + F.out)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (s === 'l' ? -1 : 1) * 0.3 * F.toeUp));
      const fy = UP.clone().applyQuaternion(fq), fz = new THREE.Vector3(0, 0, 1).applyQuaternion(fq);
      // The ankle's height so that the boot rests on the ground in that orientation.
      const ank = this.L(F.p.x, 0, F.p.z);
      const sole = this.bootLow(s, fq);
      ank.y = gAt(ank) - sole + 0.006;
      const cur = av.pos(`foot_${s}`);
      const T = cur.lerp(ank, W);
      const pole = this.D(F.pole.x, F.pole.y, F.pole.z);
      av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, T, pole.lerp(av.bend(`thigh_${s}`, `calf_${s}`, `foot_${s}`), 1 - W));
      av.setCanon(`foot_${s}`, fy, fz, W);
      av.setCanon(`ball_${s}`, fy, fz, W);
      // Part way (the clip's foot turned toward this one), the boot as it is now must still clear the ground.
      if (W < 0.999) {
        const qa = av.quat(`foot_${s}`).multiply(av.fromCanon.get(`foot_${s}`)!.clone().invert());
        const a = av.pos(`foot_${s}`);
        const need = gAt(a) - this.bootLow(s, qa) + 0.004 - a.y;
        if (need > 0) {
          const fq2 = av.quat(`foot_${s}`), bq2 = av.quat(`ball_${s}`);
          av.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, a.add(new THREE.Vector3(0, need, 0)), av.bend(`thigh_${s}`, `calf_${s}`, `foot_${s}`));
          av.setQuat(av.bones[`foot_${s}`], fq2); av.setQuat(av.bones[`ball_${s}`], bq2);
        }
      }
    }

    // Arms. Right: pressed to the wound (restHand: off it, down on the ground at his right side).
    const lapL = this.lapRest;
    {
      const rw = sm(this.restNow);
      const pt = this.chestPoint('spine_02', PRESS.phi, PRESS.y, 0.006);
      const n = this.chestPoint('spine_02', PRESS.phi, PRESS.y, 0.1).sub(pt).normalize();
      const fingers = this.chestDir('spine_02', PRESS.fx, PRESS.fy, 0.15).normalize();
      // The elbow tucked back and down at his side, clear of what is in his lap.
      this.placeHand('r', pt, fingers, n.clone().negate(), this.D(-0.8, -0.5, -0.45), W * (1 - rw));
      if (rw > 0.001) {
        const g = this.L(-0.38, 0, 0.0); g.y = gAt(g) + 0.05;
        this.placeHand('r', g, this.D(-0.3, -0.25, 0.9).normalize(), this.D(0, -1, 0), this.D(-0.9, 0.1, -0.5), W * rw);
      }
    }
    // Left: down on the ground beside his left hip, palm down; shelter: up and over what is in his lap from his left,
    // cupped like a roof over her back (the palm's middle at shelterAt, by default above the lap point).
    {
      const p = this.L(0.33, 0, lerp(-back + 0.3, -0.03, k1)); p.y = gAt(p) + 0.05;
      this.placeHand('l', p, this.D(0.25, -0.2, 0.95).normalize(), this.D(0, -1, 0), this.D(0.9, 0.1, -0.6), W * sm((u - 0.15) / 0.5));
      const sw = this.shelterNow;
      if (sw > 0.001) {
        const at = this.shelterAt ?? lapL.clone().add(SHELTER);
        const wp = this.L(at.x, at.y, at.z);
        // Fingers across her toward his right and a little forward, palm down and turned in a touch (cupped).
        this.placeHand('l', wp, this.D(-0.8, -0.22, 0.45).normalize(), this.D(-0.3, -1, 0).normalize(), this.D(0.9, -0.1, -0.3), W * sm(sw));
      }
    }
  }

  // His parts as made: the vertex ranges of the three skinned meshes and their rest positions on their bones.
  private parts(f: (p: Part) => boolean) { return this.m.parts.filter(f); }
  private partsOn(bone: string) { const b = this.av.bones[bone]; return this.m.parts.filter((p) => p.bone === b && p.local); }
  // A few of a part's vertices (bone space): its lowest fifth at rest (the underside: a seat, a sole), at most 80;
  // or (all) up to 160 spread over it.
  private sampleCache = new Map<Part, THREE.Vector3[]>();
  private allCache = new Map<Part, THREE.Vector3[]>();
  private samples(part: Part, all = false) {
    const cache = all ? this.allCache : this.sampleCache;
    let s = cache.get(part);
    if (!s) {
      const L = part.local!, n = L.length / 3;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]));
      if (all) { const step = Math.max(1, Math.floor(n / 160)); s = pts.filter((_, i) => i % step === 0); }
      else {
        // Lowest in the character's frame at rest (the bone's rest rotation applied).
        const q = this.av.restQ.get(part.bone.name);
        const h = (v: THREE.Vector3) => (q ? v.clone().applyQuaternion(q).y : v.y);
        pts.sort((a, b) => h(a) - h(b));
        const low = pts.slice(0, Math.max(8, Math.floor(n / 5)));
        const step = Math.max(1, Math.floor(low.length / 80));
        s = low.filter((_, i) => i % step === 0);
      }
      cache.set(part, s);
    }
    return s;
  }
  // The lowest point (world y) of the parts named, from a few of their vertices.
  private lowest(names: string[]) {
    let low = Infinity;
    const v = V();
    for (const part of this.parts((p) => names.includes(p.name) && !!p.local)) {
      part.bone.updateWorldMatrix(true, false);
      for (const p of this.samples(part)) { v.copy(p).applyMatrix4(part.bone.matrixWorld); if (v.y < low) low = v.y; }
    }
    return low;
  }
  // How far below the ankle the boot reaches when its canonical frame has world rotation q (foot and toe alike).
  private bootLow(s: Side, q: THREE.Quaternion) {
    let low = 0;
    const v = V();
    for (const bn of [`foot_${s}`, `ball_${s}`]) {
      const qb = q.clone().multiply(this.av.fromCanon.get(bn)!);
      // The toe's joint from the ankle, at rest (canonical = character axes for the legs).
      const off = bn.startsWith('ball') ? this.av.restP.get(bn)!.clone().sub(this.av.restP.get(`foot_${s}`)!).applyQuaternion(q) : new THREE.Vector3();
      for (const part of this.partsOn(bn)) for (const p of this.samples(part, true)) { v.copy(p).applyQuaternion(qb).add(off); if (v.y < low) low = v.y; }
    }
    return low;
  }

  // The boots' soles: a few points round each sole (heel, ball, toe), in their bones' frames.
  private sole: { bone: string; pts: THREE.Vector3[] }[][] = [];
  private soles() {
    for (const s of ['l', 'r'] as Side[]) {
      const list: { bone: string; pts: THREE.Vector3[] }[] = [];
      for (const bn of [`foot_${s}`, `ball_${s}`]) {
        const bone = this.av.bones[bn];
        bone.updateWorldMatrix(true, false);
        // The lowest in each of a grid of cells under the sole (world, with him standing at rest).
        const cells = new Map<string, { w: THREE.Vector3; l: THREE.Vector3 }>();
        for (const part of this.partsOn(bn)) {
          const L = part.local!;
          for (let j = 0; j < L.length; j += 3) {
            const l = new THREE.Vector3(L[j], L[j + 1], L[j + 2]);
            const w = l.clone().applyMatrix4(bone.matrixWorld).sub(this.group.position);
            const key = `${Math.round(w.x / 0.04)},${Math.round(w.z / 0.05)}`;
            const c = cells.get(key);
            if (!c || w.y < c.w.y) cells.set(key, { w, l });
          }
        }
        // Its corners: the furthest back, front, left and right of the low points.
        const low = [...cells.values()].filter((c) => c.w.y < 0.03);
        const pick = (f: (c: THREE.Vector3) => number) => low.reduce((a, c) => (f(c.w) > f(a.w) ? c : a), low[0]);
        const ends = new Set([pick((c) => c.z), pick((c) => -c.z), pick((c) => c.x + c.z * 0.3), pick((c) => -c.x + c.z * 0.3), pick((c) => c.x - c.z * 0.3), pick((c) => -c.x - c.z * 0.3)]);
        list.push({ bone: bn, pts: [...ends].map((c) => c.l.clone()) });
      }
      this.sole.push(list);
    }
  }
  private soleLift(i: number, ankle: THREE.Vector3, ground: (x: number, z: number) => number) {
    const s = i === 0 ? 'l' : 'r';
    const a0 = this.av.pos(`foot_${s}`);
    let lift = 0;
    const v = V();
    for (const part of this.sole[i]) {
      const b = this.av.bones[part.bone];
      b.updateWorldMatrix(true, false);
      for (const p of part.pts) {
        v.copy(p).applyMatrix4(b.matrixWorld).sub(a0).add(ankle);
        const need = ground(v.x, v.z) + 0.004 - v.y;
        if (need > lift) lift = need;
      }
    }
    return Math.min(lift, 0.12);
  }

  // A point on the helm's surface (round from the front, height at rest), where the head has it now.
  private helmPoint(phi: number, y: number) {
    const v = new THREE.Vector3(Math.sin(phi) * 0.18, y, Math.cos(phi) * 0.18 * 1.05 + 0.012).sub(this.av.restP.get('Head')!);
    const bn = this.av.bones.Head;
    bn.updateWorldMatrix(true, false);
    return v.applyQuaternion(this.av.canonFrame('Head')).applyMatrix4(bn.matrixWorld);
  }

  // ---------------------------------------------------------------- Head.
  private headPose(ctx: PoseContext, dt: number, sp: number, seatW: number, stum: number) {
    const av = this.av;
    if (seatW > 0.01) {
      // Seated: from his chest up toward what he looks at.
      const tgt = this.lookTarget;
      const hu = this.headUpNow * seatW;
      if (tgt && hu > 0.001) {
        const hp = av.pos('Head');
        const d = tgt.clone().sub(hp);
        const fwdNow = this.av.axis('Head', new THREE.Vector3(0, 0, 1));
        const q = new THREE.Quaternion().setFromUnitVectors(fwdNow.normalize(), d.normalize());
        // Neck and head share the turn.
        const ident = new THREE.Quaternion();
        for (const [n, f] of [['neck_01', 0.4], ['Head', 0.6]] as [string, number][]) {
          const part = ident.clone().slerp(q, f * hu);
          const wq = av.quat(n);
          av.setQuat(av.bones[n], part.multiply(wq));
        }
      }
      return;
    }
    let target: THREE.Vector3 | null = this.lookTarget ?? null;
    if (!target && ctx.lookAt && sp < 1.5 && stum < 0.5 && !this.hands && this.oneShot === null && this.staggerT < 0) {
      const d = ctx.lookAt.distanceTo(this.renderPos);
      if (d < 8) target = ctx.lookAt;
    }
    // Gaze kept near level whatever the body does (a runner's head stays steady), less so stumbling.
    const keep = this.handsW > 0.5 ? 0.3 : 1;
    if (keep > 0.01) {
      const f = av.axis('Head', new THREE.Vector3(0, 0, 1));
      const down = Math.asin(clamp(-f.y, -1, 1));
      const left = this.D(1, 0, 0);
      // Wounded, it hangs lower (and lower still as he buckles).
      const stagW = this.staggerT >= 0 ? stagCurve(this.staggerT) : 0;
      const want = 0.04 + 0.3 * stum + 0.12 * stagW + 0.06 * stum * Math.sin(this.time * 1.1);
      const corr = (want - down) * 0.75 * keep;
      av.turn('neck_01', left, corr * 0.5);
      av.turn('Head', left, corr * 0.5);
      // And upright.
      const u = av.axis('Head', new THREE.Vector3(0, 1, 0));
      const roll = Math.asin(clamp(u.dot(left), -1, 1));
      av.turn('Head', this.D(0, 0, 1), roll * 0.6 * keep);
    }
    av.look(target, this.renderYaw, dt, { maxYaw: 1.1, maxUp: 0.4, maxDown: 0.3 });
  }

  // ---------------------------------------------------------------- Fingers.
  private handCurl(dt: number, sp: number, cw: number, seatW: number, stum: number) {
    for (let i = 0; i < 2; i++) {
      const s: Side = i === 0 ? 'l' : 'r';
      let c = lerp(0.42, 0.62, clamp(sp / 3, 0, 1));
      c = lerp(c, 0.08, cw);
      c = lerp(c, 0.05, this.pushW);
      c = lerp(c, 0.82, this.handsW);
      if (s === 'r') c = lerp(c, 0.06, stum * (1 - this.handsW));
      if (s === 'l') c = lerp(c, 0.3, stum);
      if (seatW > 0) {
        const seatC = s === 'r' ? lerp(0.06, 0.15, this.restNow) : lerp(0.15, 0.42, this.shelterNow);
        c = lerp(c, seatC, seatW);
      }
      if (this.oneShot) c = lerp(c, 0.5, 0.5);
      this.curl[i] += (c - this.curl[i]) * ease(10, dt);
      const v = clamp(this.curl[i], 0, 1);
      const inf = v < 0.5 ? [v * 2, 0] : [2 - v * 2, v * 2 - 1];
      for (const mm of [this.m.steel, this.m.blood]) { mm.morphTargetInfluences![i * 2] = inf[0]; mm.morphTargetInfluences![i * 2 + 1] = inf[1]; }
    }
  }

  // Pauldrons: on the collar bones, turning halfway with the upper arms.
  private pauldrons() {
    for (const p of this.m.pauldrons) {
      const qc = this.av.quat(`clavicle_${p.side}`).multiply(p.relC);
      const qu = this.av.quat(`upperarm_${p.side}`).multiply(p.relU);
      const q = qc.slerp(qu, 0.45);
      const pos = this.av.pos(`upperarm_${p.side}`).add(p.off.clone().applyQuaternion(q));
      const cl = this.av.bones[`clavicle_${p.side}`];
      cl.updateWorldMatrix(true, false);
      const inv = cl.matrixWorld.clone().invert();
      p.mesh.position.copy(pos).applyMatrix4(inv);
      p.mesh.quaternion.copy(this.av.quat(`clavicle_${p.side}`).invert().multiply(q));
    }
  }

  // ---------------------------------------------------------------- Skirt panels and the sword.
  private cloth(ctx: PoseContext, dt: number, seatW: number) {
    const av = this.av;
    const pel = av.bones.pelvis;
    pel.updateWorldMatrix(true, false);
    const pw = av.pos('pelvis');
    // The hips' motion (for the panels' sway).
    const vel = pw.clone().sub(this.lastPelvis).divideScalar(dt);
    if (this.lastPelvis.lengthSq() === 0 || vel.length() > 30) vel.set(0, 0, 0);
    const acc = vel.clone().sub(this.pelvisVel).divideScalar(dt);
    this.pelvisVel.lerp(vel, ease(10, dt));
    this.lastPelvis.copy(pw);
    const holder = this.m.skirtHolder;
    holder.updateWorldMatrix(true, false);
    const toH = holder.matrixWorld.clone().invert();
    const hq = holder.getWorldQuaternion(new THREE.Quaternion());
    const hqi = hq.clone().invert();
    const accL = acc.clone().applyQuaternion(hqi);
    const gH = new THREE.Vector3(0, -1, 0).applyQuaternion(hqi); // down, in the pelvis frame
    // The legs as points just outside their surfaces (thigh, knee, shin), in the pelvis frame.
    const pts: THREE.Vector3[] = [];
    for (const s of ['l', 'r'] as Side[]) {
      const th = av.pos(`thigh_${s}`), kn = av.pos(`calf_${s}`), an = av.pos(`foot_${s}`);
      const kf = av.axis(`calf_${s}`, new THREE.Vector3(0, 0, 1)), tf = av.axis(`thigh_${s}`, new THREE.Vector3(0, 0, 1));
      const tx = av.axis(`thigh_${s}`, new THREE.Vector3(1, 0, 0)), kx = av.axis(`calf_${s}`, new THREE.Vector3(1, 0, 0));
      const add = (p: THREE.Vector3) => pts.push(p.applyMatrix4(toH));
      for (const t of [0.3, 0.6, 0.85]) {
        const r = 0.095 - 0.02 * t, c = th.clone().lerp(kn, t);
        add(c.clone().addScaledVector(tf, r)); add(c.clone().addScaledVector(tf, -r));
        add(c.clone().addScaledVector(tx, r)); add(c.clone().addScaledVector(tx, -r));
      }
      add(kn.clone().addScaledVector(kf, 0.085)); add(kn.clone().addScaledVector(kf, -0.08));
      add(kn.clone().addScaledVector(kx, 0.08)); add(kn.clone().addScaledVector(kx, -0.08));
      for (const t of [0.3, 0.6]) {
        const c = kn.clone().lerp(an, t);
        add(c.clone().addScaledVector(kf, 0.085)); add(c.clone().addScaledVector(kf, -0.085));
        add(c.clone().addScaledVector(kx, 0.085)); add(c.clone().addScaledVector(kx, -0.085));
      }
    }
    // The angle (outward from hanging) a part from `o` must swing to to keep the points within `len` of it outside.
    // Sat, the panels lie close on his thighs (a flat lap); walking, they keep clear of the legs' swing.
    const margin = lerp(0.07, 0.012, seatW);
    const need = (p: Panel, o: THREE.Vector3, len: number, rest: number) => {
      let a = -Infinity;
      const dn = gH;
      for (const q of pts) {
        const d = q.clone().sub(o);
        if (Math.abs(d.dot(p.axis)) > p.half + 0.015) continue;
        const dl = d.length();
        if (dl > len + 0.05 || dl < 0.02) continue;
        a = Math.max(a, Math.atan2(d.dot(p.n), d.dot(dn)) + margin - rest);
      }
      return a;
    };
    // Downhill in the pelvis frame turns into a swing angle (the panels hang plumb when the hips tilt).
    const plumb = (p: Panel) => Math.atan2(gH.dot(p.n), -gH.y);
    const wind = WIND.gust * 0.12;
    // Sat still: the skirt as it was last settled (nothing under it has moved).
    const hp = av.pos('pelvis'), hqq = av.quat('pelvis');
    const settled = seatW > 0.99 && this.u >= 0.999 && this.clothKey.p.distanceTo(hp) < 0.002 && this.clothKey.q.angleTo(hqq) < 0.01 && wind < 0.01;
    this.clothKey.p.copy(hp); this.clothKey.q.copy(hqq);
    for (const p of this.m.panels) {
      if (settled) break;
      const sway = clamp(-accL.dot(p.n) * 0.012, -0.15, 0.25) + wind * (0.5 + 0.5 * Math.sin(this.time * 7 + p.phi * 3));
      const hang = plumb(p);
      // Upper part: over the top of the thigh.
      const n1 = Math.max(0, need(p, p.pivot, p.len1, p.b1));
      const t1 = Math.max(n1, hang * 0.6 + sway * 0.5);
      p.v1 += ((t1 - p.a1) * 120 - p.v1 * 14) * dt;
      p.a1 += p.v1 * dt;
      if (p.a1 < n1) { p.a1 = n1; p.v1 = Math.max(0, p.v1); }
      // Lower part: from the hinge, hanging unless the knee or shin push it out.
      const H = p.hinge.clone().applyAxisAngle(p.axis, p.a1).add(p.pivot);
      const n2 = need(p, H, p.len2, p.b2);
      const t2 = Math.max(n2, hang + sway, p.a1 - 0.9);
      p.v2 += ((t2 - p.a2) * 80 - p.v2 * 10) * dt;
      p.a2 += p.v2 * dt;
      if (p.a2 < n2) { p.a2 = n2; p.v2 = Math.max(0, p.v2); }
      // Sat on the ground, the skirt's sides and back bunch up under and round him.
      p.lower.scale.set(1, 1 - (Math.abs(p.phi) > 0.9 ? 0.5 : 0.15) * seatW, 1);
      this.panelAboveGround(p, holder, this.plane, seatW);
      p.upper.quaternion.setFromAxisAngle(p.axis, p.a1);
      p.lower.quaternion.setFromAxisAngle(p.axis, p.a2 - p.a1);
    }
    // The scabbard: hanging back from the hip, swinging clear of the thigh; laid on the ground beside him seated.
    const sc = this.m.scabbard;
    const thL = av.pos('thigh_l').applyMatrix4(toH), knL = av.pos('calf_l').applyMatrix4(toH);
    const sd = knL.clone().sub(thL).normalize();
    const back = Math.max(0, -sd.z);
    const tgt = clamp(back * 0.5 - 0.08, 0, 0.3);
    this.scab.vel += ((tgt - this.scab.ang) * 60 - this.scab.vel * 9 + clamp(accL.z * 0.5, -3, 3)) * dt;
    this.scab.ang = clamp(this.scab.ang + this.scab.vel * dt, -0.25, 0.4);
    const hang = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.78 + this.scab.ang, 0, 0.1));
    if (seatW > 0.001) {
      // Lying along his left leg, a hand's width outside it, tip toward his feet, flat side up.
      const k = sm((this.u - 0.62) / 0.33) * seatW;
      if (k > 0) {
        const throat = this.L(0.56, 0, 0.2); throat.y = this.plane(throat.x, throat.z) + 0.045;
        const tipP = this.L(0.56 + 0.1 * 0.6, 0, 0.2 + 0.99 * 0.6); tipP.y = this.plane(tipP.x, tipP.z) + 0.035;
        const tip = tipP.sub(throat).normalize(); // down the scabbard (its -Y), along the ground
        const Y = tip.clone().negate(), X = UP.clone().addScaledVector(Y, -UP.dot(Y)).normalize(), Z = X.clone().cross(Y).normalize();
        const qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
        const ql = hqi.clone().multiply(qw);
        hang.slerp(ql, k);
        const pl = throat.applyMatrix4(toH);
        sc.position.copy(this.scabRest).lerp(pl, k);
      } else sc.position.copy(this.scabRest);
    } else sc.position.copy(this.scabRest);
    sc.quaternion.copy(hang);
    // Never into the ground (sitting down, a step): its tip swings out to his side until it clears.
    sc.updateMatrixWorld(true);
    const tipY = (q: THREE.Quaternion) => {
      sc.quaternion.copy(q); sc.updateMatrixWorld(true);
      let y = Infinity;
      for (const p of SCAB_PTS) { const w = p.clone().applyMatrix4(sc.matrixWorld); y = Math.min(y, w.y - this.plane(w.x, w.z)); }
      return y - 0.012;
    };
    if (tipY(hang) < 0) {
      const outAxis = new THREE.Vector3(0, 0, 1); // pelvis frame: about his forward axis, tip outward to his left
      const at = (a: number) => new THREE.Quaternion().setFromAxisAngle(outAxis, a).multiply(hang);
      let lo = 0, hi = 1.45;
      if (tipY(at(hi)) < 0) lo = hi;
      else for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (tipY(at(mid)) < 0) lo = mid; else hi = mid; }
      sc.quaternion.copy(at(hi));
    }
  }
  private scabRest = new THREE.Vector3();
  private clothKey = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

  // Never into the ground: the lower part swings out (and the upper too if it must), measured on the skinned
  // vertices themselves.
  private panelAboveGround(p: Panel, _holder: THREE.Object3D, ground: (x: number, z: number) => number, seatW: number) {
    const sk = this.m.cloth, v = V();
    const low = (a1: number, a2: number) => {
      p.upper.quaternion.setFromAxisAngle(p.axis, a1);
      p.lower.quaternion.setFromAxisAngle(p.axis, a2 - a1);
      p.upper.updateMatrixWorld(true);
      let y = Infinity;
      for (const i of p.samples) { sk.getVertexPosition(i, v).applyMatrix4(sk.matrixWorld); const d = v.y - ground(v.x, v.z); if (d < y) y = d; }
      return y - 0.018;
    };
    sk.updateMatrixWorld();
    const now = low(p.a1, p.a2);
    if (now >= 0 || (seatW < 0.01 && now > -0.001)) return;
    const solve = (f: (a: number) => number, a0: number, hi: number) => {
      if (f(hi) < 0) return hi;
      let lo = a0;
      for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
      return hi;
    };
    // The lower part first; if even flat out it cannot clear, the upper lifts as well.
    const top2 = p.a1 + 1.9;
    if (low(p.a1, top2) < 0) { p.a1 = solve((a) => low(a, a + 1.9), p.a1, Math.PI * 0.6); p.v1 = Math.max(0, p.v1); }
    p.a2 = solve((a) => low(p.a1, a), p.a2, p.a1 + 1.9); p.v2 = Math.max(0, p.v2);
  }

  // ---------------------------------------------------------------- What the level asks of him.
  // The point on top of his lap (his left thigh, near the hip) where she can sit, seated: measured from his posed
  // meshes (straight down onto them).
  lapPoint(out: THREE.Vector3) {
    if (this.ready && this.u > 0.999) return this.L(0, 0, 0, out).copy(this.measureLap()).applyQuaternion(this.yawQ).add(this.renderPos);
    return this.L(this.lapRest.x, this.lapRest.y, this.lapRest.z, out);
  }
  // Straight down onto his posed thighs and skirt (their triangles as the skeleton has them now).
  private lapTris() {
    const tris: THREE.Vector3[][] = [];
    for (const part of this.parts((p) => p.name === 'thigh_l' || p.name === 'thigh_r' || p.name === 'skirt')) {
      const mesh = part.mesh, ind = mesh.geometry.index!.array, w = mesh.matrixWorld;
      for (let t = 0; t < ind.length; t += 3) {
        const i0 = ind[t];
        if (i0 < part.start || i0 >= part.start + part.count) continue;
        tris.push([0, 1, 2].map((k) => mesh.getVertexPosition(ind[t + k], V()).applyMatrix4(w)));
      }
    }
    return tris;
  }
  // The top of his lap (local height) at local (x, z), or null where there is none.
  lapSurface(x: number, z: number, tris = (this.group.updateMatrixWorld(true), this.lapTris())) {
    const ray = new THREE.Ray(this.L(x, 1.2, z), new THREE.Vector3(0, -1, 0)), hit = V();
    let t = -Infinity;
    for (const [a, b, c] of tris) if (ray.intersectTriangle(a, b, c, false, hit)) t = Math.max(t, hit.y);
    return Number.isFinite(t) ? t - this.renderPos.y : null;
  }
  // Her seat bridges both thighs: the highest of his lap (thighs, skirt) under her footprint, so nothing of his
  // rises into her from below.
  private measureLap() {
    this.group.updateMatrixWorld(true);
    const tris = this.lapTris();
    this.lapTops = [];
    let top = -Infinity;
    for (const dx of [-0.08, 0, 0.08]) for (const dz of [-0.07, 0, 0.07]) {
      const t = this.lapSurface(LAP.x + dx, LAP.z + dz, tris);
      this.lapTops.push(t === null ? NaN : +t.toFixed(3));
      if (t !== null) top = Math.max(top, t);
    }
    return new THREE.Vector3(LAP.x, Number.isFinite(top) ? top + 0.008 : 0.3, LAP.z);
  }

  // The middle of his eye slit (on the helm's front), world: where a camera framing his face looks.
  eyePos(out: THREE.Vector3) {
    if (!this.ready) return out.copy(this.renderPos).add(new THREE.Vector3(0, 1.63, 0.18));
    const h = this.av.bones.Head;
    h.updateWorldMatrix(true, false);
    return out.copy(EYE).sub(this.av.restP.get('Head')!).applyQuaternion(this.av.canonFrame('Head')).applyMatrix4(h.matrixWorld);
  }

  headPos(out: THREE.Vector3) {
    if (!this.ready) return out.copy(this.renderPos).add(new THREE.Vector3(0, 1.6, 0));
    const h = this.av.bones.Head;
    h.updateWorldMatrix(true, false);
    return out.copy(HELM_CENTRE).applyQuaternion(this.av.canonFrame('Head')).applyMatrix4(h.matrixWorld);
  }

  // Head, chest, hips, both knees, and the lap or feet: world spheres round him.
  spheres() {
    if (!this.ready) { const p = this.renderPos; return [0.3, 0.8, 1.3, 1.65].map((y) => new THREE.Sphere(p.clone().add(new THREE.Vector3(0, y, 0)), 0.32)); }
    const av = this.av;
    const head = this.headPos(V());
    const chest = av.pos('spine_02').lerp(av.pos('spine_03'), 0.5);
    const hips = av.pos('pelvis');
    const kl = av.pos('calf_l'), kr = av.pos('calf_r');
    const fl = av.pos('foot_l'), fr = av.pos('foot_r');
    return [
      new THREE.Sphere(head, 0.24), new THREE.Sphere(chest, 0.3), new THREE.Sphere(hips, 0.27),
      new THREE.Sphere(kl.lerp(fl, 0.3), 0.17), new THREE.Sphere(kr.lerp(fr, 0.3), 0.17),
      new THREE.Sphere(av.pos('thigh_l').lerp(av.pos('thigh_r'), 0.5).lerp(kl.clone().lerp(kr, 0.5), 0.5), 0.22),
    ];
  }

  setFade(f: number) {
    if (!this.m) return;
    this.m.fade.value = f;
    this.group.visible = f > 0.01;
  }

  // ---- Test hooks: the lowest point of each part over the ground under him (seated checks).
  report(ground?: (x: number, z: number) => number) {
    const g = this.renderPos.y, out: Record<string, number> = {};
    const gr = ground ?? (() => g);
    this.group.updateMatrixWorld(true);
    const v = V();
    for (const part of this.m.parts) {
      const mesh = part.mesh;
      if (!mesh.visible || (part.name === 'spear' && !this.outfit.wounded)) continue;
      let low = Infinity;
      for (let i = part.start; i < part.start + part.count; i++) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); low = Math.min(low, v.y - gr(v.x, v.z) + g); }
      out[part.name] = Math.min(out[part.name] ?? Infinity, +(low - g).toFixed(4));
    }
    return out;
  }
  // ---- Test hook: how deep his parts reach into an ellipsoid (his local space: centre, semi-axes): the smallest
  // normalised radius of any of his vertices (below 1: inside) and the part it belongs to.
  intrude(c: THREE.Vector3, r: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    const v = V();
    let best = Infinity, who = '';
    for (const part of this.m.parts) {
      const mesh = part.mesh;
      if (!mesh.visible || (part.name === 'spear' && !this.outfit.wounded)) continue;
      for (let i = part.start; i < part.start + part.count; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
        const l = this.local(v).sub(c);
        const d = Math.hypot(l.x / r.x, l.y / r.y, l.z / r.z);
        if (d < best) { best = d; who = part.name; }
      }
    }
    return { d: +best.toFixed(3), part: who };
  }
  stats() {
    let tris = 0;
    for (const m of this.m.meshes) tris += m.geometry.index!.count / 3;
    return { meshes: this.m.meshes.length, tris, parts: this.m.parts.length, bones: this.m.cloth.skeleton.bones.length };
  }
}

// Points along the scabbard (its frame: down it is -Y): the chape's tip and sides, kept off the ground.
const SCAB_PTS = [new THREE.Vector3(0, -0.615, 0), new THREE.Vector3(0.018, -0.58, 0), new THREE.Vector3(-0.018, -0.58, 0), new THREE.Vector3(0, -0.3, 0.02), new THREE.Vector3(0, -0.3, -0.02)];
// Sat: how far out his heels lie (local z), the lap point's place (between his thighs, in front of his hips) and,
// over it, where his left palm shelters her (a roof over her back).
const SEAT_FEET = { l: 0.766, r: 0.768 };
const LAP = { x: 0, z: 0.3 };
const SHELTER = new THREE.Vector3(-0.05, 0.25, -0.01);
// Where his right palm presses, below the spear (on the cuirass: round from the front, height at rest), fingers
// up toward the wound.
const PRESS = { phi: 0.66, y: 1.235, fx: 0.62, fy: 0.78 };
// The slide down the trunk over SLIDE_DUR seconds: settling back, sliding (with a catch halfway), the leg out.
const SLIDE_DUR = 3.6;
function slideCurve(t: number) {
  const k = [[0, 0], [0.5, 0.1], [1.4, 0.42], [1.75, 0.46], [2.55, 0.8], [3.6, 1]];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const a = k[i - 1], b = k[i]; return lerp(a[1], b[1], sm((t - a[0]) / (b[0] - a[0]))); }
  return 1;
}
// The stagger: buckling fast, hanging there a moment, recovering.
const STAG_DUR = 1.7;
function stagCurve(t: number) {
  if (t < 0.28) return sm(t / 0.28);
  if (t < 0.6) return 1 - 0.15 * sm((t - 0.28) / 0.32);
  return 0.85 * (1 - sm((t - 0.6) / 1.1));
}
