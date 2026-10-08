// The interface (v3), in HTML over the canvas: the title, loading, who is played, the action prompt, short
// messages, the objective, subtitles, chapter cards, fades, letterbox bars, and a pause menu (resume, chapters,
// quality, volume, controls).
const CSS = `
#hud3{position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff8ec;user-select:none;-webkit-user-select:none;z-index:4}
#hud3 .who{position:absolute;left:calc(14px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));display:flex;gap:8px;align-items:center;opacity:0;transition:opacity .6s}
#hud3 .who .chip{display:flex;align-items:center;gap:7px;padding:5px 12px 5px 6px;border-radius:999px;background:rgba(30,26,40,.42);border:2px solid rgba(255,248,236,.25);font-size:14px;font-weight:600;letter-spacing:.02em;transition:all .3s}
#hud3 .who .chip.on{background:rgba(195,179,138,.94);color:#3a2410;border-color:#fff3d6}
#hud3 .who .dot{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;background:rgba(255,255,255,.2)}
#hud3 .who .chip.on .dot{background:#fff3d6}
#hud3 .who .state{font-size:12px;font-weight:400;opacity:.85}
#hud3 .obj{position:absolute;left:calc(16px + env(safe-area-inset-left,0px));top:calc(54px + env(safe-area-inset-top,0px));max-width:min(60vw,420px);font-size:15px;padding:6px 12px;border-radius:10px;background:rgba(30,26,40,.32);opacity:0;transition:opacity .8s;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#hud3 .obj b{color:#d6cba9;font-weight:600}
#hud3 .msg{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:clamp(16px,2.2vw,22px);text-align:center;max-width:min(86vw,640px);padding:8px 16px;border-radius:12px;background:rgba(30,26,40,.45);opacity:0;transition:opacity .5s;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#hud3 .prompt{position:absolute;left:50%;bottom:calc(15% + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font-size:16px;font-weight:600;padding:7px 14px 7px 8px;border-radius:999px;background:rgba(30,26,40,.55);border:2px solid rgba(255,248,236,.3);opacity:0;transition:opacity .25s;display:flex;gap:8px;align-items:center}
#hud3 .prompt .k{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;border-radius:999px;background:#c7bb95;color:#3a2410;font-size:13px;font-weight:700}
#hud3 .sub{position:absolute;left:0;right:0;bottom:calc(15% + 50px + env(safe-area-inset-bottom,0px));text-align:center;font:italic clamp(18px,2.5vw,27px) 'Cormorant Garamond',Georgia,serif;color:#fff8ec;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.75);padding:0 16px;opacity:0;transition:opacity .35s}
#hud3 .bar{position:absolute;left:0;right:0;height:11vh;background:#0b0a0c;transition:transform .9s ease}
#hud3 .bar.t{top:0;transform:translateY(-100%)} #hud3 .bar.b{bottom:0;transform:translateY(100%)}
#hud3.lb .bar{transform:translateY(0)}
#hud3.lb .sub{bottom:calc(11vh + 10px)}
#hud3 .fade{position:absolute;inset:0;background:#0b0a0c;opacity:0}
#hud3 .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;opacity:0;transition:opacity 1.6s;padding:0 18px;background:radial-gradient(ellipse at center,rgba(12,10,14,.45),rgba(12,10,14,0) 70%);pointer-events:none}
#hud3 .card .t1{font:600 clamp(30px,min(7.5vw,12vh),96px) 'Cormorant Garamond',Georgia,serif;letter-spacing:.14em;padding-left:.14em;line-height:1.05;text-shadow:0 2px 18px rgba(0,0,0,.55)}
#hud3 .card .t2{font:italic clamp(16px,min(2.6vw,5vh),30px) 'Cormorant Garamond',Georgia,serif;opacity:.92;text-shadow:0 1px 8px rgba(0,0,0,.6)}
#hud3 .card .t0{font:600 13px 'Fredoka',system-ui;letter-spacing:.3em;text-transform:uppercase;color:#d6cba9}
#hud3 .title{pointer-events:auto;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(ellipse at center,rgba(20,16,24,.15),rgba(12,10,14,.7));transition:opacity 1.2s;cursor:pointer;text-align:center}
#hud3 .title h1{margin:0;font:600 clamp(48px,11vw,128px) 'Cormorant Garamond',Georgia,serif;letter-spacing:.22em;padding-left:.22em;text-shadow:0 4px 30px rgba(0,0,0,.5)}
#hud3 .title p{margin:0;font-size:16px;opacity:.9}
#hud3 .title .go{pointer-events:auto;font:600 18px 'Fredoka',system-ui;color:#3a2410;background:#c7bb95;border:0;border-radius:999px;padding:12px 30px;box-shadow:0 4px 0 #c99a3c;cursor:pointer}
#hud3 .title .go:disabled{opacity:.5;box-shadow:none}
#hud3 .title .sm{font-size:13px;opacity:.7}
#hud3 .load{width:min(300px,70vw);height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden}
#hud3 .load i{display:block;height:100%;width:0;background:#c7bb95;transition:width .3s}
#hud3 .menuBtn{pointer-events:auto;position:absolute;right:calc(12px + env(safe-area-inset-right,0px));top:calc(10px + env(safe-area-inset-top,0px));width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,248,236,.35);background:rgba(30,26,40,.4);color:#fff8ec;font-size:18px;cursor:pointer;display:none}
#hud3 .menu{pointer-events:auto;position:absolute;inset:0;background:rgba(14,12,18,.72);display:none;align-items:center;justify-content:center}
#hud3 .menu.open{display:flex}
#hud3 .menu .box{width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#2a2433;border:2px solid rgba(255,248,236,.2);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:10px}
#hud3 .menu h2{margin:0 0 4px;font:600 20px 'Fredoka',system-ui;text-align:center}
#hud3 .menu h3{margin:8px 0 2px;font:600 12px 'Fredoka',system-ui;letter-spacing:.18em;text-transform:uppercase;opacity:.6}
#hud3 .menu button{font:600 16px 'Fredoka',system-ui;color:#fff8ec;background:#3d3549;border:0;border-radius:12px;padding:11px 14px;cursor:pointer;text-align:left}
#hud3 .menu button.hi{background:#c7bb95;color:#3a2410}
#hud3 .menu button:disabled{opacity:.4}
#hud3 .menu .row{display:flex;gap:8px} #hud3 .menu .row button{flex:1;text-align:center}
#hud3 .menu .help{font-size:13px;line-height:1.5;opacity:.85}
#hud3 .menu input[type=range]{width:100%}
#hud3 .menu .credits{font:13px system-ui;color:#c7bd99;text-align:center;padding:8px}
#hud3 .skip{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(4vh + env(safe-area-inset-bottom,0px));font:600 14px 'Fredoka',system-ui;color:#fff8ec;opacity:0;transition:opacity .3s;z-index:3;text-shadow:0 1px 3px rgba(0,0,0,.6)}
#hud3 .wind{position:absolute;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:rgba(30,26,40,.42);border:2px solid rgba(255,248,236,.25);font:600 13px 'Fredoka',system-ui;opacity:0;transition:opacity .4s,background .3s,border-color .3s}
#hud3 .wind svg{width:26px;height:18px}
#hud3 .wind.warn{opacity:1;animation:windPulse .5s ease-in-out infinite alternate;border-color:#d6cba9}
#hud3 .wind.gust{opacity:1;background:rgba(200,90,60,.7);border-color:#fff3d6}
#hud3 .wind.calm{opacity:.75}
@keyframes windPulse{from{transform:translateX(-50%) scale(1)}to{transform:translateX(-50%) scale(1.08)}}
@media (max-height:520px){#hud3 .msg{font-size:15px;top:16%;padding:6px 12px}#hud3 .sub{font-size:18px}#hud3 .obj{font-size:13px;top:calc(46px + env(safe-area-inset-top,0px))}#hud3 .who .chip{font-size:13px;padding:3px 9px 3px 4px}#hud3 .prompt{font-size:14px;bottom:calc(10% + env(safe-area-inset-bottom,0px))}#hud3 .title h1{font-size:clamp(40px,14vh,96px)}}
`;

