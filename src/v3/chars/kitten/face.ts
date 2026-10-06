// Her head, shared by both of her forms (the bare four-legged kitten and the little knight): a big, very round, very
// fluffy ball of light golden-fawn tabby fur with soft darker stripes on the brow and crown, a cream muzzle and chin,
// white whiskers, rounded ears with peach insides, huge dark glossy eyes that look a little sad (the upper lids droop
// at their outer corners), a small peach-pink nose and a pale pink bow toward her left ear. Fluff stands out all round
// her cheeks and the back of her head in soft chunky tufts (the silhouette, not strands).
//
// The head is made in its own space (origin at the centre of the skull ball, +z her face, +x her left, y up) at
// `size` (1: about 0.15 m across the fluff). Its moving pieces are joints under `centre`: ears, eyes (a blink squashes
// the eye), lids, jaw (the mouth) and the bow (scaled away when she has none). The caller bakes `parts` (geometry in
// centre space) onto its skinned meshes, each part riding `joint`.
import * as THREE from 'three';
import { SDF, ellipsoid, cone, union, smin, starMesh, sphereTopo, revolveZ, paint, merge, sstep } from './geo';

const C = (hex: string) => new THREE.Color(hex);
// The photo's coat, lifted for our light (it was shot in fog): hue and contrast kept.
export const FUR = {
  fawn: C('#d5b18d'), fawnD: C('#ad8866'), fawnDD: C('#8f6c52'), cheek: C('#e7d1b7'), cream: C('#f2e8da'), white: C('#fbf7f0'),
  nose: C('#dd9d8e'), noseHi: C('#f0bdb1'), earIn: C('#ebb6a3'), lash: C('#3a2a22'), mouth: C('#4a2422'), tongue: C('#d77a86'),
  eye: C('#2a1c17'), pupil: C('#0b0707'), bow: C('#f6c5cd'), bowD: C('#e09aaa'), whisker: C('#fbf8f2'),
};
const mix = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) => out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

export const HEAD = {
  eye: new THREE.Vector3(0.0275, -0.004, 0.0435), eyeR: 0.0188, ear: new THREE.Vector3(0.036, 0.042, -0.012),
  jaw: new THREE.Vector3(0, -0.0305, 0.0505), bow: new THREE.Vector3(0.024, 0.06, 0.012),
};

export type FacePart = { geo: THREE.BufferGeometry; joint: THREE.Object3D; kind: 'fur' | 'eye' | 'glint' };

export class KittenFace {
  ears: THREE.Group[] = []; eyes: THREE.Group[] = []; lids: THREE.Group[] = []; jaw = new THREE.Group(); bow = new THREE.Group();
  parts: FacePart[] = [];
  // The face's own joints (to add to a skeleton).
  get joints(): THREE.Object3D[] { return [...this.ears, ...this.eyes, ...this.lids, this.jaw, this.bow]; }
  private lidRoll = 0.24;

  // `centre`: the joint at the middle of the head (its local frame is the head's space at rest).
  constructor(public centre: THREE.Object3D, public size = 1) {
    const s = size, at = (g: THREE.Group, parent: THREE.Object3D, p: THREE.Vector3, name: string) => { g.position.copy(p); g.name = name; parent.add(g); return g; };
    for (const side of [1, -1]) {
      this.ears.push(at(new THREE.Group(), centre, new THREE.Vector3(HEAD.ear.x * side, HEAD.ear.y, HEAD.ear.z).multiplyScalar(s), side > 0 ? 'earL' : 'earR'));
      const eye = at(new THREE.Group(), centre, new THREE.Vector3(HEAD.eye.x * side, HEAD.eye.y, HEAD.eye.z).multiplyScalar(s), side > 0 ? 'eyeL' : 'eyeR');
      eye.rotation.set(-0.04, 0.32 * side, 0);
      eye.scale.set(1, 1.06, 0.9);
      this.eyes.push(eye);
      this.lids.push(at(new THREE.Group(), eye, new THREE.Vector3(), side > 0 ? 'lidL' : 'lidR'));
    }
    at(this.jaw, centre, HEAD.jaw.clone().multiplyScalar(s), 'jaw');
    at(this.bow, centre, HEAD.bow.clone().multiplyScalar(s), 'bow');
    this.bow.rotation.set(-0.35, 0.2, -0.42);
    centre.updateMatrixWorld(true);
  }

