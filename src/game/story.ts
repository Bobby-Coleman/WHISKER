// The story: a short arc across the moor, told in chapter cards, a few lines at a time and brief camera moments,
// never long cutscenes. The kitten is the last of the moor's watch; the knight has come from the castle with its seal
// to call the watch home before the marsh rises. She does not trust him at first: she keeps her distance and will not
// let him pick her up. Each thing they get through together closes the gap a little.
//
//   Prologue  The Last Watch    who they are, why they go
//   I         The Sheepfold     she lets the stranger in (culvert and winch)
//   II        The Chapel        it opens to two (two weights); eight empty pegs and one small shield
//   III       The Bell          she lets him lift her (window, rope, bar); the castle answers
//   IV        The Causeway      the drowned road and the sluice (pin, wheel, beam, snag)
//   V         The Warden's Gate he holds the portcullis while she runs under (strength, then size)
//   Ending    the watch is in
import * as THREE from 'three/webgpu';
import type { Hud } from '../ui/hud';
import type { CameraRig } from './camera';
import type { Puzzles } from './puzzles';
import type { Weather, WeatherId } from '../world/weather';
import type { Causeway } from '../world/causeway';
import { GAME } from '../render/settings';
import { SPAWN, TOWER, MARSH, CAUSEWAY, SLUICE, GATEHOUSE, GATE, YARD, heightAt } from '../world/layout';

type PState = Puzzles['state'];
type Chapter = {
  num: string; title: string; line: string; objective: string;
  weather?: WeatherId;
  // Hints for where the pair is in this chapter, most basic first.
  hints: (s: PState) => string[];
  done: (s: PState) => boolean;
  // Where a reset (R) puts the pair once this chapter has begun.
  checkpoint: () => { kitten: THREE.Vector3; knight: THREE.Vector3; yaw: number };
};

const at = (x: number, z: number, dx = 0) => new THREE.Vector3(x + dx, heightAt(x + dx, z), z);

const CHAPTERS: Chapter[] = [
  {
    num: 'I', title: 'The Sheepfold', line: 'The road to the castle runs through the old fold. Its gate is down.',
    objective: 'Get both of you through the sheepfold gate',
    hints: () => [
      'The gate is raised from inside the yard. Something small might find another way in.',
      'There is a drain under the yard wall, east of the gate. Only the kitten fits. Or she can climb the ivy beside it.',
      'Inside, the winch handle is out of her reach. She could hang from it with all her weight.',
    ],
    done: (s) => s.gateOpen,
    checkpoint: () => ({ kitten: at(SPAWN.kitten.x, SPAWN.kitten.z), knight: at(SPAWN.knight.x, SPAWN.knight.z), yaw: SPAWN.kitten.yaw }),
  },
  {
    num: 'II', title: 'The Chapel', line: 'The chapel of the watch. Its door answers to two.',
    objective: 'Open the chapel',
    hints: (s) => s.chapelOpen ? ['Something is waiting inside the chapel.'] : [
      'Two stones are set in the yard: one for something heavy, one for something light.',
      'The light stone lies in the gap behind the chapel wall. Only the kitten fits there.',
      'Leave one on its stone (Q: wait), then take the other to theirs (Tab: switch).',
    ],
    done: (s) => s.shieldTaken,
    checkpoint: () => ({ kitten: at(GATE.x + 0.6, YARD.maxZ - 2.5), knight: at(GATE.x - 0.6, YARD.maxZ - 2.5), yaw: Math.PI }),
  },
  {
    num: 'III', title: 'The Bell', line: 'The watch-tower bell tells the castle who is coming.',
    objective: 'Ring the bell in the watch-tower', weather: 'haze',
    hints: (s) => s.bellRung ? ['Down at the foot of the tower, the door bar. She can lift it.'] : [
      'The tower door is barred from inside, and its window is high.',
      'She trusts him now. The knight can lift the kitten and set her on the window ledge.',
      'Inside, the bell rope hangs in the dark. Her weight might be enough to ring it.',
    ],
    done: (s) => s.castleAnswered,
    checkpoint: () => ({ kitten: at(TOWER.x + TOWER.r + 2.4, TOWER.z + 0.6), knight: at(TOWER.x + TOWER.r + 2.4, TOWER.z - 0.6), yaw: -Math.PI / 2 }),
  },
  {
    num: 'IV', title: 'The Causeway', line: 'The marsh has risen over the castle road. There is a sluice on its eastern bank.',
    objective: 'Drain the marsh at the sluice', weather: 'dusk',
    hints: (s) => {
      if (s.snagCleared) return ['With the slot clear, turn the wheel again.'];
      if (s.jammed) return [
        'Something is caught in the gate slot, below the middle of the beam.',
        'The beam would never hold the knight. He can lift the kitten and set her on it.',
        'From the middle of the beam she can kick the snag loose.',
      ];
      if (s.pinOut) return ['With the pin out, the knight can turn the wheel.'];
      return [
        'The wheel beside the sluice raises its gate, if nothing holds it.',
        'A pin locks the wheel from inside the hut. Its hatch is very small.',
      ];
    },
    done: (s) => s.drained,
    checkpoint: () => ({ kitten: at(CAUSEWAY[0].x + 1.4, CAUSEWAY[0].z + 2.2), knight: at(CAUSEWAY[0].x + 2.6, CAUSEWAY[0].z + 2.6), yaw: Math.PI }),
  },
  {
    num: 'V', title: 'The Warden’s Gate', line: 'The causeway ends at the warden’s gate. No one has kept it for years.',
    objective: 'Get through the warden’s gate',
    hints: (s) => s.portHeld ? ['While he holds it, switch to the kitten (Tab). There is a lever in the bay behind the gate.'] : [
      'The portcullis is far too heavy for a kitten. Not for a knight, for a little while.',
      'He can hold it up, but not for long. Something behind the gate might keep it up for good.',
    ],
    done: (s) => s.released,
    checkpoint: () => ({ kitten: at(GATEHOUSE.x + 0.5, GATEHOUSE.z + 4.5), knight: at(GATEHOUSE.x - 0.5, GATEHOUSE.z + 5), yaw: Math.PI }),
  },
];

