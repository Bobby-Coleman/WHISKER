// Tiling noise baked once on the CPU into a small RGBA texture. One texture read replaces a MaterialX noise call,
// which costs dozens of hash and gradient operations per octave. That mattered most for the fog (run for every
// fragment of every fogged surface, grass overdraw included), the sky and the wind (run for every blade vertex).
// Each channel is matched to the spread of the noise it replaces, so the look stays where it was tuned.
//   r: the fog's own 3-octave MaterialX fBm, baked as it was at the start of play (fog patches, sky mottling)
//   g: 3-octave fBm, gain 0.55 (mist cards)
//   b, a: single-octave gradient noise, two seeds (wind gusts and ripples)
import * as THREE from 'three/webgpu';
import { texture, vec2 } from 'three/tsl';

const SIZE = 256; // texels per tile
export const NOISE_CELLS = 8; // base-octave noise units per tile
const ENC = 0.4; // stored as v * ENC + 0.5, so values out to +-1.25 survive 8 bits
const PERLIN_STD = 0.265; // spread of one octave of MaterialX 3D Perlin noise (measured)

function hash(ix: number, iy: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// Gradient noise on a lattice that wraps every `period` cells, so the texture tiles seamlessly.
function octave(period: number, seed: number) {
  const gx = new Float32Array(period * period), gy = new Float32Array(period * period);
  for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) {
    const a = hash(i, j, seed) * Math.PI * 2;
    gx[j * period + i] = Math.cos(a); gy[j * period + i] = Math.sin(a);
  }
  const out = new Float32Array(SIZE * SIZE);
  let s2 = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fxp = ((x + 0.5) / SIZE) * period, fyp = ((y + 0.5) / SIZE) * period;
    const x0 = Math.floor(fxp), y0 = Math.floor(fyp);
    const dx = fxp - x0, dy = fyp - y0;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const d = (i: number, j: number, ox: number, oy: number) => gx[j * period + i] * ox + gy[j * period + i] * oy;
    const u = fade(dx), v = fade(dy);
    const a = d(x0, y0, dx, dy) + (d(x1, y0, dx - 1, dy) - d(x0, y0, dx, dy)) * u;
    const b = d(x0, y1, dx, dy - 1) + (d(x1, y1, dx - 1, dy - 1) - d(x0, y1, dx, dy - 1)) * u;
    const n = a + (b - a) * v;
    out[y * SIZE + x] = n; s2 += n * n;
  }
  // Normalise to the spread of the noise being replaced.
  const k = PERLIN_STD / Math.sqrt(s2 / out.length);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

// MaterialX gradient noise as three's mx_perlin_noise_float computes it (same hash, gradients and fade), with the
// lattice wrapped to `period` cells from `origin` so the bake tiles. Inside that window it is the original noise,
// so the fog keeps the mist banks it was tuned with.
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
function mxHash(x: number, y: number, z: number) {
  let a = (0xdeadbeef + (3 << 2) + 13) >>> 0, b = a, c = a;
  a = (a + x) >>> 0; b = (b + y) >>> 0; c = (c + z) >>> 0;
  c = ((c ^ b) - rotl(b, 14)) >>> 0; a = ((a ^ c) - rotl(c, 11)) >>> 0; b = ((b ^ a) - rotl(a, 25)) >>> 0;
  c = ((c ^ b) - rotl(b, 16)) >>> 0; a = ((a ^ c) - rotl(c, 4)) >>> 0; b = ((b ^ a) - rotl(a, 14)) >>> 0;
  c = ((c ^ b) - rotl(b, 24)) >>> 0;
  return c;
}
function mxGrad(h: number, x: number, y: number, z: number) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
function mxPerlin(px: number, py: number, pz: number, period: number, origin: number) {
  const X = Math.floor(px), Y = Math.floor(py), Z = Math.floor(pz);
  const fx = px - X, fy = py - Y, fz = pz - Z;
  const wrap = (i: number) => ((((i - origin) % period) + period) % period) + origin;
  const g = (i: number, j: number, k: number) => mxGrad(mxHash(wrap(X + i), wrap(Y + j), Z + k), fx - i, fy - j, fz - k);
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const r = l(
    l(l(g(0, 0, 0), g(1, 0, 0), u), l(g(0, 1, 0), g(1, 1, 0), u), v),
    l(l(g(0, 0, 1), g(1, 0, 1), u), l(g(0, 1, 1), g(1, 1, 1), u), v), w);
  return r * 0.982;
}
// The window starts at -NOISE_CELLS/2, so noise positions around the origin (where play starts) need no wrap.
export const MX_ORIGIN = -NOISE_CELLS / 2;
function mxFbm(octaves: number, gain: number, z: number) {
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let px = MX_ORIGIN + ((x + 0.5) / SIZE) * NOISE_CELLS, py = MX_ORIGIN + ((y + 0.5) / SIZE) * NOISE_CELLS, pz = z;
    let sum = 0, amp = 1, period = NOISE_CELLS, origin = MX_ORIGIN;
    for (let o = 0; o < octaves; o++) {
      sum += amp * mxPerlin(px, py, pz, period, origin);
      amp *= gain; px *= 2; py *= 2; pz *= 2; period *= 2; origin *= 2;
    }
    out[y * SIZE + x] = sum;
  }
  return out;
}

function fbm(octaves: number, gain: number, seed: number) {
  const sum = new Float32Array(SIZE * SIZE);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const n = octave(NOISE_CELLS << o, seed * 31 + o);
    for (let i = 0; i < sum.length; i++) sum[i] += amp * n[i];
    amp *= gain;
  }
  return sum;
}

function build() {
  const chans = [mxFbm(3, 0.5, 0), fbm(3, 0.55, 23), octave(NOISE_CELLS, 37), octave(NOISE_CELLS, 41)];
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((chans[c][i] * ENC + 0.5) * 255)));
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.name = 'BakedNoise';
  t.needsUpdate = true;
  return t;
}

export const NOISE_TEX = build();

// Samples the baked noise at a 2D noise-space position (one unit = one base-octave cell) and returns the four
// channels decoded back to signed noise. `full` reads the full-detail level explicitly: vertex shaders have no
// derivatives to choose a level with, and the fog wants the noise unfiltered, as it was when computed per pixel.
export function bakedNoise(p: any, full = false) {
  const s: any = texture(NOISE_TEX, vec2(p).div(NOISE_CELLS));
  return (full ? s.level(0) : s).sub(0.5).div(ENC);
}
