// The kitten (v3), in two forms that share her head, her coat and her gameplay body:
//  - the little knight (kitten/biped.ts, kitten/bipedModel.ts), from Chapter One on: a fluffy golden-fawn tabby kitten
//    standing on two legs in engraved silver plate, a long cream cape on her shoulders and a longsword in her paws,
//    as in the reference photo;
//  - the bare four-legged baby kitten of the prologue (kitten/quad.ts, kitten/model.ts), in the same coat.
// Which one is drawn follows her outfit (armour on: the knight), or `formOverride`. This class keeps what both share:
// the body and its interpolation, the story controls, the outfit, the smoothing into and out of the knight's hands, and
// the public API the levels and the engine use.
import * as THREE from 'three';
import { CharacterBody, PoseContext } from '../body';
import type { Fade } from '../render/materials';
import type { ToyCharacter } from './api';
import { QuadKitten } from './kitten/quad';
import { BipedKitten } from './kitten/biped';
import type { KittenForm, KittenHost, Meow, Outfit } from './kitten/form';

export type KittenFormName = 'biped' | 'quad';
const clamp = THREE.MathUtils.clamp;

export class ToyKitten implements ToyCharacter, KittenHost {
  kind = 'kitten' as const;
  body = new CharacterBody(0.09, 0.34);
  group = new THREE.Group();
  renderPos = new THREE.Vector3(); renderYaw = 0;
  carriedBy: ToyCharacter | null = null; holding: ToyCharacter | null = null;
  // Story controls (0..1 targets, eased).
  sit = 0; crouch = 0; curl = 0; nudge = 0;
  lookTarget: THREE.Vector3 | null = null;
  // Chapter One's outfit by default (the prologue sets her bare).
  outfit: Outfit = { armour: true, cape: true, bow: true };
  // Force a form whatever the outfit (null: armour on is the knight on two legs, off the kitten on four).
  formOverride: KittenFormName | null = null;

  private fade: Fade = { value: 1 };
  private quad = new QuadKitten(this, this.fade);
  private biped = new BipedKitten(this, this.fade);
  private current: KittenForm | null = null;
  private loaded = false;
  // Smooths her into and out of the knight's hands.
  private carryOff = new THREE.Vector3(); private carryYaw = 0; private wasCarried = false;
  private lastRender = new THREE.Vector3(); private lastRenderYaw = 0;
  private sphereList: THREE.Sphere[] = [new THREE.Sphere(), new THREE.Sphere(), new THREE.Sphere(), new THREE.Sphere()];
  private lastGround: (x: number, z: number) => number = () => 0;

  get form(): KittenFormName { return this.formOverride ?? (this.outfit.armour ? 'biped' : 'quad'); }

  async load() {
    this.group.name = 'kitten';
    await Promise.all([this.quad.load(), this.biped.load()]);
    this.loaded = true;
    this.applyForm();
  }

  setOutfit(o: Partial<Outfit>) {
    const hadCape = this.outfit.cape;
    Object.assign(this.outfit, o);
    if (!this.loaded) return;
    this.quad.applyOutfit(); this.biped.applyOutfit();
    if (!this.applyForm() && this.outfit.cape && !hadCape) this.current?.resetCloth();
  }

  // Shows the form her outfit (or the override) calls for; true if it changed.
  private applyForm() {
    const want = this.form === 'biped' ? this.biped : this.quad;
    if (want === this.current) return false;
    if (this.current) this.group.remove(this.current.root);
    this.current = want;
    this.group.add(want.root);
    want.applyOutfit();
    this.place();
    this.group.updateMatrixWorld(true);
    want.reset(this.lastGround);
    return true;
  }
  // Switch the form now (e.g. a level flipping the prologue to the knight); null returns it to the outfit.
  setForm(f: KittenFormName | null) { this.formOverride = f; if (this.loaded) this.applyForm(); }

  meow(kind: Meow = 'meow') { this.current?.meow(kind); }

  // The prologue ends asleep in his lap. Clear its persistent targets before changing outfit/chapter so the
  // biped's very first pose is upright rather than inheriting that curl from the four-legged form.
  resetStoryPose() {
    this.sit = this.crouch = this.curl = this.nudge = 0;
    this.lookTarget = null;
    this.setForm(null);
  }

  resetPose(ground: (x: number, z: number) => number) {
    const b = this.body;
    this.lastGround = ground;
    this.renderPos.copy(b.pos); this.renderYaw = b.yaw;
    this.lastRender.copy(b.pos); this.lastRenderYaw = b.yaw;
    this.carryOff.set(0, 0, 0); this.carryYaw = 0; this.wasCarried = this.carriedBy !== null;
    b.visualDY = 0;
    this.place();
    this.group.updateMatrixWorld(true);
    this.current?.reset(ground);
  }

  private place() { this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0); }

  updateVisual(alpha: number, ctx: PoseContext) {
    const b = this.body, dt = clamp(ctx.dt, 0, 0.1);
    this.lastGround = ctx.ground;
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    if (b.visualDY !== 0) {
      this.renderPos.y += b.visualDY;
      b.visualDY *= Math.exp(-dt * 18);
      if (Math.abs(b.visualDY) < 1e-4) b.visualDY = 0;
    }
    const dy = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    this.renderYaw = b.prevYaw + dy * alpha;
    // Lifted up or set down: she travels there over a moment instead of in one step.
    const carried = this.carriedBy !== null;
    if (carried !== this.wasCarried) {
      this.wasCarried = carried;
      if (this.lastRender.distanceTo(this.renderPos) < 3) {
        this.carryOff.copy(this.lastRender).sub(this.renderPos);
        this.carryYaw = Math.atan2(Math.sin(this.lastRenderYaw - this.renderYaw), Math.cos(this.lastRenderYaw - this.renderYaw));
      }
    }
    const k = Math.exp(-dt * 9);
    this.carryOff.multiplyScalar(k); this.carryYaw *= k;
    this.renderPos.add(this.carryOff); this.renderYaw += this.carryYaw;
    this.lastRender.copy(this.renderPos); this.lastRenderYaw = this.renderYaw;
    this.place();
    if (!this.current) return;
    this.group.updateMatrixWorld(true);
    this.current.pose(dt, { ...ctx, dt });
  }

  update(dt: number, _ctx: PoseContext) {
    if (!this.current || !this.outfit.cape) return;
    this.current.cloth(dt);
  }

  // Lays the cape out afresh (spawns, teleports, respawns).
  resetCloth() { this.current?.resetCloth(); }

  headPos(out: THREE.Vector3) { return this.current ? this.current.headPos(out) : out.copy(this.renderPos).setY(this.renderPos.y + 0.2); }

  // Rump, chest and head (and the tail), world space.
  spheres() {
    const s = this.sphereList;
    if (!this.current) { for (const x of s) x.set(x.center.copy(this.renderPos).setY(this.renderPos.y + 0.15), 0.16); return s; }
    return this.current.spheres(s);
  }

  setFade(f: number) { this.fade.value = f; }

  // How many triangles and meshes she is drawn with now (for budgets and tests).
  stats() {
    let meshes = 0, draws = 0, tris = 0;
    this.group.traverse((o: any) => {
      if (!o.isMesh || !o.visible) return;
      meshes++;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      if (Array.isArray(o.material)) {
        for (const gr of g.groups) { const m = o.material[gr.materialIndex]; if (m && m.visible !== false) { draws++; tris += Math.min(gr.count, n - gr.start) / 3; } }
      } else { draws++; tris += n / 3; }
    });
    return { form: this.form, meshes, draws, tris: Math.round(tris) };
  }
}
