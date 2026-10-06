// Cutscenes as data (engine v2): tracks on one clock. Camera shots (a start and an end key with easing and focal
// length, each cut to or blended), character marks (walk or run a path, then face a way), lines and chapter cards,
// fades, letterbox and cues. While one plays, input is locked and the timeline places the characters itself (their
// motors held), so nothing in a cutscene can fall, catch on a wall or be pushed. It can be skipped: every mark goes
// to its end, every cue still due runs, and play blends back from the last shot.
import * as THREE from 'three';
import { fovFromMM } from './camera';
import type { Game, Actor } from './game';

type V3 = THREE.Vector3 | [number, number, number] | (() => THREE.Vector3);
export type CamKey = { pos: V3; look: V3; mm?: number; dof?: number };
export type Shot = { at: number; dur: number; from: CamKey; to?: CamKey; ease?: 'linear' | 'smooth' | 'in' | 'out'; blend?: number; handheld?: number };
// `probe`: how far above the path the ground is looked for (lower it under an overhang: a lap under a chest).
// `arc`: a leap from the path's first point to its last, this high (m) over the straight line between them.
export type Mark = { at: number; who: 'kitten' | 'knight'; path: [number, number, number][]; speed?: number; face?: number; probe?: number; arc?: number };
export type Cue = { at: number; run: () => void; onSkip?: boolean };
export type Fade = { at: number; dur: number; to: number };
export type Cutscene = {
  name: string; length: number; shots: Shot[]; marks?: Mark[]; cues?: Cue[]; fades?: Fade[];
  letterbox?: boolean; skippable?: boolean; onEnd?: () => void;
};

export type TimelineUI = { fade: (opacity: number) => void; letterbox: (on: boolean) => void };

