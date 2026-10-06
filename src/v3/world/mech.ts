// Puzzle mechanisms (v3): leaves on hinges (gates, drop bridges, a trunk swung round its roots) driven by a progress
// value with their colliders, pins with her pink tassel, chunky steel-blue handles for him, the gust cycle with its
// warning, and the lee test (behind a rock, or behind him). Every hold is a latch and nothing here runs on a timer
// the player has to beat with two hands.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RAPIER, Physics, L, SOLID, Surface, Platform } from '../physics';
import { toy, metal, PAL } from '../render/materials';
import { WIND } from '../body';

export const PIN_PINK = '#ff7fa8';
export const HIS_BLUE = '#5b7fae';

// Easings for leaves: a door swings (smooth); a bridge falls (accelerating, with a little bounce as it lands).
export const EASE = {
  smooth: (x: number) => x * x * (3 - 2 * x),
  fall: (x: number) => (x < 0.82 ? (x / 0.82) ** 2 : 1 - Math.sin(((x - 0.82) / 0.18) * Math.PI) * 0.035),
  out: (x: number) => 1 - (1 - x) ** 3,
};

// A leaf turning about a hinge: `local` is the body's centre relative to the hinge with the leaf at angle 0. Its
// progress `p` runs toward `target` at `rate` per second; the angle is from + (to - from) * ease(p).
export class Hinge {
  p = 0; target = 0;
  platform: Platform;
  onArrive?: (p: number) => void;
  private q = new THREE.Quaternion();
  constructor(physics: Physics, public obj: THREE.Object3D, shapes: RAPIER.ColliderDesc[], public hinge: THREE.Vector3, public local: THREE.Vector3,
    public axis: THREE.Vector3, public from: number, public to: number, public rate = 0.8, public ease = EASE.smooth, public base = new THREE.Quaternion(), surface?: Surface, member = L.world) {
    obj.userData.dynamic = true;
    this.platform = physics.addPlatform(obj, shapes, (_t, pos, quat) => this.pose(pos, quat), surface, member);
  }
  get angle() { return this.from + (this.to - this.from) * this.ease(this.p); }
  pose(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.q.setFromAxisAngle(this.axis, this.angle);
    pos.copy(this.local).applyQuaternion(this.q).add(this.hinge);
    quat.copy(this.q).multiply(this.base);
  }
  // Jump to a state (a checkpoint restore).
  set(p: number) { this.p = this.target = p; this.rest = 0; }
  // At rest the body turns fixed: the character controller stalls on a kinematic body even when it isn't moving.
  private fixed = false;
  private rest = 0;
  private settle() {
    const b = this.platform.body;
    if (this.p === this.target) {
      if (!this.fixed && ++this.rest > 3) {
        b.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        b.setTranslation(this.platform.pos, true); b.setRotation(this.platform.quat, true);
        this.fixed = true;
      }
    } else {
      this.rest = 0;
      if (this.fixed) { b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true); this.fixed = false; }
    }
  }
  update(dt: number) {
    this.settle();
    if (this.p === this.target) return;
    const was = this.p;
    this.p = this.target > this.p ? Math.min(this.target, this.p + this.rate * dt) : Math.max(this.target, this.p - this.rate * dt);
    if (this.p === this.target && was !== this.p) this.onArrive?.(this.p);
  }
  get moving() { return this.p !== this.target; }
}

// A plank leaf (door, bridge): boards across, two battens, iron straps; centred on its middle.
export function plankLeaf(w: number, h: number, t: number, color: string = PAL.wood, horizontal = false) {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round((horizontal ? h : w) / 0.24));
  const mat = toy(color, { rough: 0.85 }), dark = toy(PAL.woodDark, { rough: 0.9 });
  for (let i = 0; i < n; i++) {
    const s = (horizontal ? h : w) / n;
    const geo = horizontal ? new RoundedBoxGeometry(w, s * 0.94, t, 1, 0.015) : new RoundedBoxGeometry(s * 0.94, h, t, 1, 0.015);
    const m = new THREE.Mesh(geo, i % 2 ? mat : toy(color, { rough: 0.8 }));
    if (horizontal) m.position.y = -h / 2 + s * (i + 0.5); else m.position.x = -w / 2 + s * (i + 0.5);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  for (const y of [-h * 0.3, h * 0.3]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w * 0.96, Math.min(0.14, h * 0.12), t * 0.5, 1, 0.01), dark);
    b.position.set(0, y, t * 0.6); b.castShadow = true;
    g.add(b);
  }
  return g;
}

