// Image-based lighting from photographed overcast skies (Poly Haven HDRIs, CC0). Each weather has:
//   - an 8-bit image of the HDRI's upper hemisphere (with its exposure scale), used both for the visible sky and,
//     prefiltered (PMREM), for the light and reflections on everything in the field: an overcast sky has so little
//     dynamic range that 8 bits hold all but its brightest 0.3%, which the hidden sun's directional light carries;
//   - measured colours (env.json, tools/build_assets.mjs) that set the fog and the hidden sun to match.
// The lower hemisphere of each photograph (somebody else's ground) is replaced by the moor's own ground radiance,
// with a fogged band below the horizon, so polished steel picks up a dark ground under a bright horizon.
// Weathers change through a surge of mist: the fog closes in, the sky and light are swapped while the view is mostly
// air, and the mist draws back.
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, mix, smoothstep, texture, uniform, positionLocal, normalize, atan, asin, clamp, max, pow, dot, color,
} from 'three/tsl';
import { countDownload } from '../chars/binfile';
import { LOOK, SKY_LIFT } from '../render/settings';

export type WeatherId = 'morning' | 'haze' | 'dusk';

type Meta = {
  skyScale: number; skyElevation: [number, number];
  horizon: number[]; lowSky: number[]; zenith: number[]; irradiance: number[]; irradianceLum: number;
  sunDir: number[];
};

// Mood per weather: which photograph, how bright its light is relative to the original tuning (an overcast sky
// lighting the ground with about 1.6 units of irradiance), where its hidden sun sits (degrees from north, clockwise
// seen from above) and how strong and warm the sun's direct share is.
export const WEATHERS: Record<WeatherId, { hdri: string; light: number; sunAzimuth: number; sun: number; sunColor: string; fogTint: number[]; mist: number; fogDistance: number }> = {
  morning: { hdri: 'kloofendal_misty_morning', light: 1.0, sunAzimuth: -38, sun: 0.75, sunColor: '#ebe7dd', fogTint: [1.0, 1.0, 1.0], mist: 1.5, fogDistance: 84 },
  haze: { hdri: 'misty_farm_road', light: 0.94, sunAzimuth: -70, sun: 0.5, sunColor: '#e4e6e6', fogTint: [0.99, 1.0, 1.02], mist: 1.9, fogDistance: 52 },
  dusk: { hdri: 'kloppenheim_01', light: 0.82, sunAzimuth: -12, sun: 1.15, sunColor: '#f0d2b0', fogTint: [1.03, 0.99, 0.96], mist: 1.2, fogDistance: 95 },
};
const TARGET_IRRADIANCE = 1.6;

type Loaded = { id: WeatherId; meta: Meta; sky: THREE.Texture; scale: number; yaw: number; env: THREE.Texture | null };

let metaAll: Promise<Record<string, Meta>> | null = null;
function loadMeta() {
  if (!metaAll) metaAll = fetch('./models/env.json').then((r) => r.json());
  return metaAll;
}

function loadSkyImage(name: string) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load('./models/' + name, (t) => {
      countDownload(0);
      t.flipY = false; // row 0 is the zenith
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => reject(new Error('Could not load ' + name)));
  });
}

async function loadWeatherAssets(id: WeatherId): Promise<Loaded> {
  const w = WEATHERS[id];
  const [meta, sky] = await Promise.all([loadMeta().then((m) => m[w.hdri]), loadSkyImage(`sky_${w.hdri}.jpg`)]);
  // Light: scale the photograph so the sky's irradiance on level ground matches the tuning target.
  const scale = (TARGET_IRRADIANCE / meta.irradianceLum) * w.light;
  // Turn the photograph about the vertical so its brightest region sits at the chosen azimuth.
  const hdrAz = Math.atan2(meta.sunDir[0], -meta.sunDir[2]);
  const want = THREE.MathUtils.degToRad(w.sunAzimuth);
  return { id, meta, sky, scale, yaw: want - hdrAz, env: null };
}

// Direction -> (u, v) in the photographs: u = azimuth from north (-Z) clockwise toward +X, v = 0 at the zenith.
// `yaw` turns the photograph; `v1` is the elevation (degrees) at the bottom of the image.
const photoUV = Fn(([dir, yaw, top, bottom]: any[]) => {
  const az = atan(dir.x, dir.z.negate()).sub(yaw);
  const el = asin(clamp(dir.y, -1, 1)).mul(180 / Math.PI);
  return vec2(az.mul(1 / (2 * Math.PI)), el.sub(top).div(float(bottom).sub(top)));
});

