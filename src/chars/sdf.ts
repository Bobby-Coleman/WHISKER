// Small signed-distance modeling kit + Surface Nets polygonizer used to sculpt organic and
// plate shapes for the characters at load time (smooth unions give real cheeks, muzzles, plates).
import * as THREE from 'three/webgpu';

export type SDF = (x: number, y: number, z: number) => number;

export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): SDF {
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = (x - cx) / (rx * rx), qy = (y - cy) / (ry * ry), qz = (z - cz) / (rz * rz);
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-6;
    return (k0 * (k0 - 1)) / k1;
  };
}

export function sphere(cx: number, cy: number, cz: number, r: number): SDF {
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

export function capsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb = ra): SDF {
  return (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
  };
}

export function box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r = 0): SDF {
  return (x, y, z) => {
    const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
  };
}

export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number];

export function polygonize(sdf: SDF, min: THREE.Vector3, max: THREE.Vector3, res: number, colorFn?: ColorFn): THREE.BufferGeometry {
  const size = new THREE.Vector3().subVectors(max, min);
  const step = Math.max(size.x, size.y, size.z) / res;
  const nx = Math.ceil(size.x / step) + 1, ny = Math.ceil(size.y / step) + 1, nz = Math.ceil(size.z / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    field[id(i, j, k)] = sdf(min.x + i * step, min.y + j * step, min.z + k * step);
  }
  const vIndex = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
      cv[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      cnt++;
    }
    vIndex[id(i, j, k)] = pos.length / 3;
    pos.push(min.x + (i + sx / cnt) * step, min.y + (j + sy / cnt) * step, min.z + (k + sz / cnt) * step);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = field[id(i, j, k)] < 0;
    if (i < nx - 1 && inside !== (field[id(i + 1, j, k)] < 0)) {
      quad(vIndex[id(i, j - 1, k - 1)], vIndex[id(i, j, k - 1)], vIndex[id(i, j, k)], vIndex[id(i, j - 1, k)], !inside);
    }
    if (j < ny - 1 && inside !== (field[id(i, j + 1, k)] < 0)) {
      quad(vIndex[id(i - 1, j, k - 1)], vIndex[id(i - 1, j, k)], vIndex[id(i, j, k)], vIndex[id(i, j, k - 1)], !inside);
    }
    if (k < nz - 1 && inside !== (field[id(i, j, k + 1)] < 0)) {
      quad(vIndex[id(i - 1, j - 1, k)], vIndex[id(i, j - 1, k)], vIndex[id(i, j, k)], vIndex[id(i - 1, j, k)], !inside);
    }
  }
  // Relax vertices onto the true surface and take normals from the SDF gradient.
  const nrm = new Float32Array(pos.length);
  const e = step * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      x -= (gx / gl) * d; y -= (gy / gl) * d; z -= (gz / gl) * d;
      if (it === 1) { nrm[v] = gx / gl; nrm[v + 1] = gy / gl; nrm[v + 2] = gz / gl; }
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (colorFn) {
    const col = new Float32Array(pos.length);
    for (let v = 0; v < pos.length; v += 3) {
      const c = colorFn(pos[v], pos[v + 1], pos[v + 2], nrm[v], nrm[v + 1], nrm[v + 2]);
      col[v] = c[0]; col[v + 1] = c[1]; col[v + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  // Make triangle winding agree with the SDF normals.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const s = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (s < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Utility for composing many primitives.
export const union = (k: number, ...fs: SDF[]): SDF => (x, y, z) => {
  let d = fs[0](x, y, z);
  for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k);
  return d;
};
export const hardUnion = (...fs: SDF[]): SDF => (x, y, z) => {
  let d = fs[0](x, y, z);
  for (let i = 1; i < fs.length; i++) d = Math.min(d, fs[i](x, y, z));
  return d;
};
export const subtract = (a: SDF, b: SDF, k = 0): SDF => (x, y, z) => (k > 0 ? smax(a(x, y, z), -b(x, y, z), k) : Math.max(a(x, y, z), -b(x, y, z)));
export const intersect = (a: SDF, b: SDF): SDF => (x, y, z) => Math.max(a(x, y, z), b(x, y, z));
export const shell = (a: SDF, t: number): SDF => (x, y, z) => Math.abs(a(x, y, z)) - t;
export const mirrorX = (a: SDF): SDF => (x, y, z) => a(Math.abs(x), y, z);
