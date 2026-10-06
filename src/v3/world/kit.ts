// The building kit (v3): every piece makes its mesh and its collider from the same numbers, so what you see is
// what you stand on. Blocks, ramps, stairs (drawn as steps, collided as a smooth ramp so both characters walk
// up and down them without bumping), ivy walls she can climb, crates he can push, moving platforms. Stone is
// laid in courses by a world-space pattern in the shader.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RAPIER, Physics, L, Surface, Platform, Prop } from '../physics';
import { toy, PAL } from '../render/materials';
import { RIM } from '../render/materials';

type V3 = [number, number, number];
export type PieceOpts = { color?: string; stone?: number; rough?: number; surface?: Surface; member?: number; bevel?: number; cast?: boolean; name?: string; collide?: boolean };

// Masonry: courses of stones of about `size` metres, each its own tone, with dark joints; the same on every face.
const stoneMats = new Map<string, THREE.MeshStandardMaterial>();
export function stone(color: string = PAL.stone, size = 0.45) {
  const key = `${color}|${size}`;
  let m = stoneMats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.92, envMapIntensity: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = RIM.color; sh.uniforms.rimStrength = RIM.strength; sh.uniforms.wrapAmt = RIM.wrap;
    sh.uniforms.stoneSize = { value: size };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 rimColor; uniform float rimStrength; uniform float wrapAmt; uniform float stoneSize;
        varying vec3 vWP; varying vec3 vWN;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        vec2 courses(vec2 p){ // returns (joint 0..1, tone)
          vec2 q = p / vec2(stoneSize * 1.6, stoneSize);
          float row = floor(q.y);
          q.x += h21(vec2(row, 3.0)) * 0.9 + row * 0.5;
          vec2 f = fract(q), id = floor(q);
          float e = min(min(f.x, 1.0 - f.x) * stoneSize * 1.6, min(f.y, 1.0 - f.y) * stoneSize);
          return vec2(smoothstep(0.012, 0.035, e), h21(id + row * 7.0));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 an = abs(vWN);
        vec2 cs = an.y > 0.7 ? courses(vWP.xz * vec2(1.0, 1.6)) : (an.x > an.z ? courses(vWP.zy) : courses(vWP.xy));
        diffuseColor.rgb *= mix(0.55, 1.0, cs.x) * (0.86 + 0.24 * cs.y);`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + wrapAmt ) / ( 1.0 + wrapAmt ) );'))
      .replace('#include <opaque_fragment>', `
        float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
        outgoingLight += rimColor * rimF * rimStrength * 0.6;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'stone';
  stoneMats.set(key, m);
  return m;
}

export class Kit {
  root = new THREE.Group();
  constructor(public physics: Physics) { this.root.name = 'Kit'; }

  private mat(o: PieceOpts) { return o.stone ? stone(o.color ?? PAL.stone, o.stone) : toy(o.color ?? PAL.stone, { rough: o.rough }); }
  private mesh(geo: THREE.BufferGeometry, o: PieceOpts) {
    const m = new THREE.Mesh(geo, this.mat(o));
    m.castShadow = o.cast ?? true; m.receiveShadow = true;
    if (o.name) m.name = o.name;
    return m;
  }

  // A block standing on `at` (the centre of its base), size w × h × d, turned `yaw`.
  box(at: V3, size: V3, yaw = 0, o: PieceOpts = {}) {
    const [w, h, d] = size;
    const bevel = o.bevel ?? Math.min(0.05, Math.min(w, h, d) * 0.15);
    const m = this.mesh(new RoundedBoxGeometry(w, h, d, 2, bevel), o);
    m.position.set(at[0], at[1] + h / 2, at[2]);
    m.rotation.y = yaw;
    this.root.add(m);
    if (o.collide !== false) {
      const q = new THREE.Quaternion().setFromEuler(m.rotation);
      this.physics.addBox(m.position, new THREE.Vector3(w / 2, h / 2, d / 2), q, o.surface, o.member ?? L.world);
    }
    return m;
  }

  // A ramp: low edge centred at `at`, rising `rise` over a horizontal `run` toward yaw.
  ramp(at: V3, width: number, run: number, rise: number, yaw: number, o: PieceOpts = {}, t = 0.3) {
    const len = Math.hypot(run, rise), a = Math.atan2(rise, run);
    const m = this.mesh(new RoundedBoxGeometry(width, t, len, 2, Math.min(0.04, t * 0.3)), o);
    m.rotation.set(-a, yaw, 0, 'YXZ');
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const n = new THREE.Vector3(0, Math.cos(a), 0).addScaledVector(dir, -Math.sin(a));
    m.position.set(at[0], at[1], at[2]).addScaledVector(dir, run / 2).add(new THREE.Vector3(0, rise / 2, 0)).addScaledVector(n, -t / 2);
    this.root.add(m);
    if (o.collide !== false) this.physics.addBox(m.position, new THREE.Vector3(width / 2, t / 2, len / 2), new THREE.Quaternion().setFromEuler(m.rotation), o.surface, o.member ?? L.world);
    return m;
  }

  // Stairs: n steps of `rise` and `tread`, climbing toward yaw from `at` (the foot of the flight). Drawn as steps;
  // collided as one smooth slope over their nosings (and solid blocks under it), so walking them is smooth.
  stairs(at: V3, n: number, rise: number, tread: number, width: number, yaw: number, o: PieceOpts = {}) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (let i = 0; i < n; i++) {
      const c = new THREE.Vector3(at[0], at[1], at[2]).addScaledVector(dir, tread * (i + 0.5));
      this.box([c.x, c.y, c.z], [width, rise * (i + 1), tread], yaw, { bevel: 0.02, ...o, collide: false });
    }
    // The slope from the first nosing to the top, and the landing under its foot.
    const run = tread * n, top = rise * n;
    const start = new THREE.Vector3(at[0], at[1], at[2]);
    const len = Math.hypot(run, top), a = Math.atan2(top, run), t = 0.05;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, yaw, 0, 'YXZ'));
    const nrm = new THREE.Vector3(0, Math.cos(a), 0).addScaledVector(dir, -Math.sin(a));
    const c = start.clone().addScaledVector(dir, run / 2).add(new THREE.Vector3(0, top / 2, 0)).addScaledVector(nrm, -t / 2 + 0.005);
    this.physics.addBox(c, new THREE.Vector3(width / 2, t / 2, len / 2), q, o.surface ?? { kind: 'stone' }, o.member ?? L.world);
    // Solid under the slope (so nothing slips beneath it).
    for (let i = 0; i < n; i++) {
      const cc = start.clone().addScaledVector(dir, tread * (i + 0.5)).add(new THREE.Vector3(0, rise * i / 2, 0));
      if (i > 0) this.physics.addBox(cc, new THREE.Vector3(width / 2, rise * i / 2, tread / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), undefined, o.member ?? L.world);
    }
  }

  // A wall she can climb: ivy over its front face (the side yaw faces) and a climbable collider.
  ivyWall(at: V3, size: V3, yaw: number, o: PieceOpts = {}, density = 1) {
    const m = this.box(at, size, yaw, { stone: 0.45, ...o, surface: { climb: true, kind: 'stone', ...o.surface } });
    const [w, h, d] = size;
    this.root.add(ivy(new THREE.Vector3(at[0], at[1], at[2]), w, h, d, yaw, density));
    return m;
  }

  // A block moved along a path (lifts, ferries, gates). Its geometry is centred on the body.
  mover(geo: THREE.BufferGeometry, shapes: RAPIER.ColliderDesc[], path: Platform['path'], o: PieceOpts = {}) {
    const m = this.mesh(geo, o);
    this.root.add(m);
    return this.physics.addPlatform(m, shapes, path, o.surface, o.member ?? L.world);
  }
  moverBox(size: V3, path: Platform['path'], o: PieceOpts = {}) {
    const [w, h, d] = size;
    return this.mover(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.05, Math.min(w, h, d) * 0.15)), [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)], path, o);
  }

  // A crate he can push (heavy: she barely moves it).
  crate(at: V3, size: number, density = 1, o: PieceOpts = {}): Prop {
    const m = this.mesh(new RoundedBoxGeometry(size, size, size, 2, size * 0.08), { color: PAL.wood, ...o });
    // Planks: darker bands on the faces.
    const band = toy(PAL.woodDark);
    for (const s of [-1, 1]) for (const ax of [0, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(ax ? size * 1.02 : size * 0.12, size * 1.02, ax ? size * 0.12 : size * 1.02), band);
      b.position.set(ax ? 0 : s * size * 0.38, 0, ax ? s * size * 0.38 : 0);
      m.add(b);
    }
    this.root.add(m);
    return this.physics.addProp(m, RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), new THREE.Vector3(at[0], at[1] + size / 2, at[2]), new THREE.Quaternion(), density, { kind: 'wood' });
  }
}