const v3 = (v: V3, out: THREE.Vector3) => (typeof v === 'function' ? out.copy(v()) : Array.isArray(v) ? out.set(v[0], v[1], v[2]) : out.copy(v));
const easeOf = (e: Shot['ease'], x: number) => {
  x = THREE.MathUtils.clamp(x, 0, 1);
  if (e === 'linear') return x;
  if (e === 'in') return x * x * x;
  if (e === 'out') return 1 - Math.pow(1 - x, 3);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _l0 = new THREE.Vector3(), _l1 = new THREE.Vector3();

type MarkRun = { m: Mark; actor: Actor; pts: THREE.Vector3[]; len: number; dur: number; y0?: number; y1?: number };

export class Timeline {
  scene: Cutscene | null = null;
  t = 0;
  private runs: MarkRun[] = [];
  private cueDone = new Set<Cue>();
  private shotBlendFrom: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  private lastShot: Shot | null = null;
  private fadeLevel = 0;
  private fadeFrom = new Map<Fade, number>();
  private clock = 0;

  constructor(private game: Game, private ui: TimelineUI) {}

  get playing() { return this.scene !== null; }

  play(cs: Cutscene) {
    const g = this.game;
    g.kitten.climber.drop(); g.carry.cancel();
    this.scene = cs; this.t = 0; this.cueDone.clear(); this.lastShot = null; this.shotBlendFrom = null; this.fadeFrom.clear();
    g.locked = true;
    for (const a of [g.kitten, g.knight]) { a.motor.mode = 'held'; a.char.body.vel.set(0, 0, 0); }
    this.runs = (cs.marks ?? []).map((m) => {
      const actor = m.who === 'kitten' ? g.kitten : g.knight;
      const pts = m.path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const run: MarkRun = { m, actor, pts, len, dur: len / (m.speed ?? 1.6) };
      return run;
    });
    if (cs.letterbox !== false) this.ui.letterbox(true);
  }

  // Ends now: marks to their ends, the cues still due (those that change the world), the camera back to play.
  skip() {
    const cs = this.scene;
    if (!cs || cs.skippable === false) return;
    this.t = cs.length;
    for (const c of cs.cues ?? []) if (!this.cueDone.has(c) && c.onSkip !== false) { this.cueDone.add(c); c.run(); }
    this.finish();
  }

  // Each rendered frame while playing; returns false once it has ended.
  update(dt: number, cam: THREE.PerspectiveCamera) {
    const cs = this.scene;
    if (!cs) return false;
    this.t += dt; this.clock += dt;
    const t = this.t;
    for (const c of cs.cues ?? []) if (!this.cueDone.has(c) && t >= c.at) { this.cueDone.add(c); c.run(); }
    for (const r of this.runs) this.placeMark(r, t, dt);
    // Camera: the last shot that has started.
    let shot: Shot | null = null;
    for (const s of cs.shots) if (t >= s.at) shot = s;
    if (shot) {
      if (shot !== this.lastShot) {
        // A new shot cuts, unless it asks to blend from the one before.
        this.shotBlendFrom = shot.blend ? { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov } : null;
        this.lastShot = shot;
      }
      const a = easeOf(shot.ease, (t - shot.at) / Math.max(1e-3, shot.dur));
      const to = shot.to ?? shot.from;
      v3(shot.from.pos, _p0); v3(to.pos, _p1); v3(shot.from.look, _l0); v3(to.look, _l1);
      cam.position.lerpVectors(_p0, _p1, a);
      cam.lookAt(_l0.lerp(_l1, a));
      const h = shot.handheld ?? 1;
      if (h > 0) {
        const c = this.clock, k = 0.004 * h;
        cam.rotateY(k * (Math.sin(c * 0.61) * 0.6 + Math.sin(c * 1.37 + 1.3) * 0.4));
        cam.rotateX(k * 0.8 * (Math.sin(c * 0.83 + 0.4) * 0.6 + Math.sin(c * 1.91 + 2.1) * 0.4));
      }
      cam.fov = fovFromMM(THREE.MathUtils.lerp(shot.from.mm ?? 35, to.mm ?? shot.from.mm ?? 35, a));
      if (this.shotBlendFrom && shot.blend) {
        const b = THREE.MathUtils.clamp((t - shot.at) / shot.blend, 0, 1), e = b * b * (3 - 2 * b);
        const target = cam.position.clone(), tq = cam.quaternion.clone();
        cam.position.lerpVectors(this.shotBlendFrom.pos, target, e);
        cam.quaternion.copy(this.shotBlendFrom.quat).slerp(tq, e);
        cam.fov = THREE.MathUtils.lerp(this.shotBlendFrom.fov, cam.fov, e);
      }
      cam.updateProjectionMatrix();
    }
    // Fades: the latest that has started sets the level, eased from where it was (and held once done, so a long
    // frame cannot step over its end).
    let fade: Fade | null = null;
    for (const f of cs.fades ?? []) if (t >= f.at && (!fade || f.at >= fade.at)) fade = f;
    if (fade) {
      const a = THREE.MathUtils.clamp((t - fade.at) / Math.max(1e-3, fade.dur), 0, 1);
      if (!this.fadeFrom.has(fade)) this.fadeFrom.set(fade, this.fadeLevel);
      const level = THREE.MathUtils.lerp(this.fadeFrom.get(fade)!, fade.to, a * a * (3 - 2 * a));
      if (level !== this.fadeLevel) { this.fadeLevel = level; this.ui.fade(level); }
    }
    if (t >= cs.length) this.finish();
    return this.scene !== null;
  }

  // A character along its path: walked at the mark's speed over the ground, turned along the way, then facing `face`.
  private placeMark(r: MarkRun, t: number, dt: number) {
    const b = r.actor.char.body, m = r.m;
    if (t < m.at) return;
    const s = Math.min(r.len, (t - m.at) * (m.speed ?? 1.6));
    let d = s, i = 1;
    while (i < r.pts.length - 1 && d > r.pts[i].distanceTo(r.pts[i - 1])) { d -= r.pts[i].distanceTo(r.pts[i - 1]); i++; }
    const a = r.pts[Math.max(0, i - 1)], c = r.pts[Math.min(i, r.pts.length - 1)];
    const seg = a.distanceTo(c) || 1;
    const p = a.clone().lerp(c, Math.min(1, d / seg));
    const probe = m.probe ?? 0.6;
    const moving = s < r.len;
    if (m.arc !== undefined) {
      // A leap: from the ground at the start to the ground at the end, over an arc.
      if (r.y0 === undefined) {
        const a0 = r.pts[0], a1 = r.pts[r.pts.length - 1];
        r.y0 = this.game.physics.groundY(a0.x, a0.y + 0.6, a0.z, 3) ?? a0.y;
        r.y1 = this.game.physics.groundY(a1.x, a1.y + probe, a1.z, probe + 2.4) ?? a1.y;
      }
      const u = r.len > 0 ? s / r.len : 1;
      p.y = THREE.MathUtils.lerp(r.y0, r.y1!, u) + m.arc * 4 * u * (1 - u);
      const prevY = b.pos.y;
      b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
      b.vel.set(0, 0, 0);
      if (moving && dt > 0) b.vel.subVectors(p, b.pos).divideScalar(dt);
      b.vy = moving && dt > 0 ? (p.y - prevY) / dt : 0;
      b.vel.y = 0;
      b.pos.copy(p); b.prevPos.copy(p);
      const want = m.face ?? b.yaw;
      const dy = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
      b.yaw += dy * Math.min(1, dt * 8); b.prevYaw = b.yaw;
      b.turnRate = 0;
      if (!moving && !b.grounded) b.landing = Math.max(b.landing, 0.5);
      b.grounded = !moving;
      r.actor.motor.syncCollider();
      return;
    }
    const gy = this.game.physics.groundY(p.x, p.y + probe, p.z, probe + 2.4);
    if (gy !== null) p.y = gy;
    b.prevPos.copy(b.pos); b.prevYaw = b.yaw;
    if (moving && dt > 0) b.vel.subVectors(p, b.pos).divideScalar(dt); else b.vel.set(0, 0, 0);
    b.vel.y = 0;
    b.pos.copy(p);
    b.prevPos.copy(p); // placed every frame: nothing to interpolate
    const want = moving ? Math.atan2(c.x - a.x, c.z - a.z) : m.face ?? b.yaw;
    const dy = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
    b.yaw += dy * Math.min(1, dt * 8);
    b.prevYaw = b.yaw;
    b.turnRate = dt > 0 ? dy * Math.min(1, dt * 8) / dt : 0;
    b.grounded = true;
    r.actor.motor.syncCollider();
  }

  private finish() {
    const cs = this.scene!, g = this.game;
    // Every mark at its end, and the characters handed back to their motors where they stand.
    for (const r of this.runs) {
      const end = r.pts[r.pts.length - 1].clone();
      const probe = r.m.probe ?? 0.6;
      const gy = g.physics.groundY(end.x, end.y + probe, end.z, probe + 2.4);
      if (gy !== null) end.y = gy;
      r.actor.motor.place(end, r.m.face ?? r.actor.char.body.yaw);
    }
    for (const a of [g.kitten, g.knight]) if (a.motor.mode === 'held') a.motor.place(a.char.body.pos.clone(), a.char.body.yaw);
    this.scene = null;
    this.runs = [];
    g.locked = false;
    this.ui.letterbox(false);
    if (this.fadeLevel > 0) { this.fadeLevel = 0; this.ui.fade(0); }
    g.camera.takeOver(g.subject(), 1.1);
    cs.onEnd?.();
  }
}