  build() {
    const s = this.size, parts = this.parts;
    // In centre space, from a joint's own space at rest.
    const toCentre = (j: THREE.Object3D) => {
      const m = new THREE.Matrix4();
      for (let o: THREE.Object3D | null = j; o && o !== this.centre; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
      return m;
    };
    const add = (g: THREE.BufferGeometry, joint: THREE.Object3D, kind: FacePart['kind'] = 'fur', local = false) => {
      if (local) g.applyMatrix4(toCentre(joint));
      parts.push({ geo: g, joint, kind });
    };

    // ---- The fluffy ball: a round skull, full cheeks, a little muzzle, and tufts all round its edge.
    const tufts: SDF[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    const N = 96;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const d = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
      // Not over the face, not under the chin (the neck), fewer on top.
      const face = d.z > 0.35 && d.y > -0.75 && Math.abs(d.x) < 0.78 - Math.max(0, -d.y) * 0.25;
      if (face || d.y < -0.8) continue;
      // The back of her head is a smooth round ball (tufts there read as a burr): fluff only round its outline.
      if (d.z < -0.25 && Math.abs(d.x) < 0.55 && d.y < 0.75) continue;
      // Fur lies back and down: the tip swept away from the face.
      const tip = d.clone().add(new THREE.Vector3(0, -0.18, -0.22)).normalize();
      // Round the back and top of her head the fluff is short and soft (a ball, not a burr); out at her cheeks longer.
      const cheek = Math.abs(d.x) > 0.6 && d.y < 0.1 && d.z > -0.3;
      const len = (cheek ? 0.0725 : 0.0648) + 0.0035 * Math.sin(i * 7.31);
      tufts.push(cone(d.x * 0.042, d.y * 0.04, d.z * 0.042, tip.x * len * 0.97, tip.y * len * 0.93, tip.z * len * 0.97, cheek ? 0.0125 : 0.0155, cheek ? 0.0062 : 0.0085));
    }
    // The cheek ruff: bigger soft points out of the lower cheeks, as the photo's.
    for (const sd of [1, -1]) for (const [a, b, r] of [[[0.04, -0.02, 0.018], [0.074, -0.03, 0.008], 0.014], [[0.038, -0.032, 0.012], [0.068, -0.048, 0.0], 0.013], [[0.03, -0.04, 0.008], [0.052, -0.06, -0.006], 0.012]] as [number[], number[], number][])
      tufts.push(cone(a[0] * sd, a[1], a[2], b[0] * sd, b[1], b[2], r, 0.0032));
    const tuft = union(0.004, ...tufts);
    const base = union(0.014, ellipsoid(0, 0.004, -0.006, 0.0605, 0.0575, 0.0595), ellipsoid(0, -0.016, 0.008, 0.061, 0.043, 0.047));
    const pads = union(0.004, ellipsoid(0.0085, -0.0255, 0.046, 0.0118, 0.0095, 0.0095), ellipsoid(-0.0085, -0.0255, 0.046, 0.0118, 0.0095, 0.0095), ellipsoid(0, -0.0345, 0.04, 0.0098, 0.008, 0.0088));
    const headSDF: SDF = (x, y, z) => smin(smin(base(x, y, z), pads(x, y, z), 0.008), tuft(x, y, z), 0.013);
    const scaled: SDF = (x, y, z) => headSDF(x / s, y / s, z / s) * s;
    const hg = starMesh(scaled, new THREE.Vector3(0, -0.01 * s, -0.004 * s), 56, 40, { axis: 'z', rMax: 0.2 * s });
    paint(hg, (P, n, out) => {
      const p = _p.copy(P).multiplyScalar(1 / s);
      const r = p.length();
      out.copy(FUR.fawn);
      // Darker over the crown and the back of the head, paler cheeks, cream muzzle, chin and throat.
      out.lerp(FUR.fawnD, sstep(0.0, 0.045, p.y) * 0.45 + sstep(0.0, -0.05, p.z) * 0.25);
      mix(out, FUR.cheek, sstep(0.025, 0.05, Math.abs(p.x)) * sstep(0.004, -0.02, p.y) * 0.85, out);
      const muzzle = sstep(0.026, 0.04, p.z) * sstep(-0.006, -0.018, p.y) * sstep(0.03, 0.018, Math.abs(p.x));
      const chin = sstep(-0.026, -0.042, p.y) * sstep(-0.01, 0.02, p.z);
      out.lerp(FUR.cream, Math.max(muzzle, chin * 0.9));
      // Pale round the eyes, as hers are.
      const ex = Math.abs(p.x) - HEAD.eye.x, ey = p.y - HEAD.eye.y;
      const nearEye = sstep(0.03, 0.018, Math.hypot(ex, ey * 1.1)) * sstep(0.02, 0.035, p.z);
      out.lerp(FUR.cheek, nearEye * 0.5);
      // Tabby: soft dark stripes up the brow and back over the crown (three middle, a curve each side), and a
      // little dark stroke over each eye slanting up toward the middle (her sad brows).
      const crown = sstep(0.008, 0.026, p.y) * sstep(0.058, 0.03, p.z + Math.max(0, p.y - 0.03) * 0.3);
      const ax = Math.abs(p.x);
      const st = Math.max(sstep(0.0042, 0.0012, ax), sstep(0.0036, 0.001, Math.abs(ax - 0.0125 - Math.max(0, -p.z) * 0.1)), sstep(0.0032, 0.001, Math.abs(ax - 0.026 - Math.max(0, -p.z) * 0.18)) * 0.8);
      out.lerp(FUR.fawnDD, crown * st * 0.62);
      const brow = sstep(0.0035, 0.001, Math.abs(p.y - (0.0135 + (0.034 - ax) * 0.22))) * sstep(0.012, 0.018, ax) * sstep(0.04, 0.03, ax) * sstep(0.028, 0.04, p.z);
      out.lerp(FUR.fawnDD, brow * 0.45);
      // Stripes on the cheeks sweeping back from the outer corner of each eye.
      const cs = sstep(0.0035, 0.001, Math.abs(p.y + 0.004 + (ax - 0.045) * 0.35)) * sstep(0.044, 0.054, ax) * sstep(0.03, -0.01, p.z);
      out.lerp(FUR.fawnD, cs * 0.6);
      // The tufts' tips a shade lighter (fur catching the light).
      out.lerp(FUR.cheek, sstep(0.066, 0.078, r) * 0.35);
      void n;
      return out;
    });
    add(hg, this.centre);

    // ---- Nose: small, peach-pink, a soft rounded triangle.
    const ny = -0.0175, nz = 0.0565;
    const nose = starMesh((x, y, z) => { const w = 0.0068 * (0.72 + 0.4 * Math.min(1, Math.max(-1, (y / s - ny) / 0.0045))); return (Math.hypot(x / s / w, (y / s - ny) / 0.0043, (z / s - nz) / 0.0042) - 1) * 0.0042 * s; },
      new THREE.Vector3(0, ny * s, nz * s), 14, 10, { axis: 'z' });
    paint(nose, (p, _n, out) => mix(FUR.nose, FUR.noseHi, sstep(-0.016, -0.0135, p.y / s) * sstep(0.057, 0.06, p.z / s) * 0.7, out));
    add(nose, this.centre);
    // Whiskers: three a side, fine and white, out from the muzzle.
    for (const sd of [1, -1]) for (let k = 0; k < 3; k++) {
      const a = new THREE.Vector3(0.015 * sd, -0.024 - k * 0.0028, 0.05).multiplyScalar(s);
      const dir = new THREE.Vector3(sd, 0.12 - k * 0.14, 0.2 - k * 0.05).normalize();
      const len = (0.036 + 0.004 * (1 - Math.abs(k - 1))) * s;
      const w = new THREE.CylinderGeometry(0.00035 * s, 0.0007 * s, len, 4, 1);
      w.deleteAttribute('uv');
      w.translate(0, len / 2, 0);
      w.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      // Drooping a little toward their tips.
      const pa = w.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) { const t = Math.hypot(pa.getX(i), pa.getY(i), pa.getZ(i)) / len; pa.setY(i, pa.getY(i) - t * t * 0.006 * s); }
      w.translate(a.x, a.y, a.z);
      w.computeVertexNormals();
      paint(w, (_p, _n, out) => out.copy(FUR.whisker));
      add(toIndexed(w), this.centre);
    }

    // ---- Ears: rounded, smallish, cupped, peach inside with cream fluff at the base, fawn outside.
    for (let k = 0; k < 2; k++) {
      const eg = sphereTopo(14, 10, (u, v, out) => {
        const th = u * Math.PI * 2;
        const prof = Math.sin(Math.PI / 2 * Math.min(1, v / 0.14)) * Math.pow(Math.max(0, 1 - v), 0.62) * (1 - 0.12 * v);
        const w = 0.0225 * prof, d = 0.0095 * prof, sn = Math.sin(th);
        return out.set(Math.cos(th) * w, -0.014 + 0.046 * v, sn >= 0 ? -0.35 * d * sn : d * sn).multiplyScalar(s);
      });
      paint(eg, (P, n, out) => {
        const p = _p.copy(P).multiplyScalar(1 / s);
        const v = (p.y + 0.014) / 0.046, w = 0.0225 * Math.pow(Math.max(0, 1 - v), 0.62) + 1e-4;
        const inner = sstep(0.1, 0.5, n.z) * sstep(0.85, 0.55, Math.abs(p.x) / w) * sstep(0.08, 0.22, v) * sstep(0.95, 0.78, v);
        mix(FUR.fawnD, FUR.fawnDD, sstep(0.6, 1, v) * 0.5, out);
        out.lerp(FUR.earIn, inner);
        return out.lerp(FUR.cream, inner * sstep(0.4, 0.12, v) * 0.85);
      });
      add(eg, this.ears[k], 'fur', true);
    }

    // ---- Lids: fur shells over the eyes with a dark lash line; rolled so their outer corners droop (sad eyes).
    const ER = HEAD.eyeR * s;
    for (let k = 0; k < 2; k++) {
      const R = ER * 1.085, PH = Math.PI / 2 + 0.12;
      const lg = openCap(R, PH, 18, 7);
      paint(lg, (p, _n, out) => mix(FUR.fawn, FUR.lash, sstep(PH - 0.34, PH - 0.2, Math.acos(Math.max(-1, Math.min(1, p.z / R)))), out));
      add(lg, this.lids[k], 'fur', true);
    }
    // ---- Mouth: a small dark oval the jaw scales open.
    const mg = starMesh(ellipsoid(0, 0, 0, 0.0074 * s, 0.0072 * s, 0.0072 * s), new THREE.Vector3(), 12, 8, { axis: 'z' });
    paint(mg, (p, _n, out) => mix(FUR.mouth, FUR.tongue, sstep(-0.002 * s, -0.0052 * s, p.y), out));
    add(mg, this.jaw, 'fur', true);
    // ---- Bow: two soft loops, a knot, two short tails.
    add(bowGeo(s), this.bow, 'fur', true);

    // ---- Eyes: big, round, very dark and glossy, two catchlights each (the same light for both).
    for (let k = 0; k < 2; k++) {
      const eye = this.eyes[k];
      const e = new THREE.SphereGeometry(ER, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(Math.PI / 2);
      e.deleteAttribute('uv');
      paint(e, (p, _n, out) => mix(FUR.eye, FUR.pupil, sstep(0.5, 0.9, p.z / ER), out));
      add(e, eye, 'eye', true);
      eye.updateMatrix();
      const inv = new THREE.Matrix3().setFromMatrix4(eye.matrix).invert();
      for (const [dx, dy, r] of [[-0.34, 0.4, 0.0038], [0.32, -0.36, 0.0018]]) {
        const d = new THREE.Vector3(dx, dy, 1).applyMatrix3(inv).normalize();
        const g = new THREE.CircleGeometry(r * s, 10);
        g.deleteAttribute('uv');
        g.lookAt(d);
        g.translate(d.x * (ER + 0.0004 * s), d.y * (ER + 0.0004 * s), d.z * (ER + 0.0004 * s));
        paint(g, (_p, _n, out) => out.setRGB(1, 1, 1));
        add(g, eye, 'glint', true);
      }
    }
  }

  // The face for a frame: lids (0 open .. 1 shut, below 0 wide), mouth (0 shut .. 1 open), ears (x laid back, y turned
  // out, z drooped) and a twitch per ear (0..1).
  pose(lid: number, mouth: number, ear: THREE.Vector3, twitch: [number, number], glints: THREE.Material | null) {
    const s = this.size;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1, tw = twitch[k];
      this.ears[k].rotation.set(-0.08 - ear.x - tw * 0.45, side * (0.22 + ear.y + tw * 0.25), -side * (0.42 + ear.z * 0.6 + ear.x * 0.25), 'ZYX');
    }
    const l = THREE.MathUtils.clamp(lid, -0.15, 1), sq = 1 - 0.86 * sstep(0.25, 1, l);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1, e = this.eyes[k];
      // Resting a little lowered at the outer corner: sad, soft eyes.
      this.lids[k].rotation.set(l < 0 ? THREE.MathUtils.lerp(-2.45, -2.75, -l / 0.15) : THREE.MathUtils.lerp(-2.45, -1.25, l), 0, -side * this.lidRoll, 'ZXY');
      e.scale.set(1, 1.06 * sq, 0.9);
      e.position.set(HEAD.eye.x * side * s, HEAD.eye.y * s, HEAD.eye.z * s).add(_p.set(0, -0.4 * HEAD.eyeR * s * 1.06 * (1 - sq), 0).applyQuaternion(e.quaternion));
    }
    if (glints) glints.visible = l < 0.55;
    const o = THREE.MathUtils.clamp(mouth, 0, 1.2);
    this.jaw.scale.set(0.5 + 0.45 * o, 0.08 + 0.92 * o, 0.55 + 0.45 * o);
    this.jaw.position.y = (HEAD.jaw.y - 0.003 * o) * s;
  }

  // Shown or folded away (no bow).
  showBow(on: boolean) { this.bow.scale.setScalar(on ? 1 : 1e-4); }
}

