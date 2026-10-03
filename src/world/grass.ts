// Dense grass carpet: every blade is generated on the GPU around the camera, with no per-blade data on the CPU.
// Blade roots sit on a world-anchored jittered grid that wraps around a point just ahead of the camera, so blades
// never swim as it moves. Two rings share one blade model: fine 5-segment blades for the first few metres and
// coarser, wider 2-segment blades out to ~22 m; past that the terrain carries the canopy colour and the cluster
// kit adds tussocks, dead grass and reeds. Blades clump into tufts (Voronoi cells), curve on a Bezier spine,
// shade as rounded surfaces, darken toward the root, bend in the shared wind and part around the characters.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, positionGeometry, uniform, uniformArray, vec2, vec3, vec4, float, floor, fract, mix, smoothstep, clamp,
  max, min, abs, length, normalize, cross, dot, sin, cos, select, texture, uint, hash, cameraPosition, cameraViewMatrix,
  faceDirection, sign, pow, If, positionPrevious,
} from 'three/tsl';
import { windOffset } from './vegetation';
import { LOOK } from '../render/settings';
import { characterAO } from '../render/occlusion';
import { FieldMaps, MASK_HALF, PATH_RANGE, terrainHeight } from './ground';

type Ring = {
  name: string; cell: number; n: number; segs: number; width: number; ahead: number; salt: number;
  // Density kept with distance from the camera: [start, end, fraction left at end].
  thin: [number, number, number];
  fadeIn: [number, number] | null; fadeOut: [number, number];
};

const RINGS: Ring[] = [
  { name: 'near', cell: 0.035, n: 286, segs: 5, width: 0.0048, ahead: 2.6, salt: 0x51ed27, thin: [2.0, 4.6, 0.25], fadeIn: null, fadeOut: [4.6, 5.4] },
  { name: 'mid', cell: 0.084, n: 404, segs: 2, width: 0.0066, ahead: 11, salt: 0x2c1b3c, thin: [9, 20, 0.5], fadeIn: [4.6, 5.4], fadeOut: [17, 23] },
];

// Review switch: 0 = normal, 1 = up-facing normals, 2 = unlit albedo.
export const GRASS_DEBUG = uniform(0);

// Characters the grass parts around: (x, z, radius, strength) for the kitten and the knight.
export const GRASS_PUSHERS = uniformArray([new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)], 'vec4');

