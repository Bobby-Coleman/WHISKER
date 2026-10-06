// Modelling helpers for the toy kitten: a few signed-distance shapes (blended with a smooth union) and closed
// sphere-topology surfaces made from them (no seams, no duplicated vertices, so normals are smooth everywhere),
// merged into one skinned geometry with per-vertex bone weights.
import * as THREE from 'three';

export type SDF = (x: number, y: number, z: number) => number;

export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): SDF {
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = (x - cx) / (rx * rx), qy = (y - cy) / (ry * ry), qz = (z - cz) / (rz * rz);
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-6;
    return (k0 * (k0 - 1)) / k1;
  };
}

// A capsule from a to b whose radius runs from ra to rb.
export function cone(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb = ra): SDF {
  const ux = bx - ax, uy = by - ay, uz = bz - az, ll = ux * ux + uy * uy + uz * uz;
  return (x, y, z) => {
    const px = x - ax, py = y - ay, pz = z - az;
    const h = Math.min(1, Math.max(0, (px * ux + py * uy + pz * uz) / ll));
    return Math.hypot(px - ux * h, py - uy * h, pz - uz * h) - (ra + (rb - ra) * h);
  };
}

export const union = (k: number, ...fs: SDF[]): SDF => (x, y, z) => {
  let d = fs[0](x, y, z);
  for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k);
  return d;
};

const _v = new THREE.Vector3();

// A closed surface of sphere topology: `nu` points round each ring, `nv` bands from pole to pole. fn(u, v) gives the
// point for u (0..1 round) and v (0 at the first pole .. 1 at the second). Triangles face outward.
export function sphereTopo(nu: number, nv: number, fn: (u: number, v: number, out: THREE.Vector3) => THREE.Vector3) {
  const pos: number[] = [];
  const push = (p: THREE.Vector3) => { pos.push(p.x, p.y, p.z); };
  push(fn(0, 0, _v));
  for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) push(fn(i / nu, j / nv, _v));
  push(fn(0, 1, _v));
  const last = pos.length / 3 - 1, ring = (j: number, i: number) => 1 + (j - 1) * nu + (i % nu);
  const idx: number[] = [];
  for (let i = 0; i < nu; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < nv - 1; j++) for (let i = 0; i < nu; i++) {
    const a = ring(j, i), b = ring(j, i + 1), c = ring(j + 1, i), d = ring(j + 1, i + 1);
    idx.push(a, b, c, b, d, c);
  }
  for (let i = 0; i < nu; i++) idx.push(last, ring(nv - 1, i), ring(nv - 1, i + 1));
  // Outward: the enclosed volume comes out positive.
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The surface of an SDF round a point inside it: each vertex of a UV sphere (poles along `axis`) moved out along its
// ray to where the field crosses zero. `stretch` scales the ray directions (rings spread along a long body).
export function starMesh(sdf: SDF, c: THREE.Vector3, nu: number, nv: number, o: { axis?: 'x' | 'y' | 'z'; stretch?: [number, number, number]; rMax?: number } = {}) {
  const axis = o.axis ?? 'y', st = o.stretch ?? [1, 1, 1], rMax = o.rMax ?? 0.3;
  const d = new THREE.Vector3();
  return sphereTopo(nu, nv, (u, v, out) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const a = Math.cos(ph), b = Math.sin(ph) * Math.cos(th), e = Math.sin(ph) * Math.sin(th);
    if (axis === 'y') d.set(b, a, e); else if (axis === 'z') d.set(e, b, a); else d.set(a, e, b);
    d.set(d.x * st[0], d.y * st[1], d.z * st[2]).normalize();
    // March out to the first crossing, then bisect it.
    const steps = 40;
    let t0 = 0, t1 = rMax;
    for (let s = 1; s <= steps; s++) {
      const t = (rMax * s) / steps;
      if (sdf(c.x + d.x * t, c.y + d.y * t, c.z + d.z * t) > 0) { t1 = t; t0 = (rMax * (s - 1)) / steps; break; }
    }
    for (let it = 0; it < 24; it++) {
      const m = (t0 + t1) / 2;
      if (sdf(c.x + d.x * m, c.y + d.y * m, c.z + d.z * m) > 0) t1 = m; else t0 = m;
    }
    const t = (t0 + t1) / 2;
    return out.set(c.x + d.x * t, c.y + d.y * t, c.z + d.z * t);
  });
}

