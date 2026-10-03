// The human knight, matched to the reference clip: ~1.8 m, a flat-topped great helm, a silver plate front
// (breastplate with a small dark cross, long tassets) over a charcoal gambeson with sleeves and a knee-length
// skirt, dark trousers, tall muddy boots, and an enormous sword held point-up before the chest.
import * as THREE from 'three/webgpu';
import { Character, CharacterBody, PoseContext } from './character';
import { lathe, smoothProfile, bladeGeometry, capGeometry, transformed, shellPanel } from './shapes';
import { armorMaterial, clothMaterial, leatherMaterial, plainMaterial } from './materials';
import { makePart } from './rig';
import { polygonize, union, ellipsoid, capsule, box } from './sdf';
import { GAME, WIND } from '../render/settings';

// Dyed wool reflects a few percent even when it reads black; charcoal sits a little above that.
const CHARCOAL = '#383a3e';
// Hip layers share one cross-section: wider than deep.
const HIP_SX = 1.18, HIP_SZ = 0.72;

type Panel = { g: THREE.Group; axis: THREE.Vector3; out: THREE.Vector3; side: number; kind: 'front' | 'back' | 'side'; phase: number };

export class Knight extends Character {
  sword = new THREE.Group();
  swordBlend = 0; // 0 presented before the chest, 1 carried on the shoulder
  backBlend = 0; // sword slung on the back while the arms hold the kitten
  carryPose = 0; // 0..1 arms raised to hold the kitten
  // Both hands on something in the world (a wheel's handles, a portcullis bar): blends toward reachL/reachR (world).
  reach = 0; reachWant = 0;
  reachL = new THREE.Vector3(); reachR = new THREE.Vector3();
  private moveTimer = 0;
  private lookYaw = 0; private lookPitch = 0;
  private idleShift = 0;
  private panels: Panel[] = [];
  private flap = new Map<THREE.Group, number>();

  constructor(private hero: Map<string, THREE.BufferGeometry> | null = null) {
    const body = new CharacterBody(0.32, 1.8);
    super('knight', body, {
      hipY: 0.982, hipW: 0.1, l1: 0.46, l2: 0.45, ankleH: 0.075,
      walkStride: 1.55, runStride: 2.35, walkSpeed: GAME.walkSpeed, runSpeed: GAME.runSpeed,
      swingWalk: 0.4, swingRun: 0.5, stepHeightWalk: 0.08, stepHeightRun: 0.13,
      bobWalk: 0.018, bobRun: 0.03, settleRate: 1.9, footSide: 0.12,
    }, { upperArm: 0.29, foreArm: 0.27, shoulderW: 0.195, shoulderY: 0.35, spine: 0.08, neck: 0.44 });
    this.build();
  }

