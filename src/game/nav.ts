// Region graph navigation with per-character profiles. The field is open ground, so steering handles
// rocks; this graph handles the places where scale matters (culvert, crawl gap, doors, the tower).
import * as THREE from 'three/webgpu';
import { YARD, CHAPEL, POCKET, TOWER, GATE, CULVERT, insideRect } from '../world/layout';
import { Kind } from '../chars/character';

export type Region = 'field' | 'yard' | 'chapel' | 'pocket' | 'towerDown' | 'towerUp';
export type NavState = { gateOpen: boolean; chapelOpen: boolean; towerOpen: boolean; groundY: (x: number, z: number) => number };

export function regionOf(p: THREE.Vector3): Region {
  const td = Math.hypot(p.x - TOWER.x, p.z - TOWER.z);
  if (td < TOWER.r - TOWER.wallT * 0.5) {
    return p.y > (window as any).__towerFloorY - 0.4 ? 'towerUp' : 'towerDown';
  }
  if (insideRect(p.x, p.z, CHAPEL) && p.z < CHAPEL.maxZ) return 'chapel';
  if (insideRect(p.x, p.z, POCKET)) return 'pocket';
  if (insideRect(p.x, p.z, YARD)) return 'yard';
  return 'field';
}

type Portal = { a: Region; b: Region; pa: [number, number]; pb: [number, number]; kinds: Kind[]; open: (s: NavState) => boolean };

const PORTALS: Portal[] = [
  { a: 'field', b: 'yard', pa: [GATE.x, YARD.maxZ + 1.4], pb: [GATE.x, YARD.maxZ - 1.4], kinds: ['knight', 'kitten'], open: (s) => s.gateOpen },
  { a: 'field', b: 'yard', pa: [CULVERT.x, YARD.maxZ + 1.0], pb: [CULVERT.x, YARD.maxZ - 1.0], kinds: ['kitten'], open: () => true },
  { a: 'yard', b: 'chapel', pa: [CHAPEL.doorX, CHAPEL.maxZ + 1.2], pb: [CHAPEL.doorX, CHAPEL.maxZ - 1.2], kinds: ['knight', 'kitten'], open: (s) => s.chapelOpen },
  { a: 'yard', b: 'pocket', pa: [POCKET.maxX + 0.9, POCKET.gapZ], pb: [POCKET.maxX - 0.7, POCKET.gapZ], kinds: ['kitten'], open: () => true },
  { a: 'field', b: 'towerDown', pa: [TOWER.x + TOWER.r + 1.2, TOWER.z], pb: [TOWER.x + TOWER.r - 1.3, TOWER.z], kinds: ['knight', 'kitten'], open: (s) => s.towerOpen },
];

// Returns the next point to steer toward, or null when this character has no route.
export function nextWaypoint(kind: Kind, from: Region, to: Region, s: NavState, pos: THREE.Vector3): THREE.Vector3 | null {
  const prev = new Map<Region, { r: Region; p: Portal }>();
  const q: Region[] = [from];
  const seen = new Set<Region>([from]);
  while (q.length) {
    const r = q.shift()!;
    if (r === to) break;
    for (const p of PORTALS) {
      if (!p.kinds.includes(kind) || !p.open(s)) continue;
      const nb = p.a === r ? p.b : p.b === r ? p.a : null;
      if (!nb || seen.has(nb)) continue;
      seen.add(nb); prev.set(nb, { r, p }); q.push(nb);
    }
  }
  if (!seen.has(to)) return null;
  let cur = to;
  let step = prev.get(cur)!;
  while (step && step.r !== from) { cur = step.r; step = prev.get(cur)!; }
  if (!step) return null;
  const p = step.p;
  const [ex, ez] = p.a === from ? p.pa : p.pb;
  const [ix, iz] = p.a === from ? p.pb : p.pa;
  // Approach the entry point, then pass through to the far side.
  const ax = ix - ex, az = iz - ez, al = Math.hypot(ax, az);
  const t = ((pos.x - ex) * ax + (pos.z - ez) * az) / (al * al);
  const lateral = Math.abs(((pos.x - ex) * az - (pos.z - ez) * ax) / al);
  const committed = t > -0.12 && lateral < 0.45;
  const target = committed ? new THREE.Vector3(ix, 0, iz) : new THREE.Vector3(ex, 0, ez);
  target.y = s.groundY(target.x, target.z);
  return target;
}
