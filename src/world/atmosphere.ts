// Overcast sky, environment lighting, height fog with drifting low mist, and mist cards.
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec4, float, positionWorld, cameraPosition, positionLocal, normalize, mix, smoothstep, exp, pow, max,
  mx_fractal_noise_float, length, uniform, uv, vec2, sin, cos, color, clamp, attribute, cameraViewMatrix, modelWorldMatrix,
  fog,
} from 'three/tsl';
import { LOOK, WIND, SKY_LIFT } from '../render/settings';
import { bakedNoise, MX_ORIGIN } from '../render/noisetex';

// Shared fog factor so custom materials (distant silhouettes, water) can match the scene fog.
export const fogFactorAt = Fn(([wp]: any[]) => {
  const d = length(wp.sub(cameraPosition));
  const base = float(1).sub(exp(pow(d.div(LOOK.fogDistance), 1.25).negate()));
  // Low mist patches drifting downwind through world space, slower than grass gusts.
  const drift = vec2(WIND.dir.x, WIND.dir.y).mul(WIND.time).mul(2.6);
  const p = wp.xz.mul(0.022).sub(drift.mul(0.022));
  // Baked fBm: r is the original fog noise (its window starts at MX_ORIGIN). Two independent fields turned slowly
  // against each other stand in for the noise's slow third axis (the mix keeps the same spread at every angle).
  // Read at full detail like the original: the patches are tens of metres across, so they cannot shimmer.
  const nz = bakedNoise(p.sub(MX_ORIGIN), true), th = WIND.time.mul(0.016);
  const patch = smoothstep(0.0, 0.55, nz.r.mul(cos(th)).add(nz.g.mul(sin(th))).add(0.15));
  const h = mix(cameraPosition.y, wp.y, 0.65);
  const low = exp(max(h.add(0.5), 0).div(1.5).negate());
  const mist = patch.mul(low).mul(float(1).sub(exp(d.div(11).negate()))).mul(0.72).mul(LOOK.mistAmount);
  const f = float(1).sub(float(1).sub(base).mul(float(1).sub(mist)));
  return clamp(f.mul(LOOK.fogEnabled), 0, 0.995);
});

export function setupFog(scene: THREE.Scene) {
  scene.fogNode = fog(LOOK.fogColor, fogFactorAt(positionWorld));
}

function skyColorNode(dir: any) {
  const y = dir.y;
  const up = smoothstep(-0.02, 0.55, y);
  let c = mix(LOOK.skyHorizon, LOOK.skyZenith, up);
  // Broad, slow cloud mottling; no visible sun.
  const n = bakedNoise(vec2(dir.x.div(y.add(0.25)).mul(1.3).add(WIND.time.mul(0.004)), dir.z.div(y.add(0.25)).mul(1.3))).r;
  c = c.mul(float(1).add(n.mul(0.07).mul(up)));
  // Below the horizon blend into fog so the far edge has no seam.
  c = mix(LOOK.fogColor, c, smoothstep(-0.04, 0.06, y));
  return c;
}

// The visible sky: a photographed sky from the weather when one is given, otherwise the procedural fallback.
export function createSky(colorNode?: any): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 64, 32);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  mat.fog = false;
  mat.colorNode = colorNode ?? skyColorNode(normalize(positionLocal));
  const m = new THREE.Mesh(geo, mat);
  m.name = 'Sky';
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// The visible sky and fog were lifted by SKY_LIFT (settings.ts); the environment divides it back out so the light
// falling on the field stays where it was tuned.
const ENV_SKY = 1.25 / SKY_LIFT;

// Builds a prefiltered overcast environment for PBR reflections, plus an optional warm second environment for review.
export function createEnvironment(renderer: THREE.WebGPURenderer, kind: 'overcast' | 'interior' = 'overcast') {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 64, 32);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  mat.fog = false;
  const dir = normalize(positionLocal);
  if (kind === 'overcast') {
    // The sky metals reflect is the sky the player sees (a touch brighter overhead), so polished steel reads
    // darker than the sky behind it, as in the reference clip. ENV_SKY keeps the overall light level.
    const sky = skyColorNode(dir).mul(ENV_SKY);
    // Brighter diffuse zone where the hidden sun sits behind cloud.
    const sunDir = normalize(vec3(-0.45, 0.55, -0.7));
    const glow = pow(max(dir.dot(sunDir), 0), 3.0).mul(0.45);
    const ground = mix(color('#3c3f33'), color('#59604f'), smoothstep(-0.6, 0.0, dir.y)).mul(1.25);
    // Seen from standing height the field is only fogged within a few degrees of the horizon, so armour and
    // blades pick up a dark ground band under a bright horizon instead of reflecting sky all the way down.
    const horizon = skyColorNode(vec3(dir.x, 0.02, dir.z)).mul(0.92);
    const hazeBelow = mix(ground, horizon, smoothstep(-0.08, -0.004, dir.y));
    mat.colorNode = mix(hazeBelow, sky.add(glow), smoothstep(-0.02, 0.03, dir.y));
  } else {
    const warm = color('#c99a62').mul(smoothstep(-0.2, 0.6, dir.x).mul(2.0)).add(color('#2b2620').mul(0.5));
    mat.colorNode = warm;
  }
  envScene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02, 0.1, 100);
  pmrem.dispose();
  return rt.texture;
}

