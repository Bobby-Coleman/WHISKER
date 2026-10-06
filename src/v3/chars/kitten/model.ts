// The toy kitten's construction: a hierarchy of THREE.Group joints (pelvis, spine, chest, neck, head, four legs of
// upper, lower and paw, a tail of six, ears, eyes with their lids, a jaw, the chest ruff) and the smooth rounded shapes
// on them, modelled as signed-distance blends and spheres/lathes (geo.ts). Every furry part is one skinned mesh bound
// to those joints (rigid parts weigh on one joint, the body and tail blend between theirs, so the spine and tail bend
// in one smooth piece), the glossy eyes another, the armour a third: she is a handful of draw calls. Coat colours are
// painted per vertex; materials are the shared toy() and metal() ones (with her own fade).
// All lengths in metres; +z is her front, +x her left, y up; the bind pose stands her on all fours with the
// group origin on the ground under her middle.
import * as THREE from 'three';
import { toy, metal, PAL, Fade } from '../../render/materials';
import { SDF, ellipsoid, cone, union, smin, starMesh, revolveZ, tubeRings, paint, skin, merge, bake, sstep } from './geo';
import { KittenFace, FUR } from './face';

// Bind-pose offsets of each joint from its parent.
export const REST = {
  pelvis: new THREE.Vector3(0, 0.112, -0.065), spine: new THREE.Vector3(0, 0, 0.065), chest: new THREE.Vector3(0, 0.006, 0.062),
  neck: new THREE.Vector3(0, 0.028, 0.034), head: new THREE.Vector3(0, 0.05, 0.03),
  fore: new THREE.Vector3(0.031, -0.024, 0.016), hind: new THREE.Vector3(0.034, -0.01, -0.002),
  tail0: new THREE.Vector3(0, 0.022, -0.048), tailSeg: 0.031,
  ear: new THREE.Vector3(0.033, 0.037, -0.007), eye: new THREE.Vector3(0.0265, 0.004, 0.0395), jaw: new THREE.Vector3(0, -0.0255, 0.0465),
};
// Leg segment lengths and how high the paw joint stands over the ground when the paw is flat.
export const LEG = { foreU: 0.056, foreL: 0.052, hindU: 0.056, hindL: 0.056, pawH: 0.0145 };
export const EYE_R = 0.0172;
export const TAIL_N = 6;

const C = (hex: string) => new THREE.Color(hex);
// Her coat (the photo's): light golden-fawn tabby, soft darker stripes, cream underneath, pale paws.
const COL = {
  ginger: FUR.fawn.clone(), gingerD: FUR.fawnD.clone(), cream: FUR.cream.clone(), white: FUR.white.clone(), pink: FUR.earIn.clone(),
  pad: C('#e7a49a'), leather: C('#6e452a'), leatherD: C('#4a2d1b'), gingerL: C('#e2cbb1'),
};
const mix = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) => out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

