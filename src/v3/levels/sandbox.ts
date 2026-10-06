// A test field (?level=sandbox): rolling meadow, a path, stairs, an ivy wall, a pond, a crate, a lift.
import * as THREE from 'three';
import type { Level, Ctx } from './types';
import { Terrain } from '../world/terrain';
import { Water } from '../world/water';
import { Kit, pingPong } from '../world/kit';
import { WATER } from '../motor';
import { PAL, col } from '../render/materials';
import { Simplex2 } from '../../world/noise';

const n1 = new Simplex2(5), n2 = new Simplex2(9);
const water = new Water();

export const sandbox: Level = {
  id: 'sandbox', title: 'Test field', look: 'morning',
  async build(c: Ctx) {
    water.pools.length = 0;
    water.add({ x: 10, z: -8, rx: 5, rz: 3.5, rot: 0.4, level: -0.25, depth: 1.4 });
    const height = (x: number, z: number) => water.carve(1.2 * n1.fbm(x / 40, z / 40, 3) + 0.25 * n2.fbm(x / 9, z / 9, 2) + Math.max(0, Math.hypot(x, z) - 60) * 0.25, x, z);
    const path = (x: number, z: number) => Math.abs(x - Math.sin(z * 0.08) * 3);
    const t = new Terrain({
      cx: 0, cz: 0, half: 90, step: 1.5, height,
      color: (x, z, h, slope) => {
        const g = col(PAL.grass).lerp(col(PAL.grassDark), THREE.MathUtils.clamp(0.5 + n2.noise(x / 14, z / 14) * 0.6, 0, 1));
        g.lerp(col(PAL.path), 1 - THREE.MathUtils.smoothstep(path(x, z), 0.7, 1.5));
        g.lerp(col(PAL.mud), THREE.MathUtils.clamp(slope * 1.5 - 0.4, 0, 1));
        if (h < -0.15) g.lerp(col(PAL.mud), 0.7);
        return g;
      },
      grass: (x, z, h, slope) => (h < -0.2 ? 0 : 1) * THREE.MathUtils.smoothstep(path(x, z), 1.2, 2.2) * (1 - THREE.MathUtils.clamp(slope - 0.6, 0, 1)),
    });
    c.setTerrain(t, { root: '#2f5f2c', mid: PAL.grass, tip: PAL.grassTip, dry: PAL.dryGrass, height: 0.22 });
    const p = c.look.preset;
    c.root.add(water.build((x, z) => t.heightAt(x, z), { sunDir: c.look.sunDir, sun: new THREE.Color(p.sun).multiplyScalar(p.sunIntensity * 0.4), sky: new THREE.Color(p.hemiSky), horizon: new THREE.Color(p.horizon) }));
    WATER.surface = (x, z) => water.surfaceAt(x, z);
    const kit = new Kit(c.physics);
    c.root.add(kit.root);
    const H = (x: number, z: number) => t.heightAt(x, z);
    kit.stairs([-6, H(-6, -4), -4], 6, 0.18, 0.32, 2, Math.PI, { stone: 0.3 });
    kit.box([-6, H(-6, -6.5) - 0.2, -6.9], [2.4, 0.2 + 1.08 + 0.2, 1.8], 0, { stone: 0.4 });
    kit.ivyWall([0, H(0, -8) - 0.2, -8], [4, 2.6, 1], 0, {});
    kit.crate([3, H(3, 2), 2], 0.9, 2);
    kit.moverBox([1.6, 0.2, 1.6], (tt, pos, q) => { pos.set(-12, H(-12, 0) + 0.1 + 2 * pingPong(tt, 8, 0.3), 0); q.identity(); }, { color: PAL.wood });
    return { killY: -30, killZones: [], spawn: { kitten: { pos: new THREE.Vector3(0.6, H(0.6, 4), 4), yaw: Math.PI }, knight: { pos: new THREE.Vector3(-0.6, H(-0.6, 4.3), 4.3), yaw: Math.PI } } };
  },
  update(dt, c) {
    const kb = c.game.kitten.char.body, nb = c.game.knight.char.body;
    water.update(dt, [{ key: kb, pos: kb.pos, speed: Math.hypot(kb.vel.x, kb.vel.z), size: 0.7 }, { key: nb, pos: nb.pos.clone().setY(nb.pos.y + 0.9), speed: Math.hypot(nb.vel.x, nb.vel.z), size: 1.3 }]);
  },
};
