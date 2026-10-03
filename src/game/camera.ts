// Observational third-person camera: calm framing, damped follow, per-character framing offsets blended on
// switch, terrain/wall collision with a kitten-scale near-plane check, opening reveal and fixed review presets.
import * as THREE from 'three/webgpu';
import { Character } from '../chars/character';
import { PhysicsWorld, MASK } from './physics';
import { LOOK } from '../render/settings';

// Full-frame-equivalent focal length to vertical FOV (24 mm sensor height).
export const fovFromMM = (mm: number) => THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));

const FRAMING = {
  knight: { dist: 4.4, height: 1.42, pitch: 0.16, mm: 38, shoulder: 0.32, minDist: 1.2, maxDist: 9 },
  kitten: { dist: 1.65, height: 0.27, pitch: 0.2, mm: 36, shoulder: 0.1, minDist: 0.5, maxDist: 5 },
};

type Preset = { name: string; pos: (k: Character, n: Character) => THREE.Vector3; look: (k: Character, n: Character) => THREE.Vector3; mm: number; dof: number; focus: (k: Character, n: Character, cam: THREE.Vector3) => number };

export class CameraRig {
  cam: THREE.PerspectiveCamera;
  yaw = Math.PI; pitch = 0.18;
  zoom = 1;
  frame = { dist: 1.65, height: 0.27, pitch: 0.2, mm: 36, shoulder: 0.1 };
  target = new THREE.Vector3();
  targetVel = new THREE.Vector3();
  camPos = new THREE.Vector3();
  mode: 'reveal' | 'play' | 'preset' = 'reveal';
  revealT = 0;
  revealDur = 15;
  presetIndex = 0;
  blendFromReveal = 0;
  private revealEndPos = new THREE.Vector3(); private revealEndLook = new THREE.Vector3();
  private lastLook = new THREE.Vector3();
  private idleT = 0;
  private liftPitch = 0;

