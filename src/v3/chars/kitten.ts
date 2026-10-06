// The kitten (v3): placeholder until the toy model lands. Same API as the final one.
import * as THREE from 'three';
import { CharacterBody, PoseContext } from '../body';
import { toy, PAL } from '../render/materials';
import type { ToyCharacter } from './api';

export class ToyKitten implements ToyCharacter {
  kind = 'kitten' as const;
  body = new CharacterBody(0.09, 0.34);
  group = new THREE.Group();
  renderPos = new THREE.Vector3(); renderYaw = 0;
  carriedBy: ToyCharacter | null = null; holding: ToyCharacter | null = null;
  // Story controls (0..1 targets, eased).
  sit = 0; crouch = 0; curl = 0; nudge = 0;
  lookTarget: THREE.Vector3 | null = null;
  outfit = { armour: false, cape: false, bow: false };
  private head = new THREE.Mesh();
  async load() {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.14, 4, 12).rotateX(Math.PI / 2), toy(PAL.ginger));
    body.position.y = 0.12; body.castShadow = true;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), toy(PAL.cream));
    this.head.position.set(0, 0.22, 0.12); this.head.castShadow = true;
    this.group.add(body, this.head);
  }
  setOutfit(o: Partial<{ armour: boolean; cape: boolean; bow: boolean }>) { Object.assign(this.outfit, o); }
  meow(_kind: 'meow' | 'mew' | 'mrrp' | 'cry' = 'meow') {}
  resetPose(_g: (x: number, z: number) => number) { this.renderPos.copy(this.body.pos); this.renderYaw = this.body.yaw; this.place(); }
  private place() { this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0); }
  updateVisual(alpha: number, _ctx: PoseContext) {
    const b = this.body;
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    const dy = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
    this.renderYaw = b.prevYaw + dy * alpha;
    this.place();
  }
  update(_dt: number, _ctx: PoseContext) {}
  headPos(out: THREE.Vector3) { return this.head.getWorldPosition(out); }
  spheres() { return [new THREE.Sphere(this.renderPos.clone().add(new THREE.Vector3(0, 0.15, 0)), 0.16)]; }
  setFade(_f: number) {}
}