const PROLOGUE = [
  'This morning a knight came out of the fog with the castle’s seal.',
  'Every watch is called home before the marsh rises.',
  'She does not leave her post for strangers.',
];

const ENDING = [
  'Beyond the gate, the castle has lit the causeway.',
  'The watch is in.',
  'Behind them the moor keeps its fog, and eight empty pegs.',
];

const CREDITS = `
<b>Made with</b>three.js (MIT) &middot; WebGPU and TSL node materials
<b>Skies and scanned surfaces</b>Poly Haven (CC0): Kloofendal Misty Morning, Misty Farm Road, Kloppenheim 01 skies;
leafy grass, brown mud, castle walls, mossy rock, weathered planks and roof slates by the Poly Haven team
<b>Type</b>Cormorant Garamond (SIL Open Font License)
<b>Tools</b>Blender (GPL) for the kitten's sculpt, groom and armour; sharp (Apache-2.0) for asset processing
<b>Thanks</b>to the reference clip of a kitten in plate on a misty moor, which started all of this`;

type Line = { text: string; dur: number };

export class Story {
  chapter = -1; // -1 before the prologue, 0..4 chapters I..V, 5 ending
  trust = 0;
  started = false;
  ended = false;
  private queue: Line[] = [];
  private lineT = 0;
  private pendingT = -1; // countdown to the next chapter's card
  private idleT = 0; // seconds since the last progress in this chapter
  private hintIdx = 0; private hintKey = '';
  private lanternT = 0; private lanternWant = 0;
  private endT = -1;

  constructor(private hud: Hud, private rig: CameraRig, private puzzles: Puzzles, private weather: Weather | null, private scene: THREE.Scene,
    private cw: Causeway | null, private placePair: (k: THREE.Vector3, n: THREE.Vector3, yaw: number) => void) {
    this.applyTrust();
  }

  // Feedback from play (a door giving, a refusal) shows at once; narration waiting in the queue resumes after it.
  feedback(text: string, dur = 4.5) {
    this.hud.say(text, dur);
    this.lineT = Math.max(this.lineT, dur * 0.85);
  }