// A solid of revolution round +Z: rings (z, rx, ry) from tail to tip, closed at both ends. `deform` may move each
// vertex (u round the ring, s along the rings 0..1).
export function revolveZ(rings: [number, number, number][], nu: number, deform?: (p: THREE.Vector3, u: number, s: number) => void) {
  const n = rings.length;
  return sphereTopo(nu, n - 1, (u, v, out) => {
    const k = Math.round(v * (n - 1)), [z, rx, ry] = rings[k];
    const th = u * Math.PI * 2;
    out.set(Math.cos(th) * rx, Math.sin(th) * ry, z);
    deform?.(out, u, k / (n - 1));
    return out;
  });
}

// Rings for a rounded tube along +Z from z0 to z1 whose radius follows r(s), with half-dome ends.
export function tubeRings(z0: number, z1: number, r: (s: number) => number, n: number, cap = 4, sy = 1): [number, number, number][] {
  const out: [number, number, number][] = [];
  const r0 = r(0), r1 = r(1);
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * Math.PI / 2; out.push([z0 - Math.cos(a) * r0, Math.sin(a) * r0, Math.sin(a) * r0 * sy]); }
  for (let i = 1; i < n; i++) { const s = i / n, rr = r(s); out.push([z0 + (z1 - z0) * s, rr, rr * sy]); }
  for (let i = cap; i >= 0; i--) { const a = (i / cap) * Math.PI / 2; out.push([z1 + Math.cos(a) * r1, Math.sin(a) * r1, Math.sin(a) * r1 * sy]); }
  return out;
}

// Vertex colours from position and normal.
export function paint(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => THREE.Color) {
  const p = g.attributes.position, nrm = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  const P = new THREE.Vector3(), N = new THREE.Vector3(), C = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    P.fromBufferAttribute(p as THREE.BufferAttribute, i); N.fromBufferAttribute(nrm as THREE.BufferAttribute, i);
    fn(P, N, C);
    c[i * 3] = C.r; c[i * 3 + 1] = C.g; c[i * 3 + 2] = C.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Bone weights: each vertex on up to two bones (index, weight) from its position.
export type Skin = (p: THREE.Vector3) => [number, number, number, number];
export function skin(g: THREE.BufferGeometry, fn: Skin | number) {
  const p = g.attributes.position, n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let a = 0, wa = 1, b = 0, wb = 0;
    if (typeof fn === 'number') a = fn;
    else { P.fromBufferAttribute(p as THREE.BufferAttribute, i); [a, wa, b, wb] = fn(P); }
    si[i * 4] = a; si[i * 4 + 1] = b; sw[i * 4] = wa; sw[i * 4 + 1] = wb;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

// Merge indexed geometries that share their attribute set.
export function merge(geos: THREE.BufferGeometry[]) {
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  let total = 0, totalIdx = 0;
  for (const g of geos) { total += g.attributes.position.count; totalIdx += g.index!.count; }
  for (const nm of names) {
    const a0 = geos[0].attributes[nm] as THREE.BufferAttribute;
    const Arr = (a0.array as any).constructor;
    const arr = new Arr(total * a0.itemSize);
    let off = 0;
    for (const g of geos) { const a = g.attributes[nm] as THREE.BufferAttribute; arr.set(a.array, off); off += a.array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = new Uint32Array(totalIdx);
  let vo = 0, io = 0;
  for (const g of geos) {
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
    io += ix.length; vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(total > 65535 ? idx : new Uint16Array(idx), 1));
  return out;
}

// Bakes a matrix into a geometry (positions and normals).
export function bake(g: THREE.BufferGeometry, m: THREE.Matrix4) { g.applyMatrix4(m); return g; }

export const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
