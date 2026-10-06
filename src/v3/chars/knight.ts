// The knight (v3): placeholder until the toy model lands. Same API as the final one.
import * as THREE from 'three';
import { CharacterBody, PoseContext } from '../body';
import { toy, metal, PAL } from '../render/materials';
import type { ToyCharacter } from './api';

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
  private head = new THREE.Mesh();
  async load() {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 12), toy(PAL.cloth));
    body.position.y = 0.85; body.castShadow = true;
    this.head = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16), metal());
    this.head.position.y = 1.62; this.head.castShadow = true;
    this.group.add(body, this.head);
  }
  setOutfit(o: Partial<{ wounded: boolean }>) { Object.assign(this.outfit, o); }
  play(_name: string) {}
  beginSlide() { this.seated = 1; }
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
  holdPoint(out: THREE.Vector3) { return out.copy(this.renderPos).add(new THREE.Vector3(Math.sin(this.renderYaw) * 0.35, 1.1, Math.cos(this.renderYaw) * 0.35)); }
  headPos(out: THREE.Vector3) { return this.head.getWorldPosition(out); }
  spheres() { const p = this.renderPos; return [0.3, 0.8, 1.3, 1.65].map((y) => new THREE.Sphere(p.clone().add(new THREE.Vector3(0, y, 0)), 0.32)); }
  setFade(_f: number) {}
}
