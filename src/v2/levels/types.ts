// What a level gives the engine (src/v2/main.ts): its weather, the shape of the moor round it, its pieces, and,
// for story levels, a director that takes over once the characters exist (cutscenes, triggers, effects).
import type * as THREE from 'three/webgpu';
import type { WeatherId } from '../../world/weather';
import type { Physics } from '../physics';
import type { LevelBuilder } from '../level';
import type { LevelInfo, Game, Avatar } from '../game';
import type { Timeline } from '../timeline';
import type { Hud } from '../../ui/hud';
import type { Soundscape } from '../../audio/audio';
import type { Kitten } from '../../chars/kitten';
import type { Knight } from '../../chars/knight';

export type StoryContext = {
  game: Game; timeline: Timeline; hud: Hud; audio: Soundscape; scene: THREE.Scene; physics: Physics;
  camera: THREE.PerspectiveCamera; renderer: THREE.WebGPURenderer; sun: THREE.DirectionalLight;
  kitten: Kitten; knight: Knight; avatars: { kitten: Avatar; knight: Avatar };
  touch: () => boolean;
  restart: () => void;
  // Renames (or, with null, hides) an on-screen button.
  padLabel: (code: string, text: string | null) => void;
};

export type LevelModule = {
  weather?: WeatherId;
  prepareField(): void;
  build(physics: Physics, lv: LevelBuilder, scene: THREE.Scene): Promise<LevelInfo>;
  // After the characters and the game exist (story setup).
  start?(c: StoryContext): Promise<void> | void;
  // When the player leaves the title (the opening).
  begin?(c: StoryContext): void;
  // Every rendered frame.
  update?(dt: number, t: number, c: StoryContext): void;
  // She called (the call button): 'meow', 'mew' or 'mrrp'.
  call?(c: StoryContext, kind: string): void;
};