function bladeGeometry(segs: number) {
  // A strip of `segs` levels tapering to one tip vertex. position = (side -1..1, height fraction t, 0).
  const pos: number[] = [], idx: number[] = [];
  for (let s = 0; s < segs; s++) { const t = 1 - Math.pow(1 - s / segs, 1.25); pos.push(-1, t, 0, 1, t, 0); }
  pos.push(0, 1, 0);
  for (let s = 0; s < segs - 1; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const a = (segs - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const K = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5, 0xb55a4f09, 0x68e31da4, 0x1b873593, 0xcc9e2d51];

function ringMaterial(ring: Ring, maps: FieldMaps, center: any, proj: any) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const N = ring.n;
  const side = positionGeometry.x, t = positionGeometry.y;

  // What each blade vertex hands to the pixel stage, with defaults for a skipped blade: one out of view, or thinned
  // away by distance or the field masks. A skipped blade collapses to a point far below the ground (nothing is drawn)
  // and its vertices skip the tufting, shaping, wind and colour work, which is most of what the grass costs.
  const oPos = vec3(0, -1000, 0).toVar('gPos'), oFace = vec3(0, 1, 0).toVar('gFace'), oRound = vec3(0).toVar('gRound');
  const oUp = float(1).toVar('gUp'), oCol = vec3(0).toVar('gCol'), oAO = float(1).toVar('gAO');
  const oRough = float(0.5).toVar('gRough'), oEm = vec3(0).toVar('gEm');

  m.positionNode = Fn(() => {
    // Set at the top of the shader, so they are in scope where the pixel stage's inputs are written.
    oPos.assign(vec3(0, -1000, 0)); oFace.assign(vec3(0, 1, 0)); oRound.assign(vec3(0)); oUp.assign(1);
    oCol.assign(vec3(0)); oAO.assign(1); oRough.assign(0.5); oEm.assign(vec3(0));

    // World cell of this instance: the copy of grid cell (gx, gz) nearest the ring's centre.
    const gx = float(instanceIndex.mod(uint(N))), gz = float(instanceIndex.div(uint(N)));
    const cc = center.div(ring.cell);
    const wx = gx.add(floor(cc.x.sub(gx).div(N).add(0.5)).mul(N)).toVar();
    const wz = gz.add(floor(cc.y.sub(gz).div(N).add(0.5)).mul(N)).toVar();
    const seed = uint(wx.add(100000)).mul(uint(1973)).add(uint(wz.add(100000)).mul(uint(9277))).add(uint(ring.salt)).toVar();
    const rnd = (k: number) => hash(seed.bitXor(uint(K[k])));
    const root = vec2(wx.add(rnd(0)), wz.add(rnd(1))).mul(ring.cell).toVar();
    const rootY = terrainHeight(maps, root).sub(0.012);
    const root3 = vec3(root.x, rootY as any, root.y).toVar();

    // In view: the root against the camera's side, top and bottom planes, with room for the blade's height and sway.
    const vp: any = cameraViewMatrix.mul(vec4(root3, 1)).xyz;
    const depth = vp.z.negate();
    const reach = 0.8;
    const inView = depth.greaterThan(-reach)
      .and(abs(vp.x).mul(proj.x).lessThan(depth.add(proj.x.mul(reach))))
      .and(abs(vp.y).mul(proj.y).lessThan(depth.add(proj.y.mul(reach))));

    If(inView, () => {
      // Field masks.
      const muv = root.add(MASK_HALF).div(2 * MASK_HALF);
      const m1: any = texture(maps.mask, muv).level(float(0)), m2: any = texture(maps.mask2, muv).level(float(0));
      const pathD = m1.x.mul(PATH_RANGE), wet = m1.y, excl = m1.z, vigour = m1.w, deadFrac = m2.x, pud = m2.y;

      // Distance rings and density.
      const toCam = root3.sub(cameraPosition);
      const dist = length(toCam).toVar();
      // A few short, trodden blades survive in the middle of the path.
      let dens: any = max(smoothstep(0.12, 0.55, pathD), 0.1).mul(float(1).sub(excl)).mul(mix(float(1), float(0.08), pud)).mul(mix(float(0.55), float(1), vigour));
      dens = dens.mul(mix(float(1), float(ring.thin[2]), smoothstep(ring.thin[0], ring.thin[1], dist)));
      dens = dens.mul(float(1).sub(smoothstep(ring.fadeOut[0], ring.fadeOut[1], dist)));
      if (ring.fadeIn) dens = dens.mul(smoothstep(ring.fadeIn[0], ring.fadeIn[1], dist));
      const rank = rnd(2);
      const show = smoothstep(rank, rank.add(0.12), dens).toVar();

      If(show.greaterThan(0.0005), () => {
        // Tufts: nearest of the four candidate clump centres (0.3 m cells).
        const CL = 0.3;
        const cq = root.div(CL);
        const base: any = (floor(cq) as any).sub(vec2(select(fract(cq.x).lessThan(0.5), float(1), float(0)) as any, select(fract(cq.y).lessThan(0.5), float(1), float(0)) as any));
        let best: any = null, bestD: any = null, bestId: any = null;
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const c: any = base.add(vec2(dx, dz));
          const cs = uint(c.x.add(100000)).mul(uint(7919)).add(uint(c.y.add(100000)).mul(uint(104729)));
          const ctr = c.add(vec2(hash(cs), hash(cs.bitXor(uint(K[2]))))).mul(CL);
          const d = length(root.sub(ctr));
          if (best === null) { best = ctr; bestD = d; bestId = cs; continue; }
          const closer = d.lessThan(bestD);
          best = select(closer, ctr, best); bestD = select(closer, d, bestD); bestId = select(closer, cs, bestId);
        }
        const clumpC = best.toVar(), clumpD = bestD.toVar();
        const clumpR = hash(bestId.bitXor(uint(K[3]))).toVar(), clumpR2 = hash(bestId.bitXor(uint(K[4]))).toVar();

        // Blade parameters.
        const dead = rnd(7).lessThan(deadFrac.mul(mix(float(1), float(0.55), wet))).toVar();
        const tuft = mix(float(0.7), float(1.35), clumpR).mul(mix(float(1.15), float(0.8), smoothstep(0.0, 0.22, clumpD)));
        const pathShort = mix(float(0.35), float(1), smoothstep(0.15, 1.2, pathD));
        const h = float(0.2).mul(mix(float(0.5), float(1.35), vigour)).mul(mix(float(0.6), float(1.4), rnd(3))).mul(tuft).mul(pathShort)
          .mul(mix(float(1), float(1.45), wet)).mul(select(dead, float(1.1), float(1))).mul(show).toVar();
        const ang = rnd(4).mul(6.2832);
        const out = root.sub(clumpC);
        const outDir = out.div(max(length(out), 0.001));
        const fdir = normalize(outDir.mul(0.75).add(vec2(cos(ang), sin(ang)).mul(0.65)).add(vec2(0.0001, 0))).toVar();
        const lean = clamp(float(0.18).add(rnd(5).mul(0.55)).add(smoothstep(0.05, 0.22, clumpD).mul(0.3)).add(select(dead, float(0.3), float(0))), 0, 1.05);

        // Spine: quadratic Bezier from the root, curving over toward fdir.
        const a = lean.mul(1.2);
        const f3 = vec3(fdir.x, 0, fdir.y);
        const P1 = vec3(0, h.mul(0.55), 0).add(f3.mul(h.mul(0.1).mul(lean)));
        const P2 = vec3(0, h.mul(cos(a)), 0).add(f3.mul(h.mul(sin(a))));
        const u = float(1).sub(t);
        const spine = P1.mul(u.mul(t).mul(2)).add(P2.mul(t.mul(t)));
        const tangent = normalize(P1.mul(u.mul(2)).add(P2.sub(P1).mul(t.mul(2))).add(vec3(0, 0.0001, 0)));

        // Wind (shared with the cluster kit) and characters parting the grass.
        let off: any = windOffset(root3, t, h.add(0.001), select(dead, float(0.8), float(1.0)));
        for (let k = 0; k < 2; k++) {
          const pz: any = GRASS_PUSHERS.element(k);
          const d = root.sub(pz.xy);
          const l: any = max(length(d), 0.001);
          const f: any = float(1).sub(smoothstep(pz.z.mul(0.35), pz.z, l)).mul(pz.w);
          off = off.add(vec3(d.x, 0, d.y).div(l).mul(f.mul(h).mul(t).mul(0.9))).sub(vec3(0, f.mul(h).mul(t).mul(0.45), 0));
        }

        // Width: blades turn a little toward the camera when seen edge-on, and widen with distance to keep coverage.
        const wdir = vec3(fdir.y.negate(), 0, fdir.x);
        const vxz = normalize(vec2(toCam.x, toCam.z).negate().add(vec2(0.0001, 0)));
        const wview = vec3(vxz.y.negate(), 0, vxz.x);
        const edgeOn = float(1).sub(abs(dot(fdir, vxz)));
        const wd = normalize(mix(wdir.mul((sign(dot(wdir, wview)) as any).add(0.001)) as any, wview, edgeOn.mul(0.45))).toVar();
        const widen = float(1).add(smoothstep(1.5, 22.0, dist).mul(3.2));
        const w = float(ring.width).mul(mix(float(0.7), float(1.3), rnd(6))).mul(widen).mul(select(dead, float(0.85), float(1))).mul(min(show.mul(3), 1));
        const halfW = w.mul(float(1).sub(pow(t, 1.4)));
        const p = root3.add(spine).add(off).add(wd.mul(side.mul(halfW)));
        oPos.assign(p);
        // Blades are anchored in the world: their previous position is where they are now (camera motion only),
        // so TAA reprojects them correctly instead of reading the blade template as a huge motion.
        positionPrevious.assign(p);

        // Shading normal: rounded across the blade, eased toward the turf's up vector with distance. Under an overcast
        // sky a turf reads as one surface: shade mostly with the ground's up vector and let the rounded blade normal
        // add variation (as Ghost of Tsushima blends blade and terrain normals).
        oFace.assign(normalize(cross(wd, tangent)));
        oRound.assign(wd.mul(side));
        oUp.assign(float(0.55).add(smoothstep(2.0, 14.0, dist).mul(0.33)));

        // Colour: olive living blades with sage tufts, straw-coloured dead ones; darker toward the root.
        const livingBase = mix(vec3(0.03, 0.042, 0.014), vec3(0.042, 0.05, 0.025), clumpR2);
        const livingTip = mix(vec3(0.16, 0.23, 0.075), vec3(0.2, 0.25, 0.13), clumpR2);
        const deadBase = vec3(0.07, 0.052, 0.028), deadTip = vec3(0.28, 0.22, 0.12);
        const tint = mix(float(0.8), float(1.12), rnd(8)).mul(mix(float(0.88), float(1.08), clumpR));
        const ct = pow(t, 0.75);
        const col = mix(select(dead, deadBase, livingBase), select(dead, deadTip, livingTip), ct).mul(tint);
        oCol.assign(col.mul(mix(float(0.7), float(1), pow(t, 0.6))));
        // Self-occlusion inside the turf plus the characters' contact occlusion (per vertex: cheaper than per pixel).
        const turfAO = mix(float(0.42), float(1), smoothstep(0.0, 0.85, t));
        oAO.assign(turfAO.mul(characterAO(p, vec3(0, 1, 0))));
        oRough.assign(select(dead, float(0.72), float(0.5)).sub(wet.mul(0.12)));
        // Sky light transmitted through the thin blades (strongest at the tips), restrained so nothing glows.
        oEm.assign(col.mul(LOOK.skyHorizon).mul(float(0.04).add(pow(t, 2).mul(0.08))));
      });
    });
    return oPos;
  })();

  const vFace = oFace.toVarying('v_gFace'), vRound = oRound.toVarying('v_gRound'), upBlend = oUp.toVarying('v_gUp');
  const nW = normalize(mix(normalize(vFace.mul(faceDirection).add(vRound.mul(0.6))), vec3(0, 1, 0), upBlend));
  m.normalNode = cameraViewMatrix.mul(vec4(select(GRASS_DEBUG.equal(1), vec3(0, 1, 0), nW), 0)).xyz;
  const albedo = oCol.toVarying('v_gCol');
  m.colorNode = select(GRASS_DEBUG.greaterThan(1.5), vec3(0), albedo);
  m.aoNode = oAO.toVarying('v_gAO');
  m.roughnessNode = oRough.toVarying('v_gRough');
  m.metalnessNode = float(0);
  const dbg = select(GRASS_DEBUG.equal(3), nW.mul(0.5).add(0.5), select(GRASS_DEBUG.equal(4), vFace.mul(0.5).add(0.5), vec3(faceDirection.mul(0.5).add(0.5))));
  m.emissiveNode = select(GRASS_DEBUG.equal(2), albedo, select(GRASS_DEBUG.greaterThan(2.5), dbg, oEm.toVarying('v_gEm')));
  return m;
}

