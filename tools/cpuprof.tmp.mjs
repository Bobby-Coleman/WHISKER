import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5173/?noreveal&q=high');
const t0 = Date.now();
while (Date.now() - t0 < 200000) { if (await page.evaluate(() => window.__done || window.__ready || window.__error)) break; await new Promise((r) => setTimeout(r, 500)); }
await page.evaluate(() => { document.querySelector('#hud .title').style.display = 'none'; });
await new Promise((r) => setTimeout(r, 8000));
const client = await page.context().newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 200 });
await client.send('Profiler.start');
await new Promise((r) => setTimeout(r, 4000));
const { profile } = await client.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas; let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]); const t = dt[i] / 1000; total += t;
  const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + t);
}
// Inclusive time per function: walk parents.
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const t = dt[i] / 1000; const seen = new Set(); let id = profile.samples[i];
  while (id !== undefined) { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`; if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) || 0) + t); } id = parent.get(id); }
}
console.log('total ms', total.toFixed(0));
console.log('--- self');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(0).padStart(6), k);
console.log('--- inclusive');
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(v.toFixed(0).padStart(6), k);
await browser.close();