// Her pin: a brass peg with a pink tassel, at kitten height. Returns the group (the peg points along +z).
export function pinMesh() {
  const g = new THREE.Group();
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10).rotateX(Math.PI / 2), metal(PAL.gold, 0.35));
  peg.position.z = 0.06; peg.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), metal(PAL.gold, 0.35));
  knob.position.z = 0.17;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), toy(PIN_PINK));
  cord.position.set(0, -0.06, 0.17);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 10), toy(PIN_PINK, { emissive: PIN_PINK, emissiveIntensity: 0.25 }));
  tassel.position.set(0, -0.15, 0.17); tassel.rotation.x = Math.PI;
  g.add(peg, knob, cord, tassel);
  g.name = 'Pin';
  return g;
}

// His handle: a chunky steel-blue bar.
export function handleMesh(len = 0.7) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 10).rotateZ(Math.PI / 2), metal(HIS_BLUE, 0.4));
  m.castShadow = true;
  return m;
}

// A rope (or chain) between points: a sagging tube, rebuilt when its ends move.
export class Rope {
  mesh: THREE.Mesh;
  constructor(public a: THREE.Vector3, public b: THREE.Vector3, public sag = 0.15, radius = 0.018, color = '#c9b07a') {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), toy(color, { rough: 0.9 }));
    this.mesh.userData.dynamic = true;
    this.mesh.castShadow = true;
    this.radius = radius;
    this.build();
  }
  private radius: number;
  build() {
    const mid = this.a.clone().lerp(this.b, 0.5); mid.y -= this.sag;
    const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(this.a, mid, this.b), 12, this.radius, 5, false);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}

// The gust cycle: a lull, a warning (the grass ripples, the streaks come, a rising whistle), the gust, and back.
// `phase` tells the level which; `strength` is 0..1 for the gust's force.
export class Gusts {
  t = 0;
  phase: 'lull' | 'warn' | 'gust' = 'lull';
  strength = 0;
  constructor(public period = 4.5, public warn = 1.0, public len = 1.5) {}
  update(dt: number) {
    this.t += dt;
    const p = this.t % this.period;
    const lull = this.period - this.warn - this.len;
    let s: number;
    if (p < lull) { this.phase = 'lull'; s = 0; }
    else if (p < lull + this.warn) { this.phase = 'warn'; s = 0.22 * ((p - lull) / this.warn); }
    else { this.phase = 'gust'; const q = (p - lull - this.warn) / this.len; s = Math.min(1, q * 6) * (q > 0.85 ? (1 - q) / 0.15 : 1); }
    this.strength = s;
    WIND.gust = Math.max(WIND.gust * Math.exp(-dt * 3), s);
    return this.phase;
  }
}

// Out of the wind: something solid close upwind of her (a rock, a wall, a cart), or the knight's lee, a wedge behind
// him that widens downwind.
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
export function shelteredAt(p: THREE.Vector3, physics: Physics, knight: THREE.Vector3 | null, reach = 2.6) {
  _d.set(-WIND.dir.x, 0, -WIND.dir.y);
  for (const y of [0.12, 0.26]) {
    _o.set(p.x, p.y + y, p.z);
    if (physics.raycast(_o, _d, reach, SOLID)) return true;
  }
  if (knight) {
    const dx = p.x - knight.x, dz = p.z - knight.z;
    const along = dx * WIND.dir.x + dz * WIND.dir.y;
    const across = Math.abs(-dx * WIND.dir.y + dz * WIND.dir.x);
    if (along > -0.25 && along < 2.6 && across < 0.5 + along * 0.18 && p.y < knight.y + 0.6 && p.y > knight.y - 0.6) return true;
  }
  return false;
}
