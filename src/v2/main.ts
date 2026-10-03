// Engine v2 (?v2): Rapier collision, the shared platformer motor, abilities, the follow camera and a test course on
// the moor. The look (sky, fog, grass, light, post-processing) and the two characters' visuals are shared with v1.
import * as THREE from 'three/webgpu';
import { uniform, bool } from 'three/tsl';
import { createSky, createEnvironment, createLights, setupFog, createMistCards } from '../world/atmosphere';
import { createTerrain, createDistantWater, terrainMaterial, photoTerrainMaterial } from '../world/terrain';
import { preloadSurfaces } from '../world/surfaces';
import { bakeFieldMaps } from '../world/ground';
import { createGrass, GRASS_PUSHERS } from '../world/grass';
import { createVegetation } from '../world/vegetation';
import { Weather, WeatherId } from '../world/weather';
import { createSpray } from '../world/spray';
import { FIELD, heightAt, wetness } from '../world/layout';
import { Simplex2 } from '../world/noise';
import { createPipeline } from '../render/pipeline';
import { LOOK, WIND, TIERS, QualityTier, RENDER } from '../render/settings';
import { writeOccluders, OccSpec } from '../render/occlusion';
import { temporalAlphaThreshold } from '../render/temporal';
import { Kitten } from '../chars/kitten';
import { Knight } from '../chars/knight';
import { loadKittenAssets, loadKnightAssets } from '../chars/assets';
import { PoseContext } from '../chars/character';
import { downloads } from '../chars/binfile';
import { KeyboardMouseGamepad, InputFrame } from '../game/input';
import { Soundscape } from '../audio/audio';
import { Hud } from '../ui/hud';
import { LoadTracker, nextPaint } from '../ui/loading';
import { StatsPanel } from '../ui/stats';
import { Physics } from './physics';
import { LevelBuilder } from './level';
import { prepareField, buildPlayground } from './levels/playground';
import { Game, Avatar } from './game';
import { SkinnedAvatar } from './avatar';
import { Timeline } from './timeline';

const W = window as any;
const HZ = 60, H = 1 / HZ;

