// The toy knight's parts (v3): rigid rounded pieces hung on the scaled mannequin's bones like a wooden doll's,
// overlapping at the joints. A flat-topped great helm in plain steel (eye slit, breathing holes, a steel cross of
// reinforcing bands); a white tabard with a bold black cross front and back, belted at the waist and falling in a
// front and a back flap to mid-thigh, split at the sides; under it a near-black quilted gambeson (padded shoulders,
// sleeves and a knee-length skirt in six panels that swing clear of the legs), dark trousers, tall dark boots with
// turned cuffs, steel vambraces and big mitten gauntlets (one morph curls them from open to a fist), and a
// longsword in its scabbard at his left hip with a pale pink ribbon round the grip. The wounded outfit adds a broken
// spear in his left shoulder and blood soaked into the tabard.
//
// Torso and leg pieces are made in character space at rest (the knight standing at the origin facing +Z, his left
// +X), arm pieces in the arm's own frame (hanging down -Y, thumb +Z, his left +X), all for the left side; the right
// side is the mirror image.
import * as THREE from 'three';
import { toy, metal, PAL, Fade } from '../../render/materials';
import type { Avatar } from '../avatar';
import { lathe, blob, tube, smooth, xf, mirrorX, merge, coat, vnoise, hash, Col } from './shapes';

type G = THREE.BufferGeometry;
const C = (h: string) => new THREE.Color(h);

// Colours (sRGB).
export const KC = {
  steel: PAL.steel, steelDark: '#9aa4ae', trim: '#aeb6bf', brass: PAL.gold, slit: '#101216', cross: '#18181c',
  gambeson: '#36363d', gambesonDark: '#2a2a30', seam: '#1f1f24', trousers: '#2c2c32',
  tabard: '#eeeae0', tabardEdge: '#d6d0c2',
  boot: '#2c221d', bootCuff: '#4a3a2f', sole: '#17110e', belt: '#4b3121', grip: '#3a2618', scabbard: '#40291c',
  ribbon: '#f7cdd6', ribbonDark: '#eab3c0', wood: '#9b6b40', woodLight: '#d0a46e', blood: '#6e0f14', bloodDark: '#4a0a0e',
};

// Points on the gauntlet (left hand's frame: wrist at 0, fingers -Y, palm -X, thumb +Z).
const GS = 1.08; // armour adds a cuff, without turning a proportional hand into an oversized mitten
export const HAND = {
  palm: new THREE.Vector3(-0.036, -0.085, 0.004).multiplyScalar(GS), // the palm's middle, facing -X
  grip: new THREE.Vector3(-0.034, -0.103, 0.0).multiplyScalar(GS), // through the curled fingers (a fist's hole), along Z
};
// The helm's middle in the head bone's frame; the wound and the spear in the chest's (spine_02) frame.
// The original bucket occupied nearly a quarter of his height. Keep its collar-level pivot and details but
// compress it to a human great helm; the same mapping is used by gaze/collision probes as by the geometry.
export function helmShape(p: THREE.Vector3) { return p.set(p.x * 0.84, 1.39 + (p.y - 1.372) * 0.72, p.z * 0.84); }
export const HELM_CENTRE = new THREE.Vector3(0, 0.124, 0.01);
// The eye slit's middle on the helm's front (character space at rest).
export const EYE = helmShape(new THREE.Vector3(0, 1.634, 0.179 * 1.05 + 0.012 + 0.016));
// The wound: on the tabard round from the front toward his left (phi), at a height at rest.
export const WOUND_AT = { phi: 0.74, y: 1.245 };

export type Panel = {
  upper: THREE.Bone; lower: THREE.Bone; // belt to mid-thigh, and below (hinged)
  side: number; // +1 his left
  phi: number; // its middle, from the front toward his left
  axis: THREE.Vector3; // outward swing axis; n: outward (pelvis frame)
  n: THREE.Vector3;
  pivot: THREE.Vector3; // the top's middle (pelvis frame); hinge relative to it; hem relative to the hinge (at rest)
  hinge: THREE.Vector3; hem: THREE.Vector3;
  len1: number; len2: number;
  b1: number; b2: number; // rest flare of each part from straight down
  a1: number; v1: number; a2: number; v2: number; // swing outward (the lower's measured from straight down)
  half: number; // half its width
  samples: number[]; // skirt vertices (ends and middle, both faces, from the hinge down) kept off the ground
  over: number[]; // the panels it lies over (a tabard flap over the gambeson): it swings at least as far out
};

// A part as it was made, now a range of one of the three skinned meshes: its vertices, the bone it rides, and its
// vertex positions in that bone's space (at rest) for measuring.
export type Part = { name: string; mesh: THREE.SkinnedMesh; start: number; count: number; bone: THREE.Object3D; local: Float32Array | null };

export type KnightModel = {
  fade: Fade;
  // Everything he wears in three skinned meshes on one skeleton: cloth (vertex coloured), steel (vertex coloured;
  // morphs 0-1 curl the left gauntlet, 2-3 the right) and blood (shown when wounded; the same morphs).
  meshes: THREE.SkinnedMesh[];
  cloth: THREE.SkinnedMesh; steel: THREE.SkinnedMesh; blood: THREE.SkinnedMesh;
  parts: Part[];
  panels: Panel[];
  skirtHolder: THREE.Object3D;
  scabbard: THREE.Bone;
  drawnSword: THREE.Bone; // long blade held upright at rest; baked into the same meshes
  spear: THREE.Bone; // scaled to nothing unless wounded
  pauldrons: { mesh: THREE.Object3D; side: 'l' | 'r'; relC: THREE.Quaternion; relU: THREE.Quaternion; off: THREE.Vector3 }[];
  stain: { attr: THREE.BufferAttribute; clean: Float32Array; bloody: Float32Array };
};

// ---- Materials: one shared dissolve for everything he wears.
function bloodMaterial(fade: Fade) {
  const m = toy(KC.blood, { rough: 0.38, fade });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float stain;\nvarying float vStain;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStain = stain;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStain;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vStain < 0.5) discard;');
  };
  m.customProgramCacheKey = () => 'toyBloodFade';
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  return m;
}

// ---- Helpers.
const smoothstep = THREE.MathUtils.smoothstep;
const lerpC = (a: string, b: string, t: number) => C(a).lerp(C(b), THREE.MathUtils.clamp(t, 0, 1));

// The cuirass surface (character space): its radius profile with a full breast and a faint middle ridge.
const CUIRASS_PROF: [number, number][] = smooth([[0.925, 0.176], [0.94, 0.181], [0.975, 0.176], [1.04, 0.178], [1.12, 0.188], [1.2, 0.184], [1.265, 0.168], [1.315, 0.14], [1.345, 0.108], [1.36, 0.096]], 3);
const CUI_SZ = 0.8, CUI_Z = 0.012;
function cuirassR(y: number) {
  const p = CUIRASS_PROF;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (y <= p[i][0]) { const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t; }
  return p[p.length - 1][1];
}
function cuirassDeform(v: THREE.Vector3, phi: number, extra = 0) {
  const y = v.y;
  const front = Math.max(0, Math.cos(phi));
  const breast = 0.03 * front * front * Math.exp(-(((y - 1.13) / 0.12) ** 2));
  const ridge = 0.006 * Math.exp(-((phi / 0.16) ** 2)) * smoothstep(y, 0.95, 1.02) * (1 - smoothstep(y, 1.26, 1.32));
  v.z += (breast + ridge) * Math.cos(phi) + CUI_Z;
  if (extra) { const n = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi) / CUI_SZ).normalize(); v.addScaledVector(n, extra); }
}
export function cuirassPoint(phi: number, y: number, extra = 0, out = new THREE.Vector3()) {
  const r = cuirassR(y);
  out.set(Math.sin(phi) * r, y, Math.cos(phi) * r * CUI_SZ);
  cuirassDeform(out, phi, extra);
  return out;
}

