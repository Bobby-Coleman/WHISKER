// Weather and fire effects for story scenes (engine v2): rain falling round the camera, and campfires (logs, embers,
// a flickering warm light, flames and rising smoke). Rain streaks are placed on the GPU from their instance index,
// in a box that travels with the camera, like the moor's wind spray (world/spray.ts).
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, positionGeometry, vec3, vec4, float, hash, uint, fract, cameraPosition, normalize, cross, length,
  smoothstep, uniform, positionPrevious, uv, sin, time, mix, vec2, color,
} from 'three/tsl';
import { WIND, LOOK } from '../render/settings';

// Rain: thin streaks falling at 7-9 m/s, slanted by the wind, faded near the lens and into the fog.
export function createRain(count: number) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  geo.instanceCount = count;
  const amount = uniform(1);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.fog = false;
  const B = 14, H = 9;
  const alphaV = float(0).toVar('rainA');
  m.positionNode = Fn(() => {
    const i = uint(instanceIndex);
    const r = (k: number) => hash(i.mul(uint(7919)).add(uint(k * 1013 + 29)));
    const fallV = vec3(WIND.dir.x, 0, WIND.dir.y).mul(1.6).add(vec3(0, -8.0, 0)).mul(r(1).mul(0.25).add(0.88));
    const dir = normalize(fallV);
    const start = vec3(r(2), r(3), r(4)).mul(vec3(B, H, B));
    const rel = start.add(fallV.mul(WIND.time)).sub(cameraPosition);
    const wrapped = vec3(fract(rel.x.div(B)), fract(rel.y.div(H)), fract(rel.z.div(B))).mul(vec3(B, H, B)).sub(vec3(B / 2, H * 0.55, B / 2));
    const center = cameraPosition.add(wrapped);
    const len = float(0.22).add(r(6).mul(0.2));
    const toCam = normalize(cameraPosition.sub(center));
    const side = normalize(cross(dir, toCam));
    const p = center.add(dir.mul(positionGeometry.y.sub(0.5).mul(len))).add(side.mul(positionGeometry.x.mul(0.0035)));
    positionPrevious.assign(p);
    const d = length(center.sub(cameraPosition));
    alphaV.assign(smoothstep(0.5, 1.6, d).mul(float(1).sub(smoothstep(6.0, 7.5, d))).mul(r(7).mul(0.5).add(0.5)));
    return p;
  })();
  const tip = positionGeometry.y;
  const a = alphaV.toVarying('vRainA').mul(smoothstep(0.0, 0.3, tip).mul(float(1).sub(smoothstep(0.7, 1.0, tip))));
  m.colorNode = vec4(LOOK.fogColor.mul(1.25), a.mul(0.22).mul(amount).mul(LOOK.fogEnabled));
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'Rain';
  return { mesh, amount };
}

// A campfire burning low: charred logs, a bed of embers, a few flame tongues, smoke rising into the rain, and a warm
// light that breathes and flickers. `heat` 0..1 scales the whole fire (a dying fire, a fire at dawn).
export class Campfire {
  group = new THREE.Group();
  light: THREE.PointLight;
  private flames: THREE.Mesh[] = [];
  private smoke: { m: THREE.Mesh; t: number; speed: number; drift: THREE.Vector2; a: { value: number } }[] = [];
  private seed = Math.random() * 100;
  heat = 1;

  constructor(at: THREE.Vector3, size = 1) {
    this.group.position.copy(at);
    this.group.scale.setScalar(size);
    const charred = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2a211b'), roughness: 0.95 });
    const emberMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#1a0d07'), roughness: 0.9 });
    // Embers glow from cracks: an emissive pattern on the char that pulses slowly.
    emberMat.emissiveNode = Fn(() => {
      const n = hash(positionGeometry.xz.mul(400).floor().dot(vec2(1, 57)));
      const pulse = sin(time.mul(1.7).add(n.mul(20))).mul(0.3).add(0.7);
      return color('#ff5a14').mul(smoothstep(0.55, 0.95, n).mul(pulse).mul(3.0));
    })();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 8), i % 2 ? charred : emberMat);
      log.position.set(Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14);
      log.rotation.set(Math.PI / 2 - 0.35, -a, 0, 'YXZ');
      log.castShadow = true;
      this.group.add(log);
    }
    const bed = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2), emberMat);
    bed.position.y = 0.012;
    this.group.add(bed);
    // Flames: crossed cards with a soft tongue shape, additive.
    const flameMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    flameMat.fog = false;
    flameMat.colorNode = Fn(() => {
      const st = uv();
      const flick = sin(time.mul(9).add(st.y.mul(6))).mul(0.06);
      const w = float(0.5).sub(st.y.mul(0.42)).max(0.02);
      const edge = smoothstep(w, w.mul(0.3), st.x.sub(0.5).add(flick).abs());
      const fade = smoothstep(0.0, 0.12, st.y).mul(float(1).sub(smoothstep(0.55, 1.0, st.y)));
      const hot = mix(color('#ffd27a'), color('#ff4a10'), st.y);
      return vec4(hot.mul(edge.mul(fade).mul(1.6)), edge.mul(fade));
    })();
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.5).translate(0, 0.25, 0), flameMat);
      f.position.set((i - 1) * 0.06, 0.04, (i % 2) * 0.05 - 0.02);
      f.rotation.y = (i / 3) * Math.PI;
      f.renderOrder = 7;
      this.group.add(f);
      this.flames.push(f);
    }
    // Smoke: soft grey puffs drifting up and downwind, growing and fading (each its own fade).
    const puff = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 7; i++) {
      const a = uniform(0);
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
      mat.colorNode = Fn(() => {
        const d = length(uv().sub(0.5)).mul(2);
        return vec4(LOOK.fogColor.mul(0.55), smoothstep(1.0, 0.2, d).mul(0.2).mul(a));
      })();
      const m = new THREE.Mesh(puff, mat);
      m.renderOrder = 5;
      this.group.add(m);
      this.smoke.push({ m, t: i / 7, speed: 0.11 + Math.random() * 0.05, drift: new THREE.Vector2(WIND.dir.x, WIND.dir.y).multiplyScalar(0.6 + Math.random() * 0.4), a });
    }
    this.light = new THREE.PointLight(new THREE.Color('#ff8a3c'), 3, 7 * size, 2);
    this.light.position.set(0, 0.35, 0);
    this.light.castShadow = false;
    this.group.add(this.light);
  }

  update(dt: number, t: number, cam: THREE.Camera) {
    const s = this.seed;
    const flicker = 0.75 + 0.15 * Math.sin(t * 7.3 + s) + 0.1 * Math.sin(t * 13.1 + s * 2) + 0.06 * Math.sin(t * 23.7);
    this.light.intensity = 2.6 * flicker * this.heat;
    for (const [i, f] of this.flames.entries()) {
      f.scale.set(1, (0.7 + 0.3 * Math.sin(t * 5.1 + i * 2 + s)) * this.heat, 1);
      f.visible = this.heat > 0.05;
    }
    for (const p of this.smoke) {
      p.t = (p.t + dt * p.speed) % 1;
      const h = p.t * 2.6;
      p.m.position.set(p.drift.x * h * 0.7, 0.3 + h, p.drift.y * h * 0.7);
      p.m.scale.setScalar((0.3 + p.t * 1.4) * (0.6 + 0.4 * this.heat));
      p.m.quaternion.copy(cam.quaternion);
      p.a.value = Math.sin(Math.PI * p.t) * this.heat;
      p.m.visible = this.heat > 0.02;
    }
  }
}
