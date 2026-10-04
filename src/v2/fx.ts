// Weather and fire effects for story scenes (engine v2): rain falling round the camera, and campfires (logs, embers,
// a flickering warm light, flames and rising smoke). Rain streaks are placed on the GPU from their instance index,
// in a box that travels with the camera, like the moor's wind spray (world/spray.ts).
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, positionGeometry, vec3, vec4, float, hash, uint, fract, cameraPosition, normalize, cross, length,
  smoothstep, uniform, positionPrevious, uv, sin, time, mix, vec2, color, attribute, positionWorld,
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

// A column of smoke from something burning far off: dark puffs rising thirty metres and leaning downwind, drawn
// over the fog (it stands up out of the mist as a landmark). One instanced draw; each puff faces the camera.
export class SmokePlume {
  mesh: THREE.InstancedMesh;
  private puffs: { t: number; speed: number; side: number; spin: number }[] = [];
  private alpha: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor(public at: THREE.Vector3, public height = 30, count = 26, shade = 0.42) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geo.setAttribute('puffA', this.alpha);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.fog = false;
    mat.colorNode = Fn(() => {
      const st = uv();
      const d = length(st.sub(0.5)).mul(2);
      const lumpy = hash(st.mul(7).floor().dot(vec2(1, 31))).mul(0.25);
      const dist = length(positionWorld.sub(cameraPosition));
      const far = smoothstep(25.0, 140.0, dist);
      const c = mix(LOOK.fogColor.mul(shade), LOOK.fogColor.mul(0.8), far.mul(0.6));
      return vec4(c, smoothstep(1.0, 0.1, d.add(lumpy)).mul(attribute('puffA', 'float')).mul(mix(float(1), float(0.6), far)));
    })();
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'SmokePlume';
    for (let i = 0; i < count; i++) this.puffs.push({ t: i / count, speed: 0.028 + Math.random() * 0.012, side: Math.random() * 2 - 1, spin: Math.random() * 6.28 });
  }
  update(dt: number, cam: THREE.Camera) {
    const H = this.height;
    this.puffs.forEach((pf, i) => {
      pf.t = (pf.t + dt * pf.speed) % 1;
      const h = pf.t * H;
      this.p.set(this.at.x + WIND.dir.x * h * 0.45 + pf.side * (0.5 + h * 0.06), this.at.y + 1 + h, this.at.z + WIND.dir.y * h * 0.45);
      this.q.copy(cam.quaternion);
      const sz = 2.2 + pf.t * 11;
      this.s.set(sz, sz, sz);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.alpha.array[i] = Math.pow(Math.sin(Math.PI * pf.t), 0.7) * 0.32 * Math.min(1, pf.t * 8);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

// Soft contact shadows: dark ovals on the ground under things that lie or sit on it (a seated man, the fallen, the
// horses), so they rest on the earth instead of hovering over it in the flat, overcast light. One instanced draw.
export function contactShadows(items: { x: number; y: number; z: number; rx: number; rz: number; yaw: number; tilt?: THREE.Quaternion }[], strength = 0.55) {
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = smoothstep(1.0, 0.15, d);
    return vec4(vec3(0.02, 0.02, 0.018), a.mul(a).mul(strength));
  })();
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
    if (it.tilt) q.premultiply(it.tilt);
    m.compose(new THREE.Vector3(it.x, it.y + 0.012, it.z), q, new THREE.Vector3(it.rx, 1, it.rz));
    mesh.setMatrixAt(i, m);
  });
  mesh.renderOrder = 1;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  mesh.name = 'ContactShadows';
  return mesh;
}
