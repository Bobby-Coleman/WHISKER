// The little knight (her Chapter One form), as in the photo: a 0.34 m kitten standing on two short legs in full
// engraved silver plate. A big, very round, fluffy head (face.ts) on a stout armoured body: rounded layered pauldrons,
// a breastplate with a raised ridge, rerebraces, couters, vambraces and dark leather gloves in steel cuffs, a mail
// skirt under four plate tassets, a brown leather waist belt and a diagonal sword belt with buckles, poleyns, greaves
// and sabatons with her pale toes showing in front, a fluffy fawn tail, and a longsword (gold crossguard, dark grip,
// gold pommel) a little longer than she is tall.
//
// Proportions are the photo's, measured: knees 0.057 m, hips 0.09, the waist belt 0.145, shoulders 0.2, chin 0.24,
// the top of the fluff 0.34; the body about 0.12 m across at the skirt's hem.
//
// Everything is made in her own space at the skeleton's rest pose (the Quaternius mannequin given her proportions,
// avatar.ts) and baked into a few skinned meshes on one skeleton: fur and leather (toy, vertex coloured), plate (metal,
// vertex coloured: the engraving, the gold), mail (metal with a ring texture), the eyes (glossy, with catchlights).
// Her own joints ride the skeleton: the head's centre and its face joints, the pauldrons, a tail of five, the sword.
import * as THREE from 'three';
import { toy, metal, Fade } from '../../render/materials';
import { Avatar, Proportions } from '../avatar';
import { KittenFace, FUR } from './face';
import { SDF, ellipsoid, cone, union, starMesh, revolveZ, tubeRings, paint, skin, merge, sstep } from './geo';

// The mannequin's joint offsets scaled to her.
export const KITTEN_PROPS: Proportions = {
  hipRatio: 0.0984,
  scale: (p, c) => {
    if (p === 'root') return 0.0984;
    if (p === 'pelvis') return c.startsWith('thigh') ? [0.34, 0.08, 0.08] : 0.21;
    if (p === 'spine_01') return 0.245;
    if (p === 'spine_02') return 0.23;
    if (p === 'spine_03') return c.startsWith('clavicle') ? [0.4, 0.17, 0.1] : 0.245;
    if (p === 'neck_01') return 0.17;
    if (p.startsWith('clavicle')) return [0.243, 0.18, 0.06];
    if (p.startsWith('upperarm')) return 0.182;
    if (p.startsWith('lowerarm')) return 0.176;
    if (p.startsWith('hand')) return 0.1;
    if (p.startsWith('thigh')) return 0.085;
    if (p.startsWith('calf')) return 0.085;
    if (p.startsWith('foot')) return [0.2, 0.2, 0.135];
    if (p.startsWith('ball')) return 0.13;
    return 0.1;
  },
};

export const HEAD_SIZE = 0.84;
export const HEAD_OFFSET = new THREE.Vector3(0, 0.054, 0.006); // the head's centre from the Head joint, at rest
export const TAIL_N = 5, TAIL_SEG = 0.022;
// The sword: its origin at the crossguard, the blade up +y, the grip down -y.
export const SWORD = { blade: 0.3, grip: 0.046, pommel: 0.054 };
// The middle of a fist (where a grip passes through it), in the hand's canonical frame (left hand; x mirrors).
export const FIST = new THREE.Vector3(0.001, -0.0115, 0.002);

const C = (h: string) => new THREE.Color(h);
const COL = {
  steel: C('#c4c2be'), steelE: C('#5f5c58'), gold: C('#ddb560'), goldD: C('#9c7330'),
  leather: C('#70472c'), leatherD: C('#4e2f1d'), glove: C('#3b2b24'), gloveL: C('#5a4134'), grip: C('#33241d'), gripL: C('#56402f'),
  fuller: C('#6e7680'),
};
const mix = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) => out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

type Mat = 'fur' | 'gear' | 'bare' | 'steel' | 'mail' | 'eye' | 'glint';
type Weights = (p: THREE.Vector3) => [number, number, number, number];
type V3T = [number, number, number];

export type BipedModel = {
  // Fur (her body, head and tail), gear (leather: gloves, belts, the grip), bare (furry arms, shins and paws, shown
  // only without armour), plate (and the sword), mail, eyes.
  fur: THREE.SkinnedMesh; gear: THREE.SkinnedMesh; bare: THREE.SkinnedMesh; steel: THREE.SkinnedMesh; mail: THREE.SkinnedMesh; eyes: THREE.SkinnedMesh;
  glintMat: THREE.Material; face: KittenFace; headC: THREE.Group; tail: THREE.Group[]; sword: THREE.Group;
  pauldrons: THREE.Group[]; bones: THREE.Object3D[]; tris: number;
  // Rest measures for posing and the cape.
  dims: { cuiY0: number; cuiY1: number; skY0: number; skY1: number; tail0: THREE.Vector3 };
};