export type MenuChapter = { id: string; title: string; unlocked: boolean };

export class Hud {
  el: HTMLDivElement;
  private nodes = new Map<string, HTMLElement>();
  private q = <T extends HTMLElement>(s: string) => { let el = this.nodes.get(s); if (!el) { el = this.el.querySelector(s) as HTMLElement; this.nodes.set(s, el); } return el as T; };
  private whoKey = ''; private promptKey = '';
  private msgT = 0; private subT = 0;
  touch = false;
  onMenu?: (action: string, arg?: string) => void;
  private chapters: MenuChapter[] = [];
  private cardToken = 0;

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'hud3';
    this.el.innerHTML = `
      <div class="who"><div class="chip" data-k="kitten"><span class="dot">🐾</span><span>Kitten</span><span class="state"></span></div><div class="chip" data-k="knight"><span class="dot">⚔</span><span>Knight</span><span class="state"></span></div></div>
      <div class="obj"></div><div class="msg"></div><div class="prompt"><span class="k">E</span><span class="pt"></span></div>
      <div class="bar t"></div><div class="bar b"></div><div class="sub"></div>
      <div class="card"><div class="t0"></div><div class="t1"></div><div class="t2"></div></div>
      <div class="wind"><svg viewBox="0 0 26 18" fill="none" stroke="#fff8ec" stroke-width="2.2" stroke-linecap="round"><path d="M2 6h14a3 3 0 1 0-3-3"/><path d="M2 11h19a3 3 0 1 1-3 3"/><path d="M2 16h8"/></svg><span class="wt"></span></div>
      <div class="skip"></div>
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
  go?: () => void;
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
    this.go = go;
    b.onclick = (e) => { e.stopPropagation(); go(); };
    this.q<HTMLElement>('.title').onclick = go;
    addEventListener('keydown', (e) => { if (!this.started && (e.code === 'Enter' || e.code === 'Space')) go(); });
  }
  error(text: string) { this.q<HTMLElement>('.lt').textContent = text; }

  // ---- Play.
  resetSceneUI() {
    ++this.cardToken;
    clearTimeout(this.msgT); clearTimeout(this.subT);
    this.q<HTMLElement>('.msg').style.opacity = '0';
    this.q<HTMLElement>('.sub').style.opacity = '0';
    this.q<HTMLElement>('.card').style.opacity = '0';
    this.letterbox(false); this.objective(null); this.prompt(null); this.skipHint(false); this.wind('off');
  }
  who(active: 'kitten' | 'knight' | null, both: boolean, state = '', companionState = '') {
    const key = `${active}:${both}:${state}:${companionState}`; if (key === this.whoKey) return; this.whoKey = key;
    const w = this.q<HTMLElement>('.who');
    w.style.opacity = active ? '1' : '0';
    this.el.querySelectorAll<HTMLElement>('.who .chip').forEach((c) => {
      const k = c.dataset.k;
      c.classList.toggle('on', k === active);
      c.style.display = both || k === active ? '' : 'none';
      const s = c.querySelector<HTMLElement>('.state')!;
      const text = k === active ? state : companionState;
      if (s.textContent !== text) s.textContent = text;
    });
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
    const next = `${text}:${key}`; if (next === this.promptKey) return; this.promptKey = next;
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
  // "Press again to skip", bottom right, while a skip is armed.
  private skipOn = false;
  skipHint(on: boolean, touch = false) {
    if (on === this.skipOn) return;
    this.skipOn = on;
    const k = this.q<HTMLElement>('.skip');
    k.textContent = touch ? 'Tap again to skip ▸' : 'Press again to skip ▸';
    k.style.opacity = on ? '1' : '0';
  }
  // The gust indicator: hidden, calm, a gust coming, or blowing.
  private windState = '';
  wind(state: 'off' | 'calm' | 'warn' | 'gust') {
    if (state === this.windState) return;
    this.windState = state;
    const w = this.q<HTMLElement>('.wind');
    w.className = 'wind' + (state === 'off' ? '' : ' ' + state);
    this.q<HTMLElement>('.wt').textContent = state === 'warn' ? 'Gust coming!' : state === 'gust' ? 'Gust!' : 'Calm';
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
    const token = ++this.cardToken;
    const c = this.q<HTMLElement>('.card');
    this.q<HTMLElement>('.card .t0').textContent = kicker;
    this.q<HTMLElement>('.card .t1').textContent = title;
    this.q<HTMLElement>('.card .t2').textContent = line;
    c.style.opacity = '1';
    await new Promise((r) => setTimeout(r, (1.6 + hold) * 1000));
    if (token !== this.cardToken) return;
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
        ? 'Left thumb: move. Right thumb: look. <b>Jump</b>, <b>Act</b> (use, lift, throw), <b>Switch</b> (play the other one; your companion follows), <b>Wait / Call</b> (park or call your companion). Companions stay on puzzle plates and hold gates until you release them.'
        : '<b>WASD</b> move, <b>mouse</b> look, <b>Space</b> jump, <b>E</b> use / lift / throw, <b>Tab</b> switch (your companion follows), <b>Q</b> wait / call, <b>G</b> hint, <b>Shift</b> walk, <b>Esc</b> menu. Companions stay on puzzle plates and hold gates until you release them.'}</div><a class="credits" href="${import.meta.env.BASE_URL}CREDITS.html" target="_blank" rel="noopener">Credits and licenses ↗</a>`;
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
