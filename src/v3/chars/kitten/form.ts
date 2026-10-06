// What her two forms share with the kitten that owns them (chars/kitten.ts): the four-legged bare kitten of the
// prologue (quad.ts) and the little armoured knight on two legs from Chapter One on (biped.ts). The owner keeps the
// gameplay body, the story controls and the outfit, places her group each frame, and hands the pose to the form in use.
import type * as THREE from 'three';
import type { CharacterBody, PoseContext } from '../../body';
import type { ToyCharacter } from '../api';

export type Outfit = { armour: boolean; cape: boolean; bow: boolean };
export type Meow = 'meow' | 'mew' | 'mrrp' | 'cry';

export interface KittenHost {
  body: CharacterBody;
  group: THREE.Group;
  renderPos: THREE.Vector3; renderYaw: number;
  carriedBy: ToyCharacter | null;
  sit: number; crouch: number; curl: number; nudge: number;
  lookTarget: THREE.Vector3 | null;
  outfit: Outfit;
}

export interface KittenForm {
  // Everything the form draws, hung under the owner's group while the form is in use.
  root: THREE.Object3D;
  load(): Promise<void>;
  applyOutfit(): void;
  // Straight to the pose her state calls for (spawns, teleports), the group already placed.
  reset(ground: (x: number, z: number) => number): void;
  // Each rendered frame, after the owner has placed (and updated) her group.
  pose(dt: number, ctx: PoseContext): void;
  // The cape's step (after the pose).
  cloth(dt: number): void;
  resetCloth(): void;
  headPos(out: THREE.Vector3): THREE.Vector3;
  spheres(out: THREE.Sphere[]): THREE.Sphere[];
  meow(kind: Meow): void;
}
