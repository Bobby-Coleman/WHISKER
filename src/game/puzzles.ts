// Three small scale-based puzzles in FIELD_01:
// 1. The culvert and the winch: only the kitten fits under the wall; it hangs on the winch to raise the gate.
// 2. Two weights: the knight's weight on the flagstone and the kitten on the stone in the crawl space open the chapel.
// 3. The bell tower: the knight lifts the kitten to the window; it rides the bell rope down and lifts the door bar.
// And on the marsh (chapters IV and V):
// 4. The sluice: the kitten slips through the hut's hatch and pulls the pin; the knight turns the wheel until the gate
//    jams; the kitten walks the beam (it will not hold him) and kicks the snag loose; the wheel turns, the marsh drains.
// 5. The warden's gate: the knight heaves the portcullis up and holds it while the kitten runs under and pulls the
//    counterweight release behind it.
import * as THREE from 'three/webgpu';
import { Character } from '../chars/character';
import { Kitten } from '../chars/kitten';
import { Knight } from '../chars/knight';
import { Structures } from '../world/structures';
import { PhysicsWorld } from './physics';
import { HEAVY_PLATE, SMALL_PLATE, TOWER, CHAPEL, MARSH, SLUICE, GATEHOUSE } from '../world/layout';
import { regionOf, NavState } from './nav';
import { MASK } from './physics';
import type { Causeway } from '../world/causeway';

type Interactable = { id: string; label: string; who: 'kitten' | 'knight'; pos: () => THREE.Vector3; range: number; available: (c: Character) => boolean; run: (c: Character) => void };

export class Puzzles {
  state = {
    gateOpen: false, chapelOpen: false, towerOpen: false, shieldTaken: false, bellRung: false, castleAnswered: false, heavy: false, small: false,
    pinOut: false, jammed: false, snagCleared: false, drained: false, portHeld: false, released: false, castleReached: false,
  };
  // Story events since the last frame (consumed by the story director).
  events: string[] = [];
  // The kitten lets the knight pick her up once she trusts him (set by the story).
  liftAllowed = true;
  boardLift = 0; drainT = 0; portLift = 0; private wheelBusy = false;
  gateT = 0; chapelT = 0; towerT = 0; barT = 0; leverT = 0; bellSwing = 0; bellV = 0; castleT = 0; bannerT = 0;
  busy = new Set<Character>();
  private seqs: Generator<any, void, number>[] = [];
  private said = new Set<string>();
  items: Interactable[];
  prompt: string | null = null;
  nav: NavState;

  constructor(private s: Structures, private physics: PhysicsWorld, private kitten: Kitten, private knight: Knight,
    private say: (t: string) => void, private sfx: (name: string, pos?: THREE.Vector3, gain?: number) => void, private cw: Causeway | null = null) {
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
          this.events.push('shield');
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
        run: () => {
          if (!this.liftAllowed) { this.say('The kitten steps out of reach. Not yet.'); this.sfx('clank', this.kitten.body.pos, 0.12); return; }
          this.start(this.liftSeq());
        },
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
    if (cw) this.addMarsh(cw);
  }