  presets: Preset[] = [
    {
      name: 'Kitten close-up',
      pos: (k) => k.toWorld(new THREE.Vector3(0.05, k.parts.head.position.y + 0.012, 0.36), new THREE.Vector3()),
      look: (k) => k.toWorld(new THREE.Vector3(0, k.parts.head.position.y - 0.005, 0), new THREE.Vector3()),
      mm: 65, dof: 0.85, focus: (k, _n, c) => c.distanceTo(k.group.position) - 0.02,
    },
    {
      name: 'Paired reveal',
      pos: (k, n) => { const m = k.group.position.clone().lerp(n.group.position, 0.5); const f = new THREE.Vector3(Math.sin(k.body.yaw), 0, Math.cos(k.body.yaw)); return m.add(f.multiplyScalar(4.6)).add(new THREE.Vector3(0, 0.95, 0)).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 0.5); },
      look: (k, n) => k.group.position.clone().lerp(n.group.position, 0.5).add(new THREE.Vector3(0, 0.78, 0)),
      mm: 50, dof: 0.35, focus: (k, n, c) => c.distanceTo(k.group.position.clone().lerp(n.group.position, 0.5)),
    },
    {
      name: 'Field wide',
      pos: (k, n) => { const m = k.group.position.clone().lerp(n.group.position, 0.5); const f = new THREE.Vector3(Math.sin(k.body.yaw), 0, Math.cos(k.body.yaw)); return m.add(f.multiplyScalar(17)).add(new THREE.Vector3(3, 2.1, 0)); },
      look: (k, n) => k.group.position.clone().lerp(n.group.position, 0.5).add(new THREE.Vector3(0, 1.3, 0)),
      mm: 40, dof: 0.0, focus: (k, _n, c) => c.distanceTo(k.group.position),
    },
    {
      name: 'Knight helmet',
      pos: (_k, n) => n.toWorld(new THREE.Vector3(-0.35, 1.62, 1.05), new THREE.Vector3()),
      look: (_k, n) => n.toWorld(new THREE.Vector3(0, 1.55, 0), new THREE.Vector3()),
      mm: 60, dof: 0.6, focus: (_k, n, c) => c.distanceTo(n.toWorld(new THREE.Vector3(0, 1.55, 0), new THREE.Vector3())),
    },
  ];

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(fovFromMM(36), aspect, 0.015, 6000);
  }

  // Opening reveal: starts close on the kitten's face, then slowly widens until the knight and both upright swords
  // establish scale. No dialogue; the camera simply observes two knights standing together.
  updateReveal(dt: number, kitten: Character, knight: Character) {
    this.revealT += dt;
    const t = this.revealT;
    const headY = kitten.parts.head.position.y;
    const p0 = kitten.toWorld(new THREE.Vector3(-0.08, headY + 0.012, 0.56), new THREE.Vector3());
    const l0 = kitten.toWorld(new THREE.Vector3(0, headY - 0.03, 0), new THREE.Vector3());
    const p0b = kitten.toWorld(new THREE.Vector3(-0.06, headY + 0.012, 0.46), new THREE.Vector3());
    const mid = kitten.group.position.clone().lerp(knight.group.position, 0.5);
    const f = new THREE.Vector3(Math.sin(kitten.body.yaw), 0, Math.cos(kitten.body.yaw));
    const side = new THREE.Vector3(f.z, 0, -f.x);
    const p1 = mid.clone().addScaledVector(f, 5.2).addScaledVector(side, 0.9).add(new THREE.Vector3(0, 0.62, 0));
    const l1 = mid.clone().add(new THREE.Vector3(0, 0.82, 0));
    let pos: THREE.Vector3, look: THREE.Vector3, mm: number;
    const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
    if (t < 4.5) {
      const a = t / 4.5;
      pos = p0.clone().lerp(p0b, a); look = l0; mm = 62;
      LOOK.dofAmount.value = 1; LOOK.focusDistance.value = pos.distanceTo(l0) + 0.01;
    } else if (t < 12.5) {
      const a = ease((t - 4.5) / 8);
      // Pull back low over the grass and rise, keeping the kitten in frame while the knight enters.
      pos = p0b.clone().lerp(p1, a);
      pos.y += Math.sin(Math.PI * a) * 0.2;
      look = l0.clone().lerp(l1, ease(Math.min(1, a * 1.15)));
      mm = THREE.MathUtils.lerp(62, 48, a);
      LOOK.dofAmount.value = THREE.MathUtils.lerp(1, 0.3, a);
      LOOK.focusDistance.value = pos.distanceTo(kitten.group.position.clone().lerp(mid, a));
    } else {
      pos = p1.clone(); look = l1.clone(); mm = 48;
      pos.addScaledVector(side, (t - 12.5) * 0.02);
      LOOK.dofAmount.value = 0.3; LOOK.focusDistance.value = pos.distanceTo(mid);
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(look);
    this.cam.fov = fovFromMM(mm);
    this.cam.updateProjectionMatrix();
    this.revealEndPos.copy(pos); this.revealEndLook.copy(look);
    return t >= this.revealDur;
  }

  endReveal(active: Character) {
    this.mode = 'play';
    this.blendFromReveal = 1;
    const d = new THREE.Vector3().subVectors(this.cam.position, active.group.position);
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = 0.2;
    this.target.copy(active.group.position);
    this.camPos.copy(this.cam.position);
  }

  setPreset(i: number) { this.mode = i < 0 ? 'play' : 'preset'; this.presetIndex = i; }

  updatePreset(kitten: Character, knight: Character) {
    const p = this.presets[this.presetIndex];
    const pos = p.pos(kitten, knight), look = p.look(kitten, knight);
    this.cam.position.copy(pos);
    this.cam.lookAt(look);
    this.cam.fov = fovFromMM(p.mm);
    this.cam.updateProjectionMatrix();
    LOOK.dofAmount.value = p.dof;
    LOOK.focusDistance.value = p.focus(kitten, knight, pos);
  }

  update(dt: number, active: Character, companion: Character, lookIn: THREE.Vector2, zoomIn: number, physics: PhysicsWorld, moving: boolean) {
    const fr = FRAMING[active.kind];
    // Blend framing toward the active character's settings (switch blend).
    const k = 1 - Math.exp(-dt * 2.6);
    this.frame.dist += (fr.dist - this.frame.dist) * k;
    this.frame.height += (fr.height - this.frame.height) * k;
    this.frame.mm += (fr.mm - this.frame.mm) * k;
    this.frame.shoulder += (fr.shoulder - this.frame.shoulder) * k;
    this.yaw += lookIn.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - lookIn.y, -0.35, 1.1);
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.1, zoomIn), 0.45, 2.2);
    // Gentle auto-follow behind the active character after a pause in manual look.
    if (lookIn.lengthSq() > 0) this.idleT = 0; else this.idleT += dt;
    if (moving && this.idleT > 1.5) {
      const behind = active.body.yaw + Math.PI;
      const diff = Math.atan2(Math.sin(behind - this.yaw), Math.cos(behind - this.yaw));
      this.yaw += diff * Math.min(1, dt * 0.6);
    }
    // Critically damped target follow so switches glide rather than cut.
    const goal = active.group.position.clone().add(new THREE.Vector3(0, this.frame.height, 0));
    const w = 7.0;
    const accel = goal.clone().sub(this.target).multiplyScalar(w * w).addScaledVector(this.targetVel, -2 * w);
    this.targetVel.addScaledVector(accel, dt);
    this.target.addScaledVector(this.targetVel, dt);
    const dist = THREE.MathUtils.clamp(this.frame.dist * this.zoom, fr.minDist, fr.maxDist);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.target.clone().addScaledVector(right, this.frame.shoulder * Math.min(1, dist / 3));
    // Collision: probe from the pivot toward the wanted position; walls, rocks and terrain pull it in.
    const probe = (pitch: number) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const w = pivot.clone().addScaledVector(new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp), dist);
      const steps = 24, o = { x: 0, z: 0 };
      let free = 1;
      for (let i = 1; i <= steps; i++) {
        const p = pivot.clone().lerp(w, i / steps);
        if (physics.resolve(p.x, p.z, 0.12, p.y - 0.1, p.y + 0.1, MASK.all | MASK.camera, o)) { free = Math.max(0.05, (i - 1.2) / steps); break; }
        if (physics.groundAt(p.x, p.z, p.y) > p.y - 0.08) { free = Math.max(0.05, (i - 1) / steps); break; }
      }
      return { w, free };
    };
    // When something blocks the view from behind, rise and look down over it rather than diving into the
    // character; ease back down once the way is clear.
    // Pulling in is preferred up to about half the distance; only then does the camera climb, and not far.
    let needed = 0;
    if (probe(this.pitch).free < 0.55) {
      const top = Math.min(1.0, this.pitch + 0.65);
      needed = Math.max(0, top - this.pitch);
      for (let a = 0.13; this.pitch + a <= top + 1e-6; a += 0.13) if (probe(this.pitch + a).free >= 0.55) { needed = a; break; }
    }
    this.liftPitch += (needed - this.liftPitch) * Math.min(1, dt * (needed > this.liftPitch ? 3.0 : 1.0));
    const res = probe(this.pitch + this.liftPitch);
    let want = pivot.clone().lerp(res.w, Math.max(res.free, Math.min(1, fr.minDist / dist)));
    const clearance = active.kind === 'kitten' ? 0.07 : 0.22;
    const gy = physics.groundAt(want.x, want.z, want.y + 0.5);
    if (want.y < gy + clearance) want.y = gy + clearance;
    const kp = 1 - Math.exp(-dt * 10);
    this.camPos.lerp(want, kp);
    if (this.blendFromReveal > 0) {
      this.blendFromReveal = Math.max(0, this.blendFromReveal - dt / 2.2);
      const b = this.blendFromReveal * this.blendFromReveal * (3 - 2 * this.blendFromReveal);
      this.cam.position.lerpVectors(this.camPos, this.revealEndPos, b);
      this.lastLook.lerpVectors(this.target, this.revealEndLook, b);
    } else {
      this.cam.position.copy(this.camPos);
      this.lastLook.copy(this.target);
    }
    this.cam.lookAt(this.lastLook);
    this.cam.fov = fovFromMM(this.frame.mm);
    this.cam.updateProjectionMatrix();
    // Broad gameplay focus; DoF only as a whisper.
    LOOK.dofAmount.value += (0.0 - LOOK.dofAmount.value) * Math.min(1, dt * 1.5);
    LOOK.focusDistance.value = this.cam.position.distanceTo(active.group.position);
    void companion;
  }

  isVisible(p: THREE.Vector3) {
    const v = p.clone().project(this.cam);
    return v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
  }
}
