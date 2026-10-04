// The original characters on the animation library (engine v2). v1's knight and kitten keep every mesh, material, fur
// layer, cape and accessory exactly as they were built; their body parts follow the bones of an invisible skeleton
// that the shared clips animate (src/v2/avatar.ts). The skeleton is first given each character's own proportions
// (hip height, limb lengths, shoulder width and depth), so the parts meet at their joints as they did in v1, and
// each part keeps the frame v1 gave it: torso parts upright at their v1 origin, limb parts pointing -Y down the limb
// with +Z toward the elbow's or knee's pole.
import * as THREE from 'three/webgpu';
import type { Character, PartName, PoseContext } from '../chars/character';
import { SkinnedAvatar } from './avatar';

type V3 = [number, number, number];
// A part's bone; torso parts give their v1 origin (character space at rest); limb parts their pole, `next` the joint
// the limb points to, and `along` borrows another bone's direction (a hand follows its forearm).
type Frame = { bone: string; origin?: V3; pole?: V3; next?: string; along?: string };

export type Proportions = {
  // Factor for the offset from `parent`'s joint to `child`'s (a number, or per world axis x, y, z).
  scale: (parent: string, child: string) => number | V3;
  frames: Partial<Record<PartName, Frame>>;
  hipRatio: number; // the library's hip height over this character's
  speeds: { walk: number; jog: number; sprint: number };
  stance?: number; // at rest the feet come in toward each other by this factor
};

const mirror = (f: Frame): Frame => ({
  bone: f.bone.replace(/_l$/, '_r'), next: f.next?.replace(/_l$/, '_r'), along: f.along?.replace(/_l$/, '_r'),
  pole: f.pole ? [-f.pole[0], f.pole[1], f.pole[2]] : undefined, origin: f.origin ? [-f.origin[0], f.origin[1], f.origin[2]] : undefined,
});
function limbs(fr: Partial<Record<PartName, Frame>>) {
  const out = { ...fr };
  for (const [l, r] of [['uarmL', 'uarmR'], ['farmL', 'farmR'], ['handL', 'handR'], ['thighL', 'thighR'], ['shinL', 'shinR'], ['footL', 'footR']] as [PartName, PartName][]) {
    if (fr[l] && !fr[r]) out[r] = mirror(fr[l]!);
  }
  return out;
}

const ARM_POLE: V3 = [0, 1, -1]; // the elbow's outer back, as v1's arm pole (out and back) lies in the T-pose
const LEG_POLE: V3 = [0.08, 0, 1]; // knees forward

// Sir Bram: hips 0.976 m, thigh 0.46, shin 0.45, shoulders 0.195 out and 1.426 up, upper arm 0.29, forearm 0.27.
export const KNIGHT_PROPS: Proportions = {
  scale: (p, c) => {
    if (p === 'root') return 1.048;
    if (p === 'pelvis') return c.startsWith('thigh') ? 1.124 : 0.887;
    if (p.startsWith('spine') || p === 'neck_01') return 0.887;
    if (p.startsWith('clavicle')) return [1.03, 1.0, 0.46];
    if (p.startsWith('upperarm')) return 1.058;
    if (p.startsWith('lowerarm')) return 0.99;
    if (p.startsWith('thigh')) return 1.15;
    if (p.startsWith('calf')) return 1.049;
    if (p.startsWith('foot')) return 0.61;
    return 1;
  },
  frames: limbs({
    pelvis: { bone: 'pelvis', origin: [0, 0.976, 0] },
    chest: { bone: 'spine_03', origin: [0, 1.076, 0] },
    head: { bone: 'Head', origin: [0, 1.521, 0] },
    uarmL: { bone: 'upperarm_l', next: 'lowerarm_l', pole: ARM_POLE },
    farmL: { bone: 'lowerarm_l', next: 'hand_l', pole: ARM_POLE },
    handL: { bone: 'hand_l', along: 'lowerarm_l', pole: ARM_POLE },
    thighL: { bone: 'thigh_l', next: 'calf_l', pole: LEG_POLE },
    shinL: { bone: 'calf_l', next: 'foot_l', pole: LEG_POLE },
    footL: { bone: 'foot_l' },
  }),
  hipRatio: 0.917 / 0.961,
  speeds: { walk: 1.45, jog: 3.2, sprint: 5.4 },
  stance: 0.6, // he stands with his feet nearer together than the library's idle
};

