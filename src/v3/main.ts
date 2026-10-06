// Whisker v3: a lean WebGL engine. Quality tiers and adaptive resolution keep it smooth on phones; levels load
// in place (no page reloads); the two characters persist between levels.
import * as THREE from 'three';
import { Physics, L } from './physics';
import { Game, LevelInfo } from './game';
import { Timeline } from './timeline';
import { KeyboardMouseGamepad, InputFrame } from './input';
import { Soundscape } from './audio';
import { Hud } from './ui/hud';
import { Look, LOOKS } from './render/look';
import { Terrain } from './world/terrain';
import { Grass, GRASS_TIERS, GrassLook } from './world/grass';
import { ToyKitten } from './chars/kitten';
import { ToyKnight } from './chars/knight';
import { WIND } from './body';
import { fovFromMM } from './camera';
import type { Ctx, Level } from './levels/types';
import { LEVELS, LEVEL_ORDER } from './levels';

export type QualityName = 'low' | 'medium' | 'high';
export type Quality = { name: QualityName; maxRatio: number; minScale: number; shadow: number; shadowSpan: number; antialias: boolean };
const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', maxRatio: 1.25, minScale: 0.6, shadow: 1024, shadowSpan: 12, antialias: false },
  medium: { name: 'medium', maxRatio: 1.6, minScale: 0.65, shadow: 1024, shadowSpan: 16, antialias: true },
  high: { name: 'high', maxRatio: 2, minScale: 0.7, shadow: 2048, shadowSpan: 18, antialias: true },
};

const H = 1 / 60;
const W = window as any;

type Save = { level: string; checkpoint: string | null; unlocked: string[] };
function loadSave(): Save {
  try { const s = JSON.parse(localStorage.getItem('whisker3') || 'null'); if (s && s.level) return s; } catch { /* none */ }
  return { level: 'prologue', checkpoint: null, unlocked: ['prologue'] };
}
function writeSave(s: Save) { try { localStorage.setItem('whisker3', JSON.stringify(s)); } catch { /* not kept */ } }

