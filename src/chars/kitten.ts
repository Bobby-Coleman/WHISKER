// The kitten knight, matched to the reference clip: a fluffy cream-ginger longhair kitten (~0.34 m upright) with a
// real animal face, big dark eyes, a small pale pink bow on top of its head, miniature rounded plate, a white cape
// blowing behind it, and an absurdly long sword held point-up in both paws.
import * as THREE from 'three/webgpu';
import { Character, CharacterBody, PoseContext } from './character';
import { lathe, smoothProfile, bladeGeometry, capGeometry, transformed } from './shapes';
import { armorMaterial, clothMaterial, leatherMaterial, furBaseMaterial, furShellMaterial, eyeMaterial, heroShellMaterial, heroEyeMaterial, brassMaterial, capeMaterial, mailMaterial } from './materials';
import { makePart, solveTwoBone, orientBone } from './rig';
import { VerletCloth } from './cloth';
import type { KittenAssets, BodyFur } from './assets';
import { strandMesh } from './strands';
import { polygonize, union, ellipsoid, capsule, smax, smin, SDF } from './sdf';
import { GAME } from '../render/settings';
import { CLIMB_DIST } from '../game/climb';

const lin = (hex: string) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b] as [number, number, number]; };
// Cream-ginger coat: peach base, pale cream face and chest, faint warmer tabby marks on the crown.
const COAT = lin('#e2c29e'), COAT_DARK = lin('#c99b6e'), CREAM = lin('#f3e9d9'), NOSE = lin('#d69c95'), LID = lin('#3a2a20'), INNER_EAR = lin('#cf9f90');
const mixc = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as [number, number, number];
const ss = THREE.MathUtils.smoothstep;
const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

// Face landmarks (head space, +Z forward), shared by the SDF, colors and fur length.
// Kept in step with blender/kitten_head.py, which sculpts the hero head around the same eyes.
const EYE = { x: 0.0195, y: -0.0068, z: 0.0252, r: 0.0128 };
const SOCK = { x: 0.0196, y: -0.0067, z: 0.0322, rx: 0.0112, ry: 0.0092, rz: 0.0062 };
const NOSEP = { x: 0, y: -0.0186, z: 0.0424, rx: 0.0043, ry: 0.0031, rz: 0.0036 };
const CAPE_COLS = 11, CAPE_ROWS = 13;
const CAPE_W = 0.16, CAPE_H = 0.235;

export class Kitten extends Character {
  sword = new THREE.Group();
  furLayers: THREE.Mesh[] = [];
  earL = new THREE.Group(); earR = new THREE.Group();
  tail = new THREE.Group();
  bow = new THREE.Group();
  cape: VerletCloth;
  swordTilt = new THREE.Vector2(); swordTiltV = new THREE.Vector2();
  private twitchT = 3; private twitchSide = 1; private twitchAmt = 0;
  private lookYaw = 0; private lookPitch = 0; private lookTimer = 2; private wantLookUp = false;
  // 0 sword in her paws .. 1 sheathed across her back (climbing, hanging from a lever or rope).
  private sheathe = 0;
  private tailPhase = 0;
  hasShield = false;
  shield = new THREE.Group();
  hangPose = 0; // 0..1 hanging from a lever, bar or rope
  hangTarget = new THREE.Vector3();

  private shellCount = 14;

  constructor(shells: number, private assets: KittenAssets | null = null) {
    const body = new CharacterBody(0.09, 0.34);
    super('kitten', body, {
      hipY: 0.108, hipW: 0.024, l1: 0.05, l2: 0.048, ankleH: 0.014,
      // A long, bounding run stride, so at the shared pace her legs cycle about four times a second, not seven.
      walkStride: 0.34, runStride: 0.8, walkSpeed: GAME.walkSpeed, runSpeed: GAME.runSpeed,
      swingWalk: 0.42, swingRun: 0.62, stepHeightWalk: 0.016, stepHeightRun: 0.03,
      bobWalk: 0.004, bobRun: 0.009, settleRate: 3.4, footSide: 0.027,
    // Long forearms, as in the reference, where the left vambrace crosses the whole chest to the sword grip.
    }, { upperArm: 0.046, foreArm: 0.062, shoulderW: 0.047, shoulderY: 0.072, shoulderZ: 0.008, spine: 0.02, neck: 0.12 });
    this.shellCount = shells;
    this.build(shells);
    // Heavy cream wool, as in the reference, rather than bright white.
    const capeMat = capeMaterial('#ddd3c0');
    // It streams out sideways on the wind at shoulder height and whips in the gusts, as in the reference.
    this.cape = new VerletCloth(CAPE_COLS, CAPE_ROWS, CAPE_W, CAPE_H, capeMat, { windResponse: 2.3, drag: 0.982, taper: 0.4, subdiv: 3, aero: 0.85, friction: 0.24, gravity: 0.55 });
    for (let i = 0; i < CAPE_COLS; i++) this.cape.pin(i, new THREE.Vector3());
    this.cape.mesh.name = 'KittenCape';
  }

  private headSDF(): SDF {
    const base = union(0.01,
      ellipsoid(0, 0.006, -0.004, 0.044, 0.04, 0.042), // cranium
      ellipsoid(0.02, -0.014, 0.008, 0.028, 0.024, 0.027), ellipsoid(-0.02, -0.014, 0.008, 0.028, 0.024, 0.027), // cheeks
      ellipsoid(0, -0.006, 0.03, 0.011, 0.011, 0.012), // nose bridge
      ellipsoid(0.0075, -0.0195, 0.0335, 0.011, 0.009, 0.0102), ellipsoid(-0.0075, -0.0195, 0.0335, 0.011, 0.009, 0.0102), // whisker pads
      ellipsoid(0, -0.0275, 0.027, 0.0095, 0.007, 0.009), // chin
      ellipsoid(0.016, 0.006, 0.027, 0.014, 0.009, 0.011), ellipsoid(-0.016, 0.006, 0.027, 0.014, 0.009, 0.011), // brows
      ellipsoid(0, -0.038, -0.01, 0.028, 0.028, 0.028), // neck
    );
    const nose = ellipsoid(NOSEP.x, NOSEP.y, NOSEP.z, NOSEP.rx, NOSEP.ry, NOSEP.rz);
    const sockL = ellipsoid(SOCK.x, SOCK.y, SOCK.z, SOCK.rx, SOCK.ry, SOCK.rz);
    const sockR = ellipsoid(-SOCK.x, SOCK.y, SOCK.z, SOCK.rx, SOCK.ry, SOCK.rz);
    return (x, y, z) => {
      let d = smin(base(x, y, z), nose(x, y, z), 0.0035);
      d = smax(d, -sockL(x, y, z), 0.003);
      d = smax(d, -sockR(x, y, z), 0.003);
      return d;
    };
  }