// The tabard over the torso: the body's surface pushed out along its normal.
const TAB_OFF = 0.012;
function bodyNormal(phi: number, y: number) {
  const e = 0.003, yy = Math.min(y, 1.352);
  const a = cuirassPoint(phi + e, yy), b = cuirassPoint(phi - e, yy), c = cuirassPoint(phi, yy + e), d = cuirassPoint(phi, yy - e);
  return a.sub(b).cross(c.sub(d)).normalize();
}
export function tabardPoint(phi: number, y: number, extra = 0, out = new THREE.Vector3()) {
  const yy = Math.min(y, 1.352);
  return cuirassPoint(phi, yy, 0, out).addScaledVector(bodyNormal(phi, yy), TAB_OFF + extra);
}

// A sheet over the torso: rows of heights (bottom to top), each spanning phi range `span(y)`, `cols` columns.
function sheet(rows: number[], span: (y: number) => [number, number], cols: number, color: (phi: number, y: number) => THREE.Color, extra = 0) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (const y of rows) {
    const [a, b] = span(y);
    for (let j = 0; j <= cols; j++) {
      const phi = a + ((b - a) * j) / cols;
      tabardPoint(phi, y, extra, v);
      pos.push(v.x, v.y, v.z);
      const c = color(phi, y);
      col.push(c.r, c.g, c.b);
    }
  }
  const w = cols + 1;
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A cross pattée on the tabard: a square middle and four arms flaring to their ends, each a subdivided patch laid
// on the surface (u across, v up, metres) round phiC at height yc.
function crossPatee(phiC: number, yc: number, size: number, color: string) {
  const h0 = size * 0.13, L = size * 0.5, wE = size * 0.27;
  const quads: [number, number][][] = [
    [[-h0, -h0], [h0, -h0], [h0, h0], [-h0, h0]],
    [[h0, -h0], [L, -wE], [L, wE], [h0, h0]],
    [[-L, -wE], [-h0, -h0], [-h0, h0], [-L, wE]],
    [[-h0, h0], [h0, h0], [wE, L], [-wE, L]],
    [[-wE, -L], [wE, -L], [h0, -h0], [-h0, -h0]],
  ];
  const parts: G[] = [];
  const n = 5;
  for (const [p0, p1, p2, p3] of quads) {
    const pos: number[] = [], idx: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const s = j / n, t = i / n;
      const bot = [p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s], top = [p3[0] + (p2[0] - p3[0]) * s, p3[1] + (p2[1] - p3[1]) * s];
      const u = bot[0] + (top[0] - bot[0]) * t, w = bot[1] + (top[1] - bot[1]) * t;
      const y = yc + w;
      const facing = Math.cos(phiC) >= 0 ? 1 : -1;
      tabardPoint(phiC + (facing * u) / cuirassR(y), y, 0.0028, v);
      pos.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    // Facing out from the body.
    const P0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 0), P1 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 1), P2 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, n + 1);
    const nrm = P1.sub(P0).cross(P2.sub(P0));
    if (nrm.dot(bodyNormal(phiC, yc)) < 0) { const ia = g.index!.array as any; for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; } }
    g.computeVertexNormals();
    parts.push(paintG(g, color));
  }
  return merge(parts);
}
function paintG(g: G, color: string) {
  const c = C(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// The helm's profile (character space at rest).
const HELM_PROF: [number, number][] = [[1.372, 0.0], [1.373, 0.12], [1.376, 0.155], [1.383, 0.166], [1.395, 0.169], ...smooth([[1.41, 0.17], [1.5, 0.178], [1.6, 0.179], [1.7, 0.174], [1.752, 0.165]], 2), [1.775, 0.163], [1.79, 0.159], [1.798, 0.154], [1.8, 0.153], [1.8, 0.0]];
const HELM_SZ = 1.05, HELM_Z = 0.012;
function helmR(y: number) {
  const p = HELM_PROF;
  for (let i = 3; i < p.length; i++) if (y <= p[i][0]) { const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0] || 1); return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t; }
  return 0.07;
}
function helmDeform(v: THREE.Vector3, phi: number, extra = 0) {
  const keel = 0.016 * Math.exp(-((phi / 0.3) ** 2)) * smoothstep(v.y, 1.38, 1.46);
  const r = Math.hypot(v.x, v.z / HELM_SZ);
  if (r > 1e-5) { const k = (r + keel + extra) / r; v.x *= k; v.z *= k; }
  v.z += HELM_Z;
}
function helmPoint(phi: number, y: number, extra = 0) {
  const r = helmR(y);
  const v = new THREE.Vector3(Math.sin(phi) * r, y, Math.cos(phi) * r * HELM_SZ);
  helmDeform(v, phi, extra);
  return v;
}

// A raised strip on a surface of revolution: across `phi0..phi1`, `y0..y1`, `h` proud of it, edges eased.
function band(surfR: (y: number) => number, deform: (v: THREE.Vector3, phi: number, extra: number) => void, sz: number, y0: number, y1: number, phi0: number, phi1: number, h: number, color: Col, segs = 16, rows = 4) {
  const prof: [number, number][] = [];
  prof.push([y0 - 0.001, 0]);
  for (let i = 0; i <= rows; i++) { const y = y0 + ((y1 - y0) * i) / rows; prof.push([y, 1]); }
  prof.push([y1 + 0.001, 0]);
  const yy = prof.map((p) => p[0]);
  return lathe(yy.map((y) => [y, surfR(y)] as [number, number]), {
    segs, phi0, phiLen: phi1 - phi0, sz, color,
    deform: (v, phi, _t, i) => {
      const up = prof[i][1];
      const edge = Math.min(smoothstep(phi, phi0, phi0 + 0.04), 1 - smoothstep(phi, phi1 - 0.04, phi1));
      deform(v, phi, -0.002 + (h + 0.002) * up * (0.35 + 0.65 * edge));
    },
  });
}

// A small dome stud on a surface point, facing n.
function stud(p: THREE.Vector3, n: THREE.Vector3, r: number, h: number, color: Col, segs = 10) {
  const g = lathe([[-0.004, r * 1.02], [0, r], [h * 0.6, r * 0.8], [h, 0]], { segs, color });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
  g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
  return g;
}

