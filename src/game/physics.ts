// Fixed-step kinematic character physics against simplified static collision (separate from visual meshes).
// Colliders carry a mask so scale matters: a culvert blocks the knight but admits the kitten.
import { heightAt } from '../world/layout';
import { CharacterBody, Kind } from '../chars/character';

// `camera` colliders (low ceilings, overhangs) only stop the camera; characters ignore them.
export const MASK = { knight: 1, kitten: 2, all: 3, camera: 4 } as const;

export type Collider =
  | { id?: string; kind: 'circle'; x: number; z: number; r: number; yMin: number; yMax: number; mask: number; enabled: boolean }
  | { id?: string; kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; yMin: number; yMax: number; mask: number; enabled: boolean };

export type Platform =
  | { id?: string; kind: 'circle'; x: number; z: number; r: number; top: number }
  | { id?: string; kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; top: number };

export class PhysicsWorld {
  colliders: Collider[] = [];
  platforms: Platform[] = [];
  boundsRadius = 92;

  addBox(x: number, z: number, hx: number, hz: number, rot: number, yMin: number, yMax: number, mask = MASK.all, id?: string) {
    const c: Collider = { id, kind: 'box', x, z, hx, hz, rot, yMin, yMax, mask, enabled: true };
    this.colliders.push(c);
    return c;
  }
  addCircle(x: number, z: number, r: number, yMin: number, yMax: number, mask = MASK.all, id?: string) {
    const c: Collider = { id, kind: 'circle', x, z, r, yMin, yMax, mask, enabled: true };
    this.colliders.push(c);
    return c;
  }
  // Wall segment from (ax,az) to (bx,bz).
  addWall(ax: number, az: number, bx: number, bz: number, thick: number, yMin: number, yMax: number, mask = MASK.all, id?: string) {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bz - az, bx - ax);
    return this.addBox((ax + bx) / 2, (az + bz) / 2, len / 2, thick / 2, rot, yMin, yMax, mask, id);
  }
  get(id: string) { return this.colliders.find((c) => c.id === id); }

  groundAt(x: number, z: number, feetY = Infinity, step = 0.3) {
    let g = heightAt(x, z);
    for (const p of this.platforms) {
      if (p.top > feetY + step) continue;
      if (!insidePlatform(p, x, z)) continue;
      g = Math.max(g, p.top);
    }
    return g;
  }

  // Push a circle out of all colliders that block this mask at this height. Returns true if blocked.
  resolve(x: number, z: number, r: number, y0: number, y1: number, mask: number, out: { x: number; z: number }) {
    let px = x, pz = z, hit = false;
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.colliders) {
        if (!c.enabled || (c.mask & mask) === 0 || y1 < c.yMin || y0 > c.yMax) continue;
        if (c.kind === 'circle') {
          const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz), m = c.r + r;
          if (d < m && d > 1e-6) { px = c.x + (dx / d) * m; pz = c.z + (dz / d) * m; hit = true; }
        } else {
          const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
          const lx = (px - c.x) * cs + (pz - c.z) * sn, lz = -(px - c.x) * sn + (pz - c.z) * cs;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
          let dx = lx - qx, dz = lz - qz;
          let d = Math.hypot(dx, dz);
          if (d < r) {
            let nx: number, nz: number;
            if (d < 1e-6) {
              // Center inside the box: exit through the nearest face.
              const ex = c.hx - Math.abs(lx), ez = c.hz - Math.abs(lz);
              if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; d = -ex; } else { nx = 0; nz = Math.sign(lz) || 1; d = -ez; }
              dx = nx; dz = nz;
            } else { nx = dx / d; nz = dz / d; }
            const push = r - d;
            const nlx = lx + nx * push, nlz = lz + nz * push;
            px = c.x + nlx * cs - nlz * sn; pz = c.z + nlx * sn + nlz * cs;
            hit = true;
          }
        }
      }
    }
    // Soft outer boundary of the playable field.
    const d = Math.hypot(px, pz);
    if (d > this.boundsRadius) { px *= this.boundsRadius / d; pz *= this.boundsRadius / d; hit = true; }
    out.x = px; out.z = pz;
    return hit;
  }

  // Integrate one fixed step for a character given a desired horizontal velocity.
  move(body: CharacterBody, kind: Kind, dt: number, extraObstacles: { x: number; z: number; r: number }[] = []) {
    body.prevPos.copy(body.pos);
    body.prevYaw = body.yaw;
    const mask = kind === 'knight' ? MASK.knight : MASK.kitten;
    const step = kind === 'knight' ? 0.32 : 0.09;
    const nx = body.pos.x + body.vel.x * dt, nz = body.pos.z + body.vel.z * dt;
    const out = { x: nx, z: nz };
    this.resolve(nx, nz, body.radius, body.pos.y + step, body.pos.y + body.height, mask, out);
    for (const o of extraObstacles) {
      const dx = out.x - o.x, dz = out.z - o.z, d = Math.hypot(dx, dz), m = o.r + body.radius;
      if (d < m && d > 1e-6) { out.x = o.x + (dx / d) * m; out.z = o.z + (dz / d) * m; }
    }
    // Step height and slope limit: refuse moves onto ground that rises too sharply.
    const gNew = this.groundAt(out.x, out.z, body.pos.y, step);
    if (gNew - body.pos.y > step) { out.x = body.pos.x; out.z = body.pos.z; }
    // Keep velocity consistent with the resolved motion so animation matches travel.
    if (dt > 0) { body.vel.x = (out.x - body.pos.x) / dt; body.vel.z = (out.z - body.pos.z) / dt; }
    body.pos.x = out.x; body.pos.z = out.z;
    const g = this.groundAt(body.pos.x, body.pos.z, body.pos.y, step);
    if (body.pos.y > g + 0.02) {
      body.vy -= 9.8 * dt;
      body.pos.y += body.vy * dt;
      if (body.pos.y <= g) { body.pos.y = g; body.vy = 0; }
      body.grounded = body.pos.y <= g + 0.001;
    } else {
      // Ground snap.
      body.pos.y = g; body.vy = 0; body.grounded = true;
    }
  }

  // Line-of-movement check used by companion steering and the camera.
  segmentBlocked(ax: number, az: number, bx: number, bz: number, r: number, y0: number, y1: number, mask: number) {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / (r * 0.8 + 0.05)));
    const o = { x: 0, z: 0 };
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (this.resolve(x, z, r, y0, y1, mask, o) && Math.hypot(o.x - x, o.z - z) > r * 0.25) return true;
    }
    return false;
  }
}

export function insidePlatform(p: Platform, x: number, z: number) {
  if (p.kind === 'circle') return Math.hypot(x - p.x, z - p.z) < p.r;
  const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
  const lx = (x - p.x) * cs + (z - p.z) * sn, lz = -(x - p.x) * sn + (z - p.z) * cs;
  return Math.abs(lx) < p.hx && Math.abs(lz) < p.hz;
}