  // ---- The marsh: sluice (IV) and warden's gate (V).
  private beamTop = 0;
  private addMarsh(cw: Causeway) {
    const V = () => new THREE.Vector3();
    const gz1 = SLUICE.z + SLUICE.chanHalf;
    // The beam over the sluice gate: a kitten can walk it; it will not hold a knight in plate.
    this.beamTop = cw.beamY + 0.14;
    this.physics.platforms.push({ id: 'beam', kind: 'box', x: SLUICE.x + 0.18, z: SLUICE.z, hx: 0.11, hz: SLUICE.chanHalf + 0.65, rot: 0, top: this.beamTop, mask: MASK.kitten });
    const onBeam = (c: Character) => c.body.pos.y > this.beamTop - 0.05 && Math.abs(c.body.pos.x - (SLUICE.x + 0.18)) < 0.2 && Math.abs(c.body.pos.z - SLUICE.z) < SLUICE.chanHalf + 0.7;
    const wheelStand = () => new THREE.Vector3(SLUICE.x + 0.45 + 0.75, cw.bankY, gz1 + 0.35);
    const G = GATEHOUSE;
    const portFront = () => new THREE.Vector3(G.x, cw.gY, G.z + 0.55);
    this.items.push(
      {
        id: 'pin', label: 'Pull the pin', who: 'kitten', range: 0.8, pos: () => cw.pinLever.getWorldPosition(V()),
        available: (c) => !this.state.pinOut && regionOf(c.body.pos) === 'hut', run: (c) => this.start(this.pinSeq(c as Kitten, cw)),
      },
      {
        id: 'wheel', label: 'Turn the wheel', who: 'knight', range: 1.5, pos: wheelStand,
        available: () => !this.state.drained && !this.wheelBusy && !this.knight.holding, run: () => this.start(this.wheelSeq(cw, wheelStand)),
      },
      {
        id: 'snag', label: 'Kick the snag loose', who: 'kitten', range: 0.75, pos: () => new THREE.Vector3(SLUICE.x + 0.18, this.beamTop, SLUICE.z),
        available: (c) => !this.state.snagCleared && onBeam(c), run: (c) => this.start(this.snagSeq(c as Kitten, cw)),
      },
      {
        id: 'placeBeam', label: 'Set the kitten on the beam', who: 'knight', range: 1.8, pos: () => new THREE.Vector3(SLUICE.x + 0.18, cw.bankY, gz1 + 0.9),
        available: () => !!this.knight.holding && !this.state.snagCleared, run: () => this.start(this.placeSeq(false, new THREE.Vector3(SLUICE.x + 0.18, this.beamTop, gz1 + 0.35))),
      },
      {
        id: 'liftPort', label: 'Lift the portcullis', who: 'knight', range: 1.4, pos: portFront,
        available: () => !this.state.released && !this.state.portHeld && !this.knight.holding && regionOf(this.knight.body.pos) !== 'gateBay', run: () => this.start(this.portSeq(cw, portFront)),
      },
      {
        id: 'release', label: 'Pull the counterweight release', who: 'kitten', range: 0.85, pos: () => cw.releaseLever.getWorldPosition(V()),
        available: (c) => !this.state.released && regionOf(c.body.pos) === 'gateBay', run: (c) => this.start(this.releaseSeq(c as Kitten, cw)),
      },
      {
        id: 'portKitten', label: 'Push at the portcullis', who: 'kitten', range: 1.0, pos: portFront,
        available: () => !this.state.released && !this.state.portHeld && regionOf(this.kitten.body.pos) !== 'gateBay',
        run: () => { this.sfx('clank', portFront(), 0.2); this.say('The portcullis does not notice the kitten.'); },
      },
    );
  }

