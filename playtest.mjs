// Scripted play-test through the debug API: movement, companion, switching and all three puzzles.
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/?still&q=low';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await page.goto(url);
const t0 = Date.now();
while (Date.now() - t0 < 240000) { if (await page.evaluate(() => window.__done || window.__error)) break; await new Promise(r => setTimeout(r, 500)); }
const ev = (js) => page.evaluate(js);
const st = async (label) => {
  const s = await ev(`(() => { const s = __kk.state(); const r = v => v.map(x => +x.toFixed(2)); return JSON.stringify({ active: s.active, k: r(s.kpos), n: r(s.npos), region: s.region, comp: s.comp, prompt: s.prompt, p: Object.entries(s.puzzles).filter(([k, v]) => v).map(([k]) => k).join(',') }); })()`);
  console.log(label.padEnd(34), s);
};
const shot = async (name) => { await ev('__kk.render(); 1'); await new Promise(r => setTimeout(r, 3500)); await page.screenshot({ path: 'caps/' + name, timeout: 120000 }); console.log('shot', name); };

await ev('__kk.skip(); __kk.step(10); __kk.camYaw(0, 0.25); 1');
await st('start');
// A. Run north for four seconds; the knight should follow.
await ev('__kk.simMove(0, 1, 4); __kk.step(120); 1'); await st('after 4 s run north');
await ev('__kk.step(60); 1'); await st('settled 2 s');
// B. Switch to the knight and walk; the kitten follows.
await ev('__kk.switchChar(); __kk.simMove(0, 1, 3, true); __kk.step(90); 1'); await st('knight walked 3 s');
await ev('__kk.step(60); 1'); await st('settled');
await ev('__kk.switchChar(); 1');
// C. The culvert: the kitten fits, the knight does not.
await ev('__kk.teleport("kitten", 13.5, -41.4, Math.PI); __kk.teleport("knight", 11.5, -40.5, Math.PI); __kk.wait(); __kk.camYaw(0, 0.25); __kk.simMove(0, 1, 1.6); __kk.step(48); 1');
await st('kitten through culvert');
await ev('__kk.switchChar(); __kk.teleport("knight", 13.5, -41.4, Math.PI); __kk.simMove(0, 1, 1.6); __kk.step(48); 1');
await st('knight at culvert (blocked?)');
await ev('__kk.switchChar(); 1');
// Winch.
await ev('__kk.teleport("kitten", 5.9, -44.62, Math.PI); __kk.step(2); 1'); await st('kitten at winch');
await ev('__kk.step(45); __kk.interact(); __kk.step(40); 1');
await shot('pt_winch.png');
await ev('__kk.step(120); 1'); await st('after winch');
// D. Weights: the knight steps onto the flagstone and is left there by switching; the kitten crawls to the small stone.
await ev('__kk.switchChar(); __kk.teleport("knight", 15, -49.5, 0); __kk.step(4); __kk.switchChar(); __kk.step(2); 1'); await st('knight left on flagstone');
await ev('__kk.teleport("kitten", 1.2, -49.5, -Math.PI / 2); __kk.camYaw(Math.PI / 2, 0.25); __kk.simMove(0, 1, 1.6); __kk.step(48); 1'); await st('kitten through crawl gap');
await shot('pt_pocket.png');
await ev('__kk.teleport("kitten", -2.1, -49.5, 0); __kk.step(40); 1'); await st('both stones');
await ev('__kk.step(90); 1'); await st('chapel opening');
// E. Shield.
await ev('__kk.teleport("kitten", 7, -59.3, Math.PI); __kk.step(2); __kk.interact(); __kk.step(10); 1'); await st('shield');
// F. Tower: lift, place on the sill, rope, bar.
await ev('__kk.teleport("kitten", -28.8, -18.6, 0); __kk.teleport("knight", -28.6, -17.6, Math.PI); __kk.switchChar(); __kk.step(2); 1'); await st('tower approach');
await ev('__kk.interact(); __kk.step(45); 1'); await shot('pt_lift.png'); await st('lifted');
await ev('__kk.teleport("knight", -34, -17.25, Math.PI); __kk.step(4); 1'); await st('knight at sill');
await ev('__kk.interact(); __kk.step(90); 1'); await st('placed on sill');
await ev('__kk.switchChar(); __kk.step(4); 1'); await st('kitten on sill');
await ev('(() => { const p = __kk.puzzles.items.find(i => i.id === "rope").pos(); return JSON.stringify(p.toArray().map(v => +v.toFixed(2))); })()').then(v => console.log('rope at', v));
await ev('(() => { const r = __kk.puzzles.items.find(i => i.id === "rope").pos(); const k = __kk.kitten.body.pos; const dx = r.x - k.x, dz = r.z - k.z; __kk.camYaw(Math.atan2(-dx, -dz), 0.3); __kk.simMove(0, 1, 2.0, true); __kk.step(60); return Math.hypot(dx, dz).toFixed(2); })()').then(v => console.log('kitten to rope dist', v));
await st('kitten walked toward rope');
await ev('__kk.interact(); __kk.step(20); 1'); await shot('pt_rope.png');
await ev('__kk.step(150); 1'); await st('after rope');
await ev('__kk.step(2); 1');
await ev('(() => { const b = __kk.puzzles.items.find(i => i.id === "bar").pos(); const k = __kk.kitten.body.pos; return JSON.stringify({ bar: b.toArray().map(v => +v.toFixed(2)), d: Math.hypot(b.x - k.x, b.z - k.z).toFixed(2) }); })()').then(v => console.log('bar', v));
await ev('(() => { const b = __kk.puzzles.items.find(i => i.id === "bar").pos(); const k = __kk.kitten.body.pos; const dx = b.x - k.x, dz = b.z - k.z; const d = Math.hypot(dx, dz); __kk.camYaw(Math.atan2(-dx, -dz), 0.3); __kk.simMove(0, 1, Math.max(0.2, (d - 0.45) / 1.3), true); __kk.step(Math.ceil(60 * Math.max(0.2, (d - 0.45) / 1.3)) + 20); return d.toFixed(2); })()').then(v => console.log('kitten to bar dist', v));
await ev('(() => { const b = __kk.puzzles.items.find(i => i.id === "bar").pos(); const k = __kk.kitten.body.pos; return Math.hypot(b.x - k.x, b.z - k.z).toFixed(2); })()').then(v => console.log('now from bar', v));
await st('kitten at bar');
await ev('__kk.interact(); __kk.step(30); 1'); await shot('pt_bar.png');
await ev('__kk.step(150); 1'); await st('after bar');
// G. The knight walks in through the opened door.
await ev('__kk.switchChar(); __kk.teleport("knight", -28.4, -22, -Math.PI / 2); __kk.step(2); __kk.camYaw(Math.PI / 2, 0.25); __kk.simMove(0, 1, 2.2); __kk.step(140); 1'); await st('knight walked in the door');
await shot('pt_inside.png');
await ev('__kk.step(300); 1'); await st('later');
console.log(errs.slice(0, 20).join('\n'));
await browser.close();
