// Photo-scanned surfaces (Poly Haven, CC0), packed two textures per material by tools/build_assets.mjs:
//   a: albedo RGB (sRGB) + height A        b: normal X, normal Y (OpenGL), roughness, ambient occlusion
// World-projected rather than UV-mapped, so walls, rocks and terrain built in code need no unwrapping. Triplanar
// projection follows Ben Golus's whiteout blend with mirrored-U correction; the ground uses a single top-down
// projection read at two scales and rotations, mixed by a broad noise, so its tiles never line up.
import * as THREE from 'three/webgpu';
import {
  Fn, texture, vec2, vec3, vec4, float, mix, abs, pow, normalize, max, sign, select, positionWorld, normalWorld, cameraViewMatrix,
  dot, clamp, smoothstep, positionLocal, step,
} from 'three/tsl';
import { countDownload } from '../chars/binfile';

export type Surface = { id: string; a: THREE.Texture; b: THREE.Texture };

const sets = new Map<string, Surface>();
const pending: Promise<void>[] = [];
let anisotropy = 8;
export function setSurfaceAnisotropy(n: number) { anisotropy = n; }

function loadTex(url: string, srgb: boolean) {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = anisotropy;
  t.name = url;
  const loader = new THREE.ImageBitmapLoader();
  // Raw channels: the alpha holds height or occlusion, so nothing may premultiply or colour-convert it.
  loader.setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  pending.push(new Promise<void>((resolve, reject) => {
    loader.load(url, (bmp: ImageBitmap) => { t.image = bmp; t.needsUpdate = true; countDownload(0); resolve(); }, undefined, () => reject(new Error('Could not load ' + url)));
  }));
  return t;
}

export function surface(id: string): Surface {
  let s = sets.get(id);
  if (!s) {
    s = { id, a: loadTex(`./tex/${id}_a.webp`, true), b: loadTex(`./tex/${id}_b.webp`, false) };
    sets.set(id, s);
  }
  return s;
}

export function preloadSurfaces(ids: string[]) {
  for (const id of ids) surface(id);
  return Promise.all(pending);
}

export type SurfaceSample = { albedo: any; height: any; rough: any; ao: any; nWorld: any };

// Tangent-space normal from the packed texture. Images load with v increasing downward, so +Y (image up) is -v.
const tangentNormal = (b: any) => {
  const xy = b.xy.mul(2).sub(1).mul(vec2(1, -1));
  return vec3(xy, max(float(0), float(1).sub(dot(xy, xy))).sqrt());
};

// Triplanar sample at `scale` (metres per tile) around world position `p` with surface normal `n` (world).
export function triplanar(s: Surface, p: any, n: any, scale: number | any, sharpness = 4): SurfaceSample {
  const k = typeof scale === 'number' ? float(1 / scale) : float(1).div(scale);
  const w0 = pow(abs(n), vec3(sharpness));
  const w = w0.div(w0.x.add(w0.y).add(w0.z).add(1e-5));
  const sg = select(n.greaterThanEqual(vec3(0)), vec3(1), vec3(-1));
  // Mirror U on the back-facing projections so the image is never seen reversed.
  const uvX = vec2(p.z.mul(sg.x), p.y).mul(k);
  const uvY = vec2(p.x.mul(sg.y), p.z).mul(k);
  const uvZ = vec2(p.x.mul(sg.z.negate()), p.y).mul(k);
  const ax = texture(s.a, uvX), ay = texture(s.a, uvY), az = texture(s.a, uvZ);
  const bx = texture(s.b, uvX), by = texture(s.b, uvY), bz = texture(s.b, uvZ);
  const albedo = ax.rgb.mul(w.x).add(ay.rgb.mul(w.y)).add(az.rgb.mul(w.z));
  const height = ax.a.mul(w.x).add(ay.a.mul(w.y)).add(az.a.mul(w.z));
  const rough = bx.z.mul(w.x).add(by.z.mul(w.y)).add(bz.z.mul(w.z));
  const ao = bx.w.mul(w.x).add(by.w.mul(w.y)).add(bz.w.mul(w.z));
  // Whiteout blend per projection, then swizzled into world space.
  let tx: any = tangentNormal(bx), ty: any = tangentNormal(by), tz: any = tangentNormal(bz);
  tx = vec3(tx.x.mul(sg.x), tx.y, tx.z); ty = vec3(ty.x.mul(sg.y), ty.y, ty.z); tz = vec3(tz.x.mul(sg.z.negate()), tz.y, tz.z);
  tx = vec3(tx.xy.add(n.zy), abs(tx.z).mul(n.x));
  ty = vec3(ty.xy.add(n.xz), abs(ty.z).mul(n.y));
  tz = vec3(tz.xy.add(n.xy), abs(tz.z).mul(n.z));
  const nWorld = normalize(tx.zyx.mul(w.x).add(ty.xzy.mul(w.y)).add(tz.xyz.mul(w.z)));
  return { albedo, height, rough, ao, nWorld };
}

