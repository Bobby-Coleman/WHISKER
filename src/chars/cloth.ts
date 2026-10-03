// Lightweight Verlet cloth for the kitten's cape. The pinned row follows the body; wind uses the same direction and
// gust envelope as the grass. With `aero`, wind acts like air on a sail: each particle is pushed along its surface
// normal by the square of the relative wind across it, so the cape fills, streams out and flutters edge-on
// instead of hanging at a tilted angle.
import * as THREE from 'three/webgpu';
import { WIND } from '../render/settings';

export type Capsule = { a: THREE.Vector3; b: THREE.Vector3; r: number };

export class VerletCloth {
  cols: number; rows: number;
  pos: Float32Array; prev: Float32Array; inv: Float32Array;
  cons: [number, number, number][] = [];
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  colliders: Capsule[] = [];
  windResponse: number;
  drag: number;
  aero: number;
  // Skin friction of the wind along the cloth, and the share of gravity it feels. A flag streams out flat in a
  // gale because air dragging along a fluttering sheet outweighs it many times; raising the first and easing the
  // second lets a short cape fly like that at game-scale wind speeds.
  friction: number;
  gravity: number;
  private nrm: Float32Array;
  private pins: Map<number, THREE.Vector3> = new Map();
  private v = new THREE.Vector3();

  // Render surface: the particle grid refined `subdiv` times with Catmull-Rom weights (16 particles per vertex).
  private subdiv: number;
  private rIdx: Uint16Array | null = null;
  private rW: Float32Array | null = null;
  private rPos: Float32Array | null = null;

