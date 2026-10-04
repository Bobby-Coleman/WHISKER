// Water (engine v2): ponds as flat surfaces over basins carved into the moor. A pond's shore is an ellipse with a
// wandering edge; the level's height function carves its bed (`carve`) so the real shoreline is where the ground
// meets the surface. The surface is drawn by depth (clear and muddy at the edge, dark over the deep middle, with
// the sky in it at a low angle), stirred by slow wind ripples and by rings where something swims or wades.
// The motor (motor.ts) asks `surfaceAt` where the water stands: she swims, he walks the bottom.
import * as THREE from 'three/webgpu';
import { Fn, uniform, uniformArray, vec2, vec3, float, positionWorld, attribute, smoothstep, mix, color, normalize, cos, exp, length, transformNormalToView } from 'three/tsl';
import { bakedNoise } from '../render/noisetex';

export type Pool = { x: number; z: number; rx: number; rz: number; rot: number; level: number; depth: number; seed: number };

const RIPPLES = 10;

export class Water {
  pools: Pool[] = [];
  group = new THREE.Group();
  private clock = uniform(0);
  private rings = uniformArray(Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)), 'vec4');
  private ringI = 0;
  private emitT = new Map<object, number>();

  constructor() { this.group.name = 'Water'; }

  add(p: Omit<Pool, 'seed'> & { seed?: number }) { this.pools.push({ seed: this.pools.length * 1.7 + 0.4, ...p }); }

  // How far out from a pond's middle a point is: 1 on its (wandering) shore.
  q(p: Pool, x: number, z: number) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const dx = x - p.x, dz = z - p.z;
    const lx = (c * dx + s * dz) / p.rx, lz = (-s * dx + c * dz) / p.rz;
    const a = Math.atan2(lz, lx);
    const wob = 1 + 0.11 * Math.sin(3 * a + p.seed) + 0.06 * Math.sin(5 * a + p.seed * 2.3) + 0.04 * Math.sin(8 * a + p.seed * 4.1);
    return Math.hypot(lx, lz) / wob;
  }

  // The water's surface over (x, z), or null where there is no pond.
  surfaceAt(x: number, z: number): number | null {
    for (const p of this.pools) if (this.q(p, x, z) < 1.3) return p.level;
    return null;
  }

  // The moor's height with the ponds' beds carved in: a bowl down to `depth` under the surface, banks that rise
  // out of the water and blend back into the moor.
  carve(h: number, x: number, z: number) {
    for (const p of this.pools) {
      const q = this.q(p, x, z);
      if (q >= 2.2) continue;
      if (q < 1) {
        const bed = p.level - p.depth * Math.pow(1 - q * q, 0.6) - 0.03;
        h = Math.min(h, bed);
      } else {
        const bank = p.level - 0.03 + (q - 1) * 0.55;
        const w = THREE.MathUtils.smoothstep(q, 1.0, 2.2);
        h = THREE.MathUtils.lerp(bank, h, w);
        // Never a hollow under the surface's edge (the surface is drawn out to q = 1.35).
        if (q < 1.4) h = Math.max(h, p.level - 0.03 + (q - 1) * 0.25);
      }
    }
    return h;
  }

  // The surfaces, once the moor's height (with the beds) is known.
  build(height: (x: number, z: number) => number) {
    const mat = this.material();
    for (const p of this.pools) {
      const ext = 1.38, n = Math.ceil(Math.max(p.rx, p.rz) * 2 * ext / 0.25);
      const g = new THREE.PlaneGeometry(2 * ext, 2 * ext, n, n).rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      const depth = new Float32Array(pos.count);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i) * p.rx, lz = pos.getZ(i) * p.rz;
        const x = p.x + c * lx - s * lz, z = p.z + s * lx + c * lz;
        pos.setXYZ(i, x, p.level, z);
        depth[i] = p.level - height(x, z);
      }
      g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
      // Only the triangles that are over water (or at its very edge).
      const idx = g.index!.array, keep: number[] = [];
      for (let i = 0; i < idx.length; i += 3) {
        const d = Math.max(depth[idx[i]], depth[idx[i + 1]], depth[idx[i + 2]]);
        if (d > -0.02) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = false;
      m.renderOrder = 2;
      this.group.add(m);
    }
    return this.group;
  }

  private material() {
    // Physical, for water's own index and a softer sheen: it should read as peaty water under a grey sky, not a
    // mirror of it.
    const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, roughness: 0.1, metalness: 0, ior: 1.33, specularIntensity: 0.55 });
    const d = attribute('depth', 'float');
    const t = this.clock;
    // Wind ripples (two scrolling layers of baked noise), rain pocking the surface, and rings spreading from
    // whatever swims or wades.
    const grad = Fn(() => {
      const p = positionWorld.xz;
      const n1 = bakedNoise(p.mul(0.7).add(vec2(t.mul(0.09), t.mul(0.06))));
      const n2 = bakedNoise(p.mul(2.1).sub(vec2(t.mul(0.13), t.mul(-0.07))));
      const n3 = bakedNoise(p.mul(9.0).add(vec2(t.mul(0.6), t.mul(-0.9))));
      const gx = n1.b.mul(0.13).add(n2.a.mul(0.08)).add(n3.b.mul(0.07)).toVar();
      const gz = n1.a.mul(0.13).add(n2.b.mul(0.08)).add(n3.a.mul(0.07)).toVar();
      for (let i = 0; i < RIPPLES; i++) {
        const r = this.rings.element(i) as any;
        const dv = p.sub(r.xy);
        const dist = length(dv).max(1e-3);
        const age = t.sub(r.z).max(0);
        const front = age.mul(0.32);
        const env = r.w.mul(exp(age.mul(-1.4))).mul(exp(dist.sub(front).pow(2).mul(-60))).mul(smoothstep(0.0, 0.05, age));
        const k = cos(dist.sub(front).mul(48)).mul(env).mul(0.6);
        gx.addAssign(dv.x.div(dist).mul(k));
        gz.addAssign(dv.y.div(dist).mul(k));
      }
      return vec3(gx, 0, gz);
    })();
    m.normalNode = transformNormalToView(normalize(vec3(grad.x.negate(), float(1), grad.z.negate())));
    // Colour by depth: brown and clear at the edge, peaty black-green in the deep middle.
    const deep = smoothstep(0.0, 0.75, d);
    m.colorNode = mix(color('#4e4a37'), color('#0d1716'), deep);
    // See-through over the shallows (the bed shows), nearly opaque in the deep; soft where it meets the shore.
    m.opacityNode = smoothstep(-0.015, 0.09, d).mul(mix(float(0.5), float(0.95), smoothstep(0.03, 0.5, d)));
    m.roughnessNode = mix(float(0.2), float(0.09), deep);
    return m;
  }

  // A ring on the surface at (x, z).
  ripple(x: number, z: number, strength = 1) {
    this.rings.array[this.ringI] = new THREE.Vector4(x, z, this.clock.value as number, strength);
    this.ringI = (this.ringI + 1) % RIPPLES;
  }

  // Each frame: the clock, and rings from whatever is in the water (every so often while it moves, rarely at rest).
  update(dt: number, inWater: { key: object; pos: THREE.Vector3; speed: number; size: number }[]) {
    this.clock.value = (this.clock.value as number) + dt;
    for (const w of inWater) {
      const lvl = this.surfaceAt(w.pos.x, w.pos.z);
      if (lvl === null || w.pos.y > lvl + 0.02 || w.pos.y < lvl - 2.5) { this.emitT.delete(w.key); continue; }
      const t = (this.emitT.get(w.key) ?? 0) - dt;
      if (t <= 0) {
        this.ripple(w.pos.x, w.pos.z, w.size * (w.speed > 0.2 ? 1 : 0.5));
        this.emitT.set(w.key, w.speed > 0.2 ? 0.32 : 1.4);
      } else this.emitT.set(w.key, t);
    }
  }
}
