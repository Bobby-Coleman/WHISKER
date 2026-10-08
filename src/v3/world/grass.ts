// Grass (v3): blades drawn on the GPU in square patches round the camera. Each patch is the same geometry (a few
// hundred blades, five vertices each); instances carry only the patch's origin. The vertex shader stands each
// blade on the terrain (its height map), thins it where the level says there is no grass (paths, water, rock),
// bends it in the wind (a steady sway plus gust waves that roll across the field) and away from the characters'
// feet. Two rings: dense near the camera, sparser and broader further out, fading at the edge.
import * as THREE from 'three';
import type { Terrain } from './terrain';
import { WIND } from '../body';
import { MOOR_FOG, MOOR_FOG_PARS, AIR_LEVEL } from '../render/materials';

export type GrassTier = { near: number; far: number; denseBlades: number; sparseBlades: number };
export const GRASS_TIERS: Record<string, GrassTier> = {
  high: { near: 15, far: 36, denseBlades: 850, sparseBlades: 140 },
  medium: { near: 12, far: 28, denseBlades: 600, sparseBlades: 100 },
  low: { near: 8, far: 20, denseBlades: 340, sparseBlades: 70 },
};
const P = 4; // patch size (m)

function patchGeometry(blades: number, width: number, seed: number, coarse = false) {
  const vertices = coarse ? 3 : 5;
  const pos = new Float32Array(blades * vertices * 3), blade = new Float32Array(blades * vertices * 4), shape = new Float32Array(blades * vertices * 2);
  const idx: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < blades; b++) {
    const ox = rnd() * P, oz = rnd() * P, yaw = rnd() * Math.PI * 2, r1 = rnd(), r2 = rnd();
    const verts = coarse ? [[-1, 0], [1, 0], [0, 1]] : [[-1, 0], [1, 0], [-0.7, 0.45], [0.7, 0.45], [0, 1]];
    verts.forEach(([sx, sy], i) => {
      const k = b * vertices + i;
      pos[k * 3] = sx; pos[k * 3 + 1] = sy; pos[k * 3 + 2] = 0;
      blade[k * 4] = ox; blade[k * 4 + 1] = oz; blade[k * 4 + 2] = yaw; blade[k * 4 + 3] = r1;
      shape[k * 2] = r2; shape[k * 2 + 1] = width;
    });
    const o = b * vertices;
    if (coarse) idx.push(o, o + 1, o + 2);
    else idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('blade', new THREE.BufferAttribute(blade, 4));
  g.setAttribute('shape', new THREE.BufferAttribute(shape, 2));
  g.setIndex(idx);
  return g;
}

export type GrassLook = { root: string; mid: string; tip: string; dry: string; height: number };

export class Grass {
  group = new THREE.Group();
  uniforms: Record<string, THREE.IUniform>;
  private rings: { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; origins: THREE.InstancedBufferAttribute; r0: number; r1: number }[] = [];
  private cellX = Infinity;
  private cellZ = Infinity;
  pushers = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];

  constructor(terrain: Terrain, tier: GrassTier, look: GrassLook, lights: { sunDir: THREE.Vector3; sun: THREE.Color; sky: THREE.Color; ground: THREE.Color }) {
    const t = terrain.spec;
    this.uniforms = {
      map: { value: terrain.map }, mapOrigin: { value: new THREE.Vector2(t.cx - t.half, t.cz - t.half) }, mapSize: { value: t.half * 2 },
      mapN: { value: terrain.n }, time: { value: 0 }, windDir: { value: new THREE.Vector2(1, 0) }, sway: { value: 0.25 }, gust: { value: 0 },
      center: { value: new THREE.Vector2() }, ringR: { value: new THREE.Vector2(0, 10) },
      cRoot: { value: new THREE.Color(look.root) }, cMid: { value: new THREE.Color(look.mid) }, cTip: { value: new THREE.Color(look.tip) },
      cDry: { value: new THREE.Color(look.dry) }, hScale: { value: look.height },
      sunDir: { value: lights.sunDir }, sunC: { value: lights.sun }, skyC: { value: lights.sky }, groundC: { value: lights.ground },
      pushers: { value: this.pushers },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 },
      airLevel: AIR_LEVEL,
    };
    const make = (blades: number, width: number, r0: number, r1: number, seed: number) => {
      const geo = patchGeometry(blades, width, seed, r0 > 0);
      const maxPatches = Math.ceil(Math.PI * (r1 + P * 1.5) ** 2 / (P * P)) + 8;
      const origins = new THREE.InstancedBufferAttribute(new Float32Array(maxPatches * 2), 2);
      origins.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('origin', origins);
      geo.instanceCount = 0;
      const u = { ...this.uniforms, ringR: { value: new THREE.Vector2(r0, r1) } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = 'Grass';
      this.group.add(mesh);
      this.rings.push({ mesh, geo, origins, r0, r1 });
    };
    make(tier.denseBlades, 0.009, 0, tier.near, 11);
    make(tier.sparseBlades, 0.015, tier.near, tier.far, 23);
  }

  // Each frame: the patches round the camera's focus, the clock, the wind, the fog.
  update(dt: number, focus: THREE.Vector3, fog: THREE.Fog | null) {
    const u = this.uniforms;
    u.time.value += dt;
    (u.windDir.value as THREE.Vector2).copy(WIND.dir);
    u.gust.value = WIND.gust;
    u.sway.value = 0.18 + WIND.base * 0.5;
    if (fog) { (u.fogColor.value as THREE.Color).copy(fog.color); u.fogNear.value = fog.near; u.fogFar.value = fog.far; }
    (u.center.value as THREE.Vector2).set(focus.x, focus.z);
    const cx = Math.floor(focus.x / P), cz = Math.floor(focus.z / P);
    // Wind, feet, distance fade and fog stay on the GPU. Upload roots only on crossing a four-metre cell.
    if (cx === this.cellX && cz === this.cellZ) return;
    this.cellX = cx; this.cellZ = cz;
    const anchorX = (cx + 0.5) * P, anchorZ = (cz + 0.5) * P;
    for (const r of this.rings) {
      const reach = Math.ceil(r.r1 / P) + 2;
      let n = 0;
      const a = r.origins.array as Float32Array, max = a.length / 2;
      for (let iz = -reach; iz <= reach; iz++) for (let ix = -reach; ix <= reach; ix++) {
        const x = (cx + ix) * P, z = (cz + iz) * P;
        // The patch's nearest and furthest points from the focus.
        const nx = Math.max(x - anchorX, 0, anchorX - (x + P)), nz = Math.max(z - anchorZ, 0, anchorZ - (z + P));
        const near = Math.hypot(nx, nz);
        const fx = Math.max(Math.abs(x - anchorX), Math.abs(x + P - anchorX)), fz = Math.max(Math.abs(z - anchorZ), Math.abs(z + P - anchorZ));
        const far = Math.hypot(fx, fz);
        if (near > r.r1 + P * 0.72 || far < r.r0 - P * 0.72 || n >= max) continue;
        a[n * 2] = x; a[n * 2 + 1] = z; n++;
      }
      r.geo.instanceCount = n;
      r.origins.clearUpdateRanges();
      r.origins.needsUpdate = true;
      r.origins.addUpdateRange(0, n * 2);
    }
  }

  dispose() { for (const r of this.rings) { r.geo.dispose(); (r.mesh.material as THREE.Material).dispose(); } }
}

