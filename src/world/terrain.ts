// Playable near terrain plus a coarse distant terrain that dissolves into fog.
import * as THREE from 'three/webgpu';
import {
  attribute, positionWorld, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, vec3, vec4, mix,
  smoothstep, float, color, normalWorld, max, step, abs, texture, length, cameraPosition, vec2,
} from 'three/tsl';
import { FIELD, heightAt, pathDist, wetness } from './layout';
import { characterAO } from '../render/occlusion';
import { procBump } from '../render/bump';
import { FieldMaps, MASK_HALF, PATH_RANGE } from './ground';
import { surface, groundSample, toViewNormal } from './surfaces';
import { bakedNoise } from '../render/noisetex';
import { min, clamp, dot, normalize } from 'three/tsl';

// Playable ground from photo-scanned turf and mud (Poly Haven leafy_grass and brown_mud_02, CC0), laid out by the
// same field maps as the grass blades: the muddy path, wet hollows, thin and dead patches. Near the camera the scans
// carry the detail; with distance the turf takes on the canopy colour the blade carpet shows, so the carpet's edge
// cannot be seen. Wet ground darkens, smooths and holds water in the low parts of each scan's relief.
export function photoTerrainMaterial(maps: FieldMaps) {
  const m = new THREE.MeshStandardNodeMaterial();
  const wp = positionWorld;
  const inside = step(abs(wp.x), MASK_HALF - 1).mul(step(abs(wp.z), MASK_HALF - 1));
  const muv = wp.xz.add(MASK_HALF).div(2 * MASK_HALF);
  const m1: any = texture(maps.mask, muv), m2: any = texture(maps.mask2, muv);
  const pathD = mix(float(1.4), m1.x.mul(PATH_RANGE), inside);
  const wet = mix(float(0.25), max(m1.y, smoothstep(1.6, 0.4, pathD).mul(0.6)), inside);
  const excl = m1.z.mul(inside);
  const vigour = mix(float(0.5), m1.w, inside);
  const dead = mix(float(0.25), m2.x, inside);
  const pud = m2.y.mul(inside);

  // Broad, slow mixers for breaking up the repeat (baked tiling noise, metres-wide patches).
  const nA = bakedNoise(wp.xz.mul(1 / 5.5)).b.mul(0.9).add(0.5);
  const nB = bakedNoise(wp.xz.mul(1 / 4.2).add(vec2(3.7, 1.9))).a.mul(0.9).add(0.5);
  const turf = groundSample(surface('leafy_grass'), wp, normalWorld, 2.3, nA);
  const mud = groundSample(surface('brown_mud_02'), wp, normalWorld, 1.9, nB);

  // Canopy: the colour of grassed ground seen from a few metres up and beyond (as the blades read at distance).
  const broadB = mx_fractal_noise_float(wp.xz.mul(1 / 13).add(7.3), 2, 2.0, 0.5).mul(0.5).add(0.5);
  const living = mix(color('#5a6339'), color('#6c7552'), smoothstep(0.55, 0.85, broadB).mul(0.7));
  let canopy: any = mix(living, color('#85765a'), dead.mul(0.85));
  canopy = canopy.mul(mix(float(0.84), float(1.04), vigour));

  // Turf scan graded to the moor: living olive, with the scan's own straw and leaf litter where grass is dead.
  const lum = dot(turf.albedo, vec3(0.2126, 0.7152, 0.0722));
  const liveTint = vec3(0.285, 0.474, 0.34), deadTint = vec3(0.6, 0.62, 0.72);
  let turfCol: any = turf.albedo.mul(mix(liveTint, deadTint, clamp(dead.mul(0.9), 0, 1)));
  turfCol = turfCol.mul(mix(float(0.86), float(1.04), vigour));
  // Seen from far enough that single leaves blur, the ground reads as canopy modulated by the scan's light and shade.
  const camD = length(wp.sub(cameraPosition));
  const detail = float(1).sub(smoothstep(7.0, 28.0, camD));
  const farTurf = canopy.mul(lum.div(0.235).mul(0.35).add(0.65));
  const grassGround = mix(farTurf, turfCol, detail.mul(0.92));

  // Mud: the trodden path, the bare courtyard and the floors of puddles. Where the two meet, the higher relief wins.
  const pathCore = float(1).sub(smoothstep(0.12, 0.62, pathD));
  const bareMask = max(max(pathCore, excl.mul(0.8)), pud);
  const mudW = smoothstep(0.42, 0.58, bareMask.add(mud.height.sub(turf.height).mul(0.35)).sub(0.12));
  const mudCol = mud.albedo.mul(vec3(1.12, 1.0, 0.86));
  let c: any = mix(grassGround, mudCol, mudW);
  let rough: any = mix(mix(float(0.9), turf.rough, detail.mul(0.6)), mud.rough, mudW);
  let nW: any = normalize(mix(normalWorld, mix(turf.nWorld, mud.nWorld, mudW), mix(float(0.35), float(1), detail)));
  const height = mix(turf.height, mud.height, mudW);

  // Wet ground: darker, smoother; water lies in the low parts of the relief and flattens the normal there.
  const wetMix = smoothstep(0.2, 0.9, wet.add(float(0.5).sub(height).mul(0.35)));
  const pooled = smoothstep(0.5, 0.75, wet.add(pud.mul(0.5))).mul(smoothstep(0.42, 0.22, height)).mul(mudW);
  c = c.mul(mix(float(1), float(0.66), wetMix)).mul(mix(float(1), float(0.82), pooled));
  rough = mix(rough, mix(float(0.42), float(0.3), mudW), wetMix.mul(0.85));
  rough = mix(rough, float(0.06), pooled);
  nW = normalize(mix(nW, normalWorld, pooled.mul(0.9).add(wetMix.mul(0.15))));
  // Slope: exposed soil on the steeper faces of hollows and banks.
  const slope = float(1).sub(normalWorld.y);
  c = mix(c, mudCol.mul(0.85), smoothstep(0.1, 0.32, slope).mul(0.45));

  m.colorNode = c;
  m.roughnessNode = clamp(rough, 0.04, 1);
  m.metalnessNode = float(0);
  m.normalNode = toViewNormal(nW);
  const texAO = mix(turf.ao, mud.ao, mudW);
  m.aoNode = characterAO(positionWorld, normalWorld).mul(mix(float(1), texAO, detail.mul(0.7)));
  void min; void vec4;
  return m;
}

