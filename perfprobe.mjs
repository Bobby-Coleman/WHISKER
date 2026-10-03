// Load-time and shader probe: records every WGSL module and pipeline the page creates (size, time in the call),
// waits for the game to report ready, prints the load-stage timings, then times frames with parts hidden.
// Usage: node perfprobe.mjs "http://localhost:4173/?still&q=high" [measure=1]  (W and H set the viewport)
import { chromium } from 'playwright-core';
const url = process.argv[2];
const measure = process.argv[3] !== '0';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 640), height: +(process.env.H || 360) } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  const rec = { modules: [], pipelines: 0, asyncPipelines: 0, syncPipelineMs: 0, fams: {} };
  window.__shaderRec = rec;
  const D = globalThis.GPUDevice && GPUDevice.prototype;
  if (!D) return;
  const csm = D.createShaderModule;
  D.createShaderModule = function (d) {
    const t0 = performance.now();
    const m = csm.call(this, d);
    rec.modules.push({ len: d.code.length, ms: performance.now() - t0, label: d.label || '' });
    // Family: the same code with every number blanked, so variants that differ only in constants group together.
    const fam = d.code.replace(/\d+(\.\d+)?/g, '#');
    let h = 0; for (let i = 0; i < fam.length; i++) h = (h * 31 + fam.charCodeAt(i)) | 0;
    const key = fam.length + ':' + h;
    const f = rec.fams[key] || (rec.fams[key] = { n: 0, len: d.code.length, label: d.label || '', first: d.code, second: null });
    f.n++; if (f.n === 2) f.second = d.code;
    return m;
  };
  const crp = D.createRenderPipeline;
  D.createRenderPipeline = function (d) {
    const t0 = performance.now();
    const p = crp.call(this, d);
    rec.pipelines++; rec.syncPipelineMs += performance.now() - t0;
    return p;
  };
  const crpa = D.createRenderPipelineAsync;
  D.createRenderPipelineAsync = function (d) { rec.asyncPipelines++; return crpa.call(this, d); };
});
const t0 = Date.now();
await page.goto(url);
while (Date.now() - t0 < 900000) {
  if (await page.evaluate(() => window.__ready || window.__error)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('ready after', (Date.now() - t0) / 1000, 's', 'error', await page.evaluate(() => window.__error));
console.log('load stages', JSON.stringify(await page.evaluate(() => window.__load)));
const rec = await page.evaluate(() => {
  const r = window.__shaderRec;
  const mods = r.modules.map((m) => m.len).sort((a, b) => b - a);
  return { modules: r.modules.length, totalKB: Math.round(mods.reduce((a, b) => a + b, 0) / 1024), biggestKB: mods.slice(0, 12).map((x) => Math.round(x / 1024)), pipelines: r.pipelines, asyncPipelines: r.asyncPipelines, syncPipelineMs: Math.round(r.syncPipelineMs) };
});
console.log('shaders', JSON.stringify(rec));
console.log(await page.evaluate(() => {
  const fams = Object.values(window.__shaderRec.fams).sort((a, b) => b.n - a.n);
  const out = [`${fams.length} families`];
  for (const f of fams.slice(0, 12)) {
    let where = '';
    if (f.second) {
      let i = 0; while (i < f.first.length && f.first[i] === f.second[i]) i++;
      where = ' | first diff: ' + JSON.stringify(f.first.slice(Math.max(0, i - 60), i + 40)) + ' vs ' + JSON.stringify(f.second.slice(Math.max(0, i - 60), i + 40));
    }
    out.push(`${f.n}x ${Math.round(f.len / 1024)}KB ${f.label}${where}`);
  }
  return out.join('\n');
}));
console.log('one frame', await page.evaluate(async () => { const kk = window.__kk; kk.skip(); kk.step(45); kk.renderer.info.reset(); const a = performance.now(); kk.render(); await kk.gpuIdle(); return Math.round(performance.now() - a) + ' ms ' + JSON.stringify(kk.info()); }));
if (measure) {
  const res = await page.evaluate(async () => {
    const kk = window.__kk;
    kk.skip(); kk.step(45);
    const m = async (label) => {
      const t = [];
      let info = null;
      for (let i = 0; i < 3; i++) { kk.renderer.info.reset(); const a = performance.now(); kk.render(); await kk.gpuIdle(); t.push(Math.round(performance.now() - a)); info = kk.info(); }
      return `${label}: ${t.join(',')} ms  draws ${info.drawCalls} tris ${info.triangles}`;
    };
    const out = [await m('all')];
    for (const k of ['grass', 'mist', 'veg', 'terrain', 'structures', 'fur', 'kitten', 'knight', 'shadows', 'far']) { kk.perf(k, false); out.push(await m('-' + k)); kk.perf(k, true); }
    return out.join('\n');
  });
  console.log(res);
}
console.log(logs.filter((l) => !/GPU stall|Fallback/.test(l)).slice(0, 25).join('\n'));
await browser.close();
