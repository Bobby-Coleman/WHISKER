// Whisker: first field prototype. Bootstraps rendering, world, characters and play.
import * as THREE from 'three/webgpu';
import { createSky, createEnvironment, createLights, setupFog, createMistCards } from './world/atmosphere';
import { createTerrain, createDistantWater, terrainMaterial } from './world/terrain';
import { bakeFieldMaps } from './world/ground';
import { createGrass, GRASS_PUSHERS, GRASS_DEBUG } from './world/grass';
import { createVegetation } from './world/vegetation';
import { createStructures } from './world/structures';
import { createPipeline } from './render/pipeline';
import { LOOK, WIND, GAME, TIERS, QualityTier } from './render/settings';
import { Kitten } from './chars/kitten';
import { loadKittenAssets, loadKnightAssets } from './chars/assets';
import { Knight } from './chars/knight';
import { Character, PoseContext } from './chars/character';
import { CHAR_TOGGLES } from './chars/materials';
import { characterAO, writeOccluders, OccSpec } from './render/occlusion';
import { positionWorld, vec3 } from 'three/tsl';
import { PhysicsWorld } from './game/physics';
import { PlayerController, CompanionController } from './game/controllers';
import { CameraRig } from './game/camera';
import { KeyboardMouseGamepad } from './game/input';
import { Puzzles } from './game/puzzles';
import { regionOf } from './game/nav';
import { Soundscape } from './audio/audio';
import { Hud } from './ui/hud';
import { SPAWN, FIELD, heightAt, wetness } from './world/layout';
import { Simplex2 } from './world/noise';

// Older WebGPU implementations reject the default 'rgba' view swizzle string; it is an identity, so drop it.
const GT: any = (globalThis as any).GPUTexture;
if (GT && GT.prototype.createView) {
  const orig = GT.prototype.createView;
  GT.prototype.createView = function (d?: any) {
    if (d && d.swizzle === 'rgba') { d = { ...d }; delete d.swizzle; }
    return orig.call(this, d);
  };
}

const params = new URLSearchParams(location.search);
const W = window as any;

