// The sky, the light and the air (v3): a painted gradient dome with a sun and soft drifting clouds, linear fog in
// the horizon's colour (distant land fades into the sky), a hemisphere fill and one warm sun that casts the
// shadows, kept on the player. A small environment map, made from the sky, gives metal something to reflect.
import * as THREE from 'three';
import { RIM, SCENERY_WIND, AIR_LEVEL } from './materials';
import { WIND } from '../body';

export type LookPreset = {
  zenith: string; horizon: string; ground: string; sun: string; sunIntensity: number;
  sunElev: number; sunAzim: number; // degrees; azimuth from +z toward +x
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  fog: string; fogNear: number; fogFar: number;
  clouds: number; cloudColor: string; cloudShade: string;
  rim: string; rimStrength: number; exposure: number; overcast?: number;
};

export const LOOKS: Record<string, LookPreset> = {
  // A cold battlefield under thick cloud; the last warm light is a broad glow, never a sunset postcard.
  dusk: {
    zenith: '#7f8e97', horizon: '#b0b7b7', ground: '#484b42', sun: '#dfd4c3', sunIntensity: 0.7, sunElev: 24, sunAzim: 200,
    hemiSky: '#bbc1c2', hemiGround: '#535447', hemiIntensity: 1.8, fog: '#aeb6b8', fogNear: 9, fogFar: 370,
    clouds: 0.96, cloudColor: '#b9bdbb', cloudShade: '#7c888e', rim: '#c3c9ca', rimStrength: 0.12, exposure: 0.98, overcast: 0.96,
  },
  // Wet khaki turf, blue-grey distance and heavy winds; landmarks remain readable through the mist.
  morning: {
    zenith: '#8195a1', horizon: '#bbc4c8', ground: '#4c5549', sun: '#e1e3dd', sunIntensity: 0.8, sunElev: 36, sunAzim: 140,
    hemiSky: '#bbc9ce', hemiGround: '#555f4d', hemiIntensity: 1.9, fog: '#b4bfc4', fogNear: 10, fogFar: 420,
    clouds: 0.95, cloudColor: '#c2cacb', cloudShade: '#82939e', rim: '#c6d0d2', rimStrength: 0.13, exposure: 1.0, overcast: 0.92,
  },
};

// A tileable value-noise texture (r: fine, g: coarse), shared by the sky's clouds and the water.
let NOISE: THREE.DataTexture | null = null;
export function noiseTexture() {
  if (NOISE) return NOISE;
  const N = 128, data = new Uint8Array(N * N * 4);
  const lattice = (s: number, seed: number) => {
    const g = new Float32Array(s * s);
    let h = seed * 9301 + 49297;
    for (let i = 0; i < g.length; i++) { h = (h * 9301 + 49297) % 233280; g[i] = h / 233280; }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const a = g[((yi % s) * s + (xi % s))], b = g[((yi % s) * s + ((xi + 1) % s))];
      const c = g[(((yi + 1) % s) * s + (xi % s))], d = g[(((yi + 1) % s) * s + ((xi + 1) % s))];
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  };
  const o1 = lattice(8, 1), o2 = lattice(16, 2), o3 = lattice(32, 3), o4 = lattice(4, 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const fine = 0.5 * o2(u * 16, v * 16) + 0.3 * o3(u * 32, v * 32) + 0.2 * o1(u * 8, v * 8);
    const coarse = 0.6 * o4(u * 4, v * 4) + 0.4 * o1(u * 8, v * 8);
    const i = (y * N + x) * 4;
    data[i] = fine * 255; data[i + 1] = coarse * 255; data[i + 2] = o3(u * 32 + 7, v * 32 + 3) * 255; data[i + 3] = 255;
  }
  NOISE = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping;
  NOISE.magFilter = THREE.LinearFilter; NOISE.minFilter = THREE.LinearMipmapLinearFilter;
  NOISE.generateMipmaps = true;
  NOISE.needsUpdate = true;
  return NOISE;
}

