// Node-based final image: HDR scene -> optional DoF -> bloom/halation -> filmic tone map -> grade
// -> restrained archival softness (chroma loss, fine noise, faint compression breakup). UI is HTML, composited after.
import * as THREE from 'three/webgpu';
import {
  pass, Fn, vec2, vec3, vec4, float, uv, mix, dot, clamp, smoothstep, fract, sin, floor, renderOutput, convertToTexture,
  max, min, length, rtt, reference, perspectiveDepthToViewZ,
} from 'three/tsl';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { LOOK } from './settings';

const hash = Fn(([p]: any[]) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453)));

const toYCoCg = Fn(([c]: any[]) => vec3(
  dot(c, vec3(0.25, 0.5, 0.25)),
  dot(c, vec3(0.5, 0.0, -0.5)),
  dot(c, vec3(-0.25, 0.5, -0.25)),
));
const fromYCoCg = Fn(([y]: any[]) => vec3(
  y.x.add(y.y).sub(y.z),
  y.x.add(y.z),
  y.x.sub(y.y).sub(y.z),
));

// Grade in display space: compressed highlights come from the filmic curve; here lift blacks,
// reduce saturation, pull greens toward olive and sage, keep sky cyan-gray, keep warm fur and pink.
// The modern look (LOOK.modern = 1) keeps the palette but lifts blacks less, keeps more colour and adds a
// gentle S-curve, so the image has depth instead of a washed-out archive feel.
const grade = Fn(([c]: any[]) => {
  const m = LOOK.modern;
  const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  const greenish = clamp(c.g.sub(max(c.r, c.b)).mul(6.0), 0, 1);
  const warm = clamp(c.r.sub(c.b).mul(4.0), 0, 1);
  let g = mix(vec3(l), c, mix(float(0.8), float(0.9), m).add(warm.mul(0.12)));
  // Olive shift: lift red a touch and lower blue in green regions.
  g = g.add(vec3(0.018, -0.004, -0.02).mul(greenish).mul(mix(float(1), float(0.6), m)));
  g = mix(g, g.mul(vec3(0.97, 1.0, 1.03)), smoothstep(0.55, 0.8, l)); // cool, pale highs
  g = mix(g, g.mul(g).mul(g.mul(-2).add(3)), m.mul(0.22)); // modern: gentle S-curve
  g = g.mul(mix(float(0.955), float(0.985), m)).add(mix(float(0.03), float(0.012), m)); // lifted blacks
  return mix(c, g, LOOK.grade);
});