// Leg coat in the bind pose (model space): ginger where the leg leaves the body, as the flank is, pale ginger down
// the outside, cream in front, white socks.
function legCol(fore: boolean, lower: boolean) {
  return (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => {
    // Pale ginger down the outside of the leg, cream on the front and inside, white socks over the paws.
    const outside = sstep(0.1, 0.7, n.x * Math.sign(p.x)) * (fore ? 0.55 : 0.75) + sstep(-0.1, -0.7, n.z) * (fore ? 0.3 : 0.5);
    mix(COL.gingerL, COL.cream, 1 - Math.min(1, outside), out);
    out.lerp(COL.ginger, sstep(0.07, 0.095, p.y));
    if (lower) out.lerp(COL.white, sstep(0.024, 0.006, p.y) * 0.85);
    return out;
  };
}

export type Leg = { upper: THREE.Group; lower: THREE.Group; paw: THREE.Group; side: number; fore: boolean; l1: number; l2: number; socket: THREE.Vector3 };

export class KittenRig {
  model = new THREE.Group();
  pelvis = new THREE.Group(); spine = new THREE.Group(); chest = new THREE.Group(); neck = new THREE.Group(); head = new THREE.Group();
  legs: Leg[] = []; // left fore, right fore, left hind, right hind
  tail: THREE.Group[] = [];
  // Her head's face, ears and bow (face.ts), on the head joint.
  face!: KittenFace;
  // The fluff on her chest (folded away under the breastplate).
  ruff = new THREE.Group();
  body!: THREE.SkinnedMesh; armour!: THREE.SkinnedMesh; eyeMesh!: THREE.SkinnedMesh; glintMat!: THREE.Material;
  bones: THREE.Object3D[] = [];
  // The torso's surface (bind pose), used for the armour and the cape's collision.
  torsoSDF!: SDF;
  tris = 0;

  constructor(public fade: Fade) {
    const m = this.model;
    m.name = 'Kitten';
    const at = (g: THREE.Group, parent: THREE.Object3D, p: THREE.Vector3, name: string) => { g.position.copy(p); g.name = name; parent.add(g); return g; };
    at(this.pelvis, m, REST.pelvis, 'pelvis'); at(this.spine, this.pelvis, REST.spine, 'spine'); at(this.chest, this.spine, REST.chest, 'chest');
    at(this.neck, this.chest, REST.neck, 'neck'); at(this.head, this.neck, REST.head, 'head');
    for (const [fore, side] of [[true, 1], [true, -1], [false, 1], [false, -1]] as [boolean, number][]) {
      const s = (fore ? REST.fore : REST.hind).clone(); s.x *= side;
      const l1 = fore ? LEG.foreU : LEG.hindU, l2 = fore ? LEG.foreL : LEG.hindL;
      const n = (fore ? 'fore' : 'hind') + (side > 0 ? 'L' : 'R');
      const upper = at(new THREE.Group(), fore ? this.chest : this.pelvis, s, n + 'Upper');
      const lower = at(new THREE.Group(), upper, new THREE.Vector3(0, -l1, 0), n + 'Lower');
      const paw = at(new THREE.Group(), lower, new THREE.Vector3(0, -l2, 0), n + 'Paw');
      this.legs.push({ upper, lower, paw, side, fore, l1, l2, socket: s });
    }
    let parent: THREE.Object3D = this.pelvis;
    for (let i = 0; i < TAIL_N; i++) { const t = at(new THREE.Group(), parent, i === 0 ? REST.tail0 : new THREE.Vector3(0, 0, -REST.tailSeg), 'tail' + i); this.tail.push(t); parent = t; }
    this.face = new KittenFace(this.head, 1);
    at(this.ruff, this.chest, new THREE.Vector3(0, -0.012, 0.036), 'ruff');
    m.updateMatrixWorld(true);
  }

  // Builds the meshes in the bind pose and binds them.
  build() {
    const fur = toy('#ffffff', { vertexColors: true, rough: 0.92, fade: this.fade });
    const bones: THREE.Object3D[] = [this.pelvis, this.spine, this.chest, this.neck, this.head, this.ruff,
      ...this.legs.flatMap((l) => [l.upper, l.lower, l.paw]), ...this.tail, ...this.face.joints];
    this.bones = bones;
    const B = (o: THREE.Object3D) => bones.indexOf(o);
    const parts: THREE.BufferGeometry[] = [];
    // A part modelled in a joint's own space, painted there, then moved to the bind pose on that joint.
    const rigid = (g: THREE.BufferGeometry, joint: THREE.Object3D) => { parts.push(skin(bake(g, joint.matrixWorld), B(joint))); };

    // ---- Torso: one smooth bean from rump to chest, bending along pelvis, spine and chest.
    const core = union(0.035,
      ellipsoid(0, 0.112, -0.066, 0.057, 0.056, 0.06),
      ellipsoid(0, 0.103, -0.002, 0.055, 0.058, 0.07),
      ellipsoid(0, 0.118, 0.058, 0.05, 0.056, 0.06));
    // Chubby haunches, part of the rump (the thighs move inside them).
    const haunch = union(0.01, ellipsoid(0.03, 0.09, -0.066, 0.03, 0.04, 0.036), ellipsoid(-0.03, 0.09, -0.066, 0.03, 0.04, 0.036));
    const torso: SDF = (x, y, z) => smin(core(x, y, z), haunch(x, y, z), 0.016);
    this.torsoSDF = torso;
    const zP = REST.pelvis.z, zS = zP + REST.spine.z, zC = zS + REST.chest.z;
    const torsoW = (p: THREE.Vector3): [number, number, number, number] => {
      if (p.z <= zP) return [B(this.pelvis), 1, 0, 0];
      if (p.z <= zS) { const w = sstep(zP, zS, p.z); return [B(this.pelvis), 1 - w, B(this.spine), w]; }
      if (p.z <= zC) { const w = sstep(zS, zC, p.z); return [B(this.spine), 1 - w, B(this.chest), w]; }
      return [B(this.chest), 1, 0, 0];
    };
    const tg = starMesh(torso, new THREE.Vector3(0, 0.11, -0.004), 34, 30, { axis: 'z', stretch: [1, 1, 2.0] });
    paint(tg, (p, n, out) => {
      // Ginger back and flanks, cream belly and bib, soft darker tabby bands across the back.
      mix(COL.ginger, COL.cream, Math.max(sstep(0.0, -0.55, n.y), sstep(0.095, 0.07, p.y), sstep(0.085, 0.112, p.z) * sstep(0.15, 0.55, n.z) * sstep(0.15, 0.1, p.y)), out);
      const top = sstep(0.1, 0.55, n.y);
      const ph = (p.z + 0.13) / 0.044 + (Math.abs(p.x) / 0.05) * 0.35;
      const band = sstep(0.55, 0.85, 0.5 + 0.5 * Math.cos(ph * Math.PI * 2)) * top * sstep(0.075, 0.03, p.z);
      // A curved stripe round each haunch.
      const hb = sstep(0.004, 0.0, Math.abs(Math.hypot((Math.abs(p.x) - 0.03) * 0.3, p.y - 0.075, (p.z + 0.07) * 0.8) - 0.03)) * sstep(0.3, 0.7, Math.abs(n.x)) * sstep(0.06, 0.08, p.y);
      return out.lerp(COL.gingerD, Math.max(band, hb) * 0.55);
    });
    parts.push(skin(tg, torsoW));

    // Chest ruff: a soft fluffy bib under her chin with three rounded points.
    {
      const rs = union(0.007, ellipsoid(0, 0, 0.002, 0.03, 0.018, 0.016),
        cone(0, -0.004, 0.008, 0, -0.018, 0.027, 0.0095, 0.003), cone(0.015, -0.003, 0.006, 0.02, -0.016, 0.023, 0.0085, 0.0028), cone(-0.015, -0.003, 0.006, -0.02, -0.016, 0.023, 0.0085, 0.0028));
      const g = starMesh(rs, new THREE.Vector3(0, -0.004, 0.004), 18, 12, { axis: 'y' });
      paint(g, (_p, _n, out) => out.copy(COL.cream));
      rigid(g, this.ruff);
    }

    // ---- Head: her fluffy round head, face, ears and bow (face.ts), in the head joint's space.
    this.face.build();
    const eyeParts: THREE.BufferGeometry[] = [], glintParts: THREE.BufferGeometry[] = [];
    for (const fp of this.face.parts) {
      const g = skin(bake(fp.geo, this.head.matrixWorld), B(fp.joint));
      if (fp.kind === 'fur') parts.push(g); else if (fp.kind === 'eye') eyeParts.push(g); else glintParts.push(g);
    }

    // ---- Legs: short soft tubes, chubby haunches, round white paws with pink beans underneath.
    for (const L of this.legs) {
      const up = L.fore
        ? down(revolveZ(tubeRings(-0.006, L.l1, (s) => 0.021 - 0.003 * s, 4, 3), 10))
        : down(revolveZ(tubeRings(0.0, L.l1, (s) => 0.0188 - 0.002 * s, 4, 3), 10));
      bake(up, L.upper.matrixWorld); paint(up, legCol(L.fore, false)); parts.push(skin(up, B(L.upper)));
      const lo = down(revolveZ(tubeRings(0, L.l2, (s) => 0.0172 - 0.0018 * s, 4, 3), 10));
      bake(lo, L.lower.matrixWorld); paint(lo, legCol(L.fore, true)); parts.push(skin(lo, B(L.lower)));
      const pg = starMesh(union(0.0045, ellipsoid(0, -0.002, 0.0065, 0.0185, 0.0125, 0.0235),
        ellipsoid(0.0088, -0.0035, 0.0215, 0.0078, 0.0082, 0.0078), ellipsoid(-0.0088, -0.0035, 0.0215, 0.0078, 0.0082, 0.0078), ellipsoid(0, -0.003, 0.0245, 0.0082, 0.0085, 0.0078)),
      new THREE.Vector3(0, -0.003, 0.008), 16, 11, { axis: 'y' });
      paint(pg, (p, n, out) => {
        out.copy(COL.white);
        if (n.y > -0.55) return out;
        const main = Math.hypot(p.x / 0.0085, (p.z - 0.001) / 0.0072);
        const toes = Math.min(Math.hypot((p.x - 0.0085) / 0.0042, (p.z - 0.0185) / 0.0045), Math.hypot((p.x + 0.0085) / 0.0042, (p.z - 0.0185) / 0.0045), Math.hypot(p.x / 0.0042, (p.z - 0.0225) / 0.0045));
        return out.lerp(COL.pad, sstep(1.15, 0.85, Math.min(main, toes)) * sstep(-0.55, -0.8, n.y));
      });
      rigid(pg, L.paw);
    }

    // ---- Tail: fluffy, thickest past its middle, ginger with soft dark rings and a cream tip, ending in a tuft.
    const T0 = new THREE.Vector3().setFromMatrixPosition(this.tail[0].matrixWorld), seg = REST.tailSeg, TL = seg * TAIL_N + 0.012;
    const tr = (s: number) => (0.0145 + 0.0055 * Math.sin(Math.PI * Math.min(1, s * 1.45) * 0.5) - 0.002 * sstep(0.6, 0.85, s)) * Math.pow(Math.max(0, 1 - sstep(0.84, 1.0, s)), 0.75) + 0.0012;
    const tlg = revolveZ(tubeRings(-0.008, TL, tr, 20, 3), 12);
    paint(tlg, (p, _n, out) => {
      const s = p.z / TL;
      mix(COL.ginger, COL.gingerD, sstep(0.6, 0.9, 0.5 + 0.5 * Math.cos((s - 0.12) * Math.PI * 2 * 4.2)) * sstep(0.05, 0.15, s) * (1 - sstep(0.7, 0.8, s)) * 0.6, out);
      return out.lerp(COL.cream, sstep(0.8, 0.9, s));
    });
    // Along -z from the first tail joint.
    tlg.scale(1, 1, -1); tlg.index!.array.reverse();
    tlg.computeVertexNormals();
    tlg.translate(T0.x, T0.y, T0.z);
    parts.push(skin(tlg, (p) => {
      const d = T0.z - p.z; // distance along the tail
      if (d < 0.012) { const w = sstep(-0.006, 0.012, d); return [B(this.pelvis), 1 - w, B(this.tail[0]), w]; }
      const k = d / seg - 0.5, i = Math.floor(k), f = k - i;
      if (i < 0) return [B(this.tail[0]), 1, 0, 0];
      if (i >= TAIL_N - 1) return [B(this.tail[TAIL_N - 1]), 1, 0, 0];
      const w = sstep(0, 1, f);
      return [B(this.tail[i]), 1 - w, B(this.tail[i + 1]), w];
    }));

    const geo = merge(parts);
    this.body = new THREE.SkinnedMesh(geo, fur);
    this.body.name = 'KittenBody';
    this.bindMesh(this.body);

    // ---- Eyes: on their own joints, so a blink squashes them; catchlights a second material.
    const eg = merge([...eyeParts, ...glintParts]);
    const nEye = eyeParts.reduce((a, g) => a + g.index!.count, 0);
    eg.addGroup(0, nEye, 0); eg.addGroup(nEye, eg.index!.count - nEye, 1);
    this.glintMat = toy('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.9, fade: this.fade });
    this.eyeMesh = new THREE.SkinnedMesh(eg, [toy('#ffffff', { vertexColors: true, rough: 0.16, fade: this.fade }), this.glintMat]);
    this.eyeMesh.name = 'KittenEyes';
    this.bindMesh(this.eyeMesh as THREE.SkinnedMesh);

    // ---- Armour: a rounded steel breastplate on her chest and a leather strap round her middle with a steel buckle.
    // Skinned like the coat under it, so it bends with her.
    this.armour = new THREE.SkinnedMesh(this.armourGeo(torso, torsoW, B), [metal(PAL.steel, 0.3, this.fade), toy('#ffffff', { vertexColors: true, rough: 0.8, fade: this.fade })]);
    this.armour.name = 'KittenArmour';
    this.bindMesh(this.armour);

    for (const m of [this.body, this.armour, this.eyeMesh]) {
      m.castShadow = true; m.receiveShadow = true;
      this.tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
    this.eyeMesh.castShadow = false;
  }

  private skeleton: THREE.Skeleton | null = null;
  private bindMesh(m: THREE.SkinnedMesh) {
    this.model.add(m);
    this.skeleton ??= new THREE.Skeleton(this.bones as THREE.Bone[]);
    m.bind(this.skeleton, new THREE.Matrix4());
    // Skinned bounds follow the pose loosely; a generous fixed sphere keeps her from being culled by mistake.
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.12, 0), 0.5);
    m.frustumCulled = false;
  }

  private armourGeo(torso: SDF, torsoW: (p: THREE.Vector3) => [number, number, number, number], B: (o: THREE.Object3D) => number) {
    const metalParts: THREE.BufferGeometry[] = [], leatherParts: THREE.BufferGeometry[] = [];
    const grad = (f: SDF, p: THREE.Vector3, out: THREE.Vector3) => {
      const e = 0.0005;
      return out.set(f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z), f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z), f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e)).normalize();
    };
    // Where a ray from c along d meets the torso, pushed out by `off`.
    const hit = (c: THREE.Vector3, d: THREE.Vector3, off: number, out: THREE.Vector3) => {
      let t0 = 0, t1 = 0.2;
      for (let i = 0; i < 30; i++) { const m = (t0 + t1) / 2; if (torso(c.x + d.x * m, c.y + d.y * m, c.z + d.z * m) > 0) t1 = m; else t0 = m; }
      out.copy(c).addScaledVector(d, t0);
      const n = grad(torso, out, new THREE.Vector3());
      return out.addScaledVector(n, off);
    };
    // Breastplate: a shield-shaped shell on the front of her chest, from her throat down between her forelegs,
    // with a rolled rim.
    {
      const c = new THREE.Vector3(0, 0.118, 0.054), D = new THREE.Vector3(0, -0.42, 1).normalize();
      const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3().crossVectors(D, X).normalize();
      const rhoMax = (th: number) => { const up = Math.cos(th); return 0.42 + 0.36 * sstep(-0.55, 0.5, up) - 0.05 * sstep(0.7, 1, up); };
      const dirAt = (th: number, rho: number, out: THREE.Vector3) => {
        const ax = X.clone().multiplyScalar(-Math.sin(th)).addScaledVector(Y, Math.cos(th));
        return out.copy(D).applyAxisAngle(new THREE.Vector3().crossVectors(D, ax).normalize(), rho);
      };
      const NT = 30, NR = 7;
      const pos: number[] = [], idx: number[] = [];
      const p = new THREE.Vector3(), d = new THREE.Vector3();
      hit(c, D, 0.0032, p); pos.push(p.x, p.y, p.z);
      for (let r = 1; r <= NR; r++) for (let t = 0; t < NT; t++) {
        const th = (t / NT) * Math.PI * 2;
        hit(c, dirAt(th, rhoMax(th) * r / NR, d), 0.0032, p); pos.push(p.x, p.y, p.z);
      }
      const at = (r: number, t: number) => (r === 0 ? 0 : 1 + (r - 1) * NT + (t % NT));
      for (let t = 0; t < NT; t++) idx.push(0, at(1, t), at(1, t + 1));
      for (let r = 1; r < NR; r++) for (let t = 0; t < NT; t++) idx.push(at(r, t), at(r + 1, t), at(r + 1, t + 1), at(r, t), at(r + 1, t + 1), at(r, t + 1));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      orientOut(g, c);
      g.computeVertexNormals();
      metalParts.push(g);
      // The rim: a little roll round the edge.
      const rim: THREE.Vector3[] = [];
      for (let t = 0; t < NT; t++) { const th = (t / NT) * Math.PI * 2; rim.push(hit(c, dirAt(th, rhoMax(th), d), 0.0034, new THREE.Vector3())); }
      metalParts.push(loopTube(rim, 0.0019, 5));
      // A boss in the middle of it.
      const boss = new THREE.SphereGeometry(0.0045, 10, 6); boss.deleteAttribute('uv'); boss.scale(1, 1, 0.5);
      const bc = hit(c, dirAt(0, 0.28, d), 0.0035, new THREE.Vector3()), bn = grad(torso, bc, new THREE.Vector3());
      boss.lookAt(bn); boss.translate(bc.x, bc.y, bc.z);
      metalParts.push(boss);
    }
    // Strap round her middle, with a buckle on her left side.
    {
      const z0 = -0.02, z1 = -0.002, NT = 36, NZ = 3;
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const p = new THREE.Vector3(), d = new THREE.Vector3(), cc = new THREE.Vector3();
      for (let k = 0; k <= NZ; k++) for (let t = 0; t < NT; t++) {
        const z = z0 + (z1 - z0) * k / NZ, th = (t / NT) * Math.PI * 2;
        cc.set(0, 0.105, z); d.set(Math.sin(th), Math.cos(th), 0);
        const edge = k === 0 || k === NZ;
        hit(cc, d, edge ? 0.0012 : 0.0028, p); pos.push(p.x, p.y, p.z);
        const c = edge ? COL.leatherD : COL.leather; col.push(c.r, c.g, c.b);
      }
      for (let k = 0; k < NZ; k++) for (let t = 0; t < NT; t++) {
        const a = k * NT + t, b = k * NT + (t + 1) % NT, c = a + NT, e = b + NT;
        idx.push(a, c, b, b, c, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      orientOut(g, new THREE.Vector3(0, 0.105, (z0 + z1) / 2));
      g.computeVertexNormals();
      leatherParts.push(g);
      // Buckle: a small square frame on her left flank.
      const bp = hit(new THREE.Vector3(0, 0.105, (z0 + z1) / 2), new THREE.Vector3(1, -0.15, 0).normalize(), 0.0035, new THREE.Vector3());
      const bn = grad(torso, bp, new THREE.Vector3());
      const bk = new THREE.TorusGeometry(0.0062, 0.0014, 5, 4); bk.deleteAttribute('uv');
      bk.rotateZ(Math.PI / 4); bk.scale(1, 1.25, 1);
      bk.lookAt(bn); bk.translate(bp.x, bp.y, bp.z);
      metalParts.push(bk);
    }
    // (No cap: nothing on her head but the bow.)
    const capParts: THREE.BufferGeometry[] = [];
    const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k); if (!g.attributes.color) paint(g, (_p, _n, o) => o.setRGB(1, 1, 1)); return g; };
    const mp = merge([...metalParts.map((g) => skin(strip(g), torsoW)), ...capParts.map((g) => skin(strip(g), B(this.head)))]);
    const lp = merge(leatherParts.map((g) => skin(strip(g), torsoW)));
    const all = merge([mp, lp]);
    all.addGroup(0, mp.index!.count, 0);
    all.addGroup(mp.index!.count, lp.index!.count, 1);
    return all;
  }
}


