// Strand fur groomed in Blender (blender/kitten_head_groom.py), drawn as camera-facing ribbons.
// A hair lighting model (wrapped diffuse, two shifted Kajiya-Kay lobes, transmission, sky rim) shades them, edges
// use alpha-to-coverage, and a pixel-size LOD thins strands with distance while keeping the coat's coverage.
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, cameraPosition, modelWorldMatrixInverse, modelWorldMatrix, cameraViewMatrix,
  vec3, vec4, float, normalize, cross, length, max, min, clamp, smoothstep, mix, pow, abs, dot, sqrt, step, varying,
  diffuseColor, positionViewDirection,
} from 'three/tsl';
import { CHAR_TOGGLES } from './materials';
import { RENDER } from '../render/settings';
import { temporalAlphaThreshold } from '../render/temporal';
import { fetchBinary } from './binfile';

export type StrandData = {
  count: number; perStrand: number; pos: Float32Array;
  color: Uint8Array; ao: Uint8Array; rank: Uint8Array; width: Uint8Array; normal: Int8Array;
};

export async function loadStrands(url: string): Promise<StrandData> {
  const buf = await fetchBinary(url);
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'KKF1' && magic !== 'KKF2') throw new Error(`${url} is not a strand file`);
  const N = dv.getUint32(4, true), P = dv.getUint32(8, true);
  const lo = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)];
  const hi = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];
  const pos = new Float32Array(N * P * 3);
  let o: number;
  if (magic === 'KKF1') {
    // Every point as uint16 within the file's bounds.
    o = 36;
    const q = new Uint16Array(buf, o, N * P * 3); o += N * P * 3 * 2;
    for (let i = 0; i < pos.length; i++) { const c = i % 3; pos[i] = lo[c] + (q[i] / 65535) * (hi[c] - lo[c]); }
  } else {
    // Roots as uint16 within the root bounds, then int8 steps from point to point.
    const scale = dv.getFloat32(36, true);
    o = 40;
    const qr = new Uint16Array(buf.slice(o, o + N * 6)); o += N * 6;
    const st = new Int8Array(buf, o, N * (P - 1) * 3); o += N * (P - 1) * 3;
    for (let s = 0; s < N; s++) {
      let x = lo[0] + (qr[s * 3] / 65535) * (hi[0] - lo[0]);
      let y = lo[1] + (qr[s * 3 + 1] / 65535) * (hi[1] - lo[1]);
      let z = lo[2] + (qr[s * 3 + 2] / 65535) * (hi[2] - lo[2]);
      const b = s * P * 3;
      pos[b] = x; pos[b + 1] = y; pos[b + 2] = z;
      for (let k = 1; k < P; k++) {
        const j = (s * (P - 1) + k - 1) * 3;
        x += st[j] * scale; y += st[j + 1] * scale; z += st[j + 2] * scale;
        pos[b + k * 3] = x; pos[b + k * 3 + 1] = y; pos[b + k * 3 + 2] = z;
      }
    }
  }
  const color = new Uint8Array(buf, o, N * 3); o += N * 3;
  const ao = new Uint8Array(buf, o, N); o += N;
  const rank = new Uint8Array(buf, o, N); o += N;
  const width = new Uint8Array(buf, o, N); o += N;
  const normal = new Int8Array(buf, o, N * 3);
  return { count: N, perStrand: P, pos, color, ao, rank, width, normal };
}

