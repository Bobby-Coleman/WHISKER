// Geometry helpers for plate armor, blades and small parts.
import * as THREE from 'three/webgpu';

// Revolve a [y, r] profile around Y with elliptical scaling; optional per-vertex deformer.
export function lathe(profile: [number, number][], opts: { sx?: number; sz?: number; segs?: number; phiStart?: number; phiLength?: number; deform?: (v: THREE.Vector3) => void } = {}) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const g = new THREE.LatheGeometry(pts, opts.segs ?? 32, opts.phiStart ?? 0, opts.phiLength ?? Math.PI * 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.x *= opts.sx ?? 1; v.z *= opts.sz ?? 1;
    opts.deform?.(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Smoothly interpolated profile (Catmull-Rom over control points) for rounder plates.
export function smoothProfile(ctrl: [number, number][], samples = 24): [number, number][] {
  const curve = new THREE.SplineCurve(ctrl.map(([y, r]) => new THREE.Vector2(y, r)));
  return curve.getPoints(samples).map((p) => [p.x, p.y]);
}

// A blade with diamond cross-section, fuller and point. Guard at y=0, blade along `dir` (+1 up / -1 down).
export function bladeGeometry(len: number, width: number, thick: number, dir: 1 | -1, pointLen = 0.12) {
  const segs = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (t: number) => {
    const y = t * len;
    const pointStart = 1 - pointLen / len;
    let w = width * (1 - 0.35 * t);
    if (t > pointStart) w *= Math.max(0, (1 - t) / (1 - pointStart));
    const th = thick * (1 - 0.4 * t) * (t > pointStart ? Math.max(0.15, (1 - t) / (1 - pointStart)) : 1);
    // Diamond with a shallow fuller near the center line.
    return [[w / 2, 0], [w * 0.15, th / 2 * 0.75], [0, th / 2], [-w * 0.15, th / 2 * 0.75], [-w / 2, 0], [-w * 0.15, -th / 2 * 0.75], [0, -th / 2], [w * 0.15, -th / 2 * 0.75]].map(([x, z]) => [x, y * dir, z]);
  };
  const R = 8;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    for (const p of ring(Math.min(t, 0.999))) pos.push(p[0], p[1], p[2]);
  }
  for (let s = 0; s < segs; s++) for (let k = 0; k < R; k++) {
    const a = s * R + k, b = s * R + ((k + 1) % R), c = a + R, d = b + R;
    if (dir > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Minimal merge for geometries sharing attribute sets (position/normal[/uv]).
  const attrs = ['position', 'normal'];
  const out = new THREE.BufferGeometry();
  const nonIdx = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const a of attrs) {
    const arrs = nonIdx.map((g) => g.attributes[a].array as Float32Array);
    const total = arrs.reduce((s, x) => s + x.length, 0);
    const buf = new Float32Array(total);
    let o = 0;
    for (const x of arrs) { buf.set(x, o); o += x.length; }
    out.setAttribute(a, new THREE.BufferAttribute(buf, 3));
  }
  out.computeBoundingSphere();
  return out;
}

export function transformed(g: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  const c = g.clone();
  c.applyMatrix4(m);
  return c;
}

export function capGeometry(r: number, thetaLen: number, sx = 1, sy = 1, sz = 1, segs = 24) {
  const g = new THREE.SphereGeometry(r, segs, Math.max(6, segs / 2), 0, Math.PI * 2, 0, thetaLen);
  g.scale(sx, sy, sz);
  return g;
}

// A thin plate panel with real thickness: a lathe-like surface whose angular span can change with height,
// closed along every border so its edges shade like rolled plate. profile: [y, r]; span(y, t) in radians.
export function shellPanel(profile: [number, number][], opts: {
  phiC?: number | ((y: number, t: number) => number); span: (y: number, t: number) => number; thick?: number; sx?: number; sz?: number; segs?: number;
  deform?: (v: THREE.Vector3, u: number, t: number) => void;
}) {
  const segs = opts.segs ?? 24, n = profile.length, W = segs + 1;
  const th = opts.thick ?? 0.004;
  const phiAt = (y: number, t: number) => (typeof opts.phiC === 'function' ? opts.phiC(y, t) : opts.phiC ?? 0);
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  const grid = (inset: number) => {
    const base = pos.length / 3;
    for (let j = 0; j < n; j++) {
      const [y, r0] = profile[j];
      const t = j / (n - 1);
      const span = opts.span(y, t), r = r0 - inset, phiC = phiAt(y, t);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs, phi = phiC + (u - 0.5) * span;
        v.set(Math.sin(phi) * r * (opts.sx ?? 1), y, Math.cos(phi) * r * (opts.sz ?? 1));
        opts.deform?.(v, u, t);
        pos.push(v.x, v.y, v.z);
      }
    }
    return base;
  };
  const o = grid(0), inn = grid(th);
  const P = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  // Push a quad (a,b,c,d as a strip a-b / c-d) with the winding that faces `out`.
  const quad = (a: number, b: number, c: number, d: number, out: THREE.Vector3) => {
    const pa = P(a), n0 = P(b).sub(pa).cross(P(c).sub(pa));
    if (n0.dot(out) >= 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  };
  const radial = (k: number) => { const p = P(k); return new THREE.Vector3(p.x, 0, p.z); };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    quad(o + a, o + b, o + c, o + d, radial(o + a));
    quad(inn + a, inn + b, inn + c, inn + d, radial(inn + a).negate());
  }
  // Borders: bottom and top rows, then the two side columns.
  for (const j of [0, n - 1]) for (let i = 0; i < segs; i++) {
    const a = j * W + i, nb = (j === 0 ? 1 : n - 2) * W + i;
    const out = P(o + a).sub(P(o + nb));
    quad(o + a, o + a + 1, inn + a, inn + a + 1, out);
  }
  for (const i of [0, segs]) for (let j = 0; j < n - 1; j++) {
    const a = j * W + i, nb = j * W + (i === 0 ? 1 : segs - 1);
    const out = P(o + a).sub(P(o + nb));
    quad(o + a, o + a + W, inn + a, inn + a + W, out);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
