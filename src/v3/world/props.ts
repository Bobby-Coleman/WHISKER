// Field props built in code (v3): shields, spears, swords, helmets, barrels, crates, sacks, carts and wagons, fallen
// soldiers. A Batch gathers every static piece by material and merges them, so a whole battlefield of wreckage is a
// few draw calls; colliders are added from the same numbers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toy, metal, PAL, col } from '../render/materials';
import { RAPIER, Physics, L } from '../physics';

type MatKey = 'paint' | 'metal';
const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };
function tint(g: THREE.BufferGeometry, c: THREE.Color) {
  g = strip(g);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export class Batch {
  // Pieces bucketed by ground cell (cell > 0) so a wide scatter is culled per cell, by the view and by the shadow
  // camera, instead of drawing the whole field every pass.
  private parts = new Map<string, THREE.BufferGeometry[]>();
  constructor(public physics?: Physics, public cell = 0) {}
  // A piece in local space placed by a matrix.
  add(g: THREE.BufferGeometry, color: string, m: THREE.Matrix4, kind: MatKey = 'paint') {
    const c = this.cell > 0 ? `${Math.floor(m.elements[12] / this.cell)},${Math.floor(m.elements[14] / this.cell)}` : '0';
    const key = `${kind}|${c}`;
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(tint(g.clone(), col(color)).applyMatrix4(m));
  }
  collide(center: THREE.Vector3, half: THREE.Vector3, q?: THREE.Quaternion, member = L.detail) {
    this.physics?.addBox(center, half, q, { kind: 'wood' }, member);
  }
  build() {
    const g = new THREE.Group(); g.name = 'Props';
    const mats: Record<MatKey, THREE.Material> = { paint: toy('#ffffff', { vertexColors: true, rough: 0.85 }), metal: metal('#ffffff', 0.35, undefined, true) };
    for (const [key, list] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(list)!, mats[key.split('|')[0] as MatKey]);
      m.castShadow = true; m.receiveShadow = true;
      m.geometry.computeBoundingSphere();
      g.add(m);
    }
    this.parts.clear();
    return g;
  }
}

const M = (p: THREE.Vector3, yaw = 0, pitch = 0, roll = 0, s = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(s, s, s));
const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(a, b);

