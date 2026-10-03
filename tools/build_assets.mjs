// Turns the CC0 sources in assets-src/ (tools/fetch_assets.mjs) into the web files the game loads:
//   public/models/env_<id>.hdr   1K equirect HDR for image-based lighting (prefiltered at load)
//   public/models/sky_<id>.jpg   upper hemisphere (+90 to -6 degrees) of the 4K HDR as 8-bit sRGB, for the visible sky
//   public/models/env.json       per-HDRI scale and the measured horizon, zenith and irradiance colours
//   public/tex/<id>_a.webp       albedo RGB + height A
//   public/tex/<id>_b.webp       normal X, normal Y (OpenGL convention), roughness, ambient occlusion
// Usage: node tools/build_assets.mjs
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = 'assets-src';
fs.mkdirSync('public/models', { recursive: true });
fs.mkdirSync('public/tex', { recursive: true });

// ---- Radiance HDR (RGBE) reader: header, then new-style run-length scanlines (or flat RGBE).
function readHDR(file) {
  const buf = fs.readFileSync(file);
  let p = 0;
  const line = () => { let s = ''; while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]); p++; return s; };
  let l = line();
  if (!l.startsWith('#?')) throw new Error('not an HDR file: ' + file);
  while ((l = line()) !== '') { /* header lines */ }
  const m = line().match(/-Y (\d+) \+X (\d+)/);
  if (!m) throw new Error('unsupported HDR orientation');
  const H = +m[1], W = +m[2];
  const out = new Float32Array(W * H * 3);
  const scan = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = v; }
          else for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = buf[p++];
        }
      }
    } else { for (let i = 0; i < W * 4; i++) scan[i] = buf[p++]; }
    for (let x = 0; x < W; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0; // 2^(e-128) / 256
      const o = (y * W + x) * 3;
      out[o] = scan[x * 4] * f; out[o + 1] = scan[x * 4 + 1] * f; out[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { W, H, data: out };
}

const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const HDRIS = ['kloofendal_misty_morning', 'misty_farm_road', 'kloppenheim_01'];
const meta = {};
for (const id of HDRIS) {
  const hdr = readHDR(`${SRC}/hdri/${id}_4k.hdr`);
  const { W, H, data } = hdr;
  const rowOf = (elevDeg) => Math.round(((90 - elevDeg) / 180) * H);
  // Measurements in the HDR's own units: mean colour in elevation bands, and the cosine-weighted irradiance the
  // upper hemisphere sends onto a level surface (what lights the ground).
  const band = (e0, e1) => {
    const r0 = rowOf(e1), r1 = rowOf(e0);
    const s = [0, 0, 0]; let n = 0;
    for (let y = r0; y < r1; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; s[0] += data[o]; s[1] += data[o + 1]; s[2] += data[o + 2]; n++; }
    return s.map((v) => +(v / n).toFixed(5));
  };
  const irr = [0, 0, 0];
  for (let y = 0; y < rowOf(0); y++) {
    const el = (90 - ((y + 0.5) / H) * 180) * Math.PI / 180;
    const w = Math.sin(el) * Math.cos(el) * (Math.PI / H) * (2 * Math.PI / W); // cos(theta) dOmega
    for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; irr[0] += data[o] * w; irr[1] += data[o + 1] * w; irr[2] += data[o + 2] * w; }
  }
  // Where the hidden sun sits: the radiance-weighted mean direction of the brightest 2% of the upper hemisphere
  // (equirect u = 0.5 looks down -Z, u increases toward +X... measured as three's equirect mapping samples it).
  const lums = [];
  for (let y = 0; y < rowOf(0); y += 2) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 3; lums.push(lum(data[o], data[o + 1], data[o + 2])); }
  lums.sort((a, b) => a - b);
  const thr = lums[Math.floor(lums.length * 0.98)];
  const sd = [0, 0, 0]; let sw = 0, sl = 0;
  for (let y = 0; y < rowOf(0); y += 2) for (let x = 0; x < W; x += 2) {
    const o = (y * W + x) * 3, L = lum(data[o], data[o + 1], data[o + 2]);
    if (L < thr) continue;
    const el = (90 - ((y + 0.5) / H) * 180) * Math.PI / 180, az = ((x + 0.5) / W) * 2 * Math.PI;
    const w = L * Math.cos(el);
    sd[0] += w * Math.cos(el) * Math.sin(az); sd[1] += w * Math.sin(el); sd[2] += -w * Math.cos(el) * Math.cos(az);
    sw += w; sl += L;
  }
  const sn = Math.hypot(...sd);
  const sunDir = sd.map((v) => +(v / sn).toFixed(4));
  const sunLum = +(sl / Math.max(1, sw / thr)).toFixed(4);
  // Sky image: +90 down to -6 degrees, scaled so that all but the brightest 0.3% of the sky fits in 8 bits.
  const r1 = rowOf(-6);
  const maxes = [];
  for (let y = 0; y < r1; y += 2) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 3; maxes.push(Math.max(data[o], data[o + 1], data[o + 2])); }
  maxes.sort((a, b) => a - b);
  const scale = maxes[Math.floor(maxes.length * 0.997)];
  const SW = 4096, SH = 1024;
  const px = Buffer.alloc(SW * SH * 3);
  for (let y = 0; y < SH; y++) {
    const sy = Math.min(r1 - 1, Math.floor(((y + 0.5) / SH) * r1));
    for (let x = 0; x < SW; x++) {
      const sx = Math.floor(((x + 0.5) / SW) * W);
      const o = (sy * W + sx) * 3, q = (y * SW + x) * 3;
      for (let c = 0; c < 3; c++) px[q + c] = Math.round(255 * srgb(Math.min(1, data[o + c] / scale)));
    }
  }
  await sharp(px, { raw: { width: SW, height: SH, channels: 3 } }).jpeg({ quality: 88, mozjpeg: true }).toFile(`public/models/sky_${id}.jpg`);

  meta[id] = {
    skyScale: +scale.toFixed(5),
    skyElevation: [90, -6],
    horizon: band(0, 4),
    lowSky: band(4, 15),
    zenith: band(60, 90),
    irradiance: irr.map((v) => +v.toFixed(5)),
    irradianceLum: +lum(...irr).toFixed(5),
    sunDir, sunThreshold: +thr.toFixed(4),
  };
  void sunLum;
  console.log(id, JSON.stringify(meta[id]));
}
fs.writeFileSync('public/models/env.json', JSON.stringify(meta, null, 1));