function buildGrid(half: number, step: number, sink: (x: number, z: number) => number) {
  const n = Math.round((half * 2) / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const wet = new Float32Array(n * n);
  const path = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * step, z = -half + j * step;
    const k = j * n + i;
    pos[k * 3] = x; pos[k * 3 + 1] = heightAt(x, z) - sink(x, z); pos[k * 3 + 2] = z;
    const near = Math.abs(x) < 140 && Math.abs(z) < 140;
    wet[k] = near ? wetness(x, z) : 0.2;
    path[k] = near ? 1 - Math.min(1, Math.max(0, (pathDist(x, z) - 0.35) / 1.0)) : 0;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('wet', new THREE.BufferAttribute(wet, 1));
  g.setAttribute('pathMask', new THREE.BufferAttribute(path, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// Ground shading. Grassed ground reads as short turf near the camera and takes on the canopy colour the blades
// would show with distance (living and dead mix, sage patches), so the blade carpet's edge cannot be seen. The muddy
// path carries its own detail: trodden crust, damp hollows, small stones and scraps of grass.
export function terrainMaterial(maps: FieldMaps | null) {
  const m = new THREE.MeshStandardNodeMaterial();
  const wp = positionWorld;
  const wetAttr = attribute('wet', 'float');
  const pathAttr = attribute('pathMask', 'float');
  // Field maps inside the playable area, vertex attributes and broad noise beyond it.
  const inside = maps ? step(abs(wp.x), MASK_HALF - 1).mul(step(abs(wp.z), MASK_HALF - 1)) : float(0);
  const muv = wp.xz.add(MASK_HALF).div(2 * MASK_HALF);
  const m1: any = maps ? texture(maps.mask, muv) : vec4(1, 0, 0, 0.5);
  const m2: any = maps ? texture(maps.mask2, muv) : vec4(0.3, 0, 0, 1);
  const broadA = mx_fractal_noise_float(wp.xz.mul(1 / 34), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const broadB = mx_fractal_noise_float(wp.xz.mul(1 / 13).add(7.3), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const pathD = mix(float(1).sub(pathAttr).mul(1.0).add(0.35), m1.x.mul(PATH_RANGE), inside);
  const wet = mix(wetAttr, max(m1.y, smoothstep(1.6, 0.4, m1.x.mul(PATH_RANGE)).mul(0.6)), inside);
  const excl = m1.z.mul(inside);
  const vigour = mix(broadA, m1.w, inside);
  const dead = mix(float(0.12).add(smoothstep(0.55, 0.8, broadB).mul(0.55)), m2.x, inside);
  const pud = m2.y.mul(inside);

  const fine = mx_fractal_noise_float(wp.xz.mul(1.7), 3, 2.0, 0.55).mul(0.5).add(0.5);
  const micro = mx_noise_float(wp.xz.mul(9.0)).mul(0.5).add(0.5);
  const slope = float(1).sub(normalWorld.y);

  // Canopy: the colour of grassed ground seen from a few metres up and beyond.
  const living = mix(color('#5a6339'), color('#6c7552'), smoothstep(0.55, 0.85, broadB).mul(0.7));
  let canopy: any = mix(living, color('#85765a'), dead.mul(0.85));
  canopy = canopy.mul(mix(float(0.84), float(1.04), vigour)).mul(fine.mul(0.12).add(0.94));
  // Turf: the short, flattened grass under and between the blades. Seen from above the blades cover only a
  // fraction of the ground, so the ground itself must read as grass: fine streaks in two directions (laid-over
  // blades), mottled with dead straw, a little darker than the canopy so the blades stand out on it.
  const camD = length(wp.sub(cameraPosition));
  const rot = (a: number) => vec2(wp.x.mul(Math.cos(a)).add(wp.z.mul(Math.sin(a))), wp.z.mul(Math.cos(a)).sub(wp.x.mul(Math.sin(a))));
  const ra = rot(0.7), rb = rot(2.3);
  const streak = max(
    mx_noise_float(vec3(ra.x.mul(48.0), ra.y.mul(6.0), 1.3)),
    mx_noise_float(vec3(rb.x.mul(41.0), rb.y.mul(5.0), 7.1)),
  ).mul(0.5).add(0.5);
  const detail = float(1).sub(smoothstep(6.0, 22.0, camD));
  const straw = smoothstep(0.62, 0.8, mx_noise_float(wp.xz.mul(3.1).add(2.2)).mul(0.5).add(0.5).add(dead.mul(0.3)));
  let turf: any = mix(color('#3d4426'), color('#68703f'), streak.mul(0.75).add(micro.mul(0.25)));
  turf = mix(turf, mix(color('#4f4531'), color('#8a7956'), streak), straw.mul(0.7));
  turf = mix(canopy, turf.mul(mix(float(0.9), float(1.05), vigour)), detail.mul(0.85));

  // Muddy path: trodden crust with lighter dry ridges, darker damp hollows, small stones and scraps of grass.
  const pathCore = float(1).sub(smoothstep(0.12, 0.6, pathD));
  const mudN = mx_fractal_noise_float(wp.xz.mul(4.5), 3, 2.0, 0.5);
  const mudFine = mx_noise_float(wp.xz.mul(26.0));
  // Small rounded stones pressed into the mud, gathered in gravelly stretches.
  const cell = mx_worley_noise_float(wp.xz.mul(16.0));
  const gravel = smoothstep(0.1, 0.5, mx_noise_float(wp.xz.mul(1.3).add(5.7)));
  const stoneR = mix(float(0.1), float(0.2), gravel);
  const dome = max(float(1).sub(cell.div(stoneR)), 0);
  const stone = smoothstep(0.0, 0.3, dome).mul(gravel.mul(0.8).add(0.2)).mul(pathCore);
  const hollow = smoothstep(0.05, -0.35, mx_fractal_noise_float(wp.xz.mul(0.9).add(3.1), 2, 2.0, 0.5)).mul(pathCore);
  let mud: any = mix(color('#3b3024'), color('#6b5940'), smoothstep(-0.15, 0.45, mudN.add(mudFine.mul(0.15))));
  mud = mix(mud, color('#2a221a'), hollow.mul(0.75));
  mud = mix(mud, color('#4f4a42').mul(mx_noise_float(wp.xz.mul(40.0)).mul(0.15).add(0.9)), stone.mul(0.85));
  // Trodden-in grass scraps.
  mud = mix(mud, color('#59593a'), smoothstep(0.55, 0.75, streak).mul(smoothstep(0.35, 0.12, pathD).oneMinus()).mul(0.6));
  const soil = mix(color('#3a3226'), color('#4a3f2f'), fine);
  const bare = mix(soil, mud, pathCore);

  // How much of this ground is grassed (the same density the blades use).
  const grassed = smoothstep(0.12, 0.55, pathD).mul(float(1).sub(excl)).mul(float(1).sub(pud.mul(0.92))).mul(mix(float(0.75), float(1), vigour));
  let c: any = mix(bare, turf, grassed);
  c = mix(c, soil, smoothstep(0.08, 0.3, slope).mul(0.5));
  const wetMix = smoothstep(0.2, 0.9, wet.add(fine.sub(0.5).mul(0.3)));
  c = c.mul(mix(float(1), float(0.7), wetMix.mul(float(1).sub(stone))));
  m.colorNode = c;

  // Relief: mud lumps and stones on the path; laid-over grass streaks elsewhere.
  const hPath = mudN.mul(0.01).add(mudFine.mul(0.0025)).add(dome.sqrt().mul(stone).mul(0.007)).sub(hollow.mul(0.006));
  const hTurf = streak.mul(0.0025).add(mx_noise_float(wp.xz.mul(14.0)).mul(0.002));
  m.normalNode = procBump(mix(hTurf, hPath, pathCore), float(0.012));
  // Damp mud has a soft sheen, hollows a little more; turf stays matt; stones are dry and rough.
  const rough = mix(float(0.92), float(0.62), wetMix.mul(0.9));
  m.roughnessNode = mix(rough, mix(float(0.78), float(0.42), max(wetMix.mul(0.6), hollow)), pathCore).add(stone.mul(0.12));
  m.metalnessNode = float(0);
  m.aoNode = characterAO(positionWorld, normalWorld);
  return m;
}

export function createTerrain(): { near: THREE.Mesh; far: THREE.Mesh } {
  const nearGeo = buildGrid(FIELD.nearHalf, 0.8, () => 0);
  const near = new THREE.Mesh(nearGeo, terrainMaterial(null));
  near.receiveShadow = true;
  near.name = 'Terrain_Playable';
  const farGeo = buildGrid(FIELD.farHalf, 20, (x, z) => (Math.abs(x) < FIELD.nearHalf - 6 && Math.abs(z) < FIELD.nearHalf - 6 ? 0.6 : 0));
  const farMat = terrainMaterial(null);
  const far = new THREE.Mesh(farGeo, farMat);
  far.name = 'Terrain_Distant';
  far.receiveShadow = false;
  void vec3;
  return { near, far };
}

// A faint body of water east of the moor, mostly lost in mist.
export function createDistantWater() {
  const g = new THREE.PlaneGeometry(900, 1100);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#5d6869'), roughness: 0.18, metalness: 0 });
  const w = new THREE.Mesh(g, m);
  w.position.set(560, -13.5, -60);
  w.name = 'DistantWater';
  return w;
}
