// The animation driver for jointed toy characters (v3), ported from v2's SkinnedAvatar onto plain `three`.
// An invisible skeleton (the Quaternius mannequin, given the character's own proportions) is animated by the
// Universal Animation Library's clips through an AnimationMixer; the character hangs rigid parts on its bones.
// Idle, walk, jog and sprint blend by speed with one shared phase (each loop's foot timing found at load, so blended
// loops plant the same foot together); jump, fall and landing cross-fade; an upper-body layer carries and plays
// one-shots over the legs. After the clips the character may pose bones itself (IK helpers below); feet are then
// put on the ground under them and the head turns toward what it looks at.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterBody, PoseContext } from '../body';

const loader = new GLTFLoader();
let library: Promise<Map<string, THREE.AnimationClip>> | null = null;
let mannequin: Promise<THREE.Object3D> | null = null;

// The clip library, loaded once: every bone's rotation; translation only for the pelvis (the root's motion is
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
function loadMannequin() {
  mannequin ??= loader.loadAsync(`${import.meta.env.BASE_URL}chars/mannequin.glb`).then((g) => g.scene);
  return mannequin;
}

// Bones of the legs and hips; everything else is the upper body.
export const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/;

export type Proportions = {
  // Factor for the offset from `parent`'s joint to `child`'s (a number, or per character axis x, y, z at rest).
  scale: (parent: string, child: string) => number | [number, number, number];
  hipRatio: number; // this character's hip height over the library's (the clips' pelvis motion is scaled by it)
};

export type Layered = { name: string; lower: THREE.AnimationAction; upper: THREE.AnimationAction; dur: number; offset: number };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// Two-bone IK in a plane: the middle joint for an end at `t` from `a` (lengths l1, l2), bending toward `pole`.
// Returns the reachable end (never stretched).
export function solveTwoBone(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3) {
  const dir = _u.subVectors(t, a);
  let d = dir.length();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9995);
  dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = _w.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-10) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  outMid.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
  return outEnd.copy(a).addScaledVector(dir, d);
}

export class Avatar {
  root!: THREE.Object3D; // the skeleton (no mesh), to add under the character's group
  bones: Record<string, THREE.Bone> = {};
  mixer!: THREE.AnimationMixer;
  clips = new Map<string, Layered>();
  // Rest pose after proportions: local rotations, and world (character space) positions / rotations.
  restP = new Map<string, THREE.Vector3>();
  restQ = new Map<string, THREE.Quaternion>();
  restLocalQ = new Map<string, THREE.Quaternion>();
  // Each bone's "canonical" frame (character axes for the torso and legs; arms hang down with the thumb forward)
  // relative to the bone: world(bone) = world(canon) * fromCanon.
  fromCanon = new Map<string, THREE.Quaternion>();
  private clipPose: { b: THREE.Bone; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];
  phase = 0; // the gait loops' shared cycle, 0..1

  constructor(public props: Proportions) {}

  // Fingers: the clips' finger tracks (off for mitten hands, which saves most of the mixer's work).
  fingers = false;

