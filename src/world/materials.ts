// Field materials: weathered stone, rock, wet timber, iron, water.
import * as THREE from 'three/webgpu';
import {
  positionWorld, positionLocal, normalWorld, mx_noise_float, mx_fractal_noise_float, vec3, vec2, float, mix, smoothstep, fract, floor, sin, dot,
  color, step, abs, Fn, uv, length, bumpMap, clamp, max, min,
} from 'three/tsl';
import { procBump } from '../render/bump';
import { WIND } from '../render/settings';

const hash2 = Fn(([p]: any[]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

// Irregular coursed masonry, damp toward the ground, moss on top faces.
export function stoneMaterial(opts: { tint?: string; courseH?: number; mossy?: number } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const ch = float(opts.courseH ?? 0.27);
  const row = floor(p.y.div(ch));
  const along = p.x.add(p.z.mul(0.93));
  const len = float(0.42).add(hash2(vec2(row, 3.1)).mul(0.25));
  const col = floor(along.div(len).add(row.mul(0.37)));
  const fy = fract(p.y.div(ch)), fx = fract(along.div(len).add(row.mul(0.37)));
  const mortar = max(smoothstep(0.08, 0.0, min(fy, float(1).sub(fy))), smoothstep(0.05, 0.0, min(fx, float(1).sub(fx))).mul(step(0.3, abs(normalWorld.y).oneMinus())));
  const stoneId = hash2(vec2(row, col));
  const grit = mx_fractal_noise_float(p.mul(5.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const big = mx_fractal_noise_float(p.mul(0.35), 2, 2.0, 0.5).mul(0.5).add(0.5);
  let c = mix(color(opts.tint ?? '#6c6a62'), color('#5a5750'), stoneId);
  c = c.mul(grit.mul(0.3).add(0.82)).mul(big.mul(0.2).add(0.9));
  c = mix(c, color('#2f2c27'), mortar.mul(0.8));
  // Damp darkening near the soil and lichen speckle.
  const damp = smoothstep(0.9, 0.0, positionLocal.y);
  c = c.mul(mix(float(1), float(0.62), damp));
  const lichen = smoothstep(0.62, 0.72, mx_noise_float(p.mul(3.3)).mul(0.5).add(0.5));
  c = mix(c, color('#8d8f78'), lichen.mul(0.35));
  const moss = smoothstep(0.45, 0.85, normalWorld.y).mul(smoothstep(0.35, 0.7, grit.add(big.mul(0.3)))).mul(opts.mossy ?? 1);
  c = mix(c, color('#3f4a26'), moss.mul(0.85));
  m.colorNode = c;
  m.roughnessNode = float(0.86).sub(damp.mul(0.2)).add(mortar.mul(0.08));
  m.metalness = 0;
  m.normalNode = procBump(grit.mul(0.6).sub(mortar.mul(0.8)).mul(0.012), float(0.04));
  return m;
}

export function rockMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = mx_fractal_noise_float(p.mul(1.7), 4, 2.0, 0.5).mul(0.5).add(0.5);
  const f = mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5);
  let c = mix(color('#595850'), color('#6f6c62'), n).mul(f.mul(0.2).add(0.88));
  const damp = smoothstep(0.5, 0.0, positionLocal.y.add(0.25));
  c = c.mul(mix(float(1), float(0.6), damp));
  const lichen = smoothstep(0.64, 0.7, mx_noise_float(p.mul(4.1).add(3.0)).mul(0.5).add(0.5));
  c = mix(c, color('#9a9a82'), lichen.mul(0.4));
  const moss = smoothstep(0.5, 0.9, normalWorld.y).mul(smoothstep(0.4, 0.7, n));
  c = mix(c, color('#414b28'), moss.mul(0.8));
  m.colorNode = c;
  m.roughnessNode = float(0.9).sub(damp.mul(0.3));
  m.normalNode = procBump(n.add(f.mul(0.3)).mul(0.03), float(0.08));
  return m;
}

export function timberMaterial(hex = '#3d3328') {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal;
  const grain = sin(p.y.mul(9.0).add(mx_noise_float(p.mul(vec3(2.0, 0.3, 2.0))).mul(6.0))).mul(0.5).add(0.5);
  const n = mx_fractal_noise_float(p.mul(4.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  m.colorNode = color(hex).mul(grain.mul(0.18).add(0.85)).mul(n.mul(0.25).add(0.8));
  m.roughnessNode = float(0.78).sub(n.mul(0.15));
  m.metalness = 0;
  m.normalNode = procBump(grain.mul(0.5).add(n.mul(0.5)).mul(0.004), float(0.01));
  return m;
}

export function ironMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const n = mx_fractal_noise_float(positionWorld.mul(6.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const rust = smoothstep(0.45, 0.75, n);
  m.colorNode = mix(color('#3a3936'), color('#5a3a26'), rust.mul(0.7));
  m.metalnessNode = mix(float(0.85), float(0.1), rust);
  m.roughnessNode = mix(float(0.5), float(0.85), rust);
  return m;
}

// Shallow, quiet puddle surface with soft edges and faint wind ripples.
export function waterMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false });
  const d = length(uv().sub(0.5).mul(2.0));
  const edge = smoothstep(1.0, 0.45, d);
  const rip = mx_noise_float(vec3(positionWorld.xz.mul(4.0).sub(vec2(WIND.dir.x, WIND.dir.y).mul(WIND.time).mul(0.8)), WIND.time.mul(0.3)));
  m.colorNode = color('#24261f');
  m.opacityNode = edge.mul(0.92);
  // Muddy, shallow water: the sky reflection is softened and dimmed by the silt and the ripples.
  m.roughness = 0.1;
  m.metalness = 0;
  m.ior = 1.33;
  m.specularIntensity = 0.5;
  m.normalNode = procBump(rip.mul(0.5).mul(0.004), float(0.05));
  void clamp;
  return m;
}

// Distant silhouettes (castle) carry their own gentler atmospheric fade so they read faintly through the haze.
// Distant silhouettes: mostly fog colour. With `mistBaseY`, the base dissolves into the ground mist so a far
// building rises out of the haze instead of floating above a fully fogged hill.
export function silhouetteMaterial(fogColor: any, amount: number, base = '#4a4c4f', mistBaseY?: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.fog = false;
  const h = smoothstep(-10.0, 60.0, positionLocal.y);
  const mottled = mx_fractal_noise_float(positionWorld.mul(0.15), 2, 2.0, 0.5).mul(0.08);
  let f: any = float(amount).add(h.mul(0.06));
  if (mistBaseY !== undefined) f = mix(float(1.0), f, smoothstep(mistBaseY, mistBaseY + 18, positionWorld.y));
  m.colorNode = mix(color(base).add(mottled), fogColor, f);
  return m;
}
