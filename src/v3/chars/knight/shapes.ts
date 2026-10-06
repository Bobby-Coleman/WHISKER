// Toy shape kit for the knight (v3): rounded lathes, super-ellipsoids and tubes, all as indexed geometry with
// position, normal and a vertex colour, so one part merges into one mesh per material.
import * as THREE from 'three';

export type Col = string | THREE.Color | ((p: THREE.Vector3) => THREE.Color);
type V2 = [number, number];

const _c = new THREE.Color(), _p = new THREE.Vector3();

function fill(g: THREE.BufferGeometry, col: Col) {
  const pos = g.attributes.position, n = pos.count;
  const c = new Float32Array(n * 3);
  const fixed = typeof col === 'function' ? null : _c.set(col as any).clone();
  for (let i = 0; i < n; i++) {
    const k = fixed ?? (col as (p: THREE.Vector3) => THREE.Color)(_p.fromBufferAttribute(pos, i));
    c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Catmull-Rom through control points, `n` samples per span (keeps the ends).
export function smooth(pts: V2[], n = 6): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), Math.max(0, f(p0[1], p1[1], p2[1], p3[1]))]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export type LatheOpts = {
  segs?: number; sx?: number; sz?: number;
  phi0?: number; phiLen?: number; // from +Z toward +X
  color?: Col;
  // Moves a vertex after it is placed (phi: its angle, t: 0..1 along the profile).
  deform?: (v: THREE.Vector3, phi: number, t: number, row: number) => void;
};

