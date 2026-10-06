// Terrain (v3): a level's height function sampled on a regular grid. The same samples make the drawn mesh, the
// Rapier heightfield and the grass's height map, so what you see is exactly what you stand on (no invisible bumps
// or edges). A coarse far skirt carries the land out to the horizon. Vertex colours paint it (meadow, path, mud,
// rock) from the level's colour function.
import * as THREE from 'three';
import { RAPIER, Physics, L } from '../physics';
import { toy } from '../render/materials';

export type TerrainSpec = {
  cx: number; cz: number; half: number; step: number; // the playable square: centre, half-size, grid spacing (m)
  height: (x: number, z: number) => number;
  color: (x: number, z: number, h: number, slope: number) => THREE.Color;
  // 0..1 grass density (0 on paths, water, rock).
  grass: (x: number, z: number, h: number, slope: number) => number;
  farHalf?: number; farStep?: number;
};

export class Terrain {
  n: number; // samples per side
  heights: Float32Array; // [iz * n + ix]
  mesh: THREE.Mesh;
  far: THREE.Mesh;
  // Height (r) and grass density (g) over the square, for the grass shader.
  map: THREE.DataTexture;

  constructor(public spec: TerrainSpec) {
    const { cx, cz, half, step } = spec;
    const n = this.n = Math.round((half * 2) / step) + 1;
    const H = this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) H[iz * n + ix] = spec.height(cx - half + ix * step, cz - half + iz * step);
    // The near mesh.
    const pos = new Float32Array(n * n * 3), colr = new Float32Array(n * n * 3);
    const dens = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix, x = cx - half + ix * step, z = cz - half + iz * step, h = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const hx = H[iz * n + Math.min(n - 1, ix + 1)] - H[iz * n + Math.max(0, ix - 1)];
      const hz = H[Math.min(n - 1, iz + 1) * n + ix] - H[Math.max(0, iz - 1) * n + ix];
      const slope = Math.hypot(hx, hz) / (2 * step);
      const c = spec.color(x, z, h, slope);
      colr[k * 3] = c.r; colr[k * 3 + 1] = c.g; colr[k * 3 + 2] = c.b;
      dens[k] = spec.grass(x, z, h, slope);
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      // Split each cell along the same diagonal as Rapier's heightfield (b-c), so the surfaces agree exactly.
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, toy('#ffffff', { vertexColors: true, rough: 0.95 }));
    this.mesh.receiveShadow = true;
    this.mesh.name = 'Terrain';
    // The far skirt: coarse, and deep under the near square (its big triangles would otherwise bridge a narrow glen).
    const fh = spec.farHalf ?? 2400, fs = spec.farStep ?? 60, fn = Math.round((fh * 2) / fs) + 1;
    const fg = new THREE.PlaneGeometry(fh * 2, fh * 2, fn - 1, fn - 1).rotateX(-Math.PI / 2);
    const fp = fg.attributes.position, fc = new Float32Array(fp.count * 3);
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i) + cx, z = fp.getZ(i) + cz;
      const inside = Math.abs(x - cx) < half - fs && Math.abs(z - cz) < half - fs;
      const h = spec.height(x, z) - (inside ? 60 : 0.05);
      fp.setXYZ(i, x, h, z);
      const c = spec.color(x, z, h, 0);
      fc[i * 3] = c.r; fc[i * 3 + 1] = c.g; fc[i * 3 + 2] = c.b;
    }
    fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    fg.computeVertexNormals();
    this.far = new THREE.Mesh(fg, toy('#ffffff', { vertexColors: true, rough: 0.95 }));
    this.far.name = 'TerrainFar';
    // Height and grass density for the grass shader (half floats filter linearly everywhere WebGL2 runs).
    const tex = new Uint16Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      tex[i * 4] = THREE.DataUtils.toHalfFloat(H[i]);
      tex[i * 4 + 1] = THREE.DataUtils.toHalfFloat(dens[i]);
      tex[i * 4 + 2] = THREE.DataUtils.toHalfFloat(colr[i * 3 + 1]);
      tex[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    this.map = new THREE.DataTexture(tex, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    this.map.magFilter = THREE.LinearFilter; this.map.minFilter = THREE.LinearFilter;
    this.map.needsUpdate = true;
  }

  // The collider: a heightfield on the same samples (columns along x, rows along z).
  addTo(physics: Physics) {
    const { cx, cz, half } = this.spec, n = this.n, H = this.heights;
    const hf = new Float32Array(n * n);
    for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) hf[ix * n + iz] = H[iz * n + ix];
    const desc = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, hf, { x: half * 2, y: 1, z: half * 2 }).setTranslation(cx, 0, cz);
    physics.addFixed(desc, { kind: 'grass' }, L.world);
  }

  // Height of the drawn (and collided) surface at (x, z): the same triangles as the mesh.
  heightAt(x: number, z: number) {
    const { cx, cz, half, step } = this.spec, n = this.n;
    const fx = (x - (cx - half)) / step, fz = (z - (cz - half)) / step;
    if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return this.spec.height(x, z);
    const ix = Math.min(n - 2, Math.floor(fx)), iz = Math.min(n - 2, Math.floor(fz));
    const u = fx - ix, v = fz - iz, H = this.heights;
    const a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
    // Triangles a-c-b (u + v <= 1) and b-c-d.
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  dispose() { this.mesh.geometry.dispose(); this.far.geometry.dispose(); this.map.dispose(); }
}
