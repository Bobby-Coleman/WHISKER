// Atmosphere (v3): columns of smoke over the battlefield, crows wheeling, a small fire, and streaks that show the
// wind. All cheap: instanced quads posed on the GPU or a handful of meshes.
import * as THREE from 'three';
import { toy } from '../render/materials';
import { WIND } from '../body';
import { rng } from './foliage';

// A column of smoke: soft puffs rising and leaning downwind, drawn as camera-facing quads (one draw).
export class Smoke {
  mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  constructor(at: THREE.Vector3, height = 30, count = 28, color = '#5b5560', opacity = 0.55, width = 1) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 2);
    const R = rng(Math.floor(at.x * 13 + at.z * 7) + 3);
    for (let i = 0; i < count; i++) { seed[i * 2] = i / count; seed[i * 2 + 1] = R(); }
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 2));
    g.instanceCount = count;
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, base: { value: at.clone() }, height: { value: height }, wind: { value: new THREE.Vector2() },
      color: { value: new THREE.Color(color) }, opacity: { value: opacity }, width: { value: width },
    }]);
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, fog: true,
      vertexShader: `
        uniform float time, height, width; uniform vec3 base; uniform vec2 wind; attribute vec2 seed;
        varying vec2 vUv; varying float vA;
        #include <fog_pars_vertex>
        void main(){
          float t = fract(seed.x + time * 0.022 * (0.8 + seed.y * 0.4));
          float h = t * height;
          vec3 c = base + vec3(wind.x * h * 0.5 + sin(seed.y * 30.0 + t * 4.0) * (0.4 + h * 0.05), h, wind.y * h * 0.5 + cos(seed.y * 21.0) * (0.4 + h * 0.05));
          float s = (1.5 + t * 9.0) * width;
          vec4 mvPosition = viewMatrix * vec4(c, 1.0);
          mvPosition.xy += position.xy * s;
          gl_Position = projectionMatrix * mvPosition;
          vUv = position.xy + 0.5;
          vA = pow(sin(3.14159 * t), 0.8) * min(1.0, t * 6.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 color; uniform float opacity; varying vec2 vUv; varying float vA;
        #include <fog_pars_fragment>
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, d) * vA * opacity;
          gl_FragColor = vec4(color * (0.85 + 0.3 * (1.0 - vUv.y)), a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'Smoke';
  }
  update(dt: number) { this.u.time.value += dt; (this.u.wind.value as THREE.Vector2).copy(WIND.dir).multiplyScalar(0.3 + WIND.base); }
}

// Crows: black birds circling over a point, flapping now and then; a caw call is up to the level.
export class Crows {
  group = new THREE.Group();
  private birds: { m: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh; r: number; h: number; speed: number; phase: number }[] = [];
  constructor(public center: THREE.Vector3, n = 6, radius = 18) {
    const mat = toy('#1d1c22', { rough: 0.6 });
    const R = rng(91);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(0.8, 0.7, 1.6), mat);
      const wing = new THREE.PlaneGeometry(0.5, 0.18).translate(0.25, 0, 0);
      const wl = new THREE.Mesh(wing, toy('#1d1c22', { side: THREE.DoubleSide })); wl.rotation.x = -Math.PI / 2;
      const wr = new THREE.Mesh(wing, wl.material); wr.rotation.set(-Math.PI / 2, 0, 0); wr.scale.x = -1;
      m.add(body, wl, wr);
      this.group.add(m);
      this.birds.push({ m, wl, wr, r: radius * (0.6 + R() * 0.6), h: 10 + R() * 12, speed: (0.15 + R() * 0.1) * (R() < 0.5 ? 1 : -1), phase: R() * 6.28 });
    }
  }
  update(dt: number, t: number) {
    for (const b of this.birds) {
      b.phase += b.speed * dt;
      const x = this.center.x + Math.cos(b.phase) * b.r, z = this.center.z + Math.sin(b.phase) * b.r;
      b.m.position.set(x, this.center.y + b.h + Math.sin(t * 0.7 + b.phase * 3) * 1.2, z);
      b.m.rotation.set(0, Math.atan2(-Math.sin(b.phase) * Math.sign(b.speed), Math.cos(b.phase) * Math.sign(b.speed)), Math.sign(b.speed) * 0.35);
      const flap = Math.sin(t * 9 + b.phase * 10) * (Math.sin(t * 0.5 + b.phase) > 0.2 ? 0.7 : 0.08);
      b.wl.rotation.y = flap; b.wr.rotation.y = -flap;
    }
  }
}

// A small fire: glowing embers, flame tongues (additive cards), a warm flickering light and a little smoke.
export class Fire {
  group = new THREE.Group();
  light: THREE.PointLight;
  smoke: Smoke;
  private flames: THREE.Mesh[] = [];
  private seed = Math.random() * 10;
  heat = 1;
  constructor(at: THREE.Vector3, size = 1, withLight = true) {
    this.group.position.copy(at);
    this.group.scale.setScalar(size);
    const log = toy('#3a2a20'), ember = toy('#2a1610', { emissive: '#ff6a1a', emissiveIntensity: 1.6 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6), i % 2 ? log : ember);
      l.position.set(Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12); l.rotation.set(Math.PI / 2 - 0.4, -a, 0, 'YXZ');
      this.group.add(l);
    }
    const fm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { t: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv; void main(){
        float w = 0.5 - vUv.y * 0.42; float x = abs(vUv.x - 0.5 + sin(t * 9.0 + vUv.y * 6.0) * 0.05);
        float a = smoothstep(w, w * 0.3, x) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        vec3 c = mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.3, 0.05), vUv.y);
        gl_FragColor = vec4(c * a * 1.4, a); }`,
    });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55).translate(0, 0.27, 0), fm);
      f.rotation.y = (i / 3) * Math.PI; f.position.y = 0.04;
      this.group.add(f); this.flames.push(f);
    }
    this.light = new THREE.PointLight('#ff9a4a', withLight ? 2.2 : 0, 8 * size, 2);
    this.light.position.y = 0.4;
    if (withLight) this.group.add(this.light);
    this.smoke = new Smoke(at.clone().add(new THREE.Vector3(0, 0.5, 0)), 6 * size, 10, '#6a6268', 0.35, 0.35 * size);
  }
  update(dt: number, t: number) {
    ((this.flames[0].material as THREE.ShaderMaterial).uniforms.t.value as number) = t + this.seed;
    const f = 0.8 + 0.15 * Math.sin(t * 7.1 + this.seed) + 0.1 * Math.sin(t * 13.3);
    this.light.intensity = 2.2 * f * this.heat;
    this.flames.forEach((m, i) => { m.scale.set(1, (0.75 + 0.25 * Math.sin(t * 5 + i * 2)) * this.heat, 1); m.visible = this.heat > 0.05; });
    this.smoke.update(dt);
  }
}

