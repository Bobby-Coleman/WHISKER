// Packs the CC0 Quaternius props a level uses (from public/packs-review, downloaded from OpenGameArt; not committed)
// into public/props/<pack>/ for the game: each glTF and its buffer copied as they are, the shared textures resized
// to 1024 and re-encoded (JPEG for colour, roughness and ORM; PNG where there is alpha; normal maps as high-quality
// JPEG), with the glTFs' image paths rewritten to match.
// Usage: node tools/pack_props.mjs pack/Name [pack/Name ...]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'public/packs-review', DST = 'public/props';
const done = new Map(); // source image path -> packed file name

async function packImage(pack, uri) {
  const src = path.join(SRC, pack, uri);
  const key = src;
  if (done.has(key)) return done.get(key);
  const meta = await sharp(src).metadata();
  const alpha = meta.channels === 4 && !/normal/i.test(uri) && (await sharp(src).stats()).channels[3]?.min < 250;
  const base = uri.replace(/\.(png|jpg|jpeg)$/i, '');
  const name = base + (alpha ? '.png' : '.jpg');
  const out = path.join(DST, pack, name);
  let img = sharp(src).resize({ width: Math.min(1024, meta.width ?? 1024), withoutEnlargement: true });
  img = alpha ? img.png({ compressionLevel: 9, palette: false }) : img.removeAlpha().jpeg({ quality: /normal/i.test(uri) ? 92 : 86, mozjpeg: true });
  await img.toFile(out);
  done.set(key, name);
  return name;
}

for (const item of process.argv.slice(2)) {
  const [pack, name] = item.split('/');
  const gltfPath = path.join(SRC, pack, name + '.gltf');
  const j = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  fs.mkdirSync(path.join(DST, pack), { recursive: true });
  for (const b of j.buffers ?? []) fs.copyFileSync(path.join(SRC, pack, b.uri), path.join(DST, pack, b.uri));
  for (const im of j.images ?? []) im.uri = await packImage(pack, im.uri);
  fs.writeFileSync(path.join(DST, pack, name + '.gltf'), JSON.stringify(j));
  console.log('packed', item);
}
let total = 0;
for (const pack of fs.readdirSync(DST)) for (const f of fs.readdirSync(path.join(DST, pack))) total += fs.statSync(path.join(DST, pack, f)).size;
console.log('public/props total', (total / 1048576).toFixed(1), 'MB');