// Two vertices per strand point (one per ribbon side); the vertex shader spreads them to face the camera.
export function strandGeometry(d: StrandData) {
  const N = d.count, P = d.perStrand, V = N * P * 2;
  const position = new Float32Array(V * 3);
  const tan = new Int8Array(V * 4), nrm = new Int8Array(V * 4);
  const col = new Uint8Array(V * 4), prm = new Uint8Array(V * 4);
  const index = new Uint32Array(N * (P - 1) * 6);
  const t = new THREE.Vector3();
  let ii = 0;
  for (let s = 0; s < N; s++) {
    for (let k = 0; k < P; k++) {
      const a = (s * P + Math.max(0, k - 1)) * 3, b = (s * P + Math.min(P - 1, k + 1)) * 3;
      t.set(d.pos[b] - d.pos[a], d.pos[b + 1] - d.pos[a + 1], d.pos[b + 2] - d.pos[a + 2]).normalize();
      const p = (s * P + k) * 3;
      for (let side = 0; side < 2; side++) {
        const v = (s * P + k) * 2 + side;
        position[v * 3] = d.pos[p]; position[v * 3 + 1] = d.pos[p + 1]; position[v * 3 + 2] = d.pos[p + 2];
        tan[v * 4] = Math.round(t.x * 127); tan[v * 4 + 1] = Math.round(t.y * 127); tan[v * 4 + 2] = Math.round(t.z * 127);
        nrm[v * 4] = d.normal[s * 3]; nrm[v * 4 + 1] = d.normal[s * 3 + 1]; nrm[v * 4 + 2] = d.normal[s * 3 + 2];
        col[v * 4] = d.color[s * 3]; col[v * 4 + 1] = d.color[s * 3 + 1]; col[v * 4 + 2] = d.color[s * 3 + 2]; col[v * 4 + 3] = d.ao[s];
        prm[v * 4] = side * 255; prm[v * 4 + 1] = Math.round((k / (P - 1)) * 255); prm[v * 4 + 2] = d.rank[s]; prm[v * 4 + 3] = d.width[s];
      }
      if (k < P - 1) {
        const a0 = (s * P + k) * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        index[ii++] = a0; index[ii++] = b0; index[ii++] = a1;
        index[ii++] = a1; index[ii++] = b0; index[ii++] = b1;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('kkTan', new THREE.BufferAttribute(tan, 4, true));
  g.setAttribute('kkNrm', new THREE.BufferAttribute(nrm, 4, true));
  g.setAttribute('kkCol', new THREE.BufferAttribute(col, 4, true));
  g.setAttribute('kkPrm', new THREE.BufferAttribute(prm, 4, true));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.boundingSphere!.radius += 0.003;
  return g;
}

export type StrandLook = {
  rootDarken?: number; tipLighten?: number; spec?: number; specTint?: number; rim?: number; transmit?: number;
  widthScale?: number; minPixels?: number; lodBoost?: number; brightness?: number;
};

const INV_PI = 1 / Math.PI;

// Fur lighting from the strand tangent (T), the skin normal at the root (N, for the coat's overall volume)
// and how far along the strand the fragment is (t: roots sit in the coat's shadow, tips catch the light).
class HairLightingModel extends THREE.LightingModel {
  constructor(private T: any, private N: any, private t: any, private ao: any, private look: Required<StrandLook>) { super(); }

  direct({ lightDirection, lightColor, reflectedLight }: any) {
    const T = this.T, N = this.N, L = lightDirection, V = positionViewDirection, k = this.look;
    const wrap = clamp(dot(N, L).add(0.45).div(1.45), 0, 1);
    const tl = dot(T, L);
    const sinTL = sqrt(clamp(float(1).sub(tl.mul(tl)), 0, 1));
    const depth = mix(float(0.5), float(1), this.t);
    const diff = wrap.mul(mix(float(1), sinTL, 0.35)).mul(depth);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(diff).mul(diffuseColor.rgb).mul(INV_PI));
    // Two shifted lobes: a near-white primary and a coat-tinted secondary further toward the tip.
    const H = normalize(L.add(V));
    const T1 = normalize(T.add(N.mul(-0.1))), T2 = normalize(T.add(N.mul(0.14)));
    const th1 = dot(T1, H), th2 = dot(T2, H);
    const s1 = pow(clamp(float(1).sub(th1.mul(th1)), 0, 1), 45.0);
    const s2 = pow(clamp(float(1).sub(th2.mul(th2)), 0, 1), 12.0);
    const vis = smoothstep(-0.15, 0.3, dot(N, L)).mul(depth);
    const spec = vec3(s1.mul(k.spec)).add(diffuseColor.rgb.mul(s2.mul(k.spec * k.specTint)));
    reflectedLight.directSpecular.addAssign(lightColor.mul(spec).mul(vis));
    // Light passing through thin tips when the sun is behind them.
    const tt = pow(clamp(dot(V.negate(), L), 0, 1), 4.0).mul(this.t).mul(k.transmit);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(tt).mul(diffuseColor.rgb).mul(INV_PI));
  }

  indirect(builder: any) {
    const { irradiance, iblIrradiance, radiance, reflectedLight } = builder.context;
    const occ = mix(this.ao.mul(0.5), float(1), pow(this.t, 0.7));
    reflectedLight.indirectDiffuse.addAssign(irradiance.add(iblIrradiance).mul(diffuseColor.rgb).mul(INV_PI).mul(occ));
    // Sky light glowing through the fluff at the silhouette.
    const rim = pow(float(1).sub(abs(dot(this.N, positionViewDirection))), 3.0).mul(this.t).mul(this.look.rim);
    reflectedLight.indirectDiffuse.addAssign(iblIrradiance.mul(diffuseColor.rgb).mul(INV_PI).mul(rim));
    reflectedLight.indirectSpecular.addAssign(radiance.mul(0.025).mul(occ));
  }
}

class StrandNodeMaterial extends THREE.MeshStandardNodeMaterial {
  model!: HairLightingModel;
  setupLightingModel() { return this.model as any; }
}

// Shared across strand materials: the camera-facing ribbon, its width in pixels and the LOD that keeps coverage.
export function strandMaterial(look: StrandLook = {}, msaa = true) {
  const k: Required<StrandLook> = {
    rootDarken: 0.62, tipLighten: 1.1, spec: 0.12, specTint: 0.9, rim: 0.6, transmit: 0.5,
    widthScale: 1, minPixels: 0.85, lodBoost: 2.5, brightness: 1, ...look,
  };
  const m = new StrandNodeMaterial();
  const tanL = attribute('kkTan', 'vec4').xyz;
  const prm = attribute('kkPrm', 'vec4');
  const side = prm.x.mul(2).sub(1);
  const tAlong = prm.y;
  const width = prm.w.mul(0.00255 * k.widthScale);
  const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const toCam = camL.sub(positionLocal);
  const dist = length(toCam);
  const B = normalize(cross(tanL, toCam.div(dist)));
  const w = width.mul(mix(float(1), float(0.18), pow(tAlong, 0.9)));
  const pix = dist.mul(CHAR_TOGGLES.pixelAngle);
  // Far away, draw fewer, slightly wider strands so total coverage stays the same without shimmering.
  const keep = clamp(width.div(pix).mul(k.lodBoost), 0.12, 1.0);
  const alive = step(prm.z, keep);
  const geomW = max(w, pix.mul(k.minPixels)).mul(alive);
  const cov = min(float(1), w.div(max(geomW, 1e-9)).div(keep));
  m.positionNode = positionLocal.add(B.mul(side.mul(geomW).mul(0.5)));
  const vCov = varying(cov), vSide = varying(side), vT = varying(tAlong);
  const toView = (dir: any) => normalize(cameraViewMatrix.mul(vec4(normalize(modelWorldMatrix.mul(vec4(dir, 0)).xyz), 0)).xyz);
  const Tv = varying(toView(tanL));
  const Nv = varying(toView(attribute('kkNrm', 'vec4').xyz));
  const c = attribute('kkCol', 'vec4');
  const base = pow(c.rgb, vec3(2.2)).mul(k.brightness);
  const grad = mix(float(k.rootDarken), float(1), pow(vT, 0.6)).mul(mix(float(1), float(k.tipLighten), vT.mul(vT)));
  m.colorNode = vec4(base.mul(grad), 1);
  m.normalNode = Nv;
  m.roughness = 0.6;
  m.metalness = 0;
  m.opacityNode = vCov.mul(float(1).sub(smoothstep(0.55, 1.0, abs(vSide)).mul(0.6)));
  m.model = new HairLightingModel(Tv, Nv, vT, varying(c.a), k);
  m.side = THREE.DoubleSide;
  // Coverage: under TAA each pixel keeps the strand when its coverage beats a threshold that changes every frame,
  // so a few frames of history average to the true coverage; with MSAA the hardware does it (alpha to coverage).
  if (RENDER.aa === 'taa') m.alphaTestNode = temporalAlphaThreshold;
  else if (msaa) m.alphaToCoverage = true;
  else m.alphaTest = 0.4;
  return m;
}

export function strandMesh(data: StrandData, look: StrandLook = {}, msaa = true) {
  const geo = strandGeometry(data);
  const mesh = new THREE.Mesh(geo, strandMaterial(look, msaa));
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  // Strand files are sorted by LOD rank, so when the shader would drop the tail of the list anyway (small on
  // screen), skip drawing it: count[r] = strands with rank <= r.
  const lodBoost = look.lodBoost ?? 2.5;
  const sorted = data.rank.every((r, i) => i === 0 || data.rank[i - 1] <= r);
  if (sorted) {
    const count = new Uint32Array(256);
    for (const r of data.rank) count[r]++;
    for (let r = 1; r < 256; r++) count[r] += count[r - 1];
    let wMax = 0;
    for (const w of data.width) wMax = Math.max(wMax, w);
    const widthMax = (wMax / 255) * 0.00255 * (look.widthScale ?? 1);
    const radius = geo.boundingSphere!.radius;
    const per = (data.perStrand - 1) * 6;
    const c = new THREE.Vector3();
    mesh.onBeforeRender = (_r: any, _s: any, camera: THREE.Camera) => {
      c.copy(geo.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);
      // Nearest strand distance, so the near side never loses strands the shader would keep.
      const pix = Math.max(0.02, c.distanceTo(camera.position) - radius) * CHAR_TOGGLES.pixelAngle.value;
      const keep = Math.min(1, Math.max(0.12, (widthMax / Math.max(pix, 1e-9)) * lodBoost));
      geo.setDrawRange(0, count[Math.min(255, Math.ceil(keep * 255))] * per);
    };
  }
  return mesh;
}