  // Lines go out one after another, each long enough to read.
  say(text: string, dur = 4.5) {
    if (this.queue.length === 0 && this.lineT <= 0) { this.hud.say(text, dur); this.lineT = dur * 0.85; return; }
    this.queue.push({ text, dur });
  }

  // After the opening shot.
  begin(controlsLine: string) {
    if (this.started) return;
    this.started = true;
    this.hud.card('Prologue', 'The Last Watch', 'The moor kept a watch of nine knights once. Now it keeps one, and she is very small.', 7);
    this.lineT = 7.5;
    for (const l of PROLOGUE) this.queue.push({ text: l, dur: 4.6 });
    this.queue.push({ text: controlsLine, dur: 5 });
    this.pendingT = 7.5 + PROLOGUE.length * 3.9 + 4.5;
  }

  private startChapter(i: number) {
    this.chapter = i;
    const c = CHAPTERS[i];
    this.hud.card(c.num, c.title, c.line, 6.5);
    this.hud.objective(c.objective);
    this.idleT = 0; this.hintIdx = 0; this.hintKey = '';
    if (c.weather && this.weather) this.weather.change(c.weather, 16);
    // A look at what lies ahead where it is out of sight: the drowned causeway, then the gatehouse.
    if (i === 3) this.rig.playMoment(() => at(CAUSEWAY[0].x + 3, CAUSEWAY[0].z + 4).add(new THREE.Vector3(0, 2.6, 0)), () => at(CAUSEWAY[2].x, CAUSEWAY[2].z).add(new THREE.Vector3(0, 1.5, 0)), 6.5, 45, 0.1);
    if (i === 4) this.rig.playMoment(() => at(GATEHOUSE.x + 4, GATEHOUSE.z + 9).add(new THREE.Vector3(0, 2.2, 0)), () => at(GATEHOUSE.x, GATEHOUSE.z).add(new THREE.Vector3(0, 2, 0)), 5.5, 40, 0.1);
  }

  private complete(i: number) {
    this.trust = Math.min(4, this.trust + 1);
    this.applyTrust();
    this.hud.objective(null);
    if (i === 0) this.say('She lets the stranger in.');
    if (i === 1) { this.say('Eight pegs, empty.', 3.4); this.say('One shield, small enough.', 4); }
    if (i === 2) this.say('The castle knows they are coming.');
    if (i === 3) this.say('The marsh lets go of the road.', 5);
    if (i < CHAPTERS.length - 1) this.pendingT = i === 3 ? 12 : 6;
  }

  // Trust: how close the kitten keeps to the knight, and whether she will let him lift her.
  private applyTrust() {
    GAME.followGap.kitten = 2.6 - this.trust * 0.35;
    this.puzzles.liftAllowed = this.trust >= 2;
  }

  // The next hint for wherever the pair is in this chapter.
  hint() {
    if (this.chapter < 0 || this.chapter >= CHAPTERS.length) return;
    const list = CHAPTERS[this.chapter].hints(this.puzzles.state);
    const key = list.join('|');
    if (key !== this.hintKey) { this.hintKey = key; this.hintIdx = 0; }
    const text = list[Math.min(this.hintIdx, list.length - 1)];
    this.hintIdx = Math.min(this.hintIdx + 1, list.length - 1);
    this.queue.length = 0; this.lineT = 0;
    this.say(text, 6);
    this.idleT = 0;
  }

  // Reset (R): back to where the current chapter began.
  checkpoint() {
    const i = Math.max(0, Math.min(CHAPTERS.length - 1, this.chapter));
    const c = CHAPTERS[i].checkpoint();
    this.placePair(c.kitten, c.knight, c.yaw);
  }

