// Building levels in code (engine v2): each piece makes its mesh and its collider together, so what you see is what
// you stand on. Blocks are softly bevelled in a painted, stylized material: the colour drifts slowly across the world
// so repeated pieces never match, tops catch a little more light than sides, and the characters' contact occlusion
// darkens the ground at their feet.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { positionWorld, normalWorld, smoothstep, color, floor, fract, min, mix, hash, vec2, abs, float, step } from 'three/tsl';
import { bakedNoise } from '../render/noisetex';
import { characterAO } from '../render/occlusion';
import { createIvy } from '../world/ivy';
import { RAPIER, Physics, L, Surface, Platform, Prop } from './physics';

const mats = new Map<string, THREE.MeshStandardNodeMaterial>();

// Hand-laid stones of about a given size over a 2D coordinate: rows offset from one another, and about half the
// stones split again at a random point, so lengths vary along a row. Returns each stone's own tone and a joint
// mask (0 in the mortar).
function stones(p: any, size: number) {
  const q = p.div(size);
  const row = floor(q.y);
  const rh = hash(row.add(8192));
  const x = q.x.add(rh.mul(0.9)).add(row.mul(0.37));
  const cell = floor(x), fx = fract(x), fy = fract(q.y);
  const id = cell.add(8192).add(row.add(8192).mul(1531));
  const split = hash(id.add(77)).mul(0.4).add(0.3);
  const halves = step(0.45, hash(id.add(31))); // 1 where the stone stays whole
  const toSplit = mix(abs(fx.sub(split)), float(1), halves);
  const ex = min(min(fx, float(1).sub(fx)), toSplit).mul(size);
  const ey = min(fy, float(1).sub(fy)).mul(size);
  const joint = smoothstep(0.008, 0.03, min(ex, ey));
  const part = mix(step(split, fx), float(0), halves);
  const tone = hash(id.mul(2).add(part).add(5)).mul(0.3).add(0.84);
  return { joint, tone };
}

// A painted colour (sRGB hex) with slow world-space variation, lighter tops and contact occlusion. With `tiles`
// (a stone size in metres) tops are laid as flagstones and sides as coursed masonry, joints dark and rough.
export function paintMaterial(hex: string, rough = 0.86, vary = 1, tiles = 0) {
  const key = `${hex}|${rough}|${vary}|${tiles}`;
  let m = mats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardNodeMaterial();
  const wp = positionWorld;
  const broad = bakedNoise(wp.xz.mul(0.09).add(wp.y.mul(0.05))).g.mul(0.5).add(0.5);
  const fine = bakedNoise(wp.xz.mul(1.7).add(wp.yz.mul(1.1))).b.mul(0.5).add(0.5);
  const top = smoothstep(0.55, 0.95, normalWorld.y);
  let c: any = color(hex).mul(broad.mul(0.18 * vary).add(1 - 0.09 * vary)).mul(fine.mul(0.08 * vary).add(1 - 0.04 * vary)).mul(top.mul(0.08).add(0.96));
  if (tiles > 0) {
    const flat = stones(wp.xz, tiles);
    // Sides: courses half a stone high, running along whichever horizontal axis the face spans.
    const along = mix(wp.x, wp.z, smoothstep(0.4, 0.6, abs(normalWorld.x)));
    const side = stones(vec2(along, wp.y.mul(2)), tiles);
    const joint = mix(side.joint, flat.joint, top), tone = mix(side.tone, flat.tone, top);
    c = c.mul(tone).mul(mix(float(0.62), float(1), joint));
    m.roughnessNode = mix(float(0.97), float(rough), joint);
  }
  m.colorNode = c;
  m.roughness = rough;
  m.metalness = 0;
  m.aoNode = characterAO(positionWorld, normalWorld);
  mats.set(key, m);
  return m;
}

export type PieceOpts = { color?: string; rough?: number; tiles?: number; surface?: Surface; member?: number; bevel?: number; cast?: boolean; name?: string };
type V3 = [number, number, number];

export class LevelBuilder {
  root = new THREE.Group();
  constructor(public physics: Physics) { this.root.name = 'Level'; }

  private mesh(geo: THREE.BufferGeometry, o: PieceOpts) {
    const m = new THREE.Mesh(geo, paintMaterial(o.color ?? '#9a958a', o.rough, 1, o.tiles ?? 0));
    m.castShadow = o.cast ?? true; m.receiveShadow = true;
    if (o.name) m.name = o.name;
    return m;
  }

