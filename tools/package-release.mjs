// Bundle only the default game and the CC0 rig it actually loads; legacy experiments stay in npm run build.
import fs from 'node:fs';
fs.mkdirSync('release/chars',{recursive:true});
for(const f of ['mannequin-lite.glb','ual_anims-lite.glb']) fs.copyFileSync(`public/chars/${f}`,`release/chars/${f}`);
fs.cpSync('public/licenses','release/licenses',{recursive:true});
fs.copyFileSync('public/CREDITS.html','release/CREDITS.html');
fs.writeFileSync('release/.nojekyll','');
let bytes=0,files=0;
function count(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=`${dir}/${d.name}`;if(d.isDirectory())count(f);else{bytes+=fs.statSync(f).size;files++;}}}
count('release');console.log(`Playable release: ${files} files, ${(bytes/1048576).toFixed(2)} MB uncompressed`);
