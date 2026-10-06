// The look's materials (v3). Everything in the world is a "toy": a standard material with soft wrapped light (it
// reaches a little round past the shadow line, as on painted wood or felt) and a faint rim of sky light at the edges.
// Metal is the same with low roughness and the sky's reflection. All share one shader program per kind.
import * as THREE from 'three';

// The palette, as sRGB hex.
export const PAL = {
  grassDark: '#3f7a3a', grass: '#6aa84f', grassTip: '#b9d36a', dryGrass: '#c8b46a',
  dirt: '#8a6a4a', path: '#b08d64', mud: '#5d4632',
  stone: '#8f8e88', stoneDark: '#6c6c68', slate: '#6f7c86',
  wood: '#8a5d3b', woodDark: '#5e3f28', straw: '#d8b65e',
  bannerRed: '#b8423a', bannerBlue: '#3c5d9a', gold: '#d9aa4a',
  cream: '#f6ecd9', ginger: '#e8a866', gingerDark: '#c8783e', pink: '#f2a7b3', noseP: '#e58c95',
  steel: '#c5ccd3', steelDark: '#7d8791', cloth: '#3b3f4a', clothDark: '#2a2d35', leather: '#5a3a26',
  blood: '#7a1418',
};

// Shared rim colour (the sky near the horizon) and strength; the look sets them per level.
export const RIM = { color: { value: new THREE.Color('#ffd9b0') }, strength: { value: 0.35 }, wrap: { value: 0.35 } };

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
    sh.uniforms.rimColor = RIM.color; sh.uniforms.rimStrength = RIM.strength; sh.uniforms.wrapAmt = RIM.wrap;
    if (fade) {
      sh.uniforms.fadeAmt = fade;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float fadeAmt;' + BAYER)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (fadeAmt < 0.999 && fadeAmt < bayer4(gl_FragCoord.xy)) discard;');
    }
    sh.fragmentShader = sh.fragmentShader
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
export function metal(color: string = PAL.steel, rough = 0.32, fade?: Fade) {
  const key = `metal|${color}|${rough}`;
  let m = fade ? undefined : cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0.85, envMapIntensity: 1.1 });
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