const VERT = /* glsl */ `
uniform sampler2D map; uniform vec2 mapOrigin; uniform float mapSize, mapN;
uniform float time, sway, gust, hScale; uniform vec2 windDir, center, ringR;
uniform vec4 pushers[4];
attribute vec4 blade; attribute vec2 shape; attribute vec2 origin;
varying float vY; varying float vShade; varying vec3 vN;
varying float vAirHeight;
#include <fog_pars_vertex>
void main(){
  vec2 xz = origin + blade.xy;
  vec2 muv = (xz - mapOrigin) / mapSize;
  vec2 tuv = (muv * (mapN - 1.0) + 0.5) / mapN;
  vec4 m = texture2D(map, tuv);
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  float d = distance(xz, center);
  // Thin out where the level has no grass, and toward the ring's edges.
  float dens = m.g * inside;
  float keep = step(blade.w, dens) * (1.0 - smoothstep(ringR.y - 4.0, ringR.y, d)) * (ringR.x > 0.0 ? smoothstep(ringR.x - 2.0, ringR.x + 1.0, d) : 1.0);
  float r2 = shape.x;
  float tall = r2 > 0.965 ? 1.65 : 1.0; // a few fine seed stems, rather than conspicuous triangular spikes
  float h = hScale * (0.55 + 0.6 * fract(r2 * 7.31)) * tall * mix(0.6, 1.0, dens) * keep;
  float w = shape.y * (0.8 + 0.4 * fract(r2 * 3.7)) * keep;
  float y = position.y;
  // The blade, turned about its root.
  float c = cos(blade.z), s = sin(blade.z);
  vec3 p = vec3(position.x * w * c, y * h, position.x * w * s);
  // Wind: a sway, and gust waves rolling downwind; bending grows toward the tip.
  float phase = dot(xz, windDir) * 0.35 - time * 1.7 + r2 * 6.0;
  float wave = sin(dot(xz, windDir) * 0.09 - time * 1.1) * 0.5 + 0.5;
  float bend = (sway * (0.6 + 0.4 * sin(phase)) + gust * (0.4 + 0.9 * pow(wave, 3.0))) * y * y;
  float bendScale = inversesqrt(1.0 + bend * bend * 1.44);
  p.xz += windDir * bend * h * 1.2 * bendScale;
  p.y *= bendScale;
  // Pushed aside by feet.
  for (int i = 0; i < 4; i++) {
    vec4 q = pushers[i];
    vec2 dv = xz - q.xy; float dl = length(dv);
    float f = q.w * (1.0 - smoothstep(0.0, max(q.z, 0.001), dl)) * y;
    p.xz += (dl > 0.001 ? dv / dl : vec2(0.0)) * f * h * 0.9;
    p.y -= f * h * 0.4;
  }
  vec3 world = vec3(xz.x, m.r, xz.y) + p;
  vAirHeight = world.y;
  vY = y;
  vShade = fract(r2 * 13.1);
  vN = normalize(vec3(-s * 0.3 + windDir.x * 0.2, 1.0, c * 0.3 + windDir.y * 0.2));
  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 cRoot, cMid, cTip, cDry, sunDir, sunC, skyC, groundC;
varying float vY; varying float vShade; varying vec3 vN;
${MOOR_FOG_PARS}
#include <fog_pars_fragment>
void main(){
  vec3 base = mix(cRoot, cMid, smoothstep(0.0, 0.38, vY));
  base = mix(base, cTip, smoothstep(0.45, 1.0, vY));
  base = mix(base, cDry, smoothstep(0.75, 1.0, vShade) * 0.6);
  base *= 0.88 + 0.24 * vShade;
  float ndl = max(dot(normalize(vN), sunDir), 0.0) * 0.75 + 0.25;
  vec3 light = skyC * 0.8 + sunC * ndl * 0.4 + sunC * pow(vY, 2.0) * 0.12;
  vec3 c = base * light;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${MOOR_FOG}
}`;
