// Whisker: first field prototype. Bootstraps rendering, world, characters and play.
import * as THREE from 'three/webgpu';
import { createSky, createEnvironment, createLights, setupFog, createMistCards, MIST_CARDS } from './world/atmosphere';
import { createTerrain, createDistantWater, terrainMaterial, photoTerrainMaterial } from './world/terrain';
import { preloadSurfaces } from './world/surfaces';
import { bakeFieldMaps } from './world/ground';
import { createGrass, GRASS_PUSHERS, GRASS_DEBUG } from './world/grass';
import { createVegetation } from './world/vegetation';
import { createStructures, FIELD_MATERIALS } from './world/structures';
import { Weather, WeatherId } from './world/weather';
import { createSpray } from './world/spray';
import { createPipeline } from './render/pipeline';
import { LOOK, WIND, GAME, TIERS, QualityTier, RENDER } from './render/settings';
import { Kitten } from './chars/kitten';
import { loadKittenAssets, loadKnightAssets } from './chars/assets';
import { Knight } from './chars/knight';
import { Character, PoseContext } from './chars/character';
import { CHAR_TOGGLES } from './chars/materials';
import { characterAO, writeOccluders, OccSpec } from './render/occlusion';
import { positionWorld, vec3, uniform, bool } from 'three/tsl';
import { temporalAlphaThreshold } from './render/temporal';
import { PhysicsWorld } from './game/physics';
import { PlayerController, CompanionController } from './game/controllers';
import { tryGrab, climbStep } from './game/climb';
import { CameraRig } from './game/camera';
import { KeyboardMouseGamepad } from './game/input';
import { Puzzles } from './game/puzzles';
import { Story } from './game/story';
import { createCauseway } from './world/causeway';
import { regionOf } from './game/nav';
import { Soundscape } from './audio/audio';
import { Hud } from './ui/hud';
import { LoadTracker, nextPaint } from './ui/loading';
import { StatsPanel } from './ui/stats';
import { downloads } from './chars/binfile';
import { SPAWN, FIELD, MARSH, GATEHOUSE, heightAt, wetness } from './world/layout';
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

// Per-viewer settings remembered between visits (storage can be unavailable, e.g. in a private window).
function readPref(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writePref(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* not remembered */ }
}
function readPrefString(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePrefString(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* not remembered */ }
}