  async load(names: string[]) {
    const [scene, lib] = await Promise.all([loadMannequin(), loadClips()]);
    const root = cloneSkinned(scene);
    const meshes: THREE.Object3D[] = [];
    root.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); if (o.isBone) this.bones[o.name] = o; });
    for (const m of meshes) m.parent?.remove(m);
    this.root = root;
    this.applyProportions();
    this.mixer = new THREE.AnimationMixer(root);
    const k = this.props.hipRatio;
    for (const name of names) {
      const src = lib.get(name);
      if (!src) continue;
      const clip = src.clone();
      if (!this.fingers) clip.tracks = clip.tracks.filter((t) => !/^(index|middle|ring|pinky|thumb)_/.test(t.name));
      if (k !== 1) for (const t of clip.tracks) if (t.name.endsWith('.position')) for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
      const lowerClip = new THREE.AnimationClip(`${name}.lower`, clip.duration, clip.tracks.filter((t) => LOWER.test(t.name)));
      const upperClip = new THREE.AnimationClip(`${name}.upper`, clip.duration, clip.tracks.filter((t) => !LOWER.test(t.name)));
      const lower = this.mixer.clipAction(lowerClip), upper = this.mixer.clipAction(upperClip);
      for (const a of [lower, upper]) { a.play(); a.setEffectiveWeight(0); }
      this.clips.set(name, { name, lower, upper, dur: clip.duration, offset: 0 });
    }
    for (const b of Object.values(this.bones)) this.clipPose.push({ b, q: b.quaternion.clone(), p: b.position.clone() });
  }

  // The skeleton given the character's proportions: each joint's offset from its parent scaled along the rest
  // pose's axes (rotations stay as they are, so the clips still fit). Then the rest frames are recorded.
  private applyProportions() {
    const root = this.root;
    root.updateMatrixWorld(true);
    const wq = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const b of Object.values(this.bones)) wq.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
    for (const b of Object.values(this.bones)) {
      const p = b.parent as THREE.Bone;
      if (!p || !(p as any).isBone) continue;
      const f = this.props.scale(p.name, b.name);
      const pq = wq.get(p)!;
      const w = b.position.clone().applyQuaternion(pq);
      if (Array.isArray(f)) w.set(w.x * f[0], w.y * f[1], w.z * f[2]); else w.multiplyScalar(f);
      b.position.copy(w.applyQuaternion(pq.clone().invert()));
    }
    root.updateMatrixWorld(true);
    for (const [n, b] of Object.entries(this.bones)) {
      this.restP.set(n, b.getWorldPosition(new THREE.Vector3()));
      this.restQ.set(n, b.getWorldQuaternion(new THREE.Quaternion()));
      this.restLocalQ.set(n, b.quaternion.clone());
    }
    // Canonical frames.
    for (const n of Object.keys(this.bones)) {
      const arm = /^(upperarm|lowerarm|hand)_(l|r)$/.exec(n);
      let c = new THREE.Quaternion();
      if (arm) {
        // Down the arm is -Y; +Z forward (the thumb); +X to the character's left.
        const next = arm[1] === 'upperarm' ? `lowerarm_${arm[2]}` : arm[1] === 'lowerarm' ? `hand_${arm[2]}` : null;
        const from = arm[1] === 'hand' ? `lowerarm_${arm[2]}` : n, to = arm[1] === 'hand' ? n : next!;
        const along = this.restP.get(to)!.clone().sub(this.restP.get(from)!).normalize();
        const y = along.clone().negate();
        const z = new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z).normalize();
        const x = new THREE.Vector3().crossVectors(y, z);
        c = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      }
      this.fromCanon.set(n, c.clone().invert().multiply(this.restQ.get(n)!));
    }
  }

  // The rest frame (in the bone's space) of geometry made in the bone's canonical frame at its joint.
  canonFrame(name: string) { return this.fromCanon.get(name)!.clone().invert(); }

  clip(name: string) { return this.clips.get(name); }
  weight(name: string, lower: number, upper = lower) {
    const l = this.clips.get(name);
    if (l) { l.lower.setEffectiveWeight(lower); l.upper.setEffectiveWeight(upper); }
  }
  time(name: string, t: number, which: 'both' | 'lower' | 'upper' = 'both') {
    const l = this.clips.get(name);
    if (!l) return;
    if (which !== 'upper') l.lower.time = t;
    if (which !== 'lower') l.upper.time = t;
  }
  // Holds a loop still (its time set by phase), or lets it run on the mixer's clock.
  manual(name: string, on: boolean) { const l = this.clips.get(name); if (l) l.lower.timeScale = l.upper.timeScale = on ? 0 : 1; }

  // Each loop's phase where the left foot is lowest, so blended loops plant the same foot together.
  alignLoops(names: string[]) {
    const foot = this.bones.foot_l;
    const p = new THREE.Vector3();
    for (const n of names) {
      const l = this.clips.get(n);
      if (!l) continue;
      for (const [nm, c] of this.clips) { c.lower.setEffectiveWeight(nm === n ? 1 : 0); c.upper.setEffectiveWeight(nm === n ? 1 : 0); }
      let best = 0, low = Infinity;
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * l.dur;
        l.lower.time = t; l.upper.time = t;
        this.mixer.update(0);
        this.root.updateMatrixWorld(true);
        foot.getWorldPosition(p);
        if (p.y < low) { low = p.y; best = i / 48; }
      }
      l.offset = best;
    }
    for (const c of this.clips.values()) { c.lower.setEffectiveWeight(0); c.upper.setEffectiveWeight(0); }
  }

  // The clips' pose for this frame. Bones are first put back to the last clip pose (the mixer only writes values
  // that changed, and the character's own posing after it must not accumulate).
  evaluate(dt: number) {
    for (const c of this.clipPose) { c.b.quaternion.copy(c.q); c.b.position.copy(c.p); }
    this.mixer.update(dt);
    for (const c of this.clipPose) { c.q.copy(c.b.quaternion); c.p.copy(c.b.position); }
  }

  // ---- Posing helpers (world space; the bone's parents are brought up to date as needed).
  pos(name: string, out = new THREE.Vector3()) { return this.bones[name].getWorldPosition(out); }
  quat(name: string, out = new THREE.Quaternion()) { return this.bones[name].getWorldQuaternion(out); }
  setQuat(b: THREE.Object3D, q: THREE.Quaternion) {
    const pq = b.parent!.getWorldQuaternion(_q3);
    b.quaternion.copy(pq.invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  // Rotates a bone about a world axis through its joint (partially: by angle).
  turn(name: string, axis: THREE.Vector3, angle: number) {
    if (Math.abs(angle) < 1e-6) return;
    const b = this.bones[name];
    const wq = b.getWorldQuaternion(_q2);
    this.setQuat(b, _q.setFromAxisAngle(axis, angle).multiply(wq));
  }
  // Turns a bone so that a world direction it carries, `from`, points along `to` (by weight w).
  aim(name: string, from: THREE.Vector3, to: THREE.Vector3, w = 1) {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12 || w <= 0) return;
    const q = _q.setFromUnitVectors(_v.copy(from).normalize(), _w.copy(to).normalize());
    if (w < 1) q.slerp(_q3.identity(), 1 - w);
    const b = this.bones[name];
    const wq = b.getWorldQuaternion(_q2);
    this.setQuat(b, q.multiply(wq));
  }
  // A bone's canonical frame set in the world: its +Y along `y`, its +Z as near `z` as can be.
  setCanon(name: string, y: THREE.Vector3, z: THREE.Vector3, w = 1) {
    const Y = y.clone().normalize();
    const Z = z.clone().addScaledVector(Y, -z.dot(Y)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)).multiply(this.fromCanon.get(name)!);
    const b = this.bones[name];
    if (w < 1) q.copy(b.getWorldQuaternion(new THREE.Quaternion()).slerp(q, w));
    this.setQuat(b, q);
  }
  // The world direction of a canonical axis of a bone.
  axis(name: string, local: THREE.Vector3, out = new THREE.Vector3()) {
    const q = this.quat(name, _q2).multiply(_q3.copy(this.fromCanon.get(name)!).invert());
    return out.copy(local).applyQuaternion(q);
  }
  setPos(name: string, p: THREE.Vector3) {
    const b = this.bones[name];
    b.position.copy(b.parent!.worldToLocal(_v.copy(p)));
    b.updateMatrixWorld(true);
  }

  // Two-bone IK: the chain a → b → c, its end (c's joint) to `target` (world), bending toward `pole`. The end bone
  // keeps its world rotation unless the caller sets it after.
  // `stretch`: how much longer (m) the first segment may grow to reach (a toy's elbow cop hides a little give).
  limb(a: string, b: string, c: string, target: THREE.Vector3, pole: THREE.Vector3, keepEnd = true, stretch = 0) {
    const A = this.pos(a), B = this.pos(b), C = this.pos(c);
    const endQ = keepEnd ? this.quat(c) : null;
    let l1 = A.distanceTo(B);
    const l2 = B.distanceTo(C);
    const short = A.distanceTo(target) - (l1 + l2) * 0.999;
    if (stretch > 0 && short > 0) {
      const k = (l1 + Math.min(short, stretch)) / l1;
      this.bones[b].position.multiplyScalar(k);
      this.bones[a].updateMatrixWorld(true);
      l1 *= k;
      B.copy(this.pos(b)); C.copy(this.pos(c));
    }
    const B2 = new THREE.Vector3(), C2 = new THREE.Vector3();
    solveTwoBone(A, target, l1, l2, pole, B2, C2);
    this.aim(a, B.clone().sub(A), B2.clone().sub(A));
    const C1 = this.pos(c);
    this.aim(b, C1.sub(B2), C2.clone().sub(B2));
    if (endQ) this.setQuat(this.bones[c], endQ);
    return C2;
  }
  // The pole a chain bends toward now (its middle joint's offset from the line between its ends).
  bend(a: string, b: string, c: string, out = new THREE.Vector3()) {
    const A = this.pos(a), B = this.pos(b), C = this.pos(c);
    const ax = C.sub(A).normalize();
    out.copy(B).sub(A);
    return out.addScaledVector(ax, -out.dot(ax)).normalize();
  }

  // ---- Feet on the ground. The clips are made on flat ground, so each foot goes to the ground under it (a step, a
  // slope; heel, ball and toe all clear it) and the hips come down when a foot has to reach below; at rest the stance
  // can narrow. Two-bone IK on thigh and calf; the foot keeps its animated orientation. `w` fades it (0 in the air).
  // The feet's targets are where the clips put them (captureFeet, before the character's own posing moves the hips).
  private footOff = [0, 0];
  private feet = [0, 1].map(() => ({ A: new THREE.Vector3(), B: new THREE.Vector3(), T: new THREE.Vector3() }));
  hipOff = 0; private reachOff = 0;
  // How far a foot's ankle must rise from `ankle` (world) for its shoe to clear the ground (the character's own
  // soles: a big boot's heel and toe reach further than the skeleton's foot).
  soleLift: ((i: number, ankle: THREE.Vector3, ground: (x: number, z: number) => number) => number) | null = null;
  captureFeet() {
    ['l', 'r'].forEach((s, i) => { const f = this.feet[i]; this.pos(`foot_${s}`, f.A); this.pos(`ball_${s}`, f.B); this.pos(`ball_leaf_${s}`, f.T); });
  }
  // The clip's foot (ankle) position for a side, as captured; a foot moved (a step the clips do not take).
  clipFoot(i: number) { return this.feet[i].A; }
  moveFoot(i: number, d: THREE.Vector3) { const f = this.feet[i]; f.A.add(d); f.B.add(d); f.T.add(d); }
  footIK(ctx: PoseContext, dt: number, w: number, yaw: number, root: THREE.Vector3, narrow = 1) {
    const k = Math.min(1, dt * 14);
    if (w < 0.01) { this.hipOff *= 1 - k; this.footOff[0] *= 1 - k; this.footOff[1] *= 1 - k; return; }
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), fwdC = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const targets: THREE.Vector3[] = [];
    let low = 0;
    ['l', 'r'].forEach((s, i) => {
      const { A, B, T } = this.feet[i];
      const H = this.pos(`thigh_${s}`), K = this.pos(`calf_${s}`), A1 = this.pos(`foot_${s}`);
      const len = H.distanceTo(K) + K.distanceTo(A1);
      // The ground under heel, ball and toe; the foot rides on the highest (the clip's own lift kept).
      const fwd = new THREE.Vector3(T.x - A.x, 0, T.z - A.z);
      if (fwd.lengthSq() > 1e-8) fwd.normalize();
      const hx = A.x - fwd.x * 0.08, hz = A.z - fwd.z * 0.08;
      const g = Math.max(ctx.ground(A.x, A.z), ctx.ground(B.x, B.z), ctx.ground(T.x, T.z), ctx.ground(hx, hz));
      const off = THREE.MathUtils.clamp(g - root.y, -0.45 * len, 0.45 * len);
      this.footOff[i] += (off - this.footOff[i]) * k;
      low = Math.min(low, this.footOff[i]);
      const side = (A.x - root.x) * right.x + (A.z - root.z) * right.z;
      const Tt = A.clone().addScaledVector(right, side * (narrow - 1));
      Tt.y += this.footOff[i];
      if (this.soleLift) Tt.y += this.soleLift(i, Tt, ctx.ground);
      targets.push(Tt);
    });
    this.hipOff += (low * w - this.hipOff) * k;
    if (Math.abs(this.hipOff) > 1e-5) {
      const pw = this.pos('pelvis');
      pw.y += this.hipOff;
      this.setPos('pelvis', pw);
    }
    // A leg that cannot reach its foot's place (a long step down): the hips come down for it.
    let over = 0;
    ['l', 'r'].forEach((s, i) => {
      const H = this.pos(`thigh_${s}`), K = this.pos(`calf_${s}`), A1 = this.pos(`foot_${s}`);
      const T = A1.clone().lerp(targets[i], w);
      const d = H.distanceTo(T) - (H.distanceTo(K) + K.distanceTo(A1)) * 0.985;
      if (d > 0) over = Math.max(over, d * Math.max(0.3, (H.y - T.y) / Math.max(1e-3, H.distanceTo(T))));
    });
    this.reachOff += (over * w - this.reachOff) * Math.min(1, dt * (over > this.reachOff ? 30 : 8));
    if (this.reachOff > 1e-4) { const pw = this.pos('pelvis'); pw.y -= this.reachOff; this.setPos('pelvis', pw); }
    ['l', 'r'].forEach((s, i) => {
      const T = this.pos(`foot_${s}`).lerp(targets[i], w);
      // Knees keep bending the way the clip bends them (and forward when it holds the leg straight).
      const pole = this.bend(`thigh_${s}`, `calf_${s}`, `foot_${s}`).addScaledVector(fwdC, 0.25);
      this.limb(`thigh_${s}`, `calf_${s}`, `foot_${s}`, T, pole);
    });
  }

  // ---- The head turned toward a point (yaw about world up, pitch about the body's right), eased.
  lookYaw = 0; lookPitch = 0;
  look(target: THREE.Vector3 | null, yaw: number, dt: number, o: { maxYaw?: number; maxUp?: number; maxDown?: number; rate?: number; bones?: [string, number][] } = {}) {
    let ty = 0, tp = 0;
    const head = this.bones.Head;
    if (target) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      const d = new THREE.Vector3().subVectors(target, hp);
      let y = Math.atan2(d.x, d.z) - yaw;
      y = Math.atan2(Math.sin(y), Math.cos(y));
      const p = Math.atan2(d.y, Math.hypot(d.x, d.z));
      if (Math.abs(y) < 2.0) { ty = THREE.MathUtils.clamp(y, -(o.maxYaw ?? 1), o.maxYaw ?? 1); tp = THREE.MathUtils.clamp(p, -(o.maxDown ?? 0.5), o.maxUp ?? 0.45); }
    }
    const k = Math.min(1, dt * (o.rate ?? 3));
    this.lookYaw += (ty - this.lookYaw) * k;
    this.lookPitch += (tp - this.lookPitch) * k;
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) < 1e-4) return;
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    for (const [n, f] of o.bones ?? [['neck_01', 0.35], ['Head', 0.65]] as [string, number][]) {
      this.turn(n, UP, this.lookYaw * f);
      this.turn(n, right, this.lookPitch * f);
    }
  }
}
