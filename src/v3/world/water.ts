// Water (v3): ponds, streams and moats as flat surfaces over beds the level carves (or over channels it builds).
// Drawn by depth: clear and green-brown at the edge with a ring of foam, deep teal in the middle; the sky in it at
// a low angle and the sun's glint; slow wind ripples and rings where something swims or wades. The motor asks
// `surfaceAt` where the water stands: she swims, he wades and, deeper, sinks.
import * as THREE from 'three';
import { noiseTexture } from '../render/look';
import { MOOR_FOG, MOOR_FOG_PARS, AIR_LEVEL } from '../render/materials';
import { WIND } from '../body';

// An ellipse with a wandering shore (wobble 0: clean), or a rectangle (`rect`: a channel or moat).
export type Pool = {
  x: number; z: number; rx: number; rz: number; rot: number; level: number; depth: number; seed: number;
  carve?: boolean; wobble?: number; rect?: boolean; bounds?: { x0: number; x1: number; z0: number; z1: number };
  flow?: THREE.Vector2; // a current (m/s) that carries a swimmer
  mesh?: THREE.Mesh; base?: number;
};

const RINGS = 8;

// Store the ripple slope in two channels once, replacing six height samples per water pixel with two reads.
// This is derived from our procedural noise, with no downloaded normal map or extra load request.
let RIPPLE_NOISE: THREE.DataTexture | null = null;
function rippleNoise() {
  if (RIPPLE_NOISE) return RIPPLE_NOISE;
  const source = noiseTexture().image as { data: Uint8Array; width: number; height: number };
  const n = source.width, data = new Uint8Array(n * n * 4);
  const h = (x: number, y: number) => source.data[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    data[i] = source.data[i];
    data[i + 1] = Math.round((0.5 + (h(x + 3, y) - h(x - 3, y)) * 0.5) * 255);
    data[i + 2] = Math.round((0.5 + (h(x, y + 3) - h(x, y - 3)) * 0.5) * 255);
    data[i + 3] = 255;
  }
  RIPPLE_NOISE = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  RIPPLE_NOISE.wrapS = RIPPLE_NOISE.wrapT = THREE.RepeatWrapping;
  RIPPLE_NOISE.magFilter = THREE.LinearFilter; RIPPLE_NOISE.minFilter = THREE.LinearMipmapLinearFilter;
  RIPPLE_NOISE.generateMipmaps = true; RIPPLE_NOISE.needsUpdate = true;
  return RIPPLE_NOISE;
}

export class Water {
  pools: Pool[] = [];
  group = new THREE.Group();
  uniforms: Record<string, THREE.IUniform>;
  private ringI = 0;
  private emitT = new Map<object, number>();