// The moor's ground as the sky would light it: dark peat and olive turf, fogging toward the horizon.
const groundRadiance = (irr: THREE.Color) => {
  const g = new THREE.Color('#46493a').convertSRGBToLinear();
  return new THREE.Color(g.r * irr.r / Math.PI, g.g * irr.g / Math.PI, g.b * irr.b / Math.PI);
};

function envMaterial(w: Loaded, fog: THREE.Color) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  m.fog = false;
  const dir = normalize(positionLocal);
  // An overcast sky has little dynamic range: the 8-bit sky image (scaled back by skyScale) holds all but its
  // brightest 0.3%, which the hidden sun's directional light carries instead.
  const uvS = photoUV(dir, float(w.yaw), float(90), float(-6));
  const sky = texture(w.sky, uvS).rgb.mul(w.scale * w.meta.skyScale);
  const irr = new THREE.Color(w.meta.irradiance[0] * w.scale, w.meta.irradiance[1] * w.scale, w.meta.irradiance[2] * w.scale);
  const ground = color(groundRadiance(irr));
  // On a misty moor every view within a few degrees of level ends in mist, so the band around the horizon is the
  // fog's own radiance (bright), the open sky takes over above it and the near, unfogged ground below it. Polished
  // steel facing sideways reflects that band, which is why it reads pale silver in the reference rather than dark.
  const mist = color(fog).mul(0.97);
  const below = mix(ground, mist, smoothstep(-0.32, -0.05, dir.y));
  // The photographs' own horizons (bushes, hills, a road) sit within ~6 degrees of level; the moor's mist hides that
  // band in the visible sky, so the reflected sky starts above it too.
  m.colorNode = mix(below, sky, smoothstep(0.1, 0.3, dir.y));
  return m;
}

export class Weather {
  current: WeatherId = 'morning';
  private loaded = new Map<WeatherId, Promise<Loaded>>();
  private ready = new Map<WeatherId, Loaded>();
  private pmrem: THREE.PMREMGenerator;
  // Sky dome: two photographs cross-faded (A fades to B), each with its own turn and scale.
  private skyA = texture(new THREE.Texture()); private skyB = texture(new THREE.Texture());
  private skyScaleA = uniform(1); private skyScaleB = uniform(1);
  private yawA = uniform(0); private yawB = uniform(0);
  private skyMix = uniform(0);
  sunDir = new THREE.Vector3(-0.45, 0.65, -0.6).normalize();
  sunColor = new THREE.Color('#e9e6dc');
  sunIntensity = 0.85;
  // Transition state.
  private trans: { to: WeatherId; t: number; dur: number; swapped: boolean; from: { fog: THREE.Color; dist: number; mist: number; sun: number; sunCol: THREE.Color; sunDir: THREE.Vector3 } } | null = null;
  onEnvironment: (env: THREE.Texture) => void = () => {};

