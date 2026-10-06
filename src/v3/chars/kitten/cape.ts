// Her short cream wool cape: a small Verlet cloth (5 x 6 points) pinned across her shoulders that lies over her back.
// Gravity, damping and the level's wind (WIND, with gusts and a little turbulence; air pressure acts on the cloth's
// face, so it fills and lifts rather than sliding edge-on). Every point is kept outside a set of spheres that stand
// in for her body (pushed out, or straight up off her back when deep inside), so it never passes through her.
// Drawn as a smooth Catmull-Rom surface three times finer than the points, in her group's space.
import * as THREE from 'three';
import { WIND } from '../../body';

export type Ball = { c: THREE.Vector3; r: number; up: THREE.Vector3 };

const SUB = 3;
// Its make: points across and down; size across the top (over her shoulders), across the hem, and down her back;
// the round of the back its rest shape is draped over (so it curls round her rather than lying flat); a woven trim.
export type CapeMake = { cols: number; rows: number; w0: number; w1: number; len: number; drape: number; trim: boolean; folds?: { n: number; amp: number } };
export const SHORT_CAPE: CapeMake = { cols: 5, rows: 6, w0: 0.13, w1: 0.185, len: 0.15, drape: 0.066, trim: true };
const H = 1 / 120;
const HEM_N = 4, HEM_R = 0.0017;
const G = 22;