  private build(shells: number) {
    const P = this.parts;
    const plate = armorMaterial({ mud: 0.05, wear: 0.45 });
    const legPlate = armorMaterial({ mud: 0.3, wear: 0.6 });
    const fur = furBaseMaterial();
    const leather = leatherMaterial('#3a2a1d');
    const brass = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#8a7448'), metalness: 0.85, roughness: 0.42 });

    if (this.assets) this.buildHeroHead(this.assets, shells);
    else this.buildCodeHead(shells, fur);
    this.buildFace(shells, fur);
    // Blender plate and sword replace the code-built pieces when the hero assets are loaded.
    const hero = !!this.assets;
    if (this.assets) this.buildHeroArmor(this.assets.armor);

    // --- Chest: cuirass with large rounded pauldrons; plated arms; rounded gauntlet paws.
    const cuirass = lathe(smoothProfile([[0.0, 0.044], [0.028, 0.05], [0.056, 0.052], [0.076, 0.046], [0.092, 0.03]], 16), { sz: 0.84, segs: 40, deform: (v) => { if (v.z > 0) v.z *= 1 + 0.12 * Math.exp(-((v.y - 0.045) ** 2) / 0.0006); } });
    if (!hero) P.chest.add(makePart(cuirass, plate));
    if (!hero) P.chest.add(makePart(lathe([[0.004, 0.0455], [-0.008, 0.0465]], { sz: 0.84, segs: 36 }), leather));
    if (!hero) for (const side of [-1, 1]) {
      const pg = new THREE.Group();
      pg.add(makePart(capGeometry(0.027, 1.45, 1, 0.85, 1, 24), plate));
      pg.add(makePart(transformed(lathe([[0, 0.026], [-0.011, 0.027]], { segs: 24 }), [0, -0.01, 0]), plate));
      pg.add(makePart(transformed(lathe([[0, 0.025], [-0.01, 0.026]], { segs: 24 }), [0, -0.019, 0]), plate));
      pg.position.set(side * 0.047, 0.073, -0.002);
      pg.rotation.set(0, 0, -side * 0.42);
      P.chest.add(pg);
    }
    // Fauld and fur hips.
    if (!hero) P.pelvis.add(makePart(lathe([[0.022, 0.044], [0.004, 0.048], [0.004, 0.05], [-0.012, 0.053], [-0.012, 0.055], [-0.028, 0.058]], { sz: 0.82, segs: 32 }), plate));
    const body = this.assets?.body ?? null;
    if (body) this.buildHeroBody(body);
    const hipFur = body ? null : this.furBlob(ellipsoid(0, 0.0, 0, 0.042, 0.03, 0.036), 0.06, mixc(COAT, CREAM, 0.35));
    if (hipFur) {
      P.pelvis.add(makePart(hipFur, fur));
      this.addShells(P.pelvis, hipFur, Math.max(3, Math.round(shells * 0.5)), 0.006, 2200, [0, -0.5, -0.2]);
    }
    // Tail: fluffy, mostly behind the cape.
    if (!body) this.buildCodeTail(shells, fur);
    this.tail.position.set(0, -0.012, -0.03);
    P.pelvis.add(this.tail);

    for (const side of [-1, 1]) {
      const ua = side > 0 ? P.uarmL : P.uarmR, fa = side > 0 ? P.farmL : P.farmR, hand = side > 0 ? P.handL : P.handR;
      if (hero) continue;
      ua.add(makePart(lathe([[0.0, 0.0135], [-0.018, 0.013], [-0.034, 0.0115]], { segs: 18 }), plate));
      fa.add(makePart(transformed(capGeometry(0.0128, 1.35, 1, 1, 1.1, 16), [0, 0, 0.002], [-Math.PI / 2, 0, 0]), plate));
      fa.add(makePart(lathe([[-0.004, 0.0122], [-0.02, 0.0118], [-0.033, 0.0105]], { segs: 18 }), plate));
      hand.add(makePart(polygonize(union(0.004, ellipsoid(0, -0.009, 0.002, 0.0128, 0.0135, 0.012), capsule(0, 0.004, 0, 0, -0.004, 0, 0.011)), new THREE.Vector3(-0.022, -0.028, -0.022), new THREE.Vector3(0.022, 0.012, 0.022), 24), plate));
    }

    // --- Legs: fluffy fur thighs and shins, small knee cops, cream paws.
    for (const side of [-1, 1]) {
      const th = side > 0 ? P.thighL : P.thighR, sh = side > 0 ? P.shinL : P.shinR, ft = side > 0 ? P.footL : P.footR;
      if (!hero) th.add(makePart(lathe(smoothProfile([[0.006, 0.0215], [-0.018, 0.0205], [-0.043, 0.0165]], 8), { sz: 1.08, segs: 20 }), legPlate));
      if (!hero) sh.add(makePart(transformed(capGeometry(0.0145, 1.25, 1, 1, 1, 14), [0, 0.0, 0.006], [Math.PI / 2 - 0.2, 0, 0]), legPlate));
      if (!hero) sh.add(makePart(lathe(smoothProfile([[-0.008, 0.0142], [-0.025, 0.0145], [-0.04, 0.0125]], 8), { sz: 1.12, segs: 20 }), legPlate));
      if (body) continue;
      const thighFur = this.furBlob(capsule(0, 0, 0, 0, -0.05, 0, 0.02, 0.015), 0.03, mixc(COAT, CREAM, 0.55));
      th.add(makePart(thighFur, fur));
      this.addShells(th, thighFur, Math.max(3, Math.round(shells * 0.5)), 0.007, 2200, [0, -0.6, -0.1]);
      const shinFur = this.furBlob(capsule(0, 0, 0, 0, -0.048, 0.002, 0.0135, 0.011), 0.025, mixc(COAT, CREAM, 0.7));
      sh.add(makePart(shinFur, fur));
      this.addShells(sh, shinFur, Math.max(3, Math.round(shells * 0.4)), 0.005, 2200, [0, -0.6, 0.1]);
      const pawGeo = this.furBlob(union(0.005, ellipsoid(0, -0.006, 0.01, 0.0128, 0.0088, 0.02), capsule(0, 0.004, 0, 0, -0.006, 0.0, 0.0098)), 0.035, CREAM);
      ft.add(makePart(pawGeo, fur));
      this.addShells(ft, pawGeo, Math.max(3, Math.round(shells * 0.5)), 0.004, 2600, [0, -0.2, 0.4]);
    }
    this.buildSwordAndShield(plate, leather, brass);
  }