async function main() {
  const phone = matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
  const tierName = (params.get('q') as QualityTier) || (phone ? 'low' : matchMedia('(max-width: 800px), (pointer: coarse)').matches ? 'medium' : 'high');
  const tier = TIERS[tierName] ?? TIERS.high;
  const forceWebGL = params.has('webgl');
  // Anti-aliasing: TAA wherever MSAA was used before (the hero fur's coverage resolves over frames instead), FXAA on
  // phones; ?aa=msaa brings back the earlier MSAA + FXAA pipeline for comparison.
  RENDER.aa = (params.get('aa') as any) || (tier.msaa ? 'taa' : 'fxaa');
  const heroOK = RENDER.aa !== 'fxaa';

  // ---- Loading. Model downloads start first and overlap building the world; preparing shaders is the long
  // tail on many machines, so it gets its own share of the bar.
  const load = new LoadTracker([
    ['files', 'Downloading the kitten and the knight', 30],
    ['world', 'Building the moor', 14],
    ['characters', 'Dressing the characters', 8],
    ['shaders', 'Preparing shaders', 40],
    ['warmup', 'Drawing the first frame', 8],
  ]);
  const hudCb: any = {};
  const hud = new Hud(hudCb);
  load.onChange = (f, t) => hud.setProgress(f, t);
  const statsPanel = new StatsPanel();
  statsPanel.setVisible(readPref('kk-stats', true) && !params.has('still'));
  hud.setChecked('stats', statsPanel.visible);
  const mb = (b: number) => (b / 1048576).toFixed(1);
  downloads.onProgress = () => {
    const f = downloads.expected > 0 ? downloads.loaded / downloads.expected : downloads.filesDone / 17;
    load.progress('files', Math.min(0.99, f), downloads.expected > 0 ? `${mb(downloads.loaded)} of ${mb(downloads.expected)} MB` : '');
  };
  // Hero head (Blender sculpt, baked maps, groomed strand fur) needs MSAA for its alpha-to-coverage strands.
  const heroAssets: Promise<[Awaited<ReturnType<typeof loadKittenAssets>>, Awaited<ReturnType<typeof loadKnightAssets>>]> =
    heroOK ? Promise.all([loadKittenAssets(), loadKnightAssets()]) : Promise.resolve([null, null]);
  // Photo-scanned ground, stone, rock and timber (Poly Haven, CC0) download alongside the characters.
  const surfacesReady = preloadSurfaces(['leafy_grass', 'brown_mud_02', 'castle_wall_varriation', 'castle_wall_slates', 'mossy_rock', 'weathered_planks', 'roof_slates_02'])
    .then(() => true, (e) => { console.warn('Scanned textures unavailable; using procedural materials.', e); return false; });
  Promise.all([heroAssets, surfacesReady]).then(() => load.done('files'));
  await nextPaint();

  const renderer = new THREE.WebGPURenderer({ antialias: RENDER.aa === 'msaa', forceWebGL, trackTimestamp: true });
  const basePixelRatio = Math.min(devicePixelRatio, tier.pixelRatioCap) * tier.renderScale;
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMappingExposure = LOOK.exposure;
  document.getElementById('app')!.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  W.__backend = backend;
  const weather = new Weather(renderer);
  const startWeather = (params.get('weather') as WeatherId) || 'morning';
  const weatherReady = weather.load(startWeather);
  weatherReady.catch(() => { /* reported where it is awaited */ });

  hud.setBackend(backend);
  const gpuTiming = (renderer.backend as any).trackTimestamp === true;
  statsPanel.gpuSupported = gpuTiming;
  const audio = new Soundscape();
  load.progress('world', 0.05);
  await nextPaint();

  // ---- Scene.
  const scene = new THREE.Scene();
  const envOvercast = createEnvironment(renderer, 'overcast');
  const envWarm = createEnvironment(renderer, 'interior');
  scene.environment = envOvercast;
  scene.environmentIntensity = 1.0;
  // Photographed overcast skies light the moor (procedural sky if they cannot be loaded).
  let envField: THREE.Texture = envOvercast;
  let photoSky = false;
  try {
    if (params.get('env') === 'proc') throw new Error('procedural sky requested');
    await weatherReady;
    await weather.init(startWeather, scene);
    envField = scene.environment as THREE.Texture;
    photoSky = true;
  } catch (e) {
    console.warn('Photographed sky unavailable; using the procedural sky.', e);
    scene.environment = envOvercast;
  }
  weather.onEnvironment = (e) => { envField = e; };
  W.__weather = weather;
  scene.add(createSky(photoSky ? weather.skyNode() : undefined));
  setupFog(scene);
  load.progress('world', 0.15);
  await nextPaint();
  const fieldRoot = new THREE.Group(); fieldRoot.name = 'FIELD_01';
  scene.add(fieldRoot);
  const terrain = createTerrain();
  fieldRoot.add(terrain.near, terrain.far, createDistantWater());
  // Baked field maps drive the ground detail and the blade carpet from the same data as the vegetation.
  const fieldMaps = bakeFieldMaps(terrain.near, FIELD.nearHalf, 0.8);
  FIELD_MATERIALS.photo = await surfacesReady;
  terrain.near.material = FIELD_MATERIALS.photo ? photoTerrainMaterial(fieldMaps) : terrainMaterial(fieldMaps);
  load.progress('world', 0.45);
  await nextPaint();
  const grass = createGrass(fieldMaps, tier.grassDensity);
  fieldRoot.add(grass.group);
  const physics = new PhysicsWorld();
  const structures = createStructures(physics);
  fieldRoot.add(structures.root);
  const causeway = createCauseway(physics);
  fieldRoot.add(causeway.root);
  causeway.setWater(MARSH.floorY + MARSH.flood);
  load.progress('world', 0.7);
  await nextPaint();
  let veg = createVegetation(tier.grassDensity, tier.grassRadius);
  fieldRoot.add(veg.group);
  const mist = createMistCards(tier.mistCards);
  // Drizzle and spindrift racing downwind past the camera.
  const spray = createSpray(tierName === 'low' ? 700 : tierName === 'medium' ? 1500 : 2400);
  fieldRoot.add(spray.mesh);
  fieldRoot.add(mist.group);
  const { sun, hemi } = createLights(scene, tier.shadowMap);
  load.done('world');
  await nextPaint();

  // ---- Characters.
  const [kittenAssets, knightAssets] = await heroAssets;
  load.progress('characters', 0.1);
  await nextPaint();
  const kitten = new Kitten(tier.furShells, kittenAssets);
  load.progress('characters', 0.6);
  await nextPaint();
  const knight = new Knight(knightAssets);
  scene.add(kitten.group, knight.group);
  // The knight dissolves (screen-door coverage that TAA smooths) while he stands between the camera and the kitten
  // or right against the lens; his shadow stays. His materials are cloned so the kitten's shared ones are untouched.
  const knightVis = uniform(1);
  {
    const keep = knightVis.greaterThan(temporalAlphaThreshold), solid = bool(true);
    const done = new Map<THREE.Material, THREE.Material>();
    knight.group.traverse((o: any) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      let m = done.get(o.material);
      if (!m) { m = o.material.clone() as THREE.Material; (m as any).maskNode = keep; (m as any).maskShadowNode = solid; done.set(o.material, m); }
      o.material = m;
    });
  }
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
  rig.handheldAmount = readPref('kk-handheld', true) ? 1 : 0;
  hud.setChecked('handheld', rig.handheldAmount > 0);
  const camera = rig.cam;
  const input = new KeyboardMouseGamepad(renderer.domElement);
  input.onTouchMode = () => hud.setTouch();
  if (matchMedia('(pointer: coarse)').matches) input.enterTouchMode();
  let story: Story | null = null;
  const tips = new Set<string>();
  const say = (t: string, d?: number) => (story ? story.feedback(t, d) : hud.say(t, d));
  const puzzles = new Puzzles(structures, physics, kitten, knight, (t) => say(t), (n, p, g) => audio.play(n, p, g), causeway);
  (puzzles as any).onPlacedOnSill = () => { companions.get(kitten)!.mode = 'wait'; say('The kitten is on the ledge.'); };
  const placePair = (k: THREE.Vector3, n: THREE.Vector3, yaw: number) => {
    for (const [c, p] of [[kitten, k], [knight, n]] as const) {
      c.body.pos.copy(p); c.body.prevPos.copy(p); c.body.yaw = c.body.prevYaw = yaw; c.body.vel.set(0, 0, 0); c.body.vy = 0; c.body.climb = null;
      c.carriedBy = null; c.holding = null;
      c.resetPose(ground);
    }
    kitten.resetCloth();
    for (const cc of companions.values()) cc.mode = 'follow';
  };
  story = new Story(hud, rig, puzzles, photoSky ? weather : null, scene, causeway, placePair);

  // Prime poses and cloth before the first frame.
  const ctx0: PoseContext = { dt: 1 / 60, time: 0, ground, lookAt: null, active: true };
  for (let i = 0; i < 3; i++) { kitten.updateVisual(1, ctx0); knight.updateVisual(1, ctx0); }
  kitten.resetCloth();

  // ---- Final image.
  const ssrOn = params.has('ssr') ? params.get('ssr') !== '0' : tier.ssr;
  const { pipeline, scenePass } = createPipeline(renderer, scene, camera, { dof: tier.dof, aoView: params.has('aoview'), ssr: ssrOn });
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
  let adaptive = params.has('drs') ? params.get('drs') !== '0' : readPref('kk-drs', true);
  hud.setChecked('drs', adaptive);
  const AO_ON = 1.0;
  let aoOn = params.has('ao') ? params.get('ao') !== '0' : readPref('kk-ao', tier.ao);
  LOOK.aoAmount.value = aoOn ? AO_ON : 0;
  hud.setChecked('ao', aoOn);
  const setLook = (look: string) => { LOOK.modern.value = look === 'modern' ? 1 : 0; };
  let look = params.get('look') ?? readPrefString('kk-look', 'modern');
  setLook(look);
  hud.setValue('look', look);
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
    onStats: (on: boolean) => { statsPanel.setVisible(on); writePref('kk-stats', on); },
    onAdaptive: (on: boolean) => { adaptive = on; writePref('kk-drs', on); if (!on) setRenderScale(1); },
    onAO: (on: boolean) => { aoOn = on; LOOK.aoAmount.value = on ? AO_ON : 0; writePref('kk-ao', on); },
    onLook: (v: string) => { look = v; setLook(v); writePrefString('kk-look', v); },
    onHandheld: (on: boolean) => { rig.handheldAmount = on ? 1 : 0; writePref('kk-handheld', on); },
    onLabToggle: (k: string, on: boolean) => {
      if (k === 'normals') CHAR_TOGGLES.detailNormals.value = on ? 1 : 0;
      if (k === 'rough') CHAR_TOGGLES.roughnessMaps.value = on ? 1 : 0;
      if (k === 'env') scene.environmentIntensity = on ? 1 : 0;
      if (k === 'direct') { sun.visible = on; hemi.visible = on; }
      if (k === 'shadows') renderer.shadowMap.enabled = on;
      if (k === 'fuzz') CHAR_TOGGLES.fuzz.value = on ? 1 : 0;
      if (k === 'env2') scene.environment = on ? envWarm : envField;
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
      c.body.climb = null;
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
    story: () => story,
    chapter: (i: number) => story!.jump(i),
    causeway,
    switchChar: () => switchChar(),
    wait: () => toggleWait(),
    camYaw: (y: number, p = 0.2) => { rig.yaw = y; rig.pitch = p; },
    step: (n: number, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt, false); },
    render: () => frame(1 / 60, true),
    grassDebug: (v: number) => { GRASS_DEBUG.value = v; },
    // Performance probes: hide one part of the scene to measure what it costs.
    perf: (k: string, on: boolean) => {
      const set = (o: THREE.Object3D | null | undefined) => { if (o) o.visible = on; };
      if (k === 'grass') set(grass.group);
      else if (k === 'veg') set(veg.group);
      else if (k === 'mist') set(mist.group);
      else if (k === 'structures') set(structures.root);
      else if (k === 'terrain') set(terrain.near);
      else if (k === 'far') set(terrain.far);
      else if (k === 'shadows') renderer.shadowMap.enabled = on;
      else if (k === 'ao') LOOK.aoAmount.value = on && aoOn ? AO_ON : 0;
      else if (k === 'kitten') set(kitten.group);
      else if (k === 'knight') set(knight.group);
      else if (k === 'fur') kitten.group.traverse((o) => { if (/fur|whisk/i.test(o.name)) o.visible = on; });
    },
    info: () => JSON.parse(JSON.stringify(renderer.info.render)),
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
    const pc = playing && !puzzles.busy.has(active) && !active.carriedBy && !rig.moment;
    if (active.body.climb) {
      // On a face: the stick climbs, a jump pushes off (game/climb.ts).
      climbStep(active, physics, pc ? inp.move : new THREE.Vector2(), pc && inp.jumpPressed, rig.yaw, H);
    } else {
      player.update(active, inp, rig.yaw, H, pc);
      // Running or jumping into ivy, the kitten takes hold.
      if (pc && active.kind === 'kitten' && inp.move.lengthSq() > 0.09) {
        const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
        const dx = fx * inp.move.y - fz * inp.move.x, dz = fz * inp.move.y + fx * inp.move.x;
        const l = Math.hypot(dx, dz) || 1;
        tryGrab(active, physics, dx / l, dz / l);
      }
    }
    const cc = companions.get(companion)!;
    if (!puzzles.busy.has(companion)) cc.update(companion, active, physics, puzzles.nav, H, clockT, (p) => rig.isVisible(p), rig.cam.position);
    for (const c of [kitten, knight]) {
      if (c.carriedBy) {
        c.body.prevPos.copy(c.body.pos);
        knight.holdPoint(c.body.pos);
        c.body.prevYaw = c.body.yaw; c.body.yaw = knight.body.yaw; c.body.vel.set(0, 0, 0);
        continue;
      }
      if (puzzles.busy.has(c)) { c.body.prevPos.copy(c.body.pos); c.body.prevYaw = c.body.yaw; c.body.vel.set(0, 0, 0); continue; }
      // Climbing moves only through climbStep; left on a face by a switch, she holds on where she is.
      if (c.body.climb) { if (c !== active) { c.body.prevPos.copy(c.body.pos); c.body.prevYaw = c.body.yaw; } continue; }
      const other = c === kitten ? knight : kitten;
      const obstacles = other.carriedBy || c.holding === other ? [] : [{ x: other.body.pos.x, z: other.body.pos.z, r: other.body.radius * 0.8 }];
      physics.move(c.body, c.kind, H, obstacles);
    }
  }

  function frame(dt: number, render = true) {
    clockT += dt;
    WIND.time.value = clockT;
    WIND.gust = THREE.MathUtils.smoothstep(gustNoise.noise(clockT * 0.19, 0.5) * 0.5 + 0.55 + 0.18 * Math.sin(clockT * 1.1), 0.2, 0.8);
    LOOK.frame.value = (LOOK.frame.value + 1) % 4096;
    let inp = input.poll(dt);
    if (sim.until > clockT) { inp = { ...inp, move: sim.move.clone(), walk: sim.walk }; }
    if (!started && inp.any && !hud.begun) { /* wait for a click on the title */ }
    // Global keys.
    const keys = input.keys;
    void keys;
    if (mode === 'field' && rig.mode === 'reveal') {
      if (!started) rig.updateReveal(0, kitten, knight); // hold the opening shot behind the title
      if (started && rig.updateReveal(dt, kitten, knight)) { rig.endReveal(active); story!.begin(input.touchMode ? 'The Switch button changes between the kitten and the knight.' : 'Tab switches between the kitten and the knight. G gives a hint.'); }
      if (started && inp.skipPressed && rig.revealT > 0.4) rig.revealT = rig.revealDur;
      inp = { ...inp, move: new THREE.Vector2() };
    }
    const playing = mode === 'field' && rig.mode !== 'reveal';
    if (playing) {
      if (inp.switchPressed) switchChar();
      if (inp.waitPressed) toggleWait();
      if (inp.interactPressed) puzzles.interact(active);
      if (inp.hintPressed) story!.hint();
      if (inp.resetPressed) {
        if (story!.started) story!.checkpoint(); else { placeAtSpawn(); kitten.resetCloth(); }
        hud.say('The pair returns to where this part began.', 2.5);
      }
    }
    acc += Math.min(dt, 0.1);
    while (acc >= H) { physicsStep(inp, playing); acc -= H; }
    const alpha = acc / H;
    if (mode === 'field') { puzzles.update(dt, active); story!.update(dt, playing && !rig.moment); }
    // First time near climbable ivy as the kitten, and first time on it: how climbing works.
    if (playing && active === kitten && story!.started) {
      if (kitten.body.climb) {
        if (!tips.has('climbing')) { tips.add('climbing'); story!.feedback(input.touchMode ? 'The stick climbs. Jump lets go.' : 'W and S climb, A and D move along. Space lets go.', 5); }
      } else if (!tips.has('ivy')) {
        const p = kitten.body.pos;
        for (const c of physics.climbables) {
          const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
          const u = ((p.x - c.ax) * (c.bx - c.ax) + (p.z - c.az) * (c.bz - c.az)) / len;
          const d = (p.x - c.ax) * c.nx + (p.z - c.az) * c.nz;
          if (u > -0.2 && u < len + 0.2 && d > 0 && d < 1.1 && Math.abs(p.y - c.y0) < 0.6) { tips.add('ivy'); story!.feedback('Ivy. The kitten can climb it: run into the wall.', 5); break; }
        }
      }
    }
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
      if (!rig.updateMoment(dt)) rig.update(dt, active, companion, inp.look, inp.zoom, physics, moving);
    }
    // The knight between the lens and the kitten (or crowding the lens) dissolves until he is clear.
    {
      let want = 1;
      const cp = camera.position, np = knight.body.pos;
      if (active === kitten && mode === 'field') {
        const kp = kitten.group.position;
        const sx = kp.x - cp.x, sz = kp.z - cp.z, sl2 = sx * sx + sz * sz || 1;
        const t = ((np.x - cp.x) * sx + (np.z - cp.z) * sz) / sl2;
        if (t > 0 && t < 1.05) {
          const d = Math.hypot(np.x - (cp.x + sx * t), np.z - (cp.z + sz * t));
          const ly = cp.y + (kp.y + 0.15 - cp.y) * t;
          if (d < 0.75 && ly > np.y - 0.1 && ly < np.y + 1.95) want = 0.08;
        }
      }
      if (cp.distanceTo(new THREE.Vector3(np.x, np.y + 1.0, np.z)) < 1.2) want = Math.min(want, 0.15);
      knightVis.value += (want - knightVis.value) * Math.min(1, dt * 7);
    }
    // Shadow frustum follows the camera's subject, snapped to texels to avoid shimmer.
    const focus = mode === 'lab' ? new THREE.Vector3(0, 0, 0) : active.group.position;
    const sd = sun.shadow.camera.right * 2 / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / sd) * sd, fz = Math.round(focus.z / sd) * sd;
    // The hidden sun follows the weather's photographed sky: direction, colour and strength.
    weather.update(dt, scene);
    if (photoSky) {
      const sd = weather.sunDir;
      sun.position.set(fx + sd.x * 40, focus.y + sd.y * 40, fz + sd.z * 40);
      sun.color.copy(weather.sunColor);
      sun.intensity = weather.sunIntensity;
      hemi.intensity = 0;
    } else sun.position.set(fx - 18, focus.y + 26, fz - 24);
    sun.target.position.set(fx, focus.y, fz);
    sun.target.updateMatrixWorld();
    if (mode === 'field') {
      veg.update(camera);
      grass.update(camera);
      mist.update(clockT, camera, heightAt, active.group.position);
      // Under a roof or between walls (the hut, chapel, tower, the gate passage), the mist cards ease out.
      const ap = active.body.pos, rg = regionOf(ap);
      const enclosed = rg === 'hut' || rg === 'chapel' || rg === 'towerDown' || rg === 'towerUp' || rg === 'pocket'
        || (Math.abs(ap.x - GATEHOUSE.x) < 2.2 && ap.z < GATEHOUSE.z + 3 && ap.z > GATEHOUSE.innerZ - 0.5);
      MIST_CARDS.amount.value += ((enclosed ? 0 : 1) - MIST_CARDS.amount.value) * Math.min(1, dt * 1.5);
      spray.update(WIND.gust);
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
    // Occlusion reach follows the scale on screen: centimetres for a kitten close-up, half a metre at knight scale.
    const nearChar = Math.min(camera.position.distanceTo(kitten.group.position), camera.position.distanceTo(knight.group.position));
    LOOK.aoRadius.value = THREE.MathUtils.clamp(nearChar * 0.11, 0.1, 0.45);
    if (render) pipeline.render();
  }

  // Keys handled outside the per-frame input (UI toggles).
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') hud.togglePanel();
    if (e.code === 'KeyP') { hudCb.onStats(!statsPanel.visible); hud.setChecked('stats', statsPanel.visible); }
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

  if (params.has('still')) hud.title.style.display = 'none';
  resize();
  load.done('characters');
  await nextPaint();

  // ---- Shaders. Compile every material for the scene pass before the first frame (off-screen objects too),
  // so the game does not stall the first time each one comes into view.
  {
    const rt = scenePass.renderTarget;
    rt.samples = renderer.samples;
    rt.texture.type = (renderer as any).getOutputBufferType?.() ?? THREE.HalfFloatType;
    const unculled: THREE.Object3D[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    // Plant and mist meshes stay hidden until something is in view; show them while compiling.
    const unhidden: THREE.Object3D[] = [];
    for (const g of [veg.group, mist.group]) g.traverse((o) => { if (!o.visible) { o.visible = true; unhidden.push(o); } });
    const prev = renderer.getRenderTarget();
    const prevMRT = renderer.getMRT();
    renderer.setRenderTarget(rt);
    // Compile with the pass's outputs (colour plus velocity under TAA), as PassNode.compileAsync does.
    renderer.setMRT((scenePass as any).getMRT());
    try {
      await renderer.compileAsync(scene, camera, null, (e: ProgressEvent) => load.progress('shaders', e.loaded / Math.max(1, e.total), `${e.loaded} of ${e.total}`));
    } catch (e) {
      console.warn('Shader precompile failed; shaders will compile on first use.', e);
    } finally {
      renderer.setRenderTarget(prev);
      renderer.setMRT(prevMRT);
      for (const o of unculled) o.frustumCulled = true;
      for (const o of unhidden) o.visible = false;
    }
  }
  load.done('shaders');
  await nextPaint();
  // ---- First frames through the whole chain: shadow and post-processing passes compile here.
  const gpuIdle = () => (renderer as any).backend?.device?.queue?.onSubmittedWorkDone?.() ?? Promise.resolve();
  frame(1 / 60, true);
  load.progress('warmup', 0.5);
  await gpuIdle();
  await nextPaint();
  frame(1 / 60, true);
  await gpuIdle();
  load.done('warmup');
  const report = load.report();
  statsPanel.setLoad(report);
  console.info(`Whisker loaded in ${(report.totalMs / 1000).toFixed(1)} s: ` + report.stages.map((x) => `${x.label} ${(x.ms / 1000).toFixed(2)} s`).join(', '));
  W.__load = report;
  hud.setReady();
  if (params.has('noreveal')) { hud.begin(); started = true; rig.revealT = rig.revealDur; }
  W.__ready = true;

  // ---- Adaptive resolution: keeps frames near 60 fps by scaling the render resolution between 55% and 100% of
  // the tier's pixel ratio. Judged on GPU time where the browser reports it, otherwise on frame time.
  let renderScale = 1;
  function setRenderScale(s: number) {
    s = THREE.MathUtils.clamp(s, 0.55, 1);
    if (Math.abs(s - renderScale) < 0.01) return;
    renderScale = s;
    renderer.setPixelRatio(basePixelRatio * s);
    resize();
  }
  const drs = { ema: 16.7, hold: 2, ceiling: 1, ceilingT: 0 };
  function adaptResolution(dtMs: number, dt: number) {
    if (!adaptive || params.has('still')) return;
    const gpu = statsPanel.gpuMs;
    if (dtMs > 250) return; // a hitch or a hidden tab says nothing about steady load
    const m = gpu !== null && gpu > 0 ? gpu : dtMs;
    drs.ema += (Math.min(m, 100) - drs.ema) * 0.08;
    drs.hold -= dt;
    drs.ceilingT -= dt;
    if (drs.ceilingT <= 0) drs.ceiling = 1;
    if (drs.hold > 0) return;
    if (drs.ema > 18.5) {
      // Too slow: scale the pixel count toward a 16 ms frame, at most 20% per step.
      const before = renderScale;
      setRenderScale(renderScale * THREE.MathUtils.clamp(Math.sqrt(16 / drs.ema), 0.8, 0.96));
      drs.ceiling = before; drs.ceilingT = 20;
      drs.hold = 0.75;
    } else if (renderScale < drs.ceiling - 0.01 && drs.ema < (gpu !== null ? 12 : 17.4)) {
      // Headroom: creep back up, never past a scale that was too slow in the last 20 s.
      setRenderScale(Math.min(drs.ceiling, renderScale * 1.05));
      drs.hold = gpu !== null ? 1 : 3;
    }
  }

  W.__perf = { panel: statsPanel, scale: () => renderScale, stats };
  const still = params.has('still');
  let stillFrames = 0;
  let frameNo = 0;
  last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtMs = now - last;
    const dt = Math.min(0.1, dtMs / 1000);
    last = now;
    if (still) {
      // Manual capture mode: the test harness steps the simulation and renders on demand.
      if (stillFrames++ === 0) { frame(1 / 60, true); W.__done = true; }
      return;
    }
    frame(dt);
    const cpu = performance.now() - now;
    stats.frames++; stats.ms += dt * 1000;
    if (stats.frames % 60 === 0) { stats.fps = Math.round(60000 / stats.ms); stats.ms = 0; }
    // GPU time of the last finished frame, read back every few frames.
    if (gpuTiming && ++frameNo % 6 === 0) {
      renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((v) => { if (typeof v === 'number' && v > 0) statsPanel.gpuMs = v; }).catch(() => {});
    }
    statsPanel.push(dtMs, cpu);
    adaptResolution(dtMs, dt);
    const pr = renderer.getPixelRatio();
    statsPanel.update(dt, {
      width: Math.round(innerWidth * pr), height: Math.round(innerHeight * pr), scale: renderScale, adaptive,
      backend, tier: tierName, calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles,
    });
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
