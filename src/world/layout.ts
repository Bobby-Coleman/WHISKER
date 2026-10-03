// FIELD_01 layout: one data-driven description of the moor, its structures and routes.
// All units are meters. +Y up, north is -Z.
import { Simplex2, smoothstep, clamp } from './noise';

const n1 = new Simplex2(11);
const n2 = new Simplex2(23);
const n3 = new Simplex2(37);

export const FIELD = {
  playRadius: 92,
  nearHalf: 125,
  farHalf: 1700,
};

export const SPAWN = {
  kitten: { x: 0.55, z: 6.0, yaw: 0.06 },
  knight: { x: -0.62, z: 5.85, yaw: -0.04 },
};

// Courtyard of an abandoned sheepfold chapel (puzzles 1 and 2).
export const YARD = { minX: -4, maxX: 20, minZ: -61, maxZ: -43, wallH: 2.6, wallT: 0.55 };
export const GATE = { x: 4, z: -43, width: 2.4 };
export const CULVERT = { x: 13.5, z: -43, width: 0.55, height: 0.42 };
export const CHAPEL = { minX: 1, maxX: 13, minZ: -61, maxZ: -54.5, doorX: 7, doorW: 1.5 };
export const HEAVY_PLATE = { x: 15, z: -49.5, r: 0.85 };
export const POCKET = { minX: -4, maxX: -0.2, minZ: -52.5, maxZ: -46.5, gapZ: -49.5, gapW: 0.5 };
export const SMALL_PLATE = { x: -2.1, z: -49.5, r: 0.4 };

// Ruined bell tower (puzzle 3).
export const TOWER = { x: -34, z: -22, r: 3.3, wallT: 0.6, floorY: 2.05, doorAngle: 0, windowAngle: Math.PI / 2, height: 9.5 };

export const CASTLE = { x: -95, z: -430 };

// The drowned hollow between the moor and the castle (chapters IV and V): a marsh crossed by a raised stone causeway.
// The sluice on its east bank lets the marsh drain into the low ground; the warden's gatehouse stands on the
// causeway at its far side. Heights are set relative to the marsh floor (computed below).
// Flooded, the water stands 0.6 m over the causeway: thigh-deep on the knight, past what he will wade in plate.
export const MARSH = { x: -50, z: -84, rx: 22, rz: 27, fall: 7, floorY: 0, flood: 1.15, drained: 0.18 };
export const CAUSEWAY: { x: number; z: number }[] = [{ x: -46.5, z: -55 }, { x: -48.6, z: -80 }, { x: -51.2, z: -104 }, { x: -52.6, z: -118 }];
export const CAUSEWAY_HALF = 1.2, CAUSEWAY_TOP = 0.55;
export const SLUICE = { x: -27.4, z: -84, chanHalf: 0.75, chanX1: -17, hutX: -26.2, hutZ: -86.9, hut: 0.95 };
export const GATEHOUSE = { x: -51.2, z: -103.5, half: 1.25, towerW: 2.6, depth: 2.4, innerZ: -106.4 };
// Beyond the playable field's circle, the marsh and the causeway to the gatehouse stay walkable.
export const MARSH_BOUNDS = { minX: -60, maxX: -16, minZ: -113.5, maxZ: -52 };

export const PATHS: { x: number; z: number }[][] = [
  [{ x: 0, z: 14 }, { x: 0.5, z: 2 }, { x: 1.2, z: -12 }, { x: 2.6, z: -27 }, { x: 4, z: -38 }, { x: 4, z: -46 }, { x: 6, z: -52 }, { x: 7, z: -54 }],
  [{ x: 1.2, z: -12 }, { x: -8, z: -17 }, { x: -20, z: -20 }, { x: -29.5, z: -22 }],
  [{ x: 0.5, z: 2 }, { x: 10, z: 12 }, { x: 25, z: 30 }, { x: 40, z: 60 }, { x: 52, z: 110 }],
  // From the bell tower down to the causeway, and along the marsh's east bank to the sluice.
  [{ x: -29.5, z: -22 }, { x: -31.5, z: -31 }, { x: -38, z: -43 }, { x: -46.5, z: -55 }],
  [{ x: -45.5, z: -56 }, { x: -38, z: -63 }, { x: -31.5, z: -72 }, { x: -28.6, z: -80 }],
];

export const STANDING_STONES = [
  { x: 17, z: 4, h: 2.1, r: 0.45, lean: 0.05 },
  { x: 21, z: 7.5, h: 1.6, r: 0.4, lean: -0.08 },
  { x: 19.2, z: 11.5, h: 2.4, r: 0.5, lean: 0.03 },
  { x: -16, z: 34, h: 2.8, r: 0.55, lean: 0.12 },
  { x: 36, z: -30, h: 1.9, r: 0.45, lean: -0.1 },
  { x: -42.6, z: -57.8, h: 2.4, r: 0.5, lean: 0.06 }, // marks where the causeway leaves the moor
];