export async function run(params: URLSearchParams) {
  const phone = matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
  const tierName = (params.get('q') as QualityTier) || (phone ? 'low' : matchMedia('(max-width: 800px), (pointer: coarse)').matches ? 'medium' : 'high');
  const tier = TIERS[tierName] ?? TIERS.high;
  RENDER.aa = (params.get('aa') as any) || (tier.msaa ? 'taa' : 'fxaa');
  const heroOK = RENDER.aa !== 'fxaa';

  const load = new LoadTracker([
    ['files', 'Downloading the kitten and the knight', 30],
    ['world', 'Building the course', 16],
    ['characters', 'Dressing the characters', 8],
    ['shaders', 'Preparing shaders', 38],
    ['warmup', 'Drawing the first frame', 8],
  ]);
  const hudCb: any = {};
  const hud = new Hud(hudCb);
  load.onChange = (f, t) => hud.setProgress(f, t);
  const statsPanel = new StatsPanel();
  statsPanel.setVisible(!params.has('still') && params.get('stats') !== '0');
  const mb = (b: number) => (b / 1048576).toFixed(1);
  downloads.onProgress = () => {
    const f = downloads.expected > 0 ? downloads.loaded / downloads.expected : downloads.filesDone / 17;
    load.progress('files', Math.min(0.99, f), downloads.expected > 0 ? `${mb(downloads.loaded)} of ${mb(downloads.expected)} MB` : '');
  };
  const heroAssets = heroOK ? Promise.all([loadKittenAssets(), loadKnightAssets()]) : Promise.resolve([null, null] as const);
  const surfacesReady = preloadSurfaces(['leafy_grass', 'brown_mud_02']).then(() => true, () => false);
  Promise.all([heroAssets, surfacesReady]).then(() => load.done('files'));
  await nextPaint();

  // ---- Renderer and sky.
  const renderer = new THREE.WebGPURenderer({ antialias: RENDER.aa === 'msaa', forceWebGL: params.has('webgl'), trackTimestamp: true });
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
  hud.setBackend(backend);
  statsPanel.gpuSupported = (renderer.backend as any).trackTimestamp === true;
  const weather = new Weather(renderer);
  const startWeather = (params.get('weather') as WeatherId) || 'morning';
  const weatherReady = weather.load(startWeather);
  weatherReady.catch(() => {});
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer, 'overcast');
  let photoSky = false;
  try { await weatherReady; await weather.init(startWeather, scene); photoSky = true; } catch (e) { console.warn('Photographed sky unavailable.', e); }
  scene.add(createSky(photoSky ? weather.skyNode() : undefined));
  setupFog(scene);
  load.progress('world', 0.1);
  await nextPaint();

  // ---- Physics, the moor and the course.
  const physics = await Physics.create(H);
  prepareField();
  const terrain = createTerrain();
  scene.add(terrain.near, terrain.far, createDistantWater());
  const fieldMaps = bakeFieldMaps(terrain.near, FIELD.nearHalf, 0.8);
  terrain.near.material = (await surfacesReady) ? photoTerrainMaterial(fieldMaps) : terrainMaterial(fieldMaps);
  physics.addMesh(terrain.near, { kind: 'grass' });
  load.progress('world', 0.45);
  await nextPaint();
  const lv = new LevelBuilder(physics);
  const level = buildPlayground(physics, lv);
  scene.add(lv.root);
  const grass = createGrass(fieldMaps, tier.grassDensity);
  scene.add(grass.group);
  const veg = createVegetation(tier.grassDensity, tier.grassRadius);
  scene.add(veg.group);
  const mist = createMistCards(tier.mistCards);
  scene.add(mist.group);
  const spray = createSpray(tierName === 'low' ? 700 : tierName === 'medium' ? 1500 : 2400);
  scene.add(spray.mesh);
  const { sun, hemi } = createLights(scene, tier.shadowMap);
  load.done('world');
  await nextPaint();

  // ---- Characters.
  const [kittenAssets, knightAssets] = await heroAssets;
  const kitten = new Kitten(tier.furShells, kittenAssets as any);
  load.progress('characters', 0.6);
  await nextPaint();
  // ?ual: the knight as a skinned character on the shared animation library (the new pipeline, under test).
  let skinned: SkinnedAvatar | null = null;
  if (params.has('ual')) {
    skinned = new SkinnedAvatar({ kind: 'knight', url: params.get('ual') === 'm' ? 'chars/mannequin.glb' : 'chars/knight.glb', radius: 0.3, height: 1.8, scale: 1.8 / 1.88 });
    await skinned.load();
  }
  const knight: Avatar = skinned ?? new Knight(knightAssets as any);
  scene.add(kitten.group, knight.group);
  // The knight dissolves while he stands between the camera and the kitten (his shadow stays).
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
  const game = new Game(physics, kitten, knight, level, innerWidth / innerHeight);
  const camera = game.camera.cam;
  const input = new KeyboardMouseGamepad(renderer.domElement);
  input.onTouchMode = () => hud.setTouch();
  if (matchMedia('(pointer: coarse)').matches) input.enterTouchMode();
  const audio = new Soundscape();
  game.onSwitch = (to) => audio.play('clank', to.char.body.pos, 0.15);
  // A fall fades out, the character returns to firm ground, and it fades back in.
  const fade = document.createElement('div');
  fade.style.cssText = 'position:fixed;inset:0;background:#101212;opacity:0;pointer-events:none;transition:opacity .28s;z-index:4';
  document.body.appendChild(fade);
  game.onFall = (_a, phase) => { fade.style.opacity = phase === 'out' ? '1' : '0'; };
  // Cutscenes: letterbox bars and a fade the timeline drives directly.
  const bars = [0, 1].map((i) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:0;right:0;${i ? 'bottom' : 'top'}:0;height:11vh;background:#0b0c0c;transform:translateY(${i ? '' : '-'}100%);transition:transform .9s ease;pointer-events:none;z-index:3`;
    document.body.appendChild(d);
    return d;
  });
  const cutFade = document.createElement('div');
  cutFade.style.cssText = 'position:fixed;inset:0;background:#0b0c0c;opacity:0;pointer-events:none;z-index:4';
  document.body.appendChild(cutFade);
  const timeline = new Timeline(game, {
    fade: (o) => { cutFade.style.opacity = String(o); },
    letterbox: (on) => { bars.forEach((b, i) => { b.style.transform = on ? 'translateY(0)' : `translateY(${i ? '' : '-'}100%)`; }); },
  });

  // Prime poses and cloth.
  const ctx0 = (a: typeof game.kitten | typeof game.knight): PoseContext => ({ dt: H, time: 0, ground: a.ground, lookAt: null, active: true });
  for (let i = 0; i < 3; i++) { kitten.updateVisual(1, ctx0(game.kitten)); knight.updateVisual(1, ctx0(game.knight)); }
  kitten.resetCloth();

  // ---- Final image.
  const { pipeline, scenePass } = createPipeline(renderer, scene, camera, { dof: tier.dof, ssr: false });
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    LOOK.resolution.value.set(innerWidth * pr, innerHeight * pr);
  };
  addEventListener('resize', resize);
  const KP = kitten.parts, NP = (knight as any).parts;
  const kittenOcc: OccSpec = [
    [KP.pelvis, 0, -0.005, -0.004, 0.042], [KP.chest, 0, 0.045, 0, 0.048], [KP.head, 0, 0, 0, 0.05],
    [KP.thighL, 0, -0.025, 0, 0.02], [KP.thighR, 0, -0.025, 0, 0.02], [KP.shinL, 0, -0.03, 0, 0.014], [KP.shinR, 0, -0.03, 0, 0.014],
    [KP.footL, 0, -0.006, 0.008, 0.014], [KP.footR, 0, -0.006, 0.008, 0.014],
  ];
  const knightOcc: OccSpec = skinned ? skinned.occluders() : [
    [NP.pelvis, 0, 0, 0, 0.16], [NP.chest, 0, 0.2, 0, 0.19], [NP.head, 0, 0.1, 0, 0.13],
    [NP.thighL, 0, -0.22, 0, 0.09], [NP.thighR, 0, -0.22, 0, 0.09], [NP.shinL, 0, -0.25, 0, 0.07], [NP.shinR, 0, -0.25, 0, 0.07],
    [NP.footL, 0, -0.035, 0.06, 0.06], [NP.footR, 0, -0.035, 0.06, 0.06],
  ];

  let started = params.has('noreveal') || params.has('still');
  Object.assign(hudCb, {
    onBegin: () => {
      audio.start(); started = true;
      const tip = () => hud.say(input.touchMode ? 'Switch changes between the kitten and the knight.' : 'Tab switches between the kitten and the knight. Hold Space to jump higher.', 6);
      if (level.intro && !params.has('nointro')) { timeline.play({ ...level.intro, onEnd: tip }); cutFade.style.opacity = '1'; } else tip();
    },
    onSkipReveal: () => {}, onTreatment: (v: number) => { LOOK.treatment.value = v; }, onClean: (on: boolean) => { LOOK.treatment.value = on ? 0 : 0.6; LOOK.grade.value = on ? 0 : 1; },
    onQuality: (q: string) => { const u = new URL(location.href); u.searchParams.set('q', q); location.href = u.toString(); },
    onVolume: (v: number) => audio.setVolume(v), onMute: (m: boolean) => audio.setMuted(m), onPreset: () => {}, onAspect43: () => {}, onMode: () => {},
    onStats: (on: boolean) => statsPanel.setVisible(on), onAdaptive: () => {}, onAO: (on: boolean) => { LOOK.aoAmount.value = on ? 1 : 0; },
    onLook: (v: string) => { LOOK.modern.value = v === 'modern' ? 1 : 0; }, onHandheld: (on: boolean) => { game.camera.handheld = on ? 1 : 0; },
    onLabToggle: () => {},
  });
  LOOK.modern.value = 1;
  LOOK.aoAmount.value = tier.ao ? 1 : 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') hud.togglePanel();
    if (e.code === 'KeyP') statsPanel.setVisible(!statsPanel.visible);
    if (!hud.begun && (e.code === 'Space' || e.code === 'Enter')) hud.begin();
  });

  // ---- Loop: fixed 60 Hz physics, interpolated visuals.
  let acc = 0, clockT = 0;
  const gustNoise = new Simplex2(5);
  const sim = { move: new THREE.Vector2(), until: 0, jumpHeld: false };
  const frame = (dt: number, render = true) => {
    clockT += dt;
    WIND.time.value = clockT;
    WIND.gust = THREE.MathUtils.smoothstep(gustNoise.noise(clockT * 0.19, 0.5) * 0.5 + 0.55 + 0.18 * Math.sin(clockT * 1.1), 0.2, 0.8);
    LOOK.frame.value = (LOOK.frame.value + 1) % 4096;
    let inp: InputFrame = input.poll(dt);
    if (sim.until > clockT) inp = { ...inp, move: sim.move.clone(), jumpHeld: inp.jumpHeld || sim.jumpHeld };
    if (!started) inp = { ...inp, move: new THREE.Vector2(), jumpPressed: false, switchPressed: false, interactPressed: false };
    if (inp.resetPressed) game.placeAt(level.spawn);
    game.handleInput(inp);
    acc += Math.min(dt, 0.1);
    while (acc >= H) { game.fixedStep(H, inp); acc -= H; }
    const alpha = acc / H;
    physics.sync(alpha);
    // Visuals.
    const kHead = kitten.parts.head.getWorldPosition(new THREE.Vector3());
    const nHead = (skinned ? skinned.headPos(new THREE.Vector3()) : (knight as any).parts.head.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.12, 0));
    kitten.updateVisual(alpha, { dt, time: clockT, ground: game.kitten.ground, lookAt: nHead, active: game.active === game.kitten });
    knight.updateVisual(alpha, { dt, time: clockT, ground: game.knight.ground, lookAt: kHead, active: game.active === game.knight });
    kitten.update(dt, { dt, time: clockT, ground: game.kitten.ground, lookAt: null, active: true });
    knight.update(dt, { dt, time: clockT, ground: game.knight.ground, lookAt: null, active: true });
    knight.group.updateMatrixWorld(true);
    writeOccluders(0, kittenOcc); writeOccluders(kittenOcc.length, knightOcc);
    const gp = GRASS_PUSHERS.array as THREE.Vector4[];
    gp[0].set(kitten.body.pos.x, kitten.body.pos.z, 0.2, kitten.carriedBy ? 0 : 1);
    gp[1].set(knight.body.pos.x, knight.body.pos.z, 0.42, 1);
    for (const c of [kitten, knight] as any[]) {
      if (c.gait) {
        for (const e of c.gait.stepEvents) { const f = c.gait.feet[e.side > 0 ? 1 : 0].cur; audio.footstep(c.kind, f, e.strength, wetness(f.x, f.z)); }
        c.gait.stepEvents.length = 0;
      } else {
        for (const e of c.stepEvents) audio.footstep(c.kind, c.body.pos, e.strength, wetness(c.body.pos.x, c.body.pos.z));
        c.stepEvents.length = 0;
      }
    }
    // Camera: a cutscene's shots, or the follow camera.
    if (timeline.playing) { if (inp.skipPressed && timeline.t > 0.5) timeline.skip(); else timeline.update(dt, camera); }
    else game.camera.update(dt, game.subject(), started ? inp.look : new THREE.Vector2(), inp.zoom, physics);
    // The knight between the lens and the kitten (or against the lens) dissolves until he is clear.
    {
      let want = 1;
      const cp = camera.position, np = knight.body.pos;
      if (game.active === game.kitten) {
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
    // Sun and shadows follow the played character.
    const focus = game.active.char.group.position;
    const sd = sun.shadow.camera.right * 2 / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / sd) * sd, fz = Math.round(focus.z / sd) * sd;
    weather.update(dt, scene);
    if (photoSky) {
      const d = weather.sunDir;
      sun.position.set(fx + d.x * 40, focus.y + d.y * 40, fz + d.z * 40);
      sun.color.copy(weather.sunColor); sun.intensity = weather.sunIntensity; hemi.intensity = 0;
    } else sun.position.set(fx - 18, focus.y + 26, fz - 24);
    sun.target.position.set(fx, focus.y, fz);
    sun.target.updateMatrixWorld();
    veg.update(camera);
    grass.update(camera);
    mist.update(clockT, camera, heightAt, focus);
    spray.update(WIND.gust);
    audio.listener.copy(camera.position);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    audio.listenerYaw = Math.atan2(-fwd.x, -fwd.z) + Math.PI;
    audio.update(dt);
    // HUD.
    const a = game.active;
    hud.setWho(a === game.kitten ? 'Kitten' : 'Knight', a === game.kitten ? (kitten.body.climb ? 'Climbing' : '') : game.carry.holding ? 'Carrying the kitten' : '');
    const pr = started ? game.prompt() : null;
    hud.setPrompt(pr ? pr.text : null, pr ? (pr.key === 'jump' ? (input.touchMode ? 'Jump' : 'Space') : (input.touchMode ? 'Act' : 'E')) : undefined);
    hud.update(dt);
    LOOK.aoRadius.value = THREE.MathUtils.clamp(camera.position.distanceTo(a.char.group.position) * 0.11, 0.1, 0.45);
    if (render) pipeline.render();
  };

  // ---- Debug and capture hooks.
  W.__v2 = {
    game, physics, kitten, knight, scene, renderer, LOOK, timeline, pipeline, level: lv, grass, veg, mist,
    play: () => level.intro && timeline.play(level.intro),
    skipCut: () => timeline.skip(),
    setActive: (k: 'kitten' | 'knight') => game.switchTo(k === 'kitten' ? game.kitten : game.knight),
    teleport: (k: 'kitten' | 'knight', x: number, y: number, z: number, yaw = 0) => {
      const a = k === 'kitten' ? game.kitten : game.knight;
      a.motor.place(new THREE.Vector3(x, y, z), yaw); a.char.resetPose(a.ground);
      if (a === game.kitten) kitten.resetCloth();
      if (a === game.active) game.camera.snap(game.subject(), game.camera.yaw);
    },
    simMove: (x: number, y: number, seconds: number, jumpHeld = false) => { sim.move.set(x, y); sim.until = clockT + seconds; sim.jumpHeld = jumpHeld; },
    jump: () => { (game.active === game.kitten && kitten.body.climb) ? (game as any).climbJump = true : game.active.motor.queueJump(); },
    act: () => game.handleInput({ ...input.poll(0), interactPressed: true }),
    camYaw: (y: number, p = 0.3) => { game.camera.yaw = y; game.camera.pitch = p; },
    step: (n: number, dt = H) => { for (let i = 0; i < n; i++) frame(dt, false); },
    state: () => {
      const s = (a: any) => ({ pos: a.char.body.pos.toArray().map((v: number) => +v.toFixed(3)), grounded: a.motor.grounded, mode: a.motor.mode, climb: !!a.char.body.climb, plat: !!a.motor.platform, vel: a.motor.vel.toArray().map((v: number) => +v.toFixed(2)) });
      return { active: game.active === game.kitten ? 'kitten' : 'knight', kitten: s(game.kitten), knight: s(game.knight), holding: game.carry.holding };
    },
  };

  resize();
  load.done('characters');
  await nextPaint();

  // ---- Compile every material before the first frame.
  {
    const rt = scenePass.renderTarget;
    rt.samples = renderer.samples;
    rt.texture.type = (renderer as any).getOutputBufferType?.() ?? THREE.HalfFloatType;
    const unculled: THREE.Object3D[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    const unhidden: THREE.Object3D[] = [];
    for (const g of [veg.group, mist.group]) g.traverse((o) => { if (!o.visible) { o.visible = true; unhidden.push(o); } });
    const prev = renderer.getRenderTarget(), prevMRT = renderer.getMRT();
    renderer.setRenderTarget(rt);
    renderer.setMRT((scenePass as any).getMRT());
    try {
      await renderer.compileAsync(scene, camera, null, (e: ProgressEvent) => load.progress('shaders', e.loaded / Math.max(1, e.total), `${e.loaded} of ${e.total}`));
    } catch (e) { console.warn('Shader precompile failed; shaders will compile on first use.', e); }
    finally {
      renderer.setRenderTarget(prev); renderer.setMRT(prevMRT);
      for (const o of unculled) o.frustumCulled = true;
      for (const o of unhidden) o.visible = false;
    }
  }
  load.done('shaders');
  await nextPaint();
  const gpuIdle = () => (renderer as any).backend?.device?.queue?.onSubmittedWorkDone?.() ?? Promise.resolve();
  frame(H, true);
  await gpuIdle();
  frame(H, true);
  await gpuIdle();
  load.done('warmup');
  statsPanel.setLoad(load.report());
  hud.setReady();
  if (started) hud.begin();
  W.__ready = true;

  // ---- Adaptive resolution between 55% and 100% of the tier's pixel ratio, judged on GPU time where reported.
  let renderScale = 1;
  const setRenderScale = (s: number) => {
    s = THREE.MathUtils.clamp(s, 0.55, 1);
    if (Math.abs(s - renderScale) < 0.01) return;
    renderScale = s; renderer.setPixelRatio(basePixelRatio * s); resize();
  };
  const drs = { ema: 16.7, hold: 2, ceiling: 1, ceilingT: 0 };
  const adapt = (dtMs: number, dt: number) => {
    if (params.has('still') || params.get('drs') === '0' || dtMs > 250) return;
    const gpu = statsPanel.gpuMs, m = gpu !== null && gpu > 0 ? gpu : dtMs;
    drs.ema += (Math.min(m, 100) - drs.ema) * 0.08;
    drs.hold -= dt; drs.ceilingT -= dt;
    if (drs.ceilingT <= 0) drs.ceiling = 1;
    if (drs.hold > 0) return;
    if (drs.ema > 18.5) { const b = renderScale; setRenderScale(renderScale * THREE.MathUtils.clamp(Math.sqrt(16 / drs.ema), 0.8, 0.96)); drs.ceiling = b; drs.ceilingT = 20; drs.hold = 0.75; }
    else if (renderScale < drs.ceiling - 0.01 && drs.ema < (gpu !== null ? 12 : 17.4)) { setRenderScale(Math.min(drs.ceiling, renderScale * 1.05)); drs.hold = gpu !== null ? 1 : 3; }
  };
  const still = params.has('still');
  let last = performance.now(), frameNo = 0, stillDone = false;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dtMs = now - last, dt = Math.min(0.1, dtMs / 1000);
    last = now;
    if (still) { if (!stillDone) { stillDone = true; frame(H, true); W.__done = true; } return; }
    frame(dt);
    const cpu = performance.now() - now;
    if (statsPanel.gpuSupported && ++frameNo % 6 === 0) {
      renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((v) => { if (typeof v === 'number' && v > 0) statsPanel.gpuMs = v; }).catch(() => {});
    }
    statsPanel.push(dtMs, cpu);
    adapt(dtMs, dt);
    const pr = renderer.getPixelRatio();
    statsPanel.update(dt, { width: Math.round(innerWidth * pr), height: Math.round(innerHeight * pr), scale: renderScale, adaptive: true, backend, tier: tierName, calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles });
  });
}
