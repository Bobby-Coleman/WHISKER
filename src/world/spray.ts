// Wind-blown drizzle and spindrift: faint streaks racing past the camera along the wind, so the air itself is
// seen to move. Every streak is placed on the GPU from its instance index (no per-particle data): a jittered spot
// in a box that travels with the camera, carried downwind at gale speed and wrapped around the box, drawn as a
// thin ribbon stretched along its motion (the blur a camera would record) and faded near, far and in lulls.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, positionGeometry, vec3, vec4, float, hash, uint, fract, cameraPosition, normalize, cross, length,
  smoothstep, mix, sin, uniform, positionPrevious,
} from 'three/tsl';
import { WIND, LOOK } from '../render/settings';

export function createSpray(count: number) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  geo.instanceCount = count;
  const gustU = uniform(0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.fog = false;
  const B = 18, H = 5;
  const alphaV = float(0).toVar('sprayA');
  m.positionNode = Fn(() => {
    const i = uint(instanceIndex);
    const r = (k: number) => hash(i.mul(uint(7919)).add(uint(k * 1013 + 17)));
    const wind3 = normalize(vec3(WIND.dir.x, 0, WIND.dir.y));
    const speed = float(7.5).add(r(1).mul(6.0)).mul(gustU.mul(0.6).add(0.7));
    // Travel downwind; wrap within a box centred on the camera so streaks never run out.
    const start = vec3(r(2), r(3), r(4)).mul(vec3(B, H, B));
    const travel = wind3.mul(speed.mul(WIND.time));
    const rel = start.add(travel).sub(cameraPosition.mul(vec3(1, 0, 1)));
    const wrapped = vec3(fract(rel.x.div(B)), fract(rel.y.div(H)), fract(rel.z.div(B))).mul(vec3(B, H, B)).sub(vec3(B / 2, 0, B / 2));
    const lift = sin(WIND.time.mul(1.7).add(r(5).mul(40))).mul(0.15);
    const center = vec3(cameraPosition.x, cameraPosition.y.sub(1.6), cameraPosition.z).add(wrapped).add(vec3(0, lift, 0));
    // Ribbon: long axis along the motion, short axis facing the camera.
    const len = float(0.18).add(r(6).mul(0.35)).mul(speed.div(10));
    const toCam = normalize(cameraPosition.sub(center));
    const side = normalize(cross(wind3, toCam));
    const p = center.add(wind3.mul(positionGeometry.y.sub(0.5).mul(len))).add(side.mul(positionGeometry.x.mul(0.004)));
    positionPrevious.assign(p);
    const d = length(center.sub(cameraPosition));
    alphaV.assign(smoothstep(0.6, 2.0, d).mul(float(1).sub(smoothstep(7.0, 9.0, d))).mul(r(7).mul(0.5).add(0.5)));
    return p;
  })();
  const tip = positionGeometry.y;
  const a = alphaV.toVarying('vSprayA').mul(smoothstep(0.0, 0.35, tip).mul(float(1).sub(smoothstep(0.65, 1.0, tip))));
  m.colorNode = vec4(LOOK.fogColor.mul(1.12), a.mul(mix(float(0.05), float(0.16), gustU)).mul(LOOK.fogEnabled));
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'Spray';
  return {
    mesh,
    update(gust: number) { gustU.value = gust; },
  };
}