export function buildBiped(av: Avatar, fade: Fade): BipedModel {
  const root = av.root;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const P = (n: string) => av.restP.get(n)!.clone();
  const bone = (n: string) => av.bones[n];
  // A joint of her own at a rest position (character space), riding `parent`.
  const joint = (name: string, at: THREE.Vector3, parent: THREE.Object3D) => {
    const g = new THREE.Group(); g.name = name;
    g.position.copy(at); root.add(g); root.updateMatrixWorld(true);
    parent.attach(g);
    return g;
  };

  // ---- Her own joints on the skeleton.
  const headC = joint('headCentre', P('Head').add(HEAD_OFFSET), bone('Head'));
  const face = new KittenFace(headC, HEAD_SIZE);
  const tail0 = P('pelvis').add(new THREE.Vector3(0, -0.004, -0.045));
  const tail: THREE.Group[] = [];
  for (let i = 0; i < TAIL_N; i++) {
    if (i === 0) tail.push(joint('tail0', tail0, bone('pelvis')));
    else { const g = new THREE.Group(); g.name = 'tail' + i; g.position.set(0, 0, -TAIL_SEG); tail[i - 1].add(g); tail.push(g); }
  }
  // Pauldrons: at the shoulder joints, oriented each frame between the chest and the upper arm.
  const pauldrons = ['l', 'r'].map((s) => joint('pauldron_' + s, P(`upperarm_${s}`), bone(`clavicle_${s}`)));
  // The sword's own joint (placed each frame: in her paws, on her shoulder or on her back).
  const sword = joint('sword', new THREE.Vector3(), root);
  root.updateMatrixWorld(true);

  const bones: THREE.Object3D[] = [];
  const index = new Map<THREE.Object3D, number>();
  const B = (o: THREE.Object3D) => { let i = index.get(o); if (i === undefined) { i = bones.length; bones.push(o); index.set(o, i); } return i; };
  const parts: Record<Mat, THREE.BufferGeometry[]> = { fur: [], gear: [], bare: [], steel: [], mail: [], eye: [], glint: [] };
  const add = (m: Mat, g: THREE.BufferGeometry, w: Weights | THREE.Object3D) => {
    if (!g.index) toIndexed(g);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) paint(g, (_p, _n, o) => o.setRGB(1, 1, 1));
    if (m === 'mail' && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m !== 'mail' && g.attributes.uv) g.deleteAttribute('uv');
    skin(g, w instanceof THREE.Object3D ? B(w) : w);
    parts[m].push(g);
  };
  const two = (a: THREE.Object3D, b: THREE.Object3D, f: (p: THREE.Vector3) => number): Weights => { const ia = B(a), ib = B(b); return (p) => { const w = f(p); return [ia, 1 - w, ib, w]; }; };
  // The torso joints by height.
  const sp = [bone('pelvis'), bone('spine_01'), bone('spine_02'), bone('spine_03')].map(B);
  const spY = [P('pelvis').y + 0.006, P('spine_01').y + 0.006, P('spine_02').y + 0.008, P('spine_03').y + 0.004];
  const torsoW: Weights = (p) => {
    for (let i = 0; i < 3; i++) if (p.y < spY[i + 1]) { const w = sstep(spY[i], spY[i + 1], p.y); return [sp[i], 1 - w, sp[i + 1], w]; }
    return [sp[3], 1, 0, 0];
  };
  // A part made in a bone's canonical frame (arms hang, +z forward, +x outward for the left), brought to rest; for
  // the right side mirrored first.
  const canonRest = (g: THREE.BufferGeometry, b: string, side: number) => {
    if (side < 0) { g.scale(-1, 1, 1); flip(g); }
    const q = av.restQ.get(b)!.clone().multiply(av.canonFrame(b));
    g.applyQuaternion(q); const p = P(b); g.translate(p.x, p.y, p.z);
    g.computeVertexNormals();
    return g;
  };

  // ================= The head (face.ts): fur, eyes, catchlights.
  face.build();
  headC.updateMatrixWorld(true);
  const toRoot = rootInv.clone().multiply(headC.matrixWorld);
  for (const fp of face.parts) add(fp.kind === 'fur' ? 'fur' : fp.kind, fp.geo.applyMatrix4(toRoot), fp.joint);

  // ================= Measures.
  const cuiY0 = 0.141, cuiY1 = P('neck_01').y + 0.004;
  const skY0 = cuiY0 + 0.006, skY1 = 0.083;

  // ================= Body fur (under the plate, closing every gap), the neck's cream ruff, the tail.
  {
    const pe = P('pelvis'), s3 = P('spine_03');
    const f: SDF = union(0.02, ellipsoid(0, pe.y + 0.012, -0.002, 0.044, 0.034, 0.038), ellipsoid(0, 0.15, 0.0, 0.044, 0.04, 0.038), ellipsoid(0, s3.y + 0.008, -0.002, 0.04, 0.03, 0.034));
    const g = starMesh(f, new THREE.Vector3(0, 0.15, 0), 22, 16, { stretch: [1, 1.6, 1] });
    // Fawn below (it shows between her legs under the mail), a cream chest (for her bare).
    paint(g, (p, _n, o) => mix(FUR.fawn, FUR.cream, sstep(-0.01, 0.03, p.z) * sstep(0.105, 0.135, p.y), o).lerp(FUR.fawnD, sstep(0.1, 0.07, p.y) * 0.4));
    add('fur', g, torsoW);
  }
  {
    const c = P('neck_01').add(new THREE.Vector3(0, 0.008, 0.006));
    const g = starMesh(union(0.008, ellipsoid(c.x, c.y, c.z - 0.002, 0.031, 0.013, 0.028), ellipsoid(c.x, c.y + 0.002, c.z + 0.016, 0.021, 0.012, 0.012)), c, 18, 10);
    paint(g, (p, _n, o) => mix(FUR.fawn, FUR.cheek, sstep(c.z - 0.012, c.z + 0.022, p.z) * 0.8, o));
    add('fur', g, two(bone('spine_03'), bone('neck_01'), (p) => sstep(c.y - 0.012, c.y + 0.01, p.y)));
  }
  {
    // Fluffy: thick, lumpy with tufts, fullest past its middle, a soft point; pale at the tip.
    const TL = TAIL_SEG * TAIL_N + 0.01;
    const tr = (s: number) => (0.0102 + 0.0058 * Math.sin(Math.PI * Math.min(1, s * 1.3) * 0.5)) * Math.pow(Math.max(0, 1 - sstep(0.8, 1.0, s)), 0.7) + 0.0015;
    const g = revolveZ(tubeRings(-0.008, TL, tr, 16, 3), 12, (p, u, s) => {
      const lump = 1 + 0.13 * Math.sin(u * Math.PI * 2 * 5 + s * 23) * sstep(0.05, 0.25, s) * (1 - sstep(0.85, 1, s));
      p.x *= lump; p.y *= lump;
    });
    paint(g, (p, _n, o) => { const s = p.z / TL; mix(FUR.fawn, FUR.fawnD, sstep(0.55, 0.9, 0.5 + 0.5 * Math.cos(s * Math.PI * 2 * 3)) * 0.35 * sstep(0.1, 0.2, s), o); return o.lerp(FUR.cheek, sstep(0.8, 0.97, s) * 0.6); });
    g.scale(1, 1, -1); flip(g); g.computeVertexNormals();
    g.translate(tail0.x, tail0.y, tail0.z);
    const tb = tail.map(B), pb = B(bone('pelvis'));
    add('fur', g, (p) => {
      const d = tail0.z - p.z;
      if (d < 0.006) { const w = sstep(-0.01, 0.006, d); return [pb, 1 - w, tb[0], w]; }
      const k = d / TAIL_SEG - 0.5, i = Math.floor(k), f = k - i;
      if (i < 0) return [tb[0], 1, 0, 0];
      if (i >= TAIL_N - 1) return [tb[TAIL_N - 1], 1, 0, 0];
      const w = sstep(0, 1, f); return [tb[i], 1 - w, tb[i + 1], w];
    });
  }

  // ================= The cuirass: breast- and backplate in one rounded shell, a raised ridge down the front, rolled
  // rims, rivets, engraved bands, scrollwork and a fleur-de-lis on the chest.
  const cuirassR = (y: number, front: boolean) => {
    const t = (y - cuiY0) / (cuiY1 - cuiY0);
    const rx = 0.047 + 0.005 * Math.sin(Math.PI * Math.min(1, t * 1.5)) - 0.017 * sstep(0.7, 1, t);
    const rz = front ? 0.041 + 0.007 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.014 * sstep(0.75, 1, t) : 0.036 + 0.003 * Math.sin(Math.PI * t) - 0.01 * sstep(0.8, 1, t);
    return { rx, rz, t };
  };
  const cuirassAt = (y: number, phi: number, off = 0, out = new THREE.Vector3()) => {
    const { rx, rz, t } = cuirassR(y, Math.cos(phi) > 0);
    const ridge = Math.cos(phi) > 0 ? 0.0035 * Math.exp(-(phi * phi) / 0.025) * sstep(0.05, 0.3, t) * (1 - sstep(0.7, 0.92, t)) : 0;
    return out.set(Math.sin(phi) * (rx + off), y, Math.cos(phi) * (rz + ridge + off) + 0.002);
  };
  {
    const g = gridSurface(48, 16, true, (u, v, o) => cuirassAt(cuiY0 + (cuiY1 - cuiY0) * v, u * Math.PI * 2, 0, o));
    orientOut(g, new THREE.Vector3(0, (cuiY0 + cuiY1) / 2, 0.002));
    g.computeVertexNormals();
    paintUV(g, (u, v, _p, o) => {
      const phi = u * Math.PI * 2, fx = Math.sin(phi), front = Math.cos(phi);
      let e = Math.max(band01(v, 0.08, 0.025), band01(v, 0.9, 0.022));
      if (front > 0) {
        e = Math.max(e, fleur(fx / 0.26, (v - 0.4) / 0.36) * sstep(0.3, 0.6, front));
        e = Math.max(e, scroll(fx * 3.2, v * 3.4) * sstep(0.3, 0.55, Math.abs(fx)) * sstep(0.15, 0.3, v) * sstep(0.85, 0.7, v));
      } else e = Math.max(e, scroll(fx * 3.2 + 0.5, v * 3.4) * sstep(0.2, 0.3, v) * sstep(0.8, 0.7, v) * 0.7);
      return mix(COL.steel, COL.steelE, e * 0.9, o);
    });
    add('steel', g, torsoW);
    for (const [y, off] of [[cuiY0, 0.0012], [cuiY1, 0.0009]] as [number, number][]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 44; k++) pts.push(cuirassAt(y, (k / 44) * Math.PI * 2, off));
      add('steel', tubeAlong(pts, 0.0021, 5, true), torsoW);
    }
    for (let k = 0; k < 14; k++) {
      const phi = (k / 14) * Math.PI * 2 + 0.22;
      const at = cuirassAt(cuiY0 + 0.007, phi, 0.0008), n = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
      add('steel', stud(at, n, 0.0017), torsoW);
    }
  }

  // ================= Pauldrons: a big round dome over each shoulder, a rim, and two lames under it; engraved with a
  // fleur-de-lis. Made in the left upper arm's canonical frame (hanging), on their own joints.
  for (const [k, side] of [[0, 1], [1, -1]] as [number, number][]) {
    const nm = side > 0 ? 'upperarm_l' : 'upperarm_r';
    const pg: THREE.BufferGeometry[] = [];
    const R = 0.031, axis = new THREE.Vector3(0.55, 1, 0.04).normalize(), c0 = new THREE.Vector3(-0.002, 0.003, 0), sc: V3T = [1.05, 0.9, 1.08];
    const dome = capSurface(R, 1.3, 30, 10, axis, c0, sc);
    paintUV(dome, (a, t, _p, o) => {
      const th = a * Math.PI * 2;
      // The fleur faces out and forward (round the dome's side); a band near the rim.
      const fx = Math.cos(th - 0.3) * t * 2.2, fy = 0.5 + Math.sin(th - 0.3) * t * 2.2;
      const e = Math.max(band01(t, 0.86, 0.035), fleur(fx * 1.2, fy * 1.0 - 0.1) * sstep(0.75, 0.5, t));
      return mix(COL.steel, COL.steelE, e * 0.9, o);
    });
    pg.push(dome);
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) rim.push(capPoint(R + 0.0006, 1.3, (i / 32) * Math.PI * 2, axis, c0, sc));
    pg.push(tubeAlong(rim, 0.0019, 5, true));
    for (let i = 0; i < 6; i++) { const th = (i / 6) * Math.PI * 2 + 0.3; pg.push(stud(capPoint(R + 0.0008, 1.12, th, axis, c0, sc), capPoint(1, 1.12, th, axis, new THREE.Vector3(), [1, 1, 1]).normalize(), 0.0015)); }
    // Lames: two shells under the dome round the outside of the arm, each a little lower and smaller, overlapping
    // like shingles.
    for (let l = 0; l < 2; l++) {
      const Rl = R * (0.99 - 0.035 * l), cl = c0.clone().addScaledVector(axis, -0.0085 * (l + 1)), ph0 = 1.0, ph1 = 1.48, th0 = -2.5, th1 = 2.5;
      const at = (u: number, v: number, off = 0) => capPoint(Rl + off, ph0 + (ph1 - ph0) * v, th0 + (th1 - th0) * u, axis, cl, sc);
      const lame = gridSurface(22, 3, false, (u, v, o) => o.copy(at(u, v)));
      orientOut(lame, cl.clone().addScaledVector(axis, -Rl * 0.5)); lame.computeVertexNormals();
      paintUV(lame, (_u, v, _p, o) => mix(COL.steel, COL.steelE, band01(v, 0.82, 0.08) * 0.8, o));
      pg.push(lame);
      const e: THREE.Vector3[] = [];
      for (let i = 0; i <= 22; i++) e.push(at(i / 22, 1, 0.0004));
      pg.push(tubeAlong(e, 0.0015, 4, false));
    }
    const pj = pauldrons[k];
    for (const g of pg) add('steel', canonRest(g, nm, side), pj);
  }

  // ================= Arms: fur at the armpit, rerebrace, couter with its wing, vambrace, cuff, a dark leather fist.
  for (const side of [1, -1]) {
    const s = side > 0 ? 'l' : 'r';
    const ua = `upperarm_${s}`, la = `lowerarm_${s}`, hd = `hand_${s}`;
    const lu = P(ua).distanceTo(P(la)), ll = P(la).distanceTo(P(hd));
    add('fur', canonRest(furBlob(0.016, -0.006, 0), ua, side), bone(ua));
    const reb = down(revolveZ(tubeRings(0.0, lu - 0.004, (t) => 0.0145 - 0.0012 * t, 4, 2), 14));
    paint(reb, (p, _n, o) => mix(COL.steel, COL.steelE, sstep(0.0013, 0.0, Math.abs(p.y + lu * 0.55)) * 0.8, o));
    add('steel', canonRest(reb, ua, side), bone(ua));
    const cou = capSurface(0.0158, 1.35, 18, 6, new THREE.Vector3(0.25, 0.05, -1).normalize(), new THREE.Vector3(0, 0.0, -0.001), [1, 1.1, 1]);
    paint(cou, (_p, _n, o) => o.copy(COL.steel));
    add('steel', canonRest(cou, la, side), bone(la));
    const wing = capSurface(0.012, 0.6, 16, 3, new THREE.Vector3(1, 0, -0.2).normalize(), new THREE.Vector3(0.003, 0, -0.002), [1, 1, 1]);
    paintUV(wing, (_u, t, _p, o) => mix(COL.steel, COL.steelE, band01(t, 0.75, 0.12), o));
    add('steel', canonRest(wing, la, side), bone(la));
    const vam = down(revolveZ(tubeRings(0.005, ll - 0.002, (t) => 0.0148 + 0.0028 * t * t, 5, 2), 16));
    paint(vam, (p, _n, o) => mix(COL.steel, COL.steelE, Math.max(sstep(0.0013, 0.0, Math.abs(p.y + ll * 0.42)), sstep(0.0013, 0.0, Math.abs(p.y + ll * 0.78))) * 0.85, o));
    add('steel', canonRest(vam, la, side), bone(la));
    for (const y of [-ll * 0.42, -ll * 0.78]) for (const a of [0.6, 2.2]) add('steel', canonRest(stud(new THREE.Vector3(Math.cos(a) * 0.016, y, Math.sin(a) * 0.016), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.0012), la, side), bone(la));
    const cuff = down(revolveZ(tubeRings(-0.004, 0.005, (t) => 0.0172 + 0.0012 * t, 2, 2), 16));
    paint(cuff, (_p, _n, o) => o.copy(COL.steel));
    add('steel', canonRest(cuff, hd, side), bone(hd));
    const fist = starMesh(union(0.004, ellipsoid(0.001, -0.0115, 0.002, 0.0118, 0.0128, 0.0125), ellipsoid(0.004, -0.0125, 0.0115, 0.006, 0.008, 0.005)), new THREE.Vector3(0.001, -0.0115, 0.003), 14, 10, { axis: 'y' });
    paint(fist, (p, _n, o) => mix(COL.glove, COL.gloveL, sstep(-0.004, -0.022, p.y) * 0.35, o));
    add('gear', canonRest(fist, hd, side), bone(hd));
    // Bare (no armour): furry arms and a soft pale paw.
    const bu = down(revolveZ(tubeRings(-0.004, lu, (t) => 0.0142 - 0.0016 * t, 4, 3), 12));
    paint(bu, (_p, _n, o) => o.copy(FUR.fawn));
    add('bare', canonRest(bu, ua, side), bone(ua));
    const bf = down(revolveZ(tubeRings(0.0, ll, (t) => 0.0128 - 0.0012 * t, 4, 3), 12));
    paint(bf, (p, _n, o) => mix(FUR.fawn, FUR.cheek, sstep(-ll * 0.4, -ll, p.y) * 0.7, o));
    add('bare', canonRest(bf, la, side), bone(la));
    const paw = starMesh(union(0.003, ellipsoid(0.0, -0.009, 0.001, 0.0118, 0.0118, 0.0112), ellipsoid(0.002, -0.0175, 0.003, 0.0085, 0.006, 0.0085)), new THREE.Vector3(0, -0.01, 0.002), 14, 10, { axis: 'y' });
    paint(paw, (_p, _n, o) => o.copy(FUR.cream));
    add('bare', canonRest(paw, hd, side), bone(hd));
  }

  // ================= Legs: fur thighs under the mail; poleyns, greaves and sabatons; her pale toes in front.
  for (const side of [1, -1]) {
    const s = side > 0 ? 'l' : 'r';
    const th = P(`thigh_${s}`), kn = P(`calf_${s}`), an = P(`foot_${s}`), ba = P(`ball_${s}`);
    const thigh = starMesh(cone(th.x, th.y + 0.006, th.z, kn.x, kn.y, kn.z, 0.0215, 0.0175), new THREE.Vector3((th.x + kn.x) / 2, (th.y + kn.y) / 2, th.z), 14, 10);
    paint(thigh, (_p, n, o) => mix(FUR.fawnD, FUR.fawn, 0.5 + 0.5 * sstep(-0.3, 0.6, n.z), o));
    add('fur', thigh, bone(`thigh_${s}`));
    // Poleyn: a dome over the front of the knee, a fan on the outside, rims.
    const pAxis = new THREE.Vector3(0.1 * side, 0.12, 1).normalize(), pc = new THREE.Vector3(kn.x, kn.y + 0.001, kn.z + 0.001);
    const pol = capSurface(0.0195, 1.2, 20, 7, pAxis, pc, [1.05, 1.0, 1]);
    paintUV(pol, (_u, t, _p, o) => mix(COL.steel, COL.steelE, Math.max(band01(t, 0.4, 0.05), band01(t, 0.86, 0.04)) * 0.8, o));
    add('steel', pol, bone(`calf_${s}`));
    const prim: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) prim.push(capPoint(0.0198, 1.2, (i / 24) * Math.PI * 2, pAxis, pc, [1.05, 1.0, 1]));
    add('steel', tubeAlong(prim, 0.0016, 4, true), bone(`calf_${s}`));
    const fan = capSurface(0.0135, 0.55, 14, 3, new THREE.Vector3(side, 0, 0.35).normalize(), new THREE.Vector3(kn.x + side * 0.004, kn.y, kn.z), [1, 1, 1]);
    paint(fan, (_p, _n, o) => o.copy(COL.steel));
    add('steel', fan, bone(`calf_${s}`));
    // Greave: from under the knee to the ankle, a little fuller at the calf.
    const glen = kn.y - an.y - 0.004;
    const gr = revolveZ(tubeRings(0, glen, (t) => 0.0178 - 0.0022 * t + 0.0012 * Math.sin(Math.PI * t), 5, 2), 16);
    gr.rotateX(Math.PI / 2); gr.translate(kn.x, kn.y - 0.006, kn.z - 0.001);
    paint(gr, (p, _n, o) => mix(COL.steel, COL.steelE, sstep(0.0013, 0.0, Math.abs(p.y - (kn.y + an.y) / 2 + 0.004)) * 0.7, o));
    add('steel', gr, two(bone(`foot_${s}`), bone(`calf_${s}`), (p) => sstep(an.y + 0.002, an.y + 0.012, p.y)));
    // Toes: a soft pale paw out of the sabaton's front.
    const tz = ba.z + 0.006;
    const toe = starMesh(union(0.004, ellipsoid(an.x, 0.0075, tz, 0.0145, 0.0075, 0.011), ellipsoid(an.x + 0.0062, 0.006, tz + 0.0078, 0.0046, 0.0052, 0.0046), ellipsoid(an.x - 0.0062, 0.006, tz + 0.0078, 0.0046, 0.0052, 0.0046), ellipsoid(an.x, 0.0062, tz + 0.0094, 0.0048, 0.0054, 0.0046)),
      new THREE.Vector3(an.x, 0.007, tz + 0.002), 16, 10, { axis: 'y' });
    paint(toe, (p, _n, o) => mix(FUR.cheek, FUR.cream, sstep(tz, tz + 0.012, p.z), o));
    add('fur', toe, bone(`ball_${s}`));
    // Sabaton: lames over the foot from the ankle to above the toes, ending in a blunt point; a heel cup.
    const z0 = an.z - 0.014, z1 = tz + 0.004;
    const sab = gridSurface(22, 10, false, (u, v, o) => {
      const a = (u - 0.5) * Math.PI * 1.3;
      const z = THREE.MathUtils.lerp(z0, z1, v);
      const w = 0.0195 - 0.006 * v * v, h = 0.019 - 0.0075 * v;
      const ridge = 0.0013 * Math.exp(-(a * a) / 0.08) * v;
      return o.set(an.x + Math.sin(a) * w, 0.0088 + Math.cos(a) * (h + ridge), z + (v > 0.8 ? (v - 0.8) * 0.03 * Math.cos(a) ** 2 : 0));
    });
    orientOut(sab, new THREE.Vector3(an.x, 0.0, (z0 + z1) / 2));
    sab.computeVertexNormals();
    paintUV(sab, (_u, v, _p, o) => mix(COL.steel, COL.steelE, Math.max(...[0.25, 0.5, 0.75].map((b) => band01(v, b, 0.025))) * 0.85, o));
    const fb = B(bone(`foot_${s}`)), bb = B(bone(`ball_${s}`));
    add('steel', sab, (p) => { const w = sstep(ba.z - 0.004, ba.z + 0.008, p.z); return [fb, 1 - w, bb, w]; });
    const heel = capSurface(0.0185, 1.45, 18, 6, new THREE.Vector3(0, 0.3, -1).normalize(), new THREE.Vector3(an.x, 0.0195, an.z - 0.002), [1.02, 1.05, 1]);
    paint(heel, (_p, _n, o) => o.copy(COL.steel));
    add('steel', heel, bone(`foot_${s}`));
    // A strap over the instep.
    const strap: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12 - 0.5) * Math.PI * 1.25; strap.push(new THREE.Vector3(an.x + Math.sin(a) * 0.0203, 0.0088 + Math.cos(a) * 0.0195, an.z - 0.002)); }
    const st = tubeAlong(strap, 0.0018, 4, false); paint(st, (_p, _n, o) => o.copy(COL.leatherD));
    add('gear', st, bone(`foot_${s}`));
    // Bare: a furry shin and the top of her foot.
    const sh = starMesh(cone(kn.x, kn.y, kn.z, an.x, an.y + 0.002, an.z, 0.0155, 0.0128), new THREE.Vector3(kn.x, (kn.y + an.y) / 2, kn.z), 12, 10);
    paint(sh, (_p, n, o) => mix(FUR.fawn, FUR.cheek, sstep(0.0, 0.7, n.z) * 0.6, o));
    add('bare', sh, two(bone(`foot_${s}`), bone(`calf_${s}`), (p) => sstep(an.y + 0.002, an.y + 0.012, p.y)));
    const ft = starMesh(ellipsoid(an.x, 0.0105, (an.z + ba.z) / 2 - 0.002, 0.0148, 0.0105, 0.0215), new THREE.Vector3(an.x, 0.0105, (an.z + ba.z) / 2), 14, 10);
    paint(ft, (p, _n, o) => mix(FUR.fawn, FUR.cream, sstep(an.z, ba.z + 0.01, p.z), o));
    add('bare', ft, bone(`foot_${s}`));
  }

  // ================= The mail skirt (ring texture) from under the cuirass to above the knees; it swings with the legs.
  const skirtR = (v: number, phi: number) => (0.051 + 0.008 * v) * (Math.cos(phi) < 0 ? 1.02 : 1);
  const pelB = B(bone('pelvis')), thL = B(bone('thigh_l')), thR = B(bone('thigh_r'));
  const skirtW: Weights = (p) => {
    const v = THREE.MathUtils.clamp((skY0 - p.y) / (skY0 - skY1), 0, 1);
    const w = 0.6 * sstep(0.3, 1, v) * sstep(0.006, 0.03, Math.abs(p.x));
    return [pelB, 1 - w, p.x > 0 ? thL : thR, w];
  };
  const skirtAt = (v: number, phi: number, off = 0, o = new THREE.Vector3()) => {
    const r = skirtR(v, phi) + off;
    return o.set(Math.sin(phi) * r, skY0 - (skY0 - skY1) * v - (Math.cos(phi) < 0 ? 0.003 * v : 0), Math.cos(phi) * r * 0.92 - 0.002);
  };
  {
    const g = gridSurface(44, 8, true, (u, v, o) => skirtAt(v, u * Math.PI * 2, 0, o));
    orientOut(g, new THREE.Vector3(0, (skY0 + skY1) / 2, 0)); g.computeVertexNormals();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 46, uv.getY(i) * 10);
    add('mail', g, skirtW);
    const hem: THREE.Vector3[] = [];
    for (let k = 0; k < 44; k++) hem.push(skirtAt(1, (k / 44) * Math.PI * 2, 0.0004));
    add('mail', tubeAlong(hem, 0.0018, 4, true), skirtW);
  }
  // Tassets: front left and right, and either side; engraved, rimmed, riveted.
  for (const [phiC, span] of [[0.4, 0.66], [-0.4, 0.66], [1.42, 0.62], [-1.42, 0.62]] as [number, number][]) {
    const pos = (u: number, v: number, off = 0, o = new THREE.Vector3()) => {
      const phi = phiC + (u - 0.5) * span;
      return skirtAt(0.05 + v * 0.72, phi, 0.0045 + off + 0.0025 * Math.cos((u - 0.5) * Math.PI) + 0.002 * v, o);
    };
    const g = gridSurface(14, 10, false, (u, v, o) => pos(u, v, 0, o));
    orientOut(g, new THREE.Vector3(0, (skY0 + skY1) / 2, 0)); g.computeVertexNormals();
    paintUV(g, (u, v, _p, o) => mix(COL.steel, COL.steelE, Math.max(border(u, v, 0.1), fleur((u - 0.5) * 2.6, v * 1.35 - 0.2) * 0.55) * 0.85, o));
    add('steel', g, skirtW);
    const edge: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) edge.push(pos(0, k / 12, 0.0005));
    for (let k = 1; k <= 8; k++) edge.push(pos(k / 8, 1, 0.0005));
    for (let k = 11; k >= 0; k--) edge.push(pos(1, k / 12, 0.0005));
    add('steel', tubeAlong(edge, 0.0014, 4, false), skirtW);
    for (const u of [0.18, 0.82]) add('steel', stud(pos(u, 0.07, 0.0006), pos(u, 0.07, 1).sub(pos(u, 0.07)).normalize(), 0.0014), skirtW);
  }

  // ================= Belts: one level round her waist over the cuirass's foot, buckled on her left front with its end
  // hanging; a sword belt slung from high on her right hip down across to her left thigh, buckled.
  {
    const by = cuiY0 + 0.004;
    const belt1 = beltBand((phi) => cuirassAt(by, phi, 0.0026), 0.011, 0.002, 56);
    paint(belt1, (p, _n, o) => mix(COL.leather, COL.leatherD, sstep(0.0038, 0.0055, Math.abs(p.y - by)), o));
    add('gear', belt1, torsoW);
    const bphi = 0.62, bn = new THREE.Vector3(Math.sin(bphi), 0, Math.cos(bphi));
    add('steel', buckle(cuirassAt(by, bphi, 0.0052), bn, 0.008, 0.0095), torsoW);
    // The belt's end, out through the buckle and hanging.
    const tip: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; tip.push(cuirassAt(by - t * 0.012, bphi + 0.12 + t * 0.12, 0.0045 + t * 0.003)); }
    const tg = tubeAlong(tip, 0.0026, 4, false); paint(tg, (_p, _n, o) => o.copy(COL.leather));
    add('gear', tg, torsoW);
    // Sword belt.
    const tilt = (phi: number) => 0.022 + 0.022 * Math.sin(phi) * (Math.cos(phi) > 0 ? 1 : 0.5);
    const sb = (phi: number) => skirtAt(tilt(phi) / (skY0 - skY1), phi, 0.0078 + 0.0028 * Math.max(0, Math.cos(phi)));
    const belt2 = beltBand(sb, 0.0092, 0.0019, 56);
    paint(belt2, (_p, _n, o) => mix(COL.leather, COL.leatherD, 0.25, o));
    add('gear', belt2, skirtW);
    const p2 = sb(-0.5), n2 = new THREE.Vector3(Math.sin(-0.5), 0, Math.cos(-0.5));
    add('steel', buckle(p2.addScaledVector(n2, 0.0022), n2, 0.0075, 0.009), skirtW);
  }

  // ================= The longsword, made upright with its guard at the origin: a fullered blade with a point, a gold
  // crossguard ending in knobs, a dark wrapped grip, a round gold pommel.
  {
    const L = SWORD.blade;
    const blade = gridSurface(8, 26, true, (u, v, o) => {
      const a = u * Math.PI * 2, y = v * L;
      const point = sstep(L - 0.04, L, y);
      const w = (0.0112 - 0.003 * (y / L)) * Math.sqrt(Math.max(0, 1 - point * point)) + 0.00015;
      const t = 0.0022 * (1 - point * 0.85);
      const cx = Math.cos(a), cz = Math.sin(a), k = Math.abs(cx) + Math.abs(cz) || 1;
      return o.set((cx / k) * w, y + 0.0015, (cz / k) * t);
    });
    blade.computeVertexNormals();
    paint(blade, (p, _n, o) => mix(COL.steel, COL.fuller, sstep(0.0022, 0.0009, Math.abs(p.x)) * sstep(0.01, 0.025, p.y) * sstep(L * 0.8, L * 0.66, p.y), o));
    const gold = (g: THREE.BufferGeometry, k = 0) => paint(g, (_p, n, o) => mix(COL.gold, COL.goldD, k + 0.35 * (1 - Math.abs(n.y)), o));
    const guard = revolveZ(tubeRings(-0.034, 0.034, (t) => 0.0031 - 0.0007 * Math.sin(Math.PI * t), 10, 3), 8);
    guard.rotateY(Math.PI / 2);
    const gp = guard.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, gp.getY(i) + 0.003 * Math.pow(Math.abs(gp.getX(i)) / 0.034, 2));
    guard.computeVertexNormals(); gold(guard);
    const knobs = [-1, 1].map((sd) => { const k = new THREE.SphereGeometry(0.0043, 10, 7); k.deleteAttribute('uv'); k.translate(sd * 0.036, 0.0033, 0); gold(k); return k; });
    const ricasso = new THREE.SphereGeometry(0.0058, 10, 6); ricasso.deleteAttribute('uv'); ricasso.scale(1.25, 0.75, 0.6); gold(ricasso, 0.1);
    const pommel = new THREE.SphereGeometry(0.0072, 12, 8); pommel.deleteAttribute('uv'); pommel.scale(1, 0.95, 0.75); pommel.translate(0, -SWORD.pommel, 0); gold(pommel);
    const neck = revolveZ(tubeRings(SWORD.grip - 0.001, SWORD.pommel - 0.005, () => 0.0032, 2, 2), 8); neck.rotateX(Math.PI / 2); gold(neck, 0.1);
    const grip = revolveZ(tubeRings(0.002, SWORD.grip, (t) => 0.0041 - 0.0005 * Math.sin(Math.PI * t), 10, 2), 10);
    grip.rotateX(Math.PI / 2);
    paint(grip, (p, _n, o) => mix(COL.grip, COL.gripL, sstep(0.25, 0.0, Math.abs(((-p.y) / 0.0055) % 1 - 0.5)) * 0.5, o));
    for (const g of [blade, guard, ...knobs, ricasso, pommel, neck]) add('steel', g, sword);
    add('gear', grip, sword);
  }

  // ================= Into skinned meshes on one skeleton.
  for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r']) B(bone(n));
  const furM = toy('#ffffff', { vertexColors: true, rough: 0.9, fade });
  const steelM = metal('#ffffff', 0.32, fade, true);
  steelM.envMapIntensity = 0.85;
  steelM.side = THREE.DoubleSide;
  const mailM = metal('#ffffff', 0.4, fade);
  mailM.map = mailTexture(); mailM.color.set('#d4d8de');
  const glintM = toy('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.9, fade });
  const eyeM = toy('#ffffff', { vertexColors: true, rough: 0.16, fade });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material | THREE.Material[], name: string) => {
    const g = merge(geos);
    const m = new THREE.SkinnedMesh(g, mat);
    m.name = name;
    root.add(m);
    m.bind(skeleton, root.matrixWorld.clone());
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.15, 0), 0.6);
    m.frustumCulled = false;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const fur = mk(parts.fur, furM, 'KnightKittenFur');
  const gear = mk(parts.gear, furM, 'KnightKittenGear');
  const bare = mk(parts.bare, furM, 'KnightKittenBare');
  bare.visible = false;
  const steel = mk(parts.steel, steelM, 'KnightKittenPlate');
  const mail = mk(parts.mail, mailM, 'KnightKittenMail');
  const nEye = parts.eye.reduce((a, g) => a + g.index!.count, 0);
  const eyes = mk([...parts.eye, ...parts.glint], [eyeM, glintM], 'KnightKittenEyes');
  eyes.geometry.addGroup(0, nEye, 0); eyes.geometry.addGroup(nEye, eyes.geometry.index!.count - nEye, 1);
  eyes.castShadow = false;
  let tris = 0;
  for (const m of [fur, gear, steel, mail, eyes]) tris += m.geometry.index!.count / 3;
  return { fur, gear, bare, steel, mail, eyes, glintMat: glintM, face, headC, tail, sword, pauldrons, bones, tris, dims: { cuiY0, cuiY1, skY0, skY1, tail0 } };
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes.