// A round shield, face up on the ground or leaning; painted halves with a boss.
export function shield(b: Batch, m: THREE.Matrix4, colors: [string, string] = [PAL.bannerRed, PAL.cream]) {
  const disc = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20, 1, false, 0, Math.PI);
  b.add(disc, colors[0], m);
  b.add(disc, colors[1], mul(m, M(new THREE.Vector3(), Math.PI)));
  b.add(new THREE.TorusGeometry(0.32, 0.02, 4, 24).rotateX(Math.PI / 2), PAL.steelDark, m, 'metal');
  b.add(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), PAL.steel, mul(m, M(new THREE.Vector3(0, 0.02, 0))), 'metal');
}
// A spear stuck in the ground at a lean.
export function spear(b: Batch, at: THREE.Vector3, yaw: number, lean: number, broken = false) {
  const m = M(at, yaw, lean);
  const len = broken ? 0.9 : 2.0;
  b.add(new THREE.CylinderGeometry(0.018, 0.022, len, 6).translate(0, len / 2 - 0.2, 0), PAL.wood, m);
  if (!broken) b.add(new THREE.ConeGeometry(0.04, 0.2, 6).translate(0, len - 0.1, 0), PAL.steel, m, 'metal');
}
export function sword(b: Batch, m: THREE.Matrix4) {
  b.add(new THREE.BoxGeometry(0.05, 0.012, 0.8).translate(0, 0, 0.45), PAL.steel, m, 'metal');
  b.add(new THREE.BoxGeometry(0.22, 0.03, 0.04), PAL.gold, m);
  b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6).rotateX(Math.PI / 2).translate(0, 0, -0.1), PAL.leather, m);
}
export function helmet(b: Batch, m: THREE.Matrix4) {
  b.add(new THREE.CylinderGeometry(0.13, 0.14, 0.24, 14).translate(0, 0.12, 0), PAL.steel, m, 'metal');
  b.add(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 14).translate(0, 0.24, 0), PAL.steelDark, m, 'metal');
}
export function barrel(b: Batch, m: THREE.Matrix4) {
  const g = new THREE.CylinderGeometry(0.28, 0.28, 0.75, 14, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 0.375; const k = 1 + 0.12 * (1 - y * y); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  g.computeVertexNormals();
  b.add(g, PAL.wood, m);
  for (const y of [-0.25, 0.25]) b.add(new THREE.TorusGeometry(0.3, 0.018, 4, 18).rotateX(Math.PI / 2).translate(0, y, 0), PAL.steelDark, m, 'metal');
}
export function crate(b: Batch, m: THREE.Matrix4, s = 0.7) {
  b.add(new THREE.BoxGeometry(s, s, s), PAL.wood, m);
  for (const ax of [0, 1]) for (const sgn of [-1, 1]) b.add(new THREE.BoxGeometry(ax ? s * 1.02 : 0.08, s * 1.02, ax ? 0.08 : s * 1.02).translate(ax ? 0 : sgn * s * 0.4, 0, ax ? sgn * s * 0.4 : 0), PAL.woodDark, m);
}
export function sack(b: Batch, m: THREE.Matrix4) {
  b.add(new THREE.SphereGeometry(0.25, 10, 8).scale(1, 0.75, 0.8), '#c9b48a', m);
}
// A cart wheel standing or lying.
export function wheel(b: Batch, m: THREE.Matrix4, r = 0.5) {
  b.add(new THREE.TorusGeometry(r, 0.05, 6, 20), PAL.woodDark, m);
  for (let i = 0; i < 6; i++) b.add(new THREE.BoxGeometry(0.04, r * 2, 0.03).rotateZ((i / 6) * Math.PI), PAL.wood, m);
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8).rotateX(Math.PI / 2), PAL.woodDark, m);
}
// A fallen soldier: a toy figure lying on its back or front, helmet, tabard in a house colour, a shield nearby.
export function fallen(b: Batch, at: THREE.Vector3, yaw: number, house: string, onFront = false) {
  const m = M(at, yaw);
  const body = new THREE.CapsuleGeometry(0.2, 0.55, 4, 10).rotateX(Math.PI / 2).scale(1.15, 0.75, 1);
  b.add(body, house, mul(m, M(new THREE.Vector3(0, 0.17, 0))));
  b.add(new THREE.BoxGeometry(0.36, 0.06, 0.4).translate(0, 0.3, 0.05), PAL.steel, m, 'metal');
  // Legs.
  for (const s of [-1, 1]) b.add(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8).rotateX(Math.PI / 2).translate(s * 0.11, 0.09, -0.62), PAL.clothDark, mul(m, M(new THREE.Vector3(), 0, 0, 0)));
  for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.085, 8, 6).scale(1, 0.8, 1.5).translate(s * 0.11, 0.08, -0.98), PAL.leather, m);
  // Arms flung out.
  b.add(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8).rotateZ(Math.PI / 2).translate(0.42, 0.1, 0.32), house, mul(m, M(new THREE.Vector3(), onFront ? 0.4 : -0.3)));
  b.add(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8).rotateZ(Math.PI / 2).translate(-0.42, 0.1, 0.2), house, mul(m, M(new THREE.Vector3(), onFront ? -0.2 : 0.5)));
  // Helmet (the head inside).
  helmet(b, mul(m, M(new THREE.Vector3(0.02, 0.13, 0.62), 0, Math.PI / 2 + (onFront ? 0.2 : -0.2), 0.3)));
  b.collide(new THREE.Vector3(at.x, at.y + 0.18, at.z), new THREE.Vector3(0.3, 0.18, 0.75), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
}
// An overturned cart: bed on its side, a wheel in the air, one lying; collider boxes from the same shapes.
export function overturnedCart(b: Batch, at: THREE.Vector3, yaw: number) {
  const m = M(at, yaw);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  // The bed on its long side: 2.4 long, 1.1 high (was its width), 0.5 deep (its sides).
  b.add(new THREE.BoxGeometry(2.4, 1.1, 0.08).translate(0, 0.6, 0), PAL.wood, m);
  b.add(new THREE.BoxGeometry(2.4, 0.08, 0.5).translate(0, 1.12, 0.25), PAL.woodDark, m);
  b.add(new THREE.BoxGeometry(2.4, 0.08, 0.5).translate(0, 0.08, 0.25), PAL.woodDark, m);
  for (const x of [-1.15, 1.15]) b.add(new THREE.BoxGeometry(0.08, 1.1, 0.5).translate(x, 0.6, 0.25), PAL.woodDark, m);
  wheel(b, mul(m, M(new THREE.Vector3(0.75, 1.3, -0.2), 0, Math.PI / 2, 0)), 0.48);
  wheel(b, mul(m, M(new THREE.Vector3(-1.6, 0.06, 0.6), 0, Math.PI / 2, 0)), 0.48);
  b.add(new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0.3, 0.3, -0.9), PAL.woodDark, mul(m, M(new THREE.Vector3(), 0.3, 0, 0)));
  b.collide(new THREE.Vector3(0, 0.6, 0.22).applyMatrix4(m), new THREE.Vector3(1.22, 0.6, 0.3), q);
}
// A covered wagon on its side (the kitten's family's): a hoop canvas and wheels.
export function wagonOnSide(b: Batch, at: THREE.Vector3, yaw: number) {
  const m = M(at, yaw);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  b.add(new THREE.BoxGeometry(3.2, 1.3, 0.1).translate(0, 0.65, 0), PAL.wood, m);
  b.add(new THREE.BoxGeometry(3.2, 0.1, 0.55).translate(0, 1.3, 0.28), PAL.woodDark, m);
  // The canvas hood lying over on the ground.
  const hood = new THREE.CylinderGeometry(0.95, 0.95, 3.0, 16, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.75, 1);
  b.add(hood, '#e9dcc0', mul(m, M(new THREE.Vector3(0, 0.66, 0.95), 0, 0, 0)));
  for (const x of [-1.1, 1.1]) wheel(b, mul(m, M(new THREE.Vector3(x, 1.0, -0.15), 0, Math.PI / 2, 0)), 0.55);
  b.collide(new THREE.Vector3(0, 0.66, 0.4).applyMatrix4(m), new THREE.Vector3(1.6, 0.66, 0.6), q, L.world);
}
export { M, mul };