  constructor(cols: number, rows: number, width: number, height: number, material: THREE.Material, opts: { windResponse?: number; drag?: number; taper?: number; subdiv?: number; aero?: number; friction?: number; gravity?: number } = {}) {
    this.cols = cols; this.rows = rows;
    this.aero = opts.aero ?? 0;
    this.friction = opts.friction ?? 0.08;
    this.gravity = opts.gravity ?? 1;
    this.subdiv = Math.max(1, Math.round(opts.subdiv ?? 1));
    this.windResponse = opts.windResponse ?? 1;
    this.drag = opts.drag ?? 0.985;
    const n = cols * rows;
    this.pos = new Float32Array(n * 3); this.prev = new Float32Array(n * 3); this.inv = new Float32Array(n).fill(1);
    this.nrm = new Float32Array(n * 3);
    const taper = opts.taper ?? 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const w = width * (1 + taper * (j / (rows - 1)));
      this.pos[k * 3] = (i / (cols - 1) - 0.5) * w; this.pos[k * 3 + 1] = -j / (rows - 1) * height; this.pos[k * 3 + 2] = 0;
    }
    this.prev.set(this.pos);
    const dx = width / (cols - 1), dy = height / (rows - 1);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (i < cols - 1) this.cons.push([k, k + 1, dx * (1 + taper * (j / (rows - 1)))]);
      if (j < rows - 1) this.cons.push([k, k + cols, dy]);
      if (i < cols - 1 && j < rows - 1) this.cons.push([k, k + cols + 1, Math.hypot(dx, dy)]);
      if (i > 0 && j < rows - 1) this.cons.push([k, k + cols - 1, Math.hypot(dx, dy)]);
      // Bending: skip-one links in both directions keep the sheet from rolling into a rope.
      if (j < rows - 2) this.cons.push([k, k + cols * 2, dy * 2]);
      if (i < cols - 2) this.cons.push([k, k + 2, dx * 2 * (1 + taper * (j / (rows - 1)))]);
    }
    const S = this.subdiv;
    const rc = (cols - 1) * S + 1, rr = (rows - 1) * S + 1;
    const idx: number[] = [];
    const uvs: number[] = [];
    for (let j = 0; j < rr; j++) for (let i = 0; i < rc; i++) uvs.push(i / (rc - 1), 1 - j / (rr - 1));
    for (let j = 0; j < rr - 1; j++) for (let i = 0; i < rc - 1; i++) {
      const a = j * rc + i, b = a + 1, c = a + rc, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    if (S > 1) {
      // Precompute the 4x4 particle stencil and Catmull-Rom weights of every render vertex.
      const cr = (t: number) => [(-t + 2 * t * t - t * t * t) / 2, (2 - 5 * t * t + 3 * t * t * t) / 2, (t + 4 * t * t - 3 * t * t * t) / 2, (-t * t + t * t * t) / 2];
      const nV = rc * rr;
      this.rIdx = new Uint16Array(nV * 16); this.rW = new Float32Array(nV * 16); this.rPos = new Float32Array(nV * 3);
      for (let j = 0; j < rr; j++) for (let i = 0; i < rc; i++) {
        const v = j * rc + i;
        const gi = Math.min(Math.floor(i / S), cols - 2), gj = Math.min(Math.floor(j / S), rows - 2);
        const wu = cr(i / S - gi), wv = cr(j / S - gj);
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
          const pi = Math.max(0, Math.min(cols - 1, gi - 1 + a)), pj = Math.max(0, Math.min(rows - 1, gj - 1 + b));
          this.rIdx[v * 16 + b * 4 + a] = pj * cols + pi;
          this.rW[v * 16 + b * 4 + a] = wu[a] * wv[b];
        }
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.rPos ?? this.pos, 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.geometry.setIndex(idx);
    this.geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  pin(index: number, p: THREE.Vector3) { this.pins.set(index, p.clone()); this.inv[index] = 0; }
  setPin(index: number, p: THREE.Vector3) { this.pins.get(index)?.copy(p); }

  // Place all particles relative to the pinned row (used on spawn and recovery).
  reset(offsetFn: (i: number, j: number) => THREE.Vector3) {
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const k = j * this.cols + i;
      const p = offsetFn(i, j);
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
    }
    this.prev.set(this.pos);
    this.updateSurface();
  }

  step(dt: number, groundY: (x: number, z: number) => number, extraForce?: THREE.Vector3) {
    // A zero step would divide by zero below and leave every particle NaN for good.
    if (!(dt > 0)) return;
    const g = -9.8 * this.gravity;
    const gust = 0.35 + WIND.gust * 1.1;
    const wx = WIND.dir.x * gust * this.windResponse, wz = WIND.dir.y * gust * this.windResponse;
    const t = WIND.time.value as number;
    const n = this.cols * this.rows;
    const dt2 = dt * dt;
    if (this.aero > 0) this.computeNormals();
    // Air speed for the aerodynamic model (m/s): a steady breeze plus the shared gust envelope.
    const speed = (3.4 + WIND.gust * 6.2) * this.windResponse;
    for (let k = 0; k < n; k++) {
      if (this.inv[k] === 0) continue;
      const o = k * 3;
      const x = this.pos[o], y = this.pos[o + 1], z = this.pos[o + 2];
      const flutter = Math.sin(t * 9 + k * 0.7) * 0.5;
      let ax: number, ay = g, az: number;
      if (this.aero > 0) {
        // Turbulence: slow swirls that drift along the cloth, so the edge ripples instead of moving in lockstep.
        const i = k % this.cols, j = (k / this.cols) | 0;
        const tu = 1 + 0.35 * Math.sin(t * 5.3 - j * 0.55 + i * 0.3) + 0.2 * Math.sin(t * 11.7 + i * 0.9 - j * 0.4);
        const sx = Math.sin(t * 3.1 + j * 0.37), sy = Math.sin(t * 4.3 + i * 0.5 + j * 0.2);
        const Wx = (WIND.dir.x + sx * 0.25 * WIND.dir.y) * speed * tu, Wy = sy * 0.6 * speed * 0.25, Wz = (WIND.dir.y - sx * 0.25 * WIND.dir.x) * speed * tu;
        // Particle velocity, capped: a sudden jump of the pins must not feed the square-law drag an absurd speed.
        const cap = (v: number) => Math.max(-25, Math.min(25, v));
        const vx = cap((x - this.prev[o]) / dt), vy = cap((y - this.prev[o + 1]) / dt), vz = cap((z - this.prev[o + 2]) / dt);
        const rx = Wx - vx, ry = Wy - vy, rz = Wz - vz;
        const nx = this.nrm[o], ny = this.nrm[o + 1], nz = this.nrm[o + 2];
        const rn = rx * nx + ry * ny + rz * nz;
        const fn = this.aero * rn * Math.abs(rn);
        // Pressure along the normal plus a little skin friction along the surface.
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const ft = this.aero * this.friction * rl;
        ax = nx * fn + (rx - nx * rn) * ft; ay += ny * fn + (ry - ny * rn) * ft; az = nz * fn + (rz - nz * rn) * ft;
      } else {
        ax = (wx + flutter * wz * 0.6) * 2.4; az = (wz - flutter * wx * 0.6) * 2.4;
      }
      if (extraForce) { ax += extraForce.x; ay += extraForce.y; az += extraForce.z; }
      const vx = (x - this.prev[o]) * this.drag, vy = (y - this.prev[o + 1]) * this.drag, vz = (z - this.prev[o + 2]) * this.drag;
      this.prev[o] = x; this.prev[o + 1] = y; this.prev[o + 2] = z;
      this.pos[o] = x + vx + ax * dt2; this.pos[o + 1] = y + vy + ay * dt2; this.pos[o + 2] = z + vz + az * dt2;
    }
    for (const [k, p] of this.pins) { this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z; }
    for (let it = 0; it < 6; it++) {
      for (const [a, b, rest] of this.cons) {
        const ia = this.inv[a], ib = this.inv[b];
        if (ia + ib === 0) continue;
        const oa = a * 3, ob = b * 3;
        const dx = this.pos[ob] - this.pos[oa], dy = this.pos[ob + 1] - this.pos[oa + 1], dz = this.pos[ob + 2] - this.pos[oa + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / (d * (ia + ib));
        this.pos[oa] += dx * diff * ia; this.pos[oa + 1] += dy * diff * ia; this.pos[oa + 2] += dz * diff * ia;
        this.pos[ob] -= dx * diff * ib; this.pos[ob + 1] -= dy * diff * ib; this.pos[ob + 2] -= dz * diff * ib;
      }
      for (const c of this.colliders) this.collideCapsule(c);
    }
    for (let k = 0; k < n; k++) {
      const o = k * 3;
      const gy = groundY(this.pos[o], this.pos[o + 2]) + 0.01;
      if (this.pos[o + 1] < gy) { this.pos[o + 1] = gy; this.prev[o + 1] = gy; }
    }
    this.updateSurface();
  }

  // Particle normals from central differences on the grid.
  private computeNormals() {
    const C = this.cols, R = this.rows, P = this.pos, N = this.nrm;
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const a = (j * C + Math.max(0, i - 1)) * 3, b = (j * C + Math.min(C - 1, i + 1)) * 3;
      const c = (Math.max(0, j - 1) * C + i) * 3, d = (Math.min(R - 1, j + 1) * C + i) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[d] - P[c], vy = P[d + 1] - P[c + 1], vz = P[d + 2] - P[c + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const o = (j * C + i) * 3;
      N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
    }
  }

  private updateSurface() {
    if (this.rPos && this.rIdx && this.rW) {
      const P = this.pos, I = this.rIdx, Wt = this.rW, out = this.rPos;
      for (let v = 0, n = out.length / 3; v < n; v++) {
        let x = 0, y = 0, z = 0;
        for (let k = v * 16, e = k + 16; k < e; k++) {
          const o = I[k] * 3, w = Wt[k];
          x += P[o] * w; y += P[o + 1] * w; z += P[o + 2] * w;
        }
        out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  private collideCapsule(c: Capsule) {
    const n = this.cols * this.rows;
    const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
    const ll = abx * abx + aby * aby + abz * abz || 1e-6;
    for (let k = 0; k < n; k++) {
      if (this.inv[k] === 0) continue;
      const o = k * 3;
      const px = this.pos[o] - c.a.x, py = this.pos[o + 1] - c.a.y, pz = this.pos[o + 2] - c.a.z;
      const t = Math.max(0, Math.min(1, (px * abx + py * aby + pz * abz) / ll));
      const qx = px - abx * t, qy = py - aby * t, qz = pz - abz * t;
      const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (d < c.r && d > 1e-6) {
        const s = (c.r - d) / d;
        this.pos[o] += qx * s; this.pos[o + 1] += qy * s; this.pos[o + 2] += qz * s;
      }
    }
    void this.v;
  }
}