  private build() {
    const P = this.parts;
    // Blender helm, plate, boots and sword replace the code-built pieces when loaded (cloth layers stay).
    const H = this.hero;
    const piece = (name: string) => H?.get(name) ?? null;
    const plate = armorMaterial({ mud: 0.04, wear: 0.5 });
    const chestPlate = armorMaterial({ mud: 0.03, wear: 0.45, emblem: true });
    const tassetPlate = armorMaterial({ mud: 0.12, wear: 0.6 });
    const helmPlate = armorMaterial({ mud: 0.02, wear: 0.45, side: THREE.DoubleSide });
    const gambeson = clothMaterial(CHARCOAL, { sheen: '#4a4b4e', weave: 0.5, rough: 0.9, quilt: 0.034 });
    const trousers = clothMaterial('#2c2d30', { sheen: '#3a3b3e', weave: 0.3, rough: 0.9 });
    // Near-black leather as in the clip, mud only splashed up from the soles.
    const boot = leatherMaterial('#1e1c1a', { mud: 0.55, mudTop: -0.34, mudFull: -0.45, scuff: 0.5 });
    const bootFoot = leatherMaterial('#1e1c1a', { mud: 0.75, mudTop: -0.02, mudFull: -0.078, scuff: 0.5 });
    const grip = leatherMaterial('#33261c');
    const belt = leatherMaterial('#2b2119');
    const dark = plainMaterial('#050505', 1.0);
    const heroMat: Record<string, THREE.Material> = {
      plate: armorMaterial({ mud: 0.04, wear: 0.5, masks: true, polish: 0.75 }),
      chestplate: armorMaterial({ mud: 0.03, wear: 0.45, emblem: true, masks: true, polish: 0.8 }),
      tasset: armorMaterial({ mud: 0.12, wear: 0.6, masks: true, polish: 0.7 }),
      helm: armorMaterial({ mud: 0.02, wear: 0.45, masks: true, polish: 0.75 }),
      steel: armorMaterial({ mud: 0.0, wear: 0.3, tint: '#c9c9c3', masks: true }),
      dark: new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#050505'), roughness: 1, side: THREE.DoubleSide }),
      boot, bootfoot: bootFoot, leather: grip,
    };

    // --- Pelvis: hip block, belt, gambeson skirt panels and the two long tassets over the front.
    P.pelvis.add(makePart(lathe(smoothProfile([[0.15, 0.13], [0.06, 0.14], [-0.04, 0.155], [-0.13, 0.165]], 8), { sx: HIP_SX, sz: HIP_SZ, segs: 32 }), gambeson));
    P.pelvis.add(makePart(lathe([[0.135, 0.15], [0.095, 0.153]], { sx: HIP_SX, sz: HIP_SZ, segs: 36 }), belt));
    const skirtProf = smoothProfile([[0.12, 0.146], [0.04, 0.156], [-0.06, 0.172], [-0.2, 0.192], [-0.4, 0.222]], 10);
    const addPanel = (phiC: number, span: number, inset: number, kind: Panel['kind'], side: number) => {
      const prof = skirtProf.map(([y, r]) => [y, r - inset] as [number, number]);
      const geo = lathe(prof, { sx: HIP_SX, sz: HIP_SZ, segs: 8, phiStart: phiC - span / 2, phiLength: span });
      // Pivot along the waist line at the panel's center so it swings outward from the belt.
      const pivot = new THREE.Vector3(Math.sin(phiC) * 0.15 * HIP_SX, 0.1, Math.cos(phiC) * 0.15 * HIP_SZ);
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
      const g = new THREE.Group();
      g.position.copy(pivot);
      g.add(makePart(geo, gambeson));
      P.pelvis.add(g);
      const out = new THREE.Vector3(Math.sin(phiC), 0, Math.cos(phiC));
      this.panels.push({ g, axis: new THREE.Vector3(Math.cos(phiC), 0, -Math.sin(phiC)), out, side, kind, phase: phiC * 3.1 });
      return g;
    };
    // Panels under the tassets sit further in, so swinging in the wind they stay behind the plate.
    addPanel(0.38, 0.8, 0.009, 'front', 1); addPanel(-0.38, 0.8, 0.009, 'front', -1);
    addPanel(1.2, 1.0, 0.016, 'side', 1); addPanel(-1.2, 1.0, 0.016, 'side', -1);
    addPanel(2.2, 1.12, 0.0015, 'side', 1); addPanel(-2.2, 1.12, 0.0015, 'side', -1);
    addPanel(Math.PI - 0.32, 0.7, 0.0, 'back', 1); addPanel(Math.PI + 0.32, 0.7, 0.0, 'back', -1);
    // Tassets: each half spans from the center line outward, flaring as it falls toward mid-thigh.
    const tassetProf = smoothProfile([[0.1, 0.152], [0.04, 0.163], [-0.06, 0.181], [-0.21, 0.203]], 12);
    for (const side of [-1, 1]) {
      const span = (_y: number, t: number) => 0.85 + 0.5 * t;
      const heroGeo = piece('pelvis__tasset__tasset' + (side > 0 ? 'L' : 'R'));
      const geo = heroGeo ? heroGeo.clone() : shellPanel(tassetProf.map(([y, r]) => [y, r + (side > 0 ? 0.002 : 0)] as [number, number]), {
        phiC: (_y, t) => side * ((0.85 + 0.5 * t) / 2 - 0.03), span, sx: HIP_SX, sz: HIP_SZ, segs: 14, thick: 0.0035,
        deform: (v, _u, t) => { v.z += 0.006 * Math.sin(t * Math.PI); },
      });
      const pivot = new THREE.Vector3(side * 0.06, 0.08, 0.11);
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
      const g = new THREE.Group();
      g.position.copy(pivot);
      g.add(makePart(geo, heroGeo ? heroMat.tasset : tassetPlate));
      P.pelvis.add(g);
      this.panels.push({ g, axis: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, 1), side, kind: 'front', phase: side * 0.7 });
    }