export async function run(params: URLSearchParams) {
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  let stored: string | null = null;
  try { stored = localStorage.getItem('whisker3.q'); } catch { /* storage blocked */ }
  let qName: QualityName = (params.get('q') as QualityName) || (stored as QualityName) || (phone ? 'low' : 'medium');
  if (!QUALITY[qName]) qName = 'medium';
  const Q = QUALITY[qName];
  const hud = new Hud();
  hud.quality = qName;
  hud.progress(0.05, 'Starting…');
  document.getElementById('boot')?.remove();

  // ---- Renderer.
  const renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, powerPreference: 'high-performance', stencil: false });
  const baseRatio = Math.min(devicePixelRatio, Q.maxRatio);
  let scale = 1;
  renderer.setPixelRatio(baseRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app')!.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const look = new Look(renderer, scene, Q.shadow);
  look.shadowSpan(Q.shadowSpan);

  // ---- Input, sound, characters.
  const input = new KeyboardMouseGamepad(renderer.domElement);
  input.onTouchMode = () => { hud.touch = true; };
  if (matchMedia('(pointer: coarse)').matches) input.enterTouchMode();
  const audio = new Soundscape();
  hud.progress(0.15, 'Making the kitten and the knight…');
  const kitten = new ToyKitten(), knight = new ToyKnight();
  await Promise.all([kitten.load(), knight.load()]);
  scene.add(kitten.group, knight.group);
  hud.progress(0.4, 'Building the world…');

  // ---- Level state.
  const save = loadSave();
  let level: Level | null = null;
  let physics: Physics | null = null;
  let game: Game | null = null;
  let timeline: Timeline | null = null;
  let terrain: Terrain | null = null;
  let grass: Grass | null = null;
  let root = new THREE.Group();
  scene.add(root);
  let ctx: Ctx | null = null;
  let paused = false, started = false, loading = false;
  let clockT = 0;
  const sim = { move: new THREE.Vector2(), until: 0, jumpHeld: false };
  let freeCam: { pos: THREE.Vector3; look: THREE.Vector3; mm?: number } | null = null;
  const camera = new THREE.PerspectiveCamera(fovFromMM(28), innerWidth / innerHeight, 0.03, 6000);

  const setTerrain = (t: Terrain, gl: GrassLook) => {
    terrain = t;
    root.add(t.mesh, t.far);
    t.addTo(physics!);
    const p = look.preset;
    const sc = new THREE.Color(p.sun).multiplyScalar(p.sunIntensity * 0.42), sky = new THREE.Color(p.hemiSky).multiplyScalar(p.hemiIntensity * 0.9);
    grass = new Grass(t, GRASS_TIERS[Q.name], gl, { sunDir: look.sunDir.clone(), sun: sc, sky, ground: new THREE.Color(p.hemiGround) });
    root.add(grass.group);
  };

  async function load(id: string, checkpoint: string | null) {
    loading = true;
    const L = LEVELS[id] ?? LEVELS.prologue;
    if (level) { level.dispose?.(); }
    scene.remove(root);
    root.traverse((o: any) => { if (o.isMesh || o.isInstancedMesh) { o.geometry?.dispose?.(); } });
    grass?.dispose(); terrain?.dispose(); grass = null; terrain = null;
    physics?.world.free();
    root = new THREE.Group(); root.name = `Level_${id}`;
    scene.add(root);
    physics = await Physics.create(H);
    look.set(LOOKS[L.look] ?? LOOKS.morning);
    WIND.base = 0.3; WIND.gust = 0; WIND.push = 0; WIND.sheltered = () => false;
    level = L;
    ctx = {
      scene, root, physics, look, quality: Q, renderer, camera, hud, audio, kitten, knight,
      game: null as any, timeline: null as any, touch: () => input.touchMode,
      next: (n) => { void transition(n); }, checkpoint: (name) => { save.level = id; save.checkpoint = name; writeSave(save); },
      padLabel: (code, text) => input.label(code, text), setTerrain,
    };
    const info: LevelInfo = await L.build(ctx);
    game = new Game(physics, kitten as any, knight as any, info, innerWidth / innerHeight);
    game.camera.cam = camera;
    timeline = new Timeline(game, { fade: (o) => hud.fadeLevel(o), letterbox: (on) => hud.letterbox(on) });
    ctx.game = game; ctx.timeline = timeline;
    wireGame(game);
    save.level = id; save.checkpoint = checkpoint; if (!save.unlocked.includes(id)) save.unlocked.push(id); writeSave(save);
    hud.setChapters(LEVEL_ORDER.map((l) => ({ id: l, title: LEVELS[l].title, unlocked: save.unlocked.includes(l) || params.has('all') })));
    L.start?.(ctx, checkpoint);
    // Compile every material against this level's lights before play.
    renderer.compile(scene, camera);
    for (const v of L.warmViews?.() ?? []) {
      camera.position.set(...v.pos); camera.lookAt(...v.look); camera.updateMatrixWorld();
      look.update(0, new THREE.Vector3(...v.look));
      renderer.render(scene, camera);
    }
    loading = false;
  }

  // Between levels: to black, build, back in.
  async function transition(id: string) {
    if (loading) return;
    await hud.fade(1, 1.2);
    await load(id, null);
    hud.fadeLevel(1);
    level?.begin?.(ctx!);
    setTimeout(() => { if (!timeline?.playing) void hud.fade(0, 1.4); }, 120);
  }

  function wireGame(g: Game) {
    g.onSwitch = (to) => audio.play('clank', to.char.body.pos, 0.12);
    g.onWait = (who, waiting) => hud.say(`The ${who === g.knight ? 'knight' : 'kitten'} ${waiting ? 'waits here' : 'comes with you'}.`, 2.2);
    g.onFall = (_a, phase) => { hud.fade(phase === 'out' ? 1 : 0, 0.28); };
    g.onSink = (a) => { if (a === g.knight) hud.say('Too deep for him in all that steel.', 3); };
    let lastCall = -1;
    g.onCall = (who) => {
      const now = performance.now() / 1000;
      if (who !== g.kitten || now - lastCall < 0.5) return;
      lastCall = now;
      const kinds = ['meow', 'meow', 'mew', 'mrrp'] as const;
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      kitten.meow(kind);
      audio.play(kind, g.kitten.char.body.pos);
      level?.call?.(ctx!, kind);
    };
  }

  // ---- Menu.
  hud.onMenu = (a, v) => {
    if (a === 'pause') paused = true;
    else if (a === 'unpause') paused = false;
    else if (a === 'volume') audio.setVolume(+v!);
    else if (a === 'quality') { try { localStorage.setItem('whisker3.q', v!); } catch { /* */ } location.reload(); }
    else if (a === 'chapter') { paused = false; void transition(v!); }
    else if (a === 'restart') { paused = false; void (async () => { await hud.fade(1, 0.8); await load(level!.id, save.checkpoint); level?.begin?.(ctx!); void hud.fade(0, 1); })(); }
  };

  // ---- First level.
  const first = params.get('level') || (params.has('fresh') ? 'prologue' : save.level);
  await load(LEVELS[first] ? first : 'prologue', params.has('fresh') ? null : save.checkpoint);
  hud.progress(1);
  hud.ready(save.level !== 'prologue' && !params.has('level') ? 'Continue' : 'Play', () => {
    audio.start(); started = true;
    if (!params.has('nointro')) level?.begin?.(ctx!);
  });
  W.__ready = true;

  // ---- Resize and adaptive resolution.
  const resize = () => {
    renderer.setPixelRatio(baseRatio * scale);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  const perf = { ema: 16.7, hold: 2, frames: 0, cpu: 0 };
  const adapt = (ms: number, dt: number) => {
    if (params.get('drs') === '0' || ms > 200) return;
    perf.ema += (ms - perf.ema) * 0.06;
    perf.hold -= dt;
    if (perf.hold > 0) return;
    if (perf.ema > 19 && scale > Q.minScale) { scale = Math.max(Q.minScale, scale * 0.9); resize(); perf.hold = 1.2; }
    else if (perf.ema < 14.5 && scale < 1) { scale = Math.min(1, scale * 1.06); resize(); perf.hold = 2.5; }
  };

  // ---- Loop.
  let acc = 0;
  const kHead = new THREE.Vector3(), nHead = new THREE.Vector3();
  const frame = (dt: number, render = true) => {
    const g = game!, tl = timeline!, c = ctx!;
    clockT += dt;
    WIND.time = clockT;
    let inp: InputFrame = input.poll(dt);
    if (sim.until > clockT) inp = { ...inp, move: sim.move.clone(), jumpHeld: inp.jumpHeld || sim.jumpHeld };
    if (!started || paused || loading) inp = { ...inp, move: new THREE.Vector2(), look: new THREE.Vector2(), jumpPressed: false, switchPressed: false, interactPressed: false, waitPressed: false };
    if (!paused && !loading) {
      level?.update?.(dt, c);
      g.handleInput(inp);
      acc += Math.min(dt, 0.1);
      while (acc >= H) { g.fixedStep(H, inp); acc -= H; }
      physics!.sync(acc / H);
    }
    const alpha = acc / H;
    kitten.headPos(kHead); knight.headPos(nHead);
    const ground = (a: { ground: (x: number, z: number) => number }) => a.ground;
    kitten.updateVisual(alpha, { dt, time: clockT, ground: ground(g.kitten), lookAt: nHead, active: g.active === g.kitten });
    knight.updateVisual(alpha, { dt, time: clockT, ground: ground(g.knight), lookAt: kHead, active: g.active === g.knight });
    kitten.update(dt, { dt, time: clockT, ground: ground(g.kitten), lookAt: null, active: true });
    knight.update(dt, { dt, time: clockT, ground: ground(g.knight), lookAt: null, active: true });
    // Camera: a cutscene's shots, the test camera, or the follow camera.
    // Skipping takes a second press (a stray tap shouldn't throw away a cutscene).
    skipArm = Math.max(0, skipArm - dt);
    if (tl.playing && inp.skipPressed && tl.t > 0.6 && started && tl.scene?.skippable !== false) {
      if (skipArm > 0) { skipArm = 0; tl.skip(); hud.skipHint(false); }
      else { skipArm = 2.5; hud.skipHint(true, input.touchMode); }
    }
    if (!tl.playing || skipArm === 0) hud.skipHint(false);
    if (tl.playing) tl.update(dt, camera);
    else g.camera.update(dt, g.subject(), started ? inp.look : new THREE.Vector2(), inp.zoom, physics!);
    // Cutscene camera checks (tests): the lens inside a character or inside the world.
    if (tl.playing && camIssues) {
      const cp = camera.position;
      for (const ch of [kitten, knight]) for (const sp of ch.spheres()) if (sp.distanceToPoint(cp) < 0.04) camIssues.push(`${tl.scene?.name} t=${tl.t.toFixed(2)} inside ${ch.kind}`);
      if (physics!.overlaps(cp, 0.03, L.world | L.detail)) camIssues.push(`${tl.scene?.name} t=${tl.t.toFixed(2)} inside world`);
      if (terrain && cp.y < terrain.heightAt(cp.x, cp.z) + 0.05) camIssues.push(`${tl.scene?.name} t=${tl.t.toFixed(2)} under ground`);
    }
    if (freeCam) { camera.position.copy(freeCam.pos); camera.lookAt(freeCam.look); if (freeCam.mm) camera.fov = fovFromMM(freeCam.mm); camera.updateProjectionMatrix(); }
    // The knight dissolves while he stands between the lens and the kitten.
    {
      let want = 1;
      if (g.active === g.kitten && !tl.playing) {
        const cp = camera.position, kp = kitten.renderPos, np = knight.renderPos;
        const sx = kp.x - cp.x, sz = kp.z - cp.z, sl2 = sx * sx + sz * sz || 1;
        const t = ((np.x - cp.x) * sx + (np.z - cp.z) * sz) / sl2;
        if (t > 0 && t < 1.05) {
          const d = Math.hypot(np.x - (cp.x + sx * t), np.z - (cp.z + sz * t));
          const ly = cp.y + (kp.y + 0.15 - cp.y) * t;
          if (d < 0.7 && ly > np.y - 0.1 && ly < np.y + 1.95) want = 0.15;
        }
        if (cp.distanceTo(new THREE.Vector3(np.x, np.y + 1, np.z)) < 1.1) want = Math.min(want, 0.15);
      }
      knightFade += (want - knightFade) * Math.min(1, dt * 8);
      knight.setFade(knightFade);
    }
    const focus = g.active.char.renderPos;
    look.update(dt, tl.playing ? cutFocus(camera, focus) : focus, WIND.dir);
    if (grass) {
      grass.pushers[0].set(kitten.renderPos.x, kitten.renderPos.z, 0.22, kitten.carriedBy ? 0 : 1);
      grass.pushers[1].set(knight.renderPos.x, knight.renderPos.z, 0.5, 1);
      grass.update(dt, tl.playing ? cutFocus(camera, focus) : camera.position.clone().lerp(focus, 0.5), scene.fog as THREE.Fog);
    }
    audio.listener.copy(camera.position);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    audio.listenerYaw = Math.atan2(-fwd.x, -fwd.z) + Math.PI;
    audio.update(dt);
    // HUD.
    input.showPad?.(started && !tl.playing);
    const a = g.active;
    const state = a === g.knight && g.carry.holding ? 'carrying' : '';
    hud.who(started && !tl.playing ? (a === g.kitten ? 'kitten' : 'knight') : null, g.canSwitch, state);
    const pr = started && !tl.playing ? g.prompt() : null;
    hud.prompt(pr ? pr.text : null, pr ? (pr.key === 'jump' ? (input.touchMode ? 'Jump' : '␣') : (input.touchMode ? 'Act' : 'E')) : undefined);
    if (physLines) {
      const { vertices, colors } = physics!.world.debugRender();
      const g = physLines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      g.computeBoundingSphere();
      if (!physLines.parent) scene.add(physLines);
    }
    if (render) renderer.render(scene, camera);
  };
  // ?phys: the colliders drawn as lines over the scene.
  const physLines = params.has('phys') ? new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false })) : null;
  if (physLines) { physLines.frustumCulled = false; physLines.renderOrder = 10; }
  let knightFade = 1;
  let skipArm = 0;
  const camIssues: string[] | null = params.has('camcheck') ? [] : null;
  W.__camIssues = camIssues;
  // In a cutscene the shadows follow what the camera looks at.
  const cutFocus = (cam: THREE.PerspectiveCamera, fallback: THREE.Vector3) => {
    const d = cam.getWorldDirection(new THREE.Vector3());
    const p = cam.position.clone().addScaledVector(d, 6);
    return terrain ? p.setY(terrain.heightAt(p.x, p.z)) : fallback;
  };

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), ms = now - last, dt = Math.min(0.1, ms / 1000);
    last = now;
    if (!game) return;
    frame(dt);
    perf.cpu += ((performance.now() - now) - perf.cpu) * 0.05;
    perf.frames++;
    adapt(ms, dt);
    if (stats) stats.textContent = `${(1000 / perf.ema).toFixed(0)} fps · cpu ${perf.cpu.toFixed(1)} ms · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${(scale * baseRatio).toFixed(2)}x · ${Q.name}`;
  });
  const stats = params.has('stats') ? Object.assign(document.createElement('div'), { style: 'position:fixed;left:8px;bottom:8px;font:12px monospace;color:#fff;background:rgba(0,0,0,.5);padding:3px 6px;z-index:9;pointer-events:none' }) : null;
  if (stats) document.body.appendChild(stats);

  // ---- Test and debug hooks.
  W.__THREE = THREE;
  W.__v3 = {
    get game() { return game; }, get timeline() { return timeline; }, get level() { return level; }, get ctx() { return ctx; },
    get physics() { return physics; }, get terrain() { return terrain; },
    renderer, scene, camera, kitten, knight, hud, audio, look, WIND,
    begin: () => { if (hud.go && !hud.started) hud.go(); else { started = true; audio.start(); level?.begin?.(ctx!); } },
    play: () => { started = true; },
    load: (id: string) => load(id, null),
    go: (id: string) => transition(id),
    simMove: (x: number, y: number, seconds: number, jumpHeld = false) => { sim.move.set(x, y); sim.until = clockT + seconds; sim.jumpHeld = jumpHeld; },
    step: (n: number, dt = H) => { for (let i = 0; i < n; i++) frame(dt, false); },
    render: () => frame(1e-4, true),
    camAt: (px: number, py: number, pz: number, lx: number, ly: number, lz: number, mm?: number) => { freeCam = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz), mm }; },
    camFollow: () => { freeCam = null; },
    camOn: (k: 'kitten' | 'knight', yaw: number, dist: number, h: number, mm = 40) => {
      const p = (k === 'kitten' ? kitten : knight).renderPos, lh = k === 'kitten' ? 0.14 : 0.9;
      freeCam = { pos: new THREE.Vector3(p.x + Math.sin(yaw) * dist, p.y + h, p.z + Math.cos(yaw) * dist), look: new THREE.Vector3(p.x, p.y + lh, p.z), mm };
    },
    camYaw: (y: number, p = 0.3) => { game!.camera.yaw = y; game!.camera.pitch = p; },
    teleport: (k: 'kitten' | 'knight', x: number, y: number | null, z: number, yaw = 0) => {
      const a = k === 'kitten' ? game!.kitten : game!.knight;
      if (a === game!.kitten) game!.kitten.climber.drop();
      const yy = y ?? (physics!.groundY(x, 200, z, 400) ?? 0);
      a.motor.place(new THREE.Vector3(x, yy, z), yaw); a.char.resetPose(a.ground);
      if (a === game!.active) game!.camera.snap(game!.subject(), game!.camera.yaw);
    },
    setActive: (k: 'kitten' | 'knight') => game!.switchTo(k === 'kitten' ? game!.kitten : game!.knight),
    jump: () => { const g = game!; if (g.active === g.kitten && g.kitten.char.body.climb) (g as any).climbJump = true; else g.active.motor.queueJump(); },
    act: () => game!.handleInput({ ...input.poll(0), interactPressed: true }),
    call: () => game!.handleInput({ ...input.poll(0), waitPressed: true }),
    swap: () => game!.handleInput({ ...input.poll(0), switchPressed: true }),
    state: () => {
      const s = (a: any) => ({ pos: a.char.body.pos.toArray().map((v: number) => +v.toFixed(3)), grounded: a.motor.grounded, mode: a.motor.mode, climb: !!a.char.body.climb, swim: a.motor.swimming, vel: a.motor.vel.toArray().map((v: number) => +v.toFixed(2)) });
      return { active: game!.active === game!.kitten ? 'kitten' : 'knight', kitten: s(game!.kitten), knight: s(game!.knight), holding: game!.carry.holding, follow: game!.follower.mode };
    },
    perf: () => ({ fps: +(1000 / perf.ema).toFixed(1), cpu: +perf.cpu.toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, scale, ratio: renderer.getPixelRatio(), q: Q.name }),
    // Average JS time of n frames of play (sim + animation + culling + draw submission), rendering each.
    bench: (n = 60) => { const t0 = performance.now(); for (let i = 0; i < n; i++) frame(H, true); return +((performance.now() - t0) / n).toFixed(2); },
  };
}