// Wind streaks: thin white lines whipping downwind near the camera, more of them in a gust.
export class WindStreaks {
  mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  constructor(count = 60) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const s = new Float32Array(count * 4), R = rng(17);
    for (let i = 0; i < count; i++) { s[i * 4] = R(); s[i * 4 + 1] = R(); s[i * 4 + 2] = R(); s[i * 4 + 3] = R(); }
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(s, 4));
    g.instanceCount = count;
    this.u = { time: { value: 0 }, center: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2(1, 0) }, amount: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float time, amount; uniform vec3 center; uniform vec2 wind; attribute vec4 seed; varying float vA; varying float vX;
        void main(){
          float life = fract(seed.x + time * (0.35 + seed.y * 0.3));
          vec2 side = vec2(-wind.y, wind.x);
          vec2 xz = center.xz + side * (seed.z - 0.5) * 22.0 + wind * (life - 0.5) * 30.0;
          float y = center.y + 0.3 + seed.w * 3.5 + sin(life * 6.0 + seed.x * 20.0) * 0.3;
          float len = 1.2 + seed.y * 2.0;
          vec3 p = vec3(xz.x, y, xz.y) + vec3(wind.x, 0.0, wind.y) * position.x * len + vec3(0.0, position.y * 0.012, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vA = sin(3.14159 * life) * step(seed.y, amount); vX = position.x;
        }`,
      fragmentShader: `varying float vA; varying float vX; void main(){ float a = vA * sin(3.14159 * vX) * 0.55; gl_FragColor = vec4(1.0, 1.0, 1.0, a); }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  update(dt: number, center: THREE.Vector3) {
    this.u.time.value += dt;
    (this.u.center.value as THREE.Vector3).copy(center);
    (this.u.wind.value as THREE.Vector2).copy(WIND.dir);
    this.u.amount.value = Math.min(1, WIND.base * 0.35 + WIND.gust * 0.9);
  }
}