    // --- Chest: gambeson torso, round shoulders and a standing collar; breastplate and backplate over it.
    P.chest.add(makePart(lathe(smoothProfile([[-0.06, 0.152], [0.04, 0.16], [0.18, 0.176], [0.29, 0.172], [0.355, 0.15], [0.4, 0.108], [0.43, 0.08]], 20), { sz: 0.68, segs: 40 }), gambeson));
    for (const side of [-1, 1]) {
      const cap = makePart(new THREE.SphereGeometry(0.066, 20, 14), gambeson);
      cap.position.set(side * 0.184, 0.342, -0.006);
      cap.scale.set(1.0, 0.96, 0.9);
      P.chest.add(cap);
    }
    P.chest.add(makePart(lathe([[0.395, 0.09], [0.47, 0.079]], { sz: 0.9, segs: 28 }), gambeson));
    const breastProf = smoothProfile([[-0.045, 0.168], [0.02, 0.172], [0.1, 0.18], [0.2, 0.19], [0.29, 0.183], [0.35, 0.16], [0.395, 0.112]], 22);
    const breast = shellPanel(breastProf, {
      span: (y) => 1.5 - 0.22 * THREE.MathUtils.smoothstep(y, 0.3, 0.395), sz: 0.72, segs: 30, thick: 0.004,
      deform: (v) => {
        const ridge = 0.008 * Math.exp(-(v.x * v.x) / (0.03 * 0.03)) * THREE.MathUtils.smoothstep(v.y, 0.02, 0.16) * (1 - THREE.MathUtils.smoothstep(v.y, 0.3, 0.37));
        v.z = v.z * (1 + 0.1 * Math.exp(-((v.y - 0.17) ** 2) / 0.012)) + ridge;
      },
    });
    if (!H) P.chest.add(makePart(breast, chestPlate));
    const backProf = smoothProfile([[-0.02, 0.165], [0.1, 0.176], [0.22, 0.184], [0.31, 0.176], [0.365, 0.14]], 16);
    if (!H) P.chest.add(makePart(shellPanel(backProf, { phiC: Math.PI, span: () => 1.7, sz: 0.69, segs: 26, thick: 0.004 }), plate));

