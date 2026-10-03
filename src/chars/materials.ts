// Character materials: weathered PBR plate, cloth, leather, fur (base + shells), eyes, soft tissue.
import * as THREE from 'three/webgpu';
import {
  Fn, positionLocal, positionGeometry, normalLocal, mx_noise_float, mx_fractal_noise_float, vec3, float, mix, smoothstep, abs, fract, sin, dot,
  uniform, attribute, color, floor, step, clamp, pow, length, max, bumpMap, vec2, uv, positionView,
  texture, normalize, refract, atan, cos, min, vec4, modelWorldMatrixInverse, cameraPosition, normalWorld,
} from 'three/tsl';
import { WIND, LOOK } from '../render/settings';
import { procBump } from '../render/bump';

export const CHAR_TOGGLES = {
  roughnessMaps: uniform(1.0),
  detailNormals: uniform(1.0),
  fuzz: uniform(1.0),
  // World-space size of one pixel per metre of view distance; set each frame from the camera.
  pixelAngle: uniform(0.001),
};

const hash3 = Fn(([p]: any[]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453)));

const armorCache = new Map<string, THREE.Material>();

// Weathered plate: metal 1.0 with regional roughness 0.25-0.6; scratches affect roughness/normal more than color;
// mud is non-metallic and concentrated by the per-part `mud` amount (lower greaves and sabatons get the most).
// masks: the mesh carries baked per-vertex masks in its colour attribute (R ambient occlusion, G convex edges,
// B cavities), as the Blender hero armour does: edges read polished, cavities collect grime.
export function armorMaterial(opts: { mud?: number; wear?: number; tint?: string; scale?: number; emblem?: boolean; side?: THREE.Side; masks?: boolean } = {}) {
  const key = JSON.stringify(opts);
  if (armorCache.has(key)) return armorCache.get(key)!;
  // Amounts, scale and tint are uniforms rather than constants, so plates that differ only in those share a shader.
  const mud = uniform(opts.mud ?? 0.1), wear = uniform(opts.wear ?? 0.5), sc = uniform(opts.scale ?? 1);
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal.mul(sc);
  const broad = mx_fractal_noise_float(p.mul(13.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const mid = mx_noise_float(p.mul(28.0)).mul(0.5).add(0.5);
  // Thin directional scratches.
  const sA = abs(mx_noise_float(p.mul(vec3(14, 14, 14)).add(vec3(p.y.mul(160), 0, p.x.mul(120)))));
  const scratch = smoothstep(0.035, 0.0, sA).mul(step(0.55, mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5)));
  const grime = smoothstep(0.45, 0.9, mx_fractal_noise_float(p.mul(19.0).add(3.1), 3, 2.0, 0.6).mul(0.5).add(0.5));
  const mudN = mx_fractal_noise_float(p.mul(17.0).add(9.0), 4, 2.0, 0.55).mul(0.5).add(0.5);
  const mudMask = smoothstep(float(1.0).sub(mud), float(1.0).sub(mud).add(0.18), mudN.add(normalLocal.y.mul(-0.08)));
  const silver = uniform(new THREE.Color(opts.tint ?? '#b8b7b0'));
  let base = silver.mul(mix(float(1.0), float(0.8), grime.mul(0.5))).mul(mid.mul(0.05).add(0.96));
  base = mix(base, color('#4a3f31'), mudMask);
  // Optional painted cross on the breastplate: worn, chipped, non-metallic paint.
  let paint: any = float(0);
  if (opts.emblem) {
    // Small dark cross pattee at the upper chest, worn and chipped.
    const lp = positionLocal;
    const cy = lp.y.sub(0.3);
    const vbar = step(abs(lp.x), float(0.006).add(abs(cy).div(0.036).pow(2).mul(0.011))).mul(step(abs(cy), 0.036));
    const hbar = step(abs(cy), float(0.006).add(abs(lp.x).div(0.034).pow(2).mul(0.011))).mul(step(abs(lp.x), 0.034));
    const chips = step(mx_noise_float(lp.mul(140.0)).mul(0.5).add(0.5), 0.78);
    paint = clamp(vbar.add(hbar), 0, 1).mul(step(0.04, lp.z)).mul(chips).mul(float(1).sub(mudMask));
    base = mix(base, color('#1e1d1b').mul(mid.mul(0.2).add(0.85)), paint);
  }
  if (opts.side !== undefined) m.side = opts.side;
  let edge: any = float(0), cav: any = float(0);
  if (opts.masks) {
    const mk = attribute('color', 'vec4');
    edge = mk.g; cav = mk.b;
    m.aoNode = mix(float(1), mk.r, 0.85);
    // Dark grime settles in creases and under overlapping lames; worn edges are a touch brighter.
    base = base.mul(float(1).sub(cav.mul(0.35).mul(wear.add(0.4)))).mul(edge.mul(0.07).add(1));
  }
  m.colorNode = base;
  m.metalnessNode = mix(float(1.0), float(0.0), clamp(mudMask.add(paint), 0, 1));
  // Dirty silver rather than chrome: broad overcast reflections with regional breakup (about 0.22-0.45).
  const rough = float(0.22).add(broad.mul(0.12)).add(grime.mul(0.12).mul(wear)).add(scratch.mul(0.1)).add(mid.mul(0.04))
    .sub(edge.mul(0.06)).add(cav.mul(0.16).mul(wear.add(0.3)));
  m.roughnessNode = mix(mix(mix(float(0.4), rough, CHAR_TOGGLES.roughnessMaps), float(0.92), mudMask), float(0.68), paint);
  // Subtle hammered dents and scratch grooves in the normal.
  // Real scale: dents about 0.15 mm deep over ~2.5 cm, scratches a few hundredths of a millimetre.
  const bumpH = mx_noise_float(p.mul(42.0)).mul(0.00015).sub(scratch.mul(0.00004)).mul(CHAR_TOGGLES.detailNormals);
  m.normalNode = procBump(bumpH.div(sc), float(0.006).div(sc));
  armorCache.set(key, m);
  return m;
}

// Aged brass for guards, buckles and pommels: warm metal, tarnish in the hollows, rubbed bright on edges.
export function brassMaterial(masks = false) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal;
  const n = mx_fractal_noise_float(p.mul(60.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  let base: any = color('#a9864f').mul(n.mul(0.18).add(0.86));
  let rough: any = float(0.3).add(n.mul(0.14));
  if (masks) {
    const mk = attribute('color', 'vec4');
    m.aoNode = mix(float(1), mk.r, 0.85);
    base = mix(base, color('#4a3b26'), mk.b.mul(0.6)).mul(mk.g.mul(0.12).add(1));
    rough = rough.add(mk.b.mul(0.2)).sub(mk.g.mul(0.08));
  }
  m.colorNode = base;
  m.roughnessNode = rough;
  m.metalness = 1;
  return m;
}

// quilt: spacing (m) of stitched channels running along the part's local Y axis, as on a gambeson body, skirt
// and sleeves; the padding puffs up between the seams.
export function clothMaterial(hex: string, opts: { sheen?: string; rough?: number; weave?: number; wet?: number; quilt?: number } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const p = positionLocal;
  const n = mx_fractal_noise_float(p.mul(30.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  // Colour and amounts are uniforms, so cloths that differ only in those share a shader.
  const weave = sin(p.x.mul(2400)).mul(sin(p.y.mul(2400))).mul(0.5).add(0.5).mul(uniform(opts.weave ?? 0.0));
  let puff: any = float(1);
  if (opts.quilt) {
    const arc = atan(p.x, p.z).mul(length(p.xz)).div(opts.quilt);
    // Channels wander slightly, as hand stitching does.
    const u = arc.add(mx_noise_float(p.mul(6.0)).mul(0.08));
    puff = pow(abs(sin(u.mul(Math.PI))), 0.45);
    m.normalNode = procBump(puff.mul(CHAR_TOGGLES.detailNormals).mul(0.002), float(opts.quilt * 0.5));
  }
  m.colorNode = uniform(new THREE.Color(hex)).mul(n.mul(0.16).add(0.88)).mul(float(1).sub(weave.mul(0.06))).mul(puff.mul(0.18).add(0.82));
  m.roughnessNode = uniform(opts.rough ?? 0.88).sub(uniform(opts.wet ?? 0).mul(n).mul(0.2));
  m.metalness = 0;
  m.sheen = 0.6;
  m.sheenRoughness = 0.7;
  m.sheenColor = new THREE.Color(opts.sheen ?? hex).multiplyScalar(0.6);
  return m;
}

// The kitten's cape: soft off-white linen in uv space (the simulated mesh lives in world space), a turned hem on the
// sides and bottom, a little field grime toward the hem, and thin-sheet translucency: part of the light reaching the
// far face comes through, so shaded folds stay soft instead of going grey like paper.
export function capeMaterial(hex: string) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const st = uv();
  const n = mx_fractal_noise_float(vec3(st.x.mul(5.0), st.y.mul(8.0), 0.5), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const slub = mx_noise_float(vec3(st.x.mul(3.0), st.y.mul(140.0), 1.7)).mul(0.5).add(0.5);
  const hemB = smoothstep(0.045, 0.028, st.y);
  const hemS = smoothstep(0.05, 0.032, min(st.x, float(1).sub(st.x))).mul(smoothstep(0.9, 0.7, st.y));
  const hem = max(hemB, hemS);
  const grime = smoothstep(0.35, 0.0, st.y).mul(n.mul(0.6).add(0.4));
  const base = mix(color(hex), color('#b9ae98'), grime.mul(0.32)).mul(n.mul(0.08).add(0.93)).mul(slub.mul(0.04).add(0.98)).mul(float(1).sub(hem.mul(0.05)));
  m.colorNode = base;
  // The fold of the turned hem and its stitch line read in the normal.
  const stitch = smoothstep(0.004, 0.0, abs(st.y.sub(0.038))).add(smoothstep(0.004, 0.0, abs(min(st.x, float(1).sub(st.x)).sub(0.042))).mul(smoothstep(0.9, 0.7, st.y)));
  m.normalNode = procBump(hem.mul(0.6).sub(stitch.mul(0.25)).add(slub.mul(0.08)).mul(CHAR_TOGGLES.detailNormals).mul(0.0012), float(0.004));
  m.roughness = 0.86;
  m.metalness = 0;
  m.sheen = 0.7;
  m.sheenRoughness = 0.55;
  m.sheenColor = new THREE.Color('#fbf8f2').multiplyScalar(0.55);
  // Light from the far side: sky and ground seen through the sheet, plus the hidden sun behind cloud.
  const back = normalWorld.negate();
  const skyLight = mix(color('#4a4c3c').mul(1.1), LOOK.skyZenith.mul(1.05), back.y.mul(0.5).add(0.5));
  const sunDir = normalize(vec3(-0.45, 0.55, -0.7));
  const sun = max(dot(back, sunDir), 0).mul(0.55);
  m.emissiveNode = base.mul(skyLight.add(sun)).mul(0.22);
  return m;
}

// Leather with optional mud: `mud` is the coverage, concentrated below `mudTop` (part-local y) and solid below `mudFull`.
export function leatherMaterial(hex = '#3b2b1f', opts: { mud?: number; mudTop?: number; mudFull?: number; scuff?: number } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal;
  // Colour and amounts are uniforms, so leathers that differ only in those share a shader.
  const n = mx_fractal_noise_float(p.mul(60.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const crease = smoothstep(0.06, 0.0, abs(mx_noise_float(p.mul(vec3(30, 90, 30))))).mul(uniform(opts.scuff ?? 0.4));
  let base: any = uniform(new THREE.Color(hex)).mul(n.mul(0.25).add(0.82)).mul(float(1).sub(crease.mul(0.35)));
  let rough: any = float(0.5).add(n.mul(0.22)).add(crease.mul(0.15));
  if (opts.mud) {
    const mn = mx_fractal_noise_float(p.mul(22.0).add(5.0), 4, 2.0, 0.55).mul(0.5).add(0.5);
    const h = smoothstep(uniform(opts.mudTop ?? 0), uniform(opts.mudFull ?? -0.1), p.y);
    const mask = smoothstep(0.62, 0.7, mn.mul(0.55).add(h.mul(uniform(opts.mud))));
    base = mix(base, color('#4b3f30').mul(mn.mul(0.3).add(0.78)), mask);
    rough = mix(rough, float(0.95), mask);
  }
  m.colorNode = base;
  m.roughnessNode = rough;
  m.metalness = 0;
  m.sheen = 0.25; m.sheenRoughness = 0.4; m.sheenColor = new THREE.Color('#6b5a48');
  return m;
}

// Kitten coat: vertex color carries markings (dusty tan, cream muzzle), plus fine directional fur breakup.
export function furBaseMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true });
  const p = positionLocal;
  const fine = mx_noise_float(p.mul(vec3(900, 250, 900))).mul(0.5).add(0.5);
  m.colorNode = attribute('color', 'vec3').mul(fine.mul(0.16).add(0.88));
  const tissue = attribute('tissue', 'float');
  m.roughnessNode = mix(float(0.78), float(0.38), tissue);
  m.metalness = 0;
  m.sheen = 0.5;
  m.sheenRoughness = 0.55;
  m.sheenColor = new THREE.Color('#d8c3a0').multiplyScalar(0.5);
  return m;
}

// Shell-fur layer: offsets along the normal plus a groom direction that bends strands as they lengthen.
// Strands are the nearest of eight jittered lattice points (no contour rings on curved skin), clumped by a
// low-frequency noise, thinner toward the tips, and fade to their average coverage once a strand is smaller
// than a pixel so distant fur stays soft instead of shimmering.
const strandField = (pg: any) => {
  const base = floor(pg.sub(0.5));
  let best: any = float(9.0), bestH: any = float(0.5);
  for (let i = 0; i < 8; i++) {
    const cell = base.add(vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1));
    const jit = vec3(hash3(cell), hash3(cell.add(17.0)), hash3(cell.add(41.0)));
    const d = length(pg.sub(cell.add(0.5).add(jit.sub(0.5).mul(0.9))));
    const closer = step(d, best);
    best = mix(best, d, closer);
    bestH = mix(bestH, hash3(cell.add(73.0)), closer);
  }
  return { d: best, h: bestH };
};

export function furShellMaterial(layer: number, layers: number, furLength = 0.004, density = 1300, groom: [number, number, number] = [0, -0.45, -0.55]) {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  // The layer's height through the coat is a uniform, not a constant, so all the layers share one compiled shader.
  const t = uniform(layer / layers);
  const furLen = attribute('furLen', 'float');
  const g = vec3(groom[0], groom[1], groom[2]).mul(t.mul(t).mul(0.85));
  const windDir = vec3(WIND.dir.x, 0, WIND.dir.y).mul(t.mul(t).mul(0.25)).mul(WIND.strength);
  m.positionNode = positionLocal.add(normalLocal.mul(t).add(g).add(windDir).mul(furLen.mul(furLength)).mul(CHAR_TOGGLES.fuzz));
  const pg = positionGeometry.mul(density);
  const { d, h } = strandField(pg);
  const clump = mx_noise_float(pg.mul(0.21)).mul(0.5).add(0.5);
  const strandH = h.mul(0.5).add(0.42).mul(clump.mul(0.4).add(0.78));
  const rad = float(1).sub(t.mul(0.7)).mul(0.5).add(0.08);
  const strand = smoothstep(rad.add(0.14), rad.sub(0.1), d).mul(smoothstep(t.sub(0.04), t.add(0.06), strandH));
  const avg = min(rad.mul(rad).mul(3.0), 1).mul(smoothstep(t.add(0.12), t.sub(0.12), strandH));
  // Strands narrower than about a pixel fade to their average coverage (by distance, not view angle,
  // so grazing silhouettes keep their strands instead of turning into a translucent bubble).
  const cellsPerPx = positionView.z.negate().mul(CHAR_TOGGLES.pixelAngle).mul(density);
  const lod = smoothstep(0.7, 1.5, cellsPerPx);
  const keep = mix(strand, avg, lod).mul(step(0.05, furLen)).mul(float(1).sub(t.mul(0.3)));
  m.opacityNode = keep.mul(step(0.5, CHAR_TOGGLES.fuzz.add(0.49)));
  // Blended rather than alpha-tested: a soft, fluffy edge instead of a speckled one. Drawn inner to outer.
  m.transparent = true;
  m.depthWrite = false;
  m.alphaTest = 0.01;
  const ao = t.mul(0.38).add(0.62);
  m.colorNode = attribute('color', 'vec3').mul(ao).mul(h.mul(0.16).add(0.92)).mul(t.mul(0.12).add(1));
  m.roughness = 0.85;
  m.metalness = 0;
  void uv; void vec2; void clamp; void pow; void max;
  return m;
}

// Undercoat shells for the Blender head: per-vertex length and combing direction from the groom, colour from the
// baked albedo so markings carry through, strands thinning toward the tips. Long guard hair is drawn as strands.
// albedo: the skin's colour map, or null to take the colour from the mesh's vertex colours.
export function heroShellMaterial(layer: number, layers: number, density: number, albedo: THREE.Texture | null) {
  const m = new THREE.MeshStandardNodeMaterial();
  // A uniform, as in furShellMaterial, so all the layers share one compiled shader.
  const t = uniform(layer / layers);
  const furLen = attribute('furLen', 'float');
  const furDir = attribute('furDir', 'vec3');
  // Undercoat leaves the skin at a steep angle and lies down along the comb as it lengthens.
  const off = normalLocal.mul(t.mul(0.75)).add(furDir.mul(t.mul(t.mul(0.5).add(0.35))));
  const windDir = vec3(WIND.dir.x, 0, WIND.dir.y).mul(t.mul(t).mul(0.15)).mul(WIND.strength);
  m.positionNode = positionLocal.add(off.add(windDir).mul(furLen).mul(CHAR_TOGGLES.fuzz));
  const pg = positionGeometry.mul(density);
  const { d, h } = strandField(pg);
  const clump = mx_noise_float(pg.mul(0.18)).mul(0.5).add(0.5);
  const strandH = h.mul(0.45).add(0.5).mul(clump.mul(0.35).add(0.8));
  const rad = float(1).sub(t.mul(0.75)).mul(0.45).add(0.1);
  const strand = smoothstep(rad.add(0.14), rad.sub(0.1), d).mul(smoothstep(t.sub(0.04), t.add(0.06), strandH));
  const avg = min(rad.mul(rad).mul(3.0), 1).mul(smoothstep(t.add(0.12), t.sub(0.12), strandH));
  const cellsPerPx = positionView.z.negate().mul(CHAR_TOGGLES.pixelAngle).mul(density);
  const lod = smoothstep(0.7, 1.5, cellsPerPx);
  const keep = mix(strand, avg, lod).mul(smoothstep(0.0003, 0.0008, furLen)).mul(float(1).sub(t.mul(0.25)));
  m.opacityNode = keep.mul(step(0.5, CHAR_TOGGLES.fuzz.add(0.49)));
  m.transparent = true;
  m.depthWrite = false;
  m.alphaTest = 0.01;
  const base = albedo ? texture(albedo, uv()).rgb : attribute('color', 'vec3');
  m.colorNode = base.mul(t.mul(0.45).add(0.55)).mul(h.mul(0.18).add(0.91)).mul(t.mul(0.1).add(1));
  m.roughness = 0.8;
  m.metalness = 0;
  return m;
}

// Kitten eye with depth: the iris sits on a plane inside a clear cornea, looked up through a refracted view ray so it
// shifts with parallax, under a glossy wet clear coat that mirrors the sky. Local +Z is the eye's forward axis.
export function heroEyeMaterial(radius: number) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal;
  const n = normalize(p);
  const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const view = normalize(camL.sub(p));
  const r = refract(view.negate(), n, 1 / 1.336);
  const zI = radius * 0.42;
  const tHit = float(zI).sub(p.z).div(min(r.z, -0.08));
  const hit = p.add(r.mul(max(tHit, 0)));
  const q = hit.xy.div(radius * 0.84);
  const rho = length(q);
  const ang = atan(q.y, q.x);
  // Big, round kitten pupil; a dark brown-grey iris with radial fibres and a soft darker limbal ring.
  const fib = mx_noise_float(vec3(ang.mul(9.0), rho.mul(3.0), 0.0)).mul(0.5).add(0.5);
  const fib2 = mx_noise_float(vec3(cos(ang).mul(14.0), rho.mul(12.0), ang.mul(2.0))).mul(0.5).add(0.5);
  const irisCol = mix(color('#33281f'), color('#8a7056'), fib.mul(0.6).add(fib2.mul(0.4)).mul(smoothstep(0.55, 0.9, rho).mul(0.6).add(0.4)));
  const pupil = smoothstep(0.5, 0.54, rho);
  const limbus = smoothstep(0.86, 1.0, rho);
  let c: any = mix(color('#030303'), irisCol, pupil);
  c = mix(c, color('#120d0b'), limbus);
  // Behind the limbus (rarely visible) the sclera is dark in a kitten.
  c = mix(c, color('#2b231f'), smoothstep(1.02, 1.1, rho));
  m.colorNode = c;
  m.roughness = 0.45;
  m.metalness = 0;
  m.clearcoat = 1;
  m.clearcoatRoughness = 0.045;
  m.ior = 1.336;
  m.specularIntensity = 0.6;
  return m;
}

export function eyeMaterial() {
  // Kitten eyes in the reference read as near-black with a strong catchlight.
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal;
  // Local +Z is the eye's forward axis: large dilated pupil, a dark blue-gray iris ring, a darker limbal rim.
  const r = length(p.xy).div(max(length(p), 0.0001));
  const iris = mix(color('#040405'), color('#24282a'), smoothstep(0.45, 0.6, r));
  const fleck = mx_noise_float(p.mul(2400)).mul(0.5).add(0.5).mul(0.25).add(0.85);
  const rimDark = smoothstep(0.72, 0.86, r);
  m.colorNode = mix(iris.mul(fleck), color('#0d0c0b'), rimDark).mul(step(0.0, p.z).mul(0.6).add(0.4));
  m.roughness = 0.05;
  m.metalness = 0;
  m.ior = 1.376;
  m.specularIntensity = 0.9;
  return m;
}

export function softTissueMaterial(hex: string) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const n = mx_noise_float(positionLocal.mul(500)).mul(0.5).add(0.5);
  m.colorNode = color(hex).mul(n.mul(0.15).add(0.9));
  m.roughness = 0.42;
  m.metalness = 0;
  m.sheen = 0.2;
  return m;
}

export function plainMaterial(hex: string, rough = 0.8, metal = 0) {
  return new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
}