// Ivy on a wall's front face: overlapping leaves on a few trailing stems, two shades of green.
export function ivy(at: THREE.Vector3, w: number, h: number, d: number, yaw: number, density = 1) {
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), t = new THREE.Vector3(n.z, 0, -n.x);
  const leaf = new THREE.CircleGeometry(0.075, 5).scale(1, 1.25, 1);
  const count = Math.round(w * h * 60 * density);
  const mesh = new THREE.InstancedMesh(leaf, toy('#ffffff', { side: THREE.DoubleSide, rough: 0.7 }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const ca = new THREE.Color('#3f7f35'), cb = new THREE.Color('#6aa64a'), c = new THREE.Color();
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    // Leaves cluster along a few vines growing up from the ground.
    const vine = Math.floor(r() * Math.max(2, w * 2.2));
    const vx = ((vine + 0.5) / Math.max(2, w * 2.2) - 0.5) * w, y = Math.pow(r(), 0.8) * h;
    const x = vx + Math.sin(y * 3 + vine) * 0.25 + (r() - 0.5) * 0.35;
    const p = at.clone().addScaledVector(t, x).addScaledVector(n, d / 2 + 0.012 + r() * 0.02);
    p.y += y;
    e.set((r() - 0.5) * 0.8, Math.atan2(n.x, n.z) + (r() - 0.5) * 0.8, (r() - 0.5) * 1.5, 'YXZ');
    q.setFromEuler(e);
    const sc = 0.8 + r() * 0.6;
    m.compose(p, q, new THREE.Vector3(sc, sc, sc));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.copy(ca).lerp(cb, r()));
  }
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = 'Ivy';
  return mesh;
}

// 0..1..0 over a period, resting at each end for `rest` of it, eased (lifts, ferries).
export function pingPong(t: number, period: number, rest = 0.2) {
  const p = ((t % period) + period) % period / period;
  const move = (1 - 2 * rest) / 2;
  let s: number;
  if (p < rest / 2) s = 0;
  else if (p < rest / 2 + move) s = (p - rest / 2) / move;
  else if (p < rest / 2 + move + rest) s = 1;
  else if (p < 1 - rest / 2) s = 1 - (p - rest / 2 - move - rest) / move;
  else s = 0;
  return s * s * (3 - 2 * s);
}