async function main() {
  const phone = matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
  const tierName = (params.get('q') as QualityTier) || (phone ? 'low' : matchMedia('(max-width: 800px), (pointer: coarse)').matches ? 'medium' : 'high');
  const tier = TIERS[tierName] ?? TIERS.high;
  const forceWebGL = params.has('webgl');
  const renderer = new THREE.WebGPURenderer({ antialias: tier.msaa, forceWebGL });
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.pixelRatioCap) * tier.renderScale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMappingExposure = LOOK.exposure;
  document.getElementById('app')!.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  W.__backend = backend;

  const hudCb: any = {};
  const hud = new Hud(hudCb);
  hud.setBackend(backend);
  const audio = new Soundscape();

  // ---- Scene.
  const scene = new THREE.Scene();
  const envOvercast = createEnvironment(renderer, 'overcast');
  const envWarm = createEnvironment(renderer, 'interior');
  scene.environment = envOvercast;
  scene.environmentIntensity = 1.0;
  scene.add(createSky());
  setupFog(scene);
  const fieldRoot = new THREE.Group(); fieldRoot.name = 'FIELD_01';
  scene.add(fieldRoot);
  const terrain = createTerrain();
  fieldRoot.add(terrain.near, terrain.far, createDistantWater());
  // Baked field maps drive the ground detail and the blade carpet from the same data as the vegetation.
  const fieldMaps = bakeFieldMaps(terrain.near, FIELD.nearHalf, 0.8);
  terrain.near.material = terrainMaterial(fieldMaps);
  const grass = createGrass(fieldMaps, tier.grassDensity);
  fieldRoot.add(grass.group);
  const physics = new PhysicsWorld();
  const structures = createStructures(physics);
  fieldRoot.add(structures.root);
  let veg = createVegetation(tier.grassDensity, tier.grassRadius);
  fieldRoot.add(veg.group);
  const mist = createMistCards(tier.mistCards);
  fieldRoot.add(mist.group);
  const { sun, hemi } = createLights(scene, tier.shadowMap);

  // ---- Characters.
  // Hero head (Blender sculpt, baked maps, groomed strand fur) needs MSAA for its alpha-to-coverage strands.
  const [kittenAssets, knightAssets] = tier.msaa ? await Promise.all([loadKittenAssets(), loadKnightAssets()]) : [null, null];
  const kitten = new Kitten(tier.furShells, kittenAssets);
  const knight = new Knight(knightAssets);
  scene.add(kitten.group, knight.group);
  kitten.attachCloth(scene);
  const ground = (x: number, z: number) => physics.groundAt(x, z);
  const placeAtSpawn = () => {
    for (const [c, s] of [[kitten, SPAWN.kitten], [knight, SPAWN.knight]] as const) {
      c.body.pos.set(s.x, heightAt(s.x, s.z), s.z); c.body.prevPos.copy(c.body.pos);
      c.body.yaw = c.body.prevYaw = s.yaw; c.body.vel.set(0, 0, 0);
      c.carriedBy = null; c.holding = null;
      c.resetPose(ground);
    }
  };
  placeAtSpawn();
  let active: Character = kitten;
  let companion: Character = knight;
  const player = new PlayerController();
  const companions = new Map<Character, CompanionController>([[kitten, new CompanionController()], [knight, new CompanionController()]]);
  const rig = new CameraRig(innerWidth / innerHeight);
  const camera = rig.cam;
  const input = new KeyboardMouseGamepad(renderer.domElement);
  input.onTouchMode = () => hud.setTouch();
  if (matchMedia('(pointer: coarse)').matches) input.enterTouchMode();
  const puzzles = new Puzzles(structures, physics, kitten, knight, (t) => hud.say(t), (n, p, g) => audio.play(n, p, g));
  (puzzles as any).onPlacedOnSill = () => { companions.get(kitten)!.mode = 'wait'; hud.say('The kitten is on the ledge.'); };

  // Prime poses and cloth before the first frame.
  const ctx0: PoseContext = { dt: 1 / 60, time: 0, ground, lookAt: null, active: true };
  for (let i = 0; i < 3; i++) { kitten.updateVisual(1, ctx0); knight.updateVisual(1, ctx0); }
  kitten.resetCloth();

  // ---- Final image.
  let { pipeline } = createPipeline(renderer, scene, camera, { dof: tier.dof });
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    LOOK.resolution.value.set(innerWidth * pr, innerHeight * pr);
    hud.setAspectBars(aspect43);
  };
  let aspect43 = false;
  addEventListener('resize', resize);

  // Spheres standing in for each character's body in the ground's ambient occlusion (part-local centre, radius).
  const KP = kitten.parts, NP = knight.parts;
  const kittenOcc: OccSpec = [
    [KP.pelvis, 0, -0.005, -0.004, 0.042], [KP.chest, 0, 0.045, 0, 0.048], [KP.head, 0, 0, 0, 0.05],
    [KP.thighL, 0, -0.025, 0, 0.02], [KP.thighR, 0, -0.025, 0, 0.02], [KP.shinL, 0, -0.03, 0, 0.014], [KP.shinR, 0, -0.03, 0, 0.014],
    [KP.footL, 0, -0.006, 0.008, 0.014], [KP.footR, 0, -0.006, 0.008, 0.014],
  ];
  const knightOcc: OccSpec = [
    [NP.pelvis, 0, 0, 0, 0.16], [NP.chest, 0, 0.2, 0, 0.19], [NP.head, 0, 0.1, 0, 0.13],
    [NP.thighL, 0, -0.22, 0, 0.09], [NP.thighR, 0, -0.22, 0, 0.09], [NP.shinL, 0, -0.25, 0, 0.07], [NP.shinR, 0, -0.25, 0, 0.07],
    [NP.footL, 0, -0.035, 0.06, 0.06], [NP.footR, 0, -0.035, 0.06, 0.06],
  ];

  // ---- Material lab: neutral overcast turntable with reference spheres.
  const lab = new THREE.Group(); lab.name = 'MaterialLab'; lab.visible = false;
  {
    const gm = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#77776f'), roughness: 0.85 });
    gm.aoNode = characterAO(positionWorld, vec3(0, 1, 0));
    const g = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), gm);
    g.receiveShadow = true; lab.add(g);
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#808080'), roughness: 0.75 }));
    s1.position.set(0.9, 0.12, -0.4); s1.castShadow = true; lab.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#c8c8c4'), roughness: 0.25, metalness: 1 }));
    s2.position.set(1.2, 0.12, -0.2); s2.castShadow = true; lab.add(s2);
  }
  scene.add(lab);
  let mode: 'field' | 'lab' = 'field';
  let turntable = true, labYaw = 0;
  const fieldSnapshot = { kpos: new THREE.Vector3(), npos: new THREE.Vector3() };

  // ---- HUD callbacks.
  let started = params.has('noreveal') || params.has('still');
  let cleanMode = false;
  let treatment = 0.6;
  Object.assign(hudCb, {
    onBegin: () => { audio.start(); started = true; },
    onSkipReveal: () => { if (rig.mode === 'reveal') rig.revealT = rig.revealDur; },
    onTreatment: (v: number) => { treatment = v; if (!cleanMode) LOOK.treatment.value = v; },
    onClean: (on: boolean) => { cleanMode = on; LOOK.treatment.value = on ? 0 : treatment; LOOK.grade.value = on ? 0 : 1; },
    onQuality: (q: string) => { const u = new URL(location.href); u.searchParams.set('q', q); u.searchParams.set('noreveal', '1'); location.href = u.toString(); },
    onVolume: (v: number) => audio.setVolume(v),
    onMute: (m: boolean) => audio.setMuted(m),
    onPreset: (i: number) => { rig.setPreset(i); hud.setPresetName(i >= 0 ? rig.presets[i].name : ''); },
    onAspect43: (on: boolean) => { aspect43 = on; hud.setAspectBars(on); },
    onMode: (m: 'field' | 'lab') => setMode(m),
    onLabToggle: (k: string, on: boolean) => {
      if (k === 'normals') CHAR_TOGGLES.detailNormals.value = on ? 1 : 0;
      if (k === 'rough') CHAR_TOGGLES.roughnessMaps.value = on ? 1 : 0;
      if (k === 'env') scene.environmentIntensity = on ? 1 : 0;
      if (k === 'direct') { sun.visible = on; hemi.visible = on; }
      if (k === 'shadows') renderer.shadowMap.enabled = on;
      if (k === 'fuzz') CHAR_TOGGLES.fuzz.value = on ? 1 : 0;
      if (k === 'env2') scene.environment = on ? envWarm : envOvercast;
      if (k === 'turn') turntable = on;
    },
  });
  function setMode(m: 'field' | 'lab') {
    if (m === mode) return;
    mode = m;
    if (m === 'lab') {
      fieldSnapshot.kpos.copy(kitten.body.pos); fieldSnapshot.npos.copy(knight.body.pos);
      fieldRoot.visible = false; lab.visible = true; LOOK.fogEnabled.value = 0;
      kitten.body.pos.set(0.25, 0, 0); knight.body.pos.set(-0.45, 0, -0.1);
      kitten.body.yaw = knight.body.yaw = 0;
      for (const c of [kitten, knight]) { c.body.prevPos.copy(c.body.pos); c.body.vel.set(0, 0, 0); c.carriedBy = null; c.holding = null; c.resetPose(() => 0); }
      rig.setPreset(-1); labView = 0;
      LOOK.treatment.value = 0; LOOK.grade.value = 0; hud.setChecked('clean', true); cleanMode = true;
    } else {
      fieldRoot.visible = true; lab.visible = false; LOOK.fogEnabled.value = 1;
      placeAtSpawn();
      kitten.resetCloth();
    }
  }
  let labView = 0;
  const LAB_VIEWS = [
    { name: 'Paired scale', pos: new THREE.Vector3(0.05, 1.35, 6.2), look: new THREE.Vector3(0.0, 1.25, 0), mm: 35 },
    { name: 'Kitten face', pos: new THREE.Vector3(0.28, 0.3, 0.36), look: new THREE.Vector3(0.25, 0.285, 0), mm: 70 },
    { name: 'Kitten three-quarter', pos: new THREE.Vector3(0.7, 0.32, 0.6), look: new THREE.Vector3(0.25, 0.2, 0), mm: 60 },
    { name: 'Knight helmet and chest', pos: new THREE.Vector3(-0.2, 1.45, 1.9), look: new THREE.Vector3(-0.45, 1.3, 0), mm: 45 },
    { name: 'Boots and paws', pos: new THREE.Vector3(0.1, 0.3, 1.5), look: new THREE.Vector3(-0.1, 0.15, 0), mm: 40 },
    { name: 'Kitten back', pos: new THREE.Vector3(0.55, 0.35, -0.75), look: new THREE.Vector3(0.25, 0.18, 0), mm: 50 },
    { name: 'Knight back', pos: new THREE.Vector3(-0.9, 1.5, -3.6), look: new THREE.Vector3(-0.45, 1.1, -0.1), mm: 40 },
  ];

  // ---- Debug and capture hooks (used for automated review captures).
  const sim = { move: new THREE.Vector2(), walk: false, until: 0 };
  W.__kk = {
    kitten, knight, puzzles, rig, physics, scene, LOOK, GAME, renderer,
    // Resolves once the GPU has finished everything submitted so far (WebGPU backend only).
    gpuIdle: () => (renderer as any).backend?.device?.queue?.onSubmittedWorkDone?.() ?? Promise.resolve(),
    setActive: (k: 'kitten' | 'knight') => { if (active.kind !== k) switchChar(); },
    teleport: (k: 'kitten' | 'knight', x: number, z: number, yaw = 0) => {
      const c = k === 'kitten' ? kitten : knight;
      c.body.pos.set(x, physics.groundAt(x, z), z); c.body.prevPos.copy(c.body.pos); c.body.yaw = c.body.prevYaw = yaw; c.resetPose(ground);
      if (c === kitten) kitten.resetCloth();
    },
    simMove: (x: number, y: number, seconds: number, walk = false) => { sim.move.set(x, y); sim.walk = walk; sim.until = clockT + seconds; },
    preset: (i: number) => hudCb.onPreset(i),
    mode: (m: 'field' | 'lab') => { setMode(m); },
    labView: (i: number) => { labView = i; },
    // Extra review framings: __kk.labViews.push({ name, pos, look, mm }) then __kk.labView(index).
    labViews: LAB_VIEWS,
    labYaw: (y: number) => { labYaw = y; turntable = false; },
    skip: () => { started = true; rig.revealT = rig.revealDur; },
    clean: (on: boolean) => hudCb.onClean(on),
    interact: () => puzzles.interact(active),
    switchChar: () => switchChar(),
    wait: () => toggleWait(),
    camYaw: (y: number, p = 0.2) => { rig.yaw = y; rig.pitch = p; },
    step: (n: number, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt, false); },
    render: () => frame(1 / 60, true),
    grassDebug: (v: number) => { GRASS_DEBUG.value = v; },
    state: () => ({ active: active.kind, kpos: kitten.body.pos.toArray(), npos: knight.body.pos.toArray(), puzzles: puzzles.state, comp: companions.get(companion)!.status, region: [regionOf(kitten.body.pos), regionOf(knight.body.pos)], prompt: puzzles.prompt }),
  };

  function switchChar() {
    const prev = active;
    if (prev.carriedBy || prev.holding) { /* allowed: carried kitten simply cannot move */ }
    active = companion; companion = prev;
    const cc = companions.get(companion)!;
    // Leaving a character on a pressure stone or a ledge keeps it there; otherwise it resumes following.
    const onStone = puzzles.onPlate(companion);
    const upTower = regionOf(companion.body.pos) === 'towerUp';
    cc.mode = onStone || upTower || cc.mode === 'wait' && (companion as any).__keepWait ? 'wait' : 'follow';
    if (onStone) hud.say(companion.kind === 'knight' ? 'The knight keeps his weight on the stone.' : 'The kitten stays on its stone.');
    companions.get(active)!.mode = 'follow';
    audio.play('clank', active.body.pos, 0.15);
  }
  function toggleWait() {
    const cc = companions.get(companion)!;
    cc.mode = cc.mode === 'wait' ? 'follow' : 'wait';
    hud.say(companion.kind === 'knight' ? (cc.mode === 'wait' ? 'The knight waits.' : 'The knight follows.') : cc.mode === 'wait' ? 'The kitten waits.' : 'The kitten follows.', 2.5);
  }

  // ---- Main loop: fixed 60 Hz simulation with interpolated rendering.
  const H = 1 / GAME.physicsHz;
  let acc = 0;
  let clockT = 0;
  const gustNoise = new Simplex2(5);
  let last = performance.now();
  const stats = { frames: 0, ms: 0, fps: 0 };
  W.__stats = stats;

  function physicsStep(inp: ReturnType<typeof input.poll>, playing: boolean) {
    const pc = playing && !puzzles.busy.has(active) && !active.carriedBy;
    player.update(active, inp, rig.yaw, H, pc);
    const cc = companions.get(companion)!;
    if (!puzzles.busy.has(companion)) cc.update(companion, active, physics, puzzles.nav, H, clockT, (p) => rig.isVisible(p));
    for (const c of [kitten, knight]) {
      if (c.carriedBy) {
        c.body.prevPos.copy(c.body.pos);
        knight.holdPoint(c.body.pos);
        c.body.prevYaw = c.body.yaw; c.body.yaw = knight.body.yaw; c.body.vel.set(0, 0, 0);
        continue;
      }
      if (puzzles.busy.has(c)) { c.body.prevPos.copy(c.body.pos); c.body.prevYaw = c.body.yaw; c.body.vel.set(0, 0, 0); continue; }
      const other = c === kitten ? knight : kitten;
      const obstacles = other.carriedBy || c.holding === other ? [] : [{ x: other.body.pos.x, z: other.body.pos.z, r: other.body.radius * 0.8 }];
      physics.move(c.body, c.kind, H, obstacles);
    }
  }

  function frame(dt: number, render = true) {
    clockT += dt;
    WIND.time.value = clockT;
    WIND.gust = THREE.MathUtils.smoothstep(gustNoise.noise(clockT * 0.11, 0.5) * 0.5 + 0.5 + 0.15 * Math.sin(clockT * 0.7), 0.25, 0.85);
    LOOK.frame.value = (LOOK.frame.value + 1) % 4096;
    let inp = input.poll(dt);
    if (sim.until > clockT) { inp = { ...inp, move: sim.move.clone(), walk: sim.walk }; }
    if (!started && inp.any && !hud.begun) { /* wait for a click on the title */ }
    // Global keys.
    const keys = input.keys;
    void keys;
    if (mode === 'field' && rig.mode === 'reveal') {
      if (!started) rig.updateReveal(0, kitten, knight); // hold the opening shot behind the title
      if (started && rig.updateReveal(dt, kitten, knight)) { rig.endReveal(active); hud.say(input.touchMode ? 'The Switch button changes between the kitten and the knight.' : 'Tab switches between the kitten and the knight.', 5); }
      if (started && inp.skipPressed && rig.revealT > 0.4) rig.revealT = rig.revealDur;
      inp = { ...inp, move: new THREE.Vector2() };
    }
    const playing = mode === 'field' && rig.mode !== 'reveal';
    if (playing) {
      if (inp.switchPressed) switchChar();
      if (inp.waitPressed) toggleWait();
      if (inp.interactPressed) puzzles.interact(active);
      if (inp.resetPressed) { placeAtSpawn(); kitten.resetCloth(); hud.say('The pair returns to where they began.', 2.5); }
    }
    acc += Math.min(dt, 0.1);
    while (acc >= H) { physicsStep(inp, playing); acc -= H; }
    const alpha = acc / H;
    if (mode === 'field') puzzles.update(dt, active);
    // Turntable in the lab.
    if (mode === 'lab') {
      if (turntable) labYaw += dt * 0.35;
      for (const c of [kitten, knight]) { c.body.yaw = c.body.prevYaw = labYaw; }
    }
    const ctx: PoseContext = { dt, time: clockT, ground: mode === 'lab' ? () => 0 : ground, lookAt: null, active: true };
    const kittenHead = kitten.parts.head.getWorldPosition(new THREE.Vector3());
    const knightHead = knight.parts.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
    kitten.updateVisual(alpha, { ...ctx, lookAt: knightHead, active: active === kitten });
    knight.updateVisual(alpha, { ...ctx, lookAt: kittenHead, active: active === knight });
    kitten.update(dt, ctx); knight.update(dt, ctx);
    knight.group.updateMatrixWorld(true);
    writeOccluders(0, kittenOcc); writeOccluders(kittenOcc.length, knightOcc);
    // The grass parts around each character's feet.
    const gp = GRASS_PUSHERS.array as THREE.Vector4[];
    gp[0].set(kitten.body.pos.x, kitten.body.pos.z, 0.2, kitten.carriedBy ? 0 : 1);
    gp[1].set(knight.body.pos.x, knight.body.pos.z, 0.42, 1);
    // Footsteps.
    for (const c of [kitten, knight]) {
      for (const e of c.gait.stepEvents) {
        const f = c.gait.feet[e.side > 0 ? 1 : 0].cur;
        audio.footstep(c.kind, f, e.strength, mode === 'field' ? wetness(f.x, f.z) : 0);
      }
      c.gait.stepEvents.length = 0;
    }
    // Camera.
    if (mode === 'lab') {
      const v = LAB_VIEWS[labView % LAB_VIEWS.length];
      camera.position.copy(v.pos); camera.lookAt(v.look); camera.fov = 2 * Math.atan(12 / v.mm) * 180 / Math.PI; camera.updateProjectionMatrix();
      LOOK.dofAmount.value = 0;
      hud.setPresetName('Material lab: ' + v.name);
      if (inp.switchPressed || inp.interactPressed) labView++;
    } else if (rig.mode === 'preset') {
      rig.updatePreset(kitten, knight);
    } else if (rig.mode === 'play') {
      const moving = Math.hypot(active.body.vel.x, active.body.vel.z) > 0.3;
      rig.update(dt, active, companion, inp.look, inp.zoom, physics, moving);
    }
    // Shadow frustum follows the camera's subject, snapped to texels to avoid shimmer.
    const focus = mode === 'lab' ? new THREE.Vector3(0, 0, 0) : active.group.position;
    const sd = sun.shadow.camera.right * 2 / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / sd) * sd, fz = Math.round(focus.z / sd) * sd;
    sun.position.set(fx - 18, focus.y + 26, fz - 24);
    sun.target.position.set(fx, focus.y, fz);
    sun.target.updateMatrixWorld();
    if (mode === 'field') {
      veg.update(camera.position);
      grass.update(camera);
      mist.update(clockT, camera, heightAt, active.group.position);
    }
    audio.listener.copy(camera.position);
    audio.listenerYaw = Math.atan2(-(camera.getWorldDirection(new THREE.Vector3()).x), -(camera.getWorldDirection(new THREE.Vector3()).z)) + Math.PI;
    audio.update(dt);
    // HUD.
    const cs = companions.get(companion)!;
    const compText = companion.kind === 'knight' ? (cs.mode === 'wait' ? 'The knight waits' : 'The knight follows') : kitten.carriedBy ? 'The kitten is carried' : cs.mode === 'wait' ? 'The kitten waits' : 'The kitten follows';
    hud.setWho(mode === 'lab' ? 'Material lab' : rig.mode === 'reveal' ? '' : active === kitten ? 'Kitten' : 'Knight', mode === 'lab' || rig.mode === 'reveal' ? '' : compText);
    hud.setPrompt(playing && rig.mode === 'play' ? puzzles.prompt : null);
    hud.update(dt);
    CHAR_TOGGLES.pixelAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, innerHeight * renderer.getPixelRatio());
    if (render) pipeline.render();
  }

  // Keys handled outside the per-frame input (UI toggles).
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') hud.togglePanel();
    if (e.code === 'KeyC') { hudCb.onClean(!cleanMode); hud.setChecked('clean', cleanMode); }
    if (e.code === 'KeyF') { aspect43 = !aspect43; hud.setAspectBars(aspect43); hud.setChecked('aspect', aspect43); }
    if (rig.mode !== 'reveal' && mode === 'field') {
      if (e.code === 'Digit1') hudCb.onPreset(0);
      if (e.code === 'Digit2') hudCb.onPreset(1);
      if (e.code === 'Digit3') hudCb.onPreset(2);
      if (e.code === 'Digit4') hudCb.onPreset(3);
      if (e.code === 'Digit0') hudCb.onPreset(-1);
    }
    if (!hud.begun && (e.code === 'Space' || e.code === 'Enter')) hud.begin();
  });

  if (params.has('noreveal')) { hud.begin(); started = true; rig.revealT = rig.revealDur; }
  if (params.has('still')) hud.title.style.display = 'none';
  resize();
  hud.setLoading(null);
  W.__ready = true;
  const still = params.has('still');
  let stillFrames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (still) {
      // Manual capture mode: the test harness steps the simulation and renders on demand.
      if (stillFrames++ === 0) { frame(1 / 60, true); W.__done = true; }
      return;
    }
    frame(dt);
    stats.frames++; stats.ms += dt * 1000;
    if (stats.frames % 60 === 0) { stats.fps = Math.round(60000 / stats.ms); stats.ms = 0; }
  });
}

main().catch((e) => {
  console.error(e);
  W.__error = String(e?.stack || e);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ddd;font:16px Georgia,serif;padding:24px;text-align:center;background:#1d2020';
  d.textContent = 'The moor could not be prepared in this browser. Try a recent Chrome, Edge or Safari, or add ?webgl to the address. ' + String(e?.message || e);
  document.body.appendChild(d);
});