// ---- PBR texture sets, packed two to a material.
const TEX = [
  ['leafy_grass', 1024], ['brown_mud_02', 1024], ['castle_wall_varriation', 1024], ['castle_wall_slates', 1024],
  ['mossy_rock', 1024], ['weathered_planks', 1024], ['roof_slates_02', 1024],
];
const raw = async (file, size, channels) => (await sharp(file).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().toColourspace(channels === 1 ? 'b-w' : 'srgb').raw().toBuffer());
for (const [id, size] of TEX) {
  const dir = `${SRC}/tex/${id}/${id}_`;
  const f = (m) => `${dir}${m}_2k.jpg`;
  const diff = await raw(f('Diffuse'), size, 3);
  const nor = await raw(f('nor_gl'), size, 3);
  const arm = await raw(f('arm'), size, 3);
  const disp = fs.existsSync(f('Displacement')) ? await raw(f('Displacement'), size, 1) : null;
  const a = Buffer.alloc(size * size * 4), b = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    a[i * 4] = diff[i * 3]; a[i * 4 + 1] = diff[i * 3 + 1]; a[i * 4 + 2] = diff[i * 3 + 2]; a[i * 4 + 3] = disp ? disp[i] : 128;
    b[i * 4] = nor[i * 3]; b[i * 4 + 1] = nor[i * 3 + 1]; b[i * 4 + 2] = arm[i * 3 + 1]; b[i * 4 + 3] = arm[i * 3];
  }
  await sharp(a, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 82, alphaQuality: 85, effort: 6 }).toFile(`public/tex/${id}_a.webp`);
  await sharp(b, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 80, alphaQuality: 85, effort: 6 }).toFile(`public/tex/${id}_b.webp`);
  console.log(id, size, (fs.statSync(`public/tex/${id}_a.webp`).size / 1024).toFixed(0) + ' KB', (fs.statSync(`public/tex/${id}_b.webp`).size / 1024).toFixed(0) + ' KB');
}
console.log('done');