    // --- Head: flat-topped great helm with an eye slit, a cruciform reinforcement and breaths.
    if (!H) {
      const hs = { sx: 0.92, sz: 1.05, segs: 44 };
      P.head.add(makePart(lathe(smoothProfile([[0.0, 0.117], [0.08, 0.12], [0.165, 0.121]], 8), hs), helmPlate));
      P.head.add(makePart(lathe([[0.177, 0.121], [0.22, 0.121], [0.245, 0.119], [0.262, 0.112], [0.272, 0.098], [0.276, 0.07], [0.277, 0.0]], hs), helmPlate));
      // The slit stays open over the front ±54°; a narrow band closes it elsewhere.
      P.head.add(makePart(lathe([[0.164, 0.121], [0.178, 0.121]], { ...hs, phiStart: Math.PI * 0.3, phiLength: Math.PI * 1.4 }), helmPlate));
      P.head.add(makePart(lathe([[0.004, 0.108], [0.25, 0.108]], { sx: 0.9, sz: 1.02, segs: 24 }), dark, false));
      P.head.add(makePart(lathe([[0.178, 0.1245], [0.194, 0.1245]], { ...hs, phiStart: -Math.PI * 0.32, phiLength: Math.PI * 0.64 }), helmPlate));
      P.head.add(makePart(transformed(new THREE.BoxGeometry(0.024, 0.25, 0.009), [0, 0.128, 0.1285]), helmPlate));
      P.head.add(makePart(lathe([[0.006, 0.1225], [0.022, 0.1225]], hs), helmPlate));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const a = 0.33 + c * 0.12, y = 0.055 + r * 0.03;
        const hole = makePart(new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 8), dark, false);
        hole.position.set(-Math.sin(a) * 0.112, y, Math.cos(a) * 0.128);
        hole.rotation.set(Math.PI / 2, 0, a);
        P.head.add(hole);
      }
    }

    // --- Arms: charcoal sleeves, elbow cops, vambraces and plain gauntlets.
    for (const side of [-1, 1]) {
      const ua = side > 0 ? P.uarmL : P.uarmR;
      const fa = side > 0 ? P.farmL : P.farmR;
      const hand = side > 0 ? P.handL : P.handR;
      ua.add(makePart(lathe(smoothProfile([[0.02, 0.05], [-0.06, 0.054], [-0.2, 0.047], [-0.3, 0.043]], 10), { segs: 22 }), gambeson));
      fa.add(makePart(new THREE.SphereGeometry(0.044, 16, 12), gambeson));
      if (H) continue;
      fa.add(makePart(transformed(capGeometry(0.046, 1.25, 1, 1, 1.05, 20), [0, -0.005, 0.008], [Math.PI / 2, 0, 0]), plate));
      fa.add(makePart(lathe(smoothProfile([[-0.035, 0.049], [-0.1, 0.047], [-0.2, 0.04], [-0.255, 0.037]], 10), { sz: 1.08, segs: 24 }), plate));
      fa.add(makePart(lathe([[-0.25, 0.039], [-0.262, 0.041], [-0.268, 0.039]], { sz: 1.08, segs: 24 }), plate));
      hand.add(makePart(this.gauntletGeometry(side), plate));
    }

    // --- Legs: dark trousers, tall boots with a turned cuff, mud rising from the soles.
    for (const side of [-1, 1]) {
      const th = side > 0 ? P.thighL : P.thighR;
      const sh = side > 0 ? P.shinL : P.shinR;
      const ft = side > 0 ? P.footL : P.footR;
      th.add(makePart(lathe(smoothProfile([[0.04, 0.09], [-0.1, 0.088], [-0.3, 0.072], [-0.47, 0.062]], 12), { sz: 1.05, segs: 24 }), trousers));
      sh.add(makePart(new THREE.SphereGeometry(0.06, 16, 12), trousers));
      sh.add(makePart(lathe([[0.0, 0.06], [-0.09, 0.058]], { sz: 1.05, segs: 20 }), trousers));
      if (H) continue;
      sh.add(makePart(lathe(smoothProfile([[-0.07, 0.066], [-0.14, 0.066], [-0.25, 0.057], [-0.37, 0.048], [-0.44, 0.051]], 12), { sz: 1.1, segs: 24 }), boot));
      sh.add(makePart(lathe([[-0.066, 0.068], [-0.075, 0.073], [-0.11, 0.071], [-0.116, 0.067]], { sz: 1.1, segs: 24 }), boot));
      ft.add(makePart(this.bootGeometry(), bootFoot));
    }

    // --- Sword: enormous and plain. Guard at the origin, blade up +Y, grip and wheel pommel below.
    if (!H) {
      const blade = makePart(bladeGeometry(1.3, 0.125, 0.018, 1, 0.24), armorMaterial({ mud: 0.0, wear: 0.3, tint: '#c9c9c3', side: THREE.DoubleSide }));
      this.sword.add(blade);
      this.sword.add(makePart(new THREE.BoxGeometry(0.3, 0.026, 0.034), plate));
      for (const s of [-1, 1]) this.sword.add(makePart(transformed(new THREE.SphereGeometry(0.02, 12, 8), [s * 0.15, 0, 0], [0, 0, 0], [0.8, 1, 1]), plate));
      this.sword.add(makePart(transformed(new THREE.CylinderGeometry(0.018, 0.02, 0.27, 12), [0, -0.14, 0]), grip));
      this.sword.add(makePart(transformed(new THREE.CylinderGeometry(0.042, 0.042, 0.026, 20), [0, -0.3, 0], [Math.PI / 2, 0, 0]), plate));
    }
    if (H) this.attachHero(H, heroMat);
    this.sword.name = 'KnightSword';
    this.group.add(this.sword);
  }

  // Hero pieces by name (part__material__piece); arm and leg pieces serve both sides, gauntlets come as L/R.
  private attachHero(H: Map<string, THREE.BufferGeometry>, mats: Record<string, THREE.Material>) {
    const P = this.parts;
    const targets: Record<string, THREE.Object3D[]> = {
      chest: [P.chest], head: [P.head], farm: [P.farmL, P.farmR], shin: [P.shinL, P.shinR], foot: [P.footL, P.footR], sword: [this.sword],
    };
    for (const [name, geo] of H) {
      const [part, mat, id] = name.split('__');
      if (part === 'pelvis') continue; // tassets hang from their swing pivots (see build)
      const list = part === 'hand' ? [id.endsWith('L') ? P.handL : P.handR] : targets[part] ?? [];
      for (const t of list) t.add(makePart(geo, mats[mat] ?? mats.plate, mat !== 'dark'));
    }
  }

  private gauntletGeometry(side: number) {
    const s = side;
    const sdf = union(0.012,
      capsule(0, 0.0, 0, 0, -0.04, 0.004, 0.032, 0.029),
      box(0, -0.068, 0.004, 0.033, 0.024, 0.024, 0.017),
      capsule(-0.028 * s, -0.045, 0.016, -0.032 * s, -0.068, -0.01, 0.0105),
    );
    // Shallow grooves read as finger lames.
    const f = (x: number, y: number, z: number) => sdf(x, y, z) + (y < -0.055 ? 0.0011 * Math.max(0, Math.sin(y * 260)) : 0);
    return polygonize(f, new THREE.Vector3(-0.07, -0.13, -0.06), new THREE.Vector3(0.07, 0.04, 0.06), 40);
  }

  private bootGeometry() {
    // Ankle at the origin, sole at y = -ankleH, toe toward +Z.
    const foot = union(0.025,
      ellipsoid(0, -0.035, 0.035, 0.048, 0.042, 0.1),
      ellipsoid(0, -0.052, 0.12, 0.041, 0.027, 0.075),
      capsule(0, 0.03, -0.01, 0, -0.04, -0.02, 0.044),
    );
    const cut = (x: number, y: number, z: number) => Math.max(foot(x, y, z), -(y + 0.075));
    return polygonize(cut, new THREE.Vector3(-0.07, -0.08, -0.08), new THREE.Vector3(0.07, 0.07, 0.22), 46);
  }

  update(_dt: number, _ctx: PoseContext) {}

  protected crouchAmount(speed: number) {
    return 0.006 + 0.026 * Math.min(1, speed / GAME.runSpeed) + this.carryPose * 0.02 + this.reach * 0.05;
  }

  protected poseUpper(ctx: PoseContext) {
    const P = this.parts, g = this.gait;
    const dt = ctx.dt;
    const speed = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.idleShift += dt;
    // Chest rides on the pelvis with counter-rotation; breathing lifts the plate slightly.
    const breathe = Math.sin(this.breath * 1.25) * 0.004;
    const pe = P.pelvis;
    P.chest.position.set(pe.position.x * 0.5 + Math.sin(this.idleShift * 0.23) * 0.004 * (1 - g.moving), pe.position.y + 0.1 + breathe, pe.position.z);
    P.chest.rotation.set(this.lean * 0.8 + this.carryPose * 0.05, -pe.rotation.y * 0.75, this.leanSide * 0.4 - pe.rotation.z * 0.6);
    P.chest.updateMatrix();
    // Head: occasional slow looks; lowers toward the kitten without crouching.
    let tYaw = 0, tPitch = 0;
    if (ctx.lookAt) {
      const l = this.toLocal(ctx.lookAt, new THREE.Vector3());
      const headY = P.chest.position.y + 0.55;
      const yaw = Math.atan2(l.x, l.z), dist = Math.hypot(l.x, l.z);
      const pitch = Math.atan2(headY - l.y, Math.max(0.3, dist));
      // A glance down rather than a bow: the helm stays nearly level, as in the reference.
      if (Math.abs(yaw) < 1.6 && dist < 9) { tYaw = THREE.MathUtils.clamp(yaw, -0.9, 0.9); tPitch = THREE.MathUtils.clamp(pitch * 0.5, -0.1, 0.22); }
    }
    if (g.moving > 0.3) { tYaw *= 0.3; tPitch = 0.05; }
    this.lookYaw += (tYaw - this.lookYaw) * Math.min(1, dt * 1.6);
    this.lookPitch += (tPitch - this.lookPitch) * Math.min(1, dt * 1.6);
    P.head.position.copy(new THREE.Vector3(0, 0.445, 0.0).applyMatrix4(P.chest.matrix));
    P.head.quaternion.setFromEuler(new THREE.Euler(this.lookPitch + this.lean * 0.3, this.lookYaw - P.chest.rotation.y, 0, 'YXZ'));

    // Sword: presented point-up before the chest at rest; carried on the right shoulder while moving;
    // slung across the back while the arms hold the kitten. Poses are in chest space so they ride the torso.
    if (speed > 0.25) this.moveTimer = Math.min(this.moveTimer + dt, 1); else this.moveTimer = Math.max(this.moveTimer - dt * 0.8, 0);
    const wantCarried = this.moveTimer > 0.15 ? 1 : 0;
    this.swordBlend += (wantCarried - this.swordBlend) * Math.min(1, dt * 4.0);
    this.backBlend += ((this.holding || this.reachWant > 0.5 ? 1 : 0) - this.backBlend) * Math.min(1, dt * 3.5);
    this.reach += (this.reachWant - this.reach) * Math.min(1, dt * 4);
    this.carryPose += ((this.holding ? 1 : 0) - this.carryPose) * Math.min(1, dt * 4);
    const sm = (x: number) => { const c = THREE.MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };
    // Move out to the shoulder first, then tip back, so the blade never passes through the helm.
    const eOut = sm(this.swordBlend * 1.7), eTip = sm((this.swordBlend - 0.25) / 0.75);
    const sway = Math.sin(this.idleShift * 0.7) * 0.012 * (1 - g.moving);
    const presentedPos = new THREE.Vector3(-0.03 + sway * 0.4, 0.29, 0.28);
    const presentedQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.07 + sway, 0.15, 0.13));
    const carriedPos = new THREE.Vector3(-0.2, 0.18 + g.bob * 0.4, 0.25);
    const carriedQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75 + this.lean * 0.3, 0.0, 0.08));
    const localPos = presentedPos.clone().lerp(carriedPos, eOut);
    localPos.z += Math.sin(Math.PI * eOut) * 0.05;
    const localQ = presentedQ.clone().slerp(carriedQ, eTip);
    if (this.backBlend > 0.001) {
      const b = sm(this.backBlend);
      localPos.lerp(new THREE.Vector3(0.05, 0.0, -0.215), b);
      localQ.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, -0.45)), b);
    }
    const chestQ = new THREE.Quaternion().setFromEuler(P.chest.rotation);
    this.sword.position.copy(localPos.applyMatrix4(P.chest.matrix));
    this.sword.quaternion.copy(chestQ).multiply(localQ);
    this.sword.updateMatrix();
    const upper = new THREE.Vector3(0, -0.065, 0).applyMatrix4(this.sword.matrix);
    const lower = new THREE.Vector3(0, -0.2, 0).applyMatrix4(this.sword.matrix);
    const shoulderCarryHand = new THREE.Vector3(0, -0.08, 0).applyMatrix4(this.sword.matrix);
    const swing = Math.sin(g.phase * Math.PI * 2);
    const sh = (side: number) => new THREE.Vector3(side * this.dims.shoulderW, this.dims.shoulderY, 0).applyMatrix4(P.chest.matrix);
    const freeL = sh(1).add(new THREE.Vector3(0.05, -0.53, 0.04 + swing * 0.2 * g.moving));
    const freeR = sh(-1).add(new THREE.Vector3(-0.05, -0.53, 0.04 - swing * 0.2 * g.moving));
    // Right hand stays on the grip until the sword goes to the back; the left lets go for the shoulder carry.
    const rightOnSword = upper.clone().lerp(shoulderCarryHand, eOut);
    this.armR.target.copy(rightOnSword).lerp(freeR, sm(this.backBlend));
    this.armL.target.copy(lower).lerp(freeL, Math.max(eOut, sm(this.backBlend)));
    // Elbows out to the sides when presenting the sword; down and back when carrying it.
    this.armR.pole.set(-1, -0.75, -0.25).lerp(new THREE.Vector3(-1, -0.6, -0.4), eOut);
    this.armL.pole.set(1, -0.75, -0.25).lerp(new THREE.Vector3(1, -0.5, -0.6), eOut);
    if (this.carryPose > 0.001) {
      const c = this.carryPose;
      const hold = new THREE.Vector3(0, 1.2, 0.34);
      this.armL.target.lerp(hold.clone().add(new THREE.Vector3(0.07, 0, 0)), c);
      this.armR.target.lerp(hold.clone().add(new THREE.Vector3(-0.07, 0, 0)), c);
      this.armL.pole.lerp(new THREE.Vector3(1, -1, 0), c);
      this.armR.pole.lerp(new THREE.Vector3(-1, -1, 0), c);
    }
    if (this.reach > 0.001) {
      const c = sm(this.reach);
      this.armL.target.lerp(this.toLocal(this.reachL, new THREE.Vector3()), c);
      this.armR.target.lerp(this.toLocal(this.reachR, new THREE.Vector3()), c);
      this.armL.pole.lerp(new THREE.Vector3(1, -0.7, -0.3), c);
      this.armR.pole.lerp(new THREE.Vector3(-1, -0.7, -0.3), c);
    }
    this.poseSkirt(ctx);
  }

  // Skirt panels and tassets swing out of the way of the thighs and lift a little in the wind.
  private poseSkirt(ctx: PoseContext) {
    const P = this.parts;
    const pitch = (thigh: THREE.Object3D, shin: THREE.Object3D) => Math.atan2(shin.position.z - thigh.position.z, Math.max(0.05, thigh.position.y - shin.position.y));
    const pL = pitch(P.thighL, P.shinL), pR = pitch(P.thighR, P.shinR);
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const wx = c * WIND.dir.x - s * WIND.dir.y, wz = s * WIND.dir.x + c * WIND.dir.y;
    const t = WIND.time.value as number;
    const gust = WIND.gust;
    for (const p of this.panels) {
      const th = p.side > 0 ? pL : pR;
      let target = 0;
      if (p.kind === 'front') target = Math.max(0, th) * 0.85;
      else if (p.kind === 'back') target = Math.max(0, -th) * 0.8;
      else target = Math.abs(th) * 0.12;
      const downwind = p.out.x * wx + p.out.z * wz;
      target += Math.max(-0.02, downwind) * (0.05 + gust * 0.12) + Math.sin(t * 2.7 + p.phase) * 0.012 * (0.3 + gust);
      const cur = this.flap.get(p.g) ?? 0;
      const next = cur + (target - cur) * Math.min(1, ctx.dt * 14);
      this.flap.set(p.g, next);
      p.g.quaternion.setFromAxisAngle(p.axis, -next);
    }
  }

  // Hand position used to hold the kitten while lifting.
  holdPoint(out: THREE.Vector3) {
    return this.toWorld(new THREE.Vector3(0, 1.2 - this.crouchAmount(0) - 0.13, 0.36), out);
  }
}
