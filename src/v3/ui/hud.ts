// The interface (v3), in HTML over the canvas: the title, loading, who is played, the action prompt, short
// messages, the objective, subtitles, chapter cards, fades, letterbox bars, and a pause menu (resume, chapters,
// quality, volume, controls).
const CSS = `
#hud3{position:fixed;inset:0;pointer-events:none;font-family:'Fredoka','Nunito',system-ui,sans-serif;color:#fff8ec;user-select:none;-webkit-user-select:none;z-index:4}
#hud3 .who{position:absolute;left:calc(14px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));display:flex;gap:8px;align-items:center;opacity:0;transition:opacity .6s}
#hud3 .who .chip{display:flex;align-items:center;gap:7px;padding:5px 12px 5px 6px;border-radius:999px;background:rgba(30,26,40,.42);border:2px solid rgba(255,248,236,.25);font-size:14px;font-weight:600;letter-spacing:.02em;transition:all .3s}
#hud3 .who .chip.on{background:rgba(255,190,90,.88);color:#3a2410;border-color:#fff3d6}
#hud3 .who .dot{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;background:rgba(255,255,255,.2)}
#hud3 .who .chip.on .dot{background:#fff3d6}
#hud3 .who .state{font-size:12px;font-weight:400;opacity:.85}
#hud3 .obj{position:absolute;left:calc(16px + env(safe-area-inset-left,0px));top:calc(54px + env(safe-area-inset-top,0px));max-width:min(60vw,420px);font-size:15px;padding:6px 12px;border-radius:10px;background:rgba(30,26,40,.32);opacity:0;transition:opacity .8s;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#hud3 .obj b{color:#ffd27a;font-weight:600}
#hud3 .msg{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:clamp(16px,2.2vw,22px);text-align:center;max-width:min(86vw,640px);padding:8px 16px;border-radius:12px;background:rgba(30,26,40,.45);opacity:0;transition:opacity .5s;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#hud3 .prompt{position:absolute;left:50%;bottom:calc(15% + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font-size:16px;font-weight:600;padding:7px 14px 7px 8px;border-radius:999px;background:rgba(30,26,40,.55);border:2px solid rgba(255,248,236,.3);opacity:0;transition:opacity .25s;display:flex;gap:8px;align-items:center}
#hud3 .prompt .k{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;border-radius:999px;background:#ffd27a;color:#3a2410;font-size:13px;font-weight:700}
#hud3 .sub{position:absolute;left:0;right:0;bottom:calc(12vh + 14px);text-align:center;font:italic clamp(18px,2.5vw,27px) 'Cormorant Garamond',Georgia,serif;color:#fff8ec;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.75);padding:0 16px;opacity:0;transition:opacity .35s}
#hud3 .bar{position:absolute;left:0;right:0;height:11vh;background:#0b0a0c;transition:transform .9s ease}
#hud3 .bar.t{top:0;transform:translateY(-100%)} #hud3 .bar.b{bottom:0;transform:translateY(100%)}
#hud3.lb .bar{transform:translateY(0)}
#hud3 .fade{position:absolute;inset:0;background:#0b0a0c;opacity:0}
#hud3 .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;opacity:0;transition:opacity 1.6s;padding:0 18px}
#hud3 .card .t1{font:600 clamp(40px,8.5vw,96px) 'Cormorant Garamond',Georgia,serif;letter-spacing:.2em;padding-left:.2em}
#hud3 .card .t2{font:italic clamp(18px,2.6vw,30px) 'Cormorant Garamond',Georgia,serif;opacity:.9}
#hud3 .card .t0{font:600 13px 'Fredoka',system-ui;letter-spacing:.3em;text-transform:uppercase;color:#ffd27a}
#hud3 .title{pointer-events:auto;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(ellipse at center,rgba(20,16,24,.15),rgba(12,10,14,.7));transition:opacity 1.2s;cursor:pointer;text-align:center}
#hud3 .title h1{margin:0;font:600 clamp(48px,11vw,128px) 'Cormorant Garamond',Georgia,serif;letter-spacing:.22em;padding-left:.22em;text-shadow:0 4px 30px rgba(0,0,0,.5)}
#hud3 .title p{margin:0;font-size:16px;opacity:.9}
#hud3 .title .go{pointer-events:auto;font:600 18px 'Fredoka',system-ui;color:#3a2410;background:#ffd27a;border:0;border-radius:999px;padding:12px 30px;box-shadow:0 4px 0 #c99a3c;cursor:pointer}
#hud3 .title .go:disabled{opacity:.5;box-shadow:none}
#hud3 .title .sm{font-size:13px;opacity:.7}
#hud3 .load{width:min(300px,70vw);height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden}
#hud3 .load i{display:block;height:100%;width:0;background:#ffd27a;transition:width .3s}
#hud3 .menuBtn{pointer-events:auto;position:absolute;right:calc(12px + env(safe-area-inset-right,0px));top:calc(10px + env(safe-area-inset-top,0px));width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,248,236,.35);background:rgba(30,26,40,.4);color:#fff8ec;font-size:18px;cursor:pointer;display:none}
#hud3 .menu{pointer-events:auto;position:absolute;inset:0;background:rgba(14,12,18,.72);display:none;align-items:center;justify-content:center}
#hud3 .menu.open{display:flex}
#hud3 .menu .box{width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#2a2433;border:2px solid rgba(255,248,236,.2);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:10px}
#hud3 .menu h2{margin:0 0 4px;font:600 20px 'Fredoka',system-ui;text-align:center}
#hud3 .menu h3{margin:8px 0 2px;font:600 12px 'Fredoka',system-ui;letter-spacing:.18em;text-transform:uppercase;opacity:.6}
#hud3 .menu button{font:600 16px 'Fredoka',system-ui;color:#fff8ec;background:#3d3549;border:0;border-radius:12px;padding:11px 14px;cursor:pointer;text-align:left}
#hud3 .menu button.hi{background:#ffd27a;color:#3a2410}
#hud3 .menu button:disabled{opacity:.4}
#hud3 .menu .row{display:flex;gap:8px} #hud3 .menu .row button{flex:1;text-align:center}
#hud3 .menu .help{font-size:13px;line-height:1.5;opacity:.85}
#hud3 .menu input[type=range]{width:100%}
`;

