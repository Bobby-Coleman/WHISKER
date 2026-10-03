// Bump mapping for procedural heights. three's bumpMap() re-samples its input at offset texture coordinates, so
// a height computed from positions (noise, mortar lines, quilting) gives it no gradient at all; this takes the
// screen-space derivatives of the height itself (Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU").
// `height` is in metres, so the tilt equals the real slope of the relief. Detail finer than a few pixels fades out
// so it cannot sparkle: `feature` is the size of the smallest relief that matters (metres).
import { Fn, positionView, normalView, positionWorld, faceDirection, max, min, length, smoothstep, float, select } from 'three/tsl';

export const procBump = Fn(([height, feature]: any[]) => {
  const footprint = max(length(positionWorld.dFdx()), length(positionWorld.dFdy()));
  const h = height.mul(float(1).sub(smoothstep(feature.mul(0.12), feature.mul(0.45), footprint)));
  const dpdx = positionView.dFdx(), dpdy = positionView.dFdy();
  const n = normalView;
  const r1 = dpdy.cross(n), r2 = n.cross(dpdx);
  const det = dpdx.dot(r1).mul(faceDirection);
  const ad = det.abs();
  const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
  // Limit the tilt to a slope of 1.5 so a sharp step cannot flip the normal, and keep the mesh normal where the
  // surface is seen exactly edge-on (no footprint to differentiate over).
  const gl = length(grad);
  const g = grad.mul(min(float(1), ad.mul(1.5).div(max(gl, 1e-30))));
  return select(ad.greaterThan(1e-30), ad.mul(n).sub(g).normalize(), n);
});