// Along -y (legs hang from their joints).
function down(g: THREE.BufferGeometry) { return g.rotateX(Math.PI / 2); }


// Winds every triangle to face away from c.
function orientOut(g: THREE.BufferGeometry, c: THREE.Vector3) {
  const p = g.attributes.position.array as Float32Array, ix = g.index!.array as any;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, d = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[a] + p[b] + p[d]) / 3 - c.x, my = (p[a + 1] + p[b + 1] + p[d + 1]) / 3 - c.y, mz = (p[a + 2] + p[b + 2] + p[d + 2]) / 3 - c.z;
    if (nx * mx + ny * my + nz * mz < 0) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
  }
}

// A closed tube round a loop of points.
function loopTube(pts: THREE.Vector3[], r: number, n: number) {
  const N = pts.length, pos: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    t.subVectors(pts[(i + 1) % N], pts[(i + N - 1) % N]).normalize();
    c.set(0, 0, 0); for (const q of pts) c.add(q); c.multiplyScalar(1 / N);
    a.subVectors(pts[i], c).addScaledVector(t, -t.dot(a.subVectors(pts[i], c))).normalize();
    b.crossVectors(t, a).normalize();
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      pos.push(pts[i].x + (a.x * Math.cos(th) + b.x * Math.sin(th)) * r, pts[i].y + (a.y * Math.cos(th) + b.y * Math.sin(th)) * r, pts[i].z + (a.z * Math.cos(th) + b.z * Math.sin(th)) * r);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < n; k++) {
    const p0 = i * n + k, p1 = i * n + (k + 1) % n, q0 = ((i + 1) % N) * n + k, q1 = ((i + 1) % N) * n + (k + 1) % n;
    idx.push(p0, q0, p1, p1, q0, q1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Face away from the tube's own centre line.
  const P = g.attributes.position.array as Float32Array, ix = g.index!.array as any;
  for (let tt = 0; tt < ix.length; tt += 3) {
    const i0 = Math.floor(ix[tt] / n);
    const cx = pts[i0].x, cy = pts[i0].y, cz = pts[i0].z;
    const A = ix[tt] * 3, Bb = ix[tt + 1] * 3, D = ix[tt + 2] * 3;
    const ux = P[Bb] - P[A], uy = P[Bb + 1] - P[A + 1], uz = P[Bb + 2] - P[A + 2], vx = P[D] - P[A], vy = P[D + 1] - P[A + 1], vz = P[D + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (P[A] - cx) + ny * (P[A + 1] - cy) + nz * (P[A + 2] - cz) < 0) { const s = ix[tt + 1]; ix[tt + 1] = ix[tt + 2]; ix[tt + 2] = s; }
  }
  g.computeVertexNormals();
  return g;
}