export type MenuChapter = { id: string; title: string; unlocked: boolean };

export class Hud {
  el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private msgT = 0; private subT = 0;
  touch = false;
  onMenu?: (action: string, arg?: string) => void;
  private chapters: MenuChapter[] = [];

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'hud3';
    this.el.innerHTML = `
      <div class="who"><div class="chip" data-k="kitten"><span class="dot">🐾</span><span>Kitten</span></div><div class="chip" data-k="knight"><span class="dot">⚔</span><span>Knight</span><span class="state"></span></div></div>
      <div class="obj"></div><div class="msg"></div><div class="prompt"><span class="k">E</span><span class="pt"></span></div>
      <div class="bar t"></div><div class="bar b"></div><div class="sub"></div>
      <div class="card"><div class="t0"></div><div class="t1"></div><div class="t2"></div></div>
      <div class="fade"></div>
      <button class="menuBtn" aria-label="Menu">☰</button>
      <div class="menu"><div class="box"></div></div>
      <div class="title"><h1>WHISKER</h1><div class="load"><i></i></div><p class="lt">Loading…</p><button class="go" disabled>Play</button><p class="sm">Headphones on. Best in landscape.</p></div>`;
    document.body.appendChild(this.el);
    this.q<HTMLButtonElement>('.menuBtn').onclick = () => this.openMenu();
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.started) { if (this.menuOpen) this.closeMenu(); else this.openMenu(); } });
  }

  // ---- Title and loading.
  started = false;
  progress(f: number, text = 'Loading…') { this.q<HTMLElement>('.load i').style.width = `${Math.round(f * 100)}%`; this.q<HTMLElement>('.lt').textContent = text; }
  ready(label: string, onGo: () => void) {
    const b = this.q<HTMLButtonElement>('.go');
    b.disabled = false; b.textContent = label;
    this.q<HTMLElement>('.lt').textContent = 'Ready.';
    this.q<HTMLElement>('.load').style.opacity = '0';
    const go = () => {
      if (this.started) return;
      this.started = true;
      const t = this.q<HTMLElement>('.title');
      t.style.opacity = '0'; t.style.pointerEvents = 'none';
      setTimeout(() => t.remove(), 1300);
      this.q<HTMLElement>('.menuBtn').style.display = 'block';
      onGo();
    };
    b.onclick = (e) => { e.stopPropagation(); go(); };
    this.q<HTMLElement>('.title').onclick = go;
    addEventListener('keydown', (e) => { if (!this.started && (e.code === 'Enter' || e.code === 'Space')) go(); });
  }
  error(text: string) { this.q<HTMLElement>('.lt').textContent = text; }

  // ---- Play.
  who(active: 'kitten' | 'knight' | null, both: boolean, state = '') {
    const w = this.q<HTMLElement>('.who');
    w.style.opacity = active ? '1' : '0';
    this.el.querySelectorAll<HTMLElement>('.who .chip').forEach((c) => {
      const k = c.dataset.k;
      c.classList.toggle('on', k === active);
      c.style.display = both || k === active ? '' : 'none';
    });
    const s = this.q<HTMLElement>('.who .state'); if (s.textContent !== state) s.textContent = state;
  }
  objective(text: string | null) {
    const o = this.q<HTMLElement>('.obj');
    if (text) { if (o.innerHTML !== text) o.innerHTML = text; o.style.opacity = '1'; } else o.style.opacity = '0';
  }
  say(text: string, seconds = 4) {
    const m = this.q<HTMLElement>('.msg');
    m.innerHTML = text; m.style.opacity = '1';
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => { m.style.opacity = '0'; }, seconds * 1000) as unknown as number;
  }
  prompt(text: string | null, key = 'E') {
    const p = this.q<HTMLElement>('.prompt');
    if (!text) { p.style.opacity = '0'; return; }
    this.q<HTMLElement>('.pt').textContent = text;
    this.q<HTMLElement>('.prompt .k').textContent = key;
    p.style.opacity = '1';
  }
  subtitle(text: string | null, seconds = 4) {
    const s = this.q<HTMLElement>('.sub');
    clearTimeout(this.subT);
    if (!text) { s.style.opacity = '0'; return; }
    s.textContent = text; s.style.opacity = '1';
    this.subT = setTimeout(() => { s.style.opacity = '0'; }, seconds * 1000) as unknown as number;
  }
  letterbox(on: boolean) { this.el.classList.toggle('lb', on); }
  fadeLevel(o: number) { this.q<HTMLElement>('.fade').style.opacity = String(o); }
  fade(to: number, secs: number) {
    const f = this.q<HTMLElement>('.fade');
    f.style.transition = `opacity ${secs}s ease`;
    f.style.opacity = String(to);
    return new Promise<void>((r) => setTimeout(r, secs * 1000));
  }
  // A card over black or over the scene: a small kicker, a big title and a line.
  async card(kicker: string, title: string, line: string, hold = 3.5) {
    const c = this.q<HTMLElement>('.card');
    this.q<HTMLElement>('.card .t0').textContent = kicker;
    this.q<HTMLElement>('.card .t1').textContent = title;
    this.q<HTMLElement>('.card .t2').textContent = line;
    c.style.opacity = '1';
    await new Promise((r) => setTimeout(r, (1.6 + hold) * 1000));
    c.style.opacity = '0';
    await new Promise((r) => setTimeout(r, 1600));
  }

  // ---- Menu.
  menuOpen = false;
  quality = 'auto'; volume = 0.8;
  setChapters(c: MenuChapter[]) { this.chapters = c; }
  openMenu() {
    this.menuOpen = true;
    const box = this.q<HTMLElement>('.menu .box');
    const ch = this.chapters.map((c) => `<button data-a="chapter" data-v="${c.id}" ${c.unlocked ? '' : 'disabled'}>${c.title}</button>`).join('');
    const qb = ['low', 'medium', 'high'].map((q) => `<button data-a="quality" data-v="${q}" class="${this.quality === q ? 'hi' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('');
    box.innerHTML = `<h2>Paused</h2><button class="hi" data-a="resume">Resume</button><button data-a="restart">Restart from checkpoint</button>
      <h3>Chapters</h3>${ch}
      <h3>Graphics</h3><div class="row">${qb}</div>
      <h3>Volume</h3><input type="range" min="0" max="1" step="0.05" value="${this.volume}">
      <h3>Controls</h3><div class="help">${this.touch
        ? 'Left thumb: move. Right thumb: look. <b>Jump</b>, <b>Act</b> (use, lift, throw), <b>Switch</b> (play the other one; the one you leave stays put), <b>Call</b> (the other one comes to you, or waits).'
        : '<b>WASD</b> move, <b>mouse</b> look, <b>Space</b> jump, <b>E</b> use / lift / throw, <b>Tab</b> switch (the one you leave stays put), <b>Q</b> call the other one to you (again: wait), <b>Esc</b> menu.'}</div>`;
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.onclick = () => {
      const a = b.dataset.a!, v = b.dataset.v;
      if (a === 'resume') { this.closeMenu(); return; }
      if (a === 'quality') { this.quality = v!; }
      this.closeMenu();
      this.onMenu?.(a, v);
    });
    box.querySelector<HTMLInputElement>('input[type=range]')!.oninput = (e) => { this.volume = +(e.target as HTMLInputElement).value; this.onMenu?.('volume', String(this.volume)); };
    this.q<HTMLElement>('.menu').classList.add('open');
    this.onMenu?.('pause');
  }
  closeMenu() { this.menuOpen = false; this.q<HTMLElement>('.menu').classList.remove('open'); this.onMenu?.('unpause'); }
}
