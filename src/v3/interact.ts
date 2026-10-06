// Things in a level the characters use (engine v2): levers, cranks, bars, doors (E, or Act on a phone, when one is
// near and facing it), and plates that sink under a weight. A level adds them; the game asks for the nearest usable
// one for its prompt and its button, and steps the plates.
import * as THREE from 'three';
import type { Actor } from './game';

export type Who = 'kitten' | 'knight' | 'both';

export type Usable = {
  pos: THREE.Vector3; radius: number; who: Who;
  // What the prompt says ("Turn the crank").
  text: string;
  // Usable now (a door already open is not).
  ready?: () => boolean;
  use: (a: Actor) => void;
};

// A plate pressed by weight: the knight presses any plate; the kitten only a light one.
export type Plate = {
  pos: THREE.Vector3; radius: number; heavy: boolean;
  pressed: boolean;
  onChange?: (pressed: boolean, by: Actor | null) => void;
  // The plate's top moves down when pressed (visual).
  mesh?: THREE.Object3D; travel?: number;
};

export class Interactions {
  usables: Usable[] = [];
  plates: Plate[] = [];

  add(u: Usable) { this.usables.push(u); return u; }
  plate(p: Omit<Plate, 'pressed'>) { const q = { ...p, pressed: false }; this.plates.push(q); return q; }

  // The nearest thing this character can use, if any: in reach, in front of it, ready.
  nearest(a: Actor) {
    const p = a.char.body.pos, yaw = a.char.body.yaw;
    let best: Usable | null = null, bd = Infinity;
    for (const u of this.usables) {
      if (u.who !== 'both' && u.who !== a.motor.build.kind) continue;
      if (u.ready && !u.ready()) continue;
      const dx = u.pos.x - p.x, dz = u.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > u.radius || Math.abs(u.pos.y - p.y) > (a.motor.build.kind === 'knight' ? 1.6 : 0.6)) continue;
      const fwd = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (d || 1);
      if (d > 0.35 && fwd < -0.2) continue;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // Each fixed step: plates under whoever stands on them.
  step(actors: Actor[], dt: number) {
    for (const pl of this.plates) {
      let by: Actor | null = null;
      for (const a of actors) {
        const p = a.char.body.pos;
        if (Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) > pl.radius || Math.abs(p.y - pl.pos.y) > 0.35) continue;
        if (pl.heavy && a.motor.build.kind !== 'knight') continue;
        by = a;
      }
      const now = by !== null;
      if (now !== pl.pressed) { pl.pressed = now; pl.onChange?.(now, by); }
      if (pl.mesh) {
        const want = (now ? -(pl.travel ?? 0.04) : 0);
        pl.mesh.position.y += (want - pl.mesh.position.y) * Math.min(1, dt * 10);
      }
    }
  }
}