// The kitten: hips 0.108 m, thigh 0.05, shin 0.048, shoulders 0.047 out at 0.194, upper arm 0.046, long forearms
// 0.062, her head well above (v1's neck 0.12). Her loops run as long, bounding strides (v1's 0.8 m run cycle), so at
// the shared pace her legs turn over about four times a second rather than ten.
export const KITTEN_PROPS: Proportions = {
  scale: (p, c) => {
    if (p === 'root') return 0.1156;
    if (p === 'pelvis') return c.startsWith('thigh') ? [0.27, 0.13, 0.0] : 0.13;
    if (p === 'neck_01') return 0.58;
    if (p.startsWith('spine')) return 0.17;
    if (p.startsWith('clavicle')) return [0.253, 0.17, 0.06];
    if (p.startsWith('upperarm')) return 0.168;
    if (p.startsWith('lowerarm')) return 0.227;
    if (p.startsWith('hand') || /^(index|middle|ring|pinky|thumb)/.test(p)) return 0.2;
    if (p.startsWith('thigh')) return 0.125;
    if (p.startsWith('calf')) return 0.112;
    if (p.startsWith('foot') || p.startsWith('ball')) return 0.1;
    return 0.17;
  },
  frames: limbs({
    pelvis: { bone: 'pelvis', origin: [0, 0.108, 0] },
    chest: { bone: 'spine_03', origin: [0, 0.126, 0] },
    head: { bone: 'Head', origin: [0, 0.248, 0.008] },
    uarmL: { bone: 'upperarm_l', next: 'lowerarm_l', pole: ARM_POLE },
    farmL: { bone: 'lowerarm_l', next: 'hand_l', pole: ARM_POLE },
    handL: { bone: 'hand_l', along: 'lowerarm_l', pole: ARM_POLE },
    thighL: { bone: 'thigh_l', next: 'calf_l', pole: LEG_POLE },
    shinL: { bone: 'calf_l', next: 'foot_l', pole: LEG_POLE },
    footL: { bone: 'foot_l' },
  }),
  hipRatio: 0.917 / 0.106,
  speeds: { walk: 0.25, jog: 0.62, sprint: 1.14 },
};

const _p = new THREE.Vector3(), _q = new THREE.Vector3();

export class DrivenAvatar {
  kind: 'kitten' | 'knight';
  group = new THREE.Group();
  anim: SkinnedAvatar;
  private offsets = new Map<PartName, { bone: THREE.Bone; m: THREE.Matrix4 }>();
  private mats: Partial<Record<PartName, THREE.Matrix4>> = {};

  constructor(public char: Character, public props: Proportions) {
    this.kind = char.kind;
    this.anim = new SkinnedAvatar({
      kind: char.kind, url: 'chars/mannequin.glb', radius: char.body.radius, height: char.body.height, body: char.body,
      hipRatio: props.hipRatio, speeds: props.speeds, stance: props.stance, setup: (model) => this.setup(model),
    });
    this.group.name = `${char.kind}_driven`;
    this.group.add(this.anim.group, char.group);
  }

  get body() { return this.char.body; }
  get renderPos() { return this.anim.renderPos; }
  get stepEvents() { return this.anim.stepEvents; }
  get carriedBy() { return this.anim.carriedBy; }
  // The v1 character hears of it too: its own carried pose takes over (below).
  set carriedBy(v: any) { this.anim.carriedBy = v; this.char.carriedBy = v ? (v.char ?? v) : null; }
  get holding() { return this.anim.holding; }
  set holding(v: any) { this.anim.holding = v; this.char.holding = v ? (v.char ?? v) : null; }

  load() { return this.anim.load(); }