// A quilted shell panel: a slice (phi0..phi1) of a surface of revolution with thickness, its outer face channelled
// by vertical stitching; all edges closed.
function quiltPanel(prof: [number, number][], o: { phi0: number; phi1: number; sx: number; sz: number; thick: number; segs: number; channels: number; color: (u: number, t: number, outer: boolean) => THREE.Color }) {
  const plain = o.channels === 0;
  const n = prof.length, segs = o.segs;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const L: number[] = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const total = L[n - 1];
  // A cross-section loop per column: outer top→bottom, then inner bottom→top.
  const loop = 2 * n;
  for (let j = 0; j <= segs; j++) {
    const u = j / segs, phi = o.phi0 + (o.phi1 - o.phi0) * u;
    const quilt = plain ? 0 : Math.abs(Math.sin(u * Math.PI * o.channels));
    const edge = Math.min(1, u * 8, (1 - u) * 8);
    for (let k = 0; k < loop; k++) {
      const outer = k < n;
      const i = outer ? k : loop - 1 - k;
      const [y, r0] = prof[i];
      const t = L[i] / total;
      const r = outer ? r0 + 0.006 * Math.sqrt(quilt) * edge : r0 - o.thick;
      pos.push(Math.sin(phi) * r * o.sx, y, Math.cos(phi) * r * o.sz);
      const c = o.color(u, t, outer);
      if (outer && !plain) c.multiplyScalar(0.8 + 0.2 * Math.sqrt(quilt));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < segs; j++) for (let k = 0; k < loop; k++) {
    const k1 = (k + 1) % loop;
    const a = j * loop + k, b = j * loop + k1, c = (j + 1) * loop + k, d = (j + 1) * loop + k1;
    idx.push(a, b, c, b, d, c);
  }
  // Side caps.
  for (const j of [0, segs]) for (let i = 0; i < n - 1; i++) {
    const a = j * loop + i, b = j * loop + i + 1, c = j * loop + (loop - 1 - i), d = j * loop + (loop - 2 - i);
    if (j === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The gauntlet (left hand frame), at a finger curl c (0 open .. 1 fist).
function gauntletShape(c: number) {
  const steel = KC.steel, dark = KC.steelDark;
  const parts: G[] = [];
  // Cuff: a flared bell over the wrist.
  parts.push(lathe(smooth([[0.03, 0.044], [0.0, 0.05], [-0.025, 0.06], [-0.034, 0.058]], 2).concat([[-0.038, 0.0]]), { segs: 16, sx: 0.88, color: (p) => C(p.y > 0.0 ? steel : dark) }));
  // Back of the hand and palm.
  parts.push(blob(0.031, 0.05, 0.053, { p: 3.2, segs: 14, rings: 10, color: steel, deform: (v) => { v.y -= 0.062; v.x -= 0.002; v.z += 0.003; if (v.x > 0) v.x *= 1 + 0.25 * Math.exp(-(((v.y + 0.09) / 0.02) ** 2)); } }));
  // Fingers: one block of three lames, bent about the knuckle line toward the palm.
  const yk = -0.098, L = 0.092, xa = -0.004;
  const theta = 0.25 + c * 2.85, R = L / theta;
  const bend = (v: THREE.Vector3) => {
    const s = yk - v.y;
    if (s <= 0) return;
    const e = v.x - xa;
    const th = (s / L) * theta;
    v.x = xa - R + (R + e) * Math.cos(th);
    v.y = yk - (R + e) * Math.sin(th);
  };
  parts.push(blob(0.025, 0.052, 0.051, {
    p: 3.0, segs: 14, rings: 14, color: (p) => C(p.x > 0.0 && Math.abs(Math.sin(((p.y + 0.098) / 0.03) * Math.PI)) < 0.25 ? dark : steel),
    deform: (v) => {
      v.y -= 0.142; v.x -= 0.004;
      // Lames: grooves across the back; finger lines down the front.
      const s = yk - v.y;
      if (v.x > 0) v.x -= 0.004 * Math.exp(-((((s % 0.03) - 0.015) / 0.004) ** 2)) * (s > 0.005 ? 1 : 0);
      bend(v);
    },
  }));
  // Knuckle ridge.
  parts.push(tube((t) => new THREE.Vector3(0.022, -0.098, -0.046 + 0.092 * t), () => 0.011, { steps: 6, segs: 8, color: steel }));
  // Thumb: from the side of the palm down beside the fingers (open) or across their front (fist).
  const a = new THREE.Vector3(-0.008, -0.035, 0.048);
  const tipOpen = new THREE.Vector3(-0.03, -0.128, 0.07), tipFist = new THREE.Vector3(-0.088, -0.13, 0.012);
  const tip = tipOpen.clone().lerp(tipFist, Math.min(1, c * 1.15));
  const mid = a.clone().lerp(tip, 0.5).add(new THREE.Vector3(-0.012 - 0.01 * c, 0, 0.016 * (1 - c) + 0.012));
  const curve = new THREE.QuadraticBezierCurve3(a, mid, tip);
  parts.push(tube((t) => curve.getPoint(t), (t) => 0.021 - 0.004 * t, { steps: 8, segs: 10, color: steel }));
  return xf(merge(parts), [0, 0, 0], [0, 0, 0], GS);
}
function gauntletGeometry() {
  const g0 = gauntletShape(0.12), g1 = gauntletShape(0.55), g2 = gauntletShape(1);
  g0.morphAttributes.position = [g1.attributes.position, g2.attributes.position];
  g0.morphAttributes.normal = [g1.attributes.normal, g2.attributes.normal];
  return g0;
}

export function buildKnight(av: Avatar): KnightModel {
  const fade: Fade = { value: 1 };
  const clothM = toy('#ffffff', { vertexColors: true, fade, rough: 0.88 });
  const steelM = metal('#ffffff', 0.3, fade); steelM.vertexColors = true;
  const bloodM = bloodMaterial(fade);
  const meshes: THREE.Mesh[] = [];
  const stains: KnightModel['stain'][] = [];
  const P = (n: string) => av.restP.get(n)!;

  // A mesh on a bone: geometry made in character space at rest (torso, legs) or in the bone's canonical frame (arms).
  const on = (bone: string, g: G, m: THREE.Material, abs = true) => {
    if (abs) { const p = P(bone); g.translate(-p.x, -p.y, -p.z); }
    const mesh = new THREE.Mesh(g, m);
    mesh.name = bone;
    mesh.quaternion.copy(av.canonFrame(bone));
    av.bones[bone].add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  // Blood soaked into cloth: the part's colours, and the same darkened by a mask (swapped by the outfit).
  const soak = (mesh: THREE.Mesh, mask: (p: THREE.Vector3) => number, abs0: THREE.Vector3 | null = null, k = 0.8) => {
    const g = mesh.geometry, pos = g.attributes.position, colA = g.attributes.color as THREE.BufferAttribute;
    const clean = (colA.array as Float32Array).slice(), bloody = clean.slice();
    const p = new THREE.Vector3(), bc = C(KC.blood), bd = C(KC.bloodDark);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      if (abs0) p.add(abs0);
      const m = THREE.MathUtils.clamp(mask(p), 0, 1);
      if (m <= 0) continue;
      const target = bc.clone().lerp(bd, 0.6 + 0.4 * vnoise(p.x * 60, p.y * 60));
      const c = new THREE.Color(clean[i * 3], clean[i * 3 + 1], clean[i * 3 + 2]).lerp(target, m * k);
      bloody[i * 3] = c.r; bloody[i * 3 + 1] = c.g; bloody[i * 3 + 2] = c.b;
    }
    stains.push({ attr: colA, clean, bloody });
  };

  // ================= Helm (Head).
  const helmParts: G[] = [];
  helmParts.push(lathe(HELM_PROF, {
    segs: 36, sz: HELM_SZ, color: (p) => C(p.y < 1.378 ? KC.slit : KC.steel),
    deform: (v, phi) => helmDeform(v, phi),
  }));
  // Rolled rim round the bottom edge.
  helmParts.push(tube((t) => { const phi = t * Math.PI * 2; return helmPoint(phi, 1.384, 0.002); }, () => 0.007, { steps: 36, segs: 5, caps: 'none', color: KC.steel }));
  // Eye slit (both sides of the bar), the brow band above it and the bar down the face: a cross of steel bands.
  for (const s of [1, -1]) {
    const g = band(helmR, helmDeform, HELM_SZ, 1.622, 1.646, s > 0 ? 0.05 : -1.08, s > 0 ? 1.08 : -0.05, 0.0005, KC.slit, 10, 1);
    helmParts.push(g);
  }
  helmParts.push(band(helmR, helmDeform, HELM_SZ, 1.652, 1.682, -1.2, 1.2, 0.0055, KC.trim, 22, 2));
  {
    // The vertical bar: down the keel from the top to the rim.
    const prof: [number, number][] = [];
    for (let y = 1.39; y <= 1.785; y += 0.04) prof.push([y, helmR(y)]);
    helmParts.push(lathe(prof, {
      segs: 6, phi0: -0.115, phiLen: 0.23, sz: HELM_SZ, color: KC.trim,
      deform: (v, phi) => { const e = 1 - smoothstep(Math.abs(phi), 0.085, 0.115); helmDeform(v, phi, -0.002 + 0.008 * e); },
    }));
    // Over the top edge.
    helmParts.push(tube((t) => { const y = 1.775 + t * 0.026; const p = helmPoint(0, Math.min(1.8, y), 0.004); if (t > 0.6) { p.z -= (t - 0.6) * 0.05; p.y = 1.8 + 0.004; } return p; }, () => 0.012, { steps: 6, segs: 8, sx: 1.6, color: KC.trim }));
  }
  // Breathing holes: a little cross of them each side of the bar, low on the face.
  for (const s of [1, -1]) for (const [dp, dy] of [[0, 0], [0.07, 0], [-0.07, 0], [0, 0.034], [0, -0.034]]) {
    const phi = s * (0.42 + dp), y = 1.52 + dy;
    const p = helmPoint(phi, y, 0.0), n = helmPoint(phi, y, 0.01).sub(p).normalize();
    helmParts.push(stud(p, n, 0.0085, 0.0015, KC.slit, 8));
  }
  // Rivets along the brow band.
  for (const phi of [-1.0, -0.6, 0.6, 1.0]) {
    const p = helmPoint(phi, 1.667, 0.0055), n = helmPoint(phi, 1.667, 0.02).sub(p).normalize();
    helmParts.push(stud(p, n, 0.007, 0.005, KC.steel, 8));
  }
  const helm = merge(helmParts), hp = helm.attributes.position;
  const hv = new THREE.Vector3();
  for (let i = 0; i < hp.count; i++) { helmShape(hv.fromBufferAttribute(hp, i)); hp.setXYZ(i, hv.x, hv.y, hv.z); }
  helm.computeVertexNormals();
  on('Head', helm, steelM);

  // ================= Torso (spine_02): the gambeson body and padded collar, the tabard over them.
  const bodyParts: G[] = [];
  bodyParts.push(lathe(CUIRASS_PROF, {
    segs: 30, sz: CUI_SZ, deform: (v, phi) => cuirassDeform(v, phi),
    color: (p) => C(KC.gambeson).multiplyScalar(0.85 + 0.15 * Math.abs(Math.sin(p.y * 70))),
  }));
  bodyParts.push(lathe(smooth([[1.31, 0.0], [1.315, 0.104], [1.345, 0.112], [1.38, 0.104], [1.4, 0.088], [1.402, 0.0]], 2), {
    segs: 20, sz: 0.92, color: (p) => C(KC.gambeson).multiplyScalar(0.8 + 0.2 * Math.abs(Math.sin(Math.atan2(p.x, p.z) * 6))),
  }));
  // The tabard: front and back from the belt up, meeting over the shoulders; rolled edges; a cross on each.
  const TW = 1.0; // its half-width round the body below the shoulders (radians)
  const span = (back: boolean) => (y: number): [number, number] => {
    const w = TW + (Math.PI / 2 - TW) * smoothstep(y, 1.25, 1.335);
    return back ? [Math.PI - w, Math.PI + w] : [-w, w];
  };
  const TROWS: number[] = [];
  for (let y = 0.895; y < 1.352; y += 0.017) TROWS.push(y);
  TROWS.push(1.352);
  const white = () => C(KC.tabard);
  const tabParts: G[] = [sheet(TROWS, span(false), 30, white), sheet(TROWS, span(true), 26, white)];
  for (const back of [false, true]) {
    const sp = span(back);
    for (const k of [0, 1]) {
      // Down each side edge (to where the halves meet over the shoulder).
      tabParts.push(tube((t) => { const y = 0.9 + t * (1.3 - 0.9); return tabardPoint(sp(y)[k], y, 0.001); }, () => 0.0065, { steps: 18, segs: 5, caps: 'none', color: KC.tabardEdge }));
    }
    // Round the neck.
    tabParts.push(tube((t) => { const [a, b] = sp(1.352); return tabardPoint(a + (b - a) * t, 1.352, 0.001); }, () => 0.0065, { steps: 18, segs: 5, caps: 'none', color: KC.tabardEdge }));
  }
  tabParts.push(crossPatee(0, 1.135, 0.2, KC.cross), crossPatee(Math.PI, 1.12, 0.2, KC.cross));
  on('spine_02', merge(bodyParts), clothM).name = 'body';
  const tabard = on('spine_02', merge(tabParts), clothM);
  tabard.name = 'tabard';

  // ================= Gambeson under it: the waist (spine_01) and hips with the belt (pelvis).
  on('spine_01', lathe(smooth([[0.9, 0.16], [0.97, 0.168], [1.05, 0.165], [1.1, 0.15]], 3), { segs: 24, sz: 0.8, color: KC.gambesonDark, deform: (v) => { v.z += 0.01; } }), clothM);
  const hipParts: G[] = [];
  hipParts.push(lathe(smooth([[0.72, 0.0], [0.725, 0.07], [0.75, 0.13], [0.8, 0.16], [0.86, 0.172], [0.92, 0.172], [0.96, 0.165]], 2).concat([[0.965, 0.0]]), { segs: 22, sx: 1.12, sz: 0.82, color: KC.gambesonDark, deform: (v) => { v.z += 0.005; } }));
  // The belt over the tabard's waist (following the skirt's oval, proud of the tabard's flaps), slung a little lower
  // on the left where the scabbard hangs; brass buckle in front.
  const beltY = (phi: number) => 0.912 - 0.012 * Math.max(0, Math.sin(phi));
  const BR = 0.229;
  hipParts.push(lathe([[-0.019, BR - 0.008], [-0.021, BR], [0.021, BR], [0.019, BR - 0.008]], {
    segs: 32, sx: 1.14, sz: 0.9, color: KC.belt, deform: (v, phi) => { v.y += beltY(phi); },
  }));
  hipParts.push(blob(0.036, 0.028, 0.009, { p: 4, segs: 12, rings: 8, color: KC.brass, deform: (v) => { v.y += beltY(0); v.z += BR * 0.9 + 0.006; } }));
  hipParts.push(blob(0.021, 0.015, 0.008, { p: 4, segs: 10, rings: 6, color: KC.belt, deform: (v) => { v.y += beltY(0); v.z += BR * 0.9 + 0.011; } }));
  const hips = on('pelvis', merge(hipParts), clothM);
  hips.name = 'hips';

  // ================= Skirt: six quilted gambeson panels to the knee and the tabard's front and back flaps over them
  // to mid-thigh, in one skinned mesh. Each panel hangs on two bones (from the belt, and hinged lower down), so it
  // drapes over a lifted knee instead of standing out like a board.
  const panels: Panel[] = [];
  const skirtProf: [number, number][] = [[0.945, 0.168], [0.925, 0.181], [0.9, 0.19], [0.8, 0.204], [0.735, 0.211], [0.66, 0.218], [0.565, 0.226], [0.545, 0.226]];
  const flapProf = (out: number): [number, number][] => [[0.945, 0.172 + out], [0.925, 0.183 + out], [0.9, 0.19 + out], [0.84, 0.198 + out], [0.775, 0.205 + out], [0.7, 0.212 + out], [0.63, 0.217 + out], [0.612, 0.217 + out]];
  const SX = 1.14, SZ = 0.9;
  type Def = { phi0: number; phi1: number; side: number; prof: [number, number][]; hinge: number; segs: number; tabard: boolean; over: number[] };
  const g = (phi0: number, phi1: number, side: number, inset: number): Def => ({ phi0, phi1, side, prof: skirtProf.map(([y, r]) => [y, r - inset] as [number, number]), hinge: 0.735, segs: 8, tabard: false, over: [] });
  const panelDefs: Def[] = [
    g(0.04, 1.05, 1, 0), g(-1.05, -0.04, -1, 0), // front
    g(0.9, 2.0, 1, -0.007), g(-2.0, -0.9, -1, -0.007), // sides
    g(1.8, 3.2, 1, -0.014), g(-3.2, -1.8, -1, -0.014), // back
    // The tabard: a front flap and a back flap, split at the sides.
    { phi0: -0.66, phi1: 0.66, side: 0, prof: flapProf(0.017), hinge: 0.775, segs: 10, tabard: true, over: [0, 1] },
    { phi0: Math.PI - 0.74, phi1: Math.PI + 0.74, side: 0, prof: flapProf(0.03), hinge: 0.775, segs: 10, tabard: true, over: [4, 5] },
  ];
  const pp = P('pelvis');
  const skirtHolder = new THREE.Group();
  skirtHolder.name = 'skirtHolder';
  skirtHolder.quaternion.copy(av.canonFrame('pelvis'));
  av.bones.pelvis.add(skirtHolder);
  const skirtGeos: G[] = [], skirtBones: THREE.Bone[] = [];
  const at = (phi: number, r: number, y: number) => new THREE.Vector3(Math.sin(phi) * r * SX, y, Math.cos(phi) * r * SZ);
  for (const d of panelDefs) {
    const { phi0, phi1, side, prof, hinge: HY } = d;
    const phi = (phi0 + phi1) / 2;
    const geo = quiltPanel(prof, {
      phi0, phi1, sx: SX, sz: SZ, thick: d.tabard ? 0.009 : 0.014, segs: d.segs, channels: d.tabard ? 0 : 3,
      color: d.tabard
        ? (_u, t, outer) => (outer ? C(t > 0.94 ? KC.tabardEdge : KC.tabard) : C(KC.tabardEdge))
        : (_u, t, outer) => (outer ? lerpC(KC.gambeson, KC.seam, t > 0.93 ? 0.7 : 0) : C(KC.gambesonDark)),
    });
    const rAt = (y: number) => { for (let i = 1; i < prof.length; i++) if (y >= prof[i][0]) { const t = (y - prof[i][0]) / (prof[i - 1][0] - prof[i][0]); return prof[i][1] + (prof[i - 1][1] - prof[i][1]) * t; } return prof[prof.length - 1][1]; };
    const pivot = at(phi, prof[0][1], prof[0][0] - 0.012), hinge = at(phi, rAt(HY), HY), hem = at(phi, prof[prof.length - 1][1], prof[prof.length - 1][0]);
    const upper = new THREE.Bone(), lower = new THREE.Bone();
    upper.position.copy(pivot).sub(pp); lower.position.copy(hinge).sub(pivot);
    skirtHolder.add(upper); upper.add(lower);
    const bi = skirtBones.length;
    skirtBones.push(upper, lower);
    const pos = geo.attributes.position, n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const wl = 1 - smoothstep(pos.getY(i), HY - 0.04, HY + 0.04);
      si[i * 4] = bi; si[i * 4 + 1] = bi + 1; sw[i * 4] = 1 - wl; sw[i * 4 + 1] = wl;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.translate(-pp.x, -pp.y, -pp.z);
    skirtGeos.push(geo);
    const out = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
    const axis = new THREE.Vector3(-Math.cos(phi) * SX, 0, Math.sin(phi) * SZ).normalize();
    const h1 = hinge.clone().sub(pivot), h2 = hem.clone().sub(hinge);
    const samples: number[] = [];
    {
      const nRows = prof.length, loop = 2 * nRows, base = skirtGeos.reduce((a, gg) => a + gg.attributes.position.count, 0) - geo.attributes.position.count;
      for (const j of [0, d.segs >> 1, d.segs]) for (let i = 0; i < nRows; i++) if (prof[i][0] < HY + 0.05 && (i % 2 === 0 || i === nRows - 1)) samples.push(base + j * loop + i);
    }
    panels.push({
      upper, lower, side, phi, axis, n: out, pivot: upper.position.clone(), hinge: h1, hem: h2, len1: h1.length(), len2: h2.length(),
      b1: Math.atan2(h1.dot(out), -h1.y), b2: Math.atan2(h2.dot(out), -h2.y), a1: 0, v1: 0, a2: 0, v2: 0, half: ((phi1 - phi0) / 2) * prof[0][1] * 1.05,
      samples, over: d.over,
    });
  }
  const skirt = new THREE.SkinnedMesh(merge(skirtGeos), clothM);
  skirt.name = 'skirt';
  skirtHolder.add(skirt);
  av.root.updateMatrixWorld(true);
  skirt.bind(new THREE.Skeleton(skirtBones));
  meshes.push(skirt);
  // Blood down his left side, and running down the tabard's front flap below the wound.
  soak(skirt, (q) => {
    const ang = Math.atan2(q.x, q.z);
    const left = smoothstep(ang, 0.45, 0.85) * (1 - smoothstep(ang, 1.9, 2.3));
    const fall = 1 - smoothstep(q.y, 0.66 + 0.18 * vnoise(q.x * 18, q.z * 18), 0.93);
    let m = left * (fall * 1.25 - 0.2) * (0.6 + 0.6 * vnoise(q.x * 30 + 3, q.y * 25));
    if (q.z > 0.1) {
      // On the front flap: soaked under the belt on his left, with streaks running down from it.
      const top = smoothstep(q.y, 0.8 + 0.06 * vnoise(q.x * 30, 1), 0.9) * smoothstep(q.x, 0.04, 0.09) * (1 - smoothstep(q.x, 0.2, 0.24));
      let st = 0;
      for (const [x, y1] of [[0.095, 0.7], [0.13, 0.76], [0.165, 0.66]]) st = Math.max(st, (1 - Math.abs(q.x - x - 0.004 * Math.sin(q.y * 60)) / 0.011) * (q.y > y1 ? 1.3 : 0));
      m = Math.max(m, top * 1.2, st);
    }
    return m;
  }, pp, 0.95);
  soak(hips, (p) => smoothstep(Math.atan2(p.x, p.z), 0.6, 1.0) * (1 - smoothstep(Math.atan2(p.x, p.z), 1.9, 2.3)) * (0.5 + 0.6 * vnoise(p.x * 30, p.y * 30)) - 0.15, P('pelvis'));

  // ================= Legs: trousers (thigh), boots with turned cuffs (calf), boot feet (foot) and toes (ball).
  const hip = P('thigh_l'), knee = P('calf_l'), ankle = P('foot_l'), ball = P('ball_l');
  const thighL = tube((t) => new THREE.Vector3(hip.x, hip.y + 0.05 - (hip.y + 0.05 - knee.y) * t, hip.z + 0.004 * Math.sin(t * Math.PI)), (t) => 0.1 - 0.026 * t, { steps: 6, segs: 14, color: KC.trousers });
  const shinParts = (s: number): G[] => {
    const parts: G[] = [];
    // Knee (trouser) and the boot shaft below its cuff.
    parts.push(tube((t) => new THREE.Vector3(knee.x, knee.y + 0.035 - 0.12 * t, knee.z), (t) => 0.068 - 0.004 * t, { steps: 2, segs: 12, color: KC.trousers }));
    parts.push(lathe(smooth([[ankle.y + 0.0, 0.0], [ankle.y + 0.002, 0.05], [ankle.y + 0.03, 0.063], [ankle.y + 0.13, 0.068], [knee.y - 0.17, 0.074], [knee.y - 0.08, 0.075], [knee.y - 0.06, 0.07]], 1), { segs: 16, sx: 0.98, sz: 1.05, color: KC.boot, deform: (v) => { v.x += knee.x * s; v.z += knee.z; } }));
    // The turned cuff: a fat rolled band, lighter leather, higher at the front.
    parts.push(lathe(smooth([[-0.035, 0.074], [-0.03, 0.088], [0.0, 0.09], [0.014, 0.086], [0.018, 0.074]], 2), {
      segs: 16, sx: 1.0, sz: 1.08, color: KC.bootCuff,
      deform: (v, phi) => { v.y += knee.y - 0.06 + 0.02 * Math.cos(phi); v.x += knee.x * s; v.z += knee.z; },
    }));
    return parts;
  };
  const bootFoot = (): G[] => [
    blob(0.068, 0.058, 0.11, { p: 2.7, segs: 16, rings: 11, color: (p) => C(p.y < 0.012 ? KC.sole : KC.boot), deform: (v) => { v.x += ankle.x; v.y += 0.052; v.z += ankle.z + 0.055; if (v.y < 0.0) v.y = 0.0; } }),
  ];
  const bootToe = (): G[] => [
    blob(0.066, 0.05, 0.072, { p: 2.6, segs: 14, rings: 10, color: (p) => C(p.y < 0.012 ? KC.sole : KC.boot), deform: (v) => { v.x += ankle.x; v.y += 0.046; v.z += ball.z + 0.04; if (v.y < 0.0) v.y = 0.0; } }),
  ];
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'l' : 'r';
    const mir = (g: G) => (s > 0 ? g : mirrorX(g));
    on(`thigh_${sd}`, mir(thighL.clone()), clothM);
    on(`calf_${sd}`, mir(merge(shinParts(1))), clothM);
    on(`foot_${sd}`, mir(merge(bootFoot())), clothM);
    on(`ball_${sd}`, mir(merge(bootToe())), clothM);
  }

  // ================= Arms (canonical frames): quilted sleeves, vambraces with couters, gauntlets.
  const ua = av.restP.get('upperarm_l')!.distanceTo(av.restP.get('lowerarm_l')!);
  const fa = av.restP.get('lowerarm_l')!.distanceTo(av.restP.get('hand_l')!);
  const sleeve = lathe(smooth([[-ua - 0.045, 0.0], [-ua - 0.043, 0.04], [-ua - 0.01, 0.055], [-ua + 0.05, 0.07], [-ua * 0.5, 0.08], [0.0, 0.084], [0.04, 0.074], [0.06, 0.0]], 3), {
    segs: 14, sx: 0.95, color: (p) => C(KC.gambeson).multiplyScalar(0.82 + 0.18 * Math.abs(Math.sin((p.y / 0.055) * Math.PI))),
    deform: (v) => { const q = Math.abs(Math.sin((v.y / 0.055) * Math.PI)); const k = 1 + 0.06 * Math.sqrt(q); v.x *= k; v.z *= k; },
  });
  const vambrace = merge([
    lathe(smooth([[-fa + 0.01, 0.0], [-fa + 0.012, 0.05], [-fa + 0.03, 0.06], [-fa * 0.5, 0.066], [-0.04, 0.064], [-0.01, 0.058], [0.0, 0.0]], 2), { segs: 14, sx: 0.92, color: KC.steel }),
    // Couter: a round steel cop over the whole elbow (the joint of a jointed doll), a fan on its outside.
    blob(0.072, 0.074, 0.076, { p: 2.0, segs: 14, rings: 10, color: KC.steel, deform: (v) => { v.z -= 0.004; } }),
    blob(0.016, 0.046, 0.034, { p: 2.4, segs: 8, rings: 6, color: KC.steelDark, deform: (v) => { v.x += 0.07; v.z -= 0.012; } }),
    stud(new THREE.Vector3(0, 0, -0.085), new THREE.Vector3(0, 0, -1), 0.011, 0.007, KC.brass, 8),
  ]);
  const gauntlet = gauntletGeometry();
  const gauntlets: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'l' : 'r';
    const mir = (g: G) => (s > 0 ? g.clone() : mirrorX(g));
    const sl = on(`upperarm_${sd}`, mir(sleeve), clothM, false);
    if (s > 0) soak(sl, (p) => (p.z > 0.0 ? 0.9 : 0.3) * (1 - smoothstep(-p.y, 0.03, 0.11 + 0.04 * vnoise(p.x * 40, p.z * 40))), null, 0.6);
    on(`lowerarm_${sd}`, mir(vambrace), steelM, false);
    let gg = gauntlet;
    if (s < 0) {
      gg = mirrorX(gauntlet);
      gg.morphAttributes.position = gauntlet.morphAttributes.position.map((a) => { const b = a.clone(); for (let i = 0; i < b.count; i++) b.setX(i, -b.getX(i)); return b; });
      gg.morphAttributes.normal = gauntlet.morphAttributes.normal.map((a) => { const b = a.clone(); for (let i = 0; i < b.count; i++) b.setX(i, -b.getX(i)); return b; });
    } else gg = gauntlet.clone();
    const gm = on(`hand_${sd}`, gg, steelM, false);
    gm.name = `gauntlet_${sd}`;
    gauntlets.push(gm);
  }

  // ================= Padded shoulders: quilted gambeson rolls on the clavicles, following the upper arm halfway.
  const pauldronGeo = merge([
    lathe(smooth([[-0.065, 0.0], [-0.063, 0.072], [-0.046, 0.088], [-0.018, 0.092], [0.014, 0.086], [0.038, 0.068], [0.052, 0.042], [0.058, 0.0]], 2), {
      segs: 22,
      color: (p) => C(KC.gambeson).multiplyScalar(0.78 + 0.22 * Math.sqrt(Math.abs(Math.sin(Math.atan2(p.x, p.z) * 4)))),
      deform: (v, phi) => { if (v.y > -0.05) { const k = 1 + 0.06 * Math.sqrt(Math.abs(Math.sin(phi * 4))); v.x *= k; v.z *= k; } },
    }),
    // A seam round its lower edge.
    tube((t) => { const a = t * Math.PI * 2; return new THREE.Vector3(Math.sin(a) * 0.092, -0.042, Math.cos(a) * 0.092); }, () => 0.0075, { steps: 20, segs: 5, caps: 'none', color: KC.seam }),
  ]);
  const pauldrons: KnightModel['pauldrons'] = [];
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'l' : 'r';
    const geo = s > 0 ? pauldronGeo.clone() : mirrorX(pauldronGeo);
    // On its own bone under the collar bone, which the knight places each frame.
    const bone = new THREE.Bone();
    bone.name = `pauldron_${sd}`;
    av.bones[`clavicle_${sd}`].add(bone);
    const mesh = new THREE.Mesh(geo, clothM);
    mesh.name = `pauldron_${sd}`;
    bone.add(mesh);
    meshes.push(mesh);
    // Its frame at rest with the arms hanging (set up by the knight): dome tilted out over the shoulder.
    pauldrons.push({ mesh: bone, side: sd as 'l' | 'r', relC: new THREE.Quaternion(), relU: new THREE.Quaternion(), off: new THREE.Vector3(0.022 * s, 0.035, 0.002) });
  }

  // ================= Scabbard and sword at the left hip (a group on the pelvis that swings clear of the leg).
  const scabbard = new THREE.Bone();
  scabbard.name = 'scabbard';
  {
    const holder = new THREE.Group();
    holder.quaternion.copy(av.canonFrame('pelvis'));
    av.bones.pelvis.add(holder);
    const throat = new THREE.Vector3(0.255, 0.895, -0.03);
    scabbard.position.copy(throat).sub(P('pelvis'));
    holder.add(scabbard);
    // In the group's frame: down the scabbard is -Y, the hilt +Y.
    const cloth: G[] = [], steel: G[] = [];
    const blade = 0.6;
    cloth.push(lathe(smooth([[-blade, 0.0], [-blade + 0.012, 0.018], [-blade + 0.06, 0.028], [-0.3, 0.033], [0.0, 0.036], [0.012, 0.0]], 2), { segs: 12, sx: 0.5, color: KC.scabbard }));
    steel.push(lathe(smooth([[-blade - 0.014, 0.0], [-blade - 0.01, 0.02], [-blade + 0.05, 0.031], [-blade + 0.075, 0.032], [-blade + 0.08, 0.0]], 2), { segs: 12, sx: 0.56, color: KC.steel }));
    steel.push(lathe([[-0.06, 0.0], [-0.06, 0.038], [0.005, 0.04], [0.012, 0.037], [0.014, 0.0]], { segs: 12, sx: 0.56, color: KC.steel }));
    // Hilt: crossguard, grip, pommel.
    steel.push(tube((t) => new THREE.Vector3(0, 0.03 + 0.016 * Math.sin(t * Math.PI), -0.13 + 0.26 * t), (t) => 0.016 + 0.007 * Math.abs(t - 0.5) * 2, { steps: 8, segs: 8, color: KC.steel }));
    steel.push(blob(0.02, 0.012, 0.03, { p: 2.5, segs: 10, rings: 6, color: KC.steel, deform: (v) => { v.y += 0.03; } }));
    cloth.push(lathe(smooth([[0.035, 0.0], [0.038, 0.02], [0.11, 0.022], [0.2, 0.02], [0.205, 0.0]], 2), {
      segs: 10, color: (p) => C(KC.grip).multiplyScalar(0.8 + 0.2 * Math.abs(Math.sin(p.y * 160 + Math.atan2(p.x, p.z)))),
    }));
    steel.push(blob(0.04, 0.036, 0.02, { p: 2.2, segs: 12, rings: 8, color: KC.steel, deform: (v) => { v.y += 0.232; } }));
    // The ribbon: a band round the grip, a small bow and two tails.
    cloth.push(lathe([[0.1, 0.0225], [0.103, 0.027], [0.127, 0.027], [0.13, 0.0225]], { segs: 12, color: KC.ribbon }));
    for (const s of [1, -1]) {
      cloth.push(blob(0.008, 0.02, 0.026, { p: 2.2, segs: 10, rings: 6, color: KC.ribbon, deform: (v) => { v.applyAxisAngle(new THREE.Vector3(1, 0, 0), s * 0.9); v.y += 0.118; v.z += s * 0.034; v.x += 0.025; } }));
      const tail = new THREE.CatmullRomCurve3([new THREE.Vector3(0.028, 0.112, s * 0.008), new THREE.Vector3(0.034, 0.075, s * 0.022), new THREE.Vector3(0.03, 0.035, s * 0.036 + 0.004)]);
      cloth.push(tube((t) => tail.getPoint(t), (t) => 0.009 - 0.002 * t, { steps: 6, segs: 6, sx: 0.35, color: s > 0 ? KC.ribbon : KC.ribbonDark }));
    }
    cloth.push(blob(0.014, 0.012, 0.012, { p: 2, segs: 8, rings: 6, color: KC.ribbonDark, deform: (v) => { v.y += 0.118; v.x += 0.027; } }));
    // Frog (belt loop).
    cloth.push(blob(0.012, 0.04, 0.034, { p: 3, segs: 10, rings: 8, color: KC.belt, deform: (v) => { v.y -= 0.03; v.x -= 0.018; } }));
    for (const [list, m] of [[cloth, clothM], [steel, steelM]] as [G[], THREE.Material][]) {
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.name = 'sword';
      scabbard.add(mesh); meshes.push(mesh);
    }
  }

  // ================= The prologue: a broken spear in his left shoulder, blood.
  const WOUND = new THREE.Vector3();
  const spear = new THREE.Bone();
  {
    const phiW = WOUND_AT.phi, yW = WOUND_AT.y;
    tabardPoint(phiW, yW, 0, WOUND);
    const dir = new THREE.Vector3(0.5, 0.72, 0.3).normalize();
    spear.name = 'spear';
    const wood: G[] = [], steel: G[] = [];
    const len = 0.4, r = 0.018;
    const a = WOUND.clone().addScaledVector(dir, -0.05), b = WOUND.clone().addScaledVector(dir, len);
    wood.push(tube((t) => a.clone().lerp(b, t), () => r, { steps: 8, segs: 12, caps: 'flat', color: (p) => C(KC.wood).multiplyScalar(0.85 + 0.15 * vnoise(p.x * 400, (p.y + p.z) * 30)) }));
    // The break: splinters of different lengths.
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + 0.4, rr = r * (0.55 + 0.3 * hash(i, 3));
      const base = b.clone().addScaledVector(side, Math.cos(ang) * rr).addScaledVector(up, Math.sin(ang) * rr).addScaledVector(dir, -0.012);
      const L = 0.03 + 0.07 * hash(i, 7);
      const tip = base.clone().addScaledVector(dir, L).addScaledVector(side, Math.cos(ang) * 0.004).addScaledVector(up, Math.sin(ang) * 0.004);
      wood.push(tube((t) => base.clone().lerp(tip, t), (t) => (0.0075 + 0.004 * hash(i, 9)) * (1 - t) + 0.0006, { steps: 3, segs: 5, caps: 'flat', color: (p) => C(KC.woodLight).lerp(C(KC.wood), p.distanceTo(tip) / L) }));
    }
    wood.push(lathe([[0, r * 0.98], [0.004, r * 0.7], [0.008, 0]], { segs: 12, color: KC.woodLight }).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(b.x, b.y, b.z));
    // The socket of the lost head where it went in, and its langets along the shaft.
    const sock = lathe(smooth([[-0.03, 0.0], [-0.03, 0.03], [0.0, 0.031], [0.035, 0.026], [0.05, 0.023], [0.052, 0.0]], 2), { segs: 14, color: KC.steelDark });
    sock.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(WOUND.x, WOUND.y, WOUND.z);
    steel.push(sock);
    for (const s of [1, -1]) {
      const p0 = WOUND.clone().addScaledVector(side, s * r * 1.02).addScaledVector(dir, 0.03), p1 = p0.clone().addScaledVector(dir, 0.11);
      steel.push(tube((t) => p0.clone().lerp(p1, t), (t) => 0.006 * (1 - 0.5 * t), { steps: 3, segs: 6, sx: 0.5, color: KC.steelDark }));
      steel.push(stud(p0.clone().addScaledVector(dir, 0.07).addScaledVector(side, s * 0.004), side.clone().multiplyScalar(s), 0.005, 0.004, KC.steel, 6));
    }
    const sp = P('spine_02');
    const holder = new THREE.Group();
    holder.quaternion.copy(av.canonFrame('spine_02'));
    holder.position.set(-sp.x, -sp.y, -sp.z).applyQuaternion(holder.quaternion);
    av.bones.spine_02.add(holder);
    holder.add(spear);
    for (const [list, m] of [[wood, clothM], [steel, steelM]] as [G[], THREE.Material][]) {
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.name = 'spear';
      spear.add(mesh); meshes.push(mesh);
    }
    // Blood soaked into the tabard: a big stain round the wound, runs down to the belt, a smear from his hand.
    const drips = [[WOUND.x - 0.035, 1.02], [WOUND.x - 0.01, 0.9], [WOUND.x + 0.018, 0.96], [WOUND.x + 0.04, 0.9], [WOUND.x - 0.06, 1.08]];
    const bloodMask = (p: THREE.Vector3) => {
      if (p.z < -0.03) return 0;
      const d = Math.hypot(p.x - WOUND.x, (p.y - WOUND.y) * 1.05, (p.z - WOUND.z) * 0.8);
      let m = 1.35 - d / (0.06 + 0.035 * vnoise(p.x * 18, p.y * 18));
      // Soaked downward from it, narrowing.
      if (p.y < WOUND.y) {
        const k = (WOUND.y - p.y) / 0.3;
        const hw = 0.06 * (1 - k) + 0.012;
        const cx = WOUND.x - 0.015 + 0.012 * Math.sin(p.y * 25);
        m = Math.max(m, (1 - Math.abs(p.x - cx) / hw) * (1.3 - k) * (0.8 + 0.4 * vnoise(p.x * 22, p.y * 22)));
      }
      for (const [x, y1] of drips) {
        if (p.y > WOUND.y || p.y < y1 - 0.02) continue;
        const w = 0.01 + 0.005 * smoothstep(p.y, y1 + 0.03, y1);
        const dd = Math.abs(p.x - x - 0.006 * Math.sin(p.y * 70 + x * 50));
        m = Math.max(m, (1 - dd / w) * 1.4, 1.2 - Math.hypot(p.x - x, (p.y - y1) * 0.8) / 0.018);
      }
      // A smear from his hand below and inside the wound.
      const sm = 1.1 - Math.hypot((p.x - WOUND.x + 0.07) / 0.06, (p.y - 1.13) / 0.035) - 0.5 * vnoise(p.x * 30, p.y * 30);
      return Math.max(m, sm);
    };
    // Wet and dark where it is thick (a crisp coat in the blood material), soaked pink into the cloth round it.
    const sp2 = P('spine_02');
    soak(tabard, (p) => (bloodMask(p) + 0.45) * 0.55, sp2, 0.6);
    const tc = coat(tabard.geometry, (p) => bloodMask(p.clone().add(sp2)), 0.0034);
    const tm = on('spine_02', tc, bloodM, false);
    tm.name = 'blood_tabard';
    // The right gauntlet: palm, fingers and thumb dark with it (it has been pressed to the wound).
    const gr = gauntlets[1];
    const gc = coat(gr.geometry, (p) => (p.x > 0.01 ? 1 : 0) * (0.75 - Math.abs(p.z - 0.01) / 0.08) + 0.45 * vnoise(p.y * 50, p.z * 50) - 0.12 + (p.y < -0.13 && p.x > -0.01 ? 0.2 : 0), 0.0025);
    const gm = new THREE.Mesh(gc, bloodM);
    gm.name = 'blood_hand_r';
    gr.add(gm); meshes.push(gm);
  }

  // His long sword upright before him, as in the reference. This joint changes pose/visibility at rest, while
  // the existing scabbard remains his moving silhouette. It shares the steel/cloth meshes and materials.
  const drawnSword = new THREE.Bone(); drawnSword.name = 'drawnSword'; av.root.add(drawnSword);
  {
    const blade = lathe([[0, 0.025], [0.88, 0.023], [1.1, 0.018], [1.22, 0]], {
      segs: 4, sz: 0.2, color: (p) => C(p.z > 0 ? KC.steel : KC.steelDark),
    });
    const guard = tube((t) => new THREE.Vector3(-0.13 + 0.26 * t, 0.008 + 0.012 * Math.sin(t * Math.PI), 0), () => 0.013, { steps: 8, segs: 6, color: KC.steel });
    const pommel = blob(0.031, 0.033, 0.024, { p: 2.8, segs: 10, rings: 6, color: KC.steel, deform: (p) => { p.y -= 0.197; } });
    const grip = lathe([[-0.178, 0.018], [-0.025, 0.018]], { segs: 10, color: (p) => C(KC.grip).multiplyScalar(0.8 + 0.2 * Math.abs(Math.sin(p.y * 145))) });
    for (const [g, mat] of [[merge([blade, guard, pommel]), steelM], [grip, clothM]] as [G, THREE.Material][]) {
      const mesh = new THREE.Mesh(g, mat); mesh.name = 'drawnSword'; drawnSword.add(mesh); meshes.push(mesh);
    }
  }

  // ================= All of it into three skinned meshes on one skeleton (one draw each).
  const baked = bake(av, meshes, [clothM, steelM, bloodM], stains);
  const cloth = baked.meshes[0], steel = baked.meshes[1], blood = baked.meshes[2];
  blood.castShadow = false;
  // The skirt's ground samples now index the cloth mesh.
  const sk = baked.parts.find((p) => p.name === 'skirt')!;
  for (const p of panels) p.samples = p.samples.map((i) => i + sk.start);
  drawnSword.scale.setScalar(1e-4);
  return { fade, meshes: baked.meshes, cloth, steel, blood, parts: baked.parts, panels, skirtHolder, scabbard, drawnSword, spear, pauldrons, stain: baked.stain };
}