  // Review aid: jump to the start of a chapter with everything before it done.
  jump(i: number) {
    const s = this.puzzles.state;
    const done = (n: number) => i > n;
    if (done(0)) { s.gateOpen = true; this.puzzles.gateT = 1; }
    if (done(1)) { s.chapelOpen = true; s.shieldTaken = true; this.puzzles.chapelT = 1; }
    if (done(2)) { s.towerOpen = true; s.bellRung = true; s.castleAnswered = true; this.puzzles.towerT = 1; this.puzzles.barT = 1; }
    if (done(3)) { s.pinOut = true; s.jammed = true; s.snagCleared = true; s.drained = true; this.puzzles.drainT = 1; this.puzzles.boardLift = 1.15; if (this.cw) this.cw.snag.visible = false; }
    this.started = true;
    this.trust = Math.min(4, i);
    this.applyTrust();
    this.queue.length = 0; this.lineT = 0; this.pendingT = -1;
    this.startChapter(Math.min(i, CHAPTERS.length - 1));
    this.rig.moment = null;
    this.checkpoint();
  }

  update(dt: number, playing: boolean) {
    // Lines.
    this.lineT -= dt;
    if (this.lineT <= 0 && this.queue.length) { const l = this.queue.shift()!; this.hud.say(l.text, l.dur); this.lineT = l.dur * 0.85; }
    // Lanterns along the far causeway come up once the castle has answered.
    if (this.cw) {
      this.lanternT += (this.lanternWant - this.lanternT) * Math.min(1, dt * 0.4);
      this.cw.lanternLight.value = this.lanternT;
      this.cw.gateLamp.intensity = this.lanternT * 0.7;
    }
    // Events from the puzzles.
    for (const e of this.puzzles.events) this.onEvent(e);
    this.puzzles.events.length = 0;
    if (!this.started || this.ended) return;
    // Next chapter's card, after a pause for the last one to land.
    if (this.pendingT > 0) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) this.startChapter(this.chapter + 1);
      return;
    }
    const c = CHAPTERS[this.chapter];
    if (!c) return;
    if (c.done(this.puzzles.state)) { this.complete(this.chapter); return; }
    // A gentle hint when the pair has been stuck a long while; the player can always ask (G).
    if (playing) this.idleT += dt;
    if (this.idleT > 95) this.hint();
    // The ending: both through the warden's gate.
    void this.endT;
  }

  private onEvent(e: string) {
    this.idleT = 0;
    const s = this.puzzles.state;
    switch (e) {
      case 'chapelOpen': this.say('It opens to two.'); break;
      case 'answered': this.lanternWant = 1; break;
      case 'drain':
        // The marsh runs out through the sluice: a slow look across it as the causeway comes up out of the water.
        // Low along the causeway, so the stones come up out of the water toward the camera.
        this.rig.playMoment(() => at(CAUSEWAY[0].x + 2.2, CAUSEWAY[0].z - 1.5).add(new THREE.Vector3(0, 1.3, 0)), () => at(CAUSEWAY[1].x, CAUSEWAY[1].z).add(new THREE.Vector3(0, 0.2, 0)), 10, 38, 0.06);
        void SLUICE;
        break;
      case 'portHeld': if (this.chapter === 4) this.say('Quick. Switch to the kitten (Tab).', 4); break;
      case 'portDropped': if (!s.released) this.say('He can lift it again.', 3.5); break;
      case 'released': this.rig.playMoment(() => at(GATEHOUSE.x - 3.5, GATEHOUSE.z + 6).add(new THREE.Vector3(0, 1.8, 0)), () => at(GATEHOUSE.x, GATEHOUSE.z).add(new THREE.Vector3(0, 2.2, 0)), 5, 38, 0.1); break;
      case 'castle': this.ending(); break;
    }
  }

  private ending() {
    if (this.ended) return;
    this.ended = true;
    this.chapter = CHAPTERS.length;
    this.hud.objective(null);
    this.lanternWant = 1;
    this.queue.length = 0; this.lineT = 0;
    // A last look down the lit causeway toward the castle, the pair small in the frame.
    const end = at(CAUSEWAY[3].x, CAUSEWAY[3].z);
    this.rig.playMoment(() => at(GATEHOUSE.x + 1.2, GATEHOUSE.innerZ + 1.5).add(new THREE.Vector3(0, 1.6, 0)), () => end.clone().add(new THREE.Vector3(0, 1.2, -6)), 14, 35, 0.05);
    for (const l of ENDING) this.queue.push({ text: l, dur: 4.4 });
    setTimeout(() => this.hud.credits(['The watch is in.'], CREDITS, () => { this.hud.objective(null); }), 15000);
    void MARSH;
  }
}
