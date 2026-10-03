// Performance overlay: frame rate, frame time with the worst recent frame, main-thread and GPU time, render
// resolution and adaptive scale, draw calls and triangles, and how long loading took. P toggles it.
const CSS = `
#stats{position:fixed;left:12px;top:62px;z-index:5;pointer-events:none;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#e8e4da;background:rgba(12,14,14,.62);padding:6px 8px 7px;border-radius:3px;white-space:pre;font-variant-numeric:tabular-nums}
#stats canvas{display:block;margin-top:5px;width:150px;height:30px}
#stats .warn{color:#e2b56c}
#stats .bad{color:#e08a76}
`;

export type StatsInfo = {
  width: number; height: number; scale: number; adaptive: boolean;
  backend: string; tier: string; calls: number; triangles: number;
};

const N = 150;

export class StatsPanel {
  readonly el: HTMLDivElement;
  private textEl: HTMLDivElement;
  private ctx: CanvasRenderingContext2D | null;
  private dts = new Float32Array(N);
  private cpus = new Float32Array(N);
  private head = 0;
  private count = 0;
  private acc = 0;
  visible = true;
  gpuMs: number | null = null;
  gpuSupported = false;
  private loadLine = '';

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'stats';
    this.textEl = document.createElement('div');
    const canvas = document.createElement('canvas'); canvas.width = N; canvas.height = 30;
    this.ctx = canvas.getContext('2d');
    this.el.append(this.textEl, canvas);
    // Hidden until the first frame gives it something to show, so loading has no empty box.
    this.el.style.visibility = 'hidden';
    document.body.appendChild(this.el);
  }

  setVisible(on: boolean) { this.visible = on; this.el.style.display = on ? 'block' : 'none'; }

  setLoad(report: { totalMs: number; stages: { key: string; label: string; ms: number }[] }) {
    const s = (ms: number) => (ms / 1000).toFixed(1);
    const short: Record<string, string> = { files: 'download', world: 'moor', characters: 'characters', shaders: 'shaders', warmup: 'first frame' };
    const parts = report.stages.filter((x) => x.ms > 0).map((x) => `${short[x.key] ?? x.key} ${s(x.ms)}`);
    // Three stages a line keeps the panel narrow enough for a phone.
    const lines = [];
    for (let i = 0; i < parts.length; i += 3) lines.push('  ' + parts.slice(i, i + 3).join('  '));
    this.loadLine = [`Loaded in ${s(report.totalMs)} s`, ...lines].join('\n');
  }

  // One rendered frame: time since the previous frame and main-thread time spent producing it (ms).
  push(dtMs: number, cpuMs: number) {
    this.dts[this.head] = dtMs; this.cpus[this.head] = cpuMs;
    this.head = (this.head + 1) % N; this.count = Math.min(N, this.count + 1);
  }

  update(dt: number, info: StatsInfo) {
    this.acc += dt;
    if (!this.visible || this.acc < 0.25 || this.count === 0) return;
    this.acc = 0;
    // Averages over roughly the last half second, worst frame over the whole graph.
    const recent = Math.min(this.count, 30);
    let sum = 0, cpu = 0, worst = 0;
    for (let i = 1; i <= recent; i++) { const j = (this.head - i + N) % N; sum += this.dts[j]; cpu += this.cpus[j]; }
    for (let i = 1; i <= this.count; i++) worst = Math.max(worst, this.dts[(this.head - i + N) % N]);
    const ms = sum / recent, fps = 1000 / Math.max(ms, 0.001);
    const cls = (v: number, warn: number, bad: number) => (v > bad ? 'bad' : v > warn ? 'warn' : '');
    const span = (t: string, c: string) => (c ? `<span class="${c}">${t}</span>` : t);
    const tri = info.triangles >= 1e6 ? `${(info.triangles / 1e6).toFixed(2)} M` : `${Math.round(info.triangles / 1e3)} k`;
    const gpu = this.gpuMs !== null ? `${this.gpuMs.toFixed(1)} ms` : this.gpuSupported ? '…' : 'n/a';
    this.textEl.innerHTML = [
      `${span(`${fps.toFixed(0)} fps`, cls(ms, 18, 34))}  ${ms.toFixed(1)} ms  worst ${span(worst.toFixed(1), cls(worst, 34, 60))}`,
      `CPU ${(cpu / recent).toFixed(1)} ms  GPU ${gpu}`,
      `${info.width}×${info.height}  scale ${info.scale.toFixed(2)}${info.adaptive ? ' auto' : ''}`,
      `${info.calls} draws  ${tri} tris`,
      `${info.backend} · ${info.tier}`,
      this.loadLine,
    ].filter(Boolean).join('\n');
    this.el.style.visibility = 'visible';
    this.drawGraph();
  }

  private drawGraph() {
    const g = this.ctx; if (!g) return;
    const H = 30, max = 50;
    g.clearRect(0, 0, N, H);
    g.fillStyle = 'rgba(232,228,218,.18)';
    for (const ref of [1000 / 60, 1000 / 30]) g.fillRect(0, H - Math.round((ref / max) * H), N, 1);
    for (let i = 0; i < this.count; i++) {
      const j = (this.head - this.count + i + N) % N;
      const v = this.dts[j];
      g.fillStyle = v > 34 ? '#e08a76' : v > 18 ? '#e2b56c' : '#9fbf8c';
      const h = Math.max(1, Math.min(H, Math.round((v / max) * H)));
      g.fillRect(N - this.count + i, H - h, 1, h);
    }
  }
}
