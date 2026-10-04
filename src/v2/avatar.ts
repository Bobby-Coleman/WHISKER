// Skinned characters (engine v2): a glTF skeleton and mesh animated by the shared clips (Quaternius Universal
// Animation Library, CC0) through an AnimationMixer, chosen and blended from the gameplay body. Idle, walk, jog and
// sprint blend by speed with their cycles kept in step (each loop's own foot timing found at load); jumps, falls and
// landings cross-fade; an upper-body layer carries, throws and holds without stopping the legs. The clips' pelvis
// motion is scaled to each character's hip height, so one library animates a knight and a kitten.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterBody, PoseContext } from '../chars/character';
import { solveTwoBone } from '../chars/rig';

const loader = new GLTFLoader();
let library: Promise<Map<string, THREE.AnimationClip>> | null = null;

// The clip library, loaded once: every bone's rotation; translation only for the pelvis (the root's root motion is
// dropped: the game moves the character).
export function loadClips() {
  library ??= loader.loadAsync(`${import.meta.env.BASE_URL}chars/ual_anims.glb`).then((g) => {
    const m = new Map<string, THREE.AnimationClip>();
    for (const c of g.animations) {
      c.tracks = c.tracks.filter((t) => {
        const dot = t.name.lastIndexOf('.'), node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
        if (prop === 'scale') return false;
        if (prop === 'position') return node === 'pelvis';
        return true;
      });
      m.set(c.name, c);
    }
    return m;
  });
  return library;
}

// Bones of the legs and hips; everything else is the upper body.
const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/;

export type AvatarSpec = {
  kind: 'kitten' | 'knight';
  url: string;
  radius: number; height: number; // its capsule
  scale?: number; // uniform scale of the model
  // Library hip height over this character's (the clips' pelvis motion is scaled by its inverse).
  hipRatio?: number;
  // Ground speeds (m/s) of walk, jog and sprint at normal playback, for this character's size.
  speeds?: { walk: number; jog: number; sprint: number };
  setup?: (model: THREE.Object3D) => void;
  body?: CharacterBody; // share another visual's gameplay body (driven.ts)
  // At rest the feet come in toward each other by this factor (1: as the clip stands).
  stance?: number;
};

type Layered = { lower: THREE.AnimationAction; upper: THREE.AnimationAction; dur: number; offset: number };
const LOCO = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Zombie_Walk_Fwd_Loop'] as const;
// Walk loops a character may use in place of the plain walk (a limp).
const WALKS = ['Walk_Loop', 'Zombie_Walk_Fwd_Loop'];
const _ik = { r: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Quaternion(), p: new THREE.Quaternion() };

export class SkinnedAvatar {
  kind: 'kitten' | 'knight';
  body: CharacterBody;
  group = new THREE.Group();
  model!: THREE.Object3D;
  renderPos = new THREE.Vector3();
  renderYaw = 0;
  carriedBy: any = null;
  holding: any = null;
  mixer!: THREE.AnimationMixer;
  bones = new Map<string, THREE.Bone>();
  private clips = new Map<string, Layered>();
  phase = 0; // the gait loops' shared cycle, 0..1
  private air = 0; // 0 on the ground .. 1 in the air (eased)
  private land = 0; // a landing's remaining weight
  private carry = 0; // the upper-body carrying layer
  private held = 0; // being carried
  private lookYaw = 0; private lookPitch = 0;
  private oneShot: { a: Layered; t: number; fade: number } | null = null;
  private speeds: { walk: number; jog: number; sprint: number };
  private wasGrounded = true;
  stepEvents: { side: number; strength: number }[] = [];
  private lastFoot = [0, 0];

  constructor(public spec: AvatarSpec) {
    this.kind = spec.kind;
    this.body = spec.body ?? new CharacterBody(spec.radius, spec.height);
    this.speeds = spec.speeds ?? { walk: 1.4, jog: 3.6, sprint: 5.8 };
    this.group.name = spec.kind;
  }

