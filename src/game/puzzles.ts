// Three small scale-based puzzles in FIELD_01:
// 1. The culvert and the winch: only the kitten fits under the wall; it hangs on the winch to raise the gate.
// 2. Two weights: the knight's weight on the flagstone and the kitten on the stone in the crawl space open the chapel.
// 3. The bell tower: the knight lifts the kitten to the window; it rides the bell rope down and lifts the door bar.
import * as THREE from 'three/webgpu';
import { Character } from '../chars/character';
import { Kitten } from '../chars/kitten';
import { Knight } from '../chars/knight';
import { Structures } from '../world/structures';
import { PhysicsWorld } from './physics';
import { HEAVY_PLATE, SMALL_PLATE, TOWER, CHAPEL } from '../world/layout';
import { regionOf, NavState } from './nav';

type Interactable = { id: string; label: string; who: 'kitten' | 'knight'; pos: () => THREE.Vector3; range: number; available: (c: Character) => boolean; run: (c: Character) => void };

export class Puzzles {
  state = { gateOpen: false, chapelOpen: false, towerOpen: false, shieldTaken: false, bellRung: false, castleAnswered: false, heavy: false, small: false };
  gateT = 0; chapelT = 0; towerT = 0; barT = 0; leverT = 0; bellSwing = 0; bellV = 0; castleT = 0; bannerT = 0;
  busy = new Set<Character>();
  private seqs: Generator<any, void, number>[] = [];
  private said = new Set<string>();
  items: Interactable[];
  prompt: string | null = null;
  nav: NavState;

  constructor(private s: Structures, private physics: PhysicsWorld, private kitten: Kitten, private knight: Knight,
    private say: (t: string) => void, private sfx: (name: string, pos?: THREE.Vector3, gain?: number) => void) {
    (window as any).__towerFloorY = s.sillY;
    this.nav = { gateOpen: false, chapelOpen: false, towerOpen: false, groundY: (x, z) => physics.groundAt(x, z) };
    const leverHandle = () => s.lever.localToWorld(new THREE.Vector3(-0.07, 0, 0.4));
    const sillOutside = () => new THREE.Vector3(TOWER.x, s.tY, TOWER.z + TOWER.r + 0.55);
    const ropeWorld = () => s.tower.localToWorld(s.ropeTop.clone().setY(TOWER.floorY));
    const barWorld = () => s.tower.localToWorld(new THREE.Vector3(TOWER.r - 0.68, 0.62, 0));
    this.items = [
      {
        id: 'winch', label: 'Pull the winch', who: 'kitten', range: 0.75, pos: () => s.winchPos.clone(),
        available: () => !this.state.gateOpen, run: (c) => this.start(this.winchSeq(c as Kitten, leverHandle)),
      },
      {
        id: 'shield', label: 'Take the small shield', who: 'kitten', range: 1.0, pos: () => s.rackPos.clone(),
        available: () => this.state.chapelOpen && !this.state.shieldTaken, run: () => {
          this.state.shieldTaken = true; this.kitten.hasShield = true; s.smallShield.visible = false;
          this.sfx('clank', s.rackPos, 0.5);
          this.say('The kitten takes up the small shield.');
        },
      },
      {
        id: 'shieldKnight', label: 'Examine the shields', who: 'knight', range: 1.6, pos: () => s.rackPos.clone(),
        available: () => this.state.chapelOpen && !this.state.shieldTaken, run: () => this.say('One of the shields is far too small for him.'),
      },
      {
        id: 'lift', label: 'Lift the kitten', who: 'knight', range: 1.15, pos: () => this.kitten.body.pos.clone(),
        available: () => !this.knight.holding && !this.busy.has(this.kitten) && !this.kitten.carriedBy && Math.abs(this.kitten.body.pos.y - this.knight.body.pos.y) < 0.4,
        run: () => this.start(this.liftSeq()),
      },
      {
        id: 'placeSill', label: 'Set the kitten on the window ledge', who: 'knight', range: 1.5, pos: sillOutside,
        available: () => !!this.knight.holding, run: () => this.start(this.placeSeq(true)),
      },
      {
        id: 'setDown', label: 'Set the kitten down', who: 'knight', range: 99, pos: () => this.knight.body.pos.clone(),
        available: () => !!this.knight.holding, run: () => this.start(this.placeSeq(false)),
      },
      {
        id: 'rope', label: 'Take hold of the bell rope', who: 'kitten', range: 0.7, pos: ropeWorld,
        available: (c) => regionOf(c.body.pos) === 'towerUp', run: (c) => this.start(this.ropeSeq(c as Kitten, ropeWorld())),
      },
      {
        id: 'bar', label: 'Lift the door bar', who: 'kitten', range: 0.85, pos: barWorld,
        available: (c) => !this.state.towerOpen && regionOf(c.body.pos) === 'towerDown', run: (c) => this.start(this.barSeq(c as Kitten, barWorld())),
      },
      {
        id: 'doorKnock', label: 'Try the door', who: 'knight', range: 1.6, pos: () => new THREE.Vector3(TOWER.x + TOWER.r + 0.3, s.tY, TOWER.z),
        available: () => !this.state.towerOpen, run: () => { this.sfx('thud', new THREE.Vector3(TOWER.x + TOWER.r, s.tY + 1, TOWER.z), 0.8); this.say('Barred from the inside.'); },
      },
    ];
  }