  private buildCodeTail(shells: number, fur: THREE.Material) {
    const tailSdf = union(0.006,
      capsule(0, 0, 0, 0, 0.012, -0.045, 0.012, 0.011),
      capsule(0, 0.012, -0.045, 0, 0.05, -0.07, 0.011, 0.01),
      capsule(0, 0.05, -0.07, 0, 0.09, -0.066, 0.01, 0.008),
    );
    const tailGeo = polygonize(tailSdf, new THREE.Vector3(-0.02, -0.02, -0.09), new THREE.Vector3(0.02, 0.105, 0.015), 44, (_x, y) => mixc(COAT, COAT_DARK, Math.pow(0.5 + 0.5 * Math.cos(y * 150), 4) * 0.4));
    this.addFurAttrs(tailGeo, () => [1.0, 0]);
    this.tail.add(makePart(tailGeo, fur));
    this.addShells(this.tail, tailGeo, Math.max(3, Math.round(shells * 0.6)), 0.011, 2000, [0, 0.1, -0.5]);
  }

  // Groomed body from Blender: each rig part gets its skin and strand fur (legs and ears share one groom per pair).
  private buildHeroBody(body: NonNullable<KittenAssets['body']>) {
    const P = this.parts;
    const skin = furBaseMaterial();
    const look = { rootDarken: 0.6, tipLighten: 1.12, spec: 0.12, rim: 0.7 };
    const targets: Record<string, THREE.Object3D[]> = {
      tail: [this.tail], ear: [this.earL, this.earR], pelvis: [P.pelvis], thigh: [P.thighL, P.thighR], shin: [P.shinL, P.shinR], foot: [P.footL, P.footR],
    };
    const furOf: Record<string, BodyFur> = { tail: 'tail', ear: 'ear', pelvis: 'hips', thigh: 'thigh', shin: 'shin', foot: 'paw' };
    // Undercoat shells per part (fewer on small or mostly covered parts); materials are shared between parts.
    const layers: Record<string, number> = { tail: 8, pelvis: 6, thigh: 6, foot: 6, ear: 4, shin: 4 };
    const shellMats = new Map<number, THREE.Material>();
    const shellMat = (i: number, n: number) => {
      const key = i * 100 + n;
      if (!shellMats.has(key)) shellMats.set(key, heroShellMaterial(i, n, 3000, null));
      return shellMats.get(key)!;
    };
    for (const [name, geo] of body.skins) {
      const part = name.split('__')[0];
      // In the reference the legs are plated from the thigh down to the instep: only the fur toes show below the greaves.
      if (part === 'shin') continue;
      const covered = part === 'thigh';
      const n = covered ? 0 : geo.getAttribute('furLen') ? Math.max(2, Math.round((layers[part] ?? 4) * Math.min(1, this.shellCount / 14))) : 0;
      for (const t of targets[part] ?? []) {
        t.add(makePart(geo, skin));
        if (covered) continue;
        for (let i = 1; i <= n; i++) {
          const m = new THREE.Mesh(geo, shellMat(i, n));
          m.castShadow = false; m.receiveShadow = true;
          m.renderOrder = 3 + i / 100;
          t.add(m);
          this.furLayers.push(m);
        }
        const f = strandMesh(body.fur[furOf[part]], look);
        f.name = `Kitten_${part}_fur`;
        t.add(f);
      }
    }
  }