  constructor() {
    this.group.name = 'Water';
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, noise: { value: null }, rippleNoise: { value: rippleNoise() },
      wind: { value: new THREE.Vector2(1, 0) }, windStrength: { value: 0.3 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunC: { value: new THREE.Color(1, 1, 1) },
      skyC: { value: new THREE.Color() }, horizonC: { value: new THREE.Color() }, shallowC: { value: new THREE.Color('#73857c') },
      deepC: { value: new THREE.Color('#334f57') }, foamC: { value: new THREE.Color('#cad2cb') },
      rings: { value: Array.from({ length: RINGS }, () => new THREE.Vector4(0, 0, -100, 0)) },
    }]);
    this.uniforms.noise.value = noiseTexture();
    this.uniforms.airLevel = AIR_LEVEL;
  }

  add(p: Omit<Pool, 'seed'> & { seed?: number }) { const q = { seed: this.pools.length * 1.7 + 0.4, ...p } as Pool; this.pools.push(q); return q; }

  setLevel(p: Pool, level: number) { p.level = level; if (p.mesh) p.mesh.position.y = level - (p.base ?? level); }

  // How far out from the middle (1 on the shore).
  q(p: Pool, x: number, z: number) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const dx = x - p.x, dz = z - p.z;
    const lx = (c * dx + s * dz) / p.rx, lz = (-s * dx + c * dz) / p.rz;
    if (p.rect) return Math.max(Math.abs(lx), Math.abs(lz));
    const a = Math.atan2(lz, lx), k = p.wobble ?? 1;
    const wob = 1 + k * (0.11 * Math.sin(3 * a + p.seed) + 0.06 * Math.sin(5 * a + p.seed * 2.3) + 0.04 * Math.sin(8 * a + p.seed * 4.1));
    return Math.hypot(lx, lz) / wob;
  }
  private inBounds(p: Pool, x: number, z: number) { const b = p.bounds; return !b || (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1); }

  poolAt(x: number, z: number) { for (const p of this.pools) if (this.q(p, x, z) < 1.25 && this.inBounds(p, x, z)) return p; return null; }
  surfaceAt(x: number, z: number): number | null { const p = this.poolAt(x, z); return p ? p.level : null; }

  // Carve the beds into the land's height: a bowl to `depth` under the surface, banks rising out of it.
  carve(h: number, x: number, z: number) {
    for (const p of this.pools) {
      if (p.carve === false) continue;
      const q = this.q(p, x, z);
      if (q >= 2.0) continue;
      if (q < 1) h = Math.min(h, p.level - p.depth * Math.pow(1 - q * q, 0.55) - 0.04);
      else {
        const bank = p.level - 0.04 + (q - 1) * 0.6;
        h = THREE.MathUtils.lerp(bank, h, THREE.MathUtils.smoothstep(q, 1.0, 2.0));
        if (q < 1.3) h = Math.max(h, p.level - 0.04 + (q - 1) * 0.3);
      }
    }
    return h;
  }

  build(height: (x: number, z: number) => number, look: { sunDir: THREE.Vector3; sun: THREE.Color; sky: THREE.Color; horizon: THREE.Color }) {
    const u = this.uniforms;
    (u.sunDir.value as THREE.Vector3).copy(look.sunDir); (u.sunC.value as THREE.Color).copy(look.sun);
    (u.skyC.value as THREE.Color).copy(look.sky); (u.horizonC.value as THREE.Color).copy(look.horizon);
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true });
    for (const p of this.pools) {
      const ext = p.rect ? 1.02 : 1.3, cell = 0.55;
      const nx = Math.min(192, Math.ceil(p.rx * 2 * ext / cell)), nz = Math.min(192, Math.ceil(p.rz * 2 * ext / cell));
      const g = new THREE.PlaneGeometry(2 * ext, 2 * ext, nx, nz).rotateX(-Math.PI / 2);
      const pos = g.attributes.position, depth = new Float32Array(pos.count);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i) * p.rx, lz = pos.getZ(i) * p.rz;
        const x = p.x + c * lx - s * lz, z = p.z + s * lx + c * lz;
        pos.setXYZ(i, x, p.level, z);
        depth[i] = p.level - height(x, z);
      }
      g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
      const idx = g.index!.array, keep: number[] = [];
      for (let i = 0; i < idx.length; i += 3) {
        const d = Math.max(depth[idx[i]], depth[idx[i + 1]], depth[idx[i + 2]]);
        const cx = (pos.getX(idx[i]) + pos.getX(idx[i + 1]) + pos.getX(idx[i + 2])) / 3, cz = (pos.getZ(idx[i]) + pos.getZ(idx[i + 1]) + pos.getZ(idx[i + 2])) / 3;
        if (d > -0.03 && this.inBounds(p, cx, cz)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      p.mesh = m; p.base = p.level;
      this.group.add(m);
    }
    return this.group;
  }

  ripple(x: number, z: number, strength = 1) {
    (this.uniforms.rings.value as THREE.Vector4[])[this.ringI].set(x, z, this.uniforms.time.value as number, strength);
    this.ringI = (this.ringI + 1) % RINGS;
  }

  update(dt: number, inWater: { key: object; pos: THREE.Vector3; speed: number; size: number }[]) {
    this.uniforms.time.value = (this.uniforms.time.value as number) + dt;
    (this.uniforms.wind.value as THREE.Vector2).copy(WIND.dir);
    this.uniforms.windStrength.value = WIND.base + WIND.gust * 0.7;
    for (const w of inWater) {
      const lvl = this.surfaceAt(w.pos.x, w.pos.z);
      if (lvl === null || w.pos.y > lvl + 0.03 || w.pos.y < lvl - 2.5) { this.emitT.delete(w.key); continue; }
      const t = (this.emitT.get(w.key) ?? 0) - dt;
      if (t <= 0) { this.ripple(w.pos.x, w.pos.z, w.size * (w.speed > 0.2 ? 1 : 0.5)); this.emitT.set(w.key, w.speed > 0.2 ? 0.3 : 1.3); }
      else this.emitT.set(w.key, t);
    }
  }
}