  // The mannequin is only a skeleton here: hidden, given the character's proportions, and each part's place on it
  // remembered from the rest pose.
  private setup(model: THREE.Object3D) {
    model.traverse((o: any) => { if (o.isMesh) o.visible = false; });
    model.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    model.traverse((o: any) => { if (o.isBone) bones.set(o.name, o); });
    // Proportions: each joint's offset from its parent, scaled in world axes (the rest rotations stay as they are,
    // so the clips' rotations still fit).
    const restQ = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const b of bones.values()) restQ.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
    for (const b of bones.values()) {
      const p = b.parent as THREE.Bone;
      if (!p || !(p as any).isBone) continue;
      const f = this.props.scale(p.name, b.name);
      const pq = restQ.get(p)!;
      const w = b.position.clone().applyQuaternion(pq);
      if (Array.isArray(f)) w.set(w.x * f[0], w.y * f[1], w.z * f[2]); else w.multiplyScalar(f);
      b.position.copy(w.applyQuaternion(pq.clone().invert()));
    }
    model.updateMatrixWorld(true);
    // Each part's rest frame on its bone.
    const head = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
    for (const [part, f] of Object.entries(this.props.frames) as [PartName, Frame][]) {
      const bone = bones.get(f.bone);
      if (!bone) continue;
      const rest = new THREE.Matrix4();
      if (f.origin) rest.makeTranslation(f.origin[0], f.origin[1], f.origin[2]);
      else {
        const o = head(f.bone);
        // v1's orientBone: +Y from the limb's far joint back to its own (so the limb runs down -Y), +Z toward the
        // pole. A hand takes its forearm's direction.
        const y = f.next ? _p.copy(o).sub(head(f.next)) : f.along ? _p.copy(head(f.along)).sub(o) : null;
        if (y && f.pole && y.lengthSq() > 1e-10) {
          y.normalize();
          const pole = _q.set(...f.pole);
          const z = pole.addScaledVector(y, -pole.dot(y)).normalize();
          const x = new THREE.Vector3().crossVectors(y, z).normalize();
          rest.makeBasis(x, y.clone(), z.clone()).setPosition(o);
        } else rest.makeTranslation(o.x, o.y, o.z);
      }
      const m = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(rest);
      this.offsets.set(part, { bone, m });
      this.mats[part] = new THREE.Matrix4();
    }
  }

  resetPose(ground: (x: number, z: number) => number) {
    this.anim.resetPose(ground);
    this.char.resetPose(ground);
  }

  // Where the library has nothing to say (a climb up a wall, dangling in the knight's hands), the character's own v1
  // procedural pose takes over, blended in and out part by part.
  private procW = 0;
  private saved = new Map<PartName, { p: THREE.Vector3; q: THREE.Quaternion }>();

  updateVisual(alpha: number, ctx: PoseContext) {
    this.pose(alpha, ctx);
    (this.char as any).poseMeow?.(ctx.dt);
  }

  private pose(alpha: number, ctx: PoseContext) {
    const story = !!this.char.override;
    const want = this.char.body.climb || this.char.carriedBy || story ? 1 : 0;
    this.procW += (want - this.procW) * Math.min(1, Math.max(1e-4, ctx.dt) * (story || this.procW > want && this.char.overrideBlend !== 8 ? this.char.overrideBlend : 8));
    if (this.procW < 0.002) this.procW = 0;
    this.anim.updateVisual(alpha, ctx);
    for (const [part, o] of this.offsets) this.mats[part]!.multiplyMatrices(o.bone.matrixWorld, o.m);
    this.char.armsDriven = this.anim.busy;
    this.char.gait.phase = this.anim.phase;
    if (this.procW === 0) { this.char.poseDriven(this.anim.renderPos, this.anim.renderYaw, ctx, this.mats); return; }
    // The procedural pose first; remembered; then the driven one; then a blend of the two (the sword too).
    this.char.updateVisual(alpha, ctx);
    if (this.procW > 0.999) return;
    const sword = (this.char as any).sword as THREE.Object3D | undefined;
    if (sword) { this.swordP.copy(sword.position); this.swordQ.copy(sword.quaternion); }
    for (const part of this.offsets.keys()) {
      const g = this.char.parts[part];
      let s = this.saved.get(part);
      if (!s) { s = { p: new THREE.Vector3(), q: new THREE.Quaternion() }; this.saved.set(part, s); }
      s.p.copy(g.position); s.q.copy(g.quaternion);
    }
    this.char.poseDriven(this.anim.renderPos, this.anim.renderYaw, ctx, this.mats);
    const w = this.procW * this.procW * (3 - 2 * this.procW);
    for (const [part, s] of this.saved) {
      const g = this.char.parts[part];
      g.position.lerp(s.p, w);
      g.quaternion.slerp(s.q, w);
      g.updateMatrix();
    }
    if (sword) { sword.position.lerp(this.swordP, w); sword.quaternion.slerp(this.swordQ, w); }
  }
  private swordP = new THREE.Vector3();
  private swordQ = new THREE.Quaternion();

  update(dt: number, ctx: PoseContext) { this.char.update(dt, ctx); }
  // Where v1's arms hold the kitten (its own carry pose holds her there).
  holdPoint(out: THREE.Vector3) { return (this.char as any).holdPoint ? (this.char as any).holdPoint(out) : this.anim.holdPoint(out); }
  resetCloth() { (this.char as any).resetCloth?.(); }
  play(name: string) { this.anim.play(name); }
  headPos(out: THREE.Vector3) { return this.anim.headPos(out); }
  occluders() { return this.anim.occluders(); }
}
