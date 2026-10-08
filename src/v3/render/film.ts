// A quiet film finish on the already tone-mapped canvas: one triangle, no scene copy or render target.
// Keep the grain below half a percent so it adds life to mist without masking small climbing grips or pins.
import * as THREE from 'three';

export class FilmTreatment {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  strength = 0.65;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, strength: { value: this.strength } },
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time, strength; varying vec2 vUv;
        void main(){
          vec2 lens = (vUv - 0.5) * vec2(1.16, 1.0);
          float vignette = smoothstep(0.23, 0.78, length(lens)) * 0.14 * strength;
          float frame = floor(time * 24.0);
          float grain = fract(sin(dot(gl_FragCoord.xy + vec2(frame * 17.0, frame * 9.0), vec2(12.9898, 78.233))) * 43758.5453);
          float grainAlpha = 0.006 * strength;
          float alpha = 1.0 - (1.0 - vignette) * (1.0 - grainAlpha);
          // Premultiplied source over: a black vignette with extremely faint monochrome grain.
          gl_FragColor = vec4(vec3(grain * grainAlpha), alpha);
        }`,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    mesh.name = 'FilmTreatment';
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, time: number) {
    if (this.strength <= 0) return;
    this.material.uniforms.time.value = time;
    this.material.uniforms.strength.value = THREE.MathUtils.clamp(this.strength, 0, 1);
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    // The main scene has already reset the counters. Accumulate this draw so the stats still measure the frame.
    renderer.info.autoReset = false;
    try { renderer.render(this.scene, this.camera); }
    finally { renderer.autoClear = autoClear; renderer.info.autoReset = autoReset; }
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
