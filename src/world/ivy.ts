// Ivy over a climbable face, so the player can read where the kitten can climb: a handful of vines growing up from the
// ground, wandering and branching a little, with leaves along them, thick at the foot and thinning toward the top.
// One instanced draw of leaves and one merged mesh of stems per face.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './noise';

export type IvyFace = { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; y0: number; y1: number };

// An ivy leaf (Hedera) in its own plane, base at the origin and tip at +Y: a long pointed middle lobe, two side
// lobes and two small ones at the base, folded along the midrib and cupped a little, lighter along the veins.
function leafGeometry() {
  const half = [[0, 0.06], [-0.2, 0.0], [-0.34, 0.05], [-0.3, 0.17], [-0.5, 0.33], [-0.42, 0.42], [-0.22, 0.47], [-0.19, 0.64], [-0.09, 0.82], [0, 1]];
  const outline = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  const C = [0, 0.4];
  const pos: number[] = [C[0], C[1], 0.07], col: number[] = [1.25, 1.25, 1.1];
  for (const [x, y] of outline) {
    const fold = 0.09 * Math.abs(x); // the halves rise from the midrib
    pos.push(x, y, fold + 0.02 * Math.sin(Math.PI * y));
    col.push(0.8, 0.8, 0.82);
  }
  const idx: number[] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createIvy(face: IvyFace, seed: number, density = 1) {
  const group = new THREE.Group();
  group.name = 'Ivy';
  const r = mulberry32(seed);
  const len = Math.hypot(face.bx - face.ax, face.bz - face.az);
  const tx = (face.bx - face.ax) / len, tz = (face.bz - face.az) / len;
  const H = face.y1 - face.y0;
  const at = (u: number, y: number, out = 0) => new THREE.Vector3(face.ax + tx * u + face.nx * out, y, face.az + tz * u + face.nz * out);
  // Vines: random walks up the face from the ground.
  const vines: THREE.Vector3[][] = [];
  const nVines = Math.max(3, Math.round(len * 5 * density));
  for (let i = 0; i < nVines; i++) {
    let u = (i + 0.2 + r() * 0.6) / nVines * len, y = face.y0 - 0.05;
    const top = face.y0 + H * (0.55 + 0.47 * r());
    const path = [at(u, y, 0.006)];
    let drift = (r() - 0.5) * 0.4;
    while (y < top) {
      y += 0.035 + r() * 0.02;
      drift = THREE.MathUtils.clamp(drift + (r() - 0.5) * 0.35, -0.8, 0.8);
      u = THREE.MathUtils.clamp(u + drift * 0.025, 0.02, len - 0.02);
      path.push(at(u, Math.min(y, face.y1), 0.006 + r() * 0.004));
    }
    vines.push(path);
    // A side shoot now and then.
    if (path.length > 12 && r() < 0.7) {
      const k = 4 + Math.floor(r() * (path.length - 8));
      const p0 = path[k];
      const s = r() < 0.5 ? -1 : 1;
      const shoot = [p0.clone()];
      let su = (p0.x - face.ax) * tx + (p0.z - face.az) * tz, sy = p0.y;
      for (let j = 0; j < 6 + r() * 8; j++) { su = THREE.MathUtils.clamp(su + s * (0.03 + r() * 0.02), 0.02, len - 0.02); sy += 0.015 + r() * 0.025; shoot.push(at(su, Math.min(sy, face.y1), 0.006)); }
      vines.push(shoot);
    }
  }
  // Stems: thin tubes along the vines, merged.
  const stemGeos: THREE.BufferGeometry[] = [];
  for (const v of vines) {
    if (v.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(v);
    stemGeos.push(new THREE.TubeGeometry(curve, v.length * 2, 0.0045, 4, false));
  }
  if (stemGeos.length) {
    const merged = mergeGeometries(stemGeos);
    const stem = new THREE.Mesh(merged, new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#3b3326'), roughness: 0.85 }));
    stem.castShadow = false; stem.receiveShadow = true;
    group.add(stem);
  }
  // Leaves along the vines: thicker low down, each tilted out from the stone with its tip hanging down a little.
  const leaves: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const nrm = new THREE.Vector3(face.nx, 0, face.nz), side = new THREE.Vector3(tx, 0, tz), up = new THREE.Vector3(0, 1, 0);
  const pal = ['#2c4322', '#3a5429', '#4a6331', '#33492a', '#566b3a'].map((c) => new THREE.Color(c));
  for (const v of vines) {
    for (let i = 1; i < v.length; i++) {
      const h = (v[i].y - face.y0) / Math.max(0.01, H);
      const per = (2.4 - 1.4 * h) * density;
      for (let j = 0; j < per; j++) {
        if (r() > per - j) break;
        const s = 0.034 + r() * 0.03 * (1.15 - 0.4 * h);
        const off = side.clone().multiplyScalar((r() - 0.5) * 0.07).add(up.clone().multiplyScalar((r() - 0.5) * 0.03));
        const p = v[i].clone().add(off).addScaledVector(nrm, 0.01 + r() * 0.025);
        // Leaf frame: its plane mostly facing out (normal ~ n), tip pointing down and out, spun a little.
        const tipDir = up.clone().multiplyScalar(-0.35 - r() * 0.5).add(side.clone().multiplyScalar((r() - 0.5) * 1.6)).addScaledVector(nrm, 0.25 + r() * 0.4).normalize();
        const z = nrm.clone().addScaledVector(up, 0.25 + r() * 0.35).addScaledVector(side, (r() - 0.5) * 0.6).normalize();
        const x = new THREE.Vector3().crossVectors(tipDir, z).normalize();
        const zz = new THREE.Vector3().crossVectors(x, tipDir).normalize();
        const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(s), tipDir.multiplyScalar(s), zz.multiplyScalar(s));
        m.setPosition(p);
        leaves.push(m);
        cols.push(pal[Math.floor(r() * pal.length)].clone().multiplyScalar(0.85 + r() * 0.3));
      }
    }
  }
  const leafMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, side: THREE.DoubleSide, vertexColors: true });
  const inst = new THREE.InstancedMesh(leafGeometry(), leafMat, Math.max(1, leaves.length));
  leaves.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[i]); });
  inst.count = leaves.length;
  inst.castShadow = true; inst.receiveShadow = true;
  inst.frustumCulled = false;
  group.add(inst);
  return group;
}

// Minimal geometry merge for non-indexed or indexed tubes (positions, normals and indices only).
function mergeGeometries(geos: THREE.BufferGeometry[]) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, ov * 3);
    nor.set(g.attributes.normal.array as Float32Array, ov * 3);
    const c = g.attributes.position.count;
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi + i] = a[i] + ov; oi += a.length; }
    else { for (let i = 0; i < c; i++) idx[oi + i] = ov + i; oi += c; }
    ov += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
