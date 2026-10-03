// Load progress across overlapping stages (downloads run while the world is built), each weighted by its usual
// share of the wait, plus per-stage timings for the stats panel and the console.
type Stage = { label: string; weight: number; frac: number; detail: string; start: number; end: number };

export class LoadTracker {
  readonly t0 = performance.now();
  private stages = new Map<string, Stage>();
  private order: string[] = [];
  onChange: ((fraction: number, text: string) => void) | null = null;

  constructor(defs: [key: string, label: string, weight: number][]) {
    for (const [k, label, weight] of defs) { this.stages.set(k, { label, weight, frac: 0, detail: '', start: -1, end: -1 }); this.order.push(k); }
  }

  private get(k: string) { const s = this.stages.get(k); if (!s) throw new Error(`Unknown load stage ${k}`); return s; }

  progress(k: string, frac: number, detail?: string) {
    const s = this.get(k);
    if (s.start < 0) s.start = performance.now();
    s.frac = Math.max(s.frac, Math.min(1, frac));
    if (detail !== undefined) s.detail = detail;
    this.emit();
  }

  done(k: string) {
    const s = this.get(k);
    if (s.start < 0) s.start = performance.now();
    s.frac = 1; s.detail = ''; s.end = performance.now();
    this.emit();
  }

  get fraction() {
    let w = 0, f = 0;
    for (const s of this.stages.values()) { w += s.weight; f += s.weight * s.frac; }
    return w > 0 ? f / w : 1;
  }

  // The earliest stage still running names what the player is waiting for.
  get text() {
    for (const k of this.order) {
      const s = this.get(k);
      if (s.start >= 0 && s.end < 0) return s.detail ? `${s.label} · ${s.detail}` : s.label;
    }
    for (const k of this.order) { const s = this.get(k); if (s.end < 0) return s.label; }
    return 'Ready';
  }

  // Wall-clock time per stage (stages overlap, so they need not add up to the total).
  report() {
    const stages = this.order.map((k) => { const s = this.get(k); return { key: k, label: s.label, ms: s.end >= 0 && s.start >= 0 ? s.end - s.start : 0 }; });
    const end = Math.max(...this.order.map((k) => this.get(k).end));
    return { totalMs: end - this.t0, stages };
  }

  private emit() { this.onChange?.(this.fraction, this.text); }
}

// Resolves after the browser has had a chance to paint, so progress shows between long synchronous steps.
// Falls back to a timer when animation frames are paused (a hidden tab).
export function nextPaint() {
  return new Promise<void>((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 100);
  });
}