  constructor(private renderer: THREE.WebGPURenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  load(id: WeatherId) {
    let p = this.loaded.get(id);
    if (!p) {
      p = loadWeatherAssets(id).then((w) => { this.ready.set(id, w); return w; });
      this.loaded.set(id, p);
    }
    return p;
  }

  private fogFor(w: Loaded) {
    // Mist scatters the sky's light back toward the eye: its radiance is about the sky's mean radiance.
    const t = WEATHERS[w.id].fogTint;
    const k = (w.scale / Math.PI) * SKY_LIFT;
    return new THREE.Color(w.meta.irradiance[0] * k * t[0], w.meta.irradiance[1] * k * t[1], w.meta.irradiance[2] * k * t[2]);
  }

  private environment(w: Loaded) {
    if (w.env) return w.env;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), envMaterial(w, this.fogFor(w))));
    const rt = this.pmrem.fromScene(scene, 0.0, 0.1, 100, { size: 256 });
    w.env = rt.texture;
    return w.env;
  }

  // The visible sky: the same photograph as the light (lifted like the fog), dissolving into the fog at the horizon.
  skyNode() {
    return Fn(() => {
      const dir = normalize(positionLocal);
      const sample = (tex: any, yaw: any, scale: any) => {
        const uvS = photoUV(dir, yaw, float(90), float(-6));
        return tex.sample(uvS).rgb.mul(scale);
      };
      let c: any = mix(sample(this.skyA, this.yawA, this.skyScaleA), sample(this.skyB, this.yawB, this.skyScaleB), this.skyMix);
      c = c.mul(SKY_LIFT);
      // Below a few degrees the sky is all mist.
      const y = dir.y;
      c = mix(LOOK.fogColor, c, smoothstep(0.015, 0.16, y).mul(LOOK.fogEnabled).add(float(1).sub(LOOK.fogEnabled)));
      return c;
    })();
  }

  // Applies a weather at once (load time, or under a mist surge).
  private apply(w: Loaded, scene: THREE.Scene) {
    const cfg = WEATHERS[w.id];
    this.current = w.id;
    const env = this.environment(w);
    scene.environment = env;
    this.onEnvironment(env);
    // Sky: B becomes the shown photograph.
    this.skyA.value = this.skyB.value; this.skyScaleA.value = this.skyScaleB.value; this.yawA.value = this.yawB.value;
    this.skyB.value = w.sky; this.skyScaleB.value = w.scale * w.meta.skyScale; this.yawB.value = w.yaw;
    this.skyMix.value = 1;
    const fog = this.fogFor(w);
    LOOK.fogColor.value.copy(fog);
    LOOK.skyHorizon.value.copy(fog).multiplyScalar(1.04);
    const z = w.meta.zenith;
    LOOK.skyZenith.value.setRGB(z[0] * w.scale * SKY_LIFT, z[1] * w.scale * SKY_LIFT, z[2] * w.scale * SKY_LIFT);
    // Hidden sun: from the photograph's brightest region, turned with it.
    const sd = w.meta.sunDir;
    const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
    // Turning the photograph by `yaw` turns its directions by the same angle about +Y (azimuth measured from -Z).
    const az = Math.atan2(sd[0], -sd[2]) + w.yaw, horiz = Math.hypot(sd[0], sd[2]);
    void c; void s;
    this.sunDir.set(Math.sin(az) * horiz, Math.max(0.25, sd[1]), -Math.cos(az) * horiz).normalize();
    this.sunColor.set(cfg.sunColor);
    this.sunIntensity = cfg.sun;
    LOOK.fogDistance.value = cfg.fogDistance;
    LOOK.mistAmount.value = cfg.mist;
  }

  async init(id: WeatherId, scene: THREE.Scene) {
    const w = await this.load(id);
    this.skyB.value = w.sky; this.skyScaleB.value = w.scale * w.meta.skyScale; this.yawB.value = w.yaw;
    this.apply(w, scene);
  }

  // Starts a change of weather through a surge of mist (seconds). Loads the photograph first if needed.
  change(id: WeatherId, seconds = 7) {
    if (id === this.current && !this.trans) return;
    void this.load(id);
    this.trans = {
      to: id, t: 0, dur: seconds, swapped: false,
      from: { fog: LOOK.fogColor.value.clone(), dist: LOOK.fogDistance.value, mist: LOOK.mistAmount.value, sun: this.sunIntensity, sunCol: this.sunColor.clone(), sunDir: this.sunDir.clone() },
    };
  }

  get transitioning() { return !!this.trans; }

  update(dt: number, scene: THREE.Scene) {
    const tr = this.trans;
    if (!tr) return;
    const w = this.ready.get(tr.to);
    if (!w) return; // still downloading: hold until it arrives
    tr.t += dt;
    const a = Math.min(1, tr.t / tr.dur);
    const cfg = WEATHERS[tr.to];
    // Mist closes in over the first half and draws back over the second.
    const surge = Math.sin(Math.PI * a);
    const fogTo = this.fogFor(w);
    if (!tr.swapped && a >= 0.5) {
      tr.swapped = true;
      const fogNow = LOOK.fogColor.value.clone();
      this.apply(w, scene);
      LOOK.fogColor.value.copy(fogNow);
      this.skyMix.value = 0;
    }
    const k = smooth(Math.min(1, Math.max(0, (a - 0.2) / 0.6)));
    LOOK.fogColor.value.copy(tr.from.fog).lerp(fogTo, k);
    LOOK.skyHorizon.value.copy(LOOK.fogColor.value).multiplyScalar(1.04);
    LOOK.fogDistance.value = THREE.MathUtils.lerp(tr.from.dist, cfg.fogDistance, k) * (1 - 0.72 * surge);
    LOOK.mistAmount.value = THREE.MathUtils.lerp(tr.from.mist, cfg.mist, k) * (1 + 0.8 * surge);
    if (tr.swapped) this.skyMix.value = smooth(Math.min(1, (a - 0.5) / 0.35));
    this.sunIntensity = THREE.MathUtils.lerp(tr.from.sun, cfg.sun, k) * (1 - 0.5 * surge);
    if (a >= 1) { this.trans = null; this.skyMix.value = 1; }
  }

  // Bright, slightly warm hidden-sun lobe for the procedural fallback when no photograph could be loaded.
  static fallbackGlow(dir: any) {
    const sunDir = normalize(vec3(-0.45, 0.55, -0.7));
    return pow(max(dot(dir, sunDir), 0), 3.0).mul(0.45);
  }
}

const smooth = (x: number) => x * x * (3 - 2 * x);