export function createLights(scene: THREE.Scene, shadowSize: number) {
  // Restrained directional light: a sun hidden behind cloud. Environment light dominates.
  const sun = new THREE.DirectionalLight(new THREE.Color('#e9e6dc'), 0.85);
  sun.position.set(-18, 26, -24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const s = 16;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 5;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#b9c3c6'), new THREE.Color('#4a4c3c'), 0.25);
  scene.add(hemi);
  return { sun, hemi };
}

// Soft camera-facing mist cards drifting low over the field. One instanced draw: the cards share one colour, so
// their blending does not depend on draw order. Cards out of view, or too near or far to show, are skipped.
export function createMistCards(count: number) {
  const group = new THREE.Group();
  group.name = 'MistCards';
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.fog = false;
  const tex = Fn(() => {
    const u = uv().sub(0.5);
    const r = length(u.mul(vec2(1.0, 1.8)));
    const edge = smoothstep(0.5, 0.05, r);
    const wp = positionWorld;
    // Baked 3-octave fBm, projected from world space so the pattern holds still as the cards turn to the camera.
    const q = vec2(wp.x.mul(0.18).add(wp.z.mul(0.07)).sub(WIND.time.mul(0.32)), wp.z.mul(0.18).add(wp.y.mul(0.3)));
    const n = bakedNoise(q).g.mul(0.5).add(0.5);
    const d = length(wp.sub(cameraPosition));
    const nearFade = smoothstep(2.5, 9.0, d);
    const farFade = float(1).sub(smoothstep(70, 120, d));
    const a: any = edge.mul(n).mul(nearFade).mul(farFade).mul(0.2).mul(LOOK.mistAmount).mul(LOOK.fogEnabled);
    return vec4(LOOK.fogColor.mul(1.06), a);
  });
  mat.colorNode = tex();
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = 'MistCardsInstanced';
  group.add(mesh);
  const cards: { base: THREE.Vector3; speed: number; scale: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, rr = 8 + Math.random() * 80;
    cards.push({ base: new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), speed: 2.2 + Math.random() * 1.8, scale: 10 + Math.random() * 16 });
  }
  const frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), camPos = new THREE.Vector3(), sphere = new THREE.Sphere();
  return {
    group,
    update(t: number, cam: THREE.Camera, heightAt: (x: number, z: number) => number, center: THREE.Vector3) {
      cam.updateMatrixWorld();
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(vp, (cam as any).coordinateSystem, (cam as any).reversedDepth);
      cam.getWorldPosition(camPos);
      let n = 0;
      for (const c of cards) {
        let x = c.base.x + WIND.dir.x * t * c.speed, z = c.base.z + WIND.dir.y * t * c.speed;
        // Wrap within a ring around the play area center so the drift never ends.
        const R = 95;
        x = ((x - center.x + R) % (2 * R) + 2 * R) % (2 * R) - R + center.x;
        z = ((z - center.z + R) % (2 * R) + 2 * R) % (2 * R) - R + center.z;
        pos.set(x, heightAt(x, z) + c.scale * 0.08, z);
        // The shader fades a card out nearer than 2.5 m and beyond 120 m; skip it once all of it is past either.
        const reach = c.scale * 0.53, d = pos.distanceTo(camPos);
        if (d + reach < 2.5 || d - reach > 120) continue;
        if (!frustum.intersectsSphere(sphere.set(pos, reach))) continue;
        scl.set(c.scale, c.scale * 0.32, 1);
        mesh.setMatrixAt(n++, m.compose(pos, cam.quaternion, scl));
      }
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      if (n > 0) { mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true; }
    },
  };
}
void attribute; void cameraViewMatrix; void modelWorldMatrix; void sin; void mx_fractal_noise_float; void uniform;