// A grid surface: positions from (u, v) in 0..1 (u wraps if asked); uv kept for painting.
function gridSurface(nu: number, nv: number, wrap: boolean, fn: (u: number, v: number, out: THREE.Vector3) => THREE.Vector3) {
  const cols = wrap ? nu : nu + 1;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const o = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { fn(i / nu, j / nv, o); pos.push(o.x, o.y, o.z); uvs.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i, b = j * cols + ((i + 1) % cols), c = a + cols, d = b + cols;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Vertex colours from the surface's own (u, v).
function paintUV(g: THREE.BufferGeometry, fn: (u: number, v: number, p: THREE.Vector3, out: THREE.Color) => THREE.Color) {
  const uv = g.attributes.uv, pos = g.attributes.position;
  const c = new Float32Array(pos.count * 3), p = new THREE.Vector3(), o = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos as THREE.BufferAttribute, i); fn(uv.getX(i), uv.getY(i), p, o); c.set([o.r, o.g, o.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// A point on a spherical cap of radius r out to polar angle `ph` round `axis`, centred at c, scaled per axis.
function capPoint(r: number, ph: number, th: number, axis: THREE.Vector3, c: THREE.Vector3, sc: V3T, t = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const a = ph * t;
  return new THREE.Vector3(Math.sin(a) * Math.cos(th) * r, Math.cos(a) * r, Math.sin(a) * Math.sin(th) * r).multiply(new THREE.Vector3(...sc)).applyQuaternion(q).add(c);
}
// The cap as a surface; uv: (round, out from the pole).
function capSurface(r: number, ph: number, nu: number, nv: number, axis: THREE.Vector3, c: THREE.Vector3, sc: V3T) {
  const g = gridSurface(nu, nv, true, (u, v, o) => o.copy(capPoint(r, ph, u * Math.PI * 2, axis, c, sc, Math.max(v, 0.03))));
  orientOut(g, c.clone().addScaledVector(axis, -r * 0.5));
  g.computeVertexNormals();
  return g;
}

// A flat strap round a closed loop of points (width w up and down, thickness t outward), e.g. a belt.
function beltBand(at: (phi: number) => THREE.Vector3, w: number, t: number, n: number) {
  const pos: number[] = [], idx: number[] = [], mids: THREE.Vector3[] = [];
  const c = new THREE.Vector3();
  for (let k = 0; k < n; k++) c.add(at((k / n) * Math.PI * 2));
  c.multiplyScalar(1 / n);
  for (let k = 0; k < n; k++) {
    const p = at((k / n) * Math.PI * 2), out = p.clone().sub(c).setY(0).normalize();
    for (const [dy, dt] of [[-w / 2, 0], [-w / 2, t], [w / 2, t], [w / 2, 0]]) pos.push(p.x + out.x * dt, p.y + dy, p.z + out.z * dt);
    mids.push(p.clone().addScaledVector(out, t / 2));
  }
  for (let k = 0; k < n; k++) for (let s = 0; s < 4; s++) {
    const a = k * 4 + s, b = k * 4 + (s + 1) % 4, a2 = ((k + 1) % n) * 4 + s, b2 = ((k + 1) % n) * 4 + (s + 1) % 4;
    idx.push(a, a2, b, b, a2, b2);
  }
  // Each face away from the strap's middle line.
  for (let tt = 0; tt < idx.length; tt += 3) {
    const mid = mids[Math.floor(idx[tt] / 4)];
    const A = idx[tt] * 3, Bb = idx[tt + 1] * 3, D = idx[tt + 2] * 3;
    const ux = pos[Bb] - pos[A], uy = pos[Bb + 1] - pos[A + 1], uz = pos[Bb + 2] - pos[A + 2], vx = pos[D] - pos[A], vy = pos[D + 1] - pos[A + 1], vz = pos[D + 2] - pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (pos[A] + pos[Bb] + pos[D]) / 3 - mid.x, my = (pos[A + 1] + pos[Bb + 1] + pos[D + 1]) / 3 - mid.y, mz = (pos[A + 2] + pos[Bb + 2] + pos[D + 2]) / 3 - mid.z;
    if (nx * mx + ny * my + nz * mz < 0) { const s = idx[tt + 1]; idx[tt + 1] = idx[tt + 2]; idx[tt + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A rounded square buckle frame facing n.
function buckle(p: THREE.Vector3, n: THREE.Vector3, w: number, h: number) {
  const g = new THREE.TorusGeometry(0.5, 0.13, 4, 4);
  g.deleteAttribute('uv');
  g.rotateZ(Math.PI / 4);
  g.scale(w * 1.4, h * 1.4, w * 0.9);
  g.lookAt(n);
  g.translate(p.x, p.y, p.z);
  paint(g, (_q, _n, o) => o.copy(COL.steel));
  return g;
}

// A domed rivet.
function stud(p: THREE.Vector3, n: THREE.Vector3, r: number) {
  const g = new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  g.deleteAttribute('uv');
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()));
  g.translate(p.x, p.y, p.z);
  paint(g, (_q, _n, o) => o.copy(COL.steel));
  return toIndexed(g);
}

// A soft blob of fur (an armpit), in an arm's canonical frame.
function furBlob(r: number, y: number, z: number) {
  const g = starMesh(ellipsoid(0, y, z, r, r * 1.2, r), new THREE.Vector3(0, y, z), 12, 8);
  paint(g, (_p, _n, o) => o.copy(FUR.fawn));
  return g;
}

// Along -y (from along +z).
function down(g: THREE.BufferGeometry) { return g.rotateX(Math.PI / 2); }
function flip(g: THREE.BufferGeometry) { const a = g.index!.array as any; for (let t = 0; t < a.length; t += 3) { const s = a[t + 1]; a[t + 1] = a[t + 2]; a[t + 2] = s; } g.index!.needsUpdate = true; }
function toIndexed(g: THREE.BufferGeometry) { if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); } return g; }

// Winds every triangle to face away from c (or from the vertical line through c).
function orientOut(g: THREE.BufferGeometry, c: THREE.Vector3, line = false) {
  const p = g.attributes.position.array as Float32Array, ix = g.index!.array as any;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, d = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[a] + p[b] + p[d]) / 3 - c.x, my = line ? 0 : (p[a + 1] + p[b + 1] + p[d + 1]) / 3 - c.y, mz = (p[a + 2] + p[b + 2] + p[d + 2]) / 3 - c.z;
    if (nx * mx + ny * my + nz * mz < 0) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
  }
}

// A tube along points (closed into a loop, or open: its ends always tuck under something).
function tubeAlong(pts: THREE.Vector3[], r: number, n: number, closed: boolean) {
  const N = pts.length, pos: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), ref = new THREE.Vector3();
  let prevA: THREE.Vector3 | null = null;
  for (let i = 0; i < N; i++) {
    const p0 = pts[closed ? (i + N - 1) % N : Math.max(0, i - 1)], p1 = pts[closed ? (i + 1) % N : Math.min(N - 1, i + 1)];
    t.subVectors(p1, p0).normalize();
    // A frame carried along the curve (no twisting).
    ref.copy(prevA ?? (Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)));
    a.copy(ref).addScaledVector(t, -t.dot(ref)).normalize();
    b.crossVectors(t, a).normalize();
    prevA = a.clone();
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      pos.push(pts[i].x + (a.x * Math.cos(th) + b.x * Math.sin(th)) * r, pts[i].y + (a.y * Math.cos(th) + b.y * Math.sin(th)) * r, pts[i].z + (a.z * Math.cos(th) + b.z * Math.sin(th)) * r);
    }
  }
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) for (let k = 0; k < n; k++) {
    const p0 = i * n + k, p1 = i * n + (k + 1) % n, q0 = ((i + 1) % N) * n + k, q1 = ((i + 1) % N) * n + (k + 1) % n;
    idx.push(p0, q0, p1, p1, q0, q1);
  }
  // Face away from the centre line.
  for (let tt = 0; tt < idx.length; tt += 3) {
    const c = pts[Math.floor(idx[tt] / n)];
    const A = idx[tt] * 3, Bb = idx[tt + 1] * 3, D = idx[tt + 2] * 3;
    const ux = pos[Bb] - pos[A], uy = pos[Bb + 1] - pos[A + 1], uz = pos[Bb + 2] - pos[A + 2], vx = pos[D] - pos[A], vy = pos[D + 1] - pos[A + 1], vz = pos[D + 2] - pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (pos[A] - c.x) + ny * (pos[A + 1] - c.y) + nz * (pos[A + 2] - c.z) < 0) { const s = idx[tt + 1]; idx[tt + 1] = idx[tt + 2]; idx[tt + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  paint(g, (_q, _n, o) => o.copy(COL.steel));
  return g;
}

// ---- Engraving: soft dark lines (0..1) on a plate, in its own coordinates.
function band01(v: number, at: number, w: number) { return sstep(w, w * 0.35, Math.abs(v - at)); }
function border(u: number, v: number, m: number) {
  const d = Math.min(Math.abs(u - m), Math.abs(1 - m - u), Math.abs(v - m), Math.abs(1 - m - v));
  const inside = u > m - 0.02 && u < 1 - m + 0.02 && v > m - 0.02 && v < 1 - m + 0.02 ? 1 : 0;
  return sstep(0.05, 0.02, d) * inside;
}
// A fleur-de-lis in a box: x -1..1 across, y 0..1 up.
function fleur(x: number, y: number) {
  if (y < -0.05 || y > 1.05 || Math.abs(x) > 1.1) return 0;
  const ax = Math.abs(x);
  const line = (d: number) => sstep(0.11, 0.045, d);
  const stem = line(ax) * sstep(0.15, 0.2, y) * sstep(0.85, 0.8, y);
  const petal = line(Math.abs(Math.hypot(x / 0.26, (y - 0.74) / 0.28) - 1) * 0.22);
  const lobe = line(Math.abs(Math.hypot((ax - 0.42) / 0.36, (y - 0.52) / 0.32) - 1) * 0.25) * sstep(0.32, 0.45, y) * sstep(0.25, 0.4, ax);
  const bar = line(Math.abs(y - 0.38) * 1.2) * sstep(0.55, 0.45, ax);
  const foot = line(Math.abs(Math.hypot((ax - 0.2) / 0.22, (y - 0.15) / 0.12) - 1) * 0.2) * sstep(0.25, 0.1, y);
  return Math.max(stem, petal, lobe, bar, foot);
}
// Running scrollwork.
function scroll(x: number, y: number) {
  const fx = x - Math.floor(x) - 0.5, fy = y - Math.floor(y) - 0.5;
  const r = Math.hypot(fx, fy), a = Math.atan2(fy, fx);
  const spiral = Math.abs(((r * 9 - a / (Math.PI * 2) * 1.5) % 1 + 1) % 1 - 0.5);
  return sstep(0.17, 0.08, spiral) * sstep(0.48, 0.35, r);
}

// The mail's rings: a small tiling texture (bright links, dark gaps), two offset rows per tile.
let MAIL: THREE.DataTexture | null = null;
function mailTexture() {
  if (MAIL) return MAIL;
  const N = 32, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0.18;
    for (const [cx, cy] of [[8, 8], [24, 8], [-8, 8], [40, 8], [0, 24], [16, 24], [32, 24], [8, 40], [24, 40], [0, -8], [16, -8], [32, -8]]) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 1.1, r = Math.hypot(dx, dy);
      const ring = Math.exp(-((r - 6.3) ** 2) / 2.6);
      v = Math.max(v, 0.25 + 0.75 * ring * (0.65 + 0.35 * Math.cos(Math.atan2(dy, dx) + 0.9)));
    }
    const c = Math.round(255 * Math.min(1, v));
    d.set([c, c, c, 255], (y * N + x) * 4);
  }
  MAIL = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  MAIL.wrapS = MAIL.wrapT = THREE.RepeatWrapping;
  MAIL.magFilter = THREE.LinearFilter; MAIL.minFilter = THREE.LinearMipmapLinearFilter; MAIL.generateMipmaps = true;
  MAIL.colorSpace = THREE.SRGBColorSpace;
  MAIL.needsUpdate = true;
  return MAIL;
}