export const PUDDLES = [
  { x: 2.2, z: -6, rx: 1.4, rz: 0.8, rot: 0.3 },
  { x: -0.8, z: -18, rx: 2.0, rz: 1.0, rot: 1.1 },
  { x: 3.5, z: -33, rx: 1.2, rz: 0.7, rot: 0.2 },
  { x: -14, z: -19, rx: 1.6, rz: 0.9, rot: 0.6 },
  { x: 14, z: 18, rx: 2.4, rz: 1.3, rot: 0.9 },
  { x: -22, z: 12, rx: 3.0, rz: 1.6, rot: 2.1 },
  { x: 30, z: -12, rx: 2.2, rz: 1.2, rot: 0.4 },
];

function rawHeight(x: number, z: number): number {
  let h = 1.7 * n1.fbm(x / 70, z / 70, 4) + 0.45 * n2.fbm(x / 19, z / 19, 3) + 0.06 * n3.noise(x / 3.5, z / 3.5);
  const d = Math.hypot(x, z);
  // Rising moorland hills beyond the playable field.
  const far = smoothstep(95, 420, d);
  h += far * (16 + 22 * n2.fbm(x / 260, z / 260, 4));
  // A low, wide body of water to the east.
  h -= smoothstep(170, 340, x) * smoothstep(-500, -150, z) * (1 - smoothstep(250, 500, z)) * 40;
  // The castle hill.
  const cx = x - CASTLE.x, cz = z - CASTLE.z;
  h += 30 * Math.exp(-(cx * cx + cz * cz) / (2 * 75 * 75));
  return h;
}

type Flat = { x: number; z: number; hx: number; hz: number; fall: number; h?: number };
const FLATS: Flat[] = [
  { x: (YARD.minX + YARD.maxX) / 2, z: (YARD.minZ + YARD.maxZ) / 2, hx: 14, hz: 11, fall: 9 },
  { x: TOWER.x, z: TOWER.z, hx: 5.5, hz: 5.5, fall: 7 },
  { x: 0, z: 6, hx: 3, hz: 3, fall: 6 },
];
for (const f of FLATS) f.h = rawHeight(f.x, f.z);
MARSH.floorY = rawHeight(MARSH.x, MARSH.z) - 1.7;
// The causeway runs on past the gatehouse toward the castle, out of the playable field and into the fog.
const CAUSEWAY_LINE = [...CAUSEWAY, { x: -54.6, z: -140 }, { x: -57.5, z: -175 }];

// 0 at the marsh's centre, 1 on its rim (ellipse).
export function marshQ(x: number, z: number) { return Math.hypot((x - MARSH.x) / MARSH.rx, (z - MARSH.z) / MARSH.rz); }
export function causewayDist(x: number, z: number) {
  let d = 1e9;
  for (let i = 0; i < CAUSEWAY_LINE.length - 1; i++) d = Math.min(d, segDist(x, z, CAUSEWAY_LINE[i].x, CAUSEWAY_LINE[i].z, CAUSEWAY_LINE[i + 1].x, CAUSEWAY_LINE[i + 1].z));
  return d;
}
// Water over the marsh floor at this point for a given water level (0 outside the marsh).
export function waterDepthAt(x: number, z: number, level: number, ground: number) {
  if (marshQ(x, z) > 1.35 && !(x > SLUICE.x - 2 && x < SLUICE.chanX1 && Math.abs(z - SLUICE.z) < 2)) return 0;
  return Math.max(0, level - ground);
}