  private *pinSeq(k: Kitten, cw: Causeway): Generator<any, void, number> {
    this.busy.add(k);
    const knob = cw.pinLever.localToWorld(new THREE.Vector3(0, 0.33, 0));
    faceTo(k, knob);
    k.hangTarget.copy(knob);
    let t = 0;
    while (t < 0.5) { t += yield; k.hangPose = Math.min(1, t / 0.5); }
    this.sfx('creak', knob, 0.4);
    t = 0;
    const y0 = k.body.pos.y;
    while (t < 1.2) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 1.2);
      cw.pinLever.rotation.z = 0.5 - 1.15 * a * a;
      k.hangTarget.copy(cw.pinLever.localToWorld(new THREE.Vector3(0, 0.33, 0)));
      k.body.prevPos.y = k.body.pos.y; k.body.pos.y = y0 + Math.sin(Math.PI * a) * 0.06;
    }
    k.body.pos.y = y0;
    this.state.pinOut = true;
    this.sfx('clank', knob, 0.7);
    this.events.push('pinOut');
    t = 0;
    while (t < 0.4) { t += yield; k.hangPose = 1 - t / 0.4; }
    k.hangPose = 0;
    this.busy.delete(k);
    this.say('Under the hut, the pin drops free.');
  }

  // The knight takes the wheel by two handles and turns it; the gate board in the slot rises with it.
  private *wheelSeq(cw: Causeway, stand: () => THREE.Vector3): Generator<any, void, number> {
    const n = this.knight;
    this.busy.add(n); this.wheelBusy = true;
    const wheelPos = cw.wheel.getWorldPosition(new THREE.Vector3());
    const from = n.body.pos.clone(), to = stand();
    to.y = this.physics.groundAt(to.x, to.z, from.y + 0.4);
    let t = 0;
    while (t < 0.6) {
      const dt = yield; t += dt;
      const a = Math.min(1, t / 0.6);
      n.body.prevPos.copy(n.body.pos); n.body.pos.lerpVectors(from, to, a * a * (3 - 2 * a));
      faceTo(n, wheelPos);
    }
    const handles = () => {
      const r = cw.wheel.rotation.z;
      return [
        cw.wheel.localToWorld(new THREE.Vector3(Math.cos(r + 2.3) * 0.46, Math.sin(r + 2.3) * 0.46, 0.08)),
        cw.wheel.localToWorld(new THREE.Vector3(Math.cos(r + 0.8) * 0.46, Math.sin(r + 0.8) * 0.46, 0.08)),
      ];
    };
    n.reachWant = 1;
    const grip = () => { const [a, b] = handles(); n.reachL.copy(a); n.reachR.copy(b); };
    grip();
    t = 0;
    while (t < 0.6) { t += yield; grip(); }
    if (!this.state.pinOut) {
      // Pinned: he strains; the wheel rocks a hair and stops.
      this.sfx('thud', wheelPos, 0.7);
      const r0 = cw.wheel.rotation.z;
      t = 0;
      while (t < 1.6) { const dt = yield; t += dt; cw.wheel.rotation.z = r0 + Math.sin(t * 14) * 0.012 * (1 - t / 1.6); grip(); }
      cw.wheel.rotation.z = r0;
      this.say('The wheel will not turn. Something pins its axle, inside the hut.');
      this.events.push('wheelPinned');
    } else if (!this.state.snagCleared) {
      // Free, but the gate jams a hand's breadth up on whatever is caught in the slot.
      this.sfx('creak', wheelPos, 0.8);
      const r0 = cw.wheel.rotation.z, b0 = this.boardLift;
      t = 0;
      while (t < 2.2) { const dt = yield; t += dt; const a = Math.min(1, t / 2.2); cw.wheel.rotation.z = r0 - 1.3 * a; this.boardLift = b0 + (0.2 - b0) * a; grip(); }
      this.sfx('thud', cw.gateBoard.position, 1.0);
      t = 0;
      while (t < 0.5) { const dt = yield; t += dt; cw.wheel.rotation.z = r0 - 1.3 + Math.sin(t * 30) * 0.02 * (1 - t / 0.5); grip(); }
      if (!this.state.jammed) { this.state.jammed = true; this.events.push('jammed'); }
      this.say('A hand\'s breadth up, the gate jams on something caught below the beam.');
    } else {
      // Free and clear: the gate comes up out of the slot and the marsh starts to run.
      this.sfx('gate', cw.gateBoard.position, 1.0);
      const r0 = cw.wheel.rotation.z, b0 = this.boardLift;
      t = 0;
      while (t < 4.2) {
        const dt = yield; t += dt; const a = Math.min(1, t / 4.2); const e = a * a * (3 - 2 * a);
        cw.wheel.rotation.z = r0 - 6.0 * e; this.boardLift = b0 + (1.15 - b0) * e; grip();
        if (a > 0.35 && !this.state.drained) { this.state.drained = true; this.events.push('drain'); }
      }
    }
    n.reachWant = 0;
    t = 0;
    while (t < 0.4) t += yield;
    this.busy.delete(n); this.wheelBusy = false;
  }

  private *snagSeq(k: Kitten, cw: Causeway): Generator<any, void, number> {
    this.busy.add(k);
    const sp = cw.snag.getWorldPosition(new THREE.Vector3());
    faceTo(k, new THREE.Vector3(sp.x - 1, sp.y, sp.z));
    k.hangTarget.set(k.body.pos.x - 0.06, k.body.pos.y - 0.05, k.body.pos.z);
    let t = 0;
    while (t < 0.45) { t += yield; k.hangPose = Math.min(1, t / 0.45) * 0.7; }
    // Three stamps on the branch's crook, then it tears loose.
    for (let i = 0; i < 3; i++) {
      t = 0;
      while (t < 0.32) { const dt = yield; t += dt; k.body.prevPos.y = k.body.pos.y; k.body.pos.y = this.beamTop + Math.sin(Math.PI * Math.min(1, t / 0.32)) * 0.05; }
      this.sfx('thud', sp, 0.35 + i * 0.15);
      cw.snag.rotation.z += 0.05;
    }
    k.body.pos.y = this.beamTop;
    const p0 = cw.snag.position.clone();
    this.state.snagCleared = true;
    this.events.push('snag');
    this.sfx('splash', sp, 0.9);
    t = 0;
    while (t < 1.4) {
      const dt = yield; t += dt; const a = Math.min(1, t / 1.4);
      cw.snag.position.set(p0.x + a * 1.6, p0.y - a * a * 0.9, p0.z + a * 0.3);
      cw.snag.rotation.x += dt * 1.2;
      if (a > 0.3) k.hangPose = Math.max(0, 0.7 - (a - 0.3) * 2);
    }
    cw.snag.visible = false;
    k.hangPose = 0;
    this.busy.delete(k);
    this.say('The branch tears loose, and the current takes it under.');
  }

  // The knight heaves the portcullis up and holds it; the kitten has until his arms give out.
  private *portSeq(cw: Causeway, front: () => THREE.Vector3): Generator<any, void, number> {
    const n = this.knight, G = GATEHOUSE;
    this.busy.add(n);
    const from = n.body.pos.clone(), to = front();
    to.y = this.physics.groundAt(to.x, to.z, from.y + 0.4);
    const bar = (lift: number) => new THREE.Vector3(G.x, cw.gY + 1.0 + lift * 0.62, G.z + 0.04);
    let t = 0;
    while (t < 0.6) {
      const dt = yield; t += dt; const a = Math.min(1, t / 0.6);
      n.body.prevPos.copy(n.body.pos); n.body.pos.lerpVectors(from, to, a * a * (3 - 2 * a));
      faceTo(n, new THREE.Vector3(G.x, to.y, G.z - 3));
    }
    n.reachWant = 1;
    const grip = () => { const b = bar(this.portLift); n.reachL.copy(b).add(new THREE.Vector3(0.24, 0, 0)); n.reachR.copy(b).add(new THREE.Vector3(-0.24, 0, 0)); };
    grip();
    t = 0;
    while (t < 0.5) { t += yield; grip(); }
    this.sfx('creak', bar(0), 0.9);
    t = 0;
    while (t < 1.5) { const dt = yield; t += dt; const a = Math.min(1, t / 1.5); this.portLift = a * a * (3 - 2 * a); grip(); }
    this.state.portHeld = true; this.nav.portHeld = true;
    cw.portCol.mask = MASK.knight;
    this.events.push('portHeld');
    this.say('He can hold it. Not for long.');
    const HOLD = 16;
    t = 0;
    while (t < HOLD && !this.state.released) {
      const dt = yield; t += dt;
      // His arms begin to shake as the seconds go.
      const strain = Math.max(0, (t - HOLD * 0.45) / (HOLD * 0.55));
      this.portLift = 1 - strain * 0.12 + Math.sin(t * 33) * 0.012 * strain;
      grip();
      if (strain > 0.5 && !this.said.has('portStrain')) { this.said.add('portStrain'); this.sfx('thud', bar(1), 0.3); }
    }
    if (this.state.released) { this.state.portHeld = false; this.nav.portHeld = false; }
    if (!this.state.released) {
      // His arms give; the gate comes down. Whoever is under it is pushed clear to the nearer side.
      this.sfx('gate', bar(0), 0.9);
      const k = this.kitten;
      if (Math.abs(k.body.pos.z - G.z) < 0.45 && Math.abs(k.body.pos.x - G.x) < G.half) {
        const z = k.body.pos.z < G.z ? G.z - 0.55 : G.z + 0.55;
        k.body.pos.z = z; k.body.prevPos.z = z;
      }
      t = 0;
      const l0 = this.portLift;
      while (t < 0.6) { const dt = yield; t += dt; this.portLift = l0 * (1 - Math.min(1, t / 0.6)); grip(); }
      this.portLift = 0;
      this.sfx('thud', bar(0), 1.0);
      this.state.portHeld = false; this.nav.portHeld = false;
      cw.portCol.mask = MASK.all;
      this.events.push('portDropped');
      this.say('His arms give. The portcullis slams down.');
    }
    n.reachWant = 0;
    t = 0;
    while (t < 0.5) t += yield;
    this.said.delete('portStrain');
    this.busy.delete(n);
  }

  private *releaseSeq(k: Kitten, cw: Causeway): Generator<any, void, number> {
    this.busy.add(k);
    const grip = () => cw.releaseLever.localToWorld(new THREE.Vector3(0, 0, 0.37));
    faceTo(k, grip());
    k.hangTarget.copy(grip());
    let t = 0;
    while (t < 0.5) { t += yield; k.hangPose = Math.min(1, t / 0.5); }
    const y0 = k.body.pos.y;
    this.sfx('creak', grip(), 0.6);
    t = 0;
    while (t < 1.0) {
      const dt = yield; t += dt; const a = Math.min(1, t / 1.0);
      cw.releaseLever.rotation.x = -0.7 + 1.3 * a * a;
      k.hangTarget.copy(grip());
      k.body.prevPos.y = k.body.pos.y; k.body.pos.y = Math.max(y0, grip().y - 0.27);
    }
    k.body.pos.y = y0;
    this.state.released = true;
    this.nav.portOpen = true;
    this.events.push('released');
    this.sfx('gate', cw.portcullis.position, 1.0);
    t = 0;
    while (t < 0.4) { t += yield; k.hangPose = 1 - t / 0.4; }
    k.hangPose = 0;
    this.busy.delete(k);
    this.say('The counterweight drops. The portcullis climbs into the arch and stays.');
  }

  // Marsh state each frame: the sluice board, the falling water, the portcullis and its counterweight.
  private updateMarsh(dt: number, cw: Causeway) {
    const st = this.state;
    cw.gateBoard.position.y = cw.floorY - 0.1 + this.boardLift;
    if (st.drained && this.drainT < 1) this.drainT = Math.min(1, this.drainT + dt / 14);
    const e = this.drainT * this.drainT * (3 - 2 * this.drainT);
    cw.setWater(MARSH.floorY + MARSH.flood + (MARSH.drained - MARSH.flood) * e);
    // Released: the counterweight falls and the portcullis rides up into the arch for good.
    if (st.released) {
      this.counterT = Math.min(1, this.counterT + dt / 1.6);
      const c = this.counterT * this.counterT;
      cw.counter.position.y = cw.gY + 3.0 - 2.6 * c;
      this.portLift = Math.max(this.portLift, 1 + 2.9 * c);
      cw.portCol.enabled = this.portLift < 2.5;
    }
    cw.portcullis.position.y = cw.gY + this.portLift * 0.62 * (this.portLift > 1 ? 1 : 1);
    const ct = cw.counter.position, top = new THREE.Vector3(ct.x, cw.gY + 3.9, ct.z);
    cw.chain.position.set(ct.x, (top.y + ct.y + 0.3) / 2, ct.z);
    cw.chain.scale.y = Math.max(0.05, top.y - ct.y - 0.3);
    // Both through the gate and on toward the castle.
    if (st.released && !st.castleReached) {
      const past = (c: Character) => c.body.pos.z < GATEHOUSE.innerZ - 1.5;
      if (past(this.kitten) && past(this.knight)) { st.castleReached = true; this.events.push('castle'); }
    }
  }
  private counterT = 0;

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
      // Prefer what the character is facing: the portcullis before the kitten beside it.
      const facing = Math.cos(Math.atan2(p.x - c.body.pos.x, p.z - c.body.pos.z) - c.body.yaw);
      const score = d * (1.5 - 0.5 * facing);
      if (d < it.range && (score < bd || it.id === 'placeSill')) {
        if (best?.id === 'placeSill') continue;
        best = it; bd = it.id === 'setDown' ? 50 : score;
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
      if (a > 0.3 && !this.state.gateOpen) { this.state.gateOpen = true; this.events.push('gateOpen'); this.sfx('gate', this.s.gate.position, 1.0); }
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

  private *placeSeq(onSill: boolean, to?: THREE.Vector3): Generator<any, void, number> {
    const k = this.kitten, n = this.knight;
    this.busy.add(n);
    let dest: THREE.Vector3;
    if (onSill) {
      dest = new THREE.Vector3(TOWER.x, this.s.sillY, TOWER.z + TOWER.r - 0.32);
      faceTo(n, dest);
    } else if (to) {
      dest = to.clone();
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
      this.events.push('answered');
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
    this.events.push('towerOpen');
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
    if (this.cw) this.updateMarsh(dt, this.cw);
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
      this.events.push('chapelOpen');
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