export class Look {
  sky: THREE.Mesh;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  uniforms: Record<string, THREE.IUniform>;
  preset!: LookPreset;
  sunDir = new THREE.Vector3();
  private envMaps = new Map<LookPreset, THREE.WebGLRenderTarget>();
  private pmrem: THREE.PMREMGenerator;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowSize: number) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.uniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, groundC: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() }, sunC: { value: new THREE.Color() }, cloudAmt: { value: 0.5 },
      cloudC: { value: new THREE.Color() }, cloudS: { value: new THREE.Color() }, time: { value: 0 }, noise: { value: noiseTexture() },
      windDir: { value: new THREE.Vector2(1, 0) }, overcast: { value: 0.9 }, windSpeed: { value: 0.3 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 zenith, horizon, groundC, sunDir, sunC, cloudC, cloudS; uniform float cloudAmt, time, overcast, windSpeed; uniform sampler2D noise; uniform vec2 windDir;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
          c = mix(c, groundC, 1.0 - smoothstep(-0.24, 0.0, h));
          float s = max(dot(d, sunDir), 0.0);
          c += sunC * (pow(s, 6.0) * 0.11 + pow(s, 60.0) * 0.18) * (1.0 - overcast * 0.85);
          c = mix(c, sunC * 1.6 + vec3(0.3), smoothstep(0.9993, 0.9996, s) * (1.0 - overcast));
          // Clouds: soft lumps on a dome, drifting with the wind, lit from the sun's side.
          if (h > 0.0 && cloudAmt > 0.0) {
            vec2 uv = d.xz / (h + 0.18) * 0.24 - windDir * time * (0.003 + windSpeed * 0.004);
            float n = texture2D(noise, uv * 0.6).g * 0.65 + texture2D(noise, uv * 1.7).r * 0.35;
            float cov = smoothstep(1.0 - cloudAmt * 0.75, 1.12 - cloudAmt * 0.6, n);
            float lit = clamp(dot(normalize(vec3(d.x, 0.3, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
            vec3 cc = mix(cloudS, cloudC, clamp(n * 1.1 + lit * 0.15, 0.0, 1.0));
            c = mix(c, cc, mix(cov, 0.65 + n * 0.3, overcast) * smoothstep(0.0, 0.16, h));
            // A broad pale horizon, the same air that hides distant hills and breaks the tree line into layers.
            c = mix(horizon, c, smoothstep(0.015, 0.2, h));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.sky.scale.setScalar(5000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.name = 'Sky';
    scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = shadowSize > 0;
    if (shadowSize > 0) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const s = this.sun.shadow.camera as THREE.OrthographicCamera;
      s.left = -18; s.right = 18; s.top = 18; s.bottom = -18; s.near = 1; s.far = 160;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
      this.sun.shadow.radius = 4;
      this.sun.shadow.intensity = 0.45;
    }
    scene.add(this.sun, this.sun.target);
  }

  set(p: LookPreset) {
    this.preset = p;
    const u = this.uniforms;
    const C = (h: string) => new THREE.Color(h);
    (u.zenith.value as THREE.Color).copy(C(p.zenith)); (u.horizon.value as THREE.Color).copy(C(p.horizon));
    (u.groundC.value as THREE.Color).copy(C(p.ground)); (u.sunC.value as THREE.Color).copy(C(p.sun));
    (u.cloudC.value as THREE.Color).copy(C(p.cloudColor)); (u.cloudS.value as THREE.Color).copy(C(p.cloudShade));
    u.cloudAmt.value = p.clouds; u.overcast.value = p.overcast ?? 0;
    const el = THREE.MathUtils.degToRad(p.sunElev), az = THREE.MathUtils.degToRad(p.sunAzim);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.sun.color.set(p.sun); this.sun.intensity = p.sunIntensity;
    this.scene.fog = new THREE.Fog(new THREE.Color(p.fog), p.fogNear, p.fogFar);
    this.scene.background = null;
    RIM.color.value.set(p.rim); RIM.strength.value = p.rimStrength;
    this.renderer.toneMappingExposure = p.exposure;
    this.bakeEnv();
  }

  // The sky (and a plain ground) into a small prefiltered map, for reflections on metal.
  private bakeEnv() {
    const cached = this.envMaps.get(this.preset);
    if (cached) { this.scene.environment = cached.texture; return; }
    const s = new THREE.Scene();
    const sky = this.sky.clone();
    sky.scale.setScalar(100);
    s.add(sky);
    // 128 px is ample for softly reflected overcast cloud; cache it for instant chapter revisits.
    const env = this.pmrem.fromScene(s, 0.035, 0.1, 400, { size: 128 });
    this.envMaps.set(this.preset, env);
    this.scene.environment = env.texture;
  }

  // Each frame: the sun and its shadow box kept on the focus (snapped to texels so shadows do not shimmer).
  update(dt: number, focus: THREE.Vector3, windDir?: THREE.Vector2) {
    this.uniforms.time.value += dt;
    AIR_LEVEL.value = focus.y;
    this.uniforms.windSpeed.value = WIND.base + WIND.gust * 0.5;
    if (windDir) (this.uniforms.windDir.value as THREE.Vector2).copy(windDir);
    SCENERY_WIND.time.value = WIND.time;
    SCENERY_WIND.direction.value.copy(WIND.dir);
    SCENERY_WIND.strength.value = WIND.base;
    SCENERY_WIND.gust.value = WIND.gust;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.position.set(fx + this.sunDir.x * 80, focus.y + this.sunDir.y * 80, fz + this.sunDir.z * 80);
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.target.updateMatrixWorld();
  }

  // Shadow box half-size (m): tighter for close-ups (sharper), wider for play.
  shadowSpan(h: number) {
    const c = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (Math.abs(c.right - h) < 0.01) return;
    c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.updateProjectionMatrix();
  }

  dispose() {
    for (const env of this.envMaps.values()) env.dispose();
    this.envMaps.clear(); this.pmrem.dispose();
    this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose();
  }
}