// Revolves a profile of [y, r] (bottom to top) about Y. An end with r = 0 closes to a point.
export function lathe(profile: V2[], o: LatheOpts = {}) {
  const segs = o.segs ?? 24, sx = o.sx ?? 1, sz = o.sz ?? 1;
  const full = o.phiLen === undefined || o.phiLen >= Math.PI * 2 - 1e-6;
  const phi0 = o.phi0 ?? 0, phiLen = o.phiLen ?? Math.PI * 2;
  const cols = full ? segs : segs + 1;
  const rows = profile.length;
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  // Profile parameter by arc length.
  const acc = [0];
  for (let i = 1; i < rows; i++) acc.push(acc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const L = acc[rows - 1] || 1;
  for (let i = 0; i < rows; i++) {
    const [y, r] = profile[i];
    for (let j = 0; j < cols; j++) {
      const phi = phi0 + (j / segs) * phiLen;
      v.set(Math.sin(phi) * r * sx, y, Math.cos(phi) * r * sz);
      o.deform?.(v, phi, acc[i] / L, i);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = full ? (j + 1) % cols : j + 1;
      const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1;
      // Outward facing for a bottom-to-top profile.
      if (profile[i][1] > 1e-6) idx.push(a, b, c);
      if (profile[i + 1][1] > 1e-6) idx.push(b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fill(g, o.color ?? '#ffffff');
}

// A rounded box / pebble: the super-ellipsoid |x/a|^p + |y/b|^p + |z/c|^p = 1 (p = 2: an ellipsoid).
export function blob(a: number, b: number, c: number, o: { p?: number; segs?: number; rings?: number; color?: Col; deform?: (v: THREE.Vector3) => void } = {}) {
  const p = o.p ?? 2.6, segs = o.segs ?? 20, rings = o.rings ?? 14;
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI; // from +Y down
    for (let j = 0; j <= segs; j++) {
      const ph = (j / segs) * Math.PI * 2;
      v.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      const s = Math.pow(Math.pow(Math.abs(v.x / a), p) + Math.pow(Math.abs(v.y / b), p) + Math.pow(Math.abs(v.z / c), p), -1 / p);
      v.multiplyScalar(s);
      o.deform?.(v);
      pos.push(v.x, v.y, v.z);
    }
  }
  const cols = segs + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a0 = i * cols + j, b0 = a0 + 1, c0 = a0 + cols, d0 = c0 + 1;
    if (i > 0) idx.push(a0, c0, b0);
    if (i < rings - 1) idx.push(b0, c0, d0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  weld(g);
  g.computeVertexNormals();
  return fill(g, o.color ?? '#ffffff');
}

// A tube along a path (t 0..1), radius by t; ends rounded (hemispherical) or flat.
export function tube(path: (t: number) => THREE.Vector3, radius: (t: number) => number, o: { steps?: number; segs?: number; color?: Col; caps?: 'round' | 'flat' | 'none'; sx?: number; up?: THREE.Vector3 } = {}) {
  const steps = o.steps ?? 12, segs = o.segs ?? 10, sx = o.sx ?? 1;
  const caps = o.caps ?? 'round';
  const P: THREE.Vector3[] = [], T: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) P.push(path(i / steps));
  for (let i = 0; i <= steps; i++) T.push(P[Math.min(steps, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
  // Parallel transport frames.
  const N: THREE.Vector3[] = [], B: THREE.Vector3[] = [];
  let n0 = (o.up ?? new THREE.Vector3(0, 1, 0)).clone();
  if (Math.abs(n0.dot(T[0])) > 0.95) n0 = new THREE.Vector3(1, 0, 0);
  n0.addScaledVector(T[0], -n0.dot(T[0])).normalize();
  N.push(n0); B.push(new THREE.Vector3().crossVectors(T[0], n0));
  for (let i = 1; i <= steps; i++) {
    const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
    const n = N[i - 1].clone().applyQuaternion(q).normalize();
    N.push(n); B.push(new THREE.Vector3().crossVectors(T[i], n));
  }
  const pos: number[] = [], idx: number[] = [];
  const ring = (c: THREE.Vector3, n: THREE.Vector3, b: THREE.Vector3, r: number) => {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(c.x + (n.x * Math.cos(a) * sx + b.x * Math.sin(a)) * r, c.y + (n.y * Math.cos(a) * sx + b.y * Math.sin(a)) * r, c.z + (n.z * Math.cos(a) * sx + b.z * Math.sin(a)) * r);
    }
  };
  const capRings = caps === 'round' ? 4 : 0;
  // Start cap rings (from the tip inward).
  const r0 = radius(0), r1 = radius(1);
  if (caps === 'round') for (let k = capRings; k >= 1; k--) {
    const a = (k / capRings) * Math.PI / 2;
    ring(P[0].clone().addScaledVector(T[0], -Math.sin(a) * r0), N[0], B[0], Math.max(1e-4, Math.cos(a) * r0));
  }
  for (let i = 0; i <= steps; i++) ring(P[i], N[i], B[i], radius(i / steps));
  if (caps === 'round') for (let k = 1; k <= capRings; k++) {
    const a = (k / capRings) * Math.PI / 2;
    ring(P[steps].clone().addScaledVector(T[steps], Math.sin(a) * r1), N[steps], B[steps], Math.max(1e-4, Math.cos(a) * r1));
  }
  const nr = pos.length / 3 / segs;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    const a = i * segs + j, b = i * segs + j1, c = (i + 1) * segs + j, d = (i + 1) * segs + j1;
    idx.push(a, b, c, b, d, c);
  }
  // Close the ends with a centre point.
  const close = (ringStart: number, centre: THREE.Vector3, flip: boolean) => {
    const ci = pos.length / 3;
    pos.push(centre.x, centre.y, centre.z);
    for (let j = 0; j < segs; j++) {
      const a = ringStart + j, b = ringStart + (j + 1) % segs;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (caps !== 'none') {
    close(0, caps === 'round' ? P[0].clone().addScaledVector(T[0], -r0) : P[0], true);
    close((nr - 1) * segs, caps === 'round' ? P[steps].clone().addScaledVector(T[steps], r1) : P[steps], false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fill(g, o.color ?? '#ffffff');
}

// Merges vertices at the same place (the seams of a UV sphere), so normals are smooth across them.
export function weld(g: THREE.BufferGeometry, eps = 1e-5) {
  const pos = g.attributes.position, n = pos.count;
  const map = new Map<string, number>(), remap = new Int32Array(n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`;
    let j = map.get(k);
    if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); }
    remap[i] = j;
  }
  const np = new Float32Array(keep.length * 3);
  keep.forEach((i, j) => { np[j * 3] = pos.getX(i); np[j * 3 + 1] = pos.getY(i); np[j * 3 + 2] = pos.getZ(i); });
  const idx = g.index!.array;
  const ni: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) ni.push(a, b, c);
  }
  g.setAttribute('position', new THREE.BufferAttribute(np, 3));
  g.setIndex(ni);
  return g;
}

// Moves, turns (Euler XYZ, radians) and scales a geometry; a mirroring scale keeps its faces outward.
export function xf(g: THREE.BufferGeometry, t: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], s: number | [number, number, number] = 1) {
  const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sv);
  g.applyMatrix4(m);
  if (sv.x * sv.y * sv.z < 0) flip(g);
  return g;
}
export function mat(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  g.applyMatrix4(m);
  if (m.determinant() < 0) flip(g);
  return g;
}
function flip(g: THREE.BufferGeometry) {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
  idx.needsUpdate = true;
}

// Mirror left to right (x → -x).
export function mirrorX(g: THREE.BufferGeometry) { return xf(g.clone(), [0, 0, 0], [0, 0, 0], [-1, 1, 1]); }

// Recolours a geometry.
export function paint(g: THREE.BufferGeometry, col: Col) { return fill(g, col); }

// Joins geometries (position, normal, colour; morph targets when all have them) into one.
export function merge(gs: THREE.BufferGeometry[]) {
  let nv = 0, ni = 0;
  for (const g of gs) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const morphs = gs.every((g) => g.morphAttributes.position?.length) ? gs[0].morphAttributes.position.length : 0;
  const mp = Array.from({ length: morphs }, () => new Float32Array(nv * 3));
  const mn = Array.from({ length: morphs }, () => new Float32Array(nv * 3));
  let vo = 0, io = 0;
  for (const g of gs) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    nor.set(g.attributes.normal.array as Float32Array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array as Float32Array, vo * 3); else col.fill(1, vo * 3, (vo + n) * 3);
    for (let m = 0; m < morphs; m++) {
      mp[m].set(g.morphAttributes.position[m].array as Float32Array, vo * 3);
      mn[m].set((g.morphAttributes.normal?.[m] ?? g.attributes.normal).array as Float32Array, vo * 3);
    }
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (morphs) {
    out.morphAttributes.position = mp.map((a) => new THREE.BufferAttribute(a, 3));
    out.morphAttributes.normal = mn.map((a) => new THREE.BufferAttribute(a, 3));
  }
  // Any other attribute all of them have (skin indices and weights).
  for (const name of Object.keys(gs[0].attributes)) {
    if (name === 'position' || name === 'normal' || name === 'color' || !gs.every((g) => g.attributes[name])) continue;
    const a0 = gs[0].attributes[name] as THREE.BufferAttribute, size = a0.itemSize;
    const arr = new (a0.array.constructor as any)(nv * size);
    let o = 0;
    for (const g of gs) { arr.set(g.attributes[name].array, o); o += g.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// A copy pushed out along its normals (a coat of something over a surface), keeping only the triangles where
// `mask` reaches 0.5 at some corner; the mask is kept per vertex (attribute `stain`) for a crisp cut-out.
export function coat(g: THREE.BufferGeometry, mask: (p: THREE.Vector3, n: THREE.Vector3) => number, lift = 0.0025) {
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  const m = new Float32Array(n);
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) m[i] = mask(p.fromBufferAttribute(pos, i), q.fromBufferAttribute(nor, i));
  const idx = g.index!.array;
  const used = new Int32Array(n).fill(-1);
  const np: number[] = [], nn: number[] = [], ns: number[] = [], ni: number[] = [];
  const mposA = g.morphAttributes.position ?? [], mnorA = g.morphAttributes.normal ?? [];
  const mp: number[][] = mposA.map(() => []), mn: number[][] = mposA.map(() => []);
  const take = (i: number) => {
    if (used[i] < 0) {
      used[i] = ns.length;
      p.fromBufferAttribute(pos, i); q.fromBufferAttribute(nor, i);
      np.push(p.x + q.x * lift, p.y + q.y * lift, p.z + q.z * lift); nn.push(q.x, q.y, q.z); ns.push(m[i]);
      mposA.forEach((ma, k) => {
        p.fromBufferAttribute(ma, i); q.fromBufferAttribute(mnorA[k] ?? nor, i);
        mp[k].push(p.x + q.x * lift, p.y + q.y * lift, p.z + q.z * lift); mn[k].push(q.x, q.y, q.z);
      });
    }
    return used[i];
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.max(m[a], m[b], m[c]) < 0.5) continue;
    ni.push(take(a), take(b), take(c));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  out.setAttribute('stain', new THREE.Float32BufferAttribute(ns, 1));
  out.setIndex(ni);
  if (mposA.length) {
    out.morphAttributes.position = mp.map((a) => new THREE.Float32BufferAttribute(a, 3));
    out.morphAttributes.normal = mn.map((a) => new THREE.Float32BufferAttribute(a, 3));
  }
  return out;
}

// Cheap repeatable noise for stains and quilting.
export function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
