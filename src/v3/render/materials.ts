// The look's materials (v3). Everything in the world is a "toy": a standard material with soft wrapped light (it
// reaches a little round past the shadow line, as on painted wood or felt) and a faint rim of sky light at the edges.
// Metal is the same with low roughness and the sky's reflection. All share one shader program per kind.
import * as THREE from 'three';

// The palette, as sRGB hex.
export const PAL = {
  grassDark: '#39443a', grass: '#707d59', grassTip: '#a5a78a', dryGrass: '#989078',
  dirt: '#706656', path: '#8b8775', mud: '#4c4e3e',
  stone: '#858b85', stoneDark: '#626a65', slate: '#6b7880',
  wood: '#75604b', woodDark: '#4f4335', straw: '#aaa080',
  bannerRed: '#815048', bannerBlue: '#556676', gold: '#b29d70',
  cream: '#f6ecd9', ginger: '#e8a866', gingerDark: '#c8783e', pink: '#f2a7b3', noseP: '#e58c95',
  steel: '#c5ccd3', steelDark: '#7d8791', cloth: '#3b3f4a', clothDark: '#2a2d35', leather: '#5a3a26',
  blood: '#7a1418',
};

// Shared rim colour (the sky near the horizon) and strength; the look sets them per level.
export const RIM = { color: { value: new THREE.Color('#bbc5c8') }, strength: { value: 0.14 }, wrap: { value: 0.18 } };

export const AIR_LEVEL = { value: 0 };
export const MOOR_FOG_PARS = /* glsl */ `uniform float airLevel; varying float vAirHeight;`;

// Early, soft aerial perspective preserves distant landmarks as silhouettes while the foreground stays clear.
// It uses Three's existing fog uniforms and therefore adds neither textures nor shader variants.
export const MOOR_FOG = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float airDistance = max(vFogDepth - fogNear, 0.0);
    float fogFactor = max(smoothstep(fogNear, fogFar, vFogDepth),
      1.0 - exp(-airDistance / max((fogFar - fogNear) * 0.36, 1.0)));
    // Low mist gathers along turf, walls and tree roots; taller landmarks retain their silhouettes above it.
    float lowAir = (1.0 - smoothstep(airLevel + 0.5, airLevel + 14.0, vAirHeight)) *
      smoothstep(12.0, 68.0, vFogDepth) * 0.58;
    fogFactor = max(fogFactor, lowAir);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;

export function moorAir(sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }) {
  sh.uniforms.airLevel = AIR_LEVEL;
  sh.vertexShader = sh.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying float vAirHeight;')
    .replace('#include <fog_vertex>', `#include <fog_vertex>
      vec4 moorWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        moorWorld = instanceMatrix * moorWorld;
      #endif
      vAirHeight = (modelMatrix * moorWorld).y;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + MOOR_FOG_PARS)
    .replace('#include <fog_fragment>', MOOR_FOG);
}

// One clock/direction/envelope shared by scenery. The look updates it from the gameplay wind each frame.
export const SCENERY_WIND = {
  time: { value: 0 }, direction: { value: new THREE.Vector2(1, 0) }, strength: { value: 0.3 }, gust: { value: 0 },
};

// A dissolve (screen-door dither) a character's materials share: 1 solid .. 0 gone.
export type Fade = { value: number };
const BAYER = `
float bayer4(vec2 p){
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 i = ivec2(mod(p, 4.0));
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`;

function patch(m: THREE.MeshStandardMaterial, key: string, fade?: Fade) {
  m.onBeforeCompile = (sh) => {
    moorAir(sh);
    sh.uniforms.rimColor = RIM.color; sh.uniforms.rimStrength = RIM.strength; sh.uniforms.wrapAmt = RIM.wrap;
    if (fade) {
      sh.uniforms.fadeAmt = fade;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float fadeAmt;' + BAYER)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (fadeAmt < 0.999 && fadeAmt < bayer4(gl_FragCoord.xy)) discard;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_fragment>', MOOR_FOG)
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float wrapAmt;')
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + wrapAmt ) / ( 1.0 + wrapAmt ) );'))
      .replace('#include <opaque_fragment>', `
        float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
        outgoingLight += rimColor * rimF * rimStrength * ( 0.35 + 0.65 * diffuseColor.rgb );
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => key + (fade ? 'Fade' : '');
  return m;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

// A matte toy material: a colour (or vertex colours), rough.
export function toy(color: string | number = '#ffffff', o: { rough?: number; vertexColors?: boolean; side?: THREE.Side; flat?: boolean; emissive?: string; emissiveIntensity?: number; fade?: Fade } = {}) {
  const key = `toy|${color}|${o.rough ?? 0.85}|${o.vertexColors ? 1 : 0}|${o.side ?? 0}|${o.flat ? 1 : 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 0}`;
  let m = o.fade ? undefined : cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color as any), roughness: o.rough ?? 0.85, metalness: 0, vertexColors: !!o.vertexColors,
    side: o.side ?? THREE.FrontSide, flatShading: !!o.flat, envMapIntensity: 0.55,
  });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  patch(m, 'toy', o.fade);
  if (!o.fade) cache.set(key, m);
  return m;
}

// Polished metal: the knight's plate, swords, buckles.
export function metal(color: string = PAL.steel, rough = 0.32, fade?: Fade, vertexColors = false) {
  const key = `metal|${color}|${rough}|${vertexColors ? 1 : 0}`;
  let m = fade ? undefined : cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0.85, envMapIntensity: 1.1, vertexColors });
  patch(m, 'metal', fade);
  if (!fade) cache.set(key, m);
  return m;
}

// Vertex colours from a function of position (world or local), written into a geometry.
export function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color) {
  const p = g.attributes.position, n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export const col = (hex: string) => new THREE.Color(hex);
