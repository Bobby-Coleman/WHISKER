// Writes dist/artifact.html: the page body the Artifact host wraps in its own document skeleton.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
// Binary model files go out as base64 text (the page host only serves web file types), gzipped first when that
// makes them smaller; src/chars/binfile.ts decodes both.
// The manifest lists the size of every file the page fetches from models/, so the loading bar can show real progress.
const manifest = {};
for (const f of readdirSync('dist/models')) {
  if (/\.png$/.test(f)) manifest[f] = statSync(`dist/models/${f}`).size;
  if (!/\.(glb|kkf|bin)$/.test(f)) continue;
  const raw = readFileSync(`dist/models/${f}`);
  const gz = gzipSync(raw, { level: 9 });
  const txt = (gz.length < raw.length * 0.95 ? gz : raw).toString('base64');
  writeFileSync(`dist/models/${f}.txt`, txt);
  manifest[`${f}.txt`] = txt.length;
}
writeFileSync('dist/models/manifest.json', JSON.stringify(manifest));
const html = readFileSync('dist/index.html', 'utf8');
const js = html.match(/assets\/index-[\w-]+\.js/)[0];
const page = `<title>Whisker</title>
<style>
/* One committed look: a full-screen overcast moor, so the page keeps its own dark ground in either viewer theme. */
:root{--ground:#1d2020;--ink:#e8e4da;color-scheme:dark}
html,body{height:100%;margin:0;overflow:hidden;background:var(--ground);color:var(--ink);font-family:Georgia,'Times New Roman',serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#app{position:fixed;inset:0}
canvas{width:100%;height:100%;display:block;touch-action:none}
</style>
<div id="app"></div>
<div id="boot" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;color:#ece8de;font:clamp(34px,6vw,64px) Georgia,'Times New Roman',serif;letter-spacing:.18em;text-transform:uppercase">Whisker<span style="font-size:13px;letter-spacing:.1em;text-transform:none;opacity:.6">Loading…</span></div>
<script type="module" src="./${js}"></script>
`;
writeFileSync('dist/artifact.html', page);
// Local stand-in for the host skeleton, for a boot check through vite preview.
writeFileSync('dist/_wrapped.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui;background:#fafaf8}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n${page}</body></html>`);
console.log(js);
