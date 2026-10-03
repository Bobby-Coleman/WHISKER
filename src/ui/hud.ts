// HTML interface composited above the treated world image so text and controls stay crisp.
export type HudCallbacks = {
  onBegin: () => void;
  onTreatment: (v: number) => void;
  onClean: (on: boolean) => void;
  onQuality: (q: string) => void;
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onPreset: (i: number) => void;
  onAspect43: (on: boolean) => void;
  onMode: (m: 'field' | 'lab') => void;
  onLabToggle: (key: string, on: boolean) => void;
  onSkipReveal: () => void;
  onStats: (on: boolean) => void;
  onAdaptive: (on: boolean) => void;
  onAO: (on: boolean) => void;
  onLook: (look: string) => void;
};

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font-family:'Cormorant Garamond',Georgia,serif;color:#ece8de;user-select:none}
#hud .msg{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);font-size:clamp(17px,2.1vw,24px);letter-spacing:.02em;text-shadow:0 1px 3px rgba(0,0,0,.55);opacity:0;transition:opacity 1.2s;text-align:center;max-width:80vw;font-style:italic}
#hud .prompt{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);font-size:15px;letter-spacing:.06em;opacity:0;transition:opacity .3s;background:rgba(20,22,22,.38);padding:6px 12px;border-radius:3px;text-shadow:0 1px 2px #000}
#hud .key{display:inline-block;border:1px solid rgba(236,232,222,.6);border-radius:3px;padding:0 6px;margin-right:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;font-style:normal}
#hud .who{position:absolute;left:18px;top:14px;font-size:15px;letter-spacing:.12em;text-transform:uppercase;opacity:.82;text-shadow:0 1px 2px #000}
#hud .who small{display:block;text-transform:none;letter-spacing:.02em;font-size:13px;opacity:.8;font-style:italic}
#hud .btn{pointer-events:auto;position:absolute;right:14px;top:12px;background:rgba(20,22,22,.45);border:1px solid rgba(236,232,222,.3);color:#ece8de;font:14px Georgia,serif;padding:6px 12px;border-radius:3px;cursor:pointer}
#hud .panel{pointer-events:auto;position:absolute;right:14px;top:50px;width:min(320px,calc(100vw - 28px));max-height:calc(100vh - 70px);overflow:auto;background:rgba(18,20,20,.82);border:1px solid rgba(236,232,222,.18);border-radius:4px;padding:14px 16px;font:14px/1.45 Georgia,serif;display:none;box-sizing:border-box}
#hud .panel.open{display:block}
#hud .panel h3{margin:10px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.65;font-weight:normal}
#hud .panel h3:first-child{margin-top:0}
#hud .panel label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0}
#hud .panel input[type=range]{width:140px}
#hud .panel select,#hud .panel button{font:13px Georgia,serif;background:#2a2d2d;color:#ece8de;border:1px solid #555;border-radius:3px;padding:3px 8px;cursor:pointer}
#hud .panel .row{display:flex;flex-wrap:wrap;gap:6px}
#hud .panel table{border-collapse:collapse;width:100%}
#hud .panel td{padding:2px 0;vertical-align:top}
#hud .panel td:first-child{white-space:nowrap;padding-right:10px;font-family:ui-monospace,Menlo,monospace;font-size:12px;opacity:.85}
#hud .title{pointer-events:auto;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(40,44,44,.35),rgba(15,17,17,.75));transition:opacity 1.6s;cursor:pointer}
#hud .title h1{font-weight:normal;font-size:clamp(34px,6vw,64px);letter-spacing:.18em;margin:0;text-transform:uppercase}
#hud .title p{opacity:.75;letter-spacing:.08em;margin:14px 0 0;font-style:italic}
#hud .title .load{font-size:13px;opacity:.7;margin-top:12px;font-style:normal;letter-spacing:.08em;min-height:1.4em;text-align:center}
#hud .title .loading{margin-top:28px;display:flex;flex-direction:column;align-items:center;transition:opacity .6s}
#hud .title .bar{width:min(320px,62vw);height:2px;background:rgba(236,232,222,.2);overflow:hidden}
#hud .title .fill{height:100%;width:0;background:#ece8de;transition:width .3s}
#hud .title .begin{opacity:0;transition:opacity .8s}
#hud .title.ready .begin{opacity:.75}
#hud .title.ready .loading{opacity:0}
#hud .title:not(.ready){cursor:progress}
#hud .bars{position:absolute;inset:0;pointer-events:none;display:none}
#hud .bars.on{display:block}
#hud .bars div{position:absolute;background:#0d0e0e}
#hud .preset{position:absolute;left:50%;top:14px;transform:translateX(-50%);font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
@media (max-width:600px){#hud .who{font-size:13px}}
#hud.touch .msg{bottom:calc(196px + env(safe-area-inset-bottom,0px));max-width:min(80vw,560px)}
#hud.touch .prompt{bottom:calc(250px + env(safe-area-inset-bottom,0px))}
`;

export class Hud {
  root: HTMLDivElement;
  msgEl: HTMLDivElement; promptEl: HTMLDivElement; whoEl: HTMLDivElement; panel: HTMLDivElement; title: HTMLDivElement; bars: HTMLDivElement; presetEl: HTMLDivElement;
  private msgTimer = 0;
  private keyLabel = 'E';
  private loadEl: HTMLElement;
  private fillEl: HTMLElement;
  private lastWho = '';
  private lastPrompt: string | null = '';
  private lastPreset = '';
  begun = false;
  ready = false;

  constructor(private cb: HudCallbacks) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const font = document.createElement('link'); font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,400&display=swap'; document.head.appendChild(font);
    this.root = document.createElement('div'); this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="bars"><div class="l"></div><div class="r"></div><div class="t"></div><div class="b"></div></div>
      <div class="who"></div><div class="preset"></div>
      <div class="msg"></div><div class="prompt"></div>
      <button class="btn" title="Settings and controls (H)">Settings &amp; controls</button>
      <div class="panel">
        <h3>Controls</h3>
        <table>
          <tr><td>WASD / stick</td><td>Move (camera-relative)</td></tr>
          <tr><td>Shift / hold B</td><td>Walk</td></tr>
          <tr><td>Mouse / right stick</td><td>Look (click to capture mouse, Esc to release)</td></tr>
          <tr><td>Wheel</td><td>Camera distance</td></tr>
          <tr><td>Tab / Y</td><td>Switch between kitten and knight</td></tr>
          <tr><td>E / A</td><td>Interact (lift, pull, take)</td></tr>
          <tr><td>Q / X</td><td>Companion waits or follows</td></tr>
          <tr><td>R / Back</td><td>Reset both to the start</td></tr>
          <tr><td>1-4, 0</td><td>Review camera presets, 0 returns to play</td></tr>
          <tr><td>C</td><td>Clean render (no image treatment)</td></tr>
          <tr><td>F</td><td>4:3 reference framing</td></tr>
          <tr><td>H</td><td>Show or hide this panel</td></tr>
          <tr><td>P</td><td>Show or hide performance stats</td></tr>
          <tr><td>Touch</td><td>Left thumb moves, right thumb looks; Switch, Act and Wait buttons</td></tr>
        </table>
        <h3>Image</h3>
        <label>Look <select data-k="look"><option value="vintage">Vintage</option><option value="modern">Modern</option></select></label>
        <label>Treatment strength <input type="range" min="0" max="1.5" step="0.05" value="0.6" data-k="treat"></label>
        <label>Clean render <input type="checkbox" data-k="clean"></label>
        <label>4:3 framing <input type="checkbox" data-k="aspect"></label>
        <label>Ambient occlusion <input type="checkbox" data-k="ao"></label>
        <label>Adaptive resolution <input type="checkbox" checked data-k="drs"></label>
        <label>Performance stats (P) <input type="checkbox" data-k="stats"></label>
        <label>Quality <select data-k="quality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <h3>Sound</h3>
        <label>Volume <input type="range" min="0" max="1" step="0.05" value="0.8" data-k="vol"></label>
        <label>Mute <input type="checkbox" data-k="mute"></label>
        <h3>Review</h3>
        <div class="row">
          <button data-p="0">Kitten close-up</button><button data-p="1">Paired</button><button data-p="2">Field wide</button><button data-p="3">Knight helmet</button><button data-p="-1">Play</button>
        </div>
        <h3>Material lab</h3>
        <div class="row"><button data-m="lab">Open lab</button><button data-m="field">Back to field</button></div>
        <div class="labt" style="display:none">
          <label>Detail normals <input type="checkbox" checked data-l="normals"></label>
          <label>Roughness maps <input type="checkbox" checked data-l="rough"></label>
          <label>Environment light <input type="checkbox" checked data-l="env"></label>
          <label>Direct light <input type="checkbox" checked data-l="direct"></label>
          <label>Shadows <input type="checkbox" checked data-l="shadows"></label>
          <label>Fur fuzz <input type="checkbox" checked data-l="fuzz"></label>
          <label>Second environment (warm) <input type="checkbox" data-l="env2"></label>
          <label>Turntable <input type="checkbox" checked data-l="turn"></label>
        </div>
        <p style="opacity:.6;font-size:12px;margin:12px 0 0">Whisker, first field prototype. Rendering: <span class="backend"></span>.</p>
      </div>
      <div class="title"><h1>Whisker</h1><p class="begin">${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} to begin</p><div class="loading"><div class="bar"><div class="fill"></div></div><div class="load">Preparing the moor…</div></div></div>`;
    document.getElementById('boot')?.remove();
    document.body.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.msgEl = q('.msg'); this.promptEl = q('.prompt'); this.whoEl = q('.who'); this.panel = q('.panel'); this.title = q('.title'); this.bars = q('.bars'); this.presetEl = q('.preset');
    this.loadEl = q('.load'); this.fillEl = q('.fill');
    q<HTMLButtonElement>('.btn').onclick = (e) => { e.stopPropagation(); this.togglePanel(); };
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panel.querySelectorAll('input,select').forEach((el) => {
      const i = el as HTMLInputElement;
      const k = i.dataset.k, l = i.dataset.l;
      i.addEventListener('input', () => {
        if (k === 'treat') cb.onTreatment(+i.value);
        if (k === 'clean') cb.onClean(i.checked);
        if (k === 'aspect') cb.onAspect43(i.checked);
        if (k === 'quality') cb.onQuality(i.value);
        if (k === 'vol') cb.onVolume(+i.value);
        if (k === 'mute') cb.onMute(i.checked);
        if (k === 'stats') cb.onStats(i.checked);
        if (k === 'drs') cb.onAdaptive(i.checked);
        if (k === 'ao') cb.onAO(i.checked);
        if (k === 'look') cb.onLook(i.value);
        if (l) cb.onLabToggle(l, i.checked);
      });
    });
    this.panel.querySelectorAll('button[data-p]').forEach((b) => (b as HTMLButtonElement).onclick = () => cb.onPreset(+(b as HTMLElement).dataset.p!));
    this.panel.querySelectorAll('button[data-m]').forEach((b) => (b as HTMLButtonElement).onclick = () => {
      const m = (b as HTMLElement).dataset.m as 'lab' | 'field';
      (q('.labt') as HTMLElement).style.display = m === 'lab' ? 'block' : 'none';
      cb.onMode(m);
    });
    this.title.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.begin(); });
  }

  setProgress(fraction: number, text: string) {
    this.fillEl.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.loadEl.textContent = `${text}  ${Math.floor(fraction * 100)}%`;
  }

  // Loading finished: the title now invites the player in.
  setReady() { this.ready = true; this.title.classList.add('ready'); }

  begin() {
    if (!this.ready) return;
    if (this.begun) { this.cb.onSkipReveal(); return; }
    this.begun = true;
    this.title.style.opacity = '0';
    setTimeout(() => (this.title.style.display = 'none'), 1700);
    this.cb.onBegin();
  }

  setBackend(b: string) { (this.root.querySelector('.backend') as HTMLElement).textContent = b; }

  togglePanel(force?: boolean) { this.panel.classList.toggle('open', force); }

  setChecked(key: string, on: boolean) { const i = this.root.querySelector(`[data-k="${key}"]`) as HTMLInputElement; if (i) i.checked = on; }
  setValue(key: string, v: string) { const i = this.root.querySelector(`[data-k="${key}"]`) as HTMLSelectElement; if (i) i.value = v; }

  say(text: string, seconds = 4.5) {
    this.msgEl.textContent = text;
    this.msgEl.style.opacity = '1';
    this.msgTimer = seconds;
  }

  setPrompt(text: string | null) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (text) { this.promptEl.innerHTML = `<span class="key">${this.keyLabel}</span>${text}`; this.promptEl.style.opacity = '1'; } else this.promptEl.style.opacity = '0';
  }

  // Touch players see the on-screen button name instead of a keyboard key.
  setTouch() { this.keyLabel = 'Act'; this.lastPrompt = ''; this.root.classList.add('touch'); }

  // Called every frame, so the DOM is only touched when the text changes.
  setWho(name: string, companion: string) {
    const html = `${name}<small>${companion}</small>`;
    if (html !== this.lastWho) { this.lastWho = html; this.whoEl.innerHTML = html; }
  }
  setPresetName(n: string) { if (n !== this.lastPreset) { this.lastPreset = n; this.presetEl.textContent = n; } }

  setAspectBars(on: boolean) {
    this.bars.classList.toggle('on', on);
    if (!on) return;
    const W = innerWidth, H = innerHeight;
    const [l, r, t, b] = Array.from(this.bars.children) as HTMLElement[];
    if (W / H > 4 / 3) {
      const w = (W - (H * 4) / 3) / 2;
      Object.assign(l.style, { left: '0', top: '0', width: `${w}px`, height: '100%' });
      Object.assign(r.style, { right: '0', top: '0', width: `${w}px`, height: '100%' });
      t.style.height = b.style.height = '0';
    } else {
      const h = (H - (W * 3) / 4) / 2;
      Object.assign(t.style, { left: '0', top: '0', width: '100%', height: `${h}px` });
      Object.assign(b.style, { left: '0', bottom: '0', width: '100%', height: `${h}px` });
      l.style.width = r.style.width = '0';
    }
  }

  update(dt: number) {
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.msgEl.style.opacity = '0'; }
  }
}