// Bakes the parts (meshes hung on bones, as made) into one skinned mesh per material: each vertex weighted to the
// bone its part rode (the skirt keeps its own hinge weights), positions at the skeleton's rest pose. Gauntlet
// morphs become relative targets 0-1 (left) and 2-3 (right); blood soaked into the cloth keeps both colourings.
function bake(av: Avatar, src: THREE.Mesh[], mats: THREE.Material[], stains: { attr: THREE.BufferAttribute; clean: Float32Array; bloody: Float32Array }[]) {
  const root = av.root;
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bones: THREE.Object3D[] = [];
  const index = new Map<THREE.Object3D, number>();
  const idx = (b: THREE.Object3D) => { let i = index.get(b); if (i === undefined) { i = bones.length; bones.push(b); index.set(b, i); } return i; };
  const boneOf = (o: THREE.Object3D) => { let p = o.parent; while (p && !(p as any).isBone) p = p.parent; return p!; };
  const parts: Part[] = [];
  const out: THREE.SkinnedMesh[] = [];
  let stain: { attr: THREE.BufferAttribute; clean: Float32Array; bloody: Float32Array } | null = null;
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const mat of mats) {
    const list = src.filter((m) => m.material === mat);
    let nv = 0, ni = 0;
    for (const m of list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index!.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3), bloody = new Float32Array(nv * 3), st = new Float32Array(nv);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const ind = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const mp = [0, 1, 2, 3].map(() => new Float32Array(nv * 3)), mn = [0, 1, 2, 3].map(() => new Float32Array(nv * 3));
    let morphs = false, hasStain = false, hasCol = false;
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), mat);
    let vo = 0, io = 0;
    for (const m of list) {
      const g = m.geometry, count = g.attributes.position.count;
      M.multiplyMatrices(rootInv, m.matrixWorld);
      N.getNormalMatrix(M);
      const P = g.attributes.position, NN = g.attributes.normal;
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(M); pos.set([v.x, v.y, v.z], (vo + i) * 3);
        n.fromBufferAttribute(NN, i).applyMatrix3(N).normalize(); nor.set([n.x, n.y, n.z], (vo + i) * 3);
      }
      const c = g.attributes.color as THREE.BufferAttribute | undefined;
      if (c) {
        hasCol = true;
        const rec = stains.find((r) => r.attr === c);
        col.set(rec ? rec.clean : (c.array as Float32Array), vo * 3);
        bloody.set(rec ? rec.bloody : (c.array as Float32Array), vo * 3);
      }
      if (g.attributes.stain) { hasStain = true; st.set(g.attributes.stain.array as Float32Array, vo); }
      // Skin: the skirt keeps its hinge weights; every other part rides its bone.
      let bone: THREE.Object3D;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = m as THREE.SkinnedMesh, gi = g.attributes.skinIndex, gw = g.attributes.skinWeight;
        for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) {
          const w = gw.getComponent(i, k);
          si[(vo + i) * 4 + k] = w > 0 ? idx(sm.skeleton.bones[gi.getComponent(i, k)]) : 0;
          sw[(vo + i) * 4 + k] = w;
        }
        bone = sm.parent!;
      } else {
        bone = boneOf(m);
        const b = idx(bone);
        for (let i = 0; i < count; i++) { si[(vo + i) * 4] = b; sw[(vo + i) * 4] = 1; }
      }
      // Gauntlet curls (absolute shapes) as relative targets in its hand's slots.
      const morph = g.morphAttributes.position;
      if (morph?.length) {
        morphs = true;
        const slot = /_r$/.test(m.name) || /_r$/.test(m.parent?.name ?? '') ? 2 : 0;
        const mnA = g.morphAttributes.normal;
        for (let k = 0; k < morph.length; k++) for (let i = 0; i < count; i++) {
          v.fromBufferAttribute(morph[k], i).applyMatrix4(M);
          mp[slot + k].set([v.x - pos[(vo + i) * 3], v.y - pos[(vo + i) * 3 + 1], v.z - pos[(vo + i) * 3 + 2]], (vo + i) * 3);
          n.fromBufferAttribute(mnA ? mnA[k] : NN, i).applyMatrix3(N).normalize();
          mn[slot + k].set([n.x - nor[(vo + i) * 3], n.y - nor[(vo + i) * 3 + 1], n.z - nor[(vo + i) * 3 + 2]], (vo + i) * 3);
        }
      }
      const gi = g.index!.array;
      for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
      io += gi.length;
      // Rest positions in the bone's space, for measuring.
      let local: Float32Array | null = null;
      if (!(m as THREE.SkinnedMesh).isSkinnedMesh) {
        local = new Float32Array(count * 3);
        const L = bone.matrixWorld.clone().invert().multiply(m.matrixWorld);
        for (let i = 0; i < count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(L); local.set([v.x, v.y, v.z], i * 3); }
      }
      parts.push({ name: m.name, mesh, start: vo, count, bone, local });
      vo += count;
    }
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (hasCol) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (hasStain) geo.setAttribute('stain', new THREE.BufferAttribute(st, 1));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    if (morphs) {
      geo.morphAttributes.position = mp.map((a) => new THREE.BufferAttribute(a, 3));
      geo.morphAttributes.normal = mn.map((a) => new THREE.BufferAttribute(a, 3));
      geo.morphTargetsRelative = true;
      mesh.updateMorphTargets();
    }
    if (hasCol && mat === mats[0]) stain = { attr: geo.attributes.color as THREE.BufferAttribute, clean: col.slice(), bloody };
    mesh.castShadow = true; mesh.receiveShadow = true;
    // Round him in any pose (arms overhead, legs out on the ground), so the bounds never need recomputing.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    root.add(mesh);
    out.push(mesh);
  }
  for (const m of src) m.parent?.remove(m);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
  for (const m of out) m.bind(skeleton);
  return { meshes: out, parts, stain: stain! };
}
