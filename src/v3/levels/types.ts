// What a level gives the engine (v3) and what the engine gives a level.
import type * as THREE from 'three';
import type { Physics } from '../physics';
import type { Game, LevelInfo } from '../game';
import type { Timeline } from '../timeline';
import type { Hud } from '../ui/hud';
import type { Soundscape } from '../audio';
import type { Look } from '../render/look';
import type { Terrain } from '../world/terrain';
import type { ToyKitten } from '../chars/kitten';
import type { ToyKnight } from '../chars/knight';
import type { Quality } from '../main';

export type Ctx = {
  scene: THREE.Scene;
  root: THREE.Group; // the level's own objects (removed when it unloads)
  physics: Physics;
  look: Look;
  quality: Quality;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  hud: Hud;
  audio: Soundscape;
  time: number;
  kitten: ToyKitten;
  knight: ToyKnight;
  // Set once the level is built and the characters placed.
  game: Game;
  timeline: Timeline;
  touch: () => boolean;
  // Load another level (a chapter's end); `card` shows over black between them.
  next: (id: string) => void;
  // Save a checkpoint in this level (restored by "Restart from checkpoint").
  checkpoint: (name: string) => void;
  // Label (or hide) an on-screen button by key code.
  padLabel: (code: string, text: string | null) => void;
  setTerrain: (t: Terrain, grass: { root: string; mid: string; tip: string; dry: string; height: number }) => void;
};

export type Level = {
  id: string;
  title: string; // menu name
  look: string; // LOOKS key
  build(c: Ctx): Promise<LevelInfo>;
  // After the characters are placed (story setup). `checkpoint` is the saved checkpoint, if resuming.
  start?(c: Ctx, checkpoint: string | null): void;
  // When the player presses Play (the opening).
  begin?(c: Ctx): void;
  update?(dt: number, c: Ctx): void;
  // The call button (her meow).
  call?(c: Ctx, kind: string): void;
  hint?(c: Ctx): void;
  dispose?(): void;
  // Camera views drawn once while loading so their shaders compile ahead.
  warmViews?(): { pos: [number, number, number]; look: [number, number, number] }[];
};
