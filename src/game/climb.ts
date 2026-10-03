// Climbing, the kitten's own way through the world: run (or jump) into a climbable face (ivy on stone, a rough pier)
// and she takes hold; the stick climbs up, down and along it; at the top she vaults over a wall or pulls herself up
// onto a ledge; a jump pushes her off. The knight in plate cannot climb at all. Movement on the face is kinematic,
// outside the ground physics, and the pose (chars/kitten.ts) reads `body.climb`.
import * as THREE from 'three/webgpu';
import { Character } from '../chars/character';
import { PhysicsWorld, Climbable } from './physics';

const UP_SPEED = 0.7, SIDE_SPEED = 0.5; // m/s on the face
// Her body's centre line hangs this far out from the face (paws and toes on it, the plate just clear).
export const CLIMB_DIST = 0.075;

const facePoint = (c: Climbable, u: number, out: THREE.Vector3) => {
  const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
  return out.set(c.ax + ((c.bx - c.ax) * u) / len, 0, c.az + ((c.bz - c.az) * u) / len);
};

export function canClimb(k: Character) { return k.kind === 'kitten' && !k.carriedBy && !k.holding; }

// Take hold of a face she is moving into (dirX, dirZ: unit world direction of the input).
export function tryGrab(k: Character, physics: PhysicsWorld, dirX: number, dirZ: number) {
  const b = k.body;
  if (b.climb || !canClimb(k)) return false;
  const hit = physics.findClimb(b.pos, b.radius, dirX, dirZ);
  if (!hit) return false;
  const c = hit.panel;
  b.climb = { panel: c, u: hit.u, v: Math.max(b.pos.y, c.y0), phase: 0, speed: 0, exit: null };
  b.vel.set(0, 0, 0); b.vy = 0; b.grounded = false;
  return true;
}

// Off the face onto the ground (or into the air for a push-off).
function release(k: Character, physics: PhysicsWorld, pos: THREE.Vector3, airborne: boolean) {
  const b = k.body;
  b.climb = null;
  b.pos.copy(pos);
  if (!airborne) { b.pos.y = physics.groundAt(pos.x, pos.z, pos.y + 0.3); b.vy = 0; b.grounded = true; b.vel.set(0, 0, 0); }
  k.gait.reset(b.pos, b.yaw, (x, z) => physics.groundAt(x, z, b.pos.y + 0.3));
}

// One fixed step on the face. `move` is the stick (x right, y forward), `camYaw` turns sideways input so that
// pushing right moves right on screen.
export function climbStep(k: Character, physics: PhysicsWorld, move: THREE.Vector2, jump: boolean, camYaw: number, dt: number) {
  const b = k.body, cl = b.climb!, c = cl.panel;
  b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
  b.vel.set(0, 0, 0); b.vy = 0;
  const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
  const tx = (c.bx - c.ax) / len, tz = (c.bz - c.az) / len;
  b.yaw = Math.atan2(-c.nx, -c.nz);
  // Vault or mantle: up to the top edge, then over it and down onto the far side (or onto the ledge).
  if (cl.exit) {
    const e = cl.exit;
    e.t += dt;
    const a = Math.min(1, e.t / e.dur);
    if (a < 0.55) {
      const s = a / 0.55, es = s * s * (3 - 2 * s);
      b.pos.lerpVectors(e.from, e.top, es);
    } else {
      const s = (a - 0.55) / 0.45;
      b.pos.lerpVectors(e.top, e.to, s);
      // Over the top in a little arc, then a drop that speeds up like a fall.
      b.pos.y = THREE.MathUtils.lerp(e.top.y, e.to.y, s * s) + Math.sin(Math.PI * Math.min(1, s * 1.6)) * 0.05;
    }
    cl.phase += dt * 9;
    cl.speed = 0.6;
    if (a >= 1) release(k, physics, e.to, false);
    return;
  }
  const at = facePoint(c, cl.u, new THREE.Vector3());
  if (jump) {
    // Push off backwards and drop.
    release(k, physics, new THREE.Vector3(at.x + c.nx * (CLIMB_DIST + 0.04), cl.v, at.z + c.nz * (CLIMB_DIST + 0.04)), true);
    b.vel.set(c.nx * 1.3, 0, c.nz * 1.3); b.vy = 1.6; b.grounded = false;
    return;
  }
  const rightX = Math.cos(camYaw), rightZ = -Math.sin(camYaw);
  const sideSign = rightX * tx + rightZ * tz >= 0 ? 1 : -1;
  const up = THREE.MathUtils.clamp(move.y, -1, 1), side = THREE.MathUtils.clamp(move.x, -1, 1) * sideSign;
  const u0 = cl.u, v0 = cl.v;
  cl.u = THREE.MathUtils.clamp(cl.u + side * SIDE_SPEED * dt, 0.1, len - 0.1);
  cl.v += up * UP_SPEED * dt;
  facePoint(c, cl.u, at);
  const out = new THREE.Vector3(at.x + c.nx * CLIMB_DIST, 0, at.z + c.nz * CLIMB_DIST);
  // The ground below the face: pushing down there, she steps off.
  const floor = Math.max(c.y0, physics.groundAt(out.x, out.z, cl.v + 0.05));
  if (cl.v <= floor) {
    cl.v = floor;
    if (up < -0.3) { release(k, physics, new THREE.Vector3(out.x + c.nx * 0.05, floor, out.z + c.nz * 0.05), false); return; }
  }
  // The top: her paws are at the edge when her feet are this far below it.
  const topV = c.y1 - 0.2;
  if (cl.v >= topV) {
    cl.v = topV;
    if (up > 0.3 && c.exit !== 'none') {
      const top = new THREE.Vector3(at.x - c.nx * 0.04, c.y1 + 0.02, at.z - c.nz * 0.04);
      let to: THREE.Vector3;
      if (c.exit === 'over') {
        const far = (c.depth ?? 0.5) + 0.3;
        to = new THREE.Vector3(at.x - c.nx * far, 0, at.z - c.nz * far);
        to.y = physics.groundAt(to.x, to.z, c.y1);
        cl.exit = { t: 0, dur: 1.15, from: b.pos.clone(), top, to };
      } else {
        top.y = (c.ledgeTop ?? c.y1) + 0.03;
        to = new THREE.Vector3(at.x - c.nx * 0.24, c.ledgeTop ?? c.y1, at.z - c.nz * 0.24);
        cl.exit = { t: 0, dur: 0.75, from: b.pos.clone(), top, to };
      }
      return;
    }
  }
  // Ease onto the face from wherever she took hold (the grab can start a hand's breadth away).
  const ease = Math.min(1, dt * 12);
  b.pos.set(b.pos.x + (out.x - b.pos.x) * ease, cl.v, b.pos.z + (out.z - b.pos.z) * ease);
  const moved = Math.hypot(cl.u - u0, cl.v - v0);
  cl.speed = moved / dt;
  cl.phase += moved * 32; // one full reach-and-pull about every 0.2 m
}