  // A block standing on `at` (the centre of its base), size w × h × d, turned `yaw` about the vertical.
  box(at: V3, size: V3, yaw = 0, o: PieceOpts = {}) {
    const [w, h, d] = size;
    const bevel = o.bevel ?? Math.min(0.06, Math.min(w, h, d) * 0.18);
    const m = this.mesh(new RoundedBoxGeometry(w, h, d, 2, bevel), o);
    m.position.set(at[0], at[1] + h / 2, at[2]);
    m.rotation.y = yaw;
    this.root.add(m);
    const q = new THREE.Quaternion().setFromEuler(m.rotation);
    this.physics.addBox(m.position, new THREE.Vector3(w / 2, h / 2, d / 2), q, o.surface, o.member ?? L.world);
    return m;
  }

  // A ramp: its low edge centred at `at`, rising `rise` over a horizontal `run` toward yaw, `width` across.
  ramp(at: V3, width: number, run: number, rise: number, yaw: number, o: PieceOpts = {}) {
    const len = Math.hypot(run, rise), a = Math.atan2(rise, run), t = 0.3;
    const m = this.mesh(new RoundedBoxGeometry(width, t, len, 2, Math.min(0.05, t * 0.3)), o);
    m.rotation.set(-a, yaw, 0, 'YXZ');
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const n = new THREE.Vector3(0, Math.cos(a), 0).addScaledVector(dir, -Math.sin(a));
    m.position.set(at[0], at[1], at[2]).addScaledVector(dir, run / 2).add(new THREE.Vector3(0, rise / 2, 0)).addScaledVector(n, -t / 2);
    this.root.add(m);
    this.physics.addBox(m.position, new THREE.Vector3(width / 2, t / 2, len / 2), new THREE.Quaternion().setFromEuler(m.rotation), o.surface, o.member ?? L.world);
    return m;
  }

  // Stairs: n solid steps, each `rise` high and `tread` deep, climbing toward yaw from `at` (the foot of the flight).
  stairs(at: V3, n: number, rise: number, tread: number, width: number, yaw: number, o: PieceOpts = {}) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (let i = 0; i < n; i++) {
      const c = new THREE.Vector3(at[0], at[1], at[2]).addScaledVector(dir, tread * (i + 0.5));
      this.box([c.x, c.y, c.z], [width, rise * (i + 1), tread], yaw, { bevel: 0.025, ...o });
    }
  }

  // A wall the kitten can climb: ivy on its front face (the side yaw faces) and a climbable collider.
  ivyWall(at: V3, size: V3, yaw: number, o: PieceOpts = {}, seed = 7, density = 1.1) {
    const m = this.box(at, size, yaw, { ...o, surface: { climb: true, kind: 'stone', ...o.surface } });
    const [w, h, d] = size;
    const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), t = new THREE.Vector3(n.z, 0, -n.x);
    const f = new THREE.Vector3(at[0], 0, at[2]).addScaledVector(n, d / 2 + 0.005);
    const ivy = createIvy({ ax: f.x - t.x * w / 2, az: f.z - t.z * w / 2, bx: f.x + t.x * w / 2, bz: f.z + t.z * w / 2, nx: n.x, nz: n.z, y0: at[1], y1: at[1] + h }, seed, density);
    this.root.add(ivy);
    return m;
  }

  // A block moved along a path (a function of time to a pose): lifts, ferries, turntables. Its geometry is centred
  // on the body.
  mover(geo: THREE.BufferGeometry, shapes: RAPIER.ColliderDesc[], path: Platform['path'], o: PieceOpts = {}) {
    const m = this.mesh(geo, o);
    this.root.add(m);
    return this.physics.addPlatform(m, shapes, path, o.surface, o.member ?? L.world);
  }

  moverBox(size: V3, path: Platform['path'], o: PieceOpts = {}) {
    const [w, h, d] = size;
    return this.mover(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.06, Math.min(w, h, d) * 0.18)), [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)], path, o);
  }

  // A crate the characters can push (density sets how heavy: the kitten barely moves a heavy one).
  crate(at: V3, size: number, density = 1, o: PieceOpts = {}): Prop {
    const m = this.mesh(new RoundedBoxGeometry(size, size, size, 2, size * 0.08), { color: '#a07a4c', ...o });
    this.root.add(m);
    const h = size / 2;
    return this.physics.addProp(m, RAPIER.ColliderDesc.roundCuboid(h - 0.02, h - 0.02, h - 0.02, 0.02), new THREE.Vector3(at[0], at[1] + h, at[2]), undefined, density, o.surface);
  }
}

// Easing for paths: a smooth back-and-forth with rests at both ends (period in seconds, rest as a fraction).
export function pingPong(t: number, period: number, rest = 0.2) {
  const p = ((t % period) + period) % period / period; // 0..1
  const move = (1 - 2 * rest) / 2;
  let s: number;
  if (p < rest / 2) s = 0;
  else if (p < rest / 2 + move) s = (p - rest / 2) / move;
  else if (p < rest / 2 + move + rest) s = 1;
  else if (p < 1 - rest / 2) s = 1 - (p - rest / 2 - move - rest) / move;
  else s = 0;
  return s * s * (3 - 2 * s);
}
