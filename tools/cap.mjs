// Review captures and frame timing on this machine's real GPU through installed Chrome (WebGPU, D3D12).
// Usage: node tools/cap.mjs <url> <plan.json> [outDir]
//   plan: [{ "js": "<expression run in the page>", "out": "name.png", "wait": ms }, ...]
// Env: W, H (viewport), HEADED=1 (show the window), GPU=intel (prefer the integrated adapter), MOBILE=1 (touch phone).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2];
const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const outDir = process.argv[4] || 'caps';
fs.mkdirSync(outDir, { recursive: true });
const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
if (process.env.GPU === 'intel') args.push('--force_low_power_gpu');
else args.push('--force_high_performance_gpu');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: process.env.HEADED !== '1',
  args,
});
// MOBILE=1: a touch phone (coarse pointer, on-screen controls).
const mobile = process.env.MOBILE === '1' ? { isMobile: true, hasTouch: true } : {};
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, deviceScaleFactor: 1, ...mobile });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(url);
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => (window).__ready || (window).__done || (window).__error)) break;
  await new Promise((r) => setTimeout(r, 400));
}
const adapter = await page.evaluate(async () => {
  try { const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }); const i = a && (a.info || (await a.requestAdapterInfo?.())); return i ? `${i.vendor} ${i.architecture} ${i.description || ''}` : 'none'; } catch (e) { return String(e); }
});
console.log('loaded in', (Date.now() - t0) / 1000, 's | backend', await page.evaluate(() => (window).__backend), '| adapter', adapter, '| error', await page.evaluate(() => (window).__error || null));
for (const s of plan) {
  const t1 = Date.now();
  try {
    const r = await page.evaluate(s.js || '0');
    if (r !== undefined && r !== null) console.log((s.out || s.label || '').padEnd(28), '->', typeof r === 'string' ? r : JSON.stringify(r));
  } catch (e) { console.log('eval error', s.out, e.message); }
  await new Promise((r) => setTimeout(r, s.wait ?? 800));
  if (s.out) { await page.screenshot({ path: path.join(outDir, s.out), timeout: 120000 }); console.log('shot', s.out, ((Date.now() - t1) / 1000).toFixed(1), 's'); }
}
const errs = logs.filter((l) => /error|warn/i.test(l) && !/GPU stall|Fallback|DevTools/.test(l));
if (errs.length) console.log(errs.slice(0, 25).join('\n'));
await browser.close();