const _p = new THREE.Vector3();

// An open spherical cap round +z: radius R, from the pole out to polar angle PH, facing out.
function openCap(R: number, PH: number, nu: number, nv: number) {
  const pos: number[] = [0, 0, R], idx: number[] = [];
  for (let j = 1; j <= nv; j++) for (let i = 0; i < nu; i++) {
    const ph = (j / nv) * PH, th = (i / nu) * Math.PI * 2;
    pos.push(Math.sin(ph) * Math.cos(th) * R, Math.sin(ph) * Math.sin(th) * R, Math.cos(ph) * R);
  }
  const at = (j: number, i: number) => 1 + (j - 1) * nu + (i % nu);
  for (let i = 0; i < nu; i++) idx.push(0, at(1, i + 1), at(1, i));
  for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) idx.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Facing out: flip any triangle whose normal points at the centre.
  const p = pos, ix = idx;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (p[a] + p[b] + p[c]) + ny * (p[a + 1] + p[b + 1] + p[c + 1]) + nz * (p[a + 2] + p[b + 2] + p[c + 2]) < 0) { const sw = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = sw; }
  }
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function toIndexed(g: THREE.BufferGeometry) {
  if (g.index) return g;
  const n = g.attributes.position.count, idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

// A cone of soft fur (or ribbon) from a to b, base radius r.
export function tuftGeo(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const L = a.distanceTo(b);
  const g = revolveZ([[-r * 0.7, 0, 0], [-r * 0.45, r * 0.75, r * 0.75], [0, r, r], [L * 0.3, r * 0.92, r * 0.92], [L * 0.58, r * 0.7, r * 0.7], [L * 0.8, r * 0.42, r * 0.42], [L * 0.94, r * 0.18, r * 0.18], [L, 0, 0]], 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// The bow: two soft loops pinched to a knot, two short tails; pale pink with deeper folds toward the knot.
function bowGeo(s: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (const sd of [1, -1]) {
    const g = starMesh(ellipsoid(0, 0, 0, 0.0108, 0.0074, 0.0038), new THREE.Vector3(), 12, 8, { axis: 'x' });
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), k = 0.45 + 0.55 * sstep(-0.0108, 0.004, x); p.setY(i, p.getY(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals();
    g.translate(0.0098, 0, 0);
    g.rotateZ(0.22);
    if (sd < 0) { g.scale(-1, 1, 1); (g.index!.array as any).reverse(); g.computeVertexNormals(); }
    paint(g, (q, _n, out) => mix(FUR.bowD, FUR.bow, sstep(0.002, 0.01, Math.abs(q.x)), out));
    parts.push(g);
  }
  const knot = starMesh(ellipsoid(0, 0, 0, 0.0042, 0.0048, 0.0042), new THREE.Vector3(), 10, 6);
  paint(knot, (_q, _n, out) => out.copy(FUR.bowD).lerp(FUR.bow, 0.35));
  parts.push(knot.translate(0, 0, 0.0012));
  for (const sd of [1, -1]) {
    const g = tuftGeo(new THREE.Vector3(0.0015 * sd, -0.002, 0), new THREE.Vector3(0.0072 * sd, -0.0135, 0.001), 0.0026);
    g.scale(1, 1, 0.55);
    paint(g, (_q, _n, out) => out.copy(FUR.bow));
    parts.push(g);
  }
  const g = merge(parts);
  g.scale(s, s, s);
  return g;
}
