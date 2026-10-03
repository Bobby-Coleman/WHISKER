// FIELD_01 Environment + Gameplay structures: courtyard ruin and chapel, culvert, gate and winch,
// pressure stones, ruined bell tower, standing stones, scattered rocks, puddles, distant castle.
import * as THREE from 'three/webgpu';
import { color, float, mix, uniform } from 'three/tsl';
import {
  YARD, GATE, CULVERT, CHAPEL, HEAVY_PLATE, POCKET, SMALL_PLATE, TOWER, CASTLE, STANDING_STONES, PUDDLES, heightAt, pathDist, vegetationExclusion,
} from './layout';
import { PhysicsWorld, MASK } from '../game/physics';
import { stoneMaterial, rockMaterial, timberMaterial, ironMaterial, waterMaterial, silhouetteMaterial } from './materials';
import { photoMaterial } from './surfaces';

// Photo-scanned stone, rock and timber when their textures loaded; the procedural materials otherwise.
export const FIELD_MATERIALS = { photo: true };
import { Simplex2, mulberry32 } from './noise';
import { createIvy, IvyFace } from './ivy';
import { LOOK } from '../render/settings';

const noise3 = new Simplex2(77);

export function rockGeometry(seed: number, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const off = seed * 13.37;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3.noise(v.x * 1.3 + off, v.y * 1.3 + v.z * 0.7) * 0.22 + noise3.noise(v.x * 3.1 - off, v.z * 3.1 + v.y) * 0.08;
    v.multiplyScalar(1 + n);
    // Flatten underside so rocks sit in the soil.
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export type Structures = ReturnType<typeof createStructures>;

export function createStructures(physics: PhysicsWorld) {
  const root = new THREE.Group();
  root.name = 'Environment';
  const PH = FIELD_MATERIALS.photo;
  // Dry-stone sheepfold walls (castle_wall_varriation), cooled and darkened toward wet grey stone; the tower in
  // coursed slate (castle_wall_slates); boulders in mossy rock; doors, posts and boards in weathered planks.
  const stone = PH ? photoMaterial('castle_wall_varriation', { scale: 3.0, desat: 0.45, tint: [0.74, 0.77, 0.82], mossy: 1.0, damp: 1.0, dampLocal: true }) : stoneMaterial();
  const stoneDark = PH ? photoMaterial('castle_wall_varriation', { scale: 3.0, desat: 0.5, tint: [0.6, 0.62, 0.66], mossy: 1.3, damp: 1.0, dampLocal: true }) : stoneMaterial({ tint: '#5f5d57', mossy: 1.2 });
  const towerStone = PH ? photoMaterial('castle_wall_slates', { scale: 2.6, desat: 0.4, tint: [0.62, 0.66, 0.72], mossy: 0.7, damp: 1.0, dampLocal: true }) : stone;
  const rock = PH ? photoMaterial('mossy_rock', { scale: 1.7, desat: 0.15, tint: [0.92, 0.96, 0.98], mossy: 0.25, damp: 0.8, dampLocal: true }) : rockMaterial();
  const wood = PH ? photoMaterial('weathered_planks', { scale: 1.3, tint: [1.25, 1.18, 1.1] }) : timberMaterial();
  const woodDark = PH ? photoMaterial('weathered_planks', { scale: 1.3, tint: [0.8, 0.76, 0.72] }) : timberMaterial('#2c251e');
  const roofMat = PH ? photoMaterial('roof_slates_02', { scale: 1.6, desat: 0.35, tint: [0.66, 0.69, 0.74], mossy: 0.8 }) : timberMaterial('#2a241d');
  const iron = ironMaterial();

  const shadow = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const yardY = heightAt((YARD.minX + YARD.maxX) / 2, (YARD.minZ + YARD.maxZ) / 2);

  // ---- Wall builder: ruined height variation along the run, collision covers the full height.
  const wall = (ax: number, az: number, bx: number, bz: number, h: number, t: number, mat: THREE.Material, base: number, opts: { ruin?: number; mask?: number; collide?: boolean; id?: string } = {}) => {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bz - az, bx - ax);
    const n = Math.max(1, Math.round(len / 1.1));
    const r = mulberry32(Math.floor(ax * 31 + az * 17 + bx * 7));
    // Each section's centre, length and top, so climbable ivy can be grown to the height it really has.
    const segs: { cx: number; cz: number; len: number; top: number }[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const hh = h * (1 - (opts.ruin ?? 0.25) * r());
      segs.push({ cx: ax + (bx - ax) * (t0 + t1) / 2, cz: az + (bz - az) * (t0 + t1) / 2, len: len / n, top: base - 0.15 + hh });
      const g = new THREE.BoxGeometry(len / n + 0.02, hh, t * (0.95 + r() * 0.1));
      g.translate(0, hh / 2, 0);
      const m = shadow(new THREE.Mesh(g, mat));
      const cx = ax + (bx - ax) * (t0 + t1) / 2, cz = az + (bz - az) * (t0 + t1) / 2;
      m.position.set(cx, base - 0.15, cz);
      m.rotation.y = -rot;
      root.add(m);
      // Loose top stones.
      if (r() < 0.6) {
        const s = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.35 + r() * 0.3, 0.18, t * 0.8), mat));
        s.position.set(cx + (r() - 0.5) * 0.4, base - 0.15 + hh + 0.08, cz);
        s.rotation.set(0, -rot + (r() - 0.5) * 0.3, (r() - 0.5) * 0.2);
        root.add(s);
      }
    }
    if (opts.collide !== false) physics.addWall(ax, az, bx, bz, t, -100, 100, opts.mask ?? MASK.all, opts.id);
    return segs;
  };
  // Climbable ivy: the face for the kitten to climb, and the ivy that shows the player where it is.
  const ivyFace = (f: IvyFace & { exit: 'over' | 'ledge' | 'none'; depth?: number; ledgeTop?: number }, seed: number, density = 1) => {
    physics.addClimbable(f);
    root.add(createIvy(f, seed, density));
  };

  // ---- Courtyard enclosure.
  const W = YARD, T = YARD.wallT, H = YARD.wallH;
  const gx0 = GATE.x - GATE.width / 2, gx1 = GATE.x + GATE.width / 2;
  const cx0 = CULVERT.x - CULVERT.width / 2, cx1 = CULVERT.x + CULVERT.width / 2;
  wall(W.minX, W.maxZ, gx0 - 0.35, W.maxZ, H, T, stone, yardY);
  const southEast = wall(gx1 + 0.35, W.maxZ, cx0, W.maxZ, H, T, stone, yardY);
  // Ivy on both faces of one section between the gate and the drain: the kitten's other way over the wall.
  {
    const seg = southEast.reduce((a, b) => (Math.abs(b.cx - 9.6) < Math.abs(a.cx - 9.6) ? b : a));
    const x0 = seg.cx - seg.len / 2 + 0.14, x1 = seg.cx + seg.len / 2 - 0.14;
    const zo = W.maxZ + T / 2, zi = W.maxZ - T / 2;
    ivyFace({ ax: x0, az: zo, bx: x1, bz: zo, nx: 0, nz: 1, y0: heightAt(seg.cx, zo + 0.3) - 0.05, y1: seg.top, exit: 'over', depth: T }, 71);
    ivyFace({ ax: x1, az: zi, bx: x0, bz: zi, nx: 0, nz: -1, y0: yardY - 0.05, y1: seg.top, exit: 'over', depth: T }, 72, 0.8);
  }
  wall(cx1, W.maxZ, W.maxX, W.maxZ, H, T, stone, yardY);
  wall(W.minX, W.minZ, W.maxX, W.minZ, H, T, stone, yardY, { ruin: 0.1 });
  wall(W.minX, W.minZ, W.minX, W.maxZ, H, T, stone, yardY);
  wall(W.maxX, W.minZ, W.maxX, W.maxZ, H, T, stone, yardY, { ruin: 0.35 });
  // Culvert: stone lintel above a low drain; only the kitten fits beneath.
  {
    const g = new THREE.BoxGeometry(CULVERT.width + 0.1, H - CULVERT.height, T);
    g.translate(0, (H - CULVERT.height) / 2, 0);
    const m = shadow(new THREE.Mesh(g, stone));
    m.position.set(CULVERT.x, yardY - 0.15 + CULVERT.height + 0.15, W.maxZ);
    root.add(m);
    const lintel = shadow(new THREE.Mesh(new THREE.BoxGeometry(CULVERT.width + 0.35, 0.14, T + 0.1), stoneDark));
    lintel.position.set(CULVERT.x, yardY + CULVERT.height + 0.07, W.maxZ);
    root.add(lintel);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(CULVERT.width, CULVERT.height), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#14120f'), roughness: 1 }));
    dark.position.set(CULVERT.x, yardY + CULVERT.height / 2 - 0.05, W.maxZ + 0.01);
    void dark;
    physics.addBox(CULVERT.x, W.maxZ, CULVERT.width / 2 + 0.02, T / 2, 0, -100, 100, MASK.knight, 'culvert');
  }
  // Gate pillars and lintel.
  for (const x of [gx0 - 0.2, gx1 + 0.2]) {
    const p = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, H + 0.6, T + 0.18), stoneDark));
    p.position.set(x, yardY - 0.15 + (H + 0.6) / 2, W.maxZ);
    root.add(p);
    physics.addBox(x, W.maxZ, 0.25, (T + 0.18) / 2, 0, -100, 100);
  }
  const lintel = shadow(new THREE.Mesh(new THREE.BoxGeometry(GATE.width + 1.0, 0.45, T + 0.12), stoneDark));
  lintel.position.set(GATE.x, yardY + H + 0.2, W.maxZ);
  root.add(lintel);
  // Iron grille gate (rises when the winch turns).
  const gate = new THREE.Group();
  for (let i = 0; i <= 8; i++) {
    const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.35, 0.035), iron));
    b.position.set(-GATE.width / 2 + 0.06 + i * (GATE.width - 0.12) / 8, 1.175, 0);
    gate.add(b);
  }
  for (const y of [0.25, 1.1, 1.95]) {
    const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(GATE.width - 0.05, 0.06, 0.05), iron));
    b.position.set(0, y, 0); gate.add(b);
  }
  gate.position.set(GATE.x, yardY - 0.05, W.maxZ);
  root.add(gate);
  const gateCol = physics.addBox(GATE.x, W.maxZ, GATE.width / 2 + 0.05, 0.12, 0, -100, 100, MASK.all, 'gate');
  // Winch inside the yard beside the gate: post, drum, crank lever.
  const winch = new THREE.Group();
  const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), wood));
  post.position.y = 0.45; winch.add(post);
  const drum = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 14), woodDark));
  drum.rotation.z = Math.PI / 2; drum.position.set(0.0, 0.62, 0); winch.add(drum);
  const lever = new THREE.Group();
  const arm = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.42), wood));
  arm.position.z = 0.21; lever.add(arm);
  const handle = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), woodDark));
  handle.rotation.z = Math.PI / 2; handle.position.set(-0.07, 0, 0.4); lever.add(handle);
  lever.position.set(-0.17, 0.62, 0);
  lever.rotation.x = -0.65; // handle raised, out of the kitten's reach unless it hangs
  winch.add(lever);
  const chain = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4), iron));
  winch.add(chain);
  const winchPos = new THREE.Vector3(GATE.x + 1.9, yardY, W.maxZ - 1.0);
  winch.position.copy(winchPos);
  winch.rotation.y = Math.PI / 2;
  root.add(winch);
  physics.addCircle(winchPos.x, winchPos.z, 0.14, -100, 100);

  // ---- Chapel (roofed shelter with a sagging timber roof, door, shield rack, warm lantern).
  const C = CHAPEL, CH = 3.1;
  const dx0 = C.doorX - C.doorW / 2, dx1 = C.doorX + C.doorW / 2;
  wall(C.minX, C.maxZ, dx0, C.maxZ, CH, T, stone, yardY, { ruin: 0.05 });
  wall(dx1, C.maxZ, C.maxX, C.maxZ, CH, T, stone, yardY, { ruin: 0.05 });
  wall(C.minX, C.minZ + 0.3, C.minX, C.maxZ, CH, T, stone, yardY, { ruin: 0.05 });
  wall(C.maxX, C.minZ + 0.3, C.maxX, C.maxZ, CH, T, stone, yardY, { ruin: 0.05 });
  {
    const over = shadow(new THREE.Mesh(new THREE.BoxGeometry(C.doorW + 0.3, 0.9, T), stone));
    over.position.set(C.doorX, yardY + CH - 0.4, C.maxZ); root.add(over);
    // Roof: two steep, sagging planes of dark wet boards (one partly fallen in) between stone gables.
    const roofW = C.maxX - C.minX + 1.2, half = (C.maxZ - C.minZ) / 2, pitch = 0.85;
    const ridgeY = CH + half * Math.tan(pitch), L = (half + 0.45) / Math.cos(pitch);
    const zc = (C.minZ + C.maxZ) / 2, xc = (C.minX + C.maxX) / 2;
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(roofW, L, 24, 10);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, -0.28 * Math.sin(Math.PI * (x / roofW + 0.5)) * Math.sin(Math.PI * (y / L + 0.5)));
      }
      g.computeVertexNormals();
      const roof = shadow(new THREE.Mesh(g, roofMat));
      (roof.material as THREE.Material).side = THREE.DoubleSide;
      roof.position.set(xc, yardY + ridgeY - (L / 2) * Math.sin(pitch), zc + s * (L / 2) * Math.cos(pitch));
      roof.rotation.set(-Math.PI / 2 + s * pitch, 0, 0);
      if (s > 0) roof.scale.x = 0.72, roof.position.x -= roofW * 0.14;
      root.add(roof);
    }
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-half - T / 2, 0); gableShape.lineTo(half + T / 2, 0); gableShape.lineTo(0, ridgeY - CH + 0.1); gableShape.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: T, bevelEnabled: false });
    for (const x of [C.minX, C.maxX]) {
      const gm = shadow(new THREE.Mesh(gableGeo, stone));
      gm.rotation.y = Math.PI / 2;
      gm.position.set(x - T / 2, yardY + CH - 0.02, zc);
      root.add(gm);
    }
  }
  const chapelDoor = new THREE.Group();
  {
    const d = shadow(new THREE.Mesh(new THREE.BoxGeometry(C.doorW, 2.15, 0.09), woodDark));
    d.position.set(C.doorW / 2, 1.075, 0); chapelDoor.add(d);
    for (const y of [0.4, 1.7]) { const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(C.doorW * 0.9, 0.06, 0.03), iron)); b.position.set(C.doorW / 2, y, 0.055); chapelDoor.add(b); }
  }
  chapelDoor.position.set(dx0, yardY - 0.05, C.maxZ);
  root.add(chapelDoor);
  const chapelDoorCol = physics.addBox(C.doorX, C.maxZ, C.doorW / 2, 0.12, 0, -100, 100, MASK.all, 'chapelDoor');
  // Shield rack: a full-size shield beside a kitten-size one (repeated vertical shapes at two scales).
  const rack = new THREE.Group();
  const rb = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.3), wood)); rb.position.y = 0.7; rack.add(rb);
  for (const x of [-0.65, 0.65]) { const l = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), wood)); l.position.set(x, 0.6, 0); rack.add(l); }
  const heater = (w: number, h: number) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, h * 0.35); s.lineTo(w / 2, h * 0.35); s.quadraticCurveTo(w / 2, -h * 0.25, 0, -h * 0.65); s.quadraticCurveTo(-w / 2, -h * 0.25, -w / 2, h * 0.35);
    const g = new THREE.ExtrudeGeometry(s, { depth: w * 0.04, bevelEnabled: true, bevelSize: w * 0.02, bevelThickness: w * 0.02, bevelSegments: 2 });
    return g;
  };
  const bigShield = shadow(new THREE.Mesh(heater(0.62, 0.8), timberMaterial('#4c4f52')));
  bigShield.position.set(-0.3, 1.18, 0.05); bigShield.rotation.x = -0.12; rack.add(bigShield);
  const smallShield = shadow(new THREE.Mesh(heater(0.09, 0.12), timberMaterial('#4c4f52')));
  smallShield.position.set(0.32, 0.86, 0.1); smallShield.rotation.x = -0.12; rack.add(smallShield);
  const rackPos = new THREE.Vector3(C.doorX, yardY, C.minZ + 1.0);
  rack.position.copy(rackPos);
  root.add(rack);
  physics.addBox(rackPos.x, rackPos.z, 0.75, 0.2, 0, -100, 100);
  const lantern = new THREE.PointLight(new THREE.Color('#ffae5c'), 0.0, 9, 1.6);
  lantern.position.set(C.doorX + 2.5, yardY + 2.2, C.minZ + 2.0);
  lantern.castShadow = false;
  root.add(lantern);
  const lanternBody = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), iron));
  lanternBody.position.copy(lantern.position); lanternBody.position.y -= 0.05;
  root.add(lanternBody);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffb36b') }));
  flame.position.copy(lantern.position); flame.visible = false; root.add(flame);

  // ---- Pressure stones.
  const plateMat = PH ? photoMaterial('castle_wall_slates', { scale: 1.4, desat: 0.3, tint: [0.85, 0.86, 0.88], mossy: 0.3 }) : stoneMaterial({ tint: '#77746a', mossy: 0.4 });
  const heavy = shadow(new THREE.Mesh(new THREE.CylinderGeometry(HEAVY_PLATE.r, HEAVY_PLATE.r + 0.05, 0.12, 7), plateMat));
  heavy.position.set(HEAVY_PLATE.x, yardY + 0.02, HEAVY_PLATE.z);
  root.add(heavy);
  const small = shadow(new THREE.Mesh(new THREE.CylinderGeometry(SMALL_PLATE.r, SMALL_PLATE.r + 0.03, 0.08, 6), plateMat));
  small.position.set(SMALL_PLATE.x, yardY + 0.0, SMALL_PLATE.z);
  root.add(small);
  // Pocket: a collapsed corner with a crawl gap and a leaning slab overhead.
  const Pk = POCKET;
  wall(Pk.minX, Pk.minZ, Pk.maxX, Pk.minZ, 1.5, 0.45, stone, yardY, { ruin: 0.2 });
  wall(Pk.minX, Pk.maxZ, Pk.maxX, Pk.maxZ, 1.5, 0.45, stone, yardY, { ruin: 0.2 });
  wall(Pk.maxX, Pk.minZ, Pk.maxX, Pk.gapZ - Pk.gapW / 2, 1.5, 0.45, stone, yardY, { ruin: 0.15 });
  wall(Pk.maxX, Pk.gapZ + Pk.gapW / 2, Pk.maxX, Pk.maxZ, 1.5, 0.45, stone, yardY, { ruin: 0.15 });
  {
    const above = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, Pk.gapW + 0.1), stone));
    above.position.set(Pk.maxX, yardY + 0.4 + 0.55, Pk.gapZ); root.add(above);
    physics.addBox(Pk.maxX, Pk.gapZ, 0.22, Pk.gapW / 2 + 0.02, 0, -100, 100, MASK.knight, 'pocketGap');
    const slab = shadow(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 6.6), stoneDark));
    slab.position.set((Pk.minX + Pk.maxX) / 2, yardY + 1.55, (Pk.minZ + Pk.maxZ) / 2);
    slab.rotation.set(0.04, 0, -0.18);
    root.add(slab);
    // The slab is a ceiling for the camera, so it stays inside the pocket with the kitten.
    physics.addBox((Pk.minX + Pk.maxX) / 2, (Pk.minZ + Pk.maxZ) / 2, 2.3, 3.5, 0, yardY + 1.1, yardY + 2.2, MASK.camera, 'pocketSlab');
  }
  // Rubble inside the yard.
  const rr = mulberry32(5);
  for (let i = 0; i < 16; i++) {
    const x = W.minX + 1 + rr() * (W.maxX - W.minX - 2), z = W.minZ + 7 + rr() * (W.maxZ - W.minZ - 8);
    if (Math.hypot(x - HEAVY_PLATE.x, z - HEAVY_PLATE.z) < 2 || Math.abs(x - GATE.x) < 2 || x < Pk.maxX + 1.2) continue;
    const s = 0.12 + rr() * 0.2;
    const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(s * 2, s, s * 1.4), stone));
    m.position.set(x, yardY + s * 0.3, z); m.rotation.set(rr() * 0.4, rr() * 3, rr() * 0.4);
    root.add(m);
  }

  // ---- Bell tower.
  const tY = heightAt(TOWER.x, TOWER.z);
  const tower = new THREE.Group();
  tower.position.set(TOWER.x, tY, TOWER.z);
  root.add(tower);
  const segs = 22;
  const segW = (2 * Math.PI * (TOWER.r - TOWER.wallT / 2)) / segs * 1.04;
  const tr = mulberry32(9);
  const doorHalf = 0.85 / TOWER.r, winHalf = 0.42 / TOWER.r;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 0; i < segs; i++) {
    const a = (i + 0.5) / segs * Math.PI * 2;
    const top = TOWER.height - (tr() < 0.35 ? tr() * 2.4 : tr() * 0.6);
    const pieces: [number, number][] = [];
    if (angDiff(a, TOWER.doorAngle) < doorHalf) pieces.push([2.05, top]);
    else if (angDiff(a, TOWER.windowAngle) < winHalf) { pieces.push([-0.2, TOWER.floorY - 0.1]); pieces.push([TOWER.floorY + 0.75, top]); }
    else pieces.push([-0.2, top]);
    for (const [y0, y1] of pieces) {
      const g = new THREE.BoxGeometry(segW, y1 - y0, TOWER.wallT);
      g.translate(0, (y1 - y0) / 2, 0);
      const m = shadow(new THREE.Mesh(g, towerStone));
      const rr2 = TOWER.r - TOWER.wallT / 2;
      // Angle convention: a=0 -> +X (east), a=pi/2 -> +Z (south).
      m.position.set(Math.cos(a) * rr2, y0, Math.sin(a) * rr2);
      m.rotation.y = -a + Math.PI / 2;
      tower.add(m);
    }
  }
  // Collision ring, door slab, window sill platform, upper floor platform.
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2, am = (a0 + a1) / 2;
    if (angDiff(am, TOWER.doorAngle) < doorHalf) continue;
    const r2 = TOWER.r - TOWER.wallT / 2;
    const isWin = angDiff(am, TOWER.windowAngle) < winHalf;
    if (isWin) {
      physics.addWall(TOWER.x + Math.cos(a0) * r2, TOWER.z + Math.sin(a0) * r2, TOWER.x + Math.cos(a1) * r2, TOWER.z + Math.sin(a1) * r2, TOWER.wallT, -100, tY + TOWER.floorY - 0.12);
      physics.addWall(TOWER.x + Math.cos(a0) * r2, TOWER.z + Math.sin(a0) * r2, TOWER.x + Math.cos(a1) * r2, TOWER.z + Math.sin(a1) * r2, TOWER.wallT, tY + TOWER.floorY + 0.7, 100);
    } else {
      physics.addWall(TOWER.x + Math.cos(a0) * r2, TOWER.z + Math.sin(a0) * r2, TOWER.x + Math.cos(a1) * r2, TOWER.z + Math.sin(a1) * r2, TOWER.wallT, -100, 100);
    }
  }
  const towerDoor = new THREE.Group();
  {
    const d = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.95, 1.5), woodDark));
    d.position.set(0, 0.975, -0.75); towerDoor.add(d);
    for (const y of [0.35, 1.6]) { const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 1.35), iron)); b.position.set(0.06, y, -0.75); towerDoor.add(b); }
  }
  towerDoor.position.set(TOWER.r - 0.12, -0.05, 0.75);
  tower.add(towerDoor);
  const towerDoorCol = physics.addBox(TOWER.x + TOWER.r - 0.3, TOWER.z, 0.3, 0.8, 0, -100, 100, MASK.all, 'towerDoor');
  // Door bar on the inside, low enough for a hanging kitten to lift.
  const bar = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.7), wood));
  bar.position.set(TOWER.r - 0.68, 0.62, 0);
  tower.add(bar);
  for (const z of [-0.7, 0.7]) { const hk = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.06), iron)); hk.position.set(TOWER.r - 0.62, 0.6, z); tower.add(hk); }
  // Window sill outside and the upper timber floor.
  const sillY = tY + TOWER.floorY;
  physics.platforms.push({ id: 'sill', kind: 'box', x: TOWER.x, z: TOWER.z + TOWER.r - TOWER.wallT / 2, hx: 0.38, hz: TOWER.wallT / 2 + 0.05, rot: 0, top: sillY });
  physics.platforms.push({ id: 'upperFloor', kind: 'circle', x: TOWER.x, z: TOWER.z, r: TOWER.r - TOWER.wallT + 0.02, top: sillY });
  const floorG = new THREE.CylinderGeometry(TOWER.r - TOWER.wallT + 0.05, TOWER.r - TOWER.wallT + 0.05, 0.12, 24);
  const floor = shadow(new THREE.Mesh(floorG, PH ? woodDark : timberMaterial('#3a3026')));
  floor.position.set(0, TOWER.floorY - 0.06, 0);
  tower.add(floor);
  // Beams and the bell high in the ruined top.
  const beam = shadow(new THREE.Mesh(new THREE.BoxGeometry(TOWER.r * 2, 0.22, 0.22), woodDark));
  beam.position.set(0, TOWER.height - 1.9, 0); tower.add(beam);
  const bell = new THREE.Group();
  const bellGeo = new THREE.LatheGeometry([[0.0, 0.0], [0.28, 0.0], [0.3, 0.05], [0.24, 0.2], [0.2, 0.42], [0.16, 0.5], [0.0, 0.52]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const bellM = shadow(new THREE.Mesh(bellGeo, new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#5f5034'), metalness: 0.9, roughness: 0.45 })));
  bellM.position.y = -0.62; bell.add(bellM);
  bell.position.set(0, TOWER.height - 1.9, 0);
  tower.add(bell);
  // Bell rope through the floor down to the ground floor.
  const ropeTop = new THREE.Vector3(0.25, TOWER.height - 2.4, 0.4);
  const rope = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, TOWER.height - 2.4 - 0.55, 6), timberMaterial('#7b6a4f')));
  rope.position.set(ropeTop.x, (TOWER.height - 2.4 + 0.55) / 2, ropeTop.z);
  tower.add(rope);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#0d0b09') }));
  hole.rotation.x = -Math.PI / 2; hole.position.set(ropeTop.x, TOWER.floorY + 0.005, ropeTop.z); tower.add(hole);

  // ---- Standing stones and scattered rocks.
  STANDING_STONES.forEach((s, i) => {
    const m = shadow(new THREE.Mesh(rockGeometry(i + 3, 3), rock));
    const y = heightAt(s.x, s.z);
    m.scale.set(s.r * 0.9, s.h / 2, s.r * 0.6);
    m.position.set(s.x, y + s.h / 2 - 0.25, s.z);
    m.rotation.set(s.lean, i * 1.3, s.lean * 0.5);
    root.add(m);
    // (The perch stone's collider stops at its top, so the kitten can stand up there.)
    physics.addCircle(s.x, s.z, s.r * 0.85, -100, i === 2 ? y + s.h - 0.33 : 100);
    // The tall stone east of the start is ivied on its west face: a perch for a cat, with a view of the moor.
    if (i === 2) {
      const nx = -0.96, nz = -0.28, d = s.r * 0.62, top = y + s.h - 0.3;
      const cx = s.x + nx * d, cz = s.z + nz * d, tx = -nz, tz = nx;
      ivyFace({ ax: cx - tx * 0.24, az: cz - tz * 0.24, bx: cx + tx * 0.24, bz: cz + tz * 0.24, nx, nz, y0: y - 0.05, y1: top, exit: 'ledge', ledgeTop: top }, 73, 1.2);
      physics.platforms.push({ id: 'stoneTop', kind: 'circle', x: s.x, z: s.z, r: s.r * 0.6, top, mask: MASK.kitten });
    }
  });
  const rocks: { x: number; z: number; r: number }[] = [];
  const rr3 = mulberry32(42);
  let tries = 0;
  while (rocks.length < 70 && tries++ < 2000) {
    const a = rr3() * Math.PI * 2, d = 6 + Math.sqrt(rr3()) * 84;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (pathDist(x, z) < 2 || vegetationExclusion(x, z) > 0 || Math.hypot(x - TOWER.x, z - TOWER.z) < 6 || (x > YARD.minX - 3 && x < YARD.maxX + 3 && z > YARD.minZ - 3 && z < YARD.maxZ + 3)) continue;
    // Rocks cluster in a few areas rather than spreading evenly.
    if (noise3.noise(x / 25, z / 25) < 0.1 && rr3() < 0.85) continue;
    const r = rr3() < 0.15 ? 0.5 + rr3() * 0.6 : 0.12 + rr3() * 0.25;
    rocks.push({ x, z, r });
    const m = shadow(new THREE.Mesh(rockGeometry(rocks.length * 7 + 1, r > 0.4 ? 3 : 2), rock));
    m.scale.set(r, r * (0.55 + rr3() * 0.3), r * (0.8 + rr3() * 0.4));
    m.position.set(x, heightAt(x, z) - r * 0.12, z);
    m.rotation.y = rr3() * 6;
    root.add(m);
    if (r > 0.16) physics.addCircle(x, z, r * 0.85, -100, heightAt(x, z) + r * 0.7, r > 0.3 ? MASK.all : MASK.kitten);
  }

  // ---- Puddles.
  const water = waterMaterial();
  for (const p of PUDDLES) {
    const g = new THREE.CircleGeometry(1, 32);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, water);
    m.scale.set(p.rx * 1.05, 1, p.rz * 1.05);
    m.rotation.y = -p.rot;
    m.position.set(p.x, heightAt(p.x, p.z) + 0.035, p.z);
    m.receiveShadow = true;
    m.renderOrder = 2;
    root.add(m);
  }

  // ---- Distant castle on its hill, a faint silhouette through the haze.
  const castle = new THREE.Group();
  const cy = heightAt(CASTLE.x, CASTLE.z);
  castle.position.set(CASTLE.x, cy - 2, CASTLE.z);
  const sil = silhouetteMaterial(LOOK.fogColor, 0.8, undefined, cy - 2);
  const roofSil = silhouetteMaterial(LOOK.fogColor, 0.8, '#3c3e42', cy - 2);
  const addBox = (w: number, h: number, d: number, x: number, z: number, y = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sil); m.position.set(x, y + h / 2, z); castle.add(m); return m; };
  const addTower = (r: number, h: number, x: number, z: number, roofH = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 14), sil); m.position.set(x, h / 2, z); castle.add(m);
    if (roofH) { const c = new THREE.Mesh(new THREE.ConeGeometry(r * 1.2, roofH, 14), roofSil); c.position.set(x, h + roofH / 2, z); castle.add(c); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; if (roofH) break; addBox(r * 0.4, 1.6, r * 0.4, x + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85, h); }
  };
  addBox(16, 30, 16, 0, 0);
  for (let i = 0; i < 6; i++) addBox(2.4, 2.2, 2.4, -6 + i * 2.4 * 1.0, -7, 30);
  addTower(4.5, 46, 6, 6, 12);
  addTower(3.5, 26, -26, 18);
  addTower(3.5, 24, 26, 20);
  addTower(3.2, 22, -30, -14, 7);
  addTower(3.8, 28, 22, -18);
  addBox(52, 15, 3, 0, 19); addBox(3, 14, 34, -28, 2); addBox(3, 13, 36, 24, 1); addBox(48, 12, 3, -3, -16);
  const winMat = new THREE.MeshBasicNodeMaterial();
  winMat.fog = false;
  const castleLight = uniform(0);
  winMat.colorNode = mix(mix(color('#3a3b3e'), LOOK.fogColor, float(0.8)), color('#e8a35a').mul(1.6), castleLight.mul(0.7));
  const wins: [number, number, number][] = [[-3, 18, 8.1], [2, 22, 8.1], [5, 14, 8.1], [-5, 10, 8.1], [6, 34, 10.6], [-26, 18, 21.6], [24, 16, 23.6], [8, 9, 20.6], [-10, 9, 20.6], [0, 9, 20.6]];
  for (const [x, y, z] of wins) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), winMat); w.position.set(x, y, z); castle.add(w); }
  castle.rotation.y = 0.35;
  castle.scale.setScalar(1.25);
  root.add(castle);
  // Banner raised on the keep when the bell is answered.
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3, 6), silhouetteMaterial(LOOK.fogColor, 0.72, '#6a3a34'));
  banner.position.set(6, 58 + 3, 6.5);
  banner.scale.y = 0.01;
  castle.add(banner);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10, 6), sil); pole.position.set(6, 63, 6); castle.add(pole);

  return {
    root,
    rocks,
    gate, gateCol, winch, lever, winchPos,
    chapelDoor, chapelDoorCol, heavy, small, rack, smallShield, rackPos, lantern, flame,
    tower, towerDoor, towerDoorCol, bar, bell, ropeTop, tY, sillY,
    castle, castleLight, banner,
    yardY,
  };
}