export function createGrass(maps: FieldMaps, density = 1) {
  const group = new THREE.Group();
  group.name = 'GrassCarpet';
  // The camera's x and y projection scales, for the per-blade view test.
  const proj = uniform(new THREE.Vector2(1, 1));
  const rings = RINGS.map((r) => {
    const ring = { ...r, n: Math.round(r.n * Math.sqrt(Math.min(1, density)) / 2) * 2 };
    // Fewer, wider blades on lower tiers cover the same ground.
    ring.cell = r.cell * r.n / ring.n;
    ring.width = r.width * Math.sqrt(r.n / ring.n);
    const center = uniform(new THREE.Vector2());
    const geo = bladeGeometry(ring.segs);
    geo.instanceCount = ring.n * ring.n;
    const mesh = new THREE.Mesh(geo, ringMaterial(ring, maps, center, proj));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `Grass_${ring.name}`;
    group.add(mesh);
    return { ring, center, mesh };
  });
  const dir = new THREE.Vector3();
  return {
    group,
    blades: rings.reduce((s, r) => s + r.ring.n * r.ring.n, 0),
    update(cam: THREE.Camera) {
      proj.value.set(cam.projectionMatrix.elements[0], cam.projectionMatrix.elements[5]);
      cam.getWorldDirection(dir);
      const l = Math.hypot(dir.x, dir.z);
      const fx = l > 1e-3 ? dir.x / l : 0, fz = l > 1e-3 ? dir.z / l : 0;
      const k = Math.min(1, l * 1.5);
      for (const r of rings) r.center.value.set(cam.position.x + fx * r.ring.ahead * k, cam.position.z + fz * r.ring.ahead * k);
    },
  };
}