const VERT = /* glsl */ `
attribute float depth;
varying float vDepth; varying vec3 vW;
varying float vAirHeight;
#include <fog_pars_vertex>
void main(){
  vDepth = depth;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vAirHeight = w.y;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float time, windStrength; uniform sampler2D noise, rippleNoise; uniform vec2 wind;
uniform vec3 sunDir, sunC, skyC, horizonC, shallowC, deepC, foamC;
uniform vec4 rings[${RINGS}];
varying float vDepth; varying vec3 vW;
${MOOR_FOG_PARS}
#include <fog_pars_fragment>
void main(){
  vec2 p = vW.xz;
  // Ripples: two layers of noise drifting, as a slope.
  vec2 a = p * 0.18 - wind * time * (0.012 + windStrength * 0.025);
  vec2 b = p * 0.47 - wind * time * (0.02 + windStrength * 0.04);
  vec2 grad = ((texture2D(rippleNoise, a).gb - 0.5) + (texture2D(rippleNoise, b).gb - 0.5) * 0.6) * (1.5 + windStrength);
  float foamRing = 0.0;
  for (int i = 0; i < ${RINGS}; i++) {
    vec4 r = rings[i];
    float age = max(time - r.z, 0.0);
    if (age > 3.8 || r.w <= 0.0) continue;
    vec2 dv = p - r.xy; float dl = max(length(dv), 0.001);
    float front = age * 0.35, edge = dl - front;
    if (abs(edge) > 0.4) continue;
    float env = r.w * exp(-age * 1.3 - edge * edge * 70.0) * smoothstep(0.0, 0.05, age);
    grad += dv / dl * cos((dl - front) * 45.0) * env * 0.5;
    foamRing += env * 0.35;
  }
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  float deep = smoothstep(0.0, 0.9, vDepth);
  vec3 body = mix(shallowC, deepC, deep);
  vec3 c = body * (skyC * 0.75 + sunC * 0.35 * max(sunDir.y, 0.2));
  c = mix(c, horizonC, fres * 0.65);
  vec3 h = normalize(sunDir + v);
  c += sunC * pow(max(dot(n, h), 0.0), 110.0) * 0.6;
  // Foam along the shore, breathing.
  float shore = 1.0 - smoothstep(0.02, 0.12 + 0.04 * sin(time * 1.3 + p.x * 0.7), vDepth);
  float foamN = texture2D(noise, p * 0.9 + time * 0.02).b;
  float foam = clamp(shore * smoothstep(0.35, 0.6, foamN + shore * 0.4) + foamRing, 0.0, 1.0);
  c = mix(c, foamC * (skyC * 0.6 + sunC * 0.5), foam * 0.85);
  float alpha = clamp(smoothstep(-0.02, 0.1, vDepth) * mix(0.55, 0.94, smoothstep(0.03, 0.6, vDepth)) + foam * 0.3, 0.0, 1.0);
  gl_FragColor = vec4(c, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${MOOR_FOG}
}`;
