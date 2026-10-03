// Engine v2 follow camera: an orbit around the active character on a spring arm. A swept ball keeps the arm out of
// walls (it pulls in at once and eases back out). Platformer framing: it holds the ground level rather than riding
// every jump (the horizon stays put through a hop), looks a little ahead of the motion, and swings gently behind the
// direction of travel once the player leaves the camera alone. Switching characters glides between their framings,
// and the end of a cutscene blends from the cutscene's last shot.
import * as THREE from 'three/webgpu';
import { Physics, L } from './physics';
import { LOOK } from '../render/settings';
import type { Kind } from './motor';

// Full-frame-equivalent focal length to vertical field of view (24 mm sensor height).
export const fovFromMM = (mm: number) => THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));

type Framing = { dist: number; height: number; mm: number; radius: number; minDist: number; ahead: number; band: number; pitch: number };
export const FRAMING: Record<Kind, Framing> = {
  knight: { dist: 5.2, height: 1.45, mm: 28, radius: 0.18, minDist: 0.9, ahead: 0.55, band: 1.6, pitch: 0.3 },
  kitten: { dist: 2.5, height: 0.3, mm: 28, radius: 0.07, minDist: 0.35, ahead: 0.3, band: 0.8, pitch: 0.32 },
};

export type Subject = { pos: THREE.Vector3; vel: THREE.Vector3; grounded: boolean; climbing: boolean; kind: Kind; yaw: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _dir = new THREE.Vector3(), _goal = new THREE.Vector3(), _head = new THREE.Vector3(), _acc = new THREE.Vector3(), _q = new THREE.Quaternion();

export class FollowCamera {
  cam: THREE.PerspectiveCamera;
  yaw = Math.PI; pitch = 0.3; zoom = 1;
  frame: Framing = { ...FRAMING.knight };
  pivot = new THREE.Vector3(); pivotVel = new THREE.Vector3();
  refY = 0; // the ground level held while the subject is in the air
  dist = 5; // the arm's length after collision
  handheld = 1;
  private idle = 10;
  private t = 0;
  private blend: { t: number; dur: number; pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(fovFromMM(28), aspect, 0.03, 6000);
  }

  // Straight to a subject, behind it (spawn, respawn, a teleport).
  snap(s: Subject, yaw = s.yaw + Math.PI) {
    Object.assign(this.frame, FRAMING[s.kind]);
    this.yaw = yaw; this.pitch = this.frame.pitch;
    this.refY = s.pos.y;
    this.pivot.set(s.pos.x, s.pos.y + this.frame.height, s.pos.z);
    this.pivotVel.set(0, 0, 0);
    this.dist = this.frame.dist * this.zoom;
    this.blend = null;
    this.place(0);
  }

  // Into play from a cutscene's last shot: the arm takes the shot's direction, and the view blends over `dur`.
  takeOver(s: Subject, dur = 1.1) {
    const c = this.cam;
    const from = { t: 0, dur, pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov };
    const dx = c.position.x - s.pos.x, dz = c.position.z - s.pos.z, dy = c.position.y - (s.pos.y + FRAMING[s.kind].height);
    this.snap(s, Math.atan2(dx, dz));
    this.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.2, 0.9);
    this.place(0);
    this.blend = from;
  }

  update(dt: number, s: Subject, look: THREE.Vector2, zoomIn: number, physics: Physics) {
    this.t += dt;
    const want = FRAMING[s.kind], f = this.frame, k = 1 - Math.exp(-dt * 3);
    f.dist += (want.dist - f.dist) * k; f.height += (want.height - f.height) * k; f.mm += (want.mm - f.mm) * k;
    f.radius += (want.radius - f.radius) * k; f.minDist += (want.minDist - f.minDist) * k; f.ahead += (want.ahead - f.ahead) * k;
    f.band += (want.band - f.band) * k;
    // The player's own camera.
    this.yaw += look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -0.45, 1.2);
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.1, zoomIn), 0.6, 1.8);
    if (look.lengthSq() > 1e-8) this.idle = 0; else this.idle += dt;
    // Left alone, it swings round behind the direction of travel (never all the way round toward a subject running
    // at the lens, which would spin the world about).
    const sp = Math.hypot(s.vel.x, s.vel.z);
    if (this.idle > 1.2 && sp > 0.5 && !s.climbing) {
      const diff = wrap(Math.atan2(s.vel.x, s.vel.z) + Math.PI - this.yaw);
      if (Math.abs(diff) < 2.3) this.yaw += diff * Math.min(1, dt * 0.9 * Math.min(1, sp / 3));
    }
    // Height: the ground under the subject, not the top of every jump. It follows a fall at once and a rise past
    // the band (a climb, a throw).
    if (s.grounded || s.climbing) this.refY += (s.pos.y - this.refY) * Math.min(1, dt * 6);
    else {
      if (s.pos.y < this.refY - 0.15) this.refY = s.pos.y + 0.15;
      if (s.pos.y > this.refY + f.band) this.refY = s.pos.y - f.band;
    }
    const run = 4.4;
    _goal.set(s.pos.x + (s.vel.x / run) * f.ahead, this.refY + f.height, s.pos.z + (s.vel.z / run) * f.ahead);
    if (_goal.distanceTo(this.pivot) > 30) { this.pivot.copy(_goal); this.pivotVel.set(0, 0, 0); }
    // Critically damped follow, so a switch of character glides rather than cuts.
    const w = 7.5;
    _acc.subVectors(_goal, this.pivot).multiplyScalar(w * w).addScaledVector(this.pivotVel, -2 * w);
    this.pivotVel.addScaledVector(_acc, dt);
    this.pivot.addScaledVector(this.pivotVel, dt);
    // The lagging pivot must not end up inside a wall the subject is running along: sweep from the head to it.
    _head.set(s.pos.x, s.pos.y + f.height, s.pos.z);
    const toPivot = _dir.subVectors(this.pivot, _head);
    const tl = toPivot.length();
    if (tl > 1e-4) {
      const h = physics.sphereCast(_head, toPivot, f.radius, tl, L.world);
      if (h) this.pivot.copy(_head).addScaledVector(toPivot.normalize(), Math.max(0, h.dist - 0.01));
    }
    // The arm: in at once when something comes between, back out gently.
    const arm = THREE.MathUtils.clamp(f.dist * this.zoom, f.minDist, 12);
    this.dirOf(_dir);
    const hit = physics.sphereCast(this.pivot, _dir, f.radius, arm, L.world);
    const free = hit ? Math.max(f.minDist * 0.4, hit.dist - 0.02) : arm;
    if (free < this.dist) this.dist = free; else this.dist += (free - this.dist) * Math.min(1, dt * 2.2);
    this.place(dt);
  }

  private dirOf(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  private place(dt: number) {
    const c = this.cam;
    c.position.copy(this.pivot).addScaledVector(this.dirOf(_dir), this.dist);
    c.lookAt(this.pivot);
    // A faint handheld drift: a camera operator's breathing, never a shake.
    if (this.handheld > 0) {
      const t = this.t, a = 0.0035 * this.handheld;
      c.rotateY(a * (Math.sin(t * 0.61) * 0.6 + Math.sin(t * 1.37 + 1.3) * 0.4));
      c.rotateX(a * 0.8 * (Math.sin(t * 0.83 + 0.4) * 0.6 + Math.sin(t * 1.91 + 2.1) * 0.4));
    }
    c.fov = fovFromMM(this.frame.mm);
    if (this.blend) {
      const b = this.blend;
      b.t += dt;
      const a = Math.min(1, b.t / b.dur), e = a * a * (3 - 2 * a);
      c.position.lerpVectors(b.pos, c.position.clone(), e);
      c.quaternion.copy(_q.copy(b.quat).slerp(c.quaternion, e));
      c.fov = THREE.MathUtils.lerp(b.fov, c.fov, e);
      if (a >= 1) this.blend = null;
    }
    c.updateProjectionMatrix();
    LOOK.dofAmount.value = 0;
  }
}