  private buildSwordAndShield(plate: THREE.Material, leather: THREE.Material, brass: THREE.Material) {
    const P = this.parts;
    const hero = !!this.assets;
    // --- Sword: much longer than its bearer, point up, brass guard and dark leather grip.
    if (!hero) {
      const blade = makePart(bladeGeometry(0.44, 0.022, 0.0045, 1, 0.06), armorMaterial({ mud: 0.0, wear: 0.3, tint: '#cdcdc7', side: THREE.DoubleSide }));
      this.sword.add(blade);
      this.sword.add(makePart(new THREE.BoxGeometry(0.075, 0.0065, 0.009), brass));
      this.sword.add(makePart(transformed(new THREE.CylinderGeometry(0.0055, 0.006, 0.062, 8), [0, -0.031, 0]), leather));
      this.sword.add(makePart(transformed(new THREE.SphereGeometry(0.0085, 12, 8), [0, -0.066, 0]), brass));
    }
    this.sword.name = 'KittenSword';
    this.group.add(this.sword);

    // A kitten-sized shield, hidden until found in the chapel.
    const shieldG = new THREE.CylinderGeometry(0.045, 0.045, 0.006, 3, 1);
    shieldG.rotateX(Math.PI / 2); shieldG.rotateZ(Math.PI / 2); shieldG.scale(1, 1.25, 1);
    this.shield.add(makePart(shieldG, clothMaterial('#4a4f55', { rough: 0.7 })));
    const boss = makePart(new THREE.SphereGeometry(0.01, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    boss.rotation.x = Math.PI / 2; this.shield.add(boss);
    this.shield.visible = false;
    P.farmL.add(this.shield);
    this.shield.position.set(0.018, -0.022, 0.0);
    this.shield.rotation.set(0, Math.PI / 2, 0);
  }

  // Pieces are named part__material__piece; arm and leg pieces are shared by the left and right parts.
  private buildHeroArmor(pieces: Map<string, THREE.BufferGeometry>) {
    const P = this.parts;
    const mats: Record<string, THREE.Material> = {
      // Procedural dents, scratches and grime are sized for human plate; scale them to kitten plate.
      plate: armorMaterial({ mud: 0.05, wear: 0.55, masks: true, scale: 3, tint: '#c2c1ba', engrave: true }),
      legplate: armorMaterial({ mud: 0.05, wear: 0.55, masks: true, scale: 3, tint: '#c2c1ba', engrave: true }),
      steel: armorMaterial({ mud: 0.0, wear: 0.25, tint: '#cfd0cb', masks: true, scale: 3 }),
      brass: brassMaterial(true),
      leather: leatherMaterial('#3a2a1d'),
    };
    const targets: Record<string, THREE.Object3D[]> = {
      chest: [P.chest], pelvis: [P.pelvis], uarm: [P.uarmL, P.uarmR], farm: [P.farmL, P.farmR], hand: [P.handL, P.handR],
      thigh: [P.thighL, P.thighR], shin: [P.shinL, P.shinR], foot: [P.footL, P.footR], sword: [this.sword],
    };
    const glove = leatherMaterial('#2c2119', { scuff: 0.6 });
    for (const [name, geo0] of pieces) {
      const [part, mat] = name.split('__');
      const m = part === 'thigh' || part === 'shin' || part === 'foot' ? (mat === 'plate' ? mats.legplate : mats[mat]) : mats[mat];
      // The reference sword is slimmer and a little shorter: a narrow arming blade, about as long as its bearer.
      let geo = geo0;
      if (name === 'sword__steel__blade') geo = geo0.clone().scale(0.5, 0.74, 0.85);
      if (name === 'sword__brass__guard') geo = geo0.clone().scale(0.78, 1, 1);
      // The reference kitten grips its sword in dark leather gloves rather than plate gauntlets.
      const mm = name === 'hand__plate__gauntlet' ? glove : (m ?? mats.plate);
      for (const t of targets[part] ?? []) t.add(makePart(geo, mm));
    }
    // Code-built details carry no baked masks, so they get mask-free plate.
    this.buildHeroDetails(armorMaterial({ mud: 0.05, wear: 0.55, scale: 3, tint: '#c2c1ba', engrave: true }), armorMaterial({ mud: 0.05, wear: 0.5, scale: 3, tint: '#c2c1ba' }));
  }

  // Pieces from the reference photo that the Blender set lacks: a mail skirt under the faulds, a diagonal leather
  // sword belt with a steel buckle, and caps closing the greaves under the knees.
  private buildHeroDetails(legplate: THREE.Material, plate: THREE.Material) {
    const P = this.parts;
    const mail = makePart(new THREE.CylinderGeometry(0.0548, 0.0608, 0.029, 48, 1, true).scale(1, 1, 0.86), mailMaterial(), true);
    mail.position.set(0, -0.0345, 0.003);
    P.pelvis.add(mail);
    const beltMat = leatherMaterial('#5c3b24'); beltMat.side = THREE.DoubleSide;
    const belt = makePart(new THREE.CylinderGeometry(0.0625, 0.0625, 0.0072, 56, 1, true).scale(1, 1, 0.88), beltMat);
    belt.position.set(0, -0.012, 0.004);
    belt.rotation.set(0, 0, -0.34);
    P.pelvis.add(belt);
    const buckle = makePart(new THREE.BoxGeometry(0.0085, 0.0095, 0.0024), plate);
    buckle.position.set(-0.013, -0.0175, 0.0562);
    buckle.rotation.set(0, 0.22, -0.34);
    P.pelvis.add(buckle);
    for (const shin of [P.shinL, P.shinR]) {
      const cap = makePart(new THREE.CircleGeometry(0.0166, 24).rotateX(-Math.PI / 2).scale(1, 1, 1.08), legplate);
      cap.position.set(0, -0.0075, 0);
      shin.add(cap);
    }
  }

  private buildCodeHead(shells: number, fur: THREE.Material) {
    const eyeDist = (x: number, y: number, z: number) => Math.min(
      Math.hypot((x - SOCK.x) / SOCK.rx, (y - SOCK.y) / SOCK.ry, (z - SOCK.z) / SOCK.rz),
      Math.hypot((x + SOCK.x) / SOCK.rx, (y - SOCK.y) / SOCK.ry, (z - SOCK.z) / SOCK.rz));
    const noseDist = (x: number, y: number, z: number) => Math.hypot((x - NOSEP.x) / NOSEP.rx, (y - NOSEP.y) / NOSEP.ry, (z - NOSEP.z) / NOSEP.rz);
    const P = this.parts;
    // Head: sculpted skull and face, then long fluffy shells for the silhouette.
    const headGeo = polygonize(this.headSDF(), new THREE.Vector3(-0.062, -0.07, -0.056), new THREE.Vector3(0.062, 0.056, 0.054), 88, (x, y, z) => {
      let c = COAT.slice() as [number, number, number];
      const muzzle = ss(z, 0.016, 0.032) * (1 - ss(y, -0.004, 0.006));
      c = mixc(c, CREAM, muzzle * 0.9);
      c = mixc(c, CREAM, ss(-y, 0.024, 0.04) * 0.75); // throat and chest ruff
      c = mixc(c, CREAM, ss(Math.abs(x), 0.022, 0.04) * (1 - ss(y, -0.012, 0.006)) * 0.45); // pale cheeks
      const crown = ss(y, 0.014, 0.03) * (1 - muzzle);
      const stripe = Math.pow(0.5 + 0.5 * Math.cos(x * 230 + Math.sin(z * 90) * 0.7), 3);
      c = mixc(c, COAT_DARK, crown * stripe * 0.45);
      c = mixc(c, NOSE, 1 - ss(noseDist(x, y, z), 0.95, 1.2));
      c = mixc(c, LID, 1 - ss(eyeDist(x, y, z), 1.0, 1.25));
      return c;
    });
    this.addFurAttrs(headGeo, (x, y, z) => {
      const tissue = 1 - ss(noseDist(x, y, z), 0.95, 1.25);
      const ed = eyeDist(x, y, z);
      let len = 1.0;
      len *= 0.12 + 0.88 * ss(ed, 1.05, 1.8);
      len *= 1 - tissue;
      len *= 0.2 + 0.8 * ss(noseDist(x, y, z), 1.15, 2.6); // the nose stands clear of the muzzle fur
      const face = ss(z, 0.012, 0.03) * (1 - ss(Math.abs(x), 0.02, 0.036));
      len *= 1 - 0.5 * face; // shorter over the front of the face
      if (z > 0.024 && y < 0.002) len *= 0.6; // short muzzle fur
      len *= 1 + 0.6 * ss(Math.abs(x), 0.026, 0.046) * (1 - ss(y, -0.008, 0.012)); // cheek fluff
      len *= 1 + 0.6 * ss(-y, 0.026, 0.05); // ruff
      len *= 1 + 0.15 * ss(y, 0.02, 0.04); // crown
      return [len, tissue];
    });
    P.head.add(makePart(headGeo, fur));
    this.addShells(P.head, headGeo, shells, 0.0105, 2300, [0, -0.35, -0.75]);
  }

  // Hero head from Blender: baked skin maps under ~33k groomed strands, plus strand whiskers.
  private buildHeroHead(a: KittenAssets, shells: number) {
    const P = this.parts;
    const skin = new THREE.MeshPhysicalNodeMaterial({
      map: a.headMaps.albedo, normalMap: a.headMaps.normal, roughnessMap: a.headMaps.orm, aoMap: a.headMaps.orm,
      roughness: 1, metalness: 0, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color('#f2e2cc'),
    });
    P.head.add(makePart(a.head, skin));
    // Dense undercoat as shells, drawn inner to outer; the guard hair strands sit on top.
    for (let i = 1; i <= shells; i++) {
      const m = new THREE.Mesh(a.headShell, heroShellMaterial(i, shells, 3400, a.headMaps.albedo));
      m.castShadow = false; m.receiveShadow = true;
      m.renderOrder = 3 + i / 100;
      P.head.add(m);
      this.furLayers.push(m);
    }
    const fur = strandMesh(a.headFur, { rootDarken: 0.6, tipLighten: 1.12, spec: 0.12, rim: 0.7 });
    fur.name = 'KittenHeadFur';
    P.head.add(fur);
    const whiskers = strandMesh(a.whiskers, { rootDarken: 1, tipLighten: 1, spec: 0.35, specTint: 0.15, rim: 0.25, transmit: 0.3, lodBoost: 6, brightness: 1.05 });
    whiskers.name = 'KittenWhiskers';
    P.head.add(whiskers);
  }

  private buildFace(shells: number, fur: THREE.Material) {
    const P = this.parts;
    // Eyes: large, dark and wet, set in sockets and angled slightly outward.
    const codeEye = this.assets ? null : eyeMaterial();
    const lidMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2a201a'), roughness: 0.55 });
    for (const s of [-1, 1]) {
      // Hero eyes carry their own lids (almond opening, rim, upper-lid shadow), mirrored per side.
      const eyeMat = this.assets ? heroEyeMaterial(EYE.r, s) : codeEye!;
      const eye = makePart(new THREE.SphereGeometry(EYE.r, this.assets ? 48 : 28, this.assets ? 32 : 18), eyeMat, false);
      eye.position.set(s * EYE.x, EYE.y, EYE.z);
      // Hero eyes: a slightly larger ball sunk a little deeper, so its fur-coloured lid covers the sculpt's round,
      // dark socket edge and only the almond opening reads as eye.
      eye.rotation.set(-0.05, s * 0.32, 0);
      // The code-built head needs a dark lid ring for the almond outline; the hero head has sculpted lids.
      if (!this.assets) {
        const lid = makePart(new THREE.TorusGeometry(EYE.r * 0.92, EYE.r * 0.11, 8, 28), lidMat, false);
        lid.position.set(0, 0, EYE.r * 0.38);
        lid.scale.set(1.0, 0.86, 1.0);
        lid.rotation.z = s * 0.12;
        eye.add(lid);
      }
      P.head.add(eye);
    }
    // Whiskers: real thin geometry, pale and short.
    const whiskerMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#f1ece2'), roughness: 0.5 });
    if (!this.assets) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const len = 0.028 + i * 0.004;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.00006, 0.00018, len, 3), whiskerMat);
      w.geometry.translate(0, len / 2, 0);
      w.position.set(s * 0.012, -0.019 - i * 0.0022, 0.039);
      w.rotation.set(0.06 * i - 0.06, 0, -s * (Math.PI / 2 - 0.1 + i * 0.1));
      w.rotateX(-0.45);
      P.head.add(w);
    }
    // Ears: small, rounded, set on the sides and mostly sunk into the fluff.
    for (const s of [-1, 1]) {
      const ear = s > 0 ? this.earL : this.earR;
      // Groomed hero ears are added with the rest of the body (buildHeroBody).
      if (!this.assets?.body) {
        const { outer, inner } = this.earGeometries();
        ear.add(makePart(outer, fur));
        ear.add(makePart(inner, new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.6, sheen: 0.4, side: THREE.DoubleSide })));
        this.addShells(ear, outer, Math.max(3, Math.round(shells * 0.6)), 0.0075, 2600, [0, 0.25, -0.35]);
        this.addShells(ear, inner, Math.max(3, Math.round(shells * 0.5)), 0.006, 2600, [0, 0.35, 0.2]);
      }
      ear.position.set(s * 0.0295, 0.0305, -0.003);
      ear.rotation.set(-0.18, s * 0.45, -s * 0.66);
      P.head.add(ear);
    }
    // Small pale pink bow on top of the head, toward the kitten's right.
    const bowMat = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.8, sheenRoughness: 0.45, sheenColor: new THREE.Color('#f7dfe2') });
    const lobes = ellipsoid(0, 0, 0, 0.0142, 0.0062, 0.0029);
    const knot = ellipsoid(0, 0, 0.0006, 0.0031, 0.0035, 0.0032);
    const tails = union(0.0012, capsule(-0.001, -0.002, 0.0, -0.0045, -0.0105, 0.0006, 0.0017), capsule(0.001, -0.002, 0.0, 0.004, -0.0098, 0.0008, 0.0017));
    const bowSdf: SDF = (x, y, z) => {
      const ys = 0.4 + 0.6 * Math.min(1, Math.abs(x) / 0.011); // lobes gathered at the knot
      const lobe = lobes(x, y / ys, z) * Math.min(1, ys) + 0.0005 * Math.exp(-(y * y) / 1.4e-6) * Math.min(1, Math.abs(x) / 0.006);
      return Math.min(smin(lobe, knot(x, y, z), 0.0014), tails(x, y, z * 1.8) / 1.8);
    };
    const bowGeo = polygonize(bowSdf, new THREE.Vector3(-0.017, -0.013, -0.006), new THREE.Vector3(0.017, 0.009, 0.006), 52, (x, y, z) => {
      const crease = Math.exp(-(y * y) / 2e-6) * Math.min(1, Math.abs(x) / 0.004);
      return mixc(lin('#e3a9b2'), lin('#c98793'), Math.min(1, crease * 0.6 + (z < 0 ? 0.25 : 0)));
    });
    this.bow.add(makePart(bowGeo, bowMat));
    // On the kitten's left, near the ear, small and pale, as in the reference photo.
    this.bow.position.set(0.021, 0.047, 0.004);
    this.bow.scale.setScalar(0.6);
    this.bow.rotation.set(-0.55, -0.3, -0.32);
    P.head.add(this.bow);

  }

  private earGeometries() {
    const nu = 8, nv = 8, w = 0.03, h = 0.026, cup = 0.006;
    const build = (front: boolean) => {
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        // Rounded triangular outline.
        const halfW = (w / 2) * Math.pow(1 - Math.pow(v, 1.6), 0.8);
        const x = (u - 0.5) * 2 * halfW;
        const y = v * h;
        const c = cup * Math.sin(Math.PI * u) * (1 - v * 0.8);
        const z = front ? -c + 0.0012 : -c - 0.0012 - 0.0015 * (1 - v);
        pos.push(x, y, z);
        const edge = Math.min(u, 1 - u) * 2;
        const cc = front ? mixc(INNER_EAR, CREAM, (1 - ss(edge, 0.0, 0.5)) * 0.9) : mixc(COAT, COAT_DARK, v * 0.35);
        col.push(cc[0], cc[1], cc[2]);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        if (front) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const outer = build(false), inner = build(true);
    this.addFurAttrs(outer, (_x, y) => [0.6 + 0.6 * (1 - y / h), 0]);
    // Inner furnishings: cream tufts from the rim inward, bare toward the center.
    this.addFurAttrs(inner, (x, y) => [0.35 + 0.9 * ss(Math.abs(x) / (w / 2) + y / h * 0.3, 0.35, 0.9), 0]);
    return { outer, inner };
  }

  private furBlob(sdf: SDF, size: number, col: [number, number, number]) {
    const g = polygonize(sdf, new THREE.Vector3(-size, -size * 2.2, -size), new THREE.Vector3(size, size * 0.8, size * 1.3), 28, () => col);
    this.addFurAttrs(g, () => [0.6, 0]);
    return g;
  }

  private addFurAttrs(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => [number, number]) {
    const p = g.attributes.position;
    const len = new Float32Array(p.count), tis = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { const [l, t] = fn(p.getX(i), p.getY(i), p.getZ(i)); len[i] = l; tis[i] = t; }
    g.setAttribute('furLen', new THREE.BufferAttribute(len, 1));
    g.setAttribute('tissue', new THREE.BufferAttribute(tis, 1));
  }

  private addShells(parent: THREE.Object3D, geo: THREE.BufferGeometry, n: number, length: number, density: number, groom: [number, number, number]) {
    for (let i = 1; i <= n; i++) {
      const m = new THREE.Mesh(geo, furShellMaterial(i, n, length, density, groom));
      m.castShadow = false; m.receiveShadow = true;
      m.renderOrder = 3 + i / 100;
      // Shells extend past the base bounds.
      parent.add(m);
      this.furLayers.push(m);
    }
  }

  attachCloth(scene: THREE.Object3D) { scene.add(this.cape.mesh); }

  // Pinned edge: across the back of the shoulders, under the pauldrons, as wide as the cloth's top edge.
  private capePin(i: number) {
    const x = (i / (CAPE_COLS - 1) - 0.5) * CAPE_W;
    return new THREE.Vector3(x, 0.084 - x * x * 2.2, -0.04 + x * x * 1.6);
  }

  resetCloth() {
    // Bring the drawn body to where the body is now first (after a teleport or a reset it is still at the old
    // place), or the cloth is laid out there and then yanked across the moor in one step.
    this.renderPos.copy(this.body.pos); this.renderYaw = this.body.yaw;
    this.group.position.copy(this.renderPos); this.group.rotation.set(0, this.renderYaw, 0);
    this.group.updateMatrixWorld(true);
    const P = this.parts;
    this.cape.reset((i, j) => {
      const p = this.capePin(i);
      p.x *= 1 + 0.5 * j / (CAPE_ROWS - 1); p.y -= j * CAPE_H / (CAPE_ROWS - 1); p.z -= 0.004 + j * 0.0025;
      return p.applyMatrix4(P.chest.matrixWorld);
    });
  }

  update(dt: number, ctx: PoseContext) {
    const P = this.parts;
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < CAPE_COLS; i++) this.cape.setPin(i, this.capePin(i).applyMatrix4(P.chest.matrixWorld));
    const wp = (o: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
    this.cape.colliders = [
      { a: wp(P.chest, 0, 0.01, 0), b: wp(P.chest, 0, 0.07, 0), r: 0.05 },
      { a: wp(P.pelvis, 0, 0.02, 0), b: wp(P.pelvis, 0, -0.03, 0), r: 0.055 },
      { a: wp(P.head, 0, -0.01, -0.01), b: wp(P.head, 0, 0.01, -0.01), r: 0.05 },
      // The tail lifts the cape rather than poking through it.
      { a: wp(this.tail, 0, 0.0, -0.01), b: wp(this.tail, 0, 0.07, -0.07), r: 0.022 },
    ];
    const sub = Math.min(3, Math.max(1, Math.ceil(dt / (1 / 90))));
    for (let i = 0; i < sub; i++) this.cape.step(Math.min(dt, 1 / 30) / sub, ctx.ground);
    // Should the cloth ever blow up (a jump in its pins it cannot follow), lay it out again rather than lose it.
    if (!Number.isFinite(this.cape.pos[0]) || !Number.isFinite(this.cape.pos[this.cape.pos.length - 1])) this.resetCloth();
  }

  protected leanScale() { return 0.18; }
  protected crouchAmount(speed: number) { return 0.004 + 0.006 * Math.min(1, speed / GAME.runSpeed); }

  protected poseCarried(ctx: PoseContext) {
    const P = this.parts;
    P.pelvis.position.set(0, this.gait.p.hipY, 0);
    P.pelvis.rotation.set(0.05, 0, 0);
    P.pelvis.updateMatrix();
    // Legs dangle with a slight forward set.
    for (const side of [-1, 1]) {
      const thigh = side > 0 ? P.thighL : P.thighR, shin = side > 0 ? P.shinL : P.shinR, foot = side > 0 ? P.footL : P.footR;
      const hip = new THREE.Vector3(side * 0.024, 0, 0).applyMatrix4(P.pelvis.matrix);
      const ankle = hip.clone().add(new THREE.Vector3(side * 0.006, -0.09, 0.012 + Math.sin(ctx.time * 2 + side) * 0.004));
      const knee = new THREE.Vector3();
      const end = solveTwoBone(hip, ankle, 0.05, 0.048, new THREE.Vector3(0, 0, 1), knee);
      orientBone(thigh, hip, knee, new THREE.Vector3(0, 0, 1));
      orientBone(shin, knee, end, new THREE.Vector3(0, 0, 1));
      foot.position.copy(end); foot.rotation.set(0.5, 0, 0);
    }
    this.poseUpper(ctx);
    this.solveArms();
  }

  protected poseUpper(ctx: PoseContext) {
    const P = this.parts, g = this.gait, dt = ctx.dt;
    const pe = P.pelvis;
    const breathe = Math.sin(this.breath * 2.2) * 0.0006;
    P.chest.position.set(pe.position.x * 0.5, pe.position.y + 0.018 + breathe, pe.position.z);
    // A slight turn to the right brings the left shoulder forward for the cross-body grip on the sword.
    // Climbing, she leans in to the face; the turn for the cross-body sword grip goes with the sword.
    P.chest.rotation.set(this.lean * 0.8 - this.hangPose * 0.2 + this.climbBlend * 0.18, -pe.rotation.y * 0.7 - 0.12 * (1 - this.hangPose) * (1 - this.climbBlend), this.leanSide * 0.4 - pe.rotation.z * 0.5);
    P.chest.updateMatrix();
    // Head: solemn and still; looks up at the knight now and then.
    this.lookTimer -= dt;
    if (this.lookTimer < 0) { this.wantLookUp = Math.random() < 0.5; this.lookTimer = 2.5 + Math.random() * 4; }
    let tYaw = 0, tPitch = -0.02;
    if (ctx.lookAt && (this.wantLookUp || !ctx.active)) {
      const l = this.toLocal(ctx.lookAt, new THREE.Vector3());
      const headY = P.chest.position.y + 0.12;
      const yaw = Math.atan2(l.x, l.z), dist = Math.hypot(l.x, l.z);
      const pitch = -Math.atan2(l.y - headY, Math.max(0.2, dist));
      if (Math.abs(yaw) < 1.7 && dist < 8) { tYaw = THREE.MathUtils.clamp(yaw, -1.0, 1.0); tPitch = THREE.MathUtils.clamp(pitch, -0.6, 0.3); }
    }
    if (g.moving > 0.3) { tYaw *= 0.25; tPitch = 0.06; }
    if (this.climbBlend > 0.5) { tYaw = 0; tPitch = -0.32; } // eyes on the way up
    this.lookYaw += (tYaw - this.lookYaw) * Math.min(1, dt * 2.0);
    this.lookPitch += (tPitch - this.lookPitch) * Math.min(1, dt * 2.0);
    P.head.position.copy(new THREE.Vector3(0, 0.122, 0.008).applyMatrix4(P.chest.matrix));
    P.head.quaternion.setFromEuler(new THREE.Euler(this.lookPitch + this.lean * 0.4, this.lookYaw - P.chest.rotation.y, 0, 'YXZ'));
    this.poseAccessories(dt);
    // Sword: upright before its right shoulder with the guard at chin height, as in the reference: the right paw grips
    // under the guard and the left forearm crosses the chest to grip below it. A lagging spring shows its weight.
    const c = Math.cos(this.renderYaw), s = Math.sin(this.renderYaw);
    const accF = s * this.accel.x + c * this.accel.z, accS = c * this.accel.x - s * this.accel.z;
    const target = new THREE.Vector2(THREE.MathUtils.clamp(-accF * 0.035, -0.35, 0.35) + g.moving * 0.12, THREE.MathUtils.clamp(accS * 0.03, -0.3, 0.3));
    const k = 60, damp = 9;
    this.swordTiltV.x += ((target.x - this.swordTilt.x) * k - this.swordTiltV.x * damp) * dt;
    this.swordTiltV.y += ((target.y - this.swordTilt.y) * k - this.swordTiltV.y * damp) * dt;
    this.swordTilt.x += this.swordTiltV.x * dt; this.swordTilt.y += this.swordTiltV.y * dt;
    const bounce = g.bob * 0.6;
    const guard = new THREE.Vector3(-0.027, 0.198 + bounce - this.pelvisDrop, 0.072 + this.lean * 0.05).applyMatrix4(new THREE.Matrix4().makeRotationY(-pe.rotation.y * 0.5));
    this.sword.position.copy(guard);
    this.sword.rotation.set(0.08 + this.swordTilt.x, 0, this.swordTilt.y + 0.07);
    this.sword.updateMatrix();
    const gripTop = new THREE.Vector3(0, -0.015, 0).applyMatrix4(this.sword.matrix);
    const gripLow = new THREE.Vector3(0, -0.042, 0).applyMatrix4(this.sword.matrix);
    // The wrist sits a paw's length short of the grip along the line from the shoulder, so the paw closes on it.
    const d = this.dims;
    const wrist = (grip: THREE.Vector3, side: number) => {
      const sh = new THREE.Vector3(side * d.shoulderW, d.shoulderY, d.shoulderZ ?? 0).applyMatrix4(P.chest.matrix);
      return grip.clone().sub(grip.clone().sub(sh).normalize().multiplyScalar(0.011));
    };
    this.armR.target.copy(wrist(gripTop, -1));
    this.armL.target.copy(wrist(gripLow, 1));
    this.armL.pole.set(1, -1, 0.15); this.armR.pole.set(-1, -0.8, -0.2);
    if (this.hangPose > 0.001) {
      // Both paws reach up to a lever handle, bar or rope.
      const h = this.hangPose;
      const local = this.toLocal(this.hangTarget, new THREE.Vector3());
      this.armL.target.lerp(local.clone().add(new THREE.Vector3(0.008, 0, 0)), h);
      this.armR.target.lerp(local.clone().add(new THREE.Vector3(-0.008, 0, 0)), h);
    }
    // Climbing: paws reach up the face by turns, elbows out, the sword out of the way.
    if (this.climbBlend > 0.001) {
      const k = sm(this.climbBlend);
      const ph = this.body.climb?.phase ?? this.climbPhase;
      this.climbPhase = ph;
      const shY = P.chest.position.y + this.dims.shoulderY;
      const hold = (side: number) => {
        const reach = Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI)));
        return new THREE.Vector3(side * 0.03, shY + 0.05 + 0.04 * reach, CLIMB_DIST - 0.012);
      };
      this.armL.target.lerp(hold(1), k); this.armR.target.lerp(hold(-1), k);
      this.armL.pole.lerp(new THREE.Vector3(1, -0.4, -0.6), k); this.armR.pole.lerp(new THREE.Vector3(-1, -0.4, -0.6), k);
    }
    // Sheathed across her back while her paws are busy: hilt at her left hip, blade up past her right shoulder.
    const wantSheath = this.climbBlend > 0.4 || this.hangPose > 0.05 ? 1 : 0;
    this.sheathe += (wantSheath - this.sheathe) * Math.min(1, dt * 6);
    if (this.sheathe > 0.001) {
      const s = sm(this.sheathe);
      const backPos = new THREE.Vector3(0.03, -0.012, -0.062).applyMatrix4(P.chest.matrix);
      const backQ = new THREE.Quaternion().setFromEuler(P.chest.rotation).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, 0.5)));
      // Lifted off the grip and swung round behind her rather than passed through her body.
      backPos.z -= Math.sin(Math.PI * s) * 0.03;
      this.sword.position.lerp(backPos, s);
      this.sword.quaternion.slerp(backQ, s);
    }
    this.shield.visible = this.hasShield;
  }

  // Ears, bow and tail: their own small motions over whatever the body does.
  private poseAccessories(dt: number) {
    const g = this.gait;
    // Ear twitch: one ear at a time, brief.
    this.twitchT -= dt;
    if (this.twitchT < 0) { this.twitchT = 2.5 + Math.random() * 5; this.twitchSide = Math.random() < 0.5 ? -1 : 1; this.twitchAmt = 1; }
    this.twitchAmt = Math.max(0, this.twitchAmt - dt * 4);
    const tw = Math.sin(this.twitchAmt * Math.PI) * 0.3;
    // Set low on the sides and tilted out and a little forward, as the reference kitten carries them.
    this.earL.rotation.set(-0.16 - (this.twitchSide > 0 ? tw : 0) - g.moving * 0.12, 0.36 + (this.twitchSide > 0 ? tw * 0.6 : 0), -0.64);
    this.earR.rotation.set(-0.16 - (this.twitchSide < 0 ? tw : 0) - g.moving * 0.12, -0.36 - (this.twitchSide < 0 ? tw * 0.6 : 0), 0.64);
    // Bow: barely moves with the wind.
    this.bow.rotation.z = -0.32 + Math.sin(this.breath * 3.1) * 0.03;
    // Tail: slow sway, lifted a little when moving.
    this.tailPhase += dt * (1.1 + g.moving * 2.5);
    this.tail.rotation.set(-0.25 + g.moving * 0.35 + Math.sin(this.tailPhase * 0.5) * 0.05, Math.sin(this.tailPhase) * 0.25, Math.sin(this.tailPhase * 0.7) * 0.08);
  }

  // Driven by the animation library (engine v2): her body comes from the bones; she keeps her ears, bow and tail,
  // and her sword rides sheathed across her back, as when she climbs.
  protected poseSecondary(ctx: PoseContext) {
    const P = this.parts;
    this.poseAccessories(ctx.dt);
    this.sheathe = 1;
    P.chest.updateMatrix();
    this.sword.position.copy(new THREE.Vector3(0.03, -0.012, -0.062).applyMatrix4(P.chest.matrix));
    this.sword.quaternion.copy(P.chest.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, 0.5)));
    this.shield.visible = this.hasShield;
  }

  private climbPhase = 0;
  // Toes on the face by turns, opposite to the paws.
  protected climbFeet(_ctx: PoseContext) {
    const k = sm(this.climbBlend);
    const ph = this.body.climb?.phase ?? this.climbPhase;
    for (const f of this.gait.feet) {
      const lift = Math.max(0, Math.sin(ph + (f.side > 0 ? Math.PI : 0)));
      const t = this.toWorld(new THREE.Vector3(f.side * 0.026, 0.004 + 0.034 * lift, CLIMB_DIST - 0.016), new THREE.Vector3());
      f.cur.lerp(t, k);
      f.lift *= 1 - k;
      f.pitch += (-0.55 - f.pitch) * k;
    }
  }
}
