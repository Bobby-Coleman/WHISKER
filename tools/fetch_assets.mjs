// Downloads the CC0 source assets this build uses from Poly Haven (https://polyhaven.com, CC0 1.0) into
// assets-src/ (not committed; tools/build_assets.mjs turns them into the web-sized files under public/).
// Usage: node tools/fetch_assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'assets-src';
const UA = { 'User-Agent': 'Whisker-asset-fetch/1.0 (github.com/Bobby-Coleman/WHISKER)' };

// [asset id, kind, resolution, maps]
const HDRIS = [
  ['kloofendal_misty_morning', '4k'],
  ['misty_farm_road', '4k'],
  ['kloppenheim_01', '4k'],
];
const TEXTURES = [
  ['leafy_grass', '2k', ['Diffuse', 'nor_gl', 'arm', 'Displacement']],
  ['brown_mud_02', '2k', ['Diffuse', 'nor_gl', 'arm', 'Displacement']],
  ['castle_wall_varriation', '2k', ['Diffuse', 'nor_gl', 'arm', 'Displacement']],
  ['castle_wall_slates', '2k', ['Diffuse', 'nor_gl', 'arm', 'Displacement']],
  ['mossy_rock', '2k', ['Diffuse', 'nor_gl', 'arm', 'Displacement']],
  ['weathered_planks', '2k', ['Diffuse', 'nor_gl', 'arm']],
  ['roof_slates_02', '2k', ['Diffuse', 'nor_gl', 'arm']],
];
const MODELS = [
  ['rock_moss_set_01', '1k'],
  ['kite_shield', '1k'],
];

async function get(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log('  ', path.basename(file), (fs.statSync(file).size / 1048576).toFixed(1), 'MB');
}
async function files(id) {
  const r = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA });
  return r.json();
}

for (const [id, res] of HDRIS) {
  console.log(id);
  const f = await files(id);
  await get(f.hdri[res].hdr.url, `${OUT}/hdri/${id}_${res}.hdr`);
  await get(f.hdri['1k'].hdr.url, `${OUT}/hdri/${id}_1k.hdr`);
}
for (const [id, res, maps] of TEXTURES) {
  console.log(id);
  const f = await files(id);
  for (const m of maps) {
    const e = f[m][res];
    const fmt = e.jpg ? 'jpg' : 'png';
    await get(e[fmt].url, `${OUT}/tex/${id}/${id}_${m}_${res}.${fmt}`);
  }
}
for (const [id, res] of MODELS) {
  console.log(id);
  const f = await files(id);
  const g = f.gltf[res].gltf;
  await get(g.url, `${OUT}/models/${id}/${id}_${res}.gltf`);
  for (const [rel, inc] of Object.entries(g.include || {})) await get(inc.url, `${OUT}/models/${id}/${rel}`);
}
console.log('done');
