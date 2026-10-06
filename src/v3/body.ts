// The gameplay body every character shares (what the motor moves and the visuals read), and the wind.
import * as THREE from 'three';

// On a climbable face: the climber's place on it; `exit` animates the pull-up over the top.
export type ClimbState = {
  u: number; v: number; phase: number; speed: number;
  exit: null | { t: number; dur: number; from: THREE.Vector3; top: THREE.Vector3; to: THREE.Vector3 };
};

export class CharacterBody {
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; prevYaw = 0; turnRate = 0;
  radius: number; height: number;
  grounded = true; vy = 0;
  // Strength of the last landing (0..1), eased off by the pose.
  landing = 0;
  climb: ClimbState | null = null;
  swimming = false;
  // How deep the water stands round it (m).
  wade = 0;
  // How hard the wind is pushing it (0..1).
  wind = 0;
  // Visual-only height offset that eases to zero: a step up taken in one physics step reads as a quick hop.
  visualDY = 0;
  constructor(radius: number, height: number) { this.radius = radius; this.height = height; }
}

export type PoseContext = {
  dt: number; time: number;
  ground: (x: number, z: number) => number;
  lookAt: THREE.Vector3 | null;
  active: boolean;
};

// The wind: a direction (x, z, unit), a base strength and gusts. Levels set it; grass, banners, the cape and the
// kitten's motor read it. `gust` 0..1 is the current gust; `push` is the force on a light body in the open (m/s²).
export const WIND = {
  dir: new THREE.Vector2(0.8, -0.6).normalize(),
  base: 0.3,
  gust: 0,
  push: 0,
  time: 0,
  // Whether a point is out of the wind (behind something solid upwind of it); set by the level.
  sheltered: (_p: THREE.Vector3) => false,
};
