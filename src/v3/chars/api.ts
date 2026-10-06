// What the levels and the engine use of the two characters (v3). Story controls are targets (0..1) that the
// character eases toward on its own; all positions are world space unless noted.
import * as THREE from 'three';
import type { CharacterBody, PoseContext } from '../body';

export interface ToyCharacter {
  kind: 'kitten' | 'knight';
  body: CharacterBody;
  group: THREE.Object3D; // add to the scene once
  renderPos: THREE.Vector3; renderYaw: number;
  carriedBy: ToyCharacter | null;
  holding: ToyCharacter | null;
  load(): Promise<void>;
  resetPose(ground: (x: number, z: number) => number): void;
  // Each rendered frame: interpolate the body (alpha between physics steps) and pose everything.
  updateVisual(alpha: number, ctx: PoseContext): void;
  update(dt: number, ctx: PoseContext): void;
  headPos(out: THREE.Vector3): THREE.Vector3;
  // Spheres (world) covering the body, for camera checks and the camera's dissolve.
  spheres(): THREE.Sphere[];
  // 0 hidden .. 1 solid (dissolve when it stands between the lens and the other one).
  setFade(f: number): void;
}