// Ambient occlusion: three's GTAO at half resolution, smoothed by a two-pass depth-aware blur. Its three passes
// are skipped while LOOK.aoAmount is 0.
function createAO(scenePass: any, camera: THREE.Camera) {
  const depth: any = scenePass.getTextureNode('depth');
  // The scene pass is multisampled, and multisampled depth can be read only texel by texel, never gathered.
  // GTAO gathers the 2x2 depth footprint under each half-resolution pixel; give it four single reads instead.
  const aoDepth: any = depth.clone();
  aoDepth.updateTexture(); // a fresh pass texture node has no texture until set up; GTAO reads it before that
  const near = reference('near', 'float', camera), far = reference('far', 'float', camera);
  aoDepth.gather = () => ({
    sample: (st: any) => {
      const h = vec2(0.5).div(vec2(depth.size()));
      const d = vec4(
        depth.sample(st.sub(h)).r, depth.sample(st.add(vec2(h.x, h.y.negate()))).r,
        depth.sample(st.add(vec2(h.x.negate(), h.y))).r, depth.sample(st.add(h)).r,
      ).toVar();
      // A pixel that straddles a depth edge (a grass blade against the fog, a silhouette) gets no occlusion: the
      // normal GTAO derives from depth is meaningless there and would print dark specks along thin blades.
      // Depth 1 makes GTAO skip the pixel, which then keeps the cleared value, fully open.
      const zNear = perspectiveDepthToViewZ(min(min(d.x, d.y), min(d.z, d.w)), near, far).negate();
      const zFar = perspectiveDepthToViewZ(max(max(d.x, d.y), max(d.z, d.w)), near, far).negate();
      return zFar.sub(zNear).greaterThan(zNear.mul(0.05)).select(vec4(1), d);
    },
  });
  const node: any = gtao(aoDepth, null, camera);
  node.resolutionScale = 0.5;
  node.samples.value = 12;
  node.radius.value = 0.45; // metres: contact shade under paws and boots, corners of stone, folds of the cape
  node.thickness.value = 0.6; // thin things (grass blades) shade less than solid ones
  const raw = node.getTextureNode();
  const step = vec2(1).div(vec2(raw.size()));
  const opts = { resolutionScale: 0.5, format: THREE.RedFormat };
  const blurH: any = rtt(depthAwareBlur(raw, depth, vec2(step.x, 0), camera, 2, node.radius), null, null, opts);
  const blurV: any = rtt(depthAwareBlur(blurH, depth, vec2(0, step.y), camera, 2, node.radius), null, null, opts);
  for (const n of [node, blurH, blurV]) {
    const run = n.updateBefore.bind(n);
    n.updateBefore = (frame: any) => (LOOK.aoAmount.value > 0 ? run(frame) : undefined);
  }
  return blurV;
}

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { dof: boolean; aoView?: boolean }) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();

  let hdr: any = sceneColor;
  if (opts.dof) {
    const blurred: any = dof(sceneColor, viewZ, LOOK.focusDistance, float(2.6), float(1.6));
    // Its seven passes run only while the look asks for softness (the reveal, some presets). In play the mix weight
    // is 0, so the skipped, stale result is never seen.
    const runDof = blurred.updateBefore.bind(blurred);
    blurred.updateBefore = (frame: any) => (LOOK.dofAmount.value > 0.002 ? runDof(frame) : undefined);
    hdr = mix(sceneColor, blurred, LOOK.dofAmount);
  }
  // Occlusion darkens the lit image (in this overcast light nearly all of it is sky light). Values above 0.9 count
  // as open (GTAO shades tilted open surfaces slightly), and it fades out by 35 m, where single grass blades
  // would turn into dark specks and the fog takes over anyway.
  const occlusion = createAO(scenePass, camera);
  const aoWeight = LOOK.aoAmount.mul(float(1).sub(smoothstep(12, 35, viewZ.negate())));
  const aoTerm = mix(float(1), occlusion.r.div(0.9).min(1), aoWeight);
  hdr = hdr.mul(aoTerm);
  const bloomPass = bloom(hdr, 1.0, 0.5, 0.82);
  bloomPass.strength = LOOK.bloomStrength as any;
  // Halation: highlight glow pushed slightly warm.
  hdr = hdr.add(bloomPass.mul(vec4(1.0, 0.86, 0.78, 0)));

  const display = renderOutput(hdr, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
  const graded = vec4(grade(display.rgb), 1.0);
  const aa = fxaa(graded);
  const tex = convertToTexture(aa);

  const treated = Fn(() => {
    const st = uv();
    const px = vec2(1.0).div(LOOK.resolution);
    const s = LOOK.treatment;
    const m = LOOK.modern;
    const clean = tex.sample(st).rgb;
    // Luma: controlled resampling softness (small tent kernel). The modern look sharpens instead, undoing the
    // softness FXAA leaves, with the same four taps one pixel out.
    const r1 = px.mul(mix(s.mul(0.9), float(1), m));
    const ring = tex.sample(st.add(vec2(r1.x, 0))).rgb.add(tex.sample(st.sub(vec2(r1.x, 0))).rgb)
      .add(tex.sample(st.add(vec2(0, r1.y))).rgb).add(tex.sample(st.sub(vec2(0, r1.y))).rgb).mul(0.25);
    const lumaSoft = mix(clean.mul(0.4).add(ring.mul(0.6)), clean.add(clean.sub(ring).mul(0.5)), m);
    // Chroma: wider blur so green/brown boundaries lose color detail while silhouettes stay legible.
    const r2 = px.mul(s.mul(2.6).mul(mix(float(1), float(0.4), m)));
    let ch = toYCoCg(lumaSoft).yz.mul(0.28);
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x, r2.y.mul(0.5)))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.negate(), r2.y.mul(-0.5)))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.mul(-0.5), r2.y))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.mul(0.5), r2.y.negate()))).rgb).yz.mul(0.18));
    // Very faint compression-like breakup: chroma pulled toward an 8x8 block sample.
    const block = floor(st.mul(LOOK.resolution).div(8)).add(0.5).mul(8).div(LOOK.resolution);
    const blockCh = toYCoCg(tex.sample(block).rgb).yz;
    ch = mix(ch, blockCh, s.mul(0.07).mul(float(1).sub(m)));
    const y = toYCoCg(lumaSoft).x;
    // Fine sensor noise, luma only.
    const n = hash(st.mul(LOOK.resolution).add(LOOK.frame.mul(17.13)).floor()).sub(0.5).mul(0.022).mul(s).mul(mix(float(1), float(0.7), m));
    const lowLift = float(1).sub(smoothstep(0.0, 0.6, y)).mul(0.6).add(0.4);
    let outc = fromYCoCg(vec3(y.add(n.mul(lowLift)), ch.x.mul(float(1).sub(s.mul(0.06))), ch.y.mul(float(1).sub(s.mul(0.06)))));
    // Faint lens falloff.
    const v = smoothstep(0.95, 0.35, length(st.sub(0.5).mul(vec2(1.0, 0.9))));
    outc = outc.mul(mix(float(1), v.mul(0.12).add(0.88), s));
    return vec4(clamp(mix(clean, outc, clamp(s, 0, 1)), 0, 1), 1.0);
  });

  // Review aid (?aoview): show the occlusion buffer itself, faded as it is applied.
  pipeline.outputNode = opts.aoView ? vec4(vec3(aoTerm), 1) : treated();
  return { pipeline, scenePass, bloomPass };
}
