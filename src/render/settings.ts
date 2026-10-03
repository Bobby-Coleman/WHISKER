// Data-driven tuning for look, atmosphere, wind and quality tiers.
import { uniform } from 'three/tsl';
import { Color, Vector2, Vector3 } from 'three/webgpu';

export type QualityTier = 'high' | 'medium' | 'low';

export const TIERS: Record<QualityTier, {
  pixelRatioCap: number; renderScale: number; grassDensity: number; grassRadius: number;
  shadowMap: number; furShells: number; dof: boolean; msaa: boolean; mistCards: number; ao: boolean;
}> = {
  high: { pixelRatioCap: 1.5, renderScale: 1.0, grassDensity: 1.0, grassRadius: 70, shadowMap: 2048, furShells: 14, dof: true, msaa: true, mistCards: 84, ao: true },
  medium: { pixelRatioCap: 1.25, renderScale: 0.85, grassDensity: 0.6, grassRadius: 55, shadowMap: 2048, furShells: 9, dof: true, msaa: true, mistCards: 54, ao: false },
  low: { pixelRatioCap: 1.0, renderScale: 0.7, grassDensity: 0.32, grassRadius: 40, shadowMap: 1024, furShells: 5, dof: false, msaa: false, mistCards: 26, ao: false },
};

// Anti-aliasing: 'taa' (temporal reprojection, default where WebGPU or WebGL 2 is fast enough), 'msaa' (4x MSAA
// plus FXAA, the earlier pipeline) or 'fxaa' (phones). Chosen once at load; materials that depend on it read it.
export const RENDER = { aa: 'taa' as 'taa' | 'msaa' | 'fxaa' };

// Wind shared by grass, reeds, capes, the bow and drifting mist.
export const WIND = {
  dir: new Vector2(0.82, 0.57).normalize(),
  dir3: new Vector3(0.82, 0, 0.57).normalize(),
  strength: uniform(1.0),
  time: uniform(0),
  gust: 0, // CPU mirror of the gust envelope, for cloth and audio
};

// Sky and fog radiance relative to the colours below. Lifted so the sky is as bright as the light it casts
// (the reference sky is near white and steel reads darker than it); the environment compensates.
export const SKY_LIFT = 1.18;

export const LOOK = {
  fogColor: uniform(new Color('#aeb7b9').multiplyScalar(SKY_LIFT)),
  skyZenith: uniform(new Color('#9fafb7').multiplyScalar(SKY_LIFT)),
  skyHorizon: uniform(new Color('#b4bdbf').multiplyScalar(SKY_LIFT)),
  fogDistance: uniform(115),
  mistAmount: uniform(1.0),
  fogEnabled: uniform(1.0),
  exposure: 0.95,
  treatment: uniform(0.6), // 0 = clean render; kept lighter than the reference clip's softness
  grade: uniform(1.0),
  modern: uniform(0.0), // 0 = vintage archive look, 1 = modern look (deeper blacks, more colour, sharpened)
  dofAmount: uniform(0.0), // 0 = broad gameplay focus, 1 = reveal softness
  focusDistance: uniform(4.0),
  bloomStrength: uniform(0.12),
  aoAmount: uniform(0.0), // screen-space ambient occlusion; 0 also skips its passes
  resolution: uniform(new Vector2(1280, 960)),
  frame: uniform(0),
};

export const GAME = {
  runSpeed: 2.9, // shared normal sustained running speed (m/s), used by player and companion
  walkSpeed: 1.3,
  followGap: { knight: 2.1, kitten: 1.7 },
  arriveTolerance: 0.35,
  catchUpMax: 1.18, // bounded multiplier on run speed for path detours
  physicsHz: 60,
};