// Top-down projection for ground: two reads at different scales and rotations, mixed by `mixer` (0..1) so the
// repeat is broken up. Returns the same fields as triplanar, with the normal already combined with `n`.
export function groundSample(s: Surface, p: any, n: any, scale: number, mixer: any): SurfaceSample {
  const k = 1 / scale;
  const c = Math.cos(0.83), sn = Math.sin(0.83);
  const uv1 = vec2(p.x, p.z).mul(k);
  const uv2 = vec2(p.x.mul(c).sub(p.z.mul(sn)), p.x.mul(sn).add(p.z.mul(c))).mul(k * 0.73).add(vec2(0.37, 0.71));
  const a1 = texture(s.a, uv1), a2 = texture(s.a, uv2), b1 = texture(s.b, uv1), b2 = texture(s.b, uv2);
  // Height-aware mix: the higher of the two reads wins near the blend, so the seam follows the texture's own shapes.
  const hb = clamp(mixer.add(a2.a.sub(a1.a).mul(0.6)), 0, 1);
  const m = smoothstep(0.35, 0.65, hb);
  const albedo = mix(a1.rgb, a2.rgb, m);
  const height = mix(a1.a, a2.a, m);
  const rough = mix(b1.z, b2.z, m);
  const ao = mix(b1.w, b2.w, m);
  // Second read is rotated: rotate its tangent normal back into the first read's frame before mixing.
  const t1 = tangentNormal(b1), t2r = tangentNormal(b2);
  const t2 = vec3(t2r.x.mul(c).add(t2r.y.mul(sn)), t2r.y.mul(c).sub(t2r.x.mul(sn)), t2r.z);
  const t = normalize(mix(t1, t2, m));
  // Top projection (u = +X, v = +Z), whiteout-blended onto the surface normal.
  const ty = vec3(t.xy.add(n.xz), abs(t.z).mul(n.y));
  const nWorld = normalize(ty.xzy);
  return { albedo, height, rough, ao, nWorld };
}

export const toViewNormal = (nWorld: any) => cameraViewMatrix.mul(vec4(nWorld, 0)).xyz;

// Parallax occlusion for top-down ground: marches the view ray down through the surface's height map (alpha of
// the `a` texture, 1 = top) and returns the world-space xz shift to where it first meets the relief, so ruts, lumps
// and stones in the scan gain real depth at kitten height. Steps are unrolled (no dynamic loop) and read with
// explicit gradients so the march may sit behind a branch; a secant step refines the crossing (Tatarchuk 2006:
// a few linear steps plus refinement look like a long search). `depth` is the relief depth in metres; `fade`
// (0..1) scales it, so far ground pays nothing.
export function parallaxShift(s: Surface, p: any, viewDir: any, scale: number, depth: number, fade: any, steps = 8) {
  const k = 1 / scale;
  const uv0 = vec2(p.x, p.z).mul(k);
  const gx = uv0.dFdx(), gy = uv0.dFdy();
  // World xz travelled per unit of depth along the view ray (rays near grazing are clamped).
  const along = viewDir.xz.negate().div(max(viewDir.y, 0.25)).mul(depth).mul(fade);
  let prevD: any = float(0), prevH: any = float(1);
  let hitD: any = float(1), found: any = float(0);
  let hitPrevD: any = float(0), hitPrevH: any = float(1), hitH: any = float(0);
  for (let i = 1; i <= steps; i++) {
    const d = float(i / steps);
    const h = texture(s.a, uv0.add(along.mul(d).mul(k))).grad(gx, gy).a;
    // First layer whose depth passes below the relief (depth >= 1 - height).
    const below = step(float(1).sub(h), d).mul(float(1).sub(found));
    hitD = mix(hitD, d, below); hitH = mix(hitH, h, below);
    hitPrevD = mix(hitPrevD, prevD, below); hitPrevH = mix(hitPrevH, prevH, below);
    found = max(found, below);
    prevD = d; prevH = h;
  }
  // Secant refinement between the last layer above and the first below.
  const a0 = float(1).sub(hitPrevH).sub(hitPrevD), a1 = float(1).sub(hitH).sub(hitD);
  const tRef = clamp(a0.div(a0.sub(a1).add(1e-5)), 0, 1);
  const dHit = mix(hitPrevD, hitD, tRef);
  return along.mul(dHit);
}

// Photographed stone, rock or timber on code-built geometry. Moss gathers on top faces, damp darkens the foot.
export function photoMaterial(id: string, opts: {
  scale: number; tint?: [number, number, number]; desat?: number; mossy?: number; damp?: number; roughAdd?: number; groundY?: any; dampLocal?: boolean;
  aoStrength?: number; extra?: (s: SurfaceSample, m: THREE.MeshStandardNodeMaterial) => void;
} = { scale: 2 }) {
  const s = surface(id);
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld, n = normalWorld;
  const smp = triplanar(s, p, n, opts.scale);
  let c: any = smp.albedo;
  if (opts.desat) c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), opts.desat);
  if (opts.tint) c = c.mul(vec3(...opts.tint));
  let rough: any = smp.rough.add(opts.roughAdd ?? 0);
  if (opts.damp) {
    // Damp stone near the soil: darker and a little smoother.
    const above = opts.dampLocal ? positionLocal.y : opts.groundY !== undefined ? p.y.sub(opts.groundY) : float(10);
    const damp = smoothstep(0.9, 0.0, above).mul(opts.damp);
    c = c.mul(mix(float(1), float(0.62), damp));
    rough = rough.sub(damp.mul(0.18));
  }
  if (opts.mossy) {
    // Moss on surfaces that face the sky, gathering in the low parts of the relief.
    const up = smoothstep(0.35, 0.85, n.y);
    const moss = up.mul(smoothstep(0.25, 0.75, float(1).sub(smp.height).add(0.15))).mul(opts.mossy);
    c = mix(c, vec3(0.045, 0.06, 0.02), moss.mul(0.85));
    rough = mix(rough, float(0.95), moss);
  }
  m.colorNode = c;
  m.roughnessNode = clamp(rough, 0.05, 1);
  m.metalnessNode = float(0);
  m.normalNode = toViewNormal(smp.nWorld);
  m.aoNode = mix(float(1), smp.ao, opts.aoStrength ?? 0.8);
  opts.extra?.(smp, m);
  return m;
}
void Fn; void sign;
