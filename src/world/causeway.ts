// The marsh crossing (chapters IV and V): drowned hollow, stone causeway toward the castle, the sluice that drains the
// marsh, and the warden's gatehouse with its portcullis. Geometry is built in code from the photo-scanned materials;
// collision is simplified boxes, with the hatch into the sluice hut and the gap under a held portcullis sized so only
// the kitten fits.
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, mix, smoothstep, positionWorld, color, uniform, length, cameraPosition } from 'three/tsl';
import { MARSH, CAUSEWAY, CAUSEWAY_HALF, SLUICE, GATEHOUSE, heightAt, causewayDist } from './layout';
import { PhysicsWorld, MASK } from '../game/physics';
import { photoMaterial } from './surfaces';
import { ironMaterial, timberMaterial } from './materials';
import { FIELD_MATERIALS } from './structures';
import { bakedNoise } from '../render/noisetex';
import { procBump } from '../render/bump';
import { WIND } from '../render/settings';
import { mulberry32 } from './noise';

export type Causeway = ReturnType<typeof createCauseway>;

export function createCauseway(physics: PhysicsWorld) {
  const root = new THREE.Group();
  root.name = 'Marsh';
  const PH = FIELD_MATERIALS.photo;
  const stone = PH ? photoMaterial('castle_wall_varriation', { scale: 3.0, desat: 0.5, tint: [0.66, 0.69, 0.73], mossy: 1.2, damp: 1.4, dampLocal: true }) : timberMaterial('#5b5a55');
  const paving = PH ? photoMaterial('castle_wall_slates', { scale: 2.2, desat: 0.45, tint: [0.58, 0.6, 0.62], mossy: 0.9, roughAdd: -0.1 }) : stone;
  const wood = PH ? photoMaterial('weathered_planks', { scale: 1.2, tint: [0.85, 0.8, 0.76] }) : timberMaterial();
  const wet = PH ? photoMaterial('weathered_planks', { scale: 1.2, tint: [0.55, 0.52, 0.5], roughAdd: -0.25 }) : timberMaterial('#2a241d');
  const iron = ironMaterial();
  const shadow = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
    const m = shadow(new THREE.Mesh(g, mat)); m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m;
  };
  const floorY = MARSH.floorY;

  // ---- Water. Dark peat water carrying the sky; wind ruffles it in travelling patches.
  const waterLevel = uniform(floorY + MARSH.flood);
  const wm = new THREE.MeshPhysicalNodeMaterial();
  {
    const wp = positionWorld;
    const drift = vec2(WIND.dir.x, WIND.dir.y).mul(WIND.time);
    const r1 = bakedNoise(wp.xz.mul(0.9).sub(drift.mul(1.4))).b;
    const r2 = bakedNoise(wp.xz.mul(2.7).sub(drift.mul(2.6)).add(vec2(3.1, 7.7))).a;
    const gustPatch = smoothstep(-0.2, 0.6, bakedNoise(wp.xz.mul(0.05).sub(drift.mul(0.12))).b);
    wm.colorNode = color('#14160f');
    wm.roughnessNode = mix(float(0.03), float(0.16), gustPatch);
    wm.metalness = 0;
    wm.ior = 1.33;
    wm.specularIntensity = 0.9;
    wm.normalNode = procBump(r1.mul(0.004).add(r2.mul(0.0016)).mul(gustPatch.mul(0.8).add(0.4)), float(0.02));
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MARSH.rx * 2 + 16, MARSH.rz * 2 + 16, 1, 1).rotateX(-Math.PI / 2), wm);
  water.position.set(MARSH.x, 0, MARSH.z);
  water.receiveShadow = true;
  water.name = 'MarshWater';
  root.add(water);
  // The sluice channel's water, east of the gate: it falls with the marsh until the gate opens, then runs out.
  const chanWater = new THREE.Mesh(new THREE.PlaneGeometry(SLUICE.chanX1 - SLUICE.x + 3, SLUICE.chanHalf * 2 + 0.4).rotateX(-Math.PI / 2), wm);
  chanWater.position.set((SLUICE.x + SLUICE.chanX1) / 2 + 1, floorY - 0.3, SLUICE.z);
  root.add(chanWater);

  // ---- Causeway: paving along the raised road, kerb stones, and old posts standing out of the water.
  const pts: THREE.Vector3[] = [];
  const line = [...CAUSEWAY, { x: -54.6, z: -140 }, { x: -57.5, z: -175 }];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.6);
    for (let k = 0; k < n; k++) { const t = k / n; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t)); }
  }
  pts.push(new THREE.Vector3(line[line.length - 1].x, 0, line[line.length - 1].z));
  {
    const W = CAUSEWAY_HALF - 0.05;
    const cols = [-W, -W * 0.5, 0, W * 0.5, W];
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l, sz = dx / l;
      for (const c of cols) {
        const x = p.x + sx * c, z = p.z + sz * c;
        pos.push(x, heightAt(x, z) + 0.035 - Math.abs(c) * 0.03, z);
      }
    }
    const C = cols.length;
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < C - 1; j++) {
      const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const road = new THREE.Mesh(g, paving); road.receiveShadow = true; road.name = 'CausewayPaving';
    root.add(road);
  }
  const rr = mulberry32(31);
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)];
    const ang = Math.atan2(q.x - p.x, q.z - p.z);
    for (const s of [-1, 1]) {
      if (rr() < 0.12) continue; // a few kerb stones lost to the water
      const x = p.x + Math.cos(ang) * s * (CAUSEWAY_HALF + 0.05), z = p.z - Math.sin(ang) * s * (CAUSEWAY_HALF + 0.05);
      const h = 0.22 + rr() * 0.1;
      box(0.32, h, 0.55 + rr() * 0.25, stone, x, heightAt(x, z) - 0.12, z, ang + (rr() - 0.5) * 0.12);
    }
  }
  // Old marker posts, every few metres on alternate sides: tall verticals receding into the fog.
  for (let i = 6; i < pts.length; i += 9) {
    const p = pts[i], s = (i / 9) % 2 < 1 ? 1 : -1, q = pts[Math.min(pts.length - 1, i + 1)];
    const ang = Math.atan2(q.x - p.x, q.z - p.z);
    const x = p.x + Math.cos(ang) * s * (CAUSEWAY_HALF + 0.5), z = p.z - Math.sin(ang) * s * (CAUSEWAY_HALF + 0.5);
    const h = 1.6 + rr() * 0.9;
    const post = box(0.16, h, 0.16, wet, x, floorY - 0.2, z, rr());
    post.rotation.z = (rr() - 0.5) * 0.12;
  }

  // ---- Sluice: two stone piers with a board gate between them, a beam across their tops, the wheel on the north
  // pier, and the pin hut on the north bank with a hatch only the kitten fits through.
  const bankY = heightAt(SLUICE.x + 1.2, SLUICE.z + 3.2);
  const pierH = bankY - floorY + 0.35;
  const gz0 = SLUICE.z - SLUICE.chanHalf, gz1 = SLUICE.z + SLUICE.chanHalf;
  for (const z of [gz0 - 0.3, gz1 + 0.3]) box(0.7, pierH, 0.6, stone, SLUICE.x, floorY - 0.1, z);
  // Channel walls running east from the piers.
  for (const z of [gz0 - 0.25, gz1 + 0.25]) box(SLUICE.chanX1 - SLUICE.x, pierH - 0.3, 0.45, stone, (SLUICE.x + SLUICE.chanX1) / 2 + 0.3, floorY - 0.1, z);
  const gateBoard = new THREE.Group();
  {
    const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, SLUICE.chanHalf * 2 + 0.1), wet));
    b.position.y = 0.625; gateBoard.add(b);
    for (const y of [0.25, 0.95]) { const s = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, SLUICE.chanHalf * 2 + 0.12), iron)); s.position.y = y; gateBoard.add(s); }
  }
  gateBoard.position.set(SLUICE.x, floorY - 0.1, SLUICE.z);
  root.add(gateBoard);
  const beamY = floorY - 0.1 + pierH;
  box(0.22, 0.14, SLUICE.chanHalf * 2 + 1.3, wood, SLUICE.x + 0.18, beamY, SLUICE.z);
  // The snag: a drowned branch wedged in the gate slot, below the beam's middle.
  const snag = new THREE.Group();
  {
    const br = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.5, 7), wet));
    br.rotation.set(0.25, 0, 1.25); snag.add(br);
    for (const [a, l] of [[0.6, 0.45], [-0.9, 0.35], [2.2, 0.3]] as const) {
      const tw = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, l, 5), wet));
      tw.position.set(Math.cos(a) * 0.25, 0.1, Math.sin(a) * 0.2); tw.rotation.set(a, 0.4, 0.9); snag.add(tw);
    }
  }
  snag.position.set(SLUICE.x - 0.22, beamY - 0.55, SLUICE.z + 0.05);
  root.add(snag);
  // Wheel: a spoked iron-shod wheel on an axle above the north pier, turned from the north bank.
  const wheel = new THREE.Group();
  {
    const rim = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 28), wood)); wheel.add(rim);
    for (let i = 0; i < 6; i++) {
      const sp = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.82, 0.035), wood)); sp.rotation.z = i * Math.PI / 6; wheel.add(sp);
    }
    for (let i = 0; i < 6; i++) {
      const h = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), wood));
      const a = i * Math.PI / 3; h.position.set(Math.cos(a) * 0.46, Math.sin(a) * 0.46, 0.06); h.rotation.x = Math.PI / 2; wheel.add(h);
    }
  }
  wheel.position.set(SLUICE.x + 0.45, beamY + 0.75, gz1 + 0.35);
  wheel.rotation.y = Math.PI / 2;
  root.add(wheel);
  box(0.12, 0.85, 0.12, wood, SLUICE.x + 0.45, beamY - 0.1, gz1 + 0.35);
  // Pin hut: stone walls, a slate lean-to roof, the hatch low in its east wall, the pin lever inside.
  const hutY = heightAt(SLUICE.hutX, SLUICE.hutZ);
  const H = SLUICE.hut, hx = SLUICE.hutX, hz = SLUICE.hutZ;
  box(2 * H, 1.55, 0.3, stone, hx, hutY - 0.1, hz + H);        // north wall... (south wall below)
  box(2 * H, 1.55, 0.3, stone, hx, hutY - 0.1, hz - H);
  box(0.3, 1.55, 2 * H + 0.3, stone, hx - H, hutY - 0.1, hz);  // west wall
  // East wall with the hatch: two side pieces and a lintel over a 0.34 m opening.
  box(0.3, 1.55, H - 0.2, stone, hx + H, hutY - 0.1, hz - H / 2 - 0.1);
  box(0.3, 1.55, H - 0.2, stone, hx + H, hutY - 0.1, hz + H / 2 + 0.1);
  box(0.3, 1.55 - 0.34, 0.42, stone, hx + H, hutY + 0.24, hz);
  const hutRoof = shadow(new THREE.Mesh(new THREE.BoxGeometry(2 * H + 0.5, 0.12, 2 * H + 0.5), PH ? photoMaterial('roof_slates_02', { scale: 1.4, desat: 0.35, tint: [0.62, 0.65, 0.7], mossy: 1.0 }) : stone));
  hutRoof.position.set(hx, hutY + 1.5, hz); hutRoof.rotation.z = 0.12; root.add(hutRoof);
  const pinLever = new THREE.Group();
  { const arm = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.03), iron)); arm.position.y = 0.16; pinLever.add(arm);
    const knob = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), iron)); knob.position.y = 0.33; pinLever.add(knob); }
  pinLever.position.set(hx + H - 0.55, hutY + 0.05, hz);
  pinLever.rotation.z = 0.5;
  root.add(pinLever);
  // Hut collision: walls for both, the hatch only for the knight.
  physics.addBox(hx, hz + H, H, 0.15, 0, -100, 100); physics.addBox(hx, hz - H, H, 0.15, 0, -100, 100);
  physics.addBox(hx - H, hz, 0.15, H, 0, -100, 100);
  physics.addBox(hx + H, hz - H / 2 - 0.1, 0.15, (H - 0.2) / 2, 0, -100, 100); physics.addBox(hx + H, hz + H / 2 + 0.1, 0.15, (H - 0.2) / 2, 0, -100, 100);
  physics.addBox(hx + H, hz, 0.15, 0.21, 0, -100, 100, MASK.knight, 'hutHatch');
  // Piers and channel walls block both.
  for (const z of [gz0 - 0.3, gz1 + 0.3]) physics.addBox(SLUICE.x, z, 0.35, 0.3, 0, -100, 100);
  for (const z of [gz0 - 0.25, gz1 + 0.25]) physics.addBox((SLUICE.x + SLUICE.chanX1) / 2 + 0.3, z, (SLUICE.chanX1 - SLUICE.x) / 2, 0.22, 0, -100, 100);
  physics.addCircle(SLUICE.x + 0.45, gz1 + 0.35, 0.12, -100, 100);

  // ---- The warden's gatehouse: two square towers over the causeway joined by an arch, a portcullis in the arch, and
  // a short walled bay behind it where the counterweight lever hangs on the west wall.
  const G = GATEHOUSE;
  const gY = heightAt(G.x, G.z);
  const tw = G.towerW;
  for (const s of [-1, 1]) {
    const tx = G.x + s * (G.half + tw / 2);
    box(tw, 5.6, tw, stone, tx, gY - 0.6, G.z);
    // Crenels.
    for (let i = 0; i < 3; i++) box(0.5, 0.45, 0.4, stone, tx - tw / 2 + 0.35 + i * 0.95, gY + 5.0, G.z + tw / 2 - 0.2);
    physics.addBox(tx, G.z, tw / 2, tw / 2, 0, -100, 100);
    // Bay walls behind the arch.
    box(0.45, 3.2, G.z - G.innerZ + 0.4, stone, G.x + s * (G.half + 0.25), gY - 0.4, (G.z + G.innerZ) / 2 - 0.2);
    physics.addBox(G.x + s * (G.half + 0.25), (G.z + G.innerZ) / 2 - 0.2, 0.22, (G.z - G.innerZ + 0.4) / 2, 0, -100, 100);
  }
  box(G.half * 2 + 0.2, 1.4, tw - 0.4, stone, G.x, gY + 2.75, G.z);
  const portcullis = new THREE.Group();
  for (let i = 0; i <= 7; i++) {
    const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.045, 2.75, 0.045), iron));
    b.position.set(-G.half + 0.08 + i * (G.half * 2 - 0.16) / 7, 1.375, 0); portcullis.add(b);
  }
  for (const y of [0.3, 1.0, 1.7, 2.4]) { const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(G.half * 2 - 0.04, 0.05, 0.06), iron)); b.position.set(0, y, 0); portcullis.add(b); }
  // Spikes at the foot.
  for (let i = 0; i <= 7; i++) { const sp = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), iron)); sp.rotation.x = Math.PI; sp.position.set(-G.half + 0.08 + i * (G.half * 2 - 0.16) / 7, -0.06, 0); portcullis.add(sp); }
  portcullis.position.set(G.x, gY, G.z);
  root.add(portcullis);
  const portCol = physics.addBox(G.x, G.z, G.half, 0.12, 0, -100, 100, MASK.all, 'portcullis');
  // Counterweight: a dressed stone on a chain inside the bay, and its release lever (kitten height when hanging).
  const counter = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), stone));
  counter.position.set(G.x + G.half - 0.45, gY + 3.0, G.innerZ + 0.8);
  root.add(counter);
  const chain = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), iron));
  root.add(chain);
  const releaseLever = new THREE.Group();
  { const arm = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.38), iron)); arm.position.z = 0.19; releaseLever.add(arm);
    const grip = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), wood)); grip.rotation.z = Math.PI / 2; grip.position.set(0, 0, 0.37); releaseLever.add(grip); }
  releaseLever.position.set(G.x - G.half + 0.05, gY + 0.62, G.innerZ + 1.0);
  releaseLever.rotation.set(-0.7, Math.PI / 2, 0);
  root.add(releaseLever);
  // Warm lanterns along the far causeway, lit when the castle answers the bell.
  const lanternLight = uniform(0);
  const lmat = new THREE.MeshBasicNodeMaterial();
  lmat.colorNode = mix(color('#3b352d'), color('#ffb469').mul(2.2), lanternLight);
  const lanterns: THREE.Mesh[] = [];
  for (const k of [0, 1, 2, 3, 4]) {
    const i = Math.min(pts.length - 1, pts.findIndex((p) => p.z < G.z - 3) + k * 16);
    const p = pts[i]; if (!p) continue;
    const x = p.x + CAUSEWAY_HALF + 0.35, z = p.z;
    box(0.1, 1.7, 0.1, wet, x, heightAt(x, z) - 0.2, z);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), lmat); l.position.set(x, heightAt(x, z) + 1.55, z); root.add(l); lanterns.push(l);
  }
  const gateLamp = new THREE.PointLight(new THREE.Color('#ffae5c'), 0, 9, 1.8);
  gateLamp.position.set(G.x, gY + 2.3, G.z - 1.2);
  root.add(gateLamp);
  void vec3; void length; void cameraPosition; void causewayDist;

  return {
    root, water, chanWater, waterLevel, gateBoard, snag, wheel, pinLever, portcullis, portCol, counter, chain, releaseLever,
    lanternLight, gateLamp, beamY, bankY, hutY, gY, floorY,
    setWater(level: number) { waterLevel.value = level; water.position.y = level; physics.waterLevel = level; },
  };
}
