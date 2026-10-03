// Usage: node shots.mjs url plan.json  -- plan: [{ "js": "...", "out": "a.png", "wait": 1500 }]
import { chromium } from 'playwright-core';
import fs from 'fs';
const url = process.argv[2];
const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const gpu = process.env.GPU !== '0';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (gpu) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 720) } });
const logs = [];
page.on('console', m => { if (m.type() !== 'info') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(url);
while (Date.now() - t0 < 240000) { if (await page.evaluate(() => window.__done || window.__error)) break; await new Promise(r => setTimeout(r, 500)); }
console.log('loaded in', (Date.now() - t0) / 1000, 's backend', await page.evaluate(() => window.__backend), 'err', await page.evaluate(() => window.__error));
for (const s of plan) {
  const t1 = Date.now();
  try {
    const r = await page.evaluate(s.js || '0');
    if (r !== undefined && r !== null) console.log(s.out, 'js ->', typeof r === 'string' ? r : JSON.stringify(r));
  } catch (e) { console.log('eval error', s.out, e.message); }
  await new Promise(r => setTimeout(r, s.wait ?? 1500));
  if (s.out) { await page.screenshot({ path: s.out, timeout: 120000 }); console.log('shot', s.out, (Date.now() - t1) / 1000, 's'); }
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