export class Cape {
  readonly cols: number; readonly rows: number; private len: number;
  pos: Float32Array;
  prev: Float32Array;
  // Links: a, b, rest length, stiffness (stretch links stiff, shear softer, bend links soft so it drapes).
  private cons: [number, number, number, number][] = [];
  private cA!: Uint16Array; private cB!: Uint16Array; private cR!: Float32Array; private cK!: Float32Array;
  pins: THREE.Vector3[] = [];
  private pinsFrom: THREE.Vector3[] = [];
  balls: Ball[] = [];
  // Pushes a point (P[o..o+2], world) out of her body's true shape, where the kitten supplies one.
  shape: ((P: Float32Array, o: number) => void) | null = null;
  // A capsule round her body (world): points further out than this need no shape test.
  near = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1 };
  // How far her body moved this frame (world): within a frame's steps it is placed part way, as the pins are.
  bodyDelta = new THREE.Vector3();
  private shift = new THREE.Vector3();
  mesh: THREE.Mesh;
  private rPos: Float32Array;
  private rIdx: Uint8Array;
  private rW: Float32Array;
  private gPos: Float32Array;
  private loop: number[] = [];
  private acc = 0;
  private nrm: Float32Array;
  private fd: Float32Array | null = null;
  // Set each frame by the kitten: the floor or water under her (world y), and her own world up.
  floor: number | null = null;
  // A plane the cloth stays behind (point and outward normal, world).
  collar = { c: new THREE.Vector3(), n: new THREE.Vector3(0, 0, 1) };
  water: number | null = null;
  sheltered = false;

  private folds: { n: number; amp: number } | null;
  constructor(material: THREE.Material, make: CapeMake = SHORT_CAPE) {
    this.folds = make.folds ?? null;
    const COLS = make.cols, ROWS = make.rows, W0 = make.w0, W1 = make.w1, LEN = make.len, DRAPE_R = make.drape;
    this.cols = COLS; this.rows = ROWS; this.len = LEN;
    this.pos = new Float32Array(COLS * ROWS * 3); this.prev = new Float32Array(COLS * ROWS * 3); this.nrm = new Float32Array(COLS * ROWS * 3);
    for (let i = 0; i < COLS; i++) { this.pins.push(new THREE.Vector3()); this.pinsFrom.push(new THREE.Vector3()); }
    const dx = (j: number) => (W0 + (W1 - W0) * (j / (ROWS - 1))) / (COLS - 1), dy = LEN / (ROWS - 1);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const k = j * COLS + i;
      if (i < COLS - 1) this.cons.push([k, k + 1, dx(j), 1]);
      if (j < ROWS - 1) this.cons.push([k, k + COLS, dy, 1]);
      if (i < COLS - 1 && j < ROWS - 1) { const d = Math.hypot((dx(j) + dx(j + 1)) / 2, dy); this.cons.push([k, k + COLS + 1, d, 0.5], [k + 1, k + COLS, d, 0.5]); }
      if (j < ROWS - 2) this.cons.push([k, k + 2 * COLS, dy * 2, 0.06]);
      if (i < COLS - 2) this.cons.push([k, k + 2, 2 * DRAPE_R * Math.sin(dx(j) / DRAPE_R), 0.06]);
    }
    this.cA = new Uint16Array(this.cons.map((c) => c[0])); this.cB = new Uint16Array(this.cons.map((c) => c[1]));
    this.cR = new Float32Array(this.cons.map((c) => c[2])); this.cK = new Float32Array(this.cons.map((c) => c[3]));
    // The render surface: Catmull-Rom weights of the 4x4 points round each render vertex.
    const rc = (COLS - 1) * SUB + 1, rr = (ROWS - 1) * SUB + 1, nV = rc * rr;
    this.rPos = new Float32Array(nV * 3); this.rIdx = new Uint8Array(nV * 16); this.rW = new Float32Array(nV * 16);
    const cr = (t: number) => [(-t + 2 * t * t - t * t * t) / 2, (2 - 5 * t * t + 3 * t * t * t) / 2, (t + 4 * t * t - 3 * t * t * t) / 2, (-t * t + t * t * t) / 2];
    for (let j = 0; j < rr; j++) for (let i = 0; i < rc; i++) {
      const v = j * rc + i;
      const gi = Math.min(Math.floor(i / SUB), COLS - 2), gj = Math.min(Math.floor(j / SUB), ROWS - 2);
      const wu = cr(i / SUB - gi), wv = cr(j / SUB - gj);
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
        const pi = Math.max(0, Math.min(COLS - 1, gi - 1 + a)), pj = Math.max(0, Math.min(ROWS - 1, gj - 1 + b));
        this.rIdx[v * 16 + b * 4 + a] = pj * COLS + pi;
        this.rW[v * 16 + b * 4 + a] = wu[a] * wv[b];
      }
    }
    const idx: number[] = [], col: number[] = [];
    for (let j = 0; j < rr - 1; j++) for (let i = 0; i < rc - 1; i++) { const a = j * rc + i, b = a + 1, c = a + rc, d = c + 1; idx.push(a, c, b, b, c, d); }
    // Cream wool, a little deeper toward the hem.
    // Cream wool with a woven border a little in from the hem.
    const base = new THREE.Color('#f4eadb'), trim = new THREE.Color('#c79f6c'), top = new THREE.Color('#e9dcc4'), c = new THREE.Color();
    for (let j = 0; j < rr; j++) for (let i = 0; i < rc; i++) {
      const u = i / (rc - 1), v = j / (rr - 1);
      const e = Math.min(u, 1 - u, (1 - v) * 0.75);
      const band = make.trim ? sm(0.03, 0.06, e) * sm(0.14, 0.11, e) : 0;
      c.copy(base).lerp(top, sm(0.15, 0.0, v) * 0.5).lerp(trim, band);
      col.push(c.r, c.g, c.b);
    }
    // A soft rolled hem all round its edge, so it reads as thick wool rather than paper.
    const loop: number[] = [];
    for (let i = 0; i < rc; i++) loop.push(i);
    for (let j = 1; j < rr; j++) loop.push(j * rc + rc - 1);
    for (let i = rc - 2; i >= 0; i--) loop.push((rr - 1) * rc + i);
    for (let j = rr - 2; j >= 1; j--) loop.push(j * rc);
    this.loop = loop;
    const hemC = new THREE.Color('#eadcc2');
    for (let k = 0; k < loop.length; k++) for (let r = 0; r < HEM_N; r++) col.push(hemC.r, hemC.g, hemC.b);
    const L = loop.length;
    for (let k = 0; k < L; k++) for (let r = 0; r < HEM_N; r++) {
      const a = nV + k * HEM_N + r, b = nV + k * HEM_N + (r + 1) % HEM_N, c2 = nV + ((k + 1) % L) * HEM_N + r, d = nV + ((k + 1) % L) * HEM_N + (r + 1) % HEM_N;
      idx.push(a, c2, b, b, c2, d);
    }
    this.gPos = new Float32Array((nV + L * HEM_N) * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'KittenCape';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    // A thin sheet would shadow itself in stripes: its depth goes into the shadow map pushed back a little.
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 6 });
  }

  // Lays it straight back from the pins along `back` (world), then lets it settle.
  reset(back: THREE.Vector3) {
    const COLS = this.cols, ROWS = this.rows, dy = this.len / (ROWS - 1);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const k = (j * COLS + i) * 3, p = this.pins[i];
      this.pos[k] = p.x + back.x * dy * j; this.pos[k + 1] = p.y + back.y * dy * j + 0.004 * j; this.pos[k + 2] = p.z + back.z * dy * j;
    }
    this.prev.set(this.pos);
    for (const [i, p] of this.pins.entries()) this.pinsFrom[i].copy(p);
    for (let s = 0; s < 60; s++) this.sub(H, 1, 0, false);
    this.prev.set(this.pos);
    this.acc = 0;
  }

  // Advances the cloth by dt (fixed small steps; the pins slide from where they were to where they are now).
  step(dt: number) {
    if (!(dt > 0)) return;
    this.acc = Math.min(this.acc + dt, H * 6);
    const n = Math.floor(this.acc / H);
    if (n === 0) return;
    for (let s = 0; s < n; s++) this.sub(H, (s + 1) / n, WIND.time);
    this.acc -= n * H;
    for (const [i, p] of this.pins.entries()) this.pinsFrom[i].copy(p);
    // Should it ever blow up, it starts again from her back.
    if (!Number.isFinite(this.pos[0]) || !Number.isFinite(this.pos[this.pos.length - 1])) this.reset(new THREE.Vector3(0, 0, -1));
  }

  // Remembers where the pins are now as where the next step starts from (after a teleport).
  settlePins() { for (const [i, p] of this.pins.entries()) this.pinsFrom[i].copy(p); }

  private sub(h: number, f: number, t: number, wind = true) {
    const COLS = this.cols, P = this.pos, Q = this.prev, N = COLS * this.rows;
    // Wind: the level's breeze and gusts, swirling a little; nearly nothing in shelter.
    const U = wind ? (this.sheltered ? 0.15 : 1) * (0.3 + 2.6 * WIND.base + 7 * WIND.gust) : 0;
    this.normals();
    const drag = 0.986;
    for (let k = 0; k < N; k++) {
      const o = k * 3, i = k % COLS, j = (k / COLS) | 0;
      if (j === 0) continue;
      const x = P[o], y = P[o + 1], z = P[o + 2];
      const vx = (x - Q[o]) / h, vy = (y - Q[o + 1]) / h, vz = (z - Q[o + 2]) / h;
      // The game's gravity is stronger than the world's (a platformer's quick fall); the cloth falls with her.
      let ax = 0, ay = -G, az = 0;
      if (U > 0.01) {
        const tu = 1 + 0.35 * Math.sin(t * 5.1 - j * 0.7 + i * 0.4) + 0.25 * Math.sin(t * 11.3 + i * 1.1 - j * 0.5);
        const sw = 0.3 * Math.sin(t * 3.3 + j * 0.45);
        const wx = (WIND.dir.x + sw * WIND.dir.y) * U * tu, wz = (WIND.dir.y - sw * WIND.dir.x) * U * tu, wy = 0.6 * U * Math.sin(t * 4.1 + i * 0.6 + j * 0.3) * 0.3;
        const rx = wx - Math.max(-20, Math.min(20, vx)), ry = wy - Math.max(-20, Math.min(20, vy)), rz = wz - Math.max(-20, Math.min(20, vz));
        const nx = this.nrm[o], ny = this.nrm[o + 1], nz = this.nrm[o + 2];
        const rn = rx * nx + ry * ny + rz * nz, fn = 0.75 * rn * Math.abs(rn), ft = 0.09 * Math.hypot(rx, ry, rz);
        ax += nx * fn + (rx - nx * rn) * ft; ay += ny * fn + (ry - ny * rn) * ft; az += nz * fn + (rz - nz * rn) * ft;
      }
      Q[o] = x; Q[o + 1] = y; Q[o + 2] = z;
      P[o] = x + vx * h * drag + ax * h * h;
      P[o + 1] = y + vy * h * drag + ay * h * h;
      P[o + 2] = z + vz * h * drag + az * h * h;
    }
    for (let i = 0; i < COLS; i++) {
      const a = this.pinsFrom[i], b = this.pins[i], o = i * 3;
      P[o] = a.x + (b.x - a.x) * f; P[o + 1] = a.y + (b.y - a.y) * f; P[o + 2] = a.z + (b.z - a.z) * f;
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
    }
    for (let it = 0; it < 5; it++) {
      const CA = this.cA, CB = this.cB, CR = this.cR, CK = this.cK;
      for (let ci = 0, cn = CA.length; ci < cn; ci++) {
        const a = CA[ci], b = CB[ci], rest = CR[ci], stiff = CK[ci];
        const ia = a < COLS ? 0 : 1, ib = b < COLS ? 0 : 1;
        if (ia + ib === 0) continue;
        const oa = a * 3, ob = b * 3;
        const dx = P[ob] - P[oa], dy = P[ob + 1] - P[oa + 1], dz = P[ob + 2] - P[oa + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // Bend links only resist being pulled long (they keep it from folding flat on itself, not from draping).
        if (stiff < 0.1 && d < rest) continue;
        const s = stiff * (d - rest) / (d * (ia + ib));
        P[oa] += dx * s * ia; P[oa + 1] += dy * s * ia; P[oa + 2] += dz * s * ia;
        P[ob] -= dx * s * ib; P[ob + 1] -= dy * s * ib; P[ob + 2] -= dz * s * ib;
      }
      this.collide(f);
    }
  }

  // Out of every ball; a point deep inside one goes up off her back instead of through her.
  private collide(f: number) {
    const COLS = this.cols, ROWS = this.rows, P = this.pos, Q = this.prev, sh = this.shift.copy(this.bodyDelta).multiplyScalar(1 - f);
    for (let k = COLS; k < COLS * ROWS; k++) {
      const o = k * 3, x0 = P[o], y0 = P[o + 1], z0 = P[o + 2];
      for (const b of this.balls) {
        const cx = b.c.x - sh.x, cy = b.c.y - sh.y, cz = b.c.z - sh.z;
        const dx = P[o] - cx, dy = P[o + 1] - cy, dz = P[o + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= b.r * b.r) continue;
        const d = Math.sqrt(d2);
        if (d > b.r * 0.35) { const s = b.r / d; P[o] = cx + dx * s; P[o + 1] = cy + dy * s; P[o + 2] = cz + dz * s; }
        else {
          // Along her up: to where the ball's surface is above this point.
          const along = dx * b.up.x + dy * b.up.y + dz * b.up.z;
          const px = dx - b.up.x * along, py = dy - b.up.y * along, pz = dz - b.up.z * along;
          const h = Math.sqrt(Math.max(0, b.r * b.r - (px * px + py * py + pz * pz)));
          P[o] = cx + px + b.up.x * h; P[o + 1] = cy + py + b.up.y * h; P[o + 2] = cz + pz + b.up.z * h;
        }
      }
      if (this.shape && this.isNear(P[o] + sh.x, P[o + 1] + sh.y, P[o + 2] + sh.z)) {
        P[o] += sh.x; P[o + 1] += sh.y; P[o + 2] += sh.z;
        this.shape(P, o);
        P[o] -= sh.x; P[o + 1] -= sh.y; P[o + 2] -= sh.z;
      }
      const cl = this.collar, dc = (P[o] - cl.c.x) * cl.n.x + (P[o + 1] - cl.c.y) * cl.n.y + (P[o + 2] - cl.c.z) * cl.n.z;
      if (dc > 0) { P[o] -= cl.n.x * dc; P[o + 1] -= cl.n.y * dc; P[o + 2] -= cl.n.z * dc; }
      if (this.water !== null && P[o + 1] < this.water) P[o + 1] = this.water;
      else if (this.floor !== null && P[o + 1] < this.floor) P[o + 1] = this.floor;
      // Pushed by her: carried along, but not thrown (the push adds no speed of its own).
      Q[o] += (P[o] - x0) * 0.85; Q[o + 1] += (P[o + 1] - y0) * 0.85; Q[o + 2] += (P[o + 2] - z0) * 0.85;
    }
  }

  private isNear(x: number, y: number, z: number) {
    const a = this.near.a, b = this.near.b;
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, px = x - a.x, py = y - a.y, pz = z - a.z;
    const t = Math.max(0, Math.min(1, (px * ux + py * uy + pz * uz) / (ux * ux + uy * uy + uz * uz || 1)));
    const dx = px - ux * t, dy = py - uy * t, dz = pz - uz * t;
    return dx * dx + dy * dy + dz * dz < this.near.r * this.near.r;
  }

  private normals() {
    const COLS = this.cols, ROWS = this.rows, P = this.pos, Nn = this.nrm;
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const a = (j * COLS + Math.max(0, i - 1)) * 3, b = (j * COLS + Math.min(COLS - 1, i + 1)) * 3;
      const c = (Math.max(0, j - 1) * COLS + i) * 3, d = (Math.min(ROWS - 1, j + 1) * COLS + i) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[d] - P[c], vy = P[d + 1] - P[c + 1], vz = P[d + 2] - P[c + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const o = (j * COLS + i) * 3;
      Nn[o] = nx; Nn[o + 1] = ny; Nn[o + 2] = nz;
    }
  }

  // The drawn surface (and its hem), in the space `toLocal` maps world into (her group).
  sync(toLocal: THREE.Matrix4) {
    const COLS = this.cols, ROWS = this.rows, P = this.pos, I = this.rIdx, Wt = this.rW, R = this.rPos, out = this.gPos, e = toLocal.elements;
    const nV = R.length / 3;
    for (let v = 0; v < nV; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = v * 16, end = k + 16; k < end; k++) { const o = I[k] * 3, w = Wt[k]; x += P[o] * w; y += P[o + 1] * w; z += P[o + 2] * w; }
      R[v * 3] = x; R[v * 3 + 1] = y; R[v * 3 + 2] = z;
      out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const rc = (COLS - 1) * SUB + 1, rr = (ROWS - 1) * SUB + 1, L = this.loop.length;
    // Soft folds of heavy wool, deepening toward the hem: each drawn point out along the sheet's normal.
    if (this.folds) {
      const F = this.folds, D = this.fd ??= new Float32Array(rc * rr * 3);
      const nx = (i: number, j: number, k: number) => out[(Math.min(rr - 1, Math.max(0, j)) * rc + Math.min(rc - 1, Math.max(0, i))) * 3 + k];
      for (let j = 0; j < rr; j++) for (let i = 0; i < rc; i++) {
        const ux = nx(i + 1, j, 0) - nx(i - 1, j, 0), uy = nx(i + 1, j, 1) - nx(i - 1, j, 1), uz = nx(i + 1, j, 2) - nx(i - 1, j, 2);
        const vx = nx(i, j + 1, 0) - nx(i, j - 1, 0), vy = nx(i, j + 1, 1) - nx(i, j - 1, 1), vz = nx(i, j + 1, 2) - nx(i, j - 1, 2);
        let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const l = Math.hypot(cx, cy, cz) || 1; cx /= l; cy /= l; cz /= l;
        const u = i / (rc - 1), v = j / (rr - 1);
        const a = F.amp * Math.sin(Math.PI * 2 * F.n * u + 0.6 * Math.sin(v * 3.1)) * (0.15 + 0.85 * v * v) * Math.sin(Math.PI * Math.min(1, u * 4, (1 - u) * 4));
        const o = (j * rc + i) * 3;
        D[o] = cx * a; D[o + 1] = cy * a; D[o + 2] = cz * a;
      }
      for (let k = 0; k < rc * rr * 3; k++) out[k] += D[k];
    }
    // Hem rings round each edge point: in the plane across the edge (the sheet's normal and its outward direction).
    const at = (i: number, j: number, o: THREE.Vector3) => { const v = (Math.min(rr - 1, Math.max(0, j)) * rc + Math.min(rc - 1, Math.max(0, i))) * 3; return o.set(out[v], out[v + 1], out[v + 2]); };
    const p = _p, t = _t, n = _n, du = _du, dv = _dv, a = _a1, b = _b1;
    for (let k = 0; k < L; k++) {
      const v = this.loop[k], i = v % rc, j = (v / rc) | 0;
      at(i, j, p);
      const pv = this.loop[(k + L - 1) % L], nx = this.loop[(k + 1) % L];
      at(nx % rc, (nx / rc) | 0, a); at(pv % rc, (pv / rc) | 0, b);
      t.subVectors(a, b).normalize();
      du.subVectors(at(i + 1, j, a), at(i - 1, j, b)); dv.subVectors(at(i, j + 1, a), at(i, j - 1, b));
      n.crossVectors(du, dv).normalize();
      const o = a.crossVectors(t, n).normalize();
      for (let r = 0; r < HEM_N; r++) {
        const th = (r / HEM_N) * Math.PI * 2 + Math.PI / 4, cs = Math.cos(th) * HEM_R, sn = Math.sin(th) * HEM_R;
        const q = (nV + k * HEM_N + r) * 3;
        out[q] = p.x + n.x * cs + o.x * sn; out[q + 1] = p.y + n.y * cs + o.y * sn; out[q + 2] = p.z + n.z * cs + o.z * sn;
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    g.computeVertexNormals();
  }
}

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _du = new THREE.Vector3(), _dv = new THREE.Vector3(), _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3();

function sm(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