  start(g: Generator<any, void, number>) { g.next(0); this.seqs.push(g); }

  // Choose the best interaction for the active character this frame.
  findFor(c: Character): Interactable | null {
    let best: Interactable | null = null, bd = 1e9;
    if (this.busy.has(c)) return null;
    for (const it of this.items) {
      if (it.who !== c.kind || !it.available(c)) continue;
      const p = it.pos();
      const d = Math.hypot(p.x - c.body.pos.x, p.z - c.body.pos.z);
      if (Math.abs(p.y - c.body.pos.y) > 1.2 && it.id !== 'setDown' && it.id !== 'placeSill' && it.id !== 'bar') continue;
      if (d < it.range && (d < bd || it.id === 'placeSill')) {
        if (best?.id === 'placeSill') continue;
        best = it; bd = it.id === 'setDown' ? 50 : d;
      }
    }
    return best;
  }

  private *winchSeq(k: Kitten, handle: () => THREE.Vector3): Generator<any, void, number> {
    this.busy.add(k);
    // Reach up, find the handle out of reach, and hang from it until it comes down.
    const h0 = handle();
    k.hangTarget.copy(h0);
    const startY = k.body.pos.y;
    let t = 0;
    while (t < 0.6) { t += yield; k.hangPose = Math.min(1, t / 0.6); faceTo(k, h0); }
    // Hanging: body lifts to the handle and the lever slowly yields under the kitten's weight.
    this.sfx('creak', h0, 0.6);
    t = 0;
    while (t < 2.6) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 2.6);
      this.leverT = a;
      this.s.lever.rotation.x = -0.65 + 1.25 * (a * a);
      const hp = handle();
      k.hangTarget.copy(hp);
      const hangY = Math.max(startY, hp.y - 0.27);
      k.body.prevPos.y = k.body.pos.y; k.body.pos.y = hangY;
      if (a > 0.3 && !this.state.gateOpen) { this.state.gateOpen = true; this.sfx('gate', this.s.gate.position, 1.0); }
    }
    k.body.pos.y = startY;
    t = 0;
    while (t < 0.5) { t += yield; k.hangPose = 1 - t / 0.5; }
    k.hangPose = 0;
    this.busy.delete(k);
    this.say('The gate rises.');
  }

  private *liftSeq(): Generator<any, void, number> {
    const k = this.kitten, n = this.knight;
    this.busy.add(k); this.busy.add(n);
    n.body.vel.set(0, 0, 0);
    faceTo(n, k.body.pos);
    let t = 0;
    n.holding = k;
    const from = k.body.pos.clone();
    while (t < 0.9) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 0.9), e = a * a * (3 - 2 * a);
      const hp = n.holdPoint(new THREE.Vector3());
      k.body.prevPos.copy(k.body.pos);
      k.body.pos.lerpVectors(from, hp, e);
      k.body.yaw = n.body.yaw;
    }
    k.carriedBy = n;
    this.sfx('clank', k.body.pos, 0.25);
    this.busy.delete(k); this.busy.delete(n);
  }

  private *placeSeq(onSill: boolean): Generator<any, void, number> {
    const k = this.kitten, n = this.knight;
    this.busy.add(n);
    let dest: THREE.Vector3;
    if (onSill) {
      dest = new THREE.Vector3(TOWER.x, this.s.sillY, TOWER.z + TOWER.r - 0.32);
      faceTo(n, dest);
    } else {
      dest = n.toWorld(new THREE.Vector3(0.12, 0, 0.55), new THREE.Vector3());
      dest.y = this.physics.groundAt(dest.x, dest.z, n.body.pos.y + 0.3);
    }
    const from = k.body.pos.clone();
    k.carriedBy = null;
    this.busy.add(k);
    let t = 0;
    while (t < 0.9) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 0.9), e = a * a * (3 - 2 * a);
      k.body.prevPos.copy(k.body.pos);
      k.body.pos.lerpVectors(from, dest, e);
      k.body.pos.y += Math.sin(Math.PI * e) * 0.15;
    }
    k.body.pos.copy(dest); k.body.prevPos.copy(dest); k.body.vel.set(0, 0, 0);
    if (onSill) k.body.yaw = Math.PI; // facing into the tower
    k.resetPose((x, z) => this.physics.groundAt(x, z, dest.y + 0.2));
    n.holding = null;
    this.busy.delete(k); this.busy.delete(n);
    if (onSill) { (this as any).onPlacedOnSill?.(); }
  }

  private *ropeSeq(k: Kitten, rope: THREE.Vector3): Generator<any, void, number> {
    this.busy.add(k);
    faceTo(k, rope);
    const top = k.body.pos.clone();
    const bottomY = this.s.tY;
    k.hangTarget.copy(rope).setY(top.y + 0.38);
    let t = 0;
    while (t < 0.5) { t += yield; k.hangPose = Math.min(1, t / 0.5); }
    // The kitten's weight takes the rope down; each pull swings the bell.
    const start = new THREE.Vector3(rope.x - Math.sin(k.body.yaw) * 0.05, top.y, rope.z - Math.cos(k.body.yaw) * 0.05);
    t = 0;
    let rings = 0;
    while (t < 3.2) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 3.2);
      const y = THREE.MathUtils.lerp(top.y + 0.05, bottomY, a * a);
      k.body.prevPos.copy(k.body.pos);
      k.body.pos.set(start.x, y, start.z);
      k.hangTarget.set(rope.x, y + 0.36, rope.z);
      if (t > rings * 1.0 + 0.2 && rings < 3) { rings++; this.bellV += 1.6; this.sfx('bell', this.s.tower.localToWorld(new THREE.Vector3(0, TOWER.height - 2.2, 0)), 1.0); }
    }
    k.body.pos.y = bottomY; k.body.vy = 0;
    t = 0;
    while (t < 0.4) { t += yield; k.hangPose = 1 - t / 0.4; }
    k.hangPose = 0;
    this.busy.delete(k);
    if (!this.state.bellRung) {
      this.state.bellRung = true;
      this.say('The bell is rung.');
      t = 0;
      while (t < 5) t += yield;
      this.sfx('castleBell', undefined, 1.0);
      this.state.castleAnswered = true;
      this.say('From the castle, an answer.');
    }
  }

  private *barSeq(k: Kitten, bar: THREE.Vector3): Generator<any, void, number> {
    this.busy.add(k);
    faceTo(k, bar);
    k.hangTarget.copy(bar);
    let t = 0;
    while (t < 0.5) { t += yield; k.hangPose = Math.min(1, t / 0.5); }
    const y0 = k.body.pos.y;
    this.sfx('creak', bar, 0.5);
    t = 0;
    while (t < 1.8) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 1.8);
      this.barT = a;
      k.body.prevPos.y = k.body.pos.y;
      k.body.pos.y = y0 + Math.sin(Math.PI * a) * 0.18;
      k.hangTarget.copy(this.s.bar.getWorldPosition(new THREE.Vector3()));
    }
    k.body.pos.y = y0;
    this.state.towerOpen = true;
    this.sfx('door', bar, 0.9);
    t = 0;
    while (t < 0.4) { t += yield; k.hangPose = 1 - t / 0.4; }
    k.hangPose = 0;
    this.busy.delete(k);
    this.say('The bar lifts.');
  }

  update(dt: number, active: Character) {
    // Sequences.
    this.seqs = this.seqs.filter((g) => !g.next(dt).done);
    const st = this.state, s = this.s;
    // Gate rises over a few seconds.
    if (st.gateOpen && this.gateT < 1) { this.gateT = Math.min(1, this.gateT + dt / 3.8); }
    s.gate.position.y = s.yardY - 0.05 + 2.2 * (this.gateT * this.gateT * (3 - 2 * this.gateT));
    s.gateCol.enabled = this.gateT < 0.85;
    // Pressure stones.
    const onPlate = (c: Character, p: { x: number; z: number; r: number }) => Math.hypot(c.body.pos.x - p.x, c.body.pos.z - p.z) < p.r - c.body.radius * 0.3 && Math.abs(c.body.pos.y - s.yardY) < 0.4;
    st.heavy = onPlate(this.knight, HEAVY_PLATE);
    st.small = onPlate(this.kitten, SMALL_PLATE);
    const kittenOnHeavy = onPlate(this.kitten, HEAVY_PLATE);
    if (kittenOnHeavy && !this.said.has('heavyKitten')) { this.said.add('heavyKitten'); this.say('The stone does not notice the kitten.'); }
    s.heavy.position.y += ((s.yardY + 0.02 - (st.heavy ? 0.05 : 0)) - s.heavy.position.y) * Math.min(1, dt * 4);
    s.small.position.y += ((s.yardY - (st.small ? 0.03 : 0)) - s.small.position.y) * Math.min(1, dt * 4);
    if (st.heavy && !this.said.has('heavy1')) { this.said.add('heavy1'); this.sfx('stone', s.heavy.position, 0.7); }
    if (st.small && !this.said.has('small1')) { this.said.add('small1'); this.sfx('stone', s.small.position, 0.35); }
    if (st.heavy && st.small && !st.chapelOpen) {
      st.chapelOpen = true;
      this.sfx('bolt', new THREE.Vector3(CHAPEL.doorX, s.yardY + 1, CHAPEL.maxZ), 1.0);
      this.say('Somewhere in the chapel, a bolt slides back.');
    }
    if (st.chapelOpen && this.chapelT < 1) {
      const was = this.chapelT;
      this.chapelT = Math.min(1, this.chapelT + dt / 2.8);
      if (was === 0) this.sfx('door', new THREE.Vector3(CHAPEL.doorX, s.yardY + 1, CHAPEL.maxZ), 0.8);
    }
    s.chapelDoor.rotation.y = -1.75 * (this.chapelT * this.chapelT * (3 - 2 * this.chapelT));
    s.chapelDoorCol.enabled = this.chapelT < 0.7;
    s.lantern.intensity = 1.6 * this.chapelT;
    s.flame.visible = this.chapelT > 0.01;
    // Tower door and bar.
    s.bar.position.y = 0.62 + 0.35 * this.barT;
    s.bar.rotation.x = 0.0;
    s.bar.rotation.y = 0.0;
    s.bar.position.x = TOWER.r - 0.68 - 0.25 * this.barT;
    if (st.towerOpen && this.towerT < 1) this.towerT = Math.min(1, this.towerT + dt / 2.5);
    s.towerDoor.rotation.y = 1.7 * (this.towerT * this.towerT * (3 - 2 * this.towerT));
    s.towerDoorCol.enabled = this.towerT < 0.6;
    // Bell physics.
    this.bellV += (-this.bellSwing * 9 - this.bellV * 0.6) * dt;
    this.bellSwing += this.bellV * dt;
    s.bell.rotation.z = this.bellSwing * 0.35;
    // The castle answers: warm windows and a banner, faint through the mist.
    if (st.castleAnswered) { this.castleT = Math.min(1, this.castleT + dt / 6); this.bannerT = Math.min(1, this.bannerT + dt / 9); }
    s.castleLight.value = this.castleT;
    s.banner.scale.y = Math.max(0.01, this.bannerT);
    s.banner.position.y = 61 + 3 - 3 * this.bannerT;
    this.nav.gateOpen = this.gateT > 0.85; this.nav.chapelOpen = this.chapelT > 0.7; this.nav.towerOpen = this.towerT > 0.6;
    const it = this.findFor(active);
    this.prompt = it ? it.label : null;
  }

  interact(c: Character) {
    const it = this.findFor(c);
    if (it) it.run(c);
  }

  onPlate(c: Character) {
    const p = c.kind === 'knight' ? HEAVY_PLATE : SMALL_PLATE;
    return Math.hypot(c.body.pos.x - p.x, c.body.pos.z - p.z) < p.r;
  }
}

function faceTo(c: Character, p: THREE.Vector3) {
  c.body.yaw = Math.atan2(p.x - c.body.pos.x, p.z - c.body.pos.z);
  c.body.prevYaw = c.body.yaw;
}