  async load() {
    const [g, lib] = await Promise.all([loader.loadAsync(`${import.meta.env.BASE_URL}${this.spec.url}`), loadClips()]);
    this.model = g.scene;
    this.model.scale.setScalar(this.spec.scale ?? 1);
    this.model.traverse((o: any) => {
      if (o.isBone) this.bones.set(o.name, o);
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.spec.setup?.(this.model);
    this.group.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const k = 1 / (this.spec.hipRatio ?? 1);
    const make = (name: string) => {
      const src = lib.get(name);
      if (!src) return null;
      const scaled = k === 1 ? src : src.clone();
      if (k !== 1) for (const t of scaled.tracks) if (t.name.endsWith('.position')) for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
      const lowerClip = new THREE.AnimationClip(`${name}.lower`, scaled.duration, scaled.tracks.filter((t) => LOWER.test(t.name)));
      const upperClip = new THREE.AnimationClip(`${name}.upper`, scaled.duration, scaled.tracks.filter((t) => !LOWER.test(t.name)));
      const lower = this.mixer.clipAction(lowerClip), upper = this.mixer.clipAction(upperClip);
      for (const a of [lower, upper]) { a.play(); a.setEffectiveWeight(0); }
      return { lower, upper, dur: scaled.duration, offset: 0 } as Layered;
    };
    for (const n of [...LOCO, 'Jump_Loop', 'Jump_Land', 'Walk_Carry_Loop', 'OverhandThrow', 'Swim_Idle_Loop', 'PickUp_Table']) {
      const l = make(n);
      if (l) this.clips.set(n, l);
    }
    // The gait loops and the carrying layer are posed by phase, not by the mixer's clock.
    for (const n of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Walk_Carry_Loop', 'Zombie_Walk_Fwd_Loop']) { const l = this.clips.get(n); if (l) l.lower.timeScale = l.upper.timeScale = 0; }
    this.alignLoops();
    this.weights(1, 0, 0, 0);
  }

  // Each loop's phase where the left foot is lowest, so blended loops plant the same foot together.
  private alignLoops() {
    const foot = this.bones.get('foot_l');
    if (!foot) return;
    const p = new THREE.Vector3();
    for (const n of LOCO.slice(1)) {
      const l = this.clips.get(n);
      if (!l) continue;
      for (const [nm, c] of this.clips) for (const a of [c.lower, c.upper]) a.setEffectiveWeight(nm === n ? 1 : 0);
      let best = 0, low = Infinity;
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * l.dur;
        l.lower.time = t; l.upper.time = t;
        this.mixer.update(0);
        this.model.updateMatrixWorld(true);
        foot.getWorldPosition(p);
        if (p.y < low) { low = p.y; best = i / 32; }
      }
      l.offset = best;
    }
  }

  // The walk loop in use: the plain walk, or a limp (the wounded knight); its natural speed, m/s.
  walkClip = 'Walk_Loop';
  walkSpeed: number | null = null;

  private weights(idle: number, walk: number, jog: number, sprint: number) {
    const set = (n: string, v: number) => { const l = this.clips.get(n); if (l) { l.lower.setEffectiveWeight(v); l.upper.setEffectiveWeight(v); } };
    set('Idle_Loop', idle); set('Jog_Fwd_Loop', jog); set('Sprint_Loop', sprint);
    for (const n of WALKS) set(n, n === this.walkClip ? walk : 0);
  }

  resetPose(_ground?: (x: number, z: number) => number) {
    this.renderPos.copy(this.body.pos); this.renderYaw = this.body.yaw;
    this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0);
  }

  // Where the knight's hands hold the kitten: between them, a little forward.
  holdPoint(out: THREE.Vector3) {
    const l = this.bones.get('hand_l'), r = this.bones.get('hand_r');
    if (!l || !r) return out.copy(this.body.pos).add(new THREE.Vector3(0, this.body.height * 0.6, 0));
    const a = l.getWorldPosition(new THREE.Vector3()), b = r.getWorldPosition(new THREE.Vector3());
    out.addVectors(a, b).multiplyScalar(0.5);
    out.y -= 0.12;
    return out;
  }

  headPos(out: THREE.Vector3) {
    const h = this.bones.get('Head');
    return h ? h.getWorldPosition(out) : out.copy(this.body.pos).setY(this.body.pos.y + this.body.height * 0.9);
  }

  // Spheres standing in for the body in the ground's contact occlusion: [bone, local offset, radius].
  occluders(): [THREE.Object3D, number, number, number, number][] {
    const s = this.body.height / 1.8;
    const out: [THREE.Object3D, number, number, number, number][] = [];
    const add = (n: string, r: number) => { const b = this.bones.get(n); if (b) out.push([b, 0, 0, 0, r * s]); };
    add('pelvis', 0.16); add('spine_03', 0.19); add('Head', 0.13); add('calf_l', 0.09); add('calf_r', 0.09);
    add('foot_l', 0.07); add('foot_r', 0.07); add('ball_l', 0.05); add('ball_r', 0.05);
    return out;
  }

  get busy() { return this.oneShot !== null; }

  // A one-shot upper-body action (a throw, a pick-up) over the legs' motion.
  play(name: string, fade = 0.12) {
    const l = this.clips.get(name);
    if (!l) return;
    l.upper.reset(); l.upper.setLoop(THREE.LoopOnce, 1); l.upper.clampWhenFinished = true; l.upper.play();
    this.oneShot = { a: l, t: 0, fade };
  }

  updateVisual(alpha: number, ctx: PoseContext) {
    const b = this.body, dt = Math.max(1e-4, ctx.dt);
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    if (b.visualDY !== 0) {
      this.renderPos.y += b.visualDY;
      b.visualDY *= Math.exp(-dt * 18);
      if (Math.abs(b.visualDY) < 1e-4) b.visualDY = 0;
    }
    const dy = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    this.renderYaw = b.prevYaw + dy * alpha;
    this.group.position.copy(this.renderPos);
    this.group.rotation.set(0, this.renderYaw, 0);
    if (!this.mixer) return;

    // Locomotion: weights from speed between the loops' natural speeds; one phase drives all of them.
    const sp = this.carriedBy ? 0 : Math.hypot(b.vel.x, b.vel.z);
    const S = this.walkSpeed !== null ? { ...this.speeds, walk: this.walkSpeed } : this.speeds;
    let wi = 0, ww = 0, wj = 0, ws = 0;
    if (sp < 0.12) wi = 1;
    else if (sp < S.walk) { const t = (sp - 0.12) / (S.walk - 0.12); wi = 1 - t; ww = t; }
    else if (sp < S.jog) { const t = (sp - S.walk) / (S.jog - S.walk); ww = 1 - t; wj = t; }
    else if (sp < S.sprint) { const t = (sp - S.jog) / (S.sprint - S.jog); wj = 1 - t; ws = t; }
    else ws = 1;
    const cyc = (n: string) => this.clips.get(n);
    const walk = cyc(this.walkClip), jog = cyc('Jog_Fwd_Loop'), sprint = cyc('Sprint_Loop'), idle = cyc('Idle_Loop');
    // Metres covered per cycle at natural speed; the phase advances to match the ground speed.
    const stride = (walk ? ww * S.walk * walk.dur : 0) + (jog ? wj * S.jog * jog.dur : 0) + (sprint ? ws * S.sprint * sprint.dur : 0);
    const mw = ww + wj + ws;
    if (mw > 0.001 && stride > 1e-4) this.phase = (this.phase + (sp * mw * dt) / stride) % 1;
    for (const l of [walk, jog, sprint]) if (l) { const t = ((this.phase + l.offset) % 1) * l.dur; l.lower.time = t; l.upper.time = t; }
    if (idle) { idle.lower.timeScale = 1; idle.upper.timeScale = 1; }

    // Air and landing.
    const airborne = !b.grounded && !b.climb && !this.carriedBy;
    this.air += ((airborne ? 1 : 0) - this.air) * Math.min(1, dt * (airborne ? 10 : 14));
    if (b.grounded && !this.wasGrounded && b.landing > 0.15 && sp < 0.8) {
      const land = cyc('Jump_Land');
      if (land) { land.lower.time = land.dur * 0.25; land.upper.time = land.dur * 0.25; this.land = 1; }
    }
    this.wasGrounded = b.grounded;
    this.land = Math.max(0, this.land - dt * 2.2);
    if (sp > 0.8) this.land = Math.max(0, this.land - dt * 6);
    // Being carried: legs dangle (treading water reads as a wriggle).
    this.held += ((this.carriedBy ? 1 : 0) - this.held) * Math.min(1, dt * 8);
    this.carry += ((this.holding ? 1 : 0) - this.carry) * Math.min(1, dt * 6);

    const ground = (1 - this.air) * (1 - this.held);
    const landW = this.land * ground;
    const locoW = ground * (1 - this.land * 0.85);
    this.weights(wi * locoW, ww * locoW, wj * locoW, ws * locoW);
    const jl = cyc('Jump_Loop'), jland = cyc('Jump_Land'), heldC = cyc('Swim_Idle_Loop');
    if (jl) { jl.lower.setEffectiveWeight(this.air * (1 - this.held)); jl.upper.setEffectiveWeight(this.air * (1 - this.held)); }
    if (jland) { jland.lower.setEffectiveWeight(landW); jland.upper.setEffectiveWeight(landW); jland.lower.timeScale = jland.upper.timeScale = 1.3; }
    if (heldC) { heldC.lower.setEffectiveWeight(this.held); heldC.upper.setEffectiveWeight(this.held); }
    // Upper-body layers: carrying (in step with the legs while walking, held still at rest), then one-shots.
    const carry = cyc('Walk_Carry_Loop');
    if (carry) {
      const c = this.carry * (1 - this.held);
      for (const n of [...LOCO, 'Jump_Loop', 'Jump_Land']) { const l = cyc(n); if (l) l.upper.setEffectiveWeight(l.upper.getEffectiveWeight() * (1 - c)); }
      carry.upper.setEffectiveWeight(c);
      carry.upper.time = sp > 0.3 ? ((this.phase + carry.offset) % 1) * carry.dur : carry.dur * 0.1;
      carry.lower.setEffectiveWeight(0);
    }
    if (this.oneShot) {
      const o = this.oneShot;
      o.t += dt;
      const end = o.a.dur / Math.max(0.01, o.a.upper.timeScale);
      const w = Math.min(1, o.t / o.fade) * Math.min(1, Math.max(0, (end - o.t) / o.fade));
      for (const n of [...LOCO, 'Jump_Loop', 'Jump_Land', 'Walk_Carry_Loop']) { const l = cyc(n); if (l) l.upper.setEffectiveWeight(l.upper.getEffectiveWeight() * (1 - w)); }
      o.a.upper.setEffectiveWeight(w);
      if (o.t >= end) { o.a.upper.setEffectiveWeight(0); this.oneShot = null; }
    }
    // Idle, the air and landing loops and one-shots run on the mixer's clock.
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    this.footIK(ctx, dt, wi * locoW, ground);
    this.lookAt(ctx, dt);
    this.footsteps(sp);
  }

  // Feet on the ground. The clips are made on flat ground, so each foot goes to the ground under it (a step, a slope)
  // and the hips come down when a foot has to reach below; at rest the stance can narrow. Two-bone IK on thigh and
  // calf; the foot keeps its animated orientation. Fades out in the air.
  private footOff = [0, 0];
  private hipOff = 0;
  private footIK(ctx: PoseContext, dt: number, idleW: number, w: number) {
    const pelvis = this.bones.get('pelvis');
    if (!pelvis || w < 0.01) { this.hipOff *= 0.8; return; }
    const legs = [['thigh_l', 'calf_l', 'foot_l'], ['thigh_r', 'calf_r', 'foot_r']].map((n) => n.map((b) => this.bones.get(b)!));
    if (legs.some((l) => l.some((b) => !b))) return;
    const root = this.group.position;
    const right = _ik.r.set(Math.cos(this.renderYaw), 0, -Math.sin(this.renderYaw));
    const narrow = THREE.MathUtils.lerp(1, this.spec.stance ?? 1, idleW);
    const k = Math.min(1, dt * 14);
    const targets: THREE.Vector3[] = [];
    let low = 0;
    legs.forEach(([th, ca, ft], i) => {
      const H = th.getWorldPosition(new THREE.Vector3()), K = ca.getWorldPosition(new THREE.Vector3()), A = ft.getWorldPosition(new THREE.Vector3());
      const len = H.distanceTo(K) + K.distanceTo(A);
      const g = ctx.ground(A.x, A.z);
      const off = THREE.MathUtils.clamp(g - root.y, -0.45 * len, 0.45 * len);
      this.footOff[i] += (off - this.footOff[i]) * k;
      low = Math.min(low, this.footOff[i]);
      // The stance: the foot's sideways offset from the body's centre line, drawn in at rest.
      const side = (A.x - root.x) * right.x + (A.z - root.z) * right.z;
      const T = A.clone().addScaledVector(right, side * (narrow - 1));
      T.y += this.footOff[i];
      targets.push(T);
    });
    this.hipOff += (low * w - this.hipOff) * k;
    // Hips down.
    const pw = pelvis.getWorldPosition(new THREE.Vector3());
    pw.y += this.hipOff;
    pelvis.position.copy(pelvis.parent!.worldToLocal(pw));
    pelvis.updateMatrixWorld(true);
    legs.forEach(([th, ca, ft], i) => {
      const H = th.getWorldPosition(new THREE.Vector3()), K = ca.getWorldPosition(new THREE.Vector3()), A = ft.getWorldPosition(new THREE.Vector3());
      const T = targets[i];
      // Blend from the clip's foot toward the target by the IK weight.
      const Aw = A.clone().lerp(T, w);
      const l1 = H.distanceTo(K), l2 = K.distanceTo(A);
      const footQ = ft.getWorldQuaternion(new THREE.Quaternion());
      // The knee keeps bending the way the clip bends it.
      const axis = A.clone().sub(H).normalize();
      const pole = K.clone().sub(H).addScaledVector(axis, -K.clone().sub(H).dot(axis));
      if (pole.lengthSq() < 1e-8) pole.set(Math.sin(this.renderYaw), 0, Math.cos(this.renderYaw));
      const K2 = new THREE.Vector3();
      const end = solveTwoBone(H, Aw, l1, l2, pole, K2);
      this.aim(th, K.clone().sub(H), K2.clone().sub(H));
      const A1 = ft.getWorldPosition(new THREE.Vector3());
      this.aim(ca, A1.sub(K2), end.clone().sub(K2));
      // The foot as the clip turned it.
      const cq = ca.getWorldQuaternion(new THREE.Quaternion());
      ft.quaternion.copy(cq.invert().multiply(footQ));
      ft.updateMatrixWorld(true);
    });
  }

  // Turns a bone (in world space) so that a direction it carries, `from`, points along `to`.
  private aim(b: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    const q = _ik.q.setFromUnitVectors(from.normalize(), to.normalize());
    const wq = b.getWorldQuaternion(_ik.w);
    const pq = b.parent!.getWorldQuaternion(_ik.p);
    b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
    b.updateMatrixWorld(true);
  }

  // The head turns toward a point of interest (the other character), within a comfortable range.
  private lookAt(ctx: PoseContext, dt: number) {
    const head = this.bones.get('Head');
    if (!head) return;
    let ty = 0, tp = 0;
    if (ctx.lookAt && !this.body.climb) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      const d = new THREE.Vector3().subVectors(ctx.lookAt, hp);
      const fwdYaw = this.renderYaw;
      let yaw = Math.atan2(d.x, d.z) - fwdYaw;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const sp = Math.hypot(this.body.vel.x, this.body.vel.z);
      if (Math.abs(yaw) < 1.7 && d.length() < 10 && sp < 1.5) { ty = THREE.MathUtils.clamp(yaw, -1.0, 1.0); tp = THREE.MathUtils.clamp(pitch, -0.5, 0.45); }
    }
    this.lookYaw += (ty - this.lookYaw) * Math.min(1, dt * 3);
    this.lookPitch += (tp - this.lookPitch) * Math.min(1, dt * 3);
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) < 1e-4) return;
    // Turn about world up and the character's right axis, applied in the head's parent space.
    const parent = head.parent!;
    const pq = parent.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.renderYaw);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, -this.lookPitch));
    const hw = head.getWorldQuaternion(new THREE.Quaternion());
    const want = turn.multiply(hw);
    head.quaternion.copy(pq.invert().multiply(want));
    head.updateMatrixWorld(true);
  }

  // Footfalls from the feet's heights: a foot that comes down to the ground after being lifted.
  private footsteps(sp: number) {
    if (!this.body.grounded || sp < 0.3) return;
    const base = this.group.position.y;
    ['foot_l', 'foot_r'].forEach((n, i) => {
      const f = this.bones.get(n);
      if (!f) return;
      const y = f.getWorldPosition(new THREE.Vector3()).y - base;
      const lim = 0.06 * (this.spec.scale ?? 1) / (this.spec.hipRatio ?? 1);
      if (this.lastFoot[i] > lim && y <= lim) this.stepEvents.push({ side: i === 0 ? 1 : -1, strength: Math.min(1, sp / 4) });
      this.lastFoot[i] = y;
    });
  }

  update(_dt: number, _ctx: PoseContext) {}
}
