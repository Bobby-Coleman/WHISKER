// Helpers for temporal anti-aliasing.
import { Fn, fract, screenCoordinate, vec2, float } from 'three/tsl';
import { LOOK } from './settings';

// Interleaved gradient noise (Jimenez 2014) shifted every frame: a per-pixel threshold for stochastic coverage.
// Strands and other thin cut-outs keep a pixel when their coverage beats it, and the TAA history averages the
// frames back into smooth partial coverage.
export const temporalAlphaThreshold = Fn(() => {
  const p = screenCoordinate.xy.add(vec2(LOOK.frame.mod(32).mul(5.588238)));
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189)).clamp(float(0.02), float(0.98));
})();
