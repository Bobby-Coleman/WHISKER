// Node-based final image: HDR scene -> optional DoF -> bloom/halation -> filmic tone map -> grade
// -> restrained archival softness (chroma loss, fine noise, faint compression breakup). UI is HTML, composited after.
import * as THREE from 'three/webgpu';
import {
  pass, Fn, vec2, vec3, vec4, float, uv, mix, dot, clamp, smoothstep, fract, sin, floor, renderOutput, convertToTexture,
  max, length,
} from 'three/tsl';
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
const grade = Fn(([c]: any[]) => {
  const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  const sat = max(c.r, max(c.g, c.b)).sub(min3(c));
  const greenish = clamp(c.g.sub(max(c.r, c.b)).mul(6.0), 0, 1);
  const warm = clamp(c.r.sub(c.b).mul(4.0), 0, 1);
  let g = mix(vec3(l), c, float(0.8).add(warm.mul(0.12)));
  // Olive shift: lift red a touch and lower blue in green regions.
  g = g.add(vec3(0.018, -0.004, -0.02).mul(greenish));
  g = mix(g, g.mul(vec3(0.97, 1.0, 1.03)), smoothstep(0.55, 0.8, l)); // cool, pale highs
  g = g.mul(0.955).add(0.03); // gently lifted blacks
  void sat;
  return mix(c, g, LOOK.grade);
});
function min3(c: any) { return c.r.min(c.g).min(c.b); }

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { dof: boolean }) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();

  let hdr: any = sceneColor;
  if (opts.dof) {
    const blurred = dof(sceneColor, viewZ, LOOK.focusDistance, float(2.6), float(1.6));
    hdr = mix(sceneColor, blurred, LOOK.dofAmount);
  }
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
    const clean = tex.sample(st).rgb;
    // Luma: controlled resampling softness (small tent kernel).
    const r1 = px.mul(s.mul(0.9));
    const lumaSoft = clean.mul(0.4)
      .add(tex.sample(st.add(vec2(r1.x, 0))).rgb.mul(0.15)).add(tex.sample(st.sub(vec2(r1.x, 0))).rgb.mul(0.15))
      .add(tex.sample(st.add(vec2(0, r1.y))).rgb.mul(0.15)).add(tex.sample(st.sub(vec2(0, r1.y))).rgb.mul(0.15));
    // Chroma: wider blur so green/brown boundaries lose color detail while silhouettes stay legible.
    const r2 = px.mul(s.mul(2.6));
    let ch = toYCoCg(lumaSoft).yz.mul(0.28);
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x, r2.y.mul(0.5)))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.negate(), r2.y.mul(-0.5)))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.mul(-0.5), r2.y))).rgb).yz.mul(0.18));
    ch = ch.add(toYCoCg(tex.sample(st.add(vec2(r2.x.mul(0.5), r2.y.negate()))).rgb).yz.mul(0.18));
    // Very faint compression-like breakup: chroma pulled toward an 8x8 block sample.
    const block = floor(st.mul(LOOK.resolution).div(8)).add(0.5).mul(8).div(LOOK.resolution);
    const blockCh = toYCoCg(tex.sample(block).rgb).yz;
    ch = mix(ch, blockCh, s.mul(0.07));
    const y = toYCoCg(lumaSoft).x;
    // Fine sensor noise, luma only.
    const n = hash(st.mul(LOOK.resolution).add(LOOK.frame.mul(17.13)).floor()).sub(0.5).mul(0.022).mul(s);
    const lowLift = float(1).sub(smoothstep(0.0, 0.6, y)).mul(0.6).add(0.4);
    let outc = fromYCoCg(vec3(y.add(n.mul(lowLift)), ch.x.mul(float(1).sub(s.mul(0.06))), ch.y.mul(float(1).sub(s.mul(0.06)))));
    // Faint lens falloff.
    const v = smoothstep(0.95, 0.35, length(st.sub(0.5).mul(vec2(1.0, 0.9))));
    outc = outc.mul(mix(float(1), v.mul(0.12).add(0.88), s));
    return vec4(clamp(mix(clean, outc, clamp(s, 0, 1)), 0, 1), 1.0);
  });

  pipeline.outputNode = treated();
  return { pipeline, scenePass, bloomPass };
}