export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const f of FLATS) {
    const dx = Math.max(0, Math.abs(x - f.x) - f.hx);
    const dz = Math.max(0, Math.abs(z - f.z) - f.hz);
    const w = 1 - smoothstep(0, f.fall, Math.hypot(dx, dz));
    h = h + (f.h! - h) * w;
  }
  // The marsh: a level-floored hollow (the floor lies 1.7 m under the moor at its centre).
  const rimD = (marshQ(x, z) - 1) * Math.min(MARSH.rx, MARSH.rz);
  if (rimD < MARSH.fall) {
    const wM = 1 - smoothstep(-3, MARSH.fall, rimD);
    h = h + (MARSH.floorY - h) * wM;
  }
  // The sluice channel cuts east from the rim to the low ground, falling gently.
  if (x > SLUICE.x - 4 && x < SLUICE.chanX1 + 3 && Math.abs(z - SLUICE.z) < SLUICE.chanHalf + 1.2) {
    const wc = (1 - smoothstep(SLUICE.chanHalf, SLUICE.chanHalf + 0.9, Math.abs(z - SLUICE.z))) * smoothstep(SLUICE.x - 4, SLUICE.x - 2, x) * (1 - smoothstep(SLUICE.chanX1, SLUICE.chanX1 + 3, x));
    h = h + (MARSH.floorY + 0.02 - (x - SLUICE.x) * 0.025 - h) * wc;
  }
  // The causeway: a level stone road raised over the marsh floor that follows the ground where the moor is higher.
  const cd = causewayDist(x, z);
  if (cd < CAUSEWAY_HALF + 1.0) {
    const top = Math.max(h, MARSH.floorY + CAUSEWAY_TOP);
    h = h + (top - h) * (1 - smoothstep(CAUSEWAY_HALF, CAUSEWAY_HALF + 1.0, cd));
  }
  // Paths settle slightly into the ground.
  h -= 0.06 * (1 - smoothstep(0.3, 1.4, pathDist(x, z))) * smoothstep(CAUSEWAY_HALF, CAUSEWAY_HALF + 1.0, cd);
  // Puddle hollows.
  for (const p of PUDDLES) {
    const q = puddleQ(p, x, z);
    h -= 0.07 * (1 - smoothstep(0.6, 1.3, q));
  }
  return h;
}

export function puddleQ(p: (typeof PUDDLES)[number], x: number, z: number) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const dx = x - p.x, dz = z - p.z;
  const u = (c * dx - s * dz) / p.rx, v = (s * dx + c * dz) / p.rz;
  return Math.sqrt(u * u + v * v);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function pathDist(x: number, z: number): number {
  let d = 1e9;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    d = Math.min(d, segDist(x, z, p[i].x, p[i].z, p[i + 1].x, p[i + 1].z));
  }
  // Organic edge wobble.
  return d + 0.35 * n3.noise(x / 2.3, z / 2.3);
}

// Broad grass fields shared by the blade carpet, the cluster kit and the terrain's distant canopy colour.
const nv = new Simplex2(91);
// Vigour: 0 = thin, short turf; 1 = full, tall growth (patches about 30 m across).
export function grassVigour(x: number, z: number): number { return nv.fbm(x / 30, z / 30, 3) * 0.5 + 0.5; }
// Fraction of dead, straw-coloured blades (patches about 12 m across).
export function deadGrass(x: number, z: number): number {
  return 0.06 + 0.32 * smoothstep(0.5, 0.8, nv.fbm(x / 12 + 40, z / 12, 2) * 0.5 + 0.5);
}

// Standing water: 1 inside a puddle, 0 outside.
export function puddleMask(x: number, z: number): number {
  let w = 0;
  for (const p of PUDDLES) w = Math.max(w, 1 - smoothstep(0.75, 1.05, puddleQ(p, x, z)));
  return w;
}

export function wetNatural(x: number, z: number): number {
  let w = smoothstep(0.05, 0.55, -n1.fbm(x / 28 + 9, z / 28 - 4, 3));
  // The marsh and its rim are sodden.
  w = Math.max(w, 1 - smoothstep(0.85, 1.25, marshQ(x, z)));
  for (const p of PUDDLES) w = Math.max(w, 1 - smoothstep(0.9, 2.2, puddleQ(p, x, z)));
  return w;
}

export function wetness(x: number, z: number): number {
  let w = wetNatural(x, z);
  w = Math.max(w, 0.6 * (1 - smoothstep(0.4, 1.6, pathDist(x, z))));
  return clamp(w, 0, 1);
}

export function insideRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0) {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}

// Areas where vegetation and scattered rocks are excluded.
export function vegetationExclusion(x: number, z: number): number {
  let e = 0;
  if (insideRect(x, z, YARD, 0.6)) {
    // Courtyard keeps a few sparse tufts.
    e = insideRect(x, z, CHAPEL, 0.3) ? 1 : 0.75;
  }
  const td = Math.hypot(x - TOWER.x, z - TOWER.z);
  if (td < TOWER.r + 0.4) e = 1;
  for (const s of STANDING_STONES) if (Math.hypot(x - s.x, z - s.z) < s.r + 0.15) e = 1;
  // Open water and mud in the marsh, the causeway's stones, the sluice and the gatehouse carry no grass.
  e = Math.max(e, 1 - smoothstep(0.8, 0.98, marshQ(x, z)));
  if (causewayDist(x, z) < CAUSEWAY_HALF + 0.3) e = 1;
  if (x > SLUICE.x - 3 && x < SLUICE.chanX1 + 1 && Math.abs(z - SLUICE.z) < 3.6) e = 1;
  if (Math.abs(x - GATEHOUSE.x) < 4.8 && z < GATEHOUSE.z + 2 && z > GATEHOUSE.innerZ - 2.5) e = 1;
  return e;
}
